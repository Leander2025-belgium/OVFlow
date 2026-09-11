OVFlow v5 — INTERNE LIVE ROUTEPLANNER

Deze versie stuurt de gebruiker NIET meer door naar De Lijn, Google Maps of 9292.

Werking:
- Haltes zoeken gebeurt in OVFlow.
- Je kiest vertrek + bestemming.
- Je kiest Nu / Vertrek / Aankomst.
- OVFlow vraagt één reisadvies op bij de open-source MOTIS-route-engine van Transitous.
- De volledige resultaten worden binnen OVFlow weergegeven.
- Wandelstukken, bus/tram/trein, overstappen, tijden en realtime-info worden getoond.
- 'Toon op kaart' tekent de geometrie van het reisadvies op de bestaande OVFlow-kaart.
- Er is geen grote GTFS-download op de iPhone nodig.

Route API:
https://api.transitous.org/api/v6/plan

OVFlow gebruikt o.a.:
- TRANSIT + WALK
- realtimeMode=REALTIME
- detailedLegs=true
- routed transfers
- max 4 overstappen bij 'Snelste'
- max 2 overstappen bij 'Minst overstappen'

Transitous:
Dit is geschikt voor ontwikkeling/prototyping van een open-source, niet-commercieel project.
Voor een publieke app met veel gebruikers moet je de Transitous usage policy naleven
en vooraf contact opnemen over routingbelasting.

Bronvermelding:
- Transitous / MOTIS
- De Lijn open data
- OpenStreetMap

Start lokaal:
  python -m http.server 8080

Open:
  http://localhost:8080
