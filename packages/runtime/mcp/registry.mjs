export const ARCOX_WEB_URL = process.env.ARCOX_WEB_URL || 'https://arcoxdex.vercel.app/'
// Public API origin. Vercel proxies the API to the private backend; clients must not use the VPS hostname directly.
export const ARCOX_API_URL = process.env.ARCOX_API_URL || 'https://arcoxdex.vercel.app'

export const pages = [
  {
    id: 'swap',
    title: 'Swap',
    purpose: 'Swap retail tokens on Arc Mainnet from Circle Wallet or EOA wallet.',
    userInputs: ['source wallet: Circle Wallet or EOA', 'tokenIn', 'tokenOut', 'amountIn'],
    reads: ['Circle wallet balance', 'EOA balance', 'quote', 'platform fee', 'network fee', 'rate'],
    actions: ['quote_swap', 'execute_circle_swap', 'execute_eoa_swap'],
    signing: {
      circle: 'Circle proxy wallet signs through backend wallet infrastructure.',
      eoa: 'Terminal MCP uses the configured local signer. Web UI uses the user wallet popup.',
    },
    knownCautions: [
      'Circle swap charges platform fee first, then swaps net input.',
      'EOA MCP swap must never fallback to Circle proxy wallet unless source="circle" is explicitly quoted and confirmed.',
      'If quote is missing, do not execute swap.',
    ],
  },
  {
    id: 'bridge',
    title: 'Bridge',
    purpose: 'Bridge USDC/cirBTC across supported mainnet chains using CCTP where available, plus native ETH to Arc on verified Ethereum/Base native routers.',
    userInputs: ['source wallet', 'fromChain', 'toChain', 'token', 'amount'],
    reads: ['estimated receive', 'custom fee', 'CCTP fee', 'forwarding fee', 'router fee', 'steps', 'retry status'],
    actions: ['prepare_circle_to_eoa', 'approve_bridge', 'burn_bridge', 'poll_attestation', 'mint_receive', 'retry_bridge'],
    signing: {
      circle: 'Circle Wallet can first transfer assets to EOA for a single bridge flow.',
      eoa: 'User wallet signs approve, burn, and receive/mint where destination requires it.',
      solana: 'Web UI uses user Solana wallet. Terminal MCP uses the local SOLANA_PRIVATE_KEY signer as Solana recipient.',
    },
    knownCautions: [
      'Pending bridge is normal after burn; user must wait for attestation and mint.',
      'Retry bridge should use burn tx, source chain, and destination chain.',
      'Router fee only applies on deployed EVM router source chains.',
      'Native bridge must use EOA source. Circle Wallet source supports USDC only.',
    ],
  },
  {
    id: 'send',
    title: 'Send',
    purpose: 'Send supported tokens to another address from Circle Wallet or EOA.',
    userInputs: ['source wallet', 'recipient', 'token', 'amount'],
    reads: ['balance', 'estimated gas or backend send result'],
    actions: ['send_circle_wallet', 'send_eoa_wallet'],
    signing: {
      circle: 'Circle proxy wallet signs through backend wallet infrastructure.',
      eoa: 'User wallet signs transfer directly.',
    },
    knownCautions: ['Validate recipient address before sending.', 'EOA send must be wallet-signed.'],
  },
  {
    id: 'agent_jobs',
    title: 'AI Jobs',
    purpose: 'Create, accept, submit, verify, and complete agentic economy jobs.',
    userInputs: ['agent endpoint', 'job title', 'budget', 'provider', 'evaluator', 'deliverable hash'],
    reads: ['registered agents', 'job state', 'escrow state', 'agent response'],
    actions: ['register_agent', 'create_job', 'accept_job', 'submit_work', 'verify_work', 'complete_job'],
    signing: {
      user: 'Job and escrow transactions are signed by the connected user wallet.',
      agent: 'Terminal agent can prepare actions, but should not sign user-owned transactions unless configured by the user locally.',
    },
    knownCautions: [
      'Registering the same agent repeatedly should be idempotent or clearly rejected.',
      'Evaluator/verifier must be explicit before completing work.',
    ],
  },
  {
    id: 'docs',
    title: 'Docs',
    purpose: 'Standalone user documentation including retry bridge instructions.',
    userInputs: ['topic selection'],
    reads: ['feature docs', 'retry bridge guide', 'safety notes'],
    actions: ['read_docs'],
    signing: {},
    knownCautions: ['Docs should not be mixed into trading controls.'],
  },
]

export const actions = [
  {
    id: 'quote_swap',
    page: 'swap',
    intentExamples: ['estimate swap 10 USDC to EURC', 'berapa dapat EURC dari 5 USDC'],
    requiredSlots: ['source', 'tokenIn', 'tokenOut', 'amountIn'],
    safeExecution: 'read_only',
    backend: 'POST /api/eoa-swap-quote for EOA, POST /api/quote for Circle',
  },
  {
    id: 'execute_circle_swap',
    page: 'swap',
    intentExamples: ['swap 10 USDC ke EURC dari circle wallet'],
    requiredSlots: ['metamaskAddress', 'tokenIn', 'tokenOut', 'amountIn', 'confirmedQuote'],
    safeExecution: 'requires_user_confirmation',
    backend: 'POST /api/swap',
  },
  {
    id: 'execute_eoa_swap',
    page: 'swap',
    intentExamples: ['swap dari metamask 1 USDC ke EURC'],
    requiredSlots: ['tokenIn', 'tokenOut', 'amountIn', 'confirmedQuote'],
    safeExecution: 'requires_wallet_signature',
    backend: 'POST /api/eoa-swap-prepare then the configured local signer approves and executes',
  },
  {
    id: 'bridge_usdc',
    page: 'bridge',
    intentExamples: ['bridge 1 USDC dari Arc ke Base', 'bridge dari Arbitrum ke Arc'],
    requiredSlots: ['source', 'fromChain', 'toChain', 'token', 'amount'],
    safeExecution: 'requires_wallet_signature',
    backend: 'Web UI CCTP flow or terminal agent bridge adapter',
  },
  {
    id: 'retry_bridge',
    page: 'bridge',
    intentExamples: ['retry bridge pending', 'retry mint burn tx 0x... dari base ke arc'],
    requiredSlots: ['burnTxHash', 'fromChain', 'toChain'],
    safeExecution: 'requires_wallet_signature_on_destination_if_needed',
    backend: 'POST /api/get-attestation then receiveMessage/mint',
  },
  {
    id: 'send_token',
    page: 'send',
    intentExamples: ['send 5 USDC ke 0x...', 'kirim EURC dari EOA'],
    requiredSlots: ['source', 'recipient', 'token', 'amount'],
    safeExecution: 'requires_wallet_signature_or_circle_proxy_confirmation',
    backend: 'POST /api/send for Circle or wallet transfer for EOA',
  },
]

export const chainSupport = {
  Arc: { bridge: true, router: '0x9Fd14A94bDbEFf73EDB22853cc77416B65E2A0c0', circleWallet: true, aliases: ['arc', 'arc mainnet', 'arc_mainnet'] },
  Ethereum: { bridge: true, router: null, nativeSwapBridgeRouter: null, circleWallet: false, aliases: ['ethereum', 'ethereum mainnet', 'eth mainnet', 'mainnet'], note: 'Fee Router ARCOX belum di-deploy di Ethereum mainnet; bridge USDC tetap lewat CCTP langsung.' },
  Base: { bridge: true, router: '0xD858f073FA09834b1d64C165afC2757F1DF2f019', nativeSwapBridgeRouter: null, circleWallet: false, aliases: ['base', 'base mainnet'], note: 'Fee Router ARCOX terverifikasi on-chain (4653 byte). Router swap-native belum di-deploy di mainnet.' },
  Arbitrum: { bridge: true, router: '0xaF15a9fFdDB21A42Aa6175B8130aE69ce41C78F9', nativeSwapBridgeRouter: null, circleWallet: false, aliases: ['arbitrum', 'arbitrum mainnet', 'arb mainnet'], note: 'Fee Router ARCOX terverifikasi on-chain (4653 byte). Router swap-native belum di-deploy di mainnet.' },
  HyperEVM: { bridge: true, router: null, circleWallet: false, aliases: ['hyperevm', 'hyper evm', 'hypevm', 'hype', 'hyperevm mainnet'] },
  Solana: {
    bridge: true,
    // Program router ArcoxRouter Solana hanya ada di devnet; program mainnet
    // belum di-deploy, jadi rute fee-router Solana gagal-tertutup.
    router: null,
    circleWallet: false,
    aliases: ['solana', 'solana mainnet', 'solana_mainnet', 'sol'],
    note: 'User must use a Solana mainnet wallet. Router program mainnet belum di-deploy; bridge USDC lewat CCTP langsung.',
  },
}

export const retailRules = [
  'Always quote before swap or bridge.',
  'Never execute a value-moving action without user confirmation.',
  'EOA actions must be signed by the user wallet.',
  'Circle Wallet actions use the user proxy wallet stored in backend wallets-db.json.',
  'For bridge pending, explain burn is complete and mint can be retried with burn tx.',
  'Agent may prepare plans and CLI commands, but user-owned funds require explicit signing policy.',
]
