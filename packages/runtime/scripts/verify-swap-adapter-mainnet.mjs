#!/usr/bin/env node
/**
 * Verifikasi ARCOX Swap Adapter mainnet — implementation `Adapter` + proxy
 * `TransparentUpgradeableProxy` (`ProxyAdmin` dibuat di konstruktor proxy).
 *
 * Tiga lapis:
 *  1. WIRING on-chain — kode ada di proxy & implementation, slot EIP-1967
 *     (implementation + admin) menunjuk alamat yang benar, dan `owner()` di
 *     ProxyAdmin = `proxyAdminOwner` yang tercatat.
 *  2. STATE lewat proxy (delegatecall) — owner, signerThreshold, signer EIP-712
 *     terdaftar; implementation mentah TIDAK pernah di-initialize (owner = 0x0)
 *     supaya tidak bisa dipakai sebagai backdoor.
 *  3. PROVENANCE bytecode — kompilasi ulang snapshot sumber (solc 0.8.28,
 *     optimizer 200 runs, viaIR, evmVersion paris) lalu bandingkan runtime
 *     bytecode on-chain dengan area immutable di-mask.
 *
 * `--sourcify` mempublikasikan sumber implementation + proxy ke Sourcify (API v2)
 * karena explorer Arc Mainnet memblokir akses API dari server.
 *
 * Read-only terhadap chain: tidak mengirim transaksi apa pun.
 *
 * Pakai: node packages/runtime/scripts/verify-swap-adapter-mainnet.mjs [--chains arc] [--sourcify]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createPublicClient, http, getAddress, keccak256, formatUnits } from 'viem'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCES_ROOT = join(HERE, '..', 'mainnet-sources')
const DEPLOYMENTS = join(HERE, '..', 'deployments', 'swap-adapter-mainnet.json')
const SOURCIFY_API = 'https://sourcify.dev/server'

const CHAINS = {
  arc: { name: 'Arc Mainnet', id: 5042, rpc: 'https://rpc.mainnet.arc.io', explorer: 'https://explorer.arc.io', nativeSymbol: 'USDC', nativeDecimals: 18 },
  base: { name: 'Base Mainnet', id: 8453, rpc: 'https://base-rpc.publicnode.com', explorer: 'https://basescan.org', nativeSymbol: 'ETH', nativeDecimals: 18 },
  arbitrum: { name: 'Arbitrum One', id: 42161, rpc: 'https://arbitrum-one-rpc.publicnode.com', explorer: 'https://arbiscan.io', nativeSymbol: 'ETH', nativeDecimals: 18 },
}

// Slot EIP-1967 (dari ERC1967Utils OpenZeppelin).
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
const ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103'

const PROXY_ADMIN_ABI = [{
  type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }],
}]

const adapterAbi = JSON.parse(readFileSync(join(SOURCES_ROOT, 'Adapter', 'abi.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(SOURCES_ROOT, 'manifest.json'), 'utf8'))
const log = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8'))

const args = process.argv.slice(2)
const onlyIdx = args.indexOf('--chains')
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',').map((s) => s.trim()) : null
const runSourcify = args.includes('--sourcify')

let failures = 0
const check = (label, actual, expected) => {
  const a = typeof actual === 'string' ? actual.toLowerCase() : actual
  const e = typeof expected === 'string' ? expected.toLowerCase() : expected
  const ok = String(a) === String(e)
  if (!ok) failures++
  console.log(`    ${ok ? '✓' : '✗'} ${label.padEnd(30)} ${actual}${ok ? '' : `  (diharapkan ${expected})`}`)
  return ok
}

// ── 0. Susun standard JSON input dari snapshot sumber ───────────────────────
// Snapshot menyimpan berkas utama dengan nama pipih (`src_adapter_Adapter.sol`)
// dan pohon impor apa adanya di `imports/` — jadi jalur asli tiap berkas bisa
// direkonstruksi (relatif terhadap `imports/`), termasuk remapping
// `@openzeppelin/…` yang dicatat di manifest.
function buildInput(label) {
  const entry = manifest.contracts.find((c) => c.label === label)
  if (!entry) throw new Error(`entri manifest tidak ada: ${label}`)
  const dir = join(SOURCES_ROOT, label)
  const mainPath = entry.filePath
  // `sourceFile` di manifest relatif terhadap mainnet-sources/, bukan folder label.
  const sources = { [mainPath]: { content: readFileSync(join(SOURCES_ROOT, entry.sourceFile), 'utf8') } }
  const importsDir = join(dir, 'imports')
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      const key = relative(importsDir, full).split(sep).join('/')
      if (!sources[key]) sources[key] = { content: readFileSync(full, 'utf8') }
    }
  }
  if (statSync(importsDir).isDirectory()) walk(importsDir)
  const settings = {
    optimizer: entry.compilerSettings.optimizer ?? { enabled: true, runs: 200 },
    evmVersion: entry.evmVersion,
    viaIR: entry.compilerSettings.viaIR === true,
    remappings: entry.compilerSettings.remappings ?? [],
    outputSelection: { '*': { '*': ['evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences', 'metadata'] } },
  }
  return { entry, stdJsonInput: { language: 'Solidity', sources, settings } }
}

const compiled = {}
const solcVersion = manifest.contracts.find((c) => c.label === 'Adapter').compilerVersion
console.log(`=== Kompilasi ulang snapshot sumber (solc ${solcVersion}, optimizer 200, viaIR, paris) ===`)
const solc = await new Promise((resolve, reject) => {
  require('solc').loadRemoteVersion(solcVersion, (err, s) => (err ? reject(err) : resolve(s)))
})
console.log(`  solc ${solc.version()}`)

for (const label of ['Adapter', 'TransparentUpgradeableProxy-SwapAdapter']) {
  const { entry, stdJsonInput } = buildInput(label)
  const out = JSON.parse(solc.compile(JSON.stringify(stdJsonInput)))
  const errors = (out.errors || []).filter((e) => e.severity === 'error')
  if (errors.length) {
    console.error(`  ✗ ${label}: kompilasi gagal\n${errors.map((e) => e.formattedMessage).join('\n')}`)
    process.exit(1)
  }
  const contract = out.contracts[entry.filePath][entry.contractName]
  const runtime = `0x${contract.evm.deployedBytecode.object}`
  const creation = `0x${contract.evm.bytecode.object}`
  const immutableSlots = Object.values(contract.evm.deployedBytecode.immutableReferences || {})
    .flat().map((r) => ({ start: r.start * 2, length: r.length * 2 }))
  const snapshot = readFileSync(join(SOURCES_ROOT, label, 'creation-bytecode.txt'), 'utf8').trim().replace(/\s/g, '')
  compiled[label] = { entry, runtime, creation, immutableSlots, stdJsonInput }
  console.log(`  · ${entry.contractName.padEnd(28)} runtime ${(runtime.length - 2) / 2} byte, creation ${(creation.length - 2) / 2} byte, immutable mask ${immutableSlots.length} area`)
  const snapshotOk = keccak256(creation) === keccak256(snapshot)
  if (!snapshotOk) failures++
  console.log(`    ${snapshotOk ? '✓' : '✗'} snapshot creation-bytecode.txt identik dengan hasil kompilasi ulang`)
}

function maskImmutables(hex, slots) {
  const chars = hex.slice(2).split('')
  for (const { start, length } of slots) for (let i = start; i < start + length && i < chars.length; i++) chars[i] = '?'
  return chars.join('')
}
const sameCode = (a, b, slots) => a && b && a.length === b.length && maskImmutables(a, slots) === maskImmutables(b, slots)

// ── 1+2+3. Verifikasi per chain ─────────────────────────────────────────────
for (const entry of log.chains) {
  if (!entry.proxy) { console.log(`\n=== ${entry.name}: belum ter-deploy (dilewati) ===`); continue }
  if (only && !only.includes(entry.chain)) continue
  const c = CHAINS[entry.chain]
  const proxy = getAddress(entry.proxy)
  const impl = getAddress(entry.implementation)
  console.log(`\n=== ${c.name} — proxy ${proxy} ===`)
  const client = createPublicClient({ transport: http(c.rpc, { timeout: 20000, retryCount: 2 }) })

  const chainId = await client.getChainId()
  check('chainId RPC', chainId, c.id)

  const [proxyCode, implCode] = await Promise.all([
    client.getBytecode({ address: proxy }),
    client.getBytecode({ address: impl }),
  ])
  if (proxyCode && implCode) console.log(`    ✓ kode ada            proxy ${(proxyCode.length - 2) / 2} byte, implementation ${(implCode.length - 2) / 2} byte`)
  else { failures++; console.log(`    ✗ kode TIDAK LENGKAP  proxy=${(proxyCode || 'kosong').length} implementation=${(implCode || 'kosong').length}`) }

  // EIP-1967: implementation + admin
  const [implWord, adminWord] = await Promise.all([
    client.getStorageAt({ address: proxy, slot: IMPLEMENTATION_SLOT }),
    client.getStorageAt({ address: proxy, slot: ADMIN_SLOT }),
  ])
  const implFromSlot = getAddress(`0x${implWord.slice(-40)}`)
  const adminFromSlot = getAddress(`0x${adminWord.slice(-40)}`)
  check('slot EIP-1967 implementation', implFromSlot, impl)
  console.log(`    · slot EIP-1967 admin     ${adminFromSlot}`)
  const [adminCode, adminOwner] = await Promise.all([
    client.getBytecode({ address: adminFromSlot }),
    client.readContract({ address: adminFromSlot, abi: PROXY_ADMIN_ABI, functionName: 'owner' }),
  ])
  if (!adminCode || adminCode === '0x') { failures++; console.log('    ✗ ProxyAdmin tidak punya kode') }
  check('ProxyAdmin.owner', adminOwner, log.proxyAdminOwner)

  // State lewat proxy (delegatecall)
  const [owner_, threshold, signerCount, paused, pendingOwner, rawOwner] = await Promise.all([
    client.readContract({ address: proxy, abi: adapterAbi, functionName: 'owner' }),
    client.readContract({ address: proxy, abi: adapterAbi, functionName: 'signerThreshold' }),
    client.readContract({ address: proxy, abi: adapterAbi, functionName: 'signerCount' }),
    client.readContract({ address: proxy, abi: adapterAbi, functionName: 'paused' }),
    client.readContract({ address: proxy, abi: adapterAbi, functionName: 'pendingOwner' }),
    client.readContract({ address: impl, abi: adapterAbi, functionName: 'owner' }),
  ])
  const isSigner = await client.readContract({ address: proxy, abi: adapterAbi, functionName: 'isSigner', args: [getAddress(log.signer)] })
  check('proxy owner', owner_, log.adapterOwner)
  check('proxy signerThreshold', Number(threshold), log.signerThreshold)
  check('proxy isSigner(signer)', isSigner, true)
  check('proxy paused', paused, false)
  check('proxy pendingOwner', pendingOwner, '0x0000000000000000000000000000000000000000')
  check('implementation mentah belum di-init', rawOwner, '0x0000000000000000000000000000000000000000')
  console.log(`    · signerCount             ${signerCount}`)

  // Provenance bytecode (immutable di-mask)
  const implMatch = sameCode(implCode, compiled['Adapter'].runtime, compiled['Adapter'].immutableSlots)
  const proxyMatch = sameCode(proxyCode, compiled['TransparentUpgradeableProxy-SwapAdapter'].runtime, compiled['TransparentUpgradeableProxy-SwapAdapter'].immutableSlots)
  if (!implMatch) failures++
  if (!proxyMatch) failures++
  console.log(`    ${implMatch ? '✓' : '✗'} bytecode implementation cocok dengan sumber (immutable di-mask)`)
  console.log(`    ${proxyMatch ? '✓' : '✗'} bytecode proxy cocok dengan sumber (immutable di-mask)`)

  const bal = await client.getBalance({ address: getAddress(log.deployer) })
  console.log(`    · saldo deployer tersisa ${formatUnits(bal, c.nativeDecimals)} ${c.nativeSymbol}`)
  console.log(`    · ${c.explorer}/address/${proxy}`)

  entry.verified = {
    checkedAt: new Date().toISOString(),
    chainId,
    proxyCodeBytes: proxyCode ? (proxyCode.length - 2) / 2 : 0,
    implCodeBytes: implCode ? (implCode.length - 2) / 2 : 0,
    implementationSlot: implFromSlot,
    adminSlot: adminFromSlot,
    proxyAdminOwner: adminOwner,
    owner: owner_,
    signerThreshold: Number(threshold),
    signerRegistered: isSigner,
    implBytecodeMatch: implMatch,
    proxyBytecodeMatch: proxyMatch,
  }
}

// ── 4. Sourcify (opsional) ──────────────────────────────────────────────────
if (runSourcify) {
  console.log('\n=== Sourcify (publikasi sumber + match) ===')
  for (const chainEntry of log.chains) {
    if (only && !only.includes(chainEntry.chain)) continue
    for (const [kind, target, txKey] of [
      ['implementation', chainEntry.implementation, chainEntry.implDeployTx],
      ['proxy', chainEntry.proxy, chainEntry.proxyDeployTx],
    ]) {
      if (!target) continue
      const key = kind === 'implementation' ? 'Adapter' : 'TransparentUpgradeableProxy-SwapAdapter'
      const { entry: meta, stdJsonInput } = compiled[key]
      const contractIdentifier = `${meta.filePath}:${meta.contractName}`
      const label = `${chainEntry.name.padEnd(14)} ${kind.padEnd(15)} ${target}`
      process.stdout.write(`Sourcify ${label} … `)
      try {
        const submit = await fetch(`${SOURCIFY_API}/v2/verify/${chainEntry.chainId}/${target}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stdJsonInput,
            compilerVersion: meta.compilerVersion.replace(/^v/, ''),
            contractIdentifier,
            creationTransactionHash: txKey || undefined,
          }),
          signal: AbortSignal.timeout(180_000),
        })
        const submitted = await submit.json().catch(() => ({}))
        if (submitted?.customCode === 'already_verified') console.log('sudah terverifikasi (already_verified)')
        if (submitted?.verificationId) {
          for (let attempt = 0; attempt < 40; attempt++) {
            await new Promise((r) => setTimeout(r, 3000))
            const poll = await fetch(`${SOURCIFY_API}/v2/verify/${submitted.verificationId}`, { signal: AbortSignal.timeout(30_000) })
            const body = await poll.json().catch(() => ({}))
            if (body?.isJobCompleted === true || body?.status === 'failed' || body?.status === 'error') break
          }
        } else if (!submitted?.customCode) {
          failures++
          console.log(`❌ submit gagal: ${JSON.stringify(submitted).slice(0, 200)}`)
          continue
        }
        const lookup = await fetch(`${SOURCIFY_API}/v2/contract/${chainEntry.chainId}/${target}?fields=all`, { signal: AbortSignal.timeout(60_000) })
        const body = await lookup.json().catch(() => ({}))
        const status = body?.match || body?.runtimeMatch || body?.creationMatch
        const dir = `${chainEntry.chainId}/${target.toLowerCase()}`
        chainEntry.sourcify = chainEntry.sourcify || {}
        chainEntry.sourcify[kind] = {
          status: status || 'tidak diketahui',
          creationMatch: body?.creationMatch || null,
          runtimeMatch: body?.runtimeMatch || null,
          repoUrl: `https://repo.sourcify.dev/${dir}`,
          checkedAt: new Date().toISOString(),
        }
        if (status === 'exact_match') console.log('exact_match ✓')
        else { failures++; console.log(`${status} ✗  https://repo.sourcify.dev/${dir}`) }
      } catch (error) {
        failures++
        console.log(`❌ ${error.message}`)
      }
    }
  }
}

writeFileSync(DEPLOYMENTS, `${JSON.stringify({ ...log, updatedAt: new Date().toISOString() }, null, 2)}\n`)
console.log(failures === 0 ? '\nVERIFIKASI LULUS: tidak ada ketidaksesuaian.' : `\nVERIFIKASI GAGAL: ${failures} ketidaksesuaian.`)
process.exit(failures === 0 ? 0 : 1)
