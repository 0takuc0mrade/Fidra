import assert from "node:assert/strict";
import { test } from "node:test";
import { createConfig } from "../src/config.js";
import { GasSeedService } from "../src/seedService.js";

test("once-per-wallet gas seed returns the recorded receipt without sending again", async () => {
  const recorded = {
    status: "confirmed",
    amountUsdc: "0.25",
    transactionHash: `0x${"a".repeat(64)}`,
    explorerUrl: `https://testnet.arcscan.app/tx/0x${"a".repeat(64)}`,
  };
  const walletStore = { get: async () => ({ gasSeed: recorded }) };
  const service = new GasSeedService(createConfig({ SEED_ONCE_PER_WALLET: "true" }), walletStore);
  service.clients = () => { throw new Error("a second transfer must not be prepared"); };

  const result = await service.seed({ id: "wallet-id", address: `0x${"1".repeat(40)}` });

  assert.equal(result.status, "already_seeded");
  assert.equal(result.transactionHash, recorded.transactionHash);
});

test("gas seed budget checks are serialized across concurrent wallets", async () => {
  const service = new GasSeedService(createConfig(), {});
  let active = 0;
  let maximumActive = 0;
  service.seedUnlocked = async (wallet) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return wallet.id;
  };

  const results = await Promise.all([
    service.seed({ id: "wallet-a" }),
    service.seed({ id: "wallet-b" }),
  ]);

  assert.deepEqual(results, ["wallet-a", "wallet-b"]);
  assert.equal(maximumActive, 1);
});
