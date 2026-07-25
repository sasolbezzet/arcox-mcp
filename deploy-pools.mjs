
import {readFileSync} from 'fs';
import {createWalletClient, createPublicClient, http, parseUnits, formatUnits} from 'viem';
import {arcTestnet} from 'viem/chains';
import {privateKeyToAccount} from 'viem/accounts';

const env = Object.fromEntries(
  readFileSync('/home/ubuntu/.arcox/agent.env','utf8').trim().split('\n')
    .map(l=>l.split('=').map(s=>s.trim())).filter(([k])=>k&&!k.startsWith('#'))
);

const account = privateKeyToAccount(process.env.EOA_PRIVATE_KEY || env.EOA_PRIVATE_KEY || env.AGENT_PRIVATE_KEY);
const rpcHeaders = env.DRPC_KEY ? {Authorization: 'Bearer '+env.DRPC_KEY} : {};
const transport = http(env.ARC_RPC, {headers: rpcHeaders});
const publicClient = createPublicClient({chain: arcTestnet, transport});
const walletClient = createWalletClient({account, chain: arcTestnet, transport});

const bytecode = readFileSync('/tmp/pool-out/_tmp_ArcoxBTCPool_sol_ArcoxBTCPool.bin', 'utf8').trim();
const abi = JSON.parse(readFileSync('/tmp/pool-out/_tmp_ArcoxBTCPool_sol_ArcoxBTCPool.abi', 'utf8'));

const USDC = '0x3600000000000000000000000000000000000000';
const EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';
const CIRBTC = '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF';

async function deployPool(token0, token1, label) {
  console.log(`Deploying ${label}...`);
  const hash = await walletClient.deployContract({
    abi,
    bytecode: '0x'+bytecode,
    args: [token0, token1],
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({hash, timeout: 60000});
  const address = receipt.contractAddress;
  console.log(`${label} deployed at ${address}`);
  console.log(`  tx: ${hash}`);
  return address;
}

// Pool 1: USDC (token0) → cirBTC (token1)
// USDC decimals=6, cirBTC decimals=8
const pool1 = await deployPool(USDC, CIRBTC, 'Pool USDC-cirBTC');

// Wait for nonce to update
await new Promise(r => setTimeout(r, 2000));

// Pool 2: EURC (token0) → cirBTC (token1)
const pool2 = await deployPool(EURC, CIRBTC, 'Pool EURC-cirBTC');

console.log('\n=== SUMMARY ===');
console.log(`USDC-cirBTC pool: ${pool1}`);
console.log(`EURC-cirBTC pool: ${pool2}`);

// Save addresses
import {writeFileSync} from 'fs';
writeFileSync('/tmp/pool-addresses.json', JSON.stringify({pool1, pool2}, null, 2));
console.log('Addresses saved to /tmp/pool-addresses.json');
