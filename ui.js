(() => {
  "use strict";

  const $ = s => document.querySelector(s);
  const core = window.OVFlowCore;
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = value => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const screens = {
    home: ["#homeDashboard"],
    trips: ["#journeyPlanner", "#quickLivePanel", "#liveTripSession"],
    map: ["#mapSection"],
    saved: ["#savedSection"]
  };

  const legacy = [
    "section.hero", ".stats-grid", ".departures-panel",
    ".technical-details", ".technical-footer"
  ];

  function setView(view, options = {}) {
    if (!screens[view]) view = "home";
    document.body.dataset.ovView = view;

    Object.values(screens).flat().forEach(sel => {
      $$(sel).forEach(el => el.classList.add("ov-view-hidden"));
    });
    screens[view].forEach(sel => {
      $$(sel).forEach(el => {
        if (sel === "#liveTripSession" && el.classList.contains("hidden")) return;
        el.classList.remove("ov-view-hidden");
      });
    });
    legacy.forEach(sel => $$(sel).forEach(el => el.classList.add("ov-view-hidden")));

    $$(".bottom-nav .nav-item[data-target]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.target === view);
    });

    history.replaceState(null, "", `#${view}`);
    if (!options.keepScroll) window.scrollTo({ top: 0, behavior: "smooth" });

    if (view === "map") setTimeout(() => window.dispatchEvent(new Event("resize")), 180);
    if (view === "saved") renderSaved();
    if (options.focusDestination && view === "trips") {
      setTimeout(() => $("#plannerTo")?.focus(), 180);
    }

    document.dispatchEvent(new CustomEvent("ovflow:viewchange", { detail: { view } }));
  }

  $$(".bottom-nav .nav-item[data-target]").forEach(btn => {
    btn.addEventListener("click", event => {
      event.preventDefault();
      setView(btn.dataset.target);
    });
  });

  $("#homeDestinationSearch")?.addEventListener("click", () => setView("trips", { focusDestination: true }));
  $("#homeOpenSaved")?.addEventListener("click", () => setView("saved"));
  $("#homeAddFavorite")?.addEventListener("click", () => setView("trips", { focusDestination: true }));
  $(".brand")?.addEventListener("click", event => { event.preventDefault(); setView("home"); });

  function formatDistance(meters) {
    const n = Number(meters);
    if (!Number.isFinite(n)) return "";
    if (n < 1000) return `${Math.max(10, Math.round(n / 10) * 10)} m`;
    return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(".", ",")} km`;
  }

  function parseDate(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function timeLabel(value) {
    const d = parseDate(value);
    return d ? new Intl.DateTimeFormat("nl-BE", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "—";
  }

  function minuteLabel(value) {
    const d = parseDate(value);
    if (!d) return "—";
    const min = Math.round((d.getTime() - Date.now()) / 60000);
    if (min <= 0 && min >= -1) return "Nu";
    if (min < 0) return timeLabel(value);
    if (min < 60) return `${min} min`;
    return timeLabel(value);
  }

  function modeIcon(mode) {
    const m = String(mode || "").toLowerCase();
    if (m === "train") return '<svg viewBox="0 0 24 24"><path d="M7 17V7c0-2 2-3 5-3s5 1 5 3v10"></path><path d="M9 8h6M8 12h8M7 17h10M9 17l-2 3M15 17l2 3"></path></svg>';
    if (m === "tram") return '<svg viewBox="0 0 24 24"><path d="M8 4h8M12 4V2M7 18V8c0-2 2-3 5-3s5 1 5 3v10"></path><path d="M9 9h6M8 13h8M9 18l-2 3M15 18l2 3"></path></svg>';
    if (m === "mixed") return '<svg viewBox="0 0 24 24"><path d="M5 18V8c0-2 2-3 5-3h4c3 0 5 1 5 3v10"></path><path d="M7 9h10M7 13h10M9 18l-2 3M15 18l2 3"></path><path d="M12 5V2M9 2h6"></path></svg>';
    return '<svg viewBox="0 0 24 24"><path d="M6 17V7c0-2 2-3 6-3s6 1 6 3v10"></path><path d="M8 8h8M7 12h10M8 17v2M16 17v2"></path></svg>';
  }

  function renderNearby(places) {
    const root = $("#nearbyPlaces");
    if (!root) return;
    if (!places.length) {
      root.innerHTML = '<div class="nearby-empty"><strong>Niets dichtbij gevonden</strong><span>Probeer opnieuw of vergroot later het zoekgebied.</span></div>';
      return;
    }

    root.innerHTML = places.map(place => {
      const deps = Array.isArray(place.departures) ? place.departures : [];
      const rows = deps.length ? deps.map(dep => {
        const effective = dep.realtimeDeparture || dep.plannedDeparture;
        const delay = Number(dep.delayMinutes || 0);
        const liveText = dep.cancelled
          ? "Geannuleerd"
          : dep.realtime
            ? (delay > 0 ? `+${delay} min` : "Live")
            : "Dienstregeling";
        return `<div class="nearby-departure ${dep.cancelled ? "cancelled" : ""}">
          <span class="mode-line ${esc(dep.mode || place.mode)}">${esc(dep.line || (dep.mode === "train" ? "Trein" : "—"))}</span>
          <div class="nearby-departure-main"><strong>${esc(dep.destination || "Onbekende richting")}</strong><small>${esc(dep.operator || place.operator || "")}${dep.platform ? ` · spoor ${esc(dep.platform)}` : ""}${dep.bay ? ` · perron ${esc(dep.bay)}` : ""}</small></div>
          <div class="nearby-departure-time"><strong>${minuteLabel(effective)}</strong><small class="${dep.realtime ? "is-live" : ""}">${esc(liveText)}</small></div>
        </div>`;
      }).join("") : `<div class="nearby-no-departures">${place.liveUnavailable ? "Live gegevens tijdelijk niet beschikbaar" : "Geen komende vertrekken gevonden"}</div>`;

      return `<article class="nearby-place">
        <div class="nearby-place-head">
          <span class="nearby-mode-icon ${esc(place.mode)}">${modeIcon(place.mode)}</span>
          <div><strong>${esc(place.name)}</strong><small>${esc(place.operator || "")}</small></div>
          <span class="nearby-distance">${formatDistance(place.distanceMeters)}</span>
        </div>
        <div class="nearby-departures">${rows}</div>
      </article>`;
    }).join("");
  }

  function setNearbyState(kind, title, detail = "") {
    const box = $("#nearbyState");
    if (!box) return;
    box.dataset.state = kind;
    const strong = box.querySelector("strong");
    const small = box.querySelector("small");
    if (strong) strong.textContent = title;
    if (small) small.textContent = detail;
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("Locatie wordt niet ondersteund."));
      navigator.geolocation.getCurrentPosition(position => resolve({
        lat: Number(position.coords.latitude),
        lon: Number(position.coords.longitude),
        accuracy: Number(position.coords.accuracy)
      }), () => reject(new Error("Geef OVFlow locatietoegang om vertrekken dichtbij te tonen.")), {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 30000
      });
    });
  }

  let nearbyLoading = false;
  async function loadNearby() {
    if (nearbyLoading) return;
    nearbyLoading = true;
    $("#nearbyRefreshButton")?.classList.add("spinning");
    setNearbyState("loading", "Je locatie bepalen…", "Daarna laden we alleen de relevante haltes, stations en vertrekken.");
    try {
      const position = await getPosition();
      setNearbyState("loading", "Vertrekken ophalen…", `Locatie nauwkeurig tot ongeveer ${Math.round(position.accuracy || 0)} m`);
      if (!core) throw new Error("OVFlow Core-client ontbreekt");
      const data = await core.nearby({
        lat: position.lat,
        lon: position.lon,
        radius: 2500,
        maxPlaces: 6,
        maxDepartures: 3
      });
      renderNearby(data.places || []);
      const sourceText = data.compatibility === "legacy" ? "compatibele live-bronnen" : "OVFlow Core 4";
      setNearbyState("ready", "Dichtbij bijgewerkt", `${(data.places || []).length} haltes en stations · ${sourceText}`);
      const locateButton = $("#nearbyLocateButton");
      if (locateButton) locateButton.textContent = "Vernieuw";
    } catch (error) {
      console.error("OVFlow nearby:", error);
      setNearbyState("error", "Dichtbij kon niet laden", error.message || "Probeer opnieuw.");
    } finally {
      nearbyLoading = false;
      $("#nearbyRefreshButton")?.classList.remove("spinning");
    }
  }

  $("#nearbyLocateButton")?.addEventListener("click", loadNearby);
  $("#nearbyRefreshButton")?.addEventListener("click", loadNearby);

  // Laad Dichtbij automatisch wanneer de gebruiker eerder al locatietoegang gaf.
  // We vragen nooit onverwacht toestemming bij het openen van de app.
  if (navigator.permissions?.query) {
    navigator.permissions.query({ name: "geolocation" }).then(permission => {
      if (permission.state === "granted") loadNearby();
    }).catch(() => {});
  }

  function readSavedTrips() {
    try {
      const raw = JSON.parse(localStorage.getItem("ovflow:savedTrips") || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  }

  function renderSaved() {
    const trips = readSavedTrips();
    const root = $("#savedPageList");
    const preview = $("#savedPreview");
    if (root) {
      root.innerHTML = trips.length ? trips.map((trip, index) => `<article class="saved-trip-card">
        <span class="saved-trip-icon"><svg viewBox="0 0 24 24"><path d="M5 17h14M7 17V8c0-2 2-4 5-4s5 2 5 4v9"></path><path d="M9 9h6M8 13h8"></path></svg></span>
        <div><strong>${esc(trip.line || trip.title || "Bewaarde rit")}</strong><small>${esc(trip.direction || trip.headsign || trip.destination || "Live Trip")}</small></div>
        <button type="button" data-remove-saved="${index}" aria-label="Verwijder bewaarde rit"><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13"></path></svg></button>
      </article>`).join("") : '<div class="saved-empty"><strong>Nog niets opgeslagen</strong><span>Bewaar later een rit, station, halte of bestemming.</span></div>';
      root.querySelectorAll("[data-remove-saved]").forEach(button => button.addEventListener("click", () => {
        const list = readSavedTrips();
        list.splice(Number(button.dataset.removeSaved), 1);
        localStorage.setItem("ovflow:savedTrips", JSON.stringify(list));
        renderSaved();
      }));
    }

    if (preview && trips.length) {
      preview.innerHTML = trips.slice(0, 2).map(trip => `<button class="saved-preview-card" type="button">
        <span class="saved-preview-icon"><svg viewBox="0 0 24 24"><path d="M6 4h12v16l-6-4-6 4V4Z"></path></svg></span>
        <div><strong>${esc(trip.line || trip.title || "Bewaarde rit")}</strong><small>${esc(trip.direction || trip.destination || "Open je bewaarde rit")}</small></div>
      </button>`).join("");
    }
  }

  const liveSession = $("#liveTripSession");
  if (liveSession) {
    new MutationObserver(() => {
      const active = !liveSession.classList.contains("hidden");
      document.body.classList.toggle("live-trip-active", active);
      if (active) setView("trips", { keepScroll: true });
    }).observe(liveSession, { attributes: true, attributeFilter: ["class"] });
  }

  window.OVFlowUI = { setView };

  renderSaved();
  const initial = location.hash.slice(1);
  setView(screens[initial] ? initial : "home", { keepScroll: true });
})();
