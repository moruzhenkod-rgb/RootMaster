// Переиспользуемый сканер этикетки камерой (OCR). Находит получателя (Empfänger),
// сверяет с базой (улица+индекс), возвращает {company, address} через onResult. Фото не хранится.
const CamScanner = (() => {
  let stream = null, worker = null, scanning = false, busy = false, timer = null, cb = null;

  function clients() { try { return JSON.parse(localStorage.getItem('rm_clients') || '[]'); } catch (e) { return []; } }

  function normLoose(s) {
    return String(s || '').toLowerCase()
      .replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
      .replace(/[^0-9a-z]+/g, ' ').trim();
  }

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
    } else { block = lines; }
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
        g = (g - 128) * 1.45 + 128; g = g < 0 ? 0 : g > 255 ? 255 : g;
        d[i] = d[i + 1] = d[i + 2] = g;
      }
      ctx.putImageData(img, 0, 0);
    } catch (e) {}
    return c;
  }

  function setStatus(t, ok) {
    const el = document.getElementById('cs-status');
    if (!el) return; el.textContent = t || '';
    el.style.background = ok ? 'rgba(34,160,80,0.85)' : 'rgba(0,0,0,0.55)';
  }

  async function getWorker() {
    if (worker) return worker;
    setStatus('Загрузка распознавания… (только первый раз)');
    worker = await Tesseract.createWorker('deu', 1, {
      logger: (m) => { if (m.status === 'recognizing text') setStatus('Считываю… ' + Math.round((m.progress || 0) * 100) + '%'); },
    });
    return worker;
  }

  async function open(opts) {
    opts = opts || {};
    cb = opts.onResult || null;
    if (typeof Tesseract === 'undefined') { Utils.toast('Модуль распознавания не загрузился (интернет?)', 'error'); return; }
    let ov = document.getElementById('cs-overlay');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'cs-overlay'; ov.className = 'cam-overlay';
      ov.innerHTML = `
        <video id="cs-video" playsinline autoplay muted></video>
        <div class="cam-frame"></div>
        <div class="cam-status" id="cs-status"></div>
        <div class="cam-controls">
          <button class="btn btn-ghost" data-cs="close">Готово</button>
          <button class="btn btn-primary" data-cs="shot">📸 Скан сейчас</button>
        </div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', onClick);
    }
    ov.style.display = 'flex';
    setStatus('Включаю камеру…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
      const v = document.getElementById('cs-video');
      v.srcObject = stream; await v.play();
      setStatus('Наведите на этикетку — распознаю сам…');
      scanning = true; loop();
    } catch (e) { Utils.toast('Нет доступа к камере', 'error'); close(); }
  }

  function close() {
    scanning = false;
    if (timer) { clearTimeout(timer); timer = null; }
    const ov = document.getElementById('cs-overlay');
    if (ov) ov.style.display = 'none';
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }

  async function loop() {
    if (!scanning) return;
    if (!busy) { busy = true; try { await doScan(); } catch (e) {} busy = false; }
    if (scanning) timer = setTimeout(loop, 1200);
  }

  async function doScan() {
    const v = document.getElementById('cs-video');
    if (!v || !v.videoWidth) return;
    const wk = await getWorker();
    const { data: { text } } = await wk.recognize(frameCanvas(v));
    handle(text);
  }

  function handle(text) {
    const cs = clients();
    const rec = extractRecipient(text);
    const baseHit = baseMatchFromText(text, cs);
    let company = '', address = '';
    if (baseHit) { address = baseHit.address; company = (rec && rec.company) ? rec.company : baseHit.company; }
    else if (rec && rec.address) { company = rec.company || ''; address = rec.address; }
    else { setStatus('Ищу адрес получателя… наведите на блок «Empfänger»'); return; }
    setStatus('✓ ' + (company ? company + ' · ' : '') + address, true);
    if (navigator.vibrate) navigator.vibrate(70);
    const f = cb;
    close();
    if (f) f({ company, address });
  }

  function onClick(e) {
    if (e.target.closest('[data-cs="close"]')) { close(); return; }
    if (e.target.closest('[data-cs="shot"]')) { if (!busy) doScan(); return; }
  }

  return { open, close };
})();
