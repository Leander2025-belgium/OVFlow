(() => {
  "use strict";

  const bridge = window.OVFlowBridge;
  const plannerBridge = window.OVFlowPlannerBridge;
  const cfg = window.OVFLOW_CONFIG || {};
  const $ = s => document.querySelector(s);

  if (!bridge || !plannerBridge) {
    console.error("OVFlow Live Rit: vereiste bridge ontbreekt.");
    return;
  }

  const state = {
    lastPosition: null,
    lastQuery: "",
    results: [],
    loading: false
  };

  const esc = bridge.escapeHTML || (v => String(v ?? ""));
  const toast = bridge.toast || console.log;

  function normLine(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/^lijn/, "")
      .replace(/[^a-z0-9]/g, "");
  }

  function haversine(lon1, lat1, lon2, lat2) {
    const R = 6371;
    const rad = v => Number(v) * Math.PI / 180;
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return "--:--";
    return new Intl.DateTimeFormat("nl-BE", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(d);
  }

  function minutesUntil(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return Math.round((d.getTime() - Date.now()) / 60000);
  }

  function setStatus(text, type = "idle") {
    const root = $("#quickLiveStatus");
    root.className = `quick-live-status ${type}`;
    root.querySelector("span:last-child").textContent = text;
  }

  function setLoading(on, title = "", detail = "") {
    state.loading = on;
    $("#quickLiveLoading").classList.toggle("hidden", !on);
    $("#quickLiveSearch").disabled = on;

    if (title) $("#quickLiveLoadingTitle").textContent = title;
    if (detail) $("#quickLiveLoadingText").textContent = detail;
  }

  function showError(message, options = {}) {
    const title = options.title || "Live rit kon niet worden gezocht";
    const status = options.status || "Zoeken mislukt";
    const titleEl = $("#quickLiveErrorTitle");
    if (titleEl) titleEl.textContent = title;
    $("#quickLiveErrorText").textContent = message;
    $("#quickLiveError").classList.remove("hidden");
    setStatus(status, "error");
  }

  function clearError() {
    $("#quickLiveError").classList.add("hidden");
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Je browser ondersteunt geen locatie."));
        return;
      }

      navigator.geolocation.getCurrentPosition(pos => {
        resolve({
          lat: Number(pos.coords.latitude),
          lon: Number(pos.coords.longitude),
          accuracy: Number(pos.coords.accuracy)
        });
      }, () => {
        reject(new Error("Geef OVFlow toegang tot je locatie om ritten rond je te vinden."));
      }, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 5000
      });
    });
  }

  async function nearestStops(position) {
    await bridge.ensureStopsLoaded();

    return bridge.getStops()
      .filter(stop =>
        Number.isFinite(Number(stop.lat)) &&
        Number.isFinite(Number(stop.lon)) &&
        stop.stop &&
        (stop.entity || /^\d{6,7}$/.test(String(stop.stop)))
      )
      .map(stop => ({
        ...stop,
        distanceKm: haversine(position.lon, position.lat, stop.lon, stop.lat)
      }))
      .filter(stop => stop.distanceKm <= 2.5)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 12);
  }

  async function fetchNearbyDepartures(stops, query) {
    const wanted = normLine(query);
    const batches = [];
    let done = 0;

    for (let i = 0; i < stops.length; i += 4) {
      const batch = stops.slice(i, i + 4);
      const data = await Promise.all(batch.map(async stop => {
        try {
          const departures = await bridge.fetchDeparturesForStop(stop, 14);
          return departures.map(dep => ({ stop, dep }));
        } catch (error) {
          console.debug("Live Rit halte:", stop.name, error);
          return [];
        } finally {
          done += 1;
          $("#quickLiveLoadingText").textContent =
            `${done}/${stops.length} haltes gecontroleerd`;
        }
      }));
      batches.push(...data.flat());
    }

    const filtered = batches.filter(item => {
      const line = normLine(item.dep.line);
      if (!wanted) return true;
      return line === wanted || line.includes(wanted) || wanted.includes(line);
    });

    const seen = new Set();
    const unique = [];

    for (const item of filtered.sort((a, b) => a.dep.effectiveDate - b.dep.effectiveDate)) {
      const key = [
        normLine(item.dep.line),
        String(item.dep.destination || "").toLowerCase(),
        Math.round(item.dep.effectiveDate.getTime() / 60000)
      ].join("|");

      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }

    return unique.slice(0, 12);
  }

  function renderResults(results, query) {
    state.results = results;
    const list = $("#quickLiveResultList");
    const panel = $("#quickLiveResults");

    $("#quickLiveResultsTitle").textContent = query
      ? `Lijn ${query} rond je`
      : "Ritten rond je";
    $("#quickLiveResultCount").textContent = String(results.length);

    if (!results.length) {
      list.innerHTML = `
        <div class="quick-live-empty">
          <strong>Geen passende rit gevonden</strong>
          <span>Probeer zonder lijnnummer, een andere lijn, of zoek opnieuw wanneer het voertuig dichterbij is.</span>
        </div>`;
      panel.classList.remove("hidden");
      return;
    }

    list.innerHTML = results.map((item, index) => {
      const mins = minutesUntil(item.dep.effectiveDate);
      const when = mins == null ? "" : mins <= 0 ? "nu" : `over ${mins} min`;
      const distance = item.stop.distanceKm < 1
        ? `${Math.round(item.stop.distanceKm * 1000)} m`
        : `${item.stop.distanceKm.toFixed(1).replace(".", ",")} km`;

      return `
        <article class="quick-live-result">
          <div class="quick-live-line">${esc(item.dep.line)}</div>
          <div class="quick-live-result-main">
            <span>${esc(item.stop.name)}</span>
            <strong>Richting ${esc(item.dep.destination)}</strong>
            <small>${distance} van jou · ${item.dep.realtimeDate ? "realtime" : "dienstregeling"}</small>
          </div>
          <div class="quick-live-result-time">
            <strong>${formatTime(item.dep.effectiveDate)}</strong>
            <span>${when}</span>
          </div>
          <button type="button" class="quick-live-start" data-quick-start="${index}">
            Start Live rit
          </button>
        </article>`;
    }).join("");

    [...list.querySelectorAll("[data-quick-start]")].forEach(button => {
      button.addEventListener("click", () => {
        startCandidate(Number(button.dataset.quickStart));
      });
    });

    panel.classList.remove("hidden");
  }

  function destinationQueries(destination) {
    const raw = String(destination || "").trim();
    const variants = [
      raw,
      raw.replace(/^richting\s+/i, ""),
      raw.replace(/\s+(perron|platform)\s*\d+$/i, ""),
      raw.split(" - ")[0]
    ]
      .map(s => s.trim())
      .filter(Boolean);

    return [...new Set(variants)];
  }

  function findDestinationStops(destination, fromStop) {
    const collected = [];

    for (const query of destinationQueries(destination)) {
      for (const stop of bridge.searchStops(query).slice(0, 8)) {
        const distance = haversine(fromStop.lon, fromStop.lat, stop.lon, stop.lat);
        if (distance < 0.25) continue;

        const key = stop.stop || `${stop.name}|${stop.lon}|${stop.lat}`;
        if (!collected.some(x => (x.stop || `${x.name}|${x.lon}|${x.lat}`) === key)) {
          collected.push({ ...stop, routeDistance: distance });
        }
      }
    }

    return collected
      .sort((a, b) => b.routeDistance - a.routeDistance)
      .slice(0, 5);
  }

  function rawLegLine(leg) {
    return String(
      leg?.routeShortName ||
      leg?.route?.shortName ||
      leg?.displayName ||
      ""
    );
  }

  function rawLegMode(leg) {
    return String(leg?.mode || "").toUpperCase();
  }

  async function findTransitLegForCandidate(candidate) {
    await bridge.ensureStopsLoaded();

    const destinations = findDestinationStops(candidate.dep.destination, candidate.stop);
    if (!destinations.length) {
      throw new Error(`Eindhalte “${candidate.dep.destination}” kon niet op de kaart worden gevonden.`);
    }

    const wanted = normLine(candidate.dep.line);
    let best = null;

    for (const dest of destinations) {
      const url = new URL("https://api.transitous.org/api/v6/plan");
      url.searchParams.set("fromPlace", `${candidate.stop.lat},${candidate.stop.lon}`);
      url.searchParams.set("toPlace", `${dest.lat},${dest.lon}`);
      url.searchParams.set("time", candidate.dep.effectiveDate.toISOString());
      url.searchParams.set("arriveBy", "false");
      url.searchParams.set("transitModes", "TRANSIT");
      url.searchParams.set("directModes", "");
      url.searchParams.set("maxTransfers", "0");
      url.searchParams.set("numItineraries", "6");
      url.searchParams.set("radius", "180");
      url.searchParams.set("detailedLegs", "true");
      url.searchParams.set("detailedTransfers", "true");
      url.searchParams.set("joinInterlinedLegs", "false");
      url.searchParams.set("withScheduledSkippedStops", "true");
      url.searchParams.set("realtimeMode", "REALTIME");
      url.searchParams.set("language", "nl");

      let response;
      try {
        response = await fetch(url.toString(), {
          headers: { "Accept": "application/json" },
          cache: "no-store"
        });
      } catch {
        continue;
      }

      if (!response.ok) continue;
      const data = await response.json();
      const itineraries = data?.itineraries || data?.plan?.itineraries || [];

      for (const itinerary of itineraries) {
        for (const leg of (itinerary.legs || [])) {
          const line = normLine(rawLegLine(leg));
          const mode = rawLegMode(leg);

          if (mode === "WALK") continue;

          const sameLine = line === wanted || line.includes(wanted) || wanted.includes(line);
          if (!sameLine) continue;

          const score =
            (String(leg.headsign || leg.tripHeadsign || "").toLowerCase()
              .includes(String(candidate.dep.destination || "").toLowerCase()) ? 30 : 0) +
            ((leg.intermediateStops || []).length * 2) +
            dest.routeDistance;

          if (!best || score > best.score) best = { leg, score };
        }
      }

      if (best?.score >= 30) break;
    }

    if (!best) {
      throw new Error(`De haltevolgorde van lijn ${candidate.dep.line} kon nu niet worden gekoppeld.`);
    }

    return best.leg;
  }

  async function startCandidate(index) {
    const candidate = state.results[index];
    if (!candidate) return;

    clearError();
    setLoading(
      true,
      `Lijn ${candidate.dep.line} voorbereiden…`,
      "Volledige haltevolgorde en realtime rit zoeken"
    );

    try {
      const leg = await findTransitLegForCandidate(candidate);
      plannerBridge.startLiveTripFromExternalLeg(leg);

      setStatus(
        `Live Trip gestart: lijn ${candidate.dep.line} richting ${candidate.dep.destination}`,
        "online"
      );

      toast(`Live rit lijn ${candidate.dep.line} gestart`);
    } catch (error) {
      showError(error?.message || "Deze rit kon niet worden gestart.", {
        title: "Live Trip kon niet worden gestart",
        status: "Starten mislukt"
      });
    } finally {
      setLoading(false);
    }
  }

  async function search() {
    if (state.loading) return;

    const query = $("#quickLiveLine").value.trim();
    state.lastQuery = query;
    clearError();
    $("#quickLiveResults").classList.add("hidden");

    setLoading(true, "Je locatie bepalen…", "Geen eigen OVFlow-server nodig");
    setStatus("Rechtstreeks verbinden met De Lijn…", "loading");

    try {
      const position = await getPosition();
      state.lastPosition = position;

      $("#quickLiveLoadingTitle").textContent = "Haltes rond je zoeken…";
      $("#quickLiveLoadingText").textContent = `GPS ±${Math.round(position.accuracy)} m`;

      const stops = await nearestStops(position);
      if (!stops.length) {
        throw new Error("Er zijn geen bruikbare De Lijn-haltes binnen 2,5 km gevonden.");
      }

      $("#quickLiveLoadingTitle").textContent = query
        ? `Lijn ${query} zoeken…`
        : "Realtime ritten zoeken…";
      $("#quickLiveLoadingText").textContent = `${stops.length} dichtstbijzijnde haltes controleren`;

      const results = await fetchNearbyDepartures(stops, query);
      renderResults(results, query);

      setStatus(
        results.length
          ? `${results.length} realtime rit${results.length === 1 ? "" : "ten"} gevonden`
          : "Geen passende rit in de buurt",
        results.length ? "online" : "warning"
      );
    } catch (error) {
      const msg = String(error?.message || error || "");

      if (/401/.test(msg)) {
        showError("De De Lijn Core API-sleutel wordt geweigerd.");
      } else if (/403/.test(msg)) {
        showError("De Lijn geeft geen toegang tot de Core API.");
      } else if (/Failed to fetch|Load failed|NetworkError|CORS/i.test(msg)) {
        showError("De browser kon De Lijn niet rechtstreeks bereiken. Open OVFlow via https:// of localhost, niet via file://.");
      } else {
        showError(msg || "Onbekende fout.");
      }
    } finally {
      setLoading(false);
    }
  }

  $("#quickLiveSearch").addEventListener("click", search);
  $("#quickLiveRetry").addEventListener("click", search);

  $("#quickLiveLine").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      search();
    }
  });

  $("#quickLiveClear").addEventListener("click", () => {
    $("#quickLiveLine").value = "";
    $("#quickLiveResults").classList.add("hidden");
    clearError();
    setStatus("Geen eigen server nodig.", "idle");
    $("#quickLiveLine").focus();
  });

  setStatus("Geen eigen server nodig.", "idle");
})();
