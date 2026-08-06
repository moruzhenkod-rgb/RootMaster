// Persistence layer over localStorage
const Storage = (() => {
  const KEY_CURRENT = 'rm_current_tour';
  const KEY_YESTERDAY = 'rm_yesterday_tour';

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

  // Called when a tour reaches the "active" stage — snapshot as "yesterday" candidate
  function archiveAsYesterday(tour) {
    try {
      localStorage.setItem(KEY_YESTERDAY, JSON.stringify(tour));
    } catch (e) {
      console.error('Archive failed', e);
    }
  }

  function loadYesterday() {
    try {
      const raw = localStorage.getItem(KEY_YESTERDAY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function hasYesterday() {
    return !!localStorage.getItem(KEY_YESTERDAY);
  }

  return { saveCurrent, loadCurrent, clearCurrent, archiveAsYesterday, loadYesterday, hasYesterday };
})();
