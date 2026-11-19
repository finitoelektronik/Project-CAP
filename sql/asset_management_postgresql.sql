-- PostgreSQL 15+ | Monitoring aset operasional CAP.
-- Bukan skema jurnal maupun penyusutan akuntansi.

CREATE TYPE asset_status AS ENUM (
  'active', 'in_repair', 'stored', 'lost', 'disposed', 'sold'
);
CREATE TYPE asset_condition AS ENUM ('new', 'good', 'fair', 'damaged', 'unusable');
CREATE TYPE asset_data_quality AS ENUM ('verified', 'estimated', 'incomplete');
CREATE TYPE event_type AS ENUM (
  'acquisition', 'inventory', 'maintenance', 'repair', 'transfer',
  'damage', 'lost', 'disposal', 'sale', 'other'
);

CREATE TABLE asset_categories (
  category_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_code VARCHAR(20) NOT NULL UNIQUE,
  category_name VARCHAR(100) NOT NULL,
  description TEXT
);

CREATE TABLE asset_classes (
  asset_class_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES asset_categories(category_id),
  class_code VARCHAR(30) NOT NULL UNIQUE,
  class_name VARCHAR(100) NOT NULL,
  default_useful_life_months INTEGER NOT NULL CHECK (default_useful_life_months > 0),
  default_warning_percent SMALLINT NOT NULL DEFAULT 80
    CHECK (default_warning_percent BETWEEN 1 AND 100)
);

CREATE TABLE employees (
  employee_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_code VARCHAR(30) UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  department_name VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE locations (
  location_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_location_id BIGINT REFERENCES locations(location_id),
  location_code VARCHAR(30) NOT NULL UNIQUE,
  location_name VARCHAR(150) NOT NULL,
  location_type VARCHAR(30) NOT NULL DEFAULT 'room'
);

CREATE TABLE asset_bundles (
  bundle_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bundle_code VARCHAR(40) NOT NULL UNIQUE,
  bundle_name VARCHAR(150) NOT NULL,
  notes TEXT
);

-- Asal inventaris awal, misalnya PDF atau Excel hasil opname.
CREATE TABLE asset_inventory_sources (
  inventory_source_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_name VARCHAR(200) NOT NULL,
  snapshot_date DATE NOT NULL,
  source_reference VARCHAR(500),
  notes TEXT
);

-- Baris buku besar dipertahankan sebagai bukti perolehan. Satu baris dapat
-- membiayai lebih dari satu Unit Aset (misalnya pembelian 2 monitor).
CREATE TABLE asset_ledger_lines (
  asset_ledger_line_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_name VARCHAR(200) NOT NULL,
  source_sheet VARCHAR(100) NOT NULL,
  source_row INTEGER NOT NULL,
  transaction_date DATE NOT NULL,
  voucher_no VARCHAR(100),
  description TEXT,
  debit_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  reconciliation_status VARCHAR(20) NOT NULL DEFAULT 'unmatched'
    CHECK (reconciliation_status IN ('unmatched', 'partial', 'matched', 'not_an_asset')),
  UNIQUE (source_name, source_sheet, source_row)
);

CREATE TABLE assets (
  asset_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_code VARCHAR(40) NOT NULL UNIQUE,
  asset_class_id BIGINT NOT NULL REFERENCES asset_classes(asset_class_id),
  inventory_source_id BIGINT REFERENCES asset_inventory_sources(inventory_source_id),
  asset_name VARCHAR(200) NOT NULL,
  brand VARCHAR(100),
  model VARCHAR(150),
  serial_number VARCHAR(150),
  acquisition_date DATE,
  in_service_date DATE,
  initial_inventory_date DATE,
  acquisition_cost NUMERIC(18,2),
  currency_code CHAR(3) NOT NULL DEFAULT 'IDR',
  useful_life_months INTEGER NOT NULL CHECK (useful_life_months > 0),
  warning_percent SMALLINT NOT NULL DEFAULT 80 CHECK (warning_percent BETWEEN 1 AND 100),
  status asset_status NOT NULL DEFAULT 'active',
  condition asset_condition NOT NULL DEFAULT 'good',
  data_quality asset_data_quality NOT NULL DEFAULT 'incomplete',
  warranty_end_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (acquisition_cost IS NULL OR acquisition_cost >= 0),
  CHECK (asset_code ~ '^AST-[A-Z0-9]+-[A-Z0-9]+-[0-9]{4,}$'),
  CHECK (in_service_date IS NULL OR acquisition_date IS NULL OR in_service_date >= acquisition_date)
);
CREATE UNIQUE INDEX ux_assets_serial_number
  ON assets (serial_number) WHERE serial_number IS NOT NULL;

CREATE TABLE asset_specifications (
  asset_specification_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id BIGINT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
  specification_key VARCHAR(60) NOT NULL,
  specification_value TEXT NOT NULL,
  unit VARCHAR(20),
  UNIQUE (asset_id, specification_key)
);

-- Hubungan banyak-ke-banyak antara Unit Aset dan baris ledger. Jumlah alokasi
-- per baris diperiksa pada proses impor agar tidak melebihi debit sumber.
CREATE TABLE asset_ledger_allocations (
  asset_ledger_allocation_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id BIGINT NOT NULL REFERENCES assets(asset_id),
  asset_ledger_line_id BIGINT NOT NULL REFERENCES asset_ledger_lines(asset_ledger_line_id),
  allocated_amount NUMERIC(18,2) NOT NULL CHECK (allocated_amount >= 0),
  notes TEXT,
  UNIQUE (asset_id, asset_ledger_line_id)
);

CREATE TABLE asset_bundle_items (
  bundle_id BIGINT NOT NULL REFERENCES asset_bundles(bundle_id) ON DELETE CASCADE,
  asset_id BIGINT NOT NULL REFERENCES assets(asset_id),
  PRIMARY KEY (bundle_id, asset_id)
);

CREATE TABLE asset_assignments (
  assignment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id BIGINT NOT NULL REFERENCES assets(asset_id),
  employee_id BIGINT REFERENCES employees(employee_id),
  location_id BIGINT REFERENCES locations(location_id),
  assigned_at DATE NOT NULL,
  returned_at DATE,
  handover_document_no VARCHAR(60),
  notes TEXT,
  CHECK (returned_at IS NULL OR returned_at >= assigned_at)
);
CREATE UNIQUE INDEX ux_asset_assignments_active
  ON asset_assignments (asset_id) WHERE returned_at IS NULL;

CREATE TABLE asset_events (
  asset_event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id BIGINT NOT NULL REFERENCES assets(asset_id),
  event_date DATE NOT NULL,
  event_type event_type NOT NULL,
  description TEXT NOT NULL,
  vendor_name VARCHAR(150),
  event_cost NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (event_cost >= 0),
  document_no VARCHAR(60)
);

-- Tampilan register untuk dashboard dan ekspor. Umur mengikuti keputusan bisnis:
-- tanggal mulai digunakan, lalu tanggal beli, lalu snapshot inventaris.
CREATE VIEW vw_asset_register AS
SELECT
  a.asset_id, a.asset_code, a.asset_name, c.category_code, c.category_name, ac.class_code, ac.class_name,
  a.brand, a.model, a.serial_number, a.acquisition_date, a.in_service_date, a.initial_inventory_date,
  COALESCE(a.in_service_date, a.acquisition_date, a.initial_inventory_date) AS age_start_date,
  CASE WHEN a.in_service_date IS NOT NULL THEN 'in_service_date'
       WHEN a.acquisition_date IS NOT NULL THEN 'acquisition_date'
       WHEN a.initial_inventory_date IS NOT NULL THEN 'initial_inventory_date' END AS age_basis,
  CASE WHEN COALESCE(a.in_service_date, a.acquisition_date, a.initial_inventory_date) IS NULL THEN NULL
       ELSE CURRENT_DATE - COALESCE(a.in_service_date, a.acquisition_date, a.initial_inventory_date) END AS age_days,
  CASE WHEN COALESCE(a.in_service_date, a.acquisition_date, a.initial_inventory_date) IS NULL THEN NULL
       ELSE EXTRACT(YEAR FROM age(CURRENT_DATE, COALESCE(a.in_service_date, a.acquisition_date, a.initial_inventory_date)))::INTEGER * 12
          + EXTRACT(MONTH FROM age(CURRENT_DATE, COALESCE(a.in_service_date, a.acquisition_date, a.initial_inventory_date)))::INTEGER END AS age_months,
  a.acquisition_cost, a.currency_code, a.useful_life_months, a.warning_percent, a.warranty_end_date,
  a.status, a.condition, a.data_quality,
  e.full_name AS current_user, l.location_name AS current_location,
  CASE WHEN COALESCE(a.in_service_date, a.acquisition_date, a.initial_inventory_date) IS NULL THEN NULL
       ELSE GREATEST(0, a.useful_life_months - (
         EXTRACT(YEAR FROM age(CURRENT_DATE, COALESCE(a.in_service_date, a.acquisition_date, a.initial_inventory_date)))::INTEGER * 12
         + EXTRACT(MONTH FROM age(CURRENT_DATE, COALESCE(a.in_service_date, a.acquisition_date, a.initial_inventory_date)))::INTEGER)) END
       AS remaining_useful_life_months
FROM assets a
JOIN asset_classes ac ON ac.asset_class_id = a.asset_class_id
JOIN asset_categories c ON c.category_id = ac.category_id
LEFT JOIN asset_assignments aa ON aa.asset_id = a.asset_id AND aa.returned_at IS NULL
LEFT JOIN employees e ON e.employee_id = aa.employee_id
LEFT JOIN locations l ON l.location_id = aa.location_id;

CREATE VIEW vw_asset_alerts AS
SELECT asset_id, asset_code, asset_name, 'status' AS alert_type, status::TEXT AS alert_detail
FROM vw_asset_register WHERE status IN ('in_repair', 'lost')
UNION ALL
SELECT asset_id, asset_code, asset_name, 'beyond_useful_life', 'Melewati masa pakai target'
FROM vw_asset_register WHERE age_months >= useful_life_months
UNION ALL
SELECT asset_id, asset_code, asset_name, 'near_useful_life_end', 'Mencapai ambang masa pakai'
FROM vw_asset_register WHERE age_months < useful_life_months
  AND age_months >= CEIL(useful_life_months * warning_percent / 100.0)
UNION ALL
SELECT asset_id, asset_code, asset_name, 'warranty_ending', 'Garansi berakhir dalam 30 hari'
FROM vw_asset_register WHERE warranty_end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
UNION ALL
SELECT asset_id, asset_code, asset_name, 'missing_assignment', 'Belum ada pengguna atau lokasi aktif'
FROM vw_asset_register WHERE status IN ('active', 'stored')
  AND current_user IS NULL AND current_location IS NULL
UNION ALL
SELECT asset_id, asset_code, asset_name, 'missing_age_date', 'Tanggal dasar umur belum lengkap'
FROM vw_asset_register WHERE age_start_date IS NULL
UNION ALL
SELECT asset_id, asset_code, asset_name, 'incomplete_data', 'Data identitas belum lengkap'
FROM vw_asset_register WHERE data_quality = 'incomplete';

-- Rekonsiliasi nilai sumber: transaksi yang belum atau sebagian dialokasikan
-- tetap tampak sehingga tidak dipaksakan menjadi Unit Aset tanpa identitas.
CREATE VIEW vw_asset_ledger_reconciliation AS
SELECT
  l.asset_ledger_line_id, l.transaction_date, l.voucher_no, l.description,
  l.debit_amount, l.reconciliation_status,
  COALESCE(SUM(a.allocated_amount), 0) AS allocated_amount,
  l.debit_amount - COALESCE(SUM(a.allocated_amount), 0) AS unallocated_amount
FROM asset_ledger_lines l
LEFT JOIN asset_ledger_allocations a ON a.asset_ledger_line_id = l.asset_ledger_line_id
GROUP BY l.asset_ledger_line_id, l.transaction_date, l.voucher_no, l.description,
         l.debit_amount, l.reconciliation_status;

-- Contoh data master. Masa pakai ini adalah target monitoring operasional.
INSERT INTO asset_categories (category_code, category_name) VALUES
  ('IT', 'Teknologi Informasi'),
  ('KDR', 'Kendaraan'),
  ('TEL', 'Telekomunikasi');

INSERT INTO asset_classes (category_id, class_code, class_name, default_useful_life_months)
SELECT category_id, class_code, class_name, useful_life
FROM (
  VALUES
    ('IT', 'PC', 'Desktop PC', 48),
    ('IT', 'MON', 'Monitor', 60),
    ('KDR', 'MBL', 'Mobil', 96),
    ('TEL', 'HP', 'Telepon Genggam', 36)
) AS x(category_code, class_code, class_name, useful_life)
JOIN asset_categories c ON c.category_code = x.category_code;

-- Contoh pencatatan satu set dari snapshot PDF 29 Agustus 2025.
INSERT INTO asset_inventory_sources (source_name, snapshot_date, source_reference)
VALUES ('Spesifikasi Komputer dan Monitor', DATE '2025-08-29', 'Spesifikasi Komputer dan Monitor.pdf');

INSERT INTO employees (employee_code, full_name) VALUES ('EMP-KOKO', 'Koko');
INSERT INTO locations (location_code, location_name, location_type) VALUES
  ('L1-ONLS', 'Lantai 1 - Office OnlineShop', 'room');
INSERT INTO asset_bundles (bundle_code, bundle_name) VALUES
  ('BND-KOKO-001', 'Set kerja Koko - Office OnlineShop');

INSERT INTO assets (asset_code, asset_class_id, inventory_source_id, asset_name, brand, initial_inventory_date, useful_life_months, data_quality, notes)
SELECT 'AST-IT-PC-0001', asset_class_id, s.inventory_source_id, 'Desktop PC Koko', 'Ipason', DATE '2025-08-29', default_useful_life_months, 'incomplete',
       'Spesifikasi sumber: GTX 1650, Intel i5-10400F, RAM 16 GB, SSD 512 GB'
FROM asset_classes CROSS JOIN asset_inventory_sources s
WHERE class_code = 'PC' AND s.source_name = 'Spesifikasi Komputer dan Monitor';
INSERT INTO assets (asset_code, asset_class_id, inventory_source_id, asset_name, brand, model, initial_inventory_date, useful_life_months, data_quality)
SELECT 'AST-IT-MON-0001', asset_class_id, s.inventory_source_id, 'Monitor Koko', 'AOC', '21 inci', DATE '2025-08-29', default_useful_life_months, 'incomplete'
FROM asset_classes CROSS JOIN asset_inventory_sources s
WHERE class_code = 'MON' AND s.source_name = 'Spesifikasi Komputer dan Monitor';

INSERT INTO asset_bundle_items (bundle_id, asset_id)
SELECT b.bundle_id, a.asset_id
FROM asset_bundles b CROSS JOIN assets a
WHERE b.bundle_code = 'BND-KOKO-001' AND a.asset_code IN ('AST-IT-PC-0001', 'AST-IT-MON-0001');

INSERT INTO asset_assignments (asset_id, employee_id, location_id, assigned_at, notes)
SELECT a.asset_id, e.employee_id, l.location_id, DATE '2025-08-29', 'Tanggal inventaris pada dokumen sumber'
FROM assets a
CROSS JOIN employees e
CROSS JOIN locations l
WHERE a.asset_code IN ('AST-IT-PC-0001', 'AST-IT-MON-0001')
  AND e.employee_code = 'EMP-KOKO'
  AND l.location_code = 'L1-ONLS';
