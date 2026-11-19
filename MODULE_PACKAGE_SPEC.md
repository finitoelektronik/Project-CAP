# Paket Modul CAP Analytics

Paket modul dibuat oleh chat pengembang modul **hanya ketika pengguna memerintahkannya**. Berkas hasilnya adalah ZIP yang kemudian diunggah oleh akun master `888` pada **Pemasang Modul**.

## Struktur ZIP

```text
cap-module.json
payload/<berkas aplikasi>
migrations/<migrasi>.sql       # opsional
```

Contoh `cap-module.json`:

```json
{
  "format": "cap-module/v1",
  "id": "nama_modul",
  "title": "Nama Modul",
  "version": "1.0.0",
  "description": "Ringkasan fungsi modul.",
  "permissions": ["nama_modul", "nama_modul_pelaporan"],
  "files": [
    {
      "source": "payload/public/app.js",
      "target": "public/app.js",
      "sha256": "SHA256_BERKAS"
    }
  ],
  "migrations": [
    {
      "id": "create_nama_modul_tables",
      "source": "migrations/001-create-tables.sql",
      "sha256": "SHA256_MIGRASI"
    }
  ]
}
```

## Aturan pemasangan

- ID modul memakai huruf kecil, angka, dan garis bawah.
- Versi memakai format `x.y.z` dan harus lebih baru dari versi terpasang.
- Setiap berkas payload dan migrasi wajib memiliki checksum SHA-256.
- Target yang diizinkan: `app.mjs`, `public/`, `scripts/`, `modules/`, dan `CONTEXT.md`.
- Migrasi otomatis boleh menambah atau mengubah struktur serta memindahkan data secara aman. Operasi penghapusan data atau struktur ditolak.
- Installer membuat snapshot kode dan database sebelum memasang paket. Kegagalan pemeriksaan kesehatan setelah restart akan memulihkan snapshot tersebut.

## Perintah untuk chat pembuat modul

Gunakan instruksi berikut saat modul selesai:

> Buat paket instalasi CAP untuk modul `<id>` versi `<x.y.z>` sesuai `MODULE_PACKAGE_SPEC.md`. Jangan membuat ZIP sebelum saya meminta secara eksplisit.

Setelah ZIP diterima, unggah pada **Pemasang Modul** di server lokal CAP Analytics.
