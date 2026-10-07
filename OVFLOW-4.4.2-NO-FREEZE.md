# OVFlow 4.4.2 — No-freeze live line opening

- Line tap no longer starts three heavy route requests in parallel.
- First uses one compact Transitous `/trip` request.
- `fetchStops=true` fallback reduced from two parallel 24-event boards to at most two sequential 6-event boards.
- Exact De Lijn vehicle GPS is no longer part of the opening critical path; planner refreshes it after the Live Trip opens.
- Front-end cache/version bumped to 4.4.2.
