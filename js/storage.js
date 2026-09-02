// Persistence layer over localStorage
const Storage = (() => {
  const KEY_CURRENT = 'rm_current_tour';
  const KEY_HISTORY = 'rm_tour_history';
  const MAX_HISTORY = 30;

  let syncTimer = null;
  function syncToServer() {
    if (typeof Api === 'undefined' || !Api.isAuthed()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      Api.putTours(loadCurrent(), loadHistory()).catch((e) => console.warn('sync failed', e));
    }, 800);
  }

  function saveCurrent(tour) {
    try {
      localStorage.setItem(KEY_CURRENT, JSON.stringify(tour));
      syncToServer();
    } catch (e) {
      console.error('Save failed', e);
    }
  }

  function loadCurrent() {
    try {
      const raw = localStorage.getItem(KEY_CURRENT);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearCurrent() {
    localStorage.removeItem(KEY_CURRENT);
    syncToServer();
  }

  // Called when a tour is finished or cancelled — appends a dated snapshot to history
  function archiveTour(tour) {
    try {
      const history = loadHistory();
      history.unshift({
        id: tour.id || Utils.uid(),
        startedAt: tour.startedAt || null,
        finishedAt: Date.now(),
        points: tour.points,
      });
      localStorage.setItem(KEY_HISTORY, JSON.stringify(history.slice(0, MAX_HISTORY)));
      syncToServer();
    } catch (e) {
      console.error('Archive failed', e);
    }
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(KEY_HISTORY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function loadHistoryItem(id) {
    return loadHistory().find((t) => t.id === id) || null;
  }

  function hasHistory() {
    return loadHistory().length > 0;
  }

  return {
    saveCurrent,
    loadCurrent,
    clearCurrent,
    archiveTour,
    loadHistory,
    loadHistoryItem,
    hasHistory,
  };
})();
