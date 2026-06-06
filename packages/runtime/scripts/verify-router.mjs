#!/usr/bin/env node
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { encodeAbiParameters } from 'viem'
import solc from 'solc'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = dirname(__dirname)
const source = readFileSync(join(root, 'contracts', 'ArcoxRouter.sol'), 'utf8')
const deploymentPath = join(root, 'deployments', 'arcox-router.testnet.json')
const deploymentFile = JSON.parse(readFileSync(deploymentPath, 'utf8'))

const compilerVersion = solc.version().replace(/\.Emscripten\.clang$/, '')
const contractIdentifier = 'ArcoxRouter.sol:ArcoxRouter'
const stdJsonInput = {
  language: 'Solidity',
  sources: { 'ArcoxRouter.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'],
      },
    },
  },
}

const explorerApis = {
  Arc_Testnet: 'https://testnet.arcscan.app/api',
  Base_Sepolia: 'https://base-sepolia.blockscout.com/api',
  Arbitrum_Sepolia: 'https://arbitrum-sepolia.blockscout.com/api',
  Ethereum_Sepolia: 'https://eth-sepolia.blockscout.com/api',
}

const constructorTypes = [
  { type: 'address' },
  { type: 'address' },
  { type: 'address' },
  { type: 'address' },
  { type: 'uint32' },
  { type: 'uint16' },
]

for (const [name, dep] of Object.entries(deploymentFile.deployments || {})) {
  if (typeof dep.chainId !== 'number') {
    console.log(JSON.stringify({ name, status: 'skipped', reason: 'non-evm deployment' }))
    continue
  }
  const sourcify = await verifySourcify(name, dep)
  const explorer = explorerApis[name] ? await verifyExplorer(name, dep, explorerApis[name]) : null
  console.log(JSON.stringify({ name, chainId: dep.chainId, address: dep.address, sourcify, explorer }))
}

async function verifySourcify(name, dep) {
  const body = {
    stdJsonInput,
    compilerVersion,
    contractIdentifier,
    creationTransactionHash: dep.deployTx,
  }
  const res = await fetch(`https://sourcify.dev/server/v2/verify/${dep.chainId}/${dep.address}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const submitted = await parseResponse(res)
  const verificationId = submitted.verificationId
  if (!verificationId) return { submitted }
  await sleep(2500)
  const statusRes = await fetch(`https://sourcify.dev/server/v2/verify/${verificationId}`)
  const status = await parseResponse(statusRes)
  return {
    verificationId,
    match: status.contract?.match || null,
    creationMatch: status.contract?.creationMatch || null,
    runtimeMatch: status.contract?.runtimeMatch || null,
    error: status.error?.message || null,
  }
}

async function verifyExplorer(name, dep, api) {
  const constructorArguments = encodeAbiParameters(constructorTypes, [
    deploymentFile.deployer,
    deploymentFile.treasury,
    dep.usdc,
    dep.tokenMessenger,
    dep.domain,
    deploymentFile.feeBps,
  ]).slice(2)
  const params = new URLSearchParams({
    module: 'contract',
    action: 'verifysourcecode',
    contractaddress: dep.address,
    sourceCode: JSON.stringify(stdJsonInput),
    codeformat: 'solidity-standard-json-input',
    contractname: contractIdentifier,
    compilerversion: `v${compilerVersion}`,
    optimizationUsed: '1',
    runs: '200',
    constructorArguements: constructorArguments,
    licenseType: '3',
  })
  const res = await fetch(api, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  const submitted = await parseResponse(res)
  const abiRes = await fetch(`${api}?module=contract&action=getabi&chainid=${dep.chainId}&address=${dep.address}`)
  const abi = await parseResponse(abiRes)
  return {
    message: submitted.message || null,
    result: submitted.result || null,
    abiPublished: abi.status === '1' && String(abi.result || '').startsWith('['),
  }
}

async function parseResponse(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { statusCode: res.status, text }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
