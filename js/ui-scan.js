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
      const parsed = parseLine(lines[i]);
      const geo = await Geocode.lookup(parsed.address);
      points.push(buildPoint(parsed, geo));
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
    // адрес — часть с почтовым индексом (5 цифр) и буквами
    const addrIdx = rest.findIndex((p) => /\d{5}/.test(p) && /[a-zA-Zа-яё]{3,}/i.test(p));
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
