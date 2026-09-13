OVFlow 2.0 v11 — LIGHT TRANSIT + SCREEN-OFF RESYNC

DESIGN
- Hele app omgezet van donker naar licht OV-design.
- Wit / lichtblauw / mint met marineblauwe tekst.
- Lichte Apple-achtige Liquid Glass panelen.
- Lichte zwevende bottom navigation.
- Live Trip volgt de goedgekeurde mockup:
  * route/rit duidelijk bovenaan
  * volgende halte/station als hoofdkaart
  * lichte statuskaarten
  * helder ritoverzicht/timeline
  * mint/blauwe actieve halte
  * lichte realtime informatiekaart

LIVE TRIP BIJ IPHONE SCHERM-UIT
iOS/Safari kan JavaScript, timers en GPS tijdelijk pauzeren wanneer het scherm uit staat.
Een gewone website kan dat niet volledig voorkomen.

v11 lost het praktische probleem daarom zo op:
1. Bij achtergrond/scherm-uit onthoudt OVFlow dat Live Trip gepauzeerd kan zijn.
2. Bij ontgrendelen / terugkeren / pageshow / focus:
   - realtime tijden van DEZELFDE locked rit worden vernieuwd;
   - er wordt een verse high-accuracy GPS-fix gevraagd;
   - OVFlow vergelijkt GPS met ALLE nog komende stopsegmenten;
   - dienstregeling/realtime tijd wordt als tweede zekerheid gebruikt;
   - OVFlow kan meerdere gemiste haltes in één keer inhalen;
   - daarna wordt watchPosition volledig opnieuw gestart.
3. Haltevolgorde en bestemming blijven nog steeds locked zoals in v10.2.

NORMALE LIVE TRACKING
Tijdens normaal gebruik blijft de voorzichtige segment-voor-segment tracking behouden,
zodat GPS-jitter geen willekeurige haltes kan overslaan.

CACHE
Alle lokale assets laden met ?v=11.0 voor GitHub Pages/Safari.

Browser-only blijft behouden.
