// Minimal screen router — swaps template content into #app
const Router = (() => {
  const screens = {
    auth: UIAuth,
    home: UIHome,
    clients: UIClients,
    paste: UIPaste,
    scan: UIScan,
    validate: UIValidate,
    build: UIBuild,
    active: UIActive,
    history: UIHistory,
    'history-detail': UIHistoryDetail,
  };

  let current = null;
  const container = () => document.getElementById('app');

  function show(name, params) {
    if (current && current.module.unmount) {
      current.module.unmount();
    }
    const module = screens[name];
    if (!module) throw new Error('Unknown screen: ' + name);

    const tpl = document.getElementById('tpl-' + name);
    container().innerHTML = '';
    container().appendChild(tpl.content.cloneNode(true));

    current = { name, module };
    module.mount(container(), params || {});
  }

  return { show, get current() { return current ? current.name : null; } };
})();
