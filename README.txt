OVFlow v8 — LIVE RIT ZONDER EIGEN SERVER

Deze versie verwijdert de afhankelijkheid van een eigen OVFlow-server voor de snelle Live Rit-zoekfunctie.

WERKING
1. Typ een lijnnummer, bijvoorbeeld 50.
2. Tik 'Zoek rond mij'.
3. De browser vraagt GPS-toegang.
4. OVFlow laadt de dichtstbijzijnde De Lijn-haltes rechtstreeks.
5. OVFlow vraagt rechtstreeks realtime doorkomsten op via de De Lijn Core API.
6. Alleen ritten van de gezochte lijn worden getoond.
7. Kies de juiste richting/rit.
8. OVFlow koppelt de rit aan Transitous/MOTIS om de volledige haltevolgorde te krijgen.
9. Live Trip start met GPS, volgende halte, haltes te gaan en uitstapwaarschuwing.

GEEN EIGEN SERVER NODIG
Je hoeft voorlopig geen Node.js/Express/laptopserver te draaien.

Externe diensten die de browser rechtstreeks gebruikt:
- De Lijn Core API: realtime doorkomsten
- Digitaal Vlaanderen WFS: De Lijn-haltes
- Transitous/MOTIS: rit/haltevolgorde en routing
- iRail: NMBS-livegegevens bij treinritten
- OpenStreetMap/MapLibre: kaart

BELANGRIJK
Omdat deze testversie browser-only is, staat de De Lijn API-sleutel nog in config.js.
Dat is bruikbaar tijdens ontwikkeling, maar niet geschikt voor een publieke productieversie.

Gebruik via HTTPS of localhost. Niet rechtstreeks via file:// als je browser CORS/geolocatie blokkeert.

Lokaal:
  python -m http.server 8080

Daarna:
  http://localhost:8080
