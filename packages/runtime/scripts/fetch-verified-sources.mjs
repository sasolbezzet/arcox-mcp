#!/usr/bin/env node
// fetch-verified-sources.mjs — ambil source kontrak ARCOX yang sudah terverifikasi
// di ArcScan (Blockscout) untuk dipakai ulang saat deploy ke Arc mainnet.
//
// READ-ONLY: script ini hanya GET ke ArcScan dan menulis file lokal. Tidak ada
// transaksi, tidak ada broadcast, dan tidak menyentuh jaringan.
//
// Kenapa perlu: sumber beberapa kontrak (ArcoxCirBTCRouterV2, Adapter,
// AgenticCommerce, pool cirBTC) TIDAK ada di repo mana pun — yang tersimpan hanya
// alamat hasil deploy testnet. Source-nya ada di Blockscout, jadi disalin ke
// `packages/runtime/mainnet-sources/<Label>/` supaya deploy mainnet tidak
// bergantung pada ketersediaan explorer atau ingatan orang.
//
// Pemakaian:
//   node packages/runtime/scripts/fetch-verified-sources.mjs
//   ARCSCAN_API_BASE_URL=https://testnet.arcscan.app/api/v2 node …/fetch-verified-sources.mjs

import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const runtimeRoot = dirname(__dirname)
const outRoot = join(runtimeRoot, 'mainnet-sources')
const apiBase = String(process.env.ARCSCAN_API_BASE_URL || 'https://testnet.arcscan.app/api/v2').replace(/\/+$/, '')

// Alamat testnet (sumber kebenaran) + pasangan proxy/impl yang harus ikut
// di-deploy ke mainnet. `envOut` adalah nama env yang dibaca backend
// (arc-dex-api) — ingat: mainnet hanya menerima `<envOut>_MAINNET`.
const TARGETS = [
  { label: 'ArcoxRouter', name: 'ARCOX Fee Router', address: '0xDf800310443BEB589CEf91A09854203Ea36e43a7', kind: 'direct', envOut: 'ARCOX_FEE_ROUTER_ADDRESS' },
  { label: 'ArcoxCirBTCRouterV2', name: 'AMM Router (USDC↔cirBTC)', address: '0x9f2443691bddd8343590c68e2a2cdec5fd0b6124', kind: 'direct', envOut: 'ARCOX_AMM_ROUTER' },
  { label: 'ArcoxCirBTCRouter', name: 'AMM Router (varian registry)', address: '0x0c72563b9846df4355244a9671918e59c620c580', kind: 'direct', envOut: null },
  { label: 'ArcoxBTCPool-USDC-cirBTC', name: 'AMM Pool USDC-cirBTC', address: '0xd4af8e12903a4c6bd60bbc353fb97ffc9cc2dc2d', kind: 'direct', envOut: null },
  { label: 'ArcoxBTCPool-EURC-cirBTC', name: 'AMM Pool EURC-cirBTC', address: '0xcca97842509efae4a2ed4c95595fc559a1a6bfa2', kind: 'direct', envOut: null },
  { label: 'Adapter', name: 'Swap Adapter (implementation)', address: '0xb4d0aa6ca5e12b8a77b86989305a7f15462ac2d4', kind: 'implementation', envOut: 'ARCOX_SWAP_ADAPTER' },
  { label: 'TransparentUpgradeableProxy-SwapAdapter', name: 'Swap Adapter (proxy)', address: '0xBBD70b01a1CAbc96d5b7b129Ae1AAabdf50dd40b', kind: 'proxy', envOut: 'ARCOX_SWAP_ADAPTER' },
  { label: 'AgenticCommerce', name: 'ERC-8183 Agentic Commerce (implementation)', address: '0xa316fd02827242d537f84730f8a37d0ba5fd351a', kind: 'implementation', envOut: 'ARCOX_ERC8183_ADDRESS' },
  { label: 'ERC1967Proxy-AgenticCommerce', name: 'ERC-8183 Agentic Commerce (proxy)', address: '0x0747EEf0706327138c69792bF28Cd525089e4583', kind: 'proxy', envOut: 'ARCOX_ERC8183_ADDRESS' },
]

function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200) || 'Contract.sol'
}

// Blockscout mengirim `file_path` relatif (mis. lib/openzeppelin-contracts/…/X.sol).
// Direktori tetap dipertahankan, setiap segmen disanitasi, dan `..` dibuang supaya
// penulisan tidak pernah keluar dari direktori tujuan.
function safeRelPath(value) {
  return String(value || '')
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(segment => segment.replace(/[^A-Za-z0-9._-]/g, '_'))
    .filter(segment => segment !== '.' && segment !== '..')
    .join('/') || 'Contract.sol'
}

// `additional_sources` berbentuk array { file_path, source_code } (bukan object).
function additionalSourceEntries(data) {
  const raw = data?.additional_sources
  if (Array.isArray(raw)) {
    return raw
      .map(item => ({ filePath: item?.file_path || '', content: item?.source_code }))
      .filter(item => item.filePath && typeof item.content === 'string')
  }
  return Object.entries(raw || {})
    .map(([filePath, value]) => ({ filePath, content: typeof value === 'string' ? value : value?.content }))
    .filter(item => typeof item.content === 'string')
}

async function fetchVerified(address) {
  const response = await fetch(`${apiBase}/smart-contracts/${address}`, { signal: AbortSignal.timeout(20_000) })
  if (response.status === 404) return { verified: false, reason: 'not_found' }
  if (!response.ok) return { verified: false, reason: `http_${response.status}` }
  const data = await response.json()
  if (!data?.is_verified || typeof data?.source_code !== 'string') return { verified: false, reason: 'not_verified' }
  return { verified: true, data }
}

const manifest = {
  fetchedAt: new Date().toISOString(),
  sourceApi: apiBase,
  note: 'Source terverifikasi dari ArcScan (Arc testnet) untuk redeploy ke Arc mainnet. Testnet-only snapshot.',
  contracts: [],
}

mkdirSync(outRoot, { recursive: true })
let verifiedCount = 0

for (const target of TARGETS) {
  const entry = { ...target }
  try {
    const result = await fetchVerified(target.address)
    if (!result.verified) {
      entry.status = `NOT_VERIFIED (${result.reason})`
      manifest.contracts.push(entry)
      console.log(`⚠️  ${target.label.padEnd(38)} ${result.reason}`)
      continue
    }
    const data = result.data
    const dir = join(outRoot, target.label)
    mkdirSync(dir, { recursive: true })
    const fileName = safeName(data.file_path || `${data.name || target.label}.sol`)
    writeFileSync(join(dir, fileName), data.source_code, 'utf8')
    const extras = additionalSourceEntries(data)
    for (const extra of extras) {
      const extraFile = join(dir, 'imports', safeRelPath(extra.filePath))
      mkdirSync(dirname(extraFile), { recursive: true })
      writeFileSync(extraFile, extra.content, 'utf8')
    }
    writeFileSync(join(dir, 'abi.json'), JSON.stringify(data.abi || [], null, 2), 'utf8')
    writeFileSync(join(dir, 'creation-bytecode.txt'), String(data.creation_bytecode || ''), 'utf8')

    entry.status = 'verified'
    entry.contractName = data.name
    entry.compilerVersion = data.compiler_version
    entry.compilerSettings = data.compiler_settings
    entry.optimization = { enabled: data.optimization_enabled, runs: data.optimization_runs }
    entry.evmVersion = data.evm_version
    entry.license = data.license_type
    entry.filePath = data.file_path
    entry.sourceFile = join(target.label, fileName)
    entry.constructorArgsHex = data.constructor_args || ''
    entry.constructorArgsDecoded = data.decoded_constructor_args || []
    entry.proxyType = data.proxy_type || null
    entry.implementations = data.implementations || []
    entry.verifiedAt = data.verified_at
    entry.sourcifyRepoUrl = data.sourcify_repo_url || null
    entry.additionalSourceCount = extras.length
    manifest.contracts.push(entry)
    verifiedCount += 1
    console.log(`✅ ${target.label.padEnd(38)} ${data.name} (solc ${String(data.compiler_version || '').split('+')[0]})`)
  } catch (error) {
    entry.status = `ERROR (${error?.message || 'fetch failed'})`
    manifest.contracts.push(entry)
    console.log(`❌ ${target.label.padEnd(38)} ${error?.message || 'fetch failed'}`)
  }
}

writeFileSync(join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
console.log(`\n${verifiedCount}/${TARGETS.length} kontrak terverifikasi disalin ke ${outRoot}`)
console.log('Manifest: mainnet-sources/manifest.json — berisi constructor args + setting kompilasi asli.')
