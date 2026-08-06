// Persistence layer over localStorage
const Storage = (() => {
  const KEY_CURRENT = 'rm_current_tour';
  const KEY_HISTORY = 'rm_tour_history';
  const MAX_HISTORY = 30;

  function saveCurrent(tour) {
    try {
      localStorage.setItem(KEY_CURRENT, JSON.stringify(tour));
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
  }

  // Called when a tour is finished or cancelled — appends a dated snapshot to history
  function archiveTour(tour) {
    try {
      const history = loadHistory();
      history.unshift({
        id: Utils.uid(),
        finishedAt: Date.now(),
        points: tour.points,
      });
      localStorage.setItem(KEY_HISTORY, JSON.stringify(history.slice(0, MAX_HISTORY)));
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
