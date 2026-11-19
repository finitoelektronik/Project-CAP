# CAP Analytics

CAP Analytics is the internal operational system for warehouse, payroll, returns, and finance records.

## Keputusan HPP Bulanan

**Saldo Awal HPP Bulanan**:
Nilai persediaan pembuka dalam laporan HPP. Untuk Januari, sumbernya hanya baris persediaan pada Jurnal Saldo Awal (`SA_`) tahun berjalan; jurnal rincian saldo awal tidak dijumlahkan lagi. Untuk Februari dan bulan berikutnya, sumbernya adalah saldo stok akhir bulan sebelumnya.
_Avoid_: menjumlahkan jurnal SA agregat dan jurnal rinci saldo awal sekaligus, memakai saldo akhir bulan berjalan sebagai persediaan awal.

**Normalisasi Nomor Bukti Saldo Awal**:
Laporan mengenali nomor bukti SA agregat baik dalam format baru `YYYY/SA_YYYY` maupun format lama `SA YYYY`/`SA/YYYY`. Baris yang memiliki segmen rincian setelah tahun—misalnya `YYYY/SA_YYYY/BJ` atau `SA/YYYY/BJ`—tetap tampil pada Audit semua jurnal, tetapi dikecualikan dari saldo konsolidasi agar tidak menggandakan SA agregat. Nomor bukti asli di database tidak diubah.
_Avoid_: mengubah nomor bukti historis agar cocok dengan aplikasi, atau menjumlahkan SA agregat bersama rincian stoknya.

**Pemetaan Pembelian HPP**:
Daftar rekening tersimpan yang membentuk bagian Pembelian HPP: Pembelian Import, Pembelian Lokal, Pembelian Bahan Penolong, Bea Masuk, Biaya Freight PIB, dan Biaya Asuransi PIB.
_Avoid_: memilih rekening hanya dari kemiripan nama, memasukkan Uang Muka Pembelian atau Pembelian Barang Jadi tanpa pemetaan.

**Cek List PIB**:
Dokumen operasional impor baru yang menghitung nilai impor, bea masuk, PPN, PPh Pasal 22, dan freight dari masukan minimal lalu menyiapkan rangkaian draf jurnal sesuai SOP impor historis. Dokumen ini tidak langsung memposting jurnal; pengguna meninjau dan menekan OK untuk memposting.
_Avoid_: membuat satu jurnal campuran tanpa pemisahan BRM, invoice supplier, dan pembayaran PIB; memposting otomatis tanpa peninjauan pengguna.

**BRM PIB**:
Jurnal penerimaan barang impor yang mendebit rekening persediaan per barang dan mengkredit Pembelian Barang Jadi. BRM tidak menggunakan rekening hutang supplier sebagai kredit lawannya.
_Avoid_: mengkredit hutang supplier langsung dari BRM, menggabungkan nilai persediaan dan pajak PIB dalam satu baris.

**Invoice Impor / HI**:
Jurnal kewajiban pemasok untuk satu PIB yang mendebit Pembelian Import dan Biaya Freight PIB bila ada, serta mengkredit Rekening Hutang Supplier yang telah dipetakan untuk pemasok tersebut.
_Avoid_: memakai rekening hutang umum, mengalokasikan freight ke nilai stok per barang, atau membuat invoice supplier tanpa pemetaan hutang.

**Rekening Hutang Supplier PIB**:
Rekening hutang spesifik yang tersimpan pada master satu supplier dan dipakai sebagai kredit pada Invoice Impor / HI. Supplier tanpa pemetaan rekening hutang tidak dapat diproses sebagai PIB sampai pemetaan dipilih pengguna.
_Avoid_: menebak rekening dari nama supplier yang ambigu, memakai rekening hutang supplier lain.

**Pembayaran PIB**:
Jurnal pembayaran pungutan impor yang mendebit hanya Bea Masuk, PPN, dan PPh Pasal 22 yang bernilai, lalu mengkredit rekening Bank pembayaran. Pembayaran hutang supplier dicatat terpisah ketika supplier benar-benar dibayar, bersama Beda Kurs bila ada.
_Avoid_: membuat baris nominal nol, melunasi hutang supplier secara otomatis pada tanggal PIB, atau mencampurkan pembayaran supplier dengan pembayaran PIB.

**Pembacaan HPP Bertahap**:
Perhitungan laporan HPP dilakukan sesudah pengguna menekan Terapkan melalui agregasi rekening dan snapshot persediaan periode yang diperlukan; seluruh kartu stok per barang tidak dimuat ke layar.
_Avoid_: memuat seluruh kartu stok sebagai prasyarat laporan, menghitung sebelum periode diterapkan.

## Language

**Kontrak Sinosure**:
Satu kontrak induk untuk satu buyer dan satu perusahaan penandatangan Sinosure, yang dapat memuat banyak baris produk atau model.
_Avoid_: satu kontrak per baris produk, kumpulan dokumen tanpa kontrak induk

**Kontrak Tambahan Sinosure**:
Kontrak Sinosure baru yang ditautkan kepada Kontrak Sinosure sebelumnya untuk buyer dan perusahaan penandatangan yang sama.
_Avoid_: menimpa kontrak induk, menambahkan produk baru tanpa jejak kontrak

**Persyaratan Dasar Kontrak Sinosure**:
Kelengkapan awal setelah SO dibuat: MOU yang sudah ditandatangani dan distempel pelanggan, NIB, NPWP, bukti TT, serta Surat Kuasa bila rekening pengirim TT bukan atas nama NPWP dan NIB.
_Avoid_: daftar dokumen generik tanpa aturan Surat Kuasa

**SO Awal**:
Sales order pertama yang memulai kewajiban menyiapkan Persyaratan Dasar Kontrak Sinosure.
_Avoid_: pengingat berdasarkan tenggat kontrak

**Snapshot Verifikasi Sinosure**:
Salinan sumber spreadsheet verifikasi kontrak pada satu tanggal; snapshot terbaru menjadi data aktif sementara snapshot sebelumnya disimpan sebagai riwayat sumber.
_Avoid_: menduplikasi kontrak dari setiap spreadsheet, mengganti sumber tanpa riwayat

**Pengingat Kelengkapan Sinosure**:
Penanda di CAP yang menampilkan jumlah dan daftar Kontrak Sinosure yang Persyaratan Dasar Kontrak Sinosure-nya belum lengkap.
_Avoid_: notifikasi WhatsApp, status tanpa daftar kontrak

**Status Kontrak Sinosure**:
Keadaan Kontrak Sinosure: Aktif, Lengkap, Perlu Revisi, Dibatalkan, atau Digantikan; riwayat kontrak tidak dihapus.
_Avoid_: menghapus kontrak yang tidak berlaku, status lengkap tanpa dokumen

**Tinjau Impor Sinosure**:
Keadaan ketika data pada Snapshot Verifikasi Sinosure berbeda dari data Kontrak Sinosure yang pernah diedit di CAP. Perbedaan tersebut menunggu pilihan admin dan tidak menimpa data otomatis.
_Avoid_: pembaruan impor otomatis, membuang edit CAP

**Relasi Kontrak Tambahan**:
Hubungan Kontrak Tambahan Sinosure terhadap kontrak induknya: Tambahan menjaga induk tetap aktif, sedangkan Pengganti mengubah induk menjadi Digantikan.
_Avoid_: selalu menonaktifkan kontrak induk, kehilangan alasan hubungan antar kontrak

**Perusahaan Penandatangan Sinosure**:
Perusahaan yang menandatangani Kontrak Sinosure, dipilih dari daftar terkelola yang dapat ditambah oleh admin.
_Avoid_: singkatan yang diketik bebas, daftar perusahaan tetap yang tidak dapat diperbarui

**Pengiriman Sinosure**:
Satu baris produk yang dikirim kepada buyer dalam suatu invoice Sinosure. Baris produk dari invoice yang sama berbagi tanggal kirim, nomor invoice, PI, term pembayaran, dan status asuransi.
_Avoid_: satu rekap invoice tanpa rincian produk, baris produk tanpa invoice asal

**Kaitan Code Client Pengiriman**:
Hubungan otomatis antara Pengiriman Sinosure dan Code Client berdasarkan kode L pada nama sheet sumber, dengan nama perusahaan sebagai pemeriksaan kecocokan.
_Avoid_: mencocokkan hanya berdasarkan nama sheet yang dapat berbeda penulisannya

**Pengiriman Belum Terhubung**:
Pengiriman Sinosure yang berhasil diimpor tetapi belum dapat dikaitkan kepada Code Client.
_Avoid_: membuang pengiriman sumber, menebak client tanpa peninjauan

**Hak Akses Sinkronisasi Sinosure**:
Semua pengguna CAP yang telah diberi akses modul Sinosure dapat mengatur sumber dan menjalankan sinkronisasi Sinosure. Akun master hanya menetapkan hak modul serta memantau hasilnya.
_Avoid_: membatasi pengaturan sinkronisasi hanya kepada akun master, memberikan akses sinkronisasi kepada pengguna tanpa akses Sinosure

**Pusat Sinkronisasi Sinosure**:
Submenu tunggal Sinosure yang mengelola sumber serta hasil impor Pengiriman Sinosure, Snapshot Verifikasi Sinosure, dan Dokumen Persyaratan Dasar Kontrak Sinosure. Header Sinosure hanya menyimpan aksi pembuatan Kontrak Sinosure baru.
_Avoid_: tombol navigasi ganda di header dan submenu, sinkronisasi yang hanya melekat pada Pengiriman Sinosure

**Folder Kontrak Sinosure**:
Folder sumber yang mewakili satu buyer atau Kontrak Sinosure dan menjadi aturan utama untuk mengaitkan Dokumen Persyaratan Dasar Kontrak Sinosure dari sumber tersinkron.
_Avoid_: menebak kontrak dari nama file saja, mencantumkan dokumen tanpa kontrak tujuan

**Sumber Sinkronisasi Sinosure**:
Konfigurasi per kategori pada Pusat Sinkronisasi Sinosure. Setiap kategori dapat membaca folder lokal, WeCom API, atau unggah manual secara mandiri.
_Avoid_: satu sumber wajib untuk seluruh kategori, menyamakan sumber file dengan tujuan data

**Tinjau Sinkronisasi Sinosure**:
Antrian file atau data sumber yang tidak dapat dipetakan tepat ke satu tujuan Sinosure dan menunggu keputusan pengguna sebelum disimpan sebagai data aktif atau dokumen kontrak.
_Avoid_: melekatkan file ambigu secara otomatis, membuang file yang belum dapat dipetakan

**Sinkronkan Semua Sinosure**:
Aksi manual yang menjalankan semua kategori sumber yang dipilih. Pengguna juga dapat menjalankan satu kategori secara terpisah.
_Avoid_: sinkronisasi otomatis terjadwal, memaksa semua kategori ketika pengguna hanya membutuhkan satu kategori

**Histori Sumber Sinosure**:
Data dan dokumen yang sudah berhasil masuk CAP tetap dipertahankan apabila file lokal atau WeCom asalnya kemudian hilang; CAP hanya menandai sumber tersebut tidak tersedia.
_Avoid_: menghapus histori CAP karena sumber dihapus, mempertahankan tautan sumber seolah masih tersedia

**Versi Dokumen Sinosure**:
Salinan baru Dokumen Persyaratan Dasar Kontrak Sinosure dari sumber yang telah diperbarui. Versi terbaru menjadi aktif, sementara versi sebelumnya tetap tersimpan sebagai riwayat.
_Avoid_: menimpa berkas lama tanpa jejak, memperlakukan pembaruan sebagai dokumen tak terkait

**Arah Sinkronisasi Sinosure**:
Proses impor membaca sumber folder lokal atau WeCom ke CAP. Proses ekspor kembali ke sumber adalah fitur mandiri dan tidak menjadi dampak otomatis dari perubahan data CAP.
_Avoid_: perubahan CAP yang otomatis menimpa file WeDrive bersama, menyamakan impor dan ekspor

**Ekspor Penggantian Sumber Sinosure**:
Ekspor manual yang menimpa file sumber Sinosure yang telah dipetakan, hanya setelah CAP memastikan sumber tersebut sudah disinkronkan pada versi terbarunya. Setiap ekspor dicatat bersama pengguna dan waktu pelaksanaannya.
_Avoid_: menimpa sumber yang belum disinkronkan, ekspor tanpa jejak audit, pembaruan otomatis tanpa tindakan pengguna

**Ekspor Data Sinosure**:
Ekspor manual Pengiriman Sinosure, daftar Kontrak Sinosure beserta status kelengkapannya, dan Code Client sebagai workbook terpisah. Dokumen Persyaratan Dasar Kontrak Sinosure diekspor sebagai ZIP terstruktur per SO atau kontrak.
_Avoid_: mencampur dokumen biner ke dalam workbook, ekspor seluruh data tanpa pilihan jenis

**Nama Dokumen WeDrive Sinosure**:
Nama salinan dokumen persyaratan yang diunggah dari CAP ke WeDrive menggunakan `{SO atau Nomor Kontrak}_{Jenis Dokumen}_{YYYYMMDD}_v{versi}.{ekstensi}`.
_Avoid_: nama asli tanpa identitas kontrak, penimpaan dokumen versi lama tanpa nomor versi

**Dokumen Perlu Diekspor Sinosure**:
Dokumen persyaratan yang sudah tersimpan di CAP tetapi belum berhasil dikirim ke Folder Kontrak Sinosure di WeDrive. Dokumen tetap tersedia di CAP dan dapat diekspor ulang.
_Avoid_: membuang dokumen karena unggahan WeDrive gagal, menganggap unggahan CAP dan WeDrive selalu berhasil bersamaan

**Berkas Sumber Terpetakan Sinosure**:
Satu berkas sumber yang secara eksplisit dipilih sebagai tujuan ekspor bagi satu kategori Sinosure. Hanya berkas terpetakan tersebut yang dapat ditimpa setelah sinkronisasi terbaru.
_Avoid_: menimpa sembarang berkas dalam folder, menganggap seluruh berkas kategori sama sebagai tujuan ekspor

**Versi Sumber Terkini Sinosure**:
Keadaan ketika ukuran, waktu ubah, dan hash berkas sumber masih sama dengan versi yang terakhir disinkronkan CAP. Hanya kondisi ini yang mengizinkan Ekspor Penggantian Sumber Sinosure.
_Avoid_: menimpa berkas yang berubah di luar CAP, memakai hanya waktu sinkronisasi tanpa memeriksa berkas

**Konflik Sumber Sinosure**:
Perbedaan antara berkas sumber yang berubah di luar CAP dan data terkait yang juga telah diedit di CAP. Pengguna memilih mengambil sumber atau mempertahankan edit CAP; CAP tidak melakukan merge otomatis.
_Avoid_: merge otomatis, menimpa salah satu sisi tanpa pilihan pengguna

**Pemetaan Folder Kontrak Sinosure**:
Hubungan tersimpan antara Kontrak Sinosure dan Folder Kontrak Sinosure di WeDrive. Jika belum tersedia, CAP membuat satu folder bernama `{SO atau Nomor Kontrak}_{Buyer}` saat ekspor dokumen pertama.
_Avoid_: membuat folder baru untuk setiap dokumen, mencari ulang folder hanya dari nama setiap kali ekspor

**Submodul Sinosure Terstruktur**:
Kemampuan impor untuk jenis data Sinosure baru yang ditambahkan secara manual melalui pembaruan aplikasi setelah format serta pemetaannya disepakati. File tanpa submodul terstruktur diperlakukan sebagai Dokumen Lainnya Sinosure, bukan diimpor sebagai tabel.
_Avoid_: menganggap setiap Excel baru dapat diimpor otomatis, membuat pemetaan kolom tanpa persetujuan format

**Riwayat Sinkronisasi Sinosure**:
Jejak permanen pada Pusat Sinkronisasi Sinosure yang mencatat impor, ekspor, konflik, kegagalan unggah, dan percobaan ulang beserta pengguna, waktu, kategori, dan berkasnya.
_Avoid_: log yang dapat dihapus pengguna, status proses tanpa identitas pelaksana atau berkas

**Identitas Pembaruan WeDrive Sinosure**:
Akun WeCom bersama yang digunakan oleh CAP ketika mengunggah atau menimpa berkas WeDrive. WeDrive diharapkan mencatat aktivitas pembaruan berkas atas akun bersama ini seperti aktivitas bawaan WeDrive; CAP tetap menyimpan akun CAP pelaksana pada Riwayat Sinkronisasi Sinosure untuk audit internal. Tidak ada notifikasi CAP atau WeCom tambahan sebagai pengganti aktivitas bawaan tersebut.
_Avoid_: mengklaim bahwa aktivitas bawaan WeDrive akan menampilkan nama akun CAP, menjalankan penggantian berkas tanpa jejak pelaksana di CAP, mengirim notifikasi cadangan

**Laporan Accounting Lite**:
Kumpulan laporan keuangan dan persediaan yang dibaca dari data Accounting Lite: Rekening, Jurnal Transaksi, Jurnal Umum, Buku Besar, Buku Besar Pembantu, Neraca Saldo, Neraca Saldo Penyesuaian, Neraca, Laba Rugi, HPP, Daftar Rekening, dan Kartu Stok Barang.
_Avoid_: laporan baru yang mengubah atau menimpa data historis

**Paket Upgrade Accounting Lite Lengkap**:
Paket pemasangan tanpa database yang mencakup seluruh fungsi operasional Accounting Lite: Dashboard, Rekening, Manajemen, Laporan, Riwayat Stok, Invoicing, ekspor, endpoint backend, serta aset antarmuka yang menjadi dependensinya.
_Avoid_: paket yang hanya membawa tampilan laporan, aset CSS/JavaScript yang tidak ikut dipasang, atau perubahan fungsi Accounting Lite yang hanya bekerja pada aplikasi pengembangan.

**Migrasi Upgrade Accounting Lite Aman**:
Migrasi paket tanpa database yang hanya bersifat aditif dan idempoten: membuat tabel, kolom, atau indeks yang belum ada untuk menjalankan fungsi Accounting Lite. Migrasi ini tidak boleh memperbarui, menghapus, mengonversi, atau memperbaiki data jurnal, rekening, stok, invoice, maupun pemetaan yang telah berada di server lokal.
_Avoid_: membawa berkas database, menjalankan UPDATE/DELETE data operasional, atau menyisipkan koreksi data historis sebagai efek pemasangan modul.

**Pemulihan Bertahap Accounting 2026**:
Proses pemulihan data lokal Accounting Lite yang mempertahankan seluruh data operasional Januari 2026 yang sudah diverifikasi, lalu mengganti seluruh data operasional mulai 1 Februari 2026 sampai tanggal terakhir sumber backup resmi. Rekening, barang, pemasok, dan pelanggan dari sumber hanya ditambahkan apabila belum tersedia; master lokal yang sudah ada tidak ditimpa.
_Avoid_: mengimpor ulang Januari yang telah disepakati, menggabungkan jurnal periode yang sama hingga menggandakan saldo, atau menimpa master lokal tanpa kebutuhan transaksi sumber.

**Pemulihan Konfigurasi Accounting Lite**:
Proses terkendali di server utama yang menyimpan cadangan penuh data audit, mempertahankan jurnal, rekening, stok, dan invoice, lalu membangun ulang konfigurasi laporan serta invoicing berdasarkan kode rekening pada cadangan server. Cutover hanya boleh dilakukan saat akses modul dihentikan dan seluruh pemeriksaan saldo lulus.
_Avoid_: memulihkan database lokal ke server utama, menghapus data audit untuk memperbaiki tampilan laporan, atau mengaktifkan modul sebelum hasil transformasi tervalidasi.

**Modul Accounting Terpisah**:
Modul accounting baru yang dipasang berdampingan dengan Accounting Lite lama pada server utama, tetapi memiliki database accounting sendiri. Kedua modul dapat tampil aktif; data dari Accounting Lite lama hanya menjadi sumber pembentukan awal database modul baru dan tidak dibaca langsung setelah pemisahan.
_Avoid_: dua modul yang menulis tabel accounting yang sama, mengganti database aplikasi utama dengan database lokal, atau menyebut salinan awal sebagai sinkronisasi berkelanjutan.

**Database Awal Modul Accounting Terpisah**:
Salinan awal khusus data Accounting Lite yang diekstrak dari database server utama pada saat cutover. File diagnostik lama hanya dipakai untuk memeriksa struktur, bukan menjadi sumber transaksi. Pengguna dan hak akses tetap milik server CAP utama.
_Avoid_: mengimpor snapshot diagnostik yang sudah tertinggal, menyalin data modul CAP lain, atau menggandakan akun pengguna.

**Batas Histori Modul Accounting Terpisah**:
Data tahun 2021–2025 pada database Accounting terpisah diperlakukan sebagai histori. Tahun 2026 adalah tahun operasional untuk input baru; kedua modul tidak melakukan sinkronisasi otomatis setelah database dipisahkan.
_Avoid_: menyamakan histori dengan input baru, sinkronisasi dua arah antar database, atau mengubah transaksi 2021–2025 untuk kebutuhan operasional baru.

**Pemeriksaan Kelengkapan Accounting Lite**:
Pemeriksaan pascapemasangan yang hanya membaca manifest paket dan file/fungsi Accounting Lite yang terpasang, lalu melaporkan berkas atau versi yang hilang maupun tidak sesuai. Pemeriksaan tidak menjalankan migrasi data dan tidak menulis ke database.
_Avoid_: pemeriksaan yang memperbaiki data secara otomatis, hanya memeriksa status “terpasang” tanpa memeriksa isi paket, atau menyembunyikan ketidaksesuaian berkas.

**Laba Rugi Tahun Berjalan**:
Rekening `03.06` adalah rekening Neraca biasa: bila dipetakan, saldo riilnya dari Buku Besar selalu ditampilkan dan tidak direklasifikasi ke Laba Rugi Ditahan. Nilai Laba/Rugi periode aktif adalah baris hasil khusus tersendiri, tanpa nomor rekening, yang mengambil hasil Laporan Laba Rugi. Jurnal Saldo Awal sumber tidak diubah.
_Avoid_: menyembunyikan atau menimpa saldo rekening `03.06`, mereklasifikasinya otomatis ke rekening lain, menghitungnya sebagai laba periode aktif, atau mengubah jurnal SA demi tampilan laporan

**Baris Hasil Khusus Laporan**:
Baris laporan tanpa nomor rekening yang nilai, nama, kelompok, urutan, dan status tampilnya disimpan pada Pengaturan rekening laporan. Saat ini sumbernya adalah hasil Laporan HPP untuk HPP pada Laba Rugi dan hasil Laba/Rugi periode untuk baris Laba/Rugi Neraca; rekening riil yang dipetakan tetap tidak berubah.
_Avoid_: memakai saldo satu rekening untuk hasil yang seharusnya dihitung oleh laporan lain, menghapus rekening asli demi membuat baris hasil, atau menyimpan hasil laporan kembali ke jurnal

**Saldo Normal Neraca**:
Konvensi tampilan Neraca: Aktiva mengikuti sisi Debit dan Pasiva mengikuti sisi Kredit. Saldo pada sisi normal ditampilkan positif; saldo yang berlawanan dengan sisi normal ditampilkan negatif. Konvensi ini hanya untuk pembacaan Neraca, LK bulanan, dan ekspornya—jurnal serta persamaan Neraca tetap menggunakan Debit dikurangi Kredit.
_Avoid_: membalik jurnal sumber, mengubah total pengendalian Neraca hanya demi tampilan, atau menampilkan saldo debit Pasiva sebagai saldo normal positif

**Basis Neraca Bulanan**:
Neraca setiap bulan adalah saldo konsolidasi dari awal tahun buku sampai tanggal akhir bulan pilihan. Kolom Neraca “S.D Bulan Lalu” memakai saldo penutup akhir bulan sebelumnya, termasuk untuk Januari yang memakai posisi 31 Desember tahun sebelumnya. Laba Rugi dan HPP tetap membaca mutasi periode sehingga Januari keduanya dimulai dari nol.
_Avoid_: menggunakan hanya mutasi bulan sebagai saldo Neraca, mengambil hanya transaksi Desember untuk pembanding Januari, atau mengubah basis Laba Rugi/HPP menjadi saldo kumulatif Neraca

**Penanda D/K Laporan**:
Kolom tampilan yang menyatakan sisi nominal suatu baris jurnal: `D` bila hanya Debit bernilai, `K` bila hanya Kredit bernilai, dan kosong bila keduanya nol. Kolom ini hanya ada pada laporan per baris yang mewakili satu sisi jurnal; laporan ringkasan yang sudah menampilkan nominal Debit dan Kredit sekaligus tidak memakai kolom D/K. Penanda ini tidak mengubah nominal, saldo, maupun jurnal sumber dan digunakan pula pada ekspor Excel laporan yang sama.
_Avoid_: menentukan sisi dari tanda saldo positif/negatif, menambahkan D/K ke ringkasan dua sisi, mengubah nilai jurnal untuk keperluan tampilan

**Kartu Stok Barang**:
Laporan per barang dan periode yang menunjukkan saldo awal, mutasi pembelian, mutasi penjualan, serta saldo akhir dalam unit dan nilai.
_Avoid_: ringkasan jurnal tanpa identitas barang

**Daftar Stok dan Harga**:
Laporan persediaan periodik untuk seluruh barang. Laporan menampilkan barang dengan saldo positif, nol, maupun minus pada tanggal akhir periode; setiap barang memperlihatkan lapisan harga FIFO yang masih tersedia beserta subtotal unit dan nilainya. Tahun, bulan, dan rentang tanggal memakai klasifikasi laporan Accounting Lite yang sama.
_Avoid_: satu harga rata-rata yang menyembunyikan harga batch FIFO, daftar yang hanya menampilkan barang yang bergerak pada periode tersebut

**HPP Historis**:
Laporan harga pokok penjualan yang menggunakan nilai dan harga per unit dari transaksi Brain Accounting yang dimigrasikan, tanpa menghitung ulang nilai historis.
_Avoid_: mengganti nilai historis dengan kalkulasi rata-rata baru

**HPP Transaksi Baru**:
Nilai harga pokok penjualan untuk transaksi yang dicatat setelah Accounting Lite aktif, dihitung dengan metode FIFO dari batch persediaan yang masuk paling awal dan masih tersisa.
_Avoid_: menerapkan ulang metode baru kepada transaksi historis, mencampur FIFO dengan rata-rata tertimbang dalam satu transaksi

**Batch Persediaan FIFO**:
Sisa kuantitas dan biaya satu penerimaan barang baru. Penjualan mengonsumsi batch yang paling awal masuk terlebih dahulu; satu penjualan dapat mengambil lebih dari satu batch bila stok batch pertama tidak cukup.
_Avoid_: mengurangi persediaan tanpa jejak batch, memakai batch terbaru lebih dahulu

**Alokasi FIFO Dokumen Multi-Baris**:
Alokasi Batch Persediaan FIFO dalam satu dokumen transaksi berjalan berurutan menurut urutan baris, termasuk ketika Barang yang sama muncul pada lebih dari satu baris dengan harga jual berbeda. Ketersediaan diperiksa terhadap akumulasi seluruh baris, sedangkan harga jual dan alokasi tiap baris tetap tersimpan terpisah.
_Avoid_: memakai kembali batch yang sama pada dua baris sebelum pengurangan dicatat, menggabungkan harga jual baris yang berbeda, menolak dokumen yang totalnya masih berada dalam stok tersedia

**Referensi Stok Terakhir**:
Informasi bantu per baris barang pada transaksi Barang Masuk dan Barang Keluar yang menampilkan batch barang masuk paling awal yang masih tersedia—tanggal masuk, kuantitas tersisa, dan harga per unit—tanpa mengubah harga yang sedang diinput pengguna. Referensi batch ditempatkan di bawah pilihan barang. Total stok aktif ditampilkan tepat di bawah input harga sebagai jumlah unit barang tersebut, tanpa nilai total persediaan. Pada Barang Keluar, harga tersebut hanya referensi; HPP tetap memakai batch FIFO paling lama.
_Avoid_: mengisi harga otomatis tanpa persetujuan pengguna, menyamakan batch terbaru dengan urutan pengeluaran FIFO

**Pembelian Barang Baru**:
Transaksi penerimaan barang yang menambah batch FIFO dan mendebit rekening Persediaan barang. Pembayaran Tunai/Bank mengkredit rekening kas atau bank yang dipilih; pembelian Hutang Supplier mengkredit rekening hutang dan menyimpan supplier sebagai pihak transaksi.
_Avoid_: mencatat pembelian sebagai jurnal dan mutasi stok yang terpisah, hutang tanpa supplier

**Penyesuaian Stok Baru**:
Mutasi tambah atau kurang stok untuk opname, rusak, hilang, atau koreksi. Alasan dan rekening lawan wajib dicatat. Tambah stok mendebit Persediaan; kurang stok mengkredit Persediaan.
_Avoid_: mengubah saldo stok tanpa alasan atau tanpa jurnal lawan yang balance

**Penjualan Barang Baru**:
Dokumen multi-barang yang dibayar Tunai atau Bank pada tahap awal. Setiap dokumen mengurangi batch FIFO, mendebit rekening lawan, mengkredit Pendapatan Penjualan, serta membentuk baris HPP dan Persediaan yang seimbang dalam nomor bukti yang sama.
_Avoid_: penjualan kredit tanpa pelanggan atau piutang, mutasi stok tanpa jurnal HPP dan Persediaan

**Invoice Penjualan**:
Dokumen penjualan kredit multi-barang untuk satu pelanggan atau toko. Invoice wajib memiliki nomor invoice dan dipetakan ke satu rekening anak Piutang Dagang. Setelah pengguna meninjau rancangan jurnal dan mutasi stok, penyimpanan final membentuk Piutang sebesar DPP ditambah PPN, Pendapatan Penjualan sebesar DPP, Hutang PPN sebesar PPN, serta mutasi FIFO dan jurnal HPP/Persediaan yang terkait.
_Avoid_: memosting tanpa rekening Piutang pelanggan, membentuk jurnal atau pengeluaran stok sebelum tinjauan pengguna, mencatat nilai Piutang tanpa PPN

**Nomor Seri Faktur Pajak Invoice**:
Nomor faktur pajak pada Invoice Penjualan yang dapat dilengkapi setelah invoice dibuat. Invoice tanpa nomor seri diberi penanda terbuka dan tetap dapat dipratinjau atau disimpan sesuai statusnya.
_Avoid_: menganggap nomor seri kosong sebagai nomor invoice, menyembunyikan invoice yang nomor serinya belum tersedia

**Invoice Historis dan Draf Invoice**:
Invoice historis hanya menautkan detail barang yang direkonsiliasi ke jurnal penjualan yang telah ada; ia tidak boleh membuat atau mengubah jurnal maupun mutasi stok historis. Invoice baru disimpan sebagai draf terlebih dahulu dan baru membentuk jurnal Piutang/Penjualan/PPN serta mutasi FIFO saat pengguna melakukan penyimpanan final.
_Avoid_: menggandakan jurnal lama, mengurangi stok dari invoice historis, atau memosting invoice baru tanpa tahap tinjau.

**Klasifikasi Khusus Piutang Jakarta**:
Kelompok laporan yang diberi nama pengguna dan memuat satu atau lebih nama toko yang berbeda. Contohnya klasifikasi Verdo memuat toko JAYA MANDIRI dan PD. JAYA MANDIRI. Semua invoice tetap diekspor ke sheet bulan invoice; invoice toko anggota juga diekspor ke sheet klasifikasi khusus yang memuat seluruh riwayat kelompok tersebut. Satu toko hanya dapat menjadi anggota satu klasifikasi khusus pada satu waktu.
_Avoid_: menentukan klasifikasi hanya dari kesamaan kata pada nama toko, membuat satu klasifikasi untuk setiap variasi nama toko, atau menghapus transaksi toko khusus dari sheet bulan.

**Penanda Pembayaran Piutang Jakarta**:
Baris invoice kuning pada workbook sumber berarti pembayaran telah cair, termasuk giro yang tercatat pada baris tersebut. Catatan pembayaran dicetak pada kolom Keterangan. Satu pembayaran bernama dapat mengalokasikan beberapa invoice kuning secara berurutan pada toko yang sama.
_Avoid_: memakai warna kuning sebagai penanda klasifikasi toko, menunggu konfirmasi cair tambahan untuk giro yang sudah kuning, atau membuat pembayaran ganda untuk kelompok nota yang sama.

**Potongan Retur Piutang Jakarta**:
Catatan `Pot. R.` yang mengikuti kelompok invoice dicatat sebagai rincian retur—nama barang, nilai, teks sumber, sheet, dan baris—serta mengurangi piutang invoice sebelum sisa dihitung. Bila nilai retur melampaui nilai invoice, rincian tetap disimpan tetapi tidak otomatis menghapus invoice lain; kredit tersebut memerlukan alokasi yang dapat ditelusuri.
_Avoid_: menghitung baris total retur dan rincian barangnya dua kali, menyembunyikan nama barang retur, atau membiarkan potongan membuat saldo piutang negatif.

**Tahun Laporan Piutang Jakarta**:
Tahun yang dipilih pengguna untuk sheet bulanan JAN sampai DES. Tahun awal laporan adalah 2026 agar mengikuti workbook sumber. Sheet klasifikasi khusus tidak dibatasi tahun dan memuat seluruh riwayat toko anggotanya.
_Avoid_: menghilangkan bulan tanpa transaksi, mencampur tahun lain ke sheet bulan laporan, atau membatasi riwayat klasifikasi khusus pada tahun laporan.

**Rekening Barang Aktif**:
Tiga rekening posting yang wajib dipetakan pada barang baru sebelum dipakai dalam transaksi: Persediaan, Pendapatan Penjualan, dan HPP. Rekening Kas/Bank, Hutang Supplier, atau rekening lawan penyesuaian dipilih pada dokumennya.
_Avoid_: memakai label pemetaan historis Brain sebagai aturan otomatis tanpa peran yang jelas

**Master Barang dan Supplier Terhubung**:
Barang dan Supplier mempertahankan kode permanen sebagai pengenal semua transaksi, stok, dan jurnal. Pengguna dengan akses Accounting dapat memperbarui nama, klasifikasi, pemetaan rekening, alamat, asal, dan keterangan; semua tampilan yang merujuk kode tersebut memakai informasi master terbaru. Kuantitas, harga, alokasi FIFO, dan nilai jurnal yang sudah tercatat tidak berubah.
_Avoid_: mengubah kode master yang telah dipakai, memutus relasi dokumen historis, atau menulis ulang nilai transaksi ketika metadata master diperbarui

**Sisipan Mutasi FIFO**:
Transaksi stok operasional boleh dicatat pada tanggal yang berada di antara mutasi stok yang telah ada. Sistem menghitung ulang batch, alokasi FIFO, nilai persediaan, dan HPP seluruh mutasi operasional sesudah titik sisipan; histori impor tetap hanya-baca.
_Avoid_: menolak tanggal mundur hanya karena ada mutasi yang lebih baru, membiarkan stok negatif pada titik waktu mana pun, atau mengubah nilai histori impor

**Koreksi Mutasi FIFO**:
Dokumen stok operasional yang telah tersimpan dapat diubah atau dihapus, termasuk tanggal, jenis, rekening lawan, pihak, nomor bukti, dan baris barangnya. Koreksi berlaku atomik dengan membangun ulang FIFO dan jurnal operasional; dokumen impor serta saldo FIFO sistem tidak dapat dikoreksi.
_Avoid_: membatasi koreksi hanya pada mutasi terakhir, mengubah dokumen lama tanpa menghitung ulang transaksi sesudahnya, atau memperbolehkan koreksi histori impor

**Urutan Mutasi Tanggal Sama**:
Mutasi stok dengan tanggal yang sama diurutkan menurut identitas penyimpanan dokumen yang menaik. Transaksi yang baru dicatat ditempatkan setelah mutasi yang telah ada pada tanggal tersebut.
_Avoid_: urutan acak pada tanggal sama, mengubah urutan histori yang sudah tersimpan

**Rekening Persediaan dan HPP Terlindungi**:
Rekening yang dipetakan pada Barang Aktif tidak dapat dipakai oleh Jurnal Baru biasa. Nilainya hanya berubah melalui Pembelian Barang, Penjualan Barang, atau Penyesuaian Stok.
_Avoid_: buku besar dan Kartu Stok yang tidak dapat direkonsiliasi

**Buku Besar Pembantu**:
Tampilan Buku Besar terbatas untuk satu Rekening Piutang Dagang atau Hutang Dagang yang dipilih pengguna. Jenis Piutang berasal dari jalur Piutang Dagang; Jenis Hutang berasal dari jalur Hutang Dagang Lokal atau Hutang Dagang Import, masing-masing termasuk seluruh turunannya. Mutasi, saldo berjalan, dan ekspor memakai logika Buku Besar untuk rekening tersebut. Tidak ada mutasi maupun saldo dimuat sebelum rekening dipilih.
_Avoid_: memilih Hutang Bank, Hutang Pajak, atau hutang lain di luar dua jalur dagang; memuat seluruh mutasi tanpa rekening tujuan; memperlakukan laporan ini sebagai daftar supplier; menghitung saldo gabungan dari banyak rekening

**Jurnal Penyesuaian**:
Jurnal yang diberi jenis Penyesuaian pada saat pencatatan baru, atau yang sudah memiliki penanda tipe atau nomor bukti penyesuaian pada data Brain Accounting historis. Jurnal ini digunakan untuk Neraca Saldo Penyesuaian.
_Avoid_: menganggap semua jurnal akhir tahun sebagai penyesuaian

**Jurnal Saldo Awal (`SA_`)**:
Jurnal pembuka pada 1 Januari yang membawa saldo penutup tahun sebelumnya ke periode baru, dengan nomor bukti yang memuat `SA_` dan tahun sebelumnya. Jurnal ini ditampilkan sebagai mutasi pertama Januari, sementara saldo awal laporan Januari bernilai nol.
_Avoid_: menyembunyikan jurnal `SA_`, atau menjumlahkan `SA_` sebagai saldo awal dan mutasi sekaligus

**Saldo Berjalan Accounting**:
Nilai Buku Besar yang memakai sisi jurnal pembuka tahun sebagai dasar: Jurnal Saldo Awal (`SA_`) bila ada, atau jurnal bernilai pertama bila rekening tidak memiliki SA. Bila dasar Kredit, mutasi Debit mengurangi nilainya; bila dasar Debit, mutasi Kredit mengurangi nilainya. Nilai minus hanya berarti mutasi lawan telah melampaui saldo dasar, bukan penanda sisi Debit atau Kredit.
_Avoid_: menyimpulkan sisi saldo dari tanda positif atau negatif, mengubah perhitungan jurnal untuk keperluan tampilan

**Saldo Awal Tampilan**:
Nominal serta sisi Debit atau Kredit yang disimpan pada Rekening Master untuk membantu membaca arah positif atau negatif pada Buku Besar. Ini adalah metadata tampilan: tidak membuat jurnal, tidak membutuhkan rekening lawan, dan tidak mengubah total debit maupun kredit transaksi.
_Avoid_: menganggap saldo awal tampilan sebagai jurnal pembuka, menjadikannya sumber perubahan nilai transaksi

**Rekening Master**:
Pemetaan rekening tunggal yang menjadi sumber nama, kelompok, induk, dan status posting untuk seluruh jurnal serta laporan. Kode rekening adalah identitas relasional permanen dan tidak dapat diubah; perubahan atribut master berlaku saat seluruh data terkait ditampilkan.
_Avoid_: mengubah kode rekening, menganggap baris Buku Besar sebagai master rekening

**Kelompok Rekening Kosong**:
Pilihan kelompok `Tidak digunakan pada laporan` untuk rekening yang tetap dipakai sebagai pemetaan, jurnal, atau Buku Besar tetapi sengaja tidak dicantumkan pada Neraca Saldo, Neraca Saldo Penyesuaian, Neraca, Laba Rugi, maupun HPP.
_Avoid_: menghapus rekening yang masih menjadi relasi transaksi, memasukkan rekening tanpa kelompok ke laporan klasifikasi

**Otoritas Edit Rekening Master**:
Hak akses khusus `accounting_account_edit` yang diberikan melalui Kelola Pengguna. Hanya akun master atau pengguna yang memperoleh hak ini dapat menambah maupun mengubah rekening master, termasuk rekening historis.
_Avoid_: menganggap akses Cahaya Accounting biasa sebagai izin edit, membuka endpoint perubahan tanpa pemeriksaan otoritas

**Riwayat Perubahan Rekening**:
Jejak hanya-baca atas perubahan rekening master yang menyimpan nilai sebelum dan sesudah, pelaksana, serta waktu perubahan. Perubahan yang membentuk induk-silang tidak diizinkan.
_Avoid_: perubahan tanpa audit, siklus hubungan induk-anak

**Tutup Buku Historis**:
Status hanya-baca untuk tahun 2021--2024 yang dibuktikan oleh keberadaan Jurnal Saldo Awal pada tahun berikutnya. Tahun historis tersebut tidak boleh diajukan ulang, diaudit ulang, atau menghasilkan Jurnal Saldo Awal kedua.
_Avoid_: menganggap tahun historis masih terbuka atau membuat jurnal SA ganda

**Rekening Pembawa SA Historis**:
Rekening yang tercatat pada Jurnal Saldo Awal tahun berikutnya dan karena itu diakui sebagai rekening pembawa saldo untuk tahun asalnya. Dasarnya adalah baris jurnal SA historis, bukan `account_type`, karena klasifikasi rekening impor lama tidak selalu konsisten.
_Avoid_: menentukan pembawa SA historis hanya dari kelompok Neraca, HPP, atau Laba-Rugi yang mungkin salah klasifikasi

**Rekening Tanpa SA Historis**:
Rekening saldo akhir yang tidak tercatat pada Jurnal Saldo Awal tahun berikutnya. Di tabel Tutup Buku rekening ini berada paling atas, berlatar merah, dan nilai revisinya dimulai dari nol agar dapat diperiksa atau diubah bila merupakan pengecualian yang sah.
_Avoid_: menyembunyikan rekening tersebut, atau membawanya otomatis tanpa tinjauan

**Tutup Buku Accounting**:
Proses akhir tahun yang menutup saldo rekening Pendapatan, Biaya, dan HPP ke `03.04.00.00.00.0000 — LABA RUGI DITAHAN`, lalu membawa rekening Neraca melalui Jurnal Saldo Awal ke 1 Januari tahun berikutnya.
_Avoid_: membawa akun laba-rugi sebagai saldo tahun berikutnya, jurnal SA ganda

**Revisi Saldo Tutup Buku**:
Nilai saldo akhir pengganti per rekening yang diisi pada pengajuan Tutup Buku. Bila kosong, sistem memakai saldo hasil perhitungan tahun buku; nilai yang dipakai terlihat langsung pada daftar saldo.
_Avoid_: menyimpan hanya selisih tanpa nilai akhir yang dapat diperiksa, mengganti saldo tanpa jejak pengajuan

**Pengajuan Audit Tutup Buku**:
Keadaan ketika pengguna mengirim daftar saldo akhir tahun, termasuk Revisi Saldo Tutup Buku, untuk ditinjau akun master. Pengajuan belum membuat jurnal Tutup Buku atau Jurnal Saldo Awal.
_Avoid_: membuat jurnal keuangan saat pengajuan, menutup tahun tanpa persetujuan master

**Audit Tutup Buku**:
Keputusan akun master atas Pengajuan Audit Tutup Buku: disetujui untuk membuat jurnal Tutup Buku dan Jurnal Saldo Awal, atau dikembalikan kepada pengaju dengan alasan revisi.
_Avoid_: persetujuan tanpa jejak auditor, penolakan tanpa alasan yang dapat ditindaklanjuti

**Keseimbangan Pengajuan Tutup Buku**:
Jumlah debit dan kredit dari seluruh saldo akhir, setelah Revisi Saldo Tutup Buku diterapkan, wajib sama. Pengajuan tidak dapat dikirim maupun disetujui bila tidak balance.
_Avoid_: selisih otomatis ke akun tersembunyi, membuat SA yang tidak balance

**Hak Revisi Tutup Buku**:
Semua pengguna dapat menyusun dan mengajukan Tutup Buku. Setelah diajukan, pengajuan terkunci; hanya pengaju dapat mengubahnya kembali setelah Audit Tutup Buku mengembalikannya untuk revisi. Akun master mengaudit tanpa mengubah nilai pengaju.
_Avoid_: master mengubah angka tanpa jejak pengaju, pengajuan yang tetap dapat berubah saat diaudit

**Kunci Jurnal Tahunan**:
Pengaturan akun master per tahun jurnal umum/manual. Tahun yang ditandai terkunci tidak dapat diedit atau dihapus oleh pengguna mana pun; tahun yang tidak ditandai dapat diedit atau dihapus oleh seluruh pengguna setelah konfirmasi. Jurnal transaksi stok dan jurnal tutup buku tetap terlindungi agar FIFO dan saldo awal tetap konsisten.
_Avoid_: membuka jurnal stok atau tutup buku sebagai jurnal umum, menerapkan penguncian hanya pada tampilan tanpa pemeriksaan server

**Arsip Penghapusan Jurnal**:
Jurnal umum/manual yang dihapus pada tahun terbuka tidak lagi memengaruhi laporan, tetapi tetap disimpan bersama informasi penghapusan agar dapat ditelusuri dan dipulihkan.
_Avoid_: menghapus bukti tanpa jejak audit, memasukkan jurnal yang diarsipkan ke saldo laporan

**Dashboard Kejanggalan Accounting**:
Ringkasan snapshot akhir tahun yang menampilkan saldo rekening, hutang dan piutang belum selesai, serta jurnal tidak balance, stok minus, dan barang dengan pemetaan rekening belum lengkap.
_Avoid_: laporan mutasi harian, status audit tanpa sumber transaksi

**Laporan Tahunan Accounting**:
Laporan yang menghitung posisi dan kinerja keuangan untuk satu tahun atau satu bulan langsung dari rekening, jurnal, transaksi stok FIFO, serta data pihak CAP. Susunannya mengikuti Catatan Atas Laporan Keuangan: aktiva lancar, aktiva tetap neto, kewajiban, modal dan laba ditahan, laba tahun berjalan, penjualan, HPP, biaya umum dan administrasi, penghasilan atau beban lain-lain, serta pajak penghasilan. PDF tahunan digunakan sebagai pembanding, bukan sumber nominal tetap. Selisih pembulatan ditampilkan pada suatu kelompok hanya bila subtotal laporan berbeda dari jumlah rinciannya.
_Avoid_: menyalin nominal PDF sebagai nilai tetap, memakai saldo rekening tanpa klasifikasi laporan, atau mengubah jurnal saat laporan dibuka

**Catatan Atas Laporan Keuangan**:
Bentuk rinci Laporan Tahunan Accounting yang menampilkan urutan catatan, narasi, rincian saldo, subtotal, dan informasi pendukung sebagaimana laporan keuangan tahunan. Dashboard menampilkan bentuk responsifnya, sedangkan ekspor Excel memakai susunan yang sama dalam bentuk siap-cetak.
_Avoid_: memaksa tata letak kertas ke layar kecil, memakai angka ekspor yang berbeda dari dashboard, atau menjadikan laporan bulanan sebagai catatan tahunan

**Pengaturan Catatan Atas**:
Data pendukung yang tidak berasal dari jurnal atau stok, seperti identitas entitas pelapor, nomor rekening bank lengkap, klasifikasi narasi, parameter pajak, serta informasi penandatangan. Identitas dan metadata rekening berlaku global; narasi, parameter pajak, tanggal, lokasi, serta penandatangan berlaku per tahun. Hanya akun master yang dapat mengubahnya. Data ini melengkapi Catatan Atas Laporan Keuangan tanpa mengganti nominal yang dihitung CAP.
_Avoid_: memasukkan nominal jurnal secara manual, menyalin isi PDF lama sebagai angka tetap, atau mencampurkan data pendukung dengan transaksi akuntansi

**Kelompok Catatan Persediaan**:
Label Catatan Atas yang melekat pada rekening persediaan, misalnya `Persediaan Barang Jadi` atau `Persediaan Bahan Penolong`. Label ini mengelompokkan rincian persediaan pada laporan tanpa mengubah Jenis Barang maupun histori transaksi.
_Avoid_: mengubah jenis barang lama hanya untuk tampilan laporan, mengelompokkan persediaan berdasarkan nama barang bebas, atau memindahkan nominal antar rekening

**Laporan Keuangan Bulanan Accounting**:
Pilihan Bulan pada Laporan Tahunan Accounting. Neraca dan stok memakai saldo atau posisi sampai hari terakhir bulan terpilih, sedangkan Laba Rugi dan HPP hanya memakai mutasi dalam bulan tersebut. Pilihan `Semua bulan` tetap menghitung satu tahun penuh.
_Avoid_: menghitung Neraca sebagai mutasi satu bulan, menjumlahkan Laba Rugi bulan terpilih sejak Januari, atau mengubah jurnal saat laporan dibuka

**Dashboard Laporan Tahunan**:
Halaman utama laporan tahunan yang menggantikan Dashboard Tutup Buku dan Kejanggalan. Halaman ini hanya membaca data; pengajuan audit maupun tindakan Tutup Buku tidak ditampilkan di dalamnya.
_Avoid_: mencampurkan alur audit atau aksi penutupan tahun dengan pembacaan laporan tahunan

**Rekening Belum Dipetakan Laporan Tahunan**:
Rekening bersaldo yang tidak dapat ditempatkan pada kelompok laporan tahunan tetap ditampilkan dalam kelompok `Belum dipetakan`, bersama kode dan namanya, tanpa disatukan ke subtotal resmi.
_Avoid_: menyembunyikan rekening bersaldo atau memasukkannya ke subtotal laporan tanpa pemetaan yang eksplisit

**Ekspor Laporan Tahunan**:
Workbook Excel satu sheet utama yang mengikuti urutan, rincian, subtotal, dan selisih pembulatan pada Dashboard Laporan Tahunan, baik untuk satu tahun maupun satu bulan. Nilai ekspor berasal dari perhitungan yang sama dengan layar, bukan salinan PDF.
_Avoid_: ekspor dengan rumus atau klasifikasi yang berbeda dari dashboard, atau sheet terpisah yang mengubah subtotal utama

**Input Nominal Rupiah**:
Kolom nominal yang dapat diubah di Accounting Lite menampilkan pemisah ribuan Indonesia dan dua desimal saat pengguna mengetik atau menempel nilai, tanpa prefiks `Rp` di dalam kolom.
_Avoid_: menyimpan teks berformat sebagai nominal, format yang hanya muncul setelah kolom kehilangan fokus

**Total Laporan**:
Ringkasan nilai pada akhir ekspor Accounting Lite. Laporan debit/kredit harus menunjukkan total debit, total kredit, dan status Balance; laporan bersaldo menunjukkan saldo akhir atau total saldo yang relevan.
_Avoid_: ekspor nominal tanpa total yang dapat direkonsiliasi

**Pemuatan Laporan Tertunda**:
Keadaan awal laporan Accounting Lite saat belum ada permintaan data. Sistem hanya menampilkan pilihan periode dan baru membaca data setelah pengguna menekan Terapkan.
_Avoid_: membaca seluruh tahun secara otomatis ketika sebuah tab laporan dibuka

**Pemilih Laporan**:
Dropdown pada menu Laporan yang memilih tepat satu dari sebelas laporan Accounting Lite sebelum data dibaca. Mengganti pilihan mengosongkan hasil yang sedang tampil; laporan baru hanya dibaca setelah pengguna menekan Terapkan.
_Avoid_: membuka beberapa laporan sekaligus, atau menjalankan query saat pilihan dropdown berubah

**Manajemen Accounting Lite**:
Menu master data di antara Rekening dan Laporan, berisi Manajemen Barang serta Manajemen Supplier. Data yang dimigrasikan dari Brain Accounting hanya dapat dibaca; data baru disimpan terpisah dan dapat diperbarui.
_Avoid_: mengubah atau menimpa barang dan supplier historis

**Form Barang dan Pencarian Barang**:
Barang baru dicatat dengan kode manual, nama, jenis, dan empat pemetaan rekening: persediaan serta pembelian untuk transaksi pembelian, HPP serta pendapatan untuk transaksi penjualan. Pencarian barang menerima kode atau nama dan memilih satu barang dari hasil terbatas, sama seperti pencarian rekening.
Jenis Barang adalah pilihan baku: Bahan Baku, Barang dalam Proses, atau Barang Jadi.
_Avoid_: memakai select native yang memuat seluruh daftar sebagai alat pencarian, memilih barang tanpa menyimpan kode barangnya, mencampur rekening pembelian dan penjualan, menyimpan variasi ejaan jenis barang

**Panel Detail Manajemen**:
Panel informasi lengkap untuk satu Barang atau Supplier yang dipilih dari daftar ringkas kode dan nama. Pada desktop tampil di sebelah kanan daftar; pada layar sempit ditempatkan setelah daftar.
_Avoid_: menaruh seluruh detail pada tabel daftar sehingga sulit dipindai

**Halaman Laporan Transaksi**:
Satu kelompok maksimal 200 baris yang ditampilkan untuk tabel transaksi besar. Pengguna dapat memuat halaman berikutnya tanpa mengirim seluruh data historis ke browser.
_Avoid_: mengirim puluhan ribu baris dalam satu respons

**Periode Tersimpan Belum Diterapkan**:
Pilihan tahun, bulan, atau rentang tanggal yang tetap terlihat saat pengguna berpindah submenu laporan, tetapi tidak otomatis memicu pembacaan data. Submenu baru menjadi aktif hanya setelah pengguna menekan Terapkan.
_Avoid_: mengosongkan pilihan periode yang masih relevan, memuat laporan hanya karena pengguna berpindah tab

**Kas Kecil**:
A finance submodule that records individual operational cash expenditures using a date, category, person, source reference number, description, and amount.
_Avoid_: petty-cash balance, reimbursement

**Transaksi Kas Kecil**:
One expenditure record imported from a source spreadsheet or entered manually. Its source number is informational and may be empty or repeated.
_Avoid_: unique invoice, ledger row

**Kategori Kas Kecil**:
A controlled label for the purpose of a cash expenditure, including PDAM, ATK, BBM, gaji, gudang, listrik, packing, perawatan kendaraan, lakban, bubble, ekspedisi, entertain, wifi, online, KBKB, isi ulang galon, rumah tangga, parkir, and Lainnya.
_Avoid_: arbitrary tag

**Stok Kebutuhan Kantor**:
Submodul mandiri di Keuangan untuk mencatat master barang habis pakai kantor, penerimaan, penggunaan, harga satuan, nilai, dan saldo stok. Data awal dapat memuat daftar barang serta saldo dari kartu stok kantor. Submodul ini tidak membuat, mengubah, atau bergantung pada transaksi Kas Kecil, Accounting Lite, maupun modul lain.
_Avoid_: mutasi stok otomatis dari transaksi modul lain, saldo yang berbagi sumber dengan modul lain

**Harga Penggunaan Stok Kantor**:
Harga satuan yang menjadi nilai bawaan ketika penggunaan stok dicatat. Nilai awal mengambil harga beli terakhir dari barang yang bersangkutan, tetapi pengguna dapat menggantinya sebelum transaksi disimpan.
_Avoid_: harga rata-rata otomatis, harga penggunaan yang tidak dapat dikoreksi pengguna

**Koreksi Transaksi Stok Kantor**:
Perubahan langsung pada transaksi penerimaan atau penggunaan stok kantor yang belum sesuai. Saldo dan nilai barang dihitung ulang berdasarkan transaksi versi terbaru.
_Avoid_: transaksi penyesuaian wajib untuk kesalahan input biasa, riwayat transaksi yang tidak dapat diperbaiki

**Penggunaan Stok Kantor**:
Transaksi barang keluar dari Stok Kebutuhan Kantor. Laporan penggunaan menghitung unit sebagai metrik utama dan nilai penggunaan sebagai metrik pendukung; penerimaan barang tidak dihitung sebagai penggunaan.
_Avoid_: menyatukan barang masuk dengan penggunaan, menilai penggunaan hanya dari saldo akhir

**Laporan Penggunaan Tahunan Stok Kantor**:
Laporan penggunaan Stok Kebutuhan Kantor yang membandingkan Januari hingga Desember dalam satu tahun yang dipilih. Laporan dapat ditampilkan untuk seluruh barang atau satu barang tertentu, dengan rincian per barang serta total unit dan nilai penggunaan.
_Avoid_: perbandingan antar-tahun tanpa pilihan pengguna, bulan tanpa transaksi yang disembunyikan, ekspor yang mengabaikan filter barang

**Tampilan Stok Kebutuhan Kantor**:
Tiga tampilan eksklusif dalam Stok Kebutuhan Kantor: Saldo Terkini, Riwayat Mutasi, dan Laporan Penggunaan. Hanya satu tampilan aktif pada satu waktu; aksi tambah barang, barang masuk, dan catat penggunaan tetap tersedia di bagian atas.
_Avoid_: panel stok yang tampil bersamaan, aksi pencatatan yang hanya tersedia pada satu tampilan

**Kartu Stok Bulanan Kantor**:
Rincian seluruh barang pada satu bulan dan tahun terpilih di Laporan Penggunaan. Kartu memperlihatkan saldo sebelum hari pertama periode, total pemasukan dan pengeluaran selama periode, serta saldo akhir dalam unit dan nilai. Barang tanpa mutasi tetap ditampilkan dengan nilai nol.
_Avoid_: saldo awal yang hanya menghitung mutasi bulan berjalan, menyembunyikan barang tanpa mutasi, saldo akhir yang tidak merekonsiliasi pemasukan dan pengeluaran

**Dashboard Pengeluaran Perusahaan**:
A read-only finance submodule that summarizes all Kas Kecil transactions, including the gaji category, as filtered expense totals, transaction count, largest category, and a category-filtered line chart.
_Avoid_: a separate expense ledger, excluding payroll-derived cash transactions

**Tampilan Periodik Pengeluaran**:
The time scale of the Dashboard Pengeluaran Perusahaan: daily points from day 1 to 31 in a selected month, weekly points in a selected month, monthly points in a selected year, or annual comparison points across recorded years. One named category or all categories can be selected at a time.
_Avoid_: multi-line category comparison

**Label Nominal Grafik Pengeluaran**:
The compact Rupiah value displayed above every point of the Dashboard Pengeluaran Perusahaan line chart; the complete value remains available when the point is hovered.
_Avoid_: omitting zero-value points, full-length labels that overlap on a daily chart

**Paket Modul**:
A versioned, self-contained file produced only when explicitly requested in a module-development chat, then uploaded by an administrator to the local CAP Analytics server. It declares its menu, access rights, application changes, and optional database migration.
_Avoid_: copying source files manually, unversioned patch

**Pemasang Modul Web**:
The administrator-only local-server interface, available only to account 888, that validates a manifest and checksum, backs up, installs, or upgrades a Paket Modul while preserving existing application data. It restarts the CAP service after a successful installation so the module becomes active without restarting Windows.
_Avoid_: installation through a separate module-development chat

**Migrasi Database Modul**:
A declared structural database change bundled with a Paket Modul. It may be applied during an upgrade only after the automatic backup succeeds and the migration can preserve or transform existing module data. Automatic migrations may add or alter tables, columns, and indexes, but never delete data; destructive changes require a dedicated recovery package.
_Avoid_: undeclared schema change, destructive replacement of module data

**Versi Modul Stabil**:
The highest successfully installed version of a module. An installer accepts only a newer version; moving to an older version is performed through recovery.
_Avoid_: untracked downgrade, arbitrary version replacement

**CAP Recovery**:
A local recovery interface and desktop shortcut that restores the last stable application version or pre-upgrade database backup, then verifies and restarts the CAP service.
_Avoid_: manual source-code repair, Windows restart as recovery procedure

**Paket Diagnostik CAP**:
A downloadable read-only bundle used to diagnose or repair CAP Analytics from a Codex chat.
_Avoid_: an automatic remote-support connection, modification of the application

**Status Menu Aktif**:
The single highlighted navigation item that identifies the module currently visible in the main area. A parent module remains active while one of its submodules is visible; Dashboard is active only when the Dashboard view is visible.
_Avoid_: a stale Dashboard highlight while another module is open

**Sidebar Navigasi Lipat**:
Panel daftar modul yang dapat disembunyikan sepenuhnya oleh pengguna untuk memperluas area kerja, lalu dibuka kembali melalui tombol menu global. Status lipat berlaku pada perangkat dan browser yang sama.
_Avoid_: daftar modul yang memakan area kerja tanpa cara ditutup, menu yang hilang tanpa kontrol untuk memunculkannya kembali

**Header Akses Global**:
Baris navigasi tetap di bagian atas aplikasi yang menyediakan Dashboard, Akun, dan Keluar pada setiap modul serta saat halaman digulir.
_Avoid_: akses akun atau jalan kembali ke Dashboard yang hanya tersedia di satu halaman atau di bagian bawah sidebar

**Panel Submodul Overlay**:
Daftar hak akses turunan yang muncul sebagai panel mengambang dari kartu modul induk. Membuka panel tidak mengubah posisi kartu modul atau hak akses pengguna lain; hanya satu panel terbuka dalam satu daftar hak akses pada satu waktu.
_Avoid_: daftar submodul yang mendorong kartu lain ke bawah, banyak panel terbuka sekaligus

**Dialog Aplikasi**:
A modal CAP interface whose header and close control remain visible while its long content scrolls within the viewport.
_Avoid_: a modal whose controls or content are cut off by the browser window

**Instalasi Mandiri CAP**:
A self-contained Windows installation of CAP Analytics that keeps its application files, bundled runtime, and SQLite database separate from an existing IIS or SQL Server application. It uses a dedicated CAP port and never modifies an ERP database, IIS site, or ERP network configuration.
_Avoid_: an ERP replacement, a shared SQL Server database, an installer that reconfigures IIS

**Duplikat Kas Kecil**:
An imported transaction with the same date, category, name, source number, description, and amount as a stored transaction. It is not imported a second time.

**Tanggal Efektif Keluar**:
The first date an employee is no longer included in payroll classification or pay calculation. Payroll periods before that date retain the employee's prior classification.
_Avoid_: absence-based termination, upload date

**Karyawan Keluar**:
An employee with a recorded effective exit date. They remain payable only for attendance before that date and may later receive a new effective reactivation date.
_Avoid_: employee with zero attendance

**Status Efektif Karyawan**:
A dated Cash, Transfer, or Keluar classification that determines payroll inclusion on each attendance date. A later active status reactivates the employee from its effective date.
_Avoid_: current-only employee status

**Kejanggalan Absen Kosong Transfer**:
An attendance-warning record for an employee whose effective payroll classification is Transfer and whose imported attendance row has both IN and OUT empty on a working day. It excludes Sundays, national holidays, and dates with no imported attendance row.
_Avoid_: automatic absence deduction, missing-row inference

**Tukar Hari**:
A payroll attendance note for an employee whose effective payroll classification is Transfer. It makes the noted workday count as one full attendance day even when the source has no valid IN or OUT time.
_Avoid_: a Cash attendance override, absence, missing-clock deduction

**Tukar Setengah Hari**:
A payroll attendance note on a workday that would otherwise receive 0.5 attendance credit. The note upgrades that date to one full attendance day.
_Avoid_: an ordinary half-day attendance credit

**Perjalanan Dinas**:
A named business-trip record with an inclusive start and end date, optional description, and one or more employee participants. It grants each active participant one full payroll attendance day for each working day in the range, without changing the machine log. It takes priority over ordinary machine-log, Tukar Hari, and manual attendance credit, but does not count Sundays or national holidays.
_Avoid_: a manufactured clock time, a holiday attendance override, a single-employee-only note

**Tanda Perjalanan Dinas**:
The blue attendance-table marker showing the name of a Perjalanan Dinas on its covered workdays. It is distinct from green forgotten clocking, yellow Tukar Hari or half-day, orange lateness or early departure, and red absence or holidays.
_Avoid_: reusing an anomaly color, hiding the trip name in a payroll-only screen

**Pembayaran Perlu Dihitung Ulang**:
A warning state for a saved payroll-payment period that is later affected by a Perjalanan Dinas change. The saved payment history remains immutable; the administrator may recalculate and save a new total for the affected period.
_Avoid_: silently changing an already saved payment, blocking an attendance correction solely because payment history exists

**Warna Kejanggalan Absensi**:
The approved visual state used consistently in the attendance table and payroll exports: red for a holiday or no attendance, green for admin-confirmed forgotten clocking, yellow for a half-day, and orange for lateness. When states overlap, the precedence is red, then green, then yellow, then orange.
_Avoid_: a single generic anomaly color, a non-red holiday or absence

**Keputusan Hari Kerja**:
An administrator's per-employee, per-date payroll decision of full attendance (1 day), half attendance (0.5 day), or absent (0 day). It overrides automatic attendance credit while retaining the machine log.
_Avoid_: changing clock times solely to achieve a payroll-day result

**Ruang Lupa Absen**:
The part of the machine log declared missing by an administrator: IN, OUT, or both. It is a marker only; it does not manufacture or replace a clock time. A missing IN or both suppresses lateness deduction for that date.
_Avoid_: an invented clock time, a lateness deduction based on an untrusted IN time

**Scan Tunggal**:
One and only one valid clock time imported for an employee on one attendance date. A time before 12:00 is an IN; 12:00 or later is an OUT. The value remains in only that one field and is never duplicated.
_Avoid_: assigning one scan to both IN and OUT, altering a multi-scan or overnight log

**Setengah Hari**:
Attendance with at least 3 working hours but less than the required full-day duration. It credits 0.5 payroll days, must be presented for administrator review, and never receives an additional automatic lateness or early-departure deduction.
_Avoid_: requiring a specific lunch-hour timestamp, charging a half-day both reduced attendance and a time penalty

**Potongan Keterlambatan**:
A Rp10.000 deduction per started 30-minute block of lateness for one attendance date that reaches the required full-day duration and has a valid IN time later than the 5-minute grace period after its assigned shift begins. A 45-minute delay is therefore Rp20.000. It does not apply to half-day attendance, attendance shorter than three hours, administrator-approved full attendance, forgotten clocking, Tukar Hari, or Perjalanan Dinas.
_Avoid_: a per-30-minute multiplier, an early-departure deduction, a double deduction on a reduced-attendance day

**Rekap Gaji Cash Bulanan**:
The Excel payroll calculation for a Cash employee over a period longer than seven days. Its total uses the same components as the monthly salary slip: monthly basic pay, premium after attendance evaluation, and eligible allowances. Attendance days remain audit information and do not replace those salary components.
_Avoid_: calculating a monthly Cash total as attendance days multiplied by daily wage, showing an unexplained mismatch with the monthly slip

**Rekap Gaji Cash Harian**:
The Excel payroll calculation for a Cash period of seven days or fewer. Its total uses attendance days multiplied by the daily wage, plus applicable overtime and deductions.
_Avoid_: applying the monthly salary-slip components to a short-period payroll recap

**Shift Kerja**:
The planned work-time window assigned to an employee for a calendar date. Pagi1 is 08:00–16:30 and Siang1 is 13:00–21:30 on Monday–Friday; SabtuP2 is 08:00–16:00 and SabtuS2 is 13:00–21:00 on Saturday; 12Malam is 00:00–12:00 and 12Siang is 12:00–00:00 for a special event, normally used by Transfer employees.
_Avoid_: evaluating every attendance record against one universal daily time window

**Setengah Hari Berdasarkan Shift**:
An attendance record credited at 0.5 day because it covers only one side of its assigned Shift Kerja. The anomaly color and note appear only on IN when the employee misses the opening portion of the shift, or only on OUT when the employee leaves before the scheduled shift end.
_Avoid_: always marking OUT for a half-day, marking both IN and OUT, treating a manual half-day as a generic late arrival

**Klasifikasi Absensi Bersama**:
The single Cash, Transfer, or Semua karyawan filter shared by the Log Absensi and Perhitungan Gaji views. Changing it in either view immediately selects the same classification in the other view; each view retains its own date range.
_Avoid_: independent classification selections that show contradictory employee sets

**Keterangan Absensi**:
Sheet audit terpisah pada ekspor Excel yang hanya mencatat log dengan catatan IN atau OUT. Baris dikelompokkan per nama karyawan dan diurutkan menurut tanggal, sehingga catatan tidak mengganggu tampilan jam pada sheet Log Absensi.
_Avoid_: menaruh teks catatan di bawah jam IN/OUT, mencampurkan catatan kosong ke dalam audit

**Penilaian Shift Otomatis**:
The default attendance evaluation that infers the most plausible Shift Kerja from the recorded IN and OUT times without requiring a pre-published employee schedule. An administrator reviews and confirms or corrects the inference during end-of-month reconciliation.
_Avoid_: mandatory advance shift assignment, permanently treating an inferred shift as a fixed roster

**Default Shift Karyawan Cash**:
Cash employees are evaluated as Pagi1 by default. The only Cash role routinely eligible for automatic Siang1 inference is Security; all other Cash employees require an administrator correction before a Siang1 interpretation is used.
_Avoid_: treating every Cash employee as a possible afternoon-shift employee

**Event Khusus Shift 12 Jam**:
An administrator-marked date or inclusive date range with selected participating Transfer employees. Only the selected records may be evaluated as 12Malam or 12Siang; all other dates retain regular-shift rules.
_Avoid_: inferring a 12-hour event from an ordinary clock record, applying an event schedule to every employee

**OCR Laporan Gudang Lokal**:
An offline CAP server component that reads a submitted warehouse-report image with Indonesian and English OCR data. The image and its extracted text remain on the local CAP server.
_Avoid_: a cloud OCR request, a generic “OCR unavailable” failure without readiness status

**Ekspor Laporan Accounting Lite**:
One Excel workbook generated only after the user applies a selected Accounting Lite report and its classification period. The workbook exports the active report in full, while Buku Besar and Kartu Stok follow the currently selected rekening or barang.
_Avoid_: loading or exporting all Accounting Lite history on initial page open, exporting a different report than the one the user has applied

**Pemuatan Bertahap Laporan Accounting Lite**:
Laporan rinci menampilkan paling banyak 100 baris per halaman setelah pengguna menekan Terapkan atau memilih rekening. Saldo berjalan pada Buku Besar dan Buku Besar Pembantu tetap dihitung dari awal periode, sedangkan ekspor Excel tetap memuat seluruh periode.
_Avoid_: mengirim seluruh riwayat ke layar sekaligus, saldo halaman lanjutan yang dimulai ulang, cache laporan yang menunda jurnal terbaru

**Kode Anak Rekening Otomatis**:
Kode awal untuk rekening baru langsung terisi setelah Rekening Induk dipilih. Sistem menaikkan segmen kosong pertama setelah jalur induk (misalnya `01.01.03.00.00.0000` menjadi `01.01.03.01.00.0000`), lalu menjaga seluruh awalan dan segmen setelahnya tetap sesuai jalur tersebut. Kode tidak diisi atau diubah manual.
Jika kapasitas anak penuh, sistem menolak penambahan dan meminta pembuatan rekening induk atau kelompok baru; kode historis tidak diubah.
_Avoid_: memakai segmen terakhir secara buta, menerima awalan dari induk lain, membiarkan segmen setelah anak bernilai selain nol, memperlebar kode historis secara otomatis, menyimpan kode duplikat

**Konversi Kode Rekening Menyeluruh**:
Sekali proses terkontrol yang menulis ulang seluruh kode rekening Accounting beserta semua referensinya ke pola `2.2.3.3.3.4`. Konversi mempertahankan nilai setiap segmen, saldo, nominal jurnal, dan hubungan rekening; kode historis ikut berubah hanya melalui transaksi atomik dengan cadangan dan verifikasi sebelum–sesudah.
_Avoid_: mengubah sebagian referensi, menjalankan konversi tanpa cadangan, mengubah nominal atau tanggal jurnal

**Buku Besar Rekening Induk**:
Buku besar pada rekening yang memiliki anak menghitung saldo dan mutasi rekening tersebut beserta seluruh turunan secara rekursif. Setiap mutasi gabungan mencantumkan kode serta nama rekening sumber agar totalnya tetap dapat ditelusuri.
_Avoid_: buku besar induk kosong, total yang hanya mengambil anak langsung, mutasi gabungan tanpa rekening sumber

**Pemilih Rekening Jurnal**:
Kolom autocomplete pada satu baris jurnal yang menemukan rekening posting berdasarkan kode atau nama setelah sedikitnya dua karakter diketik. Maksimal sepuluh hasil ditampilkan; mouse atau tombol panah dan Enter dapat memilih hasil. Setelah dipilih, kode dan nama tetap terlihat dan dapat dikosongkan untuk memilih ulang. Rekening yang tidak ada dibuat melalui menu Rekening, bukan dari dialog jurnal.
_Avoid_: dropdown panjang yang mengharuskan pengguna menggulir seluruh daftar rekening, memilih rekening induk, membuat rekening saat mencatat jurnal

**Transaksi Operasional Accounting Lite**:
Dokumen bisnis baru yang menjadi sumber tunggal untuk Pembelian Barang, Penjualan Barang, atau Penyesuaian Stok. Satu transaksi membentuk mutasi Kartu Stok dan jurnal yang terkait; Jurnal Baru dipakai hanya untuk jurnal umum atau penyesuaian nonstok.
_Avoid_: memasukkan mutasi stok dan jurnal yang sama secara terpisah, mengubah transaksi historis

**Riwayat Stok**:
Sub-menu Accounting Lite tersendiri, terpisah dari Laporan, untuk menelusuri seluruh dokumen mutasi persediaan. Riwayat menggabungkan data historis impor tahun 2021–2025 dengan transaksi stok baru, tetapi data historis bersifat hanya-baca agar urutan dan nilai persediaan lama tidak berubah. Riwayat disaring menurut tahun, bulan, rentang tanggal, jenis mutasi (semua, barang masuk, barang keluar, penyesuaian), nomor bukti, dan nama barang.
_Avoid_: menyembunyikan data impor stok, memberi aksi edit/hapus pada transaksi historis, atau mencampurkan Riwayat Stok dengan laporan periodik

**Pengosongan Manual Tahun Accounting Lite**:
Penghapusan terkontrol terhadap transaksi dan master data manual pada satu tahun kerja, setelah membuat salinan pemulihan. Pengosongan menghapus dokumen stok beserta jurnal otomatisnya, jurnal umum manual, pengajuan tutup buku tahun tersebut, serta barang master manual yang tidak lagi dipakai. Seed FIFO sistem bertanggal 1900 boleh dihapus bila terbukti tidak dipakai oleh transaksi historis; sistem membentuknya kembali dari data impor bila barang historis kembali dipakai. Data impor historis tetap dipertahankan.
_Avoid_: menghapus data historis impor atau meninggalkan pengajuan tutup buku yang merujuk data yang sudah dihapus

**Panel Rekening Terkunci**:
Panel pemilih rekening pada Buku Besar desktop yang tetap berada di bawah filter periode dan setinggi ruang viewport yang tersedia; hanya daftar rekening di dalam panel yang dapat digulir.
_Avoid_: panel rekening yang ikut menggulir halaman utama, panel penuh setinggi halaman, perilaku sticky pada layar ponsel

## Manajemen Aset

**Aset Perusahaan**:
Barang berwujud milik perusahaan yang dipantau untuk penggunaan, lokasi, kondisi, dan masa manfaatnya; tidak mencakup barang pribadi maupun sewa/leasing.
_Avoid_: semua barang yang dipakai bekerja, aset pribadi, aset sewa

**Unit Aset**:
Satu benda fisik beridentitas yang dicatat mandiri dan dapat memiliki kode, kondisi, lokasi, pengguna, riwayat, serta umur pemakaian sendiri.
_Avoid_: satu baris untuk seluruh set perangkat, kategori aset

**Set Kerja**:
Pengelompokan beberapa Unit Aset yang dipakai bersama oleh pengguna atau di satu lokasi, tanpa menggabungkan identitas dan umur tiap unit.
_Avoid_: aset tunggal, paket penyusutan

**Komponen Terkendali**:
Komponen material pada Unit Aset yang dicatat sebagai unit sendiri agar perpindahan, garansi, kondisi, dan penggantiannya dapat ditelusuri.
_Avoid_: catatan servis biasa, spesifikasi teks semata

**Inventaris Bertahap**:
Pencatatan awal Unit Aset dari hasil opname ketika tanggal atau nilai perolehan belum lengkap; data sumber dapat dilengkapi kemudian tanpa menghapus riwayat inventaris.
_Avoid_: aset tanpa identitas, data final yang dipaksakan

**Komponen Internal PC**:
GPU, SSD, RAM, dan komponen sejenis yang melekat pada PC dicatat sebagai spesifikasi atau keterangan Unit Aset PC, bukan sebagai Unit Aset tersendiri.
_Avoid_: aset mandiri untuk setiap komponen PC, spesifikasi tanpa aset induk

**Kode Aset Khusus**:
Pengenal permanen dan unik untuk satu Unit Aset, dibentuk menurut kategori aset dan nomor urut serta tidak berubah ketika pengguna atau lokasinya berubah.
_Avoid_: nama pengguna sebagai kode, serial pabrikan sebagai satu-satunya kode

**Referensi Pemasok atau Bukti Aset**:
Nomor faktur, nomor transaksi, atau rujukan pemasok opsional yang melengkapi Unit Aset. Kode Aset Khusus tetap menjadi satu-satunya nomor inventaris internal.
_Avoid_: nomor inventaris internal kedua, memakai nomor seri sebagai pengganti bukti perolehan

**Tanggal Mulai Digunakan**:
Tanggal pertama Unit Aset dipakai untuk operasional dan dasar utama perhitungan umur pakai; tanggal beli digunakan bila tanggal ini tidak tersedia, sedangkan tanggal inventaris menjadi fallback bertanda estimasi.
_Avoid_: selalu memakai tanggal pembelian, tanggal entri sistem tanpa penanda

**Target Umur Pakai Unit**:
Target monitoring dalam bulan yang mula-mula diambil dari kelas aset, namun dapat diubah untuk satu Unit Aset bila karakter pemakaiannya berbeda. Perubahan target unit tidak mengubah kelas maupun aset lain.
_Avoid_: mengubah target semua aset saat menangani satu pengecualian, menganggap target operasional sebagai penyusutan akuntansi

**Umur Tampilan Aset**:
Lama pemakaian Unit Aset yang dihitung dari Tanggal Mulai Digunakan, lalu tanggal perolehan bila tanggal mulai pakai kosong. Tampilan memperlihatkan umur dan sisa target; aset yang melewati target umur pakai diberi penanda merah.
_Avoid_: menghitung dari tanggal entri sistem, memberi peringatan merah sebelum melewati target

**Mutasi Aset**:
Perubahan tercatat atas pengguna dan/atau lokasi Unit Aset yang dicatat oleh admin, dengan riwayat keadaan lama dan baru serta nomor bukti bila tersedia.
_Avoid_: menimpa pengguna atau lokasi aktif, serah-terima tanpa riwayat

**Alih Pengguna atau Lokasi Aset**:
Mutasi Aset yang dilakukan dari tindakan Edit dengan pemegang baru (yang dapat dikosongkan untuk aset bersama), lokasi baru bila berubah, tanggal alih, dan catatan opsional. Perubahan pemegang saja, lokasi saja, atau keduanya tetap mencatat keadaan lama dan baru.
_Avoid_: memaksa lokasi ikut berubah saat hanya pemegang berubah, menimpa data tanpa riwayat

**Aset Belum Digunakan**:
Unit Aset berstatus Disimpan (`stored`) yang belum dipakai untuk operasional. Aset dapat sudah memiliki lokasi penyimpanan namun tetap belum digunakan dan tidak wajib memiliki pemegang.
_Avoid_: menyamakan lokasi penyimpanan dengan penggunaan operasional, menyembunyikan aset tanpa pemegang

**Status Akhir Aset**:
Keadaan Unit Aset yang rusak berat, hilang, dijual, atau dibuang; unit dan riwayatnya tetap tersimpan bersama alasan, tanggal, bukti, dan nilai pelepasan jika ada.
_Avoid_: menghapus aset, menandai hilang tanpa alasan

**Rusak Perlu Pengganti**:
Keadaan Unit Aset yang tidak dapat dipakai dan memerlukan Unit Aset pengganti. Sistem memberi tanda merah sampai pengganti dipilih; alternatif proses kerusakan adalah Dalam Perbaikan atau Dihapuskan.
_Avoid_: menghapus aset rusak, memberi tanda merah untuk aset yang masih dapat diperbaiki, menganggap aset baru otomatis menjadi pengganti tanpa hubungan tercatat

**Penetapan Aset Pengganti**:
Hubungan tercatat antara Unit Aset Rusak Perlu Pengganti dan Unit Aset yang mengambil alih pengguna serta lokasinya. Sistem menyalin pengguna/lokasi ke pengganti sebagai nilai awal yang masih dapat diubah admin sebelum disimpan.
_Avoid_: memindahkan aset tanpa persetujuan admin, menghapus aset rusak setelah pengganti dipilih, memutus jejak hubungan pengganti

**Kandidat Pengganti Aset**:
Unit Aset berstatus Disimpan yang belum digunakan dan dapat dipilih untuk menggantikan Unit Aset Rusak Perlu Pengganti. Kandidat dengan kelas aset sama diprioritaskan, namun admin dapat memilih kelas lain bila sesuai.
_Avoid_: mengambil aset yang sedang aktif digunakan sebagai pengganti, membatasi penggantian hanya karena kelas berbeda

**Akses Manajemen Aset**:
Hak modul Manajemen Aset yang mengikuti pola pemberian akses per modul CAP kepada akun yang ditetapkan perusahaan dan dapat dicabut tanpa mengubah riwayat aset.
_Avoid_: peran aset terpisah, akses berdasarkan jabatan tetap, akun bersama tanpa jejak pengguna

**Salinan Barang Sumber Aset**:
Salinan lokal baris barang dari Accounting Lite yang dipakai Modul Manajemen Aset sebagai antrean alokasi tanpa mengubah jurnal asal.
_Avoid_: membaca tampilan ledger tanpa identitas tersimpan, mengubah jurnal Accounting Lite

**Barang Belum Dialokasikan**:
Salinan Barang Sumber Aset yang belum memiliki alokasi penuh ke Unit Aset; baris tetap muncul sampai sisa nilai atau unitnya nol.
_Avoid_: riwayat aset aktif, transaksi yang sudah dialokasikan penuh

**Alokasi Parsial Aset**:
Pengaitan sebagian nilai atau unit Barang Belum Dialokasikan kepada satu atau beberapa Unit Aset. Sisa yang belum dialokasikan tetap tersedia untuk tindakan berikutnya.
_Avoid_: memaksa satu transaksi menjadi satu aset, alokasi melebihi sumber

**Tinjau Perubahan Sumber Aset**:
Keadaan Salinan Barang Sumber Aset ketika jurnal Accounting Lite asal berubah setelah alokasi dibuat. Modul tidak menimpa Unit Aset otomatis; admin membandingkan dan memutuskan tindak lanjutnya.
_Avoid_: pembaruan aset otomatis, mengabaikan koreksi jurnal

**Sumber Aset Tetap Accounting Lite**:
Baris debit transaksi dari rekening Inventaris Kantor yang disalin ke Modul Manajemen Aset. Saldo awal, jurnal `SA`, kredit, dan jurnal pembalik bukan Barang Belum Dialokasikan.
_Avoid_: seluruh mutasi buku besar, saldo pembuka sebagai pembelian aset

**Aksi Alokasi Aset**:
Pilihan admin untuk membuat Unit Aset baru dari Barang Belum Dialokasikan atau menghubungkannya kepada Unit Aset yang telah ada.
_Avoid_: membuat aset ganda, mengubah jurnal sumber

**Data Minimum Alokasi**:
Kelas aset, nama aset, jumlah unit, dan nilai alokasi yang wajib tersedia agar alokasi dapat disimpan. Pengguna dan lokasi boleh dilengkapi kemudian.
_Avoid_: aset tanpa kelas atau nilai sumber, memaksa pengguna ketika aset masih disimpan

**Identitas Fisik Aset**:
Merek/model, nomor seri, serta nomor inventaris atau nomor vendor yang dicatat sebagai data opsional pada Unit Aset. Data ini memperjelas unit seperti PC, ponsel, dan kendaraan tanpa menghambat aset yang tidak memilikinya.
_Avoid_: menjadikan seluruh nomor identitas wajib, menyamakan kode aset permanen dengan nomor seri pabrikan

**Pemegang Aset Bersama**:
Nama pengguna yang menerima atau bertanggung jawab atas Unit Aset. Nilai ini dapat kosong apabila aset digunakan bersama; lokasi tetap dapat dicatat secara mandiri.
_Avoid_: mengisi pemegang fiktif untuk aset bersama, menganggap lokasi dan pemegang harus selalu terisi bersamaan

**Pemecahan Multi-Unit**:
Pembuatan beberapa Unit Aset dari satu Barang Belum Dialokasikan yang memuat banyak unit, dengan alokasi nominal per unit yang dapat disesuaikan tetapi totalnya tidak melebihi sumber.
_Avoid_: satu kode aset untuk banyak benda, pembagian nominal melebihi transaksi

**Form Multi-Unit Per Baris**:
Cara alokasi beberapa Unit Aset dari satu Barang Belum Dialokasikan dengan satu baris form untuk setiap benda fisik. Setiap baris memiliki identitas, nilai, lokasi, dan pemegang sendiri; total nilai semua baris tidak boleh melebihi nilai sumber.
_Avoid_: satu identitas untuk banyak benda, pembagian otomatis yang menyembunyikan serial atau nomor inventaris per unit

**Dialog Alokasi Aset**:
Form lebar dalam dialog yang dibuka dari Barang Belum Dialokasikan. Form menampilkan sumber transaksi, mendukung tambah atau hapus baris Unit Aset, dan menyimpan seluruh baris secara atomik setelah validasi total nilai.
_Avoid_: rangkaian pop-up satu per satu, berpindah halaman hingga hubungan dengan transaksi sumber hilang

**Pembatalan Alokasi Aset**:
Pembatalan tercatat atas Alokasi Parsial Aset yang mengembalikan sisa Barang Belum Dialokasikan tanpa menghapus Unit Aset yang telah memiliki riwayat.
_Avoid_: menghapus jejak alokasi, menghilangkan barang sumber dari antrean

**Bukan Aset Fisik**:
Keputusan tercatat bahwa Barang Belum Dialokasikan tidak perlu menjadi Unit Aset, misalnya biaya pemasangan atau komponen habis pakai; keputusan menyertakan alasan dan mengeluarkan baris dari daftar aktif.
_Avoid_: menghapus transaksi sumber, membiarkan biaya berulang dalam antrean

**Nilai Perolehan Sumber**:
Tanggal transaksi dan nilai debit Barang Belum Dialokasikan yang otomatis menjadi tanggal beli serta biaya perolehan ketika Unit Aset dibuat melalui alokasi. Tanggal Mulai Digunakan tetap terpisah.
_Avoid_: tanggal mulai digunakan yang disamakan dengan tanggal transaksi, nilai yang diketik ulang tanpa sumber

**Audit Tindakan Aset**:
Jejak pengguna dan waktu untuk sinkronisasi, alokasi, perubahan, pembatalan, serta keputusan Bukan Aset Fisik.
_Avoid_: perubahan tanpa pelaksana atau waktu

**Aset Manual**:
Unit Aset yang ditambahkan langsung ke register karena tidak memiliki Barang Belum Dialokasikan dari Accounting Lite; sumbernya ditandai manual dan tetap memiliki riwayat serta identitas yang sama.
_Avoid_: aset tanpa asal, menyamakan aset manual dengan sumber Accounting Lite

**Pelengkapan Bukti Aset Manual**:
Pengaitan Barang Belum Dialokasikan yang ditemukan kemudian kepada Aset Manual yang telah ada, tanpa membuat Unit Aset atau Kode Aset baru.
_Avoid_: aset ganda, mengganti identitas aset manual

**Antrean Manajemen Aset**:
Empat daftar kerja Modul Manajemen Aset: Barang Belum Dialokasikan, Perlu Ditinjau, Register Aset, serta Riwayat Audit. Tambah Aset Manual tersedia dari Register Aset.
_Avoid_: satu daftar yang mencampur antrean, aset aktif, dan audit

**Klasifikasi Register Aset**:
Cara menampilkan Register Aset melalui pilihan Semua, per Lokasi, dan Belum Digunakan. Tampilan per Lokasi mengelompokkan Unit Aset menurut lokasi, sedangkan Belum Digunakan hanya memuat Aset Belum Digunakan.
_Avoid_: menyalin aset ke daftar fisik terpisah, menganggap lokasi kosong sebagai lokasi tersendiri tanpa penanda

**Penghapusan Aset Manual Awal**:
Penghapusan penuh yang hanya diizinkan untuk Aset Manual yang belum memiliki alokasi, penugasan, atau riwayat tindakan. Aset lain memakai Status Akhir Aset atau Pembatalan Alokasi Aset.
_Avoid_: menghapus aset bersejarah, menghapus alokasi untuk koreksi

**Format Kode Aset**:
Pola Kode Aset Khusus berupa `AST-{kategori}-{kelas}-{nomor urut}`, misalnya `AST-IT-PC-0001`; nomor urut tidak digunakan ulang.
_Avoid_: kode yang bergantung pengguna atau lokasi, nomor urut yang dipakai ulang

**Masa Pakai Target**:
Target umur operasional per kelas aset yang menjadi indikator pemantauan dan dapat disesuaikan pada Unit Aset tertentu; bukan kebijakan penyusutan akuntansi.
_Avoid_: umur ekonomi akuntansi, target global yang tidak dapat dioverride

**Peringatan Aset**:
Penanda dashboard untuk Unit Aset yang mencapai 80% Masa Pakai Target, melewati target, mendekati akhir garansi, berstatus rusak/perbaikan, atau belum memiliki pengguna maupun lokasi aktif.
_Avoid_: pengingat tanpa tindakan, peringatan nilai buku akuntansi

**Snapshot Inventaris Awal**:
Hasil migrasi daftar aset pada satu tanggal pemeriksaan yang menjadi titik awal data; Unit Aset dan spesifikasi yang tersedia dicatat, sementara identitas, biaya, serta tanggal penggunaan yang belum ada menjadi data pelengkapan.
_Avoid_: sumber inventaris tanpa tanggal, memaksakan data yang tidak tersedia

**Koneksi WeCom Modul**:
Satu konfigurasi akun layanan WeCom yang ditetapkan akun master untuk satu Modul CAP. Secret hanya berada di server CAP; pengguna modul tidak pernah menerima atau melihat secret tersebut.
_Avoid_: koneksi per pengguna tanpa kendali master, secret WeCom di browser

**Penerima Default WeCom**:
Pengguna CAP yang sudah memiliki hak ke Modul atau Dokumen terkait dan dipilih sebagai tujuan pemberitahuan perubahan Excel.
_Avoid_: notifikasi kepada akun tanpa hak akses, daftar penerima bebas tanpa pemeriksaan akses

**Perubahan Excel WeDrive**:
Perubahan pada workbook terpilih di WeDrive, baik yang dilakukan melalui CAP maupun langsung pada WeDrive. Perubahan ini menjadi peristiwa audit dan dapat mengirim pemberitahuan.
_Avoid_: hanya mencatat perubahan dari CAP, menimpa perubahan eksternal tanpa deteksi
