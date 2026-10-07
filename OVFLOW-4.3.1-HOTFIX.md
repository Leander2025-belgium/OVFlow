# OVFlow 4.3.1 hotfix

- Live lijn opent met MOTIS `detailedLegs=false` om zware routegeometrie niet op de iPhone-main-thread te verwerken.
- Harde timeout op triprequests.
- Bij falende `/trip` call wordt de ritvolgorde on-demand via `stoptimes?fetchStops=true` opgehaald.
- De huidige pagina blijft interactief tijdens het laden; alleen de aangeklikte lijn krijgt een spinner.
- Race condition opgelost waarbij het stoppen van een vorige Live Trip een net gestarte rit kon deactiveren.
- PWA-cache verhoogd naar 4.3.1.
