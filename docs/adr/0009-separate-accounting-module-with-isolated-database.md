# Modul Accounting Terpisah dengan Database Terisolasi

Tanggal: 2026-11-10

## Keputusan

Server utama akan memasang modul baru bernama `Accounting` berdampingan dengan
`Accounting Lite`. Modul baru memakai database `data/accounting.db` sendiri,
dibentuk dari data Accounting Lite terbaru pada server utama. Kode dan
konfigurasi dasar berasal dari aplikasi lokal.

Tidak ada sinkronisasi otomatis sesudah cutover. Accounting Lite lama tetap
aktif dengan database lamanya. Pengguna dan hak akses tetap dikelola oleh CAP
server utama.

## Transformasi awal

- Salin hanya data Accounting Lite yang diperlukan; jangan menyalin database
  lokal atau data modul CAP lain.
- Gunakan konfigurasi laporan dan invoicing lokal hanya untuk kode rekening
  yang tersedia pada database server utama. Kode yang tidak tersedia dicatat
  dalam hasil validasi, bukan dibuat otomatis.
- Jangan menyalin invoice draft.
- Data 2021–2025 tetap histori; data 2026 tersedia sebagai data operasional
  tanpa penanda cutover tambahan.

## Konsekuensi

Kedua modul dapat memiliki transaksi dan saldo yang berbeda setelah cutover.
Perbandingan keduanya hanya valid sampai titik salin awal atau melalui impor
satu arah yang diaudit pada masa mendatang.
