/* OVFlow v4 route engine: De Lijn GTFS Static, client-side */
importScripts("https://unpkg.com/fflate@0.8.2/umd/index.js");
const TD=new TextDecoder("utf-8");
let zipFiles=null, loadedUrl=null, staticData=null, dayIndex=null, dayIndexDate=null;

self.onmessage=async e=>{const m=e.data||{};if(m.type!=="plan")return;try{await plan(m)}catch(err){console.error(err);postMessage({type:"error",id:m.id,message:err?.message||String(err)})}};
function progress(id,percent,label,detail=""){postMessage({type:"progress",id,percent,label,detail})}

async function loadGtfs(url,id){
  if(zipFiles&&loadedUrl===url)return;
  if(!url)throw new Error("GTFS_STATIC_URL ontbreekt in config.js");
  progress(id,5,"Dienstregeling downloaden","Officiële De Lijn GTFS-feed ophalen…");
  const res=await fetch(url,{cache:"force-cache"}); if(!res.ok)throw new Error(`GTFS download HTTP ${res.status}`);
  let bytes;
  if(res.body&&res.headers.get("content-length")){
    const total=Number(res.headers.get("content-length"));const reader=res.body.getReader();let received=0,chunks=[];
    while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.length;progress(id,5+Math.min(20,(received/total)*20),"Dienstregeling downloaden",`${Math.round(received/1024/1024)} MB ontvangen`)}
    bytes=new Uint8Array(received);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length}
  }else bytes=new Uint8Array(await res.arrayBuffer());
  progress(id,27,"Dienstregeling uitpakken","GTFS-bestanden openen…");
  zipFiles=fflate.unzipSync(bytes);loadedUrl=url;staticData=null;dayIndex=null;dayIndexDate=null;
  if(!zipFiles["stops.txt"]||!zipFiles["trips.txt"]||!zipFiles["stop_times.txt"])throw new Error("De GTFS-feed mist stops/trips/stop_times");
  progress(id,30,"Dienstregeling geladen","Basisdata voorbereiden…");
}

function csvRows(text){const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/);if(!lines.length)return[];const h=csvLine(lines[0]);const rows=[];for(let i=1;i<lines.length;i++){if(!lines[i])continue;const v=csvLine(lines[i]);const o={};for(let j=0;j<h.length;j++)o[h[j]]=v[j]??"";rows.push(o)}return rows}
function csvLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++}else q=!q}else if(c===','&&!q){out.push(cur);cur=""}else cur+=c}out.push(cur);return out}
function txt(name){return TD.decode(zipFiles[name]||new Uint8Array())}
function parseSec(s){const p=String(s||"").split(":");if(p.length<2)return null;return Number(p[0])*3600+Number(p[1])*60+Number(p[2]||0)}
function ymdParts(s){const [y,m,d]=s.split("-").map(Number);return{y,m,d}}
function gtfsDate(s){return s.replaceAll("-","")}
function weekday(s){const {y,m,d}=ymdParts(s);return ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][new Date(Date.UTC(y,m-1,d)).getUTCDay()]}

function buildStatic(id){if(staticData)return staticData;progress(id,33,"Haltes indexeren","GTFS-haltes en lijnen verwerken…");
  const stops=new Map();for(const r of csvRows(txt("stops.txt"))){const lat=Number(r.stop_lat),lon=Number(r.stop_lon);if(Number.isFinite(lat)&&Number.isFinite(lon))stops.set(r.stop_id,{id:r.stop_id,name:r.stop_name||r.stop_id,lat,lon,parent:r.parent_station||""})}
  const routes=new Map();for(const r of csvRows(txt("routes.txt"))){routes.set(r.route_id,{id:r.route_id,short:r.route_short_name||r.route_long_name||"?",long:r.route_long_name||"",type:r.route_type||"3",color:r.route_color||"",textColor:r.route_text_color||""})}
  const calendar=zipFiles["calendar.txt"]?csvRows(txt("calendar.txt")):[];const exceptions=zipFiles["calendar_dates.txt"]?csvRows(txt("calendar_dates.txt")):[];
  staticData={stops,routes,calendar,exceptions};progress(id,40,"Basisdata klaar",`${stops.size.toLocaleString()} haltes beschikbaar`);return staticData}

function activeServices(date,data){const day=weekday(date),d=gtfsDate(date),set=new Set();for(const r of data.calendar){if(r.start_date<=d&&r.end_date>=d&&r[day]==="1")set.add(r.service_id)}for(const r of data.exceptions){if(r.date!==d)continue;if(r.exception_type==="1")set.add(r.service_id);else if(r.exception_type==="2")set.delete(r.service_id)}return set}

function buildDay(date,id){if(dayIndex&&dayIndexDate===date)return dayIndex;const data=buildStatic(id);progress(id,43,"Ritten selecteren",`Dienstregeling voor ${date} bepalen…`);const active=activeServices(date,data);
  const trips=new Map();for(const r of csvRows(txt("trips.txt"))){if(!active.size||active.has(r.service_id))trips.set(r.trip_id,{id:r.trip_id,routeId:r.route_id,serviceId:r.service_id,headsign:r.trip_headsign||"",direction:r.direction_id||"",shapeId:r.shape_id||""})}
  progress(id,51,"Vertrektijden indexeren",`${trips.size.toLocaleString()} actieve ritten verwerken…`);
  const tripStops=new Map();const stText=txt("stop_times.txt"),lines=stText.split(/\r?\n/),headers=csvLine(lines[0]);const idx={trip:headers.indexOf("trip_id"),arr:headers.indexOf("arrival_time"),dep:headers.indexOf("departure_time"),stop:headers.indexOf("stop_id"),seq:headers.indexOf("stop_sequence")};
  const chunk=Math.max(1,Math.floor(lines.length/20));for(let i=1;i<lines.length;i++){if(!lines[i])continue;const v=csvLine(lines[i]),tripId=v[idx.trip];if(!trips.has(tripId))continue;const item={stopId:v[idx.stop],arr:parseSec(v[idx.arr]),dep:parseSec(v[idx.dep]),seq:Number(v[idx.seq]||0)};if(item.arr==null)item.arr=item.dep;if(item.dep==null)item.dep=item.arr;let list=tripStops.get(tripId);if(!list)tripStops.set(tripId,list=[]);list.push(item);if(i%chunk===0)progress(id,51+Math.min(30,(i/lines.length)*30),"Vertrektijden indexeren",`${Math.round((i/lines.length)*100)}% van stop_times verwerkt`)}
  for(const list of tripStops.values())list.sort((a,b)=>a.seq-b.seq);
  dayIndex={date,trips,tripStops};dayIndexDate=date;progress(id,82,"Route-index klaar",`${tripStops.size.toLocaleString()} ritten klaar voor planning`);postMessage({type:"ready"});return dayIndex
}

function distanceKm(a,b){const R=6371,rad=v=>v*Math.PI/180,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);const x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
function nearestStops(point,stops,maxKm=.65,max=6){const arr=[];for(const s of stops.values()){const d=distanceKm({lat:Number(point.lat),lon:Number(point.lon)},s);if(d<=maxKm)arr.push({stop:s,d})}arr.sort((a,b)=>a.d-b.d);return arr.slice(0,max)}
function walkMinutes(km){return Math.max(0,Math.ceil(km/4.5*60))}

function shapeLeg(list,fromIdx,toIdx,stops){const c=[];const names=[];for(let i=fromIdx;i<=toIdx;i++){const s=stops.get(list[i].stopId);if(s){c.push([s.lon,s.lat]);names.push({id:s.id,name:s.name,lat:s.lat,lon:s.lon})}}return{coordinates:c,stops:names}}

function candidateRoutes(req,index,data,id){const fromNear=nearestStops(req.from,data.stops,req.from.userLat?.9:.65,7),toNear=nearestStops(req.to,data.stops,.65,7);if(!fromNear.length)throw new Error("Geen GTFS-halte gevonden bij het vertrekpunt");if(!toNear.length)throw new Error("Geen GTFS-halte gevonden bij de bestemming");
  const fromIds=new Set(fromNear.map(x=>x.stop.id)),toIds=new Set(toNear.map(x=>x.stop.id));const target=parseSec(req.time);const searchStart=req.mode==="arrive"?Math.max(0,target-4*3600):target;const searchEnd=req.mode==="arrive"?target:target+4*3600;
  progress(id,85,"Routes berekenen","Directe ritten en overstappen zoeken…");
  const direct=[], firstLegs=[], destByTrip=new Map(), transferToDest=new Map();
  for(const [tripId,list] of index.tripStops){let destIdx=-1;for(let i=0;i<list.length;i++)if(toIds.has(list[i].stopId)){destIdx=i;break}if(destIdx>=0){destByTrip.set(tripId,destIdx);for(let i=0;i<destIdx;i++){const sid=list[i].stopId;let ar=transferToDest.get(sid);if(!ar)transferToDest.set(sid,ar=[]);ar.push({tripId,idx:i,destIdx,dep:list[i].dep})}}
  }
  for(const [tripId,list] of index.tripStops){let srcIdx=-1;for(let i=0;i<list.length;i++)if(fromIds.has(list[i].stopId)){srcIdx=i;break}if(srcIdx<0)continue;const dep=list[srcIdx].dep;if(dep==null||dep<searchStart||dep>searchEnd)continue;let destIdx=-1;for(let j=srcIdx+1;j<list.length;j++)if(toIds.has(list[j].stopId)){destIdx=j;break}if(destIdx>=0)direct.push(makeItinerary([{tripId,fromIdx:srcIdx,toIdx:destIdx}],fromNear,toNear,index,data));firstLegs.push({tripId,list,srcIdx,dep})}
  const transfer=[];for(const first of firstLegs.slice(0,300)){const maxJ=Math.min(first.list.length-1,first.srcIdx+45);for(let j=first.srcIdx+1;j<=maxJ;j++){const arrive=first.list[j].arr;if(arrive==null||arrive-first.dep>110*60)break;const opts=transferToDest.get(first.list[j].stopId);if(!opts)continue;for(const o of opts){if(o.tripId===first.tripId)continue;const dep2=o.dep;if(dep2==null||dep2<arrive+90||dep2>arrive+35*60)continue;const itin=makeItinerary([{tripId:first.tripId,fromIdx:first.srcIdx,toIdx:j},{tripId:o.tripId,fromIdx:o.idx,toIdx:o.destIdx}],fromNear,toNear,index,data);if(itin)transfer.push(itin);if(transfer.length>350)break}if(transfer.length>350)break}if(transfer.length>350)break}
  let all=dedupe([...direct,...transfer]);if(req.mode==="arrive")all=all.filter(x=>x.arrival<=target).sort((a,b)=>b.departure-a.departure||a.arrival-b.arrival);else all.sort((a,b)=>a.arrival-b.arrival||a.transfers-b.transfers);
  if(req.preference==="fewest")all.sort((a,b)=>a.transfers-b.transfers||a.arrival-b.arrival);
  return all.slice(0,req.maxResults||5)
}

function makeItinerary(segments,fromNear,toNear,index,data){const legs=[];let itineraryDep=null,itineraryArr=null;let walk=0;for(let n=0;n<segments.length;n++){const seg=segments[n],list=index.tripStops.get(seg.tripId),trip=index.trips.get(seg.tripId);if(!list||!trip)return null;const a=list[seg.fromIdx],b=list[seg.toIdx],from=data.stops.get(a.stopId),to=data.stops.get(b.stopId);if(!from||!to)return null;const route=data.routes.get(trip.routeId)||{short:"?",long:""};const shp=shapeLeg(list,seg.fromIdx,seg.toIdx,data.stops);if(n===0){const near=fromNear.find(x=>x.stop.id===a.stopId)||fromNear[0];const wm=walkMinutes(near?.d||0);walk+=wm;if(wm>1){legs.push({type:"walk",minutes:wm,distanceMeters:Math.round((near?.d||0)*1000),fromName:"Vertrekpunt",toName:from.name,departure:a.dep-wm*60,arrival:a.dep});itineraryDep=a.dep-wm*60}else itineraryDep=a.dep}if(n>0){const prev=legs.filter(x=>x.type==="transit").at(-1);const wait=Math.max(0,Math.round((a.dep-prev.arrival)/60));if(wait>0)legs.push({type:"walk",minutes:wait,distanceMeters:0,fromName:`Overstap in ${from.name}`,toName:`Wacht ${wait} min`,departure:prev.arrival,arrival:a.dep,transferWait:true})}
    legs.push({type:"transit",tripId:seg.tripId,routeId:trip.routeId,routeShortName:route.short,routeLongName:route.long,headsign:trip.headsign,fromStopId:a.stopId,toStopId:b.stopId,fromName:from.name,toName:to.name,departure:a.dep,arrival:b.arr,stopCount:seg.toIdx-seg.fromIdx,coordinates:shp.coordinates,stops:shp.stops});itineraryArr=b.arr;
    if(n===segments.length-1){const near=toNear.find(x=>x.stop.id===b.stopId)||toNear[0];const wm=walkMinutes(near?.d||0);walk+=wm;if(wm>1){legs.push({type:"walk",minutes:wm,distanceMeters:Math.round((near?.d||0)*1000),fromName:to.name,toName:"Bestemming",departure:b.arr,arrival:b.arr+wm*60});itineraryArr=b.arr+wm*60}}
  }
  return{departure:itineraryDep,arrival:itineraryArr,transfers:segments.length-1,walkMinutes:walk,legs}
}
function dedupe(list){const seen=new Set(),out=[];for(const x of list){const key=x.legs.filter(l=>l.type==="transit").map(l=>`${l.tripId}:${l.fromStopId}:${l.toStopId}`).join("|");if(!seen.has(key)){seen.add(key);out.push(x)}}return out}

async function plan(req){await loadGtfs(req.gtfsUrl,req.id);const data=buildStatic(req.id);const index=buildDay(req.date,req.id);const its=candidateRoutes(req,index,data,req.id);progress(req.id,100,"Routes klaar",`${its.length} reisadviezen gevonden`);postMessage({type:"result",id:req.id,itineraries:its,indexDate:req.date})}
