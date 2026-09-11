OVFlow v3 — LIVE DE LIJN

BESTANDEN
- index.html
- style.css
- app.js
- config.js

WAT IS NIEUW
- Echte De Lijn Core API-koppeling
- Realtime doorkomsten per halte
- Automatisch vernieuwen elke 30 seconden
- Geen demovertrekken als de API faalt
- API-status en foutdiagnose
- Instellingenpaneel voor entiteitnummer + haltenummer
- Bronvermelding "bron: De Lijn"
- Mobiele en laptopvriendelijke layout

STARTEN ZONDER EIGEN SERVER
Open de map best via een simpele lokale webserver, omdat browsers API-verzoeken vanuit file:// kunnen beperken.

Voorbeeld met Python:
  python -m http.server 8080

Ga daarna naar:
  http://localhost:8080

BELANGRIJK OVER DE API-SLEUTEL
Deze testversie praat rechtstreeks vanuit de browser met De Lijn.
Daarom staat de Core API-sleutel in config.js en kan iemand die het bestand kan bekijken de sleutel zien.

Gebruik deze versie NIET als publieke productieversie.
Voor een publieke release hoort de sleutel achter een eigen backend/proxy.

HALTE INSTELLEN
Open OVFlow > Instellingen en vul:
- Naam
- Entiteitnummer
- Haltenummer
- Maximum aantal vertrekken

De realtime-oproep gebruikt:
https://api.delijn.be/DLKernOpenData/api/v1/haltes/{entiteit}/{halte}/real-time?maxAantalDoorkomsten=...

OPMERKING
De GTFS Realtime- en GTFS Static-sleutels staan al apart in config.js voor een latere versie.
v3 gebruikt voor het zichtbare live vertrekbord bewust eerst de Core API.
