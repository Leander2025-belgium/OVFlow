# OVFlow Live 5.6 — Active Stop Run Lock

Fixes the recurring exact +2h/+N-hours timetable bug by resolving the scheduled run against the actual GPS-derived current stop_id, not a trimmed frontend array index.

- passes currentStopId to backend
- backend resolves run at that exact GTFS stop
- currentSequence is fallback only
- rejects unresolved static timetables >45 min from current wall time
- keeps GTFS-RT/Core fallbacks intact
