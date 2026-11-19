"""Build the one-time Accounting Lite destructive reinstall module.

The CAP module installer snapshots the server before applying this package.
At the first restart, the delivered app replaces only SQLite tables prefixed
``accounting_`` with the corresponding tables from the local source database.
"""

import hashlib
import json
import shutil
import sqlite3
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
VERSION = "1.6.1"
PACKAGE_ID = "accounting_lite"
RELEASE = ROOT / "release" / f"package-accounting-lite-reinstall-{VERSION}"
ARCHIVE = ROOT / "release" / f"CAP-Accounting-Lite-Reinstall-{VERSION}.zip"
DATABASE = ROOT / "data" / "app.db"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def copy_payload(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def build_accounting_database(source_path: Path, destination_path: Path) -> None:
    """Create a compact SQLite payload containing only Accounting Lite tables."""
    if destination_path.exists():
        destination_path.unlink()
    with sqlite3.connect(source_path) as source, sqlite3.connect(destination_path) as output:
        objects = source.execute(
            "SELECT type,name,sql FROM sqlite_master "
            "WHERE type IN ('table','index','trigger') AND name LIKE 'accounting_%' "
            "AND sql IS NOT NULL "
            "ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name"
        ).fetchall()
        tables = [(name, sql) for kind, name, sql in objects if kind == "table"]
        if not tables:
            raise ValueError("Database lokal tidak memiliki tabel Accounting Lite.")
        output.execute("PRAGMA foreign_keys=OFF")
        for _, sql in tables:
            output.execute(sql)
        for name, _ in tables:
            columns = [row[1] for row in source.execute(f'PRAGMA table_info("{name}")')]
            if not columns:
                continue
            quoted = ",".join(f'"{column}"' for column in columns)
            rows = source.execute(f'SELECT {quoted} FROM "{name}"').fetchall()
            if rows:
                placeholders = ",".join("?" for _ in columns)
                output.executemany(f'INSERT INTO "{name}" ({quoted}) VALUES ({placeholders})', rows)
        for kind, _, sql in objects:
            if kind != "table":
                output.execute(sql)
        output.execute("PRAGMA foreign_keys=ON")
        violations = output.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise ValueError(f"Payload Accounting memiliki {len(violations)} pelanggaran foreign key.")
        output.commit()


def main() -> None:
    if not DATABASE.is_file():
        raise SystemExit("Database lokal data/app.db tidak ditemukan.")
    if RELEASE.exists():
        shutil.rmtree(RELEASE)
    RELEASE.mkdir(parents=True)
    payload = RELEASE / "payload"
    migrations = RELEASE / "migrations"
    migrations.mkdir()

    accounting_database = RELEASE / "database" / "accounting-lite-local.db"
    accounting_database.parent.mkdir(parents=True, exist_ok=True)
    build_accounting_database(DATABASE, accounting_database)
    entries = [
        (ROOT / "app.mjs", "app.mjs"),
        (ROOT / "public" / "app.js", "public/app.js"),
        (ROOT / "public" / "responsive-layout.css", "public/responsive-layout.css"),
        (ROOT / "public" / "accounting-lite.js", "public/accounting-lite.js"),
        (ROOT / "public" / "accounting-lite.css", "public/accounting-lite.css"),
        (ROOT / "scripts" / "export_accounting_lite.py", "scripts/export_accounting_lite.py"),
        # The installer allows payload under modules/. This compact database
        # includes all and only accounting_* tables from the local server.
        (accounting_database, "modules/accounting_lite/reinstall/accounting-lite-local.db"),
    ]
    files = []
    for source, target in entries:
        packaged = payload / target
        copy_payload(source, packaged)
        files.append({"source": f"payload/{target}", "target": target, "sha256": digest(packaged)})

    migration = migrations / "001-request-local-accounting-reinstall.sql"
    migration.write_text(
        "-- Permintaan pemulihan eksplisit. Penghapusan dan impor dilakukan atomik\n"
        "-- oleh app.mjs setelah paket dan database payload tersedia.\n"
        "INSERT INTO settings(key,value) VALUES ('accounting_local_reinstall_v160','pending')\n"
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value;\n",
        encoding="utf-8",
        newline="\n",
    )
    migrations_list = [{
        "id": "request-local-accounting-reinstall-v161",
        "source": "migrations/001-request-local-accounting-reinstall.sql",
        "sha256": digest(migration),
    }]
    manifest = {
        "format": "cap-module/v1",
        "id": PACKAGE_ID,
        "title": "Instal Ulang Accounting Lite dengan Data Operasional 2026",
        "version": VERSION,
        "description": "Paket satu kali yang membuat snapshot otomatis, lalu memasang ulang Accounting Lite beserta database Accounting lokal. Database mencakup Januari yang dipertahankan dan input operasional Februari–Oktober 2026; data modul lain dipertahankan.",
        "permissions": ["accounting_lite"],
        "files": files,
        "migrations": migrations_list,
    }
    manifest_path = RELEASE / "cap-module.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with zipfile.ZipFile(ARCHIVE, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.write(manifest_path, "cap-module.json")
        for item in files:
            archive.write(RELEASE / item["source"], item["source"])
        for item in migrations_list:
            archive.write(RELEASE / item["source"], item["source"])
    print(json.dumps({"zip": str(ARCHIVE), "bytes": ARCHIVE.stat().st_size, "database_bytes": DATABASE.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
