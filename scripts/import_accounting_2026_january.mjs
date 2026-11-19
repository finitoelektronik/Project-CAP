// Import CAP 2026 dari backup SQL Server terbaru yang direstore ke staging.
// The source uses account segments 2.2.2.2.2.4; CAP now uses 2.2.3.3.3.4.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT=process.cwd(),DATABASE=join(ROOT,'data','app.db');
const SOURCE_DATABASE='CAP_Accounting_2026_January_Import',SOURCE_NAME='CAP2026/akuntansi2026CAPBJ.bak (backup terbaru)';
const text=value=>value==null?'':String(value).trim(),number=value=>Number(value||0);
// Tanggal SQL Server adalah tanggal kalender. Jangan mengubah ISO date-only ke
// UTC karena itu dapat memindahkan transaksi ke hari sebelumnya.
const normalizedDate=value=>{const source=String(value||'').trim(),iso=source.match(/^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/);if(iso)return iso[1];const match=source.match(/\/Date\((-?\d+)([+-]\d{4})?\)\//);if(!match)return source;let epoch=Number(match[1]);if(match[2]){const sign=match[2][0]==='-'?-1:1,offset=Number(match[2].slice(1,3))*60+Number(match[2].slice(3,5));epoch+=sign*offset*60000;}return new Date(epoch).toISOString();};
const sqlDate=value=>normalizedDate(value).slice(0,10),sqlStamp=value=>{const normalized=normalizedDate(value);return /^\d{4}-\d{2}-\d{2}$/.test(normalized)?`${normalized} 00:00:00`:normalized.replace('T',' ').slice(0,23);};
function accountCode(value){const parts=text(value).split('.');if(parts.length!==6||parts.some(part=>!/^\d+$/.test(part)))throw new Error(`Kode rekening sumber tidak valid: ${value}`);return parts.map((part,index)=>part.padStart([2,2,3,3,3,4][index],'0')).join('.');}
function rows(query){const command=`$ErrorActionPreference='Stop';$cn=New-Object System.Data.SqlClient.SqlConnection 'Server=(local);Integrated Security=SSPI;Initial Catalog=${SOURCE_DATABASE};Connect Timeout=20';$cn.Open();$cmd=$cn.CreateCommand();$cmd.CommandText='${query.replace(/'/g,"''")}';$adapter=New-Object System.Data.SqlClient.SqlDataAdapter $cmd;$table=New-Object System.Data.DataTable;[void]$adapter.Fill($table);$result=foreach($row in $table.Rows){$item=[ordered]@{};foreach($column in $table.Columns){$item[$column.ColumnName]=$row[$column.ColumnName]};[PSCustomObject]$item};$cn.Close();if($null -eq $result){'[]'}else{@($result)|ConvertTo-Json -Compress -Depth 4}`;const output=execFileSync('powershell.exe',['-NoProfile','-Command',command],{encoding:'utf8',maxBuffer:128*1024*1024}).trim();return output?JSON.parse(output):[];}

if(!existsSync(DATABASE))throw new Error('Database CAP lokal tidak ditemukan.');
const source={
  accounts:rows('SELECT noRek,nama,tingkat,induk,status,keterangan,userID,tanggal,tipe,subtipe,kelompok,lawanRek FROM dbo.Rekening ORDER BY noRek'),
  // CONVERT menjadi date-only di SQL Server sebelum serialisasi JSON. Dengan
  // demikian 02 Jan tetap 02 Jan dan tidak berubah menjadi 01 Jan akibat UTC.
  journals:rows('SELECT noBukti,uraian,jumlah,CONVERT(char(10),tanggal,23) AS tanggal,userID,jenis FROM dbo.Transaksi ORDER BY tanggal,noBukti'),
  lines:rows('SELECT noBukti,Keterangan,noRek,debet,kredit,waktu,id FROM dbo.DetailTransaksi ORDER BY id'),
  items:rows('SELECT kode,nama,JenisBarang,KodeDebetPenjualan,KodeKreditPenjualan,KodeDebetPembelian,KodeKreditPembelian,Keterangan FROM dbo.Barang ORDER BY kode'),
  suppliers:rows('SELECT kode,nama,alamat,asal,keterangan FROM dbo.Supplier ORDER BY kode'),
  inventory:rows('SELECT noBukti,BC23,noContainer,CONVERT(char(10),Tanggal,23) AS Tanggal,KodeSupplier,kursTipe,kursValue,beaMasuk,totalAmount,totalPembelian,tipeTransaksi,keterangan FROM dbo.TransaksiBarang ORDER BY noBukti'),
  inventoryLines:rows('SELECT id,noBukti,kodeBarang,jumlah,hargaSatuan,total,kursTipe,kursValue FROM dbo.DetailTransaksiBarang ORDER BY id')
};
const datedJournals=source.journals.filter(row=>sqlDate(row.tanggal).startsWith('2026-'));
const allowedVouchers=new Set(datedJournals.map(row=>text(row.noBukti)));
const lines=source.lines.filter(row=>allowedVouchers.has(text(row.noBukti)));
const expectedDebit=lines.reduce((sum,row)=>sum+number(row.debet),0),expectedCredit=lines.reduce((sum,row)=>sum+number(row.kredit),0);
if(Math.abs(expectedDebit-expectedCredit)>0.01)throw new Error(`Sumber Januari–Oktober 2026 tidak seimbang: debit ${expectedDebit}, kredit ${expectedCredit}.`);
const backup=join(ROOT,'data',`app-before-accounting-2026-${new Date().toISOString().replace(/[:.]/g,'-')}.db`);
copyFileSync(DATABASE,backup);
const db=new DatabaseSync(DATABASE),voucher=value=>`2026/${text(value)}`;
try{
  const account=db.prepare("INSERT OR IGNORE INTO accounting_accounts (account_code,account_name,level_name,parent_code,account_status,description,account_type,account_subtype,is_group,counter_account_code,legacy_user_id,legacy_date,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'legacy')");
  const journal=db.prepare("INSERT OR IGNORE INTO accounting_journal_entries (voucher_number,transaction_date,description,amount,transaction_type,legacy_user_id,source) VALUES (?,?,?,?,?,?, 'legacy')");
  const line=db.prepare('INSERT INTO accounting_journal_lines (journal_id,account_code,description,debit,credit,legacy_line_id,legacy_timestamp) VALUES (?,?,?,?,?,?,?)');
  const item=db.prepare('INSERT OR IGNORE INTO accounting_legacy_items (item_code,item_name,item_type,debit_sales_code,credit_sales_code,debit_purchase_code,credit_purchase_code,description) VALUES (?,?,?,?,?,?,?,?)');
  const supplier=db.prepare('INSERT OR IGNORE INTO accounting_legacy_suppliers (supplier_code,supplier_name,address,origin,description) VALUES (?,?,?,?,?)');
  const inventory=db.prepare('INSERT OR IGNORE INTO accounting_legacy_inventory_transactions (voucher_number,bc23,container_number,transaction_date,supplier_code,exchange_type,exchange_value,import_duty,total_amount,total_purchase,transaction_type,description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const inventoryLine=db.prepare('INSERT INTO accounting_legacy_inventory_lines (legacy_line_id,voucher_number,item_code,quantity,unit_price,total,exchange_type,exchange_value) VALUES (?,?,?,?,?,?,?,?)');
  db.exec('BEGIN IMMEDIATE');
  try{
    // Ulang hanya data historis hasil impor 2026. Data 2021–2025 dan data
    // master tetap utuh. Baris detail dihapus dahulu agar impor ulang tidak
    // menggandakan jurnal atau saldo awal persediaan.
    db.exec("DELETE FROM accounting_journal_lines WHERE journal_id IN (SELECT id FROM accounting_journal_entries WHERE voucher_number LIKE '2026/%')");
    db.exec("DELETE FROM accounting_journal_entries WHERE voucher_number LIKE '2026/%'");
    db.exec("DELETE FROM accounting_legacy_inventory_lines WHERE voucher_number LIKE '2026/%'");
    db.exec("DELETE FROM accounting_legacy_inventory_transactions WHERE voucher_number LIKE '2026/%'");
    db.prepare('DELETE FROM accounting_import_audits WHERE source_name=?').run(SOURCE_NAME);
    for(const row of source.accounts)account.run(accountCode(row.noRek),text(row.nama),text(row.tingkat),row.induk?accountCode(row.induk):'',text(row.status),text(row.keterangan),text(row.tipe),text(row.subtipe),number(row.kelompok)?1:0,row.lawanRek?accountCode(row.lawanRek):'',text(row.userID),sqlStamp(row.tanggal));
    const journalIds=new Map();
    for(const row of datedJournals){const code=voucher(row.noBukti);journal.run(code,sqlDate(row.tanggal),text(row.uraian),number(row.jumlah),text(row.jenis),text(row.userID));journalIds.set(text(row.noBukti),db.prepare('SELECT id FROM accounting_journal_entries WHERE voucher_number=?').get(code).id);}
    // legacy_line_id bersifat unik secara global di SQLite, sementara setiap
    // backup SQL Server mengawali ID detail dari awal. Nomor bukti 2026/...
    // dipakai sebagai jejak audit lintas tahun, sehingga ID lama tidak disalin.
    for(const row of lines){const debit=number(row.debet),credit=number(row.kredit);if(!debit&&!credit)continue;if(debit&&credit)throw new Error(`Detail jurnal memiliki debit dan kredit sekaligus: ${text(row.noBukti)}`);const journalId=journalIds.get(text(row.noBukti));if(!journalId)throw new Error(`Detail jurnal tanpa header: ${text(row.noBukti)}`);line.run(journalId,accountCode(row.noRek),text(row.Keterangan),debit,credit,null,sqlStamp(row.waktu));}
    for(const row of source.items)item.run(text(row.kode),text(row.nama),text(row.JenisBarang),row.KodeDebetPenjualan?accountCode(row.KodeDebetPenjualan):'',row.KodeKreditPenjualan?accountCode(row.KodeKreditPenjualan):'',row.KodeDebetPembelian?accountCode(row.KodeDebetPembelian):'',row.KodeKreditPembelian?accountCode(row.KodeKreditPembelian):'',text(row.Keterangan));
    for(const row of source.suppliers)supplier.run(text(row.kode),text(row.nama),text(row.alamat),text(row.asal),text(row.keterangan));
    for(const row of source.inventory)if(allowedVouchers.has(text(row.noBukti)))inventory.run(voucher(row.noBukti),text(row.BC23),text(row.noContainer),sqlDate(row.Tanggal),text(row.KodeSupplier),text(row.kursTipe),number(row.kursValue),number(row.beaMasuk),number(row.totalAmount),number(row.totalPembelian),row.tipeTransaksi==null?null:number(row.tipeTransaksi),text(row.keterangan));
    for(const row of source.inventoryLines)if(allowedVouchers.has(text(row.noBukti)))inventoryLine.run(Number(row.id)||0,voucher(row.noBukti),text(row.kodeBarang),number(row.jumlah),number(row.hargaSatuan),number(row.total),text(row.kursTipe),number(row.kursValue));
    const totals=db.prepare("SELECT COALESCE(SUM(debit),0) debit,COALESCE(SUM(credit),0) credit,COUNT(*) lines FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE j.voucher_number LIKE '2026/%'").get();
    if(Math.abs(number(totals.debit)-expectedDebit)>0.01||Math.abs(number(totals.credit)-expectedCredit)>0.01)throw new Error('Rekonsiliasi nominal hasil impor gagal.');
    db.prepare('INSERT INTO accounting_import_audits (source_name,account_count,journal_count,journal_line_count,total_debit,total_credit,notes) VALUES (?,?,?,?,?,?,?)').run(SOURCE_NAME,source.accounts.length,datedJournals.length,lines.filter(row=>number(row.debet)||number(row.kredit)).length,number(totals.debit),number(totals.credit),'Impor CAP 2026 dari backup terbaru; nomor bukti diprefiks 2026/ dan semua rekening dinormalisasi dari 2.2.2.2.2.4 ke 2.2.3.3.3.4.');
    db.exec('COMMIT');
    console.log(JSON.stringify({ok:true,backup,source:{accounts:source.accounts.length,journals:datedJournals.length,lines:lines.length},totals},null,2));
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}finally{db.close();}
