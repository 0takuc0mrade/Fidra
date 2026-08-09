import { createConfig } from "../src/config.js";
import { createPool, migrate, databaseHealth } from "../src/postgres.js";

const config = createConfig();
if (!config.databaseConfigured) throw new Error("DATABASE_URL is not configured.");
const pool = createPool(config);
try {
  await migrate(pool);
  const health = await databaseHealth(pool);
  if (!health.schemaReady) throw new Error("Database migration did not reach the required schema.");
  console.log("Fidra database migration complete; required schema is ready.");
} finally { await pool.end(); }

