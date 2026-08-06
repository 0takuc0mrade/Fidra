import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

function pathValue(value) {
  return value instanceof URL ? fileURLToPath(value) : value;
}

export class DemoWorkflowStore {
  constructor(file, { now = () => new Date().toISOString() } = {}) {
    this.file = pathValue(file);
    this.now = now;
    this.locks = new Map();
  }

  async readAll() {
    try { return JSON.parse(await readFile(this.file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return { workflows: {} }; throw error; }
  }

  async writeAll(data) {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.file);
  }

  async createOrGet({ userRef, worker, platformId }) {
    const data = await this.readAll();
    const current = Object.values(data.workflows).find((item) => item.userRef === userRef && !["complete", "cancelled"].includes(item.state));
    if (current) return current;
    const id = randomUUID();
    const timestamp = this.now();
    const workflow = {
      id, userRef, worker, platformId, state: "wallet_ready", error: null,
      task: null, gasFunding: null, claim: null, advance: null, settlement: null,
      createdAt: timestamp, updatedAt: timestamp,
    };
    data.workflows[id] = workflow;
    await this.writeAll(data);
    return workflow;
  }

  async get(id) { return (await this.readAll()).workflows[id] ?? null; }

  async findForUser(userRef) {
    const values = Object.values((await this.readAll()).workflows).filter((item) => item.userRef === userRef);
    return values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
  }

  async findByOperationId(operationId) {
    return Object.values((await this.readAll()).workflows).find((item) => item.advance?.operationId === operationId) ?? null;
  }

  async dailyCertifiedFaceTotal(date = new Date().toISOString().slice(0, 10)) {
    return Object.values((await this.readAll()).workflows).reduce((total, item) => {
      if (!item.claim?.certifyReceipt || !item.updatedAt?.startsWith(date)) return total;
      return total + BigInt(item.claim.faceValue || 0);
    }, 0n);
  }

  async update(id, values) {
    const data = await this.readAll();
    if (!data.workflows[id]) return null;
    data.workflows[id] = { ...data.workflows[id], ...values, updatedAt: this.now() };
    await this.writeAll(data);
    return data.workflows[id];
  }

  async withLock(id, callback) {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const queued = previous.then(() => gate);
    this.locks.set(id, queued);
    await previous;
    try { return await callback(); }
    finally { release(); if (this.locks.get(id) === queued) this.locks.delete(id); }
  }
}
