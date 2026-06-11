# ARCOX MCP

ARCOX MCP is a local MCP server and terminal agent for ARCOX DEX retail flows.

It exposes tools for:

- Wallet balances across EOA, Circle proxy wallet, and Solana Devnet
- Swap quote and execution
- Bridge quote and execution
- Send quote and execution
- ARCOX Pay invoice/payment request tools
- Bridge retry and transaction history
- ARCOX Agentic Economy job actions
- ARCOX DEX UI/action map for agents
- Dynamic-style ARCOX docs search/read tools

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
```

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
3. User confirms with `yes`, `ya`, `confirm`, `konfirmasi`, `lanjut`, or `ok`.
4. Call execute tool with `confirmed=true`, the exact `previewId`, and `confirmationText`.

The agent must not skip the preview step.

## Tools

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

## Circle Gateway Nanopayments Readiness

ARCOX MCP understands Circle Gateway Nanopayments as a future x402 rail:

1. API returns `402 Payment Required`.
2. Buyer signs an offchain EIP-3009 authorization.
3. Buyer retries with the proof.
4. Gateway batch settlement is future work for ARCOX.

Do not tell users gas-free nanopayments are live. Current ARCOX Pay invoices remain public USDC payment links on Arc Testnet.

## CLI Examples

```bash
arcox-agent status
arcox-agent "show all wallet balances"
arcox-agent "quote bridge 1 usdc from arc to base"
arcox-agent "send 1 eurc from eoa to 0x..."
arcox-agent "create payment request 10 usdc to 0xMerchant for AI agent setup"
arcox-agent "quote payment invoice inv_..."
arcox-agent "retry bridge 0xBURN_TX from arbitrum sepolia to arc"
```

For execution, inspect the preview first and then confirm.

ARCOX Pay invoice payment uses quote-before-execute. The execute call must pass the quoted `previewId` and the same invoice amount, token, and merchant address from `previewArgs`.

## Security

- Private keys stay on the user's computer in `.env`.
- ARCOX DEX web UI does not receive the private key.
- MCP execution is local to the user's agent process.
- `arcox-agent status` reports `envSecurityWarnings` when the `.env` file is readable by group/other users.
- Keep `.env` outside synced folders and never paste private keys into chat.
