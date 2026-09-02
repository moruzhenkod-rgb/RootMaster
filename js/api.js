// Клиент серверного API: авторизация и синхронизация туров
const Api = (() => {
  const TOKEN_KEY = 'rm_token';
  const NAME_KEY = 'rm_display_name';
  const USER_KEY = 'rm_username';

  const token = () => localStorage.getItem(TOKEN_KEY);
  const displayName = () => localStorage.getItem(NAME_KEY) || '';
  const username = () => localStorage.getItem(USER_KEY) || '';
  const isAuthed = () => !!token();
  const ADMIN_USERS = ['r038']; // админы (по логину)
  const isAdmin = () => ADMIN_USERS.indexOf((username() || '').toLowerCase()) !== -1 || (displayName() || '').toLowerCase() === 'dima';

  function setSession(data) {
    const prev = (localStorage.getItem(USER_KEY) || '').toLowerCase();
    const next = String(data.username || '').toLowerCase();
    // сменился аккаунт — тур/история чужие не нужны; клиентов НЕ стираем (init подтянет своих, чтобы автозаполнение не ломалось)
    if (prev && next && prev !== next) {
      localStorage.removeItem('rm_current_tour');
      localStorage.removeItem('rm_tour_history');
    }
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(NAME_KEY, data.displayName || '');
    localStorage.setItem(USER_KEY, data.username || '');
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(NAME_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function req(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const t = token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    const res = await fetch('/api' + path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Ошибка сервера');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function register(u, dn, pw) {
    const data = await req('/register', { method: 'POST', body: JSON.stringify({ username: u, displayName: dn, password: pw }) });
    setSession(data);
    return data;
  }
  async function login(u, pw) {
    const data = await req('/login', { method: 'POST', body: JSON.stringify({ username: u, password: pw }) });
    setSession(data);
    return data;
  }
  const getTours = () => req('/tours');
  const getClients = () => req('/clients');
  const updateClient = (company, oldAddress, address, akey, cell, newCompany, lat, lng) => req('/client', { method: 'PUT', body: JSON.stringify({ company, oldAddress, address, akey, cell, newCompany, lat, lng }) });
  const deleteClient = (company, address) => req('/client', { method: 'DELETE', body: JSON.stringify({ company, address }) });
  const putTours = (current, history) => req('/tours', { method: 'PUT', body: JSON.stringify({ current, history }) });
  const sendPresence = (lat, lng, tourId) => req('/presence', { method: 'POST', body: JSON.stringify({ lat, lng, tourId }) });
  const getActiveUsers = () => req('/admin/active');
  const getUserDetail = (id) => req('/admin/user/' + encodeURIComponent(id));
  const getFinishedTours = () => req('/admin/tours');
  const getTrack = (userId, tourId) => req('/admin/track/' + encodeURIComponent(userId) + '/' + encodeURIComponent(tourId));

  return { token, displayName, username, isAuthed, isAdmin, setSession, clearSession, register, login, getTours, putTours, getClients, updateClient, deleteClient, sendPresence, getActiveUsers, getUserDetail, getFinishedTours, getTrack };
})();
