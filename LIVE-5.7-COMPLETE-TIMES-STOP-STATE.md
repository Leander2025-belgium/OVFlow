# OVFlow Live 5.7

- Static GTFS stop_times are matched by stop_id, stop_name and stop_sequence.
- Missing route stop IDs no longer cause avoidable `—` times when the GTFS stop name is available.
- The first remaining stop is treated as **next stop** while the vehicle is still approaching it.
- `Nu bij` / `Huidige halte` appears only when the GPS is actually close to that stop.
- While approaching, the card says `Onderweg naar` and the timeline says `Volgende halte`.
- Positive delay in the timeline is always red; `Nu` stays green.
