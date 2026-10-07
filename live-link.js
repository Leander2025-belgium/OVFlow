(() => {
  "use strict";

  const PREFIX = "ovflow-live-page:";

  const str = value => String(value ?? "").trim();
  const num = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const iso = value => {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  function compactStop(stop = {}) {
    return {
      name: str(stop.name || stop.stopName || stop.omschrijvingLang || stop.omschrijving || stop.label),
      municipality: str(stop.municipality || stop.omschrijvingGemeente || stop.city),
      stopId: str(stop.stopId || stop.stop || stop.haltenummer || stop.id),
      entity: str(stop.entity || stop.entiteit || stop.entiteitnummer),
      lat: num(stop.lat ?? stop.latitude ?? stop.geoCoordinaat?.latitude),
      lon: num(stop.lon ?? stop.lng ?? stop.longitude ?? stop.geoCoordinaat?.longitude),
      arrival: iso(stop.arrival || stop.scheduledArrival),
      departure: iso(stop.departure || stop.scheduledDeparture),
      platform: str(stop.platform || stop.track || stop.bay || stop.scheduledTrack)
    };
  }

  function normalizeDeparture(departure = {}, stop = {}) {
    const raw = departure?.raw && typeof departure.raw === "object" ? departure.raw : departure;
    const rawStop = raw?.rawStopTime || {};
    const place = rawStop?.place || {};
    const stopData = compactStop({
      ...stop,
      name: stop?.name || raw?.stopName || place?.name,
      stopId: stop?.stopId || stop?.stop || raw?.stopId || place?.stopId,
      lat: stop?.lat ?? stop?.latitude ?? raw?.stopLatitude ?? place?.lat,
      lon: stop?.lon ?? stop?.longitude ?? stop?.lng ?? raw?.stopLongitude ?? place?.lon,
      platform: raw?.platform || place?.track || place?.scheduledTrack,
      municipality: stop?.municipality || place?.municipality
    });

    return {
      kind: "departure",
      createdAt: new Date().toISOString(),
      line: str(raw?.line || raw?.routeShortName || rawStop?.routeShortName || departure?.line),
      tripId: str(raw?.tripId || rawStop?.tripId || departure?.tripId),
      destination: str(raw?.destination || raw?.headsign || rawStop?.headsign || departure?.destination),
      operator: str(raw?.operator || raw?.agencyName || rawStop?.agencyName || departure?.operator || stop?.operator),
      mode: str(raw?.mode || rawStop?.mode || departure?.mode || stop?.mode || "BUS").toUpperCase(),
      plannedDeparture: iso(raw?.plannedDeparture || raw?.scheduledDeparture || departure?.plannedDate || departure?.plannedDeparture),
      realtimeDeparture: iso(raw?.realtimeDeparture || raw?.departure || departure?.realtimeDate || departure?.effectiveDate),
      delayMinutes: num(raw?.delayMinutes ?? departure?.delayMinutes) ?? 0,
      realtime: Boolean(raw?.realtime ?? raw?.realTime ?? departure?.realtimeDate),
      cancelled: Boolean(raw?.cancelled || raw?.tripCancelled || departure?.cancelled),
      platform: str(raw?.platform || raw?.bay || departure?.platform),
      area: str(stopData.municipality || stop?.municipality || ""),
      stop: stopData,
      preloadedStops: []
    };
  }

  function normalizeLeg(leg = {}) {
    const from = compactStop(leg.fromPlace || leg.from || {});
    const to = compactStop(leg.toPlace || leg.to || {});
    const middle = Array.isArray(leg.intermediateStops) ? leg.intermediateStops.map(compactStop) : [];
    const stops = [from, ...middle, to].filter(s => s.name || (s.lat !== null && s.lon !== null));

    return {
      kind: "leg",
      createdAt: new Date().toISOString(),
      line: str(leg.line || leg.routeShortName || leg.displayName),
      tripId: str(leg.tripId),
      destination: str(leg.headsign || to.name),
      operator: str(leg.operator || leg.agencyName),
      mode: str(leg.mode || "BUS").toUpperCase(),
      plannedDeparture: iso(leg.scheduledStartTime || leg.startTime || leg.start),
      realtimeDeparture: iso(leg.startTime || leg.start),
      delayMinutes: 0,
      realtime: Boolean(leg.realtime || leg.realTime),
      cancelled: Boolean(leg.cancelled),
      platform: str(from.platform),
      area: str(from.municipality),
      stop: from,
      preloadedStops: stops
    };
  }

  function saveAndOpen(payload) {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    try {
      sessionStorage.setItem(PREFIX + key, JSON.stringify(payload));
    } catch (error) {
      console.warn("OVFlow Live pagina sessionStorage:", error);
    }

    const url = new URL("live.html", window.location.href);
    url.searchParams.set("k", key);
    if (payload.line) url.searchParams.set("line", payload.line);
    if (payload.tripId) url.searchParams.set("tripId", payload.tripId);
    if (payload.destination) url.searchParams.set("destination", payload.destination);
    if (payload.area) url.searchParams.set("area", payload.area);
    window.location.assign(url.href);
  }

  function open(departure, stop = {}) {
    const payload = normalizeDeparture(departure, stop);
    if (!payload.line && !payload.tripId) throw new Error("Deze rit bevat geen lijn- of tripinformatie.");
    saveAndOpen(payload);
  }

  function openLeg(leg) {
    const payload = normalizeLeg(leg);
    if (!payload.line && !payload.tripId) throw new Error("Deze rit bevat geen lijn- of tripinformatie.");
    saveAndOpen(payload);
  }

  window.OVFlowLivePage = { open, openLeg, compactStop };
})();
