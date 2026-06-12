# Changelog

## 0.1.5

- Add native ETH bridge quote/execution support from Ethereum Sepolia and Base Sepolia to Arc through `ArcoxNativeSwapBridgeRouter`.
- Add MCP native router deployment resource and native transaction safety limit `ARCOX_MAX_TX_NATIVE`.
- Align MCP docs with Circle for Agents: USDC-native agent workflows, paid API/x402 readiness, and no live gas-free nanopayments claim.
- Make MCP swap default to EOA agent wallet instead of Circle proxy wallet.
- Add EOA swap execution through ARCOX backend `/api/eoa-swap-prepare` plus local `AGENT_PRIVATE_KEY` approve/adapter execute signing.
- Keep Circle proxy swap available only when `source="circle"` is explicitly quoted and confirmed.
- Document ARCOX Pay invoice/payment request MCP tools for create, quote, pay, and status.

## 0.1.4

- Add Dynamic-style documentation discovery tools: `arcox_search_docs` and `arcox_read_doc`.
- Document Circle Gateway Nanopayments/x402 readiness as future settlement, not a live gas-free payment claim.

## 0.1.3

- Add local `.env` permission warnings to `arcox-agent status`.
- Document `chmod 600 ~/.arcox/.env`.
- Update MCP server version metadata.

## 0.1.2

- Add ARCOX Pay MCP tools for invoice creation, quote, payment, status, webhook simulation, and Eco route preview.
- Keep ARCOX Pay payment quote-before-execute with invoice amount/token/merchant binding.

## 0.1.1

- Sync auto-mint history with backend transaction history.

## 0.1.0

- Initial public ARCOX MCP package for wallet balances, swap, bridge, send, history, retry bridge, route status, UI map, and agentic job tools.
