const departures = [
  { line: "58", type: "bus", destination: "Brugge Station", stop: "Adegem Dorp", time: "12:03", status: "3 min", delayed: false },
  { line: "50", type: "bus", destination: "Eeklo Station", stop: "Adegem Dorp", time: "12:11", status: "+2 min", delayed: true },
  { line: "IC", type: "train", destination: "Brugge", stop: "Eeklo", time: "12:24", status: "Op tijd", delayed: false },
  { line: "58", type: "bus", destination: "Maldegem", stop: "Adegem Dorp", time: "12:31", status: "23 min", delayed: false }
];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const departuresEl = $("#departures");
const toast = $("#toast");

function renderDepartures() {
  departuresEl.innerHTML = departures.map(item => `
    <article class="departure-card">
      <span class="line-badge ${item.type}">${item.line}</span>
      <div class="departure-main">
        <strong>${item.destination}</strong>
        <small>${item.stop}</small>
      </div>
      <div class="departure-time">
        <strong>${item.time}</strong>
        <small class="${item.delayed ? "delay" : ""}">${item.status}</small>
      </div>
    </article>
  `).join("");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

$("#swapBtn").addEventListener("click", () => {
  const from = $("#fromInput");
  const to = $("#toInput");
  [from.value, to.value] = [to.value, from.value];
});

$$(".chip").forEach(chip => {
  chip.addEventListener("click", () => {
    $$(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
  });
});

$$(".quick-card").forEach(card => {
  card.addEventListener("click", () => {
    $("#toInput").value = card.dataset.fill;
    $("#toInput").focus();
  });
});

$("#refreshBtn").addEventListener("click", () => {
  departures.forEach((dep, i) => {
    const minute = 2 + ((Date.now() / 1000 + i * 7) % 16 | 0);
    if (!dep.delayed) dep.status = `${minute} min`;
  });
  renderDepartures();
  showToast("Vertrektijden vernieuwd");
});

$("#routeForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const from = $("#fromInput").value.trim();
  const to = $("#toInput").value.trim();

  if (!from || !to) {
    showToast("Vul vertrek en bestemming in");
    return;
  }

  $("#resultTitle").textContent = `${from} → ${to}`;
  $("#routeResults").innerHTML = `
    <article class="route-result">
      <div class="route-result-head">
        <div>
          <strong>12:02 → 12:49</strong>
          <div class="route-duration">47 min · 1 overstap</div>
        </div>
        <span class="on-time">Beste keuze</span>
      </div>

      <div class="leg">
        <div class="leg-icon">🚶</div>
        <div>
          <strong>6 min lopen</strong>
          <small>Naar Adegem Dorp</small>
        </div>
        <strong>12:02</strong>
      </div>

      <div class="leg">
        <div class="leg-icon">🚌</div>
        <div>
          <strong>Bus 58 richting Brugge</strong>
          <small>Adegem Dorp → Maldegem</small>
        </div>
        <strong>12:08</strong>
      </div>

      <div class="leg">
        <div class="leg-icon">🚆</div>
        <div>
          <strong>IC richting ${to}</strong>
          <small>1 overstap · spoor 2</small>
        </div>
        <strong>12:31</strong>
      </div>
    </article>

    <article class="route-result">
      <div class="route-result-head">
        <div>
          <strong>12:12 → 13:04</strong>
          <div class="route-duration">52 min · minder wandelen</div>
        </div>
        <span class="route-duration">Alternatief</span>
      </div>

      <div class="leg">
        <div class="leg-icon">🚌</div>
        <div>
          <strong>Bus 50</strong>
          <small>Via Eeklo Station</small>
        </div>
        <strong>12:12</strong>
      </div>

      <div class="leg">
        <div class="leg-icon">🚆</div>
        <div>
          <strong>Trein naar ${to}</strong>
          <small>Realtime beschikbaar in latere versie</small>
        </div>
        <strong>12:36</strong>
      </div>
    </article>
  `;

  const section = $("#resultSection");
  section.classList.remove("hidden");
  section.scrollIntoView({ behavior: "smooth", block: "start" });
});

$$(".nav-item").forEach(item => {
  item.addEventListener("click", () => {
    $$(".nav-item").forEach(n => n.classList.remove("active"));
    item.classList.add("active");

    const tab = item.dataset.tab;
    if (tab === "home") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (tab === "map") {
      document.querySelector(".map-card").scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (tab === "trips") {
      document.querySelector(".trip-card").scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      showToast(`${item.querySelector("small").textContent} komt in versie 2`);
    }
  });
});

$("#profileBtn").addEventListener("click", () => {
  showToast("Profiel komt in versie 2");
});

renderDepartures();
