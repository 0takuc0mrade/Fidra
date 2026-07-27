# Shared

Artifacts shared by contracts and the web application:

- `abis/` contains curated `MandateManager` and `AdvanceVault` ABIs.
- `constants.js` defines Arc Testnet, ERC-20 USDC, decimals, and Vite environment-key names.
- `types.js` defines shared status labels and JSDoc contract-state shapes.
- `scripts/export-abis.mjs` regenerates curated ABIs from Foundry artifacts.

After changing either contract, run:

```bash
cd contracts && forge build
cd .. && node shared/scripts/export-abis.mjs
```

The web application imports the curated output rather than the large raw Foundry artifact. This is a source-level shared directory, not a separately published package.
