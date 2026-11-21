"""Bangun paket upgrade Retur Online: input resi retur manual (tanpa database)."""
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.0.0"
PACKAGE_DIR = ROOT / "release" / f"package-returns-manual-input-{VERSION}"
OUTPUT = ROOT / "release" / f"CAP-Retur-Input-Resi-Manual-Upgrade-{VERSION}.zip"
TARGETS = ("app.mjs", "public/returns-manual.js", "CONTEXT.md")
DESCRIPTION = (
    "Tujuan: menambahkan input resi retur manual tanpa impor CSV pada Retur Online > Penerimaan retur. Tombol "
    "'+ Input resi manual' membuka form tanggal masuk, jasa kirim (deteksi otomatis atau pilih), dan daftar nomor resi "
    "(ketik atau scan, satu per baris, maks. 500 per simpan). Resi yang sudah ada tidak ditimpa dan ditampilkan sebagai "
    "duplikat. Hak akses: returns_incoming (sama dengan impor CSV). "
    "Berkas yang diganti: app.mjs (endpoint POST /api/returns/incoming/manual dan pemuatan skrip), "
    "public/returns-manual.js (baru), CONTEXT.md. Migrasi database: tidak ada; memakai tabel return_incoming_shipments "
    "yang sudah ada. Dampak pada data yang ada: tidak ada. "
    "Catatan: app.mjs adalah berkas inti bersama dan identik dengan app.mjs di paket WhatsApp Business 1.1.0, sehingga "
    "urutan pemasangan kedua paket bebas; pasang juga paket WhatsApp Business 1.1.0 agar berkas tampilan WhatsApp/Piutang tersedia. "
    "Verifikasi: buka Retur Online > Penerimaan retur, klik '+ Input resi manual', simpan satu resi uji, lalu pastikan "
    "resi tampil di daftar dengan jasa kirim yang benar. Rollback: gunakan pemulihan snapshot dari Pemasang Modul bila "
    "health check gagal."
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    if PACKAGE_DIR.exists():
        shutil.rmtree(PACKAGE_DIR)
    if OUTPUT.exists():
        OUTPUT.unlink()
    files = []
    for target in TARGETS:
        source = ROOT / target
        if not source.is_file():
            raise FileNotFoundError(source)
        package_source = f"payload/{target}"
        destination = PACKAGE_DIR / package_source
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        files.append({"source": package_source, "target": target, "sha256": digest(source)})
    manifest = {
        "format": "cap-module/v1",
        "id": "returns_manual_input",
        "title": "Retur Online - Input resi manual",
        "version": VERSION,
        "description": DESCRIPTION,
        "permissions": ["returns_incoming"],
        "files": files,
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
