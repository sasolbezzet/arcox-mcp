import {readFileSync, writeFileSync} from 'fs';
import {createWalletClient, createPublicClient, http} from 'viem';
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

const poolBytecode = '0x' + readFileSync('/tmp/pool-out/_tmp_ArcoxBTCPool_sol_ArcoxBTCPool.bin','utf8').trim();
const poolAbi = JSON.parse(readFileSync('/tmp/pool-out/_tmp_ArcoxBTCPool_sol_ArcoxBTCPool.abi','utf8'));
const routerBytecode = '0x' + readFileSync('/tmp/pool-out/_tmp_ArcoxCirBTCRouter_sol_ArcoxCirBTCRouter.bin','utf8').trim();
const routerAbi = JSON.parse(readFileSync('/tmp/pool-out/_tmp_ArcoxCirBTCRouter_sol_ArcoxCirBTCRouter.abi','utf8'));

const USDC = '0x3600000000000000000000000000000000000000';
const EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';
const CIRBTC = '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF';
const POOL1 = '0xd4af8e12903a4c6bd60bbc353fb97ffc9cc2dc2d';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function deployAndPoll(bytecode, abi, args, label) {
  console.log(`Deploying ${label}...`);
  const hash = await walletClient.deployContract({abi, bytecode, args, account});
  console.log(`  tx: ${hash}`);
  for (let i = 0; i < 40; i++) {
    await sleep(2000);
    try {
      const receipt = await publicClient.getTransactionReceipt({hash});
      if (receipt) {
        const ok = receipt.status === 'success';
        console.log(`  status: ${ok ? 'SUCCESS' : 'FAILED'}`);
        console.log(`  address: ${receipt.contractAddress}`);
        if (!ok) throw new Error(`${label} deploy failed`);
        return receipt.contractAddress;
      }
    } catch(e) {
      // rate limit — keep polling
      if (i % 10 === 9) console.log(`  still polling (${i+1}/40)...`);
    }
  }
  throw new Error(`Receipt timeout for ${label}`);
}

async function sendAndPoll(to, data, label, gas = 200000n) {
  console.log(`Sending ${label}...`);
  const hash = await walletClient.sendTransaction({to, data, account, gas, gasPrice: (await publicClient.getGasPrice()) * 2n});
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
      if (i % 10 === 9) console.log(`  still polling (${i+1}/30)...`);
    }
  }
  console.log('  receipt pending');
  return null;
}

// Step 1: Deploy Pool 2 (EURC-cirBTC)
const POOL2 = await deployAndPoll(poolBytecode, poolAbi, [EURC, CIRBTC], 'Pool 2: EURC-cirBTC');
await sleep(3000);

// Step 2: Deploy Router
const ROUTER = await deployAndPoll(routerBytecode, routerAbi, [account.address], 'ArcoxCirBTCRouter');
await sleep(3000);

// Step 3: Register USDC-cirBTC → POOL1
const reg1 = encodeFunctionData({abi: routerAbi, functionName: 'registerPool', args: [USDC, CIRBTC, POOL1]});
await sendAndPoll(ROUTER, reg1, 'Register USDC-cirBTC');
await sleep(3000);

// Step 4: Register EURC-cirBTC → POOL2
const reg2 = encodeFunctionData({abi: routerAbi, functionName: 'registerPool', args: [EURC, CIRBTC, POOL2]});
await sendAndPoll(ROUTER, reg2, 'Register EURC-cirBTC');

// Summary
const result = {
  pool_usdc_cirbtc: POOL1,
  pool_eurc_cirbtc: POOL2,
  router: ROUTER,
  treasury: account.address,
  fee_bps: 30,
};
console.log('\n=== DEPLOYMENT SUMMARY ===');
console.log(JSON.stringify(result, null, 2));
writeFileSync('/tmp/pool-addresses.json', JSON.stringify(result, null, 2));
console.log('Saved to /tmp/pool-addresses.json');
