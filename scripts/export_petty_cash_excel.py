import json
import sys
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.utils import get_column_letter


def main(source, output):
    with open(source, encoding='utf-8') as file:
        report = json.load(file)

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'Pengeluaran Kas Kecil'
    title = 'REKAP PENGELUARAN KAS KECIL'
    period = report.get('period', 'Semua periode')
    sheet.merge_cells('A1:F1')
    sheet['A1'] = title
    sheet['A1'].font = Font(bold=True, size=14, color='FFFFFF')
    sheet['A1'].fill = PatternFill('solid', fgColor='17345F')
    sheet['A1'].alignment = Alignment(horizontal='center')
    sheet.merge_cells('A2:F2')
    sheet['A2'] = 'Periode: ' + period
    sheet['A2'].font = Font(italic=True, color='44546A')
    sheet['A2'].alignment = Alignment(horizontal='center')
    sheet.merge_cells('A3:E3')
    sheet['A3'] = 'Total pengeluaran'
    sheet['F3'] = report.get('total', 0)
    sheet['F3'].number_format = '[$Rp-421] #,##0'
    sheet['A3'].font = sheet['F3'].font = Font(bold=True)

    headers = ['Tanggal', 'Kategori', 'Nama', 'No.', 'Keterangan', 'Nominal']
    header_row = 5
    for column, value in enumerate(headers, 1):
        cell = sheet.cell(header_row, column, value)
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = PatternFill('solid', fgColor='356DFF')
        cell.alignment = Alignment(horizontal='center')

    thin = Side(style='thin', color='D9E2F3')
    for index, row in enumerate(report.get('records', []), header_row + 1):
        values = [row.get('transaction_date', ''), row.get('category_label', ''), row.get('person_name', ''), row.get('source_number', ''), row.get('description', ''), row.get('amount', 0)]
        for column, value in enumerate(values, 1):
            cell = sheet.cell(index, column, value)
            cell.border = Border(bottom=thin)
            cell.alignment = Alignment(vertical='top', wrap_text=column == 5)
        sheet.cell(index, 6).number_format = '[$Rp-421] #,##0'

    for column, width in enumerate([15, 20, 18, 10, 58, 18], 1):
        sheet.column_dimensions[get_column_letter(column)].width = width
    sheet.freeze_panes = 'A6'
    sheet.auto_filter.ref = f'A5:F{max(header_row + 1, header_row + len(report.get("records", [])))}'
    workbook.save(output)


if __name__ == '__main__':
    try:
        main(sys.argv[1], sys.argv[2])
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
