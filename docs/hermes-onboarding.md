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
    oauth:
      # device_flow memilih metode pairing untuk `hermes mcp login arcox`:
      #   auto   (default) - device code page di perangkat mana pun
      #   local  - same-device loopback (Hermes + browser di komputer yang sama)
      #   device - paksa device code flow
      device_flow: auto
      redirect_host: localhost
    enabled: true
```

Konfigurasi ini mengarahkan Hermes ke remote MCP production ARCOX dengan OAuth 2.1 + PKCE. Tidak perlu token MSCA, private key, atau API key di env Hermes.

## 3. Login pertama kali (wajib)

Akses MCP arcox **tidak bisa dilakukan tanpa login**. Saat pertama kali mencoba connect, Hermes akan menolak dan meminta login:

```bash
hermes mcp login arcox
```

Hermes menampilkan **menu pilihan metode koneksi**:

```text
  Pilih metode koneksi untuk 'arcox':

    1) Device code  — approve di URL dari perangkat mana pun (mobile/laptop), tanpa paste/tunnel
    2) Same-device   — Hermes + browser di komputer yang sama (loopback localhost)

  Pilihan [1]:
```

Pilih **1** atau **2** lalu Enter. Pilihan ini berlaku untuk sesi login itu saja; `oauth.device_flow` di config tetap menjadi default.

### Metode 1 — Device code (default, untuk perangkat apa pun)

Server ARCOX mengiklankan RFC 8628 `device_authorization_endpoint`, jadi Hermes memakai device flow:

```text
MCP OAuth (device flow) for 'arcox'.
Open this URL on any device, sign in, and approve the code:

  https://arcoxdex.vercel.app/arc-dex/plugin?auth=device&user_code=ARCX-XXX-XXX

Device code: ARCX-XXX-XXX
Waiting for approval...
```

1. Buka URL tersebut di browser mana pun (mobile/laptop).
2. Kode sudah terisi otomatis lewat link; jika tidak, ketik kode dari terminal.
3. Login wallet + Passkey, lalu tekan **Setujui dengan Passkey**.
4. Terminal otomatis lanjut: `Login successful.` — tanpa paste URL, tanpa tunnel, tanpa domain.

### Metode 2 — Same-device loopback (Hermes + browser di 1 komputer)

Pilih **2** di menu (atau set `device_flow: local` di config). Hermes memakai callback `localhost`:

1. Hermes membuka authorize URL di browser komputer yang sama.
2. Login ARCOX dengan wallet + Passkey.
3. Browser redirect ke `localhost` dan Hermes menerima token otomatis.

Metode ini cocok saat Hermes dan browser berada di komputer yang sama.

## 3A. Hermes versi lama / mode header: Token Koneksi (disarankan untuk Hermes default)

Jika Hermes Anda belum memiliki `hermes mcp login`, buka plugin ARCOX dengan wallet owner, pilih Agent Wallet yang ingin dipakai, lalu tekan **Buat Token Koneksi**. Salin satu pesan yang dibuat plugin dan tempel ke chat Hermes Anda sendiri.

Agent harus:

1. Memastikan token berformat `arx_at_...` dan URL menunjuk ke `/mcp`.
2. Menambahkan server menggunakan CLI resmi Hermes (bukan menaruh token di `~/.arcox/agent.env`):

```bash
hermes mcp add arcox --url https://arcoxdex.vercel.app/mcp --auth header
```

Saat diminta, tempel token koneksi. Hermes menyimpannya di profile Hermes dengan permission terbatas.
3. Menjalankan `hermes mcp test arcox` dan memastikan `tools/list` berhasil sebelum mengklaim terhubung.
4. Memulai sesi Hermes baru agar tools masuk ke konteks model.

Token koneksi terikat ke **satu** `agentKey` dan satu Agent Wallet MSCA. Jangan gunakan ulang token Agent A untuk Agent B. Rotasi di plugin mematikan token koneksi lama untuk agent yang sama; cabut agent mematikan seluruh access/refresh token-nya.

Skrip helper `arcox-agent connect` juga menerima pesan plugin:

```bash
echo 'URL server: https://arcoxdex.vercel.app/mcp Token: arx_at_...' | arcox-agent connect
arcox-agent doctor
```

`connect` mem-probe `initialize` dan `tools/list` terlebih dahulu, lalu menulis konfigurasi header. Token tidak dicetak oleh helper.

## 4. Verifikasi koneksi

```bash
hermes mcp test arcox
```

Hasil yang diharapkan:

```text
Transport: HTTP → https://arcoxdex.vercel.app/mcp
Auth: OAuth 2.1 PKCE
Connection successful
```

## 5. Mulai menggunakan MCP

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

## 6. Isolasi agent

Satu owner boleh memiliki banyak Agent Wallet, tetapi setiap agent memiliki satu pasangan `clientId + ownerId` dan satu MSCA. Nama agent, wallet, limit harian, audit activity, kartu tertaut, connection token, dan revoke state diproses dalam scope pasangan itu. Satu agent tidak dapat melihat activity atau menggunakan token agent lain.

## Security

- Tanpa login, **semua** request MCP ditolak (HTTP 401).
- Hermes tidak menerima private key MSCA.
- Hermes tidak menerima token MSCA di env.
- Token OAuth disimpan oleh Hermes secara lokal dengan permission terbatas.
- Setiap transaksi memerlukan preview dan konfirmasi eksplisit `yes`/`ya`.
- Backend memvalidasi OAuth session, MSCA aktif, preview, dan approval sebelum eksekusi.
