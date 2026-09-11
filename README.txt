OVFlow v3.1 — HALTEZOEKER + ECHTE KAART + LIVE DOORKOMSTEN

Nieuw in v3.1
- Zoek De Lijn-haltes op naam, gemeente, straat of andere haltevelden.
- Haltezoeker gebruikt de publieke WFS Haltes De Lijn van Digitaal Vlaanderen.
- Echte interactieve OpenStreetMap-kaart via MapLibre.
- Haltemarkers op de kaart.
- Tik op een halte op de kaart en kies "Bekijk doorkomsten".
- Knop "Rond mij" gebruikt de browserlocatie en toont nabijgelegen haltes.
- Geselecteerde halte wordt opgeslagen in de browser.
- Live doorkomsten blijven rechtstreeks uit de De Lijn Core API komen.
- Automatische refresh om de 30 seconden.
- Geen demo-data wanneer een API mislukt.

Bestanden
- index.html
- style.css
- app.js
- config.js
- README.txt

Starten zonder eigen backend
Gebruik bij voorkeur een lokale webserver:

  cd OVFlow-v3.1
  python -m http.server 8080

Open daarna:
  http://localhost:8080

Waarom niet gewoon dubbelklikken?
Sommige browsers beperken fetch/CORS/API-verzoeken vanuit file://.

Kaart
OVFlow gebruikt MapLibre GL JS met OpenStreetMap rastertiles.
De haltepunten worden geladen uit:
https://geo.api.vlaanderen.be/Haltes/wfs
Layer: Haltes:Halte

Live doorkomsten
OVFlow gebruikt daarna het De Lijn Core realtime-endpoint voor de gekozen halte.

Belangrijk
Dit is nog een browser-only testversie. De API-sleutels staan in config.js en zijn dus zichtbaar voor iemand die de bestanden kan bekijken. Publiceer deze versie niet met je huidige sleutels. Voor een publieke release moet de De Lijn API via je eigen backend/proxy lopen.
