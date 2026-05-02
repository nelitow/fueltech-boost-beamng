# FuelTech Boost Controller for BeamNG.drive

A full-screen dashboard mod inspired by FuelTech standalone ECUs. Features real-time boost control with an interactive boost map, power/torque curves, telemetry gauges, and drivetrain selectors.

Works with **turbocharged** and **supercharged** vehicles. On naturally aspirated cars, it works as a universal telemetry HUD (boost features auto-hide).

[![Download Latest](https://img.shields.io/github/v/release/nelitow/fueltech-boost-beamng?label=Download%20Latest&color=ff6600&style=for-the-badge)](https://github.com/nelitow/fueltech-boost-beamng/releases/latest/download/fueltech_boost_controller.zip)

![BeamNG.drive](https://img.shields.io/badge/BeamNG.drive-0.34+-blue)
![License](https://img.shields.io/badge/license-MIT-green)

![FuelTech Dashboard](docs/screenshot_turbo.png)

---

## Installation

> ⚠️ **Most "doesn't show up" issues come from extracting the zip or skipping step 3.** Read each step.

### 1. Download the zip — DO NOT EXTRACT IT

**[⬇ Click here to download `fueltech_boost_controller.zip`](https://github.com/nelitow/fueltech-boost-beamng/releases/latest/download/fueltech_boost_controller.zip)**

(That link always serves the latest release.)

Leave it as a `.zip` file. BeamNG loads zipped mods directly — extracting them is a common cause of broken installs.

### 2. Drop the zip in your BeamNG mods folder

Open File Explorer and paste **one** of these into the address bar (whichever exists on your system):

```
%USERPROFILE%\Documents\BeamNG.drive\mods
```
```
%LocalAppData%\BeamNG.drive\<version>\mods
```

(Most installs use the `Documents` one. The `LocalAppData` one is for Steam Cloud or portable setups.)

If the `mods` folder doesn't exist, create it. Then **drop the .zip directly inside it**:

```
mods/
└── fueltech_boost_controller.zip      ← like this
```

**Do NOT** create an `unpacked` folder, **do NOT** extract the zip, **do NOT** rename it.

### 3. ⚠️ Enable the part on your vehicle (most-skipped step)

The mod installs as an ECU part that uses the N2O system slot. You have to enable it once per vehicle:

1. Spawn any **turbocharged or supercharged** car (most modern cars work — pickups, EVs, and race-prep cars often don't have a free N2O slot).
2. Press **`Ctrl + W`** to open Vehicle Config.
3. In the parts tree, find **"FuelTech Boost Controller"** under **Additional Modification**.
4. Click to add it. Save the config if you want it to persist.

If you skip this step, the dashboard will spawn but the boost controller won't attach — your car will blow past the limiter as if the mod weren't there.

### 4. Add the dashboard to your screen

1. Press **Esc** → click **UI Apps** (bottom-left of the menu).
2. Search for **"FuelTech Dashboard"**.
3. Click it once to drop it on screen.
4. **Drag the edges** to resize. The dashboard fills whatever area you give it — small corner overlay or full-screen, your call.

### 5. Done

The dashboard auto-detects your vehicle:
- **Turbo car** — boost map (TUNE button), PSI gauge, turbo RPM, power curves, presets.
- **Supercharged car** — boost PSI gauge, boost control via bypass valve (no turbo RPM).
- **NA car** — RPM, speed, G-force, temps, telemetry only (boost features auto-hide).

### Still not working?

| Problem | Fix |
|---------|-----|
| Dashboard doesn't appear in UI Apps | The zip is in the wrong folder. Check both paths in step 2. |
| Dashboard appears but ACTIVE never lights up | You skipped step 3 (enable the part in Vehicle Config). |
| "FuelTech Boost Controller" not in Vehicle Config | Your vehicle has no N2O slot, or another mod is using it. Try a different car. |
| Wrong folder structure after extracting | Don't extract — see step 1. If you already did, delete the unpacked folder and restart at step 1. |

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
- **Throttle / Turbo RPM** — shown only when available
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
