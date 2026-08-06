const UIBuild = (() => {
  let root, map, markers = {}, polyline, meMarker;

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
        m = L.marker([p.lat, p.lng], { icon: markerIcon(p) }).addTo(map);
        m.on('click', () => onMarkerTap(p.id));
        m.bindTooltip(p.editedText, { direction: 'top' });
        markers[p.id] = m;
      } else {
        m.setIcon(markerIcon(p));
      }
    });
    updatePolyline();
    updateButton();
  }

  function updatePolyline() {
    const numbered = App.tour.points
      .filter((p) => p.order != null)
      .sort((a, b) => a.order - b.order)
      .map((p) => [p.lat, p.lng]);
    polyline.setLatLngs(numbered);
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
    const maxOrder = currentMaxOrder();

    if (point.order != null) {
      // Tapping the last numbered point again undoes it
      if (point.order === maxOrder) {
        point.order = null;
        App.saveTour();
        renderMarkers();
      }
      return;
    }
    point.order = maxOrder + 1;
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
