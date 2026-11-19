// Mengganti data operasional Accounting tahun 2026 di database lokal dari
// snapshot database server utama. Rekening dan pemetaan laporan lokal sengaja
// dipertahankan. Jalankan saat server CAP lokal berhenti.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT=process.cwd();
const args=process.argv.slice(2);
const option=(name,fallback='')=>{const index=args.indexOf(name);return index>=0?String(args[index+1]||''):fallback;};
const SOURCE=resolve(option('--source',join(ROOT,'work','diagnostic-10','app.db')));
const TARGET=resolve(option('--target',join(ROOT,'data','app.db')));
const APPLY=args.includes('--apply');
const YEAR='2026';
if(!existsSync(SOURCE))throw new Error(`Database sumber server utama tidak ditemukan: ${SOURCE}`);
if(!existsSync(TARGET))throw new Error(`Database lokal tidak ditemukan: ${TARGET}`);
if(SOURCE.toLowerCase()===TARGET.toLowerCase())throw new Error('Database sumber dan target tidak boleh sama.');

const source=new DatabaseSync(SOURCE,{readOnly:true});
const target=new DatabaseSync(TARGET);
const scalar=(database,sql,...params)=>database.prepare(sql).get(...params);
const count=(database,table,where='1=1',params=[])=>Number(scalar(database,`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`,...params)?.total||0);
const integrity=database=>database.prepare('PRAGMA integrity_check').all().map(row=>Object.values(row)[0]).every(value=>String(value).toLowerCase()==='ok');
const hasTable=(database,name)=>Boolean(scalar(database,"SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?",name)?.present);
const columns=(database,table)=>database.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name);
const required=['accounting_accounts','accounting_journal_entries','accounting_journal_lines','accounting_legacy_inventory_transactions','accounting_legacy_inventory_lines'];
for(const table of required)if(!hasTable(source,table)||!hasTable(target,table))throw new Error(`Tabel wajib ${table} tidak tersedia di sumber atau target.`);
if(!integrity(source)||!integrity(target))throw new Error('Pemeriksaan integritas SQLite gagal; penggantian dibatalkan.');

const entries=(database)=>database.prepare("SELECT * FROM accounting_journal_entries WHERE substr(transaction_date,1,4)=? ORDER BY transaction_date,id").all(YEAR);
const sourceEntries=entries(source);
if(!sourceEntries.length)throw new Error('Sumber server utama tidak memuat jurnal tahun 2026.');
const sourceEntryIds=new Set(sourceEntries.map(row=>Number(row.id)));
const sourceLines=source.prepare(`SELECT * FROM accounting_journal_lines WHERE journal_id IN (${sourceEntries.map(()=>'?').join(',')}) ORDER BY id`).all(...sourceEntries.map(row=>row.id));
const debit=sourceLines.reduce((sum,row)=>sum+Number(row.debit||0),0),credit=sourceLines.reduce((sum,row)=>sum+Number(row.credit||0),0);
if(Math.abs(debit-credit)>0.01)throw new Error(`Sumber 2026 tidak seimbang: debit ${debit}, kredit ${credit}.`);

const sourceInventory=source.prepare("SELECT * FROM accounting_legacy_inventory_transactions WHERE substr(transaction_date,1,4)=? ORDER BY voucher_number").all(YEAR);
const sourceVouchers=sourceInventory.map(row=>String(row.voucher_number));
const sourceInventoryLines=sourceVouchers.length?source.prepare(`SELECT * FROM accounting_legacy_inventory_lines WHERE voucher_number IN (${sourceVouchers.map(()=>'?').join(',')}) ORDER BY id`).all(...sourceVouchers):[];

if(!APPLY){
  const targetEntries=entries(target),targetEntryIds=targetEntries.map(row=>row.id),targetLines=targetEntryIds.length?target.prepare(`SELECT COUNT(*) AS total FROM accounting_journal_lines WHERE journal_id IN (${targetEntryIds.map(()=>'?').join(',')})`).get(...targetEntryIds).total:0;
  const targetInventory=count(target,'accounting_legacy_inventory_transactions',"substr(transaction_date,1,4)=?",[YEAR]);
  console.log(JSON.stringify({ok:true,mode:'plan',source:SOURCE,target:TARGET,year:YEAR,will_replace:{local_journals:targetEntries.length,local_journal_lines:Number(targetLines),local_inventory_transactions:targetInventory},source_2026:{journals:sourceEntries.length,journal_lines:sourceLines.length,debit,credit,inventory_transactions:sourceInventory.length,inventory_lines:sourceInventoryLines.length},next:'Tutup server CAP lokal, lalu jalankan ulang dengan --apply.'},null,2));
  source.close();target.close();process.exit(0);
}

const backupDir=join(ROOT,'data','recovery','accounting');
mkdirSync(backupDir,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backup=join(backupDir,`app-before-replace-2026-from-main-${stamp}.db`);
copyFileSync(TARGET,backup);

function copyAccounts(){
  const rows=source.prepare('SELECT * FROM accounting_accounts ORDER BY account_code').all();
  const targetColumns=new Set(columns(target,'accounting_accounts'));
  const insertColumns=columns(source,'accounting_accounts').filter(column=>targetColumns.has(column));
  const insert=target.prepare(`INSERT OR IGNORE INTO accounting_accounts (${insertColumns.join(',')}) VALUES (${insertColumns.map(()=>'?').join(',')})`);
  for(const row of rows)insert.run(...insertColumns.map(column=>row[column]));
  return rows.length;
}
function copyLegacyItems(){
  for(const table of ['accounting_legacy_items','accounting_legacy_suppliers','accounting_items','accounting_suppliers']){
    if(!hasTable(source,table)||!hasTable(target,table))continue;
    const targetColumns=new Set(columns(target,table));
    const shared=columns(source,table).filter(column=>targetColumns.has(column));
    if(!shared.length)continue;
    const insert=target.prepare(`INSERT OR IGNORE INTO ${table} (${shared.join(',')}) VALUES (${shared.map(()=>'?').join(',')})`);
    for(const row of source.prepare(`SELECT ${shared.join(',')} FROM ${table}`).all())insert.run(...shared.map(column=>row[column]));
  }
}
function copyJournalRows(){
  const entryColumns=columns(source,'accounting_journal_entries').filter(column=>column!=='id'&&columns(target,'accounting_journal_entries').includes(column));
  const lineColumns=columns(source,'accounting_journal_lines').filter(column=>!['id','journal_id','legacy_line_id'].includes(column)&&columns(target,'accounting_journal_lines').includes(column));
  const insertEntry=target.prepare(`INSERT INTO accounting_journal_entries (${entryColumns.join(',')}) VALUES (${entryColumns.map(()=>'?').join(',')})`);
  const insertLine=target.prepare(`INSERT INTO accounting_journal_lines (journal_id,${lineColumns.join(',')}) VALUES (?,${lineColumns.map(()=>'?').join(',')})`);
  const sourceToTarget=new Map();
  for(const row of sourceEntries){
    const result=insertEntry.run(...entryColumns.map(column=>row[column]));
    sourceToTarget.set(Number(row.id),Number(result.lastInsertRowid));
  }
  for(const row of sourceLines){
    const journalId=sourceToTarget.get(Number(row.journal_id));
    if(!journalId)throw new Error(`Baris jurnal sumber tanpa header: ${row.id}`);
    insertLine.run(journalId,...lineColumns.map(column=>row[column]));
  }
}
function copyLegacyInventory(){
  const transactionColumns=columns(source,'accounting_legacy_inventory_transactions').filter(column=>columns(target,'accounting_legacy_inventory_transactions').includes(column));
  const lineColumns=columns(source,'accounting_legacy_inventory_lines').filter(column=>column!=='id'&&columns(target,'accounting_legacy_inventory_lines').includes(column));
  const insertTransaction=target.prepare(`INSERT INTO accounting_legacy_inventory_transactions (${transactionColumns.join(',')}) VALUES (${transactionColumns.map(()=>'?').join(',')})`);
  const insertLine=target.prepare(`INSERT INTO accounting_legacy_inventory_lines (${lineColumns.join(',')}) VALUES (${lineColumns.map(()=>'?').join(',')})`);
  for(const row of sourceInventory)insertTransaction.run(...transactionColumns.map(column=>row[column]));
  for(const row of sourceInventoryLines)insertLine.run(...lineColumns.map(column=>row[column]));
}
function deleteTarget2026(){
  const targetEntries=entries(target),ids=targetEntries.map(row=>row.id);
  if(ids.length)target.prepare(`DELETE FROM accounting_journal_lines WHERE journal_id IN (${ids.map(()=>'?').join(',')})`).run(...ids);
  target.prepare("DELETE FROM accounting_journal_entries WHERE substr(transaction_date,1,4)=?").run(YEAR);
  const targetInventory=target.prepare("SELECT voucher_number FROM accounting_legacy_inventory_transactions WHERE substr(transaction_date,1,4)=?").all(YEAR).map(row=>row.voucher_number);
  if(targetInventory.length)target.prepare(`DELETE FROM accounting_legacy_inventory_lines WHERE voucher_number IN (${targetInventory.map(()=>'?').join(',')})`).run(...targetInventory);
  target.prepare("DELETE FROM accounting_legacy_inventory_transactions WHERE substr(transaction_date,1,4)=?").run(YEAR);
  // Invoice draft tidak ditransfer; jika tabel tersedia, bersihkan invoice 2026
  // lokal beserta detailnya agar data 2026 benar-benar berasal dari server utama.
  if(hasTable(target,'accounting_invoices')){
    const invoices=target.prepare("SELECT id FROM accounting_invoices WHERE substr(transaction_date,1,4)=?").all(YEAR).map(row=>row.id);
    if(invoices.length&&hasTable(target,'accounting_invoice_lines'))target.prepare(`DELETE FROM accounting_invoice_lines WHERE invoice_id IN (${invoices.map(()=>'?').join(',')})`).run(...invoices);
    target.prepare("DELETE FROM accounting_invoices WHERE substr(transaction_date,1,4)=?").run(YEAR);
  }
}
function copyPostedInvoices(){
  if(!hasTable(source,'accounting_invoices')||!hasTable(target,'accounting_invoices'))return;
  const sourceInvoices=source.prepare("SELECT * FROM accounting_invoices WHERE substr(transaction_date,1,4)=? AND lower(status)<>'draft' ORDER BY id").all(YEAR);
  if(!sourceInvoices.length)return;
  const entryColumns=columns(source,'accounting_invoices').filter(column=>column!=='id'&&columns(target,'accounting_invoices').includes(column));
  const insertInvoice=target.prepare(`INSERT INTO accounting_invoices (${entryColumns.join(',')}) VALUES (${entryColumns.map(()=>'?').join(',')})`);
  const invoiceIds=new Map();
  for(const row of sourceInvoices)invoiceIds.set(Number(row.id),Number(insertInvoice.run(...entryColumns.map(column=>row[column])).lastInsertRowid));
  if(!hasTable(source,'accounting_invoice_lines')||!hasTable(target,'accounting_invoice_lines'))return;
  const lineColumns=columns(source,'accounting_invoice_lines').filter(column=>!['id','invoice_id'].includes(column)&&columns(target,'accounting_invoice_lines').includes(column));
  const insertLine=target.prepare(`INSERT INTO accounting_invoice_lines (invoice_id,${lineColumns.join(',')}) VALUES (?,${lineColumns.map(()=>'?').join(',')})`);
  for(const row of source.prepare(`SELECT * FROM accounting_invoice_lines WHERE invoice_id IN (${sourceInvoices.map(()=>'?').join(',')}) ORDER BY id`).all(...sourceInvoices.map(row=>row.id))){const targetInvoice=invoiceIds.get(Number(row.invoice_id));if(targetInvoice)insertLine.run(targetInvoice,...lineColumns.map(column=>row[column]));}
}
function audit(){
  const actualEntries=entries(target),actualIds=actualEntries.map(row=>row.id),actualLines=actualIds.length?target.prepare(`SELECT debit,credit FROM accounting_journal_lines WHERE journal_id IN (${actualIds.map(()=>'?').join(',')})`).all(...actualIds):[];
  const actualDebit=actualLines.reduce((sum,row)=>sum+Number(row.debit||0),0),actualCredit=actualLines.reduce((sum,row)=>sum+Number(row.credit||0),0);
  if(actualEntries.length!==sourceEntries.length||actualLines.length!==sourceLines.length||Math.abs(actualDebit-debit)>0.01||Math.abs(actualCredit-credit)>0.01)throw new Error('Rekonsiliasi jurnal 2026 gagal; transaksi dibatalkan.');
  if(count(target,'accounting_legacy_inventory_transactions',"substr(transaction_date,1,4)=?",[YEAR])!==sourceInventory.length)throw new Error('Rekonsiliasi transaksi stok 2026 gagal; transaksi dibatalkan.');
  if(count(target,'accounting_legacy_inventory_lines',`voucher_number IN (${sourceVouchers.length?sourceVouchers.map(()=>'?').join(','):"''"})`,sourceVouchers)!==sourceInventoryLines.length)throw new Error('Rekonsiliasi detail stok 2026 gagal; transaksi dibatalkan.');
  const foreignKeyErrors=target.prepare('PRAGMA foreign_key_check').all();
  if(foreignKeyErrors.length)throw new Error(`Referensi data tidak valid (${foreignKeyErrors.length} baris).`);
  return {journals:actualEntries.length,journal_lines:actualLines.length,debit:actualDebit,credit:actualCredit,inventory_transactions:sourceInventory.length,inventory_lines:sourceInventoryLines.length};
}

try {
  target.exec('PRAGMA foreign_keys=OFF');
  target.exec('BEGIN IMMEDIATE');
  try {
    copyAccounts();
    copyLegacyItems();
    deleteTarget2026();
    copyJournalRows();
    copyLegacyInventory();
    copyPostedInvoices();
    const result=audit();
    target.exec('COMMIT');
    console.log(JSON.stringify({ok:true,source:SOURCE,target:TARGET,backup,year:YEAR,result},null,2));
  } catch(error) { try{target.exec('ROLLBACK');}catch{} throw error; }
} finally { try{target.exec('PRAGMA foreign_keys=ON');}catch{} source.close(); target.close(); }
