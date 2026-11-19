"""Build the formatted attendance-log workbook for CAP Analytics."""
import json
import sys
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
dates = payload["dates"]
rows = payload["rows"]
wb = Workbook()
ws = wb.active
ws.title = "Log Absensi"
ws.sheet_view.showGridLines = False

# No, Nama, IN/OUT, lalu satu kolom untuk setiap tanggal.
last_column = 3 + len(dates)
last_letter = get_column_letter(last_column)
ws.merge_cells(f"A1:{last_letter}1")
ws["A1"] = "LOG ABSENSI KARYAWAN"
ws["A1"].font = Font(size=15, bold=True, color="FFFFFF")
ws["A1"].fill = PatternFill("solid", fgColor="1F4E78")
ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
ws.merge_cells(f"A2:{last_letter}2")
ws["A2"] = f"Klasifikasi: {payload['classification']}  |  Periode: {payload['start']} s.d. {payload['end']}"
ws["A2"].alignment = Alignment(horizontal="center")
ws.merge_cells(f"A3:{last_letter}3")
ws["A3"] = f"Jumlah log: {payload['log_count']}"
ws["A3"].alignment = Alignment(horizontal="center")
ws.merge_cells(f"A4:{last_letter}4")
ws["A4"] = "Legenda: merah = hari libur / tidak berangkat | hijau = lupa absen | kuning = tukar hari / setengah hari | oranye = terlambat / pulang awal | biru = perjalanan dinas"
ws["A4"].font = Font(italic=True, color="4B5563")
ws["A4"].alignment = Alignment(horizontal="center")

header_row = 5
data_row = 6
header_fill = PatternFill("solid", fgColor="D9E2F3")
red_fill = PatternFill("solid", fgColor="F4CCCC")
forgot_fill = PatternFill("solid", fgColor="D9EAD3")
half_fill = PatternFill("solid", fgColor="FFF2CC")
late_fill = PatternFill("solid", fgColor="FCE5CD")
trip_fill = PatternFill("solid", fgColor="DBEAFE")
fills = {"absence": red_fill, "forgot": forgot_fill, "half": half_fill, "late": late_fill, "early": late_fill, "trip": trip_fill}
thin = Side(style="thin", color="1F2937")
border = Border(left=thin, right=thin, top=thin, bottom=thin)

for column, label in enumerate(("No", "Nama", "IN/OUT"), start=1):
    cell = ws.cell(header_row, column, label)
    cell.fill = header_fill
    cell.font = Font(bold=True)
    cell.alignment = Alignment(horizontal="center", vertical="center")
    cell.border = border
for index, item in enumerate(dates, start=4):
    cell = ws.cell(header_row, index, datetime.strptime(item["date"], "%Y-%m-%d").strftime("%a\n%d"))
    cell.fill = red_fill if item["holiday"] else header_fill
    cell.font = Font(bold=True)
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    cell.border = border

for number, person in enumerate(rows, start=1):
    in_row = data_row + (number - 1) * 2
    out_row = in_row + 1
    for column, value in ((1, number), (2, person["name"])):
        ws.merge_cells(start_row=in_row, start_column=column, end_row=out_row, end_column=column)
        cell = ws.cell(in_row, column, value)
        cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border
        ws.cell(out_row, column).border = border
    ws.cell(in_row, 3, "IN")
    ws.cell(out_row, 3, "OUT")

    for column, item in enumerate(dates, start=4):
        log = person["logs"].get(item["date"], {})
        values = (
            (in_row, log.get("clock_in", ""), log.get("clock_in_note", ""), log.get("state_in", "")),
            (out_row, log.get("clock_out", ""), log.get("clock_out_note", "") or log.get("admin_note", ""), log.get("state_out", "")),
        )
        for row, value, note, state in values:
            cell = ws.cell(row, column, f"{value}\n{note}".strip())
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.fill = red_fill if item["holiday"] else fills.get(state, PatternFill(fill_type=None))
            cell.border = border
    has_note = any(log.get("clock_in_note") or log.get("clock_out_note") or log.get("admin_note") for log in person["logs"].values())
    for row in (in_row, out_row):
        for column in range(1, last_column + 1):
            cell = ws.cell(row, column)
            cell.border = border
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.row_dimensions[row].height = 31 if has_note else 20

ws.column_dimensions["A"].width = 7
ws.column_dimensions["B"].width = 24
ws.column_dimensions["C"].width = 11
for column in range(4, last_column + 1):
    ws.column_dimensions[get_column_letter(column)].width = 14
ws.row_dimensions[1].height = 26
ws.row_dimensions[header_row].height = 34
ws.freeze_panes = "D6"
ws.auto_filter.ref = f"A{header_row}:{last_letter}{ws.max_row}"
wb.save(sys.argv[2])
