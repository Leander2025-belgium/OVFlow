const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fs = require("fs/promises");
const path = require("path");
require("dotenv").config();

const app = express();
const APP_VERSION = "OVFlow-2.0.0";
const DATA_DIR = path.join(__dirname, "data");
const TICKETS_FILE = path.join(DATA_DIR, "tickets.json");
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const MOLLIE_API_KEY = process.env.MOLLIE_API_KEY || "";
const DELIJN_CORE_API_KEY = process.env.DELIJN_CORE_API_KEY || process.env.DELIJN_API_KEY || "";
const DELIJN_GTFS_API_KEY = process.env.DELIJN_GTFS_API_KEY || process.env.DELIJN_API_KEY || "";
const DELIJN_STATIC_API_KEY = process.env.DELIJN_STATIC_API_KEY || process.env.DELIJN_API_KEY || "";

app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true
}));
app.use(express.json({ limit: "100kb" }));
app.use("/api", rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false
}));

app.get("/", (req, res) => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0"
  });
  res.sendFile(`${__dirname}/index.html`);
});

app.use(express.static(__dirname, {
  etag: true,
  index: false,
  maxAge: "10m",
  setHeaders(res, path) {
    if (path.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  }
}));

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_CACHE_TTL_MS = 45_000;
const STATIC_CACHE_TTL_MS = 10 * 60_000;
const REALTIME_CACHE_TTL_MS = 12_000;
const DEBUG_DELIJN = process.env.DEBUG_DELIJN === "1";
const requestCache = new Map();
const pendingRequests = new Map();

const BASES = {
  kernApi: "https://api.delijn.be/DLKernOpenData/api/v1",
  zoekApi: "https://api.delijn.be/DLZoekOpenData/api/v1",
  kernBeta: "https://api.delijn.be/DLKernOpenData/v1/beta",
  zoekBeta: "https://api.delijn.be/DLZoekOpenData/v1/beta",
  gtfs: "https://api-management-opendata-production.azure-api.net/api/gtfs/feed/delijn",
  irail: "https://api.irail.be"
};

const DEFAULT_MAX_RESULTS = 200;
const ABSOLUTE_MAX_RESULTS = 1000;

function delijnUnavailable(res, error, fallbackMessage = "De Lijn tijdelijk niet bereikbaar") {
  const message = error?.publicMessage || fallbackMessage;
  console.error("De Lijn proxy:", error?.message || message);
  return res.status(error?.statusCode || 503).json({
    ok: false,
    demo: false,
    code: "DELIJN_UNAVAILABLE",
    message,
    haltes: [],
    stops: [],
    lijnen: [],
    lines: [],
    departures: [],
    vertrekken: []
  });
}

function cleanLine(line) {
  return String(line || "")
    .trim()
    .toUpperCase()
    .replace(/^LIJN\s*/i, "")
    .replace(/\s+/g, "");
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function endOfTodayIso() {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

function publicError(res, status, message, code = "REQUEST_FAILED") {
  return res.status(status).json({
    ok: false,
    code,
    message
  });
}

function sanitizeText(value, maxLength = 120) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeEmail(value) {
  const email = sanitizeText(value, 180).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function makeTicketNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `GL-${date}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function readTickets() {
  try {
    const text = await fs.readFile(TICKETS_FILE, "utf8");
    const data = JSON.parse(text);
    return Array.isArray(data.tickets) ? data.tickets : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeTickets(tickets) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(TICKETS_FILE, JSON.stringify({ tickets }, null, 2));
}

async function saveTicket(ticket) {
  const tickets = await readTickets();
  const index = tickets.findIndex(item => item.ticketNumber === ticket.ticketNumber);
  if (index >= 0) tickets[index] = ticket;
  else tickets.push(ticket);
  await writeTickets(tickets);
  return ticket;
}

async function findTicketByPayment(paymentId) {
  const tickets = await readTickets();
  return tickets.find(ticket => ticket.paymentId === paymentId) || null;
}

async function findTicketByNumber(ticketNumber) {
  const tickets = await readTickets();
  return tickets.find(ticket => ticket.ticketNumber === ticketNumber) || null;
}

const ticketCatalog = {
  single: {
    type: "single",
    label: "Enkel ticket",
    price: "2.50",
    validityHours: 2
  },
  day: {
    type: "day",
    label: "Dagpas",
    price: "7.50",
    validityHours: 24
  },
  youth: {
    type: "youth",
    label: "Jongerenpas",
    price: "49.00",
    validityHours: 24 * 31
  }
};

function publicTicket(ticket) {
  if (!ticket) return null;
  return {
    ticketNumber: ticket.ticketNumber,
    ticketType: ticket.ticketType,
    ticketLabel: ticket.ticketLabel,
    travelerName: ticket.travelerName,
    email: ticket.email,
    price: ticket.price,
    status: ticket.status,
    paymentStatus: ticket.paymentStatus,
    paymentId: ticket.paymentId,
    checkoutUrl: ticket.checkoutUrl,
    createdAt: ticket.createdAt,
    validFrom: ticket.validFrom,
    validUntil: ticket.validUntil,
    qrPayload: ticket.qrPayload
  };
}

async function mollieRequest(pathname, options = {}) {
  if (!MOLLIE_API_KEY) {
    const error = new Error("Mollie is nog niet geconfigureerd.");
    error.publicMessage = "Betalen is momenteel nog niet beschikbaar.";
    throw error;
  }

  const response = await fetch(`https://api.mollie.com/v2${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${MOLLIE_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(data.detail || data.title || "Mollie request failed");
    error.publicMessage = "De betaalprovider is tijdelijk niet bereikbaar.";
    throw error;
  }

  return data;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `${response.status} ${response.statusText} op ${url}: ${text.slice(0, 300)}`
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } finally {
    clearTimeout(timer);
  }
}

function parseLineSearch(value) {
  const raw = String(value || "").trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  const firstLinePart = parts.find(part => cleanLine(part) && cleanLine(part) !== "LIJN") || raw;
  const line = cleanLine(firstLinePart.replace(/^LIJN$/i, ""));
  const areaQuery = parts
    .filter(part => cleanLine(part) !== line && !/^lijn$/i.test(part))
    .join(" ");

  return {
    line,
    areaQuery
  };
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchTokens(query) {
  return normalizeSearchText(query)
    .split(" ")
    .filter(Boolean);
}

function tokenVariants(token) {
  const variants = new Set([token]);

  if (token.endsWith("s") && token.length > 3) {
    variants.add(token.slice(0, -1));
  } else if (token.length > 3) {
    variants.add(`${token}s`);
  }

  variants.add(token.replace(/stationsstraat/g, "stationstraat"));
  variants.add(token.replace(/stationstraat/g, "stationsstraat"));
  variants.add(token.replace(/stwg/g, "steenweg"));
  variants.add(token.replace(/steenweg/g, "stwg"));

  return [...variants].filter(Boolean);
}

function textHasToken(text, token) {
  return tokenVariants(token).some(variant => text.includes(variant));
}

function ttlForPath(path) {
  if (path.includes("real-time") || path.includes("realtime") || path.includes("doorkomsten")) {
    return REALTIME_CACHE_TTL_MS;
  }

  if (path === "/lijnen" || path.includes("/lijnrichtingen")) {
    return STATIC_CACHE_TTL_MS;
  }

  return DEFAULT_CACHE_TTL_MS;
}

async function cachedJson(key, ttlMs, fetcher) {
  const now = Date.now();
  const cached = requestCache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  if (pendingRequests.has(key)) {
    return pendingRequests.get(key);
  }

  const promise = Promise.resolve()
    .then(fetcher)
    .then(data => {
      requestCache.set(key, {
        data,
        expiresAt: Date.now() + ttlMs
      });
      return data;
    })
    .finally(() => pendingRequests.delete(key));

  pendingRequests.set(key, promise);
  return promise;
}

async function callDeLijn(base, path) {
  if (!DELIJN_CORE_API_KEY) {
    const error = new Error("DELIJN_CORE_API_KEY ontbreekt in .env");
    error.publicMessage = "De Lijn API-key ontbreekt";
    throw error;
  }

  const url = base + path;

  return cachedJson(url, ttlForPath(path), () => {
    return fetchWithTimeout(url, {
      headers: {
        "Ocp-Apim-Subscription-Key": DELIJN_CORE_API_KEY,
        Accept: "application/json"
      }
    });
  });
}

async function callGtfsRt(feedType) {
  const allowed = {
    alerts: "/rt/alert/?format=json",
    tripUpdates: "/rt/trip-update/?format=json"
  };
  const path = allowed[feedType];
  if (!path) {
    const error = new Error("Ongeldig GTFS feedtype");
    error.statusCode = 400;
    throw error;
  }

  const url = BASES.gtfs + path;
  return cachedJson(`gtfs:${feedType}`, 60_000, () => {
    return fetchWithTimeout(url, {
      headers: {
        Accept: "application/json",
        ...(DELIJN_GTFS_API_KEY ? { "Ocp-Apim-Subscription-Key": DELIJN_GTFS_API_KEY } : {})
      }
    }, 10_000);
  });
}

function getTranslationText(value, preferred = ["nl", "nl-BE", "en"]) {
  const translations = Array.isArray(value?.translation) ? value.translation : [];
  const exact = preferred
    .map(lang => translations.find(item => item.language === lang))
    .find(Boolean);
  return exact?.text || translations[0]?.text || "";
}

function normalizeGtfsAlerts(items) {
  return (Array.isArray(items) ? items : []).map(item => {
    const alert = item.alert || {};
    return {
      id: item.id || "",
      provider: "De Lijn",
      title: getTranslationText(alert.headerText) || "Melding",
      description: getTranslationText(alert.descriptionText),
      url: getTranslationText(alert.url),
      severity: alert.effect === 4 || alert.effect === 5 ? "critical" : "warning",
      updatedAt: null,
      cause: alert.cause,
      effect: alert.effect,
      activePeriod: alert.activePeriod || [],
      routes: (alert.informedEntity || []).map(entity => entity.routeId).filter(Boolean)
    };
  });
}

async function callIrailDisturbances() {
  const url = `${BASES.irail}/disturbances/?format=json&lang=nl`;
  return cachedJson("irail:disturbances:nl", 180_000, () => {
    return fetchWithTimeout(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "OVFlow/1.0 (public-transit-app)"
      }
    }, 10_000);
  });
}

function normalizeIrailDisturbances(data) {
  const items = Array.isArray(data?.disturbance)
    ? data.disturbance
    : data?.disturbance
      ? [data.disturbance]
      : [];

  return items.map(item => {
    const link = item.link ||
      item.descriptionLinks?.descriptionLink?.[0]?.link ||
      item.descriptionLinks?.descriptionLink?.link ||
      "";
    const type = String(item.type || "").toLowerCase();
    return {
      id: `nmbs-${item.id || item.timestamp || item.title || Math.random().toString(36).slice(2)}`,
      provider: "NMBS",
      title: sanitizeText(item.title || "NMBS melding", 180),
      description: sanitizeText(item.description || item.richtext || "", 520),
      url: sanitizeText(link, 500),
      severity: type.includes("disturb") || type.includes("incident") ? "critical" : "warning",
      updatedAt: item.timestamp ? new Date(Number(item.timestamp) * 1000).toISOString() : null,
      routes: []
    };
  }).filter(item => item.title);
}

function normalizeAlertForHome(alert) {
  return {
    id: alert.id || `${alert.provider || "ov"}-${alert.title || ""}`,
    provider: alert.provider || "OV",
    title: sanitizeText(alert.title || "Melding", 180),
    description: sanitizeText(alert.description || "Bekijk de vervoerderinformatie voor details.", 520),
    url: sanitizeText(alert.url || "", 500),
    severity: alert.severity || "warning",
    updatedAt: alert.updatedAt || null,
    routes: Array.isArray(alert.routes) ? alert.routes.slice(0, 10) : []
  };
}

function normalizeTripUpdates(items) {
  return (Array.isArray(items) ? items : []).map(item => {
    const tripUpdate = item.tripUpdate || {};
    const trip = tripUpdate.trip || {};
    const vehicle = tripUpdate.vehicle || tripUpdate.voertuig || {};
    const stops = Array.isArray(tripUpdate.stopTimeUpdate) ? tripUpdate.stopTimeUpdate : [];
    return {
      id: item.id || "",
      tripId: trip.tripId || "",
      routeId: trip.routeId || "",
      vehicleLabel: vehicle.label || vehicle.id || "",
      timestamp: tripUpdate.timestamp || null,
      delay: tripUpdate.delay || 0,
      stops: stops.map(stop => ({
        stopSequence: stop.stopSequence,
        stopId: stop.stopId,
        arrivalTime: stop.arrival?.time || null,
        arrivalDelay: stop.arrival?.delay || 0,
        departureTime: stop.departure?.time || null,
        departureDelay: stop.departure?.delay || 0,
        scheduleRelationship: stop.scheduleRelationship || ""
      }))
    };
  });
}

async function tryEndpoints(candidates, label = "endpoint") {
  const errors = [];

  for (const candidate of candidates) {
    const url = candidate.base + candidate.path;

    try {
      if (DEBUG_DELIJN) console.log(`Probeer ${label}: ${url}`);
      const data = await callDeLijn(candidate.base, candidate.path);
      if (DEBUG_DELIJN) console.log(`Gelukt ${label}: ${url}`);

      return {
        ok: true,
        used: url,
        data
      };
    } catch (error) {
      if (DEBUG_DELIJN) console.log(`Mislukt ${label}: ${error.message}`);
      errors.push(error.message);
    }
  }

  return {
    ok: false,
    errors
  };
}

function findArrayDeep(value, predicate, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    if (value.some(predicate)) return value;

    for (const item of value) {
      const found = findArrayDeep(item, predicate, seen);
      if (found) return found;
    }

    return null;
  }

  for (const key of Object.keys(value)) {
    const found = findArrayDeep(value[key], predicate, seen);
    if (found) return found;
  }

  return null;
}

function getFirstValue(obj, paths, fallback = "") {
  for (const path of paths) {
    const parts = path.split(".");
    let value = obj;

    for (const part of parts) {
      value = value?.[part];
    }

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return fallback;
}

function valueToText(value) {
  if (value === undefined || value === null) return "";

  if (typeof value === "object") {
    return (
      value.omschrijving ||
      value.omschrijvingLang ||
      value.naam ||
      value.name ||
      value.nummer ||
      value.lijnnummer ||
      value.lijnNummer ||
      value.lijnnummerPubliek ||
      value.publiekNummer ||
      JSON.stringify(value)
    );
  }

  return String(value);
}

function extractHaltes(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.haltes)) return data.haltes;
  if (Array.isArray(data?.halte)) return data.halte;
  if (Array.isArray(data?.stops)) return data.stops;
  if (Array.isArray(data?.lijnhaltes)) return data.lijnhaltes;
  if (Array.isArray(data?.lijnHaltes)) return data.lijnHaltes;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.raw?.haltes)) return data.raw.haltes;

  const found = findArrayDeep(data, item =>
    item &&
    typeof item === "object" &&
    (
      item.haltenummer ||
      item.halteNummer ||
      item.omschrijving ||
      item.omschrijvingLang ||
      item.naam ||
      item.halte ||
      item.stop ||
      item.plaats
    )
  );

  return found || [];
}

function extractDoorkomsten(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.doorkomsten)) return data.doorkomsten;
  if (Array.isArray(data?.doorkomst)) return data.doorkomst;
  if (Array.isArray(data?.ritDoorkomsten)) {
    return data.ritDoorkomsten.flatMap(rit => {
      const doorkomsten = Array.isArray(rit.doorkomsten) ? rit.doorkomsten : [];
      return doorkomsten.map(doorkomst => ({
        ...doorkomst,
        ritnummer: doorkomst.ritnummer || rit.ritnummer,
        bestemming: doorkomst.bestemming || rit.bestemming || rit.bestemmingKort || rit.plaatsBestemming,
        richting: doorkomst.richting || rit.bestemming || rit.bestemmingKort || rit.plaatsBestemming,
        plaatsBestemming: rit.plaatsBestemming,
        vias: rit.vias
      }));
    });
  }
  if (Array.isArray(data?.passages)) return data.passages;
  if (Array.isArray(data?.vertrekken)) return data.vertrekken;
  if (Array.isArray(data?.departures)) return data.departures;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.raw?.doorkomsten)) return data.raw.doorkomsten;
  if (Array.isArray(data?.raw?.vertrekken)) return data.raw.vertrekken;

  if (Array.isArray(data?.halteDoorkomsten)) {
    return data.halteDoorkomsten.flatMap(item => {
      const doorkomsten = Array.isArray(item.doorkomsten) ? item.doorkomsten : [];
      return doorkomsten.map(doorkomst => ({
        ...doorkomst,
        haltenummer: doorkomst.haltenummer || item.haltenummer,
        entiteitnummer: doorkomst.entiteitnummer || item.entiteitnummer
      }));
    });
  }

  if (Array.isArray(data?.raw?.halteDoorkomsten)) {
    return data.raw.halteDoorkomsten.flatMap(item => item.doorkomsten || []);
  }

  const found = findArrayDeep(data, item =>
    item &&
    typeof item === "object" &&
    (
      item.lijnnummer ||
      item.lijnNummer ||
      item.lijnnummerPubliek ||
      item.lijn ||
      item.doorkomsttijd ||
      item.doorkomstTijd ||
      item.tijdstip ||
      item.bestemming ||
      item.richting ||
      item["real-timeTijdstip"] ||
      item.realTimeTijdstip ||
      item.realtimeTijdstip ||
      item.dienstregelingTijdstip ||
      item.geplandeTijdstip
    )
  );

  return found || [];
}

function extractRichtingen(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.richtingen)) return data.richtingen;
  if (Array.isArray(data?.lijnrichtingen)) return data.lijnrichtingen;
  if (Array.isArray(data?.lijnRichtingen)) return data.lijnRichtingen;
  if (Array.isArray(data?.directions)) return data.directions;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.raw?.richtingen)) return data.raw.richtingen;
  if (Array.isArray(data?.raw?.lijnrichtingen)) return data.raw.lijnrichtingen;

  const found = findArrayDeep(data, item =>
    item &&
    typeof item === "object" &&
    (
      item.richting ||
      item.richtingCode ||
      item.richtingcode ||
      item.richtingnummer ||
      item.richtingNummer ||
      item.omschrijving ||
      item.bestemming ||
      item.destination ||
      item.lijnrichting
    )
  );

  return found || [];
}

function getHalteName(stop) {
  return valueToText(
    getFirstValue(stop, [
      "omschrijvingLang",
      "omschrijving",
      "naam",
      "name",
      "halteNaam",
      "haltenaam",
      "halte.omschrijvingLang",
      "halte.omschrijving",
      "halte.naam",
      "stop.name",
      "plaats.plaatsNaam",
      "plaats.verkortePlaatsNaam"
    ], "Onbekende halte")
  );
}

function getHalteNumber(stop) {
  return String(
    getFirstValue(stop, [
      "haltenummer",
      "halteNummer",
      "halteNr",
      "nummer",
      "id",
      "stopId",
      "stop_id",
      "halte.haltenummer",
      "halte.halteNummer"
    ], "")
  );
}

function getEntity(stop) {
  return String(
    getFirstValue(stop, [
      "entiteitnummer",
      "entiteitNummer",
      "entiteit",
      "entity",
      "entityNumber",
      "halte.entiteitnummer",
      "halte.entiteitNummer"
    ], "")
  );
}

function getLineNumber(item, fallback = "") {
  return valueToText(
    getFirstValue(item, [
      "lijnnummerPubliek",
      "lijnNummerPubliek",
      "lijn.publiekNummer",
      "lijn.lijnnummerPubliek",
      "lijn.lijnNummerPubliek",
      "line.publicNumber",
      "lijnnummer",
      "lijnNummer",
      "lijn.nummer",
      "lijn.lijnnummer",
      "lijn.lijnNummer",
      "line.number",
      "line.lineNumber",
      "lijn"
    ], fallback)
  );
}

function getDirectionName(item, fallback = "Onbekende richting") {
  return valueToText(
    getFirstValue(item, [
      "omschrijving",
      "richting",
      "richtingOmschrijving",
      "lijnrichtingOmschrijving",
      "lijnRichtingOmschrijving",
      "bestemming",
      "bestemming.omschrijving",
      "bestemming.naam",
      "destination",
      "destination.name",
      "naam",
      "name",
      "headsign"
    ], fallback)
  );
}

function getDirectionCode(item, fallback = "") {
  return String(
    getFirstValue(item, [
      "richting",
      "richtingCode",
      "richtingcode",
      "richtingNummer",
      "richtingnummer",
      "richtingId",
      "id",
      "code",
      "nummer"
    ], fallback)
  );
}

function getPassageTime(item) {
  return getFirstValue(item, [
    "real-timeTijdstip",
    "realTimeTijdstip",
    "realtimeTijdstip",
    "verwachteDoorkomsttijd",
    "doorkomsttijd",
    "doorkomstTijd",
    "dienstregelingTijdstip",
    "geplandeTijdstip",
    "scheduledTime",
    "expectedArrivalTime",
    "arrivalTime",
    "departureTime",
    "tijdstip",
    "time",
    "timestamp"
  ], "");
}

function parseTime(value) {
  if (!value) return null;

  if (typeof value === "number") {
    return new Date(value > 9999999999 ? value : value * 1000);
  }

  const text = String(value);

  if (/^\d{1,2}:\d{2}/.test(text)) {
    const [hours, minutes] = text.split(":").map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isFromNowUntilEndOfDay(item) {
  const date = parseTime(getPassageTime(item));
  if (!date) return true;

  const now = new Date();
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  return date >= now && date <= end;
}

function sortByTime(a, b) {
  const dateA = parseTime(getPassageTime(a));
  const dateB = parseTime(getPassageTime(b));

  if (!dateA && !dateB) return 0;
  if (!dateA) return 1;
  if (!dateB) return -1;

  return dateA - dateB;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    result.push(item);
  }

  return result;
}

function getStopSearchHaystack(stop) {
  return normalizeSearchText([
    getHalteName(stop),
    getFirstValue(stop, ["omschrijvingGemeente", "gemeente", "plaats.plaatsNaam"], ""),
    getFirstValue(stop, ["omschrijving", "omschrijvingLang", "plaats.verkortePlaatsNaam"], ""),
    getHalteNumber(stop)
  ].join(" "));
}

function getStopSearchParts(stop) {
  return {
    name: normalizeSearchText(getHalteName(stop)),
    city: normalizeSearchText(getFirstValue(stop, ["omschrijvingGemeente", "gemeente"], "")),
    place: normalizeSearchText(getFirstValue(stop, ["plaats.plaatsNaam", "plaats.verkortePlaatsNaam", "omschrijvingLang"], "")),
    shortName: normalizeSearchText(getFirstValue(stop, ["omschrijving", "plaats.verkortePlaatsNaam"], "")),
    number: normalizeSearchText(getHalteNumber(stop))
  };
}

function scoreStop(stop, query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return 0;

  const parts = getStopSearchParts(stop);
  const { name, city, place, shortName, number } = parts;
  const haystack = getStopSearchHaystack(stop);
  const firstToken = tokens[0];
  const placeFirstMatch = textHasToken(place, firstToken) ||
    textHasToken(city, firstToken) ||
    name.startsWith(firstToken);
  let score = 0;

  tokens.forEach((token, index) => {
    const variants = tokenVariants(token);

    if (variants.some(variant => city === variant)) score += index === 0 ? 60 : 36;
    else if (textHasToken(city, token)) score += index === 0 ? 42 : 24;

    if (variants.some(variant => place === variant || name === variant || shortName === variant)) score += 42;
    else if (variants.some(variant => place.startsWith(variant) || name.startsWith(variant) || shortName.startsWith(variant))) score += 28;
    else if (textHasToken(place, token) || textHasToken(name, token) || textHasToken(shortName, token)) score += 18;

    if (textHasToken(number, token)) score += 20;
    if (textHasToken(haystack, token)) score += 8;
  });

  if (tokens.every(token => textHasToken(haystack, token))) score += 45;
  if (placeFirstMatch) score += 55;
  if (placeFirstMatch && tokens.slice(1).some(token => textHasToken(shortName, token) || textHasToken(name, token))) score += 55;
  if (/station/.test(haystack)) score += 6;
  return score;
}

async function getAllStops() {
  const data = await callDeLijn(BASES.kernApi, "/haltes");
  return extractHaltes(data);
}

function searchStops(stops, query, maxResults = DEFAULT_MAX_RESULTS) {
  const tokens = searchTokens(query);
  if (!tokens.length) return stops.slice(0, maxResults);

  const strictMatches = stops
    .map(stop => ({ stop, score: scoreStop(stop, query) }))
    .filter(entry => entry.score > 0 && tokens.every(token => textHasToken(getStopSearchHaystack(entry.stop), token)));

  const placeFirstMatches = tokens.length > 1
    ? stops
      .map(stop => ({ stop, score: scoreStop(stop, query) }))
      .filter(entry => {
        if (entry.score <= 0) return false;
        const parts = getStopSearchParts(entry.stop);
        const firstToken = tokens[0];
        return textHasToken(parts.place, firstToken) ||
          textHasToken(parts.city, firstToken) ||
          textHasToken(parts.name, firstToken);
      })
    : [];

  const matches = strictMatches.length ? strictMatches : placeFirstMatches;

  return uniqueBy(matches, entry => `${getEntity(entry.stop)}-${getHalteNumber(entry.stop)}`)
    .sort((a, b) => b.score - a.score || getHalteName(a.stop).localeCompare(getHalteName(b.stop), "nl"))
    .slice(0, maxResults)
    .map(entry => entry.stop);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = value => Number(value) * Math.PI / 180;
  const a1 = Number(lat1), o1 = Number(lon1), a2 = Number(lat2), o2 = Number(lon2);
  if (![a1, o1, a2, o2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const R = 6371000;
  const dLat = toRad(a2 - a1);
  const dLon = toRad(o2 - o1);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function mapLimit(items, limit, mapper) {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    const promise = Promise.resolve()
      .then(() => mapper(item))
      .then(result => {
        results.push(result);
        return result;
      })
      .finally(() => executing.delete(promise));

    executing.add(promise);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.allSettled(executing);
  return results;
}

function normalizeStops(stops) {
  return stops.map((stop, index) => ({
    index: index + 1,
    name: getHalteName(stop),
    haltenummer: getHalteNumber(stop),
    entiteit: getEntity(stop),
    richting: getDirectionName(stop, ""),
    latitude: getFirstValue(stop, [
      "geoCoordinaat.latitude",
      "plaats.geoCoordinaat.latitude",
      "lat",
      "latitude"
    ], ""),
    longitude: getFirstValue(stop, [
      "geoCoordinaat.longitude",
      "plaats.geoCoordinaat.longitude",
      "lng",
      "longitude"
    ], ""),
    raw: stop
  }));
}

function normalizeDepartures(items, lineFallback = "") {
  return items
    .filter(isFromNowUntilEndOfDay)
    .sort(sortByTime)
    .map(item => ({
      lijnnummer: getLineNumber(item, lineFallback),
      richting: getDirectionName(item),
      doorkomsttijd: getPassageTime(item),
      halte: valueToText(
        getFirstValue(item, [
          "halte",
          "stop",
          "halte.omschrijving",
          "halte.omschrijvingLang",
          "stop.name",
          "plaats"
        ], "")
      ),
      status: valueToText(
        getFirstValue(item, [
          "status",
          "ritstatus",
          "doorkomstStatus",
          "predictionStatus"
        ], item.realTime || item.realtime || item.isRealtime ? "realtime" : "planning")
      ),
      raw: item
    }));
}

function makeStopRealtimeCandidates(entiteit, haltenummer) {
  return [
    { base: BASES.kernApi, path: `/haltes/${entiteit}/${haltenummer}/real-time` },
    { base: BASES.kernApi, path: `/haltes/${entiteit}/${haltenummer}/realtime` },
    { base: BASES.kernApi, path: `/haltes/${entiteit}/${haltenummer}/doorkomsten` },

    { base: BASES.kernBeta, path: `/haltes/${entiteit}/${haltenummer}/real-time` },
    { base: BASES.kernBeta, path: `/haltes/${entiteit}/${haltenummer}/realtime` },
    { base: BASES.kernBeta, path: `/haltes/${entiteit}/${haltenummer}/doorkomsten` }
  ];
}

function makeLineRealtimeCandidates(entiteit, lijnnummer, richtingCode) {
  return [
    {
      base: BASES.kernApi,
      path: `/lijnen/${entiteit}/${lijnnummer}/lijnrichtingen/${richtingCode}/real-time`
    },
    {
      base: BASES.kernApi,
      path: `/lijnen/${entiteit}/${lijnnummer}/lijnrichtingen/${richtingCode}/dienstregelingen`
    },
    {
      base: BASES.kernApi,
      path: `/lijnen/${entiteit}/${lijnnummer}/lijnrichtingen/${richtingCode}/dienstregelingen?datum=${todayDateString()}`
    }
  ];
}

function getDetailPathFromUrl(url) {
  if (!url) return "";
  if (url.startsWith(BASES.kernApi)) return url.replace(BASES.kernApi, "");
  if (url.startsWith(BASES.kernBeta)) return url.replace(BASES.kernBeta, "");
  return url;
}

function getLinkUrl(value, rel) {
  const links = Array.isArray(value?.links) ? value.links : [];
  return links.find(link => link.rel === rel)?.url || "";
}

async function getAllLines() {
  const data = await callDeLijn(BASES.kernApi, "/lijnen");
  return Array.isArray(data?.lijnen) ? data.lijnen : [];
}

async function getPublicLineNumber(entiteit, internLijnnummer, fallback = "") {
  const lijnen = await getAllLines();
  const match = lijnen.find(line => {
    return String(line.entiteitnummer) === String(entiteit) &&
      String(line.lijnnummer) === String(internLijnnummer);
  });

  return valueToText(match?.lijnnummerPubliek || fallback || internLijnnummer);
}

async function enrichDeparturesWithPublicLines(items, fallback = "") {
  const cache = new Map();

  return Promise.all(items.map(async item => {
    const entiteit = getFirstValue(item, ["entiteitnummer", "entiteitNummer", "entiteitLijn"], "");
    const internLijnnummer = getFirstValue(item, ["lijnnummer", "lijnNummer", "lijn.lijnnummer", "lijn.lijnNummer"], "");
    const key = `${entiteit}-${internLijnnummer}`;

    if (!internLijnnummer) {
      return {
        ...item,
        lijnnummer: fallback
      };
    }

    if (!cache.has(key)) {
      cache.set(key, getPublicLineNumber(entiteit, internLijnnummer, fallback));
    }

    return {
      ...item,
      internLijnnummer: item.internLijnnummer || internLijnnummer,
      lijnnummer: await cache.get(key),
      lijnnummerPubliek: await cache.get(key)
    };
  }));
}

function scoreLineArea(line, areaQuery) {
  const tokens = searchTokens(areaQuery);
  if (!tokens.length) return 1;

  const haystack = normalizeSearchText([
    line.omschrijving,
    line.vervoerRegioCode,
    line.vervoertype,
    line.bedieningtype,
    line.vervoerslaag
  ].join(" "));

  if (!tokens.every(token => haystack.includes(token))) return 0;
  return tokens.reduce((score, token) => score + (haystack.startsWith(token) ? 20 : 10), 40);
}

function findLineMatches(lijnen, requestedLine, areaQuery = "") {
  const publicMatches = lijnen.filter(line => {
    return cleanLine(line.lijnnummerPubliek) === requestedLine;
  });

  const matches = publicMatches.length
    ? publicMatches
    : lijnen.filter(line => cleanLine(line.lijnnummer) === requestedLine);

  if (!areaQuery) return matches;

  const scoredMatches = matches
    .map(line => ({ line, score: scoreLineArea(line, areaQuery) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scoredMatches.length ? scoredMatches.map(entry => entry.line) : matches;
}

async function fetchByAbsoluteDeLijnUrl(url) {
  if (!url) throw new Error("Geen De Lijn URL");
  const path = getDetailPathFromUrl(url);

  if (url.startsWith(BASES.kernApi)) return callDeLijn(BASES.kernApi, path);
  if (url.startsWith(BASES.kernBeta)) return callDeLijn(BASES.kernBeta, path);

  return fetchWithTimeout(url, {
    headers: {
      "Ocp-Apim-Subscription-Key": DELIJN_CORE_API_KEY,
      Accept: "application/json"
    }
  });
}

app.get("/api/delijn/health", (req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION,
    message: "OVFlow proxy draait",
    time: new Date().toISOString()
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION,
    services: {
      delijn: Boolean(DELIJN_CORE_API_KEY),
      delijnGtfs: Boolean(DELIJN_GTFS_API_KEY),
      delijnStatic: Boolean(DELIJN_STATIC_API_KEY),
      mollie: Boolean(MOLLIE_API_KEY),
      irail: true
    },
    time: new Date().toISOString()
  });
});

app.get("/api/tickets/catalog", (req, res) => {
  res.json({
    ok: true,
    tickets: Object.values(ticketCatalog)
  });
});

app.post("/api/payments/create", async (req, res) => {
  try {
    const ticketType = sanitizeText(req.body.ticketType, 30);
    const catalogItem = ticketCatalog[ticketType];
    const travelerName = sanitizeText(req.body.travelerName, 90);
    const email = sanitizeEmail(req.body.email);

    if (!catalogItem) return publicError(res, 400, "Kies een geldig tickettype.", "INVALID_TICKET_TYPE");
    if (!travelerName) return publicError(res, 400, "Vul de naam van de reiziger in.", "INVALID_NAME");
    if (!email) return publicError(res, 400, "Vul een geldig e-mailadres in.", "INVALID_EMAIL");

    const ticketNumber = makeTicketNumber();
    const createdAt = new Date().toISOString();
    const pendingTicket = await saveTicket({
      ticketNumber,
      ticketType: catalogItem.type,
      ticketLabel: catalogItem.label,
      travelerName,
      email,
      price: catalogItem.price,
      status: "betaling gestart",
      paymentStatus: "created",
      paymentId: "",
      checkoutUrl: "",
      createdAt,
      validFrom: null,
      validUntil: null,
      qrPayload: ""
    });

    const payment = await mollieRequest("/payments", {
      method: "POST",
      body: JSON.stringify({
        amount: {
          currency: "EUR",
          value: catalogItem.price
        },
        description: `OVFlow ${catalogItem.label} ${ticketNumber}`,
        redirectUrl: `${PUBLIC_BASE_URL}/?ticket=${encodeURIComponent(ticketNumber)}`,
        webhookUrl: `${PUBLIC_BASE_URL}/api/payments/webhook`,
        metadata: {
          ticketNumber
        }
      })
    });

    pendingTicket.paymentId = payment.id;
    pendingTicket.paymentStatus = payment.status || "open";
    pendingTicket.status = "in afwachting";
    pendingTicket.checkoutUrl = payment._links?.checkout?.href || "";
    await saveTicket(pendingTicket);

    res.json({
      ok: true,
      ticket: publicTicket(pendingTicket)
    });
  } catch (error) {
    console.error("Payment create failed:", error.message);
    return publicError(res, 502, error.publicMessage || "Betaling starten is niet gelukt.", "PAYMENT_FAILED");
  }
});

app.post("/api/payments/webhook", express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const paymentId = sanitizeText(req.body.id, 80);
    if (!paymentId) return res.status(200).send("ignored");

    const ticket = await findTicketByPayment(paymentId);
    if (!ticket) return res.status(200).send("unknown ticket");

    const payment = await mollieRequest(`/payments/${encodeURIComponent(paymentId)}`);
    ticket.paymentStatus = payment.status || ticket.paymentStatus;

    if (payment.status === "paid") {
      const validFrom = new Date();
      const validUntil = new Date(validFrom.getTime() + (ticketCatalog[ticket.ticketType]?.validityHours || 2) * 60 * 60 * 1000);
      ticket.status = "betaald";
      ticket.validFrom = validFrom.toISOString();
      ticket.validUntil = validUntil.toISOString();
      ticket.qrPayload = JSON.stringify({
        provider: "OVFlow",
        ticketNumber: ticket.ticketNumber,
        ticketType: ticket.ticketType,
        validUntil: ticket.validUntil
      });
    } else if (payment.status === "canceled") {
      ticket.status = "geannuleerd";
    } else if (payment.status === "failed" || payment.status === "expired") {
      ticket.status = "mislukt";
    } else {
      ticket.status = "in afwachting";
    }

    await saveTicket(ticket);
    res.status(200).send("ok");
  } catch (error) {
    console.error("Payment webhook failed:", error.message);
    res.status(200).send("received");
  }
});

app.get("/api/tickets/:ticketNumber", async (req, res) => {
  const ticketNumber = sanitizeText(req.params.ticketNumber, 40).toUpperCase();
  const ticket = await findTicketByNumber(ticketNumber);
  if (!ticket) return publicError(res, 404, "Ticket niet gevonden.", "TICKET_NOT_FOUND");
  res.json({
    ok: true,
    ticket: publicTicket(ticket)
  });
});

app.get("/api/alerts/nmbs", async (req, res) => {
  try {
    const data = await callIrailDisturbances();
    const alerts = normalizeIrailDisturbances(data).map(normalizeAlertForHome);
    res.json({
      ok: true,
      source: "irail-disturbances",
      provider: "NMBS",
      count: alerts.length,
      updatedAt: new Date().toISOString(),
      alerts: alerts.slice(0, 80)
    });
  } catch (error) {
    console.error("NMBS meldingen mislukt:", error.message);
    res.status(503).json({
      ok: false,
      source: "irail-disturbances",
      provider: "NMBS",
      message: "NMBS meldingen zijn tijdelijk niet beschikbaar.",
      alerts: []
    });
  }
});

app.get("/api/alerts/all", async (req, res) => {
  const [nmbsResult, delijnResult] = await Promise.allSettled([
    callIrailDisturbances().then(data => normalizeIrailDisturbances(data)),
    callGtfsRt("alerts").then(data => normalizeGtfsAlerts(data))
  ]);

  const sources = {
    nmbs: nmbsResult.status === "fulfilled" ? "ok" : "unavailable",
    delijn: delijnResult.status === "fulfilled" ? "ok" : "unavailable"
  };

  if (nmbsResult.status === "rejected") console.error("NMBS meldingen mislukt:", nmbsResult.reason.message);
  if (delijnResult.status === "rejected") console.error("De Lijn meldingen mislukt:", delijnResult.reason.message);

  const alerts = [
    ...(nmbsResult.status === "fulfilled" ? nmbsResult.value : []),
    ...(delijnResult.status === "fulfilled" ? delijnResult.value : [])
  ]
    .map(normalizeAlertForHome)
    .sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });

  res.json({
    ok: true,
    source: "combined-alerts",
    sources,
    partial: Object.values(sources).some(status => status !== "ok"),
    count: alerts.length,
    updatedAt: new Date().toISOString(),
    alerts: alerts.slice(0, 100),
    message: alerts.length
      ? ""
      : "Er zijn momenteel geen meldingen gevonden of een bron is tijdelijk beperkt."
  });
});

app.get("/api/gtfs/delijn/alerts", async (req, res) => {
  try {
    const data = await callGtfsRt("alerts");
    const alerts = normalizeGtfsAlerts(data).map(normalizeAlertForHome);
    res.json({
      ok: true,
      source: "gtfs-rt-alert",
      provider: "De Lijn",
      count: alerts.length,
      updatedAt: new Date().toISOString(),
      alerts: alerts.slice(0, 50)
    });
  } catch (error) {
    console.error("GTFS alerts mislukt:", error.message);
    res.status(error.statusCode || 503).json({
      ok: false,
      source: "gtfs-rt-alert",
      message: "Storingsmeldingen zijn tijdelijk niet beschikbaar.",
      alerts: []
    });
  }
});

app.get("/api/gtfs/delijn/trip-updates", async (req, res) => {
  try {
    const routeId = sanitizeText(req.query.routeId || "", 80);
    const data = await callGtfsRt("tripUpdates");
    let tripUpdates = normalizeTripUpdates(data);
    if (routeId) tripUpdates = tripUpdates.filter(item => item.routeId === routeId);
    res.json({
      ok: true,
      source: "gtfs-rt-trip-update",
      count: tripUpdates.length,
      updatedAt: new Date().toISOString(),
      tripUpdates: tripUpdates.slice(0, 100)
    });
  } catch (error) {
    console.error("GTFS trip updates mislukt:", error.message);
    res.status(error.statusCode || 503).json({
      ok: false,
      source: "gtfs-rt-trip-update",
      message: "Realtime ritupdates zijn tijdelijk niet beschikbaar.",
      tripUpdates: []
    });
  }
});

app.get("/api/delijn/search", async (req, res) => {
  const q = sanitizeText(req.query.q || "", 120);
  const max = Math.min(Number(req.query.max || 20) || 20, 80);

  try {
    const [allStops, allLines] = await Promise.all([getAllStops(), getAllLines()]);
    const haltes = searchStops(allStops, q, max);
    const lineSearch = parseLineSearch(q);
    const lijnen = lineSearch.line
      ? findLineMatches(allLines, lineSearch.line, lineSearch.areaQuery).slice(0, max)
      : allLines.filter(line => normalizeSearchText([
          line.lijnnummerPubliek,
          line.lijnnummer,
          line.omschrijving,
          line.vervoerRegioCode
        ].join(" ")).includes(normalizeSearchText(q))).slice(0, max);

    res.json({
      ok: true,
      demo: false,
      query: q,
      haltes,
      stops: normalizeStops(haltes),
      lijnen,
      lines: lijnen
    });
  } catch (error) {
    return delijnUnavailable(res, error);
  }
});

app.get("/api/delijn/haltes", async (req, res) => {
  const q = sanitizeText(req.query.q || "", 120);
  const max = Math.min(Number(req.query.max || DEFAULT_MAX_RESULTS) || DEFAULT_MAX_RESULTS, ABSOLUTE_MAX_RESULTS);

  console.log("Haltes zoeken:", q);

  try {
    const allStops = await getAllStops();
    const haltes = searchStops(allStops, q, max);

    return res.json({
      source: `${BASES.kernApi}/haltes`,
      query: q,
      totalAvailable: allStops.length,
      haltes,
      stops: normalizeStops(haltes)
    });
  } catch (error) {
    console.error("Haltes zoeken mislukt:", error.message);
    return delijnUnavailable(res, error);
  }
});

app.get("/api/delijn/nearby", async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const max = Math.min(Math.max(Number(req.query.max || 8) || 8, 1), 30);
  const radius = Math.min(Math.max(Number(req.query.radius || 2500) || 2500, 100), 15000);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return publicError(res, 400, "Geef geldige lat en lon mee.", "INVALID_LOCATION");
  }

  try {
    const allStops = await getAllStops();
    const nearby = normalizeStops(allStops)
      .map(stop => ({
        ...stop,
        distanceMeters: Math.round(haversineMeters(lat, lon, stop.latitude, stop.longitude))
      }))
      .filter(stop => Number.isFinite(stop.distanceMeters) && stop.distanceMeters <= radius)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, max);

    res.json({
      ok: true,
      location: { lat, lon },
      radius,
      count: nearby.length,
      stops: nearby,
      haltes: nearby
    });
  } catch (error) {
    return delijnUnavailable(res, error, "Haltes in de buurt zijn tijdelijk niet beschikbaar");
  }
});

app.get("/api/delijn/lijnen", async (req, res) => {
  const q = sanitizeText(req.query.q || "", 120);
  const max = Math.min(Number(req.query.max || 30) || 30, 100);

  try {
    const lijnen = await getAllLines();
    const lineSearch = parseLineSearch(q);
    const matches = lineSearch.line
      ? findLineMatches(lijnen, lineSearch.line, lineSearch.areaQuery)
      : lijnen.filter(line => normalizeSearchText([
          line.lijnnummerPubliek,
          line.lijnnummer,
          line.omschrijving,
          line.vervoerRegioCode
        ].join(" ")).includes(normalizeSearchText(q)));

    res.json({
      ok: true,
      demo: false,
      query: q,
      count: matches.length,
      lijnen: matches.slice(0, max),
      lines: matches.slice(0, max)
    });
  } catch (error) {
    return delijnUnavailable(res, error);
  }
});

app.get("/api/delijn/departures", async (req, res) => {
  const halteId = sanitizeText(req.query.halteId || "", 80);
  const match = halteId.match(/^(\d{1,3})[-:/](\d{1,8})$/);
  if (!match) {
    return publicError(res, 400, "Ongeldige halte. Gebruik halteId=entiteit-haltenummer.", "INVALID_STOP");
  }

  const [, entiteit, haltenummer] = match;
  const result = await tryEndpoints(
    makeStopRealtimeCandidates(entiteit, haltenummer),
    `doorkomsten halte ${entiteit}/${haltenummer}`
  );

  if (!result.ok) {
    return publicError(res, 404, "Geen realtime gevonden voor deze halte", "NO_REALTIME");
  }

  const doorkomsten = extractDoorkomsten(result.data);
  const enrichedDoorkomsten = await enrichDeparturesWithPublicLines(doorkomsten);

  res.json({
    ok: true,
    demo: false,
    source: result.used,
    halteId,
    departures: enrichedDoorkomsten,
    vertrekken: enrichedDoorkomsten,
    doorkomsten: enrichedDoorkomsten
  });
});

app.get("/api/delijn/route", async (req, res) => {
  const lineId = cleanLine(sanitizeText(req.query.lineId || "", 80));
  if (!lineId) return publicError(res, 400, "Vul een geldige lijn in.", "INVALID_LINE");

  try {
    const lijnen = await getAllLines();
    const matches = findLineMatches(lijnen, lineId, "");
    if (!matches.length) {
      return publicError(res, 404, `Lijn ${lineId} niet gevonden.`, "LINE_NOT_FOUND");
    }

    res.json({
      ok: true,
      demo: false,
      query: lineId,
      lijnen: matches,
      lines: matches,
      route: {
        lineId,
        name: `Lijn ${lineId}`,
        haltes: [],
        stops: []
      }
    });
  } catch (error) {
    return delijnUnavailable(res, error);
  }
});

app.get("/api/delijn/doorkomsten/:entiteit/:haltenummer", async (req, res) => {
  const { entiteit, haltenummer } = req.params;
  if (!/^\d{1,3}$/.test(entiteit) || !/^\d{1,8}$/.test(haltenummer)) {
    return publicError(res, 400, "Ongeldige halte-identificatie.", "INVALID_STOP");
  }

  const result = await tryEndpoints(
    makeStopRealtimeCandidates(entiteit, haltenummer),
    `doorkomsten halte ${entiteit}/${haltenummer}`
  );

  if (!result.ok) {
    return res.status(500).json({
      error: "Geen doorkomsten gevonden",
      message: "Realtime doorkomsten zijn tijdelijk niet beschikbaar voor deze halte."
    });
  }

  const doorkomsten = extractDoorkomsten(result.data);
  const enrichedDoorkomsten = await enrichDeparturesWithPublicLines(doorkomsten);

  res.json({
    source: result.used,
    raw: result.data,
    doorkomsten: enrichedDoorkomsten,
    vertrekken: enrichedDoorkomsten
  });
});

app.get("/api/delijn/lijnen/:lijn", async (req, res) => {
  const lineSearch = parseLineSearch(sanitizeText(req.params.lijn, 80));
  const requestedLine = lineSearch.line;
  const cacheKey = `lijn-response:${requestedLine}:${normalizeSearchText(lineSearch.areaQuery)}`;
  const cached = requestCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return res.json({
      ...cached.data,
      cached: true
    });
  }

  console.log("Lijn zoeken via publieke lijnnummer:", requestedLine);

  const debug = {
    stap: [],
    errors: []
  };

  try {
    const lijnen = await getAllLines();
    debug.stap.push(`Aantal lijnen opgehaald: ${lijnen.length}`);

    const matches = findLineMatches(lijnen, requestedLine, lineSearch.areaQuery);
    debug.stap.push(`Matches voor lijn ${requestedLine}: ${matches.length}`);
    if (lineSearch.areaQuery) debug.stap.push(`Regiofilter: ${lineSearch.areaQuery}`);

    if (!matches.length) {
      return res.status(404).json({
        error: `Lijn ${requestedLine} niet gevonden in /lijnen`,
        rawInfo: {
          aantalLijnen: lijnen.length,
          aantalMatches: 0,
          aantalRichtingen: 0,
          aantalHaltes: 0,
          aantalVertrekken: 0
        },
        debug
      });
    }

    let allStops = [];
    let allDepartures = [];
    let allDirections = [];
    const sources = [];
    const lineDetails = [];

    for (const lineInfo of matches) {
      const entiteit = lineInfo.entiteitnummer;
      const internLijnnummer = lineInfo.lijnnummer;
      const publiekLijnnummer = lineInfo.lijnnummerPubliek;
      const omschrijving = lineInfo.omschrijving;

      debug.stap.push(
        `Match: publiek ${publiekLijnnummer}, intern ${internLijnnummer}, entiteit ${entiteit}, ${omschrijving}`
      );

      lineDetails.push(lineInfo);

      const detailLink =
        lineInfo.links?.find(link => link.rel === "detail")?.url ||
        `${BASES.kernApi}/lijnen/${entiteit}/${internLijnnummer}`;

      sources.push(detailLink);

      let detailData = null;

      try {
        detailData = await fetchByAbsoluteDeLijnUrl(detailLink);
      } catch (error) {
        debug.errors.push(`Detail mislukt ${detailLink}: ${error.message}`);
      }

      let richtingen = detailData ? extractRichtingen(detailData) : [];

      const richtingenResult = await tryEndpoints([
        {
          base: BASES.kernApi,
          path: `/lijnen/${entiteit}/${internLijnnummer}/lijnrichtingen`
        }
      ], `richtingen lijn ${publiekLijnnummer}`);

      if (richtingenResult.ok) {
        sources.push(richtingenResult.used);
        richtingen = extractRichtingen(richtingenResult.data);
      } else {
        debug.errors.push(...richtingenResult.errors);
      }

      if (!richtingen.length) {
        richtingen = [
          {
            entiteitnummer: entiteit,
            lijnnummer: internLijnnummer,
            richting: "HEEN",
            omschrijving: `${omschrijving} HEEN`,
            links: [
              {
                rel: "detail",
                url: `${BASES.kernApi}/lijnen/${entiteit}/${internLijnnummer}/lijnrichtingen/HEEN`
              }
            ]
          },
          {
            entiteitnummer: entiteit,
            lijnnummer: internLijnnummer,
            richting: "TERUG",
            omschrijving: `${omschrijving} TERUG`,
            links: [
              {
                rel: "detail",
                url: `${BASES.kernApi}/lijnen/${entiteit}/${internLijnnummer}/lijnrichtingen/TERUG`
              }
            ]
          }
        ];
      }

      allDirections.push(...richtingen);

      for (const richting of richtingen.slice(0, 4)) {
        const richtingCode = getDirectionCode(richting);
        const richtingName = getDirectionName(richting, richtingCode || "Richting");

        debug.stap.push(`Richting verwerken: ${richtingName} / ${richtingCode}`);

        const richtingDetailLink =
          richting.links?.find(link => link.rel === "detail")?.url ||
          `${BASES.kernApi}/lijnen/${entiteit}/${internLijnnummer}/lijnrichtingen/${richtingCode}`;

        let richtingDetailData = null;
        let stopsForDirection = [];

        try {
          richtingDetailData = await fetchByAbsoluteDeLijnUrl(richtingDetailLink);
          sources.push(richtingDetailLink);
          debug.stap.push(`Richting detail bron: ${richtingDetailLink}`);

          let haltesData = richtingDetailData;
          const haltesLink = getLinkUrl(richtingDetailData, "haltes");

          if (haltesLink) {
            try {
              haltesData = await fetchByAbsoluteDeLijnUrl(haltesLink);
              sources.push(haltesLink);
              debug.stap.push(`Haltes bron: ${haltesLink}`);
            } catch (error) {
              debug.errors.push(`Haltes ophalen mislukt ${haltesLink}: ${error.message}`);
            }
          }

          stopsForDirection = extractHaltes(haltesData).map(stop => ({
            ...stop,
            richting: richtingName,
            richtingCode,
            lijnnummerPubliek: publiekLijnnummer,
            internLijnnummer,
            entiteitLijn: entiteit
          }));

          allStops.push(...stopsForDirection);
        } catch (error) {
          debug.errors.push(`Richting detail mislukt ${richtingDetailLink}: ${error.message}`);
        }

        const departuresResult = await tryEndpoints(
          makeLineRealtimeCandidates(entiteit, internLijnnummer, richtingCode),
          `vertrekken lijn ${publiekLijnnummer}`
        );

        if (departuresResult.ok) {
          sources.push(departuresResult.used);

          const departures = extractDoorkomsten(departuresResult.data).map(item => ({
            ...item,
            lijnnummer: publiekLijnnummer,
            richting: getDirectionName(item, richtingName),
            entiteitLijn: entiteit,
            internLijnnummer
          }));

          allDepartures.push(...departures);
        } else {
          debug.errors.push(...departuresResult.errors);
        }

        if (stopsForDirection.length) {
          const stopPassageResults = await mapLimit(stopsForDirection.slice(0, 6), 3, async stop => {
            const stopEntiteit = getEntity(stop) || entiteit;
            const haltenummer = getHalteNumber(stop);

            if (!stopEntiteit || !haltenummer) return null;

            const stopPassagesResult = await tryEndpoints(
              makeStopRealtimeCandidates(stopEntiteit, haltenummer),
              `doorkomsten halte ${stopEntiteit}/${haltenummer}`
            );

            if (!stopPassagesResult.ok) {
              debug.errors.push(...stopPassagesResult.errors);
              return null;
            }

            sources.push(stopPassagesResult.used);

            return extractDoorkomsten(stopPassagesResult.data)
              .filter(item => {
                const itemLine = cleanLine(getLineNumber(item, publiekLijnnummer));
                return (
                  itemLine === cleanLine(publiekLijnnummer) ||
                  itemLine === cleanLine(internLijnnummer)
                );
              })
              .map(item => ({
                ...item,
                lijnnummer: publiekLijnnummer,
                richting: getDirectionName(item, richtingName),
                halte: getHalteName(stop),
                entiteitLijn: entiteit,
                internLijnnummer
              }));
          });

          allDepartures.push(...stopPassageResults.flat().filter(Boolean));
        }
      }
    }

    allStops = uniqueBy(allStops, stop => {
      return `${getEntity(stop)}-${getHalteNumber(stop)}-${getHalteName(stop)}-${getDirectionName(stop, "")}`;
    });

    allDepartures = normalizeDepartures(allDepartures, requestedLine);

    const responseBody = {
      lijn: requestedLine,
      name: lineSearch.areaQuery ? `Lijn ${requestedLine} (${lineSearch.areaQuery})` : `Lijn ${requestedLine}`,
      query: {
        line: requestedLine,
        area: lineSearch.areaQuery
      },
      vanaf: nowIso(),
      tot: endOfTodayIso(),
      source: sources,
      detail: lineDetails,
      richtingen: allDirections,
      haltes: normalizeStops(allStops),
      stops: normalizeStops(allStops),
      vertrekken: allDepartures,
      departures: allDepartures,
      doorkomsten: allDepartures,
      rawInfo: {
        aantalMatches: matches.length,
        aantalRichtingen: allDirections.length,
        aantalHaltes: allStops.length,
        aantalVertrekken: allDepartures.length
      },
      debug
    };

    requestCache.set(cacheKey, {
      data: responseBody,
      expiresAt: Date.now() + REALTIME_CACHE_TTL_MS
    });

    res.json(responseBody);
  } catch (error) {
    console.error("Lijninformatie mislukt:", error.message);

    res.status(500).json({
      error: "Fout bij ophalen lijninformatie",
      message: error.publicMessage || "Live lijninformatie is tijdelijk niet beschikbaar."
    });
  }
});

app.get("/api/delijn/debug-lijn/:lijn", async (req, res) => {
  if (!DEBUG_DELIJN) {
    return publicError(res, 404, "Niet gevonden.", "NOT_FOUND");
  }

  const lijn = cleanLine(req.params.lijn);

  const candidates = [
    { name: "core lijnen", base: BASES.kernApi, path: `/lijnen` },
    { name: "core lijn direct fout", base: BASES.kernApi, path: `/lijnen/${encodeURIComponent(lijn)}` },
    { name: "core haltes station", base: BASES.kernApi, path: `/haltes?omschrijving=station` },
    { name: "core haltes oostende", base: BASES.kernApi, path: `/haltes?omschrijving=oostende` }
  ];

  const results = [];

  for (const candidate of candidates) {
    const url = candidate.base + candidate.path;

    try {
      const data = await callDeLijn(candidate.base, candidate.path);

      results.push({
        name: candidate.name,
        url,
        ok: true,
        type: Array.isArray(data) ? "array" : typeof data,
        keys: data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data) : [],
        sample: JSON.stringify(data).slice(0, 1200)
      });
    } catch (error) {
      results.push({
        name: candidate.name,
        url,
        ok: false,
        error: error.message.slice(0, 600)
      });
    }
  }

  res.json({
    lijn,
    results
  });
});

function startServer(port = PORT) {
  const server = app.listen(port, () => {
    console.log(`OVFlow De Lijn proxy draait op http://localhost:${port}`);
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer
};
