# OVFlow Live 5.2.1 — Timeline Fix

- Exacte GTFS Static stop_times per actieve trip.
- GTFS-RT prediction wint; anders geplande tijd + actuele vertraging; daarna geplande tijd.
- Nooit `...`; laatste fallback is `—`.
- Huidige halte schuift automatisch door via stopId/stop_sequence, shape/GPS en tijd als veiligheidsnet.
- Alle resterende haltes worden gerenderd en zijn bereikbaar.
- Mobiele viewport is opnieuw gebudgetteerd: minimaal 5 volledige haltes, normaal 7–9.
