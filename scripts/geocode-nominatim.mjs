// Geocoding 31 szkół przez OpenStreetMap Nominatim (bez API key, bez Cloudflare).
// Uzupełnia site/data.js o lat/lng. Idempotentne — pomija szkoły już z koordynatami.
// Compliance z Nominatim ToS: 1 req/sec + User-Agent + bbox filter na Warszawę.
//
// Uruchomienie: node scripts/geocode-nominatim.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, '..', 'site', 'data.js');

// Warsaw bounding box (z bufferem): lat 52.0–52.4, lng 20.7–21.4
const BBOX = { latMin: 52.05, latMax: 52.40, lngMin: 20.75, lngMax: 21.35 };
const UA = 'szkoly8klasisty/1.0 (one-off local tool for choosing high school for child; contact: local user)';
const DELAY_MS = 1100; // Nominatim ToS: max 1 req/sec

function inBbox(lat, lng) {
  return lat >= BBOX.latMin && lat <= BBOX.latMax && lng >= BBOX.lngMin && lng <= BBOX.lngMax;
}

function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Strategie zapytań w kolejności malejącej szczegółowości.
// Krócej zwykle = lepiej dla Nominatim. Dodatkowy filter bbox.
function queries(school) {
  const name = school.school;
  const district = school.district;
  // Wyodrębnij "im. <name>" patron jeśli istnieje
  const patronMatch = name.match(/im\.\s+([^,\-]+?)(?:\s+-|$)/);
  const patron = patronMatch ? patronMatch[1].trim() : null;
  // Wyodrębnij rzymski numer (np. "XXVII LO")
  const romanMatch = name.match(/^([IVXLCDM]+)\s+LO/i);
  const roman = romanMatch ? romanMatch[1] : null;

  const out = [];
  if (patron && roman) out.push(`${roman} LO ${patron.split(' ').pop()} Warszawa`);
  if (patron) out.push(`Liceum ${patron.split(' ').pop()} Warszawa`);
  if (roman) out.push(`${roman} Liceum Warszawa`);
  out.push(`${name.split(' ').slice(0, 4).join(' ')} ${district} Warszawa`);
  out.push(`${name} Warszawa`);
  if (district) out.push(`${name.split(',')[0].slice(0, 60)} ${district} Warszawa`);
  // Wersje bez diakrytyków jako fallback
  return [...new Set(out)].filter(Boolean);
}

// Globalny throttle żeby zawsze trzymać 1.1s odstępu między requestami (Nominatim ToS).
let lastReqEnd = 0;
async function throttledFetch(url) {
  const wait = Math.max(0, lastReqEnd + DELAY_MS - Date.now());
  if (wait > 0) await sleep(wait);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pl,en' } });
    return res;
  } finally {
    lastReqEnd = Date.now();
  }
}

async function searchOnce(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '5');
  url.searchParams.set('countrycodes', 'pl');
  url.searchParams.set('viewbox', `${BBOX.lngMin},${BBOX.latMax},${BBOX.lngMax},${BBOX.latMin}`);
  url.searchParams.set('bounded', '1');
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Walidacja STRICT — patron/numer/keyword musi pojawić się w PIERWSZYM segmencie
// display_name (właściwa nazwa szkoły, nie ulica ani dzielnica).
function isMatch(school, displayName) {
  const name = school.school;
  const dnFull = displayName.toLowerCase();
  const dn = dnFull.split(',')[0].trim(); // pierwszy segment = nazwa miejsca
  // 1. Patron name (im. <name>) — musi być w pierwszym segmencie
  const patronMatch = name.match(/im\.\s+([^,\-\(]+)/i);
  if (patronMatch) {
    const tokens = patronMatch[1].trim().split(/\s+/).filter(t => t.length > 3);
    const found = tokens.find(t => dn.includes(t.toLowerCase()));
    if (found) return 'patron:' + found;
  }
  // 2. Numer rzymski (np. "XXVII LO ...") — w pierwszym segmencie + bezpośrednio przed "liceum/lo"
  const romanMatch = name.match(/^([IVXLCDM]+)\s+(?:liceum|lo)/i);
  if (romanMatch) {
    const roman = romanMatch[1];
    const re = new RegExp(`\\b${roman}\\s+(?:liceum|lo)\\b`, 'i');
    if (re.test(dn)) return 'roman:' + roman;
  }
  // 3. Technika — keyword w pierwszym segmencie
  if (/^technikum/i.test(name)) {
    const keywords = ['mechatron', 'elektronicz', 'kinematograf', 'geologiczn', 'geodez', 'łączności', 'lacznosci', 'program', 'komputer'];
    const found = keywords.find(k => name.toLowerCase().includes(k) && dn.includes(k));
    if (found) return 'tek:' + found;
  }
  // 4. Międzynarodowe — keyword w pierwszym segmencie
  const intlMatch = name.match(/(international|british|montessori|american|french|german|monnet|vizja|nazaretanek|jasienicy|sióstr|siostr)/i);
  if (intlMatch) {
    const kw = intlMatch[1].toLowerCase();
    if (dn.includes(kw) || dn.includes(kw.replace('ó', 'o'))) return 'intl:' + kw;
  }
  return null;
}

async function geocodeSchool(school, idx, total) {
  const tries = queries(school);
  for (const q of tries) {
    try {
      const results = await searchOnce(q);
      // Filtruj: musi być w bbox + musi pasować nazwa
      for (const r of results) {
        const lat = parseFloat(r.lat);
        const lng = parseFloat(r.lon);
        if (!isFinite(lat) || !isFinite(lng) || !inBbox(lat, lng)) continue;
        const matchKind = isMatch(school, r.display_name);
        if (matchKind) {
          console.log(`[${idx + 1}/${total}] ✓ ${school.school}`);
          console.log(`    → ${lat.toFixed(5)}, ${lng.toFixed(5)} via "${q}" [${matchKind}]`);
          console.log(`    ${r.display_name.slice(0, 100)}`);
          return { lat, lng, _addr: r.display_name, _query: q, _match: matchKind };
        }
      }
    } catch (e) {
      console.warn(`    query "${q}" failed: ${e.message}`);
    }
  }
  console.log(`[${idx + 1}/${total}] ✗ ${school.school} — brak dopasowania po ${tries.length} zapytaniach`);
  return null;
}

function parseDataJs(content) {
  // Wyciągnij array między pierwszym `[` po "window.SCHOOLS" a ostatnim `]` przed `;`
  const startIdx = content.indexOf('[');
  const endIdx = content.lastIndexOf(']');
  if (startIdx < 0 || endIdx < 0) throw new Error('Nieprawidłowy format data.js');
  const arrStr = content.slice(startIdx, endIdx + 1);
  return JSON.parse(arrStr);
}

function serializeDataJs(arr) {
  return 'window.SCHOOLS = ' + JSON.stringify(arr, null, 2) + ';\n';
}

async function main() {
  if (!fs.existsSync(DATA_PATH)) {
    console.error('Nie znaleziono', DATA_PATH);
    process.exit(1);
  }
  const original = fs.readFileSync(DATA_PATH, 'utf8');
  // Backup
  const backupPath = DATA_PATH + '.bak';
  fs.writeFileSync(backupPath, original, 'utf8');
  console.log(`Backup zapisany: ${backupPath}\n`);

  const schools = parseDataJs(original);
  console.log(`Załadowano ${schools.length} szkół.\n`);

  let ok = 0, skip = 0, err = 0;
  for (let i = 0; i < schools.length; i++) {
    const s = schools[i];
    if (typeof s.lat === 'number' && typeof s.lng === 'number') {
      skip++;
      continue;
    }
    const result = await geocodeSchool(s, i, schools.length);
    if (result) {
      s.lat = result.lat;
      s.lng = result.lng;
      ok++;
    } else {
      err++;
    }
  }

  console.log(`\nKoniec: ${ok} OK, ${err} błędów, ${skip} pominiętych.`);
  if (ok > 0) {
    fs.writeFileSync(DATA_PATH, serializeDataJs(schools), 'utf8');
    console.log(`Zapisano nowy ${DATA_PATH}`);
  } else {
    console.log('Nic nie zaktualizowano — data.js bez zmian.');
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
