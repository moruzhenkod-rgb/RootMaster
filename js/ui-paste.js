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

  async function handleFile(file) {
    if (!file) return;
    setStatus('📸 Загружаю фото…');
    let job;
    try {
      const blob = await downscale(file);
      const res = await fetch('/api/parse-list', { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
      const j = await res.json();
      job = j.job;
      if (!job) { setStatus('Ошибка загрузки: ' + (j.error || res.status)); return; }
    } catch (e) { setStatus('Не удалось загрузить фото (сеть)'); return; }
    // опрос результата короткими запросами (переживает мобильную сеть/блокировку экрана)
    for (let i = 0; i < 90; i++) {
      setStatus('🔍 Распознаю через Claude… ' + (i * 4) + 'с (не закрывай экран)');
      await sleep(4000);
      try {
        const r = await fetch('/api/parse-list-result?job=' + encodeURIComponent(job));
        const jr = await r.json();
        if (jr.status === 'done') {
          const lines = jr.lines || [];
          if (!lines.length) { setStatus('Строк не найдено — сфоткай ровнее/светлее'); return; }
          const ta = root.querySelector('#paste-textarea');
          ta.value = (ta.value ? ta.value.trim() + '\n' : '') + lines.join('\n');
          document.getElementById('btn-paste-submit').disabled = !ta.value.trim();
          setStatus('✓ Распознано строк: ' + lines.length + ' — проверь и жми «Проверить»');
          return;
        }
        if (jr.status === 'error') { setStatus('Ошибка распознавания: ' + (jr.error || '')); return; }
      } catch (e) { /* сеть моргнула — продолжаем опрос */ }
    }
    setStatus('Слишком долго — попробуй ещё раз с более чётким фото');
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
