OVFlow 2.0 v10 — PREMIUM UNIVERSAL LIVE TRIP

Deze versie voert het universele Live Trip ontwerp uit voor bus, tram en trein.

Belangrijk:
- Bestaande stabiele segment-gebaseerde GPS-voortgang uit v9 blijft behouden.
- Geen terugkeer naar projectie op de volledige route.
- Browser-only / GitHub Pages blijft behouden.
- De Lijn, Transitous/MOTIS, iRail en MapLibre blijven behouden.

Nieuw design:
- Ultra-premium donkere Liquid Glass Live Trip
- Dynamische Bus / Tram / Trein termen
- Volgende halte of Volgend station
- Realtime badge: op tijd / vertraging / vroeger / neutraal als vergelijking ontbreekt
- Relevante statuscards worden alleen getoond als echte data beschikbaar is
- Trein toont spoor indien aanwezig
- Voertuig/treinnummer alleen als de databron dit levert
- Bezetting alleen als de databron dit levert
- Rit overzicht toont de volledige halte-/stationtimeline
- Timeline wordt NIET bij iedere GPS-update opnieuw opgebouwd; alleen statusclasses worden bijgewerkt
- Realtime info kaart verzint nooit een oorzaak voor vertraging
- Werkende Bewaar rit knop via localStorage
- Werkende realtime refreshknop
- Bottom navigation: Home / Vertrekken / Live / Data / Instellingen
- Live-tab wordt actief tijdens een Live Trip

Stabiliteit:
- GPS watch wordt bij stoppen opgeruimd
- timers worden opgeruimd
- haltevolgorde schuift maximaal sequentieel vooruit
- progressie kan niet door een route-lus plots naar een groot percentage springen
- snelheid blijft gladgestreken
- geen undefined/null/NaN placeholders voor optionele data

GitHub Pages:
Upload alle bestanden uit deze ZIP over je huidige OVFlow-bestanden.
Daarna eventueel ?v=10 achter je GitHub Pages URL zetten om Safari-cache te omzeilen.


OVFLOW 2.0 v10.1 HOTFIX
- Fix: “Can’t find variable: live” when starting a Live Trip from nearby results.
- The active Live Trip state now gets a stable local `live` reference before the UI is initialized.
- Search errors and Live Trip start errors are now shown separately.
- GitHub Pages/Safari cache busting added: style.css/app.js/planner.js/quick-live.js/config.js load with ?v=10.1.
- Existing stable segment-based progress logic is unchanged.
