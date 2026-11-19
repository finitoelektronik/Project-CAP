-- Kandidat perolehan aset dari Buku Besar akun 01.02.001.000.000.0000.
-- Saldo awal serta jurnal SA sengaja tidak diimpor sebagai Unit Aset karena
-- bukan bukti pembelian per benda. Baris tetap berstatus unmatched sampai
-- dicocokkan dengan Unit Aset hasil inventaris fisik.

INSERT INTO asset_ledger_lines (
  source_name, source_sheet, source_row, transaction_date, voucher_no,
  description, debit_amount, reconciliation_status
) VALUES
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 7, DATE '2021-01-08', '2021/PI-19468070/KK', 'INVENTARIS KANTOR (PI-19468070/KK_ACERA314)', 6045455.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 8, DATE '2021-01-08', '2021/PI-210108PX183WNU/KK', 'INVENTARIS KANTOR (IPAD MINI 5 WIFI GREY_PI-210108PX183WNU/KK)', 7250000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 9, DATE '2021-01-12', '2021/PI-30174/KK', 'INVENTARIS KANTOR (MEJA KANTOR_PI-30174/KK)', 500000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 10, DATE '2021-01-12', '2021/PI-30174/KK', 'INVENTARIS KANTOR (KURSI KANTOR_PI-30174/KK)', 400000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 11, DATE '2021-01-14', '2021/PI-67080130/KK', 'INVENTARIS KANTOR (LENOVO V14_PI-67080130/KK)', 4909091.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 13, DATE '2021-01-17', '2021/PI-24196874/KK', 'INVENTARIS KANTOR (REDMI NOTE 9 PRO_PI-24196874/KK)', 3453636.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 15, DATE '2021-02-09', '2021/PI-34848/KK', 'INVENTARIS KANTOR (KOMPUTER PROC INTEL)', 4100000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 16, DATE '2021-03-17', '2021/PI-34403209/KK', 'INVENTARIS KANTOR (FIRE RESISTANT_PI-34403209/KK)', 15908182.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 17, DATE '2021-03-31', '2021/PI-23801856/KK', 'INVENTARIS KANTOR (TABLE WELANUT & LION BANQUET)', 2704545.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 19, DATE '2021-04-26', '2021/PI-P0260421/KK', 'INVENTARIS KANTOR (KOMPUTER CORE I5 16 GB)', 16250000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 20, DATE '2021-04-27', '2021/SARANA3489/PI', 'INVENTARIS KANTOR (AOC MONITOR)', 2295455.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 21, DATE '2021-04-28', '2021/PI-P0270421/KK', 'INVENTARIS KANTOR (SET LAMPU SOFTBOX, SET MIC)', 3850000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 22, DATE '2021-06-02', '2021/PI-P0020621/KK', 'INVENTARIS KANTOR (LAPTOP LENOVO X-240 250 GB)', 4000000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 23, DATE '2021-06-02', '2021/PI-P0020621/KK', 'INVENTARIS KANTOR (HP OPPOF-03, RAM 4 1GB)', 2000000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 24, DATE '2021-08-03', '2021/PI-7210863/KK', 'INVENTARIS KANTOR (HP IPHONE 12 PROMAX NEW)', 21924756.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 25, DATE '2021-08-03', '2021/PI-7210863/KK', 'INVENTARIS KANTOR (HP IPHONE 6S PLUS SECOUND)', 2684664.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 26, DATE '2021-09-07', '2021/PI-0001289/KK', 'INVENTARIS KANTOR (ALAT FINGERPRINT)', 143542100.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 27, DATE '2021-09-23', '2021/PI-21280711/KK', 'INVENTARIS KANTOR (LAPTOP)', 10329211.04, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 30, DATE '2021-12-06', '2021/PI-4304/KK', 'INVENTARIS KANTOR (MONITOR SPC)', 909090.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 36, DATE '2023-01-02', '2023/PI_0201', 'INVENTARIS KANTOR (TP-LINK ARCHER ROUTER WIFI WIRELESS)', 575000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 37, DATE '2023-01-16', '2023/PI_1601', 'INVENTARIS KANTOR (PI - HANDPHONE IPHONE 11 PROMAX)', 9500000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 38, DATE '2023-01-18', '2023/PI_1801', 'INVENTARIS KANTOR (PI - XIAOMI OFFICIAL TV A2)', 1999000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 39, DATE '2023-01-24', '2023/PI_2401', 'INVENTARIS KANTOR (PI - HISENSE KULKAS 1 PINTU)', 1399000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 40, DATE '2023-02-03', '2023/KAS_0302/PI', 'INVENTARIS KANTOR (PI_PRINTER EPSON)', 2160400.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 43, DATE '2023-03-17', '2023/BMI_7348/PI', 'INVENTARIS KANTOR (PI_MONITOR)', 1486486.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 46, DATE '2023-05-30', '2023/KAS_3005/PI', 'INVENTARIS KANTOR (PI_HP IPHONE, ANDROID)', 15299000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 48, DATE '2023-06-22', '2023/KAS_2206/PI', 'INVENTARIS KANTOR (PI_WIRELESS MICROPHONE)', 495000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 49, DATE '2023-08-05', '2023/KAS_0508/PI', 'INVENTARIS KANTOR (PI - HP ANDROID XIAOMI REDMI 12)', 1999000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 50, DATE '2023-08-06', '2023/KAS_0608/PI', 'INVENTARIS KANTOR (PI - HP ANDROID REALME C53)', 2099000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 51, DATE '2023-08-14', '2023/KAS_1408/PI', 'INVENTARIS KANTOR (PI - 2 HP ANDROID XIAOMI REDMI 12)', 3999000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 52, DATE '2023-08-19', '2023/KAS_1908/PI', 'INVENTARIS KANTOR (PI - IPHONE 11 PRO)', 9000000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 54, DATE '2023-08-22', '2023/KAS_2208/PI', 'INVENTARIS KANTOR (PI - BARCODE SCANNER)', 950000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 56, DATE '2023-08-29', '2023/ASA_9980/PI', 'INVENTARIS KANTOR (PI - TV DIGITAL ASA 9980)', 693694.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 57, DATE '2023-09-09', '2023/KAS_0909/PI', 'INVENTARIS KANTOR (PI_TP-LINK ROUTER WIFI WIRELESS)', 575000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 58, DATE '2023-09-13', '2023/BMI_4171/PI', 'INVENTARIS KANTOR (PI_MONITOR)', 3783784.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 59, DATE '2023-09-19', '2023/MTI_3237/PI', 'INVENTARIS KANTOR (PI - MEJA KANTOR MTI 3237)', 5631112.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 60, DATE '2023-09-19', '2023/MTI_3237/PI', 'INVENTARIS KANTOR (PI - KURSI KANTOR MTI 3237)', 3513514.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 67, DATE '2024-01-23', '2024/PI_2301', 'INVENTARIS KANTOR (PI - HANDPHONE IPHONE 12 PROMAX)', 10800000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 70, DATE '2024-05-28', '2024/WXSS2402-L001_AJU240592/PHI', 'INVENTARIS KANTOR (PI - ASSEMBLY LINE)', 27597538.40, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 71, DATE '2024-07-04', '2024/PI_0407', 'INVENTARIS KANTOR (PI - RAK BESI)', 6400000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 73, DATE '2024-10-01', '2024/PI_0110', 'INVENTARIS KANTOR (PI - SCANNER PDA)', 1600000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 74, DATE '2024-10-16', '2024/0167/KK', 'INVENTARIS KANTOR (PI - MONITOR 1 PCS)', 638000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 75, DATE '2024-11-01', '2024/KAS_0111/PI', 'INVENTARIS KANTOR (PI - HANDPHONE XIAOMI POCO C75)', 1230864.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 78, DATE '2025-04-26', 'IK2604_KAS', 'INVENTARIS KANTOR (INVENTARIS KANTOR - HP IPHONE)', 8500000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 79, DATE '2025-06-19', 'IK1906_KAS', 'INVENTARIS KANTOR (INVENTARIS KANTOR - MONITOR)', 633000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 81, DATE '2025-07-19', 'IK1907_KAS', 'INVENTARIS KANTOR (INVENTARIS KANTOR - KURSI)', 310000.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 87, DATE '2025-08-12', 'IK1208_ATLANTA0642', 'INVENTARIS KANTOR (ATLANTA 1208 - 1 PCS TV LED)', 5045045.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 88, DATE '2025-08-13', 'IK1308_DB KLIK1549', 'INVENTARIS KANTOR (DB KLIK 1308 - 2PCS MONITOR LED)', 1140540.54, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 94, DATE '2025-11-18', 'IK1811_KAS', 'INVENTARIS KANTOR (DETECTOR SCANNER SECURITY)', 141780.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 96, DATE '2025-12-10', 'IK1012_ERAFONE5461', 'INVENTARIS KANTOR (ERAFONE 1012 - 1 PCS HP ANDROID)', 2071171.00, 'unmatched'),
  ('Accounting Lite Ledger Semua Semua', 'Buku Besar', 97, DATE '2025-12-19', 'IK1912_AGRES25981150', 'INVENTARIS KANTOR (AGRES 1912 - 1 PCS LAPTOP LENOVO)', 4639640.00, 'unmatched')
ON CONFLICT (source_name, source_sheet, source_row) DO NOTHING;

-- Setelah inventaris fisik selesai, buat satu allocation untuk tiap Unit Aset
-- yang cocok. Untuk transaksi dua monitor, alokasikan dua baris Unit Aset
-- dengan total allocated_amount sama dengan debit_amount sumber.
