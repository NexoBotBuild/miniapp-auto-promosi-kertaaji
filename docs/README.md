# Client Promosi Lite

MVP operasional Telegram: Auto Sebar memakai akun worker milik admin secara 1:1 per buyer, Auto Komen memakai akun buyer sendiri.

## Yang sudah dibangun

- Dashboard buyer dan panel admin setup buyer.
- Inventory worker: tambah, assign, nonaktifkan/hapus record, maksimal 15 grup per buyer.
- Konfigurasi Auto Sebar dan Auto Komen berbasis approval atau otomatis.
- Retensi siap dijalankan: kandidat approval 48 jam, anti-duplikat 7 hari, riwayat sebar 30 hari / 100 terakhir.
- Kontrak payment provider; DOKU belum diaktifkan sampai credential merchant diberikan.

## Menjalankan

1. `cp .env.example .env`
2. `npm install`
3. `npm run dev`

Mode develop memakai data lokal `data/store.json`. Sebelum deploy production, ganti adapter store ke Postgres dan aktifkan verifikasi Telegram initData.
