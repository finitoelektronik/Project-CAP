"""Rebuild Jakarta receivables from the authoritative workbook.

Yellow invoice rows mean the referenced KU/giro has cleared.  Return rows
immediately following an invoice become a documented deduction for that invoice.
This is deliberately a one-shot reconciliation utility, not an upgrade package.
"""
import re
import sqlite3
import sys
from datetime import date, datetime

import openpyxl
from openpyxl.utils.datetime import from_excel


def text(value):
    return str(value or '').strip()


def number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def day(value, epoch):
    if isinstance(value, (datetime, date)):
        return value.strftime('%Y-%m-%d')
    if isinstance(value, (int, float)) and value > 0:
        return from_excel(value, epoch).strftime('%Y-%m-%d')
    return ''


def key(value):
    return ''.join(ch.lower() for ch in text(value) if ch.isalnum())


def is_yellow(cell):
    color = cell.fill.fgColor
    value = str(color.rgb or '').upper()
    return value.endswith('FFFF00') or value.endswith('FFFF00')


def parse_amount(note):
    match = re.search(r'=\s*(?:Rp\s*)?([\d.]+(?:,\d{1,2})?)', note, re.I)
    if not match:
        match = re.search(r'(?<!\d)([\d]{1,3}(?:\.\d{3})+(?:,\d{1,2})?)(?!\d)', note)
    if not match:
        return 0.0
    return number(match.group(1).replace('.', '').replace(',', '.'))


def parse_date_from_note(note, fallback):
    match = re.search(r'\((\d{1,2})\s*/\s*(\d{1,2})(?:\s*/\s*(\d{2,4}))?\)', note)
    if not match:
        match = re.search(r'\b(?:KU\s+(?:SITI|CAP)\s+)?(\d{1,2})\s*/\s*(\d{1,2})\b', note, re.I)
    if not match:
        return fallback
    year = match.group(3) if match.lastindex and match.lastindex >= 3 else fallback[:4]
    if len(str(year)) == 2:
        year = '20' + str(year)
    return f'{year}-{int(match.group(2)):02d}-{int(match.group(1)):02d}'


def parse_workbook(path):
    book = openpyxl.load_workbook(path, data_only=False)
    groups = []
    for sheet in book.worksheets:
        if sheet.title.upper() not in {'JAN', 'FEB', 'MAR', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DES'}:
            continue
        header_row = None
        columns = {}
        for idx, row in enumerate(sheet.iter_rows(values_only=True), 1):
            keys = [key(value) for value in row]
            if ('tgl' in keys or 'tanggal' in keys) and 'barang' in keys:
                header_row = idx
                columns = {name: pos + 1 for pos, name in enumerate(keys) if name}
                break
        if not header_row:
            continue
        def col(*names):
            return next((columns[name] for name in names if name in columns), None)
        date_col, store_col, product_col = col('tgl', 'tanggal'), col('toko'), col('barang')
        city_col, sales_col, invoice_col = col('kota'), col('sales'), col('nota')
        qty_col, price_col, total_col, note_col = col('qty'), col('harga'), col('total'), col('keterangan', 'ketarangan')
        current = None
        for row in range(header_row + 1, sheet.max_row + 1):
            product = text(sheet.cell(row, product_col).value) if product_col else ''
            note = text(sheet.cell(row, note_col).value) if note_col else ''
            raw_date = sheet.cell(row, date_col).value if date_col else ''
            row_date = day(raw_date, book.epoch) if date_col else ''
            # Several January source cells contain a day number (2, 8, …) while
            # retaining the sheet's month/year rather than a full Excel date.
            if isinstance(raw_date, (int, float)) and 0 < raw_date <= 31:
                month = {'JAN': 1, 'FEB': 2, 'MAR': 3, 'APRIL': 4, 'MEI': 5, 'JUNI': 6, 'JULI': 7, 'AGUSTUS': 8, 'SEPTEMBER': 9, 'OKTOBER': 10, 'NOVEMBER': 11, 'DES': 12}.get(sheet.title.upper(), 1)
                row_date = date(2026, month, int(raw_date)).isoformat()
            row_store = text(sheet.cell(row, store_col).value) if store_col else ''
            # A populated date or store begins a new invoice, even when both values
            # happen to match the preceding invoice (the source uses this pattern).
            if product and (row_date or row_store or current is None):
                current = {
                    'sheet': sheet.title, 'row': row, 'invoice_date': row_date,
                    'invoice_number': text(sheet.cell(row, invoice_col).value) if invoice_col else '',
                    'store_name': row_store, 'city': text(sheet.cell(row, city_col).value) if city_col else '',
                    'sales_name': text(sheet.cell(row, sales_col).value) if sales_col else '',
                    'notes': note, 'items': [], 'returns': [], 'yellow': is_yellow(sheet.cell(row, product_col)),
                    'source_total': number(sheet.cell(row, total_col).value) if total_col else 0,
                }
                groups.append(current)
            if product and current:
                price = number(sheet.cell(row, price_col).value) if price_col else 0
                # The supplied screenshot corrects this stale workbook formula value.
                if sheet.title == 'JAN' and row == 119 and product == 'TV BRACKET FINITO CF-1442':
                    price = 39000
                current['items'].append({
                    'item_name': product,
                    'quantity': number(sheet.cell(row, qty_col).value) if qty_col else 0,
                    'unit_price': price,
                })
                current['yellow'] = current['yellow'] or is_yellow(sheet.cell(row, product_col))
                if not current['notes'] and note:
                    current['notes'] = note
                if total_col and not current['source_total']:
                    current['source_total'] = number(sheet.cell(row, total_col).value)
            elif current and note and re.match(r'\s*pot\.?\s*r', note, re.I):
                current['returns'].append({'item_name': re.sub(r'^\s*pot\.?\s*r\.?\s*', '', note, flags=re.I), 'amount': parse_amount(note), 'notes': note, 'source_sheet': sheet.title, 'source_row': row})
    return [group for group in groups if group['invoice_date'] and group['store_name'] and group['items']]


def reconcile(workbook, database):
    groups = parse_workbook(workbook)
    db = sqlite3.connect(database)
    db.execute('PRAGMA foreign_keys = ON')
    db.execute('''CREATE TABLE IF NOT EXISTS jakarta_receivable_returns (
        id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES jakarta_receivable_invoices(id) ON DELETE CASCADE,
        item_name TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
        source_sheet TEXT NOT NULL DEFAULT '', source_row INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)''')
    db.execute('BEGIN')
    try:
        db.execute('DELETE FROM jakarta_receivable_payments')
        db.execute('DELETE FROM jakarta_receivable_returns')
        db.execute('DELETE FROM jakarta_receivable_invoices')
        invoice_sql = '''INSERT INTO jakarta_receivable_invoices
          (invoice_date,due_date,invoice_number,store_name,city,sales_name,notes,total,invoice_discount,created_by)
          VALUES (?,?,?,?,?,?,?,?,?,?)'''
        item_sql = 'INSERT INTO jakarta_receivable_items(invoice_id,item_name,quantity,unit_price) VALUES (?,?,?,?)'
        return_sql = 'INSERT INTO jakarta_receivable_returns(invoice_id,item_name,amount,notes,source_sheet,source_row) VALUES (?,?,?,?,?,?)'
        payment_sql = 'INSERT INTO jakarta_receivable_payments(payment_date,amount,payment_method,notes,created_by) VALUES (?,?,?,?,?)'
        allocation_sql = 'INSERT INTO jakarta_receivable_allocations(payment_id,invoice_id,amount) VALUES (?,?,?)'
        imported = []
        for group in groups:
            total = sum(item['quantity'] * item['unit_price'] for item in group['items'])
            generic_returns = [entry['amount'] for entry in group['returns'] if entry['amount'] > 0 and re.match(r'^[^A-Za-z]*\d', entry['item_name'])]
            detailed_returns = [entry['amount'] for entry in group['returns'] if entry['amount'] > 0 and not re.match(r'^[^A-Za-z]*\d', entry['item_name'])]
            # A summary line and detailed return names describe one deduction.
            detailed_total = max(generic_returns) if generic_returns else sum(detailed_returns)
            # A numeric total cell records the net invoice total (Hero Motor is an
            # example); use it when it is a smaller value than item totals.
            stated_deduction = max(0, total - group['source_total']) if group['source_total'] and group['source_total'] < total else 0
            discount = max(detailed_total, stated_deduction)
            # Keep an over-sized return as documented detail, but do not let it
            # erase an unrelated invoice. It requires a later credit allocation.
            if discount > total:
                discount = 0
            due = (datetime.strptime(group['invoice_date'], '%Y-%m-%d').date()).toordinal() + 120
            due_date = date.fromordinal(due).isoformat()
            cur = db.execute(invoice_sql, (group['invoice_date'], due_date, group['invoice_number'], group['store_name'], group['city'], group['sales_name'], group['notes'], total, discount, 'rekonsiliasi-excel'))
            invoice_id = cur.lastrowid
            for item in group['items']:
                db.execute(item_sql, (invoice_id, item['item_name'], item['quantity'], item['unit_price']))
            if group['returns']:
                for entry in group['returns']:
                    db.execute(return_sql, (invoice_id, entry['item_name'] or 'Potongan retur', entry['amount'], entry['notes'], entry['source_sheet'], entry['source_row']))
            elif stated_deduction:
                db.execute(return_sql, (invoice_id, 'Selisih total pada sumber', stated_deduction, 'Potongan sesuai total bersih pada Excel', group['sheet'], group['row']))
            imported.append({'id': invoice_id, 'group': group, 'net': max(0, total - discount)})

        # A named KU/giro may cover several consecutive yellow invoices.
        active = None
        def finish_active():
            nonlocal active
            if not active or not active['allocations']:
                active = None
                return
            amount = sum(row['amount'] for row in active['allocations'])
            payment = db.execute(payment_sql, (active['date'], amount, active['method'], 'Impor Excel kuning: ' + active['note'], 'rekonsiliasi-excel')).lastrowid
            for allocation in active['allocations']:
                db.execute(allocation_sql, (payment, allocation['invoice_id'], allocation['amount']))
            active = None

        for entry in imported:
            group, net = entry['group'], entry['net']
            if active and active['store'] != group['store_name'].upper():
                finish_active()
            if not group['yellow']:
                finish_active()
                continue
            note = group['notes']
            named = bool(re.search(r'\b(?:KU|GIRO|CEK|TF|LEBIH\s+BAYAR)\b', note, re.I))
            if named:
                finish_active()
                active = {'store': group['store_name'].upper(), 'note': note or 'Tercatat lunas dari penanda kuning Excel', 'date': parse_date_from_note(note, group['invoice_date']), 'method': 'GIRO CAIR' if re.search(r'\bgiro\b', note, re.I) else ('KU' if re.search(r'\bku\b', note, re.I) else 'LUNAS EXCEL'), 'target': parse_amount(note) or net, 'allocations': []}
            if not active:
                active = {'store': group['store_name'].upper(), 'note': 'Tercatat lunas dari penanda kuning Excel', 'date': group['invoice_date'], 'method': 'LUNAS EXCEL', 'target': net, 'allocations': []}
            elif active['allocations'] and sum(row['amount'] for row in active['allocations']) + net > active['target'] + 0.005:
                finish_active()
                active = {'store': group['store_name'].upper(), 'note': 'Tercatat lunas dari penanda kuning Excel', 'date': group['invoice_date'], 'method': 'LUNAS EXCEL', 'target': net, 'allocations': []}
            active['allocations'].append({'invoice_id': entry['id'], 'amount': net})
            if sum(row['amount'] for row in active['allocations']) >= active['target'] - 0.005:
                finish_active()
        finish_active()
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return len(groups)


if __name__ == '__main__':
    print(reconcile(sys.argv[1], sys.argv[2]))
