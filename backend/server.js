// RouteMaster API — простой бэкенд: регистрация, вход, хранение туров по профилю
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8090;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'routemaster.db');
// секрет для JWT: из env или генерируем и держим в памяти (перелогин при рестарте — не страшно)
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL = '180d';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tours (
    user_id INTEGER PRIMARY KEY,
    current_tour TEXT,
    history TEXT,
    updated_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    addr_key TEXT NOT NULL,
    address TEXT NOT NULL,
    company TEXT,
    akey TEXT,
    lat REAL,
    lng REAL,
    seen_count INTEGER DEFAULT 1,
    updated_at INTEGER,
    UNIQUE(user_id, addr_key)
  );
`);
try { db.exec('ALTER TABLE clients ADD COLUMN manual INTEGER DEFAULT 0'); } catch (e) { /* уже есть */ }
try { db.exec('ALTER TABLE clients ADD COLUMN cell TEXT'); } catch (e) { /* уже есть */ }
try { db.exec('ALTER TABLE clients ADD COLUMN last_order INTEGER'); } catch (e) { /* уже есть */ }

// нормализация адреса для сопоставления (убираем регистр и пунктуацию)
function normAddr(a) {
  return String(a || '').toLowerCase().replace(/[^0-9a-zа-яё]+/gi, ' ').trim();
}

// запомнить клиентов из точек тура (upsert по нормализованному адресу)
const getClient = db.prepare('SELECT lat, lng, manual, cell, last_order FROM clients WHERE user_id = ? AND addr_key = ?');
const upsertClient = db.prepare(`
  INSERT INTO clients (user_id, addr_key, address, company, akey, cell, lat, lng, manual, last_order, seen_count, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  ON CONFLICT(user_id, addr_key) DO UPDATE SET
    address = excluded.address,
    company = COALESCE(NULLIF(excluded.company, ''), clients.company),
    akey = COALESCE(NULLIF(excluded.akey, ''), clients.akey),
    cell = COALESCE(NULLIF(excluded.cell, ''), clients.cell),
    lat = excluded.lat,
    lng = excluded.lng,
    manual = excluded.manual,
    last_order = COALESCE(excluded.last_order, clients.last_order),
    seen_count = clients.seen_count + 1,
    updated_at = excluded.updated_at
`);
function rememberClients(userId, points) {
  if (!Array.isArray(points)) return;
  const tx = db.transaction((pts) => {
    for (const p of pts) {
      if (!p || !p.editedText) continue;
      const key = normAddr(p.editedText);
      if (!key) continue;
      const existing = getClient.get(userId, key);
      let lat, lng, manual;
      if (p.manualCoords) {
        // подтверждённая ручная позиция — запоминаем навсегда
        lat = p.lat; lng = p.lng; manual = 1;
      } else if (existing && existing.manual) {
        // у клиента уже закреплённая позиция — не затираем авто-геокодом
        lat = existing.lat; lng = existing.lng; manual = 1;
      } else {
        lat = p.lat == null ? null : p.lat;
        lng = p.lng == null ? null : p.lng;
        manual = 0;
      }
      const lastOrder = (p.order != null && p.order !== '') ? p.order : null;
      upsertClient.run(userId, key, p.editedText, p.company || '', p.key || '', p.cell || '', lat, lng, manual, lastOrder, Date.now());
    }
  });
  tx(points);
}

const app = express();
app.use(express.json({ limit: '5mb' }));

// --- helpers ---
function normUser(u) {
  return String(u || '').trim().toLowerCase();
}
function makeToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Нет токена' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}

// --- routes ---
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/register', (req, res) => {
  const username = normUser(req.body.username);
  const displayName = String(req.body.displayName || '').trim();
  const password = String(req.body.password || '');
  if (username.length < 3) return res.status(400).json({ error: 'Логин минимум 3 символа' });
  if (!displayName) return res.status(400).json({ error: 'Укажите отображаемое имя' });
  if (password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'Такой логин уже занят' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(username, displayName, hash, Date.now());
  const user = { id: info.lastInsertRowid, username, display_name: displayName };
  res.json({ token: makeToken(user), username, displayName });
});

app.post('/api/login', (req, res) => {
  const username = normUser(req.body.username);
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  res.json({ token: makeToken(user), username: user.username, displayName: user.display_name });
});

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(req.user.uid);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ username: user.username, displayName: user.display_name });
});

app.get('/api/tours', auth, (req, res) => {
  const row = db.prepare('SELECT current_tour, history FROM tours WHERE user_id = ?').get(req.user.uid);
  res.json({
    current: row && row.current_tour ? JSON.parse(row.current_tour) : null,
    history: row && row.history ? JSON.parse(row.history) : [],
  });
});

app.put('/api/tours', auth, (req, res) => {
  const current = req.body.current != null ? JSON.stringify(req.body.current) : null;
  const history = Array.isArray(req.body.history) ? JSON.stringify(req.body.history) : '[]';
  db.prepare(
    `INSERT INTO tours (user_id, current_tour, history, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET current_tour = excluded.current_tour, history = excluded.history, updated_at = excluded.updated_at`
  ).run(req.user.uid, current, history, Date.now());
  // запоминаем клиентов из текущего тура и истории
  try {
    if (req.body.current && Array.isArray(req.body.current.points)) rememberClients(req.user.uid, req.body.current.points);
    if (Array.isArray(req.body.history)) {
      req.body.history.forEach((h) => { if (h && Array.isArray(h.points)) rememberClients(req.user.uid, h.points); });
    }
  } catch (e) { console.warn('rememberClients failed', e.message); }
  res.json({ ok: true });
});

// список запомненных клиентов (для автозамены и предложений)
app.get('/api/clients', auth, (req, res) => {
  const rows = db.prepare(
    'SELECT address, company, akey, cell, lat, lng, manual, last_order, seen_count FROM clients WHERE user_id = ? ORDER BY seen_count DESC, updated_at DESC'
  ).all(req.user.uid);
  res.json({
    clients: rows.map((r) => ({ address: r.address, company: r.company || '', key: r.akey || '', cell: r.cell || '', lat: r.lat, lng: r.lng, manual: !!r.manual, order: r.last_order, seen: r.seen_count })),
  });
});

app.listen(PORT, () => console.log(`RouteMaster API on :${PORT}`));
