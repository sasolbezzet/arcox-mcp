import {readFileSync, writeFileSync} from 'fs';
import {createWalletClient, createPublicClient, http, parseUnits, formatUnits} from 'viem';
import {arcTestnet} from 'viem/chains';
import {privateKeyToAccount} from 'viem/accounts';
import {keccak256, encodeAbiParameters, encodeFunctionData} from 'viem/utils';

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

// Pool 1 already deployed
const POOL1 = '0xd4af8e12903a4c6bd60bbc353fb97ffc9cc2dc2d';
console.log('Pool 1 (USDC-cirBTC):', POOL1);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function deployContract(bytecode, abi, args, label) {
  console.log(`\nDeploying ${label}...`);
  const hash = await walletClient.deployContract({abi, bytecode, args, account});
  console.log(`  tx: ${hash}`);
  // Poll for receipt manually to avoid rate limit issues
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    try {
      const receipt = await publicClient.getTransactionReceipt({hash});
      if (receipt) {
        console.log(`  status: ${receipt.status === 'success' ? 'SUCCESS' : 'FAILED'}`);
        console.log(`  address: ${receipt.contractAddress}`);
        return receipt.contractAddress;
      }
    } catch(e) {
      if (i === 29) throw e;
      continue;
    }
  }
  throw new Error(`Receipt timeout for ${label}`);
}

async function sendTx(to, data, gasLimit = 200000n) {
  const nonce = await publicClient.getTransactionCount({address: account.address});
  const gasPrice = (await publicClient.getGasPrice()) * 2n;
  const hash = await walletClient.sendTransaction({to, data, account, gas: gasLimit, gasPrice});
  return hash;
}

// === Deploy Pool 2: EURC-cirBTC ===
const POOL2 = await deployContract(poolBytecode, poolAbi, [EURC, CIRBTC], 'Pool 2: EURC-cirBTC');

await sleep(2000);

// === Deploy Router ===
const ROUTER = await deployContract(routerBytecode, routerAbi, [account.address], 'ArcoxCirBTCRouter');

await sleep(2000);

// === Register pools ===
console.log('\n=== Registering pools ===');

// Register USDC-cirBTC → POOL1
const registerData1 = encodeFunctionData({
  abi: routerAbi,
  functionName: 'registerPool',
  args: [USDC, CIRBTC, POOL1],
});
const tx1 = await sendTx(ROUTER, registerData1, 200000n);
console.log(`Register USDC-cirBTC: ${tx1}`);
await sleep(5000);
try {
  const r1 = await publicClient.getTransactionReceipt({hash: tx1});
  console.log(`  status: ${r1.status === 'success' ? 'SUCCESS' : 'FAILED'}`);
} catch(e) { console.log('  receipt pending'); }

// Register EURC-cirBTC → POOL2
const registerData2 = encodeFunctionData({
  abi: routerAbi,
  functionName: 'registerPool',
  args: [EURC, CIRBTC, POOL2],
});
const tx2 = await sendTx(ROUTER, registerData2, 200000n);
console.log(`Register EURC-cirBTC: ${tx2}`);
await sleep(5000);
try {
  const r2 = await publicClient.getTransactionReceipt({hash: tx2});
  console.log(`  status: ${r2.status === 'success' ? 'SUCCESS' : 'FAILED'}`);
} catch(e) { console.log('  receipt pending'); }

// === SUMMARY ===
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
console.log('\nSaved to /tmp/pool-addresses.json');
