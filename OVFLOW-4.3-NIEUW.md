# OVFlow 4.3 — Live lijnen en Haltes

Deze versie bouwt verder op OVFlow 4.2 en focust op één consistente live-ritervaring.

## Nieuw

- **Dichtbij → lijn:** tik op een vertrek en OVFlow opent de concrete rit via de `tripId`.
- **Live ritpagina:** toont de volledige haltevolgorde naast een kaart met de ritroute en voertuigpositie.
- **Voertuigpositie:** exacte voertuigcoördinaten worden gebruikt wanneer de databron ze levert. Anders wordt de positie duidelijk als schatting aangeduid en berekend tussen actuele haltepassages, langs de ritgeometrie.
- **Nieuwe pagina Haltes:** zoek haltes en stations via de open vervoerszoekfunctie.
- **Vertrekvenster:** van 5 minuten geleden tot 3 uur vooruit.
- **Halte → lijn:** tik op de lijnbadge van een vertrek om rechtstreeks dezelfde live ritpagina te openen.
- **Realtime verversing:** de actieve rit wordt opnieuw gesynchroniseerd terwijl Live Trip openstaat.
- **PWA-cache:** cacheversie verhoogd naar 4.3.0 zodat oudere 4.2-bestanden niet blijven hangen.

## Databronnen

OVFlow gebruikt Transitous/MOTIS voor zoeken, vertrektijden, routeplanning en ritdetails. De NMBS-integratie kan daarnaast iRail gebruiken waar van toepassing.

## Belangrijk

De kaart noemt een positie alleen GPS/exact wanneer een databron concrete voertuigcoördinaten aanbiedt. Een berekende positie wordt in de interface uitdrukkelijk als **geschat** aangeduid.
