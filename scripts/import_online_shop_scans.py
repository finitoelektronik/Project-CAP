"""Extract scan-resi records from the CAP monthly scanner workbook."""
import json
import re
import sys

import openpyxl

source_path, output_path = sys.argv[1:3]
workbook = openpyxl.load_workbook(source_path, read_only=True, data_only=True)
sheet_date_overrides = {"sheet15": "2026-10-17"}
tracking_pattern = re.compile(r"(?:SPXID|SPXIID|PPXID|PXID|PXIID|SPXDD|JY)[A-Z0-9]+|\b\d{8,}\b", re.IGNORECASE)


def scan_date(sheet_name):
    normalized = str(sheet_name).strip().lower()
    if normalized in sheet_date_overrides:
        return sheet_date_overrides[normalized]
    match = re.match(r"^(\d{1,2})\s*okt", normalized)
    if not match:
        return ""
    day = int(match.group(1))
    return f"2026-10-{day:02d}" if 1 <= day <= 31 else ""


records = {}
sheets = []
for sheet in workbook.worksheets:
    date = scan_date(sheet.title)
    if not date:
        continue
    sheets.append(sheet.title)
    for row in sheet.iter_rows(values_only=True):
        for value in row:
            if value is None:
                continue
            for tracking_number in tracking_pattern.findall(str(value).upper()):
                tracking_number = tracking_number.strip()
                if len(tracking_number) < 8:
                    continue
                current = records.get(tracking_number)
                if not current or date < current["scan_date"]:
                    records[tracking_number] = {
                        "tracking_number": tracking_number,
                        "scan_date": date,
                        "source_sheet": sheet.title,
                    }

with open(output_path, "w", encoding="utf-8") as output:
    json.dump({"records": list(records.values()), "sheets": sheets}, output, ensure_ascii=False)
