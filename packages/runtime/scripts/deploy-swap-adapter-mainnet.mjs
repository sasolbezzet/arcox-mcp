#!/usr/bin/env node
/**
 * Deploy ARCOX Swap Adapter ke mainnet: implementation `Adapter` + `TransparentUpgradeableProxy`.
 *
 * Alamat yang dipakai sistem adalah PROXY-nya; implementation hanya di-deploy sekali.
 *
 * Catatan penting soal kontraknya: `Adapter` TIDAK punya field treasury maupun fee.
 * Fungsinya: `initialize(address owner_, address signer_, uint256 signerThreshold_)`
 * lalu `execute(...)` / `executeSponsored(...)` dengan tanda tangan EIP-712 dari
 * signer. Treasury (fee 5%) ada di kontrak ARCOX Fee Router, bukan di sini.
 *
 * Konstruktor proxy: `(_logic, initialOwner, _data)`. OZ membuat ProxyAdmin baru
 * yang dimiliki `initialOwner`, jadi `--proxy-admin-owner` adalah pemilik admin
 * proxy (satu-satunya yang bisa upgrade).
 *
 * Default DRY-RUN. Tidak ada transaksi terkirim tanpa `--broadcast`.
 *
 * Pakai:
 *   node packages/runtime/scripts/deploy-swap-adapter-mainnet.mjs \
 *     --key-file /home/ubuntu/.arcox/agent.env:EOA_PRIVATE_KEY \
 *     --adapter-owner 0x... --signer 0x... --signer-threshold 1 \
 *     --proxy-admin-owner 0x... --chains arc,base,arbitrum
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, http, getAddress, encodeAbiParameters, encodeFunctionData, keccak256, formatUnits, parseGwei } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCES = join(HERE, '..', 'mainnet-sources')
const OUT_DIR = join(HERE, '..', 'deployments')
const OUT_FILE = join(OUT_DIR, 'swap-adapter-mainnet.json')

const CHAINS = {
  arc: { name: 'Arc Mainnet', id: 5042, rpc: 'https://rpc.mainnet.arc.io', explorer: 'https://explorer.arc.io', nativeDecimals: 18, nativeSymbol: 'USDC' },
  base: { name: 'Base Mainnet', id: 8453, rpc: 'https://mainnet.base.org', fallbackRpc: 'https://base-rpc.publicnode.com', explorer: 'https://basescan.org', nativeDecimals: 18, nativeSymbol: 'ETH' },
  arbitrum: { name: 'Arbitrum One', id: 42161, rpc: 'https://arb1.arbitrum.io/rpc', fallbackRpc: 'https://arbitrum-one-rpc.publicnode.com', explorer: 'https://arbiscan.io', nativeDecimals: 18, nativeSymbol: 'ETH' },
}

/** Kontrak referensi di Arc testnet, untuk membandingkan bytecode setelah deploy. */
const TESTNET_REFERENCE = {
  impl: '0xb4d0aA6Ca5e12B8a77b86989305A7F15462Ac2D4',
  proxy: '0xBBD70b01a1CAbc96d5b7b129Ae1AAabdf50dd40b',
  rpc: 'https://rpc.testnet.arc.network',
}

function parseArgs(argv) {
  const out = { chains: 'arc,base,arbitrum', broadcast: false, signerThreshold: 1, gasPriceMultiplier: 1.25, gasLimitMultiplier: 1.15, proxyGasLimit: 1_200_000n }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--broadcast') out.broadcast = true
    else if (a === '--key-file') out.keyFile = argv[++i]
    else if (a === '--adapter-owner') out.adapterOwner = argv[++i]
    else if (a === '--signer') out.signer = argv[++i]
    else if (a === '--signer-threshold') out.signerThreshold = Number(argv[++i])
    else if (a === '--proxy-admin-owner') out.proxyAdminOwner = argv[++i]
    else if (a === '--chains') out.chains = argv[++i]
    else if (a === '--gas-price-multiplier') out.gasPriceMultiplier = Number(argv[++i])
    else if (a === '--gas-limit-multiplier') out.gasLimitMultiplier = Number(argv[++i])
    else if (a === '--proxy-gas-limit') out.proxyGasLimit = BigInt(argv[++i])
    else throw new Error(`argumen tidak dikenal: ${a}`)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const [keyFile, keyVar] = String(args.keyFile || '').split(':')
if (!keyFile || !keyVar) throw new Error('perlu --key-file <path>:<VAR>')
const line = readFileSync(keyFile, 'utf8').split('\n').find((l) => l.startsWith(`${keyVar}=`))
if (!line) throw new Error(`variabel ${keyVar} tidak ada di ${keyFile}`)
const account = privateKeyToAccount(line.slice(keyVar.length + 1).trim().replace(/^["']|["']$/g, ''))

const owner_ = getAddress(args.adapterOwner || account.address)
const signer_ = getAddress(args.signer || account.address)
const proxyAdminOwner = getAddress(args.proxyAdminOwner || account.address)

const adapterAbi = JSON.parse(readFileSync(join(SOURCES, 'Adapter', 'abi.json'), 'utf8'))
const implBytecode = readFileSync(join(SOURCES, 'Adapter', 'creation-bytecode.txt'), 'utf8').trim().replace(/\s/g, '')
const proxyBytecode = readFileSync(join(SOURCES, 'TransparentUpgradeableProxy-SwapAdapter', 'creation-bytecode.txt'), 'utf8').trim().replace(/\s/g, '')
if (!/^0x60/.test(implBytecode) || !/^0x60/.test(proxyBytecode)) throw new Error('creation-bytecode.txt tidak valid')

// `Adapter` tidak punya constructor args (args=0B di manifest), jadi creation code
// snapshot bisa dipakai apa adanya. Proxy punya args `(_logic, initialOwner, _data)`
// yang kita susun sendiri — jadi ekor args testnet tidak mungkin ikut terbawa.
const initData = encodeFunctionData({ abi: adapterAbi, functionName: 'initialize', args: [owner_, signer_, BigInt(args.signerThreshold)] })

console.log(`Swap Adapter deploy plan — mode ${args.broadcast ? 'BROADCAST (mengirim transaksi!)' : 'DRY-RUN'}`)
console.log(`  deployer          : ${account.address}`)
console.log(`  adapter owner     : ${owner_}`)
console.log(`  signer EIP-712    : ${signer_} (threshold ${args.signerThreshold})`)
console.log(`  proxy admin owner : ${proxyAdminOwner}`)
console.log(`  impl bytecode     : ${(implBytecode.length - 2) / 2} bytes`)
console.log(`  proxy bytecode    : ${(proxyBytecode.length - 2) / 2} bytes + args`)
console.log(`  init data         : ${initData}`)

const results = []
let blocked = false

for (const key of args.chains.split(',').map((s) => s.trim()).filter(Boolean)) {
  const c = CHAINS[key]
  if (!c) throw new Error(`chain tidak didukung: ${key}`)
  console.log(`\n=== ${c.name} (${key}) ===`)
  const publicClient = createPublicClient({ transport: http(c.rpc, { timeout: 20000, retryCount: 2 }) })
  const entry = {
    chain: key, name: c.name, chainId: c.id, explorer: c.explorer, dryRun: !args.broadcast,
    adapterOwner: owner_, signer: signer_, signerThreshold: args.signerThreshold, proxyAdminOwner,
    implementation: null, proxy: null, implDeployTx: null, proxyDeployTx: null, error: null,
  }
  try {
    const [chainId, balance, gasPrice] = await Promise.all([
      publicClient.getChainId(), publicClient.getBalance({ address: account.address }), publicClient.getGasPrice(),
    ])
    if (chainId !== c.id) throw new Error(`RPC chainId ${chainId} != ${c.id}`)

    const implGas = await publicClient.estimateGas({ account: account.address, data: implBytecode })

    // Proxy TIDAK bisa diestimasi sebelum implementation-nya ada: konstruktor OZ
    // mendelegatecall `_data` (initialize) ke `_logic`, dan delegatecall ke alamat
    // tanpa kode selalu revert — jadi estimasi dengan alamat dummy gagal, bukan
    // karena data kita salah. Kalau implementasi sudah ter-deploy di chain ini,
    // estimasi sungguhan dicoba; kalau belum, pakai limit tetap (1,2 juta gas:
    // deploy ProxyAdmin + proxy + satu delegatecall initialize).
    let proxyGas = args.proxyGasLimit
    let proxyGasSource = 'limit tetap'
    if (entry.implementation) {
      try {
        const argsReal = encodeAbiParameters(
          [{ type: 'address' }, { type: 'address' }, { type: 'bytes' }],
          [getAddress(entry.implementation), proxyAdminOwner, initData],
        )
        proxyGas = await publicClient.estimateGas({ account: account.address, data: `${proxyBytecode}${argsReal.slice(2)}` })
        proxyGasSource = 'estimasi'
      } catch { /* pakai limit tetap */ }
    }

    const gasLimitMul = BigInt(Math.round(args.gasLimitMultiplier * 100))
    const maxGasPrice = gasPrice * BigInt(Math.round(args.gasPriceMultiplier * 100)) / 100n
    const implLimit = implGas * gasLimitMul / 100n
    const proxyLimit = proxyGas * gasLimitMul / 100n
    const reserved = (implLimit + proxyLimit) * maxGasPrice
    const ok = balance > reserved

    console.log(`  chainId           : ${chainId} ✓`)
    console.log(`  saldo             : ${formatUnits(balance, c.nativeDecimals)} ${c.nativeSymbol} | gasPrice ${formatUnits(gasPrice, 9)} gwei`)
    console.log(`  gas impl          : ${implGas} (limit ${implLimit})`)
    console.log(`  gas proxy         : ${proxyGas} (limit ${proxyLimit}, ${proxyGasSource})`)
    console.log(`  reservasi         : ${formatUnits(reserved, c.nativeDecimals)} ${c.nativeSymbol}`)
    console.log(`  pendanaan         : ${ok ? 'CUKUP ✓' : `KURANG ✗ (butuh ~${formatUnits(reserved, c.nativeDecimals)} ${c.nativeSymbol})`}`)

    entry.implGasEstimate = String(implGas)
    entry.proxyGasEstimate = String(proxyGas)
    entry.gasPriceWei = String(gasPrice)
    entry.balance = formatUnits(balance, c.nativeDecimals)
    entry.reserved = formatUnits(reserved, c.nativeDecimals)
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

    const walletClient = createWalletClient({ account, transport: http(c.rpc, { timeout: 20000, retryCount: 2 }) })

    const implHash = await walletClient.sendTransaction({ data: implBytecode, gas: implLimit, maxFeePerGas: maxGasPrice, maxPriorityFeePerGas: 0n })
    const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implHash, timeout: 300000 })
    entry.implDeployTx = implHash
    entry.implementation = implReceipt.contractAddress
    console.log(`  impl              : ${implReceipt.contractAddress} (tx ${implHash.slice(0, 18)}… status=${implReceipt.status})`)

    const proxyDeployDataSigned = `${proxyBytecode}${encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'bytes' }],
      [getAddress(implReceipt.contractAddress), proxyAdminOwner, initData],
    ).slice(2)}`
    const proxyHash = await walletClient.sendTransaction({ data: proxyDeployDataSigned, gas: proxyLimit, maxFeePerGas: maxGasPrice, maxPriorityFeePerGas: 0n })
    const proxyReceipt = await publicClient.waitForTransactionReceipt({ hash: proxyHash, timeout: 300000 })
    entry.proxyDeployTx = proxyHash
    entry.proxy = proxyReceipt.contractAddress
    console.log(`  proxy             : ${proxyReceipt.contractAddress} (tx ${proxyHash.slice(0, 18)}… status=${proxyReceipt.status})`)

    // Konfirmasi init benar-benar terpakai lewat proxy.
    const proxyAddress = getAddress(proxyReceipt.contractAddress)
    const [readOwner, readThreshold] = await Promise.all([
      publicClient.readContract({ address: proxyAddress, abi: adapterAbi, functionName: 'owner' }),
      publicClient.readContract({ address: proxyAddress, abi: adapterAbi, functionName: 'signerThreshold' }),
    ])
    const isSigner = await publicClient.readContract({ address: proxyAddress, abi: adapterAbi, functionName: 'isSigner', args: [signer_] })
    entry.readBack = { owner: readOwner, signerThreshold: Number(readThreshold), signerRegistered: isSigner }
    const initOk = readOwner.toLowerCase() === owner_.toLowerCase() && Number(readThreshold) === args.signerThreshold && isSigner
    console.log(`  read-back         : owner=${readOwner} threshold=${readThreshold} signerTerdaftar=${isSigner} → ${initOk ? 'OK ✓' : 'TIDAK SESUAI ✗'}`)
    if (!initOk) { blocked = true; entry.error = 'state hasil init tidak sesuai' }
  } catch (error) {
    blocked = true
    entry.error = error.shortMessage || error.message
    console.log(`  GAGAL: ${entry.error}`)
  }
  results.push(entry)
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
let previous = { chains: [] }
if (existsSync(OUT_FILE)) { try { previous = JSON.parse(readFileSync(OUT_FILE, 'utf8')) } catch { previous = { chains: [] } } }
const previousByChain = new Map((previous.chains || []).map((entry) => [entry.chain, entry]))
const mergedChains = results.map((entry) => {
  const before = previousByChain.get(entry.chain)
  if (!before) return entry
  const proxy = entry.proxy || before.proxy || null
  const implementation = entry.implementation || before.implementation || null
  // Bukti verifikasi hanya dipertahankan kalau alamatnya masih kontrak yang sama;
  // kalau ada deploy baru di chain ini, hasil verifikasi lama sudah tidak relevan.
  const sameContracts = proxy === (before.proxy || null) && implementation === (before.implementation || null)
  return {
    ...entry,
    proxy,
    implementation,
    proxyDeployTx: entry.proxyDeployTx || before.proxyDeployTx || null,
    implDeployTx: entry.implDeployTx || before.implDeployTx || null,
    // Hasil verifikasi (on-chain + Sourcify) dipertahankan; run deploy tidak
    // boleh menghapus bukti yang sudah dikumpulkan verify-swap-adapter-mainnet.
    readBack: entry.readBack || (sameContracts ? before.readBack : null) || null,
    verified: entry.verified || (sameContracts ? before.verified : null) || null,
    sourcify: entry.sourcify || (sameContracts ? before.sourcify : null) || null,
  }
})
for (const [chain, before] of previousByChain) if (!mergedChains.some((e) => e.chain === chain)) mergedChains.push(before)

writeFileSync(OUT_FILE, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  broadcast: args.broadcast,
  deployer: account.address,
  adapterOwner: owner_,
  signer: signer_,
  signerThreshold: args.signerThreshold,
  proxyAdminOwner,
  initData,
  initDataKeccak256: keccak256(initData),
  implBytecodeKeccak256: keccak256(implBytecode),
  proxyBytecodeKeccak256: keccak256(proxyBytecode),
  testnetReference: TESTNET_REFERENCE,
  chains: mergedChains,
}, null, 2)}\n`)
console.log(`\nhasil ditulis: ${OUT_FILE}`)
if (blocked) { console.log('\nADA BLOCKER — perbaiki dulu sebelum broadcast.'); process.exit(1) }
console.log(args.broadcast ? '\nSELESAI.' : '\nDRY-RUN OK: siap broadcast.')
