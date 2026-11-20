// CAP Analytics local server — watched by start-dev.ps1; data persists in SQLite across restarts.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync, copyFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { networkInterfaces } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { randomUUID, randomBytes, pbkdf2Sync, timingSafeEqual, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.PORT || 3000), ROOT = process.cwd(), PUBLIC = join(ROOT, 'public'), DATA = join(ROOT, 'data'), ERP_URL = process.env.ERP_URL || 'http://192.168.1.2/';
let serverRestartScheduled = false;
function scheduleServerRestart() {
  if (serverRestartScheduled) return true;
  const script = join(ROOT, 'scripts', 'Restart-CAP-Server-Admin.ps1');
  if (!existsSync(script)) throw new Error('File untuk memulai ulang server tidak ditemukan. Jalankan pembaruan CAP Analytics terlebih dahulu.');
  serverRestartScheduled = true;
  // Beri waktu respons HTTP dikirim dahulu agar browser dapat menampilkan status restart.
  setTimeout(() => {
    try {
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Port', String(PORT), '-NoBrowser'], {
        cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore'
      });
      child.unref();
    } catch {}
  }, 600);
  return true;
}

// Excel diproses di komputer server. Jangan mengandalkan runtime Codex karena
// folder tersebut tidak ada pada komputer pelanggan/klien.
const pythonRuntimes = new Map();
function findPythonRuntime(requirements = 'openpyxl,xlrd') {
  if (pythonRuntimes.has(requirements)) return pythonRuntimes.get(requirements);
  const checkCode = requirements ? `import ${requirements}` : 'pass';
  const candidates = [
    process.env.CAP_PYTHON,
    join(ROOT, 'runtime', 'python', 'python.exe'),
    'C:\\Program Files\\Python313\\python.exe',
    'C:\\Program Files\\Python312\\python.exe',
    'C:\\Program Files\\Python311\\python.exe',
    'C:\\Program Files (x86)\\Python312\\python.exe',
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python313', 'python.exe'),
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
    'C:\\Users\\adits\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe'
  ].filter(Boolean);
  for (const executable of candidates) {
    if (!existsSync(executable)) continue;
    const check = spawnSync(executable, ['-c', checkCode], { encoding: 'utf8', timeout: 15000 });
    if (check.status === 0) { const runtime = { executable, prefix: [] }; pythonRuntimes.set(requirements, runtime); return runtime; }
  }
  const launcher = spawnSync('py', ['-3', '-c', checkCode], { encoding: 'utf8', timeout: 15000 });
  if (!launcher.error && launcher.status === 0) { const runtime = { executable: 'py', prefix: ['-3'] }; pythonRuntimes.set(requirements, runtime); return runtime; }
  const command = spawnSync('python', ['-c', checkCode], { encoding: 'utf8', timeout: 15000 });
  if (!command.error && command.status === 0) { const runtime = { executable: 'python', prefix: [] }; pythonRuntimes.set(requirements, runtime); return runtime; }
  throw new Error(requirements === 'openpyxl' ? 'Fitur ekspor Excel membutuhkan Python dan openpyxl di komputer server.' : 'Fitur impor Excel membutuhkan Python, openpyxl, dan xlrd di komputer server. Jalankan Install-CAP-Analytics.ps1 versi terbaru sebagai Administrator.');
}
function runPython(script, args, requirements = 'openpyxl,xlrd') {
  const runtime = findPythonRuntime(requirements);
  return spawnSync(runtime.executable, [...runtime.prefix, script, ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 300000 });
}
function findOcrRuntime(){
  const candidates=[process.env.CAP_TESSERACT,join(ROOT,'runtime','tesseract','tesseract.exe'),'C:\\Program Files\\Tesseract-OCR\\tesseract.exe','C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe'].filter(Boolean);
  return candidates.find(executable=>existsSync(executable))||'';
}
function ocrInstallationJob(){try{return db.prepare('SELECT * FROM ocr_installation_jobs ORDER BY id DESC LIMIT 1').get()||null;}catch{return null;}}
function updateOcrInstallationJob(status,message=''){try{db.prepare('UPDATE ocr_installation_jobs SET status=?,message=?,updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT MAX(id) FROM ocr_installation_jobs)').run(status,String(message||'').slice(0,1000));}catch{}}
let ocrInstallerStarted=false;
function startQueuedOcrInstallation(){
  if(ocrInstallerStarted||findOcrRuntime())return;
  const job=ocrInstallationJob();if(!job||job.status!=='pending')return;
  const script=join(ROOT,'scripts','Install-CAP-OCR.ps1');if(!existsSync(script)){updateOcrInstallationJob('failed','Berkas pemasang OCR tidak ditemukan dalam paket.');return;}
  ocrInstallerStarted=true;updateOcrInstallationJob('installing','Mengunduh dan memasang Tesseract OCR dari sumber resmi…');
  const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
  child.stdout.on('data',chunk=>{output+=String(chunk);});child.stderr.on('data',chunk=>{output+=String(chunk);});
  child.on('error',error=>{updateOcrInstallationJob('failed',error.message);ocrInstallerStarted=false;});
  child.on('close',code=>{const installed=findOcrRuntime();updateOcrInstallationJob(installed?'completed':'failed',installed?'OCR siap dipakai.':(output.trim()||`Pemasangan OCR berhenti dengan kode ${code}.`));ocrInstallerStarted=false;});
}
function ocrStatus(){
  const executable=findOcrRuntime();if(!executable){const job=ocrInstallationJob(),message=job?.status==='pending'?'Pemasangan OCR dari paket akan dimulai setelah CAP aktif.':job?.status==='installing'?'Pemasangan OCR sedang berlangsung. Tunggu sebentar lalu buka ulang dialog.':job?.status==='failed'?`Pemasangan OCR gagal: ${job.message||'lihat log server.'}`:'OCR lokal belum terpasang. Pasang runtime Tesseract CAP pada server.';return {ready:false,indonesian:false,english:false,message};}
  const result=spawnSync(executable,['--list-langs'],{encoding:'utf8',timeout:15000}),languages=(result.stdout||'').split(/\r?\n/).map(item=>item.trim()).filter(item=>/^[a-z_]+$/i.test(item));
  const english=languages.includes('eng'),indonesian=languages.includes('ind');
  return {ready:english,indonesian,english,executable,message:english?(indonesian?'OCR lokal siap · Bahasa Indonesia dan Inggris aktif.':'OCR lokal siap dalam Bahasa Inggris; paket Bahasa Indonesia belum tersedia.'):'Runtime OCR ditemukan tetapi bahasa Inggris belum tersedia.'};
}
if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(join(DATA, 'app.db'));
db.exec('PRAGMA busy_timeout = 5000');
db.transaction = task => (...args) => { db.exec('BEGIN IMMEDIATE'); try { const result = task(...args); db.exec('COMMIT'); return result; } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; } };
db.exec(`CREATE TABLE IF NOT EXISTS uploads (id INTEGER PRIMARY KEY, file_name TEXT NOT NULL, uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, row_count INTEGER NOT NULL, file_data BLOB NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS order_lines (id INTEGER PRIMARY KEY, upload_id INTEGER NOT NULL REFERENCES uploads(id), source TEXT NOT NULL, order_id TEXT NOT NULL, status TEXT, substatus TEXT, cancel_reason TEXT, tracking TEXT, delivered TEXT, sku TEXT, product_name TEXT, quantity REAL NOT NULL DEFAULT 0, returned_qty REAL NOT NULL DEFAULT 0, refund_amount REAL NOT NULL DEFAULT 0, province TEXT, city TEXT) STRICT;
CREATE INDEX IF NOT EXISTS idx_order_lines_upload ON order_lines(upload_id);
CREATE TABLE IF NOT EXISTS warehouse_activities (
  id INTEGER PRIMARY KEY,
  activity_date TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT 'Produksi',
  shift TEXT NOT NULL,
  activity TEXT NOT NULL,
  area TEXT NOT NULL,
  staff TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_warehouse_activities_date ON warehouse_activities(activity_date);`);
const warehouseColumns = db.prepare("PRAGMA table_info(warehouse_activities)").all().map(column => column.name);
if (!warehouseColumns.includes('section')) db.exec("ALTER TABLE warehouse_activities ADD COLUMN section TEXT NOT NULL DEFAULT 'Produksi'");
db.exec(`CREATE TABLE IF NOT EXISTS warehouse_reports (
  id INTEGER PRIMARY KEY,
  activity_date TEXT NOT NULL,
  section TEXT NOT NULL,
  leader TEXT NOT NULL DEFAULT '',
  member_count INTEGER NOT NULL DEFAULT 0,
  online_total INTEGER NOT NULL DEFAULT 0,
  offline_total INTEGER NOT NULL DEFAULT 0,
  total_units INTEGER NOT NULL DEFAULT 0,
  receipt_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  image_name TEXT NOT NULL,
  image_mime TEXT NOT NULL,
  image_data BLOB NOT NULL,
  ocr_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_warehouse_reports_date ON warehouse_reports(activity_date,section);`);
const warehouseReportColumns = db.prepare("PRAGMA table_info(warehouse_reports)").all().map(column => column.name);
if (!warehouseReportColumns.includes('offline_total')) db.exec("ALTER TABLE warehouse_reports ADD COLUMN offline_total INTEGER NOT NULL DEFAULT 0");
if (!warehouseReportColumns.includes('total_units')) db.exec("ALTER TABLE warehouse_reports ADD COLUMN total_units INTEGER NOT NULL DEFAULT 0");
setTimeout(startQueuedOcrInstallation,1000);
db.exec(`DELETE FROM warehouse_reports WHERE id NOT IN (SELECT MAX(id) FROM warehouse_reports GROUP BY activity_date,section);
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_reports_date_section ON warehouse_reports(activity_date,section);`);
db.exec(`CREATE TABLE IF NOT EXISTS return_incoming_shipments (
  id INTEGER PRIMARY KEY, received_date TEXT NOT NULL, tracking_number TEXT NOT NULL UNIQUE,
  courier TEXT NOT NULL DEFAULT 'Belum teridentifikasi', source_file TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_return_incoming_tracking ON return_incoming_shipments(tracking_number);
CREATE INDEX IF NOT EXISTS idx_return_incoming_date ON return_incoming_shipments(received_date);`);
db.prepare("UPDATE return_incoming_shipments SET courier='J&T Cargo' WHERE courier='Belum teridentifikasi' AND tracking_number LIKE '57%'").run();
db.exec(`CREATE TABLE IF NOT EXISTS payroll_uploads (
  id INTEGER PRIMARY KEY, file_name TEXT NOT NULL, period TEXT, uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  row_count INTEGER NOT NULL, file_data BLOB NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS payroll_records (
  id INTEGER PRIMARY KEY, upload_id INTEGER NOT NULL REFERENCES payroll_uploads(id), employee_id TEXT NOT NULL,
  name TEXT NOT NULL, department TEXT, work_hours_standard REAL NOT NULL DEFAULT 0, work_hours_actual REAL NOT NULL DEFAULT 0,
  late_count REAL NOT NULL DEFAULT 0, late_minutes REAL NOT NULL DEFAULT 0, early_count REAL NOT NULL DEFAULT 0,
  early_minutes REAL NOT NULL DEFAULT 0, overtime_normal REAL NOT NULL DEFAULT 0, overtime_special REAL NOT NULL DEFAULT 0,
  attendance_standard REAL NOT NULL DEFAULT 0, attendance_actual REAL NOT NULL DEFAULT 0, absence_days REAL NOT NULL DEFAULT 0,
  leave_days REAL NOT NULL DEFAULT 0, attendance_rate REAL NOT NULL DEFAULT 0, daily_wage REAL NOT NULL DEFAULT 95000,
  deduction REAL NOT NULL DEFAULT 0, overtime_rate REAL NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX IF NOT EXISTS idx_payroll_records_upload ON payroll_records(upload_id);`);
// Versi sebelum normalisasi nama dapat menyimpan dua rekap untuk ID yang sama
// dalam satu unggahan. Bersihkan salinan lama sekali saat server dijalankan;
// log absensi sudah unik berdasarkan upload, karyawan, dan tanggal.
const duplicatePayrollRecordCount=Number(db.prepare("SELECT COUNT(*) AS count FROM (SELECT upload_id,employee_id FROM payroll_records GROUP BY upload_id,employee_id HAVING COUNT(*)>1)").get()?.count||0);
if(duplicatePayrollRecordCount){
  db.exec(`BEGIN;
    DELETE FROM payroll_records
      WHERE id NOT IN (SELECT MIN(id) FROM payroll_records GROUP BY upload_id,employee_id);
    UPDATE payroll_uploads
      SET row_count=(SELECT COUNT(*) FROM payroll_records WHERE payroll_records.upload_id=payroll_uploads.id);
    COMMIT;`);
}
db.exec(`CREATE TABLE IF NOT EXISTS payroll_attendance_logs (
  id INTEGER PRIMARY KEY, upload_id INTEGER NOT NULL REFERENCES payroll_uploads(id), employee_id TEXT NOT NULL,
  attendance_date TEXT NOT NULL, clock_in TEXT NOT NULL, clock_out TEXT NOT NULL, raw_times TEXT NOT NULL,
  UNIQUE(upload_id,employee_id,attendance_date)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_payroll_attendance_logs_employee_date ON payroll_attendance_logs(employee_id,attendance_date);`);
db.exec(`CREATE TABLE IF NOT EXISTS payroll_employee_groups (
  employee_id TEXT PRIMARY KEY, employee_name TEXT NOT NULL, department TEXT,
  payment_model TEXT NOT NULL DEFAULT 'unclassified' CHECK(payment_model IN ('cash','transfer','keluar','unclassified')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_payroll_employee_groups_payment ON payroll_employee_groups(payment_model);`);
db.exec("CREATE TABLE IF NOT EXISTS payroll_attendance_issues (id INTEGER PRIMARY KEY, upload_id INTEGER NOT NULL REFERENCES payroll_uploads(id), employee_id TEXT NOT NULL, attendance_date TEXT NOT NULL, detected_clock TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'warning' CHECK(status IN ('warning','forgot_clock','dismissed')), admin_clock_in TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT, UNIQUE(upload_id,employee_id,attendance_date)) STRICT; CREATE INDEX IF NOT EXISTS idx_payroll_attendance_issues_upload ON payroll_attendance_issues(upload_id,status);");
db.exec(`CREATE TABLE IF NOT EXISTS payroll_attendance_notes (
  employee_id TEXT NOT NULL, attendance_date TEXT NOT NULL,
  clock_in_note TEXT NOT NULL DEFAULT '', clock_out_note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(employee_id,attendance_date)
) STRICT;`);
// Shift is inferred from the log by default.  These two tables store only an
// administrator's end-of-month correction and explicitly declared 12-hour
// events; they never impose a roster in advance.
db.exec(`CREATE TABLE IF NOT EXISTS payroll_attendance_shift_overrides (
  employee_id TEXT NOT NULL, attendance_date TEXT NOT NULL,
  shift_code TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(employee_id,attendance_date)
) STRICT;
CREATE TABLE IF NOT EXISTS payroll_shift_events (
  id INTEGER PRIMARY KEY, event_name TEXT NOT NULL, start_date TEXT NOT NULL,
  end_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS payroll_shift_event_members (
  event_id INTEGER NOT NULL REFERENCES payroll_shift_events(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  PRIMARY KEY(event_id,employee_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_payroll_shift_events_date ON payroll_shift_events(start_date,end_date);`);
const payrollGroupDefinition = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payroll_employee_groups'").get()?.sql || '';
if (!payrollGroupDefinition.includes("'keluar'")) db.exec(`BEGIN;
  CREATE TABLE payroll_employee_groups_new (employee_id TEXT PRIMARY KEY, employee_name TEXT NOT NULL, department TEXT, payment_model TEXT NOT NULL DEFAULT 'unclassified' CHECK(payment_model IN ('cash','transfer','keluar','unclassified')), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;
  INSERT INTO payroll_employee_groups_new (employee_id,employee_name,department,payment_model,updated_at) SELECT employee_id,employee_name,department,payment_model,updated_at FROM payroll_employee_groups;
  DROP TABLE payroll_employee_groups;
  ALTER TABLE payroll_employee_groups_new RENAME TO payroll_employee_groups;
  CREATE INDEX idx_payroll_employee_groups_payment ON payroll_employee_groups(payment_model);
COMMIT;`);
db.exec(`INSERT OR IGNORE INTO payroll_employee_groups (employee_id,employee_name,department)
  SELECT employee_id, name, department FROM payroll_records WHERE trim(employee_id) <> ''`);
const payrollGroupColumns = db.prepare("PRAGMA table_info(payroll_employee_groups)").all().map(column => column.name);
if (!payrollGroupColumns.includes('daily_wage')) db.exec('ALTER TABLE payroll_employee_groups ADD COLUMN daily_wage REAL NOT NULL DEFAULT 95000');
if (!payrollGroupColumns.includes('monthly_basic')) db.exec('ALTER TABLE payroll_employee_groups ADD COLUMN monthly_basic REAL NOT NULL DEFAULT 0');
if (!payrollGroupColumns.includes('monthly_premium')) db.exec('ALTER TABLE payroll_employee_groups ADD COLUMN monthly_premium REAL NOT NULL DEFAULT 0');
if (!payrollGroupColumns.includes('department_locked')) db.exec('ALTER TABLE payroll_employee_groups ADD COLUMN department_locked INTEGER NOT NULL DEFAULT 0');
// Transfer dibayar melalui komponen bulanan; tidak memakai upah harian maupun premi.
db.prepare("UPDATE payroll_employee_groups SET daily_wage=0,monthly_premium=0,updated_at=CURRENT_TIMESTAMP WHERE payment_model='transfer' AND (daily_wage<>0 OR monthly_premium<>0)").run();
db.exec(`CREATE TRIGGER IF NOT EXISTS enforce_transfer_zero_compensation
AFTER UPDATE OF payment_model ON payroll_employee_groups
WHEN NEW.payment_model='transfer'
BEGIN UPDATE payroll_employee_groups SET daily_wage=0,monthly_premium=0,updated_at=CURRENT_TIMESTAMP WHERE employee_id=NEW.employee_id; END;
CREATE TRIGGER IF NOT EXISTS flag_transfer_empty_attendance_insert
AFTER INSERT ON payroll_attendance_logs
WHEN trim(NEW.clock_in)='' AND trim(NEW.clock_out)='' AND strftime('%w',NEW.attendance_date)<>'0'
 AND NEW.attendance_date NOT IN ('2026-01-01','2026-01-16','2026-02-16','2026-02-17','2026-03-18','2026-03-19','2026-03-20','2026-03-21','2026-03-22','2026-03-23','2026-03-24','2026-04-03','2026-04-05','2026-05-01','2026-05-14','2026-05-15','2026-05-27','2026-05-28','2026-05-31','2026-06-01','2026-06-16','2026-08-17','2026-08-25','2026-12-24','2026-12-25')
 AND COALESCE((SELECT payment_model FROM payroll_employee_status_history WHERE employee_id=NEW.employee_id AND effective_date<=NEW.attendance_date ORDER BY effective_date DESC LIMIT 1),(SELECT payment_model FROM payroll_employee_groups WHERE employee_id=NEW.employee_id),'unclassified')='transfer'
BEGIN INSERT OR IGNORE INTO payroll_attendance_issues (upload_id,employee_id,attendance_date,detected_clock) VALUES (NEW.upload_id,NEW.employee_id,NEW.attendance_date,'IN dan OUT kosong (Transfer)'); END;
CREATE TRIGGER IF NOT EXISTS flag_transfer_empty_attendance_update
AFTER UPDATE OF clock_in,clock_out ON payroll_attendance_logs
WHEN trim(NEW.clock_in)='' AND trim(NEW.clock_out)='' AND strftime('%w',NEW.attendance_date)<>'0'
 AND NEW.attendance_date NOT IN ('2026-01-01','2026-01-16','2026-02-16','2026-02-17','2026-03-18','2026-03-19','2026-03-20','2026-03-21','2026-03-22','2026-03-23','2026-03-24','2026-04-03','2026-04-05','2026-05-01','2026-05-14','2026-05-15','2026-05-27','2026-05-28','2026-05-31','2026-06-01','2026-06-16','2026-08-17','2026-08-25','2026-12-24','2026-12-25')
 AND COALESCE((SELECT payment_model FROM payroll_employee_status_history WHERE employee_id=NEW.employee_id AND effective_date<=NEW.attendance_date ORDER BY effective_date DESC LIMIT 1),(SELECT payment_model FROM payroll_employee_groups WHERE employee_id=NEW.employee_id),'unclassified')='transfer'
BEGIN INSERT OR IGNORE INTO payroll_attendance_issues (upload_id,employee_id,attendance_date,detected_clock) VALUES (NEW.upload_id,NEW.employee_id,NEW.attendance_date,'IN dan OUT kosong (Transfer)'); END;`);
const attendanceIssueColumns = db.prepare('PRAGMA table_info(payroll_attendance_issues)').all().map(column => column.name);
if (!attendanceIssueColumns.includes('correction_type')) db.exec("ALTER TABLE payroll_attendance_issues ADD COLUMN correction_type TEXT NOT NULL DEFAULT ''");
if (!attendanceIssueColumns.includes('forgot_scope')) db.exec("ALTER TABLE payroll_attendance_issues ADD COLUMN forgot_scope TEXT NOT NULL DEFAULT ''");
if (!attendanceIssueColumns.includes('attendance_status')) db.exec("ALTER TABLE payroll_attendance_issues ADD COLUMN attendance_status TEXT NOT NULL DEFAULT ''");
db.exec("UPDATE payroll_attendance_issues SET forgot_scope=CASE correction_type WHEN 'clock_out' THEN 'out' WHEN 'clock_in' THEN 'in' ELSE 'both' END, attendance_status='full' WHERE status='forgot_clock' AND attendance_status='' ");
function normalizeSingleScanLogs() {
  // Keputusan Sabtu yang sudah disetujui admin harus lebih kuat daripada
  // raw_times Excel. Tanpa pengecualian ini, restart server mengubah OUT 16:00
  // yang disimpan admin kembali menjadi kosong karena sumber Excel hanya punya
  // satu scan.
  const rows=db.prepare(`SELECT log.id,log.clock_in,log.clock_out,log.raw_times,
    EXISTS(SELECT 1 FROM payroll_attendance_issues issue
      WHERE issue.upload_id=log.upload_id AND issue.employee_id=log.employee_id
        AND issue.attendance_date=log.attendance_date AND issue.status='dismissed'
        AND issue.admin_clock_in GLOB '[0-2][0-9]:[0-5][0-9]') AS admin_completed
    FROM payroll_attendance_logs log`).all();
  const update=db.prepare('UPDATE payroll_attendance_logs SET clock_in=?,clock_out=? WHERE id=?');
  let updated=0;
  db.exec('BEGIN');try{for(const row of rows){if(row.admin_completed)continue;let times=[];try{times=JSON.parse(row.raw_times||'[]')}catch{}times=Array.isArray(times)?times.filter(time=>/^\d{2}:\d{2}$/.test(String(time))):[];if(times.length!==1)continue;const time=times[0],clockIn=time<'12:00'?time:'',clockOut=time<'12:00'?'':time;if(row.clock_in===clockIn&&row.clock_out===clockOut)continue;updated+=Number(update.run(clockIn,clockOut,row.id).changes||0);}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return updated;
}
normalizeSingleScanLogs();
function restoreAdminSaturdayCompletions() {
  // Pulihkan persetujuan yang pernah terlanjur tertimpa oleh versi lama saat
  // restart. Hanya OUT kosong/duplikat yang dipulihkan, sehingga OUT aktual
  // yang berbeda tidak pernah diubah otomatis.
  return db.prepare(`UPDATE payroll_attendance_logs AS log
    SET clock_out=(SELECT issue.admin_clock_in FROM payroll_attendance_issues issue
      WHERE issue.upload_id=log.upload_id AND issue.employee_id=log.employee_id
        AND issue.attendance_date=log.attendance_date AND issue.status='dismissed'
        AND issue.admin_clock_in GLOB '[0-2][0-9]:[0-5][0-9]' ORDER BY issue.id DESC LIMIT 1)
    WHERE strftime('%w',log.attendance_date)='6' AND (trim(log.clock_out)='' OR log.clock_in=log.clock_out)
      AND EXISTS(SELECT 1 FROM payroll_attendance_issues issue
        WHERE issue.upload_id=log.upload_id AND issue.employee_id=log.employee_id
          AND issue.attendance_date=log.attendance_date AND issue.status='dismissed'
          AND issue.admin_clock_in GLOB '[0-2][0-9]:[0-5][0-9]')`).run().changes;
}
restoreAdminSaturdayCompletions();
db.exec(`CREATE TABLE IF NOT EXISTS payroll_allowances (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, amount REAL NOT NULL CHECK(amount>=0), kind TEXT NOT NULL CHECK(kind IN ('custom','attendance')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS payroll_allowance_recipients (
  allowance_id INTEGER NOT NULL REFERENCES payroll_allowances(id) ON DELETE CASCADE, employee_id TEXT NOT NULL,
  PRIMARY KEY(allowance_id,employee_id)
) STRICT;`);
db.exec("CREATE TABLE IF NOT EXISTS payroll_settings (setting_key TEXT PRIMARY KEY, setting_value REAL NOT NULL DEFAULT 0) STRICT; INSERT OR IGNORE INTO payroll_settings (setting_key,setting_value) VALUES ('cash_monthly_premium',0); INSERT OR IGNORE INTO payroll_settings (setting_key,setting_value) VALUES ('payroll_cutoff_day',25); INSERT OR IGNORE INTO payroll_settings (setting_key,setting_value) VALUES ('cash_overtime_hourly_rate',0); INSERT OR IGNORE INTO payroll_settings (setting_key,setting_value) VALUES ('cash_overtime_min_minutes',30);");
db.exec(`CREATE TABLE IF NOT EXISTS payroll_employee_status_history (
  id INTEGER PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES payroll_employee_groups(employee_id),
  effective_date TEXT NOT NULL, payment_model TEXT NOT NULL CHECK(payment_model IN ('cash','transfer','keluar')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(employee_id,effective_date)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_payroll_employee_status_history_employee_date ON payroll_employee_status_history(employee_id,effective_date);`);
db.exec(`CREATE TABLE IF NOT EXISTS payroll_period_overrides (
  id INTEGER PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES payroll_employee_groups(employee_id),
  period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  attendance_actual REAL, daily_wage REAL, deduction REAL, notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(employee_id,period_start,period_end)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_payroll_period_overrides_period ON payroll_period_overrides(period_start,period_end);`);
// Rekap manual 26 Jul–1 Agu 2026 adalah sumber historis yang disetujui. Koreksi ini
// hanya berlaku pada periode tersebut dan tidak mengubah tarif maupun absensi periode lain.
const referencePayrollPeriod = [
  ['8',6,95000,10000], ['11',6,95000,10000], ['136',6,90000,0], ['57',6,95000,20000],
  ['59',5,95000,0], ['76',5.5,92500,0], ['83',6,92500,0], ['87',6,92500,0],
  ['111',6,90000,0], ['113',6,90000,0], ['117',6,90000,0], ['134',6,90000,0],
  ['133',6,90000,0], ['130',6,90000,0], ['128',6,90000,0], ['145',6,90000,0],
  ['16',5,95000,0], ['157',6,80000,0], ['155',6,80000,0], ['159',2,80000,0]
];
const saveReferencePayrollPeriod = db.prepare("INSERT INTO payroll_period_overrides (employee_id,period_start,period_end,attendance_actual,daily_wage,deduction,notes) VALUES (?, '2026-07-26', '2026-08-01', ?, ?, ?, 'Koreksi berdasarkan rekap pembayaran') ON CONFLICT(employee_id,period_start,period_end) DO NOTHING");
db.exec('BEGIN');
try {
  for (const [employeeId,attendance,dailyWage,deduction] of referencePayrollPeriod) saveReferencePayrollPeriod.run(employeeId,attendance,dailyWage,deduction);
  db.prepare("UPDATE payroll_employee_groups SET employee_name='Syifa',updated_at=CURRENT_TIMESTAMP WHERE employee_id='157' AND employee_name='Syiva'").run();
  db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }
if(!db.prepare("SELECT 1 FROM payroll_settings WHERE setting_key='effective_status_history_initialized'").get()){
  db.prepare("UPDATE payroll_employee_groups SET payment_model='cash',updated_at=CURRENT_TIMESTAMP WHERE payment_model='keluar'").run();
  db.prepare("INSERT INTO payroll_settings (setting_key,setting_value) VALUES ('effective_status_history_initialized',1)").run();
}
db.exec(`CREATE TABLE IF NOT EXISTS payroll_manual_overtime (
  id INTEGER PRIMARY KEY, overtime_date TEXT NOT NULL, employee_id TEXT NOT NULL,
  duration_hours REAL NOT NULL CHECK(duration_hours>=0.5), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(overtime_date,employee_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_payroll_manual_overtime_date ON payroll_manual_overtime(overtime_date);`);
if (!db.prepare("SELECT 1 FROM payroll_settings WHERE setting_key='cash_monthly_basic_initialized'").get()) {
  db.prepare("UPDATE payroll_employee_groups SET monthly_basic=300000,updated_at=CURRENT_TIMESTAMP WHERE payment_model='cash'").run();
  db.prepare("INSERT INTO payroll_settings (setting_key,setting_value) VALUES ('cash_monthly_basic_initialized',1)").run();
}
db.exec(`CREATE TABLE IF NOT EXISTS payroll_payment_logs (
  id INTEGER PRIMARY KEY, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  employee_count INTEGER NOT NULL DEFAULT 0, daily_total REAL NOT NULL DEFAULT 0,
  monthly_total REAL NOT NULL DEFAULT 0, monthly_basic_total REAL NOT NULL DEFAULT 0, allowance_total REAL NOT NULL DEFAULT 0, premium_total REAL NOT NULL DEFAULT 0,
  overtime_total REAL NOT NULL DEFAULT 0, deduction_total REAL NOT NULL DEFAULT 0,
  paid_total REAL NOT NULL DEFAULT 0, payment_model TEXT NOT NULL DEFAULT 'all',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_payroll_payment_logs_period_end ON payroll_payment_logs(period_end);`);
const paymentLogColumns=db.prepare('PRAGMA table_info(payroll_payment_logs)').all().map(column=>column.name);
if(!paymentLogColumns.includes('monthly_total'))db.exec('ALTER TABLE payroll_payment_logs ADD COLUMN monthly_total REAL NOT NULL DEFAULT 0');
if(!paymentLogColumns.includes('monthly_basic_total'))db.exec('ALTER TABLE payroll_payment_logs ADD COLUMN monthly_basic_total REAL NOT NULL DEFAULT 0');
if(!paymentLogColumns.includes('allowance_total'))db.exec('ALTER TABLE payroll_payment_logs ADD COLUMN allowance_total REAL NOT NULL DEFAULT 0');
if(!paymentLogColumns.includes('premium_total'))db.exec('ALTER TABLE payroll_payment_logs ADD COLUMN premium_total REAL NOT NULL DEFAULT 0');
if(!paymentLogColumns.includes('needs_recalculation'))db.exec('ALTER TABLE payroll_payment_logs ADD COLUMN needs_recalculation INTEGER NOT NULL DEFAULT 0');
db.exec(`CREATE TABLE IF NOT EXISTS payroll_business_trips (
  id INTEGER PRIMARY KEY, trip_name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(start_date<=end_date)
) STRICT;
CREATE TABLE IF NOT EXISTS payroll_business_trip_participants (
  trip_id INTEGER NOT NULL REFERENCES payroll_business_trips(id) ON DELETE CASCADE, employee_id TEXT NOT NULL REFERENCES payroll_employee_groups(employee_id),
  PRIMARY KEY(trip_id,employee_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_payroll_business_trips_dates ON payroll_business_trips(start_date,end_date);`);
db.exec(`CREATE TABLE IF NOT EXISTS app_users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('master','user')),
  modules TEXT NOT NULL DEFAULT '[]', job_title TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;`);
db.exec(`CREATE TABLE IF NOT EXISTS maturity_imports (
  id INTEGER PRIMARY KEY, file_name TEXT NOT NULL, row_count INTEGER NOT NULL DEFAULT 0,
  imported_by TEXT NOT NULL DEFAULT '', imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS maturity_instruments (
  id INTEGER PRIMARY KEY, import_id INTEGER REFERENCES maturity_imports(id) ON DELETE SET NULL,
  transaction_date TEXT NOT NULL DEFAULT '', nota TEXT NOT NULL DEFAULT '', store_name TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', sales_name TEXT NOT NULL DEFAULT '',
  item_name TEXT NOT NULL DEFAULT '', quantity REAL NOT NULL DEFAULT 0, unit_price REAL NOT NULL DEFAULT 0, amount REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0, source_notes TEXT NOT NULL DEFAULT '',
  instrument_type TEXT NOT NULL CHECK(instrument_type IN ('kospin','cek','giro')), instrument_number TEXT NOT NULL DEFAULT '', maturity_date TEXT NOT NULL,
  destination_account TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','cleared','cancelled')),
  created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_maturity_instruments_due ON maturity_instruments(status,maturity_date);
CREATE TABLE IF NOT EXISTS jakarta_receivable_invoices (id INTEGER PRIMARY KEY, invoice_date TEXT NOT NULL, due_date TEXT NOT NULL, invoice_number TEXT NOT NULL DEFAULT '', store_name TEXT NOT NULL, city TEXT NOT NULL DEFAULT '', sales_name TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', total REAL NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS jakarta_receivable_items (id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES jakarta_receivable_invoices(id) ON DELETE CASCADE, item_name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 0, unit_price REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS jakarta_receivable_returns (id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES jakarta_receivable_invoices(id) ON DELETE CASCADE, item_name TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', source_sheet TEXT NOT NULL DEFAULT '', source_row INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS jakarta_receivable_payments (id INTEGER PRIMARY KEY, payment_date TEXT NOT NULL, amount REAL NOT NULL, payment_method TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS jakarta_receivable_allocations (payment_id INTEGER NOT NULL REFERENCES jakarta_receivable_payments(id) ON DELETE CASCADE, invoice_id INTEGER NOT NULL REFERENCES jakarta_receivable_invoices(id) ON DELETE CASCADE, amount REAL NOT NULL, PRIMARY KEY(payment_id,invoice_id));
CREATE TABLE IF NOT EXISTS jakarta_receivable_classifications (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS jakarta_receivable_classification_stores (classification_id INTEGER NOT NULL REFERENCES jakarta_receivable_classifications(id) ON DELETE CASCADE, store_name TEXT NOT NULL COLLATE NOCASE UNIQUE, PRIMARY KEY(classification_id,store_name));
CREATE TABLE IF NOT EXISTS jakarta_receivable_term_settings (id INTEGER PRIMARY KEY CHECK(id=1), default_days INTEGER NOT NULL DEFAULT 120, updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO jakarta_receivable_term_settings(id,default_days) VALUES (1,120);
CREATE TABLE IF NOT EXISTS jakarta_receivable_store_terms (store_name TEXT PRIMARY KEY COLLATE NOCASE, term_days INTEGER NOT NULL, updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS jakarta_receivable_stores (store_name TEXT PRIMARY KEY COLLATE NOCASE, created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_jakarta_receivable_due ON jakarta_receivable_invoices(due_date); 
CREATE TABLE IF NOT EXISTS maturity_settings (id INTEGER PRIMARY KEY CHECK(id=1), reminders_enabled INTEGER NOT NULL DEFAULT 1 CHECK(reminders_enabled IN (0,1)), updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;
INSERT OR IGNORE INTO maturity_settings(id) VALUES (1);`);
db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_settings (
  id INTEGER PRIMARY KEY CHECK(id=1), business_number TEXT NOT NULL DEFAULT '', phone_number_id TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL DEFAULT '', api_version TEXT NOT NULL DEFAULT 'v22.0', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
INSERT OR IGNORE INTO whatsapp_settings (id) VALUES (1);
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, modules TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS whatsapp_classifications (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;`);
// Klasifikasi nomor (mis. Internal, Supplier, Pelanggan) dikelola pengguna master.
// Kolom baru bernilai NULL sehingga kontak lama tetap terbaca tanpa klasifikasi.
const whatsappContactColumns=db.prepare('PRAGMA table_info(whatsapp_contacts)').all().map(column=>column.name);
if(!whatsappContactColumns.includes('classification_id'))db.exec('ALTER TABLE whatsapp_contacts ADD COLUMN classification_id INTEGER');
db.exec(`CREATE TABLE IF NOT EXISTS petty_cash_transactions (
  id INTEGER PRIMARY KEY,
  transaction_date TEXT NOT NULL,
  category TEXT NOT NULL,
  other_category TEXT NOT NULL DEFAULT '',
  person_name TEXT NOT NULL DEFAULT '',
  source_number TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL CHECK(amount>=0),
  source_file TEXT NOT NULL DEFAULT '',
  payment_log_id INTEGER REFERENCES payroll_payment_logs(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_petty_cash_transactions_date ON petty_cash_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_petty_cash_transactions_category ON petty_cash_transactions(category);`);
const pettyCashColumns=db.prepare('PRAGMA table_info(petty_cash_transactions)').all().map(column=>column.name);
if(!pettyCashColumns.includes('payment_log_id'))db.exec('ALTER TABLE petty_cash_transactions ADD COLUMN payment_log_id INTEGER');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_petty_cash_payment_log ON petty_cash_transactions(payment_log_id) WHERE payment_log_id IS NOT NULL');
db.exec(`CREATE TABLE IF NOT EXISTS office_stock_items (
  id INTEGER PRIMARY KEY,
  item_name TEXT NOT NULL UNIQUE,
  default_unit_price REAL NOT NULL DEFAULT 0 CHECK(default_unit_price>=0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS office_stock_transactions (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES office_stock_items(id),
  transaction_date TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK(transaction_type IN ('in','out')),
  quantity REAL NOT NULL CHECK(quantity>0),
  unit_price REAL NOT NULL DEFAULT 0 CHECK(unit_price>=0),
  person_name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_office_stock_transactions_item_date ON office_stock_transactions(item_id,transaction_date,id);
CREATE INDEX IF NOT EXISTS idx_office_stock_transactions_date ON office_stock_transactions(transaction_date,id);`);
const officeStockInitialItems=[['SUPERPELL',7500],['CLING',3500],['SUNLIGHT',16500],['BANTEX',15000],['KERANJANG FILE',15000],['BOLPOIN HITAM',2500],['BOLPOIN MERAH',2500],['BOLPOIN BIRU',2500],['AMPLOP PUTIH',145],['AMPLOP COKLAT',660],['PENGGARIS BESI',4500],['NOTA K2',4000],['KWITANSI',3000],['GLUE STICK',12000],['SPIDOL KECIL',2000],['GUNTING',10500],['TIPE-X KERTAS',9000],['ISI STAPLES KECIL',2000],['ISI STAPLES BESAR',3000],['ISI CUTTER BESAR',9000],['STAPLES',10000],['BATERAI ABC',2000],['KLIP ATOM',0]];
const officeStockExcelTransactions=[['SUPERPELL','2026-10-04','in',1,7500,'Saldo awal'],['SUPERPELL','2026-10-05','in',4,7500,''],['CLING','2026-10-05','in',3,3500,''],['SUNLIGHT','2026-10-05','in',1,16500,''],['SUNLIGHT','2026-10-16','out',1,16500,'Bella'],['BANTEX','2026-10-04','in',4,15000,'Saldo awal'],['BANTEX','2026-10-05','in',12,15000,''],['KERANJANG FILE','2026-10-05','in',10,15000,''],['KERANJANG FILE','2026-10-05','out',1,10500,'Bella'],['BOLPOIN HITAM','2026-10-04','in',2,2500,'Saldo awal'],['BOLPOIN HITAM','2026-10-05','in',36,2500,''],['BOLPOIN HITAM','2026-10-21','out',1,2500,'Aster'],['BOLPOIN MERAH','2026-10-05','in',3,2500,''],['BOLPOIN BIRU','2026-10-05','in',5,2500,''],['BOLPOIN BIRU','2026-10-05','out',1,2500,'Miftah'],['AMPLOP PUTIH','2026-10-05','in',100,145,''],['AMPLOP PUTIH','2026-10-06','out',100,145,'Aster'],['AMPLOP COKLAT','2026-10-05','in',50,660,''],['PENGGARIS BESI','2026-10-05','in',1,4500,''],['PENGGARIS BESI','2026-10-05','out',1,4500,'Miftah'],['NOTA K2','2026-10-05','in',2,4000,''],['KWITANSI','2026-10-05','in',1,3000,''],['GLUE STICK','2026-10-05','in',2,12000,''],['SPIDOL KECIL','2026-10-05','in',3,2000,''],['GUNTING','2026-10-04','in',2,10500,'Saldo awal'],['GUNTING','2026-10-13','out',1,10500,'Resti'],['TIPE-X KERTAS','2026-10-04','in',4,9000,'Saldo awal'],['ISI STAPLES KECIL','2026-10-04','in',15,2000,'Saldo awal'],['ISI STAPLES KECIL','2026-10-13','out',1,2000,'Resti'],['ISI STAPLES BESAR','2026-10-04','in',11,3000,'Saldo awal'],['ISI CUTTER BESAR','2026-10-04','in',9,9000,'Saldo awal'],['ISI CUTTER BESAR','2026-10-13','out',3,9000,'Esty'],['STAPLES','2026-10-04','in',1,10000,'Saldo awal'],['STAPLES','2026-10-13','out',1,10000,'Resti'],['BATERAI ABC','2026-10-04','in',12,2000,'Saldo awal'],['BATERAI ABC','2026-10-20','out',1,2000,'Koko'],['BATERAI ABC','2026-10-21','out',2,2000,'Resti']];
if(!Number(db.prepare('SELECT COUNT(*) AS count FROM office_stock_items').get().count)){const addItem=db.prepare('INSERT INTO office_stock_items (item_name,default_unit_price) VALUES (?,?)');db.exec('BEGIN');try{for(const [name,price] of officeStockInitialItems)addItem.run(name,price);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
if(!db.prepare("SELECT id FROM office_stock_items WHERE item_name='ISI CUTTER BESAR'").get()&&db.prepare("SELECT id FROM office_stock_items WHERE item_name='ISI CUTTER'").get())db.prepare("UPDATE office_stock_items SET item_name='ISI CUTTER BESAR',default_unit_price=9000,updated_at=CURRENT_TIMESTAMP WHERE item_name='ISI CUTTER'").run();
if(!Number(db.prepare("SELECT COUNT(*) AS count FROM office_stock_transactions WHERE notes='Impor kartu stok Excel'").get().count)){const itemIds=new Map(db.prepare('SELECT id,item_name FROM office_stock_items').all().map(item=>[item.item_name,item.id])),addTransaction=db.prepare('INSERT INTO office_stock_transactions (item_id,transaction_date,transaction_type,quantity,unit_price,person_name,notes) VALUES (?,?,?,?,?,?,?)');db.exec('BEGIN');try{db.prepare("DELETE FROM office_stock_transactions WHERE notes='Data awal dari kartu stok kantor'").run();for(const [name,date,type,quantity,price,person] of officeStockExcelTransactions)addTransaction.run(itemIds.get(name),date,type,quantity,price,person,'Impor kartu stok Excel');db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
db.exec(`CREATE TABLE IF NOT EXISTS sinosure_partners (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, short_code TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS sinosure_client_codes (
  id INTEGER PRIMARY KEY, sequence_code TEXT NOT NULL UNIQUE, company_name TEXT NOT NULL, buyer_code TEXT NOT NULL DEFAULT '', brand TEXT NOT NULL DEFAULT '', customer_name TEXT NOT NULL DEFAULT '', insured_company TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_sinosure_client_codes_company ON sinosure_client_codes(company_name);
CREATE TABLE IF NOT EXISTS sinosure_deliveries (
  id INTEGER PRIMARY KEY, client_code_id INTEGER REFERENCES sinosure_client_codes(id), source_key TEXT NOT NULL DEFAULT '', review_status TEXT NOT NULL DEFAULT 'normal' CHECK(review_status IN ('normal','unlinked','review')), manually_edited INTEGER NOT NULL DEFAULT 0, ship_date TEXT NOT NULL DEFAULT '', invoice_number TEXT NOT NULL DEFAULT '', pi_number TEXT NOT NULL DEFAULT '', product_model TEXT NOT NULL DEFAULT '', quantity REAL NOT NULL DEFAULT 0, unit_price_cny REAL NOT NULL DEFAULT 0, unit_price_idr REAL NOT NULL DEFAULT 0, total_cny REAL NOT NULL DEFAULT 0, total_idr REAL NOT NULL DEFAULT 0, payment_terms TEXT NOT NULL DEFAULT '', insured_status TEXT NOT NULL DEFAULT '', remarks TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_sinosure_deliveries_ship_date ON sinosure_deliveries(ship_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sinosure_deliveries_source_key ON sinosure_deliveries(source_key) WHERE source_key<>'';
CREATE TABLE IF NOT EXISTS sinosure_delivery_imports (
  source_path TEXT PRIMARY KEY, file_size INTEGER NOT NULL DEFAULT 0, file_mtime_ms INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, status TEXT NOT NULL DEFAULT 'success', message TEXT NOT NULL DEFAULT '',
  created_count INTEGER NOT NULL DEFAULT 0, updated_count INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE IF NOT EXISTS sinosure_delivery_sync_files (
  source_path TEXT PRIMARY KEY, enabled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS sinosure_wecom_settings (
  id INTEGER PRIMARY KEY CHECK(id=1), corp_id TEXT NOT NULL DEFAULT '', corp_secret TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '', space_id TEXT NOT NULL DEFAULT '', folder_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
INSERT OR IGNORE INTO sinosure_wecom_settings(id) VALUES(1);
CREATE TABLE IF NOT EXISTS sinosure_wecom_sync_files (
  file_id TEXT PRIMARY KEY, file_name TEXT NOT NULL DEFAULT '', enabled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS sinosure_sync_sources (
  category TEXT PRIMARY KEY CHECK(category IN ('deliveries','contract_verification','requirement_documents')),
  source_type TEXT NOT NULL DEFAULT 'local' CHECK(source_type IN ('local','wecom','manual')),
  source_path TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
INSERT OR IGNORE INTO sinosure_sync_sources(category,source_type,source_path) VALUES
  ('deliveries','local',''),('contract_verification','manual',''),('requirement_documents','wecom','');
CREATE TABLE IF NOT EXISTS sinosure_sync_activity (
  id INTEGER PRIMARY KEY, category TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('import','export','review','conflict','failed','retry')),
  source_type TEXT NOT NULL DEFAULT '', file_name TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'success', message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_sinosure_sync_activity_created ON sinosure_sync_activity(created_at DESC);
CREATE TABLE IF NOT EXISTS sinosure_sync_reviews (
  id INTEGER PRIMARY KEY, category TEXT NOT NULL, file_name TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT, resolved_by TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE TABLE IF NOT EXISTS sinosure_document_exports (
  id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES sinosure_documents(id) ON DELETE CASCADE,
  target_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','exported','failed')),
  message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, exported_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_sinosure_document_exports_status ON sinosure_document_exports(status,created_at);
CREATE TABLE IF NOT EXISTS sinosure_contract_wedrive_folders (
  contract_id INTEGER PRIMARY KEY, folder_id TEXT NOT NULL, folder_name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS sinosure_contracts (
  id INTEGER PRIMARY KEY, so_number TEXT NOT NULL UNIQUE, contract_number TEXT NOT NULL DEFAULT '', buyer_name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '',
  partner_id INTEGER REFERENCES sinosure_partners(id), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','complete','revision','cancelled','replaced')),
  relation_type TEXT NOT NULL DEFAULT '' CHECK(relation_type IN ('','addition','replacement')), parent_contract_id INTEGER REFERENCES sinosure_contracts(id),
  tt_same_entity INTEGER NOT NULL DEFAULT 1, notes TEXT NOT NULL DEFAULT '', source_snapshot_id INTEGER, created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sinosure_contract_number ON sinosure_contracts(contract_number) WHERE contract_number<>'';
CREATE INDEX IF NOT EXISTS idx_sinosure_contracts_status ON sinosure_contracts(status,updated_at DESC);
CREATE TABLE IF NOT EXISTS sinosure_contract_lines (
  id INTEGER PRIMARY KEY, contract_id INTEGER NOT NULL REFERENCES sinosure_contracts(id) ON DELETE CASCADE, category TEXT NOT NULL DEFAULT '', factory_model TEXT NOT NULL DEFAULT '', customer_model TEXT NOT NULL DEFAULT '', quantity REAL NOT NULL DEFAULT 0, remaining_quantity REAL NOT NULL DEFAULT 0, unit_price REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE TABLE IF NOT EXISTS sinosure_documents (
  id INTEGER PRIMARY KEY, contract_id INTEGER NOT NULL REFERENCES sinosure_contracts(id) ON DELETE CASCADE, document_type TEXT NOT NULL CHECK(document_type IN ('mou','nib','npwp','tt_proof','power_of_attorney','other')), original_name TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT 'application/octet-stream', file_data BLOB NOT NULL, version INTEGER NOT NULL, uploaded_by TEXT NOT NULL DEFAULT '', uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, revision_note TEXT NOT NULL DEFAULT '', UNIQUE(contract_id,document_type,version)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_sinosure_documents_contract ON sinosure_documents(contract_id,document_type,version DESC);
CREATE TABLE IF NOT EXISTS sinosure_snapshots (
  id INTEGER PRIMARY KEY, file_name TEXT NOT NULL, file_data BLOB NOT NULL, row_count INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, imported_by TEXT NOT NULL DEFAULT '', imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS sinosure_import_conflicts (
  id INTEGER PRIMARY KEY, snapshot_id INTEGER NOT NULL REFERENCES sinosure_snapshots(id) ON DELETE CASCADE, contract_id INTEGER NOT NULL REFERENCES sinosure_contracts(id) ON DELETE CASCADE, incoming_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_sinosure_conflicts_open ON sinosure_import_conflicts(resolved_at,created_at DESC);`);
const sinosureSeedCodes=[
['L001','PT.CAHAYA ANUGERAH PRIMANIAGA','IDN/001728702','FINITO ELSTON','周总','巍星'],['L002','MENARA ANUGERAH SENTOSA INDONESIA','IDN/001865382','中性','MASI','巍星'],['L003','PT ADI PERKASA INDOTAMA','IDN/001728704','FINITO ELSTON','周总','巍星'],['L004','CV.KAWAN SEJAHTERA INDONESIA','IDN/001892959','QUALITY','','巍星'],['L005','ASA MULTIMEDIA','IDN/001907710','JUPITER','','巍星'],['L006','CV PILARINDO SUKSES SEJAHTERA','IDN/001910278','POLAX','','巍星'],['L007','P.T. JAHAYA BERSAUDARA SENTOSA','IDN/977790','PHOENIX','','巍星'],['L008','MULIA AUDIO INDONESIA','IDN/001930248','','','巍星'],['L009','SIGMA BERJAYA','IDN/001930106','','','巍星'],['L010','ANEKA TEKNIK SOLO','IDN/001930295','','','巍星'],['L011','SEMANGAT ALAM JABAR','IDN/001930067','','','巍星'],['L012','VERDO','','','',''],['L013','GENTA HARMONI','IDN/001947148','','','巍星'],['L014','CV.MITRA PERKASA ELEKTRIK','IDN/001947153','','','巍星'],['L015','CV.ELECTRA','IDN/001947155','','','巍星'],['L016','PT.TRI JAYA MANDIRI BORNEO','IDN/001947142','','','巍星'],['L017','PT PUTRA MAHKOTA INDONESIA','IDN/001947143','','','巍星'],['L018','C.V. MITRA ELEKTRIK BERSAMA','IDN/831888','','','巍星'],['L019','NOGOSOSTRO BAJINTEN','IDN/001763078','','','巍星'],['L020','PT.SANUTAMA BUMI ARTO','已提交待审批','','','巍星']
];
const insertSinosureSeed=db.prepare('INSERT OR IGNORE INTO sinosure_client_codes(sequence_code,company_name,buyer_code,brand,customer_name,insured_company) VALUES (?,?,?,?,?,?)');for(const row of sinosureSeedCodes)insertSinosureSeed.run(...row);
const sinosureDeliveryColumns=db.prepare('PRAGMA table_info(sinosure_deliveries)').all().map(column=>column.name);
if(!sinosureDeliveryColumns.includes('source_key'))db.exec("ALTER TABLE sinosure_deliveries ADD COLUMN source_key TEXT NOT NULL DEFAULT ''");
if(!sinosureDeliveryColumns.includes('review_status'))db.exec("ALTER TABLE sinosure_deliveries ADD COLUMN review_status TEXT NOT NULL DEFAULT 'normal'");
if(!sinosureDeliveryColumns.includes('manually_edited'))db.exec("ALTER TABLE sinosure_deliveries ADD COLUMN manually_edited INTEGER NOT NULL DEFAULT 0");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sinosure_deliveries_source_key ON sinosure_deliveries(source_key) WHERE source_key<>''");
db.exec(`CREATE TABLE IF NOT EXISTS accounting_accounts (
  account_code TEXT PRIMARY KEY, account_name TEXT NOT NULL, level_name TEXT NOT NULL DEFAULT '', parent_code TEXT NOT NULL DEFAULT '',
  account_status TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', account_type TEXT NOT NULL DEFAULT '', account_subtype TEXT NOT NULL DEFAULT '',
  is_group INTEGER NOT NULL DEFAULT 0, counter_account_code TEXT NOT NULL DEFAULT '', legacy_user_id TEXT NOT NULL DEFAULT '', legacy_date TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual', display_opening_amount REAL NOT NULL DEFAULT 0, display_opening_side TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_journal_entries (
  id INTEGER PRIMARY KEY, voucher_number TEXT NOT NULL UNIQUE, transaction_date TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0, transaction_type TEXT NOT NULL DEFAULT '', legacy_user_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('legacy','manual')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_journals_date ON accounting_journal_entries(transaction_date);
CREATE INDEX IF NOT EXISTS idx_accounting_journals_date_id ON accounting_journal_entries(transaction_date,id);
CREATE TABLE IF NOT EXISTS accounting_journal_lines (
  id INTEGER PRIMARY KEY, journal_id INTEGER NOT NULL REFERENCES accounting_journal_entries(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL REFERENCES accounting_accounts(account_code), description TEXT NOT NULL DEFAULT '', debit REAL NOT NULL DEFAULT 0 CHECK(debit>=0),
  credit REAL NOT NULL DEFAULT 0 CHECK(credit>=0), legacy_line_id INTEGER UNIQUE, legacy_timestamp TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK((debit=0) != (credit=0))
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_lines_journal ON accounting_journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_accounting_lines_account ON accounting_journal_lines(account_code);
CREATE INDEX IF NOT EXISTS idx_accounting_lines_account_journal ON accounting_journal_lines(account_code,journal_id,id);
CREATE TABLE IF NOT EXISTS accounting_account_audit (
  id INTEGER PRIMARY KEY, account_code TEXT NOT NULL REFERENCES accounting_accounts(account_code),
  changed_by TEXT NOT NULL DEFAULT '', changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  before_json TEXT NOT NULL, after_json TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_account_audit_code ON accounting_account_audit(account_code, id DESC);
CREATE TABLE IF NOT EXISTS accounting_legacy_items (
  item_code TEXT PRIMARY KEY, item_name TEXT NOT NULL DEFAULT '', item_type TEXT NOT NULL DEFAULT '', debit_sales_code TEXT NOT NULL DEFAULT '', credit_sales_code TEXT NOT NULL DEFAULT '',
  debit_purchase_code TEXT NOT NULL DEFAULT '', credit_purchase_code TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_legacy_suppliers (
  supplier_code TEXT PRIMARY KEY, supplier_name TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_items (
  item_code TEXT PRIMARY KEY, item_name TEXT NOT NULL, item_type TEXT NOT NULL DEFAULT '', debit_sales_code TEXT NOT NULL DEFAULT '', credit_sales_code TEXT NOT NULL DEFAULT '',
  debit_purchase_code TEXT NOT NULL DEFAULT '', credit_purchase_code TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'manual' CHECK(source='manual'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_suppliers (
  supplier_code TEXT PRIMARY KEY, supplier_name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'manual' CHECK(source='manual'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
-- Pemetaan rekening hutang dipisahkan dari master supplier historis. Dengan
-- demikian rekening lawan PIB dapat diperbaiki tanpa mengubah data sumber lama.
CREATE TABLE IF NOT EXISTS accounting_supplier_payable_mappings (
  supplier_code TEXT PRIMARY KEY, payable_account_code TEXT NOT NULL REFERENCES accounting_accounts(account_code),
  updated_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_supplier_payable_account ON accounting_supplier_payable_mappings(payable_account_code);
CREATE TABLE IF NOT EXISTS accounting_legacy_inventory_transactions (
  voucher_number TEXT PRIMARY KEY, bc23 TEXT NOT NULL DEFAULT '', container_number TEXT NOT NULL DEFAULT '', transaction_date TEXT NOT NULL DEFAULT '',
  supplier_code TEXT NOT NULL DEFAULT '', exchange_type TEXT NOT NULL DEFAULT '', exchange_value REAL NOT NULL DEFAULT 0, import_duty REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0, total_purchase REAL NOT NULL DEFAULT 0, transaction_type INTEGER, description TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_legacy_inventory_lines (
  id INTEGER PRIMARY KEY, legacy_line_id INTEGER NOT NULL DEFAULT 0, voucher_number TEXT NOT NULL, item_code TEXT NOT NULL DEFAULT '', quantity REAL NOT NULL DEFAULT 0, unit_price REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0, exchange_type TEXT NOT NULL DEFAULT '', exchange_value REAL NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_import_audits (
  id INTEGER PRIMARY KEY, source_name TEXT NOT NULL UNIQUE, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, account_count INTEGER NOT NULL DEFAULT 0,
  journal_count INTEGER NOT NULL DEFAULT 0, journal_line_count INTEGER NOT NULL DEFAULT 0, total_debit REAL NOT NULL DEFAULT 0, total_credit REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_inventory_documents (
  id INTEGER PRIMARY KEY, document_number TEXT NOT NULL UNIQUE, transaction_date TEXT NOT NULL,
  transaction_kind TEXT NOT NULL CHECK(transaction_kind IN ('purchase','sale','adjustment_in','adjustment_out')),
  supplier_code TEXT NOT NULL DEFAULT '', payment_mode TEXT NOT NULL DEFAULT '', counter_account_code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '', reference_number TEXT NOT NULL DEFAULT '', journal_id INTEGER NOT NULL UNIQUE REFERENCES accounting_journal_entries(id),
  created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_inventory_documents_date ON accounting_inventory_documents(transaction_date,id);
CREATE TABLE IF NOT EXISTS accounting_inventory_document_lines (
  id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES accounting_inventory_documents(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL REFERENCES accounting_items(item_code), quantity REAL NOT NULL CHECK(quantity>0), unit_price REAL NOT NULL DEFAULT 0 CHECK(unit_price>=0),
  total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount>=0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_inventory_document_lines_item ON accounting_inventory_document_lines(item_code,document_id);
CREATE TABLE IF NOT EXISTS accounting_inventory_fifo_batches (
  id INTEGER PRIMARY KEY, item_code TEXT NOT NULL REFERENCES accounting_items(item_code), receipt_line_id INTEGER NOT NULL REFERENCES accounting_inventory_document_lines(id),
  receipt_date TEXT NOT NULL, original_quantity REAL NOT NULL CHECK(original_quantity>0), remaining_quantity REAL NOT NULL CHECK(remaining_quantity>=0),
  unit_cost REAL NOT NULL CHECK(unit_cost>=0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_inventory_fifo_batches_available ON accounting_inventory_fifo_batches(item_code,receipt_date,id);
CREATE TABLE IF NOT EXISTS accounting_inventory_fifo_allocations (
  id INTEGER PRIMARY KEY, issue_line_id INTEGER NOT NULL REFERENCES accounting_inventory_document_lines(id), batch_id INTEGER NOT NULL REFERENCES accounting_inventory_fifo_batches(id),
  quantity REAL NOT NULL CHECK(quantity>0), unit_cost REAL NOT NULL CHECK(unit_cost>=0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_invoice_profiles (
  id INTEGER PRIMARY KEY CHECK(id=1), legal_name TEXT NOT NULL DEFAULT '', legal_address TEXT NOT NULL DEFAULT '', tax_id TEXT NOT NULL DEFAULT '',
  signatory_name TEXT NOT NULL DEFAULT '', sales_account_code TEXT NOT NULL DEFAULT '04.07.000.000.000.0000', vat_payable_account_code TEXT NOT NULL DEFAULT '02.05.001.000.000.0000',
  vat_rate REAL NOT NULL DEFAULT 0.11, payment_instructions TEXT NOT NULL DEFAULT '', default_due_days INTEGER NOT NULL DEFAULT 30,
  updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_invoice_customers (
  id INTEGER PRIMARY KEY, customer_name TEXT NOT NULL, customer_address TEXT NOT NULL DEFAULT '', tax_id TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  receivable_account_code TEXT NOT NULL REFERENCES accounting_accounts(account_code), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(customer_name)
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_invoices (
  id INTEGER PRIMARY KEY, invoice_number TEXT NOT NULL UNIQUE, tax_invoice_number TEXT NOT NULL DEFAULT '', transaction_date TEXT NOT NULL, due_date TEXT NOT NULL DEFAULT '',
  customer_id INTEGER NOT NULL REFERENCES accounting_invoice_customers(id), receivable_account_code TEXT NOT NULL REFERENCES accounting_accounts(account_code),
  journal_id INTEGER UNIQUE REFERENCES accounting_journal_entries(id), inventory_document_id INTEGER UNIQUE REFERENCES accounting_inventory_documents(id),
  dpp_amount REAL NOT NULL DEFAULT 0 CHECK(dpp_amount>=0), vat_amount REAL NOT NULL DEFAULT 0 CHECK(vat_amount>=0), total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount>=0),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('historical','new')), status TEXT NOT NULL CHECK(status IN ('historical','draft','posted')),
  notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_invoices_date ON accounting_invoices(transaction_date,id);
CREATE INDEX IF NOT EXISTS idx_accounting_invoices_customer ON accounting_invoices(customer_id,transaction_date);
CREATE TABLE IF NOT EXISTS accounting_invoice_lines (
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES accounting_invoices(id) ON DELETE CASCADE, item_code TEXT NOT NULL,
  item_name TEXT NOT NULL DEFAULT '', quantity REAL NOT NULL CHECK(quantity>0), unit_price REAL NOT NULL DEFAULT 0 CHECK(unit_price>=0),
  gross_amount REAL NOT NULL DEFAULT 0 CHECK(gross_amount>=0), discount_amount REAL NOT NULL DEFAULT 0 CHECK(discount_amount>=0),
  dpp_amount REAL NOT NULL DEFAULT 0 CHECK(dpp_amount>=0), vat_amount REAL NOT NULL DEFAULT 0 CHECK(vat_amount>=0), total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount>=0)
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_pib_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  purchase_account_code TEXT NOT NULL DEFAULT '05.03.001.000.000.0000',
  import_purchase_account_code TEXT NOT NULL DEFAULT '05.03.001.002.000.0000',
  customs_duty_account_code TEXT NOT NULL DEFAULT '05.01.017.000.000.0000',
  vat_account_code TEXT NOT NULL DEFAULT '02.05.001.000.000.0000',
  pph22_account_code TEXT NOT NULL DEFAULT '01.01.004.001.000.000.0000',
  payment_account_code TEXT NOT NULL DEFAULT '01.01.002.001.000.0000',
  freight_debit_account_code TEXT NOT NULL DEFAULT '05.02.002.000.000.0000',
  freight_credit_account_code TEXT NOT NULL DEFAULT '02.18.000.000.000.0000',
  updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_pib_transactions (
  id INTEGER PRIMARY KEY, aju_number TEXT NOT NULL UNIQUE, invoice_number TEXT NOT NULL DEFAULT '', transaction_date TEXT NOT NULL,
  supplier_code TEXT NOT NULL DEFAULT '', currency_code TEXT NOT NULL DEFAULT 'CNY', exchange_rate REAL NOT NULL DEFAULT 0,
  customs_duty_rate REAL NOT NULL DEFAULT 0, ppnbm_rate REAL NOT NULL DEFAULT 0, vat_rate REAL NOT NULL DEFAULT 0,
  pph22_rate REAL NOT NULL DEFAULT 0, customs_duty_amount REAL NOT NULL DEFAULT 0, ppnbm_amount REAL NOT NULL DEFAULT 0,
  vat_amount REAL NOT NULL DEFAULT 0, pph22_amount REAL NOT NULL DEFAULT 0, freight_amount REAL NOT NULL DEFAULT 0,
  purchase_account_code TEXT NOT NULL, import_purchase_account_code TEXT NOT NULL DEFAULT '05.03.001.002.000.0000', customs_duty_account_code TEXT NOT NULL, vat_account_code TEXT NOT NULL,
  pph22_account_code TEXT NOT NULL, payment_account_code TEXT NOT NULL, freight_debit_account_code TEXT NOT NULL,
  freight_credit_account_code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted','cancelled')),
  brm_document_id INTEGER REFERENCES accounting_inventory_documents(id), brm_journal_id INTEGER REFERENCES accounting_journal_entries(id),
  pib_journal_id INTEGER REFERENCES accounting_journal_entries(id), freight_journal_id INTEGER REFERENCES accounting_journal_entries(id),
  supplier_payable_account_code TEXT NOT NULL DEFAULT '', invoice_journal_id INTEGER REFERENCES accounting_journal_entries(id),
  created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_pib_transactions_date ON accounting_pib_transactions(transaction_date,id);
CREATE TABLE IF NOT EXISTS accounting_pib_lines (
  id INTEGER PRIMARY KEY, pib_id INTEGER NOT NULL REFERENCES accounting_pib_transactions(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL, item_name TEXT NOT NULL DEFAULT '', quantity REAL NOT NULL CHECK(quantity>0), unit_name TEXT NOT NULL DEFAULT '',
  currency_code TEXT NOT NULL DEFAULT 'CNY', unit_price_foreign REAL NOT NULL DEFAULT 0, exchange_rate REAL NOT NULL DEFAULT 0,
  foreign_amount REAL NOT NULL DEFAULT 0, import_amount REAL NOT NULL DEFAULT 0, customs_duty_rate REAL NOT NULL DEFAULT 0,
  customs_duty_amount REAL NOT NULL DEFAULT 0, ppnbm_rate REAL NOT NULL DEFAULT 0, ppnbm_amount REAL NOT NULL DEFAULT 0,
  landed_amount REAL NOT NULL DEFAULT 0, landed_unit_cost REAL NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_pib_lines_transaction ON accounting_pib_lines(pib_id,id);
CREATE TABLE IF NOT EXISTS accounting_year_closings (
  closing_year INTEGER PRIMARY KEY CHECK(closing_year>=2000), closing_journal_id INTEGER REFERENCES accounting_journal_entries(id),
  opening_journal_id INTEGER REFERENCES accounting_journal_entries(id), snapshot_json TEXT NOT NULL DEFAULT '{}',
  closed_by TEXT NOT NULL DEFAULT '', closed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reclosed_at TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_year_closings_closed_at ON accounting_year_closings(closed_at DESC);`);
db.exec(`CREATE TABLE IF NOT EXISTS accounting_annual_report_profile (
  id INTEGER PRIMARY KEY CHECK(id=1), legal_entity_name TEXT NOT NULL DEFAULT '', report_city TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_annual_report_year_settings (
  report_year INTEGER PRIMARY KEY CHECK(report_year>=2000), narrative_intro TEXT NOT NULL DEFAULT '', tax_note TEXT NOT NULL DEFAULT '',
  tax_facility_turnover REAL, tax_facility_rate REAL, tax_rate REAL, issued_city TEXT NOT NULL DEFAULT '', issued_date TEXT NOT NULL DEFAULT '',
  signatory_name TEXT NOT NULL DEFAULT '', signatory_title TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_annual_account_metadata (
  account_code TEXT PRIMARY KEY, note_group TEXT NOT NULL DEFAULT '', bank_account_number TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;`);
db.exec(`CREATE TABLE IF NOT EXISTS accounting_report_mappings (
  report_kind TEXT NOT NULL CHECK(report_kind IN ('income','balance','hpp')),
  account_code TEXT NOT NULL REFERENCES accounting_accounts(account_code) ON DELETE CASCADE,
  section_name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(report_kind,account_code)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_report_mappings_layout ON accounting_report_mappings(report_kind,enabled,section_name,sort_order);`);
db.exec(`CREATE TABLE IF NOT EXISTS accounting_report_special_lines (
  report_kind TEXT NOT NULL CHECK(report_kind IN ('income','balance')),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('hpp_report','period_profit')),
  section_name TEXT NOT NULL, label TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 99999,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(report_kind,source_kind)
) STRICT;`);
// SQLite tidak dapat mengubah CHECK langsung. Migrasi ini hanya memperluas
// jenis pemetaan, dan mempertahankan seluruh pemetaan Neraca/Laba Rugi lama.
const accountingReportMappingSql=String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='accounting_report_mappings'").get()?.sql||'');
if(!accountingReportMappingSql.includes("'hpp'")){db.exec(`BEGIN IMMEDIATE;
  CREATE TABLE accounting_report_mappings_next (
    report_kind TEXT NOT NULL CHECK(report_kind IN ('income','balance','hpp')),
    account_code TEXT NOT NULL REFERENCES accounting_accounts(account_code) ON DELETE CASCADE,
    section_name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(report_kind,account_code)
  ) STRICT;
  INSERT INTO accounting_report_mappings_next SELECT * FROM accounting_report_mappings;
  DROP TABLE accounting_report_mappings;
  ALTER TABLE accounting_report_mappings_next RENAME TO accounting_report_mappings;
  CREATE INDEX IF NOT EXISTS idx_accounting_report_mappings_layout ON accounting_report_mappings(report_kind,enabled,section_name,sort_order);
COMMIT;`);}
db.exec(`CREATE INDEX IF NOT EXISTS idx_accounting_legacy_inventory_transactions_date ON accounting_legacy_inventory_transactions(transaction_date,voucher_number);
CREATE INDEX IF NOT EXISTS idx_accounting_legacy_inventory_lines_voucher_item ON accounting_legacy_inventory_lines(voucher_number,item_code);`);
const accountingInvoiceColumnNames=db.prepare('PRAGMA table_info(accounting_invoices)').all().map(column=>column.name);
if(!accountingInvoiceColumnNames.includes('legacy_inventory_voucher'))db.exec("ALTER TABLE accounting_invoices ADD COLUMN legacy_inventory_voucher TEXT NOT NULL DEFAULT ''");
if(!accountingInvoiceColumnNames.includes('due_date'))db.exec("ALTER TABLE accounting_invoices ADD COLUMN due_date TEXT NOT NULL DEFAULT ''");
const accountingInvoiceProfileColumnNames=db.prepare('PRAGMA table_info(accounting_invoice_profiles)').all().map(column=>column.name);
if(!accountingInvoiceProfileColumnNames.includes('payment_instructions'))db.exec("ALTER TABLE accounting_invoice_profiles ADD COLUMN payment_instructions TEXT NOT NULL DEFAULT ''");
if(!accountingInvoiceProfileColumnNames.includes('default_due_days'))db.exec('ALTER TABLE accounting_invoice_profiles ADD COLUMN default_due_days INTEGER NOT NULL DEFAULT 30');
const accountingPibColumnNames=db.prepare('PRAGMA table_info(accounting_pib_transactions)').all().map(column=>column.name);
const accountingPibSettingsColumnNames=db.prepare('PRAGMA table_info(accounting_pib_settings)').all().map(column=>column.name);
if(!accountingPibSettingsColumnNames.includes('import_purchase_account_code'))db.exec("ALTER TABLE accounting_pib_settings ADD COLUMN import_purchase_account_code TEXT NOT NULL DEFAULT '05.03.001.002.000.0000'");
if(!accountingPibColumnNames.includes('import_purchase_account_code'))db.exec("ALTER TABLE accounting_pib_transactions ADD COLUMN import_purchase_account_code TEXT NOT NULL DEFAULT '05.03.001.002.000.0000'");
if(!accountingPibColumnNames.includes('supplier_payable_account_code'))db.exec("ALTER TABLE accounting_pib_transactions ADD COLUMN supplier_payable_account_code TEXT NOT NULL DEFAULT ''");
if(!accountingPibColumnNames.includes('invoice_journal_id'))db.exec('ALTER TABLE accounting_pib_transactions ADD COLUMN invoice_journal_id INTEGER REFERENCES accounting_journal_entries(id)');
// Isi hanya pemetaan yang pasti: nama supplier sama persis dengan rekening
// Hutang posting. Pemetaan yang tidak pasti tetap meminta pilihan pengguna.
db.exec(`INSERT OR IGNORE INTO accounting_supplier_payable_mappings(supplier_code,payable_account_code,updated_by)
  SELECT s.supplier_code,(
    SELECT a.account_code FROM accounting_accounts a
    WHERE a.is_group=0 AND a.account_code LIKE '02.%'
      AND lower(trim(a.account_name))=lower(trim(s.supplier_name))
    ORDER BY a.account_code LIMIT 1
  ),'migrasi otomatis'
  FROM (
    SELECT supplier_code,supplier_name FROM accounting_legacy_suppliers
    UNION ALL
    SELECT supplier_code,supplier_name FROM accounting_suppliers
      WHERE supplier_code NOT IN (SELECT supplier_code FROM accounting_legacy_suppliers)
  ) s
  WHERE EXISTS(SELECT 1 FROM accounting_accounts a WHERE a.is_group=0 AND a.account_code LIKE '02.%' AND lower(trim(a.account_name))=lower(trim(s.supplier_name)));`);
const accountingInventoryDocumentColumns=db.prepare('PRAGMA table_info(accounting_inventory_documents)').all().map(column=>column.name);
if(!accountingInventoryDocumentColumns.includes('invoice_id'))db.exec('ALTER TABLE accounting_inventory_documents ADD COLUMN invoice_id INTEGER REFERENCES accounting_invoices(id)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_inventory_documents_invoice ON accounting_inventory_documents(invoice_id) WHERE invoice_id IS NOT NULL');
const accountingAccountColumnNames=db.prepare('PRAGMA table_info(accounting_accounts)').all().map(column=>column.name);
if(!accountingAccountColumnNames.includes('display_opening_amount'))db.exec('ALTER TABLE accounting_accounts ADD COLUMN display_opening_amount REAL NOT NULL DEFAULT 0');
if(!accountingAccountColumnNames.includes('display_opening_side'))db.exec("ALTER TABLE accounting_accounts ADD COLUMN display_opening_side TEXT NOT NULL DEFAULT ''");
db.exec(`CREATE TABLE IF NOT EXISTS accounting_year_close_requests (
  id INTEGER PRIMARY KEY, closing_year INTEGER NOT NULL UNIQUE CHECK(closing_year>=2000), status TEXT NOT NULL CHECK(status IN ('submitted','returned','approved')),
  submitted_by TEXT NOT NULL DEFAULT '', submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  audit_reason TEXT NOT NULL DEFAULT '', audited_by TEXT NOT NULL DEFAULT '', audited_at TEXT NOT NULL DEFAULT '',
  snapshot_json TEXT NOT NULL DEFAULT '{}'
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_year_close_request_lines (
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES accounting_year_close_requests(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL, default_balance REAL NOT NULL, revised_balance REAL, final_balance REAL NOT NULL,
  UNIQUE(request_id,account_code)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_year_close_request_lines_request ON accounting_year_close_request_lines(request_id);`);
db.exec(`CREATE TABLE IF NOT EXISTS accounting_journal_year_locks (
  journal_year INTEGER PRIMARY KEY CHECK(journal_year>=2000), locked_by TEXT NOT NULL DEFAULT '', locked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS accounting_journal_archives (
  id INTEGER PRIMARY KEY, original_journal_id INTEGER NOT NULL, journal_json TEXT NOT NULL, deleted_by TEXT NOT NULL DEFAULT '', deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  restored_by TEXT NOT NULL DEFAULT '', restored_at TEXT NOT NULL DEFAULT '', restored_journal_id INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS idx_accounting_journal_archives_deleted_at ON accounting_journal_archives(deleted_at DESC);`);
// Paket pemulihan Accounting Lite dapat memasang salinan database Accounting
// yang sudah diverifikasi. Penanda hanya dibuat oleh paket pemulihan eksplisit,
// sehingga instalasi/boot biasa tidak akan pernah menghapus data Accounting.
const ACCOUNTING_LOCAL_REINSTALL_MARKER='accounting_local_reinstall_v160';
function reinstallAccountingFromLocalPayload(){
  let requested='';
  try{requested=String(db.prepare("SELECT value FROM settings WHERE key=?").get(ACCOUNTING_LOCAL_REINSTALL_MARKER)?.value||'');}catch{return;}
  if(requested!=='pending')return;
  const sourcePath=join(ROOT,'modules','accounting_lite','reinstall','accounting-lite-local.db');
  if(!existsSync(sourcePath))throw new Error('Database payload Accounting Lite tidak ditemukan. Pemulihan dibatalkan.');
  const source=new DatabaseSync(sourcePath);
  try{
    const sourceIntegrity=source.prepare('PRAGMA integrity_check').all().map(row=>String(Object.values(row)[0]||'').toLowerCase());
    if(sourceIntegrity.some(value=>value!=='ok'))throw new Error('Database payload Accounting Lite tidak lolos pemeriksaan integritas.');
    const sourceObjects=source.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name LIKE 'accounting_%' AND sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name").all();
    const sourceTables=sourceObjects.filter(item=>item.type==='table');
    if(!sourceTables.length)throw new Error('Database payload tidak memiliki tabel Accounting Lite.');
    if(sourceTables.some(item=>!/^accounting_[a-z0-9_]+$/i.test(String(item.name))))throw new Error('Nama tabel Accounting pada payload tidak valid.');
    const currentTables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'accounting_%' ORDER BY name").all().map(item=>String(item.name));
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
    try{
      for(const name of currentTables)db.exec(`DROP TABLE IF EXISTS "${name}"`);
      for(const item of sourceTables)db.exec(String(item.sql));
      for(const table of sourceTables){
        const name=String(table.name),columns=source.prepare(`PRAGMA table_info("${name}")`).all().map(column=>String(column.name));
        if(!columns.length)continue;
        const quote=value=>`"${value.replace(/"/g,'""')}"`;
        const insert=db.prepare(`INSERT INTO ${quote(name)} (${columns.map(quote).join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
        const rows=source.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(name)}`).all();
        for(const row of rows)insert.run(...columns.map(column=>row[column]));
      }
      for(const item of sourceObjects.filter(entry=>entry.type!=='table'))db.exec(String(item.sql));
      const violations=db.prepare('PRAGMA foreign_key_check').all();
      if(violations.length)throw new Error(`Relasi Accounting hasil pemulihan tidak valid (${violations.length} pelanggaran).`);
      db.exec('COMMIT;');
    }catch(error){try{db.exec('ROLLBACK;')}catch{}throw error;}finally{db.exec('PRAGMA foreign_keys=ON;');}
    db.prepare('DELETE FROM settings WHERE key=?').run(ACCOUNTING_LOCAL_REINSTALL_MARKER);
  }finally{source.close();}
}
reinstallAccountingFromLocalPayload();
db.exec(`CREATE TABLE IF NOT EXISTS asset_source_lines (
  id INTEGER PRIMARY KEY, journal_id INTEGER NOT NULL, journal_line_id INTEGER NOT NULL UNIQUE,
  transaction_date TEXT NOT NULL, voucher_number TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  debit_amount REAL NOT NULL CHECK(debit_amount>=0), source_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unallocated'
    CHECK(status IN ('unallocated','partial','allocated','review','not_asset')),
  not_asset_reason TEXT NOT NULL DEFAULT '', synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY, asset_code TEXT NOT NULL UNIQUE, source_kind TEXT NOT NULL CHECK(source_kind IN ('accounting','manual')),
  asset_class TEXT NOT NULL, asset_name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1 CHECK(quantity>0),
  acquisition_date TEXT, in_service_date TEXT, acquisition_cost REAL, condition TEXT NOT NULL DEFAULT 'good',
  lifecycle_status TEXT NOT NULL DEFAULT 'stored' CHECK(lifecycle_status IN ('active','stored','in_repair','lost','disposed','sold')),
  current_user TEXT NOT NULL DEFAULT '', current_location TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE TABLE IF NOT EXISTS asset_allocations (
  id INTEGER PRIMARY KEY, source_line_id INTEGER NOT NULL REFERENCES asset_source_lines(id), asset_id INTEGER NOT NULL REFERENCES assets(id),
  allocated_amount REAL NOT NULL CHECK(allocated_amount>=0), allocated_quantity REAL NOT NULL DEFAULT 1 CHECK(allocated_quantity>0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')), notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, voided_by TEXT NOT NULL DEFAULT '', voided_at TEXT, void_reason TEXT NOT NULL DEFAULT '',
  UNIQUE(source_line_id,asset_id,status)
) STRICT;
CREATE TABLE IF NOT EXISTS asset_audit_log (
  id INTEGER PRIMARY KEY, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER, detail_json TEXT NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_asset_source_status ON asset_source_lines(status,transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(lifecycle_status,asset_class);
CREATE INDEX IF NOT EXISTS idx_asset_alloc_source ON asset_allocations(source_line_id,status);`);
// Versi awal modul pernah menandai journal_id sebagai UNIQUE. Satu jurnal dapat
// memiliki beberapa baris aset, sehingga aturan tersebut harus dimigrasikan
// tanpa menghapus antrian/alokasi yang sudah dicatat pengguna.
const assetSourceSchema=String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='asset_source_lines'").get()?.sql||'');
if(/journal_id\s+INTEGER\s+NOT\s+NULL\s+UNIQUE/i.test(assetSourceSchema)||/UNIQUE\s*\(\s*journal_id\s*\)/i.test(assetSourceSchema)){
  db.exec(`PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;
CREATE TABLE asset_source_lines_migrated (
  id INTEGER PRIMARY KEY, journal_id INTEGER NOT NULL, journal_line_id INTEGER NOT NULL UNIQUE,
  transaction_date TEXT NOT NULL, voucher_number TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  debit_amount REAL NOT NULL CHECK(debit_amount>=0), source_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unallocated'
    CHECK(status IN ('unallocated','partial','allocated','review','not_asset')),
  not_asset_reason TEXT NOT NULL DEFAULT '', synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
INSERT INTO asset_source_lines_migrated SELECT id,journal_id,journal_line_id,transaction_date,voucher_number,description,debit_amount,source_hash,status,not_asset_reason,synced_at,created_at,updated_at FROM asset_source_lines;
CREATE TABLE asset_allocations_migrated (
  id INTEGER PRIMARY KEY, source_line_id INTEGER NOT NULL REFERENCES asset_source_lines(id), asset_id INTEGER NOT NULL REFERENCES assets(id),
  allocated_amount REAL NOT NULL CHECK(allocated_amount>=0), allocated_quantity REAL NOT NULL DEFAULT 1 CHECK(allocated_quantity>0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')), notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, voided_by TEXT NOT NULL DEFAULT '', voided_at TEXT, void_reason TEXT NOT NULL DEFAULT '',
  UNIQUE(source_line_id,asset_id,status)
) STRICT;
INSERT INTO asset_allocations_migrated SELECT id,source_line_id,asset_id,allocated_amount,allocated_quantity,status,notes,created_by,created_at,voided_by,voided_at,void_reason FROM asset_allocations;
DROP TABLE asset_allocations;
DROP TABLE asset_source_lines;
ALTER TABLE asset_source_lines_migrated RENAME TO asset_source_lines;
ALTER TABLE asset_allocations_migrated RENAME TO asset_allocations;
CREATE INDEX idx_asset_source_status ON asset_source_lines(status,transaction_date DESC);
CREATE INDEX idx_asset_alloc_source ON asset_allocations(source_line_id,status);
COMMIT;
PRAGMA foreign_keys=ON;`);
}
const assetColumns=db.prepare('PRAGMA table_info(assets)').all().map(column=>column.name);
for(const [name,definition] of Object.entries({brand:"TEXT NOT NULL DEFAULT ''",model:"TEXT NOT NULL DEFAULT ''",serial_number:"TEXT NOT NULL DEFAULT ''",supplier_reference:"TEXT NOT NULL DEFAULT ''",useful_life_months:'INTEGER'})){
  if(!assetColumns.includes(name))db.exec(`ALTER TABLE assets ADD COLUMN ${name} ${definition}`);
}
const assetOperationalColumns=db.prepare('PRAGMA table_info(assets)').all().map(column=>column.name);
for(const [name,definition] of Object.entries({damage_state:"TEXT NOT NULL DEFAULT ''",damage_reason:"TEXT NOT NULL DEFAULT ''",damage_reported_at:'TEXT',replacement_asset_id:'INTEGER'})){
  if(!assetOperationalColumns.includes(name))db.exec(`ALTER TABLE assets ADD COLUMN ${name} ${definition}`);
}
db.exec(`CREATE TABLE IF NOT EXISTS asset_transfer_history (
  id INTEGER PRIMARY KEY, asset_id INTEGER NOT NULL REFERENCES assets(id), transfer_date TEXT NOT NULL,
  previous_user TEXT NOT NULL DEFAULT '', new_user TEXT NOT NULL DEFAULT '', previous_location TEXT NOT NULL DEFAULT '', new_location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_asset_transfer_history_asset ON asset_transfer_history(asset_id,transfer_date DESC);`);
const accountingLegacyInventoryLineColumns=db.prepare('PRAGMA table_info(accounting_legacy_inventory_lines)').all().map(column=>column.name);
if(!accountingLegacyInventoryLineColumns.includes('legacy_line_id'))db.exec('ALTER TABLE accounting_legacy_inventory_lines ADD COLUMN legacy_line_id INTEGER NOT NULL DEFAULT 0');
db.exec(`CREATE TABLE IF NOT EXISTS online_shop_reports (
  id INTEGER PRIMARY KEY,
  input_date TEXT NOT NULL,
  store_name TEXT NOT NULL,
  product_name TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  issue_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_online_shop_reports_filter ON online_shop_reports(input_date,store_name,product_name);
CREATE TABLE IF NOT EXISTS online_shop_report_media (
  id INTEGER PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES online_shop_reports(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('image','video')),
  mime_type TEXT NOT NULL,
  media_data BLOB NOT NULL,
  original_size INTEGER NOT NULL DEFAULT 0,
  stored_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_online_shop_report_media_report ON online_shop_report_media(report_id);`);
db.exec(`CREATE TABLE IF NOT EXISTS online_shop_scan_resi (
  id INTEGER PRIMARY KEY,
  tracking_number TEXT NOT NULL COLLATE NOCASE UNIQUE,
  scan_date TEXT NOT NULL,
  shipping_status TEXT NOT NULL DEFAULT 'Menunggu sinkronisasi',
  completed_date TEXT,
  source_sheet TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_online_shop_scan_resi_filter ON online_shop_scan_resi(scan_date,shipping_status);
CREATE TABLE IF NOT EXISTS online_shop_scan_imports (
  id INTEGER PRIMARY KEY,
  original_name TEXT NOT NULL,
  file_data BLOB NOT NULL,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;`);
db.exec(`CREATE TABLE IF NOT EXISTS module_installations (
  id INTEGER PRIMARY KEY, module_id TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL,
  checksum TEXT NOT NULL DEFAULT '', snapshot_path TEXT NOT NULL DEFAULT '', manifest_json TEXT NOT NULL DEFAULT '{}',
  message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_module_installations_module ON module_installations(module_id,id DESC);
CREATE TABLE IF NOT EXISTS module_migrations (
  module_id TEXT NOT NULL, migration_id TEXT NOT NULL, version TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(module_id,migration_id)
) STRICT;`);
const passwordHash = password => { const salt=randomBytes(16).toString('hex'); return `${salt}:${pbkdf2Sync(String(password),salt,120000,32,'sha256').toString('hex')}`; };
const passwordMatches = (password, saved) => { const [salt,expected]=String(saved||'').split(':'); if(!salt||!expected)return false; const actual=pbkdf2Sync(String(password),salt,120000,32,'sha256').toString('hex'); return actual.length===expected.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected)); };
const userColumns = db.prepare('PRAGMA table_info(app_users)').all().map(column=>column.name);
if (!userColumns.includes('job_title')) db.exec("ALTER TABLE app_users ADD COLUMN job_title TEXT NOT NULL DEFAULT ''");
if (!db.prepare("SELECT id FROM app_users WHERE role='master' LIMIT 1").get()) db.prepare("INSERT INTO app_users (username,password_hash,role,modules) VALUES (?,?,?,?)").run('master',passwordHash('CAPMaster!2026'),'master','["returns","warehouse","payroll","server"]');
const sessions = new Map();
const BRANDING_FILE=join(DATA,'application-branding.json'),BRANDING_LOGO_FILE=join(DATA,'application-branding-logo.bin');
const brandingRecord=()=>{try{return JSON.parse(readFileSync(BRANDING_FILE,'utf8'));}catch{return {app_name:'CAP Analytics',logo_mime:'',updated_at:''};}};
const writeBrandingRecord=record=>writeFileSync(BRANDING_FILE,JSON.stringify(record,null,2),'utf8');
const applicationBranding=()=>{const row=brandingRecord(),hasLogo=Boolean(row.logo_mime&&existsSync(BRANDING_LOGO_FILE));return {appName:String(row.app_name||'CAP Analytics'),hasLogo,logoUrl:hasLogo?`/api/app-branding/logo?v=${encodeURIComponent(String(row.updated_at||''))}`:'',updatedAt:row.updated_at||''};};
function saveApplicationBranding(data){const appName=String(data?.app_name||'').trim().replace(/\s+/g,' ').slice(0,80);if(appName.length<2)throw new Error('Nama aplikasi minimal 2 karakter.');const record={...brandingRecord(),app_name:appName,updated_at:new Date().toISOString()};writeBrandingRecord(record);return applicationBranding();}
function saveApplicationLogo(buffer,mimeType){if(!Buffer.isBuffer(buffer)||!buffer.length)throw new Error('Pilih logo terlebih dahulu.');if(buffer.length>2*1024*1024)throw new Error('Ukuran logo maksimal 2 MB.');const mime=String(mimeType||'').split(';')[0].toLowerCase();if(!['image/png','image/jpeg','image/webp'].includes(mime))throw new Error('Logo harus berupa PNG, JPG, atau WEBP.');const record={...brandingRecord(),logo_mime:mime,updated_at:new Date().toISOString()};writeFileSync(BRANDING_LOGO_FILE,buffer);writeBrandingRecord(record);return applicationBranding();}
function clearApplicationLogo(){const record={...brandingRecord(),logo_mime:'',updated_at:new Date().toISOString()};if(existsSync(BRANDING_LOGO_FILE))rmSync(BRANDING_LOGO_FILE);writeBrandingRecord(record);return applicationBranding();}
db.exec(`CREATE TABLE IF NOT EXISTS wecom_excel_settings (id INTEGER PRIMARY KEY CHECK(id=1),corp_id TEXT NOT NULL DEFAULT '',corp_secret TEXT NOT NULL DEFAULT '',service_user_id TEXT NOT NULL DEFAULT '',space_id TEXT NOT NULL DEFAULT '',folder_id TEXT NOT NULL DEFAULT '',agent_id TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT; INSERT OR IGNORE INTO wecom_excel_settings(id) VALUES(1);`);
const availableModules = ['returns','returns_analysis','returns_incoming','warehouse','warehouse_dashboard','warehouse_packing','warehouse_servis','warehouse_produksi','finance','finance_petty_cash','finance_company_expenses','finance_office_stock','maturity_reminders','jakarta_receivables','sinosure','wecom_excel','accounting_lite','accounting_dashboard','accounting_accounts','accounting_account_edit','accounting_management','accounting_reports','accounting_stock_history','asset_management','payroll','online_shop','online_shop_scan','online_shop_reporting','server','whatsapp'];
const validModuleKey = value => /^[a-z][a-z0-9_]{1,80}$/.test(String(value||''));
const permissionParent = permission => permission.startsWith('returns_') ? 'returns' : permission.startsWith('warehouse_') ? 'warehouse' : permission.startsWith('finance_') ? 'finance' : permission.startsWith('online_shop_') ? 'online_shop' : permission.startsWith('accounting_') ? 'accounting_lite' : permission;
const applicationModuleCatalog = [
  ['returns','Retur Online','Analisis penjualan, cancel, retur, dan penerimaan retur.'],
  ['warehouse','Rekap kegiatan gudang','Pencatatan dan rekap aktivitas gudang.'],
  ['payroll','Gaji gudang','Absensi, perhitungan gaji, dan ekspor rekap.'],
  ['online_shop','Resi Online Shop','Pelaporan kendala dan data scan resi toko online.'],
  ['finance','Keuangan','Kas kecil, biaya perusahaan, dan stok kebutuhan kantor.'],
  ['accounting_lite','Cahaya Accounting','Rekening, jurnal, stok, dan laporan keuangan.'],
  ['asset_management','Aset Perusahaan','Pencatatan serta pengelolaan aset perusahaan.'],
  ['maturity_reminders','Piutang Jakarta','Pengingat dan pengelolaan pembayaran piutang.'],
  ['sinosure','Sinosure','Kontrak, pengiriman, dan dokumen Sinosure.'],
  ['wecom_excel','WeCom WeDrive Excel','Koneksi dan pengelolaan workbook WeDrive.'],
  ['whatsapp','Notifikasi WhatsApp','Kontak dan pengiriman notifikasi operasional.'],
  ['server','ERP CAP','Akses ERP menggunakan akun CAP.']
];
db.exec(`CREATE TABLE IF NOT EXISTS application_module_settings (
  module_key TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;`);
const applicationModuleKeys = new Set(applicationModuleCatalog.map(item=>item[0]));
for(const [moduleKey] of applicationModuleCatalog)db.prepare('INSERT OR IGNORE INTO application_module_settings(module_key,enabled) VALUES (?,1)').run(moduleKey);
const isModuleEnabled = module => {const key=permissionParent(String(module||''));if(!applicationModuleKeys.has(key))return true;return Number(db.prepare('SELECT enabled FROM application_module_settings WHERE module_key=?').get(key)?.enabled??1)===1;};
const knownModules = () => [...new Set([...availableModules,...db.prepare('SELECT modules FROM app_users').all().flatMap(item=>{try{return JSON.parse(item.modules||'[]')}catch{return []}}).filter(validModuleKey).filter(isModuleEnabled)])];
const userPublic = user => {const modules=(user.role==='master'?knownModules():JSON.parse(user.modules||'[]')).filter(isModuleEnabled);return {id:Number(user.id),username:user.username,role:user.role,job_title:String(user.job_title||''),modules};};
const sessionUser = (req,url) => { const token=req.headers['x-cap-token']||url.searchParams.get('token'); const session=sessions.get(String(token||'')); if(!session||session.expires<Date.now())return null; const user=db.prepare('SELECT * FROM app_users WHERE id=?').get(session.userId); return user?userPublic(user):null; };
const canAccess = (user,module) => user&&isModuleEnabled(module)&&(user.role==='master'||user.modules.includes(module)||user.modules.includes(permissionParent(module))||(module==='returns'&&user.modules.some(item=>item.startsWith('returns_')))||(module==='warehouse'&&user.modules.some(item=>item.startsWith('warehouse_')))||(module==='finance'&&user.modules.some(item=>item.startsWith('finance_')))||(module==='online_shop'&&user.modules.some(item=>item.startsWith('online_shop_')))||(module==='accounting_lite'&&user.modules.some(item=>item.startsWith('accounting_'))));
const requiredModule = pathname => pathname.startsWith('/api/wecom-excel')?'wecom_excel':pathname.startsWith('/api/accounting-lite')?'accounting_lite':pathname.startsWith('/api/assets')?'asset_management':pathname.startsWith('/api/online-shop')?'online_shop_reporting':pathname.startsWith('/api/jakarta-receivables')?'maturity_reminders':pathname.startsWith('/api/maturity-reminders')?'maturity_reminders':pathname.startsWith('/api/returns/incoming')?'returns_incoming':pathname.startsWith('/api/returns')?'returns_analysis':pathname.startsWith('/api/warehouse')?'warehouse':pathname.startsWith('/api/sinosure')?'sinosure':pathname.startsWith('/api/finance/petty-cash')?'finance_petty_cash':pathname.startsWith('/api/finance/company-expenses')?'finance_company_expenses':pathname.startsWith('/api/finance/office-stock')?'finance_office_stock':pathname.startsWith('/api/finance')?'finance':pathname.startsWith('/api/payroll')?'payroll':pathname.startsWith('/api/erp')?'server':pathname.startsWith('/api/whatsapp')?'whatsapp':null;
const columns = db.prepare("PRAGMA table_info(order_lines)").all().map(x => x.name);
if (!columns.includes('delivered')) db.exec('ALTER TABLE order_lines ADD COLUMN delivered TEXT');
if (!columns.includes('order_date')) db.exec('ALTER TABLE order_lines ADD COLUMN order_date TEXT');
if (!columns.includes('store')) db.exec('ALTER TABLE order_lines ADD COLUMN store TEXT');
if (!columns.includes('courier')) db.exec('ALTER TABLE order_lines ADD COLUMN courier TEXT');
const jakartaInvoiceColumns = db.prepare('PRAGMA table_info(jakarta_receivable_invoices)').all().map(column => column.name);
if (!jakartaInvoiceColumns.includes('invoice_discount')) db.exec('ALTER TABLE jakarta_receivable_invoices ADD COLUMN invoice_discount REAL NOT NULL DEFAULT 0');
db.prepare("INSERT OR IGNORE INTO jakarta_receivable_classifications(name,created_by) VALUES ('Verdo','system')").run();
const initialVerdo = db.prepare("SELECT id FROM jakarta_receivable_classifications WHERE name='Verdo'").get();
if (initialVerdo) { const addStore = db.prepare('INSERT OR IGNORE INTO jakarta_receivable_classification_stores(classification_id,store_name) VALUES (?,?)'); addStore.run(initialVerdo.id,'JAYA MANDIRI'); addStore.run(initialVerdo.id,'PD. JAYA MANDIRI'); }
// Data absensi dan gaji harus selalu dibaca ulang. Tanpa no-store, browser
// bisa memakai respons /api/payroll lama setelah server diperbarui.
const json = (res,status,value) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, no-cache, must-revalidate, max-age=0','Pragma':'no-cache'}); res.end(JSON.stringify(value)); };
const readBuffer = (req,max=60*1024*1024) => new Promise((resolve,reject) => { const chunks=[]; let size=0; req.on('data',c=>{ chunks.push(c); size+=c.length; if(size>max) reject(new Error('Berkas maksimum 60 MB.')); }); req.on('end',()=>resolve(Buffer.concat(chunks))); });
const MODULE_RECOVERY=join(DATA,'recovery'), MODULE_SNAPSHOTS=join(MODULE_RECOVERY,'snapshots');
if(!existsSync(MODULE_SNAPSHOTS))mkdirSync(MODULE_SNAPSHOTS,{recursive:true});
const compareModuleVersion=(left,right)=>{const parse=value=>String(value||'0.0.0').split(/[+-]/)[0].split('.').map(item=>Number(item)||0),a=parse(left),b=parse(right);for(let index=0;index<Math.max(a.length,b.length);index++){if((a[index]||0)!==(b[index]||0))return (a[index]||0)>(b[index]||0)?1:-1;}return 0;};
const packagePathSafe=target=>/^(app\.mjs|CONTEXT\.md|public\/[A-Za-z0-9_./-]+|scripts\/[A-Za-z0-9_./-]+|modules\/[A-Za-z0-9_./-]+)$/.test(String(target||''))&&!String(target).includes('..');
function moduleSnapshot(manifest){const stamp=`${new Date().toISOString().replace(/[:.]/g,'-')}-${manifest.id}-${manifest.version}`,folder=join(MODULE_SNAPSHOTS,stamp),state={module_id:manifest.id,version:manifest.version,created_at:new Date().toISOString(),files:[]};mkdirSync(join(folder,'files'),{recursive:true});for(const target of [...new Set(manifest.files.map(item=>item.target))]){const original=join(ROOT,target),backup=join(folder,'files',target),exists=existsSync(original);state.files.push({target,exists});if(exists){mkdirSync(dirname(backup),{recursive:true});copyFileSync(original,backup);}}if(existsSync(join(DATA,'app.db')))copyFileSync(join(DATA,'app.db'),join(folder,'app.db'));writeFileSync(join(folder,'file-state.json'),JSON.stringify(state,null,2));return folder;}
function restoreModuleSnapshot(snapshot){const folder=join(MODULE_SNAPSHOTS,String(snapshot||'').split(/[\\/]/).pop()||'');if(!folder.startsWith(MODULE_SNAPSHOTS)||!existsSync(join(folder,'file-state.json')))throw new Error('Snapshot pemulihan tidak ditemukan.');const state=JSON.parse(readFileSync(join(folder,'file-state.json'),'utf8'));for(const item of state.files||[]){if(!packagePathSafe(item.target))continue;const target=join(ROOT,item.target),backup=join(folder,'files',item.target);if(item.exists&&existsSync(backup)){mkdirSync(dirname(target),{recursive:true});copyFileSync(backup,target);}else if(!item.exists&&existsSync(target))unlinkSync(target);}if(existsSync(join(folder,'app.db'))){mkdirSync(DATA,{recursive:true});copyFileSync(join(folder,'app.db'),join(DATA,'app.db'));}return folder;}
function inspectModulePackage(buffer){const source=join(tmpdir(),`cap-module-${randomUUID()}.zip`),output=`${source}.json`;try{writeFileSync(source,buffer);const result=runPython(join(ROOT,'scripts','cap_module_package.py'),['inspect',source,output]);if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Paket modul tidak dapat diperiksa.');return {source,output,manifest:JSON.parse(readFileSync(output,'utf8'))};}catch(error){if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);throw error;}}
function installModulePackage(buffer){const inspected=inspectModulePackage(buffer),{source,output,manifest}=inspected,staging=join(tmpdir(),`cap-module-stage-${randomUUID()}`);let snapshot='';try{const previous=db.prepare("SELECT version FROM module_installations WHERE module_id=? AND status='installed' ORDER BY id DESC LIMIT 1").get(manifest.id);if(previous&&compareModuleVersion(manifest.version,previous.version)<=0)throw new Error(`Versi ${manifest.version} bukan versi lebih baru dari ${previous.version}. Gunakan CAP Recovery untuk kembali ke versi lama.`);const extracted=runPython(join(ROOT,'scripts','cap_module_package.py'),['extract',source,staging]);if(extracted.error)throw extracted.error;if(extracted.status!==0)throw new Error(extracted.stderr||'Paket modul tidak dapat diekstrak.');snapshot=moduleSnapshot(manifest);try{db.exec('BEGIN IMMEDIATE');for(const migration of manifest.migrations){if(db.prepare('SELECT 1 FROM module_migrations WHERE module_id=? AND migration_id=?').get(manifest.id,migration.id))continue;db.exec(readFileSync(join(staging,...migration.source.split('/')),'utf8'));db.prepare('INSERT INTO module_migrations (module_id,migration_id,version) VALUES (?,?,?)').run(manifest.id,migration.id,manifest.version);}db.exec('COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}for(const file of manifest.files){if(!packagePathSafe(file.target))throw new Error('Target paket tidak diizinkan.');const target=join(ROOT,file.target);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(staging,...file.source.split('/')),target);}db.prepare("INSERT INTO module_installations (module_id,version,status,checksum,snapshot_path,manifest_json,message) VALUES (?,?,?,?,?,?,?)").run(manifest.id,manifest.version,'installed',manifest.checksum,snapshot,JSON.stringify(manifest),`Instalasi berhasil. Snapshot: ${snapshot}`);return {manifest,snapshot};}catch(error){if(snapshot){try{restoreModuleSnapshot(snapshot);}catch{}}try{db.prepare("INSERT INTO module_installations (module_id,version,status,checksum,manifest_json,message) VALUES (?,?,?,?,?,?)").run(manifest.id||'unknown',manifest.version||'0.0.0','failed',manifest.checksum||'',JSON.stringify(manifest||{}),String(error.message||error));}catch{}throw error;}finally{if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);if(existsSync(staging))rmSync(staging,{recursive:true,force:true});}}
function moduleInstallerStatus(){return {installations:db.prepare('SELECT id,module_id,version,status,checksum,snapshot_path,message,created_at FROM module_installations ORDER BY id DESC LIMIT 50').all(),snapshots:readdirSync(MODULE_SNAPSHOTS,{withFileTypes:true}).filter(item=>item.isDirectory()).map(item=>item.name).sort().reverse(),integrity:moduleIntegrityReport()};}
function applicationModules(){const states=new Map(db.prepare('SELECT module_key,enabled,updated_by,updated_at FROM application_module_settings').all().map(item=>[item.module_key,item]));return applicationModuleCatalog.map(([module_key,title,description])=>{const state=states.get(module_key)||{};return {module_key,title,description,enabled:Number(state.enabled??1)===1,updated_by:String(state.updated_by||''),updated_at:String(state.updated_at||'')};});}
function setApplicationModuleState(input,user){if(user?.role!=='master')throw new Error('Hanya akun master yang dapat mengelola modul aplikasi.');const key=String(input?.module_key||''),enabled=input?.enabled===true||input?.enabled==='true'||input?.enabled===1;if(!applicationModuleKeys.has(key))throw new Error('Modul aplikasi tidak dikenal.');if(!enabled){const expected=`NONAKTIFKAN ${key}`;if(input?.confirmed!==true||String(input?.confirmation_text||'').trim()!==expected)throw new Error(`Konfirmasi kedua wajib diisi persis: ${expected}`);}db.prepare('UPDATE application_module_settings SET enabled=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE module_key=?').run(enabled?1:0,String(user.username||''),key);return applicationModules().find(item=>item.module_key===key);}
function moduleManifest(row){try{return JSON.parse(row?.manifest_json||'{}')}catch{return {}}}
function installedModuleRecords(){const stacks=new Map(),rows=db.prepare('SELECT id,module_id,version,status,checksum,snapshot_path,manifest_json,message,created_at FROM module_installations ORDER BY id').all();for(const row of rows){const stack=stacks.get(row.module_id)||[];if(row.status==='installed'){stack.push(row);stacks.set(row.module_id,stack);}else if(row.status==='uninstalled'&&stack.length){stack.pop();stacks.set(row.module_id,stack);}}return [...stacks.values()].map(stack=>stack.at(-1)).filter(Boolean).map(row=>{const manifest=moduleManifest(row);return {id:row.id,module_id:row.module_id,title:String(manifest.title||row.module_id),version:row.version,description:String(manifest.description||''),files:Array.isArray(manifest.files)?manifest.files.length:0,migrations:Array.isArray(manifest.migrations)?manifest.migrations.length:0,installed_at:row.created_at,can_uninstall:Boolean(row.snapshot_path)&&!(Array.isArray(manifest.migrations)&&manifest.migrations.length)};}).sort((a,b)=>a.title.localeCompare(b.title,'id'));}
function moduleIntegrityReport(){return installedModuleRecords().map(item=>{const row=db.prepare('SELECT manifest_json FROM module_installations WHERE id=?').get(item.id),manifest=moduleManifest(row),files=Array.isArray(manifest.files)?manifest.files:[],checks=files.map(file=>{const target=String(file?.target||''),expected=String(file?.sha256||'').toLowerCase(),path=join(ROOT,target);let actual='',status='ok';if(!target||!packagePathSafe(target)||!existsSync(path))status='missing';else{actual=createHash('sha256').update(readFileSync(path)).digest('hex');if(!expected||actual!==expected)status='different';}return {target,status,expected,actual};}),missing=checks.filter(check=>check.status==='missing').map(check=>check.target),different=checks.filter(check=>check.status==='different').map(check=>check.target);return {module_id:item.module_id,title:item.title,version:item.version,ok:!missing.length&&!different.length,expected_files:checks.length,missing,different};});}
function restoreModuleFilesOnly(snapshot){const folder=join(MODULE_SNAPSHOTS,String(snapshot||'').split(/[\\/]/).pop()||'');if(!folder.startsWith(MODULE_SNAPSHOTS)||!existsSync(join(folder,'file-state.json')))throw new Error('Snapshot kode untuk modul tidak ditemukan.');const state=JSON.parse(readFileSync(join(folder,'file-state.json'),'utf8'));for(const item of state.files||[]){if(!packagePathSafe(item.target))continue;const target=join(ROOT,item.target),backup=join(folder,'files',item.target);if(item.exists){if(!existsSync(backup))throw new Error(`Berkas snapshot tidak lengkap: ${item.target}`);mkdirSync(dirname(target),{recursive:true});copyFileSync(backup,target);}else if(existsSync(target))unlinkSync(target);}return folder;}
function uninstallModulePackage(input){const moduleId=String(input?.module_id||''),expected=`HAPUS ${moduleId}`;if(!validModuleKey(moduleId))throw new Error('ID modul tidak valid.');if(input?.confirmed!==true||String(input?.confirmation_text||'').trim()!==expected)throw new Error(`Konfirmasi kedua wajib diisi persis: ${expected}`);const current=installedModuleRecords().find(item=>item.module_id===moduleId);if(!current)throw new Error('Modul aktif tidak ditemukan.');const row=db.prepare('SELECT * FROM module_installations WHERE id=?').get(current.id),manifest=moduleManifest(row),migrations=Array.isArray(manifest.migrations)?manifest.migrations:[];if(migrations.length)throw new Error('Modul ini memiliki migrasi database sehingga tidak dapat dihapus otomatis. Gunakan pemulihan snapshot agar data tetap aman.');if(!row.snapshot_path)throw new Error('Snapshot kode untuk modul ini tidak tersedia.');const targets=new Set((manifest.files||[]).map(item=>String(item.target||'')));const later=db.prepare("SELECT manifest_json,module_id FROM module_installations WHERE id>? AND status='installed' ORDER BY id").all(row.id);for(const item of later){const laterManifest=moduleManifest(item);if((laterManifest.files||[]).some(file=>targets.has(String(file.target||''))))throw new Error(`Tidak dapat menghapus ${moduleId} karena paket ${item.module_id} yang lebih baru memakai berkas yang sama. Hapus atau pulihkan paket yang lebih baru terlebih dahulu.`);}const snapshot=restoreModuleFilesOnly(row.snapshot_path);db.prepare("INSERT INTO module_installations (module_id,version,status,checksum,snapshot_path,manifest_json,message) VALUES (?,?,?,?,?,?,?)").run(moduleId,row.version,'uninstalled',row.checksum,row.snapshot_path,row.manifest_json,`Dihapus oleh akun master. Kode dipulihkan dari snapshot ${snapshot}; database tidak diubah.`);return {module_id:moduleId,title:current.title,version:row.version};}
function exportDeveloperKit(){const output=join(tmpdir(),`cap-developer-kit-${randomUUID()}.zip`);try{const result=runPython(join(ROOT,'scripts','export_developer_kit.py'),[output],'');if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Developer Kit tidak dapat dibuat.');return readFileSync(output);}finally{if(existsSync(output))unlinkSync(output);}}
function restartWithRecovery(snapshot='',action='restart',pendingDatabase=''){const runner=join(ROOT,'scripts','cap_recovery_runner.cjs');if(!existsSync(runner)||process.env.CAP_DISABLE_AUTO_RESTART==='1')return false;const helper=spawn(process.execPath,[runner,process.execPath,ROOT,snapshot,action,pendingDatabase],{cwd:ROOT,detached:true,stdio:'ignore',windowsHide:true});helper.unref();setTimeout(()=>process.exit(0),800);return true;}
function exportDiagnosticBundle(includeDatabase=false){const source=join(tmpdir(),`cap-diagnostic-${randomUUID()}.json`),output=join(tmpdir(),`cap-diagnostic-${randomUUID()}.zip`);try{const diagnostic={generated_at:new Date().toISOString(),application:{node:process.version,port:PORT},database:{integrity:db.prepare('PRAGMA integrity_check').all().map(row=>Object.values(row)[0]),included:Boolean(includeDatabase)},installer:moduleInstallerStatus(),recovery:{runner_available:existsSync(join(ROOT,'scripts','cap_recovery_runner.cjs')),snapshot_count:readdirSync(MODULE_SNAPSHOTS,{withFileTypes:true}).filter(item=>item.isDirectory()).length}};writeFileSync(source,JSON.stringify({diagnostic,database:includeDatabase?join(DATA,'app.db'):''}));const result=runPython(join(ROOT,'scripts','cap_diagnostic_bundle.py'),[source,output]);if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Paket diagnostik tidak dapat dibuat.');return readFileSync(output);}finally{if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);}}
function exportDatabasePackage(){const output=join(tmpdir(),`cap-database-${randomUUID()}.zip`);try{const result=runPython(join(ROOT,'scripts','cap_database_package.py'),['create',join(DATA,'app.db'),output]);if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Cadangan database tidak dapat dibuat.');return readFileSync(output);}finally{if(existsSync(output))unlinkSync(output);}}
function inspectDatabasePackage(buffer){const source=join(tmpdir(),`cap-database-${randomUUID()}.zip`),output=`${source}.json`;try{writeFileSync(source,buffer);const result=runPython(join(ROOT,'scripts','cap_database_package.py'),['inspect',source,output]);if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Paket cadangan database tidak valid.');return {source,output,manifest:JSON.parse(readFileSync(output,'utf8'))};}catch(error){if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);throw error;}}
function prepareDatabaseRestore(buffer){const inspected=inspectDatabasePackage(buffer),staging=join(tmpdir(),`cap-database-stage-${randomUUID()}`);try{const extracted=runPython(join(ROOT,'scripts','cap_database_package.py'),['extract',inspected.source,staging]);if(extracted.error)throw extracted.error;if(extracted.status!==0)throw new Error(extracted.stderr||'Cadangan database tidak dapat diekstrak.');const candidate=join(staging,'database','app.db'),check=new DatabaseSync(candidate);try{const integrity=check.prepare('PRAGMA integrity_check').all().map(row=>Object.values(row)[0]);if(integrity.some(value=>String(value).toLowerCase()!=='ok'))throw new Error('Pemeriksaan integritas cadangan database gagal.');}finally{check.close();}const snapshot=moduleSnapshot({id:'database_restore',version:String(Date.now()),files:[]}),pending=join(MODULE_RECOVERY,`pending-database-${randomUUID()}.db`);copyFileSync(candidate,pending);return {snapshot,pending,manifest:inspected.manifest};}finally{if(existsSync(inspected.source))unlinkSync(inspected.source);if(existsSync(inspected.output))unlinkSync(inspected.output);if(existsSync(staging))rmSync(staging,{recursive:true,force:true});}}
const normal = value => String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const has = (text,words) => words.some(word=>text.includes(word));
const classify = row => {
  const source=normal(row.source),status=normal(row.status),substatus=normal(row.substatus),reason=normal(row.cancel_reason),combined=`${status} ${substatus}`;
  const canceled=source==='shopee' ? status==='batal' : source==='tiktok' ? has(combined,['cancel','batal','dibatalkan']) : /^cancel\b/.test(reason);
  // Match the monthly workbook: each marketplace has its own return status.
  // A tracked/delivered check is deliberately not added here; it would omit a
  // return whose marketplace status has already been approved.
  const returned=source==='shopee' ? substatus.includes('permintaan disetujui') : source==='tiktok' ? /return\s*\/?\s*refund/.test(combined) : /^return\b/.test(reason);
  return {canceled,issue:has(reason,['tolak','rejected','menolak','alamat','address','tidak ditemukan','not found'])&&(canceled||returned),returned};
};
const location = value => { let x=String(value||'').replace(/[.,]/g,' ').replace(/\s+/g,' ').trim(); if (!x) return 'Tidak diketahui'; x=x.replace(/^(kab|kabupaten)\.?\s*/i,'Kabupaten ').replace(/^kota\.?\s*/i,'Kota '); return x.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()); };
const parts = row => { const sku=String(row.sku||'').trim(); const items=sku.includes('+')?sku.split('+').map(x=>x.trim()).filter(Boolean):[sku||String(row.product_name||'Produk tanpa SKU')]; return items.map(product=>({product:product.toUpperCase().replace(/[\s_-]+/g,''),bundled:items.length>1})); };

function importExcel(fileData,fileName) {
  const temp=join(tmpdir(),`cap-upload-${randomUUID()}.xlsx`), parsed=`${temp}.json`;
  try {
    writeFileSync(temp,fileData);
    const result=runPython(join(ROOT,'scripts','extract_sales_excel.py'),[temp,parsed]);
    if(result.error) throw result.error;
    if(result.status!==0) throw new Error(result.stderr||'Excel tidak dapat diproses.');
    const items=JSON.parse(readFileSync(parsed,'utf8')).items;
    if(!items.length) throw new Error('Tidak ada transaksi Shopee, TikTok, atau Lazada yang dikenali.');
    const created=db.prepare('INSERT INTO uploads (file_name,row_count,file_data) VALUES (?,?,?)').run(fileName,items.length,fileData);
    const insert=db.prepare('INSERT INTO order_lines (upload_id,source,store,courier,order_id,status,substatus,cancel_reason,tracking,delivered,order_date,sku,product_name,quantity,returned_qty,refund_amount,province,city) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    db.exec('BEGIN'); try { for(const x of items) insert.run(created.lastInsertRowid,x.source,x.store,x.courier,x.order_id,x.status,x.substatus,x.cancel_reason,x.tracking,x.delivered,x.order_date,x.sku,x.product_name,x.quantity,x.returned_qty,x.refund_amount,x.province,x.city); db.exec('COMMIT'); } catch(error) { db.exec('ROLLBACK'); throw error; }
    return {id:Number(created.lastInsertRowid),rowCount:items.length};
  } finally { if(existsSync(temp)) unlinkSync(temp); if(existsSync(parsed)) unlinkSync(parsed); }
}
const maturityText=value=>String(value||'').trim().slice(0,500);
function maturityRecord(data,user,id=''){
  const type=['kospin','cek','giro'].includes(String(data.instrument_type||''))?String(data.instrument_type):'';
  const status=['pending','cleared','cancelled'].includes(String(data.status||''))?String(data.status):'pending';
  const maturityDate=dateKey(data.maturity_date);
  if(!type||!maturityDate)throw new Error('Jenis instrumen dan tanggal cair wajib diisi.');
  const account=maturityText(data.destination_account);if(type==='giro'&&!account)throw new Error('Rekening tujuan wajib diisi untuk giro.');
  const values=[maturityText(data.transaction_date),maturityText(data.nota),maturityText(data.store_name),maturityText(data.city),maturityText(data.sales_name),maturityText(data.item_name),Number(data.quantity)||0,Number(data.unit_price)||0,Number(data.amount)||0,Number(data.total)||0,maturityText(data.source_notes),type,maturityText(data.instrument_number),maturityDate,account,status];
  if(id){if(!db.prepare('SELECT id FROM maturity_instruments WHERE id=?').get(id))throw new Error('Data instrumen tidak ditemukan.');db.prepare('UPDATE maturity_instruments SET transaction_date=?,nota=?,store_name=?,city=?,sales_name=?,item_name=?,quantity=?,unit_price=?,amount=?,total=?,source_notes=?,instrument_type=?,instrument_number=?,maturity_date=?,destination_account=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(...values,id);return Number(id);}
  return Number(db.prepare('INSERT INTO maturity_instruments(transaction_date,nota,store_name,city,sales_name,item_name,quantity,unit_price,amount,total,source_notes,instrument_type,instrument_number,maturity_date,destination_account,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...values,user.username).lastInsertRowid);
}
function maturityData(){const today=new Date().toISOString().slice(0,10),addDays=days=>{const d=new Date(`${today}T00:00:00`);d.setDate(d.getDate()+days);return d.toISOString().slice(0,10);},rows=db.prepare('SELECT * FROM maturity_instruments ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END,maturity_date,id DESC').all().map(row=>({...row,id:Number(row.id)})),reminders=rows.filter(row=>row.status==='pending'&&row.maturity_date>=addDays(1)&&row.maturity_date<=addDays(7)),settings=db.prepare('SELECT reminders_enabled,updated_by,updated_at FROM maturity_settings WHERE id=1').get();return {rows,reminders,today,settings:{enabled:Boolean(settings?.reminders_enabled),updated_by:settings?.updated_by||'',updated_at:settings?.updated_at||''},imports:db.prepare('SELECT id,file_name,row_count,imported_by,imported_at FROM maturity_imports ORDER BY id DESC LIMIT 20').all()};}
function saveMaturitySettings(data,user){if(user.role!=='master')throw new Error('Hanya akun master yang dapat mengubah pengaturan pengingat.');const enabled=data?.enabled===true||data?.enabled==='true'||data?.enabled===1;db.prepare('UPDATE maturity_settings SET reminders_enabled=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(enabled?1:0,user.username);return maturityData().settings;}
function importMaturityExcel(fileData,fileName,user){const source=join(tmpdir(),`cap-maturity-${randomUUID()}.xlsx`),output=`${source}.json`;try{writeFileSync(source,fileData);const result=runPython(join(ROOT,'scripts','extract_maturity_excel.py'),[source,output],'openpyxl');if(result.status!==0)throw new Error(result.stderr||'Excel tidak dapat diproses.');const items=JSON.parse(readFileSync(output,'utf8')).items||[];if(!items.length)throw new Error('Tidak ada baris instrumen yang dapat diimpor. Lengkapi Jenis Instrumen dan Tanggal Cair.');db.exec('BEGIN IMMEDIATE');try{const importId=Number(db.prepare('INSERT INTO maturity_imports(file_name,row_count,imported_by) VALUES (?,?,?)').run(fileName,items.length,user.username).lastInsertRowid);for(const item of items){const values={...item,source_notes:item.source_notes||'',status:'pending'};const type=values.instrument_type;if(type==='giro'&&!values.destination_account)throw new Error(`Rekening tujuan wajib diisi untuk giro ${values.instrument_number||'(tanpa nomor)'}.`);db.prepare('INSERT INTO maturity_instruments(import_id,transaction_date,nota,store_name,city,sales_name,item_name,quantity,unit_price,amount,total,source_notes,instrument_type,instrument_number,maturity_date,destination_account,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(importId,values.transaction_date,values.nota,values.store_name,values.city,values.sales_name,values.item_name,Number(values.quantity)||0,Number(values.unit_price)||0,Number(values.amount)||0,Number(values.total)||0,values.source_notes,type,values.instrument_number,values.maturity_date,values.destination_account,'pending',user.username);};db.exec('COMMIT');return {imported:items.length};}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}finally{if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);}}
function legacyJakartaReceivables(){const today=new Date().toISOString().slice(0,10),invoices=db.prepare('SELECT i.*,COALESCE((SELECT SUM(amount) FROM jakarta_receivable_allocations a WHERE a.invoice_id=i.id),0) paid FROM jakarta_receivable_invoices i ORDER BY due_date').all().map(x=>({...x,balance:Number(x.total)-Number(x.paid),items:db.prepare('SELECT item_name,quantity,unit_price FROM jakarta_receivable_items WHERE invoice_id=?').all(x.id)})),open=invoices.filter(x=>x.balance>0),due=open.filter(x=>x.due_date<=today),future=open.filter(x=>x.due_date>today),reminders=open.filter(x=>{const d=(new Date(x.due_date)-new Date(today))/86400000;return d<=7;});return {invoices,summary:{due:due.reduce((s,x)=>s+x.balance,0),future:future.reduce((s,x)=>s+x.balance,0)},reminders};}
function legacySaveJakartaInvoice(data,user){const items=(Array.isArray(data.items)?data.items:[]).filter(x=>String(x.item_name||'').trim());if(!data.invoice_date||!data.due_date||!String(data.store_name||'').trim()||!items.length)throw new Error('Tanggal, toko, dan sedikitnya satu barang wajib diisi.');const total=items.reduce((s,x)=>s+(Number(x.quantity)||0)*(Number(x.unit_price)||0),0);db.exec('BEGIN');try{const id=Number(db.prepare('INSERT INTO jakarta_receivable_invoices(invoice_date,due_date,invoice_number,store_name,city,sales_name,notes,total,created_by) VALUES (?,?,?,?,?,?,?,?,?)').run(data.invoice_date,data.due_date,String(data.store_name),String(data.city||''),String(data.sales_name||''),String(data.notes||''),total,user.username).lastInsertRowid),ins=db.prepare('INSERT INTO jakarta_receivable_items(invoice_id,item_name,quantity,unit_price) VALUES (?,?,?,?)');for(const x of items)ins.run(id,String(x.item_name),Number(x.quantity)||0,Number(x.unit_price)||0);db.exec('COMMIT');return id;}catch(e){db.exec('ROLLBACK');throw e;}}
function legacyUpdateJakartaInvoice(id,data){const existing=db.prepare('SELECT id FROM jakarta_receivable_invoices WHERE id=?').get(id);if(!existing)throw new Error('Invoice tidak ditemukan.');const items=(Array.isArray(data.items)?data.items:[]).filter(x=>String(x.item_name||'').trim());if(!data.invoice_date||!data.due_date||!String(data.store_name||'').trim()||!items.length)throw new Error('Tanggal, toko, dan sedikitnya satu barang wajib diisi.');const total=items.reduce((s,x)=>s+(Number(x.quantity)||0)*(Number(x.unit_price)||0),0),paid=Number(db.prepare('SELECT COALESCE(SUM(amount),0) paid FROM jakarta_receivable_allocations WHERE invoice_id=?').get(id).paid);if(total<paid)throw new Error('Total invoice tidak boleh lebih kecil dari pembayaran yang sudah tercatat.');db.exec('BEGIN');try{db.prepare('UPDATE jakarta_receivable_invoices SET invoice_date=?,due_date=?,invoice_number=?,store_name=?,city=?,sales_name=?,notes=?,total=? WHERE id=?').run(data.invoice_date,data.due_date,String(data.invoice_number||''),String(data.store_name),String(data.city||''),String(data.sales_name||''),String(data.notes||''),total,id);db.prepare('DELETE FROM jakarta_receivable_items WHERE invoice_id=?').run(id);const ins=db.prepare('INSERT INTO jakarta_receivable_items(invoice_id,item_name,quantity,unit_price) VALUES (?,?,?,?)');for(const x of items)ins.run(id,String(x.item_name),Number(x.quantity)||0,Number(x.unit_price)||0);db.exec('COMMIT');return id;}catch(e){db.exec('ROLLBACK');throw e;}}
function legacyDeleteJakartaInvoice(id){const result=db.prepare('DELETE FROM jakarta_receivable_invoices WHERE id=?').run(id);if(!result.changes)throw new Error('Invoice tidak ditemukan.');return {ok:true};}
function legacySaveJakartaPayment(data,user){const allocations=(Array.isArray(data.allocations)?data.allocations:[]).filter(x=>Number(x.amount)>0),amount=allocations.reduce((s,x)=>s+Number(x.amount),0);if(!data.payment_date||!amount)throw new Error('Tanggal dan alokasi pembayaran wajib diisi.');db.exec('BEGIN');try{const id=Number(db.prepare('INSERT INTO jakarta_receivable_payments(payment_date,amount,payment_method,notes,created_by) VALUES (?,?,?,?,?)').run(data.payment_date,amount,String(data.payment_method||''),String(data.notes||''),user.username).lastInsertRowid),ins=db.prepare('INSERT INTO jakarta_receivable_allocations(payment_id,invoice_id,amount) VALUES (?,?,?)');for(const x of allocations)ins.run(id,Number(x.invoice_id),Number(x.amount));db.exec('COMMIT');return id;}catch(e){db.exec('ROLLBACK');throw e;}}
function importJakartaReceivables(file,user){const source=join(tmpdir(),`jakarta-${randomUUID()}.xlsx`),out=`${source}.json`;try{writeFileSync(source,file);const result=runPython(join(ROOT,'scripts','extract_jakarta_receivables.py'),[source,out],'openpyxl');if(result.status!==0)throw new Error(result.stderr||'Workbook tidak dapat dibaca.');const rows=JSON.parse(readFileSync(out,'utf8')).rows||[],groups=new Map();for(const r of rows){const k=[r.invoice_date,r.invoice_number,r.store_name].join('|'),g=groups.get(k)||{...r,items:[]};g.items.push(r);groups.set(k,g)}for(const g of groups.values())saveJakartaInvoice(g,user);return {rows:rows.length,invoices:groups.size};}finally{if(existsSync(source))unlinkSync(source);if(existsSync(out))unlinkSync(out);}}
function legacyExportJakartaReceivables(month='',store=''){const source=join(tmpdir(),`jakarta-export-${randomUUID()}.json`),output=join(tmpdir(),`piutang-jakarta-${randomUUID()}.xlsx`);try{const invoices=jakartaReceivables().invoices.filter(row=>(!month||String(row.invoice_date||'').startsWith(month))&&(!store||row.store_name===store));writeFileSync(source,JSON.stringify({invoices,month,store}));const result=runPython(join(ROOT,'scripts','export_jakarta_receivables.py'),[source,output],'openpyxl');if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Laporan Excel tidak dapat dibuat.');return readFileSync(output);}finally{if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);}}
function jakartaClassifications(){return db.prepare('SELECT id,name,created_by,created_at FROM jakarta_receivable_classifications ORDER BY name').all().map(row=>({...row,id:Number(row.id),stores:db.prepare('SELECT store_name FROM jakarta_receivable_classification_stores WHERE classification_id=? ORDER BY store_name').all(row.id).map(item=>item.store_name)}));}
function jakartaTermSettings(){const base=db.prepare('SELECT default_days FROM jakarta_receivable_term_settings WHERE id=1').get()||{default_days:120};return {default_days:Number(base.default_days)||120,stores:db.prepare('SELECT store_name,term_days FROM jakarta_receivable_store_terms ORDER BY store_name').all().map(row=>({store_name:row.store_name,term_days:Number(row.term_days)}))};}
function jakartaDueDate(invoiceDate,storeName){const settings=jakartaTermSettings(),term=settings.stores.find(row=>String(row.store_name).trim().toUpperCase()===String(storeName||'').trim().toUpperCase())?.term_days||settings.default_days,date=new Date(`${String(invoiceDate||'')}T00:00:00`);if(Number.isNaN(date.getTime()))return String(invoiceDate||'');date.setDate(date.getDate()+term);return date.toISOString().slice(0,10);}
function saveJakartaTermSettings(data,user){const defaultDays=Math.max(1,Math.min(720,Number(data?.default_days)||120)),stores=[...new Map((Array.isArray(data?.stores)?data.stores:[]).map(row=>[String(row.store_name||'').trim().toUpperCase(),{store_name:String(row.store_name||'').trim(),term_days:Math.max(1,Math.min(720,Number(row.term_days)||defaultDays))}]).filter(([key])=>key)).values()];db.exec('BEGIN');try{db.prepare('UPDATE jakarta_receivable_term_settings SET default_days=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(defaultDays,user.username);db.prepare('DELETE FROM jakarta_receivable_store_terms').run();const insert=db.prepare('INSERT INTO jakarta_receivable_store_terms(store_name,term_days,updated_by) VALUES (?,?,?)');for(const store of stores)insert.run(store.store_name,store.term_days,user.username);const allInvoices=db.prepare('SELECT id,invoice_date,store_name FROM jakarta_receivable_invoices').all();const update=db.prepare('UPDATE jakarta_receivable_invoices SET due_date=? WHERE id=?');for(const invoice of allInvoices){const override=stores.find(store=>store.store_name.toUpperCase()===String(invoice.store_name||'').trim().toUpperCase()),days=override?.term_days||defaultDays,date=new Date(`${invoice.invoice_date}T00:00:00`);if(!Number.isNaN(date.getTime())){date.setDate(date.getDate()+days);update.run(date.toISOString().slice(0,10),invoice.id);}}db.exec('COMMIT');return jakartaTermSettings();}catch(error){db.exec('ROLLBACK');throw error;}}
function jakartaReceivables(){const today=new Date().toISOString().slice(0,10),classificationByStore=new Map(jakartaClassifications().flatMap(group=>group.stores.map(store=>[store.toUpperCase(),group.name]))),invoices=db.prepare('SELECT i.*,COALESCE((SELECT SUM(amount) FROM jakarta_receivable_allocations a WHERE a.invoice_id=i.id),0) paid FROM jakarta_receivable_invoices i ORDER BY invoice_date,due_date,id').all().map(row=>{const total=Number(row.total)||0,discount=Math.max(0,Number(row.invoice_discount)||0),paid=Number(row.paid)||0,net=Math.max(0,total-discount),payments=db.prepare('SELECT p.id payment_id,p.payment_date,p.amount,p.payment_method,p.notes,a.amount allocated_amount FROM jakarta_receivable_payments p JOIN jakarta_receivable_allocations a ON a.payment_id=p.id WHERE a.invoice_id=? ORDER BY p.payment_date,p.id').all(row.id).map(item=>({...item,payment_id:Number(item.payment_id),amount:Number(item.amount)||0,allocated_amount:Number(item.allocated_amount)||0})),returns=db.prepare('SELECT item_name,amount,notes,source_sheet,source_row FROM jakarta_receivable_returns WHERE invoice_id=? ORDER BY id').all(row.id);return {...row,id:Number(row.id),total,invoice_discount:discount,net_total:net,paid,balance:Math.max(0,net-paid),classification_name:classificationByStore.get(String(row.store_name||'').trim().toUpperCase())||'',items:db.prepare('SELECT item_name,quantity,unit_price FROM jakarta_receivable_items WHERE invoice_id=?').all(row.id),payments,returns};}),open=invoices.filter(row=>row.balance>0),due=open.filter(row=>row.due_date<=today),future=open.filter(row=>row.due_date>today),reminders=open.filter(row=>{const days=(new Date(row.due_date)-new Date(today))/86400000;return days>=0&&days<=7;});return {invoices,classifications:jakartaClassifications(),term_settings:jakartaTermSettings(),summary:{due:due.reduce((sum,row)=>sum+row.balance,0),future:future.reduce((sum,row)=>sum+row.balance,0),outstanding:open.reduce((sum,row)=>sum+row.balance,0)},reminders};}
function jakartaReceivableReminderData(){const today=new Date().toISOString().slice(0,10),settings=db.prepare('SELECT reminders_enabled FROM maturity_settings WHERE id=1').get(),rows=db.prepare('SELECT i.id,i.invoice_number,i.store_name,i.due_date,i.total,COALESCE(i.invoice_discount,0) invoice_discount,COALESCE((SELECT SUM(amount) FROM jakarta_receivable_allocations a WHERE a.invoice_id=i.id),0) paid FROM jakarta_receivable_invoices i WHERE i.due_date<=? ORDER BY i.due_date,i.store_name,i.id').all(new Date(new Date(`${today}T00:00:00`).getTime()+7*86400000).toISOString().slice(0,10)).map(row=>{const balance=Math.max(0,Number(row.total||0)-Number(row.invoice_discount||0)-Number(row.paid||0));return {...row,id:Number(row.id),balance,overdue:row.due_date<today};}).filter(row=>row.balance>0);return {today,enabled:Boolean(settings?.reminders_enabled),reminders:rows};}
function jakartaStores(){db.prepare("INSERT OR IGNORE INTO jakarta_receivable_stores(store_name,created_by) SELECT DISTINCT trim(store_name),'data-piutang' FROM jakarta_receivable_invoices WHERE trim(store_name)<>''").run();return db.prepare('SELECT store_name FROM jakarta_receivable_stores ORDER BY store_name').all().map(row=>row.store_name);}
function saveJakartaStore(data,user){const store=String(data?.store_name||'').trim();if(!store)throw new Error('Nama toko wajib diisi.');db.prepare('INSERT OR IGNORE INTO jakarta_receivable_stores(store_name,created_by) VALUES (?,?)').run(store,user.username);return store;}
function jakartaReceivableOptions(){return {years:db.prepare("SELECT DISTINCT substr(invoice_date,1,4) value FROM jakarta_receivable_invoices WHERE length(invoice_date)>=4 ORDER BY value DESC").all().map(row=>row.value),months:db.prepare("SELECT DISTINCT substr(invoice_date,1,7) value FROM jakarta_receivable_invoices WHERE length(invoice_date)>=7 ORDER BY value DESC").all().map(row=>row.value),stores:jakartaStores()};}
function saveJakartaInvoice(data,user){const items=(Array.isArray(data.items)?data.items:[]).filter(item=>String(item.item_name||'').trim());if(!data.invoice_date||!data.due_date||!String(data.store_name||'').trim()||!items.length)throw new Error('Tanggal, toko, dan sedikitnya satu barang wajib diisi.');const total=items.reduce((sum,item)=>sum+(Number(item.quantity)||0)*(Number(item.unit_price)||0),0),discount=Math.max(0,Number(data.invoice_discount)||0);if(discount>total)throw new Error('Potongan nota tidak boleh melebihi total invoice.');db.exec('BEGIN');try{const id=Number(db.prepare('INSERT INTO jakarta_receivable_invoices(invoice_date,due_date,invoice_number,store_name,city,sales_name,notes,total,invoice_discount,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)').run(data.invoice_date,data.due_date,String(data.invoice_number||''),String(data.store_name).trim(),String(data.city||''),String(data.sales_name||''),String(data.notes||''),total,discount,user.username).lastInsertRowid),insertItem=db.prepare('INSERT INTO jakarta_receivable_items(invoice_id,item_name,quantity,unit_price) VALUES (?,?,?,?)');for(const item of items)insertItem.run(id,String(item.item_name),Number(item.quantity)||0,Number(item.unit_price)||0);db.exec('COMMIT');return id;}catch(error){db.exec('ROLLBACK');throw error;}}
function updateJakartaInvoice(id,data){const current=db.prepare('SELECT id FROM jakarta_receivable_invoices WHERE id=?').get(id);if(!current)throw new Error('Invoice tidak ditemukan.');const items=(Array.isArray(data.items)?data.items:[]).filter(item=>String(item.item_name||'').trim());if(!data.invoice_date||!data.due_date||!String(data.store_name||'').trim()||!items.length)throw new Error('Tanggal, toko, dan sedikitnya satu barang wajib diisi.');const total=items.reduce((sum,item)=>sum+(Number(item.quantity)||0)*(Number(item.unit_price)||0),0),discount=Math.max(0,Number(data.invoice_discount)||0),paid=Number(db.prepare('SELECT COALESCE(SUM(amount),0) paid FROM jakarta_receivable_allocations WHERE invoice_id=?').get(id).paid);if(discount>total)throw new Error('Potongan nota tidak boleh melebihi total invoice.');if(total-discount<paid)throw new Error('Nilai bersih invoice tidak boleh lebih kecil dari pembayaran yang sudah tercatat.');db.exec('BEGIN');try{db.prepare('UPDATE jakarta_receivable_invoices SET invoice_date=?,due_date=?,invoice_number=?,store_name=?,city=?,sales_name=?,notes=?,total=?,invoice_discount=? WHERE id=?').run(data.invoice_date,data.due_date,String(data.invoice_number||''),String(data.store_name).trim(),String(data.city||''),String(data.sales_name||''),String(data.notes||''),total,discount,id);db.prepare('DELETE FROM jakarta_receivable_items WHERE invoice_id=?').run(id);const insertItem=db.prepare('INSERT INTO jakarta_receivable_items(invoice_id,item_name,quantity,unit_price) VALUES (?,?,?,?)');for(const item of items)insertItem.run(id,String(item.item_name),Number(item.quantity)||0,Number(item.unit_price)||0);db.exec('COMMIT');return id;}catch(error){db.exec('ROLLBACK');throw error;}}
function saveJakartaPayment(data,user){const allocations=(Array.isArray(data.allocations)?data.allocations:[]).filter(item=>Number(item.amount)>0),amount=allocations.reduce((sum,item)=>sum+Number(item.amount),0);if(!data.payment_date||!amount)throw new Error('Tanggal dan alokasi pembayaran wajib diisi.');for(const allocation of allocations){const invoice=db.prepare('SELECT total,invoice_discount,COALESCE((SELECT SUM(amount) FROM jakarta_receivable_allocations WHERE invoice_id=?),0) paid FROM jakarta_receivable_invoices WHERE id=?').get(Number(allocation.invoice_id),Number(allocation.invoice_id));if(!invoice)throw new Error('Invoice pembayaran tidak ditemukan.');const available=Math.max(0,(Number(invoice.total)||0)-(Number(invoice.invoice_discount)||0)-(Number(invoice.paid)||0));if(Number(allocation.amount)>available+0.005)throw new Error('Nominal pembayaran melebihi sisa piutang invoice.');}db.exec('BEGIN');try{const id=Number(db.prepare('INSERT INTO jakarta_receivable_payments(payment_date,amount,payment_method,notes,created_by) VALUES (?,?,?,?,?)').run(data.payment_date,amount,String(data.payment_method||''),String(data.notes||''),user.username).lastInsertRowid),insertAllocation=db.prepare('INSERT INTO jakarta_receivable_allocations(payment_id,invoice_id,amount) VALUES (?,?,?)');for(const allocation of allocations)insertAllocation.run(id,Number(allocation.invoice_id),Number(allocation.amount));db.exec('COMMIT');return id;}catch(error){db.exec('ROLLBACK');throw error;}}
function updateJakartaPayment(id,data){if(!db.prepare('SELECT id FROM jakarta_receivable_payments WHERE id=?').get(id))throw new Error('Catatan pembayaran tidak ditemukan.');const paymentDate=String(data?.payment_date||''),method=String(data?.payment_method||'').trim(),notes=String(data?.notes||'').trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate))throw new Error('Tanggal pembayaran wajib diisi.');db.prepare('UPDATE jakarta_receivable_payments SET payment_date=?,payment_method=?,notes=? WHERE id=?').run(paymentDate,method,notes,id);return id;}
function deleteJakartaPayment(id){const result=db.prepare('DELETE FROM jakarta_receivable_payments WHERE id=?').run(id);if(!result.changes)throw new Error('Catatan pembayaran tidak ditemukan.');return {ok:true};}
function syncJakartaSourcePayments(user){const insertPayment=db.prepare('INSERT INTO jakarta_receivable_payments(payment_date,amount,payment_method,notes,created_by) VALUES (?,?,?,?,?)'),insertAllocation=db.prepare('INSERT INTO jakarta_receivable_allocations(payment_id,invoice_id,amount) VALUES (?,?,?)'),created=[];const sourcePayment=/\bKU\s+(?:SITI|CAP)\b/i,anySettlement=/\b(?:KU\s+(?:SITI|CAP)|GIRO|CEK|TF)\b/i,toNumber=value=>Number(String(value||'').replace(/\./g,'').replace(',','.'));db.exec('BEGIN');try{db.prepare("DELETE FROM jakarta_receivable_payments WHERE notes LIKE 'Impor keterangan sumber:%'").run();const rows=db.prepare('SELECT i.*,COALESCE((SELECT SUM(amount) FROM jakarta_receivable_allocations a WHERE a.invoice_id=i.id),0) paid FROM jakarta_receivable_invoices i ORDER BY i.invoice_date,i.id').all(),byStore=new Map();for(const row of rows){const key=String(row.store_name||'').trim().toUpperCase(),list=byStore.get(key)||[];list.push(row);byStore.set(key,list);}for(const invoices of byStore.values())for(let index=0;index<invoices.length;index++){const invoice=invoices[index],note=String(invoice.notes||'').trim();if(!sourcePayment.test(note)||/GABUNG/i.test(note))continue;const amountToken=note.match(/=\s*([\d.]+(?:,\d{1,2})?)/),hasAmount=Boolean(amountToken),target=hasAmount?toNumber(amountToken[1]):Infinity,allocations=[],paymentDate=note.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/),year=String(invoice.invoice_date||'').match(/^(20\d{2})/)?.[1]||String(new Date().getFullYear()),date=paymentDate?`${year}-${String(paymentDate[2]).padStart(2,'0')}-${String(paymentDate[1]).padStart(2,'0')}`:String(invoice.invoice_date||'').slice(0,10);let remaining=Number.isFinite(target)&&target>0?target:Infinity;for(let candidateIndex=index;candidateIndex<invoices.length&&remaining>0.005;candidateIndex++){const candidate=invoices[candidateIndex],candidateNote=String(candidate.notes||'').trim();if(candidateIndex>index&&anySettlement.test(candidateNote))break;const paid=Number(candidate.paid)||0,balance=Math.max(0,(Number(candidate.total)||0)-(Number(candidate.invoice_discount)||0)-paid);if(balance<=0.005)continue;const amount=Math.min(balance,remaining);allocations.push({invoice_id:Number(candidate.id),amount});remaining-=amount;if(!hasAmount)break;}const allocated=allocations.reduce((sum,item)=>sum+item.amount,0);if(allocated<=0.005)continue;const marker=`Impor keterangan sumber: ${note}`,paymentId=Number(insertPayment.run(date,allocated,'KU',marker,user.username).lastInsertRowid);for(const allocation of allocations)insertAllocation.run(paymentId,allocation.invoice_id,allocation.amount);created.push({payment_id:paymentId,invoice_ids:allocations.map(item=>item.invoice_id),amount:allocated,note});}db.exec('COMMIT');return {created:created.length,total:created.reduce((sum,item)=>sum+item.amount,0),items:created};}catch(error){db.exec('ROLLBACK');throw error;}}
function saveJakartaClassification(data,user,id=''){const name=String(data?.name||'').trim(),stores=[...new Set((Array.isArray(data?.stores)?data.stores:[]).map(store=>String(store||'').trim()).filter(Boolean))];if(!name||!stores.length)throw new Error('Nama klasifikasi dan sedikitnya satu toko wajib diisi.');db.exec('BEGIN');try{let target=Number(id);if(target){if(!db.prepare('SELECT id FROM jakarta_receivable_classifications WHERE id=?').get(target))throw new Error('Klasifikasi tidak ditemukan.');db.prepare('UPDATE jakarta_receivable_classifications SET name=? WHERE id=?').run(name,target);db.prepare('DELETE FROM jakarta_receivable_classification_stores WHERE classification_id=?').run(target);}else target=Number(db.prepare('INSERT INTO jakarta_receivable_classifications(name,created_by) VALUES (?,?)').run(name,user.username).lastInsertRowid);const insertStore=db.prepare('INSERT INTO jakarta_receivable_classification_stores(classification_id,store_name) VALUES (?,?)');for(const store of stores)insertStore.run(target,store);db.exec('COMMIT');return target;}catch(error){db.exec('ROLLBACK');if(String(error.message||'').includes('UNIQUE constraint failed: jakarta_receivable_classification_stores.store_name'))throw new Error('Satu toko hanya boleh masuk ke satu klasifikasi khusus.');throw error;}}
function deleteJakartaClassification(id){const result=db.prepare('DELETE FROM jakarta_receivable_classifications WHERE id=?').run(id);if(!result.changes)throw new Error('Klasifikasi tidak ditemukan.');return {ok:true};}
function exportJakartaReceivables(year=String(new Date().getFullYear())){const source=join(tmpdir(),`jakarta-export-${randomUUID()}.json`),output=join(tmpdir(),`piutang-jakarta-${randomUUID()}.xlsx`);try{const report=jakartaReceivables();writeFileSync(source,JSON.stringify({year:String(year),invoices:report.invoices,classifications:report.classifications}));const result=runPython(join(ROOT,'scripts','export_jakarta_receivables.py'),[source,output],'openpyxl');if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Laporan Excel tidak dapat dibuat.');return readFileSync(output);}finally{if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);}}
const label = value => String(value || '').trim() || 'Tidak diketahui';
const dateKey = value => {
  const raw=String(value||'').trim(),iso=raw.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if(iso)return `${iso[1]}-${String(iso[2]).padStart(2,'0')}-${String(iso[3]).padStart(2,'0')}`;
  const local=raw.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if(local)return `${local[3]}-${String(local[2]).padStart(2,'0')}-${String(local[1]).padStart(2,'0')}`;
  // Lazada exports dates as e.g. "31 Aug 2026 10:06". Parse this form
  // before applying the page's date-range filter.
  const months={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
  const named=raw.match(/\b(\d{1,2})\s+([a-z]+)\s+(20\d{2})\b/i);
  if(named&&months[named[2].toLowerCase()])return `${named[3]}-${String(months[named[2].toLowerCase()]).padStart(2,'0')}-${String(named[1]).padStart(2,'0')}`;
  return '';
};
function returnsData(uploadId,start,end) {
  const uploads=db.prepare('SELECT id,file_name,uploaded_at,row_count FROM uploads ORDER BY id DESC').all();
  const activeUpload=uploads.find(x=>x.id===Number(uploadId));
  const lines=activeUpload ? db.prepare('SELECT order_lines.*,uploads.uploaded_at FROM order_lines JOIN uploads ON uploads.id=order_lines.upload_id WHERE upload_id=? ORDER BY order_lines.id').all(activeUpload.id) : db.prepare('SELECT order_lines.*,uploads.uploaded_at FROM order_lines JOIN uploads ON uploads.id=order_lines.upload_id ORDER BY order_lines.id').all();
  // Use the same eligibility fields as the reference workbook: TikTok's
  // Shipped Time, Shopee's Waktu Pengiriman Diatur, and Lazada's tracking URL.
  // The importer stores that source-specific eligibility value in `delivered`.
  const filteredLines=lines.filter(row=>{const date=dateKey(row.order_date)||dateKey(row.delivered)||dateKey(row.uploaded_at),isEligible=Boolean(String(row.delivered||'').trim());return isEligible&&(!start||date>=start)&&(!end||date<=end);});
  // The source workbook measures transactions/shipments by line, not by a
  // de-duplicated order ID. One order can contain several SKU lines and each
  // line must remain in the cancel/return numerator and denominator.
  const markets=new Map(), stores=new Map(), couriers=new Map(), total={name:'Total',sales:0,cancel:0,returned:0};
  const add=(map,name,state)=>{ const key=label(name), item=map.get(key)||{name:key,sales:0,cancel:0,returned:0}; item.sales+=1; if(state.canceled)item.cancel+=1; if(state.returned)item.returned+=1; map.set(key,item); };
  for(const row of filteredLines) { const state=classify(row); total.sales+=1; if(state.canceled)total.cancel+=1; if(state.returned)total.returned+=1; add(markets,row.source,state); add(stores,row.store,state); add(couriers,row.courier,state); }
  const present=item=>{ const sales=item.sales,cancel=item.cancel,returned=item.returned; return {name:item.name,sales,cancel,returned,cancelRate:sales?cancel/sales:0,returnRate:sales?returned/sales:0}; };
  const list=map=>[...map.values()].map(present).sort((a,b)=>b.sales-a.sales||b.cancel-a.cancel);
  const summary=present(total);
  return {summary,uploads,activeUpload:activeUpload?.id||null,start:start||'',end:end||'',marketplaces:list(markets),stores:list(stores),couriers:list(couriers),storeIssues:list(stores).sort((a,b)=>b.cancel-a.cancel||b.returned-a.returned)};
}
function rebuildReturnData() {
  const uploads=db.prepare('SELECT id,file_name,file_data FROM uploads ORDER BY id').all();
  if(!uploads.length) throw new Error('Belum ada berkas sumber untuk dibangun ulang.');
  const insert=db.prepare('INSERT INTO order_lines (upload_id,source,store,courier,order_id,status,substatus,cancel_reason,tracking,delivered,order_date,sku,product_name,quantity,returned_qty,refund_amount,province,city) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  db.exec('DELETE FROM order_lines');
  for(const upload of uploads) { const temp=join(tmpdir(),`cap-rebuild-${randomUUID()}.xlsx`), parsed=`${temp}.json`; try { writeFileSync(temp,upload.file_data); const result=runPython(join(ROOT,'scripts','extract_sales_excel.py'),[temp,parsed]); if(result.status!==0) throw new Error(result.stderr||'Berkas sumber tidak dapat diproses.'); const items=JSON.parse(readFileSync(parsed,'utf8')).items; db.exec('BEGIN'); try { for(const x of items) insert.run(upload.id,x.source,x.store,x.courier,x.order_id,x.status,x.substatus,x.cancel_reason,x.tracking,x.delivered,x.order_date,x.sku,x.product_name,x.quantity,x.returned_qty,x.refund_amount,x.province,x.city); db.exec('COMMIT'); } catch(error) { db.exec('ROLLBACK'); throw error; } } finally { if(existsSync(temp))unlinkSync(temp); if(existsSync(parsed))unlinkSync(parsed); } }
  return returnsData();
}
function warehouseData(section = '') {
  const chosen = ['Packing', 'Servis', 'Produksi'].includes(section) ? section : '';
  const where = chosen ? ' WHERE section = ?' : '';
  const parameters = chosen ? [chosen] : [];
  const legacy = db.prepare(`SELECT id,activity_date,section,shift,activity,area,staff,quantity,notes,created_at FROM warehouse_activities${where}`).all(...parameters);
  const reports = db.prepare(`SELECT id,activity_date,section,leader,member_count,online_total,offline_total,total_units,receipt_count,notes,image_name,created_at FROM warehouse_reports${where}`).all(...parameters).map(row => ({
    id: `report-${row.id}`, activity_date: row.activity_date, section: row.section, shift: 'Laporan gambar', activity: row.section === 'Servis' ? 'QC & Servis' : `Laporan ${row.section}`, area: row.section === 'Servis' ? `Retur masuk: ${row.receipt_count||'belum terbaca'}` : (row.receipt_count ? `Retur masuk: ${row.receipt_count}` : 'Laporan gambar'), staff: row.leader || 'Leader belum terbaca', quantity: Number(row.online_total||0)+Number(row.offline_total||0), notes: `${row.member_count || 0} anggota · Online ${row.online_total||0} · Offline ${row.offline_total||0}${row.notes ? ` · ${row.notes}` : ''}`, image_id: row.id, image_name: row.image_name, created_at: row.created_at
  }));
  const all = [...legacy, ...reports];
  const records = [...all].sort((a,b) => String(b.activity_date).localeCompare(String(a.activity_date)) || String(b.created_at).localeCompare(String(a.created_at))).slice(0,100);
  const activities = new Map(), areas = new Map(), staff = new Set();
  let units = 0;
  for (const row of all) {
    const quantity = Number(row.quantity) || 0; units += quantity; staff.add(row.staff);
    const activity = activities.get(row.activity) || { activity: row.activity, records: 0, units: 0 };
    activity.records++; activity.units += quantity; activities.set(row.activity, activity);
    const area = areas.get(row.area) || { area: row.area, records: 0, units: 0 };
    area.records++; area.units += quantity; areas.set(row.area, area);
  }
  const sorted = map => [...map.values()].sort((a,b) => b.units - a.units || b.records - a.records);
  return { section: chosen, summary: { activities: all.length, units, staff: staff.size, areas: areas.size }, records, byActivity: sorted(activities), byArea: sorted(areas) };
}
function onlineShopFilters(params={}) {
  const start=/^\d{4}-\d{2}-\d{2}$/.test(String(params.start||''))?String(params.start):'';
  const end=/^\d{4}-\d{2}-\d{2}$/.test(String(params.end||''))?String(params.end):'';
  return {start,end,store:String(params.store||'').trim().slice(0,120),product:String(params.product||'').trim().slice(0,160)};
}
function onlineShopWhere(filters) {
  return {sql:"WHERE (?='' OR input_date>=?) AND (?='' OR input_date<=?) AND (?='' OR store_name=?) AND (?='' OR product_name=?)",args:[filters.start,filters.start,filters.end,filters.end,filters.store,filters.store,filters.product,filters.product]};
}
function onlineShopData(params={}) {
  const filters=onlineShopFilters(params),where=onlineShopWhere(filters);
  const reports=db.prepare(`SELECT id,input_date,store_name,product_name,marketplace,issue_notes,created_at FROM online_shop_reports ${where.sql} ORDER BY input_date DESC,id DESC`).all(...where.args);
  const media=db.prepare(`SELECT id,report_id,original_name,media_type,mime_type,original_size,stored_size FROM online_shop_report_media WHERE report_id IN (SELECT id FROM online_shop_reports ${where.sql}) ORDER BY id`).all(...where.args);
  const mediaByReport=new Map();for(const item of media){const list=mediaByReport.get(item.report_id)||[];list.push(item);mediaByReport.set(item.report_id,list);}
  const choices={stores:db.prepare('SELECT DISTINCT store_name AS value FROM online_shop_reports WHERE trim(store_name)<>\'\' ORDER BY store_name COLLATE NOCASE').all().map(x=>x.value),products:db.prepare('SELECT DISTINCT product_name AS value FROM online_shop_reports WHERE trim(product_name)<>\'\' ORDER BY product_name COLLATE NOCASE').all().map(x=>x.value)};
  return {filters,reports:reports.map(item=>({...item,media:mediaByReport.get(item.id)||[]})),choices};
}
function saveOnlineShopReport(data) {
  const store=String(data.store_name||'').trim().slice(0,120),product=String(data.product_name||'').trim().slice(0,160),marketplace=String(data.marketplace||'').trim().slice(0,80),notes=String(data.issue_notes||'').trim().slice(0,2000);
  if(!store||!product||!marketplace)throw new Error('Nama toko, nama barang, dan marketplace wajib diisi.');
  const id=Number(db.prepare("INSERT INTO online_shop_reports (input_date,store_name,product_name,marketplace,issue_notes) VALUES (date('now','localtime'),?,?,?,?)").run(store,product,marketplace,notes).lastInsertRowid);
  return {id,input_date:db.prepare('SELECT input_date FROM online_shop_reports WHERE id=?').get(id).input_date};
}
function saveOnlineShopMedia(reportId,buffer,name,mimeType='application/octet-stream') {
  const report=db.prepare('SELECT id FROM online_shop_reports WHERE id=?').get(Number(reportId));if(!report)throw new Error('Laporan tidak ditemukan.');
  const safeName=String(name||'berkas').replace(/[^\w .()\-]/g,'_').slice(0,180),isImage=/\.(png|jpe?g|webp)$/i.test(safeName),isVideo=/\.(mp4|mov|webm|m4v)$/i.test(safeName);
  if(!isImage&&!isVideo)throw new Error('Unggah gambar PNG/JPG/WEBP atau video MP4/MOV/WEBM.');if(!Buffer.isBuffer(buffer)||!buffer.length)throw new Error('Berkas belum dipilih.');
  let stored=buffer,storedMime=mimeType.slice(0,80)||'application/octet-stream',storedName=safeName;
  if(isImage){const source=join(tmpdir(),`cap-online-image-${randomUUID()}${extname(safeName)||'.jpg'}`),output=`${source}.jpg`;try{writeFileSync(source,buffer);const result=runPython(join(ROOT,'scripts','compress_online_shop_image.py'),[source,output]);if(!result.error&&result.status===0&&existsSync(output)){stored=readFileSync(output);storedMime='image/jpeg';storedName=safeName.replace(/\.[^.]+$/,'')+'.jpg';}}finally{if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);}}
  const id=Number(db.prepare('INSERT INTO online_shop_report_media (report_id,original_name,media_type,mime_type,media_data,original_size,stored_size) VALUES (?,?,?,?,?,?,?)').run(report.id,storedName,isImage?'image':'video',storedMime,stored,buffer.length,stored.length).lastInsertRowid);
  return {id,report_id:report.id,original_name:storedName,media_type:isImage?'image':'video',mime_type:storedMime,original_size:buffer.length,stored_size:stored.length};
}
function exportOnlineShopExcel(filters) { const source=join(tmpdir(),`cap-online-shop-${randomUUID()}.json`),output=join(tmpdir(),`cap-online-shop-${randomUUID()}.xlsx`);try{writeFileSync(source,JSON.stringify(onlineShopData(filters)));const result=runPython(join(ROOT,'scripts','export_online_shop_reports.py'),[source,output]);if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Excel pelaporan tidak dapat dibuat.');return readFileSync(output);}finally{if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);}}
function exportOnlineShopVideos(filters) { const source=join(tmpdir(),`cap-online-shop-video-${randomUUID()}.json`),output=join(tmpdir(),`cap-online-shop-video-${randomUUID()}.zip`);try{writeFileSync(source,JSON.stringify({database:join(DATA,'app.db'),filters:onlineShopFilters(filters)}));const result=runPython(join(ROOT,'scripts','export_online_shop_videos.py'),[source,output]);if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Video tidak dapat diekspor.');return readFileSync(output);}finally{if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);}}
function onlineShopScanFilters(params={}){const period=['month','year','range'].includes(String(params.period||''))?String(params.period):'month',month=/^\d{4}-(0[1-9]|1[0-2])$/.test(String(params.month||''))?String(params.month):'',year=/^\d{4}$/.test(String(params.year||''))?String(params.year):'',startMonth=/^\d{4}-(0[1-9]|1[0-2])$/.test(String(params.start_month||''))?String(params.start_month):'',endMonth=/^\d{4}-(0[1-9]|1[0-2])$/.test(String(params.end_month||''))?String(params.end_month):'',status=String(params.status||'').trim().slice(0,80),tracking=String(params.tracking||'').trim().toUpperCase().slice(0,120),page=Math.max(1,Number.parseInt(params.page,10)||1);let start='',end='';if(period==='month'&&month){start=`${month}-01`;const [y,m]=month.split('-').map(Number);end=`${month}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`;}if(period==='year'&&year){start=`${year}-01-01`;end=`${year}-12-31`;}if(period==='range'&&startMonth&&endMonth){if(startMonth>endMonth)throw new Error('Bulan akhir harus sama atau setelah bulan mulai.');start=`${startMonth}-01`;const [y,m]=endMonth.split('-').map(Number);end=`${endMonth}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`;}return {period,month,year,start_month:startMonth,end_month:endMonth,start,end,status,tracking,page};}
function onlineShopScanData(params={}){const filters=onlineShopScanFilters(params),where="WHERE (?='' OR scan_date>=?) AND (?='' OR scan_date<=?) AND (?='' OR shipping_status=?) AND (?='' OR tracking_number LIKE '%'||?||'%')",args=[filters.start,filters.start,filters.end,filters.end,filters.status,filters.status,filters.tracking,filters.tracking],pageSize=50,total=Number(db.prepare(`SELECT COUNT(*) AS count FROM online_shop_scan_resi ${where}`).get(...args).count),pages=Math.max(1,Math.ceil(total/pageSize)),page=Math.min(filters.page,pages),records=db.prepare(`SELECT id,tracking_number,scan_date,shipping_status,completed_date,source_sheet FROM online_shop_scan_resi ${where} ORDER BY scan_date DESC,id DESC LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize),statuses=db.prepare("SELECT DISTINCT shipping_status AS value FROM online_shop_scan_resi WHERE trim(shipping_status)<>'' ORDER BY shipping_status COLLATE NOCASE").all().map(item=>item.value);return {filters:{...filters,page},records,statuses,pagination:{page,pageSize,total,pages}};}
function importOnlineShopScans(buffer,name){const originalName=String(name||'scan-resi.xlsx').replace(/[^\w .()\-]/g,'_').slice(0,180);if(!/\.xlsx$/i.test(originalName))throw new Error('Gunakan berkas Excel .xlsx.');if(!Buffer.isBuffer(buffer)||!buffer.length)throw new Error('Berkas Excel belum dipilih.');if(buffer.length>15*1024*1024)throw new Error('Ukuran berkas maksimal 15 MB.');const source=join(tmpdir(),`cap-scan-resi-${randomUUID()}.xlsx`),resultFile=`${source}.json`;try{writeFileSync(source,buffer);const result=runPython(join(ROOT,'scripts','import_online_shop_scans.py'),[source,resultFile],'openpyxl');if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Berkas scan resi tidak dapat diproses.');const payload=JSON.parse(readFileSync(resultFile,'utf8')),rows=Array.isArray(payload.records)?payload.records:[];if(!rows.length)throw new Error('Tidak ada nomor resi valid yang ditemukan pada berkas.');const insert=db.prepare("INSERT INTO online_shop_scan_resi (tracking_number,scan_date,source_sheet) VALUES (?,?,?) ON CONFLICT(tracking_number) DO UPDATE SET scan_date=MIN(online_shop_scan_resi.scan_date,excluded.scan_date),source_sheet=CASE WHEN excluded.scan_date<online_shop_scan_resi.scan_date THEN excluded.source_sheet ELSE online_shop_scan_resi.source_sheet END,updated_at=CURRENT_TIMESTAMP"),saveImport=db.prepare('INSERT INTO online_shop_scan_imports (original_name,file_data,imported_count,duplicate_count) VALUES (?,?,?,?)'),existing=db.prepare('SELECT 1 FROM online_shop_scan_resi WHERE tracking_number=?'),transaction=db.transaction(()=>{let imported=0,duplicates=0;for(const row of rows){if(existing.get(row.tracking_number))duplicates++;else imported++;insert.run(row.tracking_number,row.scan_date,row.source_sheet);}saveImport.run(originalName,buffer,imported,duplicates);return {imported,duplicates,total:rows.length,sheets:payload.sheets||[]};});return transaction();}finally{if(existsSync(source))unlinkSync(source);if(existsSync(resultFile))unlinkSync(resultFile);}}
const payrollNet = row => {
  const gross = Number(row.daily_wage || 0) * Number(row.attendance_actual || 0);
  const overtimePay = (Number(row.overtime_normal || 0) + Number(row.overtime_special || 0)) * Number(row.overtime_rate || 0);
  return { ...row, gross_pay: gross, overtime_pay: overtimePay, net_pay: gross - Number(row.deduction || 0) + overtimePay };
};
function payrollPayment(value) {
  return ['cash','transfer','keluar'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'all';
}
const shiftDefinitions={
  pagi1:{label:'Pagi1',start:480,end:990,full:450,half:180}, siang1:{label:'Siang1',start:780,end:1290,full:450,half:180},
  sabtu_p2:{label:'SabtuP2',start:480,end:960,full:420,half:180}, sabtu_s2:{label:'SabtuS2',start:780,end:1260,full:420,half:180},
  malam12:{label:'12Malam',start:0,end:720,full:720,half:360}, siang12:{label:'12Siang',start:720,end:1440,full:720,half:360}
};
const timeMinutes=value=>{const match=/^([01]\d|2[0-4]):([0-5]\d)$/.exec(String(value||''));return match&&!(match[1]==='24'&&match[2]!=='00')?Number(match[1])*60+Number(match[2]):null;};
const circularDifference=(first,second)=>Math.abs(first-second);
function shiftOverrideFor(employeeId,date){return db.prepare('SELECT shift_code FROM payroll_attendance_shift_overrides WHERE employee_id=? AND attendance_date=?').get(String(employeeId),String(date))?.shift_code||'';}
function shiftEventFor(employeeId,date,paymentModel){
  if(paymentModel!=='transfer')return false;
  return Boolean(db.prepare(`SELECT 1 FROM payroll_shift_events event JOIN payroll_shift_event_members member ON member.event_id=event.id
    WHERE member.employee_id=? AND event.start_date<=? AND event.end_date>=? LIMIT 1`).get(String(employeeId),String(date),String(date)));
}
function evaluateAttendanceShift(log) {
  const date=String(log?.attendance_date||''),day=/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(`${date}T00:00:00`).getDay():1;
  const payment=String(log?.payment_model||'').toLowerCase(),department=String(log?.department||'').toLowerCase();
  const forced=shiftOverrideFor(log?.employee_id,date),event=shiftEventFor(log?.employee_id,date,payment);
  let candidates=[];
  if(forced&&shiftDefinitions[forced])candidates=[forced];
  else if(event)candidates=['malam12','siang12'];
  else if(day===6)candidates=['sabtu_p2','sabtu_s2'];
  else if(payment==='cash'&&!department.includes('security'))candidates=['pagi1'];
  else candidates=['pagi1','siang1'];
  const clockIn=timeMinutes(log?.clock_in),clockOut=timeMinutes(log?.clock_out);
  const comparableOut=clockOut===0?1440:clockOut;
  const choose=(keyA,keyB)=>{
    const a=shiftDefinitions[keyA],b=shiftDefinitions[keyB];
    const aOut=clockOut===null?Infinity:circularDifference(comparableOut,a.end),bOut=clockOut===null?Infinity:circularDifference(comparableOut,b.end);
    if(aOut!==bOut)return aOut-bOut;
    const aIn=clockIn===null?Infinity:circularDifference(clockIn,a.start),bIn=clockIn===null?Infinity:circularDifference(clockIn,b.start);
    return aIn-bIn;
  };
  const code=[...candidates].sort(choose)[0]||'pagi1',shift=shiftDefinitions[code];
  let actual=null;if(clockIn!==null&&clockOut!==null){actual=comparableOut-clockIn;if(actual<0)actual+=1440;}
  const nearStart=clockIn!==null&&circularDifference(clockIn,shift.start)<=90,nearEnd=clockOut!==null&&circularDifference(comparableOut,shift.end)<=90;
  const half=actual!==null&&actual>=shift.half&&actual<shift.full;
  return {code,label:shift.label,start:shift.start,end:shift.end,full:shift.full,halfMinimum:shift.half,actual,half,halfSide:half?(nearEnd?'clock_in':nearStart?'clock_out':'clock_in'):'',late:actual!==null&&actual>=shift.full&&clockIn>shift.start+5,event};
}
function attendanceCredit(log) {
  // Perjalanan dinas adalah keputusan kehadiran tertinggi: log mesin tetap
  // ditampilkan, namun hari kerja dan potongan tidak mengikuti jam log itu.
  if(log?.business_trip_id)return { credit: 1, workedMinutes: null, halfDay: false, shift:null };
  const manual={full:1,half:0.5,absent:0}[String(log.admin_attendance_status||'')];
  if(manual!==undefined){const halfSide=String(log.admin_forgot_scope||'')==='out'?'clock_out':'clock_in';return { credit: manual, workedMinutes: null, halfDay: manual===0.5, shift:evaluateAttendanceShift(log), halfSide:manual===0.5?halfSide:'' };}
  if (String(log.clock_in_note||'').trim().toUpperCase().includes('TUKAR HARI') || String(log.clock_out_note||'').trim().toUpperCase().includes('TUKAR HARI')) return { credit: 1, workedMinutes: null, halfDay: false, shift:evaluateAttendanceShift(log) };
  const shift=evaluateAttendanceShift(log),start=timeMinutes(log.clock_in),finish=timeMinutes(log.clock_out);
  if(start===null||finish===null)return { credit: 0, workedMinutes: null, halfDay: false, shift };
  if(start===finish)return { credit: shift.code.startsWith('sabtu')?1:0, workedMinutes: null, halfDay: false, shift };
  return { credit:shift.actual>=shift.full?1:shift.half?0.5:0, workedMinutes:shift.actual, halfDay:shift.half, halfSide:shift.halfSide, shift };
}
function shiftEventData(){
  const membersByEvent=new Map();for(const row of db.prepare('SELECT event_id,employee_id FROM payroll_shift_event_members ORDER BY event_id,employee_id').all()){const members=membersByEvent.get(Number(row.event_id))||[];members.push(String(row.employee_id));membersByEvent.set(Number(row.event_id),members);}
  return db.prepare('SELECT id,event_name,start_date,end_date,created_at FROM payroll_shift_events ORDER BY start_date DESC,id DESC').all().map(event=>({...event,members:membersByEvent.get(Number(event.id))||[]}));
}
function saveShiftEvent(data){
  const name=String(data.event_name||'Event khusus').trim().slice(0,100)||'Event khusus',start=String(data.start_date||''),end=String(data.end_date||''),members=[...new Set((Array.isArray(data.members)?data.members:[]).map(String).filter(Boolean))];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||end<start)throw new Error('Rentang tanggal Event Khusus tidak valid.');
  if(!members.length)throw new Error('Pilih minimal satu karyawan Transfer untuk Event Khusus.');
  const eligible=new Set(db.prepare("SELECT employee_id FROM payroll_employee_groups WHERE payment_model='transfer'").all().map(row=>String(row.employee_id)));
  if(members.some(id=>!eligible.has(id)))throw new Error('Event Khusus 12 jam hanya dapat diatur untuk karyawan Transfer.');
  db.exec('BEGIN');try{const result=db.prepare('INSERT INTO payroll_shift_events (event_name,start_date,end_date) VALUES (?,?,?)').run(name,start,end),eventId=Number(result.lastInsertRowid),insert=db.prepare('INSERT INTO payroll_shift_event_members (event_id,employee_id) VALUES (?,?)');for(const id of members)insert.run(eventId,id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  return shiftEventData();
}
function deleteShiftEvent(id){const eventId=Number(id);db.prepare('DELETE FROM payroll_shift_event_members WHERE event_id=?').run(eventId);const result=db.prepare('DELETE FROM payroll_shift_events WHERE id=?').run(eventId);if(!result.changes)throw new Error('Event Khusus tidak ditemukan.');return shiftEventData();}
function canonicalPayrollRecords(records) {
  const byId = db.prepare('SELECT employee_id FROM payroll_employee_groups WHERE employee_id=?');
  const byName = db.prepare('SELECT employee_id FROM payroll_employee_groups WHERE lower(employee_name)=lower(?) ORDER BY employee_id LIMIT 1');
  const canonical=records.map(row => {
    const known = byId.get(String(row.employee_id || '').trim()) || byName.get(String(row.name || '').trim());
    return known ? { ...row, employee_id: known.employee_id } : row;
  });
  // Satu karyawan hanya boleh mempunyai satu rekap pada satu file impor.
  // Ini terutama penting ketika Excel memuat kode lama dan kode aktif dengan
  // nama yang sama: setelah disamakan ke ID aktif, keduanya sebelumnya masuk
  // sebagai dua baris dan menggandakan hari kerja maupun gaji.
  const unique=new Map();
  for(const row of canonical){
    const id=String(row.employee_id||'').trim();
    if(id&&!unique.has(id))unique.set(id,row);
  }
  return [...unique.values()];
}
function syncPayrollEmployees(records) {
  const insert = db.prepare('INSERT OR IGNORE INTO payroll_employee_groups (employee_id,employee_name,department) VALUES (?,?,?)');
  const update = db.prepare("UPDATE payroll_employee_groups SET employee_name=?, department=CASE WHEN department_locked=1 THEN department ELSE ? END, updated_at=CURRENT_TIMESTAMP WHERE employee_id=?");
  for (const row of records) {
    const id = String(row.employee_id || '').trim();
    if (!id) continue;
    insert.run(id, String(row.name || '').trim(), String(row.department || '').trim());
    update.run(String(row.name || '').trim(), String(row.department || '').trim(), id);
  }
}
function payrollData(uploadId, payment='all') {
  const paymentModel = payrollPayment(payment);
  const uploads = db.prepare('SELECT id,file_name,period,uploaded_at,row_count FROM payroll_uploads ORDER BY id DESC').all();
  const activeUpload = uploads.find(x => x.id === Number(uploadId)) || uploads[0];
  let allRecords = activeUpload ? db.prepare(`SELECT payroll_records.*, COALESCE(payroll_employee_groups.payment_model,'unclassified') AS payment_model FROM payroll_records LEFT JOIN payroll_employee_groups USING(employee_id) WHERE upload_id=? ORDER BY name`).all(activeUpload.id).map(payrollNet) : [];
  const attendanceLogs = activeUpload ? db.prepare(`SELECT payroll_attendance_logs.attendance_date,payroll_attendance_logs.clock_in,payroll_attendance_logs.clock_out,payroll_attendance_logs.raw_times,payroll_records.name,payroll_records.department,payroll_records.employee_id FROM payroll_attendance_logs JOIN payroll_records ON payroll_records.upload_id=payroll_attendance_logs.upload_id AND payroll_records.employee_id=payroll_attendance_logs.employee_id WHERE payroll_attendance_logs.upload_id=? ORDER BY attendance_date DESC,name`).all(activeUpload.id) : [];
  const databaseRecords = db.prepare("SELECT payroll_employee_groups.employee_id,payroll_employee_groups.employee_name AS name,COALESCE(payroll_employee_groups.department,'') AS department,payroll_employee_groups.payment_model,payroll_employee_groups.daily_wage,payroll_employee_groups.monthly_basic,payroll_employee_groups.monthly_premium,0 AS overtime_normal,0 AS overtime_special,0 AS overtime_rate,0 AS deduction FROM payroll_employee_groups WHERE payment_model IN ('cash','transfer') ORDER BY employee_name COLLATE NOCASE").all();
  const historicalAttendanceLogs = db.prepare("SELECT payroll_attendance_logs.attendance_date,payroll_attendance_logs.clock_in,payroll_attendance_logs.clock_out,payroll_attendance_logs.raw_times,payroll_records.name,payroll_records.department,payroll_records.employee_id,COALESCE((SELECT clock_in_note FROM payroll_attendance_notes note WHERE note.employee_id=payroll_attendance_logs.employee_id AND note.attendance_date=payroll_attendance_logs.attendance_date),'') AS clock_in_note,COALESCE((SELECT clock_out_note FROM payroll_attendance_notes note WHERE note.employee_id=payroll_attendance_logs.employee_id AND note.attendance_date=payroll_attendance_logs.attendance_date),'') AS clock_out_note,COALESCE((SELECT notes FROM payroll_attendance_issues note WHERE note.employee_id=payroll_attendance_logs.employee_id AND note.attendance_date=payroll_attendance_logs.attendance_date AND TRIM(COALESCE(note.notes,''))<>'' ORDER BY note.id DESC LIMIT 1),'') AS admin_note,COALESCE((SELECT status FROM payroll_attendance_issues issue WHERE issue.employee_id=payroll_attendance_logs.employee_id AND issue.attendance_date=payroll_attendance_logs.attendance_date AND issue.status<>'warning' ORDER BY issue.resolved_at DESC,issue.id DESC LIMIT 1),'') AS admin_issue_status FROM payroll_attendance_logs JOIN payroll_records ON payroll_records.upload_id=payroll_attendance_logs.upload_id AND payroll_records.employee_id=payroll_attendance_logs.employee_id WHERE payroll_attendance_logs.upload_id=(SELECT MAX(previous_log.upload_id) FROM payroll_attendance_logs previous_log WHERE previous_log.employee_id=payroll_attendance_logs.employee_id AND previous_log.attendance_date=payroll_attendance_logs.attendance_date) ORDER BY attendance_date DESC,name").all();
  const attendanceIssueMeta=new Map();for(const issue of db.prepare("SELECT employee_id,attendance_date,status,correction_type,forgot_scope,attendance_status,notes FROM payroll_attendance_issues ORDER BY id").all())attendanceIssueMeta.set(`${issue.employee_id}|${issue.attendance_date}`,issue);for(const log of historicalAttendanceLogs){const issue=attendanceIssueMeta.get(`${log.employee_id}|${log.attendance_date}`);if(issue){log.admin_issue_status=issue.status;log.admin_correction_type=issue.correction_type||'';log.admin_forgot_scope=issue.forgot_scope||'';log.admin_attendance_status=issue.attendance_status||'';if(String(issue.notes||'').trim())log.admin_note=issue.notes;}}
  const attendanceIssues = activeUpload ? db.prepare("SELECT payroll_attendance_issues.*,payroll_records.id AS record_id,payroll_records.name,payroll_records.department FROM payroll_attendance_issues JOIN payroll_records ON payroll_records.upload_id=payroll_attendance_issues.upload_id AND payroll_records.employee_id=payroll_attendance_issues.employee_id WHERE payroll_attendance_issues.upload_id=? ORDER BY attendance_date DESC,name").all(activeUpload.id) : [];
  const activeRecords = allRecords.filter(row => row.payment_model !== 'keluar');
  const records = paymentModel === 'all' ? activeRecords : activeRecords.filter(row => row.payment_model === paymentModel);
  const employees = db.prepare("SELECT employee_id,employee_name,department,payment_model,daily_wage,monthly_basic,monthly_premium FROM payroll_employee_groups ORDER BY employee_name COLLATE NOCASE").all();
  const statusHistory=db.prepare('SELECT employee_id,effective_date,payment_model FROM payroll_employee_status_history ORDER BY employee_id,effective_date').all();
  // Tambahkan penanda perjalanan dinas ke baris log yang sudah ada, atau buat
  // baris tampilan bila hari tersebut memang tidak memiliki log mesin.
  const employeeById=new Map(employees.map(row=>[String(row.employee_id),row]));
  const historyByEmployee=new Map();for(const row of statusHistory){const items=historyByEmployee.get(String(row.employee_id))||[];items.push(row);historyByEmployee.set(String(row.employee_id),items);}
  const statusAt=(employeeId,date)=>{let status=employeeById.get(String(employeeId))?.payment_model||'unclassified';for(const row of historyByEmployee.get(String(employeeId))||[]){if(row.effective_date>date)break;status=row.payment_model;}return status;};
  for(const log of historicalAttendanceLogs){
    // Nama bagian dari file mesin tidak selalu sama dengan klasifikasi master
    // (contoh Teguh: "Depart 10" vs Security). Shift dan potongan wajib
    // memakai bagian master agar shift siang tidak dibaca sebagai shift pagi.
    log.department=employeeById.get(String(log.employee_id))?.department||log.department;
    log.payment_model=statusAt(log.employee_id,log.attendance_date);
    log.shift_override=shiftOverrideFor(log.employee_id,log.attendance_date);
    log.shift_evaluation=evaluateAttendanceShift(log);
    const credit=attendanceCredit(log);log.attendance_credit=credit.credit;log.half_day_side=credit.halfSide||'';
  }
  const tripLogs=businessTripAttendance(employeeById,statusAt);
  const existingLogs=new Map(historicalAttendanceLogs.map(log=>[`${log.employee_id}|${log.attendance_date}`,log]));
  for(const trip of tripLogs){const key=`${trip.employee_id}|${trip.attendance_date}`,existing=existingLogs.get(key);if(existing){existing.business_trip_id=trip.business_trip_id;existing.business_trip_name=trip.business_trip_name;existing.business_trip_notes=trip.business_trip_notes;}else{historicalAttendanceLogs.push(trip);existingLogs.set(key,trip);}}
  for(const log of historicalAttendanceLogs){if(!log.payment_model)log.payment_model=statusAt(log.employee_id,log.attendance_date);if(!log.shift_evaluation)log.shift_evaluation=evaluateAttendanceShift(log);const credit=attendanceCredit(log);log.attendance_credit=credit.credit;log.half_day_side=credit.halfSide||'';log.payroll_deduction=payrollLateDeduction(log);}
  // Rekap Excel lama pernah membawa akumulasi potongan sebagai nilai tetap
  // di payroll_records. Nilai itu tidak boleh dikirim lagi ke layar karena
  // dapat menggandakan potongan saat file diperbarui. Selalu bangun kembali
  // dari log harian yang sudah dinormalisasi di atas.
  const recalculatedDeductions=new Map();
  for(const log of historicalAttendanceLogs){
    const id=String(log.employee_id),current=recalculatedDeductions.get(id)||0;
    recalculatedDeductions.set(id,current+Number(log.payroll_deduction||0));
  }
  allRecords=allRecords.map(row=>payrollNet({...row,deduction:Number(recalculatedDeductions.get(String(row.employee_id))||0)}));
  historicalAttendanceLogs.sort((a,b)=>String(b.attendance_date).localeCompare(String(a.attendance_date))||String(a.name).localeCompare(String(b.name),'id'));
  const periodOverrides=db.prepare('SELECT employee_id,period_start,period_end,attendance_actual,daily_wage,deduction,notes FROM payroll_period_overrides ORDER BY period_start,period_end,employee_id').all();
  const allowances = db.prepare("SELECT payroll_allowances.*,COALESCE((SELECT json_group_array(employee_id) FROM payroll_allowance_recipients WHERE allowance_id=payroll_allowances.id),'[]') AS recipients FROM payroll_allowances ORDER BY id DESC").all().map(row=>({...row,recipients:JSON.parse(row.recipients||'[]')}));
  const cashMonthlyPremium=Number(db.prepare("SELECT setting_value FROM payroll_settings WHERE setting_key='cash_monthly_premium'").get()?.setting_value||0);
  const payrollCutoffDay=Number(db.prepare("SELECT setting_value FROM payroll_settings WHERE setting_key='payroll_cutoff_day'").get()?.setting_value||25);
  const cashOvertimeHourlyRate=Number(db.prepare("SELECT setting_value FROM payroll_settings WHERE setting_key='cash_overtime_hourly_rate'").get()?.setting_value||0),cashOvertimeMinMinutes=Number(db.prepare("SELECT setting_value FROM payroll_settings WHERE setting_key='cash_overtime_min_minutes'").get()?.setting_value||30);
  const manualOvertime=db.prepare("SELECT overtime.id,overtime.overtime_date,overtime.employee_id,overtime.duration_hours,employee.employee_name AS name,COALESCE(employee.department,'') AS department FROM payroll_manual_overtime overtime JOIN payroll_employee_groups employee ON employee.employee_id=overtime.employee_id WHERE employee.payment_model='cash' ORDER BY overtime.overtime_date DESC,employee.employee_name COLLATE NOCASE").all();
  const total = records.reduce((sum, row) => sum + row.net_pay, 0);
  const overtime = records.reduce((sum, row) => sum + row.overtime_pay, 0);
  const deductions = records.reduce((sum, row) => sum + Number(row.deduction || 0), 0);
  return { uploads, activeUpload: activeUpload?.id || null, period: activeUpload?.period || '', paymentModel, records, databaseRecords, employees, statusHistory, periodOverrides, allowances, cashMonthlyPremium, payrollCutoffDay, cashOvertimeHourlyRate, cashOvertimeMinMinutes, manualOvertime, businessTrips:businessTripData(), shiftEvents:shiftEventData(), attendanceLogs: historicalAttendanceLogs, attendanceIssues, summary: { employees: records.length, total, overtime, deductions } };
}
function importPayrollExcel(fileData, fileName, dailyWage=95000, overtimeRate=0, payment='all') {
  const suffix = extname(fileName).toLowerCase() || '.xls', temp = join(tmpdir(), `cap-payroll-${randomUUID()}${suffix}`), parsed = `${temp}.json`;
  try {
    writeFileSync(temp, fileData);
    const result=runPython(join(ROOT,'scripts','extract_payroll_excel.py'),[temp,parsed]);
    if(result.error) throw result.error;
    if(result.status!==0) throw new Error(result.stderr||'Excel absensi tidak dapat diproses.');
    const parsedData=JSON.parse(readFileSync(parsed,'utf8'));
    const normalizedRecords = canonicalPayrollRecords(parsedData.records);
    syncPayrollEmployees(normalizedRecords);
    const paymentModel = payrollPayment(payment);
    const selectedRecords = paymentModel === 'all' ? normalizedRecords : normalizedRecords.filter(row => db.prepare('SELECT payment_model FROM payroll_employee_groups WHERE employee_id=?').get(String(row.employee_id || '').trim())?.payment_model === paymentModel);
    if (!selectedRecords.length) throw new Error(`Tidak ada karyawan dengan model gaji ${paymentModel === 'cash' ? 'cash' : 'transfer'}. Atur klasifikasi nama karyawan terlebih dahulu.`);
    const wageByEmployee = new Map(db.prepare('SELECT employee_id,daily_wage FROM payroll_employee_groups').all().map(row => [row.employee_id, Number(row.daily_wage)]));
    const created=db.prepare('INSERT INTO payroll_uploads (file_name,period,row_count,file_data) VALUES (?,?,?,?)').run(fileName,parsedData.period,selectedRecords.length,fileData);
    const insert=db.prepare('INSERT INTO payroll_records (upload_id,employee_id,name,department,work_hours_standard,work_hours_actual,late_count,late_minutes,early_count,early_minutes,overtime_normal,overtime_special,attendance_standard,attendance_actual,absence_days,leave_days,attendance_rate,daily_wage,deduction,overtime_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const insertLog=db.prepare('INSERT OR REPLACE INTO payroll_attendance_logs (upload_id,employee_id,attendance_date,clock_in,clock_out,raw_times) VALUES (?,?,?,?,?,?)');
    const idsByName=new Map(normalizedRecords.map(row=>[String(row.name||'').trim().toLowerCase(),row.employee_id]));
    const selectedIds=new Set(selectedRecords.map(row=>String(row.employee_id)));
    const logs=(parsedData.attendance_logs||[]).map(log=>({...log,employee_id:idsByName.get(String(log.name||'').trim().toLowerCase())})).filter(log=>log.employee_id&&selectedIds.has(String(log.employee_id)));
    const toMinutes=time=>{const match=/^(\d{2}):(\d{2})$/.exec(String(time||''));return match?Number(match[1])*60+Number(match[2]):null;};
    const byEmployeeDay=new Map(logs.map(log=>[String(log.employee_id)+'|'+log.attendance_date,log]));
    const transferIds=new Set(db.prepare("SELECT employee_id FROM payroll_employee_groups WHERE payment_model='transfer'").all().map(row=>String(row.employee_id)));
    const issueLogs=logs.flatMap(log=>{const times=log.raw_times||[];const day=new Date(log.attendance_date+'T00:00:00').getDay(),empty=String(log.clock_in||'').trim()===''&&String(log.clock_out||'').trim()==='',transferEmpty=transferIds.has(String(log.employee_id))&&empty&&isPayrollWorkday(log.attendance_date);const singleClock=day!==6&&times.length===1;const credit=attendanceCredit(log);const saturdayMissingOut=day===6&&(times.length===1||(credit.credit<1&&(toMinutes(log.clock_out)||0)<960));return transferEmpty?[{...log,detected_clock:'IN dan OUT kosong (Transfer)'}]:saturdayMissingOut?[{...log,detected_clock:`${log.clock_in}–${log.clock_out} (Sabtu: lengkapi jam pulang)`}]:singleClock?[{...log,detected_clock:log.clock_in}]:credit.credit===0.5?[{...log,detected_clock:`${log.clock_in}–${log.clock_out} (setengah hari · ${Math.round(credit.workedMinutes)} menit kerja)`}]:[];});
    const insertIssue=db.prepare("INSERT OR IGNORE INTO payroll_attendance_issues (upload_id,employee_id,attendance_date,detected_clock) VALUES (?,?,?,?)");
    db.exec('BEGIN'); try { for(const x of selectedRecords) insert.run(created.lastInsertRowid,x.employee_id,x.name,x.department,x.work_hours_standard,x.work_hours_actual,x.late_count,x.late_minutes,x.early_count,x.early_minutes,x.overtime_normal,x.overtime_special,x.attendance_standard,x.attendance_actual,x.absence_days,x.leave_days,x.attendance_rate,wageByEmployee.get(x.employee_id)??(Number(dailyWage)||0),0,Number(overtimeRate)||0); for(const log of logs) insertLog.run(created.lastInsertRowid,log.employee_id,log.attendance_date,log.clock_in,log.clock_out,JSON.stringify(log.raw_times||[])); for(const issue of issueLogs) insertIssue.run(created.lastInsertRowid,issue.employee_id,issue.attendance_date,issue.detected_clock); db.exec('COMMIT'); } catch(error) { db.exec('ROLLBACK'); throw error; }
    return { id:Number(created.lastInsertRowid), rowCount:selectedRecords.length, logCount:logs.length, paymentModel };
  } finally { if(existsSync(temp)) unlinkSync(temp); if(existsSync(parsed)) unlinkSync(parsed); }
}
function updatePayrollRecord(id, data) {
  if (data.allowance) return savePayrollAllowance(data);
  if (Object.hasOwn(data,'cash_monthly_premium') || Object.hasOwn(data,'payroll_cutoff_day')) { const amount=Number(data.cash_monthly_premium); const day=Number(data.payroll_cutoff_day); if(!Number.isFinite(amount)||amount<0) throw new Error('Nominal premi tidak valid.'); if(!Number.isInteger(day)||day<1||day>31) throw new Error('Tanggal cut-off harus antara 1 dan 31.'); db.exec('BEGIN'); try { db.prepare("UPDATE payroll_settings SET setting_value=? WHERE setting_key='cash_monthly_premium'").run(amount); db.prepare("UPDATE payroll_settings SET setting_value=? WHERE setting_key='payroll_cutoff_day'").run(day); db.exec('COMMIT'); } catch(error) { db.exec('ROLLBACK'); throw error; } return payrollData(); }
  if (data.issue_id) return resolveAttendanceIssue(id, data);
  for (const field of ['daily_wage','deduction','overtime_rate']) if (!Number.isFinite(Number(data[field])) || Number(data[field]) < 0) throw new Error('Nominal gaji tidak valid.');
  const result=db.prepare('UPDATE payroll_records SET daily_wage=?, deduction=?, overtime_rate=? WHERE id=?').run(Number(data.daily_wage),Number(data.deduction),Number(data.overtime_rate),Number(id));
  if(!result.changes) throw new Error('Data gaji tidak ditemukan.');
  return payrollData();
}
function saveCashOvertimeSettings(data) {
  const rate=Number(data.hourly_rate),minimum=Number(data.minimum_minutes);
  if(!Number.isFinite(rate)||rate<0) throw new Error('Tarif lembur per jam tidak valid.');
  if(!Number.isFinite(minimum)||minimum<30) throw new Error('Minimum lembur paling sedikit 30 menit.');
  db.exec('BEGIN');try{const save=db.prepare("INSERT INTO payroll_settings (setting_key,setting_value) VALUES (?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value");save.run('cash_overtime_hourly_rate',rate);save.run('cash_overtime_min_minutes',minimum);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  return payrollData(undefined,data.payment);
}
function saveCashOvertime(data) {
  const date=String(data.overtime_date||''),hours=Number(data.duration_hours),minimum=Number(db.prepare("SELECT setting_value FROM payroll_settings WHERE setting_key='cash_overtime_min_minutes'").get()?.setting_value||30),ids=[...new Set((Array.isArray(data.employee_ids)?data.employee_ids:[]).map(String).filter(Boolean))];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Tanggal lembur tidak valid.');
  if(!Number.isFinite(hours)||hours*60<minimum) throw new Error(`Lembur minimal ${minimum} menit.`);
  if(!ids.length) throw new Error('Pilih minimal satu karyawan Cash yang ikut lembur.');
  const cashIds=new Set(db.prepare("SELECT employee_id FROM payroll_employee_groups WHERE payment_model='cash'").all().map(row=>String(row.employee_id)));
  if(ids.some(id=>!cashIds.has(id))) throw new Error('Lembur manual hanya berlaku untuk karyawan Cash.');
  const save=db.prepare("INSERT INTO payroll_manual_overtime (overtime_date,employee_id,duration_hours) VALUES (?,?,?) ON CONFLICT(overtime_date,employee_id) DO UPDATE SET duration_hours=excluded.duration_hours,updated_at=CURRENT_TIMESTAMP");
  db.exec('BEGIN');try{for(const id of ids)save.run(date,id,hours);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  return payrollData(undefined,data.payment);
}
function resolveAttendanceIssue(recordId, data) {
  const issue=db.prepare("SELECT payroll_attendance_issues.* FROM payroll_attendance_issues JOIN payroll_records ON payroll_records.upload_id=payroll_attendance_issues.upload_id AND payroll_records.employee_id=payroll_attendance_issues.employee_id WHERE payroll_attendance_issues.id=? AND payroll_records.id=?").get(Number(data.issue_id),Number(recordId));
  if (!issue) throw new Error('Kejanggalan absensi tidak ditemukan.');
  if (Boolean(data.close_only)) { db.prepare("UPDATE payroll_attendance_issues SET status='dismissed',forgot_scope='',attendance_status='',notes=?,resolved_at=CURRENT_TIMESTAMP WHERE id=?").run(String(data.notes||'Ditutup admin tanpa keputusan manual.').slice(0,250),issue.id); return payrollData(issue.upload_id); }
  const forgotScope=['','in','out','both'].includes(String(data.forgot_scope||''))?String(data.forgot_scope||''):'';
  const attendanceStatus=['full','half','absent'].includes(String(data.attendance_status||''))?String(data.attendance_status||''):'';
  if(!attendanceStatus)throw new Error('Pilih status kehadiran untuk perhitungan hari kerja.');
  db.prepare("UPDATE payroll_attendance_issues SET status=?,admin_clock_in=NULL,correction_type='',forgot_scope=?,attendance_status=?,notes=?,resolved_at=CURRENT_TIMESTAMP WHERE id=?").run(forgotScope?'forgot_clock':'dismissed',forgotScope,attendanceStatus,String(data.notes||'').slice(0,250),issue.id);
  return payrollData(issue.upload_id);
}
function completeSaturdayAttendance(data) {
  const uploadId=Number(data.upload_id),date=String(data.attendance_date||'');
  if(!Number.isInteger(uploadId)||uploadId<1||!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00').getDay()!==6)throw new Error('Tanggal Sabtu tidak valid.');
  const employees=db.prepare("SELECT employee_id FROM payroll_attendance_logs WHERE upload_id=? AND attendance_date=? AND clock_in GLOB '[0-2][0-9]:[0-5][0-9]' AND (clock_out='' OR clock_in=clock_out)").all(uploadId,date).map(row=>String(row.employee_id));
  if(!employees.length)throw new Error('Tidak ada data Sabtu dengan jam OUT kosong atau sama dengan jam IN untuk dilengkapi.');
  const validIds=new Set(employees),overrides=new Map();
  for(const item of Array.isArray(data.overrides)?data.overrides:[]){const id=String(item?.employee_id||''),time=String(item?.clock_out||'');if(!validIds.has(id)||!/^\d{2}:\d{2}$/.test(time))continue;overrides.set(id,time);}
  db.exec('BEGIN');try{const updated=db.prepare("UPDATE payroll_attendance_logs SET clock_out='16:00' WHERE upload_id=? AND attendance_date=? AND clock_in GLOB '[0-2][0-9]:[0-5][0-9]' AND (clock_out='' OR clock_in=clock_out)").run(uploadId,date);const updateCustom=db.prepare("UPDATE payroll_attendance_logs SET clock_out=? WHERE upload_id=? AND employee_id=? AND attendance_date=? AND (clock_out='' OR clock_in=clock_out)");for(const [employeeId,time] of overrides)updateCustom.run(time,uploadId,employeeId,date);const placeholders=employees.map(()=>'?').join(',');db.prepare(`UPDATE payroll_attendance_issues SET status='dismissed',admin_clock_in='16:00',resolved_at=CURRENT_TIMESTAMP WHERE upload_id=? AND attendance_date=? AND status='warning' AND employee_id IN (${placeholders})`).run(uploadId,date,...employees);db.exec('COMMIT');return {...payrollData(uploadId),updatedCount:Number(updated.changes||0),customCount:overrides.size};}catch(error){db.exec('ROLLBACK');throw error;}
}
function dismissSaturdayAttendance(data) {
  const uploadId=Number(data.upload_id),date=String(data.attendance_date||'');
  if(!Number.isInteger(uploadId)||uploadId<1||!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00').getDay()!==6)throw new Error('Tanggal Sabtu tidak valid.');
  db.prepare("UPDATE payroll_attendance_issues SET status='dismissed',admin_clock_in=NULL,notes='Ditutup admin tanpa perubahan absensi.',resolved_at=CURRENT_TIMESTAMP WHERE upload_id=? AND attendance_date=? AND status='warning'").run(uploadId,date);
  return payrollData(uploadId);
}
function editPayrollAttendance(data) {
  const employeeId=String(data.employee_id||''), date=String(data.attendance_date||''), clockIn=String(data.clock_in||'').trim(), clockOut=String(data.clock_out||'').trim();
  if(!employeeId) throw new Error('Pilih nama karyawan terlebih dahulu.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Pilih tanggal absensi yang akan diubah.');
  const validTime=value=>{const match=/^([01]\d|2[0-4]):([0-5]\d)$/.exec(value);return Boolean(match)&&!(match[1]==='24'&&match[2]!=='00');};
  const forgotScope=['','in','out','both'].includes(String(data.forgot_scope||''))?String(data.forgot_scope||''):'';
  const inNote=String(data.clock_in_note||'').trim().slice(0,250),outNote=String(data.clock_out_note||'').trim().slice(0,250),attendanceStatus=['','full','half','absent'].includes(String(data.attendance_status||''))?String(data.attendance_status||''):'';
  const shiftCode=String(data.shift_code||'').trim();if(shiftCode&&!Object.hasOwn(shiftDefinitions,shiftCode))throw new Error('Shift absensi tidak valid.');
  const confirmedSwapDay=attendanceStatus==='full'&&/TUKAR\s+HARI/i.test(`${inNote} ${outNote}`);
  const missingIn=!clockIn,missingOut=!clockOut;
  if((missingIn&&!confirmedSwapDay&&!['in','both'].includes(forgotScope))||(missingOut&&!confirmedSwapDay&&!['out','both'].includes(forgotScope))||(!missingIn&&!validTime(clockIn))||(!missingOut&&!validTime(clockOut))) throw new Error('Jam yang kosong harus ditandai sebagai lupa absen, kecuali Tukar Hari yang dikonfirmasi berangkat penuh. Jam yang diisi wajib memakai format 00:00 sampai 24:00.');
  let log=db.prepare('SELECT upload_id FROM payroll_attendance_logs WHERE employee_id=? AND attendance_date=? ORDER BY upload_id DESC LIMIT 1').get(employeeId,date);
  if(!log) {
    const record=db.prepare('SELECT upload_id FROM payroll_records WHERE employee_id=? ORDER BY upload_id DESC LIMIT 1').get(employeeId);
    if(!record) throw new Error('Karyawan belum memiliki data impor absensi.');
    log={upload_id:record.upload_id};
  }
  db.exec('BEGIN'); try {
    db.prepare('INSERT INTO payroll_attendance_logs (upload_id,employee_id,attendance_date,clock_in,clock_out,raw_times) VALUES (?,?,?,?,?,?) ON CONFLICT(upload_id,employee_id,attendance_date) DO UPDATE SET clock_in=excluded.clock_in,clock_out=excluded.clock_out,raw_times=excluded.raw_times').run(log.upload_id,employeeId,date,clockIn,clockOut,JSON.stringify([clockIn,clockOut]));
    db.prepare("INSERT INTO payroll_attendance_notes (employee_id,attendance_date,clock_in_note,clock_out_note) VALUES (?,?,?,?) ON CONFLICT(employee_id,attendance_date) DO UPDATE SET clock_in_note=excluded.clock_in_note,clock_out_note=excluded.clock_out_note,updated_at=CURRENT_TIMESTAMP").run(employeeId,date,inNote,outNote);
    if(shiftCode)db.prepare("INSERT INTO payroll_attendance_shift_overrides (employee_id,attendance_date,shift_code) VALUES (?,?,?) ON CONFLICT(employee_id,attendance_date) DO UPDATE SET shift_code=excluded.shift_code,updated_at=CURRENT_TIMESTAMP").run(employeeId,date,shiftCode);else db.prepare('DELETE FROM payroll_attendance_shift_overrides WHERE employee_id=? AND attendance_date=?').run(employeeId,date);
    db.prepare("INSERT INTO payroll_attendance_issues (upload_id,employee_id,attendance_date,detected_clock,status,admin_clock_in,correction_type,forgot_scope,attendance_status,notes,resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(upload_id,employee_id,attendance_date) DO UPDATE SET detected_clock=excluded.detected_clock,status=excluded.status,admin_clock_in=NULL,correction_type='',forgot_scope=excluded.forgot_scope,attendance_status=excluded.attendance_status,notes=excluded.notes,resolved_at=CURRENT_TIMESTAMP").run(log.upload_id,employeeId,date,`${clockIn}–${clockOut} (edit admin)`,forgotScope?'forgot_clock':'dismissed','','',forgotScope,attendanceStatus,[inNote,outNote].filter(Boolean).join(' · '));
    db.prepare("UPDATE payroll_attendance_issues SET status='dismissed',resolved_at=CURRENT_TIMESTAMP WHERE employee_id=? AND attendance_date=? AND status='warning'").run(employeeId,date);
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
  return payrollData();
}
function updatePayrollEmployeeGroup(employeeId, data) {
  if (Object.hasOwn(data,'daily_wage')) return updatePayrollCompensation(employeeId, data);
  const paymentModel = String(data.payment_model || 'unclassified').toLowerCase();
  if (!['cash','transfer','unclassified'].includes(paymentModel)) throw new Error('Gunakan status efektif untuk menandai karyawan keluar.');
  const result = db.prepare("UPDATE payroll_employee_groups SET payment_model=?, daily_wage=CASE WHEN ?='transfer' THEN 0 ELSE daily_wage END, monthly_premium=CASE WHEN ?='transfer' THEN 0 ELSE monthly_premium END, monthly_basic=CASE WHEN ?='cash' AND monthly_basic=0 THEN 300000 ELSE monthly_basic END, updated_at=CURRENT_TIMESTAMP WHERE employee_id=?").run(paymentModel,paymentModel,paymentModel,paymentModel, String(employeeId));
  if (!result.changes) throw new Error('Karyawan tidak ditemukan.');
  return payrollData();
}
function saveEffectiveEmployeeStatus(employeeId,data){
  const id=String(employeeId||''),effectiveDate=String(data.effective_date||''),paymentModel=String(data.payment_model||'').toLowerCase();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate))throw new Error('Tanggal efektif wajib diisi.');
  if(!['cash','transfer','keluar'].includes(paymentModel))throw new Error('Status efektif tidak valid.');
  const employee=db.prepare('SELECT employee_id FROM payroll_employee_groups WHERE employee_id=?').get(id);if(!employee)throw new Error('Karyawan tidak ditemukan.');
  db.prepare('INSERT INTO payroll_employee_status_history (employee_id,effective_date,payment_model) VALUES (?,?,?) ON CONFLICT(employee_id,effective_date) DO UPDATE SET payment_model=excluded.payment_model,updated_at=CURRENT_TIMESTAMP').run(id,effectiveDate,paymentModel);
  if(paymentModel!=='keluar')db.prepare("UPDATE payroll_employee_groups SET payment_model=?,daily_wage=CASE WHEN ?='transfer' THEN 0 ELSE daily_wage END,monthly_premium=CASE WHEN ?='transfer' THEN 0 ELSE monthly_premium END,updated_at=CURRENT_TIMESTAMP WHERE employee_id=?").run(paymentModel,paymentModel,paymentModel,id);
  return payrollData();
}
function updatePayrollCompensation(employeeId, data) {
  const values=['daily_wage','monthly_basic'].map(field=>Number(data[field]||0));
  if(values.some(value=>!Number.isFinite(value)||value<0)) throw new Error('Nominal kompensasi tidak valid.');
  const result=db.prepare('UPDATE payroll_employee_groups SET daily_wage=?,monthly_basic=?,updated_at=CURRENT_TIMESTAMP WHERE employee_id=? AND payment_model=\'cash\'').run(...values,String(employeeId));
  if(!result.changes) throw new Error('Karyawan cash tidak ditemukan.');
  return payrollData();
}
function savePayrollAllowance(data) {
  const name=String(data.name||'').trim(),amount=Number(data.amount),kind=data.kind==='attendance'?'attendance':'custom';
  if(!name||!Number.isFinite(amount)||amount<0) throw new Error('Nama dan nominal tunjangan harus diisi dengan benar.');
  const cashIds=new Set(db.prepare("SELECT employee_id FROM payroll_employee_groups WHERE payment_model='cash'").all().map(row=>String(row.employee_id)));
  const recipients=kind==='attendance'?[...cashIds]:[...(Array.isArray(data.recipients)?data.recipients:[])].map(String).filter(id=>cashIds.has(id));
  if(!recipients.length) throw new Error('Pilih minimal satu karyawan cash penerima tunjangan.');
  db.exec('BEGIN'); try { const saved=db.prepare('INSERT INTO payroll_allowances (name,amount,kind) VALUES (?,?,?)').run(name,amount,kind); const add=db.prepare('INSERT INTO payroll_allowance_recipients (allowance_id,employee_id) VALUES (?,?)'); for(const employeeId of recipients)add.run(saved.lastInsertRowid,employeeId); db.exec('COMMIT'); } catch(error){db.exec('ROLLBACK');throw error;}
  return payrollData();
}
function payrollExportDates(period, logs, start='', end='') {
  const matches=String(period||'').match(/20\d{2}-\d{2}-\d{2}/g)||[],first=start||matches[0]||logs.map(item=>item.attendance_date).sort()[0],last=end||matches[1]||logs.map(item=>item.attendance_date).sort().at(-1);
  if(!first||!last||first>last)return [];
  const dates=[];for(const cursor=new Date(`${first}T00:00:00`),finish=new Date(`${last}T00:00:00`);cursor<=finish;cursor.setDate(cursor.getDate()+1))dates.push([cursor.getFullYear(),String(cursor.getMonth()+1).padStart(2,'0'),String(cursor.getDate()).padStart(2,'0')].join('-'));
  return dates;
}
function payrollLateDeduction(log) {
  if(log?.business_trip_id)return 0;
  // Keputusan manual berangkat penuh dipakai untuk tugas luar/lupa absen
  // yang tetap menyimpan jam mesin; jam tersebut tidak boleh memicu potongan.
  if(String(log.admin_attendance_status||'')==='full')return 0;
  if(['in','both'].includes(String(log.admin_forgot_scope||'')))return 0;
  const start=timeMinutes(log.clock_in),finish=timeMinutes(log.clock_out),shift=evaluateAttendanceShift(log);
  // Potongan hanya bisa ditetapkan bila jam lengkap membuktikan hari kerja penuh.
  // Scan tunggal, kurang dari tiga jam, dan setengah hari tidak dipotong otomatis.
  if(start===null||finish===null)return 0;
  if(shift.actual===null||shift.actual<shift.full||!shift.late)return 0;
  // Potongan mengikuti blok keterlambatan yang sudah digunakan payroll:
  // Rp10.000 per 30 menit, dengan pecahan blok dibulatkan ke atas.
  // Contoh: terlambat 45 menit = ceil(45/30) × Rp10.000 = Rp20.000.
  return Math.ceil((start-shift.start)/30)*10000;
}
function payrollExportRows(data, start='', end='') {
  const logs=data.attendanceLogs||[],dates=payrollExportDates(data.period,logs,start,end),from=dates[0],to=dates.at(-1);
  if(!dates.length)throw new Error('Rentang periode gaji tidak ditemukan.');
  const history=new Map(),baseRecords=new Map((data.databaseRecords||[]).map(row=>[String(row.employee_id),row]));
  for(const item of data.statusHistory||[]){const items=history.get(String(item.employee_id))||[];items.push(item);history.set(String(item.employee_id),items);}
  const statusAt=(employeeId,defaultStatus,date)=>{let status=defaultStatus||'unclassified';for(const item of history.get(String(employeeId))||[]){if(item.effective_date>date)break;status=item.payment_model;}return status;};
  const overrides=new Map((data.periodOverrides||[]).filter(item=>item.period_start===from&&item.period_end===to).map(item=>[String(item.employee_id),item]));
  const dailyLogs=new Map(),attendance=new Map(),late=new Map(),countedDates=new Set();
  for(const log of logs){if(log.attendance_date<from||log.attendance_date>to)continue;const id=String(log.employee_id),base=baseRecords.get(id),dateKey=id+'|'+log.attendance_date;if(!base||statusAt(id,base.payment_model,log.attendance_date)==='keluar'||countedDates.has(dateKey))continue;countedDates.add(dateKey);dailyLogs.set(dateKey,log);attendance.set(id,(attendance.get(id)||0)+attendanceCredit(log).credit);late.set(id,(late.get(id)||0)+payrollLateDeduction(log));}
  const manualHours=new Map(),minimum=Number(data.cashOvertimeMinMinutes||30);
  for(const item of data.manualOvertime||[]){const id=String(item.employee_id),base=baseRecords.get(id);if(!base||item.overtime_date<from||item.overtime_date>to||statusAt(id,base.payment_model,item.overtime_date)==='keluar'||Number(item.duration_hours||0)*60<minimum)continue;manualHours.set(id,(manualHours.get(id)||0)+Number(item.duration_hours||0));}
  const payment=data.paymentModel||'all',records=[],cashMonthly=dates.length>7,expectedWorkdays=dates.filter(isPayrollWorkday).length;
  for(const base of baseRecords.values()){
    const id=String(base.employee_id),model=statusAt(id,base.payment_model,to);if(model==='keluar'||(payment!=='all'&&model!==payment))continue;
    if(cashMonthly&&model==='cash'&&Number(base.monthly_basic||0)<=0)continue;
    const override=overrides.get(id),days=override?.attendance_actual!==null&&override?.attendance_actual!==undefined?Number(override.attendance_actual):(attendance.get(id)||0);if(days<=0&&!(cashMonthly&&model==='cash'&&Number(base.monthly_basic||0)>0))continue;
    const dailyWage=override?.daily_wage!==null&&override?.daily_wage!==undefined?Number(override.daily_wage):Number(base.daily_wage||0),manual=model==='cash'?(manualHours.get(id)||0):0,imported=Number(base.overtime_normal||0)+Number(base.overtime_special||0),hours=imported+manual,rate=model==='cash'?Number(data.cashOvertimeHourlyRate||0):Number(base.overtime_rate||0),overtime=hours*rate,gross=days*dailyWage,calculatedLate=Number(late.get(id)||0),deduction=calculatedLate;
    const dailyValues=dates.map(date=>{const log=dailyLogs.get(id+'|'+date);return log?attendanceCredit(log).credit:0;});
    if(cashMonthly&&model==='cash'&&Number(base.monthly_basic||0)>0){
      const absence=Math.max(0,expectedWorkdays-days),premiumBase=Number(data.cashMonthlyPremium||0),premium=premiumBase*Math.max(0,1-(absence*0.5));let allowance=0;for(const item of data.allowances||[]){const recipients=(item.recipients||[]).map(String),eligible=item.kind==='attendance'?days>=expectedWorkdays:recipients.includes(id);if(eligible)allowance+=Number(item.amount||0);}const monthlyBasic=Number(base.monthly_basic||0),monthlyTotal=monthlyBasic+premium+allowance;
      records.push({employee_id:id,name:base.name,department:base.department||'',daily_values:dailyValues,attendance_actual:days,monthly_cash:true,monthly_basic:monthlyBasic,premium,allowance_total:allowance,deduction:0,overtime_pay:0,net_pay:monthlyTotal});
    }else records.push({employee_id:id,name:base.name,department:base.department||'',daily_values:dailyValues,attendance_actual:days,monthly_cash:false,monthly_basic:0,premium:0,allowance_total:0,deduction,overtime_pay:overtime,net_pay:gross-deduction+overtime});
  }
  return {dates,records:records.sort((a,b)=>a.name.localeCompare(b.name,'id'))};
}
function exportPayroll(uploadId, payment='all', start='', end='') {
  const data=payrollData(uploadId, payment),report=payrollExportRows(data,start,end); if(!report.records.length) throw new Error('Belum ada data gaji untuk diekspor pada klasifikasi dan periode yang dipilih.');
  // Kirim penanda visual yang sama dengan Log Absensi ke pembuat workbook.
  // Jangan biarkan skrip Excel menebak sendiri shift atau sisi kejanggalan.
  const validClock=value=>/^\d{2}:\d{2}$/.test(String(value||''));
  const exportCellState=(log,side)=>{
    if(log.business_trip_id)return 'trip';
    if(log.admin_attendance_status==='absent')return side==='clock_in'?'absence':'';
    if(log.admin_issue_status==='forgot_clock'){const scope=String(log.admin_forgot_scope||'both');return side==='clock_in'?(['in','both'].includes(scope)?'forgot':''):(['out','both'].includes(scope)?'forgot':'');}
    const swapIn=String(log.clock_in_note||'').toUpperCase().includes('TUKAR HARI'),swapOut=String(log.clock_out_note||'').toUpperCase().includes('TUKAR HARI');if((side==='clock_in'&&swapIn)||(side==='clock_out'&&swapOut))return 'half';
    if(log.admin_attendance_status==='half')return (log.half_day_side||'clock_in')===side?'half':'';
    if(log.half_day_side)return log.half_day_side===side?'half':'';
    const startMinutes=validClock(log.clock_in)?Number(log.clock_in.slice(0,2))*60+Number(log.clock_in.slice(3)):null,finishMinutes=validClock(log.clock_out)?Number(log.clock_out.slice(0,2))*60+Number(log.clock_out.slice(3)):null;
    if(startMinutes===null&&finishMinutes===null)return side==='clock_in'?'absence':'';
    if(side==='clock_in'&&startMinutes!==null&&startMinutes>485&&startMinutes<720)return 'late';
    if(startMinutes!==null&&finishMinutes!==null){let worked=finishMinutes-startMinutes;if(worked<0)worked+=1440;const day=new Date(log.attendance_date+'T00:00:00').getDay(),required=day===6?420:450;if(worked>=180&&worked<required&&side==='clock_out')return day===5&&finishMinutes<=690?'half':'early';}
    return '';
  };
  const employeeIds=new Set(report.records.map(item=>String(item.employee_id)));
  report.attendance_logs=(data.attendanceLogs||[]).filter(log=>employeeIds.has(String(log.employee_id))&&log.attendance_date>=report.dates[0]&&log.attendance_date<=report.dates.at(-1)).map(log=>{const tripLabel=log.business_trip_id?`Perjalanan dinas: ${log.business_trip_name||'Dinas luar'}`:'';return {employee_id:String(log.employee_id),attendance_date:log.attendance_date,clock_in:log.clock_in||'',clock_out:log.clock_out||'',clock_in_note:tripLabel||log.clock_in_note||'',clock_out_note:log.clock_out_note||'',admin_note:log.admin_note||'',state_in:exportCellState(log,'clock_in'),state_out:exportCellState(log,'clock_out')};});
  report.classification={all:'Semua klasifikasi',cash:'Cash',transfer:'Transfer'}[payrollPayment(payment)]||'Semua klasifikasi';
  const source=join(tmpdir(),`cap-payroll-export-${randomUUID()}.json`), output=join(tmpdir(),`cap-gaji-gudang-${randomUUID()}.xlsx`);
  try { writeFileSync(source,JSON.stringify({period_start:report.dates[0],period_end:report.dates.at(-1),dates:report.dates,records:report.records,attendance_logs:report.attendance_logs,classification:report.classification})); const result=runPython(join(ROOT,'scripts','export_payroll_excel.py'),[source,output]); if(result.error) throw result.error; if(result.status!==0) throw new Error(result.stderr||'File gaji tidak dapat dibuat.'); return readFileSync(output); } finally { if(existsSync(source))unlinkSync(source); if(existsSync(output))unlinkSync(output); }
}
const payrollNationalHolidays=new Set(['2026-01-01','2026-01-16','2026-02-16','2026-02-17','2026-03-18','2026-03-19','2026-03-20','2026-03-21','2026-03-22','2026-03-23','2026-03-24','2026-04-03','2026-04-05','2026-05-01','2026-05-14','2026-05-15','2026-05-27','2026-05-28','2026-05-31','2026-06-01','2026-06-16','2026-08-17','2026-08-25','2026-12-24','2026-12-25']);
const isPayrollWorkday=date=>{const day=new Date(`${date}T00:00:00`).getDay();return day!==0&&!payrollNationalHolidays.has(String(date));};
function businessTripData(){
  const trips=db.prepare('SELECT * FROM payroll_business_trips ORDER BY start_date DESC,id DESC').all();
  const participants=db.prepare('SELECT participant.trip_id,participant.employee_id,employee.employee_name AS name,COALESCE(employee.department,\'\') AS department,employee.payment_model FROM payroll_business_trip_participants participant JOIN payroll_employee_groups employee ON employee.employee_id=participant.employee_id ORDER BY employee.employee_name COLLATE NOCASE').all();
  const byTrip=new Map();for(const item of participants){const rows=byTrip.get(Number(item.trip_id))||[];rows.push(item);byTrip.set(Number(item.trip_id),rows);}
  return trips.map(item=>{const members=byTrip.get(Number(item.id))||[],models=[...new Set(members.map(member=>member.payment_model).filter(model=>['cash','transfer'].includes(model)))];const placeholders=models.map(()=>'?').join(',');const warning=models.length?Boolean(db.prepare(`SELECT 1 FROM payroll_payment_logs WHERE needs_recalculation=1 AND period_start<=? AND period_end>=? AND payment_model IN (${placeholders}) LIMIT 1`).get(item.end_date,item.start_date,...models)):false;return {...item,participants:members,needs_recalculation:warning};});
}
function businessTripAttendance(employeeById,statusAt){
  const trips=businessTripData(),output=[],iso=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  for(const trip of trips){for(const participant of trip.participants){const employee=employeeById.get(String(participant.employee_id));if(!employee)continue;for(const cursor=new Date(`${trip.start_date}T00:00:00`),end=new Date(`${trip.end_date}T00:00:00`);cursor<=end;cursor.setDate(cursor.getDate()+1)){const attendanceDate=iso(cursor);if(statusAt(participant.employee_id,attendanceDate)==='keluar')continue;output.push({employee_id:String(participant.employee_id),name:employee.employee_name,department:employee.department||'',attendance_date:attendanceDate,clock_in:'',clock_out:'',raw_times:'[]',clock_in_note:'',clock_out_note:'',admin_note:'',admin_issue_status:'',business_trip_id:trip.id,business_trip_name:trip.trip_name,business_trip_notes:trip.notes||''});}}}
  return output;
}
function markPaymentsForTrip(start,end,employeeIds){
  const ids=[...new Set((employeeIds||[]).map(String).filter(Boolean))];if(!ids.length)return;
  const placeholders=ids.map(()=>'?').join(','),models=[...new Set(db.prepare(`SELECT payment_model FROM payroll_employee_groups WHERE employee_id IN (${placeholders})`).all(...ids).map(row=>row.payment_model).filter(model=>['cash','transfer'].includes(model)))];if(!models.length)return;
  db.prepare(`UPDATE payroll_payment_logs SET needs_recalculation=1 WHERE period_start<=? AND period_end>=? AND payment_model IN (${models.map(()=>'?').join(',')})`).run(end,start,...models);
}
function saveBusinessTrip(data,id=0){
  const name=String(data.trip_name||'').trim().slice(0,120),start=String(data.start_date||''),end=String(data.end_date||''),notes=String(data.notes||'').trim().slice(0,500),employeeIds=[...new Set((Array.isArray(data.employee_ids)?data.employee_ids:[]).map(String).filter(Boolean))];
  if(!name)throw new Error('Nama perjalanan dinas wajib diisi.');if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)throw new Error('Rentang tanggal perjalanan dinas tidak valid.');if(employeeIds.length!==1)throw new Error('Pilih tepat satu karyawan untuk setiap perjalanan dinas.');
  const valid=new Set(db.prepare("SELECT employee_id FROM payroll_employee_groups WHERE payment_model IN ('cash','transfer')").all().map(row=>String(row.employee_id)));if(employeeIds.some(item=>!valid.has(item)))throw new Error('Salah satu peserta perjalanan tidak aktif.');
  db.exec('BEGIN');try{let tripId=Number(id),previous,previousEmployeeIds=[];if(tripId){previous=db.prepare('SELECT * FROM payroll_business_trips WHERE id=?').get(tripId);if(!previous)throw new Error('Perjalanan dinas tidak ditemukan.');previousEmployeeIds=db.prepare('SELECT employee_id FROM payroll_business_trip_participants WHERE trip_id=?').all(tripId).map(row=>row.employee_id);db.prepare('UPDATE payroll_business_trips SET trip_name=?,start_date=?,end_date=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name,start,end,notes,tripId);db.prepare('DELETE FROM payroll_business_trip_participants WHERE trip_id=?').run(tripId);}else tripId=Number(db.prepare('INSERT INTO payroll_business_trips (trip_name,start_date,end_date,notes) VALUES (?,?,?,?)').run(name,start,end,notes).lastInsertRowid);const add=db.prepare('INSERT INTO payroll_business_trip_participants (trip_id,employee_id) VALUES (?,?)');for(const employeeId of employeeIds)add.run(tripId,employeeId);if(previous)markPaymentsForTrip(previous.start_date,previous.end_date,previousEmployeeIds);markPaymentsForTrip(start,end,employeeIds);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return payrollData();
}
function deleteBusinessTrip(id){const trip=db.prepare('SELECT * FROM payroll_business_trips WHERE id=?').get(Number(id));if(!trip)throw new Error('Perjalanan dinas tidak ditemukan.');const employeeIds=db.prepare('SELECT employee_id FROM payroll_business_trip_participants WHERE trip_id=?').all(trip.id).map(row=>row.employee_id);db.exec('BEGIN');try{db.prepare('DELETE FROM payroll_business_trips WHERE id=?').run(trip.id);markPaymentsForTrip(trip.start_date,trip.end_date,employeeIds);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return payrollData();}
function syncTransferEmptyAttendanceIssues(){
  const groups=new Map(db.prepare('SELECT employee_id,payment_model FROM payroll_employee_groups').all().map(row=>[String(row.employee_id),row.payment_model]));
  const history=new Map();for(const row of db.prepare('SELECT employee_id,effective_date,payment_model FROM payroll_employee_status_history ORDER BY employee_id,effective_date').all()){const list=history.get(String(row.employee_id))||[];list.push(row);history.set(String(row.employee_id),list);}
  const statusAt=(employeeId,date)=>{let status=groups.get(String(employeeId))||'unclassified';for(const row of history.get(String(employeeId))||[]){if(row.effective_date>date)break;status=row.payment_model;}return status;};
  const insertIssue=db.prepare("INSERT OR IGNORE INTO payroll_attendance_issues (upload_id,employee_id,attendance_date,detected_clock) VALUES (?,?,?,'IN dan OUT kosong (Transfer)')"),insertEmptyLog=db.prepare("INSERT OR IGNORE INTO payroll_attendance_logs (upload_id,employee_id,attendance_date,clock_in,clock_out,raw_times) VALUES (?,?,?,'','','[]')");
  const dayMs=86400000,asDate=value=>new Date(`${value}T00:00:00`),asIso=value=>[value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-');
  let created=0;db.exec('BEGIN');try{
    for(const log of db.prepare("SELECT upload_id,employee_id,attendance_date FROM payroll_attendance_logs WHERE trim(clock_in)='' AND trim(clock_out)='' ").all()){if(statusAt(log.employee_id,log.attendance_date)!=='transfer'||!isPayrollWorkday(log.attendance_date))continue;created+=Number(insertIssue.run(log.upload_id,log.employee_id,log.attendance_date).changes||0);}
    // Tidak berangkat di antara dua log yang dekat perlu tetap dapat dikonfirmasi admin,
    // meskipun Excel tidak menghasilkan baris absensi untuk tanggal tersebut.
    for(const upload of db.prepare('SELECT id FROM payroll_uploads').all()){
      const logs=db.prepare('SELECT employee_id,attendance_date FROM payroll_attendance_logs WHERE upload_id=? ORDER BY employee_id,attendance_date').all(upload.id),byEmployee=new Map();
      for(const log of logs){const rows=byEmployee.get(String(log.employee_id))||[];rows.push(log.attendance_date);byEmployee.set(String(log.employee_id),rows);}
      for(const [employeeId,dates] of byEmployee){for(let index=1;index<dates.length;index++){
        const previous=asDate(dates[index-1]),next=asDate(dates[index]),gap=(next-previous)/dayMs;
        if(gap>3)continue;
        for(const cursor=new Date(previous.getTime()+dayMs);cursor<next;cursor.setDate(cursor.getDate()+1)){
          const attendanceDate=asIso(cursor);if(statusAt(employeeId,attendanceDate)!=='transfer'||!isPayrollWorkday(attendanceDate))continue;
          insertEmptyLog.run(upload.id,employeeId,attendanceDate);created+=Number(insertIssue.run(upload.id,employeeId,attendanceDate).changes||0);
        }
      }}
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}return created;
}
syncTransferEmptyAttendanceIssues();
function syncHalfDayAttendanceIssues(){
  const logs=db.prepare('SELECT upload_id,employee_id,attendance_date,clock_in,clock_out,raw_times FROM payroll_attendance_logs').all(),insert=db.prepare("INSERT OR IGNORE INTO payroll_attendance_issues (upload_id,employee_id,attendance_date,detected_clock) VALUES (?,?,?,?)");
  let created=0;db.exec('BEGIN');try{for(const log of logs){const credit=attendanceCredit(log);if(!credit.halfDay)continue;created+=Number(insert.run(log.upload_id,log.employee_id,log.attendance_date,`${log.clock_in}–${log.clock_out} (setengah hari · ${Math.round(credit.workedMinutes)} menit kerja)`).changes||0);}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return created;
}
syncHalfDayAttendanceIssues();
function exportAttendanceLogFile(start='',end='',payment='all',employeeName='') {
  const data=payrollData(undefined,payment),model=payrollPayment(payment),classifications=new Map((data.databaseRecords||[]).map(item=>[String(item.employee_id),item])),logs=(data.attendanceLogs||[]).filter(log=>{const classification=classifications.get(String(log.employee_id));return classification&&(model==='all'||classification.payment_model===model)&&(!start||log.attendance_date>=start)&&(!end||log.attendance_date<=end)&&(!employeeName||log.name===employeeName);});
  if(!logs.length) throw new Error('Tidak ada log absensi pada filter yang dipilih.');
  const first=start||logs.map(item=>item.attendance_date).sort()[0],last=end||logs.map(item=>item.attendance_date).sort().at(-1),dates=[];
  const dateLabel=value=>[value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-');
  for(const cursor=new Date(`${first}T00:00:00`),finish=new Date(`${last}T00:00:00`);cursor<=finish;cursor.setDate(cursor.getDate()+1)){const date=dateLabel(cursor);dates.push({date,holiday:cursor.getDay()===0||payrollNationalHolidays.has(date)});}
  const people=new Map();
  const validClock=value=>/^\d{2}:\d{2}$/.test(String(value||''));
  const exportCellState=(log,side)=>{
    if(log.business_trip_id)return 'trip';
    if(log.admin_attendance_status==='absent')return side==='clock_in'?'absence':'';
    if(log.admin_issue_status==='forgot_clock'){const scope=String(log.admin_forgot_scope||'both');return side==='clock_in'?(['in','both'].includes(scope)?'forgot':''):(['out','both'].includes(scope)?'forgot':'');}
    const swapIn=String(log.clock_in_note||'').toUpperCase().includes('TUKAR HARI'),swapOut=String(log.clock_out_note||'').toUpperCase().includes('TUKAR HARI');if((side==='clock_in'&&swapIn)||(side==='clock_out'&&swapOut))return 'half';
    if(log.admin_attendance_status==='half')return (log.half_day_side||'clock_in')===side?'half':'';
    if(log.half_day_side)return log.half_day_side===side?'half':'';
    const start=validClock(log.clock_in)?Number(log.clock_in.slice(0,2))*60+Number(log.clock_in.slice(3)):null,finish=validClock(log.clock_out)?Number(log.clock_out.slice(0,2))*60+Number(log.clock_out.slice(3)):null;
    if(start===null&&finish===null)return side==='clock_in'?'absence':'';
    if(side==='clock_in'&&start!==null&&start>485&&start<720)return 'late';
    if(start!==null&&finish!==null){let worked=finish-start;if(worked<0)worked+=1440;const day=new Date(log.attendance_date+'T00:00:00').getDay(),required=day===6?420:450;if(worked>=180&&worked<required&&side==='clock_out')return day===5&&finish<=690?'half':'early';}
    return '';
  };
  for(const log of logs){const existing=people.get(String(log.employee_id))||{name:log.name,department:classifications.get(String(log.employee_id))?.department||'',logs:{}};const tripNote=log.business_trip_id?(log.business_trip_name||'Perjalanan dinas'):'';existing.logs[log.attendance_date]={clock_in:log.clock_in,clock_out:log.clock_out,clock_in_note:tripNote||log.clock_in_note||'',clock_out_note:tripNote||log.clock_out_note||'',admin_note:log.admin_note||'',state_in:exportCellState(log,'clock_in'),state_out:exportCellState(log,'clock_out')};people.set(String(log.employee_id),existing);}
  const source=join(tmpdir(),`cap-attendance-export-${randomUUID()}.json`),output=join(tmpdir(),`cap-log-absensi-${randomUUID()}.xlsx`);
  try { writeFileSync(source,JSON.stringify({classification:{all:'Semua klasifikasi',cash:'Cash',transfer:'Transfer'}[model]||'Semua klasifikasi',start:first,end:last,log_count:logs.length,dates,rows:[...people.values()].sort((a,b)=>a.name.localeCompare(b.name,'id'))})); const result=runPython(join(ROOT,'scripts','export_attendance_log_excel.py'),[source,output]); if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Log absensi tidak dapat diekspor.');return readFileSync(output);} finally {if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);}
}
const readJson = (req,maxBytes=30000) => new Promise((resolve,reject) => { let body='',rejected=false; req.on('data',chunk => { if(rejected)return; body += chunk; if(Buffer.byteLength(body,'utf8') > maxBytes){rejected=true;reject(new Error('Data terlalu besar.'));} }); req.on('end',() => { if(rejected)return; try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Format data tidak valid.')); } }); });
const sinosureTypes=['mou','nib','npwp','tt_proof','power_of_attorney'], sinosureText=value=>String(value||'').trim().slice(0,500);
function sinosurePartner(data){const name=sinosureText(data.name);if(!name)throw new Error('Nama perusahaan penandatangan wajib diisi.');const result=db.prepare('INSERT INTO sinosure_partners(name,short_code) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET short_code=excluded.short_code').run(name,sinosureText(data.short_code).slice(0,30));return Number(result.lastInsertRowid)||Number(db.prepare('SELECT id FROM sinosure_partners WHERE name=?').get(name).id);}
function sinosureComplete(contract){const found=new Set(db.prepare('SELECT DISTINCT document_type FROM sinosure_documents WHERE contract_id=?').all(contract.id).map(x=>x.document_type)), required=['mou','nib','npwp','tt_proof',...(contract.tt_same_entity?[]:['power_of_attorney'])];return required.every(type=>found.has(type));}
function sinosureData(){const partners=db.prepare('SELECT * FROM sinosure_partners WHERE active=1 ORDER BY name').all(),contracts=db.prepare(`SELECT c.*,p.name AS partner_name FROM sinosure_contracts c LEFT JOIN sinosure_partners p ON p.id=c.partner_id ORDER BY c.updated_at DESC,c.id DESC`).all().map(contract=>{const lines=db.prepare('SELECT * FROM sinosure_contract_lines WHERE contract_id=? ORDER BY id').all(contract.id),documents=db.prepare(`SELECT d.* FROM sinosure_documents d JOIN (SELECT document_type,MAX(version) version FROM sinosure_documents WHERE contract_id=? GROUP BY document_type) latest ON latest.document_type=d.document_type AND latest.version=d.version WHERE d.contract_id=?`).all(contract.id,contract.id).map(d=>({id:Number(d.id),document_type:d.document_type,original_name:d.original_name,version:Number(d.version),uploaded_at:d.uploaded_at}));return {...contract,id:Number(contract.id),tt_same_entity:Boolean(contract.tt_same_entity),lines,documents,complete:sinosureComplete(contract)};});const incomplete=contracts.filter(x=>!x.complete&&['active','revision'].includes(x.status));return {partners,contracts,incomplete_count:incomplete.length,incomplete:incomplete.slice(0,10),snapshots:db.prepare('SELECT id,file_name,row_count,is_active,imported_at FROM sinosure_snapshots ORDER BY id DESC').all(),conflicts:db.prepare('SELECT * FROM sinosure_import_conflicts WHERE resolved_at IS NULL ORDER BY created_at DESC').all()};}
function saveSinosureContract(data,user,id=''){const so=sinosureText(data.so_number);if(!so)throw new Error('Nomor SO wajib diisi.');const partnerId=Number(data.partner_id)||null, parent=Number(data.parent_contract_id)||null, relation=['','addition','replacement'].includes(data.relation_type)?data.relation_type:'';if(parent===Number(id))throw new Error('Kontrak tidak dapat menjadi induknya sendiri.');const status=['active','complete','revision','cancelled','replaced'].includes(data.status)?data.status:'active',values=[so,sinosureText(data.contract_number),sinosureText(data.buyer_name),sinosureText(data.brand),partnerId,status,relation,parent,data.tt_same_entity===false||data.tt_same_entity==='false'?0:1,sinosureText(data.notes),user.username];if(!values[2])throw new Error('Nama buyer wajib diisi.');const lines=Array.isArray(data.lines)?data.lines:[];db.exec('BEGIN');try{let contractId=Number(id);if(contractId){if(!db.prepare('SELECT id FROM sinosure_contracts WHERE id=?').get(contractId))throw new Error('Kontrak tidak ditemukan.');db.prepare('UPDATE sinosure_contracts SET so_number=?,contract_number=?,buyer_name=?,brand=?,partner_id=?,status=?,relation_type=?,parent_contract_id=?,tt_same_entity=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(...values.slice(0,-1),contractId);db.prepare('DELETE FROM sinosure_contract_lines WHERE contract_id=?').run(contractId);}else{const created=db.prepare('INSERT INTO sinosure_contracts(so_number,contract_number,buyer_name,brand,partner_id,status,relation_type,parent_contract_id,tt_same_entity,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(...values);contractId=Number(created.lastInsertRowid);}const insert=db.prepare('INSERT INTO sinosure_contract_lines(contract_id,category,factory_model,customer_model,quantity,remaining_quantity,unit_price,notes) VALUES (?,?,?,?,?,?,?,?)');for(const line of lines.filter(x=>sinosureText(x.category)||sinosureText(x.factory_model)||sinosureText(x.customer_model)))insert.run(contractId,sinosureText(line.category),sinosureText(line.factory_model),sinosureText(line.customer_model),Number(line.quantity)||0,Number(line.remaining_quantity)||0,Number(line.unit_price)||0,sinosureText(line.notes));if(parent&&relation==='replacement')db.prepare("UPDATE sinosure_contracts SET status='replaced',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(parent);db.exec('COMMIT');return contractId;}catch(error){db.exec('ROLLBACK');throw error;}}
function saveSinosureDocument(contractId,type,file,name,mime,user){if(!sinosureTypes.includes(type))throw new Error('Jenis dokumen tidak valid.');const contract=db.prepare('SELECT id,so_number,contract_number FROM sinosure_contracts WHERE id=?').get(contractId);if(!contract)throw new Error('Kontrak tidak ditemukan.');const version=Number(db.prepare('SELECT COALESCE(MAX(version),0)+1 AS version FROM sinosure_documents WHERE contract_id=? AND document_type=?').get(contractId,type).version),original=String(name||'dokumen').replace(/[\\/]/g,'_').slice(0,180),created=db.prepare('INSERT INTO sinosure_documents(contract_id,document_type,original_name,mime_type,file_data,version,uploaded_by) VALUES (?,?,?,?,?,?,?)').run(contractId,type,original,String(mime||'application/octet-stream').slice(0,100),file,version,user.username),id=Number(created.lastInsertRowid),extension=(extname(original)||'.bin').toLowerCase(),safe=value=>String(value||'').replace(/[\\/:*?"<>|]/g,'-').replace(/\s+/g,'_'),date=new Date().toISOString().slice(0,10).replaceAll('-',''),target_name=`${safe(contract.so_number||contract.contract_number)}_${safe(type)}_${date}_v${version}${extension}`;db.prepare('INSERT INTO sinosure_document_exports(document_id,target_name) VALUES (?,?)').run(id,target_name);db.prepare('UPDATE sinosure_contracts SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(contractId);try{sinosureSyncLog('requirement_documents','export',user,{source_type:'wecom',file_name:target_name,status:'pending',message:'Dokumen menunggu ekspor ke WeDrive.'});}catch{}return id;}
const sinosureClientCodes=()=>db.prepare('SELECT * FROM sinosure_client_codes ORDER BY sequence_code').all().map(row=>({...row,id:Number(row.id)}));
function saveSinosureClientCode(data,id=''){const value=key=>sinosureText(data[key]).slice(0,key==='company_name'?180:100),sequence=value('sequence_code');if(!sequence)throw new Error('Nomor urut wajib diisi.');if(!value('company_name'))throw new Error('Nama perusahaan wajib diisi.');const values=[sequence,value('company_name'),value('buyer_code'),value('brand'),value('customer_name'),value('insured_company')];if(id){if(!db.prepare('SELECT id FROM sinosure_client_codes WHERE id=?').get(id))throw new Error('Code client tidak ditemukan.');db.prepare('UPDATE sinosure_client_codes SET sequence_code=?,company_name=?,buyer_code=?,brand=?,customer_name=?,insured_company=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(...values,id);return Number(id);}const result=db.prepare('INSERT INTO sinosure_client_codes(sequence_code,company_name,buyer_code,brand,customer_name,insured_company) VALUES (?,?,?,?,?,?)').run(...values);return Number(result.lastInsertRowid);}
const sinosureDeliveries=()=>db.prepare('SELECT d.*,c.sequence_code,c.company_name FROM sinosure_deliveries d LEFT JOIN sinosure_client_codes c ON c.id=d.client_code_id ORDER BY d.ship_date DESC,d.id DESC').all();
function saveSinosureDelivery(data,id=''){const text=key=>sinosureText(data[key]),values=[Number(data.client_code_id)||null,text('ship_date'),text('invoice_number'),text('pi_number'),text('product_model'),Number(data.quantity)||0,Number(data.unit_price_cny)||0,Number(data.unit_price_idr)||0,Number(data.total_cny)||0,Number(data.total_idr)||0,text('payment_terms'),text('insured_status'),text('remarks')];if(!values[1]||!values[2]||!values[4])throw new Error('Tanggal kirim, nomor invoice, dan model produk wajib diisi.');if(id){db.prepare('UPDATE sinosure_deliveries SET client_code_id=?,ship_date=?,invoice_number=?,pi_number=?,product_model=?,quantity=?,unit_price_cny=?,unit_price_idr=?,total_cny=?,total_idr=?,payment_terms=?,insured_status=?,remarks=?,manually_edited=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(...values,id);return Number(id);}return Number(db.prepare("INSERT INTO sinosure_deliveries(client_code_id,source_key,review_status,ship_date,invoice_number,pi_number,product_model,quantity,unit_price_cny,unit_price_idr,total_cny,total_idr,payment_terms,insured_status,remarks) VALUES (?,'','normal',?,?,?,?,?,?,?,?,?,?,?,?,?)").run(...values).lastInsertRowid);}
function importSinosureDeliveries(file,name){const source=join(tmpdir(),`sinosure-delivery-${randomUUID()}.xlsx`),output=`${source}.json`;try{writeFileSync(source,file);const result=runPython(join(ROOT,'scripts','extract_sinosure_deliveries.py'),[source,output],'openpyxl');if(result.status!==0)throw new Error(result.stderr||'Workbook pengiriman tidak dapat dibaca.');const items=JSON.parse(readFileSync(output,'utf8')).items||[], clients=new Map(sinosureClientCodes().map(x=>[x.sequence_code,x]));let created=0,updated=0,review=0,unlinked=0;const find=db.prepare('SELECT * FROM sinosure_deliveries WHERE source_key=?'),insert=db.prepare('INSERT INTO sinosure_deliveries(client_code_id,source_key,review_status,ship_date,invoice_number,pi_number,product_model,quantity,unit_price_cny,unit_price_idr,total_cny,total_idr,payment_terms,insured_status,remarks) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),update=db.prepare('UPDATE sinosure_deliveries SET client_code_id=?,review_status=?,ship_date=?,invoice_number=?,pi_number=?,product_model=?,quantity=?,unit_price_cny=?,unit_price_idr=?,total_cny=?,total_idr=?,payment_terms=?,insured_status=?,remarks=?,updated_at=CURRENT_TIMESTAMP WHERE id=?');for(const item of items){const client=clients.get(item.client_sequence),key=[item.client_sequence,item.ship_date,item.invoice_number,item.product_model].join('|'),existing=find.get(key),values=[client?.id||null,client?'normal':'unlinked',item.ship_date,item.invoice_number,item.pi_number,item.product_model,item.quantity,item.unit_price_cny,item.unit_price_idr,item.total_cny,item.total_idr,item.payment_terms,item.insured_status,item.remarks];if(!client)unlinked++;if(existing){if(existing.manually_edited){db.prepare("UPDATE sinosure_deliveries SET review_status='review' WHERE id=?").run(existing.id);review++;}else{update.run(...values,existing.id);updated++;}}else{insert.run(values[0],key,...values.slice(1));created++;}}return {created,updated,review,unlinked,total:items.length};}finally{if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);}}
const sinosureWeDriveFolder=process.env.SINOSURE_WEDRIVE_FOLDER||'C:\\Users\\adits\\Documents\\WXWork\\1688857318935380\\WeDrive\\巍星电子\\CAHAYA财务部-Finance Department';
function sinosureWeDriveFiles(){
  if(!existsSync(sinosureWeDriveFolder))throw new Error('Folder WeDrive Sinosure tidak ditemukan. Pastikan WeCom sudah menyinkronkan folder Finance Department.');
  const selected=new Set(db.prepare('SELECT source_path FROM sinosure_delivery_sync_files').all().map(row=>row.source_path));
  return readdirSync(sinosureWeDriveFolder,{withFileTypes:true}).filter(entry=>entry.isFile()&&/\.xlsx$/i.test(entry.name)&&!entry.name.startsWith('~$')&&/(sinosure|中信保)/i.test(entry.name)).map(entry=>{const source_path=join(sinosureWeDriveFolder,entry.name),stats=statSync(source_path);return {name:entry.name,source_path,size:stats.size,modified_at:new Date(stats.mtimeMs).toISOString(),selected:selected.has(source_path)};}).sort((a,b)=>a.name.localeCompare(b.name));
}
function saveSinosureWeDriveFiles(paths){
  const allowed=new Set(sinosureWeDriveFiles().map(file=>file.source_path)),selected=[...new Set((Array.isArray(paths)?paths:[]).map(item=>String(item)))];
  if(selected.some(path=>!allowed.has(path)))throw new Error('Salah satu file tidak lagi tersedia di folder WeDrive.');
  db.exec('BEGIN IMMEDIATE');try{db.exec('DELETE FROM sinosure_delivery_sync_files');const insert=db.prepare('INSERT INTO sinosure_delivery_sync_files(source_path) VALUES (?)');for(const path of selected)insert.run(path);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  return sinosureWeDriveFiles();
}
function syncSinosureWeDrive(){
  const files=sinosureWeDriveFiles().filter(file=>file.selected);
  if(!files.length)throw new Error('Pilih minimal satu file pada Pengaturan WeDrive sebelum sinkronisasi.');
  let imported=0,created=0,updated=0,review=0,unlinked=0;
  const previous=db.prepare('SELECT file_size,file_mtime_ms FROM sinosure_delivery_imports WHERE source_path=?'),save=db.prepare("INSERT INTO sinosure_delivery_imports(source_path,file_size,file_mtime_ms,status,message,created_count,updated_count,imported_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(source_path) DO UPDATE SET file_size=excluded.file_size,file_mtime_ms=excluded.file_mtime_ms,status=excluded.status,message=excluded.message,created_count=excluded.created_count,updated_count=excluded.updated_count,imported_at=CURRENT_TIMESTAMP");
  for(const file of files){const stats=statSync(file.source_path),old=previous.get(file.source_path);if(old&&Number(old.file_size)===stats.size&&Number(old.file_mtime_ms)===Math.floor(stats.mtimeMs))continue;try{const result=importSinosureDeliveries(readFileSync(file.source_path),file.name);save.run(file.source_path,stats.size,Math.floor(stats.mtimeMs),'success',`${result.total} baris dibaca`,result.created,result.updated);imported++;created+=result.created;updated+=result.updated;review+=result.review;unlinked+=result.unlinked;}catch(error){save.run(file.source_path,stats.size,Math.floor(stats.mtimeMs),'failed',String(error.message||error).slice(0,1000),0,0);throw new Error(`Gagal membaca ${file.name}: ${error.message||error}`);}}
  return {folder:sinosureWeDriveFolder,scanned:files.length,imported,created,updated,review,unlinked};
}
const sinosureWeDriveStatus=()=>db.prepare('SELECT source_path,imported_at,status,message,created_count,updated_count FROM sinosure_delivery_imports ORDER BY imported_at DESC LIMIT 10').all();
const wecomBase='https://qyapi.weixin.qq.com/cgi-bin';
let wecomTokenCache={value:'',expiresAt:0};
function sinosureWecomSettings(){const setting=db.prepare('SELECT * FROM sinosure_wecom_settings WHERE id=1').get();return {corp_id:setting.corp_id,user_id:setting.user_id,space_id:setting.space_id,folder_id:setting.folder_id,has_corp_secret:Boolean(setting.corp_secret),updated_at:setting.updated_at};}
function saveSinosureWecomSettings(input){const current=db.prepare('SELECT corp_secret FROM sinosure_wecom_settings WHERE id=1').get(),value=key=>String(input?.[key]||'').trim().slice(0,300),corp_id=value('corp_id'),user_id=value('user_id'),space_id=value('space_id'),folder_id=value('folder_id'),secret=value('corp_secret');if(!corp_id||!user_id||!space_id||!folder_id)throw new Error('Corp ID, User ID, Space ID, dan Folder ID wajib diisi.');db.prepare('UPDATE sinosure_wecom_settings SET corp_id=?,corp_secret=?,user_id=?,space_id=?,folder_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(corp_id,secret||current.corp_secret,user_id,space_id,folder_id);wecomTokenCache={value:'',expiresAt:0};return sinosureWecomSettings();}
async function wecomJson(url,options={}){const response=await fetch(url,options),data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.errmsg||`WeCom API gagal (${response.status}).`);if(data.errcode&&Number(data.errcode)!==0)throw new Error(`WeCom: ${data.errmsg||data.errcode}`);return data;}
async function wecomToken(){if(wecomTokenCache.value&&Date.now()<wecomTokenCache.expiresAt)return wecomTokenCache.value;const setting=db.prepare('SELECT * FROM sinosure_wecom_settings WHERE id=1').get();if(!setting.corp_id||!setting.corp_secret)throw new Error('Simpan Corp ID dan Secret aplikasi WeCom terlebih dahulu.');const params=new URLSearchParams({corpid:setting.corp_id,corpsecret:setting.corp_secret}),data=await wecomJson(`${wecomBase}/gettoken?${params}`);if(!data.access_token)throw new Error('WeCom tidak mengembalikan access token.');wecomTokenCache={value:data.access_token,expiresAt:Date.now()+Math.max(60,Number(data.expires_in||7200)-300)*1000};return data.access_token;}
async function wecomDeliveryFiles(){const setting=db.prepare('SELECT * FROM sinosure_wecom_settings WHERE id=1').get();if(!setting.user_id||!setting.space_id||!setting.folder_id)throw new Error('Simpan User ID, Space ID, dan Folder ID WeCom terlebih dahulu.');const token=await wecomToken(),data=await wecomJson(`${wecomBase}/wedrive/file_list?access_token=${encodeURIComponent(token)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userid:setting.user_id,spaceid:setting.space_id,fatherid:setting.folder_id,sort_type:6,start:0,limit:1000})}),selected=new Set(db.prepare('SELECT file_id FROM sinosure_wecom_sync_files').all().map(row=>row.file_id)),rows=data.file_list||data.files||[];return rows.filter(file=>/\.xlsx$/i.test(String(file.file_name||file.name||''))&&/(sinosure|中信保)/i.test(String(file.file_name||file.name||''))).map(file=>({file_id:String(file.fileid||file.file_id||file.id||''),file_name:String(file.file_name||file.name||''),size:Number(file.file_size||file.size||0),selected:selected.has(String(file.fileid||file.file_id||file.id||''))})).filter(file=>file.file_id);}
async function saveSinosureWecomFiles(fileIds){const available=await wecomDeliveryFiles(),allowed=new Map(available.map(file=>[file.file_id,file])),selected=[...new Set((Array.isArray(fileIds)?fileIds:[]).map(value=>String(value)))];if(selected.some(id=>!allowed.has(id)))throw new Error('Salah satu file WeCom tidak lagi tersedia.');db.exec('BEGIN IMMEDIATE');try{db.exec('DELETE FROM sinosure_wecom_sync_files');const insert=db.prepare('INSERT INTO sinosure_wecom_sync_files(file_id,file_name) VALUES (?,?)');for(const id of selected)insert.run(id,allowed.get(id).file_name);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return wecomDeliveryFiles();}
async function syncSinosureWecom(){const files=(await wecomDeliveryFiles()).filter(file=>file.selected);if(!files.length)throw new Error('Pilih minimal satu file WeCom sebelum sinkronisasi.');const setting=db.prepare('SELECT * FROM sinosure_wecom_settings WHERE id=1').get(),token=await wecomToken();let imported=0,created=0,updated=0,review=0,unlinked=0;for(const file of files){const download=await wecomJson(`${wecomBase}/wedrive/file_download?access_token=${encodeURIComponent(token)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userid:setting.user_id,fileid:file.file_id})}),downloadUrl=download.download_url||download.url;if(!downloadUrl)throw new Error(`WeCom tidak memberi tautan unduh untuk ${file.file_name}.`);const response=await fetch(downloadUrl);if(!response.ok)throw new Error(`Gagal mengunduh ${file.file_name} dari WeCom.`);const result=importSinosureDeliveries(Buffer.from(await response.arrayBuffer()),file.file_name);imported++;created+=result.created;updated+=result.updated;review+=result.review;unlinked+=result.unlinked;}return {imported,created,updated,review,unlinked};}
let wecomExcelTokenCache={value:'',expiresAt:0};
function wecomExcelSettings(){const s=db.prepare('SELECT * FROM wecom_excel_settings WHERE id=1').get();return {corp_id:s.corp_id,service_user_id:s.service_user_id,space_id:s.space_id,folder_id:s.folder_id,agent_id:s.agent_id,has_corp_secret:Boolean(s.corp_secret),connected:Boolean(s.corp_id&&s.corp_secret&&s.service_user_id&&s.agent_id),updated_at:s.updated_at};}
function saveWecomExcelSettings(input){const old=db.prepare('SELECT corp_secret FROM wecom_excel_settings WHERE id=1').get(),value=k=>String(input?.[k]||'').trim().slice(0,500),secret=value('corp_secret')||old.corp_secret;if(!value('corp_id')||!secret||!value('service_user_id')||!value('agent_id'))throw new Error('Corp ID, Secret aplikasi, User ID akun layanan, dan Agent ID wajib diisi.');db.prepare('UPDATE wecom_excel_settings SET corp_id=?,corp_secret=?,service_user_id=?,space_id=?,folder_id=?,agent_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(value('corp_id'),secret,value('service_user_id'),value('space_id'),value('folder_id'),value('agent_id'));wecomExcelTokenCache={value:'',expiresAt:0};return wecomExcelSettings();}
async function wecomExcelToken(){if(wecomExcelTokenCache.value&&Date.now()<wecomExcelTokenCache.expiresAt)return wecomExcelTokenCache.value;const s=db.prepare('SELECT * FROM wecom_excel_settings WHERE id=1').get(),p=new URLSearchParams({corpid:s.corp_id,corpsecret:s.corp_secret}),data=await wecomJson(`${wecomBase}/gettoken?${p}`);wecomExcelTokenCache={value:data.access_token,expiresAt:Date.now()+Math.max(60,Number(data.expires_in||7200)-300)*1000};return data.access_token;}
async function sendWecomExcelTest(input){const s=db.prepare('SELECT * FROM wecom_excel_settings WHERE id=1').get(),to=String(input?.user_id||'').trim(),content=String(input?.message||'Uji koneksi WeCom dari CAP Analytics.').trim();if(!to)throw new Error('User ID penerima wajib diisi.');const token=await wecomExcelToken();await wecomJson(`${wecomBase}/message/send?access_token=${encodeURIComponent(token)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({touser:to,msgtype:'text',agentid:Number(s.agent_id),text:{content},safe:0})});return {sent:true,user_id:to};}
async function wecomExcelContacts(){const token=await wecomExcelToken(),data=await wecomJson(`${wecomBase}/user/list?access_token=${encodeURIComponent(token)}&department_id=1&fetch_child=1`);return (data.userlist||[]).filter(row=>row.userid&&row.status!==4).map(row=>({user_id:String(row.userid),name:String(row.name||row.userid),department:Array.isArray(row.department)?row.department:[],mobile:String(row.mobile||'')})).sort((a,b)=>a.name.localeCompare(b.name,'id'));}
async function sendWecomExcelMass(input){const recipients=[...new Set((Array.isArray(input?.user_ids)?input.user_ids:[]).map(value=>String(value||'').trim()).filter(Boolean))],content=String(input?.message||'').trim();if(!recipients.length)throw new Error('Pilih minimal satu kontak penerima.');if(recipients.length>1000)throw new Error('Maksimal 1.000 penerima per pengiriman.');if(!content)throw new Error('Isi pesan terlebih dahulu.');const s=db.prepare('SELECT * FROM wecom_excel_settings WHERE id=1').get(),token=await wecomExcelToken();await wecomJson(`${wecomBase}/message/send?access_token=${encodeURIComponent(token)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({touser:recipients.join('|'),msgtype:'text',agentid:Number(s.agent_id),text:{content},safe:0})});return {sent:true,total:recipients.length};}
const sinosureSyncCategories={deliveries:'Pengiriman',contract_verification:'Verifikasi Kontrak',requirement_documents:'Dokumen Persyaratan'};
function sinosureSyncLog(category,action,user,{source_type='',file_name='',status='success',message=''}={}){db.prepare('INSERT INTO sinosure_sync_activity(category,action,source_type,file_name,actor,status,message) VALUES (?,?,?,?,?,?,?)').run(category,action,source_type,file_name,String(user?.username||'sistem').slice(0,100),status,String(message||'').slice(0,1000));}
function sinosureSyncData(){return {categories:Object.entries(sinosureSyncCategories).map(([category,label])=>({...db.prepare('SELECT * FROM sinosure_sync_sources WHERE category=?').get(category),category,label,enabled:Boolean(db.prepare('SELECT enabled FROM sinosure_sync_sources WHERE category=?').get(category)?.enabled)})),activities:db.prepare('SELECT * FROM sinosure_sync_activity ORDER BY id DESC LIMIT 100').all(),reviews:db.prepare("SELECT * FROM sinosure_sync_reviews WHERE status='open' ORDER BY id DESC").all(),pending_document_exports:db.prepare("SELECT e.*,d.original_name,c.so_number FROM sinosure_document_exports e JOIN sinosure_documents d ON d.id=e.document_id JOIN sinosure_contracts c ON c.id=d.contract_id WHERE e.status='pending' ORDER BY e.id DESC").all(),wecom_ready:Boolean(sinosureWecomSettings().has_corp_secret)};}
function saveSinosureSyncSource(category,input,user){if(!sinosureSyncCategories[category])throw new Error('Kategori sinkronisasi tidak valid.');const source_type=['local','wecom','manual'].includes(input?.source_type)?input.source_type:'manual',source_path=String(input?.source_path||'').trim().slice(0,500),enabled=input?.enabled===false||input?.enabled==='false'?0:1;db.prepare('UPDATE sinosure_sync_sources SET source_type=?,source_path=?,enabled=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE category=?').run(source_type,source_path,enabled,user.username,category);sinosureSyncLog(category,'review',user,{source_type,status:'success',message:'Pengaturan sumber diperbarui.'});return sinosureSyncData();}
async function syncSinosureCategory(category,user){const source=db.prepare('SELECT * FROM sinosure_sync_sources WHERE category=?').get(category);if(!source||!source.enabled)throw new Error('Kategori ini belum diaktifkan untuk sinkronisasi.');try{let result={};if(category==='deliveries'){if(source.source_type==='wecom')result=await syncSinosureWecom();else if(source.source_type==='local'&&source.source_path){if(!existsSync(source.source_path))throw new Error('File sumber lokal tidak ditemukan. Pilih kembali file pada pengaturan sumber.');result=importSinosureDeliveries(readFileSync(source.source_path),source.source_path);}else if(source.source_type==='local')result=syncSinosureWeDrive();else throw new Error('Pengiriman dari unggah manual diproses melalui tombol Impor Excel.');}else{const reason=category==='contract_verification'?'Berkas verifikasi kontrak perlu dipetakan ke kontrak sebelum diterapkan.':'Dokumen persyaratan perlu dipetakan ke folder kontrak sebelum diterapkan.';db.prepare('INSERT INTO sinosure_sync_reviews(category,file_name,reason) VALUES (?,?,?)').run(category,source.source_path||'Belum ada berkas sumber',reason);result={review:1,message:reason};}
    sinosureSyncLog(category,'import',user,{source_type:source.source_type,file_name:source.source_path,message:result.message||`${result.imported||0} berkas diproses.`});return result;
  }catch(error){sinosureSyncLog(category,'failed',user,{source_type:source.source_type,file_name:source.source_path,status:'failed',message:error.message||String(error)});throw error;}}
async function syncAllSinosure(user){const results=[];for(const category of Object.keys(sinosureSyncCategories)){try{results.push({category,ok:true,result:await syncSinosureCategory(category,user)});}catch(error){results.push({category,ok:false,error:error.message||String(error)});}}return {results};}
async function exportSinosureDocumentToWecom(documentId,user){const row=db.prepare('SELECT e.id,e.target_name,d.file_data,d.mime_type,c.id contract_id,c.so_number,c.contract_number,c.buyer_name FROM sinosure_document_exports e JOIN sinosure_documents d ON d.id=e.document_id JOIN sinosure_contracts c ON c.id=d.contract_id WHERE e.document_id=? ORDER BY e.id DESC LIMIT 1').get(documentId);if(!row)return {status:'not_queued'};try{const setting=db.prepare('SELECT * FROM sinosure_wecom_settings WHERE id=1').get();if(!setting.corp_id||!setting.corp_secret||!setting.user_id||!setting.space_id||!setting.folder_id)throw new Error('Pengaturan WeCom belum lengkap; dokumen disimpan sebagai menunggu ekspor.');if(row.file_data.length>18*1024*1024)throw new Error('Dokumen lebih dari 18 MB; gunakan unggah WeCom manual atau mekanisme berkas besar.');const token=await wecomToken(),known=db.prepare('SELECT folder_id FROM sinosure_contract_wedrive_folders WHERE contract_id=?').get(row.contract_id);let folderId=known?.folder_id;if(!folderId){const safe=value=>String(value||'').replace(/[\\/:*?"<>|]/g,'-').replace(/\s+/g,'_'),folderName=`${safe(row.so_number||row.contract_number)}_${safe(row.buyer_name)}`,created=await wecomJson(`${wecomBase}/wedrive/file_create?access_token=${encodeURIComponent(token)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userid:setting.user_id,spaceid:setting.space_id,fatherid:setting.folder_id,file_type:1,file_name:folderName})});folderId=created.fileid||created.file_id;if(!folderId)throw new Error('WeCom tidak mengembalikan ID folder kontrak.');db.prepare('INSERT INTO sinosure_contract_wedrive_folders(contract_id,folder_id,folder_name) VALUES (?,?,?)').run(row.contract_id,folderId,folderName);}await wecomJson(`${wecomBase}/wedrive/file_upload?access_token=${encodeURIComponent(token)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userid:setting.user_id,spaceid:setting.space_id,fatherid:folderId,file_name:row.target_name,file_base64_content:Buffer.from(row.file_data).toString('base64')})});db.prepare("UPDATE sinosure_document_exports SET status='exported',message='',exported_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);sinosureSyncLog('requirement_documents','export',user,{source_type:'wecom',file_name:row.target_name,message:'Dokumen diunggah ke folder kontrak WeDrive oleh akun WeCom bersama.'});return {status:'exported',target_name:row.target_name};}catch(error){db.prepare("UPDATE sinosure_document_exports SET status='failed',message=? WHERE id=?").run(String(error.message||error).slice(0,1000),row.id);sinosureSyncLog('requirement_documents','failed',user,{source_type:'wecom',file_name:row.target_name,status:'failed',message:error.message||String(error)});return {status:'failed',message:error.message||String(error)};}}
const pettyCashCategories=['pdam','atk','bbm','gaji','gudang','listrik','packing','perawatan kendaraan','lakban','bubble','ekspedisi','entertain','wifi','online','kbkb','isi ulang galon','rumah tangga','parkir','lainnya'];
const pettyCashCategory=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
function normalizePettyCash(input,sourceFile=''){
  const transaction_date=String(input.transaction_date||'').trim(),rawCategory=pettyCashCategory(input.category),person_name=String(input.person_name??input.name??'').trim().slice(0,120),source_number=String(input.source_number??input.no??'').trim().slice(0,120),description=String(input.description??input.keterangan??'').trim().slice(0,1000),amount=Number(input.amount??input.nominal);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(transaction_date))throw new Error('Tanggal transaksi wajib diisi dengan format yang valid.');
  if(!rawCategory)throw new Error('Kategori wajib dipilih.');
  if(!Number.isFinite(amount)||amount<0)throw new Error('Nominal harus berupa angka nol atau lebih.');
  const category=pettyCashCategories.includes(rawCategory)?rawCategory:'lainnya',other_category=(rawCategory==='lainnya'?String(input.other_category||'').trim():category==='lainnya'?String(input.other_category||input.category||'').trim():'').slice(0,120);
  if(category==='lainnya'&&!other_category)throw new Error('Nama kategori lainnya wajib diisi.');
  return {transaction_date,category,other_category,person_name,source_number,description,amount:Math.round(amount),source_file:String(sourceFile||'').slice(0,255)};
}
function pettyCashData(start='',end=''){
  const rows=db.prepare("SELECT * FROM petty_cash_transactions WHERE (?='' OR transaction_date>=?) AND (?='' OR transaction_date<=?) ORDER BY transaction_date DESC,id DESC").all(start,start,end,end);
  const categories=new Map();for(const row of rows){const label=row.category==='lainnya'?row.other_category||'Lainnya':row.category;categories.set(label,(categories.get(label)||0)+row.amount);}
  return {summary:{total:rows.reduce((sum,row)=>sum+row.amount,0),count:rows.length,categories:categories.size},records:rows,byCategory:[...categories.entries()].map(([category,total])=>({category,total})).sort((a,b)=>b.total-a.total)};
}
function companyExpenseDashboard(mode='weekly', anchor='', category=''){
  const selected=['daily','weekly','monthly','yearly'].includes(mode)?mode:'weekly',value=/^\d{4}-\d{2}-\d{2}$/.test(String(anchor||''))?String(anchor):new Date().toISOString().slice(0,10),date=new Date(`${value}T00:00:00`),iso=item=>[item.getFullYear(),String(item.getMonth()+1).padStart(2,'0'),String(item.getDate()).padStart(2,'0')].join('-');
  let start,end,points=[];
  if(selected==='daily'){start=new Date(date.getFullYear(),date.getMonth(),1);end=new Date(date.getFullYear(),date.getMonth()+1,0);for(let day=1;day<=end.getDate();day++)points.push({key:String(day),label:String(day)});}
  else if(selected==='weekly'){start=new Date(date.getFullYear(),date.getMonth(),1);end=new Date(date.getFullYear(),date.getMonth()+1,0);for(let week=0;week<Math.ceil(end.getDate()/7);week++){const first=week*7+1,last=Math.min(first+6,end.getDate());points.push({key:String(week),label:`${first}–${last}`});}}
  else if(selected==='monthly'){start=new Date(date.getFullYear(),0,1);end=new Date(date.getFullYear(),11,31);for(let month=0;month<12;month++)points.push({key:String(month),label:new Date(date.getFullYear(),month,1).toLocaleDateString('id-ID',{month:'short'})});}
  else {const years=db.prepare("SELECT DISTINCT substr(transaction_date,1,4) AS year FROM petty_cash_transactions WHERE transaction_date<>'' ORDER BY year").all().map(row=>row.year).filter(Boolean);const useYears=years.length?years:[String(date.getFullYear())];start=new Date(`${useYears[0]}-01-01T00:00:00`);end=new Date(`${useYears.at(-1)}-12-31T00:00:00`);points=useYears.map(year=>({key:year,label:year}));}
  const rows=db.prepare('SELECT transaction_date,category,other_category,amount FROM petty_cash_transactions WHERE transaction_date>=? AND transaction_date<=?').all(iso(start),iso(end)).map(row=>({...row,label:row.category==='lainnya'?(row.other_category||'Lainnya'):row.category})).filter(row=>!category||row.label===category);
  const totals=new Map(points.map(point=>[point.key,0])),categories=new Map();for(const row of rows){const current=new Date(`${row.transaction_date}T00:00:00`);const key=selected==='daily'?String(current.getDate()):selected==='weekly'?String(Math.floor((current.getDate()-1)/7)):selected==='monthly'?String(current.getMonth()):String(current.getFullYear());totals.set(key,(totals.get(key)||0)+Number(row.amount||0));categories.set(row.label,(categories.get(row.label)||0)+Number(row.amount||0));}
  const byCategory=[...categories.entries()].map(([name,total])=>({name,total})).sort((a,b)=>b.total-a.total),total=rows.reduce((sum,row)=>sum+Number(row.amount||0),0);
  const choices=db.prepare("SELECT DISTINCT CASE WHEN category='lainnya' THEN coalesce(nullif(other_category,''),'Lainnya') ELSE category END AS name FROM petty_cash_transactions ORDER BY name COLLATE NOCASE").all().map(row=>row.name);
  return {mode:selected,anchor:value,category,range:{start:iso(start),end:iso(end)},summary:{total,count:rows.length,largest:byCategory[0]||null},points:points.map(point=>({...point,total:totals.get(point.key)||0})),categories:choices};
}
function savePettyCash(input,sourceFile=''){
  const item=normalizePettyCash(input,sourceFile),insert=db.prepare('INSERT INTO petty_cash_transactions (transaction_date,category,other_category,person_name,source_number,description,amount,source_file) VALUES (?,?,?,?,?,?,?,?)');
  const result=insert.run(item.transaction_date,item.category,item.other_category,item.person_name,item.source_number,item.description,item.amount,item.source_file);
  return {id:Number(result.lastInsertRowid),...item};
}
function saveImportedPettyCash(items,fileName){
  const duplicate=db.prepare('SELECT id FROM petty_cash_transactions WHERE transaction_date=? AND category=? AND other_category=? AND person_name=? AND source_number=? AND description=? AND amount=? LIMIT 1'),insert=db.prepare('INSERT INTO petty_cash_transactions (transaction_date,category,other_category,person_name,source_number,description,amount,source_file) VALUES (?,?,?,?,?,?,?,?)');let inserted=0,duplicates=0;
  db.exec('BEGIN');try{for(const raw of items){const item=normalizePettyCash(raw,fileName);if(duplicate.get(item.transaction_date,item.category,item.other_category,item.person_name,item.source_number,item.description,item.amount)){duplicates++;continue}insert.run(item.transaction_date,item.category,item.other_category,item.person_name,item.source_number,item.description,item.amount,item.source_file);inserted++;}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error}return {inserted,duplicates,total:items.length};
}
function importPettyCashExcel(fileData,fileName){
  const extension=extname(fileName).toLowerCase();if(!['.xlsx','.xls'].includes(extension))throw new Error('Unggah berkas Excel .xlsx atau .xls.');
  const source=join(tmpdir(),`cap-kas-kecil-${randomUUID()}${extension}`),output=`${source}.json`;
  try{writeFileSync(source,fileData);const result=runPython(join(ROOT,'scripts','extract_petty_cash_excel.py'),[source,output]);if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Excel Kas Kecil tidak dapat diproses.');const items=JSON.parse(readFileSync(output,'utf8')).items||[];if(!items.length)throw new Error('Tidak ada transaksi Kas Kecil yang ditemukan pada Excel.');return saveImportedPettyCash(items,fileName);}finally{if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);}
}
const indonesianMonths={januari:'01',februari:'02',maret:'03',april:'04',mei:'05',juni:'06',juli:'07',agustus:'08',september:'09',oktober:'10',november:'11',desember:'12'};
const rekapCashCategory=description=>/bpjs|gaji|upah/i.test(description)?'gaji':/mata\s*bor|perkakas|alat|perawatan/i.test(description)?'gudang':/paket|kirim|ekspedisi|ongkir/i.test(description)?'ekspedisi':'lainnya';
function rekapImageLines(tsv){const lines=new Map();for(const row of String(tsv||'').split(/\r?\n/).slice(1)){const col=row.split('\t');if(col.length<12||col[0]!=='5'||!col[11]?.trim())continue;const key=col.slice(1,5).join('-'),item={left:Number(col[6])||0,text:col[11].trim()};if(!lines.has(key))lines.set(key,[]);lines.get(key).push(item);}return [...lines.values()].map(words=>words.sort((a,b)=>a.left-b.left).map(item=>item.text).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);}
function rekapImageDate(text){const match=String(text).match(/\b([0-3o]\d?)\s*(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s*(20\d{2})\b/i);if(!match)return '';const day=match[1].replace(/o/ig,'0');return Number(day)>0&&Number(day)<=31?`${match[3]}-${indonesianMonths[match[2].toLowerCase()]}-${day.padStart(2,'0')}`:'';}
function rekapImageAmount(text){const values=[...String(text).matchAll(/(?:rp\.?\s*)?(\d{1,3}(?:[.\s]\d{3})+|\d{4,})\b/ig)].map(match=>Number(match[1].replace(/[^\d]/g,''))).filter(value=>value>0);return values.at(-1)||0;}
function parseRekapCashImage(tsv){const items=[];for(const line of rekapImageLines(tsv)){const date=rekapImageDate(line),amount=rekapImageAmount(line);if(!date||!amount||/\b(tanggal|keterangan|nominal|total|hari)\b/i.test(line))continue;let rest=line.replace(/\b[0-3o]\d?\s*(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s*20\d{2}\b/i,'').replace(/\brp\.?\s*(\d{1,3}(?:[.\s]\d{3})+|\d{4,})\b/ig,'').replace(/[_\[|]/g,' ').replace(/\bI\b/g,'1').replace(/\s+/g,' ').replace(/\brp\.?\s*(\d{1,3}(?:[.\s]\d{3})+|\d{4,})\b/ig,'').trim();const fields=rest.match(/^(.+?)\s+(\d{1,3})\s+(.+)$/),person_name=fields?fields[1].trim():'',source_number=fields?fields[2]:'',description=(fields?fields[3]:rest).trim();if(description.length<8||!/[a-z]{2}/i.test(description)||/^rp\b/i.test(description))continue;items.push({transaction_date:date,category:rekapCashCategory(description),other_category:'Impor Rekap Kas Harian',person_name,source_number,description,amount});}return items;}
function importPettyCashImage(fileData,fileName){
  const extension=extname(fileName).toLowerCase();if(!['.png','.jpg','.jpeg','.webp'].includes(extension))throw new Error('Unggah gambar PNG, JPG, atau WEBP.');if(!Buffer.isBuffer(fileData)||!fileData.length)throw new Error('Gambar belum dipilih.');const ocr=ocrStatus();if(!ocr.ready)throw new Error(ocr.message);const source=join(tmpdir(),`cap-rekap-kas-${randomUUID()}${extension}`);
  try{writeFileSync(source,fileData);const result=spawnSync(ocr.executable,[source,'stdout','-l',ocr.indonesian?'ind+eng':'eng','--psm','4','tsv'],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:60000});if(result.error?.code==='ETIMEDOUT')throw new Error('Pembacaan gambar melebihi 60 detik. Gunakan gambar yang lebih kecil atau jelas.');if(result.error||result.status!==0)throw new Error(result.stderr||'Gambar rekap tidak dapat dibaca.');const items=parseRekapCashImage(result.stdout);if(!items.length)throw new Error('Tidak ada baris transaksi yang terbaca. Pastikan gambar memuat kolom Tanggal, Nama, No., Keterangan, dan Nominal dengan jelas.');return saveImportedPettyCash(items,fileName);}finally{if(existsSync(source))unlinkSync(source);}
}
function exportPettyCashExcel(start='',end=''){
  const report=pettyCashData(start,end),source=join(tmpdir(),`cap-kas-kecil-export-${randomUUID()}.json`),output=join(tmpdir(),`cap-kas-kecil-export-${randomUUID()}.xlsx`),period=start||end?`${start||'Awal data'} s.d. ${end||'Akhir data'}`:'Semua periode';
  try{writeFileSync(source,JSON.stringify({period,total:report.summary.total,records:report.records.map(row=>({...row,category_label:row.category==='lainnya'?(row.other_category||'Lainnya'):row.category}))}));const result=runPython(join(ROOT,'scripts','export_petty_cash_excel.py'),[source,output],'openpyxl');if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Excel pengeluaran tidak dapat dibuat.');return readFileSync(output);}finally{if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);}
}
function assetAudit(action,type,id,user,detail={}){db.prepare('INSERT INTO asset_audit_log(action,entity_type,entity_id,detail_json,actor) VALUES (?,?,?,?,?)').run(action,type,id||null,JSON.stringify(detail),String(user?.username||''));}
function assetCode(assetClass){const key=String(assetClass||'AST').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8)||'AST',prefix=`AST-${key}-`;const row=db.prepare('SELECT asset_code FROM assets WHERE asset_code LIKE ? ORDER BY asset_code DESC LIMIT 1').get(`${prefix}%`),next=(Number(String(row?.asset_code||'').split('-').pop())||0)+1;return `${prefix}${String(next).padStart(4,'0')}`;}
function assetSync(user){const account='01.02.001.000.000.0000',rows=db.prepare(`SELECT j.id journal_id,l.id journal_line_id,j.transaction_date,j.voucher_number,coalesce(nullif(l.description,''),j.description,'') description,l.debit FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE l.account_code=? AND l.debit>0 AND upper(j.voucher_number) NOT LIKE 'SA%' ORDER BY j.transaction_date,j.id,l.id`).all(account),find=db.prepare('SELECT * FROM asset_source_lines WHERE journal_line_id=?'),insert=db.prepare('INSERT INTO asset_source_lines(journal_id,journal_line_id,transaction_date,voucher_number,description,debit_amount,source_hash) VALUES (?,?,?,?,?,?,?)'),update=db.prepare("UPDATE asset_source_lines SET transaction_date=?,voucher_number=?,description=?,debit_amount=?,source_hash=?,status=CASE WHEN status IN ('allocated','partial','review') THEN 'review' ELSE status END,synced_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?");let added=0,changed=0;for(const r of rows){const hash=JSON.stringify([r.transaction_date,r.voucher_number,r.description,Number(r.debit)]),old=find.get(r.journal_line_id);if(!old){insert.run(r.journal_id,r.journal_line_id,r.transaction_date,r.voucher_number,r.description,Number(r.debit),hash);added++;}else if(old.source_hash!==hash){update.run(r.transaction_date,r.voucher_number,r.description,Number(r.debit),hash,old.id);changed++;}}assetAudit('sync','asset_source',null,user,{added,changed,source_rows:rows.length});return {added,changed,source_rows:rows.length};}
function assetSources(mode='open'){const where=mode==='review'?"s.status='review'":mode==='all'?'1=1':"s.status IN ('unallocated','partial')",rows=db.prepare(`SELECT s.*,coalesce(sum(CASE WHEN a.status='active' THEN a.allocated_amount ELSE 0 END),0) allocated_amount FROM asset_source_lines s LEFT JOIN asset_allocations a ON a.source_line_id=s.id GROUP BY s.id HAVING ${where} AND (s.status='unallocated' OR s.status='partial' OR s.status='review' OR s.status='not_asset' OR s.debit_amount-coalesce(sum(CASE WHEN a.status='active' THEN a.allocated_amount ELSE 0 END),0)>0.004) ORDER BY s.transaction_date DESC,s.id DESC`).all();return rows.map(r=>({...r,debit_amount:Number(r.debit_amount),allocated_amount:Number(r.allocated_amount),remaining_amount:Number(r.debit_amount)-Number(r.allocated_amount)}));}
function assetAge(start,months){if(!start)return {age_months:null,age_label:'Tanggal belum diisi',remaining_life_months:null,age_overdue:false};const date=new Date(`${start}T00:00:00`);if(Number.isNaN(date.getTime()))return {age_months:null,age_label:'Tanggal belum valid',remaining_life_months:null,age_overdue:false};const now=new Date(),age=Math.max(0,(now.getFullYear()-date.getFullYear())*12+now.getMonth()-date.getMonth()-(now.getDate()<date.getDate()?1:0)),years=Math.floor(age/12),remaining=months===null||months===undefined?null:Number(months)-age;return {age_months:age,age_label:years?`${years} thn ${age%12} bln`:`${age} bln`,remaining_life_months:remaining,age_overdue:remaining!==null&&remaining<0};}
function assetRegister(){return db.prepare(`SELECT a.*,coalesce(sum(CASE WHEN al.status='active' THEN al.allocated_amount ELSE 0 END),0) allocated_value,replace_asset.asset_code replacement_asset_code,replace_asset.asset_name replacement_asset_name FROM assets a LEFT JOIN asset_allocations al ON al.asset_id=a.id LEFT JOIN assets replace_asset ON replace_asset.id=a.replacement_asset_id GROUP BY a.id ORDER BY a.created_at DESC,a.id DESC`).all().map(row=>{const age=assetAge(row.in_service_date||row.acquisition_date,row.useful_life_months);return {...row,acquisition_cost:row.acquisition_cost===null?null:Number(row.acquisition_cost),allocated_value:Number(row.allocated_value),...age,replacement_missing:row.damage_state==='needs_replacement'&&!row.replacement_asset_id};});}
function replacementCandidates(assetId){return db.prepare(`SELECT a.id,a.asset_code,a.asset_name,a.asset_class,a.current_location,a.current_user FROM assets a WHERE a.id<>? AND a.lifecycle_status='stored' AND NOT EXISTS (SELECT 1 FROM assets damaged WHERE damaged.replacement_asset_id=a.id AND damaged.id<>?) ORDER BY CASE WHEN a.asset_class=(SELECT asset_class FROM assets WHERE id=?) THEN 0 ELSE 1 END,a.asset_class,a.asset_name`).all(Number(assetId),Number(assetId),Number(assetId));}
function updateAssetOperational(id,input,user){const asset=db.prepare('SELECT * FROM assets WHERE id=?').get(Number(id));if(!asset)throw new Error('Aset tidak ditemukan.');const nextUser=String(input.current_user??asset.current_user??'').trim(),nextLocation=String(input.current_location??asset.current_location??'').trim(),transferDate=String(input.transfer_date||new Date().toISOString().slice(0,10)),notes=String(input.transfer_notes||'').trim(),damageAction=String(input.damage_action||''),requestedLifecycle=String(input.lifecycle_status||'');if(!['','in_repair','needs_replacement','disposed'].includes(damageAction))throw new Error('Proses kerusakan tidak valid.');if(!['','stored','active'].includes(requestedLifecycle))throw new Error('Status penggunaan tidak valid.');db.exec('BEGIN IMMEDIATE');try{let lifecycle=requestedLifecycle||asset.lifecycle_status,condition=String(input.condition||asset.condition||'good'),damageState=asset.damage_state||'',damageReason=asset.damage_reason||'',damageDate=asset.damage_reported_at||null,replacementId=asset.replacement_asset_id||null;if(damageAction){const reason=String(input.damage_reason||'').trim();if(!reason)throw new Error('Keterangan kerusakan wajib diisi.');damageReason=reason;damageDate=String(input.damage_reported_at||transferDate);if(damageAction==='in_repair'){lifecycle='in_repair';condition='needs_repair';damageState='in_repair';replacementId=null;}if(damageAction==='needs_replacement'){lifecycle='in_repair';condition='damaged';damageState='needs_replacement';const requested=Number(input.replacement_asset_id||0);replacementId=requested||null;if(requested){const replacement=db.prepare("SELECT * FROM assets WHERE id=? AND lifecycle_status='stored'").get(requested);if(!replacement||replacement.id===asset.id)throw new Error('Aset pengganti harus berasal dari aset belum digunakan.');const used=db.prepare('SELECT id FROM assets WHERE replacement_asset_id=? AND id<>?').get(replacement.id,asset.id);if(used)throw new Error('Aset pengganti tersebut sudah dipakai oleh aset rusak lain.');db.prepare("UPDATE assets SET current_user=?,current_location=?,lifecycle_status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(nextUser,nextLocation,replacement.id);assetAudit('replacement_assign','asset',replacement.id,user,{replaces_asset_id:asset.id,location:nextLocation,user:nextUser});}}if(damageAction==='disposed'){lifecycle='disposed';condition='damaged';damageState='disposed';replacementId=null;}}db.prepare('UPDATE assets SET current_user=?,current_location=?,condition=?,lifecycle_status=?,damage_state=?,damage_reason=?,damage_reported_at=?,replacement_asset_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(nextUser,nextLocation,condition,lifecycle,damageState,damageReason,damageDate,replacementId,asset.id);if(nextUser!==String(asset.current_user||'')||nextLocation!==String(asset.current_location||'')){db.prepare('INSERT INTO asset_transfer_history(asset_id,transfer_date,previous_user,new_user,previous_location,new_location,notes,created_by) VALUES (?,?,?,?,?,?,?,?)').run(asset.id,transferDate,String(asset.current_user||''),nextUser,String(asset.current_location||''),nextLocation,notes,String(user?.username||''));assetAudit('transfer','asset',asset.id,user,{from_user:asset.current_user||'',to_user:nextUser,from_location:asset.current_location||'',to_location:nextLocation,transfer_date:transferDate});}if(damageAction)assetAudit('damage_process','asset',asset.id,user,{action:damageAction,replacement_asset_id:replacementId,reason:damageReason});if(lifecycle!==asset.lifecycle_status)assetAudit('usage_status','asset',asset.id,user,{from:asset.lifecycle_status,to:lifecycle});db.exec('COMMIT');return {ok:true};}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
function assetLineValues(line,source={}){const name=String(line.asset_name||'').trim(),assetClass=String(line.asset_class||'').trim(),amount=line.amount===''||line.amount===undefined?null:Number(line.amount);if(!name||!assetClass)throw new Error('Kelas dan nama aset wajib diisi.');if(amount!==null&&(!Number.isFinite(amount)||amount<0))throw new Error('Nilai perolehan tidak valid.');const life=line.useful_life_months===''||line.useful_life_months===undefined?null:Number(line.useful_life_months);if(life!==null&&(!Number.isInteger(life)||life<=0))throw new Error('Target umur pakai harus berupa jumlah bulan positif.');return {name,assetClass,amount,acquisitionDate:String(line.acquisition_date||source.transaction_date||'')||null,inServiceDate:String(line.in_service_date||'')||null,brand:String(line.brand||'').trim(),model:String(line.model||'').trim(),serialNumber:String(line.serial_number||'').trim(),supplierReference:String(line.supplier_reference||source.voucher_number||'').trim(),usefulLife:life,condition:String(line.condition||'good'),lifecycleStatus:String(line.lifecycle_status||'stored'),currentUser:String(line.current_user||'').trim(),currentLocation:String(line.current_location||'').trim(),notes:String(line.notes||'').trim()};}
function allocateAsset(input,user){const sourceId=Number(input.source_id),source=db.prepare('SELECT * FROM asset_source_lines WHERE id=?').get(sourceId);if(!source)throw new Error('Barang sumber tidak ditemukan.');const lines=Array.isArray(input.assets)?input.assets:[];if(!lines.length)throw new Error('Pilih minimal satu aset.');const prepared=lines.map(line=>assetLineValues(line,source)),already=Number(db.prepare("SELECT coalesce(sum(allocated_amount),0) v FROM asset_allocations WHERE source_line_id=? AND status='active'").get(sourceId).v),total=prepared.reduce((sum,line)=>sum+Number(line.amount||0),0);if(!Number.isFinite(total)||total<=0||prepared.some(line=>line.amount===null)||already+total>Number(source.debit_amount)+0.004)throw new Error('Total alokasi harus diisi dan tidak boleh melebihi sisa nilai barang sumber.');db.exec('BEGIN IMMEDIATE');try{const insertAsset=db.prepare("INSERT INTO assets(asset_code,source_kind,asset_class,asset_name,quantity,brand,model,serial_number,supplier_reference,acquisition_date,in_service_date,acquisition_cost,useful_life_months,condition,lifecycle_status,current_user,current_location,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"),insertAllocation=db.prepare('INSERT INTO asset_allocations(source_line_id,asset_id,allocated_amount,allocated_quantity,notes,created_by) VALUES (?,?,?,?,?,?)');for(const line of prepared){const assetId=Number(insertAsset.run(assetCode(line.assetClass),'accounting',line.assetClass,line.name,1,line.brand,line.model,line.serialNumber,line.supplierReference,line.acquisitionDate,line.inServiceDate,line.amount,line.usefulLife,line.condition,line.lifecycleStatus,line.currentUser,line.currentLocation,line.notes,String(user?.username||'')).lastInsertRowid);insertAllocation.run(sourceId,assetId,line.amount,1,line.notes,String(user?.username||''));assetAudit('allocate','asset',assetId,user,{source_id:sourceId,amount:line.amount});}const remaining=Number(source.debit_amount)-already-total,status=remaining<=0.004?'allocated':'partial';db.prepare('UPDATE asset_source_lines SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,sourceId);db.exec('COMMIT');return {status,remaining:Math.max(0,remaining)};}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
function createManualAsset(input,user){const line=assetLineValues(input),id=Number(db.prepare("INSERT INTO assets(asset_code,source_kind,asset_class,asset_name,quantity,brand,model,serial_number,supplier_reference,acquisition_date,in_service_date,acquisition_cost,useful_life_months,condition,lifecycle_status,current_user,current_location,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(assetCode(line.assetClass),'manual',line.assetClass,line.name,1,line.brand,line.model,line.serialNumber,line.supplierReference,line.acquisitionDate,line.inServiceDate,line.amount,line.usefulLife,line.condition,line.lifecycleStatus,line.currentUser,line.currentLocation,line.notes,String(user?.username||'')).lastInsertRowid);assetAudit('manual_create','asset',id,user,{});return {id};}
function assetMarkNotAsset(id,reason,user){const row=db.prepare('SELECT * FROM asset_source_lines WHERE id=?').get(Number(id));if(!row)throw new Error('Barang sumber tidak ditemukan.');if(!String(reason||'').trim())throw new Error('Alasan wajib diisi.');db.prepare("UPDATE asset_source_lines SET status='not_asset',not_asset_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(reason).trim(),row.id);assetAudit('not_asset','asset_source',row.id,user,{reason});return {ok:true};}
function officeStockBalances(excludedTransactionId=0){const items=db.prepare('SELECT * FROM office_stock_items ORDER BY item_name COLLATE NOCASE').all(),transactions=db.prepare('SELECT * FROM office_stock_transactions WHERE id<>? ORDER BY transaction_date,id').all(Number(excludedTransactionId)||0),state=new Map(items.map(item=>[item.id,{quantity:0,value:0,last_unit_price:Number(item.default_unit_price)||0}]));for(const transaction of transactions){const item=state.get(transaction.item_id);if(!item)continue;const quantity=Number(transaction.quantity)||0,amount=quantity*(Number(transaction.unit_price)||0),direction=transaction.transaction_type==='in'?1:-1;item.quantity+=direction*quantity;item.value+=direction*amount;if(transaction.transaction_type==='in')item.last_unit_price=Number(transaction.unit_price)||0;}return {items,state};}
function officeStockData(start='',end=''){const {items,state}=officeStockBalances(),allTransactions=db.prepare('SELECT t.*,i.item_name FROM office_stock_transactions t JOIN office_stock_items i ON i.id=t.item_id ORDER BY t.transaction_date,t.id').all(),runningStock=new Map(items.map(item=>[item.id,0])),transactionById=new Map();for(const row of allTransactions){const quantity=Number(row.quantity)||0,stock_before=Number(runningStock.get(row.item_id)||0),stock_after=stock_before+(row.transaction_type==='in'?quantity:-quantity),record={...row,quantity,unit_price:Number(row.unit_price),amount:quantity*Number(row.unit_price),stock_before,stock_after};runningStock.set(row.item_id,stock_after);transactionById.set(row.id,record);}const transactions=[...transactionById.values()].filter(row=>(!start||row.transaction_date>=start)&&(!end||row.transaction_date<=end)).sort((left,right)=>right.transaction_date.localeCompare(left.transaction_date)||right.id-left.id),stockItems=items.map(item=>{const balance=state.get(item.id);return {...item,current_quantity:balance.quantity,current_value:balance.value,last_unit_price:balance.last_unit_price};}),totalValue=stockItems.reduce((sum,item)=>sum+item.current_value,0);return {summary:{item_count:stockItems.length,total_quantity:stockItems.reduce((sum,item)=>sum+item.current_quantity,0),total_value:totalValue,low_stock_count:stockItems.filter(item=>item.current_quantity<=2).length},items:stockItems,transactions};}
function officeStockItem(input){const item_name=String(input.item_name||'').trim().replace(/\s+/g,' ').slice(0,160),default_unit_price=Number(input.default_unit_price||0);if(!item_name)throw new Error('Nama barang wajib diisi.');if(!Number.isFinite(default_unit_price)||default_unit_price<0)throw new Error('Harga satuan tidak valid.');return {item_name,default_unit_price:Math.round(default_unit_price)};}
function saveOfficeStockItem(input){const item=officeStockItem(input);if(db.prepare('SELECT id FROM office_stock_items WHERE lower(item_name)=lower(?)').get(item.item_name))throw new Error('Barang dengan nama tersebut sudah ada.');const result=db.prepare('INSERT INTO office_stock_items (item_name,default_unit_price) VALUES (?,?)').run(item.item_name,item.default_unit_price);return {id:Number(result.lastInsertRowid),...item};}
function officeStockTransaction(input){const item_id=Number(input.item_id),transaction_date=String(input.transaction_date||'').trim(),transaction_type=String(input.transaction_type||''),quantity=Number(input.quantity),unit_price=Number(input.unit_price),person_name=String(input.person_name||'').trim().slice(0,120),notes=String(input.notes||'').trim().slice(0,1000);if(!Number.isInteger(item_id)||!db.prepare('SELECT id FROM office_stock_items WHERE id=?').get(item_id))throw new Error('Pilih barang yang valid.');if(!['in','out'].includes(transaction_type))throw new Error('Jenis mutasi stok tidak valid.');if(!/^\d{4}-\d{2}-\d{2}$/.test(transaction_date))throw new Error('Tanggal transaksi wajib diisi.');if(!Number.isFinite(quantity)||quantity<=0)throw new Error('Jumlah barang harus lebih dari nol.');if(!Number.isFinite(unit_price)||unit_price<0)throw new Error('Harga satuan tidak valid.');if(transaction_type==='out'&&!person_name)throw new Error('Nama pengambil wajib diisi untuk penggunaan barang.');return {item_id,transaction_date,transaction_type,quantity,unit_price,person_name,notes};}
function assertOfficeStockBalance(transaction,excludedTransactionId=0){if(transaction.transaction_type!=='out')return;const {state}=officeStockBalances(excludedTransactionId),available=Number(state.get(transaction.item_id)?.quantity||0);if(available+0.00001<transaction.quantity)throw new Error(`Stok tidak mencukupi. Tersedia ${available} unit.`);}
function saveOfficeStockTransaction(input){const transaction=officeStockTransaction(input);assertOfficeStockBalance(transaction);const result=db.prepare('INSERT INTO office_stock_transactions (item_id,transaction_date,transaction_type,quantity,unit_price,person_name,notes) VALUES (?,?,?,?,?,?,?)').run(transaction.item_id,transaction.transaction_date,transaction.transaction_type,transaction.quantity,transaction.unit_price,transaction.person_name,transaction.notes);if(transaction.transaction_type==='in')db.prepare('UPDATE office_stock_items SET default_unit_price=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(transaction.unit_price,transaction.item_id);return {id:Number(result.lastInsertRowid),...transaction};}
function updateOfficeStockTransaction(id,input){if(!db.prepare('SELECT id FROM office_stock_transactions WHERE id=?').get(id))throw new Error('Transaksi stok tidak ditemukan.');const transaction=officeStockTransaction(input);assertOfficeStockBalance(transaction,id);db.prepare('UPDATE office_stock_transactions SET item_id=?,transaction_date=?,transaction_type=?,quantity=?,unit_price=?,person_name=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(transaction.item_id,transaction.transaction_date,transaction.transaction_type,transaction.quantity,transaction.unit_price,transaction.person_name,transaction.notes,id);if(transaction.transaction_type==='in')db.prepare('UPDATE office_stock_items SET default_unit_price=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(transaction.unit_price,transaction.item_id);return {id:Number(id),...transaction};}
function accountingJournalData(start='',end='',limit=100,offset=0){const size=Math.max(1,Math.min(Number(limit)||100,100)),skip=Math.max(0,Number(offset)||0),params=[String(start||''),String(start||''),String(end||''),String(end||'')],total=Number(db.prepare(`SELECT COUNT(*) count FROM accounting_journal_entries j WHERE (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?)`).get(...params).count),records=db.prepare(`SELECT j.*,coalesce(SUM(l.debit),0) debit_total,coalesce(SUM(l.credit),0) credit_total,COUNT(l.id) line_count FROM accounting_journal_entries j LEFT JOIN accounting_journal_lines l ON l.journal_id=j.id WHERE (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?) GROUP BY j.id ORDER BY j.transaction_date DESC,j.id DESC LIMIT ? OFFSET ?`).all(...params,size,skip);return {records:records.map(row=>({...row,debit_total:Number(row.debit_total),credit_total:Number(row.credit_total)})),page:{offset:skip,limit:size,total,has_more:skip+records.length<total}};}
function accountingSummary(){const counts=db.prepare(`SELECT (SELECT COUNT(*) FROM accounting_accounts) account_count,(SELECT COUNT(*) FROM accounting_journal_entries) journal_count,(SELECT COUNT(*) FROM accounting_journal_lines) line_count,(SELECT COUNT(*) FROM accounting_legacy_items) item_count,(SELECT COUNT(*) FROM accounting_legacy_suppliers) supplier_count,(SELECT COUNT(*) FROM accounting_legacy_inventory_transactions) inventory_count`).get(),totals=db.prepare('SELECT coalesce(SUM(debit),0) debit,coalesce(SUM(credit),0) credit FROM accounting_journal_lines').get(),unbalanced=db.prepare('SELECT COUNT(*) count FROM (SELECT journal_id FROM accounting_journal_lines GROUP BY journal_id HAVING abs(round(SUM(debit)-SUM(credit),4))>0)').get(),audit=db.prepare("SELECT imported_at,source_name,total_debit,total_credit,notes FROM accounting_import_audits WHERE source_name='akuntansi.mdf' LIMIT 1").get();return {counts,totals:{debit:Number(totals.debit),credit:Number(totals.credit),balanced:Math.abs(Number(totals.debit)-Number(totals.credit))<0.01},unbalanced_journals:Number(unbalanced.count),audit};}
function accountingPeriods(){return {years:db.prepare("SELECT DISTINCT substr(transaction_date,1,4) AS year FROM accounting_journal_entries WHERE transaction_date GLOB '????-??-??' AND transaction_date>='2000-01-01' AND description<>'__LEGACY_FIFO_OPENING__' ORDER BY year DESC").all().map(row=>row.year)};}
function accountingAccounts(){return {accounts:db.prepare('SELECT account_code,account_name,level_name,parent_code,account_status,description,account_type,account_subtype,is_group,counter_account_code,source,display_opening_amount,display_opening_side FROM accounting_accounts ORDER BY account_code').all().map(row=>({...row,display_opening_amount:Number(row.display_opening_amount||0),is_posting:row.is_group?0:1}))};}
function accountingTrialBalance(start='',end=''){const rows=db.prepare(`SELECT a.account_code,a.account_name,a.account_type,a.account_subtype,a.parent_code,coalesce(SUM(CASE WHEN (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?) THEN l.debit ELSE 0 END),0) debit,coalesce(SUM(CASE WHEN (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?) THEN l.credit ELSE 0 END),0) credit FROM accounting_accounts a LEFT JOIN accounting_journal_lines l ON l.account_code=a.account_code LEFT JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE trim(a.account_type)<>'' GROUP BY a.account_code ORDER BY a.account_code`).all(start,start,end,end,start,start,end,end).map(row=>({...row,debit:Number(row.debit),credit:Number(row.credit)}));const totals=rows.reduce((sum,row)=>({debit:sum.debit+row.debit,credit:sum.credit+row.credit}),{debit:0,credit:0});return {start,end,accounts:rows,totals,balanced:Math.abs(totals.debit-totals.credit)<0.0001};}
function accountingReport(kind,start='',end=''){const trial=accountingTrialBalance(start,end),income=kind==='income_statement',types=income?['Laba-Rugi','HPP']:['Neraca'],accounts=trial.accounts.filter(row=>types.includes(row.account_type)).map(row=>({...row,balance:income?row.credit-row.debit:row.debit-row.credit}));return {kind,start,end,accounts,totals:accounts.reduce((sum,row)=>sum+row.balance,0)};}
// SA rincian dipertahankan untuk audit dan kartu barang, tetapi bukan sumber
// saldo laporan. Setiap pasangan debit/kredit pada SA rincian dikeluarkan
// bersama-sama agar Neraca Saldo tetap seimbang dan Neraca/Laba Rugi tidak
// menduplikasi SA agregat.
// Sumber lama memakai beberapa penulisan nomor bukti Saldo Awal. Bentuk
// agregat (mis. "SA 2025" atau "2026/SA_2025") adalah saldo laporan,
// sedangkan bentuk yang memiliki segmen setelah tahun (mis. "SA/2025/BJ")
// adalah rincian audit dan tidak boleh terakumulasi kedua kali.
function normalizedOpeningVoucher(value=''){return String(value||'').trim().replace(/\s+/g,' ').toUpperCase();}
function isOpeningBalanceVoucher(value=''){return /^(?:\d{4}\/)?SA(?:[ _-]\d{4}|\/\d{4})?(?:\/.*)?$/.test(normalizedOpeningVoucher(value));}
function isOpeningBalanceDetailVoucher(value=''){return /^(?:\d{4}\/)?SA(?:[ _-]\d{4}|\/\d{4})?\/.+$/.test(normalizedOpeningVoucher(value));}
function openingBalanceVoucherSql(column='j.voucher_number'){
  const value=`COALESCE(upper(trim(${column})), '')`;
  return `(${value} GLOB '????/SA_*' OR ${value} GLOB '????/SA-*' OR ${value} GLOB '????/SA *' OR ${value} GLOB 'SA_*' OR ${value} GLOB 'SA-*' OR ${value} GLOB 'SA *' OR ${value} GLOB 'SA/*')`;
}
function openingBalanceDetailVoucherSql(column='j.voucher_number'){
  const value=`COALESCE(upper(trim(${column})), '')`;
  return `(${value} GLOB '????/SA_*/*' OR ${value} GLOB '????/SA-*/*' OR ${value} GLOB '????/SA */*' OR ${value} GLOB 'SA_*/*' OR ${value} GLOB 'SA-*/*' OR ${value} GLOB 'SA */*' OR ${value} GLOB 'SA/*/*')`;
}
const accountingTrialBalanceAudit=accountingTrialBalance;
accountingTrialBalance=(start='',end='')=>{
  const eligible=`NOT ${openingBalanceDetailVoucherSql('j.voucher_number')}`,rows=db.prepare(`SELECT a.account_code,a.account_name,a.account_type,a.account_subtype,a.parent_code,
    COALESCE(SUM(CASE WHEN (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?) AND ${eligible} THEN l.debit ELSE 0 END),0) debit,
    COALESCE(SUM(CASE WHEN (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?) AND ${eligible} THEN l.credit ELSE 0 END),0) credit
    FROM accounting_accounts a LEFT JOIN accounting_journal_lines l ON l.account_code=a.account_code LEFT JOIN accounting_journal_entries j ON j.id=l.journal_id
    WHERE trim(a.account_type)<>'' GROUP BY a.account_code ORDER BY a.account_code`).all(start,start,end,end,start,start,end,end).map(row=>({...row,debit:Number(row.debit),credit:Number(row.credit)})),totals=rows.reduce((sum,row)=>({debit:sum.debit+row.debit,credit:sum.credit+row.credit}),{debit:0,credit:0});
  return {start,end,accounts:rows,totals,balanced:Math.abs(totals.debit-totals.credit)<0.0001};
};
const balanceReportLayout=[['AKTIVA','01.01.01.00.00.0000','KAS'],['AKTIVA','01.01.02.01.00.0000','BANK BCA 2168'],['AKTIVA','01.01.02.02.00.0000','BANK MANDIRI 8781'],['AKTIVA','01.01.02.03.00.0000','BANK MAYBANK 8889'],['AKTIVA','01.01.02.04.00.0000','BANK UOB 2888'],['AKTIVA','01.01.02.05.00.0000','BANK BRI 2305'],['AKTIVA','01.01.02.06.00.0000','BANK MANDIRI 1911'],['AKTIVA','01.01.03.00.00.0000','PIUTANG DAGANG'],['AKTIVA','01.01.04.01.00.0000','PPH PASAL 22'],['AKTIVA','01.01.04.02.00.0000','PIUTANG PPN'],['AKTIVA','01.01.04.04.00.0000','PIUTANG PPH 23'],['AKTIVA','01.01.08.00.00.0000','PIUTANG BUNGA AFILIASI BHINEKA'],['AKTIVA','01.01.09.00.00.0000','PIUTANG AFILIASI BHINEKA'],['AKTIVA','01.01.05.01.00.0000','UANG MUKA PEMBELIAN IMPORT'],['AKTIVA','01.01.05.02.00.0000','UANG MUKA PEMBELIAN LOKAL'],['AKTIVA','01.01.05.03.00.0000','UANG MUKA PEMBELIAN LAIN'],['AKTIVA','01.01.06.02.01.0000','PERSEDIAAN BARANG JADI'],['AKTIVA','01.01.06.02.02.0000','PERSEDIAAN BAHAN PENOLONG'],['AKTIVA','01.02.01.00.00.0000','INVENTARIS KANTOR'],['AKTIVA','01.02.02.00.00.0000','BANGUNAN'],['AKTIVA','01.02.03.00.00.0000','INVENTARIS KENDARAAN'],['AKTIVA','01.02.04.00.00.0000','TANAH'],['AKTIVA','01.03.00.00.00.0000','AKUMULASI PENYUSUTAN'],['AKTIVA','01.01.10.00.00.0000','PIUTANG SEWA'],['PASIVA','02.03.00.00.00.0000','HUTANG EMKL'],['PASIVA','02.04.01.00.00.0000','HUTANG DAGANG LOKAL'],['PASIVA','02.04.02.00.00.0000','HUTANG DAGANG IMPORT'],['PASIVA','02.05.01.00.00.0000','HUTANG PPN'],['PASIVA','02.05.02.00.00.0000','HUTANG PPH PASAL 21'],['PASIVA','02.05.03.00.00.0000','HUTANG PPH PASAL 23'],['PASIVA','02.05.04.00.00.0000','HUTANG PPH PASAL 25'],['PASIVA','02.05.05.00.00.0000','HUTANG PPH PASAL 29'],['PASIVA','02.06.01.00.00.0000','HUTANG BANK BRI'],['PASIVA','02.06.02.00.00.0000','HUTANG BANK MANDIRI'],['PASIVA','02.11.00.00.00.0000','HUTANG LAIN'],['PASIVA','02.13.00.00.00.0000','HUTANG EKSPEDISI CEHA JAYA LOGISTIC'],['PASIVA','02.16.00.00.00.0000','HUTANG KSO'],['PASIVA','03.00.00.00.00.0000','MODAL'],['PASIVA','03.02.00.00.00.0000','MODAL DISETOR'],['PASIVA','03.05.00.00.00.0000','LABA RUGI DITAHAN']];
balanceReportLayout.splice(balanceReportLayout.findIndex(row=>row[1]==='02.11.00.00.00.0000'),0,['PASIVA','02.06.03.00.00.0000','HUTANG MAYBANK 8910'],['PASIVA','02.06.04.00.00.0000','HUTANG BANK CIMB NIAGA']);
balanceReportLayout.push(['PASIVA','03.06.00.00.00.0000','LABA RUGI TAHUN BERJALAN']);
const normalizedAccountName=value=>String(value||'').trim().replace(/\s+/g,' ').toUpperCase();
const legacyAccountCodeToCurrent=code=>{const parts=String(code||'').split('.');return parts.length===6?[parts[0],parts[1],parts[2].padStart(3,'0'),parts[3].padStart(3,'0'),parts[4].padStart(3,'0'),parts[5].padStart(4,'0')].join('.'):String(code||'');};
function legacyAccountingBalanceReport(start='',end=''){const trial=accountingTrialBalance(start,end),sourceRows=trial.accounts.filter(row=>row.account_type==='Neraca').map(row=>({...row,balance:row.debit-row.credit})),allAccounts=db.prepare("SELECT account_code,account_name,parent_code,account_type FROM accounting_accounts WHERE account_type='Neraca' ORDER BY account_code").all(),byCode=new Map(allAccounts.map(row=>[row.account_code,row])),byName=new Map();for(const row of allAccounts){const key=normalizedAccountName(row.account_name);if(!byName.has(key))byName.set(key,[]);byName.get(key).push(row);}const targets=balanceReportLayout.map(([section,legacyCode,name],order)=>{const converted=legacyAccountCodeToCurrent(legacyCode),byExact=byCode.get(converted),byMatchingName=(byName.get(normalizedAccountName(name))||[])[0],account=byExact&&normalizedAccountName(byExact.account_name)===normalizedAccountName(name)?byExact:byMatchingName||byExact;return account?{section,order,account_code:account.account_code,account_name:account.account_name,balance:0}:null;}).filter(Boolean),targetByCode=new Map(targets.map(target=>[target.account_code,target]));let unmapped=[];for(const row of sourceRows){if(/LABA\s*RUGI\s*TAHUN\s*BERJALAN/i.test(row.account_name||''))continue;let code=row.account_code,found=null,visited=new Set();while(code&&!visited.has(code)){visited.add(code);if(targetByCode.has(code)){found=targetByCode.get(code);break;}code=byCode.get(code)?.parent_code||'';}if(found)found.balance+=Number(row.balance||0);else if(Math.abs(Number(row.balance||0))>0.0001)unmapped.push(row);}const income=accountingReport('income_statement',start,end);targets.push({section:'PASIVA',order:targets.length,account_code:'',account_name:'LABA/RUGI',balance:-Number(income.totals||0),synthetic:true});const sections=['AKTIVA','PASIVA'].map(section=>{const accounts=targets.filter(row=>row.section===section).sort((a,b)=>a.order-b.order);return {name:section,accounts,total:accounts.reduce((sum,row)=>sum+Number(row.balance||0),0)};});return {kind:'balance_sheet',start,end,sections,accounts:sections.flatMap(section=>section.accounts),totals:sections.reduce((sum,section)=>sum+section.total,0),unmapped};}
// Pemetaan laporan disimpan terpisah dari jurnal. Satu saldo sumber hanya dialokasikan
// ke rekening pemetaan terdekat agar total induk dan anak tidak terhitung ganda.
function reportAccountKinds(reportKind){
  if(reportKind==='income')return ['Laba-Rugi','HPP'];
  if(reportKind==='hpp')return [];
  return ['Neraca'];
}
function reportDefaultSection(reportKind,account){
  if(reportKind==='balance')return String(account.account_code||'').startsWith('01.')?'AKTIVA':'PASIVA';
  const code=String(account.account_code||''),name=normalizedAccountName(account.account_name);
  if(/^04\.(03|04|05|07)\./.test(code)||/^05\.02\.02\./.test(code)||/JASA GIRO|BEDA KURS|BUNGA REKENING|PENDAPATAN LAIN|BUKU CEK|PAJAK JASA GIRO|PAJAK BUNGA/.test(name))return 'PENGHASILAN & BEBAN LAIN-LAIN';
  if(/^05\./.test(code))return 'BEBAN ADMINISTRASI DAN UMUM';
  return 'PENDAPATAN DAN HARGA POKOK PENJUALAN';
}
function seedAccountingReportMappings(reportKind){
  const count=Number(db.prepare('SELECT COUNT(*) count FROM accounting_report_mappings WHERE report_kind=?').get(reportKind).count);
  if(count)return;
  const kinds=reportAccountKinds(reportKind),accounts=reportKind==='hpp'?db.prepare('SELECT account_code,account_name,parent_code,account_type,is_group FROM accounting_accounts WHERE is_group=0 ORDER BY account_code').all():db.prepare(`SELECT account_code,account_name,parent_code,account_type,is_group FROM accounting_accounts WHERE account_type IN (${kinds.map(()=>'?').join(',')}) ORDER BY account_code`).all(...kinds),byCode=new Map(accounts.map(row=>[row.account_code,row])),byName=new Map();
  for(const account of accounts){const key=normalizedAccountName(account.account_name);if(!byName.has(key))byName.set(key,[]);byName.get(key).push(account);}
  const rows=[];
  if(reportKind==='hpp'){
    const hppNames=['PEMBELIAN IMPORT','PEMBELIAN LOKAL','PEMBELIAN BAHAN PENOLONG','BIAYA BEA MASUK','BIAYA FREIGHT PIB','BIAYA ASURANSI PIB'];
    hppNames.forEach((name,order)=>{const account=(byName.get(normalizedAccountName(name))||[])[0];if(account)rows.push({account_code:account.account_code,section_name:'PEMBELIAN',sort_order:order});});
  }else if(reportKind==='balance'){
    balanceReportLayout.forEach(([section,legacyCode,name],order)=>{const exact=byCode.get(legacyAccountCodeToCurrent(legacyCode)),match=(byName.get(normalizedAccountName(name))||[])[0],account=exact&&normalizedAccountName(exact.account_name)===normalizedAccountName(name)?exact:(match||exact);if(account)rows.push({account_code:account.account_code,section_name:section,sort_order:order});});
  }else{
    let order=0;
    for(const account of accounts.filter(row=>!row.is_group))rows.push({account_code:account.account_code,section_name:reportDefaultSection('income',account),sort_order:order++});
  }
  const insert=db.prepare('INSERT OR IGNORE INTO accounting_report_mappings(report_kind,account_code,section_name,sort_order,enabled) VALUES (?,?,?,?,1)');
  db.exec('BEGIN IMMEDIATE');try{for(const row of rows)insert.run(reportKind,row.account_code,row.section_name,row.sort_order);db.exec('COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function ensureAccountingReportMappings(){seedAccountingReportMappings('balance');seedAccountingReportMappings('income');seedAccountingReportMappings('hpp');}
function reportMappings(reportKind){
  if(!['income','balance','hpp'].includes(reportKind))throw new Error('Jenis pemetaan laporan tidak valid.');
  ensureAccountingReportMappings();
  return db.prepare(`SELECT m.report_kind,m.account_code,m.section_name,m.sort_order,m.enabled,a.account_name,a.parent_code,a.account_type,a.is_group FROM accounting_report_mappings m JOIN accounting_accounts a ON a.account_code=m.account_code WHERE m.report_kind=? ORDER BY m.section_name,m.sort_order,m.account_code`).all(reportKind).map(row=>({...row,enabled:Boolean(row.enabled)}));
}
function reportSpecialLines(reportKind){
  const defaults=reportKind==='income'?[{source_kind:'hpp_report',section_name:'PENDAPATAN DAN HARGA POKOK PENJUALAN',label:'HARGA POKOK PENJUALAN',sort_order:999}]:reportKind==='balance'?[{source_kind:'period_profit',section_name:'PASIVA',label:'LABA/RUGI',sort_order:999999}]:[];
  const insert=db.prepare('INSERT OR IGNORE INTO accounting_report_special_lines(report_kind,source_kind,section_name,label,sort_order,enabled) VALUES (?,?,?,?,?,1)');
  for(const line of defaults)insert.run(reportKind,line.source_kind,line.section_name,line.label,line.sort_order);
  return db.prepare('SELECT report_kind,source_kind,section_name,label,sort_order,enabled FROM accounting_report_special_lines WHERE report_kind=? ORDER BY sort_order,source_kind').all(reportKind).map(row=>({...row,enabled:Boolean(row.enabled)}));
}
function accountingReportMappingSettings(reportKind){
  const kinds=reportAccountKinds(reportKind),accounts=reportKind==='hpp'?db.prepare('SELECT account_code,account_name,parent_code,account_type,is_group FROM accounting_accounts WHERE is_group=0 ORDER BY account_code').all():db.prepare(`SELECT account_code,account_name,parent_code,account_type,is_group FROM accounting_accounts WHERE account_type IN (${kinds.map(()=>'?').join(',')}) ORDER BY account_code`).all(...kinds);
  return {report_kind:reportKind,mappings:reportMappings(reportKind),special_lines:reportSpecialLines(reportKind),accounts,default_sections:reportKind==='balance'?['AKTIVA','PASIVA']:reportKind==='hpp'?['PEMBELIAN']:['PENDAPATAN DAN HARGA POKOK PENJUALAN','BEBAN ADMINISTRASI DAN UMUM','PENGHASILAN & BEBAN LAIN-LAIN']};
}
function saveAccountingReportMappings(reportKind,input,user){
  if(!user?.username)throw new Error('Silakan masuk terlebih dahulu untuk mengubah pemetaan laporan.');
  if(!['income','balance','hpp'].includes(reportKind))throw new Error('Jenis laporan tidak valid.');
  const kinds=reportAccountKinds(reportKind),allowed=new Set((reportKind==='hpp'?db.prepare('SELECT account_code FROM accounting_accounts WHERE is_group=0').all():db.prepare(`SELECT account_code FROM accounting_accounts WHERE account_type IN (${kinds.map(()=>'?').join(',')})`).all(...kinds)).map(row=>row.account_code)),incoming=Array.isArray(input?.mappings)?input.mappings:[];
  const seen=new Set(),rows=[];
  for(const value of incoming){const account_code=String(value?.account_code||'').trim(),section_name=String(value?.section_name||'').trim().replace(/\s+/g,' ').slice(0,120),sort_order=Math.max(0,Math.min(99999,Number(value?.sort_order)||0)),enabled=value?.enabled===false||value?.enabled===0?0:1;if(!account_code||!allowed.has(account_code)||seen.has(account_code))continue;if(!section_name)throw new Error('Setiap rekening yang ditampilkan harus memiliki bagian laporan.');seen.add(account_code);rows.push({account_code,section_name,sort_order,enabled});}
  db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM accounting_report_mappings WHERE report_kind=?').run(reportKind);const insert=db.prepare('INSERT INTO accounting_report_mappings(report_kind,account_code,section_name,sort_order,enabled,updated_by,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)');for(const row of rows)insert.run(reportKind,row.account_code,row.section_name,row.sort_order,row.enabled,String(user.username||''));db.exec('COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  return accountingReportMappingSettings(reportKind);
}
function saveAccountingReportSpecialLines(reportKind,input,user){
  if(!user?.username)throw new Error('Silakan masuk terlebih dahulu untuk mengubah pemetaan laporan.');
  const supported=reportKind==='income'?new Set(['hpp_report']):reportKind==='balance'?new Set(['period_profit']):new Set();
  if(!supported.size)throw new Error('Laporan ini tidak memiliki baris hasil khusus.');
  const incoming=Array.isArray(input?.special_lines)?input.special_lines:[],seen=new Set(),rows=[];
  for(const value of incoming){
    const source_kind=String(value?.source_kind||'').trim(),section_name=String(value?.section_name||'').trim().replace(/\s+/g,' ').slice(0,120),label=String(value?.label||'').trim().replace(/\s+/g,' ').slice(0,120),sort_order=Math.max(0,Math.min(999999,Number(value?.sort_order)||0)),enabled=value?.enabled===false||value?.enabled===0?0:1;
    if(!supported.has(source_kind)||seen.has(source_kind))continue;
    if(!section_name||!label)throw new Error('Baris hasil khusus harus memiliki bagian laporan dan nama.');
    seen.add(source_kind);rows.push({source_kind,section_name,label,sort_order,enabled});
  }
  db.exec('BEGIN IMMEDIATE');try{
    db.prepare('DELETE FROM accounting_report_special_lines WHERE report_kind=?').run(reportKind);
    const insert=db.prepare('INSERT INTO accounting_report_special_lines(report_kind,source_kind,section_name,label,sort_order,enabled,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)');
    for(const row of rows)insert.run(reportKind,row.source_kind,row.section_name,row.label,row.sort_order,row.enabled,String(user.username||''));
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  return accountingReportMappingSettings(reportKind);
}
function accountingBalanceSourceAt(end='',kinds=[]){
  const year=/^(\d{4})-/.exec(String(end||''))?.[1]||'';
  if(!year||!kinds.length)return [];
  const start=`${year}-01-01`,marks=kinds.map(()=>'?').join(',');
  return db.prepare(`SELECT a.account_code,a.account_name,a.parent_code,a.account_type,COALESCE(SUM(CASE WHEN j.transaction_date>=? AND j.transaction_date<=? AND NOT ${openingBalanceDetailVoucherSql('j.voucher_number')} THEN l.debit-l.credit ELSE 0 END),0) balance FROM accounting_accounts a LEFT JOIN accounting_journal_lines l ON l.account_code=a.account_code LEFT JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE a.is_group=0 AND a.account_type IN (${marks}) GROUP BY a.account_code ORDER BY a.account_code`).all(start,end,...kinds).map(row=>({...row,balance:Number(row.balance||0)}));
}
function accountingConfiguredReport(reportKind,start='',end=''){
  const kinds=reportAccountKinds(reportKind),trial=reportKind==='balance'?{accounts:accountingBalanceSourceAt(end,kinds)}:accountingTrialBalance(start,end),source=trial.accounts.filter(row=>kinds.includes(row.account_type)).map(row=>({...row,balance:reportKind==='income'?Number(row.credit)-Number(row.debit):Number(row.balance??(Number(row.debit)-Number(row.credit)))})),accounts=db.prepare(`SELECT account_code,account_name,parent_code,account_type FROM accounting_accounts WHERE account_type IN (${kinds.map(()=>'?').join(',')}) ORDER BY account_code`).all(...kinds),byCode=new Map(accounts.map(row=>[row.account_code,row])),mappings=reportMappings(reportKind).filter(row=>row.enabled),targets=mappings.map(row=>({...row,balance:0})),targetByCode=new Map(targets.map(row=>[row.account_code,row])),unmapped=[];
  for(const row of source){let code=row.account_code,found=null,visited=new Set();while(code&&!visited.has(code)){visited.add(code);if(targetByCode.has(code)){found=targetByCode.get(code);break;}code=byCode.get(code)?.parent_code||'';}if(found)found.balance+=Number(row.balance||0);else if(Math.abs(Number(row.balance||0))>0.0001)unmapped.push(row);}
  const orderedSections=[];for(const target of targets.sort((a,b)=>a.sort_order-b.sort_order||a.account_code.localeCompare(b.account_code))){let section=orderedSections.find(row=>row.name===target.section_name);if(!section){section={name:target.section_name,accounts:[],total:0};orderedSections.push(section);}section.accounts.push(target);section.total+=Number(target.balance||0);}
  if(reportKind==='balance'){const special=reportSpecialLines('balance').find(row=>row.enabled&&row.source_kind==='period_profit');if(special){const income=accountingIncomeReport(start,end);let section=orderedSections.find(row=>row.name===special.section_name);if(!section){section={name:special.section_name,accounts:[],total:0};orderedSections.push(section);}const line={account_code:'',account_name:special.label,section_name:special.section_name,sort_order:special.sort_order,balance:-Number(income.totals||0),synthetic:true,source:'period_profit'};section.accounts.push(line);section.accounts.sort((a,b)=>a.sort_order-b.sort_order||String(a.account_code).localeCompare(String(b.account_code)));section.total+=line.balance;}}
  if(reportKind==='balance'){
    const factor=row=>String(row?.section_name||row?.name||'').toUpperCase()==='PASIVA'||/^(02|03)\./.test(String(row?.account_code||''))?-1:1;
    for(const section of orderedSections){const displayFactor=factor(section);for(const account of section.accounts||[])account.display_balance=displayFactor*Number(account.balance||0);section.display_total=displayFactor*Number(section.total||0);}
    for(const row of unmapped)row.display_balance=factor(row)*Number(row.balance||0);
  }
  const totals=orderedSections.reduce((sum,section)=>sum+Number(section.total||0),0);return {kind:reportKind==='income'?'income_statement':'balance_sheet',start,end,sections:orderedSections,accounts:orderedSections.flatMap(section=>section.accounts),totals,unmapped};
}
function accountingBalanceReport(start='',end=''){
  return accountingConfiguredReport('balance',start,end);
}
function accountingIncomeReport(start='',end=''){
  const report=accountingConfiguredReport('income',start,end),hpp=accountingHpp(start,end);
  // HPP Laba Rugi memakai hasil Laporan HPP, bukan saldo akun 04.02.01.
  // Nilainya negatif karena HPP mengurangi pendapatan dalam Laba Rugi.
  const hppBalance=-Number(hpp.totals?.current||0),hppCode='04.02.001.000.000.0000',special=reportSpecialLines('income').find(row=>row.enabled&&row.source_kind==='hpp_report');
  for(const section of report.sections||[])section.accounts=(section.accounts||[]).filter(account=>!(special&&(account.account_code===hppCode||normalizedAccountName(account.account_name)==='HARGA POKOK PENJUALAN')));
  if(special){let section=(report.sections||[]).find(row=>row.name===special.section_name);if(!section){section={name:special.section_name,accounts:[],total:0};report.sections.push(section);}section.accounts.push({account_code:'',account_name:special.label,section_name:special.section_name,sort_order:special.sort_order,balance:hppBalance,source:'hpp_report',synthetic:true});section.accounts.sort((a,b)=>a.sort_order-b.sort_order||String(a.account_code).localeCompare(String(b.account_code)));}
  else for(const section of report.sections||[])for(const account of section.accounts||[])if(account.account_code===hppCode||normalizedAccountName(account.account_name)==='HARGA POKOK PENJUALAN'){account.balance=hppBalance;account.source='hpp_report';}
  for(const section of report.sections||[])section.total=(section.accounts||[]).reduce((sum,account)=>sum+Number(account.balance||0),0);
  report.accounts=(report.sections||[]).flatMap(section=>section.accounts||[]);
  report.totals=(report.sections||[]).reduce((sum,section)=>sum+Number(section.total||0),0);
  return report;
}
function accountingGeneralJournal(start='',end='',limit=100,offset=0){const size=Math.max(1,Math.min(Number(limit)||100,100)),skip=Math.max(0,Number(offset)||0),params=[start,start,end,end],total=Number(db.prepare(`SELECT COUNT(*) count FROM accounting_journal_entries j JOIN accounting_journal_lines l ON l.journal_id=j.id JOIN accounting_accounts a ON a.account_code=l.account_code WHERE (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?)`).get(...params).count),lines=db.prepare(`SELECT j.id journal_id,j.transaction_date,j.voucher_number,j.description journal_description,j.transaction_type,j.source,l.id line_id,l.description,a.account_code,a.account_name,l.debit,l.credit FROM accounting_journal_entries j JOIN accounting_journal_lines l ON l.journal_id=j.id JOIN accounting_accounts a ON a.account_code=l.account_code WHERE (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?) ORDER BY j.transaction_date,j.id,l.id LIMIT ? OFFSET ?`).all(...params,size,skip).map(row=>({...row,debit:Number(row.debit),credit:Number(row.credit)}));const totals=db.prepare(`SELECT coalesce(SUM(l.debit),0) debit,coalesce(SUM(l.credit),0) credit FROM accounting_journal_entries j JOIN accounting_journal_lines l ON l.journal_id=j.id WHERE (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?)`).get(...params);return {start,end,lines,totals:{debit:Number(totals.debit),credit:Number(totals.credit)},page:{offset:skip,limit:size,total,has_more:skip+lines.length<total}};}
function accountingSubsidiaryLedger(start='',end='',limit=200,offset=0){const size=Math.max(1,Math.min(Number(limit)||200,200)),skip=Math.max(0,Number(offset)||0),params=[start,start,end,end],where=`(lower(a.account_name) LIKE '%piutang%' OR lower(a.account_name) LIKE '%hutang%') AND (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?)`,total=Number(db.prepare(`SELECT COUNT(*) count FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id JOIN accounting_accounts a ON a.account_code=l.account_code WHERE ${where}`).get(...params).count),rows=db.prepare(`SELECT j.transaction_date,j.voucher_number,j.description journal_description,j.transaction_type,l.description,a.account_code,a.account_name,l.debit,l.credit FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id JOIN accounting_accounts a ON a.account_code=l.account_code WHERE ${where} ORDER BY a.account_code,j.transaction_date,j.id,l.id LIMIT ? OFFSET ?`).all(...params,size,skip).map(row=>({...row,debit:Number(row.debit),credit:Number(row.credit),party:row.description||row.journal_description||'—'})),totals=db.prepare(`SELECT coalesce(SUM(l.debit),0) debit,coalesce(SUM(l.credit),0) credit FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id JOIN accounting_accounts a ON a.account_code=l.account_code WHERE ${where}`).get(...params);return {start,end,rows,totals:{debit:Number(totals.debit),credit:Number(totals.credit)},page:{offset:skip,limit:size,total,has_more:skip+rows.length<total}};}
const SUBSIDIARY_ACCOUNT_ROOTS={Piutang:['01.01.003.000.000.0000'],Hutang:['02.04.001.000.000.0000','02.04.002.000.000.0000']};
function accountingSubsidiaryAccountCodes(kind=''){const selectedKind=['Piutang','Hutang'].includes(kind)?kind:'',roots=selectedKind?SUBSIDIARY_ACCOUNT_ROOTS[selectedKind]:[...SUBSIDIARY_ACCOUNT_ROOTS.Piutang,...SUBSIDIARY_ACCOUNT_ROOTS.Hutang],rows=db.prepare('SELECT account_code,parent_code FROM accounting_accounts').all(),children=new Map();for(const row of rows){const parent=String(row.parent_code||'');if(!children.has(parent))children.set(parent,[]);children.get(parent).push(row.account_code);}const codes=new Set(roots),queue=[...roots];while(queue.length){const parent=queue.shift();for(const child of children.get(parent)||[])if(!codes.has(child)){codes.add(child);queue.push(child);}}return [...codes];}
function accountingSubsidiaryKindForCode(accountCode){if(accountingSubsidiaryAccountCodes('Piutang').includes(accountCode))return 'Piutang';if(accountingSubsidiaryAccountCodes('Hutang').includes(accountCode))return 'Hutang';return '';}
function accountingSubsidiaryFilter(kind='',accountCode=''){const selectedKind=['Piutang','Hutang'].includes(kind)?kind:'',codes=accountingSubsidiaryAccountCodes(selectedKind),clauses=[codes.length?`a.account_code IN (${codes.map(()=>'?').join(',')})`:'1=0'],params=[...codes];if(accountCode){clauses.push('a.account_code=?');params.push(accountCode);}return {selectedKind,where:clauses.join(' AND '),params};}
accountingSubsidiaryLedger=(start='',end='',limit=200,offset=0,kind='',accountCode='')=>{const size=Math.max(1,Math.min(Number(limit)||200,200)),skip=Math.max(0,Number(offset)||0),filter=accountingSubsidiaryFilter(kind,accountCode),dateWhere="(?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?)",params=[...filter.params,start,start,end,end],where=`${filter.where} AND ${dateWhere}`,total=Number(db.prepare(`SELECT COUNT(*) count FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id JOIN accounting_accounts a ON a.account_code=l.account_code WHERE ${where}`).get(...params).count),rows=db.prepare(`SELECT j.transaction_date,j.voucher_number,j.description journal_description,j.transaction_type,l.description,a.account_code,a.account_name,l.debit,l.credit,CASE WHEN upper(a.account_name) LIKE '%PIUTANG%' THEN 'Piutang' ELSE 'Hutang' END subsidiary_kind FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id JOIN accounting_accounts a ON a.account_code=l.account_code WHERE ${where} ORDER BY a.account_code,j.transaction_date,j.id,l.id LIMIT ? OFFSET ?`).all(...params,size,skip).map(row=>({...row,debit:Number(row.debit),credit:Number(row.credit),party:row.description||row.journal_description||'—'})),totals=db.prepare(`SELECT coalesce(SUM(l.debit),0) debit,coalesce(SUM(l.credit),0) credit FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id JOIN accounting_accounts a ON a.account_code=l.account_code WHERE ${where}`).get(...params);return {start,end,kind:filter.selectedKind,account_code:accountCode,rows,totals:{debit:Number(totals.debit),credit:Number(totals.credit)},page:{offset:skip,limit:size,total,has_more:skip+rows.length<total}};};
function accountingSubsidiaryAccounts(kind='',search=''){const filter=accountingSubsidiaryFilter(kind,''),term=String(search||'').trim();if(term.length<2)return {accounts:[]};const rows=db.prepare(`SELECT a.account_code,a.account_name FROM accounting_accounts a WHERE ${filter.where} AND (lower(a.account_code) LIKE ? OR lower(a.account_name) LIKE ?) ORDER BY a.account_code LIMIT 40`).all(...filter.params,`%${term.toLowerCase()}%`,`%${term.toLowerCase()}%`).map(row=>({...row,subsidiary_kind:accountingSubsidiaryKindForCode(row.account_code)}));return {accounts:rows,kind:filter.selectedKind};}
const accountingSubsidiaryLedgerWithFilteredRows=accountingSubsidiaryLedger;
accountingSubsidiaryLedger=(start='',end='',limit=100,offset=0,kind='',accountCode='')=>{if(!accountCode)return {start,end,kind:['Piutang','Hutang'].includes(kind)?kind:'',account_code:'',requires_account:true,rows:[],totals:{debit:0,credit:0},page:{offset:0,limit:0,total:0,has_more:false}};const filter=accountingSubsidiaryFilter(kind,accountCode),account=db.prepare('SELECT account_code,account_name FROM accounting_accounts WHERE account_code=?').get(accountCode),subsidiary_kind=accountingSubsidiaryKindForCode(accountCode);if(!account||!subsidiary_kind)throw new Error('Pilih rekening Piutang Dagang atau Hutang Dagang yang valid.');if(filter.selectedKind&&filter.selectedKind!==subsidiary_kind)throw new Error(`Rekening yang dipilih bukan jenis ${filter.selectedKind}.`);const ledger=accountingLedger(accountCode,start,end,limit,offset);return {...ledger,kind:subsidiary_kind,account_code:accountCode,requires_account:false,totals:ledger.totals||{debit:0,credit:0}};};
function accountingAdjustedTrialBalance(start='',end=''){const rows=db.prepare(`SELECT a.account_code,a.account_name,a.account_type,coalesce(SUM(l.debit),0) debit,coalesce(SUM(l.credit),0) credit FROM accounting_journal_entries j JOIN accounting_journal_lines l ON l.journal_id=j.id JOIN accounting_accounts a ON a.account_code=l.account_code WHERE trim(a.account_type)<>'' AND (lower(j.transaction_type) LIKE '%penyesuaian%' OR lower(j.transaction_type) LIKE '%adjust%' OR lower(j.voucher_number) LIKE '%akp%' OR lower(j.voucher_number) LIKE '%adjust%') AND (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?) GROUP BY a.account_code ORDER BY a.account_code`).all(start,start,end,end).map(row=>({...row,debit:Number(row.debit),credit:Number(row.credit)}));const totals=rows.reduce((sum,row)=>({debit:sum.debit+row.debit,credit:sum.credit+row.credit}),{debit:0,credit:0});return {start,end,accounts:rows,totals,balanced:Math.abs(totals.debit-totals.credit)<0.0001};}
function accountingHpp(start='',end=''){
  const endDate=String(end||start||'').slice(0,10),startDate=String(start||endDate).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate))return {start,end,rows:[],totals:{previous:0,current:0,ytd:0}};
  const year=startDate.slice(0,4),yearStart=`${year}-01-01`,dateBefore=value=>{const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()-1);return date.toISOString().slice(0,10);},shiftMonthStart=(value,shift)=>{const [valueYear,valueMonth]=String(value).slice(0,7).split('-').map(Number),date=new Date(Date.UTC(valueYear,valueMonth-1+shift,1));return date.toISOString().slice(0,10);},priorEnd=dateBefore(startDate),priorPeriodStart=shiftMonthStart(startDate,-1),beforePriorPeriodEnd=dateBefore(priorPeriodStart),hasPriorPeriod=startDate!==yearStart;
  const accounts=db.prepare('SELECT account_code,account_name,parent_code,is_group FROM accounting_accounts ORDER BY account_code').all(),byCode=new Map(accounts.map(row=>[row.account_code,row]));
  const inventoryRoots=['PERSEDIAAN BARANG JADI','PERSEDIAAN BAHAN PENOLONG'];
  const inventoryRoot=code=>{let item=byCode.get(code),seen=new Set();while(item&&!seen.has(item.account_code)){seen.add(item.account_code);if(inventoryRoots.includes(normalizedAccountName(item.account_name)))return item;item=byCode.get(item.parent_code);}return null;};
  // Jurnal SA agregat adalah satu-satunya sumber saldo awal Januari. SA detail
  // (mis. SA_2025/BJ) sengaja diabaikan karena merupakan rincian pendukung.
  const saOpening=()=>{
    // Jangan mencari berdasarkan teks nama rekening pada baris jurnal. Nama bisa
    // berubah/tidak konsisten pada data historis, sedangkan jalur induknya tetap
    // menjadi sumber kebenaran. Hanya SA agregat (tanpa "/" setelah SA) yang
    // dibaca; SA rincian barang seperti 2026/SA_2025/BJ tidak boleh dijumlahkan
    // kembali karena nilainya sudah tercakup pada rekening induk.
    const totals=new Map();
    const rows=db.prepare(`SELECT l.account_code,l.debit,l.credit,j.voucher_number
      FROM accounting_journal_entries j JOIN accounting_journal_lines l ON l.journal_id=j.id
      WHERE j.transaction_date=?`).all(yearStart);
    for(const row of rows){
      if(!isOpeningBalanceVoucher(row.voucher_number)||isOpeningBalanceDetailVoucher(row.voucher_number))continue;
      const root=inventoryRoot(row.account_code);
      if(!root)continue;
      totals.set(root.account_code,(totals.get(root.account_code)||0)+Number(row.debit||0)-Number(row.credit||0));
    }
    return inventoryRoots.map(name=>accounts.find(row=>normalizedAccountName(row.account_name)===name)).filter(Boolean).map(account=>({account_code:account.account_code,account_name:account.account_name,value:Number(totals.get(account.account_code)||0)}));
  };
  // Nilai stok laporan harus mengikuti nilai buku besar: SA agregat + mutasi
  // rekening persediaan tahun berjalan. Ini satu query agregat; tidak lagi
  // menjumlahkan seluruh riwayat kartu stok sejak tahun-tahun sebelumnya.
  const stockAt=asOf=>{
    const totals=new Map(saOpening().map(row=>[row.account_code,Number(row.value)]));
    const movements=db.prepare(`SELECT l.account_code,COALESCE(SUM(l.debit-l.credit),0) value
      FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id
      WHERE j.transaction_date>=? AND j.transaction_date<=? AND NOT ${openingBalanceVoucherSql('j.voucher_number')}
      GROUP BY l.account_code`).all(yearStart,asOf);
    for(const value of movements){const root=inventoryRoot(value.account_code);if(!root)continue;totals.set(root.account_code,(totals.get(root.account_code)||0)+Number(value.value||0));}
    return inventoryRoots.map(name=>accounts.find(row=>normalizedAccountName(row.account_name)===name)).filter(Boolean).map(account=>({account_code:account.account_code,account_name:account.account_name,value:Number(totals.get(account.account_code)||0)}));
  };
  const initialOpening=saOpening(),opening=startDate===yearStart?initialOpening:stockAt(priorEnd),closing=stockAt(endDate);
  const mappings=reportMappings('hpp').filter(row=>row.enabled).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||a.account_code.localeCompare(b.account_code));
  const mappedCodes=mappings.map(row=>row.account_code),marks=mappedCodes.map(()=>'?').join(',');
  const balances=new Map();
  if(mappedCodes.length){for(const row of db.prepare(`SELECT l.account_code,COALESCE(SUM(CASE WHEN j.transaction_date>=? AND j.transaction_date<=? THEN l.debit-l.credit ELSE 0 END),0) previous,COALESCE(SUM(CASE WHEN j.transaction_date>=? AND j.transaction_date<=? THEN l.debit-l.credit ELSE 0 END),0) current,COALESCE(SUM(CASE WHEN j.transaction_date>=? AND j.transaction_date<=? THEN l.debit-l.credit ELSE 0 END),0) ytd FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE l.account_code IN (${marks}) GROUP BY l.account_code`).all(hasPriorPeriod?priorPeriodStart:startDate,hasPriorPeriod?priorEnd:priorEnd,startDate,endDate,yearStart,endDate,...mappedCodes)){balances.set(row.account_code,{previous:Number(row.previous),current:Number(row.current),ytd:Number(row.ytd)});}}
  const purchases=mappings.map(row=>({account_code:row.account_code,account_name:row.account_name,...(balances.get(row.account_code)||{previous:0,current:0,ytd:0})}));
  const priorClosingRows=hasPriorPeriod?stockAt(priorEnd):[],previousOpeningRows=hasPriorPeriod?stockAt(beforePriorPeriodEnd):[],initialByCode=new Map(initialOpening.map(row=>[row.account_code,Number(row.value)])),priorClosingByCode=new Map(priorClosingRows.map(row=>[row.account_code,Number(row.value)])),previousOpeningByCode=new Map(previousOpeningRows.map(row=>[row.account_code,Number(row.value)]));
  // Kolom "S.D bulan lalu" memakai basis periode kalender sebelumnya:
  // persediaan awal = saldo pembuka bulan sebelumnya, pembelian = mutasi
  // bulan sebelumnya, dan persediaan akhir = saldo akhir bulan sebelumnya.
  // Dengan demikian baris persediaan akhir Februari selalu sama dengan
  // persediaan awal Maret, tanpa mengulang nilai Januari untuk semua bulan.
  const openingRows=opening.map(row=>({account_code:row.account_code,account_name:`PERSEDIAAN AWAL ${row.account_name.replace(/^PERSEDIAAN\s*/i,'')}`.trim(),previous:hasPriorPeriod?Number(previousOpeningByCode.get(row.account_code)||0):0,current:Number(row.value),ytd:Number(initialByCode.get(row.account_code)||row.value)}));
  const closingRows=closing.map(row=>({account_code:row.account_code,account_name:`PERSEDIAAN AKHIR ${row.account_name.replace(/^PERSEDIAAN\s*/i,'')}`.trim(),previous:hasPriorPeriod?Number(priorClosingByCode.get(row.account_code)||0):0,current:Number(row.value),ytd:Number(row.value)}));
  const sum=(list,key)=>list.reduce((value,row)=>value+Number(row[key]||0),0),previousClosing=sum(priorClosingRows,'value'),yearOpening=sum(initialOpening,'value');
  const totals={previous:hasPriorPeriod?sum(openingRows,'previous')+sum(purchases,'previous')-previousClosing:0,current:sum(openingRows,'current')+sum(purchases,'current')-sum(closingRows,'current'),ytd:yearOpening+sum(purchases,'ytd')-sum(closingRows,'ytd')};
  const sections=[{label:'PERSEDIAAN AWAL',rows:openingRows},{label:'PEMBELIAN',rows:purchases},{label:'PERSEDIAAN AKHIR',rows:closingRows}];
  return {start:startDate,end:endDate,year,rows:sections,totals};
}
function accountingAccountList(){return {accounts:db.prepare('SELECT account_code,account_name,account_type,account_subtype,parent_code,is_group,account_status,source FROM accounting_accounts ORDER BY account_code').all().map(row=>({...row,is_posting:row.is_group?0:1}))};}
function inventoryItem(code){const itemCode=String(code||''),legacy=db.prepare('SELECT item_code,item_name,debit_purchase_code,credit_purchase_code,debit_sales_code,credit_sales_code FROM accounting_legacy_items WHERE item_code=?').get(itemCode),manual=legacy?null:db.prepare('SELECT item_code,item_name,debit_purchase_code,credit_purchase_code,debit_sales_code,credit_sales_code FROM accounting_items WHERE item_code=?').get(itemCode),item=legacy?{...legacy,source:'legacy'}:manual?{...manual,source:'manual'}:null;if(!item)throw new Error(`Barang operasional tidak ditemukan: ${itemCode||'(kosong)'}.`);const required=[['Persediaan',item.debit_purchase_code],['Pembelian',item.credit_purchase_code],['HPP',item.debit_sales_code],['Pendapatan Penjualan',item.credit_sales_code]];for(const [label,accountCode] of required){const account=db.prepare('SELECT is_group FROM accounting_accounts WHERE account_code=?').get(accountCode);if(!accountCode||!account||account.is_group)throw new Error(`Barang ${item.item_code} belum memiliki rekening ${label} yang boleh diposting.`);}return item;}
function postingAccount(code,label='Rekening'){const account=db.prepare('SELECT account_code,account_name,is_group FROM accounting_accounts WHERE account_code=?').get(String(code||''));if(!account||account.is_group)throw new Error(`${label} harus berupa rekening posting.`);return account;}
function protectedInventoryAccountCodes(){return new Set(db.prepare("SELECT debit_purchase_code,debit_sales_code FROM accounting_legacy_items UNION ALL SELECT debit_purchase_code,debit_sales_code FROM accounting_items WHERE item_code NOT IN (SELECT item_code FROM accounting_legacy_items)").all().flatMap(row=>[row.debit_purchase_code,row.debit_sales_code]).filter(Boolean));}
function operationalInventoryItems(){const rows=db.prepare("SELECT item_code,item_name,item_type,debit_purchase_code AS inventory_account_code,credit_purchase_code AS purchase_account_code,debit_sales_code AS hpp_account_code,credit_sales_code AS revenue_account_code,description,'legacy' source FROM accounting_legacy_items UNION ALL SELECT item_code,item_name,item_type,debit_purchase_code AS inventory_account_code,credit_purchase_code AS purchase_account_code,debit_sales_code AS hpp_account_code,credit_sales_code AS revenue_account_code,description,'manual' source FROM accounting_items WHERE item_code NOT IN (SELECT item_code FROM accounting_legacy_items) ORDER BY item_code").all(),posting=code=>{const account=db.prepare('SELECT is_group FROM accounting_accounts WHERE account_code=?').get(code);return Boolean(code&&account&&!account.is_group);};return {items:rows.map(item=>({...item,ready:posting(item.inventory_account_code)&&posting(item.purchase_account_code)&&posting(item.hpp_account_code)&&posting(item.revenue_account_code)}))};}
function bootstrapLegacyFifo(item){if(item.source!=='legacy'||db.prepare('SELECT 1 FROM accounting_inventory_fifo_batches WHERE item_code=? LIMIT 1').get(item.item_code))return;const balance=db.prepare(`SELECT COALESCE(SUM(CASE WHEN h.transaction_type=3 THEN l.quantity ELSE -l.quantity END),0) quantity,COALESCE(SUM(CASE WHEN h.transaction_type=3 THEN l.total ELSE -l.total END),0) value FROM accounting_legacy_inventory_lines l JOIN accounting_legacy_inventory_transactions h ON h.voucher_number=l.voucher_number WHERE l.item_code=?`).get(item.item_code),quantity=Number(balance.quantity),value=Number(balance.value);db.exec('BEGIN IMMEDIATE');try{db.prepare("INSERT OR IGNORE INTO accounting_items (item_code,item_name,item_type,debit_sales_code,credit_sales_code,debit_purchase_code,credit_purchase_code,description) SELECT item_code,item_name,item_type,debit_sales_code,credit_sales_code,debit_purchase_code,credit_purchase_code,'Mirror internal untuk FIFO; data historis tetap terkunci.' FROM accounting_legacy_items WHERE item_code=?").run(item.item_code);if(quantity>0.000001){const voucher=`SYS-FIFO-${item.item_code}`.slice(0,100),journalId=Number(db.prepare("INSERT INTO accounting_journal_entries (voucher_number,transaction_date,description,amount,transaction_type,legacy_user_id,source) VALUES (?,'1900-01-01','__LEGACY_FIFO_OPENING__',0,'Saldo FIFO Historis','','manual')").run(voucher).lastInsertRowid),documentId=Number(db.prepare("INSERT INTO accounting_inventory_documents (document_number,transaction_date,transaction_kind,description,journal_id) VALUES (?,'1900-01-01','adjustment_in','__LEGACY_FIFO_OPENING__',?)").run(voucher,journalId).lastInsertRowid),lineId=Number(db.prepare('INSERT INTO accounting_inventory_document_lines (document_id,item_code,quantity,unit_price,total_amount) VALUES (?,?,?,?,?)').run(documentId,item.item_code,quantity,Math.max(0,value/quantity),Math.max(0,value)).lastInsertRowid);db.prepare("INSERT INTO accounting_inventory_fifo_batches (item_code,receipt_line_id,receipt_date,original_quantity,remaining_quantity,unit_cost) VALUES (?,?,'1900-01-01',?,?,?)").run(item.item_code,lineId,quantity,quantity,Math.max(0,value/quantity));}db.exec('COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
const resolveInventoryItem=inventoryItem;inventoryItem=code=>{const item=resolveInventoryItem(code);if(item.source==='legacy')bootstrapLegacyFifo(item);return item;};
function addJournalLine(lines,accountCode,debit,credit,description){
  const debitValue=Number(debit)||0,creditValue=Number(credit)||0;
  // SQLite menolak baris jurnal yang kedua sisinya nol. Hal ini dapat terjadi
  // pada koreksi stok lama bernilai nol ketika FIFO seluruh dokumen dibangun ulang.
  // Baris tersebut tidak memiliki dampak akuntansi dan harus dilewati.
  if(debitValue===0&&creditValue===0)return;
  // Jangan gabungkan sisi debit dan kredit ke satu baris, walaupun rekening dan
  // uraian sama. Konfigurasi rekening historis tertentu memang menggunakan
  // rekening yang sama pada kedua sisi; penggabungan akan melanggar CHECK
  // (debit=0) != (credit=0) di SQLite.
  const key=`${accountCode}|${description}|${debitValue>0?'debit':'credit'}`,current=lines.get(key)||{account_code:accountCode,debit:0,credit:0,description};
  current.debit+=debitValue;
  current.credit+=creditValue;
  lines.set(key,current);
}
function rebuildOperationalInventoryFifo(){
  const rows=db.prepare(`SELECT d.id document_id,d.document_number,d.transaction_date,d.transaction_kind,d.counter_account_code,d.description,d.journal_id,d.invoice_id,l.id line_id,l.item_code,l.quantity,l.unit_price,l.total_amount
    FROM accounting_inventory_documents d JOIN accounting_inventory_document_lines l ON l.document_id=d.id
    ORDER BY d.transaction_date,d.id,l.id`).all();
  const documents=new Map();
  for(const row of rows){
    if(!documents.has(row.document_id))documents.set(row.document_id,{...row,lines:[]});
    documents.get(row.document_id).lines.push({...row,quantity:Number(row.quantity),unit_price:Number(row.unit_price),total_amount:Number(row.total_amount)});
  }
  db.prepare('DELETE FROM accounting_inventory_fifo_allocations').run();
  db.prepare('DELETE FROM accounting_inventory_fifo_batches').run();
  const insertBatch=db.prepare('INSERT INTO accounting_inventory_fifo_batches (item_code,receipt_line_id,receipt_date,original_quantity,remaining_quantity,unit_cost) VALUES (?,?,?,?,?,?)');
  const updateBatch=db.prepare('UPDATE accounting_inventory_fifo_batches SET remaining_quantity=remaining_quantity-? WHERE id=?');
  const insertAllocation=db.prepare('INSERT INTO accounting_inventory_fifo_allocations (issue_line_id,batch_id,quantity,unit_cost) VALUES (?,?,?,?)');
  const updateIssueTotal=db.prepare('UPDATE accounting_inventory_document_lines SET total_amount=? WHERE id=?');
  const issueCosts=new Map();
  for(const document of documents.values()){
    const receipt=['purchase','adjustment_in'].includes(document.transaction_kind);
    for(const line of document.lines){
      if(receipt){
        insertBatch.run(line.item_code,line.line_id,document.transaction_date,line.quantity,line.quantity,line.unit_price);
        continue;
      }
      let required=line.quantity,cost=0;
      const batches=db.prepare('SELECT id,remaining_quantity,unit_cost FROM accounting_inventory_fifo_batches WHERE item_code=? AND remaining_quantity>0.000001 AND receipt_date<=? ORDER BY receipt_date,id').all(line.item_code,document.transaction_date);
      for(const batch of batches){
        if(required<=0.000001)break;
        const taken=Math.min(required,Number(batch.remaining_quantity));
        if(taken<=0.000001)continue;
        updateBatch.run(taken,batch.id);
        insertAllocation.run(line.line_id,batch.id,taken,Number(batch.unit_cost));
        cost+=taken*Number(batch.unit_cost);
        required-=taken;
      }
      if(required>0.000001)throw new Error(`Stok ${line.item_code} tidak cukup pada ${document.transaction_date}. Transaksi tidak disimpan.`);
      issueCosts.set(line.line_id,cost);
      if(document.transaction_kind==='adjustment_out')updateIssueTotal.run(cost,line.line_id);
    }
  }
  const deleteJournalLines=db.prepare('DELETE FROM accounting_journal_lines WHERE journal_id=?');
  const insertJournalLine=db.prepare('INSERT INTO accounting_journal_lines (journal_id,account_code,description,debit,credit) VALUES (?,?,?,?,?)');
  const updateJournal=db.prepare('UPDATE accounting_journal_entries SET amount=? WHERE id=?');
  for(const document of documents.values()){
    if(document.description==='__LEGACY_FIFO_OPENING__')continue;
    const invoice=document.invoice_id?db.prepare('SELECT i.*,c.customer_name FROM accounting_invoices i JOIN accounting_invoice_customers c ON c.id=i.customer_id WHERE i.id=?').get(document.invoice_id):null;
    // Dokumen stok hasil impor historis hanya dipakai sebagai sumber FIFO. Ia
    // tidak menyimpan rekening lawan karena jurnal asalnya sudah ada dan
    // terkunci. Jangan membangun ulang jurnal tersebut; bila dipaksakan,
    // transaksi BRK lama akan salah divalidasi sebagai transaksi Kas/Bank.
    // Dokumen baru selalu memiliki rekening lawan (atau invoice_id), sehingga
    // jurnal baru tetap dihitung dan divalidasi secara penuh.
    const hasJournalSource=Boolean(invoice||String(document.counter_account_code||'').trim());
    if(!hasJournalSource)continue;
    const counter=invoice?null:postingAccount(document.counter_account_code,document.transaction_kind==='sale'?'Rekening Kas/Bank':'Rekening lawan');
    const journalLines=new Map();
    if(invoice){
      const profile=accountingInvoiceProfile(),receivable=postingAccount(invoice.receivable_account_code,'Rekening Piutang Invoice'),sales=postingAccount(profile.sales_account_code,'Rekening Penjualan Invoice'),vat=postingAccount(profile.vat_payable_account_code,'Rekening Hutang PPN Invoice');
      addJournalLine(journalLines,receivable.account_code,Number(invoice.total_amount),0,`Invoice ${invoice.invoice_number} · ${invoice.customer_name}`);
      addJournalLine(journalLines,sales.account_code,0,Number(invoice.dpp_amount),`Invoice ${invoice.invoice_number}`);
      if(Number(invoice.vat_amount)>0.000001)addJournalLine(journalLines,vat.account_code,0,Number(invoice.vat_amount),`PPN Invoice ${invoice.invoice_number}`);
    }
    for(const line of document.lines){
      const item=resolveInventoryItem(line.item_code),total=line.quantity*line.unit_price,cost=Number(issueCosts.get(line.line_id)||0);
      if(document.transaction_kind==='purchase'){
        // BRM yang berasal dari Cek List PIB mengikuti SOP jurnal historis:
        // rincian Persediaan di Debit dan Pembelian Barang Jadi di Kredit.
        // Dokumen pembelian biasa tetap menggunakan arah normalnya.
        const pibBrm=/^BRM\s+PIB\b/i.test(String(document.description||''));
        if(pibBrm){
          addJournalLine(journalLines,item.debit_purchase_code,total,0,`Persediaan ${item.item_name}`);
          addJournalLine(journalLines,counter.account_code,0,total,document.description||document.document_number);
        }else{
          addJournalLine(journalLines,item.debit_purchase_code,total,0,`purchase ${item.item_name}`);
          addJournalLine(journalLines,counter.account_code,0,total,document.description||document.document_number);
        }
      }else if(document.transaction_kind==='sale'){
        if(invoice){
          addJournalLine(journalLines,item.debit_sales_code,cost,0,`HPP ${item.item_name}`);
          addJournalLine(journalLines,item.debit_purchase_code,0,cost,`Persediaan ${item.item_name}`);
          continue;
        }
        // Format jurnal Barang Keluar mengikuti pasangan rekening penjualan
        // pada master barang: debit penjualan dan kredit penjualan. FIFO hanya
        // memeriksa ketersediaan stok; HPP tidak ditambahkan pada jurnal ini.
        addJournalLine(journalLines,item.debit_sales_code,total,0,`sale ${item.item_name}`);
        addJournalLine(journalLines,item.credit_sales_code,0,total,`sale ${item.item_name}`);
      }else if(document.transaction_kind==='adjustment_in'){
        addJournalLine(journalLines,item.debit_purchase_code,total,0,`Penyesuaian tambah ${item.item_name}`);
        addJournalLine(journalLines,counter.account_code,0,total,document.description||`Penyesuaian tambah ${item.item_name}`);
      }else if(document.transaction_kind==='adjustment_out'){
        addJournalLine(journalLines,counter.account_code,cost,0,document.description||`Penyesuaian kurang ${item.item_name}`);
        addJournalLine(journalLines,item.debit_purchase_code,0,cost,`Penyesuaian kurang ${item.item_name}`);
      }
    }
    const balanced=[...journalLines.values()],debit=balanced.reduce((sum,line)=>sum+line.debit,0),credit=balanced.reduce((sum,line)=>sum+line.credit,0);
    if(Math.abs(debit-credit)>=0.0001)throw new Error(`Jurnal ${document.document_number} tidak seimbang setelah FIFO dihitung ulang.`);
    deleteJournalLines.run(document.journal_id);
    for(const line of balanced)insertJournalLine.run(document.journal_id,line.account_code,line.description,line.debit,line.credit);
    updateJournal.run(debit,document.journal_id);
  }
}
function restoreSaleJournalsWithoutAutomaticHpp(){
  const repairId='accounting-restore-sale-journals-without-hpp-v142';
  db.exec('CREATE TABLE IF NOT EXISTS accounting_runtime_repairs (repair_id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT');
  if(db.prepare('SELECT 1 FROM accounting_runtime_repairs WHERE repair_id=?').get(repairId))return;
  db.exec('BEGIN IMMEDIATE');
  try{
    const affected=db.prepare(`SELECT DISTINCT d.journal_id
      FROM accounting_inventory_documents d
      WHERE d.transaction_kind='sale'
        AND EXISTS (SELECT 1 FROM accounting_journal_lines l WHERE l.journal_id=d.journal_id AND l.description LIKE 'HPP %')
        AND EXISTS (SELECT 1 FROM accounting_journal_lines l WHERE l.journal_id=d.journal_id AND l.description LIKE 'sale %')`).all();
    const removeHpp=db.prepare("DELETE FROM accounting_journal_lines WHERE journal_id=? AND description LIKE 'HPP %'"),
      reverseSale=db.prepare("UPDATE accounting_journal_lines SET debit=credit,credit=debit WHERE journal_id=? AND description LIKE 'sale %'"),
      refreshAmount=db.prepare('UPDATE accounting_journal_entries SET amount=COALESCE((SELECT SUM(debit) FROM accounting_journal_lines WHERE journal_id=?),0) WHERE id=?');
    for(const row of affected){
      const journalId=Number(row.journal_id);
      removeHpp.run(journalId);
      reverseSale.run(journalId);
      refreshAmount.run(journalId,journalId);
    }
    db.prepare('INSERT INTO accounting_runtime_repairs(repair_id) VALUES (?)').run(repairId);
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
restoreSaleJournalsWithoutAutomaticHpp();
function repairInventorySalePostingAccounts(){
  const repairId='accounting-repair-sale-posting-accounts-v145';
  db.exec('CREATE TABLE IF NOT EXISTS accounting_runtime_repairs (repair_id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT');
  if(db.prepare('SELECT 1 FROM accounting_runtime_repairs WHERE repair_id=?').get(repairId))return;
  db.exec('BEGIN IMMEDIATE');
  try{
    // Hanya jurnal Barang Keluar yang dikoreksi. Dokumen stok dan FIFO tidak
    // dibangun ulang agar pemasangan aman terhadap histori yang sudah ada.
    const documents=db.prepare(`SELECT d.journal_id,l.item_code,l.quantity,l.unit_price
      FROM accounting_inventory_documents d
      JOIN accounting_inventory_document_lines l ON l.document_id=d.id
      WHERE d.transaction_kind='sale' AND d.invoice_id IS NULL AND d.description<>'__LEGACY_FIFO_OPENING__'
      ORDER BY d.id,l.id`).all(),byJournal=new Map();
    for(const row of documents){const lines=byJournal.get(row.journal_id)||[];lines.push(row);byJournal.set(row.journal_id,lines);}
    const removeLines=db.prepare('DELETE FROM accounting_journal_lines WHERE journal_id=?'),insertLine=db.prepare('INSERT INTO accounting_journal_lines (journal_id,account_code,description,debit,credit) VALUES (?,?,?,?,?)'),updateAmount=db.prepare('UPDATE accounting_journal_entries SET amount=? WHERE id=?');
    for(const [journalId,documentLines] of byJournal){
      const journalLines=new Map();
      for(const line of documentLines){const item=resolveInventoryItem(line.item_code),total=Number(line.quantity)*Number(line.unit_price);addJournalLine(journalLines,item.debit_sales_code,total,0,`sale ${item.item_name}`);addJournalLine(journalLines,item.credit_sales_code,0,total,`sale ${item.item_name}`);}
      const balanced=[...journalLines.values()],debit=balanced.reduce((sum,line)=>sum+line.debit,0),credit=balanced.reduce((sum,line)=>sum+line.credit,0);
      if(Math.abs(debit-credit)>=0.0001)throw new Error(`Jurnal stok ${journalId} tidak seimbang saat pemulihan rekening penjualan.`);
      removeLines.run(journalId);for(const line of balanced)insertLine.run(journalId,line.account_code,line.description,line.debit,line.credit);updateAmount.run(debit,journalId);
    }
    db.prepare('INSERT INTO accounting_runtime_repairs(repair_id) VALUES (?)').run(repairId);
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
repairInventorySalePostingAccounts();
function normalizeInventoryTransactionKind(value){
  const kind=String(value||'').trim().toLowerCase().replace(/[\s-]+/g,'_');
  // Form lama dan paket pembaruan sebelumnya pernah mengirim label Indonesia
  // (mis. Barang Masuk), bukan value select. Terima semua bentuk tersebut
  // supaya transaksi masuk tidak keliru diproses sebagai Barang Keluar.
  const compact=kind.replace(/[^a-z0-9]/g,'');
  if(['purchase','barang_masuk','barangmasuk','masuk','brm'].includes(kind)||['purchase','barangmasuk','masuk','brm'].includes(compact))return 'purchase';
  if(['sale','barang_keluar','barangkeluar','keluar','brk'].includes(kind)||['sale','barangkeluar','keluar','brk'].includes(compact))return 'sale';
  if(['adjustment_in','penyesuaian_tambah','tambah'].includes(kind))return 'adjustment_in';
  if(['adjustment_out','penyesuaian_kurang','kurang'].includes(kind))return 'adjustment_out';
  return kind;
}
function saveInventoryDocument(input,user){
  // inventory_flow ditambahkan oleh form stok baru. Ini menjadi sumber yang
  // eksplisit bila browser lama salah mengirim value pilihan transaction_kind.
  const requestedKind=normalizeInventoryTransactionKind(input.transaction_kind),explicitFlow=normalizeInventoryTransactionKind(input?.inventory_flow),kind=['purchase','sale','adjustment_in','adjustment_out'].includes(explicitFlow)?explicitFlow:requestedKind,transactionDate=String(input.transaction_date||'').trim(),documentNumber=String(input.document_number||'').trim().slice(0,100),supplierCode=String(input.supplier_code||'').trim(),paymentMode=String(input.payment_mode||'').trim(),counterAccountCode=String(input.counter_account_code||'').trim(),description=String(input.description||'').trim().slice(0,2000),referenceNumber=String(input.reference_number||'').trim().slice(0,100);
  if(!['purchase','sale','adjustment_in','adjustment_out'].includes(kind))throw new Error('Jenis transaksi stok tidak valid.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)||!documentNumber)throw new Error('Tanggal dan nomor bukti transaksi stok wajib diisi.');
  const rawLines=Array.isArray(input.lines)?input.lines:[];
  if(!rawLines.length)throw new Error('Tambahkan sedikitnya satu barang.');
  const lines=rawLines.map(row=>({item:inventoryItem(row.item_code),quantity:Number(row.quantity||0),unit_price:Number(row.unit_price||0)}));
  for(const line of lines){
    if(!Number.isFinite(line.quantity)||line.quantity<=0||!Number.isFinite(line.unit_price)||line.unit_price<0)throw new Error('Jumlah dan harga barang tidak valid.');
    if((kind==='purchase'||kind==='sale'||kind==='adjustment_in')&&line.unit_price<=0)throw new Error('Harga satuan wajib lebih dari nol.');
  }
  const counter=postingAccount(counterAccountCode,'Rekening lawan');
  if(kind==='purchase'){
    if(!['cash_bank','payable'].includes(paymentMode))throw new Error('Pilih cara pembayaran pembelian.');
    if(paymentMode==='payable'){
      const supplier=db.prepare("SELECT 1 FROM accounting_legacy_suppliers WHERE supplier_code=? UNION ALL SELECT 1 FROM accounting_suppliers WHERE supplier_code=? LIMIT 1").get(supplierCode,supplierCode);
      if(!supplier)throw new Error('Supplier wajib dipilih untuk pembelian hutang.');
    }
  }
  if(kind==='sale'&&paymentMode!=='cash_bank')throw new Error('Penjualan tahap pertama hanya mendukung Tunai/Bank.');
  db.exec('BEGIN IMMEDIATE');
  try{
    const journalId=Number(db.prepare("INSERT INTO accounting_journal_entries (voucher_number,transaction_date,description,amount,transaction_type,legacy_user_id,source) VALUES (?,?,?,?,?,?,'manual')").run(documentNumber,transactionDate,description,0,{purchase:'Pembelian Barang',sale:'Penjualan Barang',adjustment_in:'Penyesuaian Stok Tambah',adjustment_out:'Penyesuaian Stok Kurang'}[kind],String(user?.username||'')).lastInsertRowid);
    const documentId=Number(db.prepare('INSERT INTO accounting_inventory_documents (document_number,transaction_date,transaction_kind,supplier_code,payment_mode,counter_account_code,description,reference_number,journal_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)').run(documentNumber,transactionDate,kind,supplierCode,paymentMode,counter.account_code,description,referenceNumber,journalId,String(user?.username||'')).lastInsertRowid);
    const insertLine=db.prepare('INSERT INTO accounting_inventory_document_lines (document_id,item_code,quantity,unit_price,total_amount) VALUES (?,?,?,?,?)');
    for(const line of lines)insertLine.run(documentId,line.item.item_code,line.quantity,line.unit_price,kind==='sale'?line.quantity*line.unit_price:kind==='adjustment_out'?0:line.quantity*line.unit_price);
    rebuildOperationalInventoryFifo();
    db.exec('COMMIT');
    return {id:documentId,document_number:documentNumber,journal_id:journalId};
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
const saveInventoryDocumentWithTransactionLabel=saveInventoryDocument;
// Jangan menimpa payment_mode atau rekening lawan dari form.  Untuk Barang
// Masuk, rekening lawan dapat berupa Pembelian Barang Jadi atau Hutang
// Supplier; memaksanya menjadi kas/bank membuat validasi yang salah dan
// menghapus uraian yang dipilih pengguna.
saveInventoryDocument=(input,user)=>{const kind=normalizeInventoryTransactionKind(input?.inventory_flow||input?.transaction_kind),result=saveInventoryDocumentWithTransactionLabel({...input,transaction_kind:kind,inventory_flow:kind},user),label=kind==='purchase'?'Barang Masuk':kind==='sale'?'Barang Keluar':'';if(label)db.prepare('UPDATE accounting_journal_entries SET transaction_type=? WHERE id=?').run(label,result.journal_id);return result;};
const saveInventoryDocumentWithoutAutomaticHpp=saveInventoryDocument;
saveInventoryDocument=(input,user)=>{const kind=normalizeInventoryTransactionKind(input?.inventory_flow||input?.transaction_kind),normalizedInput={...input,transaction_kind:kind,inventory_flow:kind},result=saveInventoryDocumentWithoutAutomaticHpp(normalizedInput,user);if(kind!=='sale')return result;db.exec('BEGIN IMMEDIATE');try{db.prepare("DELETE FROM accounting_journal_lines WHERE journal_id=? AND description LIKE 'HPP %'").run(result.journal_id);const amount=Number(db.prepare('SELECT COALESCE(SUM(debit),0) amount FROM accounting_journal_lines WHERE journal_id=?').get(result.journal_id).amount);db.prepare('UPDATE accounting_journal_entries SET amount=? WHERE id=?').run(amount,result.journal_id);db.exec('COMMIT');return result;}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}};
function accountingPibSettings(){
  const defaultImportPurchaseAccountCode='05.03.001.002.000.0000';
  const fallback={id:1,purchase_account_code:'05.03.001.000.000.0000',customs_duty_account_code:'05.01.017.000.000.0000',vat_account_code:'02.05.001.000.000.0000',pph22_account_code:'01.01.004.001.000.000.0000',payment_account_code:'01.01.002.001.000.0000',freight_debit_account_code:'05.02.002.000.000.0000',freight_credit_account_code:'02.18.000.000.000.0000'};
  fallback.import_purchase_account_code=defaultImportPurchaseAccountCode;
  const settings=db.prepare('SELECT * FROM accounting_pib_settings WHERE id=1').get()||fallback;
  if(!settings.import_purchase_account_code)settings.import_purchase_account_code=defaultImportPurchaseAccountCode;
  return {settings,accounts:accountingAccounts().accounts,items:operationalInventoryItems().items,suppliers:accountingSuppliers().suppliers};
}
function saveAccountingPibSettings(input,user){
  if(user?.role!=='master')throw new Error('Hanya akun master yang dapat mengubah pengaturan Cek List PIB.');
  // Keep legacy freight credit configuration when saving the streamlined PIB
  // form. Freight is now credited through supplier AP in Invoice/HI.
  const row={...(accountingPibSettings().settings||{}),...(input?.settings||input||{})},keys=['purchase_account_code','customs_duty_account_code','vat_account_code','pph22_account_code','payment_account_code','freight_debit_account_code','freight_credit_account_code'];
  keys.splice(1,0,'import_purchase_account_code');
  const values={};for(const key of keys)values[key]=postingAccount(String(row[key]||'').trim(),`Rekening ${key.replace(/_code$/,'').replace(/_/g,' ')}`).account_code;
  db.prepare(`INSERT INTO accounting_pib_settings(id,${keys.join(',')},updated_by) VALUES (1,${keys.map(()=>'?').join(',')},?) ON CONFLICT(id) DO UPDATE SET ${keys.map(key=>`${key}=excluded.${key}`).join(',')},updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).run(...keys.map(key=>values[key]),String(user?.username||''));
  return accountingPibSettings();
}
function pibSupplier(code){
  const supplierCode=String(code||'').trim();if(!supplierCode)return {supplier_code:'',supplier_name:''};
  const supplier=db.prepare(`SELECT s.supplier_code,s.supplier_name,COALESCE(m.payable_account_code,'') payable_account_code
    FROM (SELECT supplier_code,supplier_name FROM accounting_legacy_suppliers WHERE supplier_code=? UNION ALL SELECT supplier_code,supplier_name FROM accounting_suppliers WHERE supplier_code=?) s
    LEFT JOIN accounting_supplier_payable_mappings m ON m.supplier_code=s.supplier_code LIMIT 1`).get(supplierCode,supplierCode);
  if(!supplier)throw new Error('Supplier PIB tidak ditemukan.');return supplier;
}
function normalizePibLines(input){
  const defaultRate=Number(input?.exchange_rate||0),currency=String(input?.currency_code||'CNY').trim().slice(0,12)||'CNY',dutyRate=Number(input?.customs_duty_rate||0),ppnbmRate=Number(input?.ppnbm_rate||0);
  if(!Number.isFinite(defaultRate)||defaultRate<=0)throw new Error('Kurs PIB wajib lebih dari nol.');
  if(!Number.isFinite(dutyRate)||dutyRate<0||!Number.isFinite(ppnbmRate)||ppnbmRate<0)throw new Error('Tarif BM atau PPnBM tidak valid.');
  const lines=(Array.isArray(input?.lines)?input.lines:[]).map(raw=>{
    const item=inventoryItem(raw.item_code),quantity=Number(raw.quantity||0),unitPrice=Number(raw.unit_price_foreign||0),lineRate=Number(raw.exchange_rate||defaultRate),lineDuty=Number(raw.customs_duty_rate??dutyRate),linePpnbm=Number(raw.ppnbm_rate??ppnbmRate);
    if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitPrice)||unitPrice<=0||!Number.isFinite(lineRate)||lineRate<=0||!Number.isFinite(lineDuty)||lineDuty<0||!Number.isFinite(linePpnbm)||linePpnbm<0)throw new Error(`Rincian PIB untuk ${item.item_code} tidak valid.`);
    const foreignAmount=quantity*unitPrice,importAmount=foreignAmount*lineRate,duty=importAmount*lineDuty/100,ppnbm=importAmount*linePpnbm/100,landed=importAmount+duty+ppnbm;
    return {item,quantity,unit_name:String(raw.unit_name||'').trim().slice(0,30),currency_code:String(raw.currency_code||currency).trim().slice(0,12)||currency,unit_price_foreign:unitPrice,exchange_rate:lineRate,foreign_amount:foreignAmount,import_amount:importAmount,customs_duty_rate:lineDuty,customs_duty_amount:duty,ppnbm_rate:linePpnbm,ppnbm_amount:ppnbm,landed_amount:landed,landed_unit_cost:landed/quantity};
  });
  if(!lines.length)throw new Error('Tambahkan setidaknya satu barang pada Cek List PIB.');return lines;
}
function normalizePibPayload(input){
  const settings=accountingPibSettings().settings,date=String(input?.transaction_date||'').trim(),aju=String(input?.aju_number||'').trim().slice(0,100),supplier=pibSupplier(input?.supplier_code),lines=normalizePibLines(input);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!aju)throw new Error('Tanggal dan No. AJU wajib diisi.');
  if(!supplier.payable_account_code)throw new Error(`Supplier ${supplier.supplier_name} belum memiliki rekening Hutang yang dipetakan. Atur di Pengaturan Cek List PIB sebelum menyimpan.`);
  const supplierPayable=postingAccount(supplier.payable_account_code,'Rekening Hutang supplier PIB').account_code;
  const code=(key)=>String(input?.[key]||settings[key]||'').trim();
  const accountKeys=['purchase_account_code','customs_duty_account_code','vat_account_code','pph22_account_code','payment_account_code','freight_debit_account_code','freight_credit_account_code'];
  accountKeys.splice(1,0,'import_purchase_account_code');
  const accounts={};for(const key of accountKeys)accounts[key]=postingAccount(code(key),`Rekening ${key.replace(/_code$/,'').replace(/_/g,' ')}`).account_code;
  const totalImport=lines.reduce((sum,line)=>sum+line.import_amount,0),totalDuty=lines.reduce((sum,line)=>sum+line.customs_duty_amount,0),totalPpnbm=lines.reduce((sum,line)=>sum+line.ppnbm_amount,0),vatRate=Number(input?.vat_rate??11),pphRate=Number(input?.pph22_rate??2.5),freight=Number(input?.freight_amount||0),vatOverride=String(input?.vat_amount??'').trim(),pphOverride=String(input?.pph22_amount??'').trim();
  if(!Number.isFinite(vatRate)||vatRate<0||!Number.isFinite(pphRate)||pphRate<0||!Number.isFinite(freight)||freight<0)throw new Error('Tarif atau nilai pungutan PIB tidak valid.');
  const vat=vatOverride===''?totalImport*vatRate/100:Number(vatOverride),pph=pphOverride===''?totalImport*pphRate/100:Number(pphOverride);
  if(!Number.isFinite(vat)||vat<0||!Number.isFinite(pph)||pph<0)throw new Error('Nilai PPN atau PPh 22 tidak valid.');
  return {aju_number:aju,invoice_number:String(input?.invoice_number||'').trim().slice(0,100),transaction_date:date,supplier_code:supplier.supplier_code,supplier_name:supplier.supplier_name,supplier_payable_account_code:supplierPayable,currency_code:String(input?.currency_code||'CNY').trim().slice(0,12)||'CNY',exchange_rate:Number(input?.exchange_rate||0),customs_duty_rate:Number(input?.customs_duty_rate||0),ppnbm_rate:Number(input?.ppnbm_rate||0),vat_rate:vatRate,pph22_rate:pphRate,customs_duty_amount:totalDuty,ppnbm_amount:totalPpnbm,vat_amount:vat,pph22_amount:pph,freight_amount:freight,total_import_amount:totalImport,total_inventory_amount:lines.reduce((sum,line)=>sum+line.landed_amount,0),lines,...accounts};
}
function pibTransaction(id){
  const pib=db.prepare('SELECT * FROM accounting_pib_transactions WHERE id=?').get(Number(id));if(!pib)throw new Error('Cek List PIB tidak ditemukan.');
  // Draf lama dibuat sebelum snapshot rekening Hutang ditambahkan. Ambil
  // pemetaan saat ini agar draf masih dapat ditinjau, tanpa mengubah jurnal
  // historis yang sudah diposting.
  if(!pib.supplier_payable_account_code){const supplier=pibSupplier(pib.supplier_code);pib.supplier_payable_account_code=supplier.payable_account_code||'';}
  if(!pib.import_purchase_account_code)pib.import_purchase_account_code=accountingPibSettings().settings.import_purchase_account_code;
  pib.lines=db.prepare('SELECT * FROM accounting_pib_lines WHERE pib_id=? ORDER BY id').all(pib.id).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='number'?Number(value):value])));
  for(const key of ['exchange_rate','customs_duty_rate','ppnbm_rate','vat_rate','pph22_rate','customs_duty_amount','ppnbm_amount','vat_amount','pph22_amount','freight_amount'])pib[key]=Number(pib[key]||0);
  return pib;
}
function pibPreviewAccountLine(accountCode,fallbackLabel,debit=0,credit=0){const account=postingAccount(accountCode,fallbackLabel);return {account_code:account.account_code,label:account.account_name||fallbackLabel,debit:Number(debit||0),credit:Number(credit||0)};}
function pibPreviewJournal(voucher_number,description,lines){const debit_total=lines.reduce((sum,line)=>sum+Number(line.debit||0),0),credit_total=lines.reduce((sum,line)=>sum+Number(line.credit||0),0);return {voucher_number,description,total:debit_total,debit_total,credit_total,balance_difference:debit_total-credit_total,balanced:Math.abs(debit_total-credit_total)<0.005,lines};}
function pibPreview(pib){
  const brmTotal=pib.lines.reduce((sum,line)=>sum+Number(line.landed_amount||0),0),importTotal=pib.lines.reduce((sum,line)=>sum+Number(line.import_amount||0),0),freight=Number(pib.freight_amount||0),brmLines=pib.lines.map(line=>{const item=inventoryItem(line.item_code);return pibPreviewAccountLine(item.debit_purchase_code,`${line.item_code} — ${line.item_name}`,line.landed_amount,0);});
  // Ikuti arah jurnal BRM/HI historis (2021--2026): persediaan dan pembelian
  // impor bertambah di Debit; akun pembelian barang jadi dan hutang supplier
  // menjadi lawan di Kredit. Sebelumnya arah kedua jurnal ini terbalik walau
  // totalnya tetap seimbang, sehingga tidak dapat dibandingkan dengan histori.
  brmLines.push(pibPreviewAccountLine(pib.purchase_account_code,'Pembelian Barang Jadi',0,brmTotal));
  const invoiceLines=[pibPreviewAccountLine(pib.import_purchase_account_code,'Pembelian Import',importTotal,0)];
  if(freight>0.0001)invoiceLines.push(pibPreviewAccountLine(pib.freight_debit_account_code,'Biaya Freight PIB',freight,0));
  invoiceLines.push(pibPreviewAccountLine(pib.supplier_payable_account_code,'Hutang supplier PIB',0,importTotal+freight));
  // SOP jurnal PIB historis: pungutan impor menambah biaya/pajak di sisi
  // Debit, sedangkan kas/bank pembayaran berada di sisi Kredit. Sebelumnya
  // arah ini tertukar sehingga pratinjau PIB tidak seimbang dan tidak bisa
  // diposting meskipun nilai pungutannya sudah benar.
  const paymentCharges=[
    pibPreviewAccountLine(pib.customs_duty_account_code,'Bea Masuk',pib.customs_duty_amount,0),
    pibPreviewAccountLine(pib.vat_account_code,'PPN Impor',pib.vat_amount,0),
    pibPreviewAccountLine(pib.pph22_account_code,'PPh Pasal 22',pib.pph22_amount,0)
  ];
  // Derive the Bank credit from the actual Debit rows shown to the user.
  // This keeps the preview and journal invariant even for old PIB drafts
  // whose cached tax columns were written by an older module version.
  const paymentTotal=paymentCharges.reduce((sum,line)=>sum+Number(line.debit||0),0);
  const paymentLines=[...paymentCharges,pibPreviewAccountLine(pib.payment_account_code,'Bank / Pembayaran PIB',0,paymentTotal)];
  return {pib,brm:pibPreviewJournal(`${pib.transaction_date.slice(0,4)}/BRM_${pib.aju_number}`,`BRM PIB ${pib.aju_number}${pib.invoice_number?` · ${pib.invoice_number}`:''}`,brmLines),invoice:pibPreviewJournal(`${pib.transaction_date.slice(0,4)}/${pib.aju_number}/HI`,`Invoice Impor ${pib.aju_number}${pib.invoice_number?` · ${pib.invoice_number}`:''}`,invoiceLines),payment:pibPreviewJournal(`${pib.transaction_date.slice(0,4)}/PIB_${pib.aju_number}`,`Pembayaran PIB ${pib.aju_number}`,paymentLines)};
}
function saveAccountingPib(input,user){
  const payload=normalizePibPayload(input);if(accountingClosedYear(payload.transaction_date.slice(0,4)))throw new Error('Tahun jurnal sudah ditutup; Cek List PIB tidak dapat dibuat.');
  db.exec('BEGIN IMMEDIATE');try{const id=Number(db.prepare(`INSERT INTO accounting_pib_transactions(aju_number,invoice_number,transaction_date,supplier_code,currency_code,exchange_rate,customs_duty_rate,ppnbm_rate,vat_rate,pph22_rate,customs_duty_amount,ppnbm_amount,vat_amount,pph22_amount,freight_amount,purchase_account_code,import_purchase_account_code,customs_duty_account_code,vat_account_code,pph22_account_code,payment_account_code,freight_debit_account_code,freight_credit_account_code,supplier_payable_account_code,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(payload.aju_number,payload.invoice_number,payload.transaction_date,payload.supplier_code,payload.currency_code,payload.exchange_rate,payload.customs_duty_rate,payload.ppnbm_rate,payload.vat_rate,payload.pph22_rate,payload.customs_duty_amount,payload.ppnbm_amount,payload.vat_amount,payload.pph22_amount,payload.freight_amount,payload.purchase_account_code,payload.import_purchase_account_code,payload.customs_duty_account_code,payload.vat_account_code,payload.pph22_account_code,payload.payment_account_code,payload.freight_debit_account_code,payload.freight_credit_account_code,payload.supplier_payable_account_code,String(user?.username||'')).lastInsertRowid),insert=db.prepare('INSERT INTO accounting_pib_lines(pib_id,item_code,item_name,quantity,unit_name,currency_code,unit_price_foreign,exchange_rate,foreign_amount,import_amount,customs_duty_rate,customs_duty_amount,ppnbm_rate,ppnbm_amount,landed_amount,landed_unit_cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');for(const line of payload.lines)insert.run(id,line.item.item_code,line.item.item_name,line.quantity,line.unit_name,line.currency_code,line.unit_price_foreign,line.exchange_rate,line.foreign_amount,line.import_amount,line.customs_duty_rate,line.customs_duty_amount,line.ppnbm_rate,line.ppnbm_amount,line.landed_amount,line.landed_unit_cost);db.exec('COMMIT');return pibPreview(pibTransaction(id));}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function accountingPibList(){return {transactions:db.prepare(`SELECT p.*,COALESCE((SELECT SUM(landed_amount) FROM accounting_pib_lines l WHERE l.pib_id=p.id),0) inventory_amount FROM accounting_pib_transactions p ORDER BY p.transaction_date DESC,p.id DESC LIMIT 200`).all().map(row=>({...row,inventory_amount:Number(row.inventory_amount||0),vat_amount:Number(row.vat_amount||0),pph22_amount:Number(row.pph22_amount||0),freight_amount:Number(row.freight_amount||0)}))};}
function deleteAccountingPib(id,user){
  if(user?.role!=='master')throw new Error('Hanya akun master yang dapat menghapus draf Cek List PIB.');
  const pib=pibTransaction(id);
  if(pib.status!=='draft')throw new Error('PIB yang sudah diposting tidak dapat dihapus langsung karena jurnal dan stoknya sudah tercatat. Gunakan pembatalan/koreksi jurnal terlebih dahulu.');
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('DELETE FROM accounting_pib_lines WHERE pib_id=?').run(pib.id);
    db.prepare("DELETE FROM accounting_pib_transactions WHERE id=? AND status='draft'").run(pib.id);
    db.exec('COMMIT');
    return {deleted:true,id:pib.id,aju_number:pib.aju_number};
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function updateAccountingPib(id,input,user){
  if(user?.role!=='master')throw new Error('Hanya akun master yang dapat mengubah draf Cek List PIB.');
  const current=pibTransaction(id);if(current.status!=='draft')throw new Error('Hanya Cek List PIB draf yang dapat diubah.');
  const payload=normalizePibPayload(input);
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare(`UPDATE accounting_pib_transactions SET aju_number=?,invoice_number=?,transaction_date=?,supplier_code=?,currency_code=?,exchange_rate=?,customs_duty_rate=?,ppnbm_rate=?,vat_rate=?,pph22_rate=?,customs_duty_amount=?,ppnbm_amount=?,vat_amount=?,pph22_amount=?,freight_amount=?,purchase_account_code=?,import_purchase_account_code=?,customs_duty_account_code=?,vat_account_code=?,pph22_account_code=?,payment_account_code=?,freight_debit_account_code=?,freight_credit_account_code=?,supplier_payable_account_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(payload.aju_number,payload.invoice_number,payload.transaction_date,payload.supplier_code,payload.currency_code,payload.exchange_rate,payload.customs_duty_rate,payload.ppnbm_rate,payload.vat_rate,payload.pph22_rate,payload.customs_duty_amount,payload.ppnbm_amount,payload.vat_amount,payload.pph22_amount,payload.freight_amount,payload.purchase_account_code,payload.import_purchase_account_code,payload.customs_duty_account_code,payload.vat_account_code,payload.pph22_account_code,payload.payment_account_code,payload.freight_debit_account_code,payload.freight_credit_account_code,payload.supplier_payable_account_code,current.id);
    db.prepare('DELETE FROM accounting_pib_lines WHERE pib_id=?').run(current.id);
    const insert=db.prepare('INSERT INTO accounting_pib_lines(pib_id,item_code,item_name,quantity,unit_name,currency_code,unit_price_foreign,exchange_rate,foreign_amount,import_amount,customs_duty_rate,customs_duty_amount,ppnbm_rate,ppnbm_amount,landed_amount,landed_unit_cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for(const line of payload.lines)insert.run(current.id,line.item.item_code,line.item.item_name,line.quantity,line.unit_name,line.currency_code,line.unit_price_foreign,line.exchange_rate,line.foreign_amount,line.import_amount,line.customs_duty_rate,line.customs_duty_amount,line.ppnbm_rate,line.ppnbm_amount,line.landed_amount,line.landed_unit_cost);
    db.exec('COMMIT');return pibPreview(pibTransaction(current.id));
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function standardizeFinishedGoodsMappings(user){
  if(user?.role!=='master')throw new Error('Hanya akun master yang dapat menyamakan pemetaan rekening barang.');
  const inventoryAccountCode=postingAccount('01.01.006.002.001.0000','Rekening Persediaan Barang Jadi').account_code;
  const purchaseAccountCode=postingAccount('05.03.001.000.000.0000','Rekening Pembelian Barang Jadi').account_code;
  const salesAccountCode=postingAccount('04.01.000.000.000.0000','Rekening Pendapatan Penjualan').account_code;
  // Barang Jadi (Dxxxx) selalu memakai empat rekening standar yang sama.
  // Rekening persediaan turunan per barang hanya dipakai untuk sejarah lama;
  // aksi ini tidak mengubah jurnal, kartu stok, atau pemetaan laporan.
  const rows=db.prepare("SELECT item_code FROM accounting_legacy_items WHERE upper(item_code) GLOB 'D[0-9][0-9][0-9][0-9]' UNION SELECT item_code FROM accounting_items WHERE upper(item_code) GLOB 'D[0-9][0-9][0-9][0-9]'").all();
  db.exec('BEGIN IMMEDIATE');
  try{
    const updateLegacy=db.prepare('UPDATE accounting_legacy_items SET debit_purchase_code=?,credit_purchase_code=?,debit_sales_code=?,credit_sales_code=? WHERE item_code=?');
    const updateManual=db.prepare('UPDATE accounting_items SET debit_purchase_code=?,credit_purchase_code=?,debit_sales_code=?,credit_sales_code=?,updated_at=CURRENT_TIMESTAMP WHERE item_code=?');
    let legacy=0,manual=0;
    for(const row of rows){
      const itemCode=String(row.item_code||'').trim();
      const values=[inventoryAccountCode,purchaseAccountCode,salesAccountCode,inventoryAccountCode,itemCode];
      legacy+=updateLegacy.run(...values).changes;
      manual+=updateManual.run(...values).changes;
    }
    db.exec('COMMIT');
    return {updated:legacy+manual,legacy,manual};
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function postAccountingPib(id,input,user){
  const pib=pibTransaction(id);if(pib.status!=='draft')throw new Error('Hanya Cek List PIB draf yang dapat diposting.');if(!pib.supplier_payable_account_code)throw new Error('Supplier PIB belum memiliki rekening Hutang yang dipetakan. Atur pemetaan supplier terlebih dahulu.');if(accountingClosedYear(pib.transaction_date.slice(0,4)))throw new Error('Tahun jurnal sudah ditutup; Cek List PIB tidak dapat diposting.');
  const review=input||{},preview=pibPreview(pib),brmVoucher=String(review.brm_voucher_number||preview.brm.voucher_number).trim().slice(0,100),invoiceVoucher=String(review.invoice_voucher_number||preview.invoice.voucher_number).trim().slice(0,100),pibVoucher=String(review.pib_voucher_number||preview.payment.voucher_number).trim().slice(0,100);
  for(const [label,journal] of [['BRM',preview.brm],['Invoice Impor/HI',preview.invoice],['PIB',preview.payment]])if(!journal.balanced)throw new Error(`Jurnal ${label} tidak seimbang (selisih ${Math.abs(journal.balance_difference)}). Periksa rekening dan nilai PIB.`);
  if(!brmVoucher||!invoiceVoucher||!pibVoucher)throw new Error('Nomor bukti BRM, Invoice Impor/HI, dan PIB wajib diisi.');
  const exists=db.prepare('SELECT voucher_number FROM accounting_journal_entries WHERE voucher_number IN (?,?,?)').all(brmVoucher,invoiceVoucher,pibVoucher);if(exists.length)throw new Error(`Nomor bukti sudah dipakai: ${exists.map(row=>row.voucher_number).join(', ')}.`);
  db.exec('BEGIN IMMEDIATE');try{
    const brmJournal=Number(db.prepare("INSERT INTO accounting_journal_entries(voucher_number,transaction_date,description,amount,transaction_type,legacy_user_id,source) VALUES (?,?,?,?,?,?,'manual')").run(brmVoucher,pib.transaction_date,String(review.brm_description||preview.brm.description).slice(0,2000),0,'Barang Masuk',String(user?.username||'')).lastInsertRowid),documentId=Number(db.prepare("INSERT INTO accounting_inventory_documents(document_number,transaction_date,transaction_kind,supplier_code,payment_mode,counter_account_code,description,reference_number,journal_id,created_by) VALUES (?,?,'purchase',?,'cash_bank',?,?,?,?,?)").run(brmVoucher,pib.transaction_date,pib.supplier_code,pib.purchase_account_code,String(review.brm_description||preview.brm.description).slice(0,2000),pib.aju_number,brmJournal,String(user?.username||'')).lastInsertRowid),insertStock=db.prepare('INSERT INTO accounting_inventory_document_lines(document_id,item_code,quantity,unit_price,total_amount) VALUES (?,?,?,?,?)');
    for(const line of pib.lines)insertStock.run(documentId,line.item_code,Number(line.quantity),Number(line.landed_unit_cost),Number(line.landed_amount));
    rebuildOperationalInventoryFifo();
    const brmTotals=db.prepare('SELECT COALESCE(SUM(debit),0) debit_total,COALESCE(SUM(credit),0) credit_total FROM accounting_journal_lines WHERE journal_id=?').get(brmJournal);
    if(Math.abs(Number(brmTotals.debit_total)-Number(brmTotals.credit_total))>=0.005)throw new Error('Jurnal BRM tidak seimbang setelah stok dihitung. PIB tidak diposting.');
    const insertJournal=(voucher,description,type,lines)=>{const debitTotal=lines.reduce((sum,line)=>sum+Number(line.debit||0),0),creditTotal=lines.reduce((sum,line)=>sum+Number(line.credit||0),0);if(Math.abs(debitTotal-creditTotal)>=0.005)throw new Error(`Jurnal ${type} tidak seimbang dan tidak dapat diposting.`);const journalId=Number(db.prepare("INSERT INTO accounting_journal_entries(voucher_number,transaction_date,description,amount,transaction_type,legacy_user_id,source) VALUES (?,?,?,?,?,?,'manual')").run(voucher,pib.transaction_date,description,debitTotal,type,String(user?.username||'')).lastInsertRowid),insert=db.prepare('INSERT INTO accounting_journal_lines(journal_id,account_code,description,debit,credit) VALUES (?,?,?,?,?)');for(const line of lines.filter(line=>Number(line.debit||0)>0||Number(line.credit||0)>0))insert.run(journalId,line.account_code,line.label,Number(line.debit||0),Number(line.credit||0));return journalId;};
    const invoiceJournal=insertJournal(invoiceVoucher,String(review.invoice_description||preview.invoice.description).slice(0,2000),'Invoice Impor',preview.invoice.lines),paymentJournal=insertJournal(pibVoucher,String(review.pib_description||preview.payment.description).slice(0,2000),'Pembayaran PIB',preview.payment.lines);
    db.prepare("UPDATE accounting_pib_transactions SET status='posted',supplier_payable_account_code=?,brm_document_id=?,brm_journal_id=?,invoice_journal_id=?,pib_journal_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(pib.supplier_payable_account_code,documentId,brmJournal,invoiceJournal,paymentJournal,pib.id);db.exec('COMMIT');return pibPreview(pibTransaction(pib.id));
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function accountingInvoiceProfile(){
  const row=db.prepare('SELECT * FROM accounting_invoice_profiles WHERE id=1').get();
  return row||{id:1,legal_name:'',legal_address:'',tax_id:'',signatory_name:'',sales_account_code:'04.07.000.000.000.0000',vat_payable_account_code:'02.05.001.000.000.0000',vat_rate:0.11,payment_instructions:'',default_due_days:30};
}
function accountingInvoiceSettings(){return {profile:accountingInvoiceProfile(),customers:db.prepare('SELECT * FROM accounting_invoice_customers ORDER BY active DESC,customer_name').all(),accounts:accountingAccounts().accounts,items:operationalInventoryItems().items};}
function saveAccountingInvoiceSettings(input,user){
  const profile=input?.profile||{},customers=Array.isArray(input?.customers)?input.customers:[],rate=Number(profile.vat_rate),dueDays=Number(profile.default_due_days);
  if(!Number.isFinite(rate)||rate<0||rate>1)throw new Error('Tarif PPN harus antara 0 dan 1.');
  if(!Number.isInteger(dueDays)||dueDays<0||dueDays>720)throw new Error('Jatuh tempo bawaan harus antara 0 dan 720 hari.');
  for(const key of ['sales_account_code','vat_payable_account_code'])postingAccount(profile[key],key==='sales_account_code'?'Rekening Penjualan':'Rekening Hutang PPN');
  db.exec('BEGIN IMMEDIATE');try{
    db.prepare("INSERT INTO accounting_invoice_profiles(id,legal_name,legal_address,tax_id,signatory_name,sales_account_code,vat_payable_account_code,vat_rate,payment_instructions,default_due_days,updated_by) VALUES (1,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET legal_name=excluded.legal_name,legal_address=excluded.legal_address,tax_id=excluded.tax_id,signatory_name=excluded.signatory_name,sales_account_code=excluded.sales_account_code,vat_payable_account_code=excluded.vat_payable_account_code,vat_rate=excluded.vat_rate,payment_instructions=excluded.payment_instructions,default_due_days=excluded.default_due_days,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").run(String(profile.legal_name||'').trim().slice(0,180),String(profile.legal_address||'').trim().slice(0,1000),String(profile.tax_id||'').trim().slice(0,80),String(profile.signatory_name||'').trim().slice(0,180),String(profile.sales_account_code||'').trim(),String(profile.vat_payable_account_code||'').trim(),rate,String(profile.payment_instructions||'').trim().slice(0,1000),dueDays,String(user?.username||''));
    const save=db.prepare("INSERT INTO accounting_invoice_customers(id,customer_name,customer_address,tax_id,email,receivable_account_code,active) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET customer_name=excluded.customer_name,customer_address=excluded.customer_address,tax_id=excluded.tax_id,email=excluded.email,receivable_account_code=excluded.receivable_account_code,active=excluded.active,updated_at=CURRENT_TIMESTAMP"),remove=db.prepare('DELETE FROM accounting_invoice_customers WHERE id=? AND NOT EXISTS (SELECT 1 FROM accounting_invoices WHERE customer_id=?)');
    for(const row of customers){const name=String(row.customer_name||'').trim().slice(0,180);if(!name)continue;const receivable=String(row.receivable_account_code||'').trim();postingAccount(receivable,'Rekening Piutang pelanggan');save.run(Number(row.id)||null,name,String(row.customer_address||'').trim().slice(0,1000),String(row.tax_id||'').trim().slice(0,80),String(row.email||'').trim().slice(0,180),receivable,row.active===false||row.active==='false'?0:1);}
    for(const id of (Array.isArray(input?.deleted_customer_ids)?input.deleted_customer_ids:[]))remove.run(Number(id)||0,Number(id)||0);
    db.exec('COMMIT');return accountingInvoiceSettings();
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function invoiceVoucherSignature(voucher){const chunks=String(voucher||'').toUpperCase().split(/[\\/_-]+/).filter(Boolean);if(/^\d{4}$/.test(chunks[0]||''))chunks.shift();const text=chunks.filter(chunk=>!['BRK','FP','PP'].includes(chunk)).join('');return `${text.replace(/[^A-Z]/g,'')}|${text.replace(/\D/g,'')}`;}
function legacyInvoiceStockHeaders(){const byDate=new Map();for(const row of db.prepare("SELECT voucher_number,transaction_date FROM accounting_legacy_inventory_transactions WHERE transaction_type<>3").all()){const key=`${row.transaction_date}|${invoiceVoucherSignature(row.voucher_number)}`;if(!byDate.has(key))byDate.set(key,row.voucher_number);}return byDate;}
function legacyInvoiceStock(voucher){const header=db.prepare('SELECT voucher_number,transaction_date,description FROM accounting_legacy_inventory_transactions WHERE voucher_number=?').get(voucher);if(!header)return null;return {...header,lines:db.prepare('SELECT l.item_code,COALESCE(i.item_name,l.item_code) item_name,l.quantity FROM accounting_legacy_inventory_lines l LEFT JOIN accounting_legacy_items i ON i.item_code=l.item_code WHERE l.voucher_number=? ORDER BY l.id').all(voucher).map(row=>({...row,quantity:Number(row.quantity)}))};}
function accountingInvoiceCandidates(start='',end='',limit=150){
  const profile=accountingInvoiceProfile(),stockHeaders=legacyInvoiceStockHeaders(),params=[profile.vat_payable_account_code,start,start,end,end],rows=db.prepare(`SELECT j.id journal_id,j.transaction_date,j.voucher_number,j.description,
    COALESCE(SUM(CASE WHEN l.account_code LIKE '04.%' THEN l.credit ELSE 0 END),0) dpp_amount,
    COALESCE(SUM(CASE WHEN l.account_code=? THEN l.credit ELSE 0 END),0) vat_amount,
    COALESCE(SUM(CASE WHEN l.account_code LIKE '01.01.003.%' THEN l.debit ELSE 0 END),0) receivable_amount,
    MAX(CASE WHEN l.account_code LIKE '01.01.003.%' AND l.debit>0 THEN l.account_code ELSE '' END) receivable_account_code,
    COUNT(DISTINCT CASE WHEN l.account_code LIKE '01.01.003.%' AND l.debit>0 THEN l.account_code END) receivable_count
    FROM accounting_journal_entries j JOIN accounting_journal_lines l ON l.journal_id=j.id
    LEFT JOIN accounting_invoices i ON i.journal_id=j.id
    WHERE i.id IS NULL AND (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?)
    GROUP BY j.id HAVING dpp_amount>0.0001 AND receivable_amount>0.0001 ORDER BY j.transaction_date DESC,j.id DESC`).all(...params).map(row=>({...row,dpp_amount:Number(row.dpp_amount),vat_amount:Number(row.vat_amount),receivable_amount:Number(row.receivable_amount),receivable_count:Number(row.receivable_count),legacy_inventory_voucher:stockHeaders.get(`${row.transaction_date}|${invoiceVoucherSignature(row.voucher_number)}`)||''}));
  const maximum=Math.max(1,Math.min(Number(limit)||150,5000));
  return {candidates:rows.slice(0,maximum),total:rows.length,has_more:rows.length>maximum};
}
function accountingInvoiceLines(invoiceId){return db.prepare('SELECT * FROM accounting_invoice_lines WHERE invoice_id=? ORDER BY id').all(invoiceId).map(row=>({...row,quantity:Number(row.quantity),unit_price:Number(row.unit_price),gross_amount:Number(row.gross_amount),discount_amount:Number(row.discount_amount),dpp_amount:Number(row.dpp_amount),vat_amount:Number(row.vat_amount),total_amount:Number(row.total_amount)}));}
function accountingInvoices(start='',end='',status=''){
  const rows=db.prepare(`SELECT i.*,c.customer_name,c.tax_id customer_tax_id,c.customer_address,j.voucher_number FROM accounting_invoices i JOIN accounting_invoice_customers c ON c.id=i.customer_id LEFT JOIN accounting_journal_entries j ON j.id=i.journal_id WHERE (?='' OR i.transaction_date>=?) AND (?='' OR i.transaction_date<=?) AND (?='' OR i.status=?) ORDER BY i.transaction_date DESC,i.id DESC`).all(start,start,end,end,status,status).map(row=>({...row,dpp_amount:Number(row.dpp_amount),vat_amount:Number(row.vat_amount),total_amount:Number(row.total_amount)}));
  return {invoices:rows};
}
function accountingInvoice(id){const invoice=db.prepare('SELECT i.*,c.customer_name,c.customer_address,c.tax_id customer_tax_id,c.email customer_email FROM accounting_invoices i JOIN accounting_invoice_customers c ON c.id=i.customer_id WHERE i.id=?').get(id);if(!invoice)throw new Error('Invoice tidak ditemukan.');return {...invoice,dpp_amount:Number(invoice.dpp_amount),vat_amount:Number(invoice.vat_amount),total_amount:Number(invoice.total_amount),profile:accountingInvoiceProfile(),lines:accountingInvoiceLines(id)};}
// Pratinjau BRK harus memperlihatkan jurnal HPP/persediaan, bukan hanya
// mutasi barang. Simulasi ini hanya membaca dokumen yang sudah ada dan tidak
// menyentuh batch FIFO maupun jurnal yang sudah diposting.
function accountingInvoicePostingPreview(id){
  const invoice=accountingInvoice(id);
  const rows=db.prepare(`SELECT d.id document_id,d.transaction_date,d.transaction_kind,l.id line_id,l.item_code,l.quantity,l.unit_price
    FROM accounting_inventory_documents d JOIN accounting_inventory_document_lines l ON l.document_id=d.id
    WHERE d.description<>'__LEGACY_FIFO_OPENING__' AND d.transaction_date<=?
    ORDER BY d.transaction_date,d.id,l.id`).all(invoice.transaction_date);
  const batches=new Map(),pushBatch=(code,quantity,unitCost)=>{const list=batches.get(code)||[];list.push({quantity:Number(quantity),unit_cost:Number(unitCost)});batches.set(code,list);};
  const consume=(code,quantity)=>{let needed=Number(quantity),cost=0;for(const batch of batches.get(code)||[]){if(needed<=0.000001)break;const taken=Math.min(needed,batch.quantity);batch.quantity-=taken;needed-=taken;cost+=taken*batch.unit_cost;}return {cost,shortage:needed};};
  for(const row of rows){
    if(['purchase','adjustment_in'].includes(row.transaction_kind))pushBatch(row.item_code,row.quantity,row.unit_price);
    else consume(row.item_code,row.quantity);
  }
  const journalLines=new Map(),stockLines=[],shortages=[];
  for(const line of invoice.lines){
    const item=resolveInventoryItem(line.item_code),fifo=consume(line.item_code,line.quantity),cost=fifo.cost;
    if(fifo.shortage>0.000001)shortages.push({item_code:item.item_code,item_name:item.item_name,missing_quantity:fifo.shortage});
    addJournalLine(journalLines,item.debit_sales_code,cost,0,`HPP ${item.item_name}`);
    addJournalLine(journalLines,item.debit_purchase_code,0,cost,`Persediaan ${item.item_name}`);
    stockLines.push({item_code:item.item_code,item_name:item.item_name,quantity:Number(line.quantity),dpp_amount:Number(line.dpp_amount),fifo_cost:cost,debit_account_code:item.debit_sales_code,credit_account_code:item.debit_purchase_code});
  }
  const lines=[...journalLines.values()],debit=lines.reduce((sum,line)=>sum+Number(line.debit),0),credit=lines.reduce((sum,line)=>sum+Number(line.credit),0);
  return {invoice,inventory_journal:{lines,debit,credit,balanced:Math.abs(debit-credit)<.01},stock_lines:stockLines,shortages};
}
function normalizeInvoiceLines(rawLines,vatRate){
  const rows=(Array.isArray(rawLines)?rawLines:[]).map(row=>{const quantity=Number(row.quantity||0),unitPrice=Number(row.unit_price||0),discount=Number(row.discount_amount||0),gross=quantity*unitPrice,dpp=Number.isFinite(Number(row.dpp_amount))&&String(row.dpp_amount).trim()!==''?Number(row.dpp_amount):gross-discount;if(!String(row.item_code||'').trim()||!String(row.item_name||'').trim()||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitPrice)||unitPrice<0||!Number.isFinite(discount)||discount<0||discount>gross||!Number.isFinite(dpp)||dpp<0)throw new Error('Rincian barang invoice tidak valid.');return {item_code:String(row.item_code).trim().slice(0,100),item_name:String(row.item_name).trim().slice(0,300),quantity,unit_price:unitPrice,gross_amount:gross,discount_amount:discount,dpp_amount:dpp,vat_amount:0,total_amount:0};});
  if(!rows.length)throw new Error('Tambahkan sedikitnya satu barang pada invoice.');const dpp=rows.reduce((sum,row)=>sum+row.dpp_amount,0),vat=dpp*vatRate;for(const row of rows){row.vat_amount=dpp?vat*row.dpp_amount/dpp:0;row.total_amount=row.dpp_amount+row.vat_amount;}return {lines:rows,dpp,vat,total:dpp+vat};
}
function invoiceDefaultDueDate(transactionDate,days=30){const parsed=new Date(`${transactionDate}T00:00:00Z`);if(Number.isNaN(parsed.getTime()))return '';parsed.setUTCDate(parsed.getUTCDate()+Math.max(0,Math.min(720,Number(days)||0)));return parsed.toISOString().slice(0,10);}
function saveAccountingInvoice(input,user){
  const profile=accountingInvoiceProfile(),invoiceNumber=String(input?.invoice_number||'').trim().slice(0,100),date=String(input?.transaction_date||'').trim(),dueDate=String(input?.due_date||invoiceDefaultDueDate(date,profile.default_due_days)).trim(),customerId=Number(input?.customer_id),historical=Number(input?.journal_id)||0;
  if(!invoiceNumber||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!customerId)throw new Error('Nomor invoice, tanggal, dan pelanggan wajib diisi.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||dueDate<date)throw new Error('Tanggal jatuh tempo invoice tidak valid.');
  const customer=db.prepare('SELECT * FROM accounting_invoice_customers WHERE id=? AND active=1').get(customerId);if(!customer)throw new Error('Pelanggan invoice tidak ditemukan atau tidak aktif.');
  const calculated=normalizeInvoiceLines(input?.lines,Number(profile.vat_rate));let sourceKind='new',status='draft',journalId=null,legacyInventoryVoucher='';
  if(historical){const candidate=accountingInvoiceCandidates('', '',5000).candidates.find(row=>Number(row.journal_id)===historical);if(!candidate)throw new Error('Jurnal historis tidak tersedia atau sudah ditautkan ke invoice.');if(candidate.receivable_count!==1||customer.receivable_account_code!==candidate.receivable_account_code)throw new Error('Pelanggan harus memakai rekening Piutang yang sama dengan jurnal historis.');if(Math.abs(calculated.dpp-candidate.dpp_amount)>0.02||Math.abs(calculated.vat-candidate.vat_amount)>0.02||Math.abs(calculated.total-(candidate.dpp_amount+candidate.vat_amount))>0.02)throw new Error('Total rincian barang harus sama dengan DPP, PPN, dan total jurnal historis.');sourceKind='historical';status='historical';journalId=historical;legacyInventoryVoucher=candidate.legacy_inventory_voucher||'';}
  db.exec('BEGIN IMMEDIATE');try{const created=Number(db.prepare('INSERT INTO accounting_invoices(invoice_number,tax_invoice_number,transaction_date,due_date,customer_id,receivable_account_code,journal_id,legacy_inventory_voucher,dpp_amount,vat_amount,total_amount,source_kind,status,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(invoiceNumber,String(input?.tax_invoice_number||'').trim().slice(0,100),date,dueDate,customerId,customer.receivable_account_code,journalId,legacyInventoryVoucher,calculated.dpp,calculated.vat,calculated.total,sourceKind,status,String(input?.notes||'').trim().slice(0,2000),String(user?.username||'')).lastInsertRowid),insert=db.prepare('INSERT INTO accounting_invoice_lines(invoice_id,item_code,item_name,quantity,unit_price,gross_amount,discount_amount,dpp_amount,vat_amount,total_amount) VALUES (?,?,?,?,?,?,?,?,?,?)');for(const row of calculated.lines)insert.run(created,row.item_code,row.item_name,row.quantity,row.unit_price,row.gross_amount,row.discount_amount,row.dpp_amount,row.vat_amount,row.total_amount);db.exec('COMMIT');return accountingInvoice(created);}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function updateAccountingInvoice(id,input,user){
  const current=accountingInvoice(id);if(current.status!=='draft'||current.journal_id)throw new Error('Hanya invoice draf yang belum diposting dapat diubah.');
  const profile=accountingInvoiceProfile(),invoiceNumber=String(input?.invoice_number||'').trim().slice(0,100),date=String(input?.transaction_date||'').trim(),dueDate=String(input?.due_date||invoiceDefaultDueDate(date,profile.default_due_days)).trim(),customerId=Number(input?.customer_id);if(!invoiceNumber||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!customerId)throw new Error('Nomor invoice, tanggal, dan pelanggan wajib diisi.');if(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||dueDate<date)throw new Error('Tanggal jatuh tempo invoice tidak valid.');
  const customer=db.prepare('SELECT * FROM accounting_invoice_customers WHERE id=? AND active=1').get(customerId);if(!customer)throw new Error('Pelanggan invoice tidak ditemukan atau tidak aktif.');const calculated=normalizeInvoiceLines(input?.lines,Number(profile.vat_rate));
  db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE accounting_invoices SET invoice_number=?,tax_invoice_number=?,transaction_date=?,due_date=?,customer_id=?,receivable_account_code=?,dpp_amount=?,vat_amount=?,total_amount=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(invoiceNumber,String(input?.tax_invoice_number||'').trim().slice(0,100),date,dueDate,customerId,customer.receivable_account_code,calculated.dpp,calculated.vat,calculated.total,String(input?.notes||'').trim().slice(0,2000),current.id);db.prepare('DELETE FROM accounting_invoice_lines WHERE invoice_id=?').run(current.id);const insert=db.prepare('INSERT INTO accounting_invoice_lines(invoice_id,item_code,item_name,quantity,unit_price,gross_amount,discount_amount,dpp_amount,vat_amount,total_amount) VALUES (?,?,?,?,?,?,?,?,?,?)');for(const row of calculated.lines)insert.run(current.id,row.item_code,row.item_name,row.quantity,row.unit_price,row.gross_amount,row.discount_amount,row.dpp_amount,row.vat_amount,row.total_amount);db.exec('COMMIT');return accountingInvoice(current.id);}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function deleteAccountingInvoice(id){const invoice=accountingInvoice(id);if(invoice.status!=='draft'||invoice.journal_id)throw new Error('Hanya invoice draf yang belum diposting dapat dihapus.');db.prepare('DELETE FROM accounting_invoices WHERE id=?').run(invoice.id);return {deleted:true};}
function accountingBrkJournalDefaults(invoice){
  const date=String(invoice?.transaction_date||'').trim(),year=/^\d{4}/.test(date)?date.slice(0,4):String(new Date().getFullYear()),dayMonth=/^\d{4}-\d{2}-\d{2}$/.test(date)?`${date.slice(8,10)}${date.slice(5,7)}`:'',customerName=String(invoice?.customer_name||'PELANGGAN').trim().toUpperCase(),ignored=new Set(['PT','CV','UD','PD','TBK','CO','LTD','INDONESIA']),words=customerName.replace(/[^A-Z0-9]+/g,' ').split(/\s+/).filter(word=>word&&!ignored.has(word)),customerCode=(words.length>1?words.map(word=>word[0]).join(''):words[0]||'PLG').slice(0,12);
  return {voucher_number:`${year}/BRK/${dayMonth}${customerCode}`,description:`PENJUALAN (${customerName}${dayMonth?` - ${dayMonth}`:''})`};
}
function postAccountingInvoice(id,user,input={}){
  const invoice=accountingInvoice(id);if(invoice.status!=='draft'||invoice.journal_id)throw new Error('Hanya invoice draf yang belum diposting dapat disimpan sebagai transaksi.');
  for(const line of invoice.lines)inventoryItem(line.item_code);
  const brk=accountingBrkJournalDefaults(invoice),voucherNumber=String(input?.journal_voucher_number||brk.voucher_number).trim().slice(0,160);
  const description=String(input?.journal_description||brk.description).trim().slice(0,1000);
  if(!voucherNumber)throw new Error('Nomor bukti jurnal wajib diisi.');
  if(!description)throw new Error('Uraian jurnal wajib diisi.');
  db.exec('BEGIN IMMEDIATE');try{const journalId=Number(db.prepare("INSERT INTO accounting_journal_entries(voucher_number,transaction_date,description,amount,transaction_type,legacy_user_id,source) VALUES (?,?,?,?,? ,?,'manual')").run(voucherNumber,invoice.transaction_date,description,0,'Invoice Penjualan',String(user?.username||'')).lastInsertRowid),documentId=Number(db.prepare("INSERT INTO accounting_inventory_documents(document_number,transaction_date,transaction_kind,payment_mode,counter_account_code,description,reference_number,journal_id,created_by,invoice_id) VALUES (?,?, 'sale','receivable',?,?,?, ?,?,?)").run(invoice.invoice_number,invoice.transaction_date,invoice.receivable_account_code,description,invoice.tax_invoice_number,journalId,String(user?.username||''),invoice.id).lastInsertRowid),insert=db.prepare('INSERT INTO accounting_inventory_document_lines(document_id,item_code,quantity,unit_price,total_amount) VALUES (?,?,?,?,?)');for(const line of invoice.lines)insert.run(documentId,line.item_code,line.quantity,line.dpp_amount/line.quantity,line.dpp_amount);rebuildOperationalInventoryFifo();db.prepare("UPDATE accounting_invoices SET journal_id=?,inventory_document_id=?,status='posted',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(journalId,documentId,invoice.id);db.exec('COMMIT');return accountingInvoice(invoice.id);}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function inventoryDocuments(limit=50){return {documents:db.prepare("SELECT d.*,COUNT(l.id) line_count FROM accounting_inventory_documents d LEFT JOIN accounting_inventory_document_lines l ON l.document_id=d.id WHERE d.description<>'__LEGACY_FIFO_OPENING__' GROUP BY d.id ORDER BY d.transaction_date DESC,d.id DESC LIMIT ?").all(Math.max(1,Math.min(Number(limit)||50,200)))};}
function accountingStockHistory(input={}){const start=String(input.start||''),end=String(input.end||''),kind=String(input.kind||''),search=String(input.search||'').trim().toLocaleLowerCase('id-ID'),limit=Math.max(1,Math.min(Number(input.limit)||100,200)),offset=Math.max(0,Number(input.offset)||0),legacy=db.prepare(`SELECT 'legacy:'||h.voucher_number id,h.voucher_number document_number,h.transaction_date,CASE WHEN h.transaction_type=3 THEN 'purchase' ELSE 'sale' END transaction_kind,COUNT(l.id) line_count,GROUP_CONCAT(DISTINCT l.item_code||' — '||COALESCE(i.item_name,l.item_code)) item_summary FROM accounting_legacy_inventory_transactions h LEFT JOIN accounting_legacy_inventory_lines l ON l.voucher_number=h.voucher_number LEFT JOIN accounting_legacy_items i ON i.item_code=l.item_code GROUP BY h.voucher_number`).all().map(row=>({...row,source:'legacy',editable:false})),current=db.prepare(`SELECT d.id,d.document_number,d.transaction_date,d.transaction_kind,COUNT(l.id) line_count,GROUP_CONCAT(DISTINCT l.item_code||' — '||COALESCE(COALESCE(i.item_name,n.item_name),l.item_code)) item_summary FROM accounting_inventory_documents d LEFT JOIN accounting_inventory_document_lines l ON l.document_id=d.id LEFT JOIN accounting_legacy_items i ON i.item_code=l.item_code LEFT JOIN accounting_items n ON n.item_code=l.item_code WHERE d.description<>'__LEGACY_FIFO_OPENING__' GROUP BY d.id`).all().map(row=>({...row,source:'manual',editable:true})),documents=[...legacy,...current].filter(row=>(!start||row.transaction_date>=start)&&(!end||row.transaction_date<=end)&&(!kind||row.transaction_kind===kind)&&(!search||[row.document_number,row.item_summary].some(value=>String(value||'').toLocaleLowerCase('id-ID').includes(search)))).sort((a,b)=>String(b.transaction_date).localeCompare(String(a.transaction_date))||String(b.document_number).localeCompare(String(a.document_number)));return {documents:documents.slice(offset,offset+limit),page:{offset,limit,total:documents.length,has_more:offset+limit<documents.length}};}
function accountingStockHistoryDocument(source,id){if(source==='legacy'){const document=db.prepare(`SELECT voucher_number document_number,transaction_date,CASE WHEN transaction_type=3 THEN 'purchase' ELSE 'sale' END transaction_kind,description,supplier_code,total_amount,total_purchase FROM accounting_legacy_inventory_transactions WHERE voucher_number=?`).get(id);if(!document)throw new Error('Riwayat stok historis tidak ditemukan.');document.source='legacy';document.lines=db.prepare(`SELECT l.item_code,COALESCE(i.item_name,l.item_code) item_name,l.quantity,l.unit_price,l.total FROM accounting_legacy_inventory_lines l LEFT JOIN accounting_legacy_items i ON i.item_code=l.item_code WHERE l.voucher_number=? ORDER BY l.id`).all(id).map(row=>({...row,quantity:Number(row.quantity),unit_price:Number(row.unit_price),total_amount:Number(row.total)}));return document;}if(source==='manual'){const document=accountingInventoryDocument(Number(id));document.source='manual';document.lines=document.lines.map(line=>({...line,item_name:db.prepare("SELECT COALESCE((SELECT item_name FROM accounting_legacy_items WHERE item_code=?),(SELECT item_name FROM accounting_items WHERE item_code=?),?) item_name").get(line.item_code,line.item_code,line.item_code).item_name}));return document;}throw new Error('Sumber riwayat stok tidak valid.');}
function isLegacyStockOpening(row){return Number(row.transaction_type)===3&&/^\d{4}-01-01$/.test(String(row.transaction_date||''))&&/(?:^|\/)SA(?:_|\/|\b)/i.test(String(row.voucher_number||''));}
function accountingStockCard(start='',end='',itemCode=''){
  const items=db.prepare(`SELECT i.item_code,i.item_name FROM accounting_legacy_items i WHERE EXISTS(SELECT 1 FROM accounting_legacy_inventory_lines l WHERE l.item_code=i.item_code) UNION SELECT item_code,item_name FROM accounting_items ORDER BY item_code`).all();
  const selected=String(itemCode||items[0]?.item_code||'');
  if(!selected)return {start,end,items:[],item:null,opening:{quantity:0,value:0},movements:[],closing:{quantity:0,value:0}};
  const item=items.find(row=>row.item_code===selected)||{item_code:selected,item_name:selected};
  const legacy=db.prepare(`SELECT h.transaction_date,h.voucher_number,h.transaction_type,h.description journal_description,l.quantity,l.unit_price,l.total FROM accounting_legacy_inventory_lines l JOIN accounting_legacy_inventory_transactions h ON h.voucher_number=l.voucher_number WHERE l.item_code=? AND (?='' OR h.transaction_date<=?)`).all(selected,end,end).map(row=>({...row,quantity:Number(row.quantity),unit_price:Number(row.unit_price),total:Number(row.total),purchase:Number(row.transaction_type)===3}));
  const operational=db.prepare(`SELECT d.transaction_date,d.document_number voucher_number,d.transaction_kind,d.description journal_description,l.quantity,l.unit_price,l.total_amount,COALESCE((SELECT SUM(a.quantity*a.unit_cost) FROM accounting_inventory_fifo_allocations a WHERE a.issue_line_id=l.id),0) fifo_cost FROM accounting_inventory_document_lines l JOIN accounting_inventory_documents d ON d.id=l.document_id WHERE l.item_code=? AND (?='' OR d.transaction_date<=?)`).all(selected,end,end).map(row=>{const purchase=['purchase','adjustment_in'].includes(row.transaction_kind);return {transaction_date:row.transaction_date,voucher_number:row.voucher_number,transaction_type:purchase?3:1,journal_description:row.journal_description,quantity:Number(row.quantity),unit_price:Number(row.unit_price),total:purchase?Number(row.total_amount):Number(row.fifo_cost),purchase};});
  const rows=[...legacy,...operational].sort((a,b)=>a.transaction_date.localeCompare(b.transaction_date)||a.voucher_number.localeCompare(b.voucher_number));
  const startsNewStockYear=/^\d{4}-01-01$/.test(String(start||''));
  let openingQuantity=0,openingValue=0,runningQuantity=0,runningValue=0;
  const movements=[];
  for(const row of rows){
    const quantity=row.purchase?row.quantity:-row.quantity,value=row.purchase?row.total:-row.total;
    // Kartu stok tahunan berdiri sendiri: tidak membawa saldo atau FIFO tahun lalu.
    // Jurnal SA pada 1 Januari tetap masuk sebagai mutasi supaya penjualan tahun ini
    // memiliki sumber stok, tetapi bukan lagi bagian dari saldo awal.
    if(startsNewStockYear&&row.transaction_date<start)continue;
    if(start&&row.transaction_date<start){openingQuantity+=quantity;openingValue+=value;continue;}
    runningQuantity+=quantity;runningValue+=value;
    movements.push({...row,kind:row.purchase?'purchase':'sale',purchase_quantity:row.purchase?row.quantity:0,purchase_value:row.purchase?row.total:0,sale_quantity:row.purchase?0:row.quantity,sale_value:row.purchase?0:row.total,balance_quantity:openingQuantity+runningQuantity,balance_value:openingValue+runningValue});
  }
  return {start,end,items,item,opening:{quantity:openingQuantity,value:openingValue},movements,closing:{quantity:openingQuantity+runningQuantity,value:openingValue+runningValue}};
}
function accountingExportExcel(kind,start='',end='',accountCode='',itemCode=''){const period=start||end?`${start||'Awal data'} s.d. ${end||'Akhir data'}`:'Semua periode',params=[start,start,end,end],base={period,currency_columns:[],headers:[],rows:[],title:'LAPORAN INPUT ADMIN ACCOUNTING',sheet_name:'Laporan'};if(kind==='journals'){base.title='JURNAL TRANSAKSI';base.sheet_name='Jurnal Transaksi';base.headers=['Tanggal','No. Bukti','Uraian','Jenis','Debit','Kredit'];base.currency_columns=[5,6];base.rows=db.prepare(`SELECT j.transaction_date,j.voucher_number,j.description,j.transaction_type,coalesce(sum(l.debit),0) debit,coalesce(sum(l.credit),0) credit FROM accounting_journal_entries j LEFT JOIN accounting_journal_lines l ON l.journal_id=j.id WHERE (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?) GROUP BY j.id ORDER BY j.transaction_date,j.id`).all(...params).map(row=>[row.transaction_date,row.voucher_number,row.description,row.transaction_type,Number(row.debit),Number(row.credit)]);}else if(kind==='general'){base.title='JURNAL UMUM';base.sheet_name='Jurnal Umum';base.headers=['Tanggal','No. Bukti','Nama Rekening','No. Rekening','Keterangan','Debit','Kredit'];base.currency_columns=[6,7];base.rows=db.prepare(`SELECT j.transaction_date,j.voucher_number,a.account_name,a.account_code,coalesce(l.description,j.description) description,l.debit,l.credit FROM accounting_journal_entries j JOIN accounting_journal_lines l ON l.journal_id=j.id JOIN accounting_accounts a ON a.account_code=l.account_code WHERE (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?) ORDER BY j.transaction_date,j.id,l.id`).all(...params).map(row=>[row.transaction_date,row.voucher_number,row.account_name,row.account_code,row.description,Number(row.debit),Number(row.credit)]);}else if(kind==='ledger'){if(!accountCode)throw new Error('Pilih rekening terlebih dahulu.');const ledger=accountingLedger(accountCode,start,end),sourceColumns=ledger.aggregate?['Kode rekening sumber','Nama rekening sumber']:[],sourceRow=row=>ledger.aggregate?[row.account_code,row.account_name]:[];base.title=`BUKU BESAR ${ledger.account.account_code}`;base.sheet_name='Buku Besar';base.headers=['Tanggal','No. Bukti',...sourceColumns,'Uraian','Debit','Kredit','Saldo'];base.currency_columns=ledger.aggregate?[6,7,8]:[4,5,6];base.rows=[['','',...sourceRow({account_code:'',account_name:''}),'Saldo awal',0,0,ledger.opening_balance],...ledger.rows.map(row=>[row.transaction_date,row.voucher_number,...sourceRow(row),row.description||row.journal_description,Number(row.debit),Number(row.credit),Number(row.balance)])];}else if(kind==='trial'||kind==='income'||kind==='balance'||kind==='hpp'||kind==='adjusted'){const report=kind==='trial'?accountingTrialBalance(start,end):kind==='income'?accountingReport('income_statement',start,end):kind==='balance'?accountingReport('balance_sheet',start,end):kind==='hpp'?accountingHpp(start,end):accountingAdjustedTrialBalance(start,end),title={trial:'NERACA SALDO',income:'LAPORAN LABA RUGI',balance:'NERACA',hpp:'HARGA POKOK PENJUALAN',adjusted:'NERACA SALDO PENYESUAIAN'}[kind],rows=report.accounts||[];base.title=title;base.sheet_name=title.slice(0,31);base.headers=kind==='trial'||kind==='adjusted'?['Kode Rekening','Nama Rekening','Debit','Kredit']:['Kode Rekening','Nama Rekening','Saldo'];base.currency_columns=kind==='trial'||kind==='adjusted'?[3,4]:[3];base.rows=rows.map(row=>kind==='trial'||kind==='adjusted'?[row.account_code,row.account_name,Number(row.debit),Number(row.credit)]:[row.account_code,row.account_name,Number(row.balance)]);}else if(kind==='subsidiary'){base.title='BUKU BESAR PEMBANTU';base.sheet_name='Buku Besar Pembantu';base.headers=['Tanggal','Rekening','No. Bukti','Pihak / Keterangan','Debit','Kredit'];base.currency_columns=[5,6];base.rows=db.prepare(`SELECT j.transaction_date,a.account_name,j.voucher_number,coalesce(l.description,j.description) party,l.debit,l.credit FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id JOIN accounting_accounts a ON a.account_code=l.account_code WHERE (lower(a.account_name) LIKE '%piutang%' OR lower(a.account_name) LIKE '%hutang%') AND (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?) ORDER BY a.account_code,j.transaction_date,j.id,l.id`).all(...params).map(row=>[row.transaction_date,row.account_name,row.voucher_number,row.party,Number(row.debit),Number(row.credit)]);}else if(kind==='account-list'){base.title='DAFTAR REKENING';base.sheet_name='DAFTAR REKENING';base.headers=['Kode','Nama Rekening','Kelompok','Status'];base.rows=accountingAccountList().accounts.map(row=>[row.account_code,row.account_name,row.account_type,row.is_posting?'Posting':'Induk']);}else if(kind==='stock'){const card=accountingStockCard(start,end,itemCode);if(!card.item)throw new Error('Pilih barang terlebih dahulu.');base.title=`KARTU STOK ${card.item.item_code}`;base.sheet_name='Kartu Stok';base.headers=['Tanggal','No. Bukti','Beli Unit','Beli Nilai','Jual Unit','Jual Nilai','Saldo Unit','Saldo Nilai'];base.currency_columns=[4,6,8];base.rows=[['','','','','','',Number(card.opening.quantity),Number(card.opening.value)],...card.movements.map(row=>[row.transaction_date,row.voucher_number,Number(row.purchase_quantity)||0,Number(row.purchase_value)||0,Number(row.sale_quantity)||0,Number(row.sale_value)||0,Number(row.balance_quantity)||0,Number(row.balance_value)||0])];}else throw new Error('Jenis laporan tidak valid.');const source=join(tmpdir(),`cap-accounting-export-${randomUUID()}.json`),output=join(tmpdir(),`cap-accounting-export-${randomUUID()}.xlsx`);try{writeFileSync(source,JSON.stringify(base));const result=runPython(join(ROOT,'scripts','export_accounting_lite.py'),[source,output],'openpyxl');if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Excel Accounting Lite tidak dapat dibuat.');return {file:readFileSync(output),name:`${base.sheet_name.toLowerCase().replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')}-${start||'semua'}-${end||'semua'}.xlsx`};}finally{if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);}}
function accountingItems(){return {items:db.prepare(`SELECT item_code,item_name,item_type,debit_sales_code,credit_sales_code,debit_purchase_code,credit_purchase_code,description,'legacy' source FROM accounting_legacy_items UNION ALL SELECT item_code,item_name,item_type,debit_sales_code,credit_sales_code,debit_purchase_code,credit_purchase_code,description,source FROM accounting_items WHERE item_code NOT IN (SELECT item_code FROM accounting_legacy_items) ORDER BY item_code`).all()};}
const baseAccountingStockCard=accountingStockCard;accountingStockCard=(start='',end='',itemCode='')=>{const card=baseAccountingStockCard(start,end,itemCode),seed=row=>String(row.voucher_number||'').startsWith('SYS-FIFO-')&&row.journal_description==='__LEGACY_FIFO_OPENING__',opening={...card.opening},startsNewStockYear=/^\d{4}-01-01$/.test(String(start||'')),hiddenSeed=startsNewStockYear?{quantity:0,value:0}:db.prepare("SELECT COALESCE(SUM(l.quantity),0) quantity,COALESCE(SUM(l.total_amount),0) value FROM accounting_inventory_document_lines l JOIN accounting_inventory_documents d ON d.id=l.document_id WHERE l.item_code=? AND d.description='__LEGACY_FIFO_OPENING__' AND ?<>'' AND d.transaction_date<?").get(card.item?.item_code||'',start,start);opening.quantity-=Number(hiddenSeed.quantity);opening.value-=Number(hiddenSeed.value);let quantity=opening.quantity,value=opening.value;const movements=card.movements.filter(row=>!seed(row)).map(row=>{quantity+=Number(row.purchase_quantity||0)-Number(row.sale_quantity||0);value+=Number(row.purchase_value||0)-Number(row.sale_value||0);return {...row,balance_quantity:quantity,balance_value:value};});return {...card,opening,movements,closing:{quantity,value}};};
function accountingStockLayers(start='',end='',itemCode=''){
  if(!itemCode)return [];
  const startsNewStockYear=/^\d{4}-01-01$/.test(String(start||''));
  const legacy=db.prepare(`SELECT h.transaction_date,h.voucher_number,h.transaction_type,l.id source_id,l.quantity,l.unit_price FROM accounting_legacy_inventory_lines l JOIN accounting_legacy_inventory_transactions h ON h.voucher_number=l.voucher_number WHERE l.item_code=? AND (?='' OR h.transaction_date<=?)`).all(itemCode,end,end).map(row=>({...row,purchase:Number(row.transaction_type)===3}));
  const operational=db.prepare(`SELECT d.transaction_date,d.document_number voucher_number,d.transaction_kind,l.id source_id,l.quantity,l.unit_price FROM accounting_inventory_document_lines l JOIN accounting_inventory_documents d ON d.id=l.document_id WHERE l.item_code=? AND d.description<>'__LEGACY_FIFO_OPENING__' AND (?='' OR d.transaction_date<=?)`).all(itemCode,end,end).map(row=>({...row,purchase:['purchase','adjustment_in'].includes(row.transaction_kind)}));
  const layers=[];
  for(const row of [...legacy,...operational].filter(row=>!startsNewStockYear||row.transaction_date>=start).sort((a,b)=>a.transaction_date.localeCompare(b.transaction_date)||String(a.voucher_number).localeCompare(String(b.voucher_number))||a.source_id-b.source_id)){
    let quantity=Number(row.quantity);
    if(row.purchase){
      if(isLegacyStockOpening(row))layers.length=0;
      layers.push({transaction_date:row.transaction_date,voucher_number:row.voucher_number,quantity,unit_price:Number(row.unit_price),remaining:quantity});
      continue;
    }
    for(const layer of layers){if(quantity<=0.000001)break;const taken=Math.min(quantity,layer.remaining);layer.remaining-=taken;quantity-=taken;}
  }
  return layers.filter(layer=>layer.remaining>0.000001).map(layer=>({transaction_date:layer.transaction_date,voucher_number:layer.voucher_number,quantity:layer.remaining,unit_price:layer.unit_price,total:layer.remaining*layer.unit_price}));
}
function accountingStockSummary(start='',end=''){
  // Do not call accountingStockCard/accountingStockLayers once per item here.
  // A full catalogue can contain thousands of items, which turns the report into
  // thousands of SQLite queries and leaves the browser at "Memuat laporan…".
  // Read each source once, then build the per-item FIFO state in memory.
  const items=accountingItems().items;
  const state=new Map(items.map(item=>[item.item_code,{...item,quantity:0,value:0,layers:[],events:[]}]));
  const include=row=>!end||row.transaction_date<=end;
  const startsNewStockYear=/^\d{4}-01-01$/.test(String(start||''));
  const legacy=db.prepare(`SELECT l.item_code,h.transaction_date,h.voucher_number,h.transaction_type,l.id source_id,l.quantity,l.unit_price,l.total
    FROM accounting_legacy_inventory_lines l JOIN accounting_legacy_inventory_transactions h ON h.voucher_number=l.voucher_number
    WHERE (?='' OR h.transaction_date<=?)`).all(end,end).map(row=>({...row,source:'legacy',purchase:Number(row.transaction_type)===3,value:Number(row.total)||0}));
  const operational=db.prepare(`SELECT l.item_code,d.transaction_date,d.document_number voucher_number,d.transaction_kind,l.id source_id,l.quantity,l.unit_price,l.total_amount,
    COALESCE((SELECT SUM(a.quantity*a.unit_cost) FROM accounting_inventory_fifo_allocations a WHERE a.issue_line_id=l.id),0) fifo_cost
    FROM accounting_inventory_document_lines l JOIN accounting_inventory_documents d ON d.id=l.document_id
    WHERE d.description<>'__LEGACY_FIFO_OPENING__' AND (?='' OR d.transaction_date<=?)`).all(end,end).map(row=>{
      const purchase=['purchase','adjustment_in'].includes(row.transaction_kind);
      return {...row,source:'operational',purchase,value:purchase?(Number(row.total_amount)||0):(Number(row.fifo_cost)||0)};
    });
  for(const event of [...legacy,...operational])if(include(event)&&state.has(event.item_code))state.get(event.item_code).events.push(event);
  const rows=[];
  for(const item of items){
    const entry=state.get(item.item_code);
    for(const event of entry.events.sort((a,b)=>String(a.transaction_date).localeCompare(String(b.transaction_date))||String(a.voucher_number).localeCompare(String(b.voucher_number))||Number(a.source_id)-Number(b.source_id))){
      if(startsNewStockYear&&event.transaction_date<start)continue;
      const signedQuantity=event.purchase?Number(event.quantity)||0:-(Number(event.quantity)||0);
      const signedValue=event.purchase?Number(event.value)||0:-(Number(event.value)||0);
      entry.quantity+=signedQuantity;
      entry.value+=signedValue;
      let quantity=Number(event.quantity)||0;
      if(event.purchase){
        if(event.source==='legacy'&&isLegacyStockOpening(event))entry.layers=[];
        entry.layers.push({transaction_date:event.transaction_date,voucher_number:event.voucher_number,quantity,unit_price:Number(event.unit_price)||0,remaining:quantity});
      }else for(const layer of entry.layers){
        if(quantity<=0.000001)break;
        const taken=Math.min(quantity,layer.remaining);
        layer.remaining-=taken;
        quantity-=taken;
      }
    }
    const layers=entry.layers.filter(layer=>layer.remaining>0.000001).map(layer=>({transaction_date:layer.transaction_date,voucher_number:layer.voucher_number,quantity:layer.remaining,unit_price:layer.unit_price,total:layer.remaining*layer.unit_price}));
    rows.push({item_code:item.item_code,item_name:item.item_name,item_type:item.item_type,debit_purchase_code:item.debit_purchase_code||'',quantity:entry.quantity,value:entry.value,layers});
  }
  const totals=rows.reduce((sum,row)=>({quantity:sum.quantity+Number(row.quantity||0),value:sum.value+Number(row.value||0)}),{quantity:0,value:0});
  return {start,end,items:rows,totals};
}
function accountingStockReference(itemCode=''){const code=String(itemCode||''),layers=accountingStockLayers('','',code),total=layers.reduce((sum,row)=>({quantity:sum.quantity+Number(row.quantity||0),value:sum.value+Number(row.total||0)}),{quantity:0,value:0}),oldest=layers[0]||null,legacyReceipts=db.prepare('SELECT h.transaction_date,h.voucher_number,l.id source_id,l.quantity,l.unit_price FROM accounting_legacy_inventory_lines l JOIN accounting_legacy_inventory_transactions h ON h.voucher_number=l.voucher_number WHERE l.item_code=? AND h.transaction_type=3').all(code),operationalReceipts=db.prepare("SELECT d.transaction_date,d.document_number voucher_number,l.id source_id,l.quantity,l.unit_price FROM accounting_inventory_document_lines l JOIN accounting_inventory_documents d ON d.id=l.document_id WHERE l.item_code=? AND d.transaction_kind='purchase' AND d.description<>'__LEGACY_FIFO_OPENING__'").all(code),latest_receipt=[...legacyReceipts,...operationalReceipts].sort((a,b)=>String(b.transaction_date).localeCompare(String(a.transaction_date))||Number(b.source_id)-Number(a.source_id))[0]||null;return {item_code:code,oldest,total,latest_receipt:latest_receipt?{transaction_date:latest_receipt.transaction_date,voucher_number:latest_receipt.voucher_number,quantity:Number(latest_receipt.quantity),unit_price:Number(latest_receipt.unit_price)}:null};}
const stockCardWithBalanceFix=accountingStockCard;accountingStockCard=(start='',end='',itemCode='')=>{const card=stockCardWithBalanceFix(start,end,itemCode);return {...card,stock_layers:accountingStockLayers(start,end,card.item?.item_code||'')};};
const baseAccountingExportExcel=accountingExportExcel;accountingExportExcel=(kind,start='',end='',accountCode='',itemCode='')=>{if(kind!=='stock')return baseAccountingExportExcel(kind,start,end,accountCode,itemCode);const card=accountingStockCard(start,end,itemCode);if(!card.item)throw new Error('Pilih barang terlebih dahulu.');const base={period:start||end?`${start||'Awal data'} s.d. ${end||'Akhir data'}`:'Semua periode',currency_columns:[4,6,8],headers:['Tanggal','No. Bukti','Beli Unit','Beli Nilai','Jual Unit','Jual Nilai','Saldo Unit','Saldo Nilai'],rows:[['','','','','','',Number(card.opening.quantity),Number(card.opening.value)],...card.movements.map(row=>[row.transaction_date,row.voucher_number,Number(row.purchase_quantity)||0,Number(row.purchase_value)||0,Number(row.sale_quantity)||0,Number(row.sale_value)||0,Number(row.balance_quantity)||0,Number(row.balance_value)||0])],stock_layers:(card.stock_layers||[]).map((row,index)=>[index+1,row.transaction_date,row.quantity,row.unit_price,row.total]),title:`KARTU STOK ${card.item.item_code}`,sheet_name:'Kartu Stok'};const source=join(tmpdir(),`cap-accounting-export-${randomUUID()}.json`),output=join(tmpdir(),`cap-accounting-export-${randomUUID()}.xlsx`);try{writeFileSync(source,JSON.stringify(base));const result=runPython(join(ROOT,'scripts','export_accounting_lite.py'),[source,output],'openpyxl');if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Excel Kartu Stok tidak dapat dibuat.');return {file:readFileSync(output),name:`kartu-stok-${card.item.item_code}-${start||'semua'}-${end||'semua'}.xlsx`};}finally{if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);}};
const accountingExportExcelWithStock=accountingExportExcel;
accountingExportExcel=(kind,start='',end='',accountCode='',itemCode='')=>{
  if(kind!=='stock-summary')return accountingExportExcelWithStock(kind,start,end,accountCode,itemCode);
  const summary=accountingStockSummary(start,end);
  const base={period:start||end?`${start||'Awal data'} s.d. ${end||'Akhir data'}`:'Semua periode',currency_columns:[8,9],headers:['Kode Barang','Nama Barang','Jenis','Baris','Tanggal Masuk','No. Bukti','Unit','Harga Satuan','Nilai'],rows:summary.items.flatMap(item=>[[item.item_code,item.item_name,item.item_type||'—','Subtotal','','',Number(item.quantity),null,Number(item.value)],...item.layers.map(layer=>[item.item_code,item.item_name,item.item_type||'—','Lapisan FIFO',layer.transaction_date,layer.voucher_number,Number(layer.quantity),Number(layer.unit_price),Number(layer.total)])]),title:'DAFTAR STOK DAN HARGA',sheet_name:'Stok dan Harga'};
  base.rows.push(['','','','TOTAL','','',Number(summary.totals.quantity),null,Number(summary.totals.value)]);
  const source=join(tmpdir(),`cap-accounting-export-${randomUUID()}.json`),output=join(tmpdir(),`cap-accounting-export-${randomUUID()}.xlsx`);
  try{writeFileSync(source,JSON.stringify(base));const result=runPython(join(ROOT,'scripts','export_accounting_lite.py'),[source,output],'openpyxl');if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Excel Daftar Stok dan Harga tidak dapat dibuat.');return {file:readFileSync(output),name:`daftar-stok-dan-harga-${start||'semua'}-${end||'semua'}.xlsx`};}finally{if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);}
};
const accountingExportExcelWithStockSummary=accountingExportExcel;
function exportAccountingWorkbookWithNote(base){const source=join(tmpdir(),`cap-accounting-export-${randomUUID()}.json`),output=join(tmpdir(),`cap-accounting-export-${randomUUID()}.xlsx`);try{writeFileSync(source,JSON.stringify(base));const result=runPython(join(ROOT,'scripts','export_accounting_lite.py'),[source,output],'openpyxl');if(result.error)throw result.error;if(result.status!==0)throw new Error(result.stderr||'Excel Accounting Lite tidak dapat dibuat.');return {file:readFileSync(output),name:`${base.sheet_name.toLowerCase().replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')}-${base.start||'semua'}-${base.end||'semua'}.xlsx`};}finally{if(existsSync(source))unlinkSync(source);if(existsSync(output))unlinkSync(output);}}
accountingExportExcel=(kind,start='',end='',accountCode='',itemCode='')=>{
  if(!['ledger','income','balance','hpp'].includes(kind))return accountingExportExcelWithStockSummary(kind,start,end,accountCode,itemCode);
  const period=start||end?`${start||'Awal data'} s.d. ${end||'Akhir data'}`:'Semua periode',signedNote='Tanda positif atau negatif adalah hasil perhitungan laporan dan bukan penanda sisi Debit atau Kredit.';
  if(kind==='balance'){
    const report=accountingBalanceReport(start,end),unmapped=(report.unmapped||[]).filter(row=>Math.abs(Number(row.balance||0))>0.0001),rows=[...report.sections.flatMap(section=>[[section.name,'',''],...(section.accounts||[]).map(row=>[row.account_code||'—',row.account_name,Number(row.display_balance??row.balance)]),['Jumlah '+section.name,'',Number(section.display_total??section.total)]]),...(unmapped.length?[['Rekening Neraca belum dipetakan','',''],...unmapped.map(row=>[row.account_code,row.account_name,Number(row.display_balance??row.balance)])]:[])],title='NERACA';
    return exportAccountingWorkbookWithNote({start,end,period,note:'Saldo rekening anak dialokasikan satu kali ke rekening pelaporan terdekat sesuai pemetaan Neraca.',title,sheet_name:title,headers:['Kode Rekening','Nama Rekening','Saldo'],currency_columns:[3],rows});
  }
  if(kind==='ledger'){
    if(!accountCode)throw new Error('Pilih rekening terlebih dahulu.');
    const ledger=accountingLedger(accountCode,start,end),sourceColumns=ledger.aggregate?['Kode rekening sumber','Nama rekening sumber']:[],sourceRow=row=>ledger.aggregate?[row.account_code,row.account_name]:[];
    const note=`Saldo berjalan memakai sisi ${ledger.opening_side} dari ${ledger.basis_source} sebagai dasar. Nilai minus berarti mutasi lawan telah melampaui saldo dasar, bukan penanda sisi Debit atau Kredit.`;
    return exportAccountingWorkbookWithNote({start,end,period,note,title:`BUKU BESAR ${ledger.account.account_code}`,sheet_name:'Buku Besar',headers:['Tanggal','No. Bukti',...sourceColumns,'Uraian','Debit','Kredit','Saldo'],currency_columns:ledger.aggregate?[6,7,8]:[4,5,6],rows:[['','',...sourceRow({account_code:'',account_name:''}),'Saldo awal',0,0,Number(ledger.opening_display_balance)],...ledger.rows.map(row=>[row.transaction_date,row.voucher_number,...sourceRow(row),row.description||row.journal_description,Number(row.debit),Number(row.credit),Number(row.display_balance)])]});
  }
  const report=kind==='income'?accountingIncomeReport(start,end):accountingHpp(start,end),title={income:'LAPORAN LABA RUGI',hpp:'HARGA POKOK PENJUALAN'}[kind],visibleAmount=value=>Math.abs(Number(value||0));
  const rows=kind==='income'?[...(report.sections||[]).flatMap(section=>[[section.name,'',''],...(section.accounts||[]).map(row=>[row.account_code,row.account_name,visibleAmount(row.balance)]),['Jumlah '+section.name,'',visibleAmount(section.total)]]),...((report.unmapped||[]).length?[['Rekening Laba Rugi belum dipetakan','',''],...(report.unmapped||[]).map(row=>[row.account_code,row.account_name,visibleAmount(row.balance)])]:[])]:((report.accounts||[]).map(row=>[row.account_code,row.account_name,Number(row.balance)]));
  return exportAccountingWorkbookWithNote({start,end,period,note:kind==='income'?'Pemetaan rekening Laba Rugi mengikuti pengaturan yang tersimpan. Nominal ditampilkan tanpa tanda minus; pengurangan pendapatan, HPP, dan beban tetap dihitung oleh logika laporan.':signedNote,title,sheet_name:title.slice(0,31),headers:['Kode Rekening','Nama Rekening','Saldo'],currency_columns:[3],rows});
};
// Keep the description before the document number in journal-oriented exports.
// This is deliberately implemented here (rather than only in the browser) so
// the downloaded workbook always matches the visible report.
const accountingExportExcelWithDescriptionFirst=accountingExportExcel;
accountingExportExcel=(kind,start='',end='',accountCode='',itemCode='')=>{
  const period=start||end?`${start||'Awal data'} s.d. ${end||'Akhir data'}`:'Semua periode';
  if(kind==='journals'){
    const params=[String(start||''),String(start||''),String(end||''),String(end||'')];
    const rows=db.prepare(`SELECT j.*,coalesce(SUM(l.debit),0) debit_total,coalesce(SUM(l.credit),0) credit_total FROM accounting_journal_entries j LEFT JOIN accounting_journal_lines l ON l.journal_id=j.id WHERE (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?) GROUP BY j.id ORDER BY j.transaction_date DESC,j.id DESC`).all(...params);
    return exportAccountingWorkbookWithNote({start,end,period,title:'JURNAL TRANSAKSI',sheet_name:'Jurnal Transaksi',headers:['Tanggal','Uraian','Nomor Bukti','Jenis','Debit','Kredit'],currency_columns:[5,6],rows:rows.map(row=>[row.transaction_date,row.description||'',row.voucher_number,row.transaction_type,Number(row.debit_total),Number(row.credit_total)])});
  }
  if(kind==='ledger'){
    if(!accountCode)throw new Error('Pilih rekening terlebih dahulu.');
    const ledger=accountingLedger(accountCode,start,end),sourceColumns=ledger.aggregate?['Kode rekening sumber','Nama rekening sumber']:[],sourceRow=row=>ledger.aggregate?[row.account_code,row.account_name]:[];
    const note=`Saldo berjalan memakai sisi ${ledger.opening_side} dari ${ledger.basis_source} sebagai dasar. Nilai minus berarti mutasi lawan telah melampaui saldo dasar, bukan penanda sisi Debit atau Kredit.`;
    return exportAccountingWorkbookWithNote({start,end,period,note,title:`BUKU BESAR ${ledger.account.account_code}`,sheet_name:'Buku Besar',headers:['Tanggal','Uraian','Nomor Bukti',...sourceColumns,'Debit','Kredit','Saldo'],currency_columns:ledger.aggregate?[6,7,8]:[4,5,6],rows:[['','Saldo awal','',...sourceRow({account_code:'',account_name:''}),0,0,Number(ledger.opening_display_balance)],...ledger.rows.map(row=>[row.transaction_date,row.description||row.journal_description,row.voucher_number,...sourceRow(row),Number(row.debit),Number(row.credit),Number(row.display_balance)])]});
  }
  return accountingExportExcelWithDescriptionFirst(kind,start,end,accountCode,itemCode);
};
const accountingExportExcelWithDebitCreditMarker=accountingExportExcel;
accountingExportExcel=(kind,start='',end='',accountCode='',itemCode='')=>{
  const period=start||end?`${start||'Awal data'} s.d. ${end||'Akhir data'}`:'Semua periode',marker=(debit,credit)=>Number(debit)>0&&Number(credit)===0?'D':Number(credit)>0&&Number(debit)===0?'K':'';
  if(kind==='ledger'){
    if(!accountCode)throw new Error('Pilih rekening terlebih dahulu.');
    const ledger=accountingLedger(accountCode,start,end),sourceColumns=ledger.aggregate?['Kode rekening sumber','Nama rekening sumber']:[],sourceRow=row=>ledger.aggregate?[row.account_code,row.account_name]:[];
    const note=`Saldo berjalan memakai sisi ${ledger.opening_side} dari ${ledger.basis_source} sebagai dasar. Nilai minus berarti mutasi lawan telah melampaui saldo dasar, bukan penanda sisi Debit atau Kredit.`;
    return exportAccountingWorkbookWithNote({start,end,period,note,account_code:ledger.account.account_code,title:`BUKU BESAR — ${ledger.account.account_name}`,sheet_name:'Buku Besar',headers:['Tanggal','Uraian','Nomor Bukti',...sourceColumns,'Debit','Kredit','D/K','Saldo'],currency_columns:ledger.aggregate?[6,7,9]:[4,5,7],rows:[['','Saldo awal','',...sourceRow({account_code:'',account_name:''}),0,0,'',Number(ledger.opening_display_balance)],...ledger.rows.map(row=>[row.transaction_date,row.description||row.journal_description,row.voucher_number,...sourceRow(row),Number(row.debit),Number(row.credit),marker(row.debit,row.credit),Number(row.display_balance)])]});
  }
  if(kind==='general'){
    const params=[String(start||''),String(start||''),String(end||''),String(end||'')],rows=db.prepare(`SELECT j.transaction_date,j.voucher_number,a.account_name,a.account_code,coalesce(l.description,j.description) description,l.debit,l.credit FROM accounting_journal_entries j JOIN accounting_journal_lines l ON l.journal_id=j.id JOIN accounting_accounts a ON a.account_code=l.account_code WHERE (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?) ORDER BY j.transaction_date,j.id,l.id`).all(...params);
    return exportAccountingWorkbookWithNote({start,end,period,title:'JURNAL UMUM',sheet_name:'Jurnal Umum',headers:['Tanggal','No. Bukti','Nama Rekening','No. Rekening','Keterangan','Debit','Kredit','D/K'],currency_columns:[6,7],rows:rows.map(row=>[row.transaction_date,row.voucher_number,row.account_name,row.account_code,row.description,Number(row.debit),Number(row.credit),marker(row.debit,row.credit)])});
  }
  if(kind==='subsidiary'){
    const params=[String(start||''),String(start||''),String(end||''),String(end||'')],rows=db.prepare(`SELECT j.transaction_date,a.account_name,j.voucher_number,coalesce(l.description,j.description) party,l.debit,l.credit FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id JOIN accounting_accounts a ON a.account_code=l.account_code WHERE (lower(a.account_name) LIKE '%piutang%' OR lower(a.account_name) LIKE '%hutang%') AND (?='' OR j.transaction_date>=?) AND (?='' OR j.transaction_date<=?) ORDER BY a.account_code,j.transaction_date,j.id,l.id`).all(...params);
    return exportAccountingWorkbookWithNote({start,end,period,title:'BUKU BESAR PEMBANTU',sheet_name:'Buku Besar Pembantu',headers:['Tanggal','Rekening','No. Bukti','Pihak / Keterangan','Debit','Kredit','D/K'],currency_columns:[5,6],rows:rows.map(row=>[row.transaction_date,row.account_name,row.voucher_number,row.party,Number(row.debit),Number(row.credit),marker(row.debit,row.credit)])});
  }
  return accountingExportExcelWithDebitCreditMarker(kind,start,end,accountCode,itemCode);
};
const accountingExportExcelWithSubsidiaryLedger=accountingExportExcel;
accountingExportExcel=(kind,start='',end='',accountCode='',itemCode='')=>{if(kind!=='subsidiary')return accountingExportExcelWithSubsidiaryLedger(kind,start,end,accountCode,itemCode);if(!accountCode)throw new Error('Pilih rekening Piutang atau Hutang terlebih dahulu.');const ledger=accountingSubsidiaryLedger(start,end,0,0,'',accountCode),sourceColumns=ledger.aggregate?['Kode rekening sumber','Nama rekening sumber']:[],sourceRow=row=>ledger.aggregate?[row.account_code,row.account_name]:[],marker=(debit,credit)=>Number(debit)>0&&Number(credit)===0?'D':Number(credit)>0&&Number(debit)===0?'K':'',period=start||end?`${start||'Awal data'} s.d. ${end||'Akhir data'}`:'Semua periode',note=`Buku Besar Pembantu untuk rekening ${ledger.kind}. Saldo memakai logika Buku Besar rekening yang dipilih.`;return exportAccountingWorkbookWithNote({start,end,period,note,account_code:ledger.account.account_code,title:`BUKU BESAR PEMBANTU — ${ledger.account.account_name}`,sheet_name:'Buku Besar Pembantu',headers:['Jenis','Tanggal','Uraian','Nomor Bukti',...sourceColumns,'Debit','Kredit','D/K','Saldo'],currency_columns:ledger.aggregate?[7,8,10]:[5,6,8],rows:[[ledger.kind,'','Saldo awal','',...sourceRow({account_code:'',account_name:''}),0,0,'',Number(ledger.opening_display_balance)],...ledger.rows.map(row=>[ledger.kind,row.transaction_date,row.description||row.journal_description,row.voucher_number,...sourceRow(row),Number(row.debit),Number(row.credit),marker(row.debit,row.credit),Number(row.display_balance)])]});};
const accountingExportExcelWithHppStatement=accountingExportExcel;
accountingExportExcel=(kind,start='',end='',accountCode='',itemCode='')=>{
  if(kind!=='hpp')return accountingExportExcelWithHppStatement(kind,start,end,accountCode,itemCode);
  const report=accountingHpp(start,end),period=start||end?`${start||'Awal data'} s.d. ${end||'Akhir data'}`:'Semua periode',rows=[];let number=0;
  for(const section of report.rows||[]){const subtotal=key=>(section.rows||[]).reduce((sum,row)=>sum+Number(row[key]||0),0);rows.push(['','',section.label,Number(subtotal('previous')),Number(subtotal('current')),Number(subtotal('ytd'))]);for(const row of section.rows||[]){number++;rows.push([number,row.account_code,row.account_name,Number(row.previous||0),Number(row.current||0),Number(row.ytd||0)]);}}
  rows.push(['','', 'HARGA POKOK PENJUALAN',Number(report.totals?.previous||0),Number(report.totals?.current||0),Number(report.totals?.ytd||0)]);
  return exportAccountingWorkbookWithNote({start,end,period,note:'HPP dihitung dari stok awal, pembelian dan biaya perolehan, lalu dikurangi stok akhir pada periode terpilih.',title:'HARGA POKOK PENJUALAN',sheet_name:'HPP',headers:['NO','NO AKUN','URAIAN','S.D BULAN LALU','BULAN INI','S.D BULAN INI'],currency_columns:[4,5,6],rows});
};
function accountingSuppliers(){return {suppliers:db.prepare(`SELECT s.*,COALESCE(m.payable_account_code,'') payable_account_code,COALESCE(a.account_name,'') payable_account_name FROM (
  SELECT supplier_code,supplier_name,address,origin,description,'legacy' source FROM accounting_legacy_suppliers
  UNION ALL
  SELECT supplier_code,supplier_name,address,origin,description,source FROM accounting_suppliers WHERE supplier_code NOT IN (SELECT supplier_code FROM accounting_legacy_suppliers)
) s LEFT JOIN accounting_supplier_payable_mappings m ON m.supplier_code=s.supplier_code LEFT JOIN accounting_accounts a ON a.account_code=m.payable_account_code ORDER BY s.supplier_code`).all()};}
function accountingItem(code){const item=accountingItems().items.find(row=>row.item_code===code);if(!item)throw new Error('Barang tidak ditemukan.');return item;}
function accountingSupplier(code){const supplier=accountingSuppliers().suppliers.find(row=>row.supplier_code===code);if(!supplier)throw new Error('Supplier tidak ditemukan.');return supplier;}
function itemInput(input,current={}){const item_code=String(input.item_code??current.item_code??'').trim().slice(0,80),item_name=String(input.item_name??current.item_name??'').trim().slice(0,255);if(!item_code||!item_name)throw new Error('Kode dan nama barang wajib diisi.');return {item_code,item_name,item_type:String(input.item_type??current.item_type??'').trim().slice(0,100),debit_sales_code:String(input.debit_sales_code??current.debit_sales_code??'').trim().slice(0,80),credit_sales_code:String(input.credit_sales_code??current.credit_sales_code??'').trim().slice(0,80),debit_purchase_code:String(input.debit_purchase_code??current.debit_purchase_code??'').trim().slice(0,80),credit_purchase_code:String(input.credit_purchase_code??current.credit_purchase_code??'').trim().slice(0,80),description:String(input.description??current.description??'').trim().slice(0,2000)};}
function supplierInput(input,current={}){const supplier_code=String(input.supplier_code??current.supplier_code??'').trim().slice(0,80),supplier_name=String(input.supplier_name??current.supplier_name??'').trim().slice(0,255);if(!supplier_code||!supplier_name)throw new Error('Kode dan nama supplier wajib diisi.');return {supplier_code,supplier_name,address:String(input.address??current.address??'').trim().slice(0,1000),origin:String(input.origin??current.origin??'').trim().slice(0,255),description:String(input.description??current.description??'').trim().slice(0,2000)};}
function saveAccountingItem(input){const item=itemInput(input);if(db.prepare('SELECT 1 FROM accounting_legacy_items WHERE item_code=?').get(item.item_code))throw new Error('Kode barang sudah dipakai oleh data historis.');try{db.prepare(`INSERT INTO accounting_items (item_code,item_name,item_type,debit_sales_code,credit_sales_code,debit_purchase_code,credit_purchase_code,description) VALUES (?,?,?,?,?,?,?,?)`).run(item.item_code,item.item_name,item.item_type,item.debit_sales_code,item.credit_sales_code,item.debit_purchase_code,item.credit_purchase_code,item.description);return accountingItem(item.item_code);}catch(error){if(String(error.message).includes('UNIQUE'))throw new Error('Kode barang sudah digunakan.');throw error;}}
function updateAccountingItem(code,input){const current=accountingItem(code),item=itemInput(input,current);if(item.item_code!==code)throw new Error('Kode barang tidak dapat diubah karena terhubung ke transaksi dan stok.');const values=[item.item_name,item.item_type,item.debit_sales_code,item.credit_sales_code,item.debit_purchase_code,item.credit_purchase_code,item.description,code];if(current.source==='legacy')db.prepare('UPDATE accounting_legacy_items SET item_name=?,item_type=?,debit_sales_code=?,credit_sales_code=?,debit_purchase_code=?,credit_purchase_code=?,description=? WHERE item_code=?').run(...values);else db.prepare('UPDATE accounting_items SET item_name=?,item_type=?,debit_sales_code=?,credit_sales_code=?,debit_purchase_code=?,credit_purchase_code=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE item_code=?').run(...values);return accountingItem(code);}
function saveAccountingSupplier(input){const supplier=supplierInput(input);if(db.prepare('SELECT 1 FROM accounting_legacy_suppliers WHERE supplier_code=?').get(supplier.supplier_code))throw new Error('Kode supplier sudah dipakai oleh data historis.');try{db.prepare('INSERT INTO accounting_suppliers (supplier_code,supplier_name,address,origin,description) VALUES (?,?,?,?,?)').run(supplier.supplier_code,supplier.supplier_name,supplier.address,supplier.origin,supplier.description);return accountingSupplier(supplier.supplier_code);}catch(error){if(String(error.message).includes('UNIQUE'))throw new Error('Kode supplier sudah digunakan.');throw error;}}
function saveSupplierPayableMapping(code,payableAccountCode,user){const supplier=accountingSupplier(code),accountCode=String(payableAccountCode||'').trim();if(!accountCode){db.prepare('DELETE FROM accounting_supplier_payable_mappings WHERE supplier_code=?').run(supplier.supplier_code);return accountingSupplier(supplier.supplier_code);}postingAccount(accountCode,'Rekening Hutang supplier');db.prepare(`INSERT INTO accounting_supplier_payable_mappings(supplier_code,payable_account_code,updated_by) VALUES (?,?,?) ON CONFLICT(supplier_code) DO UPDATE SET payable_account_code=excluded.payable_account_code,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).run(supplier.supplier_code,accountCode,String(user?.username||''));return accountingSupplier(supplier.supplier_code);}
function updateAccountingSupplier(code,input,user){const current=accountingSupplier(code),supplier=supplierInput(input,current);if(supplier.supplier_code!==code)throw new Error('Kode supplier tidak dapat diubah karena terhubung ke transaksi.');const values=[supplier.supplier_name,supplier.address,supplier.origin,supplier.description,code];if(current.source==='legacy')db.prepare('UPDATE accounting_legacy_suppliers SET supplier_name=?,address=?,origin=?,description=? WHERE supplier_code=?').run(...values);else db.prepare('UPDATE accounting_suppliers SET supplier_name=?,address=?,origin=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE supplier_code=?').run(...values);if(Object.prototype.hasOwnProperty.call(input||{},'payable_account_code'))saveSupplierPayableMapping(code,input.payable_account_code,user);return accountingSupplier(code);}
function accountingCodeSegments(value){const segments=String(value||'').split('.').map(item=>Number(item));if(segments.length!==6||segments.some(item=>!Number.isInteger(item)||item<1||item>8))throw new Error('Format rekening harus memiliki enam segmen, masing-masing 1 sampai 8 digit.');return segments;}
function accountingCodeFormatSettings(){const row=db.prepare('SELECT segment_lengths,updated_by,updated_at FROM accounting_account_code_settings WHERE id=1').get()||{segment_lengths:'2.2.3.3.3.4',updated_by:'',updated_at:''},segments=accountingCodeSegments(row.segment_lengths);return {...row,segments,pattern:segments.join('.'),example:segments.map(length=>'0'.repeat(length)).join('.')};}
function updateAccountingCodeFormat(input,user){if(user?.role!=='master')throw new Error('Hanya akun master yang dapat mengubah format rekening.');const raw=Array.isArray(input?.segments)?input.segments.join('.'):String(input?.segment_lengths||'');const segments=accountingCodeSegments(raw);db.prepare('UPDATE accounting_account_code_settings SET segment_lengths=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(segments.join('.'),String(user.username||''));return accountingCodeFormatSettings();}
function accountingCodeLayout(parentCode=''){const parent=String(parentCode||'').trim();if(!parent)throw new Error('Pilih rekening induk agar kode anak dibuat otomatis.');const segments=parent.split('.').map(part=>String(part).length);if(segments.length!==6||segments.some(length=>length<1||length>8))throw new Error('Kode rekening induk tidak valid.');return {segments,pattern:segments.join('.'),example:segments.map(length=>'0'.repeat(length)).join('.')};}
function normalizeNewAccountingCode(value,parentCode=''){const format=accountingCodeLayout(parentCode),input=String(value||'').trim();if(!input)throw new Error('Kode rekening wajib diisi.');if(!/^[0-9.\s]+$/.test(input))throw new Error('Kode rekening hanya boleh berisi angka dan titik.');const parts=input.split('.').map(part=>part.trim());let normalized=[];if(input.includes('.')){if(parts.length!==format.segments.length||parts.some((part,index)=>!/^\d+$/.test(part)||part.length>format.segments[index]))throw new Error(`Kode rekening harus mengikuti format ${format.pattern}.`);normalized=parts.map((part,index)=>part.padStart(format.segments[index],'0'));}else{const digits=input.replace(/\s/g,'');if(!/^\d+$/.test(digits)||digits.length!==format.segments.reduce((sum,length)=>sum+length,0))throw new Error(`Kode rekening harus berisi ${format.segments.reduce((sum,length)=>sum+length,0)} digit.`);let cursor=0;normalized=format.segments.map(length=>{const part=digits.slice(cursor,cursor+length);cursor+=length;return part;});}return normalized.join('.');}
function accountingAccount(code){const account=db.prepare('SELECT account_code,account_name,account_type,parent_code,is_group,source,display_opening_amount,display_opening_side FROM accounting_accounts WHERE account_code=?').get(code);if(!account)throw new Error('Rekening tidak ditemukan.');return {...account,display_opening_amount:Number(account.display_opening_amount||0),is_posting:account.is_group?0:1};}
function canManageAccountingAccounts(user){return Boolean(user&&(user.role==='master'||user.modules?.includes('accounting_account_edit')));}
function accountDisplayOpening(input,current={}){const amount=Number(input.display_opening_amount??current.display_opening_amount??0),side=String(input.display_opening_side??current.display_opening_side??'').trim();if(!Number.isFinite(amount)||amount<0)throw new Error('Nominal saldo awal harus berupa angka nol atau lebih.');if(!['','Debit','Kredit'].includes(side))throw new Error('Sisi saldo awal harus Debit atau Kredit.');return {amount,side};}
function accountingDescendantCodes(accountCode){const children=new Map();for(const row of db.prepare('SELECT account_code,parent_code FROM accounting_accounts').all()){if(!children.has(row.parent_code))children.set(row.parent_code,[]);children.get(row.parent_code).push(row.account_code);}const found=new Set(),queue=[String(accountCode||'')];while(queue.length){for(const child of children.get(queue.shift())||[]){if(found.has(child))continue;found.add(child);queue.push(child);}}return [...found];}
function accountingOpeningSide(accountCode){const configured=accountingAccount(accountCode);if(['Debit','Kredit'].includes(configured.display_opening_side))return {side:configured.display_opening_side,amount:Number(configured.display_opening_amount||0),year:'',source:'Saldo awal tampilan master'};const codes=[String(accountCode||''),...accountingDescendantCodes(accountCode)].filter(Boolean),placeholders=codes.map(()=>'?').join(',');if(!codes.length)return {side:null,amount:0,year:'',source:''};const yearRow=db.prepare(`SELECT substr(j.transaction_date,1,4) year FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE l.account_code IN (${placeholders}) AND (l.debit<>0 OR l.credit<>0) AND j.transaction_date GLOB '????-??-??' ORDER BY j.transaction_date DESC,j.id DESC LIMIT 1`).get(...codes);if(!yearRow?.year)return {side:null,amount:0,year:'',source:''};const line=db.prepare(`SELECT l.debit,l.credit,j.voucher_number FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE l.account_code IN (${placeholders}) AND substr(j.transaction_date,1,4)=? AND (l.debit<>0 OR l.credit<>0) ORDER BY CASE WHEN j.voucher_number LIKE 'SA_%' THEN 0 ELSE 1 END,j.transaction_date,j.id,l.id LIMIT 1`).get(...codes,yearRow.year);if(!line)return {side:null,amount:0,year:yearRow.year,source:''};return {side:Number(line.credit)>Number(line.debit)?'Kredit':'Debit',amount:Number(line.debit||0)+Number(line.credit||0),year:yearRow.year,source:String(line.voucher_number||'').startsWith('SA_')?'SA':'Jurnal awal'};}
function accountingAccountAudit(accountCode,limit=50){return {history:db.prepare('SELECT id,account_code,changed_by,changed_at,before_json,after_json FROM accounting_account_audit WHERE account_code=? ORDER BY id DESC LIMIT ?').all(String(accountCode||''),Math.max(1,Math.min(Number(limit)||50,200))).map(row=>({...row,before:JSON.parse(row.before_json),after:JSON.parse(row.after_json)}))};}
function accountingChildSegment(parent){const parts=parent.account_code.split('.'),lastUsed=parts.reduce((last,part,index)=>Number(part)!==0?index:last,-1),index=parts.findIndex((part,position)=>position>lastUsed&&Number(part)===0);if(index<0)throw new Error(`Rekening induk ${parent.account_code} sudah berada pada tingkat terakhir dan tidak dapat memiliki anak baru.`);return index;}
function accountingSuggestedChildCode(parentCode=''){const parent=accountingAccount(String(parentCode||'').trim()),parts=parent.account_code.split('.'),childIndex=accountingChildSegment(parent),width=parts[childIndex].length,children=db.prepare('SELECT account_code FROM accounting_accounts WHERE parent_code=?').all(parent.account_code),highest=children.reduce((max,row)=>{const value=Number(String(row.account_code||'').split('.')[childIndex]);return Number.isFinite(value)?Math.max(max,value):max;},0),next=highest+1,limit=10**width;if(next>=limit)throw new Error(`Kapasitas anak rekening pada segmen ${childIndex+1} untuk ${parent.account_code} sudah penuh. Buat rekening induk atau kelompok baru untuk menampung rekening tambahan.`);const code=parts.map((part,index)=>index<childIndex?part:index===childIndex?String(next).padStart(width,'0'):'0'.repeat(parts[index].length)).join('.');return {account_code:code,parent_code:parent.account_code,account_type:parent.account_type,child_segment:childIndex+1};}
function assertAccountingChildCode(accountCode,parentCode){if(!parentCode)return;const parent=accountingAccount(parentCode),candidate=accountCode.split('.'),parentParts=parent.account_code.split('.'),childIndex=accountingChildSegment(parent),samePrefix=candidate.length===parentParts.length&&candidate.slice(0,childIndex).join('.')===parentParts.slice(0,childIndex).join('.'),hasChildNumber=Number(candidate[childIndex])>0,trailingZero=candidate.slice(childIndex+1).every(part=>Number(part)===0);if(!samePrefix||!hasChildNumber||!trailingZero)throw new Error(`Kode rekening harus mengikuti jalur induk ${parent.account_code}. Hanya segmen ${childIndex+1} yang dapat diubah untuk membuat anak baru.`);}
function saveAccountingAccount(input,user){if(!canManageAccountingAccounts(user))throw new Error('Anda belum diberi otoritas Edit rekening master.');const account_name=String(input.account_name||'').trim().slice(0,255),account_type=String(input.account_type??'Neraca').trim(),parent_code=String(input.parent_code||'').trim()||'',account_code=normalizeNewAccountingCode(input.account_code,parent_code),is_posting=Number(input.is_posting)===0?0:1,opening=accountDisplayOpening(input);if(!account_name)throw new Error('Kode dan nama rekening wajib diisi.');if(!['','Neraca','Laba-Rugi','HPP'].includes(account_type))throw new Error('Kelompok rekening tidak valid.');if(parent_code&&!db.prepare('SELECT 1 FROM accounting_accounts WHERE account_code=?').get(parent_code))throw new Error('Induk rekening tidak ditemukan.');assertAccountingChildCode(account_code,parent_code);try{db.prepare("INSERT INTO accounting_accounts (account_code,account_name,parent_code,account_type,is_group,source,display_opening_amount,display_opening_side) VALUES (?,?,?,?,?,'manual',?,?)").run(account_code,account_name,parent_code,account_type,is_posting?0:1,opening.amount,opening.side);return accountingAccount(account_code);}catch(error){if(String(error.message).includes('UNIQUE'))throw new Error('Kode rekening sudah digunakan.');throw error;}}
function updateAccountingAccount(code,input,user){if(!canManageAccountingAccounts(user))throw new Error('Anda belum diberi otoritas Edit rekening master.');const account=accountingAccount(code),account_name=String(input.account_name??account.account_name).trim().slice(0,255),account_type=String(input.account_type??account.account_type).trim(),parent_code=String(input.parent_code??account.parent_code??'').trim()||'',is_posting=Number(input.is_posting)===0?0:1,opening=accountDisplayOpening(input,account);if(String(input.account_code||code)!==code)throw new Error('Kode rekening tidak dapat diubah karena menjadi kunci relasi seluruh data.');if(!account_name)throw new Error('Nama rekening wajib diisi.');if(!['','Neraca','Laba-Rugi','HPP'].includes(account_type))throw new Error('Kelompok rekening tidak valid.');if(parent_code===code)throw new Error('Rekening tidak dapat menjadi induk dirinya sendiri.');if(parent_code&&!db.prepare('SELECT 1 FROM accounting_accounts WHERE account_code=?').get(parent_code))throw new Error('Induk rekening tidak ditemukan.');if(accountingDescendantCodes(code).includes(parent_code))throw new Error('Induk rekening tidak boleh merupakan anak dari rekening ini karena akan membentuk siklus.');const before={account_code:account.account_code,account_name:account.account_name,account_type:account.account_type,parent_code:account.parent_code||'',is_posting:account.is_posting,display_opening_amount:account.display_opening_amount,display_opening_side:account.display_opening_side||''};const after={account_code:code,account_name,account_type,parent_code,is_posting,display_opening_amount:opening.amount,display_opening_side:opening.side};db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE accounting_accounts SET account_name=?,account_type=?,parent_code=?,is_group=?,display_opening_amount=?,display_opening_side=?,updated_at=CURRENT_TIMESTAMP WHERE account_code=?').run(account_name,account_type,parent_code,is_posting?0:1,opening.amount,opening.side,code);db.prepare('INSERT INTO accounting_account_audit (account_code,changed_by,before_json,after_json) VALUES (?,?,?,?)').run(code,String(user.username||''),JSON.stringify(before),JSON.stringify(after));db.exec('COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}return {...accountingAccount(code),opening:accountingOpeningSide(code)};}
function accountingAccountCodeMigrationPreview(value=''){const latest=db.prepare("SELECT closing_year,opening_journal_id FROM accounting_year_closings ORDER BY closing_year DESC LIMIT 1").get();if(!latest)throw new Error('Migrasi format hanya tersedia setelah Tutup Buku disetujui.');const effectiveYear=Number(value||Number(latest.closing_year)+1);if(effectiveYear!==Number(latest.closing_year)+1)throw new Error(`Migrasi hanya dapat dibuat untuk tahun ${Number(latest.closing_year)+1}.`);const migrated=db.prepare('SELECT 1 FROM accounting_account_code_migrations WHERE effective_year=? LIMIT 1').get(effectiveYear);if(migrated)throw new Error(`Migrasi format rekening tahun ${effectiveYear} sudah pernah dijalankan.`);const laterJournal=db.prepare("SELECT COUNT(*) count FROM accounting_journal_entries WHERE transaction_date>=? AND id<>?").get(`${effectiveYear}-01-01`,latest.opening_journal_id);if(Number(laterJournal.count)>0)throw new Error(`Migrasi tidak dapat dijalankan karena sudah ada transaksi tahun ${effectiveYear}.`);const format=accountingCodeFormatSettings(),accounts=db.prepare('SELECT * FROM accounting_accounts ORDER BY account_code').all(),oldCodes=new Set(accounts.map(row=>row.account_code)),mapping=new Map(accounts.map(row=>{const parts=row.account_code.split('.');if(parts.length!==6)throw new Error(`Kode rekening ${row.account_code} tidak memiliki enam segmen.`);return [row.account_code,parts.map((part,index)=>part.padStart(format.segments[index],'0')).join('.')];}));const targets=new Map();for(const [oldCode,newCode] of mapping){if(targets.has(newCode)&&targets.get(newCode)!==oldCode)throw new Error(`Migrasi menghasilkan kode ganda ${newCode}.`);targets.set(newCode,oldCode);if(newCode!==oldCode&&oldCodes.has(newCode))throw new Error(`Kode tujuan ${newCode} sudah digunakan oleh rekening lain.`);}const changes=accounts.filter(row=>mapping.get(row.account_code)!==row.account_code).map(row=>({old_account_code:row.account_code,new_account_code:mapping.get(row.account_code),account_name:row.account_name}));return {effective_year:effectiveYear,closing_year:Number(latest.closing_year),opening_journal_id:Number(latest.opening_journal_id),format,account_count:accounts.length,changed_count:changes.length,unchanged_count:accounts.length-changes.length,changes};}
function migrateAccountingAccountCodes(value,user){if(user?.role!=='master')throw new Error('Hanya akun master yang dapat menjalankan migrasi format rekening.');const preview=accountingAccountCodeMigrationPreview(value),accounts=db.prepare('SELECT * FROM accounting_accounts ORDER BY account_code').all(),mapping=new Map(accounts.map(row=>[row.account_code,row.account_code.split('.').map((part,index)=>part.padStart(preview.format.segments[index],'0')).join('.')])),insert=db.prepare("INSERT INTO accounting_accounts(account_code,account_name,level_name,parent_code,account_status,description,account_type,account_subtype,is_group,counter_account_code,legacy_user_id,legacy_date,source,display_opening_amount,display_opening_side) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'manual',?,?)"),record=db.prepare('INSERT INTO accounting_account_code_migrations(effective_year,old_account_code,new_account_code,migrated_by) VALUES (?,?,?,?)');db.exec('BEGIN IMMEDIATE');try{for(const row of accounts){const next=mapping.get(row.account_code);record.run(preview.effective_year,row.account_code,next,String(user.username||''));if(next===row.account_code)continue;insert.run(next,row.account_name,row.level_name,mapping.get(row.parent_code)||row.parent_code,row.account_status,row.description,row.account_type,row.account_subtype,row.is_group,mapping.get(row.counter_account_code)||row.counter_account_code,row.legacy_user_id,row.legacy_date,Number(row.display_opening_amount||0),String(row.display_opening_side||''));}const remapLine=db.prepare('UPDATE accounting_journal_lines SET account_code=? WHERE journal_id=? AND account_code=?');for(const [oldCode,newCode] of mapping)if(oldCode!==newCode)remapLine.run(newCode,preview.opening_journal_id,oldCode);const tables=['accounting_legacy_items','accounting_items'];for(const table of tables)for(const column of ['debit_sales_code','credit_sales_code','debit_purchase_code','credit_purchase_code']){const update=db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${column}=?`);for(const [oldCode,newCode] of mapping)if(oldCode!==newCode)update.run(newCode,oldCode);}db.exec('COMMIT');return {...preview,migrated:true};}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
function accountingJournal(id){const journal=db.prepare('SELECT id,voucher_number,transaction_date,description,amount,transaction_type,legacy_user_id,source FROM accounting_journal_entries WHERE id=?').get(id);if(!journal)throw new Error('Jurnal tidak ditemukan.');journal.inventory_document=db.prepare('SELECT id,document_number,transaction_kind FROM accounting_inventory_documents WHERE journal_id=?').get(id)||null;journal.lines=db.prepare('SELECT l.id,l.account_code,a.account_name,l.description,l.debit,l.credit FROM accounting_journal_lines l JOIN accounting_accounts a ON a.account_code=l.account_code WHERE l.journal_id=? ORDER BY l.id').all(id);return journal;}
function accountingAccountDescendants(accountCode){const all=db.prepare('SELECT account_code,account_name,parent_code FROM accounting_accounts ORDER BY account_code').all(),children=new Map;for(const row of all){const parent=String(row.parent_code||'');if(!children.has(parent))children.set(parent,[]);children.get(parent).push(row);}const seen=new Set([accountCode]),queue=[accountCode],result=[];while(queue.length){const code=queue.shift();for(const child of children.get(code)||[]){if(seen.has(child.account_code))continue;seen.add(child.account_code);queue.push(child.account_code);result.push(child);}}return result;}
function accountingLedger(account_code,start='',end=''){
  const account=accountingAccount(account_code),descendants=accountingAccountDescendants(account_code),codes=[account_code,...descendants.map(row=>row.account_code)],placeholders=codes.map(()=>'?').join(','),filters=[`l.account_code IN (${placeholders})`],params=[...codes];
  if(start){filters.push('j.transaction_date>=?');params.push(start);}if(end){filters.push('j.transaction_date<=?');params.push(end);}
  const reportYear=/^(\d{4})-/.exec(start||end||'')?.[1]||'',before=[`l.account_code IN (${placeholders})`],beforeParams=[...codes];
  if(reportYear){before.push('j.transaction_date>=?');beforeParams.push(`${reportYear}-01-01`);}if(start){before.push('j.transaction_date<?');beforeParams.push(start);}
  const opening=Number(db.prepare(`SELECT COALESCE(SUM(l.debit-l.credit),0) AS balance FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE ${before.join(' AND ')}`).get(...beforeParams).balance),openingSource=reportYear?`Akumulasi mutasi dalam tahun ${reportYear} sebelum periode`:'Akumulasi transaksi sebelum periode',rows=db.prepare(`SELECT j.id,j.voucher_number,j.transaction_date,j.description AS journal_description,j.transaction_type,j.source,l.id AS line_id,l.account_code,a.account_name,l.description,l.debit,l.credit FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id JOIN accounting_accounts a ON a.account_code=l.account_code WHERE ${filters.join(' AND ')} ORDER BY j.transaction_date,j.id,l.id`).all(...params),basisFilters=[`l.account_code IN (${placeholders})`,`(l.debit<>0 OR l.credit<>0)`],basisParams=[...codes];
  if(reportYear){basisFilters.push('j.transaction_date>=?');basisParams.push(`${reportYear}-01-01`);}if(end){basisFilters.push('j.transaction_date<=?');basisParams.push(end);}
  const basisLine=db.prepare(`SELECT j.voucher_number,j.transaction_date,l.debit,l.credit FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE ${basisFilters.join(' AND ')} ORDER BY j.transaction_date,j.id,l.id LIMIT 1`).get(...basisParams),configuredSide=['Debit','Kredit'].includes(account.display_opening_side)?account.display_opening_side:'',openingSide=configuredSide||(basisLine&&Number(basisLine.credit)>Number(basisLine.debit)?'Kredit':'Debit'),displayMultiplier=openingSide==='Kredit'?-1:1,basisSource=configuredSide?'Saldo awal tampilan master':basisLine?(/(^|[\\/\s_-])SA(?:[ _-]?\d{4})?(?=$|[\\/\s_-])/i.test(String(basisLine.voucher_number||''))?`Jurnal Saldo Awal ${basisLine.voucher_number}`:`Jurnal bernilai pertama ${basisLine.voucher_number}`):'Belum ada jurnal bernilai';
  let running=opening;for(const row of rows){running+=Number(row.debit)-Number(row.credit);row.balance=running;row.display_balance=running*displayMultiplier;}
  return {account,aggregate:descendants.length>0,descendant_accounts:descendants,opening_balance:opening,opening_display_balance:opening*displayMultiplier,configured_opening:{amount:Number(account.display_opening_amount||0),side:configuredSide},opening_side:openingSide,opening_source:openingSource,basis_source:basisSource,rows,closing_balance:running,closing_display_balance:running*displayMultiplier};
}

// Laporan layar mengambil satu halaman saja. Ekspor tetap memanggil implementasi
// lengkap di atas sehingga file Excel selalu memuat seluruh periode.
const accountingLedgerAllRows=accountingLedger;
accountingLedger=(account_code,start='',end='',limit=0,offset=0)=>{
  const size=Math.max(0,Math.min(Number(limit)||0,100));
  if(!size)return accountingLedgerAllRows(account_code,start,end);
  const skip=Math.max(0,Number(offset)||0),account=accountingAccount(account_code),descendants=accountingAccountDescendants(account_code),codes=[account_code,...descendants.map(row=>row.account_code)],placeholders=codes.map(()=>'?').join(','),filters=[`l.account_code IN (${placeholders})`],params=[...codes];
  if(start){filters.push('j.transaction_date>=?');params.push(start);}if(end){filters.push('j.transaction_date<=?');params.push(end);}
  const reportYear=/^(\d{4})-/.exec(start||end||'')?.[1]||'',before=[`l.account_code IN (${placeholders})`],beforeParams=[...codes];
  if(reportYear){before.push('j.transaction_date>=?');beforeParams.push(`${reportYear}-01-01`);}if(start){before.push('j.transaction_date<?');beforeParams.push(start);}
  const opening=Number(db.prepare(`SELECT COALESCE(SUM(l.debit-l.credit),0) AS balance FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE ${before.join(' AND ')}`).get(...beforeParams).balance),openingSource=reportYear?`Akumulasi mutasi dalam tahun ${reportYear} sebelum periode`:'Akumulasi transaksi sebelum periode';
  const metrics=db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(l.debit),0) debit,COALESCE(SUM(l.credit),0) credit FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE ${filters.join(' AND ')}`).get(...params),rows=db.prepare(`SELECT j.id,j.voucher_number,j.transaction_date,j.description AS journal_description,j.transaction_type,j.source,l.id AS line_id,l.account_code,a.account_name,l.description,l.debit,l.credit,SUM(l.debit-l.credit) OVER (ORDER BY j.transaction_date,j.id,l.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) running_delta FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id JOIN accounting_accounts a ON a.account_code=l.account_code WHERE ${filters.join(' AND ')} ORDER BY j.transaction_date,j.id,l.id LIMIT ? OFFSET ?`).all(...params,size,skip);
  const basisFilters=[`l.account_code IN (${placeholders})`,`(l.debit<>0 OR l.credit<>0)`],basisParams=[...codes];
  if(reportYear){basisFilters.push('j.transaction_date>=?');basisParams.push(`${reportYear}-01-01`);}if(end){basisFilters.push('j.transaction_date<=?');basisParams.push(end);}
  const basisLine=db.prepare(`SELECT j.voucher_number,j.transaction_date,l.debit,l.credit FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE ${basisFilters.join(' AND ')} ORDER BY j.transaction_date,j.id,l.id LIMIT 1`).get(...basisParams),configuredSide=['Debit','Kredit'].includes(account.display_opening_side)?account.display_opening_side:'',openingSide=configuredSide||(basisLine&&Number(basisLine.credit)>Number(basisLine.debit)?'Kredit':'Debit'),displayMultiplier=openingSide==='Kredit'?-1:1,basisSource=configuredSide?'Saldo awal tampilan master':basisLine?(/(^|[\\/\s_-])SA(?:[ _-]?\d{4})?(?=$|[\\/\s_-])/i.test(String(basisLine.voucher_number||''))?`Jurnal Saldo Awal ${basisLine.voucher_number}`:`Jurnal bernilai pertama ${basisLine.voucher_number}`):'Belum ada jurnal bernilai';
  const total=Number(metrics.count||0),debit=Number(metrics.debit||0),credit=Number(metrics.credit||0),closing=opening+debit-credit;
  for(const row of rows){row.debit=Number(row.debit);row.credit=Number(row.credit);row.balance=opening+Number(row.running_delta||0);row.display_balance=row.balance*displayMultiplier;delete row.running_delta;}
  return {account,aggregate:descendants.length>0,descendant_accounts:descendants,opening_balance:opening,opening_display_balance:opening*displayMultiplier,configured_opening:{amount:Number(account.display_opening_amount||0),side:configuredSide},opening_side:openingSide,opening_source:openingSource,basis_source:basisSource,rows,totals:{debit,credit},closing_balance:closing,closing_display_balance:closing*displayMultiplier,page:{offset:skip,limit:size,total,has_more:skip+rows.length<total}};
};

// Persediaan SA mempunyai dua lapis: SA agregat pada induk dan SA rincian per
// barang. Audit wajib tetap menampilkan keduanya; saldo konsolidasi hanya
// mengecualikan SA rincian anak agar tidak dihitung dua kali pada induknya.
function inventoryLedgerConsolidationProfile(accountCode,year=''){
  if(!/^\d{4}$/.test(String(year)))return null;
  const account=accountingAccount(accountCode),eligible=['PERSEDIAAN BARANG JADI','PERSEDIAAN BAHAN PENOLONG'].includes(normalizedAccountName(account.account_name));
  if(!eligible)return null;
  const openingRows=db.prepare(`SELECT j.voucher_number FROM accounting_journal_entries j JOIN accounting_journal_lines l ON l.journal_id=j.id WHERE j.transaction_date=? AND l.account_code=?`).all(`${year}-01-01`,accountCode);
  const hasAggregate=openingRows.some(row=>isOpeningBalanceVoucher(row.voucher_number)&&!isOpeningBalanceDetailVoucher(row.voucher_number));
  return hasAggregate?{year:String(year),account}:null;
}
function consolidatedInventoryLedger(accountCode,start='',end='',limit=100,offset=0,profile){
  const account=profile.account,descendants=accountingAccountDescendants(accountCode),codes=[accountCode,...descendants.map(row=>row.account_code)],marks=codes.map(()=>'?').join(','),yearStart=`${profile.year}-01-01`,base=`l.account_code IN (${marks}) AND NOT (l.account_code<>? AND ${openingBalanceDetailVoucherSql('j.voucher_number')})`,baseParams=[...codes,accountCode],size=Math.max(0,Math.min(Number(limit)||0,100)),skip=Math.max(0,Number(offset)||0),range=[],rangeParams=[];
  if(start){range.push('j.transaction_date>=?');rangeParams.push(start);}if(end){range.push('j.transaction_date<=?');rangeParams.push(end);}
  const where=[base,...range].join(' AND '),params=[...baseParams,...rangeParams],before=[base,'j.transaction_date>=?'],beforeParams=[...baseParams,yearStart];if(start){before.push('j.transaction_date<?');beforeParams.push(start);}
  const opening=Number(db.prepare(`SELECT COALESCE(SUM(l.debit-l.credit),0) balance FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE ${before.join(' AND ')}`).get(...beforeParams).balance);
  const metrics=db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(l.debit),0) debit,COALESCE(SUM(l.credit),0) credit FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE ${where}`).get(...params),allRows=!size;
  const sql=`SELECT j.id,j.voucher_number,j.transaction_date,j.description journal_description,j.transaction_type,j.source,l.id line_id,l.account_code,a.account_name,l.description,l.debit,l.credit,SUM(l.debit-l.credit) OVER (ORDER BY j.transaction_date,j.id,l.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) running_delta FROM accounting_journal_lines l JOIN accounting_journal_entries j ON j.id=l.journal_id JOIN accounting_accounts a ON a.account_code=l.account_code WHERE ${where} ORDER BY j.transaction_date,j.id,l.id${allRows?'':' LIMIT ? OFFSET ?'}`;
  const rows=db.prepare(sql).all(...params,...(allRows?[]:[size,skip]));
  for(const row of rows){row.debit=Number(row.debit);row.credit=Number(row.credit);row.balance=opening+Number(row.running_delta||0);row.display_balance=row.balance;delete row.running_delta;}
  const debit=Number(metrics.debit||0),credit=Number(metrics.credit||0),total=Number(metrics.count||0),closing=opening+debit-credit;
  return {account,aggregate:true,descendant_accounts:descendants,opening_balance:opening,opening_display_balance:opening,configured_opening:{amount:Number(account.display_opening_amount||0),side:'Debit'},opening_side:'Debit',opening_source:`Saldo konsolidasi tahun ${profile.year} sebelum periode`,basis_source:`SA agregat ${profile.year}; SA rincian anak dikecualikan dari total induk`,rows,totals:{debit,credit},closing_balance:closing,closing_display_balance:closing,consolidated:true,consolidation_available:true,page:allRows?undefined:{offset:skip,limit:size,total,has_more:skip+rows.length<total}};
}
const accountingLedgerWithAuditAndPaging=accountingLedger;
accountingLedger=(accountCode,start='',end='',limit=0,offset=0,view='audit')=>{
  const year=/^(\d{4})-/.exec(start||end||'')?.[1]||'',profile=inventoryLedgerConsolidationProfile(accountCode,year);
  if(view==='consolidated'&&profile)return consolidatedInventoryLedger(accountCode,start,end,limit,offset,profile);
  const report=accountingLedgerWithAuditAndPaging(accountCode,start,end,limit,offset);
  return {...report,consolidated:false,consolidation_available:Boolean(profile)};
};

const ACCOUNTING_RETAINED_EARNINGS='03.04.00.00.00.0000',ACCOUNTING_CLOSE_MARKER='__ACCOUNTING_YEAR_CLOSE__';
function accountingYear(value){const year=Number(value);if(!Number.isInteger(year)||year<2000||year>9999)throw new Error('Tahun tutup buku tidak valid.');return year;}
function accountingHistoricalSaProfile(year){const closingYear=accountingYear(year),openingYear=closingYear+1;if(closingYear<2021||closingYear>2024)return null;const journals=db.prepare("SELECT id,voucher_number,transaction_date FROM accounting_journal_entries WHERE substr(transaction_date,1,4)=? AND (upper(voucher_number) GLOB ? OR upper(voucher_number) GLOB ?) ORDER BY transaction_date,id").all(String(openingYear),`*/SA_${closingYear}*`,`SA_${closingYear}*`);if(!journals.length)return null;const ids=journals.map(row=>row.id),accounts=db.prepare(`SELECT DISTINCT account_code FROM accounting_journal_lines WHERE journal_id IN (${ids.map(()=>'?').join(',')}) ORDER BY account_code`).all(...ids).map(row=>row.account_code);return {historical:true,closing_year:closingYear,opening_year:openingYear,vouchers:journals.map(row=>row.voucher_number),account_codes:accounts};}
function accountingHistoricalSaCodes(year){return new Set(accountingHistoricalSaProfile(year)?.account_codes||[]);}
function accountingHistoricalClosedYear(year){const profile=accountingHistoricalSaProfile(year);return profile?{closing_year:profile.closing_year,closing_journal_id:null,opening_journal_id:null,snapshot_json:'',closed_by:'historical-sa',closed_at:'',reclosed_at:'',historical:true,historical_sa:profile}:null;}
function accountingClosedYear(year){const closingYear=accountingYear(year),stored=db.prepare('SELECT closing_year,closing_journal_id,opening_journal_id,snapshot_json,closed_by,closed_at,reclosed_at FROM accounting_year_closings WHERE closing_year=?').get(closingYear);return stored||accountingHistoricalClosedYear(closingYear);}
function assertAccountingPeriodWritable(transactionDate,transactionType=''){const year=String(transactionDate||'').slice(0,4),closed=year&&accountingClosedYear(year);if(!closed)return;if(closed.historical)throw new Error(`Tahun ${year} adalah Tutup Buku Historis dan hanya-baca.`);if(/penyesuaian|adjust/i.test(String(transactionType||'')))return;throw new Error(`Tahun ${year} sudah ditutup. Buat jurnal Penyesuaian untuk koreksi, lalu jalankan Tutup Buku kembali.`);}
function accountingBalancesAt(end,types=[]){const filters=['a.is_group=0','j.transaction_date<=?'],params=[end];if(types.length){filters.push(`a.account_type IN (${types.map(()=>'?').join(',')})`);params.push(...types);}return db.prepare(`SELECT a.account_code,a.account_name,a.account_type,COALESCE(SUM(l.debit-l.credit),0) balance FROM accounting_accounts a LEFT JOIN accounting_journal_lines l ON l.account_code=a.account_code LEFT JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE ${filters.join(' AND ')} GROUP BY a.account_code ORDER BY a.account_code`).all(...params).map(row=>({...row,balance:Number(row.balance)}));}
function accountingBalancesInPeriod(start,end,types=[]){const filters=['a.is_group=0','j.transaction_date>=?','j.transaction_date<=?'],params=[start,end];if(types.length){filters.push(`a.account_type IN (${types.map(()=>'?').join(',')})`);params.push(...types);}return db.prepare(`SELECT a.account_code,a.account_name,a.account_type,COALESCE(SUM(l.debit-l.credit),0) balance FROM accounting_accounts a LEFT JOIN accounting_journal_lines l ON l.account_code=a.account_code LEFT JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE ${filters.join(' AND ')} GROUP BY a.account_code ORDER BY a.account_code`).all(...params).map(row=>({...row,balance:Number(row.balance)}));}
const accountingBalancesAtAudit=accountingBalancesAt,accountingBalancesInPeriodAudit=accountingBalancesInPeriod;
accountingBalancesAt=(end,types=[])=>{const filters=['a.is_group=0','j.transaction_date<=?',`NOT ${openingBalanceDetailVoucherSql('j.voucher_number')}`],params=[end];if(types.length){filters.push(`a.account_type IN (${types.map(()=>'?').join(',')})`);params.push(...types);}return db.prepare(`SELECT a.account_code,a.account_name,a.account_type,COALESCE(SUM(l.debit-l.credit),0) balance FROM accounting_accounts a LEFT JOIN accounting_journal_lines l ON l.account_code=a.account_code LEFT JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE ${filters.join(' AND ')} GROUP BY a.account_code ORDER BY a.account_code`).all(...params).map(row=>({...row,balance:Number(row.balance)}));};
accountingBalancesInPeriod=(start,end,types=[])=>{const filters=['a.is_group=0','j.transaction_date>=?','j.transaction_date<=?',`NOT ${openingBalanceDetailVoucherSql('j.voucher_number')}`],params=[start,end];if(types.length){filters.push(`a.account_type IN (${types.map(()=>'?').join(',')})`);params.push(...types);}return db.prepare(`SELECT a.account_code,a.account_name,a.account_type,COALESCE(SUM(l.debit-l.credit),0) balance FROM accounting_accounts a LEFT JOIN accounting_journal_lines l ON l.account_code=a.account_code LEFT JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE ${filters.join(' AND ')} GROUP BY a.account_code ORDER BY a.account_code`).all(...params).map(row=>({...row,balance:Number(row.balance)}));};
function accountingSnapshot(year){const currentYear=accountingYear(year),start=`${currentYear}-01-01`,end=`${currentYear}-12-31`,balances=accountingBalancesInPeriod(start,end).filter(row=>Math.abs(row.balance)>0.0001),outstanding=balances.filter(row=>/piutang|hutang/i.test(row.account_name)),receivables=outstanding.filter(row=>/piutang/i.test(row.account_name)).map(row=>({...row,amount:Math.abs(row.balance)})),payables=outstanding.filter(row=>/hutang/i.test(row.account_name)).map(row=>({...row,amount:Math.abs(row.balance)})),unbalanced=db.prepare(`SELECT j.voucher_number,j.transaction_date,ROUND(SUM(l.debit),2) debit,ROUND(SUM(l.credit),2) credit FROM accounting_journal_entries j JOIN accounting_journal_lines l ON l.journal_id=j.id WHERE j.transaction_date>=? AND j.transaction_date<=? GROUP BY j.id HAVING ABS(ROUND(SUM(l.debit)-SUM(l.credit),2))>0.009 ORDER BY j.transaction_date,j.id`).all(start,end).map(row=>({...row,debit:Number(row.debit),credit:Number(row.credit)})),stockRows=[...db.prepare(`SELECT l.item_code,COALESCE(SUM(CASE WHEN h.transaction_type=3 THEN l.quantity ELSE -l.quantity END),0) quantity FROM accounting_legacy_inventory_lines l JOIN accounting_legacy_inventory_transactions h ON h.voucher_number=l.voucher_number WHERE h.transaction_date>=? AND h.transaction_date<=? GROUP BY l.item_code`).all(start,end),...db.prepare(`SELECT l.item_code,COALESCE(SUM(CASE WHEN d.transaction_kind IN ('purchase','adjustment_in') THEN l.quantity ELSE -l.quantity END),0) quantity FROM accounting_inventory_document_lines l JOIN accounting_inventory_documents d ON d.id=l.document_id WHERE d.transaction_date>=? AND d.transaction_date<=? AND d.description<>'__LEGACY_FIFO_OPENING__' GROUP BY l.item_code`).all(start,end)],stockMap=new Map;for(const row of stockRows)stockMap.set(row.item_code,(stockMap.get(row.item_code)||0)+Number(row.quantity));const stockMinus=[...stockMap.entries()].filter(([,quantity])=>quantity<-0.0001).map(([item_code,quantity])=>({item_code,quantity})),incompleteItems=operationalInventoryItems().items.filter(row=>!row.ready).map(row=>({item_code:row.item_code,item_name:row.item_name}));return {year:currentYear,as_of:end,balances,receivables,payables,unbalanced_journals:unbalanced,stock_minus:stockMinus,incomplete_items:incompleteItems,summary:{nonzero_accounts:balances.length,total_balance_amount:balances.reduce((sum,row)=>sum+Math.abs(Number(row.balance)||0),0),receivables_total:receivables.reduce((sum,row)=>sum+row.amount,0),payables_total:payables.reduce((sum,row)=>sum+row.amount,0),unbalanced_count:unbalanced.length,stock_minus_count:stockMinus.length,incomplete_item_count:incompleteItems.length}};}
function insertGeneratedJournal(voucher,transactionDate,description,transactionType,lines){if(!lines.length)return null;const debit=lines.reduce((sum,row)=>sum+Number(row.debit||0),0),credit=lines.reduce((sum,row)=>sum+Number(row.credit||0),0);if(Math.abs(debit-credit)>0.009)throw new Error(`Jurnal otomatis ${voucher} tidak balance.`);const journalId=Number(db.prepare("INSERT INTO accounting_journal_entries (voucher_number,transaction_date,description,amount,transaction_type,legacy_user_id,source) VALUES (?,?,?,?,?,?, 'manual')").run(voucher,transactionDate,description,debit,transactionType,ACCOUNTING_CLOSE_MARKER).lastInsertRowid),insert=db.prepare('INSERT INTO accounting_journal_lines (journal_id,account_code,description,debit,credit) VALUES (?,?,?,?,?)');for(const line of lines)insert.run(journalId,line.account_code,description,Number(line.debit||0),Number(line.credit||0));return journalId;}
function deleteGeneratedJournal(id){if(!id)return;const journal=db.prepare('SELECT legacy_user_id FROM accounting_journal_entries WHERE id=?').get(id);if(!journal||journal.legacy_user_id!==ACCOUNTING_CLOSE_MARKER)throw new Error('Jurnal tutup buku tidak dapat dihapus karena bukan jurnal otomatis CAP.');db.prepare('DELETE FROM accounting_journal_lines WHERE journal_id=?').run(id);db.prepare('DELETE FROM accounting_journal_entries WHERE id=?').run(id);}
function closeAccountingYear(value,user){if(user?.role!=='master')throw new Error('Hanya akun master yang dapat menjalankan Tutup Buku.');const year=accountingYear(value),end=`${year}-12-31`,openingDate=`${year+1}-01-01`,existing=accountingClosedYear(year);if(existing?.historical)throw new Error(`Tahun ${year} adalah Tutup Buku Historis dan tidak dapat ditutup ulang.`);const manualSa=db.prepare("SELECT id,voucher_number FROM accounting_journal_entries WHERE transaction_date=? AND instr(upper(voucher_number),upper(?))>0 AND legacy_user_id<>?").get(openingDate,`SA_${year}`,ACCOUNTING_CLOSE_MARKER);db.exec('BEGIN IMMEDIATE');try{if(existing){db.prepare('DELETE FROM accounting_year_closings WHERE closing_year=?').run(year);deleteGeneratedJournal(existing.closing_journal_id);deleteGeneratedJournal(existing.opening_journal_id);}const profitRows=db.prepare(`SELECT a.account_code,COALESCE(SUM(l.debit-l.credit),0) balance FROM accounting_accounts a JOIN accounting_journal_lines l ON l.account_code=a.account_code JOIN accounting_journal_entries j ON j.id=l.journal_id WHERE a.is_group=0 AND a.account_type IN ('Laba-Rugi','HPP') AND j.transaction_date>=? AND j.transaction_date<=? AND NOT ${openingBalanceDetailVoucherSql('j.voucher_number')} GROUP BY a.account_code HAVING ABS(SUM(l.debit-l.credit))>0.0001 ORDER BY a.account_code`).all(`${year}-01-01`,end).map(row=>({...row,balance:Number(row.balance)})),closingLines=profitRows.map(row=>({account_code:row.account_code,debit:row.balance<0?-row.balance:0,credit:row.balance>0?row.balance:0})),net=profitRows.reduce((sum,row)=>sum+row.balance,0);if(Math.abs(net)>0.0001)closingLines.push({account_code:ACCOUNTING_RETAINED_EARNINGS,debit:net>0?net:0,credit:net<0?-net:0});const closingJournalId=insertGeneratedJournal(`TB_${year}`,end,`Tutup buku tahun ${year}`,'Tutup Buku Otomatis',closingLines);let openingJournalId=null;if(!manualSa){const balanceRows=accountingBalancesAt(end,['Neraca']).filter(row=>Math.abs(row.balance)>0.0001),openingLines=balanceRows.map(row=>({account_code:row.account_code,debit:row.balance>0?row.balance:0,credit:row.balance<0?-row.balance:0}));openingJournalId=insertGeneratedJournal(`SA_${year}`,openingDate,`Saldo awal tahun ${year+1}`,'Saldo Awal Otomatis',openingLines);}const snapshot=accountingSnapshot(year);db.prepare('INSERT INTO accounting_year_closings (closing_year,closing_journal_id,opening_journal_id,snapshot_json,closed_by,reclosed_at) VALUES (?,?,?,?,?,?)').run(year,closingJournalId,openingJournalId,JSON.stringify(snapshot),String(user.username||''),existing?new Date().toISOString():'');db.exec('COMMIT');return {closed:true,reclosed:Boolean(existing),manual_opening_journal:manualSa?.voucher_number||'',closing:accountingClosedYear(year),snapshot};}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
function withHistoricalSaRule(year,lines){const profile=accountingHistoricalSaProfile(year),required=new Set(profile?.account_codes||[]);return lines.map(row=>({...row,requires_opening_balance:profile?required.has(row.account_code):true})).sort((left,right)=>Number(left.requires_opening_balance)-Number(right.requires_opening_balance)||String(left.account_code).localeCompare(String(right.account_code)));}
function accountingYearCloseRequest(year){const request=db.prepare('SELECT * FROM accounting_year_close_requests WHERE closing_year=?').get(accountingYear(year));if(!request)return null;request.lines=withHistoricalSaRule(year,db.prepare(`SELECT l.account_code,a.account_name,a.account_type,l.default_balance,l.revised_balance,l.final_balance FROM accounting_year_close_request_lines l JOIN accounting_accounts a ON a.account_code=l.account_code WHERE l.request_id=? ORDER BY l.account_code`).all(request.id).map(row=>({...row,default_balance:Number(row.default_balance),revised_balance:row.revised_balance===null?null:Number(row.revised_balance),final_balance:Number(row.final_balance)})));return request;}
function balancesAreEqual(lines){const debit=lines.reduce((sum,row)=>sum+Math.max(0,Number(row.final_balance)||0),0),credit=lines.reduce((sum,row)=>sum+Math.max(0,-Number(row.final_balance)||0),0);if(Math.abs(debit-credit)>0.009)throw new Error(`Pengajuan tidak balance. Debit ${debit.toFixed(2)} dan kredit ${credit.toFixed(2)} harus sama.`);return {debit,credit};}
function submitAccountingYearClose(value,input,user){const year=accountingYear(value);if(accountingClosedYear(year))throw new Error(`Tahun ${year} sudah ditutup buku.`);const prior=accountingYearCloseRequest(year);if(prior&&prior.status==='submitted')throw new Error('Pengajuan audit tahun ini masih menunggu keputusan master.');if(prior&&prior.status==='returned'&&prior.submitted_by!==String(user?.username||''))throw new Error('Hanya pengaju sebelumnya yang dapat memperbarui pengajuan yang dikembalikan.');const revisions=input?.revisions&&typeof input.revisions==='object'?input.revisions:{},snapshot=accountingSnapshot(year),historicalSa=accountingHistoricalSaProfile(year),requiredSa=new Set(historicalSa?.account_codes||[]),lines=withHistoricalSaRule(year,snapshot.balances.map(row=>{const raw=revisions[row.account_code],hasRevision=!(raw===undefined||raw===null||String(raw).trim()===''),revised=hasRevision?Number(raw):historicalSa&&!requiredSa.has(row.account_code)?0:null;if(revised!==null&&!Number.isFinite(revised))throw new Error(`Nilai revisi ${row.account_code} tidak valid.`);return {account_code:row.account_code,default_balance:Number(row.balance),revised_balance:revised,final_balance:revised===null?Number(row.balance):revised};}));balancesAreEqual(lines);const auditedSnapshot={...snapshot,balances:lines.map(line=>{const account=snapshot.balances.find(row=>row.account_code===line.account_code);return {...account,balance:line.final_balance};}),summary:{...snapshot.summary,nonzero_accounts:lines.filter(line=>Math.abs(line.final_balance)>0.0001).length,total_balance_amount:lines.reduce((sum,line)=>sum+Math.abs(line.final_balance),0)}};db.exec('BEGIN IMMEDIATE');try{let requestId;if(prior){requestId=prior.id;db.prepare("UPDATE accounting_year_close_requests SET status='submitted',submitted_by=?,submitted_at=CURRENT_TIMESTAMP,audit_reason='',audited_by='',audited_at='',snapshot_json=? WHERE id=?").run(String(user?.username||''),JSON.stringify(auditedSnapshot),requestId);db.prepare('DELETE FROM accounting_year_close_request_lines WHERE request_id=?').run(requestId);}else requestId=Number(db.prepare("INSERT INTO accounting_year_close_requests (closing_year,status,submitted_by,snapshot_json) VALUES (?,'submitted',?,?)").run(year,String(user?.username||''),JSON.stringify(auditedSnapshot)).lastInsertRowid);const insert=db.prepare('INSERT INTO accounting_year_close_request_lines (request_id,account_code,default_balance,revised_balance,final_balance) VALUES (?,?,?,?,?)');for(const line of lines)insert.run(requestId,line.account_code,line.default_balance,line.revised_balance,line.final_balance);db.exec('COMMIT');return accountingYearCloseRequest(year);}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
function auditAccountingYearClose(value,input,user){if(user?.role!=='master')throw new Error('Hanya akun master yang dapat mengaudit Tutup Buku.');const year=accountingYear(value),request=accountingYearCloseRequest(year),action=String(input?.action||'');if(!request||request.status!=='submitted')throw new Error('Tidak ada pengajuan audit aktif untuk tahun ini.');if(action==='return'){const reason=String(input?.reason||'').trim().slice(0,1000);if(!reason)throw new Error('Alasan pengembalian untuk revisi wajib diisi.');db.prepare("UPDATE accounting_year_close_requests SET status='returned',audit_reason=?,audited_by=?,audited_at=CURRENT_TIMESTAMP WHERE id=?").run(reason,String(user?.username||''),request.id);return accountingYearCloseRequest(year);}if(action!=='approve')throw new Error('Keputusan audit tidak valid.');balancesAreEqual(request.lines);if(accountingClosedYear(year))throw new Error(`Tahun ${year} sudah ditutup buku.`);const end=`${year}-12-31`,openingDate=`${year+1}-01-01`,manualSa=db.prepare("SELECT id,voucher_number FROM accounting_journal_entries WHERE transaction_date=? AND instr(upper(voucher_number),upper(?))>0 AND legacy_user_id<>?").get(openingDate,`SA_${year}`,ACCOUNTING_CLOSE_MARKER);if(manualSa)throw new Error(`Jurnal saldo awal ${manualSa.voucher_number} sudah ada. Audit tidak dapat membuat SA ganda.`);const byCode=new Map(request.lines.map(line=>[line.account_code,line])),profitRows=request.lines.filter(line=>['Laba-Rugi','HPP'].includes(line.account_type)&&Math.abs(line.final_balance)>0.0001),closingLines=profitRows.map(line=>({account_code:line.account_code,debit:line.final_balance<0?-line.final_balance:0,credit:line.final_balance>0?line.final_balance:0})),net=profitRows.reduce((sum,line)=>sum+line.final_balance,0),retained=byCode.get(ACCOUNTING_RETAINED_EARNINGS);if(Math.abs(net)>0.0001)closingLines.push({account_code:ACCOUNTING_RETAINED_EARNINGS,debit:net>0?net:0,credit:net<0?-net:0});const openingLines=request.lines.filter(line=>line.account_type==='Neraca').map(line=>({...line,final_balance:line.final_balance+(line.account_code===ACCOUNTING_RETAINED_EARNINGS?net:0)})).filter(line=>Math.abs(line.final_balance)>0.0001).map(line=>({account_code:line.account_code,debit:line.final_balance>0?line.final_balance:0,credit:line.final_balance<0?-line.final_balance:0}));if(!retained&&Math.abs(net)>0.0001)openingLines.push({account_code:ACCOUNTING_RETAINED_EARNINGS,debit:net>0?net:0,credit:net<0?-net:0});const totals=openingLines.reduce((sum,line)=>({debit:sum.debit+line.debit,credit:sum.credit+line.credit}),{debit:0,credit:0});if(Math.abs(totals.debit-totals.credit)>0.009)throw new Error('SA hasil audit tidak balance. Perbaiki revisi saldo sebelum menyetujui.');db.exec('BEGIN IMMEDIATE');try{const closingJournalId=insertGeneratedJournal(`TB_${year}`,end,`Tutup buku tahun ${year}`,'Tutup Buku Otomatis',closingLines),openingJournalId=insertGeneratedJournal(`SA_${year}`,openingDate,`Saldo awal tahun ${year+1}`,'Saldo Awal Otomatis',openingLines),snapshot=JSON.parse(request.snapshot_json||'{}');db.prepare('INSERT INTO accounting_year_closings (closing_year,closing_journal_id,opening_journal_id,snapshot_json,closed_by) VALUES (?,?,?,?,?)').run(year,closingJournalId,openingJournalId,JSON.stringify(snapshot),String(user?.username||''));db.prepare("UPDATE accounting_year_close_requests SET status='approved',audited_by=?,audited_at=CURRENT_TIMESTAMP WHERE id=?").run(String(user?.username||''),request.id);db.exec('COMMIT');return {closed:true,closing:accountingClosedYear(year),request:accountingYearCloseRequest(year),snapshot};}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
function accountingClosingDashboard(value){const year=accountingYear(value),closing=accountingClosedYear(year),request=accountingYearCloseRequest(year),storedSnapshot=closing&&!closing.historical?JSON.parse(closing.snapshot_json||'{}'):null,snapshot=storedSnapshot||(request?.status==='submitted'?JSON.parse(request.snapshot_json||'{}'):accountingSnapshot(year)),historicalSa=accountingHistoricalSaProfile(year),balances=withHistoricalSaRule(year,(snapshot.balances||[]));return {year,closed:Boolean(closing),historical_closed:Boolean(closing?.historical),historical_sa:historicalSa?{opening_year:historicalSa.opening_year,vouchers:historicalSa.vouchers,account_codes:historicalSa.account_codes}:null,closing:closing?{...closing,snapshot_json:undefined,historical_sa:undefined}:null,request:request?{...request,snapshot_json:undefined}:null,snapshot:{...snapshot,balances}};}
// Laporan Tahunan membaca posisi per akhir tahun dan kinerja dalam tahun.
// Berbeda dengan dashboard tutup buku lama, fungsi ini tidak pernah membuat SA,
// jurnal penutup, atau perubahan data apa pun.
function accountingAnnualReportSettings(value){const year=accountingYear(value),profile=db.prepare('SELECT legal_entity_name,report_city FROM accounting_annual_report_profile WHERE id=1').get()||{legal_entity_name:'',report_city:''},yearly=db.prepare('SELECT narrative_intro,tax_note,tax_facility_turnover,tax_facility_rate,tax_rate,issued_city,issued_date,signatory_name,signatory_title FROM accounting_annual_report_year_settings WHERE report_year=?').get(year)||{},metadata=db.prepare('SELECT account_code,note_group,bank_account_number FROM accounting_annual_account_metadata').all(),accounts=db.prepare("SELECT account_code,account_name,account_type,account_subtype FROM accounting_accounts WHERE is_group=0 ORDER BY account_code").all();return {year,profile,yearly:{...yearly,issued_city:yearly.issued_city||profile.report_city||''},metadata,accounts};}
function saveAccountingAnnualReportSettings(value,input,user){if(user?.role!=='master')throw new Error('Hanya akun master yang dapat mengubah Pengaturan Catatan Atas.');const year=accountingYear(value),clean=value=>String(value??'').trim().slice(0,2000),number=value=>value===''||value===null||value===undefined?null:Number(value);const yearly=input?.yearly||{},profile=input?.profile||{},metadata=Array.isArray(input?.metadata)?input.metadata:[],valid=new Set(db.prepare('SELECT account_code FROM accounting_accounts').all().map(row=>row.account_code));for(const key of ['tax_facility_turnover','tax_facility_rate','tax_rate'])if(number(yearly[key])!==null&&(!Number.isFinite(number(yearly[key]))||number(yearly[key])<0))throw new Error('Parameter pajak harus berupa angka nol atau positif.');db.exec('BEGIN IMMEDIATE');try{db.prepare("INSERT INTO accounting_annual_report_profile (id,legal_entity_name,report_city,updated_by) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET legal_entity_name=excluded.legal_entity_name,report_city=excluded.report_city,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").run(clean(profile.legal_entity_name),clean(profile.report_city),String(user.username||''));db.prepare("INSERT INTO accounting_annual_report_year_settings (report_year,narrative_intro,tax_note,tax_facility_turnover,tax_facility_rate,tax_rate,issued_city,issued_date,signatory_name,signatory_title,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(report_year) DO UPDATE SET narrative_intro=excluded.narrative_intro,tax_note=excluded.tax_note,tax_facility_turnover=excluded.tax_facility_turnover,tax_facility_rate=excluded.tax_facility_rate,tax_rate=excluded.tax_rate,issued_city=excluded.issued_city,issued_date=excluded.issued_date,signatory_name=excluded.signatory_name,signatory_title=excluded.signatory_title,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").run(year,clean(yearly.narrative_intro),clean(yearly.tax_note),number(yearly.tax_facility_turnover),number(yearly.tax_facility_rate),number(yearly.tax_rate),clean(yearly.issued_city),clean(yearly.issued_date),clean(yearly.signatory_name),clean(yearly.signatory_title),String(user.username||''));const upsert=db.prepare("INSERT INTO accounting_annual_account_metadata (account_code,note_group,bank_account_number,updated_by) VALUES (?,?,?,?) ON CONFLICT(account_code) DO UPDATE SET note_group=excluded.note_group,bank_account_number=excluded.bank_account_number,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP");for(const row of metadata){const code=String(row?.account_code||'');if(valid.has(code))upsert.run(code,clean(row.note_group),clean(row.bank_account_number),String(user.username||''));}db.exec('COMMIT');return accountingAnnualReportSettings(year);}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
function accountingAnnualReport(value,monthValue=''){
  const year=accountingYear(value),yearStart=`${year}-01-01`,selectedMonth=Math.max(0,Math.min(12,Math.trunc(Number(monthValue)||0))),monthNames=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'],monthPrefix=selectedMonth?`${year}-${String(selectedMonth).padStart(2,'0')}`:'',start=selectedMonth?`${monthPrefix}-01`:yearStart,end=selectedMonth?`${monthPrefix}-${String(new Date(year,selectedMonth,0).getDate()).padStart(2,'0')}`:`${year}-12-31`,previousEnd=selectedMonth?(selectedMonth===1?`${year-1}-12-31`:`${year}-${String(selectedMonth-1).padStart(2,'0')}-${String(new Date(year,selectedMonth-1,0).getDate()).padStart(2,'0')}`):`${year-1}-12-31`,period_label=selectedMonth?`${monthNames[selectedMonth-1]} ${year}`:`Tahun ${year}`,accounts=db.prepare(`SELECT a.account_code,a.account_name,a.account_type,a.account_subtype,a.parent_code,
    COALESCE(SUM(CASE WHEN j.transaction_date>=? AND j.transaction_date<=? AND NOT ${openingBalanceDetailVoucherSql('j.voucher_number')} THEN l.debit ELSE 0 END),0) closing_debit,
    COALESCE(SUM(CASE WHEN j.transaction_date>=? AND j.transaction_date<=? AND NOT ${openingBalanceDetailVoucherSql('j.voucher_number')} THEN l.credit ELSE 0 END),0) closing_credit,
    COALESCE(SUM(CASE WHEN j.transaction_date>=? AND j.transaction_date<=? AND NOT ${openingBalanceDetailVoucherSql('j.voucher_number')} THEN l.debit ELSE 0 END),0) period_debit,
    COALESCE(SUM(CASE WHEN j.transaction_date>=? AND j.transaction_date<=? AND NOT ${openingBalanceDetailVoucherSql('j.voucher_number')} THEN l.credit ELSE 0 END),0) period_credit
    FROM accounting_accounts a LEFT JOIN accounting_journal_lines l ON l.account_code=a.account_code
    LEFT JOIN accounting_journal_entries j ON j.id=l.journal_id
    GROUP BY a.account_code ORDER BY a.account_code`).all(yearStart,end,yearStart,end,start,end,start,end).map(row=>({...row,
      closing_balance:Number(row.closing_debit)-Number(row.closing_credit),period_balance:Number(row.period_debit)-Number(row.period_credit)}));
  const byCode=new Map(accounts.map(row=>[row.account_code,row])),children=new Map();
  for(const account of accounts){const parent=String(account.parent_code||'');if(!children.has(parent))children.set(parent,[]);children.get(parent).push(account.account_code);}
  const descendants=root=>{if(!root||!byCode.has(root))return new Set();const found=new Set([root]),queue=[root];while(queue.length){for(const child of children.get(queue.shift())||[]){if(found.has(child))continue;found.add(child);queue.push(child);}}return found;};
  const exactName=name=>{const target=String(name||'').trim().toUpperCase();return accounts.find(row=>String(row.account_name||'').trim().toUpperCase()===target)||accounts.find(row=>String(row.account_name||'').trim().toUpperCase().startsWith(target))||null;};
  const accountValue=(row,period=false)=>Number(period?row.period_balance:row.closing_balance);
  const normalValue=(row,period=false)=>{const raw=accountValue(row,period),subtype=String(row.account_subtype||'').toUpperCase(),name=String(row.account_name||'').toUpperCase();const creditNormal=String(row.account_type||'')==='Laba-Rugi'&&subtype==='PENDAPATAN'||String(row.account_type||'')==='Neraca'&&(subtype.includes('HUTANG')||subtype.includes('MODAL')||subtype.includes('PENYUSUTAN')||name.includes('AKUMULASI PENYUSUTAN'));return creditNormal?-raw:raw;};
  const claimed=new Set(),accountLines=(root,options={})=>{const codes=descendants(root),period=Boolean(options.period),filter=options.filter||(()=>true),rows=accounts.filter(row=>codes.has(row.account_code)&&filter(row)&&Math.abs(accountValue(row,period))>0.0001).map(row=>({code:row.account_code,name:row.account_name,value:normalValue(row,period),unit:null}));for(const code of codes)claimed.add(code);return rows;};
  const group=(title,lines)=>({title,lines,total:lines.reduce((sum,row)=>sum+Number(row.value||0),0)});
  const rootCode=name=>exactName(name)?.account_code||'';
  const cash=group('Saldo Kas',accountLines(rootCode('KAS'))),bank=group('Saldo Bank',accountLines(rootCode('BANK'))),receivables=group('Saldo Piutang Usaha',accountLines(rootCode('PIUTANG DAGANG'))),advances=group('Saldo Uang Muka Impor',accountLines(rootCode('UANG MUKA IMPOR')));
  const fixedRows=accounts.filter(row=>String(row.account_type)==='Neraca'&&String(row.account_subtype||'').includes('Aktiva Tetap')&&Math.abs(accountValue(row))>0.0001).map(row=>{claimed.add(row.account_code);return {code:row.account_code,name:row.account_name,value:normalValue(row),unit:null};});
  const depreciationRows=accounts.filter(row=>String(row.account_subtype||'').includes('Akumulasi Penyusutan')&&Math.abs(accountValue(row))>0.0001).map(row=>{claimed.add(row.account_code);return {code:row.account_code,name:row.account_name,value:normalValue(row),unit:null};});
  // Stok historis memiliki saldo awal per tahun (SA). Seperti buku besar,
  // Catatan Atas harus membaca kartu stok dari awal tahun laporan, bukan
  // akumulasi seluruh tahun yang membuat kuantitas dan nilai berlipat.
  const stockAt=dateValue=>{const stockYear=/^\d{4}/.exec(String(dateValue||''))?.[0]||String(year);return accountingStockSummary(`${stockYear}-01-01`,dateValue).items.map(item=>({...item,quantity:Number(item.quantity||0),value:Number(item.value||0)}));};
  const inventoryGroups=items=>{const groups=new Map();for(const item of items){const inventory=byCode.get(item.debit_purchase_code),category=inventory&&byCode.get(inventory.parent_code),title=category?.account_name||inventory?.account_name||'Persediaan belum dipetakan';if(!groups.has(title))groups.set(title,[]);groups.get(title).push({code:item.item_code,name:item.item_name,value:item.value,unit:item.quantity});if(inventory)claimed.add(inventory.account_code);if(category)claimed.add(category.account_code);}return [...groups.entries()].map(([title,lines])=>group(title,lines));};
  const openingInventory=inventoryGroups(stockAt(previousEnd)),closingInventory=inventoryGroups(stockAt(end));
  const inventoryTotal=groups=>groups.reduce((sum,item)=>sum+item.total,0),openingInventoryTotal=inventoryTotal(openingInventory),closingInventoryTotal=inventoryTotal(closingInventory);
  const payables=group('Hutang Dagang',accountLines(rootCode('HUTANG DAGANG'))),taxPayables=group('Saldo Hutang Pajak',accountLines(rootCode('HUTANG PAJAK'))),emkl=group('Saldo Hutang EMKL',accountLines(rootCode('HUTANG EMKL'))),bankLoans=group('Saldo Hutang Bank',accountLines(rootCode('HUTANG BANK'))),capital=group('Saldo Modal',accountLines(rootCode('MODAL'))),retained=group('Saldo Laba (Rugi) Ditahan',accountLines(rootCode('LABA RUGI DITAHAN')));
  const periodRows=predicate=>accounts.filter(row=>predicate(row)&&Math.abs(accountValue(row,true))>0.0001).map(row=>({code:row.account_code,name:row.account_name,value:normalValue(row,true),unit:null}));
  const salesRows=periodRows(row=>String(row.account_type)==='Laba-Rugi'&&String(row.account_subtype||'')==='Pendapatan'&&String(row.account_code).startsWith('04.01.'));
  const otherIncomeRows=periodRows(row=>String(row.account_type)==='Laba-Rugi'&&String(row.account_subtype||'')==='Pendapatan'&&!String(row.account_code).startsWith('04.01.'));
  const purchaseRows=periodRows(row=>/PEMBELIAN/.test(String(row.account_name).toUpperCase()));
  const hppAdditionRows=periodRows(row=>String(row.account_type)==='HPP'&&!/PERSEDIAAN/.test(String(row.account_name).toUpperCase()));
  const taxRows=periodRows(row=>/PPH\s*(BADAN|PASAL\s*(25|29))|PAJAK PENGHASILAN/.test(String(row.account_name).toUpperCase()));
  const usedPeriodCodes=new Set([...salesRows,...otherIncomeRows,...purchaseRows,...hppAdditionRows,...taxRows].map(row=>row.code));
  const operatingRows=periodRows(row=>String(row.account_type)==='Laba-Rugi'&&String(row.account_subtype||'')==='Biaya'&&!usedPeriodCodes.has(row.account_code));
  const otherExpenseRows=periodRows(row=>String(row.account_type)==='Laba-Rugi'&&String(row.account_subtype||'')==='Biaya'&&usedPeriodCodes.has(row.account_code)&&!purchaseRows.some(item=>item.code===row.account_code)&&!taxRows.some(item=>item.code===row.account_code));
  const sales=group('Penjualan Bersih',salesRows),purchases=group('Pembelian dan Perolehan Barang',purchaseRows),hppAdditions=group('Biaya Perolehan Persediaan',hppAdditionRows),operating=group('Biaya Umum dan Administrasi',operatingRows),otherIncome=group('Penghasilan Lain-Lain',otherIncomeRows),otherExpense=group('Beban Lain-Lain',otherExpenseRows),tax=group('Pajak Penghasilan',taxRows);
  const hpp=openingInventoryTotal+purchases.total+hppAdditions.total-closingInventoryTotal,profitBeforeTax=sales.total-hpp-operating.total+otherIncome.total-otherExpense.total,netProfit=profitBeforeTax-tax.total;
  const mappedCodes=new Set(claimed);for(const row of [...salesRows,...otherIncomeRows,...purchaseRows,...hppAdditionRows,...taxRows,...operatingRows,...otherExpenseRows])mappedCodes.add(row.code);
  const unmapped=accounts.filter(row=>Math.abs(accountValue(row))>0.0001&&!mappedCodes.has(row.account_code)).map(row=>({code:row.account_code,name:row.account_name,value:normalValue(row),unit:null}));
  const currentAssets=[cash,bank,receivables,...closingInventory,advances],liabilities=[payables,taxPayables,emkl,bankLoans],equity=[capital,retained,group('Saldo Laba (Rugi) Tahun Berjalan',[{code:'',name:`Laba (Rugi) Tahun ${year}`,value:netProfit,unit:null}])];
  const hppRows=[...openingInventory.flatMap(item=>item.lines.map(line=>({...line,name:`Persediaan awal — ${line.name}`}))),...purchases.lines,...hppAdditions.lines,...closingInventory.flatMap(item=>item.lines.map(line=>({...line,name:`Persediaan akhir — ${line.name}`,value:-line.value})))],hppGroup=group('Harga Pokok Penjualan',hppRows);
  const sections=[{number:'1',title:'Aktiva Lancar',groups:currentAssets},{number:'2',title:'Aktiva Tetap Netto',groups:[group('Aktiva Tetap',fixedRows),group('Akumulasi Penyusutan',depreciationRows)]},{number:'3',title:'Kewajiban',groups:liabilities},{number:'4',title:'Modal dan Laba Ditahan',groups:equity},{number:'5',title:'Laba Rugi',groups:[sales,hppGroup,operating,group('Penghasilan dan Beban Lain-Lain',[...otherIncome.lines,...otherExpense.lines.map(line=>({...line,value:-line.value}))]),group('Laba (Rugi) sebelum Pajak',[{code:'',name:'Laba (Rugi) sebelum pajak penghasilan',value:profitBeforeTax,unit:null}]),tax,group('Laba (Rugi) Tahun Berjalan',[{code:'',name:`Laba (Rugi) bersih tahun ${year}`,value:netProfit,unit:null}])]}];
  if(unmapped.length)sections.push({number:'6',title:'Rekening Belum Dipetakan',groups:[group('Belum dipetakan',unmapped)]});
  const visibleSections=sections.map(section=>{const groups=section.groups.filter(item=>item.lines.length||Math.abs(item.total)>0.0001).map(item=>{const detailTotal=item.lines.reduce((sum,row)=>sum+Number(row.value||0),0);return {...item,rounding:Number((item.total-detailTotal).toFixed(2))};});return {...section,groups};}).filter(section=>section.groups.length);
  return {year,month:selectedMonth,period_label,start,end,sections:visibleSections,summary:{current_assets:currentAssets.reduce((sum,item)=>sum+item.total,0),fixed_assets:fixedRows.reduce((sum,row)=>sum+row.value,0)+depreciationRows.reduce((sum,row)=>sum+row.value,0),liabilities:liabilities.reduce((sum,item)=>sum+item.total,0),equity:equity.reduce((sum,item)=>sum+item.total,0),sales:sales.total,hpp,operating_expenses:operating.total,other_income:otherIncome.total,other_expenses:otherExpense.total,tax:tax.total,net_profit:netProfit,unmapped:unmapped.reduce((sum,row)=>sum+row.value,0)}};
}
function accountingAnnualWorkbook(value,monthValue=''){const report=accountingAnnualReport(value,monthValue),rows=[];for(const section of report.sections){rows.push([section.number,section.title,'','','',null,'Bagian']);for(const item of section.groups){rows.push([section.number,item.title,'','',null,Number(item.total),'Subtotal']);for(const line of item.lines)rows.push([section.number,item.title,line.code||'',line.name,Number(line.unit||0)||null,Number(line.value||0),'Rincian']);if(Math.abs(item.rounding)>0.0001)rows.push([section.number,item.title,'','Selisih Pembulatan',null,Number(item.rounding),'Pembulatan']);}}const title=report.month?`LAPORAN KEUANGAN ${String(report.period_label).toUpperCase()}`:`CATATAN ATAS LAPORAN KEUANGAN ${report.year}`;return exportAccountingWorkbookWithNote({start:report.start,end:report.end,period:report.period_label,note:'Nilai dihitung langsung dari jurnal, rekening, dan stok FIFO CAP. Neraca dan stok memakai posisi sampai akhir periode; Laba Rugi dan HPP memakai mutasi periode terpilih.',title,sheet_name:'Catatan Atas',headers:['No.','Kelompok','Kode','Uraian','Unit','Nilai','Jenis Baris'],currency_columns:[6],rows,annual_notes:report.month?null:report.notes});}
// Dashboard bulanan mengikuti tiga sheet pertama LK: Neraca, Laba Rugi, dan HPP.
// Laporan tahunan tetap memakai Catatan Atas Laporan Keuangan di atas.
function accountingMonthlyFinancialReport(value,monthValue){
  const year=accountingYear(value),month=Math.max(1,Math.min(12,Number(monthValue)||0));
  if(!month)throw new Error('Pilih bulan untuk laporan keuangan bulanan.');
  const monthNames=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const start=`${year}-${String(month).padStart(2,'0')}-01`,end=`${year}-${String(month).padStart(2,'0')}-${String(new Date(year,month,0).getDate()).padStart(2,'0')}`;
  const previousEnd=month===1?`${year-1}-12-31`:`${year}-${String(month-1).padStart(2,'0')}-${String(new Date(year,month-1,0).getDate()).padStart(2,'0')}`;
  const previousStart=month===1?`${year-1}-12-01`:`${year}-${String(month-1).padStart(2,'0')}-01`;
  const yearStart=`${year}-01-01`;
  // Tiga sumber resmi dashboard bulanan: Neraca, Laba Rugi, dan HPP.
  // Dashboard tidak lagi menghitung akun/rekening melalui jalur lain.
  // Neraca LK wajib identik dengan Laporan Neraca untuk bulan yang dipilih.
  // Karena laporan Neraca memakai rentang periode, pembanding diambil dari
  // rentang satu bulan sebelumnya, bukan dari seluruh riwayat sampai tanggalnya.
  const balanceBefore=accountingBalanceReport(previousStart,previousEnd),balanceCurrent=accountingBalanceReport(start,end);
  const balanceBeforeByCode=new Map((balanceBefore.accounts||[]).map(row=>[row.account_code,Number(row.display_balance??row.balance??0)]));
  const balanceSections=(balanceCurrent.sections||[]).map(section=>{
    const rows=(section.accounts||[]).map(row=>({...row,previous:Number(balanceBeforeByCode.get(row.account_code)||0),closing:Number(row.display_balance??row.balance??0)}));
    return {name:section.name,rows,total:{previous:rows.reduce((sum,row)=>sum+Number(row.previous||0),0),closing:Number(section.display_total??section.total??0)}};
  });
  const incomeBefore=accountingIncomeReport(yearStart,previousEnd),incomeMonth=accountingIncomeReport(start,end),incomeYtd=accountingIncomeReport(yearStart,end);
  const beforeByCode=new Map((incomeBefore.accounts||[]).map(row=>[row.account_code,Number(row.balance||0)])),monthByCode=new Map((incomeMonth.accounts||[]).map(row=>[row.account_code,Number(row.balance||0)])),ytdByCode=new Map((incomeYtd.accounts||[]).map(row=>[row.account_code,Number(row.balance||0)]));
  const hpp=accountingHpp(start,end),configuredHpp=(incomeYtd.accounts||[]).find(row=>row.source==='hpp_report');
  const hppLine={account_code:'',account_name:configuredHpp?.account_name||'HARGA POKOK PENJUALAN',previous:-Number(hpp.totals.previous||0),current:-Number(hpp.totals.current||0),ytd:-Number(hpp.totals.ytd||0),source:'hpp'};
  const sectionTotal=(rows,key)=>rows.reduce((total,row)=>total+Number(row[key]||0),0);
  const incomeSections=(incomeYtd.sections||[]).map(section=>{
    const rows=(section.accounts||[]).map(row=>({...row,previous:Number(beforeByCode.get(row.account_code)||0),current:Number(monthByCode.get(row.account_code)||0),ytd:Number(ytdByCode.get(row.account_code)||0)}));
    const hppIndex=rows.findIndex(row=>row.source==='hpp_report'||/HARGA\s*POKOK\s*PENJUALAN/i.test(row.account_name||''));
    if(hppIndex>=0)rows.splice(hppIndex,1,hppLine);
    return {name:section.name,rows,total:{previous:sectionTotal(rows,'previous'),current:sectionTotal(rows,'current'),ytd:sectionTotal(rows,'ytd')}};
  });
  const grossSection=incomeSections.find(section=>section.rows.some(row=>row.source==='hpp'));
  const gross=grossSection?grossSection.total:{previous:0,current:0,ytd:0};
  const net={previous:incomeSections.reduce((sum,section)=>sum+Number(section.total.previous||0),0),current:incomeSections.reduce((sum,section)=>sum+Number(section.total.current||0),0),ytd:incomeSections.reduce((sum,section)=>sum+Number(section.total.ytd||0),0)};
  const company=(db.prepare('SELECT legal_entity_name FROM accounting_annual_report_profile WHERE id=1').get()?.legal_entity_name||'PT. CAHAYA ANUGERAH PRIMANIAGA').toUpperCase();
  return {year,month,month_name:monthNames[month-1],start,end,previous_start:previousStart,previous_end:previousEnd,company,balance:{sections:balanceSections},income:{sections:incomeSections,gross,net},hpp};
}
function accountingMonthlyFinancialWorkbook(value,monthValue){
  const report=accountingMonthlyFinancialReport(value,monthValue);
  return exportAccountingWorkbookWithNote({monthly_financial:report,period:`${report.month_name} ${report.year}`,title:`LAPORAN KEUANGAN ${report.month_name.toUpperCase()} ${report.year}`,sheet_name:'Laporan Keuangan'});
}
const accountingAnnualReportBase=accountingAnnualReport;
accountingAnnualReport=function(value,monthValue=''){const report=accountingAnnualReportBase(value,monthValue),settings=accountingAnnualReportSettings(report.year),meta=new Map(settings.metadata.map(row=>[row.account_code,row]));const relabel=group=>{const lines=group.lines.map(line=>({...line,bank_account_number:meta.get(line.code)?.bank_account_number||'',note_group:meta.get(line.code)?.note_group||''})),buckets=new Map();for(const line of lines){const label=line.note_group||group.title;if(!buckets.has(label))buckets.set(label,[]);buckets.get(label).push(line);}if(buckets.size>1&&lines.some(line=>line.note_group))return [...buckets.entries()].map(([title,items])=>({title,lines:items,total:items.reduce((sum,line)=>sum+Number(line.value||0),0),rounding:0}));const title=lines.length&&lines.every(line=>line.note_group)?lines[0].note_group:group.title;return [{...group,title,lines}];};report.sections=report.sections.map(section=>({...section,groups:section.groups.flatMap(relabel)}));report.notes={profile:settings.profile,yearly:settings.yearly,sections:report.sections.map(section=>({number:section.number,title:section.title,groups:section.groups.map(group=>({...group,lines:group.lines.map(line=>({...line,display_name:line.bank_account_number?`${line.name} (${line.bank_account_number})`:line.name}))}))}))};return report;};
const saveAccountingJournalBeforeClosing=saveAccountingJournal,updateAccountingJournalBeforeClosing=updateAccountingJournal,saveInventoryDocumentBeforeClosing=saveInventoryDocument;
saveAccountingJournal=(input,user)=>{assertAccountingPeriodWritable(input?.transaction_date,input?.transaction_type);return saveAccountingJournalBeforeClosing(input,user);};
updateAccountingJournal=(id,input,user)=>{const current=accountingJournal(id),currentYear=String(current.transaction_date||'').slice(0,4),targetYear=String(input?.transaction_date||current.transaction_date||'').slice(0,4);if(accountingClosedYear(currentYear)||accountingClosedYear(targetYear))throw new Error(`Tahun ${accountingClosedYear(currentYear)?currentYear:targetYear} sudah ditutup dan jurnal tidak dapat diubah. Buat jurnal Penyesuaian baru lalu jalankan Tutup Buku kembali.`);return updateAccountingJournalBeforeClosing(id,input,user);};
saveInventoryDocument=(input,user)=>{
  const kind=normalizeInventoryTransactionKind(input?.inventory_flow||input?.transaction_kind),
    normalizedInput={...(input||{}),transaction_kind:kind,inventory_flow:kind},
    supplierCode=String(normalizedInput.supplier_code||'').trim();
  // Barang Masuk yang memilih supplier selalu merupakan pembelian kredit.
  // Jangan biarkan form/browser lama mengirimkan `cash_bank`, karena pada
  // proses FIFO berikutnya transaksi tersebut dapat dibaca keliru sebagai
  // transaksi Kas/Bank dan gagal sebelum jurnal dibuat.
  if(kind==='purchase'&&supplierCode)normalizedInput.payment_mode='payable';
  const year=String(normalizedInput.transaction_date||'').slice(0,4);
  if(accountingClosedYear(year))throw new Error(`Tahun ${year} sudah ditutup. Transaksi stok tidak dapat ditambah atau diubah.`);
  return saveInventoryDocumentBeforeClosing(normalizedInput,user);
};
function updateAccountingJournal(id,input,user){const current=accountingJournal(id);if(current.source==='legacy')throw new Error('Jurnal historis terkunci. Koreksi dilakukan melalui jurnal baru.');if(current.inventory_document)throw new Error('Jurnal transaksi stok terkunci. Gunakan penyesuaian stok baru untuk koreksi.');const transaction_date=String(input.transaction_date||'').trim(),description=String(input.description||'').trim().slice(0,2000),transaction_type=String(input.transaction_type||'Jurnal Umum').trim().slice(0,100),voucher_number=String(input.voucher_number||'').trim().slice(0,100);if(!/^\d{4}-\d{2}-\d{2}$/.test(transaction_date)||!voucher_number)throw new Error('Tanggal dan nomor bukti wajib diisi.');const lines=(Array.isArray(input.lines)?input.lines:[]).map(line=>({account_code:String(line.account_code||'').trim(),description:String(line.description||'').trim().slice(0,2000),debit:Number(line.debit||0),credit:Number(line.credit||0)})),protectedCodes=protectedInventoryAccountCodes();if(lines.length<2)throw new Error('Jurnal harus memiliki minimal dua baris.');for(const line of lines){if(!line.account_code||!db.prepare('SELECT 1 FROM accounting_accounts WHERE account_code=?').get(line.account_code))throw new Error('Rekening jurnal tidak valid.');if(protectedCodes.has(line.account_code))throw new Error('Rekening Persediaan atau HPP barang aktif hanya dapat diubah melalui transaksi stok.');if(!Number.isFinite(line.debit)||!Number.isFinite(line.credit)||line.debit<0||line.credit<0||(line.debit===0)===(line.credit===0))throw new Error('Setiap baris jurnal harus berisi tepat satu nominal debit atau kredit yang positif.');}const debit=lines.reduce((sum,line)=>sum+line.debit,0),credit=lines.reduce((sum,line)=>sum+line.credit,0);if(Math.abs(debit-credit)>=0.0001)throw new Error('Jurnal tidak seimbang: total debit harus sama dengan total kredit.');db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE accounting_journal_entries SET voucher_number=?,transaction_date=?,description=?,amount=?,transaction_type=?,legacy_user_id=? WHERE id=?').run(voucher_number,transaction_date,description,debit,transaction_type,String(user?.username||''),id);db.prepare('DELETE FROM accounting_journal_lines WHERE journal_id=?').run(id);const insert=db.prepare('INSERT INTO accounting_journal_lines (journal_id,account_code,description,debit,credit) VALUES (?,?,?,?,?)');for(const line of lines)insert.run(id,line.account_code,line.description,line.debit,line.credit);db.exec('COMMIT');return accountingJournal(id);}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
function saveAccountingJournal(input,user){const transaction_date=String(input.transaction_date||'').trim(),description=String(input.description||'').trim().slice(0,2000),transaction_type=String(input.transaction_type||'Jurnal Umum').trim().slice(0,100);if(!/^\d{4}-\d{2}-\d{2}$/.test(transaction_date))throw new Error('Tanggal jurnal wajib menggunakan format YYYY-MM-DD.');const lines=(Array.isArray(input.lines)?input.lines:[]).map(line=>({account_code:String(line.account_code||'').trim(),description:String(line.description||'').trim().slice(0,2000),debit:Number(line.debit||0),credit:Number(line.credit||0)})),protectedCodes=protectedInventoryAccountCodes();if(lines.length<2)throw new Error('Jurnal harus memiliki minimal dua baris.');for(const line of lines){if(!line.account_code||!db.prepare('SELECT 1 FROM accounting_accounts WHERE account_code=?').get(line.account_code))throw new Error(`Rekening tidak ditemukan: ${line.account_code||'(kosong)'}.`);if(protectedCodes.has(line.account_code))throw new Error('Rekening Persediaan atau HPP barang aktif hanya dapat diubah melalui transaksi stok.');if(!Number.isFinite(line.debit)||!Number.isFinite(line.credit)||line.debit<0||line.credit<0||(line.debit===0)===(line.credit===0))throw new Error('Setiap baris jurnal harus berisi tepat satu nominal debit atau kredit yang positif.');}const debit=lines.reduce((sum,line)=>sum+line.debit,0),credit=lines.reduce((sum,line)=>sum+line.credit,0);if(Math.abs(debit-credit)>=0.0001)throw new Error('Jurnal tidak seimbang: total debit harus sama dengan total kredit.');const voucher_number=String(input.voucher_number||`CAP-${transaction_date.replace(/-/g,'')}-${randomUUID().slice(0,8).toUpperCase()}`).trim().slice(0,100);if(!voucher_number)throw new Error('Nomor bukti wajib diisi.');db.exec('BEGIN IMMEDIATE');try{const result=db.prepare("INSERT INTO accounting_journal_entries (voucher_number,transaction_date,description,amount,transaction_type,legacy_user_id,source) VALUES (?,?,?,?,?,?,'manual')").run(voucher_number,transaction_date,description,debit,transaction_type,String(user?.username||'')),journalId=Number(result.lastInsertRowid),insert=db.prepare('INSERT INTO accounting_journal_lines (journal_id,account_code,description,debit,credit) VALUES (?,?,?,?,?)');for(const line of lines)insert.run(journalId,line.account_code,line.description,line.debit,line.credit);db.exec('COMMIT');return {id:journalId,voucher_number,transaction_date,description,transaction_type,debit_total:debit,credit_total:credit};}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
function accountingInventoryDocument(id){const document=db.prepare('SELECT * FROM accounting_inventory_documents WHERE id=?').get(id);if(!document)throw new Error('Transaksi stok tidak ditemukan.');document.lines=db.prepare('SELECT id,item_code,quantity,unit_price,total_amount FROM accounting_inventory_document_lines WHERE document_id=? ORDER BY id').all(id).map(row=>({...row,quantity:Number(row.quantity),unit_price:Number(row.unit_price),total_amount:Number(row.total_amount)}));return document;}
function assertInventoryDocumentMutable(document){
  if(document.description==='__LEGACY_FIFO_OPENING__')throw new Error('Saldo awal FIFO historis adalah data sistem dan tidak dapat diubah atau dihapus.');
  if(accountingClosedYear(String(document.transaction_date||'').slice(0,4)))throw new Error('Tahun transaksi stok sudah ditutup. Transaksi tidak dapat diubah atau dihapus.');
}
function resetOperationalFifo(){
  db.prepare('DELETE FROM accounting_inventory_fifo_allocations').run();
  db.prepare('DELETE FROM accounting_inventory_fifo_batches').run();
}
function removeInventoryDocument(id){
  const document=accountingInventoryDocument(id);assertInventoryDocumentMutable(document);
  db.exec('BEGIN IMMEDIATE');
  try{
    resetOperationalFifo();
    db.prepare('DELETE FROM accounting_inventory_document_lines WHERE document_id=?').run(document.id);
    db.prepare('DELETE FROM accounting_inventory_documents WHERE id=?').run(document.id);
    db.prepare('DELETE FROM accounting_journal_lines WHERE journal_id=?').run(document.journal_id);
    db.prepare('DELETE FROM accounting_journal_entries WHERE id=?').run(document.journal_id);
    rebuildOperationalInventoryFifo();
    db.exec('COMMIT');return document;
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function deleteInventoryDocument(id){const document=removeInventoryDocument(id);return {deleted:true,id:document.id,document_number:document.document_number};}
function replaceInventoryDocument(id,input,user){
  const original=accountingInventoryDocument(id);assertInventoryDocumentMutable(original);
  const kind=normalizeInventoryTransactionKind(input?.transaction_kind),transactionDate=String(input?.transaction_date||'').trim(),documentNumber=String(input?.document_number||'').trim().slice(0,100),supplierCode=String(input?.supplier_code||'').trim(),paymentMode=String(input?.payment_mode||'').trim(),counterAccountCode=String(input?.counter_account_code||'').trim(),description=String(input?.description||'').trim().slice(0,2000),referenceNumber=String(input?.reference_number||'').trim().slice(0,100);
  if(!['purchase','sale','adjustment_in','adjustment_out'].includes(kind))throw new Error('Jenis transaksi stok tidak valid.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)||!documentNumber)throw new Error('Tanggal dan nomor bukti transaksi stok wajib diisi.');
  const rawLines=Array.isArray(input?.lines)?input.lines:[];
  if(!rawLines.length)throw new Error('Tambahkan sedikitnya satu barang.');
  const lines=rawLines.map(row=>({item:inventoryItem(row.item_code),quantity:Number(row.quantity||0),unit_price:Number(row.unit_price||0)}));
  for(const line of lines){
    if(!Number.isFinite(line.quantity)||line.quantity<=0||!Number.isFinite(line.unit_price)||line.unit_price<0)throw new Error('Jumlah dan harga barang tidak valid.');
    if((kind==='purchase'||kind==='sale'||kind==='adjustment_in')&&line.unit_price<=0)throw new Error('Harga satuan wajib lebih dari nol.');
  }
  const counter=postingAccount(counterAccountCode,'Rekening lawan');
  if(kind==='purchase'){
    if(!['cash_bank','payable'].includes(paymentMode))throw new Error('Pilih cara pembayaran pembelian.');
    if(paymentMode==='payable'&&!db.prepare("SELECT 1 FROM accounting_legacy_suppliers WHERE supplier_code=? UNION ALL SELECT 1 FROM accounting_suppliers WHERE supplier_code=? LIMIT 1").get(supplierCode,supplierCode))throw new Error('Supplier wajib dipilih untuk pembelian hutang.');
  }
  if(kind==='sale'&&paymentMode!=='cash_bank')throw new Error('Penjualan tahap pertama hanya mendukung Tunai/Bank.');
  db.exec('BEGIN IMMEDIATE');
  try{
    resetOperationalFifo();
    db.prepare('UPDATE accounting_inventory_documents SET document_number=?,transaction_date=?,transaction_kind=?,supplier_code=?,payment_mode=?,counter_account_code=?,description=?,reference_number=? WHERE id=?').run(documentNumber,transactionDate,kind,supplierCode,paymentMode,counter.account_code,description,referenceNumber,original.id);
    db.prepare('DELETE FROM accounting_inventory_document_lines WHERE document_id=?').run(original.id);
    const insertLine=db.prepare('INSERT INTO accounting_inventory_document_lines (document_id,item_code,quantity,unit_price,total_amount) VALUES (?,?,?,?,?)');
    for(const line of lines)insertLine.run(original.id,line.item.item_code,line.quantity,line.unit_price,kind==='sale'?line.quantity*line.unit_price:kind==='adjustment_out'?0:line.quantity*line.unit_price);
    db.prepare('UPDATE accounting_journal_entries SET voucher_number=?,transaction_date=?,description=?,transaction_type=?,legacy_user_id=? WHERE id=?').run(documentNumber,transactionDate,description,{purchase:'Pembelian Barang',sale:'Penjualan Barang',adjustment_in:'Penyesuaian Stok Tambah',adjustment_out:'Penyesuaian Stok Kurang'}[kind],String(user?.username||''),original.journal_id);
    rebuildOperationalInventoryFifo();
    db.exec('COMMIT');return {id:original.id,document_number:documentNumber,journal_id:original.journal_id};
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function saveWarehouseActivity(data) {
  const fields = ['activity_date','section','shift','activity','area','staff'];
  for (const field of fields) if (typeof data[field] !== 'string' || !data[field].trim()) throw new Error('Lengkapi seluruh data kegiatan gudang.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.activity_date)) throw new Error('Tanggal kegiatan tidak valid.');
  if (!['Packing', 'Servis', 'Produksi'].includes(data.section.trim())) throw new Error('Bagian kegiatan gudang tidak valid.');
  const quantity = Number(data.quantity); if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Jumlah unit tidak valid.');
  db.prepare('INSERT INTO warehouse_activities (activity_date,section,shift,activity,area,staff,quantity,notes) VALUES (?,?,?,?,?,?,?,?)').run(data.activity_date, data.section.trim(), data.shift.trim().slice(0,20), data.activity.trim().slice(0,80), data.area.trim().slice(0,80), data.staff.trim().slice(0,80), quantity, String(data.notes || '').trim().slice(0,250));
}
const serviceMonths={januari:1,februari:2,maret:3,april:4,mei:5,juni:6,juli:7,agustus:8,september:9,oktober:10,november:11,desember:12,january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
function parseServiceReport(text, fallbackSection) {
  const raw=String(text||'').replace(/\r/g,'');
  const clean=raw.replace(/[|_]/g,' ').replace(/[ \t]+/g,' ');
  const dateMatch=clean.match(/(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu)?\s*,?\s*(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})/i);
  const activityDate=dateMatch ? `${dateMatch[3]}-${String(serviceMonths[dateMatch[2].toLowerCase()]).padStart(2,'0')}-${String(dateMatch[1]).padStart(2,'0')}` : new Date().toISOString().slice(0,10);
  const leader=(clean.match(/leader\s*[:.]?\s*([a-z][a-z .'-]{1,50})/i)||[])[1]?.trim()||'';
  const memberCount=Number((clean.match(/(\d+)\s*orang\s*masuk/i)||[])[1]||0);
  const receiptCount=Number((clean.match(/(?:jmlh|jumlah|jmih|limih)\s*(?:resi|rest)\s*(\d+)/i)||clean.match(/\b(?:resi|rest)\D{0,8}(\d{1,4})/i)||[])[1]||0);
  const onlineBlock=(clean.match(/online\b([\s\S]*?)(?:\b(?:offline|[a-z]*off[a-z]*ine)\b|$)/i)||[])[1]||'';
  const onlineTotal=[...onlineBlock.matchAll(/\(\s*(\d+)\s*\)/g)].reduce((sum,match)=>sum+Number(match[1]),0);
  const offlineBlock=(clean.match(/\b(?:offline|[a-z]*off[a-z]*ine)\b([\s\S]*?)(?=\b(?:jmlh|jumlah|jmih|limih)\s*(?:resi|rest)|\b\d+\s*orang\s*masuk|$)/i)||[])[1]||'';
  const offlineBlockRaw=(raw.match(/\b(?:offline|[a-z]*off[a-z]*ine)\b([\s\S]*?)(?=\b(?:jmlh|jumlah|jmih|limih)\s*(?:resi|rest)|\b\d+\s*orang\s*masuk|$)/i)||[])[1]||'';
  const offlineInBrackets=[...offlineBlock.matchAll(/\(\s*(\d+)\s*\)/g)].reduce((sum,match)=>sum+Number(match[1]),0);
  const offlinePlain=[...offlineBlock.matchAll(/(?<![a-z0-9])(\d{1,3})(?![a-z0-9])/ig)].map(match=>Number(match[1]));
  // Pada foto tabel WhatsApp, total offline sering berada tepat sebelum pemisah kolom
  // (contoh: "Antena det (9) 20 | kitchen scale"). Angka itu lebih terpercaya
  // daripada penjumlahan OCR atas angka barang di kolom lain.
  const markedOfflineTotals=[...offlineBlockRaw.matchAll(/(?:^|[^\d])(\d{1,4})\s*(?:[|_])/gm)].map(match=>Number(match[1]));
  const offlineTotal=markedOfflineTotals.at(-1)||offlineInBrackets||offlinePlain.at(-1)||0;
  const notes=clean.split('\n').map(line=>line.trim()).filter(line=>/servis toko|kendala|perbaik|karat|rusak/i.test(line)&&!/qc\s*&?\s*servis/i.test(line)).join(' · ').slice(0,500);
  const totalUnits=onlineTotal+offlineTotal;
  return {activityDate,section:/\bservis\b/i.test(clean)?'Servis':fallbackSection,leader,memberCount,receiptCount,onlineTotal,offlineTotal,totalUnits,notes};
}
function saveWarehouseReport(buffer, name, section, mimeType='image/png') {
  const safeName=String(name||'laporan-gudang.png').replace(/[^\w .()\-]/g,'_');
  if(!/\.(png|jpe?g|webp)$/i.test(safeName))throw new Error('Unggah gambar PNG, JPG, atau WEBP.');
  if(!Buffer.isBuffer(buffer)||!buffer.length)throw new Error('Gambar laporan belum dipilih.');
  const suffix=extname(safeName)||'.png',temp=join(tmpdir(),`cap-warehouse-${randomUUID()}${suffix}`),ocr=ocrStatus(),ocrBin=ocr.executable;
  try {
    if(!ocr.ready)throw new Error(ocr.message);
    writeFileSync(temp,buffer);
    const result=spawnSync(ocrBin,[temp,'stdout','-l',ocr.indonesian?'ind+eng':'eng','--psm','3'],{encoding:'utf8',maxBuffer:1024*1024,timeout:45000});
    if(result.error?.code==='ETIMEDOUT')throw new Error('OCR melebihi batas 45 detik. Gunakan gambar yang lebih kecil atau lebih jelas, lalu coba kembali.');
    if(result.error||result.status!==0)throw new Error(result.stderr||'Gambar tidak dapat dibaca oleh OCR.');
    const parsed=parseServiceReport(result.stdout,section),values=[parsed.leader,parsed.memberCount,parsed.onlineTotal,parsed.offlineTotal,parsed.totalUnits,parsed.receiptCount,parsed.notes,safeName,mimeType.slice(0,80),buffer,result.stdout.slice(0,10000)],existing=db.prepare('SELECT id FROM warehouse_reports WHERE activity_date=? AND section=? ORDER BY id DESC LIMIT 1').get(parsed.activityDate,parsed.section);
    if(existing){db.prepare('UPDATE warehouse_reports SET leader=?,member_count=?,online_total=?,offline_total=?,total_units=?,receipt_count=?,notes=?,image_name=?,image_mime=?,image_data=?,ocr_text=?,created_at=CURRENT_TIMESTAMP WHERE id=?').run(...values,existing.id);db.prepare('DELETE FROM warehouse_reports WHERE activity_date=? AND section=? AND id<>?').run(parsed.activityDate,parsed.section,existing.id);}
    else db.prepare('INSERT INTO warehouse_reports (activity_date,section,leader,member_count,online_total,offline_total,total_units,receipt_count,notes,image_name,image_mime,image_data,ocr_text) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(parsed.activityDate,parsed.section,...values);
    return {parsed,updated:Boolean(existing),data:warehouseData(parsed.section)};
  } finally { if(existsSync(temp))unlinkSync(temp); }
}
const parseCsvRows = source => { const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<source.length;i++){const char=source[i],next=source[i+1];if(char==='"'&&quoted&&next==='"'){cell+='"';i++;}else if(char==='"')quoted=!quoted;else if(char===','&&!quoted){row.push(cell);cell='';}else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&next==='\n')i++;row.push(cell);if(row.some(value=>value.trim()))rows.push(row);row=[];cell='';}else cell+=char;}row.push(cell);if(row.some(value=>value.trim()))rows.push(row);return rows; };
const normalizeHeader = value => String(value||'').replace(/^\uFEFF/,'').toLowerCase().replace(/[^a-z0-9]+/g,'').trim();
const parseIncomingDate = value => { const text=String(value||'').trim();let match=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);if(match)return `${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;match=/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text);if(match)return `${match[3]}-${String(match[1]).padStart(2,'0')}-${String(match[2]).padStart(2,'0')}`;return null; };
const detectCourier = tracking => { const value=String(tracking||'').trim().toUpperCase();if(/^SPX(?:ID)?/.test(value))return 'Shopee Xpress';if(/^(?:JX|JY|JP)/.test(value))return 'J&T Express';if(/^57/.test(value))return 'J&T Cargo';if(/^51\d{10,}$/.test(value))return 'AnterAja';if(/^ID\d{8,}/.test(value))return 'ID Express';if(/^JNE/.test(value))return 'JNE';if(/^(?:NINJA|NJV)/.test(value))return 'Ninja Xpress';if(/^(?:SICEPAT|SCP|SI)/.test(value))return 'SiCepat';if(/^(?:ANT|AJA)/.test(value))return 'AnterAja';return 'Belum teridentifikasi'; };
function returnIncomingData(search='',start='',end='') {
  const requested=[...new Set(String(search||'').toUpperCase().split(/[\s,;]+/).map(value=>value.trim()).filter(Boolean))].slice(0,200),from=/^\d{4}-\d{2}-\d{2}$/.test(String(start||''))?String(start):'',to=/^\d{4}-\d{2}-\d{2}$/.test(String(end||''))?String(end):'';
  let where="WHERE (?='' OR received_date>=?) AND (?='' OR received_date<=?)",args=[from,from,to,to];
  if(requested.length){where+=` AND upper(tracking_number) IN (${requested.map(()=>'?').join(',')})`;args.push(...requested);}
  const records=db.prepare(`SELECT * FROM return_incoming_shipments ${where} ORDER BY received_date DESC,id DESC LIMIT 200`).all(...args),total=Number(db.prepare(`SELECT count(*) AS count FROM return_incoming_shipments ${where}`).get(...args).count),byCourier=db.prepare(`SELECT courier,COUNT(*) AS total FROM return_incoming_shipments ${where} GROUP BY courier ORDER BY total DESC,courier`).all(...args),unidentified=Number(db.prepare(`SELECT count(*) AS count FROM return_incoming_shipments ${where} AND courier='Belum teridentifikasi'`).get(...args).count);
  return {total,records,byCourier,unidentified,start:from,end:to,requested:requested.length};
}
function importIncomingReturns(fileData,fileName) { const rows=parseCsvRows(fileData.toString('utf8'));if(rows.length<2)throw new Error('CSV tidak berisi data pemindaian.');const headers=rows.shift().map(normalizeHeader),dateIndex=headers.findIndex(value=>['date','tanggal','receiveddate','tanggalmasuk'].includes(value)),trackingIndex=headers.findIndex(value=>['text','tracking','trackingnumber','nomorresi','resi','awb'].includes(value));if(dateIndex<0||trackingIndex<0)throw new Error('Kolom tanggal atau nomor resi tidak ditemukan. Gunakan CSV hasil pemindaian dengan kolom date dan text.');const insert=db.prepare('INSERT OR IGNORE INTO return_incoming_shipments (received_date,tracking_number,courier,source_file) VALUES (?,?,?,?)');let saved=0;db.exec('BEGIN');try{for(const row of rows){const date=parseIncomingDate(row[dateIndex]),tracking=String(row[trackingIndex]||'').trim().toUpperCase();if(!date||!tracking)continue;const result=insert.run(date,tracking,detectCourier(tracking),fileName);saved+=Number(result.changes||0);}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return {saved,...returnIncomingData()}; }
function paymentLogData(start='',end='') { const records=db.prepare("SELECT * FROM payroll_payment_logs WHERE (?='' OR period_end>=?) AND (?='' OR period_end<=?) ORDER BY period_end DESC,id DESC").all(String(start||''),String(start||''),String(end||''),String(end||''));return {records}; }
function savePaymentLog(data) {
  const start=String(data.period_start||''),end=String(data.period_end||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)throw new Error('Rentang periode pembayaran tidak valid.');
  const number=value=>{const result=Number(value);if(!Number.isFinite(result)||result<0)throw new Error('Nilai pembayaran tidak valid.');return result;};
  const employeeCount=Math.max(0,Math.floor(number(data.employee_count))),payment=payrollPayment(data.payment_model),monthly=number(data.monthly_total||0),daily=number(data.daily_total||0),monthlyBasic=number(data.monthly_basic_total||0),allowance=number(data.allowance_total||0),premium=number(data.premium_total||0),overtime=number(data.overtime_total||0),deduction=number(data.deduction_total||0),paid=number(data.paid_total),existing=db.prepare('SELECT id FROM payroll_payment_logs WHERE period_start=? AND period_end=? AND payment_model=?').get(start,end,payment);
  db.exec('BEGIN');
  try {
    let paymentLogId;
    if(existing){db.prepare('UPDATE payroll_payment_logs SET employee_count=?,monthly_total=?,daily_total=?,monthly_basic_total=?,allowance_total=?,premium_total=?,overtime_total=?,deduction_total=?,paid_total=?,needs_recalculation=0,created_at=CURRENT_TIMESTAMP WHERE id=?').run(employeeCount,monthly,daily,monthlyBasic,allowance,premium,overtime,deduction,paid,existing.id);paymentLogId=existing.id;}
    else paymentLogId=Number(db.prepare('INSERT INTO payroll_payment_logs (period_start,period_end,employee_count,monthly_total,daily_total,monthly_basic_total,allowance_total,premium_total,overtime_total,deduction_total,paid_total,payment_model) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(start,end,employeeCount,monthly,daily,monthlyBasic,allowance,premium,overtime,deduction,paid,payment).lastInsertRowid);
    const description=`Pembayaran gaji ${employeeCount} karyawan · periode ${start} s.d. ${end}`;
    const pettyExisting=db.prepare('SELECT id FROM petty_cash_transactions WHERE payment_log_id=?').get(paymentLogId);
    if(pettyExisting)db.prepare("UPDATE petty_cash_transactions SET transaction_date=?,category='gaji',other_category='',person_name='',source_number=?,description=?,amount=?,source_file='Log pembayaran gaji',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(end,`PAYROLL-${paymentLogId}`,description,Math.round(paid),pettyExisting.id);
    else db.prepare("INSERT INTO petty_cash_transactions (transaction_date,category,other_category,person_name,source_number,description,amount,source_file,payment_log_id) VALUES (?,'gaji','','',?,?,?,'Log pembayaran gaji',?)").run(end,`PAYROLL-${paymentLogId}`,description,Math.round(paid),paymentLogId);
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK');throw error; }
  return {...paymentLogData(),updated:Boolean(existing)};
}
const whatsappModules=['returns','warehouse','payroll'];
const whatsappPhone=value=>{let phone=String(value||'').replace(/\D/g,'');if(phone.startsWith('0'))phone=`62${phone.slice(1)}`;else if(phone.startsWith('8'))phone=`62${phone}`;if(!/^\d{9,16}$/.test(phone))throw new Error('Nomor WhatsApp tidak valid. Gunakan format 08xx atau 62xx.');return phone;};
const whatsappData=()=>{const setting=db.prepare('SELECT * FROM whatsapp_settings WHERE id=1').get(),classifications=db.prepare('SELECT c.id,c.name,c.active,(SELECT COUNT(*) FROM whatsapp_contacts w WHERE w.classification_id=c.id) AS contact_count FROM whatsapp_classifications c ORDER BY c.name').all().map(item=>({...item,active:Boolean(item.active)})),contacts=db.prepare('SELECT w.id,w.name,w.phone,w.modules,w.active,w.created_at,w.classification_id,c.name AS classification_name FROM whatsapp_contacts w LEFT JOIN whatsapp_classifications c ON c.id=w.classification_id ORDER BY w.name').all().map(item=>({...item,modules:JSON.parse(item.modules||'[]'),active:Boolean(item.active)}));return {settings:{business_number:setting.business_number,phone_number_id:setting.phone_number_id,api_version:setting.api_version,has_access_token:Boolean(setting.access_token)},modules:whatsappModules,classifications,contacts};};
const whatsappClassificationId=value=>{if(value===undefined||value===null||value==='')return null;const id=Number(value);if(!Number.isInteger(id)||!db.prepare('SELECT 1 FROM whatsapp_classifications WHERE id=?').get(id))throw new Error('Klasifikasi nomor tidak ditemukan.');return id;};
const whatsappContactModules=value=>[...new Set((Array.isArray(value)?value:[]).filter(item=>whatsappModules.includes(item)))];
const saveWhatsappClassification=(data,id=null)=>{const name=String(data.name||'').trim().slice(0,60);if(!name)throw new Error('Nama klasifikasi wajib diisi.');try{if(id){const result=db.prepare('UPDATE whatsapp_classifications SET name=?,active=? WHERE id=?').run(name,data.active===false?0:1,id);if(!result.changes)throw new Error('Klasifikasi nomor tidak ditemukan.');}else db.prepare('INSERT INTO whatsapp_classifications (name) VALUES (?)').run(name);}catch(error){if(/UNIQUE/i.test(error.message))throw new Error(`Klasifikasi "${name}" sudah ada.`);throw error;}return whatsappData();};
const deleteWhatsappClassification=id=>{const used=db.prepare('SELECT COUNT(*) AS total FROM whatsapp_contacts WHERE classification_id=?').get(id).total;if(used)throw new Error(`Klasifikasi masih dipakai ${used} nomor. Ubah klasifikasi nomor tersebut atau nonaktifkan klasifikasi.`);db.prepare('DELETE FROM whatsapp_classifications WHERE id=?').run(id);return whatsappData();};
const updateWhatsappContact=(id,data)=>{const current=db.prepare('SELECT * FROM whatsapp_contacts WHERE id=?').get(id);if(!current)throw new Error('Kontak WhatsApp tidak ditemukan.');const name=String(data.name??current.name).trim().slice(0,80),phone=data.phone===undefined?current.phone:whatsappPhone(data.phone),modules=data.modules===undefined?JSON.parse(current.modules||'[]'):whatsappContactModules(data.modules),classification=data.classification_id===undefined?current.classification_id:whatsappClassificationId(data.classification_id),active=data.active===undefined?current.active:(data.active?1:0);if(!name)throw new Error('Nama kontak wajib diisi.');try{db.prepare('UPDATE whatsapp_contacts SET name=?,phone=?,modules=?,classification_id=?,active=? WHERE id=?').run(name,phone,JSON.stringify(modules),classification,active,id);}catch(error){if(/UNIQUE/i.test(error.message))throw new Error('Nomor WhatsApp tersebut sudah dipakai kontak lain.');throw error;}return whatsappData();};
const saveWhatsappSettings=data=>{const business=String(data.business_number||'').trim(),phoneId=String(data.phone_number_id||'').trim(),version=String(data.api_version||'v22.0').trim().replace(/[^v0-9.]/gi,'')||'v22.0',token=String(data.access_token||'').trim(),current=db.prepare('SELECT access_token FROM whatsapp_settings WHERE id=1').get();if(!phoneId)throw new Error('Phone Number ID WhatsApp Business wajib diisi.');db.prepare('UPDATE whatsapp_settings SET business_number=?,phone_number_id=?,api_version=?,access_token=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(business,phoneId,version,token||current.access_token);return whatsappData();};
const saveWhatsappContact=data=>{const name=String(data.name||'').trim().slice(0,80),phone=whatsappPhone(data.phone),modules=whatsappContactModules(data.modules),classification=whatsappClassificationId(data.classification_id);if(!name)throw new Error('Nama kontak wajib diisi.');db.prepare('INSERT INTO whatsapp_contacts (name,phone,modules,classification_id,active) VALUES (?,?,?,?,1) ON CONFLICT(phone) DO UPDATE SET name=excluded.name,modules=excluded.modules,classification_id=excluded.classification_id,active=1').run(name,phone,JSON.stringify(modules),classification);return whatsappData();};
async function sendWhatsapp(data){const setting=db.prepare('SELECT * FROM whatsapp_settings WHERE id=1').get(),module=String(data.module||''),message=String(data.message||'').trim();if(!whatsappModules.includes(module)||!message)throw new Error('Pilih modul dan isi pesan notifikasi.');if(!setting.phone_number_id||!setting.access_token)throw new Error('Simpan Phone Number ID dan access token WhatsApp Business terlebih dahulu.');const classification=whatsappClassificationId(data.classification_id),contacts=db.prepare('SELECT * FROM whatsapp_contacts WHERE active=1').all().filter(item=>JSON.parse(item.modules||'[]').includes(module)&&(classification===null||item.classification_id===classification));if(!contacts.length)throw new Error(classification===null?'Belum ada kontak aktif untuk modul tersebut.':'Belum ada kontak aktif untuk modul dan klasifikasi tersebut.');const results=[];for(const contact of contacts){const response=await fetch(`https://graph.facebook.com/${setting.api_version}/${setting.phone_number_id}/messages`,{method:'POST',headers:{Authorization:`Bearer ${setting.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:contact.phone,type:'text',text:{body:message}})}),body=await response.json();results.push({name:contact.name,phone:contact.phone,ok:response.ok,error:response.ok?'':body?.error?.message||'Pengiriman gagal'});}return {total:results.length,sent:results.filter(item=>item.ok).length,failed:results.filter(item=>!item.ok),results};}
function journalLockYears(){const active=db.prepare("SELECT DISTINCT substr(transaction_date,1,4) year FROM accounting_journal_entries WHERE transaction_date GLOB '????-??-??' AND transaction_date>='2000-01-01'").all().map(row=>row.year),archived=db.prepare("SELECT DISTINCT substr(json_extract(journal_json,'$.transaction_date'),1,4) year FROM accounting_journal_archives WHERE json_extract(journal_json,'$.transaction_date')>='2000-01-01'").all().map(row=>row.year),locked=db.prepare('SELECT journal_year FROM accounting_journal_year_locks').all().map(row=>String(row.journal_year)),years=[...new Set([...active,...archived,...locked])].sort((a,b)=>Number(b)-Number(a));return {years:years.map(year=>({year,locked:locked.includes(year)}))};}
function accountingModuleSettings(){const saved=String(db.prepare("SELECT value FROM settings WHERE key='accounting_module_name'").get()?.value||'').trim();return {app_name:saved||'(Input Admin) Accounting'};}
function saveAccountingModuleSettings(input,user){if(user?.role!=='master')throw new Error('Hanya akun master yang dapat mengubah nama aplikasi Accounting.');const appName=String(input?.app_name||'').trim().replace(/\s+/g,' ').slice(0,80);if(appName.length<3)throw new Error('Nama aplikasi minimal 3 karakter.');db.prepare("INSERT INTO settings (key,value) VALUES ('accounting_module_name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(appName);return accountingModuleSettings();}
function isJournalYearLocked(date){const year=Number(String(date||'').slice(0,4));return Number.isInteger(year)&&Boolean(db.prepare('SELECT 1 FROM accounting_journal_year_locks WHERE journal_year=?').get(year));}
function saveJournalLocks(input,user){if(user?.role!=='master')throw new Error('Hanya akun master yang dapat mengubah penguncian jurnal.');const years=[...new Set((Array.isArray(input?.locked_years)?input.locked_years:[]).map(value=>Number(value)).filter(year=>Number.isInteger(year)&&year>=2000&&year<=9999))];db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM accounting_journal_year_locks').run();const insert=db.prepare('INSERT INTO accounting_journal_year_locks (journal_year,locked_by) VALUES (?,?)');for(const year of years)insert.run(year,String(user.username||''));db.exec('COMMIT');return journalLockYears();}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
function assertJournalChangeAllowed(journal){if(journal.source==='legacy')throw new Error('Jurnal historis tetap terkunci.');if(journal.inventory_document)throw new Error('Jurnal transaksi stok tetap terlindungi; gunakan transaksi stok atau penyesuaian stok.');if(/Tutup Buku|Saldo Awal Otomatis/i.test(journal.transaction_type||''))throw new Error('Jurnal tutup buku tetap terlindungi.');if(accountingClosedYear(String(journal.transaction_date||'').slice(0,4)))throw new Error('Tahun jurnal sudah ditutup dan tidak dapat diubah.');if(isJournalYearLocked(journal.transaction_date))throw new Error(`Jurnal tahun ${String(journal.transaction_date).slice(0,4)} sedang dikunci oleh admin.`);}
function archiveAccountingJournal(id,user){const journal=accountingJournal(id);assertJournalChangeAllowed(journal);db.exec('BEGIN IMMEDIATE');try{const archiveId=Number(db.prepare('INSERT INTO accounting_journal_archives (original_journal_id,journal_json,deleted_by) VALUES (?,?,?)').run(journal.id,JSON.stringify(journal),String(user?.username||'')).lastInsertRowid);db.prepare('DELETE FROM accounting_journal_lines WHERE journal_id=?').run(journal.id);db.prepare('DELETE FROM accounting_journal_entries WHERE id=?').run(journal.id);db.exec('COMMIT');return {id:archiveId,voucher_number:journal.voucher_number};}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
function journalArchives(){return {archives:db.prepare('SELECT * FROM accounting_journal_archives ORDER BY deleted_at DESC,id DESC').all().map(row=>{const journal=JSON.parse(row.journal_json);return {id:row.id,original_journal_id:row.original_journal_id,voucher_number:journal.voucher_number,transaction_date:journal.transaction_date,description:journal.description,debit_total:(journal.lines||[]).reduce((sum,line)=>sum+Number(line.debit||0),0),credit_total:(journal.lines||[]).reduce((sum,line)=>sum+Number(line.credit||0),0),deleted_by:row.deleted_by,deleted_at:row.deleted_at,restored_at:row.restored_at,restored_journal_id:row.restored_journal_id};})};}
function restoreArchivedJournal(id,user){if(user?.role!=='master')throw new Error('Hanya akun master yang dapat memulihkan jurnal.');const archive=db.prepare('SELECT * FROM accounting_journal_archives WHERE id=?').get(id);if(!archive)throw new Error('Arsip jurnal tidak ditemukan.');if(archive.restored_at)throw new Error('Jurnal ini sudah dipulihkan.');const journal=JSON.parse(archive.journal_json),year=String(journal.transaction_date||'').slice(0,4);if(accountingClosedYear(year))throw new Error(`Tahun ${year} sudah ditutup dan jurnal tidak dapat dipulihkan.`);if(isJournalYearLocked(journal.transaction_date))throw new Error(`Tahun ${year} sedang dikunci oleh admin.`);db.exec('BEGIN IMMEDIATE');try{const result=db.prepare("INSERT INTO accounting_journal_entries (voucher_number,transaction_date,description,amount,transaction_type,legacy_user_id,source) VALUES (?,?,?,?,?,?, 'manual')").run(journal.voucher_number,journal.transaction_date,journal.description,Number(journal.amount||0),journal.transaction_type,String(user.username||'')),journalId=Number(result.lastInsertRowid),insert=db.prepare('INSERT INTO accounting_journal_lines (journal_id,account_code,description,debit,credit) VALUES (?,?,?,?,?)');for(const line of journal.lines||[])insert.run(journalId,line.account_code,line.description,Number(line.debit||0),Number(line.credit||0));db.prepare('UPDATE accounting_journal_archives SET restored_by=?,restored_at=CURRENT_TIMESTAMP,restored_journal_id=? WHERE id=?').run(String(user.username||''),journalId,id);db.exec('COMMIT');return accountingJournal(journalId);}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
const updateAccountingJournalWithYearLock=updateAccountingJournal;updateAccountingJournal=(id,input,user)=>{const journal=accountingJournal(id);assertJournalChangeAllowed(journal);return updateAccountingJournalWithYearLock(id,input,user);};
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8'};
itemInput=function(input,current={}){const item_code=String(input.item_code??current.item_code??'').trim().slice(0,80),item_name=String(input.item_name??current.item_name??'').trim().slice(0,255),item_type=String(input.item_type??current.item_type??'').trim();if(!item_code||!item_name)throw new Error('Kode dan nama barang wajib diisi.');if(!['Bahan Baku','Barang dalam Proses','Barang Jadi'].includes(item_type))throw new Error('Jenis barang wajib dipilih: Bahan Baku, Barang dalam Proses, atau Barang Jadi.');return {item_code,item_name,item_type,debit_sales_code:String(input.debit_sales_code??current.debit_sales_code??'').trim().slice(0,80),credit_sales_code:String(input.credit_sales_code??current.credit_sales_code??'').trim().slice(0,80),debit_purchase_code:String(input.debit_purchase_code??current.debit_purchase_code??'').trim().slice(0,80),credit_purchase_code:String(input.credit_purchase_code??current.credit_purchase_code??'').trim().slice(0,80),description:String(input.description??current.description??'').trim().slice(0,2000)};};

// Buat pemetaan awal sekali saja. Setelah itu perubahan selalu berasal dari
// Pengaturan rekening laporan dan tetap tersimpan di basis data.
ensureAccountingReportMappings();
createServer(async(req,res)=>{ const url=new URL(req.url,`http://${req.headers.host}`); try {
  // Berkas antarmuka wajib selalu baru. Perhitungan gaji tidak boleh memakai
  // JavaScript lama setelah modul diperbarui, walaupun browser masih terbuka.
  if(req.method==='GET'&&['/','/index.html','/app.js','/styles.css','/responsive-layout.css','/assets.js','/maturity-reminders.js','/jakarta-receivables.js','/jakarta-receivables.css','/piutang-labels.js','/accounting-lite.js','/accounting-lite.css','/sinosure.js','/sinosure-deliveries.js','/sinosure-wecom.js','/sinosure-sync.js','/sinosure-menu.js'].includes(url.pathname)){
    const requested=url.pathname==='/'?'/index.html':url.pathname;
    let content=await readFile(join(PUBLIC,requested));
    if(requested==='/index.html')content=Buffer.from(`${content.toString('utf8')}<link rel="stylesheet" href="/jakarta-receivables.css?v=5"><script src="/maturity-reminders.js?v=3"></script><script src="/jakarta-receivables.js?v=12"></script><script src="/piutang-labels.js?v=1"></script>`);
    res.writeHead(200,{'Content-Type':mime[extname(requested)]||'application/octet-stream','Cache-Control':'no-store, no-cache, must-revalidate, max-age=0','Pragma':'no-cache'});
    return res.end(content);
  }
  if(url.pathname==='/api/app-branding'&&req.method==='GET')return json(res,200,applicationBranding());
  if(url.pathname==='/api/app-branding/logo'&&req.method==='GET'){const branding=brandingRecord();if(!branding.logo_mime||!existsSync(BRANDING_LOGO_FILE))return json(res,404,{error:'Logo belum diatur.'});res.writeHead(200,{'Content-Type':branding.logo_mime,'Cache-Control':'no-store, no-cache, must-revalidate'});return res.end(readFileSync(BRANDING_LOGO_FILE));}
  if(url.pathname==='/api/auth/login'&&req.method==='POST') { const data=await readJson(req),user=db.prepare('SELECT * FROM app_users WHERE lower(username)=lower(?)').get(String(data.username||'').trim()); if(!user||!passwordMatches(data.password,user.password_hash))return json(res,401,{error:'Nama pengguna atau kata sandi salah.'}); const token=randomUUID();sessions.set(token,{userId:user.id,expires:Date.now()+12*60*60*1000});return json(res,200,{token,user:userPublic(user)}); }
  if(url.pathname==='/api/auth/me'&&req.method==='GET') { const user=sessionUser(req,url); return user?json(res,200,{user}):json(res,401,{error:'Silakan masuk terlebih dahulu.'}); }
  if(url.pathname==='/api/auth/logout'&&req.method==='POST') { sessions.delete(String(req.headers['x-cap-token']||''));return json(res,200,{ok:true}); }
  const user=sessionUser(req,url);
  if(url.pathname.startsWith('/api/')&&!user)return json(res,401,{error:'Silakan masuk terlebih dahulu.'});
  if(url.pathname==='/api/app-branding'&&req.method==='PUT'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengubah identitas aplikasi.'});return json(res,200,saveApplicationBranding(await readJson(req)));}
  if(url.pathname==='/api/app-branding/logo'&&req.method==='POST'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengubah logo aplikasi.'});return json(res,200,saveApplicationLogo(await readBuffer(req,2*1024*1024),req.headers['content-type']));}
  if(url.pathname==='/api/app-branding/logo'&&req.method==='DELETE'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengubah logo aplikasi.'});return json(res,200,clearApplicationLogo());}
  if(url.pathname==='/api/server/restart'&&req.method==='POST'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat memulai ulang server.'});scheduleServerRestart();return json(res,202,{ok:true,message:'Server sedang dimulai ulang. Halaman akan tersambung kembali otomatis.'});}
  if(url.pathname==='/api/module-installer/status'&&req.method==='GET'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat membuka Pemasang Modul.'});return json(res,200,{...moduleInstallerStatus(),modules:installedModuleRecords()});}
  if(url.pathname==='/api/module-installer/application-modules'&&req.method==='GET'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengelola modul aplikasi.'});return json(res,200,{modules:applicationModules()});}
  if(url.pathname==='/api/module-installer/application-modules'&&req.method==='PUT'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengelola modul aplikasi.'});return json(res,200,{module:setApplicationModuleState(await readJson(req),user)});}
  if(url.pathname==='/api/module-installer/install'&&req.method==='POST'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat memasang modul.'});const result=installModulePackage(await readBuffer(req));const restarting=restartWithRecovery(result.snapshot);return json(res,201,{ok:true,module:result.manifest,restarting,message:restarting?'Paket terpasang. CAP sedang dimulai ulang dan akan dipulihkan otomatis bila pemeriksaan kesehatan gagal.':'Paket terpasang. Jalankan ulang CAP untuk mengaktifkan perubahan.'});}
  if(url.pathname==='/api/module-installer/uninstall'&&req.method==='POST'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat menghapus modul.'});const result=uninstallModulePackage(await readJson(req));const restarting=restartWithRecovery();return json(res,200,{ok:true,module:result,restarting,message:restarting?`Modul ${result.title} dihapus. CAP sedang dimulai ulang.`:`Modul ${result.title} dihapus. Jalankan ulang CAP untuk menerapkan perubahan.`});}
  if(url.pathname==='/api/module-installer/restore'&&req.method==='POST'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat memulihkan modul.'});const data=await readJson(req),name=String(data.snapshot||'').split(/[\\/]/).pop(),snapshot=join(MODULE_SNAPSHOTS,name);if(!name||!existsSync(join(snapshot,'file-state.json')))throw new Error('Snapshot pemulihan tidak ditemukan.');const restarting=restartWithRecovery(snapshot,'restore');return json(res,200,{ok:true,restarting,message:restarting?'Pemulihan dijadwalkan. CAP akan kembali ke snapshot yang dipilih.':'Snapshot siap dipulihkan setelah CAP dijalankan ulang.'});}
  if(url.pathname==='/api/module-installer/diagnostic.zip'&&req.method==='GET'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat membuat Paket Diagnostik.'});const file=exportDiagnosticBundle(url.searchParams.get('include_database')==='1');res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="cap-diagnostic.zip"'});return res.end(file);}
  if(url.pathname==='/api/module-installer/developer-kit.zip'&&req.method==='GET'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengunduh Developer Kit.'});const file=exportDeveloperKit();res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="CAP-Codex-Module-Developer-Kit.zip"'});return res.end(file);}
  if(url.pathname==='/api/module-installer/database-backup.zip'&&req.method==='GET'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat membuat cadangan database.'});const file=exportDatabasePackage();res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="cap-database-backup.zip"'});return res.end(file);}
  if(url.pathname==='/api/module-installer/database-restore'&&req.method==='POST'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat memulihkan database.'});const result=prepareDatabaseRestore(await readBuffer(req));const restarting=restartWithRecovery(result.snapshot,'database-restore',result.pending);return json(res,200,{ok:true,restarting,backup:result.manifest,message:restarting?'Pemulihan database dijadwalkan. CAP akan dimulai ulang setelah snapshot dibuat.':'Cadangan database sudah diperiksa. Jalankan ulang CAP untuk menyelesaikan pemulihan.'});}
  if(url.pathname==='/api/warehouse'&&req.method==='POST')return json(res,201,saveWarehouseActivity(await readJson(req)));
  if(url.pathname==='/api/auth/password'&&req.method==='POST') { const data=await readJson(req),target=db.prepare('SELECT * FROM app_users WHERE id=?').get(user.id);if(!passwordMatches(data.current_password,target.password_hash))return json(res,400,{error:'Kata sandi saat ini tidak sesuai.'});if(!String(data.new_password??'').length)throw new Error('Kata sandi baru wajib diisi.');db.prepare('UPDATE app_users SET password_hash=? WHERE id=?').run(passwordHash(data.new_password),user.id);return json(res,200,{ok:true}); }
  if(url.pathname==='/api/auth/users'&&req.method==='GET') { if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengatur pengguna.'});return json(res,200,{users:db.prepare('SELECT id,username,role,modules,job_title,created_at FROM app_users ORDER BY role DESC,username').all().map(item=>({...item,job_title:String(item.job_title||''),modules:JSON.parse(item.modules||'[]')}))}); }
  if(url.pathname==='/api/auth/users'&&req.method==='POST') { if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengatur pengguna.'});const data=await readJson(req),username=String(data.username||'').trim(),jobTitle=String(data.job_title||'').trim().replace(/\s+/g,' ').slice(0,80);if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username))throw new Error('Nama pengguna 3–40 karakter: huruf, angka, titik, garis bawah atau minus.');if(!String(data.password??'').length)throw new Error('Kata sandi wajib diisi.');const modules=[...new Set((Array.isArray(data.modules)?data.modules:[]).map(String).filter(validModuleKey))];db.prepare("INSERT INTO app_users (username,password_hash,role,modules,job_title) VALUES (?,?, 'user',?,?)").run(username,passwordHash(data.password),JSON.stringify(modules),jobTitle);return json(res,201,{ok:true}); }
  const account=url.pathname.match(/^\/api\/auth\/users\/(\d+)$/);
  if(account&&req.method==='PATCH') { if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengatur pengguna.'});const data=await readJson(req),target=db.prepare('SELECT * FROM app_users WHERE id=?').get(account[1]);if(!target)throw new Error('Pengguna tidak ditemukan.');const jobTitle=String(data.job_title??target.job_title??'').trim().replace(/\s+/g,' ').slice(0,80);if(target.role==='master'){db.prepare('UPDATE app_users SET job_title=? WHERE id=?').run(jobTitle,target.id);return json(res,200,{ok:true});}const modules=[...new Set((Array.isArray(data.modules)?data.modules:[]).map(String).filter(validModuleKey))];if(data.password)db.prepare('UPDATE app_users SET modules=?,job_title=?,password_hash=? WHERE id=?').run(JSON.stringify(modules),jobTitle,passwordHash(data.password),target.id);else db.prepare('UPDATE app_users SET modules=?,job_title=? WHERE id=?').run(JSON.stringify(modules),jobTitle,target.id);return json(res,200,{ok:true}); }
  if(account&&req.method==='DELETE') { if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat menghapus pengguna.'});const target=db.prepare('SELECT * FROM app_users WHERE id=?').get(account[1]);if(!target)throw new Error('Pengguna tidak ditemukan.');if(target.role==='master')throw new Error('Akun master tidak dapat dihapus.');db.prepare('DELETE FROM app_users WHERE id=?').run(target.id);for(const [token,session] of sessions)if(session.userId===target.id)sessions.delete(token);return json(res,200,{ok:true}); }
  let module=requiredModule(url.pathname);
  if(url.pathname.startsWith('/api/online-shop/scans'))module='online_shop_scan';
  if(url.pathname==='/api/warehouse'||url.pathname==='/api/warehouse/upload'){
    module=({Packing:'warehouse_packing',Servis:'warehouse_servis',Produksi:'warehouse_produksi'})[url.searchParams.get('section')]||'warehouse_dashboard';
  }
  const requestedWarehouseImage=url.pathname.match(/^\/api\/warehouse\/image\/(\d+)$/);
  if(requestedWarehouseImage){
    const report=db.prepare('SELECT section FROM warehouse_reports WHERE id=?').get(requestedWarehouseImage[1]);
    module=({Packing:'warehouse_packing',Servis:'warehouse_servis',Produksi:'warehouse_produksi'})[report?.section]||'warehouse_dashboard';
  }
  if(module&&!canAccess(user,module))return json(res,403,{error:'Akun ini tidak memiliki akses ke modul tersebut.'});
  if(url.pathname==='/api/wecom-excel/settings'&&req.method==='GET')return json(res,200,{settings:wecomExcelSettings()});
  if(url.pathname==='/api/wecom-excel/settings'&&req.method==='PUT'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengubah koneksi WeCom.'});return json(res,200,{settings:saveWecomExcelSettings(await readJson(req))});}
  if(url.pathname==='/api/wecom-excel/test-message'&&req.method==='POST')return json(res,200,await sendWecomExcelTest(await readJson(req)));
  if(url.pathname==='/api/wecom-excel/contacts'&&req.method==='GET')return json(res,200,{contacts:await wecomExcelContacts()});
  if(url.pathname==='/api/wecom-excel/mass-message'&&req.method==='POST')return json(res,200,await sendWecomExcelMass(await readJson(req)));
  if(url.pathname==='/api/assets/sync'&&req.method==='POST')return json(res,200,assetSync(user));
  if(url.pathname==='/api/assets/sources'&&req.method==='GET')return json(res,200,{rows:assetSources(url.searchParams.get('mode')||'open')});
  if(url.pathname==='/api/assets/register'&&req.method==='GET')return json(res,200,{rows:assetRegister()});
  if(url.pathname==='/api/assets/replacement-candidates'&&req.method==='GET')return json(res,200,{rows:replacementCandidates(url.searchParams.get('asset_id'))});
  if(url.pathname==='/api/assets/allocate'&&req.method==='POST')return json(res,201,allocateAsset(await readJson(req),user));
  if(url.pathname==='/api/assets/manual'&&req.method==='POST')return json(res,201,createManualAsset(await readJson(req),user));
  const assetUpdateMatch=url.pathname.match(/^\/api\/assets\/(\d+)\/operational$/);
  if(assetUpdateMatch&&req.method==='POST')return json(res,200,updateAssetOperational(assetUpdateMatch[1],await readJson(req),user));
  if(url.pathname==='/api/assets/source/not-asset'&&req.method==='POST'){const data=await readJson(req);return json(res,200,assetMarkNotAsset(data.id,data.reason,user));}
  if(url.pathname==='/api/assets/audit'&&req.method==='GET')return json(res,200,{rows:db.prepare('SELECT * FROM asset_audit_log ORDER BY id DESC LIMIT 200').all()});
  if(url.pathname==='/api/accounting-lite/summary'&&req.method==='GET')return json(res,200,accountingSummary());
  if(url.pathname==='/api/accounting-lite/periods'&&req.method==='GET')return json(res,200,accountingPeriods());
  if(url.pathname==='/api/accounting-lite/annual-report-settings'&&req.method==='GET'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat membuka Pengaturan Catatan Atas.'});return json(res,200,accountingAnnualReportSettings(url.searchParams.get('year')||new Date().getFullYear()));}
  if(url.pathname==='/api/accounting-lite/annual-report-settings'&&req.method==='PUT')return json(res,200,saveAccountingAnnualReportSettings(url.searchParams.get('year')||new Date().getFullYear(),await readJson(req),user));
  if(url.pathname==='/api/accounting-lite/annual-report'&&req.method==='GET')return json(res,200,accountingAnnualReport(url.searchParams.get('year')||new Date().getFullYear(),url.searchParams.get('month')||''));
  if(url.pathname==='/api/accounting-lite/monthly-financial-report'&&req.method==='GET')return json(res,200,accountingMonthlyFinancialReport(url.searchParams.get('year')||new Date().getFullYear(),url.searchParams.get('month')||''));
  if(url.pathname==='/api/accounting-lite/year-close'&&req.method==='GET')return json(res,200,accountingClosingDashboard(url.searchParams.get('year')||new Date().getFullYear()));
  if(url.pathname==='/api/accounting-lite/year-close'&&req.method==='POST')throw new Error('Fungsi Tutup Buku otomatis telah dinonaktifkan. Gunakan Jurnal Baru untuk mencatat SA secara manual.');
  const accountingCloseAuditRoute=url.pathname.match(/^\/api\/accounting-lite\/year-close\/(\d+)\/audit$/);
  if(accountingCloseAuditRoute&&req.method==='POST')throw new Error('Audit Tutup Buku telah dinonaktifkan.');
  if(url.pathname==='/api/accounting-lite/accounts/next-code'&&req.method==='GET')return json(res,200,accountingSuggestedChildCode(url.searchParams.get('parent_code')||''));
  if(url.pathname==='/api/accounting-lite/accounts'&&req.method==='GET')return json(res,200,accountingAccounts());
  if(url.pathname==='/api/accounting-lite/accounts'&&req.method==='POST')return json(res,201,saveAccountingAccount(await readJson(req),user));
  if(url.pathname==='/api/accounting-lite/items'&&req.method==='GET')return json(res,200,accountingItems());
  if(url.pathname==='/api/accounting-lite/items'&&req.method==='POST')return json(res,201,saveAccountingItem(await readJson(req)));
  if(url.pathname==='/api/accounting-lite/items/standardize-finished-goods'&&req.method==='POST')return json(res,200,standardizeFinishedGoodsMappings(user));
  if(url.pathname==='/api/accounting-lite/operational-items'&&req.method==='GET')return json(res,200,operationalInventoryItems());
  if(url.pathname==='/api/accounting-lite/pib-settings'&&req.method==='GET')return json(res,200,accountingPibSettings());
  if(url.pathname==='/api/accounting-lite/pib-settings'&&req.method==='PUT')return json(res,200,saveAccountingPibSettings(await readJson(req,512000),user));
  if(url.pathname==='/api/accounting-lite/pib'&&req.method==='GET')return json(res,200,accountingPibList());
  if(url.pathname==='/api/accounting-lite/pib'&&req.method==='POST')return json(res,201,saveAccountingPib(await readJson(req,512000),user));
  const accountingPibRoute=url.pathname.match(/^\/api\/accounting-lite\/pib\/(\d+)$/);
  if(accountingPibRoute&&req.method==='GET')return json(res,200,pibPreview(pibTransaction(accountingPibRoute[1])));
  if(accountingPibRoute&&req.method==='PATCH')return json(res,200,updateAccountingPib(accountingPibRoute[1],await readJson(req,512000),user));
  if(accountingPibRoute&&req.method==='DELETE')return json(res,200,deleteAccountingPib(accountingPibRoute[1],user));
  const accountingPibPostRoute=url.pathname.match(/^\/api\/accounting-lite\/pib\/(\d+)\/post$/);
  if(accountingPibPostRoute&&req.method==='POST')return json(res,200,postAccountingPib(accountingPibPostRoute[1],await readJson(req,512000),user));
  if(url.pathname==='/api/accounting-lite/stock-reference'&&req.method==='GET')return json(res,200,accountingStockReference(url.searchParams.get('item_code')||''));
  if(url.pathname==='/api/accounting-lite/stock-history'&&req.method==='GET')return json(res,200,accountingStockHistory({start:url.searchParams.get('start')||'',end:url.searchParams.get('end')||'',kind:url.searchParams.get('kind')||'',search:url.searchParams.get('search')||'',limit:url.searchParams.get('limit')||100,offset:url.searchParams.get('offset')||0}));
  if(url.pathname==='/api/accounting-lite/stock-history/detail'&&req.method==='GET')return json(res,200,accountingStockHistoryDocument(url.searchParams.get('source')||'',url.searchParams.get('id')||''));
  if(url.pathname==='/api/accounting-lite/invoice-settings'&&req.method==='GET')return json(res,200,accountingInvoiceSettings());
  if(url.pathname==='/api/accounting-lite/invoice-settings'&&req.method==='PUT')return json(res,200,saveAccountingInvoiceSettings(await readJson(req,512000),user));
  if(url.pathname==='/api/accounting-lite/invoices'&&req.method==='GET')return json(res,200,accountingInvoices(url.searchParams.get('start')||'',url.searchParams.get('end')||'',url.searchParams.get('status')||''));
  if(url.pathname==='/api/accounting-lite/invoices'&&req.method==='POST')return json(res,201,saveAccountingInvoice(await readJson(req,512000),user));
  if(url.pathname==='/api/accounting-lite/invoices/candidates'&&req.method==='GET')return json(res,200,accountingInvoiceCandidates(url.searchParams.get('start')||'',url.searchParams.get('end')||'',url.searchParams.get('limit')||150));
  if(url.pathname==='/api/accounting-lite/invoice-stock'&&req.method==='GET'){const stock=legacyInvoiceStock(url.searchParams.get('voucher')||'');if(!stock)throw new Error('Transaksi stok historis tidak ditemukan.');return json(res,200,stock);}
  const accountingInvoicePreviewRoute=url.pathname.match(/^\/api\/accounting-lite\/invoices\/(\d+)\/posting-preview$/);
  if(accountingInvoicePreviewRoute&&req.method==='GET')return json(res,200,accountingInvoicePostingPreview(accountingInvoicePreviewRoute[1]));
  const accountingInvoiceRoute=url.pathname.match(/^\/api\/accounting-lite\/invoices\/(\d+)$/);
  if(accountingInvoiceRoute&&req.method==='GET')return json(res,200,accountingInvoice(accountingInvoiceRoute[1]));
  if(accountingInvoiceRoute&&req.method==='PATCH')return json(res,200,updateAccountingInvoice(accountingInvoiceRoute[1],await readJson(req,512000),user));
  if(accountingInvoiceRoute&&req.method==='DELETE')return json(res,200,deleteAccountingInvoice(accountingInvoiceRoute[1]));
  const accountingInvoicePostRoute=url.pathname.match(/^\/api\/accounting-lite\/invoices\/(\d+)\/post$/);
  if(accountingInvoicePostRoute&&req.method==='POST')return json(res,200,postAccountingInvoice(accountingInvoicePostRoute[1],user,await readJson(req,512000)));
  if(url.pathname==='/api/accounting-lite/inventory-documents'&&req.method==='GET')return json(res,200,inventoryDocuments(url.searchParams.get('limit')||50));
  if(url.pathname==='/api/accounting-lite/inventory-documents'&&req.method==='POST')return json(res,201,saveInventoryDocument(await readJson(req),user));
  const inventoryDocumentRoute=url.pathname.match(/^\/api\/accounting-lite\/inventory-documents\/(\d+)$/);
  if(inventoryDocumentRoute&&req.method==='GET')return json(res,200,accountingInventoryDocument(inventoryDocumentRoute[1]));
  if(inventoryDocumentRoute&&req.method==='PATCH')return json(res,200,replaceInventoryDocument(inventoryDocumentRoute[1],await readJson(req),user));
  if(inventoryDocumentRoute&&req.method==='DELETE')return json(res,200,deleteInventoryDocument(inventoryDocumentRoute[1]));
  if(url.pathname==='/api/accounting-lite/suppliers'&&req.method==='GET')return json(res,200,accountingSuppliers());
  if(url.pathname==='/api/accounting-lite/suppliers'&&req.method==='POST')return json(res,201,saveAccountingSupplier(await readJson(req)));
  if(url.pathname==='/api/accounting-lite/journals'&&req.method==='GET')return json(res,200,accountingJournalData(url.searchParams.get('start')||'',url.searchParams.get('end')||'',url.searchParams.get('limit')||200,url.searchParams.get('offset')||0));
  if(url.pathname==='/api/accounting-lite/journals'&&req.method==='POST')return json(res,201,saveAccountingJournal(await readJson(req),user));
  if(url.pathname==='/api/accounting-lite/settings'&&req.method==='GET')return json(res,200,accountingModuleSettings());
  if(url.pathname==='/api/accounting-lite/settings'&&req.method==='PUT')return json(res,200,saveAccountingModuleSettings(await readJson(req),user));
  if(url.pathname==='/api/accounting-lite/journal-settings'&&req.method==='GET')return json(res,200,journalLockYears());
  if(url.pathname==='/api/accounting-lite/journal-settings'&&req.method==='PUT')return json(res,200,saveJournalLocks(await readJson(req),user));
  if(url.pathname==='/api/accounting-lite/journal-archives'&&req.method==='GET'){if(user.role!=='master')throw new Error('Hanya akun master yang dapat membuka arsip jurnal.');return json(res,200,journalArchives());}
  const journalArchiveRestore=url.pathname.match(/^\/api\/accounting-lite\/journal-archives\/(\d+)\/restore$/);
  if(journalArchiveRestore&&req.method==='POST')return json(res,200,restoreArchivedJournal(journalArchiveRestore[1],user));
  if(url.pathname==='/api/accounting-lite/ledger'&&req.method==='GET')return json(res,200,accountingLedger(url.searchParams.get('account_code')||'',url.searchParams.get('start')||'',url.searchParams.get('end')||'',url.searchParams.get('limit')||100,url.searchParams.get('offset')||0,url.searchParams.get('view')||'audit'));
  const accountingAccountAuditRoute=url.pathname.match(/^\/api\/accounting-lite\/accounts\/(.+)\/audit$/);
  if(accountingAccountAuditRoute&&req.method==='GET')return json(res,200,accountingAccountAudit(decodeURIComponent(accountingAccountAuditRoute[1]),url.searchParams.get('limit')||50));
  const accountingAccountRoute=url.pathname.match(/^\/api\/accounting-lite\/accounts\/(.+)$/);
  const accountingItemRoute=url.pathname.match(/^\/api\/accounting-lite\/items\/(.+)$/);
  const accountingSupplierRoute=url.pathname.match(/^\/api\/accounting-lite\/suppliers\/(.+)$/);
  if(accountingAccountRoute&&req.method==='GET'){const account=accountingAccount(decodeURIComponent(accountingAccountRoute[1]));return json(res,200,{...account,opening:accountingOpeningSide(account.account_code)});}
  if(accountingAccountRoute&&req.method==='PATCH')return json(res,200,updateAccountingAccount(decodeURIComponent(accountingAccountRoute[1]),await readJson(req),user));
  if(accountingItemRoute&&req.method==='GET')return json(res,200,accountingItem(decodeURIComponent(accountingItemRoute[1])));
  if(accountingItemRoute&&req.method==='PATCH')return json(res,200,updateAccountingItem(decodeURIComponent(accountingItemRoute[1]),await readJson(req)));
  if(accountingSupplierRoute&&req.method==='GET')return json(res,200,accountingSupplier(decodeURIComponent(accountingSupplierRoute[1])));
  if(accountingSupplierRoute&&req.method==='PATCH')return json(res,200,updateAccountingSupplier(decodeURIComponent(accountingSupplierRoute[1]),await readJson(req),user));
  const accountingJournalRoute=url.pathname.match(/^\/api\/accounting-lite\/journals\/(\d+)$/);
  if(accountingJournalRoute&&req.method==='GET')return json(res,200,accountingJournal(accountingJournalRoute[1]));
  if(accountingJournalRoute&&req.method==='PATCH')return json(res,200,updateAccountingJournal(accountingJournalRoute[1],await readJson(req),user));
  if(accountingJournalRoute&&req.method==='DELETE')return json(res,200,archiveAccountingJournal(accountingJournalRoute[1],user));
  if(url.pathname==='/api/accounting-lite/trial-balance'&&req.method==='GET')return json(res,200,accountingTrialBalance(url.searchParams.get('start')||'',url.searchParams.get('end')||''));
  if(url.pathname==='/api/accounting-lite/general-journal'&&req.method==='GET')return json(res,200,accountingGeneralJournal(url.searchParams.get('start')||'',url.searchParams.get('end')||'',url.searchParams.get('limit')||200,url.searchParams.get('offset')||0));
  if(url.pathname==='/api/accounting-lite/subsidiary-accounts'&&req.method==='GET')return json(res,200,accountingSubsidiaryAccounts(url.searchParams.get('kind')||'',url.searchParams.get('search')||''));
  if(url.pathname==='/api/accounting-lite/subsidiary-ledger'&&req.method==='GET')return json(res,200,accountingSubsidiaryLedger(url.searchParams.get('start')||'',url.searchParams.get('end')||'',url.searchParams.get('limit')||200,url.searchParams.get('offset')||0,url.searchParams.get('kind')||'',url.searchParams.get('account_code')||''));
  if(url.pathname==='/api/accounting-lite/adjusted-trial-balance'&&req.method==='GET')return json(res,200,accountingAdjustedTrialBalance(url.searchParams.get('start')||'',url.searchParams.get('end')||''));
  if(url.pathname==='/api/accounting-lite/hpp'&&req.method==='GET')return json(res,200,accountingHpp(url.searchParams.get('start')||'',url.searchParams.get('end')||''));
  if(url.pathname==='/api/accounting-lite/account-list'&&req.method==='GET')return json(res,200,accountingAccountList());
  if(url.pathname==='/api/accounting-lite/report-mappings'&&req.method==='GET')return json(res,200,accountingReportMappingSettings(url.searchParams.get('report_kind')||''));
  if(url.pathname==='/api/accounting-lite/report-mappings'&&req.method==='PUT'){const input=await readJson(req,512000),reportKind=url.searchParams.get('report_kind')||'';return json(res,200,input?.special_only?saveAccountingReportSpecialLines(reportKind,input,user):saveAccountingReportMappings(reportKind,input,user));}
  if(url.pathname==='/api/accounting-lite/stock-card'&&req.method==='GET')return json(res,200,accountingStockCard(url.searchParams.get('start')||'',url.searchParams.get('end')||'',url.searchParams.get('item_code')||''));
  if(url.pathname==='/api/accounting-lite/stock-summary'&&req.method==='GET')return json(res,200,accountingStockSummary(url.searchParams.get('start')||'',url.searchParams.get('end')||''));
  if(url.pathname==='/api/accounting-lite/export.xlsx'&&req.method==='GET'){const kind=url.searchParams.get('report')||'',report=kind==='annual'?accountingAnnualWorkbook(url.searchParams.get('year')||new Date().getFullYear(),url.searchParams.get('month')||''):kind==='monthly-financial'?accountingMonthlyFinancialWorkbook(url.searchParams.get('year')||new Date().getFullYear(),url.searchParams.get('month')||''):accountingExportExcel(kind,url.searchParams.get('start')||'',url.searchParams.get('end')||'',url.searchParams.get('account_code')||'',url.searchParams.get('item_code')||'');res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${report.name}"`});return res.end(report.file);}
  if(url.pathname==='/api/accounting-lite/balance-sheet'&&req.method==='GET')return json(res,200,accountingBalanceReport(url.searchParams.get('start')||'',url.searchParams.get('end')||''));
  if(url.pathname==='/api/accounting-lite/income-statement'&&req.method==='GET')return json(res,200,accountingIncomeReport(url.searchParams.get('start')||'',url.searchParams.get('end')||''));
  const businessTrip=url.pathname.match(/^\/api\/payroll\/business-trips\/(\d+)$/);
  if(businessTrip&&req.method==='PATCH')return json(res,200,saveBusinessTrip(await readJson(req),businessTrip[1]));
  if(businessTrip&&req.method==='DELETE')return json(res,200,deleteBusinessTrip(businessTrip[1]));
  if(url.pathname==='/api/payroll/business-trips'&&req.method==='POST')return json(res,201,saveBusinessTrip(await readJson(req)));
  if(url.pathname==='/api/online-shop/reports'&&req.method==='GET')return json(res,200,onlineShopData(Object.fromEntries(url.searchParams)));
  if(url.pathname==='/api/online-shop/scans'&&req.method==='GET')return json(res,200,onlineShopScanData(Object.fromEntries(url.searchParams)));
  if(url.pathname==='/api/online-shop/scans/import'&&req.method==='POST')return json(res,201,importOnlineShopScans(await readBuffer(req,15*1024*1024),decodeURIComponent(url.searchParams.get('name')||'scan-resi.xlsx')));
  if(url.pathname==='/api/online-shop/reports'&&req.method==='POST')return json(res,201,saveOnlineShopReport(await readJson(req)));
  const onlineShopMedia=url.pathname.match(/^\/api\/online-shop\/reports\/(\d+)\/media$/);
  if(onlineShopMedia&&req.method==='POST')return json(res,201,saveOnlineShopMedia(onlineShopMedia[1],await readBuffer(req),decodeURIComponent(url.searchParams.get('name')||'berkas'),req.headers['content-type']||'application/octet-stream'));
  const onlineShopMediaFile=url.pathname.match(/^\/api\/online-shop\/media\/(\d+)$/);
  if(onlineShopMediaFile&&req.method==='GET'){const item=db.prepare('SELECT mime_type,media_data FROM online_shop_report_media WHERE id=?').get(onlineShopMediaFile[1]);if(!item)return json(res,404,{error:'Media tidak ditemukan.'});res.writeHead(200,{'Content-Type':item.mime_type,'Cache-Control':'private, max-age=3600'});return res.end(item.media_data);}
  if(url.pathname==='/api/online-shop/export.xlsx'&&req.method==='GET'){const file=exportOnlineShopExcel(Object.fromEntries(url.searchParams));res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="pelaporan-online-shop.xlsx"'});return res.end(file);}
  if(url.pathname==='/api/online-shop/export-videos.zip'&&req.method==='GET'){const file=exportOnlineShopVideos(Object.fromEntries(url.searchParams));res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="video-pelaporan-online-shop.zip"'});return res.end(file);}
  if(url.pathname==='/api/payroll/attendance/export'&&req.method==='GET'){const file=exportAttendanceLogFile(url.searchParams.get('start')||'',url.searchParams.get('end')||'',url.searchParams.get('payment')||'all',url.searchParams.get('employee')||'');res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="log-absensi.xlsx"'});return res.end(file);}
  if(url.pathname==='/api/payroll/shift-events'&&req.method==='GET')return json(res,200,{events:shiftEventData()});
  if(url.pathname==='/api/payroll/shift-events'&&req.method==='POST'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengatur Event Khusus.'});return json(res,201,{events:saveShiftEvent(await readJson(req))});}
  const shiftEvent=url.pathname.match(/^\/api\/payroll\/shift-events\/(\d+)$/);
  if(shiftEvent&&req.method==='DELETE'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengatur Event Khusus.'});return json(res,200,{events:deleteShiftEvent(shiftEvent[1])});}
  if(url.pathname==='/api/whatsapp'&&req.method==='GET')return json(res,200,whatsappData());
  if(url.pathname==='/api/whatsapp/settings'&&req.method==='POST'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengubah pengaturan WhatsApp.'});return json(res,200,saveWhatsappSettings(await readJson(req)));}
  if(url.pathname==='/api/whatsapp/contacts'&&req.method==='POST'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengubah kontak WhatsApp.'});return json(res,201,saveWhatsappContact(await readJson(req)));}
  const whatsappContactMatch=url.pathname.match(/^\/api\/whatsapp\/contacts\/(\d+)$/);
  if(whatsappContactMatch&&req.method==='PUT'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengubah kontak WhatsApp.'});return json(res,200,updateWhatsappContact(Number(whatsappContactMatch[1]),await readJson(req)));}
  if(url.pathname==='/api/whatsapp/classifications'&&req.method==='POST'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengatur klasifikasi nomor.'});return json(res,201,saveWhatsappClassification(await readJson(req)));}
  const whatsappClassificationMatch=url.pathname.match(/^\/api\/whatsapp\/classifications\/(\d+)$/);
  if(whatsappClassificationMatch&&(req.method==='PUT'||req.method==='DELETE')){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat mengatur klasifikasi nomor.'});const classificationId=Number(whatsappClassificationMatch[1]);return json(res,200,req.method==='PUT'?saveWhatsappClassification(await readJson(req),classificationId):deleteWhatsappClassification(classificationId));}
  if(url.pathname==='/api/whatsapp/send'&&req.method==='POST')return json(res,200,await sendWhatsapp(await readJson(req)));
  if(url.pathname==='/api/payroll/export'&&req.method==='GET'){const payment=payrollPayment(url.searchParams.get('payment')),file=exportPayroll(url.searchParams.get('upload'),payment,url.searchParams.get('start')||'',url.searchParams.get('end')||'');res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="rekap-gaji-gudang.xlsx"'});return res.end(file);}
  if(url.pathname==='/api/erp/login-form'&&req.method==='GET'){
    const erpResponse=await fetch(ERP_URL,{redirect:'follow'});
    if(!erpResponse.ok)throw new Error('Halaman login ERP tidak dapat dihubungi.');
    const html=await erpResponse.text(),hidden=[];
    for(const tag of html.match(/<input\b[^>]*>/gi)||[]){
      if(!/\btype\s*=\s*["']hidden["']/i.test(tag))continue;
      const name=tag.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1],value=tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1]||'';
      if(name)hidden.push({name,value});
    }
    return json(res,200,{action:ERP_URL,hidden});
  }
  if(url.pathname==='/api/payroll/payments'&&req.method==='GET')return json(res,200,paymentLogData(url.searchParams.get('start'),url.searchParams.get('end')));if(url.pathname==='/api/payroll/payments'&&req.method==='POST')return json(res,201,savePaymentLog(await readJson(req)));if(url.pathname==='/api/payroll/saturday-completion'&&req.method==='POST')return json(res,200,completeSaturdayAttendance(await readJson(req)));if(url.pathname==='/api/payroll/saturday-dismiss'&&req.method==='POST')return json(res,200,dismissSaturdayAttendance(await readJson(req)));
  if(url.pathname==='/api/warehouse/upload'&&req.method==='POST'){const name=decodeURIComponent(url.searchParams.get('name')||'laporan-gudang.png');const section=['Packing','Servis','Produksi'].includes(url.searchParams.get('section'))?url.searchParams.get('section'):'Servis';return json(res,201,saveWarehouseReport(await readBuffer(req,12*1024*1024),name,section,req.headers['content-type']||'image/png'));}
  if(url.pathname==='/api/warehouse/ocr-status'&&req.method==='GET')return json(res,200,ocrStatus());
  const warehouseImage=url.pathname.match(/^\/api\/warehouse\/image\/(\d+)$/);if(warehouseImage&&req.method==='GET'){const image=db.prepare('SELECT image_mime,image_data FROM warehouse_reports WHERE id=?').get(warehouseImage[1]);if(!image)return json(res,404,{error:'Gambar tidak ditemukan.'});res.writeHead(200,{'Content-Type':image.image_mime,'Cache-Control':'private, max-age=3600'});return res.end(image.image_data);}
  if(url.pathname==='/api/returns/incoming'&&req.method==='GET')return json(res,200,returnIncomingData(url.searchParams.get('search'),url.searchParams.get('start'),url.searchParams.get('end')));
  if(url.pathname==='/api/returns/incoming/upload'&&req.method==='POST'){const name=decodeURIComponent(url.searchParams.get('name')||'resi-retur.csv').replace(/[^\w .()\-]/g,'_');if(!name.toLowerCase().endsWith('.csv'))throw new Error('Unggah berkas CSV hasil pemindaian.');return json(res,201,importIncomingReturns(await readBuffer(req),name));}
  const incoming=url.pathname.match(/^\/api\/returns\/incoming\/(\d+)$/);if(incoming&&req.method==='PATCH'){const data=await readJson(req),courier=String(data.courier||'').trim().slice(0,80);if(!courier)throw new Error('Pilih jasa kirim.');db.prepare('UPDATE return_incoming_shipments SET courier=? WHERE id=?').run(courier,incoming[1]);return json(res,200,returnIncomingData(data.search,data.start,data.end));}
  if(url.pathname==='/api/payroll/overtime/settings'&&req.method==='POST')return json(res,200,saveCashOvertimeSettings(await readJson(req)));
  if(url.pathname==='/api/payroll/overtime'&&req.method==='POST')return json(res,201,saveCashOvertime(await readJson(req)));
  if(url.pathname==='/api/finance/office-stock'&&req.method==='GET')return json(res,200,officeStockData(url.searchParams.get('start')||'',url.searchParams.get('end')||''));
  if(url.pathname==='/api/finance/office-stock/items'&&req.method==='POST')return json(res,201,saveOfficeStockItem(await readJson(req)));
  if(url.pathname==='/api/finance/office-stock/transactions'&&req.method==='POST')return json(res,201,saveOfficeStockTransaction(await readJson(req)));
  const officeStockTransactionRoute=url.pathname.match(/^\/api\/finance\/office-stock\/transactions\/(\d+)$/);
  if(officeStockTransactionRoute&&req.method==='PATCH')return json(res,200,updateOfficeStockTransaction(Number(officeStockTransactionRoute[1]),await readJson(req)));
  if(url.pathname==='/api/finance/petty-cash'&&req.method==='GET')return json(res,200,pettyCashData(url.searchParams.get('start')||'',url.searchParams.get('end')||''));
  if(url.pathname==='/api/sinosure'&&req.method==='GET')return json(res,200,sinosureData());
  if(url.pathname==='/api/sinosure/client-codes'&&req.method==='GET')return json(res,200,{records:sinosureClientCodes()});
  if(url.pathname==='/api/sinosure/deliveries'&&req.method==='GET')return json(res,200,{records:sinosureDeliveries(),clients:sinosureClientCodes()});
  if(url.pathname==='/api/sinosure/deliveries/wedrive-status'&&req.method==='GET')return json(res,200,{folder:sinosureWeDriveFolder,imports:sinosureWeDriveStatus()});
  if(url.pathname==='/api/sinosure/deliveries/wedrive-files'&&req.method==='GET')return json(res,200,{folder:sinosureWeDriveFolder,files:sinosureWeDriveFiles()});
  if(url.pathname==='/api/sinosure/deliveries/wedrive-files'&&req.method==='PUT')return json(res,200,{files:saveSinosureWeDriveFiles((await readJson(req)).paths)});
  if(url.pathname==='/api/sinosure/deliveries/sync-wedrive'&&req.method==='POST')return json(res,200,syncSinosureWeDrive());
  if(url.pathname==='/api/sinosure/sync'&&req.method==='GET')return json(res,200,sinosureSyncData());
  const sinosureSyncSourceRoute=url.pathname.match(/^\/api\/sinosure\/sync\/(deliveries|contract_verification|requirement_documents)$/);
  if(sinosureSyncSourceRoute&&req.method==='PUT')return json(res,200,saveSinosureSyncSource(sinosureSyncSourceRoute[1],await readJson(req),user));
  if(sinosureSyncSourceRoute&&req.method==='POST')return json(res,200,await syncSinosureCategory(sinosureSyncSourceRoute[1],user));
  if(url.pathname==='/api/sinosure/sync/all'&&req.method==='POST')return json(res,200,await syncAllSinosure(user));
  if(url.pathname==='/api/sinosure/wecom'&&req.method==='GET')return json(res,200,{settings:sinosureWecomSettings()});
  if(url.pathname==='/api/sinosure/wecom/settings'&&req.method==='PUT')return json(res,200,{settings:saveSinosureWecomSettings(await readJson(req))});
  if(url.pathname==='/api/sinosure/wecom/files'&&req.method==='GET')return json(res,200,{files:await wecomDeliveryFiles()});
  if(url.pathname==='/api/sinosure/wecom/files'&&req.method==='PUT')return json(res,200,{files:await saveSinosureWecomFiles((await readJson(req)).file_ids)});
  if(url.pathname==='/api/sinosure/wecom/sync'&&req.method==='POST')return json(res,200,await syncSinosureWecom());
  if(url.pathname==='/api/sinosure/deliveries/import'&&req.method==='POST')return json(res,201,importSinosureDeliveries(await readBuffer(req),decodeURIComponent(url.searchParams.get('name')||'pengiriman.xlsx')));
  if(url.pathname==='/api/sinosure/deliveries'&&req.method==='POST')return json(res,201,{id:saveSinosureDelivery(await readJson(req))});
  const sinosureDeliveryRoute=url.pathname.match(/^\/api\/sinosure\/deliveries\/(\d+)$/);
  if(sinosureDeliveryRoute&&req.method==='PATCH')return json(res,200,{id:saveSinosureDelivery(await readJson(req),sinosureDeliveryRoute[1])});
  if(sinosureDeliveryRoute&&req.method==='DELETE'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat menghapus pengiriman.'});db.prepare('DELETE FROM sinosure_deliveries WHERE id=?').run(sinosureDeliveryRoute[1]);return json(res,200,{ok:true});}
  if(url.pathname==='/api/sinosure/client-codes'&&req.method==='POST')return json(res,201,{id:saveSinosureClientCode(await readJson(req))});
  const sinosureClientCodeRoute=url.pathname.match(/^\/api\/sinosure\/client-codes\/(\d+)$/);
  if(sinosureClientCodeRoute&&req.method==='PATCH')return json(res,200,{id:saveSinosureClientCode(await readJson(req),sinosureClientCodeRoute[1])});
  if(sinosureClientCodeRoute&&req.method==='DELETE'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat menghapus code client.'});const result=db.prepare('DELETE FROM sinosure_client_codes WHERE id=?').run(sinosureClientCodeRoute[1]);if(!result.changes)throw new Error('Code client tidak ditemukan.');return json(res,200,{ok:true});}
  if(url.pathname==='/api/sinosure/partners'&&req.method==='POST'){if(user.role!=='master')return json(res,403,{error:'Hanya akun master yang dapat menambah perusahaan penandatangan.'});return json(res,201,{id:sinosurePartner(await readJson(req))});}
  if(url.pathname==='/api/sinosure/contracts'&&req.method==='POST')return json(res,201,{id:saveSinosureContract(await readJson(req),user)});
  const sinosureContractRoute=url.pathname.match(/^\/api\/sinosure\/contracts\/(\d+)$/);
  if(sinosureContractRoute&&req.method==='PATCH')return json(res,200,{id:saveSinosureContract(await readJson(req),user,sinosureContractRoute[1])});
  const sinosureDocumentRoute=url.pathname.match(/^\/api\/sinosure\/contracts\/(\d+)\/documents\/(mou|nib|npwp|tt_proof|power_of_attorney)$/);
  if(sinosureDocumentRoute&&req.method==='POST'){const id=saveSinosureDocument(sinosureDocumentRoute[1],sinosureDocumentRoute[2],await readBuffer(req),decodeURIComponent(url.searchParams.get('name')||'dokumen'),req.headers['content-type'],user);return json(res,201,{id,export:await exportSinosureDocumentToWecom(id,user)});}
  const sinosureFileRoute=url.pathname.match(/^\/api\/sinosure\/documents\/(\d+)$/);
  if(sinosureFileRoute&&req.method==='GET'){const item=db.prepare('SELECT original_name,mime_type,file_data FROM sinosure_documents WHERE id=?').get(sinosureFileRoute[1]);if(!item)return json(res,404,{error:'Dokumen tidak ditemukan.'});res.writeHead(200,{'Content-Type':item.mime_type,'Content-Disposition':`inline; filename="${item.original_name.replace(/"/g,'')}`,'Cache-Control':'private, max-age=3600'});return res.end(item.file_data);}
  if(url.pathname==='/api/finance/company-expenses'&&req.method==='GET')return json(res,200,companyExpenseDashboard(url.searchParams.get('mode')||'weekly',url.searchParams.get('anchor')||'',url.searchParams.get('category')||''));
  if(url.pathname==='/api/finance/petty-cash'&&req.method==='POST')return json(res,201,savePettyCash(await readJson(req)));
  if(url.pathname==='/api/finance/petty-cash/export'&&req.method==='GET'){const file=exportPettyCashExcel(url.searchParams.get('start')||'',url.searchParams.get('end')||'');res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="pengeluaran-kas-kecil.xlsx"'});return res.end(file);}
  if(url.pathname==='/api/finance/petty-cash/import'&&req.method==='POST'){const name=decodeURIComponent(url.searchParams.get('name')||'kas-kecil.xlsx').replace(/[^\w .()\-]/g,'_');return json(res,201,importPettyCashExcel(await readBuffer(req),name));}
  if(url.pathname==='/api/finance/petty-cash/import-image'&&req.method==='POST'){const name=decodeURIComponent(url.searchParams.get('name')||'rekap-kas.png').replace(/[^\w .()\-]/g,'_');return json(res,201,importPettyCashImage(await readBuffer(req,12*1024*1024),name));}
  const pettyCashRecord=url.pathname.match(/^\/api\/finance\/petty-cash\/(\d+)$/);
  if(pettyCashRecord&&req.method==='PATCH'){const existing=db.prepare('SELECT source_file FROM petty_cash_transactions WHERE id=?').get(pettyCashRecord[1]);if(!existing)throw new Error('Transaksi Kas Kecil tidak ditemukan.');const item=normalizePettyCash(await readJson(req),existing.source_file);db.prepare('UPDATE petty_cash_transactions SET transaction_date=?,category=?,other_category=?,person_name=?,source_number=?,description=?,amount=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(item.transaction_date,item.category,item.other_category,item.person_name,item.source_number,item.description,item.amount,pettyCashRecord[1]);return json(res,200,{id:Number(pettyCashRecord[1]),...item});}
  if(pettyCashRecord&&req.method==='DELETE'){const result=db.prepare('DELETE FROM petty_cash_transactions WHERE id=?').run(pettyCashRecord[1]);if(!result.changes)throw new Error('Transaksi Kas Kecil tidak ditemukan.');return json(res,200,{ok:true});}
  if(url.pathname==='/api/maturity-reminders'&&req.method==='GET')return json(res,200,maturityData());
  if(url.pathname==='/api/jakarta-receivables/export.xlsx'&&req.method==='GET'){const year=url.searchParams.get('year')||String(new Date().getFullYear());const file=exportJakartaReceivables(year);res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="laporan-piutang-jakarta-${year}.xlsx"`});return res.end(file);}
  if(url.pathname==='/api/jakarta-receivables/options'&&req.method==='GET')return json(res,200,jakartaReceivableOptions());
  if(url.pathname==='/api/jakarta-receivables/reminders'&&req.method==='GET')return json(res,200,jakartaReceivableReminderData());
  if(url.pathname==='/api/jakarta-receivables/stores'&&req.method==='GET')return json(res,200,{stores:jakartaStores()});
  if(url.pathname==='/api/jakarta-receivables/stores'&&req.method==='POST')return json(res,201,{store_name:saveJakartaStore(await readJson(req,512000),user)});
  if(url.pathname==='/api/jakarta-receivables'&&req.method==='GET')return json(res,200,jakartaReceivables());
  if(url.pathname==='/api/jakarta-receivables/classifications'&&req.method==='GET')return json(res,200,{classifications:jakartaClassifications()});
  if(url.pathname==='/api/jakarta-receivables/classifications'&&req.method==='POST')return json(res,201,{id:saveJakartaClassification(await readJson(req,512000),user)});
  if(url.pathname==='/api/jakarta-receivables/terms'&&req.method==='GET')return json(res,200,jakartaTermSettings());
  if(url.pathname==='/api/jakarta-receivables/terms'&&req.method==='PUT')return json(res,200,saveJakartaTermSettings(await readJson(req,512000),user));
  const jakartaClassificationPath=url.pathname.match(/^\/api\/jakarta-receivables\/classifications\/(\d+)$/);
  if(jakartaClassificationPath&&req.method==='PUT')return json(res,200,{id:saveJakartaClassification(await readJson(req,512000),user,jakartaClassificationPath[1])});
  if(jakartaClassificationPath&&req.method==='DELETE')return json(res,200,deleteJakartaClassification(Number(jakartaClassificationPath[1])));
  if(url.pathname==='/api/jakarta-receivables/invoices'&&req.method==='POST')return json(res,201,{id:saveJakartaInvoice(await readJson(req,512000),user)});
  const jakartaInvoicePath=url.pathname.match(/^\/api\/jakarta-receivables\/invoices\/(\d+)$/);
  if(jakartaInvoicePath&&req.method==='PUT')return json(res,200,{id:updateJakartaInvoice(Number(jakartaInvoicePath[1]),await readJson(req,512000))});
  if(jakartaInvoicePath&&req.method==='DELETE')return json(res,200,deleteJakartaInvoice(Number(jakartaInvoicePath[1])));
  if(url.pathname==='/api/jakarta-receivables/import'&&req.method==='POST')return json(res,201,importJakartaReceivables(await readBuffer(req),user));
  if(url.pathname==='/api/jakarta-receivables/payments'&&req.method==='POST')return json(res,201,{id:saveJakartaPayment(await readJson(req,512000),user)});
  const jakartaPaymentPath=url.pathname.match(/^\/api\/jakarta-receivables\/payments\/(\d+)$/);
  if(jakartaPaymentPath&&req.method==='PUT')return json(res,200,{id:updateJakartaPayment(Number(jakartaPaymentPath[1]),await readJson(req,512000))});
  if(jakartaPaymentPath&&req.method==='DELETE')return json(res,200,deleteJakartaPayment(Number(jakartaPaymentPath[1])));
  if(url.pathname==='/api/jakarta-receivables/sync-source-payments'&&req.method==='POST')return json(res,200,syncJakartaSourcePayments(user));
  if(url.pathname==='/api/maturity-reminders'&&req.method==='POST')return json(res,201,{id:maturityRecord(await readJson(req),user)});
  if(url.pathname==='/api/maturity-reminders/settings'&&req.method==='PUT')return json(res,200,saveMaturitySettings(await readJson(req),user));
  if(url.pathname==='/api/maturity-reminders/import'&&req.method==='POST'){const name=decodeURIComponent(url.searchParams.get('name')||'kospin-cek-giro.xlsx').replace(/[^\w .()\-]/g,'_');if(!/\.xlsx$/i.test(name))throw new Error('Unggah berkas Excel .xlsx.');return json(res,201,importMaturityExcel(await readBuffer(req),name,user));}
  const maturityRoute=url.pathname.match(/^\/api\/maturity-reminders\/(\d+)$/);
  if(maturityRoute&&req.method==='PATCH')return json(res,200,{id:maturityRecord(await readJson(req),user,maturityRoute[1])});
  if(maturityRoute&&req.method==='DELETE'){const result=db.prepare('DELETE FROM maturity_instruments WHERE id=?').run(maturityRoute[1]);if(!result.changes)throw new Error('Data instrumen tidak ditemukan.');return json(res,200,{ok:true});}
  if(url.pathname==='/api/returns'&&req.method==='GET')return json(res,200,returnsData(url.searchParams.get('upload'),url.searchParams.get('start'),url.searchParams.get('end'))); if(url.pathname==='/api/returns/rebuild'&&req.method==='POST')return json(res,200,rebuildReturnData()); if(url.pathname==='/api/returns/upload'&&req.method==='POST'){const name=decodeURIComponent(url.searchParams.get('name')||'data-retur.xlsx').replace(/[^\w .()\-]/g,'_');if(!name.toLowerCase().endsWith('.xlsx'))throw new Error('Unggah berkas Excel .xlsx.');const result=importExcel(await readBuffer(req),name);return json(res,201,{...result,data:returnsData(result.id)});} if(url.pathname==='/api/warehouse'&&req.method==='GET')return json(res,200,warehouseData(url.searchParams.get('section'))); if(url.pathname==='/api/warehouse'&&req.method==='POST'){saveWarehouseActivity(await readBuffer(req),name,section,req.headers['content-type']||'image/png');return json(res,201,warehouseData());} if(url.pathname==='/api/payroll'&&req.method==='GET')return json(res,200,payrollData(url.searchParams.get('upload'),url.searchParams.get('payment'))); if(url.pathname==='/api/payroll/attendance/edit'&&req.method==='POST')return json(res,200,editPayrollAttendance(await readJson(req))); if(url.pathname==='/api/payroll/upload'&&req.method==='POST'){const name=decodeURIComponent(url.searchParams.get('name')||'absensi.xls').replace(/[^\w .()\-]/g,'_');if(!/\.xlsx?$/i.test(name))throw new Error('Unggah berkas Excel .xls atau .xlsx.');const payment=payrollPayment(url.searchParams.get('payment'));const result=importPayrollExcel(await readBuffer(req),name,url.searchParams.get('dailyWage'),url.searchParams.get('overtimeRate'),payment);return json(res,201,{...result,data:payrollData(result.id,payment)});} const payrollRecord=url.pathname.match(/^\/api\/payroll\/record\/(\d+)$/); if(payrollRecord&&req.method==='PATCH')return json(res,200,updatePayrollRecord(payrollRecord[1],await readJson(req))); const payrollEmployeeStatus=url.pathname.match(/^\/api\/payroll\/employee\/(.+)\/status$/); if(payrollEmployeeStatus&&req.method==='POST')return json(res,200,saveEffectiveEmployeeStatus(decodeURIComponent(payrollEmployeeStatus[1]),await readJson(req))); const payrollEmployee=url.pathname.match(/^\/api\/payroll\/employee\/(.+)$/); if(payrollEmployee&&req.method==='PATCH')return json(res,200,updatePayrollEmployeeGroup(decodeURIComponent(payrollEmployee[1]),await readJson(req))); if(url.pathname==='/api/payroll/export'&&req.method==='GET'){const payment=payrollPayment(url.searchParams.get('payment'));const file=exportPayroll(url.searchParams.get('upload'),payment);res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="rekap-gaji-gudang.xlsx"'});return res.end(file);} if(url.pathname.startsWith('/api/'))return json(res,404,{error:'Endpoint tidak ditemukan.'});const requested=url.pathname==='/'?'/index.html':url.pathname,file=normalize(join(PUBLIC,requested));if(!file.startsWith(PUBLIC))return json(res,403,{error:'Akses ditolak.'});const content=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});res.end(content);
 }catch(error){if(error.code==='ENOENT')return json(res,404,{error:'Halaman tidak ditemukan.'});json(res,400,{error:error.message||'Terjadi kesalahan.'});}}).listen(PORT,'0.0.0.0',()=>{const addresses=Object.values(networkInterfaces()).flat().filter(item=>item&&item.family==='IPv4'&&!item.internal).map(item=>`http://${item.address}:${PORT}`);console.log(`CAP Analytics berjalan di http://localhost:${PORT}${addresses.length?`\nAkses LAN: ${addresses.join(', ')}`:''}`);});
