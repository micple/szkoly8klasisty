# Setup — Szkoły dla syna (site-v2)

Krok po kroku jak uruchomić stronę z prawdziwą mapą Google i czasami dojazdu.

## 1. Google Cloud — założenie klucza API

Robisz to **raz**. Wymaga karty kredytowej (przy Twoim wolumenie zero opłat — mieścisz się głęboko w darmowym tierze).

1. Wejdź na <https://console.cloud.google.com>
2. **Create project** → nazwa np. `szkoly-syn`
3. Lewy panel → **Billing** → włącz, dodaj kartę
4. Lewy panel → **APIs & Services** → **Library** → włącz każdą z trzech:
   - **Maps JavaScript API**
   - **Routes API** (zawiera Directions, czasy dojazdu)
   - **Geocoding API** (potrzebne do strony `geocode.html`)
5. **APIs & Services** → **Credentials** → **Create credentials** → **API key**
6. Skopiuj klucz, kliknij **Edit API key**:
   - **Application restrictions** → **HTTP referrers (web sites)** → dodaj:
     - `http://localhost/*`
     - `http://127.0.0.1/*`
   - **API restrictions** → **Restrict key** → zaznacz tylko trzy API z punktu 4
   - **Save**

> **Dlaczego restrictions są kluczowe:** bez nich, jeśli klucz wycieknie (np. wkleisz do czatu albo zacommitujesz do gita), każdy może go użyć i wygenerować Ci rachunek na Twoim koncie. Z restrictions klucz działa tylko z Twojego komputera.

## 2. Wklejenie klucza do projektu

Otwórz `site-v2/config.local.js` i wklej klucz w miejsce wartości `window.GMAPS_API_KEY`:

```js
window.GMAPS_API_KEY = 'AIzaSy...twoj-klucz...';
```

Jeśli plik jeszcze nie istnieje — skopiuj `site-v2/config.example.js` jako `site-v2/config.local.js` i podmień wartość.

## 3. Lokalny serwer HTTP (wymagany)

Google Maps wymaga żebyś otwierał stronę przez `http://localhost`, nie przez `file://` (z powodu HTTP referrer restrictions). Najprostsza opcja w PowerShellu:

```powershell
cd C:\Users\Admin\Desktop\szkoly8klasisty
python -m http.server 8000
```

Zostaw to okno otwarte. Serwer działa dopóki nie zamkniesz.

Alternatywy:
- `npx serve .` (jeśli masz Node)
- VS Code Live Server

## 4. Geocoding 31 szkół (jednorazowo)

Mapa wymaga współrzędnych (lat/lng) per szkoła. Pobierasz je raz przez stronę `geocode.html`:

1. W przeglądarce otwórz: <http://localhost:8000/site-v2/geocode.html>
2. Klik **„Geocode all"** — strona iteruje 31 szkół, każda dostaje pinezkę na mini-mapie po lewej
3. Sprawdź pinezki — czy są w sensownych miejscach Warszawy. Jeśli któraś poszła w pole albo na zły adres, możesz ręcznie poprawić lat/lng w tabeli
4. Klik **„Pobierz data.js"** — pobierze się plik `data.js` z dopisanymi `lat`/`lng`
5. Zapisz pobrany plik nadpisując `site\data.js` (potwierdź w Eksploratorze)

> Geocoding nie działa z Node ze względu na referrer restrictions klucza — dlatego browser-side.
> Google ToS pozwala cache'ować lat/lng max 30 dni. Po tym czasie powtórz krok 4.

## 5. Uruchomienie strony głównej

Mając serwer z punktu 3 i uzupełnione współrzędne z punktu 4:

<http://localhost:8000/site-v2/index.html>

Co zobaczysz:
- Karty 31 szkół, każda z sekcją **Dojazd z Kobyłki** pokazującą rano + popołudnie (czas, przesiadki, dystans). Pierwsze ładowanie zajmuje kilka sekund — robione asynchronicznie. Następne otwarcie używa cache (7 dni).
- Widok **Mapa** — interaktywna Google Maps z markerami szkół + Kobyłka, kliknij marker żeby zobaczyć minicard
- Wszystkie pozostałe funkcje (filtry, sortowanie, lista, tabela, porównanie 2-3 szkół) działają jak wcześniej

## 6. Disclaimer

Czasy dojazdu są liczone dla **poniedziałku 07:30** (rano) i **15:30** (popołudnie) — najbliższy nadchodzący poniedziałek. To godziny szczytu szkolnego. W rzeczywistości mogą się różnić ±10 min (opóźnienia ZTM, korki). Dane pochodzą oficjalnie z Google → ZTM Warszawa GTFS + Koleje Mazowieckie GTFS.

## 7. Aktualizacja danych szkół

Edytuj **tylko** `site\data.js` (jedno źródło prawdy — czyta to i `site/`, i `site-v2/`). Jeśli zmienisz nazwę szkoły albo dodasz nową, uruchom ponownie `geocode.html` żeby pobrać współrzędne nowych pozycji (idempotentne — pominie te już mające `lat`/`lng`).

## 8. Diagnostyka

| Objaw | Co sprawdzić |
|-------|--------------|
| Banner „Brak klucza Google Maps" | Brakuje `site-v2/config.local.js` lub klucz w nim pusty |
| `RefererNotAllowedMapError` w konsoli | Restrictions klucza nie pasują do `http://localhost`. Sprawdź Google Cloud → Credentials → Edit |
| `ApiNotActivatedMapError` | W projekcie Google Cloud nie włączyłeś którego API (Maps JS, Routes lub Geocoding) |
| `OverQuotaMapError` | Skończył się darmowy tier (mało prawdopodobne przy tym wolumenie). Sprawdź metrics w Google Cloud |
| Mapa pusta, brak markerów | `data.js` nie ma jeszcze pól `lat`/`lng`. Uruchom geocode.html |
| Czasy dojazdu nie ładują się | DevTools → Console — sprawdź błędy. Sprawdź też zakładkę Network czy są wywołania do `maps.googleapis.com` |
| Strona w ogóle nie ładuje się przez `localhost` | Lokalny serwer nie działa. Wróć do kroku 3 |
