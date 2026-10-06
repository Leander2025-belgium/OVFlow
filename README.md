# OVFlow 4.2 — Static-first live OV

OVFlow is een mobile-first Belgische OV-app voor bus, tram en trein. Versie 4.2 herbouwt de datalaag zodat de frontend ook op gewone statische hosting blijft werken en niet leegvalt wanneer er geen eigen Node `/api`-backend draait.

## Wat 4.2 oplost

De 4.1-frontend probeerde eerst lokale routes zoals `/api/v4/health`, `/api/health` en `/api/delijn/nearby`. Op GitHub Pages of andere statische hosting bestaan die routes niet, waardoor de browser 404's gaf en onderdelen zonder informatie bleven.

4.2 doet dat niet meer:

- geen automatische lokale `/api/*` probes vanuit de browser;
- halte/station zoeken rechtstreeks via Transitous/MOTIS geocoding;
- haltes/stations dichtbij via Transitous reverse geocoding;
- vertrekborden via MOTIS `/api/v6/stoptimes` met realtime waar beschikbaar;
- routeplanner rechtstreeks via MOTIS `/api/v6/plan`;
- Live Trip refresh rechtstreeks via MOTIS `/api/v6/trip`;
- extra NMBS-ritdetails via iRail;
- Digitaal Vlaanderen WFS blijft beschikbaar voor de optionele De Lijn-kaartlaag;
- geen fake ritten of nepvertragingen.

## Starten — aanbevolen

OVFlow 4.2 kan als statische website gehost worden. Zet de inhoud van deze map op een HTTPS-host en open `index.html` via de website. HTTPS is belangrijk voor browser-geolocatie buiten localhost.

Voor lokaal testen kun je bijvoorbeeld een eenvoudige lokale webserver gebruiken. Open de bestanden niet rechtstreeks met `file://`, omdat browsers dan netwerk- en locatiefunctionaliteit kunnen beperken.

## Optionele Node-server

`server.js` blijft in het project voor oudere/uitgebreide serverfuncties, maar de hoofdinterface heeft hem niet meer nodig voor zoeken, dichtbij, reisadvies en live OV-data. Daardoor blijft de app bruikbaar als alleen de frontend wordt gedeployed.

## Databronnen

- Transitous / MOTIS: zoeken, haltes/stations, vertrekborden, routing en live tripdata.
- iRail: extra NMBS/SNCB-ritinformatie.
- OpenStreetMap: kaart en routeringsgeografie via Transitous.
- Digitaal Vlaanderen / De Lijn: geografische De Lijn-haltelaag waar gebruikt.

De Transitous-attributielink staat zichtbaar in de routeplanner. Controleer voor een publieke of commerciële release altijd de actuele gebruiksvoorwaarden en licenties van alle databronnen.

## Kwaliteitschecks

Voer uit:

```bash
npm run check
```

Dit controleert de syntax van de belangrijkste JavaScript-bestanden.
