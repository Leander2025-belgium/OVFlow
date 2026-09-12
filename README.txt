OVFlow v7 — NMBS / iRail + ALLE HALTES PER RIT

NIEUW
- Bij iedere bus, tram, metro of trein staat nu "Alle haltes".
- Je ziet instaphalte, alle tussenhaltes, uitstaphalte en tijden.
- Live Trip uit v6 blijft bestaan.
- Treinritten krijgen een NMBS-badge.
- Voor treinritten probeert OVFlow iRail te gebruiken als realtime NMBS-laag.
- Als een iRail-voertuig wordt herkend, zie je live stations, vertraging, spoor en afgelaste stops.
- Als iRail een specifieke trein niet kan herkennen, blijft de volledige haltevolgorde uit Transitous/MOTIS zichtbaar.

BELANGRIJK
NMBS publiceert zijn officiële publieke data als GTFS/NeTEx; dat is geen klassieke API.
OVFlow gebruikt iRail als API-laag voor realtime treinritten.

START
python -m http.server 8080
Open http://localhost:8080
