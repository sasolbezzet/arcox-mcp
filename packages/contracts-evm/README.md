# `@arcox/contracts-evm`

Workspace kontrak router EVM ARCOX.

Kontrak runtime utama masih disalin di `packages/runtime/contracts` karena script deploy lama membaca path tersebut. Package ini menjadi area kerja kontrak agar perubahan kontrak tidak bercampur dengan MCP server atau web UI.

Perintah deploy aktif tetap:

```bash
cd /home/ubuntu/arcox-mcp
npm run compile:router
npm run deploy:router
```
