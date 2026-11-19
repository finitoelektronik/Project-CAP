#!/usr/bin/env node
/**
 * Pemulihan konfigurasi Accounting Lite.
 *
 * Alat ini tidak menyentuh rekening, jurnal, stok, atau invoice historis.
 * Jalankan hanya ketika layanan CAP Analytics dihentikan untuk pemeliharaan.
 * Secara standar alat ini hanya menampilkan rencana. Mutasi memerlukan
 * --apply, --maintenance-confirmed, dan token konfirmasi eksplisit.
 */
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const CONFIRMATION = 'REBUILD_ACCOUNTING_CONFIG';
const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const has = name => args.includes(name);
const databasePath = option('--database');
const backupDir = option('--backup-dir');
const apply = has('--apply');

function usage(message = '') {
  if (message) console.error(`ERROR: ${message}`);
  console.error(`\nPemakaian:\n  node scripts/rebuild_accounting_lite_configuration.mjs --database <app.db> [--backup-dir <folder>]\n  node scripts/rebuild_accounting_lite_configuration.mjs --database <app.db> --backup-dir <folder> --maintenance-confirmed --apply --confirm ${CONFIRMATION}\n\nMode pertama hanya membaca dan membuat rencana. Mode apply membuat salinan database dahulu, lalu hanya membangun ulang konfigurasi Accounting Lite.`);
  process.exitCode = 2;
}

if (!databasePath) {
  usage('Parameter --database wajib diisi.');
} else if (!existsSync(databasePath)) {
  usage(`Database tidak ditemukan: ${databasePath}`);
}

const sourcePath = resolve(databasePath || '.');
const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const scalar = (db, sql, ...values) => Number(db.prepare(sql).get(...values)?.value || 0);
const count = (db, table, condition = '1=1') => hasTable(db, table) ? scalar(db, `SELECT COUNT(*) value FROM ${table} WHERE ${condition}`) : 0;

function auditSnapshot(db) {
  const totalDebit = hasTable(db, 'accounting_journal_lines') ? scalar(db, 'SELECT COALESCE(SUM(debit),0) value FROM accounting_journal_lines') : 0;
  const totalCredit = hasTable(db, 'accounting_journal_lines') ? scalar(db, 'SELECT COALESCE(SUM(credit),0) value FROM accounting_journal_lines') : 0;
  return {
    integrity_check: String(db.prepare('PRAGMA integrity_check').get()?.integrity_check || ''),
    accounts: count(db, 'accounting_accounts'),
    journal_entries: count(db, 'accounting_journal_entries'),
    journal_lines: count(db, 'accounting_journal_lines'),
    journal_debit: totalDebit,
    journal_credit: totalCredit,
    journal_balanced: Math.abs(totalDebit - totalCredit) < 0.0001,
    legacy_inventory_transactions: count(db, 'accounting_legacy_inventory_transactions'),
    legacy_inventory_lines: count(db, 'accounting_legacy_inventory_lines'),
    inventory_documents: count(db, 'accounting_inventory_documents'),
    inventory_document_lines: count(db, 'accounting_inventory_document_lines'),
    invoices_historical_or_posted: count(db, 'accounting_invoices', "status IN ('historical','posted')"),
    invoices_draft: count(db, 'accounting_invoices', "status='draft'"),
    report_mappings: count(db, 'accounting_report_mappings'),
    report_special_lines: count(db, 'accounting_report_special_lines'),
  };
}

function assertAuditUnchanged(before, after) {
  const protectedKeys = [
    'accounts', 'journal_entries', 'journal_lines', 'journal_debit', 'journal_credit',
    'legacy_inventory_transactions', 'legacy_inventory_lines', 'inventory_documents',
    'inventory_document_lines', 'invoices_historical_or_posted',
  ];
  for (const key of protectedKeys) {
    if (before[key] !== after[key]) throw new Error(`Pemeriksaan audit gagal: ${key} berubah (${before[key]} menjadi ${after[key]}).`);
  }
  if (after.integrity_check !== 'ok' || !after.journal_balanced) throw new Error('Pemeriksaan integritas atau keseimbangan jurnal gagal setelah transformasi.');
}

function invoiceProfileRepair(db) {
  if (!hasTable(db, 'accounting_invoice_profiles') || !hasTable(db, 'accounting_accounts')) return { updated: false, reason: 'Tabel profil atau rekening belum tersedia.' };
  const accountExists = code => Boolean(db.prepare('SELECT 1 FROM accounting_accounts WHERE account_code=?').get(code));
  const sales = '04.07.000.000.000.0000';
  const vat = '02.05.001.000.000.0000';
  const current = db.prepare('SELECT * FROM accounting_invoice_profiles WHERE id=1').get();
  if (!current) return { updated: false, reason: 'Profil invoicing belum ada; aplikasi akan membuat profil standar saat dibuka.' };
  const nextSales = accountExists(sales) ? sales : current.sales_account_code;
  const nextVat = accountExists(vat) ? vat : current.vat_payable_account_code;
  db.prepare("UPDATE accounting_invoice_profiles SET sales_account_code=?, vat_payable_account_code=?, updated_by='recovery-tool', updated_at=CURRENT_TIMESTAMP WHERE id=1").run(nextSales, nextVat);
  return { updated: true, sales_account_code: nextSales, vat_payable_account_code: nextVat };
}

function backupDatabase(source, targetDirectory) {
  mkdirSync(targetDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(targetDirectory, `${basename(source, '.db')}-before-accounting-config-recovery-${stamp}.db`);
  copyFileSync(source, target);
  const backup = new DatabaseSync(target, { readOnly: true });
  const integrity = String(backup.prepare('PRAGMA integrity_check').get()?.integrity_check || '');
  backup.close();
  if (integrity !== 'ok') throw new Error(`Cadangan tidak valid (integrity_check: ${integrity}).`);
  return target;
}

function deleteDraftInvoices(db) {
  if (!hasTable(db, 'accounting_invoices')) return 0;
  const draftIds = db.prepare("SELECT id FROM accounting_invoices WHERE status='draft'").all().map(row => Number(row.id));
  if (!draftIds.length) return 0;
  if (hasTable(db, 'accounting_invoice_lines')) db.prepare(`DELETE FROM accounting_invoice_lines WHERE invoice_id IN (${draftIds.map(() => '?').join(',')})`).run(...draftIds);
  db.prepare(`DELETE FROM accounting_invoices WHERE id IN (${draftIds.map(() => '?').join(',')})`).run(...draftIds);
  return draftIds.length;
}

function rebuild(db) {
  const removed = {
    report_mappings: count(db, 'accounting_report_mappings'),
    report_special_lines: count(db, 'accounting_report_special_lines'),
    invoice_drafts: count(db, 'accounting_invoices', "status='draft'"),
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    if (hasTable(db, 'accounting_report_mappings')) db.exec('DELETE FROM accounting_report_mappings');
    if (hasTable(db, 'accounting_report_special_lines')) db.exec('DELETE FROM accounting_report_special_lines');
    removed.invoice_drafts = deleteDraftInvoices(db);
    const profile = invoiceProfileRepair(db);
    db.exec('COMMIT');
    return { removed, profile };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

if (databasePath && existsSync(databasePath)) {
  const readOnly = new DatabaseSync(sourcePath, { readOnly: true });
  const before = auditSnapshot(readOnly);
  readOnly.close();
  const plan = {
    mode: apply ? 'apply' : 'dry-run', database: sourcePath, source_directory: dirname(sourcePath), before,
    scope: {
      preserved: ['rekening', 'jurnal dan baris jurnal', 'stok lama dan stok operasional', 'invoice historis/posted', 'pengguna'],
      rebuilt: ['pemetaan Neraca, Laba Rugi, dan HPP', 'baris hasil khusus laporan', 'akun penjualan dan hutang PPN pada profil invoicing'],
      removed: ['invoice berstatus draft saja'],
      next_step: 'Setelah aplikasi dimulai kembali, buka masing-masing laporan sekali untuk membentuk pemetaan standar berbasis rekening server utama; lalu sesuaikan hanya melalui Pengaturan rekening laporan.',
    },
  };
  if (!apply) {
    console.log(JSON.stringify(plan, null, 2));
  } else if (!has('--maintenance-confirmed')) {
    usage('Tutup layanan CAP Analytics terlebih dahulu, lalu jalankan dengan --maintenance-confirmed.');
  } else if (option('--confirm') !== CONFIRMATION) {
    usage(`Token konfirmasi harus tepat: --confirm ${CONFIRMATION}`);
  } else if (!backupDir) {
    usage('Parameter --backup-dir wajib diisi saat --apply.');
  } else if (before.integrity_check !== 'ok' || !before.journal_balanced) {
    throw new Error('Database sumber tidak lolos pemeriksaan integritas/keseimbangan jurnal. Transformasi dibatalkan.');
  } else {
    const backupPath = backupDatabase(sourcePath, resolve(backupDir));
    const db = new DatabaseSync(sourcePath);
    try {
      db.exec('PRAGMA foreign_keys=ON');
      const result = rebuild(db);
      const after = auditSnapshot(db);
      assertAuditUnchanged(before, after);
      console.log(JSON.stringify({ ...plan, backup: backupPath, result, after, status: 'success' }, null, 2));
    } finally {
      db.close();
    }
  }
}
