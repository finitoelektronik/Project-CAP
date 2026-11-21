"""Build a data-free CAP Core module package from the current source files."""
import hashlib
import json
import shutil
import sys
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.0.19"
PACKAGE_DIR = ROOT / "release" / f"package-cap-core-{VERSION}"
OUTPUT = ROOT / "release" / f"CAP-Core-Update-{VERSION}.zip"
FILES = (
    (ROOT / "app.mjs", "payload/app.mjs", "app.mjs"),
    (ROOT / "modules" / "_core" / "module-loader.mjs", "payload/modules/_core/module-loader.mjs", "modules/_core/module-loader.mjs"),
    (ROOT / "modules" / "README.md", "payload/modules/README.md", "modules/README.md"),
    (ROOT / "public" / "app.js", "payload/public/app.js", "public/app.js"),
    (ROOT / "CONTEXT.md", "payload/CONTEXT.md", "CONTEXT.md"),
)
TITLE = "Kerangka modul inti & pemisahan Gaji-Kas Kecil"
DESCRIPTION = (
    "Tujuan: (1) kerangka pemuat modul inti - modul di modules/<id>/ (module.json, server.mjs, public/) dimuat saat start, "
    "rute /api/modules/<id>/... dengan pemeriksaan login & hak akses oleh inti, aset /modules/<id>/..., registri layanan "
    "antar-modul, modul yang gagal dimuat dilewati tanpa menghentikan inti/modul lain, status di /api/core/modules (master). "
    "Saat ini belum ada modul yang dipindah, sehingga perilaku aplikasi tidak berubah. (2) Gaji gudang tidak lagi membuat "
    "atau mengubah transaksi Kas Kecil saat log pembayaran gaji disimpan; transaksi Kas Kecil lama tetap tersimpan. "
    "Berkas yang diganti: app.mjs, modules/_core/module-loader.mjs (baru), modules/README.md (baru), public/app.js, CONTEXT.md. "
    "Migrasi database: tidak ada. Dampak pada data yang ada: tidak ada (diverifikasi: 25 API baca identik, struktur dan isi "
    "116 tabel identik setelah start pada salinan database). app.mjs ini memuat backend semua fitur terbaru (WhatsApp 1.1.1, "
    "Retur 1.0.1, Piutang Jakarta 1.0.19); pasang paket modul tersebut lebih dahulu bila belum, lalu paket inti ini terakhir. "
    "Verifikasi: aplikasi terbuka normal, log pembayaran gaji tersimpan tanpa menambah Kas Kecil. "
    "Rollback: gunakan pemulihan snapshot dari Pemasang Modul bila health check gagal."
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
        "title": TITLE,
        "version": VERSION,
        "description": DESCRIPTION,
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
