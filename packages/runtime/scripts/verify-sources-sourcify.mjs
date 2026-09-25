#!/usr/bin/env node
/**
 * Publikasikan & verifikasi sumber ARCOX Fee Router ke Sourcify (API v2).
 *
 * Kenapa Sourcify: explorer Arc Mainnet (explorer.arc.io) memblokir akses API dari
 * server (Cloudflare challenge), jadi verifikasi lewat UI Blockscout tidak bisa
 * diotomasi. Sourcify mendukung Arc Mainnet (5042), Base (8453), dan Arbitrum (42161).
 *
 * Jalur: POST /v2/verify/{chainId}/{address} dengan stdJsonInput + compilerVersion +
 * contractIdentifier + creationTransactionHash → dapat verificationId, lalu polling
 * GET /v2/verify/{verificationId} sampai selesai.
 *
 * Pakai: node packages/runtime/scripts/verify-sources-sourcify.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCES = join(HERE, '..', 'mainnet-sources', 'ArcoxRouter')
const DEPLOYMENTS = join(HERE, '..', 'deployments', 'fee-router-mainnet.json')
const API = 'https://sourcify.dev/server'

const source = readFileSync(join(SOURCES, 'ArcoxRouter.sol'), 'utf8')
const log = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8'))

// compilerVersion & settings harus persis seperti saat deploy, kalau tidak
// bytecode hasil kompilasi Sourcify tidak akan sama dengan bytecode on-chain.
const settings = { optimizer: { enabled: true, runs: 200 } }
const stdJsonInput = { language: 'Solidity', sources: { 'ArcoxRouter.sol': { content: source } }, settings }
const compilerVersion = '0.8.35+commit.47b9dedd'
const contractIdentifier = 'ArcoxRouter.sol:ArcoxRouter'

// metadata.json disimpan sebagai artefak untuk verifikasi manual via UI explorer.
const solc = require('solc')
const compileOut = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: stdJsonInput.sources,
  settings: { ...settings, outputSelection: { '*': { '*': ['metadata'] } } },
})))
if (compileOut.contracts) {
  writeFileSync(join(SOURCES, 'metadata.json'), `${compileOut.contracts['ArcoxRouter.sol'].ArcoxRouter.metadata}\n`)
  console.log(`metadata.json diperbarui (solc lokal ${solc.version()})`)
}

let failures = 0
for (const entry of log.chains) {
  if (!entry.address) continue
  const label = `${entry.name.padEnd(14)} ${entry.address}`
  process.stdout.write(`Sourcify ${label} … `)
  try {
    const submit = await fetch(`${API}/v2/verify/${entry.chainId}/${entry.address}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stdJsonInput,
        compilerVersion,
        contractIdentifier,
        creationTransactionHash: entry.deployTx || undefined,
      }),
      signal: AbortSignal.timeout(120_000),
    })
    const submitted = await submit.json().catch(() => ({}))
    // `already_verified` bukan kegagalan — artinya kontrak sudah punya match exact.
    const alreadyVerified = submitted?.customCode === 'already_verified'
    if (!submitted?.verificationId && !alreadyVerified) {
      failures++
      console.log(`❌ submit gagal: ${JSON.stringify(submitted).slice(0, 200)}`)
      entry.sourcify = { status: 'submit_failed', detail: JSON.stringify(submitted).slice(0, 400) }
      continue
    }

    if (submitted.verificationId) {
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3000))
        const poll = await fetch(`${API}/v2/verify/${submitted.verificationId}`, { signal: AbortSignal.timeout(30_000) })
        const body = await poll.json().catch(() => ({}))
        if (body?.isJobCompleted === true || body?.status === 'failed' || body?.status === 'error') break
      }
    }

    // Sumber kebenaran hasil = endpoint lookup, bukan bentuk respons job (bentuknya
    // berubah antar versi). `match` harus exact_match di creation DAN runtime.
    const lookup = await fetch(`${API}/v2/contract/${entry.chainId}/${entry.address}?fields=all`, { signal: AbortSignal.timeout(30_000) })
    const contract = await lookup.json().catch(() => ({}))
    const ok = contract?.match === 'exact_match' && contract?.creationMatch === 'exact_match' && contract?.runtimeMatch === 'exact_match'
    if (ok) console.log(`✅ exact_match (creation + runtime)${alreadyVerified ? ' [sudah ada]' : ''}`)
    else { failures++; console.log(`❌ match=${contract?.match ?? lookup.status} creation=${contract?.creationMatch} runtime=${contract?.runtimeMatch}`) }
    entry.sourcify = {
      status: ok ? 'exact_match' : (contract?.match || `http_${lookup.status}`),
      verificationId: submitted.verificationId || null,
      creationMatch: contract?.creationMatch || null,
      runtimeMatch: contract?.runtimeMatch || null,
      repoUrl: `https://repo.sourcify.dev/${entry.chainId}/${entry.address}`,
      checkedAt: new Date().toISOString(),
    }
  } catch (error) {
    failures++
    console.log(`❌ ${(error?.message || 'gagal').slice(0, 120)}`)
    entry.sourcify = { status: 'error', message: String(error?.message || '').slice(0, 200) }
  }
}

log.verification = { sourcifyCheckedAt: new Date().toISOString(), compilerVersion, contractIdentifier }
writeFileSync(DEPLOYMENTS, `${JSON.stringify(log, null, 2)}\n`)
console.log(failures === 0 ? '\nSEMUA SUMBER TERVERIFIKASI.' : `\n${failures} kontrak belum terverifikasi.`)
process.exit(failures === 0 ? 0 : 1)
