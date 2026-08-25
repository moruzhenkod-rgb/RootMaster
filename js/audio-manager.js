// AudioManager: предзагрузка озвучки радар-детектора и последовательное воспроизведение (очередь) —
// если сработали сразу две фразы («камера 500м» + «лимит 50»), они не накладываются друг на друга,
// а проигрываются одна за другой. UMD: глобал AudioManager в браузере, module.exports в Node/Jest.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AudioManager = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BASE_PATH = 'audio/radar/';

  // полный список звуков радар-детектора; каждый ключ = имя файла без расширения в audio/radar/
  const MANIFEST = [
    'system_start', 'system_stop', 'system_gps_lost', 'system_gps_found', 'system_updated',
    'cam_1000m', 'cam_1000m_bus', 'cam_500m', 'cam_500m_red', 'cam_500m_mobile', 'cam_200m',
    'speed_warning', 'limit_30', 'limit_50', 'limit_60', 'limit_70', 'limit_80', 'limit_100',
    'hazard_work_500m', 'hazard_work_200m', 'hazard_accident_500m', 'hazard_accident_200m', 'hazard_bad_road',
  ];

  function createAudioManager(opts) {
    opts = opts || {};
    const AudioCtor = opts.AudioCtor || (typeof Audio !== 'undefined' ? Audio : null);
    const basePath = opts.basePath || BASE_PATH;
    const manifest = opts.manifest || MANIFEST;
    const onFallback = opts.onFallback || function () {}; // вызывается, если для ключа нет загруженного файла

    const elements = new Map(); // key -> предзагруженный шаблонный HTMLAudioElement
    const available = new Set(); // ключи, чей файл реально загрузился
    let queue = [];
    let playing = false;
    let current = null;

    // предзагружает весь манифест; отсутствующие/битые файлы не считаются ошибкой на уровне приложения —
    // такие ключи просто не попадут в available, и speak() воспользуется TTS-фолбэком
    function preload() {
      if (!AudioCtor) return Promise.resolve([]);
      return Promise.all(manifest.map((key) => new Promise((resolve) => {
        let done = false;
        const audio = new AudioCtor(basePath + key + '.mp3');
        audio.preload = 'auto';
        const finish = (ok) => {
          if (done) return;
          done = true;
          if (ok) available.add(key);
          elements.set(key, audio);
          resolve(key);
        };
        if (typeof audio.addEventListener === 'function') {
          audio.addEventListener('canplaythrough', () => finish(true), { once: true });
          audio.addEventListener('loadeddata', () => finish(true), { once: true });
          audio.addEventListener('error', () => finish(false), { once: true });
        } else {
          finish(false);
        }
        if (typeof audio.load === 'function') audio.load();
      })));
    }

    function has(key) { return available.has(key); }

    // ставит один или несколько ключей в очередь; проигрываются строго последовательно
    function enqueue(keys) {
      const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
      queue.push(...list);
      if (!playing) processQueue();
    }

    function processQueue() {
      if (!queue.length) { playing = false; current = null; return undefined; }
      playing = true;
      const key = queue.shift();
      current = key;
      return playOne(key).then(processQueue);
    }

    function playOne(key) {
      return new Promise((resolve) => {
        if (!available.has(key)) { onFallback(key); resolve(); return; }
        const template = elements.get(key);
        const audio = template && typeof template.cloneNode === 'function'
          ? template.cloneNode(true)
          : (AudioCtor ? new AudioCtor(basePath + key + '.mp3') : null);
        if (!audio) { resolve(); return; }
        const finish = () => resolve();
        if (typeof audio.addEventListener === 'function') {
          audio.addEventListener('ended', finish, { once: true });
          audio.addEventListener('error', finish, { once: true });
        }
        const playResult = typeof audio.play === 'function' ? audio.play() : null;
        if (playResult && typeof playResult.catch === 'function') playResult.catch(finish);
        if (typeof audio.addEventListener !== 'function') finish();
      });
    }

    function clear() { queue = []; playing = false; current = null; }
    function getQueue() { return queue.slice(); }
    function isPlaying() { return playing; }
    function getCurrent() { return current; }

    return { MANIFEST: manifest, preload, has, enqueue, playOne, clear, getQueue, isPlaying, getCurrent };
  }

  // единый экземпляр для приложения (браузер) — предзагружается при старте app.js
  let singleton = null;
  function getInstance() {
    if (!singleton) singleton = createAudioManager();
    return singleton;
  }

  return { MANIFEST, BASE_PATH, createAudioManager, getInstance };
});
