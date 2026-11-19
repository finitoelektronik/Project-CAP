// Memulihkan input operasional Accounting Lite mulai Februari 2026 dari
// database staging SQL Server. Januari lokal tidak disentuh. Berbeda dengan
// import legacy, jurnal dan dokumen stok hasil proses ini berstatus manual
// (input baru) agar dapat diperlakukan sebagai data operasional tahun 2026.
//
// Jalankan tanpa --apply untuk preflight, lalu hentikan server CAP lokal dan
// jalankan dengan --apply setelah hasil preflight disetujui.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT=process.cwd();
const args=process.argv.slice(2);
const option=(name,fallback='')=>{const index=args.indexOf(name);return index>=0?String(args[index+1]||''):fallback;};
const APPLY=args.includes('--apply');
const DATABASE=option('--target',join(ROOT,'data','app.db'));
const SOURCE_DATABASE=option('--source-db','CAP_Accounting_2026_February_Plus_Import');
const SOURCE_SERVER=option('--source-server','.');
const START='2026-02-01',END='2027-01-01';
const SOURCE_NAME='CAP2026/akuntansi2026CAPBJ (2).bak · Februari–terakhir sebagai input baru';
const text=value=>value==null?'':String(value).trim();
const number=value=>Number(value||0);
const sqlDate=value=>String(value||'').slice(0,10);
function accountCode(value){
  const parts=text(value).split('.');
  if(parts.length!==6||parts.some(part=>!/^\d+$/.test(part)))throw new Error(`Kode rekening sumber tidak valid: ${value}`);
  return parts.map((part,index)=>part.padStart([2,2,3,3,3,4][index],'0')).join('.');
}
function sqlRows(query){
  const command=`$ErrorActionPreference='Stop';$cn=New-Object System.Data.SqlClient.SqlConnection 'Server=${SOURCE_SERVER};Integrated Security=SSPI;Initial Catalog=${SOURCE_DATABASE};Connect Timeout=20';$cn.Open();$cmd=$cn.CreateCommand();$cmd.CommandText='${query.replace(/'/g,"''")}';$adapter=New-Object System.Data.SqlClient.SqlDataAdapter $cmd;$table=New-Object System.Data.DataTable;[void]$adapter.Fill($table);$result=foreach($row in $table.Rows){$item=[ordered]@{};foreach($column in $table.Columns){$item[$column.ColumnName]=$row[$column.ColumnName]};[PSCustomObject]$item};$cn.Close();if($null -eq $result){'[]'}else{@($result)|ConvertTo-Json -Compress -Depth 4}`;
  // Windows PowerShell's legacy SQL client can fail to initialize on newer
  // .NET runtimes; PowerShell 7 uses the working runtime on this host.
  const output=execFileSync('pwsh.exe',['-NoProfile','-Command',command],{encoding:'utf8',maxBuffer:256*1024*1024}).trim();
  return output?JSON.parse(output):[];
}
function sourceData(){
  const journals=sqlRows(`SELECT noBukti,uraian,jumlah,CONVERT(char(10),tanggal,23) AS tanggal,userID,jenis FROM dbo.Transaksi WHERE tanggal >= '${START}' AND tanggal < '${END}' ORDER BY tanggal,noBukti`);
  const vouchers=new Set(journals.map(row=>text(row.noBukti)));
  const lines=sqlRows('SELECT noBukti,Keterangan,noRek,debet,kredit,waktu,id FROM dbo.DetailTransaksi ORDER BY id').filter(row=>vouchers.has(text(row.noBukti)));
  const inventory=sqlRows(`SELECT noBukti,BC23,noContainer,CONVERT(char(10),Tanggal,23) AS Tanggal,KodeSupplier,kursTipe,kursValue,beaMasuk,totalAmount,totalPembelian,tipeTransaksi,keterangan FROM dbo.TransaksiBarang WHERE Tanggal >= '${START}' AND Tanggal < '${END}' ORDER BY Tanggal,noBukti`);
  const inventoryVouchers=new Set(inventory.map(row=>text(row.noBukti)));
  const inventoryLines=sqlRows('SELECT id,noBukti,kodeBarang,jumlah,hargaSatuan,total,kursTipe,kursValue FROM dbo.DetailTransaksiBarang ORDER BY id').filter(row=>inventoryVouchers.has(text(row.noBukti)));
  return {
    accounts:sqlRows('SELECT noRek,nama,tingkat,induk,status,keterangan,userID,tanggal,tipe,subtipe,kelompok,lawanRek FROM dbo.Rekening ORDER BY noRek'),
    items:sqlRows('SELECT kode,nama,JenisBarang,KodeDebetPenjualan,KodeKreditPenjualan,KodeDebetPembelian,KodeKreditPembelian,Keterangan FROM dbo.Barang ORDER BY kode'),
    suppliers:sqlRows('SELECT kode,nama,alamat,asal,keterangan FROM dbo.Supplier ORDER BY kode'),
    journals,lines,inventory,inventoryLines
  };
}
function sourceAudit(source){
  const debit=source.lines.reduce((sum,row)=>sum+number(row.debet),0);
  const credit=source.lines.reduce((sum,row)=>sum+number(row.kredit),0);
  if(!source.journals.length)throw new Error(`Sumber ${SOURCE_DATABASE} tidak berisi jurnal mulai ${START}.`);
  if(Math.abs(debit-credit)>0.01)throw new Error(`Jurnal sumber tidak seimbang: debit ${debit}, kredit ${credit}.`);
  const voucherSet=new Set(source.journals.map(row=>text(row.noBukti)));
  for(const row of source.lines)if(!voucherSet.has(text(row.noBukti)))throw new Error(`Detail jurnal tanpa header: ${text(row.noBukti)}.`);
  for(const row of source.inventory)if(!voucherSet.has(text(row.noBukti)))throw new Error(`Transaksi stok tanpa jurnal sumber: ${text(row.noBukti)}.`);
  const inventoryVoucherSet=new Set(source.inventory.map(row=>text(row.noBukti)));
  for(const row of source.inventoryLines)if(!inventoryVoucherSet.has(text(row.noBukti)))throw new Error(`Detail stok tanpa header: ${text(row.noBukti)}.`);
  return {debit,credit};
}
function tableColumns(db,table){return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));}
function scalar(db,sql,...params){return db.prepare(sql).get(...params);}
function targetSummary(db){
  const journals=scalar(db,'SELECT COUNT(*) total, MIN(transaction_date) first_date, MAX(transaction_date) last_date FROM accounting_journal_entries WHERE transaction_date>=? AND transaction_date<?',START,END);
  const lines=scalar(db,'SELECT COUNT(*) total, COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE j.transaction_date>=? AND j.transaction_date<?',START,END);
  const documents=scalar(db,'SELECT COUNT(*) total FROM accounting_inventory_documents WHERE transaction_date>=? AND transaction_date<?',START,END);
  const documentLines=scalar(db,'SELECT COUNT(*) total FROM accounting_inventory_document_lines l JOIN accounting_inventory_documents d ON d.id=l.document_id WHERE d.transaction_date>=? AND d.transaction_date<?',START,END);
  return {journals,lines,documents,document_lines:documentLines};
}
function existingManualDocsBeforeStart(db){return Number(scalar(db,"SELECT COUNT(*) total FROM accounting_inventory_documents WHERE transaction_date<? AND description<>'__LEGACY_FIFO_OPENING__'",START).total||0);}
function legacyOpeningRows(db){
  return db.prepare(`SELECT l.item_code,
    COALESCE(SUM(CASE WHEN h.transaction_type=3 THEN l.quantity ELSE -l.quantity END),0) quantity,
    COALESCE(SUM(CASE WHEN h.transaction_type=3 THEN l.total ELSE -l.total END),0) value
    FROM accounting_legacy_inventory_lines l
    JOIN accounting_legacy_inventory_transactions h ON h.voucher_number=l.voucher_number
    WHERE h.transaction_date<'${START}'
    GROUP BY l.item_code
    HAVING COALESCE(SUM(CASE WHEN h.transaction_type=3 THEN l.quantity ELSE -l.quantity END),0)>0.000001
    ORDER BY l.item_code`).all().map(row=>({...row,quantity:number(row.quantity),value:number(row.value)}));
}
function preflightFifo(db,source){
  const available=new Map(legacyOpeningRows(db).map(row=>[row.item_code,[{date:'1900-01-01',quantity:row.quantity,cost:row.quantity?row.value/row.quantity:0}] ]));
  const linesByVoucher=new Map();
  for(const row of source.inventoryLines){const list=linesByVoucher.get(text(row.noBukti))||[];list.push(row);linesByVoucher.set(text(row.noBukti),list);}
  const short=[];
  for(const header of source.inventory){const purchase=number(header.tipeTransaksi)===3;for(const line of linesByVoucher.get(text(header.noBukti))||[]){const item=text(line.kodeBarang),quantity=number(line.jumlah),layers=available.get(item)||[];if(purchase){layers.push({date:sqlDate(header.Tanggal),quantity,cost:number(line.hargaSatuan)});available.set(item,layers);continue;}let required=quantity;for(const layer of layers.sort((a,b)=>a.date.localeCompare(b.date))){const used=Math.min(required,layer.quantity);layer.quantity-=used;required-=used;if(required<=0.000001)break;}if(required>0.000001)short.push({voucher:text(header.noBukti),date:sqlDate(header.Tanggal),item_code:item,shortage:required,unit_price:number(line.hargaSatuan)});}}
  // Sebagian barang sumber sudah keluar pada Februari, sedangkan kartu stok
  // Januari lokal tidak memuat saldo pembukanya. Catat kekurangan tersebut
  // sebagai batch pembuka sistem (bukan transaksi/jurnal histori) agar
  // dokumen operasi sumber tetap bisa dilacak secara FIFO.
  return short;
}
function copyMasters(db,source){
  const account=db.prepare("INSERT OR IGNORE INTO accounting_accounts (account_code,account_name,level_name,parent_code,account_status,description,account_type,account_subtype,is_group,counter_account_code,legacy_user_id,legacy_date,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'manual')");
  const item=db.prepare("INSERT OR IGNORE INTO accounting_items (item_code,item_name,item_type,debit_sales_code,credit_sales_code,debit_purchase_code,credit_purchase_code,description,source) VALUES (?,?,?,?,?,?,?,?, 'manual')");
  const supplier=db.prepare("INSERT OR IGNORE INTO accounting_suppliers (supplier_code,supplier_name,address,origin,description,source) VALUES (?,?,?,?,?, 'manual')");
  for(const row of source.accounts)account.run(accountCode(row.noRek),text(row.nama),text(row.tingkat),row.induk?accountCode(row.induk):'',text(row.status),text(row.keterangan),text(row.tipe),text(row.subtipe),number(row.kelompok)?1:0,row.lawanRek?accountCode(row.lawanRek):'',text(row.userID),text(row.tanggal));
  for(const row of source.items)item.run(text(row.kode),text(row.nama),text(row.JenisBarang),row.KodeDebetPenjualan?accountCode(row.KodeDebetPenjualan):'',row.KodeKreditPenjualan?accountCode(row.KodeKreditPenjualan):'',row.KodeDebetPembelian?accountCode(row.KodeDebetPembelian):'',row.KodeKreditPembelian?accountCode(row.KodeKreditPembelian):'',text(row.Keterangan));
  for(const row of source.suppliers)supplier.run(text(row.kode),text(row.nama),text(row.alamat),text(row.asal),text(row.keterangan));
}
function deleteTargetRange(db){
  const invoiceIds=db.prepare('SELECT id FROM accounting_invoices WHERE transaction_date>=? AND transaction_date<?').all(START,END).map(row=>row.id);
  if(invoiceIds.length){db.prepare(`DELETE FROM accounting_invoice_lines WHERE invoice_id IN (${invoiceIds.map(()=>'?').join(',')})`).run(...invoiceIds);db.prepare(`DELETE FROM accounting_invoices WHERE id IN (${invoiceIds.map(()=>'?').join(',')})`).run(...invoiceIds);}
  const docIds=db.prepare("SELECT id FROM accounting_inventory_documents WHERE (transaction_date>=? AND transaction_date<?) OR description IN ('__LEGACY_FIFO_OPENING__','__LEGACY_FIFO_SHORTFALL__')").all(START,END).map(row=>row.id);
  if(docIds.length){const lineIds=db.prepare(`SELECT id FROM accounting_inventory_document_lines WHERE document_id IN (${docIds.map(()=>'?').join(',')})`).all(...docIds).map(row=>row.id);if(lineIds.length)db.prepare(`DELETE FROM accounting_inventory_fifo_allocations WHERE issue_line_id IN (${lineIds.map(()=>'?').join(',')})`).run(...lineIds);db.prepare(`DELETE FROM accounting_inventory_document_lines WHERE document_id IN (${docIds.map(()=>'?').join(',')})`).run(...docIds);db.prepare(`DELETE FROM accounting_inventory_documents WHERE id IN (${docIds.map(()=>'?').join(',')})`).run(...docIds);}
  db.exec('DELETE FROM accounting_inventory_fifo_allocations');
  db.exec('DELETE FROM accounting_inventory_fifo_batches');
  const journalIds=db.prepare('SELECT id FROM accounting_journal_entries WHERE transaction_date>=? AND transaction_date<?').all(START,END).map(row=>row.id);
  if(journalIds.length)db.prepare(`DELETE FROM accounting_journal_lines WHERE journal_id IN (${journalIds.map(()=>'?').join(',')})`).run(...journalIds);
  db.prepare('DELETE FROM accounting_journal_entries WHERE transaction_date>=? AND transaction_date<?').run(START,END);
  db.prepare('DELETE FROM accounting_import_audits WHERE source_name=?').run(SOURCE_NAME);
}
function insertJournals(db,source){
  const header=db.prepare("INSERT INTO accounting_journal_entries (voucher_number,transaction_date,description,amount,transaction_type,legacy_user_id,source) VALUES (?,?,?,?,?,?, 'manual')");
  const line=db.prepare('INSERT INTO accounting_journal_lines (journal_id,account_code,description,debit,credit,legacy_line_id,legacy_timestamp) VALUES (?,?,?,?,?,?,?)');
  const ids=new Map();
  for(const row of source.journals){const voucher=`2026/${text(row.noBukti)}`,result=header.run(voucher,sqlDate(row.tanggal),text(row.uraian),number(row.jumlah),text(row.jenis),text(row.userID));ids.set(text(row.noBukti),Number(result.lastInsertRowid));}
  for(const row of source.lines){const journalId=ids.get(text(row.noBukti)),debit=number(row.debet),credit=number(row.kredit);if(!journalId)throw new Error(`Jurnal target tidak ditemukan untuk ${text(row.noBukti)}.`);if(!debit&&!credit)continue;if(debit&&credit)throw new Error(`Detail jurnal memiliki dua sisi: ${text(row.noBukti)}.`);line.run(journalId,accountCode(row.noRek),text(row.Keterangan),debit,credit,null,text(row.waktu));}
  return ids;
}
function insertFifoOpening(db,shortfalls=[]){
  const opening=legacyOpeningRows(db).map(row=>({...row,description:'__LEGACY_FIFO_OPENING__'}));
  for(const row of shortfalls)opening.push({item_code:row.item_code,quantity:number(row.shortage),value:number(row.shortage)*number(row.unit_price),description:'__LEGACY_FIFO_SHORTFALL__'});
  if(!opening.length)return {journalId:null,documents:0,shortfalls:0};
  const journalId=Number(db.prepare("INSERT INTO accounting_journal_entries (voucher_number,transaction_date,description,amount,transaction_type,legacy_user_id,source) VALUES ('SYS-FIFO-20260131','1900-01-01','__LEGACY_FIFO_OPENING__',0,'Saldo FIFO Sistem','system','manual')").run().lastInsertRowid);
  const document=db.prepare("INSERT INTO accounting_inventory_documents (document_number,transaction_date,transaction_kind,supplier_code,payment_mode,counter_account_code,description,reference_number,journal_id,created_by) VALUES (?,?,?,?,?,?,?,?,?, 'system')");
  const line=db.prepare('INSERT INTO accounting_inventory_document_lines (document_id,item_code,quantity,unit_price,total_amount) VALUES (?,?,?,?,?)');
  const batch=db.prepare('INSERT INTO accounting_inventory_fifo_batches (item_code,receipt_line_id,receipt_date,original_quantity,remaining_quantity,unit_cost) VALUES (?,?,?,?,?,?)');
  // Satu jurnal hanya boleh memiliki satu dokumen stok. Seluruh batch
  // pembuka ditempatkan pada dokumen sistem tunggal agar relasi audit valid.
  const doc=Number(document.run('SYS-FIFO-20260131','1900-01-01','adjustment_in','','','','__LEGACY_FIFO_OPENING__','',journalId).lastInsertRowid);
  for(const row of opening){const unit=row.value/row.quantity,lineId=Number(line.run(doc,row.item_code,row.quantity,unit,row.value).lastInsertRowid);batch.run(row.item_code,lineId,'1900-01-01',row.quantity,row.quantity,unit);}
  return {journalId,documents:opening.length,shortfalls:shortfalls.length};
}
function insertOperationalStock(db,source,journalIds){
  const header=db.prepare('INSERT INTO accounting_inventory_documents (document_number,transaction_date,transaction_kind,supplier_code,payment_mode,counter_account_code,description,reference_number,journal_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const line=db.prepare('INSERT INTO accounting_inventory_document_lines (document_id,item_code,quantity,unit_price,total_amount) VALUES (?,?,?,?,?)');
  const byVoucher=new Map();
  for(const row of source.inventory){const voucher=text(row.noBukti),journalId=journalIds.get(voucher);if(!journalId)throw new Error(`Dokumen stok ${voucher} tidak memiliki jurnal target.`);const kind=number(row.tipeTransaksi)===3?'purchase':'sale',documentId=Number(header.run(`2026/${voucher}`,sqlDate(row.Tanggal),kind,text(row.KodeSupplier),'','',text(row.keterangan),'',journalId,'import-2026').lastInsertRowid);byVoucher.set(voucher,{id:documentId,date:sqlDate(row.Tanggal),kind});}
  const result=[];
  for(const row of source.inventoryLines){const headerRow=byVoucher.get(text(row.noBukti));if(!headerRow)throw new Error(`Detail stok tanpa dokumen target: ${text(row.noBukti)}.`);const lineId=Number(line.run(headerRow.id,text(row.kodeBarang),number(row.jumlah),number(row.hargaSatuan),number(row.total)).lastInsertRowid);result.push({lineId,...headerRow,item_code:text(row.kodeBarang),quantity:number(row.jumlah),unit_price:number(row.hargaSatuan)});}
  return result;
}
function buildFifo(db,stockLines){
  const batch=db.prepare('INSERT INTO accounting_inventory_fifo_batches (item_code,receipt_line_id,receipt_date,original_quantity,remaining_quantity,unit_cost) VALUES (?,?,?,?,?,?)');
  const update=db.prepare('UPDATE accounting_inventory_fifo_batches SET remaining_quantity=remaining_quantity-? WHERE id=?');
  const allocation=db.prepare('INSERT INTO accounting_inventory_fifo_allocations (issue_line_id,batch_id,quantity,unit_cost) VALUES (?,?,?,?)');
  for(const row of stockLines.sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id||a.lineId-b.lineId)){
    if(row.kind==='purchase'){batch.run(row.item_code,row.lineId,row.date,row.quantity,row.quantity,row.unit_price);continue;}
    let required=row.quantity;const layers=db.prepare('SELECT id,remaining_quantity,unit_cost FROM accounting_inventory_fifo_batches WHERE item_code=? AND remaining_quantity>0.000001 AND receipt_date<=? ORDER BY receipt_date,id').all(row.item_code,row.date);
    for(const layer of layers){const used=Math.min(required,number(layer.remaining_quantity));if(used<=0.000001)continue;update.run(used,layer.id);allocation.run(row.lineId,layer.id,used,number(layer.unit_cost));required-=used;if(required<=0.000001)break;}
    if(required>0.000001)throw new Error(`Stok ${row.item_code} tidak cukup saat membangun FIFO ${row.date}.`);
  }
}
function verify(db,source,expected){
  const actual=targetSummary(db),lines=actual.lines;
  if(number(actual.journals.total)!==source.journals.length||number(lines.total)!==source.lines.filter(row=>number(row.debet)||number(row.kredit)).length)throw new Error('Jumlah jurnal atau detail hasil impor tidak sesuai sumber.');
  if(Math.abs(number(lines.debit)-expected.debit)>0.01||Math.abs(number(lines.credit)-expected.credit)>0.01)throw new Error('Nominal debit/kredit hasil impor tidak sesuai sumber.');
  if(number(actual.documents.total)!==source.inventory.length||number(actual.document_lines.total)!==source.inventoryLines.length)throw new Error('Jumlah dokumen atau detail stok hasil impor tidak sesuai sumber.');
  const nonManual=scalar(db,"SELECT COUNT(*) total FROM accounting_journal_entries WHERE transaction_date>=? AND transaction_date<? AND source<>'manual'",START,END);
  if(number(nonManual.total)!==0)throw new Error('Sebagian jurnal hasil impor tidak berstatus input baru.');
  const fk=db.prepare('PRAGMA foreign_key_check').all();if(fk.length)throw new Error(`Foreign key check gagal (${fk.length} baris).`);
  const integrity=db.prepare('PRAGMA integrity_check').all().map(row=>Object.values(row)[0]);if(!integrity.every(value=>String(value).toLowerCase()==='ok'))throw new Error('Integritas SQLite gagal.');
  return actual;
}

if(!existsSync(DATABASE))throw new Error(`Database lokal tidak ditemukan: ${DATABASE}`);
const source=sourceData(),expected=sourceAudit(source),db=new DatabaseSync(DATABASE);
try{
  const before=targetSummary(db),manualBeforeStart=existingManualDocsBeforeStart(db);if(manualBeforeStart)throw new Error(`Ditemukan ${manualBeforeStart} dokumen stok operasional sebelum Februari. Pemulihan dibatalkan agar Januari tidak berubah.`);
  const shortfalls=preflightFifo(db,source);
  if(!APPLY){console.log(JSON.stringify({ok:true,mode:'plan',source_database:SOURCE_DATABASE,range:{start:START,end_exclusive:END},classification:'input baru (manual), bukan histori',source:{journals:source.journals.length,journal_lines:source.lines.filter(row=>number(row.debet)||number(row.kredit)).length,debit:expected.debit,credit:expected.credit,stock_documents:source.inventory.length,stock_lines:source.inventoryLines.length,first_date:sqlDate(source.journals[0].tanggal),last_date:sqlDate(source.journals.at(-1).tanggal)},fifo_shortfalls:{count:shortfalls.length,examples:shortfalls.slice(0,5)},will_replace:before,next:'Tutup server CAP lokal lalu jalankan ulang dengan --apply.'},null,2));process.exit(0);}
  const recovery=join(ROOT,'data','recovery','accounting');mkdirSync(recovery,{recursive:true});const backup=join(recovery,`app-before-import-2026-february-onward-${new Date().toISOString().replace(/[:.]/g,'-')}.db`);copyFileSync(DATABASE,backup);
  db.exec('PRAGMA foreign_keys=OFF');db.exec('BEGIN IMMEDIATE');
  try{copyMasters(db,source);deleteTargetRange(db);const journalIds=insertJournals(db,source);const opening=insertFifoOpening(db,shortfalls);const stockLines=insertOperationalStock(db,source,journalIds);buildFifo(db,stockLines);const result=verify(db,source,expected);db.prepare('INSERT INTO accounting_import_audits (source_name,account_count,journal_count,journal_line_count,total_debit,total_credit,notes) VALUES (?,?,?,?,?,?,?)').run(SOURCE_NAME,source.accounts.length,source.journals.length,source.lines.filter(row=>number(row.debet)||number(row.kredit)).length,expected.debit,expected.credit,`Pemulihan ${START} s.d. ${sqlDate(source.journals.at(-1).tanggal)} dari staging ${SOURCE_DATABASE}; jurnal dan stok menjadi input baru 2026, Januari lokal dipertahankan. ${shortfalls.length} kekurangan stok sumber diberi batch pembuka sistem.`);db.exec('COMMIT');console.log(JSON.stringify({ok:true,backup,source_database:SOURCE_DATABASE,range:{start:START,last_date:sqlDate(source.journals.at(-1).tanggal)},classification:'input baru (manual), bukan histori',fifo_opening:opening,result},null,2));}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{try{db.exec('PRAGMA foreign_keys=ON')}catch{}}
}finally{db.close();}
