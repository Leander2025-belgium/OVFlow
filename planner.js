(() => {
  "use strict";
  const cfg = window.OVFLOW_CONFIG || {};
  const bridge = window.OVFlowBridge;
  const $ = s => document.querySelector(s);

  if (!bridge) {
    console.error("OVFlowBridge ontbreekt; planner kan niet starten.");
    return;
  }

  const planner = {
    from: null,
    to: null,
    mode: "now",
    pref: "fastest",
    worker: null,
    workerReady: false,
    pendingId: 0,
    lastRequest: null,
    lastResults: [],
    geolocationOrigin: false
  };

  const esc = bridge.escapeHTML || (v => String(v ?? ""));
  const toast = bridge.toast || console.log;

  function setDefaultDateTime() {
    const now = new Date();
    const pad = n => String(n).padStart(2,"0");
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
      if (side === "from") { planner.from = null; planner.geolocationOrigin = false; }
      else planner.to = null;
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { box.classList.add("hidden"); return; }
      timer = setTimeout(async () => {
        try {
          await bridge.ensureStopsLoaded();
          const results = bridge.searchStops(q).slice(0, 9);
          renderSuggestions(box, results, side);
        } catch (e) {
          box.innerHTML = `<div class="planner-suggestion"><span class="planner-suggestion-icon">!</span><span><strong>Zoeken mislukt</strong><small>${esc(e.message || "Haltes konden niet laden")}</small></span></div>`;
          box.classList.remove("hidden");
        }
      }, 220);
    });

    input.addEventListener("focus", async () => {
      const q = input.value.trim();
      if (q.length >= 2 && !box.innerHTML) {
        try { await bridge.ensureStopsLoaded(); renderSuggestions(box, bridge.searchStops(q).slice(0,9), side); } catch {}
      }
    });
  }

  function renderSuggestions(box, stops, side) {
    if (!stops.length) {
      box.innerHTML = `<div class="planner-suggestion"><span class="planner-suggestion-icon">?</span><span><strong>Geen halte gevonden</strong><small>Probeer een andere naam of plaats.</small></span></div>`;
      box.classList.remove("hidden"); return;
    }
    box.innerHTML = stops.map((s,i) => `
      <button class="planner-suggestion" type="button" data-i="${i}">
        <span class="planner-suggestion-icon">H</span>
        <span><strong>${esc(s.name)}</strong><small>${esc([s.municipality,s.street].filter(Boolean).join(" · ") || `halte ${s.stop || ""}`)}</small></span>
      </button>`).join("");
    box.classList.remove("hidden");
    [...box.querySelectorAll("[data-i]")].forEach(btn => btn.addEventListener("click", () => {
      const stop = stops[Number(btn.dataset.i)];
      chooseStop(side, stop);
      box.classList.add("hidden");
    }));
  }

  function chooseStop(side, stop) {
    const normalized = {
      name: stop.name,
      municipality: stop.municipality || "",
      street: stop.street || "",
      stop: stop.stop || "",
      entity: stop.entity || "",
      lon: Number(stop.lon),
      lat: Number(stop.lat)
    };
    planner[side] = normalized;
    $(side === "from" ? "#plannerFrom" : "#plannerTo").value = displayStopName(normalized);
  }

  async function useLocation() {
    if (!navigator.geolocation) return toast("Locatie wordt niet ondersteund");
    $("#plannerFrom").value = "Locatie bepalen…";
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        await bridge.ensureStopsLoaded();
        const lon = pos.coords.longitude, lat = pos.coords.latitude;
        const nearest = bridge.getStops()
          .map(s => ({...s, d:haversine(lon,lat,s.lon,s.lat)}))
          .sort((a,b)=>a.d-b.d)[0];
        if (!nearest) throw new Error("Geen halte gevonden");
        chooseStop("from", nearest);
        planner.from.userLon = lon; planner.from.userLat = lat; planner.from.walkKm = nearest.d;
        planner.geolocationOrigin = true;
        toast(`Dichtstbijzijnde halte: ${nearest.name}`);
      } catch (e) { $("#plannerFrom").value=""; toast(e.message || "Locatie kon niet worden gebruikt"); }
    }, () => { $("#plannerFrom").value=""; toast("Locatie kon niet worden bepaald"); }, {enableHighAccuracy:true,timeout:10000});
  }

  function haversine(lon1,lat1,lon2,lat2) {
    const R=6371, rad=v=>v*Math.PI/180, dLat=rad(lat2-lat1), dLon=rad(lon2-lon1);
    const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }

  function swapStops() {
    [planner.from,planner.to]=[planner.to,planner.from];
    const a=$("#plannerFrom").value,b=$("#plannerTo").value; $("#plannerFrom").value=b; $("#plannerTo").value=a;
    planner.geolocationOrigin=false;
  }

  function getDateTime() {
    if (planner.mode === "now") return new Date();
    const date=$("#plannerDate").value, time=$("#plannerTime").value;
    if (!date || !time) return null;
    const d=new Date(`${date}T${time}:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function startWorker() {
    if (planner.worker) return;
    planner.worker = new Worker("route-worker.js");
    planner.worker.onmessage = onWorkerMessage;
    planner.worker.onerror = e => showPlannerError(`Route-engine kon niet starten: ${e.message || "onbekende fout"}`);
  }

  function onWorkerMessage(event) {
    const msg=event.data || {};
    if (msg.type === "progress") return updateProgress(msg);
    if (msg.type === "ready") {
      planner.workerReady=true;
      $("#plannerDataPill").classList.remove("loading");
      $("#plannerDataPill").classList.add("ready");
      $("#plannerDataPill span").textContent="Dienstregeling klaar";
      return;
    }
    if (msg.type === "result" && msg.id === planner.pendingId) {
      hideProgress(); planner.lastResults=msg.itineraries || []; renderResults(msg); realtimeEnhance(msg.itineraries || []); return;
    }
    if (msg.type === "error" && (!msg.id || msg.id === planner.pendingId)) {
      hideProgress(); showPlannerError(msg.message || "Routeberekening mislukt");
    }
  }

  function updateProgress(msg) {
    $("#plannerProgress").classList.remove("hidden");
    $("#plannerError").classList.add("hidden");
    const pct=Math.max(0,Math.min(100,Number(msg.percent || 0)));
    $("#plannerProgressPct").textContent=`${Math.round(pct)}%`;
    $("#plannerProgressBar").style.width=`${pct}%`;
    $("#plannerProgressLabel").textContent=msg.label || "Dienstregeling laden…";
    $("#plannerProgressDetail").textContent=msg.detail || "";
    $("#plannerDataPill").classList.add("loading");
    $("#plannerDataPill span").textContent=msg.label || "Laden…";
  }

  function hideProgress(){ $("#plannerProgress").classList.add("hidden"); }
  function showPlannerError(text){ $("#plannerErrorText").textContent=text; $("#plannerError").classList.remove("hidden"); }

  function planRoute() {
    if (!planner.from) return toast("Kies eerst een vertrekhalte uit de zoekresultaten");
    if (!planner.to) return toast("Kies eerst een bestemmingshalte uit de zoekresultaten");
    const dt=getDateTime(); if(!dt) return toast("Kies een geldige datum en tijd");
    if (haversine(planner.from.lon,planner.from.lat,planner.to.lon,planner.to.lat) < .04) return toast("Vertrek en bestemming liggen bijna op dezelfde plek");

    startWorker();
    $("#plannerError").classList.add("hidden"); $("#plannerResults").classList.add("hidden");
    const id=++planner.pendingId;
    const payload={
      type:"plan", id,
      gtfsUrl:cfg.GTFS_STATIC_URL,
      gtfsFallbackUrls:Array.isArray(cfg.GTFS_STATIC_FALLBACK_URLS) ? cfg.GTFS_STATIC_FALLBACK_URLS : [],
      gtfsKey:cfg.DELIJN_GTFS_STATIC_KEY || "",
      from:planner.from, to:planner.to,
      date:localDate(dt), time:`${String(dt.getHours()).padStart(2,"0")}:${String(dt.getMinutes()).padStart(2,"0")}:00`,
      mode:planner.mode, preference:planner.pref, maxResults:5
    };
    planner.lastRequest=payload;
    updateProgress({percent:2,label:"Routeplanner starten",detail:"De Lijn-dienstregeling voorbereiden…"});
    planner.worker.postMessage(payload);
  }

  function localDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
  function secTime(sec){sec=((Number(sec)%86400)+86400)%86400; const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`}
  function mins(sec){return Math.max(0,Math.round(Number(sec)/60))}

  function renderResults(msg) {
    const its=msg.itineraries || [];
    $("#plannerResults").classList.remove("hidden");
    $("#plannerResultsTitle").textContent=`${displayStopName(planner.from)} → ${displayStopName(planner.to)}`;
    $("#plannerResultsMeta").textContent=its.length ? `${its.length} reisadviezen · ${msg.indexDate || ""}` : "Geen route gevonden";
    const root=$("#plannerResultCards");
    if(!its.length){root.innerHTML=`<div class="empty-card"><strong>Geen geschikte route gevonden</strong><span>Probeer een ander tijdstip of een nabijgelegen halte.</span></div>`;return;}
    root.innerHTML=its.map((it,i)=>routeCard(it,i)).join("");
    root.querySelectorAll("[data-map]").forEach(b=>b.addEventListener("click",()=>bridge.showPlannerRouteOnMap(its[Number(b.dataset.map)])));
    root.querySelectorAll("[data-details]").forEach(b=>b.addEventListener("click",()=>{
      const d=root.querySelector(`#routeDetails${b.dataset.details}`); d.classList.toggle("hidden"); b.textContent=d.classList.contains("hidden")?"Details":"Minder";
    }));
  }

  function routeCard(it,i){
    const duration=mins(it.arrival-it.departure), transfers=Math.max(0,(it.legs||[]).filter(l=>l.type==="transit").length-1);
    const badge=i===0?'<span class="best">Beste keuze</span>':'';
    const legs=(it.legs||[]).map(leg=>legRow(leg)).join("");
    const stops=(it.legs||[]).filter(l=>l.type==="transit").flatMap((l,li)=> (l.stops||[]).map((s,si)=>({s,time:si===0?l.departure:(si===l.stops.length-1?l.arrival:null)}))).filter((x,idx,arr)=>idx===0||x.s.id!==arr[idx-1].s.id);
    return `<article class="route-option-card" data-route-card="${i}">
      <div class="route-option-head"><div class="route-time-block"><strong>${secTime(it.departure)} → ${secTime(it.arrival)}</strong><span>${duration} min · ${transfers?`${transfers} overstap${transfers>1?'pen':''}`:'rechtstreeks'}</span></div><div class="route-summary-badges">${badge}<span>${it.walkMinutes||0} min lopen</span><span>${transfers}× overstap</span></div></div>
      <div class="route-timeline">${legs}</div>
      <div class="route-details hidden" id="routeDetails${i}"><div class="route-stop-list">${stops.map(x=>`<div class="route-stop-item"><span>${x.time!=null?secTime(x.time):''}</span><i></i><strong>${esc(x.s.name)}</strong></div>`).join('')}</div></div>
      <div class="route-option-actions"><button data-details="${i}">Details</button><button class="primary" data-map="${i}">Toon op kaart</button></div>
    </article>`;
  }

  function legRow(leg){
    if(leg.type==="walk") return `<div class="route-leg-row"><span class="route-mode-icon walk">🚶</span><span class="route-leg-copy"><strong>${leg.minutes} min lopen</strong><span>${esc(leg.fromName)} → ${esc(leg.toName)}</span><small>${Math.round(leg.distanceMeters||0)} m</small></span><span class="route-leg-times"><strong>${secTime(leg.departure)}</strong><span>${secTime(leg.arrival)}</span></span></div>`;
    const live=leg.liveDelay!=null ? `<span class="live-delay">${leg.liveDelay>0?'+':''}${leg.liveDelay} min live</span>` : `<span>${leg.realtimeChecked?'op tijd live':'dienstregeling'}</span>`;
    return `<div class="route-leg-row"><span class="route-mode-icon">${esc(leg.routeShortName||'BUS')}</span><span class="route-leg-copy"><strong>Lijn ${esc(leg.routeShortName||'?')} → ${esc(leg.headsign||leg.toName)}</strong><span>${esc(leg.fromName)} → ${esc(leg.toName)}</span><small>${leg.stopCount||0} haltes</small></span><span class="route-leg-times"><strong>${secTime(leg.departure)}</strong>${live}</span></div>`;
  }

  async function realtimeEnhance(itineraries){
    if(!itineraries.length || !planner.from?.stop || !planner.from?.entity || !cfg.DELIJN_CORE_KEY) return;
    try{
      const url=`${cfg.CORE_BASE_URL}/haltes/${encodeURIComponent(planner.from.entity)}/${encodeURIComponent(planner.from.stop)}/real-time?maxAantalDoorkomsten=20`;
      const r=await fetch(url,{cache:"no-store",headers:{Accept:"application/json","Ocp-Apim-Subscription-Key":cfg.DELIJN_CORE_KEY}}); if(!r.ok)return;
      const data=await r.json(); const rows=[]; for(const g of data.halteDoorkomsten||[]) rows.push(...(g.doorkomsten||[]));
      let changed=false;
      for(const it of itineraries){const first=(it.legs||[]).find(l=>l.type==="transit"); if(!first)continue; const target=first.departure;
        const matches=rows.filter(x=>String(x.lijnnummer??x.lijnNummer??'')===String(first.routeShortName||''));
        let best=null,bestDiff=99999;
        for(const x of matches){const raw=x["real-timeTijdstip"]||x.realTimeTijdstip||x.dienstregelingTijdstip;if(!raw)continue;const m=String(raw).match(/(\d{2}):(\d{2})(?::(\d{2}))?/);if(!m)continue;const sec=Number(m[1])*3600+Number(m[2])*60+Number(m[3]||0);const diff=Math.abs(sec-target);if(diff<bestDiff){bestDiff=diff;best={sec,x}}}
        if(best&&bestDiff<=15*60){first.realtimeChecked=true;first.liveDelay=Math.round((best.sec-first.departure)/60);changed=true;}
      }
      if(changed) renderResults({itineraries,indexDate:planner.lastRequest?.date});
    }catch(e){console.warn("Realtime routecheck mislukt",e)}
  }

  $("#plannerUseLocation").addEventListener("click",useLocation);
  $("#plannerSwap").addEventListener("click",swapStops);
  $("#plannerClearTo").addEventListener("click",()=>{planner.to=null;$("#plannerTo").value="";$("#plannerTo").focus()});
  $("#plannerGo").addEventListener("click",planRoute);
  $("#plannerRetry").addEventListener("click",planRoute);
  $("#plannerMode").addEventListener("click",e=>{const b=e.target.closest("button[data-mode]");if(!b)return;planner.mode=b.dataset.mode;[...$("#plannerMode").children].forEach(x=>x.classList.toggle("active",x===b));$("#plannerDateTimeWrap").classList.toggle("hidden",planner.mode==="now")});
  $("#plannerPref").addEventListener("click",()=>{planner.pref=planner.pref==="fastest"?"fewest":"fastest";$("#plannerPref span").textContent=planner.pref==="fastest"?"Snelste":"Minst overstappen"});
  document.addEventListener("click",e=>{if(!e.target.closest(".journey-field")){ $("#plannerFromResults").classList.add("hidden");$("#plannerToResults").classList.add("hidden") }});

  createSearch("#plannerFrom","#plannerFromResults","from"); createSearch("#plannerTo","#plannerToResults","to"); setDefaultDateTime();
})();
