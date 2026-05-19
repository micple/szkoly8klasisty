/* ============================================================
   Szkoły dla syna — site-v2 app logic
   Vanilla JS, no deps. Reads window.SCHOOLS from ../site/data.js.
   ============================================================ */
(function () {
  'use strict';

  const SCHOOLS = (window.SCHOOLS || []).map((s, i) => ({ ...s, _idx: i }));

  /* ---------------- Constants ---------------- */
  const RISKS = ['bardzo ambitna', 'ambitna', 'na granicy', 'realna', 'bezpieczna'];
  const COMMUTES = ['dobry', 'średni', 'słaby'];
  const PROFILE_CATS = [
    { id: 'med', label: 'Medyczny',       test: k => /biol/i.test(k) || /^chem/i.test(k) || /-chem-/i.test(k) },
    { id: 'pol', label: 'Politechniczny', test: k => /fiz/i.test(k) || /inf/i.test(k) },
    { id: 'ib',  label: 'IB',             test: k => /^ib /i.test(k) || /^ib$/i.test(k) || /^ib\b/i.test(k) },
    { id: 'tek', label: 'Technikum',      test: k => /^technik/i.test(k) },
  ];
  const TAG = {
    med: { cls: 'tag-med',  label: 'med' },
    pol: { cls: 'tag-tech', label: 'pol' },
    ib:  { cls: 'tag-ib',   label: 'IB' },
    tek: { cls: 'tag-tek',  label: 'tek' },
  };
  const MAX_COMPARE = 3;

  /* ---------------- State ---------------- */
  const state = {
    search: '',
    districts: new Set(),
    risks: new Set(),
    profiles: new Set(),
    commutes: new Set(),
    timeRanges: new Set(),    // czas dojazdu rano w minutach — chip keys: lt30, b30_50, b50_70, gt70
    maxCommute: null,         // szybki filtr "≤ X min" z panelu mapy (number or null)
    priorityClasses: [],      // uporządkowana lista profili wg preferencji usera ['biol-chem-mat', 'fiz-inf-mat']
    sortKeys: [],             // uporządkowana lista kryteriów sortowania (chain), np. ['score', 'commute-am']
    view: 'cards',
    compare: new Set(),
  };

  const MAP_QUICK_FILTERS = [30, 45, 60, 90]; // progi "≤ X min"

  // Kryteria sortowania w łańcuchu. dir = -1 (desc, malejąco), +1 (asc, rosnąco).
  // get(s) zwraca wartość liczbową, lub null jeśli brak danych (ulokuje na koniec).
  const SORT_OPTIONS = [
    { id: 'score',      label: 'atrakcyjność (najwyższa)',          dir: -1, get: s => s.bestScore },
    { id: 'prog-desc',  label: 'próg ’25 (najwyższy)',              dir: -1, get: s => progRange(s).max },
    { id: 'prog-asc',   label: 'próg ’25 (najniższy)',              dir: +1, get: s => progRange(s).min },
    { id: 'matura',     label: 'matura ’26 (najlepsza)',            dir: -1, get: s => maturaIdx(s) },
    { id: 'ranking',    label: 'ranking matury (najwyżej w PL)',    dir: +1, get: s => maturaRank(s) },
    { id: 'commute-am', label: 'czas dojazdu rano (najkrótszy)',    dir: +1, get: s => { const c = readCache(s.school, 'morning'); return c && !c.error ? c.durationValue : null; } },
    { id: 'commute-pm', label: 'czas dojazdu pp. (najkrótszy)',     dir: +1, get: s => { const c = readCache(s.school, 'afternoon'); return c && !c.error ? c.durationValue : null; } },
    { id: 'alpha',      label: 'alfabetycznie',                     dir: +1, get: s => s.school, compare: (a, b) => a.localeCompare(b, 'pl') },
  ];

  function normalizeProfile(k) {
    if (!k) return '';
    return k.replace(/\s*\(.*?\)\s*/g, '').trim();
  }

  function uniqueProfiles() {
    const set = new Set();
    for (const s of SCHOOLS) {
      for (const c of s.classes) {
        const p = normalizeProfile(c['Klasa/kierunek']);
        if (p) set.add(p);
      }
    }
    // Sortuj: najpierw "ścisłe" profile, potem IB, potem techników
    return [...set].sort((a, b) => {
      const score = x => /^IB/i.test(x) ? 2 : /^Technik/i.test(x) ? 3 : 1;
      const sa = score(a), sb = score(b);
      if (sa !== sb) return sa - sb;
      return a.localeCompare(b, 'pl');
    });
  }

  function schoolPriorityRank(s) {
    if (!state.priorityClasses.length) return null;
    let best = Infinity;
    for (const c of s.classes) {
      const p = normalizeProfile(c['Klasa/kierunek']);
      const idx = state.priorityClasses.indexOf(p);
      if (idx >= 0 && idx < best) best = idx;
    }
    return best === Infinity ? null : best;
  }

  const TIME_RANGES = [
    { id: 'lt30',  label: '< 30 min',     test: m => m < 30 },
    { id: 'b30_50',label: '30 – 50 min',  test: m => m >= 30 && m < 50 },
    { id: 'b50_70',label: '50 – 70 min',  test: m => m >= 50 && m < 70 },
    { id: 'gt70',  label: '> 70 min',     test: m => m >= 70 },
  ];

  /* ---------------- Helpers ---------------- */
  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fmt(n, dp = 0) { if (n == null || isNaN(n)) return '—'; return Number(n).toFixed(dp); }

  function classCats(k) { return PROFILE_CATS.filter(c => c.test(k || '')).map(c => c.id); }
  function schoolCats(s) {
    const out = new Set();
    for (const c of s.classes) for (const id of classCats(c['Klasa/kierunek'] || '')) out.add(id);
    return [...out];
  }
  function progRange(s) {
    let min = Infinity, max = -Infinity;
    for (const c of s.classes) {
      const p = c['Próg 2025'];
      if (typeof p !== 'number') continue;
      if (p < min) min = p;
      if (p > max) max = p;
    }
    return { min: min === Infinity ? null : min, max: max === -Infinity ? null : max };
  }
  function maturaIdx(s) {
    for (const c of s.classes) { const m = c['Wskaźnik maturalny 2026']; if (typeof m === 'number') return m; }
    return null;
  }
  function maturaRank(s) {
    for (const c of s.classes) { const r = c['Ranking maturalny 2026']; if (typeof r === 'number') return r; }
    return null;
  }
  function commute(s) {
    for (const c of s.classes) if (c['Dojazd z Kobyłki']) return c['Dojazd z Kobyłki'];
    return null;
  }
  function initials(name) {
    const m = name.match(/[A-ZŁŚŻŹĆŃĄĘÓ]/g);
    return m ? m.slice(0, 2).join('') : name.slice(0, 2).toUpperCase();
  }

  /* ---------------- Filtering / sorting ---------------- */
  function visible() {
    const q = state.search.trim().toLowerCase();
    return SCHOOLS.filter(s => {
      if (state.districts.size && !state.districts.has(s.district)) return false;
      if (state.risks.size) {
        const allRisks = new Set([s.bestRisk, ...s.classes.map(c => c['Szansa przy 168 pkt'])]);
        let ok = false;
        for (const r of state.risks) if (allRisks.has(r)) { ok = true; break; }
        if (!ok) return false;
      }
      if (state.profiles.size) {
        const sc = new Set(schoolCats(s));
        let ok = false;
        for (const p of state.profiles) if (sc.has(p)) { ok = true; break; }
        if (!ok) return false;
      }
      if (state.commutes.size) {
        const c = commute(s);
        if (!c || !state.commutes.has(c)) return false;
      }
      if (state.timeRanges.size) {
        // Filtruj po realnym czasie dojazdu rano (Google DirectionsService)
        // Wymaga cache (z poprzedniego renderu albo bieżącego). Bez danych — odrzuć.
        const cached = readCache(s.school, 'morning');
        if (!cached || cached.error || typeof cached.durationValue !== 'number') return false;
        const minutes = Math.round(cached.durationValue / 60);
        const ok = [...state.timeRanges].some(rid => {
          const r = TIME_RANGES.find(x => x.id === rid);
          return r && r.test(minutes);
        });
        if (!ok) return false;
      }
      if (state.maxCommute != null) {
        // Szybki filtr z panelu mapy: czas dojazdu rano ≤ X min
        const cached = readCache(s.school, 'morning');
        if (!cached || cached.error || typeof cached.durationValue !== 'number') return false;
        const minutes = Math.round(cached.durationValue / 60);
        if (minutes > state.maxCommute) return false;
      }
      if (q) {
        const hay = [
          s.school, s.district, s.summary || '', s.why || '', s.watch || '',
          ...s.classes.map(c => (c['Klasa/kierunek'] || '') + ' ' + (c['Przedmioty z profilu/kierunku'] || ''))
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function sortSchools(arr) {
    const a = arr.slice();
    // Łańcuch sortowania: priority classes (jeśli ustawione) → user sort chain → domyślne (score desc)
    const chain = [];
    if (state.priorityClasses.length > 0) chain.push('__priority');
    if (state.sortKeys.length > 0) chain.push(...state.sortKeys);
    if (chain.length === 0) chain.push('score'); // default

    a.sort((x, y) => {
      for (const id of chain) {
        let cmp = 0;
        if (id === '__priority') {
          const px = schoolPriorityRank(x);
          const py = schoolPriorityRank(y);
          const ax = px === null ? Infinity : px;
          const ay = py === null ? Infinity : py;
          cmp = ax - ay;
        } else {
          const opt = SORT_OPTIONS.find(o => o.id === id);
          if (!opt) continue;
          const av = opt.get(x);
          const bv = opt.get(y);
          if (opt.compare) {
            cmp = opt.compare(av, bv) * opt.dir;
          } else {
            // null trafia na koniec niezależnie od kierunku
            const an = av == null;
            const bn = bv == null;
            if (an && bn) cmp = 0;
            else if (an) cmp = 1;
            else if (bn) cmp = -1;
            else cmp = (av - bv) * opt.dir;
          }
        }
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
    return a;
  }

  /* ---------------- Tag rendering helpers ---------------- */
  function profileTags(s, max) {
    const tags = schoolCats(s).map(c => `<span class="tag ${TAG[c].cls}">${TAG[c].label}</span>`);
    return max != null ? tags.slice(0, max).join('') : tags.join('');
  }
  function commuteBar(c) {
    if (!c) return '';
    return `<span class="commute-pill" data-c="${esc(c)}">${esc(c)}<span class="bar"><i></i><i></i><i></i></span></span>`;
  }

  /* ---------------- View renderers ---------------- */
  function renderCardsView(list) {
    const root = document.getElementById('viewCards');
    root.innerHTML = list.map((s, idx) => {
      const gallery = (s.gallery && s.gallery.length)
        ? s.gallery.slice(0, 3).map(src => `<img src="${esc(src)}" loading="lazy" alt="${esc(s.school)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'fallback',textContent:'—'}))">`).join('')
        : `<div class="fallback fallback--lead">${esc(s.school)}</div><div class="fallback">galeria</div><div class="fallback">źródła →</div>`;
      const matInd = maturaIdx(s);
      const matRank = maturaRank(s);
      const pr = progRange(s);
      const c = commute(s);
      const picked = state.compare.has(s.school);
      const rank = idx + 1;
      const classes = s.classes.slice(0, 3).map(cl => {
        const cats = classCats(cl['Klasa/kierunek'] || '');
        const tags = cats.map(cat => `<span class="tag ${TAG[cat].cls}">${TAG[cat].label}</span>`).join('');
        return `<div class="classrow">
          <div class="classrow__name">${esc(cl['Klasa/kierunek'])}${tags}</div>
          <div class="classrow__score">${fmt(cl['Atrakcyjność 0-100'], 0)}</div>
          <div class="classrow__progs">Próg ’25 <b>${fmt(cl['Próg 2025'], 1)}</b> · ’24 ${fmt(cl['Próg 2024'], 1)} · ’23 ${fmt(cl['Próg 2023'], 1)} · ${esc(cl['Szansa przy 168 pkt'] || '')}</div>
        </div>`;
      }).join('');
      const links = [
        s.official  && `<a href="${esc(s.official)}"  target="_blank" rel="noopener">strona szkoły</a>`,
        s.commons   && `<a href="${esc(s.commons)}"   target="_blank" rel="noopener">Wikimedia</a>`,
        s.gallerySources && s.gallerySources[1] && `<a href="${esc(s.gallerySources[1])}" target="_blank" rel="noopener">więcej zdjęć</a>`,
        s.opinionSources && s.opinionSources[0] && `<a href="${esc(s.opinionSources[0])}" target="_blank" rel="noopener">opinie i fora</a>`,
      ].filter(Boolean).join('');
      return `<article class="card${picked ? ' is-picked' : ''}" data-school="${esc(s.school)}" style="animation-delay:${Math.min(idx * 40, 320)}ms">
        <div class="card__media">
          ${gallery}
          <div class="card__overlay"></div>
          <div class="card__rank">#${rank} · atr. ${fmt(s.bestScore, 0)}</div>
          <div class="card__pick">
            <input type="checkbox" id="pk-c-${idx}" class="js-pick" ${picked ? 'checked' : ''} data-school="${esc(s.school)}">
            <label for="pk-c-${idx}"><span class="tick"></span>Porównaj</label>
          </div>
        </div>
        <div class="card__body">
          <div>
            <p class="card__district"><span class="card__district-pin" aria-hidden="true"></span>${esc(s.district)}</p>
            <h2 class="card__name">${esc(s.school)}</h2>
            <div class="card__sub">
              <span class="risk-pill" data-r="${esc(s.bestRisk)}">${esc(s.bestRisk)}</span>
              <span class="sep"></span>
              ${commuteBar(c)}
              <span class="sep"></span>
              <span>${profileTags(s)}</span>
            </div>
          </div>
          <dl class="metrics">
            <div class="metric"><dt>Atrakcyjność</dt><dd>${fmt(s.bestScore, 0)}<small> / 100</small></dd></div>
            <div class="metric"><dt>Próg ’25</dt><dd>${pr.min != null ? fmt(pr.min, 0) : '—'}<small> – ${pr.max != null ? fmt(pr.max, 0) : '—'}</small></dd></div>
            <div class="metric"><dt>Matura ’26</dt><dd>${matInd != null ? fmt(matInd, 0) : '—'}<small> rank ${matRank ?? '—'}</small></dd></div>
          </dl>
          <div class="section"><h3>Opis</h3><p>${esc(s.summary || '—')}</p></div>
          <div class="section"><h3>Dlaczego dla syna</h3><p>${esc(s.why || '—')}</p></div>
          <div class="section"><h3>Na co uważać</h3><p>${esc(s.watch || '—')}</p></div>
          <div class="section"><h3>Najlepsze klasy</h3><div class="classes">${classes}</div></div>
          ${commuteSectionHtml(s)}
          ${links ? `<div class="card__links">${links}</div>` : ''}
          <div class="card__cta">
            <button class="ghost-btn js-detail" type="button" data-school="${esc(s.school)}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              Wszystkie klasy i szczegóły
            </button>
          </div>
        </div>
      </article>`;
    }).join('');
  }

  function renderListView(list) {
    const root = document.getElementById('viewList');
    root.innerHTML = list.map((s, idx) => {
      const picked = state.compare.has(s.school);
      const c = commute(s);
      return `<div class="listrow${picked ? ' is-picked' : ''}" data-school="${esc(s.school)}" style="animation-delay:${Math.min(idx * 20, 240)}ms">
        <div class="listrow__avatar">${esc(initials(s.school))}</div>
        <div class="listrow__title">
          <h3 class="listrow__name">${esc(s.school)}</h3>
          <div class="listrow__sub">
            <span>${esc(s.district)}</span>
            <span class="sep"></span>
            <span class="listrow__profiles">${profileTags(s)}</span>
          </div>
        </div>
        <div class="hide-md hide-sm"><span class="risk-pill" data-r="${esc(s.bestRisk)}">${esc(s.bestRisk)}</span></div>
        <div class="hide-md hide-sm">${commuteBar(c)}</div>
        <div class="hide-sm"><button class="ghost-btn js-pick-btn" type="button" data-school="${esc(s.school)}">${picked ? '✓ porównuję' : '+ porównaj'}</button></div>
        <div class="listrow__score">${fmt(s.bestScore, 0)}<small>atr.</small></div>
        <div class="hide-sm"><button class="ghost-btn js-detail" data-school="${esc(s.school)}" type="button">Otwórz →</button></div>
      </div>`;
    }).join('');
  }

  function renderTableView(list) {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = list.map(s => {
      const picked = state.compare.has(s.school);
      const pr = progRange(s);
      const c = commute(s);
      return `<tr class="${picked ? 'is-picked' : ''}" data-school="${esc(s.school)}">
        <td><input type="checkbox" class="table-pick js-pick" data-school="${esc(s.school)}" ${picked ? 'checked' : ''} onclick="event.stopPropagation()"></td>
        <td class="td-name">${esc(s.school)}</td>
        <td>${esc(s.district)}</td>
        <td class="num">${fmt(s.bestScore, 0)}</td>
        <td><span class="risk-pill" data-r="${esc(s.bestRisk)}">${esc(s.bestRisk)}</span></td>
        <td class="num">${pr.min != null && pr.max != null ? (pr.min === pr.max ? fmt(pr.min, 1) : fmt(pr.min, 0) + '–' + fmt(pr.max, 0)) : '—'}</td>
        <td class="num">${maturaRank(s) ?? '—'}</td>
        <td class="num">${maturaIdx(s) != null ? fmt(maturaIdx(s), 0) : '—'}</td>
        <td><div class="td-profiles">${profileTags(s)}</div></td>
        <td>${commuteBar(c)}</td>
      </tr>`;
    }).join('');
  }

  /* ---------------- Map view (Google Maps JS API) ---------------- */
  const KOBYLKA = { lat: 52.3192, lng: 21.2200 };
  const WARSAW_CENTER = { lat: 52.2300, lng: 21.0100 };
  const RISK_COLOR = {
    'bardzo ambitna': '#8E2F1E',
    'ambitna':        '#B65A1F',
    'na granicy':     '#946913',
    'realna':         '#5B7233',
    'bezpieczna':     '#3C6A4D',
  };

  // Google Maps state (module-scoped, NOT in reactive `state`)
  let gmap = null;
  let gmapMarkers = [];
  let gmapInfoWindow = null;
  let gmapKobylkaMarker = null;
  let mapsLoadPromise = null;
  let mapsReady = false;
  let mapSetupDone = false;

  function hasApiKey() {
    return typeof window.GMAPS_API_KEY === 'string' && window.GMAPS_API_KEY.length > 10 && window.GMAPS_API_KEY !== 'TWOJ_KLUCZ_TUTAJ';
  }

  function loadGoogleMaps() {
    if (mapsLoadPromise) return mapsLoadPromise;
    if (!hasApiKey()) return Promise.reject(new Error('NO_KEY'));
    mapsLoadPromise = new Promise((resolve, reject) => {
      window.__initGoogleMap = function () {
        mapsReady = true;
        resolve();
      };
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(window.GMAPS_API_KEY) +
              '&loading=async&callback=__initGoogleMap&v=weekly&language=pl&region=PL';
      s.onerror = () => reject(new Error('SDK_LOAD_FAILED'));
      document.head.appendChild(s);
    });
    return mapsLoadPromise;
  }

  function setupMap() {
    if (mapSetupDone) return;
    mapSetupDone = true;
    const el = document.getElementById('googleMap');
    if (!el) return;
    gmap = new google.maps.Map(el, {
      center: WARSAW_CENTER,
      zoom: 10,
      mapTypeControl: false,
      fullscreenControl: false,
      streetViewControl: false,
      styles: [
        { elementType: 'geometry', stylers: [{ color: '#F6F1E7' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#FBF9F4' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#6B6258' }] },
        { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFEFB' }] },
        { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#F4E4D0' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D6DEE7' }] },
        { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#E5EBD8' }] },
        { featureType: 'transit', stylers: [{ visibility: 'simplified' }] },
        { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
      ],
    });
    gmapInfoWindow = new google.maps.InfoWindow({ maxWidth: 320 });
    gmapKobylkaMarker = new google.maps.Marker({
      position: KOBYLKA,
      map: gmap,
      title: 'Kobyłka',
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 11,
        fillColor: '#1F1B16',
        fillOpacity: 1,
        strokeColor: '#FFFEFB',
        strokeWeight: 3,
      },
      label: { text: 'Kobyłka', color: '#1F1B16', fontFamily: "'Fraunces', serif", fontSize: '13px', fontWeight: '500', className: 'gmap-label-kobylka' },
      zIndex: 1000,
    });
    document.querySelector('.map-frame')?.classList.add('is-ready');
    renderMapMarkers();
  }

  function renderMapMarkers() {
    if (!gmap) return;
    // Clear existing
    gmapMarkers.forEach(m => m.setMap(null));
    gmapMarkers = [];
    const list = visible();
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(KOBYLKA);
    for (const s of list) {
      if (typeof s.lat !== 'number' || typeof s.lng !== 'number') continue;
      const color = RISK_COLOR[s.bestRisk] || '#B5631F';
      const m = new google.maps.Marker({
        position: { lat: s.lat, lng: s.lng },
        map: gmap,
        title: s.school,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: '#FFFEFB',
          strokeWeight: 2,
        },
      });
      m.addListener('click', () => openInfoWindow(s, m));
      gmapMarkers.push(m);
      bounds.extend(m.getPosition());
    }
    if (gmapMarkers.length) {
      gmap.fitBounds(bounds, 40);
      // Limit max zoom (avoid over-zoom when 1 marker)
      const lst = google.maps.event.addListener(gmap, 'idle', () => {
        if (gmap.getZoom() > 12) gmap.setZoom(12);
        google.maps.event.removeListener(lst);
      });
    }
  }

  function openInfoWindow(school, marker) {
    const morning = readCache(school.school, 'morning');
    const afternoon = readCache(school.school, 'afternoon');
    const commuteHtml = `
      <div class="iw-commute">
        <div>☼ <b>Rano (07:30)</b>: ${morning ? esc(morning.duration) + ' · ' + esc(transferLabel(morning.transfers)) + ' · ' + esc(morning.distance) : '<i>liczę…</i>'}</div>
        <div>☾ <b>Popołudnie (15:30)</b>: ${afternoon ? esc(afternoon.duration) + ' · ' + esc(transferLabel(afternoon.transfers)) + ' · ' + esc(afternoon.distance) : '<i>liczę…</i>'}</div>
      </div>`;
    const content = `<div class="iw-card">
      <p class="iw-eyebrow">${esc(school.district)} · #${SCHOOLS.indexOf(school) + 1}</p>
      <h3>${esc(school.school)}</h3>
      <div class="iw-meta">
        <span class="iw-score">atr. ${fmt(school.bestScore, 0)}</span>
        <span class="risk-pill" data-r="${esc(school.bestRisk)}">${esc(school.bestRisk)}</span>
      </div>
      ${commuteHtml}
      <div class="iw-actions">
        <button class="iw-btn primary" type="button" onclick="window.__openDetail('${esc(school.school).replace(/'/g, "\\'")}')">Szczegóły</button>
        <button class="iw-btn" type="button" onclick="window.__filterDistrict('${esc(school.district).replace(/'/g, "\\'")}')">Filtruj dzielnicę</button>
      </div>
    </div>`;
    gmapInfoWindow.setContent(content);
    gmapInfoWindow.open({ map: gmap, anchor: marker });
    // Schedule commute calc if not cached, refresh InfoWindow when ready
    if (!morning) scheduleCommute(school, 'morning', () => refreshInfoWindow(school, marker));
    if (!afternoon) scheduleCommute(school, 'afternoon', () => refreshInfoWindow(school, marker));
  }

  function refreshInfoWindow(school, marker) {
    // Only refresh if this InfoWindow is still showing this marker
    if (!gmapInfoWindow || gmapInfoWindow.getAnchor() !== marker) return;
    openInfoWindow(school, marker);
  }

  function renderMapQuickFilters() {
    const el = document.getElementById('mapQuickFilters');
    if (!el) return;
    // Policz ile szkół wchodzi w każdy próg (z dostępnymi czasami z cache)
    const counts = {};
    for (const max of MAP_QUICK_FILTERS) counts[max] = 0;
    for (const s of SCHOOLS) {
      const c = readCache(s.school, 'morning');
      if (!c || c.error || typeof c.durationValue !== 'number') continue;
      const m = Math.round(c.durationValue / 60);
      for (const max of MAP_QUICK_FILTERS) if (m <= max) counts[max]++;
    }
    el.innerHTML = MAP_QUICK_FILTERS.map(max => {
      const on = state.maxCommute === max;
      return `<button class="qf-chip${on ? ' is-on' : ''}" data-qf-max="${max}" type="button">
        ≤ ${max} min <span class="qf-count">${counts[max]}</span>
      </button>`;
    }).join('');
    el.querySelectorAll('.qf-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const max = Number(chip.dataset.qfMax);
        // Toggle: drugi klik na ten sam próg = wyłącz
        state.maxCommute = state.maxCommute === max ? null : max;
        render();
      });
    });
  }

  function renderMapDistrictList() {
    const list = visible();
    const byDistrict = new Map();
    for (const s of list) {
      if (!byDistrict.has(s.district)) byDistrict.set(s.district, { sum: 0, schools: [], classCount: 0 });
      const e = byDistrict.get(s.district);
      e.sum += s.bestScore;
      e.classCount += s.classes.length;
      e.schools.push(s);
    }
    const ul = document.getElementById('mapDistrictList');
    if (!ul) return;
    const sorted = [...byDistrict.entries()].sort((a, b) => b[1].schools.length - a[1].schools.length);
    ul.innerHTML = sorted.map(([name, e]) => {
      const avg = e.sum / e.schools.length;
      const fill = avg >= 90 ? '#B5631F' : avg >= 80 ? '#C99A2E' : '#7A8B5B';
      const active = state.districts.has(name);
      return `<li class="${active ? 'is-active' : ''}" data-district="${esc(name)}">
        <span class="swatch" style="background:${fill};border-color:${fill}"></span>
        <span><b>${esc(name)}</b> — avg atr. ${avg.toFixed(0)}</span>
        <span class="count">${e.schools.length} · ${e.classCount} klas</span>
      </li>`;
    }).join('');
    ul.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => {
        toggleSet(state.districts, li.dataset.district);
        render();
      });
    });
  }

  // Exposed for InfoWindow inline onclick handlers
  window.__openDetail = function (name) { openDetailModal(name); if (gmapInfoWindow) gmapInfoWindow.close(); };
  window.__filterDistrict = function (district) { state.districts.add(district); render(); if (gmapInfoWindow) gmapInfoWindow.close(); };

  /* ---------------- Commute times (Google DirectionsService) ---------------- */
  const COMMUTE_CACHE_PREFIX = 'dojazd:v1:';
  const COMMUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const COMMUTE_QUEUE_MAX = 5;
  const commuteQueue = [];
  let commuteActive = 0;
  const commutePending = new Map(); // key -> [callbacks]

  function nextMonday(h, m) {
    const d = new Date();
    const day = d.getDay();
    let daysAhead = (8 - day) % 7;
    if (daysAhead === 0) daysAhead = 7;
    d.setDate(d.getDate() + daysAhead);
    d.setHours(h, m, 0, 0);
    return d;
  }

  function readCache(schoolName, direction) {
    try {
      const raw = localStorage.getItem(COMMUTE_CACHE_PREFIX + schoolName + ':' + direction);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts > COMMUTE_TTL_MS) return null;
      return parsed.data;
    } catch { return null; }
  }
  function writeCache(schoolName, direction, data) {
    try { localStorage.setItem(COMMUTE_CACHE_PREFIX + schoolName + ':' + direction, JSON.stringify({ ts: Date.now(), data })); } catch {}
  }

  function transferLabel(n) {
    if (n === 0) return 'bez przesiadek';
    if (n === 1) return '1 przesiadka';
    if (n >= 2 && n <= 4) return n + ' przesiadki';
    return n + ' przesiadek';
  }

  function scheduleCommute(school, direction, onDone) {
    const cached = readCache(school.school, direction);
    if (cached) { onDone && onDone(cached); updateCommuteUi(school.school, direction, cached); return; }
    if (!hasApiKey()) {
      const data = { error: 'NO_KEY', message: 'Brak klucza Google Maps' };
      onDone && onDone(data);
      updateCommuteUi(school.school, direction, data);
      return;
    }
    if (typeof school.lat !== 'number' || typeof school.lng !== 'number') {
      const data = { error: 'NO_COORDS', message: 'Brak lat/lng — uruchom geocode.html' };
      onDone && onDone(data);
      updateCommuteUi(school.school, direction, data);
      return;
    }
    // Dedup: jeśli już oczekuje, dopisz callback i wyjdź — nie kolejkuj duplikatu
    const key = school.school + ':' + direction;
    if (commutePending.has(key)) {
      if (onDone) commutePending.get(key).push(onDone);
      return;
    }
    commutePending.set(key, onDone ? [onDone] : []);
    commuteQueue.push({ school, direction });
    processCommuteQueue();
  }

  function processCommuteQueue() {
    while (commuteActive < COMMUTE_QUEUE_MAX && commuteQueue.length) {
      const item = commuteQueue.shift();
      const key = item.school.school + ':' + item.direction;
      commuteActive++;
      loadGoogleMaps()
        .then(() => fetchCommute(item.school, item.direction))
        .then(data => {
          writeCache(item.school.school, item.direction, data);
          updateCommuteUi(item.school.school, item.direction, data);
          const cbs = commutePending.get(key) || [];
          commutePending.delete(key);
          cbs.forEach(cb => { try { cb(data); } catch (e) { /* ignore */ } });
        })
        .catch(err => {
          const data = { error: 'API_ERROR', message: err.message || 'błąd' };
          updateCommuteUi(item.school.school, item.direction, data);
          const cbs = commutePending.get(key) || [];
          commutePending.delete(key);
          cbs.forEach(cb => { try { cb(data); } catch (e) { /* ignore */ } });
        })
        .finally(() => {
          commuteActive--;
          // Po każdym wyniku zaktualizuj liczniki chipów. Jeśli filtr czasu aktywny — re-render
          // (debounce 200ms, żeby nie burnowsię przy 62 callsach naraz).
          scheduleCommuteUpdate();
          setTimeout(processCommuteQueue, 120);
        });
    }
  }

  let commuteUpdateTimer = null;
  function scheduleCommuteUpdate() {
    if (commuteUpdateTimer) return;
    commuteUpdateTimer = setTimeout(() => {
      commuteUpdateTimer = null;
      try { updateTimeChipCounts(); } catch (e) { /* ignore */ }
      if (state.timeRanges.size > 0 || state.maxCommute != null || state.sortKeys.includes('commute-am') || state.sortKeys.includes('commute-pm')) {
        try { render(); } catch (e) { /* ignore */ }
      }
    }, 220);
  }

  function fetchCommute(school, direction) {
    return new Promise((resolve, reject) => {
      const h = direction === 'morning' ? 7 : 15;
      const m = 30;
      const departure = nextMonday(h, m);
      const ds = new google.maps.DirectionsService();
      ds.route({
        origin: 'Kobyłka, Polska',
        destination: { lat: school.lat, lng: school.lng },
        travelMode: 'TRANSIT',
        transitOptions: { departureTime: departure },
        region: 'pl',
        provideRouteAlternatives: false,
      }, (res, status) => {
        if (status !== 'OK' || !res || !res.routes[0] || !res.routes[0].legs[0]) {
          return reject(new Error('Brak połączenia (' + status + ')'));
        }
        const leg = res.routes[0].legs[0];
        const transitSteps = (leg.steps || []).filter(st => st.travel_mode === 'TRANSIT').length;
        const transfers = Math.max(0, transitSteps - 1);
        resolve({
          duration: leg.duration ? leg.duration.text : '?',
          durationValue: leg.duration ? leg.duration.value : null,
          distance: leg.distance ? leg.distance.text : '?',
          transfers: transfers,
          departureTime: leg.departure_time ? leg.departure_time.text : '',
          arrivalTime: leg.arrival_time ? leg.arrival_time.text : '',
        });
      });
    });
  }

  function updateCommuteUi(schoolName, direction, data) {
    const sel = `.commute-line[data-school="${cssEscape(schoolName)}"][data-direction="${direction}"]`;
    document.querySelectorAll(sel).forEach(line => {
      line.classList.remove('commute-line--loading');
      const timeEl = line.querySelector('.commute-line__time');
      const subEl = line.querySelector('.commute-line__sub');
      if (data.error) {
        line.classList.add(data.error === 'NO_KEY' ? 'commute-line--missing-key' : 'commute-line--error');
        if (timeEl) timeEl.textContent = data.error === 'NO_COORDS' ? 'brak współrz.' : (data.error === 'NO_KEY' ? '—' : 'brak danych');
        if (subEl) subEl.textContent = data.message || '';
      } else {
        if (timeEl) timeEl.textContent = data.duration;
        if (subEl) {
          const parts = [transferLabel(data.transfers)];
          if (data.distance) parts.push(data.distance);
          subEl.textContent = parts.join(' · ');
        }
        // Add departure/arrival small to label if present
        const labelSmall = line.querySelector('.commute-line__label small');
        if (labelSmall && data.departureTime && data.arrivalTime) {
          const base = direction === 'morning' ? '→ szkoła' : '→ dom';
          labelSmall.textContent = `${data.departureTime} → ${data.arrivalTime} (${base})`;
        }
      }
    });
  }

  function commuteSectionHtml(school) {
    if (!hasApiKey()) {
      const c = commute(school);
      return `<div class="section card__commute">
        <h3>Dojazd z Kobyłki</h3>
        <div class="commute-lines">
          <div class="commute-line commute-line--missing-key">
            <span class="commute-line__icon commute-line__icon--am">⚠</span>
            <span class="commute-line__label">Klucz Google Maps niedostępny <small>fallback z data.js</small></span>
            <div class="commute-line__meta">
              <span class="commute-line__time">${c ? esc(c) : '—'}</span>
              <span class="commute-line__sub">Patrz site-v2/SETUP.md</span>
            </div>
          </div>
        </div>
      </div>`;
    }
    const sn = esc(school.school);
    return `<div class="section card__commute">
      <h3>Dojazd z Kobyłki</h3>
      <div class="commute-lines">
        <div class="commute-line commute-line--loading" data-school="${sn}" data-direction="morning">
          <span class="commute-line__icon commute-line__icon--am" title="Rano">☼</span>
          <span class="commute-line__label">Rano <small>pon. 07:30 → szkoła</small></span>
          <div class="commute-line__meta">
            <span class="commute-line__time">…</span>
            <span class="commute-line__sub">liczę przez Google Maps…</span>
          </div>
        </div>
        <div class="commute-line commute-line--loading" data-school="${sn}" data-direction="afternoon">
          <span class="commute-line__icon commute-line__icon--pm" title="Popołudnie">☾</span>
          <span class="commute-line__label">Popołudnie <small>pon. 15:30 → dom</small></span>
          <div class="commute-line__meta">
            <span class="commute-line__time">…</span>
            <span class="commute-line__sub">liczę przez Google Maps…</span>
          </div>
        </div>
      </div>
    </div>`;
  }

  function triggerCommuteForVisible(list) {
    if (!hasApiKey()) return;
    for (const s of list) {
      scheduleCommute(s, 'morning');
      scheduleCommute(s, 'afternoon');
    }
  }

  /* ---------------- Compare ---------------- */
  function addCompare(name) {
    if (!state.compare.has(name) && state.compare.size >= MAX_COMPARE) {
      const first = state.compare.values().next().value;
      state.compare.delete(first);
    }
    state.compare.add(name);
  }
  function toggleCompare(name) {
    if (state.compare.has(name)) state.compare.delete(name);
    else addCompare(name);
  }
  function toggleSet(set, v) { if (set.has(v)) set.delete(v); else set.add(v); }

  function renderCompareDrawer() {
    const drawer = document.getElementById('compareDrawer');
    if (state.compare.size === 0) { drawer.hidden = true; return; }
    drawer.hidden = false;
    document.getElementById('compareCount').textContent = String(state.compare.size);
    const chips = document.getElementById('compareChips');
    chips.innerHTML = [...state.compare].map(name =>
      `<span class="compare-drawer__chip"><span>${esc(name)}</span><button data-rm="${esc(name)}" aria-label="Usuń ${esc(name)} z porównania">×</button></span>`
    ).join('');
    chips.querySelectorAll('button[data-rm]').forEach(b => {
      b.addEventListener('click', () => { state.compare.delete(b.dataset.rm); render(); });
    });
    document.getElementById('compareOpen').disabled = state.compare.size < 2;
  }

  function openCompareModal() {
    // Preserve user's pick order (Set keeps insertion order).
    const schools = [...state.compare]
      .map(name => SCHOOLS.find(s => s.school === name))
      .filter(Boolean);
    if (schools.length < 2) return;
    const body = document.getElementById('compareBody');
    const idx = arr => {
      let bestMax = -Infinity, bestMin = Infinity, iMax = -1, iMin = -1;
      arr.forEach((v, i) => {
        if (typeof v === 'number') {
          if (v > bestMax) { bestMax = v; iMax = i; }
          if (v < bestMin) { bestMin = v; iMin = i; }
        }
      });
      return { max: iMax, min: iMin };
    };

    const rows = [
      { label: 'Dzielnica',          get: s => esc(s.district) },
      { label: 'Ryzyko (najlepsze)', get: s => `<span class="risk-pill" data-r="${esc(s.bestRisk)}">${esc(s.bestRisk)}</span>` },
      { label: 'Atrakcyjność',       num: s => s.bestScore,            fmtv: s => fmt(s.bestScore, 1),                                winner: 'max' },
      { label: 'Próg ’25 (min)',     num: s => progRange(s).min,        fmtv: s => fmt(progRange(s).min, 1),                          winner: 'min' },
      { label: 'Próg ’25 (max)',     num: s => progRange(s).max,        fmtv: s => fmt(progRange(s).max, 1),                          winner: 'min' },
      { label: 'Wskaźnik matury ’26',num: s => maturaIdx(s),            fmtv: s => fmt(maturaIdx(s), 1),                              winner: 'max' },
      { label: 'Ranking matury ’26', num: s => maturaRank(s),           fmtv: s => maturaRank(s) ?? '—',                              winner: 'min' },
      { label: 'Dojazd z Kobyłki',   get: s => commuteBar(commute(s)) },
      { label: 'Liczba klas',        num: s => s.classes.length,        fmtv: s => s.classes.length,                                  winner: 'max' },
      { label: 'Profile',            get: s => `<div style="display:flex;gap:4px;flex-wrap:wrap">${profileTags(s)}</div>` },
      { label: 'Mocna strona',       get: s => esc(s.why || '—') },
      { label: 'Uwaga',              get: s => esc(s.watch || '—') },
    ];

    let html = `<div class="compare-grid" style="--cols:${schools.length}">`;
    html += `<div></div>`;
    for (const s of schools) {
      html += `<div class="head">${esc(s.school)}<span class="sub">${esc(s.district)} · atr. ${fmt(s.bestScore, 0)}</span></div>`;
    }
    for (const r of rows) {
      html += `<div class="row-label">${r.label}</div>`;
      let winnerIdx = -1;
      if (r.winner) {
        const vals = schools.map(s => r.num(s));
        const i = idx(vals);
        winnerIdx = r.winner === 'max' ? i.max : i.min;
      }
      schools.forEach((s, i) => {
        const cls = i === winnerIdx ? 'winner' : '';
        const content = r.get ? r.get(s) : r.fmtv(s);
        html += `<div class="${cls}">${content}</div>`;
      });
    }
    html += `</div>`;
    body.innerHTML = html;
    openModal('modalCompare');
  }

  function openDetailModal(name) {
    const s = SCHOOLS.find(x => x.school === name);
    if (!s) return;
    document.getElementById('modalDetailEyebrow').innerHTML = `<span class="dot"></span> ${esc(s.district)} · #${s._idx + 1} na liście źródłowej`;
    document.getElementById('modalDetailTitle').textContent = s.school;
    const body = document.getElementById('detailBody');
    const gallery = (s.gallery || []).slice(0, 2).map(src => `<img src="${esc(src)}" alt="${esc(s.school)}" onerror="this.style.display='none'">`).join('');
    const classes = s.classes.map(cl => {
      const cats = classCats(cl['Klasa/kierunek'] || '');
      const tags = cats.map(cat => `<span class="tag ${TAG[cat].cls}">${TAG[cat].label}</span>`).join('');
      return `<div class="classrow">
        <div class="classrow__name">${esc(cl['Klasa/kierunek'])}${tags}<span class="risk-pill" data-r="${esc(cl['Szansa przy 168 pkt'])}">${esc(cl['Szansa przy 168 pkt'])}</span></div>
        <div class="classrow__score">${fmt(cl['Atrakcyjność 0-100'], 0)}</div>
        <div class="classrow__progs">Punktowane: ${esc(cl['Przedmioty oceniane/punktowane'] || '—')}</div>
        <div class="classrow__progs">Próg ’25 <b>${fmt(cl['Próg 2025'], 1)}</b> · ’24 ${fmt(cl['Próg 2024'], 1)} · ’23 ${fmt(cl['Próg 2023'], 1)} · luka do 168: ${cl['Luka do 168 pkt'] ?? '—'}</div>
        <div class="classrow__progs">Matura ’26 ${fmt(cl['Wskaźnik maturalny 2026'], 1)} (rank ${cl['Ranking maturalny 2026'] ?? '—'}) · IB: ${esc(cl['Matura międzynarodowa IB'] || '—')}</div>
        ${cl['Komentarz'] ? `<div class="classrow__progs"><b>Notatka:</b> ${esc(cl['Komentarz'])}</div>` : ''}
      </div>`;
    }).join('');
    const links = [
      s.official  && `<a href="${esc(s.official)}"  target="_blank" rel="noopener">strona szkoły</a>`,
      s.commons   && `<a href="${esc(s.commons)}"   target="_blank" rel="noopener">Wikimedia</a>`,
      s.opinionSources && s.opinionSources[0] && `<a href="${esc(s.opinionSources[0])}" target="_blank" rel="noopener">opinie i fora</a>`,
    ].filter(Boolean).join('');
    body.innerHTML = `
      <div class="detail-hero">
        <div style="display:grid;grid-template-rows:1fr 1fr;gap:8px;height:220px">
          ${gallery || `<div class="fallback" style="display:grid;place-items:center;border-radius:14px;background:linear-gradient(135deg,#F2E6CB,#DCCDA9);color:#6E5A35;font-family:'Fraunces',serif;font-style:italic;height:100%">${esc(s.school)}</div>`}
        </div>
        <dl class="detail-meta">
          <div class="row"><dt>Dzielnica</dt><dd>${esc(s.district)}</dd></div>
          <div class="row"><dt>Ryzyko (najlepsze)</dt><dd><span class="risk-pill" data-r="${esc(s.bestRisk)}">${esc(s.bestRisk)}</span></dd></div>
          <div class="row"><dt>Atrakcyjność</dt><dd>${fmt(s.bestScore, 1)} / 100</dd></div>
          <div class="row"><dt>Dojazd</dt><dd>${commuteBar(commute(s))}</dd></div>
          <div class="row"><dt>Profile</dt><dd>${profileTags(s)}</dd></div>
          <div class="row"><dt>Liczba klas</dt><dd>${s.classes.length}</dd></div>
        </dl>
      </div>
      <div class="section"><h3>Opis</h3><p>${esc(s.summary || '—')}</p></div>
      <div class="section"><h3>Dlaczego dla syna</h3><p>${esc(s.why || '—')}</p></div>
      <div class="section"><h3>Na co uważać</h3><p>${esc(s.watch || '—')}</p></div>
      ${commuteSectionHtml(s)}
      <div class="section"><h3>Wszystkie klasy (${s.classes.length})</h3><div class="detail-classes">${classes}</div></div>
      ${links ? `<div class="section"><h3>Linki</h3><div class="card__links">${links}</div></div>` : ''}
    `;
    openModal('modalDetail');
    // Schedule commute fetch (will populate the section once it lands)
    if (hasApiKey()) {
      scheduleCommute(s, 'morning');
      scheduleCommute(s, 'afternoon');
    }
  }

  function openModal(id) {
    const m = document.getElementById(id);
    m.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.hidden = true);
    document.body.style.overflow = '';
  }

  /* ---------------- Chips ---------------- */
  function initChips() {
    const districts = [...new Set(SCHOOLS.map(s => s.district))].sort((a, b) => a.localeCompare(b, 'pl'));
    document.getElementById('chipsDistrict').innerHTML =
      `<span class="chips__label">Dzielnica</span>` +
      districts.map(d => {
        const cnt = SCHOOLS.filter(s => s.district === d).length;
        return `<button class="chip" data-district="${esc(d)}" type="button">${esc(d)}<span class="chip__count">${cnt}</span></button>`;
      }).join('');

    document.getElementById('chipsRisk').innerHTML =
      `<span class="chips__label">Ryzyko</span>` +
      RISKS.map(r => {
        const cnt = SCHOOLS.filter(s => s.bestRisk === r || s.classes.some(c => c['Szansa przy 168 pkt'] === r)).length;
        return `<button class="chip" data-risk="${esc(r)}" type="button">${esc(r)}<span class="chip__count">${cnt}</span></button>`;
      }).join('');

    document.getElementById('chipsProfile').innerHTML =
      `<span class="chips__label">Profil</span>` +
      PROFILE_CATS.map(p => {
        const cnt = SCHOOLS.filter(s => schoolCats(s).includes(p.id)).length;
        return `<button class="chip" data-profile="${p.id}" type="button">${p.label}<span class="chip__count">${cnt}</span></button>`;
      }).join('');

    document.getElementById('chipsCommute').innerHTML =
      `<span class="chips__label">Dojazd</span>` +
      COMMUTES.map(c => {
        const cnt = SCHOOLS.filter(s => commute(s) === c).length;
        return `<button class="chip" data-commute="${esc(c)}" type="button">${esc(c)}<span class="chip__count">${cnt}</span></button>`;
      }).join('');

    document.getElementById('chipsTime').innerHTML =
      `<span class="chips__label">Czas rano</span>` +
      TIME_RANGES.map(r => {
        return `<button class="chip" data-time="${r.id}" type="button">${esc(r.label)}<span class="chip__count" data-time-count="${r.id}">–</span></button>`;
      }).join('');

    // Priority chips — klikaj profile w kolejności preferencji
    const profiles = uniqueProfiles();
    document.getElementById('chipsPriority').innerHTML =
      `<span class="chips__label">Twój ranking klas</span>` +
      profiles.map(p =>
        `<button class="chip chip--priority" data-priority="${esc(p)}" type="button">${esc(p)}</button>`
      ).join('') +
      `<span class="priority-hint">klikaj w kolejności preferencji →</span>` +
      `<button class="ghost-btn priority-clear" type="button" id="priorityClear" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M6 18 18 6"/></svg>
        Wyczyść ranking
      </button>`;

    document.querySelectorAll('[data-priority]').forEach(chip => {
      chip.addEventListener('click', () => {
        const p = chip.dataset.priority;
        const idx = state.priorityClasses.indexOf(p);
        if (idx >= 0) state.priorityClasses.splice(idx, 1);
        else state.priorityClasses.push(p);
        render();
      });
    });
    document.getElementById('priorityClear').addEventListener('click', () => {
      state.priorityClasses = [];
      render();
    });

    // Sort chips — klikaj kryteria w kolejności priorytetu
    document.getElementById('chipsSort').innerHTML =
      `<span class="chips__label">Sortuj wg</span>` +
      SORT_OPTIONS.map(o =>
        `<button class="chip chip--sort" data-sort-key="${esc(o.id)}" type="button">${esc(o.label)}</button>`
      ).join('') +
      `<span class="sort-hint">klikaj w kolejności, primary → secondary →</span>`;

    document.querySelectorAll('[data-sort-key]').forEach(chip => {
      chip.addEventListener('click', () => {
        const k = chip.dataset.sortKey;
        const idx = state.sortKeys.indexOf(k);
        if (idx >= 0) state.sortKeys.splice(idx, 1);
        else state.sortKeys.push(k);
        render();
      });
    });

    document.querySelectorAll('.chip:not([data-priority]):not([data-sort-key])').forEach(chip => {
      chip.addEventListener('click', () => {
        if (chip.dataset.district)      toggleSet(state.districts, chip.dataset.district);
        else if (chip.dataset.risk)     toggleSet(state.risks, chip.dataset.risk);
        else if (chip.dataset.profile)  toggleSet(state.profiles, chip.dataset.profile);
        else if (chip.dataset.commute)  toggleSet(state.commutes, chip.dataset.commute);
        else if (chip.dataset.time)     toggleSet(state.timeRanges, chip.dataset.time);
        render();
      });
    });
  }

  // Aktualizuje liczniki chipów czasowych na podstawie cache (po każdym render).
  function updateTimeChipCounts() {
    const counts = { lt30: 0, b30_50: 0, b50_70: 0, gt70: 0 };
    for (const s of SCHOOLS) {
      const c = readCache(s.school, 'morning');
      if (!c || c.error || typeof c.durationValue !== 'number') continue;
      const min = Math.round(c.durationValue / 60);
      for (const r of TIME_RANGES) if (r.test(min)) { counts[r.id]++; break; }
    }
    for (const id of Object.keys(counts)) {
      const el = document.querySelector(`[data-time-count="${id}"]`);
      if (el) el.textContent = String(counts[id]);
    }
  }

  function syncChipsActive() {
    document.querySelectorAll('.chip').forEach(chip => {
      let on = false;
      if (chip.dataset.district)      on = state.districts.has(chip.dataset.district);
      else if (chip.dataset.risk)     on = state.risks.has(chip.dataset.risk);
      else if (chip.dataset.profile)  on = state.profiles.has(chip.dataset.profile);
      else if (chip.dataset.commute)  on = state.commutes.has(chip.dataset.commute);
      else if (chip.dataset.time)     on = state.timeRanges.has(chip.dataset.time);
      chip.classList.toggle('is-on', on);
    });
    // Priority chips: dodatkowo numeryczne odznaki + przycisk "Wyczyść ranking"
    document.querySelectorAll('.chip--priority').forEach(chip => {
      const p = chip.dataset.priority;
      const rank = state.priorityClasses.indexOf(p);
      const on = rank >= 0;
      chip.classList.toggle('is-on', on);
      let badge = chip.querySelector('.chip__rank');
      if (on) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'chip__rank';
          chip.insertBefore(badge, chip.firstChild);
        }
        badge.textContent = String(rank + 1);
      } else if (badge) {
        badge.remove();
      }
    });
    const clearBtn = document.getElementById('priorityClear');
    if (clearBtn) clearBtn.hidden = state.priorityClasses.length === 0;

    // Sort chips: aktywny + numeryczna odznaka kolejności
    document.querySelectorAll('.chip--sort').forEach(chip => {
      const k = chip.dataset.sortKey;
      const idx = state.sortKeys.indexOf(k);
      const on = idx >= 0;
      chip.classList.toggle('is-on', on);
      let badge = chip.querySelector('.chip__rank');
      if (on) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'chip__rank';
          chip.insertBefore(badge, chip.firstChild);
        }
        badge.textContent = String(idx + 1);
      } else if (badge) {
        badge.remove();
      }
    });
  }

  /* ---------------- Hook card / row interactions ---------------- */
  function hookInteractions() {
    document.querySelectorAll('.js-pick').forEach(el => {
      el.onchange = (e) => {
        e.stopPropagation();
        const name = el.dataset.school;
        if (el.checked) addCompare(name);
        else state.compare.delete(name);
        if (state.compare.size > MAX_COMPARE) el.checked = false;
        renderCompareDrawer();
        // Sync visual + checkbox state on duplicates across views
        document.querySelectorAll('[data-school="' + cssEscape(name) + '"]').forEach(n => {
          n.classList.toggle('is-picked', state.compare.has(name));
          const cb = n.querySelector('.js-pick');
          if (cb && cb !== el) cb.checked = state.compare.has(name);
        });
      };
    });
    document.querySelectorAll('.js-pick-btn').forEach(el => {
      el.onclick = (e) => { e.stopPropagation(); toggleCompare(el.dataset.school); render(); };
    });
    document.querySelectorAll('.js-detail').forEach(el => {
      el.onclick = (e) => { e.stopPropagation(); openDetailModal(el.dataset.school); };
    });
    document.querySelectorAll('#tableBody tr').forEach(tr => {
      tr.onclick = (e) => {
        if (e.target.closest('input, button, a')) return;
        openDetailModal(tr.dataset.school);
      };
    });
    document.querySelectorAll('.listrow').forEach(lr => {
      lr.onclick = (e) => {
        if (e.target.closest('button, input, a')) return;
        openDetailModal(lr.dataset.school);
      };
    });
    document.querySelectorAll('.card__name').forEach(h => {
      h.style.cursor = 'pointer';
      h.onclick = () => {
        const card = h.closest('.card');
        if (card) openDetailModal(card.dataset.school);
      };
    });
  }
  function cssEscape(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/"/g, '\\"'); }

  /* ---------------- Render orchestrator ---------------- */
  function render() {
    const list = sortSchools(visible());

    document.getElementById('statSchools').textContent = `${list.length} z ${SCHOOLS.length}`;
    const totalClasses = list.reduce((sum, s) => sum + s.classes.length, 0);
    const filters = [
      state.districts.size && `${state.districts.size} dzieln.`,
      state.risks.size && `${state.risks.size} ryzyk.`,
      state.profiles.size && `${state.profiles.size} profil.`,
      state.commutes.size && `${state.commutes.size} dojazd.`,
      state.timeRanges.size && `${state.timeRanges.size} czas.`,
      state.maxCommute != null && `<span style="color:var(--accent-ink);font-weight:600">≤ ${state.maxCommute} min</span>`,
      state.priorityClasses.length && `<span style="color:var(--accent-ink);font-weight:600">ranking klas (${state.priorityClasses.length})</span>`,
      state.sortKeys.length && `<span style="color:var(--ink);font-weight:600">sort ${state.sortKeys.length}-poziomowy</span>`,
      state.search && `„${esc(state.search)}”`,
    ].filter(Boolean).join(' · ');
    const noun = list.length === 1 ? 'szkoła' : (list.length >= 2 && list.length <= 4) ? 'szkoły' : 'szkół';
    document.getElementById('results').innerHTML = list.length
      ? `<strong>${list.length}</strong> ${noun} · ${totalClasses} klas ${filters ? ` · filtry: ${filters}` : ''}`
      : '';

    document.getElementById('empty').hidden = list.length > 0;

    document.querySelectorAll('[data-view-pane]').forEach(p => p.hidden = p.dataset.viewPane !== state.view);

    renderCardsView(list);
    renderListView(list);
    renderTableView(list);
    renderMapDistrictList();
    renderMapQuickFilters();
    if (gmap) renderMapMarkers();

    hookInteractions();
    renderCompareDrawer();
    syncChipsActive();
    updateTimeChipCounts();

    // Po wyrenderowaniu kart, asynchronicznie liczę czasy dojazdu
    triggerCommuteForVisible(list);
  }

  /* ---------------- View switching ---------------- */
  function setView(v) {
    state.view = v;
    document.querySelectorAll('.view-btn').forEach(b => {
      const on = b.dataset.view === v;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-view-pane]').forEach(p => p.hidden = p.dataset.viewPane !== v);
    // Lazy-init Google Map on first switch to map view
    if (v === 'map' && hasApiKey()) {
      loadGoogleMaps().then(setupMap).catch(err => {
        console.warn('Google Maps load failed:', err);
      });
    }
  }

  /* ---------------- Init ---------------- */
  function init() {
    // API key gate — pokaż banner i ukryj tab Mapa jeśli brak klucza
    if (!hasApiKey()) {
      const w = document.getElementById('apiWarning');
      if (w) w.hidden = false;
      // Ukryj tab Mapa, ale zostaw tabelę/listę/karty
      const mapBtn = document.querySelector('.view-btn[data-view="map"]');
      if (mapBtn) mapBtn.style.display = 'none';
    } else {
      // Załaduj SDK w tle — potrzebne do DirectionsService dla kart
      loadGoogleMaps().catch(err => {
        console.warn('Google Maps SDK load failed:', err);
        const w = document.getElementById('apiWarning');
        if (w) {
          w.hidden = false;
          w.querySelector('.api-warning__inner').innerHTML =
            '<strong>Google Maps nie załadował się.</strong> <span>Sprawdź klucz API i restrictions w Google Cloud Console. Sprawdź też czy używasz <code>http://localhost</code> (nie <code>file://</code>).</span>';
        }
      });
    }

    initChips();

    const search = document.getElementById('search');
    search.addEventListener('input', () => { state.search = search.value; render(); });

    document.querySelectorAll('.view-btn').forEach(b => {
      b.addEventListener('click', () => { setView(b.dataset.view); });
    });

    document.getElementById('resetBtn').addEventListener('click', () => {
      state.search = ''; search.value = '';
      state.districts.clear(); state.risks.clear(); state.profiles.clear(); state.commutes.clear(); state.timeRanges.clear();
      state.maxCommute = null;
      state.priorityClasses = [];
      state.sortKeys = [];
      render();
    });
    document.getElementById('emptyReset').addEventListener('click', () => {
      state.search = ''; search.value = '';
      state.districts.clear(); state.risks.clear(); state.profiles.clear(); state.commutes.clear(); state.timeRanges.clear();
      state.maxCommute = null;
      state.priorityClasses = [];
      state.sortKeys = [];
      render();
    });

    document.getElementById('compareClear').addEventListener('click', () => { state.compare.clear(); render(); });
    document.getElementById('compareOpen').addEventListener('click', openCompareModal);

    // Modal close (any [data-close])
    document.body.addEventListener('click', e => {
      const closer = e.target.closest && e.target.closest('[data-close]');
      if (closer) {
        const m = closer.closest('.modal') || (closer.classList.contains('modal') ? closer : null);
        if (m) { m.hidden = true; document.body.style.overflow = ''; }
      }
    });

    // Keyboard
    document.addEventListener('keydown', e => {
      const inField = e.target.matches && e.target.matches('input, textarea, select');
      if (inField) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if (e.key === '/') { e.preventDefault(); search.focus(); search.select(); }
      else if (e.key === '1') setView('cards');
      else if (e.key === '2') setView('list');
      else if (e.key === '3') setView('table');
      else if (e.key === '4') setView('map');
      else if ((e.key === 'c' || e.key === 'C') && state.compare.size >= 2) openCompareModal();
      else if (e.key === 'Escape') closeAllModals();
    });

    // Table header sort — klika dodaje/usuwa kryterium do sortKeys chain
    document.querySelectorAll('.view--table thead th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        const map = {
          alpha: 'alpha', district: 'alpha',
          bestScore: 'score', risk: 'score',
          prog: 'prog-desc', ranking: 'ranking', matura: 'matura',
        };
        const key = map[k];
        if (!key) return;
        const idx = state.sortKeys.indexOf(key);
        if (idx >= 0) state.sortKeys.splice(idx, 1);
        else state.sortKeys.push(key);
        document.querySelectorAll('.view--table thead th').forEach(t => t.classList.remove('is-sorted', 'is-sorted-asc'));
        th.classList.add('is-sorted');
        render();
      });
    });

    setView(state.view);
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
