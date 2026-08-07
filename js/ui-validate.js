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

  function render() {
    const list = document.getElementById('validate-list');
    list.innerHTML = points()
      .map(
        (p, i) => `
      <div class="addr-card ${statusClass(p)}" data-id="${p.id}">
        <div class="addr-card-top">
          <div class="addr-index">${i + 1}</div>
          <div class="addr-text">${Utils.escapeHtml(p.editedText)}</div>
          <div class="addr-status-badge">${statusLabel(p)}</div>
        </div>
        ${p.key ? `<div class="addr-key">🔑 ${Utils.escapeHtml(p.key)}</div>` : ''}
        ${p.foundAddress && p.geoStatus !== 'ok' ? `<div class="addr-found">📍 На карте нашлось: ${Utils.escapeHtml(p.foundAddress)}</div>` : ''}
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
      </div>`
      )
      .join('');

    const total = points().length;
    const resolved = points().filter(isResolved).length;
    document.getElementById('validate-counter').textContent = `${resolved}/${total}`;
    document.getElementById('btn-confirm-validate').disabled = resolved < total;
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
    const validPoints = points().filter((p) => p.lat != null && p.lng != null);
    App.tour.points = validPoints;
    App.tour.stage = 'build';
    App.saveTour();
    Router.show('build');
  }

  return { mount, unmount };
})();
