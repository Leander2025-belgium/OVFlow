# OVFlow 4.2 — belangrijkste wijzigingen

## Kritieke fouten opgelost

- `api/v4/health` 404: frontend probeert deze route niet meer.
- `api/health` 404: frontend probeert deze route niet meer.
- `api/delijn/nearby` 404: Dichtbij gebruikt nu publieke Transitous/MOTIS-data.
- `favicon.ico` 404: favicon is ingebed en PWA-iconen zijn toegevoegd.
- verouderde mobile-web-app meta: moderne `mobile-web-app-capable` meta toegevoegd.
- routeplanner probeerde lokale backend vóór Transitous: nu direct Transitous.
- Live Trip probeerde lokale backend vóór Transitous: nu direct Transitous.
- NMBS voertuigdetails probeerden lokale proxy vóór iRail: nu direct iRail.
- oude handmatige De Lijn entiteit/haltenummer-instellingen verwijderd uit de zichtbare instellingen.

## Nieuwe datalaag

`core-client.js` is opnieuw opgebouwd als static-first client met:

- zoekcache;
- korte vertrekcache;
- timeouts;
- Transitous geocode;
- Transitous reverse geocode;
- MOTIS stoptimes;
- uniforme bus/tram/trein-normalisatie;
- afstandsberekening;
- realtime, vertraging, annulering en perron/spoor-informatie waar de bron die levert.

## Resultaat

De primaire OVFlow-interface kan nu op een normale statische HTTPS-host werken zonder dat er een eigen `/api`-server op hetzelfde domein aanwezig is.
