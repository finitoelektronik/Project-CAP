"""Build the installable payroll-only upgrade package for CAP Analytics."""

import hashlib
import json
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
VERSION = "1.0.13"
RELEASE = ROOT / "release" / f"package-payroll-upgrade-{VERSION}"
ZIP = ROOT / "release" / f"CAP-Payroll-Upgrade-{VERSION}.zip"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def copy_payload(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(source.read_bytes())


def main() -> None:
    payload = RELEASE / "payload"
    migrations = RELEASE / "migrations"
    if RELEASE.exists():
        import shutil
        shutil.rmtree(RELEASE)
    payload.mkdir(parents=True, exist_ok=True)
    migrations.mkdir(parents=True, exist_ok=True)

    entries = [
        (ROOT / "app.mjs", "app.mjs"),
        (ROOT / "public" / "index.html", "public/index.html"),
        (ROOT / "public" / "app.js", "public/app.js"),
        (ROOT / "scripts" / "export_payroll_excel.py", "scripts/export_payroll_excel.py"),
    ]
    files = []
    for source, target in entries:
        packaged = payload / target
        copy_payload(source, packaged)
        files.append({"source": f"payload/{target}", "target": target, "sha256": digest(packaged)})

    # Nilai Rp530.000 adalah hasil kalkulasi lama yang tersimpan pada periode
    # Teguh 5–10 Oktober. Migrasi ini sangat sempit: hanya membersihkan nilai
    # salah tersebut; perhitungan baru dari log akan mengisi Rp20.000.
    migration_path = migrations / "001-correct-teguh-october-deduction.sql"
    migration_path.write_text(
        "-- Correct legacy automatic deduction for Teguh only.\n"
        "UPDATE payroll_period_overrides SET deduction=NULL "
        "WHERE employee_id='50' AND period_start='2026-10-05' AND period_end='2026-10-10' AND deduction=530000;\n"
        "UPDATE payroll_records SET deduction=0 "
        "WHERE employee_id='50' AND deduction=530000 AND upload_id IN "
        "(SELECT id FROM payroll_uploads WHERE period LIKE '%2026-10-05~2026-10-10%');\n",
        encoding="utf-8",
        newline="\n",
    )
    migrations_list = [{
        "id": "correct-teguh-october-deduction-v113",
        "source": "migrations/001-correct-teguh-october-deduction.sql",
        "sha256": digest(migration_path),
    }]
    manifest = {
        "format": "cap-module/v1",
        "id": "payroll",
        "title": "Upgrade Gaji: Dinas & Potongan",
        "version": VERSION,
        "description": "Keterangan absensi berada pada sheet audit sendiri, dan edit IN/OUT menutup kejanggalan terkait.",
        "permissions": ["payroll"],
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
