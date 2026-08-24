import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWalletSource, WALLET_SOURCES, walletSourceDescription } from '../packages/runtime/mcp/walletModes.mjs'

test('wallet source normalization preserves EOA, SCA, and MSCA modes', () => {
  assert.deepEqual(WALLET_SOURCES, ['eoa', 'sca', 'msca'])
  assert.equal(normalizeWalletSource('eoa'), 'eoa')
  assert.equal(normalizeWalletSource('local'), 'eoa')
  assert.equal(normalizeWalletSource('sca'), 'sca')
  assert.equal(normalizeWalletSource('circle'), 'sca')
  assert.equal(normalizeWalletSource('proxy'), 'sca')
  assert.equal(normalizeWalletSource('msca'), 'msca')
  assert.equal(normalizeWalletSource('session-key'), 'msca')
})

test('unknown wallet source fails safe to the configured fallback', () => {
  assert.equal(normalizeWalletSource('unknown', 'eoa'), 'eoa')
  assert.equal(normalizeWalletSource('unknown', 'msca'), 'msca')
})

test('wallet descriptions do not expose private keys', () => {
  for (const source of WALLET_SOURCES) {
    const description = walletSourceDescription(source)
    assert.match(description, /wallet|signer|session/i)
    assert.doesNotMatch(description, /0x[0-9a-f]{64}/i)
  }
})
