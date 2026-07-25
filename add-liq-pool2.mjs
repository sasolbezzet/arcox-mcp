import {readFileSync, writeFileSync} from 'fs';
import {createWalletClient, createPublicClient, http, parseUnits} from 'viem';
import {arcTestnet} from 'viem/chains';
import {privateKeyToAccount} from 'viem/accounts';
import {encodeFunctionData} from 'viem/utils';

const env = Object.fromEntries(
  readFileSync('/home/ubuntu/.arcox/agent.env','utf8').trim().split('\n')
    .map(l=>l.split('=').map(s=>s.trim())).filter(([k])=>k&&!k.startsWith('#'))
);
const account = privateKeyToAccount(env.EOA_PRIVATE_KEY || env.AGENT_PRIVATE_KEY);
const rpcHeaders = env.DRPC_KEY ? {Authorization: 'Bearer '+env.DRPC_KEY} : {};
const transport = http(env.ARC_RPC, {headers: rpcHeaders, retryCount: 3});
const publicClient = createPublicClient({chain: arcTestnet, transport});
const walletClient = createWalletClient({account, chain: arcTestnet, transport});

const poolAbi = JSON.parse(readFileSync('/tmp/pool-out/_tmp_ArcoxBTCPool_sol_ArcoxBTCPool.abi','utf8'));
const erc20Abi = [{type:'function',name:'approve',stateMutability:'nonpayable',inputs:[{name:'spender',type:'address'},{name:'amount',type:'uint256'}],outputs:[{name:'',type:'bool'}]}];

const EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';
const CIRBTC = '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF';
const POOL2 = '0xcca97842509efae4a2ed4c95595fc559a1a6bfa2';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sendAndPoll(to, data, label, gas = 200000n) {
  console.log(`  ${label}...`);
  const gasPrice = (await publicClient.getGasPrice()) * 2n;
  const hash = await walletClient.sendTransaction({to, data, account, gas, gasPrice});
  console.log(`  tx: ${hash}`);
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    try {
      const receipt = await publicClient.getTransactionReceipt({hash});
      if (receipt) {
        console.log(`  status: ${receipt.status === 'success' ? 'SUCCESS' : 'FAILED'}`);
        return receipt;
      }
    } catch(e) { if (i % 10 === 9) console.log('  polling...'); }
  }
  return null;
}

// cirBTC balance = 4758 (0.00004758). Use 4000 (0.00004) for pool 2
// EURC: use 5 EURC (5_000000)
const eurcAmount = parseUnits('5', 6);
const cirbtcAmount = 4000n; // 0.00004 cirBTC in base units (8 decimals)

console.log('=== Add liquidity Pool 2: EURC-cirBTC ===');
// Approve EURC
const ap1 = encodeFunctionData({abi: erc20Abi, functionName: 'approve', args: [POOL2, eurcAmount]});
await sendAndPoll(EURC, ap1, 'approve EURC');
await sleep(3000);
// Approve cirBTC
const ap2 = encodeFunctionData({abi: erc20Abi, functionName: 'approve', args: [POOL2, cirbtcAmount]});
await sendAndPoll(CIRBTC, ap2, 'approve cirBTC');
await sleep(3000);
// Add liquidity: token0=EURC, token1=cirBTC
const addData = encodeFunctionData({abi: poolAbi, functionName: 'addLiquidity', args: [eurcAmount, cirbtcAmount]});
await sendAndPoll(POOL2, addData, 'addLiquidity EURC-cirBTC', 300000n);
await sleep(5000);

// Verify
try {
  const [r0, r1] = await publicClient.readContract({address: POOL2, abi: poolAbi, functionName: 'getReserves'});
  console.log(`Pool 2 reserves: EURC=${r0}, cirBTC=${r1}`);
} catch(e) { console.log('Reserve check failed'); }
console.log('Done!');
