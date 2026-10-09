(() => {
  "use strict";

  const cfg = window.OVFLOW_CONFIG || {};
  const API_BASE = String(cfg.API_BASE || "").replace(/\/$/, "");
  const PREFIX = "ovflow-live-page:";
  const $ = id => document.getElementById(id);
  const state = {
    payload: null, routes: [], routeIndex: 0, position: null, timer: null, loading: false,
    map: { instance: null, tile: null, routeLayer: null, routeLine: null, stopMarkers: [], busMarker: null, routeKey: "", ready: false, failed: false, followBus: false }
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

  async function getJson(url, timeout = 6500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
      return data;
    } finally { clearTimeout(timer); }
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
    setText("operatorChip", p.operator || "De Lijn / OVFlow");
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
    setText("realtimeChip", p.cancelled ? "Geannuleerd" : p.realtime ? "● Realtime" : "Dienstregeling");
  }

  function compactApiStop(stop, index) {
    return {
      index: Number(stop?.index || index + 1),
      name: String(stop?.name || stop?.omschrijvingLang || stop?.omschrijving || `Halte ${index + 1}`),
      stopId: String(stop?.haltenummer || stop?.stopId || ""),
      lat: num(stop?.latitude ?? stop?.lat),
      lon: num(stop?.longitude ?? stop?.lon),
      direction: String(stop?.richting || "")
    };
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
      return getJson(url, 7000);
    }

    let data;
    try { data = await request(p.area || p.stop?.municipality || ""); }
    catch (firstError) {
      if (p.area || p.stop?.municipality) data = await request("");
      else throw firstError;
    }

    const routes = (Array.isArray(data?.routes) ? data.routes : []).map(route => ({
      ...route,
      stops: (Array.isArray(route.stops) ? route.stops : []).map(compactApiStop).filter(s => s.name)
    })).filter(r => r.stops.length >= 2);
    if (!routes.length) throw new Error("Geen haltevolgorde gevonden voor deze lijn.");
    state.routes = routes;
    state.routeIndex = routes.map(scoreRoute).reduce((best, score, i, arr) => score > arr[best] ? i : best, 0);
    renderRoutes();
    fetchExactShape().catch(() => {});
  }

  function currentRoute() { return state.routes[state.routeIndex] || null; }

  function setShapeChip(text, stateName = "") {
    const chip = $("shapeChip");
    if (!chip) return;
    chip.textContent = text;
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
    return getJson(url, 12000);
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
    const safe = ["normal", "boarding", "current", "start", "end"].includes(kind) ? kind : "normal";
    const size = safe === "normal" ? 10 : safe === "start" || safe === "end" ? 16 : 20;
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

  function setFollowBusAvailability(available) {
    const btn = $("followBusButton");
    if (!btn) return;
    btn.disabled = !available;
    btn.classList.toggle("disabled", !available);
    btn.textContent = available ? "Volg voertuig" : "Wacht op GPS";
  }

  function updateMapSummary() {
    const route = currentRoute();
    const pos = state.position;
    if (!route || !pos) {
      const mins = minutesUntilDeparture();
      const boarding = route ? boardingIndex(route) : -1;
      const startName = boarding >= 0 ? route.stops[boarding]?.name : route?.stops?.[0]?.name;
      if (mins !== null && mins > 0) {
        setText("mapNearestStop", "Voertuig nog niet gestart");
        setText("mapNextStop", startName || "—");
        setText("mapGpsAge", mins <= 1 ? "Vertrekt zo" : `Live rond vertrek · ${mins} min`);
      } else {
        setText("mapNearestStop", "Positie niet beschikbaar");
        setText("mapNextStop", startName || "—");
        setText("mapGpsAge", "Wachten op GPS");
      }
      setFollowBusAvailability(false);
      return;
    }
    const i = nearestVehicleIndex(route, pos);
    setText("mapNearestStop", i >= 0 ? route.stops[i].name : "—");
    setText("mapNextStop", i >= 0 && i + 1 < route.stops.length ? route.stops[i + 1].name : "Eindhalte");
    setText("mapGpsAge", ageText(pos.timestamp));
  }

  function updateMapHighlights() {
    const route = currentRoute();
    if (!state.map.ready || !route) return;
    const boarding = boardingIndex(route);
    const vehicle = nearestVehicleIndex(route, state.position);
    state.map.stopMarkers.forEach((marker, i) => {
      if (!marker?.setIcon) return;
      const kind = i === vehicle ? "current" : i === boarding ? "boarding" : i === 0 ? "start" : i === route.stops.length - 1 ? "end" : "normal";
      marker.setIcon(stopIcon(kind));
      marker.setZIndexOffset(i === vehicle ? 500 : i === boarding ? 300 : (kind === "start" || kind === "end" ? 180 : 0));
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
    route.stops.forEach((stop, i) => {
      if (!Number.isFinite(Number(stop.lat)) || !Number.isFinite(Number(stop.lon))) {
        state.map.stopMarkers.push(null);
        return;
      }
      const kind = i === boarding ? "boarding" : i === 0 ? "start" : i === route.stops.length - 1 ? "end" : "normal";
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
    const pos = state.position;
    if (!pos || !Number.isFinite(Number(pos.lat)) || !Number.isFinite(Number(pos.lon))) {
      if (state.map.busMarker) {
        map.removeLayer(state.map.busMarker);
        state.map.busMarker = null;
      }
      updateMapSummary();
      return;
    }
    const ll = [Number(pos.lat), Number(pos.lon)];
    if (!state.map.busMarker) {
      state.map.busMarker = L.marker(ll, { icon: busIcon(pos.bearing), zIndexOffset: 1000, keyboard: false }).addTo(map);
      state.map.busMarker.bindTooltip(`Voertuig ${esc(pos.vehicleId || "live")}`, { direction: "top", className: "ov-tooltip", offset: [0, -16] });
    } else {
      state.map.busMarker.setLatLng(ll);
      state.map.busMarker.setIcon(busIcon(pos.bearing));
      state.map.busMarker.setTooltipContent(`Voertuig ${esc(pos.vehicleId || "live")} · ${esc(ageText(pos.timestamp))}`);
    }
    setFollowBusAvailability(true);
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
    tabs.innerHTML = state.routes.map((r, i) => `<button type="button" class="direction-tab ${i === state.routeIndex ? "active" : ""}" data-route-index="${i}">${esc(r.directionName || r.directionCode || `Richting ${i+1}`)}</button>`).join("");
    tabs.querySelectorAll("[data-route-index]").forEach(btn => btn.addEventListener("click", () => {
      state.routeIndex = Number(btn.dataset.routeIndex);
      renderRoutes();
      fetchExactShape().catch(() => {});
      renderVehicle();
    }));

    setText("stopCount", String(route.stops.length));
    setText("directionValue", route.directionName || route.directionCode || "—");
    setText("routeLabel", route.description || route.directionName || state.payload.destination || `Lijn ${state.payload.line}`);
    setText("stopsStatus", `${route.stops.length} haltes`);

    const boarding = boardingIndex(route);
    const vehicle = nearestVehicleIndex(route, state.position);
    $("stopsList").innerHTML = route.stops.map((stop, i) => {
      const cls = [i === boarding ? "boarding" : "", i === vehicle ? "current" : ""].filter(Boolean).join(" ");
      const extra = i === vehicle ? "Voertuig hier" : i === boarding ? "Jouw halte" : stop.stopId ? `#${esc(stop.stopId)}` : "";
      return `<div class="stop-row ${cls}" data-stop-index="${i}">
        <div class="stop-dot">${i + 1}</div>
        <div class="stop-main"><strong>${esc(stop.name)}</strong><small>${esc(stop.direction || route.directionName || "")}</small></div>
        <div class="stop-extra">${extra}</div>
      </div>`;
    }).join("");
    renderMapRoute();
  }

  async function fetchVehicle() {
    const p = state.payload;
    if (!API_BASE || !p.tripId) {
      state.position = null;
      renderVehicle("Voor dit vertrek is geen trip-ID beschikbaar. De volledige haltevolgorde blijft wel zichtbaar.");
      return;
    }
    try {
      const url = new URL(`${API_BASE}/api/v4/vehicle-position`);
      url.searchParams.set("tripId", p.tripId);
      if (p.line) url.searchParams.set("line", p.line);
      const data = await getJson(url, 5500);
      state.position = data?.position && !data.position.stale ? data.position : null;
      renderVehicle(state.position ? "" : "De Lijn levert voor deze rit momenteel geen exacte voertuigpositie.");
    } catch (error) {
      state.position = null;
      renderVehicle(`Live GPS tijdelijk niet bereikbaar: ${error.message}`);
    }
  }

  function renderVehicle(message = "") {
    const pos = state.position;
    const route = currentRoute();
    const dot = $("gpsDot");
    const details = $("vehicleDetails");
    if (!pos) {
      const mins = minutesUntilDeparture();
      const pre = mins !== null && mins > 0;
      dot.className = "gps-dot offline";
      details.classList.add("hidden");
      if (pre) {
        const when = mins <= 1 ? "Vertrekt zo" : `Vertrek over ${mins} min`;
        $("vehicleState").innerHTML = `<div class="vehicle-orb waiting">◷</div><div><strong>Voertuig nog niet gestart</strong><span>${esc(when)} · live positie verschijnt zodra De Lijn GPS doorstuurt.</span></div>`;
        setText("vehicleAge", mins <= 1 ? "Vertrekt zo" : `Nog ${mins} min`);
        setText("positionSource", "Rit staat gepland · live GPS volgt rond vertrek");
      } else {
        $("vehicleState").innerHTML = `<div class="vehicle-orb">⌁</div><div><strong>Exacte positie niet beschikbaar</strong><span>${esc(message || "OVFlow probeert opnieuw bij de volgende refresh.")}</span></div>`;
        setText("vehicleAge", "Wachten op GPS");
        setText("positionSource", "Haltevolgorde beschikbaar · exacte GPS is optioneel");
      }
      setText("vehicleId", "—");
      setFollowBusAvailability(false);
      $("routeProgress").style.width = "0%";
      updateBusOnMap();
      if (route) renderRoutes();
      return;
    }

    dot.className = "gps-dot live";
    details.classList.remove("hidden");
    $("vehicleState").innerHTML = `<div class="vehicle-orb">●</div><div><strong>Voertuig live gevonden</strong><span>De Lijn GTFS Realtime · ${esc(ageText(pos.timestamp))}</span></div>`;
    setText("vehicleId", pos.vehicleId || "Live");
    setText("vehicleAge", ageText(pos.timestamp));
    setText("coordinates", `${Number(pos.lat).toFixed(5)}, ${Number(pos.lon).toFixed(5)}`);
    setText("bearingValue", bearingText(pos.bearing));
    setText("positionSource", `Exacte GPS · bron: De Lijn GTFS Realtime · ${ageText(pos.timestamp)}`);

    if (route) {
      const i = nearestVehicleIndex(route, pos);
      setText("nearestStop", i >= 0 ? route.stops[i].name : "—");
      setText("nextStop", i >= 0 && i + 1 < route.stops.length ? route.stops[i + 1].name : "Eindhalte");
      const pct = i < 0 ? 0 : Math.max(0, Math.min(100, (i / Math.max(1, route.stops.length - 1)) * 100));
      $("routeProgress").style.width = `${pct}%`;
      renderRoutes();
    }
    updateBusOnMap();
  }

  async function refreshAll() {
    if (state.loading) return;
    state.loading = true;
    clearError();
    $("refreshButton").textContent = "…";
    try {
      if (!state.routes.length) await fetchRoutes();
      await fetchVehicle();
      setText("lastUpdated", `Bijgewerkt ${new Intl.DateTimeFormat("nl-BE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date())}`);
    } catch (error) {
      showError("Live informatie kon niet volledig laden", error?.message || String(error));
      if (state.payload.preloadedStops.length >= 2 && !state.routes.length) {
        state.routes = [{ directionCode: "RIT", directionName: state.payload.destination || "Rit", publicLine: state.payload.line, stops: state.payload.preloadedStops.map(compactApiStop) }];
        renderRoutes();
      }
    } finally {
      state.loading = false;
      $("refreshButton").textContent = "↻";
    }
  }

  function setup() {
    state.payload = readPayload();
    renderBase();
    initMap();
    $("fitRouteButton")?.addEventListener("click", () => { state.map.followBus = false; fitRoute(); });
    $("followBusButton")?.addEventListener("click", () => {
      const pos = state.position;
      if (!pos || !Number.isFinite(Number(pos.lat)) || !Number.isFinite(Number(pos.lon))) return;
      state.map.followBus = true;
      if (state.map.instance) state.map.instance.setView([Number(pos.lat), Number(pos.lon)], 15);
    });
    $("backButton").addEventListener("click", () => history.length > 1 ? history.back() : location.assign("index.html"));
    $("refreshButton").addEventListener("click", refreshAll);
    $("retryButton").addEventListener("click", refreshAll);
    refreshAll();
    const interval = Math.max(10000, Number(cfg.AUTO_REFRESH_MS || 15000));
    state.timer = setInterval(() => { if (!document.hidden) fetchVehicle().then(() => setText("lastUpdated", `Live ${timeText(new Date())}`)); }, interval);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) fetchVehicle(); });
    window.addEventListener("pagehide", () => { if (state.timer) clearInterval(state.timer); });
  }

  setup();
})();
