import json
import re
import sys
from datetime import date, datetime
import openpyxl


def key(value):
    return re.sub(r'[^a-z0-9]+', '', str(value or '').lower())


def text(value):
    return str(value or '').strip()


def day(value):
    if isinstance(value, (date, datetime)):
        return value.strftime('%Y-%m-%d')
    raw = text(value)
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y', '%d/%m/%y', '%d-%m-%y'):
        try:
            return datetime.strptime(raw, fmt).strftime('%Y-%m-%d')
        except ValueError:
            pass
    match = re.search(r'(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?', raw)
    if match:
        year = match.group(3) or str(datetime.now().year)
        year = ('20' + year) if len(year) == 2 else year
        return f'{year}-{int(match.group(2)):02d}-{int(match.group(1)):02d}'
    return ''


def number(value):
    if isinstance(value, (int, float)):
        return value
    raw = re.sub(r'[^0-9,.-]', '', text(value))
    if raw.count('.') > 1 or ('.' in raw and ',' in raw and raw.rfind(',') > raw.rfind('.')):
        raw = raw.replace('.', '').replace(',', '.')
    elif ',' in raw:
        raw = raw.replace('.', '').replace(',', '.')
    try:
        return float(raw or 0)
    except ValueError:
        return 0


def find(header, *names):
    for name in names:
        if key(name) in header:
            return header[key(name)]
    return None


def get(row, index):
    return row[index] if index is not None and index < len(row) else ''


def instrument(note):
    raw = text(note)
    upper = raw.upper()
    found = 'kospin' if 'KOSPIN' in upper else ('giro' if 'GIRO' in upper else ('cek' if 'CEK' in upper or 'CHECK' in upper else ''))
    number_match = re.search(r'(?:KOSPIN(?:\s+JASA)?|GIRO(?:\s+\w+)?|CEK|CHECK)\s*([A-Z0-9-]+)', upper)
    date_match = re.search(r'\((\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\)', raw)
    account_match = re.search(r'REK(?:ENING)?\.?\s*([A-Za-z0-9 .-]+)', raw, re.I)
    return found, number_match.group(1) if number_match else '', day(date_match.group(1)) if date_match else '', account_match.group(1).strip() if account_match else ''


def main(source, output):
    sheet = openpyxl.load_workbook(source, data_only=True, read_only=True).active
    rows = list(sheet.iter_rows(values_only=True))
    header_at = next((i for i, row in enumerate(rows) if 'tgl' in {key(x) for x in row} and ('nota' in {key(x) for x in row} or 'keterangan' in {key(x) for x in row})), None)
    if header_at is None:
        raise ValueError('Header Excel tidak ditemukan. Gunakan kolom Tgl, Nota, dan Keterangan.')
    header = {key(cell): index for index, cell in enumerate(rows[header_at]) if key(cell)}
    output_rows = []
    for row in rows[header_at + 1:]:
        if not any(text(cell) for cell in row):
            continue
        notes = text(get(row, find(header, 'keterangan', 'ketarangan')))
        inferred_type, inferred_number, inferred_date, inferred_account = instrument(notes)
        kind = text(get(row, find(header, 'jenis instrumen', 'jenis'))).lower() or inferred_type
        if kind not in ('kospin', 'cek', 'giro'):
            continue
        due = day(get(row, find(header, 'tanggal cair', 'tgl cair'))) or inferred_date
        if not due:
            raise ValueError(f'Tanggal cair belum tersedia untuk Nota {text(get(row, find(header, "nota"))) or "tanpa nota"}.')
        output_rows.append({
            'transaction_date': day(get(row, find(header, 'tgl', 'tanggal'))), 'nota': text(get(row, find(header, 'nota'))),
            'store_name': text(get(row, find(header, 'toko'))), 'city': text(get(row, find(header, 'kota'))), 'sales_name': text(get(row, find(header, 'sales'))),
            'item_name': text(get(row, find(header, 'barang'))), 'quantity': number(get(row, find(header, 'qty'))), 'unit_price': number(get(row, find(header, 'harga'))),
            'amount': number(get(row, find(header, 'jumlah'))), 'total': number(get(row, find(header, 'total'))), 'source_notes': notes,
            'instrument_type': kind, 'instrument_number': text(get(row, find(header, 'nomor instrumen', 'no instrumen'))) or inferred_number,
            'maturity_date': due, 'destination_account': text(get(row, find(header, 'rekening tujuan', 'rekening'))) or inferred_account
        })
    with open(output, 'w', encoding='utf-8') as handle:
        json.dump({'items': output_rows}, handle, ensure_ascii=False)


if __name__ == '__main__':
    try:
        main(sys.argv[1], sys.argv[2])
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
