"""Bangun paket upgrade WhatsApp Business (tanpa database) dari source saat ini.

Isi: klasifikasi nomor & edit kontak, submenu Pesan Internal / Pesan External
(prospek per kota, impor VCF, template Meta), pesan manual teks/gambar, panel
sisa kuota, dan semua modul aplikasi sebagai sumber notifikasi internal.
"""
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.0.0"
PACKAGE_DIR = ROOT / "release" / f"package-whatsapp-business-{VERSION}"
OUTPUT = ROOT / "release" / f"CAP-WhatsApp-Business-Upgrade-{VERSION}.zip"
TARGETS = (
    "app.mjs",
    "public/app.js",
    "public/index.html",
    "public/styles.css",
    "public/whatsapp-external.js",
    "scripts/import_whatsapp_external_vcf.mjs",
    "CONTEXT.md",
)
DESCRIPTION = (
    "Tujuan: memperbarui modul WhatsApp Business. (1) Pesan Internal: klasifikasi nomor yang dapat diatur master, "
    "edit nama/nomor/klasifikasi/modul/status kontak, filter klasifikasi saat kirim, semua modul aplikasi dapat dipilih "
    "sebagai sumber notifikasi, dan gambar JPG/PNG opsional. (2) Submenu baru Pesan External untuk prospek pelanggan per kota "
    "(hak akses baru whatsapp_external): daftar & edit prospek, status Aktif/Berhenti, impor VCF (nomor yang sudah ada dilewati), "
    "template Meta, kirim template per kota, pesan manual teks/gambar per kota atau kontak dicentang, dan riwayat pengiriman. "
    "(3) Panel sisa kuota 24 jam: tier dan kualitas nomor dari Meta dikurangi penerima unik dari CAP. "
    "Berkas yang diganti: app.mjs, public/app.js, public/index.html, public/styles.css, public/whatsapp-external.js (baru), "
    "scripts/import_whatsapp_external_vcf.mjs (baru), CONTEXT.md. "
    "Perubahan database (dibuat otomatis oleh app.mjs saat start, hanya aditif): tabel whatsapp_classifications, "
    "whatsapp_external_contacts, whatsapp_external_sends, whatsapp_message_log; kolom whatsapp_contacts.classification_id, "
    "whatsapp_settings.external_template_name/external_template_language/external_template_param, whatsapp_external_sends.kind. "
    "Migrasi SQL paket: tidak ada. Dampak pada data yang ada: kontak, token, dan pengaturan WhatsApp lama tetap; kontak lama "
    "tanpa klasifikasi. Data prospek TIDAK ikut paket: impor lewat Pesan External > Impor VCF. "
    "Verifikasi: buka WhatsApp Business, pastikan submenu Pesan Internal/Pesan External dan panel sisa kuota tampil, "
    "dan form kontak menampilkan semua modul. Rollback: gunakan pemulihan snapshot dari Pemasang Modul bila health check gagal."
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
        "id": "whatsapp_business",
        "title": "WhatsApp Business — Pesan Internal & External",
        "version": VERSION,
        "description": DESCRIPTION,
        "permissions": ["whatsapp", "whatsapp_external"],
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
