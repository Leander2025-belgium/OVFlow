window.OVFLOW_CONFIG = {
  API_BASE: "",
  AUTO_REFRESH_MS: 15000,

  // OVFlow 4.3 works directly from static hosting; no local /api/* is required.
  TRANSITOUS_BASE: "https://api.transitous.org",

  // Public De Lijn geographic stop catalogue (used by the optional map/legacy stop screen).
  HALTES_WFS_URL: "https://geo.api.vlaanderen.be/Haltes/wfs",
  HALTES_WFS_TYPENAME: "Haltes:Halte",
  HALTES_BATCH_SIZE: 10000
};
