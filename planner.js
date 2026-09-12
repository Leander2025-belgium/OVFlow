(() => {
  "use strict";

  const bridge = window.OVFlowBridge;
  const $ = s => document.querySelector(s);

  if (!bridge) {
    console.error("OVFlowBridge ontbreekt.");
    return;
  }

  const API = "https://api.transitous.org/api/v6/plan";
  const IRAIL_API = "https://api.irail.be";

  const planner = {
    from: null,
    to: null,
    mode: "now",
    pref: "fastest",
    geolocationOrigin: false,
    loading: false,
    lastQuery: null,
    itineraries: [],
    live: {
      active: false,
      itineraryIndex: -1,
      legIndex: -1,
      leg: null,
      stops: [],
      nextIndex: 1,
      position: null,
      watchId: null,
      tickTimer: null,
      refreshTimer: null,
      wakeLock: null,
      followMap: false,
      warnedReady: false,
      warnedNow: false
    }
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
    url.searchParams.set("joinInterlinedLegs", "false");
    url.searchParams.set("withScheduledSkippedStops", "true");
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

  function normalizePlace(place, fallbackName = "", fallbackArrival = null, fallbackDeparture = null) {
    const p = place || {};
    return {
      name: stopName(p, fallbackName),
      stopId: String(p.stopId || p.id || p.stop?.id || ""),
      lat: Number(p.lat ?? p.latitude ?? p.stop?.lat),
      lon: Number(p.lon ?? p.lng ?? p.longitude ?? p.stop?.lon),
      arrival: p.arrival ?? p.expectedArrival ?? fallbackArrival ?? null,
      departure: p.departure ?? p.expectedDeparture ?? fallbackDeparture ?? null,
      scheduledArrival: p.scheduledArrival ?? null,
      scheduledDeparture: p.scheduledDeparture ?? null,
      track: p.track ?? p.scheduledTrack ?? ""
    };
  }

  function normalizeLeg(leg) {
    const mode = String(leg.mode || "WALK").toUpperCase();
    const fromName = stopName(leg.from, "Vertrek");
    const toName = stopName(leg.to, "Bestemming");
    const line =
      leg.routeShortName ||
      leg.route?.shortName ||
      leg.displayName ||
      leg.tripShortName ||
      "";
    const headsign = leg.headsign || leg.tripHeadsign || "";
    const start =
      leg.startTime ??
      leg.departure ??
      leg.expectedDeparture ??
      leg.scheduledStartTime ??
      leg.scheduledDeparture ??
      null;
    const end =
      leg.endTime ??
      leg.arrival ??
      leg.expectedArrival ??
      leg.scheduledEndTime ??
      leg.scheduledArrival ??
      null;

    const fromPlace = normalizePlace(leg.from, fromName, start, start);
    const toPlace = normalizePlace(leg.to, toName, end, end);
    const intermediateStops = Array.isArray(leg.intermediateStops)
      ? leg.intermediateStops.map(stop => normalizePlace(stop))
      : [];

    const tripId =
      leg.tripId ||
      leg.trip?.tripId ||
      leg.trip?.id ||
      leg.trips?.[0]?.tripId ||
      leg.trips?.[0]?.id ||
      "";

    const tripShortName =
      leg.tripShortName ||
      leg.trip?.tripShortName ||
      leg.trip?.shortName ||
      leg.trips?.[0]?.tripShortName ||
      leg.trips?.[0]?.shortName ||
      "";

    const vehicleCandidate =
      leg.vehicle ||
      leg.vehicleId ||
      leg.vehicleName ||
      leg.trip?.vehicle ||
      "";

    return {
      type: mode === "WALK" ? "walk" : "transit",
      mode,
      from: fromName,
      to: toName,
      fromPlace,
      toPlace,
      line: String(line || ""),
      headsign: String(headsign || ""),
      tripId: String(tripId || ""),
      tripShortName: String(tripShortName || ""),
      vehicleCandidate: String(vehicleCandidate || ""),
      start,
      end,
      duration: Number(leg.duration || 0),
      distance: Number(leg.distance || 0),
      realtime: Boolean(leg.realTime || leg.realtime),
      intermediateStops,
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


  function isRailMode(mode) {
    const m = String(mode || "").toUpperCase();
    return m === "RAIL" ||
      m === "SUBURBAN" ||
      m.includes("RAIL") ||
      m === "REGIONAL_FAST_RAIL" ||
      m === "LONG_DISTANCE" ||
      m === "HIGHSPEED_RAIL";
  }

  function allStopsForLeg(leg) {
    const items = [
      leg.fromPlace,
      ...(Array.isArray(leg.intermediateStops) ? leg.intermediateStops : []),
      leg.toPlace
    ].filter(Boolean);

    const out = [];
    for (const stop of items) {
      const name = stop.name || "";
      if (!name) continue;

      const previous = out.at(-1);
      const same = previous && (
        (previous.stopId && stop.stopId && previous.stopId === stop.stopId) ||
        (
          previous.name === name &&
          Number.isFinite(Number(previous.lat)) &&
          Number.isFinite(Number(previous.lon)) &&
          Number.isFinite(Number(stop.lat)) &&
          Number.isFinite(Number(stop.lon)) &&
          haversine(previous.lon, previous.lat, stop.lon, stop.lat) < 0.02
        )
      );

      if (same) {
        out[out.length - 1] = {
          ...previous,
          ...stop,
          arrival: stop.arrival ?? previous.arrival,
          departure: stop.departure ?? previous.departure,
          scheduledArrival: stop.scheduledArrival ?? previous.scheduledArrival,
          scheduledDeparture: stop.scheduledDeparture ?? previous.scheduledDeparture
        };
      } else {
        out.push({ ...stop });
      }
    }
    return out;
  }

  function stopTimeText(stop) {
    return timeText(
      stop?.arrival ??
      stop?.departure ??
      stop?.scheduledArrival ??
      stop?.scheduledDeparture
    );
  }

  function plannedStopsHTML(leg) {
    const stops = allStopsForLeg(leg);
    if (!stops.length) {
      return `
        <div class="ride-stops-empty">
          <strong>Geen haltevolgorde beschikbaar</strong>
          <span>De route-engine gaf voor deze rit geen tussenhaltes terug.</span>
        </div>`;
    }

    return stops.map((stop, index) => {
      const first = index === 0;
      const last = index === stops.length - 1;
      const label = first ? "Instappen" : last ? "Uitstappen" : "Tussenhalte";
      return `
        <div class="ride-stop-row ${first ? "start" : ""} ${last ? "end" : ""}">
          <div class="ride-stop-rail"><i></i></div>
          <div class="ride-stop-copy">
            <strong>${esc(stop.name)}</strong>
            <span>${label}${stop.track ? ` · spoor/perron ${esc(stop.track)}` : ""}</span>
          </div>
          <time>${stopTimeText(stop)}</time>
        </div>`;
    }).join("");
  }

  function irailVehicleCandidates(leg) {
    const values = [
      leg.vehicleCandidate,
      leg.tripShortName,
      leg.tripId
    ].filter(Boolean).map(v => String(v).trim());

    const out = [];
    const push = value => {
      if (value && !out.includes(value)) out.push(value);
    };

    for (const raw of values) {
      if (/^BE\.NMBS\./i.test(raw)) {
        push(raw);
        continue;
      }

      const clean = raw
        .replace(/^urn:.*?:/i, "")
        .replace(/^vehicle:/i, "")
        .replace(/\s+/g, "");

      const direct = clean.match(/((?:IC|L|S\d*|P|EXP|EUR|THA|TGV|ICE)\d{1,6})/i);
      if (direct) push(`BE.NMBS.${direct[1].toUpperCase()}`);

      if (/^\d{2,6}$/.test(clean) && leg.line) {
        const line = String(leg.line).replace(/\s+/g, "").toUpperCase();
        if (/^(IC|L|P|S\d*|EXP|EUR|THA|TGV|ICE)$/.test(line)) {
          push(`BE.NMBS.${line}${clean}`);
        }
      }

      if (/^(IC|L|P|S\d*|EXP|EUR|THA|TGV|ICE)\d{1,6}$/i.test(clean)) {
        push(`BE.NMBS.${clean.toUpperCase()}`);
      }
    }

    return out;
  }

  function yymmddForIRail(value) {
    const d = asDate(value) || new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${pad(d.getDate())}${pad(d.getMonth() + 1)}${String(d.getFullYear()).slice(-2)}`;
  }

  async function fetchIRailVehicle(leg) {
    if (!isRailMode(leg.mode)) throw new Error("Dit is geen treinrit.");

    const candidates = irailVehicleCandidates(leg);
    if (!candidates.length) throw new Error("Geen NMBS-treinnummer beschikbaar voor deze rit.");

    let lastError = null;
    for (const id of candidates) {
      try {
        const url = new URL(`${IRAIL_API}/vehicle/`);
        url.searchParams.set("id", id);
        url.searchParams.set("date", yymmddForIRail(leg.start));
        url.searchParams.set("format", "json");
        url.searchParams.set("lang", "nl");
        url.searchParams.set("alerts", "true");

        const response = await fetch(url.toString(), {
          headers: { "Accept": "application/json" },
          cache: "no-store"
        });

        if (!response.ok) {
          lastError = new Error(`iRail HTTP ${response.status}`);
          continue;
        }

        const data = await response.json();
        const rawStops = Array.isArray(data?.stops)
          ? data.stops
          : Array.isArray(data?.stops?.stop)
            ? data.stops.stop
            : [];

        if (rawStops.length) return { data, vehicleId: id };
        lastError = new Error("Geen haltes gevonden voor deze trein.");
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("NMBS-rit kon niet worden geladen.");
  }

  function normalizeIRailStops(data) {
    const raw = Array.isArray(data?.stops)
      ? data.stops
      : Array.isArray(data?.stops?.stop)
        ? data.stops.stop
        : [];

    return raw.map(stop => {
      const station =
        stop.stationinfo?.standardname ||
        stop.stationinfo?.name ||
        stop.station ||
        "Station";

      const scheduled = stop.time ? asDate(Number(stop.time)) : null;
      const delaySeconds = Number(stop.delay || 0);
      const liveTime = scheduled ? new Date(scheduled.getTime() + delaySeconds * 1000) : null;

      return {
        name: station,
        scheduled,
        liveTime,
        delaySeconds,
        platform: stop.platform || "",
        canceled: String(stop.canceled || "0") === "1",
        left: String(stop.left || "0") === "1"
      };
    });
  }

  function irailStopsHTML(stops) {
    return stops.map(stop => {
      const delayMin = Math.round(stop.delaySeconds / 60);
      const status = stop.canceled
        ? "Afgelast"
        : delayMin > 0
          ? `+${delayMin} min`
          : "Op tijd";

      return `
        <div class="ride-stop-row irail ${stop.canceled ? "canceled" : ""} ${stop.left ? "passed" : ""}">
          <div class="ride-stop-rail"><i></i></div>
          <div class="ride-stop-copy">
            <strong>${esc(stop.name)}</strong>
            <span>${stop.platform ? `spoor ${esc(stop.platform)} · ` : ""}${status}</span>
          </div>
          <time>
            ${stop.liveTime ? timeText(stop.liveTime) : "--:--"}
            ${delayMin > 0 && stop.scheduled ? `<small>${timeText(stop.scheduled)}</small>` : ""}
          </time>
        </div>`;
    }).join("");
  }

  async function loadRideStops(routeIndex, legIndex) {
    const itinerary = planner.itineraries[routeIndex];
    const leg = itinerary?.legs?.[legIndex];
    const panel = document.querySelector(`[data-stops-panel="${routeIndex}-${legIndex}"]`);
    const button = document.querySelector(`[data-stops-route="${routeIndex}"][data-stops-leg="${legIndex}"]`);
    if (!leg || !panel || !button) return;

    const opening = panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !opening);
    button.classList.toggle("active", opening);
    if (!opening) return;

    const plannedCount = allStopsForLeg(leg).length;
    panel.innerHTML = `
      <div class="ride-stops-head">
        <div>
          <span>${isRailMode(leg.mode) ? "Treinrit" : `${modeLabel(leg.mode)}rit`}</span>
          <strong>${plannedCount} haltes</strong>
        </div>
        ${isRailMode(leg.mode) ? '<span class="nmbs-live-source">NMBS LIVE VIA iRAIL</span>' : ""}
      </div>
      <div class="ride-stops-list">${plannedStopsHTML(leg)}</div>
      ${isRailMode(leg.mode) ? `
        <div class="ride-stops-loading">
          <span class="mini-spinner"></span>
          NMBS realtime haltes controleren…
        </div>` : ""}
    `;

    if (!isRailMode(leg.mode)) return;

    try {
      const result = await fetchIRailVehicle(leg);
      const liveStops = normalizeIRailStops(result.data);
      if (!liveStops.length) throw new Error("Geen NMBS-haltes teruggekregen.");

      const source = panel.querySelector(".nmbs-live-source");
      if (source) source.textContent = `iRail · ${result.vehicleId.replace("BE.NMBS.", "")}`;

      const list = panel.querySelector(".ride-stops-list");
      if (list) list.innerHTML = irailStopsHTML(liveStops);
      panel.querySelector(".ride-stops-loading")?.remove();

      const stateEl = document.querySelector("#irailApiState");
      if (stateEl) {
        stateEl.textContent = "Live";
        stateEl.className = "state-ok";
      }
    } catch (error) {
      console.debug("iRail vehicle fallback:", error);
      const loading = panel.querySelector(".ride-stops-loading");
      if (loading) {
        loading.innerHTML = `
          <span class="ride-stops-fallback">i</span>
          NMBS live-detail niet beschikbaar voor deze trein; de volledige haltevolgorde hierboven blijft zichtbaar.
        `;
      }
    }
  }

  function legHTML(leg, legIndex, routeIndex) {
    const transit = leg.type === "transit";
    const lineText = transit
      ? [modeLabel(leg.mode), leg.line].filter(Boolean).join(" ")
      : `Lopen${leg.distance ? ` · ${distanceLabel(leg.distance)}` : ""}`;

    const stopsCount = transit ? allStopsForLeg(leg).length : 0;
    const detail = transit
      ? [
          leg.headsign ? `richting ${leg.headsign}` : "",
          stopsCount ? `${Math.max(0, stopsCount - 1)} haltes` : "",
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
            ${transit && isRailMode(leg.mode) ? '<span class="nmbs-tag">NMBS</span>' : ""}
          </div>
          <span>${esc(detail)}</span>
          <small>${esc(leg.from)} → ${esc(leg.to)}</small>
          ${transit ? `
            <div class="route-leg-buttons">
              <button type="button" class="route-stops-button" data-stops-route="${routeIndex}" data-stops-leg="${legIndex}">
                <span>●●●</span> Alle haltes
              </button>
              <button type="button" class="route-live-trip-button" data-live-route="${routeIndex}" data-live-leg="${legIndex}">
                <span class="live-trip-play">▶</span> Live Trip
              </button>
            </div>` : ""}
        </div>
        <div class="route-leg-time">
          <strong>${timeText(leg.start)}</strong>
          <span>${durationLabel(leg.duration)}</span>
          <small>${timeText(leg.end)}</small>
        </div>
      </div>
      ${transit ? `<div class="ride-stops-panel hidden" data-stops-panel="${routeIndex}-${legIndex}"></div>` : ""}`;
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
              ${it.legs.map((leg, legIndex) => legHTML(leg, legIndex, i)).join("")}
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

    [...cards.querySelectorAll("[data-live-route][data-live-leg]")].forEach(button => {
      button.addEventListener("click", () => {
        startLiveTrip(Number(button.dataset.liveRoute), Number(button.dataset.liveLeg));
      });
    });

    [...cards.querySelectorAll("[data-stops-route][data-stops-leg]")].forEach(button => {
      button.addEventListener("click", () => {
        loadRideStops(Number(button.dataset.stopsRoute), Number(button.dataset.stopsLeg));
      });
    });

    $("#plannerResults").classList.remove("hidden");
    $("#plannerResults").scrollIntoView({ behavior: "smooth", block: "start" });
  }


  function liveStopTime(stop) {
    return stop?.arrival ?? stop?.departure ?? stop?.scheduledArrival ?? stop?.scheduledDeparture ?? null;
  }

  function buildLiveStops(leg) {
    const raw = [leg.fromPlace, ...(leg.intermediateStops || []), leg.toPlace]
      .filter(Boolean)
      .filter(stop =>
        stop.name &&
        Number.isFinite(Number(stop.lat)) &&
        Number.isFinite(Number(stop.lon))
      );

    const deduped = [];
    for (const stop of raw) {
      const previous = deduped.at(-1);
      const sameId = previous?.stopId && stop.stopId && previous.stopId === stop.stopId;
      const samePlace =
        previous &&
        previous.name === stop.name &&
        haversine(previous.lon, previous.lat, stop.lon, stop.lat) < 0.03;

      if (sameId || samePlace) {
        deduped[deduped.length - 1] = {
          ...previous,
          ...stop,
          arrival: stop.arrival ?? previous.arrival,
          departure: stop.departure ?? previous.departure
        };
      } else {
        deduped.push({ ...stop });
      }
    }

    if (deduped.length < 2) {
      return [
        { ...leg.fromPlace, name: leg.from, arrival: leg.start, departure: leg.start },
        { ...leg.toPlace, name: leg.to, arrival: leg.end, departure: leg.end }
      ].filter(s => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)));
    }

    return deduped;
  }

  function distanceMeters(lat1, lon1, lat2, lon2) {
    return haversine(Number(lon1), Number(lat1), Number(lon2), Number(lat2)) * 1000;
  }

  function routeGeometryMetrics(coords) {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    let total = 0;
    const cumulative = [0];

    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1];
      const b = coords[i];
      total += distanceMeters(a[1], a[0], b[1], b[0]);
      cumulative.push(total);
    }

    return { total, cumulative };
  }

  function projectToRoute(lat, lon, coords, metrics) {
    if (!metrics || !Array.isArray(coords) || coords.length < 2) return null;

    const refLat = Number(lat) * Math.PI / 180;
    const mx = 111320 * Math.cos(refLat);
    const my = 110540;
    let bestDistance = Infinity;
    let bestProgress = 0;

    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1];
      const b = coords[i];

      const ax = (a[0] - lon) * mx;
      const ay = (a[1] - lat) * my;
      const bx = (b[0] - lon) * mx;
      const by = (b[1] - lat) * my;

      const vx = bx - ax;
      const vy = by - ay;
      const length2 = vx * vx + vy * vy;
      let t = length2 > 0 ? -(ax * vx + ay * vy) / length2 : 0;
      t = Math.max(0, Math.min(1, t));

      const px = ax + vx * t;
      const py = ay + vy * t;
      const d = Math.hypot(px, py);

      if (d < bestDistance) {
        bestDistance = d;
        const segmentLength = metrics.cumulative[i] - metrics.cumulative[i - 1];
        bestProgress = metrics.cumulative[i - 1] + segmentLength * t;
      }
    }

    return {
      distance: bestDistance,
      progress: bestProgress,
      ratio: metrics.total > 0 ? bestProgress / metrics.total : 0
    };
  }

  function prepareLiveStopProgress(leg, stops) {
    const metrics = routeGeometryMetrics(leg.coordinates);
    if (!metrics) {
      stops.forEach((stop, index) => {
        stop.routeProgress = index;
        stop.routeRatio = stops.length > 1 ? index / (stops.length - 1) : 0;
      });
      return { metrics: null };
    }

    let previous = 0;
    stops.forEach((stop, index) => {
      const projection = projectToRoute(Number(stop.lat), Number(stop.lon), leg.coordinates, metrics);
      let progress = projection?.progress ?? previous;

      // Keep stop order monotonic even for looping routes.
      if (index > 0) progress = Math.max(progress, previous + 1);
      progress = Math.min(progress, metrics.total);
      previous = progress;

      stop.routeProgress = progress;
      stop.routeRatio = metrics.total > 0 ? progress / metrics.total : 0;
    });

    return { metrics };
  }

  function timeBasedNextIndex(stops, fallbackIndex = 1) {
    const now = Date.now();
    for (let i = Math.max(1, fallbackIndex); i < stops.length; i++) {
      const d = asDate(liveStopTime(stops[i]));
      if (d && d.getTime() >= now - 45000) return i;
    }
    return Math.min(stops.length - 1, Math.max(1, fallbackIndex));
  }

  function gpsBasedNextIndex(position, live) {
    const leg = live.leg;
    const stops = live.stops;
    if (!position || !stops.length) return null;

    const accuracy = Number(position.accuracy || 9999);
    if (accuracy > 180) return null;

    if (live.metrics && leg.coordinates?.length > 1) {
      const projection = projectToRoute(position.lat, position.lon, leg.coordinates, live.metrics);

      // If the phone is far away from the transit path, don't trust route progress.
      if (!projection || projection.distance > 350) return null;

      for (let i = Math.max(1, live.nextIndex - 1); i < stops.length; i++) {
        // Keep a stop as "next" until we are around 25 m past it.
        if (stops[i].routeProgress >= projection.progress - 25) return i;
      }

      return stops.length - 1;
    }

    // Fallback if the API did not return route geometry.
    let closestIndex = 0;
    let closestDistance = Infinity;
    stops.forEach((stop, i) => {
      const d = distanceMeters(position.lat, position.lon, stop.lat, stop.lon);
      if (d < closestDistance) {
        closestDistance = d;
        closestIndex = i;
      }
    });

    if (closestDistance < 120) return Math.min(stops.length - 1, closestIndex + 1);
    return null;
  }

  function formatEta(stop) {
    const d = asDate(liveStopTime(stop));
    if (!d) return "—";
    const delta = Math.round((d.getTime() - Date.now()) / 60000);
    if (delta <= 0 && delta >= -1) return "nu";
    if (delta > 0 && delta < 60) return `${delta} min`;
    return timeText(d);
  }

  function liveArrivalLabel(stop) {
    const d = asDate(liveStopTime(stop));
    return d ? timeText(d) : "—";
  }

  function maybeVibrate(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch {}
  }

  function updateLiveTripAlert(nextStop, nextIndex, distanceToNext) {
    const live = planner.live;
    const lastIndex = live.stops.length - 1;
    const isDestinationNext = nextIndex === lastIndex;
    const alert = $("#liveTripAlert");
    const title = $("#liveTripAlertTitle");
    const text = $("#liveTripAlertText");

    alert.className = "live-trip-alert normal";

    if (isDestinationNext) {
      alert.classList.add("destination");

      if (Number.isFinite(distanceToNext) && distanceToNext <= 90) {
        alert.className = "live-trip-alert now";
        title.textContent = "Nu uitstappen";
        text.textContent = `${nextStop.name} is jouw uitstaphalte.`;
        if (!live.warnedNow) {
          live.warnedNow = true;
          maybeVibrate([180, 90, 180, 90, 260]);
        }
      } else if (Number.isFinite(distanceToNext) && distanceToNext <= 400) {
        alert.className = "live-trip-alert ready";
        title.textContent = "Maak je klaar om uit te stappen";
        text.textContent = `Je nadert ${nextStop.name}.`;
        if (!live.warnedReady) {
          live.warnedReady = true;
          maybeVibrate([160, 100, 160]);
        }
      } else {
        title.textContent = "Volgende halte: uitstappen";
        text.textContent = `Stap uit bij ${nextStop.name}.`;
      }
    } else {
      const remainingAfterNext = lastIndex - nextIndex;
      title.textContent = "Rit actief";
      text.textContent = remainingAfterNext > 0
        ? `Na ${nextStop.name} volgen nog ${remainingAfterNext} halte${remainingAfterNext === 1 ? "" : "s"} tot je uitstaphalte.`
        : `Volgende halte: ${nextStop.name}.`;
    }
  }

  function renderLiveTrip() {
    const live = planner.live;
    if (!live.active || !live.leg || live.stops.length < 2) return;

    const stops = live.stops;
    const lastIndex = stops.length - 1;
    const position = live.position;

    let gpsIndex = gpsBasedNextIndex(position, live);
    const timeIndex = timeBasedNextIndex(stops, live.nextIndex);

    let candidate = gpsIndex ?? timeIndex;
    candidate = Math.max(1, Math.min(lastIndex, candidate));

    // Never move backwards during one active ride.
    live.nextIndex = Math.max(live.nextIndex, candidate);
    const nextIndex = Math.min(lastIndex, live.nextIndex);
    const nextStop = stops[nextIndex];

    let distanceToNext = NaN;
    let routeRatio = nextIndex / lastIndex;

    if (position) {
      distanceToNext = distanceMeters(position.lat, position.lon, nextStop.lat, nextStop.lon);

      if (live.metrics && live.leg.coordinates?.length > 1) {
        const projection = projectToRoute(position.lat, position.lon, live.leg.coordinates, live.metrics);
        if (projection && projection.distance < 500) routeRatio = projection.ratio;
      }
    }

    routeRatio = Math.max(0, Math.min(1, routeRatio));
    const progressPct = Math.round(routeRatio * 100);
    const stopsLeft = Math.max(1, lastIndex - nextIndex + 1);

    $("#liveTripNextStop").textContent = nextStop.name;
    $("#liveTripEta").textContent = formatEta(nextStop);
    $("#liveTripDistance").textContent = Number.isFinite(distanceToNext)
      ? distanceToNext < 1000
        ? `${Math.round(distanceToNext)} m`
        : `${(distanceToNext / 1000).toFixed(1).replace(".", ",")} km`
      : "op tijdschema";

    $("#liveTripProgressPct").textContent = `${progressPct}%`;
    $("#liveTripProgressBar").style.width = `${progressPct}%`;
    $("#liveTripStopsLeft").textContent = String(stopsLeft);
    $("#liveTripArrival").textContent = liveArrivalLabel(stops[lastIndex]);

    if (position) {
      const speedMs = Number(position.speed);
      $("#liveTripSpeed").textContent = Number.isFinite(speedMs) && speedMs >= 0
        ? `${Math.round(speedMs * 3.6)} km/u`
        : "—";
      $("#liveTripAccuracy").textContent = Number.isFinite(Number(position.accuracy))
        ? `±${Math.round(position.accuracy)} m`
        : "—";
    } else {
      $("#liveTripSpeed").textContent = "—";
      $("#liveTripAccuracy").textContent = "tijdmodus";
    }

    const time = asDate(liveStopTime(nextStop));
    const etaMeta = time ? `verwacht ${timeText(time)}` : "verwachte tijd niet beschikbaar";
    $("#liveTripNextMeta").textContent =
      nextIndex === lastIndex
        ? `${etaMeta} · hier uitstappen`
        : `${etaMeta} · ${stopsLeft} halte${stopsLeft === 1 ? "" : "s"} tot uitstappen`;

    $("#liveTripRealtime").textContent = live.leg.realtime ? "LIVE" : "DIENSTREGELING";

    const listStart = Math.max(0, nextIndex - 1);
    const listEnd = Math.min(stops.length, nextIndex + 5);
    $("#liveTripStopList").innerHTML = stops.slice(listStart, listEnd).map((stop, localIndex) => {
      const i = listStart + localIndex;
      const passed = i < nextIndex;
      const current = i === nextIndex;
      const destination = i === lastIndex;
      const timeValue = liveArrivalLabel(stop);

      return `
        <div class="live-trip-stop-row ${passed ? "passed" : ""} ${current ? "current" : ""} ${destination ? "destination" : ""}">
          <div class="live-trip-stop-dot"><i></i></div>
          <div class="live-trip-stop-copy">
            <strong>${esc(stop.name)}</strong>
            <span>${destination ? "Uitstappen" : current ? "Volgende halte" : passed ? "Voorbij" : "Daarna"}</span>
          </div>
          <div class="live-trip-stop-time">${timeValue}</div>
        </div>`;
    }).join("");

    updateLiveTripAlert(nextStop, nextIndex, distanceToNext);

    bridge.updateLiveTripMap?.({
      leg: live.leg,
      position,
      nextStop,
      follow: live.followMap
    });
  }

  async function refreshLiveTripData() {
    const live = planner.live;
    if (!live.active || !live.leg?.tripId) return;

    try {
      const url = new URL("https://api.transitous.org/api/v6/trip");
      url.searchParams.set("tripId", live.leg.tripId);

      const response = await fetch(url.toString(), {
        headers: { "Accept": "application/json" },
        cache: "no-store"
      });

      if (!response.ok) return;
      const data = await response.json();
      const itinerary = normalizeItinerary(data);
      const transitLegs = itinerary.legs.filter(l => l.type === "transit");

      let updated =
        transitLegs.find(l => l.tripId && l.tripId === live.leg.tripId) ||
        transitLegs.find(l => l.line === live.leg.line && l.headsign === live.leg.headsign) ||
        transitLegs[0];

      if (!updated) return;

      const oldNextName = live.stops[live.nextIndex]?.name;
      live.leg = updated;
      live.stops = buildLiveStops(updated);
      const prepared = prepareLiveStopProgress(updated, live.stops);
      live.metrics = prepared.metrics;

      if (oldNextName) {
        const idx = live.stops.findIndex(s => s.name === oldNextName);
        if (idx >= 1) live.nextIndex = idx;
      }

      renderLiveTrip();
    } catch (error) {
      // Live Trip keeps working with the last known timetable + GPS.
      console.debug("OVFlow Live Trip refresh:", error);
    }
  }

  async function requestWakeLock() {
    const live = planner.live;
    try {
      if ("wakeLock" in navigator && document.visibilityState === "visible") {
        live.wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch {}
  }

  function updateGpsStatus(text, stateClass = "") {
    const el = $("#liveTripGps");
    el.className = `live-trip-gps ${stateClass}`.trim();
    el.querySelector("span").textContent = text;
  }

  function startLiveGps() {
    const live = planner.live;

    if (!navigator.geolocation) {
      updateGpsStatus("Tijdmodus", "warning");
      renderLiveTrip();
      return;
    }

    updateGpsStatus("GPS zoeken…", "loading");

    live.watchId = navigator.geolocation.watchPosition(position => {
      live.position = {
        lat: Number(position.coords.latitude),
        lon: Number(position.coords.longitude),
        accuracy: Number(position.coords.accuracy),
        speed: position.coords.speed == null ? null : Number(position.coords.speed),
        heading: position.coords.heading == null ? null : Number(position.coords.heading),
        timestamp: position.timestamp
      };

      updateGpsStatus(
        live.position.accuracy <= 80 ? "GPS actief" : "GPS minder nauwkeurig",
        live.position.accuracy <= 80 ? "active" : "warning"
      );
      renderLiveTrip();
    }, error => {
      console.debug("Live Trip GPS:", error);
      updateGpsStatus("Tijdmodus", "warning");
      renderLiveTrip();
    }, {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 15000
    });
  }

  function startLiveTrip(itineraryIndex, legIndex) {
    const itinerary = planner.itineraries[itineraryIndex];
    const leg = itinerary?.legs?.[legIndex];

    if (!leg || leg.type !== "transit") {
      toast("Live Trip kan alleen voor een OV-rit gestart worden");
      return;
    }

    stopLiveTrip(false);

    const stops = buildLiveStops(leg);
    if (stops.length < 2) {
      toast("Voor deze rit zijn onvoldoende haltegegevens beschikbaar");
      return;
    }

    const prepared = prepareLiveStopProgress(leg, stops);

    planner.live = {
      active: true,
      itineraryIndex,
      legIndex,
      leg,
      stops,
      metrics: prepared.metrics,
      nextIndex: Math.min(1, stops.length - 1),
      position: null,
      watchId: null,
      tickTimer: null,
      refreshTimer: null,
      wakeLock: null,
      followMap: false,
      warnedReady: false,
      warnedNow: false
    };

    $("#liveTripSession").classList.remove("hidden");
    $("#liveTripTitle").textContent = `${modeLabel(leg.mode)} ${leg.line || ""}`.trim();
    $("#liveTripLine").textContent = leg.line || modeLabel(leg.mode);
    $("#liveTripDirection").textContent = leg.headsign ? `Richting ${leg.headsign}` : `${leg.from} → ${leg.to}`;
    $("#liveTripFromLabel").textContent = leg.from;
    $("#liveTripToLabel").textContent = leg.to;
    $("#liveTripMapButton").classList.remove("active");

    renderLiveTrip();
    startLiveGps();
    requestWakeLock();

    planner.live.tickTimer = setInterval(renderLiveTrip, 10000);
    planner.live.refreshTimer = setInterval(refreshLiveTripData, 60000);

    $("#liveTripSession").scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Live Trip gestart");
  }

  async function stopLiveTrip(hide = true) {
    const live = planner.live;

    if (live?.watchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(live.watchId);
    }
    if (live?.tickTimer) clearInterval(live.tickTimer);
    if (live?.refreshTimer) clearInterval(live.refreshTimer);

    try {
      if (live?.wakeLock) await live.wakeLock.release();
    } catch {}

    bridge.clearLiveTripMap?.();

    if (hide) $("#liveTripSession")?.classList.add("hidden");

    if (planner.live) {
      planner.live.active = false;
      planner.live.watchId = null;
      planner.live.tickTimer = null;
      planner.live.refreshTimer = null;
      planner.live.wakeLock = null;
      planner.live.followMap = false;
    }
  }

  function toggleLiveMap() {
    const live = planner.live;
    if (!live.active) return;

    live.followMap = !live.followMap;
    $("#liveTripMapButton").classList.toggle("active", live.followMap);

    const nextStop = live.stops[live.nextIndex];
    if (live.followMap) {
      bridge.focusLiveTripMap?.({
        leg: live.leg,
        position: live.position,
        nextStop
      });
    } else {
      toast("Kaart volgen uit");
    }
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

  $("#liveTripClose").addEventListener("click", () => stopLiveTrip(true));
  $("#liveTripStopButton").addEventListener("click", () => stopLiveTrip(true));
  $("#liveTripMapButton").addEventListener("click", toggleLiveMap);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && planner.live.active && !planner.live.wakeLock) {
      requestWakeLock();
    }
  });

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
