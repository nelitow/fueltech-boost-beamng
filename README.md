# FuelTech Boost Controller for BeamNG.drive

A full-screen dashboard mod inspired by FuelTech standalone ECUs. Features real-time boost control with an interactive boost map, power/torque curves, telemetry gauges, and drivetrain selectors.

![BeamNG.drive](https://img.shields.io/badge/BeamNG.drive-0.34+-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

### Boost Control
- **6-point boost-by-RPM map** with drag-and-drop editing (mouse + touch)
- **Closed-loop PI controller** — reads actual boost and adjusts wastegate offset to hit the target, works regardless of base turbo setup
- **Presets** — MIN, MAX, AUTO MAX (calculates safe boost from torque limits), CUSTOM
- **Boost-by-gear** — per-gear multipliers to reduce boost in lower gears
- **Save/Load profiles** — persist custom maps to disk

### Dashboard Gauges
- **RPM** — large circular gauge with redline zone
- **Boost PSI** — side by side with turbo RPM
- **Oil temp / Coolant temp** — always visible, warns on overheat
- **Throttle position**
- **Turbo RPM**
- **EGT** (exhaust gas temperature, shown only when available)

### Telemetry
- **G-Force meter** — lateral + longitudinal with color-coded dot
- **Drag timer** — 0-100 and 0-200 km/h with auto-start from standstill
- **Power/torque curves** — projected vs stock, with torque limit overlay
- **Peak boost and peak RPM trackers** (click to reset)

### Vehicle Features
- **Drivetrain selectors** — AWD, diff lock, range box (auto-detected per vehicle, hidden when not available)
- **Shift light** — border flash + gear highlight at 90% redline
- **Warning alerts** — oil temp >130C, coolant >110C, sustained overboost, EGT >850C
- **Turbo timer** — cooldown overlay after engine off

### Smart Detection
- Turbo gauges, boost map, power curves, and presets **auto-hide** on NA/supercharged vehicles
- EGT gauge only appears when the vehicle provides exhaust temperature data
- Dashboard works as a universal telemetry HUD on any vehicle

## Installation

1. Download or clone this repo
2. Copy the `fueltech_boost_controller` folder to:
   ```
   %LocalAppData%\BeamNG\BeamNG.drive\<version>\mods\unpacked\
   ```
3. Launch BeamNG.drive
4. Open the app selector (UI Apps) and add **FuelTech Dashboard**

## Usage

- **Drag boost map points** to adjust the RPM/boost curve
- **Click presets** (MIN / MAX / AUTO MAX / CUSTOM) for quick maps
- **Click peak values** in the header to reset them
- **Click HIDE/SHOW GRAPHS** to toggle the bottom panel
- **Click drivetrain buttons** (AWD, F.DIFF, R.DIFF, RANGE) to cycle modes
- **Drag timer** auto-starts when you accelerate from standstill — click RESET to clear

## How the Boost Controller Works

The mod uses a **closed-loop PI controller**:

1. Reads the target boost PSI from the 6-point RPM/boost map (with linear interpolation)
2. Reads the actual boost from the turbocharger
3. Calculates the error (target - actual)
4. Adjusts the wastegate offset proportionally + cumulatively to converge on the target
5. Anti-windup clamp prevents integral overshoot

This approach works with any turbo setup regardless of the base wastegate pressure — the controller self-calibrates by continuously measuring the error.

## File Structure

```
fueltech_boost_controller/
  lua/vehicle/controller/
    fueltechBoostController.lua   -- Boost control + profiles + boost-by-gear
    fueltechDrivetrain.lua        -- Drivetrain feature detection + toggle
  ui/modules/apps/FuelTechBoost/
    app.html                      -- Dashboard layout
    app.css                       -- Dark theme with orange accents
    app.js                        -- Gauges, graphs, telemetry, feature detection
    app.json                      -- App metadata
  vehicles/common/fueltech_boost/
    fueltech_boost.jbeam           -- Vehicle integration + tuning variables
```

## Compatibility

- BeamNG.drive 0.34+
- Works on any vehicle — turbo features auto-hide when not applicable
- Touch support for Steam Deck / touchscreen users

## License

MIT License — free to use, modify, and distribute.

## Credits

- **Author:** Nelito
- Dashboard design inspired by [FuelTech](https://www.fueltech.com/) standalone ECUs
