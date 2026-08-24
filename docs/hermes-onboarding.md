# Hermes Onboarding: arcox-mcp

Panduan untuk user baru yang ingin menginstall dan menghubungkan arcox-mcp ke Hermes untuk transaksi MSCA.

## 1. Install arcox-mcp

```bash
npm install -g arcox-mcp
```

Atau jalankan tanpa install global:

```bash
npx arcox-mcp
```

## 2. Konfigurasi Hermes

Edit `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  arcox:
    url: https://arcoxdex.vercel.app/mcp
    auth: oauth
    enabled: true
```

Konfigurasi ini mengarahkan Hermes ke remote MCP production ARCOX dengan OAuth 2.1 + PKCE. Tidak perlu token MSCA, private key, atau API key di env Hermes.

## 3. Login pertama kali (wajib)

Akses MCP arcox **tidak bisa dilakukan tanpa login**. Saat pertama kali mencoba connect, Hermes akan menolak dan meminta login:

```bash
hermes mcp login arcox
```

Hermes akan mencetak authorize URL:

```text
MCP OAuth: authorization required.
Open this URL in your browser:
  https://arcoxdex.vercel.app/api/auth/authorize?...
```

## 4. Selesaikan browser flow

Buka URL itu di browser:

1. Login ke ARCOX dengan wallet.
2. Sign pesan SIWE.
3. Pilih atau aktifkan Agent Wallet (MSCA) di menu Plugin.
4. Selesaikan autentikasi Passkey (fingerprint/Face ID/Windows Hello/security key).
5. Setujui akses MCP untuk Hermes.
6. Browser redirect kembali ke Hermes.

### Same-device (browser di komputer yang sama)

Callback otomatis ke `localhost`. Hermes menerima token langsung.

### Cross-device (Passkey di mobile, Hermes di komputer lain)

Setelah authorize, browser mobile akan mencoba redirect ke `localhost` komputer Hermes dan gagal. Salin URL redirect akhir dari address bar mobile, lalu paste ke terminal Hermes.

## 5. Verifikasi koneksi

```bash
hermes mcp test arcox
```

Hasil yang diharapkan:

```text
Transport: HTTP → https://arcoxdex.vercel.app/mcp
Auth: OAuth 2.1 PKCE
Connection successful
```

## 6. Mulai menggunakan MCP

Di chat Hermes:

```text
Tampilkan status Agent Wallet MSCA ARCOX dan saldo wallet.
```

Untuk transaksi:

```text
Buat quote kirim 0.001 USDC dari Agent Wallet MSCA di Arc Testnet ke 0x...
Jangan eksekusi sebelum saya menyetujui preview.
```

Hermes akan:
1. Call `arcox_quote_send` dengan `source: session`.
2. Tampilkan preview (alamat MSCA, recipient, nominal, token, chain).
3. Tunggu konfirmasi `yes` atau `ya`.
4. Call `arcox_execute_send` dengan `confirmed: true`.
5. Backend execute UserOperation via session key MSCA.
6. Return tx hash dan explorer URL.

## Security

- Tanpa login, **semua** request MCP ditolak (HTTP 401).
- Hermes tidak menerima private key MSCA.
- Hermes tidak menerima token MSCA di env.
- Token OAuth disimpan oleh Hermes secara lokal dengan permission terbatas.
- Setiap transaksi memerlukan preview dan konfirmasi eksplisit `yes`/`ya`.
- Backend memvalidasi OAuth session, MSCA aktif, preview, dan approval sebelum eksekusi.
