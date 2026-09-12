# OVFlow 2.1 — statische/serverloze versie

Deze versie heeft **geen Node.js-, Express- of eigen API-server nodig**. Upload de bestanden in deze map rechtstreeks naar een statische host zoals GitHub Pages, Cloudflare Pages of Netlify.

## Wat werkt rechtstreeks in de browser
- De Lijn haltezoeker via Digitaal Vlaanderen WFS
- De Lijn realtime doorkomsten via de Core Open Data API
- Routeplanning voor bus, tram en trein via Transitous
- NMBS-stations en trein-livegegevens via iRail
- Live Trip met GPS, vertraging, volgende haltes/stations en spoorinformatie waar de bron die levert
- Kaart, favorieten/voorkeurshalte en PWA-cache
- Geen backend, database of `npm install` nodig

## Installeren
1. Upload `index.html`, `style.css`, `config.js`, `app.js`, `planner.js`, `quick-live.js`, `sw.js` en `manifest.webmanifest` naar je website/GitHub Pages.
2. Open de site via **HTTPS**. GPS en service workers werken niet betrouwbaar wanneer je `index.html` rechtstreeks als `file://` opent.
3. Geef locatie-toegang wanneer OVFlow daar om vraagt.

## Belangrijk over De Lijn API-sleutels
Omdat dit een volledig statische app is, moeten browseraanvragen rechtstreeks naar De Lijn gaan. Daardoor kan een API-sleutel die in `config.js` staat door bezoekers worden bekeken. Dat is technisch onvermijdelijk zonder backend. Gebruik alleen een De Lijn Open Data-key die je hiervoor mag gebruiken en bewaak de quota in het De Lijn-portaal.

## Geen nep-live-data
Wanneer een externe databron onbereikbaar is of browser/CORS-beleid de oproep blokkeert, toont OVFlow een foutmelding in plaats van verzonnen livegegevens.
