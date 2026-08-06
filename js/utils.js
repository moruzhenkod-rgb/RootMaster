// Shared small helpers
const Utils = (() => {
  function uid() {
    return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function toast(message, type = '') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .25s ease';
      setTimeout(() => el.remove(), 260);
    }, 2200);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  let longPressTimer = null;
  function bindLongPress(el, onLongPress, onTap, delay = 500) {
    let moved = false;
    let startX = 0, startY = 0;

    const start = (e) => {
      moved = false;
      const pt = e.touches ? e.touches[0] : e;
      startX = pt.clientX; startY = pt.clientY;
      longPressTimer = setTimeout(() => {
        if (!moved) {
          if (navigator.vibrate) navigator.vibrate(30);
          onLongPress(e);
        }
      }, delay);
    };
    const move = (e) => {
      const pt = e.touches ? e.touches[0] : e;
      if (Math.abs(pt.clientX - startX) > 10 || Math.abs(pt.clientY - startY) > 10) {
        moved = true;
        clearTimeout(longPressTimer);
      }
    };
    const end = (e) => {
      clearTimeout(longPressTimer);
      if (!moved && onTap) onTap(e);
    };
    const cancel = () => clearTimeout(longPressTimer);

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', cancel);
    el.addEventListener('mousedown', start);
    el.addEventListener('mousemove', move);
    el.addEventListener('mouseup', end);
    el.addEventListener('mouseleave', cancel);
  }

  return { uid, toast, escapeHtml, haversine, sleep, bindLongPress };
})();
