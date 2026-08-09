import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";

export const REQUIRED_SCHEMA_VERSION = "001_durable_runtime.sql";

export function createPool(config) {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required for Postgres storage.");
  return new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    connectionTimeoutMillis: config.databaseConnectTimeoutMs,
    idleTimeoutMillis: config.databaseIdleTimeoutMs,
    allowExitOnIdle: false,
  });
}

async function migrationFiles() {
  const directory = new URL("../migrations/", import.meta.url);
  const names = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  return Promise.all(names.map(async (name) => ({
    name,
    sql: await readFile(new URL(name, directory), "utf8"),
  })));
}

export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('fidra:schema-migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const migration of await migrationFiles()) {
      const checksum = createHash("sha256").update(migration.sql).digest("hex");
      const existing = await client.query("SELECT checksum FROM schema_migrations WHERE version = $1", [migration.name]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Migration checksum mismatch: ${migration.name}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [migration.name, checksum]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('fidra:schema-migrations'))").catch(() => {});
    client.release();
  }
}

export async function databaseHealth(pool) {
  try {
    const table = await pool.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present");
    if (!table.rows[0]?.present) return { configured: true, reachable: true, schemaReady: false };
    const result = await pool.query("SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS schema_ready", [REQUIRED_SCHEMA_VERSION]);
    return { configured: true, reachable: true, schemaReady: Boolean(result.rows[0]?.schema_ready) };
  } catch {
    return { configured: true, reachable: false, schemaReady: false };
  }
}
