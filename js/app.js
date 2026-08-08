// Global app state & bootstrap
const App = (() => {
  let tour = null;

  function setTour(newTour, stage) {
    tour = newTour;
    if (stage) tour.stage = stage;
    saveTour();
  }

  function saveTour() {
    if (tour) Storage.saveCurrent(tour);
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        reg.update();
        setInterval(() => reg.update(), 60 * 1000);
      }).catch((e) => console.warn('SW registration failed', e));
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });
    });
  }

  function enrichFromClients() {
    let clients = [];
    try { clients = JSON.parse(localStorage.getItem('rm_clients') || '[]'); } catch (e) { return; }
    if (!clients.length || !tour || !tour.points) return;
    const norm = (a) => String(a || '').toLowerCase().replace(/[^0-9a-zа-яё]+/gi, ' ').trim();
    const byAddr = {};
    clients.forEach((c) => { byAddr[norm(c.address)] = c; });
    let changed = false;
    tour.points.forEach((p) => {
      const c = byAddr[norm(p.editedText)];
      if (!c) return;
      if (!p.cell && c.cell) { p.cell = c.cell; changed = true; }
      if (!p.key && c.key) { p.key = c.key; changed = true; }
      if (!p.company && c.company) { p.company = c.company; changed = true; }
      if (!p.manualCoords && c.manual && c.lat != null && c.lng != null) {
        p.lat = c.lat; p.lng = c.lng; p.manualCoords = true; changed = true;
      }
    });
    if (changed) saveTour();
  }

  async function init() {
    registerSW();

    // не авторизован — показываем экран входа
    if (!Api.isAuthed()) {
      Router.show('auth');
      return;
    }

    // подтягиваем туры профиля с сервера в локальную копию
    try {
      const data = await Api.getTours();
      if (data.current) localStorage.setItem('rm_current_tour', JSON.stringify(data.current));
      else localStorage.removeItem('rm_current_tour');
      localStorage.setItem('rm_tour_history', JSON.stringify(data.history || []));
    } catch (e) {
      if (e.status === 401) { Api.clearSession(); Router.show('auth'); return; }
      // сеть недоступна — продолжаем с локальной копией
    }

    // подтягиваем базу клиентов (для автозамены и предложений)
    try {
      const cl = await Api.getClients();
      localStorage.setItem('rm_clients', JSON.stringify(cl.clients || []));
    } catch (e) { /* не критично */ }

    const saved = Storage.loadCurrent();
    if (saved && saved.points && saved.points.length) {
      tour = saved;
      try { enrichFromClients(); } catch (e) { console.warn('enrich failed', e); }
      Router.show(saved.stage || 'home');
    } else {
      Router.show('home');
    }
  }

  function logout() {
    Api.clearSession();
    localStorage.removeItem('rm_current_tour');
    localStorage.removeItem('rm_tour_history');
    tour = null;
    window.location.reload();
  }

  return {
    get tour() { return tour; },
    set tour(v) { tour = v; },
    setTour,
    saveTour,
    init,
    logout,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
