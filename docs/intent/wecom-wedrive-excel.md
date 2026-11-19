# Intent: Integrasi WeCom–WeDrive Excel

Status: disetujui pengguna pada 4 November 2026.

## Outcome

Menyediakan aplikasi yang terintegrasi dengan WeCom dan WeDrive untuk membaca serta mengubah data Excel yang tersimpan di WeDrive.

## Pengguna dan akses

- Pengguna hanya dapat memakai modul dan dokumen yang memang diberikan kepadanya.
- Setiap modul menggunakan tepat satu akun WeCom yang ditentukan oleh akun master/admin.
- Koneksi WeCom–WeDrive ini adalah milik perusahaan yang berbeda dari Sinosure dan harus disimpan sebagai konfigurasi terpisah; tidak boleh memakai Corp ID, secret, akun layanan, folder, atau data Sinosure.
- Aplikasi hanya menampilkan serta mengizinkan perubahan sesuai hak akses pengguna pada modul atau dokumen.

## Perubahan data

- Pengguna berwenang dapat membaca dan mengubah data Excel melalui aplikasi.
- Perubahan yang disimpan melalui aplikasi ditulis kembali ke Excel di WeDrive.
- Aplikasi juga harus mendeteksi perubahan Excel yang dibuat langsung melalui WeDrive/Excel.

## Notifikasi

- Pemilik modul dapat memilih penerima notifikasi bawaan.
- Penerima hanya boleh dipilih dari pengguna yang sudah memiliki akses ke dokumen atau modul terkait.
- Setiap perubahan yang terdeteksi, baik melalui aplikasi maupun langsung di WeDrive/Excel, mengirim pemberitahuan kepada penerima bawaan.

## Kriteria keberhasilan

Perubahan tersimpan, dapat dideteksi, dan memicu notifikasi kepada pihak yang ditentukan, tanpa membuka akses kepada pengguna yang tidak berwenang.

## Di luar cakupan

- Memberikan atau mengubah hak akses dokumen WeDrive.
- Mengirim notifikasi kepada pengguna yang tidak memiliki akses ke dokumen atau modul terkait.
