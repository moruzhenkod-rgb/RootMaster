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
    const key = point.key ? `<span class="mk-key">🔑 ${Utils.escapeHtml(point.key)}</span>` : '';
    const labelBox = `<div class="mk-label">${firm}<span class="mk-addr">${addr}</span>${key}</div>`;
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
        m = L.marker([p.lat, p.lng], { icon: markerIcon(p), draggable: false }).addTo(map);
        const pid = p.id;
        m.on('dragstart', () => {
          const pt = App.tour.points.find((x) => x.id === pid);
          if (pt && pt.origLat == null) { pt.origLat = pt.lat; pt.origLng = pt.lng; }
        });
        m.on('dragend', () => {
          const pt = App.tour.points.find((x) => x.id === pid);
          const ll = m.getLatLng();
          pt.lat = ll.lat;
          pt.lng = ll.lng;
          pt.manualCoords = true;
          App.saveTour();
          updatePolyline();
          if (m.dragging) m.dragging.disable(); // защита обратно
        });
        m.on('click', () => handleTap(pid, m));
        m.on('contextmenu', () => enableDrag(m)); // долгое нажатие / правый клик → включить перетаскивание
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

  async function updatePolyline() {
    const all = App.tour.points
      .filter((p) => p.order != null)
      .sort((a, b) => a.order - b.order);
    clearLegLabels();
    if (all.length < 2) {
      polyline.setLatLngs(all.map((p) => [p.lat, p.lng]));
      if (arrows) { map.removeLayer(arrows); arrows = null; }
      return;
    }
    // показываем маршрут ТОЛЬКО между двумя последними выбранными точками — без каши
    const numbered = all.slice(-2);
    // прямые линии сразу (мгновенный отклик), маршрут по дорогам подгрузим следом
    polyline.setLatLngs(numbered.map((p) => [p.lat, p.lng]));
    updateArrows();

    const coords = numbered.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes || !data.routes[0]) return;
      const route = data.routes[0];
      // линия по дорогам
      polyline.setLatLngs(route.geometry.coordinates.map(([lng, lat]) => [lat, lng]));
      updateArrows();
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
      else if (n === 1) onMarkerTap(pid);
    }, 350);
  }

  // зажатие включает перетаскивание (защита от случайного сдвига)
  function enableDrag(m) {
    if (m.dragging) m.dragging.enable();
    if (navigator.vibrate) navigator.vibrate(40);
    Utils.toast('Точку можно двигать — потяните', 'success');
  }

  function resetMarker(pid, m) {
    const p = App.tour.points.find((x) => x.id === pid);
    if (!p) return;
    if (p.origLat == null) { Utils.toast('Точка не перемещалась', ''); return; }
    p.lat = p.origLat;
    p.lng = p.origLng;
    p.manualCoords = false;
    m.setLatLng([p.lat, p.lng]);
    if (m.dragging) m.dragging.disable();
    App.saveTour();
    updatePolyline();
    Utils.toast('Точка возвращена на место', 'success');
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
