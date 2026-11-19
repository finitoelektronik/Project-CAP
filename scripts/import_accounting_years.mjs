import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT=process.cwd(), DATABASE=join(ROOT,'data','app.db');
const availableSources=[{year:'2021',database:'CAP_Accounting_2021_Staging'},{year:'2022',database:'CAP_Accounting_2022_Staging'},{year:'2023',database:'CAP_Accounting_2023_Import'},{year:'2024',database:'CAP_Accounting_2024_Import'}];
const selectedYears=process.argv.slice(2).flatMap(value=>value.replace(/^--years=/,'').split(',')).map(value=>value.trim()).filter(Boolean);
const sources=selectedYears.length?availableSources.filter(source=>selectedYears.includes(source.year)):availableSources;
if(!sources.length)throw new Error('Tidak ada tahun sumber yang cocok untuk diimpor.');
const text=value=>value==null?'':String(value).trim();
const number=value=>Number(value||0);
function normalizedDate(value){const source=String(value||''),match=source.match(/\/Date\((-?\d+)([+-]\d{4})?\)\//);if(match){let epoch=Number(match[1]);if(match[2]){const sign=match[2][0]==='-'?-1:1,offset=Number(match[2].slice(1,3))*60+Number(match[2].slice(3,5));epoch+=sign*offset*60*1000;}return new Date(epoch).toISOString();}return source;}
const sqlDate=value=>{const source=normalizedDate(value);return source?source.slice(0,10):'';};
const sqlStamp=value=>{const source=normalizedDate(value);return source?source.replace('T',' ').slice(0,23):'';};

function rows(database,query){
  const command=`$ErrorActionPreference='Stop';$cn=New-Object System.Data.SqlClient.SqlConnection 'Server=(local);Integrated Security=SSPI;Initial Catalog=${database};Connect Timeout=15';$cn.Open();$cmd=$cn.CreateCommand();$cmd.CommandText='${query.replace(/'/g,"''")}';$adapter=New-Object System.Data.SqlClient.SqlDataAdapter $cmd;$table=New-Object System.Data.DataTable;[void]$adapter.Fill($table);$result=foreach($row in $table.Rows){$item=[ordered]@{};foreach($column in $table.Columns){$item[$column.ColumnName]=$row[$column.ColumnName]};[PSCustomObject]$item};$cn.Close();if($null -eq $result){'[]'}else{@($result)|ConvertTo-Json -Compress -Depth 4}`;
  const output=execFileSync('powershell.exe',['-NoProfile','-Command',command],{encoding:'utf8',maxBuffer:128*1024*1024}).trim();
  return output?JSON.parse(output):[];
}

function sourceData(source){
  const database=source.database;
  return {
    accounts:rows(database,'SELECT noRek,nama,tingkat,induk,status,keterangan,userID,tanggal,tipe,subtipe,kelompok,lawanRek FROM dbo.Rekening ORDER BY noRek'),
    journals:rows(database,'SELECT noBukti,uraian,jumlah,tanggal,userID,jenis FROM dbo.Transaksi ORDER BY tanggal,noBukti'),
    lines:rows(database,'SELECT noBukti,Keterangan,noRek,debet,kredit,waktu,id FROM dbo.DetailTransaksi ORDER BY id'),
    items:rows(database,'SELECT kode,nama,JenisBarang,KodeDebetPenjualan,KodeKreditPenjualan,KodeDebetPembelian,KodeKreditPembelian,Keterangan FROM dbo.Barang ORDER BY kode'),
    suppliers:rows(database,'SELECT kode,nama,alamat,asal,keterangan FROM dbo.Supplier ORDER BY kode'),
    inventory:rows(database,'SELECT noBukti,BC23,noContainer,Tanggal,KodeSupplier,kursTipe,kursValue,beaMasuk,totalAmount,totalPembelian,tipeTransaksi,keterangan FROM dbo.TransaksiBarang ORDER BY noBukti'),
    inventoryLines:rows(database,'SELECT id,noBukti,kodeBarang,jumlah,hargaSatuan,total,kursTipe,kursValue FROM dbo.DetailTransaksiBarang ORDER BY id')
  };
}

function repairImportedYear(db,source,data,auditName){const voucher=value=>`${source.year}/${text(value)}`,firstDay=`${source.year}-01-01`,nextYear=`${Number(source.year)+1}-01-01`;db.exec('BEGIN IMMEDIATE');try{const updateJournal=db.prepare('UPDATE accounting_journal_entries SET transaction_date=?,description=?,amount=?,transaction_type=?,legacy_user_id=? WHERE voucher_number=?');for(const row of data.journals)updateJournal.run(sqlDate(row.tanggal),text(row.uraian),number(row.jumlah),text(row.jenis),text(row.userID),voucher(row.noBukti));const updateInventory=db.prepare('UPDATE accounting_legacy_inventory_transactions SET transaction_date=? WHERE voucher_number=?');for(const row of data.inventory)updateInventory.run(sqlDate(row.Tanggal),voucher(row.noBukti));db.prepare('UPDATE accounting_journal_entries SET transaction_date=? WHERE voucher_number LIKE ? AND (transaction_date<? OR transaction_date>=?)').run(firstDay,`${source.year}/%`,firstDay,nextYear);db.prepare('UPDATE accounting_legacy_inventory_transactions SET transaction_date=? WHERE voucher_number LIKE ? AND (transaction_date<? OR transaction_date>=?)').run(firstDay,`${source.year}/%`,firstDay,nextYear);const totals=db.prepare("SELECT COALESCE(SUM(debit),0) debit,COALESCE(SUM(credit),0) credit FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE j.voucher_number LIKE ?").get(`${source.year}/%`);const validLines=data.lines.filter(row=>number(row.debet)!==0||number(row.kredit)!==0).length;db.prepare('UPDATE accounting_import_audits SET journal_line_count=?,total_debit=?,total_credit=?,notes=? WHERE source_name=?').run(validLines,number(totals.debit),number(totals.credit),`Impor CAP ${source.year}; nomor bukti diprefiks ${source.year}/ untuk menghindari bentrok lintas tahun. Tanggal dinormalisasi dari sumber SQL Server.`,auditName);db.exec('COMMIT');return {year:source.year,repaired:true,journals:data.journals.length,lines:validLines,debit:number(totals.debit),credit:number(totals.credit)};}catch(error){try{db.exec('ROLLBACK')}catch{}throw error;}}
function importYear(db,source,data){
  const auditName=`CAP${source.year}/akuntansi.mdf`;
  if(db.prepare('SELECT 1 FROM accounting_import_audits WHERE source_name=?').get(auditName))return repairImportedYear(db,source,data,auditName);
  const voucher=value=>`${source.year}/${text(value)}`;
  const account=db.prepare('INSERT OR IGNORE INTO accounting_accounts (account_code,account_name,level_name,parent_code,account_status,description,account_type,account_subtype,is_group,counter_account_code,legacy_user_id,legacy_date,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,\'legacy\')');
  const journal=db.prepare('INSERT OR IGNORE INTO accounting_journal_entries (voucher_number,transaction_date,description,amount,transaction_type,legacy_user_id,source) VALUES (?,?,?,?,?,?,\'legacy\')');
  const line=db.prepare('INSERT INTO accounting_journal_lines (journal_id,account_code,description,debit,credit,legacy_line_id,legacy_timestamp) VALUES (?,?,?,?,?,?,?)');
  const item=db.prepare('INSERT OR IGNORE INTO accounting_legacy_items (item_code,item_name,item_type,debit_sales_code,credit_sales_code,debit_purchase_code,credit_purchase_code,description) VALUES (?,?,?,?,?,?,?,?)');
  const supplier=db.prepare('INSERT OR IGNORE INTO accounting_legacy_suppliers (supplier_code,supplier_name,address,origin,description) VALUES (?,?,?,?,?)');
  const inventory=db.prepare('INSERT OR IGNORE INTO accounting_legacy_inventory_transactions (voucher_number,bc23,container_number,transaction_date,supplier_code,exchange_type,exchange_value,import_duty,total_amount,total_purchase,transaction_type,description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const inventoryLine=db.prepare('INSERT INTO accounting_legacy_inventory_lines (legacy_line_id,voucher_number,item_code,quantity,unit_price,total,exchange_type,exchange_value) VALUES (?,?,?,?,?,?,?,?)');
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const row of data.accounts)account.run(text(row.noRek),text(row.nama),text(row.tingkat),text(row.induk),text(row.status),text(row.keterangan),text(row.tipe),text(row.subtipe),Number(row.kelompok)?1:0,text(row.lawanRek),text(row.userID),sqlStamp(row.tanggal));
    const journalIds=new Map();
    for(const row of data.journals){const code=voucher(row.noBukti);journal.run(code,sqlDate(row.tanggal),text(row.uraian),number(row.jumlah),text(row.jenis),text(row.userID));const saved=db.prepare('SELECT id FROM accounting_journal_entries WHERE voucher_number=?').get(code);journalIds.set(text(row.noBukti),saved.id);}
    for(const row of data.lines){const debit=number(row.debet),credit=number(row.kredit);if(debit===0&&credit===0)continue;if(debit>0&&credit>0)throw new Error(`Detail jurnal memiliki debit dan kredit sekaligus: ${text(row.noBukti)} pada ${source.year}.`);const journalId=journalIds.get(text(row.noBukti));if(!journalId)throw new Error(`Detail jurnal tanpa header ${text(row.noBukti)} pada ${source.year}.`);line.run(journalId,text(row.noRek),text(row.Keterangan),debit,credit,null,sqlStamp(row.waktu));}
    for(const row of data.items)item.run(text(row.kode),text(row.nama),text(row.JenisBarang),text(row.KodeDebetPenjualan),text(row.KodeKreditPenjualan),text(row.KodeDebetPembelian),text(row.KodeKreditPembelian),text(row.Keterangan));
    for(const row of data.suppliers)supplier.run(text(row.kode),text(row.nama),text(row.alamat),text(row.asal),text(row.keterangan));
    for(const row of data.inventory)inventory.run(voucher(row.noBukti),text(row.BC23),text(row.noContainer),sqlDate(row.Tanggal),text(row.KodeSupplier),text(row.kursTipe),number(row.kursValue),number(row.beaMasuk),number(row.totalAmount),number(row.totalPembelian),row.tipeTransaksi==null?null:Number(row.tipeTransaksi),text(row.keterangan));
    for(const row of data.inventoryLines)inventoryLine.run(Number(row.id)||0,voucher(row.noBukti),text(row.kodeBarang),number(row.jumlah),number(row.hargaSatuan),number(row.total),text(row.kursTipe),number(row.kursValue));
    const totals=db.prepare("SELECT COALESCE(SUM(debit),0) debit,COALESCE(SUM(credit),0) credit FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE j.voucher_number LIKE ?").get(`${source.year}/%`);
    if(Math.abs(number(totals.debit)-number(totals.credit))>0.01)throw new Error(`Debit/kredit ${source.year} tidak seimbang.`);
    db.prepare('INSERT INTO accounting_import_audits (source_name,account_count,journal_count,journal_line_count,total_debit,total_credit,notes) VALUES (?,?,?,?,?,?,?)').run(auditName,data.accounts.length,data.journals.length,data.lines.filter(row=>number(row.debet)!==0||number(row.kredit)!==0).length,number(totals.debit),number(totals.credit),`Impor CAP ${source.year}; nomor bukti diprefiks ${source.year}/ untuk menghindari bentrok lintas tahun.`);
    db.exec('COMMIT');
    return repairImportedYear(db,source,data,auditName);
  }catch(error){try{db.exec('ROLLBACK')}catch{}throw error;}
}

if(!existsSync(DATABASE))throw new Error('Database CAP tidak ditemukan.');
const backup=join(ROOT,'data',`app-before-accounting-${sources.map(source=>source.year).join('-')}-${new Date().toISOString().replace(/[:.]/g,'-')}.db`);
copyFileSync(DATABASE,backup);
const db=new DatabaseSync(DATABASE);
try{const result=[];for(const source of sources){const data=sourceData(source);result.push(importYear(db,source,data));}const totals=db.prepare("SELECT substr(transaction_date,1,4) year,COUNT(*) journals FROM accounting_journal_entries GROUP BY year ORDER BY year").all();console.log(JSON.stringify({backup,result,years:totals}));}finally{db.close();}
