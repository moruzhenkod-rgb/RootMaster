// Радар-Детектор: чистый модуль без прямых зависимостей от DOM/браузера —
// все побочные эффекты (геолокация, озвучка через AudioManager, IndexedDB, сеть) внедряются через опции,
// поэтому модуль одинаково работает в браузере (<script src="js/radar-module.js">, глобал RadarModule)
// и в Node/Jest (module.exports) без сборки.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RadarModule = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EARTH_RADIUS_M = 6371000;
  const HEADING_MAX_ANGLE = 60; // курс уже, чем это — считаем объект «впереди»
  const REFRESH_INTERVAL_MS = 3 * 60 * 60 * 1000; // база камер обновляется не чаще раза в 3 часа
  const DEFAULT_RADIUS_KM = 15;
  const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ];
  const OVERPASS_ENDPOINT = OVERPASS_ENDPOINTS[0];
  const KNOWN_LIMITS = [30, 50, 60, 70, 80, 100];
  const THRESHOLD_DISTS = [1000, 500, 200];

  function toRad(deg) { return (deg * Math.PI) / 180; }

  // расстояние между двумя точками по формуле Haversine, метры
  function haversineDistance(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // азимут от точки 1 к точке 2, градусы 0..360
  function bearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  // минимальная разница между двумя углами, 0..180
  function angleDelta(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  // объект «впереди по курсу»: без курса (heading == null, GPS стоит на месте) не фильтруем
  function isHazardAhead(heading, hazardBearing, maxAngle) {
    maxAngle = maxAngle == null ? HEADING_MAX_ANGLE : maxAngle;
    if (heading == null || Number.isNaN(heading)) return true;
    return angleDelta(heading, hazardBearing) <= maxAngle;
  }

  function hazardLabel(type) {
    if (type === 'accident') return 'авария';
    if (type === 'roadworks') return 'дорожные работы';
    if (type === 'bus_stop') return 'автобусная/выделенная полоса';
    return 'камера контроля скорости';
  }

  // текст «когда последний раз обновлялась база камер» для UI — чистая функция, без Date.now() внутри
  function formatLastUpdate(ts, nowMs) {
    if (ts == null) return 'нет данных';
    const n = nowMs == null ? Date.now() : nowMs;
    const diffMin = Math.floor((n - ts) / 60000);
    if (diffMin < 1) return 'обновлено только что';
    if (diffMin < 60) return 'обновлено ' + diffMin + ' мин назад';
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return 'обновлено ' + diffH + ' ч назад';
    const d = new Date(ts);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return 'обновлено ' + dd + '.' + mm;
  }

  // отображение состояния детектора в параметры UI (без прямого обращения к DOM — тестируется чисто)
  function describeUIState(state) {
    switch (state) {
      case 'loading':
        return { label: 'Загрузка карт…', showLabel: false, showSpinner: true, showChevrons: false, statusText: 'Загрузка карт…' };
      case 'active':
        return { label: 'СТАРТ', showLabel: false, showSpinner: false, showChevrons: true, statusText: 'Детектор активен' };
      default:
        return { label: 'СТАРТ', showLabel: true, showSpinner: false, showChevrons: false, statusText: 'Детектор выключен' };
    }
  }

  // ---------------------------------------------------------------------
  // Аудио-ключи: соответствие «дистанция + тип опасности» -> ключ файла в AudioManager.MANIFEST
  // ---------------------------------------------------------------------

  function audioKeyForThreshold(hazard, thresholdDist) {
    const type = hazard.type;
    if (thresholdDist === 1000) {
      if (type === 'roadworks' || type === 'accident') return null; // нет отдельного файла на 1000м
      return type === 'bus_stop' ? 'cam_1000m_bus' : 'cam_1000m';
    }
    if (thresholdDist === 500) {
      if (type === 'accident') return 'hazard_accident_500m';
      if (type === 'roadworks') return 'hazard_work_500m';
      if (type === 'bus_stop') return 'cam_500m_mobile';
      if (hazard.mobile) return 'cam_500m_mobile';
      if (hazard.redLight) return 'cam_500m_red';
      return 'cam_500m';
    }
    if (thresholdDist === 200) {
      if (type === 'accident') return 'hazard_accident_200m';
      if (type === 'roadworks') return 'hazard_work_200m';
      return 'cam_200m';
    }
    return null;
  }

  function limitAudioKey(maxspeed) {
    if (!maxspeed || KNOWN_LIMITS.indexOf(maxspeed) === -1) return null;
    return 'limit_' + maxspeed;
  }

  // текстовый фолбэк для SpeechSynthesis, когда конкретного mp3 нет в манифесте/не загрузился
  const TTS_FALLBACK_TEXT = {
    system_start: 'Соединение установлено',
    system_stop: 'Радар-детектор выключен',
    system_gps_lost: 'Сигнал GPS потерян',
    system_gps_found: 'Сигнал GPS восстановлен',
    system_updated: 'База камер обновлена',
    cam_1000m: 'Через 1000 метров камера контроля скорости',
    cam_1000m_bus: 'Через 1000 метров пост на автобусной полосе',
    cam_500m: 'Внимание, камера контроля скорости 500 метров',
    cam_500m_red: 'Внимание, камера на светофоре 500 метров',
    cam_500m_mobile: 'Внимание, передвижной пост 500 метров',
    cam_200m: 'Камера контроля скорости, 200 метров, снизьте скорость',
    speed_warning: 'Превышение скорости, снизьте скорость',
    limit_30: 'Ограничение 30 километров в час',
    limit_50: 'Ограничение 50 километров в час',
    limit_60: 'Ограничение 60 километров в час',
    limit_70: 'Ограничение 70 километров в час',
    limit_80: 'Ограничение 80 километров в час',
    limit_100: 'Ограничение 100 километров в час',
    hazard_work_500m: 'Дорожные работы через 500 метров',
    hazard_work_200m: 'Дорожные работы, 200 метров',
    hazard_accident_500m: 'Авария через 500 метров',
    hazard_accident_200m: 'Авария, 200 метров',
    hazard_bad_road: 'Внимание, плохое покрытие',
  };

  function speakSynth(text) {
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ru-RU';
    window.speechSynthesis.speak(u);
  }

  // проигрывает реальные записанные mp3 через глобальный AudioManager (очередь, без наложения фраз);
  // если конкретного файла нет в манифесте/не загрузился — фолбэк на синтетический голос для этого ключа
  function defaultSpeak(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    const manager = typeof window !== 'undefined' ? window.AudioManagerInstance : null;
    list.filter(Boolean).forEach((key) => {
      if (manager && typeof manager.has === 'function' && manager.has(key)) {
        manager.enqueue(key);
      } else {
        speakSynth(TTS_FALLBACK_TEXT[key] || key);
      }
    });
  }

  // ---------------------------------------------------------------------
  // Overpass API (OpenStreetMap) — реальная бесплатная база камер/постов без ключей и платных подписок
  // ---------------------------------------------------------------------

  function overpassHazardType(tags) {
    tags = tags || {};
    if (tags.highway === 'speed_camera') return 'camera';
    if (tags.enforcement === 'maxspeed') return 'camera';
    if (tags.highway === 'construction') return 'roadworks';
    if (tags.man_made === 'surveillance') return 'camera';
    return 'camera';
  }

  function buildOverpassQuery(bbox, opts) {
    opts = opts || {};
    const timeout = opts.timeout || 25;
    const bboxStr = [bbox.south, bbox.west, bbox.north, bbox.east].join(',');
    return (
      '[out:json][timeout:' + timeout + '];(' +
      'node["highway"="speed_camera"](' + bboxStr + ');' +
      'node["enforcement"="maxspeed"](' + bboxStr + ');' +
      'way["enforcement"="maxspeed"](' + bboxStr + ');' +
      'relation["enforcement"="maxspeed"](' + bboxStr + ');' +
      'node["man_made"="surveillance"]["surveillance:type"="camera"]["surveillance:zone"="traffic"](' + bboxStr + ');' +
      'way["highway"="construction"](' + bboxStr + ');' +
      'node["highway"="construction"](' + bboxStr + ');' +
      'relation["highway"="construction"](' + bboxStr + ');' +
      'way["construction:highway"](' + bboxStr + ');' +
      ');out center;'
    );
  }

  // сырой ответ Overpass -> нормализованный массив опасностей {id, type, lat, lon, maxspeed}
  function parseOverpassElements(json) {
    const elements = (json && json.elements) || [];
    return elements
      .filter((el) => el && (typeof el.lat === 'number' || (el.center && typeof el.center.lat === 'number')))
      .map((el) => {
        const tags = el.tags || {};
        const lat = typeof el.lat === 'number' ? el.lat : el.center.lat;
        const lon = typeof el.lon === 'number' ? el.lon : el.center.lon;
        const maxspeedRaw = tags.maxspeed ? parseInt(tags.maxspeed, 10) : null;
        return {
          id: 'osm-' + (el.type || 'n') + '-' + el.id,
          type: overpassHazardType(tags),
          lat: lat,
          lon: lon,
          maxspeed: Number.isFinite(maxspeedRaw) ? maxspeedRaw : null,
          mobile: tags['camera:type'] === 'mobile' || tags.enforcement === 'mobile' || null,
          redLight: tags['camera:type'] === 'red_light' || null,
          source: 'osm',
        };
      })
      .filter((h) => h.type !== 'bus_stop');
  }

  // прямоугольник lat/lon вокруг центра радиусом radiusKm — bbox для Overpass-запроса
  function computeBBox(center, radiusKm) {
    const lat = center.lat, lon = center.lon;
    const dLat = ((radiusKm * 1000) / EARTH_RADIUS_M) * (180 / Math.PI);
    const dLon = dLat / Math.cos(toRad(lat));
    return { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon };
  }

  // прямой запрос к публичному Overpass API (OSM) — без ключей, без платных сервисов
  async function defaultFetchHazardsOverpass(bbox, opts) {
    opts = opts || {};
    const fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl || !bbox) return [];
    const query = buildOverpassQuery(bbox);
    let lastErr = null;
    for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
      try {
        const res = await fetchImpl(OVERPASS_ENDPOINTS[i], {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: query,
        });
        if (!res.ok) { lastErr = new Error('overpass ' + res.status); continue; }
        const json = await res.json();
        return parseOverpassElements(json);
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('overpass failed');
  }

  // ---------------------------------------------------------------------
  // Хранилище базы камер: IndexedDB в браузере (переживает офлайн/перезапуск), in-memory — в тестах
  // ---------------------------------------------------------------------

  function memoryDbAdapter() {
    let state = { items: [], updatedAt: 0 };
    return {
      async getHazards() { return state.items; },
      async getLastUpdate() { return state.updatedAt; },
      async setHazards(items, ts) { state = { items: items || [], updatedAt: ts }; },
    };
  }

  function indexedDbAdapter(dbName) {
    dbName = dbName || 'rm_radar_db';
    const STORE = 'hazards';

    function openDb() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('indexedDB недоступен')); return; }
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async function getHazards() {
      try {
        const db = await openDb();
        return await new Promise((resolve) => {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get('items');
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        });
      } catch (e) { return []; }
    }

    async function getLastUpdate() {
      try {
        const db = await openDb();
        return await new Promise((resolve) => {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get('updatedAt');
          req.onsuccess = () => resolve(req.result || 0);
          req.onerror = () => resolve(0);
        });
      } catch (e) { return 0; }
    }

    async function setHazards(items, ts) {
      try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(items || [], 'items');
          tx.objectStore(STORE).put(ts, 'updatedAt');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch (e) { /* приватный режим/квота — просто не сохраняем, в памяти данные всё равно есть */ }
    }

    return { getHazards, getLastUpdate, setHazards };
  }

  function getCurrentPositionAsync(geolocation) {
    return new Promise((resolve) => {
      if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') { resolve(null); return; }
      geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    });
  }

  // ---------------------------------------------------------------------
  // Экземпляр радара. Все зависимости опциональны и подменяются в тестах.
  // ---------------------------------------------------------------------

  function createRadar(opts) {
    opts = opts || {};
    const speak = opts.speak || defaultSpeak;
    const now = opts.now || (() => Date.now());
    const fetchHazards = opts.fetchHazards || defaultFetchHazardsOverpass;
    const geolocation = opts.geolocation || (typeof navigator !== 'undefined' ? navigator.geolocation : null);
    const headingMaxAngle = opts.headingMaxAngle || HEADING_MAX_ANGLE;
    const radiusKm = opts.radiusKm || DEFAULT_RADIUS_KM;
    const refreshIntervalMs = opts.refreshIntervalMs || REFRESH_INTERVAL_MS;
    const dbAdapter = opts.dbAdapter || (typeof indexedDB !== 'undefined' ? indexedDbAdapter() : memoryDbAdapter());
    const getCurrentPosition = opts.getCurrentPosition || (() => getCurrentPositionAsync(geolocation));
    const setIntervalFn = opts.setInterval || ((typeof setInterval !== 'undefined') ? setInterval : null);
    const clearIntervalFn = opts.clearInterval || ((typeof clearInterval !== 'undefined') ? clearInterval : null);

    let state = 'idle'; // idle | loading | active
    let hazards = [];
    let watchId = null;
    let refreshTimer = null;
    let gpsLost = false;
    let announced = new Set(); // `${hazardId}:${thresholdDist}` — защита от повторной озвучки
    let primed = false; // при старте засеиваем уже-близкие камеры, чтобы не вываливать всё сразу
    let lastFetchCenter = null; // центр загруженной зоны камер (для подгрузки по движению)
    let lastMoveFetchAt = 0;
    let listeners = [];
    let hazardsListeners = [];
    let posListeners = [];
    let metaListeners = [];
    let lastPosition = null;
    let lastUpdatedAt = null; // timestamp последнего успешного обновления базы (из dbAdapter/Overpass)
    let updating = false; // true — прямо сейчас идёт запрос к Overpass (первый старт или фоновое обновление раз в 3ч)

    function setState(next) {
      state = next;
      listeners.forEach((cb) => { try { cb(state); } catch (e) { /* noop */ } });
    }

    function onStateChange(cb) {
      listeners.push(cb);
      return () => { listeners = listeners.filter((x) => x !== cb); };
    }

    function onHazardsChange(cb) {
      hazardsListeners.push(cb);
      return () => { hazardsListeners = hazardsListeners.filter((x) => x !== cb); };
    }

    function onPosition(cb) {
      posListeners.push(cb);
      return () => { posListeners = posListeners.filter((x) => x !== cb); };
    }

    // подписка на метаданные базы камер: {updatedAt, updating} — когда данные последний раз
    // реально обновлялись с Overpass и не идёт ли обновление прямо сейчас
    function onMetaChange(cb) {
      metaListeners.push(cb);
      return () => { metaListeners = metaListeners.filter((x) => x !== cb); };
    }

    function emitHazards() {
      hazardsListeners.forEach((cb) => { try { cb(hazards.slice()); } catch (e) { /* noop */ } });
    }

    function emitMeta() {
      const meta = { updatedAt: lastUpdatedAt, updating };
      metaListeners.forEach((cb) => { try { cb(meta); } catch (e) { /* noop */ } });
    }

    function emitPosition(p) {
      lastPosition = p;
      posListeners.forEach((cb) => { try { cb(p); } catch (e) { /* noop */ } });
    }

    // подтягивает базу камер: из IndexedDB, если свежая (< 3ч), иначе скачивает заново через Overpass;
    // при ошибке сети — молча остаётся на последней сохранённой базе (офлайн-режим)
    async function ensureHazards(center, force) {
      const lastUpdate = await dbAdapter.getLastUpdate();
      const stale = force || !lastUpdate || (now() - lastUpdate) >= refreshIntervalMs;
      if (!stale) {
        hazards = await dbAdapter.getHazards();
        lastUpdatedAt = lastUpdate;
        emitHazards();
        emitMeta();
        return hazards;
      }
      if (!center) {
        hazards = await dbAdapter.getHazards();
        lastUpdatedAt = lastUpdate || null;
        emitHazards();
        emitMeta();
        return hazards;
      }
      updating = true;
      emitMeta();
      try {
        const bbox = computeBBox(center, radiusKm);
        const fresh = await fetchHazards(bbox);
        hazards = fresh || [];
        const ts = now();
        await dbAdapter.setHazards(hazards, ts);
        lastUpdatedAt = ts;
        lastFetchCenter = center;
        if (lastUpdate) speak(['system_updated']);
      } catch (e) {
        hazards = await dbAdapter.getHazards();
        lastUpdatedAt = lastUpdate || null; // сеть недоступна — оставляем метку последнего успешного обновления
      }
      updating = false;
      emitHazards();
      emitMeta();
      return hazards;
    }

    // читает уже сохранённые в dbAdapter данные без сети — чтобы показать «обновлено N назад»
    // на экране радара сразу при заходе, ещё до нажатия СТАРТ
    async function syncMeta() {
      const [items, ts] = await Promise.all([dbAdapter.getHazards(), dbAdapter.getLastUpdate()]);
      hazards = items || [];
      lastUpdatedAt = ts || null;
      emitHazards();
      emitMeta();
      return hazards;
    }

    // принудительное обновление базы по кнопке «Обновить» — игнорирует таймер 3ч, работает и в idle, и в active
    async function refreshNow() {
      if (updating) return hazards;
      updating = true;
      emitMeta();
      try {
        const center = await getCurrentPosition();
        if (!center) throw new Error('Нет координат GPS — включите геолокацию');
        const bbox = computeBBox(center, radiusKm);
        const fresh = await fetchHazards(bbox);
        hazards = fresh || [];
        const ts = now();
        await dbAdapter.setHazards(hazards, ts);
        lastUpdatedAt = ts;
        speak(['system_updated']);
        return hazards;
      } finally {
        updating = false;
        emitHazards();
        emitMeta();
      }
    }

    async function start() {
      primed = false;
      if (state === 'loading' || state === 'active') return;
      setState('loading');
      const center = await getCurrentPosition();
      await ensureHazards(center, true);
      speak(['system_start']);
      setState('active');
      gpsLost = false;
      if (geolocation && typeof geolocation.watchPosition === 'function') {
        watchId = geolocation.watchPosition(handlePosition, handlePositionError, { enableHighAccuracy: true, maximumAge: 2000 });
      }
      if (refreshTimer == null && setIntervalFn) {
        refreshTimer = setIntervalFn(() => { getCurrentPosition().then(ensureHazards); }, refreshIntervalMs);
      }
    }

    function stop() {
      if (geolocation && watchId != null && typeof geolocation.clearWatch === 'function') {
        geolocation.clearWatch(watchId);
      }
      watchId = null;
      if (refreshTimer != null && clearIntervalFn) { clearIntervalFn(refreshTimer); }
      refreshTimer = null;
      announced = new Set();
      gpsLost = false;
      speak(['system_stop']);
      setState('idle');
    }

    function handlePositionError() {
      if (!gpsLost) { gpsLost = true; speak(['system_gps_lost']); }
    }

    function handlePosition(pos) {
      const c = pos && pos.coords;
      if (!c) return;
      if (gpsLost) { gpsLost = false; speak(['system_gps_found']); }
      const speedKmh = c.speed != null && !Number.isNaN(c.speed) ? c.speed * 3.6 : null;
      emitPosition({ lat: c.latitude, lon: c.longitude, heading: c.heading, speedKmh });
      // при первом фиксе — пометить уже-близкие камеры «озвученными» (без звука), чтобы не болтать при запуске
      if (!primed && hazards.length) {
        hazards.forEach((h) => {
          THRESHOLD_DISTS.forEach((td) => {
            if (td <= 200) return; // ближний порог не глушим — близкую камеру всегда озвучиваем
            const ck = audioKeyForThreshold(h, td);
            if (ck && haversineDistance(c.latitude, c.longitude, h.lat, h.lon) <= td) {
              announced.add(h.id + ':' + td);
            }
          });
        });
        primed = true;
      }
      // подгрузка камер по движению: отъехали от центра зоны — дотягиваем впереди (не чаще раза в минуту)
      if (lastFetchCenter) {
        const dCenter = haversineDistance(c.latitude, c.longitude, lastFetchCenter.lat, lastFetchCenter.lon);
        if (dCenter > radiusKm * 1000 * 0.6 && !updating && (now() - lastMoveFetchAt) > 60000) {
          lastMoveFetchAt = now();
          ensureHazards({ lat: c.latitude, lon: c.longitude }, true);
        }
      }
      checkHazards(c.latitude, c.longitude, c.heading, speedKmh);
    }

    // основная проверка — вызывается на каждое обновление позиции (и напрямую из тестов)
    function checkHazards(lat, lon, heading, speedKmh) {
      const triggered = [];
      hazards.forEach((h) => {
        const dist = haversineDistance(lat, lon, h.lat, h.lon);
        THRESHOLD_DISTS.forEach((thresholdDist) => {
          const key = h.id + ':' + thresholdDist;
          if (dist <= thresholdDist && !announced.has(key)) {
            // уведомляем о ЛЮБОЙ камере в радиусе — без учёта направления/полосы
            const camKey = audioKeyForThreshold(h, thresholdDist);
            // реагируем ТОЛЬКО на камеры (блиц): без лимитов скорости, аварий и дорожных работ
            if (!camKey || camKey.indexOf('cam_') !== 0) return;
            announced.add(key);
            speak([camKey]);
            triggered.push({ hazard: h, thresholdDist, distance: dist, audioKeys: [camKey] });
          }
        });
      });
      return triggered;
    }

    return {
      start,
      stop,
      getState: () => state,
      onStateChange,
      onHazardsChange,
      onPosition,
      onMetaChange,
      ensureHazards,
      syncMeta,
      refreshNow,
      checkHazards,
      getHazards: () => hazards.slice(),
      getLastPosition: () => lastPosition,
      getLastUpdate: () => lastUpdatedAt,
      isUpdating: () => updating,
      // тестовые/служебные хелперы
      _setHazards: (list) => { hazards = list || []; },
      _getHazards: () => hazards,
      _resetAnnounced: () => { announced = new Set(); },
    };
  }

  return {
    haversineDistance,
    bearing,
    angleDelta,
    isHazardAhead,
    hazardLabel,
    describeUIState,
    formatLastUpdate,
    THRESHOLD_DISTS,
    HEADING_MAX_ANGLE,
    REFRESH_INTERVAL_MS,
    DEFAULT_RADIUS_KM,
    KNOWN_LIMITS,
    TTS_FALLBACK_TEXT,
    audioKeyForThreshold,
    limitAudioKey,
    buildOverpassQuery,
    parseOverpassElements,
    overpassHazardType,
    computeBBox,
    defaultFetchHazardsOverpass,
    memoryDbAdapter,
    indexedDbAdapter,
    createRadar,
    speak: defaultSpeak,
  };
});
