window.OVFLOW_CONFIG = {
  // OVFlow 3: alle geheime API-sleutels staan uitsluitend op de server.
  CORE_BASE_URL: "/api/v3/delijn/core",
  DEFAULT_STOP: { name: "De Lijn live halte", entity: "2", stop: "202485", maxDepartures: 6 },
  AUTO_REFRESH_MS: 15000,
  HALTES_WFS_URL: "https://geo.api.vlaanderen.be/Haltes/wfs",
  HALTES_WFS_TYPENAME: "Haltes:Halte",
  HALTES_BATCH_SIZE: 10000
};
