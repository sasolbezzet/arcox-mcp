#!/usr/bin/env node
/**
 * Cek saldo kandidat key deployer di 3 chain mainnet (Arc, Base, Arbitrum).
 * Read-only: tidak menandatangani apa pun.
 *
 * Pakai:
 *   node packages/runtime/scripts/check-mainnet-balances.mjs \
 *     --key-file /home/ubuntu/arc-dex-api/.env:AI_ROUTER_DELEGATE_PRIVATE_KEY \
 *     --key-file /home/ubuntu/arcox-fleet/.env:AGENT_PRIVATE_KEY
 *
 * Atau langsung lewat env: DEPLOYER_PRIVATE_KEY=0x...
 */
import { readFileSync } from 'node:fs'
import { createPublicClient, http, formatEther, formatUnits, getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const CHAINS = [
  { key: 'arc', name: 'Arc Mainnet', id: 5042, rpc: 'https://rpc.mainnet.arc.io', explorer: 'https://explorer.arc.io', native: 'USDC', nativeDecimals: 18 },
  { key: 'base', name: 'Base Mainnet', id: 8453, rpc: 'https://mainnet.base.org', explorer: 'https://basescan.org', native: 'ETH' },
  { key: 'arbitrum', name: 'Arbitrum One', id: 42161, rpc: 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io', native: 'ETH' },
]

const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
]

const USDC = {
  arc: '0x3600000000000000000000000000000000000000',
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
}

function parseArgs(argv) {
  const out = { keyFiles: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--key-file') out.keyFiles.push(argv[++i])
  }
  return out
}

function readKeyFromFile(spec) {
  const [file, varName] = spec.split(':')
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${varName}=`))
  if (!line) throw new Error(`variabel ${varName} tidak ada di ${file}`)
  const value = line.slice(varName.length + 1).trim().replace(/^["']|["']$/g, '')
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`nilai ${varName} bukan private key 32-byte`)
  return { label: `${varName} (${file.replace('/home/ubuntu/', '')})`, key: value }
}

const args = parseArgs(process.argv.slice(2))
const candidates = args.keyFiles.map(readKeyFromFile)
if (process.env.DEPLOYER_PRIVATE_KEY) {
  candidates.push({ label: 'DEPLOYER_PRIVATE_KEY (env)', key: process.env.DEPLOYER_PRIVATE_KEY })
}
if (candidates.length === 0) {
  console.error('Tidak ada kandidat key. Pakai --key-file <path>:<VAR> atau DEPLOYER_PRIVATE_KEY.')
  process.exit(2)
}

for (const cand of candidates) {
  const account = privateKeyToAccount(cand.key)
  console.log(`\n=== ${cand.label} ===`)
  console.log(`alamat: ${account.address}`)
  for (const chain of CHAINS) {
    const client = createPublicClient({ transport: http(chain.rpc, { timeout: 15000, retryCount: 1 }) })
    try {
      const [native, usdc, code] = await Promise.all([
        client.getBalance({ address: account.address }),
        client.readContract({ address: getAddress(USDC[chain.key]), abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
        client.getBytecode({ address: account.address }),
      ])
      const nativeStr = chain.key === 'arc'
        ? `${formatUnits(native, chain.nativeDecimals ?? 18)} USDC (native gas)`
        : `${formatEther(native)} ETH`
      console.log(`  ${chain.name.padEnd(14)} chainId=${chain.id} native=${nativeStr} usdc=${formatUnits(usdc, 6)}${code ? ' [kontrak!]' : ''}`)
    } catch (err) {
      console.log(`  ${chain.name.padEnd(14)} chainId=${chain.id} GAGAL: ${err.shortMessage || err.message}`)
    }
  }
}
