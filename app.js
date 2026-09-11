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
    lastData: []
  };

  function loadStop() {
    const fallback = cfg.DEFAULT_STOP || { name: "De Lijn live halte", entity: "2", stop: "202485", maxDepartures: 6 };
    try {
      const saved = JSON.parse(localStorage.getItem("ovflow:stop") || "null");
      return saved && saved.entity && saved.stop ? { ...fallback, ...saved } : fallback;
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
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
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
    $("#activeStopName").textContent = state.stop.name || "De Lijn-halte";
    $("#activeStopCode").textContent = `Halte ${state.stop.entity}/${state.stop.stop}`;
    $("#stopNameInput").value = state.stop.name || "";
    $("#entityInput").value = state.stop.entity || "";
    $("#stopNumberInput").value = state.stop.stop || "";
    $("#maxDeparturesSelect").value = String(state.stop.maxDepartures || 6);
  }

  function parseDate(raw) {
    if (!raw) return null;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;

    // Sommige API-velden kunnen een tijdtekst bevatten.
    const timeMatch = String(raw).match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (timeMatch) {
      const now = new Date();
      now.setHours(Number(timeMatch[1]), Number(timeMatch[2]), Number(timeMatch[3] || 0), 0);
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
      d["real-timeTijdstip"] ??
      d.realTimeTijdstip ??
      d.realtimeTijdstip ??
      d.realTime ??
      d.realtime ??
      null;

    const scheduledRaw =
      d.dienstregelingTijdstip ??
      d.geplandeTijdstip ??
      d.tijdstip ??
      d.scheduledTime ??
      null;

    const realtimeDate = parseDate(realtimeRaw);
    const scheduledDate = parseDate(scheduledRaw);
    const effectiveDate = realtimeDate || scheduledDate;

    const line =
      d.lijnnummer ??
      d.lijnNummer ??
      d.lineNumber ??
      d.lijn?.lijnnummer ??
      d.lijn?.nummer ??
      "?";

    const destination =
      d.bestemming ??
      d.bestemmingNaam ??
      d.richting ??
      d.destination ??
      d.bestemming?.omschrijving ??
      d.lijnrichting ??
      "Bestemming onbekend";

    let delayMinutes = null;
    if (realtimeDate && scheduledDate) {
      delayMinutes = Math.round((realtimeDate - scheduledDate) / 60000);
    } else if (typeof d.afwijking === "number") {
      delayMinutes = Math.round(d.afwijking / 60);
    }

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
    const groups =
      json?.halteDoorkomsten ??
      json?.doorkomstenPerHalte ??
      json?.departures ??
      [];

    let rows = [];

    if (Array.isArray(groups)) {
      for (const group of groups) {
        const list =
          group?.doorkomsten ??
          group?.departures ??
          (Array.isArray(group) ? group : []);
        if (Array.isArray(list)) rows.push(...list);
      }
    }

    // Robuuste fallback voor API-responses die rechtstreeks "doorkomsten" geven.
    if (!rows.length && Array.isArray(json?.doorkomsten)) {
      rows = json.doorkomsten;
    }

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
    const delayed = items.filter(i => Number(i.delayMinutes) > 1).length;
    $("#delayCount").textContent = String(delayed);

    if (!items.length) {
      $("#nextDeparture").textContent = "—";
      $("#insightNextLine").textContent = "Geen rit gevonden";
      $("#insightNextMeta").textContent = "Probeer later opnieuw of kies een andere halte.";
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
      const hasDelay = Number(item.delayMinutes) > 1;
      const isRealtime = !!item.realtimeDate;
      let statusText = isRealtime ? "Realtime" : "Gepland";
      let statusClass = isRealtime ? "" : "scheduled";

      if (hasDelay) {
        statusText = `+${item.delayMinutes} min`;
        statusClass = "delay";
      } else if (minsAway != null && minsAway <= 1) {
        statusText = "Nu";
      }

      return `
        <article class="departure-card">
          <div class="line-badge">${escapeHTML(item.line)}</div>
          <div class="departure-main">
            <strong>${escapeHTML(item.destination)}</strong>
            <span>${isRealtime ? "Live doorkomst" : "Volgens dienstregeling"} · De Lijn</span>
          </div>
          <div class="departure-time">
            <strong>${formatTime(item.effectiveDate)}</strong>
            <span class="${statusClass}">${statusText}</span>
          </div>
        </article>
      `;
    }).join("");
  }

  function errorDescription(error) {
    const message = String(error?.message || error || "");
    if (/401/.test(message)) return ["API-sleutel geweigerd", "De Core API geeft 401. Controleer of de juiste sleutel in config.js staat."];
    if (/403/.test(message)) return ["Geen toegang tot De Lijn API", "De API geeft 403. Controleer je abonnement/product en API-sleutel."];
    if (/404/.test(message)) return ["Halte niet gevonden", "Controleer entiteitnummer en haltenummer in Instellingen."];
    if (/429/.test(message)) return ["Te veel aanvragen", "De Lijn heeft tijdelijk een rate-limit toegepast. Probeer iets later opnieuw."];
    if (/Failed to fetch|NetworkError|CORS|Load failed/i.test(message)) {
      return ["Browser blokkeert de API-oproep", "Waarschijnlijk CORS/netwerk. Open OVFlow via een lokale webserver of gebruik later de OVFlow-backend/proxy."];
    }
    return ["Live data kon niet worden geladen", message || "Onbekende fout bij De Lijn."];
  }

  async function fetchLive() {
    if (state.loading) return;
    state.loading = true;

    $("#loadingCard").classList.remove("hidden");
    $("#errorCard").classList.add("hidden");
    $("#emptyCard").classList.add("hidden");
    $("#departures").innerHTML = "";
    $("#refreshButton").classList.add("spinning");
    $("#navRefresh").classList.add("spinning");
    setApiState("loading", "Verbinden…");

    const endpoint = `${cfg.CORE_BASE_URL}/haltes/${encodeURIComponent(state.stop.entity)}/${encodeURIComponent(state.stop.stop)}/real-time?maxAantalDoorkomsten=${encodeURIComponent(state.stop.maxDepartures || 6)}`;

    try {
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

      if (!response.ok) {
        throw new Error(`De Lijn API HTTP ${response.status}`);
      }

      const data = await response.json();
      const departures = extractDepartures(data);

      $("#loadingCard").classList.add("hidden");
      renderDepartures(departures);

      const now = new Date();
      $("#lastUpdated").textContent = `${formatTime(now)} live`;
      setApiState("online", "De Lijn live");
      toast("Live data bijgewerkt");
    } catch (error) {
      console.error("OVFlow De Lijn API error:", error);
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
      $("#navRefresh").classList.remove("spinning");
    }
  }

  function setupAutoRefresh() {
    clearInterval(state.timer);
    $("#autoRefreshButton").classList.toggle("off", !state.autoRefresh);
    $("#autoRefreshLabel").textContent = state.autoRefresh ? "Elke 30 sec" : "Uit";
    $("#refreshState").textContent = state.autoRefresh ? "Actief" : "Uit";
    $("#refreshState").className = state.autoRefresh ? "state-ok" : "";

    if (state.autoRefresh) {
      state.timer = setInterval(fetchLive, Number(cfg.AUTO_REFRESH_MS || 30000));
    }
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
    $("#clockTime").textContent = new Intl.DateTimeFormat("nl-BE", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
    $("#clockDate").textContent = new Intl.DateTimeFormat("nl-BE", { weekday: "long", day: "numeric", month: "long" }).format(now);
  }

  $("#refreshButton").addEventListener("click", fetchLive);
  $("#refreshNowButton").addEventListener("click", fetchLive);
  $("#navRefresh").addEventListener("click", fetchLive);
  $("#retryButton").addEventListener("click", fetchLive);
  $("#apiStatusButton").addEventListener("click", fetchLive);

  $("#autoRefreshButton").addEventListener("click", () => {
    state.autoRefresh = !state.autoRefresh;
    localStorage.setItem("ovflow:autoRefresh", String(state.autoRefresh));
    setupAutoRefresh();
    toast(state.autoRefresh ? "Automatisch vernieuwen aan" : "Automatisch vernieuwen uit");
  });

  [$("#settingsButton"), $("#changeStopButton"), $("#navSettings")].forEach(el => el.addEventListener("click", openSettings));
  $("#closeSettings").addEventListener("click", closeSettings);
  $("#sheetBackdrop").addEventListener("click", closeSettings);

  $("#saveSettings").addEventListener("click", () => {
    const entity = $("#entityInput").value.trim();
    const stop = $("#stopNumberInput").value.trim();

    if (!entity || !stop || !/^\d+$/.test(entity) || !/^\d+$/.test(stop)) {
      toast("Vul een geldig entiteit- en haltenummer in");
      return;
    }

    state.stop = {
      name: $("#stopNameInput").value.trim() || `Halte ${entity}/${stop}`,
      entity,
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
      if (target === "home") window.scrollTo({ top: 0, behavior: "smooth" });
      if (target === "departures") $(".departures-panel").scrollIntoView({ behavior: "smooth", block: "start" });
      if (target === "data") $(".data-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  updateStopUI();
  updateClock();
  setInterval(updateClock, 1000);
  setupAutoRefresh();
  fetchLive();
})();
