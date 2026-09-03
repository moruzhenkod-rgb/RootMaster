const UIHome = (() => {
  let root;

  function mount(container) {
    root = container;
    root.addEventListener('click', onClick);

    const userEl = root.querySelector('#home-user');
    if (userEl && typeof Api !== 'undefined') userEl.textContent = Api.displayName();

    // версия в шапке (источник — футер, бампаем в одном месте)
    const vEl = root.querySelector('#app-version');
    const foot = root.querySelector('.home-footer');
    const vm = foot && foot.textContent.match(/v\d+\.\d+/);
    if (vEl && vm) vEl.textContent = vm[0];

    // кнопка "Мой тур" — видна только если есть загруженный активный тур
    const myTourBtn = root.querySelector('#btn-my-tour');
    if (myTourBtn) {
      const t = App.tour;
      if (t && t.points && t.points.length && ['active', 'validate', 'build'].indexOf(t.stage) !== -1) {
        myTourBtn.style.display = '';
        const lbl = myTourBtn.querySelector('.tile-label');
        if (lbl) lbl.textContent = t.stage === 'active' ? 'Мой тур' : t.stage === 'validate' ? 'Продолжить проверку' : 'Продолжить сборку';
      }
    }

    // доступ к настройкам/самотесту и радару — только админ (Dima)
    if (typeof Api !== 'undefined' && !Api.isAdmin()) {
      const adminBox = root.querySelector('#home-admin'); if (adminBox) adminBox.style.display = 'none';
    }

    const historyBtn = root.querySelector('[data-action="open-history"]');
    if (!Storage.hasHistory()) {
      historyBtn.disabled = true;
      historyBtn.style.opacity = '0.4';
    }
  }

  function unmount() {
    root.removeEventListener('click', onClick);
  }

  function onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'logout') {
      App.logout();
      return;
    } else if (action === 'open-manual') {
      Router.show('manual');
      return;
    } else if (action === 'open-clients') {
      Router.show('clients');
      return;
    } else if (action === 'open-radar') {
      if (typeof Api !== 'undefined' && !Api.isAdmin()) return;
      Router.show('radar2');
      return;
    } else if (action === 'open-tour') {
      const st = App.tour && App.tour.stage;
      Router.show(st === 'validate' ? 'validate' : st === 'build' ? 'build' : 'active');
      return;
    } else if (action === 'paste-text') {
      Router.show('paste');
    } else if (action === 'open-radar2') {
      if (typeof Api !== 'undefined' && !Api.isAdmin()) return;
      Router.show('radar2');
      return;
    } else if (action === 'open-settings') {
      if (typeof Api !== 'undefined' && !Api.isAdmin()) return;
      Router.show('settings');
      return;
    } else if (action === 'open-active-users') {
      if (typeof Api !== 'undefined' && !Api.isAdmin()) return;
      Router.show('active-users');
      return;
    } else if (action === 'open-tracking') {
      if (typeof Api !== 'undefined' && !Api.isAdmin()) return;
      Router.show('tracking');
      return;
    } else if (action === 'open-history') {
      if (!Storage.hasHistory()) {
        Utils.toast('Нет сохранённых туров', 'error');
        return;
      }
      Router.show('history');
    }
  }

  return { mount, unmount };
})();
