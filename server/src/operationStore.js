import { randomUUID } from "node:crypto";

export class OperationStore {
  constructor({ ttlMs = 15 * 60_000, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.operations = new Map();
  }

  create(values, requestedId = null) {
    const id = requestedId ?? randomUUID();
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

  restore(operation) {
    if (!operation?.id || this.operations.has(operation.id)) return this.operations.get(operation?.id) ?? null;
    const restored = {
      createdAt: this.now(),
      expiresAt: this.now() + this.ttlMs,
      status: "challenge_required",
      transactionId: null,
      ...operation,
    };
    this.operations.set(restored.id, restored);
    return restored;
  }

  get(id, sessionId) {
    const operation = this.operations.get(id);
    if (!operation || (operation.ownerRef ?? operation.sessionId) !== sessionId) return null;
    if (operation.expiresAt <= this.now()) {
      operation.status = "transaction_timed_out";
    }
    return operation;
  }

  bind(id, sessionId, transactionId) {
    const operation = this.get(id, sessionId);
    if (!operation) return null;
    if (["transaction_confirmed", "transaction_failed", "transaction_timed_out", "cancelled"].includes(operation.status)) return false;
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
