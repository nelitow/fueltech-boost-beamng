# Sunburst2 EJ255/EJ257 Engine Tunes for BeamNG.drive

Realistic Subaru EJ255 (WRX) and EJ257 (STI) engine builds for the Hirochi Sunburst2 —
long blocks, turbos, transaxles, exhaust, intercoolers, radiator, and forged internals with
selectable compression ratio, tuned toward real-world dyno numbers.

![License](https://img.shields.io/badge/license-MIT-green)
![BeamNG.drive](https://img.shields.io/badge/BeamNG.drive-0.34+-blue)

---

## Installation

### 1. Download the zip — DO NOT EXTRACT IT

**[⬇ Click here to download `sunburst2_ej_engines.zip`](https://github.com/nelitow/fueltech-boost-beamng/releases/latest/download/sunburst2_ej_engines.zip)**

Leave it as a `.zip` file. BeamNG loads zipped mods directly — extracting is a common cause
of broken installs.

### 2. Drop the zip in your BeamNG mods folder

```
%USERPROFILE%\Documents\BeamNG.drive\mods
```
```
%LocalAppData%\BeamNG.drive\<version>\mods
```

```
mods/
└── sunburst2_ej_engines.zip
```

### 3. Restart BeamNG (or activate the mod from the in-game Mod Manager)

### 4. Spawn the Hirochi Sunburst2 and open Vehicle Config

Esc → **Vehicle Config**. The new parts show up as additional choices in the existing
**Engine** and **Drivetrain** slot trees — nothing stock is removed or replaced.

---

## What's in it

### Long Blocks (`sunburst2_engine_2_5_internals`)
- **EJ255 Long Block (WRX)** — tuned toward ~230 hp @ 5600 rpm / ~235 lb-ft (319 Nm) @ 3600 rpm
- **EJ257 Long Block (STI)** — tuned toward ~305 hp @ 6000 rpm / ~290 lb-ft (393 Nm) @ 4000 rpm,
  flatter and sustained further into the rev range

### Turbochargers (`sunburst2_engine_2_5_intake`)
- **TD04 Turbocharger (WRX)** — small, quick-spooling, paired with the EJ255 target curve
- **TD05 Turbocharger (STI)** — bigger compressor, more lag but sustains flow further up the
  rev range, paired with the EJ257 target curve

### Bottom End (nested under either Long Block)
- **Stock** (default) — no change
- **Forged Closed-Deck, 8.0:1 (Low Compression)** — built for max boost headroom
- **Forged Closed-Deck, 9.5:1 (High Compression)** — sharper throttle response and
  stock-boost efficiency, still forged for reliability

### Cylinder Heads (nested under either Long Block)
- **Single AVCS (Intake)** — WRX-spec, default on the EJ255
- **Dual AVCS (Intake + Exhaust)** — STI-spec, default on the EJ257, mixable onto the EJ255 too

### Intercoolers (nested under either Turbo)
- **Front-Mount (FMIC)** — default, best sustained cooling on long high-load pulls
- **Top-Mount (TMIC)** — quicker spool feel, less thermal margin under sustained load

These are functional tuning parts with no unique 3D model — the base Sunburst2 has no
intercooler slot at all, so there's no stock mesh to reskin (same convention the base game
uses for its own ECU tune parts).

### Exhaust (nested under the TD05)
- **STI Genome Cat-Back Exhaust** — alternative to the stock race pipe, tuned less
  restrictive for more top-end flow

### ECU (`sunburst2_engine_2_5_ecu`)
- **Flex-Fuel Alcohol Tune (E85/Methanol)** — adds real boost via the turbo's wastegate,
  reflecting the anti-knock/charge-cooling headroom of running alcohol fuel

### Transaxles (`sunburst2_transaxle`)
- **WRX 5-Speed Manual** — real WRX 5MT ratios: 3.454 / 1.947 / 1.296 / 0.972 / 0.738
- **STI 6-Speed Manual** — real STI 6MT ratios: 3.636 / 2.375 / 1.761 / 1.346 / 1.062 / 0.795

### Radiator (`sunburst2_radiator`)
- **Mishimoto Performance Radiator** — higher cooling capacity than any stock tier,
  daily-driving-tuned thermostat (not a dropped-thermostat race setup)

---

## Compatibility

- Hirochi Sunburst2 only
- Doesn't edit or replace any base-game files — every part is an additional option layered
  onto the Sunburst2's existing tuning slots
- BeamNG.drive 0.34+

## License

MIT License — free to use, modify, and distribute.

## Credits

- **Author:** [Nelito](https://github.com/nelitow)
- Real-world specs (EJ255/EJ257, TD04/TD05, WRX/STI gear ratios) used as tuning targets, not
  literal transcriptions — verified live against BeamNG's actual turbo/torque model rather
  than assumed from paper math.
