import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

function filePath(value) {
  return value instanceof URL ? fileURLToPath(value) : value;
}

export class WalletStore {
  constructor(metadataFile) {
    this.metadataFile = filePath(metadataFile);
    this.writeQueue = Promise.resolve();
  }

  async readAll() {
    try {
      const raw = await readFile(this.metadataFile, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === "ENOENT") return { wallets: {} };
      throw error;
    }
  }

  async writeAll(data) {
    await mkdir(dirname(this.metadataFile), { recursive: true });
    const temporary = `${this.metadataFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.metadataFile);
  }

  async upsert(wallet, circleUserId) {
    return this.withWriteLock(async () => {
      const data = await this.readAll();
      const previous = data.wallets[wallet.id] ?? {};
      data.wallets[wallet.id] = {
        ...previous,
        walletId: wallet.id,
        address: wallet.address,
        blockchain: wallet.blockchain,
        accountType: wallet.accountType,
        circleUserId,
        recordedAt: previous.recordedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.writeAll(data);
      return data.wallets[wallet.id];
    });
  }

  async get(walletId) {
    const data = await this.readAll();
    return data.wallets[walletId] ?? null;
  }

  async recordSeed(walletId, seed) {
    return this.withWriteLock(async () => {
      const data = await this.readAll();
      if (!data.wallets[walletId]) throw new Error("Wallet metadata is missing.");
      data.wallets[walletId].gasSeed = { ...seed, recordedAt: new Date().toISOString() };
      data.wallets[walletId].updatedAt = new Date().toISOString();
      await this.writeAll(data);
      return data.wallets[walletId];
    });
  }

  async dailyConfirmedSeedTotal(date = new Date().toISOString().slice(0, 10)) {
    const data = await this.readAll();
    return Object.values(data.wallets).reduce((total, wallet) => {
      const seed = wallet.gasSeed;
      if (seed?.status !== "confirmed" || !seed.recordedAt?.startsWith(date)) return total;
      return total + Number(seed.amountUsdc || 0);
    }, 0);
  }

  async withWriteLock(callback) {
    const previous = this.writeQueue;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    this.writeQueue = previous.then(() => gate);
    await previous;
    try { return await callback(); }
    finally { release(); }
  }
}
