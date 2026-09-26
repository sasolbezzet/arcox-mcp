// arcRpc.mjs — resolusi RPC Arc untuk runtime MCP/agen.
//
// Sejak mainnet aktif, endpoint testnet (Arc testnet publik, dRPC testnet, dan
// RPC Canteen `~/.arc-canteen/env`) sengaja TIDAK dipakai lagi: agen tidak boleh
// diam-diam menembak testnet saat pengguna menjalankan aksi mainnet.

export const PUBLIC_ARC_RPC = 'https://rpc.mainnet.arc.io'

// Endpoint testnet yang dikenali untuk ditolak (dipakai sebagai dokumentasi dan
// pengaman kalau masih ada yang mengirimnya lewat env).
export const LEGACY_TESTNET_RPCS = [
  'https://rpc.testnet.arc.network',
  'https://rpc.testnet.arc.io',
  'https://arc-testnet.drpc.org',
]

function validRpc(value) {
  try {
    const url = new URL(String(value || '').trim())
    return /^https?:$/.test(url.protocol) ? url.toString().replace(/\/$/, '') : ''
  } catch {
    return ''
  }
}

function isTestnetRpc(url) {
  const value = String(url || '').toLowerCase()
  if (!value) return false
  if (LEGACY_TESTNET_RPCS.some(legacy => value === legacy.toLowerCase())) return true
  return /testnet|devnet|arc-canteen|thecanteenapp/.test(value)
}

/**
 * Resolve RPC Arc mainnet.
 *
 * Prioritas: ARC_MAINNET_RPC_URL → ARC_RPC_URL/ARC_RPC/RPC → CANTEEN_RPC_URL,
 * tapi setiap kandidat yang jelas-jelas testnet dibuang, dan fallback terakhir
 * adalah RPC mainnet publik. Opsi lama (`preferCanteen`, `canteenRpc`) tetap
 * diterima supaya pemanggil lama tidak pecah.
 */
export function resolveArcRpc({
  configuredRpc = process.env.ARC_MAINNET_RPC_URL || process.env.CANTEEN_RPC_URL,
  applicationRpc = process.env.ARC_RPC || process.env.ARC_RPC_URL || process.env.RPC,
  canteenRpc = '',
} = {}) {
  const candidates = [
    validRpc(process.env.ARC_MAINNET_RPC_URL),
    validRpc(configuredRpc),
    validRpc(process.env.ARC_RPC_URL || process.env.ARC_RPC || process.env.RPC),
    validRpc(applicationRpc),
    validRpc(canteenRpc),
  ]
  return candidates.find(url => url && !isTestnetRpc(url)) || PUBLIC_ARC_RPC
}

export function arcRpcUrls(options = {}) {
  return [...new Set([resolveArcRpc(options), PUBLIC_ARC_RPC].filter(Boolean))]
}
