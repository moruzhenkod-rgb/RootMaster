const UIScan = (() => {
  let root, cancelled;

  function mount(container, params) {
    root = container;
    cancelled = false;
    root.addEventListener('click', onClick);
    run(params.file).catch((e) => {
      console.error(e);
      if (!cancelled) {
        Utils.toast('Ошибка сканирования', 'error');
        Router.show('home');
      }
    });
  }

  function unmount() {
    root.removeEventListener('click', onClick);
  }

  function onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'cancel-scan') {
      cancelled = true;
      Router.show('home');
    }
  }

  function setProgress(text, fraction) {
    const t = document.getElementById('scan-progress');
    const f = document.getElementById('scan-progress-fill');
    if (t) t.textContent = text;
    if (f && fraction != null) f.style.width = Math.round(fraction * 100) + '%';
  }

  async function run(file) {
    setProgress('Распознавание текста…', 0.05);
    const rawText = await OCR.recognize(file, (progress) => {
      if (cancelled) return;
      setProgress('Распознавание текста… ' + Math.round(progress * 100) + '%', progress * 0.4);
    });
    if (cancelled) return;

    const lines = OCR.extractAddressLines(rawText);
    if (!lines.length) {
      Utils.toast('Не удалось найти адреса на фото', 'error');
      Router.show('home');
      return;
    }

    const points = [];
    for (let i = 0; i < lines.length; i++) {
      if (cancelled) return;
      setProgress(`Проверено ${i} из ${lines.length} адресов`, 0.4 + 0.6 * (i / lines.length));
      const line = lines[i];
      const geo = await Geocode.lookup(line);
      points.push(buildPoint(line, geo));
    }
    if (cancelled) return;

    setProgress(`Проверено ${lines.length} из ${lines.length} адресов`, 1);
    await Utils.sleep(200);

    const tour = { points, stage: 'validate' };
    const needsValidation = points.some((p) => p.geoStatus !== 'ok');
    App.setTour(tour, needsValidation ? 'validate' : 'build');
    Router.show(needsValidation ? 'validate' : 'build');
  }

  function buildPoint(rawLine, geo) {
    let geoStatus = 'error';
    if (geo) {
      geoStatus = geo.confidence === 'low' ? 'warn' : 'ok';
    }
    return {
      id: Utils.uid(),
      rawText: rawLine,
      editedText: rawLine,
      lat: geo ? geo.lat : null,
      lng: geo ? geo.lng : null,
      geoStatus,
      order: null,
      tourStatus: 'pending',
    };
  }

  return { mount, unmount };
})();
