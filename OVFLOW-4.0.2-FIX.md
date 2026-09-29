# OVFlow 4.0.2

- De Lijn-bestemming gebruikt nu `bestemming`/`plaatsBestemming` in plaats van de technische HEEN/TERUG-code.
- De Lijn-tijden zonder timezone worden correct als Europe/Brussels geïnterpreteerd.
- Dienstregeling en realtime-tijd worden apart verwerkt; vertraging wordt uit het verschil berekend.
- `predictionStatussen: [REALTIME]` wordt correct als live herkend.
- Perrons van dezelfde De Lijn-halte worden in Nearby gegroepeerd.
- Een De Lijn-stationscluster en NMBS-station kunnen tot één intermodaal knooppunt worden samengevoegd.
- Perroninfo van bus/tram blijft zichtbaar in vertrekregels.
