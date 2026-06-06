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

## Maintenance

Perbaiki bug eksekusi bridge/swap/send/retry di package ini. Setelah mengubah runtime, jalankan:

```bash
npm run check
```
