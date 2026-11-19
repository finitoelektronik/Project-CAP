import json
import sys
from datetime import datetime
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

payload = json.load(open(sys.argv[1], encoding="utf-8"))
workbook = Workbook()
sheet = workbook.active
sheet.title = "Pelaporan Resi Online Shop"
headers = ["Tanggal input", "Nama toko", "Nama barang", "Marketplace", "Keterangan kendala", "Jumlah gambar", "Jumlah video", "Ukuran simpan"]
sheet.merge_cells("A1:H1")
sheet["A1"] = "PELAPORAN RESI ONLINE SHOP"
sheet["A1"].font = Font(name="Arial", size=14, bold=True, color="FFFFFF")
sheet["A1"].fill = PatternFill("solid", fgColor="1F4E78")
sheet["A1"].alignment = Alignment(horizontal="center")
sheet.merge_cells("A2:H2")
filters = payload.get("filters", {})
sheet["A2"] = "Filter: {} s.d. {} | Toko: {} | Barang: {}".format(filters.get("start") or "semua tanggal", filters.get("end") or "semua tanggal", filters.get("store") or "semua", filters.get("product") or "semua")
sheet["A2"].alignment = Alignment(horizontal="center")
header_fill = PatternFill("solid", fgColor="D9E2F3")
border = Border(*(Side(style="thin", color="D9E2F3"),) * 4)
for col, title in enumerate(headers, 1):
    cell = sheet.cell(4, col, title)
    cell.font = Font(name="Arial", bold=True)
    cell.fill = header_fill
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    cell.border = border
for row_num, report in enumerate(payload.get("reports", []), 5):
    media = report.get("media", [])
    images = [item for item in media if item.get("media_type") == "image"]
    videos = [item for item in media if item.get("media_type") == "video"]
    values = [report.get("input_date"), report.get("store_name"), report.get("product_name"), report.get("marketplace"), report.get("issue_notes"), len(images), len(videos), sum(int(item.get("stored_size") or 0) for item in media)]
    for col, value in enumerate(values, 1):
        cell = sheet.cell(row_num, col, value)
        cell.alignment = Alignment(vertical="top", wrap_text=True)
        cell.border = border
    sheet.cell(row_num, 8).number_format = '#,##0" byte"'
    sheet.row_dimensions[row_num].height = 42
if not payload.get("reports"):
    sheet.merge_cells("A5:H5")
    sheet["A5"] = "Tidak ada laporan pada klasifikasi yang dipilih."
    sheet["A5"].alignment = Alignment(horizontal="center")
for col, width in enumerate([15, 24, 28, 20, 48, 16, 16, 18], 1):
    sheet.column_dimensions[get_column_letter(col)].width = width
sheet.freeze_panes = "A5"
sheet.auto_filter.ref = f"A4:H{max(4, sheet.max_row)}"
workbook.save(sys.argv[2])
