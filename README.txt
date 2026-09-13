OVFlow 2.0 — FINAL TRANSIT REDESIGN

DOEL
Een echte, duidelijke openbaarvervoer-app in plaats van een technisch dashboard.

NIEUWE HIERARCHIE
1. Home: snelle acties
2. Plannen: routeplanner staat vooraan
3. Haltes & vertrekken
4. Realtime vertrekbord
5. Live rit
6. Kaart / haltes in de buurt

BOTTOM NAV
- Home
- Plannen
- Live
- Haltes
- Meer

UI
- Licht, rustig OV-design
- Duidelijke marineblauwe tekst op witte kaarten
- Blauw voor acties/routing
- Mintgroen voor live/realtime
- Veel grotere tekst dan vorige versies
- Geen miniatuur-labels van 7-8 px meer in de belangrijkste flows
- Minder onnodige glassmorphism
- Grote touch targets
- Technische API-panelen verborgen voor de gewone gebruiker

REISINFO
- Realtime haltevertrekken
- Routeplanner bus/tram/trein
- Live Trip
- Alle haltes/stations per rit
- NMBS/iRail integratie
- Kaart + haltezoeker
- GPS resync na iPhone scherm-uit

REALTIME REFRESH
Automatisch vernieuwen is ingesteld op 15 seconden.

BROWSER-ONLY
Blijft bruikbaar via GitHub Pages zonder eigen OVFlow backend.
Voor publieke productie blijven browser-side API-sleutels wel een tijdelijk ontwikkelcompromis.

CACHE
Lokale assets laden met ?v=2.0.0
