// List of previous finished/cancelled tours, grouped by date
const UIHistory = (() => {
  let root;

  function mount(container) {
    root = container;
    root.addEventListener('click', onClick);
    renderList();
  }

  function unmount() {
    root.removeEventListener('click', onClick);
  }

  function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function renderList() {
    const list = document.getElementById('history-list');
    const tours = Storage.loadHistory();

    if (!tours.length) {
      list.innerHTML = '<div class="empty-hint">Нет сохранённых туров</div>';
      return;
    }

    list.innerHTML = tours
      .map((t) => {
        const total = t.points.length;
        const done = t.points.filter((p) => p.tourStatus === 'done').length;
        return `
        <div class="history-card" data-id="${t.id}">
          <div class="history-card-date">${formatDate(t.finishedAt)}</div>
          <div class="history-card-time">${formatTime(t.finishedAt)}</div>
          <div class="history-card-stats">${done}/${total} доставлено</div>
        </div>`;
      })
      .join('');
  }

  function onClick(e) {
    const backBtn = e.target.closest('[data-action="back-home"]');
    if (backBtn) { Router.show('home'); return; }

    const card = e.target.closest('.history-card');
    if (card) { Router.show('history-detail', { id: card.dataset.id }); return; }
  }

  return { mount, unmount };
})();
