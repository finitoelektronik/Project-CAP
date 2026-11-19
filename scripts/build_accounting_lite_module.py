"""Build the installable Accounting Lite / Test DB CAP module package."""
import hashlib
import json
import sqlite3
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATABASE = ROOT / "data" / "app.db"
VERSION = "1.2.4"
RELEASE = ROOT / "release" / f"package-accounting-lite-{VERSION}"
ZIP = ROOT / "release" / f"CAP-Accounting-Lite-{VERSION}.zip"

TABLES = [
    "accounting_accounts", "accounting_journal_entries", "accounting_journal_lines",
    "accounting_legacy_items", "accounting_legacy_suppliers", "accounting_legacy_inventory_transactions",
    "accounting_legacy_inventory_lines", "accounting_import_audits", "accounting_items", "accounting_suppliers", "accounting_account_code_settings",
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounting_accounts (
  account_code TEXT PRIMARY KEY, account_name TEXT NOT NULL, level_name TEXT NOT NULL DEFAULT '', parent_code TEXT NOT NULL DEFAULT '', account_status TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', account_type TEXT NOT NULL DEFAULT '', account_subtype TEXT NOT NULL DEFAULT '', is_group INTEGER NOT NULL DEFAULT 0, counter_account_code TEXT NOT NULL DEFAULT '', legacy_user_id TEXT NOT NULL DEFAULT '', legacy_date TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_journal_entries (
  id INTEGER PRIMARY KEY, voucher_number TEXT NOT NULL UNIQUE, transaction_date TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0, transaction_type TEXT NOT NULL DEFAULT '', legacy_user_id TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('legacy','manual')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_journals_date ON accounting_journal_entries(transaction_date);
CREATE TABLE IF NOT EXISTS accounting_journal_lines (
  id INTEGER PRIMARY KEY, journal_id INTEGER NOT NULL REFERENCES accounting_journal_entries(id) ON DELETE CASCADE, account_code TEXT NOT NULL REFERENCES accounting_accounts(account_code), description TEXT NOT NULL DEFAULT '', debit REAL NOT NULL DEFAULT 0 CHECK(debit>=0), credit REAL NOT NULL DEFAULT 0 CHECK(credit>=0), legacy_line_id INTEGER UNIQUE, legacy_timestamp TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK((debit=0) != (credit=0))
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_lines_journal ON accounting_journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_accounting_lines_account ON accounting_journal_lines(account_code);
CREATE TABLE IF NOT EXISTS accounting_legacy_items (
  item_code TEXT PRIMARY KEY, item_name TEXT NOT NULL DEFAULT '', item_type TEXT NOT NULL DEFAULT '', debit_sales_code TEXT NOT NULL DEFAULT '', credit_sales_code TEXT NOT NULL DEFAULT '', debit_purchase_code TEXT NOT NULL DEFAULT '', credit_purchase_code TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_legacy_suppliers (
  supplier_code TEXT PRIMARY KEY, supplier_name TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_items (
  item_code TEXT PRIMARY KEY, item_name TEXT NOT NULL, item_type TEXT NOT NULL DEFAULT '', debit_sales_code TEXT NOT NULL DEFAULT '', credit_sales_code TEXT NOT NULL DEFAULT '', debit_purchase_code TEXT NOT NULL DEFAULT '', credit_purchase_code TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_suppliers (
  supplier_code TEXT PRIMARY KEY, supplier_name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_legacy_inventory_transactions (
  voucher_number TEXT PRIMARY KEY, bc23 TEXT NOT NULL DEFAULT '', container_number TEXT NOT NULL DEFAULT '', transaction_date TEXT NOT NULL DEFAULT '', supplier_code TEXT NOT NULL DEFAULT '', exchange_type TEXT NOT NULL DEFAULT '', exchange_value REAL NOT NULL DEFAULT 0, import_duty REAL NOT NULL DEFAULT 0, total_amount REAL NOT NULL DEFAULT 0, total_purchase REAL NOT NULL DEFAULT 0, transaction_type INTEGER, description TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_legacy_inventory_lines (
  id INTEGER PRIMARY KEY, legacy_line_id INTEGER NOT NULL DEFAULT 0, voucher_number TEXT NOT NULL, item_code TEXT NOT NULL DEFAULT '', quantity REAL NOT NULL DEFAULT 0, unit_price REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0, exchange_type TEXT NOT NULL DEFAULT '', exchange_value REAL NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_import_audits (
  id INTEGER PRIMARY KEY, source_name TEXT NOT NULL UNIQUE, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, account_count INTEGER NOT NULL DEFAULT 0, journal_count INTEGER NOT NULL DEFAULT 0, journal_line_count INTEGER NOT NULL DEFAULT 0, total_debit REAL NOT NULL DEFAULT 0, total_credit REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_account_code_settings (
  id INTEGER PRIMARY KEY CHECK(id=1), segment_lengths TEXT NOT NULL DEFAULT '2.2.3.3.3.4', updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
INSERT OR IGNORE INTO accounting_account_code_settings (id,segment_lengths) VALUES (1,'2.2.3.3.3.4');
""".strip()


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def migration(connection):
    statements = [
        "-- Accounting Lite historical data migration. This migration only adds data and schema.",
        "PRAGMA foreign_keys=ON;",
        SCHEMA,
    ]
    for table in TABLES:
        columns = [row[1] for row in connection.execute(f"PRAGMA table_info({table})")]
        if not columns:
            continue
        rows = connection.execute(f"SELECT {','.join(columns)} FROM {table}").fetchall()
        for row in rows:
            statements.append(
                f"INSERT OR IGNORE INTO {table} ({','.join(columns)}) VALUES ({','.join(literal(value) for value in row)});"
            )
    return "\n".join(statements) + "\n"


def create_module_database(source, target):
    if target.exists():
        target.unlink()
    with sqlite3.connect(target) as output:
        output.executescript(SCHEMA)
        output.execute("PRAGMA foreign_keys=OFF")
        for table in TABLES:
            columns = [row[1] for row in source.execute(f"PRAGMA table_info({table})")]
            if not columns:
                continue
            rows = source.execute(f"SELECT {','.join(columns)} FROM {table}").fetchall()
            if not rows:
                continue
            placeholders = ",".join("?" for _ in columns)
            output.executemany(
                f"INSERT OR IGNORE INTO {table} ({','.join(columns)}) VALUES ({placeholders})",
                rows,
            )
        output.commit()


def main():
    if not DATABASE.exists():
        raise SystemExit("data/app.db tidak ditemukan. Jalankan migrasi akuntansi terlebih dahulu.")
    RELEASE.mkdir(parents=True, exist_ok=True)
    payload = RELEASE / "payload" / "public"
    migrations = RELEASE / "migrations"
    database = RELEASE / "database"
    payload.mkdir(parents=True, exist_ok=True)
    migrations.mkdir(parents=True, exist_ok=True)
    database.mkdir(parents=True, exist_ok=True)
    (RELEASE / "payload" / "app.mjs").write_bytes((ROOT / "app.mjs").read_bytes())
    (payload / "app.js").write_bytes((ROOT / "public" / "app.js").read_bytes())
    (payload / "accounting-lite.js").write_bytes((ROOT / "public" / "accounting-lite.js").read_bytes())
    (payload / "accounting-lite.css").write_bytes((ROOT / "public" / "accounting-lite.css").read_bytes())
    script_payload = RELEASE / "payload" / "scripts"
    script_payload.mkdir(parents=True, exist_ok=True)
    (script_payload / "export_accounting_lite.py").write_bytes((ROOT / "scripts" / "export_accounting_lite.py").read_bytes())
    with sqlite3.connect(DATABASE) as connection:
        content = migration(connection)
        create_module_database(connection, database / "accounting-lite-data.db")
    migration_path = migrations / "001-create-and-import-accounting-lite.sql"
    migration_path.write_text(content, encoding="utf-8", newline="\n")
    files = [
        {"source": "payload/app.mjs", "target": "app.mjs", "sha256": digest(RELEASE / "payload" / "app.mjs")},
        {"source": "payload/public/app.js", "target": "public/app.js", "sha256": digest(payload / "app.js")},
        {"source": "payload/public/accounting-lite.js", "target": "public/accounting-lite.js", "sha256": digest(payload / "accounting-lite.js")},
        {"source": "payload/public/accounting-lite.css", "target": "public/accounting-lite.css", "sha256": digest(payload / "accounting-lite.css")},
        {"source": "payload/scripts/export_accounting_lite.py", "target": "scripts/export_accounting_lite.py", "sha256": digest(script_payload / "export_accounting_lite.py")},
    ]
    migration_id = f"create-and-import-accounting-lite-v{VERSION.replace('.', '')}"
    manifest = {
        "format": "cap-module/v1",
        "id": "accounting_lite",
        "title": "Accounting Lite / Test DB",
        "version": VERSION,
        "description": "Migrasi histori akuntansi, pencatatan jurnal baru, laporan, dan tampilan Accounting Lite.",
        "permissions": ["accounting_lite"],
        "files": files,
        "migrations": [{"id": migration_id, "source": "migrations/001-create-and-import-accounting-lite.sql", "sha256": digest(migration_path)}],
    }
    manifest_path = RELEASE / "cap-module.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with zipfile.ZipFile(ZIP, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for source in [manifest_path, RELEASE / "payload" / "app.mjs", payload / "app.js", payload / "accounting-lite.js", payload / "accounting-lite.css", script_payload / "export_accounting_lite.py", migration_path, database / "accounting-lite-data.db"]:
            archive.write(source, source.relative_to(RELEASE).as_posix())
    print(json.dumps({"zip": str(ZIP), "migration_bytes": migration_path.stat().st_size, "zip_bytes": ZIP.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
