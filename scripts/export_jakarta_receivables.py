import json
import re
import sys
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


MONTHS = [('JAN', 'JANUARI'), ('FEB', 'FEBRUARI'), ('MAR', 'MARET'), ('APRIL', 'APRIL'), ('MEI', 'MEI'), ('JUNI', 'JUNI'), ('JULI', 'JULI'), ('AGUSTUS', 'AGUSTUS'), ('SEPTEMBER', 'SEPTEMBER'), ('OKTOBER', 'OKTOBER'), ('NOVEMBER', 'NOVEMBER'), ('DES', 'DESEMBER')]
HEADERS = ['Tanggal', 'NOTA', 'Toko', 'Kota', 'Sales', 'Barang', 'Qty', 'Harga', 'Jumlah', 'Total', 'Keterangan']
BLUE = '1F4E78'
YELLOW = 'FFFF00'
WHITE = 'FFFFFF'
THIN = Side(style='thin', color='000000')
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
CURRENCY = '[$Rp-421] #,##0;[Red]-[$Rp-421] #,##0'


def safe_sheet_name(value):
    name = re.sub(r'[\\/*?:\[\]]', '_', str(value or 'Klasifikasi')).strip()[:31]
    return name or 'Klasifikasi'


def date_value(value):
    try:
        return datetime.strptime(str(value), '%Y-%m-%d')
    except ValueError:
        return value or ''


def payment_note(invoice):
    notes = [str(invoice.get('notes') or '').strip()]
    discount = float(invoice.get('invoice_discount') or 0)
    if discount:
        notes.append(f'Potongan nota: Rp {discount:,.0f}')
    for returned in invoice.get('returns') or []:
        name = str(returned.get('item_name') or 'Potongan retur').strip()
        amount = float(returned.get('amount') or 0)
        note = str(returned.get('notes') or '').strip()
        notes.append(f'Pot. R. {name} = Rp {amount:,.0f}{(" · " + note) if note else ""}')
    for payment in invoice.get('payments') or []:
        label = str(payment.get('notes') or '').strip()
        if not label:
            label = f"Pembayaran {payment.get('payment_method') or ''} {payment.get('payment_date') or ''}".strip()
        notes.append(f"{label} = Rp {float(payment.get('amount') or 0):,.0f}")
    return '\n'.join(item for item in notes if item)


def prepare_sheet(sheet, title, subtitle):
    sheet.merge_cells('A1:K1')
    sheet['A1'] = title
    sheet['A1'].font = Font(bold=True, size=13, color=WHITE)
    sheet['A1'].fill = PatternFill('solid', fgColor=BLUE)
    sheet['A1'].alignment = Alignment(horizontal='center')
    sheet.merge_cells('A2:K2')
    sheet['A2'] = subtitle
    sheet['A2'].font = Font(bold=True, size=11)
    sheet['A2'].alignment = Alignment(horizontal='center')
    sheet['A4'] = 'TOTAL OMSET'
    sheet['A4'].font = Font(bold=True)
    sheet['B4'] = '=SUM(J8:J1048576)'
    sheet['B4'].font = Font(bold=True)
    sheet['B4'].number_format = CURRENCY
    for index, header in enumerate(HEADERS, 1):
        cell = sheet.cell(7, index, header)
        cell.font = Font(bold=True, color=WHITE)
        cell.fill = PatternFill('solid', fgColor=BLUE)
        cell.alignment = Alignment(horizontal='center', vertical='center')
        cell.border = BORDER
    widths = [14, 16, 25, 16, 16, 42, 10, 16, 16, 18, 42]
    for index, width in enumerate(widths, 1):
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.freeze_panes = 'A8'
    sheet.sheet_view.showGridLines = False


def write_invoices(sheet, invoices):
    row = 8
    for invoice in invoices:
        items = invoice.get('items') or [{}]
        first_row = row
        balance = float(invoice.get('balance') or 0)
        paid_off = balance <= 0.005 and float(invoice.get('net_total') or invoice.get('total') or 0) > 0
        for index, item in enumerate(items):
            qty = float(item.get('quantity') or 0)
            price = float(item.get('unit_price') or 0)
            values = [date_value(invoice.get('invoice_date')) if index == 0 else '', invoice.get('invoice_number', '') if index == 0 else '', invoice.get('store_name', '') if index == 0 else '', invoice.get('city', '') if index == 0 else '', invoice.get('sales_name', '') if index == 0 else '', item.get('item_name', ''), qty, price, f'=G{row}*H{row}', '', payment_note(invoice) if index == 0 else '']
            for column, value in enumerate(values, 1):
                cell = sheet.cell(row, column, value)
                cell.border = BORDER
                cell.alignment = Alignment(vertical='top', wrap_text=True)
                if paid_off:
                    cell.fill = PatternFill('solid', fgColor=YELLOW)
            sheet.cell(row, 1).number_format = 'dd-mmm'
            for column in (8, 9, 10): sheet.cell(row, column).number_format = CURRENCY
            row += 1
        sheet.cell(first_row, 10, f'=SUM(I{first_row}:I{row - 1})')
        sheet.cell(first_row, 10).number_format = CURRENCY
    sheet.auto_filter.ref = f'A7:K{max(row - 1, 7)}'


def main(source, output):
    with open(source, encoding='utf-8') as handle:
        payload = json.load(handle)
    year = str(payload.get('year') or datetime.now().year)
    invoices = payload.get('invoices') or []
    classifications = payload.get('classifications') or []
    wb = Workbook()
    wb.remove(wb.active)

    for month_index, (sheet_name, month_name) in enumerate(MONTHS, 1):
        sheet = wb.create_sheet(sheet_name)
        prepare_sheet(sheet, 'PENJUALAN JAKARTA', f'{month_name} {year}')
        prefix = f'{year}-{month_index:02d}'
        write_invoices(sheet, [invoice for invoice in invoices if str(invoice.get('invoice_date') or '').startswith(prefix)])

    for classification in classifications:
        name = safe_sheet_name(classification.get('name'))
        if name in wb.sheetnames:
            name = safe_sheet_name(f'{name[:28]} {classification.get("id", "")}')
        sheet = wb.create_sheet(name)
        prepare_sheet(sheet, f'PIUTANG JAKARTA - {classification.get("name", "KLASIFIKASI")}', 'SELURUH RIWAYAT')
        stores = {str(store).strip().upper() for store in classification.get('stores') or []}
        write_invoices(sheet, [invoice for invoice in invoices if str(invoice.get('store_name') or '').strip().upper() in stores])

    wb.save(output)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
