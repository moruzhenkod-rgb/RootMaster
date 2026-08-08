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

    const clients = ClientMatch.loadClients();
    const points = [];
    for (let i = 0; i < lines.length; i++) {
      if (cancelled) return;
      setProgress(`Проверено ${i} из ${lines.length} адресов`, i / lines.length);
      const parsed = parseLine(lines[i]);
      const known = ClientMatch.matchClient(parsed.address, clients);
      let geo;
      if (known) {
        // адрес узнан по базе клиентов — подставляем сохранённые данные
        parsed.address = known.address;
        if (!parsed.company && known.company) parsed.company = known.company;
        if (!parsed.key && known.key) parsed.key = known.key;
        geo = (known.lat != null && known.lng != null)
          ? { lat: known.lat, lng: known.lng, displayName: known.address, matchedHouse: true, confidence: 'high' }
          : await Geocode.lookup(parsed.address);
      } else {
        geo = await Geocode.lookup(parsed.address);
      }
      const pt = buildPoint(parsed, geo);
      if (known && known.manual) pt.manualCoords = true; // закреплённая позиция клиента
      if (known && known.cell) pt.cell = known.cell; // ячейка, где лежит ключ
      points.push(pt);
    }
    if (cancelled) return;

    setProgress(`Проверено ${lines.length} из ${lines.length} адресов`, 1);
    await Utils.sleep(200);

    const tour = { points, stage: 'validate' };
    const needsValidation = points.some((p) => p.geoStatus !== 'ok');
    App.setTour(tour, needsValidation ? 'validate' : 'build');
    Router.show(needsValidation ? 'validate' : 'build');
  }

  // Формат (части через « — »), порядок полей свободный, распознаём по меткам:
  //   Фирма — Адрес — Ключ: X — Посылок: N — Вес: Y
  // Поддерживается и короткий вид: «Адрес — Ключ».
  function parseLine(line) {
    const parts = line.split('—').map((s) => s.trim()).filter(Boolean);
    const res = { company: '', address: '', key: '', parcels: '', weight: '' };
    const rest = [];
    parts.forEach((part) => {
      if (/^(ключ|key)[\s:]/i.test(part)) {
        res.key = part.replace(/^(ключ|key)\s*:?\s*/i, '').trim();
      } else if (/^(посыл|пакет|packages?|parcels?)/i.test(part)) {
        res.parcels = (part.match(/\d+/) || [''])[0];
      } else if (/^(вес|weight|gewicht)/i.test(part)) {
        res.weight = part.replace(/^(вес|weight|gewicht)\s*:?\s*/i, '').trim();
      } else {
        rest.push(part);
      }
    });
    // адрес — часть с немецким индексом (РОВНО 5 цифр как отдельное слово) и буквами.
    // \b\d{5}\b важно: у фирмы вроде «WM SE KST 511300» число из 6 цифр не считается индексом
    const streetRe = /(str\.|stra(ss|ß)e|\bstr\b|weg|ring|allee|platz|chaussee|ufer|damm|hauptstr)/i;
    let addrIdx = rest.findIndex((p) => /\b\d{5}\b/.test(p) && /[a-zA-Zа-яё]{3,}/i.test(p));
    // если индекса нет (адрес без PLZ) — определяем по уличным признакам: номер дома + улица или запятая с городом
    if (addrIdx < 0) addrIdx = rest.findIndex((p) => /\d/.test(p) && (streetRe.test(p) || /,/.test(p)));
    if (addrIdx >= 0) res.address = rest.splice(addrIdx, 1)[0];
    // ключ без метки (короткий формат): часть только из цифр/пробелов/дефисов
    if (!res.key) {
      const keyIdx = rest.findIndex((p) => /^[\d\s-]+$/.test(p));
      if (keyIdx >= 0) res.key = rest.splice(keyIdx, 1)[0].trim();
    }
    // если адрес не определился — первая оставшаяся часть
    if (!res.address && rest.length) res.address = rest.shift();
    // остаток — название фирмы
    if (rest.length) res.company = rest.join(', ');
    // ключ ВСЕГДА с кодом города: если в ключе нет индекса — подставляем PLZ из адреса
    const plz = (res.address.match(/\b(\d{5})\b/) || [])[1];
    if (plz && res.key && !/^\d{5}/.test(res.key)) {
      res.key = plz + ' ' + res.key;
    }
    return res;
  }

  function buildPoint(parsed, geo) {
    let geoStatus = 'error';
    if (geo) {
      geoStatus = geo.confidence === 'low' ? 'warn' : 'ok';
    }
    return {
      id: Utils.uid(),
      rawText: parsed.address,
      editedText: parsed.address,
      company: parsed.company || '',
      key: parsed.key || '',
      parcels: parsed.parcels || '',
      weight: parsed.weight || '',
      lat: geo ? geo.lat : null,
      lng: geo ? geo.lng : null,
      foundAddress: geo ? geo.displayName : null,
      matchedHouse: geo ? !!geo.matchedHouse : false,
      geoStatus,
      order: null,
      tourStatus: 'pending',
    };
  }

  return { mount, unmount };
})();
