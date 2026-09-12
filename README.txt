OVFlow 2.0 — STABIELE LIVE TRIP

Deze versie focust op twee dingen:
1. Mooier OVFlow 2.0 Live Trip design.
2. Een stabiele voortgang die niet meer zomaar van 1% naar 26% springt.

BELANGRIJKSTE FIX
De oude Live Trip berekende het percentage met de projectie op de volledige routegeometrie.
Bij lijnen met bochten, parallelle straten, lussen of een routegeometrie die al vóór jouw
instaphalte begon, kon GPS op een verkeerd stuk van de lijn projecteren. Daardoor kon de
voortgang bijvoorbeeld ineens van 1% naar 26% springen.

OVFlow 2.0 gebruikt nu:
- alleen de twee opeenvolgende haltes van het HUIDIGE segment;
- GPS-projectie tussen die twee haltes;
- haltevolgorde als harde begrenzing;
- één halte per bevestigde overgang;
- GPS-zone: eerst de halte naderen, daarna pas bij wegrijden markeren als voorbij;
- conservatieve tijdfallback als GPS tijdelijk slecht is;
- nooit achteruit springen door GPS-jitter;
- vloeiende filtering van het percentage;
- gladgestreken snelheid.

VOORBEELD
Als je tussen halte 1 en 2 van 38 zit:
- minimale voortgang: 0 / 37
- maximale voortgang vóór halte 2: 1 / 37 ≈ 2,7%

OVFlow kan dus op dat moment onmogelijk ineens 26% tonen.

UI 2.0
- modernere Live Trip-kaart
- rustigere glaslagen
- sterkere hiërarchie voor volgende halte
- dikkere, vloeiendere voortgangsbalk
- percentage + 'halte X van Y'
- mooiere huidige-halte highlight
- ruimere statistiektegels
- OVFlow 2.0 branding

Deze versie blijft BROWSER-ONLY:
- geen eigen server nodig
- De Lijn Core API rechtstreeks
- Transitous/MOTIS
- iRail voor NMBS
- OpenStreetMap/MapLibre

Open OVFlow via GitHub Pages/HTTPS of localhost.
