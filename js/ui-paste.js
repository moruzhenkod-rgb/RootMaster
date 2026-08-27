const UIPaste = (() => {
  let root, ocrWorker = null;

  function mount(container) {
    root = container;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    const textarea = root.querySelector('#paste-textarea');
    textarea.addEventListener('input', () => {
      document.getElementById('btn-paste-submit').disabled = !textarea.value.trim();
    });
  }
  function unmount() {
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    if (ocrWorker) { try { ocrWorker.terminate(); } catch (e) {} ocrWorker = null; }
  }

  function setStatus(t) { const el = root.querySelector('#paste-ocr-status'); if (el) el.textContent = t || ''; }

  // фото -> canvas: если портрет (таблица боком) — поворачиваем в альбом; ч/б + контраст
  function imageToCanvas(img, rotateDeg) {
    const maxW = 2000;
    let w = img.width, h = img.height;
    const scale = Math.min(1, maxW / Math.max(w, h));
    w = Math.round(w * scale); h = Math.round(h * scale);
    const rot = rotateDeg || 0;
    const c = document.createElement('canvas');
    if (rot === 90 || rot === -90 || rot === 270) { c.width = h; c.height = w; } else { c.width = w; c.height = h; }
    const ctx = c.getContext('2d');
    ctx.save();
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
    // ч/б + контраст
    try {
      const im = ctx.getImageData(0, 0, c.width, c.height), d = im.data;
      for (let i = 0; i < d.length; i += 4) {
        let g = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
        g = (g - 128) * 1.4 + 128; g = g < 0 ? 0 : g > 255 ? 255 : g;
        d[i] = d[i + 1] = d[i + 2] = g;
      }
      ctx.putImageData(im, 0, 0);
    } catch (e) {}
    return c;
  }

  async function getWorker() {
    if (ocrWorker) return ocrWorker;
    setStatus('Загрузка распознавания… (только первый раз)');
    ocrWorker = await Tesseract.createWorker('deu', 1, {
      logger: (m) => { if (m.status === 'recognizing text') setStatus('Распознаю… ' + Math.round((m.progress || 0) * 100) + '%'); },
    });
    return ocrWorker;
  }

  async function handleFile(file) {
    if (!file || typeof Tesseract === 'undefined') { Utils.toast('Распознавание недоступно', 'error'); return; }
    setStatus('Готовлю фото…');
    const img = new Image();
    img.onload = async () => {
      // портретное фото таблицы -> поворот в альбом
      const rot = img.height > img.width ? -90 : 0;
      const canvas = imageToCanvas(img, rot);
      try {
        const worker = await getWorker();
        const { data: { text } } = await worker.recognize(canvas);
        const lines = parseList(text);
        const ta = root.querySelector('#paste-textarea');
        ta.value = (ta.value ? ta.value.trim() + '\n' : '') + lines.join('\n');
        document.getElementById('btn-paste-submit').disabled = !ta.value.trim();
        setStatus(lines.length ? ('Распознано строк: ' + lines.length + ' — проверь и жми «Проверить»') : 'Строк не найдено — попробуй ровнее/светлее');
      } catch (e) { setStatus('Ошибка распознавания'); }
    };
    img.onerror = () => setStatus('Не удалось открыть фото');
    img.src = URL.createObjectURL(file);
  }

  // OCR-текст таблицы -> строки в формате парсера (база потом исправит неточности)
  function parseList(text) {
    const out = [];
    const rows = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (const line of rows) {
      const plzM = line.match(/\b(\d{5})\b/);
      if (!plzM) continue;                 // строка без индекса — не адрес
      const plz = plzM[1];
      const before = line.slice(0, plzM.index).trim();   // фирма + улица
      const after = line.slice(plzM.index + 5).trim();   // ключ + город + время + ...
      // ключ: 4-значное число
      const keyM = after.match(/\b(\d{4})\b/) || before.match(/\b(\d{4})\b/);
      const key = keyM ? keyM[1] : '';
      // город: первое слово из букв после индекса (пропустив ключ)
      const cityM = after.replace(/\b\d{4}\b/, '').match(/([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß.\/ -]{2,})/);
      const city = cityM ? cityM[1].trim().split(/\s{2,}/)[0].split(' 0')[0].trim() : '';
      // время (не 08:00 = срочно)
      const timeM = after.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
      const time = timeM ? timeM[0] : '';
      // фирма+улица (убираем ведущий номер позиции)
      const firmStreet = before.replace(/^\d{1,3}\s+/, '').trim();
      if (!firmStreet && !city) continue;
      let l = firmStreet + (city ? ' ' + city : '') + ', ' + plz + (city ? ' ' + city : '');
      // соберём как: Фирма/улица PLZ Город — Ключ — [Время]
      const parts = [firmStreet + ', ' + plz + (city ? ' ' + city : '')];
      if (key) parts.push('Ключ: ' + plz + '-' + key);
      if (time && time !== '08:00' && time !== '8:00') parts.push('Время: ' + time);
      out.push(parts.join(' — '));
    }
    return out;
  }

  function onChange(e) {
    if (e.target && (e.target.id === 'paste-photo' || e.target.id === 'paste-gallery')) {
      const f = e.target.files && e.target.files[0];
      if (f) handleFile(f);
      e.target.value = '';
    }
  }

  function onClick(e) {
    if (e.target.closest('[data-action="back-home"]')) { Router.show('home'); return; }
    if (e.target.closest('[data-action="paste-photo"]')) { root.querySelector('#paste-photo').click(); return; }
    if (e.target.closest('[data-action="paste-gallery"]')) { root.querySelector('#paste-gallery').click(); return; }
    if (e.target.closest('[data-action="paste-submit"]')) {
      const text = root.querySelector('#paste-textarea').value.trim();
      if (!text) return;
      Router.show('scan', { rawText: text });
    }
  }

  return { mount, unmount };
})();
