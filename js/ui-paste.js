const UIPaste = (() => {
  let root;
  function mount(container) {
    root = container;
    root.addEventListener('click', onClick);
    const textarea = root.querySelector('#paste-textarea');
    textarea.addEventListener('input', () => {
      document.getElementById('btn-paste-submit').disabled = !textarea.value.trim();
    });
    textarea.focus();
  }
  function unmount() { root.removeEventListener('click', onClick); }
  function onClick(e) {
    if (e.target.closest('[data-action="back-home"]')) { Router.show('home'); return; }
    if (e.target.closest('[data-action="paste-submit"]')) {
      const text = root.querySelector('#paste-textarea').value.trim();
      if (!text) return;
      Router.show('scan', { rawText: text });
    }
  }
  return { mount, unmount };
})();
