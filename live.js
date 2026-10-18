/* OVFlow live: exact trip stops, explicit GPS provenance, labelled time estimates. */
(() => {
 'use strict';
 const live={trip:null,data:null,stops:[],geometry:[],stopOffsets:[],gps:null,gpsError:'',updated:0,epoch:0,timers:[],following:false,board:[],mode:'all',place:{...station,id:''},boardSeq:0,loadingTrip:false,loadingGps:false};
 let liveMap,routeGroup,stopGroup,vehicle,stopMarkers=[],mapFitted=false;
 const millis=x=>{if(x==null||x==='')return NaN;if(typeof x==='string'&&/^\d+(\.\d+)?$/.test(x))x=Number(x);return typeof x==='number'?x*(x<1e12?1000:1):new Date(x).getTime();};
 const point=p=>{const lat=p?.lat??p?.latitude,lon=p?.lon??p?.longitude;if(lat==null||lon==null)return null;return Number.isFinite(+lat)&&Number.isFinite(+lon)&&Math.abs(+lat)<=90&&Math.abs(+lon)<=180?[+lat,+lon]:null;};
 const modeName=m=>/train|rail/i.test(m)?'Trein':/tram/i.test(m)?'Tram':/metro|subway/i.test(m)?'Metro':'Bus';
 const distance=(a,b)=>{const r=Math.PI/180;return 6371000*2*Math.asin(Math.min(1,Math.sqrt(Math.sin((b[0]-a[0])*r/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin((b[1]-a[1])*r/2)**2)));};
 function stopTime(s){if(!s)return NaN;return millis(s.departure||s.arrival||s.scheduledDeparture||s.scheduledArrival);}
 function makeMap(){if(liveMap||!window.L)return;liveMap=L.map('live-map',{scrollWheelZoom:false,zoomControl:false}).setView([51.228,2.925],13);L.control.zoom({position:'bottomright'}).addTo(liveMap);L.tileLayer((window.OVFLOW_CONFIG||{}).MAP_TILE_URL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(liveMap);routeGroup=L.layerGroup().addTo(liveMap);stopGroup=L.layerGroup().addTo(liveMap);liveMap.on('dragstart',()=>{live.following=false;renderFollow();});}
 function fit(){if(!liveMap)return;const pts=live.geometry.length?live.geometry:live.stops.map(point).filter(Boolean);if(pts.length)liveMap.fitBounds(pts,{padding:[40,65],maxZoom:16});}
 function clearVehicle(){if(vehicle){vehicle.remove();vehicle=null;}}
 function cancelTimers(){live.timers.forEach(clearInterval);live.timers=[];}
 function startTimers(){cancelTimers();if(state.view!=='live'||!live.trip)return;live.timers=[setInterval(()=>{if(!document.hidden)loadGps(live.epoch);},15000),setInterval(()=>{if(!document.hidden)loadTrip(live.epoch,false);},60000),setInterval(()=>{if(!document.hidden)renderProgress();},5000)];}
 function onView(view){cancelTimers();if(view!=='live')return;if(!location.hash.startsWith('#live'))history.replaceState(null,'','#live');if(live.trip){remember(live.trip);makeMap();setTimeout(()=>{liveMap?.invalidateSize();if(!mapFitted){fit();mapFitted=true;}},70);startTimers();}else loadBoard();}
 function remember(d){const params=new URLSearchParams({trip:d.tripId,line:d.line||'',destination:d.destination||'',mode:d.mode||'',operator:d.operator||''});history.replaceState(null,'','#live?'+params);try{sessionStorage.setItem('ovflow8.live-trip',JSON.stringify(d));}catch{}}
 function open(d){if(!d?.tripId){toast('Voor deze rit is geen rit-ID beschikbaar. Kies een ander vertrek.');return;}live.epoch++;cancelTimers();live.trip={tripId:d.tripId,gtfsTripId:d.gtfsTripId||String(d.tripId||"").match(/gt:delijn:.+$/)?.[0]||"",line:d.line||'',destination:d.destination||'',mode:d.mode||'bus',operator:d.operator||''};live.data=null;live.stops=[];live.geometry=[];live.gps=null;live.updated=0;live.loadingTrip=false;live.loadingGps=false;live.following=false;live.gpsError='GPS controleren…';mapFitted=false;$('#live-picker').hidden=true;$('#live-trip-panel').hidden=false;$('#live-choose').hidden=false;$('#live-line').textContent=live.trip.line||modeName(live.trip.mode);$('#live-operator').textContent=`${modeName(live.trip.mode)} · ${live.trip.operator||'Openbaar vervoer'}`;$('#live-destination').textContent=live.trip.destination?`Richting ${live.trip.destination}`:'Je geselecteerde rit';$('#live-journey').textContent='Haltevolgorde ophalen…';$('#live-stops').innerHTML='<div class="loading">Echte haltes van deze rit ophalen…</div>';$('#live-stops-count').textContent='Haltes laden…';$('#live-next').textContent='';$('#live-message').textContent='';$('#live-position-title').textContent='Positie ophalen…';$('#live-position-description').textContent='';$('#live-updated').textContent='';setView('live');remember(live.trip);makeMap();routeGroup?.clearLayers();stopGroup?.clearLayers();clearVehicle();renderFollow();loadTrip(live.epoch,true);loadGps(live.epoch);startTimers();}
 function openLeg(l){open({tripId:l.tripId,line:l.routeShortName||l.displayName,destination:l.headsign||l.to?.name,mode:l.mode,operator:l.agencyName});}
 function selectOther(){live.epoch++;cancelTimers();live.trip=null;live.data=null;live.stops=[];live.gps=null;live.loadingTrip=false;live.loadingGps=false;clearVehicle();try{sessionStorage.removeItem('ovflow8.live-trip');}catch{}history.replaceState(null,'','#live');$('#live-picker').hidden=false;$('#live-trip-panel').hidden=true;$('#live-choose').hidden=true;loadBoard();}
 async function loadBoard(){if(live.trip||state.view!=='live')return;const id=++live.boardSeq;$('#live-departures').innerHTML='<div class="loading">Ritten bij deze halte ophalen…</div>';try{const r=await OVFlowCore.stopDepartures(live.place,60);if(id!==live.boardSeq||live.trip)return;live.board=r.departures;renderBoard();}catch{if(id!==live.boardSeq||live.trip)return;live.board=[];$('#live-departures').innerHTML='<div class="empty">Ritten ophalen lukt niet. Kies een andere halte of probeer opnieuw.<button id="live-retry-board" class="outline">Opnieuw proberen</button></div>';$('#live-retry-board').onclick=loadBoard;}}
 function renderBoard(){const q=$('#live-line-query').value.trim().toLowerCase();const rows=live.board.filter(d=>(live.mode==='all'||d.mode===live.mode)&&`${d.line} ${d.destination}`.toLowerCase().includes(q));$('#live-departures').innerHTML=rows.length?rows.map((d,i)=>`<button class="live-departure" data-live-departure="${i}" ${d.tripId?'':'disabled'}><span class="line-badge ${esc(d.mode)}">${esc(d.line)}</span><span><strong>${esc(d.destination)}</strong><small>${esc(d.stopName)} · ${esc(d.operator)}</small></span><span class="live-departure-time">${fmt(d.realtimeDeparture)}<small>${d.cancelled?'Geannuleerd':d.realtime?'Realtime':'Gepland'}</small></span><span class="live-departure-cta">Volg rit ↗</span></button>`).join(''):'<div class="empty">Geen ritten gevonden voor deze selectie.<br>Zoek een andere halte, lijn of vervoermiddel.</div>';$$('[data-live-departure]').forEach(b=>b.onclick=()=>open(rows[+b.dataset.liveDeparture]));}
 function collectTrip(data){const candidates=(data.legs||data.itinerary?.legs||[]).filter(l=>l.mode!=='WALK');const legs=candidates.filter(l=>l.tripId===live.trip.tripId);if(!legs.length)throw Error('De bron bevat niet de geselecteerde rit');const stops=[],geometry=[];let realTime=false,cancelled=false,schematic=false;for(const leg of legs){realTime ||=!!leg.realTime;cancelled ||=!!leg.cancelled;for(const s of [leg.from,...(leg.intermediateStops||[]),leg.to].filter(Boolean)){const prev=stops.at(-1);if(prev&&prev.stopId===s.stopId&&Math.abs(stopTime(prev)-stopTime(s))<120000)Object.assign(prev,s);else stops.push({...s});}let points=leg.legGeometry?.points?decodePolyline(leg.legGeometry.points,leg.legGeometry.precision??6):[];points=points.filter(p=>point({lat:p[0],lon:p[1]}));if(points.length<2){schematic=true;points=[leg.from,...(leg.intermediateStops||[]),leg.to].map(point).filter(Boolean);}geometry.push(...points);}return {legs,stops,geometry,realTime,cancelled,schematic,startTime:legs[0]?.startTime,endTime:legs.at(-1)?.endTime};}

 function shapePoints(data){
   return (Array.isArray(data?.points) ? data.points : [])
     .map(pt => Array.isArray(pt)
       ? [Number(pt[0]), Number(pt[1])]
       : [Number(pt?.lat ?? pt?.latitude), Number(pt?.lon ?? pt?.longitude)])
     .filter(pt =>
       Number.isFinite(pt[0]) &&
       Number.isFinite(pt[1]) &&
       Math.abs(pt[0]) <= 90 &&
       Math.abs(pt[1]) <= 180
     );
 }


 function shapeFitsStops(points, stops) {
   const orderedStops = (stops || []).map(point).filter(Boolean);
   if (points.length < 2 || orderedStops.length < 2) return false;

   let fromIndex = 0;

   for (const stop of orderedStops) {
     let nearest = Infinity;
     let nearestIndex = -1;

     for (let i = fromIndex; i < points.length; i++) {
       const meters = distance(stop, points[i]);
       if (meters < nearest) {
         nearest = meters;
         nearestIndex = i;
       }
     }

     if (nearestIndex < 0 || nearest > 350) return false;
     fromIndex = nearestIndex;
   }

   return true;
 }


 async function requestGtfsShape() {
   const base = String(window.OVFLOW_CONFIG?.API_BASE || "")
     .replace(/\/$/, "");

   const nativeId = String(
     live.trip?.gtfsTripId || live.trip?.tripId || ""
   ).match(/gt:delijn:.+$/)?.[0] || "";

   if (!base || !nativeId)
     throw Error("Geen oorspronkelijke GTFS-trip-ID beschikbaar");

   const url = new URL(base + "/api/v4/delijn/route-shape");
   url.searchParams.set("tripId", nativeId);

   if (live.trip?.line)
     url.searchParams.set("line", live.trip.line);

   if (live.trip?.destination)
     url.searchParams.set("destination", live.trip.destination);

   const {response, data} = await OVFlowCore.fetchJson(
     url, {timeout: 12000}
   );

   if (!response.ok)
     throw Error(data?.message || "GTFS-route niet beschikbaar");

   return data;
 }


 async function fetchExactGtfsShape(stops) {
   if (/train|rail|trein/i.test(String(live.trip?.mode || "")))
     return null;

   try {
     const data = await requestGtfsShape();
     const points = shapePoints(data);

     if (data?.exactTripMatch !== true)
       throw Error("GTFS-trip niet exact bevestigd");

     if (!shapeFitsStops(points, stops))
       throw Error("GTFS-route volgt de haltes niet in de juiste volgorde");

     return {points, meta: data};

   } catch (error) {
     console.warn("Geen geverifieerde GTFS-route:", error.message);
     return null;
   }
 }

 async function loadTrip(epoch,initial){if(!live.trip||live.loadingTrip)return;live.loadingTrip=true;const tripId=live.trip.tripId;try{const data=await OVFlowCore.transitousTrip(tripId,{detailedLegs:true,timeout:12000});if(epoch!==live.epoch)return;const parsed=collectTrip(data);if(!parsed.stops.length)throw Error('Geen haltevolgorde');const exactShape=await fetchExactGtfsShape(parsed.stops);if(exactShape?.points?.length>=2){parsed.geometry=exactShape.points;parsed.schematic=false;parsed.exactShape=true;parsed.shapeMeta=exactShape.meta;}live.data={...data,...parsed};live.stops=parsed.stops;live.geometry=parsed.geometry;live.updated=Date.now();$('#live-stops-count').textContent=`${live.stops.length} echte haltes`;$('#live-timing-badge').textContent=parsed.cancelled?'Geannuleerd':parsed.realTime?'Realtime tijden':'Geplande tijden';$('#live-route-kind').textContent=parsed.exactShape?'Echte GTFS-route van deze rit':parsed.schematic?'Schematische verbinding tussen haltes':'Routegeometrie van deze rit';$('#live-journey').textContent=`${live.stops[0].name} → ${live.stops.at(-1).name} · ${parsed.startTime?fmt(parsed.startTime):''} – ${parsed.endTime?fmt(parsed.endTime):''}`;$('#live-message').textContent=parsed.cancelled?'Deze rit is geannuleerd. Controleer de informatie van de vervoerder.':parsed.schematic?'De haltes zijn echt; de lijn ertussen is schematisch omdat routegeometrie ontbreekt.':'';buildGeometryOffsets();drawStops();renderProgress();if(initial||!mapFitted){setTimeout(()=>{liveMap?.invalidateSize();fit();mapFitted=true;},80);}}catch{if(epoch!==live.epoch)return;if(!live.stops.length){$('#live-stops-count').textContent='Haltes niet beschikbaar';$('#live-stops').innerHTML='<div class="empty">De exacte rit kon niet worden geladen.<br><button class="outline" id="live-retry-trip">Opnieuw proberen</button></div>';$('#live-retry-trip').onclick=()=>loadTrip(live.epoch,true);}$('#live-message').textContent='Ritinformatie is tijdelijk niet bereikbaar. Eerder opgehaalde gegevens kunnen verouderd zijn.';renderProgress();}finally{if(epoch===live.epoch)live.loadingTrip=false;}}
 function buildGeometryOffsets(){live.stopOffsets=[];let min=0;for(const s of live.stops){const p=point(s);if(!p){live.stopOffsets.push(null);continue;}let best=min,dist=Infinity;for(let i=min;i<live.geometry.length;i++){const d=distance(p,live.geometry[i]);if(d<dist){best=i;dist=d;}}live.stopOffsets.push(best);min=best;}}
 function drawStops(){if(!liveMap)return;routeGroup.clearLayers();stopGroup.clearLayers();stopMarkers=[];if(live.geometry.length>1){L.polyline(live.geometry,{color:'#ffffff',weight:9,opacity:.92,dashArray:live.data.schematic?'6 9':null}).addTo(routeGroup);L.polyline(live.geometry,{color:'#255c47',weight:5.5,opacity:.96,dashArray:live.data.schematic?'6 9':null,lineCap:'round',lineJoin:'round'}).addTo(routeGroup);}live.stops.forEach((s,i)=>{const p=point(s);if(!p)return;const marker=L.circleMarker(p,{radius:i===0||i===live.stops.length-1?8:6,color:'#20543f',weight:2.5,fillColor:'#fff',fillOpacity:1}).addTo(stopGroup);marker.bindTooltip(esc(s.name),{direction:'top',offset:[0,-8]});const code=s.stopId?.split(':').at(-1)||'';marker.bindPopup(`<strong>${esc(s.name)}</strong><br>${Number.isFinite(stopTime(s))?fmt(stopTime(s)):''}${s.track?' · Perron '+esc(s.track):''}<br><small>${esc(code)}</small>`);marker.on('click',()=>{const row=$(`[data-live-stop="${i}"]`);$$('.live-stop.selected').forEach(x=>x.classList.remove('selected'));row?.classList.add('selected');row?.scrollIntoView({behavior:'smooth',block:'nearest'});});stopMarkers[i]=marker;});}
 function gpsPosition(data){const p=data?.position;if(!p||p.stale||data.exact!==true||p.estimated||/estimat|schedule|user/i.test(String(p.source||data.source||'')))return null;const ll=point(p);const stamp=millis(p.timestamp);if(!ll||!Number.isFinite(stamp)||Date.now()-stamp>90000||stamp>Date.now()+30000)return null;const id=p.tripId||data.tripId;if(id&&id!==live.trip.tripId)return null;if(live.geometry.length){let near=Infinity;for(let i=0;i<live.geometry.length;i+=Math.max(1,Math.floor(live.geometry.length/1000)))near=Math.min(near,distance(ll,live.geometry[i]));if(near>3000)return null;}return {...p,lat:ll[0],lon:ll[1],timestamp:new Date(stamp).toISOString()};}
 async function loadGps(epoch){if(!live.trip||live.loadingGps)return;live.loadingGps=true;const trip={...live.trip};try{const url=new URL(window.OVFLOW_CONFIG.API_BASE+'/api/v4/vehicle-position');url.searchParams.set('tripId',trip.tripId);if(trip.line)url.searchParams.set('line',trip.line);const {response,data}=await OVFlowCore.fetchJson(url,{timeout:6500});if(epoch!==live.epoch)return;live.gps=response.ok?gpsPosition(data):null;live.gpsError=live.gps?'':response.ok?'Geen recente GPS-positie voor deze rit.':'Voertuig-GPS is momenteel niet beschikbaar via de backend.';renderProgress();}catch{if(epoch!==live.epoch)return;live.gps=null;live.gpsError='De verbinding met voertuig-GPS is niet beschikbaar.';renderProgress();}finally{if(epoch===live.epoch)live.loadingGps=false;}}
 function estimatePosition(){if(!live.stops.length||!live.data||live.data.cancelled||Date.now()-live.updated>120000||!$('#live-estimate').checked)return null;const now=Date.now(),first=stopTime(live.stops[0]),last=stopTime(live.stops.at(-1));if(!Number.isFinite(first)||!Number.isFinite(last)||now<first||now>last)return null;for(let i=0;i<live.stops.length-1;i++){const a=live.stops[i],b=live.stops[i+1],start=stopTime(a),end=millis(b.arrival||b.departure||b.scheduledArrival||b.scheduledDeparture);if(!Number.isFinite(start)||!Number.isFinite(end)||now<start)continue;if(now>end){const depart=stopTime(b);if(now<=depart&&point(b))return {ll:point(b),next:i+1};continue;}const fraction=Math.max(0,Math.min(1,(now-start)/Math.max(1,end-start)));const startIdx=live.stopOffsets[i],endIdx=live.stopOffsets[i+1];let points=startIdx!=null&&endIdx!=null?live.geometry.slice(startIdx,endIdx+1):[];if(points.length<2)points=[point(a),point(b)].filter(Boolean);if(points.length<2)return null;let lengths=[],total=0;for(let j=1;j<points.length;j++){total+=distance(points[j-1],points[j]);lengths.push(total);}const target=total*fraction;let idx=lengths.findIndex(x=>x>=target);if(idx<0)idx=lengths.length-1;const prev=idx?lengths[idx-1]:0,ratio=(target-prev)/Math.max(1,lengths[idx]-prev);return {ll:[points[idx][0]+(points[idx+1][0]-points[idx][0])*ratio,points[idx][1]+(points[idx+1][1]-points[idx][1])*ratio],next:i+1};}return null;}
 function nextIndex(){const now=Date.now();return live.stops.findIndex(s=>stopTime(s)>=now);}
 function renderFollow(){$('#live-follow').setAttribute('aria-pressed',String(live.following));$('#live-follow').textContent=live.following?'Volgen aan':'Volg voertuig';}
 function renderProgress(){if(!live.trip)return;const now=Date.now();if(live.gps&&(!gpsPosition({position:live.gps,exact:true,tripId:live.trip.tripId})||now-millis(live.gps.timestamp)>90000)){live.gps=null;live.gpsError='De laatste GPS-positie is verouderd.';}const estimate=live.gps?null:estimatePosition();const ll=live.gps?point(live.gps):estimate?.ll;const isGps=!!live.gps;const first=stopTime(live.stops[0]),end=stopTime(live.stops.at(-1));const future=Number.isFinite(first)&&first>now,finished=Number.isFinite(end)&&end<now;
 $('#live-position-title').textContent=isGps?'Live GPS-positie':estimate?'Geschatte positie':live.data?.cancelled?'Rit geannuleerd':future?'Rit vertrekt later':finished?'Rit volgens tijden afgelopen':'Geen voertuigpositie';$('#live-position-icon').innerHTML=icon(isGps?'locate':estimate?'clock':'info');$('.live-position-card').classList.toggle('estimated',!!estimate);$('#live-position-description').textContent=isGps?`GPS-meting van ${fmt(live.gps.timestamp)} · ${Math.max(0,Math.round((now-millis(live.gps.timestamp))/1000))} sec geleden`:estimate?`Gebaseerd op ${live.data.realTime?'bijgewerkte':'geplande'} haltetijden. Geen GPS-meting.`:future?`Gepland vertrek om ${fmt(first)}. ${live.gpsError}`:live.gpsError;
 if(ll&&liveMap){const html=`${icon(modeName(live.trip.mode)==='Trein'?'train':'bus')}<span>${isGps?'GPS':'GESCHAT'}</span>`;const ic=L.divIcon({className:'live-vehicle '+(isGps?'gps':'estimate'),html,iconSize:[48,48],iconAnchor:[24,24]});if(!vehicle)vehicle=L.marker(ll,{icon:ic,zIndexOffset:2000}).addTo(liveMap);else vehicle.setLatLng(ll).setIcon(ic);vehicle.bindTooltip(isGps?'Gemeten voertuigpositie':'Geschatte positie · geen GPS',{direction:'top',offset:[0,-22]});if(live.following&&state.view==='live')liveMap.panTo(ll,{animate:true});}else clearVehicle();
 const next=nextIndex();$('#live-next').innerHTML=live.data?.cancelled?'Rit geannuleerd':future?`VERTREKHALTE<strong>${esc(live.stops[0]?.name)}</strong>`:next>=0?`VOLGENDE VOLGENS ${live.data?.realTime?'BIJGEWERKTE TIJDEN':'DIENSTREGELING'}<strong>${esc(live.stops[next].name)}</strong>`:live.stops.length?'Eindhalte volgens dienstregeling bereikt.':'';
 const scroll=$('#live-stops').scrollTop;if(live.stops.length)$('#live-stops').innerHTML=live.stops.map((s,i)=>{const time=stopTime(s),planned=millis(s.scheduledDeparture||s.scheduledArrival),delay=Number.isFinite(planned)?Math.round((time-planned)/60000):0;return `<button class="live-stop ${time<now?'passed':''} ${i===next?'next':''}" data-live-stop="${i}" ${point(s)?'':'disabled'}><span class="live-stop-time">${Number.isFinite(time)?fmt(time):'—'}${delay>0?`<small>+${delay} min</small>`:''}</span><span class="live-stop-dot"></span><span><strong>${esc(s.name)}</strong><small>${s.cancelled?'Halte vervalt':s.track?'Perron '+esc(s.track):i===0?'Vertrekhalte':i===live.stops.length-1?'Eindhalte':'Halte '+(i+1)}${!point(s)?' · locatie ontbreekt':''}</small></span></button>`;}).join('');$('#live-stops').scrollTop=scroll;$$('[data-live-stop]').forEach(b=>b.onclick=()=>{const i=+b.dataset.liveStop,p=point(live.stops[i]);if(p&&liveMap){live.following=false;renderFollow();liveMap.setView(p,16);stopMarkers[i]?.openPopup();$('#live-map').scrollIntoView({behavior:'smooth',block:'center'});}});stopMarkers.forEach((m,i)=>m?.setStyle({fillColor:i===next?'#d9bb63':stopTime(live.stops[i])<now?'#b2c1ad':'#fff',radius:i===next?8:6}));$('#live-updated').textContent=live.updated?`Rittijden opgehaald om ${fmt(live.updated)} · ${now-live.updated>120000?'gegevens verouderd':'updates elke 60 sec; GPS elke 15 sec'}`:'Ritgegevens ophalen…';}
 $('#live-choose').onclick=selectOther;$('#live-board-refresh').onclick=loadBoard;$('#live-line-query').oninput=renderBoard;$('#live-refresh').onclick=()=>{loadTrip(live.epoch,false);loadGps(live.epoch);};$('#live-fit').onclick=()=>{live.following=false;renderFollow();fit();};$('#live-follow').onclick=()=>{if(!vehicle){toast('Er is momenteel geen voertuigpositie om te volgen.');return;}live.following=!live.following;renderFollow();renderProgress();};$('#live-estimate').onchange=renderProgress;
 $$('[data-live-mode]').forEach(b=>b.onclick=()=>{live.mode=b.dataset.liveMode;$$('[data-live-mode]').forEach(x=>x.classList.toggle('active',x===b));renderBoard();});
 attachSearch($('#live-station-query'),$('#live-station-results'),p=>{live.place=p;loadBoard();});
 $('#live-share').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);toast('Link naar deze rit gekopieerd.');}catch{openDialog('Link naar deze rit',`<p>Kopieer deze link. De ontvanger heeft toegang tot deze privésite nodig.</p><input id="live-copy-url" type="text" readonly value="${esc(location.href)}">`);$('#live-copy-url').select();}};
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelTimers();else if(state.view==='live'){startTimers();if(live.trip){loadTrip(live.epoch,false);loadGps(live.epoch);}else loadBoard();}});
 function restore(){if(!location.hash.startsWith('#live'))return;const p=new URLSearchParams(location.hash.split('?')[1]||'');if(p.get('trip'))open({tripId:p.get('trip'),line:p.get('line'),destination:p.get('destination'),mode:p.get('mode'),operator:p.get('operator')});else{setView('live');$('#live-choose').hidden=true;}}
 window.OVFlowLive={open,openLeg,onView};window.addEventListener('hashchange',restore);restore();
})();
