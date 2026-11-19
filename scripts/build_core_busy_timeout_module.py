"""Build cap_core_update 1.0.18: SQLite busy_timeout fix. Data-free, ships app.mjs only."""
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.0.18"
PACKAGE_DIR = ROOT / "release" / f"package-cap-core-{VERSION}"
OUTPUT = ROOT / "release" / f"CAP-Core-Update-{VERSION}.zip"
FILES = ((ROOT / "app.mjs", "payload/app.mjs", "app.mjs"),)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    # Files are overwritten in place (no deletion), so rebuilds work where deletes are disabled.
    PACKAGE_DIR.mkdir(parents=True, exist_ok=True)
    manifest_files = []
    for source, package_source, target in FILES:
        if not source.is_file():
            raise FileNotFoundError(source)
        destination = PACKAGE_DIR / package_source
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        manifest_files.append({"source": package_source, "target": target, "sha256": digest(source)})
    manifest = {
        "format": "cap-module/v1",
        "id": "cap_core_update",
        "title": "Perbaikan database terkunci saat restart",
        "version": VERSION,
        "description": "Menambahkan PRAGMA busy_timeout = 5000 setelah database dibuka agar server menunggu hingga 5 detik, bukan langsung gagal dengan 'database is locked', saat restart atau ketika dua proses mengakses database bersamaan. Berkas yang diganti: app.mjs (satu baris ditambahkan). Migrasi database: tidak ada. Dampak pada data yang ada: tidak ada. Verifikasi: server berjalan di http://localhost:3100 dan restart berturut-turut tidak lagi menghasilkan error 'database is locked' pada startup.log. Rollback: gunakan pemulihan snapshot dari Pemasang Modul bila health check gagal.",
        "permissions": ["cap_core_update"],
        "files": manifest_files,
        "migrations": [],
    }
    (PACKAGE_DIR / "cap-module.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for item in sorted(PACKAGE_DIR.rglob("*")):
            if item.is_file():
                archive.write(item, item.relative_to(PACKAGE_DIR).as_posix())
    print(OUTPUT)


if __name__ == "__main__":
    main()
