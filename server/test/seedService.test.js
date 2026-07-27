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
