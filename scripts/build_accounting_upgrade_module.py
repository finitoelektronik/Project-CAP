"""Build a data-free Accounting upgrade package for CAP Analytics."""
import hashlib
import json
import shutil
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
# Reinstall 1.6.1 is the baseline package.  Upgrade packages must always have
# a higher semantic version so CAP's installer can apply them afterward.
VERSION = "1.7.0"
RELEASE = ROOT / "release" / f"package-accounting-upgrade-{VERSION}"
ZIP = ROOT / "release" / f"CAP-Accounting-Upgrade-{VERSION}.zip"


SCHEMA_MIGRATION = """
-- Upgrade struktur Accounting. Tidak ada INSERT data transaksi, rekening, barang, atau jurnal.
CREATE TABLE IF NOT EXISTS accounting_inventory_documents (
  id INTEGER PRIMARY KEY, document_number TEXT NOT NULL UNIQUE, transaction_date TEXT NOT NULL,
  transaction_kind TEXT NOT NULL CHECK(transaction_kind IN ('purchase','sale','adjustment_in','adjustment_out')),
  supplier_code TEXT NOT NULL DEFAULT '', payment_mode TEXT NOT NULL DEFAULT '', counter_account_code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '', reference_number TEXT NOT NULL DEFAULT '', journal_id INTEGER NOT NULL UNIQUE REFERENCES accounting_journal_entries(id),
  created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_inventory_documents_date ON accounting_inventory_documents(transaction_date,id);
CREATE TABLE IF NOT EXISTS accounting_inventory_document_lines (
  id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES accounting_inventory_documents(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL REFERENCES accounting_items(item_code), quantity REAL NOT NULL CHECK(quantity>0), unit_price REAL NOT NULL DEFAULT 0 CHECK(unit_price>=0),
  total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount>=0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_inventory_document_lines_item ON accounting_inventory_document_lines(item_code,document_id);
CREATE TABLE IF NOT EXISTS accounting_inventory_fifo_batches (
  id INTEGER PRIMARY KEY, item_code TEXT NOT NULL REFERENCES accounting_items(item_code), receipt_line_id INTEGER NOT NULL REFERENCES accounting_inventory_document_lines(id),
  receipt_date TEXT NOT NULL, original_quantity REAL NOT NULL CHECK(original_quantity>0), remaining_quantity REAL NOT NULL CHECK(remaining_quantity>=0),
  unit_cost REAL NOT NULL CHECK(unit_cost>=0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_inventory_fifo_batches_available ON accounting_inventory_fifo_batches(item_code,receipt_date,id);
CREATE TABLE IF NOT EXISTS accounting_inventory_fifo_allocations (
  id INTEGER PRIMARY KEY, issue_line_id INTEGER NOT NULL REFERENCES accounting_inventory_document_lines(id), batch_id INTEGER NOT NULL REFERENCES accounting_inventory_fifo_batches(id),
  quantity REAL NOT NULL CHECK(quantity>0), unit_cost REAL NOT NULL CHECK(unit_cost>=0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_invoice_profiles (
  id INTEGER PRIMARY KEY CHECK(id=1), legal_name TEXT NOT NULL DEFAULT '', legal_address TEXT NOT NULL DEFAULT '', tax_id TEXT NOT NULL DEFAULT '',
  signatory_name TEXT NOT NULL DEFAULT '', sales_account_code TEXT NOT NULL DEFAULT '04.07.000.000.000.0000', vat_payable_account_code TEXT NOT NULL DEFAULT '02.05.001.000.000.0000',
  vat_rate REAL NOT NULL DEFAULT 0.11, payment_instructions TEXT NOT NULL DEFAULT '', default_due_days INTEGER NOT NULL DEFAULT 30,
  updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_invoice_customers (
  id INTEGER PRIMARY KEY, customer_name TEXT NOT NULL, customer_address TEXT NOT NULL DEFAULT '', tax_id TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  receivable_account_code TEXT NOT NULL REFERENCES accounting_accounts(account_code), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(customer_name)
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_invoices (
  id INTEGER PRIMARY KEY, invoice_number TEXT NOT NULL UNIQUE, tax_invoice_number TEXT NOT NULL DEFAULT '', transaction_date TEXT NOT NULL, due_date TEXT NOT NULL DEFAULT '',
  customer_id INTEGER NOT NULL REFERENCES accounting_invoice_customers(id), receivable_account_code TEXT NOT NULL REFERENCES accounting_accounts(account_code),
  journal_id INTEGER UNIQUE REFERENCES accounting_journal_entries(id), inventory_document_id INTEGER UNIQUE REFERENCES accounting_inventory_documents(id),
  dpp_amount REAL NOT NULL DEFAULT 0 CHECK(dpp_amount>=0), vat_amount REAL NOT NULL DEFAULT 0 CHECK(vat_amount>=0), total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount>=0),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('historical','new')), status TEXT NOT NULL CHECK(status IN ('historical','draft','posted')),
  notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_invoices_date ON accounting_invoices(transaction_date,id);
CREATE INDEX IF NOT EXISTS idx_accounting_invoices_customer ON accounting_invoices(customer_id,transaction_date);
CREATE TABLE IF NOT EXISTS accounting_invoice_lines (
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES accounting_invoices(id) ON DELETE CASCADE, item_code TEXT NOT NULL,
  item_name TEXT NOT NULL DEFAULT '', quantity REAL NOT NULL CHECK(quantity>0), unit_price REAL NOT NULL DEFAULT 0 CHECK(unit_price>=0),
  gross_amount REAL NOT NULL DEFAULT 0 CHECK(gross_amount>=0), discount_amount REAL NOT NULL DEFAULT 0 CHECK(discount_amount>=0),
  dpp_amount REAL NOT NULL DEFAULT 0 CHECK(dpp_amount>=0), vat_amount REAL NOT NULL DEFAULT 0 CHECK(vat_amount>=0), total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount>=0)
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_report_mappings (
  report_kind TEXT NOT NULL CHECK(report_kind IN ('income','balance','hpp')), account_code TEXT NOT NULL REFERENCES accounting_accounts(account_code) ON DELETE CASCADE,
  section_name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(report_kind,account_code)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_report_mappings_layout ON accounting_report_mappings(report_kind,enabled,section_name,sort_order);
CREATE TABLE IF NOT EXISTS accounting_report_special_lines (
  report_kind TEXT NOT NULL CHECK(report_kind IN ('income','balance')), source_kind TEXT NOT NULL CHECK(source_kind IN ('hpp_report','period_profit')),
  section_name TEXT NOT NULL, label TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 99999, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(report_kind,source_kind)
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_year_closings (
  closing_year INTEGER PRIMARY KEY CHECK(closing_year>=2000), closing_journal_id INTEGER REFERENCES accounting_journal_entries(id),
  opening_journal_id INTEGER REFERENCES accounting_journal_entries(id), snapshot_json TEXT NOT NULL DEFAULT '{}',
  closed_by TEXT NOT NULL DEFAULT '', closed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reclosed_at TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_year_closings_closed_at ON accounting_year_closings(closed_at DESC);
CREATE TABLE IF NOT EXISTS accounting_year_close_requests (
  id INTEGER PRIMARY KEY, closing_year INTEGER NOT NULL UNIQUE CHECK(closing_year>=2000), status TEXT NOT NULL CHECK(status IN ('submitted','returned','approved')),
  submitted_by TEXT NOT NULL DEFAULT '', submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  audit_reason TEXT NOT NULL DEFAULT '', audited_by TEXT NOT NULL DEFAULT '', audited_at TEXT NOT NULL DEFAULT '', snapshot_json TEXT NOT NULL DEFAULT '{}'
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_year_close_request_lines (
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES accounting_year_close_requests(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL, default_balance REAL NOT NULL, revised_balance REAL, final_balance REAL NOT NULL,
  UNIQUE(request_id,account_code)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_year_close_request_lines_request ON accounting_year_close_request_lines(request_id);
CREATE TABLE IF NOT EXISTS accounting_journal_year_locks (
  journal_year INTEGER PRIMARY KEY CHECK(journal_year>=2000), locked_by TEXT NOT NULL DEFAULT '', locked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_journal_archives (
  id INTEGER PRIMARY KEY, original_journal_id INTEGER NOT NULL, journal_json TEXT NOT NULL, deleted_by TEXT NOT NULL DEFAULT '', deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  restored_by TEXT NOT NULL DEFAULT '', restored_at TEXT NOT NULL DEFAULT '', restored_journal_id INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_journal_archives_deleted_at ON accounting_journal_archives(deleted_at DESC);
""".strip() + "\n"


CODE_CONVERSION_MIGRATION = """
-- Konversi kode rekening lama 2.2.2.2.2.4 ke 2.2.3.3.3.4.
-- Hanya nilai kode yang berubah; jurnal, barang, stok, dan nominal dipertahankan.
PRAGMA defer_foreign_keys=ON;
CREATE TEMP TABLE accounting_code_conversion (
  old_code TEXT PRIMARY KEY,
  new_code TEXT NOT NULL UNIQUE
);
INSERT INTO accounting_code_conversion(old_code,new_code)
SELECT account_code,
  substr(account_code,1,2)||'.'||substr(account_code,4,2)||'.'||
  printf('%03d',CAST(substr(account_code,7,2) AS INTEGER))||'.'||
  printf('%03d',CAST(substr(account_code,10,2) AS INTEGER))||'.'||
  printf('%03d',CAST(substr(account_code,13,2) AS INTEGER))||'.'||
  substr(account_code,16,4)
FROM accounting_accounts
WHERE length(account_code)=19;

UPDATE accounting_journal_lines
SET account_code=COALESCE((SELECT new_code FROM accounting_code_conversion WHERE old_code=account_code),account_code);
UPDATE accounting_accounts
SET parent_code=COALESCE((SELECT new_code FROM accounting_code_conversion WHERE old_code=parent_code),parent_code),
    counter_account_code=COALESCE((SELECT new_code FROM accounting_code_conversion WHERE old_code=counter_account_code),counter_account_code);
UPDATE accounting_legacy_items
SET debit_sales_code=COALESCE((SELECT new_code FROM accounting_code_conversion WHERE old_code=debit_sales_code),debit_sales_code),
    credit_sales_code=COALESCE((SELECT new_code FROM accounting_code_conversion WHERE old_code=credit_sales_code),credit_sales_code),
    debit_purchase_code=COALESCE((SELECT new_code FROM accounting_code_conversion WHERE old_code=debit_purchase_code),debit_purchase_code),
    credit_purchase_code=COALESCE((SELECT new_code FROM accounting_code_conversion WHERE old_code=credit_purchase_code),credit_purchase_code);
UPDATE accounting_items
SET debit_sales_code=COALESCE((SELECT new_code FROM accounting_code_conversion WHERE old_code=debit_sales_code),debit_sales_code),
    credit_sales_code=COALESCE((SELECT new_code FROM accounting_code_conversion WHERE old_code=credit_sales_code),credit_sales_code),
    debit_purchase_code=COALESCE((SELECT new_code FROM accounting_code_conversion WHERE old_code=debit_purchase_code),debit_purchase_code),
    credit_purchase_code=COALESCE((SELECT new_code FROM accounting_code_conversion WHERE old_code=credit_purchase_code),credit_purchase_code);
UPDATE accounting_inventory_documents
SET counter_account_code=COALESCE((SELECT new_code FROM accounting_code_conversion WHERE old_code=counter_account_code),counter_account_code);
UPDATE accounting_year_close_request_lines
SET account_code=COALESCE((SELECT new_code FROM accounting_code_conversion WHERE old_code=account_code),account_code);
UPDATE accounting_accounts
SET account_code=(SELECT new_code FROM accounting_code_conversion WHERE old_code=account_code)
WHERE account_code IN (SELECT old_code FROM accounting_code_conversion);
""".strip() + "\n"


SALE_JOURNAL_REPAIR_MIGRATION = """
-- Penanda pemulihan jurnal Barang Keluar 1.4.0.
-- Pemulihan data dijalankan satu kali oleh aplikasi secara atomik setelah restart.
CREATE TABLE IF NOT EXISTS accounting_runtime_repairs (
  repair_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
""".strip() + "\n"


SALE_POSTING_ACCOUNT_REPAIR_MIGRATION = """
-- Penanda pemulihan pasangan rekening Barang Keluar 1.4.5.
-- Aplikasi membangun ulang jurnal stok operasional satu kali setelah restart;
-- nominal, kuantitas, tanggal, dan nomor bukti tetap dipertahankan.
CREATE TABLE IF NOT EXISTS accounting_runtime_repairs (
  repair_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
""".strip() + "\n"


ACCUMULATED_DEPRECIATION_CLASSIFICATION_MIGRATION = """
-- Akumulasi Penyusutan adalah rekening Neraca, bukan HPP.
-- Hanya klasifikasi master rekening yang diperbaiki; jurnal dan nominal tidak diubah.
UPDATE accounting_accounts
SET account_type='Neraca',
    account_subtype=CASE WHEN account_subtype='Persediaan Bahan Baku' THEN 'Akumulasi Penyusutan' ELSE account_subtype END
WHERE account_code='01.03.000.000.000.0000'
  AND upper(account_name)='AKUMULASI PENYUSUTAN'
  AND account_type='HPP';
""".strip() + "\n"


ACCUMULATED_DEPRECIATION_ANY_TYPE_MIGRATION = """
-- Lanjutan 1.4.10: beberapa impor lama menyimpan Akumulasi Penyusutan sebagai Laba-Rugi.
-- Koreksi identitas rekening yang sama dari klasifikasi apa pun selain Neraca.
UPDATE accounting_accounts
SET account_type='Neraca',
    account_subtype=CASE WHEN account_subtype IN ('', 'Persediaan Bahan Baku') THEN 'Akumulasi Penyusutan' ELSE account_subtype END
WHERE account_code='01.03.000.000.000.0000'
  AND upper(account_name)='AKUMULASI PENYUSUTAN'
  AND account_type<>'Neraca';
""".strip() + "\n"


FINISHED_GOODS_MASTER_MAPPING_MIGRATION = """
-- Menyeragamkan konfigurasi master Barang Jadi (Dxxxx) dengan form Manajemen Barang.
-- Yang diubah hanya empat kolom pemetaan rekening pada master barang.
-- Jurnal, transaksi stok, FIFO, laporan, dan pengaturan laporan pengguna tidak diubah.
UPDATE accounting_legacy_items
SET debit_purchase_code='01.01.006.002.001.0000',
    credit_purchase_code='05.03.001.000.000.0000',
    debit_sales_code='04.01.000.000.000.0000',
    credit_sales_code='01.01.006.002.001.0000'
WHERE upper(item_code) GLOB 'D[0-9][0-9][0-9][0-9]';

UPDATE accounting_items
SET debit_purchase_code='01.01.006.002.001.0000',
    credit_purchase_code='05.03.001.000.000.0000',
    debit_sales_code='04.01.000.000.000.0000',
    credit_sales_code='01.01.006.002.001.0000',
    updated_at=CURRENT_TIMESTAMP
WHERE upper(item_code) GLOB 'D[0-9][0-9][0-9][0-9]';
""".strip() + "\n"


INVOICE_COMMERCIAL_PRINT_MIGRATION = """
-- Penambahan data untuk Invoice Komersial: tidak mengubah jurnal, stok, atau
-- nilai invoice yang sudah ada. Pengaturan pembayaran hanya dipakai cetakan.
ALTER TABLE accounting_invoice_profiles ADD COLUMN payment_instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE accounting_invoice_profiles ADD COLUMN default_due_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE accounting_invoices ADD COLUMN due_date TEXT NOT NULL DEFAULT '';
""".strip() + "\n"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def copy_payload(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(source.read_bytes())


def main() -> None:
    if RELEASE.exists():
        shutil.rmtree(RELEASE)
    payload = RELEASE / "payload"
    migrations = RELEASE / "migrations"
    payload.mkdir(parents=True)
    migrations.mkdir(parents=True)

    entries = [
        (ROOT / "app.mjs", "app.mjs"),
        (ROOT / "public" / "app.js", "public/app.js"),
        (ROOT / "public" / "responsive-layout.css", "public/responsive-layout.css"),
        (ROOT / "public" / "accounting-lite.js", "public/accounting-lite.js"),
        (ROOT / "public" / "accounting-lite.css", "public/accounting-lite.css"),
        (ROOT / "scripts" / "export_accounting_lite.py", "scripts/export_accounting_lite.py"),
        (ROOT / "scripts" / "rebuild_accounting_lite_configuration.mjs", "scripts/rebuild_accounting_lite_configuration.mjs"),
    ]
    files = []
    for source, target in entries:
        packaged = payload / target
        copy_payload(source, packaged)
        files.append({"source": f"payload/{target}", "target": target, "sha256": digest(packaged)})

    migration_path = migrations / "001-accounting-structure-only.sql"
    migration_path.write_text(SCHEMA_MIGRATION, encoding="utf-8", newline="\n")
    migrations_list = [{
        "id": "accounting-structure-only-v166",
        "source": "migrations/001-accounting-structure-only.sql",
        "sha256": digest(migration_path),
    }]
    mapping_migration_path = migrations / "002-finished-goods-master-mapping.sql"
    mapping_migration_path.write_text(FINISHED_GOODS_MASTER_MAPPING_MIGRATION, encoding="utf-8", newline="\n")
    migrations_list.append({
        "id": "finished-goods-master-mapping-v168",
        "source": "migrations/002-finished-goods-master-mapping.sql",
        "sha256": digest(mapping_migration_path),
    })
    invoice_print_migration_path = migrations / "003-invoice-commercial-print.sql"
    invoice_print_migration_path.write_text(INVOICE_COMMERCIAL_PRINT_MIGRATION, encoding="utf-8", newline="\n")
    migrations_list.append({
        "id": "invoice-commercial-print-v170",
        "source": "migrations/003-invoice-commercial-print.sql",
        "sha256": digest(invoice_print_migration_path),
    })
    manifest = {
        "format": "cap-module/v1",
        "id": "accounting_lite",
        "title": "Upgrade (Input Admin) Accounting",
        "version": VERSION,
        "description": "Perbaikan terbaru Accounting Lite, termasuk Invoice Komersial ukuran LX310 9,5 × 5,5 inci, Preview Faktur Pajak terpisah, jatuh tempo invoice, dan pengaturan teks rekening pembayaran. Paket tidak mengubah jurnal, stok, maupun nominal transaksi yang sudah ada.",
        "permissions": ["accounting_lite"],
        "files": files,
        "migrations": migrations_list,
    }
    manifest_path = RELEASE / "cap-module.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with zipfile.ZipFile(ZIP, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(manifest_path, "cap-module.json")
        for item in files:
            archive.write(RELEASE / item["source"], item["source"])
        for item in migrations_list:
            archive.write(RELEASE / item["source"], item["source"])
    print(json.dumps({"zip": str(ZIP), "bytes": ZIP.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
