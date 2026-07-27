import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          web3: ["viem"],
        },
      },
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local", "localhost"],
    fs: {
      allow: [fileURLToPath(new URL("..", import.meta.url))],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [
    react(),
    nodePolyfills({
      // Circle's SDK imports CommonJS Buffer/stream/util helpers at module load.
      // Do not polyfill Node crypto: Circle's browser flow should use Web Crypto,
      // and bundling crypto-browserify would add an unnecessary elliptic stack.
      include: ["buffer", "stream", "util"],
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
  ],
});
