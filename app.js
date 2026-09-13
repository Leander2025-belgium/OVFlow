(() => {
  "use strict";

  const cfg = window.OVFLOW_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const state = {
    stop: loadStop(),
    autoRefresh: localStorage.getItem("ovflow:autoRefresh") !== "false",
    timer: null,
    loading: false,
    lastData: [],
    stops: [],
    stopsLoading: false,
    stopsLoaded: false,
    map: null,
    markers: [],
    selectedMarker: null,
    userLocation: null
  };

  function loadStop() {
    const fallback = cfg.DEFAULT_STOP || { name: "Kies een halte", entity: "", stop: "", maxDepartures: 6 };
    try {
      const saved = JSON.parse(localStorage.getItem("ovflow:stop") || "null");
      return saved && saved.stop ? { ...fallback, ...saved } : fallback;
    } catch {
      return fallback;
    }
  }

  function saveStop() {
    localStorage.setItem("ovflow:stop", JSON.stringify(state.stop));
  }

  let toastTimer;
  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2300);
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setApiState(type, text) {
    const button = $("#apiStatusButton");
    button.classList.remove("loading", "online", "error");
    button.classList.add(type);
    $("#apiStatusText").textContent = text;
    $("#insightApi").textContent = text;

    if (type === "online") {
      $("#coreApiState").textContent = "Verbonden";
      $("#coreApiState").className = "state-ok";
      $("#stopApiState").textContent = "Live";
      $("#stopApiState").className = "state-ok";
    } else if (type === "error") {
      $("#coreApiState").textContent = "Fout";
      $("#coreApiState").className = "state-error";
      $("#stopApiState").textContent = "Niet beschikbaar";
      $("#stopApiState").className = "state-error";
    } else {
      $("#coreApiState").textContent = "Verbinden…";
      $("#coreApiState").className = "";
      $("#stopApiState").textContent = "Controleren…";
      $("#stopApiState").className = "";
    }
  }

  function updateStopUI() {
    const hasStop = !!state.stop?.stop;
    $("#activeStopName").textContent = hasStop ? (state.stop.name || `Halte ${state.stop.stop}`) : "Kies een halte";
    $("#activeStopCode").textContent = hasStop
      ? `De Lijn halte ${state.stop.stop}${state.stop.entity ? ` · entiteit ${state.stop.entity}` : ""}`
      : "Zoek hierboven om live doorkomsten te zien";

    $("#stopNameInput").value = state.stop.name || "";
    $("#entityInput").value = state.stop.entity || "";
    $("#stopNumberInput").value = state.stop.stop || "";
    $("#maxDeparturesSelect").value = String(state.stop.maxDepartures || 6);
  }

  function parseDate(raw) {
    if (!raw) return null;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
    const match = String(raw).match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      const now = new Date();
      now.setHours(Number(match[1]), Number(match[2]), Number(match[3] || 0), 0);
      return now;
    }
    return null;
  }

  function formatTime(date) {
    if (!date) return "--:--";
    return new Intl.DateTimeFormat("nl-BE", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }

  function minutesUntil(date) {
    if (!date) return null;
    return Math.round((date.getTime() - Date.now()) / 60000);
  }

  function normalizeDeparture(d) {
    const realtimeRaw =
      d["real-timeTijdstip"] ?? d.realTimeTijdstip ?? d.realtimeTijdstip ?? d.realTime ?? d.realtime ?? null;
    const scheduledRaw =
      d.dienstregelingTijdstip ?? d.geplandeTijdstip ?? d.tijdstip ?? d.scheduledTime ?? null;

    const realtimeDate = parseDate(realtimeRaw);
    const scheduledDate = parseDate(scheduledRaw);
    const effectiveDate = realtimeDate || scheduledDate;

    const line = d.lijnnummer ?? d.lijnNummer ?? d.lineNumber ?? d.lijn?.lijnnummer ?? d.lijn?.nummer ?? "?";
    const destination =
      d.bestemming ?? d.bestemmingNaam ?? d.richting ?? d.destination ??
      d.bestemming?.omschrijving ?? d.lijnrichting ?? "Bestemming onbekend";

    let delayMinutes = null;
    if (realtimeDate && scheduledDate) delayMinutes = Math.round((realtimeDate - scheduledDate) / 60000);
    else if (typeof d.afwijking === "number") delayMinutes = Math.round(d.afwijking / 60);

    return {
      line: String(line),
      destination: String(destination),
      effectiveDate,
      realtimeDate,
      scheduledDate,
      delayMinutes,
      raw: d
    };
  }

  function extractDepartures(json) {
    const groups = json?.halteDoorkomsten ?? json?.doorkomstenPerHalte ?? json?.departures ?? [];
    let rows = [];
    if (Array.isArray(groups)) {
      for (const group of groups) {
        const list = group?.doorkomsten ?? group?.departures ?? (Array.isArray(group) ? group : []);
        if (Array.isArray(list)) rows.push(...list);
      }
    }
    if (!rows.length && Array.isArray(json?.doorkomsten)) rows = json.doorkomsten;

    return rows
      .map(normalizeDeparture)
      .filter(item => item.effectiveDate)
      .sort((a, b) => a.effectiveDate - b.effectiveDate)
      .slice(0, Number(state.stop.maxDepartures || 6));
  }

  function renderDepartures(items) {
    state.lastData = items;
    const container = $("#departures");
    container.innerHTML = "";

    $("#departureCount").textContent = String(items.length);
    $("#delayCount").textContent = String(items.filter(i => Number(i.delayMinutes) > 1).length);

    if (!items.length) {
      $("#nextDeparture").textContent = "—";
      $("#insightNextLine").textContent = "Geen rit gevonden";
      $("#insightNextMeta").textContent = "Voor deze halte zijn nu geen doorkomsten beschikbaar.";
      $("#emptyCard").classList.remove("hidden");
      return;
    }

    $("#emptyCard").classList.add("hidden");
    const first = items[0];
    const mins = minutesUntil(first.effectiveDate);
    $("#nextDeparture").textContent = mins == null ? "—" : mins <= 0 ? "Nu" : `${mins} min`;
    $("#insightNextLine").textContent = `Lijn ${first.line} → ${first.destination}`;
    $("#insightNextMeta").textContent = `${formatTime(first.effectiveDate)} · ${mins == null ? "live" : mins <= 0 ? "vertrekt nu" : `over ${mins} min`}`;

    container.innerHTML = items.map(item => {
      const minsAway = minutesUntil(item.effectiveDate);
      const delayed = Number(item.delayMinutes) > 1;
      const isRealtime = !!item.realtimeDate;
      let status = isRealtime ? "Realtime" : "Gepland";
      let cls = isRealtime ? "" : "scheduled";
      if (delayed) { status = `+${item.delayMinutes} min`; cls = "delay"; }
      else if (minsAway != null && minsAway <= 1) status = "Nu";

      return `
        <article class="departure-card">
          <div class="line-badge">${escapeHTML(item.line)}</div>
          <div class="departure-main">
            <strong>${escapeHTML(item.destination)}</strong>
            <span>${isRealtime ? "Live doorkomst" : "Volgens dienstregeling"} · De Lijn</span>
          </div>
          <div class="departure-time">
            <strong>${formatTime(item.effectiveDate)}</strong>
            <span class="${cls}">${status}</span>
          </div>
        </article>`;
    }).join("");
  }

  function errorDescription(error) {
    const message = String(error?.message || error || "");
    if (/401/.test(message)) return ["API-sleutel geweigerd", "De Core API geeft 401. Controleer de Core API-sleutel in config.js."];
    if (/403/.test(message)) return ["Geen toegang tot De Lijn API", "De API geeft 403. Controleer je De Lijn-abonnement."];
    if (/404/.test(message)) return ["Realtime halte niet gevonden", "De halte werd op de kaart gevonden, maar De Lijn herkende dit haltenummer niet voor realtime-data."];
    if (/429/.test(message)) return ["Te veel aanvragen", "De Lijn heeft tijdelijk een rate-limit toegepast."];
    if (/Failed to fetch|NetworkError|CORS|Load failed/i.test(message)) {
      return ["Browser blokkeert de API-oproep", "Waarschijnlijk CORS of netwerk. Open OVFlow via http://localhost in plaats van rechtstreeks via file://."];
    }
    return ["Live data kon niet worden geladen", message || "Onbekende fout bij De Lijn."];
  }

  async function resolveEntityIfNeeded() {
    if (state.stop.entity) return;
    const digits = String(state.stop.stop || "").replace(/\D/g, "");
    if (digits.length >= 6) {
      state.stop.entity = digits[0];
      return;
    }

    // Fallback: probeer halte-detail uit de Core API.
    const url = `${cfg.CORE_BASE_URL}/haltes/${encodeURIComponent(state.stop.stop)}`;
    const response = await fetch(url, {
      headers: { "Accept": "application/json", "Ocp-Apim-Subscription-Key": cfg.DELIJN_CORE_KEY },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`De Lijn API HTTP ${response.status}`);
    const detail = await response.json();
    state.stop.entity = String(detail.entiteitnummer ?? detail.entiteitNummer ?? detail.entiteit ?? "").trim();
  }

  async function fetchLive() {
    if (state.loading) return;
    if (!state.stop?.stop) {
      $("#loadingCard").classList.add("hidden");
      $("#departures").innerHTML = "";
      $("#emptyCard").classList.remove("hidden");
      $("#emptyCard strong").textContent = "Zoek eerst een halte";
      $("#emptyCard span").textContent = "Kies bovenaan een echte De Lijn-halte om de doorkomsten te laden.";
      setApiState("loading", "Kies halte");
      return;
    }

    state.loading = true;
    $("#loadingCard").classList.remove("hidden");
    $("#errorCard").classList.add("hidden");
    $("#emptyCard").classList.add("hidden");
    $("#departures").innerHTML = "";
    $("#refreshButton").classList.add("spinning");
    $("#navRefresh")?.classList.add("spinning");
    setApiState("loading", "Verbinden…");

    try {
      await resolveEntityIfNeeded();
      if (!state.stop.entity) throw new Error("Geen entiteitnummer voor deze halte gevonden");

      const endpoint =
        `${cfg.CORE_BASE_URL}/haltes/${encodeURIComponent(state.stop.entity)}/${encodeURIComponent(state.stop.stop)}` +
        `/real-time?maxAantalDoorkomsten=${encodeURIComponent(state.stop.maxDepartures || 6)}`;

      const response = await fetch(endpoint, {
        method: "GET",
        mode: "cors",
        cache: "no-store",
        headers: {
          "Accept": "application/json",
          "Cache-Control": "no-cache",
          "Ocp-Apim-Subscription-Key": cfg.DELIJN_CORE_KEY
        }
      });

      if (!response.ok) throw new Error(`De Lijn API HTTP ${response.status}`);
      const data = await response.json();
      const departures = extractDepartures(data);

      $("#loadingCard").classList.add("hidden");
      renderDepartures(departures);
      $("#lastUpdated").textContent = `${formatTime(new Date())} live`;
      setApiState("online", "De Lijn live");
    } catch (error) {
      console.error("OVFlow live error:", error);
      $("#loadingCard").classList.add("hidden");
      const [title, message] = errorDescription(error);
      $("#errorTitle").textContent = title;
      $("#errorMessage").textContent = message;
      $("#errorCard").classList.remove("hidden");
      $("#departureCount").textContent = "—";
      $("#nextDeparture").textContent = "—";
      $("#delayCount").textContent = "—";
      $("#insightNextLine").textContent = "Geen live verbinding";
      $("#insightNextMeta").textContent = message;
      setApiState("error", "API-fout");
    } finally {
      state.loading = false;
      $("#refreshButton").classList.remove("spinning");
      $("#navRefresh")?.classList.remove("spinning");
    }
  }

  // ---------- Echte haltecatalogus via WFS ----------

  function bestProp(props, names) {
    const entries = Object.entries(props || {});
    for (const wanted of names) {
      const hit = entries.find(([key, value]) => key.toLowerCase().replace(/[_\s-]/g, "").includes(wanted) && value != null && String(value).trim());
      if (hit) return hit[1];
    }
    return null;
  }

  function numericStopCandidate(props) {
    const preferred = bestProp(props, ["haltenummer", "haltenr", "haltenum", "stopid", "stopcode", "haltenummer"]);
    if (preferred != null) return String(preferred).replace(/\D/g, "") || String(preferred);

    // Zoek daarna een plausibel 5-7 cijferig haltenummer.
    for (const [key, value] of Object.entries(props || {})) {
      if (/objectid|fid|shape|lengte|xcoord|ycoord/i.test(key)) continue;
      const digits = String(value ?? "").replace(/\D/g, "");
      if (/^\d{5,7}$/.test(digits)) return digits;
    }
    return "";
  }

  function normalizeCoordinates(coords) {
    if (!Array.isArray(coords) || coords.length < 2) return [null, null];
    let a = Number(coords[0]), b = Number(coords[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return [null, null];

    // België: lon ~2–6, lat ~49–52. Corrigeer eventuele asomkering.
    if (a > 20 && b < 20) [a, b] = [b, a];
    return [a, b];
  }

  function normalizeStopFeature(feature) {
    const p = feature?.properties || {};
    const [lon, lat] = normalizeCoordinates(feature?.geometry?.coordinates || []);

    const stop = numericStopCandidate(p);
    const entityRaw = bestProp(p, ["entiteitnummer", "entiteitnr", "entiteit"]);
    const entity = entityRaw != null
      ? String(entityRaw).replace(/\D/g, "")
      : (/^\d{6,7}$/.test(stop) ? stop[0] : "");

    let name = bestProp(p, ["omschrijving", "haltenaam", "haltebenaming", "stopname", "naam"]);
    let municipality = bestProp(p, ["gemeentenaam", "gemeente", "plaatsnaam", "plaats"]);
    let street = bestProp(p, ["straatnaam", "straat", "adres"]);

    if (!name) {
      const strings = Object.entries(p)
        .filter(([k, v]) => typeof v === "string" && v.trim().length > 2 && !/url|id|code|status/i.test(k))
        .map(([, v]) => v.trim())
        .sort((a, b) => b.length - a.length);
      name = strings[0] || `Halte ${stop || feature.id || ""}`;
    }

    const searchText = Object.values(p)
      .filter(v => v != null)
      .map(v => String(v).toLowerCase())
      .join(" ");

    return {
      id: String(feature.id || `${stop}-${lon}-${lat}`),
      stop,
      entity,
      name: String(name || "").trim(),
      municipality: String(municipality || "").trim(),
      street: String(street || "").trim(),
      lon,
      lat,
      searchText,
      raw: p
    };
  }

  async function fetchStopBatch(startIndex) {
    const url = new URL(cfg.HALTES_WFS_URL);
    url.searchParams.set("service", "WFS");
    url.searchParams.set("request", "GetFeature");
    url.searchParams.set("typename", cfg.HALTES_WFS_TYPENAME || "Haltes:Halte");
    url.searchParams.set("srsName", "EPSG:4326");
    url.searchParams.set("startIndex", String(startIndex));
    url.searchParams.set("maxFeatures", String(cfg.HALTES_BATCH_SIZE || 10000));
    url.searchParams.set("outputFormat", "application/json");

    const response = await fetch(url.toString(), { cache: "force-cache" });
    if (!response.ok) throw new Error(`Haltekaart HTTP ${response.status}`);
    return response.json();
  }

  async function ensureStopsLoaded() {
    if (state.stopsLoaded) return state.stops;
    if (state.stopsLoading) {
      while (state.stopsLoading) await new Promise(r => setTimeout(r, 120));
      return state.stops;
    }

    state.stopsLoading = true;
    $("#stopSearchStatus").textContent = "Echte haltecatalogus laden…";
    try {
      const batchSize = Number(cfg.HALTES_BATCH_SIZE || 10000);
      const all = [];
      for (let start = 0; start < 50000; start += batchSize) {
        const json = await fetchStopBatch(start);
        const features = Array.isArray(json?.features) ? json.features : [];
        all.push(...features.map(normalizeStopFeature).filter(s => s.name && Number.isFinite(s.lon) && Number.isFinite(s.lat)));
        $("#stopSearchStatus").textContent = `${all.length.toLocaleString("nl-BE")} haltes geladen…`;
        if (features.length < batchSize) break;
      }
      state.stops = dedupeStops(all);
      state.stopsLoaded = true;
      $("#stopSearchStatus").textContent = `${state.stops.length.toLocaleString("nl-BE")} echte haltes klaar`;
      return state.stops;
    } catch (error) {
      console.error("WFS haltecatalogus:", error);
      $("#stopSearchStatus").textContent = "Haltezoeker kon niet laden";
      toast("Haltecatalogus kon niet worden geladen");
      throw error;
    } finally {
      state.stopsLoading = false;
    }
  }

  function dedupeStops(stops) {
    const seen = new Set();
    return stops.filter(stop => {
      const key = stop.stop ? `s:${stop.stop}` : `${stop.name}|${stop.lon.toFixed(5)}|${stop.lat.toFixed(5)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function scoreStop(stop, query) {
    const q = query.toLowerCase().trim();
    const name = stop.name.toLowerCase();
    const municipality = stop.municipality.toLowerCase();
    let score = 0;
    if (name === q) score += 100;
    if (name.startsWith(q)) score += 60;
    if (name.includes(q)) score += 35;
    if (municipality.startsWith(q)) score += 28;
    if (municipality.includes(q)) score += 18;
    if (stop.searchText.includes(q)) score += 8;
    return score;
  }

  function searchStops(query) {
    const q = query.trim();
    if (q.length < 2) return [];
    return state.stops
      .map(stop => ({ stop, score: scoreStop(stop, q) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.stop.name.localeCompare(b.stop.name, "nl"))
      .slice(0, 12)
      .map(x => x.stop);
  }

  function renderStopResults(results) {
    const box = $("#stopResults");
    if (!results.length) {
      box.innerHTML = `<div class="stop-result"><div class="stop-result-copy"><strong>Geen haltes gevonden</strong><span>Probeer een andere plaats- of haltenaam.</span></div></div>`;
      box.classList.remove("hidden");
      return;
    }

    box.innerHTML = results.map((stop, index) => `
      <button class="stop-result" type="button" data-index="${index}">
        <span class="stop-result-icon">H</span>
        <span class="stop-result-copy">
          <strong>${escapeHTML(stop.name)}</strong>
          <span>${escapeHTML([stop.municipality, stop.street, stop.stop ? `halte ${stop.stop}` : ""].filter(Boolean).join(" · "))}</span>
        </span>
        <span class="stop-result-distance">→</span>
      </button>`).join("");

    box.classList.remove("hidden");
    $$(".stop-result[data-index]").forEach(button => {
      button.addEventListener("click", () => selectStop(results[Number(button.dataset.index)]));
    });

    showStopsOnMap(results, false);
  }

  async function selectStop(stop) {
    state.stop = {
      name: [stop.municipality, stop.name].filter(Boolean).join(" · "),
      entity: stop.entity || (/^\d{6,7}$/.test(stop.stop) ? stop.stop[0] : ""),
      stop: stop.stop,
      lat: stop.lat,
      lon: stop.lon,
      maxDepartures: Number(state.stop.maxDepartures || 6)
    };
    saveStop();
    updateStopUI();
    $("#stopSearchInput").value = "";
    $("#stopResults").classList.add("hidden");
    $("#stopSearchStatus").textContent = `${stop.name} geselecteerd`;

    focusMapOnStop(stop);
    showNearbyStops(stop.lon, stop.lat, 30);
    await fetchLive();
  }

  let searchDebounce;
  $("#stopSearchInput").addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const query = $("#stopSearchInput").value.trim();

    if (query.length < 2) {
      $("#stopResults").classList.add("hidden");
      $("#stopSearchStatus").textContent = "Typ minstens 2 letters";
      return;
    }

    searchDebounce = setTimeout(async () => {
      try {
        await ensureStopsLoaded();
        const results = searchStops(query);
        $("#stopSearchStatus").textContent = `${results.length} beste resultaten`;
        renderStopResults(results);
      } catch {}
    }, 260);
  });

  $("#clearSearchButton").addEventListener("click", () => {
    $("#stopSearchInput").value = "";
    $("#stopResults").classList.add("hidden");
    $("#stopSearchStatus").textContent = state.stopsLoaded ? `${state.stops.length.toLocaleString("nl-BE")} echte haltes klaar` : "Zoek in echte De Lijn-haltes";
    $("#stopSearchInput").focus();
  });

  $("#changeStopButton").addEventListener("click", () => {
    $("#stopSearchInput").focus();
    $("#stopSearchInput").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // ---------- MapLibre / OpenStreetMap ----------

  function initMap() {
    if (!window.maplibregl) {
      $("#mapLoading").innerHTML = "<span>Kaartbibliotheek kon niet laden.</span>";
      return;
    }

    const center = state.stop?.lon && state.stop?.lat ? [Number(state.stop.lon), Number(state.stop.lat)] : [4.35, 50.85];
    const zoom = state.stop?.lon ? 14 : 8;

    state.map = new maplibregl.Map({
      container: "ovMap",
      center,
      zoom,
      attributionControl: true,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: [
              "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
              "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
              "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
            ],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors"
          }
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }]
      }
    });

    state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    state.map.on("load", () => {
      $("#mapLoading").classList.add("hidden");
      if (state.stop?.lon && state.stop?.lat) {
        focusMapOnStop({
          name: state.stop.name,
          stop: state.stop.stop,
          entity: state.stop.entity,
          lon: Number(state.stop.lon),
          lat: Number(state.stop.lat),
          municipality: ""
        });
      }
    });
  }

  function clearMarkers() {
    state.markers.forEach(marker => marker.remove());
    state.markers = [];
    state.selectedMarker = null;
  }

  function addStopMarker(stop, selected = false) {
    if (!state.map || !Number.isFinite(stop.lon) || !Number.isFinite(stop.lat)) return null;
    const el = document.createElement("button");
    el.type = "button";
    el.className = `ov-stop-marker${selected ? " selected" : ""}`;
    el.title = stop.name;

    const popup = new maplibregl.Popup({ offset: 12, closeButton: false }).setHTML(`
      <div class="map-popup">
        <strong>${escapeHTML(stop.name)}</strong>
        <span>${escapeHTML([stop.municipality, stop.stop ? `halte ${stop.stop}` : ""].filter(Boolean).join(" · "))}</span>
        <button type="button" class="popup-select">Bekijk doorkomsten</button>
      </div>`);

    const marker = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([stop.lon, stop.lat])
      .setPopup(popup)
      .addTo(state.map);

    popup.on("open", () => {
      const button = popup.getElement()?.querySelector(".popup-select");
      if (button) button.addEventListener("click", () => selectStop(stop), { once: true });
    });

    state.markers.push(marker);
    if (selected) state.selectedMarker = marker;
    return marker;
  }

  function showStopsOnMap(stops, fit = true) {
    if (!state.map) return;
    clearMarkers();

    const selectedId = state.stop?.stop;
    stops.slice(0, 60).forEach(stop => addStopMarker(stop, String(stop.stop) === String(selectedId)));

    if (fit && stops.length) {
      const bounds = new maplibregl.LngLatBounds();
      stops.slice(0, 60).forEach(stop => bounds.extend([stop.lon, stop.lat]));
      state.map.fitBounds(bounds, { padding: 55, maxZoom: 15, duration: 650 });
    }
  }

  function focusMapOnStop(stop) {
    if (!state.map || !Number.isFinite(Number(stop.lon)) || !Number.isFinite(Number(stop.lat))) return;
    showStopsOnMap([stop], false);
    state.map.flyTo({ center: [Number(stop.lon), Number(stop.lat)], zoom: 15.4, duration: 750 });
  }

  function haversine(lon1, lat1, lon2, lat2) {
    const R = 6371;
    const toRad = v => v * Math.PI / 180;
    const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  async function showNearbyStops(lon, lat, count = 35) {
    try {
      await ensureStopsLoaded();
      const nearby = state.stops
        .map(stop => ({ ...stop, distance: haversine(lon, lat, stop.lon, stop.lat) }))
        .sort((a,b) => a.distance-b.distance)
        .slice(0, count);
      showStopsOnMap(nearby, true);
    } catch {}
  }

  $("#nearbyButton").addEventListener("click", async () => {
    if (!navigator.geolocation) {
      toast("Locatie is niet beschikbaar in deze browser");
      return;
    }
    $("#mapLoading").classList.remove("hidden");
    $("#mapLoading").innerHTML = `<div class="spinner"></div><span>Je locatie bepalen…</span>`;

    navigator.geolocation.getCurrentPosition(async pos => {
      const lon = pos.coords.longitude, lat = pos.coords.latitude;
      state.userLocation = { lon, lat };
      await showNearbyStops(lon, lat, 40);
      state.map?.flyTo({ center:[lon,lat], zoom:14.2, duration:650 });
      $("#mapLoading").classList.add("hidden");
    }, () => {
      $("#mapLoading").classList.add("hidden");
      toast("Locatie kon niet worden bepaald");
    }, { enableHighAccuracy:true, timeout:10000 });
  });

  $("#fitStopsButton").addEventListener("click", async () => {
    if (state.stop?.lon && state.stop?.lat) {
      await showNearbyStops(Number(state.stop.lon), Number(state.stop.lat), 40);
    } else {
      toast("Zoek eerst een halte");
      $("#stopSearchInput").focus();
    }
  });

  function setupAutoRefresh() {
    clearInterval(state.timer);
    $("#autoRefreshButton").classList.toggle("off", !state.autoRefresh);
    $("#autoRefreshLabel").textContent = state.autoRefresh ? "Elke 15 sec" : "Uit";
    $("#refreshState").textContent = state.autoRefresh ? "Actief" : "Uit";
    $("#refreshState").className = state.autoRefresh ? "state-ok" : "";
    if (state.autoRefresh) state.timer = setInterval(fetchLive, Number(cfg.AUTO_REFRESH_MS || 15000));
  }

  function openSettings() {
    updateStopUI();
    $("#sheetBackdrop").classList.remove("hidden");
    $("#settingsSheet").classList.add("open");
    $("#settingsSheet").setAttribute("aria-hidden", "false");
  }

  function closeSettings() {
    $("#settingsSheet").classList.remove("open");
    $("#settingsSheet").setAttribute("aria-hidden", "true");
    setTimeout(() => $("#sheetBackdrop").classList.add("hidden"), 240);
  }

  function updateClock() {
    const now = new Date();
    $("#clockTime").textContent = new Intl.DateTimeFormat("nl-BE", { hour: "2-digit", minute: "2-digit", hour12:false }).format(now);
    $("#clockDate").textContent = new Intl.DateTimeFormat("nl-BE", { weekday:"long", day:"numeric", month:"long" }).format(now);
  }

  $("#refreshButton").addEventListener("click", fetchLive);
  $("#refreshNowButton").addEventListener("click", fetchLive);
  $("#navRefresh")?.addEventListener("click", fetchLive);
  $("#retryButton").addEventListener("click", fetchLive);
  $("#apiStatusButton").addEventListener("click", fetchLive);

  $("#autoRefreshButton").addEventListener("click", () => {
    state.autoRefresh = !state.autoRefresh;
    localStorage.setItem("ovflow:autoRefresh", String(state.autoRefresh));
    setupAutoRefresh();
    toast(state.autoRefresh ? "Automatisch vernieuwen aan" : "Automatisch vernieuwen uit");
  });

  [$("#settingsButton"), $("#navSettings")].forEach(el => el.addEventListener("click", openSettings));
  $("#closeSettings").addEventListener("click", closeSettings);
  $("#sheetBackdrop").addEventListener("click", closeSettings);

  $("#saveSettings").addEventListener("click", () => {
    const entity = $("#entityInput").value.trim();
    const stop = $("#stopNumberInput").value.trim();
    if (!stop || !/^\d+$/.test(stop)) {
      toast("Vul een geldig haltenummer in");
      return;
    }
    state.stop = {
      ...state.stop,
      name: $("#stopNameInput").value.trim() || `Halte ${stop}`,
      entity: entity.replace(/\D/g, ""),
      stop,
      maxDepartures: Number($("#maxDeparturesSelect").value || 6)
    };
    saveStop();
    updateStopUI();
    closeSettings();
    fetchLive();
  });

  $$(".nav-item[data-target]").forEach(button => {
    button.addEventListener("click", () => {
      $$(".nav-item[data-target]").forEach(item => item.classList.remove("active"));
      button.classList.add("active");
      const target = button.dataset.target;

      if (target === "home") {
        $("#homeDashboard")?.scrollIntoView({ behavior:"smooth", block:"start" });
      }

      if (target === "plan") {
        $("#journeyPlanner")?.scrollIntoView({ behavior:"smooth", block:"start" });
        setTimeout(() => $("#plannerFrom")?.focus(), 450);
      }

      if (target === "live") {
        const liveSession = $("#liveTripSession");
        const destination =
          liveSession && !liveSession.classList.contains("hidden")
            ? liveSession
            : $("#quickLivePanel");
        destination?.scrollIntoView({ behavior:"smooth", block:"start" });
      }

      if (target === "stops") {
        $(".departures-panel")?.scrollIntoView({ behavior:"smooth", block:"start" });
      }
    });
  });


  // OVFlow 2.0 home quick actions.
  $("#homePlanAction")?.addEventListener("click", () => {
    $("#journeyPlanner")?.scrollIntoView({ behavior:"smooth", block:"start" });
    setTimeout(() => $("#plannerFrom")?.focus(), 450);
  });

  $("#homeStopAction")?.addEventListener("click", () => {
    document.querySelector("section.hero")?.scrollIntoView({ behavior:"smooth", block:"start" });
    setTimeout(() => $("#stopSearchInput")?.focus(), 450);
  });

  $("#homeLiveAction")?.addEventListener("click", () => {
    const liveSession = $("#liveTripSession");
    const destination =
      liveSession && !liveSession.classList.contains("hidden")
        ? liveSession
        : $("#quickLivePanel");
    destination?.scrollIntoView({ behavior:"smooth", block:"start" });
  });

  $("#homeMapAction")?.addEventListener("click", () => {
    $("#mapSection")?.scrollIntoView({ behavior:"smooth", block:"start" });
  });



  function showPlannerRouteOnMap(itinerary) {
    if (!state.map || !itinerary) return;
    const coords = [];
    for (const leg of itinerary.legs || []) {
      if (leg.type === "transit" && Array.isArray(leg.coordinates)) {
        for (const point of leg.coordinates) {
          if (Array.isArray(point) && point.length >= 2) coords.push([Number(point[0]), Number(point[1])]);
        }
      }
    }
    if (coords.length < 2) return;

    const data = { type:"Feature", properties:{}, geometry:{ type:"LineString", coordinates:coords } };
    if (state.map.getSource("ovflow-planner-route")) {
      state.map.getSource("ovflow-planner-route").setData(data);
    } else {
      state.map.addSource("ovflow-planner-route", { type:"geojson", data });
      state.map.addLayer({
        id:"ovflow-planner-route-glow", type:"line", source:"ovflow-planner-route",
        paint:{ "line-color":"#63efb1", "line-width":10, "line-opacity":0.18 }
      });
      state.map.addLayer({
        id:"ovflow-planner-route-line", type:"line", source:"ovflow-planner-route",
        paint:{ "line-color":"#63efb1", "line-width":5, "line-opacity":0.95 }
      });
    }
    const bounds = new maplibregl.LngLatBounds();
    coords.forEach(c => bounds.extend(c));
    state.map.fitBounds(bounds, { padding:65, maxZoom:15.5, duration:750 });
    document.querySelector(".real-map-panel")?.scrollIntoView({ behavior:"smooth", block:"start" });
  }

  function clearPlannerRouteOnMap() {
    if (!state.map) return;
    if (state.map.getLayer("ovflow-planner-route-line")) state.map.removeLayer("ovflow-planner-route-line");
    if (state.map.getLayer("ovflow-planner-route-glow")) state.map.removeLayer("ovflow-planner-route-glow");
    if (state.map.getSource("ovflow-planner-route")) state.map.removeSource("ovflow-planner-route");
  }


  let liveTripUserMarker = null;
  let liveTripNextMarker = null;

  function ensureLiveTripRouteLayer(leg) {
    if (!state.map || !leg || !Array.isArray(leg.coordinates) || leg.coordinates.length < 2) return;

    const coords = leg.coordinates
      .filter(p => Array.isArray(p) && p.length >= 2)
      .map(p => [Number(p[0]), Number(p[1])])
      .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));

    if (coords.length < 2) return;

    const data = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords }
    };

    if (state.map.getSource("ovflow-live-trip-route")) {
      state.map.getSource("ovflow-live-trip-route").setData(data);
      return;
    }

    state.map.addSource("ovflow-live-trip-route", { type: "geojson", data });
    state.map.addLayer({
      id: "ovflow-live-trip-route-glow",
      type: "line",
      source: "ovflow-live-trip-route",
      paint: {
        "line-color": "#63efb1",
        "line-width": 12,
        "line-opacity": 0.14
      }
    });
    state.map.addLayer({
      id: "ovflow-live-trip-route-line",
      type: "line",
      source: "ovflow-live-trip-route",
      paint: {
        "line-color": "#63efb1",
        "line-width": 5,
        "line-opacity": 0.96
      }
    });
  }

  function updateLiveTripMap(payload = {}) {
    if (!state.map) return;

    const { leg, position, nextStop, follow = false } = payload;
    ensureLiveTripRouteLayer(leg);

    if (position && Number.isFinite(Number(position.lon)) && Number.isFinite(Number(position.lat))) {
      if (!liveTripUserMarker) {
        const el = document.createElement("div");
        el.className = "live-map-user";
        el.innerHTML = '<span></span>';
        liveTripUserMarker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([Number(position.lon), Number(position.lat)])
          .addTo(state.map);
      } else {
        liveTripUserMarker.setLngLat([Number(position.lon), Number(position.lat)]);
      }

      if (follow) {
        state.map.easeTo({
          center: [Number(position.lon), Number(position.lat)],
          zoom: Math.max(state.map.getZoom(), 15.2),
          duration: 450
        });
      }
    }

    if (nextStop && Number.isFinite(Number(nextStop.lon)) && Number.isFinite(Number(nextStop.lat))) {
      if (!liveTripNextMarker) {
        const el = document.createElement("div");
        el.className = "live-map-next-stop";
        el.textContent = "↓";
        liveTripNextMarker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([Number(nextStop.lon), Number(nextStop.lat)])
          .addTo(state.map);
      } else {
        liveTripNextMarker.setLngLat([Number(nextStop.lon), Number(nextStop.lat)]);
      }
    }
  }

  function focusLiveTripMap(payload = {}) {
    updateLiveTripMap({ ...payload, follow: true });
    document.querySelector(".real-map-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearLiveTripMap() {
    if (liveTripUserMarker) {
      liveTripUserMarker.remove();
      liveTripUserMarker = null;
    }
    if (liveTripNextMarker) {
      liveTripNextMarker.remove();
      liveTripNextMarker = null;
    }

    if (!state.map) return;
    if (state.map.getLayer("ovflow-live-trip-route-line")) state.map.removeLayer("ovflow-live-trip-route-line");
    if (state.map.getLayer("ovflow-live-trip-route-glow")) state.map.removeLayer("ovflow-live-trip-route-glow");
    if (state.map.getSource("ovflow-live-trip-route")) state.map.removeSource("ovflow-live-trip-route");
  }


  async function fetchDeparturesForStop(stop, max = 12) {
    if (!stop?.stop) return [];

    let entity = String(stop.entity || "").replace(/\D/g, "");
    const stopNumber = String(stop.stop || "").replace(/\D/g, "");

    if (!entity && /^\d{6,7}$/.test(stopNumber)) entity = stopNumber[0];
    if (!entity || !stopNumber) return [];

    const endpoint =
      `${cfg.CORE_BASE_URL}/haltes/${encodeURIComponent(entity)}/${encodeURIComponent(stopNumber)}` +
      `/real-time?maxAantalDoorkomsten=${encodeURIComponent(max)}`;

    const response = await fetch(endpoint, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      headers: {
        "Accept": "application/json",
        "Cache-Control": "no-cache",
        "Ocp-Apim-Subscription-Key": cfg.DELIJN_CORE_KEY
      }
    });

    if (!response.ok) throw new Error(`De Lijn API HTTP ${response.status}`);
    const data = await response.json();

    const groups = data?.halteDoorkomsten ?? data?.doorkomstenPerHalte ?? data?.departures ?? [];
    let rows = [];

    if (Array.isArray(groups)) {
      for (const group of groups) {
        const list = group?.doorkomsten ?? group?.departures ?? (Array.isArray(group) ? group : []);
        if (Array.isArray(list)) rows.push(...list);
      }
    }
    if (!rows.length && Array.isArray(data?.doorkomsten)) rows = data.doorkomsten;

    return rows
      .map(normalizeDeparture)
      .filter(item => item.effectiveDate)
      .sort((a, b) => a.effectiveDate - b.effectiveDate);
  }

  window.OVFlowBridge = {
    ensureStopsLoaded,
    searchStops,
    fetchDeparturesForStop,
    getStops: () => state.stops,
    getMap: () => state.map,
    showPlannerRouteOnMap,
    clearPlannerRouteOnMap,
    updateLiveTripMap,
    focusLiveTripMap,
    clearLiveTripMap,
    toast,
    escapeHTML
  };

  updateStopUI();
  updateClock();
  setInterval(updateClock, 1000);
  setupAutoRefresh();
  initMap();

  // Als er al een halte uit v3 opgeslagen is, laad die meteen.
  if (state.stop?.stop) fetchLive();
  else {
    $("#loadingCard").classList.add("hidden");
    $("#emptyCard").classList.remove("hidden");
    $("#emptyCard strong").textContent = "Zoek een halte";
    $("#emptyCard span").textContent = "Typ bovenaan bijvoorbeeld Brugge, Maldegem of een haltenaam.";
  }
})();