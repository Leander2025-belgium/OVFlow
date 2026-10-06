OVFlow 4.2 — STATIC-FIRST LIVE OV

BELANGRIJK
Deze versie is gemaakt om ook op statische HTTPS-hosting te werken.
De frontend probeert niet meer automatisch /api/v4/health, /api/health of /api/delijn/nearby.

HOOFDFUNCTIES
- Home met vertrekken dichtbij
- Zoeken naar haltes en stations
- Routeplanner bus / tram / trein
- Realtime waar beschikbaar
- Live Trip
- NMBS-details via iRail
- Kaart en opgeslagen ritten

DATABRONNEN
- Transitous / MOTIS voor zoeken, vertrekborden, routes en tripdata
- iRail voor extra NMBS-informatie
- OpenStreetMap voor kaart/routingcontext
- Digitaal Vlaanderen / De Lijn voor de optionele geografische haltelaag

DEPLOY
Host deze map via HTTPS. Een eigen Node-server is niet vereist voor de primaire app.
Open niet via file:// als je GPS en netwerkfuncties betrouwbaar wilt gebruiken.

CHECK
npm run check
