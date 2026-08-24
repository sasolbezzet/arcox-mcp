// Wallet source policy shared by Hermes/Codex-style MCP clients.
// EOA and SCA remain supported for compatibility; MSCA is the preferred
// session-key source for remote/agent execution.
export const WALLET_SOURCES = Object.freeze(['eoa', 'sca', 'msca'])

export function normalizeWalletSource(value, fallback = 'eoa') {
  const raw = String(value || fallback).trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (raw === 'msca' || raw === 'session' || raw === 'sessionkey' || raw === 'agentwallet') return 'msca'
  if (raw === 'sca' || raw === 'circle' || raw === 'proxy') return 'sca'
  if (raw === 'eoa' || raw === 'local') return 'eoa'
  return fallback
}

export function walletSourceDescription(source) {
  switch (normalizeWalletSource(source)) {
    case 'msca': return 'Agent Wallet MSCA via active session key; backend executes UserOperation.'
    case 'sca': return 'Circle SCA/proxy wallet via Circle backend/App Kit.'
    default: return 'Local EOA signer using AGENT_PRIVATE_KEY; signing remains on this machine.'
  }
}

export function mscaSourceRequested(source) {
  return normalizeWalletSource(source) === 'msca'
}
