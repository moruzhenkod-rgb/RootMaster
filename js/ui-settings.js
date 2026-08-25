// Экран настроек: дубликаты, клиенты без координат, правка ячеек/фирм, самотест функций.
const UISettings = (() => {
  let root, tab = 'dupes';
  let listItems = [], dupeGroups = [], demoPoints = [];
  let editOrig = null, editCoords = null, editMap = null;

  function mount(container) {
    root = container;
    tab = 'dupes';
    root.addEventListener('click', onClick);
    render();
  }
  function unmount() {
    root.removeEventListener('click', onClick);
    if (editMap) { try { editMap.remove(); } catch (e) {} editMap = null; }
  }

  function clients() {
    try { return JSON.parse(localStorage.getItem('rm_clients') || '[]'); } catch (e) { return []; }
  }
  function esc(v) { return Utils.escapeHtml(v == null ? '' : v); }
  function normAddr(a) { return ClientMatch.normAddr(a); }

  async function refresh() {
    try {
      const data = await Api.getClients();
      localStorage.setItem('rm_clients', JSON.stringify(data.clients || []));
    } catch (e) { /* оффлайн — работаем с кешем */ }
    render();
  }

  function setTab(t) { tab = t; render(); }

  function render() {
    root.querySelectorAll('.set-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const el = root.querySelector('#set-content');
    if (!el) return;
    if (tab === 'dupes') renderDupes(el);
    else if (tab === 'nogeo') renderNoGeo(el);
    else if (tab === 'cells') renderCells(el);
    else if (tab === 'test') renderTest(el);
    else if (tab === 'demo') renderDemo(el);
  }

  // ─── Дубликаты (группировка по фирма+улица+индекс, без учёта города/звёздочек) ───
  function locKey(c) {
    const comp = normAddr(c.company);
    const addr = normAddr(c.address);
    const plz = (addr.match(/\b\d{5}\b/) || [''])[0];
    const street = addr.split(' ').find((w) => w.length >= 4 && !/^\d+$/.test(w)) || '';
    const num = (addr.match(/\b\d{1,4}[a-z]?\b/) || [''])[0];
    return comp + '|' + street + '|' + num + '|' + plz;
  }

  function renderDupes(el) {
    const cs = clients();
    const map = {};
    cs.forEach((c) => { const k = locKey(c); (map[k] = map[k] || []).push(c); });
    dupeGroups = Object.values(map).filter((g) => g.length > 1);
    if (!dupeGroups.length) {
      el.innerHTML = '<div class="empty-hint">Дубликатов не найдено 👍</div>';
      return;
    }
    el.innerHTML = `<div class="set-note">Похожие записи (одна фирма+улица). Оставь верную, лишние удали.</div>` +
      dupeGroups.map((g, gi) => `
      <div class="dupe-group">
        ${g.map((c, ci) => `
          <div class="client-card">
            <div class="client-body">
              ${c.company ? `<div class="client-firm">${esc(c.company)}</div>` : ''}
              <div class="client-addr">${esc(c.address)}</div>
              <div class="client-key">${c.lat != null ? '📍 есть коорд' : '⚠️ без коорд'}${c.cell ? ' · 🗄 ' + esc(c.cell) : ''}${c.key ? ' · 🔑 ' + esc(c.key) : ''}</div>
            </div>
            <button class="btn btn-danger btn-sm" data-action="dupe-del" data-gi="${gi}" data-ci="${ci}">🗑</button>
          </div>`).join('')}
      </div>`).join('');
  }

  // ─── Без координат ───
  function renderNoGeo(el) {
    const cs = clients();
    listItems = cs.map((c, i) => ({ c, i })).filter(({ c }) => c.lat == null || c.lng == null);
    if (!listItems.length) {
      el.innerHTML = '<div class="empty-hint">Все клиенты с координатами 👍</div>';
      return;
    }
    el.innerHTML = `<div class="set-note">Эти клиенты не встают на карту. Поставь точку вручную.</div>` +
      listItems.map(({ c }, li) => `
        <div class="client-card">
          <div class="client-body">
            ${c.company ? `<div class="client-firm">${esc(c.company)}</div>` : ''}
            <div class="client-addr">${esc(c.address)}</div>
            ${c.key || c.cell ? `<div class="client-key">${c.key ? '🔑 ' + esc(c.key) : ''}${c.cell ? ' · 🗄 ' + esc(c.cell) : ''}</div>` : ''}
          </div>
          <button class="btn btn-primary btn-sm" data-action="edit-li" data-li="${li}">📍 На карте</button>
        </div>`).join('');
  }

  // ─── Ячейки и фирмы (быстрая правка) ───
  function renderCells(el) {
    const cs = clients();
    listItems = cs.map((c, i) => ({ c, i }));
    el.innerHTML = `<div class="set-note">Правь фирму и ячейку. Некорректные фирмы — исправь тут.</div>
      <input id="set-search" class="clients-search" placeholder="🔍 Поиск по фирме или адресу" />
      <div id="set-cells-list"></div>`;
    renderCellsList();
    const s = root.querySelector('#set-search');
    if (s) s.oninput = () => renderCellsList(s.value.toLowerCase().trim());
  }

  function renderCellsList(q) {
    const wrap = root.querySelector('#set-cells-list');
    if (!wrap) return;
    const cs = clients();
    const nq = q ? normAddr(q) : '';
    const items = cs.map((c, i) => ({ c, i })).filter(({ c }) =>
      !nq || normAddr(c.company).includes(nq) || normAddr(c.address).includes(nq));
    listItems = items;
    wrap.innerHTML = items.map(({ c }, li) => `
      <div class="client-card">
        <div class="client-body">
          <div class="client-addr">${esc(c.address)}</div>
          ${c.key ? `<div class="client-key">🔑 ${esc(c.key)}</div>` : ''}
        </div>
        <button class="btn btn-secondary btn-sm" data-action="edit-li" data-li="${li}">✏️ Правка</button>
      </div>`).join('');
  }

  // ─── Модалка правки клиента ───
  function openEdit(client) {
    editOrig = client;
    editCoords = (client.lat != null && client.lng != null) ? { lat: client.lat, lng: client.lng } : null;
    const m = root.querySelector('#set-modal');
    m.style.display = 'flex';
    m.innerHTML = `
      <div class="set-modal-card">
        <h3>Клиент</h3>
        <input id="e-company" value="${esc(client.company)}" placeholder="Фирма">
        <input id="e-address" value="${esc(client.address)}" placeholder="Адрес">
        <div class="edit-row">
          <input id="e-key" value="${esc(client.key)}" placeholder="Ключ">
          <input id="e-cell" value="${esc(client.cell)}" placeholder="Ячейка">
        </div>
        <div class="edit-map-hint">📍 Тапни по карте — поставить точку${editCoords ? '' : ' (сейчас без координат)'}</div>
        <div class="edit-map" id="e-map"></div>
        <div class="edit-actions">
          <button class="btn btn-success" data-action="e-save">Сохранить</button>
          <button class="btn btn-ghost" data-action="e-cancel">Отмена</button>
        </div>
        <button class="btn btn-danger" data-action="e-del">🗑 Удалить клиента</button>
      </div>`;
    setTimeout(initEditMap, 40);
  }

  function initEditMap() {
    const elm = root.querySelector('#e-map');
    if (!elm || typeof L === 'undefined') return;
    if (editMap) { try { editMap.remove(); } catch (e) {} editMap = null; }
    const has = !!editCoords;
    const center = has ? [editCoords.lat, editCoords.lng] : [53.6355, 11.4012];
    editMap = L.map(elm, { zoomControl: true, attributionControl: false }).setView(center, has ? 15 : 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(editMap);
    let marker = has ? L.marker(center, { draggable: true }).addTo(editMap) : null;
    if (marker) marker.on('dragend', () => { const ll = marker.getLatLng(); editCoords = { lat: ll.lat, lng: ll.lng }; });
    editMap.on('click', (e) => {
      if (marker) marker.setLatLng(e.latlng);
      else { marker = L.marker(e.latlng, { draggable: true }).addTo(editMap); marker.on('dragend', () => { const ll = marker.getLatLng(); editCoords = { lat: ll.lat, lng: ll.lng }; }); }
      editCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
    });
    setTimeout(() => editMap.invalidateSize(), 80);
  }

  function closeEdit() {
    const m = root.querySelector('#set-modal');
    if (m) { m.style.display = 'none'; m.innerHTML = ''; }
    if (editMap) { try { editMap.remove(); } catch (e) {} editMap = null; }
    editOrig = null; editCoords = null;
  }

  async function saveEdit() {
    const g = (id) => { const el = root.querySelector('#' + id); return el ? el.value.trim() : ''; };
    const newCompany = g('e-company'), address = g('e-address'), key = g('e-key'), cell = g('e-cell');
    if (!address) { Utils.toast('Адрес не может быть пустым', 'error'); return; }
    try {
      const lat = editCoords ? editCoords.lat : undefined;
      const lng = editCoords ? editCoords.lng : undefined;
      await Api.updateClient(editOrig.company || '', editOrig.address || '', address, key, cell, newCompany, lat, lng);
      closeEdit();
      Utils.toast('Сохранено', 'success');
      await refresh();
    } catch (e) { Utils.toast(e.message || 'Не удалось сохранить', 'error'); }
  }

  async function delClient(company, address) {
    if (!window.confirm('Удалить клиента ' + (company || address) + '?')) return;
    try {
      await Api.deleteClient(company || '', address || '');
      closeEdit();
      Utils.toast('Удалён', 'success');
      await refresh();
    } catch (e) { Utils.toast(e.message || 'Не удалось удалить', 'error'); }
  }

  // ─── Самотест ───
  const TESTS = [
    ['Соединение с сервером', async () => { const r = await fetch('api/health'); const j = await r.json(); return j.ok ? 'ok' : 'нет ответа'; }],
    ['Авторизация', async () => { if (!Api.isAuthed()) throw new Error('нет токена'); return 'вход выполнен: ' + (Api.displayName() || '—'); }],
    ['База клиентов', async () => { const d = await Api.getClients(); return (d.clients || []).length + ' клиентов'; }],
    ['Туры (сервер)', async () => { const d = await Api.getTours(); return d ? 'доступно' : 'пусто'; }],
    ['Локальное хранилище', async () => { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return 'работает'; }],
    ['Геокодер (Nominatim)', async () => { const g = await Geocode.lookup('Bremsweg 15, 19057 Schwerin'); return (g && g.lat) ? 'отвечает' : 'нет ответа'; }],
    ['Service Worker / кеш', async () => { if (!('serviceWorker' in navigator)) throw new Error('нет'); const r = await fetch('sw.js'); const t = await r.text(); const m = t.match(/routemaster-v\d+/); return 'активен · ' + (m ? m[0] : '?'); }],
    ['Камера', async () => { if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) throw new Error('не поддерживается'); return 'доступна'; }],
    ['Распознавание (OCR)', async () => { if (typeof Tesseract === 'undefined') throw new Error('не загружен'); return 'загружен'; }],
    ['Карты (Leaflet)', async () => { if (typeof L === 'undefined') throw new Error('не загружен'); return 'загружен'; }],
    ['Геолокация', async () => { if (!navigator.geolocation) throw new Error('нет'); return 'доступна'; }],
    ['Озвучка (speechSynthesis)', async () => { if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') throw new Error('не поддерживается'); return 'доступна'; }],
    ['Радар-детектор (модуль)', async () => { if (typeof RadarModule === 'undefined') throw new Error('не загружен'); return 'загружен · пороги ' + RadarModule.THRESHOLDS.map((t) => t.dist).join('/') + 'м'; }],
    ['Экраны приложения', async () => { const need = ['home','clients','manual','paste','scan','validate','build','active','history','settings']; const miss = need.filter((n) => !document.getElementById('tpl-' + n)); if (miss.length) throw new Error('нет: ' + miss.join(',')); return need.length + ' экранов ок'; }],
  ];

  function renderTest(el) {
    el.innerHTML = `<div class="set-note">Проверка всех функций — жми «Запустить», лови баги заранее.</div>
      <button class="btn btn-primary btn-large" data-action="run-test">▶ Запустить самотест</button>
      <div id="test-results"></div>
      <div class="set-note" style="margin-top:16px">Интерактивные проверки (потыкай руками):</div>
      <button class="btn btn-secondary btn-large" data-action="test-place">📍 Тест: поставить точку на карте</button>
      <button class="btn btn-secondary btn-large" data-action="test-nav">🧭 Тест: навигация в Google Maps</button>
      <button class="btn btn-primary btn-large" data-action="demo-tour">🚚 Демо рабочего тура (адрес не найден и т.д.)</button>
      <div class="set-note" style="margin-top:16px">🚨 Радар-детектор — прослушать озвучку каждого порога:</div>
      <button class="btn btn-secondary btn-large" data-action="radar-voice-start">🔊 «Соединение установлено»</button>
      <button class="btn btn-secondary btn-large" data-action="radar-voice-1000">🔊 1000м — «Через 1000 метров камера…»</button>
      <button class="btn btn-secondary btn-large" data-action="radar-voice-500">🔊 500м — «Внимание, камера 500 метров»</button>
      <button class="btn btn-secondary btn-large" data-action="radar-voice-200">🔊 200м — «Снизьте скорость»</button>
      <button class="btn btn-primary btn-large" data-action="radar-voice-sequence">▶ Прогнать всю последовательность (1000→500→200)</button>`;
  }

  // прямая озвучка фразы для проверки голоса — без запуска геолокации/детектора целиком.
  // RadarModule.speak сам проигрывает записанный mp3, если он есть, иначе — синтетический голос
  function radarSpeak(text) {
    if (typeof RadarModule === 'undefined') {
      Utils.toast('Модуль радара не загружен', 'error');
      return;
    }
    RadarModule.speak(text);
    Utils.toast('🔊 ' + text, 'success');
  }

  async function runTest() {
    const box = root.querySelector('#test-results');
    if (!box) return;
    box.innerHTML = TESTS.map((t, i) => `<div class="test-row" id="tr-${i}"><span class="test-ic">⏳</span> ${esc(t[0])}<span class="test-detail" id="td-${i}"></span></div>`).join('');
    for (let i = 0; i < TESTS.length; i++) {
      const row = root.querySelector('#tr-' + i), det = root.querySelector('#td-' + i);
      try {
        const res = await TESTS[i][1]();
        row.querySelector('.test-ic').textContent = '✅';
        if (det) det.textContent = ' — ' + res;
      } catch (e) {
        row.querySelector('.test-ic').textContent = '❌';
        if (det) det.textContent = ' — ' + (e.message || 'ошибка');
        row.classList.add('test-fail');
      }
    }
  }

  // ─── Демо рабочего тура: воспроизводит реальные ситуации (не на карте, сел не туда) ───
  function initDemo() {
    demoPoints = [
      { id: 'd1', company: 'Landtechnik Nesow', address: 'Schnitterwiese 1, 19055 Schwerin-Medewege', key: '19055 0019', cell: '12', lat: 53.6603, lng: 11.3897, order: 1, done: false },
      { id: 'd2', company: 'GRAMKOW AUTOTEILE', address: 'Bremsweg 15, 19057 Schwerin', key: '19057 0027', cell: '', lat: 53.6280, lng: 11.3820, order: 2, done: false },
      { id: 'd3', company: 'Неизвестная фирма', address: 'Musterstraße 999, 00000 — адрес не найден', key: '', cell: '', lat: null, lng: null, order: null, done: false },
      { id: 'd4', company: 'WM SE', address: 'Kastanienallee 5, 19061 Schwerin (метка села не туда)', key: '', cell: '3', lat: 53.5700, lng: 11.4600, order: 3, done: false, wrong: true },
    ];
  }

  function demoCard(p) {
    return `
      <div class="stop-card ${p.done ? 'done' : ''} ${p.order == null ? 'off-route' : ''}">
        <div class="stop-num">${p.done ? '✓' : (p.order != null ? p.order : '⚠')}</div>
        <div class="stop-body">
          ${p.company ? `<div class="stop-company">${esc(p.company)}</div>` : ''}
          <div class="stop-addr">${esc(p.address)}</div>
          ${p.key || p.cell ? `<div class="stop-key">${p.key ? '🔑 ' + esc(p.key) : ''}${p.key && p.cell ? ' · ' : ''}${p.cell ? '🗄 ' + esc(p.cell) : ''}</div>` : ''}
          <div class="demo-actions">
            ${(p.order == null || p.wrong) ? `<button class="btn btn-primary btn-sm" data-action="demo-place" data-id="${p.id}">📍 Поставить на карте</button>` : ''}
            <button class="btn btn-secondary btn-sm" data-action="demo-nav" data-id="${p.id}">🧭 Навигация</button>
            ${p.done ? `<button class="btn btn-ghost btn-sm" data-action="demo-undo" data-id="${p.id}">↺ Вернуть</button>` : `<button class="btn btn-secondary btn-sm" data-action="demo-done" data-id="${p.id}">✓ Готово</button>`}
          </div>
        </div>
      </div>`;
  }

  function renderDemo(el) {
    const active = demoPoints.filter((p) => !p.done);
    const off = active.filter((p) => p.order == null);
    const on = active.filter((p) => p.order != null).sort((a, b) => a.order - b.order);
    const done = demoPoints.filter((p) => p.done);
    let html = `<button class="btn btn-ghost btn-sm" data-action="demo-back">← Назад к тесту</button>
      <div class="set-note">Так тур выглядит в бою. Данные ненастоящие — потренируйся чинить проблемные посылки.</div>`;
    if (off.length) {
      html += `<div class="off-route-banner">⚠️ Не на карте (${off.length}) — адрес не удалось разместить (дом не найден или совпал с другим). Поставь точку вручную.</div>`;
      html += off.map(demoCard).join('');
    }
    html += on.map(demoCard).join('');
    if (done.length) html += `<div class="set-note" style="margin-top:12px">✓ Готово: ${done.length}</div>` + done.map(demoCard).join('');
    el.innerHTML = html;
  }

  function demoFind(id) { return demoPoints.find((p) => p.id === id); }

  function demoPlace(id) {
    const p = demoFind(id); if (!p) return;
    PlacePicker.open({
      title: '📍 Демо: где посылка?',
      subtitle: (p.company ? p.company + ' · ' : '') + p.address,
      coords: (p.lat != null) ? { lat: p.lat, lng: p.lng } : null,
      onSave: (c) => {
        p.lat = c.lat; p.lng = c.lng; p.wrong = false;
        if (p.order == null) {
          const o = demoPoints.filter((x) => x.order != null).map((x) => x.order);
          p.order = (o.length ? Math.max.apply(null, o) : 0) + 1;
        }
        Utils.toast('Точка поставлена ✓ (демо) — список продвинулся', 'success');
        render();
      },
    });
  }

  function demoNav(id) {
    const p = demoFind(id); if (!p) return;
    const dest = (p.lat != null && !p.wrong) ? `${p.lat},${p.lng}` : encodeURIComponent(p.address.replace(/ —.*$| \(.*$/, ''));
    const a = document.createElement('a');
    a.href = 'https://www.google.com/maps/dir/?api=1&destination=' + dest + '&travelmode=driving';
    a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function onClick(e) {
    if (e.target.closest('[data-action="back-home"]')) { Router.show('home'); return; }
    const tabBtn = e.target.closest('.set-tab');
    if (tabBtn) { setTab(tabBtn.dataset.tab); return; }

    const dupeDel = e.target.closest('[data-action="dupe-del"]');
    if (dupeDel) {
      const g = dupeGroups[+dupeDel.dataset.gi]; if (!g) return;
      const c = g[+dupeDel.dataset.ci]; if (!c) return;
      delClient(c.company, c.address); return;
    }
    const editLi = e.target.closest('[data-action="edit-li"]');
    if (editLi) { const it = listItems[+editLi.dataset.li]; if (it) openEdit(it.c); return; }

    if (e.target.closest('[data-action="e-save"]')) { saveEdit(); return; }
    if (e.target.closest('[data-action="e-cancel"]')) { closeEdit(); return; }
    if (e.target.closest('[data-action="e-del"]')) { if (editOrig) delClient(editOrig.company, editOrig.address); return; }
    if (e.target.closest('[data-action="run-test"]')) { runTest(); return; }
    if (e.target.closest('[data-action="test-place"]')) {
      PlacePicker.open({
        title: '📍 Тест постановки точки',
        subtitle: 'Тапни по карте и сохрани — проверка режима',
        coords: null,
        onSave: (c) => Utils.toast('✓ Работает: ' + c.lat.toFixed(5) + ', ' + c.lng.toFixed(5), 'success'),
      });
      return;
    }
    if (e.target.closest('[data-action="test-nav"]')) {
      const url = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('Schnitterwiese 1, 19055 Schwerin') + '&travelmode=driving';
      const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    if (e.target.closest('[data-action="radar-voice-start"]')) { radarSpeak('Соединение установлено'); return; }
    if (e.target.closest('[data-action="radar-voice-1000"]')) {
      const text = typeof RadarModule !== 'undefined' ? RadarModule.THRESHOLDS[0].text('camera') : 'Через 1000 метров камера контроля скорости';
      radarSpeak(text);
      return;
    }
    if (e.target.closest('[data-action="radar-voice-500"]')) {
      const text = typeof RadarModule !== 'undefined' ? RadarModule.THRESHOLDS[1].text('camera') : 'Внимание, камера контроля скорости 500 метров';
      radarSpeak(text);
      return;
    }
    if (e.target.closest('[data-action="radar-voice-200"]')) {
      const text = typeof RadarModule !== 'undefined' ? RadarModule.THRESHOLDS[2].text('camera') : 'камера контроля скорости, 200 метров, снизьте скорость';
      radarSpeak(text);
      return;
    }
    if (e.target.closest('[data-action="radar-voice-sequence"]')) {
      const steps = typeof RadarModule !== 'undefined'
        ? [RadarModule.THRESHOLDS[0].text('camera'), RadarModule.THRESHOLDS[1].text('camera'), RadarModule.THRESHOLDS[2].text('camera')]
        : ['Через 1000 метров камера контроля скорости', 'Внимание, камера контроля скорости 500 метров', 'камера контроля скорости, 200 метров, снизьте скорость'];
      steps.forEach((text, i) => setTimeout(() => radarSpeak(text), i * 2500));
      return;
    }
    if (e.target.closest('[data-action="demo-tour"]')) { initDemo(); tab = 'demo'; render(); return; }
    if (e.target.closest('[data-action="demo-back"]')) { tab = 'test'; render(); return; }
    const dp = e.target.closest('[data-action="demo-place"]');
    if (dp) { demoPlace(dp.dataset.id); return; }
    const dn = e.target.closest('[data-action="demo-nav"]');
    if (dn) { demoNav(dn.dataset.id); return; }
    const dd = e.target.closest('[data-action="demo-done"]');
    if (dd) { const p = demoFind(dd.dataset.id); if (p) { p.done = true; render(); } return; }
    const du = e.target.closest('[data-action="demo-undo"]');
    if (du) { const p = demoFind(du.dataset.id); if (p) { p.done = false; render(); } return; }
  }

  return { mount, unmount };
})();
