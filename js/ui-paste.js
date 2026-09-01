const UIPaste = (() => {
  let root;
  let camShots = [];

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
    camShots = [];
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

  // редактор фото: поворот + обрезка. Возвращает Blob (готовое фото) или null (пропустить)
  function openEditor(file) {
    return new Promise((resolve) => {
      const ov = document.getElementById('photo-editor');
      const img = document.getElementById('pe-image');
      if (!ov || !img || typeof Cropper === 'undefined') { resolve(file); return; } // либа не загрузилась — без редактора
      const url = URL.createObjectURL(file);
      let cropper = null;
      function cleanup() {
        ov.removeEventListener('click', onTool);
        if (cropper) { try { cropper.destroy(); } catch (e) {} cropper = null; }
        img.onload = null; img.src = ''; ov.hidden = true;
        try { URL.revokeObjectURL(url); } catch (e) {}
      }
      function onTool(e) {
        const b = e.target.closest('[data-pe]'); if (!b) return;
        const act = b.dataset.pe;
        if (act === 'rot-left') { if (cropper) cropper.rotate(-90); }
        else if (act === 'rot-right') { if (cropper) cropper.rotate(90); }
        else if (act === 'reset') { if (cropper) cropper.reset(); }
        else if (act === 'cancel') { cleanup(); resolve(null); }
        else if (act === 'done') {
          if (!cropper) { cleanup(); resolve(file); return; }
          const canvas = cropper.getCroppedCanvas({ maxWidth: 2600, maxHeight: 2600, imageSmoothingQuality: 'high' });
          cleanup();
          if (!canvas) { resolve(file); return; }
          canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', 0.92);
        }
      }
      ov.hidden = false;
      ov.addEventListener('click', onTool);
      img.onload = () => {
        cropper = new Cropper(img, {
          viewMode: 1, autoCropArea: 0.85, background: false,
          movable: true, zoomable: true, rotatable: true, toggleDragModeOnDblclick: false,
          responsive: true, checkOrientation: true, dragMode: 'crop',
        });
      };
      img.src = url;
    });
  }

  // распознать НЕСКОЛЬКО листов по очереди и склеить
  async function handleFiles(files, skipEdit) {
    if (!files || !files.length) return;
    // редактор (поворот/обрезка) для каждого фото — если ещё не редактировали (камера правит покадрово)
    const edited = [];
    for (let k = 0; k < files.length; k++) {
      if (skipEdit) { edited.push(files[k]); continue; }
      setStatus(files.length > 1 ? ('✏️ Обрезка листа ' + (k + 1) + ' из ' + files.length) : '✏️ Обрежь/поверни лист');
      const blob = await openEditor(files[k]);
      if (blob) edited.push(blob); // null = пропустить это фото
    }
    if (!edited.length) { setStatus(''); return; }
    const n = edited.length;
    setStatus(n > 1 ? ('📸 Готовлю ' + n + ' листа…') : '📸 Готовлю фото…');
    startProgress();
    const all = [];
    for (let i = 0; i < n; i++) {
      segment(i, n);
      setStatus(n > 1 ? ('🔍 Лист ' + (i + 1) + ' из ' + n + '… не закрывай экран') : '🔍 Распознаю список… не закрывай экран');
      try {
        const lines = await processOne(edited[i]);
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

  function showCamMore() {
    const ov = root.querySelector('#cam-more');
    const cnt = root.querySelector('#cam-more-count');
    if (cnt) cnt.textContent = 'Снято листов: ' + camShots.length;
    if (ov) ov.hidden = false;
  }
  function hideCamMore() { const ov = root.querySelector('#cam-more'); if (ov) ov.hidden = true; }

  function onChange(e) {
    if (!e.target) return;
    if (e.target.id === 'paste-photo') {
      // камера снимает по одному кадру: сразу редактор (поворот/обрезка), потом «Ещё лист / Распознать»
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) { openEditor(f).then((blob) => { if (blob) camShots.push(blob); showCamMore(); }); }
      return;
    }
    if (e.target.id === 'paste-gallery') {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length) handleFiles(files);
      return;
    }
  }

  function onClick(e) {
    if (e.target.closest('[data-action="back-home"]')) { Router.show('home'); return; }
    if (e.target.closest('[data-action="paste-photo"]')) { root.querySelector('#paste-photo').click(); return; }
    if (e.target.closest('[data-action="paste-gallery"]')) { root.querySelector('#paste-gallery').click(); return; }
    if (e.target.closest('[data-action="cam-more"]')) { root.querySelector('#paste-photo').click(); return; }
    if (e.target.closest('[data-action="cam-done"]')) { hideCamMore(); const shots = camShots.slice(); camShots = []; if (shots.length) handleFiles(shots, true); return; }
    if (e.target.closest('[data-action="cam-cancel"]')) { hideCamMore(); camShots = []; return; }
    if (e.target.closest('[data-action="paste-submit"]')) {
      const text = root.querySelector('#paste-textarea').value.trim();
      if (!text) return;
      Router.show('scan', { rawText: text });
    }
  }

  return { mount, unmount };
})();
