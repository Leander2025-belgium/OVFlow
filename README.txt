OVFlow v4 — ROUTEPLANNER

Nieuw:
- echte routeplanner op basis van officiële De Lijn GTFS Static data
- vertrek- en bestemmingshalte zoeken
- huidige locatie als vertrekpunt (dichtstbijzijnde halte)
- Nu / Vertrek / Aankomst
- snelste route / minste overstappen
- directe ritten + routes met 1 overstap
- reisduur, overstappen, haltes en wachttijd
- eerste vertrek wordt waar mogelijk gecontroleerd met De Lijn Core realtime API
- route wordt op de bestaande echte OpenStreetMap-kaart getekend
- zware GTFS-berekeningen draaien in route-worker.js zodat de UI responsief blijft

Start lokaal:
  cd OVFlow-v4
  python -m http.server 8080
Open:
  http://localhost:8080

Belangrijk:
De eerste routezoekopdracht moet de De Lijn GTFS-feed downloaden en indexeren. Dat is een grotere dataset en kan op een telefoon merkbaar duren. Binnen dezelfde sessie worden de geladen data hergebruikt.

Bestanden:
- index.html
- style.css
- app.js
- planner.js
- route-worker.js
- config.js
- README.txt

Databronnen:
- De Lijn Core API: realtime doorkomsten
- Belgian Mobility GTFS Static: dienstregeling / trips / stop_times
- Digitaal Vlaanderen WFS: haltezoeker / haltecoördinaten
- OpenStreetMap + MapLibre: kaart

Deze versie werkt nog zonder eigen OVFlow-backend. Daardoor blijven API-sleutels in config.js zichtbaar. Voor een publieke release moeten die naar de server verhuizen.
