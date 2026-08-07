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
    return L.divIcon({
      className: '',
      html: `<div class="${cls.join(' ')}">${label}</div>`,
      iconSize: [34, 34],
    });
  }

  function renderMarkers() {
    App.tour.points.forEach((p) => {
      if (p.lat == null || p.lng == null) return;
      let m = markers[p.id];
      if (!m) {
        m = L.marker([p.lat, p.lng], { icon: markerIcon(p), draggable: true }).addTo(map);
        m.on('click', () => onMarkerTap(p.id));
        m.on('dragend', () => {
          const ll = m.getLatLng();
          p.lat = ll.lat;
          p.lng = ll.lng;
          p.manualCoords = true;
          App.saveTour();
          updatePolyline();
        });
        m.bindTooltip(p.editedText.split(',')[0], { permanent: true, direction: 'top', className: 'addr-tip', offset: [0, -16] });
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
    const numbered = App.tour.points
      .filter((p) => p.order != null)
      .sort((a, b) => a.order - b.order);
    clearLegLabels();
    if (numbered.length < 2) {
      polyline.setLatLngs(numbered.map((p) => [p.lat, p.lng]));
      return;
    }
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
    if (backBtn) { Router.show('home'); return; }

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
