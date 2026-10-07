(() => {
  "use strict";

  /*
   * OVFlow 4.4 hybrid public-data client
   *
   * Important design rule: the browser must work on static hosting too.
   * Therefore this client does NOT probe /api/* endpoints by default.
   * Transitous/MOTIS is used directly for Belgian stop search, departures,
   * nearby places and journey data. iRail stays available in planner.js for
   * NMBS vehicle details.
   */

  const cfg = window.OVFLOW_CONFIG || {};
  const TRANSITOUS_BASE = String(cfg.TRANSITOUS_BASE || "https://api.transitous.org").replace(/\/$/, "");
  const API_BASE = String(cfg.API_BASE || "").trim().replace(/\/$/, "");
  const JSON_HEADERS = { Accept: "application/json" };
  const cache = new Map();

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
    return {
      type: String(match.type || "STOP").toUpperCase() === "STOP" ? "stop" : "place",
      mode: modeFromTransitous("", modes),
      id,
      transitousId: id,
      name: String(match.name || "Onbekende halte"),
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

  async function transitousGeocode(query, max = 10) {
    const url = new URL(`${TRANSITOUS_BASE}/api/v1/geocode`);
    url.searchParams.set("text", query);
    url.searchParams.set("type", "STOP");
    url.searchParams.set("numResults", String(clamp(max, 1, 20)));
    url.searchParams.set("language", "nl");
    const { response, data } = await cachedJson(url, 45_000);
    if (!response.ok) throw new Error(data?.message || `Transitous zoeken HTTP ${response.status}`);
    return asArray(data).map(normalizeMatch).filter(Boolean);
  }

  async function transitousReverseStops(lat, lon, max = 8) {
    const url = new URL(`${TRANSITOUS_BASE}/api/v1/reverse-geocode`);
    url.searchParams.set("place", `${lat},${lon}`);
    url.searchParams.set("type", "STOP");
    url.searchParams.set("numResults", String(clamp(max, 1, 20)));
    const { response, data } = await cachedJson(url, 15_000);
    if (!response.ok) throw new Error(data?.message || `Transitous dichtbij HTTP ${response.status}`);
    return asArray(data).map(normalizeMatch).filter(Boolean);
  }

  async function transitousStopTimes({
    stopId = "", lat, lon, radius = 120, max = 8,
    time = null, windowSeconds = null, direction = "LATER", minimumEvents = null,
    exactRadius = false, fetchStops = false, arriveBy = false, both = false, timeout = 12000
  }) {
    const url = new URL(`${TRANSITOUS_BASE}/api/v6/stoptimes`);
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

    const { response, data } = await cachedJson(url, 8_000, { timeout });
    if (!response.ok) throw new Error(data?.message || `Transitous vertrekken HTTP ${response.status}`);
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
    const url = new URL(`${TRANSITOUS_BASE}/api/v6/trip`);
    url.searchParams.set("tripId", id);
    url.searchParams.set("withScheduledSkippedStops", "true");
    // Live Trip needs the stop sequence first. The full encoded route geometry
    // can be very large for bus routes and used to block Safari's main thread
    // while decoding/projecting it. MOTIS keeps the stops when detailedLegs is
    // false, so OVFlow draws a lightweight stop-to-stop route instead.
    url.searchParams.set("detailedLegs", String(Boolean(options.detailedLegs ?? false)));
    url.searchParams.set("joinInterlinedLegs", "false");
    const timeout = Math.max(2500, Math.min(12000, Number(options.timeout || 6500)));
    const { response, data } = await cachedJson(url, 15_000, { timeout });
    if (!response.ok) throw new Error(data?.message || `Transitous rit HTTP ${response.status}`);
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

  async function searchPlaces(query, max = 10) {
    const q = String(query || "").trim();
    if (q.length < 2) return [];
    return transitousGeocode(q, max);
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
    hasBackend
  };
})();
