# OVFlow Live 5.4 — Active Run

Fixes the root cause of wrong times such as 16:38 for an active 14:38 run.
Live sends the current stop sequence and current wall time to backend 4.9.7.
The backend may replace a stale GTFS run slot with the nearest trip on the same
route/headsign serving that stop. Frontend no longer re-aligns a resolved run
using stale planner payload times.
