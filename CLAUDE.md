# CAP Analytics — aturan kerja Claude Code

Berkas ini dibaca otomatis oleh Claude Code di komputer mana pun yang membuka project ini.
Sumber kebenaran lain: `DEVELOPER_AUTONOMY.md`, `CONTEXT.md`, `MODULE_PACKAGE_SPEC.md`, `cap-modules.json`.

## 1. Kunci modul per sesi (WAJIB)

Setiap sesi yang akan **mengubah** project CAP (berkas, data, atau database) hanya boleh mengerjakan **satu modul**.

1. Sebelum edit pertama, tampilkan **daftar modul** dari `cap-modules.json` kepada pengguna (pakai pertanyaan pilihan) dan minta pengguna memilih satu. Jangan memilih sendiri.
2. Kunci sesi ke modul pilihan dengan menjalankan:
   ```powershell
   & .\scripts\claude\cap-lock.ps1 -Module <id-modul>
   ```
   Penjaga otomatis (`.claude/settings.json` → `scripts/claude/cap-module-guard.ps1`) mencatat kunci untuk sesi ini dan **menolak** edit berkas di luar wilayah modul tersebut.
3. Kunci tidak dapat dipindah ke modul lain di sesi yang sama. Pekerjaan modul lain → buka sesi baru.
4. Sesi yang hanya membaca/menjawab pertanyaan tidak perlu mengunci.

Berkas bersama sementara (`app.mjs`, `public/app.js`, `CONTEXT.md`) boleh diedit sesi modul, tetapi **hanya bagian milik modul itu sendiri**, sampai berkas tersebut dipecah ke `modules/`.

## 2. Pemisahan modul

- Setiap modul **hanya menulis datanya sendiri** (tabel, berkas, pengaturan). Modul lain hanya boleh **membaca**, sebaiknya lewat layanan baca yang disediakan modul pemilik melalui inti.
- **Pengecualian — WhatsApp Business** adalah layanan pesan & log bersama: modul lain yang memiliki fungsi pengingat boleh **meminta WhatsApp mengirim pesan dan menyimpan log** melalui layanan WhatsApp, bukan dengan menulis tabel WhatsApp secara langsung.
- **Gaji gudang tidak boleh mengubah data Keuangan** (Kas Kecil). Pembayaran gaji dicatat di Kas Kecil oleh modul Keuangan.
- Perbaikan data dijalankan **sekali** sebagai migrasi modul yang tercatat, bukan kode yang berjalan setiap server start.
- Paket modul hanya berisi berkas wilayah modul itu. Selama `app.mjs` belum dipecah, setiap paket yang membawa `app.mjs` dibangun dari source yang sama.

## 3. Kerangka modul (`modules/`)

Modul baru atau modul yang dipindahkan tinggal di `modules/<id>/` (lihat `modules/README.md`). Inti memuatnya lewat `modules/_core/module-loader.mjs` (folder berawalan `_` milik inti dan tidak dimuat sebagai modul). Modul tidak boleh mengimpor berkas modul lain; kebutuhan lintas modul memakai `ctx.services` dari inti.

## 4. Larangan umum

- Jangan menghapus atau mereset data/struktur database tanpa persetujuan pemilik aplikasi.
- Jangan membuat ZIP instalasi sebelum diminta secara eksplisit.
- Jangan menaruh database, kredensial, atau token di source/paket.
