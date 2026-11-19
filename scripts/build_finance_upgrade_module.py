"""Build the CAP Analytics Finance upgrade module package."""
import hashlib
import json
import shutil
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
VERSION = "1.5.0"
RELEASE = ROOT / "release" / f"package-finance-upgrade-{VERSION}"
ZIP = ROOT / "release" / f"CAP-Finance-Upgrade-{VERSION}.zip"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    if RELEASE.exists():
        shutil.rmtree(RELEASE)
    payload = RELEASE / "payload"
    payload.mkdir(parents=True)
    entries = [
        (ROOT / "app.mjs", "app.mjs"),
        (ROOT / "public" / "app.js", "public/app.js"),
        (ROOT / "scripts" / "export_petty_cash_excel.py", "scripts/export_petty_cash_excel.py"),
    ]
    files = []
    for source, target in entries:
        packaged = payload / target
        packaged.parent.mkdir(parents=True, exist_ok=True)
        packaged.write_bytes(source.read_bytes())
        files.append({"source": f"payload/{target}", "target": target, "sha256": digest(packaged)})

    manifest = {
        "format": "cap-module/v1",
        "id": "finance_upgrade",
        "title": "Upgrade Modul Keuangan",
        "version": VERSION,
        "description": "Impor Rekap Kas Harian, ekspor Kas Kecil, stok kebutuhan kantor mandiri, kartu stok bulanan, dan laporan penggunaan tahunan berdasarkan unit atau nilai.",
        "permissions": ["finance", "finance_petty_cash", "finance_company_expenses", "finance_office_stock"],
        "files": files,
        "migrations": [],
    }
    manifest_path = RELEASE / "cap-module.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with zipfile.ZipFile(ZIP, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(manifest_path, "cap-module.json")
        for item in files:
            archive.write(RELEASE / item["source"], item["source"])
    print(json.dumps({"zip": str(ZIP), "bytes": ZIP.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
