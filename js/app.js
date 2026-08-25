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
        setInterval(() => reg.update(), 30 * 1000);
        // как только новая версия установилась — сразу активируем её
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              nw.postMessage('skip-waiting');
            }
          });
        });
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
    let changed = false;
    tour.points.forEach((p) => {
      // умный поиск клиента: по фирме + похожему адресу, с приоритетом записи с координатами
      const c = (typeof ClientMatch !== 'undefined')
        ? ClientMatch.matchClient(p.editedText, p.company, clients) : null;
      if (!c) return;
      if ((c.cell || '') !== (p.cell || '')) { p.cell = c.cell || ''; changed = true; }
      if (!p.key && c.key) { p.key = c.key; changed = true; }
      if (!p.company && c.company) { p.company = c.company; changed = true; }
      // подтягиваем координаты клиента, если у точки их нет или она «не на карте»
      let noCoords = (p.lat == null || p.lng == null || p.geoStatus === 'error');
      if (c.lat != null && c.lng != null) {
        if (c.manual && !p.manualCoords) { p.lat = c.lat; p.lng = c.lng; p.manualCoords = true; p.geoStatus = 'ok'; changed = true; noCoords = false; }
        else if (noCoords) { p.lat = c.lat; p.lng = c.lng; p.geoStatus = 'ok'; if (c.manual) p.manualCoords = true; changed = true; noCoords = false; }
      }
      // fallback: если координат всё ещё нет — берём у ЛЮБОЙ записи с той же фирмой, где координаты есть
      if (noCoords && p.company) {
        const pc = String(p.company).toLowerCase().trim();
        const alt = clients.find((x) => x.lat != null && x.lng != null && String(x.company || '').toLowerCase().trim() === pc);
        if (alt) { p.lat = alt.lat; p.lng = alt.lng; p.geoStatus = 'ok'; if (alt.manual) p.manualCoords = true; changed = true; }
      }
    });
    if (changed) saveTour();
  }

  async function init() {
    registerSW();

    // предзагружаем озвучку радар-детектора заранее, чтобы первая фраза не запаздывала
    if (typeof AudioManager !== 'undefined') {
      window.AudioManagerInstance = window.AudioManagerInstance || AudioManager.getInstance();
      window.AudioManagerInstance.preload().catch(() => {});
    }

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
      // тур загружен (в работе) → сразу список адресов; недозавершённый — в меню (данные не теряются)
      Router.show(saved.stage === 'active' ? 'active' : 'home');
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
