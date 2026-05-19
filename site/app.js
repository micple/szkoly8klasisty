
const grid = document.getElementById('schoolGrid');
const search = document.getElementById('search');
const district = document.getElementById('district');
const risk = document.getElementById('risk');

const districts = [...new Set(window.SCHOOLS.map(s => s.district))].sort();
district.innerHTML = '<option value="">Wszystkie dzielnice</option>' + districts.map(d => `<option>${d}</option>`).join('');

function render(){
  const q = search.value.toLowerCase();
  const d = district.value;
  const r = risk.value;
  const data = window.SCHOOLS.filter(s => {
    const text = [s.school, s.district, s.summary, ...s.classes.map(c => c['Klasa/kierunek'])].join(' ').toLowerCase();
    return (!q || text.includes(q)) && (!d || s.district === d) && (!r || s.bestRisk === r || s.classes.some(c => c['Szansa przy 168 pkt'] === r));
  });
  grid.innerHTML = data.map(card).join('');
}

function card(s){
  const top = s.classes[0];
  const gallery = s.gallery.length ? s.gallery.slice(0,3).map(src => `<img src="${src}" loading="lazy" alt="${s.school}">`).join('') : `<div class="fallback">${s.school}<br><small>linki do zdjęć w źródłach</small></div><div class="fallback">galeria</div><div class="fallback">zdjęcia</div>`;
  const matura = `<div class="matura">
    <span>${top['Matura międzynarodowa IB'] === 'TAK' ? 'IB DP' : 'matura polska'}</span>
    <strong>${top['Wskaźnik maturalny 2026'] || 'brak danych'}</strong>
    <small>ranking 2026: ${top['Ranking maturalny 2026'] || 'brak danych'} · E ${top['E - matura szkoły 0-100']}</small>
  </div>`;
  const classes = s.classes.slice(0,3).map(c => `<div class="classrow">
    <div class="classhead"><span>${c['Klasa/kierunek']}</span><strong>${c['Atrakcyjność 0-100']}</strong></div>
    <div class="classmeta">Punktowane: ${c['Przedmioty oceniane/punktowane'] || 'sprawdzić w rekrutacji'}</div>
    <div class="classmeta">Progi: 2024 ${c['Próg 2024'] || '-'}, 2025 ${c['Próg 2025'] || '-'}, średnia ${c['Średnia progów'] || '-'}</div>
    <div class="classmeta">Egzamin z angielskiego: ${c['Egzamin dodatkowy z języka angielskiego'] || 'nie'}</div>
  </div>`).join('');
  const links = [
    s.official && `<a href="${s.official}" target="_blank">strona szkoły</a>`,
    s.commons && `<a href="${s.commons}" target="_blank">Wikimedia</a>`,
    `<a href="${s.gallerySources[1]}" target="_blank">więcej zdjęć</a>`,
    `<a href="${s.opinionSources[0]}" target="_blank">opinie i fora</a>`
  ].filter(Boolean).join('');
  return `<article class="card">
    <div class="media">${gallery}</div>
    <div class="content">
      <h2>${s.school}</h2>
      <div class="meta"><span class="pill">${s.district}</span><span class="pill score">atrakcyjność ${s.bestScore}</span><span class="pill risk">${s.bestRisk}</span></div>
      ${matura}
      <div class="section"><h3>Opis szkoły</h3><p>${s.summary}</p></div>
      <div class="section"><h3>Dlaczego dla syna</h3><p>${s.why}</p></div>
      <div class="section"><h3>Na co uważać</h3><p>${s.watch}</p></div>
      <div class="section"><h3>Najlepsze klasy z listy</h3><div class="classes">${classes}</div></div>
      <div class="section"><h3>Opinie z internetu</h3><p>${s.opinion}</p><div class="links">${links}</div></div>
    </div>
  </article>`;
}

[search,district,risk].forEach(el => el.addEventListener('input', render));
render();
