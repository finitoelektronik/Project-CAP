// Modul Piutang — pengaturan Notifikasi WhatsApp otomatis (jam & hari kirim, template
// cadangan, penerima, pratinjau pesan, riwayat, dan kirim sekarang).
(() => {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const number = new Intl.NumberFormat('id-ID');
  const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const TYPES = { maturity_reminders: 'Pencairan cek/giro/kospin', jakarta_receivables: 'Piutang Jakarta' };
  const STATUS = { done: 'Selesai', partial: 'Sebagian gagal', failed: 'Gagal', running: 'Berjalan' };
  let mounted = false, state = null;

  const request = async (path, method = 'GET', body) => {
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Permintaan gagal.');
    return data;
  };

  function mount() {
    const user = window.capUser;
    if (mounted || !user || !(user.role === 'master' || user.modules?.includes('maturity_reminders'))) return;
    const anchor = $('#maturityImport');
    if (!anchor) return setTimeout(mount, 300);
    mounted = true;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button secondary';
    button.id = 'piutangWhatsappButton';
    button.textContent = '✉ Notifikasi WhatsApp';
    anchor.before(button);
    button.onclick = () => open().catch(error => alert(error.message));
    document.body.insertAdjacentHTML('beforeend', `<dialog id="piutangWaDialog" class="pw-dialog"><form id="piutangWaForm"><div class="dialog-heading"><div><p class="eyebrow">MODUL PIUTANG</p><h2>Notifikasi WhatsApp otomatis</h2><p class="dialog-note">Pencairan cek/giro/kospin (H-0 s.d. H-7) dan Piutang Jakarta (lewat tempo &amp; jatuh tempo ≤ 7 hari) dikirim ke kontak yang terdaftar pada jam yang Anda atur.</p></div><button type="button" class="icon-button" data-close="piutangWaDialog">×</button></div>
      <p class="dialog-note pw-api" id="pwApi"></p>
      <label class="pw-check"><input type="checkbox" name="enabled"/> Aktifkan pengiriman otomatis</label>
      <fieldset class="pw-box"><legend>Jam kirim (waktu server <b id="pwServerTime"></b>)</legend><div id="pwTimes"></div><button type="button" class="button ghost" id="pwAddTime">+ Tambah jam</button></fieldset>
      <fieldset class="pw-box"><legend>Hari kirim</legend><div class="pw-days">${DAYS.map((day, index) => `<label><input type="checkbox" name="days" value="${index}"/> ${day}</label>`).join('')}</div></fieldset>
      <fieldset class="pw-box"><legend>Template cadangan (bila kontak di luar jendela 24 jam)</legend><p class="dialog-note">Pesan dikirim sebagai teks berisi daftar lengkap. Bila Meta menolak karena kontak belum membalas dalam 24 jam, CAP otomatis mengirim template ringkasan ini. Buat template kategori <b>Utility</b> di WhatsApp Manager dengan 4 variabel berurutan, contoh:<br><i>Pengingat CAP {{4}}: ada {{2}} {{1}} dengan total {{3}}. Detail lengkap dapat dilihat di aplikasi CAP.</i><br>{{1}} jenis · {{2}} jumlah · {{3}} total · {{4}} tanggal.</p><div class="pw-row"><label>Nama template (status Approved)<input name="template_name" placeholder="contoh: pengingat_piutang_cap"/></label><label>Bahasa<select name="template_language"><option value="id">Indonesia (id)</option><option value="en">English (en)</option><option value="en_US">English US (en_US)</option></select></label></div></fieldset>
      <fieldset class="pw-box"><legend>Penerima</legend><div id="pwRecipients"></div><p class="dialog-note">Atur penerima di <b>WhatsApp Business → Pesan Internal</b>: edit kontak lalu centang modul <i>Piutang — Pencairan cek/giro/kospin</i> dan/atau <i>Piutang — Piutang Jakarta</i>.</p></fieldset>
      <details class="pw-box"><summary>Pratinjau pesan hari ini</summary><div id="pwPreview"></div></details>
      <details class="pw-box"><summary>Riwayat pengiriman</summary><div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Pemicu</th><th>Status</th><th>Data</th><th>Terkirim</th><th>Gagal</th></tr></thead><tbody id="pwRuns"></tbody></table></div></details>
      <div class="dialog-actions"><button type="button" class="button ghost" id="pwSendNow">Kirim sekarang</button><button type="button" class="button ghost" data-close="piutangWaDialog">Tutup</button><button class="button" type="submit">Simpan pengaturan</button></div></form></dialog>`);
    const form = $('#piutangWaForm');
    $('#pwAddTime').onclick = () => addTime('');
    $('#pwTimes').addEventListener('click', event => { if (event.target.closest('[data-remove-time]')) event.target.closest('.pw-time').remove(); });
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector('[type=submit]');
      button.disabled = true;
      try {
        render(await request('/api/maturity-reminders/whatsapp', 'PUT', {
          enabled: form.elements.enabled.checked,
          times: [...form.querySelectorAll('[data-time]')].map(input => input.value).filter(Boolean),
          days: [...form.querySelectorAll('input[name="days"]:checked')].map(input => Number(input.value)),
          template_name: form.elements.template_name.value,
          template_language: form.elements.template_language.value,
        }));
        alert('Pengaturan notifikasi WhatsApp Piutang disimpan.');
      } catch (error) { alert(error.message); } finally { button.disabled = false; }
    };
    $('#pwSendNow').onclick = async () => {
      const total = Object.entries(state.recipients).reduce((sum, [key, list]) => sum + (state.preview.some(item => item.key === key) ? list.length : 0), 0);
      if (!state.preview.length) return alert('Hari ini tidak ada pencairan maupun piutang yang perlu diingatkan.');
      if (!total) return alert('Belum ada kontak WhatsApp aktif yang dicentang untuk notifikasi Piutang.');
      if (!confirm(`Kirim notifikasi Piutang sekarang (${number.format(total)} pesan ke kontak terdaftar)? Pesan yang terkirim tidak dapat dibatalkan.`)) return;
      const button = $('#pwSendNow');
      button.disabled = true; button.textContent = 'Mengirim…';
      try {
        const result = await request('/api/maturity-reminders/whatsapp/send-now', 'POST', {});
        render(result.data);
        const run = result.run;
        alert(run.status === 'failed' && !run.recipients ? `Gagal: ${run.message}` : `Terkirim ${run.sent_text} teks dan ${run.sent_template} template, gagal ${run.failed}.${run.message ? `\n${run.message}` : ''}`);
        window.dispatchEvent(new Event('cap:whatsapp-sent'));
      } catch (error) { alert(error.message); } finally { button.disabled = false; button.textContent = 'Kirim sekarang'; }
    };
  }

  function addTime(value) {
    $('#pwTimes').insertAdjacentHTML('beforeend', `<div class="pw-time"><input type="time" data-time value="${esc(value)}" required/><button type="button" class="button ghost" data-remove-time>Hapus</button></div>`);
  }

  function render(data) {
    state = data;
    const form = $('#piutangWaForm'), settings = data.settings;
    form.elements.enabled.checked = settings.enabled;
    $('#pwServerTime').textContent = data.server_time;
    $('#pwTimes').innerHTML = '';
    (settings.times.length ? settings.times : ['08:00']).forEach(addTime);
    form.querySelectorAll('input[name="days"]').forEach(input => { input.checked = settings.days.includes(Number(input.value)); });
    form.elements.template_name.value = settings.template_name || '';
    form.elements.template_language.value = settings.template_language || 'id';
    $('#pwApi').innerHTML = data.api_ready ? `Terakhir diubah ${esc(settings.updated_by || '—')} · ${esc(settings.updated_at || '')}` : '<b>API WhatsApp Business belum diatur.</b> Akun master mengisinya di WhatsApp Business → Pesan Internal.';
    $('#pwRecipients').innerHTML = Object.entries(TYPES).map(([key, label]) => { const list = data.recipients[key] || []; return `<div class="pw-recipient"><b>${esc(label)}</b><span>${list.length ? list.map(item => esc(item.name)).join(', ') : '<i>belum ada kontak</i>'}</span></div>`; }).join('');
    $('#pwPreview').innerHTML = data.preview.length ? data.preview.map(item => `<p class="eyebrow">${esc(TYPES[item.key])} · ${number.format(item.count)} data</p><pre class="pw-pre">${esc(item.text)}</pre>`).join('') : '<p class="dialog-note">Hari ini tidak ada pencairan maupun piutang yang perlu diingatkan — tidak ada pesan yang dikirim.</p>';
    $('#pwRuns').innerHTML = data.runs.length ? data.runs.map(run => `<tr><td>${esc(run.started_at)}</td><td>${run.trigger === 'auto' ? `Jadwal ${esc((run.slot_key || '').slice(11))}` : `Manual · ${esc(run.run_by)}`}</td><td>${esc(STATUS[run.status] || run.status)}${run.message ? `<small>${esc(run.message)}</small>` : ''}</td><td>${number.format(run.pencairan_count)} cair · ${number.format(run.jakarta_count)} nota</td><td>${number.format(run.sent_text)} teks · ${number.format(run.sent_template)} template</td><td>${number.format(run.failed)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">Belum ada pengiriman.</td></tr>';
  }

  async function open() {
    render(await request('/api/maturity-reminders/whatsapp'));
    $('#piutangWaDialog').showModal();
  }

  document.head.insertAdjacentHTML('beforeend', `<style id="piutangWhatsappStyle">
.pw-dialog{width:min(760px,calc(100% - 30px))}.pw-dialog form{padding:24px;max-height:85vh;overflow:auto}
.pw-box{border:1px solid var(--line);border-radius:9px;padding:10px 14px;margin:12px 0}.pw-box legend,.pw-box summary{font-size:12px;font-weight:700;color:#3c4b60;padding:0 4px;cursor:pointer}
.pw-check{display:flex;align-items:center;gap:8px;margin:12px 0}.pw-check input,.pw-days input{width:auto;margin:0}
.pw-time{display:inline-flex;align-items:center;gap:6px;margin:4px 10px 4px 0}.pw-time input{width:auto}
.pw-days{display:flex;flex-wrap:wrap;gap:6px 16px}.pw-days label{display:flex;align-items:center;gap:5px;margin:4px 0;font-size:13px}
.pw-row{display:grid;grid-template-columns:2fr 1fr;gap:12px}.pw-row label{margin:8px 0}
.pw-recipient{display:grid;grid-template-columns:200px 1fr;gap:8px;font-size:13px;padding:5px 0;border-bottom:1px solid var(--line)}
.pw-pre{white-space:pre-wrap;font:12px/1.5 ui-monospace,Consolas,monospace;background:var(--paper);border-radius:8px;padding:10px;max-height:260px;overflow:auto}
#pwRuns small{display:block;color:var(--muted);font-size:11px}
@media(max-width:640px){.pw-row,.pw-recipient{grid-template-columns:1fr}}
</style>`);
  window.addEventListener('cap-user-ready', mount);
  if (window.capUser) mount();
})();
