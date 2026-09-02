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
  async function load() {
    const list = document.getElementById('au-list');
    if (!list) return;
    try {
      const data = await Api.getActiveUsers();
      const users = data.users || [];
      if (!users.length) { list.innerHTML = '<div class="empty-hint">Нет активных туров сейчас</div>'; return; }
      list.innerHTML = users.map((u) => {
        const pct = u.total ? Math.round(u.done / u.total * 100) : 0;
        return `
        <div class="au-card" data-uid="${u.id}" data-name="${Utils.escapeHtml(u.displayName || u.username)}">
          <div class="au-top">
            <span class="au-dot ${u.online ? 'on' : ''}"></span>
            <span class="au-name">${Utils.escapeHtml(u.displayName || u.username)}</span>
            <span class="au-rate">${u.ratePerHour ? u.ratePerHour + '/ч' : '—'}</span>
          </div>
          <div class="au-bar"><div class="au-bar-fill" style="width:${pct}%"></div></div>
          <div class="au-nums">✓ ${u.done} · осталось ${u.pending} · ✕ ${u.cancelled} · всего ${u.total}</div>
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
  function statusCls(st) { return st === 'done' ? 'done' : (st === 'skip' || st === 'transferred') ? 'cancelled' : 'pending'; }
  function statusLabel(st) { return st === 'done' ? '✓ Выполнено' : st === 'skip' ? '✕ Не еду' : st === 'transferred' ? '↪ Передано' : 'В пути'; }
  async function load() {
    try {
      const d = await Api.getUserDetail(uid);
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
        list.innerHTML = pts.length ? pts.map((p) =>
          '<div class="ud-stop ' + statusCls(p.tourStatus) + '">' +
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
