# OVFlow 2.0

Een volledige UI/herstructurering van OVFlow met focus op vier echte taken: Vandaag, Plannen, Live rit en Bewaard.

## Wat is nieuw
- Nieuwe mobiele OV-interface met vaste navigatie en veel minder losse schermen.
- Haltes in de buurt via telefoonlocatie + echte De Lijn doorkomsten.
- Echte NMBS routeplanning via iRail; geen fictieve routefallbacks.
- Rechtstreekse De Lijn-routezoeker tussen twee haltes op basis van lijn/haltevolgorde en live vertrek.
- Live ritmodus voor bus/tram: telefoon-GPS wordt gekoppeld aan de haltevolgorde zodat OVFlow ongeveer kan bepalen waar je bent en welke halte volgt.
- Treinritten kunnen vanuit een route naar Live rit worden gestuurd via iRail vehicle data.
- Leaflet/OpenStreetMap kaart zonder betaalde kaart-API.
- Favoriete haltes en recente reizen in localStorage.
- De drie De Lijn API-producten kunnen afzonderlijke keys gebruiken.

## Installeren
```bash
npm install
cp .env.example .env
nano .env
npm start
```

Open daarna `http://SERVER-IP:3000`.

## Belangrijk
Zet API keys alleen in `.env`, nooit in `app.js` of GitHub. De frontend praat met de OVFlow serverproxy.

## Huidige plannergrens
OVFlow 2.0 toont alleen routes die het betrouwbaar kan onderbouwen: NMBS station → station en rechtstreekse De Lijn halte → halte. Een volledige Belgische multimodale planner met bus/tram-overstappen vraagt een echte routing-engine op de GTFS Static feed; dat is bewust niet als nepresultaat gesimuleerd.
