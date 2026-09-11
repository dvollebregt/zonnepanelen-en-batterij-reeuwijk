# Zonnepanelen en Batterij Reeuwijk

Deelbare versie van de Zonneplanner: een interactieve planner die per uur én per fase doorrekent wat zonnepanelen en een thuisbatterij opleveren op gemeten verbruik van een woning in Reeuwijk.

**Online:** https://dvollebregt.github.io/zonnepanelen-en-batterij-reeuwijk/ — te openen zonder in te loggen.

Of open `index.html` in een browser; het is één los bestand zonder server of build-stap.

## Wat hij doet

- Rekent alle 8.760 uur van een jaar door, per fase (L1, L2, L3).
- Zet opwek, verbruik, batterijsturing en day-ahead-prijzen tegen elkaar af en toont restkosten per maand, jaarkosten, terugverdientijd en resultaat over 20 jaar.
- Controleert de fasegrens van de hoofdaansluiting (3 × 35 A of 3 × 25 A) inclusief piekbegrenzing door de batterij.
- Instelbaar: aantal en type panelen, opstelling, batterijmerk, capaciteit, vermogen, sturing, onbalanshandel, slim verschuiven van warmteverbruik, kwartierpiekfactor, aansluiting en tarieven.
- Januari kan worden omgezet naar een kopie van februari, omdat de warmtepomp in januari 2026 grotendeels op de back-up draaide.

## Opbouw

| Bestand | Inhoud |
|---|---|
| `index.html` | Gebouwde app, direct te openen |
| `src/template.html` | Interface, grafieken en financiële berekening |
| `src/engine.js` | Rekenkern: uursimulatie per fase, batterijsturing (dynamische programmering), piekbegrenzing, verschuifbaar verbruik |
| `src/data.json` | Uurdata voor het modeljaar: verbruik per fase, zonne-opwek per kWp, day-ahead-prijzen |
| `build.py` | Voegt `src/` samen tot `index.html` |

Na een wijziging in `src/`:

```bash
python3 build.py
```

## Data

- **Verbruik per fase:** Homey Energy Dongle (P1-poort), 6-uursgemiddelden sep 2025 – aug 2026, per blok over de uren verdeeld met een huishoudprofiel. Wijkt 0,8% af van de meterteller.
- **Zon:** PVGIS SARAH-3, langjarig maandgemiddelde 2005–2023, uurverloop 2023, 14% systeemverlies (oost-west 10° en zuid 35°).
- **Prijzen:** EnergyZero day-ahead-uurprijzen sep 2025 – aug 2026.
- **Tarieven:** Stedin netbeheer 2026, energiebelasting 2026; installatieprijzen afgeleid uit offertes.

## Verschil met de privéversie

Deze versie bevat geen adres, geen link naar de offertevergelijking en geen inzichten over wanneer de woning leeg stond. Het verbruik per uur zit wel in `src/data.json`.
