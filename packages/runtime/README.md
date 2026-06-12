# `@arcox/runtime`

Runtime utama ARCOX agent.

## Isi

- `bin/arcox-agent.mjs` - core command/action executor.
- `bin/arcox-codex-cli.mjs` - natural-language CLI wrapper.
- `mcp/server.mjs` - MCP implementation asli.
- `mcp/registry.mjs` - peta fitur UI/action/chain untuk agent.
- `deployments/` - alamat router testnet yang dipakai runtime.
- `artifacts/` - compiled EVM router artifact.
- `.env` - local signer/env, di-ignore git.

## Native Bridge

Runtime supports native ETH bridge quotes/execution from Ethereum Sepolia and Base Sepolia to Arc Testnet through `ArcoxNativeSwapBridgeRouter`.

Supported examples:

```bash
bridge 0.001 ETH from Base Sepolia to Arc
bridge 0.001 ETH from Ethereum Sepolia to Arc
```

Native bridge must use the local EOA signer. Circle Wallet source remains USDC-only.

## Maintenance

Perbaiki bug eksekusi bridge/swap/send/retry di package ini. Setelah mengubah runtime, jalankan:

```bash
npm run check
```
