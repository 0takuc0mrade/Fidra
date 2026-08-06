import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowSquareOut,
  CheckCircle,
  CircleNotch,
  Copy,
  ShieldCheck,
  WarningCircle,
  Wallet,
} from "@phosphor-icons/react";
import { PrimaryButton, StatusBadge } from "../components.jsx";
import { circleApi } from "../lib/circle/api.js";
import {
  clearChallengeAuthentication,
  clearCircleFlow,
  executeChallenge,
  getChallengeAuthentication,
  getCircleSdk,
  getSavedCircleFlow,
  saveChallengeAuthentication,
  saveCircleFlow,
} from "../lib/circle/sdk.js";
import { deriveWorkerClaimState, mapWorkerTransactionStatus, workerQuote } from "../lib/circle/workerPayout.js";
import { clearCircleWorkerWallet, saveCircleWorkerWallet } from "../lib/circle/workerIdentity.js";
import { formatTimestamp, formatUsdc, truncateHex } from "../lib/contracts/types.js";
import { loadV1Claim, loadV1Dashboard } from "../lib/v1/liveV1Data.js";

const POLL_INTERVAL_MS = 2_500;
const POLL_ATTEMPTS = 48;

const eligibilityCopy = Object.freeze({
  loading: "Loading the live claim from Arc.",
  not_configured: "Circle is not configured on this server. Live worker payout remains disabled.",
  wallet_required: "Authenticate and create or retrieve your Circle Arc Testnet EOA.",
  worker_wallet_mismatch: "This Circle wallet is not the worker address on the claim.",
  claim_not_certified: "The platform has not certified this earnings claim yet.",
  claim_expired: "The normal payout date has passed, so an instant payout is no longer available.",
  platform_paused: "The platform is paused and cannot open new advances.",
  claim_already_paid: "This claim has already been advanced or resolved.",
  quote_available: "The claim is certified and ready for an instant payout.",
  insufficient_liquidity: "Fidra does not currently have enough verified liquidity for this payout.",
});

function FlowMessage({ tone = "neutral", children }) {
  if (!children) return null;
  return (
    <div className={`v1-flow-message v1-flow-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {tone === "error" ? <WarningCircle aria-hidden="true" /> : tone === "success" ? <CheckCircle aria-hidden="true" /> : null}
      <span>{children}</span>
    </div>
  );
}

function WorkerSession({
  circleStatus,
  session,
  wallet,
  email,
  setEmail,
  busy,
  onAuthenticate,
  onCreateWallet,
  onSeedGas,
  onLogout,
  onCopy,
}) {
  const configured = circleStatus?.wallets?.status === "configured";
  return (
    <section className="v1-session-panel" aria-labelledby="worker-wallet-heading">
      <div className="v1-section-heading">
        <div><h2 id="worker-wallet-heading">Worker wallet</h2><p>Circle user-controlled · Arc Testnet EOA</p></div>
        <span className={`v1-config-state ${configured ? "is-ready" : ""}`}>{configured ? "Circle configured" : "Circle not configured"}</span>
      </div>
      {!configured ? (
        <p className="v1-empty-copy">Add the Circle sandbox server credentials to enable authentication and worker-approved transactions. No mock wallet is substituted.</p>
      ) : !session?.authenticated ? (
        <div className="v1-auth-controls">
          <label htmlFor="worker-email">Email for Circle OTP</label>
          <div className="v1-inline-form">
            <input id="worker-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="worker@example.com" autoComplete="email" />
            <button className="button-outline" type="button" disabled={Boolean(busy)} onClick={() => onAuthenticate("email_otp")}>Email code</button>
            <button className="button-outline" type="button" disabled={Boolean(busy) || circleStatus?.authentication?.google !== "configured"} onClick={() => onAuthenticate("google")}>Continue with Google</button>
          </div>
          <p className="v1-helper-copy">Circle presents the OTP or Google window. Fidra never receives your password or private key.</p>
        </div>
      ) : !wallet ? (
        <div className="v1-wallet-empty">
          <Wallet aria-hidden="true" />
          <div><strong>No Arc worker wallet found</strong><span>Retrieve an existing EOA or approve creation in Circle.</span></div>
          <PrimaryButton type="button" loading={busy === "wallet"} disabled={Boolean(busy)} onClick={onCreateWallet}>Create or retrieve wallet</PrimaryButton>
        </div>
      ) : (
        <div className="v1-wallet-record">
          <div className="v1-wallet-address"><Wallet aria-hidden="true" /><div><span>Connected worker</span><strong>{truncateHex(wallet.address, 10, 8)}</strong></div></div>
          <button className="icon-button" type="button" aria-label="Copy worker wallet address" onClick={() => onCopy(wallet.address)}><Copy /></button>
          <span className="network-pill">Arc Testnet</span>
          <button className="button-link" type="button" disabled={Boolean(busy)} onClick={onSeedGas}>Check gas</button>
          <button className="button-link" type="button" onClick={onLogout}>Sign out</button>
        </div>
      )}
    </section>
  );
}

function WorkerClaimList({ claims, navigate }) {
  return (
    <section className="v1-claim-list" aria-labelledby="worker-claims-heading">
      <div className="v1-section-heading"><div><h2 id="worker-claims-heading">Earnings claims</h2><p>Confirmed V1.1 Arc records</p></div></div>
      <div className="v1-table" role="table" aria-label="Worker earnings claims">
        <div className="v1-table-row v1-table-head" role="row">
          <span role="columnheader">Claim</span><span role="columnheader">Earnings</span><span role="columnheader">Normal payout</span><span role="columnheader">Status</span><span role="columnheader">Action</span>
        </div>
        {claims.map((claim) => (
          <div className="v1-table-row" role="row" key={claim.id}>
            <span role="cell" data-label="Claim"><strong>#{claim.id}</strong><small>{claim.purpose}</small></span>
            <span role="cell" data-label="Earnings">{formatUsdc(claim.faceValue)} USDC</span>
            <span role="cell" data-label="Normal payout">{formatTimestamp(claim.dueDate)}</span>
            <span role="cell" data-label="Status"><StatusBadge state={claim.status} /></span>
            <span role="cell" data-label="Action"><button className="button-link" type="button" onClick={() => navigate(`/worker/claims/${claim.id}`)}>View payout</button></span>
          </div>
        ))}
      </div>
    </section>
  );
}

function WorkerClaimDetail({ record, eligibility, transaction, onPayout, busy }) {
  const { claim, purchase, platform } = record;
  const quote = workerQuote(claim, platform);
  const canAdvance = eligibility === "quote_available";
  return (
    <div className="v1-worker-grid">
      <section className="v1-payout-panel" aria-labelledby="payout-heading">
        <div className="v1-payout-title"><div><span>Claim #{claim.id} · Platform {claim.platformId.toString()}</span><h2 id="payout-heading">Your completed earnings</h2></div><StatusBadge state={claim.status} /></div>
        <div className="v1-payout-amount">
          <span className="v1-amount-label">Available now</span>
          <div><strong>{quote ? quote.advance : formatUsdc(claim.faceValue)}</strong><span>USDC</span></div>
          <small>{quote ? `From ${formatUsdc(claim.faceValue)} USDC completed earnings · ${quote.fee} USDC fee` : `${formatUsdc(claim.faceValue)} USDC completed earnings`}</small>
        </div>
        <dl className="v1-payout-breakdown">
          <div><dt>Normal payout</dt><dd>{formatTimestamp(claim.dueDate)}</dd></div>
          <div><dt>Fee</dt><dd>{quote ? `${quote.fee} USDC` : "—"}</dd></div>
          <div><dt>Fee sponsor</dt><dd>Worker-paid</dd></div>
          <div><dt>Task reference</dt><dd><code>{truncateHex(claim.taskHash, 12, 10)}</code></dd></div>
        </dl>
        <div className={`v1-eligibility v1-eligibility-${canAdvance ? "ready" : "blocked"}`}>
          {canAdvance ? <ShieldCheck aria-hidden="true" /> : <WarningCircle aria-hidden="true" />}
          <div><strong>{canAdvance ? "Instant payout available" : "Instant payout unavailable"}</strong><span>{eligibilityCopy[eligibility]}</span></div>
        </div>
        {eligibility === "worker_wallet_mismatch" && (
          <dl className="v1-wallet-mismatch">
            <div><dt>Connected Circle wallet</dt><dd><code>{truncateHex(record.connectedWallet || "", 12, 10)}</code></dd></div>
            <div><dt>Claim worker</dt><dd><code>{truncateHex(claim.worker, 12, 10)}</code></dd></div>
          </dl>
        )}
        <PrimaryButton type="button" loading={busy === "advance"} disabled={!canAdvance || Boolean(busy)} onClick={onPayout}>Get paid now</PrimaryButton>
        <p className="v1-risk-copy">The platform settles with Fidra later. You never repay Fidra, and a completed payout cannot be clawed back by a platform default.</p>
      </section>
      <aside className="v1-transaction-panel" aria-labelledby="transaction-heading">
        <div className="v1-section-heading"><div><h2 id="transaction-heading">Payout progress</h2><p>Circle approval, then independent Arc verification</p></div></div>
        <ol className="v1-transaction-steps">
          <li className={transaction.state !== "idle" ? "is-complete" : ""}><span>1</span><div><strong>Live quote checked</strong><small>Worker, claim, platform, reserve, credit and liquidity.</small></div></li>
          <li className={["awaiting_approval", "transaction_pending", "transaction_confirmed"].includes(transaction.state) ? "is-current" : ""}><span>2</span><div><strong>Circle approval</strong><small>The worker approves in Circle's SDK window.</small></div></li>
          <li className={transaction.state === "transaction_pending" ? "is-current" : transaction.state === "transaction_confirmed" ? "is-complete" : ""}><span>3</span><div><strong>Arc confirmation</strong><small>Receipt and V1 claim state must both match.</small></div></li>
        </ol>
        {transaction.state === "transaction_confirmed" && (
          <a className="v1-receipt-link" href={transaction.explorerUrl} target="_blank" rel="noreferrer"><CheckCircle aria-hidden="true" /><span><strong>Payout confirmed</strong><small>{truncateHex(transaction.txHash, 14, 12)}</small></span><ArrowSquareOut /></a>
        )}
        {["challenge_rejected", "transaction_failed", "transaction_timed_out", "insufficient_liquidity"].includes(transaction.state) && (
          <FlowMessage tone="error">{transaction.errorReason || "The payout did not confirm. No receipt has been issued."}</FlowMessage>
        )}
        {purchase.status !== "None" && <p className="v1-existing-purchase">Vault purchase: <strong>{purchase.status}</strong>{purchase.advanceAmount > 0n ? ` · ${formatUsdc(purchase.advanceAmount)} USDC paid` : ""}</p>}
      </aside>
    </div>
  );
}

export default function WorkerPayout({ claimId, navigate, showNotice }) {
  const sdkRef = useRef(null);
  const [circleStatus, setCircleStatus] = useState(null);
  const [session, setSession] = useState({ authenticated: false });
  const [wallet, setWallet] = useState(null);
  const [authCredentials, setAuthCredentials] = useState(getChallengeAuthentication);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState("load");
  const [message, setMessage] = useState({ tone: "neutral", text: "" });
  const [dashboard, setDashboard] = useState(null);
  const [record, setRecord] = useState(null);
  const [transaction, setTransaction] = useState({ state: "idle", txHash: null, explorerUrl: null, errorReason: null });

  const refreshWallet = useCallback(async () => {
    try {
      const response = await circleApi.getWorkerWallet();
      if (response.status === "ready") {
        setWallet(response.wallet);
        saveCircleWorkerWallet(response.wallet);
        return response.wallet;
      }
    } catch (error) {
      if (error.status !== 401) setMessage({ tone: "error", text: error.message });
    }
    setWallet(null);
    return null;
  }, []);

  const completeLogin = useCallback(async (error, result) => {
    if (error || !result?.userToken || !result?.encryptionKey) {
      setBusy("");
      setMessage({ tone: "error", text: error?.message || "Circle authentication did not return a usable session." });
      return;
    }
    const credentials = { userToken: result.userToken, encryptionKey: result.encryptionKey };
    saveChallengeAuthentication(credentials);
    clearCircleFlow();
    setAuthCredentials(credentials);
    try {
      const response = await circleApi.completeWorkerSession({ userToken: result.userToken, refreshToken: result.refreshToken });
      setSession(response.session);
      await refreshWallet();
      setMessage({ tone: "success", text: "Worker authentication complete." });
    } catch (completionError) {
      setMessage({ tone: "error", text: completionError.message });
    } finally { setBusy(""); }
  }, [refreshWallet]);

  const initializeSdk = useCallback(async (status, flow = getSavedCircleFlow()) => {
    if (status?.wallets?.status !== "configured" || !status.publicConfiguration?.appId) return null;
    const sdk = await getCircleSdk({
      appId: status.publicConfiguration.appId,
      flow,
      onLoginComplete: (error, result) => { void completeLogin(error, result); },
    });
    sdkRef.current = sdk;
    return sdk;
  }, [completeLogin]);

  const loadData = useCallback(async () => {
    setBusy("load");
    try {
      const [status, workerSession, liveDashboard] = await Promise.all([
        circleApi.status(),
        circleApi.workerSession(),
        loadV1Dashboard(),
      ]);
      setCircleStatus(status);
      setSession(workerSession.session);
      setDashboard(liveDashboard);
      await initializeSdk(status);
      if (workerSession.session?.authenticated) await refreshWallet();
      if (claimId) setRecord(await loadV1Claim(claimId));
    } catch (error) {
      setMessage({ tone: "error", text: error.message });
    } finally { setBusy(""); }
  }, [claimId, initializeSdk, refreshWallet]);

  useEffect(() => { void loadData(); }, [loadData]);

  const authenticate = async (method) => {
    setBusy(method);
    try {
      const sdk = sdkRef.current ?? await initializeSdk(circleStatus);
      if (!sdk) throw new Error("Circle is not configured for worker authentication.");
      const deviceId = await sdk.getDeviceId();
      const flow = await circleApi.startWorkerSession({ method, deviceId, ...(method === "email_otp" ? { email: email.trim() } : {}) });
      saveCircleFlow(flow);
      const configuredSdk = await initializeSdk(circleStatus, flow);
      if (method === "google") await configuredSdk.performLogin("Google");
      else configuredSdk.verifyOtp();
    } catch (error) {
      setBusy("");
      setMessage({ tone: "error", text: error.message });
    }
  };

  const createWallet = async () => {
    setBusy("wallet");
    try {
      const response = await circleApi.createWorkerWallet();
      if (response.status === "ready") {
        setWallet(response.wallet);
        saveCircleWorkerWallet(response.wallet);
      } else {
        if (!authCredentials) throw new Error("Re-authenticate so Circle can approve wallet creation on this device.");
        const sdk = sdkRef.current ?? await initializeSdk(circleStatus);
        sdk.setAuthentication(authCredentials);
        await new Promise((resolve, reject) => sdk.execute(response.challengeId, (error) => error ? reject(error) : resolve()));
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        if (!await refreshWallet()) throw new Error("Circle accepted the challenge, but the wallet is not indexed yet.");
      }
      setMessage({ tone: "success", text: "Circle Arc Testnet worker wallet is ready." });
    } catch (error) { setMessage({ tone: "error", text: error.message }); }
    finally { setBusy(""); }
  };

  const pollOperation = async (operationId) => {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
      const mapped = mapWorkerTransactionStatus(await circleApi.purchaseAdvanceStatus(operationId));
      setTransaction(mapped);
      if (mapped.state === "transaction_confirmed") {
        setMessage({ tone: "success", text: "Worker payout confirmed on Arc." });
        setRecord(await loadV1Claim(claimId));
        return;
      }
      if (["transaction_failed", "transaction_timed_out"].includes(mapped.state)) return;
    }
    setTransaction({ state: "transaction_timed_out", errorReason: "Confirmation polling timed out. No receipt is shown until Arc verification succeeds." });
  };

  const getPaidNow = async () => {
    setBusy("advance");
    setTransaction({ state: "preparing" });
    try {
      if (!authCredentials) throw new Error("Re-authenticate with Circle so you can approve this payout on the current device.");
      const prepared = await circleApi.preparePurchaseAdvance({ claimId, minimumAdvanceAmount: workerQuote(record.claim, record.platform).advanceUnits.toString() });
      const sdk = sdkRef.current ?? await initializeSdk(circleStatus);
      sdk.setAuthentication(authCredentials);
      setTransaction({ state: "awaiting_approval" });
      const approved = await executeChallenge(sdk, prepared.challengeId, authCredentials);
      const transactionId = approved.transactionId ?? prepared.challengeId;
      await circleApi.bindPurchaseAdvance(prepared.operationId, transactionId);
      setTransaction({ state: "transaction_pending" });
      await pollOperation(prepared.operationId);
    } catch (error) {
      const rejected = /reject|denied|cancel/i.test(error.message);
      const liquidity = ["insufficient_accounted_liquidity", "insufficient_actual_liquidity"].includes(error.payload?.status);
      setTransaction({ state: liquidity ? "insufficient_liquidity" : rejected ? "challenge_rejected" : "transaction_failed", errorReason: error.message, txHash: null, explorerUrl: null });
      setMessage({ tone: "error", text: error.message });
    } finally { setBusy(""); }
  };

  const logout = async () => {
    try { await circleApi.logoutWorker(); } catch { /* Browser cleanup remains valid. */ }
    clearCircleFlow();
    clearChallengeAuthentication();
    clearCircleWorkerWallet();
    setAuthCredentials(null);
    setSession({ authenticated: false });
    setWallet(null);
  };

  const eligibility = record ? deriveWorkerClaimState({
    circleConfigured: circleStatus?.wallets?.status === "configured",
    wallet,
    claim: record.claim,
    purchase: record.purchase,
    platform: record.platform,
    nowSeconds: dashboard?.blockTimestamp ?? BigInt(Math.floor(Date.now() / 1000)),
  }) : "loading";

  return (
    <>
      <header className="page-header v1-page-header v1-worker-header">
        <div className="page-title-row"><div><h1>{claimId ? "Instant payout" : "Worker earnings"}</h1><p>Certified work · user-controlled Circle wallet · Arc Testnet</p></div><span className="mode-badge mode-live">V1.1 Live</span></div>
      </header>
      <WorkerSession
        circleStatus={circleStatus}
        session={session}
        wallet={wallet}
        email={email}
        setEmail={setEmail}
        busy={busy}
        onAuthenticate={authenticate}
        onCreateWallet={createWallet}
        onSeedGas={async () => {
          setBusy("seed");
          try { const result = await circleApi.seedWorkerGas(); setMessage({ tone: "success", text: result.seed?.reason || "Worker gas balance checked." }); }
          catch (error) { setMessage({ tone: error.status === 503 ? "neutral" : "error", text: error.message }); }
          finally { setBusy(""); }
        }}
        onLogout={logout}
        onCopy={async (value) => { await navigator.clipboard.writeText(value); showNotice("Worker address copied"); }}
      />
      <FlowMessage tone={message.tone}>{message.text}</FlowMessage>
      {busy === "load" && !dashboard ? <div className="v1-loading"><CircleNotch className="spin" /><span>Reading Fidra V1.1 on Arc…</span></div> : null}
      {!claimId && dashboard ? <WorkerClaimList claims={dashboard.claims} navigate={navigate} /> : null}
      {claimId && record ? <WorkerClaimDetail record={{ ...record, connectedWallet: wallet?.address }} eligibility={eligibility} transaction={transaction} onPayout={getPaidNow} busy={busy} /> : null}
    </>
  );
}
