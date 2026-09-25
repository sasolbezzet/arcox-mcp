#!/usr/bin/env node
// plan-mainnet-deploy.mjs — cetak rencana deploy kontrak ARCOX ke Arc mainnet.
//
// READ-ONLY: script ini TIDAK PERNAH mengirim transaksi. Ia hanya:
//   1. membaca manifest source hasil `fetch-verified-sources.mjs`,
//   2. query RPC mainnet (eth_chainId/eth_getBalance/eth_getCode),
//   3. mencetak urutan deploy + constructor args + env keluaran + blocker.
//
// Broadcast ada di jalur terpisah dan baru dibuat setelah operator menyetujui
// keputusan proxy admin, likuiditas pool, dan alamat cirBTC mainnet.
//
// Pemakaian:
//   node packages/runtime/scripts/plan-mainnet-deploy.mjs
//   ARCOX_MAINNET_DEPLOYER_ADDRESS=0x… node packages/runtime/scripts/plan-mainnet-deploy.mjs
//   ARCOX_MAINNET_RPC_URL=https://… node packages/runtime/scripts/plan-mainnet-deploy.mjs

import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const runtimeRoot = dirname(__dirname)
const sourcesDir = join(runtimeRoot, 'mainnet-sources')
const manifestPath = join(sourcesDir, 'manifest.json')

loadEnv(join(dirname(runtimeRoot), '.env'))

const MAINNET = {
  chainId: 5042,
  chainIdHex: '0x13b2',
  rpc: process.env.ARCOX_MAINNET_RPC_URL || 'https://rpc.mainnet.arc.io',
  usdc: '0x3600000000000000000000000000000000000000',
  eurc: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1',
  usyc: '0x8a5D989Bbb96929F689B0200f435f53dA42bF490',
  // Belum terverifikasi di mainnet. AMM cirBTC tidak bisa di-deploy tanpa ini.
  cirbtc: String(process.env.ARCOX_MAINNET_CIRBTC_ADDRESS || '').trim(),
  tokenMessenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
  cctpDomain: 26,
  explorer: 'https://explorer.arc.io',
}

const TESTNET_REF = {
  usdc: '0x3600000000000000000000000000000000000000',
  eurc: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  cirbtc: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
  tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
  treasury: '0xE34FF1D2C925DDafB28C95C2396fC49A6f64569e',
  swapAdapterLogic: '0xb4d0aa6ca5e12b8a77b86989305a7f15462ac2d4',
  swapAdapterProxyAdmin: '0x6a736b8dea7d4b18b881b7fc4fc16072f6018b7a',
  agenticCommerceImpl: '0xa316fd02827242d537f84730f8a37d0ba5fd351a',
}

const REQUIRED_ENV = [
  ['ARCOX_FEE_ROUTER_ADDRESS_MAINNET', 'Fee Router (ArcoxRouter)', 'ArcoxRouter'],
  ['ARCOX_AMM_ROUTER_MAINNET', 'AMM Router (ArcoxCirBTCRouterV2)', 'ArcoxCirBTCRouterV2'],
  ['ARCOX_SWAP_ADAPTER_MAINNET', 'Swap Adapter proxy', 'TransparentUpgradeableProxy-SwapAdapter'],
  ['ARCOX_ERC8183_ADDRESS_MAINNET', 'ERC-8183 Agentic Commerce proxy', 'ERC1967Proxy-AgenticCommerce'],
]

function loadEnv(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const [key, ...rest] = trimmed.split('=')
    if (!process.env[key]) process.env[key] = rest.join('=').replace(/^['"]|['"]$/g, '')
  }
}

async function rpc(method, params = []) {
  const response = await fetch(MAINNET.rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`)
  const data = await response.json()
  if (data.error) throw new Error(data.error.message || 'RPC error')
  return data.result
}

function planSourceContract(label, { constructorArgs, envOut, note }) {
  const entry = (manifest?.contracts || []).find(item => item.label === label)
  const sourceMissing = !entry || entry.status !== 'verified'
  return {
    label,
    contractName: entry?.contractName || '?',
    compiler: entry?.compilerVersion || '?',
    optimization: entry?.optimization || null,
    evmVersion: entry?.evmVersion || null,
    sourceFile: entry?.sourceFile || null,
    constructorArgs,
    envOut,
    note,
    sourceMissing,
  }
}

if (!existsSync(manifestPath)) {
  console.error(`Manifest tidak ditemukan: ${manifestPath}`)
  console.error('Jalankan dulu: node packages/runtime/scripts/fetch-verified-sources.mjs')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const treasury = String(process.env.ARCOX_TREASURY_WALLET_ADDRESS_MAINNET || '').trim()
const deployer = String(process.env.ARCOX_MAINNET_DEPLOYER_ADDRESS || '').trim()
const deployerKey = String(process.env.ARCOX_MAINNET_DEPLOYER_PRIVATE_KEY || '').trim()
const testnetKey = String(process.env.AGENT_PRIVATE_KEY || '').trim()

let chainIdHex = null
let rpcError = null
try {
  chainIdHex = await rpc('eth_chainId')
} catch (error) {
  rpcError = error?.message || 'RPC unreachable'
}

console.log('=== Rencana deploy kontrak ARCOX ke Arc mainnet (DRY RUN — tanpa broadcast) ===\n')
console.log(`RPC            : ${MAINNET.rpc}`)
console.log(`Chain id       : ${chainIdHex || '?'}${chainIdHex === MAINNET.chainIdHex ? ' ✅' : ' ❌ (harus 0x13b2)'}`)
if (rpcError) console.log(`RPC error      : ${rpcError}`)
console.log(`Source snapshot: ${manifest.fetchedAt} (${(manifest.contracts || []).filter(c => c.status === 'verified').length} kontrak terverifikasi)`)
console.log(`Deployer       : ${deployer || deployerKey ? 'diset' : 'BELUM diset (ARCOX_MAINNET_DEPLOYER_ADDRESS / _PRIVATE_KEY)'}`)
if (deployerKey && testnetKey && deployerKey === testnetKey) console.log('❌ Deployer key sama dengan AGENT_PRIVATE_KEY testnet — wajib key terpisah.')
if (deployer) {
  const balance = await rpc('eth_getBalance', [deployer, 'latest']).catch(() => null)
  console.log(`Saldo deployer : ${balance ? (Number(BigInt(balance) / 10n ** 12n) / 1e6).toFixed(6) + ' USDC' : 'tidak diketahui'}`)
}
console.log(`Treasury mainnet: ${treasury ? treasury + (treasury === TESTNET_REF.treasury ? ' ❌ masih alamat testnet' : ' ✅') : 'BELUM diset (ARCOX_TREASURY_WALLET_ADDRESS_MAINNET)'}`)
console.log(`cirBTC mainnet : ${MAINNET.cirbtc || 'BELUM diketahui → memblokir AMM pool/router cirBTC'}`)

const plan = [
  planSourceContract('ArcoxRouter', {
    constructorArgs: `[initialOwner=${treasury || '<treasury mainnet>'}, initialTreasury=${treasury || '<treasury mainnet>'}, usdc_=${MAINNET.usdc}, tokenMessenger_=${MAINNET.tokenMessenger} (mainnet CCTP, BUKAN ${TESTNET_REF.tokenMessenger}), localDomain_=${MAINNET.cctpDomain}, feeBps_=<ARCOX_ROUTER_FEE_BPS>]`,
    envOut: 'ARCOX_FEE_ROUTER_ADDRESS_MAINNET',
    note: 'Lalu setSupportedDestinationDomain(domain, true) hanya untuk domain yang dipakai, dan verifikasi di explorer.arc.io.',
  }),
  planSourceContract('ArcoxCirBTCRouterV2', {
    constructorArgs: `[_treasury=${treasury || '<treasury mainnet>'}, _usdc=${MAINNET.usdc}, _eurc=${MAINNET.eurc}, _cirbtc=${MAINNET.cirbtc || '<cirBTC mainnet — BLOCKER>'}]`,
    envOut: 'ARCOX_AMM_ROUTER_MAINNET',
    note: 'Membutuhkan token cirBTC mainnet; kalau belum ada, lewati dan biarkan swap cirBTC fail-closed.',
  }),
  planSourceContract('ArcoxBTCPool-USDC-cirBTC', {
    constructorArgs: `[_token0=${MAINNET.usdc}, _token1=${MAINNET.cirbtc || '<cirBTC mainnet — BLOCKER>'}]`,
    envOut: null,
    note: 'Pool butuh seeding likuiditas setelah deploy (bukan bagian dari script ini).',
  }),
  planSourceContract('ArcoxBTCPool-EURC-cirBTC', {
    constructorArgs: `[_token0=${MAINNET.eurc}, _token1=${MAINNET.cirbtc || '<cirBTC mainnet — BLOCKER>'}]`,
    envOut: null,
    note: 'Pool butuh seeding likuiditas setelah deploy.',
  }),
  planSourceContract('Adapter', {
    constructorArgs: '[] (implementation; diinisialisasi lewat proxy)',
    envOut: null,
    note: 'Pakai implementasi TERKINI (Adapter), bukan alamat logic di constructor proxy lama.',
  }),
  planSourceContract('TransparentUpgradeableProxy-SwapAdapter', {
    constructorArgs: `[_logic=<impl Adapter baru>, initialOwner=${treasury || '<ProxyAdmin owner mainnet>'} (testnet: 0xFbC171f350319a2E06A80AE640CDd76dF084D1eF), _data=<init USDC + pool + flag>]`,
    envOut: 'ARCOX_SWAP_ADAPTER_MAINNET',
    note: `Admin proxy testnet 0x6a73…8b7a. Mainnet: putuskan ProxyAdmin baru atau admin yang sama; init data testnet memakai USDC ${TESTNET_REF.usdc} + 0x50c885e17d3429a2515ca3e499d9c2ac970990ba.`,
  }),
  planSourceContract('AgenticCommerce', {
    constructorArgs: '[] (implementation; diinisialisasi lewat proxy)',
    envOut: null,
    note: 'evm version cancun, optimizer OFF — samakan saat kompilasi ulang.',
  }),
  planSourceContract('ERC1967Proxy-AgenticCommerce', {
    constructorArgs: `[implementation=<impl AgenticCommerce baru>, _data=initialize(usdc=${MAINNET.usdc}, <operator>, <operator>)]`,
    envOut: 'ARCOX_ERC8183_ADDRESS_MAINNET',
    note: `Init testnet: usdc ${TESTNET_REF.usdc} + dua alamat operator 0xcbe5b97a069be3e4b5398663790731fb76ab620d. Proxy ERC1967 (UUPS-style), bukan Transparent.`,
  }),
]

console.log('\n── Urutan deploy ──')
plan.forEach((item, index) => {
  console.log(`\n${index + 1}. ${item.label} — ${item.contractName}${item.sourceMissing ? ' ❌ source belum tersalin' : ''}`)
  console.log(`   solc ${item.compiler}  opt=${JSON.stringify(item.optimization)}  evm=${item.evmVersion}`)
  console.log(`   source   : ${item.sourceFile || '-'}`)
  console.log(`   args     : ${item.constructorArgs}`)
  console.log(`   env out  : ${item.envOut ? item.envOut + ' (backend hanya membaca <NAME>_MAINNET)' : '-'}`)
  console.log(`   catatan  : ${item.note}`)
})

console.log('\n── Env backend yang wajib diisi setelah deploy ──')
for (const [envName, label] of REQUIRED_ENV) {
  const value = String(process.env[envName] || '').trim()
  let status = 'belum diisi'
  if (value) {
    const code = await rpc('eth_getCode', [value, 'latest']).catch(() => null)
    status = code && code !== '0x' && code !== '0x0' ? '✅ ada kode' : '❌ belum ada kode di alamat ini'
  }
  console.log(`  ${envName.padEnd(34)} ${label.padEnd(32)} ${status}`)
}

console.log('\n── Blocker yang harus diputuskan operator ──')
const blockers = []
if (!treasury) blockers.push('ARCOX_TREASURY_WALLET_ADDRESS_MAINNET belum diset (treasury mainnet belum dibuat).')
if (!deployer && !deployerKey) blockers.push('Deployer mainnet belum diset; pakai key terpisah dari testnet (AGENT_PRIVATE_KEY).')
if (!MAINNET.cirbtc) blockers.push('Alamat cirBTC mainnet belum diketahui → ArcoxCirBTCRouterV2 + 2 pool cirBTC tidak bisa di-deploy.')
blockers.push('Keputusan ProxyAdmin Swap Adapter mainnet (admin testnet 0x6a73…8b7a).')
blockers.push('Init data proxy (USDC + operator) untuk AgenticCommerce harus ditinjau, bukan disalin mentah dari testnet.')
blockers.push('Likuiditas pool cirBTC harus disediakan setelah deploy — di luar script ini.')
if (!blockers.length) console.log('  (tidak ada)')
for (const item of blockers) console.log(`  • ${item}`)
console.log('\nBroadcast TIDAK dilakukan oleh script ini. Setelah blocker di atas diputuskan, deploy dijalankan sebagai langkah terpisah dengan konfirmasi eksplisit.')
