# CAP Analytics

Aplikasi operasional lokal dengan database SQLite (`data/app.db`).

## Modul

- **Analisis penjualan** — impor ekspor `.xlsx` Shopee, TikTok, dan Lazada untuk melihat pesanan, cancel, retur, refund, produk, serta wilayah penerima.
- **Rekap kegiatan gudang** — catat kegiatan harian berdasarkan tanggal, shift, aktivitas, area, petugas, jumlah unit, dan catatan. Rekap menampilkan produktivitas aktivitas serta area gudang.
- **Gaji gudang** — impor laporan absensi `.xls` atau `.xlsx` dengan sheet `Analisa Kehadiran`, atur gaji harian, potongan, dan tarif lembur per karyawan, lalu ekspor rekap gaji Excel.

## Menjalankan aplikasi

Untuk pengembangan dengan restart otomatis saat `app.mjs` berubah:

```powershell
.\start-dev.ps1
```

Mode ini mempertahankan database `data/app.db`; restart server tidak menghapus data.

Untuk menjalankan tanpa pemantauan perubahan:

```powershell
.\start-dev.ps1
```

Buka `http://localhost:3100`, kemudian pindah modul dari sidebar. Untuk menjalankan di mesin lain, set `CAP_PYTHON` ke executable Python yang memiliki `openpyxl`. Dukungan input `.xls` juga memerlukan `xlrd` (`pip install xlrd`).
