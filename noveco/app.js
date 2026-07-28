/* Noveco — MVP scaffold. Dependency-free. */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     Navigation (bottom tabs)
     --------------------------------------------------------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var views = {
    composite: document.getElementById('view-composite'),
    scorecard: document.getElementById('view-scorecard'),
    measures: document.getElementById('view-measures'),
    concept: document.getElementById('view-concept')
  };

  function show(target) {
    Object.keys(views).forEach(function (k) {
      views[k].hidden = (k !== target);
    });
    tabs.forEach(function (t) {
      var on = t.dataset.target === target;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (target === 'composite') renderComposite();
    if (target === 'measures') renderMeasures(curActor);
  }

  tabs.forEach(function (t) {
    t.addEventListener('click', function () { show(t.dataset.target); });
  });

  /* ---------------------------------------------------------
     Scorecard data + render
     --------------------------------------------------------- */
  var AXES = [
    { axis: 'Tempo der Resilienz', v: 'neo', vl: 'Neophyt',
      pine: 'Jahrzehnte bis Kronenschluss, Kühlung und Bodenschutz.',
      neo: 'Pionier: Deckung, Kühlung und Stickstoff schon in wenigen Jahren.' },
    { axis: 'Trocken- & Klimastress', v: 'neo', vl: 'Neophyt',
      pine: 'Flachwurzler, auf Sand zunehmend hitzegestresst.',
      neo: 'Robinie: tiefwurzelnd, stickstofffixierend, hitzetolerant.' },
    { axis: 'Kühlung & Brandrisiko', v: 'neo', vl: 'Neophyt',
      pine: 'Harzreiche Monokultur — hochbrandgefährdet, Teil des Problems.',
      neo: 'Laub-Unterwuchs, feuchteres Mikroklima — senkt die Brandlast.' },
    { axis: 'Wirtschaftl. Verwertung', v: 'split', vl: 'Geteilt',
      pine: 'Große Holzmengen, etablierte Kette, Harz.',
      neo: 'Dauerhaftestes Holz Europas (Nische), Honig, Energieholz, Gerbstoff.' },
    { axis: 'Kohlenstoff-Wirksamkeit', v: 'split', vl: 'Geteilt',
      pine: 'Langsamer Aufbau, aber Boden-C und Beständigkeit — solange kein Brand.',
      neo: 'Schnelle Biomasse (Robinie), aber Permanenz durch Reburn-Risiko fragil.' },
    { axis: 'Statur & Holzvolumen', v: 'pine', vl: 'Kiefer',
      pine: 'Höher, mehr Stammvolumen, langlebiger Kronenraum.',
      neo: 'Kleiner, geringeres Volumen — nicht in allem überlegen.' },
    { axis: 'Biodiversität', v: 'ctx', vl: 'Kontextabhängig',
      pine: 'Artenarm — aber nach Brand Trägerin von Totholz-Spezialisten.',
      neo: 'Auf Ödland ein Gewinn; auf Schutz-Magerland verdrängt der N-Eintrag die Spezialisten.' }
  ];

  function renderScorecard() {
    var list = document.getElementById('scorecard-list');
    if (!list || list.childElementCount) return;
    AXES.forEach(function (a) {
      var li = document.createElement('li');
      li.className = 'scard';
      li.innerHTML =
        '<div class="scard-top"><span class="scard-axis"></span>' +
        '<span class="verdict v-' + a.v + '"></span></div>' +
        '<div class="scard-rows">' +
        '<div class="scrow pine"><span class="side">Kiefer</span><span class="txt-p"></span></div>' +
        '<div class="scrow neo"><span class="side">Neophyt</span><span class="txt-n"></span></div>' +
        '</div>';
      li.querySelector('.scard-axis').textContent = a.axis;
      li.querySelector('.verdict').textContent = a.vl;
      li.querySelector('.txt-p').textContent = a.pine;
      li.querySelector('.txt-n').textContent = a.neo;
      list.appendChild(li);
    });
  }

  /* ---------------------------------------------------------
     Recovery composite (procedural placeholder)
     Three years mapped to R/G/B. Unburned pixels stay grey;
     burn scar shows recovery-timing as false colour.
     --------------------------------------------------------- */
  var FIRE_YEAR = 2019;
  var YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
  var selR = document.getElementById('year-r');
  var selG = document.getElementById('year-g');
  var selB = document.getElementById('year-b');

  function fillYears(sel, val) {
    YEARS.forEach(function (y) {
      var o = document.createElement('option');
      o.value = String(y); o.textContent = String(y);
      if (y === val) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', renderComposite);
  }
  fillYears(selR, 2020);
  fillYears(selG, 2022);
  fillYears(selB, 2024);

  function hash(x, y) {
    var n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }
  function smooth(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  function fbm(x, y) {
    var t = 0, amp = 0.5, f = 1;
    for (var i = 0; i < 4; i++) { t += amp * smooth(x * f, y * f); f *= 2; amp *= 0.5; }
    return t;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function nbr(nx, ny, year) {
    var t = Math.max(0, year - FIRE_YEAR);
    var scar = fbm(nx * 3 + 10, ny * 3 + 4);
    if (scar <= 0.52) return 0.72 + (fbm(nx * 8, ny * 8) - 0.5) * 0.12; // unburned, stable
    var interior = clamp((scar - 0.52) / 0.35, 0, 1);      // 0 edge .. 1 core
    var neo = fbm(nx * 6 - 3, ny * 6 + 7);                 // neophyte patchiness
    var rate = 0.35 + (1 - interior) * 0.6 + (neo > 0.62 ? 0.6 : 0);
    return clamp((1 - Math.exp(-rate * t * 0.55)) * 0.85 + 0.05, 0, 1);
  }

  var canvas = document.getElementById('composite-canvas');
  var off = document.createElement('canvas');
  var RW = 200, RH = Math.round(RW * canvas.height / canvas.width);
  off.width = RW; off.height = RH;

  function renderComposite() {
    if (!canvas || views.composite.hidden) return;
    var yr = +selR.value, yg = +selG.value, yb = +selB.value;
    var octx = off.getContext('2d');
    var img = octx.createImageData(RW, RH);
    var px = img.data;
    for (var y = 0; y < RH; y++) {
      for (var x = 0; x < RW; x++) {
        var nx = x / RW, ny = y / RH, i = (y * RW + x) * 4;
        px[i]     = Math.round(Math.pow(nbr(nx, ny, yr), 0.85) * 255);
        px[i + 1] = Math.round(Math.pow(nbr(nx, ny, yg), 0.85) * 255);
        px[i + 2] = Math.round(Math.pow(nbr(nx, ny, yb), 0.85) * 255);
        px[i + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  /* ---------------------------------------------------------
     Measures (Maßnahmen) — filterable by actor
     --------------------------------------------------------- */
  var ACTOR_LABEL = { ind: 'Einzelperson', kom: 'Kommune', forst: 'Forstbetrieb' };
  var MEAS = [
    { a: 'ind', t: 'Harke weglassen, Gras stehen lassen — Streu, Moos und Humus bauen sich auf.', tags: ['Streu', 'Schatten'] },
    { a: 'ind', t: 'Totholz- und Reisighaufen als Ammenstrukturen: Schatten, Feuchtinseln, Habitat.', tags: ['Schatten', 'Tau', 'Streu'] },
    { a: 'ind', t: 'Steine und Stämme auf offenen Sand legen — Schatten- und Tau-Tropfkanten als Startpunkte.', tags: ['Schatten', 'Tau'] },
    { a: 'ind', t: 'Kleine Reisig-/Stroh-Raster auf offenen Sandflecken (Gobi-Prinzip im Kleinen).', tags: ['Wind', 'Tau'] },
    { a: 'ind', t: 'Mulchen statt gießen; Freiwillige (Robinie, Eichhörnchen-Saat) kuratieren statt Exoten pflanzen.', tags: ['Streu'] },

    { a: 'kom', t: 'Leitplanken, Lärmwände, Mauern als Tau-Kondensatoren und Schattenlinien für grüne Randstreifen nutzen.', tags: ['Tau', 'Schatten'] },
    { a: 'kom', t: 'Brandschutzstreifen als feuchte Laub-Grünriegel — Feuerpuffer und Biotop zugleich.', tags: ['Schatten', 'Feuer'] },
    { a: 'kom', t: 'Offene Sand-/Heideflächen: Reisig-/Stroh-Raster plus Biokrusten-Förderung gegen Winderosion.', tags: ['Wind', 'Tau'] },
    { a: 'kom', t: 'Kommunalwald nach Brand: Totholz belassen, strukturbasiert erholen statt räumen-und-aufforsten.', tags: ['Schatten', 'Streu'] },
    { a: 'kom', t: 'Regenwasser in Baumgruben leiten (Schwammstadt); Erholung und Kohlenstoff tracken.', tags: ['Tau', 'Kohlenstoff'] },

    { a: 'forst', t: 'Totholz stehend/liegend als Ammenstruktur, Windbremse und Schatten lassen — nicht kahlräumen.', tags: ['Wind', 'Schatten'] },
    { a: 'forst', t: 'Schlagreisig flächig auslegen (lop-and-scatter): Wind bremsen, Feuchte halten, Natursaat fangen.', tags: ['Wind', 'Streu'] },
    { a: 'forst', t: 'Zwei-Phasen: Pionier-Naturverjüngung (Birke/Zitterpappel) als Amme, Zielbaumart darunter etablieren.', tags: ['Schatten', 'Streu'] },
    { a: 'forst', t: 'Weg vom Kiefern-Reinbestand → Mischung/Laub: geringeres Brandrisiko, kühler, nasser.', tags: ['Feuer', 'Schatten'] },
    { a: 'forst', t: 'Erosionsgefährdete Brandnarben mit Stroh-/Geotextil-Rastern fixieren; Kohlenstoff nach LSR bewerten.', tags: ['Wind', 'Kohlenstoff'] }
  ];
  var TAGCLASS = { Wind: 'p', Schatten: 'p', Tau: 'n', Streu: 'n', Feuer: 'a', Kohlenstoff: 'a' };
  var curActor = 'all';

  function renderMeasures(actor) {
    curActor = actor || 'all';
    var list = document.getElementById('measures-list');
    if (!list) return;
    list.textContent = '';
    MEAS.filter(function (m) { return curActor === 'all' || m.a === curActor; })
      .forEach(function (m) {
        var li = document.createElement('li');
        li.className = 'measure';
        var tags = m.tags.map(function (tg) {
          return '<span class="mtag ' + (TAGCLASS[tg] || 'p') + '">' + tg + '</span>';
        }).join('');
        li.innerHTML = '<span class="m-actor"></span><p></p><div class="m-tags">' + tags + '</div>';
        li.querySelector('.m-actor').textContent = ACTOR_LABEL[m.a];
        li.querySelector('p').textContent = m.t;
        list.appendChild(li);
      });
  }

  Array.prototype.slice.call(document.querySelectorAll('.seg-btn')).forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('is-on'); });
      b.classList.add('is-on');
      renderMeasures(b.dataset.actor);
    });
  });

  /* ---------------------------------------------------------
     Init
     --------------------------------------------------------- */
  renderScorecard();
  renderMeasures('all');
  renderComposite();
})();
