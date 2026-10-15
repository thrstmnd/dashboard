/* =========================================================
   ХОРРОР-РАДАР — сборка дэшборда

   Здесь всё соединяется: запрашиваем данные, считаем по ним
   показатели, рисуем графики и таблицы, обрабатываем нажатия.

   Главный принцип: источники загружаются независимо друг от
   друга. Отвалился один — остальные блоки всё равно покажут
   данные, а в строке состояния сверху будет видно, кто не ответил.
   ========================================================= */

'use strict';

(function () {

  /* ---------- соответствие жанров ----------
     У каждого сервиса свой справочник жанров, поэтому один
     выбранный пункт раскладывается на четыре разных запроса. */
  const GENRES = {
    'Horror': {
      f2g: 'horror', itunes: 'horror',
      titles: null,            // null — берём список по умолчанию из config.js
      films: null
    },
    'Psychological': {
      f2g: 'horror', itunes: 'psychological thriller',
      titles: ['Silent Hill', 'SOMA', 'Layers of Fear', 'Observer', 'Darkwood'],
      films: ['Black Swan', 'Shutter Island', 'Perfect Blue', 'Jacobs Ladder', 'Mother!', 'Enemy', 'The Lighthouse', 'Possession']
    },
    'Mystery': {
      f2g: 'horror', itunes: 'mystery',
      titles: ['Outlast', 'Visage', 'Darkwood', 'Amnesia'],
      films: ['Se7en', 'Zodiac', 'Prisoners', 'The Prestige', 'Memento', 'Gone Girl', 'The Others', 'Oldboy']
    },
    'Sci-Fi': {
      f2g: 'shooter', itunes: 'sci-fi horror',
      titles: ['Dead Space', 'Alien Isolation', 'Prey', 'SOMA'],
      films: ['Event Horizon', 'The Fly', 'Annihilation', 'Life', 'Sunshine', 'Pandorum', 'Prometheus', 'Under the Skin']
    }
  };

  /* ---------- состояние ---------- */
  const state = {
    genre: 'Horror',
    anime: [],
    deals: [],
    free: [],
    movies: [],
    spotify: null,
    sort: { key: 'savings', dir: -1 }
  };

  const $ = function (id) { return document.getElementById(id); };


  /* =======================================================
     Строка состояния источников
     ======================================================= */
  function status(src, kind, note) {
    const el = document.querySelector('.status__item[data-src="' + src + '"]');
    if (!el) return;
    el.className = 'status__item ' + kind;
    const mark = kind === 'ok' ? 'ok' : kind === 'bad' ? 'err' : '…';
    el.innerHTML = src + ' <b>' + mark + '</b>';
    if (note) el.title = note;
  }

  function clock() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    $('clock').textContent = 'обновлено ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }


  /* =======================================================
     ЗАГРУЗКА

     Каждый источник запускается отдельно и сам рисует свой блок,
     как только ответит. Так страница наполняется постепенно,
     а не ждёт самого медленного.
     ======================================================= */
  function loadAll() {
    const g = GENRES[state.genre];

    /* --- аниме --- */
    status('anilist', 'wait');
    API.anime(state.genre)
      .then(function (list) {
        state.anime = list;
        status('anilist', 'ok');
        drawAnime();
        drawStats();
      })
      .catch(function (e) {
        status('anilist', 'bad', e.message);
        $('c-years').innerHTML = '<p class="viz-empty">anilist не ответил</p>';
      });

    /* --- цены и скидки --- */
    status('cheapshark', 'wait');
    API.deals(g.titles || CONFIG.horrorTitles)
      .then(function (list) {
        state.deals = list;
        status('cheapshark', list.length ? 'ok' : 'bad');
        drawDeals();
        drawStats();
      })
      .catch(function (e) {
        status('cheapshark', 'bad', e.message);
      });

    /* --- бесплатные игры --- */
    status('freetogame', 'wait');
    API.freeGames(g.f2g)
      .then(function (list) {
        state.free = list;
        status('freetogame', 'ok');
        drawPlatforms();
      })
      .catch(function (e) {
        status('freetogame', 'bad', e.message);
        $('c-platform').innerHTML = '<p class="viz-empty">freetogame не ответил</p>';
      });

    /* --- фильмы ---
       Основной источник — OMDb: он даёт постер, год и оценку IMDb.
       Если ключа нет, подставляем iTunes: там нет оценок, зато
       не нужна регистрация. */
    if (CONFIG.omdbKey) {
      status('omdb', 'wait');
      status('itunes', 'bad', 'не используется: фильмы берём из OMDb');

      API.films(g.films || CONFIG.horrorFilms)
        .then(function (list) {
          state.movies = list;
          status('omdb', list.length ? 'ok' : 'bad',
            list.length ? '' : 'ни один фильм из списка не нашёлся');
          drawMovies();
        })
        .catch(function (e) {
          status('omdb', 'bad', e.message);
          drawMovies();
        });

    } else {
      status('omdb', 'bad', 'ключ не указан в config.js');
      status('itunes', 'wait');

      API.movies(g.itunes)
        .then(function (list) {
          state.movies = list;
          status('itunes', list.length ? 'ok' : 'bad',
            list.length ? '' : 'поиск ничего не вернул');
          drawMovies();
        })
        .catch(function (e) {
          status('itunes', 'bad', e.message);
          drawMovies();
        });
    }

    clock();
  }


  /* =======================================================
     СВОДКА
     ======================================================= */
  function drawStats() {
    const d = state.deals;
    const a = state.anime;

    $('s-deals').textContent = d.length || '—';
    $('s-deals-n').textContent = d.length ? 'по ' + (GENRES[state.genre].titles || CONFIG.horrorTitles).length + ' франшизам' : 'нет данных';

    const max = d.reduce(function (m, x) { return Math.max(m, x.savings); }, 0);
    const best = d.find(function (x) { return x.savings === max; });
    $('s-max').textContent = max ? max + '%' : '—';
    $('s-max-n').textContent = best ? best.title : 'нет данных';

    $('s-anime').textContent = a.length || '—';
    $('s-anime-n').textContent = a.length ? 'самых популярных' : 'нет данных';

    const scored = a.filter(function (x) { return x.score; });
    const avg = scored.length
      ? Math.round(scored.reduce(function (s, x) { return s + x.score; }, 0) / scored.length)
      : 0;
    $('s-score').textContent = avg ? avg : '—';
    $('s-score-n').textContent = avg ? 'из 100 · по ' + scored.length + ' тайтлам' : 'нет данных';
  }


  /* =======================================================
     ГРАФИКИ
     ======================================================= */

  /* Сколько аниме жанра выходило в каждом году */
  function drawAnime() {
    const byYear = {};
    state.anime.forEach(function (m) {
      if (!m.year || m.year < 1990) return;
      byYear[m.year] = (byYear[m.year] || 0) + 1;
    });

    const years = Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; });
    const data = years.map(function (y) { return { label: String(y), value: byYear[y] }; });

    Charts.bars($('c-years'), data, {
      title: 'аниме жанра по годам',
      tipLabel: 'тайтлов',
      headX: 'год', headY: 'тайтлов'
    });

    /* карточки */
    const grid = $('g-anime');
    grid.innerHTML = '';
    state.anime.slice(0, 12).forEach(function (m) {
      const a = document.createElement('a');
      a.className = 'item';
      a.href = m.url; a.target = '_blank'; a.rel = 'noopener';
      a.innerHTML =
        '<img src="' + m.cover + '" alt="" loading="lazy">' +
        '<div class="item__t"><p class="item__n">' + escape(m.title) + '</p>' +
        '<p class="item__m">' + (m.year || '—') +
        (m.score ? ' · <b>' + m.score + '</b>' : '') + '</p></div>';
      grid.appendChild(a);
    });
  }

  /* Цена против доли положительных отзывов */
  function drawPrice() {
    const pts = state.deals
      .filter(function (d) { return d.steam && d.sale >= 0; })
      .map(function (d) {
        return {
          x: Math.round(d.sale * 100) / 100,
          y: d.steam,
          label: d.title,
          extra: 'скидка ' + d.savings + '%' + (d.metacritic ? ' · meta ' + d.metacritic : '')
        };
      });

    Charts.scatter($('c-price'), pts, {
      title: 'цена против отзывов',
      nameX: 'цена, $', nameY: 'отзывы',
      suffixX: '', suffixY: '%',
      headX: 'игра'
    });
  }

  /* Распределение оценок Metacritic по диапазонам */
  function drawMeta() {
    const buckets = [
      { label: '<50', from: 0,  to: 49 },
      { label: '50+', from: 50, to: 59 },
      { label: '60+', from: 60, to: 69 },
      { label: '70+', from: 70, to: 79 },
      { label: '80+', from: 80, to: 89 },
      { label: '90+', from: 90, to: 100 }
    ];

    const data = buckets.map(function (b) {
      return {
        label: b.label,
        value: state.deals.filter(function (d) {
          return d.metacritic && d.metacritic >= b.from && d.metacritic <= b.to;
        }).length
      };
    });

    Charts.bars($('c-meta'), data, {
      title: 'оценки metacritic',
      tipLabel: 'игр',
      headX: 'диапазон', headY: 'игр'
    });
  }

  function drawDeals() {
    drawPrice();
    drawMeta();
    drawTable();
  }

  /* Бесплатные игры по платформам */
  function drawPlatforms() {
    const by = {};
    state.free.forEach(function (g) {
      const key = g.platform || 'не указано';
      by[key] = (by[key] || 0) + 1;
    });

    const data = Object.keys(by)
      .map(function (k) { return { label: k, value: by[k] }; })
      .sort(function (a, b) { return b.value - a.value; });

    Charts.hbars($('c-platform'), data, {
      title: 'игры по платформам',
      tipLabel: 'игр',
      headX: 'платформа', headY: 'игр'
    });
  }


  /* =======================================================
     ТАБЛИЦА СКИДОК — с сортировкой по любому столбцу
     ======================================================= */
  function drawTable() {
    const body = $('t-deals-body');
    const rows = state.deals.slice().sort(function (a, b) {
      const k = state.sort.key;
      const av = a[k], bv = b[k];
      if (typeof av === 'string') return av.localeCompare(bv) * state.sort.dir;
      return ((av || 0) - (bv || 0)) * state.sort.dir;
    });

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="muted">нет данных</td></tr>';
      return;
    }

    body.innerHTML = rows.slice(0, 40).map(function (d) {
      return '<tr>' +
        '<td class="name">' + escape(d.title) + '</td>' +
        '<td class="num">$' + d.sale.toFixed(2) + '</td>' +
        '<td class="num muted">$' + d.full.toFixed(2) + '</td>' +
        '<td class="num tag">' + (d.savings ? '−' + d.savings + '%' : '—') + '</td>' +
        '<td class="num">' + (d.steam ? d.steam + '%' : '—') + '</td>' +
        '<td class="num">' + (d.metacritic || '—') + '</td>' +
        '<td class="num"><a class="go" href="' + d.link + '" target="_blank" rel="noopener">купить ↗</a></td>' +
        '</tr>';
    }).join('');
  }

  document.querySelectorAll('#t-deals th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      const key = th.dataset.sort;
      state.sort.dir = state.sort.key === key ? -state.sort.dir : -1;
      state.sort.key = key;
      drawTable();
    });
  });


  /* =======================================================
     ФИЛЬМЫ
     ======================================================= */
  function drawMovies() {
    const grid = $('g-movies');
    grid.innerHTML = '';

    if (!state.movies.length) {
      grid.innerHTML = '<p class="muted">фильмы не загрузились — проверь ключ OMDb в js/config.js ' +
        'и строку состояния наверху</p>';
      return;
    }

    state.movies.slice(0, 12).forEach(function (m) {
      const a = document.createElement('a');
      a.className = 'item';
      a.href = m.url || '#'; a.target = '_blank'; a.rel = 'noopener';
      a.title = m.genre || '';
      a.innerHTML =
        (m.art ? '<img src="' + m.art + '" alt="" loading="lazy">' : '<div class="item__noart">нет постера</div>') +
        '<div class="item__t"><p class="item__n">' + escape(m.title) + '</p>' +
        '<p class="item__m">' + (m.year || '—') +
        (m.imdb ? ' · <b>' + m.imdb + '</b>' : '') + '</p></div>';
      grid.appendChild(a);
    });
  }


  /* =======================================================
     SPOTIFY
     ======================================================= */
  async function loadSpotify() {
    status('spotify', 'wait');

    const res = await Spotify.load();

    if (!res.snap) {
      status('spotify', 'bad', res.error || 'нет связи и нет сохранённого снимка');
      $('sp-empty').textContent = res.error
        ? 'spotify недоступен: ' + res.error + '. Войди под VPN, чтобы сделать снимок.'
        : 'данных пока нет — войди в spotify, чтобы загрузить свою статистику.';
      return;
    }

    state.spotify = res.snap;

    const when = new Date(res.snap.savedAt);
    $('sp-note').textContent = res.live
      ? 'источник: spotify · данные живые'
      : 'источник: spotify · снимок от ' + when.toLocaleDateString('ru-RU') +
        ' ' + when.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) +
        ' · сейчас связи нет';

    status('spotify', res.live ? 'ok' : 'wait', res.live ? '' : 'показан сохранённый снимок');

    $('sp-empty').hidden = true;
    $('sp-content').hidden = false;
    $('sp-save').hidden = !res.live;
    $('sp-out').hidden = !Spotify.hasToken();
    $('sp-login').hidden = res.live;

    drawSpotify();
  }

  function drawSpotify() {
    const snap = state.spotify;
    if (!snap) return;

    /* Когда я слушаю: по часам суток, из истории прослушиваний */
    const hours = new Array(24).fill(0);
    (snap.recent || []).forEach(function (r) {
      hours[new Date(r.at).getHours()]++;
    });
    Charts.bars($('c-hours'), hours.map(function (v, i) {
      return { label: String(i), value: v };
    }), { title: 'прослушивания по часам', tipLabel: 'треков', headX: 'час', headY: 'треков', height: 180 });

    /* Из каких лет музыка.

       Важное ограничение: Spotify отдаёт максимум 50 треков на запрос
       и не более 50 записей истории. Поэтому считаем не «всю музыку,
       которую ты слушаешь», а выборку: три топа плюс последние
       прослушивания. Один и тот же трек в разных топах не должен
       считаться дважды, поэтому убираем повторы по названию и артисту. */
    const seen = {};
    const years = {};
    let counted = 0;

    function addYear(t) {
      if (!t || !t.year) return;
      const key = (t.name + '|' + t.artist).toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      years[t.year] = (years[t.year] || 0) + 1;
      counted++;
    }

    ['month', 'halfYear', 'allTime'].forEach(function (k) {
      (snap.tracks && snap.tracks[k] ? snap.tracks[k] : []).forEach(addYear);
    });
    (snap.recent || []).forEach(addYear);

    const yData = Object.keys(years).map(Number).sort(function (a, b) { return a - b; })
      .map(function (y) { return { label: String(y), value: years[y] }; });

    $('sp-years-note').textContent = counted
      ? 'выборка: ' + counted + ' разных треков из топов и истории'
      : '';

    Charts.bars($('c-years-music'), yData, {
      title: 'годы релизов', tipLabel: 'треков', headX: 'год', headY: 'треков', height: 180
    });

    drawRanks();
  }

  function drawRanks() {
    const snap = state.spotify;
    const range = $('sp-range').value;

    const artists = (snap.artists && snap.artists[range]) || [];
    $('sp-artists').innerHTML = artists.slice(0, 10).map(function (a, i) {
      return '<li><span class="i">' + (i + 1) + '</span><span class="n">' + escape(a.name) + '</span></li>';
    }).join('') || '<li class="muted">нет данных</li>';

    const tracks = (snap.tracks && snap.tracks[range]) || [];
    $('sp-tracks').innerHTML = tracks.slice(0, 10).map(function (t, i) {
      return '<li><span class="i">' + (i + 1) + '</span><span class="n">' + escape(t.name) +
        '</span><span class="x">' + escape(t.artist.split(',')[0]) + '</span></li>';
    }).join('') || '<li class="muted">нет данных</li>';

    const pl = (snap.playlists || []).slice().sort(function (a, b) { return b.count - a.count; });
    $('sp-playlists').innerHTML = pl.slice(0, 10).map(function (p, i) {
      return '<li><span class="i">' + (i + 1) + '</span><span class="n">' + escape(p.name) +
        '</span><span class="x">' + p.count + '</span></li>';
    }).join('') || '<li class="muted">нет данных</li>';
  }


  /* =======================================================
     Мелочи
     ======================================================= */
  function escape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* Графики рисуются под ширину контейнера, поэтому при изменении
     размера окна их надо перерисовать. */
  let resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      Charts.hideTip();
      if (state.anime.length) drawAnime();
      if (state.deals.length) drawDeals();
      if (state.free.length) drawPlatforms();
      if (state.spotify) drawSpotify();
    }, 200);
  });

  /* ---------- события ---------- */
  $('genre').addEventListener('change', function (e) {
    state.genre = e.target.value;
    loadAll();
  });

  $('reload').addEventListener('click', function () {
    loadAll();
    loadSpotify();
  });

  $('sp-login').addEventListener('click', function () { Spotify.login(); });

  $('sp-out').addEventListener('click', function () {
    Spotify.logout();
    location.reload();
  });

  $('sp-save').addEventListener('click', function () {
    if (state.spotify) Spotify.download(state.spotify);
  });

  $('sp-range').addEventListener('change', drawRanks);

  $('year').textContent = new Date().getFullYear();


  /* ---------- старт ---------- */
  loadAll();
  loadSpotify();

})();
