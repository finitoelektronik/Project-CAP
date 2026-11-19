# Rancangan Database Manajemen Aset

## Tujuan

Database ini memantau aset perusahaan, umur pakai, kondisi, lokasi, pengguna, dan riwayatnya. Modelnya sengaja generik agar kategori komputer, monitor, kendaraan, telepon genggam, furnitur, dan kategori berikutnya dapat ditambahkan tanpa mengubah struktur inti. Ini bukan modul penyusutan atau laporan akuntansi resmi.

## Prinsip pencatatan

1. Satu benda fisik = satu baris `assets`. PC dan monitor dicatat sebagai aset berbeda karena dapat dipindah, diservis, dan mencapai umur target berbeda.
2. Aset yang dipakai bersama dapat dimasukkan ke satu `asset_bundle`, misalnya "Set PC Koko - Office OnlineShop". Bundel hanyalah pengelompokan.
3. Masa pakai target tersimpan di `asset_classes`, lalu disalin ke aset. Perubahan target standar tidak mengubah target aset yang sudah ada.
4. GPU, SSD, dan RAM adalah spesifikasi/keterangan PC, bukan aset tersendiri.
5. Perpindahan pengguna dan lokasi disimpan sebagai riwayat, bukan menimpa data lama.

## Entitas inti

| Entitas | Fungsi | Contoh |
|---|---|---|
| `asset_categories` | Kelompok aset tingkat atas | IT, Kendaraan, Telekomunikasi |
| `asset_classes` | Kelas aset dan target umur standar | Desktop PC (48 bulan), Monitor (60 bulan), Mobil (96 bulan) |
| `assets` | Unit fisik yang dimiliki perusahaan | PC IPASON-001, Monitor IKE-001, mobil B 1234 CAP |
| `asset_specifications` | Spesifikasi fleksibel per aset | RAM 16 GB, IMEI, nomor rangka, kapasitas mesin |
| `asset_bundles` + `asset_bundle_items` | Kelompok unit yang digunakan bersama | Paket PC + monitor milik Koko |
| `employees` | Pemegang/pengguna aset | Koko, Tasya, Adit |
| `locations` | Lokasi hierarkis | Lantai 1 / Office CAP; Lantai 2 / Studio 3 |
| `asset_assignments` | Riwayat penyerahan aset | PC IPASON-001 ke Koko sejak 2025-08-29 |
| `asset_events` | Riwayat servis, rusak, mutasi, disposal | SSD rusak, perbaikan, penghapusan |
| `asset_inventory_sources` | Sumber snapshot inventaris | PDF komputer dan monitor per 29 Agustus 2025 |
| `asset_ledger_lines` | Bukti transaksi perolehan dari buku besar | Tanggal, nomor bukti, uraian, dan nilai debit |
| `asset_ledger_allocations` | Alokasi satu transaksi ke satu atau beberapa Unit Aset | Pembelian dua monitor ke dua kode aset |

## Relasi utama

```text
asset_categories 1---n asset_classes 1---n assets
assets 1---n asset_specifications
assets n---n asset_bundles (via asset_bundle_items)
assets 1---n asset_assignments n---1 employees
assets 1---n asset_assignments n---1 locations
assets 1---n asset_events
asset_inventory_sources 1---n assets
asset_ledger_lines n---n assets (via asset_ledger_allocations)
```

## Aturan bisnis penting

- Kode aset unik, permanen, dan mengikuti pola `AST-{kategori}-{kelas}-{nomor urut}`, misalnya `AST-IT-PC-0001`.
- Hanya boleh ada satu penugasan aktif untuk satu aset (`returned_at IS NULL`). Aset dapat berada di gudang tanpa pengguna.
- `asset_status` membedakan `active`, `in_repair`, `stored`, `lost`, `disposed`, dan `sold`; aset yang berakhir tidak dihapus.
- Umur pemakaian dihitung berurutan dari tanggal mulai pakai, tanggal beli, lalu tanggal inventaris. Sistem menampilkan sumber tanggal tersebut.
- Jika tanggal beli tidak diketahui pada daftar lama, masukkan aset sebagai hasil inventaris dan isi data kemudian tanpa menghapus sumber snapshot.
- `data_quality` menandai data sebagai `verified`, `estimated`, atau `incomplete`, agar data inventaris lama yang belum memiliki serial/tanggal tetap aman untuk dipantau.
- Untuk komputer pada PDF, migrasikan setiap PC dan monitor sebagai aset terpisah. Baris "monitor saja" seperti SPC no. 25 cukup menjadi satu aset kelas Monitor.

## Laporan yang dapat dihasilkan

- Register aset: kode, nama, serial/IMEI/plat, pengguna, lokasi, kondisi, dan status.
- Umur aset dan sisa masa manfaat per tanggal laporan.
- Aset yang mendekati (80%) atau melewati umur target, serta garansi yang akan berakhir.
- Data identitas atau tanggal dasar umur yang belum lengkap.
- Aset per pengguna, lokasi, kategori, dan aset dalam perbaikan.
- Riwayat serah-terima, servis, dan penghapusan.

## Target masa pakai dan akses

Target awal: PC/laptop 48 bulan, monitor 60 bulan, telepon genggam 36 bulan, mobil 96 bulan. Target ini adalah indikator operasional dan dapat diganti pada aset tertentu.

Hak akses mengikuti mekanisme akses per modul yang telah berlaku di CAP; rancangan tidak menambahkan peran aset baru.

## Pelengkapan dari buku besar

Ledger inventaris dimasukkan sebagai bukti perolehan pada `asset_ledger_lines`. Satu transaksi tidak otomatis menjadi satu aset karena dapat memuat beberapa unit, atau barang yang belum ditemukan pada inventaris fisik. Setelah unit fisik diverifikasi, hubungkan melalui `asset_ledger_allocations` dan ubah status rekonsiliasi menjadi `partial` atau `matched`.

Skrip [import_asset_ledger_candidates.sql](sql/import_asset_ledger_candidates.sql) memuat transaksi yang uraian barangnya cukup jelas, seperti komputer, monitor, laptop, handphone, printer, perangkat jaringan, TV, furnitur, dan scanner. Saldo awal dan jurnal `SA` tidak diimpor sebagai unit agar nilai tidak tergandakan.
