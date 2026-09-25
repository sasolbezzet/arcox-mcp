# Deployments — ARCOX Fee Router mainnet

## Yang aktif (dipakai)

| Chain | Alamat | Domain tujuan | Deploy tx | Sumber |
| --- | --- | --- | --- | --- |
| Arc Mainnet (5042) | `0x9Fd14A94bDbEFf73EDB22853cc77416B65E2A0c0` | 6 (Base) | `0x97f717a87509793afccf37cbee3a5c106e56d783432cc56ecea1a3a1ed0a5b11` | Sourcify `exact_match` |
| Base Mainnet (8453) | `0xD858f073FA09834b1d64C165afC2757F1DF2f019` | 26 (Arc) | `0x0411ca0cfe45087e244df94621d5f663590f97fb110d8466f7c4e97e403af523` | Sourcify `exact_match` |
| Arbitrum One (42161) | belum di-deploy | — | — | — |

Parameter: `owner` = `0xE34FF1D2C925DDafB28C95C2396fC49A6f64569e`,
`treasury` = `0x5d16E8Ef186d6D0d984f9A50C7ddb16C106DF40F`, `feeBps` = **500** (5%),
`usdc` + `tokenMessenger` = alamat mainnet masing-masing chain (CCTP v2
`0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`), `localDomain` = 26 / 6.

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
