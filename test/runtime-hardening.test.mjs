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
