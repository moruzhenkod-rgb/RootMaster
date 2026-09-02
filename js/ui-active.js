const UIActive = (() => {
  let root, map, markers = {}, meMarker, currentView = 'list', activePointId = null, searchQuery = '', presenceTimer = null;
  let apResults = [];
  let editPointId = null, editCoords = null, editManual = false;

  function mount(container) {
    root = container;
    currentView = 'list';
    searchQuery = '';
    root.addEventListener('click', onHeaderClick);
    root.addEventListener('input', onSearchInput);
    initMap();
    renderMarkers();
    renderList();
    updateEndButton();
    locateMe();
    startPresence();

    document.getElementById('bottom-sheet-overlay').addEventListener('click', onSheetOverlayClick);
    document.getElementById('context-menu-overlay').addEventListener('click', onContextOverlayClick);
  }

  function unmount() {
    if (root) root.removeEventListener('input', onSearchInput);
    root.removeEventListener('click', onHeaderClick);
    document.getElementById('bottom-sheet-overlay').removeEventListener('click', onSheetOverlayClick);
    document.getElementById('context-menu-overlay').removeEventListener('click', onContextOverlayClick);
    closeSheet();
    closeContext();
    if (typeof PlacePicker !== 'undefined') PlacePicker.close();
    const apov = document.getElementById('addp-overlay');
    if (apov) apov.remove();
    const epov = document.getElementById('editp-overlay');
    if (epov) epov.remove();
    stopPresence();
    if (map) { map.remove(); map = null; }
    markers = {};
  }

  // курьер шлёт локацию на сервер (для админ-мониторинга) пока открыт активный тур
  function startPresence() {
    stopPresence();
    const tick = () => {
      if (!navigator.geolocation || typeof Api === 'undefined' || !Api.isAuthed()) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => { Api.sendPresence(pos.coords.latitude, pos.coords.longitude).catch(() => {}); },
        () => {}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
      );
    };
    tick();
    presenceTimer = setInterval(tick, 40000);
  }
  function stopPresence() { if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; } }

  function activePoints() {
    return App.tour.points.filter((p) => p.tourStatus !== 'skip' && p.tourStatus !== 'transferred');
  }

  function sortedPoints() {
    return [...App.tour.points].sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  function initMap() {
    const pts = activePoints();
    const first = pts[0] || App.tour.points[0];
    const center = first ? [first.lat, first.lng] : [55.751244, 37.618423];
    map = L.map('active-map', { zoomControl: true, attributionControl: false }).setView(center, 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  }

  function locateMe() {
    if (!navigator.geolocation) return;
    let centered = false;
    navigator.geolocation.watchPosition(
      (pos) => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        const icon = L.divIcon({ className: '', html: '<div class="marker-me"></div>', iconSize: [20, 20] });
        if (meMarker) map.removeLayer(meMarker);
        meMarker = L.marker(ll, { icon, zIndexOffset: 1000 }).addTo(map);
        if (!centered) { centered = true; if (map) map.setView(ll, 14); }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  }

  function markerIcon(point) {
    const cls = ['marker-dot'];
    if (point.tourStatus === 'done') cls.push('done');
    else if (point.tourStatus === 'skip' || point.tourStatus === 'transferred') cls.push('skip');
    else cls.push('numbered');
    const label = point.tourStatus === 'done' ? '✓' : (point.order != null ? point.order : '?');
    return L.divIcon({ className: '', html: `<div class="${cls.join(' ')}">${label}</div>`, iconSize: [34, 34] });
  }

  function renderMarkers() {
    App.tour.points.forEach((p) => {
      if (p.lat == null || p.lng == null) return;
      if (p.tourStatus === 'skip' || p.tourStatus === 'transferred' || p.tourStatus === 'done') {
        if (markers[p.id]) { map.removeLayer(markers[p.id]); delete markers[p.id]; }
        return;
      }
      let m = markers[p.id];
      if (!m) {
        m = L.marker([p.lat, p.lng], { icon: markerIcon(p), draggable: false }).addTo(map);
        // в загруженном маршруте точки НЕ двигаем — перемещение только на этапе сборки
        m.on('add', () => {
          const domEl = m.getElement();
          if (domEl) {
            Utils.bindLongPress(domEl, () => openContextMenu(p.id), () => openSheet(p.id));
          }
        });
        markers[p.id] = m;
      } else {
        m.setLatLng([p.lat, p.lng]);
        m.setIcon(markerIcon(p));
      }
    });
  }

  function statusText(p) {
    if (p.tourStatus === 'done') return 'Выполнено';
    if (p.tourStatus === 'skip') return 'Не еду';
    if (p.tourStatus === 'transferred') return 'Передано другому';
    return 'В пути';
  }

  // тот же клиент/адрес уже есть в туре (другая точка)?
  function isDuplicate(p) {
    const na = (typeof ClientMatch !== 'undefined') ? ClientMatch.normAddr(p.editedText) : String(p.editedText || '').toLowerCase();
    if (!na) return false;
    return App.tour.points.some((o) => {
      if (o.id === p.id) return false;
      const no = (typeof ClientMatch !== 'undefined') ? ClientMatch.normAddr(o.editedText) : String(o.editedText || '').toLowerCase();
      return no === na;
    });
  }

  // почему точка не на маршруте — понятная причина для курьера
  function offReason(p) {
    if (p.order != null) return null; // уже в маршруте
    // главное, о чём просил Дима: этот клиент уже есть в туре — это норм, не ошибка
    if (isDuplicate(p)) return { cls: 'reason-dup', text: '🔁 Уже в списке — этот клиент есть в туре (дубликат)' };
    const plz = (String(p.editedText || '').match(/\b\d{5}\b/g) || []).length;
    if (p.lat == null || p.lng == null) {
      if (plz >= 2) return { cls: 'reason-paired', text: '🔗 Спаренный: несколько адресов в одной строке — раздели вручную' };
      return { cls: 'reason-notfound', text: '❌ Не найден на карте — проверь адрес или поставь точку' };
    }
    return { cls: 'reason-ok', text: '📍 Есть координаты — добавь в маршрут' };
  }

  function stopCardHtml(p) {
    return `
      <div class="stop-card ${p.tourStatus === 'done' ? 'done' : ''} ${p.order == null ? 'off-route' : ''} ${p.timeCritical ? 'critical' : ''}" data-id="${p.id}">
        <div class="stop-num">${p.order != null ? p.order : '⚠'}</div>
        <div class="stop-body">
          ${(() => { const r = offReason(p); return r ? `<div class="stop-reason ${r.cls}">${r.text}</div>` : ''; })()}
          ${p.company ? `<div class="stop-company">${Utils.escapeHtml(p.company)}</div>` : ''}
          ${p.deadline ? `<div class="stop-deadline">⏰ Закрыть до ${Utils.escapeHtml(p.deadline)}</div>` : ''}
          <div class="stop-addr">${Utils.escapeHtml(p.editedText)}</div>
          ${p.key || p.cell ? `<div class="stop-key">${p.key ? `🔑 ${Utils.escapeHtml(p.key)}` : ''}${p.key && p.cell ? ' · ' : ''}${p.cell ? `🗄 ${Utils.escapeHtml(p.cell)}` : ''}</div>` : ''}
          ${p.parcels || p.weight ? `<div class="stop-meta">${p.parcels ? `📦 ${Utils.escapeHtml(p.parcels)} шт` : ''}${p.parcels && p.weight ? ' · ' : ''}${p.weight ? `⚖ ${Utils.escapeHtml(p.weight)}` : ''}</div>` : ''}
          <div class="stop-status">${statusText(p)}</div>
        </div>
        <div class="stop-check" data-action="quick-done">${p.tourStatus === 'done' ? '✓' : ''}</div>
      </div>`;
  }

  function bindCards(container) {
    if (!container) return;
    container.querySelectorAll('.stop-card').forEach((card) => {
      const id = card.dataset.id;
      Utils.bindLongPress(card, () => openContextMenu(id), (e) => {
        if (e.target.closest('[data-action="quick-done"]')) {
          toggleDone(id);
        } else {
          openSheet(id);
        }
      });
    });
  }

  function onSearchInput(e) {
    if (e.target && e.target.id === 'active-search') { searchQuery = e.target.value.toLowerCase().trim(); renderList(); }
  }
  // совпадение точки с запросом: индекс/улица/фирма/ключ/ячейка
  function matchQ(p) {
    if (!searchQuery) return true;
    const hay = ((p.editedText || '') + ' ' + (p.company || '') + ' ' + (p.key || '') + ' ' + (p.cell || '')).toLowerCase();
    return hay.indexOf(searchQuery) !== -1;
  }

  function renderList() {
    const list = document.getElementById('active-list');
    const doneList = document.getElementById('active-done');
    const cancelledList = document.getElementById('active-cancelled');
    const all = sortedPoints();
    const cancelled = all.filter((p) => p.tourStatus === 'skip' || p.tourStatus === 'transferred');
    const pts = all.filter((p) => p.tourStatus !== 'skip' && p.tourStatus !== 'transferred');
    const pending = pts.filter((p) => p.tourStatus !== 'done');
    const done = pts.filter((p) => p.tourStatus === 'done');
    const offRoute = pending.filter((p) => p.order == null).filter(matchQ);
    const onRoute = pending.filter((p) => p.order != null).filter(matchQ);

    // активные (невыполненные) точки
    let html = '';
    if (offRoute.length) {
      html += `<div class="off-route-banner">⚠️ Не на карте (${offRoute.length}) — адрес не удалось разместить на карте (дом не найден или совпал с другим). Обработайте вручную: навигация, отметка, пропуск.</div>`;
      html += offRoute.map(stopCardHtml).join('');
    }
    html += onRoute.map(stopCardHtml).join('');
    if (!offRoute.length && !onRoute.length) html = searchQuery ? '<div class="empty-hint">По запросу ничего не найдено</div>' : '<div class="empty-hint">Все точки выполнены 🎉</div>';
    list.innerHTML = html;
    bindCards(list);

    // завершённые — отдельная вкладка
    if (doneList) {
      const doneSorted = done.slice().filter(matchQ).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
      doneList.innerHTML = doneSorted.length
        ? doneSorted.map(stopCardHtml).join('')
        : '<div class="empty-hint">Пока нет завершённых точек</div>';
      bindCards(doneList);
    }

    // счётчик на вкладке «Завершённые»
    if (cancelledList) {
      const cancFiltered = cancelled.filter(matchQ);
      cancelledList.innerHTML = cancFiltered.length
        ? cancFiltered.map(stopCardHtml).join('')
        : '<div class="empty-hint">Нет отменённых точек</div>';
      bindCards(cancelledList);
    }

    const doneTab = document.querySelector('.screen-active .switch-btn[data-view="done"]');
    if (doneTab) doneTab.textContent = done.length ? `✓ Готово (${done.length})` : '✓ Готово';
    const cancTab = document.querySelector('.screen-active .switch-btn[data-view="cancelled"]');
    if (cancTab) cancTab.textContent = cancelled.length ? `✕ Отменённые (${cancelled.length})` : '✕ Отменённые';

    updateCounter();
    updateEndButton();
  }

  function updateCounter() {
    const total = App.tour.points.filter((p) => p.tourStatus !== 'transferred').length;
    const done = App.tour.points.filter((p) => p.tourStatus === 'done').length;
    document.getElementById('active-counter').textContent = `${done}/${total}`;
  }

  function allChecked() {
    const pts = activePoints();
    return pts.length > 0 && pts.every((p) => p.tourStatus === 'done');
  }

  function updateEndButton() {
    const btn = document.getElementById('btn-end-tour');
    if (!btn) return;
    if (allChecked()) {
      btn.textContent = 'Завершить тур';
      btn.classList.remove('btn-danger');
      btn.classList.add('btn-primary');
    } else {
      btn.textContent = 'Отменить тур';
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-danger');
    }
  }

  function endTour() {
    const finishing = allChecked();
    const msg = finishing
      ? 'Завершить тур? Список маршрута будет очищен.'
      : 'Отменить тур? Не все точки отмечены выполненными. Список маршрута будет очищен.';
    if (!window.confirm(msg)) return;
    Storage.archiveTour(App.tour);
    Storage.clearCurrent();
    App.tour = null;
    Router.show('home');
    Utils.toast(finishing ? 'Тур завершён' : 'Тур отменён');
  }

  let doneSeq = 0;
  function toggleDone(id) {
    const p = App.tour.points.find((pt) => pt.id === id);
    if (!p) return;
    if (p.tourStatus === 'done') { p.tourStatus = 'pending'; delete p.doneAt; }
    else { p.tourStatus = 'done'; p.doneAt = Date.now(); }
    App.saveTour();
    renderMarkers();
    renderList();
  }

  function openSheet(id) {
    activePointId = id;
    const p = App.tour.points.find((pt) => pt.id === id);
    if (!p) return;
    const done = p.tourStatus === 'done';
    // адрес для карты: координаты, если позиция закреплена вручную, иначе текст адреса
    const q = (p.manualCoords && p.lat != null && p.lng != null) ? `${p.lat},${p.lng}` : p.editedText;
    const mapUrl = `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=17&t=k&output=embed`;
    const content = document.getElementById('sheet-content');
    content.innerHTML = `
      <button class="sheet-close" data-action="close-sheet">✕ Закрыть</button>
      <div class="sheet-map-wrap">
        <iframe class="sheet-gmap" src="${mapUrl}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
        <div class="sheet-map-overlay" data-action="open-gmap">🧭 Открыть в Google Maps</div>
      </div>
      <div class="sheet-info">
        ${p.company ? `<div class="sheet-company">${Utils.escapeHtml(p.company)}</div>` : ''}
        <div class="sheet-address">${Utils.escapeHtml(p.editedText)}</div>
        ${p.key || p.cell ? `<div class="sheet-key">${p.key ? `🔑 ${Utils.escapeHtml(p.key)}` : ''}${p.key && p.cell ? '  ·  ' : ''}${p.cell ? `🗄 Ящик ${Utils.escapeHtml(p.cell)}` : ''}</div>` : ''}
        ${p.parcels || p.weight ? `<div class="sheet-meta">${p.parcels ? `📦 ${Utils.escapeHtml(p.parcels)}` : ''}${p.parcels && p.weight ? ' · ' : ''}${p.weight ? `⚖ ${Utils.escapeHtml(p.weight)}` : ''}</div>` : ''}
      </div>
      <button class="btn btn-primary btn-large sheet-route" data-action="navigate">🧭 Маршрут</button>
      <div class="sheet-grid">
        <button class="sheet-sq" data-action="edit-point"><span>✏️</span><small>Изменить</small></button>
        <button class="sheet-sq" data-action="place-on-map"><span>📍</span><small>Точка</small></button>
        <button class="sheet-sq ${done ? '' : 'ok'}" data-action="toggle-done"><span>${done ? '↺' : '✓'}</span><small>${done ? 'Вернуть' : 'Готово'}</small></button>
        <button class="sheet-sq" data-action="open-context"><span>⋯</span><small>Статус</small></button>
      </div>
    `;
    content.querySelector('[data-action="navigate"]').addEventListener('click', () => navigateTo(p));
    const placeBtn = content.querySelector('[data-action="place-on-map"]');
    if (placeBtn) placeBtn.addEventListener('click', () => openPlace(id));
    const editBtn = content.querySelector('[data-action="edit-point"]');
    if (editBtn) editBtn.addEventListener('click', () => openEditPoint(id));
    const ov = content.querySelector('[data-action="open-gmap"]');
    if (ov) ov.addEventListener('click', () => navigateTo(p));
    const cl = content.querySelector('[data-action="close-sheet"]');
    if (cl) cl.addEventListener('click', () => closeSheet());
    content.querySelector('[data-action="toggle-done"]').addEventListener('click', () => { toggleDone(id); closeSheet(); });
    content.querySelector('[data-action="open-context"]').addEventListener('click', () => { closeSheet(); openContextMenu(id); });

    document.getElementById('bottom-sheet-overlay').classList.remove('hidden');
    document.getElementById('bottom-sheet').classList.add('tall');
  }

  function navigateTo(p) {
    // по координатам ведём ТОЛЬКО если точку переставили вручную;
    // иначе — по тексту адреса (чётче, чем метка геокодера)
    const dest = (p.manualCoords && p.lat != null && p.lng != null)
      ? `${p.lat},${p.lng}`
      : encodeURIComponent(p.editedText);
    const url =
      `https://www.google.com/maps/dir/?api=1&destination=${dest}` +
      `&travelmode=driving`;
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function closeSheet() {
    document.getElementById('bottom-sheet-overlay').classList.add('hidden');
    const bs = document.getElementById('bottom-sheet');
    if (bs) bs.classList.remove('tall');
  }

  function onSheetOverlayClick(e) {
    if (e.target.id === 'bottom-sheet-overlay') closeSheet();
  }

  function openContextMenu(id) {
    activePointId = id;
    document.getElementById('context-menu-overlay').classList.remove('hidden');
  }

  function closeContext() {
    document.getElementById('context-menu-overlay').classList.add('hidden');
  }

  function onContextOverlayClick(e) {
    if (e.target.id === 'context-menu-overlay') { closeContext(); return; }
    const btn = e.target.closest('[data-status]');
    if (!btn) return;
    const status = btn.dataset.status;
    const p = App.tour.points.find((pt) => pt.id === activePointId);
    if (p && status !== 'cancel') {
      p.tourStatus = status === 'skip' ? 'skip' : 'transferred';
      App.saveTour();
      renderMarkers();
      renderList();
      Utils.toast(status === 'skip' ? 'Точка исключена: не еду' : 'Точка передана другому');
    }
    closeContext();
  }

  function onHeaderClick(e) {
    if (e.target.closest('[data-action="add-parcel"]')) { openAddParcel(); return; }
    const backBtn = e.target.closest('[data-action="back-build"]');
    if (backBtn) { Router.show('home'); return; }

    const endBtn = e.target.closest('[data-action="end-tour"]');
    if (endBtn) { endTour(); return; }

    const switchBtn = e.target.closest('[data-action="switch-view"]');
    if (switchBtn) {
      currentView = switchBtn.dataset.view;
      root.querySelectorAll('.switch-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === currentView));
      document.getElementById('active-map').classList.toggle('hidden', currentView !== 'map');
      document.getElementById('active-list').classList.toggle('hidden', currentView !== 'list');
      const srch = document.getElementById('active-search'); if (srch) srch.classList.toggle('hidden', currentView === 'map');
      const doneEl = document.getElementById('active-done');
      if (doneEl) doneEl.classList.toggle('hidden', currentView !== 'done');
      const cancEl = document.getElementById('active-cancelled');
      if (cancEl) cancEl.classList.toggle('hidden', currentView !== 'cancelled');
      if (currentView === 'map' && map) setTimeout(() => map.invalidateSize(), 50);
    }
  }

  // ─── Ручная постановка точки посылки (через общий PlacePicker) ───
  function openPlace(id) {
    const p = App.tour.points.find((pt) => pt.id === id);
    if (!p) return;
    closeSheet();
    const me = meMarker ? meMarker.getLatLng() : null;
    PlacePicker.open({
      title: '📍 Где находится посылка?',
      subtitle: (p.company ? p.company + ' · ' : '') + p.editedText,
      coords: (p.lat != null && p.lng != null) ? { lat: p.lat, lng: p.lng } : null,
      me: me ? [me.lat, me.lng] : null,
      onSave: (c) => {
        p.lat = c.lat; p.lng = c.lng; p.manualCoords = true; p.geoStatus = 'ok';
        if (p.order == null) {
          const orders = App.tour.points.filter((x) => x.order != null).map((x) => x.order);
          p.order = (orders.length ? Math.max.apply(null, orders) : 0) + 1;
        }
        App.saveTour();
        renderMarkers();
        renderList();
        Utils.toast('Точка поставлена ✓ и запомнена', 'success');
      },
    });
  }

  // ─── Добавить посылку прямо в активный тур (сохранённый тур не сбрасывается) ───
  function openAddParcel() {
    let ov = document.getElementById('addp-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'addp-overlay';
      ov.className = 'addp-overlay';
      ov.innerHTML = `
        <div class="addp-card">
          <h3>➕ Добавить посылку в тур</h3>
          <button class="btn btn-secondary" style="width:100%;margin-bottom:10px" data-action="ap-scan">📷 Сканировать этикетку</button>
          <input id="ap-search" placeholder="🔍 Поиск в базе клиентов">
          <div id="ap-results" class="ap-results"></div>
          <input id="ap-company" placeholder="Фирма (необязательно)">
          <input id="ap-address" placeholder="Адрес: улица дом, индекс город">
          <div class="edit-row">
            <input id="ap-key" placeholder="Ключ">
            <input id="ap-cell" placeholder="Ячейка">
          </div>
          <input id="ap-pos" inputmode="numeric" placeholder="№ остановки (пусто = в конец)">
          <div class="addp-hint">Скан / поиск в базе / ввод вручную. Не встанет на карту — уйдёт в «Не на карте», поставишь точку.</div>
          <div class="addp-actions">
            <button class="btn btn-ghost" data-action="ap-cancel">Отмена</button>
            <button class="btn btn-primary" id="ap-save-btn" data-action="ap-save">Добавить</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', onAddParcelClick);
      ov.addEventListener('input', onAddParcelInput);
    }
    ov.style.display = 'flex';
    apResults = [];
    const r = document.getElementById('ap-results'); if (r) r.innerHTML = '';
    const a = document.getElementById('ap-company'); if (a) a.focus();
  }

  function closeAddParcel() {
    const ov = document.getElementById('addp-overlay');
    if (ov) {
      ov.style.display = 'none';
      ['ap-company','ap-address','ap-key','ap-cell','ap-search','ap-pos'].forEach((i) => { const el = document.getElementById(i); if (el) el.value = ''; });
      const r = document.getElementById('ap-results'); if (r) r.innerHTML = '';
    }
    apResults = [];
  }

  function onAddParcelInput(e) {
    if (e.target && e.target.id === 'ap-search') renderApResults(e.target.value.toLowerCase().trim());
  }

  function renderApResults(q) {
    const box = document.getElementById('ap-results');
    if (!box) return;
    if (!q) { box.innerHTML = ''; apResults = []; return; }
    let clients = [];
    try { clients = JSON.parse(localStorage.getItem('rm_clients') || '[]'); } catch (e) {}
    const nq = (typeof ClientMatch !== 'undefined') ? ClientMatch.normAddr(q) : q;
    apResults = clients.filter((c) => (typeof ClientMatch !== 'undefined')
      ? (ClientMatch.normAddr(c.company).includes(nq) || ClientMatch.normAddr(c.address).includes(nq)) : true).slice(0, 8);
    box.innerHTML = apResults.length
      ? apResults.map((c, i) => `<div class="ap-item" data-action="ap-pick" data-idx="${i}">${c.company ? `<div class="ap-firm">${Utils.escapeHtml(c.company)}</div>` : ''}<div class="ap-addr">${Utils.escapeHtml(c.address)}</div></div>`).join('')
      : '<div class="ap-empty">Ничего не найдено</div>';
  }

  function onAddParcelClick(e) {
    if (e.target.closest('[data-action="ap-cancel"]')) { closeAddParcel(); return; }
    if (e.target.closest('[data-action="ap-save"]')) { saveParcel(); return; }
    if (e.target.closest('[data-action="ap-scan"]')) {
      if (typeof CamScanner === 'undefined') { Utils.toast('Сканер не загрузился', 'error'); return; }
      CamScanner.open({ onResult: (rr) => {
        const c = document.getElementById('ap-company'), a = document.getElementById('ap-address');
        if (c) c.value = rr.company || '';
        if (a) a.value = rr.address || '';
        Utils.toast('Распознано — проверь и жми «Добавить»', 'success');
      } });
      return;
    }
    const pick = e.target.closest('[data-action="ap-pick"]');
    if (pick) {
      const c = apResults[+pick.dataset.idx]; if (!c) return;
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
      set('ap-company', c.company); set('ap-address', c.address); set('ap-key', c.key); set('ap-cell', c.cell);
      const box = document.getElementById('ap-results'); if (box) box.innerHTML = '';
      const srch = document.getElementById('ap-search'); if (srch) srch.value = '';
      apResults = [];
      return;
    }
  }

  async function saveParcel() {
    const v = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    let company = v('ap-company'), address = v('ap-address'), key = v('ap-key'), cell = v('ap-cell');
    if (!address) { Utils.toast('Введите адрес', 'error'); return; }
    const btn = document.getElementById('ap-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Добавляю…'; }
    let clients = [];
    try { clients = JSON.parse(localStorage.getItem('rm_clients') || '[]'); } catch (e) {}
    const known = (typeof ClientMatch !== 'undefined') ? ClientMatch.matchClient(address, company, clients) : null;
    let lat = null, lng = null, manual = false;
    if (known) {
      if (known.address) address = known.address; // чистый адрес из базы
      if (!company && known.company) company = known.company;
      if (!key && known.key) key = known.key;
      if (!cell && known.cell) cell = known.cell;
      if (known.lat != null && known.lng != null) { lat = known.lat; lng = known.lng; manual = !!known.manual; }
    }
    if (lat == null && typeof Geocode !== 'undefined') {
      try { const geo = await Geocode.lookup(address); if (geo) { lat = geo.lat; lng = geo.lng; } } catch (e) {}
    }
    const posRaw = v('ap-pos');
    const pos = posRaw ? parseInt(posRaw, 10) : null;
    const orders = App.tour.points.filter((x) => x.order != null).map((x) => x.order);
    const nextOrder = (orders.length ? Math.max.apply(null, orders) : 0) + 1;
    let assignedOrder = null;
    if (lat != null) {
      if (pos && pos >= 1) {
        // вставить на позицию pos — сдвинуть остальные вниз
        App.tour.points.forEach((x) => { if (x.order != null && x.order >= pos) x.order += 1; });
        assignedOrder = pos;
      } else {
        assignedOrder = nextOrder;
      }
    }
    const pt = {
      id: Utils.uid(), rawText: address, editedText: address,
      company: company || '', key: key || '', cell: cell || '', parcels: '', weight: '',
      lat: lat, lng: lng, foundAddress: null, matchedHouse: false,
      manualCoords: manual, geoStatus: lat != null ? 'ok' : 'error',
      order: assignedOrder, tourStatus: 'pending',
    };
    App.tour.points.push(pt);
    App.saveTour();
    renderMarkers();
    renderList();
    if (btn) { btn.disabled = false; btn.textContent = 'Добавить'; }
    closeAddParcel();
    Utils.toast(lat != null ? ('Посылка добавлена ✓' + (pos && pos >= 1 ? ' на позицию ' + pos : '')) : 'Добавлено — адрес не найден, поставь точку на карте', lat != null ? 'success' : 'error');
  }

  // ─── Редактирование точки в активном туре (адрес / № / геокодинг вручную) ───
  function setPointPosition(p, newPos) {
    const onRoute = App.tour.points.filter((x) => x.order != null && x.tourStatus !== 'skip' && x.tourStatus !== 'transferred');
    onRoute.sort((a, b) => a.order - b.order);
    const without = onRoute.filter((x) => x !== p);
    let idx = Math.max(1, Math.min(newPos, without.length + 1)) - 1;
    without.splice(idx, 0, p);
    without.forEach((x, i) => { x.order = i + 1; });
  }

  function updateEpGeo() {
    const el = document.getElementById('ep-geo');
    if (el) el.textContent = editCoords
      ? ('📍 координаты: ' + editCoords.lat.toFixed(5) + ', ' + editCoords.lng.toFixed(5) + (editManual ? ' (вручную)' : ''))
      : '⚠️ без координат';
  }

  function openEditPoint(id) {
    const p = App.tour.points.find((x) => x.id === id);
    if (!p) return;
    closeSheet();
    editPointId = id;
    editCoords = (p.lat != null && p.lng != null) ? { lat: p.lat, lng: p.lng } : null;
    editManual = !!p.manualCoords;
    let ov = document.getElementById('editp-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'editp-overlay';
      ov.className = 'addp-overlay';
      document.body.appendChild(ov);
      ov.addEventListener('click', onEditPointClick);
    }
    ov.innerHTML = `
      <div class="addp-card">
        <h3>✏️ Изменить точку</h3>
        <input id="ep-company" placeholder="Фирма">
        <input id="ep-address" placeholder="Адрес">
        <div class="edit-row"><input id="ep-key" placeholder="Ключ"><input id="ep-cell" placeholder="Ячейка"></div>
        <input id="ep-pos" inputmode="numeric" placeholder="№ остановки">
        <div class="ep-geo" id="ep-geo"></div>
        <div class="edit-row">
          <button class="btn btn-secondary" data-action="ep-geocode">🔄 Геокодировать</button>
          <button class="btn btn-secondary" data-action="ep-place">📍 На карте</button>
        </div>
        <div class="addp-actions">
          <button class="btn btn-ghost" data-action="ep-cancel">Отмена</button>
          <button class="btn btn-primary" id="ep-save-btn" data-action="ep-save">Сохранить</button>
        </div>
      </div>`;
    ov.style.display = 'flex';
    document.getElementById('ep-company').value = p.company || '';
    document.getElementById('ep-address').value = p.editedText || '';
    document.getElementById('ep-key').value = p.key || '';
    document.getElementById('ep-cell').value = p.cell || '';
    document.getElementById('ep-pos').value = p.order != null ? p.order : '';
    updateEpGeo();
  }

  function closeEditPoint() {
    const ov = document.getElementById('editp-overlay');
    if (ov) ov.style.display = 'none';
    editPointId = null; editCoords = null; editManual = false;
  }

  async function geocodeEdit() {
    const addr = (document.getElementById('ep-address') || {}).value;
    if (!addr || !addr.trim()) { Utils.toast('Введите адрес', 'error'); return; }
    const btn = document.querySelector('[data-action="ep-geocode"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Ищу…'; }
    let geo = null;
    if (typeof Geocode !== 'undefined') { try { geo = await Geocode.lookup(addr.trim()); } catch (e) {} }
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Геокодировать'; }
    if (geo) { editCoords = { lat: geo.lat, lng: geo.lng }; editManual = false; updateEpGeo(); Utils.toast('Адрес найден ✓', 'success'); }
    else Utils.toast('Не найдено — поставь точку на карте', 'error');
  }

  function placeEdit() {
    const me = meMarker ? meMarker.getLatLng() : null;
    const addr = (document.getElementById('ep-address') || {}).value || '';
    PlacePicker.open({
      title: '📍 Поставить точку',
      subtitle: addr,
      coords: editCoords,
      me: me ? [me.lat, me.lng] : null,
      onSave: (c) => { editCoords = { lat: c.lat, lng: c.lng }; editManual = true; updateEpGeo(); },
    });
  }

  function saveEditPoint() {
    const p = App.tour.points.find((x) => x.id === editPointId);
    if (!p) { closeEditPoint(); return; }
    const v = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const address = v('ep-address');
    if (!address) { Utils.toast('Адрес не может быть пустым', 'error'); return; }
    p.company = v('ep-company');
    p.editedText = address; p.rawText = address;
    p.key = v('ep-key'); p.cell = v('ep-cell');
    if (editCoords) { p.lat = editCoords.lat; p.lng = editCoords.lng; p.manualCoords = editManual; p.geoStatus = 'ok'; }
    const posRaw = v('ep-pos');
    const pos = posRaw ? parseInt(posRaw, 10) : null;
    if (pos && pos >= 1) setPointPosition(p, pos);
    // пересоздать метку на новом месте
    if (markers[p.id]) { map.removeLayer(markers[p.id]); delete markers[p.id]; }
    App.saveTour();
    renderMarkers();
    renderList();
    closeEditPoint();
    Utils.toast('Точка обновлена ✓', 'success');
  }

  function onEditPointClick(e) {
    if (e.target.closest('[data-action="ep-cancel"]')) { closeEditPoint(); return; }
    if (e.target.closest('[data-action="ep-save"]')) { saveEditPoint(); return; }
    if (e.target.closest('[data-action="ep-geocode"]')) { geocodeEdit(); return; }
    if (e.target.closest('[data-action="ep-place"]')) { placeEdit(); return; }
  }

  return { mount, unmount };
})();
