(() => {
  "use strict";

  const cfg = window.OVFLOW_CONFIG || {};
  const core = window.OVFlowCore;
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
    mapReadyPromise: null,
    mapLibraryPromise: null,
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
      $("#coreApiState").textContent = "Open data";
      $("#coreApiState").className = "state-ok";
      $("#stopApiState").textContent = "Live";
      $("#stopApiState").className = "state-ok";
    } else if (type === "error") {
      $("#coreApiState").textContent = "Offline";
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
      ? "Vertrekken van 5 min geleden tot 3 uur vooruit"
      : "Zoek hierboven om alle actuele vertrektijden te zien";

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

    const upcoming = items.filter(i => (minutesUntil(i.effectiveDate) ?? -999) >= 0);
    $("#departureCount").textContent = String(items.length);
    $("#delayCount").textContent = String(items.filter(i => Number(i.delayMinutes) > 1).length);

    if (!items.length) {
      $("#nextDeparture").textContent = "—";
      $("#insightNextLine").textContent = "Geen rit gevonden";
      $("#insightNextMeta").textContent = "Geen vertrekken in het venster van -5 min tot +3 uur.";
      $("#emptyCard").classList.remove("hidden");
      return;
    }

    $("#emptyCard").classList.add("hidden");
    const first = upcoming[0] || items.at(-1);
    const mins = minutesUntil(first.effectiveDate);
    $("#nextDeparture").textContent = mins == null ? "—" : mins <= 0 ? "Nu" : `${mins} min`;
    $("#insightNextLine").textContent = `Lijn ${first.line} → ${first.destination}`;
    $("#insightNextMeta").textContent = `${formatTime(first.effectiveDate)} · ${mins == null ? "live" : mins <= 0 ? "vertrekt nu" : `over ${mins} min`}`;

    container.innerHTML = items.map((item, index) => {
      const minsAway = minutesUntil(item.effectiveDate);
      const delayed = Number(item.delayMinutes) > 1;
      const isRealtime = !!item.realtimeDate;
      const justPassed = minsAway != null && minsAway < 0 && minsAway >= -5;
      let status = isRealtime ? "Realtime" : "Gepland";
      let cls = isRealtime ? "" : "scheduled";
      if (justPassed) { status = `${Math.abs(minsAway)} min geleden`; cls = "passed"; }
      else if (delayed) { status = `+${item.delayMinutes} min`; cls = "delay"; }
      else if (minsAway != null && minsAway <= 1) status = "Nu";

      return `
        <article class="departure-card ${justPassed ? "departure-passed" : ""}">
          <button class="line-badge departure-live-line" type="button" data-live-departure-index="${index}" aria-label="Volg lijn ${escapeHTML(item.line)} live">${escapeHTML(item.line)}</button>
          <div class="departure-main">
            <strong>${escapeHTML(item.destination)}</strong>
            <span>${isRealtime ? "Realtime vertrek" : "Dienstregeling"} · tik op de lijn voor live rit</span>
          </div>
          <div class="departure-time">
            <strong>${formatTime(item.effectiveDate)}</strong>
            <span class="${cls}">${status}</span>
          </div>
        </article>`;
    }).join("");

    container.querySelectorAll("[data-live-departure-index]").forEach(button => {
      button.addEventListener("click", () => {
        const item = items[Number(button.dataset.liveDepartureIndex)];
        if (!item?.raw) return;
        window.OVFlowUI?.openDeparture?.(item.raw, state.stop);
      });
    });
  }

  function errorDescription(error) {
    const message = String(error?.message || error || "");
    if (/401/.test(message)) return ["OVFlow Core geweigerd", "De server kon de vervoersbron niet aanmelden."];
    if (/403/.test(message)) return ["Geen toegang tot live-data", "OVFlow Core kreeg geen toegang tot de vervoersbron."];
    if (/404/.test(message)) return ["Realtime halte niet gevonden", "De halte werd gevonden, maar de realtime databron kon deze halte niet openen."];
    if (/429/.test(message)) return ["Te veel aanvragen", "De publieke vervoersbron heeft tijdelijk een rate-limit toegepast."];
    if (/Failed to fetch|NetworkError|CORS|Load failed/i.test(message)) {
      return ["Browser blokkeert de API-oproep", "Waarschijnlijk CORS of netwerk. Open OVFlow via http://localhost in plaats van rechtstreeks via file://."];
    }
    return ["Live data kon niet worden geladen", message || "Onbekende fout bij de vervoersbron."];
  }

  async function resolveEntityIfNeeded() {
    // OVFlow 4.3 gebruikt coördinaten/Transitous-id's en heeft geen De Lijn-entiteitnummer nodig.
    return;
  }

  async function fetchLive() {
    if (state.loading) return;
    if (!state.stop?.stop) {
      $("#loadingCard").classList.add("hidden");
      $("#departures").innerHTML = "";
      $("#emptyCard").classList.remove("hidden");
      $("#emptyCard strong").textContent = "Zoek eerst een halte";
      $("#emptyCard span").textContent = "Zoek bovenaan een halte of station om de vertrektijden te laden.";
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
      if (!core) throw new Error("OVFlow dataclient ontbreekt");
      const data = core.stopDeparturesWindow
        ? await core.stopDeparturesWindow(state.stop, { pastMinutes: 5, futureMinutes: 180, max: 300 })
        : await core.stopDepartures(state.stop, 300);
      const rangeStart = new Date(Date.now() - 5 * 60_000);
      const rangeEnd = new Date(Date.now() + 180 * 60_000);
      const departures = (data.departures || []).map(item => ({
        line: item.line || "—",
        destination: item.destination || "Onbekende richting",
        plannedDate: parseDate(item.plannedDeparture),
        realtimeDate: item.realtime ? parseDate(item.realtimeDeparture) : null,
        effectiveDate: parseDate(item.realtimeDeparture || item.plannedDeparture),
        delayMinutes: Number(item.delayMinutes || 0),
        raw: item
      })).filter(item => item.effectiveDate && item.effectiveDate >= rangeStart && item.effectiveDate <= rangeEnd);

      $("#loadingCard").classList.add("hidden");
      renderDepartures(departures);
      $("#lastUpdated").textContent = `${formatTime(new Date())} live`;
      setApiState("online", "Open data live");
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
      $("#insightNextLine").textContent = "Geen live vertrekdata";
      $("#insightNextMeta").textContent = message;
      try {
        const health = await core?.health();
        if (health?.ok) setApiState("online", "Open data klaar");
        else setApiState("error", "Offline");
      } catch {
        setApiState("error", "Offline");
      }
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
        <span class="stop-result-icon"><svg viewBox="0 0 24 24"><path d="M7 18V7c0-2 2-3 5-3s5 1 5 3v11"></path><path d="M9 9h6M8 13h8"></path></svg></span>
        <span class="stop-result-copy">
          <strong>${escapeHTML(stop.name)}</strong>
          <span>${escapeHTML([stop.municipality, stop.street, stop.stopCode ? `halte ${stop.stopCode}` : ""].filter(Boolean).join(" · ") || "Openbaar vervoer")}</span>
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
      stop: stop.stop || stop.id || stop.transitousId || "",
      id: stop.id || stop.transitousId || "",
      transitousId: stop.transitousId || stop.id || "",
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
        $("#stopSearchStatus").textContent = "Haltes zoeken…";
        const results = core?.searchPlaces
          ? await core.searchPlaces(query, 12)
          : (await ensureStopsLoaded(), searchStops(query));
        $("#stopSearchStatus").textContent = `${results.length} beste resultaten`;
        renderStopResults(results);
      } catch (error) {
        console.error("OVFlow halte zoeken:", error);
        $("#stopSearchStatus").textContent = "Zoeken mislukt · probeer opnieuw";
      }
    }, 260);
  });

  $("#clearSearchButton").addEventListener("click", () => {
    $("#stopSearchInput").value = "";
    $("#stopResults").classList.add("hidden");
    $("#stopSearchStatus").textContent = "Zoek in haltes en stations";
    $("#stopSearchInput").focus();
  });

  $("#changeStopButton").addEventListener("click", () => {
    $("#stopSearchInput").focus();
    $("#stopSearchInput").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // ---------- MapLibre / OpenStreetMap ----------
  // MapLibre en kaarttiles worden pas geladen wanneer de gebruiker de kaart opent.
  // Zo betaalt Home/Reizen niet voor een kaart die niet zichtbaar is.
  function ensureMapLibrary() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (state.mapLibraryPromise) return state.mapLibraryPromise;

    state.mapLibraryPromise = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-ovflow-maplibre]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/maplibre-gl@5.7.1/dist/maplibre-gl.css';
        link.dataset.ovflowMaplibre = '1';
        document.head.appendChild(link);
      }

      const existing = document.querySelector('script[data-ovflow-maplibre]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.maplibregl), { once: true });
        existing.addEventListener('error', () => reject(new Error('Kaartbibliotheek kon niet laden.')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/maplibre-gl@5.7.1/dist/maplibre-gl.js';
      script.async = true;
      script.dataset.ovflowMaplibre = '1';
      script.onload = () => resolve(window.maplibregl);
      script.onerror = () => reject(new Error('Kaartbibliotheek kon niet laden.'));
      document.head.appendChild(script);
    }).catch(error => {
      state.mapLibraryPromise = null;
      throw error;
    });

    return state.mapLibraryPromise;
  }

  async function initMap() {
    if (state.map) return state.map;
    if (state.mapReadyPromise) return state.mapReadyPromise;

    state.mapReadyPromise = (async () => {
      const loading = $("#mapLoading");
      loading?.classList.remove("hidden");
      if (loading) loading.innerHTML = '<div class="spinner"></div><span>Kaart laden…</span>';

      await ensureMapLibrary();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const center = state.stop?.lon && state.stop?.lat
        ? [Number(state.stop.lon), Number(state.stop.lat)]
        : [4.35, 50.85];
      const zoom = state.stop?.lon ? 14 : 8;

      const map = new maplibregl.Map({
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

      state.map = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      await new Promise((resolve, reject) => {
        map.once("load", resolve);
        map.once("error", event => {
          // Raster tile-errors mogen de hele kaart niet blokkeren.
          if (!map.loaded()) return;
          reject(event?.error || new Error("Kaart kon niet laden."));
        });
      });

      loading?.classList.add("hidden");
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
      return map;
    })().catch(error => {
      state.mapReadyPromise = null;
      if (!state.map) {
        const loading = $("#mapLoading");
        if (loading) loading.innerHTML = `<span>${escapeHTML(error.message || "Kaart kon niet laden.")}</span>`;
      }
      throw error;
    });

    return state.mapReadyPromise;
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

  async function showNearbyStops(lon, lat, count = 20) {
    try {
      let nearby;
      if (core?.nearbyStops) {
        nearby = await core.nearbyStops({ lat, lon, radius: 5000, max: Math.min(count, 25) });
      } else {
        await ensureStopsLoaded();
        nearby = state.stops
          .map(stop => ({ ...stop, distance: haversine(lon, lat, stop.lon, stop.lat) }))
          .sort((a,b) => a.distance-b.distance)
          .slice(0, count);
      }
      showStopsOnMap(nearby, true);
    } catch (error) {
      console.error("OVFlow kaart haltes:", error);
      toast("Haltes rond deze locatie konden niet laden");
    }
  }

  $("#nearbyButton").addEventListener("click", async () => {
    try { await initMap(); } catch { return; }
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
    }, { enableHighAccuracy:false, timeout:8000, maximumAge:60000 });
  });

  $("#fitStopsButton").addEventListener("click", async () => {
    try { await initMap(); } catch { return; }
    if (state.stop?.lon && state.stop?.lat) {
      await showNearbyStops(Number(state.stop.lon), Number(state.stop.lat), 40);
    } else {
      toast("Zoek eerst een halte");
      $("#stopSearchInput").focus();
    }
  });

  function legacyDeparturesVisible() {
    const panel = document.querySelector(".departures-panel");
    return Boolean(
      panel &&
      !panel.classList.contains("ov-view-hidden") &&
      document.visibilityState === "visible"
    );
  }

  function setupAutoRefresh() {
    clearInterval(state.timer);
    state.timer = null;
    const active = state.autoRefresh && legacyDeparturesVisible() && Boolean(state.stop?.stop);
    $("#autoRefreshButton").classList.toggle("off", !state.autoRefresh);
    $("#autoRefreshLabel").textContent = active ? "Elke 15 sec" : state.autoRefresh ? "Slim" : "Uit";
    $("#refreshState").textContent = active ? "Actief" : state.autoRefresh ? "Gepauzeerd" : "Uit";
    $("#refreshState").className = active ? "state-ok" : "";
    if (active) state.timer = setInterval(fetchLive, Number(cfg.AUTO_REFRESH_MS || 15000));
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
  $("#apiStatusButton").addEventListener("click", checkCoreHealth);

  $("#autoRefreshButton").addEventListener("click", () => {
    state.autoRefresh = !state.autoRefresh;
    localStorage.setItem("ovflow:autoRefresh", String(state.autoRefresh));
    setupAutoRefresh();
    toast(state.autoRefresh ? "Automatisch vernieuwen aan" : "Automatisch vernieuwen uit");
  });

  [$("#settingsButton"), $("#navSettings")].filter(Boolean).forEach(el => el.addEventListener("click", openSettings));
  $("#closeSettings").addEventListener("click", closeSettings);
  $("#sheetBackdrop").addEventListener("click", closeSettings);

  $("#saveSettings").addEventListener("click", () => {
    closeSettings();
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



  async function showPlannerRouteOnMap(itinerary) {
    if (!itinerary) return;
    window.OVFlowUI?.setView?.("map");
    try { await initMap(); } catch { return; }

    const coords = [];
    for (const leg of itinerary.legs || []) {
      if (leg.type === "transit" && Array.isArray(leg.coordinates)) {
        for (const point of leg.coordinates) {
          if (Array.isArray(point) && point.length >= 2) coords.push([Number(point[0]), Number(point[1])]);
        }
      }
    }
    if (coords.length < 2) {
      toast("Voor deze route is geen kaartlijn beschikbaar");
      return;
    }

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
  }

  function clearPlannerRouteOnMap() {
    if (!state.map) return;
    if (state.map.getLayer("ovflow-planner-route-line")) state.map.removeLayer("ovflow-planner-route-line");
    if (state.map.getLayer("ovflow-planner-route-glow")) state.map.removeLayer("ovflow-planner-route-glow");
    if (state.map.getSource("ovflow-planner-route")) state.map.removeSource("ovflow-planner-route");
  }


  let liveTripUserMarker = null;
  let liveTripNextMarker = null;
  let liveTripInlineMap = null;
  let liveTripInlineReady = null;
  let liveTripInlineVehicleMarker = null;
  let liveTripInlineNextMarker = null;
  let liveTripInlineSignature = "";

  function ovflowRasterStyle() {
    return {
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
    };
  }

  async function ensureLiveTripInlineMap() {
    const container = $("#liveTripInlineMap");
    if (!container) return null;
    if (liveTripInlineMap) return liveTripInlineMap;
    if (liveTripInlineReady) return liveTripInlineReady;

    liveTripInlineReady = (async () => {
      await ensureMapLibrary();
      const map = new maplibregl.Map({
        container,
        center: [4.35, 50.85],
        zoom: 8.5,
        attributionControl: true,
        style: ovflowRasterStyle()
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      await new Promise(resolve => map.once("load", resolve));
      liveTripInlineMap = map;
      setTimeout(() => map.resize(), 40);
      return map;
    })().catch(error => {
      liveTripInlineReady = null;
      console.error("OVFlow inline live map:", error);
      const el = $("#liveTripInlineMap");
      if (el) el.innerHTML = '<div class="live-inline-map-error">Kaart kon niet laden</div>';
      return null;
    });
    return liveTripInlineReady;
  }

  function cleanLegCoordinates(leg, stops = []) {
    const coords = Array.isArray(leg?.coordinates)
      ? leg.coordinates
          .filter(p => Array.isArray(p) && p.length >= 2)
          .map(p => [Number(p[0]), Number(p[1])])
          .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))
      : [];
    if (coords.length >= 2) return coords;
    return (Array.isArray(stops) ? stops : [])
      .map(stop => [Number(stop.lon), Number(stop.lat)])
      .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  }

  async function updateLiveTripInlineMap(payload = {}) {
    const map = await ensureLiveTripInlineMap();
    if (!map) return;
    const { leg, stops = [], vehiclePosition, nextStop } = payload;
    const coords = cleanLegCoordinates(leg, stops);
    const validStops = (Array.isArray(stops) ? stops : []).filter(stop =>
      Number.isFinite(Number(stop.lon)) && Number.isFinite(Number(stop.lat))
    );

    if (coords.length >= 2) {
      const routeData = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } };
      if (map.getSource("live-route")) map.getSource("live-route").setData(routeData);
      else {
        map.addSource("live-route", { type: "geojson", data: routeData });
        map.addLayer({
          id: "live-route-glow", type: "line", source: "live-route",
          paint: { "line-color": "#60aefb", "line-width": 11, "line-opacity": 0.18 }
        });
        map.addLayer({
          id: "live-route-line", type: "line", source: "live-route",
          paint: { "line-color": "#4da9ff", "line-width": 5, "line-opacity": 0.96 }
        });
      }
    }

    const stopData = {
      type: "FeatureCollection",
      features: validStops.map((stop, index) => ({
        type: "Feature",
        properties: { index, name: stop.name || "Halte" },
        geometry: { type: "Point", coordinates: [Number(stop.lon), Number(stop.lat)] }
      }))
    };
    if (map.getSource("live-stops")) map.getSource("live-stops").setData(stopData);
    else {
      map.addSource("live-stops", { type: "geojson", data: stopData });
      map.addLayer({
        id: "live-stops", type: "circle", source: "live-stops",
        paint: {
          "circle-radius": 5,
          "circle-color": "#f8fbff",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#307fd8"
        }
      });
    }

    if (vehiclePosition && Number.isFinite(Number(vehiclePosition.lon)) && Number.isFinite(Number(vehiclePosition.lat))) {
      if (!liveTripInlineVehicleMarker) {
        const el = document.createElement("div");
        el.className = "live-map-vehicle";
        el.innerHTML = '<span></span>';
        liveTripInlineVehicleMarker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([Number(vehiclePosition.lon), Number(vehiclePosition.lat)])
          .addTo(map);
      } else {
        liveTripInlineVehicleMarker.setLngLat([Number(vehiclePosition.lon), Number(vehiclePosition.lat)]);
      }
    }

    if (nextStop && Number.isFinite(Number(nextStop.lon)) && Number.isFinite(Number(nextStop.lat))) {
      if (!liveTripInlineNextMarker) {
        const el = document.createElement("div");
        el.className = "live-map-next-stop";
        el.textContent = "↓";
        liveTripInlineNextMarker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([Number(nextStop.lon), Number(nextStop.lat)])
          .addTo(map);
      } else {
        liveTripInlineNextMarker.setLngLat([Number(nextStop.lon), Number(nextStop.lat)]);
      }
    }

    const signature = `${leg?.tripId || leg?.line || "trip"}|${validStops.length}`;
    if (signature !== liveTripInlineSignature && (coords.length || validStops.length)) {
      liveTripInlineSignature = signature;
      const bounds = new maplibregl.LngLatBounds();
      (coords.length ? coords : validStops.map(stop => [Number(stop.lon), Number(stop.lat)])).forEach(c => bounds.extend(c));
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 38, maxZoom: 14.8, duration: 500 });
    }
  }

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
    updateLiveTripInlineMap(payload).catch(() => {});
    if (!state.map) return;

    const { leg, vehiclePosition, position, nextStop, follow = false } = payload;
    const trackedPosition = vehiclePosition || position;
    ensureLiveTripRouteLayer(leg);

    if (trackedPosition && Number.isFinite(Number(trackedPosition.lon)) && Number.isFinite(Number(trackedPosition.lat))) {
      if (!liveTripUserMarker) {
        const el = document.createElement("div");
        el.className = "live-map-vehicle";
        el.innerHTML = '<span></span>';
        liveTripUserMarker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([Number(trackedPosition.lon), Number(trackedPosition.lat)])
          .addTo(state.map);
      } else {
        liveTripUserMarker.setLngLat([Number(trackedPosition.lon), Number(trackedPosition.lat)]);
      }

      if (follow) {
        state.map.easeTo({
          center: [Number(trackedPosition.lon), Number(trackedPosition.lat)],
          zoom: Math.max(state.map.getZoom(), 14.8),
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

  async function focusLiveTripMap(payload = {}) {
    window.OVFlowUI?.setView?.("map");
    try { await initMap(); } catch { return; }
    updateLiveTripMap({ ...payload, follow: true });
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
    if (liveTripInlineVehicleMarker) {
      liveTripInlineVehicleMarker.remove();
      liveTripInlineVehicleMarker = null;
    }
    if (liveTripInlineNextMarker) {
      liveTripInlineNextMarker.remove();
      liveTripInlineNextMarker = null;
    }
    liveTripInlineSignature = "";
    if (liveTripInlineMap) {
      if (liveTripInlineMap.getLayer("live-route-line")) liveTripInlineMap.removeLayer("live-route-line");
      if (liveTripInlineMap.getLayer("live-route-glow")) liveTripInlineMap.removeLayer("live-route-glow");
      if (liveTripInlineMap.getSource("live-route")) liveTripInlineMap.removeSource("live-route");
      if (liveTripInlineMap.getLayer("live-stops")) liveTripInlineMap.removeLayer("live-stops");
      if (liveTripInlineMap.getSource("live-stops")) liveTripInlineMap.removeSource("live-stops");
    }

    if (!state.map) return;
    if (state.map.getLayer("ovflow-live-trip-route-line")) state.map.removeLayer("ovflow-live-trip-route-line");
    if (state.map.getLayer("ovflow-live-trip-route-glow")) state.map.removeLayer("ovflow-live-trip-route-glow");
    if (state.map.getSource("ovflow-live-trip-route")) state.map.removeSource("ovflow-live-trip-route");
  }


  async function fetchDeparturesForStop(stop, max = 12) {
    if (!stop) return [];
    if (!core) throw new Error("OVFlow dataclient ontbreekt");

    const data = await core.stopDepartures(stop, max);
    return (data.departures || []).map(item => ({
      line: item.line || "—",
      destination: item.destination || "Onbekende richting",
      plannedDate: parseDate(item.plannedDeparture),
      realtimeDate: item.realtime ? parseDate(item.realtimeDeparture) : null,
      effectiveDate: parseDate(item.realtimeDeparture || item.plannedDeparture),
      delayMinutes: Number(item.delayMinutes || 0),
      raw: item
    })).filter(item => item.effectiveDate).sort((a, b) => a.effectiveDate - b.effectiveDate);
  }

  async function checkCoreHealth() {
    if (!core) {
      setApiState("error", "Offline");
      return;
    }
    try {
      const status = await core.health(true);
      if (status.ok) {
        setApiState("online", "Open data klaar");
      } else {
        setApiState("error", "Offline");
      }
    } catch {
      setApiState("error", "Offline");
    }
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
  checkCoreHealth();
  setInterval(checkCoreHealth, 60_000);

  document.addEventListener("ovflow:viewchange", event => {
    setupAutoRefresh();
    if (event.detail?.view === "map") {
      initMap().catch(error => console.error("OVFlow kaart:", error));
    }
  });
  document.addEventListener("visibilitychange", setupAutoRefresh);

  // Legacy halte-data wordt niet meer onzichtbaar op de achtergrond opgehaald.
  if (!state.stop?.stop) {
    $("#loadingCard").classList.add("hidden");
    $("#emptyCard").classList.remove("hidden");
    $("#emptyCard strong").textContent = "Zoek een halte";
    $("#emptyCard span").textContent = "Typ bovenaan bijvoorbeeld Brugge, Maldegem of een haltenaam.";
  }
})();