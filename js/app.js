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

    const saved = Storage.loadCurrent();
    if (saved && saved.points && saved.points.length) {
      tour = saved;
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
