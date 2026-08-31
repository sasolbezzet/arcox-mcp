# Koneksi Hermes ke ARCOX DEX

Gunakan flow **web ARCOX → Agent Terhubung → Buat Token Koneksi**. Token koneksi berlaku untuk satu agent dan satu Agent Wallet MSCA.

## 1. Buat token koneksi

1. Buka `https://arcoxdex.vercel.app` → **Plugin**.
2. Pastikan Agent Wallet untuk agent yang dipilih aktif dengan Passkey.
3. Klik **Buat Token Koneksi** atau **Rotasi token koneksi**.
4. Salin command koneksi yang ditampilkan satu kali.

Token bukan Passkey, private key, atau login website umum. Jangan gunakan token agent lain.

## 2. Jalankan connector remote Hermes

Dari command yang disalin di web, bentuknya seperti ini:

```bash
printf '%s\n' 'URL server: https://arcoxdex.vercel.app/mcp Token: arx_at_...' | npx --yes arcox-agent@0.1.20 connect
```

Versi `0.1.20` wajib dipakai untuk menghindari collision dengan executable `arcox-agent` lama yang dapat menjalankan flow Agent Jobs lokal. Connector akan:

1. Memanggil remote MCP `/mcp` dengan bearer token.
2. Memeriksa `initialize` dan `tools/list`.
3. Memanggil `arcox_session_status` secara read-only.
4. Memastikan wallet yang dikembalikan adalah MSCA aktif dari token.
5. Menulis konfigurasi remote ke profil Hermes hanya setelah semua pemeriksaan berhasil.

Jangan mengganti command dengan `command -v arcox-agent`, jangan memasukkan token ke `~/.arcox/agent.env`, dan jangan memasukkan token ke prompt model.

## 3. Hasil yang benar

Output connector harus menyebutkan wallet Agent Wallet, bukan EOA utama atau endpoint lokal:

```text
ARCOX connection verified: ... tools available.
Agent Wallet MSCA: 0x...
MSCA status: active (MSCA)
Terhubung. Mulai sesi Hermes baru untuk mengaktifkan tools.
```

Setelah itu mulai sesi Hermes baru. Jika Hermes sudah berjalan, gunakan `/reload-mcp` bila didukung.

## 4. Verifikasi manual

```bash
hermes mcp test arcox
```

Koneksi harus berhasil melakukan `initialize` dan `tools/list`. Tanpa token, endpoint remote memang mengembalikan `401`.

## 5. Isolasi agent

Setiap agent memiliki `clientId`, Agent Wallet MSCA, limit, audit scope, dan token koneksi sendiri. Rotasi mematikan token koneksi lama untuk agent tersebut; cabut akses mematikan seluruh token agent tersebut tanpa memengaruhi agent lain.

## 6. Troubleshooting

- Jika muncul `ready_to_link`, `Arc agent: belum terdaftar`, atau `127.0.0.1:8787/agent`, yang berjalan adalah CLI Agent Jobs lama. Jalankan ulang command `npx --yes arcox-agent@0.1.20 connect` dari web.
- Jika status MSCA tidak aktif, aktifkan Agent Wallet/session key di Plugin lalu buat token baru.
- Jika token pernah terlihat di terminal/chat, rotasi token dari kartu agent sebelum mencoba lagi.
- Jangan memakai private key atau `ARCOX_MSCA_SESSION_TOKEN` untuk flow remote header ini.
