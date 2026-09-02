// АДМИН: активные пользователи (мониторинг курьеров, read-only)
const UIActiveUsers = (() => {
  let root, timer = null;
  function mount(container) {
    root = container;
    root.addEventListener('click', onClick);
    load();
    timer = setInterval(load, 20000);
  }
  function unmount() { if (timer) clearInterval(timer); timer = null; if (root) root.removeEventListener('click', onClick); }
  function onClick(e) {
    if (e.target.closest('[data-action="back-home"]')) { Router.show('home'); return; }
    if (e.target.closest('[data-action="refresh-active"]')) { load(); return; }
    const card = e.target.closest('[data-uid]');
    if (card) Router.show('user-detail', { id: card.dataset.uid, name: card.dataset.name });
  }
  function ago(ts) {
    if (!ts) return 'нет данных';
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return 'только что';
    if (m < 60) return m + ' мин назад';
    return Math.floor(m / 60) + ' ч назад';
  }
  function statusLine(u) {
    if (u.finished) return '✅ Тур завершён' + (u.finishedAt ? ' · ' + ago(u.finishedAt) : '');
    if (u.current) {
      const num = u.current.order != null ? ('№' + u.current.order + ' ') : '';
      return '🚗 В пути: ' + Utils.escapeHtml(num + (u.current.company ? u.current.company + ' — ' : '') + u.current.address);
    }
    if (u.pending === 0) return '✅ Тур завершён';
    return '⏳ Выбирает остановку';
  }

  async function load() {
    const list = document.getElementById('au-list');
    if (!list) return;
    try {
      const data = await Api.getActiveUsers();
      const users = data.users || [];
      if (!users.length) { list.innerHTML = '<div class="empty-hint">Нет активных туров сейчас</div>'; return; }
      list.innerHTML = users.map((u) => {
        const pct = u.total ? Math.round(u.done / u.total * 100) : 0;
        // онлайн и «X назад» считаем от ОДНОГО времени (клиента) — чтобы не противоречили
        const mins = u.presenceAt ? (Date.now() - u.presenceAt) / 60000 : null;
        const online = mins != null && mins < 5;
        return `
        <div class="au-card" data-uid="${u.id}" data-name="${Utils.escapeHtml(u.displayName || u.username)}">
          <div class="au-top">
            <span class="au-dot ${online ? 'on' : ''}"></span>
            <span class="au-name">${Utils.escapeHtml(u.displayName || u.username)}</span>
            <span class="au-rate">${u.ratePerHour ? u.ratePerHour + '/ч' : '—'}</span>
          </div>
          <div class="au-bar"><div class="au-bar-fill" style="width:${pct}%"></div></div>
          <div class="au-nums">✓ ${u.done} · осталось ${u.pending} · ✕ ${u.cancelled} · всего ${u.total}</div>
          <div class="au-status">${statusLine(u)}</div>
          <div class="au-seen">${u.lat != null ? '📍 виден ' + ago(u.presenceAt) : '📍 нет локации'}</div>
        </div>`;
      }).join('');
    } catch (e) {
      list.innerHTML = '<div class="empty-hint">' + (e.status === 403 ? 'Доступ только для админа' : 'Не удалось загрузить') + '</div>';
    }
  }
  return { mount, unmount };
})();

// АДМИН: детали пользователя — локация на карте + read-only список остановок + статы
const UIUserDetail = (() => {
  let root, map = null, marker = null, timer = null, uid = null;
  function mount(container, params) {
    root = container; uid = params.id;
    root.addEventListener('click', onClick);
    const nm = document.getElementById('ud-name'); if (nm && params.name) nm.textContent = params.name;
    initMap();
    load();
    timer = setInterval(load, 20000);
  }
  function unmount() { if (timer) clearInterval(timer); timer = null; if (map) { map.remove(); map = null; } marker = null; if (root) root.removeEventListener('click', onClick); }
  function onClick(e) {
    if (e.target.closest('[data-action="back-active"]')) { Router.show('active-users'); return; }
    if (e.target.closest('[data-action="refresh-detail"]')) { load(); return; }
  }
  function initMap() {
    const el = document.getElementById('ud-map'); if (!el || typeof L === 'undefined') return;
    map = L.map(el, { zoomControl: true, attributionControl: false }).setView([53.63, 11.41], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    setTimeout(() => { if (map) map.invalidateSize(); }, 60);
  }
  function ago(ts) { if (!ts) return ''; const m = Math.floor((Date.now() - ts) / 60000); if (m < 1) return 'только что'; if (m < 60) return m + ' мин назад'; return Math.floor(m / 60) + ' ч назад'; }
  function statusCls(st) { return st === 'done' ? 'done' : (st === 'skip' || st === 'transferred') ? 'cancelled' : 'pending'; }
  function statusLabel(st) { return st === 'done' ? '✓ Выполнено' : st === 'skip' ? '✕ Не еду' : st === 'transferred' ? '↪ Передано' : 'В пути'; }
  async function load() {
    try {
      const d = await Api.getUserDetail(uid);
      const cb = document.getElementById('ud-current');
      if (cb) cb.innerHTML = d.finished
        ? '✅ <b>Тур завершён</b>' + (d.finishedAt ? ' · ' + ago(d.finishedAt) : '')
        : (d.current
          ? '🚗 <b>В пути:</b> ' + (d.current.order != null ? '№' + d.current.order + ' ' : '') + (d.current.company ? Utils.escapeHtml(d.current.company) + ' — ' : '') + Utils.escapeHtml(d.current.address)
          : (d.stats.pending === 0 ? '✅ Тур завершён' : '⏳ Выбирает остановку'));
      const s = document.getElementById('ud-stats');
      if (s) s.innerHTML =
        '<div class="ud-stat"><b>' + d.stats.done + '</b><span>выполнено</span></div>' +
        '<div class="ud-stat"><b>' + d.stats.pending + '</b><span>осталось</span></div>' +
        '<div class="ud-stat"><b>' + d.stats.cancelled + '</b><span>отменено</span></div>' +
        '<div class="ud-stat"><b>' + (d.stats.ratePerHour || '—') + '</b><span>ост./час</span></div>';
      if (map && d.presence && d.presence.lat != null) {
        const ll = [d.presence.lat, d.presence.lng];
        if (!marker) marker = L.marker(ll).addTo(map); else marker.setLatLng(ll);
        map.setView(ll, 14);
      }
      const list = document.getElementById('ud-list');
      if (list) {
        const pts = (d.points || []).slice().sort((a, b) => (a.order == null ? 9999 : a.order) - (b.order == null ? 9999 : b.order));
        const cur = d.current || {};
        list.innerHTML = pts.length ? pts.map((p) =>
          '<div class="ud-stop ' + statusCls(p.tourStatus) + ((cur.address && p.address === cur.address && p.order === cur.order) ? ' current' : '') + '">' +
            '<div class="ud-stop-num">' + (p.order != null ? p.order : '•') + '</div>' +
            '<div class="ud-stop-body">' +
              (p.company ? '<div class="ud-stop-firm">' + Utils.escapeHtml(p.company) + '</div>' : '') +
              '<div class="ud-stop-addr">' + Utils.escapeHtml(p.address) + '</div>' +
              '<div class="ud-stop-status">' + statusLabel(p.tourStatus) + (p.deadline ? ' · ⏰ ' + Utils.escapeHtml(p.deadline) : '') + '</div>' +
            '</div>' +
          '</div>').join('') : '<div class="empty-hint">Нет остановок</div>';
      }
    } catch (e) {
      const list = document.getElementById('ud-list');
      if (list) list.innerHTML = '<div class="empty-hint">' + (e.status === 403 ? 'Только для админа' : 'Не удалось загрузить') + '</div>';
    }
  }
  return { mount, unmount };
})();

// АДМИН: список завершённых туров для просмотра хронологии движения
const UITracking = (() => {
  let root;
  function mount(container) { root = container; root.addEventListener('click', onClick); load(); }
  function unmount() { if (root) root.removeEventListener('click', onClick); }
  function onClick(e) {
    if (e.target.closest('[data-action="back-home"]')) { Router.show('home'); return; }
    if (e.target.closest('[data-action="refresh-tracking"]')) { load(); return; }
    const card = e.target.closest('[data-tour]');
    if (card) Router.show('track-replay', { userId: card.dataset.uid, tourId: card.dataset.tour, name: card.dataset.name });
  }
  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  async function load() {
    const list = document.getElementById('trk-list');
    if (!list) return;
    try {
      const data = await Api.getFinishedTours();
      const tours = data.tours || [];
      if (!tours.length) { list.innerHTML = '<div class="empty-hint">Нет завершённых туров за 2 недели</div>'; return; }
      list.innerHTML = tours.map((t) => `
        <div class="au-card" data-tour="${Utils.escapeHtml(t.tourId)}" data-uid="${t.userId}" data-name="${Utils.escapeHtml(t.displayName)}">
          <div class="au-top"><span class="au-name">${Utils.escapeHtml(t.displayName)}</span><span class="au-rate">${fmtDate(t.finishedAt)}</span></div>
          <div class="au-nums">✓ ${t.done}/${t.total}${t.cancelled ? ' · ✕ ' + t.cancelled : ''} · 🛰 смотреть трек</div>
        </div>`).join('');
    } catch (e) {
      list.innerHTML = '<div class="empty-hint">' + (e.status === 403 ? 'Только для админа' : 'Не удалось загрузить') + '</div>';
    }
  }
  return { mount, unmount };
})();

// АДМИН: проигрывание трека одного тура (GPS-след между точками + остановки)
const UITrackReplay = (() => {
  let root, map = null, lastData = null;
  function mount(container, params) {
    root = container;
    root.addEventListener('click', onClick);
    const nm = document.getElementById('trkr-name'); if (nm && params.name) nm.textContent = params.name;
    initMap();
    load(params.userId, params.tourId);
  }
  function unmount() { if (map) { map.remove(); map = null; } if (root) root.removeEventListener('click', onClick); }
  function onClick(e) {
    if (e.target.closest('[data-action="back-tracking"]')) { Router.show('tracking'); return; }
    if (e.target.closest('[data-action="track-stats"]')) { renderStats(); return; }
  }
  function fmtDur(m) { if (m < 60) return m + ' мин'; return Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин'; }
  function renderStats() {
    const el = document.getElementById('trkr-stats');
    if (!el || !lastData) return;
    if (!el.hidden) { el.hidden = true; return; } // повторный тап — закрыть
    // только реальные таймстампы (мс, с v50+); старый формат отсекаем
    const stops = (lastData.stops || []).filter((p) => p.doneAt && p.doneAt > 940000000000).slice().sort((a, b) => a.doneAt - b.doneAt);
    const started = lastData.startedAt;
    const rows = [];
    let prev = started, prevLabel = 'Старт';
    stops.forEach((p) => {
      const lbl = (p.order != null ? '№' + p.order + ' ' : '') + (p.company || p.address || 'точка');
      if (prev) rows.push({ from: prevLabel, to: lbl, mins: Math.max(0, Math.round((p.doneAt - prev) / 60000)) });
      prev = p.doneAt; prevLabel = lbl;
    });
    // пробег по геолокации (GPS-трек)
    let gpsKm = 0;
    const tr = lastData.track || [];
    for (let i = 1; i < tr.length; i++) {
      if (typeof Utils !== 'undefined' && Utils.haversine) gpsKm += Utils.haversine(tr[i - 1].lat, tr[i - 1].lng, tr[i].lat, tr[i].lng);
    }
    gpsKm = gpsKm / 1000;
    const totalMin = (started && lastData.finishedAt) ? Math.round((lastData.finishedAt - started) / 60000) : null;
    const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.mins, 0) / rows.length) : null;
    let html = '<div class="ts-head">📊 Статистика тура <button class="ts-close" data-action="track-stats">✕</button></div>';
    html += '<div class="ts-sum">';
    if (totalMin != null) html += '<div><b>' + fmtDur(totalMin) + '</b><span>всего</span></div>';
    html += '<div><b>' + stops.length + '</b><span>доставлено</span></div>';
    if (avg != null) html += '<div><b>~' + avg + ' мин</b><span>на точку</span></div>';
    html += '</div>';
    html += '<div class="ts-km">🛰 Пробег по GPS: <b>' + (tr.length > 1 ? gpsKm.toFixed(1) + ' км' : 'нет данных (тур без GPS-трека)') + '</b></div>';
    if (rows.length) {
      html += '<div class="ts-list">' + rows.map((r) => '<div class="ts-row"><span class="ts-seg">' + Utils.escapeHtml(r.from) + ' → ' + Utils.escapeHtml(r.to) + '</span><span class="ts-min">~' + r.mins + ' мин</span></div>').join('') + '</div>';
    } else {
      html += '<div class="ts-empty">Нет данных о времени (тур сделан до обновления или мало отметок)</div>';
    }
    el.innerHTML = html;
    el.hidden = false;
  }
  function initMap() {
    const el = document.getElementById('trkr-map'); if (!el || typeof L === 'undefined') return;
    map = L.map(el, { zoomControl: true, attributionControl: false }).setView([53.63, 11.41], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    setTimeout(() => { if (map) map.invalidateSize(); }, 60);
  }
  function fmtTime(ts) { const d = new Date(ts); const p = (n) => (n < 10 ? '0' + n : '' + n); return p(d.getHours()) + ':' + p(d.getMinutes()); }
  async function load(userId, tourId) {
    const info = document.getElementById('trkr-info');
    try {
      const d = await Api.getTrack(userId, tourId);
      lastData = d;
      const track = d.track || [], stops = d.stops || [];
      const bounds = [];
      // GPS-след (хронология движения)
      if (track.length) {
        const line = track.map((t) => [t.lat, t.lng]);
        L.polyline(line, { color: '#f97316', weight: 3, opacity: 0.9, dashArray: '1,6', lineCap: 'round' }).addTo(map);
        line.forEach((ll) => bounds.push(ll));
        // точки «где всплывал в сети» — маленькие кружки с временем
        track.forEach((t) => {
          L.circleMarker([t.lat, t.lng], { radius: 2.5, color: '#f97316', fillColor: '#f97316', fillOpacity: 0.7, weight: 0 })
            .addTo(map).bindTooltip(fmtTime(t.ts));
        });
        // старт/финиш
        L.marker([track[0].lat, track[0].lng], { icon: L.divIcon({ className: '', html: '<div class="trk-pin start">A</div>', iconSize: [26, 26], iconAnchor: [13, 26] }) }).addTo(map).bindPopup('Старт ' + fmtTime(track[0].ts));
        const lastT = track[track.length - 1];
        L.marker([lastT.lat, lastT.lng], { icon: L.divIcon({ className: '', html: '<div class="trk-pin end">B</div>', iconSize: [26, 26], iconAnchor: [13, 26] }) }).addTo(map).bindPopup('Финиш ' + fmtTime(lastT.ts));
      }
      // остановки тура
      stops.forEach((p) => {
        if (p.lat == null || p.lng == null) return;
        bounds.push([p.lat, p.lng]);
        const cls = p.tourStatus === 'done' ? 'done' : (p.tourStatus === 'skip' || p.tourStatus === 'transferred') ? 'cancelled' : 'pending';
        const label = p.order != null ? p.order : '•';
        L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: '<div class="trk-stop ' + cls + '"><span>' + label + '</span></div>', iconSize: [30, 30], iconAnchor: [15, 30] }), zIndexOffset: 1000 })
          .addTo(map).bindPopup((p.company ? '<b>' + Utils.escapeHtml(p.company) + '</b><br>' : '') + Utils.escapeHtml(p.address) + (p.doneAt ? '<br>✓ ' + fmtTime(p.doneAt) : ''));
      });
      // маршрут ПО ДОРОГАМ через остановки (в порядке маршрута) — синяя линия по улицам
      const ordered = stops.filter((p) => p.lat != null && p.lng != null)
        .slice().sort((a, b) => (a.order == null ? 1e9 : a.order) - (b.order == null ? 1e9 : b.order));
      if (ordered.length >= 2) {
        const coords = ordered.map((p) => p.lng + ',' + p.lat).join(';');
        fetch('https://router.project-osrm.org/route/v1/driving/' + coords + '?overview=full&geometries=geojson')
          .then((r) => r.json())
          .then((data) => {
            if (map && data.code === 'Ok' && data.routes && data.routes[0]) {
              const route = data.routes[0];
              const line = route.geometry.coordinates.map((c) => [c[1], c[0]]);
              L.polyline(line, { color: '#0b1220', weight: 8, opacity: 0.35 }).addTo(map); // обводка для контраста
              const poly = L.polyline(line, { color: '#3b82f6', weight: 5, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }).addTo(map);
              // стрелки направления движения
              if (L.polylineDecorator && L.Symbol && L.Symbol.arrowHead) {
                L.polylineDecorator(poly, { patterns: [{ offset: 30, repeat: 90, symbol: L.Symbol.arrowHead({ pixelSize: 11, polygon: false, pathOptions: { stroke: true, color: '#1e3a8a', weight: 3, opacity: 0.95 } }) }] }).addTo(map);
              }
            }
          }).catch(() => {});
      }
      if (info) info.textContent = track.length ? ('🛰 Реальный GPS-путь: ' + track.length + ' точек · остановок: ' + stops.length) : ('⚠️ GPS-путь не записан (тур до включения записи) — синяя линия это ПЛАН · остановок: ' + stops.length);
      if (bounds.length && map) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    } catch (e) {
      if (info) info.textContent = (e.status === 403 ? 'Только для админа' : 'Не удалось загрузить трек');
    }
  }
  return { mount, unmount };
})();
