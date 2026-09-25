#!/usr/bin/env node
/**
 * Verifikasi ARCOX Fee Router yang sudah ter-deploy di mainnet.
 *
 * Dua lapis:
 *  1. STATE on-chain lewat RPC — owner, treasury, feeBps, usdc, tokenMessenger,
 *     localDomain, supportedTokens, supportedDestinationDomains.
 *  2. PROVENANCE bytecode — kompilasi ulang sumber terverifikasi (solc 0.8.35,
 *     optimizer 200 runs) lalu bandingkan runtime bytecode hasil kompilasi
 *     dengan bytecode on-chain, dengan area immutable (usdc, tokenMessenger,
 *     localDomain) di-mask karena nilainya tertanam saat deploy.
 *
 * Read-only: tidak mengirim transaksi apa pun.
 *
 * Pakai: node packages/runtime/scripts/verify-fee-router-mainnet.mjs [--chains arc,base]
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createPublicClient, http, getAddress, formatUnits, keccak256 } from 'viem'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCES = join(HERE, '..', 'mainnet-sources', 'ArcoxRouter')
const DEPLOYMENTS = join(HERE, '..', 'deployments', 'fee-router-mainnet.json')

const CHAINS = {
  arc: { name: 'Arc Mainnet', rpc: 'https://rpc.mainnet.arc.io', explorer: 'https://explorer.arc.io', usdc: '0x3600000000000000000000000000000000000000', tokenMessenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d', cctpDomain: 26, nativeDecimals: 18, nativeSymbol: 'USDC' },
  base: { name: 'Base Mainnet', rpc: 'https://base-rpc.publicnode.com', explorer: 'https://basescan.org', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', tokenMessenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d', cctpDomain: 6, nativeDecimals: 18, nativeSymbol: 'ETH' },
  arbitrum: { name: 'Arbitrum One', rpc: 'https://arbitrum-one-rpc.publicnode.com', explorer: 'https://arbiscan.io', usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', tokenMessenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d', cctpDomain: 3, nativeDecimals: 18, nativeSymbol: 'ETH' },
}

const abi = JSON.parse(readFileSync(join(SOURCES, 'abi.json'), 'utf8'))
const source = readFileSync(join(SOURCES, 'ArcoxRouter.sol'), 'utf8')
const deployLog = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8'))

const args = process.argv.slice(2)
const onlyIdx = args.indexOf('--chains')
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',').map((s) => s.trim()) : null

let failures = 0
const check = (label, actual, expected) => {
  const a = typeof actual === 'string' ? actual.toLowerCase() : actual
  const e = typeof expected === 'string' ? expected.toLowerCase() : expected
  const ok = String(a) === String(e)
  if (!ok) failures++
  console.log(`    ${ok ? '✓' : '✗'} ${label.padEnd(28)} ${actual}${ok ? '' : `  (diharapkan ${expected})`}`)
  return ok
}

// ── 1. Provenance: kompilasi ulang + mask immutable ─────────────────────────
console.log('=== Kompilasi ulang sumber terverifikasi (solc lokal) ===')
const solc = require('solc')
const input = {
  language: 'Solidity',
  sources: { 'ArcoxRouter.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } },
  },
}
const output = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = (output.errors || []).filter((e) => e.severity === 'error')
if (errors.length) {
  console.error('kompilasi gagal:', errors.map((e) => e.formattedMessage).join('\n'))
  process.exit(1)
}
const contract = output.contracts['ArcoxRouter.sol'].ArcoxRouter
const compiledRuntime = `0x${contract.evm.deployedBytecode.object}`
const immutables = contract.evm.deployedBytecode.immutableReferences || {}
const immutableSlots = Object.values(immutables).flat().map((r) => ({ start: r.start * 2, length: r.length * 2 }))
console.log(`  solc ${solc.version()}`)
console.log(`  runtime bytecode : ${(compiledRuntime.length - 2) / 2} bytes (keccak ${keccak256(compiledRuntime).slice(0, 18)}...)`)
console.log(`  area immutable   : ${immutableSlots.map((s) => `${s.start / 2}+${s.length / 2}B`).join(', ')}`)

function maskImmutables(hex) {
  const chars = hex.slice(2).split('')
  for (const { start, length } of immutableSlots) {
    for (let i = start; i < start + length && i < chars.length; i++) chars[i] = '?'
  }
  return chars.join('')
}

// ── 2. Verifikasi per chain ────────────────────────────────────────────────
for (const entry of deployLog.chains) {
  const key = entry.chain
  if (!entry.address) { console.log(`\n=== ${key}: belum ter-deploy (dilewati) ===`); continue }
  if (only && !only.includes(key)) continue
  const c = CHAINS[key]
  const address = getAddress(entry.address)
  console.log(`\n=== ${c.name} — ${address} ===`)
  const client = createPublicClient({ transport: http(c.rpc, { timeout: 20000, retryCount: 2 }) })

  // state
  const [owner, treasury, feeBps, usdc, tokenMessenger, localDomain, usdcSupported] = await Promise.all([
    client.readContract({ address, abi, functionName: 'owner' }),
    client.readContract({ address, abi, functionName: 'treasury' }),
    client.readContract({ address, abi, functionName: 'feeBps' }),
    client.readContract({ address, abi, functionName: 'usdc' }),
    client.readContract({ address, abi, functionName: 'tokenMessenger' }),
    client.readContract({ address, abi, functionName: 'localDomain' }),
    client.readContract({ address, abi, functionName: 'supportedTokens', args: [getAddress(c.usdc)] }),
  ])
  check('owner', owner, deployLog.deployer)
  check('treasury', treasury, deployLog.treasury)
  check('feeBps', Number(feeBps), deployLog.feeBps)
  check('usdc', usdc, c.usdc)
  check('tokenMessenger', tokenMessenger, c.tokenMessenger)
  check('localDomain', Number(localDomain), c.cctpDomain)
  check('supportedTokens[usdc]', usdcSupported, true)

  // domain: semua chain lain di log deploy harus didukung
  for (const other of deployLog.chains.filter((x) => x.address && x.chain !== key)) {
    const dom = CHAINS[other.chain].cctpDomain
    const supported = await client.readContract({ address, abi, functionName: 'supportedDestinationDomains', args: [dom] })
    if (supported) console.log(`    ✓ domain ${dom} (${other.chain}) didukung`)
    else console.log(`    · domain ${dom} (${other.chain}) BELUM didukung`)
  }
  const ownDomain = await client.readContract({ address, abi, functionName: 'supportedDestinationDomains', args: [c.cctpDomain] })
  check('local domain tidak didukung', ownDomain, false)

  // quoteFee sanity: 1 USDC → 5% fee
  const [fee, net] = await client.readContract({ address, abi, functionName: 'quoteFee', args: [1_000_000n] })
  check('quoteFee(1 USDC).fee', formatUnits(fee, 6), '0.05')
  check('quoteFee(1 USDC).net', formatUnits(net, 6), '0.95')

  // provenance bytecode
  const deployed = await client.getBytecode({ address })
  const [a, b] = [maskImmutables(deployed), maskImmutables(compiledRuntime)]
  const codeMatch = a === b
  if (!codeMatch) failures++
  console.log(`    ${codeMatch ? '✓' : '✗'} bytecode on-chain cocok dengan sumber (immutable di-mask)`)

  // sisa saldo deployer
  const bal = await client.getBalance({ address: getAddress(deployLog.deployer) })
  console.log(`    · saldo deployer tersisa ${formatUnits(bal, c.nativeDecimals)} ${c.nativeSymbol}`)
  console.log(`    · ${c.explorer}/address/${address}`)

  entry.verified = { codeMatch, feeBps: Number(feeBps), treasury, owner, localDomain: Number(localDomain) }
}

console.log(failures === 0 ? '\nVERIFIKASI LULUS: tidak ada ketidaksesuaian.' : `\nVERIFIKASI GAGAL: ${failures} ketidaksesuaian.`)
process.exit(failures === 0 ? 0 : 1)
