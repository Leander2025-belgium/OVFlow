# OVFlow 3.0 — Core Server Upgrade

Deze build verplaatst de belangrijkste live datastromen naar de OVFlow-server.

## Nieuw
- `/api/v3/journeys` proxy + korte cache voor Transitous routeplanning.
- `/api/v3/trips/live` voor Live Trip refreshes.
- `/api/v3/rail/vehicle` voor NMBS/iRail ritdetails.
- `/api/v3/delijn/core/*` als beperkte server-side De Lijn proxy.
- `/api/v3/health` voor Core-status.
- De Lijn API-sleutels zijn uit `config.js` verwijderd.
- Planner, Live Trip en Quick Live gebruiken nu de eigen OVFlow Core.

## Serverinstelling
Kopieer `.env.example` naar `.env` en zet de De Lijn-sleutels daar. Start daarna met `npm start`.

## Belangrijk
Omdat API-sleutels eerder in clientcode stonden, is het verstandig de oude De Lijn-sleutels bij de provider te roteren en alleen de nieuwe sleutels in `.env` te bewaren.
