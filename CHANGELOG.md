# Changelog

## 0.1.55

- Document Hermes/Claude remote OAuth MCP connection model for MSCA transactions. Hermes connects to the hosted `/mcp` endpoint with `auth: oauth`, completes ARCOX browser Passkey pairing, and the backend binds the MCP session to the active Agent Wallet (MSCA). No `ARCOX_MSCA_SESSION_TOKEN` env entry is required.
- Support same-device binding (`redirect_host: localhost`) and cross-device binding via Cloudflare Quick Tunnel or paste-back.
- Add `arcox_wallet_modes` and `arcox_msca_status` tools so agents can describe EOA, SCA, and MSCA sources and read the active MSCA session.
- Normalize tool `source` across `eoa`, `sca`/`circle`, and `msca`, keeping preview/confirmation guards for every value-moving action.

## 0.1.42

- Prevent EOA swaps from sending a second platform-fee transfer after the Circle adapter already collected the quoted fee.
- Normalize optional empty RPC quantities without weakening required swap execution fields.
- Refuse to load local signing secrets from group/world-accessible env files.
- Update viem/ws and add regression tests for transaction hardening.

## 0.1.41

- Clarify that swap `amountIn` is a human-readable decimal token amount, never base units, so tool-capable models preserve requests such as `1 EURC` exactly.

## 0.1.40

- Report the published `arcox-mcp` package version dynamically in MCP `initialize` responses so release metadata stays in sync.

## 0.1.39

- Stop exporting the `arcox-agent` global binary from `arcox-mcp` to avoid clobbering the dedicated `arcox-agent` installer package.
- Rename the standalone runtime prompt wrapper binary to `arcox-runtime-agent`.
- Document that `arcox-agent` installs `arcox-mcp` automatically for end-user setup flows.

## 0.1.36

- Restore standard bearer API keys and direct production OpenAI-compatible access without API Pass or signed sessions.

## 0.1.35

- Accept the Hermes API key through the local signed-session proxy without requiring a duplicate API key env entry.

## 0.1.34

- Accept the non-secret `arcox-local` credential only on the localhost AI proxy so Hermes does not need the real API key in its config.

## 0.1.33

- Repair API Pass creation after session signer fallback was introduced.

## 0.1.32

- Reload protected local API/session credentials when the agent env changes.

## 0.1.31

- Retry API sessions with the API Pass owner signer when a dedicated session signer is not authorized.
- Preserve upstream authentication status codes through the local OpenAI-compatible proxy.

## 0.1.26

- Include pending-funded chains when preparing per-chain Auto Pay delegation.

## 0.1.25

- Resolve Auto Pay readiness through the ARCOX backend to avoid browser Gateway info failures.
- Preserve pending per-chain setup and turn the backend policy off before delegate revocation.

## 0.1.24

- Configure AI Router Auto Pay for every funded EVM Unified Balance source chain.
- Report per-chain delegate readiness and transaction results.

## 0.1.23

- Add Arc ERC-8004 identity discovery and active identity selection tools.
- Bind Agent Jobs and paid Intel requests to the selected owner identity.
- Attach Arc Transaction Memos to identity-bound ERC-8183 job calls.
- Require preview plus explicit `yes`/`ya` for both current and legacy Agent Job tools.

## 0.1.22

- Persist quote previews across MCP process restarts so Hermes can execute the confirmed preview.
- Validate swap calldata numeric fields before approval and replace ambiguous BigInt errors with safe diagnostics.

## 0.1.21

- Add live Unified Balance reads and confirmed AppKit deposit tools for the local agent signer.
- Add previewed Auto Pay on/off tools plus AI Router API key create/delete support.
- Fix MCP EOA swap execution to process backend `legs[]` calldata and expose route availability clearly.

## 0.1.20

- Present paid ARCOX Intel results as labeled MCP sections instead of raw or unlabeled values.
- Include x402 payment receipt, request context, data coverage, provider fields, records, and interpretation notes.
- Remove duplicate raw Arkham payloads from MCP output while retaining structured result detail.

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
# 0.1.27

- Bind new AI Router keys to an Arc Testnet API Pass SBT.
- Add signed short-lived API sessions and local OpenAI-compatible proxy support.
- Add MCP tools for session creation, refresh, and API key status.
# 0.1.28

- Keep the local proxy alive when session creation fails.
- Allow authenticated model discovery without a Gateway balance estimate.
# 0.1.29

- Load ARCOX runtime settings from one protected API env.
- Add retry idempotency so identical model requests are not charged twice.
- Remove private-key placeholders from terminal output and docs.
# 0.1.30

- Require API Pass owner-wallet and Agent Identity match before every value-moving MCP action.
- Separate local user signer secrets from backend delegate/provider secrets.
- Apply owner-only runtime file permissions by default.
