#!/usr/bin/env node
/**
 * Setel `feeBps` pada ARCOX Fee Router (ArcoxRouter) yang SUDAH ter-deploy.
 *
 * `feeBps` di kontrak ini adalah storage biasa dengan setter khusus owner
 * (`setFeeBps(uint16)`), bukan immutable — hanya `usdc`, `tokenMessenger`, dan
 * `localDomain` yang immutable. Jadi mengubah fee platform tidak perlu deploy
 * ulang: alamat tetap, sumber Sourcify tetap valid, dan frontend yang membaca
 * `feeBps()` on-chain otomatis mengikuti nilai baru.
 *
 * Idempotent: chain yang nilainya sudah sama dilewati. Default DRY-RUN;
 * `--broadcast` untuk benar-benar mengirim. Limit gas eksplisit dipakai karena
 * limit default (22k) pernah membuat tx revert out-of-gas di kontrak ini.
 *
 * Pakai:
 *   node packages/runtime/scripts/set-fee-router-fee.mjs \
 *     --key-file ~/.arcox/agent.env:EOA_PRIVATE_KEY --fee-bps 50 --chains arc,base,arbitrum
 *   # tambahkan --broadcast untuk benar-benar mengirim
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

// Estimasi nyata ~30k gas; limit eksplisit dengan buffer supaya tidak bergantung
// pada limit default yang terlalu kecil untuk SSTORE.
let FEE_TX_GAS = 80_000n

const abi = JSON.parse(readFileSync(join(SOURCES, 'abi.json'), 'utf8'))

function parseArgs(argv) {
  const out = { broadcast: false, chains: null, feeBps: 50 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--broadcast') out.broadcast = true
    else if (a === '--key-file') out.keyFile = argv[++i]
    else if (a === '--fee-bps') out.feeBps = Number(argv[++i])
    else if (a === '--chains') out.chains = argv[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--gas') out.gas = BigInt(argv[++i])
    else if (a === '--help' || a === '-h') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); process.exit(0) }
    else throw new Error(`argumen tidak dikenal: ${a}`)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
if (!Number.isInteger(args.feeBps) || args.feeBps < 0 || args.feeBps > 1_000) {
  throw new Error('feeBps harus bilangan bulat 0..1000 (kontrak menolak FEE_TOO_HIGH di atas 1000)')
}
if (args.gas) FEE_TX_GAS = args.gas
if (!existsSync(DEPLOYMENTS)) throw new Error(`tidak ada ${DEPLOYMENTS} — deploy dulu`)

const [file, varName] = (args.keyFile || '').split(':')
if (!file || !varName) throw new Error('perlu --key-file <path>:<VAR>')
const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${varName}=`))
if (!line) throw new Error(`variabel ${varName} tidak ada di ${file}`)
const account = privateKeyToAccount(line.slice(varName.length + 1).trim().replace(/^["']|["']$/g, ''))

const log = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8'))
const deployedChains = log.chains.filter((c) => c.address).map((c) => c.chain)
const targets = args.chains || deployedChains
for (const key of targets) if (!CHAINS[key]) throw new Error(`chain tidak didukung: ${key}`)

console.log(`Fee Router setFeeBps — mode ${args.broadcast ? 'BROADCAST (mengirim transaksi!)' : 'DRY-RUN'}`)
console.log(`  signer/owner : ${account.address}`)
console.log(`  feeBps       : ${args.feeBps} (${args.feeBps / 100}%)`)
console.log(`  chain        : ${targets.join(', ')}`)

let failures = 0
const outcomes = new Map()

for (const key of targets) {
  const c = CHAINS[key]
  const entry = log.chains.find((x) => x.chain === key)
  if (!entry?.address) {
    console.log(`\n=== ${c.name}: tidak ada kontrak ter-deploy, dilewati ===`)
    outcomes.set(key, { skipped: true })
    continue
  }
  const address = getAddress(entry.address)
  console.log(`\n=== ${c.name} — ${address} ===`)
  const transport = http(c.rpc, { timeout: 20000, retryCount: 2 })
  const publicClient = createPublicClient({ transport })

  try {
    const [owner, current, gasPrice, balance] = await Promise.all([
      publicClient.readContract({ address, abi, functionName: 'owner' }),
      publicClient.readContract({ address, abi, functionName: 'feeBps' }),
      publicClient.getGasPrice(),
      publicClient.getBalance({ address: account.address }),
    ])
    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error(`owner kontrak ${owner} != signer ${account.address} — tidak bisa set feeBps`)
    }
    console.log(`  owner        : ${owner} ✓`)
    console.log(`  feeBps kini  : ${current}`)
    if (Number(current) === args.feeBps) {
      console.log(`  → sudah ${args.feeBps} bps — dilewati (idempotent)`)
      entry.feeBps = args.feeBps
      outcomes.set(key, { before: Number(current), after: args.feeBps, ok: true, skipped: true })
      continue
    }

    const gasEstimate = await publicClient.estimateContractGas({ account, address, abi, functionName: 'setFeeBps', args: [args.feeBps] })
    const maxFeePerGas = gasPrice * 125n / 100n
    const reserved = FEE_TX_GAS * maxFeePerGas
    console.log(`  gas estimate : ${gasEstimate} (limit ${FEE_TX_GAS})`)
    console.log(`  saldo        : ${formatUnits(balance, c.nativeDecimals)} ${c.nativeSymbol} | reservasi ${formatUnits(reserved, c.nativeDecimals)} ${c.nativeSymbol}`)
    if (balance <= reserved) throw new Error(`saldo tidak cukup (butuh > ${formatUnits(reserved, c.nativeDecimals)} ${c.nativeSymbol})`)
    if (!args.broadcast) {
      console.log('  → dry-run: transaksi TIDAK dikirim')
      outcomes.set(key, { before: Number(current), after: args.feeBps, ok: true, dryRun: true })
      continue
    }

    const walletClient = createWalletClient({ account, transport })
    const hash = await walletClient.writeContract({
      address, abi, functionName: 'setFeeBps', args: [args.feeBps],
      gas: FEE_TX_GAS, maxFeePerGas, maxPriorityFeePerGas: 0n,
    })
    console.log(`  tx           : ${hash}`)
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180000 })
    // RPC publik bisa mengembalikan bacaan stale tepat setelah mining.
    let after = Number(current)
    for (let attempt = 0; attempt < 6 && after !== args.feeBps; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000))
      after = Number(await publicClient.readContract({ address, abi, functionName: 'feeBps' }))
    }
    const ok = receipt.status === 'success' && after === args.feeBps
    console.log(`  ${ok ? '✓' : '✗'} feeBps ${current} → ${after} status=${receipt.status}`)
    entry.feeTxs = [...(entry.feeTxs || []), { feeBps: args.feeBps, hash, status: receipt.status, gasUsed: String(receipt.gasUsed) }]
    entry.feeBps = after
    if (!ok) failures++
    outcomes.set(key, { before: Number(current), after, ok })
  } catch (err) {
    failures++
    console.log(`  GAGAL: ${err.shortMessage || err.message}`)
    outcomes.set(key, { ok: false })
  }
}

// Log deploy hanya diperbarui saat broadcast, dan `feeBps` top-level hanya
// berubah kalau SEMUA chain ter-deploy sudah bernilai baru — supaya
// `mainnet:fee-router:verify` (membandingkan semua chain dengan nilai itu)
// tidak pernah membandingkan chain yang berbeda kebijakan.
if (args.broadcast) {
  const coversAll = deployedChains.every((key) => outcomes.get(key)?.ok && outcomes.get(key)?.after === args.feeBps)
  if (coversAll) log.feeBps = args.feeBps
  else console.log(`\nperingatan: log.feeBps tidak diubah (belum semua chain bernilai ${args.feeBps})`)
  log.updatedAt = new Date().toISOString()
  writeFileSync(DEPLOYMENTS, `${JSON.stringify(log, null, 2)}\n`)
  console.log(`log diperbarui: ${DEPLOYMENTS}`)
}

if (failures > 0) {
  console.log(`\nADA GAGAL: ${failures} chain — perbaiki dulu sebelum menganggap selesai.`)
  process.exit(1)
}
console.log(args.broadcast ? '\nSELESAI: feeBps tersetel di chain terpilih.' : '\nDRY-RUN — ulangi dengan --broadcast untuk mengirim.')
