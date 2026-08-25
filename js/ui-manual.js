// Ручная загрузка тура: выбор из базы + ручной ввод + СКАН-СКАНЕР камерой (OCR).
// Экстренный режим: камера непрерывно считывает этикетку, находит блок ПОЛУЧАТЕЛЯ (Empfänger),
// сверяет с базой (улица+индекс) и добавляет ТОЛЬКО фирму+адрес (без ключа/веса). Фото не хранится.
const UIManual = (() => {
  let root, selected = new Set(), newPoints = [], searchQuery = '';
  let stream = null, ocrWorker = null;
  let scanning = false, busy = false, scanTimer = null, scannedKeys = new Set();

  function mount(container) {
    root = container;
    selected = new Set();
    newPoints = [];
    searchQuery = '';
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    render();
  }
  function unmount() {
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
    stopCamera();
    if (ocrWorker) { try { ocrWorker.terminate(); } catch (e) {} ocrWorker = null; }
  }

  function clients() {
    try { return JSON.parse(localStorage.getItem('rm_clients') || '[]'); } catch (e) { return []; }
  }
  function esc(v) { return Utils.escapeHtml(v == null ? '' : v); }

  function onInput(e) {
    if (e.target && e.target.id === 'manual-search') {
      searchQuery = e.target.value.toLowerCase().trim();
      renderClients();
    }
  }

  function render() { renderNew(); renderClients(); updateBtn(); }

  function renderNew() {
    const el = root.querySelector('#manual-new-list');
    if (!el) return;
    if (!newPoints.length) { el.innerHTML = ''; return; }
    el.innerHTML = newPoints.map((p, i) => `
      <div class="client-card sel">
        <div class="client-body">
          ${p.company ? `<div class="client-firm">${esc(p.company)}</div>` : ''}
          <div class="client-addr">${esc(p.address)}</div>
          ${p.key ? `<div class="client-key">🔑 ${esc(p.key)}</div>` : ''}
        </div>
        <button class="icon-btn" data-action="manual-del-new" data-idx="${i}">✕</button>
      </div>`).join('');
  }

  function renderClients() {
    const list = root.querySelector('#manual-clients-list');
    if (!list) return;
    const cs = clients();
    if (!cs.length) { list.innerHTML = '<div class="empty-hint">База клиентов пуста</div>'; return; }
    const nq = searchQuery ? ClientMatch.normAddr(searchQuery) : '';
    const items = cs.map((c, i) => ({ c, i })).filter(({ c }) =>
      !nq || ClientMatch.normAddr(c.company).includes(nq) || ClientMatch.normAddr(c.address).includes(nq));
    if (!items.length) { list.innerHTML = '<div class="empty-hint">Ничего не найдено</div>'; return; }
    list.innerHTML = items.map(({ c, i }) => `
      <div class="client-card ${selected.has(i) ? 'sel' : ''}" data-idx="${i}" data-action="manual-toggle">
        <div class="client-check">${selected.has(i) ? '✓' : ''}</div>
        <div class="client-body">
          ${c.company ? `<div class="client-firm">${esc(c.company)}</div>` : ''}
          <div class="client-addr">${esc(c.address)}</div>
          ${c.key || c.cell ? `<div class="client-key">${c.key ? '🔑 ' + esc(c.key) : ''}${c.key && c.cell ? ' · ' : ''}${c.cell ? '🗄 ' + esc(c.cell) : ''}</div>` : ''}
        </div>
      </div>`).join('');
  }

  function updateBtn() {
    const b = root.querySelector('#btn-manual-build');
    if (!b) return;
    const n = selected.size + newPoints.length;
    b.disabled = !n;
    b.textContent = `Собрать тур (${n})`;
  }

  function addNew() {
    const cEl = root.querySelector('#m-company');
    const aEl = root.querySelector('#m-address');
    const kEl = root.querySelector('#m-key');
    const company = cEl.value.trim(), address = aEl.value.trim(), key = kEl.value.trim();
    if (!address) { Utils.toast('Введите адрес', 'error'); return; }
    newPoints.push({ company, address, key });
    cEl.value = ''; aEl.value = ''; kEl.value = '';
    aEl.focus();
    renderNew(); updateBtn();
  }

  function lineFor(company, address, key) {
    const parts = [];
    if (company) parts.push(company);
    parts.push(address);
    if (key) parts.push('Ключ: ' + key);
    return parts.join(' — ');
  }

  function build() {
    const cs = clients();
    const lines = [];
    for (const p of newPoints) lines.push(lineFor(p.company, p.address, p.key));
    for (const i of selected) { const c = cs[i]; if (c) lines.push(lineFor(c.company, c.address, c.key)); }
    if (!lines.length) return;
    Router.show('scan', { rawText: lines.join('\n') });
  }

  // ═══ Камера-сканер + OCR ═══
  function setCamStatus(t, ok) {
    const el = root.querySelector('#cam-status');
    if (!el) return;
    el.textContent = t || '';
    el.style.background = ok ? 'rgba(34,160,80,0.85)' : 'rgba(0,0,0,0.55)';
  }

  // «свободная» нормализация: умлауты→латиница, только буквы/цифры, для сверки с базой
  function normLoose(s) {
    return String(s || '').toLowerCase()
      .replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
      .replace(/[^0-9a-z]+/g, ' ').trim();
  }

  // подобрать клиента из базы по совпадению улицы/индекса/фирмы во всём тексте OCR
  function baseMatchFromText(text, cs) {
    const t = ' ' + normLoose(text) + ' ';
    let best = null, bestScore = 0;
    for (const c of cs) {
      const addr = normLoose(c.address), comp = normLoose(c.company);
      let score = 0;
      const plz = (addr.match(/\b\d{5}\b/) || [])[0];
      if (plz && t.includes(plz)) score += 3;
      for (const w of addr.split(' ')) if (w.length >= 5 && !/^\d+$/.test(w) && t.includes(' ' + w + ' ')) score += 2;
      for (const w of comp.split(' ')) if (w.length >= 4 && t.includes(' ' + w + ' ')) score += 2;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return bestScore >= 4 ? best : null;
  }

  // извлечь получателя (блок Empfänger) — фирма + адрес
  function extractRecipient(text) {
    const lines = (text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!lines.length) return null;
    let ei = lines.findIndex((l) => /empf/i.test(l));
    let block;
    if (ei >= 0) {
      block = [];
      for (let i = ei + 1; i < lines.length && block.length < 6; i++) {
        if (/versend|absender|relation|datum|liefer|colli|gewicht|^\d{6,}/i.test(lines[i])) break;
        block.push(lines[i]);
      }
    } else {
      block = lines;
    }
    let pi = block.findIndex((l) => /\b\d{5}\b/.test(l) && /[a-zäöüß]{3,}/i.test(l));
    if (pi < 0) return null;
    const plzLine = block[pi];
    const streetRe = /(str\.|stra(ss|ß)e|\bstr\b|weg|ring|allee|platz|damm|ufer|chaussee|gasse|wiese|kamp|hof|feld)/i;
    let street = '';
    for (let i = pi - 1; i >= 0 && i >= pi - 3; i--) {
      if ((/\d/.test(block[i]) && /[a-zäöüß]{3,}/i.test(block[i])) || streetRe.test(block[i])) { street = block[i]; break; }
    }
    let company = '';
    for (let i = 0; i < block.length; i++) {
      if (block[i] !== street && block[i] !== plzLine && /[a-zäöüß]{4,}/i.test(block[i]) && !/\d{5}/.test(block[i])) { company = block[i]; break; }
    }
    return { company, address: street ? (street + ', ' + plzLine) : plzLine };
  }

  async function openCamera() {
    if (typeof Tesseract === 'undefined') { Utils.toast('Модуль распознавания не загрузился (интернет?)', 'error'); return; }
    const ov = root.querySelector('#cam-overlay');
    ov.style.display = 'flex';
    setCamStatus('Включаю камеру…');
    scannedKeys = new Set();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
      const v = root.querySelector('#cam-video');
      v.srcObject = stream;
      await v.play();
      setCamStatus('Наведите на этикетку — распознаю сам…');
      scanning = true;
      scanLoop();
    } catch (e) {
      Utils.toast('Нет доступа к камере', 'error');
      stopCamera();
    }
  }

  function stopCamera() {
    scanning = false;
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    const ov = root.querySelector('#cam-overlay');
    if (ov) ov.style.display = 'none';
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }

  async function getWorker() {
    if (ocrWorker) return ocrWorker;
    setCamStatus('Загрузка распознавания… (только первый раз)');
    ocrWorker = await Tesseract.createWorker('deu', 1, {
      logger: (m) => { if (m.status === 'recognizing text') setCamStatus('Считываю… ' + Math.round((m.progress || 0) * 100) + '%'); },
    });
    return ocrWorker;
  }

  // кадр → ч/б + контраст (лучше OCR печатной этикетки)
  function frameCanvas(v) {
    const maxW = 1400;
    const scale = Math.min(1, maxW / v.videoWidth);
    const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.drawImage(v, 0, 0, w, h);
    try {
      const img = ctx.getImageData(0, 0, w, h), d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        let g = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
        g = (g - 128) * 1.45 + 128;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        d[i] = d[i + 1] = d[i + 2] = g;
      }
      ctx.putImageData(img, 0, 0);
    } catch (e) {}
    return c;
  }

  async function scanLoop() {
    if (!scanning) return;
    if (!busy) {
      busy = true;
      try { await doScan(); } catch (e) {}
      busy = false;
    }
    if (scanning) scanTimer = setTimeout(scanLoop, 1200);
  }

  async function doScan() {
    const v = root.querySelector('#cam-video');
    if (!v || !v.videoWidth) return;
    const worker = await getWorker();
    const { data: { text } } = await worker.recognize(frameCanvas(v));
    handleScan(text);
  }

  function flashOk(msg) {
    setCamStatus(msg, true);
    if (navigator.vibrate) navigator.vibrate(70);
  }

  function handleScan(text) {
    const cs = clients();
    const rec = extractRecipient(text);
    const baseHit = baseMatchFromText(text, cs);
    let company = '', address = '';
    if (baseHit) {
      // база подтвердила адрес → берём ЧИСТЫЙ адрес из базы (координаты подтянутся), фирму — из OCR если распозналась
      address = baseHit.address;
      company = (rec && rec.company) ? rec.company : baseHit.company;
    } else if (rec && rec.address) {
      company = rec.company || '';
      address = rec.address;
    } else {
      setCamStatus('Ищу адрес получателя… наведите на блок «Empfänger»');
      return;
    }
    const key = normLoose(address);
    if (scannedKeys.has(key)) { setCamStatus('Уже добавлено: ' + (company || address), true); return; }
    scannedKeys.add(key);
    newPoints.push({ company, address, key: '' });
    renderNew(); updateBtn();
    flashOk('✓ ' + (company ? company + ' · ' : '') + address);
  }

  function onClick(e) {
    if (e.target.closest('[data-action="back-home"]')) { Router.show('home'); return; }
    if (e.target.closest('[data-action="cam-open"]')) { openCamera(); return; }
    if (e.target.closest('[data-action="cam-close"]')) { stopCamera(); return; }
    if (e.target.closest('[data-action="cam-shot"]')) { if (!busy) doScan(); return; }
    if (e.target.closest('[data-action="manual-add-point"]')) { addNew(); return; }
    const delNew = e.target.closest('[data-action="manual-del-new"]');
    if (delNew) { newPoints.splice(+delNew.dataset.idx, 1); renderNew(); updateBtn(); return; }
    if (e.target.closest('[data-action="manual-build"]')) { build(); return; }
    const card = e.target.closest('[data-action="manual-toggle"]');
    if (card) {
      const i = +card.dataset.idx;
      if (selected.has(i)) selected.delete(i); else selected.add(i);
      renderClients(); updateBtn();
    }
  }

  return { mount, unmount };
})();
