# ARCOX MCP Server

Purpose: give Codex/Hermes agents a structured view of ARCOX DEX and execute supported retail actions through MCP tools. Agents should call these MCP tools directly instead of searching the repository or running `npm run codex-agent`.

Run locally:

```bash
cd ~/.arcox
arcox-mcp
```

For Hermes-style MSCA execution, prefer the hosted MCP OAuth connection instead of local stdio:

```yaml
mcp_servers:
  arcox:
    url: "https://arcoxdex.vercel.app/mcp"
    auth: oauth
```

Same-device binding (browser + Passkey on the same computer as Hermes):

```yaml
oauth:
  redirect_host: localhost
```

Cross-device binding (Passkey on mobile, Hermes on another computer): run `hermes mcp login arcox`, open the authorize URL on mobile, complete ARCOX Passkey, copy the final redirect URL, and paste it into the Hermes prompt.

The hosted flow is the same connection model used by Claude: Hermes handles OAuth/PKCE, the user completes the ARCOX browser Passkey flow, and the backend binds the MCP session to the active Agent Wallet (MSCA). No `ARCOX_MSCA_SESSION_TOKEN` is needed in Hermes env.

Example MCP config:

```json
{
  "mcpServers": {
    "arcox": {
      "command": "node",
      "args": ["/path/to/arcox-mcp/packages/runtime/mcp/server.mjs"],
      "env": {
        "ARCOX_WEB_URL": "https://arcoxdex.vercel.app/",
        "ARCOX_API_URL": "https://arcoxdex.vercel.app"
      }
    }
  }
}
```

Initial resources:

- `arcox://ui/pages`
- `arcox://ui/actions`
- `arcox://ui/chains`
- `arcox://rules/retail-safety`
- `arcox://deployments/router`

Tools:

- `arcox_ui_map`: returns the full static UI/action registry.
- `arcox_action_plan`: maps a user intent into an ARCOX action plan and missing slots.
- `arcox_route_status`: checks chain/source/token support and router-fee applicability.
- `arcox_agent_status`: returns the local signer address and Arc balances.
- `arcox_quote_bridge`: quotes a USDC bridge route, platform fee, and estimated receive amount.
- `arcox_execute_bridge`: executes a confirmed USDC bridge. Without `confirmed: true`, it returns a quote only.
- `arcox_retry_bridge`: retries CCTP mint for a pending bridge burn. Without `confirmed: true`, it returns a preview only.
- `arcox_quote_send`: quotes an Arc token send and platform fee.
- `arcox_execute_send`: executes a confirmed Arc token send. Without `confirmed: true`, it returns a quote only.
- `arcox_quote_swap`: quotes an Arc swap. Default source is the local EOA agent wallet; use `source="circle"` only when the user explicitly asks for Circle proxy wallet.
- `arcox_execute_swap`: executes a confirmed Arc swap. EOA uses local `AGENT_PRIVATE_KEY` to sign approve and Circle AppKit adapter execute transactions. Without `confirmed: true`, it returns a quote only.
- `get_unified_balance`: reads live Circle Gateway Unified Balance and pending deposits for the local signer by default.
- `quote_unified_balance_deposit`, `deposit_unified_balance`: preview and execute a real testnet USDC deposit with explicit confirmation.
- `quote_ai_router_auto_pay`, `set_ai_router_auto_pay`: preview and enable/disable Unified Balance Auto Pay with explicit confirmation.
- `create_ai_api_key`, `delete_ai_api_key`: create or revoke an ARCOX AI Router key for the local signer.
- `arcox_create_payment_request`: creates an ARCOX Pay public USDC invoice/payment link on Arc Testnet.
- `arcox_get_payment_request`, `arcox_quote_payment_request`, `arcox_pay_payment_request`, `arcox_check_payment_status`: read, quote, pay, and track ARCOX Pay invoices.
- `arcox_x402_invoice_status`: checks internal ARCOX x402 invoices paid by Arc memo/ERC20 reconciliation or compatible Circle inbound webhook.
- `arcox_intel_quote_wallet_report`, `arcox_intel_execute_wallet_report`, `arcox_intel_get_address`, `arcox_intel_get_tx`, `arcox_intel_get_contract`, `arcox_intel_get_entity`, `arcox_intel_get_token`, `arcox_intel_search`: request ARCOX Intel via ARCOX API/x402. MCP does not store `ARKHAM_API_KEY`.
  - `arcox_intel_get_address.service`: `basic`, `all`, `enriched`, `balances`, `counterparties`, `flows`, `history`, `volume`, `portfolio`.
  - `arcox_intel_get_tx.service`: `basic`, `transfers`.
  - `arcox_intel_get_entity.service`: `basic`, `summary`, `balances`, `flows`.
  - `arcox_intel_get_token.service`: `basic`, `market`, `holders`, `top-flow`, `trending`, `top`, `contract`, `contract-holders`.
- `arcox_agent_job`: plans and executes Agentic Economy operations: register agent, create/read job, set budget, fund, submit, and complete.

Execution safety:

- Value-moving tools must be called first as quote/preview.
- Execute tools only submit transactions when `confirmed: true`, a valid `previewId` is supplied, and the user confirmation text is exactly `yes` or `ya`.
- EOA execution uses the configured local signer from the protected central env; secret values are never returned.
- The hosted OAuth MCP path uses `source="session"` for MSCA execution; the local runtime's `source="msca"` compatibility path is optional and requires an explicitly configured local session.
- Circle proxy wallet actions use the ARCOX backend auth session signed by the local agent key and must be explicitly requested with `source="circle"`.
- ARCOX Intel x402 uses internal invoices and Arc transaction memos for payment reconciliation. MCP pays after preview/confirmation, polls status, and never asks users to submit a txHash manually.
- Browser-wallet signing from the Web UI remains separate from terminal/MCP execution.
