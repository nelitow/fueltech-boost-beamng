-- FuelTech Progressive Nitrous Controller
-- Tunable nitrous-oxide power adder: a 6-point RPM/added-HP curve, a
-- per-gear lockout/multiplier grid, and a progressive trigger-pull ramp
-- (0 -> full shot over a tunable time, and back down on release) instead
-- of BeamNG's stock all-or-nothing N2O device.
--
-- Fully custom — does NOT use v.data.turbocharger-style hardware, so it
-- auto-attaches to every vehicle with an engine (NA or forced induction),
-- the same way fueltechDrivetrain does. On vehicles that ship a real N2O
-- part (e.g. the Bruckell Moonhawk drag build) this controller stays
-- disabled so it doesn't fight the stock device over the same field.
--
-- ── How torque is injected ──
-- combustionEngine.lua exposes a plain field, device.nitrousOxideTorque,
-- added straight into the crank torque every physics tick:
--   torque = (torque * forcedInductionCoef * throttleMap + device.nitrousOxideTorque) * ...
-- (lua/vehicle/powertrain/combustionEngine.lua, updateTorque()). It's the
-- same field the stock N2O device writes to, and the engine also folds it
-- into its own fuel-burn accounting (burnEnergyNitrousOxide) automatically
-- — we get realistic fuel consumption for free just by setting it.
--
-- The catch: combustionEngine's own updateGFX() unconditionally resets
-- nitrousOxideTorque to 0 once per graphics frame (right before it would
-- call a native device's updateGFX to repopulate it) — see that file
-- around "device.nitrousOxideTorque = 0 -- reset N2O torque". The
-- vehicle's main loop runs controller.updateGFX() BEFORE powertrain's, so
-- writing the field from *our* updateGFX would get wiped every frame.
-- Writing it from M.update() (the physics-step hook) works instead,
-- because onPhysicsStep runs powertrain.update() (reads the field for
-- this tick's torque) THEN controller.update() (where we set it) — our
-- value survives untouched until the next graphics-frame reset, at which
-- point the very next physics tick re-applies it. Net effect: correct
-- every tick except one single physics tick per graphics frame (a
-- fraction of a millisecond), same margin the stock device itself runs at.

local M = {}
M.type = "auxiliary"
M.relevantDevice = "mainEngine"

local engine = nil
local enabled = false
local hasConflict = false   -- true if the vehicle already has a real N2O part

-- RPM/added-HP table: sorted pairs {rpm, hpBonus} — the "full shot" curve
local nitrousTable = {}

-- Per-gear enable multiplier (0 = locked out, 1 = full shot). Index 1 is
-- 1st gear. Sized to 8 internally (safe ceiling for any gearbox), but only
-- the first numGears entries are meaningful — see detectGearCount().
local gearMultipliers = {0, 0.5, 1, 1, 1, 1, 1, 1}
local numGears = 6  -- forward gear count; refined in init() from the gearbox device

local armed = false
local nitrousLevel = 0       -- current ramp position, 0..1
local currentAddedNm = 0     -- last torque actually injected (for UI/debug)
local currentAddedHp = 0

local ACTIVATION_RPM = 2500     -- won't start ramping below this RPM
local RAMP_UP_TIME = 1.2        -- seconds to reach full commanded level
local RAMP_DOWN_TIME = 0.35     -- seconds to fall back to 0 on release
local WOT_THRESHOLD = 0.9       -- throttle position considered "trigger pulled"

-- Safety cut — independent of the boost controller so this works standalone
-- on NA cars too.
local WATER_TEMP_CUT = 118
local OIL_TEMP_CUT = 138
local safetyCut = false

-- Auto-save (same pattern as fueltechBoostController — persists the tuned
-- curve/gear grid/settings across Ctrl+R, part-swap, and reload)
local AUTOSAVE_NAME = "_nitrous_autosave"
local profileDir = nil
local autosaveDirty = false
local autosaveTimer = 0
local AUTOSAVE_INTERVAL = 1.5

local function markDirty()
  autosaveDirty = true
end

local function lerp(a, b, t)
  return a + (b - a) * t
end

local function getTargetHp(rpm)
  if #nitrousTable == 0 then return 0 end
  if rpm <= nitrousTable[1][1] then return nitrousTable[1][2] end
  if rpm >= nitrousTable[#nitrousTable][1] then return nitrousTable[#nitrousTable][2] end
  for i = 1, #nitrousTable - 1 do
    local rLow, rHigh = nitrousTable[i][1], nitrousTable[i + 1][1]
    if rpm >= rLow and rpm <= rHigh then
      local span = rHigh - rLow
      if span < 1 then return nitrousTable[i][2] end
      return lerp(nitrousTable[i][2], nitrousTable[i + 1][2], (rpm - rLow) / span)
    end
  end
  return nitrousTable[#nitrousTable][2]
end

local function getGearMultiplier()
  local gearVal = electrics.values.gear_M or electrics.values.gearIndex or 0
  if gearVal <= 0 then return 0 end -- neutral/reverse: no nitrous
  return gearMultipliers[gearVal] or 0
end

-- Reads the actual gearbox device to size the gear grid to this car instead
-- of always showing 8 slots. gearRatios is keyed by gear index: positive
-- keys are forward gears, 0 is neutral, negative is reverse (confirmed live
-- against a manual gearbox: {[0]=0, [1]=3.083, ..., [5]=0.972, [-1]=-3.545}
-- -> 5 forward gears). Falls back to the previous default if the gearbox
-- device isn't found or doesn't expose gearRatios (e.g. some CVTs).
local function detectGearCount()
  local gearbox = powertrain.getDevice("gearbox")
  if not gearbox or not gearbox.gearRatios then return end
  local maxGear = 0
  for k, _ in pairs(gearbox.gearRatios) do
    if type(k) == "number" and k > maxGear then maxGear = k end
  end
  if maxGear > 0 then numGears = math.min(maxGear, 8) end
end

-- Physics-tick hook: writes engine.nitrousOxideTorque every tick from the
-- ramp level computed in updateGFX. See the file header for why this has
-- to be M.update and not M.updateGFX.
local function updatePhysics(dt)
  if not enabled or not engine then return end
  if nitrousLevel <= 0.001 then
    engine.nitrousOxideTorque = 0
    currentAddedNm = 0
    return
  end
  local rpm = engine.outputRPM or 0
  if rpm <= 1 then
    engine.nitrousOxideTorque = 0
    currentAddedNm = 0
    return
  end
  local targetHp = getTargetHp(rpm) * nitrousLevel * getGearMultiplier()
  local addedWatts = math.max(targetHp, 0) * 745.7
  local av = rpm * 0.10471975
  local addedNm = addedWatts / av
  engine.nitrousOxideTorque = addedNm
  currentAddedNm = addedNm
  currentAddedHp = targetHp
end

local function updateGFX(dt)
  if not enabled or not engine then
    electrics.values.fueltech_n2o_active = 0
    electrics.values.fueltech_n2o_armed = 0
    return
  end

  local waterT = electrics.values.watertemp or 0
  local oilT = electrics.values.oiltemp or 0
  if waterT > WATER_TEMP_CUT or oilT > OIL_TEMP_CUT then
    safetyCut = true
  elseif waterT < (WATER_TEMP_CUT - 5) and oilT < (OIL_TEMP_CUT - 5) then
    safetyCut = false
  end

  local rpm = engine.outputRPM or 0
  local throttle = electrics.values.throttle or 0
  local gearMul = getGearMultiplier()

  local wantsFiring = armed and not safetyCut and
    throttle >= WOT_THRESHOLD and rpm >= ACTIVATION_RPM and gearMul > 0

  -- Progressive ramp: ease in over RAMP_UP_TIME, ease out over RAMP_DOWN_TIME
  if wantsFiring then
    nitrousLevel = math.min(1, nitrousLevel + dt / RAMP_UP_TIME)
  else
    nitrousLevel = math.max(0, nitrousLevel - dt / RAMP_DOWN_TIME)
  end

  local firing = nitrousLevel > 0.01

  electrics.values.fueltech_n2o_armed = armed and 1 or 0
  electrics.values.fueltech_n2o_active = firing and 1 or 0
  electrics.values.fueltech_n2o_level = nitrousLevel
  electrics.values.fueltech_n2o_addedHp = currentAddedHp
  electrics.values.fueltech_n2o_addedNm = currentAddedNm
  -- Current gear's multiplier — lets the HUD tell "armed but gear-locked"
  -- apart from "armed and waiting for WOT/RPM", instead of just "ARMED"
  -- for both, which is exactly the ambiguity that erodes trust in the tune.
  electrics.values.fueltech_n2o_gearMul = gearMul
  electrics.values.fueltech_n2o_safetyCut = safetyCut and 1 or 0

  if autosaveDirty then
    autosaveTimer = autosaveTimer + dt
    if autosaveTimer >= AUTOSAVE_INTERVAL then
      autosaveDirty = false
      autosaveTimer = 0
      if profileDir then
        local data = {
          name = AUTOSAVE_NAME,
          nitrousTable = {},
          gearMultipliers = gearMultipliers,
          rampUp = RAMP_UP_TIME,
          rampDown = RAMP_DOWN_TIME,
          activationRPM = ACTIVATION_RPM,
        }
        for i = 1, #nitrousTable do data.nitrousTable[i] = {nitrousTable[i][1], nitrousTable[i][2]} end
        pcall(function()
          FS:directoryCreate(profileDir, true)
          writeFile(profileDir .. "/" .. AUTOSAVE_NAME .. ".json", jsonEncode(data))
        end)
      end
    end
  end
end

local function getNitrousTable()
  local result = {}
  for i = 1, #nitrousTable do
    result[i] = { rpm = nitrousTable[i][1], hp = nitrousTable[i][2] }
  end
  guihooks.trigger("fueltechNitrousTable", result)
end

local function getGearInfo()
  guihooks.trigger("fueltechNitrousGearInfo", { multipliers = gearMultipliers, numGears = numGears })
end

-- Always safe to call regardless of enabled state — this is the ONLY
-- reliable "is nitrous usable on this vehicle" signal. Don't infer
-- availability from whether other electrics keys exist: reset() and
-- toggleArm() are reachable even on a disabled controller (a stray call
-- from a UI that hasn't refreshed yet) and must never be mistaken for
-- the feature actually working.
local function getAvailability()
  guihooks.trigger("fueltechNitrousAvailable", { available = enabled })
end

local function getSettings()
  guihooks.trigger("fueltechNitrousSettings", {
    armed = armed,
    rampUp = RAMP_UP_TIME,
    rampDown = RAMP_DOWN_TIME,
    activationRPM = ACTIVATION_RPM,
  })
end

local function toggleArm()
  if not enabled then return end
  armed = not armed
  -- Disarming doesn't force an instant cut — updateGFX's normal
  -- "not wantsFiring" branch ramps nitrousLevel down over RAMP_DOWN_TIME
  -- on the very next frame, same as a mid-shot throttle lift.
  electrics.values.fueltech_n2o_armed = armed and 1 or 0
  log("I", "fueltechNitrous", "Nitrous " .. (armed and "ARMED" or "disarmed"))
  markDirty()
end

local function setPoint(index, rpmVal, hpVal)
  if index >= 1 and index <= #nitrousTable then
    nitrousTable[index][1] = rpmVal
    nitrousTable[index][2] = math.max(0, hpVal)
    table.sort(nitrousTable, function(a, b) return a[1] < b[1] end)
    markDirty()
  end
end

local function setGearMultiplier(gearIdx, mul)
  if gearIdx >= 1 and gearIdx <= 8 then
    gearMultipliers[gearIdx] = math.max(0, math.min(mul, 1))
    markDirty()
    getGearInfo()
  end
end

local function setRampTimes(up, down)
  RAMP_UP_TIME = math.max(0.1, up or RAMP_UP_TIME)
  RAMP_DOWN_TIME = math.max(0.05, down or RAMP_DOWN_TIME)
  markDirty()
  getSettings()
end

local function setActivationRPM(rpm)
  ACTIVATION_RPM = math.max(0, rpm or ACTIVATION_RPM)
  markDirty()
  getSettings()
end

local function setPreset(name)
  if name == "MILD" then
    nitrousTable = {{2500, 15}, {3500, 25}, {4500, 35}, {5500, 40}, {6500, 35}, {7500, 25}}
  elseif name == "AGGRESSIVE" then
    nitrousTable = {{2500, 30}, {3500, 55}, {4500, 75}, {5500, 85}, {6500, 75}, {7500, 55}}
  elseif name == "OFF" then
    for i = 1, #nitrousTable do nitrousTable[i][2] = 0 end
  end
  markDirty()
  getNitrousTable()
end

local function init(jbeamData)
  jbeamData = jbeamData or {}
  engine = powertrain.getDevice("mainEngine")

  if not engine then
    enabled = false
    electrics.values.fueltech_n2o_available = 0
    return
  end

  -- Don't fight a real N2O part (e.g. the Bruckell Moonhawk drag build)
  -- over the same nitrousOxideTorque field.
  if engine.nitrousOxideInjection and engine.nitrousOxideInjection.isExisting then
    hasConflict = true
    enabled = false
    electrics.values.fueltech_n2o_available = 0
    log("I", "fueltechNitrous", "Vehicle has a native N2O part installed — FuelTech nitrous controller disabled to avoid conflicting torque injection")
    return
  end

  enabled = true
  armed = false
  nitrousLevel = 0
  engine.nitrousOxideTorque = engine.nitrousOxideTorque or 0
  electrics.values.fueltech_n2o_available = 1

  detectGearCount()

  nitrousTable = {{2500, 15}, {3500, 25}, {4500, 35}, {5500, 40}, {6500, 35}, {7500, 25}}

  local vehDir = v.data and v.data.vDirectory
  if vehDir then
    profileDir = vehDir .. "/fueltech_profiles"
  end

  if profileDir then
    local ok, data = pcall(function()
      local content = readFile(profileDir .. "/" .. AUTOSAVE_NAME .. ".json")
      if content then return jsonDecode(content) end
    end)
    if ok and data then
      if data.nitrousTable and #data.nitrousTable > 0 then
        nitrousTable = {}
        for i, pt in ipairs(data.nitrousTable) do nitrousTable[i] = {pt[1], pt[2]} end
      end
      if data.gearMultipliers then
        for i, val in ipairs(data.gearMultipliers) do gearMultipliers[i] = val end
      end
      if data.rampUp then RAMP_UP_TIME = data.rampUp end
      if data.rampDown then RAMP_DOWN_TIME = data.rampDown end
      if data.activationRPM then ACTIVATION_RPM = data.activationRPM end
      log("I", "fueltechNitrous", "Restored nitrous tune from autosave")
    end
  end

  M.update = updatePhysics
  M.updateGFX = updateGFX
  log("I", "fueltechNitrous", "FuelTech Nitrous Controller initialized: " .. #nitrousTable .. " breakpoints, " .. numGears .. " forward gears")
end

local function reset()
  if not enabled then return end
  armed = false
  nitrousLevel = 0
  currentAddedNm = 0
  currentAddedHp = 0
  electrics.values.fueltech_n2o_active = 0
  electrics.values.fueltech_n2o_armed = 0
  electrics.values.fueltech_n2o_level = 0
  if engine then
    engine.nitrousOxideTorque = 0
  end
end

M.init = init
M.reset = reset
M.update = nop
M.updateGFX = nop
M.toggleArm = toggleArm
M.setPoint = setPoint
M.getNitrousTable = getNitrousTable
M.setGearMultiplier = setGearMultiplier
M.getGearInfo = getGearInfo
M.getSettings = getSettings
M.getAvailability = getAvailability
M.setRampTimes = setRampTimes
M.setActivationRPM = setActivationRPM
M.setPreset = setPreset

M.dumpState = function()
  return jsonEncode({
    enabled = enabled,
    hasConflict = hasConflict,
    armed = armed,
    level = nitrousLevel,
    addedNm = currentAddedNm,
    addedHp = currentAddedHp,
    numGears = numGears,
    curve = nitrousTable,
    gearMultipliers = gearMultipliers,
  })
end

return M
