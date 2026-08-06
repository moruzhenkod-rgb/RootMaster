const UIHome = (() => {
  let root;

  function mount(container) {
    root = container;
    const fileInput = root.querySelector('#file-input');

    root.addEventListener('click', onClick);
    fileInput.addEventListener('change', onFileChosen);

    const yestBtn = root.querySelector('[data-action="load-yesterday"]');
    if (!Storage.hasYesterday()) {
      yestBtn.disabled = true;
      yestBtn.style.opacity = '0.4';
    }
  }

  function unmount() {
    root.removeEventListener('click', onClick);
  }

  function onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'new-tour') {
      root.querySelector('#file-input').click();
    } else if (action === 'load-yesterday') {
      const tour = Storage.loadYesterday();
      if (!tour || !tour.points || !tour.points.length) {
        Utils.toast('Нет сохранённого тура', 'error');
        return;
      }
      App.setTour(tour, tour.stage || 'active');
      Router.show(tour.stage || 'active');
    } else if (action === 'test-run') {
      const points = TestData.generate();
      App.setTour({ points, stage: 'build' }, 'build');
      Router.show('build');
    }
  }

  function onFileChosen(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    Router.show('scan', { file });
  }

  return { mount, unmount };
})();
