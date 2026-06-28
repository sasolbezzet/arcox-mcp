# ARCOX MCP

ARCOX MCP is a local MCP server and terminal agent for ARCOX DEX retail flows.

It exposes tools for:

- Wallet balances across EOA, Circle proxy wallet, and Solana Devnet
- Swap quote and execution from the local EOA agent wallet by default, with optional Circle proxy wallet source
- Bridge quote and execution, including native ETH to Arc on verified Ethereum/Base Sepolia routers
- Send quote and execution
- ARCOX Pay invoice/payment request tools
- ARCOX Intel tools that call ARCOX API x402 endpoints; MCP never stores `ARKHAM_API_KEY` and never calls Arkham directly
- Bridge retry and transaction history
- ARCOX Agentic Economy job actions
- ARCOX DEX UI/action map for agents
- Dynamic-style ARCOX docs search/read tools

## Circle Agents Alignment

ARCOX MCP follows the Circle for Agents direction: USDC-native agent workflows, paid API readiness, and quote-before-execute safety. Current support is:

- EOA agent wallet swap/send/bridge/payment using the user's local `AGENT_PRIVATE_KEY`.
- Circle proxy wallet support only when a tool is explicitly called with `source="circle"`.
- ARCOX Pay invoice/payment request tools for public USDC payment links on Arc Testnet.
- x402 real testnet Arc USDC memo payments for ARCOX Intel.

ARCOX does not claim live gas-free nanopayments or private payments. Those remain future integration work.

## Install

```bash
npm install -g arcox-mcp
```

Or run without global install:

```bash
npx arcox-mcp
```

## Environment

Create a working folder on the user's computer:

```bash
mkdir -p ~/.arcox
nano ~/.arcox/.env
chmod 600 ~/.arcox/.env
```

Minimum EVM setup:

```bash
AGENT_PRIVATE_KEY=0x...
ARC_RPC=https://rpc.testnet.arc.network/
ARCOX_API_URL=https://arc-dex-bice.vercel.app
```

Optional Solana Devnet setup:

```bash
SOLANA_PRIVATE_KEY=[1,2,3,...]
SOLANA_DEVNET_RPC=https://api.devnet.solana.com
```

Optional safety limits:

```bash
ARCOX_MAX_TX_USDC=10
ARCOX_DAILY_LIMIT_USDC=50
ARCOX_MAX_TX_NATIVE=0.1
```

Native bridge examples:

```bash
bridge 0.001 ETH from Base Sepolia to Arc
bridge 0.001 ETH from Ethereum Sepolia to Arc
```

Native bridge uses the local EOA agent wallet only. Circle Wallet source supports USDC bridge routes, not native ETH.

When installed globally, run commands from `~/.arcox` so the local `.env` file is loaded:

```bash
cd ~/.arcox
arcox-agent status
```

## MCP Config

### Codex

Add an MCP server entry that runs:

```bash
arcox-mcp
```

Example config shape:

```json
{
  "mcpServers": {
    "arcox": {
      "command": "arcox-mcp",
      "args": [],
      "env": {
        "ARCOX_MCP_DEBUG": "arcox-mcp.log"
      }
    }
  }
}
```

### Hermes

```bash
hermes mcp add arcox -- arcox-mcp
```

If Hermes uses a profile config, make sure `args` is an array, not a string:

```yaml
mcp_servers:
  arcox:
    command: arcox-mcp
    args: []
```

## Safe Execution Flow

All value-moving tools require a quote/preview first:

1. Call quote tool.
2. Show preview to the user.
3. User confirms with exactly `yes` or `ya`.
4. Call execute tool with `confirmed=true`, the exact `previewId`, and `confirmationText`.

The agent must not skip the preview step.

## Tools

Identity and jobs:

- `get_agent_identity`
- `list_agent_identities`
- `select_agent_identity`
- `create_agent_job`
- `list_agent_jobs`

Agent Jobs require an owned active Arc ERC-8004 identity. `create_agent_job` uses preview and explicit confirmation, then attaches an Arc Transaction Memo to the ERC-8183 call.

- `arcox_wallet_balances`
- `arcox_transaction_history`
- `arcox_quote_swap`
- `arcox_execute_swap`
- `arcox_quote_bridge`
- `arcox_execute_bridge`
- `arcox_quote_send`
- `arcox_execute_send`
- `arcox_create_payment_request`
- `arcox_get_payment_request`
- `arcox_quote_payment_request`
- `arcox_pay_payment_request`
- `arcox_check_payment_status`
- `arcox_simulate_circle_webhook`
- `arcox_quote_eco_route_payment`
- `arcox_retry_bridge`
- `arcox_route_status`
- `arcox_ui_map`
- `arcox_action_plan`
- `arcox_search_docs`
- `arcox_read_doc`
- `arcox_agent_status`
- `arcox_agent_job`
- `get_ai_router_status`
- `get_unified_balance`
- `quote_unified_balance_deposit`
- `deposit_unified_balance`
- `quote_ai_router_auto_pay`
- `set_ai_router_auto_pay`
- `create_ai_api_key`
- `delete_ai_api_key`
- `list_ai_models`
- `call_ai_model`
- `get_usage_logs`

ARCOX AI Router:

- MCP can deposit testnet USDC to Unified Balance and enable/disable Auto Pay with preview and explicit confirmation.
- Auto Pay setup covers each funded EVM source chain; delegated AI spends use only chains whose authorization is ready.
- API keys use `arx_sk_...`; backend stores only hashes.
- MCP can create a key with the local `AGENT_PRIVATE_KEY` owner session.
- MCP can call models with `ARCOX_AI_ROUTER_API_KEY`; each request is paid from user Unified Balance through backend delegated spend.
- Provider API keys are never stored in MCP; MCP only calls ARCOX API.

OpenAI-compatible config:

```text
base_url = https://arc-dex-bice.vercel.app/v1
api_key = arx_sk_...
model = arcox/auto
```

ARCOX Intel x402 service coverage:

- `arcox_intel_get_address` supports `service`: `basic`, `all`, `enriched`, `balances`, `counterparties`, `flows`, `history`, `volume`, `portfolio`.
- `arcox_intel_get_tx` supports `service`: `basic`, `transfers`.
- `arcox_intel_get_entity` supports `service`: `basic`, `summary`, `balances`, `flows`.
- `arcox_intel_get_token` supports `service`: `basic`, `market`, `holders`, `top-flow`, `trending`, `top`, `contract`, `contract-holders`.

ARCOX Intel x402 payments use Arc transaction memos. The agent pays USDC through the Arc Memo contract, attaching the invoice/payment reference on-chain for reconciliation.

## Circle Gateway Nanopayments Readiness

ARCOX MCP understands Arc x402 payments as:

1. API returns `402 Payment Required`.
2. Agent previews exact Arc Testnet USDC amount, recipient, invoice, and memo ID.
3. User confirms `yes`.
4. Agent pays through Arc Memo contract and polls invoice status.
5. Paid invoice unlocks the Arkham result through ARCOX API.

Do not tell users gas-free nanopayments are live. Unified Balance/Gateway are payment rails; current MCP execution uses public Arc Testnet USDC.

## CLI Examples

```bash
arcox-agent status
arcox-agent "show all wallet balances"
arcox-agent "quote swap 1 eurc to usdc from eoa"
arcox-agent "quote bridge 1 usdc from arc to base"
arcox-agent "send 1 eurc from eoa to 0x..."
arcox-agent "create payment request 10 usdc to 0xMerchant for AI agent setup"
arcox-agent "quote payment invoice inv_..."
arcox-agent "retry bridge 0xBURN_TX from arbitrum sepolia to arc"
```

For execution, inspect the preview first and then confirm.

ARCOX Pay invoice payment uses quote-before-execute. The execute call must pass the quoted `previewId` and the same invoice amount, token, and merchant address from `previewArgs`.

Swap uses EOA by default. To use the Circle proxy wallet, the tool call must explicitly include `source="circle"` in both quote and execute.

## Security

- Private keys stay on the user's computer in `.env`.
- ARCOX DEX web UI does not receive the private key.
- MCP execution is local to the user's agent process.
- `arcox-agent status` reports `envSecurityWarnings` when the `.env` file is readable by group/other users.
- Keep `.env` outside synced folders and never paste private keys into chat.
