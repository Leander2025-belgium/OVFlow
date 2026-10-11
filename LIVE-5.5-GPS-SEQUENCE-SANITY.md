# OVFlow Live 5.5 — GPS/Sequence Sanity

Fixes a critical bug where stale or mismatched GTFS-Realtime `stopId` / `currentStopSequence` could jump the current stop directly to the terminus even while the vehicle GPS was many kilometres away.

Changes:
- GPS/shape progression is the geospatial sanity source.
- Realtime stopId/sequence is accepted only when plausible versus GPS.
- Active-run resolver receives a GPS-derived currentSequence.
- Sticky progress locks that disagree with GPS by more than four stops are repaired automatically.
- Existing route, map, timing, trip-update and fallback logic remains intact.
