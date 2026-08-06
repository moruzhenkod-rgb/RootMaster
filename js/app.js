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
        navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
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
