const UIPaste = (() => {
  let root;

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
  }

  function setStatus(t) { const el = root.querySelector('#paste-ocr-status'); if (el) el.textContent = t || ''; }

  // ── прогресс с сегментами (по одному на лист) ──
  let _progTimer = null, _prog = 0, _progTarget = 0, _segBase = 0, _segCap = 92, _segT0 = 0;
  function showProgress(on) {
    const box = root.querySelector('#paste-progress');
    if (box) box.hidden = !on;
    if (!on && _progTimer) { clearInterval(_progTimer); _progTimer = null; }
  }
  function paint() {
    const shown = Math.min(100, Math.round(_prog));
    const fill = root.querySelector('#paste-progress-fill');
    const pct = root.querySelector('#paste-progress-pct');
    if (fill) fill.style.width = shown + '%';
    if (pct) pct.textContent = shown + '%';
  }
  function tick() {
    const el = (Date.now() - _segT0) / 1000;
    _progTarget = _segBase + (_segCap - _segBase) * (1 - Math.exp(-el / 22));
    _prog += (_progTarget - _prog) * 0.25;
    paint();
  }
  function startProgress() {
    _prog = 0; _segBase = 0; _segCap = 8; _segT0 = Date.now();
    showProgress(true); paint();
    if (_progTimer) clearInterval(_progTimer);
    _progTimer = setInterval(tick, 120);
  }
  // сегмент для листа i из n (0-based): плавно ползём в своей доле шкалы
  function segment(i, n) {
    const span = 92 / Math.max(1, n);
    _segBase = Math.max(_prog, i * span);
    _segCap = (i + 1) * span;
    _segT0 = Date.now();
  }
  function segmentDone(i, n) {
    const span = 92 / Math.max(1, n);
    _prog = Math.max(_prog, (i + 1) * span); paint();
  }
  function finishProgress() {
    _segBase = 100; _segCap = 100; _progTarget = 100; _prog = Math.max(_prog, 96);
    setTimeout(() => { _prog = 100; paint(); }, 60);
    setTimeout(() => showProgress(false), 700);
  }

  // уменьшить фото до ~2000px (быстрее загрузка), вернуть Blob
  function downscale(file) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const max = 2000;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        if (scale === 1) { resolve(file); return; }
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => resolve(b || file), 'image/jpeg', 0.9);
      };
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // распознать ОДИН лист → массив строк (throw при ошибке)
  async function processOne(file) {
    const blob = await downscale(file);
    const res = await fetch('/api/parse-list', { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
    const j = await res.json();
    const job = j.job;
    if (!job) throw new Error('Ошибка загрузки: ' + (j.error || res.status));
    for (let i = 0; i < 90; i++) {
      await sleep(4000);
      try {
        const r = await fetch('/api/parse-list-result?job=' + encodeURIComponent(job));
        const jr = await r.json();
        if (jr.status === 'done') return jr.lines || [];
        if (jr.status === 'error') throw new Error('Распознавание: ' + (jr.error || ''));
      } catch (e) { if (e && e.message && e.message.indexOf('Распознавание') === 0) throw e; /* сеть моргнула — опрос дальше */ }
    }
    throw new Error('Слишком долго — фото почётче');
  }

  // распознать НЕСКОЛЬКО листов по очереди и склеить
  async function handleFiles(files) {
    if (!files || !files.length) return;
    const n = files.length;
    setStatus(n > 1 ? ('📸 Готовлю ' + n + ' листа…') : '📸 Готовлю фото…');
    startProgress();
    const all = [];
    for (let i = 0; i < n; i++) {
      segment(i, n);
      setStatus(n > 1 ? ('🔍 Лист ' + (i + 1) + ' из ' + n + '… не закрывай экран') : '🔍 Распознаю список… не закрывай экран');
      try {
        const lines = await processOne(files[i]);
        all.push(...lines);
        segmentDone(i, n);
      } catch (e) {
        showProgress(false);
        setStatus('❌ Лист ' + (i + 1) + ': ' + (e.message || 'ошибка') + (all.length ? ' (что распозналось — вставил)' : ''));
        if (all.length) fillTextarea(all);
        return;
      }
    }
    if (!all.length) { showProgress(false); setStatus('Строк не найдено — сфоткай ровнее/светлее'); return; }
    fillTextarea(all);
    finishProgress();
    setStatus('✓ Распознано строк: ' + all.length + (n > 1 ? (' с ' + n + ' листов') : '') + ' — проверь и жми «Проверить»');
  }

  function fillTextarea(lines) {
    const ta = root.querySelector('#paste-textarea');
    ta.value = (ta.value ? ta.value.trim() + '\n' : '') + lines.join('\n');
    document.getElementById('btn-paste-submit').disabled = !ta.value.trim();
  }

  function onChange(e) {
    if (e.target && (e.target.id === 'paste-photo' || e.target.id === 'paste-gallery')) {
      const files = Array.from(e.target.files || []);
      if (files.length) handleFiles(files);
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
