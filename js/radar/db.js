// RadarDB: офлайн-база камер (CSV iGO/Speedcam -> IndexedDB) + spatial hashing для быстрого поиска рядом.
// CSV: IDX,X,Y,TYPE,SPEED,DIRTYPE,DIRECTION  (X=lon, Y=lat)
const RadarDB = (() => {
  const DB_NAME = 'rm_radar_v2';
  const STORE = 'cameras';
  const META = 'meta';
  const CELL = 0.02;
  const DEFAULT_CSV = 'data/speedcams.csv';
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) {
          const os = d.createObjectStore(STORE, { keyPath: 'idx' });
          os.createIndex('cell', 'cell', { unique: false });
        }
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: 'k' });
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  function cellKey(lat, lon) { return Math.floor(lat / CELL) + '_' + Math.floor(lon / CELL); }

  function parseCsv(text) {
    const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    let start = /idx/i.test(lines[0]) ? 1 : 0;
    const out = [];
    for (let i = start; i < lines.length; i++) {
      const p = lines[i].split(/[,;]/);
      if (p.length < 3) continue;
      const idx = parseInt(p[0], 10);
      const lon = parseFloat(p[1]);
      const lat = parseFloat(p[2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      out.push({
        idx: Number.isFinite(idx) ? idx : out.length + 1,
        lat, lon,
        type: p[3] != null ? parseInt(p[3], 10) || 1 : 1,
        speed: p[4] != null ? parseInt(p[4], 10) || 0 : 0,
        dirType: p[5] != null ? parseInt(p[5], 10) || 0 : 0,
        direction: p[6] != null ? parseInt(p[6], 10) || 0 : 0,
        cell: cellKey(lat, lon),
      });
    }
    return out;
  }

  async function count() {
    const d = await open();
    return new Promise((resolve) => {
      const r = d.transaction(STORE, 'readonly').objectStore(STORE).count();
      r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(0);
    });
  }

  async function importCsv(text, sourceName) {
    const cams = parseCsv(text);
    const d = await open();
    await new Promise((resolve, reject) => {
      const tx = d.transaction([STORE, META], 'readwrite');
      const os = tx.objectStore(STORE);
      os.clear();
      for (const c of cams) os.put(c);
      tx.objectStore(META).put({ k: 'imported', at: Date.now(), count: cams.length, source: sourceName || 'csv' });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    return cams.length;
  }

  async function ensureLoaded() {
    const c = await count();
    if (c > 0) return c;
    try {
      const res = await fetch(DEFAULT_CSV);
      if (res.ok) { const txt = await res.text(); return await importCsv(txt, DEFAULT_CSV); }
    } catch (e) {}
    return 0;
  }

  async function nearby(lat, lon, radiusM) {
    const d = await open();
    const dLat = radiusM / 111320;
    const dLon = radiusM / ((111320 * Math.cos(lat * Math.PI / 180)) || 1);
    const cLatMin = Math.floor((lat - dLat) / CELL), cLatMax = Math.floor((lat + dLat) / CELL);
    const cLonMin = Math.floor((lon - dLon) / CELL), cLonMax = Math.floor((lon + dLon) / CELL);
    const idx = d.transaction(STORE, 'readonly').objectStore(STORE).index('cell');
    const cells = [];
    for (let a = cLatMin; a <= cLatMax; a++) for (let b = cLonMin; b <= cLonMax; b++) cells.push(a + '_' + b);
    const results = await Promise.all(cells.map((ck) => new Promise((resolve) => {
      const r = idx.getAll(ck);
      r.onsuccess = () => resolve(r.result || []); r.onerror = () => resolve([]);
    })));
    return [].concat.apply([], results);
  }

  async function meta() {
    const d = await open();
    return new Promise((resolve) => {
      const r = d.transaction(META, 'readonly').objectStore(META).get('imported');
      r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null);
    });
  }

  return { open, parseCsv, importCsv, ensureLoaded, nearby, count, meta, cellKey };
})();
