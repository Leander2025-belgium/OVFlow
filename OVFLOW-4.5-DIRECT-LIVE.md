# OVFlow 4.5.0 — Direct Live

- De Lijn line taps open via OVFlow backend + De Lijn Core stop order, not Transitous trip lookup.
- New lightweight `/api/v4/delijn/line-stops` endpoint.
- Exact De Lijn vehicle GPS remains `/api/v4/vehicle-position`.
- Live Trip no longer initializes MapLibre while opening; large map loads on demand.
- Exact vehicle position snaps progress to the correct route segment on first GPS fix.
- Direct De Lijn live trips do not run the heavy Transitous refresh loop.
- PWA cache/version bumped to 4.5.0.
