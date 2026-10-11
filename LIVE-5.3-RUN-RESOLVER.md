# OVFlow Live 5.3 — Run Resolver

Fixes the wrong-run clock bug where the correct stop pattern could show a later GTFS run (for example 16:38 instead of 14:38).

Time priority per stop:
1. exact GTFS-Realtime TripUpdate
2. De Lijn Core time locked to the same ritnummer/vrtnum
3. GTFS Static stop_time aligned to the active run
4. planned stop time
5. — only when no real source exists

The Core resolver is now still queried when static GTFS has times, because static times alone cannot prove the selected run slot. Its current-stop time is also used to calibrate the entire static timetable when the opening payload does not contain a departure anchor.
