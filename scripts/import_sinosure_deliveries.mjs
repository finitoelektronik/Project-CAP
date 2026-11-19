import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const [databasePath, jsonPath] = process.argv.slice(2);
if (!databasePath || !jsonPath) throw new Error('Gunakan: node import_sinosure_deliveries.mjs <database> <data-json>');

const database = new DatabaseSync(databasePath);
const items = JSON.parse(readFileSync(jsonPath, 'utf8')).items || [];
const deliveryColumns = new Set(database.prepare('PRAGMA table_info(sinosure_deliveries)').all().map(row => row.name));
if (!deliveryColumns.has('source_key')) database.exec("ALTER TABLE sinosure_deliveries ADD COLUMN source_key TEXT NOT NULL DEFAULT ''");
if (!deliveryColumns.has('review_status')) database.exec("ALTER TABLE sinosure_deliveries ADD COLUMN review_status TEXT NOT NULL DEFAULT 'normal'");
if (!deliveryColumns.has('manually_edited')) database.exec('ALTER TABLE sinosure_deliveries ADD COLUMN manually_edited INTEGER NOT NULL DEFAULT 0');
database.exec("CREATE UNIQUE INDEX IF NOT EXISTS sinosure_delivery_source_key ON sinosure_deliveries(source_key) WHERE source_key<>''");
const clients = new Map(database.prepare('SELECT id, sequence_code FROM sinosure_client_codes').all().map(row => [row.sequence_code, row]));
const find = database.prepare('SELECT id, manually_edited FROM sinosure_deliveries WHERE source_key=?');
const insert = database.prepare("INSERT INTO sinosure_deliveries(client_code_id,source_key,review_status,ship_date,invoice_number,pi_number,product_model,quantity,unit_price_cny,unit_price_idr,total_cny,total_idr,payment_terms,insured_status,remarks) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
const update = database.prepare('UPDATE sinosure_deliveries SET client_code_id=?,review_status=?,ship_date=?,invoice_number=?,pi_number=?,product_model=?,quantity=?,unit_price_cny=?,unit_price_idr=?,total_cny=?,total_idr=?,payment_terms=?,insured_status=?,remarks=?,updated_at=CURRENT_TIMESTAMP WHERE id=?');
let created = 0, updated = 0, review = 0, unlinked = 0;
database.exec('BEGIN IMMEDIATE');
try {
  for (const item of items) {
    const client = clients.get(item.client_sequence);
    const sourceKey = [item.client_sequence, item.ship_date, item.invoice_number, item.product_model].join('|');
    const existing = find.get(sourceKey);
    const values = [client?.id || null, client ? 'normal' : 'unlinked', item.ship_date, item.invoice_number, item.pi_number, item.product_model, item.quantity, item.unit_price_cny, item.unit_price_idr, item.total_cny, item.total_idr, item.payment_terms, item.insured_status, item.remarks];
    if (!client) unlinked++;
    if (!existing) { insert.run(values[0], sourceKey, ...values.slice(1)); created++; }
    else if (existing.manually_edited) { database.prepare("UPDATE sinosure_deliveries SET review_status='review' WHERE id=?").run(existing.id); review++; }
    else { update.run(...values, existing.id); updated++; }
  }
  database.exec('COMMIT');
} catch (error) {
  database.exec('ROLLBACK');
  throw error;
} finally {
  database.close();
}
console.log(JSON.stringify({ created, updated, review, unlinked, total: items.length }));
