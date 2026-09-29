# OVFlow 4.0.1

Deze build lost de 404-mismatch op tussen de nieuwe OVFlow 4-frontend en een server die nog de oudere Core-routes draait.

## Belangrijkste wijzigingen

- Nieuwe `core-client.js` detecteert automatisch of OVFlow Core 4 beschikbaar is.
- `/api/v4/nearby` krijgt een compatibiliteitsfallback via de bestaande De Lijn-routes.
- Nearby probeert in compatibiliteitsmodus ook NMBS-stations en vertrekken via iRail te laden.
- Haltevertrekken vallen automatisch terug op `/api/delijn/departures` als de v4-route nog niet bestaat.
- De routeplanner gebruikt OVFlow Core 4 als eerste keuze en Transitous rechtstreeks als tijdelijke fallback bij een oude backend.
- Live Trip gebruikt dezelfde compatibiliteitslogica voor Transitous.
- NMBS-treindetails vallen bij een ontbrekende Core 4-route terug op iRail.
- De status bovenaan controleert nu de Core zelf. Een halte zonder realtime-data wordt niet langer onterecht als `API-fout` gepresenteerd.
- Dichtbij laadt automatisch wanneer locatietoegang al eerder is toegestaan.
- Cache-/assetversie verhoogd naar 4.0.1.
- Oude zichtbare 3.0-versie in de header vervangen door 4.0.

## Aanbevolen deployment

Vervang alle bestanden samen, inclusief `server.js` en `core-client.js`, en herstart daarna de Node-service. De compatibiliteitslaag voorkomt ondertussen dat een frontend/backend-versiemismatch meteen de hele app breekt.
