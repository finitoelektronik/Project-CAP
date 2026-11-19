"""Create the daily payroll recap workbook for CAP Analytics."""
import json
import re
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))


def credit(clock_in, clock_out, attendance_date):
    try:
        start = datetime.strptime(str(clock_in), "%H:%M")
        finish = datetime.strptime(str(clock_out), "%H:%M")
    except ValueError:
        return 0
    if start == finish:
        return 1 if datetime.strptime(attendance_date, "%Y-%m-%d").weekday() == 5 else 0
    minutes = (finish - start).total_seconds() / 60
    if minutes < 0:
        minutes += 1440
    if minutes >= (420 if datetime.strptime(attendance_date, "%Y-%m-%d").weekday() == 5 else 450):
        return 1
    return 0.5 if minutes >= 180 else 0


def legacy_daily_payload():
    matches = re.findall(r"20\d{2}-\d{2}-\d{2}", str(payload.get("period", "")))
    if len(matches) < 2:
        raise ValueError("Periode absensi tidak ditemukan untuk ekspor rekap harian.")
    start, end = (datetime.strptime(value, "%Y-%m-%d").date() for value in matches[:2])
    dates = [(start + timedelta(days=index)).isoformat() for index in range((end - start).days + 1)]
    ids = [str(item["employee_id"]) for item in payload.get("records", [])]
    logs = {}
    if ids:
        database = Path(__file__).resolve().parent.parent / "data" / "app.db"
        connection = sqlite3.connect(database)
        marks = ",".join("?" for _ in ids)
        query = f"""SELECT employee_id,attendance_date,clock_in,clock_out
                    FROM payroll_attendance_logs current
                    WHERE employee_id IN ({marks}) AND attendance_date>=? AND attendance_date<=?
                    AND upload_id=(SELECT MAX(previous.upload_id) FROM payroll_attendance_logs previous
                                   WHERE previous.employee_id=current.employee_id AND previous.attendance_date=current.attendance_date)"""
        for employee_id, attendance_date, clock_in, clock_out in connection.execute(query, [*ids, dates[0], dates[-1]]):
            logs[(str(employee_id), attendance_date)] = (clock_in, clock_out)
        connection.close()
    rows = []
    for item in payload.get("records", []):
        employee_id = str(item["employee_id"])
        rows.append({
            "employee_id": employee_id,
            "name": item["name"],
            "department": item.get("department", ""),
            "daily_values": [credit(*logs[(employee_id, date)], date) if (employee_id, date) in logs else 0 for date in dates],
            "attendance_actual": item.get("attendance_actual", 0),
            "deduction": item.get("deduction", 0),
            "overtime_pay": item.get("overtime_pay", 0),
            "net_pay": item.get("net_pay", 0),
        })
    return dates, rows


dates = payload.get("dates")
if dates:
    records = payload["records"]
else:
    dates, records = legacy_daily_payload()
    payload["period_start"], payload["period_end"] = dates[0], dates[-1]

wb = Workbook()
ws = wb.active
ws.title = "Rekap Gaji"
ws.sheet_view.showGridLines = False

day_start = 4
attendance_col = day_start + len(dates)
basic_label_col = attendance_col + 1
basic_value_col = attendance_col + 2
premium_label_col = attendance_col + 3
premium_value_col = attendance_col + 4
allowance_label_col = attendance_col + 5
allowance_value_col = attendance_col + 6
deduction_label_col = attendance_col + 7
deduction_value_col = attendance_col + 8
overtime_label_col = attendance_col + 9
overtime_value_col = attendance_col + 10
total_label_col = attendance_col + 11
total_value_col = attendance_col + 12
last_col = total_value_col
last_letter = get_column_letter(last_col)

thin = Side(style="thin", color="000000")
border = Border(left=thin, right=thin, top=thin, bottom=thin)
peach = PatternFill("solid", fgColor="F8CBAD")
red = PatternFill("solid", fgColor="FF0000")
red_cell_fill = PatternFill("solid", fgColor="F4CCCC")
forgot_cell_fill = PatternFill("solid", fgColor="D9EAD3")
half_cell_fill = PatternFill("solid", fgColor="FFF2CC")
late_cell_fill = PatternFill("solid", fgColor="FCE5CD")
trip_cell_fill = PatternFill("solid", fgColor="D9EAF7")
currency_format = '#,##0;[Red](#,##0);-'


def period_label(value):
    return datetime.strptime(value, "%Y-%m-%d").strftime("%d %B %Y").upper()


def payroll_day_flags():
    """Return the visual attendance state for the payroll daily cells."""
    holidays = {"2026-01-01", "2026-01-16", "2026-02-16", "2026-02-17", "2026-03-18", "2026-03-19", "2026-03-20", "2026-03-21", "2026-03-22", "2026-03-23", "2026-03-24", "2026-04-03", "2026-04-05", "2026-05-01", "2026-05-14", "2026-05-15", "2026-05-27", "2026-05-28", "2026-05-31", "2026-06-01", "2026-06-16", "2026-08-17", "2026-08-25", "2026-12-24", "2026-12-25"}
    flags = {(str(item["employee_id"]), date): {"holiday": datetime.strptime(date, "%Y-%m-%d").weekday() == 6 or date in holidays, "state": "absence"} for item in records for date in dates}
    employee_ids = [str(item["employee_id"]) for item in records]
    if not employee_ids:
        return flags
    # Data dari server sudah memuat keputusan perjalanan dinas. Gunakan data
    # tersebut lebih dulu agar sheet rekap dan Log Absensi selalu konsisten,
    # termasuk saat tanggal itu tidak mempunyai scan mesin.
    for item in payload.get("attendance_logs", []) or []:
        key = (str(item.get("employee_id", "")), item.get("attendance_date", ""))
        if key in flags and (item.get("state_in") == "trip" or item.get("state_out") == "trip"):
            flags[key].update({"holiday": False, "state": "trip"})
    database = Path(__file__).resolve().parent.parent / "data" / "app.db"
    connection = sqlite3.connect(database)
    marks = ",".join("?" for _ in employee_ids)
    query = f"""SELECT current.employee_id,current.attendance_date,current.clock_in,current.clock_out,
                       COALESCE((SELECT status FROM payroll_attendance_issues issue WHERE issue.employee_id=current.employee_id AND issue.attendance_date=current.attendance_date ORDER BY issue.id DESC LIMIT 1),''),
                       COALESCE((SELECT notes FROM payroll_attendance_issues issue WHERE issue.employee_id=current.employee_id AND issue.attendance_date=current.attendance_date ORDER BY issue.id DESC LIMIT 1),''),
                       COALESCE((SELECT attendance_status FROM payroll_attendance_issues issue WHERE issue.employee_id=current.employee_id AND issue.attendance_date=current.attendance_date ORDER BY issue.id DESC LIMIT 1),'')
                FROM payroll_attendance_logs current
                WHERE current.employee_id IN ({marks}) AND current.attendance_date>=? AND current.attendance_date<=?
                AND current.upload_id=(SELECT MAX(previous.upload_id) FROM payroll_attendance_logs previous WHERE previous.employee_id=current.employee_id AND previous.attendance_date=current.attendance_date)"""
    for employee_id, date, clock_in, clock_out, status, note, attendance_status in connection.execute(query, [*employee_ids, dates[0], dates[-1]]):
        key = (str(employee_id), date)
        if key not in flags:
            continue
        state = attendance_state(clock_in, clock_out, date, status, attendance_status)
        flags[key].update({"state": state})
    connection.close()
    return flags


def attendance_state(clock_in, clock_out, date, status, attendance_status=""):
    """Classify a day using the approved payroll-attendance color priority."""
    clock_in, clock_out = str(clock_in or ""), str(clock_out or "")
    if attendance_status == "absent":
        return "absence"
    if attendance_status == "half":
        return "half"
    if not clock_in.strip() and not clock_out.strip():
        return "absence"
    if status == "forgot_clock":
        return "forgot"
    valid = lambda value: bool(re.match(r"^\d{2}:\d{2}$", value))
    if valid(clock_in) and valid(clock_out):
        start = int(clock_in[:2]) * 60 + int(clock_in[3:])
        finish = int(clock_out[:2]) * 60 + int(clock_out[3:])
        worked = finish - start
        if worked < 0:
            worked += 1440
        saturday = datetime.strptime(date, "%Y-%m-%d").weekday() == 5
        if 180 <= worked < (420 if saturday else 450):
            return "half"
        if 485 < start < 720:
            return "late"
    return ""


def attendance_anomaly_side(clock_in, clock_out, date, status, correction_type, admin_note, out_note):
    """Return the one attendance cell that needs an anomaly marker."""
    clock_in, clock_out = str(clock_in or ""), str(clock_out or "")
    if not clock_in.strip() and not clock_out.strip():
        return "both"
    saturday = datetime.strptime(date, "%Y-%m-%d").weekday() == 5
    if saturday and clock_out == "16:00" and status == "dismissed" and not str(admin_note or "").strip() and not str(out_note or "").strip():
        return ""
    if correction_type in ("clock_in", "clock_out"):
        return correction_type
    valid = lambda value: bool(re.match(r"^\d{2}:\d{2}$", value))
    if valid(clock_in) and valid(clock_out):
        start = int(clock_in[:2]) * 60 + int(clock_in[3:])
        finish = int(clock_out[:2]) * 60 + int(clock_out[3:])
        worked = finish - start
        if worked < 0:
            worked += 1440
        short = worked < (420 if saturday else 450)
        if short and worked >= 180:
            return "clock_in"
        if start == finish:
            return "clock_out"
        if 485 < start < 720:
            return "clock_in"
    return "clock_in" if status else ""


def build_attendance_sheet():
    """Append the attendance log for the same people and period as payroll."""
    sheet = wb.create_sheet("Log Absensi")
    sheet.sheet_view.showGridLines = False
    employee_ids = [str(item["employee_id"]) for item in records]
    people = {str(item["employee_id"]): {"name": item["name"], "department": item.get("department", ""), "work_days": item.get("attendance_actual", 0), "logs": {}} for item in records}
    classifications = set()
    # The server has already applied the same shift, half-day and correction rules
    # used by the Log Absensi screen.  Consume that result so the combined export
    # never colours both IN and OUT for one anomaly.
    supplied_logs = payload.get("attendance_logs")
    if supplied_logs is not None:
        for item in supplied_logs:
            employee_id, date = str(item.get("employee_id", "")), item.get("attendance_date", "")
            if employee_id not in people or date not in dates:
                continue
            state_in, state_out = item.get("state_in", ""), item.get("state_out", "")
            admin_note = item.get("admin_note", "")
            people[employee_id]["logs"][date] = {
                "clock_in": item.get("clock_in", ""),
                "clock_out": item.get("clock_out", ""),
                "in_note": item.get("clock_in_note", "") or (admin_note if state_in else ""),
                "out_note": item.get("clock_out_note", "") or (admin_note if state_out else ""),
                "state_in": state_in,
                "state_out": state_out,
            }
        classification = payload.get("classification", "Semua klasifikasi")
    elif employee_ids:
        database = Path(__file__).resolve().parent.parent / "data" / "app.db"
        connection = sqlite3.connect(database)
        marks = ",".join("?" for _ in employee_ids)
        classification_query = f"SELECT payment_model FROM payroll_employee_groups WHERE employee_id IN ({marks})"
        classifications = {item[0] for item in connection.execute(classification_query, employee_ids)}
        query = f"""SELECT current.employee_id,current.attendance_date,current.clock_in,current.clock_out,
                           COALESCE((SELECT clock_in_note FROM payroll_attendance_notes note WHERE note.employee_id=current.employee_id AND note.attendance_date=current.attendance_date),''),
                           COALESCE((SELECT clock_out_note FROM payroll_attendance_notes note WHERE note.employee_id=current.employee_id AND note.attendance_date=current.attendance_date),''),
                           COALESCE((SELECT notes FROM payroll_attendance_issues issue WHERE issue.employee_id=current.employee_id AND issue.attendance_date=current.attendance_date AND TRIM(COALESCE(issue.notes,''))<>'' ORDER BY issue.id DESC LIMIT 1),''),
                           COALESCE((SELECT status FROM payroll_attendance_issues issue WHERE issue.employee_id=current.employee_id AND issue.attendance_date=current.attendance_date ORDER BY issue.id DESC LIMIT 1),''),
                           COALESCE((SELECT correction_type FROM payroll_attendance_issues issue WHERE issue.employee_id=current.employee_id AND issue.attendance_date=current.attendance_date ORDER BY issue.id DESC LIMIT 1),''),
                           COALESCE((SELECT attendance_status FROM payroll_attendance_issues issue WHERE issue.employee_id=current.employee_id AND issue.attendance_date=current.attendance_date ORDER BY issue.id DESC LIMIT 1),'')
                    FROM payroll_attendance_logs current
                    WHERE current.employee_id IN ({marks}) AND current.attendance_date>=? AND current.attendance_date<=?
                    AND current.upload_id=(SELECT MAX(previous.upload_id) FROM payroll_attendance_logs previous WHERE previous.employee_id=current.employee_id AND previous.attendance_date=current.attendance_date)"""
        for employee_id, date, clock_in, clock_out, in_note, out_note, admin_note, status, correction_type, attendance_status in connection.execute(query, [*employee_ids, dates[0], dates[-1]]):
            side = attendance_anomaly_side(clock_in, clock_out, date, status, correction_type, admin_note, out_note)
            state = attendance_state(clock_in, clock_out, date, status, attendance_status)
            people[str(employee_id)]["logs"][date] = {"clock_in": clock_in, "clock_out": clock_out, "in_note": in_note or (admin_note if side == "clock_in" else ""), "out_note": out_note or (admin_note if side == "clock_out" else ""), "state_in": state if side == "clock_in" else "", "state_out": state if side == "clock_out" else ""}
        connection.close()
        classification = "Semua klasifikasi" if len(classifications) != 1 else {"cash": "Cash", "transfer": "Transfer"}.get(next(iter(classifications)), "Semua klasifikasi")
    else:
        classification = "Semua klasifikasi"
    total_days_column = 3 + len(dates) * 2
    last_column = total_days_column
    last_letter = get_column_letter(last_column)
    sheet.merge_cells(f"A1:{last_letter}1")
    sheet["A1"] = "LOG ABSENSI KARYAWAN"
    sheet["A1"].font = Font(name="Arial", size=14, bold=True, color="FFFFFF")
    sheet["A1"].fill = PatternFill("solid", fgColor="1F4E78")
    sheet["A1"].alignment = Alignment(horizontal="center")
    sheet.merge_cells(f"A2:{last_letter}2")
    sheet["A2"] = f"Klasifikasi: {classification}  |  Periode: {payload['period_start']} s.d. {payload['period_end']}"
    sheet["A2"].alignment = Alignment(horizontal="center")
    header_fill = PatternFill("solid", fgColor="D9E2F3")
    holiday_fill = red_cell_fill
    holidays = {"2026-01-01", "2026-01-16", "2026-02-16", "2026-02-17", "2026-03-18", "2026-03-19", "2026-03-20", "2026-03-21", "2026-03-22", "2026-03-23", "2026-03-24", "2026-04-03", "2026-04-05", "2026-05-01", "2026-05-14", "2026-05-15", "2026-05-27", "2026-05-28", "2026-05-31", "2026-06-01", "2026-06-16", "2026-08-17", "2026-08-25", "2026-12-24", "2026-12-25"}
    sheet.merge_cells("A5:A6")
    sheet.merge_cells("B5:B6")
    sheet.merge_cells(start_row=5, start_column=total_days_column, end_row=6, end_column=total_days_column)
    sheet["A5"] = "Nama"
    sheet["B5"] = "Bagian"
    sheet.cell(5, total_days_column, "Total Hari\nKerja")
    for index, value in enumerate(dates):
        column = 3 + index * 2
        day = datetime.strptime(value, "%Y-%m-%d")
        sheet.merge_cells(start_row=5, start_column=column, end_row=5, end_column=column + 1)
        sheet.cell(5, column, day.strftime("%d-%b"))
        sheet.cell(6, column, "IN")
        sheet.cell(6, column + 1, "OUT")
        fill = holiday_fill if day.weekday() == 6 or value in holidays else header_fill
        for header_row in (5, 6):
            for current_column in range(column, column + 2):
                sheet.cell(header_row, current_column).fill = fill
    for row in sheet.iter_rows(min_row=5, max_row=6, min_col=1, max_col=last_column):
        for cell in row:
            cell.font = Font(name="Arial", size=10, bold=True)
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = border
    attendance_notes = []
    for row_index, person in enumerate(sorted(people.values(), key=lambda item: item["name"].lower()), start=7):
        sheet.cell(row_index, 1, person["name"])
        sheet.cell(row_index, 2, person["department"] or "—")
        sheet.cell(row_index, total_days_column, person.get("work_days", 0))
        sheet.cell(row_index, 1).font = Font(name="Arial", size=10, bold=True)
        has_note = False
        for index, value in enumerate(dates):
            column = 3 + index * 2
            log = person["logs"].get(value, {})
            clock_in, clock_out = log.get("clock_in", ""), log.get("clock_out", "")
            in_note, out_note = log.get("in_note", ""), log.get("out_note", "")
            sheet.cell(row_index, column, clock_in)
            sheet.cell(row_index, column + 1, clock_out)
            if str(in_note).strip():
                attendance_notes.append({"name": person["name"], "department": person["department"] or "—", "date": value, "column": "IN", "clock": clock_in, "note": str(in_note).strip()})
            if str(out_note).strip():
                attendance_notes.append({"name": person["name"], "department": person["department"] or "—", "date": value, "column": "OUT", "clock": clock_out, "note": str(out_note).strip()})
            day = datetime.strptime(value, "%Y-%m-%d")
            if day.weekday() == 6 or value in holidays:
                in_fill = out_fill = red_cell_fill
            else:
                fills = {"absence": red_cell_fill, "forgot": forgot_cell_fill, "half": half_cell_fill, "late": late_cell_fill, "early": late_cell_fill, "trip": trip_cell_fill}
                in_fill = fills.get(log.get("state_in", "absence"))
                out_fill = fills.get(log.get("state_out", ""))
            if in_fill:
                sheet.cell(row_index, column).fill = in_fill
            if out_fill:
                sheet.cell(row_index, column + 1).fill = out_fill
        for cell in sheet[row_index]:
            cell.border = border
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        sheet.row_dimensions[row_index].height = 20
    sheet.column_dimensions["A"].width = 25
    sheet.column_dimensions["B"].width = 22
    for column in range(3, last_column + 1):
        sheet.column_dimensions[get_column_letter(column)].width = 14
    sheet.column_dimensions[get_column_letter(total_days_column)].width = 15
    sheet.freeze_panes = "C7"
    sheet.auto_filter.ref = f"A6:{last_letter}{sheet.max_row}"
    sheet.merge_cells(f"A3:{last_letter}3")
    sheet["A3"] = "Legenda: merah = hari libur / tidak berangkat | hijau = lupa absen | kuning = setengah hari | oranye = terlambat | biru = perjalanan dinas"
    sheet["A3"].font = Font(name="Arial", size=9, italic=True, color="4B5563")
    sheet["A3"].alignment = Alignment(horizontal="center")
    return attendance_notes


def build_attendance_notes_sheet(notes):
    """Create an audit sheet for notes without crowding the IN/OUT matrix."""
    sheet = wb.create_sheet("Keterangan Absensi")
    sheet.sheet_view.showGridLines = False
    headers = ["Nama", "Bagian", "Tanggal", "Kolom", "Jam", "Keterangan"]
    sheet.merge_cells("A1:F1")
    sheet["A1"] = "KETERANGAN ABSENSI"
    sheet["A1"].font = Font(name="Arial", size=14, bold=True, color="FFFFFF")
    sheet["A1"].fill = PatternFill("solid", fgColor="1F4E78")
    sheet["A1"].alignment = Alignment(horizontal="center")
    sheet.merge_cells("A2:F2")
    sheet["A2"] = f"Periode: {payload['period_start']} s.d. {payload['period_end']} | Dikelompokkan per nama dan diurutkan tanggal"
    sheet["A2"].alignment = Alignment(horizontal="center")
    header_fill = PatternFill("solid", fgColor="D9E2F3")
    for column, header in enumerate(headers, start=1):
        cell = sheet.cell(4, column, header)
        cell.font = Font(name="Arial", size=10, bold=True)
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border
    ordered = sorted(notes, key=lambda item: (item["name"].casefold(), item["date"], 0 if item["column"] == "IN" else 1))
    if not ordered:
        sheet.merge_cells("A5:F5")
        sheet["A5"] = "Tidak ada keterangan absensi pada periode ini."
        sheet["A5"].alignment = Alignment(horizontal="center")
        sheet["A5"].font = Font(name="Arial", size=10, italic=True, color="6B7280")
    else:
        row = 5
        group_start = row
        current_name = ordered[0]["name"]
        for item in ordered:
            if item["name"] != current_name:
                if row - group_start > 1:
                    sheet.merge_cells(start_row=group_start, start_column=1, end_row=row - 1, end_column=1)
                    sheet.merge_cells(start_row=group_start, start_column=2, end_row=row - 1, end_column=2)
                group_start, current_name = row, item["name"]
            values = [item["name"], item["department"], datetime.strptime(item["date"], "%Y-%m-%d").strftime("%d-%m-%Y"), item["column"], item["clock"], item["note"]]
            for column, value in enumerate(values, start=1):
                cell = sheet.cell(row, column, value)
                cell.border = border
                cell.alignment = Alignment(horizontal="center" if column != 6 else "left", vertical="center", wrap_text=True)
                if column == 1:
                    cell.font = Font(name="Arial", size=10, bold=True)
            sheet.row_dimensions[row].height = 28
            row += 1
        if row - group_start > 1:
            sheet.merge_cells(start_row=group_start, start_column=1, end_row=row - 1, end_column=1)
            sheet.merge_cells(start_row=group_start, start_column=2, end_row=row - 1, end_column=2)
        for current_row in range(5, row):
            for column in (1, 2):
                sheet.cell(current_row, column).alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for column, width in {"A": 25, "B": 22, "C": 15, "D": 10, "E": 12, "F": 52}.items():
        sheet.column_dimensions[column].width = width
    sheet.freeze_panes = "A5"
    sheet.auto_filter.ref = f"A4:F{max(sheet.max_row, 4)}"


ws.merge_cells(f"A1:{last_letter}1")
ws["A1"] = "ABSENSI KARYAWAN HARIAN PT. CAP"
ws["A1"].font = Font(name="Arial", size=11, bold=True)
ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
ws.merge_cells(f"A2:{last_letter}2")
ws["A2"] = f"PERIODE {period_label(payload['period_start'])} - {period_label(payload['period_end'])}"
ws["A2"].font = Font(name="Arial", size=11, bold=True)
ws["A2"].alignment = Alignment(horizontal="center", vertical="center")

for column, label in ((1, "NO"), (2, "NAMA"), (3, "Bagian"), (attendance_col, "JUMLAH")):
    ws.merge_cells(start_row=4, start_column=column, end_row=5, end_column=column)
    ws.cell(4, column, label)
for label_col, value_col, label in ((basic_label_col, basic_value_col, "GAJI\nPOKOK"), (premium_label_col, premium_value_col, "PREMI"), (allowance_label_col, allowance_value_col, "TUNJANGAN"), (deduction_label_col, deduction_value_col, "POTONGAN\nKEHADIRAN"), (overtime_label_col, overtime_value_col, "LEMBUR"), (total_label_col, total_value_col, "TOTAL\nGAJI")):
    ws.merge_cells(start_row=4, start_column=label_col, end_row=4, end_column=value_col)
    ws.cell(4, label_col, label)

weekday_labels = ("SENIN", "SELASA", "RABU", "KAMIS", "JUMAT", "SABTU", "MINGGU")
for index, value in enumerate(dates):
    column = day_start + index
    date = datetime.strptime(value, "%Y-%m-%d")
    ws.cell(4, column, weekday_labels[date.weekday()])
    ws.cell(5, column, date.day)

for row in ws.iter_rows(min_row=4, max_row=5, min_col=1, max_col=last_col):
    for cell in row:
        cell.font = Font(name="Arial", size=9, bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border

for column in range(1, last_col + 1):
    ws.cell(6, column).fill = peach
    ws.cell(6, column).border = border

day_flags = payroll_day_flags()
for row_index, item in enumerate(records, start=7):
    ws.cell(row_index, 1, item["employee_id"])
    ws.cell(row_index, 2, item["name"])
    ws.cell(row_index, 3, item["department"])
    for index, value in enumerate(item["daily_values"]):
        cell = ws.cell(row_index, day_start + index, value)
        state = day_flags.get((str(item["employee_id"]), dates[index]), {})
        color_state = "absence" if state.get("holiday") else state.get("state", "absence")
        fill = {"absence": red_cell_fill, "forgot": forgot_cell_fill, "half": half_cell_fill, "late": late_cell_fill, "trip": trip_cell_fill}.get(color_state)
        if fill:
            cell.fill = fill
    ws.cell(row_index, attendance_col, item["attendance_actual"])
    ws.cell(row_index, basic_label_col, "Rp")
    ws.cell(row_index, basic_value_col, item.get("monthly_basic", 0))
    ws.cell(row_index, premium_label_col, "Rp")
    ws.cell(row_index, premium_value_col, item.get("premium", 0))
    ws.cell(row_index, allowance_label_col, "Rp")
    ws.cell(row_index, allowance_value_col, item.get("allowance_total", 0))
    ws.cell(row_index, deduction_label_col, "Rp")
    ws.cell(row_index, deduction_value_col, item["deduction"])
    ws.cell(row_index, overtime_label_col, "Rp")
    ws.cell(row_index, overtime_value_col, item["overtime_pay"])
    ws.cell(row_index, total_label_col, "Rp")
    ws.cell(row_index, total_value_col, item["net_pay"])
    ws.cell(row_index, attendance_col).fill = red
    for column in range(1, last_col + 1):
        cell = ws.cell(row_index, column)
        cell.font = Font(name="Arial", size=10, bold=column in (1, 2, attendance_col, total_value_col))
        cell.alignment = Alignment(horizontal="center" if column != 2 else "left", vertical="center")
        cell.border = border
    for column in (basic_value_col, premium_value_col, allowance_value_col, deduction_value_col, overtime_value_col, total_value_col):
        ws.cell(row_index, column).number_format = currency_format

total_row = 7 + len(records)
# Sisakan kolom JUMLAH agar total hari kerja seluruh karyawan dapat ditampilkan.
ws.merge_cells(start_row=total_row, start_column=1, end_row=total_row, end_column=attendance_col - 1)
ws.cell(total_row, 1, "Total")
ws.cell(total_row, attendance_col, sum(item["attendance_actual"] for item in records))
ws.cell(total_row, attendance_col).fill = red
ws.cell(total_row, basic_label_col, "Rp")
ws.cell(total_row, basic_value_col, sum(item.get("monthly_basic", 0) for item in records))
ws.cell(total_row, premium_label_col, "Rp")
ws.cell(total_row, premium_value_col, sum(item.get("premium", 0) for item in records))
ws.cell(total_row, allowance_label_col, "Rp")
ws.cell(total_row, allowance_value_col, sum(item.get("allowance_total", 0) for item in records))
ws.cell(total_row, deduction_label_col, "Rp")
ws.cell(total_row, deduction_value_col, sum(item["deduction"] for item in records))
ws.cell(total_row, overtime_label_col, "Rp")
ws.cell(total_row, overtime_value_col, sum(item["overtime_pay"] for item in records))
ws.cell(total_row, total_label_col, "Rp")
ws.cell(total_row, total_value_col, sum(item["net_pay"] for item in records))
for column in range(1, last_col + 1):
    cell = ws.cell(total_row, column)
    cell.font = Font(name="Arial", size=10, bold=True)
    cell.alignment = Alignment(horizontal="center", vertical="center")
    cell.border = border
for column in (basic_value_col, premium_value_col, allowance_value_col, deduction_value_col, overtime_value_col, total_value_col):
    ws.cell(total_row, column).number_format = currency_format

ws.row_dimensions[1].height = 18
ws.row_dimensions[2].height = 18
ws.row_dimensions[4].height = 30
ws.row_dimensions[5].height = 18
ws.column_dimensions["A"].width = 8
ws.column_dimensions["B"].width = 25
ws.column_dimensions["C"].width = 25
for column in range(day_start, attendance_col + 1):
    ws.column_dimensions[get_column_letter(column)].width = 9
for column in (basic_label_col, premium_label_col, allowance_label_col, deduction_label_col, overtime_label_col, total_label_col):
    ws.column_dimensions[get_column_letter(column)].width = 5
for column in (basic_value_col, premium_value_col, allowance_value_col, deduction_value_col, overtime_value_col, total_value_col):
    ws.column_dimensions[get_column_letter(column)].width = 14
ws.freeze_panes = "D7"
ws.auto_filter.ref = f"A5:{last_letter}{total_row - 1}"

attendance_notes = build_attendance_sheet()
build_attendance_notes_sheet(attendance_notes)
wb.save(sys.argv[2])
