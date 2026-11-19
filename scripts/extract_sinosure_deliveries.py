import json
import re
import sys
from datetime import datetime

from openpyxl import load_workbook


def text(value):
    return '' if value is None else str(value).strip()


def date(value):
    if isinstance(value, datetime):
        return value.strftime('%Y-%m-%d')
    raw = text(value)
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%d/%m/%Y', '%d/%m/%y'):
        try:
            return datetime.strptime(raw, fmt).strftime('%Y-%m-%d')
        except ValueError:
            pass
    return raw


def number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0


def column_map(headers):
    columns = {}
    for index, raw in enumerate(headers):
        label = text(raw).lower().replace('\n', ' ')
        if 'ship date' in label:
            columns['ship_date'] = index
        elif 'invoice number' in label:
            columns['invoice_number'] = index
        elif 'pi number' in label:
            columns['pi_number'] = index
        elif 'product model' in label:
            columns['product_model'] = index
        elif label == 'pcs' or ' pcs' in label:
            columns['quantity'] = index
        elif 'unit price' in label and 'cny' in label:
            columns['unit_price_cny'] = index
        elif 'unit price' in label and 'idr' in label:
            columns['unit_price_idr'] = index
        elif 'total' in label and 'cny' in label:
            columns['total_cny'] = index
        elif 'total' in label and 'idr' in label:
            columns['total_idr'] = index
        elif 'payment terms' in label:
            columns['payment_terms'] = index
        elif 'insured status' in label:
            columns['insured_status'] = index
        elif 'remark' in label:
            columns['remarks'] = index
    return columns


def value(row, columns, name):
    index = columns.get(name)
    return row[index] if index is not None and index < len(row) else None


book = load_workbook(sys.argv[1], read_only=True, data_only=True)
items = []
for sheet in book.worksheets:
    match = re.search(r'L0*(\d+)', sheet.title, re.I)
    if not match:
        continue
    code = 'L%03d' % int(match.group(1))
    headers = next(sheet.iter_rows(min_row=3, max_row=3, values_only=True), ())
    columns = column_map(headers)
    if not {'ship_date', 'invoice_number', 'product_model', 'quantity'} <= columns.keys():
        continue
    inherited = {key: '' for key in ('ship_date', 'invoice_number', 'pi_number', 'payment_terms', 'insured_status', 'remarks')}
    for row in sheet.iter_rows(min_row=4, values_only=True):
        if not any(text(cell) for cell in row):
            continue
        for key in inherited:
            raw = value(row, columns, key)
            if text(raw):
                inherited[key] = date(raw) if key == 'ship_date' else text(raw)
        model = text(value(row, columns, 'product_model'))
        quantity = number(value(row, columns, 'quantity'))
        if not model or not quantity:
            continue
        items.append({
            'client_sequence': code,
            'ship_date': inherited['ship_date'],
            'invoice_number': inherited['invoice_number'],
            'pi_number': inherited['pi_number'],
            'product_model': model,
            'quantity': quantity,
            'unit_price_cny': number(value(row, columns, 'unit_price_cny')),
            'unit_price_idr': number(value(row, columns, 'unit_price_idr')),
            'total_cny': number(value(row, columns, 'total_cny')),
            'total_idr': number(value(row, columns, 'total_idr')),
            'payment_terms': inherited['payment_terms'],
            'insured_status': inherited['insured_status'],
            'remarks': inherited['remarks'],
        })

with open(sys.argv[2], 'w', encoding='utf-8') as output:
    json.dump({'items': items}, output, ensure_ascii=False)
