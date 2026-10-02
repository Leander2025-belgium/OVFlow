# OVFlow 4.1 — UX & Performance

## Browserbelasting

- MapLibre en OpenStreetMap-tiles laden pas wanneer de kaart daadwerkelijk wordt geopend.
- De verborgen legacy halteweergave pollt niet meer iedere 15 seconden op Home/Reizen.
- Routeplanner zoekt plaatsen via `/api/v4/search`; de browser downloadt niet langer de volledige De Lijn-haltecatalogus.
- Dichtstbijzijnde halte voor de routeplanner loopt via de server-side nearby endpoint.
- Quick Live gebruikt een nieuwe lichte `/api/v4/stops/nearby` endpoint.
- De kaart gebruikt dezelfde lichte nearby endpoint in plaats van alle haltes lokaal te sorteren.
- GPS gebruikt waar mogelijk een recente positie zodat iPhone minder vaak een dure high-accuracy fix hoeft te maken.

## Gebruiksvriendelijkheid

- `Toon op kaart` opent nu daadwerkelijk de Kaart-tab en laadt die pas dan.
- Live Trip kaart volgen opent de Kaart-tab wanneer de gebruiker dat expliciet kiest.
- Planner-zoekresultaten komen uit de centrale OVFlow Core en kunnen zowel relevante haltes als stations bevatten.
- Oude achtergrondprocessen blijven beschikbaar als fallback maar draaien niet langer onzichtbaar mee.

## Nieuwe Core endpoint

`GET /api/v4/stops/nearby?lat=...&lon=...&radius=2500&max=12`

Geeft alleen de benodigde nabijgelegen De Lijn-haltes terug zonder realtime vertrekken. Dat is bedoeld voor kaart, GPS-origin en Live Rit discovery.
