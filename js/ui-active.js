const UIActive = (() => {
  let root, map, markers = {}, meMarker, currentView = 'map', activePointId = null;

  function mount(container) {
    root = container;
    root.addEventListener('click', onHeaderClick);
    initMap();
    renderMarkers();
    renderList();
    locateMe();

    document.getElementById('bottom-sheet-overlay').addEventListener('click', onSheetOverlayClick);
    document.getElementById('context-menu-overlay').addEventListener('click', onContextOverlayClick);
  }

  function unmount() {
    root.removeEventListener('click', onHeaderClick);
    document.getElementById('bottom-sheet-overlay').removeEventListener('click', onSheetOverlayClick);
    document.getElementById('context-menu-overlay').removeEventListener('click', onContextOverlayClick);
    closeSheet();
    closeContext();
    if (map) { map.remove(); map = null; }
    markers = {};
  }

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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  }

  function locateMe() {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition(
      (pos) => {
        const icon = L.divIcon({ className: '', html: '<div class="marker-me"></div>', iconSize: [20, 20] });
        if (meMarker) map.removeLayer(meMarker);
        meMarker = L.marker([pos.coords.latitude, pos.coords.longitude], { icon, zIndexOffset: 1000 }).addTo(map);
      },
      () => {},
      { enableHighAccuracy: true }
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
      if (p.tourStatus === 'skip' || p.tourStatus === 'transferred') {
        if (markers[p.id]) { map.removeLayer(markers[p.id]); delete markers[p.id]; }
        return;
      }
      let m = markers[p.id];
      if (!m) {
        m = L.marker([p.lat, p.lng], { icon: markerIcon(p) }).addTo(map);
        const el = m.getElement && m.getElement();
        m.on('add', () => {
          const domEl = m.getElement();
          if (domEl) {
            Utils.bindLongPress(domEl, () => openContextMenu(p.id), () => openSheet(p.id));
          }
        });
        markers[p.id] = m;
      } else {
        m.setIcon(markerIcon(p));
      }
    });
  }

  function statusText(p) {
    if (p.tourStatus === 'done') return 'Выполнено';
    return 'В пути';
  }

  function renderList() {
    const list = document.getElementById('active-list');
    const pts = sortedPoints().filter((p) => p.tourStatus !== 'skip' && p.tourStatus !== 'transferred');
    list.innerHTML = pts
      .map(
        (p) => `
      <div class="stop-card ${p.tourStatus === 'done' ? 'done' : ''}" data-id="${p.id}">
        <div class="stop-num">${p.order != null ? p.order : '?'}</div>
        <div class="stop-body">
          <div class="stop-addr">${Utils.escapeHtml(p.editedText)}</div>
          <div class="stop-status">${statusText(p)}</div>
        </div>
        <div class="stop-check" data-action="quick-done">${p.tourStatus === 'done' ? '✓' : ''}</div>
      </div>`
      )
      .join('');

    list.querySelectorAll('.stop-card').forEach((card) => {
      const id = card.dataset.id;
      Utils.bindLongPress(card, () => openContextMenu(id), (e) => {
        if (e.target.closest('[data-action="quick-done"]')) {
          toggleDone(id);
        } else {
          openSheet(id);
        }
      });
    });

    updateCounter();
  }

  function updateCounter() {
    const total = App.tour.points.filter((p) => p.tourStatus !== 'transferred').length;
    const done = App.tour.points.filter((p) => p.tourStatus === 'done').length;
    document.getElementById('active-counter').textContent = `${done}/${total}`;
  }

  function toggleDone(id) {
    const p = App.tour.points.find((pt) => pt.id === id);
    if (!p) return;
    p.tourStatus = p.tourStatus === 'done' ? 'pending' : 'done';
    App.saveTour();
    renderMarkers();
    renderList();
  }

  function openSheet(id) {
    activePointId = id;
    const p = App.tour.points.find((pt) => pt.id === id);
    if (!p) return;
    const content = document.getElementById('sheet-content');
    content.innerHTML = `
      <div class="sheet-address">${Utils.escapeHtml(p.editedText)}</div>
      <div class="sheet-status">${statusText(p)}</div>
      <div class="sheet-actions">
        <button class="btn btn-primary" data-action="navigate">🧭 Поехали в Google Maps</button>
        <button class="btn ${p.tourStatus === 'done' ? 'btn-secondary' : 'btn-success'}" data-action="toggle-done">
          ${p.tourStatus === 'done' ? '↺ Вернуть в работу' : '✓ Точка выполнена'}
        </button>
        <button class="btn btn-ghost" data-action="open-context">⋯ Статус точки</button>
      </div>
    `;
    content.querySelector('[data-action="navigate"]').addEventListener('click', () => {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`, '_blank');
    });
    content.querySelector('[data-action="toggle-done"]').addEventListener('click', () => {
      toggleDone(id);
      closeSheet();
    });
    content.querySelector('[data-action="open-context"]').addEventListener('click', () => {
      closeSheet();
      openContextMenu(id);
    });
    document.getElementById('bottom-sheet-overlay').classList.remove('hidden');
  }

  function closeSheet() {
    document.getElementById('bottom-sheet-overlay').classList.add('hidden');
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
    const backBtn = e.target.closest('[data-action="back-build"]');
    if (backBtn) { Router.show('build'); return; }

    const switchBtn = e.target.closest('[data-action="switch-view"]');
    if (switchBtn) {
      currentView = switchBtn.dataset.view;
      root.querySelectorAll('.switch-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === currentView));
      document.getElementById('active-map').classList.toggle('hidden', currentView !== 'map');
      document.getElementById('active-list').classList.toggle('hidden', currentView !== 'list');
      if (currentView === 'map' && map) setTimeout(() => map.invalidateSize(), 50);
    }
  }

  return { mount, unmount };
})();
