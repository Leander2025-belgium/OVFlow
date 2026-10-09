# OVFlow 4.8.1 — Exact GTFS Route

Live bij tekent nu de echte De Lijn GTFS `shape_id` in plaats van rechte lijnen tussen haltes.

- De frontend vraagt `/api/v4/delijn/route-shape` op.
- De backend koppelt de rit aan `trips.txt` en `shapes.txt`.
- Bij een exacte `tripId` wordt de exacte shape van die rit gebruikt.
- Zonder exacte match kiest OVFlow de beste GTFS-vorm voor lijn + richting.
- Als de shape-index tijdelijk ontbreekt, blijft de bestaande halte-route als fallback zichtbaar.
- De enorme GTFS-feed blijft server-side; de telefoon ontvangt alleen de routecoördinaten.
