# OVFlow 4.1 — UX & Performance

OVFlow wordt één geïntegreerde Belgische OV-app voor bus, tram en trein.
Deze build bouwt verder op Core 4 en focust op gebruiksvriendelijkheid en veel lagere browserbelasting. De homescreen, routeplanner en live-data blijven zonder nep-live-data werken.

## Starten

1. `npm install`
2. Maak een `.env` met minimaal `DELIJN_CORE_API_KEY=...`
3. Optioneel: `DELIJN_GTFS_API_KEY` en `DELIJN_STATIC_API_KEY`
4. `npm start`
5. Open `http://localhost:3000`

Gebruik HTTPS wanneer je OVFlow op een echte host zet; GPS vereist buiten localhost een veilige context.

## OVFlow Core 4.1

De browser bevat geen De Lijn API-sleutels meer. De frontend gebruikt de eigen server als centrale datalaag.

Belangrijkste nieuwe endpoints:

- `GET /api/v4/health`
- `GET /api/v4/search?q=...`
- `GET /api/v4/nearby?lat=...&lon=...`
- `GET /api/v4/stops/:entity-:stop/departures`
- `GET /api/v4/journeys?...`
- `GET /api/v4/trips/live?tripId=...`
- `GET /api/v4/rail/liveboard?id=...`
- `GET /api/v4/rail/vehicle?id=...`

De oude `/api/delijn/*` routes blijven voorlopig aanwezig zodat bestaande onderdelen niet abrupt breken.

## Wat deze build al verandert

- 4 tabs: Home, Reizen, Kaart, Opgeslagen.
- Nieuwe lichte mobile-first home.
- Eén grote “Waar wil je naartoe?”-actie.
- “Vertrekt binnenkort” combineert De Lijn-haltes en NMBS-stations rond de gebruiker.
- Uniform departure-model voor bus/tram/trein.
- Routeplanner en Live Trip lopen via OVFlow Core in plaats van rechtstreeks naar externe API's.
- iRail/Transitous calls hebben korte server-side caches.
- Oude browser-side De Lijn-sleutels zijn verwijderd.
- Functionele vervoersiconen gebruiken SVG in plaats van emoji.

## Geen fake data

Wanneer realtime-data niet beschikbaar is, toont OVFlow dat expliciet. Er worden geen statische voorbeeldritten, nepvertragingen of fake voertuigposities gebruikt.
