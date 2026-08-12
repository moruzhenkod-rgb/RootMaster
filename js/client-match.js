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
    const cw = cNorm.split(' ')[0];

    // 1) кандидаты той же фирмы (по первому слову названия) + похожий адрес.
    //    Из них берём с координатами (ручные в приоритете) — чтобы точка встала на карту,
    //    даже если адрес отличается частично (Schwerin/Pampow, опечатки).
    if (cw) {
      const firmPool = clients.filter((c) => normAddr(c.company).split(' ')[0] === cw);
      const scored = firmPool.map((c) => ({
        c,
        sim: similarity(key, normAddr(c.address)),
        coord: (c.lat != null && c.lng != null) ? 1 : 0,
        manual: c.manual ? 1 : 0,
      })).filter((x) => x.sim >= 0.5);
      if (scored.length) {
        scored.sort((a, b) => (b.coord - a.coord) || (b.manual - a.manual) || (b.sim - a.sim));
        return scored[0].c;
      }
    }

    // 2) точное совпадение адреса — предпочитаем запись с координатами (и с той же фирмой)
    const exact = clients.filter((c) => normAddr(c.address) === key);
    if (exact.length) {
      const pool = (cNorm && exact.some((c) => normAddr(c.company).split(' ')[0] === cw))
        ? exact.filter((c) => normAddr(c.company).split(' ')[0] === cw) : exact;
      return pool.find((c) => c.lat != null && c.manual) || pool.find((c) => c.lat != null) || pool[0];
    }

    // 3) подмножество токенов / опечатки — с координатами в приоритете
    let best = null, bestScore = -1;
    for (const c of clients) {
      const ck = normAddr(c.address);
      if (!ck) continue;
      const keyTokens = tokenize(key), ckTokens = tokenize(ck);
      const [shortTokens, longTokens] = keyTokens.length <= ckTokens.length ? [keyTokens, ckTokens] : [ckTokens, keyTokens];
      let hit = false;
      if (shortTokens.length) {
        const longSet = new Set(longTokens);
        if (shortTokens.every((t) => longSet.has(t))) hit = true;
      }
      const dist = levenshtein(key, ck);
      const thr = Math.max(2, Math.floor(Math.min(key.length, ck.length) * 0.25));
      if (hit || dist <= thr) {
        const score = (c.lat != null ? 1000 : 0) + (hit ? 500 : 0) - dist;
        if (score > bestScore) { best = c; bestScore = score; }
      }
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
