const UIClients = (() => {
  let root, selected = new Set();

  function mount(container) {
    root = container;
    selected = new Set();
    root.addEventListener('click', onClick);
    render();
  }
  function unmount() { root.removeEventListener('click', onClick); }

  function clients() {
    try { return JSON.parse(localStorage.getItem('rm_clients') || '[]'); } catch (e) { return []; }
  }

  function render() {
    const list = root.querySelector('#clients-list');
    const cs = clients();
    if (!cs.length) {
      list.innerHTML = '<div class="empty-hint">Пока нет сохранённых клиентов. Они появятся сами после первых туров.</div>';
      updateBtn();
      return;
    }
    list.innerHTML = cs.map((c, i) => `
      <div class="client-card ${selected.has(i) ? 'sel' : ''}" data-idx="${i}">
        <div class="client-check">${selected.has(i) ? '✓' : ''}</div>
        <div class="client-body">
          ${c.company ? `<div class="client-firm">${Utils.escapeHtml(c.company)}</div>` : ''}
          <div class="client-addr">${Utils.escapeHtml(c.address)}</div>
          ${c.key ? `<div class="client-key">🔑 ${Utils.escapeHtml(c.key)}</div>` : ''}
        </div>
        <button class="client-edit" data-action="edit-client">✏️</button>
        <div class="client-seen">${c.seen || 1}×</div>
      </div>`).join('');
    updateBtn();
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
    const editBtn = e.target.closest('[data-action="edit-client"]');
    if (editBtn) {
      const c = editBtn.closest('.client-card');
      if (c) editClient(+c.dataset.idx);
      return;
    }
    const card = e.target.closest('.client-card');
    if (card) {
      const i = +card.dataset.idx;
      if (selected.has(i)) selected.delete(i); else selected.add(i);
      render();
    }
  }

  async function editClient(i) {
    const cs = clients();
    const c = cs[i];
    if (!c) return;
    const address = window.prompt('Адрес' + (c.company ? ' — ' + c.company : ''), c.address || '');
    if (address == null) return;
    const a = address.trim();
    if (!a) return;
    try {
      await Api.updateClient(c.company || '', c.address || '', a);
      const data = await Api.getClients();
      localStorage.setItem('rm_clients', JSON.stringify(data.clients || []));
      Utils.toast('Адрес обновлён', 'success');
      render();
    } catch (e) {
      Utils.toast(e.message || 'Не удалось сохранить', 'error');
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
