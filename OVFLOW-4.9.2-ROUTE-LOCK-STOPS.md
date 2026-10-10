# OVFlow 4.9.2 — Route Lock & Stops

- Exacte Live-ritcontext (tripId + bestemming) wordt meegestuurd naar de backend bij het laden van haltes.
- Alle resterende haltes staan in een eigen scrollbare tijdlijn; de pagina zelf blijft vast op één scherm.
- Gepasseerde haltes verdwijnen pas wanneer de referentie duidelijk voorbij de halte is.
- GTFS stopId/currentStopSequence krijgen voorrang op geometrische schatting.
- Hysteresis voorkomt grote sprongen door GPS-jitter of routekruisingen.
