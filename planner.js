(() => {
  "use strict";

  const bridge = window.OVFlowBridge;
  const $ = s => document.querySelector(s);

  if (!bridge) {
    console.error("OVFlowBridge ontbreekt.");
    return;
  }

  const API = "https://api.transitous.org/api/v6/plan";

  const planner = {
    from: null,
    to: null,
    mode: "now",
    pref: "fastest",
    geolocationOrigin: false,
    loading: false,
    lastQuery: null,
    itineraries: []
  };

  const esc = bridge.escapeHTML || (v => String(v ?? ""));
  const toast = bridge.toast || console.log;

  function setDefaultDateTime() {
    const now = new Date();
    const pad = n => String(n).padStart(2, "0");
    $("#plannerDate").value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    $("#plannerTime").value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  function displayStopName(stop) {
    if (!stop) return "";
    return [stop.municipality, stop.name].filter(Boolean).join(" · ");
  }

  function createSearch(inputSel, resultsSel, side) {
    const input = $(inputSel);
    const box = $(resultsSel);
    let timer;

    input.addEventListener("input", () => {
      if (side === "from") {
        planner.from = null;
        planner.geolocationOrigin = false;
      } else {
        planner.to = null;
      }

      clearTimeout(timer);
      const q = input.value.trim();

      if (q.length < 2) {
        box.classList.add("hidden");
        return;
      }

      timer = setTimeout(async () => {
        try {
          await bridge.ensureStopsLoaded();
          renderSuggestions(box, bridge.searchStops(q).slice(0, 10), side);
        } catch (e) {
          box.innerHTML = `
            <div class="planner-suggestion">
              <span class="planner-suggestion-icon">!</span>
              <span>
                <strong>Zoeken mislukt</strong>
                <small>${esc(e.message || "Haltes konden niet worden geladen")}</small>
              </span>
            </div>`;
          box.classList.remove("hidden");
        }
      }, 180);
    });

    input.addEventListener("focus", async () => {
      const q = input.value.trim();
      if (q.length < 2) return;
      try {
        await bridge.ensureStopsLoaded();
        renderSuggestions(box, bridge.searchStops(q).slice(0, 10), side);
      } catch {}
    });
  }

  function renderSuggestions(box, stops, side) {
    if (!stops.length) {
      box.innerHTML = `
        <div class="planner-suggestion">
          <span class="planner-suggestion-icon">?</span>
          <span>
            <strong>Geen halte gevonden</strong>
            <small>Probeer een andere plaats of haltenaam.</small>
          </span>
        </div>`;
      box.classList.remove("hidden");
      return;
    }

    box.innerHTML = stops.map((s, i) => `
      <button class="planner-suggestion" type="button" data-i="${i}">
        <span class="planner-suggestion-icon">H</span>
        <span>
          <strong>${esc(s.name)}</strong>
          <small>${esc([s.municipality, s.street].filter(Boolean).join(" · ") || `halte ${s.stop || ""}`)}</small>
        </span>
      </button>`).join("");

    box.classList.remove("hidden");

    [...box.querySelectorAll("[data-i]")].forEach(btn => {
      btn.addEventListener("click", () => {
        chooseStop(side, stops[Number(btn.dataset.i)]);
        box.classList.add("hidden");
      });
    });
  }

  function chooseStop(side, stop) {
    const normalized = {
      name: stop.name || "",
      municipality: stop.municipality || "",
      street: stop.street || "",
      stop: String(stop.stop || ""),
      entity: String(stop.entity || ""),
      lon: Number(stop.lon),
      lat: Number(stop.lat)
    };

    if (!Number.isFinite(normalized.lon) || !Number.isFinite(normalized.lat)) {
      toast("Deze halte heeft geen geldige coördinaten");
      return;
    }

    planner[side] = normalized;
    $(side === "from" ? "#plannerFrom" : "#plannerTo").value = displayStopName(normalized);
  }

  function haversine(lon1, lat1, lon2, lat2) {
    const R = 6371;
    const rad = v => v * Math.PI / 180;
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function useLocation() {
    if (!navigator.geolocation) {
      toast("Locatie wordt niet ondersteund");
      return;
    }

    $("#plannerFrom").value = "Dichtstbijzijnde halte zoeken…";

    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        await bridge.ensureStopsLoaded();
        const lon = pos.coords.longitude;
        const lat = pos.coords.latitude;

        const nearest = bridge.getStops()
          .map(s => ({ ...s, d: haversine(lon, lat, s.lon, s.lat) }))
          .sort((a, b) => a.d - b.d)[0];

        if (!nearest) throw new Error("Geen halte gevonden");

        chooseStop("from", nearest);

        // De echte locatie wordt gebruikt als beginpunt, zodat de wandelroute
        // naar de halte automatisch in het reisadvies kan zitten.
        planner.from.routeLat = lat;
        planner.from.routeLon = lon;
        planner.from.walkKm = nearest.d;
        planner.geolocationOrigin = true;
        toast(`Vertrek vanaf je locatie via ${nearest.name}`);
      } catch (e) {
        $("#plannerFrom").value = "";
        toast(e.message || "Locatie kon niet worden gebruikt");
      }
    }, () => {
      $("#plannerFrom").value = "";
      toast("Locatie kon niet worden bepaald");
    }, {
      enableHighAccuracy: true,
      timeout: 10000
    });
  }

  function swapStops() {
    [planner.from, planner.to] = [planner.to, planner.from];

    const a = $("#plannerFrom").value;
    const b = $("#plannerTo").value;
    $("#plannerFrom").value = b;
    $("#plannerTo").value = a;

    planner.geolocationOrigin = false;

    if (planner.from) {
      delete planner.from.routeLat;
      delete planner.from.routeLon;
    }
    if (planner.to) {
      delete planner.to.routeLat;
      delete planner.to.routeLon;
    }
  }

  function getDateTime() {
    if (planner.mode === "now") return new Date();

    const date = $("#plannerDate").value;
    const time = $("#plannerTime").value;
    if (!date || !time) return null;

    const dt = new Date(`${date}T${time}:00`);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  function validate() {
    $("#plannerError").classList.add("hidden");

    if (!planner.from) {
      toast("Kies eerst een vertrekhalte uit de zoekresultaten");
      $("#plannerFrom").focus();
      return null;
    }

    if (!planner.to) {
      toast("Kies eerst een bestemmingshalte uit de zoekresultaten");
      $("#plannerTo").focus();
      return null;
    }

    if (haversine(planner.from.lon, planner.from.lat, planner.to.lon, planner.to.lat) < 0.04) {
      toast("Vertrek en bestemming zijn vrijwel dezelfde halte");
      return null;
    }

    const dt = getDateTime();
    if (!dt) {
      toast("Kies een geldige datum en tijd");
      return null;
    }

    return dt;
  }

  function apiDateTime(dt) {
    return dt.toISOString();
  }

  function buildRequest(dt) {
    const fromLat = Number(planner.from.routeLat ?? planner.from.lat);
    const fromLon = Number(planner.from.routeLon ?? planner.from.lon);
    const toLat = Number(planner.to.lat);
    const toLon = Number(planner.to.lon);

    const url = new URL(API);
    url.searchParams.set("fromPlace", `${fromLat},${fromLon}`);
    url.searchParams.set("toPlace", `${toLat},${toLon}`);
    url.searchParams.set("time", apiDateTime(dt));
    url.searchParams.set("arriveBy", planner.mode === "arrive" ? "true" : "false");
    url.searchParams.set("transitModes", "TRANSIT");
    url.searchParams.set("directModes", "WALK");
    url.searchParams.set("maxTransfers", planner.pref === "fewest" ? "2" : "4");
    url.searchParams.set("minTransferTime", "2");
    url.searchParams.set("numItineraries", "8");
    url.searchParams.set("radius", "700");
    url.searchParams.set("detailedLegs", "true");
    url.searchParams.set("detailedTransfers", "true");
    url.searchParams.set("useRoutedTransfers", "true");
    url.searchParams.set("maxPreTransitTime", "1200");
    url.searchParams.set("maxPostTransitTime", "1200");
    url.searchParams.set("maxDirectTime", "1800");
    url.searchParams.set("fastestDirectFactor", "10");
    url.searchParams.set("realtimeMode", "REALTIME");
    url.searchParams.set("language", "nl");
    url.searchParams.set("algorithm", "PONG");
    return url;
  }

  function asDate(value) {
    if (value == null) return null;

    if (typeof value === "number") {
      const ms = value > 1e12 ? value : value * 1000;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    if (/^\d+$/.test(String(value))) {
      const n = Number(value);
      const ms = n > 1e12 ? n : n * 1000;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function timeText(value) {
    const d = asDate(value);
    if (!d) return "--:--";
    return new Intl.DateTimeFormat("nl-BE", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(d);
  }

  function minutes(value) {
    const n = Number(value || 0);
    return Math.max(0, Math.round(n / 60));
  }

  function modeLabel(mode) {
    const labels = {
      WALK: "Lopen",
      BUS: "Bus",
      TRAM: "Tram",
      SUBWAY: "Metro",
      SUBURBAN: "Trein",
      REGIONAL_RAIL: "Trein",
      REGIONAL_FAST_RAIL: "Trein",
      LONG_DISTANCE: "Trein",
      HIGHSPEED_RAIL: "Trein",
      RAIL: "Trein",
      FERRY: "Veerboot"
    };
    return labels[String(mode || "").toUpperCase()] || String(mode || "OV");
  }

  function modeIcon(mode) {
    const m = String(mode || "").toUpperCase();
    if (m === "WALK") return "🚶";
    if (m === "BUS") return "🚌";
    if (m === "TRAM") return "🚋";
    if (m === "SUBWAY") return "Ⓜ";
    if (m.includes("RAIL") || m === "SUBURBAN") return "🚆";
    if (m === "FERRY") return "⛴";
    return "●";
  }

  function stopName(obj, fallback = "") {
    if (!obj) return fallback;
    return obj.name || obj.stop?.name || obj.displayName || fallback;
  }

  function decodePolyline(encoded, precision = 6) {
    if (!encoded || typeof encoded !== "string") return [];
    let index = 0;
    let lat = 0;
    let lon = 0;
    const factor = 10 ** precision;
    const coordinates = [];

    while (index < encoded.length) {
      let result = 0;
      let shift = 0;
      let b;

      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && index <= encoded.length);

      const dLat = (result & 1) ? ~(result >> 1) : (result >> 1);
      lat += dLat;

      result = 0;
      shift = 0;

      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && index <= encoded.length);

      const dLon = (result & 1) ? ~(result >> 1) : (result >> 1);
      lon += dLon;

      coordinates.push([lon / factor, lat / factor]);
    }

    return coordinates;
  }

  function geometryForLeg(leg) {
    const encoded =
      leg?.legGeometry?.points ||
      leg?.geometry?.points ||
      leg?.polyline ||
      null;

    if (typeof encoded === "string") {
      try {
        return decodePolyline(encoded, 6);
      } catch {
        return [];
      }
    }

    if (Array.isArray(leg?.legGeometry?.coordinates)) {
      return leg.legGeometry.coordinates.map(p => [Number(p[0]), Number(p[1])]);
    }

    return [];
  }

  function normalizeLeg(leg) {
    const mode = String(leg.mode || "WALK").toUpperCase();
    const from = stopName(leg.from, "Vertrek");
    const to = stopName(leg.to, "Bestemming");
    const line =
      leg.routeShortName ||
      leg.route?.shortName ||
      leg.displayName ||
      leg.tripShortName ||
      "";
    const headsign = leg.headsign || leg.tripHeadsign || "";
    const start =
      leg.startTime ??
      leg.scheduledStartTime ??
      leg.scheduledDeparture ??
      leg.expectedDeparture ??
      null;
    const end =
      leg.endTime ??
      leg.scheduledEndTime ??
      leg.scheduledArrival ??
      leg.expectedArrival ??
      null;

    return {
      type: mode === "WALK" ? "walk" : "transit",
      mode,
      from,
      to,
      line: String(line || ""),
      headsign: String(headsign || ""),
      start,
      end,
      duration: Number(leg.duration || 0),
      distance: Number(leg.distance || 0),
      realtime: Boolean(leg.realTime || leg.realtime),
      intermediateStops: Array.isArray(leg.intermediateStops) ? leg.intermediateStops : [],
      coordinates: geometryForLeg(leg)
    };
  }

  function normalizeItinerary(it) {
    const legs = Array.isArray(it.legs) ? it.legs.map(normalizeLeg) : [];
    const start =
      it.startTime ??
      it.start ??
      legs[0]?.start ??
      null;
    const end =
      it.endTime ??
      it.end ??
      legs.at(-1)?.end ??
      null;

    const transitLegs = legs.filter(l => l.type === "transit");
    const transfers =
      Number.isFinite(Number(it.transfers))
        ? Number(it.transfers)
        : Math.max(0, transitLegs.length - 1);

    return {
      duration: Number(it.duration || 0),
      transfers,
      start,
      end,
      legs,
      walkDistance: Number(it.walkDistance || legs.filter(l => l.type === "walk").reduce((s, l) => s + l.distance, 0)),
      realtime: transitLegs.some(l => l.realtime),
      raw: it
    };
  }

  function itineraryFingerprint(it) {
    return it.legs.map(l => l.type === "walk" ? "W" : `${l.mode}:${l.line}`).join("|");
  }

  function sortItineraries(items) {
    const unique = [];
    const seen = new Set();

    for (const item of items) {
      const fp = itineraryFingerprint(item);
      if (seen.has(fp)) continue;
      seen.add(fp);
      unique.push(item);
    }

    if (planner.pref === "fewest") {
      unique.sort((a, b) =>
        a.transfers - b.transfers ||
        a.duration - b.duration
      );
    } else {
      unique.sort((a, b) =>
        a.duration - b.duration ||
        a.transfers - b.transfers
      );
    }

    return unique.slice(0, 5);
  }

  function durationLabel(seconds) {
    const min = minutes(seconds);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}u ${m}m` : `${h}u`;
  }

  function distanceLabel(meters) {
    if (!Number.isFinite(Number(meters)) || meters <= 0) return "";
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
  }

  function legHTML(leg, index) {
    const transit = leg.type === "transit";
    const lineText = transit
      ? [modeLabel(leg.mode), leg.line].filter(Boolean).join(" ")
      : `Lopen${leg.distance ? ` · ${distanceLabel(leg.distance)}` : ""}`;

    const detail = transit
      ? [
          leg.headsign ? `richting ${leg.headsign}` : "",
          leg.intermediateStops.length ? `${leg.intermediateStops.length + 1} haltes` : "",
          leg.realtime ? "realtime" : ""
        ].filter(Boolean).join(" · ")
      : `${leg.from} → ${leg.to}`;

    return `
      <div class="route-leg ${transit ? "transit" : "walk"}">
        <div class="route-leg-icon">${modeIcon(leg.mode)}</div>
        <div class="route-leg-main">
          <div class="route-leg-title">
            <strong>${esc(lineText)}</strong>
            ${leg.realtime ? '<span class="realtime-tag">LIVE</span>' : ""}
          </div>
          <span>${esc(detail)}</span>
          <small>${esc(leg.from)} → ${esc(leg.to)}</small>
        </div>
        <div class="route-leg-time">
          <strong>${timeText(leg.start)}</strong>
          <span>${durationLabel(leg.duration)}</span>
          <small>${timeText(leg.end)}</small>
        </div>
      </div>`;
  }

  function renderResults(items) {
    planner.itineraries = items;
    const fromName = displayStopName(planner.from);
    const toName = displayStopName(planner.to);

    $("#plannerResultsTitle").textContent = `${fromName} → ${toName}`;
    $("#plannerResultsMeta").textContent = items.some(i => i.realtime) ? "LIVE" : "DIENSTREGELING";

    const cards = $("#plannerResultCards");

    if (!items.length) {
      cards.innerHTML = `
        <div class="planner-empty-result">
          <strong>Geen bruikbare route gevonden</strong>
          <span>Probeer een andere tijd of een halte in de buurt.</span>
        </div>`;
      $("#plannerResults").classList.remove("hidden");
      return;
    }

    cards.innerHTML = items.map((it, i) => {
      const transitLegs = it.legs.filter(l => l.type === "transit");
      const lines = transitLegs
        .map(l => l.line || modeLabel(l.mode))
        .filter(Boolean)
        .slice(0, 4);

      return `
        <article class="route-option ${i === 0 ? "best" : ""}" data-route="${i}">
          <button class="route-option-head" type="button" data-expand="${i}">
            <div>
              <div class="route-times">
                <strong>${timeText(it.start)}</strong>
                <span>→</span>
                <strong>${timeText(it.end)}</strong>
              </div>
              <div class="route-summary-line">
                <span>${durationLabel(it.duration)}</span>
                <span>${it.transfers === 0 ? "rechtstreeks" : `${it.transfers} overstap${it.transfers === 1 ? "" : "pen"}`}</span>
                ${it.walkDistance ? `<span>${distanceLabel(it.walkDistance)} lopen</span>` : ""}
              </div>
            </div>
            <div class="route-head-right">
              ${i === 0 ? '<span class="best-chip">BESTE</span>' : ""}
              <span class="route-chevron">⌄</span>
            </div>
          </button>

          <div class="route-line-strip">
            ${lines.map(line => `<span>${esc(line)}</span>`).join('<i>›</i>')}
          </div>

          <div class="route-details ${i === 0 ? "" : "hidden"}" id="routeDetails${i}">
            <div class="route-legs">
              ${it.legs.map(legHTML).join("")}
            </div>
            <div class="route-card-actions">
              <button type="button" class="route-map-button" data-map="${i}">
                <span>⌖</span> Toon op kaart
              </button>
            </div>
          </div>
        </article>`;
    }).join("");

    [...cards.querySelectorAll("[data-expand]")].forEach(button => {
      button.addEventListener("click", () => {
        const i = Number(button.dataset.expand);
        const detail = $(`#routeDetails${i}`);
        detail.classList.toggle("hidden");
      });
    });

    [...cards.querySelectorAll("[data-map]")].forEach(button => {
      button.addEventListener("click", () => {
        const i = Number(button.dataset.map);
        const it = planner.itineraries[i];
        bridge.showPlannerRouteOnMap(it);
      });
    });

    $("#plannerResults").classList.remove("hidden");
    $("#plannerResults").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showError(message) {
    $("#plannerErrorText").textContent = message;
    $("#plannerError").classList.remove("hidden");
  }

  function setLoading(on) {
    planner.loading = on;
    $("#plannerLoading").classList.toggle("hidden", !on);
    $("#plannerGo").disabled = on;
    $("#plannerGo").classList.toggle("loading", on);
  }

  async function planRoute() {
    if (planner.loading) return;

    const dt = validate();
    if (!dt) return;

    planner.lastQuery = { dt };
    $("#plannerError").classList.add("hidden");
    $("#plannerResults").classList.add("hidden");
    bridge.clearPlannerRouteOnMap?.();
    setLoading(true);

    try {
      const url = buildRequest(dt);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 18000);

      let response;
      try {
        response = await fetch(url.toString(), {
          method: "GET",
          mode: "cors",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            "Accept": "application/json"
          }
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new Error(`Route-engine antwoordde met HTTP ${response.status}`);
      }

      const data = await response.json();
      const raw =
        data?.itineraries ||
        data?.plan?.itineraries ||
        [];

      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error("Er werd voor dit tijdstip geen OV-route gevonden.");
      }

      const normalized = sortItineraries(raw.map(normalizeItinerary));

      if (!normalized.length) {
        throw new Error("Er werd geen bruikbaar reisadvies gevonden.");
      }

      renderResults(normalized);
      toast(`${normalized.length} route${normalized.length === 1 ? "" : "s"} gevonden`);
    } catch (error) {
      console.error("OVFlow routeplanner:", error);

      if (error?.name === "AbortError") {
        showError("De routeberekening duurde te lang. Probeer opnieuw.");
      } else if (/Failed to fetch|Load failed|NetworkError|CORS/i.test(String(error?.message || error))) {
        showError("De route-engine kon niet worden bereikt. Controleer je internetverbinding en probeer opnieuw.");
      } else {
        showError(error?.message || "De route kon niet worden berekend.");
      }
    } finally {
      setLoading(false);
    }
  }

  $("#plannerUseLocation").addEventListener("click", useLocation);
  $("#plannerSwap").addEventListener("click", swapStops);

  $("#plannerClearTo").addEventListener("click", () => {
    planner.to = null;
    $("#plannerTo").value = "";
    $("#plannerTo").focus();
  });

  $("#plannerGo").addEventListener("click", planRoute);
  $("#plannerRetry").addEventListener("click", planRoute);

  $("#plannerMode").addEventListener("click", e => {
    const button = e.target.closest("button[data-mode]");
    if (!button) return;

    planner.mode = button.dataset.mode;
    [...$("#plannerMode").children].forEach(x => x.classList.toggle("active", x === button));
    $("#plannerDateTimeWrap").classList.toggle("hidden", planner.mode === "now");
  });

  $("#plannerPref").addEventListener("click", () => {
    planner.pref = planner.pref === "fastest" ? "fewest" : "fastest";
    $("#plannerPref").dataset.pref = planner.pref;
    $("#plannerPref span").textContent = planner.pref === "fastest" ? "Snelste" : "Minst overstappen";
  });

  document.addEventListener("click", e => {
    if (!e.target.closest(".journey-field")) {
      $("#plannerFromResults").classList.add("hidden");
      $("#plannerToResults").classList.add("hidden");
    }
  });

  createSearch("#plannerFrom", "#plannerFromResults", "from");
  createSearch("#plannerTo", "#plannerToResults", "to");
  setDefaultDateTime();
})();
