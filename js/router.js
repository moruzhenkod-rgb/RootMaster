// Minimal screen router — swaps template content into #app
const Router = (() => {
  const screens = {
    auth: UIAuth,
    home: UIHome,
    clients: UIClients,
    manual: UIManual,
    settings: UISettings,
    radar2: UIRadar2,
    radar: UIRadar,
    paste: UIPaste,
    scan: UIScan,
    validate: UIValidate,
    build: UIBuild,
    active: UIActive,
    history: UIHistory,
    'history-detail': UIHistoryDetail,
    'active-users': UIActiveUsers,
    'user-detail': UIUserDetail,
    tracking: UITracking,
    'track-replay': UITrackReplay,
  };

  let current = null;
  const container = () => document.getElementById('app');

  function show(name, params) {
    if ((name === 'settings' || name === 'radar' || name === 'radar2' || name === 'active-users' || name === 'user-detail' || name === 'tracking' || name === 'track-replay') && typeof Api !== 'undefined' && !Api.isAdmin()) { name = 'home'; }
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
