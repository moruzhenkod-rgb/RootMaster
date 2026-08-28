// RadarUI v2: простой вид (треугольник + HUD) по умолчанию; карта открывается по кнопке.
// Радар работает в фоне, индикатор — маленькая точка. Камеры/ремонты видны на карте с зумом.
const UIRadar2 = (() => {
  let root, map = null, mapOpen = false, mounted = false, started = false, engine, wakeLock = null;
  let camLayer, incLayer, carMarker = null, lastCar = null, following = true, refollowTimer = null;

  function audio() {
    if (typeof AudioManager === 'undefined' || !AudioManager.getInstance) return null;
    window.AudioManagerInstance = window.AudioManagerInstance || AudioManager.getInstance();
    return window.AudioManagerInstance;
  }

  function mount(container) {
    root = container; mounted = true;
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    if (typeof RadarDB !== 'undefined') RadarDB.ensureLoaded().then((n) => setStatus('База камер: ' + n)).catch(() => {});
    if (!window.__rmEngine) {
      window.__rmEngine = RadarEngine.create({
        db: typeof RadarDB !== 'undefined' ? RadarDB : null,
        traffic: typeof RadarTraffic !== 'undefined' ? RadarTraffic : null,
        onAlert: onAlert, onTick: onTickWrap,
      });
    }
    engine = window.__rmEngine;
    started = !!window.__rmRadarOn;
    setBtn(started); updateIndicator(started);
    const v = parseFloat(localStorage.getItem('rm_radar_vol')); const a = audio();
    if (a && a.setVolume && v >= 0) a.setVolume(v);
    const sl = root.querySelector('#r2-vol'); if (sl && v >= 0) sl.value = v;
  }

  function unmount() {
    mounted = false; mapOpen = false;
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
    if (map) { map.remove(); map = null; carMarker = null; }
    // движок продолжает работать в фоне
  }

  function setStatus(t) { const el = root && root.querySelector('#r2-status'); if (el) el.textContent = t; }
  function updateIndicator(on) { const el = document.getElementById('rm-radar-active'); if (el) el.style.display = on ? 'block' : 'none'; }

  // ── тик движка: индикатор всегда; HUD/карта — когда экран открыт ──
  function onTickWrap(t) {
    lastCar = t;
    updateIndicator(!!window.__rmRadarOn);
    if (!mounted) return;
    updateHud(t);
    if (mapOpen && map) {
      // стрелка — НАСТОЯЩИЙ маркер на GPS: отдалишь карту — останется на реальном месте
      placeCar(t);
      const mapEl = root && root.querySelector('#r2-map');
      if (following) {
        map.setView([t.lat, t.lon], map.getZoom(), { animate: false });
        // режим езды: карта поворачивается по ходу (heading-up), стрелка смотрит вверх
        if (mapEl) mapEl.style.transform = (t.heading != null) ? 'rotate(' + (-t.heading) + 'deg)' : 'none';
        const marks = root.querySelectorAll('#r2-map .r2-emoji');
        for (let i = 0; i < marks.length; i++) marks[i].style.transform = 'rotate(' + (t.heading || 0) + 'deg)';
      } else {
        // режим осмотра (отдалил/сдвинул): карта север-вверх, стрелка на реальном GPS
        if (mapEl) mapEl.style.transform = 'none';
        const marks = root.querySelectorAll('#r2-map .r2-emoji');
        for (let i = 0; i < marks.length; i++) marks[i].style.transform = 'none';
      }
    }
  }

  function updateHud(t) {
    const near = (t.cameras || [])[0];
    const inc = (t.incidents || [])[0];
    const s = root.querySelector('#r2-speed'); if (s) s.textContent = Math.round(t.speedKmh || 0);
    const l = root.querySelector('#r2-limit'); if (l) l.textContent = near && near.cam.speed ? near.cam.speed : '—';
    const d = root.querySelector('#r2-dist'); if (d) d.textContent = near ? Math.round(near.dist) + ' м' : '';
    const lb = root.querySelector('#r2-limit-box'); if (lb) lb.style.opacity = near ? '1' : '0.3';
    const over = near && near.cam.speed && t.speedKmh > near.cam.speed + 3;
    const sp = root.querySelector('#r2-speed-box'); if (sp) sp.classList.toggle('over', !!over);
    const al = root.querySelector('#r2-alert');
    if (al) {
      if (near) al.textContent = '📷 Камера ' + (near.cam.speed || '') + ' · ' + Math.round(near.dist) + ' м';
      else if (inc) al.textContent = '🚧 ' + (RadarTraffic.label(inc.inc.category)) + ' · ' + Math.round(inc.dist) + ' м';
      else al.textContent = started ? 'Слежу за дорогой…' : 'Нажми СТАРТ';
    }
  }

  function carIcon(heading) { const h = (heading != null) ? heading : 0; return L.divIcon({ className: '', html: '<div class="r2-car" style="transform:rotate(' + h + 'deg)">▲</div>', iconSize: [34, 34], iconAnchor: [17, 17] }); }
  function camIcon(cam) { return L.divIcon({ className: '', html: '<div class="r2-emoji">📷' + (cam.speed ? '<b>' + cam.speed + '</b>' : '') + '</div>', iconSize: [36, 36] }); }
  function incEmoji(cat) { return cat === 9 ? '🚧' : cat === 8 ? '⛔' : cat === 7 ? '🚧' : cat === 1 ? '💥' : cat === 6 ? '🚗' : '⚠️'; }
  function incIcon(cat) { return L.divIcon({ className: '', html: '<div class="r2-emoji">' + incEmoji(cat) + '</div>', iconSize: [36, 36] }); }

  // ── КАРТА по кнопке (ленивая инициализация) ──
  function openMap() {
    const el = root.querySelector('#r2-map');
    const wrap = root.querySelector('#r2-map-wrap');
    const simple = root.querySelector('#r2-simple');
    if (!el || !wrap) return;
    wrap.style.display = 'block';
    if (simple) simple.style.display = 'none';
    root.querySelector('.r2-map-close').style.display = 'flex';
    root.querySelector('.r2-recenter').style.display = 'flex';
    mapOpen = true; following = true;
    if (!map) {
      map = L.map(el, { zoomControl: false, attributionControl: false }).setView(lastCar ? [lastCar.lat, lastCar.lon] : [53.63, 11.41], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
      camLayer = L.layerGroup().addTo(map);
      incLayer = L.layerGroup().addTo(map);
      map.on('moveend', refreshMapData);
      // ручной жест — выключаем слежение, но авто-возврат через 8с (чтобы карта не «отцеплялась» навсегда)
      const refollow = function () { clearTimeout(refollowTimer); refollowTimer = setTimeout(function () { following = true; if (map && lastCar) map.setView([lastCar.lat, lastCar.lon], map.getZoom(), { animate: true }); }, 8000); };
      map.on('dragstart', function () { following = false; });
      map.on('dragend', refollow);
      // зум НЕ выключает слежение — держим машину в центре при уменьшении/увеличении
      map.on('zoomend', function () { if (following && map && lastCar) map.setView([lastCar.lat, lastCar.lon], map.getZoom(), { animate: false }); else refollow(); });
    }
    setTimeout(() => {
      map.invalidateSize();
      if (lastCar) { placeCar(lastCar); map.setView([lastCar.lat, lastCar.lon], 15); }
      else if (navigator.geolocation) {
        // радар не запущен — покажем стрелку по разовому GPS
        navigator.geolocation.getCurrentPosition(function (pos) {
          const t = { lat: pos.coords.latitude, lon: pos.coords.longitude, heading: pos.coords.heading };
          lastCar = lastCar || t;
          if (mapOpen && map) { placeCar(t); map.setView([t.lat, t.lon], 15); }
        }, function () {}, { enableHighAccuracy: true, timeout: 8000 });
      }
      refreshMapData();
    }, 80);
  }

  // поставить/обновить маркер-стрелку на реальном GPS
  function placeCar(t) {
    if (!map || t == null || t.lat == null) return;
    if (!carMarker) carMarker = L.marker([t.lat, t.lon], { icon: carIcon(t.heading), zIndexOffset: 1000, interactive: false }).addTo(map);
    else { carMarker.setLatLng([t.lat, t.lon]); carMarker.setIcon(carIcon(t.heading)); }
  }
  function closeMap() {
    mapOpen = false;
    const wrap = root.querySelector('#r2-map-wrap'); if (wrap) wrap.style.display = 'none';
    if (map && carMarker) { map.removeLayer(carMarker); carMarker = null; }
    const simple = root.querySelector('#r2-simple'); if (simple) simple.style.display = 'flex';
    root.querySelector('.r2-map-close').style.display = 'none';
    root.querySelector('.r2-recenter').style.display = 'none';
  }
  function recenter() { following = true; if (map && lastCar) map.setView([lastCar.lat, lastCar.lon], 16); }

  async function refreshMapData() {
    if (!map || !mapOpen) return;
    const c = map.getCenter();
    // камеры в области карты
    let cams = [];
    try { if (typeof RadarDB !== 'undefined') cams = await RadarDB.nearby(c.lat, c.lng, 4000); } catch (e) {}
    camLayer.clearLayers();
    // схлопываем со-локационные камеры (одна точка в разных направлениях) в один маркер ~40м
    const camSeen = [];
    cams.forEach((cam) => {
      if (camSeen.some((s) => Math.abs(s.lat - cam.lat) < 0.0004 && Math.abs(s.lon - cam.lon) < 0.0004)) return;
      camSeen.push({ lat: cam.lat, lon: cam.lon });
      L.marker([cam.lat, cam.lon], { icon: camIcon(cam) }).addTo(camLayer);
    });
    // ремонты/помехи вокруг центра (видны независимо от движения)
    let inc = [];
    try { if (typeof RadarTraffic !== 'undefined') inc = await RadarTraffic.nearby(c.lat, c.lng, 6); } catch (e) {}
    incLayer.clearLayers();
    inc.forEach((i) => {
      L.marker([i.lat, i.lon], { icon: incIcon(i.category) }).addTo(incLayer).bindTooltip(RadarTraffic.label(i.category));
    });

  }

  function onAlert(al) {
    const a = audio(); if (!a) return;
    let keys = [];
    if (al.priority === 'DANGER') keys = ['cam_200m'];
    else if (al.priority === 'CAMERA') keys = ['cam_' + al.band + 'm'];
    else if (al.priority === 'CONSTRUCTION') keys = ['hazard_work_' + al.band + 'm'];
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
    if (e.target.closest('[data-action="r2-openmap"]')) { openMap(); return; }
    if (e.target.closest('[data-action="r2-closemap"]')) { closeMap(); return; }
    if (e.target.closest('[data-action="r2-recenter"]')) { recenter(); return; }
    if (e.target.closest('[data-action="r2-toggle"]')) {
      const a = audio();
      if (a) { if (a.preload) a.preload(); if (a.unlock) a.unlock(); }
      if (!started) { engine.start(); started = true; window.__rmRadarOn = true; requestWake(); setBtn(true); updateIndicator(true); if (a && a.enqueue) a.enqueue(['system_start']); }
      else { engine.stop(); started = false; window.__rmRadarOn = false; releaseWake(); setBtn(false); updateIndicator(false); }
      return;
    }
  }
  function setBtn(on) { const b = root && root.querySelector('#r2-btn'); if (b) { b.textContent = on ? 'СТОП' : 'СТАРТ'; b.classList.toggle('on', on); } }

  return { mount, unmount };
})();
