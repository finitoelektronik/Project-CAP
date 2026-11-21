# Pengembangan Mandiri CAP Analytics

Dokumen ini adalah kontrak kerja bagi pengembang atau Codex pengganti agar CAP Analytics dapat dikembangkan tanpa keputusan teknis harian dari pemilik aplikasi.

## Sumber kebenaran

1. `CONTEXT.md` adalah sumber istilah bisnis, aturan proses, dan keputusan domain.
2. `app.mjs` adalah server utama, API, schema SQLite, migrasi ringan, autentikasi, dan pemasangan modul.
3. `public/app.js` adalah shell UI, sidebar, dashboard, akun, dan hak akses.
4. `MODULE_PACKAGE_SPEC.md` adalah kontrak yang wajib dipatuhi semua ZIP instalasi.
5. Database produksi hanya berada di server pada `data/app.db`; database tidak pernah menjadi bagian paket source atau upgrade.

Jika kebutuhan baru bertentangan dengan sumber di atas, pengembang harus memperbarui `CONTEXT.md` dan mencatat alasan perubahan pada deskripsi paket. Tidak perlu menunggu persetujuan untuk perbaikan bug, keamanan, stabilitas, kompatibilitas, atau UI yang tidak mengubah proses bisnis.

## Batas kewenangan pengembang

Pengembang boleh secara mandiri:

- memperbaiki bug, error, kebocoran tata letak, aksesibilitas, responsivitas, dan performa;
- menambah halaman, API, tabel, kolom, indeks, dan izin baru melalui migrasi non-destruktif;
- menambah submodul pada modul yang sudah ada;
- memperbarui dokumentasi, test/pemeriksaan, builder, dan validator paket;
- membuat paket upgrade setelah ada perintah eksplisit untuk membuat ZIP.

Pengembang wajib meminta persetujuan pemilik aplikasi sebelum:

- menghapus atau mereset data/struktur database;
- mengubah perhitungan gaji, aturan kehadiran, atau laporan keuangan yang sudah digunakan;
- mengirim data keluar dari jaringan lokal, menambahkan layanan cloud/API eksternal, atau menyimpan kredensial;
- mengubah hak master, autentikasi, atau mekanisme backup/recovery;
- membuat fitur yang secara material mengubah alur kerja operasional.

## Standar perubahan

1. Pahami modul terkait lewat `CONTEXT.md` dan telusuri source sebelum mengedit.
2. Implementasikan minimal perubahan yang memenuhi kebutuhan.
3. Jaga kompatibilitas data lama. Kolom/table baru harus memiliki nilai default atau migrasi yang aman.
4. Jangan menaruh rahasia, database, ekspor data, atau snapshot di source/paket.
5. Perbarui label hak akses dan pemetaan submodul apabila membuat halaman baru yang dibatasi aksesnya.
6. Pastikan tampilan tetap dapat dipakai pada zoom browser 75% dan layar desktop/laptop umum.
7. Jangan membuat ZIP instalasi sebelum diminta secara eksplisit.

## Pemeriksaan minimal sebelum rilis

```powershell
node --check app.mjs
node --check public/app.js
node --check public/accounting-lite.js       # bila berkas diubah
python scripts/cap_module_package.py inspect release\NAMA-PAKET.zip
```

Selain pemeriksaan ini, pengembang harus membuka fitur yang berubah di `http://localhost:3100` dan memeriksa:

- tidak ada error di browser/server;
- pengguna tanpa izin tidak melihat atau membuka submodul yang dibatasi;
- pengguna master tetap dapat mengelola akses;
- data lama dapat tetap dibaca;
- tombol simpan/batal/tutup berfungsi.

## Cara membuat paket

1. Pilih ID modul yang stabil, misalnya `inventory_upgrade`.
2. Naikkan versi semantik (`MAJOR.MINOR.PATCH`) dibanding versi yang telah dipasang.
3. Gunakan `templates/module_builder_template.py` atau salin pola dari `scripts/build_*_module.py`.
4. Cantumkan setiap payload dan migrasi beserta SHA-256.
5. Jalankan validator paket.
6. Tulis ringkasan dampak data pada `description` manifest.

Paket dipasang oleh akun master menggunakan **Pemasang Modul**. Installer membuat snapshot kode/database dahulu dan melakukan pemulihan jika pemeriksaan kesehatan gagal.

## Catatan perubahan yang wajib dicatat

Setiap paket harus menjelaskan:

- tujuan dan modul yang terdampak;
- daftar file yang diganti;
- perubahan database/migrasi (atau tulis “tidak ada”);
- dampak pada data yang sudah ada;
- cara verifikasi setelah pemasangan;
- langkah rollback: gunakan pemulihan snapshot dari Pemasang Modul bila health check gagal.

## Prompt kerja untuk Codex pengganti

```text
Bekerja sebagai pengembang mandiri CAP Analytics. Ikuti DEVELOPER_AUTONOMY.md,
CONTEXT.md, dan MODULE_PACKAGE_SPEC.md sebagai sumber kebenaran. Perbaiki bug dan
kembangkan fitur secara aman tanpa database/data produksi. Ajukan pertanyaan hanya
bila perubahan menyentuh penghapusan data, aturan penggajian/keuangan, layanan
eksternal, autentikasi, atau mengubah alur operasional secara material. Jangan buat
ZIP instalasi sampai pengguna meminta secara eksplisit. Validasi syntax dan paket
sebelum menyerahkan hasil.
```

## Pemisahan modul dan kunci sesi

Berlaku sejak 21 November 2026. Rincian lengkap ada di `CLAUDE.md` dan wilayah berkas per modul di `cap-modules.json`.

1. Setiap sesi pengembangan yang mengubah project hanya mengerjakan satu modul yang dipilih pemilik aplikasi dari daftar modul; sesi dikunci ke modul itu oleh penjaga otomatis. Aturan ini berlaku di semua komputer karena tersimpan di repository.
2. Setiap modul hanya menulis datanya sendiri; modul lain hanya membaca. WhatsApp Business adalah layanan pesan dan log bersama yang boleh dipanggil modul lain untuk mengirim pesan/pengingat.
3. Gaji gudang tidak menulis ke Kas Kecil (modul Keuangan).
4. Perbaikan data berupa migrasi sekali jalan, bukan kode yang berjalan setiap start.
5. Paket modul hanya berisi berkas wilayah modulnya; modul baru ditempatkan di `modules/<id>/` dan dimuat oleh inti (`core/module-loader.mjs`).