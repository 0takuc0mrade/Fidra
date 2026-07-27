import { createServer } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";

const server = createServer(createApp(config));

server.listen(config.port, "127.0.0.1", () => {
  console.log(`Fidra server listening on http://127.0.0.1:${config.port}`);
  console.log(`Circle wallets: ${config.walletsConfigured ? "configured" : "not configured"}; gas seed: ${config.gasSeedConfigured ? "configured" : "not configured"}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
