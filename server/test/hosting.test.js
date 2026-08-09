import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, test } from "node:test";
import { createApp } from "../src/app.js";
import { createConfig } from "../src/config.js";
import { clearSessionCookie, sessionCookie } from "../src/sessionStore.js";

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function start(config, overrides = {}) {
  const server = createServer(createApp(config, overrides));
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("hosted config uses one runtime directory and a strict cross-site cookie", () => {
  const config = createConfig({
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    FIDRA_RUNTIME_DATA_DIR: "/var/data/fidra",
    SERVER_ALLOWED_ORIGINS: "https://fidra.pages.dev/",
    SESSION_COOKIE_SAME_SITE: "None",
    DATABASE_URL: "postgresql://example.invalid/fidra?sslmode=require",
  });

  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.metadataFile, "/var/data/fidra/worker-wallets.json");
  assert.equal(config.demoWorkflowFile, "/var/data/fidra/demo-workflows.json");
  assert.deepEqual([...config.allowedOrigins], ["https://fidra.pages.dev"]);
  assert.equal(config.secureCookies, true);
  assert.equal(config.cookieSameSite, "None");
  assert.deepEqual(config.configurationErrors, []);
});

test("unsafe hosted origin and cookie configuration fails closed", () => {
  const config = createConfig({
    CIRCLE_WALLETS_ENABLED: "true",
    CIRCLE_API_KEY: "test-key",
    CIRCLE_APP_ID: "test-app",
    SERVER_ALLOWED_ORIGINS: "*",
    SESSION_COOKIE_SECURE: "false",
    SESSION_COOKIE_SAME_SITE: "None",
  });

  assert.equal(config.allowedOrigins.size, 0);
  assert.equal(config.walletsConfigured, false);
  assert.ok(config.configurationErrors.some((message) => message.includes("invalid origins")));
  assert.ok(config.configurationErrors.some((message) => message.includes("requires SESSION_COOKIE_SECURE=true")));
});

test("production configuration requires durable Postgres", () => {
  const config = createConfig({ NODE_ENV: "production" });
  assert.equal(config.databaseConfigured, false);
  assert.ok(config.configurationErrors.includes("DATABASE_URL is required in production."));
});

test("a configured database cannot silently fall back to JSON stores", () => {
  const config = createConfig({ DATABASE_URL: "postgresql://example.invalid/fidra?sslmode=require" });
  assert.throws(() => createApp(config), /Postgres storage must be initialized/);
});

test("session cookies support secure cross-site hosting and matching deletion", () => {
  const session = { id: "session-id", expiresAt: Date.now() + 60_000 };
  const created = sessionCookie(session, true, "None");
  const cleared = clearSessionCookie(true, "None");
  for (const cookie of [created, cleared]) {
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=None/);
    assert.match(cookie, /Secure/);
  }
});

test("health endpoint is public, minimal, and non-cacheable", async () => {
  const baseUrl = await start(createConfig());
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "ok",
    process: { healthy: true },
    database: { configured: false, reachable: false, schemaReady: false },
  });
});

test("health fails closed without exposing database connection details", async () => {
  const databaseUrl = "postgresql://private-user:private-password@example.invalid/fidra";
  const config = createConfig({ DATABASE_URL: databaseUrl });
  const storage = {
    walletStore: {}, workflowStore: {}, operationStore: {}, requestLimiter: {},
    health: async () => ({ configured: true, reachable: false, schemaReady: false }),
  };
  const baseUrl = await start(config, { storage });
  const response = await fetch(`${baseUrl}/api/health`);
  const raw = await response.text();
  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(raw), {
    status: "unavailable",
    process: { healthy: true },
    database: { configured: true, reachable: false, schemaReady: false },
  });
  assert.ok(!raw.includes("private-user"));
  assert.ok(!raw.includes("private-password"));
  assert.ok(!raw.includes("example.invalid"));
});

test("cross-origin session start returns exact CORS and cookie attributes", async () => {
  const origin = "https://fidra.pages.dev";
  const config = createConfig({
    NODE_ENV: "production",
    CIRCLE_WALLETS_ENABLED: "true",
    CIRCLE_API_KEY: "test-key",
    CIRCLE_APP_ID: "test-app",
    SERVER_ALLOWED_ORIGINS: origin,
    SESSION_COOKIE_SAME_SITE: "None",
  });
  const session = { id: "session-id", expiresAt: Date.now() + 60_000 };
  const sessionStore = {
    create: () => session,
    get: () => null,
    update: () => session,
  };
  const circleClient = {
    createEmailDeviceToken: async () => ({
      deviceToken: "device-token",
      deviceEncryptionKey: "device-key",
      otpToken: "otp-token",
    }),
  };
  const baseUrl = await start(config, { sessionStore, circleClient });
  const response = await fetch(`${baseUrl}/api/circle/worker/session/start`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ method: "email_otp", deviceId: "device-id", email: "worker@example.com" }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.match(response.headers.get("set-cookie"), /SameSite=None/);
  assert.match(response.headers.get("set-cookie"), /Secure/);
});
