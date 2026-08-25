const RadarModule = require('./radar-module.js');
const { createAudioManager } = require('./audio-manager.js');

const EARTH_RADIUS_M = 6371000;
// смещение по широте (в градусах) на заданную дистанцию в метрах, строго на север —
// для чистого смещения по широте формула Haversine сводится к точной длине дуги (без погрешности)
function metersToDegLat(m) {
  return (m / EARTH_RADIUS_M) * (180 / Math.PI);
}

function carAtDistanceNorth(hazard, meters) {
  return { lat: hazard.lat + metersToDegLat(meters), lon: hazard.lon };
}

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

// ---------------------------------------------------------------------
// Фейковый HTMLAudioElement — эмулирует события canplaythrough/error/ended под контролем теста
// ---------------------------------------------------------------------
function makeFakeAudioCtor(behavior, onPlay) {
  // behavior(key) -> 'ok' | 'missing' — управляет тем, какие файлы «загрузились»
  return function FakeAudio(src) {
    const key = src.replace(/^.*\//, '').replace(/\.mp3$/, '');
    this.src = src;
    this._key = key;
    this._listeners = {};
    this.preload = null;
    this.load = () => {
      const ok = behavior(key) !== 'missing';
      fireAsync(this, ok ? 'canplaythrough' : 'error');
    };
    this.addEventListener = (type, cb, opts) => {
      this._listeners[type] = this._listeners[type] || [];
      this._listeners[type].push({ cb, once: !!(opts && opts.once) });
    };
    this.removeEventListener = () => {};
    this.cloneNode = () => new FakeAudio(src);
    this.play = () => {
      if (onPlay) onPlay(key);
      const ok = behavior(key) !== 'missing';
      if (ok) {
        fireAsync(this, 'ended');
        return Promise.resolve();
      }
      fireAsync(this, 'error');
      return Promise.reject(new Error('no source'));
    };
  };
}

function fireAsync(target, type) {
  Promise.resolve().then(() => {
    const list = (target._listeners[type] || []).slice();
    list.forEach(({ cb, once }) => {
      cb();
      if (once) {
        target._listeners[type] = target._listeners[type].filter((l) => l.cb !== cb);
      }
    });
  });
}

describe('haversineDistance / bearing / angleDelta', () => {
  test('точное смещение по широте даёт точную дистанцию (обратная формула)', () => {
    const hazard = { lat: 55.0, lon: 37.0 };
    const car = carAtDistanceNorth(hazard, 500);
    const dist = RadarModule.haversineDistance(car.lat, car.lon, hazard.lat, hazard.lon);
    expect(dist).toBeCloseTo(500, 3);
  });

  test('машина строго севернее объекта — азимут к нему приблизительно 180° (юг)', () => {
    const hazard = { lat: 55.0, lon: 37.0 };
    const car = carAtDistanceNorth(hazard, 300);
    const brng = RadarModule.bearing(car.lat, car.lon, hazard.lat, hazard.lon);
    expect(brng).toBeCloseTo(180, 1);
  });

  test('angleDelta считает кратчайшую разницу углов', () => {
    expect(RadarModule.angleDelta(10, 350)).toBeCloseTo(20, 5);
    expect(RadarModule.angleDelta(0, 180)).toBeCloseTo(180, 5);
  });
});

describe('isHazardAhead — фильтрация по азимуту движения', () => {
  test('объект впереди (малый угол) — не фильтруется', () => {
    expect(RadarModule.isHazardAhead(180, 180)).toBe(true);
    expect(RadarModule.isHazardAhead(180, 190)).toBe(true);
  });

  test('объект сбоку/сзади (угол > 35°) — игнорируется', () => {
    expect(RadarModule.isHazardAhead(180, 270)).toBe(false);
    expect(RadarModule.isHazardAhead(180, 0)).toBe(false);
  });

  test('без курса (heading == null, машина стоит) — не фильтруем', () => {
    expect(RadarModule.isHazardAhead(null, 45)).toBe(true);
  });
});

describe('describeUIState — состояния UI (СТАРТ / загрузка / зелёные шевроны)', () => {
  test('idle — большой красный круг с текстом СТАРТ', () => {
    const ui = RadarModule.describeUIState('idle');
    expect(ui.showLabel).toBe(true);
    expect(ui.showSpinner).toBe(false);
    expect(ui.showChevrons).toBe(false);
  });

  test('loading — индикатор загрузки', () => {
    const ui = RadarModule.describeUIState('loading');
    expect(ui.showSpinner).toBe(true);
    expect(ui.showLabel).toBe(false);
  });

  test('active — зелёные шевроны вместо круга', () => {
    const ui = RadarModule.describeUIState('active');
    expect(ui.showChevrons).toBe(true);
    expect(ui.showLabel).toBe(false);
  });
});

// ---------------------------------------------------------------------
// 1. Очередь воспроизведения AudioManager — комбинированные фразы играются по порядку, без наложения
// ---------------------------------------------------------------------
describe('AudioManager — очередь воспроизведения', () => {
  test('предзагружает манифест и помечает реально доступные файлы', async () => {
    const am = createAudioManager({ AudioCtor: makeFakeAudioCtor((key) => (key === 'hazard_bad_road' ? 'missing' : 'ok')) });
    await am.preload();
    expect(am.has('cam_500m')).toBe(true);
    expect(am.has('hazard_bad_road')).toBe(false); // файла нет в манифесте voice/ — фолбэк на TTS выше по стеку
  });

  test('cam_500m и limit_50, поставленные одновременно, проигрываются последовательно в порядке постановки', async () => {
    const order = [];
    const am = createAudioManager({ AudioCtor: makeFakeAudioCtor(() => 'ok', (key) => order.push(key)) });
    await am.preload();

    am.enqueue(['cam_500m', 'limit_50']);
    expect(am.getQueue()).toEqual(['limit_50']); // cam_500m уже выбран из очереди и играет

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(order).toEqual(['cam_500m', 'limit_50']);
    expect(am.isPlaying()).toBe(false);
  });

  test('отсутствующий файл вызывает onFallback и не блокирует очередь', async () => {
    const fallbacks = [];
    const am = createAudioManager({
      AudioCtor: makeFakeAudioCtor((key) => (key === 'speed_warning' ? 'missing' : 'ok')),
      onFallback: (key) => fallbacks.push(key),
    });
    await am.preload();
    am.enqueue(['speed_warning', 'cam_200m']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fallbacks).toEqual(['speed_warning']);
  });
});

// ---------------------------------------------------------------------
// 2. Парсер Overpass (OpenStreetMap) — сырые данные -> массив камер
// ---------------------------------------------------------------------
describe('Overpass — построение запроса и парсинг ответа', () => {
  test('buildOverpassQuery формирует bbox-запрос по трём тегам без ключей/подписок', () => {
    const bbox = { south: 55.0, west: 37.0, north: 55.2, east: 37.3 };
    const query = RadarModule.buildOverpassQuery(bbox);
    expect(query).toContain('speed_camera');
    expect(query).toContain('surveillance');
    expect(query).toContain('bus_stop');
    expect(query).toContain('55,37,55.2,37.3'.replace(/\s/g, ''));
  });

  test('parseOverpassElements преобразует сырые node в нормализованные опасности', () => {
    const raw = {
      elements: [
        { type: 'node', id: 111, lat: 55.75, lon: 37.6, tags: { highway: 'speed_camera', maxspeed: '60' } },
        { type: 'node', id: 222, lat: 55.76, lon: 37.61, tags: { man_made: 'surveillance' } },
        { type: 'node', id: 333, lat: 55.77, lon: 37.62, tags: { highway: 'bus_stop' } },
        { type: 'way', id: 444, tags: { highway: 'speed_camera' } }, // не node — игнорируется
      ],
    };
    const hazards = RadarModule.parseOverpassElements(raw);
    expect(hazards).toHaveLength(3);
    expect(hazards[0]).toMatchObject({ id: 'osm-111', type: 'camera', lat: 55.75, lon: 37.6, maxspeed: 60 });
    expect(hazards[1]).toMatchObject({ id: 'osm-222', type: 'camera' });
    expect(hazards[2]).toMatchObject({ id: 'osm-333', type: 'bus_stop' });
  });

  test('computeBBox строит прямоугольник вокруг текущей позиции курьера', () => {
    const bbox = RadarModule.computeBBox({ lat: 55.75, lon: 37.6 }, 15);
    expect(bbox.south).toBeLessThan(55.75);
    expect(bbox.north).toBeGreaterThan(55.75);
    expect(bbox.west).toBeLessThan(37.6);
    expect(bbox.east).toBeGreaterThan(37.6);
  });

  test('defaultFetchHazardsOverpass шлёт POST на публичный Overpass API и возвращает распарсенные камеры', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [{ type: 'node', id: 1, lat: 1, lon: 2, tags: { highway: 'speed_camera' } }] }),
    });
    const hazards = await RadarModule.defaultFetchHazardsOverpass(
      { south: 0, west: 0, north: 1, east: 1 },
      { fetch: fetchMock }
    );
    expect(fetchMock).toHaveBeenCalledWith('https://overpass-api.de/api/interpreter', expect.objectContaining({ method: 'POST' }));
    expect(hazards).toHaveLength(1);
    expect(hazards[0].type).toBe('camera');
  });
});

// ---------------------------------------------------------------------
// 3. Интервал обновления базы: не чаще раза в 3 часа, офлайн-фолбэк на последнюю сохранённую базу
// ---------------------------------------------------------------------
describe('formatLastUpdate — текст «когда обновлялась база камер» на экране радара', () => {
  test('нет данных — ещё ни разу не обновлялась', () => {
    expect(RadarModule.formatLastUpdate(null, 1000)).toBe('нет данных');
  });

  test('меньше минуты назад', () => {
    expect(RadarModule.formatLastUpdate(1000, 1000 + 30 * 1000)).toBe('обновлено только что');
  });

  test('несколько минут назад', () => {
    expect(RadarModule.formatLastUpdate(0, 5 * 60 * 1000)).toBe('обновлено 5 мин назад');
  });

  test('несколько часов назад', () => {
    expect(RadarModule.formatLastUpdate(0, 2 * 60 * 60 * 1000)).toBe('обновлено 2 ч назад');
  });

  test('больше суток назад — конкретная дата', () => {
    const ts = new Date(2026, 0, 5, 10, 0, 0).getTime();
    const now = new Date(2026, 0, 8, 10, 0, 0).getTime();
    expect(RadarModule.formatLastUpdate(ts, now)).toBe('обновлено 05.01');
  });
});

describe('onMetaChange — статус базы камер (обновляется/когда обновилась) для UI', () => {
  test('во время скачивания приходит updating:true, после — updating:false и свежий updatedAt', async () => {
    const dbAdapter = RadarModule.memoryDbAdapter();
    let currentTime = 1000;
    let resolveFetch;
    const fetchHazards = jest.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const radar = RadarModule.createRadar({ speak: jest.fn(), fetchHazards, dbAdapter, now: () => currentTime });

    const metaEvents = [];
    radar.onMetaChange((m) => metaEvents.push({ ...m }));

    const p = radar.ensureHazards({ lat: 55.7, lon: 37.6 });
    await Promise.resolve(); // даём ensureHazards дойти до updating=true
    expect(radar.isUpdating()).toBe(true);
    expect(metaEvents[0]).toEqual({ updatedAt: null, updating: true });

    resolveFetch([{ id: 'osm-1', type: 'camera', lat: 1, lon: 1 }]);
    await p;

    expect(radar.isUpdating()).toBe(false);
    expect(radar.getLastUpdate()).toBe(1000);
    expect(metaEvents[metaEvents.length - 1]).toEqual({ updatedAt: 1000, updating: false });
  });

  test('при офлайне после устаревания updatedAt откатывается к последней успешной метке, а не обнуляется', async () => {
    const dbAdapter = RadarModule.memoryDbAdapter();
    let currentTime = 1000;
    const fetchHazards = jest.fn()
      .mockResolvedValueOnce([{ id: 'osm-1', type: 'camera', lat: 1, lon: 1 }])
      .mockRejectedValueOnce(new Error('offline'));
    const radar = RadarModule.createRadar({ speak: jest.fn(), fetchHazards, dbAdapter, now: () => currentTime });

    await radar.ensureHazards({ lat: 55.7, lon: 37.6 });
    const firstUpdate = radar.getLastUpdate();
    expect(firstUpdate).toBe(1000);

    currentTime += RadarModule.REFRESH_INTERVAL_MS + 1;
    await radar.ensureHazards({ lat: 55.7, lon: 37.6 });

    expect(radar.getLastUpdate()).toBe(firstUpdate); // сеть недоступна — метка не обновилась, но и не пропала
  });
});

describe('syncMeta — статус базы камер виден сразу на экране, без нажатия СТАРТ', () => {
  test('подтягивает уже сохранённую метку из dbAdapter без сети (fetchHazards не вызывается)', async () => {
    const dbAdapter = RadarModule.memoryDbAdapter();
    await dbAdapter.setHazards([{ id: 'osm-1', type: 'camera', lat: 1, lon: 1 }], 5000);
    const fetchHazards = jest.fn();
    const radar = RadarModule.createRadar({ speak: jest.fn(), fetchHazards, dbAdapter, now: () => 9000 });

    const hazards = await radar.syncMeta();

    expect(fetchHazards).not.toHaveBeenCalled();
    expect(hazards).toHaveLength(1);
    expect(radar.getLastUpdate()).toBe(5000);
  });

  test('нет сохранённой базы — статус «нет данных», без ошибок', async () => {
    const radar = RadarModule.createRadar({ speak: jest.fn(), dbAdapter: RadarModule.memoryDbAdapter(), now: () => 1000 });
    await radar.syncMeta();
    expect(radar.getLastUpdate()).toBe(null);
    expect(RadarModule.formatLastUpdate(radar.getLastUpdate())).toBe('нет данных');
  });
});

describe('refreshNow — ручное обновление базы по кнопке, независимо от таймера 3ч и состояния детектора', () => {
  test('игнорирует то, что 3 часа ещё не прошли — качает заново по требованию пользователя', async () => {
    const dbAdapter = RadarModule.memoryDbAdapter();
    let currentTime = 1000;
    const fetchHazards = jest.fn()
      .mockResolvedValueOnce([{ id: 'osm-1', type: 'camera', lat: 1, lon: 1 }])
      .mockResolvedValueOnce([{ id: 'osm-2', type: 'camera', lat: 2, lon: 2 }]);
    const radar = RadarModule.createRadar({
      speak: jest.fn(), fetchHazards, dbAdapter, now: () => currentTime,
      getCurrentPosition: () => Promise.resolve({ lat: 55.7, lon: 37.6 }),
    });

    await radar.ensureHazards({ lat: 55.7, lon: 37.6 });
    currentTime += 1000; // всего секунда прошла — далеко не 3 часа

    const hazards = await radar.refreshNow();
    expect(fetchHazards).toHaveBeenCalledTimes(2);
    expect(hazards).toEqual([{ id: 'osm-2', type: 'camera', lat: 2, lon: 2 }]);
    expect(radar.getLastUpdate()).toBe(2000);
  });

  test('работает и когда детектор ещё не запущен (idle) — не требует start()', async () => {
    const dbAdapter = RadarModule.memoryDbAdapter();
    const fetchHazards = jest.fn().mockResolvedValue([{ id: 'osm-1', type: 'camera', lat: 1, lon: 1 }]);
    const radar = RadarModule.createRadar({
      speak: jest.fn(), fetchHazards, dbAdapter, now: () => 1000,
      getCurrentPosition: () => Promise.resolve({ lat: 55.7, lon: 37.6 }),
    });

    expect(radar.getState()).toBe('idle');
    await radar.refreshNow();
    expect(radar.getState()).toBe('idle'); // не переводит в active сам по себе
    expect(radar.getLastUpdate()).toBe(1000);
  });

  test('нет координат GPS — бросает ошибку, updating сбрасывается, старые данные не теряются', async () => {
    const dbAdapter = RadarModule.memoryDbAdapter();
    await dbAdapter.setHazards([{ id: 'osm-1', type: 'camera', lat: 1, lon: 1 }], 500);
    const radar = RadarModule.createRadar({
      speak: jest.fn(), dbAdapter, now: () => 1000,
      getCurrentPosition: () => Promise.resolve(null),
    });
    await radar.syncMeta();

    await expect(radar.refreshNow()).rejects.toThrow();
    expect(radar.isUpdating()).toBe(false);
    expect(radar.getLastUpdate()).toBe(500); // осталась прежняя метка, не обнулилась
  });

  test('повторный вызов, пока уже идёт обновление, не запускает второй запрос параллельно', async () => {
    const dbAdapter = RadarModule.memoryDbAdapter();
    let resolveFetch;
    const fetchHazards = jest.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const radar = RadarModule.createRadar({
      speak: jest.fn(), fetchHazards, dbAdapter, now: () => 1000,
      getCurrentPosition: () => Promise.resolve({ lat: 55.7, lon: 37.6 }),
    });

    const p1 = radar.refreshNow();
    await Promise.resolve();
    const p2 = radar.refreshNow(); // уже updating=true — должен просто вернуть текущее состояние, не дёргая fetch снова

    resolveFetch([{ id: 'osm-1', type: 'camera', lat: 1, lon: 1 }]);
    await Promise.all([p1, p2]);

    expect(fetchHazards).toHaveBeenCalledTimes(1);
  });
});

describe('ensureHazards — обновление базы раз в 3 часа через dbAdapter (IndexedDB в проде)', () => {
  test('повторный вызов в пределах 3ч не дёргает Overpass снова', async () => {
    const dbAdapter = RadarModule.memoryDbAdapter();
    let currentTime = 1000;
    const fetchHazards = jest.fn().mockResolvedValue([{ id: 'osm-1', type: 'camera', lat: 1, lon: 1 }]);
    const radar = RadarModule.createRadar({
      speak: jest.fn(),
      fetchHazards,
      dbAdapter,
      now: () => currentTime,
    });

    await radar.ensureHazards({ lat: 55.7, lon: 37.6 });
    expect(fetchHazards).toHaveBeenCalledTimes(1);

    currentTime += RadarModule.REFRESH_INTERVAL_MS - 1; // почти 3 часа спустя
    await radar.ensureHazards({ lat: 55.7, lon: 37.6 });
    expect(fetchHazards).toHaveBeenCalledTimes(1); // всё ещё из IndexedDB-кэша
  });

  test('после 3 часов база скачивается заново', async () => {
    const dbAdapter = RadarModule.memoryDbAdapter();
    let currentTime = 1000;
    const fetchHazards = jest.fn().mockResolvedValue([]);
    const radar = RadarModule.createRadar({
      speak: jest.fn(),
      fetchHazards,
      dbAdapter,
      now: () => currentTime,
    });

    await radar.ensureHazards({ lat: 55.7, lon: 37.6 });
    currentTime += RadarModule.REFRESH_INTERVAL_MS + 1;
    await radar.ensureHazards({ lat: 55.7, lon: 37.6 });

    expect(fetchHazards).toHaveBeenCalledTimes(2);
  });

  test('нет сети при обновлении — используется последняя сохранённая в dbAdapter база, ошибка не пробрасывается', async () => {
    const dbAdapter = RadarModule.memoryDbAdapter();
    let currentTime = 1000;
    const fetchHazards = jest.fn()
      .mockResolvedValueOnce([{ id: 'osm-1', type: 'camera', lat: 1, lon: 1 }])
      .mockRejectedValueOnce(new Error('network down'));
    const radar = RadarModule.createRadar({ speak: jest.fn(), fetchHazards, dbAdapter, now: () => currentTime });

    await radar.ensureHazards({ lat: 55.7, lon: 37.6 });
    currentTime += RadarModule.REFRESH_INTERVAL_MS + 1;
    const hazards = await radar.ensureHazards({ lat: 55.7, lon: 37.6 });

    expect(hazards).toEqual([{ id: 'osm-1', type: 'camera', lat: 1, lon: 1 }]);
  });
});

// ---------------------------------------------------------------------
// 4. Триггеры озвучки: эмуляция движения к камере на 1000/500/200м
// ---------------------------------------------------------------------
describe('createRadar().start()/stop() — переход состояний и системные фразы', () => {
  test('idle -> loading -> active, старт озвучивается как system_start', async () => {
    const speak = jest.fn();
    const radar = RadarModule.createRadar({
      speak,
      fetchHazards: jest.fn().mockResolvedValue([]),
      dbAdapter: RadarModule.memoryDbAdapter(),
      now: () => 0,
      geolocation: null,
      getCurrentPosition: () => Promise.resolve(null),
      setInterval: () => null,
      clearInterval: () => {},
    });

    const states = [];
    radar.onStateChange((s) => states.push(s));

    await radar.start();

    expect(states).toEqual(['loading', 'active']);
    expect(speak).toHaveBeenCalledWith(['system_start']);
  });

  test('stop() озвучивает system_stop и возвращает в idle', async () => {
    const speak = jest.fn();
    const radar = RadarModule.createRadar({
      speak,
      fetchHazards: jest.fn().mockResolvedValue([]),
      dbAdapter: RadarModule.memoryDbAdapter(),
      now: () => 0,
      geolocation: null,
      getCurrentPosition: () => Promise.resolve(null),
    });
    await radar.start();
    radar.stop();
    expect(radar.getState()).toBe('idle');
    expect(speak).toHaveBeenLastCalledWith(['system_stop']);
  });
});

describe('checkHazards — ступенчатые предупреждения по дистанции с реальными аудио-ключами', () => {
  function setupRadar(hazardOverrides) {
    const speak = jest.fn();
    const radar = RadarModule.createRadar({
      speak,
      fetchHazards: jest.fn().mockResolvedValue([]),
      dbAdapter: RadarModule.memoryDbAdapter(),
      now: () => 0,
    });
    const hazard = Object.assign({ id: 'cam-1', type: 'camera', lat: 55.0, lon: 37.0 }, hazardOverrides);
    radar._setHazards([hazard]);
    return { radar, speak, hazard };
  }

  test('1200м — ещё рано, озвучки нет', () => {
    const { radar, speak, hazard } = setupRadar();
    const car = carAtDistanceNorth(hazard, 1200);
    radar.checkHazards(car.lat, car.lon, 180);
    expect(speak).not.toHaveBeenCalled();
  });

  test('1000м -> 500м -> 200м — реальные mp3-ключи cam_1000m/cam_500m/cam_200m по очереди', () => {
    const { radar, speak, hazard } = setupRadar();

    let car = carAtDistanceNorth(hazard, 999);
    radar.checkHazards(car.lat, car.lon, 180);
    expect(speak).toHaveBeenLastCalledWith(['cam_1000m']);

    car = carAtDistanceNorth(hazard, 499);
    radar.checkHazards(car.lat, car.lon, 180);
    expect(speak).toHaveBeenLastCalledWith(['cam_500m']);

    car = carAtDistanceNorth(hazard, 199);
    radar.checkHazards(car.lat, car.lon, 180);
    expect(speak).toHaveBeenLastCalledWith(['cam_200m']);

    expect(speak).toHaveBeenCalledTimes(3);
  });

  test('500м с известным ограничением скорости добавляет limit_X к очереди', () => {
    const { radar, speak, hazard } = setupRadar({ maxspeed: 50 });
    const car = carAtDistanceNorth(hazard, 499);
    radar.checkHazards(car.lat, car.lon, 180);
    expect(speak).toHaveBeenLastCalledWith(['cam_500m', 'limit_50']);
  });

  test('200м с превышением скорости добавляет speed_warning', () => {
    const { radar, speak, hazard } = setupRadar({ maxspeed: 50 });
    let car = carAtDistanceNorth(hazard, 999);
    radar.checkHazards(car.lat, car.lon, 180, 40);
    car = carAtDistanceNorth(hazard, 499);
    radar.checkHazards(car.lat, car.lon, 180, 40);
    car = carAtDistanceNorth(hazard, 199);
    radar.checkHazards(car.lat, car.lon, 180, 70); // едет быстрее лимита 50
    expect(speak).toHaveBeenLastCalledWith(['cam_200m', 'speed_warning']);
  });

  test('200м без превышения — speed_warning не добавляется', () => {
    const { radar, speak, hazard } = setupRadar({ maxspeed: 50 });
    const car = carAtDistanceNorth(hazard, 199);
    radar.checkHazards(car.lat, car.lon, 180, 45);
    expect(speak).toHaveBeenLastCalledWith(['cam_200m']);
  });

  test('авария/дорожные работы используют свои ключи hazard_*', () => {
    const { radar: radarAccident, speak: speakAccident, hazard: accident } = setupRadar({ type: 'accident' });
    let car = carAtDistanceNorth(accident, 499);
    radarAccident.checkHazards(car.lat, car.lon, 180);
    expect(speakAccident).toHaveBeenLastCalledWith(['hazard_accident_500m']);

    const { radar: radarWorks, speak: speakWorks, hazard: works } = setupRadar({ type: 'roadworks' });
    car = carAtDistanceNorth(works, 199);
    radarWorks.checkHazards(car.lat, car.lon, 180);
    expect(speakWorks).toHaveBeenLastCalledWith(['hazard_work_200m']);
  });

  test('защита от спама: повторный вызов на той же дистанции не дублирует фразу', () => {
    const { radar, speak, hazard } = setupRadar();
    const car = carAtDistanceNorth(hazard, 999);
    radar.checkHazards(car.lat, car.lon, 180);
    radar.checkHazards(car.lat, car.lon, 180);
    expect(speak).toHaveBeenCalledTimes(1);
  });

  test('камера сбоку/сзади (угол > 35°) игнорируется даже на 200м', () => {
    const { radar, speak, hazard } = setupRadar();
    const car = carAtDistanceNorth(hazard, 200);
    radar.checkHazards(car.lat, car.lon, 0);
    expect(speak).not.toHaveBeenCalled();
  });

  test('полный проезд маршрута GPS-точками: 1000 -> 500 -> 200 срабатывают по порядку ровно один раз каждая', () => {
    const { radar, speak, hazard } = setupRadar({ maxspeed: 60 });
    const distances = [1500, 1000, 700, 500, 350, 200, 100];
    distances.forEach((d) => {
      const car = carAtDistanceNorth(hazard, d);
      radar.checkHazards(car.lat, car.lon, 180, 55);
    });
    const calledWith = speak.mock.calls.map((c) => c[0]);
    expect(calledWith).toEqual([
      ['cam_1000m'],
      ['cam_500m', 'limit_60'],
      ['cam_200m'],
    ]);
  });
});
