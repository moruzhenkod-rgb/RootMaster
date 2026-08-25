// Переиспользуемый пикер точки на карте: тап/драг → координаты.
// Используется в активном туре (поставить посылку) и в самотесте (проверка функции).
// PlacePicker.open({ title, subtitle, coords:{lat,lng}|null, center:[lat,lng], me:[lat,lng], onSave(coords) })
const PlacePicker = (() => {
  let map = null, coords = null, cb = null;

  function open(opts) {
    opts = opts || {};
    cb = opts.onSave || null;
    coords = (opts.coords && opts.coords.lat != null) ? { lat: opts.coords.lat, lng: opts.coords.lng } : null;
    let ov = document.getElementById('place-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'place-overlay';
      ov.className = 'place-overlay';
      ov.innerHTML = `
        <div class="place-head">
          <div class="place-title"></div>
          <div class="place-sub"></div>
          <div class="place-hint">Тапни по карте в нужном месте (можно двигать метку)</div>
        </div>
        <div id="place-map" class="place-map"></div>
        <div class="place-actions">
          <button class="btn btn-ghost" data-pp="cancel">Отмена</button>
          <button class="btn btn-primary" data-pp="save">✓ Сохранить точку</button>
        </div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', onClick);
    }
    ov.querySelector('.place-title').textContent = opts.title || '📍 Где находится посылка?';
    ov.querySelector('.place-sub').textContent = opts.subtitle || '';
    ov.style.display = 'flex';
    const has = !!coords;
    const center = has ? [coords.lat, coords.lng] : (opts.center || [53.6355, 11.4012]);
    setTimeout(() => initMap(center, has, opts.me), 40);
  }

  function initMap(center, has, me) {
    const el = document.getElementById('place-map');
    if (!el || typeof L === 'undefined') return;
    if (map) { try { map.remove(); } catch (e) {} map = null; }
    map = L.map(el, { zoomControl: true, attributionControl: false }).setView(center, has ? 16 : 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    if (me) { try { L.marker(me, { icon: L.divIcon({ className: '', html: '<div class="marker-me"></div>', iconSize: [20, 20] }) }).addTo(map); } catch (e) {} }
    let marker = has ? L.marker(center, { draggable: true }).addTo(map) : null;
    if (marker) marker.on('dragend', () => { const ll = marker.getLatLng(); coords = { lat: ll.lat, lng: ll.lng }; });
    map.on('click', (e) => {
      if (marker) marker.setLatLng(e.latlng);
      else { marker = L.marker(e.latlng, { draggable: true }).addTo(map); marker.on('dragend', () => { const ll = marker.getLatLng(); coords = { lat: ll.lat, lng: ll.lng }; }); }
      coords = { lat: e.latlng.lat, lng: e.latlng.lng };
    });
    setTimeout(() => map.invalidateSize(), 80);
  }

  function close() {
    const ov = document.getElementById('place-overlay');
    if (ov) ov.style.display = 'none';
    if (map) { try { map.remove(); } catch (e) {} map = null; }
    coords = null; cb = null;
  }

  function onClick(e) {
    if (e.target.closest('[data-pp="cancel"]')) { close(); return; }
    if (e.target.closest('[data-pp="save"]')) {
      if (!coords) { Utils.toast('Тапни по карте, где находится точка', 'error'); return; }
      const c = coords, f = cb;
      close();
      if (f) f(c);
    }
  }

  return { open, close };
})();
