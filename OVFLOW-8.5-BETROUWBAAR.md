# OVFlow 8.5 — Betrouwbaar, ook zonder eigen server

## Hersteld
- **Werkt ook als de OVFlow-server niet bereikbaar is.** Zoeken, vertrektijden, live ritten en de routeplanner gaan bij een fout rechtstreeks naar Transitous (`api.transitous.org`). Vroeger liep de reserveroute via `/api/v8/transit`, maar die route bestaat niet in `server.js`, en de routeplanner had geen reserveroute.
- **"Volg deze rit live" werkt weer bij vertrekken van de eigen server.** Vertrekken van De Lijn en iRail hadden geen rit-ID, waardoor de knop uitgeschakeld bleef (ook op het startbord van Oostende). Ze worden nu gekoppeld aan de Transitous-rit met dezelfde lijn of hetzelfde treinnummer en een geplande tijd binnen 3 minuten.
- **Zoeken vindt nu alle vervoerders en adressen.** De server kent alleen De Lijn en NMBS. De resultaten worden nu aangevuld met MIVB- en TEC-haltes en met adressen van Transitous, zonder dubbele namen. Elk resultaat toont of het een station, een halte of een adres is.
- **Geen "START"/"END" meer** in het reisadvies wanneer je vanaf je locatie of een adres plant.
- Een adres als vertrekpunt toont het vertrekbord van de dichtstbijzijnde halte.

## Nieuw
- **Geschatte voertuigpositie bij Live volgen** wanneer er geen GPS is, en dat geldt voor alles behalve De Lijn. De positie wordt berekend uit de realtime rittijden langs het traject en is duidelijk als schatting aangeduid. GPS blijft altijd voorrang krijgen.
- Live volgen ververst de rittijden elke 30 s (was 60 s) en de positie elke 2 s.
- Een Metro-filter op het vertrekbord.
- Na herladen opent de app weer het scherm waar je was (Vertrekken, Kaart, Bewaard of Profiel).

PWA-cache: `ovflow-85-live-v1`.
