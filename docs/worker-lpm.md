# Worker LPM

Isi `.env`:

```env
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
WORKER_SESSION_KEY=
LPM_ADAPTER_TOKEN=
```

`WORKER_SESSION_KEY` dan `LPM_ADAPTER_TOKEN` wajib berupa rahasia panjang dan berbeda.

Tambahkan worker dari Panel Admin lalu pilih **Hubungkan akun**. Admin memasukkan nomor, kode Telegram, dan password 2FA bila diperlukan langsung dari Mini App. Username dibaca otomatis dari akun yang berhasil terhubung.

Server menjalankan worker dan membaca antrean join/keluar otomatis. Saat Supabase aktif, session tersimpan terenkripsi di database; saat local tanpa Supabase, session sementara tersimpan di `data/worker-sessions.json`. Keduanya tidak ikut git.
