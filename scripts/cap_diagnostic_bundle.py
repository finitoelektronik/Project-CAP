"""Membuat ZIP diagnostik CAP dari berkas JSON dan salinan database opsional."""
import json
import shutil
import sys
import zipfile
from pathlib import Path


def main():
    source, output = Path(sys.argv[1]), Path(sys.argv[2])
    payload = json.loads(source.read_text(encoding="utf-8"))
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("cap-diagnostic.json", json.dumps(payload.get("diagnostic", {}), ensure_ascii=False, indent=2))
        archive.writestr("README.txt", "Paket Diagnostik CAP Analytics. Kirimkan file ini ke chat Codex untuk pemeriksaan.\n")
        database = payload.get("database")
        if database and Path(database).exists():
            archive.write(database, "app.db")


if __name__ == "__main__":
    main()
