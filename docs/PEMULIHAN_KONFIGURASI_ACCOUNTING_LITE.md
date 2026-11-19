# Pemulihan Konfigurasi Accounting Lite

Dokumen ini berlaku untuk pemulihan server utama. Alat pemulihan **tidak**
mengganti database dengan database lokal.

## Yang dipertahankan

- rekening dan struktur rekening;
- jurnal serta seluruh baris jurnal;
- stok lama, dokumen stok operasional, dan alokasi FIFO;
- invoice berstatus `historical` atau `posted`;
- pengguna dan data di luar Accounting Lite.

## Yang dibangun ulang

- pemetaan Neraca, Laba Rugi, dan HPP;
- baris hasil khusus Laba Rugi/HPP dan Laba Rugi periode berjalan pada Neraca;
- rekening Penjualan serta Hutang PPN pada profil invoicing;
- invoice yang masih `draft` saja dihapus agar tidak menghasilkan transaksi ganda.

## Prosedur server utama

1. Pasang `CAP-Accounting-Upgrade-1.5.5.zip` melalui **Pasang modul**.
2. Tutup akses pengguna dan hentikan layanan CAP Analytics dari server utama.
3. Buka PowerShell pada folder instalasi CAP Analytics, lalu jalankan pemeriksaan:

   ```powershell
   node scripts\rebuild_accounting_lite_configuration.mjs --database data\app.db
   ```

4. Pastikan keluaran menunjukkan `integrity_check: "ok"` dan
   `journal_balanced: true`.
5. Jalankan pemulihan. Perintah ini membuat cadangan penuh database sebelum
   perubahan apa pun:

   ```powershell
   node scripts\rebuild_accounting_lite_configuration.mjs --database data\app.db --backup-dir data\recovery\accounting-config --maintenance-confirmed --apply --confirm REBUILD_ACCOUNTING_CONFIG
   ```

6. Simpan nama file cadangan yang dicetak alat, kemudian mulai kembali CAP
   Analytics.
7. Sebelum membuka akses pengguna, buka Laporan Neraca, Laba Rugi, dan HPP
   sekali. Aplikasi akan membentuk pemetaan standar berdasarkan kode rekening
   pada database server utama. Periksa Neraca, Laba Rugi, HPP, Buku Besar, dan
   Invoicing sesuai periode pembanding.

Jika pemeriksaan awal tidak lulus, jangan jalankan mode `--apply`.
