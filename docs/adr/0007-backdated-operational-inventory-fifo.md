# Sisipan Mutasi Stok Operasional Bertanggal Lampau

CAP mengizinkan transaksi stok operasional disisipkan, diubah, atau dihapus tanpa membatasi transaksi pada urutan terakhir. Sistem membangun ulang FIFO, HPP, nilai persediaan, dan jurnal seluruh dokumen operasional menurut tanggal lalu identitas dokumen; apabila salah satu titik menghasilkan stok negatif, keseluruhan perubahan dibatalkan secara atomik dan histori impor tetap tidak diubah.
