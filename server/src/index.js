import { createServer } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";

const server = createServer(createApp(config));

server.listen(config.port, config.host, () => {
  console.log(`Fidra server listening on http://${config.host}:${config.port}`);
  console.log(`Circle wallets: ${config.walletsConfigured ? "configured" : "not configured"}; gas seed: ${config.gasSeedConfigured ? "configured" : "not configured"}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
