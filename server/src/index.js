import { createServer } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { createStorage } from "./storage.js";

if (config.configurationErrors.length) {
  throw new Error(`Fidra configuration is invalid: ${config.configurationErrors.join(" ")}`);
}

const storage = await createStorage(config);
const server = createServer(createApp(config, { storage }));

server.listen(config.port, config.host, () => {
  console.log(`Fidra server listening on http://${config.host}:${config.port}`);
  console.log(`Circle wallets: ${config.walletsConfigured ? "configured" : "not configured"}; gas seed: ${config.gasSeedConfigured ? "configured" : "not configured"}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(async () => {
    await storage?.close().catch(() => {});
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
