# Maintenance

- `packages/mcp-server` is the published MCP entrypoint; transaction execution remains in `packages/runtime`.
- Every value-moving tool must quote first, bind execution to its preview, and require an explicit `yes` or `ya`.
- Keep private keys and persistent previews under `~/.arcox`; never add them to this repository.
- Validate changes with `npm run check` before publishing.

## Per-agent ARCOX connections

The production ARCOX MCP endpoint uses one Agent Wallet MSCA per agent connection. The owner may share an EOA/passkey identity across agents, but the server binds each OAuth client to `agentKey = clientId|ownerId` and the token carries the selected `mscaWalletAddress`.

Recommended default-Hermes flow:

1. The owner creates a connection token in the ARCOX plugin for the selected agent wallet.
2. The agent runs `hermes mcp add arcox --url https://arcoxdex.vercel.app/mcp --auth header` and enters the token.
3. The agent runs `hermes mcp test arcox`, verifies `tools/list`, and starts a new session.

The device-flow alternative is `hermes mcp login arcox`; approve its code in the ARCOX plugin. Never exchange or reuse tokens between agent wallets.

## Operational verification

Use the gates in this order: local tests → staging `:3901` → two-agent Hermes device flow → default-Hermes connection-token flow → production read-only smoke. Production transactions are a separate owner-approved gate.

- Staging scripts must assert `BASE` is localhost/127.0.0.1.
- Do not print bearer tokens in scripts or logs.
- A successful connection claim requires `initialize` and `tools/list` to return HTTP 200.
- Start a new Hermes session after changing MCP configuration.
