import { randomUUID } from "node:crypto";

export class OperationStore {
  constructor({ ttlMs = 15 * 60_000, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.operations = new Map();
  }

  create(values) {
    const id = randomUUID();
    const operation = {
      id,
      createdAt: this.now(),
      expiresAt: this.now() + this.ttlMs,
      status: "challenge_required",
      transactionId: null,
      ...values,
    };
    this.operations.set(id, operation);
    return operation;
  }

  get(id, sessionId) {
    const operation = this.operations.get(id);
    if (!operation || operation.sessionId !== sessionId) return null;
    if (operation.expiresAt <= this.now()) {
      operation.status = "transaction_timed_out";
    }
    return operation;
  }

  bind(id, sessionId, transactionId) {
    const operation = this.get(id, sessionId);
    if (!operation) return null;
    if (operation.transactionId && operation.transactionId !== transactionId) return false;
    operation.transactionId = transactionId;
    operation.status = "transaction_pending";
    return operation;
  }

  update(id, values) {
    const operation = this.operations.get(id);
    if (!operation) return null;
    Object.assign(operation, values);
    return operation;
  }
}
