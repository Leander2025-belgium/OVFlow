OVFlow 2.0 v10.2 — LIVE TRIP COUNT & ROUTE LOCK FIX

Deze hotfix lost de fout op waarbij een rit bijvoorbeeld:
- Rit overzicht: 27 haltes
maar daarna:
- halte 31 van 109
- nog 79 haltes
kon tonen.

OORZAAK
De 60-seconden realtime refresh haalde /api/v6/trip op en verving daarna live.stops
door de volledige stoplijst uit het nieuwe antwoord. Dat antwoord kan een langere
voertuigrit, een andere segmentvariant of meerdere ritdelen bevatten.

FIX
Zodra Live Trip start:
- wordt de geselecteerde stoplijst vastgezet;
- wordt de bestemming vastgezet;
- worden lijn, tripId en richting vastgezet;
- een refresh mag de stoplijst NOOIT meer vervangen;
- een refresh mag alleen tijden/spoor/realtime velden van bestaande stops bijwerken;
- een kandidaat-refresh moet overeenkomen met tripId/lijn/richting + huidige stop + bestemming;
- bij twijfel wordt de refresh genegeerd;
- routecorrectheid gaat voor dataversheid.

ALLE TELLERS HEBBEN NU ÉÉN BRON
- Rit overzicht · X haltes
- halte X van Y
- Nog haltes
komen allemaal uit dezelfde locked live.stops lijst.

EXTRA DEFENSIEVE BEVEILIGING
Als andere code toch de stoplijstlengte zou wijzigen, herstelt renderLiveTrip
automatisch de oorspronkelijke locked stoplijst.

CACHE
index.html laadt style.css/app.js/planner.js/quick-live.js/config.js nu met ?v=10.2
zodat GitHub Pages + Safari niet de oude JavaScript-versie uit cache blijven gebruiken.

Browser-only / GitHub Pages blijft behouden.
