import { randomUUID } from "node:crypto";
import { CircleApiError, CircleClient } from "./circleClient.js";
import { createCircleStatus } from "./status.js";
import {
  SESSION_COOKIE,
  SessionStore,
  clearSessionCookie,
  parseCookies,
  sessionCookie,
} from "./sessionStore.js";
import { GasSeedError, GasSeedService } from "./seedService.js";
import { WalletStore } from "./walletStore.js";
import { ChainReads, computeAdvance, sameAddress } from "./chainReads.js";
import { OperationStore } from "./operationStore.js";
import { ArcVerificationPendingError, V1ChainReads } from "./v1ChainReads.js";
import { WorkerAdvanceError, validateWorkerAdvance } from "./workerAdvance.js";

const MAX_BODY_BYTES = 32_768;
const TRANSACTION_STUB_MESSAGE = "Circle wallet transaction execution is not implemented yet.";
const BUY_CLAIM_ABI_SIGNATURE = "buyClaim(uint256,uint256,uint256)";
const PURCHASE_ADVANCE_ABI_SIGNATURE = "purchaseAdvance(uint256)";

// Maps a Circle user-controlled transaction state to an honest Fidra UI state.
// A confirmed hash is surfaced only when Circle reports terminal success with a txHash.
function mapTransactionState(circleState, txHash) {
  const state = String(circleState || "").toUpperCase();
  if (state === "COMPLETE" || state === "CONFIRMED") {
    return txHash ? { status: "confirmed", txHash } : { status: "pending", txHash: null };
  }
  if (state === "FAILED" || state === "DENIED" || state === "CANCELLED") {
    return { status: "failed", txHash: null };
  }
  // INITIATED, CLEARED, QUEUED, SENT, STUCK, or anything unknown: still in flight.
  return { status: "pending", txHash: txHash ?? null };
}

function json(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 });
  }
}

function safeWallet(wallet, metadata = null) {
  if (!wallet) return null;
  return {
    id: wallet.id,
    address: wallet.address,
    blockchain: wallet.blockchain,
    accountType: wallet.accountType,
    state: wallet.state,
    gasSeed: metadata?.gasSeed ?? null,
  };
}

function safeSession(session) {
  if (!session) return { authenticated: false };
  return {
    authenticated: Boolean(session.userToken && session.circleUserId),
    authenticationMethod: session.authenticationMethod ?? null,
    circleUserId: session.circleUserId ?? null,
    wallet: safeWallet(session.wallet, session.walletMetadata),
    challengePending: Boolean(session.pendingChallengeId),
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}

function findArcEoa(wallets) {
  return wallets.find((wallet) => wallet.blockchain === "ARC-TESTNET" && wallet.accountType === "EOA") ?? null;
}

function requestSession(request, sessionStore) {
  const cookies = parseCookies(request.headers.cookie);
  return sessionStore.get(cookies[SESSION_COOKIE]);
}

function requireSession(request, response, sessionStore, { authenticated = false } = {}) {
  const session = requestSession(request, sessionStore);
  if (!session) {
    json(response, 401, { status: "unauthenticated", error: "Start a Circle vendor session first." });
    return null;
  }
  if (authenticated && (!session.userToken || !session.circleUserId)) {
    json(response, 401, { status: "unauthenticated", error: "Complete Circle vendor authentication first." });
    return null;
  }
  return session;
}

function validateMutationOrigin(request, config) {
  const origin = request.headers.origin;
  if (!origin) return false;
  return config.allowedOrigins.has(origin);
}

function corsHeaders(request, config) {
  const origin = request.headers.origin;
  if (!origin || !config.allowedOrigins.has(origin)) return {};
  return {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

export function createApp(config, overrides = {}) {
  const sessionStore = overrides.sessionStore ?? new SessionStore({ ttlMs: config.sessionTtlMs });
  const walletStore = overrides.walletStore ?? new WalletStore(config.metadataFile);
  const circleClient = overrides.circleClient ?? new CircleClient(config);
  const gasSeedService = overrides.gasSeedService ?? new GasSeedService(config, walletStore);
  const chainReads = overrides.chainReads ?? new ChainReads(config);
  const v1ChainReads = overrides.v1ChainReads ?? new V1ChainReads(config);
  const operationStore = overrides.operationStore ?? new OperationStore();
  let lastCircleError = null;

  async function loadWallet(session) {
    const wallets = await circleClient.listWallets(session.userToken);
    const wallet = findArcEoa(wallets);
    if (!wallet) return null;
    const walletMetadata = await walletStore.upsert(wallet, session.circleUserId);
    sessionStore.update(session.id, { wallet, walletMetadata, pendingChallengeId: null, walletIdempotencyKey: null });
    return { wallet, walletMetadata };
  }

  return async function handler(request, response) {
    const headers = corsHeaders(request, config);
    if (request.method === "OPTIONS") {
      response.writeHead(204, headers);
      response.end();
      return;
    }

    const url = new URL(request.url, "http://fidra.local");
    const route = `${request.method} ${url.pathname}`;
    if (request.method === "POST" && !validateMutationOrigin(request, config)) {
      json(response, 403, { status: "forbidden", error: "Request origin is not allowed." }, headers);
      return;
    }

    try {
      if (route === "GET /api/circle/status") {
        json(response, 200, createCircleStatus(config, lastCircleError), headers);
        return;
      }

      if (["POST /api/circle/vendor/session/start", "POST /api/circle/worker/session/start"].includes(route)) {
        if (!config.walletsConfigured) {
          json(response, 503, {
            status: "not_configured",
            error: "Circle User-Controlled Wallets are not configured.",
            missingEnvKeys: createCircleStatus(config).missingEnvKeys,
          }, headers);
          return;
        }
        const body = await readJson(request);
        const method = body.method;
        const deviceId = body.deviceId?.trim();
        if (!deviceId || deviceId.length > 200) throw Object.assign(new Error("A valid Circle device ID is required."), { status: 400 });
        if (method !== "google" && method !== "email_otp") throw Object.assign(new Error("Supported methods are google and email_otp."), { status: 400 });
        if (method === "email_otp" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email?.trim() || "")) {
          throw Object.assign(new Error("A valid email address is required."), { status: 400 });
        }
        if (method === "google" && !config.circleGoogleClientId) {
          json(response, 503, { status: "not_configured", error: "Google social login is not configured.", missingEnvKeys: ["CIRCLE_GOOGLE_CLIENT_ID"] }, headers);
          return;
        }

        let session = requestSession(request, sessionStore);
        if (!session) session = sessionStore.create();
        const tokenData = method === "google"
          ? await circleClient.createSocialDeviceToken(deviceId)
          : await circleClient.createEmailDeviceToken(deviceId, body.email?.trim());
        sessionStore.update(session.id, { authenticationMethod: method, deviceId });
        lastCircleError = null;
        json(response, 200, {
          status: "challenge_ready",
          method,
          appId: config.circleAppId,
          googleClientId: method === "google" ? config.circleGoogleClientId : undefined,
          deviceToken: tokenData.deviceToken,
          deviceEncryptionKey: tokenData.deviceEncryptionKey,
          otpToken: tokenData.otpToken,
        }, { ...headers, "Set-Cookie": sessionCookie(session, config.secureCookies) });
        return;
      }

      if (["POST /api/circle/vendor/session/complete", "POST /api/circle/worker/session/complete"].includes(route)) {
        const session = requireSession(request, response, sessionStore);
        if (!session) return;
        const body = await readJson(request);
        if (!body.userToken || typeof body.userToken !== "string") throw Object.assign(new Error("Circle user token is required."), { status: 400 });
        const circleUser = await circleClient.getUser(body.userToken);
        sessionStore.update(session.id, {
          userToken: body.userToken,
          refreshToken: typeof body.refreshToken === "string" ? body.refreshToken : null,
          circleUserId: circleUser.id,
        });
        lastCircleError = null;
        json(response, 200, { status: "authenticated", session: safeSession(sessionStore.get(session.id)) }, headers);
        return;
      }

      if (["GET /api/circle/vendor/session/callback", "GET /api/circle/worker/session/callback"].includes(route)) {
        json(response, 200, { status: "ok", session: safeSession(requestSession(request, sessionStore)) }, headers);
        return;
      }

      if (["POST /api/circle/vendor/session/logout", "POST /api/circle/worker/session/logout"].includes(route)) {
        const session = requestSession(request, sessionStore);
        sessionStore.delete(session?.id);
        json(response, 200, { status: "signed_out" }, { ...headers, "Set-Cookie": clearSessionCookie(config.secureCookies) });
        return;
      }

      if (["GET /api/circle/vendor/wallet", "GET /api/circle/worker/wallet"].includes(route)) {
        const session = requireSession(request, response, sessionStore, { authenticated: true });
        if (!session) return;
        const found = await loadWallet(session);
        lastCircleError = null;
        if (!found) {
          json(response, 200, {
            status: "not_found",
            targetAccountType: "EOA",
            blockchain: "ARC-TESTNET",
            warning: "No Arc Testnet EOA exists for this authenticated Circle user.",
          }, headers);
          return;
        }
        json(response, 200, { status: "ready", wallet: safeWallet(found.wallet, found.walletMetadata) }, headers);
        return;
      }

      if (["POST /api/circle/vendor/wallet", "POST /api/circle/worker/wallet"].includes(route)) {
        const session = requireSession(request, response, sessionStore, { authenticated: true });
        if (!session) return;
        const found = await loadWallet(session);
        if (found) {
          json(response, 200, { status: "ready", wallet: safeWallet(found.wallet, found.walletMetadata) }, headers);
          return;
        }
        if (session.pendingChallengeId) {
          json(response, 200, {
            status: "challenge_required",
            challengeId: session.pendingChallengeId,
            targetAccountType: "EOA",
            blockchain: "ARC-TESTNET",
          }, headers);
          return;
        }

        const idempotencyKey = session.walletIdempotencyKey ?? randomUUID();
        sessionStore.update(session.id, { walletIdempotencyKey: idempotencyKey });
        let challenge;
        try {
          challenge = await circleClient.initializeUser(session.userToken, idempotencyKey);
        } catch (error) {
          if (!(error instanceof CircleApiError) || Number(error.code) !== 155106) throw error;
          challenge = await circleClient.createWallet(
            session.userToken,
            idempotencyKey,
            `fidra_worker_${session.circleUserId}`.slice(0, 50),
          );
        }
        const challengeId = challenge.challengeId;
        if (!challengeId) throw Object.assign(new Error("Circle did not return a wallet challenge."), { status: 502 });
        sessionStore.update(session.id, { pendingChallengeId: challengeId });
        lastCircleError = null;
        json(response, 200, {
          status: "challenge_required",
          challengeId,
          targetAccountType: "EOA",
          blockchain: "ARC-TESTNET",
        }, headers);
        return;
      }

      if (["POST /api/circle/vendor/seed-gas", "POST /api/circle/worker/seed-gas"].includes(route)) {
        const session = requireSession(request, response, sessionStore, { authenticated: true });
        if (!session) return;
        const found = session.wallet ? { wallet: session.wallet, walletMetadata: session.walletMetadata } : await loadWallet(session);
        if (!found) {
          json(response, 409, { status: "wallet_required", error: "Create the Arc Testnet EOA wallet before requesting a gas seed." }, headers);
          return;
        }
        if (!config.gasSeedConfigured) {
          json(response, 503, {
            status: "not_configured",
            error: "Automatic Arc testnet gas seeding is not configured. Fund the wallet manually with Arc native testnet USDC.",
          }, headers);
          return;
        }
        const seed = await gasSeedService.seed(found.wallet);
        const walletMetadata = await walletStore.get(found.wallet.id);
        sessionStore.update(session.id, { walletMetadata });
        json(response, 200, { status: seed.status, seed }, headers);
        return;
      }

      if (route === "POST /api/circle/worker/transactions/purchase-advance") {
        const session = requireSession(request, response, sessionStore, { authenticated: true });
        if (!session) return;
        if (!config.walletsConfigured) {
          json(response, 503, {
            status: "circle_not_configured",
            error: "Circle User-Controlled Wallets are not configured for live worker payouts.",
          }, headers);
          return;
        }
        const found = session.wallet ? { wallet: session.wallet, walletMetadata: session.walletMetadata } : await loadWallet(session);
        if (!found) {
          json(response, 409, { status: "wallet_required", error: "Create an Arc Testnet EOA worker wallet first." }, headers);
          return;
        }
        const { wallet } = found;
        if (wallet.blockchain !== "ARC-TESTNET" || wallet.accountType !== "EOA" || !wallet.address) {
          json(response, 409, { status: "wallet_invalid", error: "The worker wallet must be an Arc Testnet EOA." }, headers);
          return;
        }
        const body = await readJson(request);
        const claimId = Number(body.claimId);
        if (!Number.isSafeInteger(claimId) || claimId <= 0) {
          throw Object.assign(new Error("A positive integer claimId is required."), { status: 400 });
        }
        const snapshot = await v1ChainReads.getWorkerAdvanceSnapshot(claimId);
        const quote = validateWorkerAdvance(snapshot, wallet.address, body.minimumAdvanceAmount);
        const challenge = await circleClient.createContractExecutionChallenge(session.userToken, {
          idempotencyKey: randomUUID(),
          walletId: wallet.id,
          contractAddress: config.v1AdvanceVaultAddress,
          abiFunctionSignature: PURCHASE_ADVANCE_ABI_SIGNATURE,
          abiParameters: [String(claimId)],
          refId: `fidra_v1_advance_${claimId}`,
        });
        if (!challenge.challengeId) throw Object.assign(new Error("Circle did not return a transaction challenge."), { status: 502 });
        const operation = operationStore.create({
          sessionId: session.id,
          challengeId: challenge.challengeId,
          worker: wallet.address,
          claimId: String(claimId),
          platformId: snapshot.claim.platformId.toString(),
          faceValue: snapshot.claim.faceValue.toString(),
          advanceAmount: quote.advanceAmount.toString(),
          feeAmount: quote.feeAmount.toString(),
          minimumAdvanceAmount: quote.minimumAdvanceAmount.toString(),
          advanceFeeBps: snapshot.platform.advanceFeeBps.toString(),
          dueDate: snapshot.claim.dueDate.toString(),
          quotedAtBlock: snapshot.blockNumber.toString(),
        });
        lastCircleError = null;
        json(response, 200, {
          status: "challenge_required",
          operationId: operation.id,
          challengeId: operation.challengeId,
          claimId: operation.claimId,
          platformId: operation.platformId,
          worker: operation.worker,
          faceValue: operation.faceValue,
          advanceAmount: operation.advanceAmount,
          feeAmount: operation.feeAmount,
          minimumAdvanceAmount: operation.minimumAdvanceAmount,
          advanceFeeBps: operation.advanceFeeBps,
          dueDate: operation.dueDate,
          quotedAtBlock: operation.quotedAtBlock,
          contractAddress: config.v1AdvanceVaultAddress,
        }, headers);
        return;
      }

      const workerTransactionMatch = url.pathname.match(/^\/api\/circle\/worker\/transactions\/([^/]+)$/);
      if (request.method === "POST" && workerTransactionMatch) {
        const session = requireSession(request, response, sessionStore, { authenticated: true });
        if (!session) return;
        const operationId = decodeURIComponent(workerTransactionMatch[1]);
        const body = await readJson(request);
        const transactionId = body.transactionId?.trim();
        if (!transactionId || transactionId.length > 200 || transactionId.includes("/")) {
          throw Object.assign(new Error("A valid Circle transactionId is required."), { status: 400 });
        }
        const bound = operationStore.bind(operationId, session.id, transactionId);
        if (bound === null) {
          json(response, 404, { status: "operation_not_found", error: "The worker payout operation was not found." }, headers);
          return;
        }
        if (bound === false) {
          json(response, 409, { status: "transaction_mismatch", error: "This payout operation is already bound to a different Circle transaction." }, headers);
          return;
        }
        json(response, 200, { status: "transaction_pending", operationId, transactionId }, headers);
        return;
      }

      if (request.method === "GET" && workerTransactionMatch) {
        const session = requireSession(request, response, sessionStore, { authenticated: true });
        if (!session) return;
        const operationId = decodeURIComponent(workerTransactionMatch[1]);
        const operation = operationStore.get(operationId, session.id);
        if (!operation) {
          json(response, 404, { status: "operation_not_found", error: "The worker payout operation was not found." }, headers);
          return;
        }
        if (operation.status === "transaction_timed_out") {
          json(response, 200, { status: "transaction_timed_out", txHash: null, explorerUrl: null }, headers);
          return;
        }
        if (!operation.transactionId) {
          json(response, 200, { status: "awaiting_approval", txHash: null, explorerUrl: null }, headers);
          return;
        }
        const transaction = await circleClient.getTransaction(session.userToken, operation.transactionId);
        const circleState = String(transaction.state || "").toUpperCase();
        if (["FAILED", "DENIED", "CANCELLED", "EXPIRED"].includes(circleState)) {
          operationStore.update(operation.id, { status: "transaction_failed" });
          json(response, 200, {
            status: "transaction_failed",
            circleState: transaction.state ?? null,
            txHash: null,
            explorerUrl: null,
            errorReason: transaction.errorReason ?? "Circle rejected or failed the transaction.",
          }, headers);
          return;
        }
        if (!["COMPLETE", "CONFIRMED"].includes(circleState) || !transaction.txHash) {
          json(response, 200, {
            status: "transaction_pending",
            circleState: transaction.state ?? null,
            txHash: null,
            explorerUrl: null,
          }, headers);
          return;
        }

        const firstCircleCompleteAt = operation.firstCircleCompleteAt ?? Date.now();
        operationStore.update(operation.id, { firstCircleCompleteAt });
        try {
          const receipt = await v1ChainReads.verifyWorkerAdvance(transaction.txHash, operation);
          operationStore.update(operation.id, { status: "transaction_confirmed", txHash: receipt.transactionHash });
          json(response, 200, {
            status: "transaction_confirmed",
            circleState: transaction.state ?? null,
            txHash: receipt.transactionHash,
            explorerUrl: `${config.blockExplorerUrl}/tx/${receipt.transactionHash}`,
            receipt: {
              transactionHash: receipt.transactionHash,
              blockNumber: receipt.blockNumber.toString(),
              from: receipt.from,
              to: receipt.to,
            },
          }, headers);
        } catch (error) {
          if (error instanceof ArcVerificationPendingError && Date.now() - firstCircleCompleteAt < config.arcVerificationTimeoutMs) {
            json(response, 200, {
              status: "transaction_pending",
              circleState: transaction.state ?? null,
              txHash: null,
              explorerUrl: null,
              verification: "waiting_for_arc",
            }, headers);
            return;
          }
          operationStore.update(operation.id, { status: "transaction_failed" });
          json(response, 200, {
            status: "transaction_failed",
            circleState: transaction.state ?? null,
            txHash: null,
            explorerUrl: null,
            errorReason: error instanceof ArcVerificationPendingError
              ? "Arc verification timed out before the expected state change was confirmed."
              : error.message,
          }, headers);
        }
        return;
      }

      if (route === "POST /api/circle/vendor/transactions/buy-claim") {
        const session = requireSession(request, response, sessionStore, { authenticated: true });
        if (!session) return;
        const found = session.wallet ? { wallet: session.wallet, walletMetadata: session.walletMetadata } : await loadWallet(session);
        if (!found) {
          json(response, 409, { status: "wallet_required", error: "Create the Arc Testnet EOA wallet before selling a claim." }, headers);
          return;
        }
        const { wallet } = found;
        if (wallet.blockchain !== "ARC-TESTNET" || wallet.accountType !== "EOA" || !wallet.address) {
          json(response, 409, { status: "wallet_invalid", error: "The vendor wallet is not an Arc Testnet EOA." }, headers);
          return;
        }

        const body = await readJson(request);
        const requestId = body.requestId;
        if (!Number.isSafeInteger(Number(requestId)) || Number(requestId) <= 0) {
          throw Object.assign(new Error("A valid locked request id is required."), { status: 400 });
        }
        const deadline = Number(body.deadline);
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (!Number.isSafeInteger(deadline) || deadline <= nowSeconds) {
          json(response, 422, { status: "deadline_invalid", error: "The sell quote deadline is missing or already passed." }, headers);
          return;
        }

        let spend;
        try {
          spend = await chainReads.getSpendRequest(requestId);
        } catch {
          json(response, 502, { status: "read_failed", error: "Could not read the claim from Arc. Try again shortly." }, headers);
          return;
        }
        if (spend.status !== "Locked") {
          json(response, 409, { status: "not_locked", error: `Only Locked claims can be sold. Claim ${requestId} is ${spend.status}.` }, headers);
          return;
        }
        if (!sameAddress(spend.payee, wallet.address)) {
          json(response, 409, {
            status: "payee_mismatch",
            error: "This wallet is not the current payee of the claim.",
            currentPayee: spend.payee,
            walletAddress: wallet.address,
          }, headers);
          return;
        }
        const purchase = await chainReads.getClaimPurchase(requestId).catch(() => ({ seller: "0x0000000000000000000000000000000000000000", settled: false }));
        if (purchase.seller && !sameAddress(purchase.seller, "0x0000000000000000000000000000000000000000")) {
          json(response, 409, { status: "already_purchased", error: `Claim ${requestId} has already been sold to the vault.` }, headers);
          return;
        }

        const { advanceUnits, spreadUnits } = computeAdvance(spend.amount, config.advanceVaultDiscountBps);
        const minAdvanceAmount = body.minAdvanceAmount === undefined ? advanceUnits : BigInt(body.minAdvanceAmount);
        if (minAdvanceAmount > advanceUnits) {
          json(response, 422, {
            status: "min_advance_too_high",
            error: "minAdvanceAmount exceeds the advance produced by the deployed discount.",
            advanceAmount: advanceUnits.toString(),
          }, headers);
          return;
        }

        const idempotencyKey = randomUUID();
        const challenge = await circleClient.createContractExecutionChallenge(session.userToken, {
          idempotencyKey,
          walletId: wallet.id,
          contractAddress: config.advanceVaultAddress,
          abiFunctionSignature: BUY_CLAIM_ABI_SIGNATURE,
          abiParameters: [String(requestId), minAdvanceAmount.toString(), String(deadline)],
          refId: `fidra_buyclaim_${requestId}`,
        });
        const challengeId = challenge.challengeId;
        if (!challengeId) throw Object.assign(new Error("Circle did not return a transaction challenge."), { status: 502 });
        lastCircleError = null;
        json(response, 200, {
          status: "challenge_required",
          challengeId,
          requestId: String(requestId),
          faceAmount: spend.amount.toString(),
          advanceAmount: advanceUnits.toString(),
          expectedSpread: spreadUnits.toString(),
          minAdvanceAmount: minAdvanceAmount.toString(),
          discountBps: config.advanceVaultDiscountBps,
          releaseDueAt: spend.releaseDueAt.toString(),
          deadline,
          contractAddress: config.advanceVaultAddress,
        }, headers);
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/circle/vendor/transactions/")) {
        const session = requireSession(request, response, sessionStore, { authenticated: true });
        if (!session) return;
        const transactionId = url.pathname.slice("/api/circle/vendor/transactions/".length);
        if (!transactionId || transactionId.includes("/")) {
          json(response, 400, { status: "error", error: "A single transaction id is required." }, headers);
          return;
        }
        const transaction = await circleClient.getTransaction(session.userToken, transactionId);
        const mapped = mapTransactionState(transaction.state, transaction.txHash);
        lastCircleError = null;
        json(response, 200, {
          status: mapped.status,
          circleState: transaction.state ?? null,
          txHash: mapped.txHash,
          explorerUrl: mapped.txHash ? `${config.blockExplorerUrl}/tx/${mapped.txHash}` : null,
          errorReason: mapped.status === "failed" ? (transaction.errorReason ?? null) : null,
        }, headers);
        return;
      }

      if ([
        "POST /api/circle/vendor/transactions/submit-proof",
        "POST /api/circle/agent/transactions/request-spend",
      ].includes(route)) {
        json(response, 501, { status: "not_implemented", error: TRANSACTION_STUB_MESSAGE }, headers);
        return;
      }

      json(response, 404, { status: "not_found", error: "API route not found." }, headers);
    } catch (error) {
      if (error instanceof CircleApiError) {
        lastCircleError = error;
        json(response, error.status >= 400 && error.status < 600 ? error.status : 502, {
          status: "error",
          error: "Circle request failed.",
          circleCode: error.code,
        }, headers);
        return;
      }
      if (error instanceof GasSeedError) {
        json(response, error.status, { status: error.status === 503 ? "not_configured" : "error", error: error.message }, headers);
        return;
      }
      if (error instanceof WorkerAdvanceError) {
        json(response, error.status, { status: error.code, error: error.message, ...error.details }, headers);
        return;
      }
      json(response, error.status ?? 500, {
        status: "error",
        error: error.status && error.status < 500 ? error.message : "Internal server error.",
      }, headers);
    }
  };
}
