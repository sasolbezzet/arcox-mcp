#!/usr/bin/env node
/**
 * Cetak SEMUA alamat kontrak ARCOX mainnet + cek kode on-chain-nya (read-only).
 *
 * Sumber data: `deployments/*.json` (catatan hasil deploy). Skrip ini tidak
 * mengirim transaksi apa pun — hanya `eth_getCode` supaya terlihat kalau ada
 * alamat yang catatannya ada tetapi kontraknya tidak ada di chain.
 *
 * Pakai: node packages/runtime/scripts/list-mainnet-deployments.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEPLOYMENTS = join(HERE, '..', 'deployments')

const RPCS = {
  arc: 'https://rpc.mainnet.arc.io',
  base: 'https://base-rpc.publicnode.com',
  arbitrum: 'https://arbitrum-one-rpc.publicnode.com',
}

// Alamat yang sengaja TIDAK dipakai: percobaan pertama Fee Router dengan
// immutables testnet (feeBps 30 + TokenMessenger testnet). Kodenya ada di
// chain, jadi harus disebut supaya tidak tertukar dengan yang benar.
const REJECTED = [
  ['Arc (5042)', 'arc', '0xb9Fb801A5D1491E70A886800982CB80cdf98A174', 'immutables testnet'],
  ['Base (8453)', 'base', '0xc31F668B17A8A923d661f2fc16A89Cd0BD14a39b', 'immutables testnet (usdc = USDC Arc)'],
]

async function codeBytes(chain, address) {
  const rpc = RPCS[chain]
  if (!rpc) return null
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [address, 'latest'] }),
  })
  const body = await res.json()
  if (!body?.result || body.result === '0x') return 0
  return (body.result.length - 2) / 2
}

const fee = JSON.parse(readFileSync(join(DEPLOYMENTS, 'fee-router-mainnet.json'), 'utf8'))
const swap = JSON.parse(readFileSync(join(DEPLOYMENTS, 'swap-adapter-mainnet.json'), 'utf8'))

console.log('=== ARCOX FEE ROUTER (ArcoxRouter, solc 0.8.35, feeBps 500) ===')
console.log(`treasury ${fee.treasury} | owner ${fee.owner}`)
for (const c of fee.chains.filter((x) => x.address)) {
  const bytes = await codeBytes(c.chain, c.address)
  console.log(`\n${c.name} (${c.chainId})`)
  console.log(`  alamat     : ${c.address}`)
  console.log(`  kode       : ${bytes} byte${bytes > 0 ? '' : '  ❌ KOSONG'}`)
  console.log(`  deploy tx  : ${c.deployTx}`)
  console.log(`  explorer   : ${c.explorer}/address/${c.address}`)
  console.log(`  sourcify   : ${c.sourcify?.repoUrl || '-'} (${c.sourcify?.status || '-'})`)
  for (const d of c.domainTxs || []) console.log(`  domain ${String(d.domain).padStart(3)} : ${d.hash} (${d.status})`)
}

console.log('\n\n=== ARCOX SWAP ADAPTER (impl Adapter + TransparentUpgradeableProxy, solc 0.8.28) ===')
console.log(`owner adapter ${swap.adapterOwner} | signer EIP-712 ${swap.signer} (threshold ${swap.signerThreshold}) | ProxyAdmin owner ${swap.proxyAdminOwner}`)
for (const c of swap.chains) {
  if (!c.proxy) {
    console.log(`\n${c.name} (${c.chainId}) — BELUM di-deploy (${c.error || 'menunggu dana'})`)
    continue
  }
  const implBytes = await codeBytes(c.chain, c.implementation)
  const proxyBytes = await codeBytes(c.chain, c.proxy)
  const admin = c.verified?.adminSlot
  const adminBytes = admin ? await codeBytes(c.chain, admin) : null
  console.log(`\n${c.name} (${c.chainId})`)
  console.log(`  proxy (dipakai aplikasi) : ${c.proxy}  (${proxyBytes} byte)`)
  console.log(`    tx                     : ${c.proxyDeployTx}`)
  console.log(`    explorer               : ${c.explorer}/address/${c.proxy}`)
  console.log(`  implementation           : ${c.implementation}  (${implBytes} byte)`)
  console.log(`    tx                     : ${c.implDeployTx}`)
  if (admin) console.log(`  ProxyAdmin (hak upgrade) : ${admin}  (${adminBytes} byte) owner ${c.verified.proxyAdminOwner}`)
  if (c.sourcify) {
    for (const [kind, s] of Object.entries(c.sourcify)) console.log(`  sourcify ${kind.padEnd(15)}: ${s.status} | ${s.repoUrl}`)
  }
}

console.log('\n\n=== ⚠️  ALAMAT DITOLAK — JANGAN DIPAKAI (kodenya ada, tapi immutables testnet) ===')
for (const [name, chain, address, reason] of REJECTED) {
  const bytes = await codeBytes(chain, address)
  console.log(`  ${name.padEnd(12)} ${address}  (${bytes} byte) — ${reason}`)
}
console.log('\n=== Alamat TESTNET (bukan mainnet; sering tertukar) ===')
console.log('  Fee Router testnet : 0xDf800310443BEB589CEf91A09854203Ea36e43a7')
console.log('  Swap Adapter testnet: 0xBBD70b01a1CAbc96d5b7b129Ae1AAabdf50dd40b')
