window.OVFLOW_CONFIG = {
  API_BASE: "",
  // Zet hier de publieke URL van je OVFlow-backend zodra die online staat, bv.
  // API_BASE: "https://api.jouwdomein.be"
  // Laat leeg als je alleen de publieke Transitous-fallback gebruikt. Exacte
  // De Lijn voertuig-GPS vereist de backend zodat je API-key geheim blijft.
  AUTO_REFRESH_MS: 15000,

  // OVFlow 4.4 keeps static fallbacks, but exact De Lijn vehicle GPS uses the optional backend.
  TRANSITOUS_BASE: "https://api.transitous.org",

  // Public De Lijn geographic stop catalogue (used by the optional map/legacy stop screen).
  HALTES_WFS_URL: "https://geo.api.vlaanderen.be/Haltes/wfs",
  HALTES_WFS_TYPENAME: "Haltes:Halte",
  HALTES_BATCH_SIZE: 10000
};
