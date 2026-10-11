(() => {
  "use strict";
  // OVFlow Live 5.7 — complete stop times + correct en-route/current-stop semantics.

  const cfg = window.OVFLOW_CONFIG || {};
  const API_BASE = String(cfg.API_BASE || "").replace(/\/$/, "");
  const PREFIX = "ovflow-live-page:";
  const $ = id => document.getElementById(id);
  const state = {
    payload: null, routes: [], routeIndex: 0, position: null, userPosition: null, geoWatchId: null, geoRequest: null,
    vehicleTimer: null, infoTimer: null, loading: false,
    tripTimes: { byStopId: new Map(), bySequence: new Map(), source: "", updatedAt: null, generalDelaySeconds: 0 },
    scheduleTimes: { byStopId: new Map(), bySequence: new Map(), byName: new Map(), source: "", matchedTripId: "", originalMatchedTripId: "", count: 0, loadedFor: "", runResolved: false, anchorDeltaSeconds: null },
    fallbackTimesLoading: false,
    map: { instance: null, tile: null, routeLayer: null, routeLine: null, stopMarkers: [], busMarker: null, userMarker: null, routeKey: "", ready: false, failed: false, followBus: false, stopsVisible: true, userPauseUntil: 0, _segmentFitted: false }
  };

  const esc = value => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const norm = value => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const num = value => { const n = Number(value); return Number.isFinite(n) ? n : null; };

  function readPayload() {
    const url = new URL(location.href);
    const key = url.searchParams.get("k") || "";
    let payload = null;
    if (key) {
      try { payload = JSON.parse(sessionStorage.getItem(PREFIX + key) || "null"); } catch {}
    }
    if (!payload) {
      payload = {
        line: url.searchParams.get("line") || "",
        tripId: url.searchParams.get("tripId") || "",
        destination: url.searchParams.get("destination") || "",
        area: url.searchParams.get("area") || "",
        mode: "BUS",
        stop: {},
        preloadedStops: []
      };
    }
    payload.stop = payload.stop || {};
    payload.preloadedStops = Array.isArray(payload.preloadedStops) ? payload.preloadedStops : [];
    return payload;
  }

  function parseDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function timeText(value) {
    const d = parseDate(value);
    return d ? new Intl.DateTimeFormat("nl-BE", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "—";
  }

  function canonicalTripId(value) {
    return String(value || "").trim().replace(/^gt:delijn:/i, "").replace(/^delijn:/i, "");
  }

  function epochOrDate(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number" || /^\d{9,13}$/.test(String(value))) {
      let n = Number(value);
      if (!Number.isFinite(n)) return null;
      if (n < 1e12) n *= 1000;
      const d = new Date(n);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return parseDate(value);
  }

  function tripInfoForStop(stop, sequence) {
    const sid = String(stop?.stopId || "").replace(/^gt:delijn:/i, "");
    const byId = sid ? state.tripTimes.byStopId.get(sid) || state.tripTimes.byStopId.get(`gt:delijn:${sid}`) : null;
    const bySeq = state.tripTimes.bySequence.get(Number(sequence));
    return byId || bySeq || null;
  }

  function tripTimeForStop(stop, sequence) {
    return tripInfoForStop(stop, sequence)?.time || null;
  }

  function canonicalStopId(value) {
    return String(value || "").trim().replace(/^gt:delijn:/i, "").replace(/^delijn:/i, "");
  }

  function rawScheduleInfoForStop(stop, sequence) {
    const sid = canonicalStopId(stop?.stopId);
    const byId = sid ? state.scheduleTimes.byStopId.get(sid) : null;
    const bySeq = state.scheduleTimes.bySequence.get(Number(sequence));
    const byName = stop?.name ? state.scheduleTimes.byName?.get(norm(stop.name)) : null;
    return byId || byName || bySeq || null;
  }

  // Static GTFS may occasionally resolve to another run with exactly the same
  // stop pattern but a different departure slot.  The selected departure in
  // OVFlow is authoritative for the boarding stop, so calibrate the static
  // timetable to that known point and keep every stop's own interval intact.
  // This prevents a live bus at 14:18 from suddenly showing 16:41 at the
  // destination merely because the static trip-id matched a later run.
  function scheduleAlignmentSeconds() {
    const route = currentRoute();
    const p = state.payload || {};
    if (!route?.stops?.length || !state.scheduleTimes?.count) return 0;
    // Backend 4.9.7 already resolved the active scheduled run against the
    // current stop + current wall time. Never re-align that run with a stale
    // planner payload (the exact bug that produced 16:38 instead of 14:38).
    if (state.scheduleTimes.runResolved) return 0;

    // Use the stop the user/vehicle is actually at whenever possible. A generic
    // line click can otherwise carry a valid GTFS trip pattern for a *later run*
    // (e.g. 16:38) while the selected departure is the 14:38 run.
    const ref = activeReference();
    let idx = boardingIndex(route);
    if (ref) {
      try {
        const ctx = progressContext(route, ref);
        if (Number.isFinite(Number(ctx?.startIndex))) idx = Number(ctx.startIndex);
      } catch {}
    }
    if (idx < 0 || idx >= route.stops.length) idx = 0;

    const stop = route.stops[idx];
    const raw = rawScheduleInfoForStop(stop, idx + 1);
    const scheduled = epochOrDate(raw?.time || raw?.scheduledDeparture || raw?.scheduledArrival);
    if (!scheduled) return 0;

    // 1) A departure explicitly selected in OVFlow is authoritative.
    let anchor = epochOrDate(p.plannedDeparture);
    if (!anchor) {
      const realtime = epochOrDate(p.realtimeDeparture);
      if (realtime) {
        const delaySeconds = Math.round(Number(p.delayMinutes || 0) * 60);
        anchor = new Date(realtime.getTime() - delaySeconds * 1000);
      }
    }

    // 2) If the opening payload did not preserve a departure time, use De Lijn
    // Core for THIS line/destination/current stop. The Core resolver locks on the
    // same ritnummer/vrtnum across following stops, so this is a safe run anchor.
    if (!anchor) {
      const core = tripInfoForStop(stop, idx + 1);
      if (core?.fallback && core?.time) {
        const coreEffective = epochOrDate(core.time);
        const corePlanned = epochOrDate(core.plannedTime);
        if (corePlanned) anchor = corePlanned;
        else if (coreEffective) anchor = new Date(coreEffective.getTime() - Number(core.delay || 0) * 1000);
      }
    }

    if (!anchor) return 0;

    let diff = Math.round((anchor.getTime() - scheduled.getTime()) / 1000);
    // GTFS allows times beyond 24:00. Normalize a possible service-day wrap
    // to the closest clock-equivalent offset before using it.
    while (diff > 12 * 3600) diff -= 24 * 3600;
    while (diff < -12 * 3600) diff += 24 * 3600;

    // Tiny differences are normal rounding/noise and do not need shifting.
    if (Math.abs(diff) < 30) return 0;
    return diff;
  }

  function scheduleInfoForStop(stop, sequence) {
    const raw = rawScheduleInfoForStop(stop, sequence);
    if (!raw) return null;
    const shift = scheduleAlignmentSeconds();
    if (!shift) return raw;
    return {
      ...raw,
      time: raw.time ? addSeconds(raw.time, shift) : raw.time,
      scheduledDeparture: raw.scheduledDeparture ? addSeconds(raw.scheduledDeparture, shift) : raw.scheduledDeparture,
      scheduledArrival: raw.scheduledArrival ? addSeconds(raw.scheduledArrival, shift) : raw.scheduledArrival,
      scheduleShiftSeconds: shift,
      source: `${raw.source || "gtfs-static"}+departure-alignment`
    };
  }

  function addSeconds(value, seconds) {
    const d = epochOrDate(value);
    if (!d) return null;
    return new Date(d.getTime() + Number(seconds || 0) * 1000).toISOString();
  }

  function currentDelaySeconds(stop, sequence) {
    const exact = tripInfoForStop(stop, sequence);
    if (exact && !exact.fallback && Number.isFinite(Number(exact.delay))) return Number(exact.delay);
    if (Number.isFinite(Number(state.tripTimes.generalDelaySeconds))) return Number(state.tripTimes.generalDelaySeconds);
    return Math.round(Number(state.payload?.delayMinutes || 0) * 60);
  }

  // One authoritative resolver for both the large next-stop card and every row
  // in Je rit. Priority: exact GTFS-RT -> GTFS static + current delay -> GTFS
  // static -> De Lijn Core fallback -> preloaded/planner time -> unavailable.
  function bestTimeInfoForStop(stop, sequence, preloadTime = null) {
    const rt = tripInfoForStop(stop, sequence);
    const sched = scheduleInfoForStop(stop, sequence);
    const planned = sched?.time || sched?.scheduledDeparture || stop?.plannedTime || preloadTime || null;
    const delay = currentDelaySeconds(stop, sequence);

    if (rt?.time && !rt.fallback) {
      // A stale planner tripId can also point to a later GTFS-RT run. When the
      // backend had to resolve a different active static run, reject an RT time
      // that is wildly inconsistent with that resolved stop time.
      const rtd = epochOrDate(rt.time);
      const pd = epochOrDate(planned);
      const inconsistent = state.scheduleTimes.runResolved && rtd && pd && Math.abs(rtd.getTime() - pd.getTime()) > 30 * 60 * 1000;
      if (!inconsistent) return { time: rt.time, plannedTime: planned, delay: Number(rt.delay || 0), realtime: true, estimated: false, source: "gtfs-rt" };
    }
    // De Lijn Core is the best fallback for identifying the *active run* when
    // GTFS-RT has no TripUpdate. Prefer it over an uncalibrated static slot.
    if (rt?.time && rt.fallback) {
      return { time: rt.time, plannedTime: rt.plannedTime || planned || null, delay: Number(rt.delay || 0), realtime: Boolean(rt.realtime), estimated: false, source: "delijn-core" };
    }
    if (planned) {
      if (delay) return { time: addSeconds(planned, delay), plannedTime: planned, delay, realtime: true, estimated: true, source: "gtfs-static+delay" };
      return { time: planned, plannedTime: planned, delay: 0, realtime: false, estimated: false, source: "gtfs-static" };
    }
    const payloadFallback = sequence === 1 ? (state.payload?.realtimeDeparture || state.payload?.plannedDeparture) : null;
    if (payloadFallback) return { time: payloadFallback, plannedTime: state.payload?.plannedDeparture || null, delay, realtime: Boolean(state.payload?.realtime), estimated: false, source: "payload" };
    return { time: null, plannedTime: null, delay: 0, realtime: false, estimated: false, source: "none" };
  }

  async function fetchTripSchedule(force = false) {
    const p = state.payload || {};
    if (!API_BASE || !p.tripId) return null;
    const wanted = canonicalTripId(p.tripId);

    // Re-resolve periodically because the current stop advances during the run.
    // The backend uses the stop sequence + current wall time to reject a stale
    // future/past run while preserving the correct route/headsign.
    let currentSequence = 1;
    const route = currentRoute();
    if (route?.stops?.length) {
      try {
        const ref = activeReference();
        if (ref) {
          const geoIdx = geometryProgressIndex(route, ref);
          currentSequence = Math.max(1, Number(geoIdx >= 0 ? geoIdx : boardingIndex(route)) + 1);
        } else currentSequence = Math.max(1, boardingIndex(route) + 1);
      } catch { currentSequence = Math.max(1, boardingIndex(route) + 1); }
    }
    let currentStopId = "";
    try {
      const ref = activeReference();
      const idx = route?.stops?.length && ref ? geometryProgressIndex(route, ref) : Math.max(0, boardingIndex(route));
      currentStopId = canonicalStopId(route?.stops?.[Math.max(0, idx)]?.stopId || "");
    } catch {}
    const loadKey = `${wanted}:${currentStopId || currentSequence}`;
    if (!force && state.scheduleTimes.loadedFor === loadKey && state.scheduleTimes.count > 0) return state.scheduleTimes;
    try {
      const url = new URL(`${API_BASE}/api/v5/delijn/trip-stop-times`);
      url.searchParams.set("tripId", p.tripId);
      url.searchParams.set("anchor", new Date().toISOString());
      url.searchParams.set("currentSequence", String(currentSequence));
      if (currentStopId) url.searchParams.set("currentStopId", currentStopId);
      if (p.destination) url.searchParams.set("destination", p.destination);
      const data = await getJson(url, 16000, 1);
      // Hard sanity guard: never put a timetable on screen when the backend
      // itself says the matched run is far from the current wall clock. A
      // two-hour slot error must degrade to Core/—, never be presented as truth.
      const delta = Number(data?.anchorDeltaSeconds);
      if (Number.isFinite(delta) && Math.abs(delta) > 45 * 60 && !data?.runResolved) {
        console.warn("OVFlow Live: statische run verworpen wegens tijdsafstand", {
          currentStopId, currentSequence, anchorDeltaSeconds: delta,
          matchedGtfsTripId: data?.matchedGtfsTripId || ""
        });
        state.scheduleTimes = { byStopId:new Map(), bySequence:new Map(), byName:new Map(), source:"", matchedTripId:"", originalMatchedTripId:"", count:0, loadedFor:loadKey, runResolved:false, anchorDeltaSeconds:delta };
        return state.scheduleTimes;
      }
      const byStopId = new Map(), bySequence = new Map(), byName = new Map();
      (Array.isArray(data?.stops) ? data.stops : []).forEach(st => {
        const time = st.scheduledDeparture || st.scheduledArrival || null;
        if (!time) return;
        const info = {
          time, scheduledDeparture: st.scheduledDeparture || null, scheduledArrival: st.scheduledArrival || null,
          source: data?.source || "delijn-gtfs-static-stop-times-active-run", stopSequence: Number(st.stopSequence || 0)
        };
        const sid = canonicalStopId(st.stopId);
        if (sid) byStopId.set(sid, info);
        if (st.stopName) byName.set(norm(st.stopName), info);
        if (Number(st.stopSequence)) bySequence.set(Number(st.stopSequence), info);
      });
      state.scheduleTimes = {
        byStopId, bySequence, byName, source: data?.source || "delijn-gtfs-static-stop-times-active-run",
        matchedTripId: data?.matchedGtfsTripId || "", originalMatchedTripId: data?.originalMatchedGtfsTripId || "",
        count: Number(data?.stopTimesCount || bySequence.size), loadedFor: loadKey,
        runResolved: Boolean(data?.runResolved), anchorDeltaSeconds: data?.anchorDeltaSeconds ?? null
      };
      console.info("OVFlow active run", {
        realtimeTripId: p.tripId, normalizedTripId: canonicalTripId(p.tripId),
        originalMatchedGtfsTripId: state.scheduleTimes.originalMatchedTripId,
        matchedGtfsTripId: state.scheduleTimes.matchedTripId, runResolved: state.scheduleTimes.runResolved,
        currentSequence, currentStopId, anchorDeltaSeconds: state.scheduleTimes.anchorDeltaSeconds, stopTimes: state.scheduleTimes.count
      });
      if (currentRoute()) renderRoutes();
      return state.scheduleTimes;
    } catch (error) {
      console.warn("OVFlow Live: actieve GTFS stop_times niet beschikbaar", {
        realtimeTripId: p.tripId, normalizedTripId: canonicalTripId(p.tripId), currentSequence, error: error.message
      });
      return null;
    }
  }

  async function fetchTripTimes() {
    const p = state.payload || {};
    if (!API_BASE || !p.tripId) return null;
    try {
      const url = new URL(`${API_BASE}/api/gtfs/delijn/trip-updates`);
      url.searchParams.set("tripId", p.tripId);
      const data = await getJson(url, 12000, 1);
      const wanted = canonicalTripId(p.tripId);
      const updates = Array.isArray(data?.tripUpdates) ? data.tripUpdates : [];
      const update = updates.find(item => canonicalTripId(item?.tripId) === wanted) || updates[0];
      if (!update) return null;
      const byStopId = new Map(), bySequence = new Map();
      (update.stops || []).forEach(st => {
        const raw = st.departureTime ?? st.arrivalTime;
        const d = epochOrDate(raw);
        if (!d) return;
        const info = {
          time: d.toISOString(),
          delay: Number(st.departureDelay ?? st.arrivalDelay ?? update.delay ?? 0) || 0,
          realtime: true
        };
        const sid = String(st.stopId || "").replace(/^gt:delijn:/i, "");
        if (sid) byStopId.set(sid, info);
        const seq = Number(st.stopSequence);
        if (Number.isFinite(seq)) bySequence.set(seq, info);
      });
      state.tripTimes = { byStopId, bySequence, source: data?.source || "gtfs-rt-trip-update", updatedAt: data?.updatedAt || new Date().toISOString(), generalDelaySeconds: Number(update.delay || 0) || 0 };
      if (currentRoute()) renderRoutes();
      return update;
    } catch (error) {
      console.warn("OVFlow Live: ritvertrektijden niet beschikbaar", error);
      return null;
    }
  }


  async function fetchFallbackStopTimes() {
    if (!API_BASE || state.fallbackTimesLoading) return null;
    const route = currentRoute();
    if (!route?.stops?.length || !state.payload?.line) return null;
    const ctx = progressContext(route, activeReference());
    const upcoming = route.stops.slice(ctx.startIndex, ctx.startIndex + 8)
      .filter(stop => /^\d{1,3}$/.test(String(stop.entiteit || "")) && /^\d{1,8}$/.test(String(stop.stopId || "")));
    if (!upcoming.length) return null;

    // Only exact GTFS-RT may suppress the Core resolver. Static GTFS alone is
    // not enough: it can represent the correct stop pattern but the wrong run
    // slot. Core is deliberately fetched as a run/time anchor when RT is sparse.
    const exactRealtimeKnown = upcoming.filter((stop, rel) => {
      const info = tripInfoForStop(stop, ctx.startIndex + rel + 1);
      return Boolean(info?.time && !info?.fallback);
    }).length;
    if (exactRealtimeKnown >= Math.min(5, upcoming.length)) return null;

    state.fallbackTimesLoading = true;
    try {
      const url = new URL(`${API_BASE}/api/v5/delijn/live-stop-times`);
      url.searchParams.set("line", state.payload.line);
      if (state.payload.destination) url.searchParams.set("destination", state.payload.destination);
      url.searchParams.set("stops", upcoming.map(s => `${s.entiteit}:${s.stopId}`).join(","));
      const anchor = new Date().toISOString();
      url.searchParams.set("anchor", anchor);
      const data = await getJson(url, 15000, 1);
      const byId = state.tripTimes.byStopId || new Map();
      (Array.isArray(data?.times) ? data.times : []).forEach(item => {
        if (!item?.stopId || !item?.time) return;
        const sid = String(item.stopId).replace(/^gt:delijn:/i, "");
        // Exact GTFS-RT always wins. Core fallback only fills missing stop times.
        if (byId.get(sid)?.time) return;
        byId.set(sid, {
          time: item.time,
          plannedTime: item.plannedTime || null,
          delay: Number(item.delaySeconds || 0) || 0,
          realtime: Boolean(item.realtime),
          fallback: true
        });
      });
      state.tripTimes.byStopId = byId;
      if (!state.tripTimes.source && data?.count) state.tripTimes.source = data.source || "delijn-core-live-stop-times";
      state.tripTimes.updatedAt = data?.updatedAt || state.tripTimes.updatedAt;
      if (data?.count) {
        const current = currentRoute();
        const currentCtx = current ? progressContext(current, activeReference()) : null;
        const currentIdx = Number.isFinite(Number(currentCtx?.startIndex)) ? Number(currentCtx.startIndex) : 0;
        const currentStop = current?.stops?.[currentIdx];
        const coreAnchor = currentStop ? tripInfoForStop(currentStop, currentIdx + 1) : null;
        console.info("OVFlow run resolver", {
          line: state.payload?.line || "",
          destination: state.payload?.destination || "",
          coreIdentity: data.identity || null,
          currentStop: currentStop?.name || "",
          coreAnchorTime: coreAnchor?.time || null,
          coreAnchorPlanned: coreAnchor?.plannedTime || null,
          staticMatchedTripId: state.scheduleTimes?.matchedTripId || "",
          scheduleShiftSeconds: scheduleAlignmentSeconds()
        });
      }
      return data;
    } catch (error) {
      console.warn("OVFlow Live: Core-haltetijden fallback niet beschikbaar", error);
      return null;
    } finally {
      state.fallbackTimesLoading = false;
    }
  }

  function ageText(value) {
    const d = parseDate(value);
    if (!d) return "tijd onbekend";
    const sec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
    if (sec < 5) return "net bijgewerkt";
    if (sec < 60) return `${sec} sec geleden`;
    return `${Math.round(sec / 60)} min geleden`;
  }

  function bearingText(value) {
    const n = num(value);
    if (n === null) return "—";
    const dirs = ["N", "NO", "O", "ZO", "Z", "ZW", "W", "NW"];
    return `${dirs[Math.round(n / 45) % 8]} · ${Math.round(n)}°`;
  }

  function haversine(aLat, aLon, bLat, bLon) {
    const vals = [aLat, aLon, bLat, bLon].map(Number);
    if (!vals.every(Number.isFinite)) return Infinity;
    const [lat1, lon1, lat2, lon2] = vals;
    const R = 6371000, rad = x => x * Math.PI / 180;
    const dLat = rad(lat2-lat1), dLon = rad(lon2-lon1);
    const q = Math.sin(dLat/2)**2 + Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
    return 2 * R * Math.atan2(Math.sqrt(q), Math.sqrt(1-q));
  }

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function getJson(url, timeout = 18000, retries = 1) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;
      try {
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
        return data;
      } catch (error) {
        lastError = error;
        const aborted = error?.name === "AbortError";
        const transient = aborted || /fetch|network|failed|load/i.test(String(error?.message || error));
        if (attempt < retries && transient) {
          await wait(500 + attempt * 600);
          continue;
        }
        if (aborted) throw new Error("De live verbinding duurt langer dan verwacht. OVFlow probeert automatisch opnieuw.");
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw lastError || new Error("Live gegevens niet bereikbaar");
  }

  function setText(id, value) { const el = $(id); if (el) el.textContent = value ?? "—"; }

  function showError(title, text) {
    setText("errorTitle", title);
    setText("errorText", text);
    $("errorPanel")?.classList.remove("hidden");
  }
  function clearError() { $("errorPanel")?.classList.add("hidden"); }

  function setDelayDisplay(delaySecondsOrMinutes, seconds = false) {
    let minutes = seconds ? Math.round(Number(delaySecondsOrMinutes || 0) / 60) : Math.round(Number(delaySecondsOrMinutes || 0));
    if (!Number.isFinite(minutes)) minutes = 0;
    setText("delayValue", minutes > 0 ? `+${minutes} min` : minutes < 0 ? `${minutes} min` : "Op tijd");
    const fact = $("delayFact");
    fact?.classList.toggle("is-delayed", minutes > 0);
    fact?.classList.toggle("is-early", minutes < 0);
  }

  function setGpsDisplay(value, timestamp = null, fallback = false) {
    setText("mapGpsAge", value || "GPS tijdelijk niet beschikbaar");
    setText("gpsClock", timestamp ? timeText(timestamp) : "");
    const fact = $("gpsFact");
    fact?.classList.toggle("is-live", !!timestamp && !fallback);
    fact?.classList.toggle("is-fallback", !!fallback);
  }

  function renderBase() {
    const p = state.payload;
    setText("lineBadge", p.line || "—");
    setText("destinationLabel", p.destination ? `Richting ${p.destination}` : `Lijn ${p.line || "—"}`);
    setText("routeLabel", p.stop?.name ? `Vanaf ${p.stop.name}` : "Live ritinformatie");
    const mode = String(p.mode || "OV").toUpperCase();
    const modeName = /TRAM/.test(mode) ? (String(p.line || "").toUpperCase() === "KT" ? "KUSTTRAM" : "TRAM") : /TRAIN|TREIN/.test(mode) ? "TREIN" : "BUS";
    setText("modeLabel", `${modeName} · LIVE`);
    const operatorChip = $("operatorChip");
    const operatorLabel = operatorChip?.querySelector("span");
    if (operatorLabel) operatorLabel.textContent = p.operator || "De Lijn";
    else setText("operatorChip", p.operator || "De Lijn");
    setText("departureTime", timeText(p.realtimeDeparture || p.plannedDeparture));
    const dep = new Date(p.realtimeDeparture || p.plannedDeparture || 0);
    const mins = Number.isFinite(dep.getTime()) ? Math.round((dep.getTime() - Date.now()) / 60000) : null;
    setText("departureMeta", mins !== null && mins > 0 ? `${p.realtime ? "Realtime" : "Gepland"} · over ${mins} min` : (p.realtime ? "Realtime vertrek" : "Dienstregeling"));
    const delay = Number(p.delayMinutes || 0);
    setDelayDisplay(delay);
    setText("platformValue", p.platform ? `Perron ${p.platform}` : "Geen perroninfo");
    setText("infoLine", p.line || "—");
    setText("infoDestination", p.destination || "—");
    setText("infoStop", p.stop?.name || "—");
    setText("infoTripId", p.tripId || "Niet beschikbaar");
    setText("infoOperator", p.operator || "De Lijn / OVFlow");
    setText("realtimeChip", p.cancelled ? "Geannuleerd" : p.realtime ? "Realtime" : "Dienstregeling");
  }

  function compactApiStop(stop, index) {
    return {
      index: Number(stop?.index || index + 1),
      name: String(stop?.name || stop?.omschrijvingLang || stop?.omschrijving || `Halte ${index + 1}`),
      stopId: String(stop?.haltenummer || stop?.stopId || ""),
      entiteit: String(stop?.entiteit || stop?.entiteitnummer || stop?.entity || ""),
      lat: num(stop?.latitude ?? stop?.lat),
      lon: num(stop?.longitude ?? stop?.lon),
      direction: String(stop?.richting || ""),
      plannedTime: stop?.plannedTime || stop?.departureTime || stop?.arrivalTime || stop?.doorkomsttijd || stop?.time || null,
      stopSequence: Number(stop?.stopSequence ?? stop?.stop_sequence ?? stop?.sequence ?? stop?.index ?? index + 1)
    };
  }

  function destinationMatchScore(stopName, destination) {
    const stop = norm(stopName);
    const dest = norm(destination);
    if (!stop || !dest) return 0;
    if (stop === dest) return 1000;
    if (stop.includes(dest) || dest.includes(stop)) return 700;
    const ignored = new Set(["richting", "perron", "halte", "bus", "tram", "station"]);
    const tokens = dest.split(" ").filter(t => t.length > 2 && !ignored.has(t));
    if (!tokens.length) return 0;
    const hits = tokens.filter(t => stop.includes(t)).length;
    return hits ? (hits / tokens.length) * 500 + hits * 20 : 0;
  }

  function trimRouteToTripTerminal(route) {
    const p = state.payload || {};
    const destination = String(p.destination || route?.tripHeadsign || route?.directionName || "").trim();
    if (!route?.stops?.length || !destination) return route;
    let bestIndex = -1, bestScore = 0;
    route.stops.forEach((stop, i) => {
      const score = destinationMatchScore(stop.name, destination);
      // Prefer the furthest equally-good stop in the travel direction.
      if (score > bestScore || (score === bestScore && score > 0 && i > bestIndex)) {
        bestScore = score; bestIndex = i;
      }
    });
    if (bestIndex >= 1 && bestIndex < route.stops.length - 1 && bestScore >= 280) {
      route.stops = route.stops.slice(0, bestIndex + 1);
      route.tripTerminalLocked = true;
      route.tripTerminalName = route.stops.at(-1)?.name || destination;
    }
    return route;
  }

  function cropShapeToRoute(points, route) {
    if (!Array.isArray(points) || points.length < 2 || !route?.stops?.length) return points || [];
    const first = route.stops[0], last = route.stops.at(-1);
    if (![first?.lat, first?.lon, last?.lat, last?.lon].every(v => Number.isFinite(Number(v)))) return points;
    const nearestIdx = stop => {
      let best = 0, dist = Infinity;
      // Sampling every point is fine for the typical 1-3k point De Lijn shapes.
      points.forEach((pt, i) => {
        const d = haversine(stop.lat, stop.lon, pt[0], pt[1]);
        if (d < dist) { dist = d; best = i; }
      });
      return { index: best, dist };
    };
    const a = nearestIdx(first), b = nearestIdx(last);
    if (a.dist > 900 || b.dist > 900) return points;
    if (a.index <= b.index) return points.slice(a.index, b.index + 1);
    return points.slice(b.index, a.index + 1).reverse();
  }

  function scoreRoute(route) {
    const p = state.payload;
    const stops = route.stops || [];
    if (!stops.length) return -Infinity;
    let score = 0;
    const wanted = norm(p.destination);
    const last = norm(stops.at(-1)?.name);
    const dir = norm(route.directionName);
    if (wanted && last && (last.includes(wanted) || wanted.includes(last))) score += 160;
    if (wanted && dir && (dir.includes(wanted) || wanted.includes(dir))) score += 120;
    const slat = num(p.stop?.lat), slon = num(p.stop?.lon);
    if (slat !== null && slon !== null) {
      let nearest = Infinity;
      stops.forEach(s => { nearest = Math.min(nearest, haversine(slat, slon, s.lat, s.lon)); });
      if (Number.isFinite(nearest)) score += Math.max(0, 120 - nearest / 30);
    }
    return score;
  }

  async function fetchRoutes() {
    const p = state.payload;
    if (!API_BASE || !p.line || /train|trein/i.test(p.mode || "")) {
      if (p.preloadedStops.length >= 2) {
        state.routes = [{ directionCode: "RIT", directionName: p.destination || "Rit", publicLine: p.line, stops: p.preloadedStops.map(compactApiStop) }];
        state.routeIndex = 0;
        renderRoutes();
        return;
      }
      throw new Error("Voor deze rit is geen De Lijn-haltevolgorde beschikbaar.");
    }

    async function request(area) {
      const url = new URL(`${API_BASE}/api/v4/delijn/line-stops`);
      url.searchParams.set("line", p.line);
      if (area) url.searchParams.set("area", area);
      if (p.tripId) url.searchParams.set("tripId", p.tripId);
      if (p.destination) url.searchParams.set("destination", p.destination);
      if (Number.isFinite(Number(p.stop?.lat))) url.searchParams.set("lat", String(p.stop.lat));
      if (Number.isFinite(Number(p.stop?.lon))) url.searchParams.set("lon", String(p.stop.lon));
      return getJson(url, 22000, 1);
    }

    let data;
    try { data = await request(p.area || p.stop?.municipality || ""); }
    catch (firstError) {
      if (p.area || p.stop?.municipality) data = await request("");
      else throw firstError;
    }

    const routes = (Array.isArray(data?.routes) ? data.routes : []).map(route => trimRouteToTripTerminal({
      ...route,
      stops: (Array.isArray(route.stops) ? route.stops : []).map(compactApiStop).filter(s => s.name)
    })).filter(r => r.stops.length >= 2);
    if (!routes.length) throw new Error("Geen haltevolgorde gevonden voor deze lijn.");
    const bestIndex = routes.map(scoreRoute).reduce((best, score, i, arr) => score > arr[best] ? i : best, 0);
    // A concrete departure is one trip, not a route picker. Keep alternate
    // same-number lines/directions out of the Live screen.
    if (p.tripId || p.destination) {
      state.routes = [routes[bestIndex]];
      state.routeIndex = 0;
    } else {
      state.routes = routes;
      state.routeIndex = bestIndex;
    }
    renderRoutes();
    fetchExactShape().catch(() => {});
  }

  function currentRoute() { return state.routes[state.routeIndex] || null; }

  function setShapeChip(text, stateName = "") {
    const chip = $("routeStopsButton");
    if (!chip) return;
    const label = chip.querySelector(".shape-chip-label");
    if (label) label.textContent = "Route via haltes";
    chip.title = text || "Route via haltes";
    chip.className = `tiny-chip shape-chip ${stateName}`.trim();
  }

  function shapeFitsRoute(points, route) {
    const stops = (route?.stops || []).filter(s => num(s.lat) !== null && num(s.lon) !== null);
    if (points.length < 2 || stops.length < 2) return true;

    // A valid GTFS shape must pass reasonably close to both ends of the selected
    // Live route. This catches stale planner tripIds (e.g. an Antwerp trip while
    // viewing Oostende–Brugge) before a wrong route reaches the map.
    const anchors = [stops[0], stops.at(-1)];
    return anchors.every(stop => {
      let nearest = Infinity;
      // Sampling keeps this cheap even for shapes with several thousand points.
      const step = Math.max(1, Math.floor(points.length / 1200));
      for (let i = 0; i < points.length; i += step) {
        nearest = Math.min(nearest, haversine(stop.lat, stop.lon, points[i][0], points[i][1]));
        if (nearest < 1200) break;
      }
      return nearest <= 5000;
    });
  }

  async function requestShape(route, includeTripId = true) {
    const p = state.payload;
    const url = new URL(`${API_BASE}/api/v4/delijn/route-shape`);
    if (includeTripId && p.tripId) url.searchParams.set("tripId", p.tripId);
    url.searchParams.set("line", route.publicLine || p.line || "");
    if (p.area || p.stop?.municipality) url.searchParams.set("area", p.area || p.stop?.municipality || "");
    if (p.destination || route.directionName) url.searchParams.set("destination", p.destination || route.directionName || "");
    if (route.directionCode) url.searchParams.set("direction", route.directionCode);
    return getJson(url, 25000, 1);
  }

  function pointsFromShape(data) {
    return (Array.isArray(data?.points) ? data.points : [])
      .map(pt => Array.isArray(pt) ? [num(pt[0]), num(pt[1])] : [num(pt?.lat), num(pt?.lon)])
      .filter(pt => pt[0] !== null && pt[1] !== null);
  }

  async function fetchExactShape(route = currentRoute()) {
    const p = state.payload;
    if (!route || !API_BASE || /train|trein/i.test(p.mode || "")) {
      setShapeChip("Route via haltes", "fallback");
      return;
    }
    if (Array.isArray(route.exactShapePoints) && route.exactShapePoints.length >= 2) {
      setShapeChip(route.shapeMeta?.exactTripMatch ? "Exacte ritvorm" : "GTFS-route", "ready");
      return;
    }
    if (route._shapeLoading) return;
    route._shapeLoading = true;
    setShapeChip("GTFS-route laden…", "loading");
    try {
      let data = await requestShape(route, true);
      let points = pointsFromShape(data);
      if (points.length < 2) throw new Error("GTFS-shape bevat onvoldoende routepunten");

      // Never display a geographically impossible exact-trip result. Retry once
      // without tripId so the backend selects by line + destination + area.
      if (!shapeFitsRoute(points, route)) {
        console.warn("OVFlow: verdachte tripId-shape genegeerd; fallback op lijn/richting.", {
          requestedLine: route.publicLine || p.line,
          tripId: p.tripId,
          returnedLine: data?.line,
          returnedRoute: data?.routeName
        });
        data = await requestShape(route, false);
        points = pointsFromShape(data);
        if (points.length < 2 || !shapeFitsRoute(points, route)) {
          throw new Error("GTFS-route past niet bij de gekozen haltes");
        }
        data = { ...data, exactTripMatch: false, recoveredFromBadTripId: true };
      }

      // Extra line sanity check on the browser side as defense in depth.
      const requestedLine = norm(route.publicLine || p.line || "");
      const returnedLine = norm(data?.line || "");
      if (requestedLine && returnedLine && requestedLine !== returnedLine) {
        throw new Error(`Verkeerde GTFS-lijn ontvangen (${data?.line})`);
      }

      points = cropShapeToRoute(points, route);
      route.exactShapePoints = points;
      route.shapeMeta = data;
      setShapeChip(data.exactTripMatch ? `Exacte rit · ${points.length} ptn` : `GTFS-route · ${points.length} ptn`, "ready");
      renderMapRoute(true);
    } catch (error) {
      console.warn("Exacte GTFS-route niet beschikbaar, halte-route blijft actief:", error);
      setShapeChip("Route via haltes", "fallback");
    } finally {
      route._shapeLoading = false;
    }
  }

  function stopIcon(kind = "normal") {
    if (!window.L) return null;
    const safe = ["normal", "boarding", "current", "start", "end", "passed"].includes(kind) ? kind : "normal";
    const size = safe === "normal" || safe === "passed" ? 10 : safe === "start" || safe === "end" ? 16 : 20;
    return L.divIcon({
      className: "ov-stop-icon",
      html: `<div class="stop-marker ${safe}"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  }

  function busIcon(bearing) {
    if (!window.L) return null;
    const b = Number.isFinite(Number(bearing)) ? Number(bearing) : 0;
    return L.divIcon({
      className: "ov-bus-icon",
      html: `<div class="bus-marker"><span style="display:block;transform:rotate(${b}deg)">↑</span></div>`,
      iconSize: [38, 38], iconAnchor: [19, 19]
    });
  }

  function userIcon() {
    if (!window.L) return null;
    return L.divIcon({
      className: "ov-user-icon",
      html: `<div class="user-marker"></div>`,
      iconSize: [32, 32], iconAnchor: [16, 16]
    });
  }

  function initMap() {
    if (state.map.ready || state.map.failed) return state.map.ready;
    const mapEl = $("liveMap");
    if (!mapEl || !window.L) {
      state.map.failed = true;
      $("mapLoading")?.classList.add("hidden");
      $("mapUnavailable")?.classList.remove("hidden");
      return false;
    }
    try {
      const map = L.map(mapEl, { zoomControl: true, preferCanvas: true, minZoom: 6, maxZoom: 18 });
      const tile = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        maxNativeZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
      const routeLayer = L.layerGroup().addTo(map);
      map.setView([50.85, 4.35], 8);
      state.map.instance = map;
      state.map.tile = tile;
      state.map.routeLayer = routeLayer;
      state.map.ready = true;
      const pauseFollow = () => {
        if (state.map.followBus) state.map.userPauseUntil = Date.now() + 9000;
      };
      map.on("dragstart zoomstart", pauseFollow);
      map.on("touchstart", pauseFollow);
      $("mapLoading")?.classList.add("hidden");
      setTimeout(() => map.invalidateSize(), 80);
      return true;
    } catch (error) {
      console.warn("OVFlow live map kon niet starten", error);
      state.map.failed = true;
      $("mapLoading")?.classList.add("hidden");
      $("mapUnavailable")?.classList.remove("hidden");
      return false;
    }
  }

  function routeMapKey(route) {
    if (!route) return "";
    return `${route.publicLine || state.payload?.line || ""}|${route.directionCode || ""}|${route.stops?.length || 0}|${route.stops?.[0]?.stopId || ""}|${route.stops?.at(-1)?.stopId || ""}|${route.shapeMeta?.shapeId || "fallback"}|${route.exactShapePoints?.length || 0}`;
  }

  function validStopCoords(route) {
    return (route?.stops || []).filter(s => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)));
  }

  function routeCoords(route) {
    const exact = Array.isArray(route?.exactShapePoints) ? route.exactShapePoints : [];
    if (exact.length >= 2) return exact.map(pt => [Number(pt[0]), Number(pt[1])]).filter(pt => pt.every(Number.isFinite));
    return validStopCoords(route).map(s => [Number(s.lat), Number(s.lon)]);
  }

  function activeReference() {
    return state.position || state.userPosition || null;
  }

  function isUserFallback() {
    return !state.position && !!state.userPosition;
  }

  function nearestPointIndex(points, lat, lon) {
    let best = -1, dist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = haversine(lat, lon, points[i][0], points[i][1]);
      if (d < dist) { dist = d; best = i; }
    }
    return best;
  }

  function progressModel(route) {
    if (!route) return null;
    const key = routeMapKey(route);
    if (route._progressModel?.key === key) return route._progressModel;
    let points = routeCoords(route);
    if (points.length < 2 || !route.stops?.length) return null;
    const first = route.stops[0], last = route.stops.at(-1);
    const fwd = haversine(first.lat, first.lon, points[0][0], points[0][1]) + haversine(last.lat, last.lon, points.at(-1)[0], points.at(-1)[1]);
    const rev = haversine(first.lat, first.lon, points.at(-1)[0], points.at(-1)[1]) + haversine(last.lat, last.lon, points[0][0], points[0][1]);
    if (rev < fwd) points = [...points].reverse();
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) cumulative[i] = cumulative[i - 1] + haversine(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    const stopDistances = route.stops.map(stop => {
      const i = nearestPointIndex(points, stop.lat, stop.lon);
      return i >= 0 ? cumulative[i] : null;
    });
    return (route._progressModel = { key, points, cumulative, stopDistances, total: cumulative.at(-1) || 1 });
  }

  function timetableProgressIndex(route) {
    if (!route?.stops?.length) return -1;
    const start = Math.max(0, boardingIndex(route));
    const now = Date.now();
    for (let i = start; i < route.stops.length; i++) {
      const info = bestTimeInfoForStop(route.stops[i], i + 1);
      const d = epochOrDate(info.time);
      // Keep the stop current around its departure moment, then advance.
      if (d && d.getTime() >= now - 20_000) return i;
    }
    return route.stops.length - 1;
  }

  function geometryProgressIndex(route, reference = activeReference()) {
    if (!route?.stops?.length || !reference) return -1;
    const fallbackStart = Math.max(0, boardingIndex(route));
    const model = progressModel(route);
    if (!model) return Math.max(fallbackStart, nearestVehicleIndex(route, reference));
    const pointIndex = nearestPointIndex(model.points, reference.lat, reference.lon);
    if (pointIndex < 0) return Math.max(fallbackStart, nearestVehicleIndex(route, reference));
    const distance = model.cumulative[pointIndex] || 0;
    let candidate = fallbackStart;
    for (let i = fallbackStart; i < model.stopDistances.length; i++) {
      const d = model.stopDistances[i];
      if (d !== null && distance > d + 45) candidate = i + 1;
      else break;
    }
    return Math.min(route.stops.length - 1, Math.max(fallbackStart, candidate));
  }

  function identifierIndexIsPlausible(route, idx, reference = activeReference()) {
    if (!route?.stops?.length || idx < 0 || idx >= route.stops.length) return false;
    if (!reference || isUserFallback()) return true;
    const geoIdx = geometryProgressIndex(route, reference);
    const stop = route.stops[idx];
    const direct = stop ? haversine(reference.lat, reference.lon, stop.lat, stop.lon) : Infinity;
    // RT stop_sequence/stopId occasionally belongs to a stale/wrong run. A claimed
    // current stop several stops or kilometres away from the actual GPS position
    // must never be allowed to collapse the timeline to the terminus.
    const closeByIndex = geoIdx < 0 || Math.abs(idx - geoIdx) <= 3;
    const closeByDistance = Number.isFinite(direct) && direct <= 2500;
    return closeByIndex || closeByDistance;
  }

  function progressContext(route, reference = activeReference()) {
    const fallbackStart = Math.max(0, boardingIndex(route));
    if (!route?.stops?.length) return { startIndex: 0, nearestIndex: -1, pct: 0, passed: 0, source: "none" };
    if (!reference) {
      const timed = timetableProgressIndex(route);
      const idx = Math.max(fallbackStart, timed >= 0 ? timed : fallbackStart);
      route._stableStartIndex = Math.max(route._stableStartIndex ?? 0, idx);
      return { startIndex: route._stableStartIndex, nearestIndex: idx, pct: idx / Math.max(1, route.stops.length - 1) * 100, passed: idx, source: timed >= 0 ? "timetable" : "boarding" };
    }

    // Prefer identifiers supplied by GTFS-Realtime. They are much safer than
    // geometric projection on routes that cross or run close to themselves.
    if (state.position && !isUserFallback()) {
      const stopId = String(state.position.stopId || "").replace(/^gt:delijn:/i, "");
      if (stopId) {
        const idIndex = route.stops.findIndex(s => {
          const sid = String(s.stopId || "").replace(/^gt:delijn:/i, "");
          return sid === stopId || sid.endsWith(`:${stopId}`) || stopId.endsWith(`:${sid}`);
        });
        if (idIndex >= 0) {
          const idx = Math.max(fallbackStart, idIndex);
          if (identifierIndexIsPlausible(route, idx, reference)) {
            route._stableStartIndex = Math.max(route._stableStartIndex ?? 0, idx);
            return { startIndex: route._stableStartIndex, nearestIndex: idx, pct: idx / Math.max(1, route.stops.length - 1) * 100, passed: idx, source: "stopId" };
          }
          console.warn("OVFlow: stale/wrong RT stopId genegeerd", { stopId, idIndex, gpsIndex: geometryProgressIndex(route, reference) });
        }
      }
      const seq = Number(state.position.currentStopSequence);
      if (Number.isFinite(seq) && seq > 0 && seq <= route.stops.length + 3) {
        const idx = Math.max(fallbackStart, Math.min(route.stops.length - 1, Math.round(seq) - 1));
        if (identifierIndexIsPlausible(route, idx, reference)) {
          route._stableStartIndex = Math.max(route._stableStartIndex ?? 0, idx);
          return { startIndex: route._stableStartIndex, nearestIndex: idx, pct: idx / Math.max(1, route.stops.length - 1) * 100, passed: idx, source: "sequence" };
        }
        console.warn("OVFlow: stale/wrong RT stop_sequence genegeerd", { seq, sequenceIndex: idx, gpsIndex: geometryProgressIndex(route, reference) });
      }
    }

    const model = progressModel(route);
    if (!model) {
      const i = Math.max(fallbackStart, Math.max(0, nearestVehicleIndex(route, reference)));
      route._stableStartIndex = Math.max(route._stableStartIndex ?? 0, i);
      return { startIndex: route._stableStartIndex, nearestIndex: i, pct: i / Math.max(1, route.stops.length - 1) * 100, passed: i, source: "nearest" };
    }

    const pointIndex = nearestPointIndex(model.points, reference.lat, reference.lon);
    const distance = pointIndex >= 0 ? model.cumulative[pointIndex] : 0;
    let candidate = fallbackStart;
    for (let i = fallbackStart; i < model.stopDistances.length; i++) {
      const stopDistance = model.stopDistances[i];
      // Advance once the vehicle is clearly past the stop. 45 m is enough to
      // avoid a sticky current stop while still filtering normal GPS jitter.
      if (stopDistance !== null && distance > stopDistance + 45) candidate = i + 1;
      else break;
    }
    candidate = Math.min(Math.max(fallbackStart, candidate), route.stops.length - 1);

    // Schedule/realtime time may safely help one stop forward when geometry is
    // sitting on the just-passed stop. It may never jump several stops ahead of GPS.
    const timedIndex = timetableProgressIndex(route);
    if (timedIndex > candidate && timedIndex <= candidate + 1) candidate = timedIndex;

    // Hysteresis prevents GPS jitter/self-crossings from deleting many stops in
    // one refresh. Once a stop is gone it stays gone, but progress advances at
    // most 3 stops per location update after the initial lock.
    if (route._stableStartIndex == null) route._stableStartIndex = candidate;
    else if (candidate > route._stableStartIndex) route._stableStartIndex = Math.min(candidate, route._stableStartIndex + 3);
    const startIndex = Math.max(fallbackStart, route._stableStartIndex);
    const nearestIndex = Math.max(startIndex, nearestVehicleIndex(route, reference));
    return { startIndex, nearestIndex, pct: Math.max(0, Math.min(100, distance / model.total * 100)), passed: startIndex, source: "shape" };
  }

  function maxVisibleStops() { return 9999; }

  function updateUserPosition(position) {
    const c = position?.coords;
    if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return;
    state.userPosition = { lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, timestamp: new Date(position.timestamp || Date.now()).toISOString(), source: "user" };
    if (!state.position) renderVehicle("De Lijn heeft geen voertuig-GPS; jouw locatie wordt als voortgangsreferentie gebruikt.");
  }

  function ensureUserLocation() {
    if (state.position || state.userPosition || !navigator.geolocation) return Promise.resolve(state.userPosition);
    if (state.geoRequest) return state.geoRequest;
    state.geoRequest = new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        pos => {
          updateUserPosition(pos);
          if (state.geoWatchId === null) state.geoWatchId = navigator.geolocation.watchPosition(updateUserPosition, () => {}, { enableHighAccuracy: true, maximumAge: 10000, timeout: 12000 });
          resolve(state.userPosition);
        },
        () => resolve(null),
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 6500 }
      );
    }).finally(() => { state.geoRequest = null; });
    return state.geoRequest;
  }

  function fitLiveSegment() {
    const map = state.map.instance;
    const route = currentRoute();
    const ref = activeReference();
    if (!map || !route || !window.L) return fitRoute();
    const ctx = progressContext(route, ref);
    const end = Math.min(route.stops.length - 1, ctx.startIndex + 7);
    const pts = [];
    if (ref && Number.isFinite(Number(ref.lat)) && Number.isFinite(Number(ref.lon))) pts.push([Number(ref.lat), Number(ref.lon)]);
    for (let i = ctx.startIndex; i <= end; i++) {
      const st = route.stops[i];
      if (Number.isFinite(Number(st?.lat)) && Number.isFinite(Number(st?.lon))) pts.push([Number(st.lat), Number(st.lon)]);
    }
    if (pts.length >= 2) map.fitBounds(L.latLngBounds(pts), { paddingTopLeft:[34,64], paddingBottomRight:[34,38], maxZoom:15 });
    else fitRoute();
  }

  function fitRoute() {
    const map = state.map.instance;
    const route = currentRoute();
    if (!map || !route || !window.L) return;
    const coords = routeCoords(route);
    if (coords.length >= 2) map.fitBounds(L.latLngBounds(coords), { padding: [32, 32], maxZoom: 14 });
    else if (coords.length === 1) map.setView(coords[0], 15);
  }

  function departureDate() {
    const raw = state.payload?.realtimeDeparture || state.payload?.plannedDeparture;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  function minutesUntilDeparture() {
    const d = departureDate();
    if (!d) return null;
    return Math.round((d.getTime() - Date.now()) / 60000);
  }

  function isPreDeparture() {
    const mins = minutesUntilDeparture();
    return mins !== null && mins > 0;
  }

  function setFollowBusAvailability(available, userFallback = false) {
    const btn = $("followBusButton");
    if (!btn) return;
    btn.disabled = !available;
    btn.classList.toggle("disabled", !available);
    const label = btn.querySelector("span");
    if (label) label.textContent = available ? (userFallback ? "Volg mij" : "Volg voertuig") : "Wacht op locatie";
    btn.setAttribute("aria-pressed", state.map.followBus ? "true" : "false");
  }

  function updateMapSummary() {
    const route = currentRoute();
    const ref = activeReference();
    if (!route || !ref) {
      const mins = minutesUntilDeparture();
      const boarding = route ? boardingIndex(route) : -1;
      const startName = boarding >= 0 ? route.stops[boarding]?.name : route?.stops?.[0]?.name;
      setText("mapNearestStop", mins !== null && mins > 0 ? "Voertuig nog niet gestart" : "Positie niet beschikbaar");
      setText("mapNextStop", startName || "—");
      setGpsDisplay(mins !== null && mins > 0 ? (mins <= 1 ? "Vertrekt zo" : `Live rond vertrek · ${mins} min`) : "GPS tijdelijk niet beschikbaar");
      setFollowBusAvailability(false);
      return;
    }
    const ctx = progressContext(route, ref);
    const i = ctx.startIndex;
    setText("mapNearestStop", isUserFallback() ? `Jij · ${route.stops[i]?.name || "langs de route"}` : `Nu bij · ${route.stops[i]?.name || "—"}`);
    setText("mapNextStop", route.stops[i]?.name || "Eindhalte");
    setGpsDisplay(isUserFallback() ? "Jouw locatie" : ageText(state.position?.timestamp), state.position?.timestamp || state.userPosition?.timestamp, isUserFallback());
    setFollowBusAvailability(true, isUserFallback());
    updateJourneyCard();
  }
  function segmentProgress(route, ctx, reference = activeReference()) {
    if (!route || !reference || !ctx) return 0;
    const model = progressModel(route);
    if (!model) return 0;
    const pointIndex = nearestPointIndex(model.points, reference.lat, reference.lon);
    if (pointIndex < 0) return 0;
    const distance = model.cumulative[pointIndex] || 0;
    const current = Math.max(0, Math.min(route.stops.length - 1, ctx.startIndex));
    if (current <= 0) return 0;
    const prevD = model.stopDistances[current - 1];
    const nextD = model.stopDistances[current];
    if (!Number.isFinite(prevD) || !Number.isFinite(nextD) || nextD <= prevD) return 0;
    return Math.max(0, Math.min(100, ((distance - prevD) / (nextD - prevD)) * 100));
  }

  function stopPresence(route, index, reference = activeReference()) {
    const stop = route?.stops?.[index];
    if (!stop || !reference) return { atStop:false, distance:Infinity, label:"" };
    const distance = haversine(reference.lat, reference.lon, stop.lat, stop.lon);
    const speed = Number(state.position?.speed);
    const close = Number.isFinite(distance) && distance <= 85;
    const slowEnough = !Number.isFinite(speed) || speed <= 5.5;
    return { atStop: close && slowEnough, distance, label: close && slowEnough ? "Huidige halte" : "Volgende halte" };
  }

  function updateJourneyCard() {
    const route = currentRoute();
    if (!route?.stops?.length) return;
    const ref = activeReference();
    const ctx = progressContext(route, ref);
    const i = Math.max(0, Math.min(route.stops.length - 1, ctx.startIndex));
    const stop = route.stops[i];
    setText("mapNextStop", stop?.name || "Eindhalte");
    const presence = stopPresence(route, i, ref);
    setText("mapNearestStop", ref
      ? (isUserFallback()
          ? `Jij · ${stop?.name || "langs de route"}`
          : `${presence.atStop ? "Nu bij" : "Onderweg naar"} · ${stop?.name || "—"}`)
      : "GPS tijdelijk niet beschikbaar");

    const timeInfo = bestTimeInfoForStop(stop, i + 1);
    const departure = timeInfo.time;
    setText("departureTime", departure ? timeText(departure) : "—");
    if (departure) {
      const d = epochOrDate(departure);
      const mins = d ? Math.round((d.getTime() - Date.now()) / 60000) : null;
      const prefix = timeInfo.estimated ? "Geschat realtime" : timeInfo.realtime ? "Realtime" : "Gepland";
      setText("departureMeta", mins !== null ? `${prefix} · ${mins <= 0 ? "nu" : `over ${mins} min`}` : prefix);
    } else {
      setText("departureMeta", "Geen vertrektijd beschikbaar");
    }
    setDelayDisplay(Number(timeInfo.delay || 0), true);

    const progress = segmentProgress(route, ctx, ref);
    const bar = $("routeProgress");
    if (bar) bar.style.width = `${progress}%`;
  }

  function updateMapHighlights() {
    const route = currentRoute();
    if (!state.map.ready || !route) return;
    const boarding = boardingIndex(route);
    const ctx = progressContext(route);
    state.map.stopMarkers.forEach((marker, i) => {
      if (!marker?.setIcon) return;
      const kind = i < ctx.startIndex ? "passed" : i === ctx.startIndex ? "current" : i === boarding ? "boarding" : i === 0 ? "start" : i === route.stops.length - 1 ? "end" : "normal";
      marker.setIcon(stopIcon(kind));
      marker.setZIndexOffset(i === ctx.startIndex ? 500 : i === boarding ? 300 : 0);
    });
    updateMapSummary();
  }
  function renderMapRoute(force = false) {
    const route = currentRoute();
    if (!route || !initMap()) return;
    const key = routeMapKey(route);
    if (!force && state.map.routeKey === key) {
      updateMapHighlights();
      updateBusOnMap();
      return;
    }

    const map = state.map.instance;
    state.map.routeLayer.clearLayers();
    state.map.stopMarkers = [];
    state.map.routeLine = null;
    state.map.routeKey = key;

    const coords = routeCoords(route);
    if (coords.length >= 2) {
      // Premium route rendering: white casing first, then the crisp blue route.
      L.polyline(coords, { color: "#ffffff", weight: 10, opacity: .96, lineJoin: "round", lineCap: "round", smoothFactor: .8 }).addTo(state.map.routeLayer);
      state.map.routeLine = L.polyline(coords, { color: "#087ff5", weight: 6, opacity: .96, lineJoin: "round", lineCap: "round", smoothFactor: .8 }).addTo(state.map.routeLayer);
      L.polyline(coords, { color: "#65b8ff", weight: 2, opacity: .55, lineJoin: "round", lineCap: "round", smoothFactor: .8 }).addTo(state.map.routeLayer);
    }

    const boarding = boardingIndex(route);
    const progress = progressContext(route);
    route.stops.forEach((stop, i) => {
      if (!Number.isFinite(Number(stop.lat)) || !Number.isFinite(Number(stop.lon))) {
        state.map.stopMarkers.push(null);
        return;
      }
      const kind = i < progress.startIndex ? "passed" : i === progress.startIndex ? "current" : i === boarding ? "boarding" : i === 0 ? "start" : i === route.stops.length - 1 ? "end" : "normal";
      const marker = L.marker([Number(stop.lat), Number(stop.lon)], {
        icon: stopIcon(kind),
        keyboard: false,
        zIndexOffset: i === boarding ? 300 : (kind === "start" || kind === "end" ? 180 : 0)
      }).addTo(state.map.routeLayer);
      marker.bindTooltip(`${i + 1}. ${esc(stop.name)}`, { direction: "top", className: "ov-tooltip", offset: [0, -7] });
      marker.on("click", () => {
        const row = document.querySelector(`.stop-row[data-stop-index="${i}"]`);
        row?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      state.map.stopMarkers.push(marker);
    });
    fitRoute();
    updateMapHighlights();
    updateBusOnMap();
    setTimeout(() => map.invalidateSize(), 80);
  }

  function updateBusOnMap() {
    if (!state.map.ready) return;
    const map = state.map.instance;
    const ref = activeReference();
    const fallback = isUserFallback();
    if (!ref || !Number.isFinite(Number(ref.lat)) || !Number.isFinite(Number(ref.lon))) {
      if (state.map.busMarker) { map.removeLayer(state.map.busMarker); state.map.busMarker = null; }
      if (state.map.userMarker) { map.removeLayer(state.map.userMarker); state.map.userMarker = null; }
      updateMapSummary();
      return;
    }
    const ll = [Number(ref.lat), Number(ref.lon)];
    if (fallback) {
      if (state.map.busMarker) { map.removeLayer(state.map.busMarker); state.map.busMarker = null; }
      if (!state.map.userMarker) {
        state.map.userMarker = L.marker(ll, { icon: userIcon(), zIndexOffset: 1000, keyboard: false }).addTo(map);
        state.map.userMarker.bindTooltip("Jouw locatie · voortgangsreferentie", { direction: "top", className: "ov-tooltip", offset: [0, -14] });
      } else state.map.userMarker.setLatLng(ll);
    } else {
      if (state.map.userMarker) { map.removeLayer(state.map.userMarker); state.map.userMarker = null; }
      if (!state.map.busMarker) {
        state.map.busMarker = L.marker(ll, { icon: busIcon(state.position?.bearing), zIndexOffset: 1000, keyboard: false }).addTo(map);
        state.map.busMarker.bindTooltip(`Voertuig ${esc(state.position?.vehicleId || "live")}`, { direction: "top", className: "ov-tooltip", offset: [0, -16] });
      } else {
        state.map.busMarker.setLatLng(ll);
        state.map.busMarker.setIcon(busIcon(state.position?.bearing));
        state.map.busMarker.setTooltipContent(`Voertuig ${esc(state.position?.vehicleId || "live")} · ${esc(ageText(state.position?.timestamp))}`);
      }
    }
    setFollowBusAvailability(true, fallback);
    if (state.map.followBus && Date.now() >= Number(state.map.userPauseUntil || 0)) {
      const zoom = Math.max(15, map.getZoom());
      map.panTo(ll, { animate: true, duration: .75, easeLinearity: .22 });
      if (map.getZoom() < 15) map.setZoom(zoom, { animate: true });
    }
    updateMapHighlights();
  }
  function nearestVehicleIndex(route, position) {
    if (!route || !position) return -1;
    let best = -1, dist = Infinity;
    route.stops.forEach((stop, i) => {
      const d = haversine(position.lat, position.lon, stop.lat, stop.lon);
      if (d < dist) { dist = d; best = i; }
    });
    return best;
  }

  function boardingIndex(route) {
    const p = state.payload;
    const targetId = String(p.stop?.stopId || "");
    if (targetId) {
      const i = route.stops.findIndex(s => String(s.stopId) === targetId);
      if (i >= 0) return i;
    }
    const lat = num(p.stop?.lat), lon = num(p.stop?.lon);
    if (lat === null || lon === null) return -1;
    let best = -1, dist = Infinity;
    route.stops.forEach((s, i) => { const d = haversine(lat, lon, s.lat, s.lon); if (d < dist) { dist = d; best = i; } });
    return dist < 1800 ? best : -1;
  }

  function renderRoutes() {
    const tabs = $("directionTabs");
    const route = currentRoute();
    if (!route) return;
    tabs.innerHTML = state.routes.length > 1 ? state.routes.map((r, i) => `<button type="button" class="direction-tab ${i === state.routeIndex ? "active" : ""}" data-route-index="${i}">${esc(r.directionName || r.directionCode || `Richting ${i+1}`)}</button>`).join("") : "";
    tabs.classList.toggle("hidden", state.routes.length <= 1);
    tabs.querySelectorAll("[data-route-index]").forEach(btn => btn.addEventListener("click", () => {
      state.routeIndex = Number(btn.dataset.routeIndex);
      renderRoutes();
      fetchExactShape().catch(() => {});
      renderVehicle();
    }));

    const ctx = progressContext(route);
    const remaining = route.stops.slice(ctx.startIndex);
    const visible = remaining;
    const usingUser = isUserFallback();
    setText("stopCount", String(remaining.length));
    setText("directionValue", route.directionName || route.directionCode || "—");
    setText("routeLabel", route.description || route.directionName || state.payload.destination || `Lijn ${state.payload.line}`);
    setText("stopsStatus", `${remaining.length} resterende halte${remaining.length === 1 ? "" : "s"}${usingUser ? " · jouw locatie" : ""}`);

    const boarding = boardingIndex(route);
    $("stopsList").innerHTML = visible.map((stop, rel) => {
      const i = ctx.startIndex + rel;
      const cls = [i === boarding ? "boarding" : "", i === ctx.startIndex ? "current" : "", i === route.stops.length - 1 ? "terminal" : ""].filter(Boolean).join(" ");
      const extra = i === boarding && i !== ctx.startIndex ? "Instappen" : "";
      const preload = (state.payload.preloadedStops || []).find(ps => {
        const pid = String(ps?.stopId || ps?.haltenummer || "");
        if (pid && stop.stopId && pid === String(stop.stopId)) return true;
        return norm(ps?.name || ps?.omschrijvingLang || ps?.omschrijving || "") === norm(stop.name);
      });
      const preloadTime = preload?.plannedTime || preload?.departureTime || preload?.arrivalTime || preload?.doorkomsttijd || preload?.time || null;
      const timeInfo = bestTimeInfoForStop(stop, i + 1, preloadTime);
      const clock = timeInfo.time ? timeText(timeInfo.time) : "—";
      const timeLabel = clock && clock !== "—" ? clock : "—";
      const delaySec = Number(timeInfo.delay || 0);
      const delayMin = Math.round(delaySec / 60);
      const delayLabel = delayMin !== 0 ? `${delayMin > 0 ? "+" : ""}${delayMin} min${timeInfo.estimated ? " · geschat" : ""}` : "";
      const isCurrent = i === ctx.startIndex;
      const presence = isCurrent ? stopPresence(route, i, activeReference()) : { atStop:false };
      const subtitle = i === route.stops.length - 1 ? "Eindhalte" : (isCurrent ? (presence.atStop ? "Huidige halte" : "Volgende halte") : "");
      const timingMeta = delayLabel ? `<small class="delay-mini ${delayMin > 0 ? "late" : "early"}">${esc(delayLabel)}</small>` : "";
      const nowMeta = isCurrent && presence.atStop ? `<small class="now-label">Nu</small>` : "";
      return `<div class="stop-row ${cls} ${isCurrent && !presence.atStop ? "upcoming-current" : ""}" data-stop-index="${i}">
        <div class="stop-time">${esc(timeLabel)}${nowMeta}${timingMeta}</div>
        <div class="stop-track"><div class="stop-dot"></div></div>
        <div class="stop-main"><strong>${esc(stop.name)}</strong>${subtitle ? `<small class="${isCurrent ? "current-label" : ""}">${esc(subtitle)}</small>` : ""}</div>
        <div class="stop-end">${extra ? `<span class="stop-extra">${esc(extra)}</span>` : ""}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></div>
      </div>`;
    }).join("");
    updateJourneyCard();
    renderMapRoute();
  }
  async function fetchVehicle() {
    const p = state.payload;
    if (!API_BASE || !p.tripId) {
      state.position = null;
      renderVehicle("Voor dit vertrek is geen trip-ID beschikbaar.");
      ensureUserLocation().catch(() => {});
      return;
    }
    try {
      const url = new URL(`${API_BASE}/api/v4/vehicle-position`);
      url.searchParams.set("tripId", p.tripId);
      if (p.line) url.searchParams.set("line", p.line);
      const data = await getJson(url, 9000, 0);
      state.position = data?.position && !data.position.stale ? data.position : null;
      if (state.position) {
        const route = currentRoute();
        if (route?._stableStartIndex != null) {
          const geoIdx = geometryProgressIndex(route, state.position);
          if (geoIdx >= 0 && Math.abs(Number(route._stableStartIndex) - geoIdx) > 4) {
            console.warn("OVFlow: foutieve sticky current-stop lock hersteld", { oldIndex: route._stableStartIndex, gpsIndex: geoIdx });
            route._stableStartIndex = geoIdx;
          }
        }
      }
      renderVehicle(state.position ? "" : "De Lijn levert voor deze rit momenteel geen exacte voertuigpositie.");
      if (!state.position) ensureUserLocation().catch(() => {});
    } catch (error) {
      state.position = null;
      renderVehicle(`Live GPS tijdelijk niet bereikbaar: ${error.message}`);
      ensureUserLocation().catch(() => {});
    }
  }
  function renderVehicle(message = "") {
    const pos = state.position;
    const route = currentRoute();
    const ref = activeReference();
    const fallback = isUserFallback();
    const dot = $("gpsDot");
    const details = $("vehicleDetails");

    if (!pos && !fallback) {
      const mins = minutesUntilDeparture();
      dot.className = "gps-dot offline";
      details.classList.add("hidden");
      setText("vehicleId", "Geen GPS");
      setText("vehicleAge", "Wachten");
      setText("positionSource", mins !== null && mins > 0 ? "Rit staat gepland · live GPS volgt rond vertrek" : "De Lijn GPS ontbreekt · OVFlow probeert jouw locatie als fallback");
      setFollowBusAvailability(false);
      $("routeProgress").style.width = "0%";
      setGpsDisplay("GPS tijdelijk niet beschikbaar");
      updateBusOnMap();
      if (route) renderRoutes();
      return;
    }

    if (fallback) {
      dot.className = "gps-dot fallback";
      details.classList.add("hidden");
      setText("vehicleId", "Onbekend");
      setText("vehicleAge", ageText(state.userPosition?.timestamp));
      setGpsDisplay("Jouw locatie", state.userPosition?.timestamp, true);
      setText("positionSource", "Geen bus-GPS · voortgang wordt geschat met jouw telefoonlocatie");
    } else {
      dot.className = "gps-dot live";
      details.classList.remove("hidden");
      setText("vehicleId", pos.vehicleId || "Onbekend");
      setText("vehicleAge", ageText(pos.timestamp));
      setGpsDisplay(ageText(pos.timestamp), pos.timestamp, false);
      setText("coordinates", `${Number(pos.lat).toFixed(5)}, ${Number(pos.lon).toFixed(5)}`);
      setText("bearingValue", bearingText(pos.bearing));
      setText("positionSource", `Exacte GPS · De Lijn GTFS Realtime · ${ageText(pos.timestamp)}`);
    }

    if (route && ref) {
      const ctx = progressContext(route, ref);
      setText("nearestStop", route.stops[ctx.startIndex]?.name || "—");
      const nextIdx = Math.min(route.stops.length - 1, ctx.startIndex + (state.position ? 1 : 0));
      setText("nextStop", route.stops[nextIdx]?.name || "Eindhalte");
      updateJourneyCard();
      renderRoutes();
    }
    updateBusOnMap();
    if (route && ref && !state.map.followBus && !state.map._segmentFitted) {
      state.map._segmentFitted = true;
      setTimeout(fitLiveSegment, 80);
    }
  }
  function scheduleRouteRecovery() {
    if (state.routes.length || state._routeRecoveryTimer) return;
    state._routeRecoveryTimer = setTimeout(async () => {
      state._routeRecoveryTimer = null;
      if (state.routes.length || document.hidden) return;
      try {
        await fetchRoutes();
        clearError();
        renderVehicle();
      } catch (error) {
        console.warn("OVFlow: achtergrondretry haltevolgorde mislukt", error);
      }
    }, 3500);
  }

  async function refreshInfo() {
    if (document.hidden) return;
    try {
      await Promise.all([fetchTripTimes(), fetchTripSchedule(true)]);
      await fetchFallbackStopTimes();
      if (currentRoute()) { renderRoutes(); updateJourneyCard(); }
    } catch (error) {
      console.warn("OVFlow live halte-informatie refresh mislukt", error);
    }
  }

  async function refreshAll() {
    if (state.loading) return;
    state.loading = true;
    clearError();
    $("refreshButton")?.classList.add("is-loading");
    let routeError = null;
    try {
      if (!state.routes.length) {
        try {
          await fetchRoutes();
        } catch (error) {
          routeError = error;
          if (state.payload.preloadedStops.length >= 2) {
            state.routes = [{
              directionCode: "RIT",
              directionName: state.payload.destination || "Rit",
              publicLine: state.payload.line,
              stops: state.payload.preloadedStops.map(compactApiStop)
            }];
            state.routeIndex = 0;
            renderRoutes();
          } else {
            setText("stopsStatus", "Nog laden…");
            $("stopsList").innerHTML = '<div class="loading-row"><span class="spinner"></span><strong>Haltes opnieuw ophalen…</strong></div>';
            scheduleRouteRecovery();
          }
        }
      }

      // Vehicle GPS must never block the route/stop UI. fetchVehicle handles its
      // own errors and can fall back to the phone location.
      await fetchVehicle();
      await Promise.all([fetchTripTimes(), fetchTripSchedule(true)]);
      await fetchFallbackStopTimes();
      if (currentRoute()) { renderRoutes(); updateJourneyCard(); }

      if (routeError && !state.routes.length) {
        showError("Haltes laden iets trager", "OVFlow blijft automatisch proberen. Kaart en jouw locatie blijven ondertussen bruikbaar.");
      }
      setText("lastUpdated", `Bijgewerkt ${new Intl.DateTimeFormat("nl-BE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date())}`);
    } catch (error) {
      console.warn("OVFlow live refresh gedeeltelijk mislukt", error);
      showError("Een onderdeel is tijdelijk niet bereikbaar", "De live-pagina blijft werken en probeert automatisch opnieuw.");
    } finally {
      state.loading = false;
      $("refreshButton")?.classList.remove("is-loading");
    }
  }

  function setup() {
    state.payload = readPayload();
    renderBase();
    initMap();
    $("routeStopsButton")?.addEventListener("click", () => {
      state.map.followBus = false;
      state.map.userPauseUntil = 0;
      fitLiveSegment();
    });
    $("fitRouteButton")?.addEventListener("click", () => {
      state.map.followBus = false;
      state.map.userPauseUntil = 0;
      fitRoute();
    });
    $("followBusButton")?.addEventListener("click", event => {
      const pos = activeReference();
      if (!pos || !Number.isFinite(Number(pos.lat)) || !Number.isFinite(Number(pos.lon))) return;
      state.map.followBus = !state.map.followBus;
      state.map.userPauseUntil = 0;
      event.currentTarget.classList.toggle("is-following", state.map.followBus);
      if (state.map.instance && state.map.followBus) state.map.instance.setView([Number(pos.lat), Number(pos.lon)], Math.max(15, state.map.instance.getZoom()), { animate: true });
    });
    $("centerMapButton")?.addEventListener("click", () => {
      const pos = activeReference();
      if (pos && state.map.instance) state.map.instance.setView([Number(pos.lat), Number(pos.lon)], Math.max(15, state.map.instance.getZoom()));
      else fitRoute();
    });
    $("toggleStopsButton")?.addEventListener("click", event => {
      state.map.stopsVisible = !state.map.stopsVisible;
      const group = state.map.routeLayer;
      if (group) state.map.stopMarkers.forEach(marker => {
        if (!marker) return;
        if (state.map.stopsVisible) group.addLayer(marker); else group.removeLayer(marker);
      });
      event.currentTarget.classList.toggle("active", state.map.stopsVisible);
    });
    $("fullscreenMapButton")?.addEventListener("click", async () => {
      const card = document.querySelector(".map-card");
      try {
        if (!document.fullscreenElement) await card?.requestFullscreen?.();
        else await document.exitFullscreen?.();
      } catch {}
      setTimeout(() => state.map.instance?.invalidateSize(), 120);
    });
    const fav = $("favoriteButton");
    if (fav) {
      const favKey = `ovflow:fav-live:${state.payload.line || ""}:${state.payload.destination || ""}`;
      try { fav.classList.toggle("active", localStorage.getItem(favKey) === "1"); } catch {}
      fav.addEventListener("click", () => {
        fav.classList.toggle("active");
        try { localStorage.setItem(favKey, fav.classList.contains("active") ? "1" : "0"); } catch {}
      });
    }
    $("alertsButton")?.addEventListener("click", () => {
      const count = Number(state.payload?.alertsCount || 0);
      showError("Meldingen", count > 0 ? `${count} actieve melding${count === 1 ? "" : "en"} voor deze rit.` : "Er zijn momenteel geen actieve meldingen voor deze rit.");
      setTimeout(clearError, 3600);
    });
    $("backButton").addEventListener("click", () => history.length > 1 ? history.back() : location.assign("index.html"));
    $("refreshButton").addEventListener("click", refreshAll);
    $("retryButton").addEventListener("click", refreshAll);
    const alertCount = Number(state.payload?.alertsCount || 0);
    $("notificationDot")?.classList.toggle("hidden", alertCount <= 0);
    refreshAll();
    const vehicleInterval = Math.max(5000, Math.min(10000, Number(cfg.VEHICLE_REFRESH_MS || 7000)));
    const infoInterval = Math.max(15000, Math.min(30000, Number(cfg.INFO_REFRESH_MS || 25000)));
    state.vehicleTimer = setInterval(() => {
      if (!document.hidden) fetchVehicle().then(() => setText("lastUpdated", `Live ${timeText(new Date())}`));
    }, vehicleInterval);
    state.infoTimer = setInterval(refreshInfo, infoInterval);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { fetchVehicle(); refreshInfo(); } });
    window.addEventListener("pagehide", () => {
      if (state.vehicleTimer) clearInterval(state.vehicleTimer);
      if (state.infoTimer) clearInterval(state.infoTimer);
      if (state._routeRecoveryTimer) clearTimeout(state._routeRecoveryTimer);
      if (state.geoWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(state.geoWatchId);
    });
  }

  setup();
})();
