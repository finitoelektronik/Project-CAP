# Pusat Sinkronisasi Sinosure yang manual dan terlacak

Sinosure menggunakan satu Pusat Sinkronisasi untuk Pengiriman, Verifikasi Kontrak, dan Dokumen Persyaratan. Setiap pengguna CAP yang memperoleh akses Sinosure dapat mengatur dan menjalankan proses tersebut; tidak ada pekerjaan sinkronisasi latar belakang.

Sumber dapat berupa folder lokal, WeCom API, atau unggah manual. Berkas dan pemetaan yang ambigu tidak diterapkan secara otomatis dan harus masuk antrean tinjau. Riwayat sinkronisasi bersifat permanen. Penggantian file sumber hanya boleh dilakukan setelah verifikasi versi sumber yang telah disinkronkan; konflik tidak digabungkan otomatis.

Dokumen kontrak diberi nomor versi dan dibuatkan nama target WeDrive yang deterministik. Aksi WeDrive dijalankan dengan akun WeCom bersama; CAP tetap menyimpan pengguna CAP pelaksana pada audit internal.
