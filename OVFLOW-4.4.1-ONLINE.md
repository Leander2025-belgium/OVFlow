# OVFlow 4.4.1 Online

- `API_BASE` staat op `https://ovflow-api.wheaterflow.be`.
- Exacte De Lijn voertuig-GPS loopt via de OVFlow backend; API-keys blijven server-side.
- `gt:delijn:` trip-id normalisatie is gecorrigeerd.
- `/api/delijn/lijnen?lijn=312` ondersteunt de `lijn` queryparameter.
- GTFS Static kan terugvallen op `DELIJN_GTFS_API_KEY`.
- PWA cache is verhoogd naar `ovflow-static-4.4.1` om oude frontendbestanden te vervangen.
