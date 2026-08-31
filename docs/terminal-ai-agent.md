# ARCOX Terminal AI Agent

This repository includes two agent paths for ARCOX DEX Agent Jobs:

- Hosted planner agent: `/api/agent/ask`
- Local terminal/onchain agent: `npm run agent`

The hosted planner is the default UI endpoint. It works for all logged-in users and returns a job plan, budget, provider/evaluator suggestion, deliverable text, and deliverable hash. It does not sign transactions.

The agent has two modes:

- HTTP endpoint mode for the ARCOX DEX UI.
- Onchain command mode for Arc testnet jobs.

## Agent Wallet connection (recommended)

The recommended path is an owner-controlled Agent Wallet MSCA. One owner may have multiple agents, but each agent receives its own `agentKey = clientId|ownerId`, MSCA wallet, limits, activity scope, card links, and revoke state.

1. Open the ARCOX DEX plugin and sign in with the owner wallet/passkey.
2. Select the intended Agent Wallet and choose **Buat Token Koneksi**.
3. Run the generated command in the Hermes shell:

```bash
printf '%s\\n' 'URL server: https://arcoxdex.vercel.app/mcp Token: arx_at_...' | npx --yes arcox-agent@0.1.20 connect
```

The connector must verify `initialize`, `tools/list`, and `arcox_session_status` before it writes the Hermes profile. It prints the token-bound MSCA address and active status without echoing the token.

4. The agent must run `hermes mcp test arcox`, confirm `tools/list` is successful, and start a new session.

The connection token is scoped to one agent wallet. Never reuse Agent A's token for Agent B. Rotation invalidates the old connection token; revocation invalidates all OAuth tokens for that agent. The token is stored in the Hermes profile credential file, not the local ARCOX signer env.

## Local legacy EOA agent (optional)

The existing local signer path remains available for users who explicitly need it. It is not required for an MSCA connection and must never be copied to ARCOX DEX or sent to the backend.

```text
User command
  -> local ARCOX agent CLI
  -> optional EOA_PRIVATE_KEY on user's computer
  -> Arc RPC / supported chain RPC
  -> onchain transaction
```

```bash
arcox-agent setup
# Edit ~/.arcox/agent.env only if local EOA signing is intentionally needed:
# EOA_PRIVATE_KEY=0xYOUR_LOCAL_AGENT_PRIVATE_KEY
arcox-agent doctor
```

An empty `EOA_PRIVATE_KEY` is valid: no EOA wallet block is created, while the remote MSCA tools remain available. Local value-moving commands still require a preview and explicit `--yes`.

For a direct installation, the package is:

```bash
npm install -g arcox-agent
```

The helper accepts a complete plugin message, validates the token, probes `initialize`, `tools/list`, and `arcox_session_status`, and only then writes Hermes configuration. It never echoes the token. Use the published `arcox-agent@0.1.20` connector; do not select an older local executable named `arcox-agent`.

## Start The Agent Endpoint

```bash
cd /home/ubuntu/arc-dex/arcox-agent
npm run agent -- serve --port 8787
```

Use this endpoint in the ARCOX DEX Agent Jobs UI:

```text
http://127.0.0.1:8787/agent
```

For normal users, keep the default hosted endpoint:

```text
/api/agent/ask
```

The endpoint accepts job prompts from the UI and returns:

- request ID
- accepted/rejected status
- suggested provider
- suggested evaluator
- suggested USDC budget
- deliverable text
- deliverable hash
- next steps

## Check Agent Wallet

```bash
npm run agent -- status
```

The wallet needs Arc testnet gas and USDC for actions that create, fund, submit, or complete jobs.

## Register Agent Identity

```bash
npm run agent -- register --metadata-uri ipfs://YOUR_METADATA
```

Copy the returned `agentId` into the ARCOX DEX Agent Jobs UI.

Also copy it into `.env` as `ARC_AGENT_ID` so `npm run agent -- identity` and `npm run agent -- connect` include the onchain Arc agent id.

## Retail Commands

Preview a command:

```bash
npm run agent -- run --prompt "send 1 USDC to 0x0000000000000000000000000000000000000000"
```

Execute a supported command after reviewing the preview:

```bash
npm run agent -- run --prompt "send 1 USDC to 0x0000000000000000000000000000000000000000" --yes
```

Current CLI execution support:

- `send`: can submit Arc token transfers from the local agent wallet.
- `create job`: can create an ERC-8183 job from the local agent wallet.
- `submit`: can submit a deliverable hash.
- `complete`: can complete a job from the evaluator wallet.

Current CLI planning support:

- `swap`: recognized as an intent, but autonomous execution is disabled until a CLI quote/route adapter is wired.
- `bridge`: recognized as an intent, but autonomous execution is disabled until a CLI CCTP/bridge adapter is wired.

For swap and bridge, use the ARCOX DEX web UI for now so the wallet signer sees route, quote, allowance, fee, and destination before signing.

## Link Agent In UI

1. Open ARCOX DEX.
2. Go to `Agent Jobs`.
3. Open `AI Link`.
4. Enter the onchain Agent ID.
5. Set endpoint:

```text
http://127.0.0.1:8787/agent
```

6. Sign the link message with the owner wallet.
7. Run a simulation prompt.

The UI will POST to the terminal agent endpoint. If the agent is not running, the UI will show an endpoint error.

## Read A Job

```bash
npm run agent -- read-job --job-id 1
```

## Submit A Deliverable

The provider wallet should run:

```bash
npm run agent -- submit --job-id 1 --deliverable "Completed deliverable proof"
```

## Complete A Job

The evaluator wallet should run:

```bash
npm run agent -- complete --job-id 1 --reason "approved"
```

## Full Test Flow

1. Start terminal agent:

```bash
npm run agent -- serve --port 8787
```

2. Connect ARCOX DEX UI.
3. Register or read an Agent ID.
4. Link the AI endpoint in `Agent Jobs -> AI Link`.
5. Run a prompt.
6. Use the prompt result to create a job.
7. Set budget and fund escrow.
8. Run terminal submit command.
9. Run terminal complete command.
10. Read the job again in UI or terminal.

## Per-agent security

- Never commit `EOA_PRIVATE_KEY`, MSCA tokens, connection tokens, PAN, or CVV.
- The backend trusts `mscaWalletAddress` from the OAuth token, not a user-supplied wallet label.
- Owner vault routes require the passkey/SIWE session; an MCP bearer cannot link cards, change limits, or revoke another agent.
- Use testnet-only keys for local EOA experiments. The remote Agent Wallet path does not require a private key in Hermes.

The hosted planner agent cannot approve, swap, bridge, send, submit, or complete using a user's wallet. It only creates structured intent. User-wallet actions must still be signed by the user in MetaMask or another wallet.
