const UIScan = (() => {
  let root, cancelled;

  function mount(container, params) {
    root = container;
    cancelled = false;
    root.addEventListener('click', onClick);
    run(params).catch((e) => {
      console.error(e);
      if (!cancelled) {
        Utils.toast('Ошибка проверки адресов', 'error');
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

  async function run(params) {
    // дубли одного адреса считаем за одну точку (нормализуем регистр и пробелы)
    const seen = new Set();
    const lines = (params.rawText || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => {
        const key = l.toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    if (!lines.length) {
      Utils.toast('Список адресов пуст', 'error');
      Router.show('home');
      return;
    }

    const points = [];
    for (let i = 0; i < lines.length; i++) {
      if (cancelled) return;
      setProgress(`Проверено ${i} из ${lines.length} адресов`, i / lines.length);
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
