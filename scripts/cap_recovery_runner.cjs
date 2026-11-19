// Proses terpisah untuk memulai ulang CAP dan memulihkan snapshot bila server baru gagal sehat.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const http = require('node:http');

const [nodePath, root, snapshot = '', action = 'restart', pendingDatabase = ''] = process.argv.slice(2);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const health = () => new Promise(resolve => {
  const request = http.get('http://127.0.0.1:' + (process.env.PORT || 3100) + '/', response => { response.resume(); resolve(response.statusCode === 200); });
  request.on('error', () => resolve(false)); request.setTimeout(2500, () => { request.destroy(); resolve(false); });
});
const start = () => spawn(nodePath, ['app.mjs'], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
function restore(snapshotPath) {
  const stateFile = path.join(snapshotPath, 'file-state.json');
  if (!fs.existsSync(stateFile)) throw new Error('Snapshot pemulihan tidak lengkap.');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  for (const item of state.files || []) {
    const target = path.join(root, item.target), backup = path.join(snapshotPath, 'files', item.target);
    if (item.exists) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(backup, target); }
    else if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  }
  const database = path.join(snapshotPath, 'app.db');
  if (fs.existsSync(database)) fs.copyFileSync(database, path.join(root, 'data', 'app.db'));
}
(async () => {
  await wait(1800);
  try {
    if (action === 'restore' && snapshot) restore(snapshot);
    if (action === 'database-restore') {
      if (!pendingDatabase || !fs.existsSync(pendingDatabase)) throw new Error('Cadangan database sementara tidak ditemukan.');
      fs.copyFileSync(pendingDatabase, path.join(root, 'data', 'app.db'));
      fs.rmSync(pendingDatabase, { force: true });
    }
  } catch {
    if (snapshot) restore(snapshot);
  }
  let child = start();
  await wait(4200);
  if (await health()) process.exit(0);
  try { child.kill(); } catch {}
  await wait(800);
  if (!snapshot) process.exit(1);
  try { restore(snapshot); child = start(); await wait(4200); process.exit((await health()) ? 0 : 1); }
  catch { process.exit(1); }
})();
