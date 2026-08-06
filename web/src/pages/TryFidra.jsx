import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowSquareOut, Check, CircleNotch, Copy, ShieldCheck, WarningCircle, Wallet } from "@phosphor-icons/react";
import { PrimaryButton } from "../components.jsx";
import { circleApi } from "../lib/circle/api.js";
import {
  clearChallengeAuthentication, clearCircleFlow, executeChallenge,
  getChallengeAuthentication, getCircleSdk, getSavedCircleFlow,
  saveChallengeAuthentication, saveCircleFlow,
} from "../lib/circle/sdk.js";
import { mapWorkerTransactionStatus } from "../lib/circle/workerPayout.js";
import { formatUsdc, truncateHex } from "../lib/contracts/types.js";
import { demoRecoveryAction, demoWorkflowFlags } from "../lib/v1/demoFlow.js";

const sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function ReceiptLink({ receipt, label }) {
  if (!receipt?.explorerUrl) return null;
  return <a className="try-receipt" href={receipt.explorerUrl} target="_blank" rel="noreferrer"><span>{label}</span><code>{truncateHex(receipt.transactionHash, 10, 8)}</code><ArrowSquareOut /></a>;
}

function Step({ complete, current, title, detail, children }) {
  return (
    <li className={`try-step ${complete ? "is-complete" : ""} ${current ? "is-current" : ""}`}>
      <span className="try-step-mark" aria-hidden="true">{complete ? <Check /> : <span />}</span>
      <div><strong>{title}</strong><p>{detail}</p>{children}</div>
    </li>
  );
}

function ErrorMessage({ message }) {
  return message ? <div className="v1-flow-message v1-flow-error" role="alert"><WarningCircle /><span>{message}</span></div> : null;
}

export default function TryFidra({ showNotice }) {
  const sdkRef = useRef(null);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState(null);
  const [session, setSession] = useState({ authenticated: false });
  const [wallet, setWallet] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [email, setEmail] = useState("");
  const [credentials, setCredentials] = useState(getChallengeAuthentication);
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");

  const refreshWorkflow = useCallback(async () => {
    const response = await circleApi.demoWorkflow();
    setWorkflow(response.workflow);
    if (response.workflow) setStarted(true);
    return response.workflow;
  }, []);

  const refreshWallet = useCallback(async () => {
    const response = await circleApi.getWorkerWallet();
    if (response.status === "ready") { setWallet(response.wallet); return response.wallet; }
    setWallet(null);
    return null;
  }, []);

  const completeLogin = useCallback(async (loginError, result) => {
    if (loginError || !result?.userToken || !result?.encryptionKey) {
      setError(loginError?.message || "Circle authentication did not complete."); setBusy(""); return;
    }
    const nextCredentials = { userToken: result.userToken, encryptionKey: result.encryptionKey };
    saveChallengeAuthentication(nextCredentials);
    clearCircleFlow();
    setCredentials(nextCredentials);
    try {
      const response = await circleApi.completeWorkerSession({ userToken: result.userToken, refreshToken: result.refreshToken });
      setSession(response.session);
      const nextWallet = await refreshWallet();
      if (nextWallet) await refreshWorkflow();
    } catch (nextError) { setError(nextError.message); }
    finally { setBusy(""); }
  }, [refreshWallet, refreshWorkflow]);

  const initializeSdk = useCallback(async (circleStatus, flow = getSavedCircleFlow()) => {
    if (circleStatus?.wallets?.status !== "configured" || !circleStatus.publicConfiguration?.appId) return null;
    const sdk = await getCircleSdk({ appId: circleStatus.publicConfiguration.appId, flow, onLoginComplete: (sdkError, result) => { void completeLogin(sdkError, result); } });
    sdkRef.current = sdk;
    return sdk;
  }, [completeLogin]);

  useEffect(() => {
    void (async () => {
      try {
        const [circleStatus, sessionResponse] = await Promise.all([circleApi.status(), circleApi.workerSession()]);
        setStatus(circleStatus); setSession(sessionResponse.session);
        await initializeSdk(circleStatus);
        if (sessionResponse.session?.authenticated) {
          const nextWallet = await refreshWallet();
          if (nextWallet) await refreshWorkflow();
        }
      } catch (loadError) { if (loadError.status !== 401) setError(loadError.message); }
      finally { setBusy(""); }
    })();
  }, [initializeSdk, refreshWallet, refreshWorkflow]);

  const authenticate = async () => {
    setBusy("auth"); setError("");
    try {
      const sdk = sdkRef.current ?? await initializeSdk(status);
      if (!sdk) throw new Error("Circle sandbox authentication is not configured.");
      const deviceId = await sdk.getDeviceId();
      const flow = await circleApi.startWorkerSession({ method: "email_otp", deviceId, email: email.trim() });
      saveCircleFlow(flow);
      (await initializeSdk(status, flow)).verifyOtp();
    } catch (nextError) { setError(nextError.message); setBusy(""); }
  };

  const createWallet = async () => {
    setBusy("wallet"); setError("");
    try {
      const response = await circleApi.createWorkerWallet();
      if (response.status !== "ready") {
        if (!credentials) throw new Error("Re-authenticate so Circle can approve wallet creation.");
        const sdk = sdkRef.current ?? await initializeSdk(status);
        sdk.setAuthentication(credentials);
        await new Promise((resolve, reject) => sdk.execute(response.challengeId, (sdkError) => sdkError ? reject(sdkError) : resolve()));
        await sleep(1_500);
      }
      const nextWallet = response.status === "ready" ? response.wallet : await refreshWallet();
      if (!nextWallet) throw new Error("Circle accepted wallet creation, but the wallet is not indexed yet.");
      setWallet(nextWallet);
      const startedWorkflow = await circleApi.startDemoWorkflow();
      setWorkflow(startedWorkflow.workflow);
    } catch (nextError) { setError(nextError.message); }
    finally { setBusy(""); }
  };

  const run = async (name, action) => {
    setBusy(name); setError("");
    try { const response = await action(); setWorkflow(response.workflow); return response; }
    catch (nextError) { setError(nextError.message); return null; }
    finally { setBusy(""); }
  };

  const settle = useCallback(async () => {
    setBusy("settlement"); setError("");
    try { await sleep(900); const result = await circleApi.settleDemo(); setWorkflow(result.workflow); }
    catch (nextError) { setError(nextError.message); }
    finally { setBusy(""); }
  }, []);

  const pollAdvance = async (operationId) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await sleep(2_500);
      const mapped = mapWorkerTransactionStatus(await circleApi.purchaseAdvanceStatus(operationId));
      if (mapped.state === "transaction_confirmed") { await refreshWorkflow(); await settle(); return; }
      if (["transaction_failed", "transaction_timed_out"].includes(mapped.state)) throw new Error(mapped.errorReason || "The Circle transaction did not confirm.");
    }
    throw new Error("Arc confirmation is still pending. Refresh to continue verification.");
  };

  const getPaid = async () => {
    setBusy("advance"); setError("");
    try {
      if (!credentials) throw new Error("Re-authenticate with Circle before approving the payout.");
      const claimId = workflow?.claim?.id;
      const expectedAdvance = (BigInt(workflow.claim.faceValue) * 9_900n / 10_000n).toString();
      const prepared = await circleApi.preparePurchaseAdvance({ claimId, minimumAdvanceAmount: expectedAdvance });
      setWorkflow((current) => ({ ...current, state: "awaiting_approval", advance: { ...current.advance, operationId: prepared.operationId, challengeId: prepared.challengeId } }));
      const sdk = sdkRef.current ?? await initializeSdk(status);
      const approved = await executeChallenge(sdk, prepared.challengeId, credentials);
      await circleApi.bindPurchaseAdvance(prepared.operationId, approved.transactionId ?? prepared.challengeId);
      setWorkflow((current) => ({ ...current, state: "arc_pending" }));
      await pollAdvance(prepared.operationId);
    } catch (nextError) { setError(nextError.message); }
    finally { setBusy(""); }
  };

  useEffect(() => {
    const recovery = demoRecoveryAction(workflow);
    if (workflow?.error?.message) setError(workflow.error.message);
    if (recovery === "poll_advance" && !busy) {
      setBusy("advance");
      void pollAdvance(workflow.advance.operationId).catch((nextError) => setError(nextError.message)).finally(() => setBusy(""));
    } else if (recovery === "settle" && !busy) void settle();
  // Recovery is intentionally driven only by durable state changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow?.state]);

  const { gasReady, claimReady, advanceReady, complete } = demoWorkflowFlags(workflow);

  if (!started && !session?.authenticated) return (
    <div className="try-shell">
      <div className="try-testnet-banner"><ShieldCheck />Arc Testnet · controlled public demo</div>
      <section className="try-intro">
        <div><p className="try-context">One task. One verified payout.</p><h1>Finish work today. Receive your earnings now.</h1><p>Complete a test task, receive certified earnings, and get paid early through a Circle-controlled wallet.</p></div>
        <PrimaryButton type="button" onClick={() => setStarted(true)}>Try Fidra</PrimaryButton>
        <dl><div><dt>No MetaMask</dt><dd>Sign in by email with Circle.</dd></div><div><dt>No repayment</dt><dd>The platform settles with Fidra.</dd></div><div><dt>Real receipts</dt><dd>Every successful step is verified on Arc.</dd></div></dl>
      </section>
    </div>
  );

  return (
    <div className="try-shell">
      <div className="try-testnet-banner"><ShieldCheck />Arc Testnet only · funds have no production value</div>
      <header className="try-header"><div><h1>Try an instant payout</h1><p>Circle approval, Arc verification, then automatic platform settlement.</p></div><span>{complete ? "Complete" : "Live demo"}</span></header>
      <div className="try-layout">
        <section className="try-action" aria-live="polite">
          {!session?.authenticated ? <>
            <h2>Sign in with Circle</h2><p>Use email OTP to create or retrieve your user-controlled Arc wallet.</p>
            <label htmlFor="try-email">Email address</label><input id="try-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" />
            <PrimaryButton type="button" loading={busy === "auth"} disabled={!email.trim() || Boolean(busy)} onClick={authenticate}>Request email code</PrimaryButton>
          </> : !wallet ? <>
            <h2>Prepare your Arc wallet</h2><p>Circle will retrieve your existing EOA or ask you to approve creation.</p>
            <PrimaryButton type="button" loading={busy === "wallet"} disabled={Boolean(busy)} onClick={createWallet}>Create or retrieve wallet</PrimaryButton>
          </> : !workflow ? <>
            <h2>Start your test</h2><p>Your wallet is ready. Fidra will create one recoverable demo session for it.</p>
            <PrimaryButton type="button" loading={busy === "workflow"} disabled={Boolean(busy)} onClick={() => run("workflow", circleApi.startDemoWorkflow)}>Start test</PrimaryButton>
          </> : !gasReady ? <>
            <h2>Prepare transaction gas</h2><p>Fidra checks your native USDC and makes one capped testnet top-up only when needed.</p>
            <PrimaryButton type="button" loading={busy === "gas"} disabled={Boolean(busy)} onClick={() => run("gas", circleApi.seedDemoGas)}>Check and fund gas</PrimaryButton>
          </> : !claimReady ? <>
            <h2>Complete the demo task</h2><p>Finishing creates one 0.10 USDC earnings claim for your exact Circle wallet and certifies it on Arc.</p>
            <PrimaryButton type="button" loading={busy === "task"} disabled={Boolean(busy)} onClick={() => run("task", circleApi.completeDemoTask)}>Complete demo task</PrimaryButton>
          </> : !advanceReady ? <>
            <h2>Your earnings are certified</h2><div className="try-amount"><strong>0.099</strong><span>USDC available now</span></div><p>From 0.10 USDC earnings · 0.001 USDC fee · normal payout in seven days.</p>
            <PrimaryButton type="button" loading={busy === "advance"} disabled={Boolean(busy)} onClick={getPaid}>Get paid now</PrimaryButton>
          </> : !complete ? <>
            <h2>Platform settlement</h2><p>Your payout is final. Fidra is now settling the platform's 0.10 USDC obligation and checking the resulting accounting.</p>
            <div className="try-wait"><CircleNotch className="spin" />Verifying settlement on Arc…</div>
          </> : <>
            <div className="try-complete-mark"><Check /></div><h2>Payout complete</h2><p>Your worker payout and the platform settlement are independently confirmed on Arc.</p>
            <div className="try-amount"><strong>0.099</strong><span>USDC received before worker gas</span></div>
          </>}
          {wallet && <div className="try-wallet"><Wallet /><span><small>Circle worker</small><code>{truncateHex(wallet.address, 12, 10)}</code></span><button type="button" aria-label="Copy worker address" onClick={async () => { await navigator.clipboard.writeText(wallet.address); showNotice("Worker address copied"); }}><Copy /></button></div>}
          <ErrorMessage message={error} />
        </section>

        <aside className="try-progress" aria-label="Verified payout timeline">
          <h2>Verified timeline</h2><p>Success comes from Arc receipts, not status messages alone.</p>
          <ol>
            <Step complete={Boolean(wallet)} current={session?.authenticated && !wallet} title="Circle wallet ready" detail="User-controlled Arc Testnet EOA." />
            <Step complete={gasReady} current={Boolean(workflow) && !gasReady} title="Gas prepared" detail={workflow?.gasFunding?.status === "not_needed" ? "Existing balance was sufficient." : "Capped native USDC funding."}>
              <ReceiptLink receipt={workflow?.gasFunding} label="Funding receipt" />
            </Step>
            <Step complete={claimReady} current={gasReady && !claimReady} title="Earnings certified" detail={workflow?.claim ? `Claim #${workflow.claim.id} · ${formatUsdc(BigInt(workflow.claim.faceValue))} USDC` : "One unique sandbox task."}>
              <ReceiptLink receipt={workflow?.claim?.createReceipt} label="Claim created" /><ReceiptLink receipt={workflow?.claim?.certifyReceipt} label="Certification" />
            </Step>
            <Step complete={advanceReady} current={claimReady && !advanceReady} title="Instant payout approved" detail="Circle worker approval and independent Arc verification.">
              <ReceiptLink receipt={workflow?.advance?.receipt} label="Advance receipt" />
            </Step>
            <Step complete={complete} current={advanceReady && !complete} title="Platform settled" detail="0.10 USDC obligation; exposure returns to zero.">
              <ReceiptLink receipt={workflow?.settlement?.approvalReceipt} label="USDC approval" /><ReceiptLink receipt={workflow?.settlement?.receipt} label="Settlement receipt" />
            </Step>
          </ol>
        </aside>
      </div>
    </div>
  );
}
