const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const demoDepartures = [
  {
    line: "58",
    type: "bus",
    destination: "Brugge Station",
    detail: "via Sijsele · halte Maldegem Markt",
    time: "12:03",
    status: "3 min",
    delayed: false
  },
  {
    line: "50",
    type: "bus",
    destination: "Eeklo Station",
    detail: "via Adegem · halte Maldegem Markt",
    time: "12:11",
    status: "+2 min",
    delayed: true
  },
  {
    line: "IC",
    type: "train",
    destination: "Brugge",
    detail: "vanaf Eeklo · spoor 1",
    time: "12:24",
    status: "Op tijd",
    delayed: false
  },
  {
    line: "58",
    type: "bus",
    destination: "Knokke Station",
    detail: "via Brugge · halte Maldegem Markt",
    time: "12:31",
    status: "23 min",
    delayed: false
  }
];

let departures = demoDepartures.map(item => ({ ...item }));

function renderDepartures() {
  $("#departures").innerHTML = departures.map(item => `
    <article class="departure-card">
      <div class="line-badge ${item.type}">${item.line}</div>
      <div class="departure-main">
        <strong>${item.destination}</strong>
        <span>${item.detail}</span>
      </div>
      <div class="departure-time">
        <strong>${item.time}</strong>
        <span class="${item.delayed ? "delay" : ""}">${item.status}</span>
      </div>
    </article>
  `).join("");
}

let toastTimer;
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

$("#swapButton").addEventListener("click", () => {
  const from = $("#fromInput");
  const to = $("#toInput");
  [from.value, to.value] = [to.value, from.value];
});

$("#clearDestination").addEventListener("click", () => {
  $("#toInput").value = "";
  $("#toInput").focus();
});

$("#locationButton").addEventListener("click", () => {
  $("#fromInput").value = "Huidige locatie";
  showToast("Huidige locatie geselecteerd");
});

$$(".segment").forEach(button => {
  button.addEventListener("click", () => {
    $$(".segment").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
  });
});

$$(".favorite-chip[data-destination]").forEach(button => {
  button.addEventListener("click", () => {
    $("#toInput").value = button.dataset.destination;
    $("#toInput").focus();
  });
});

$("#addFavorite").addEventListener("click", () => {
  showToast("Favorietenbeheer komt in een volgende versie");
});

$("#preferenceButton").addEventListener("click", () => {
  showToast("Routevoorkeuren komen in een volgende versie");
});

$("#refreshButton").addEventListener("click", () => {
  departures = departures.map((item, index) => {
    if (item.delayed) return item;

    const mins = 2 + ((Date.now() / 1000 + index * 13) % 19 | 0);
    return {
      ...item,
      status: item.type === "train" && index === 2 ? "Op tijd" : `${mins} min`
    };
  });

  renderDepartures();
  showToast("Vertrektijden vernieuwd");
});

$("#routeForm").addEventListener("submit", (event) => {
  event.preventDefault();

  const from = $("#fromInput").value.trim();
  const to = $("#toInput").value.trim();

  if (!from || !to) {
    showToast("Vul eerst vertrek en bestemming in");
    return;
  }

  $("#resultTitle").textContent = `${from} → ${to}`;
  $("#routeResults").innerHTML = `
    <article class="route-result-card">
      <div class="route-result-head">
        <strong>12:02 → 12:49</strong>
        <span>BESTE KEUZE</span>
      </div>

      <div class="route-leg">
        <div class="leg-icon">🚶</div>
        <div>
          <strong>Loop naar Maldegem Markt</strong>
          <span>6 minuten · 420 m</span>
        </div>
        <time>12:02</time>
      </div>

      <div class="route-leg">
        <div class="leg-icon">🚌</div>
        <div>
          <strong>Bus 58 richting Brugge</strong>
          <span>Maldegem Markt → Brugge Station</span>
        </div>
        <time>12:08</time>
      </div>

      <div class="route-leg">
        <div class="leg-icon">🚆</div>
        <div>
          <strong>IC richting ${to}</strong>
          <span>1 overstap · spoor 2</span>
        </div>
        <time>12:31</time>
      </div>
    </article>

    <article class="route-result-card">
      <div class="route-result-head">
        <strong>12:12 → 13:04</strong>
        <span style="color:#8fa3b4">ALTERNATIEF</span>
      </div>

      <div class="route-leg">
        <div class="leg-icon">🚌</div>
        <div>
          <strong>Bus 50 richting Eeklo</strong>
          <span>Minder wandelen · iets langere reistijd</span>
        </div>
        <time>12:12</time>
      </div>

      <div class="route-leg">
        <div class="leg-icon">🚆</div>
        <div>
          <strong>Trein naar ${to}</strong>
          <span>Realtime koppeling volgt in volgende versie</span>
        </div>
        <time>12:36</time>
      </div>
    </article>
  `;

  $("#resultPanel").classList.remove("hidden");
  $("#resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("#closeResults").addEventListener("click", () => {
  $("#resultPanel").classList.add("hidden");
});

$$(".map-filter-button").forEach(button => {
  button.addEventListener("click", () => {
    $$(".map-filter-button").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    showToast(`${button.textContent} op kaart`);
  });
});

$("#alertsButton").addEventListener("click", () => {
  document.querySelector(".disruptions-panel").scrollIntoView({ behavior: "smooth", block: "center" });
});

$("#profileButton").addEventListener("click", () => {
  showToast("Profiel komt in versie 3");
});

$("#stopButton").addEventListener("click", () => {
  showToast("Haltepaneel komt in versie 3");
});

$("#allAlertsButton").addEventListener("click", () => {
  showToast("Uitgebreide storingen komen in versie 3");
});

$$(".nav-item, .nav-main").forEach(button => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab;

    if (button.classList.contains("nav-item")) {
      $$(".nav-item").forEach(item => item.classList.remove("active"));
      button.classList.add("active");
    }

    if (tab === "home") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (tab === "trips") {
      $(".live-trip-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (tab === "map") {
      $(".map-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (tab === "plan") {
      $(".planner-shell").scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => $("#toInput").focus(), 350);
    } else if (tab === "profile") {
      showToast("Profiel komt in versie 3");
    }
  });
});

renderDepartures();
