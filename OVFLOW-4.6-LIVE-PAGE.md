# OVFlow 4.6.0 — Live bij

De Live Trip-overlay is niet langer het openingspad wanneer een gebruiker op een lijn drukt.

## Nieuw
- Nieuwe aparte `live.html` pagina.
- Een lijnklik navigeert onmiddellijk; er worden geen API-calls uitgevoerd vóór de navigatie.
- De live pagina haalt zelf De Lijn Core-haltes op via `/api/v4/delijn/line-stops`.
- Exacte voertuig-GPS komt apart via `/api/v4/vehicle-position` en ververst ongeveer elke 15 seconden.
- Alle haltes, richting, instaphalte, trip-id, operator, vertrektijd, vertraging, voertuig-id en GPS-status staan op één pagina.
- Routekeuze wordt automatisch bepaald op basis van bestemming en de gekozen halte.
- Als GPS niet beschikbaar is, blijft de volledige haltepagina gewoon bruikbaar.
- Dichtbij, Haltes, Quick Live en Live Trip-knoppen uit de routeplanner gebruiken dezelfde nieuwe pagina.

## Belangrijk
Na upload oude PWA-cache/service worker verwijderen of hard reloaden zodat cache `ovflow-static-4.6.0` actief wordt.
