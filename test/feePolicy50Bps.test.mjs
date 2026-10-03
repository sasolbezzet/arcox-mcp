import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Kebijakan fee platform ARCOX = 50 bps (0,5%), dan Fee Router mainnet kini
// bernilai sama lewat setFeeBps. Guard ini mengunci DEFAULT runtime agent supaya
// tidak diam-diam kembali ke 500 (5%) — nilai yang membuat fee terpampang 10x
// lebih besar di quote agent.
const agentSource = await readFile(new URL('../packages/runtime/bin/arcox-agent.mjs', import.meta.url), 'utf8')

test('PLATFORM_FEE_BPS runtime default 50 bps', () => {
  assert.match(agentSource, /const PLATFORM_FEE_BPS = Number\(process\.env\.ARCOX_ROUTER_FEE_BPS \|\| '50'\)/)
})

test('quote cirBTC memakai feeBps default 50, bukan 500', () => {
  const start = agentSource.indexOf('async function quoteCirBtcAmmSwap')
  const end = agentSource.indexOf('async function executeCirBtcAmmSwap', start)
  assert.ok(start >= 0 && end > start, 'quoteCirBtcAmmSwap harus ada di arcox-agent.mjs')
  const quote = agentSource.slice(start, end)
  assert.match(quote, /process\.env\.ARCOX_ROUTER_FEE_BPS \|\| '50'/)
  assert.doesNotMatch(quote, /ARCOX_ROUTER_FEE_BPS \|\| '500'/)
})

test('deploy Fee Router default feeBps 50 mengikuti kebijakan platform', async () => {
  const deploySource = await readFile(new URL('../packages/runtime/scripts/deploy-fee-router-mainnet.mjs', import.meta.url), 'utf8')
  assert.match(deploySource, /feeBps: 50,/)
  assert.doesNotMatch(deploySource, /feeBps: 500,/)
})
