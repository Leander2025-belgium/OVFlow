(() => {
  "use strict";

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const app = $("#app");
  const state = {
    tab: "home",
    location: null,
    locationName: localStorage.getItem("ovflow.locationName") || "Locatie",
    nearby: [],
    nearbyDepartures: new Map(),
    alerts: [],
    stations: [],
    stationsLoaded: false,
    planner: { from: null, to: null, results: [], loading: false, focus: null },
    activeTrip: readJson("ovflow.activeTrip", null),
    favorites: readJson("ovflow.favorites", []),
    history: readJson("ovflow.history", []),
    map: null,
    mapLayers: [],
    geoWatch: null,
    currentPosition: null,
    liveLineData: null,
    liveDirection: null
  };

  function readJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function esc(v = "") { return String(v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
  function icon(name, cls = "") { return `<i data-lucide="${name}"${cls ? ` class="${cls}"` : ""}></i>`; }
  function refreshIcons() { window.lucide?.createIcons({ attrs: { "stroke-width": 2 } }); }
  function toast(text) { const t = $("#toast"); t.textContent = text; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2600); }
  function fmtDistance(m) { if (!Number.isFinite(Number(m))) return ""; return m < 1000 ? `${Math.round(m)} m` : `${(m/1000).toFixed(m < 10000 ? 1 : 0)} km`; }
  function fmtClock(value) {
    if (value == null || value === "") return "--:--";
    if (/^\d{2}:\d{2}/.test(String(value))) return String(value).slice(0,5);
    const n = Number(value);
    const d = Number.isFinite(n) && n > 1000000000 ? new Date(n * 1000) : new Date(value);
    return Number.isNaN(d.getTime()) ? "--:--" : d.toLocaleTimeString("nl-BE", {hour:"2-digit",minute:"2-digit"});
  }
  function minutesUntil(value) {
    const n = Number(value); const d = Number.isFinite(n) && n > 1000000000 ? new Date(n*1000) : new Date(value);
    if (Number.isNaN(d.getTime())) return null; return Math.round((d.getTime()-Date.now())/60000);
  }
  function normalizeText(v) { return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }
  function haversine(a,b){ const R=6371000,toRad=x=>x*Math.PI/180; const dLat=toRad(b.lat-a.lat),dLon=toRad(b.lon-a.lon); const x=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2; return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); }
  function nowInput() { const d=new Date(); d.setMinutes(Math.ceil(d.getMinutes()/5)*5,0,0); return {date:d.toISOString().slice(0,10),time:d.toTimeString().slice(0,5)}; }
  function formatIrailDate(date) { const d=String(date||"").split("-"); return d.length===3 ? `${d[2]}${d[1]}${d[0].slice(2)}` : ""; }
  function formatIrailTime(time){ return String(time||"").replace(":","").slice(0,4); }

  async function fetchJson(url, options = {}) {
    const ctl = new AbortController(); const timer = setTimeout(()=>ctl.abort(), options.timeout || 14000);
    try {
      const r = await fetch(url, {headers:{Accept:"application/json",...(options.headers||{})}, signal:ctl.signal, cache: options.cache || "no-store"});
      const text = await r.text(); let data={}; try{ data=text?JSON.parse(text):{}; }catch{ throw new Error("Ongeldig antwoord van server"); }
      if(!r.ok) throw new Error(data.message || data.error || `HTTP ${r.status}`); return data;
    } finally { clearTimeout(timer); }
  }
  const api = path => fetchJson(path);
  function irail(path, params={}) { const u=new URL(`https://api.irail.be${path}`); u.searchParams.set("format","json");u.searchParams.set("lang","nl"); Object.entries(params).forEach(([k,v])=>v!==undefined&&v!==null&&v!==""&&u.searchParams.set(k,v)); return fetchJson(u); }

  function setTab(tab) {
    state.tab = tab;
    $$(".nav-item").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
    stopMap();
    render();
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function sectionHead(title, sub="", action="", actionLabel="") {
    return `<div class="section-head"><div><h2>${esc(title)}</h2>${sub?`<p>${esc(sub)}</p>`:""}</div>${action?`<button class="link-button" data-action="${action}">${esc(actionLabel)}</button>`:""}</div>`;
  }
  function empty(iconName, title, text){ return `<div class="empty">${icon(iconName)}<div><strong>${esc(title)}</strong></div><div style="font-size:12px;margin-top:4px">${esc(text)}</div></div>`; }

  async function locate({silent=false}={}) {
    if(!navigator.geolocation){ if(!silent) toast("Locatie wordt niet ondersteund op dit toestel."); return null; }
    return new Promise(resolve=>navigator.geolocation.getCurrentPosition(async pos=>{
      state.location={lat:pos.coords.latitude,lon:pos.coords.longitude,accuracy:pos.coords.accuracy}; state.currentPosition=state.location;
      state.locationName="In de buurt"; localStorage.setItem("ovflow.locationName",state.locationName); updateHeaderLocation();
      if(!silent) toast("Locatie bijgewerkt."); resolve(state.location);
    },()=>{ if(!silent) toast("Locatie kon niet worden opgehaald."); resolve(null); },{enableHighAccuracy:true,timeout:9000,maximumAge:30000}));
  }
  function updateHeaderLocation(){ $("#headerLocation span").textContent=state.locationName || "Locatie"; }

  async function loadStations(){
    if(state.stationsLoaded) return state.stations;
    try{ const d=await irail("/stations/"); const arr=Array.isArray(d.station)?d.station:d.station?[d.station]:[]; state.stations=arr.map(s=>({type:"rail",name:s.standardname||s.name,id:s.id,lat:Number(s.locationY),lon:Number(s.locationX),provider:"NMBS"})); state.stationsLoaded=true; }
    catch{ state.stations=[]; }
    return state.stations;
  }

  async function searchPlaces(q){
    q=String(q||"").trim(); if(q.length<2) return [];
    const [st, dl] = await Promise.allSettled([loadStations(), api(`/api/delijn/search?q=${encodeURIComponent(q)}&max=10`)]);
    const nq=normalizeText(q); const out=[];
    if(st.status==="fulfilled") out.push(...st.value.filter(s=>normalizeText(s.name).includes(nq)).slice(0,6));
    if(dl.status==="fulfilled") {
      const stops=Array.isArray(dl.value.stops)?dl.value.stops:Array.isArray(dl.value.haltes)?dl.value.haltes:[];
      const lines=Array.isArray(dl.value.lines)?dl.value.lines:Array.isArray(dl.value.lijnen)?dl.value.lijnen:[];
      out.push(...stops.slice(0,7).map(s=>({type:"stop",name:s.name||s.omschrijvingLang||s.omschrijving,id:`${s.entiteit||s.entiteitnummer}-${s.haltenummer}`,entiteit:s.entiteit||s.entiteitnummer,haltenummer:s.haltenummer,lat:Number(s.latitude||s.geoCoordinaat?.latitude),lon:Number(s.longitude||s.geoCoordinaat?.longitude),direction:s.richting||"",provider:"De Lijn",raw:s})));
      out.push(...lines.slice(0,5).map(l=>({type:"line",name:`Lijn ${l.lijnnummerPubliek||l.lijnnummer}`,subtitle:l.omschrijving||"",line:String(l.lijnnummerPubliek||l.lijnnummer||""),provider:"De Lijn",raw:l})));
    }
    const seen=new Set(); return out.filter(x=>{const k=`${x.type}:${x.id||x.line||normalizeText(x.name)}`; if(seen.has(k))return false;seen.add(k);return true;}).slice(0,14);
  }

  function homeView(){
    return `<div class="stack">
      <section class="hero">
        <div class="eyebrow">OVFlow 2.0</div><h1>Waar wil je heen?</h1>
        <div class="hero-copy">Trein, bus en tram in één rustige reisflow. Live vertrekken, haltes en je rit volgen zonder door menu's te graven.</div>
        <div class="journey-search">${icon("search")}<input id="homeDestination" placeholder="Bestemming, halte of station" autocomplete="off"><button data-action="home-plan">Plan</button></div>
        <div class="hero-shortcuts"><button class="shortcut" data-action="locate-nearby">${icon("navigation")}In de buurt</button><button class="shortcut" data-action="goto" data-tab="live">${icon("radio-tower")}Volg mijn rit</button>${state.history[0]?`<button class="shortcut" data-action="repeat-history" data-index="0">${icon("history")}Herhaal laatste reis</button>`:""}</div>
      </section>
      <div class="home-grid">
        <div class="stack">
          <section class="section">${sectionHead("Vertrekt nu","Dichtstbijzijnde haltes met live doorkomsten","goto-plan","Plan een reis")}<div id="nearbyArea" class="card">${empty("map-pin","Locatie nodig","Tik op 'In de buurt' om live vertrekken rondom je te tonen.")}</div></section>
          <section class="section">${sectionHead("Netwerkstatus","Actuele storingen van NMBS en De Lijn")}<div id="alertArea" class="stack"><div class="skeleton"></div></div></section>
        </div>
        <div class="stack"><section class="section">${sectionHead("Kaart","Haltes rondom jou")}<div id="homeMap" class="map-card"></div></section>${state.activeTrip?`<section class="section">${sectionHead("Actieve rit","Ga meteen verder waar je was")}<div class="card card-pad">${renderActiveTripMini()}</div></section>`:""}</div>
      </div>
    </div>`;
  }

  function renderActiveTripMini(){ const t=state.activeTrip; if(!t)return""; return `<div class="live-title-row"><div class="live-line"><div class="line-circle">${esc(t.line||"OV")}</div><div><h2>${esc(t.title||`Lijn ${t.line}`)}</h2><p>${esc(t.direction||t.provider||"")}</p></div></div><button class="secondary-button" data-action="goto" data-tab="live">Open</button></div>`; }

  async function hydrateHome(){
    loadAlerts();
    if(!state.location) await locate({silent:true});
    if(state.location) await loadNearby();
    renderHomeMap();
  }
  async function loadAlerts(){
    const box=$("#alertArea"); if(!box)return;
    try{ const d=await api("/api/alerts/all"); const a=Array.isArray(d.alerts)?d.alerts:[]; state.alerts=a; box.innerHTML=a.length?a.slice(0,4).map(x=>`<div class="status-card ${x.severity==="critical"?"danger":"warning"}"><div class="status-icon">${icon("triangle-alert")}</div><div><strong>${esc(x.title||"Melding")}</strong><p>${esc((x.description||x.provider||"").split("\n")[0])}</p></div></div>`).join(""):`<div class="status-card"><div class="status-icon">${icon("circle-check")}</div><div><strong>Geen grote actuele meldingen</strong><p>De beschikbare NMBS- en De Lijn-bronnen melden momenteel niets belangrijks.</p></div></div>`; refreshIcons(); }
    catch{ box.innerHTML=`<div class="status-card warning"><div class="status-icon">${icon("wifi-off")}</div><div><strong>Meldingen tijdelijk niet bereikbaar</strong><p>Vertrekken en routeplanning kunnen nog wel werken.</p></div></div>`; refreshIcons(); }
  }
  async function loadNearby(){
    const box=$("#nearbyArea"); if(!box||!state.location)return;
    box.innerHTML=`<div style="padding:14px"><div class="skeleton"></div><div style="height:8px"></div><div class="skeleton"></div></div>`;
    try{
      const d=await api(`/api/delijn/nearby?lat=${state.location.lat}&lon=${state.location.lon}&max=4&radius=3000`); state.nearby=Array.isArray(d.stops)?d.stops:[];
      await Promise.all(state.nearby.map(async s=>{ try{ const x=await api(`/api/delijn/doorkomsten/${encodeURIComponent(s.entiteit)}/${encodeURIComponent(s.haltenummer)}`); const arr=Array.isArray(x.doorkomsten)?x.doorkomsten:Array.isArray(x.vertrekken)?x.vertrekken:[]; state.nearbyDepartures.set(`${s.entiteit}-${s.haltenummer}`,arr.slice(0,4)); }catch{ state.nearbyDepartures.set(`${s.entiteit}-${s.haltenummer}`,[]); }}));
      box.innerHTML=state.nearby.length?state.nearby.map(renderNearbyStop).join(""):empty("map-pin-off","Geen haltes dichtbij","Binnen 3 km werden geen De Lijn-haltes gevonden."); refreshIcons(); renderHomeMap();
    }catch(e){ box.innerHTML=`<div class="error-box" style="margin:14px">Haltes konden niet worden geladen: ${esc(e.message)}</div>`; }
  }
  function depLine(d){return d.lijnnummerPubliek||d.lijnnummer||d.lijn||d.line||"—"} function depDest(d){return d.richting||d.bestemming||d.destination||"Richting onbekend"} function depTime(d){return d.doorkomsttijd||d.real-timeTijdstip||d.tijdstip||d.time||d.departureTime}
  function renderNearbyStop(s){ const deps=state.nearbyDepartures.get(`${s.entiteit}-${s.haltenummer}`)||[]; const payload=encodeURIComponent(JSON.stringify({type:"stop",name:s.name,id:`${s.entiteit}-${s.haltenummer}`,entiteit:s.entiteit,haltenummer:s.haltenummer,lat:Number(s.latitude),lon:Number(s.longitude),provider:"De Lijn"})); return `<div class="stop-group"><div class="stop-header"><div><div class="stop-name">${esc(s.name)}</div><div class="distance">${fmtDistance(s.distanceMeters)}</div></div><button class="icon-action" data-action="save-stop" data-payload="${payload}">${icon("bookmark-plus")}</button></div><div class="departure-list">${deps.length?deps.slice(0,3).map(d=>{const min=minutesUntil(depTime(d));return `<button class="departure-row" data-action="open-line" data-line="${esc(depLine(d))}" style="border-left:0;border-right:0;border-top:0;width:100%;text-align:left;color:inherit;background:transparent"><span class="mode-badge bus">${esc(depLine(d))}</span><span class="departure-main"><strong>${esc(depDest(d))}</strong><span>De Lijn · live</span></span><span class="departure-time"><strong>${fmtClock(depTime(d))}</strong><small class="${min!==null&&min<0?"late":""}">${min===null?"live":min<=0?"nu":`${min} min`}</small></span></button>`}).join(""):`<div class="empty" style="padding:15px">Geen live doorkomsten gevonden.</div>`}</div></div>`; }

  function planView(){ const n=nowInput(); return `<div class="planner-desktop"><section class="card form-card"><div class="planner-grid"><div>${sectionHead("Plan je reis","Snel, duidelijk en zonder nepresultaten")}</div><div class="trip-fields"><div class="place-field"><span class="dot"></span><div><label>Van</label><input id="fromInput" placeholder="Station of halte" autocomplete="off" value="${esc(state.planner.from?.name||"")}" data-role="place-input" data-side="from"></div></div><button class="swap-button" data-action="swap-places">${icon("arrow-down-up")}</button><div class="place-field destination"><span class="dot"></span><div><label>Naar</label><input id="toInput" placeholder="Bestemming" autocomplete="off" value="${esc(state.planner.to?.name||"")}" data-role="place-input" data-side="to"></div></div></div><div id="placeSuggestions" class="suggestions"></div><div class="planner-options"><button class="seg-button active" data-action="set-time-mode" data-value="depart">Vertrek</button><button class="seg-button" data-action="set-time-mode" data-value="arrive">Aankomst</button><button class="seg-button" data-action="use-current-location">${icon("locate-fixed")} Dichtste halte</button></div><div class="date-row"><label class="field">Datum<input id="planDate" type="date" value="${n.date}"></label><label class="field">Tijd<input id="planTime" type="time" value="${n.time}"></label></div><button class="primary-button" data-action="plan-route">${icon("route")}Zoek routes</button><div class="info-box">Treinroutes komen live van iRail. Voor bus/tram zoekt OVFlow 2.0 echte rechtstreekse De Lijn-ritten tussen twee haltes; als er geen betrouwbare route is, verzinnen we er geen.</div></div></section><section class="section"><div>${sectionHead("Reisopties",state.planner.results.length?`${state.planner.results.length} resultaten`:"Kies vertrek en bestemming")}</div><div id="planResults" class="route-list">${renderPlannerResults()}</div></section></div>`; }
  function renderPlannerResults(){ if(state.planner.loading)return `<div class="skeleton"></div><div class="skeleton"></div>`; if(!state.planner.results.length)return empty("route","Nog geen route","Vul vertrek en bestemming in en tik op Zoek routes."); return state.planner.results.map((r,i)=>r.type==="rail"?renderRailRoute(r,i):renderDeLijnRoute(r,i)).join(""); }

  function renderRailRoute(r,i){ return `<article class="route-option"><div class="route-summary"><div class="route-times"><div><div class="big-time">${esc(r.departureTime)}</div><small>${esc(r.from)}</small></div><div class="route-duration">${r.durationMin} min · ${r.transfers} overstap${r.transfers===1?"":"pen"}</div><div style="text-align:right"><div class="big-time">${esc(r.arrivalTime)}</div><small>${esc(r.to)}</small></div></div><div class="mode-strip"><span class="mode-node">TREIN</span><span class="mode-line"></span><span class="mode-node">${esc(r.vehicle||"NMBS")}</span></div><div class="route-meta"><span class="chip good">Live NMBS</span>${r.delay>0?`<span class="chip warn">+${r.delay} min</span>`:`<span class="chip">Op tijd</span>`}<button class="chip" data-action="toggle-route" data-index="${i}">${icon("list")}Details</button>${r.vehicle?`<button class="chip" data-action="follow-train" data-index="${i}">${icon("radio-tower")}Volg rit</button>`:""}</div></div><div class="timeline" id="routeDetails${i}" hidden>${r.steps.map(s=>`<div class="timeline-item"><div class="timeline-time">${esc(s.time)}</div><div class="timeline-rail"><span class="timeline-dot"></span></div><div class="timeline-copy"><strong>${esc(s.title)}</strong><p>${esc(s.detail||"")}</p></div></div>`).join("")}</div></article>`; }
  function renderDeLijnRoute(r,i){ return `<article class="route-option"><div class="route-summary"><div class="route-times"><div><div class="big-time">${esc(r.departureTime)}</div><small>${esc(r.from)}</small></div><div class="route-duration">Rechtstreeks · ${r.stopCount} haltes</div><div style="text-align:right"><div class="big-time">Lijn ${esc(r.line)}</div><small>${esc(r.direction)}</small></div></div><div class="mode-strip"><span class="mode-node">BUS/TRAM</span><span class="mode-line"></span><span class="mode-node">${esc(r.line)}</span></div><div class="route-meta"><span class="chip good">De Lijn live vertrek</span><button class="chip" data-action="start-delijn-result" data-index="${i}">${icon("radio-tower")}Volg deze rit</button><button class="chip" data-action="toggle-route" data-index="${i}">${icon("list")}Haltes</button></div></div><div class="timeline" id="routeDetails${i}" hidden>${r.stops.map((s,j)=>`<div class="timeline-item"><div class="timeline-time">${j===0?esc(r.departureTime):""}</div><div class="timeline-rail"><span class="timeline-dot"></span></div><div class="timeline-copy"><strong>${esc(s.name)}</strong><p>${j===0?"Instappen":j===r.stops.length-1?"Uitstappen":"Tussenhalte"}</p></div></div>`).join("")}</div></article>`; }

  async function doPlan(){
    const fromText=$("#fromInput")?.value.trim(),toText=$("#toInput")?.value.trim(); if(!fromText||!toText){toast("Vul vertrek en bestemming in.");return;}
    if(!state.planner.from || normalizeText(state.planner.from.name)!==normalizeText(fromText)) state.planner.from=await resolveTypedPlace(fromText);
    if(!state.planner.to || normalizeText(state.planner.to.name)!==normalizeText(toText)) state.planner.to=await resolveTypedPlace(toText);
    if(!state.planner.from||!state.planner.to){ toast("Ik kon één van de plaatsen niet betrouwbaar vinden."); return; }
    state.planner.loading=true; state.planner.results=[]; $("#planResults").innerHTML=renderPlannerResults();
    try{
      let results=[];
      if(state.planner.from.type==="rail" && state.planner.to.type==="rail") results=await planRail(state.planner.from,state.planner.to);
      else if(state.planner.from.type==="stop" && state.planner.to.type==="stop") results=await planDirectDeLijn(state.planner.from,state.planner.to);
      else throw new Error("Een gemengde trein + bus/tram routeplanner is nog niet betrouwbaar genoeg om hier een route te tonen. Kies twee stations of twee De Lijn-haltes.");
      state.planner.results=results;
      if(results.length){ state.history=[{from:state.planner.from,to:state.planner.to,at:Date.now()},...state.history.filter(h=>h.from?.name!==state.planner.from.name||h.to?.name!==state.planner.to.name)].slice(0,8);writeJson("ovflow.history",state.history); }
      if(!results.length) throw new Error("Geen betrouwbare route gevonden voor deze combinatie.");
    }catch(e){ state.planner.results=[]; $("#planResults").innerHTML=`<div class="error-box">${esc(e.message)}</div>`; state.planner.loading=false; refreshIcons(); return; }
    state.planner.loading=false; $("#planResults").innerHTML=renderPlannerResults(); refreshIcons();
  }
  async function resolveTypedPlace(text){ const x=await searchPlaces(text); const exact=x.find(v=>normalizeText(v.name)===normalizeText(text) && (v.type==="rail"||v.type==="stop")); return exact||x.find(v=>v.type==="rail"||v.type==="stop")||null; }
  async function planRail(from,to){
    const date=$("#planDate")?.value,time=$("#planTime")?.value,mode=$(".seg-button.active[data-action='set-time-mode']")?.dataset.value||"depart";
    const d=await irail("/connections/",{from:from.id||from.name,to:to.id||to.name,date:formatIrailDate(date),time:formatIrailTime(time),timesel:mode==="arrive"?"arrival":"departure",alerts:"true",results:6});
    const arr=Array.isArray(d.connection)?d.connection:d.connection?[d.connection]:[];
    return arr.slice(0,6).map(c=>{
      const dep=c.departure||{}, ar=c.arrival||{}, vias=Array.isArray(c.vias?.via)?c.vias.via:c.vias?.via?[c.vias.via]:[];
      const depTime=fmtClock(dep.time),arrTime=fmtClock(ar.time),duration=Math.round(Number(c.duration||0)/60); const delay=Math.max(Number(dep.delay||0),Number(ar.delay||0))/60;
      const vehicle=String(dep.vehicle||dep.vehicleinfo?.shortname||"").replace("BE.NMBS.","");
      const steps=[{time:depTime,title:`Vertrek ${stationName(dep,from.name)}`,detail:`${vehicle||"Trein"}${dep.platform?` · perron ${dep.platform}`:""}`}];
      vias.forEach(v=>steps.push({time:fmtClock(v.arrival?.time||v.time),title:`Overstap ${stationName(v,"Station")}`,detail:v.departure?.platform?`Naar perron ${v.departure.platform}`:"Overstappen"}));
      steps.push({time:arrTime,title:`Aankomst ${stationName(ar,to.name)}`,detail:ar.platform?`Perron ${ar.platform}`:""});
      return {type:"rail",from:stationName(dep,from.name),to:stationName(ar,to.name),departureTime:depTime,arrivalTime:arrTime,durationMin:duration,transfers:vias.length,delay:Math.round(delay),vehicle,vehicleId:dep.vehicle||dep.vehicleinfo?.name||vehicle,steps,raw:c};
    });
  }
  function stationName(p,fallback){return typeof p.station==="string"?p.station:p.station?.name||p.stationinfo?.name||fallback;}
  async function planDirectDeLijn(from,to){
    const live=await api(`/api/delijn/doorkomsten/${encodeURIComponent(from.entiteit)}/${encodeURIComponent(from.haltenummer)}`); const deps=Array.isArray(live.doorkomsten)?live.doorkomsten:Array.isArray(live.vertrekken)?live.vertrekken:[];
    const lines=[...new Set(deps.map(depLine).filter(Boolean))].slice(0,10); const candidates=[];
    const infos=await Promise.all(lines.map(async line=>{try{return [line,await api(`/api/delijn/lijnen/${encodeURIComponent(line)}`)]}catch{return [line,null]}}));
    for(const [line,data] of infos){ if(!data)continue; const stops=Array.isArray(data.stops)?data.stops:Array.isArray(data.haltes)?data.haltes:[]; const groups=new Map(); stops.forEach(s=>{const key=s.richting||"Richting";if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s)});
      for(const [direction,list] of groups){ const fi=findStopIndex(list,from),ti=findStopIndex(list,to); if(fi>=0&&ti>fi){ const dep=deps.filter(d=>String(depLine(d))===String(line)).sort((a,b)=>new Date(depTime(a))-new Date(depTime(b)))[0]; candidates.push({type:"delijn",line:String(line),direction,from:from.name,to:to.name,departureTime:dep?fmtClock(depTime(dep)):"live",stopCount:ti-fi,stops:list.slice(fi,ti+1).map(normalizeStop),allStops:list.map(normalizeStop)}); }
      }
    }
    return candidates.slice(0,5);
  }
  function findStopIndex(list,p){ const id=`${p.entiteit}-${p.haltenummer}`; let i=list.findIndex(s=>`${s.entiteit||s.entiteitnummer}-${s.haltenummer}`===id); if(i<0)i=list.findIndex(s=>normalizeText(s.name||s.omschrijvingLang||s.omschrijving)===normalizeText(p.name));return i; }
  function normalizeStop(s){return {name:s.name||s.omschrijvingLang||s.omschrijving||"Halte",lat:Number(s.latitude||s.geoCoordinaat?.latitude),lon:Number(s.longitude||s.geoCoordinaat?.longitude),entiteit:s.entiteit||s.entiteitnummer,haltenummer:s.haltenummer};}

  function liveView(){
    if(state.activeTrip) return renderActiveTrip();
    return `<div class="stack"><section class="live-hero"><div class="eyebrow">Live ritmodus</div><h1 style="font-size:29px;margin:7px 0 6px">Je volgende halte, zonder zoeken.</h1><div class="hero-copy">Zoek een De Lijn-lijn of open een trein vanuit een route. Tijdens bus/tramritten gebruikt OVFlow je telefoonlocatie om je positie langs de haltes te bepalen.</div></section><section class="card card-pad"><div class="section-head"><div><h2>Start een bus- of tramrit</h2><p>Bijvoorbeeld 6, 50 of Kusttram</p></div></div><div class="journey-search" style="margin-top:12px"><${"i"} data-lucide="search"></${"i"}><input id="liveLineInput" placeholder="Lijnnummer of plaats"><button data-action="find-live-line">Zoek</button></div><div id="liveSearchResults" class="suggestions"></div></section><section class="section">${sectionHead("Waarom dit handig is","Tijdens de rit houdt OVFlow het scherm eenvoudig")}<div class="card card-pad"><div class="status-card"><div class="status-icon">${icon("navigation")}</div><div><strong>Automatische haltevoortgang</strong><p>OVFlow vergelijkt je GPS-locatie met de haltevolgorde en markeert waar je ongeveer bent.</p></div></div><div style="height:8px"></div><div class="status-card"><div class="status-icon">${icon("map")}</div><div><strong>Route op kaart</strong><p>Alle haltes van de gekozen richting blijven zichtbaar tijdens je rit.</p></div></div></div></section></div>`;
  }
  function renderActiveTrip(){ const t=state.activeTrip; const stops=t.stops||[]; const pos=getTripProgress(t); const current=pos.currentIndex; const next=Math.min(stops.length-1,Math.max(0,pos.nextIndex)); const nextStop=stops[next]; const pct=stops.length>1?Math.max(0,Math.min(100,(Math.max(current,0)/(stops.length-1))*100)):0;
    return `<div class="stack"><section class="live-hero"><div class="live-title-row"><div class="live-line"><div class="line-circle">${esc(t.line||"🚆")}</div><div><h2>${esc(t.title||`Lijn ${t.line||""}`)}</h2><p>${esc(t.direction||t.provider||"")}</p></div></div><span class="pulse">Live</span></div><div class="next-stop"><small>Volgende halte</small><strong>${esc(nextStop?.name||"Locatie bepalen…")}</strong><div style="display:flex;justify-content:space-between;margin-top:6px;color:var(--muted);font-size:11px"><span>${pos.distanceToNext?`${fmtDistance(pos.distanceToNext)} verder`:"GPS wordt gevolgd"}</span><span>${Math.max(0,next)} / ${Math.max(0,stops.length-1)}</span></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></div><div style="display:flex;gap:8px;margin-top:12px"><button class="secondary-button" style="flex:1" data-action="refresh-live">${icon("locate-fixed")}Update GPS</button><button class="secondary-button" data-action="stop-live">${icon("square")}Stop</button></div></section><section class="section">${sectionHead("Rit op kaart",state.currentPosition?"Je locatie wordt gevolgd":"Geef locatie toestemming voor automatische voortgang")}<div id="liveMap" class="map-card tall"></div></section><section class="section">${sectionHead("Haltes",`${stops.length} haltes in deze richting`)}<div class="card live-stops">${stops.map((s,i)=>`<div class="live-stop ${i<current?"passed":i===current?"current":""}"><div class="stop-time">${i===next?"VOLGENDE":""}</div><div class="rail"><span class="rail-dot"></span></div><div><strong>${esc(s.name)}</strong><small>${Number.isFinite(s.lat)&&Number.isFinite(s.lon)?"GPS-punt beschikbaar":""}</small></div></div>`).join("")}</div></section></div>`; }
  function getTripProgress(t){ const stops=t.stops||[]; if(!state.currentPosition||!stops.length)return {currentIndex:-1,nextIndex:0,distanceToNext:null}; let best={i:0,d:Infinity}; stops.forEach((s,i)=>{if(Number.isFinite(s.lat)&&Number.isFinite(s.lon)){const d=haversine(state.currentPosition,{lat:s.lat,lon:s.lon});if(d<best.d)best={i,d}}}); let current=best.i; if(best.d>1800)current=-1; const next=current<0?0:Math.min(stops.length-1,current+1); const ns=stops[next]; const dist=ns&&Number.isFinite(ns.lat)?haversine(state.currentPosition,{lat:ns.lat,lon:ns.lon}):null; return {currentIndex:current,nextIndex:next,distanceToNext:dist}; }
  async function openLiveLine(line){ const box=$("#liveSearchResults"); if(box)box.innerHTML=`<div class="skeleton"></div>`; try{const d=await api(`/api/delijn/lijnen/${encodeURIComponent(line)}`);state.liveLineData=d; const stops=Array.isArray(d.stops)?d.stops:Array.isArray(d.haltes)?d.haltes:[];const groups=new Map();stops.forEach(s=>{const k=s.richting||"Richting";if(!groups.has(k))groups.set(k,[]);groups.get(k).push(normalizeStop(s))}); if(!box)return; box.innerHTML=[...groups].map(([dir,list],i)=>`<button class="suggestion" data-action="start-live-line" data-line="${esc(line)}" data-direction-index="${i}"><span class="suggestion-icon">${icon("bus")}</span><span><strong>Lijn ${esc(line)} · ${esc(dir)}</strong><small>${list.length} haltes</small></span><span class="provider">Start</span></button>`).join("")||`<div class="error-box">Geen haltevolgorde gevonden voor deze lijn.</div>`; state.liveDirection=[...groups];refreshIcons();}catch(e){if(box)box.innerHTML=`<div class="error-box">${esc(e.message)}</div>`;} }
  function startLiveLine(line,index){const entry=state.liveDirection?.[Number(index)];if(!entry)return;const [direction,stops]=entry;state.activeTrip={provider:"De Lijn",line,title:`Lijn ${line}`,direction,stops,startedAt:Date.now()};writeJson("ovflow.activeTrip",state.activeTrip);startGeoWatch();render();}
  function startGeoWatch(){ if(!navigator.geolocation||state.geoWatch)return; state.geoWatch=navigator.geolocation.watchPosition(p=>{state.currentPosition={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy}; if(state.tab==="live"){app.innerHTML=liveView();refreshIcons();setTimeout(renderLiveMap,30);}},()=>{}, {enableHighAccuracy:true,maximumAge:5000,timeout:12000}); }
  function stopGeoWatch(){if(state.geoWatch&&navigator.geolocation){navigator.geolocation.clearWatch(state.geoWatch);state.geoWatch=null;}}

  function savedView(){ return `<div class="stack"><section>${sectionHead("Bewaard","Je favoriete haltes en recente reizen")}</section><section class="section">${sectionHead("Favoriete haltes",`${state.favorites.length} bewaard`)}<div class="card">${state.favorites.length?state.favorites.map((f,i)=>`<div class="saved-item"><div class="saved-icon">${icon("map-pin")}</div><div><strong>${esc(f.name)}</strong><small>${esc(f.provider||"De Lijn")}</small></div><button class="icon-action" data-action="remove-favorite" data-index="${i}">${icon("trash-2")}</button></div>`).join(""):empty("bookmark","Nog niets bewaard","Bewaar een halte vanaf Vandaag.")}</div></section><section class="section">${sectionHead("Recente reizen",`${state.history.length} recent`)}<div class="card">${state.history.length?state.history.map((h,i)=>`<button class="saved-item" style="width:100%;background:transparent;border-left:0;border-right:0;border-top:0;color:inherit;text-align:left" data-action="repeat-history" data-index="${i}"><div class="saved-icon">${icon("route")}</div><div><strong>${esc(h.from?.name||"")} → ${esc(h.to?.name||"")}</strong><small>${new Date(h.at).toLocaleString("nl-BE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</small></div><span>${icon("chevron-right")}</span></button>`).join(""):empty("history","Nog geen recente reizen","Je geplande reizen verschijnen hier automatisch.")}</div></section><div class="info-box source-note">Reisinformatie: bron De Lijn en NMBS/iRail. Kaartgegevens © OpenStreetMap-bijdragers.</div></div>`; }

  function render(){
    if(state.tab==="home")app.innerHTML=homeView(); else if(state.tab==="plan")app.innerHTML=planView(); else if(state.tab==="live")app.innerHTML=liveView(); else app.innerHTML=savedView(); refreshIcons();
    if(state.tab==="home")setTimeout(hydrateHome,0); if(state.tab==="live"&&state.activeTrip){startGeoWatch();setTimeout(renderLiveMap,40);} updateHeaderLocation();
  }

  async function handlePlaceInput(el){ const q=el.value; state.planner.focus=el.dataset.side; const box=$("#placeSuggestions"); if(!box)return; if(q.trim().length<2){box.innerHTML="";return;} const token=Date.now();handlePlaceInput._token=token;box.innerHTML=`<div class="skeleton"></div>`; const items=await searchPlaces(q);if(handlePlaceInput._token!==token)return; box.innerHTML=items.filter(x=>x.type!=="line").map((x,i)=>`<button class="suggestion" data-action="choose-place" data-index="${i}"><span class="suggestion-icon">${icon(x.type==="rail"?"train-front":"bus-front")}</span><span><strong>${esc(x.name)}</strong><small>${esc(x.direction||x.subtitle||"")}</small></span><span class="provider">${esc(x.provider)}</span></button>`).join("")||`<div class="empty" style="padding:14px">Geen resultaten</div>`; handlePlaceInput._items=items.filter(x=>x.type!=="line");refreshIcons(); }

  function renderHomeMap(){ const el=$("#homeMap"); if(!el||!window.L)return; stopMap(); const center=state.location?[state.location.lat,state.location.lon]:[51.2194,2.9287]; state.map=L.map(el,{zoomControl:false,attributionControl:true}).setView(center,state.location?14:12); L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(state.map); L.control.zoom({position:"bottomright"}).addTo(state.map); if(state.location)L.circleMarker(center,{radius:8,weight:3,color:"#fff",fillColor:"#459ef4",fillOpacity:1}).addTo(state.map).bindPopup("Jij bent hier"); state.nearby.forEach(s=>{const lat=Number(s.latitude),lon=Number(s.longitude);if(Number.isFinite(lat)&&Number.isFinite(lon))L.circleMarker([lat,lon],{radius:6,weight:2,color:"#dceeff",fillColor:"#1e75d4",fillOpacity:1}).addTo(state.map).bindPopup(`<strong>${esc(s.name)}</strong><br>${fmtDistance(s.distanceMeters)}`)}); setTimeout(()=>state.map?.invalidateSize(),50); }
  function renderLiveMap(){ const el=$("#liveMap"); if(!el||!window.L||!state.activeTrip)return; stopMap(); const pts=(state.activeTrip.stops||[]).filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)); const center=state.currentPosition?[state.currentPosition.lat,state.currentPosition.lon]:pts[0]?[pts[0].lat,pts[0].lon]:[51.2194,2.9287]; state.map=L.map(el,{zoomControl:false}).setView(center,13);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(state.map); if(pts.length){const line=L.polyline(pts.map(s=>[s.lat,s.lon]),{weight:5,opacity:.75}).addTo(state.map);pts.forEach((s,i)=>L.circleMarker([s.lat,s.lon],{radius:i===getTripProgress(state.activeTrip).nextIndex?7:4,weight:2,fillOpacity:1}).addTo(state.map).bindPopup(esc(s.name))); if(!state.currentPosition)state.map.fitBounds(line.getBounds(),{padding:[20,20]});} if(state.currentPosition)L.circleMarker([state.currentPosition.lat,state.currentPosition.lon],{radius:9,weight:3,color:"white",fillColor:"#4ba8ff",fillOpacity:1}).addTo(state.map).bindPopup("Jij"); setTimeout(()=>state.map?.invalidateSize(),50); }
  function stopMap(){if(state.map){try{state.map.remove()}catch{}state.map=null;}}

  function openSheet(html){$("#sheetContent").innerHTML=html;$("#sheet").hidden=false;$("#sheetBackdrop").hidden=false;refreshIcons();}
  function closeSheet(){$("#sheet").hidden=true;$("#sheetBackdrop").hidden=true;$("#sheetContent").innerHTML="";}

  document.addEventListener("input",e=>{if(e.target.matches("[data-role='place-input']")){clearTimeout(handlePlaceInput._t);handlePlaceInput._t=setTimeout(()=>handlePlaceInput(e.target),260);}});
  document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.id==="homeDestination"){e.preventDefault();document.querySelector('[data-action="home-plan"]')?.click();}if(e.key==="Enter"&&e.target.id==="liveLineInput"){e.preventDefault();document.querySelector('[data-action="find-live-line"]')?.click();}});
  document.addEventListener("click",async e=>{
    const b=e.target.closest("[data-action]"); if(!b)return; const a=b.dataset.action;
    if(a==="goto"){setTab(b.dataset.tab);return;} if(a==="refresh"){render();toast("Live info vernieuwd.");return;} if(a==="locate"){await locate();render();return;} if(a==="locate-nearby"){await locate();await loadNearby();renderHomeMap();return;} if(a==="goto-plan"){setTab("plan");return;}
    if(a==="home-plan"){const q=$("#homeDestination")?.value.trim();if(!q){setTab("plan");return;}setTab("plan");setTimeout(()=>{const el=$("#toInput");if(el){el.value=q;state.planner.to=null;el.focus();handlePlaceInput(el)}},0);return;}
    if(a==="choose-place"){const item=handlePlaceInput._items?.[Number(b.dataset.index)];if(!item)return;state.planner[state.planner.focus]=item;const input=$(state.planner.focus==="from"?"#fromInput":"#toInput");if(input)input.value=item.name;$("#placeSuggestions").innerHTML="";return;}
    if(a==="swap-places"){[state.planner.from,state.planner.to]=[state.planner.to,state.planner.from];render();return;}
    if(a==="set-time-mode"){$$("[data-action='set-time-mode']").forEach(x=>x.classList.toggle("active",x===b));return;}
    if(a==="use-current-location"){if(!state.location)await locate();if(!state.location){return;}try{const d=await api(`/api/delijn/nearby?lat=${state.location.lat}&lon=${state.location.lon}&max=1&radius=5000`);const s=d.stops?.[0];if(!s)throw new Error();state.planner.from={type:"stop",name:s.name,id:`${s.entiteit}-${s.haltenummer}`,entiteit:s.entiteit,haltenummer:s.haltenummer,lat:Number(s.latitude),lon:Number(s.longitude),provider:"De Lijn"};$("#fromInput").value=s.name;toast(`Vertrek: ${s.name}`);}catch{toast("Geen halte dichtbij gevonden.");}return;}
    if(a==="plan-route"){await doPlan();return;} if(a==="toggle-route"){const el=$(`#routeDetails${b.dataset.index}`);if(el)el.hidden=!el.hidden;return;}
    if(a==="follow-train"){const r=state.planner.results[Number(b.dataset.index)];if(!r)return;try{const d=await irail("/vehicle/",{id:r.vehicleId,alerts:"true"});const raw=Array.isArray(d.stops?.stop)?d.stops.stop:Array.isArray(d.vehicle?.stops?.stop)?d.vehicle.stops.stop:[];const stops=raw.map(s=>({name:stationName(s,s.station||"Station"),lat:Number(s.stationinfo?.locationY||s.locationY),lon:Number(s.stationinfo?.locationX||s.locationX),time:fmtClock(s.time)}));state.activeTrip={provider:"NMBS",line:r.vehicle||"TREIN",title:r.vehicle||"Trein",direction:r.to,stops,startedAt:Date.now()};writeJson("ovflow.activeTrip",state.activeTrip);setTab("live");}catch{toast("Treinrit kon niet worden geladen.");}return;}
    if(a==="start-delijn-result"){const r=state.planner.results[Number(b.dataset.index)];if(!r)return;state.activeTrip={provider:"De Lijn",line:r.line,title:`Lijn ${r.line}`,direction:r.direction,stops:r.allStops||r.stops,startedAt:Date.now()};writeJson("ovflow.activeTrip",state.activeTrip);setTab("live");return;}
    if(a==="find-live-line"){const q=$("#liveLineInput")?.value.trim();if(!q){toast("Vul een lijnnummer in.");return;}const m=q.match(/\d+[A-Za-z]?/);await openLiveLine(m?m[0]:q);return;} if(a==="open-line"){setTab("live");setTimeout(()=>{const el=$("#liveLineInput");if(el){el.value=b.dataset.line;openLiveLine(b.dataset.line)}},0);return;}
    if(a==="start-live-line"){startLiveLine(b.dataset.line,b.dataset.directionIndex);return;} if(a==="refresh-live"){await locate();render();return;} if(a==="stop-live"){state.activeTrip=null;writeJson("ovflow.activeTrip",null);stopGeoWatch();render();return;}
    if(a==="save-stop"){try{const item=JSON.parse(decodeURIComponent(b.dataset.payload));if(!state.favorites.some(f=>f.id===item.id)){state.favorites.unshift(item);state.favorites=state.favorites.slice(0,20);writeJson("ovflow.favorites",state.favorites);toast("Halte bewaard.");}else toast("Deze halte staat al bij Bewaard.");}catch{}return;}
    if(a==="remove-favorite"){state.favorites.splice(Number(b.dataset.index),1);writeJson("ovflow.favorites",state.favorites);render();return;} if(a==="repeat-history"){const h=state.history[Number(b.dataset.index)];if(!h)return;state.planner.from=h.from;state.planner.to=h.to;setTab("plan");return;}
  });
  $("#sheetBackdrop").addEventListener("click",closeSheet);
  window.addEventListener("beforeunload",()=>{stopGeoWatch();stopMap();});

  updateHeaderLocation(); render();
  if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("/sw.js").catch(()=>{});
})();
