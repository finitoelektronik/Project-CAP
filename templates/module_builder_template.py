"""Template pembuat paket CAP Analytics tanpa data produksi.

Salin file ini dan isi nilai MODULE_* serta FILES. Paket baru dibuat hanya
saat pengguna telah meminta ZIP instalasi secara eksplisit.
"""
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_ID = "nama_modul"
VERSION = "1.0.0"
TITLE = "Nama Modul"
DESCRIPTION = "Ringkasan fungsi serta dampak datanya."
OUTPUT = ROOT / "release" / f"{MODULE_ID}-{VERSION}.zip"

# (berkas sumber di workspace, lokasi di ZIP, target setelah pemasangan)
FILES = (
    # (ROOT / "public" / "nama-modul.js", "payload/public/nama-modul.js", "public/nama-modul.js"),
)
MIGRATIONS = (
    # ("add_nama_modul_table", ROOT / "sql" / "001-nama-modul.sql", "migrations/001-nama-modul.sql"),
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    if not FILES:
        raise ValueError("Isi sedikitnya satu berkas payload sebelum membuat paket.")
    OUTPUT.parent.mkdir(exist_ok=True)
    manifest_files, manifest_migrations = [], []
    with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for source, package_path, target in FILES:
            if not source.is_file():
                raise FileNotFoundError(source)
            archive.write(source, package_path)
            manifest_files.append({"source": package_path, "target": target, "sha256": sha256(source)})
        for migration_id, source, package_path in MIGRATIONS:
            if not source.is_file():
                raise FileNotFoundError(source)
            archive.write(source, package_path)
            manifest_migrations.append({"id": migration_id, "source": package_path, "sha256": sha256(source)})
        manifest = {
            "format": "cap-module/v1",
            "id": MODULE_ID,
            "title": TITLE,
            "version": VERSION,
            "description": DESCRIPTION,
            "permissions": [MODULE_ID],
            "files": manifest_files,
            "migrations": manifest_migrations,
        }
        archive.writestr("cap-module.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(OUTPUT)


if __name__ == "__main__":
    main()
