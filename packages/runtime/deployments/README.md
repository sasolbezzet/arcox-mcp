# Deployments — ARCOX Fee Router mainnet

## Yang aktif (dipakai)

| Chain | Alamat | Domain tujuan | Deploy tx | Sumber |
| --- | --- | --- | --- | --- |
| Arc Mainnet (5042) | `0x9Fd14A94bDbEFf73EDB22853cc77416B65E2A0c0` | 6 (Base) | `0x97f717a87509793afccf37cbee3a5c106e56d783432cc56ecea1a3a1ed0a5b11` | Sourcify `exact_match` |
| Base Mainnet (8453) | `0xD858f073FA09834b1d64C165afC2757F1DF2f019` | 26 (Arc) | `0x0411ca0cfe45087e244df94621d5f663590f97fb110d8466f7c4e97e403af523` | Sourcify `exact_match` |
| Arbitrum One (42161) | `0xaF15a9fFdDB21A42Aa6175B8130aE69ce41C78F9` | 26 (Arc), 6 (Base) | `0x9ae11d17b754d6d47c7553757eb461a6630be06f43812baf71b456eb93d7f5cd` | Sourcify `exact_match` |

Jaring destination domain lengkap: Arc → {6, 3}, Base → {26, 3}, Arbitrum → {26, 6}.

Parameter: `owner` = `0xE34FF1D2C925DDafB28C95C2396fC49A6f64569e`,
`treasury` = `0x5d16E8Ef186d6D0d984f9A50C7ddb16C106DF40F` (**di ketiga chain**,
diverifikasi on-chain oleh `mainnet:fee-router:verify`), `feeBps` = **500** (5%),
`usdc` + `tokenMessenger` = alamat mainnet masing-masing chain (CCTP v2
`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`), `localDomain` = 26 / 6 / 3.

`fee-router-mainnet.json` adalah catatan otomatis dari skrip deploy + verifikasi.

## ⚠️ Alamat yang DITOLAK — jangan dipakai

| Chain | Alamat | Masalah |
| --- | --- | --- |
| Arc Mainnet | `0xb9Fb801A5D1491E70A886800982CB80cdf98A174` | immutables testnet |
| Base Mainnet | `0xc31F668B17A8A923d661F2fc16A89Cd0BD14a39b` | immutables testnet (USDC-nya USDC Arc) |

Penyebab: `creation_bytecode` dari Blockscout/ArcScan **sudah menyertakan
constructor args deploy testnet di ekornya**. Saat file itu dipakai apa adanya lalu
argumen baru ditempel dengan `encodeDeployData`, EVM membaca 192 byte pertama
setelah creation code — yaitu argumen testnet yang tertanam. Hasilnya kontrak
memakai `feeBps` 30, treasury testnet, dan TokenMessenger testnet; di Base bahkan
`usdc` menunjuk token Arc.

Dampak praktis kalau dipakai: `bridgeUsdcWithFee` memanggil TokenMessenger yang
tidak ada di chain itu, dan fee masuk ke treasury testnet.

Pencegahan yang sekarang berlaku:

1. `scripts/fetch-verified-sources.mjs` melepas ekor `constructor_args` dari
   `creation_bytecode` dan menyimpannya terpisah di `constructor-args.txt`.
2. `scripts/deploy-fee-router-mainnet.mjs` **tidak** memakai file itu sebagai
   bytecode — ia mengompilasi ulang sumber dengan solc lokal (0.8.35, optimizer
   200) sebagai sumber kebenaran, dan gagal-keras kalau file di disk tidak sama
   dengan hasil kompilasi.
3. `scripts/verify-fee-router-mainnet.mjs` memeriksa state on-chain terhadap
   parameter yang diharapkan, jadi kesalahan seperti ini tertangkap sebelum
   dianggap selesai.

Audit lengkap percobaan pertama: `fee-router-mainnet.REJECTED-20260925-bad-constructor-args.json`.

## Urutan menjalankan

```bash
cd arcox-mcp/packages/runtime

# 1. ambil/perbarui snapshot sumber terverifikasi (read-only, testnet)
npm run mainnet:sources

# 2. cek dana deployer di 3 chain (read-only)
npm run mainnet:balances -- --key-file ~/.arcox/agent.env:EOA_PRIVATE_KEY

# 3. dry-run rencana deploy
npm run mainnet:fee-router:deploy -- \
  --key-file ~/.arcox/agent.env:EOA_PRIVATE_KEY \
  --treasury 0x5d16E8Ef186d6D0d984f9A50C7ddb16C106DF40F \
  --fee-bps 500 --chains arc,base

# 4. kirim (tambahkan --broadcast)
npm run mainnet:fee-router:deploy -- ... --broadcast

# 5. aktifkan destination domain (idempotent)
npm run mainnet:fee-router:domains -- --key-file ~/.arcox/agent.env:EOA_PRIVATE_KEY --chains arc,base --broadcast

# 6. verifikasi
npm run mainnet:fee-router:verify
npm run mainnet:fee-router:verify-sources
```

## Swap Adapter — belum di-deploy, menunggu dana + keputusan

Rencana ada di `scripts/deploy-swap-adapter-mainnet.mjs` (dry-run default).

Yang perlu diketahui sebelum menjalankan:

- **Kontrak `Adapter` tidak punya treasury maupun fee.** Fungsinya hanya eksekusi
  batch swap dengan tanda tangan EIP-712. Parameter init-nya
  `initialize(address owner_, address signer_, uint256 signerThreshold_)`.
  Treasury 5% ada di Fee Router, bukan di sini — jadi alamat treasury tidak bisa
  dipasang ke kontrak ini.
- Alamat yang dipakai sistem adalah **proxy**; implementation-nya hanya di-deploy
  sekali per chain.
- Konstruktor proxy `(_logic, initialOwner, _data)`: OZ membuat ProxyAdmin baru
  milik `initialOwner`, dan `_data` adalah panggilan `initialize` yang di-delegate.
- Estimasi gas untuk proxy **tidak mungkin** dilakukan sebelum implementation ada
  (delegatecall ke alamat tanpa kode selalu revert), jadi script memakai limit
  tetap 1,2 juta gas kecuali implementation sudah ter-deploy.

Kebutuhan dana (gas impl ≈ 3,94 juta + proxy ≈ 0,95 juta):

| Chain | Perkiraan biaya | Saldo sekarang | Kurang |
| --- | --- | --- | --- |
| Arc | ≈0,098 USDC | 0,0513 USDC | ≈0,047 USDC |
| Base | ≈0,0000293 ETH | 0,0000115 ETH | ≈0,000018 ETH |
| Arbitrum | ≈0,0000978 ETH | 0,0000051 ETH | ≈0,000093 ETH |

```bash
npm run mainnet:swap-adapter:deploy -- \
  --key-file ~/.arcox/agent.env:EOA_PRIVATE_KEY \
  --adapter-owner <alamat> --signer <alamat> --signer-threshold 1 \
  --proxy-admin-owner <alamat> --chains arc,base,arbitrum
# tambahkan --broadcast untuk mengirim
```
