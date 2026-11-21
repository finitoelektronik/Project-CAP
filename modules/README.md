# Modul CAP Analytics

Setiap modul tinggal di folder `modules/<id>/` dan dimuat oleh inti (`core/module-loader.mjs`) saat server start.
Folder yang diawali `_` (misalnya `_template`) atau `.` tidak dimuat.

```text
modules/<id>/
  module.json     manifest modul (wajib)
  server.mjs      backend modul (opsional)
  public/         aset tampilan (opsional), disajikan di /modules/<id>/...
  migrations/     SQL migrasi sekali jalan untuk tabel milik modul (opsional)
```

## module.json

```json
{
  "id": "contoh_modul",
  "title": "Contoh Modul",
  "version": "1.0.0",
  "permission": "contoh_modul",
  "frontend": { "scripts": ["contoh.js"], "styles": ["contoh.css"] }
}
```

- `id` sama dengan nama folder; huruf kecil, angka, garis bawah.
- `permission` adalah kunci hak akses yang diperiksa inti sebelum rute modul dijalankan (bawaan: `id`).
- `frontend` berisi berkas di `public/` yang dimuat otomatis di halaman aplikasi.

## server.mjs

```js
export async function register(ctx) {
  // ctx.db, ctx.json, ctx.readJson, ctx.readBuffer, ctx.canAccess, ctx.services, ctx.log, ctx.id
  ctx.db.exec(`CREATE TABLE IF NOT EXISTS contoh_modul_catatan (id INTEGER PRIMARY KEY, isi TEXT NOT NULL) STRICT;`);
  ctx.services.provide('jumlah_catatan', () => ctx.db.prepare('SELECT COUNT(*) n FROM contoh_modul_catatan').get().n);
  return {
    async routes({ req, res, url, user, path }) {
      if (path === '/catatan' && req.method === 'GET') { ctx.json(res, 200, ctx.db.prepare('SELECT * FROM contoh_modul_catatan').all()); return true; }
      return false; // inti menjawab 404
    },
  };
}
```

- Rute modul diakses di `/api/modules/<id>/...`; inti sudah memeriksa login dan hak akses.
- Modul gagal dimuat atau melempar galat → hanya modul itu yang terdampak; status terlihat di `/api/core/modules` (akun master).

## Aturan

1. Modul hanya membuat dan menulis tabel berawalan id modulnya sendiri.
2. Modul tidak mengimpor berkas modul lain. Data modul lain dibaca lewat `ctx.services.use('<modul>.<layanan>')`.
3. WhatsApp Business menyediakan layanan pengiriman pesan & log bersama untuk modul yang memiliki pengingat.
4. Perbaikan data berupa migrasi sekali jalan, bukan kode yang berjalan setiap start.
5. Paket upgrade modul hanya berisi `modules/<id>/`.
