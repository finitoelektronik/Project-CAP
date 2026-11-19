"""Validasi dan ekstraksi aman Paket Modul CAP Analytics.

Format paket:
  cap-module.json
  payload/<berkas yang dicantumkan dalam manifest>
  migrations/<berkas SQL opsional>
"""
import hashlib
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path, PurePosixPath

MODULE_ID = re.compile(r"^[a-z][a-z0-9_]{1,80}$")
VERSION = re.compile(r"^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$")
SAFE_TARGET = re.compile(r"^(app\.mjs|CONTEXT\.md|public/[A-Za-z0-9_./-]+|scripts/[A-Za-z0-9_./-]+|modules/[A-Za-z0-9_./-]+)$")
FORBIDDEN_SQL = re.compile(r"\b(drop\s+(table|index|trigger|view)|delete\s+from|truncate|vacuum)\b", re.I)


def fail(message):
    raise ValueError(message)


def safe_member(name):
    path = PurePosixPath(name)
    return not path.is_absolute() and ".." not in path.parts and not name.startswith("/")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def sql_without_literals(sql):
    """Hilangkan literal dan komentar sebelum pemeriksaan perintah destruktif."""
    result, index, quoted = [], 0, False
    while index < len(sql):
        char = sql[index]
        if quoted:
            if char == "'" and index + 1 < len(sql) and sql[index + 1] == "'":
                index += 2
                continue
            if char == "'":
                quoted = False
            index += 1
            continue
        if char == "'":
            quoted = True
            index += 1
            continue
        if sql.startswith("--", index):
            newline = sql.find("\n", index)
            index = len(sql) if newline < 0 else newline + 1
            continue
        result.append(char)
        index += 1
    return "".join(result)


def inspect_package(source):
    with zipfile.ZipFile(source) as archive:
        names = {item.filename for item in archive.infolist() if not item.is_dir()}
        if "cap-module.json" not in names:
            fail("cap-module.json tidak ditemukan di paket.")
        try:
            manifest = json.loads(archive.read("cap-module.json").decode("utf-8"))
        except Exception as error:
            fail(f"Manifest paket tidak valid: {error}")
        if manifest.get("format") != "cap-module/v1":
            fail("Format paket harus cap-module/v1.")
        module_id = str(manifest.get("id", ""))
        if not MODULE_ID.fullmatch(module_id):
            fail("ID modul tidak valid.")
        if not str(manifest.get("title", "")).strip():
            fail("Nama modul wajib diisi.")
        if not VERSION.fullmatch(str(manifest.get("version", ""))):
            fail("Versi modul harus memakai format x.y.z.")
        files = manifest.get("files")
        if not isinstance(files, list) or not files:
            fail("Manifest harus mencantumkan sedikitnya satu berkas.")
        checked_files = []
        for entry in files:
            if not isinstance(entry, dict):
                fail("Daftar berkas tidak valid.")
            source_name, target, checksum = str(entry.get("source", "")), str(entry.get("target", "")), str(entry.get("sha256", "")).lower()
            if not source_name.startswith("payload/") or not safe_member(source_name) or source_name not in names:
                fail(f"Berkas sumber tidak tersedia: {source_name}")
            if not SAFE_TARGET.fullmatch(target) or ".." in PurePosixPath(target).parts:
                fail(f"Target berkas tidak diizinkan: {target}")
            actual = sha256(archive.read(source_name))
            if not re.fullmatch(r"[0-9a-f]{64}", checksum) or actual != checksum:
                fail(f"Checksum tidak cocok: {source_name}")
            checked_files.append({"source": source_name, "target": target, "sha256": actual})
        migrations = manifest.get("migrations", [])
        if not isinstance(migrations, list):
            fail("Daftar migrasi tidak valid.")
        checked_migrations = []
        seen = set()
        for entry in migrations:
            migration_id, source_name, checksum = str(entry.get("id", "")), str(entry.get("source", "")), str(entry.get("sha256", "")).lower()
            if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{1,100}", migration_id) or migration_id in seen:
                fail("ID migrasi tidak valid atau berulang.")
            seen.add(migration_id)
            if not source_name.startswith("migrations/") or not source_name.endswith(".sql") or not safe_member(source_name) or source_name not in names:
                fail(f"Migrasi tidak tersedia: {source_name}")
            content = archive.read(source_name)
            if sha256(content) != checksum or not re.fullmatch(r"[0-9a-f]{64}", checksum):
                fail(f"Checksum migrasi tidak cocok: {source_name}")
            sql = content.decode("utf-8")
            if FORBIDDEN_SQL.search(sql_without_literals(sql)):
                fail(f"Migrasi {migration_id} mengandung operasi penghapusan data/struktur.")
            checked_migrations.append({"id": migration_id, "source": source_name, "sha256": checksum})
        return {
            "id": module_id,
            "title": str(manifest["title"]).strip(),
            "version": str(manifest["version"]),
            "description": str(manifest.get("description", "")).strip()[:500],
            "permissions": [str(item) for item in manifest.get("permissions", []) if MODULE_ID.fullmatch(str(item))],
            "files": checked_files,
            "migrations": checked_migrations,
            "checksum": sha256(Path(source).read_bytes()),
        }


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in {"inspect", "extract"}:
        fail("Gunakan inspect <zip> [hasil] atau extract <zip> <folder> [hasil].")
    command, source = sys.argv[1], Path(sys.argv[2])
    result = inspect_package(source)
    if command == "extract":
        target = Path(sys.argv[3])
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(source) as archive:
            for entry in [*result["files"], *result["migrations"]]:
                name = entry["source"]
                if not safe_member(name):
                    fail("Nama berkas ZIP tidak aman.")
                destination = target / Path(*PurePosixPath(name).parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(archive.read(name))
    output_index = 4 if command == "extract" else 3
    if len(sys.argv) > output_index:
        Path(sys.argv[output_index]).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    else:
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
