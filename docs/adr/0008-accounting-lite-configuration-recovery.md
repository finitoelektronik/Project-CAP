# Pemulihan konfigurasi Accounting Lite tanpa mengganti data audit

Jika fungsi Accounting Lite di server utama tidak konsisten dengan modul yang tervalidasi di lokal, pemulihan menggunakan cadangan server utama sebagai satu-satunya sumber data. Jurnal, rekening, stok, dan invoice dipertahankan; hanya konfigurasi dan hasil turunan dibangun ulang memakai kode rekening, lalu cutover dilakukan setelah jurnal seimbang serta Buku Besar, Neraca, Laba Rugi, dan HPP tervalidasi.
