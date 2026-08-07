const UIAuth = (() => {
  let root, mode = 'login', busy = false;

  function mount(container) {
    root = container;
    render();
  }
  function unmount() {}

  function render() {
    const box = root.querySelector('#auth-box');
    box.innerHTML = `
      <div class="auth-card">
        <div class="auth-logo">RouteMaster</div>
        <div class="auth-tabs">
          <button class="auth-tab ${mode === 'login' ? 'active' : ''}" data-mode="login">Вход</button>
          <button class="auth-tab ${mode === 'register' ? 'active' : ''}" data-mode="register">Регистрация</button>
        </div>
        <form id="auth-form">
          <input name="username" placeholder="Имя пользователя (логин)" autocomplete="username" autocapitalize="none" />
          ${mode === 'register' ? '<input name="displayName" placeholder="Отображаемое имя" />' : ''}
          <input name="password" type="password" placeholder="Пароль" autocomplete="current-password" />
          <div class="auth-error" id="auth-error"></div>
          <button type="submit" class="btn btn-primary btn-large" id="auth-submit">
            ${mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </form>
      </div>`;

    box.querySelectorAll('.auth-tab').forEach((t) =>
      t.addEventListener('click', () => {
        if (busy) return;
        mode = t.dataset.mode;
        render();
      })
    );
    box.querySelector('#auth-form').addEventListener('submit', onSubmit);
  }

  function showError(msg) {
    const el = root.querySelector('#auth-error');
    if (el) el.textContent = msg || '';
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    const form = e.target;
    const u = form.username.value.trim();
    const pw = form.password.value;
    const dn = form.displayName ? form.displayName.value.trim() : '';
    showError('');

    if (u.length < 3) return showError('Логин минимум 3 символа');
    if (pw.length < 4) return showError('Пароль минимум 4 символа');
    if (mode === 'register' && !dn) return showError('Укажите отображаемое имя');

    busy = true;
    const btn = form.querySelector('#auth-submit');
    btn.disabled = true;
    btn.textContent = 'Секунду…';
    try {
      if (mode === 'register') {
        await Api.register(u, dn, pw);
        // импорт локальных туров (старые данные) в новый профиль
        const localCur = Storage.loadCurrent();
        const localHist = Storage.loadHistory();
        if ((localCur && localCur.points && localCur.points.length) || localHist.length) {
          await Api.putTours(localCur, localHist);
        }
      } else {
        await Api.login(u, pw);
      }
      // перезапуск: App.init подхватит токен и загрузит туры профиля
      window.location.reload();
    } catch (err) {
      busy = false;
      btn.disabled = false;
      btn.textContent = mode === 'login' ? 'Войти' : 'Зарегистрироваться';
      showError(err.message || 'Ошибка');
    }
  }

  return { mount, unmount };
})();
