"""Read both summary and daily-grid attendance Excel exports into payroll records."""
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path


def clean(value):
    return "" if value is None else str(value).strip()


def key(value):
    return re.sub(r"[^a-z0-9]+", " ", clean(value).lower()).strip()


def identifier(value):
    text = clean(value)
    return text[:-2] if text.endswith(".0") and text[:-2].isdigit() else text


def number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def rows_for(path):
    if path.suffix.lower() == ".xls":
        try:
            import xlrd
        except ImportError as error:
            raise RuntimeError("Impor .xls memerlukan paket Python xlrd.") from error
        book = xlrd.open_workbook(path)
        sheet = next((book.sheet_by_index(i) for i in range(book.nsheets)
                      if "analisa kehadiran" in book.sheet_by_index(i).name.lower()), None)
        if sheet is None:
            sheet = next((book.sheet_by_index(i) for i in range(book.nsheets)
                          if "absensi" in book.sheet_by_index(i).name.lower()), None)
        if sheet is None:
            raise RuntimeError("Sheet absensi tidak ditemukan.")
        raw_sheet = next((book.sheet_by_index(i) for i in range(book.nsheets)
                          if book.sheet_by_index(i).name.strip().lower() == "all"), None)
        if raw_sheet is None:
            raw_sheet = next((book.sheet_by_index(i) for i in range(book.nsheets)
                              if "pengaturan shift kehadiran" in book.sheet_by_index(i).name.lower()), None)
        raw_rows = [raw_sheet.row_values(i) for i in range(raw_sheet.nrows)] if raw_sheet else []
        detail_sheets = [[sheet_item.row_values(i) for i in range(sheet_item.nrows)] for sheet_item in (book.sheet_by_index(i) for i in range(book.nsheets)) if re.fullmatch(r"\d+(,\d+)*", sheet_item.name)]
        return [sheet.row_values(i) for i in range(sheet.nrows)], raw_rows, detail_sheets
    import openpyxl
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = next((item for item in book.worksheets if "analisa kehadiran" in item.title.lower()), None)
    if sheet is None:
        sheet = next((item for item in book.worksheets if "absensi" in item.title.lower()), None)
    if sheet is None:
        raise RuntimeError("Sheet absensi tidak ditemukan.")
    raw_sheet = next((item for item in book.worksheets if item.title.strip().lower() == "all"), None)
    if raw_sheet is None:
        raw_sheet = next((item for item in book.worksheets if "pengaturan shift kehadiran" in item.title.lower()), None)
    raw_rows = [list(row) for row in raw_sheet.iter_rows(values_only=True)] if raw_sheet else []
    detail_sheets = [[list(row) for row in item.iter_rows(values_only=True)] for item in book.worksheets if re.fullmatch(r"\d+(,\d+)*", item.title)]
    return [list(row) for row in sheet.iter_rows(values_only=True)], raw_rows, detail_sheets


def period_for(rows):
    for row in rows[:12]:
        for value in row:
            text = clean(value)
            if "absensi" in text.lower() and ("per" in text.lower() or "karyawan" in text.lower()):
                return text
    return clean(rows[1][0] if len(rows) > 1 and rows[1] else "")


def grid_columns(rows):
    """Locate Nama, Jabatan and Jml Hari Kerja from a visual daily attendance grid."""
    name_col = job_col = work_days_col = overtime_col = None
    header_end = 0
    for row_index, row in enumerate(rows[:15]):
        for col_index, value in enumerate(row):
            heading = key(value)
            if heading == "nama" and name_col is None:
                name_col, header_end = col_index, max(header_end, row_index)
            elif heading in ("jabatan", "bagian", "department") and job_col is None:
                job_col, header_end = col_index, max(header_end, row_index)
            elif "hari kerja" in heading or heading in ("jml hari", "jumlah hari"):
                work_days_col, header_end = col_index, max(header_end, row_index)
            elif "lembur" in heading and ("jml" in heading or "jumlah" in heading):
                overtime_col, header_end = col_index, max(header_end, row_index)
    if name_col is None or work_days_col is None:
        return None
    return name_col, job_col, work_days_col, overtime_col, header_end


def grid_records(rows):
    columns = grid_columns(rows)
    if not columns:
        return None
    name_col, job_col, work_days_col, overtime_col, header_end = columns
    # Header dates commonly occupy the two rows above the IN/OUT labels.
    day_headers = set()
    for row in rows[max(0, header_end - 3):header_end + 1]:
        for value in row:
            text = clean(value)
            if re.fullmatch(r"\d{1,2}", text):
                day_headers.add(text)
    standard_days = len(day_headers) or 0
    records = []
    for row in rows[header_end + 1:]:
        row = list(row) + [None] * (max(name_col, job_col or 0, work_days_col, overtime_col or 0) + 1)
        name = clean(row[name_col])
        if not name or key(name) in ("nama", "total", "jumlah"):
            continue
        department = clean(row[job_col]) if job_col is not None else ""
        actual_days = number(row[work_days_col])
        # Stop below the table instead of creating records from notes/signatures.
        if actual_days == 0 and not department:
            continue
        overtime = number(row[overtime_col]) if overtime_col is not None else 0
        records.append({
            "employee_id": "name:" + re.sub(r"[^a-z0-9]+", "-", key(name)),
            "name": name.title(), "department": department.title(),
            "work_hours_standard": standard_days * 8, "work_hours_actual": actual_days * 8,
            "late_count": 0, "late_minutes": 0, "early_count": 0, "early_minutes": 0,
            "overtime_normal": overtime, "overtime_special": 0,
            "attendance_standard": standard_days, "attendance_actual": actual_days,
            "business_trip_days": 0, "absence_days": max(standard_days - actual_days, 0),
            "leave_days": 0, "attendance_rate": actual_days / standard_days if standard_days else 0,
        })
    return records or None


def summary_records(rows):
    records = []
    for row in rows[4:]:
        row = list(row) + [None] * 24
        employee_id, name, department = identifier(row[0]), clean(row[1]), clean(row[2])
        if not employee_id or not name:
            continue
        standard_days, actual_days = clean(row[11]).split("/") if "/" in clean(row[11]) else ("", "")
        records.append({
            "employee_id": employee_id, "name": name.title(), "department": department.title(),
            "work_hours_standard": number(row[3]), "work_hours_actual": number(row[4]),
            "late_count": number(row[5]), "late_minutes": number(row[6]),
            "early_count": number(row[7]), "early_minutes": number(row[8]),
            "overtime_normal": number(row[9]), "overtime_special": number(row[10]),
            "attendance_standard": number(standard_days), "attendance_actual": number(actual_days),
            "business_trip_days": number(row[12]), "absence_days": number(row[13]),
            "leave_days": number(row[14]), "attendance_rate": number(row[15]),
        })
    return records


def raw_attendance(raw_rows):
    """Calculate attendance from the shift grid when summary formulas are stale."""
    if len(raw_rows) < 5:
        return {}
    header_row = next((index for index, row in enumerate(raw_rows[:8]) if any(key(value) == "nama" for value in row)), None)
    if header_row is None:
        return {}
    header = raw_rows[header_row]
    name_col = next((index for index, value in enumerate(header) if key(value) == "nama"), 1)
    type_col = next((index for index, value in enumerate(header) if key(value) in ("tipe", "type")), None)
    # A sheet without IN/OUT rows is a shift schedule, not actual attendance.
    if type_col is None:
        return {}
    day_columns = [index for index, value in enumerate(header) if index > name_col and clean(value).replace(".0", "").isdigit()]
    if not day_columns:
        return {}
    result = {}
    for row in raw_rows[header_row + 1:]:
        if len(row) <= name_col or not clean(row[name_col]):
            continue
        # The All sheet has one IN and one OUT row per employee. A day counts
        # only when the IN row has an actual clock-in time, not a schedule flag.
        if len(row) <= type_col or key(row[type_col]) != "in":
            continue
        actual = sum(1 for index in day_columns if index < len(row) and clean(row[index]))
        result[key(row[name_col])] = (len(day_columns), actual)
    return result


def time_text(value):
    """Return HH:MM for an Excel time, otherwise an empty string."""
    if isinstance(value, datetime):
        return value.strftime("%H:%M")
    if hasattr(value, "hour") and hasattr(value, "minute"):
        return f"{value.hour:02d}:{value.minute:02d}"
    if isinstance(value, (int, float)) and 0 < value < 1:
        minutes = round(value * 24 * 60)
        return f"{(minutes // 60) % 24:02d}:{minutes % 60:02d}"
    match = re.search(r"\b([01]?\d|2[0-3]):([0-5]\d)", clean(value))
    return f"{int(match.group(1)):02d}:{match.group(2)}" if match else ""


def period_dates(period):
    found = re.findall(r"(\d{4})-(\d{2})-(\d{2})", period)
    if len(found) < 2:
        return []
    start, end = (date(*map(int, item)) for item in found[:2])
    return [start + timedelta(days=index) for index in range((end - start).days + 1)]


def raw_time_logs(raw_rows, period):
    """Keep every daily clock event and derive earliest IN/latest OUT per date."""
    if len(raw_rows) < 5:
        return []
    header_row = next((index for index, row in enumerate(raw_rows[:8]) if any(key(value) == "nama" for value in row)), None)
    if header_row is None:
        return []
    header = raw_rows[header_row]
    name_col = next((index for index, value in enumerate(header) if key(value) == "nama"), 1)
    type_col = next((index for index, value in enumerate(header) if key(value) in ("tipe", "type")), None)
    if type_col is None:
        return []
    day_columns = [index for index, value in enumerate(header) if index > type_col and clean(value).replace(".0", "").isdigit()]
    dates = period_dates(period)
    if not day_columns or not dates:
        return []
    available = list(dates)
    column_dates = {}
    for column in day_columns:
        day = int(float(header[column]))
        match = next((item for item in available if item.day == day), None)
        if match:
            column_dates[column] = match.isoformat()
            available.remove(match)
    events = {}
    for row in raw_rows[header_row + 1:]:
        if len(row) <= max(name_col, type_col) or not clean(row[name_col]):
            continue
        name = clean(row[name_col]).title()
        event_type = key(row[type_col])
        if event_type not in ("in", "out"):
            continue
        for column, day in column_dates.items():
            if column >= len(row):
                continue
            value = time_text(row[column])
            if value:
                events.setdefault((name, day), {"in": [], "out": []})[event_type].append(value)
    logs = []
    for (name, day), values in events.items():
        # IN and OUT are distinct source rows. Preserve that direction instead
        # of sorting both values, which turns a 23:54 IN / 12:04 OUT overnight
        # shift into the wrong pair.
        in_times, out_times = values["in"], values["out"]
        if not in_times and not out_times:
            continue
        times = in_times + out_times
        if len(times) == 1:
            # A single scan is assigned by its time, not by the source row:
            # before noon is an IN; noon and later is an OUT.
            clock_in, clock_out = (times[0], "") if times[0] < "12:00" else ("", times[0])
        else:
            clock_in, clock_out = (min(in_times) if in_times else "", max(out_times) if out_times else "")
        logs.append({"name": name, "attendance_date": day,
                     "clock_in": clock_in, "clock_out": clock_out, "raw_times": times})
    return logs


def detail_time_logs(sheets):
    """Read the per-ID sheets, where each employee occupies a 15-column block."""
    logs = []
    for rows in sheets:
        for base in range(0, max((len(row) for row in rows), default=0), 15):
            if len(rows) < 13 or len(rows[3]) <= base + 9:
                continue
            name = clean(rows[3][base + 9])
            period = clean(rows[4][base + 1]) if len(rows[4]) > base + 1 else ""
            dates = period_dates(period)
            if not name or not dates:
                continue
            available = list(dates)
            for row in rows[12:]:
                if not row or len(row) <= base:
                    continue
                label = clean(row[base])
                match = re.match(r"(\d{1,2})\b", label)
                if not match:
                    continue
                day_number = int(match.group(1))
                current = next((item for item in available if item.day == day_number), None)
                if current is None:
                    continue
                available.remove(current)
                in_times = [time_text(row[base + offset]) for offset in (1, 6, 10) if len(row) > base + offset and time_text(row[base + offset])]
                out_values = [row[base + offset] for offset in (3, 8, 12) if len(row) > base + offset and time_text(row[base + offset])]
                out_times = [time_text(value) for value in out_values]
                times = in_times + out_times
                if times:
                    if len(times) == 1:
                        # One scan is never duplicated into both columns. 12:00
                        # is treated as OUT; earlier scans are IN.
                        clock_in, clock_out = (times[0], "") if times[0] < "12:00" else ("", times[0])
                    else:
                        # A trailing + marks a checkout after midnight, therefore it
                        # belongs to the end of this workday even though 00:xx is
                        # numerically smaller than daytime hours.
                        after_midnight = [time_text(value) for value in out_values if "+" in clean(value)]
                        # The source sheet may put the final scan in the overtime-IN
                        # column. The final daytime scan is still the checkout.
                        clock_out = after_midnight[-1] if after_midnight else max(times)
                        clock_in = min(times)
                    logs.append({"name": name.title(), "attendance_date": current.isoformat(), "clock_in": clock_in, "clock_out": clock_out, "raw_times": times})
    return logs


def extract(path):
    rows, raw_rows, detail_sheets = rows_for(path)
    if len(rows) < 5:
        raise RuntimeError("Data absensi tidak lengkap.")
    records = grid_records(rows) or summary_records(rows)
    period = period_for(rows)
    logs = detail_time_logs(detail_sheets) or raw_time_logs(raw_rows, period)
    raw_days = raw_attendance(raw_rows)
    if logs:
        raw_days = {}
        for log in logs:
            raw_days.setdefault(key(log["name"]), set()).add(log["attendance_date"])
        standard = len(period_dates(period))
        raw_days = {name: (standard, len(days)) for name, days in raw_days.items()}
    for record in records:
        if key(record["name"]) in raw_days:
            standard, actual = raw_days[key(record["name"])]
            record["attendance_standard"] = standard
            record["attendance_actual"] = actual
            record["absence_days"] = max(standard - actual, 0)
            record["attendance_rate"] = actual / standard if standard else 0
            record["work_hours_standard"] = standard * 7.5
            record["work_hours_actual"] = actual * 7.5
    if not records:
        raise RuntimeError("Tidak ada karyawan yang terbaca dari sheet absensi.")
    return {"period": period, "records": records, "attendance_logs": logs}


if __name__ == "__main__":
    try:
        result = extract(Path(sys.argv[1]))
        Path(sys.argv[2]).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8") if len(sys.argv) > 2 else print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
