// Сопоставление адреса с базой клиентов: точное совпадение, совпадение по словам
// (доп./недостающий «дом», «строение» и т.п.) или близкое написание с опечаткой.
const ClientMatch = (() => {
  function loadClients() {
    try { return JSON.parse(localStorage.getItem('rm_clients') || '[]'); } catch (e) { return []; }
  }

  function normAddr(a) {
    return String(a || '').toLowerCase().replace(/[^0-9a-zа-яё]+/gi, ' ').trim();
  }

  function tokenize(s) {
    return s.split(' ').filter(Boolean);
  }

  // расстояние Левенштейна — для распознавания адреса с опечаткой
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  // ratio — насколько адреса похожи: 0 (совсем разные) .. 1 (идентичные после нормализации)
  function similarity(key, ck) {
    if (!key || !ck) return 0;
    if (key === ck) return 1;
    const keyTokens = tokenize(key), ckTokens = tokenize(ck);
    const [shortTokens, longTokens] = keyTokens.length <= ckTokens.length ? [keyTokens, ckTokens] : [ckTokens, keyTokens];
    if (shortTokens.length) {
      const longSet = new Set(longTokens);
      if (shortTokens.every((t) => longSet.has(t))) return 0.99;
    }
    const dist = levenshtein(key, ck);
    const maxLen = Math.max(key.length, ck.length);
    return maxLen ? 1 - dist / maxLen : 0;
  }

  // найти клиента для автоматической подстановки (строгий порог — без подтверждения пользователя)
  function matchClient(address, company, clients) {
    const key = normAddr(address);
    if (!key || !clients || !clients.length) return null;
    const cNorm = normAddr(company || '');
    // все точные совпадения по адресу — на одном адресе может быть несколько фирм
    const exact = clients.filter((c) => normAddr(c.address) === key);
    if (exact.length) {
      if (exact.length === 1 || !cNorm) return exact[0];
      return exact.find((c) => normAddr(c.company) === cNorm)
        || exact.find((c) => normAddr(c.company).split(' ')[0] === cNorm.split(' ')[0])
        || exact[0];
    }
    // подмножество токенов / опечатки
    let best = null, bestDist = Infinity;
    for (const c of clients) {
      const ck = normAddr(c.address);
      if (!ck) continue;
      const keyTokens = tokenize(key), ckTokens = tokenize(ck);
      const [shortTokens, longTokens] = keyTokens.length <= ckTokens.length ? [keyTokens, ckTokens] : [ckTokens, keyTokens];
      if (shortTokens.length) {
        const longSet = new Set(longTokens);
        if (shortTokens.every((t) => longSet.has(t))) return c;
      }
      const dist = levenshtein(key, ck);
      const thr = Math.max(2, Math.floor(Math.min(key.length, ck.length) * 0.25));
      if (dist <= thr && dist < bestDist) { best = c; bestDist = dist; }
    }
    return best;
  }

  // предложить наиболее похожего клиента даже при большем расхождении — требует подтверждения пользователем
  function suggestClient(address, clients, minSimilarity = 0.55) {
    const key = normAddr(address);
    if (!key || !clients || !clients.length) return null;
    let best = null, bestScore = 0;
    for (const c of clients) {
      const ck = normAddr(c.address);
      if (!ck) continue;
      const score = similarity(key, ck);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best && bestScore >= minSimilarity) return { client: best, score: bestScore };
    return null;
  }

  return { loadClients, normAddr, matchClient, suggestClient };
})();
