// Mengosongkan data operasional Accounting tahun 2026 dari database lokal.
// Master rekening, barang, pelanggan, serta pemetaan laporan sengaja tidak diubah.
// Jalankan ketika server CAP lokal tidak aktif.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT=process.cwd(),YEAR='2026',args=process.argv.slice(2),APPLY=args.includes('--apply');
const targetArg=args.indexOf('--target'),TARGET=resolve(targetArg>=0?String(args[targetArg+1]||''):join(ROOT,'data','app.db'));
if(!existsSync(TARGET))throw new Error(`Database lokal tidak ditemukan: ${TARGET}`);
const db=new DatabaseSync(TARGET);
const table=name=>Boolean(db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?").get(name)?.present);
const ids=(sql,...params)=>db.prepare(sql).all(...params).map(row=>Number(row.id));
const count=(name,where='1=1',params=[])=>table(name)?Number(db.prepare(`SELECT count(*) AS total FROM ${name} WHERE ${where}`).get(...params).total):0;
const placeholders=values=>values.map(()=>'?').join(',');
const report=()=>{
  const journalIds=ids("SELECT id FROM accounting_journal_entries WHERE substr(transaction_date,1,4)=?",YEAR);
  const docIds=table('accounting_inventory_documents')?ids("SELECT id FROM accounting_inventory_documents WHERE substr(transaction_date,1,4)=?",YEAR):[];
  const invoiceIds=table('accounting_invoices')?ids("SELECT id FROM accounting_invoices WHERE substr(transaction_date,1,4)=?",YEAR):[];
  const lineIds=docIds.length&&table('accounting_inventory_document_lines')?ids(`SELECT id FROM accounting_inventory_document_lines WHERE document_id IN (${placeholders(docIds)})`,...docIds):[];
  return {
    journals:journalIds.length,
    journal_lines:journalIds.length?count('accounting_journal_lines',`journal_id IN (${placeholders(journalIds)})`,journalIds):0,
    legacy_inventory_transactions:count('accounting_legacy_inventory_transactions',"substr(transaction_date,1,4)=?",[YEAR]),
    legacy_inventory_lines:table('accounting_legacy_inventory_lines')?count('accounting_legacy_inventory_lines',"voucher_number IN (SELECT voucher_number FROM accounting_legacy_inventory_transactions WHERE substr(transaction_date,1,4)=?)",[YEAR]):0,
    inventory_documents:docIds.length,
    inventory_document_lines:lineIds.length,
    invoices:invoiceIds.length,
    invoice_lines:invoiceIds.length&&table('accounting_invoice_lines')?count('accounting_invoice_lines',`invoice_id IN (${placeholders(invoiceIds)})`,invoiceIds):0
  };
};
const before=report();
if(!APPLY){console.log(JSON.stringify({ok:true,mode:'plan',year:YEAR,target:TARGET,will_delete:before,next:'Jalankan dengan --apply setelah server CAP lokal dihentikan.'},null,2));db.close();process.exit(0);}
const integrity=db.prepare('PRAGMA integrity_check').all().map(row=>Object.values(row)[0]);
if(integrity.some(value=>String(value).toLowerCase()!=='ok'))throw new Error('Integritas database lokal gagal; penghapusan dibatalkan.');
const backupDir=join(ROOT,'data','recovery','accounting');mkdirSync(backupDir,{recursive:true});
const backup=join(backupDir,`app-before-clear-accounting-${YEAR}-${new Date().toISOString().replace(/[:.]/g,'-')}.db`);copyFileSync(TARGET,backup);
try{
  db.exec('PRAGMA foreign_keys=OFF');db.exec('BEGIN IMMEDIATE');
  try{
    const journalIds=ids("SELECT id FROM accounting_journal_entries WHERE substr(transaction_date,1,4)=?",YEAR);
    const documentIds=table('accounting_inventory_documents')?ids("SELECT id FROM accounting_inventory_documents WHERE substr(transaction_date,1,4)=?",YEAR):[];
    const invoiceIds=table('accounting_invoices')?ids("SELECT id FROM accounting_invoices WHERE substr(transaction_date,1,4)=?",YEAR):[];
    const lineIds=documentIds.length&&table('accounting_inventory_document_lines')?ids(`SELECT id FROM accounting_inventory_document_lines WHERE document_id IN (${placeholders(documentIds)})`,...documentIds):[];
    if(documentIds.length&&table('accounting_invoices'))db.prepare(`UPDATE accounting_invoices SET inventory_document_id=NULL WHERE inventory_document_id IN (${placeholders(documentIds)})`).run(...documentIds);
    if(invoiceIds.length&&table('accounting_inventory_documents'))db.prepare(`UPDATE accounting_inventory_documents SET invoice_id=NULL WHERE invoice_id IN (${placeholders(invoiceIds)})`).run(...invoiceIds);
    if(lineIds.length&&table('accounting_inventory_fifo_allocations')){
      const batchIds=table('accounting_inventory_fifo_batches')?ids(`SELECT id FROM accounting_inventory_fifo_batches WHERE receipt_line_id IN (${placeholders(lineIds)})`,...lineIds):[];
      const clauses=[`issue_line_id IN (${placeholders(lineIds)})`],params=[...lineIds];
      if(batchIds.length){clauses.push(`batch_id IN (${placeholders(batchIds)})`);params.push(...batchIds);}
      db.prepare(`DELETE FROM accounting_inventory_fifo_allocations WHERE ${clauses.join(' OR ')}`).run(...params);
      if(batchIds.length)db.prepare(`DELETE FROM accounting_inventory_fifo_batches WHERE id IN (${placeholders(batchIds)})`).run(...batchIds);
    }
    if(lineIds.length&&table('accounting_inventory_document_lines'))db.prepare(`DELETE FROM accounting_inventory_document_lines WHERE id IN (${placeholders(lineIds)})`).run(...lineIds);
    if(documentIds.length&&table('accounting_inventory_documents'))db.prepare(`DELETE FROM accounting_inventory_documents WHERE id IN (${placeholders(documentIds)})`).run(...documentIds);
    if(invoiceIds.length&&table('accounting_invoice_lines'))db.prepare(`DELETE FROM accounting_invoice_lines WHERE invoice_id IN (${placeholders(invoiceIds)})`).run(...invoiceIds);
    if(invoiceIds.length&&table('accounting_invoices'))db.prepare(`DELETE FROM accounting_invoices WHERE id IN (${placeholders(invoiceIds)})`).run(...invoiceIds);
    if(journalIds.length)db.prepare(`DELETE FROM accounting_journal_lines WHERE journal_id IN (${placeholders(journalIds)})`).run(...journalIds);
    db.prepare("DELETE FROM accounting_journal_entries WHERE substr(transaction_date,1,4)=?").run(YEAR);
    const inventoryVouchers=table('accounting_legacy_inventory_transactions')?db.prepare("SELECT voucher_number FROM accounting_legacy_inventory_transactions WHERE substr(transaction_date,1,4)=?").all(YEAR).map(row=>row.voucher_number):[];
    if(inventoryVouchers.length&&table('accounting_legacy_inventory_lines'))db.prepare(`DELETE FROM accounting_legacy_inventory_lines WHERE voucher_number IN (${placeholders(inventoryVouchers)})`).run(...inventoryVouchers);
    if(table('accounting_legacy_inventory_transactions'))db.prepare("DELETE FROM accounting_legacy_inventory_transactions WHERE substr(transaction_date,1,4)=?").run(YEAR);
    if(table('accounting_journal_archives'))db.prepare("DELETE FROM accounting_journal_archives WHERE substr(json_extract(journal_json,'$.transaction_date'),1,4)=?").run(YEAR);
    const after=report();
    if(Object.values(after).some(value=>value!==0))throw new Error(`Masih ada data Accounting ${YEAR} setelah penghapusan: ${JSON.stringify(after)}`);
    const foreignKeys=db.prepare('PRAGMA foreign_key_check').all();if(foreignKeys.length)throw new Error(`Referensi data tidak valid (${foreignKeys.length} baris).`);
    db.exec('COMMIT');console.log(JSON.stringify({ok:true,year:YEAR,target:TARGET,backup,deleted:before,remaining:after},null,2));
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}finally{try{db.exec('PRAGMA foreign_keys=ON');}catch{}db.close();}
