#!/usr/bin/env node
/**
 * Deploy ARCOX Fee Router (ArcoxRouter) ke mainnet: Arc, Base, Arbitrum.
 *
 * Default DRY-RUN. Tidak ada transaksi terkirim kecuali `--broadcast` diberikan.
 * Bytecode + ABI diambil dari snapshot sumber terverifikasi ArcScan testnet
 * (packages/runtime/mainnet-sources/ArcoxRouter), jadi bytecode mainnet identik
 * dengan kontrak testnet 0xDf800310443BEB589CEf91A09854203Ea36e43a7.
 *
 * Constructor: (initialOwner, initialTreasury, usdc_, tokenMessenger_, localDomain_, feeBps_)
 *
 * Pakai:
 *   node packages/runtime/scripts/deploy-fee-router-mainnet.mjs \
 *     --key-file /home/ubuntu/arc-dex-api/.env:AI_ROUTER_DELEGATE_PRIVATE_KEY \
 *     --treasury 0x5d16e8ef186d6d0d984f9a50c7ddb16c106df40f \
 *     --fee-bps 500 --chains arc,base,arbitrum
 *   # tambahkan --broadcast untuk benar-benar mengirim
 *
 * Setelah deploy, kontrak otomatis menyetel destination domain untuk 2 chain
 * lain (syarat bridgeUsdcWithFee). Hasil ditulis ke
 * packages/runtime/deployments/fee-router-mainnet.json.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import {
  createPublicClient, createWalletClient, http, getAddress, encodeDeployData,
  formatEther, formatUnits, parseGwei, keccak256,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCES = join(HERE, '..', 'mainnet-sources', 'ArcoxRouter')
const OUT_DIR = join(HERE, '..', 'deployments')

/** chainId, CCTP v2 TokenMessengerV2, USDC, dan CCTP domain tiap chain. */
const CHAINS = {
  arc: {
    name: 'Arc Mainnet', id: 5042, rpc: 'https://rpc.mainnet.arc.io', explorer: 'https://explorer.arc.io',
    usdc: '0x3600000000000000000000000000000000000000',
    tokenMessenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    cctpDomain: 26, nativeDecimals: 18, nativeSymbol: 'USDC',
  },
  base: {
    name: 'Base Mainnet', id: 8453, rpc: 'https://mainnet.base.org',
    fallbackRpc: 'https://base-rpc.publicnode.com', explorer: 'https://basescan.org',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    tokenMessenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    cctpDomain: 6, nativeDecimals: 18, nativeSymbol: 'ETH',
  },
  arbitrum: {
    name: 'Arbitrum One', id: 42161, rpc: 'https://arb1.arbitrum.io/rpc',
    fallbackRpc: 'https://arbitrum-one-rpc.publicnode.com', explorer: 'https://arbiscan.io',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    tokenMessenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    cctpDomain: 3, nativeDecimals: 18, nativeSymbol: 'ETH',
  },
}

function parseArgs(argv) {
  const out = { chains: 'arc,base,arbitrum', broadcast: false, feeBps: 500 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--broadcast') out.broadcast = true
    else if (a === '--key-file') out.keyFile = argv[++i]
    else if (a === '--treasury') out.treasury = argv[++i]
    else if (a === '--owner') out.owner = argv[++i]
    else if (a === '--fee-bps') out.feeBps = Number(argv[++i])
    else if (a === '--chains') out.chains = argv[++i]
    else if (a === '--max-gas-price-gwei') out.maxGasPriceGwei = Number(argv[++i])
    else if (a === '--help' || a === '-h') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); process.exit(0) }
    else { console.error(`argumen tidak dikenal: ${a}`); process.exit(2) }
  }
  return out
}

function loadPrivateKey(args) {
  if (args.keyFile) {
    const [file, varName] = args.keyFile.split(':')
    const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${varName}=`))
    if (!line) throw new Error(`variabel ${varName} tidak ada di ${file}`)
    return line.slice(varName.length + 1).trim().replace(/^["']|["']$/g, '')
  }
  if (process.env.DEPLOYER_PRIVATE_KEY) return process.env.DEPLOYER_PRIVATE_KEY
  throw new Error('perlu --key-file <path>:<VAR> atau DEPLOYER_PRIVATE_KEY')
}

const require = createRequire(import.meta.url)
const args = parseArgs(process.argv.slice(2))
const abi = JSON.parse(readFileSync(join(SOURCES, 'abi.json'), 'utf8'))

// Sumber kebenaran bytecode = kompilasi lokal dengan solc 0.8.35 + optimizer 200,
// bukan file `creation-bytecode.txt`. Alasannya historis: file dari Blockscout
// pernah menyertakan constructor args testnet di ekornya, sehingga deploy membawa
// immutables testnet (usdc/tokenMessenger/localDomain) alih-alih argumen mainnet.
// File tetap di-cross-check supaya snapshot dan kompilasi tidak pernah menyimpang.
function loadCreationBytecode() {
  const onDisk = readFileSync(join(SOURCES, 'creation-bytecode.txt'), 'utf8').trim().replace(/\s/g, '')
  if (!/^0x60/.test(onDisk)) throw new Error('creation-bytecode.txt tidak valid')
  const solc = require('solc')
  const source = readFileSync(join(SOURCES, 'ArcoxRouter.sol'), 'utf8')
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { 'ArcoxRouter.sol': { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['evm.bytecode.object'] } } },
  })))
  const errors = (output.errors || []).filter((e) => e.severity === 'error')
  if (errors.length) throw new Error(`kompilasi solc gagal: ${errors.map((e) => e.message).join('; ')}`)
  const compiled = `0x${output.contracts['ArcoxRouter.sol'].ArcoxRouter.evm.bytecode.object}`
  if (compiled !== onDisk) {
    throw new Error('creation-bytecode.txt tidak sama dengan hasil kompilasi solc — jalankan ulang scripts/fetch-verified-sources.mjs')
  }
  return { compiled, solcVersion: solc.version() }
}

const { compiled: bytecode, solcVersion } = loadCreationBytecode()

const privateKey = loadPrivateKey(args)
const account = privateKeyToAccount(privateKey)
const owner = getAddress(args.owner || process.env.ARCOX_FEE_ROUTER_OWNER || account.address)
const treasury = getAddress(args.treasury || process.env.ARCOX_TREASURY_MAINNET || '')
if (args.feeBps > 1000) throw new Error('fee bps > 1000 akan ditolak kontrak (FEE_TOO_HIGH)')

const selected = args.chains.split(',').map((s) => s.trim()).filter(Boolean)
for (const key of selected) if (!CHAINS[key]) throw new Error(`chain tidak didukung: ${key}`)

console.log(`Fee Router deploy plan — mode ${args.broadcast ? 'BROADCAST (mengirim transaksi!)' : 'DRY-RUN'}`)
console.log(`  deployer/owner : ${account.address}`)
console.log(`  treasury       : ${treasury}`)
console.log(`  feeBps         : ${args.feeBps} (${args.feeBps / 100}%)`)
console.log(`  chain          : ${selected.join(', ')}`)
console.log(`  bytecode       : ${(bytecode.length - 2) / 2} bytes (keccak ${keccak256(bytecode).slice(0, 18)}...)`)
console.log(`  solc           : ${solcVersion} (optimizer 200)`)

const results = []
let blocked = false

for (const key of selected) {
  const c = CHAINS[key]
  const domainsToEnable = selected.map((k) => CHAINS[k].cctpDomain).filter((d) => d !== c.cctpDomain)
  console.log(`\n=== ${c.name} (${key}) ===`)
  const transport = http(c.rpc, { timeout: 20000, retryCount: 2 })
  const publicClient = createPublicClient({ transport })

  const data = encodeDeployData({
    abi, bytecode,
    args: [owner, treasury, getAddress(c.usdc), getAddress(c.tokenMessenger), c.cctpDomain, args.feeBps],
  })

  const entry = {
    chain: key, name: c.name, chainId: c.id, explorer: c.explorer, dryRun: !args.broadcast,
    constructor: { initialOwner: owner, initialTreasury: treasury, usdc: getAddress(c.usdc), tokenMessenger: getAddress(c.tokenMessenger), localDomain: c.cctpDomain, feeBps: args.feeBps },
    destinationDomains: domainsToEnable, address: null, deployTx: null, domainTxs: [], error: null,
  }

  try {
    const [chainId, usdcCode, tmCode, balance, gasPrice] = await Promise.all([
      publicClient.getChainId(),
      publicClient.getBytecode({ address: getAddress(c.usdc) }),
      publicClient.getBytecode({ address: getAddress(c.tokenMessenger) }),
      publicClient.getBalance({ address: account.address }),
      publicClient.getGasPrice(),
    ])
    if (chainId !== c.id) throw new Error(`RPC chainId ${chainId} != ${c.id}`)
    if (!usdcCode) throw new Error(`USDC tidak ada kode di ${c.usdc}`)
    if (!tmCode) throw new Error(`TokenMessengerV2 tidak ada kode di ${c.tokenMessenger}`)
    const gasEstimate = await publicClient.estimateGas({ account: account.address, data })
    const gasCap = gasEstimate * 12n / 10n
    const maxGasPrice = args.maxGasPriceGwei ? parseGwei(String(args.maxGasPriceGwei)) : gasPrice * 2n
    // Kontrak belum ada, jadi tx setSupportedDestinationDomain tidak bisa diestimasi
    // sungguhan — pakai anggaran konservatif 60k gas per domain.
    const DOMAIN_GAS_BUDGET = 60_000n
    const domainGasBudget = DOMAIN_GAS_BUDGET * BigInt(domainsToEnable.length)
    const worstCost = (gasCap + domainGasBudget) * maxGasPrice
    const ok = balance > worstCost

    console.log(`  chainId      : ${chainId} ✓`)
    console.log(`  USDC         : ${c.usdc} (${usdcCode.length} hex) ✓`)
    console.log(`  TokenMsgV2   : ${c.tokenMessenger} (${tmCode.length} hex) ✓`)
    console.log(`  saldo        : ${formatUnits(balance, c.nativeDecimals)} ${c.nativeSymbol}  | gasPrice ${formatUnits(gasPrice, 9)} gwei`)
    console.log(`  gas estimate : deploy ${gasEstimate} (cap ${gasCap}) + domain ${domainGasBudget} → biaya maks ${formatUnits(worstCost, c.nativeDecimals)} ${c.nativeSymbol}`)
    console.log(`  pendanaan    : ${ok ? 'CUKUP ✓' : `KURANG ✗ (butuh minimal ${formatUnits(worstCost, c.nativeDecimals)} ${c.nativeSymbol})`}`)
    console.log(`  domain aktif : ${domainsToEnable.length ? domainsToEnable.join(', ') : '(tidak ada)'}`)
    entry.usdcCodeBytes = usdcCode.length / 2 - 1
    entry.tokenMessengerCodeBytes = tmCode.length / 2 - 1
    entry.gasEstimate = String(gasEstimate)
    entry.gasCap = String(gasCap)
    entry.domainGasBudget = String(domainGasBudget)
    entry.gasPriceWei = String(gasPrice)
    entry.balance = formatUnits(balance, c.nativeDecimals)
    entry.worstCost = formatUnits(worstCost, c.nativeDecimals)
    entry.funded = ok

    if (!ok) {
      blocked = true
      entry.error = 'saldo deployer tidak cukup'
      results.push(entry)
      continue
    }
    if (!args.broadcast) {
      console.log('  → dry-run: transaksi TIDAK dikirim')
      results.push(entry)
      continue
    }

    const walletClient = createWalletClient({ account, transport })
    const hash = await walletClient.sendTransaction({ data, gas: gasCap, maxFeePerGas: maxGasPrice, maxPriorityFeePerGas: 0n })
    console.log(`  deploy tx    : ${hash}`)
    entry.deployTx = hash
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180000 })
    entry.address = receipt.contractAddress
    entry.blockNumber = String(receipt.blockNumber)
    console.log(`  alamat       : ${receipt.contractAddress}`)
    console.log(`  block        : ${receipt.blockNumber} status=${receipt.status}`)

    for (const domain of domainsToEnable) {
      // Gas limit eksplisit: tx ini pernah revert out-of-gas saat limit default
      // (22.026) dipakai, jadi jangan bergantung pada estimasi otomatis.
      const tx = await walletClient.writeContract({
        address: receipt.contractAddress, abi, functionName: 'setSupportedDestinationDomain',
        args: [domain, true], gas: 120_000n, maxPriorityFeePerGas: 0n,
      })
      const r = await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 180000 })
      entry.domainTxs.push({ domain, hash: tx, status: r.status, blockNumber: String(r.blockNumber) })
      console.log(`  domain ${domain} : ${tx} status=${r.status}`)
    }
  } catch (err) {
    blocked = true
    entry.error = err.shortMessage || err.message
    console.log(`  GAGAL: ${entry.error}`)
  }
  results.push(entry)
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
const outPath = join(OUT_DIR, 'fee-router-mainnet.json')
writeFileSync(outPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  broadcast: args.broadcast,
  deployer: account.address,
  owner, treasury, feeBps: args.feeBps,
  bytecodeKeccak256: keccak256(bytecode),
  chains: results,
}, null, 2)}\n`)
console.log(`\nhasil ditulis: ${outPath}`)
if (blocked) {
  console.log('\nADA BLOCKER — perbaiki dulu sebelum broadcast.')
  process.exit(1)
}
console.log(args.broadcast ? '\nSELESAI: kontrak ter-deploy.' : '\nDRY-RUN OK: siap broadcast (ulangi dengan --broadcast).')
