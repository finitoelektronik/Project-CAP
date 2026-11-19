import json
import sys
from datetime import date, datetime


def key(value):
    return ''.join(ch.lower() for ch in str(value or '') if ch.isalnum())


def text(value):
    if value is None:
        return ''
    return str(value).strip()


def date_value(value):
    if isinstance(value, (datetime, date)):
        return value.strftime('%Y-%m-%d')
    raw = text(value)
    for fmt in ('%d-%b-%y', '%d-%b-%Y', '%d/%m/%Y', '%d-%m-%Y', '%Y-%m-%d'):
        try:
            return datetime.strptime(raw, fmt).strftime('%Y-%m-%d')
        except ValueError:
            pass
    return raw


def amount(value):
    if isinstance(value, (int, float)):
        return float(value)
    raw = text(value).lower().replace('rp', '').replace(' ', '')
    if ',' in raw and '.' in raw:
        raw = raw.replace('.', '').replace(',', '.')
    elif '.' in raw and raw.count('.') > 1:
        raw = raw.replace('.', '')
    elif ',' in raw:
        raw = raw.replace('.', '').replace(',', '.')
    else:
        raw = raw.replace('.', '')
    try:
        return float(raw or 0)
    except ValueError:
        return 0


def rows_xlsx(path):
    import openpyxl
    workbook = openpyxl.load_workbook(path, data_only=True, read_only=True)
    sheet = workbook.active
    return list(sheet.iter_rows(values_only=True))


def rows_xls(path):
    import xlrd
    book = xlrd.open_workbook(path)
    sheet = book.sheet_by_index(0)
    output = []
    for index in range(sheet.nrows):
        row = []
        for column in range(sheet.ncols):
            value = sheet.cell_value(index, column)
            if sheet.cell_type(index, column) == xlrd.XL_CELL_DATE:
                value = xlrd.xldate_as_datetime(value, book.datemode)
            row.append(value)
        output.append(row)
    return output


def main(source, output):
    rows = rows_xls(source) if source.lower().endswith('.xls') else rows_xlsx(source)
    header_index = next((index for index, row in enumerate(rows) if {'tanggal', 'kategori', 'nama', 'no', 'keterangan', 'nominal'}.issubset({key(cell) for cell in row})), None)
    if header_index is None:
        raise ValueError('Header Excel harus memuat: Tanggal, kategori, Nama, No, Keterangan, Nominal.')
    header = {key(cell): position for position, cell in enumerate(rows[header_index])}
    items = []
    for row in rows[header_index + 1:]:
        get = lambda name: row[header[name]] if header[name] < len(row) else ''
        if not any(text(cell) for cell in row):
            continue
        category = text(get('kategori'))
        if not category:
            continue
        items.append({
            'transaction_date': date_value(get('tanggal')),
            'category': category,
            'name': text(get('nama')),
            'source_number': text(get('no')),
            'description': text(get('keterangan')),
            'amount': amount(get('nominal')),
        })
    with open(output, 'w', encoding='utf-8') as file:
        json.dump({'items': items}, file, ensure_ascii=False)


if __name__ == '__main__':
    try:
        main(sys.argv[1], sys.argv[2])
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
