import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { requiredBigInt } from '../packages/runtime/bin/numeric.mjs'

test('empty optional RPC quantities become zero while required values fail closed', () => {
  assert.equal(requiredBigInt('0x', 'instruction.value', true), 0n)
  assert.equal(requiredBigInt('0x2a', 'execution.execId'), 42n)
  assert.throws(() => requiredBigInt('0x', 'execution.execId'), /is missing/)
  assert.throws(() => requiredBigInt('not-a-number', 'execution.deadline'), /is invalid/)
})

test('EOA swap does not send a second platform-fee transfer', async () => {
  const source = await readFile(new URL('../packages/runtime/bin/arcox-agent.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function executeEoaPreparedSwap')
  const end = source.indexOf('function normalizeAdapterExecutionParams', start)
  assert.ok(start >= 0 && end > start)
  const implementation = source.slice(start, end)
  assert.doesNotMatch(implementation, /functionName:\s*['"]transfer['"]/)
  assert.match(implementation, /adapter collects the quoted platform fee inside the swap transaction/)
})

test('Unified Balance adapter routes Arc SDK chain definitions through ARC_RPC', async () => {
  const source = await readFile(new URL('../packages/runtime/bin/arcox-agent.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function unifiedBalanceAdapter()')
  const end = source.indexOf('function normalizeUnifiedBalanceChain', start)
  assert.ok(start >= 0 && end > start)
  const implementation = source.slice(start, end)
  assert.match(implementation, /chain\?\.id === arcTestnet\.id/)
  assert.match(implementation, /chain\?\.chainId === arcTestnet\.id/)
  assert.match(implementation, /rpcTransport\(ARC_RPC\)/)
})

test('Auto-mint state is persisted in ~/.arcox, not inside the package directory', async () => {
  const source = await readFile(new URL('../packages/runtime/bin/arcox-agent.mjs', import.meta.url), 'utf8')
  assert.match(source, /STATE_HOME = process\.env\.ARCOX_STATE_HOME \|\| join\(homedir\(\), '\.arcox'\)/)
  assert.match(source, /AUTO_MINT_DIR = join\(STATE_HOME, '\.arcox-auto-mint'\)/)
  assert.match(source, /TX_HISTORY_FILE = join\(STATE_HOME, '\.arcox-agent-history\.json'\)/)
  assert.match(source, /cwd: STATE_HOME/)
})

test('scheduleAutoMint does not spawn a duplicate worker for an already-complete or actively-running job', async () => {
  const source = await readFile(new URL('../packages/runtime/bin/arcox-agent.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function scheduleAutoMint(')
  const end = source.indexOf('function privateKey()', start)
  assert.ok(start >= 0 && end > start)
  const impl = source.slice(start, end)
  assert.match(impl, /\['complete', 'complete_external'\]\.includes\(existing\?\.status\)/)
  assert.match(impl, /autoMintWorkerIsActive\(existing\.pid\)/)
})

test('autoMintBridge does not re-mint a burn that is already complete', async () => {
  const source = await readFile(new URL('../packages/runtime/bin/arcox-agent.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function autoMintBridge()')
  const end = source.indexOf('export async function executeSend', start)
  assert.ok(start >= 0 && end > start)
  const impl = source.slice(start, end)
  assert.match(impl, /\['complete', 'complete_external'\]\.includes\(existing\?\.status\)/)
})

test('recoverStaleAutoMint skips jobs that are already complete or have an active worker', async () => {
  const source = await readFile(new URL('../packages/runtime/bin/arcox-agent.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function recoverStaleAutoMint(')
  const end = source.indexOf('async function syncAutoMintHistory', start)
  assert.ok(start >= 0 && end > start)
  const impl = source.slice(start, end)
  assert.match(impl, /if \(completed\?\.mintTx\) return syncCompletedAutoMintStatus/)
  assert.match(impl, /\['complete', 'complete_external'\]\.includes\(job\?\.status\)/)
  assert.match(impl, /autoMintWorkerIsActive\(job\.pid\)/)
})
