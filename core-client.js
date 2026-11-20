(() => {
  "use strict";

  // All transit requests go through the user-owned OVFlow backend.

  const cfg = window.OVFLOW_CONFIG || {};
  const API_BASE = String(cfg.API_BASE || "").trim().replace(/\/$/, "");
  // OVFlow 8.5: Transitous rechtstreeks (publieke API met CORS). De optionele
  // v8-proxy op de eigen server is alleen nog een reserve bij netwerkfouten.
  const TRANSITOUS_DIRECT = "https://api.transitous.org/api";
  const TRANSITOUS_PROXY = API_BASE ? `${API_BASE}/api/v8/transit` : "";
  const TRANSITOUS_VERSION = { geocode: "v1", "reverse-geocode": "v1", stoptimes: "v6", trip: "v6", plan: "v6", "map/trips": "v6" };
  function transitousUrls(endpoint) {
    const urls = [`${TRANSITOUS_DIRECT}/${TRANSITOUS_VERSION[endpoint] || "v1"}/${endpoint}`];
    if (TRANSITOUS_PROXY) urls.push(`${TRANSITOUS_PROXY}/${endpoint}`);
    return urls;
  }
  // Haalt een Transitous-endpoint op: eerst rechtstreeks, dan via de proxy.
  async function transitousJson(endpoint, params, ttlMs = 15_000, options = {}) {
    let lastError = null;
    for (const base of transitousUrls(endpoint)) {
      const url = new URL(base);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
      }
      try {
        const result = await cachedJson(url, ttlMs, options);
        // 404 van de proxy betekent: proxy niet geïnstalleerd → niet verder proberen
        if (!result.response.ok && base.startsWith(TRANSITOUS_PROXY || "-") && result.response.status === 404) break;
        return result;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Transitous niet bereikbaar");
  }
  const JSON_HEADERS = { Accept: "application/json" };
  const cache = new Map();

  // OVFlow 8.4: use existing v4 backend as the source of truth.
  // v8 transit proxy is a fallback and hosts profile endpoints when installed.
  function normalizeBackendPlace(item) {
    if (!item) return null;
    const lat = Number(item.lat ?? item.latitude);
    const lon = Number(item.lon ?? item.longitude ?? item.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const mode = String(item.mode || (item.type === "station" ? "train" : "bus")).toLowerCase();
    return {
      ...item,
      type: String(item.type || (mode === "train" ? "station" : "stop")).toLowerCase(),
      mode,
      id: String(item.id || ""),
      transitousId: String(item.transitousId || ""),
      name: String(item.name || "Onbekende halte"),
      municipality: String(item.municipality || item.subtitle || ""),
      operator: String(item.operator || "Openbaar vervoer"),
      lat, lon, latitude: lat, longitude: lon,
      raw: { ...item, country: "BE", source: "ovflow-api" }
    };
  }

  function normalizeBackendDeparture(item, stopName = "") {
    if (!item) return null;
    const planned = iso(item.plannedDeparture || item.scheduledDeparture || item.realtimeDeparture);
    const effective = iso(item.realtimeDeparture || item.departure || planned);
    if (!planned && !effective) return null;
    return {
      ...item,
      id: String(item.id || item.tripId || `${stopName}-${planned || effective}`),
      tripId: String(item.tripId || ""), // NEVER treat departure ID as a native trip ID
      gtfsTripId: String(item.gtfsTripId || ""),
      stopName: String(item.stopName || item.origin || stopName || ""),
      mode: String(item.mode || "bus").toLowerCase(),
      line: String(item.line || (item.mode === "train" ? "Trein" : "Bus")),
      operator: String(item.operator || "Openbaar vervoer"),
      destination: String(item.destination || "Onbekende richting"),
      plannedDeparture: planned || effective,
      realtimeDeparture: effective || planned,
      delayMinutes: Number(item.delayMinutes) || 0,
      cancelled: Boolean(item.cancelled),
      realtime: Boolean(item.realtime),
      platform: String(item.platform || item.bay || ""),
      source: String(item.source || "ovflow-api")
    };
  }

  async function backendRequest(path, params = {}, timeout = 10000) {
    if (!API_BASE) throw Error("OVFlow-server niet ingesteld");
    const url = new URL(API_BASE + path);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const { response, data } = await cachedJson(url, 8000, { timeout });
    if (!response.ok || data?.ok === false) throw Error(data?.message || `OVFlow API HTTP ${response.status}`);
    return data;
  }

  async function backendStopDepartures(stop, max = 8) {
    let id = String(stop?.id || "");
    const rail = stop?.type === "station" || stop?.mode === "train" || /^BE\.NMBS/i.test(id);
    if (rail && !/^BE\.NMBS/i.test(id)) {
      const found = await backendSearchPlaces(stop?.name || "", 10);
      const station = found.find(p => p.mode === "train" || p.type === "station");
      if (station) id = station.id;
    }
    const data = rail
      ? await backendRequest("/api/v4/rail/liveboard", { id, max: Math.min(20, max) })
      : await backendRequest(`/api/v4/stops/${encodeURIComponent(id)}/departures`, { max: Math.min(20, max) });
    const name = String(stop?.name || data?.station?.name || "");
    const departures = asArray(data?.departures).map(dep => normalizeBackendDeparture(dep, name)).filter(Boolean);
    await attachTripIds(departures, stop);
    return { departures, source: "ovflow-api" };
  }

  // Vertrekken van de eigen server (De Lijn-API, iRail) hebben geen
  // Transitous-rit-ID. Zonder die ID kan "Volg deze rit live" niet werken.
  // Koppel ze daarom aan het Transitous-vertrekbord van dezelfde plek
  // (zelfde lijn/treinnummer, geplande tijd binnen 3 minuten).
  const digits = v => (String(v || "").match(/\d+/g) || []).join("");
  const lineKey = v => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  async function attachTripIds(departures, stop) {
    const missing = departures.filter(d => !d.tripId);
    if (!missing.length) return departures;
    const lat = Number(stop?.lat ?? stop?.latitude ?? departures[0]?.stopLatitude);
    const lon = Number(stop?.lon ?? stop?.longitude ?? departures[0]?.stopLongitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return departures;
    let board;
    try {
      board = await transitousStopTimes({
        lat, lon, radius: stop?.type === "station" || stop?.mode === "train" ? 350 : 200,
        max: 120, minimumEvents: 60, time: new Date(Date.now() - 10 * 60000), windowSeconds: 4 * 3600, timeout: 9000
      });
    } catch { return departures; }
    const used = new Set();
    for (const dep of missing) {
      const t = parseDate(dep.plannedDeparture || dep.realtimeDeparture)?.getTime();
      if (!Number.isFinite(t)) continue;
      const depDigits = digits(dep.line), depKey = lineKey(dep.line);
      let best = null, bestDiff = Infinity;
      for (const cand of board.departures) {
        if (!cand.tripId || used.has(cand.tripId)) continue;
        const ct = parseDate(cand.plannedDeparture || cand.realtimeDeparture)?.getTime();
        const diff = Math.abs(ct - t);
        if (!Number.isFinite(diff) || diff > 3 * 60000) continue;
        const raw = cand.rawStopTime || {};
        const train = dep.mode === "train";
        const ok = train
          ? (depDigits && [raw.tripShortName, raw.displayName, cand.line].some(v => digits(v) === depDigits)) ||
            (!depDigits && cand.mode === "train")
          : lineKey(cand.line) === depKey || lineKey(raw.routeShortName) === depKey;
        if (ok && diff < bestDiff) { best = cand; bestDiff = diff; }
      }
      if (best) {
        used.add(best.tripId);
        dep.tripId = best.tripId;
        dep.rawStopTime = best.rawStopTime;
        dep.stopId = dep.stopId || best.stopId;
        dep.stopLatitude = Number.isFinite(dep.stopLatitude) ? dep.stopLatitude : best.stopLatitude;
        dep.stopLongitude = Number.isFinite(dep.stopLongitude) ? dep.stopLongitude : best.stopLongitude;
      }
    }
    return departures;
  }

  async function backendSearchPlaces(query, max = 10) {
    const data = await backendRequest("/api/v4/search", { q: query, max }, 10000);
    return asArray(data?.results).map(normalizeBackendPlace).filter(Boolean);
  }

  async function backendNearbyStops({ lat, lon, radius = 2500, max = 12 }) {
    const data = await backendRequest("/api/v4/stops/nearby", { lat, lon, radius, max: Math.min(25, max) }, 16000);
    return asArray(data?.stops).map(normalizeBackendPlace).filter(Boolean);
  }

  async function planJourney(params = {}, options = {}) {
    // Eerst de eigen server; lukt dat niet, dan rechtstreeks Transitous.
    if (API_BASE) {
      try { return await backendRequest("/api/v4/journeys", params, options.timeout || 25000); }
      catch (error) { console.warn("OVFlow backend journeys fallback:", error.message); }
    }
    const { response, data } = await transitousJson("plan", params, 20_000, { timeout: options.timeout || 25000 });
    if (!response.ok) throw new Error(data?.message || data?.error || `Transitous routeplanner HTTP ${response.status}`);
    return data;
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    return value == null ? [] : [value];
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || min));
  }

  function timeoutSignal(ms = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return { controller, clear: () => clearTimeout(timer) };
  }

  async function fetchJson(url, options = {}) {
    const { timeout = 12000, ...fetchOptions } = options;
    const timeoutState = timeoutSignal(timeout);
    try {
      const response = await fetch(url, {
        mode: "cors",
        cache: "no-store",
        ...fetchOptions,
        signal: fetchOptions.signal || timeoutState.controller.signal,
        headers: { ...JSON_HEADERS, ...(fetchOptions.headers || {}) }
      });
      let data = null;
      const contentType = response.headers.get("content-type") || "";
      if (/json/i.test(contentType)) {
        try { data = await response.json(); } catch {}
      } else {
        try {
          const text = await response.text();
          data = text ? { message: text.slice(0, 240) } : null;
        } catch {}
      }
      return { response, data };
    } finally {
      timeoutState.clear();
    }
  }

  async function cachedJson(url, ttlMs = 15000, options = {}) {
    const key = String(url);
    const existing = cache.get(key);
    if (existing && Date.now() - existing.at < ttlMs) return existing.value;
    const pending = fetchJson(url, options).then(result => {
      if (result.response.ok) cache.set(key, { at: Date.now(), value: result });
      return result;
    }).catch(error => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, { at: Date.now(), value: pending });
    const result = await pending;
    cache.set(key, { at: Date.now(), value: result });
    return result;
  }

  function parseDate(raw) {
    if (!raw) return null;
    if (raw instanceof Date) return raw;
    if (typeof raw === "number" || /^\d{10,13}$/.test(String(raw))) {
      const n = Number(raw);
      const d = new Date(n > 1e12 ? n : n * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function iso(raw) {
    const d = parseDate(raw);
    return d ? d.toISOString() : null;
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const p1 = Number(lat1) * Math.PI / 180;
    const p2 = Number(lat2) * Math.PI / 180;
    const dp = (Number(lat2) - Number(lat1)) * Math.PI / 180;
    const dl = (Number(lon2) - Number(lon1)) * Math.PI / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function modeFromTransitous(mode, modes = []) {
    const values = [mode, ...asArray(modes)].map(v => String(v || "").toUpperCase());
    if (values.some(v => v === "TRAM" || v === "LIGHT_RAIL")) return "tram";
    if (values.some(v => /RAIL|SUBURBAN|TRAIN|HIGHSPEED/.test(v))) return "train";
    if (values.some(v => v === "SUBWAY" || v === "METRO")) return "metro";
    if (values.some(v => v === "FERRY")) return "ferry";
    return "bus";
  }

  function municipalityFromMatch(match) {
    const areas = asArray(match?.areas);
    const preferred = areas.find(area => area?.default) || areas.find(area => area?.unique) || areas[0];
    return String(preferred?.name || match?.locality || match?.city || "");
  }

  function normalizeMatch(match) {
    if (!match) return null;
    const lat = Number(match.lat ?? match.latitude);
    const lon = Number(match.lon ?? match.longitude ?? match.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const id = String(match.id || match.stopId || "");
    const modes = asArray(match.modes);
    const mtype = String(match.type || "STOP").toUpperCase();
    const street = String(match.street || "");
    const addressName = mtype === "ADDRESS" && street ? `${street}${match.houseNumber ? " " + match.houseNumber : ""}` : "";
    return {
      type: mtype === "STOP" ? "stop" : mtype === "ADDRESS" ? "address" : "place",
      kind: mtype,
      mode: modeFromTransitous("", modes),
      id,
      transitousId: id,
      name: String(addressName || match.name || "Onbekende halte"),
      municipality: municipalityFromMatch(match),
      street: String(match.street || ""),
      stopCode: String(match.stopCode || ""),
      entity: "",
      stop: id,
      lat,
      lon,
      latitude: lat,
      longitude: lon,
      operator: "Openbaar vervoer",
      modes,
      raw: match
    };
  }

  function normalizeStopTime(item, stopName = "") {
    const place = item?.place || {};
    const plannedRaw = place.scheduledDeparture || place.scheduledArrival || place.departure || place.arrival;
    const effectiveRaw = place.departure || place.arrival || plannedRaw;
    const planned = iso(plannedRaw || effectiveRaw);
    const effective = iso(effectiveRaw || plannedRaw);
    const plannedDate = parseDate(planned);
    const effectiveDate = parseDate(effective);
    const delayMinutes = plannedDate && effectiveDate
      ? Math.round((effectiveDate.getTime() - plannedDate.getTime()) / 60000)
      : 0;

    const mode = modeFromTransitous(item?.mode);
    const display = String(item?.routeShortName || item?.displayName || item?.tripShortName || "").trim();
    const fallbackLine = mode === "train" ? "Trein" : mode === "tram" ? "Tram" : "Bus";
    const operator = String(item?.agencyName || item?.source || (mode === "train" ? "NMBS/SNCB" : "Openbaar vervoer"));
    const cancelled = Boolean(item?.cancelled || item?.tripCancelled);

    return {
      id: String(item?.tripId || `${place.stopId || stopName}-${effective || planned || ""}`),
      tripId: String(item?.tripId || ""),
      stopId: String(place.stopId || ""),
      stopName: String(place.name || stopName || ""),
      stopLatitude: Number(place.lat),
      stopLongitude: Number(place.lon),
      mode,
      line: display || fallbackLine,
      operator,
      destination: String(item?.headsign || item?.tripTo?.name || item?.routeLongName || "Onbekende richting"),
      origin: String(place.name || stopName || ""),
      plannedDeparture: planned || effective,
      realtimeDeparture: effective || planned,
      delayMinutes,
      platform: String(place.track || place.scheduledTrack || ""),
      platformChanged: Boolean(place.track && place.scheduledTrack && place.track !== place.scheduledTrack),
      realtime: Boolean(item?.realTime),
      cancelled,
      // Keep the original stop event available for the on-demand Live Trip
      // fallback. `nextStops` is normally absent because regular boards use
      // fetchStops=false, so this does not inflate the normal nearby/stop UI.
      rawStopTime: item,
      source: "transitous"
    };
  }

  async function transitousGeocode(query, max = 10, types = "STOP") {
    const { response, data } = await transitousJson("geocode", {
      text: query, type: types, numResults: clamp(max, 1, 20), language: "nl",
      place: "50.85,4.35", placeBias: "1"
    }, 45_000);
    if (!response.ok) throw new Error(data?.message || `Transitous zoeken HTTP ${response.status}`);
    return asArray(data).map(normalizeMatch).filter(Boolean);
  }

  async function transitousReverseStops(lat, lon, max = 8) {
    const { response, data } = await transitousJson("reverse-geocode", {
      place: `${lat},${lon}`, type: "STOP", numResults: clamp(max, 1, 20)
    }, 15_000);
    if (!response.ok) throw new Error(data?.message || `Transitous dichtbij HTTP ${response.status}`);
    return asArray(data).map(normalizeMatch).filter(Boolean);
  }

  async function transitousStopTimes({
    stopId = "", lat, lon, radius = 120, max = 8,
    time = null, windowSeconds = null, direction = "LATER", minimumEvents = null,
    exactRadius = false, fetchStops = false, arriveBy = false, both = false, timeout = 12000
  }) {
    const params = {};
    const url = { searchParams: { set: (k, v) => { params[k] = v; } } };
    if (stopId) {
      url.searchParams.set("stopId", String(stopId));
    } else if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
      url.searchParams.set("center", `${Number(lat)},${Number(lon)}`);
      url.searchParams.set("radius", String(clamp(radius, 25, 2500)));
      url.searchParams.set("exactRadius", String(Boolean(exactRadius)));
    } else {
      throw new Error("Geen geldige halte of coördinaat beschikbaar.");
    }

    if (time) {
      const parsed = parseDate(time);
      if (parsed) url.searchParams.set("time", parsed.toISOString());
    }
    if (Number.isFinite(Number(windowSeconds)) && Number(windowSeconds) >= 0) {
      url.searchParams.set("window", String(Math.round(Number(windowSeconds))));
    }

    url.searchParams.set("n", String(clamp(minimumEvents ?? max, 1, 300)));
    url.searchParams.set("arriveBy", String(Boolean(arriveBy)));
    url.searchParams.set("both", String(Boolean(both)));
    url.searchParams.set("direction", String(direction || "LATER").toUpperCase() === "EARLIER" ? "EARLIER" : "LATER");
    url.searchParams.set("realtimeMode", "REALTIME");
    url.searchParams.set("language", "nl");
    url.searchParams.set("withAlerts", "true");
    if (fetchStops) url.searchParams.set("fetchStops", "true");

    const { response, data } = await transitousJson("stoptimes", params, 8_000, { timeout });
    if (!response.ok) throw new Error(data?.message || data?.error || `Transitous vertrekken HTTP ${response.status}`);
    const stopName = String(data?.place?.name || "");
    return {
      place: data?.place || null,
      previousPageCursor: String(data?.previousPageCursor || ""),
      nextPageCursor: String(data?.nextPageCursor || ""),
      departures: asArray(data?.stopTimes)
        .map(item => normalizeStopTime(item, stopName))
        .filter(item => item.plannedDeparture || item.realtimeDeparture)
        .slice(0, Math.max(1, Number(max) || 8))
    };
  }

  async function stopDeparturesWindow(stop, options = {}) {
    if (!stop || typeof stop !== "object") throw new Error("Geen halte geselecteerd.");
    const pastMinutes = clamp(options.pastMinutes ?? 5, 0, 60);
    const futureMinutes = clamp(options.futureMinutes ?? 180, 5, 360);
    const start = new Date(Date.now() - pastMinutes * 60_000);
    const end = new Date(Date.now() + futureMinutes * 60_000);
    const windowSeconds = Math.round((pastMinutes + futureMinutes) * 60);
    const stopId = String(stop.transitousId || stop.id || stop.stop || "");
    const lat = Number(stop.lat ?? stop.latitude);
    const lon = Number(stop.lon ?? stop.longitude ?? stop.lng);

    let result = null;
    if (stopId && !/^\d{1,3}-\d+$/.test(stopId)) {
      try {
        result = await transitousStopTimes({
          stopId,
          max: Number(options.max || 300),
          minimumEvents: 1,
          time: start,
          windowSeconds,
          direction: "LATER",
          fetchStops: false
        });
      } catch {}
    }
    if (!result && Number.isFinite(lat) && Number.isFinite(lon)) {
      result = await transitousStopTimes({
        lat, lon, radius: 130,
        max: Number(options.max || 300),
        minimumEvents: 1,
        time: start,
        windowSeconds,
        direction: "LATER",
        fetchStops: false
      });
    }
    if (!result) throw new Error("Vertrektijden voor deze halte konden niet worden geladen.");

    const departures = result.departures
      .filter(item => {
        const d = parseDate(item.realtimeDeparture || item.plannedDeparture);
        return d && d >= start && d <= end;
      })
      .sort((a, b) => {
        const da = parseDate(a.realtimeDeparture || a.plannedDeparture)?.getTime() || 0;
        const db = parseDate(b.realtimeDeparture || b.plannedDeparture)?.getTime() || 0;
        return da - db;
      });

    return {
      place: result.place,
      departures,
      range: { start: start.toISOString(), end: end.toISOString() },
      source: "transitous"
    };
  }


  function hasBackend() {
    return Boolean(API_BASE);
  }

  async function backendLiveTrip(tripId, line = "", options = {}) {
    if (!API_BASE) throw new Error("OVFlow-backend is niet geconfigureerd.");
    const id = String(tripId || "").trim();
    if (!id) throw new Error("Deze rit heeft geen trip-id.");
    const url = new URL(`${API_BASE}/api/v4/trips/live`);
    url.searchParams.set("tripId", id);
    if (line) url.searchParams.set("line", String(line));
    const { response, data } = await fetchJson(url, { timeout: options.timeout || 7000 });
    if (!response.ok) throw new Error(data?.message || `OVFlow live backend HTTP ${response.status}`);
    return data;
  }

  async function backendDelijnLineStops({ line, area = "", timeout = 5500 } = {}) {
    if (!API_BASE) throw new Error("OVFlow-backend is niet geconfigureerd.");
    const publicLine = String(line || "").trim();
    if (!publicLine) throw new Error("Lijnnummer ontbreekt.");
    const url = new URL(`${API_BASE}/api/v4/delijn/line-stops`);
    url.searchParams.set("line", publicLine);
    if (area) url.searchParams.set("area", String(area));
    const { response, data } = await fetchJson(url, { timeout });
    if (!response.ok || !data?.ok) throw new Error(data?.message || `OVFlow lijnhaltes HTTP ${response.status}`);
    return data;
  }

  async function backendVehiclePosition(tripId, line = "", options = {}) {
    if (!API_BASE) return null;
    const id = String(tripId || "").trim();
    if (!id) return null;
    const url = new URL(`${API_BASE}/api/v4/vehicle-position`);
    url.searchParams.set("tripId", id);
    if (line) url.searchParams.set("line", String(line));
    const { response, data } = await fetchJson(url, { timeout: options.timeout || 4500 });
    if (!response.ok || !data?.position || data.position.stale) return null;
    return data;
  }

  async function transitousTrip(tripId, options = {}) {
    const id = String(tripId || "").trim();
    if (!id) throw new Error("Deze rit heeft geen trip-id.");
    if (API_BASE) {
      try {
        const data = await backendLiveTrip(id, options.line || "", options);
        if (data?.trip) return data.trip;
      } catch (error) { console.warn("OVFlow backend trip fallback:", error.message); }
    }
    const params = {};
    const url = { searchParams: { set: (k, v) => { params[k] = v; } } };
    url.searchParams.set("tripId", id);
    url.searchParams.set("withScheduledSkippedStops", "true");
    // Live Trip needs the stop sequence first. The full encoded route geometry
    // can be very large for bus routes and used to block Safari's main thread
    // while decoding/projecting it. MOTIS keeps the stops when detailedLegs is
    // false, so OVFlow draws a lightweight stop-to-stop route instead.
    url.searchParams.set("detailedLegs", String(Boolean(options.detailedLegs ?? false)));
    url.searchParams.set("joinInterlinedLegs", "false");
    const timeout = Math.max(2500, Math.min(12000, Number(options.timeout || 6500)));
    const { response, data } = await transitousJson("trip", params, 15_000, { timeout });
    if (!response.ok) throw new Error(data?.message || data?.error || `Transitous rit HTTP ${response.status}`);
    return data;
  }

  function stopEventLeg(event, fallbackDeparture = {}) {
    const raw = event?.rawStopTime || event || {};
    const current = raw?.place || {};
    const previous = asArray(raw?.previousStops).filter(Boolean);
    const following = asArray(raw?.nextStops).filter(Boolean);
    const firstPlace = previous[0] || raw?.tripFrom || current;
    const finalPlace = following.at(-1) || raw?.tripTo || current;
    if (!current?.name || !firstPlace?.name || !finalPlace?.name) return null;

    // Build the complete trip order when both previousStops and nextStops are
    // available. When MOTIS only supplies one side, this gracefully becomes
    // the remaining portion of the trip instead of returning no Live Trip.
    const middle = [
      ...previous.slice(1),
      ...(firstPlace !== current ? [current] : []),
      ...following.slice(0, -1)
    ];

    return {
      mode: raw.mode || String(fallbackDeparture.mode || "BUS").toUpperCase(),
      from: firstPlace,
      to: finalPlace,
      startTime: firstPlace.departure || firstPlace.arrival || fallbackDeparture.realtimeDeparture || fallbackDeparture.plannedDeparture || null,
      endTime: finalPlace.arrival || finalPlace.departure || null,
      scheduledStartTime: firstPlace.scheduledDeparture || firstPlace.scheduledArrival || fallbackDeparture.plannedDeparture || null,
      scheduledEndTime: finalPlace.scheduledArrival || finalPlace.scheduledDeparture || null,
      intermediateStops: middle,
      tripId: raw.tripId || fallbackDeparture.tripId || "",
      tripShortName: raw.tripShortName || "",
      routeShortName: raw.routeShortName || fallbackDeparture.line || "",
      displayName: raw.displayName || fallbackDeparture.line || "",
      routeLongName: raw.routeLongName || "",
      headsign: raw.headsign || fallbackDeparture.destination || finalPlace.name || "",
      realTime: Boolean(raw.realTime ?? fallbackDeparture.realtime),
      cancelled: Boolean(raw.cancelled || raw.tripCancelled),
      agencyName: raw.agencyName || fallbackDeparture.operator || "",
      legGeometry: null
    };
  }

  async function transitousTripFromDeparture(departure, stop = {}, options = {}) {
    const tripId = String(departure?.tripId || "").trim();
    if (!tripId) throw new Error("Deze rit heeft geen trip-id.");

    const departureTime = parseDate(departure?.realtimeDeparture || departure?.plannedDeparture) || new Date();
    const stopId = String(departure?.stopId || stop?.transitousId || stop?.id || "");
    const lat = Number(departure?.stopLatitude ?? stop?.lat ?? stop?.latitude);
    const lon = Number(departure?.stopLongitude ?? stop?.lon ?? stop?.longitude ?? stop?.lng);
    const timeout = Math.max(2500, Math.min(6000, Number(options.timeout || 4200)));

    // 4.4.2: fetchStops=true kan een grote payload opleveren. Vraag daarom
    // maximaal een handvol gebeurtenissen op en probeer eerst alleen de
    // logische vertrekrichting. De oude code vroeg 2 × 24 events tegelijk op.
    async function loadBoard(direction, arriveBy, offsetMs) {
      const common = {
        max: 6,
        minimumEvents: 3,
        time: new Date(departureTime.getTime() + offsetMs),
        windowSeconds: 8 * 60,
        direction,
        arriveBy,
        fetchStops: true,
        timeout
      };
      // Kies precies één locator. Geen tweede netwerkcall binnen dezelfde
      // board lookup: dat was een verborgen bron van lange wachttijden.
      if (stopId && !/^\d{1,3}-\d+$/.test(stopId)) {
        try { return await transitousStopTimes({ ...common, stopId }); } catch { return null; }
      }
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        try { return await transitousStopTimes({ ...common, lat, lon, radius: 140 }); } catch { return null; }
      }
      return null;
    }

    const line = String(departure?.line || "").trim().toLowerCase();
    const findMatch = board => board?.departures?.find(item => String(item.tripId || "") === tripId)
      || board?.departures?.find(item => line && String(item.line || "").trim().toLowerCase() === line)
      || null;

    const board = await loadBoard("LATER", false, -90_000);
    const match = findMatch(board);

    if (!match) {
      throw new Error("De ritgegevens konden niet via de halte worden opgehaald.");
    }

    const raw = match.rawStopTime || null;
    if (!raw) throw new Error("De haltevolgorde van deze rit is tijdelijk niet beschikbaar.");

    const leg = stopEventLeg({ rawStopTime: raw }, departure);
    if (!leg || !Array.isArray(leg.intermediateStops)) {
      throw new Error("De volledige haltevolgorde van deze rit is tijdelijk niet beschikbaar.");
    }
    return { legs: [leg], source: "stoptimes-light-full-trip-fallback" };
  }

  async function stopDepartures(stopOrEntity, maybeStopNumber, maybeMax = 8) {
    let stop = null;
    let max = maybeMax;

    if (stopOrEntity && typeof stopOrEntity === "object") {
      stop = stopOrEntity;
      max = Number(maybeStopNumber || maybeMax || 8);
    } else {
      // Backwards compatibility for older calls. A De Lijn numeric identifier is
      // not a Transitous stop id, so coordinates are preferred by OVFlow 4.3.
      stop = { entity: String(stopOrEntity || ""), stop: String(maybeStopNumber || "") };
    }

    const ownId = String(stop.id || "");
    const backendKnows = /^\d{1,3}[-:/]\d+$/.test(ownId) || /^BE\.NMBS/i.test(ownId) || stop.type === "station" || stop.mode === "train";
    if (API_BASE && backendKnows) {
      try {
        const result = await backendStopDepartures(stop, max);
        if (result.departures.length) return result;
      } catch (error) { console.warn("OVFlow backend departures fallback:", error.message); }
    }

    const stopId = String(stop.transitousId || stop.id || "");
    const lat = Number(stop.lat ?? stop.latitude);
    const lon = Number(stop.lon ?? stop.longitude ?? stop.lng);

    let result = null;
    if (stopId && !/^\d{1,3}-\d+$/.test(stopId)) {
      try { result = await transitousStopTimes({ stopId, max }); } catch {}
    }
    if (!result && Number.isFinite(lat) && Number.isFinite(lon)) {
      result = await transitousStopTimes({ lat, lon, radius: 130, max });
    }
    if (!result) {
      throw new Error("Voor deze oude haltecode ontbreken coördinaten. Zoek de halte opnieuw in OVFlow 4.3.");
    }
    return { departures: result.departures, source: "transitous" };
  }

  async function nearbyStops({ lat, lon, radius = 2500, max = 12 }) {
    const latitude = Number(lat);
    const longitude = Number(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error("Ongeldige locatie.");

    if (API_BASE) {
      try { return await backendNearbyStops({lat: latitude, lon: longitude, radius, max}); }
      catch (error) { console.warn("OVFlow backend nearby fallback:", error.message); }
    }

    const candidates = await transitousReverseStops(latitude, longitude, Math.min(Math.max(max * 2, 8), 20));
    return candidates
      .map(stop => {
        const distanceMeters = Math.round(haversineMeters(latitude, longitude, stop.lat, stop.lon));
        return { ...stop, distanceMeters, distanceKm: distanceMeters / 1000 };
      })
      .filter(stop => stop.distanceMeters <= Number(radius || 2500))
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, max);
  }

  async function nearby({ lat, lon, radius = 2500, maxPlaces = 6, maxDepartures = 3 }) {
    const latitude = Number(lat);
    const longitude = Number(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error("Ongeldige locatie.");

    if (API_BASE) {
      try {
        const data=await backendRequest("/api/v4/nearby", {lat:latitude,lon:longitude,radius,maxPlaces,maxDepartures}, 15000);
        const places=asArray(data?.places).map(item=>{
          const p=normalizeBackendPlace(item);
          return p?{...p,departures:asArray(item.departures).map(dep=>normalizeBackendDeparture(dep,p.name)).filter(Boolean)}:null;
        }).filter(Boolean);
        return {...data,places,source:"ovflow-api"};
      }catch(error){console.warn("OVFlow nearby overview fallback:",error.message);}
    }

    // Eén compacte MOTIS-stoptimes call is de normale route. Dit is veel
    // zuiniger dan voor iedere halte een aparte request te doen.
    try {
      const board = await transitousStopTimes({
        lat: latitude,
        lon: longitude,
        radius: clamp(radius, 100, 2500),
        max: Math.min(30, Math.max(12, maxPlaces * maxDepartures * 2))
      });
      const grouped = new Map();

      for (const dep of board.departures) {
        const stopLat = Number(dep.stopLatitude);
        const stopLon = Number(dep.stopLongitude);
        const key = dep.stopId || `${dep.stopName}|${stopLat}|${stopLon}`;
        if (!key) continue;
        if (!grouped.has(key)) {
          const distanceMeters = Number.isFinite(stopLat) && Number.isFinite(stopLon)
            ? Math.round(haversineMeters(latitude, longitude, stopLat, stopLon))
            : null;
          grouped.set(key, {
            type: dep.mode === "train" ? "station" : "stop",
            mode: dep.mode || "bus",
            id: dep.stopId || key,
            transitousId: dep.stopId || "",
            name: dep.stopName || dep.origin || "Halte",
            operator: dep.operator || "Openbaar vervoer",
            distanceMeters,
            latitude: stopLat,
            longitude: stopLon,
            lat: stopLat,
            lon: stopLon,
            departures: []
          });
        }
        const group = grouped.get(key);
        if (group.departures.length < maxDepartures) group.departures.push(dep);
      }

      const places = [...grouped.values()]
        .filter(place => place.distanceMeters == null || place.distanceMeters <= radius)
        .sort((a, b) => (a.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.distanceMeters ?? Number.POSITIVE_INFINITY))
        .slice(0, maxPlaces);

      if (places.length) {
        return {
          ok: true,
          places,
          compatibility: "public",
          source: "Transitous / MOTIS",
          updatedAt: new Date().toISOString()
        };
      }
    } catch (error) {
      console.warn("OVFlow nearby board fallback:", error?.message || error);
    }

    // Fallback voor locaties waar de radius-query geen gebeurtenissen oplevert:
    // zoek de dichtstbijzijnde stops en laad alleen de eerste paar borden.
    const stops = await nearbyStops({ lat: latitude, lon: longitude, radius, max: Math.min(Math.max(maxPlaces * 2, 8), 16) });
    const selected = stops.slice(0, maxPlaces);
    const hydrated = await Promise.all(selected.map(async stop => {
      try {
        const result = await transitousStopTimes({ stopId: stop.transitousId || stop.id, max: maxDepartures });
        const departures = result.departures;
        const operatorNames = [...new Set(departures.map(dep => dep.operator).filter(Boolean))];
        const first = departures[0];
        return {
          type: first?.mode === "train" ? "station" : "stop",
          mode: first?.mode || stop.mode || "bus",
          id: stop.id, transitousId: stop.transitousId, name: stop.name,
          municipality: stop.municipality || "",
          operator: operatorNames.slice(0, 2).join(" · ") || "Openbaar vervoer",
          distanceMeters: stop.distanceMeters, latitude: stop.lat, longitude: stop.lon, lat: stop.lat, lon: stop.lon,
          departures
        };
      } catch {
        return {
          type: stop.mode === "train" ? "station" : "stop", mode: stop.mode || "bus",
          id: stop.id, transitousId: stop.transitousId, name: stop.name, municipality: stop.municipality || "", operator: "Openbaar vervoer",
          distanceMeters: stop.distanceMeters, latitude: stop.lat, longitude: stop.lon, lat: stop.lat, lon: stop.lon,
          departures: [], liveUnavailable: true
        };
      }
    }));

    return {
      ok: true,
      places: hydrated.sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, maxPlaces),
      compatibility: "public",
      source: "Transitous / MOTIS",
      updatedAt: new Date().toISOString()
    };
  }

  async function searchPlaces(query, max = 10, options = {}) {
    const q = String(query || "").trim();
    if (q.length < 2) return [];
    // De eigen server kent De Lijn-haltes en NMBS-stations; Transitous kent
    // daarnaast MIVB, TEC en adressen. Beide parallel, daarna samenvoegen.
    const types = options.stopsOnly ? "STOP" : "STOP,ADDRESS,PLACE";
    const [own, pub] = await Promise.allSettled([
      API_BASE ? backendSearchPlaces(q, max) : Promise.resolve([]),
      transitousGeocode(q, max, types)
    ]);
    const ownList = own.status === "fulfilled" ? own.value : [];
    const pubList = pub.status === "fulfilled" ? pub.value.filter(p => !p.raw?.country || p.raw.country === "BE") : [];
    if (!ownList.length && !pubList.length && own.status === "rejected" && pub.status === "rejected") {
      throw own.reason || pub.reason;
    }
    const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const out = [...ownList];
    for (const p of pubList) {
      // dubbele haltes/stations (zelfde naam, minder dan 400 m uit elkaar) overslaan
      const dup = out.some(o => norm(o.name) === norm(p.name) && haversineMeters(o.lat, o.lon, p.lat, p.lon) < 400);
      if (!dup) out.push(p);
    }
    const rank = p => p.type === "station" ? 0 : (p.type === "stop" ? 1 : p.type === "line" ? 3 : 2);
    return out.sort((a, b) => rank(a) - rank(b)).slice(0, Math.max(max, 12));
  }

  async function detect() {
    return {
      checked: true,
      v4: false,
      legacy: false,
      public: true,
      source: API_BASE ? "OVFlow backend + Transitous / MOTIS" : "Transitous / MOTIS"
    };
  }

  async function health() {
    // Do not generate a request every minute only to paint a green status dot.
    // Real feature calls surface their own network errors. navigator.onLine is
    // enough for this lightweight UI indicator and avoids 404 spam completely.
    return {
      ok: navigator.onLine !== false,
      mode: API_BASE ? "hybrid" : "public",
      source: API_BASE ? "OVFlow backend + Transitous / MOTIS" : "Transitous / MOTIS"
    };
  }

  window.OVFlowCore = {
    detect,
    health,
    stopDepartures,
    stopDeparturesWindow,
    nearby,
    nearbyStops,
    searchPlaces,
    fetchJson,
    transitousStopTimes,
    transitousTrip,
    transitousTripFromDeparture,
    backendLiveTrip,
    backendDelijnLineStops,
    backendVehiclePosition,
    planJourney,
    backendStopDepartures,
    backendNearbyStops,
    hasBackend
  };
})();
