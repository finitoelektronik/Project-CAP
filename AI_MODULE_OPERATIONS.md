# Protokol Operasional Modul untuk Semua AI

Dokumen ini berlaku untuk Codex, ChatGPT, Claude, Gemini, atau AI pengembang lain yang menerima CAP Developer Kit.

## Prinsip kerja

- AI bekerja dari source di Developer Kit; tidak bekerja langsung pada database produksi.
- Semua pemasangan dilakukan melalui ZIP `cap-module/v1` pada **Pemasang Modul** oleh akun master.
- Setiap ZIP harus lolos `scripts/cap_module_package.py inspect`.
- Jika modul rusak, AI mengumpulkan Paket Diagnostik dari Pemasang Modul terlebih dahulu. Database hanya disertakan bila pemilik menyetujui secara eksplisit.
- AI tidak boleh menghapus data, tabel, atau kredensial tanpa persetujuan pemilik.

## Alur penambahan modul

1. Baca `DEVELOPER_AUTONOMY.md`, `CONTEXT.md`, dan `MODULE_PACKAGE_SPEC.md`.
2. Tambahkan API, UI, izin, serta dokumentasi yang diperlukan.
3. Bila perlu mengubah schema, gunakan migrasi SQL non-destruktif dan ID yang unik.
4. Uji sintaks dan alur UI terkait.
5. Hanya bila diminta, buat ZIP modul, validasi, lalu serahkan untuk diunggah oleh akun master.

## Alur perbaikan modul rusak

1. Minta pengguna mengunduh **Paket Diagnostik** dari Pemasang Modul.
2. Analisis error, riwayat instalasi, versi modul, dan snapshot tanpa meminta database lebih dahulu.
3. Buat perbaikan source yang menjaga kompatibilitas data lama.
4. Jika database memang diperlukan, minta izin eksplisit sebelum pengguna mencentang “Sertakan salinan database”.
5. Buat ZIP upgrade dengan versi lebih tinggi, validasi, lalu gunakan snapshot pemulihan bila health check gagal.

## Penghapusan modul

- Hanya akun master yang dapat menghapus modul dari **Pemasang Modul**.
- Pengguna harus menyetujui dialog konfirmasi lalu mengetik `HAPUS <id_modul>` sebagai pemeriksaan kedua.
- Penghapusan otomatis hanya memulihkan berkas kode dari snapshot; database tidak dihapus atau dipulihkan mundur.
- Modul yang memiliki migrasi database atau berkonflik dengan paket lebih baru tidak dapat dihapus otomatis. Gunakan snapshot pemulihan dan tinjau dampak data terlebih dahulu.

## Informasi minimum saat menyerahkan paket

- ID dan versi paket.
- Fungsi yang ditambah/diperbaiki.
- Migrasi database dan dampaknya.
- Cara menguji setelah pemasangan.
- Cara rollback melalui snapshot Pemasang Modul.
