# OVFlow 4.9.0 — Route sanity fix

Fix voor Live vanuit de routeplanner waarbij een stale/verkeerde tripId een GTFS-shape van een andere regio (bv. Antwerpen) kon tonen.

- Server accepteert exacte tripId alleen als de GTFS-lijn overeenkomt met de gevraagde lijn.
- Bestemming wordt mee gevalideerd.
- Frontend controleert geografisch of de shape bij de eerste en laatste halte past.
- Verdachte shape wordt automatisch opnieuw opgehaald zonder tripId, op basis van lijn + richting + bestemming + regio.
- Als ook die shape niet klopt, blijft de veilige halte-route zichtbaar.
