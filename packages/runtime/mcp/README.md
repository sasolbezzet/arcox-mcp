# ARCOX MCP Runtime

Hermes connects to the remote ARCOX MCP server using a connection token created in the ARCOX web Plugin.

## User flow

1. Open `https://arcoxdex.vercel.app` → **Plugin**.
2. Open **Agent Terhubung** and select the intended agent.
3. Click **Buat Token Koneksi** or **Rotasi token koneksi** and copy the one-time command.
4. Run the generated command in a shell:

```bash
printf '%s\\n' 'URL server: https://arcoxdex.vercel.app/mcp Token: arx_at_...' | npx --yes arcox-agent@0.1.20 connect
```

5. The connector validates `initialize`, `tools/list`, and read-only `arcox_session_status`, then writes the remote header configuration to the Hermes profile.
6. Start a new Hermes session and verify that MCP tools are available.

The connection token is scoped to one agent and one Agent Wallet MSCA. It is not a Passkey, private key, or general website login token. Do not reuse it for another agent. Do not use a local `arcox-agent` binary or `command -v arcox-agent`; an older Agent Jobs CLI can produce `ready_to_link` and `127.0.0.1:8787/agent` instead of connecting the remote MSCA.
