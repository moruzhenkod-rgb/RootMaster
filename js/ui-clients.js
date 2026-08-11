const UIClients = (() => {
  let root, selected = new Set(), editing = -1, editCoords = null, editMap = null;

  function mount(container) {
    root = container;
    selected = new Set();
    editing = -1;
    root.addEventListener('click', onClick);
    render();
  }
  function unmount() { root.removeEventListener('click', onClick); }

  function clients() {
    try { return JSON.parse(localStorage.getItem('rm_clients') || '[]'); } catch (e) { return []; }
  }

  function esc(v) { return Utils.escapeHtml(v == null ? '' : v); }

  function render() {
    const list = root.querySelector('#clients-list');
    const cs = clients();
    if (!cs.length) {
      list.innerHTML = '<div class="empty-hint">Пока нет сохранённых клиентов. Они появятся сами после первых туров.</div>';
      updateBtn();
      return;
    }
    list.innerHTML = cs.map((c, i) => {
      if (i === editing) {
        return `
      <div class="client-card editing" data-idx="${i}">
        <div class="client-edit-form">
          <input data-field="company" value="${esc(c.company)}" placeholder="Название фирмы">
          <input data-field="address" value="${esc(c.address)}" placeholder="Адрес">
          <div class="edit-row">
            <input data-field="key" value="${esc(c.key)}" placeholder="Ключ">
            <input data-field="cell" value="${esc(c.cell)}" placeholder="Ящик">
          </div>
          <div class="edit-map-hint">📍 Тапни по карте, чтобы поставить точку клиента${c.lat != null ? '' : ' (сейчас без координат)'}</div>
          <div class="edit-map" id="edit-map-${i}"></div>
          <div class="edit-actions">
            <button class="btn btn-success" data-action="save-client">Сохранить</button>
            <button class="btn btn-ghost" data-action="cancel-edit">Отмена</button>
          </div>
          <button class="btn btn-danger client-delete" data-action="delete-client">🗑 Удалить клиента</button>
        </div>
      </div>`;
      }
      return `
      <div class="client-card ${selected.has(i) ? 'sel' : ''}" data-idx="${i}">
        <div class="client-check">${selected.has(i) ? '✓' : ''}</div>
        <div class="client-body">
          ${c.company ? `<div class="client-firm">${esc(c.company)}</div>` : ''}
          <div class="client-addr">${esc(c.address)}</div>
          ${c.key || c.cell ? `<div class="client-key">${c.key ? '🔑 ' + esc(c.key) : ''}${c.key && c.cell ? ' · ' : ''}${c.cell ? '🗄 ' + esc(c.cell) : ''}</div>` : ''}
        </div>
        <button class="client-edit" data-action="edit-client">✏️</button>
        <div class="client-seen">${c.seen || 1}×</div>
      </div>`;
    }).join('');
    updateBtn();
    if (editing >= 0) setTimeout(() => initEditMap(cs[editing]), 30);
  }

  function initEditMap(c) {
    const el = root.querySelector('#edit-map-' + editing);
    if (!el || typeof L === 'undefined') return;
    if (editMap) { editMap.remove(); editMap = null; }
    const hasC = (c.lat != null && c.lng != null);
    const center = hasC ? [c.lat, c.lng] : [53.6355, 11.4012]; // Schwerin по умолчанию
    editMap = L.map(el, { zoomControl: true, attributionControl: false }).setView(center, hasC ? 15 : 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(editMap);
    let marker = hasC ? L.marker(center, { draggable: true }).addTo(editMap) : null;
    editCoords = hasC ? { lat: c.lat, lng: c.lng } : null;
    if (marker) marker.on('dragend', () => { const ll = marker.getLatLng(); editCoords = { lat: ll.lat, lng: ll.lng }; });
    editMap.on('click', (e) => {
      if (marker) marker.setLatLng(e.latlng);
      else { marker = L.marker(e.latlng, { draggable: true }).addTo(editMap); marker.on('dragend', () => { const ll = marker.getLatLng(); editCoords = { lat: ll.lat, lng: ll.lng }; }); }
      editCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
    });
    setTimeout(() => editMap.invalidateSize(), 60);
  }

  function updateBtn() {
    const b = root.querySelector('#btn-add-clients');
    if (!b) return;
    b.disabled = !selected.size;
    b.textContent = `Добавить в тур (${selected.size})`;
  }

  function onClick(e) {
    const back = e.target.closest('[data-action="back-home"]');
    if (back) { Router.show('home'); return; }
    const all = e.target.closest('[data-action="select-all"]');
    if (all) {
      const cs = clients();
      if (selected.size === cs.length) selected = new Set();
      else selected = new Set(cs.map((_, i) => i));
      render();
      return;
    }
    const add = e.target.closest('[data-action="add-clients"]');
    if (add) { addToTour(); return; }

    const saveBtn = e.target.closest('[data-action="save-client"]');
    if (saveBtn) { saveClient(saveBtn.closest('.client-card')); return; }
    const cancelBtn = e.target.closest('[data-action="cancel-edit"]');
    if (cancelBtn) { editing = -1; editCoords = null; if (editMap) { editMap.remove(); editMap = null; } render(); return; }
    const delBtn = e.target.closest('[data-action="delete-client"]');
    if (delBtn) { deleteClient(delBtn.closest('.client-card')); return; }

    const editBtn = e.target.closest('[data-action="edit-client"]');
    if (editBtn) {
      const c = editBtn.closest('.client-card');
      if (c) { editing = +c.dataset.idx; render(); }
      return;
    }
    const card = e.target.closest('.client-card');
    if (card && editing < 0) {
      const i = +card.dataset.idx;
      if (selected.has(i)) selected.delete(i); else selected.add(i);
      render();
    }
  }

  async function saveClient(card) {
    if (!card) return;
    const cs = clients();
    const c = cs[+card.dataset.idx];
    if (!c) return;
    const get = (f) => { const el = card.querySelector(`[data-field="${f}"]`); return el ? el.value.trim() : ''; };
    const newCompany = get('company');
    const address = get('address');
    const key = get('key');
    const cell = get('cell');
    if (!address) { Utils.toast('Адрес не может быть пустым', 'error'); return; }
    try {
      const lat = editCoords ? editCoords.lat : undefined;
      const lng = editCoords ? editCoords.lng : undefined;
      await Api.updateClient(c.company || '', c.address || '', address, key, cell, newCompany, lat, lng);
      const data = await Api.getClients();
      localStorage.setItem('rm_clients', JSON.stringify(data.clients || []));
      editing = -1; editCoords = null;
      if (editMap) { editMap.remove(); editMap = null; }
      Utils.toast('Сохранено', 'success');
      render();
    } catch (e) {
      Utils.toast(e.message || 'Не удалось сохранить', 'error');
    }
  }

  async function deleteClient(card) {
    if (!card) return;
    const c = clients()[+card.dataset.idx];
    if (!c) return;
    if (!window.confirm('Удалить клиента ' + (c.company || c.address) + '?')) return;
    try {
      await Api.deleteClient(c.company || '', c.address || '');
      const data = await Api.getClients();
      localStorage.setItem('rm_clients', JSON.stringify(data.clients || []));
      editing = -1;
      Utils.toast('Клиент удалён', 'success');
      render();
    } catch (e) {
      Utils.toast(e.message || 'Не удалось удалить', 'error');
    }
  }

  function addToTour() {
    const cs = clients();
    const points = [...selected].map((i) => cs[i]).filter(Boolean).map((c) => ({
      id: Utils.uid(),
      rawText: c.address,
      editedText: c.address,
      company: c.company || '',
      key: c.key || '',
      cell: c.cell || '',
      lat: c.lat,
      lng: c.lng,
      foundAddress: c.address,
      matchedHouse: true,
      manualCoords: !!c.manual,
      geoStatus: (c.lat != null && c.lng != null) ? 'ok' : 'error',
      order: null,
      tourStatus: 'pending',
    }));
    if (!points.length) return;
    App.setTour({ points, stage: 'build' }, 'build');
    Router.show('build');
  }

  return { mount, unmount };
})();
