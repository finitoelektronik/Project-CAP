// Impor kontak prospek WhatsApp dari file VCF ke tabel whatsapp_external_contacts.
// Pemakaian: node scripts/import_whatsapp_external_vcf.mjs "C:\path\kontak.vcf"
// Aturan sama dengan tombol "Impor VCF" di menu Pesan External: nomor yang sudah
// ada dilewati (data yang diedit di CAP tidak ditimpa), nama disimpan apa adanya,
// kota diambil dari NOTE "Prospek Finito Official Store - <Kota>".
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const file = process.argv[2];
if (!file) { console.error('Sebutkan path file .vcf'); process.exit(1); }
const db = new DatabaseSync(join(process.cwd(), 'data', 'app.db'));
db.exec('PRAGMA busy_timeout = 10000');
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='whatsapp_external_contacts'").get()) {
  console.error('Tabel whatsapp_external_contacts belum ada. Jalankan server CAP versi terbaru sekali terlebih dahulu.');
  process.exit(1);
}
const normalizePhone = value => { let phone = String(value || '').replace(/\D/g, ''); if (phone.startsWith('0')) phone = `62${phone.slice(1)}`; else if (phone.startsWith('8')) phone = `62${phone}`; return /^\d{9,16}$/.test(phone) ? phone : null; };
const cityFromGroup = group => { const text = String(group || '').trim(), index = text.lastIndexOf(' - '); return (index >= 0 ? text.slice(index + 3) : text).trim().slice(0, 60); };
const text = readFileSync(file, 'utf8');
const insert = db.prepare('INSERT OR IGNORE INTO whatsapp_external_contacts (name,phone,group_name,city,source) VALUES (?,?,?,?,?)');
let added = 0, skipped = 0, invalid = 0;
db.exec('BEGIN');
for (const match of text.matchAll(/BEGIN:VCARD([\s\S]*?)END:VCARD/gi)) {
  const body = match[1].replace(/\r?\n[ \t]/g, '');
  const field = key => (body.match(new RegExp(`^${key}(?:;[^:\\r\\n]*)?:(.*)$`, 'im'))?.[1] || '').trim();
  const phone = normalizePhone(field('TEL'));
  if (!phone) { invalid++; continue; }
  const group = field('NOTE').slice(0, 120);
  const name = (field('FN') || phone).slice(0, 120);
  if (insert.run(name, phone, group, cityFromGroup(group), basename(file).slice(0, 200)).changes) added++; else skipped++;
}
db.exec('COMMIT');
console.log(JSON.stringify({ added, skipped, invalid }));
console.log(db.prepare("SELECT city, COUNT(*) AS total FROM whatsapp_external_contacts GROUP BY city ORDER BY total DESC").all());
