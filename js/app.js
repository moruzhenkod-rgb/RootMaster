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

  function init() {
    const saved = Storage.loadCurrent();
    if (saved && saved.points && saved.points.length) {
      tour = saved;
      Router.show(saved.stage || 'home');
    } else {
      Router.show('home');
    }

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then((reg) => {
          // проверять обновление при старте и раз в минуту
          reg.update();
          setInterval(() => reg.update(), 60 * 1000);
        }).catch((e) => console.warn('SW registration failed', e));

        // как только новый service worker взял управление — один раз перезагрузить на свежую версию
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloaded) return;
          reloaded = true;
          window.location.reload();
        });
      });
    }
  }

  return {
    get tour() { return tour; },
    set tour(v) { tour = v; },
    setTour,
    saveTour,
    init,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
