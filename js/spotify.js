/* =========================================================
   ХОРРОР-РАДАР — блок Spotify

   Задача непростая: сервис доступен не из всякой сети.
   Поэтому блок устроен так, чтобы пережить отсутствие связи.

   1. Вход — схема PKCE. Она придумана как раз для страниц без
      сервера: вместо секретного ключа страница придумывает
      случайную строку, отправляет Spotify её отпечаток, а при
      обмене кода на пропуск показывает саму строку. Подменить
      нельзя, секрет хранить не нужно.

   2. Данные кэшируются. Удалось достучаться — рисуем свежее и
      предлагаем сохранить снимок в файл. Не удалось — читаем
      снимок из data/spotify-cache.json и честно пишем его дату.
   ========================================================= */

'use strict';

const Spotify = (function () {

  const AUTH = 'https://accounts.spotify.com/authorize';
  const TOKEN = 'https://accounts.spotify.com/api/token';
  const API_BASE = 'https://api.spotify.com/v1';

  const SCOPES = [
    'user-top-read',               // топ артистов и треков
    'user-read-recently-played',   // история прослушиваний
    'playlist-read-private'        // плейлисты
  ].join(' ');

  const STORE = {
    verifier: 'hr_verifier',
    token: 'hr_token',
    snapshot: 'hr_snapshot'
  };


  /* ---------- адрес возврата ---------- */

  function redirectUri() {
    if (CONFIG.spotifyRedirect) return CONFIG.spotifyRedirect;
    // адрес текущей страницы без параметров и якоря
    return location.origin + location.pathname;
  }


  /* ---------- вспомогательное для PKCE ---------- */

  function randomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
    return out;
  }

  /* Отпечаток строки: SHA-256, затем запись в base64 без символов,
     которые нельзя ставить в адрес. */
  async function challenge(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    let bin = '';
    new Uint8Array(digest).forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }


  /* ---------- вход ---------- */

  async function login() {
    const verifier = randomString(64);
    localStorage.setItem(STORE.verifier, verifier);

    const params = new URLSearchParams({
      client_id: CONFIG.spotifyClientId,
      response_type: 'code',
      redirect_uri: redirectUri(),
      scope: SCOPES,
      code_challenge_method: 'S256',
      code_challenge: await challenge(verifier)
    });

    location.href = AUTH + '?' + params.toString();
  }

  function logout() {
    localStorage.removeItem(STORE.token);
    localStorage.removeItem(STORE.verifier);
  }


  /* ---------- обмен кода на пропуск ---------- */

  async function exchange(code) {
    const verifier = localStorage.getItem(STORE.verifier);
    if (!verifier) throw new Error('потерялась проверочная строка — попробуй войти заново');

    const res = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CONFIG.spotifyClientId,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri(),
        code_verifier: verifier
      })
    });

    if (!res.ok) throw new Error('Spotify отклонил вход (' + res.status + ')');

    const data = await res.json();
    save(data);
    return data;
  }

  function save(data) {
    localStorage.setItem(STORE.token, JSON.stringify({
      access: data.access_token,
      refresh: data.refresh_token || readToken().refresh,
      expires: Date.now() + (data.expires_in - 60) * 1000   // минута запаса
    }));
  }

  function readToken() {
    try { return JSON.parse(localStorage.getItem(STORE.token)) || {}; }
    catch (e) { return {}; }
  }

  /* Пропуск живёт час. Если истёк — пробуем обновить по refresh-коду. */
  async function freshToken() {
    const t = readToken();
    if (!t.access) return null;
    if (Date.now() < t.expires) return t.access;
    if (!t.refresh) return null;

    const res = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CONFIG.spotifyClientId,
        grant_type: 'refresh_token',
        refresh_token: t.refresh
      })
    });

    if (!res.ok) return null;
    const data = await res.json();
    save(data);
    return data.access_token;
  }


  /* ---------- запросы ---------- */

  async function get(path, token) {
    const res = await fetch(API_BASE + path, {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) throw new Error('Spotify: ' + res.status + ' на ' + path);
    return res.json();
  }

  /* Собирает полный снимок: топы за три периода, историю и плейлисты */
  async function fetchAll(token) {
    const ranges = { month: 'short_term', halfYear: 'medium_term', allTime: 'long_term' };
    const snap = { savedAt: new Date().toISOString(), artists: {}, tracks: {}, recent: [], playlists: [] };

    /* 50 — потолок Spotify на один запрос. Больше за раз не отдаст,
       поэтому выборка для графика по годам ограничена сверху. */
    for (const key in ranges) {
      const a = await get('/me/top/artists?limit=50&time_range=' + ranges[key], token);
      snap.artists[key] = (a.items || []).map(function (x) {
        return { name: x.name, img: x.images && x.images[2] ? x.images[2].url : '', url: x.external_urls.spotify };
      });

      const t = await get('/me/top/tracks?limit=50&time_range=' + ranges[key], token);
      snap.tracks[key] = (t.items || []).map(function (x) {
        return {
          name: x.name,
          artist: (x.artists || []).map(function (ar) { return ar.name; }).join(', '),
          year: x.album && x.album.release_date ? parseInt(x.album.release_date.slice(0, 4), 10) : null,
          img: x.album && x.album.images && x.album.images[2] ? x.album.images[2].url : '',
          url: x.external_urls.spotify
        };
      });
    }

    /* История тоже ограничена полусотней записей — это предел Spotify,
       глубже она не отдаётся. Год релиза забираем и отсюда: вместе с
       топами получается заметно более представительная выборка. */
    const r = await get('/me/player/recently-played?limit=50', token);
    snap.recent = (r.items || []).map(function (x) {
      return {
        name: x.track.name,
        artist: (x.track.artists || []).map(function (a) { return a.name; }).join(', '),
        year: x.track.album && x.track.album.release_date
          ? parseInt(x.track.album.release_date.slice(0, 4), 10) : null,
        at: x.played_at
      };
    });

    const p = await get('/me/playlists?limit=50', token);
    snap.playlists = (p.items || []).map(function (x) {
      return { name: x.name, count: x.tracks ? x.tracks.total : 0 };
    });

    return snap;
  }


  /* ---------- кэш ---------- */

  function saveSnapshot(snap) {
    try { localStorage.setItem(STORE.snapshot, JSON.stringify(snap)); } catch (e) {}
  }

  function localSnapshot() {
    try { return JSON.parse(localStorage.getItem(STORE.snapshot)); }
    catch (e) { return null; }
  }

  /* Снимок из репозитория — его видят все, кто открыл сайт */
  async function fileSnapshot() {
    try {
      const res = await fetch('data/spotify-cache.json', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.savedAt ? data : null;
    } catch (e) {
      return null;
    }
  }

  /* Отдаёт файл на скачивание, чтобы положить его в data/ репозитория */
  function download(snap) {
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'spotify-cache.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }


  /* ---------- главная точка входа ----------
     Возвращает { snap, live, error }:
     live = true  — данные только что получены от Spotify
     live = false — показан сохранённый снимок                      */

  async function load() {
    /* вернулись после входа? */
    const params = new URLSearchParams(location.search);

    if (params.get('error')) {
      history.replaceState(null, '', redirectUri());
      return { snap: await anySnapshot(), live: false, error: 'вход отменён' };
    }

    if (params.get('code')) {
      try {
        await exchange(params.get('code'));
      } catch (e) {
        history.replaceState(null, '', redirectUri());
        return { snap: await anySnapshot(), live: false, error: e.message };
      }
      history.replaceState(null, '', redirectUri());
    }

    const token = await freshToken();
    if (!token) {
      return { snap: await anySnapshot(), live: false, error: null };
    }

    try {
      const snap = await fetchAll(token);
      saveSnapshot(snap);
      return { snap: snap, live: true, error: null };
    } catch (e) {
      return { snap: await anySnapshot(), live: false, error: e.message };
    }
  }

  /* Сначала то, что сохранил этот браузер, потом файл из репозитория */
  async function anySnapshot() {
    return localSnapshot() || await fileSnapshot();
  }


  return {
    load: load,
    login: login,
    logout: logout,
    download: download,
    hasToken: function () { return Boolean(readToken().access); }
  };

})();
