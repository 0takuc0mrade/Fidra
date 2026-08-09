import { databaseHealth, createPool, migrate } from "./postgres.js";
import {
  PostgresOperationStore,
  PostgresRequestLimiter,
  PostgresWalletStore,
  PostgresWorkflowStore,
} from "./postgresStores.js";

export async function createStorage(config) {
  if (!config.databaseConfigured) return null;
  const pool = createPool(config);
  try {
    await migrate(pool);
    const health = await databaseHealth(pool);
    if (!health.reachable || !health.schemaReady) throw new Error("Postgres schema is not ready.");
    return {
      pool,
      walletStore: new PostgresWalletStore(pool),
      workflowStore: new PostgresWorkflowStore(pool),
      operationStore: new PostgresOperationStore(pool),
      requestLimiter: new PostgresRequestLimiter(pool, { limit: config.sandboxRequestLimit }),
      health: () => databaseHealth(pool),
      close: () => pool.end(),
    };
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }
}

