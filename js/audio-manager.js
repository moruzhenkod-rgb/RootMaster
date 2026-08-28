// AudioManager: озвучка радар-детектора через Web Audio API (AudioContext) —
// короткие сигналы как «звуковой эффект» поверх фона (навигатор/музыка), НЕ как медиа-плеер:
// не перехватывает медиа-сессию iOS, не лезет в контролы, минимальная задержка. Очередь — без наложения фраз.
// UMD: глобал AudioManager в браузере, module.exports в Node/Jest.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AudioManager = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BASE_PATH = 'audio/radar/';
  const OUTPUT_GAIN = 7.0; // усиление сигнала — громче фоновой музыки/навигатора
  const MANIFEST = [
    'system_start', 'system_stop', 'system_gps_lost', 'system_gps_found', 'system_updated',
    'cam_1000m', 'cam_1000m_bus', 'cam_500m', 'cam_500m_red', 'cam_500m_mobile', 'cam_200m',
    'speed_warning', 'limit_30', 'limit_50', 'limit_60', 'limit_70', 'limit_80', 'limit_100',
    'hazard_work_500m', 'hazard_work_200m', 'hazard_accident_500m', 'hazard_accident_200m', 'hazard_bad_road',
  ];

  function createAudioManager(opts) {
    opts = opts || {};
    const basePath = opts.basePath || BASE_PATH;
    const manifest = opts.manifest || MANIFEST;
    const onFallback = opts.onFallback || function () {};
    const fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    const ACtor = opts.AudioContext ||
      (typeof AudioContext !== 'undefined' ? AudioContext :
        (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null));

    let ctx = null;
    let outNode = null;
    let volume = (opts.gain != null ? opts.gain : OUTPUT_GAIN); // усилитель+компрессор перед выходом
    const buffers = new Map(); // key -> AudioBuffer
    const available = new Set();
    let queue = [];
    let playing = false;
    let current = null;

    function ensureCtx() {
      if (ctx || !ACtor) return ctx;
      try {
        ctx = new ACtor();
        // усиление + компрессор: громко и чётко, без клиппинга/хрипа
        const gain = ctx.createGain();
        gain.gain.value = volume;
        let tail = gain;
        if (typeof ctx.createDynamicsCompressor === 'function') {
          const comp = ctx.createDynamicsCompressor();
          try {
            comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 16;
            comp.attack.value = 0.003; comp.release.value = 0.15;
          } catch (e) {}
          gain.connect(comp); tail = comp;
        }
        tail.connect(ctx.destination);
        outNode = gain;
      } catch (e) { ctx = null; outNode = null; }
      return ctx;
    }

    function decode(arrayBuffer) {
      return new Promise((resolve, reject) => {
        // старый iOS требует колбэк-форму decodeAudioData
        try {
          const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
          if (p && typeof p.then === 'function') p.then(resolve, reject);
        } catch (e) { reject(e); }
      });
    }

    function preload() {
      ensureCtx();
      if (!ctx || !fetchImpl) return Promise.resolve([]);
      return Promise.all(manifest.map(function (key) {
        if (available.has(key)) return Promise.resolve(key);
        return fetchImpl(basePath + key + '.mp3')
          .then(function (res) { return res && res.ok ? res.arrayBuffer() : null; })
          .then(function (arr) { return arr ? decode(arr) : null; })
          .then(function (buf) { if (buf) { buffers.set(key, buf); available.add(key); } return key; })
          .catch(function () { return key; });
      }));
    }

    function has(key) { return available.has(key); }

    // разблокировка/возобновление AudioContext — вызвать из пользовательского жеста (кнопка СТАРТ)
    function unlock() {
      ensureCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(function () {});
      try {
        const b = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.connect(ctx.destination);
        src.start(0);
      } catch (e) {}
    }

    function enqueue(keys) {
      const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
      queue.push.apply(queue, list);
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
      return new Promise(function (resolve) {
        if (!ctx || !available.has(key)) { onFallback(key); resolve(); return; }
        const doPlay = function () {
          try {
            const src = ctx.createBufferSource();
            src.buffer = buffers.get(key);
            src.connect(outNode || ctx.destination);
            src.onended = function () { resolve(); };
            src.start(0);
          } catch (e) { resolve(); }
        };
        // iOS усыпляет AudioContext — ДОЖДАТЬСЯ resume перед проигрыванием, иначе тишина при живом экране
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
          ctx.resume().then(doPlay).catch(doPlay);
        } else {
          doPlay();
        }
      });
    }

    function setVolume(v) { v = Math.max(0, Math.min(30, Number(v) || 0)); volume = v; if (outNode) { try { outNode.gain.value = v; } catch (e) {} } }
    function getVolume() { return volume; }
    function resume() { ensureCtx(); if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(function () {}); }
    function clear() { queue = []; playing = false; current = null; }
    function getQueue() { return queue.slice(); }
    function isPlaying() { return playing; }
    function getCurrent() { return current; }

    return { MANIFEST: manifest, preload, has, enqueue, playOne, clear, getQueue, isPlaying, getCurrent, unlock, setVolume, getVolume, resume };
  }

  let singleton = null;
  function getInstance() {
    if (!singleton) singleton = createAudioManager();
    return singleton;
  }

  return { MANIFEST, BASE_PATH, createAudioManager, getInstance };
});
