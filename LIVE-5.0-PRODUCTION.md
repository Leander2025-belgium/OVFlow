# OVFlow Live 5.0 — Production

Deze release bouwt verder op de bestaande OVFlow live-architectuur en behoudt de API-integraties, route-lock, trip-terminal-lock, GTFS-shapes en GPS-fallback.

## Gewijzigde frontendbestanden
- `live.html`
- `live.css`
- `live.js`
- `config.js`
- `sw.js`

## Belangrijkste wijzigingen
- Premium mobiele Live 5.0-layout met compacte hero, kaart en volgende-haltekaart.
- Minstens ongeveer vijf komende haltes zichtbaar op normale iPhones; alleen de haltelijst scrollt.
- Echte vertrektijden uit GTFS-Realtime Trip Updates wanneer beschikbaar; geplande/payloadtijd als fallback.
- Geen interne stopnummers als tijd-fallback.
- Realtime vertraging per halte uit Trip Updates wanneer beschikbaar.
- Voertuig-GPS iedere ~7 seconden; rit-/haltetijden iedere ~25 seconden.
- Handmatige refresh zonder pagina-reload.
- Volg voertuig pauzeert 9 seconden na handmatig slepen/zoomen zodat de kaart niet terugvecht.
- Vloeiende voertuigmarker en voortgangsbalk.
- Segmentvoortgang tussen vorige en huidige/volgende halte in plaats van alleen globale routevoortgang.
- Volledige routeknop en aparte `Route via haltes`-focus.
- Geen harde crash wanneer GPS, trip updates of voertuig-ID ontbreken.

## Backend
Live 5.0 gebruikt bestaande OVFlow-endpoints:
- `/api/v4/vehicle-position`
- `/api/v4/delijn/line-stops`
- `/api/v4/delijn/route-shape`
- `/api/gtfs/delijn/trip-updates`

Voor realtime vertrektijden per halte is de bestaande OVFlow backend 4.9.4-patch aanbevolen. Zonder Trip Updates blijft de pagina werken en gebruikt hij geplande tijden wanneer die aanwezig zijn.

## Installatie
Pak de patch in de bestaande OVFlow frontendmap uit en overschrijf alleen de meegeleverde bestanden. Door de nieuwe service-worker cache `ovflow-static-live-5.0-production` wordt de oude Live-cache bij activatie verwijderd.
