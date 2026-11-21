"""Build CAP upgrade: Piutang Jakarta for Maturity Reminders."""
import hashlib
import json
import shutil
import sqlite3
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
VERSION = "1.0.19"
MODULE_ID = "maturity_reminders"
RELEASE = ROOT / "release" / f"package-maturity-reminders-jakarta-upgrade-{VERSION}"
ARCHIVE = ROOT / "release" / f"CAP-Maturity-Reminders-Piutang-Jakarta-Upgrade-{VERSION}.zip"
DATABASE = ROOT / "data" / "app.db"

TABLES = [
    "jakarta_receivable_invoices",
    "jakarta_receivable_items",
    "jakarta_receivable_payments",
    "jakarta_receivable_allocations",
    "jakarta_receivable_classifications",
    "jakarta_receivable_classification_stores",
    "jakarta_receivable_term_settings",
    "jakarta_receivable_store_terms",
    "jakarta_receivable_returns",
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS jakarta_receivable_invoices (id INTEGER PRIMARY KEY, invoice_date TEXT NOT NULL, due_date TEXT NOT NULL, invoice_number TEXT NOT NULL DEFAULT '', store_name TEXT NOT NULL, city TEXT NOT NULL DEFAULT '', sales_name TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', total REAL NOT NULL DEFAULT 0, invoice_discount REAL NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS jakarta_receivable_items (id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES jakarta_receivable_invoices(id) ON DELETE CASCADE, item_name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 0, unit_price REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS jakarta_receivable_payments (id INTEGER PRIMARY KEY, payment_date TEXT NOT NULL, amount REAL NOT NULL, payment_method TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS jakarta_receivable_allocations (payment_id INTEGER NOT NULL REFERENCES jakarta_receivable_payments(id) ON DELETE CASCADE, invoice_id INTEGER NOT NULL REFERENCES jakarta_receivable_invoices(id) ON DELETE CASCADE, amount REAL NOT NULL, PRIMARY KEY(payment_id,invoice_id));
CREATE TABLE IF NOT EXISTS jakarta_receivable_classifications (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS jakarta_receivable_classification_stores (classification_id INTEGER NOT NULL REFERENCES jakarta_receivable_classifications(id) ON DELETE CASCADE, store_name TEXT NOT NULL COLLATE NOCASE UNIQUE, PRIMARY KEY(classification_id,store_name));
CREATE TABLE IF NOT EXISTS jakarta_receivable_term_settings (id INTEGER PRIMARY KEY CHECK(id=1), default_days INTEGER NOT NULL DEFAULT 120, updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS jakarta_receivable_store_terms (store_name TEXT PRIMARY KEY COLLATE NOCASE, term_days INTEGER NOT NULL, updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS jakarta_receivable_returns (id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES jakarta_receivable_invoices(id) ON DELETE CASCADE, item_name TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', source_sheet TEXT NOT NULL DEFAULT '', source_row INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_jakarta_receivable_due ON jakarta_receivable_invoices(due_date);
""".strip()

# Server tujuan tercatat sudah memiliki tabel invoice dari paket lama, tetapi
# belum mempunyai kolom potongan nota. Paket 1.0.9 ditujukan untuk jalur itu.
LEGACY_DISCOUNT_COMPATIBILITY = "ALTER TABLE jakarta_receivable_invoices ADD COLUMN invoice_discount REAL NOT NULL DEFAULT 0;"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sql_value(value):
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def data_migration(path: Path) -> None:
    db = sqlite3.connect(DATABASE)
    try:
        lines = ["-- Piutang Jakarta data snapshot exported from CAP.", "PRAGMA foreign_keys = ON;", SCHEMA, LEGACY_DISCOUNT_COMPATIBILITY, ""]
        for table in TABLES:
            columns = [row[1] for row in db.execute(f"PRAGMA table_info({table})")]
            rows = db.execute(f"SELECT {','.join(columns)} FROM {table}").fetchall()
            lines.append(f"-- {table}: {len(rows)} records")
            for row in rows:
                names = ",".join(columns)
                values = ",".join(sql_value(value) for value in row)
                lines.append(f"INSERT OR IGNORE INTO {table} ({names}) VALUES ({values});")
            lines.append("")
        path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    finally:
        db.close()


def main() -> None:
    if not DATABASE.exists():
        raise FileNotFoundError(f"Database tidak ditemukan: {DATABASE}")
    if RELEASE.exists():
        shutil.rmtree(RELEASE)
    RELEASE.mkdir(parents=True)
    payload = RELEASE / "payload"
    migrations = RELEASE / "migrations"
    payload.mkdir()
    migrations.mkdir()

    entries = [
        (ROOT / "app.mjs", "app.mjs"),
        (ROOT / "public" / "maturity-reminders.js", "public/maturity-reminders.js"),
        (ROOT / "public" / "jakarta-receivables.js", "public/jakarta-receivables.js"),
        (ROOT / "public" / "jakarta-receivables.css", "public/jakarta-receivables.css"),
        (ROOT / "public" / "piutang-labels.js", "public/piutang-labels.js"),
        (ROOT / "scripts" / "export_jakarta_receivables.py", "scripts/export_jakarta_receivables.py"),
        (ROOT / "scripts" / "extract_jakarta_receivables.py", "scripts/extract_jakarta_receivables.py"),
        (ROOT / "scripts" / "reconcile_jakarta_receivables.py", "scripts/reconcile_jakarta_receivables.py"),
        (ROOT / "CONTEXT.md", "CONTEXT.md"),
    ]
    files = []
    for source, target in entries:
        destination = payload / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        files.append({"source": f"payload/{target}", "target": target, "sha256": digest(destination)})

    migration = migrations / "001-add-jakarta-store-master.sql"
    migration.write_text(
        "CREATE TABLE IF NOT EXISTS jakarta_receivable_stores (store_name TEXT PRIMARY KEY COLLATE NOCASE, created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);\n"
        "INSERT OR IGNORE INTO jakarta_receivable_stores(store_name,created_by) SELECT DISTINCT trim(store_name),'data-piutang' FROM jakarta_receivable_invoices WHERE trim(store_name)<>'';\n",
        encoding="utf-8", newline="\n")
    migration_item = {"id": "add-jakarta-store-master-v112", "source": "migrations/001-add-jakarta-store-master.sql", "sha256": digest(migration)}
    manifest = {
        "format": "cap-module/v1",
        "id": MODULE_ID,
        "title": "Upgrade Piutang Jakarta",
        "version": VERSION,
        "description": (
            "Versi 1.0.19 - (1) Tombol Batal dan x di semua dialog Piutang Jakarta menutup dialog tanpa menyimpan; tombol x di kanan atas dan Batal bergaya sekunder. (2) Lebih bayar dicatat beserta rinciannya pada catatan nota terakhir dan tampil di Rincian invoice (perubahan backend saveJakartaPayment). (3) Dari 1.0.18 - Catat pembayaran Piutang Jakarta: nota dicari berdasarkan nama toko atau nomor invoice, "
            "ringkasan total nota/nominal pembayaran/dialokasikan, nominal pembayaran baru yang dibagi berurutan dari nota "
            "pertama (nota terakhir dapat terbayar sebagian), konfirmasi bila ada nota tanpa alokasi, dan konfirmasi bila "
            "lebih bayar (kelebihan dicatat di catatan, tidak dialokasikan). Berkas yang diganti: public/jakarta-receivables.js "
            "(perubahan utama), app.mjs, public/maturity-reminders.js, public/jakarta-receivables.css, public/piutang-labels.js, "
            "skrip Piutang Jakarta, CONTEXT.md. app.mjs identik dengan paket WhatsApp Business 1.1.1 dan Retur Input Resi "
            "Manual 1.0.1, sehingga urutan pemasangan bebas. Migrasi: hanya 001-add-jakarta-store-master (idempoten, sudah ada sejak versi sebelumnya). Dampak "
            "pada data: tidak ada; pembayaran lama tetap. Verifikasi: Piutang > Piutang Jakarta > Terapkan > Catat pembayaran, "
            "cari nota, isi nominal, pastikan alokasi sesuai. Rollback: pemulihan snapshot dari Pemasang Modul."
        ),
        "permissions": ["maturity_reminders"],
        "files": files,
        "migrations": [migration_item],
    }
    manifest_path = RELEASE / "cap-module.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    if ARCHIVE.exists():
        ARCHIVE.unlink()
    with zipfile.ZipFile(ARCHIVE, "w", compression=zipfile.ZIP_DEFLATED) as package:
        package.write(manifest_path, "cap-module.json")
        for file in files:
            package.write(RELEASE / file["source"], file["source"])
        package.write(RELEASE / migration_item["source"], migration_item["source"])
    print(json.dumps({"archive": str(ARCHIVE), "bytes": ARCHIVE.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
