// RadarEngine: GPS + математика векторов/азимута. Детекция камер/ремонтов в конусе движения.
const RadarEngine = (() => {
  const R = 6371000;
  function toRad(d) { return d * Math.PI / 180; }
  function toDeg(r) { return r * 180 / Math.PI; }

  function haversine(aLat, aLon, bLat, bLon) {
    const dLat = toRad(bLat - aLat), dLon = toRad(bLon - aLon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function bearing(aLat, aLon, bLat, bLon) {
    const y = Math.sin(toRad(bLon - aLon)) * Math.cos(toRad(bLat));
    const x = Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) - Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLon - aLon));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }
  function angleDelta(a, b) { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  function create(opts) {
    opts = opts || {};
    const geo = opts.geolocation || (typeof navigator !== 'undefined' ? navigator.geolocation : null);
    const db = opts.db;                 // RadarDB
    const traffic = opts.traffic;       // RadarTraffic
    const onAlert = opts.onAlert || function () {};
    const onTick = opts.onTick || function () {};  // {lat,lon,heading,speedKmh,lookahead,cameras,incidents}
    const AZIMUTH = opts.azimuth != null ? opts.azimuth : 35; // сектор совпадения направления
    const DEBOUNCE = 20000; // не повторять одну точку чаще 20с

    let watchId = null;
    let prev = null;                    // предыдущая точка {lat,lon,t}
    const headBuf = [], latBuf = [], lonBuf = [];
    const SMOOTH = 4;
    const spoken = new Map();           // id -> last announce time
    let lastTrafficAt = 0, incidents = [];
    let running = false;

    function smooth(buf, v) { buf.push(v); if (buf.length > SMOOTH) buf.shift(); return buf.reduce((a, b) => a + b, 0) / buf.length; }
    function smoothHeading(v) {
      // усреднение угла через векторы (без скачка 359->0)
      headBuf.push(v); if (headBuf.length > SMOOTH) headBuf.shift();
      let sx = 0, sy = 0; for (const h of headBuf) { sx += Math.cos(toRad(h)); sy += Math.sin(toRad(h)); }
      return (toDeg(Math.atan2(sy, sx)) + 360) % 360;
    }

    async function onPos(pos) {
      const c = pos && pos.coords; if (!c) return;
      const now = Date.now();
      let lat = smooth(latBuf, c.latitude);
      let lon = smooth(lonBuf, c.longitude);
      // скорость
      let speedKmh = (c.speed != null && !Number.isNaN(c.speed)) ? c.speed * 3.6 : null;
      // курс: из GPS, иначе по bearing от прошлой точки
      let heading = (c.heading != null && !Number.isNaN(c.heading)) ? c.heading : null;
      if (prev) {
        const d = haversine(prev.lat, prev.lon, lat, lon);
        const dt = (now - prev.t) / 1000;
        if (speedKmh == null && dt > 0) speedKmh = (d / dt) * 3.6;
        if (heading == null && d > 3) heading = bearing(prev.lat, prev.lon, lat, lon);
      }
      if (heading != null) heading = smoothHeading(heading);
      if (speedKmh == null) speedKmh = 0;
      prev = { lat, lon, t: now };

      // радиус упреждения: speed*10 м, но 300..1200
      const lookahead = Math.max(300, Math.min(1200, speedKmh * 10));

      // ── камеры из офлайн-базы ──
      let cameras = [];
      if (db) {
        try { cameras = await db.nearby(lat, lon, lookahead + 200); } catch (e) { cameras = []; }
      }
      const camHits = [];
      for (const cam of cameras) {
        const dist = haversine(lat, lon, cam.lat, cam.lon);
        if (dist > lookahead) continue;
        const brng = bearing(lat, lon, cam.lat, cam.lon);
        // камера впереди по ходу
        if (heading != null && angleDelta(heading, brng) > 60) continue;
        // азимут контроля: если камера направленная — курс должен совпадать с её direction ±AZIMUTH
        if (heading != null && cam.dirType === 1 && cam.direction) {
          if (angleDelta(heading, cam.direction) > AZIMUTH) continue; // встречка/параллель — игнор
        }
        camHits.push({ cam, dist });
      }
      camHits.sort((a, b) => a.dist - b.dist);

      // ── ремонты/пробки из TomTom (раз в 60с подгрузка, кеш 5 мин на прокси) ──
      if (traffic && (now - lastTrafficAt > 60000 || !incidents.length)) {
        lastTrafficAt = now;
        traffic.nearby(lat, lon, Math.max(2, lookahead / 1000 + 1)).then((list) => { incidents = list || []; }).catch(() => {});
      }
      const incHits = [];
      for (const it of incidents) {
        const dist = haversine(lat, lon, it.lat, it.lon);
        if (dist > lookahead) continue;
        const brng = bearing(lat, lon, it.lat, it.lon);
        if (heading != null && angleDelta(heading, brng) > 70) continue;
        incHits.push({ inc: it, dist });
      }
      incHits.sort((a, b) => a.dist - b.dist);

      // ── озвучка ПО ПОРОГАМ: каждый порог (1000/500/200) для точки — ровно один раз ──
      for (let i = 0; i < camHits.length; i++) {
        const cam = camHits[i].cam, dist = camHits[i].dist;
        const band = dist <= 200 ? 200 : dist <= 500 ? 500 : 0; // только 500 и 200 (есть записи)
        if (!band) continue;
        const key = 'c' + cam.idx + '_' + band;
        if (spoken.has(key)) continue;
        spoken.set(key, now);
        const over = cam.speed && speedKmh > cam.speed + 3 && band <= 200;
        onAlert({ priority: over ? 'DANGER' : 'CAMERA', band: band, distance: Math.round(dist), speed: cam.speed, object: cam });
      }
      for (let i = 0; i < incHits.length; i++) {
        const inc = incHits[i].inc, dist = incHits[i].dist;
        const band = dist <= 200 ? 200 : dist <= 500 ? 500 : 0; // стройки: только 500 и 200
        if (!band) continue;
        const key = 'i' + inc.lat.toFixed(4) + inc.lon.toFixed(4) + '_' + band;
        if (spoken.has(key)) continue;
        spoken.set(key, now);
        onAlert({ priority: 'CONSTRUCTION', band: band, distance: Math.round(dist), speed: 0, object: inc });
      }

      onTick({ lat, lon, heading, speedKmh, lookahead, cameras: camHits, incidents: incHits });
    }

    function start() {
      if (!geo || running) return;
      running = true;
      watchId = geo.watchPosition(onPos, function () {}, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
    }
    function stop() {
      running = false;
      if (geo && watchId != null && geo.clearWatch) geo.clearWatch(watchId);
      watchId = null; prev = null; spoken.clear(); headBuf.length = 0; latBuf.length = 0; lonBuf.length = 0;
    }

    return { start, stop, onPos, isRunning: () => running, _util: { haversine, bearing, angleDelta } };
  }

  return { create, haversine, bearing, angleDelta };
})();
