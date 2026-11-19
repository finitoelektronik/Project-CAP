// Normalize imported account codes from 2.2.3.3.2.4 to 2.2.3.3.3.4.
// Existing target master records remain authoritative; references are remapped atomically.
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT=process.cwd(),DATABASE=join(ROOT,'data','app.db');
if(!existsSync(DATABASE))throw new Error('Database CAP lokal tidak ditemukan.');
const db=new DatabaseSync(DATABASE);
const normalize=code=>{const parts=String(code||'').split('.');if(parts.length!==6||parts.some(part=>!/^\d+$/.test(part)))throw new Error(`Kode rekening tidak valid: ${code}`);return [parts[0].padStart(2,'0'),parts[1].padStart(2,'0'),parts[2].padStart(3,'0'),parts[3].padStart(3,'0'),parts[4].padStart(3,'0'),parts[5].padStart(4,'0')].join('.');};
try{
  const old=db.prepare('SELECT account_code,account_name,level_name,parent_code,account_status,description,account_type,account_subtype,is_group,counter_account_code,legacy_user_id,legacy_date,source,display_opening_amount,display_opening_side FROM accounting_accounts WHERE length(account_code)=21 ORDER BY account_code').all();
  if(!old.length){console.log(JSON.stringify({ok:true,message:'Tidak ada rekening format 2.2.3.3.2.4 yang perlu dikonversi.'},null,2));process.exit(0);}
  const mapping=new Map(old.map(row=>[row.account_code,normalize(row.account_code)]));
  const existing=new Map(db.prepare('SELECT account_code,account_name FROM accounting_accounts WHERE length(account_code)=22').all().map(row=>[row.account_code,row]));
  const mismatches=old.filter(row=>{const target=existing.get(mapping.get(row.account_code));return target&&String(target.account_name||'').trim().toUpperCase()!==String(row.account_name||'').trim().toUpperCase();});
  const backup=join(ROOT,'data',`app-before-account-segments-223334-${new Date().toISOString().replace(/[:.]/g,'-')}.db`);
  copyFileSync(DATABASE,backup);
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;');
  try{
    const insert=db.prepare("INSERT INTO accounting_accounts(account_code,account_name,level_name,parent_code,account_status,description,account_type,account_subtype,is_group,counter_account_code,legacy_user_id,legacy_date,source,display_opening_amount,display_opening_side) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    let created=0;
    for(const row of old){const target=mapping.get(row.account_code);if(existing.has(target))continue;insert.run(target,row.account_name,row.level_name,mapping.get(row.parent_code)||row.parent_code,row.account_status,row.description,row.account_type,row.account_subtype,row.is_group,row.counter_account_code?mapping.get(row.counter_account_code)||row.counter_account_code:'',row.legacy_user_id,row.legacy_date,row.source,row.display_opening_amount,row.display_opening_side);created++;}
    const mapped=value=>mapping.get(value)||value;
    const updateColumn=(table,column)=>{const rows=db.prepare(`SELECT rowid AS _rowid,${column} value FROM ${table} WHERE ${column} IN (${[...mapping.keys()].map(()=>'?').join(',')})`).all(...mapping.keys());const update=db.prepare(`UPDATE ${table} SET ${column}=? WHERE rowid=?`);for(const row of rows)update.run(mapped(row.value),row._rowid);return rows.length;};
    const updated={};
    updated.journal_lines=updateColumn('accounting_journal_lines','account_code');
    updated.account_audit=updateColumn('accounting_account_audit','account_code');
    updated.inventory_counter=updateColumn('accounting_inventory_documents','counter_account_code');
    for(const table of ['accounting_legacy_items','accounting_items'])for(const column of ['debit_sales_code','credit_sales_code','debit_purchase_code','credit_purchase_code'])updated[`${table}.${column}`]=updateColumn(table,column);
    // Mapping/metadata tables use account_code as a key. Preserve an already existing
    // target row rather than overwriting its newer settings, then remove old aliases.
    for(const table of ['accounting_report_mappings','accounting_annual_account_metadata','accounting_year_close_request_lines']){
      const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name).filter(name=>name!=='account_code');
      const rows=db.prepare(`SELECT * FROM ${table} WHERE account_code IN (${[...mapping.keys()].map(()=>'?').join(',')})`).all(...mapping.keys());
      for(const row of rows){const target=mapped(row.account_code),names=['account_code',...columns],marks=names.map(()=>'?').join(',');const values=[target,...columns.map(column=>row[column])];db.prepare(`INSERT OR IGNORE INTO ${table} (${names.join(',')}) VALUES (${marks})`).run(...values);}
      db.prepare(`DELETE FROM ${table} WHERE account_code IN (${[...mapping.keys()].map(()=>'?').join(',')})`).run(...mapping.keys());
      updated[table]=rows.length;
    }
    updated.parent_code=updateColumn('accounting_accounts','parent_code');
    updated.counter_account_code=updateColumn('accounting_accounts','counter_account_code');
    db.prepare(`DELETE FROM accounting_accounts WHERE account_code IN (${[...mapping.keys()].map(()=>'?').join(',')})`).run(...mapping.keys());
    db.exec("CREATE TABLE IF NOT EXISTS accounting_account_code_settings (id INTEGER PRIMARY KEY CHECK(id=1), segment_lengths TEXT NOT NULL DEFAULT '2.2.3.3.3.4', updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;");
    db.prepare("INSERT INTO accounting_account_code_settings(id,segment_lengths,updated_by,updated_at) VALUES (1,'2.2.3.3.3.4','system-migration',CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET segment_lengths=excluded.segment_lengths,updated_by=excluded.updated_by,updated_at=excluded.updated_at").run();
    const remaining=Number(db.prepare('SELECT COUNT(*) count FROM accounting_accounts WHERE length(account_code)=21').get().count);
    const missing=Number(db.prepare('SELECT COUNT(*) count FROM accounting_journal_lines l LEFT JOIN accounting_accounts a ON a.account_code=l.account_code WHERE a.account_code IS NULL').get().count);
    if(remaining||missing)throw new Error(`Verifikasi migrasi gagal: rekening lama ${remaining}, referensi jurnal putus ${missing}.`);
    db.exec('COMMIT');
    console.log(JSON.stringify({ok:true,backup,converted:old.length,created,merged:old.length-created,nameMismatches:mismatches.map(row=>({old_code:row.account_code,new_code:mapping.get(row.account_code),source_name:row.account_name,target_name:existing.get(mapping.get(row.account_code))?.account_name||''})),updated,format:'2.2.3.3.3.4'},null,2));
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}finally{db.close();}
