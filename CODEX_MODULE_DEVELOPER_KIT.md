# CAP Analytics — Kit untuk Codex Pembuat Modul

Dokumen ini disertakan bersama kode sumber non-data agar Codex di komputer lain dapat membuat atau memperbarui modul CAP Analytics.

## Tujuan

Codex lain dapat:

1. memahami struktur aplikasi dan aturan bisnis dari `CONTEXT.md`;
2. menambah fungsi atau modul secara aman pada source code;
3. membuat ZIP instalasi yang valid untuk diunggah melalui **Pemasang Modul**;
4. menjaga data produksi pada server tetap utuh.

## Yang ada di kit

- `app.mjs` — server Node.js, API, SQLite schema/migrasi ringan, dan izin akses.
- `public/` — UI aplikasi (JavaScript, CSS, aset web).
- `scripts/cap_module_package.py` — validator format ZIP modul.
- `scripts/build_*_module.py` — contoh pembuat paket upgrade/modul.
- `sql/` — referensi SQL yang relevan.
- `CONTEXT.md` — istilah bisnis, aturan proses, dan keputusan yang sudah dibuat.
- `DEVELOPER_AUTONOMY.md` dan `developer-kit.json` — batas kewenangan, standar perubahan, dan konfigurasi kerja mandiri.
- `AI_MODULE_OPERATIONS.md` — protokol yang sama untuk Codex, ChatGPT, Claude, Gemini, maupun AI pengembang lain.
- `templates/module_builder_template.py` — template pembuat ZIP modul yang tidak membawa data produksi.
- `MODULE_PACKAGE_SPEC.md` — kontrak resmi format ZIP modul.
- `PANDUAN_INSTALASI.md` dan `README.md` — informasi lingkungan aplikasi.

## Yang sengaja tidak disertakan

- `data/app.db` dan semua salinan database;
- akun, kata sandi, token, atau data operasional;
- `startup*.log`, folder recovery, serta riwayat pemasangan;
- file EXE dan ZIP upgrade lama.

Kit ini aman diberikan kepada Codex lain karena tidak membawa data produksi. Codex pembuat modul tidak boleh meminta atau mengganti database produksi untuk membuat paket.

## Arsitektur singkat

| Bagian | Lokasi | Tugas |
| --- | --- | --- |
| Server utama | `app.mjs` | HTTP API, akses SQLite, autentikasi, hak akses, pemasangan modul |
| UI inti | `public/app.js` | shell aplikasi, dashboard, sidebar, pengelolaan akun/hak akses |
| UI accounting | `public/accounting-lite.js` | Accounting Lite dan pembatasan tab/submodul |
| Tampilan responsif | `public/responsive-layout.css` | tata letak desktop dan zoom 75% |
| Validasi paket | `scripts/cap_module_package.py` | menolak ZIP tidak aman atau migrasi destruktif |

Database produksi berada pada `data/app.db` di server CAP dan **tidak boleh dimasukkan ke paket**.

## Kontrak Paket Modul

ZIP wajib mengikuti struktur berikut:

```text
cap-module.json
payload/<berkas aplikasi>
migrations/<migrasi>.sql        # hanya jika diperlukan
```

Target payload yang diizinkan hanya: `app.mjs`, `CONTEXT.md`, `public/`, `scripts/`, dan `modules/`.

Setiap berkas harus dicantumkan dalam `cap-module.json` beserta SHA-256. Migrasi hanya boleh bersifat aman/menambah/memperbarui; penghapusan tabel, data, indeks, trigger, view, `VACUUM`, atau `TRUNCATE` ditolak installer.

Baca `MODULE_PACKAGE_SPEC.md` sebelum mengubah kode atau membuat ZIP.

## Alur wajib untuk Codex pembuat modul

1. Baca `DEVELOPER_AUTONOMY.md`, `AI_MODULE_OPERATIONS.md`, `CONTEXT.md`, `MODULE_PACKAGE_SPEC.md`, dan source yang terkait.
2. Implementasikan fungsi di source code terlebih dahulu.
3. Pastikan tidak ada data contoh/akun/kata sandi/database yang ikut ditulis.
4. Jalankan pemeriksaan sintaks JavaScript, misalnya:

   ```powershell
   node --check app.mjs
   node --check public/app.js
   ```

5. Buat ZIP **hanya setelah pengguna meminta secara eksplisit**.
6. Jalankan validator:

   ```powershell
   python scripts/cap_module_package.py inspect release\NAMA-PAKET.zip
   ```

7. Berikan ZIP hasil validasi kepada pengguna untuk diunggah melalui **Pemasang Modul** akun master.

## Aturan keamanan data

- Paket upgrade tidak boleh berisi `data/`, `app.db`, ekspor SQL data, snapshot, recovery, atau log.
- Paket tidak boleh mengganti kata sandi, pengguna, hak akses, identitas aplikasi, maupun data transaksi yang ada, kecuali fitur yang diminta pengguna memang melakukan perubahan tersebut melalui API/UI.
- Jika perubahan membutuhkan struktur database, gunakan migrasi SQL non-destruktif dengan ID migrasi unik.
- Installer CAP membuat snapshot sebelum pemasangan dan memulihkan snapshot jika pemeriksaan kesehatan gagal.

## Prompt siap pakai untuk Codex lain

```text
Saya mengirim CAP-Codex-Module-Developer-Kit.zip untuk aplikasi CAP Analytics.
Pelajari terlebih dahulu CODEX_MODULE_DEVELOPER_KIT.md, MODULE_PACKAGE_SPEC.md, dan CONTEXT.md.

Implementasikan permintaan saya pada source code tanpa memasukkan database atau data produksi ke dalam paket.
Jangan membuat ZIP instalasi sebelum saya secara eksplisit mengatakan “buat paket instalasi” atau “buat file upgrade”.
Saat diminta membuat paket, gunakan format cap-module/v1, checksum SHA-256, hanya target yang diizinkan, lalu validasi dengan scripts/cap_module_package.py inspect.
```

## Catatan versi

Kit ini dibuat pada 4 November 2026. Versi paket yang dibuat harus selalu dinaikkan dari versi modul yang sudah terpasang pada server tujuan.
