const UIBuild = (() => {
  let root, map, markers = {}, polyline, meMarker, legLabels = [], arrows = null;

  function mount(container) {
    root = container;
    root.addEventListener('click', onClick);
    initMap();
    renderMarkers();
    locateMe();
  }

  function unmount() {
    root.removeEventListener('click', onClick);
    if (map) { map.remove(); map = null; }
    markers = {};
  }

  function initMap() {
    const first = App.tour.points[0];
    const center = first ? [first.lat, first.lng] : [55.751244, 37.618423];
    map = L.map('build-map', { zoomControl: true, attributionControl: false }).setView(center, 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    polyline = L.polyline([], { color: '#3b82f6', weight: 4, opacity: 0.85 }).addTo(map);
  }

  function locateMe() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const icon = L.divIcon({ className: '', html: '<div class="marker-me"></div>', iconSize: [20, 20] });
        if (meMarker) map.removeLayer(meMarker);
        meMarker = L.marker([pos.coords.latitude, pos.coords.longitude], { icon, zIndexOffset: 1000 }).addTo(map);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  function markerIcon(point) {
    const cls = ['marker-dot'];
    if (point.order != null) cls.push('numbered');
    if (point.geoStatus === 'warn') cls.push('warn');
    const label = point.order != null ? point.order : '?';
    const firm = point.company ? `<span class="mk-firm">${Utils.escapeHtml(point.company)}</span>` : '';
    const addr = Utils.escapeHtml(point.editedText.split(',')[0]);
    const labelBox = `<div class="mk-label">${firm}<span class="mk-addr">${addr}</span></div>`;
    return L.divIcon({
      className: 'mk-icon',
      html: `${labelBox}<div class="${cls.join(' ')}">${label}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }

  function renderMarkers() {
    App.tour.points.forEach((p) => {
      if (p.lat == null || p.lng == null) return;
      let m = markers[p.id];
      if (!m) {
        m = L.marker([p.lat, p.lng], { icon: markerIcon(p), draggable: true }).addTo(map);
        const pid = p.id;
        m.on('dragstart', () => {
          const pt = App.tour.points.find((x) => x.id === pid);
          if (!pt) return;
          if (pt.origLat == null) { pt.origLat = pt.lat; pt.origLng = pt.lng; } // самое первое (для тройного тапа)
          pt._preLat = pt.lat; pt._preLng = pt.lng; // позиция до этого перемещения (для отмены)
        });
        m.on('dragend', () => {
          const pt = App.tour.points.find((x) => x.id === pid);
          const ll = m.getLatLng();
          pt.lat = ll.lat;
          pt.lng = ll.lng;
          updatePolyline();
          showMoveConfirm(pt, m); // подтвердить / отменить
        });
        m.on('click', () => handleTap(pid, m));
        markers[p.id] = m;
      } else {
        m.setIcon(markerIcon(p));
      }
    });
    updatePolyline();
    updateButton();
  }

  function clearLegLabels() {
    legLabels.forEach((l) => map.removeLayer(l));
    legLabels = [];
  }

  function updateArrows() {
    if (arrows) { map.removeLayer(arrows); arrows = null; }
    if (!L.polylineDecorator || !L.Symbol) return;
    const pts = polyline.getLatLngs();
    if (!pts || pts.length < 2) return;
    arrows = L.polylineDecorator(polyline, {
      patterns: [{
        offset: 25,
        repeat: 60,
        symbol: L.Symbol.arrowHead({
          pixelSize: 11,
          polygon: false,
          pathOptions: { stroke: true, color: '#1e3a8a', weight: 3, opacity: 0.95 },
        }),
      }],
    }).addTo(map);
  }

  function fmtDuration(sec) {
    const m = Math.round(sec / 60);
    if (m < 60) return `${m} мин`;
    const h = Math.floor(m / 60);
    return `${h} ч ${m % 60} мин`;
  }

  async function autoRoute() {
    const pts = App.tour.points.filter((p) => p.lat != null && p.lng != null);
    if (pts.length < 2) { Utils.toast('Нужно минимум 2 точки на карте', ''); return; }

    // порядок из памяти — повторяем привычный маршрут (как ездили раньше), не от местоположения
    let clients = [];
    try { clients = JSON.parse(localStorage.getItem('rm_clients') || '[]'); } catch (e) {}
    const norm = (a) => String(a || '').toLowerCase().replace(/[^0-9a-zа-яё]+/gi, ' ').trim();
    const orderByAddr = {};
    clients.forEach((c) => { if (c.order != null) orderByAddr[norm(c.address)] = c.order; });
    const known = pts.filter((p) => orderByAddr[norm(p.editedText)] != null);
    const unknown = pts.filter((p) => orderByAddr[norm(p.editedText)] == null);

    if (known.length >= 2) {
      known.sort((a, b) => orderByAddr[norm(a.editedText)] - orderByAddr[norm(b.editedText)]);
      let n = 1;
      known.forEach((p) => { p.order = n++; });
      unknown.forEach((p) => { p.order = n++; }); // новые адреса — в конец
      App.saveTour();
      renderMarkers();
      Utils.toast('Маршрут по вашему обычному порядку' + (unknown.length ? ' (+' + unknown.length + ' новых в конце)' : ''), 'success');
      return;
    }

    // истории порядка ещё нет — строим оптимально через OSRM
    Utils.toast('Строю оптимальный маршрут…', '');
    const coords = pts.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/trip/v1/driving/${coords}?source=first&roundtrip=false`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.code !== 'Ok' || !data.waypoints) { Utils.toast('Не удалось построить маршрут', 'error'); return; }
      data.waypoints.forEach((wp, i) => { pts[i].order = wp.waypoint_index + 1; });
      App.saveTour();
      renderMarkers();
      Utils.toast('Маршрут построен — проверь порядок', 'success');
    } catch (e) {
      Utils.toast('Нет связи с сервисом маршрутов', 'error');
    }
  }

  async function updatePolyline() {
    const all = App.tour.points
      .filter((p) => p.order != null)
      .sort((a, b) => a.order - b.order);
    clearLegLabels();
    if (arrows) { map.removeLayer(arrows); arrows = null; }
    if (all.length < 2) {
      polyline.setLatLngs(all.map((p) => [p.lat, p.lng]));
      return;
    }
    // показываем маршрут ТОЛЬКО между двумя последними выбранными точками — без каши
    const numbered = all.slice(-2);
    // прямые линии сразу (мгновенный отклик), маршрут по дорогам подгрузим следом
    polyline.setLatLngs(numbered.map((p) => [p.lat, p.lng]));

    const coords = numbered.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes || !data.routes[0]) return;
      const route = data.routes[0];
      // линия по дорогам
      polyline.setLatLngs(route.geometry.coordinates.map(([lng, lat]) => [lat, lng]));
      // подписи времени в пути на каждом участке
      (route.legs || []).forEach((leg, i) => {
        const a = numbered[i];
        const b = numbered[i + 1];
        if (!a || !b) return;
        const mid = [(a.lat + b.lat) / 2, (a.lng + b.lng) / 2];
        const label = L.marker(mid, {
          icon: L.divIcon({
            className: '',
            html: `<div class="leg-label">${fmtDuration(leg.duration)}</div>`,
            iconSize: [56, 20],
          }),
          interactive: false,
          keyboard: false,
        }).addTo(map);
        legLabels.push(label);
      });
    } catch (e) {
      // нет сети/роутинга — остаются прямые линии
      console.warn('OSRM routing failed', e);
    }
  }

  function updateButton() {
    const btn = document.getElementById('btn-load-route');
    // пускаем дальше даже если пронумерованы не все точки —
    // ненумерованные попадут в раздел «не на маршруте» на активном экране
    const numbered = App.tour.points.filter((p) => p.order != null).length;
    const total = App.tour.points.length;
    btn.disabled = total === 0;
    btn.textContent = numbered < total
      ? `Загрузить маршрут (${numbered}/${total} на карте)`
      : 'Загрузить маршрут';
  }

  function currentMaxOrder() {
    return App.tour.points.reduce((max, p) => (p.order != null && p.order > max ? p.order : max), 0);
  }

  let clickCount = 0, clickTimer = null;

  // короткий тап нумерует; три быстрых тапа возвращают точку на место
  function handleTap(pid, m) {
    clickCount++;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      const n = clickCount;
      clickCount = 0;
      if (n >= 3) resetMarker(pid, m);
      else if (n === 2) setOrderManually(pid);
      else if (n === 1) onMarkerTap(pid);
    }, 350);
  }

  function resetMarker(pid, m) {
    const p = App.tour.points.find((x) => x.id === pid);
    if (!p) return;
    if (p.origLat == null) { Utils.toast('Точка не перемещалась', ''); return; }
    p.lat = p.origLat;
    p.lng = p.origLng;
    p.manualCoords = false;
    m.setLatLng([p.lat, p.lng]);
    App.saveTour();
    updatePolyline();
    Utils.toast('Точка возвращена на место', 'success');
  }

  let pendingMove = null;
  function showMoveConfirm(pt, m) {
    pendingMove = { pt, m };
    const el = document.getElementById('move-confirm');
    if (el) el.classList.remove('hidden');
  }
  function hideMoveConfirm() {
    pendingMove = null;
    const el = document.getElementById('move-confirm');
    if (el) el.classList.add('hidden');
  }
  function confirmMove() {
    if (!pendingMove) return;
    pendingMove.pt.manualCoords = true;
    App.saveTour();
    Utils.toast('Точка закреплена за клиентом', 'success');
    hideMoveConfirm();
  }
  function cancelMove() {
    if (!pendingMove) return;
    const { pt, m } = pendingMove;
    pt.lat = pt._preLat;
    pt.lng = pt._preLng;
    m.setLatLng([pt.lat, pt.lng]);
    updatePolyline();
    App.saveTour();
    Utils.toast('Возвращено на место', '');
    hideMoveConfirm();
  }

  function setOrderManually(pid) {
    const p = App.tour.points.find((x) => x.id === pid);
    if (!p) return;
    const v = window.prompt('Номер точки в маршруте (пусто — убрать номер)', p.order != null ? p.order : '');
    if (v == null) return;
    const t = String(v).trim();
    if (t === '') {
      // убрать номер у точки и уплотнить остальные без дыр
      p.order = null;
      const rest = App.tour.points.filter((x) => x.order != null).sort((a, b) => a.order - b.order);
      rest.forEach((x, i) => { x.order = i + 1; });
    } else {
      let num = parseInt(t, 10);
      if (isNaN(num) || num < 1) { Utils.toast('Введите число больше 0', ''); return; }
      // вставляем точку на позицию num, остальные сдвигаются; сквозная перенумерация без дублей
      p.order = null;
      const rest = App.tour.points.filter((x) => x.id !== pid && x.order != null).sort((a, b) => a.order - b.order);
      if (num > rest.length + 1) num = rest.length + 1;
      rest.splice(num - 1, 0, p);
      rest.forEach((x, i) => { x.order = i + 1; });
    }
    App.saveTour();
    renderMarkers();
    Utils.toast('Порядок обновлён', 'success');
  }

  function onMarkerTap(id) {
    const point = App.tour.points.find((p) => p.id === id);
    if (!point) return;

    if (point.order != null) {
      // снять номер с ЛЮБОЙ точки и перенумеровать остальные без дыр
      const removed = point.order;
      point.order = null;
      App.tour.points.forEach((p) => {
        if (p.order != null && p.order > removed) p.order -= 1;
      });
      App.saveTour();
      renderMarkers();
      return;
    }
    point.order = currentMaxOrder() + 1;
    App.saveTour();
    renderMarkers();
  }

  function onClick(e) {
    if (e.target.closest('[data-action="auto-route"]')) { autoRoute(); return; }
    if (e.target.closest('[data-action="confirm-move"]')) { confirmMove(); return; }
    if (e.target.closest('[data-action="cancel-move"]')) { cancelMove(); return; }

    const backBtn = e.target.closest('[data-action="back-validate"]');
    if (backBtn) { Router.show('validate'); return; }

    const saveBtn = e.target.closest('[data-action="save-tour"]');
    if (saveBtn) { App.saveTour(); Utils.toast('Адреса сохранены', 'success'); return; }

    const resetBtn = e.target.closest('[data-action="reset-numbering"]');
    if (resetBtn) {
      App.tour.points.forEach((p) => (p.order = null));
      App.saveTour();
      renderMarkers();
      return;
    }

    const loadBtn = e.target.closest('[data-action="load-route"]');
    if (loadBtn) {
      App.tour.stage = 'active';
      App.saveTour();
      Router.show('active');
    }
  }

  return { mount, unmount };
})();
