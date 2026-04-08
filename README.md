# FuelTech Boost Controller for BeamNG.drive

A full-screen dashboard mod inspired by FuelTech standalone ECUs. Features real-time boost control with an interactive boost map, power/torque curves, telemetry gauges, and drivetrain selectors.

Works with **turbocharged** and **supercharged** vehicles. On naturally aspirated cars, it works as a universal telemetry HUD (boost features auto-hide).

![BeamNG.drive](https://img.shields.io/badge/BeamNG.drive-0.34+-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Installation (Step by Step)

### 1. Download the mod

Go to the [Releases page](https://github.com/nelitow/fueltech-boost-beamng/releases) and download **`fueltech_boost_controller.zip`** from the latest release.

### 2. Find your BeamNG mods folder

Open File Explorer and paste this into the address bar:

```
%LocalAppData%\BeamNG\BeamNG.drive
```

You'll see a folder with a version number (like `0.34` or `0.35`). Open it, then open the **`mods`** folder inside. If there's no `unpacked` folder, create one.

Your path should look like:
```
C:\Users\YourName\AppData\Local\BeamNG\BeamNG.drive\0.34\mods\unpacked\
```

### 3. Extract the zip

Extract `fueltech_boost_controller.zip` into the `unpacked` folder. You should end up with:
```
mods/unpacked/fueltech_boost_controller/
    lua/
    ui/
    vehicles/
    ...
```

Make sure the folder is called `fueltech_boost_controller` (not nested inside another folder).

### 4. Launch BeamNG and add the dashboard

1. Start BeamNG.drive and load any vehicle
2. Press **Escape** to open the menu
3. Click **UI Apps** (bottom left)
4. Search for **"FuelTech Dashboard"**
5. Click it to add it to your screen
6. Drag the edges to resize it — it will auto-fill to whatever size you set

### 5. Done!

The dashboard will automatically detect your vehicle's features:
- **Turbo car** — boost map, PSI gauge, turbo RPM, power curves, presets all appear
- **Supercharged car** — boost PSI gauge appears (no turbo RPM), boost control via bypass valve
- **NA car** — only RPM, speed, G-force, temps, and telemetry show (no boost features)

---

## Features

### Boost Control
- **6-point boost-by-RPM map** — drag points to adjust (mouse + touchscreen)
- **Closed-loop PI controller** — targets actual boost, not just wastegate offset
- **Presets** — OFF (0 boost), STOCK (factory boost), MAX, AUTO MAX (safe torque limit), CUSTOM
- **OVERBOOST** — bypasses the turbo's hardware max limit (red button)
- **Boost-by-gear** — reduce boost in lower gears for traction
- **Save/Load profiles** — persist custom maps per vehicle
- **Safety cut** — drops boost to 0 if coolant >115C or oil >135C

### Dashboard
- **RPM gauge** — large circular with redline zone
- **Boost PSI gauge** — auto-scales to turbo's max, side-by-side with turbo RPM (turbo) or full width (supercharger)
- **Oil temp / Coolant temp** — with overheat warnings
- **Throttle / Turbo RPM / EGT** — shown only when available
- **G-Force meter** — lateral + longitudinal dot display
- **Drag timer** — 0-100 and 0-200 km/h, auto-starts from standstill
- **Power/torque curves** — projected vs stock with live Nm/HP readout
- **Brake temperatures** — per-wheel with blue-green-yellow-red color coding
- **Damage log** — shows engine/brake/tire/drivetrain damage in real time

### Telemetry Strip
Engine load, fuel level, exhaust flow, clutch position, altitude, odometer, check engine light, low fuel warning

### Vehicle Features
- **Drivetrain selectors** — diff lock, AWD, range box (auto-detected)
- **Drive modes** — ESC, TCS, ABS toggles (when available)
- **Shift light** — flashes at 90% redline
- **Turbo timer** — cooldown after engine off

### Smart Detection
- Checks `isExisting` on turbo/supercharger objects (BeamNG creates stubs for both)
- Turbo: controlled via `setWastegateOffset`
- Supercharger: controlled via `setBypassPressure`
- NA cars: boost features hidden, telemetry HUD only
- Auto-fills viewport on window resize

---

## Usage Tips

| Action | How |
|--------|-----|
| Adjust boost curve | Drag the orange dots on the boost map |
| Quick presets | Click OFF / STOCK / MAX / AUTO MAX / CUSTOM |
| Push beyond stock | Click OVERBOOST (red when active) |
| Reset peak values | Click "BOOST PK" or "RPM PK" in the header |
| Toggle graphs | Click "HIDE/SHOW GRAPHS" in the header |
| Lock differential | Click the R.DIFF / F.DIFF button near the gear display |
| Switch range | Click RANGE: HI/LO |
| Reset drag timer | Click RESET under the timer |

---

## Troubleshooting

**Boost map not showing?**
- Your vehicle needs a turbocharger or supercharger. NA cars only show the telemetry HUD.
- The mod installs into the N2O system slot — make sure no other mod is using that slot.

**Boost values all 0?**
- This happens when BeamNG's saved config resets the tuning variables. Click the STOCK preset to restore factory boost levels.

**Dashboard too small?**
- Drag the widget edges in the UI Apps editor to make it larger. The dashboard auto-fills to whatever size you give it.

**No presets/buttons visible?**
- Presets only appear for turbo/supercharged vehicles. On NA cars they're hidden.

---

## File Structure

```
fueltech_boost_controller/
  lua/vehicle/controller/
    fueltechBoostController.lua   -- Boost control, PI controller, profiles
    fueltechDrivetrain.lua        -- Diff lock, range box, ESC/TCS detection
  ui/modules/apps/FuelTechBoost/
    app.html                      -- Dashboard layout
    app.css                       -- Dark theme with FuelTech orange accents
    app.js                        -- Gauges, graphs, telemetry, feature detection
    app.json                      -- App metadata
  vehicles/common/fueltech_boost/
    fueltech_boost.jbeam           -- Vehicle integration + tuning variables
```

## Compatibility

- BeamNG.drive 0.34+
- Turbocharged, supercharged, and NA vehicles
- Touch support (Steam Deck / touchscreen)

## License

MIT License — free to use, modify, and distribute.

## Credits

- **Author:** [Nelito](https://github.com/nelitow)
- Dashboard design inspired by [FuelTech](https://www.fueltech.com/) standalone ECUs
