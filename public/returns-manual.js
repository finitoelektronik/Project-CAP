// Retur Online → Penerimaan retur: input resi manual tanpa impor CSV.
// Bisa diketik atau di-scan langsung ke kolom (satu resi per baris).
(() => {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const COURIERS = ['Shopee Xpress', 'J&T Express', 'J&T Cargo', 'ID Express', 'JNE', 'Ninja Xpress', 'SiCepat', 'AnterAja', 'Belum teridentifikasi'];
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const notify = message => { const item = $('#toast'); if (!item) return alert(message); item.textContent = message; item.classList.add('visible'); setTimeout(() => item.classList.remove('visible'), 3500); };
  const parse = text => [...new Set(String(text || '').toUpperCase().split(/[\s,;]+/).map(value => value.trim()).filter(Boolean))];
  let mounted = false;

  function mount() {
    if (mounted) return;
    const importButton = $('#incomingUploadButton');
    if (!importButton) return setTimeout(mount, 300);
    mounted = true;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button secondary';
    button.id = 'incomingManualButton';
    button.textContent = '+ Input resi manual';
    const actions = document.createElement('div');
    actions.className = 'header-actions';
    importButton.replaceWith(actions);
    actions.append(button, importButton);
    document.body.insertAdjacentHTML('beforeend', `<dialog id="incomingManualDialog"><form id="incomingManualForm" class="rm-form"><div class="dialog-heading"><div><p class="eyebrow">INPUT RESI MANUAL</p><h2>Resi retur masuk</h2><p class="dialog-note">Ketik atau scan nomor resi langsung ke kolom di bawah, satu resi per baris. Resi yang sudah tersimpan tidak akan ditimpa.</p></div><button type="button" class="icon-button" data-close="incomingManualDialog">×</button></div>
      <div class="form-grid"><label>Tanggal masuk<input name="received_date" type="date" required/></label><label>Jasa kirim<select name="courier"><option value="">Deteksi otomatis dari nomor resi</option>${COURIERS.map(item => `<option>${esc(item)}</option>`).join('')}</select></label></div>
      <label>Nomor resi<textarea name="tracking_numbers" rows="7" required placeholder="JY1553291469&#10;SPXID04812345678&#10;…" autocomplete="off" spellcheck="false"></textarea></label>
      <p class="dialog-note" id="incomingManualCount">0 resi</p>
      <div class="dialog-actions"><button type="button" class="button ghost" data-close="incomingManualDialog">Batal</button><button class="button" type="submit">Simpan resi</button></div>
      <p class="dialog-note rm-result" id="incomingManualResult" hidden></p></form></dialog>`);
    const form = $('#incomingManualForm'), dialog = $('#incomingManualDialog');
    button.onclick = () => { form.reset(); form.elements.received_date.value = today(); $('#incomingManualCount').textContent = '0 resi'; $('#incomingManualResult').hidden = true; dialog.showModal(); form.elements.tracking_numbers.focus(); };
    form.elements.tracking_numbers.addEventListener('input', () => { $('#incomingManualCount').textContent = `${parse(form.elements.tracking_numbers.value).length} resi`; });
    form.onsubmit = async event => {
      event.preventDefault();
      const submit = form.querySelector('[type=submit]'), numbers = parse(form.elements.tracking_numbers.value);
      if (!numbers.length) return notify('Isi minimal satu nomor resi.');
      submit.disabled = true;
      try {
        const response = await fetch('/api/returns/incoming/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ received_date: form.elements.received_date.value, courier: form.elements.courier.value, tracking_numbers: numbers }) });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Resi belum tersimpan.');
        const search = $('#incomingSearch');
        if (search) search.dispatchEvent(new Event('input'));
        if (body.duplicates?.length) {
          $('#incomingManualResult').hidden = false;
          $('#incomingManualResult').innerHTML = `${body.saved} resi baru disimpan. ${body.duplicates.length} resi sudah ada sebelumnya dan tidak diubah: ${body.duplicates.slice(0, 10).map(item => `<b>${esc(item.tracking_number)}</b> (${esc(item.received_date)})`).join(', ')}${body.duplicates.length > 10 ? ' …' : ''}`;
          form.elements.tracking_numbers.value = '';
          $('#incomingManualCount').textContent = '0 resi';
        } else {
          dialog.close();
        }
        notify(`${body.saved} resi retur baru disimpan.`);
      } catch (error) { notify(error.message); } finally { submit.disabled = false; }
    };
  }

  document.head.insertAdjacentHTML('beforeend', '<style id="returnsManualStyle">#incomingManualDialog{width:min(560px,calc(100% - 30px))}.rm-form{padding:24px}.rm-form textarea{font-family:ui-monospace,Consolas,monospace;text-transform:uppercase}.rm-result{background:#fff7e6;border:1px solid #ffe2a8;border-radius:8px;padding:8px 11px;color:#7a4b00!important}#incomingReturnsPanel .panel-heading .header-actions{display:flex;gap:8px;flex-wrap:wrap}</style>');
  window.addEventListener('cap-user-ready', mount);
  if (window.capUser) mount();
})();
