// Geocoding via OpenStreetMap Nominatim (free, rate-limited to ~1 req/sec)
const Geocode = (() => {
  const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
  let lastRequestAt = 0;
  const MIN_INTERVAL = 1100; // ms, respect Nominatim usage policy

  async function throttle() {
    const wait = lastRequestAt + MIN_INTERVAL - Date.now();
    if (wait > 0) await Utils.sleep(wait);
    lastRequestAt = Date.now();
  }

  // Returns { lat, lng, displayName, confidence } or null if not found
  async function lookup(address) {
    if (!address || !address.trim()) return null;
    await throttle();
    const url = `${ENDPOINT}?format=json&limit=1&addressdetails=0&q=${encodeURIComponent(address)}`;
    try {
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'ru' },
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.length) return null;
      const best = data[0];
      return {
        lat: parseFloat(best.lat),
        lng: parseFloat(best.lon),
        displayName: best.display_name,
        confidence: importanceToConfidence(best.importance),
      };
    } catch (e) {
      console.error('Geocode error', e);
      return null;
    }
  }

  function importanceToConfidence(importance) {
    if (typeof importance !== 'number') return 'medium';
    if (importance > 0.6) return 'high';
    if (importance > 0.35) return 'medium';
    return 'low';
  }

  return { lookup };
})();
