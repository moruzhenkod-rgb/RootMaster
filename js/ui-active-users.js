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

// АДМИН: живая карта курьеров (перемещение на карте + трейл)
const UITracking = (() => {
  let root, map = null, timer = null, markers = {}, trails = {}, fitted = false;
  function mount(container) {
    root = container;
    root.addEventListener('click', onClick);
    initMap();
    load();
    timer = setInterval(load, 15000);
  }
  function unmount() {
    if (timer) clearInterval(timer); timer = null;
    if (map) { map.remove(); map = null; }
    markers = {}; trails = {}; fitted = false;
    if (root) root.removeEventListener('click', onClick);
  }
  function onClick(e) {
    if (e.target.closest('[data-action="back-home"]')) { Router.show('home'); return; }
    if (e.target.closest('[data-action="refresh-tracking"]')) { load(); return; }
  }
  function initMap() {
    const el = document.getElementById('trk-map'); if (!el || typeof L === 'undefined') return;
    map = L.map(el, { zoomControl: true, attributionControl: false }).setView([53.63, 11.41], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    setTimeout(() => { if (map) map.invalidateSize(); }, 60);
  }
  function icon(u) {
    const ini = (u.displayName || u.username || '?').slice(0, 2);
    return L.divIcon({ className: '', html: '<div class="trk-marker' + (u.online ? ' on' : '') + '">' + Utils.escapeHtml(ini) + '</div>', iconSize: [36, 36], iconAnchor: [18, 18] });
  }
  async function load() {
    try {
      const data = await Api.getActiveUsers();
      const users = (data.users || []).filter((u) => u.lat != null && u.lng != null);
      const info = document.getElementById('trk-info');
      if (info) info.textContent = users.length ? ('🛰 На карте: ' + users.length) : 'Нет активных курьеров с локацией';
      const seen = new Set();
      const bounds = [];
      users.forEach((u) => {
        const key = String(u.id); seen.add(key);
        const ll = [u.lat, u.lng]; bounds.push(ll);
        // трейл движения (пока экран открыт)
        if (!trails[key]) trails[key] = L.polyline([], { color: '#38bdf8', weight: 3, opacity: 0.55 }).addTo(map);
        const pts = trails[key].getLatLngs();
        const last = pts[pts.length - 1];
        if (!last || last.lat !== u.lat || last.lng !== u.lng) { pts.push(L.latLng(ll)); if (pts.length > 40) pts.shift(); trails[key].setLatLngs(pts); }
        // маркер + попап
        const pop = '<b>' + Utils.escapeHtml(u.displayName || u.username) + '</b><br>✓ ' + u.done + '/' + u.total + (u.current ? '<br>🚗 ' + Utils.escapeHtml(u.current.address) : '');
        if (!markers[key]) markers[key] = L.marker(ll, { icon: icon(u) }).addTo(map).bindPopup(pop);
        else markers[key].setLatLng(ll).setIcon(icon(u)).setPopupContent(pop);
      });
      // убрать тех, кто пропал (завершил тур)
      Object.keys(markers).forEach((key) => {
        if (!seen.has(key)) { map.removeLayer(markers[key]); delete markers[key]; if (trails[key]) { map.removeLayer(trails[key]); delete trails[key]; } }
      });
      if (bounds.length && !fitted) { map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 }); fitted = true; }
    } catch (e) {
      const info = document.getElementById('trk-info');
      if (info) info.textContent = (e.status === 403 ? 'Только для админа' : 'Ошибка загрузки');
    }
  }
  return { mount, unmount };
})();
