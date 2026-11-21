// Pemuat modul CAP Analytics (inti).
// Lokasi modules/_core/ dipakai karena Pemasang Modul hanya menerima target app.mjs,
// CONTEXT.md, public/, scripts/, dan modules/. Folder berawalan "_" tidak dimuat sebagai modul.
//
// Setiap modul tinggal di modules/<id>/ dan terdiri dari:
//   module.json      manifest: id, title, version, permission, frontend
//   server.mjs       opsional; export async function register(ctx) -> { routes, startup }
//   public/          opsional; aset tampilan, disajikan di /modules/<id>/...
//
// Prinsip isolasi:
// - Modul yang gagal dimuat atau gagal saat rute dijalankan TIDAK menghentikan inti
//   maupun modul lain; kegagalannya dicatat dan dapat dilihat di /api/core/modules.
// - Rute modul hanya di bawah /api/modules/<id>/...; inti memeriksa login dan hak akses
//   modul sebelum meneruskan permintaan.
// - Modul tidak mengimpor modul lain. Kebutuhan lintas modul memakai ctx.services:
//   modul pemilik menyediakan layanan (umumnya baca saja), modul lain memakainya.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const MODULE_ID = /^[a-z][a-z0-9_]{1,80}$/;
const ASSET_PATH = /^[A-Za-z0-9_./-]+$/;

export function createModuleRuntime() {
  const modules = new Map();
  const failed = [];
  const services = new Map();
  return { modules, failed, services };
}

function serviceRegistry(runtime, ownerId) {
  return {
    // Modul pemilik mendaftarkan layanan: ctx.services.provide('baca_kontak', fn)
    provide(name, handler) {
      if (!/^[a-z][a-z0-9_]{1,60}$/.test(String(name || ''))) throw new Error(`Nama layanan tidak valid: ${name}`);
      if (typeof handler !== 'function') throw new Error(`Layanan ${name} harus berupa fungsi.`);
      runtime.services.set(`${ownerId}.${name}`, { owner: ownerId, handler });
    },
    // Modul lain memakai layanan: ctx.services.use('whatsapp.kirim_pesan')
    use(fullName) {
      const entry = runtime.services.get(String(fullName || ''));
      return entry ? entry.handler : null;
    },
    list() { return [...runtime.services.keys()].sort(); },
  };
}

function frontendList(manifest) {
  const frontend = manifest.frontend || {};
  const clean = values => (Array.isArray(values) ? values : []).map(String).filter(value => ASSET_PATH.test(value) && !value.includes('..'));
  return { scripts: clean(frontend.scripts), styles: clean(frontend.styles) };
}

// Memuat semua modul yang ada di <root>/modules. Folder yang diawali "_" atau "." dilewati.
export async function loadModules(runtime, { root, context, log = console }) {
  const directory = join(root, 'modules');
  if (!existsSync(directory)) return runtime;
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const base = join(directory, entry.name), manifestPath = join(base, 'module.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.id !== entry.name || !MODULE_ID.test(manifest.id)) throw new Error('id pada module.json harus sama dengan nama folder (huruf kecil, angka, garis bawah).');
      const record = { id: manifest.id, manifest, base, permission: String(manifest.permission || manifest.id), frontend: frontendList(manifest), routes: null, loadedAt: new Date().toISOString() };
      const serverFile = join(base, 'server.mjs');
      if (existsSync(serverFile)) {
        const imported = await import(pathToFileURL(serverFile).href);
        if (typeof imported.register !== 'function') throw new Error('server.mjs harus mengekspor fungsi register(ctx).');
        const moduleContext = { ...context, id: manifest.id, manifest, services: serviceRegistry(runtime, manifest.id), log: (...args) => log.log(`[modul ${manifest.id}]`, ...args) };
        const api = (await imported.register(moduleContext)) || {};
        record.routes = typeof api.routes === 'function' ? api.routes : null;
        if (typeof api.startup === 'function') await api.startup();
      }
      runtime.modules.set(manifest.id, record);
    } catch (error) {
      runtime.failed.push({ id: entry.name, error: error.message, at: new Date().toISOString() });
      log.error(`[modul ${entry.name}] gagal dimuat: ${error.message}`);
    }
  }
  return runtime;
}

// Tag <script>/<link> untuk index.html dari modul yang berhasil dimuat.
export function moduleHeadTags(runtime) {
  const tags = [];
  for (const record of runtime.modules.values()) {
    const version = encodeURIComponent(String(record.manifest.version || '0'));
    for (const style of record.frontend.styles) tags.push(`<link rel="stylesheet" href="/modules/${record.id}/${style}?v=${version}">`);
    for (const script of record.frontend.scripts) tags.push(`<script src="/modules/${record.id}/${script}?v=${version}"></script>`);
  }
  return tags.join('');
}

// Menyajikan aset /modules/<id>/<berkas> dari modules/<id>/public/. Mengembalikan false bila bukan aset modul.
export function serveModuleAsset(runtime, { pathname, res, mime }) {
  const match = pathname.match(/^\/modules\/([a-z][a-z0-9_]{1,80})\/(.+)$/);
  if (!match) return false;
  const record = runtime.modules.get(match[1]);
  const relative = decodeURIComponent(match[2]);
  if (!record || !ASSET_PATH.test(relative) || relative.includes('..')) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Tidak ditemukan.'); return true; }
  const publicDir = join(record.base, 'public');
  const file = normalize(join(publicDir, relative));
  if (!file.startsWith(publicDir + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Tidak ditemukan.'); return true; }
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', Pragma: 'no-cache' });
  res.end(readFileSync(file));
  return true;
}

// Meneruskan /api/modules/<id>/... ke modul. Mengembalikan false bila bukan rute modul.
export async function handleModuleRequest(runtime, { req, res, url, user, canAccess, json }) {
  const match = url.pathname.match(/^\/api\/modules\/([a-z][a-z0-9_]{1,80})(\/.*)?$/);
  if (!match) return false;
  const record = runtime.modules.get(match[1]);
  if (!record || !record.routes) { json(res, 404, { error: 'Modul tidak ditemukan atau tidak memiliki rute.' }); return true; }
  if (!canAccess(user, record.permission)) { json(res, 403, { error: 'Akun ini tidak memiliki akses ke modul tersebut.' }); return true; }
  try {
    const handled = await record.routes({ req, res, url, user, path: match[2] || '/' });
    if (!handled && !res.headersSent) json(res, 404, { error: 'Rute modul tidak ditemukan.' });
  } catch (error) {
    if (!res.headersSent) json(res, 400, { error: error.message || 'Terjadi kesalahan pada modul.', module: record.id });
  }
  return true;
}

// Ringkasan status untuk akun master.
export function moduleRuntimeStatus(runtime) {
  return {
    loaded: [...runtime.modules.values()].map(record => ({ id: record.id, title: record.manifest.title || record.id, version: record.manifest.version || '', permission: record.permission, has_routes: Boolean(record.routes), frontend: record.frontend, loaded_at: record.loadedAt })),
    failed: runtime.failed,
    services: [...runtime.services.keys()].sort(),
  };
}
