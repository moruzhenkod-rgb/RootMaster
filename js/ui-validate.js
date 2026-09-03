const UIValidate = (() => {
  let root;

  function mount(container) {
    root = container;
    root.addEventListener('click', onClick);
    render();
  }

  function unmount() {
    root.removeEventListener('click', onClick);
  }

  function points() {
    return App.tour.points;
  }

  function statusClass(p) {
    if (p.geoStatus === 'ok') return 'status-ok';
    if (p.geoStatus === 'warn') return 'status-warn';
    return 'status-error';
  }

  function statusLabel(p) {
    if (p.geoStatus === 'ok') return 'Найден на карте';
    if (p.geoStatus === 'warn') return 'Сверьте — неточно';
    if (p.skippedByUser) return 'Пропущено';
    return 'Не найден';
  }

  function isResolved(p) {
    return p.geoStatus !== 'error' || p.skippedByUser;
  }

  // похожий клиент из базы для точек, которые не удалось найти автоматически —
  // предлагаем подтвердить замену вручную, а не сразу подставляем
  function suggestion(p) {
    if (p.geoStatus !== 'error' || p.skippedByUser || p.suggestionDismissed) return null;
    const clients = ClientMatch.loadClients();
    const found = ClientMatch.suggestClient(p.editedText, clients);
    if (!found) return null;
    // не предлагаем то, что уже совпадает с текущим текстом
    if (ClientMatch.normAddr(found.client.address) === ClientMatch.normAddr(p.editedText)) return null;
    return found;
  }

  function render() {
    const list = document.getElementById('validate-list');
    list.innerHTML = points()
      .map(
        (p, i) => {
          const sug = suggestion(p);
          return `
      <div class="addr-card ${statusClass(p)}" data-id="${p.id}">
        <div class="addr-card-top">
          <div class="addr-index">${i + 1}</div>
          <div class="addr-text">${Utils.escapeHtml(p.editedText)}</div>
          <div class="addr-status-badge">${statusLabel(p)}</div>
        </div>
        ${p.company ? `<div class="addr-company">${Utils.escapeHtml(p.company)}</div>` : ''}
        ${p.key ? `<div class="addr-key">🔑 ${Utils.escapeHtml(p.key)}</div>` : ''}
        ${p.parcels || p.weight ? `<div class="addr-meta">${p.parcels ? `📦 ${Utils.escapeHtml(p.parcels)} шт` : ''}${p.parcels && p.weight ? ' · ' : ''}${p.weight ? `⚖ ${Utils.escapeHtml(p.weight)}` : ''}</div>` : ''}
        ${p.foundAddress && p.geoStatus !== 'ok' ? `<div class="addr-found">📍 На карте нашлось: ${Utils.escapeHtml(p.foundAddress)}</div>` : ''}
        ${
          sug
            ? `<div class="addr-suggestion">
                <div class="addr-suggestion-text">Похоже, это уже есть в базе: <b>${Utils.escapeHtml(sug.client.company || sug.client.address)}</b>${sug.client.company ? ` — ${Utils.escapeHtml(sug.client.address)}` : ''}</div>
                <div class="addr-suggestion-actions">
                  <button data-action="accept-suggestion" class="primary">✓ Заменить</button>
                  <button data-action="dismiss-suggestion">Нет, это другое</button>
                </div>
              </div>`
            : ''
        }
        ${
          p.geoStatus !== 'ok'
            ? `<div class="addr-actions">
                <button data-action="edit" class="primary">✏️ Исправить</button>
                ${p.geoStatus === 'error' && !p.skippedByUser ? '<button data-action="skip">Пропустить точку</button>' : ''}
              </div>
              <div class="addr-edit-row">
                <input type="text" value="${Utils.escapeHtml(p.editedText)}" data-action="edit-input">
                <button data-action="recheck">Проверить повторно</button>
              </div>`
            : ''
        }
      </div>`;
        }
      )
      .join('');

    const total = points().length;
    const resolved = points().filter(isResolved).length;
    document.getElementById('validate-counter').textContent = `${resolved}/${total}`;
    document.getElementById('btn-confirm-validate').disabled = total === 0; // не блокируем из-за ненайденных — их можно доработать на карте
  }

  async function onClick(e) {
    const backBtn = e.target.closest('[data-action="back-home"]');
    if (backBtn) {
      Router.show('home');
      return;
    }
    const confirmBtn = e.target.closest('[data-action="confirm-validate"]');
    if (confirmBtn) {
      confirm();
      return;
    }
    if (e.target.closest('[data-action="add-client"]')) { openAddClient(); return; }

    const card = e.target.closest('.addr-card');
    if (!card) return;
    const id = card.dataset.id;
    const point = points().find((p) => p.id === id);
    if (!point) return;

    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'edit') {
      card.classList.toggle('editing');
      const input = card.querySelector('[data-action="edit-input"]');
      if (input) input.focus();
    } else if (action === 'skip') {
      point.skippedByUser = true;
      point.tourStatus = 'skip';
      App.saveTour();
      render();
    } else if (action === 'dismiss-suggestion') {
      point.suggestionDismissed = true;
      render();
    } else if (action === 'accept-suggestion') {
      const clients = ClientMatch.loadClients();
      const found = ClientMatch.suggestClient(point.editedText, clients);
      if (!found) return;
      const known = found.client;
      point.editedText = known.address;
      point.rawText = known.address;
      if (known.company) point.company = known.company;
      if (known.key) point.key = known.key;
      if (known.cell) point.cell = known.cell;
      if (known.manual) point.manualCoords = true;
      if (known.lat != null && known.lng != null) {
        point.lat = known.lat;
        point.lng = known.lng;
        point.foundAddress = known.address;
        point.matchedHouse = true;
        point.geoStatus = 'ok';
        point.skippedByUser = false;
        point.tourStatus = 'pending';
        App.saveTour();
        render();
      } else {
        const btn = card.querySelector('[data-action="accept-suggestion"]');
        if (btn) { btn.textContent = 'Проверяю…'; btn.disabled = true; }
        const geo = await Geocode.lookup(known.address);
        if (geo) {
          point.lat = geo.lat;
          point.lng = geo.lng;
          point.foundAddress = geo.displayName;
          point.matchedHouse = !!geo.matchedHouse;
          point.geoStatus = geo.confidence === 'low' ? 'warn' : 'ok';
          point.skippedByUser = false;
          point.tourStatus = 'pending';
        } else {
          point.geoStatus = 'error';
          Utils.toast('Адрес из базы тоже не найден на карте', 'error');
        }
        App.saveTour();
        render();
      }
    } else if (action === 'recheck') {
      const input = card.querySelector('[data-action="edit-input"]');
      const newText = input.value.trim();
      if (!newText) return;
      point.editedText = newText;
      const btn = card.querySelector('[data-action="recheck"]');
      btn.textContent = 'Проверяю…';
      btn.disabled = true;
      const geo = await Geocode.lookup(newText);
      if (geo) {
        point.lat = geo.lat;
        point.lng = geo.lng;
        point.foundAddress = geo.displayName;
        point.matchedHouse = !!geo.matchedHouse;
        point.geoStatus = geo.confidence === 'low' ? 'warn' : 'ok';
        point.skippedByUser = false;
        point.tourStatus = 'pending';
        Utils.toast(geo.matchedHouse ? 'Адрес найден точно' : 'Найдено примерно — сверьте', geo.matchedHouse ? 'success' : 'warning');
      } else {
        point.geoStatus = 'error';
        Utils.toast('Адрес не найден', 'error');
      }
      App.saveTour();
      render();
    }
  }

  function confirm() {
    // ненайденные НЕ выкидываем — они попадут в тур как «не на карте», доработаешь там
    App.tour.stage = 'build';
    App.saveTour();
    Router.show('build');
  }

  // --- Добавить клиента прямо в список проверки (поиск по базе / вручную) ---
  let vcResults = [];
  function openAddClient() {
    let ov = document.getElementById('vc-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'vc-overlay';
      ov.className = 'addp-overlay';
      ov.innerHTML = `
        <div class="addp-card">
          <h3>➕ Добавить клиента</h3>
          <input id="vc-search" placeholder="🔍 Поиск в базе клиентов">
          <div id="vc-results" class="ap-results"></div>
          <input id="vc-company" placeholder="Фирма (необязательно)">
          <input id="vc-address" placeholder="Адрес: улица дом, индекс город">
          <div class="edit-row">
            <input id="vc-key" placeholder="Ключ">
            <input id="vc-cell" placeholder="Ячейка">
          </div>
          <div class="addp-hint">Найди в базе или впиши вручную. Проверю адрес на карте и добавлю в список.</div>
          <div class="addp-actions">
            <button class="btn btn-ghost" data-action="vc-cancel">Отмена</button>
            <button class="btn btn-primary" id="vc-save-btn" data-action="vc-save">Добавить</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', onAddClientClick);
      ov.addEventListener('input', (e) => { if (e.target && e.target.id === 'vc-search') renderVcResults(e.target.value.toLowerCase().trim()); });
    }
    ov.style.display = 'flex';
    vcResults = [];
    const r = document.getElementById('vc-results'); if (r) r.innerHTML = '';
    const c = document.getElementById('vc-company'); if (c) c.focus();
  }

  function closeAddClient() {
    const ov = document.getElementById('vc-overlay');
    if (ov) {
      ov.style.display = 'none';
      ['vc-company','vc-address','vc-key','vc-cell','vc-search'].forEach((i) => { const el = document.getElementById(i); if (el) el.value = ''; });
      const r = document.getElementById('vc-results'); if (r) r.innerHTML = '';
    }
    vcResults = [];
  }

  function renderVcResults(q) {
    const box = document.getElementById('vc-results');
    if (!box) return;
    if (!q) { box.innerHTML = ''; vcResults = []; return; }
    const clients = ClientMatch.loadClients();
    const nq = ClientMatch.normAddr(q);
    vcResults = clients.filter((c) => ClientMatch.normAddr(c.company).includes(nq) || ClientMatch.normAddr(c.address).includes(nq)).slice(0, 8);
    box.innerHTML = vcResults.length
      ? vcResults.map((c, i) => `<div class="ap-item" data-action="vc-pick" data-idx="${i}">${c.company ? `<div class="ap-firm">${Utils.escapeHtml(c.company)}</div>` : ''}<div class="ap-addr">${Utils.escapeHtml(c.address)}</div></div>`).join('')
      : '<div class="ap-empty">Ничего не найдено</div>';
  }

  async function onAddClientClick(e) {
    if (e.target.closest('[data-action="vc-cancel"]')) { closeAddClient(); return; }
    if (e.target.closest('[data-action="vc-save"]')) { saveAddClient(); return; }
    const pick = e.target.closest('[data-action="vc-pick"]');
    if (pick) {
      const c = vcResults[+pick.dataset.idx]; if (!c) return;
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
      set('vc-company', c.company); set('vc-address', c.address); set('vc-key', c.key); set('vc-cell', c.cell);
      const box = document.getElementById('vc-results'); if (box) box.innerHTML = '';
      const srch = document.getElementById('vc-search'); if (srch) srch.value = '';
      vcResults = [];
    }
  }

  async function saveAddClient() {
    const v = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    let company = v('vc-company'), address = v('vc-address'), key = v('vc-key'), cell = v('vc-cell');
    if (!address) { Utils.toast('Введите адрес', 'error'); return; }
    const btn = document.getElementById('vc-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Добавляю…'; }
    const clients = ClientMatch.loadClients();
    const known = ClientMatch.matchClient(address, company, clients);
    let lat = null, lng = null, manual = false, matchedHouse = false, foundAddress = null;
    if (known) {
      if (known.address) address = known.address;
      if (!company && known.company) company = known.company;
      if (!cell && known.cell) cell = known.cell;
      if (known.lat != null && known.lng != null) { lat = known.lat; lng = known.lng; manual = !!known.manual; matchedHouse = true; foundAddress = known.address; }
    }
    if (lat == null) {
      try { const geo = await Geocode.lookup(address); if (geo) { lat = geo.lat; lng = geo.lng; matchedHouse = !!geo.matchedHouse; foundAddress = geo.displayName; } } catch (e) {}
    }
    const pt = {
      id: Utils.uid(), rawText: address, editedText: address,
      company: company || '', key: key || '', cell: cell || '', parcels: '', weight: '',
      deadline: '', timeCritical: false,
      lat: lat, lng: lng, foundAddress: foundAddress, matchedHouse: matchedHouse,
      manualCoords: manual, geoStatus: lat != null ? 'ok' : 'error',
      order: null, tourStatus: 'pending',
    };
    App.tour.points.push(pt);
    App.saveTour();
    if (btn) { btn.disabled = false; btn.textContent = 'Добавить'; }
    closeAddClient();
    render();
    Utils.toast(lat != null ? 'Клиент добавлен ✓' : 'Добавлено — адрес не найден, исправь в списке', lat != null ? 'success' : 'error');
  }

  return { mount, unmount };
})();
