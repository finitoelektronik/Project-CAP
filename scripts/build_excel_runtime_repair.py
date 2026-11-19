"""Build a standalone Excel runtime repair ZIP without CAP application files."""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "Install-CAP-Excel-Runtime.ps1"
OUTPUT = ROOT / "release" / "CAP-Excel-Runtime-Repair-1.0.1.zip"
README = """CAP Excel Runtime Repair\n\n1. Extract this ZIP on the CAP server.\n2. Right-click Install-CAP-Excel-Runtime.ps1, then choose Run with PowerShell as Administrator.\n3. If PowerShell blocks it, open Administrator PowerShell in this folder and run:\n   powershell -ExecutionPolicy Bypass -File .\\Install-CAP-Excel-Runtime.ps1\n\nThis package only installs Python Excel dependencies (openpyxl and xlrd).\nIt does not change CAP Core, installed modules, or the CAP database.\n"""

with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    archive.write(SOURCE, SOURCE.name)
    archive.writestr("README.txt", README)

print(OUTPUT)
