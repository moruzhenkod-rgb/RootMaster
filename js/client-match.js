// Сопоставление адреса с базой клиентов: точное совпадение, совпадение по словам
// (доп./недостающий «дом», «строение» и т.п.) или близкое написание с опечаткой.
const ClientMatch = (() => {
  function loadClients() {
    try { return JSON.parse(localStorage.getItem('rm_clients') || '[]'); } catch (e) { return []; }
  }

  function normAddr(a) {
    let s = String(a || '').toLowerCase();
    // транслитерация немецких умлаутов: ö→oe, ü→ue, ä→ae, ß→ss (единое написание)
    s = s.replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue');
    s = s.replace(/[^0-9a-zа-яё]+/gi, ' ').trim();
    // раскрыть сокращение улицы: ...str / str. → ...strasse (Bornhoevedstr → bornhoevedstrasse)
    s = s.replace(/str\b/g, 'strasse');
    // склеить номер дома с литерой: «65 a» → «65a» (совпадение с «65a»)
    s = s.replace(/(\d)\s+([a-zа-яё])(?=\s|$)/gi, '$1$2');
    return s.replace(/\s+/g, ' ').trim();
  }

  function tokenize(s) {
    return s.split(' ').filter(Boolean);
  }

  // номер дома из нормализованного адреса (1-3 цифры, не 5-значный индекс)
  function houseNum(s) {
    const toks = String(s || '').split(' ');
    for (const t of toks) {
      if (/^\d{5}$/.test(t)) continue; // это PLZ
      const m = t.match(/^(\d{1,3})[a-zа-яё]?$/);
      if (m) return m[1];
    }
    return '';
  }
  // совместимы, если у одного нет номера или номера совпадают
  function houseCompat(a, b) { return !a || !b || a === b; }

  // значимые слова улицы (до индекса, без «strasse»/номера) — чтобы не путать разные улицы с одинаковым домом+индексом
  function streetName(s) {
    const toks = String(s || '').split(' ');
    const words = [];
    for (const t of toks) {
      if (/^\d{5}$/.test(t)) break; // дошли до индекса — дальше город
      if (/[a-zа-яё]/i.test(t) && t !== 'strasse' && t !== 'str') words.push(t);
    }
    return words;
  }
  // одна и та же улица? достаточно совпадения одного значимого слова (>=4 букв)
  function sameStreet(a, b) {
    const sa = streetName(a), sb = streetName(b);
    if (!sa.length || !sb.length) return true; // нет данных об улице — не блокируем
    const setB = new Set(sb);
    return sa.some((w) => w.length >= 4 && setB.has(w));
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
    const qNum = houseNum(key);

    // 1) кандидаты той же фирмы: сначала ТОЧНОЕ совпадение названия (надёжно),
    //    иначе по первому слову (только если оно длинное — избегаем «h», «a»).
    let firmPool = cNorm ? clients.filter((c) => normAddr(c.company) === cNorm) : [];
    const exactFirm = firmPool.length > 0;
    if (!firmPool.length && cw.length >= 3) {
      firmPool = clients.filter((c) => normAddr(c.company).split(' ')[0] === cw);
    }
    if (firmPool.length) {
      const scored = firmPool.map((c) => ({
        c,
        sim: similarity(key, normAddr(c.address)),
        coord: (c.lat != null && c.lng != null) ? 1 : 0,
        manual: c.manual ? 1 : 0,
      }));
      // если фирма совпала ТОЧНО — берём запись с координатами даже при слабом адресе;
      // иначе требуем достаточную похожесть адреса
      const good = scored.filter((s) => (s.sim >= 0.5 || (exactFirm && s.coord)) && houseCompat(qNum, houseNum(normAddr(s.c.address))) && sameStreet(key, normAddr(s.c.address)));
      if (good.length) {
        good.sort((a, b) => (b.coord - a.coord) || (b.manual - a.manual) || (b.sim - a.sim));
        return good[0].c;
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
      if (!houseCompat(qNum, houseNum(ck))) continue;
      if (!sameStreet(key, ck)) continue;
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
