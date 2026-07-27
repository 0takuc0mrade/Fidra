import { randomUUID } from "node:crypto";

export class CircleApiError extends Error {
  constructor(message, status, code = null) {
    super(message);
    this.name = "CircleApiError";
    this.status = status;
    this.code = code;
  }
}

export class CircleClient {
  constructor(config, fetchImplementation = fetch) {
    this.config = config;
    this.fetch = fetchImplementation;
  }

  async request(path, { method = "GET", userToken, body } = {}) {
    if (!this.config.walletsConfigured) {
      throw new CircleApiError("Circle User-Controlled Wallets are not configured.", 503);
    }
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${this.config.circleApiKey}`,
      "X-Request-Id": randomUUID(),
    };
    if (userToken) headers["X-User-Token"] = userToken;
    if (body) headers["Content-Type"] = "application/json";
    const response = await this.fetch(`${this.config.circleBaseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.message || payload.error || "Circle API request failed.";
      throw new CircleApiError(message, response.status, payload.code ?? null);
    }
    return payload.data ?? payload;
  }

  createSocialDeviceToken(deviceId) {
    return this.request("/v1/w3s/users/social/token", {
      method: "POST",
      body: { idempotencyKey: randomUUID(), deviceId },
    });
  }

  createEmailDeviceToken(deviceId, email) {
    return this.request("/v1/w3s/users/email/token", {
      method: "POST",
      body: { idempotencyKey: randomUUID(), deviceId, email },
    });
  }

  getUser(userToken) {
    return this.request("/v1/w3s/user", { userToken });
  }

  async listWallets(userToken) {
    const data = await this.request("/v1/w3s/wallets", { userToken });
    return data.wallets ?? [];
  }

  initializeUser(userToken, idempotencyKey) {
    return this.request("/v1/w3s/user/initialize", {
      method: "POST",
      userToken,
      body: {
        idempotencyKey,
        accountType: "EOA",
        blockchains: ["ARC-TESTNET"],
      },
    });
  }

  createWallet(userToken, idempotencyKey, refId) {
    return this.request("/v1/w3s/user/wallets", {
      method: "POST",
      userToken,
      body: {
        idempotencyKey,
        accountType: "EOA",
        blockchains: ["ARC-TESTNET"],
        metadata: [{ name: "Fidra vendor", refId }],
      },
    });
  }

  /// @notice Creates a user-controlled contract-execution challenge the vendor must approve in the browser SDK.
  createContractExecutionChallenge(userToken, { idempotencyKey, walletId, contractAddress, abiFunctionSignature, abiParameters, refId, feeLevel = "MEDIUM" }) {
    return this.request("/v1/w3s/user/transactions/contractExecution", {
      method: "POST",
      userToken,
      body: {
        idempotencyKey,
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters,
        feeLevel,
        ...(refId ? { refId } : {}),
      },
    });
  }

  /// @notice Reads the current state of a user-controlled transaction. Never fabricates a hash.
  getTransaction(userToken, transactionId) {
    return this.request(`/v1/w3s/transactions/${encodeURIComponent(transactionId)}`, { userToken });
  }
}
