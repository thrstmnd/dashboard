/* =========================================================
   ХОРРОР-РАДАР — запросы к источникам данных

   Пять внешних сервисов. Каждая функция возвращает уже разобранные
   данные в том виде, в каком их ждут графики, — чтобы остальной код
   ничего не знал про форму чужих ответов.

   Общее правило: ошибка одного источника не должна рушить страницу.
   Поэтому каждый запрос обёрнут, а наверх уходит либо результат,
   либо понятное сообщение о сбое.
   ========================================================= */

'use strict';

const API = (function () {

  /* ---------- вспомогательное ---------- */

  function pause(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /* Запрос с таймаутом: если сервер не ответил за 12 секунд, считаем
     его недоступным. Без этого страница может висеть бесконечно. */
  async function request(url, options) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, 12000);

    try {
      const res = await fetch(url, Object.assign({ signal: ctrl.signal }, options || {}));
      if (!res.ok) throw new Error('сервер ответил ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }


  /* =======================================================
     ANILIST — аниме. GraphQL, без ключа.

     Берём самые популярные тайтлы жанра и считаем по ним
     статистику: сколько выходило по годам и какой средний балл.
     ======================================================= */

  const ANILIST_QUERY = `
    query ($page: Int, $genre: String) {
      Page(page: $page, perPage: 50) {
        media(type: ANIME, genre: $genre, sort: POPULARITY_DESC) {
          id
          title { romaji english }
          averageScore
          episodes
          popularity
          format
          startDate { year }
          coverImage { large }
          siteUrl
        }
      }
    }`;

  async function anime(genre) {
    const all = [];

    for (let page = 1; page <= CONFIG.anilistPages; page++) {
      const data = await request('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: ANILIST_QUERY,
          variables: { page: page, genre: genre }
        })
      });

      const list = data && data.data && data.data.Page ? data.data.Page.media : [];
      if (!list.length) break;

      list.forEach(function (m) {
        all.push({
          id: m.id,
          title: (m.title.english || m.title.romaji || '').trim(),
          score: m.averageScore,                 // 0–100, может быть null
          year: m.startDate ? m.startDate.year : null,
          episodes: m.episodes,
          popularity: m.popularity,
          format: m.format,
          cover: m.coverImage ? m.coverImage.large : '',
          url: m.siteUrl
        });
      });

      await pause(CONFIG.requestDelay);
    }

    return all;
  }


  /* =======================================================
     CHEAPSHARK — цены и скидки на игры. Без ключа.

     Фильтра по жанру у сервиса нет, поэтому жанр задаёт список
     названий из config.js: по каждому спрашиваем предложения
     и собираем всё в один массив.
     ======================================================= */

  async function deals(titles) {
    const seen = {};      // чтобы одна игра не попала дважды из разных запросов
    const out = [];

    for (let i = 0; i < titles.length; i++) {
      let list = [];

      try {
        list = await request(
          'https://www.cheapshark.com/api/1.0/deals?pageSize=12&sortBy=Price&title=' +
          encodeURIComponent(titles[i])
        );
      } catch (e) {
        // одна неудачная франшиза не повод ронять весь блок
        list = [];
      }

      list.forEach(function (d) {
        const key = d.title.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;

        const sale = parseFloat(d.salePrice);
        const full = parseFloat(d.normalPrice);

        out.push({
          title: d.title,
          sale: sale,
          full: full,
          savings: Math.round(parseFloat(d.savings) || 0),
          metacritic: parseInt(d.metacriticScore, 10) || null,
          steam: parseInt(d.steamRatingPercent, 10) || null,
          steamText: d.steamRatingText || '',
          released: d.releaseDate ? new Date(d.releaseDate * 1000).getFullYear() : null,
          thumb: d.thumb,
          link: 'https://www.cheapshark.com/redirect?dealID=' + d.dealID,
          franchise: titles[i]
        });
      });

      await pause(CONFIG.requestDelay);
    }

    return out;
  }


  /* =======================================================
     FREETOGAME — бесплатные игры. Без ключа.
     Здесь фильтр по жанру настоящий, прямо в адресе запроса.
     ======================================================= */

  async function freeGames(category) {
    const list = await request(
      'https://www.freetogame.com/api/games?category=' + encodeURIComponent(category)
    );

    return (list || []).map(function (g) {
      return {
        id: g.id,
        title: g.title,
        genre: g.genre,
        platform: g.platform,
        publisher: g.publisher,
        released: g.release_date ? parseInt(g.release_date.slice(0, 4), 10) : null,
        thumb: g.thumbnail,
        url: g.game_url
      };
    });
  }


  /* =======================================================
     ITUNES SEARCH — фильмы. Без ключа.
     Один запрос отдаёт сразу полсотни позиций с жанром и годом.
     ======================================================= */

  async function movies(term) {
    const data = await request(
      'https://itunes.apple.com/search?media=movie&limit=50&term=' + encodeURIComponent(term)
    );

    return (data.results || []).map(function (m) {
      return {
        title: m.trackName,
        genre: m.primaryGenreName,
        year: m.releaseDate ? parseInt(m.releaseDate.slice(0, 4), 10) : null,
        price: typeof m.trackPrice === 'number' && m.trackPrice > 0 ? m.trackPrice : null,
        art: m.artworkUrl100 ? m.artworkUrl100.replace('100x100', '300x300') : '',
        url: m.trackViewUrl,
        imdb: null          // заполнится из OMDb, если есть ключ
      };
    }).filter(function (m) { return m.title; });
  }


  /* =======================================================
     OMDB — фильмы. Нужен ключ.

     Поиска по жанру у сервиса нет, только по названию, поэтому
     жанр задаёт список из config.js — ровно как у игр с CheapShark.
     По каждой строке приходит карточка: постер, год, оценка IMDb,
     жанры, длительность.
     ======================================================= */

  async function films(titles) {
    const out = [];

    for (let i = 0; i < titles.length; i++) {
      try {
        const d = await request(
          'https://www.omdbapi.com/?apikey=' + encodeURIComponent(CONFIG.omdbKey) +
          '&type=movie&t=' + encodeURIComponent(titles[i])
        );

        /* OMDb отвечает кодом 200 даже когда ничего не нашёл,
           поэтому проверяем поле Response, а не статус запроса */
        if (!d || d.Response === 'False') continue;

        out.push({
          title: d.Title,
          year: parseInt(d.Year, 10) || null,
          imdb: d.imdbRating && d.imdbRating !== 'N/A' ? parseFloat(d.imdbRating) : null,
          genre: d.Genre && d.Genre !== 'N/A' ? d.Genre : '',
          runtime: d.Runtime && d.Runtime !== 'N/A' ? d.Runtime : '',
          art: d.Poster && d.Poster !== 'N/A' ? d.Poster : '',
          url: d.imdbID ? 'https://www.imdb.com/title/' + d.imdbID + '/' : '#'
        });
      } catch (e) {
        // один фильм не нашёлся — не повод ронять весь блок
      }

      await pause(CONFIG.requestDelay);
    }

    return out;
  }


  return {
    anime: anime,
    deals: deals,
    freeGames: freeGames,
    movies: movies,   // запасной источник фильмов, если нет ключа OMDb
    films: films
  };

})();
