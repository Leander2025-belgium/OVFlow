# OVFlow 4.9.1 — Resilient Live

- De Lijn haltevolgorde timeout verhoogd van 7s naar 22s + automatische retry.
- GTFS-shape timeout verhoogd naar 25s + retry.
- GPS heeft een eigen timeout en kan de rest van de pagina niet meer laten mislukken.
- AbortError wordt niet meer als harde fout aan de gebruiker getoond.
- Haltes worden na tijdelijke fout automatisch opnieuw geladen op de achtergrond.
- Telefoonlocatie blijft actief als tijdelijke voortgangsreferentie.
- Foutmelding is compact zodat de live-layout op één scherm bruikbaar blijft.
