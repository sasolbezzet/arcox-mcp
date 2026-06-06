# ARCOX MCP Monorepo

ARCOX MCP dipisahkan dari `arc-dex` agar agent, MCP server, CLI, dan kontrak bisa dirawat tanpa mengganggu web UI.

## Struktur

- `packages/runtime` - runtime utama agent: bridge, swap, send, retry, history, router deploy helpers.
- `packages/mcp-server` - entrypoint MCP untuk Hermes/Codex dan agent lain.
- `packages/cli` - wrapper CLI untuk prompt terminal.
- `packages/contracts-evm` - kontrak EVM router dan ruang kerja deploy/compile.
- `packages/contracts-solana` - router Solana Devnet.
- `docs` - konsep dan panduan operasional agent.

## Perintah Utama

```bash
npm run mcp
npm run agent -- status
npm run codex-agent -- "send 1 USDC from circle wallet to 0x..."
npm run check
```

## Env Lokal

Runtime membaca env dari:

```text
packages/runtime/.env
```

File ini sengaja di-ignore git karena berisi signer lokal dan secret.

## Integrasi Hermes

MCP server yang dipakai Hermes:

```bash
node /home/ubuntu/arcox-mcp/packages/mcp-server/server.mjs
```

Semua aksi value-moving tetap wajib quote, `previewId`, dan konfirmasi eksplisit.
