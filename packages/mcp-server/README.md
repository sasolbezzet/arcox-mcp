# `@arcox/mcp-server`

Entrypoint MCP yang dipasang ke Hermes/Codex.

File `server.mjs` sengaja tipis dan mengarah ke runtime:

```text
../runtime/mcp/server.mjs
```

Tujuannya agar config agent eksternal stabil, sementara implementasi detail tetap di `packages/runtime`.
