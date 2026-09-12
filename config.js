window.OVFLOW_CONFIG = {
  // OVFlow draait volledig client-side. Er is geen eigen Node/backend-server nodig.
  STATIC_MODE: true,

  // De Lijn Open Data-sleutels. In een volledig statische webapp zijn deze zichtbaar
  // voor bezoekers in de browser. Gebruik daarom alleen sleutels die hiervoor bedoeld zijn.
  DELIJN_CORE_KEY: "ab9f662236344a018f1f33bd539f2e80",
  DELIJN_GTFS_RT_KEY: "3a7bdd939d73422aa8fee3df6355d4f2",
  DELIJN_GTFS_STATIC_KEY: "243fa1a272e34f9b94039f61165975e3",

  CORE_BASE_URL: "https://api.delijn.be/DLKernOpenData/api/v1",

  DEFAULT_STOP: {
    name: "Kies een halte",
    entity: "",
    stop: "",
    maxDepartures: 6
  },

  AUTO_REFRESH_MS: 30000,

  // Publieke geografische halteservice van Digitaal Vlaanderen.
  HALTES_WFS_URL: "https://geo.api.vlaanderen.be/Haltes/wfs",
  HALTES_WFS_TYPENAME: "Haltes:Halte",
  HALTES_BATCH_SIZE: 10000,

  // Optionele statische De Lijn-feed voor volledig client-side route-data.
  GTFS_STATIC_URL: "https://api.delijn.be/gtfs/static/v3/gtfs_transit.zip",
  GTFS_STATIC_FALLBACK_URLS: [
    "https://api-management-opendata-production.azure-api.net/api/gtfs/feed/delijn/static",
    "https://opendata-discovery-gtfs-static.api.production.belgianmobility.io/api/gtfs/feed/delijn/static"
  ]
};
