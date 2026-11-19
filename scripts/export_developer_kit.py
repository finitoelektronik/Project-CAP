"""Membuat CAP Developer Kit tanpa database, log, snapshot, atau kredensial."""
import json
import sys
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_PARTS = {"data", "release", "tmp", ".git", "node_modules", "recovery", "snapshots", "__pycache__"}
SKIP_FILES = {"startup.log", "startup-error.log", "app.db"}
ROOT_FILES = (
    "app.mjs", "CONTEXT.md", "MODULE_PACKAGE_SPEC.md", "PANDUAN_INSTALASI.md",
    "README.md", "CODEX_MODULE_DEVELOPER_KIT.md", "DEVELOPER_AUTONOMY.md",
    "AI_MODULE_OPERATIONS.md", "developer-kit.json",
)
SOURCE_FOLDERS = ("public", "scripts", "sql", "docs", "templates")

def allowed(path: Path) -> bool:
    relative = path.relative_to(ROOT)
    return not any(part in SKIP_PARTS for part in relative.parts) and path.name not in SKIP_FILES and path.suffix.lower() not in {".db", ".log"}

def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Gunakan export_developer_kit.py <hasil.zip>")
    output = Path(sys.argv[1]).resolve()
    prefix = f"CAP-Codex-Module-Developer-Kit-{date.today().isoformat()}"
    files = []
    for name in ROOT_FILES:
        path = ROOT / name
        if path.is_file() and allowed(path): files.append(path)
    for name in SOURCE_FOLDERS:
        folder = ROOT / name
        if folder.is_dir(): files.extend(path for path in folder.rglob("*") if path.is_file() and allowed(path))
    if not files: raise SystemExit("Tidak ada source yang dapat dimasukkan ke Developer Kit.")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(set(files)):
            archive.write(path, f"{prefix}/{path.relative_to(ROOT).as_posix()}")
        archive.writestr(f"{prefix}/developer-kit-manifest.json", json.dumps({
            "format": "cap-developer-kit/v1", "created_on": date.today().isoformat(),
            "files": len(files), "database_included": False,
            "purpose": "Pengembangan, perbaikan, dan pembuatan paket modul CAP Analytics"
        }, ensure_ascii=False, indent=2) + "\n")
    print(output)

if __name__ == "__main__":
    main()
