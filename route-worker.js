/* OVFlow v4.1 route engine — client-side De Lijn GTFS Static
   Geen externe ZIP-library nodig. De worker gebruikt DecompressionStream. */
const TD = new TextDecoder("utf-8");
let zipFiles = null, loadedUrl = null, staticData = null, dayIndex = null, dayIndexDate = null;

self.onmessage = async e => {
  const m = e.data || {};
  if (m.type !== "plan") return;
  try { await plan(m); }
  catch (err) {
    console.error("OVFlow route worker:", err);
    postMessage({ type:"error", id:m.id, message:friendlyError(err) });
  }
};

function progress(id, percent, label, detail="") {
  postMessage({ type:"progress", id, percent, label, detail });
}

function friendlyError(err) {
  const text = String(err?.message || err || "Onbekende fout");
  if (/Failed to fetch|Load failed|NetworkError|CORS/i.test(text)) {
    return "De Lijn-dienstregeling kon niet worden gedownload. Controleer internet/CORS en probeer opnieuw.";
  }
  if (/HTTP 401/i.test(text)) return "De GTFS Static API-sleutel werd geweigerd (401).";
  if (/HTTP 403/i.test(text)) return "Geen toegang tot GTFS Static (403). Controleer de Static API-sleutel.";
  if (/HTTP 429/i.test(text)) return "Te veel GTFS-aanvragen. Wacht even en probeer opnieuw.";
  if (/DecompressionStream/i.test(text)) return "Deze browser kan het GTFS ZIP-bestand niet uitpakken. Update Safari/iOS of gebruik Chrome/Edge.";
  return text;
}

async function fetchGtfsCandidate(url, key, id, candidateNo, candidateCount) {
  const label = candidateCount > 1 ? `Bron ${candidateNo}/${candidateCount}` : "De Lijn";
  progress(id, 5, "Dienstregeling downloaden", `${label}: verbinding maken…`);

  const headers = { "Accept":"application/zip, application/octet-stream, */*", "Cache-Control":"no-cache" };
  if (key) headers["Ocp-Apim-Subscription-Key"] = key;

  const res = await fetch(url, { method:"GET", mode:"cors", cache:"no-store", headers });
  if (!res.ok) throw new Error(`GTFS download HTTP ${res.status}`);

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("json") || contentType.includes("text/html")) {
    const preview = (await res.text()).slice(0, 200);
    throw new Error(`GTFS download gaf geen ZIP terug (${contentType}): ${preview}`);
  }

  if (res.body && res.headers.get("content-length")) {
    const total = Number(res.headers.get("content-length"));
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.length;
      if (total > 0) progress(id, 5 + Math.min(19, (received / total) * 19), "Dienstregeling downloaden", `${Math.round(received/1024/1024)} / ${Math.round(total/1024/1024)} MB`);
    }
    const bytes = new Uint8Array(received); let pos=0;
    for (const c of chunks) { bytes.set(c, pos); pos += c.length; }
    return bytes;
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  progress(id, 24, "Dienstregeling gedownload", `${Math.round(bytes.byteLength/1024/1024)} MB ontvangen`);
  return bytes;
}

async function loadGtfs(req, id) {
  const urls = [req.gtfsUrl, ...(req.gtfsFallbackUrls || [])].filter(Boolean);
  if (!urls.length) throw new Error("GTFS_STATIC_URL ontbreekt in config.js");
  if (zipFiles && urls.includes(loadedUrl)) return;

  let bytes = null, lastError = null, successfulUrl = null;
  for (let i=0; i<urls.length; i++) {
    try {
      bytes = await fetchGtfsCandidate(urls[i], req.gtfsKey || "", id, i+1, urls.length);
      successfulUrl = urls[i];
      break;
    } catch (e) {
      lastError = e;
      progress(id, 7, "Andere databron proberen", `${e.message || e}`);
    }
  }
  if (!bytes) throw lastError || new Error("GTFS-feed kon niet worden gedownload");

  progress(id, 26, "Dienstregeling uitpakken", "GTFS ZIP lokaal openen…");
  zipFiles = await unzipSelected(bytes, id, [
    "stops.txt", "routes.txt", "trips.txt", "stop_times.txt",
    "calendar.txt", "calendar_dates.txt", "feed_info.txt"
  ]);
  loadedUrl = successfulUrl;
  staticData = null; dayIndex = null; dayIndexDate = null;

  if (!zipFiles["stops.txt"] || !zipFiles["trips.txt"] || !zipFiles["stop_times.txt"]) {
    throw new Error("De GTFS-feed mist stops.txt, trips.txt of stop_times.txt");
  }
  progress(id, 31, "Dienstregeling geladen", "GTFS-bestanden klaar voor indexering");
}

function findEOCD(view) {
  const min = Math.max(0, view.byteLength - 65557);
  for (let i=view.byteLength-22; i>=min; i--) if (view.getUint32(i, true) === 0x06054b50) return i;
  return -1;
}

async function unzipSelected(bytes, id, wantedNames) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEOCD(view);
  if (eocd < 0) throw new Error("Ongeldig GTFS ZIP-bestand (EOCD ontbreekt)");
  const entries = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const wanted = new Set(wantedNames);
  const found = [];

  for (let n=0; n<entries; n++) {
    if (off + 46 > view.byteLength || view.getUint32(off, true) !== 0x02014b50) break;
    const method = view.getUint16(off + 10, true);
    const compressedSize = view.getUint32(off + 20, true);
    const uncompressedSize = view.getUint32(off + 24, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localOffset = view.getUint32(off + 42, true);
    const name = TD.decode(bytes.subarray(off + 46, off + 46 + nameLen));
    const base = name.split("/").pop();
    if (wanted.has(base)) found.push({ name:base, method, compressedSize, uncompressedSize, localOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }

  if (!found.length) throw new Error("GTFS ZIP bevat geen herkenbare bestanden");
  const out = {};
  for (let i=0; i<found.length; i++) {
    const e = found[i];
    progress(id, 27 + (i / found.length) * 4, "Dienstregeling uitpakken", `${e.name} openen…`);
    const lo = e.localOffset;
    if (view.getUint32(lo, true) !== 0x04034b50) throw new Error(`ZIP-entry ${e.name} is ongeldig`);
    const localNameLen = view.getUint16(lo + 26, true);
    const localExtraLen = view.getUint16(lo + 28, true);
    const dataStart = lo + 30 + localNameLen + localExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + e.compressedSize);
    if (e.method === 0) out[e.name] = compressed.slice();
    else if (e.method === 8) out[e.name] = await inflateRaw(compressed);
    else throw new Error(`ZIP-compressiemethode ${e.method} wordt niet ondersteund (${e.name})`);
  }
  return out;
}

async function inflateRaw(data) {
  if (typeof DecompressionStream !== "function") throw new Error("DecompressionStream ontbreekt");
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function csvRows(text) {
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/); if(!lines.length)return[];
  const h=csvLine(lines[0]), rows=[];
  for(let i=1;i<lines.length;i++){if(!lines[i])continue;const v=csvLine(lines[i]),o={};for(let j=0;j<h.length;j++)o[h[j]]=v[j]??"";rows.push(o)}
  return rows;
}
function csvLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++}else q=!q}else if(c===','&&!q){out.push(cur);cur=""}else cur+=c}out.push(cur);return out}
function txt(name){return TD.decode(zipFiles[name]||new Uint8Array())}
function parseSec(s){const p=String(s||"").split(":");if(p.length<2)return null;return Number(p[0])*3600+Number(p[1])*60+Number(p[2]||0)}
function ymdParts(s){const [y,m,d]=s.split("-").map(Number);return{y,m,d}}
function gtfsDate(s){return s.replaceAll("-","")}
function weekday(s){const {y,m,d}=ymdParts(s);return["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][new Date(Date.UTC(y,m-1,d)).getUTCDay()]}

function buildStatic(id){
  if(staticData)return staticData;
  progress(id,33,"Haltes indexeren","GTFS-haltes en lijnen verwerken…");
  const stops=new Map();
  for(const r of csvRows(txt("stops.txt"))){
    const lat=Number(r.stop_lat),lon=Number(r.stop_lon);
    if(Number.isFinite(lat)&&Number.isFinite(lon))stops.set(r.stop_id,{id:r.stop_id,name:r.stop_name||r.stop_id,lat,lon,parent:r.parent_station||""});
  }
  const routes=new Map();
  for(const r of csvRows(txt("routes.txt"))){routes.set(r.route_id,{id:r.route_id,short:r.route_short_name||r.route_long_name||"?",long:r.route_long_name||"",type:r.route_type||"3",color:r.route_color||"",textColor:r.route_text_color||""})}
  const calendar=zipFiles["calendar.txt"]?csvRows(txt("calendar.txt")):[];
  const exceptions=zipFiles["calendar_dates.txt"]?csvRows(txt("calendar_dates.txt")):[];
  staticData={stops,routes,calendar,exceptions};
  progress(id,40,"Basisdata klaar",`${stops.size.toLocaleString()} haltes beschikbaar`);
  return staticData;
}

function activeServices(date,data){
  const day=weekday(date),d=gtfsDate(date),set=new Set();
  for(const r of data.calendar){if(r.start_date<=d&&r.end_date>=d&&r[day]==="1")set.add(r.service_id)}
  for(const r of data.exceptions){if(r.date!==d)continue;if(r.exception_type==="1")set.add(r.service_id);else if(r.exception_type==="2")set.delete(r.service_id)}
  return set;
}

function buildDay(date,id){
  if(dayIndex&&dayIndexDate===date)return dayIndex;
  const data=buildStatic(id);
  progress(id,43,"Ritten selecteren",`Dienstregeling voor ${date} bepalen…`);
  const active=activeServices(date,data);
  const hasServiceRules=data.calendar.length>0||data.exceptions.length>0;
  const trips=new Map();
  for(const r of csvRows(txt("trips.txt"))){if(!hasServiceRules||active.has(r.service_id))trips.set(r.trip_id,{id:r.trip_id,routeId:r.route_id,serviceId:r.service_id,headsign:r.trip_headsign||"",direction:r.direction_id||"",shapeId:r.shape_id||""})}
  if(hasServiceRules&&!active.size) throw new Error(`Geen De Lijn-dienstregeling gevonden voor ${date}`);
  progress(id,51,"Vertrektijden indexeren",`${trips.size.toLocaleString()} actieve ritten verwerken…`);

  const tripStops=new Map();
  const stText=txt("stop_times.txt"),lines=stText.split(/\r?\n/),headers=csvLine(lines[0]);
  const idx={trip:headers.indexOf("trip_id"),arr:headers.indexOf("arrival_time"),dep:headers.indexOf("departure_time"),stop:headers.indexOf("stop_id"),seq:headers.indexOf("stop_sequence")};
  const chunk=Math.max(1,Math.floor(lines.length/20));
  for(let i=1;i<lines.length;i++){
    if(!lines[i])continue;const v=csvLine(lines[i]),tripId=v[idx.trip];if(!trips.has(tripId))continue;
    const item={stopId:v[idx.stop],arr:parseSec(v[idx.arr]),dep:parseSec(v[idx.dep]),seq:Number(v[idx.seq]||0)};
    if(item.arr==null)item.arr=item.dep;if(item.dep==null)item.dep=item.arr;
    let list=tripStops.get(tripId);if(!list)tripStops.set(tripId,list=[]);list.push(item);
    if(i%chunk===0)progress(id,51+Math.min(29,(i/lines.length)*29),"Vertrektijden indexeren",`${Math.round((i/lines.length)*100)}% van stop_times verwerkt`)
  }
  for(const list of tripStops.values())list.sort((a,b)=>a.seq-b.seq);
  dayIndex={date,trips,tripStops};dayIndexDate=date;
  progress(id,82,"Route-index klaar",`${tripStops.size.toLocaleString()} ritten klaar voor planning`);
  postMessage({type:"ready"});
  return dayIndex;
}

function distanceKm(a,b){const R=6371,rad=v=>v*Math.PI/180,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);const x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
function nearestStops(point,stops,maxKm=.65,max=7){const arr=[];for(const s of stops.values()){const d=distanceKm({lat:Number(point.lat),lon:Number(point.lon)},s);if(d<=maxKm)arr.push({stop:s,d})}arr.sort((a,b)=>a.d-b.d);return arr.slice(0,max)}
function walkMinutes(km){return Math.max(0,Math.ceil(km/4.5*60))}
function normName(name){return String(name||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\b(perron|halte|station)\b/g,"").replace(/[^a-z0-9]+/g," ").trim()}
function transferKeys(stop){const keys=[];if(stop.parent)keys.push(`p:${stop.parent}`);const n=normName(stop.name);if(n)keys.push(`n:${n}`);keys.push(`g:${Math.round(stop.lat*2000)}:${Math.round(stop.lon*1300)}`);return keys}
function shapeLeg(list,fromIdx,toIdx,stops){const c=[],names=[];for(let i=fromIdx;i<=toIdx;i++){const s=stops.get(list[i].stopId);if(s){c.push([s.lon,s.lat]);names.push({id:s.id,name:s.name,lat:s.lat,lon:s.lon})}}return{coordinates:c,stops:names}}

function candidateRoutes(req,index,data,id){
  const fromNear=nearestStops(req.from,data.stops,req.from.userLat?.9:.7,8),toNear=nearestStops(req.to,data.stops,.7,8);
  if(!fromNear.length)throw new Error("Geen GTFS-halte gevonden bij het vertrekpunt");
  if(!toNear.length)throw new Error("Geen GTFS-halte gevonden bij de bestemming");
  const fromIds=new Set(fromNear.map(x=>x.stop.id)),toIds=new Set(toNear.map(x=>x.stop.id));
  const target=parseSec(req.time),searchStart=req.mode==="arrive"?Math.max(0,target-4*3600):target,searchEnd=req.mode==="arrive"?target:target+4*3600;
  progress(id,85,"Routes berekenen","Directe ritten en overstappen zoeken…");

  const direct=[],firstLegs=[],transferToDest=new Map();
  for(const [tripId,list] of index.tripStops){
    let destIdx=-1;for(let i=0;i<list.length;i++)if(toIds.has(list[i].stopId)){destIdx=i;break}
    if(destIdx>=0){
      for(let i=0;i<destIdx;i++){
        const s=data.stops.get(list[i].stopId);if(!s)continue;
        for(const key of transferKeys(s)){let ar=transferToDest.get(key);if(!ar)transferToDest.set(key,ar=[]);ar.push({tripId,idx:i,destIdx,dep:list[i].dep})}
      }
    }
  }

  for(const [tripId,list] of index.tripStops){
    let srcIdx=-1;for(let i=0;i<list.length;i++)if(fromIds.has(list[i].stopId)){srcIdx=i;break}
    if(srcIdx<0)continue;const dep=list[srcIdx].dep;if(dep==null||dep<searchStart||dep>searchEnd)continue;
    let destIdx=-1;for(let j=srcIdx+1;j<list.length;j++)if(toIds.has(list[j].stopId)){destIdx=j;break}
    if(destIdx>=0)direct.push(makeItinerary([{tripId,fromIdx:srcIdx,toIdx:destIdx}],fromNear,toNear,index,data));
    firstLegs.push({tripId,list,srcIdx,dep});
  }

  const transfer=[];
  for(const first of firstLegs.slice(0,450)){
    const maxJ=Math.min(first.list.length-1,first.srcIdx+55);
    for(let j=first.srcIdx+1;j<=maxJ;j++){
      const arrive=first.list[j].arr;if(arrive==null||arrive-first.dep>130*60)break;
      const transferStop=data.stops.get(first.list[j].stopId);if(!transferStop)continue;
      const merged=[];const seenOpt=new Set();
      for(const key of transferKeys(transferStop))for(const o of (transferToDest.get(key)||[])){const k=`${o.tripId}:${o.idx}`;if(!seenOpt.has(k)){seenOpt.add(k);merged.push(o)}}
      for(const o of merged){
        if(o.tripId===first.tripId)continue;const dep2=o.dep;if(dep2==null||dep2<arrive+90||dep2>arrive+40*60)continue;
        const itin=makeItinerary([{tripId:first.tripId,fromIdx:first.srcIdx,toIdx:j},{tripId:o.tripId,fromIdx:o.idx,toIdx:o.destIdx}],fromNear,toNear,index,data);
        if(itin)transfer.push(itin);if(transfer.length>500)break;
      }
      if(transfer.length>500)break;
    }
    if(transfer.length>500)break;
  }

  let all=dedupe([...direct,...transfer]).filter(Boolean);
  if(req.mode==="arrive") all=all.filter(x=>x.arrival<=target).sort((a,b)=>b.departure-a.departure||a.arrival-b.arrival);
  else all.sort((a,b)=>a.arrival-b.arrival||a.transfers-b.transfers);
  if(req.preference==="fewest")all.sort((a,b)=>a.transfers-b.transfers||a.arrival-b.arrival);
  return all.slice(0,req.maxResults||5);
}

function makeItinerary(segments,fromNear,toNear,index,data){
  const legs=[];let itineraryDep=null,itineraryArr=null,walk=0;
  for(let n=0;n<segments.length;n++){
    const seg=segments[n],list=index.tripStops.get(seg.tripId),trip=index.trips.get(seg.tripId);if(!list||!trip)return null;
    const a=list[seg.fromIdx],b=list[seg.toIdx],from=data.stops.get(a.stopId),to=data.stops.get(b.stopId);if(!from||!to)return null;
    const route=data.routes.get(trip.routeId)||{short:"?",long:""};const shp=shapeLeg(list,seg.fromIdx,seg.toIdx,data.stops);
    if(n===0){const near=fromNear.find(x=>x.stop.id===a.stopId)||fromNear[0];const wm=walkMinutes(near?.d||0);walk+=wm;if(wm>1){legs.push({type:"walk",minutes:wm,distanceMeters:Math.round((near?.d||0)*1000),fromName:"Vertrekpunt",toName:from.name,departure:a.dep-wm*60,arrival:a.dep});itineraryDep=a.dep-wm*60}else itineraryDep=a.dep}
    if(n>0){const prev=legs.filter(x=>x.type==="transit").at(-1);const wait=Math.max(0,Math.round((a.dep-prev.arrival)/60));if(wait>0)legs.push({type:"walk",minutes:wait,distanceMeters:0,fromName:`Overstap in ${from.name}`,toName:`Wacht ${wait} min`,departure:prev.arrival,arrival:a.dep,transferWait:true})}
    legs.push({type:"transit",tripId:seg.tripId,routeId:trip.routeId,routeShortName:route.short,routeLongName:route.long,headsign:trip.headsign,fromStopId:a.stopId,toStopId:b.stopId,fromName:from.name,toName:to.name,departure:a.dep,arrival:b.arr,stopCount:seg.toIdx-seg.fromIdx,coordinates:shp.coordinates,stops:shp.stops});itineraryArr=b.arr;
    if(n===segments.length-1){const near=toNear.find(x=>x.stop.id===b.stopId)||toNear[0];const wm=walkMinutes(near?.d||0);walk+=wm;if(wm>1){legs.push({type:"walk",minutes:wm,distanceMeters:Math.round((near?.d||0)*1000),fromName:to.name,toName:"Bestemming",departure:b.arr,arrival:b.arr+wm*60});itineraryArr=b.arr+wm*60}}
  }
  return{departure:itineraryDep,arrival:itineraryArr,transfers:segments.length-1,walkMinutes:walk,legs};
}
function dedupe(list){const seen=new Set(),out=[];for(const x of list){if(!x)continue;const key=x.legs.filter(l=>l.type==="transit").map(l=>`${l.tripId}:${l.fromStopId}:${l.toStopId}`).join("|");if(!seen.has(key)){seen.add(key);out.push(x)}}return out}

async function plan(req){
  await loadGtfs(req,req.id);
  const data=buildStatic(req.id),index=buildDay(req.date,req.id);
  const its=candidateRoutes(req,index,data,req.id);
  progress(req.id,100,"Routes klaar",`${its.length} reisadviezen gevonden`);
  postMessage({type:"result",id:req.id,itineraries:its,indexDate:req.date,gtfsSource:loadedUrl});
}
