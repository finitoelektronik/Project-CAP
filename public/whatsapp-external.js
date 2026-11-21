// WhatsApp Business — submenu Pesan Internal / Pesan External.
// Pesan Internal = fitur kontak & notifikasi operasional yang sudah ada.
// Pesan External = kontak prospek pelanggan per kota (hak akses `whatsapp_external`),
// dikirimi pesan template Meta yang sudah disetujui.
(() => {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const number = new Intl.NumberFormat('id-ID');
  const notify = message => { const item = $('#toast'); if (!item) return alert(message); item.textContent = message; item.classList.add('visible'); setTimeout(() => item.classList.remove('visible'), 3500); };
  const PAGE = 100;
  let state = { contacts: [], cities: [], sends: [], template: { name: '', language: 'id', param: 'none' }, api_ready: false };
  let tab = 'internal', page = 1, ready = false, access = { internal: false, external: false };
  const selected = new Set();

  // Dipakai juga oleh form Pesan Internal di app.js.
  window.capWhatsappImage = file => new Promise((resolve, reject) => {
    if (!['image/jpeg', 'image/png'].includes(file.type)) return reject(new Error('Gambar harus berformat JPG atau PNG.'));
    if (file.size > 5 * 1024 * 1024) return reject(new Error('Ukuran gambar maksimal 5 MB.'));
    const reader = new FileReader();
    reader.onload = () => resolve({ data: String(reader.result).split(',')[1], mime: file.type, name: file.name });
    reader.onerror = () => reject(new Error('Gambar tidak dapat dibaca.'));
    reader.readAsDataURL(file);
  });

  const tierLabel = tier => ({ TIER_50: '50', TIER_250: '250', TIER_1K: '1.000', TIER_2K: '2.000', TIER_10K: '10.000', TIER_100K: '100.000', TIER_UNLIMITED: 'Tanpa batas' }[tier] || tier || '—');
  const qualityLabel = quality => ({ GREEN: 'Tinggi', YELLOW: 'Sedang', RED: 'Rendah' }[quality] || quality || '—');
  async function loadQuota() {
    const box = $('#waQuota');
    if (!box) return;
    try {
      const quota = await request('/api/whatsapp/quota');
      const limitText = quota.limit === null ? (quota.tier === 'TIER_UNLIMITED' ? 'Tanpa batas' : '—') : number.format(quota.limit);
      const remainingText = quota.remaining === null ? (quota.tier === 'TIER_UNLIMITED' ? 'Tanpa batas' : '—') : number.format(quota.remaining);
      const percent = quota.limit ? Math.min(100, Math.round(quota.used / quota.limit * 100)) : 0;
      box.innerHTML = `<div class="wa-quota-main"><p class="eyebrow">SISA KUOTA PENGIRIMAN (24 JAM)</p><strong>${remainingText}</strong><span>dari limit ${limitText} penerima baru per 24 jam</span>${quota.limit ? `<div class="wa-quota-bar"><i style="width:${percent}%"></i></div>` : ''}</div><dl class="wa-quota-facts"><div><dt>Terpakai dari CAP</dt><dd>${number.format(quota.used)} penerima · ${number.format(quota.sent_messages)} pesan</dd></div><div><dt>Tier Meta</dt><dd>${esc(tierLabel(quota.tier))}</dd></div><div><dt>Kualitas nomor</dt><dd>${esc(qualityLabel(quota.quality))}</dd></div><div><dt>Nomor bisnis</dt><dd>${esc(quota.phone || '—')}</dd></div></dl>${quota.error ? `<p class="dialog-note wa-quota-error">${esc(quota.error)}</p>` : '<p class="dialog-note">Perkiraan: Meta menghitung penerima unik pesan yang dimulai bisnis dalam 24 jam bergulir; CAP hanya mengetahui pesan yang dikirim dari CAP.</p>'}`;
    } catch (error) { box.innerHTML = `<p class="dialog-note wa-quota-error">Kuota tidak dapat dimuat: ${esc(error.message)}</p>`; }
  }
  window.addEventListener('cap:whatsapp-sent', () => loadQuota());

  const request = async (path, method = 'GET', body) => {
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Permintaan gagal.');
    return data;
  };

  function setup() {
    if (ready) return;
    const view = $('#whatsappView');
    if (!view) return;
    ready = true;
    const header = view.querySelector(':scope > header');
    const internalSections = [...view.querySelectorAll(':scope > section')];
    const internalWrap = document.createElement('div');
    internalWrap.id = 'whatsappInternalTab';
    internalSections[0].before(internalWrap);
    internalWrap.append(...internalSections);
    // Submenu diletakkan di dalam header agar ikut menempel (sticky) dan tidak tertutup.
    (header.querySelector(':scope > div') || header).insertAdjacentHTML('beforeend', '<nav id="whatsappSubnav" class="payroll-subnav wa-subnav" aria-label="Submenu WhatsApp"><button type="button" data-wa-tab="internal">Pesan Internal</button><button type="button" data-wa-tab="external">Pesan External</button></nav>');
    internalWrap.insertAdjacentHTML('beforebegin', '<section class="panel wa-quota" id="waQuota"><p class="dialog-note">Memuat kuota…</p></section>');
    internalWrap.insertAdjacentHTML('afterend', `<div id="whatsappExternalTab" hidden>
      <section class="panel"><div class="panel-heading"><div><p class="eyebrow">PESAN EXTERNAL</p><h2>Prospek Finito Official Store</h2><p class="dialog-note">Kontak prospek pelanggan per kota. Pesan pertama ke prospek wajib memakai template yang sudah disetujui Meta.</p></div><div class="header-actions"><button type="button" class="button secondary" id="waExtAddButton">+ Tambah prospek</button><label class="button secondary wa-file-button">↑ Impor VCF<input type="file" id="waExtImportFile" accept=".vcf,text/vcard" hidden/></label></div></div><div id="waExtCityCards" class="wa-city-cards"></div></section>
      <section class="panel"><p class="eyebrow">TEMPLATE META</p><h2>Template pesan prospek</h2><p class="dialog-note" id="waExtTemplateNote"></p><form id="waExtTemplateForm" class="wa-inline-form"><label>Nama template (persis seperti di Meta)<input name="name" placeholder="contoh: promo_finito_store" pattern="[a-z0-9_]*"/></label><label>Bahasa<select name="language"><option value="id">Indonesia (id)</option><option value="en">English (en)</option><option value="en_US">English US (en_US)</option></select></label><label>Variabel {{1}}<select name="param"><option value="none">Tidak ada variabel</option><option value="name">{{1}} = nama kontak</option></select></label><button class="button" type="submit">Simpan template</button></form></section>
      <section class="panel"><p class="eyebrow">KIRIM TEMPLATE</p><h2>Kirim ke grup kota</h2><form id="waExtSendForm"><fieldset class="wa-modules" id="waExtSendCities"><legend>Pilih kota/grup (hanya prospek berstatus Aktif)</legend></fieldset><div class="dialog-actions"><span class="dialog-note" id="waExtSendSummary"></span><button class="button" type="submit">Kirim template WhatsApp</button></div></form><p id="waExtSendResult" class="dialog-note"></p></section>
      <section class="panel" id="waExtManualPanel"><p class="eyebrow">PESAN MANUAL</p><h2>Kirim teks atau gambar</h2><p class="dialog-note wa-warning">Meta hanya meneruskan pesan bebas ke prospek yang <b>membalas dalam 24 jam terakhir</b>. Prospek lain akan ditolak Meta dan tercatat gagal ("di luar jendela 24 jam"); untuk mereka gunakan Kirim Template.</p><form id="waExtManualForm"><fieldset class="wa-modules" id="waExtManualCities"><legend>Kirim ke kota/grup</legend></fieldset><p class="dialog-note" id="waExtManualSelected"></p><div class="form-grid"><label>Pesan / keterangan gambar<textarea name="message" rows="4" maxlength="4096" placeholder="Tulis pesan. Bila ada gambar, teks ini menjadi keterangan (maks. 1.024 karakter)."></textarea></label><label>Gambar (opsional, JPG/PNG maks. 5 MB)<input type="file" name="image_file" accept="image/jpeg,image/png"/><img id="waExtManualPreview" class="wa-image-preview" alt="" hidden/></label></div><div class="dialog-actions"><span class="dialog-note" id="waExtManualSummary"></span><button class="button" type="submit">Kirim pesan manual</button></div></form><p id="waExtManualResult" class="dialog-note"></p></section>
      <section class="panel table-panel"><div class="panel-heading"><div><p class="eyebrow">DAFTAR PROSPEK</p><h2>Kontak prospek</h2></div><span id="waExtCount" class="count"></span></div><div class="wa-filters"><label>Kota<select id="waExtFilterCity"><option value="">Semua kota</option></select></label><label>Status<select id="waExtFilterStatus"><option value="">Semua status</option><option value="active">Aktif</option><option value="stopped">Berhenti</option></select></label><label>Cari<input id="waExtSearch" type="search" placeholder="Nama atau nomor"/></label></div><div class="table-wrap"><table><thead><tr><th class="wa-check-cell"><input type="checkbox" id="waExtSelectPage" title="Pilih semua di halaman ini"/></th><th>Nama</th><th>Nomor</th><th>Kota</th><th>Status</th><th>Catatan</th><th></th></tr></thead><tbody id="waExtRows"></tbody></table></div><div class="wa-pager" id="waExtPager"></div></section>
      <section class="panel table-panel"><div class="panel-heading"><div><p class="eyebrow">RIWAYAT</p><h2>Pengiriman terakhir</h2></div></div><div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Oleh</th><th>Jenis</th><th>Penerima</th><th>Terkirim</th><th>Gagal</th></tr></thead><tbody id="waExtSends"></tbody></table></div></section>
    </div>`);
    document.body.insertAdjacentHTML('beforeend', '<dialog id="waExtDialog"><form id="waExtForm" class="wa-dialog-form"><div class="dialog-heading"><div><p class="eyebrow">PROSPEK</p><h2 id="waExtDialogTitle">Edit prospek</h2></div><button type="button" class="icon-button" data-close="waExtDialog">×</button></div><label>Nama kontak<input name="name" required maxlength="120"/></label><label>Nomor WhatsApp<input name="phone" required placeholder="08xx atau 62xx"/></label><label>Kota / grup<input name="city" required maxlength="60" list="waExtCityList"/></label><datalist id="waExtCityList"></datalist><label>Status<select name="status"><option value="active">Aktif — boleh dikirimi pesan</option><option value="stopped">Berhenti — jangan dikirimi lagi</option></select></label><label>Catatan<textarea name="notes" rows="2" maxlength="500"></textarea></label><div class="dialog-actions"><button type="button" class="button ghost" data-close="waExtDialog">Batal</button><button class="button" type="submit">Simpan</button></div></form></dialog>');
    wire();
  }

  function renderAccess() {
    document.querySelectorAll('[data-wa-tab]').forEach(button => { const allowed = access[button.dataset.waTab]; button.hidden = !allowed; button.style.display = allowed ? '' : 'none'; button.classList.toggle('active', button.dataset.waTab === tab); });
    $('#whatsappSubnav').hidden = !(access.internal && access.external);
    $('#whatsappInternalTab').hidden = tab !== 'internal';
    $('#whatsappExternalTab').hidden = tab !== 'external';
  }

  function showTab(next) {
    tab = access[next] ? next : (access.internal ? 'internal' : 'external');
    try { localStorage.setItem('cap-wa-tab', tab); } catch {}
    renderAccess();
    if (tab === 'external') load().catch(error => notify(error.message));
  }

  async function load() { render(await request('/api/whatsapp-external')); }

  const filtered = () => {
    const city = $('#waExtFilterCity').value, status = $('#waExtFilterStatus').value, query = $('#waExtSearch').value.trim().toLowerCase();
    return state.contacts.filter(item => (!city || item.city === city) && (!status || item.status === status) && (!query || item.name.toLowerCase().includes(query) || item.phone.includes(query.replace(/\D/g, '') || query)));
  };

  function renderRows() {
    const rows = filtered(), pages = Math.max(1, Math.ceil(rows.length / PAGE));
    page = Math.min(page, pages);
    $('#waExtCount').textContent = `${number.format(rows.length)} kontak`;
    const pageRows = rows.slice((page - 1) * PAGE, page * PAGE), selectable = pageRows.filter(item => item.status === 'active');
    $('#waExtSelectPage').checked = selectable.length > 0 && selectable.every(item => selected.has(item.id));
    $('#waExtRows').innerHTML = rows.length ? pageRows.map(item => `<tr><td class="wa-check-cell"><input type="checkbox" data-wa-select="${item.id}" ${selected.has(item.id) ? 'checked' : ''} ${item.status === 'active' ? '' : 'disabled title="Prospek berhenti tidak dapat dikirimi pesan"'}/></td><td><strong>${esc(item.name)}</strong></td><td>${esc(item.phone)}</td><td>${esc(item.city || '—')}</td><td>${item.status === 'active' ? '<span class="tag">Aktif</span>' : '<span class="tag wa-tag-stopped">Berhenti</span>'}</td><td>${esc(item.notes || '')}</td><td class="wa-actions"><button type="button" class="button secondary" data-wa-ext-edit="${item.id}">Edit</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Tidak ada prospek pada filter ini.</td></tr>';
    updateManualSummary();
    $('#waExtPager').innerHTML = pages > 1 ? `<button type="button" class="button ghost" data-wa-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Sebelumnya</button><span>Halaman ${page} dari ${pages}</span><button type="button" class="button ghost" data-wa-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Berikutnya ›</button>` : '';
  }

  function updateSendSummary() {
    const cities = [...document.querySelectorAll('#waExtSendCities input:checked')].map(input => input.value);
    const total = state.cities.filter(item => cities.includes(item.city)).reduce((sum, item) => sum + Number(item.active || 0), 0);
    $('#waExtSendSummary').textContent = cities.length ? `${number.format(total)} prospek aktif akan menerima template.` : 'Belum ada kota dipilih.';
    return { cities, total };
  }

  // Penerima pesan manual = prospek aktif di kota yang dicentang ∪ kontak yang dicentang di tabel.
  function updateManualSummary() {
    const cities = [...document.querySelectorAll('#waExtManualCities input:checked')].map(input => input.value);
    const active = new Map(state.contacts.filter(item => item.status === 'active').map(item => [item.id, item]));
    [...selected].forEach(id => { if (!active.has(id)) selected.delete(id); });
    const recipients = new Set(state.contacts.filter(item => item.status === 'active' && cities.includes(item.city)).map(item => item.id));
    selected.forEach(id => recipients.add(id));
    $('#waExtManualSelected').innerHTML = selected.size ? `${number.format(selected.size)} kontak dicentang di daftar prospek. <button type="button" class="button ghost" id="waExtClearSelection">Hapus centang</button>` : 'Tip: centang kontak tertentu di daftar prospek di bawah untuk mengirim ke kontak satuan.';
    $('#waExtManualSummary').textContent = recipients.size ? `${number.format(recipients.size)} prospek aktif akan menerima pesan.` : 'Belum ada penerima dipilih.';
    return { cities, contact_ids: [...selected], total: recipients.size };
  }

  function render(data) {
    state = data;
    const manualChecked = new Set([...document.querySelectorAll('#waExtManualCities input:checked')].map(input => input.value));
    const manualBox = $('#waExtManualCities');
    manualBox.querySelectorAll('label').forEach(label => label.remove());
    manualBox.insertAdjacentHTML('beforeend', data.cities.map(item => `<label><input type="checkbox" value="${esc(item.city)}" ${manualChecked.has(item.city) ? 'checked' : ''} ${item.active ? '' : 'disabled'}/> ${esc(item.city)} (${number.format(item.active || 0)})</label>`).join(''));
    const filterCity = $('#waExtFilterCity'), currentCity = filterCity.value, checked = new Set([...document.querySelectorAll('#waExtSendCities input:checked')].map(input => input.value));
    $('#waExtCityCards').innerHTML = state.cities.length ? state.cities.map(item => `<button type="button" class="wa-city-card" data-wa-city="${esc(item.city)}"><strong>${esc(item.city || 'Tanpa kota')}</strong><span>${number.format(item.total)} kontak</span><small>${number.format(item.active || 0)} aktif · ${number.format(item.stopped || 0)} berhenti</small></button>`).join('') : '<p class="empty">Belum ada prospek. Impor file VCF untuk memulai.</p>';
    filterCity.innerHTML = '<option value="">Semua kota</option>' + state.cities.map(item => `<option value="${esc(item.city)}">${esc(item.city)} (${number.format(item.total)})</option>`).join('');
    filterCity.value = state.cities.some(item => item.city === currentCity) ? currentCity : '';
    $('#waExtCityList').innerHTML = state.cities.map(item => `<option value="${esc(item.city)}">`).join('');
    const box = $('#waExtSendCities');
    box.querySelectorAll('label').forEach(label => label.remove());
    box.insertAdjacentHTML('beforeend', state.cities.map(item => `<label><input type="checkbox" value="${esc(item.city)}" ${checked.has(item.city) ? 'checked' : ''} ${item.active ? '' : 'disabled'}/> ${esc(item.city)} (${number.format(item.active || 0)})</label>`).join(''));
    const form = $('#waExtTemplateForm');
    form.elements.name.value = state.template.name || '';
    form.elements.language.value = state.template.language || 'id';
    form.elements.param.value = state.template.param || 'none';
    $('#waExtTemplateNote').innerHTML = !state.api_ready ? 'API WhatsApp Business belum diatur. Akun master mengisinya di <b>Pesan Internal → Pengaturan</b>.' : state.template.name ? `Template aktif: <b>${esc(state.template.name)}</b> (${esc(state.template.language)}).` : 'Belum ada template. Buat dan ajukan template di Meta Business Manager → WhatsApp Manager → Template pesan, lalu isi namanya di sini setelah berstatus <b>Approved</b>.';
    $('#waExtSends').innerHTML = state.sends.length ? state.sends.map(item => `<tr><td>${esc(item.sent_at)}</td><td>${esc(item.sent_by)}</td><td>${esc(item.kind === 'template' ? `Template: ${item.template_name}` : item.template_name)}</td><td>${esc(item.cities.join(', '))}</td><td>${number.format(item.sent)} / ${number.format(item.total)}</td><td>${number.format(item.failed)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">Belum ada pengiriman.</td></tr>';
    updateSendSummary();
    renderRows();
  }

  function openEditor(id) {
    const contact = id ? state.contacts.find(item => Number(item.id) === Number(id)) : null;
    const form = $('#waExtForm');
    form.dataset.id = contact ? contact.id : '';
    $('#waExtDialogTitle').textContent = contact ? 'Edit prospek' : 'Tambah prospek';
    form.elements.name.value = contact?.name || '';
    form.elements.phone.value = contact?.phone || '';
    form.elements.city.value = contact?.city || $('#waExtFilterCity').value || '';
    form.elements.status.value = contact?.status || 'active';
    form.elements.notes.value = contact?.notes || '';
    $('#waExtDialog').showModal();
  }

  function wire() {
    $('#whatsappSubnav').addEventListener('click', event => { const button = event.target.closest('[data-wa-tab]'); if (button) showTab(button.dataset.waTab); });
    ['#waExtFilterCity', '#waExtFilterStatus'].forEach(selector => $(selector).addEventListener('change', () => { page = 1; renderRows(); }));
    $('#waExtSearch').addEventListener('input', () => { page = 1; renderRows(); });
    $('#waExtSendCities').addEventListener('change', updateSendSummary);
    $('#waExtManualCities').addEventListener('change', updateManualSummary);
    $('#waExtRows').addEventListener('change', event => { const box = event.target.closest('[data-wa-select]'); if (!box) return; const id = Number(box.dataset.waSelect); if (box.checked) selected.add(id); else selected.delete(id); renderRows(); });
    $('#waExtSelectPage').addEventListener('change', event => { document.querySelectorAll('#waExtRows [data-wa-select]:not(:disabled)').forEach(box => { const id = Number(box.dataset.waSelect); if (event.target.checked) selected.add(id); else selected.delete(id); }); renderRows(); });
    $('#waExtManualPanel').addEventListener('click', event => { if (event.target.closest('#waExtClearSelection')) { selected.clear(); renderRows(); } });
    $('#waExtManualForm').elements.image_file.addEventListener('change', event => { const file = event.target.files[0], preview = $('#waExtManualPreview'); if (preview.src) URL.revokeObjectURL(preview.src); preview.hidden = !file; preview.src = file ? URL.createObjectURL(file) : ''; });
    $('#waExtManualForm').onsubmit = async event => {
      event.preventDefault();
      const form = event.target, button = form.querySelector('[type=submit]'), { cities, contact_ids, total } = updateManualSummary(), file = form.elements.image_file.files[0], message = form.elements.message.value.trim();
      if (!total) return notify('Pilih kota atau centang kontak penerima.');
      if (!message && !file) return notify('Isi pesan atau pilih gambar.');
      if (file && message.length > 1024) return notify('Keterangan gambar maksimal 1.024 karakter.');
      const target = [...cities, ...(contact_ids.length ? [`${contact_ids.length} kontak dicentang`] : [])].join(', ');
      if (!confirm(`Kirim ${file ? 'gambar' + (message ? ' + keterangan' : '') : 'pesan teks'} ke ${number.format(total)} prospek aktif (${target})?\n\nHanya prospek yang membalas dalam 24 jam terakhir yang akan menerimanya. Pesan terkirim tidak dapat dibatalkan.`)) return;
      button.disabled = true;
      $('#waExtManualResult').textContent = `Mengirim ke ${number.format(total)} prospek… jangan tutup halaman ini.`;
      try {
        const body = { cities, contact_ids, message, expected_total: total };
        if (file) body.image = await window.capWhatsappImage(file);
        const result = await request('/api/whatsapp-external/manual', 'POST', body);
        render(result.data);
        const outside = result.failed.filter(item => /24 jam/.test(item.error)).length, other = result.failed.filter(item => !/24 jam/.test(item.error));
        $('#waExtManualResult').textContent = `${number.format(result.sent)} dari ${number.format(result.total)} pesan terkirim.${outside ? ` ${number.format(outside)} di luar jendela 24 jam (perlu template).` : ''}${other.length ? ` Gagal lain ${other.length}: ${other.slice(0, 3).map(item => `${item.name}: ${item.error}`).join(' · ')}${other.length > 3 ? ' …' : ''}.` : ''}`;
        form.reset(); $('#waExtManualPreview').hidden = true; selected.clear(); renderRows();
      } catch (error) { $('#waExtManualResult').textContent = ''; notify(error.message); } finally { button.disabled = false; loadQuota(); }
    };
    $('#waExtAddButton').onclick = () => openEditor(null);
    $('#whatsappExternalTab').addEventListener('click', event => {
      const edit = event.target.closest('[data-wa-ext-edit]'), pager = event.target.closest('[data-wa-page]'), city = event.target.closest('[data-wa-city]');
      if (edit) openEditor(edit.dataset.waExtEdit);
      if (pager) { page = Number(pager.dataset.waPage); renderRows(); }
      if (city) { $('#waExtFilterCity').value = city.dataset.waCity; page = 1; renderRows(); $('#waExtRows').closest('.table-panel').scrollIntoView({ behavior: 'smooth' }); }
    });
    $('#waExtForm').onsubmit = async event => {
      event.preventDefault();
      const form = event.target, id = form.dataset.id, button = form.querySelector('[type=submit]');
      button.disabled = true;
      try {
        const body = { name: form.elements.name.value, phone: form.elements.phone.value, city: form.elements.city.value, status: form.elements.status.value, notes: form.elements.notes.value };
        render(await request(id ? `/api/whatsapp-external/contacts/${id}` : '/api/whatsapp-external/contacts', id ? 'PUT' : 'POST', body));
        $('#waExtDialog').close();
        notify(id ? 'Prospek diperbarui.' : 'Prospek ditambahkan.');
      } catch (error) { notify(error.message); } finally { button.disabled = false; }
    };
    $('#waExtImportFile').onchange = async event => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      try {
        const result = await request('/api/whatsapp-external/import', 'POST', { vcf: await file.text(), filename: file.name });
        render(result.data);
        notify(`${number.format(result.added)} prospek baru ditambahkan, ${number.format(result.skipped)} sudah ada dan dilewati${result.invalid.length ? `, ${result.invalid.length} nomor tidak valid` : ''}.`);
      } catch (error) { notify(error.message); }
    };
    $('#waExtTemplateForm').onsubmit = async event => {
      event.preventDefault();
      try { render(await request('/api/whatsapp-external/template', 'PUT', Object.fromEntries(new FormData(event.target)))); notify('Template disimpan.'); } catch (error) { notify(error.message); }
    };
    $('#waExtSendForm').onsubmit = async event => {
      event.preventDefault();
      const { cities, total } = updateSendSummary(), button = event.target.querySelector('[type=submit]');
      if (!cities.length) return notify('Pilih minimal satu kota.');
      if (!state.template.name) return notify('Isi nama template Meta yang sudah disetujui terlebih dahulu.');
      if (!confirm(`Kirim template "${state.template.name}" ke ${number.format(total)} prospek aktif di ${cities.join(', ')}?\n\nPesan yang sudah terkirim tidak dapat dibatalkan.`)) return;
      button.disabled = true;
      $('#waExtSendResult').textContent = `Mengirim ke ${number.format(total)} prospek… jangan tutup halaman ini.`;
      try {
        const result = await request('/api/whatsapp-external/send', 'POST', { cities, expected_total: total });
        render(result.data);
        const failures = result.failed.slice(0, 5).map(item => `${item.name}: ${item.error}`).join(' · ');
        $('#waExtSendResult').textContent = `${number.format(result.sent)} dari ${number.format(result.total)} template terkirim.${result.failed.length ? ` Gagal ${result.failed.length}${failures ? ` — ${failures}` : ''}${result.failed.length > 5 ? ' …' : ''}.` : ''}`;
      } catch (error) { $('#waExtSendResult').textContent = ''; notify(error.message); } finally { button.disabled = false; loadQuota(); }
    };
  }

  window.addEventListener('cap:whatsapp-shown', event => {
    setup();
    if (!ready) return;
    const modules = window.capUser?.modules || [], master = window.capUser?.role === 'master';
    access = { internal: Boolean(event.detail?.internal), external: master || modules.includes('whatsapp_external') };
    let saved = null;
    try { saved = localStorage.getItem('cap-wa-tab'); } catch {}
    showTab(saved || tab);
    loadQuota();
  });

  document.head.insertAdjacentHTML('beforeend', `<style id="whatsappExternalStyle">
.wa-subnav{display:flex;gap:6px;margin:12px 0 0}.wa-subnav[hidden]{display:none}.wa-subnav button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:8px 16px;font:inherit;font-weight:650;color:#526077;cursor:pointer}.wa-subnav button.active{background:var(--blue);border-color:var(--blue);color:#fff}
#whatsappInternalTab>section,#whatsappExternalTab>section{margin-bottom:16px}
.wa-city-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:6px}.wa-city-card{display:grid;gap:3px;text-align:left;border:1px solid var(--line);background:var(--paper);border-radius:10px;padding:12px;font:inherit;cursor:pointer}.wa-city-card:hover{border-color:var(--blue)}.wa-city-card span{font-size:13px}.wa-city-card small{color:var(--muted);font-size:11px}
.wa-filters{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px}.wa-filters label{flex:1 1 180px;margin:6px 0}
.wa-pager{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:10px;font-size:13px;color:var(--muted)}
.wa-file-button{display:inline-flex;align-items:center;margin:0;cursor:pointer}.wa-tag-stopped{background:#fdecec;color:#b42318}
#waExtSendForm .dialog-actions,#waExtManualForm .dialog-actions{align-items:center;justify-content:space-between}
.wa-quota{display:grid;grid-template-columns:minmax(220px,1fr) 2fr;gap:8px 24px;align-items:center;margin-bottom:16px}.wa-quota>.dialog-note{grid-column:1/-1;margin:0}.wa-quota-main strong{display:block;font-size:30px;line-height:1.1;margin:4px 0}.wa-quota-main span{font-size:12px;color:var(--muted)}.wa-quota-bar{height:6px;border-radius:9px;background:var(--line);margin-top:8px;overflow:hidden}.wa-quota-bar i{display:block;height:100%;background:var(--blue)}.wa-quota-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0}.wa-quota-facts div{background:var(--paper);border-radius:9px;padding:9px 11px}.wa-quota-facts dt{font-size:11px;color:var(--muted)}.wa-quota-facts dd{margin:2px 0 0;font-weight:650;font-size:13px}.wa-quota-error{color:#b42318!important}
@media(max-width:760px){.wa-quota{grid-template-columns:1fr}}
.wa-warning{background:#fff7e6;border:1px solid #ffe2a8;border-radius:8px;padding:8px 11px;color:#7a4b00!important}
.wa-image-preview{max-width:220px;max-height:160px;border-radius:8px;border:1px solid var(--line);object-fit:contain}
.wa-check-cell{width:34px;text-align:center}.wa-check-cell input{width:auto;margin:0}
#waExtManualSelected .button{padding:3px 8px;font-size:12px}
</style>`);
})();
