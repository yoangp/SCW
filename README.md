# SCW birch-to-glucose process simulator

Physics and chemistry model of the POC v2 flowsheet (birch + water -> supercritical-water hydrolysis -> flash quench ->
water-only finishing hold -> filtration -> two nanofiltration steps -> syrup). One control sets the free glucose + fructose
output from 0.1 to 10 kg/day; the model solves the wood feed, sizes the hardware and reports by-products, energy and water.

## Use

    node tools/build.js          # builds index.html (open in a browser) and dist/artifact.html
    node tools/run.js 1          # CLI summary for 1 kg/day; add --json, or --set reactor.tau=0.3
    node test/validate.js        # literature anchors + sweep over the 0.1-10 kg/day range
    python3 tools/gen_water_table.py   # regenerate the IAPWS-95 table (pip install iapws)

No runtime dependencies. `src/model.js` runs unchanged in Node and in the browser.

## What is modelled

| Unit | Physics |
|---|---|
| F-01/E-01 | IAPWS-95 enthalpy; heater coil length from local Dittus-Boelter heat transfer against a block temperature |
| M-01 | Enthalpy balance for hot water + cold slurry; particle heat-up (Ranz-Marshall film + internal conduction) |
| R-01 | Lagrangian plug flow, real density, wall heat loss, friction; 20 lumped reactions, 25 species |
| Q-01/V-01 | Isenthalpic flash, choked-orifice size, steam-volatile partition (K-values), separator diameter |
| R-02 | Hold in the flashed liquor; pH from the wood's own acids (charge balance); acid-catalysed oligomer hydrolysis vs sugar loss |
| S-01/S-02 | Cake wash loss; loose NF then tight NF with constant-rejection concentration and diafiltration; flux from osmotic pressure |
| Utilities | Steam preheat recovery (pinch-limited), pumps, milling, daily heat-up, evaporation on surplus steam |

The page also draws the machine in 3D (`src/view3d.js`, three.js r128 from a CDN): every part is generated to scale from
the sizing results, coloured by temperature, pressure or by-product concentration, and each part lists its dimensions,
flow, T, P and stream composition. Without WebGL the part data panel still works.

Tube sizes come from a standard imperial catalogue; walls are checked with ASME B31.3 thin-wall and indicative stresses.
"Freeze hardware" in the UI (or the second argument of `SCW.solve`) rates one fixed machine at other flows.

## Kinetic basis

Rate constants are Arrhenius about 400 C / 25 MPa (`DEFAULTS.kinetics` in `src/model.js`).
Activation energies for cellulose (154.4 / 430.3 kJ/mol), oligomer hydrolysis (135.2) and glucose isomerisation (111.5)
are from Cantero et al., J. Supercrit. Fluids 75 (2013) 48. Pre-exponentials are calibrated to:

- microcrystalline cellulose, 400 C / 25 MPa / 0.02 s: >95 wt% soluble sugars (Cantero et al., ChemSusChem 2015)
- same, 1 s: glycolaldehyde the main product
- wheat bran 0.19 s: 73% C5+C6 sugars (Green Chem. 2015); beet pulp 0.11 s: 61 / 71% (FASTSUGARS pilot)
- glucose loss in hot water consistent with ~6e-4 1/s at 200 C

Pressure enters through density (residence time) and the Marshall-Franck ion product for ionic steps.

## Limits

No birch data are in the calibration. The finishing hold, membrane rejections and steam volatilities are assumed
constants and are the weakest parts; they are exposed as parameters so Stage A / Stage B measurements can replace them.
Plug flow only: no axial dispersion, fouling, char, gas or corrosion products. Not a pressure design and not a food-safety assessment.
