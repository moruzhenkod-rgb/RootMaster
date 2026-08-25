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
      if (t && t.points && t.points.length && t.stage === 'active') myTourBtn.style.display = '';
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
      Router.show('radar');
      return;
    } else if (action === 'open-tour') {
      Router.show('active');
      return;
    } else if (action === 'paste-text') {
      Router.show('paste');
    } else if (action === 'open-settings') {
      Router.show('settings');
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
