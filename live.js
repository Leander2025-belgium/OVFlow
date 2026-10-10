(() => {
  "use strict";

  const cfg = window.OVFLOW_CONFIG || {};
  const API_BASE = String(cfg.API_BASE || "").replace(/\/$/, "");
  const PREFIX = "ovflow-live-page:";
  const $ = id => document.getElementById(id);
  const state = {
    payload: null, routes: [], routeIndex: 0, position: null, userPosition: null, geoWatchId: null, geoRequest: null, timer: null, loading: false,
    map: { instance: null, tile: null, routeLayer: null, routeLine: null, stopMarkers: [], busMarker: null, userMarker: null, routeKey: "", ready: false, failed: false, followBus: false, stopsVisible: true }
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

  function renderBase() {
    const p = state.payload;
    setText("lineBadge", p.line || "—");
    setText("destinationLabel", p.destination ? `Richting ${p.destination}` : `Lijn ${p.line || "—"}`);
    setText("routeLabel", p.stop?.name ? `Vanaf ${p.stop.name}` : "Live ritinformatie");
    setText("modeLabel", `${p.mode || "OV"} · LIVE BIJ`);
    const operatorChip = $("operatorChip");
    const operatorLabel = operatorChip?.querySelector("span");
    if (operatorLabel) operatorLabel.textContent = p.operator || "De Lijn";
    else setText("operatorChip", p.operator || "De Lijn");
    setText("departureTime", timeText(p.realtimeDeparture || p.plannedDeparture));
    const dep = new Date(p.realtimeDeparture || p.plannedDeparture || 0);
    const mins = Number.isFinite(dep.getTime()) ? Math.round((dep.getTime() - Date.now()) / 60000) : null;
    setText("departureMeta", mins !== null && mins > 0 ? `${p.realtime ? "Realtime" : "Gepland"} · over ${mins} min` : (p.realtime ? "Realtime vertrek" : "Dienstregeling"));
    const delay = Number(p.delayMinutes || 0);
    setText("delayValue", delay > 0 ? `+${delay} min` : delay < 0 ? `${delay} min` : "Op tijd");
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
      lat: num(stop?.latitude ?? stop?.lat),
      lon: num(stop?.longitude ?? stop?.lon),
      direction: String(stop?.richting || ""),
      plannedTime: stop?.plannedTime || stop?.departureTime || stop?.arrivalTime || stop?.doorkomsttijd || stop?.time || null
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
    const chip = $("shapeChip");
    if (!chip) return;
    const label = chip.querySelector(".shape-chip-label");
    if (label) label.textContent = text;
    else chip.textContent = text;
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

  function progressContext(route, reference = activeReference()) {
    const fallbackStart = Math.max(0, boardingIndex(route));
    if (!route?.stops?.length) return { startIndex: 0, nearestIndex: -1, pct: 0, passed: 0, source: "none" };
    if (!reference) return { startIndex: fallbackStart, nearestIndex: fallbackStart, pct: fallbackStart / Math.max(1, route.stops.length - 1) * 100, passed: fallbackStart, source: "boarding" };

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
          route._stableStartIndex = Math.max(route._stableStartIndex ?? 0, idx);
          return { startIndex: route._stableStartIndex, nearestIndex: idx, pct: idx / Math.max(1, route.stops.length - 1) * 100, passed: idx, source: "stopId" };
        }
      }
      const seq = Number(state.position.currentStopSequence);
      if (Number.isFinite(seq) && seq > 0 && seq <= route.stops.length + 3) {
        const idx = Math.max(fallbackStart, Math.min(route.stops.length - 1, Math.round(seq) - 1));
        route._stableStartIndex = Math.max(route._stableStartIndex ?? 0, idx);
        return { startIndex: route._stableStartIndex, nearestIndex: idx, pct: idx / Math.max(1, route.stops.length - 1) * 100, passed: idx, source: "sequence" };
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
      // 90 m instead of 60 m: a stop only disappears when we are clearly past it.
      if (stopDistance !== null && distance > stopDistance + 90) candidate = i + 1;
      else break;
    }
    candidate = Math.min(Math.max(fallbackStart, candidate), route.stops.length - 1);

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
    btn.textContent = available ? (userFallback ? "Volg mij" : "Volg voertuig") : "Wacht op locatie";
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
      setText("mapGpsAge", mins !== null && mins > 0 ? (mins <= 1 ? "Vertrekt zo" : `Live rond vertrek · ${mins} min`) : "Wachten op locatie");
      setFollowBusAvailability(false);
      return;
    }
    const ctx = progressContext(route, ref);
    const i = ctx.startIndex;
    setText("mapNearestStop", isUserFallback() ? `Jij · ${route.stops[i]?.name || "langs de route"}` : `Nu bij · ${route.stops[i]?.name || "—"}`);
    setText("mapNextStop", route.stops[i]?.name || "Eindhalte");
    setText("mapGpsAge", isUserFallback() ? "Jouw locatie" : ageText(state.position?.timestamp));
    setFollowBusAvailability(true, isUserFallback());
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
      state.map.routeLine = L.polyline(coords, { color: "#147be4", weight: 6, opacity: .86, lineJoin: "round", lineCap: "round", smoothFactor: 1 }).addTo(state.map.routeLayer);
      L.polyline(coords, { color: "#ffffff", weight: 2, opacity: .9, lineJoin: "round", lineCap: "round" }).addTo(state.map.routeLayer);
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
    if (state.map.followBus) map.setView(ll, Math.max(15, map.getZoom()));
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
      const clockSource = stop.plannedTime || preloadTime || (i === ctx.startIndex || i === boarding ? (state.payload.realtimeDeparture || state.payload.plannedDeparture) : null);
      const clock = clockSource ? timeText(clockSource) : "";
      // Live 3.0: never replace missing times with internal stop numbers (#40 etc.).
      // If De Lijn/GTFS does not provide a time for a stop, show an em dash instead.
      const timeLabel = clock && clock !== "—" ? clock : "—";
      const subtitle = i === route.stops.length - 1 ? "Eindhalte" : "";
      return `<div class="stop-row ${cls}" data-stop-index="${i}">
        <div class="stop-time">${esc(timeLabel)}${i === ctx.startIndex && clock && clock !== "—" ? `<small>Nu</small>` : ""}</div>
        <div class="stop-track"><div class="stop-dot"></div></div>
        <div class="stop-main"><strong>${esc(stop.name)}</strong>${subtitle ? `<small>${esc(subtitle)}</small>` : ""}</div>
        <div class="stop-end">${extra ? `<span class="stop-extra">${esc(extra)}</span>` : ""}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></div>
      </div>`;
    }).join("");
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
      updateBusOnMap();
      if (route) renderRoutes();
      return;
    }

    if (fallback) {
      dot.className = "gps-dot fallback";
      details.classList.add("hidden");
      setText("vehicleId", "Jouw locatie");
      setText("vehicleAge", ageText(state.userPosition?.timestamp));
      setText("positionSource", "Geen bus-GPS · voortgang wordt geschat met jouw telefoonlocatie");
    } else {
      dot.className = "gps-dot live";
      details.classList.remove("hidden");
      setText("vehicleId", pos.vehicleId || "Live");
      setText("vehicleAge", ageText(pos.timestamp));
      setText("coordinates", `${Number(pos.lat).toFixed(5)}, ${Number(pos.lon).toFixed(5)}`);
      setText("bearingValue", bearingText(pos.bearing));
      setText("positionSource", `Exacte GPS · De Lijn GTFS Realtime · ${ageText(pos.timestamp)}`);
    }

    if (route && ref) {
      const ctx = progressContext(route, ref);
      setText("nearestStop", route.stops[ctx.startIndex]?.name || "—");
      const nextIdx = Math.min(route.stops.length - 1, ctx.startIndex + (state.position ? 1 : 0));
      setText("nextStop", route.stops[nextIdx]?.name || "Eindhalte");
      $("routeProgress").style.width = `${ctx.pct}%`;
      renderRoutes();
    }
    updateBusOnMap();
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
    $("fitRouteButton")?.addEventListener("click", () => { state.map.followBus = false; fitRoute(); });
    $("followBusButton")?.addEventListener("click", () => {
      const pos = activeReference();
      if (!pos || !Number.isFinite(Number(pos.lat)) || !Number.isFinite(Number(pos.lon))) return;
      state.map.followBus = true;
      if (state.map.instance) state.map.instance.setView([Number(pos.lat), Number(pos.lon)], 15);
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
    $("backButton").addEventListener("click", () => history.length > 1 ? history.back() : location.assign("index.html"));
    $("refreshButton").addEventListener("click", refreshAll);
    $("retryButton").addEventListener("click", refreshAll);
    refreshAll();
    const interval = Math.max(10000, Number(cfg.AUTO_REFRESH_MS || 15000));
    state.timer = setInterval(() => { if (!document.hidden) fetchVehicle().then(() => setText("lastUpdated", `Live ${timeText(new Date())}`)); }, interval);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) fetchVehicle(); });
    window.addEventListener("pagehide", () => {
      if (state.timer) clearInterval(state.timer);
      if (state._routeRecoveryTimer) clearTimeout(state._routeRecoveryTimer);
      if (state.geoWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(state.geoWatchId);
    });
  }

  setup();
})();
