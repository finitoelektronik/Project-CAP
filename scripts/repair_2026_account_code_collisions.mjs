// Repair source accounts whose old two-digit child numbers collided with
// different historical accounts after the 2026 segment normalization.
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT=process.cwd(),DATABASE=join(ROOT,'data','app.db');
const repairs=[
  ['01.01.003.004.000.0000','01.01.003.100.000.0000','BHINEKA KARYA ELEKTRINDO','01.01.003.000.000.0000','Neraca','Aktiva Lancar (Aktiva)','4','2021-01-26 00:00:00.000'],
  ['01.01.003.007.000.0000','01.01.003.101.000.0000','DELAPAN SATU TEKHNIK','01.01.003.000.000.0000','Neraca','Aktiva Lancar (Aktiva)','4','2021-02-25 00:00:00.000'],
  ['01.01.003.015.000.0000','01.01.003.102.000.0000','JAYA BERSAUDARA','01.01.003.000.000.0000','Neraca','Aktiva Lancar (Aktiva)','4','2021-04-15 00:00:00.000'],
  ['01.01.003.020.000.0000','01.01.003.103.000.0000','EVERLAST GOLDEN ELECTRIC','01.01.003.000.000.0000','Neraca','Aktiva Lancar (Aktiva)','4','2021-06-18 00:00:00.000'],
  ['01.01.003.025.000.0000','01.01.003.104.000.0000','UTAMA KITA','01.01.003.000.000.0000','Neraca','Aktiva Lancar (Aktiva)','4','2021-07-17 00:00:00.000'],
  ['01.01.003.026.000.0000','01.01.003.105.000.0000','SIGMA BERJAYA','01.01.003.000.000.0000','Neraca','Aktiva Lancar (Aktiva)','4','2021-08-10 00:00:00.000'],
  ['01.01.003.027.000.0000','01.01.003.106.000.0000','RISWARI SETYO NUGRAHENI','01.01.003.000.000.0000','Neraca','Aktiva Lancar (Aktiva)','4','2021-10-19 00:00:00.000'],
  ['01.01.003.033.000.0000','01.01.003.107.000.0000','KHALIFAH ANGGUN LESTARI','01.01.003.000.000.0000','Neraca','Aktiva Lancar (Aktiva)','4','2021-11-17 00:00:00.000'],
  ['01.01.003.049.000.0000','01.01.003.108.000.0000','ADELLA MELLENIA PRIMASARI','01.01.003.000.000.0000','Neraca','Aktiva Lancar (Aktiva)','4','2022-07-11 00:00:00.000'],
  ['01.01.003.079.000.0000','01.01.003.109.000.0000','VENITA RAHAYU WULANDARI','01.01.003.000.000.0000','Neraca','Aktiva Lancar (Aktiva)','4','2022-12-15 00:00:00.000'],
  ['01.01.003.094.000.0000','01.01.003.110.000.0000','HADASA PASTI JAYA','01.01.003.000.000.0000','Neraca','Aktiva Lancar (Aktiva)','4','2023-07-13 00:00:00.000'],
  ['05.01.089.000.000.0000','05.01.090.000.000.0000','BIAYA AKSES BENEFIT','05.01.000.000.000.0000','Laba-Rugi','Biaya','3','2026-07-18 00:00:00.000']
];
const backup=join(ROOT,'data',`app-before-2026-account-collision-repair-${new Date().toISOString().replace(/[:.]/g,'-')}.db`);
copyFileSync(DATABASE,backup);
const db=new DatabaseSync(DATABASE);
try{
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;');
  try{
    const insert=db.prepare("INSERT OR IGNORE INTO accounting_accounts(account_code,account_name,level_name,parent_code,account_status,description,account_type,account_subtype,is_group,counter_account_code,legacy_user_id,legacy_date,source,display_opening_amount,display_opening_side) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const update=db.prepare("UPDATE accounting_journal_lines SET account_code=? WHERE account_code=? AND journal_id IN (SELECT id FROM accounting_journal_entries WHERE voucher_number LIKE '2026/%')");
    let inserted=0,moved=0;
    for(const [oldCode,newCode,name,parent,type,subtype,level,date] of repairs){
      const before=Number(db.prepare('SELECT COUNT(*) count FROM accounting_accounts WHERE account_code=?').get(newCode).count);
      insert.run(newCode,name,level,parent,'','',type,subtype,0,'','1',date,'legacy',0,'');
      if(!before)inserted++;
      moved+=Number(update.run(newCode,oldCode).changes||0);
    }
    const dangling=Number(db.prepare("SELECT COUNT(*) count FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id LEFT JOIN accounting_accounts a ON a.account_code=l.account_code WHERE j.voucher_number LIKE '2026/%' AND a.account_code IS NULL").get().count);
    const residual=Number(db.prepare(`SELECT COUNT(*) count FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE j.voucher_number LIKE '2026/%' AND l.account_code IN (${repairs.map(()=>'?').join(',')})`).get(...repairs.map(row=>row[0])).count);
    if(dangling||residual)throw new Error(`Verifikasi perbaikan gagal: relasi putus ${dangling}, baris belum dipindahkan ${residual}.`);
    db.exec('COMMIT');
    console.log(JSON.stringify({ok:true,backup,inserted,moved,format:'2.2.3.3.3.4'},null,2));
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}finally{db.close();}
