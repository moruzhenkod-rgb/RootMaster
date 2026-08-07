const UIHome = (() => {
  let root;

  function mount(container) {
    root = container;
    root.addEventListener('click', onClick);

    const userEl = root.querySelector('#home-user');
    if (userEl && typeof Api !== 'undefined') userEl.textContent = Api.displayName();

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
    } else if (action === 'open-clients') {
      Router.show('clients');
      return;
    } else if (action === 'paste-text') {
      Router.show('paste');
    } else if (action === 'open-history') {
      if (!Storage.hasHistory()) {
        Utils.toast('Нет сохранённых туров', 'error');
        return;
      }
      Router.show('history');
    } else if (action === 'test-run') {
      const points = TestData.generate();
      App.setTour({ points, stage: 'build' }, 'build');
      Router.show('build');
    }
  }

  return { mount, unmount };
})();
