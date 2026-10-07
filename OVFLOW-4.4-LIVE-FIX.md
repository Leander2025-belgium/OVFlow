# OVFlow 4.4 – Live rit fix

## Opgelost

- Een klik op een lijn accepteert niet langer een onvolledige MOTIS-leg als eindresultaat.
- `/api/v6/trip` en `stoptimes?fetchStops=true` worden parallel geprobeerd. OVFlow kiest de kandidaat met de meeste bruikbare haltes.
- Live Trip start alleen wanneer minstens vertrek- en aankomsthalte geldige coördinaten hebben.
- De backend kan exacte De Lijn voertuigposities leveren via de legacy GTFS-realtimefeed.
- Exacte voertuigpositie wordt om de 15 seconden vernieuwd als `API_BASE` ingesteld is.
- Zonder backend blijft de app werken met publieke Transitous-data en een geschatte positie.

## Backend inschakelen

Zet in `.env` minimaal `DELIJN_GTFS_API_KEY=<jouw De Lijn GTFS realtime key>`.
Start/deploy daarna `server.js` en zet in `config.js` `API_BASE` op de publieke HTTPS-URL van die server.
