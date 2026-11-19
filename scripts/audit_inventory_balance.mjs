import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const db = new DatabaseSync(join(process.cwd(), 'data', 'app.db'), { readOnly: true });
const accounts = db.prepare('SELECT account_code,account_name,parent_code FROM accounting_accounts').all();
const byCode = new Map(accounts.map(row => [row.account_code, row]));
const roots = ['PERSEDIAAN BARANG JADI', 'PERSEDIAAN BAHAN PENOLONG']
  .map(name => accounts.find(row => String(row.account_name).trim().toUpperCase() === name))
  .filter(Boolean);

const normalSa = voucher => /^(?:\d{4}\/)?SA(?:[_\- ].*)?$/i.test(String(voucher || '')) && !detailSa(voucher);
const detailSa = voucher => /^(?:\d{4}\/)?SA(?:[_\- ].*\/|\/)/i.test(String(voucher || ''));
const isSa = voucher => /^(?:\d{4}\/)?SA(?:[_\- ].*|\/.*)?$/i.test(String(voucher || ''));
const descendants = root => accounts.filter(row => {
  let item = row, seen = new Set();
  while (item && !seen.has(item.account_code)) {
    if (item.parent_code === root.account_code) return true;
    seen.add(item.account_code);
    item = byCode.get(item.parent_code);
  }
  return false;
});
const endOfMonth = (year, month) => `${year}-${String(month).padStart(2, '0')}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
const cents = value => Math.round(Number(value || 0) * 100) / 100;
const failures = [];
const result = [];

for (let year = 2021; year <= 2026; year++) {
  for (const root of roots) {
    const codes = [root.account_code, ...descendants(root).map(row => row.account_code)];
    const marks = codes.map(() => '?').join(',');
    const lines = db.prepare(`SELECT j.transaction_date,j.voucher_number,l.account_code,l.debit,l.credit
      FROM accounting_journal_entries j JOIN accounting_journal_lines l ON l.journal_id=j.id
      WHERE l.account_code IN (${marks}) AND j.transaction_date>=? AND j.transaction_date<=?
      ORDER BY j.transaction_date,j.id,l.id`).all(...codes, `${year}-01-01`, `${year}-12-31`);
    const opening = cents(lines.filter(row => row.account_code === root.account_code && row.transaction_date === `${year}-01-01` && normalSa(row.voucher_number)).reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0));
    const detail = cents(lines.filter(row => row.account_code !== root.account_code && detailSa(row.voucher_number)).reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0));
    let priorClosing = opening;
    const months = [];
    for (let month = 1; month <= 12; month++) {
      const current = cents(lines.filter(row => !isSa(row.voucher_number) && row.transaction_date >= `${year}-01-01` && row.transaction_date <= endOfMonth(year, month)).reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), opening));
      const openingForMonth = month === 1 ? opening : priorClosing;
      if (month > 1 && openingForMonth !== priorClosing) failures.push(`${year}/${root.account_code}/bulan-${month}: rantai saldo HPP putus`);
      months.push({ month, opening: openingForMonth, closing: current });
      priorClosing = current;
    }
    result.push({ year, account: root.account_code, name: root.account_name, aggregate_sa: opening, excluded_detail_sa: detail, feb_opening: months[1].opening, jan_closing: months[0].closing, dec_closing: months[11].closing });
  }
}

console.log(JSON.stringify({ years_checked: '2021-2026', root_accounts: roots.length, checks: result.length * 12, failures, result }, null, 2));
