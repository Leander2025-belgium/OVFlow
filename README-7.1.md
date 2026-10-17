# OVFlow 7.1 — Vervoerskeuze in Routeplanner

Nieuw in de routeplanner:

- Kies **Alle**, **Trein**, **Tram**, **Bus** en/of **Metro**.
- Meerdere specifieke vervoersmiddelen kunnen tegelijk actief zijn.
- **Alle** reset de filter en laat alle OV-modi toe.
- De gekozen filter wordt rechtstreeks doorgestuurd naar Transitous `transitModes`.
- Resultaten worden extra client-side gecontroleerd zodat een route geen niet-geselecteerde OV-modus bevat.
- De keuze wordt lokaal onthouden op het toestel.
- Bij geen resultaat krijg je een duidelijke melding om meer vervoersmiddelen toe te laten.

De bestaande routeplanner, Live, kaart en backendintegraties blijven behouden.
