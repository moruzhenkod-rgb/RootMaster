// Read-only view of one previous (finished/cancelled) tour
const UIHistoryDetail = (() => {
  let root, map, markers = {}, currentView = 'list', tour = null;

  function mount(container, params) {
    root = container;
    currentView = 'list';
    tour = params && params.id ? Storage.loadHistoryItem(params.id) : null;
    root.addEventListener('click', onClick);

    if (!tour || !tour.points || !tour.points.length) {
      document.getElementById('history-detail-list').innerHTML =
        '<div class="empty-hint">Тур не найден</div>';
      return;
    }

    initMap();
    renderMarkers();
    renderList();
  }

  function unmount() {
    root.removeEventListener('click', onClick);
    if (map) { map.remove(); map = null; }
    markers = {};
    tour = null;
  }

  function sortedPoints() {
    return [...tour.points].sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  function initMap() {
    const first = tour.points[0];
    const center = first ? [first.lat, first.lng] : [55.751244, 37.618423];
    map = L.map('history-detail-map', { zoomControl: true, attributionControl: false }).setView(center, 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
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
    tour.points.forEach((p) => {
      if (p.lat == null || p.lng == null) return;
      const m = L.marker([p.lat, p.lng], { icon: markerIcon(p) }).addTo(map);
      m.bindTooltip(p.editedText, { direction: 'top' });
      markers[p.id] = m;
    });
  }

  function statusText(p) {
    if (p.tourStatus === 'done') return 'Доставлено';
    if (p.tourStatus === 'skip') return 'Отменено';
    if (p.tourStatus === 'transferred') return 'Передано';
    return 'В пути';
  }

  function statusClass(p) {
    if (p.tourStatus === 'done') return 'done';
    if (p.tourStatus === 'skip' || p.tourStatus === 'transferred') return 'skip';
    return '';
  }

  function renderList() {
    const list = document.getElementById('history-detail-list');
    const pts = sortedPoints();
    const done = pts.filter((p) => p.tourStatus === 'done').length;
    document.getElementById('history-detail-counter').textContent = `${done}/${pts.length}`;
    list.innerHTML = pts
      .map(
        (p) => `
      <div class="stop-card ${statusClass(p)}">
        <div class="stop-num">${p.order != null ? p.order : '?'}</div>
        <div class="stop-body">
          <div class="stop-addr">${Utils.escapeHtml(p.editedText)}</div>
          <div class="stop-status">${statusText(p)}</div>
        </div>
      </div>`
      )
      .join('');
  }

  function onClick(e) {
    const backBtn = e.target.closest('[data-action="back-history"]');
    if (backBtn) { Router.show('history'); return; }

    const switchBtn = e.target.closest('[data-action="switch-view"]');
    if (switchBtn) {
      currentView = switchBtn.dataset.view;
      root.querySelectorAll('.switch-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === currentView));
      document.getElementById('history-detail-map').classList.toggle('hidden', currentView !== 'map');
      document.getElementById('history-detail-list').classList.toggle('hidden', currentView !== 'list');
      if (currentView === 'map' && map) setTimeout(() => map.invalidateSize(), 50);
    }
  }

  return { mount, unmount };
})();
