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

Mode lokal memakai data di folder data. Untuk mencoba dashboard demo di browser, isi ALLOW_DEMO=true.

## Menyambungkan ke Telegram

1. Deploy aplikasi ini ke domain HTTPS, lalu isi MINIAPP_URL dengan alamat tersebut dan BOT_TOKEN dengan token bot client.
2. Deploy ulang. Saat bot hidup, ia memasang tombol menu **Buka layanan** dan tombol /start ke Mini App secara otomatis.
3. Buyer membuka bot lalu menekan tombol itu. Mini App membaca identitas Telegram dari sesi yang dibuka dan server memverifikasinya dengan BOT_TOKEN.
4. Saat admin membuat buyer, simpan Telegram ID buyer yang tepat. Itu yang mengikat akun Telegram buyer ke layanannya.

Jangan aktifkan ALLOW_DEMO di production. Sebelum menerima data nyata, pindahkan store JSON ke Postgres dan pasang alur login Telegram (OTP) yang sesungguhnya untuk Auto Komen.
