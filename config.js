window.OVFLOW_VERSION = "4.9.2";
console.info("OVFlow frontend", window.OVFLOW_VERSION);
window.OVFLOW_CONFIG = {
  API_BASE: "https://ovflow-api.wheaterflow.be",
  // Publieke OVFlow-backend via Cloudflare Tunnel. De De Lijn keys blijven
  // uitsluitend op de server en komen nooit in de browser terecht.
  AUTO_REFRESH_MS: 15000,

  // OVFlow 4.4 keeps static fallbacks, but exact De Lijn vehicle GPS uses the optional backend.
  TRANSITOUS_BASE: "https://api.transitous.org",

  // Public De Lijn geographic stop catalogue (used by the optional map/legacy stop screen).
  HALTES_WFS_URL: "https://geo.api.vlaanderen.be/Haltes/wfs",
  HALTES_WFS_TYPENAME: "Haltes:Halte",
  HALTES_BATCH_SIZE: 10000
};
