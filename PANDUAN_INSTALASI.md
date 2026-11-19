# Panduan instalasi CAP Analytics di komputer lain

## Kebutuhan

1. Windows 10 atau Windows 11.
2. Node.js LTS versi 22 atau lebih baru. Unduh dari [nodejs.org](https://nodejs.org/en/download).
3. Python 3.12 beserta pustaka `openpyxl` dan `xlrd` untuk impor dan ekspor Excel pada modul Gaji Gudang serta Retur Online. Installer CAP akan memasangnya otomatis.
4. Tesseract OCR untuk membaca gambar laporan kegiatan gudang.
5. Akses untuk menyalin folder atau berkas ZIP CAP Analytics ke komputer tujuan.

## Instalasi baru

1. Salin atau ekstrak paket `CAP-Analytics-Setup.zip` ke folder yang mudah ditemukan, misalnya `Downloads`.
2. Instal Node.js LTS bila belum ada. Setelah selesai, tutup dan buka kembali PowerShell atau Command Prompt.
3. Buka PowerShell sebagai Administrator lalu pasang OCR lokal satu kali:

```powershell
winget install --id UB-Mannheim.TesseractOCR --exact --accept-package-agreements --accept-source-agreements
```

4. Klik kanan `Install-CAP-Analytics.ps1`, lalu pilih **Run with PowerShell**. Installer akan memasang Python 3.12 dan pembaca Excel `openpyxl` bila belum tersedia. Internet diperlukan hanya pada pemasangan pertama ini.
5. Saat diminta memperbarui folder yang sudah ada, pilih `Y` hanya bila ingin memperbarui aplikasi lama.
6. Setelah selesai, buka shortcut **CAP Analytics** di Desktop.
7. Browser akan membuka `http://localhost:3100`.

## Masuk pertama kali

- Nama pengguna: `master`
- Kata sandi: `CAPMaster!2026`

Segera ubah kata sandi master melalui tombol **Ubah kata sandi** setelah berhasil masuk.

## Memindahkan data dari komputer lama

Instalasi baru sengaja tidak membawa database agar tidak menyalin data tanpa persetujuan. Untuk memigrasikan data:

1. Tutup CAP Analytics pada kedua komputer.
2. Salin berkas `data\app.db` dari komputer lama.
3. Jalankan installer dengan PowerShell dan tambahkan opsi `-CopyDatabase`:

```powershell
.\Install-CAP-Analytics.ps1 -CopyDatabase
```

Atau, setelah aplikasi terpasang, salin `app.db` lama ke folder `data` di folder instalasi dan setujui penggantian berkas.

## Menjalankan dan menghentikan aplikasi

- Jalankan: klik shortcut **CAP Analytics** di Desktop atau `Start-CAP-Analytics.cmd` di folder aplikasi.
- Hentikan: tutup jendela PowerShell yang menjalankan aplikasi.
- Jika port 3100 sedang dipakai, skrip akan menghentikan hanya server CAP Analytics lama di port tersebut lalu menjalankan versi terbaru.

## Akses melalui jaringan LAN

1. Jalankan CAP Analytics pada komputer server.
2. Klik kanan `Aktifkan-Akses-LAN.ps1`, lalu pilih **Run with PowerShell** sebagai Administrator. Skrip hanya membuka port 3100 untuk profil jaringan **Privat**.
3. Catat alamat IPv4 yang ditampilkan, misalnya `192.168.1.10`.
4. Pada komputer atau ponsel yang berada di Wi-Fi/LAN yang sama, buka `http://192.168.1.10:3100`.
5. Masuk menggunakan akun CAP Analytics yang sama.

Jangan membuka port ini pada profil jaringan Publik. Akses tetap dilindungi oleh halaman login aplikasi.

## Menyalakan server otomatis saat komputer hidup

Pada komputer yang menjadi server, buka PowerShell sebagai **Administrator**, masuk ke folder instalasi CAP Analytics, lalu jalankan:

```powershell
.\Aktifkan-AutoStart.ps1 -RunNow
```

Skrip membuat tugas Windows bernama **CAP Analytics LAN Server**. Server akan berjalan otomatis setiap Windows menyala, mencoba kembali hingga tiga kali apabila gagal, dan tidak memerlukan browser terbuka. Untuk memastikan akses perangkat lain tetap tersedia, jalankan juga `Aktifkan-Akses-LAN.ps1` sebagai Administrator satu kali.

Jika tidak memiliki hak Administrator, jalankan alternatif berikut. Server akan aktif otomatis setelah pengguna Windows masuk:

```powershell
.\Aktifkan-AutoStart-Pengguna.ps1
```

## Pembaruan aplikasi

1. Tutup aplikasi yang sedang berjalan.
2. Ekstrak paket versi baru.
3. Jalankan `Install-CAP-Analytics.ps1` dan pilih `Y` ketika diminta memperbarui folder.
4. Jangan gunakan `-CopyDatabase` saat pembaruan di komputer yang sama; database yang sudah ada akan tetap dipakai.

## Bantuan singkat

- Pesan “Node.js belum ditemukan”: instal Node.js LTS lalu ulangi menjalankan aplikasi.
- Pesan Python/openpyxl belum tersedia saat impor Excel: jalankan kembali `Install-CAP-Analytics.ps1` sebagai Administrator pada **komputer server yang menjalankan CAP**, bukan pada komputer browser klien.
- Browser tidak terbuka: buka manual `http://localhost:3100`.
- Tidak bisa masuk: pastikan menggunakan akun yang dibuat master atau ubah kata sandi melalui akun master.
