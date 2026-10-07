(() => {
  "use strict";

  const cfg = window.OVFLOW_CONFIG || {};
  const API_BASE = String(cfg.API_BASE || "").replace(/\/$/, "");
  const PREFIX = "ovflow-live-page:";
  const $ = id => document.getElementById(id);
  const state = { payload: null, routes: [], routeIndex: 0, position: null, timer: null, loading: false };

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
    setText("departureMeta", p.realtime ? "Realtime vertrek" : "Dienstregeling");
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
  }

  function currentRoute() { return state.routes[state.routeIndex] || null; }

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
      return `<div class="stop-row ${cls}">
        <div class="stop-dot">${i + 1}</div>
        <div class="stop-main"><strong>${esc(stop.name)}</strong><small>${esc(stop.direction || route.directionName || "")}</small></div>
        <div class="stop-extra">${extra}</div>
      </div>`;
    }).join("");
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
      dot.className = "gps-dot offline";
      details.classList.add("hidden");
      $("vehicleState").innerHTML = `<div class="vehicle-orb">⌁</div><div><strong>Exacte positie niet beschikbaar</strong><span>${esc(message || "OVFlow probeert opnieuw bij de volgende refresh.")}</span></div>`;
      setText("vehicleId", "—");
      setText("vehicleAge", "Geen GPS-fix");
      setText("positionSource", "Haltevolgorde beschikbaar · exacte GPS is optioneel");
      $("routeProgress").style.width = "0%";
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
