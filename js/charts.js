/* =========================================================
   ХОРРОР-РАДАР — графики

   Рисуются вручную на SVG, без библиотек. Каждый график —
   одна серия данных, поэтому легенда не нужна: что показано,
   написано в заголовке блока.

   Общие правила, которых держимся:
   — сетка и оси бледные, данные яркие;
   — подписи не на каждом столбце, а только там, где нужно;
   — при наведении всплывает точное значение;
   — под каждым графиком можно открыть те же данные таблицей,
     это нужно и для доступности, и чтобы проверить цифры.
   ========================================================= */

'use strict';

const Charts = (function () {

  const NS = 'http://www.w3.org/2000/svg';

  /* Одна общая подсказка на всю страницу */
  let tip = null;

  function tipEl() {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'viz-tip';
      tip.setAttribute('role', 'status');
      document.body.appendChild(tip);
    }
    return tip;
  }

  function showTip(html, x, y) {
    const t = tipEl();
    t.innerHTML = html;
    t.style.display = 'block';
    const w = t.offsetWidth;
    let left = x + 14;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    t.style.left = left + 'px';
    t.style.top = (y + 14) + 'px';
  }

  function hideTip() {
    if (tip) tip.style.display = 'none';
  }

  document.addEventListener('scroll', hideTip, { passive: true });

  /* Короткая запись создания узла SVG */
  function node(name, attrs) {
    const el = document.createElementNS(NS, name);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  /* Красивый шаг для оси: 1, 2, 5, 10, 20, 50... */
  function niceStep(max, ticks) {
    const raw = max / (ticks || 4);
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const norm = raw / mag;
    const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  /* Горизонтальные линии сетки и подписи по вертикальной оси */
  function grid(svg, box, maxY, fmt) {
    const step = niceStep(maxY, 4);
    for (let v = 0; v <= maxY + 0.0001; v += step) {
      const y = box.y + box.h - (v / maxY) * box.h;

      svg.appendChild(node('line', {
        x1: box.x, y1: y, x2: box.x + box.w, y2: y,
        class: 'viz-grid'
      }));

      const label = node('text', { x: box.x - 8, y: y + 4, class: 'viz-axis', 'text-anchor': 'end' });
      label.textContent = fmt ? fmt(v) : String(Math.round(v * 100) / 100);
      svg.appendChild(label);
    }
  }

  /* Таблица с теми же числами — раскрывается по кнопке под графиком */
  function table(host, rows, head) {
    const wrap = document.createElement('div');
    wrap.className = 'viz-table';
    wrap.hidden = true;

    let html = '<table><thead><tr><th>' + head[0] + '</th><th>' + head[1] + '</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;

    const btn = document.createElement('button');
    btn.className = 'viz-toggle';
    btn.type = 'button';
    btn.textContent = 'показать данные';
    btn.addEventListener('click', function () {
      wrap.hidden = !wrap.hidden;
      btn.textContent = wrap.hidden ? 'показать данные' : 'скрыть данные';
    });

    host.appendChild(btn);
    host.appendChild(wrap);
  }

  /* Подготовка холста: чистим и меряем контейнер */
  function canvas(host, height) {
    host.innerHTML = '';
    const plot = document.createElement('div');
    plot.className = 'viz-plot';
    host.appendChild(plot);

    const w = Math.max(plot.clientWidth || host.clientWidth || 320, 260);
    const h = height || 230;

    const svg = node('svg', {
      width: w, height: h,
      viewBox: '0 0 ' + w + ' ' + h,
      role: 'img'
    });
    plot.appendChild(svg);

    return { svg: svg, w: w, h: h, host: host };
  }


  /* =======================================================
     СТОЛБЦЫ — сколько чего по годам и подобное
     data: [{ label, value }]
     ======================================================= */
  function bars(host, data, opts) {
    opts = opts || {};
    if (!data.length) { host.innerHTML = '<p class="viz-empty">нет данных</p>'; return; }

    const c = canvas(host, opts.height);
    const box = { x: 44, y: 14, w: c.w - 56, h: c.h - 46 };
    const maxY = Math.max.apply(null, data.map(function (d) { return d.value; })) || 1;

    grid(c.svg, box, maxY, opts.fmtY);

    /* 2 пикселя воздуха между соседними столбцами, чтобы они
       не сливались в одну полосу */
    const slot = box.w / data.length;
    /* 2 пикселя воздуха, но столбец не шире 56 — иначе при трёх-четырёх
       значениях график превращается в сплошную заливку */
    const bw = Math.min(Math.max(slot - 2, 2), 56);
    const shift = (slot - bw) / 2;

    data.forEach(function (d, i) {
      const h = (d.value / maxY) * box.h;
      const x = box.x + i * slot + shift;
      const y = box.y + box.h - h;

      const rect = node('rect', {
        x: x, y: y, width: bw, height: Math.max(h, 1),
        rx: Math.min(4, bw / 2),          // скругление только у верхушки столбца
        class: 'viz-bar'
      });

      rect.addEventListener('mousemove', function (e) {
        showTip('<b>' + d.label + '</b><br>' + (opts.tipLabel || 'значение') + ': ' + d.value, e.clientX, e.clientY);
      });
      rect.addEventListener('mouseleave', hideTip);

      c.svg.appendChild(rect);

      /* Подписи по горизонтали — не все подряд, иначе каша.
         Последнюю ставим только если она не налезет на предыдущую. */
      const every = Math.ceil(data.length / 8);
      const last = data.length - 1;
      const fits = i === last ? (last % every !== 0 && last % every > every / 2) : false;
      if (i % every === 0 || fits) {
        const t = node('text', {
          x: x + bw / 2, y: c.h - 12, class: 'viz-axis', 'text-anchor': 'middle'
        });
        t.textContent = d.label;
        c.svg.appendChild(t);
      }
    });

    c.svg.setAttribute('aria-label',
      (opts.title || 'график') + ': ' + data.length + ' значений, максимум ' + maxY);

    table(host, data.map(function (d) { return [d.label, d.value]; }),
      [opts.headX || 'значение', opts.headY || 'количество']);
  }


  /* =======================================================
     ГОРИЗОНТАЛЬНЫЕ СТОЛБЦЫ — когда подписи длинные
     data: [{ label, value }]
     ======================================================= */
  function hbars(host, data, opts) {
    opts = opts || {};
    if (!data.length) { host.innerHTML = '<p class="viz-empty">нет данных</p>'; return; }

    const rowH = 26;
    const c = canvas(host, data.length * rowH + 20);
    const labelW = Math.min(150, Math.max(90, c.w * 0.34));
    const box = { x: labelW, y: 8, w: c.w - labelW - 46, h: data.length * rowH };
    const maxX = Math.max.apply(null, data.map(function (d) { return d.value; })) || 1;

    data.forEach(function (d, i) {
      const y = box.y + i * rowH;
      const w = (d.value / maxX) * box.w;

      const name = node('text', { x: labelW - 10, y: y + rowH / 2 + 4, class: 'viz-axis', 'text-anchor': 'end' });
      name.textContent = d.label.length > 20 ? d.label.slice(0, 19) + '…' : d.label;
      c.svg.appendChild(name);

      const rect = node('rect', {
        x: box.x, y: y + 4, width: Math.max(w, 2), height: rowH - 10,
        rx: 4, class: 'viz-bar'
      });
      rect.addEventListener('mousemove', function (e) {
        showTip('<b>' + d.label + '</b><br>' + (opts.tipLabel || 'значение') + ': ' + d.value, e.clientX, e.clientY);
      });
      rect.addEventListener('mouseleave', hideTip);
      c.svg.appendChild(rect);

      /* Значение подписываем прямо у столбца — так не нужна ось */
      const val = node('text', { x: box.x + Math.max(w, 2) + 7, y: y + rowH / 2 + 4, class: 'viz-value' });
      val.textContent = d.value;
      c.svg.appendChild(val);
    });

    c.svg.setAttribute('aria-label', (opts.title || 'график') + ': ' + data.length + ' категорий');

    table(host, data.map(function (d) { return [d.label, d.value]; }),
      [opts.headX || 'категория', opts.headY || 'количество']);
  }


  /* =======================================================
     ТОЧЕЧНЫЙ ГРАФИК — связь двух величин
     data: [{ x, y, label, extra }]
     ======================================================= */
  function scatter(host, data, opts) {
    opts = opts || {};
    if (!data.length) { host.innerHTML = '<p class="viz-empty">нет данных</p>'; return; }

    const c = canvas(host, opts.height || 260);
    const box = { x: 46, y: 14, w: c.w - 58, h: c.h - 54 };

    const xs = data.map(function (d) { return d.x; });
    const ys = data.map(function (d) { return d.y; });
    const maxX = Math.max.apply(null, xs) || 1;
    const minY = Math.min.apply(null, ys);
    const maxY = Math.max.apply(null, ys) || 1;
    const lowY = Math.max(0, Math.floor((minY - 5) / 10) * 10);

    /* сетка по вертикали */
    const stepY = niceStep(maxY - lowY, 4);
    for (let v = lowY; v <= maxY + 0.001; v += stepY) {
      const y = box.y + box.h - ((v - lowY) / (maxY - lowY)) * box.h;
      c.svg.appendChild(node('line', { x1: box.x, y1: y, x2: box.x + box.w, y2: y, class: 'viz-grid' }));
      const t = node('text', { x: box.x - 8, y: y + 4, class: 'viz-axis', 'text-anchor': 'end' });
      t.textContent = Math.round(v) + (opts.suffixY || '');
      c.svg.appendChild(t);
    }

    /* подписи по горизонтали */
    const stepX = niceStep(maxX, 4);
    for (let v = 0; v <= maxX + 0.001; v += stepX) {
      const x = box.x + (v / maxX) * box.w;
      const t = node('text', { x: x, y: c.h - 14, class: 'viz-axis', 'text-anchor': 'middle' });
      t.textContent = Math.round(v) + (opts.suffixX || '');
      c.svg.appendChild(t);
    }

    data.forEach(function (d) {
      const x = box.x + (d.x / maxX) * box.w;
      const y = box.y + box.h - ((d.y - lowY) / (maxY - lowY)) * box.h;

      /* кольцо цвета фона вокруг точки — чтобы наложения читались */
      const dot = node('circle', { cx: x, cy: y, r: 5, class: 'viz-dot' });

      dot.addEventListener('mousemove', function (e) {
        showTip('<b>' + d.label + '</b><br>' +
          (opts.nameX || 'x') + ': ' + d.x + (opts.suffixX || '') + '<br>' +
          (opts.nameY || 'y') + ': ' + d.y + (opts.suffixY || '') +
          (d.extra ? '<br>' + d.extra : ''), e.clientX, e.clientY);
      });
      dot.addEventListener('mouseleave', hideTip);

      c.svg.appendChild(dot);
    });

    /* подписи осей */
    const ax = node('text', { x: box.x + box.w, y: c.h - 1, class: 'viz-axis-name', 'text-anchor': 'end' });
    ax.textContent = opts.nameX || '';
    c.svg.appendChild(ax);

    c.svg.setAttribute('aria-label', (opts.title || 'график') + ': ' + data.length + ' точек');

    table(host,
      data.map(function (d) { return [d.label, d.x + (opts.suffixX || '') + ' · ' + d.y + (opts.suffixY || '')]; }),
      [opts.headX || 'игра', (opts.nameX || 'x') + ' / ' + (opts.nameY || 'y')]);
  }


  return { bars: bars, hbars: hbars, scatter: scatter, hideTip: hideTip };

})();
