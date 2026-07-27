import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle, Copy, WarningCircle } from "@phosphor-icons/react";
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
import {
  clearCircleVendorWallet,
  loadVendorMode,
  saveCircleVendorWallet,
  saveVendorMode,
} from "../lib/circle/vendorIdentity.js";
import { formatUsdcUnits, mapBuyClaimStatus, quoteDeadline } from "../lib/circle/buyClaim.js";
import { formatTimestamp, truncateHex } from "../lib/contracts/types.js";

const STATUS_POLL_INTERVAL_MS = 2500;
const STATUS_POLL_MAX_ATTEMPTS = 40;

function statusLabel(status) {
  if (status === "configured") return "Configured";
  if (status === "error") return "Error";
  if (status === "planned") return "Planned";
  return "Not configured";
}

function IntegrationCard({ name, status, children }) {
  return (
    <article className="managed-integration-card">
      <div><h3>{name}</h3><span className={`managed-status managed-status-${status}`}>{statusLabel(status)}</span></div>
      <p>{children}</p>
    </article>
  );
}

function StepHeading({ number, title, state }) {
  return (
    <div className="onboarding-step-heading">
      <span>{number}</span>
      <div><h2>{title}</h2><small>{state}</small></div>
    </div>
  );
}

function ActionMessage({ state }) {
  if (!state.message) return null;
  return (
    <div className={`wallet-flow-message wallet-flow-${state.tone}`} role={state.tone === "error" ? "alert" : "status"}>
      {state.tone === "success" ? <CheckCircle aria-hidden="true" /> : state.tone === "error" ? <WarningCircle aria-hidden="true" /> : null}
      <span>{state.message}</span>
    </div>
  );
}

function VendorOnboarding({ showNotice }) {
  const sdkRef = useRef(null);
  const [circleStatus, setCircleStatus] = useState(null);
  const [serverState, setServerState] = useState("loading");
  const [session, setSession] = useState({ authenticated: false });
  const [wallet, setWallet] = useState(null);
  const [authCredentials, setAuthCredentials] = useState(getChallengeAuthentication);
  const [sdkState, setSdkState] = useState("idle");
  const [email, setEmail] = useState("");
  const [vendorMode, setVendorMode] = useState(loadVendorMode);
  const [actionState, setActionState] = useState({ tone: "neutral", message: "" });
  const [busyAction, setBusyAction] = useState("");
  const [sellRequestId, setSellRequestId] = useState("");
  const [quote, setQuote] = useState(null);
  const [sale, setSale] = useState({ state: "idle", txHash: null, explorerUrl: null, errorReason: null });

  const refreshWallet = useCallback(async () => {
    try {
      const result = await circleApi.getWallet();
      if (result.status === "ready") {
        setWallet(result.wallet);
        saveCircleVendorWallet(result.wallet);
        return result.wallet;
      }
      setWallet(null);
      return null;
    } catch (error) {
      if (error.status !== 401) setActionState({ tone: "error", message: error.message });
      return null;
    }
  }, []);

  const completeLogin = useCallback(async (error, result) => {
    if (error || !result?.userToken || !result?.encryptionKey) {
      setBusyAction("");
      setActionState({ tone: "error", message: error?.message || "Circle authentication did not return a usable session." });
      return;
    }
    const credentials = { userToken: result.userToken, encryptionKey: result.encryptionKey };
    saveChallengeAuthentication(credentials);
    clearCircleFlow();
    setAuthCredentials(credentials);
    try {
      const response = await circleApi.completeSession({
        userToken: result.userToken,
        refreshToken: result.refreshToken,
      });
      setSession(response.session);
      setActionState({ tone: "success", message: "Vendor authentication complete. Create or retrieve the Arc Testnet EOA wallet next." });
      await refreshWallet();
    } catch (completionError) {
      setActionState({ tone: "error", message: completionError.message });
    } finally {
      setBusyAction("");
    }
  }, [refreshWallet]);

  const initializeSdk = useCallback(async (status, flow = getSavedCircleFlow()) => {
    if (status?.wallets?.status !== "configured" || !status.publicConfiguration?.appId) return null;
    setSdkState("loading");
    try {
      const sdk = await getCircleSdk({
        appId: status.publicConfiguration.appId,
        flow,
        onLoginComplete: (error, result) => { void completeLogin(error, result); },
      });
      sdkRef.current = sdk;
      setSdkState("ready");
      return sdk;
    } catch {
      setSdkState("error");
      setActionState({ tone: "error", message: "Circle’s browser wallet SDK could not be initialized." });
      return null;
    }
  }, [completeLogin]);

  const loadPage = useCallback(async () => {
    setServerState("loading");
    try {
      const [status, sessionResponse] = await Promise.all([circleApi.status(), circleApi.session()]);
      setCircleStatus(status);
      setSession(sessionResponse.session);
      setServerState("ready");
      await initializeSdk(status);
      if (sessionResponse.session?.authenticated) await refreshWallet();
    } catch (error) {
      setServerState("error");
      setActionState({ tone: "error", message: error.message });
    }
  }, [initializeSdk, refreshWallet]);

  useEffect(() => { void loadPage(); }, [loadPage]);

  const startAuthentication = async (method) => {
    const sdk = sdkRef.current ?? await initializeSdk(circleStatus);
    if (!sdk) return;
    setBusyAction(method);
    setActionState({ tone: "neutral", message: method === "google" ? "Preparing Google sign-in…" : "Requesting an email OTP…" });
    try {
      const deviceId = await sdk.getDeviceId();
      const flow = await circleApi.startSession({
        method,
        deviceId,
        ...(method === "email_otp" ? { email: email.trim() } : {}),
      });
      saveCircleFlow(flow);
      const configuredSdk = await initializeSdk(circleStatus, flow);
      if (method === "google") {
        setActionState({ tone: "neutral", message: "Continue in Circle’s Google sign-in window." });
        await configuredSdk.performLogin("Google");
      } else {
        setActionState({ tone: "neutral", message: "Enter the emailed code in Circle’s verification window." });
        configuredSdk.verifyOtp();
      }
    } catch (error) {
      setBusyAction("");
      setActionState({ tone: "error", message: error.message });
    }
  };

  const createWallet = async () => {
    setBusyAction("wallet");
    setActionState({ tone: "neutral", message: "Checking for an existing Arc Testnet EOA…" });
    try {
      const result = await circleApi.createWallet();
      if (result.status === "ready") {
        setWallet(result.wallet);
        saveCircleVendorWallet(result.wallet);
        clearChallengeAuthentication();
        setAuthCredentials(null);
        setActionState({ tone: "success", message: "Existing Circle Arc Testnet EOA loaded." });
        return;
      }
      if (result.status !== "challenge_required" || !result.challengeId) throw new Error("Circle did not return a wallet challenge.");
      if (!authCredentials?.userToken || !authCredentials?.encryptionKey) {
        throw new Error("Re-authenticate with Google or email so Circle can approve the wallet challenge on this device.");
      }
      const sdk = sdkRef.current ?? await initializeSdk(circleStatus);
      sdk.setAuthentication(authCredentials);
      setActionState({ tone: "neutral", message: "Approve Circle’s EOA wallet creation challenge." });
      await new Promise((resolve, reject) => {
        sdk.execute(result.challengeId, (challengeError) => challengeError ? reject(challengeError) : resolve());
      });
      await new Promise((resolve) => window.setTimeout(resolve, 1800));
      const createdWallet = await refreshWallet();
      if (!createdWallet) throw new Error("Circle accepted the challenge, but the EOA is not indexed yet. Refresh wallet status shortly.");
      clearChallengeAuthentication();
      setAuthCredentials(null);
      setActionState({ tone: "success", message: "Circle created the Arc Testnet EOA wallet." });
    } catch (error) {
      setActionState({ tone: "error", message: error.message });
    } finally {
      setBusyAction("");
    }
  };

  const seedGas = async () => {
    setBusyAction("seed");
    setActionState({ tone: "neutral", message: "Checking and funding the Arc native gas balance…" });
    try {
      const result = await circleApi.seedGas();
      const seed = result.seed ?? result;
      setWallet((current) => ({ ...current, gasSeed: seed }));
      setActionState({
        tone: "success",
        message: seed.status === "confirmed" ? "Arc testnet gas seed confirmed." : seed.reason || "The wallet already has sufficient Arc native USDC for the configured seed threshold.",
      });
    } catch (error) {
      setActionState({ tone: error.status === 503 ? "neutral" : "error", message: error.message });
    } finally {
      setBusyAction("");
    }
  };

  const logout = async () => {
    try { await circleApi.logout(); } catch { /* Local cleanup still applies. */ }
    clearCircleFlow();
    clearChallengeAuthentication();
    clearCircleVendorWallet();
    setAuthCredentials(null);
    setSession({ authenticated: false });
    setWallet(null);
    setVendorMode("metamask");
    setActionState({ tone: "neutral", message: "Vendor session cleared from this browser." });
  };

  const selectVendorMode = (mode) => {
    if (mode === "circle" && !wallet?.address) {
      setActionState({ tone: "error", message: "Create or retrieve a Circle Arc Testnet EOA before selecting Circle Vendor Wallet mode." });
      return;
    }
    saveVendorMode(mode);
    setVendorMode(mode);
  };

  const copyAddress = async () => {
    if (!wallet?.address) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      showNotice("Vendor EOA address copied");
    } catch {
      showNotice(wallet.address);
    }
  };

  const pollSaleStatus = useCallback(async (transactionId) => {
    for (let attempt = 0; attempt < STATUS_POLL_MAX_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, STATUS_POLL_INTERVAL_MS));
      let payload;
      try {
        payload = await circleApi.buyClaimStatus(transactionId);
      } catch (error) {
        setActionState({ tone: "error", message: error.message });
        continue;
      }
      const mapped = mapBuyClaimStatus(payload);
      if (mapped.state === "confirmed") {
        setSale({ state: "confirmed", txHash: mapped.txHash, explorerUrl: mapped.explorerUrl, errorReason: null });
        setActionState({ tone: "success", message: "Claim sale confirmed on Arc." });
        return;
      }
      if (mapped.state === "failed") {
        setSale({ state: "failed", txHash: null, explorerUrl: null, errorReason: mapped.errorReason });
        setActionState({ tone: "error", message: mapped.errorReason || "Circle reported the claim sale failed." });
        return;
      }
    }
    setActionState({ tone: "neutral", message: "The sale is still pending on Circle. Check the transaction later; no receipt is shown until it confirms." });
  }, []);

  const sellClaim = async () => {
    const parsedId = Number(sellRequestId.trim());
    if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
      setActionState({ tone: "error", message: "Enter the locked claim (spend) id you want to sell." });
      return;
    }
    setBusyAction("sell");
    setSale({ state: "preparing", txHash: null, explorerUrl: null, errorReason: null });
    setActionState({ tone: "neutral", message: "Validating the locked claim and preparing a Circle challenge…" });
    try {
      const prepared = await circleApi.prepareBuyClaim({ requestId: parsedId, deadline: quoteDeadline() });
      if (prepared.status !== "challenge_required" || !prepared.challengeId) {
        throw new Error("Circle did not return a transaction challenge for this claim.");
      }
      setQuote(prepared);
      if (!authCredentials?.userToken || !authCredentials?.encryptionKey) {
        throw new Error("Re-authenticate with email or Google so Circle can request your approval on this device.");
      }
      const sdk = sdkRef.current ?? await initializeSdk(circleStatus);
      if (!sdk) throw new Error("Circle’s browser SDK is not ready.");
      setSale({ state: "awaiting_approval", txHash: null, explorerUrl: null, errorReason: null });
      setActionState({ tone: "neutral", message: "Approve the claim sale in Circle’s confirmation window." });
      const executed = await executeChallenge(sdk, prepared.challengeId, authCredentials);
      const transactionId = executed.transactionId ?? prepared.challengeId;
      setSale({ state: "pending", txHash: null, explorerUrl: null, errorReason: null });
      setActionState({ tone: "neutral", message: "Transaction submitted. Waiting for Arc confirmation…" });
      await pollSaleStatus(transactionId);
    } catch (error) {
      // A prepare-time rejection carries a structured payee_mismatch payload; surface both addresses, never fall back.
      const payload = error.payload;
      if (payload?.status === "payee_mismatch") {
        setSale({ state: "payee_mismatch", currentPayee: payload.currentPayee, walletAddress: payload.walletAddress });
        setActionState({ tone: "error", message: "This wallet is not the current payee of the claim. buyClaim is disabled." });
      } else if (payload?.status && payload.status !== "error") {
        setSale({ state: payload.status, txHash: null, explorerUrl: null, errorReason: null });
        setActionState({ tone: "error", message: error.message });
      } else {
        setSale({ state: "failed", txHash: null, explorerUrl: null, errorReason: error.message });
        setActionState({ tone: "error", message: error.message });
      }
    } finally {
      setBusyAction("");
    }
  };

  const walletsConfigured = circleStatus?.wallets?.status === "configured";
  const gasSeedConfigured = circleStatus?.gasSeed?.status === "configured";
  const seedStatus = wallet?.gasSeed?.status;
  const gasReady = ["confirmed", "not_needed", "already_seeded"].includes(seedStatus);
  const vendorReady = Boolean(wallet?.address && gasReady);
  const circleModeSelected = vendorMode === "circle" && Boolean(wallet?.address);

  return (
    <>
      <header className="page-header vendor-onboarding-header">
        <div className="page-title-row">
          <div><h1>Vendor onboarding</h1><p>Create a user-controlled EOA on Arc without requiring MetaMask.</p></div>
          <span className={`mode-badge ${walletsConfigured ? "mode-live" : ""}`}>{walletsConfigured ? "Circle configured" : "Circle not configured"}</span>
        </div>
      </header>

      <section className="managed-wallet-intro" aria-labelledby="wallet-boundary-heading">
        <div><span>Identity boundary</span><h2 id="wallet-boundary-heading">Authentication and account type are separate choices</h2></div>
        <p>Google or email authenticates the vendor. Circle must still create an <strong>EOA</strong>, because Fidra authorizes claim sales through <code>msg.sender</code>. The registered vendor and initial payee must be this exact EOA address.</p>
      </section>

      <section className="managed-integrations" aria-labelledby="managed-integrations-heading">
        <div className="section-heading-row"><div><span>Integration status</span><h2 id="managed-integrations-heading">Circle and Arc services</h2></div><button className="button-link" type="button" onClick={loadPage} disabled={serverState === "loading"}>Refresh status</button></div>
        <div className="managed-integration-grid">
          <IntegrationCard name="User-Controlled Wallets" status={circleStatus?.wallets?.status || (serverState === "error" ? "error" : "not_configured")}>Arc Testnet EOA target. API secrets remain server-side.</IntegrationCard>
          <IntegrationCard name="Vendor authentication" status={circleStatus?.authentication?.status || "not_configured"}>Google and email OTP implemented. PIN-only onboarding is not enabled.</IntegrationCard>
          <IntegrationCard name="Gas seed" status={circleStatus?.gasSeed?.status || "not_configured"}>Capped testnet-only Arc native USDC funding.</IntegrationCard>
          <IntegrationCard name="Paymaster" status="planned">Planned. Normal Arc transaction fees are the fallback.</IntegrationCard>
          <IntegrationCard name="Gateway" status="planned">Planned. Manual Arc testnet funding remains the fallback.</IntegrationCard>
          <IntegrationCard name="CCTP" status="planned">Planned for a future vendor or vault withdrawal path.</IntegrationCard>
        </div>
      </section>

      <div className="vendor-onboarding-grid">
        <section className="onboarding-step" aria-labelledby="vendor-sign-in-heading">
          <StepHeading number="1" title="Sign in" state={session.authenticated ? "Authenticated" : "Required"} />
          <p>Sign in to create your Fidra vendor wallet. Circle keeps the user keyshare under the vendor’s control.</p>
          {walletsConfigured ? (
            <div className="vendor-auth-options">
              <button className="button-outline" type="button" disabled={busyAction || sdkState !== "ready" || circleStatus?.authentication?.google !== "configured"} onClick={() => startAuthentication("google")}>{busyAction === "google" ? "Opening Google…" : "Continue with Google"}</button>
              <form onSubmit={(event) => { event.preventDefault(); void startAuthentication("email_otp"); }}>
                <label htmlFor="vendor-email">Vendor email</label>
                <div><input id="vendor-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="vendor@example.com" /><button className="button-outline" type="submit" disabled={busyAction || sdkState !== "ready"}>{busyAction === "email_otp" ? "Sending OTP…" : "Email me a code"}</button></div>
                <small>Email OTP also requires SMTP to be configured in the Circle Console.</small>
              </form>
              <p className="auth-method-note"><strong>PIN:</strong> supported by Circle, but not enabled here because PIN-only setup does not establish the vendor identity Fidra needs.</p>
            </div>
          ) : (
            <div className="configuration-empty-state"><strong>Circle Wallets are disabled</strong><span>Configure the server environment to enable Google or email onboarding. MetaMask remains the fallback.</span></div>
          )}
          {session.authenticated && <button className="button-link" type="button" onClick={logout}>Sign out vendor session</button>}
        </section>

        <section className="onboarding-step" aria-labelledby="create-vendor-wallet-heading">
          <StepHeading number="2" title="Create wallet" state={wallet ? "EOA created" : session.authenticated ? "Ready to create" : "Sign in first"} />
          <p>Creates or retrieves one User-Controlled wallet with <code>accountType: EOA</code> on <code>ARC-TESTNET</code>.</p>
          <button className="button-primary" type="button" disabled={!session.authenticated || busyAction === "wallet" || !walletsConfigured} onClick={createWallet}>{busyAction === "wallet" ? "Creating EOA…" : wallet ? "Refresh Arc Testnet EOA" : "Create Arc Testnet EOA wallet"}</button>
          {wallet && (
            <dl className="vendor-wallet-details">
              <div><dt>Wallet ID</dt><dd><code>{wallet.id}</code></dd></div>
              <div><dt>Address</dt><dd><code>{truncateHex(wallet.address)}</code><button className="icon-button" type="button" aria-label="Copy vendor EOA address" onClick={copyAddress}><Copy aria-hidden="true" /></button></dd></div>
              <div><dt>Network</dt><dd>{wallet.blockchain}</dd></div>
              <div><dt>Account type</dt><dd><strong>{wallet.accountType}</strong></dd></div>
            </dl>
          )}
        </section>

        <section className="onboarding-step" aria-labelledby="vendor-gas-seed-heading">
          <StepHeading number="3" title="Gas seed" state={gasReady ? "Funded" : gasSeedConfigured ? "Available" : "Manual funding"} />
          <p>Your vendor wallet needs a small amount of Arc native testnet USDC to pay gas for selling a claim. This is separate from Fidra’s 6-decimal ERC-20 USDC accounting.</p>
          <button className="button-primary" type="button" disabled={!wallet || !gasSeedConfigured || busyAction === "seed"} onClick={seedGas}>{busyAction === "seed" ? "Seeding gas…" : "Seed testnet gas"}</button>
          {!gasSeedConfigured && <div className="manual-funding-note"><strong>Manual funding required</strong><span>Send a small amount of Arc native testnet USDC to the EOA using the Arc Console Faucet or another funded Arc Testnet wallet.</span></div>}
          {wallet?.gasSeed?.transactionHash && <a className="evidence-link" href={wallet.gasSeed.explorerUrl} target="_blank" rel="noreferrer">Seed transaction {truncateHex(wallet.gasSeed.transactionHash)} ↗</a>}
        </section>

        <section className={`onboarding-step vendor-ready-step ${vendorReady ? "is-ready" : ""}`} aria-labelledby="vendor-ready-heading">
          <StepHeading number="4" title={vendorReady ? "Vendor wallet ready" : "Finish vendor setup"} state={vendorReady ? "Ready" : wallet ? "Gas funding required" : "Wallet required"} />
          {wallet ? <><p><code>{wallet.address}</code></p><p>{vendorReady ? "Use this address as the vendor and initial payee in a mandate. It can sell a locked claim once Circle contract execution is implemented." : "The EOA exists, but do not mark it ready until native gas funding is confirmed."}</p></> : <p>Create the Circle Arc Testnet EOA before registering a vendor address.</p>}
          <div className="vendor-next-actions"><span>Use this address as vendor/payee in a mandate</span><span>Sell a locked claim when available</span></div>
        </section>
      </div>

      <ActionMessage state={actionState} />

      <section className="vendor-identity-panel" aria-labelledby="vendor-identity-heading">
        <div className="section-heading-row"><div><span>Mandate setup</span><h2 id="vendor-identity-heading">Vendor identity mode</h2></div></div>
        <p>Fidra’s contracts authorize by <code>msg.sender</code>, so the vendor/payee address must be the exact EOA wallet that will later sell the claim.</p>
        <div className="vendor-mode-options">
          <label className={!circleModeSelected ? "is-selected" : ""}><input type="radio" name="vendor-mode" checked={!circleModeSelected} onChange={() => selectVendorMode("metamask")} /><span><strong>MetaMask one-wallet mode</strong><small>Existing sandbox fallback</small></span></label>
          <label className={`${circleModeSelected ? "is-selected" : ""} ${!wallet ? "is-disabled" : ""}`}><input type="radio" name="vendor-mode" checked={circleModeSelected} disabled={!wallet} onChange={() => selectVendorMode("circle")} /><span><strong>Circle Vendor Wallet mode</strong><small>{wallet ? wallet.address : "Create a Circle EOA first"}</small></span></label>
        </div>
        {!wallet && <div className="configuration-empty-state vendor-mode-warning"><strong>Circle Vendor Wallet mode unavailable</strong><span>No authenticated Circle EOA is loaded. Fidra will not substitute a demo or cached address.</span></div>}
        {circleModeSelected && <div className="vendor-address-binding"><span>Allowed vendor and initial payee</span><code>{wallet.address}</code><strong>Exact EOA required</strong></div>}
      </section>

      <section className="circle-transaction-boundary" aria-labelledby="circle-transactions-heading">
        <div><span>Sell a locked claim</span><h2 id="circle-transactions-heading">User-approved <code>buyClaim</code></h2></div>
        <p>Fidra prepares a Circle contract-execution challenge for <code>AdvanceVault.buyClaim</code>. You approve it in Circle’s window; Fidra never signs for you and never fabricates a receipt.</p>

        {!vendorReady ? (
          <div className="configuration-empty-state">
            <strong>{!walletsConfigured ? "Circle not configured" : !wallet ? "Wallet required" : "Funding required"}</strong>
            <span>{!walletsConfigured
              ? "Configure Circle credentials to enable user-controlled claim sales."
              : !wallet
                ? "Create the Arc Testnet EOA before selling a claim."
                : "Confirm Arc native gas funding before selling a claim."}</span>
          </div>
        ) : (
          <div className="buy-claim-flow">
            <div className="buy-claim-input">
              <label htmlFor="sell-request-id">Locked claim (spend) id</label>
              <div>
                <input id="sell-request-id" inputMode="numeric" value={sellRequestId} placeholder="e.g. 2" onChange={(event) => setSellRequestId(event.target.value)} />
                <button className="button-primary" type="button" disabled={busyAction === "sell"} onClick={sellClaim}>{busyAction === "sell" ? "Preparing…" : "Sell claim to AdvanceVault"}</button>
              </div>
              <small>The claim’s current payee must be this exact EOA. Only <code>Locked</code> claims are eligible.</small>
            </div>

            {quote && (
              <dl className="buy-claim-quote">
                <div><dt>Face value</dt><dd>{formatUsdcUnits(quote.faceAmount)} USDC</dd></div>
                <div><dt>Discount</dt><dd>{(quote.discountBps / 100).toString()}%</dd></div>
                <div><dt>Advance now</dt><dd><strong>{formatUsdcUnits(quote.advanceAmount)} USDC</strong></dd></div>
                <div><dt>Vault spread</dt><dd>{formatUsdcUnits(quote.expectedSpread)} USDC</dd></div>
                <div><dt>Maturity</dt><dd>{formatTimestamp(quote.releaseDueAt)}</dd></div>
              </dl>
            )}

            {sale.state === "payee_mismatch" && (
              <div className="wallet-flow-message wallet-flow-error" role="alert">
                <WarningCircle aria-hidden="true" />
                <div>
                  <strong>Payee mismatch — buyClaim disabled</strong>
                  <p>Connected EOA: <code>{sale.walletAddress}</code></p>
                  <p>Current claim payee: <code>{sale.currentPayee}</code></p>
                </div>
              </div>
            )}
            {sale.state === "awaiting_approval" && <div className="wallet-flow-message wallet-flow-neutral" role="status"><span>Awaiting your approval in Circle’s window.</span></div>}
            {sale.state === "pending" && <div className="wallet-flow-message wallet-flow-neutral" role="status"><span>Transaction pending on Arc. No receipt is shown until it confirms.</span></div>}
            {sale.state === "confirmed" && (
              <div className="wallet-flow-message wallet-flow-success" role="status">
                <CheckCircle aria-hidden="true" />
                <div><strong>Claim sale confirmed</strong>{sale.explorerUrl && <p><a className="evidence-link" href={sale.explorerUrl} target="_blank" rel="noreferrer">Transaction {truncateHex(sale.txHash)} ↗</a></p>}</div>
              </div>
            )}
            {sale.state === "failed" && (
              <div className="wallet-flow-message wallet-flow-error" role="alert">
                <WarningCircle aria-hidden="true" />
                <span>{sale.errorReason || "The claim sale failed. No transaction hash was produced."}</span>
              </div>
            )}
          </div>
        )}

        <p className="auth-method-note"><strong>Still stubbed:</strong> vendor <code>submitProof</code> and agent <code>requestSpend</code> return <code>501 not_implemented</code>.</p>
      </section>
    </>
  );
}

export default VendorOnboarding;
