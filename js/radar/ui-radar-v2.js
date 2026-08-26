// RadarUI v2: тёмная карта Leaflet + HUD + машина-стрелка + конус + камеры/ремонты + движок + звук.
const UIRadar2 = (() => {
  let root, map, engine, carMarker, coneLayer, camLayer, incLayer, started = false, wakeLock = null;

  function audio() {
    if (typeof AudioManager === 'undefined' || !AudioManager.getInstance) return null;
    window.AudioManagerInstance = window.AudioManagerInstance || AudioManager.getInstance();
    return window.AudioManagerInstance;
  }

  function mount(container) {
    root = container;
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    initMap();
    // база камер: предзагрузка дефолтного CSV
    if (typeof RadarDB !== 'undefined') RadarDB.ensureLoaded().then((n) => setStatus('База камер: ' + n)).catch(() => {});
    engine = RadarEngine.create({
      db: typeof RadarDB !== 'undefined' ? RadarDB : null,
      traffic: typeof RadarTraffic !== 'undefined' ? RadarTraffic : null,
      onAlert: onAlert,
      onTick: onTick,
    });
    const v = parseFloat(localStorage.getItem('rm_radar_vol')); const a = audio();
    if (a && a.setVolume && v >= 0) a.setVolume(v);
    const sl = root.querySelector('#r2-vol'); if (sl && v >= 0) sl.value = v;
  }

  function unmount() {
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
    if (engine) engine.stop();
    releaseWake();
    if (map) { map.remove(); map = null; }
    started = false;
  }

  function initMap() {
    const el = root.querySelector('#r2-map');
    if (!el || typeof L === 'undefined') return;
    map = L.map(el, { zoomControl: false, attributionControl: false }).setView([53.63, 11.41], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    el.classList.add('r2-dark');
    camLayer = L.layerGroup().addTo(map);
    incLayer = L.layerGroup().addTo(map);
    coneLayer = L.layerGroup().addTo(map);
  }

  function setStatus(t) { const el = root.querySelector('#r2-status'); if (el) el.textContent = t; }
  function setHud(speed, limit, dist) {
    const s = root.querySelector('#r2-speed'); if (s) s.textContent = Math.round(speed);
    const l = root.querySelector('#r2-limit'); if (l) l.textContent = limit ? limit : '—';
    const d = root.querySelector('#r2-dist'); if (d) d.textContent = dist != null ? (dist + ' м') : '';
    const lb = root.querySelector('#r2-limit-box'); if (lb) lb.style.opacity = limit ? '1' : '0.3';
    const over = limit && speed > limit + 3;
    const sp = root.querySelector('#r2-speed-box'); if (sp) sp.classList.toggle('over', !!over);
  }

  function carIcon() {
    return L.divIcon({ className: '', html: '<div class="r2-car">▲</div>', iconSize: [34, 34] });
  }

  function onTick(t) {
    if (!map) return;
    if (!carMarker) carMarker = L.marker([t.lat, t.lon], { icon: carIcon(), zIndexOffset: 1000 }).addTo(map);
    else carMarker.setLatLng([t.lat, t.lon]);
    if (started) map.setView([t.lat, t.lon], map.getZoom() < 13 ? 15 : map.getZoom(), { animate: false });

    // конус упреждения
    coneLayer.clearLayers();
    if (t.heading != null) {
      const pts = conePolygon(t.lat, t.lon, t.heading, t.lookahead, 35);
      L.polygon(pts, { color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.12 }).addTo(coneLayer);
    }
    // камеры
    camLayer.clearLayers();
    (t.cameras || []).forEach((h) => {
      L.marker([h.cam.lat, h.cam.lon], { icon: L.divIcon({ className: '', html: '<div class="r2-cam">' + (h.cam.speed || '📷') + '</div>', iconSize: [30, 30] }) }).addTo(camLayer);
    });
    // ремонты
    incLayer.clearLayers();
    (t.incidents || []).forEach((h) => {
      L.circle([h.inc.lat, h.inc.lon], { radius: 120, color: '#ef4444', weight: 1, fillColor: '#ef4444', fillOpacity: 0.25 }).addTo(incLayer);
    });
    // HUD
    const near = (t.cameras || [])[0];
    setHud(t.speedKmh, near ? near.cam.speed : 0, near ? Math.round(near.dist) : null);
  }

  function conePolygon(lat, lon, heading, distM, halfAngle) {
    const pts = [[lat, lon]];
    for (let a = -halfAngle; a <= halfAngle; a += 10) pts.push(project(lat, lon, heading + a, distM));
    return pts;
  }
  function project(lat, lon, brng, distM) {
    const R = 6371000, br = brng * Math.PI / 180, la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
    const la2 = Math.asin(Math.sin(la) * Math.cos(distM / R) + Math.cos(la) * Math.sin(distM / R) * Math.cos(br));
    const lo2 = lo + Math.atan2(Math.sin(br) * Math.sin(distM / R) * Math.cos(la), Math.cos(distM / R) - Math.sin(la) * Math.sin(la2));
    return [la2 * 180 / Math.PI, lo2 * 180 / Math.PI];
  }

  // приоритеты -> реальные звуки (переиспользуем существующие mp3)
  function onAlert(al) {
    const a = audio(); if (!a) return;
    let keys = [];
    if (al.priority === 'DANGER') keys = ['cam_200m'];
    else if (al.priority === 'CAMERA') keys = [al.distance > 600 ? 'cam_1000m' : al.distance > 300 ? 'cam_500m' : 'cam_200m'];
    else if (al.priority === 'CONSTRUCTION') keys = [al.distance > 300 ? 'hazard_work_500m' : 'hazard_work_200m'];
    if (a.resume) a.resume();
    if (a.enqueue && keys.length) a.enqueue(keys);
  }

  async function requestWake() { try { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) {} }
  function releaseWake() { try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {} }

  function onInput(e) {
    if (e.target && e.target.id === 'r2-vol') {
      const v = parseFloat(e.target.value); const a = audio();
      if (a && a.setVolume) a.setVolume(v);
      localStorage.setItem('rm_radar_vol', String(v));
    }
  }

  function onClick(e) {
    if (e.target.closest('[data-action="back-home"]')) { Router.show('home'); return; }
    if (e.target.closest('[data-action="r2-toggle"]')) {
      const a = audio();
      if (a) { if (a.preload) a.preload(); if (a.unlock) a.unlock(); }
      if (!started) { engine.start(); started = true; requestWake(); setBtn(true); if (a && a.enqueue) a.enqueue(['system_start']); }
      else { engine.stop(); started = false; releaseWake(); setBtn(false); }
      return;
    }
  }
  function setBtn(on) {
    const b = root.querySelector('#r2-btn'); if (b) { b.textContent = on ? 'СТОП' : 'СТАРТ'; b.classList.toggle('on', on); }
  }

  return { mount, unmount };
})();
