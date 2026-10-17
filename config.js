window.OVFLOW_VERSION = "8.3.0-server-only";
console.info("OVFlow frontend", window.OVFLOW_VERSION);
window.OVFLOW_CONFIG = {
  API_BASE: "https://ovflow-api.wheaterflow.be",
  SERVER_ONLY: true,
  AUTO_REFRESH_MS: 15000,

  // Reisdata, live vertrektijden, zoeken, haltes, routeplanning en GPS
  // lopen via de eigen OVFlow-backend. API-sleutels blijven op de server.
  TRANSITOUS_BASE: "https://api.transitous.org",

  // Alleen de achtergrondtegels komen van OSM. Alle OV-data die op de kaart
  // wordt getoond komt via API_BASE. Vervang MAP_TILE_URL later eenvoudig
  // door je eigen tile-provider als je daarvoor een aparte kaart-API hebt.
  MAP_TILE_URL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  MAP_TILE_ATTRIBUTION: "© OpenStreetMap",
  MAP_MAX_ZOOM: 19
};
