# OVFlow Live 5.2.1 — Time Alignment Fix

Fixes a wrong-static-run issue where an active trip could inherit stop_times from a later run with the same stop pattern (for example 16:41 instead of 14:21).

The static GTFS timetable is now calibrated against the selected OVFlow departure at the boarding stop. The same offset is applied to every stop so each stop keeps its own real GTFS interval. GTFS-Realtime still has highest priority.
