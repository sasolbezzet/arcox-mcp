# ARCOX MCP

ARCOX MCP adalah MCP server + terminal agent untuk ARCOX DEX. Paket ini dipakai
dua cara:

1. **Remote MCP (cara yang direkomendasikan)** — agent (Grok, Claude, ChatGPT,
   Hermes, Codex) terhubung ke `https://arcoxdex.vercel.app/mcp` memakai OAuth
   atau connection token, dan bertransaksi dari **Agent Wallet (MSCA)** milik
   user yang diotorisasi dengan passkey.
2. **Local stdio MCP** — `arcox-mcp` sebagai proses lokal untuk operasi EOA/SCA
   lokal (legacy path, tetap tersedia).

Untuk pengguna umum, install `arcox-agent`, bukan `arcox-mcp` langsung:
`arcox-agent` menarik `arcox-mcp` otomatis dan menambahkan alur
`setup`, `connect`, `sync`, `doctor` untuk Hermes/Codex.

## Install

```bash
npm install -g arcox-mcp      # atau: npx arcox-mcp
```

Binary yang tersedia:

```text
arcox-mcp            server stdio MCP
arcox                CLI low-level
arcox-runtime-agent  wrapper runtime agent
```

## Remote MCP (MSCA, per-agent)

```text
URL  : https://arcoxdex.vercel.app/mcp
Auth : OAuth 2.1 (DCR + PKCE S256) atau connection token dari halaman Plugin
```

Alur OAuth:

1. Agent membuka halaman approval ARCOX (`/plugin?auth=mcp&request_id=...`).
2. User menyelesaikan approval: pilih/aktifkan Agent Wallet lalu setujui
   dengan **passkey** (dan SIWE hanya bila sesi owner belum ada).
3. Agent menukar authorization code di `/api/auth/token` dan menyimpan token.
4. Agent memanggil `tools/list` dan mulai bertransaksi.

Satu agent = satu `clientId` = satu Agent Wallet dengan limit harian, scope
audit, card link, dan status revoke sendiri. Jangan pakai ulang token milik
agent lain.

Hermes juga bisa memakai **connection token** (`arcox_conn_*`) yang dibuat dari
kartu agent di halaman Plugin:

```bash
ARCOX_MCP_URL=https://arcoxdex.vercel.app/mcp arcox-agent connect --prompt-token
```

> Catatan: ARCOX **tidak** menyediakan device-code OAuth flow
> (RFC 8628). Metadata OAuth hanya mengiklankan
> `grant_types_supported: authorization_code, refresh_token` dan
> `code_challenge_methods_supported: S256`.

### Kalau agent tidak menemukan tool

Gejala "agent terhubung tetapi tidak bisa membaca tool ARCOX" hampir selalu
berarti token belum pernah terbit (halaman approval belum selesai), bukan
masalah daftar tool. Cek dari repo backend:

```bash
cd /home/ubuntu/arc-dex-api
npm run diag:mcp -- --agent grok
```

Skrip akan menampilkan: klien mana yang punya token aktif, klien mana yang
belum pernah menukar kode, jumlah tool yang benar-benar diterima klien mode
JSON maupun SSE, dan hasil `tools/call`.

## Config agent

### Hermes

```yaml
mcp_servers:
  arcox:
    url: "https://arcoxdex.vercel.app/mcp"
    auth: oauth
```

Atau dengan token koneksi:

```bash
hermes mcp add arcox --url https://arcoxdex.vercel.app/mcp --auth header
hermes mcp test arcox
```

### Codex / stdio lokal

```json
{
  "mcpServers": {
    "arcox": {
      "command": "arcox-agent",
      "args": ["mcp"]
    }
  }
}
```

## Tools (88 tool aktif)

Wallet, swap, bridge, send:

```text
arcox_wallet_balances              arcox_quote_swap / arcox_execute_swap
arcox_transaction_history          arcox_quote_bridge / arcox_execute_bridge
arcox_route_status                 arcox_bridge_status / arcox_retry_bridge_mint
arcox_session_status               arcox_quote_send / arcox_execute_send
arcox_mcp_info                     arcox_get_request
```

Vault:

```text
arcox_vault_list_credentials  arcox_vault_request_approval  arcox_vault_get_limits
```

ARCOX Intel (read-only, dibayar x402):

```text
arcox_intel_get_address        arcox_intel_get_entity        arcox_intel_get_token
arcox_intel_get_balances       arcox_intel_get_portfolio     arcox_intel_get_contract
arcox_intel_get_tx             arcox_intel_search            arcox_intel_get_flows
arcox_intel_get_history        arcox_intel_get_volume        arcox_intel_get_counterparties
arcox_intel_get_risk           arcox_intel_get_loans         arcox_intel_get_network
arcox_intel_get_solana_subaccounts  arcox_intel_get_transfers arcox_intel_get_global_transfers
arcox_intel_get_swaps          arcox_intel_get_portfolio_series
arcox_intel_get_market         arcox_intel_get_hypercore     arcox_intel_get_polymarket
arcox_intel_quote_wallet_report  arcox_intel_execute_wallet_report
arcox_x402_pay_invoice         arcox_x402_invoice_status
```

Pembayaran (ARCOX Pay):

```text
arcox_create_payment_request   arcox_get_payment_request   arcox_quote_payment_request
arcox_pay_payment_request      arcox_check_payment_status  arcox_pay_get_payment_status
arcox_pay_list_recent_payments
```

Cards:

```text
arcox_card_config   arcox_card_list_merchants   arcox_card_balance   arcox_card_fund
arcox_card_create   arcox_card_list             arcox_card_spend     arcox_card_transactions
arcox_card_refund_tx
```

Agentic economy (ERC-8004 / ERC-8183 di Arc):

```text
arcox_agent_status             arcox_agentic_register_agent   arcox_agentic_get_agent
arcox_agentic_create_job       arcox_agentic_get_job          arcox_agentic_set_budget
arcox_agentic_fund_job         arcox_agentic_submit_deliverable
arcox_agentic_complete_job     arcox_agentic_ask
list_agent_identities          select_agent_identity
list_agent_jobs                create_agent_job
```

AI Router:

```text
get_ai_router_status   get_ai_router_api_keys   create_ai_api_key   revoke_ai_api_key
list_ai_models         get_usage_logs           call_ai_model
```

Dokumentasi & katalog in-app:

```text
arcox_search_docs   arcox_read_doc   arcox_service_catalog   arcox_catalog
arcox_execution_guide   arcox_ui_map   arcox_action_plan
```

## Alur eksekusi yang aman

Semua tool yang memindahkan nilai memakai pola quote → preview → konfirmasi:

1. Panggil tool quote (`arcox_quote_*`).
2. Tampilkan preview (jumlah, token, chain, tujuan, fee) ke user.
3. User menyetujui dengan tepat `ya`/`yes`.
4. Panggil tool execute dengan `confirmed=true`, `previewId` yang sama, dan
   `confirmationText` dari user.

Agent tidak boleh melewati langkah preview. Sumber eksekusi agent remote adalah
**Agent Session Key (MSCA)** — passkey-gated, gasless, dibatasi limit harian.

## Interoperabilitas transport

Server melayani beberapa gaya klien sekaligus:

- Klien `Accept: application/json` saja → jawaban JSON (bukan SSE).
- Klien `Accept: application/json, text/event-stream` (Claude/ChatGPT) → SSE.
- Klien yang tidak mengirim `Mcp-Session-Id` → dilayani tanpa sesi.
- Field tasks-extension `execution` tidak dikirim karena server tidak
  mengiklankan capability `tasks`; klien dengan skema ketat gagal mem-parse
  seluruh `tools/list` bila ada field asing.

## x402 / pembayaran Intel

1. Endpoint ARCOX mengembalikan `402 Payment Required`.
2. Agent menampilkan jumlah USDC Arc Testnet yang tepat + invoice + memo ID.
3. User menyetujui.
4. Agent membayar lewat Arc Transaction Memo dan memantau status invoice.
5. Invoice `paid` membuka hasil Arkham melalui ARCOX API.

Unified Balance / Circle Gateway adalah rail pembayaran; eksekusi MCP saat ini
memakai USDC Arc Testnet publik. Jangan menyatakan nanopayments gas-free sudah
live.

## CLI

```bash
arcox-runtime-agent status
arcox-runtime-agent "show all wallet balances"
arcox-runtime-agent "quote bridge 1 usdc from arc to base"
arcox-runtime-agent "create payment request 10 usdc to 0xMerchant for AI agent setup"
arcox
```

## Environment

```bash
ARCOX_MAX_TX_USDC=10          # batas per transaksi
ARCOX_DAILY_LIMIT_USDC=50     # batas harian
ARCOX_MAX_TX_NATIVE=0.1       # batas native (bridge ETH)
```

- Secret signer hanya di `~/.arcox/agent.env` (mode `600`); secret backend
  hanya di `~/arc-dex-api/.env`. Jangan menyalin secret antar repo.
- `arcox-runtime-agent status` melaporkan `envSecurityWarnings` bila env file
  terbaca oleh group/other.
- Jangan pernah menempelkan token koneksi/private key ke chat, argumen
  perintah, log, atau konfigurasi aplikasi.

## Testing

```bash
npm test        # check + node --test test/*.test.mjs
```

Alur OAuth/MSCA end-to-end diuji dari repo backend:
`npm run test:e2e:flows` (passkey + EOA virtual, UserOperation nyata di Arc
testnet), `npm run test:e2e:ui` (menu Plugin di Chrome nyata), dan
`npm run diag:mcp` untuk diagnosa konektor.
