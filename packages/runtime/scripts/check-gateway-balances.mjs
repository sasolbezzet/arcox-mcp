#!/usr/bin/env node
/**
 * Cek saldo Gateway (unified balance) untuk daftar alamat, di 3 chain mainnet.
 * Read-only.
 *
 * Pakai: node packages/runtime/scripts/check-gateway-balances.mjs 0xabc... 0xdef...
 */
import { createPublicClient, http, formatUnits, getAddress } from 'viem'

const GATEWAY_WALLET_MAINNET = '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE'

const CHAINS = [
  { key: 'arc', name: 'Arc Mainnet', rpc: 'https://rpc.mainnet.arc.io', usdc: '0x3600000000000000000000000000000000000000', decimals: 6 },
  { key: 'base', name: 'Base Mainnet', rpc: 'https://mainnet.base.org', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  { key: 'arbitrum', name: 'Arbitrum One', rpc: 'https://arb1.arbitrum.io/rpc', usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
]

const GATEWAY_ABI = [
  { type: 'function', name: 'availableBalance', stateMutability: 'view', inputs: [{ name: 'token', type: 'address' }, { name: 'depositor', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalBalance', stateMutability: 'view', inputs: [{ name: 'token', type: 'address' }, { name: 'depositor', type: 'address' }], outputs: [{ type: 'uint256' }] },
]

const ERC20 = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
]

const addrs = process.argv.slice(2)
if (addrs.length === 0) {
  console.error('Pakai: node check-gateway-balances.mjs <alamat> [alamat...]')
  process.exit(2)
}

for (const raw of addrs) {
  const addr = getAddress(raw)
  console.log(`\n=== ${addr} ===`)
  for (const chain of CHAINS) {
    const client = createPublicClient({ transport: http(chain.rpc, { timeout: 15000, retryCount: 1 }) })
    const parts = []
    for (const [label, fn] of [['available', 'availableBalance'], ['total', 'totalBalance']]) {
      try {
        const v = await client.readContract({ address: GATEWAY_WALLET_MAINNET, abi: GATEWAY_ABI, functionName: fn, args: [getAddress(chain.usdc), addr] })
        parts.push(`gw_${label}=${formatUnits(v, chain.decimals)}`)
      } catch (err) {
        parts.push(`gw_${label}=ERR(${(err.shortMessage || err.message).slice(0, 40)})`)
      }
    }
    try {
      const v = await client.readContract({ address: getAddress(chain.usdc), abi: ERC20, functionName: 'balanceOf', args: [addr] })
      parts.push(`usdc_erc20=${formatUnits(v, chain.decimals)}`)
    } catch (err) {
      parts.push(`usdc_erc20=ERR`)
    }
    console.log(`  ${chain.name.padEnd(14)} ${parts.join('  ')}`)
  }
}
