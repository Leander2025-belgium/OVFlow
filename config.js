window.OVFLOW_CONFIG = {
  DELIJN_CORE_KEY: "ab9f662236344a018f1f33bd539f2e80",
  DELIJN_GTFS_RT_KEY: "3a7bdd939d73422aa8fee3df6355d4f2",
  DELIJN_GTFS_STATIC_KEY: "243fa1a272e34f9b94039f61165975e3",

  CORE_BASE_URL: "https://api.delijn.be/DLKernOpenData/api/v1",

  // Voorbeeldhalte uit een publiek werkend API-voorbeeld.
  // Wijzig deze in de app via Instellingen naar jouw gewenste De Lijn-halte.
  DEFAULT_STOP: {
    name: "De Lijn live halte",
    entity: "2",
    stop: "202485",
    maxDepartures: 6
  },

  AUTO_REFRESH_MS: 30000,

  // Publieke geografische halteservice van Digitaal Vlaanderen.
  HALTES_WFS_URL: "https://geo.api.vlaanderen.be/Haltes/wfs",
  HALTES_WFS_TYPENAME: "Haltes:Halte",
  HALTES_BATCH_SIZE: 10000,

  // Officiële Belgische mobiliteitsfeed met de statische De Lijn-dienstregeling.
  GTFS_STATIC_URL: "https://opendata-discovery-gtfs-static.api.production.belgianmobility.io/api/gtfs/feed/delijn/static"
};
