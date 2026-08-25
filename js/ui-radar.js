// UI экрана «Радар-детектор»: карта камер (Leaflet), глобальный компактный индикатор,
// озвучка через AudioManager. Сама логика детектора живёт в RadarModule/RadarInstance.
const UIRadar = (() => {
  let root, unsubState, unsubHazards, unsubPos, unsubMeta;
  let map, meMarker, hazardLayer, mapModalOpen = false;
  let dbStatusTimer = null;

  function instance() {
    return window.RadarInstance || (window.RadarInstance = RadarModule.createRadar());
  }

  function mount(container) {
    root = container;
    root.addEventListener('click', onClick);
    const r = instance();
    unsubState = r.onStateChange(render);
    unsubHazards = r.onHazardsChange(renderHazardsOnMap);
    unsubPos = r.onPosition(renderPositionOnMap);
    unsubMeta = r.onMetaChange(renderDbStatus);
    render(r.getState());
    renderHazardsOnMap(r.getHazards());
    renderDbStatus({ updatedAt: r.getLastUpdate(), updating: r.isUpdating() });
    // подтягиваем уже сохранённую метку из IndexedDB сразу, не дожидаясь нажатия СТАРТ
    r.syncMeta();
    // "N мин/ч назад" сам по себе устаревает без новых событий — обновляем текст раз в минуту
    dbStatusTimer = setInterval(() => renderDbStatus({ updatedAt: r.getLastUpdate(), updating: r.isUpdating() }), 60000);
  }

  function unmount() {
    root.removeEventListener('click', onClick);
    if (unsubState) unsubState();
    if (unsubHazards) unsubHazards();
    if (unsubPos) unsubPos();
    if (unsubMeta) unsubMeta();
    if (dbStatusTimer) { clearInterval(dbStatusTimer); dbStatusTimer = null; }
    closeMap();
  }

  function render(state) {
    const btn = document.getElementById('radar-main-btn');
    const txt = document.getElementById('radar-status-text');
    if (!btn) return;
    const ui = RadarModule.describeUIState(state);
    btn.dataset.state = state;
    if (txt) txt.textContent = ui.statusText;
  }

  // «когда последний раз обновлялась база камер» — на экране детектора и в шапке карты
  function renderDbStatus(meta) {
    const text = meta.updating ? 'Обновление базы камер…' : 'База камер: ' + RadarModule.formatLastUpdate(meta.updatedAt);
    const stale = !meta.updating && (meta.updatedAt == null || (Date.now() - meta.updatedAt) >= RadarModule.REFRESH_INTERVAL_MS);
    [document.getElementById('radar-db-status'), document.getElementById('radar-map-db-status')].forEach((el) => {
      if (!el) return;
      el.textContent = text;
      el.dataset.updating = meta.updating ? 'true' : 'false';
      el.dataset.stale = stale ? 'true' : 'false';
      if (!meta.updating) el.dataset.error = 'false';
    });
    [document.getElementById('radar-db-refresh'), document.getElementById('radar-map-db-refresh')].forEach((btn) => {
      if (!btn) return;
      btn.disabled = !!meta.updating;
    });
  }

  function onRefreshDbClick() {
    const r = instance();
    if (r.isUpdating()) return;
    r.refreshNow().catch(() => {
      // сеть/GPS недоступны — подсвечиваем статус красным, старые данные остаются на экране
      [document.getElementById('radar-db-status'), document.getElementById('radar-map-db-status')].forEach((el) => {
        if (el) el.dataset.error = 'true';
      });
    });
  }

  function onClick(e) {
    if (e.target.closest('[data-action="back-home"]')) {
      Router.show('home');
      return;
    }
    if (e.target.closest('[data-action="radar-toggle"]')) {
      const r = instance();
      const state = r.getState();
      if (typeof AudioManager !== 'undefined' && AudioManager.getInstance) {
        window.AudioManagerInstance = window.AudioManagerInstance || AudioManager.getInstance();
        window.AudioManagerInstance.preload();
      }
      if (state === 'idle') r.start();
      else if (state === 'active') r.stop();
      return;
    }
    if (e.target.closest('[data-action="open-radar-map"]')) {
      openMap();
      return;
    }
    if (e.target.closest('[data-action="close-radar-map"]')) {
      closeMap();
      return;
    }
    if (e.target.closest('[data-action="radar-refresh-db"]')) {
      onRefreshDbClick();
      return;
    }
  }

  // ---------------------------------------------------------------------
  // Карта камер (модальное окно с Leaflet) — текущая позиция + камеры/опасности в радиусе показа
  // ---------------------------------------------------------------------

  function hazardIcon(type) {
    const cls = type === 'accident' ? 'radar-map-marker radar-map-marker-accident'
      : type === 'roadworks' ? 'radar-map-marker radar-map-marker-roadworks'
      : type === 'bus_stop' ? 'radar-map-marker radar-map-marker-bus'
      : 'radar-map-marker radar-map-marker-camera';
    const glyph = type === 'accident' ? '!' : type === 'roadworks' ? '⚠' : type === 'bus_stop' ? 'Б' : '📷';
    return L.divIcon({ className: '', html: `<div class="${cls}">${glyph}</div>`, iconSize: [26, 26] });
  }

  function openMap() {
    const modal = document.getElementById('radar-map-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    mapModalOpen = true;
    if (!map) {
      map = L.map('radar-map', { zoomControl: true, attributionControl: false }).setView([55.751244, 37.618423], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
      hazardLayer = L.layerGroup().addTo(map);
    }
    setTimeout(() => { if (map) map.invalidateSize(); }, 50);
    const r = instance();
    renderHazardsOnMap(r.getHazards());
    const last = r.getLastPosition();
    if (last) renderPositionOnMap(last);
  }

  function closeMap() {
    const modal = document.getElementById('radar-map-modal');
    if (modal) modal.style.display = 'none';
    mapModalOpen = false;
  }

  function renderHazardsOnMap(hazards) {
    if (!map || !hazardLayer) return;
    hazardLayer.clearLayers();
    (hazards || []).forEach((h) => {
      L.marker([h.lat, h.lon], { icon: hazardIcon(h.type) }).addTo(hazardLayer);
    });
  }

  function renderPositionOnMap(pos) {
    if (!map || !pos) return;
    const heading = pos.heading == null ? 0 : pos.heading;
    if (!meMarker) {
      const icon = L.divIcon({
        className: '',
        html: `<div class="radar-map-chevron" style="transform: rotate(${heading}deg)">▲</div>`,
        iconSize: [28, 28],
      });
      meMarker = L.marker([pos.lat, pos.lon], { icon, zIndexOffset: 1000 }).addTo(map);
      if (mapModalOpen) map.setView([pos.lat, pos.lon], 14);
    } else {
      meMarker.setLatLng([pos.lat, pos.lon]);
      meMarker.setIcon(L.divIcon({
        className: '',
        html: `<div class="radar-map-chevron" style="transform: rotate(${heading}deg)">▲</div>`,
        iconSize: [28, 28],
      }));
    }
  }

  return { mount, unmount };
})();

// Глобальный индикатор живёт вне #app (Router его не трогает при смене экрана) —
// поэтому он всегда виден и синхронизирован с тем же экземпляром радара.
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('radar-global-indicator');
  if (!el || typeof RadarModule === 'undefined') return;
  const radar = window.RadarInstance || (window.RadarInstance = RadarModule.createRadar());
  const apply = (state) => { el.dataset.state = state; };
  radar.onStateChange(apply);
  apply(radar.getState());
  el.addEventListener('click', () => {
    if (typeof Router !== 'undefined') Router.show('radar');
  });
});
