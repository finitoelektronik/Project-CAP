import json
import sqlite3
import sys
import zipfile

payload = json.load(open(sys.argv[1], encoding="utf-8"))
filters = payload.get("filters", {})
where = "WHERE media.media_type='video' AND (?='' OR report.input_date>=?) AND (?='' OR report.input_date<=?) AND (?='' OR report.store_name=?) AND (?='' OR report.product_name=?)"
args = [filters.get("start", ""), filters.get("start", ""), filters.get("end", ""), filters.get("end", ""), filters.get("store", ""), filters.get("store", ""), filters.get("product", ""), filters.get("product", "")]
connection = sqlite3.connect(payload["database"])
rows = connection.execute(f"SELECT media.id,media.original_name,media.media_data,report.input_date,report.store_name FROM online_shop_report_media media JOIN online_shop_reports report ON report.id=media.report_id {where} ORDER BY report.input_date DESC,media.id", args).fetchall()
connection.close()
if not rows:
    raise SystemExit("Tidak ada video pada klasifikasi yang dipilih.")
used = set()
with zipfile.ZipFile(sys.argv[2], "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for media_id, name, data, date, store in rows:
        safe = "".join(char if char.isalnum() or char in " ._-()" else "_" for char in name)
        path = f"{date}_{store}_{media_id}_{safe}"
        while path in used:
            path = f"{media_id}_{path}"
        used.add(path)
        archive.writestr(path, data)
