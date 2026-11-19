"""Membuat dan memeriksa paket cadangan database CAP Analytics."""
import hashlib
import json
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


def digest(path):
    value = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def load_manifest(archive):
    names = {item.filename for item in archive.infolist() if not item.is_dir()}
    if "cap-database.json" not in names:
        raise ValueError("Berkas bukan paket cadangan database CAP.")
    manifest = json.loads(archive.read("cap-database.json").decode("utf-8"))
    if manifest.get("format") != "cap-database/v1":
        raise ValueError("Format paket database tidak didukung.")
    database_file = str(manifest.get("database_file", ""))
    path = PurePosixPath(database_file)
    if database_file != "database/app.db" or path.is_absolute() or ".." in path.parts or database_file not in names:
        raise ValueError("Berkas database pada paket tidak valid.")
    expected = str(manifest.get("sha256", "")).lower()
    actual = hashlib.sha256(archive.read(database_file)).hexdigest()
    if len(expected) != 64 or expected != actual:
        raise ValueError("Checksum database tidak cocok.")
    return manifest


def create(database, output):
    source = Path(database)
    if not source.is_file():
        raise ValueError("Database CAP tidak ditemukan.")
    manifest = {
        "format": "cap-database/v1",
        "application": "CAP Analytics",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "database_file": "database/app.db",
        "sha256": digest(source),
        "size": source.stat().st_size,
    }
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("cap-database.json", json.dumps(manifest, indent=2))
        archive.write(source, "database/app.db")


def inspect(source, output):
    with zipfile.ZipFile(source) as archive:
        manifest = load_manifest(archive)
    Path(output).write_text(json.dumps(manifest), encoding="utf-8")


def extract(source, destination):
    target = Path(destination)
    with zipfile.ZipFile(source) as archive:
        load_manifest(archive)
        output = target / "database" / "app.db"
        output.parent.mkdir(parents=True, exist_ok=True)
        with archive.open("database/app.db") as source_file, output.open("wb") as destination_file:
            shutil.copyfileobj(source_file, destination_file)


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        if command == "create" and len(sys.argv) == 4:
            create(sys.argv[2], sys.argv[3])
        elif command == "inspect" and len(sys.argv) == 4:
            inspect(sys.argv[2], sys.argv[3])
        elif command == "extract" and len(sys.argv) == 4:
            extract(sys.argv[2], sys.argv[3])
        else:
            raise ValueError("Perintah paket database tidak valid.")
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
