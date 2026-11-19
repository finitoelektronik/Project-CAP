import json
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


def numeric(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0


def write_summary(sheet, header_row, headers, rows, currency_columns, title):
    index = {str(header).strip().lower(): column for column, header in enumerate(headers, 1)}
    debit_column = index.get('debit')
    credit_column = index.get('kredit')
    saldo_column = index.get('saldo')
    start_row = header_row + len(rows) + 2
    label_cell = sheet.cell(start_row, 1, 'RINGKASAN')
    label_cell.font = Font(bold=True, color='17345F')

    if debit_column and credit_column:
        total_debit = sum(numeric(row[debit_column - 1]) for row in rows if len(row) >= debit_column)
        total_credit = sum(numeric(row[credit_column - 1]) for row in rows if len(row) >= credit_column)
        sheet.cell(start_row + 1, 1, 'TOTAL DEBIT').font = Font(bold=True)
        sheet.cell(start_row + 1, debit_column, total_debit).font = Font(bold=True)
        sheet.cell(start_row + 2, 1, 'TOTAL KREDIT').font = Font(bold=True)
        sheet.cell(start_row + 2, credit_column, total_credit).font = Font(bold=True)
        sheet.cell(start_row + 3, 1, 'STATUS').font = Font(bold=True)
        difference = total_debit - total_credit
        sheet.cell(start_row + 3, 2, 'BALANCE' if abs(difference) < 0.01 else 'TIDAK BALANCE')
        if abs(difference) >= 0.01:
            sheet.cell(start_row + 3, 3, difference)
            currency_columns.add(3)
        currency_columns.update({debit_column, credit_column})

    if saldo_column:
        values = [numeric(row[saldo_column - 1]) for row in rows if len(row) >= saldo_column]
        value = values[-1] if title.startswith('BUKU BESAR') else sum(values)
        sheet.cell(start_row + 5, 1, 'SALDO AKHIR' if title.startswith('BUKU BESAR') else 'TOTAL SALDO').font = Font(bold=True)
        sheet.cell(start_row + 5, saldo_column, value).font = Font(bold=True)
        currency_columns.add(saldo_column)

    if title.startswith('KARTU STOK'):
        purchase_unit = index.get('beli unit')
        purchase_value = index.get('beli nilai')
        sale_unit = index.get('jual unit')
        sale_value = index.get('jual nilai')
        if purchase_unit:
            sheet.cell(start_row + 1, 1, 'TOTAL MUTASI').font = Font(bold=True)
            sheet.cell(start_row + 1, purchase_unit, sum(numeric(row[purchase_unit - 1]) for row in rows if len(row) >= purchase_unit))
            sheet.cell(start_row + 1, purchase_value, sum(numeric(row[purchase_value - 1]) for row in rows if len(row) >= purchase_value))
            sheet.cell(start_row + 1, sale_unit, sum(numeric(row[sale_unit - 1]) for row in rows if len(row) >= sale_unit))
            sheet.cell(start_row + 1, sale_value, sum(numeric(row[sale_value - 1]) for row in rows if len(row) >= sale_value))
            currency_columns.update({purchase_value, sale_value})


def main(source, output):
    with open(source, encoding='utf-8') as file:
        report = json.load(file)

    if report.get('annual_notes'):
        return write_annual_notes(report, output)
    if report.get('monthly_financial'):
        return write_monthly_financial(report['monthly_financial'], output)

    headers = report['headers']
    rows = report['rows']
    currency_columns = set(report.get('currency_columns', []))
    transaction_end_rows = set(report.get('transaction_end_rows', []))
    if report.get('title') == 'JURNAL UMUM':
        voucher_header = 'Nomor Bukti' if 'Nomor Bukti' in headers else 'No. Bukti'
        voucher_column = headers.index(voucher_header)
        transaction_end_rows.update(
            index for index, row in enumerate(rows)
            if index == len(rows) - 1 or row[voucher_column] != rows[index + 1][voucher_column]
        )
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = report.get('sheet_name', 'Laporan')[:31]
    last_column = get_column_letter(max(1, len(headers)))

    sheet.merge_cells(f'A1:{last_column}1')
    sheet['A1'] = report.get('title', 'LAPORAN ACCOUNTING LITE')
    sheet['A1'].font = Font(bold=True, size=14, color='FFFFFF')
    sheet['A1'].fill = PatternFill('solid', fgColor='17345F')
    sheet['A1'].alignment = Alignment(horizontal='center')
    sheet.merge_cells(f'A2:{last_column}2')
    sheet['A2'] = 'Periode: ' + report.get('period', 'Semua periode')
    sheet['A2'].font = Font(italic=True, color='44546A')
    sheet['A2'].alignment = Alignment(horizontal='center')

    stock_layers = report.get('stock_layers', [])
    header_row = 4
    account_code = str(report.get('account_code', '')).strip()
    note = str(report.get('note', '')).strip()
    details = ([] if not account_code else [f'Nomor rekening: {account_code}']) + ([] if not note else [note])
    for offset, detail in enumerate(details, 3):
        sheet.merge_cells(f'A{offset}:{last_column}{offset}')
        sheet.cell(offset, 1, detail)
        sheet.cell(offset, 1).font = Font(italic=True, color='44546A')
        sheet.cell(offset, 1).alignment = Alignment(wrap_text=True)
    if details:
        header_row = 3 + len(details) + 1
    if stock_layers:
        sheet.cell(4, 1, 'RINCIAN STOK TERSEDIA (FIFO)').font = Font(bold=True, color='17345F')
        layer_headers = ['NO', 'TANGGAL', 'UNIT', 'HARGA', 'JUMLAH']
        for column, value in enumerate(layer_headers, 1):
            cell = sheet.cell(5, column, value)
            cell.font = Font(bold=True, color='FFFFFF')
            cell.fill = PatternFill('solid', fgColor='356DFF')
            cell.alignment = Alignment(horizontal='center')
        for row_index, values in enumerate(stock_layers, 6):
            for column, value in enumerate(values, 1):
                cell = sheet.cell(row_index, column, value)
                cell.border = Border(bottom=Side(style='thin', color='D9E2F3'))
                if column in (4, 5):
                    cell.number_format = '[$Rp-421] #,##0.00'
        total_row = 6 + len(stock_layers)
        sheet.cell(total_row, 2, 'JUMLAH').font = Font(bold=True)
        sheet.cell(total_row, 3, sum(numeric(row[2]) for row in stock_layers)).font = Font(bold=True)
        sheet.cell(total_row, 5, sum(numeric(row[4]) for row in stock_layers)).font = Font(bold=True)
        sheet.cell(total_row, 5).number_format = '[$Rp-421] #,##0.00'
        header_row = total_row + 2
    for column, value in enumerate(headers, 1):
        cell = sheet.cell(header_row, column, value)
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = PatternFill('solid', fgColor='356DFF')
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)

    thin = Side(style='thin', color='D9E2F3')
    transaction_divider = Side(style='medium', color='8EA2BA')
    for data_index, values in enumerate(rows):
        row_index = header_row + 1 + data_index
        for column, value in enumerate(values, 1):
            cell = sheet.cell(row_index, column, value)
            cell.border = Border(bottom=transaction_divider if data_index in transaction_end_rows else thin)
            cell.alignment = Alignment(vertical='top', wrap_text=column not in currency_columns)
            if column in currency_columns:
                cell.number_format = '[$Rp-421] #,##0.00'

    write_summary(sheet, header_row, headers, rows, currency_columns, report.get('title', ''))
    for row in sheet.iter_rows():
        for cell in row:
            if cell.column in currency_columns and isinstance(cell.value, (int, float)):
                cell.number_format = '[$Rp-421] #,##0.00'

    for column, title in enumerate(headers, 1):
        max_length = max([len(str(title))] + [len(str(row[column - 1] if column <= len(row) else '')) for row in rows[:500]])
        sheet.column_dimensions[get_column_letter(column)].width = min(54, max(12, max_length + 2))
    sheet.freeze_panes = f'A{header_row + 1}'
    sheet.auto_filter.ref = f'A{header_row}:{last_column}{max(header_row + 1, header_row + len(rows))}'
    workbook.save(output)


def write_annual_notes(report, output):
    notes = report['annual_notes']
    profile = notes.get('profile') or {}
    yearly = notes.get('yearly') or {}
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'Catatan Atas'
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.orientation = 'portrait'
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.fitToWidth = 1
    sheet.column_dimensions['A'].width = 7
    sheet.column_dimensions['B'].width = 62
    sheet.column_dimensions['C'].width = 14
    sheet.column_dimensions['D'].width = 20
    for row, text, size, bold in [(1, profile.get('legal_entity_name') or 'IDENTITAS ENTITAS BELUM DIATUR', 14, True), (2, 'CATATAN ATAS LAPORAN KEUANGAN', 13, True), (3, 'UNTUK TAHUN YANG BERAKHIR PADA TANGGAL 31 DESEMBER ' + str(report.get('period','')).replace('Tahun ', ''), 11, False)]:
        sheet.merge_cells(start_row=row, start_column=1, end_row=row, end_column=4)
        cell = sheet.cell(row, 1, text)
        cell.font = Font(bold=bold, size=size, color='17345F')
        cell.alignment = Alignment(horizontal='center')
    current = 5
    intro = yearly.get('narrative_intro')
    if intro:
        sheet.merge_cells(start_row=current, start_column=1, end_row=current, end_column=4)
        sheet.cell(current, 1, intro).alignment = Alignment(wrap_text=True)
        current += 2
    thin = Side(style='thin', color='D9E2F3')
    for section in notes.get('sections', []):
        sheet.merge_cells(start_row=current, start_column=1, end_row=current, end_column=4)
        cell = sheet.cell(current, 1, f"{section.get('number')}. {section.get('title')}")
        cell.font = Font(bold=True, size=12, color='17345F')
        current += 1
        for group in section.get('groups', []):
            sheet.merge_cells(start_row=current, start_column=1, end_row=current, end_column=4)
            cell = sheet.cell(current, 1, group.get('title'))
            cell.font = Font(bold=True, color='17345F')
            cell.fill = PatternFill('solid', fgColor='EEF4FB')
            current += 1
            has_units = any(line.get('unit') is not None for line in group.get('lines', []))
            headers = ['KODE', 'URAIAN', 'UNIT' if has_units else '', 'NILAI']
            for column, text in enumerate(headers, 1):
                cell = sheet.cell(current, column, text)
                cell.font = Font(bold=True, color='44546A')
                cell.border = Border(bottom=thin)
            current += 1
            for line in group.get('lines', []):
                values = [line.get('code',''), line.get('display_name') or line.get('name',''), line.get('unit') if has_units else '', numeric(line.get('value'))]
                for column, item in enumerate(values, 1):
                    cell = sheet.cell(current, column, item)
                    cell.border = Border(bottom=thin)
                    cell.alignment = Alignment(vertical='top', wrap_text=column == 2)
                    if column == 4:
                        cell.number_format = '[$Rp-421] #,##0.00'
                current += 1
            sheet.cell(current, 2, 'Subtotal').font = Font(bold=True)
            total = sheet.cell(current, 4, numeric(group.get('total')))
            total.font = Font(bold=True)
            total.number_format = '[$Rp-421] #,##0.00'
            current += 2
    tax_note = yearly.get('tax_note')
    if tax_note:
        sheet.merge_cells(start_row=current, start_column=1, end_row=current, end_column=4)
        sheet.cell(current, 1, 'Catatan Pajak Penghasilan').font = Font(bold=True, color='17345F')
        current += 1
        sheet.merge_cells(start_row=current, start_column=1, end_row=current, end_column=4)
        sheet.cell(current, 1, tax_note).alignment = Alignment(wrap_text=True)
        current += 2
    if yearly.get('signatory_name') or yearly.get('issued_city'):
        city_date = ' , '.join(part for part in [yearly.get('issued_city',''), yearly.get('issued_date','')] if part)
        sheet.merge_cells(start_row=current, start_column=3, end_row=current, end_column=4)
        sheet.cell(current, 3, city_date).alignment = Alignment(horizontal='center')
        current += 3
        sheet.merge_cells(start_row=current, start_column=3, end_row=current, end_column=4)
        sheet.cell(current, 3, yearly.get('signatory_name','')).alignment = Alignment(horizontal='center')
        current += 1
        sheet.merge_cells(start_row=current, start_column=3, end_row=current, end_column=4)
        sheet.cell(current, 3, yearly.get('signatory_title','')).alignment = Alignment(horizontal='center')
    workbook.save(output)


def _statement_title(sheet, company, title, period, last_column):
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.orientation = 'landscape'
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.fitToWidth = 1
    for row, text in ((1, company), (2, title), (3, period)):
        sheet.merge_cells(start_row=row, start_column=1, end_row=row, end_column=last_column)
        cell = sheet.cell(row, 1, text)
        cell.font = Font(bold=True, size=14 if row == 1 else 12)
        cell.alignment = Alignment(horizontal='center')


def _statement_header(sheet, headers):
    fill = PatternFill('solid', fgColor='D9E1F2')
    for column, text in enumerate(headers, 1):
        cell = sheet.cell(5, column, text)
        cell.font = Font(bold=True)
        cell.fill = fill
        cell.border = Border(bottom=Side(style='thin', color='808080'))
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)


def _currency(cell):
    cell.number_format = '#,##0.00;[Red](#,##0.00);-'
    cell.alignment = Alignment(horizontal='right')


def _set_widths(sheet, widths):
    for column, width in widths.items():
        sheet.column_dimensions[column].width = width
    sheet.freeze_panes = 'A6'


def write_monthly_financial(report, output):
    workbook = Workbook()
    workbook.remove(workbook.active)
    company = report.get('company') or 'PT. CAHAYA ANUGERAH PRIMANIAGA'
    period = 'PERIODE ' + str(report.get('month_name') or '').upper() + ' ' + str(report.get('year') or '')
    thin = Side(style='thin', color='B7C9DD')

    balance = report.get('balance') or {}
    sheet = workbook.create_sheet('NERACA')
    _statement_title(sheet, company, 'NERACA', 'PER ' + period.replace('PERIODE ', ''), 5)
    _statement_header(sheet, ['NO', 'NO AKUN', 'URAIAN', 'BULAN LALU', 'S.D BULAN INI'])
    row_index, number = 6, 1
    for section in balance.get('sections') or []:
        label, items = section.get('name', ''), section.get('rows') or []
        sheet.cell(row_index, 2, label).font = Font(bold=True); row_index += 1
        for item in items:
            sheet.cell(row_index, 1, number); sheet.cell(row_index, 2, item.get('account_code', '')); sheet.cell(row_index, 3, item.get('account_name', ''))
            for col, key in ((4, 'previous'), (5, 'closing')):
                sheet.cell(row_index, col, numeric(item.get(key))); _currency(sheet.cell(row_index, col))
            for cell in sheet[row_index]: cell.border = Border(bottom=thin)
            number += 1; row_index += 1
        section_total = section.get('total') or {}
        total = numeric(section_total.get('closing'))
        sheet.cell(row_index, 3, 'JUMLAH ' + label).font = Font(bold=True)
        sheet.cell(row_index, 4, sum(numeric(item.get('previous')) for item in items)).font = Font(bold=True); _currency(sheet.cell(row_index, 4))
        sheet.cell(row_index, 5, total).font = Font(bold=True); _currency(sheet.cell(row_index, 5)); row_index += 2
    _set_widths(sheet, {'A':8, 'B':27, 'C':42, 'D':20, 'E':20})

    income = report.get('income') or {}
    sheet = workbook.create_sheet('LAPORAN LABA RUGI')
    _statement_title(sheet, company, 'LAPORAN LABA RUGI', period, 6)
    _statement_header(sheet, ['NO', 'NO AKUN', 'URAIAN', 'S.D BULAN LALU', 'BULAN INI', 'S.D BULAN INI'])
    row_index, number = 6, 1
    def income_detail(item):
        nonlocal row_index, number
        sheet.cell(row_index, 1, number); sheet.cell(row_index, 2, item.get('account_code', '')); sheet.cell(row_index, 3, item.get('account_name', ''))
        for col, key in ((4, 'previous'), (5, 'current'), (6, 'ytd')):
            sheet.cell(row_index, col, numeric(item.get(key))); _currency(sheet.cell(row_index, col))
        for cell in sheet[row_index]: cell.border = Border(bottom=thin)
        number += 1; row_index += 1
    def income_total(label, values):
        nonlocal row_index
        sheet.cell(row_index, 3, label).font = Font(bold=True)
        for col, key in ((4, 'previous'), (5, 'current'), (6, 'ytd')):
            sheet.cell(row_index, col, numeric(values.get(key))).font = Font(bold=True); _currency(sheet.cell(row_index, col))
        row_index += 2
    for section in income.get('sections') or []:
        label, rows = section.get('name', ''), section.get('rows') or []
        sheet.cell(row_index, 3, label).font = Font(bold=True)
        row_index += 1
        for item in rows: income_detail(item)
        income_total('JUMLAH ' + label, section.get('total') or {})
        if any(item.get('source') == 'hpp' for item in rows):
            income_total('LABA BRUTO', income.get('gross') or {})
    income_total('LABA / RUGI', income.get('net') or {})
    _set_widths(sheet, {'A':8, 'B':27, 'C':48, 'D':20, 'E':20, 'F':20})

    hpp = report.get('hpp') or {}
    sheet = workbook.create_sheet('HPP')
    _statement_title(sheet, company, 'HARGA POKOK PENJUALAN', period, 6)
    _statement_header(sheet, ['NO', 'NO AKUN', 'URAIAN', 'S.D BULAN LALU', 'BULAN INI', 'S.D BULAN INI'])
    row_index, number = 6, 1
    for section in hpp.get('rows') or []:
        items = section.get('rows') or []
        sheet.cell(row_index, 3, section.get('label', '')).font = Font(bold=True)
        for col, key in ((4, 'previous'), (5, 'current'), (6, 'ytd')):
            sheet.cell(row_index, col, sum(numeric(item.get(key)) for item in items)).font = Font(bold=True); _currency(sheet.cell(row_index, col))
        row_index += 1
        for item in items:
            sheet.cell(row_index, 1, number); sheet.cell(row_index, 2, item.get('account_code', '')); sheet.cell(row_index, 3, item.get('account_name', ''))
            for col, key in ((4, 'previous'), (5, 'current'), (6, 'ytd')):
                sheet.cell(row_index, col, numeric(item.get(key))); _currency(sheet.cell(row_index, col))
            for cell in sheet[row_index]: cell.border = Border(bottom=thin)
            number += 1; row_index += 1
        row_index += 1
    totals = hpp.get('totals') or {}
    sheet.cell(row_index, 3, 'HARGA POKOK PENJUALAN').font = Font(bold=True)
    for col, key in ((4, 'previous'), (5, 'current'), (6, 'ytd')):
        sheet.cell(row_index, col, numeric(totals.get(key))).font = Font(bold=True); _currency(sheet.cell(row_index, col))
    _set_widths(sheet, {'A':8, 'B':27, 'C':48, 'D':20, 'E':20, 'F':20})
    workbook.save(output)


if __name__ == '__main__':
    try:
        main(sys.argv[1], sys.argv[2])
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
