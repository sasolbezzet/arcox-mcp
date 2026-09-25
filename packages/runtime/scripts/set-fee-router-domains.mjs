#!/usr/bin/env node
/**
 * Setel `supportedDestinationDomains` pada ARCOX Fee Router yang SUDAH ter-deploy.
 *
 * Idempotent: domain yang sudah aktif dilewati. Domain milik chain itu sendiri
 * selalu dilewati (kontrak menolak SAME_DOMAIN saat bridge).
 *
 * Skrip ini TIDAK pernah deploy kontrak. Default DRY-RUN; `--broadcast` untuk kirim.
 *
 * Catatan gas: tx `setSupportedDestinationDomain` dulu pernah revert out-of-gas
 * karena memakai gas limit default yang terlalu kecil (22.026). Di sini limit
 * eksplisit 120.000 gas selalu dipakai.
 *
 * Pakai:
 *   node packages/runtime/scripts/set-fee-router-domains.mjs \
 *     --key-file /home/ubuntu/.arcox/agent.env:EOA_PRIVATE_KEY --chains arc,base [--broadcast]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, http, getAddress, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCES = join(HERE, '..', 'mainnet-sources', 'ArcoxRouter')
const DEPLOYMENTS = join(HERE, '..', 'deployments', 'fee-router-mainnet.json')

const CHAINS = {
  arc: { name: 'Arc Mainnet', id: 5042, rpc: 'https://rpc.mainnet.arc.io', explorer: 'https://explorer.arc.io', cctpDomain: 26, nativeDecimals: 18, nativeSymbol: 'USDC' },
  base: { name: 'Base Mainnet', id: 8453, rpc: 'https://mainnet.base.org', cctpDomain: 6, nativeDecimals: 18, nativeSymbol: 'ETH' },
  arbitrum: { name: 'Arbitrum One', id: 42161, rpc: 'https://arb1.arbitrum.io/rpc', cctpDomain: 3, nativeDecimals: 18, nativeSymbol: 'ETH' },
}

// Limit gas eksplisit (limit default 22.026 pernah membuat tx revert). Pemakaian
// nyata satu SSTORE ≈ 46k gas, jadi nilai ini bisa diturunkan lewat `--gas` saat
// saldo sangat mepet — node mereservasi gasLimit x maxFeePerGas sejak submit.
let DOMAIN_TX_GAS = 120_000n

const abi = JSON.parse(readFileSync(join(SOURCES, 'abi.json'), 'utf8'))

function parseArgs(argv) {
  const out = { broadcast: false, chains: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--broadcast') out.broadcast = true
    else if (a === '--key-file') out.keyFile = argv[++i]
    else if (a === '--chains') out.chains = argv[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--gas') out.gas = BigInt(argv[++i])
    else throw new Error(`argumen tidak dikenal: ${a}`)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
if (args.gas) DOMAIN_TX_GAS = args.gas
if (!existsSync(DEPLOYMENTS)) throw new Error(`tidak ada ${DEPLOYMENTS} — deploy dulu`)
const log = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8'))

const [file, varName] = (args.keyFile || '').split(':')
const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${varName}=`))
if (!line) throw new Error(`variabel ${varName} tidak ada di ${file}`)
const account = privateKeyToAccount(line.slice(varName.length + 1).trim().replace(/^["']|["']$/g, ''))

console.log(`Fee Router destination domains — mode ${args.broadcast ? 'BROADCAST' : 'DRY-RUN'}`)
console.log(`  owner/deployer : ${account.address}`)

// Chain yang punya kontrak ter-deploy (dari log) + yang diminta eksplisit.
const deployedChains = log.chains.filter((c) => c.address).map((c) => c.chain)
const targets = args.chains || deployedChains
const allDomains = [...new Set([...deployedChains, ...targets])].map((k) => ({ key: k, domain: CHAINS[k].cctpDomain }))

for (const key of targets) {
  const c = CHAINS[key]
  const entry = log.chains.find((x) => x.chain === key)
  if (!entry?.address) { console.log(`\n=== ${c.name}: tidak ada kontrak ter-deploy, dilewati ===`); continue }
  const address = getAddress(entry.address)
  console.log(`\n=== ${c.name} — ${address} ===`)
  const publicClient = createPublicClient({ transport: http(c.rpc, { timeout: 20000, retryCount: 2 }) })

  const owner = await publicClient.readContract({ address, abi, functionName: 'owner' })
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.log(`  ✗ owner kontrak ${owner} != signer ${account.address} — tidak bisa set domain`)
    continue
  }
  console.log(`  owner ✓`)

  for (const { key: otherKey, domain } of allDomains) {
    if (otherKey === key) continue
    const current = await publicClient.readContract({ address, abi, functionName: 'supportedDestinationDomains', args: [domain] })
    if (current) { console.log(`  · domain ${domain} (${otherKey}) sudah aktif — dilewati`); continue }
    if (!args.broadcast) { console.log(`  → domain ${domain} (${otherKey}) perlu diaktifkan (dry-run)`); continue }

    const walletClient = createWalletClient({ account, transport: http(c.rpc, { timeout: 20000, retryCount: 2 }) })
    const balance = await publicClient.getBalance({ address: account.address })
    if (balance === 0n) { console.log(`  ✗ saldo 0 ${c.nativeSymbol} — tidak bisa kirim tx`); continue }
    const hash = await walletClient.writeContract({
      address, abi, functionName: 'setSupportedDestinationDomain', args: [domain, true],
      gas: DOMAIN_TX_GAS, maxPriorityFeePerGas: 0n,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180000 })
    // Bacaan tepat setelah mining bisa masih stale di RPC publik, jadi polling
    // singkat sebelum menyimpulkan hasilnya.
    let after = false
    for (let attempt = 0; attempt < 6 && !after; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000))
      after = await publicClient.readContract({ address, abi, functionName: 'supportedDestinationDomains', args: [domain] })
    }
    const ok = receipt.status === 'success' && after
    console.log(`  ${ok ? '✓' : '✗'} domain ${domain} (${otherKey}) tx ${hash} status=${receipt.status} aktif=${after}`)
    entry.domainTxs = [...(entry.domainTxs || []), { domain, chain: otherKey, hash, status: receipt.status, gasUsed: String(receipt.gasUsed) }]
    if (ok) entry.destinationDomains = [...new Set([...(entry.destinationDomains || []), domain])]
  }
  const bal = await publicClient.getBalance({ address: account.address })
  console.log(`  · saldo tersisa ${formatUnits(bal, c.nativeDecimals)} ${c.nativeSymbol}`)
}

if (args.broadcast) {
  log.updatedAt = new Date().toISOString()
  writeFileSync(DEPLOYMENTS, `${JSON.stringify(log, null, 2)}\n`)
  console.log(`\nlog diperbarui: ${DEPLOYMENTS}`)
}
console.log(args.broadcast ? '\nSELESAI.' : '\nDRY-RUN — ulangi dengan --broadcast untuk mengirim.')
