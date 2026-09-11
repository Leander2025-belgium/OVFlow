OVFlow v4.1 — ROUTEPLANNER FIX

Belangrijkste fix t.o.v. v4:
- GTFS Static wordt nu opgehaald via de officiële De Lijn GTFS Static v3 URL.
- De meegeleverde GTFS Static subscription key wordt als Ocp-Apim-Subscription-Key meegestuurd.
- Er zijn twee fallback-URLs als de primaire bron tijdelijk niet antwoordt.
- Geen externe fflate/unpkg-afhankelijkheid meer in de Web Worker.
- ZIP-uitpakken gebeurt rechtstreeks in de browser met DecompressionStream.
- Betere foutmeldingen voor 401, 403, 429, CORS/netwerk en ZIP-fouten.
- Overstappen kunnen ook worden gevonden tussen gelijknamige/nabijgelegen perrons en haltes.
- Kalendercontrole is strenger: er worden geen ritten van de verkeerde dag verzonnen.

Starten:
  python -m http.server 8080
Open daarna:
  http://localhost:8080

LET OP:
Deze versie werkt nog zonder eigen backend. Je API-sleutels staan daardoor in config.js en zijn zichtbaar voor iemand die de bestanden kan openen. Publiceer deze build dus niet publiek met je huidige sleutels.

Databronnen:
- De Lijn GTFS Static v3
- De Lijn Open Data V1 Core API voor live vertrekcontrole
- Digitaal Vlaanderen WFS voor haltezoeken
- OpenStreetMap / MapLibre voor de kaart
