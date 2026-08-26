// Traffic: ремонты/пробки через наш прокси /api/traffic (TomTom). Кеш 5 мин в sessionStorage.
const RadarTraffic = (() => {
  const TTL = 5 * 60 * 1000;
  function key(bbox) { return 'rm_traffic_' + bbox; }

  async function fetchBBox(minLon, minLat, maxLon, maxLat) {
    const bbox = [minLon, minLat, maxLon, maxLat].map((n) => n.toFixed(4)).join(',');
    try {
      const raw = sessionStorage.getItem(key(bbox));
      if (raw) { const c = JSON.parse(raw); if (Date.now() - c.at < TTL) return c.incidents || []; }
    } catch (e) {}
    try {
      const res = await fetch('/api/traffic?bbox=' + encodeURIComponent(bbox));
      if (!res.ok) return [];
      const j = await res.json();
      const incidents = j.incidents || [];
      try { sessionStorage.setItem(key(bbox), JSON.stringify({ at: Date.now(), incidents })); } catch (e) {}
      return incidents;
    } catch (e) { return []; }
  }

  // ремонты/перекрытия вокруг точки в радиусе (км), с дистанцией
  async function nearby(lat, lon, radiusKm) {
    const d = radiusKm / 111;
    const dLon = d / (Math.cos(lat * Math.PI / 180) || 1);
    const inc = await fetchBBox(lon - dLon, lat - d, lon + dLon, lat + d);
    // категории TomTom: 9=ремонт, 8=перекрыто, 7=полоса закрыта, 1=авария, 6=пробка
    return inc.filter((i) => [1, 6, 7, 8, 9].indexOf(i.category) !== -1);
  }

  function label(category) {
    switch (category) {
      case 9: return 'Дорожные работы';
      case 8: return 'Дорога перекрыта';
      case 7: return 'Полоса закрыта';
      case 1: return 'Авария';
      case 6: return 'Пробка';
      default: return 'Помеха на дороге';
    }
  }

  return { nearby, fetchBBox, label };
})();
