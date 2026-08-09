import { createConfig } from "../src/config.js";
import { createPool, databaseHealth } from "../src/postgres.js";

const config = createConfig();
if (!config.databaseConfigured) {
  console.log(JSON.stringify({ configured: false, reachable: false, schemaReady: false }));
  process.exitCode = 1;
} else {
  const pool = createPool(config);
  try {
    const status = await databaseHealth(pool);
    console.log(JSON.stringify(status));
    if (!status.reachable || !status.schemaReady) process.exitCode = 1;
  } finally { await pool.end(); }
}

