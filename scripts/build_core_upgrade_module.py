"""Build a data-free CAP Core module package from the current source files."""
import hashlib
import json
import shutil
import sys
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.0.17"
PACKAGE_DIR = ROOT / "release" / f"package-cap-core-{VERSION}"
OUTPUT = ROOT / "release" / f"CAP-Core-Update-{VERSION}.zip"
FILES = (
    (ROOT / "app.mjs", "payload/app.mjs", "app.mjs"),
    (ROOT / "public" / "app.js", "payload/public/app.js", "public/app.js"),
    (ROOT / "public" / "responsive-layout.css", "payload/public/responsive-layout.css", "public/responsive-layout.css"),
    (ROOT / "scripts" / "Restart-CAP-Server-Admin.ps1", "payload/scripts/Restart-CAP-Server-Admin.ps1", "scripts/Restart-CAP-Server-Admin.ps1"),
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    if PACKAGE_DIR.exists():
        shutil.rmtree(PACKAGE_DIR)
    if OUTPUT.exists():
        OUTPUT.unlink()
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
        "title": "Jabatan akun dan tata letak responsif",
        "version": VERSION,
        "description": "Menambahkan jabatan pada akun pengguna yang dapat dikelola akun master serta tata letak responsif pada zoom 75%. Data pengguna, hak akses, dan kata sandi yang ada tetap dipertahankan; aplikasi hanya menambahkan kolom jabatan kosong bila belum tersedia.",
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
