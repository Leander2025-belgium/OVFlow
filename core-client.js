(() => {
  "use strict";

  const JSON_HEADERS = { Accept: "application/json" };
  const state = {
    checked: false,
    v4: null,
    legacy: null,
    lastCheck: 0
  };

  function asArray(value) {
    if (Array.isArray(value)) return value;
    return value == null ? [] : [value];
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      cache: "no-store",
      ...options,
      headers: { ...JSON_HEADERS, ...(options.headers || {}) }
    });
    let data = null;
    try { data = await response.json(); } catch {}
    return { response, data };
  }

  async function detect(force = false) {
    if (!force && state.checked && Date.now() - state.lastCheck < 60_000) return { ...state };
    state.lastCheck = Date.now();

    try {
      const { response, data } = await fetchJson(new URL("/api/v4/health", location.origin));
      state.v4 = response.ok && data?.ok !== false;
      if (state.v4) {
        state.legacy = true;
        state.checked = true;
        return { ...state };
      }
      if (response.status !== 404) state.v4 = false;
    } catch {
      state.v4 = false;
    }

    try {
      const { response, data } = await fetchJson(new URL("/api/health", location.origin));
      state.legacy = response.ok && data?.ok !== false;
    } catch {
      state.legacy = false;
    }

    state.checked = true;
    return { ...state };
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
    if (!Number.isNaN(d.getTime())) return d;
    const match = String(raw).match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!match) return null;
    const today = new Date();
    today.setHours(Number(match[1]), Number(match[2]), Number(match[3] || 0), 0);
    return today;
  }

  function iso(raw) {
    const d = parseDate(raw);
    return d ? d.toISOString() : null;
  }

  function pick(obj, paths, fallback = "") {
    for (const path of paths) {
      let value = obj;
      for (const key of path.split(".")) value = value?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return fallback;
  }

  function normalizeLegacyDeLijn(item, stopName = "") {
    const realtimeRaw = pick(item, ["real-timeTijdstip", "realTimeTijdstip", "realtimeTijdstip", "realTime", "realtime"]);
    const plannedRaw = pick(item, ["dienstregelingTijdstip", "geplandeTijdstip", "tijdstip", "scheduledTime", "doorkomsttijd"]);
    const effectiveRaw = realtimeRaw || plannedRaw;
    const planned = iso(plannedRaw || effectiveRaw);
    const realtimeDate = iso(realtimeRaw || effectiveRaw);
    const status = String(pick(item, ["status", "ritstatus", "doorkomstStatus", "predictionStatus"], ""));
    const realtime = Boolean(realtimeRaw || item.realTime || item.realtime || item.isRealtime || /real|voorspel|prediction/i.test(status));
    const line = pick(item, ["lijnnummerPubliek", "lijnnummer", "lijnNummer", "lineNumber", "lijn.lijnnummer", "lijn.nummer"], "—");
    const destination = pick(item, ["bestemming", "bestemmingNaam", "richting", "destination", "bestemming.omschrijving", "lijnrichting"], "Onbekende richting");
    let delayMinutes = Number(pick(item, ["delayMinutes", "vertraging"], 0)) || 0;
    if (!delayMinutes && Number.isFinite(Number(item.afwijking))) delayMinutes = Math.round(Number(item.afwijking) / 60);
    if (!delayMinutes && planned && realtimeDate) delayMinutes = Math.round((new Date(realtimeDate) - new Date(planned)) / 60000);
    const modeRaw = String(pick(item, ["vervoertype", "transportType", "mode"], ""));
    return {
      id: String(pick(item, ["ritnummer", "tripId", "id"], `${line}-${effectiveRaw}`)),
      mode: /tram/i.test(modeRaw) ? "tram" : "bus",
      line: String(line),
      operator: "De Lijn",
      destination: typeof destination === "object" ? String(destination.omschrijving || destination.naam || "Onbekende richting") : String(destination),
      origin: stopName,
      plannedDeparture: planned || realtimeDate,
      realtimeDeparture: realtimeDate || planned,
      delayMinutes,
      platform: "",
      platformChanged: false,
      realtime,
      cancelled: /geannuleerd|cancel/i.test(status),
      source: "delijn-legacy"
    };
  }

  function extractLegacyDepartures(data) {
    if (Array.isArray(data?.departures)) return data.departures;
    if (Array.isArray(data?.vertrekken)) return data.vertrekken;
    if (Array.isArray(data?.doorkomsten)) return data.doorkomsten;
    const groups = data?.halteDoorkomsten || data?.doorkomstenPerHalte || [];
    return asArray(groups).flatMap(group => asArray(group?.doorkomsten || group?.departures || group));
  }

  async function stopDepartures(entity, stopNumber, max = 8) {
    const capabilities = await detect();
    const stopId = `${String(entity).replace(/\D/g, "")}-${String(stopNumber).replace(/\D/g, "")}`;

    if (capabilities.v4) {
      const url = new URL(`/api/v4/stops/${encodeURIComponent(stopId)}/departures`, location.origin);
      url.searchParams.set("max", String(max));
      const { response, data } = await fetchJson(url);
      if (response.ok) return { departures: asArray(data?.departures).slice(0, max), source: "v4" };
      if (response.status !== 404) throw new Error(data?.message || `OVFlow Core HTTP ${response.status}`);
      state.v4 = false;
    }

    const legacy = new URL("/api/delijn/departures", location.origin);
    legacy.searchParams.set("halteId", stopId);
    const { response, data } = await fetchJson(legacy);
    if (!response.ok) throw new Error(data?.message || `OVFlow Core HTTP ${response.status}`);
    return {
      departures: extractLegacyDepartures(data).map(item => normalizeLegacyDeLijn(item)).filter(item => item.plannedDeparture).slice(0, max),
      source: "legacy"
    };
  }

  function normalizeLegacyStop(stop) {
    return {
      type: "stop",
      mode: "bus",
      id: `${stop.entiteit || stop.entiteitnummer || ""}-${stop.haltenummer || stop.stop || ""}`,
      entity: String(stop.entiteit || stop.entiteitnummer || ""),
      stop: String(stop.haltenummer || stop.stop || ""),
      name: String(stop.name || stop.omschrijving || stop.naam || "Halte"),
      operator: "De Lijn",
      distanceMeters: Number(stop.distanceMeters || stop.distance || 0),
      latitude: Number(stop.latitude ?? stop.lat),
      longitude: Number(stop.longitude ?? stop.lon ?? stop.lng),
      departures: []
    };
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

  function normalizeIRailDeparture(item, stationName = "") {
    const delaySeconds = Number(item?.delay || 0);
    const planned = iso(item?.time);
    const realtime = planned ? new Date(new Date(planned).getTime() + delaySeconds * 1000).toISOString() : null;
    const line = String(item?.vehicleinfo?.shortname || item?.vehicle || "Trein")
      .replace(/^BE\.NMBS\./i, "")
      .replace(/^(IC|L|P|S\d*|ICE|TGV|EUR|EXP)(\d)/i, "$1 $2");
    return {
      id: String(item?.departureConnection || item?.vehicle || `${stationName}-${planned || ""}`),
      mode: "train",
      line,
      operator: "NMBS/SNCB",
      destination: String(item?.stationinfo?.standardname || item?.station || item?.direction?.name || "Onbekende richting"),
      origin: stationName,
      plannedDeparture: planned,
      realtimeDeparture: realtime || planned,
      delayMinutes: Math.round(delaySeconds / 60),
      platform: String(item?.platforminfo?.name || item?.platform || ""),
      platformChanged: item?.platforminfo?.normal === "0" || item?.platforminfo?.normal === 0,
      realtime: true,
      cancelled: item?.canceled === "1" || item?.canceled === 1 || item?.canceled === true,
      vehicleId: String(item?.vehicle || ""),
      source: "irail-direct"
    };
  }

  async function directNearbyRail(lat, lon, radius, maxPlaces, maxDepartures) {
    try {
      const stationsUrl = new URL("https://api.irail.be/stations/");
      stationsUrl.searchParams.set("format", "json");
      stationsUrl.searchParams.set("lang", "nl");
      const { response, data } = await fetchJson(stationsUrl, { mode: "cors" });
      if (!response.ok) return [];
      const stations = asArray(data?.station).map(item => ({
        id: String(item.id || item["@id"] || ""),
        name: String(item.standardname || item.name || "Station"),
        latitude: Number(item.locationY),
        longitude: Number(item.locationX)
      })).filter(item => item.id && Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
        .map(item => ({ ...item, distanceMeters: Math.round(haversineMeters(lat, lon, item.latitude, item.longitude)) }))
        .filter(item => item.distanceMeters <= Math.max(radius, 5000))
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, Math.min(2, maxPlaces));

      return await Promise.all(stations.map(async station => {
        try {
          const liveboard = new URL("https://api.irail.be/liveboard/");
          liveboard.searchParams.set("id", station.id);
          liveboard.searchParams.set("format", "json");
          liveboard.searchParams.set("lang", "nl");
          liveboard.searchParams.set("arrdep", "departure");
          liveboard.searchParams.set("alerts", "false");
          const { response, data } = await fetchJson(liveboard, { mode: "cors" });
          if (!response.ok) throw new Error();
          return {
            type: "station", mode: "train", id: station.id, name: station.name, operator: "NMBS/SNCB",
            distanceMeters: station.distanceMeters, latitude: station.latitude, longitude: station.longitude,
            departures: asArray(data?.departures?.departure).slice(0, maxDepartures).map(item => normalizeIRailDeparture(item, station.name))
          };
        } catch {
          return { type: "station", mode: "train", ...station, operator: "NMBS/SNCB", departures: [], liveUnavailable: true };
        }
      }));
    } catch {
      return [];
    }
  }

  async function nearby({ lat, lon, radius = 2500, maxPlaces = 6, maxDepartures = 3 }) {
    const capabilities = await detect();
    if (capabilities.v4) {
      const url = new URL("/api/v4/nearby", location.origin);
      url.searchParams.set("lat", lat);
      url.searchParams.set("lon", lon);
      url.searchParams.set("radius", radius);
      url.searchParams.set("maxPlaces", maxPlaces);
      url.searchParams.set("maxDepartures", maxDepartures);
      const { response, data } = await fetchJson(url);
      if (response.ok) return { ...data, compatibility: "v4" };
      if (response.status !== 404) throw new Error(data?.message || `OVFlow Core HTTP ${response.status}`);
      state.v4 = false;
    }

    const url = new URL("/api/delijn/nearby", location.origin);
    url.searchParams.set("lat", lat);
    url.searchParams.set("lon", lon);
    url.searchParams.set("radius", radius);
    url.searchParams.set("max", Math.min(maxPlaces, 6));
    const { response, data } = await fetchJson(url);
    if (!response.ok) throw new Error(data?.message || `OVFlow Core HTTP ${response.status}`);

    const stops = asArray(data?.stops || data?.haltes).map(normalizeLegacyStop).slice(0, Math.min(maxPlaces, 6));
    await Promise.all(stops.map(async place => {
      if (!place.entity || !place.stop) return;
      try {
        const result = await stopDepartures(place.entity, place.stop, maxDepartures);
        place.departures = result.departures;
      } catch {
        place.liveUnavailable = true;
      }
    }));

    const rail = await directNearbyRail(lat, lon, radius, maxPlaces, maxDepartures);
    const places = [...stops, ...rail].sort((a, b) => Number(a.distanceMeters || 0) - Number(b.distanceMeters || 0)).slice(0, maxPlaces);
    return { ok: true, places, compatibility: "legacy", updatedAt: new Date().toISOString() };
  }

  async function health(force = false) {
    const capabilities = await detect(force);
    return {
      ok: Boolean(capabilities.v4 || capabilities.legacy),
      mode: capabilities.v4 ? "v4" : capabilities.legacy ? "legacy" : "offline"
    };
  }

  window.OVFlowCore = { detect, health, stopDepartures, nearby, fetchJson };
})();
