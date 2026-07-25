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
const erc20Abi = [
  {type:'function',name:'approve',stateMutability:'nonpayable',inputs:[{name:'spender',type:'address'},{name:'amount',type:'uint256'}],outputs:[{name:'',type:'bool'}]},
  {type:'function',name:'allowance',stateMutability:'view',inputs:[{name:'owner',type:'address'},{name:'spender',type:'address'}],outputs:[{name:'',type:'uint256'}]},
];

const USDC = '0x3600000000000000000000000000000000000000';
const EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';
const CIRBTC = '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF';
const POOL1 = '0xd4af8e12903a4c6bd60bbc353fb97ffc9cc2dc2d'; // USDC-cirBTC
const POOL2 = '0xcca97842509efae4a2ed4c95595fc559a1a6bfa2'; // EURC-cirBTC

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sendAndPoll(to, data, label, gas = 200000n) {
  console.log(`  Sending ${label}...`);
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
    } catch(e) {
      if (i % 10 === 9) console.log(`  polling...`);
    }
  }
  console.log('  receipt pending');
  return null;
}

async function approveAndAddLiquidity(token, pool, amount, label) {
  // Approve
  console.log(`\n=== ${label} ===`);
  const approveData = encodeFunctionData({abi: erc20Abi, functionName: 'approve', args: [pool, amount]});
  await sendAndPoll(token, approveData, `approve ${label}`);
  await sleep(3000);
  // Add liquidity
  const addData = encodeFunctionData({abi: poolAbi, functionName: 'addLiquidity', args: [amount, amount]});
  // Wait — USDC has 6 decimals, cirBTC has 8. Need different amounts.
  // For USDC-cirBTC pool: token0=USDC(6), token1=cirBTC(8)
  // For EURC-cirBTC pool: token0=EURC(6), token1=cirBTC(8)
  // We need to provide amounts in correct base units for each token
  // But addLiquidity takes (amount0, amount1) where amount0 is token0, amount1 is token1
  // This function needs to handle different decimals per pool
}

// For USDC-cirBTC pool: token0=USDC(decimals=6), token1=cirBTC(decimals=8)
// Amount: 10 USDC = 10_000000, 0.00015 cirBTC = 15000 (8 decimals)
// We want ~$10 worth of each
const usdcAmount = parseUnits('10', 6); // 10 USDC
const cirbtcForUsdc = parseUnits('0.00015', 8); // 0.00015 cirBTC (~$10)

// For EURC-cirBTC pool: token0=EURC(decimals=6), token1=cirBTC(decimals=8)
const eurcAmount = parseUnits('10', 6); // 10 EURC
const cirbtcForEurc = parseUnits('0.00015', 8); // 0.00015 cirBTC

// === Pool 1: USDC-cirBTC ===
console.log('=== Pool 1: USDC-cirBTC ===');
// Approve USDC
const ap1 = encodeFunctionData({abi: erc20Abi, functionName: 'approve', args: [POOL1, usdcAmount]});
await sendAndPoll(USDC, ap1, 'approve USDC to pool1');
await sleep(3000);
// Approve cirBTC
const ap1b = encodeFunctionData({abi: erc20Abi, functionName: 'approve', args: [POOL1, cirbtcForUsdc]});
await sendAndPoll(CIRBTC, ap1b, 'approve cirBTC to pool1');
await sleep(3000);
// Add liquidity: token0=USDC, token1=cirBTC
const add1 = encodeFunctionData({abi: poolAbi, functionName: 'addLiquidity', args: [usdcAmount, cirbtcForUsdc]});
await sendAndPoll(POOL1, add1, 'addLiquidity USDC-cirBTC', 300000n);
await sleep(3000);

// === Pool 2: EURC-cirBTC ===
console.log('\n=== Pool 2: EURC-cirBTC ===');
// Approve EURC
const ap2 = encodeFunctionData({abi: erc20Abi, functionName: 'approve', args: [POOL2, eurcAmount]});
await sendAndPoll(EURC, ap2, 'approve EURC to pool2');
await sleep(3000);
// Approve cirBTC
const ap2b = encodeFunctionData({abi: erc20Abi, functionName: 'approve', args: [POOL2, cirbtcForEurc]});
await sendAndPoll(CIRBTC, ap2b, 'approve cirBTC to pool2');
await sleep(3000);
// Add liquidity: token0=EURC, token1=cirBTC
const add2 = encodeFunctionData({abi: poolAbi, functionName: 'addLiquidity', args: [eurcAmount, cirbtcForEurc]});
await sendAndPoll(POOL2, add2, 'addLiquidity EURC-cirBTC', 300000n);

// Verify reserves
await sleep(5000);
console.log('\n=== Verify reserves ===');
try {
  const [r0_1, r1_1] = await publicClient.readContract({address: POOL1, abi: poolAbi, functionName: 'getReserves'});
  console.log(`Pool 1 (USDC-cirBTC): reserve0=${r0_1}, reserve1=${r1_1}`);
} catch(e) { console.log('Pool 1 reserve check failed'); }
try {
  const [r0_2, r1_2] = await publicClient.readContract({address: POOL2, abi: poolAbi, functionName: 'getReserves'});
  console.log(`Pool 2 (EURC-cirBTC): reserve0=${r0_2}, reserve1=${r1_2}`);
} catch(e) { console.log('Pool 2 reserve check failed'); }

console.log('\n=== DONE ===');
