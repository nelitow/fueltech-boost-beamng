-- FuelTech Boost Controller
-- Boost-by-RPM controller inspired by FuelTech standalone ECUs
-- Controls boost pressure targets at different RPM breakpoints via wastegate offset

local M = {}
M.type = "auxiliary"
M.relevantDevice = "mainEngine"

local engine = nil
local enabled = false
local hasFI = false        -- has any forced induction
local fiType = nil         -- "turbo" or "supercharger"
local baseWastegate = 0
local currentPreset = "CUSTOM"

-- RPM/boost table: sorted pairs of {rpm, boostPSI}
local boostTable = {}

-- Boost-by-gear: multiplier per gear (1.0 = full boost)
local boostByGear = false
local gearMultipliers = {0.5, 0.65, 0.8, 1.0, 1.0, 1.0, 1.0, 1.0}

-- Anti-lag system (ALS)
local alsEnabled = false       -- user toggle
local alsFiring = false        -- currently firing (off-throttle, keeping turbo spooled)
local ALS_MIN_RPM = 3500       -- don't fire below this RPM
local ALS_THROTTLE_OPEN = 0.25 -- hold throttle at 25% when ALS fires
local ALS_WASTEGATE_HOLD = 5   -- wastegate offset to hold during ALS (keeps turbo spinning)

-- Saved profiles
local savedProfiles = {}
local profileDir = nil

-- Auto-save: BeamNG re-runs init() on Ctrl+R, part-swap, and full reload,
-- which would otherwise wipe the user's custom boost map back to whatever
-- the jbeam variables were last saved as. We persist the live map to a
-- per-vehicle "_autosave" profile and restore it during init.
local AUTOSAVE_NAME = "_autosave"
local autosaveDirty = false
local autosaveTimer = 0
local AUTOSAVE_INTERVAL = 1.5  -- seconds between writes when something changed

local function markBoostMapDirty()
  autosaveDirty = true
end

-- Forward declarations
local loadProfiles
local sendProfileList
-- setPreset("AUTOMAX") dispatches to autoMax, which is defined after
-- setPreset — without this forward declaration the reference compiled as
-- a nil GLOBAL and the AUTO MAX button errored at runtime (v8.2–v8.5 bug).
local autoMax

local stockBoostMax = 0  -- saved from the turbo's boostMax at init

-- ── BeamNG's actual turbo torque model ──
-- From lua/vehicle/powertrain/turbocharger.lua (getTorqueCoefs, line ~522):
--
--   torqueCoef(rpm) = 1 + 0.0000087 * boost_Pa * efficiency(rpm)
--
-- Torque is LINEAR in gauge pressure — not the manifold-absolute-pressure
-- ratio we assumed before v8.6.0. getTorqueCoefs() bakes the coef at the
-- wastegate reference pressure (wastegateStart + wastegateRange/2), so the
-- per-RPM pressure slope falls out of the coef directly:
--
--   slope(rpm) = (coef(rpm) - 1) / refPSI          [torque gain per PSI]
--   torque(rpm, psi) = baseTorque(rpm) * (1 + slope(rpm) * psi)
--
-- which makes both projection and the AUTO MAX inversion exact for the sim.

-- Torque gain per PSI of boost at efficiency 1.0 (0.0000087 per Pascal).
local K_PSI = 0.0000087 * 6894.757  -- ≈ 0.05998

-- Wastegate reference pressure (PSI) the coef table was computed at.
-- Reads the turbo jbeam straight from v.data; wastegateStart/-Limit may be
-- per-gear tables. Mirrors the estimatedWastegateLimit math in the game's
-- turbocharger.lua (start + range * 0.5; default limit = start + 0.01).
local function getTurboRefPSI()
  local t = v.data and v.data.turbocharger
  if not t then return 0 end
  local maxStart = 0
  if type(t.wastegateStart) == "table" then
    for _, s in pairs(t.wastegateStart) do if s > maxStart then maxStart = s end end
  elseif type(t.wastegateStart) == "number" then
    maxStart = t.wastegateStart
  end
  if maxStart <= 0 then return 0 end
  local maxLimit = maxStart + 0.01
  if type(t.wastegateLimit) == "table" then
    for _, s in pairs(t.wastegateLimit) do if s > maxLimit then maxLimit = s end end
  elseif type(t.wastegateLimit) == "number" then
    maxLimit = math.max(t.wastegateLimit, maxLimit)
  end
  return maxStart + (maxLimit - maxStart) * 0.5
end

-- ── Exact turbo model, replicated from the jbeam ──
-- turboModel is built at init from v.data.turbocharger and replicates the
-- steady-state part of the game's turbocharger.lua:
--   * effPoints:   engineDef[i] = {rpm, efficiency, exhaustFraction}
--   * spool limit: turboAV = sqrt(max(0.9·rpm·rpmToAV/engMaxAV·exh(rpm)·
--                  maxExhaustPower − frictionCoef, 0)/backPressureCoef),
--                  then pressurePSI curve at that turbo RPM (line 517-521).
-- The coef table alone is NOT enough: at spool-limited RPM it bakes in the
-- spool pressure, not the wastegate reference, so slopes derived from it
-- under-read in the midband and AUTO MAX would overshoot the torque limit.
local turboModel = nil

local function lerpPoints(points, x)
  -- points: sorted {{x1,y1},...}; clamps outside the range
  local n = #points
  if n == 0 then return 0 end
  if x <= points[1][1] then return points[1][2] end
  if x >= points[n][1] then return points[n][2] end
  for i = 1, n - 1 do
    if x >= points[i][1] and x <= points[i + 1][1] then
      local span = points[i + 1][1] - points[i][1]
      if span < 1e-9 then return points[i][2] end
      local t = (x - points[i][1]) / span
      return points[i][2] + (points[i + 1][2] - points[i][2]) * t
    end
  end
  return points[n][2]
end

local function numericRows(tbl, cols)
  -- jbeam curve tables may carry a header row of strings — keep numeric rows
  local out = {}
  if type(tbl) ~= "table" then return out end
  for _, row in ipairs(tbl) do
    if type(row) == "table" and type(row[1]) == "number" then
      local r = {}
      for c = 1, cols do r[c] = row[c] end
      out[#out + 1] = r
    end
  end
  table.sort(out, function(a, b) return a[1] < b[1] end)
  return out
end

local function buildTurboModel()
  local t = v.data and v.data.turbocharger
  if not t or not engine then return nil end
  local defRows = numericRows(t.engineDef, 3)
  local prsRows = numericRows(t.pressurePSI, 2)
  if #defRows == 0 or #prsRows == 0 then return nil end

  local effPoints, exhPoints = {}, {}
  for i, row in ipairs(defRows) do
    effPoints[i] = { row[1], row[2] }
    exhPoints[i] = { row[1], math.min(row[3] or 1, 1) }
  end

  return {
    effPoints = effPoints,
    exhPoints = exhPoints,
    prsPoints = prsRows,
    maxExhaustPower = t.maxExhaustPower or 1,
    frictionCoef = t.frictionCoef or 0,
    backPressureCoef = t.backPressureCoef or 1,
    refPSI = getTurboRefPSI(),
    invEngMaxAV = 1 / ((engine.maxRPM or 7000) * 0.10471975),
  }
end

local function effAtRPM(rpmVal)
  if not turboModel then return 0 end
  return lerpPoints(turboModel.effPoints, rpmVal)
end

-- Max boost the compressor can physically deliver at this engine RPM
-- (steady state, full throttle), before the wastegate is even considered.
local function spoolLimitPSI(rpmVal)
  if not turboModel then return 999 end
  local m = turboModel
  local exh = lerpPoints(m.exhPoints, rpmVal)
  local drive = 0.9 * rpmVal * 0.10471975 * m.invEngMaxAV * exh * m.maxExhaustPower - m.frictionCoef
  if drive <= 0 then return 0 end
  local turboAV = math.sqrt(drive / m.backPressureCoef)
  local turboRPM = turboAV * 9.549296596425384
  return lerpPoints(m.prsPoints, turboRPM)
end

-- Exact projected torque at a target gauge PSI: the delivered pressure is
-- capped by what the compressor can spool at this RPM, and torque is
-- linear in delivered pressure (K_PSI · efficiency). `base` is the NA
-- torque at this RPM (passed in — getBaseTorque is defined further down).
local function projTorqueExact(rpmVal, targetPSI, base)
  if not turboModel then return base end
  local delivered = math.min(math.max(targetPSI, 0), spoolLimitPSI(rpmVal))
  return base * (1 + K_PSI * effAtRPM(rpmVal) * delivered)
end

local function lerp(a, b, t)
  return a + (b - a) * t
end

-- Interpolate from engine torque curve (sparse table keyed by RPM)
local function getBaseTorque(rpmVal)
  if not engine or not engine.torqueCurve then return 0 end
  if engine.torqueCurve[rpmVal] then return engine.torqueCurve[rpmVal] end
  local below, above = nil, nil
  for k, _ in pairs(engine.torqueCurve) do
    if type(k) == "number" then
      if k <= rpmVal and (not below or k > below) then below = k end
      if k >= rpmVal and (not above or k < above) then above = k end
    end
  end
  if not below and not above then return 0 end
  if not below then return engine.torqueCurve[above] end
  if not above then return engine.torqueCurve[below] end
  if below == above then return engine.torqueCurve[below] end
  local t = (rpmVal - below) / (above - below)
  return lerp(engine.torqueCurve[below], engine.torqueCurve[above], t)
end

-- Linear interpolation of boost target from RPM table
local function getTargetBoost(rpm)
  if #boostTable == 0 then return baseWastegate end
  if rpm <= boostTable[1][1] then return boostTable[1][2] end
  if rpm >= boostTable[#boostTable][1] then return boostTable[#boostTable][2] end
  for i = 1, #boostTable - 1 do
    local rpmLow = boostTable[i][1]
    local rpmHigh = boostTable[i + 1][1]
    if rpm >= rpmLow and rpm <= rpmHigh then
      local span = rpmHigh - rpmLow
      if span < 1 then return boostTable[i][2] end
      local t = (rpm - rpmLow) / span
      return lerp(boostTable[i][2], boostTable[i + 1][2], t)
    end
  end
  return baseWastegate
end

local function getGearMultiplier()
  if not boostByGear then return 1.0 end
  local gearVal = electrics.values.gear_M or electrics.values.gearIndex or 0
  if gearVal <= 0 then return 1.0 end
  return gearMultipliers[gearVal] or 1.0
end

-- Closed-loop boost controller state
local boostOffset = 0
local integralError = 0
local KP = 1.0    -- proportional gain
local KI = 3.0    -- integral gain (converges on target over time)
local IMAX = 30   -- anti-windup clamp

-- Safety: boost cut thresholds
local WATER_TEMP_CUT = 115   -- °C — cut boost above this coolant temp
local OIL_TEMP_CUT = 135     -- °C — cut boost above this oil temp
local safetyCut = false

local function updateGFX(dt)
  if not enabled or not engine or not hasFI then
    electrics.values.fueltech_active = 0
    electrics.values.fueltech_targetBoost = 0
    boostOffset = 0
    integralError = 0
    return
  end

  local currentRPM = engine.outputRPM or 0
  local targetPSI = getTargetBoost(currentRPM)

  -- Apply gear multiplier
  local gearMul = getGearMultiplier()
  targetPSI = targetPSI * gearMul

  -- Read the hardware max boost (used by the UI as an informational
  -- baseline, not as a clamp — v8.1.1+ always honours the user's target).
  local turboMax = electrics.values.turboBoostMax or electrics.values.boostMax or 0

  local actualBoost = electrics.values.turboBoost or electrics.values.boost or 0

  -- Safety: cut boost if coolant or oil temp too high
  local waterT = electrics.values.watertemp or 0
  local oilT = electrics.values.oiltemp or 0
  if waterT > WATER_TEMP_CUT or oilT > OIL_TEMP_CUT then
    safetyCut = true
  elseif waterT < (WATER_TEMP_CUT - 5) and oilT < (OIL_TEMP_CUT - 5) then
    safetyCut = false
  end

  if safetyCut then
    targetPSI = 0
  end

  -- Publish state for UI
  electrics.values.fueltech_boostMax = turboMax
  electrics.values.fueltech_safetyCut = safetyCut and 1 or 0

  -- Vehicle mass (fueltech_mass) is published by fueltechDrivetrain —
  -- that controller attaches to every vehicle, so the WT readout works
  -- on NA and EV cars too (this one only attaches to forced induction).

  -- ── Auto-save throttle ──
  -- markBoostMapDirty() flips a flag on every map mutation. We commit to
  -- disk at most once per AUTOSAVE_INTERVAL so dragging a dot doesn't
  -- thrash the filesystem.
  if autosaveDirty then
    autosaveTimer = autosaveTimer + dt
    if autosaveTimer >= AUTOSAVE_INTERVAL then
      autosaveDirty = false
      autosaveTimer = 0
      -- Inline write (avoids touching the saveProfile() side effects like
      -- the "Loaded profile" log line and the UI profile-list refresh).
      if profileDir then
        local data = { name = AUTOSAVE_NAME, boostTable = {}, gearMultipliers = gearMultipliers, boostByGear = boostByGear, currentPreset = currentPreset }
        for i = 1, #boostTable do data.boostTable[i] = {boostTable[i][1], boostTable[i][2]} end
        savedProfiles[AUTOSAVE_NAME] = data
        pcall(function()
          FS:directoryCreate(profileDir, true)
          writeFile(profileDir .. "/" .. AUTOSAVE_NAME .. ".json", jsonEncode(data))
        end)
      end
    end
  end

  -- ── Anti-Lag System (ALS) ──
  -- When enabled and driver lifts off throttle at high RPM:
  -- keep throttle partially open + hold wastegate to maintain turbo spool
  local inputThrottle = electrics.values.throttle or 0
  local alsWastagateOverride = nil

  if alsEnabled and fiType == "turbo" and not safetyCut then
    local isOffThrottle = inputThrottle < 0.08
    local rpmHigh = currentRPM > ALS_MIN_RPM
    local gearEngaged = (electrics.values.gear_M or electrics.values.gearIndex or 0) > 0

    if isOffThrottle and rpmHigh and gearEngaged then
      -- ALS FIRING: hold throttle partially open to keep exhaust flowing
      alsFiring = true
      electrics.values.throttle = ALS_THROTTLE_OPEN

      -- Hold wastegate to maintain boost pressure (don't let it dump)
      alsWastagateOverride = ALS_WASTEGATE_HOLD
    else
      alsFiring = false
    end
  else
    alsFiring = false
  end

  -- Publish ALS state
  electrics.values.fueltech_als_enabled = alsEnabled and 1 or 0
  electrics.values.fueltech_als_firing = alsFiring and 1 or 0

  -- STOCK on a turbo means "leave the wastegate alone" — hand control back
  -- to the factory spring/wastegate curve instead of chasing an absolute
  -- PSI target (there's no factory-boost value the game exposes to us).
  local nativeStock = (currentPreset == "STOCK" and fiType == "turbo")

  -- Closed-loop PI controller
  if nativeStock then
    integralError = 0
    boostOffset = alsWastagateOverride or 0
  elseif currentRPM > 1500 and targetPSI > 0 then
    local err = targetPSI - actualBoost
    integralError = integralError + err * dt * KI
    integralError = math.max(-IMAX, math.min(integralError, IMAX))
    boostOffset = err * KP + integralError
  else
    integralError = 0
    boostOffset = -10
  end

  -- ALS wastegate override: keep wastegate from dumping when ALS fires
  if alsWastagateOverride and not nativeStock then
    boostOffset = math.max(boostOffset, alsWastagateOverride)
  end

  -- Apply control via the appropriate device
  if fiType == "turbo" then
    if engine.turbocharger and engine.turbocharger.setWastegateOffset then
      engine.turbocharger.setWastegateOffset(boostOffset)
    end
  elseif fiType == "supercharger" then
    -- For superchargers: setBypassPressure controls the bypass valve
    -- Higher pressure = more boost (bypass stays closed longer)
    if engine.supercharger and engine.supercharger.setBypassPressure then
      local bypassPSI = math.max(0, targetPSI)
      engine.supercharger.setBypassPressure(bypassPSI)
    end
  end

  electrics.values.fueltech_targetBoost = targetPSI
  electrics.values.fueltech_currentBoost = actualBoost
  electrics.values.fueltech_active = 1
  electrics.values.fueltech_currentRPM = currentRPM
  electrics.values.fueltech_gearMul = gearMul
end

local function init(jbeamData)
  jbeamData = jbeamData or {}
  local engineName = jbeamData.engineName or "mainEngine"
  engine = powertrain.getDevice(engineName)

  if not engine then
    log("W", "fueltechBoost", "No engine found, boost controller disabled")
    enabled = false
    return
  end

  -- Detect forced induction: check isExisting to find the real device
  local hasTurboReal = engine.turbocharger and engine.turbocharger.isExisting
  local hasSCReal = engine.supercharger and engine.supercharger.isExisting

  log("I", "fueltechBoost", "Forced induction: turbo=" .. tostring(hasTurboReal) .. " supercharger=" .. tostring(hasSCReal))

  if hasTurboReal and engine.turbocharger.setWastegateOffset then
    fiType = "turbo"
    hasFI = true
    stockBoostMax = electrics.values.turboBoostMax or electrics.values.boostMax or 0
    turboModel = buildTurboModel()
    log("I", "fueltechBoost", "Using turbocharger (setWastegateOffset)" ..
      (turboModel and string.format(", exact model: ref %.1f PSI, %d eff pts", turboModel.refPSI, #turboModel.effPoints)
                   or ", exact model unavailable — coef fallback"))
  elseif hasSCReal and engine.supercharger.setBypassPressure then
    fiType = "supercharger"
    hasFI = true
    stockBoostMax = electrics.values.superchargerBoostMax or 0
    log("I", "fueltechBoost", "Using supercharger (setBypassPressure)")
  else
    log("W", "fueltechBoost", "No controllable forced induction found, boost controller disabled")
    hasFI = false
    enabled = false
    return
  end

  enabled = (jbeamData.enabled or 1) >= 1

  boostTable = {}
  local allZero = true
  for i = 1, 6 do
    local rpmVal = jbeamData["rpm" .. i]
    local boostVal = jbeamData["boost" .. i]
    if rpmVal and boostVal then
      table.insert(boostTable, {rpmVal, boostVal})
      if boostVal > 0 then allZero = false end
    end
  end
  table.sort(boostTable, function(a, b) return a[1] < b[1] end)

  -- Empty jbeamData (typical when the controller is loaded via the GE
  -- auto-attach extension instead of the legacy n2o-slot jbeam part) —
  -- seed a sensible default 6-point map. The user's autosave profile
  -- will overwrite this a few lines later if one exists.
  if #boostTable == 0 then
    local defaultRPM   = {2000, 3000, 4000, 5000, 6000, 7000}
    local defaultBoost = {5,    10,   15,   20,   20,   18}
    for i = 1, 6 do boostTable[i] = {defaultRPM[i], defaultBoost[i]} end
    log("I", "fueltechBoost", "No jbeam variables — seeded default boost map (auto-attach mode)")
  elseif allZero then
    -- Saved config wiped the defaults to 0 — restore them in place.
    local defaults = {5, 10, 15, 20, 20, 18}
    for i = 1, math.min(#boostTable, #defaults) do
      boostTable[i][2] = defaults[i]
    end
    log("I", "fueltechBoost", "All boost values were 0 — applied default boost map")
  end

  currentPreset = "CUSTOM"

  -- Setup profile directory
  local vehDir = v.data and v.data.vDirectory
  if vehDir then
    profileDir = vehDir .. "/fueltech_profiles"
  end

  -- Load saved profiles
  loadProfiles()

  -- Restore the auto-saved boost map if one exists. This preserves user
  -- tuning across Ctrl+R, part-swap, and full vehicle reload — all of
  -- which re-run init() and would otherwise reset the map to whatever the
  -- jbeam variables were last persisted as.
  local auto = savedProfiles[AUTOSAVE_NAME]
  if auto and auto.boostTable and #auto.boostTable > 0 then
    boostTable = {}
    for i, pt in ipairs(auto.boostTable) do boostTable[i] = {pt[1], pt[2]} end
    if auto.gearMultipliers then
      for i, val in ipairs(auto.gearMultipliers) do gearMultipliers[i] = val end
    end
    if auto.boostByGear ~= nil then boostByGear = auto.boostByGear end
    if auto.currentPreset then currentPreset = auto.currentPreset end
    log("I", "fueltechBoost", "Restored boost map from autosave (" .. #boostTable .. " points, preset: " .. tostring(currentPreset) .. ")")
  end

  if enabled and hasFI then
    M.updateGFX = updateGFX
    log("I", "fueltechBoost", "FuelTech Boost Controller initialized: " .. fiType .. ", " .. #boostTable .. " breakpoints, stockBoostMax: " .. stockBoostMax .. " PSI")
  end
end

local function reset()
  electrics.values.fueltech_active = 0
  electrics.values.fueltech_targetBoost = 0
  electrics.values.fueltech_currentBoost = 0
  electrics.values.fueltech_currentRPM = 0
  electrics.values.fueltech_gearMul = 1
  electrics.values.fueltech_als_firing = 0
  boostOffset = 0
  integralError = 0
  alsFiring = false
  if engine and hasFI then
    if fiType == "turbo" and engine.turbocharger and engine.turbocharger.setWastegateOffset then
      engine.turbocharger.setWastegateOffset(0)
    elseif fiType == "supercharger" and engine.supercharger and engine.supercharger.setBypassPressure then
      engine.supercharger.setBypassPressure(stockBoostMax > 0 and stockBoostMax or 0)
    end
  end
end

local function setPoint(index, rpmVal, psiVal)
  if index >= 1 and index <= #boostTable then
    boostTable[index][1] = rpmVal
    boostTable[index][2] = psiVal
    table.sort(boostTable, function(a, b) return a[1] < b[1] end)
    currentPreset = "CUSTOM"
    markBoostMapDirty()
  end
end

local function getBoostTable()
  local result = {}
  for i = 1, #boostTable do
    result[i] = { rpm = boostTable[i][1], psi = boostTable[i][2] }
  end
  guihooks.trigger("fueltechBoostTable", result)
end

-- Boost-by-gear functions
local function toggleBoostByGear()
  boostByGear = not boostByGear
  markBoostMapDirty()
  guihooks.trigger("fueltechBoostByGearInfo", {
    enabled = boostByGear,
    multipliers = gearMultipliers
  })
end

local function toggleAntiLag()
  alsEnabled = not alsEnabled
  if not alsEnabled then
    alsFiring = false
    electrics.values.fueltech_als_firing = 0
  end
  electrics.values.fueltech_als_enabled = alsEnabled and 1 or 0
  log("I", "fueltechBoost", "Anti-lag system: " .. (alsEnabled and "enabled" or "disabled"))
end

local function setGearMultiplier(gearIdx, mul)
  if gearIdx >= 1 and gearIdx <= 8 then
    gearMultipliers[gearIdx] = math.max(0, math.min(mul, 1.5))
    markBoostMapDirty()
    guihooks.trigger("fueltechBoostByGearInfo", {
      enabled = boostByGear,
      multipliers = gearMultipliers
    })
  end
end

local function getBoostByGearInfo()
  guihooks.trigger("fueltechBoostByGearInfo", {
    enabled = boostByGear,
    multipliers = gearMultipliers
  })
end

-- Profile save/load
loadProfiles = function()
  savedProfiles = {}
  if not profileDir then return end
  local files = FS:findFiles(profileDir, "*.json", 0)
  if not files then return end
  for _, fpath in ipairs(files) do
    local ok, data = pcall(function()
      local content = readFile(fpath)
      if content then return jsonDecode(content) end
    end)
    if ok and data and data.name then
      savedProfiles[data.name] = data
    end
  end
  sendProfileList()
end

sendProfileList = function()
  local names = {}
  for name, _ in pairs(savedProfiles) do
    -- The "_autosave" profile is internal — restored automatically on
    -- vehicle reload, never user-facing. Filter it out of the dropdown.
    if name ~= AUTOSAVE_NAME then table.insert(names, name) end
  end
  table.sort(names)
  guihooks.trigger("fueltechProfileList", names)
end

local function saveProfile(name)
  if not name or name == "" then return end
  local data = {
    name = name,
    boostTable = {},
    gearMultipliers = gearMultipliers,
    boostByGear = boostByGear
  }
  for i = 1, #boostTable do
    data.boostTable[i] = {boostTable[i][1], boostTable[i][2]}
  end
  savedProfiles[name] = data

  if profileDir then
    local ok, err = pcall(function()
      FS:directoryCreate(profileDir, true)
      local fpath = profileDir .. "/" .. name .. ".json"
      writeFile(fpath, jsonEncode(data))
    end)
    if not ok then
      log("W", "fueltechBoost", "Failed to save profile: " .. tostring(err))
    end
  end
  sendProfileList()
end

local function loadProfile(name)
  local data = savedProfiles[name]
  if not data then return end
  if data.boostTable then
    boostTable = {}
    for i, pt in ipairs(data.boostTable) do
      boostTable[i] = {pt[1], pt[2]}
    end
  end
  if data.gearMultipliers then
    for i, v in ipairs(data.gearMultipliers) do
      gearMultipliers[i] = v
    end
  end
  if data.boostByGear ~= nil then
    boostByGear = data.boostByGear
  end
  currentPreset = "CUSTOM"
  getBoostTable()
  sendPowerCurves()
  getBoostByGearInfo()
  log("I", "fueltechBoost", "Loaded profile: " .. name)
end

local function deleteProfile(name)
  savedProfiles[name] = nil
  if profileDir then
    pcall(function()
      FS:removeFile(profileDir .. "/" .. name .. ".json")
    end)
  end
  sendProfileList()
end

local function getProfileList()
  sendProfileList()
end

local function sendPowerCurves()
  if not engine or not hasFI then return end

  local turboCoefs = {}
  if fiType == "turbo" and engine.turbocharger and engine.turbocharger.getTorqueCoefs then
    turboCoefs = engine.turbocharger.getTorqueCoefs()
  elseif fiType == "supercharger" and engine.supercharger and engine.supercharger.getTorqueCoefs then
    turboCoefs = engine.supercharger.getTorqueCoefs()
  end

  local peakTorqueNm = 0
  local peakTorqueRPM = 0
  local peakPowerKw = 0
  local peakPowerRPM = 0
  local maxTorqueRating = -1

  if engine.getTorqueData then
    local td = engine:getTorqueData()
    if td then
      peakTorqueNm = td.maxTorque or 0
      peakTorqueRPM = td.maxTorqueRPM or 0
      peakPowerKw = td.maxPower or 0
      peakPowerRPM = td.maxPowerRPM or 0
    end
  end

  if engine.maxTorqueRating and engine.maxTorqueRating > 0 then
    maxTorqueRating = engine.maxTorqueRating
  end

  local torqueCurve = {}
  local powerCurve = {}
  local baseTorqueCurve = {}
  local basePowerCurve = {}
  local maxEngRPM = engine.maxRPM or 7000
  local idx = 0

  local projPeakTorque = 0
  local projPeakHP = 0

  -- Reference pressure the coef table was computed at. Turbo: wastegate
  -- start + range/2 from jbeam. Supercharger (no v.data.turbocharger):
  -- fall back to the device's reported boostMax.
  local refBoost = getTurboRefPSI()
  if refBoost <= 0 then
    refBoost = stockBoostMax > 0 and stockBoostMax
      or (electrics.values.turboBoostMax or electrics.values.boostMax or 0)
  end

  for rpmVal = 500, maxEngRPM, 250 do
    local baseTorque = getBaseTorque(rpmVal)
    local ourBoostPSI = math.max(getTargetBoost(rpmVal), 0)

    local stockTorque, projTorque
    if turboModel then
      -- Exact spool-aware model: torque = base*(1 + K·eff·delivered),
      -- delivered = min(target, compressor spool limit at this RPM).
      stockTorque = projTorqueExact(rpmVal, turboModel.refPSI, baseTorque)
      projTorque  = projTorqueExact(rpmVal, ourBoostPSI, baseTorque)
    else
      -- Supercharger / no jbeam model: derive a linear slope from the
      -- device coef table at its reference boost.
      local coef = turboCoefs[rpmVal + 1] or turboCoefs[rpmVal] or 1
      local slope = refBoost > 0 and (coef - 1) / refBoost or 0
      stockTorque = baseTorque * coef
      projTorque  = baseTorque * (1 + slope * ourBoostPSI)
    end
    local projPowerKw = projTorque * rpmVal * 0.10471975 / 1000
    local stockPowerKw = stockTorque * rpmVal * 0.10471975 / 1000

    if projTorque > projPeakTorque then projPeakTorque = projTorque end
    local projHP = projPowerKw * 1.34102
    if projHP > projPeakHP then projPeakHP = projHP end

    idx = idx + 1
    torqueCurve[idx] = { rpm = rpmVal, nm = math.floor(projTorque) }
    powerCurve[idx]  = { rpm = rpmVal, hp = math.floor(projPowerKw * 1.34102) }
    baseTorqueCurve[idx] = { rpm = rpmVal, nm = math.floor(stockTorque) }
    basePowerCurve[idx]  = { rpm = rpmVal, hp = math.floor(stockPowerKw * 1.34102) }
  end

  guihooks.trigger("fueltechPowerCurves", {
    torque = torqueCurve,
    power = powerCurve,
    baseTorque = baseTorqueCurve,
    basePower = basePowerCurve,
    maxRPM = maxEngRPM,
    refBoostPSI = refBoost,
    stockPeakTorque = math.floor(peakTorqueNm),
    stockPeakTorqueRPM = math.floor(peakTorqueRPM),
    stockPeakPowerHP = math.floor((peakPowerKw or 0) * 1.34102),
    stockPeakPowerRPM = math.floor(peakPowerRPM),
    maxTorqueRating = math.floor(maxTorqueRating),
    projPeakTorque = math.floor(projPeakTorque),
    projPeakHP = math.floor(projPeakHP)
  })
end

-- Called from UI to apply a preset boost map
local function setPreset(name)
  local rpmPoints = {2000, 3000, 4000, 5000, 6000, 7000}
  if #boostTable > 0 then
    rpmPoints = {}
    for i = 1, #boostTable do rpmPoints[i] = boostTable[i][1] end
  end

  if name == "MIN" then
    boostTable = {}
    for i, r in ipairs(rpmPoints) do boostTable[i] = {r, 0} end
  elseif name == "MAX" then
    -- MAX = hardware turbo limit + ~30% margin. The controller no longer
    -- clamps to boostMax (v8.1.1+), so this value is honoured directly —
    -- the user gets exactly what the preset advertises.
    local hwMax = electrics.values.turboBoostMax or electrics.values.boostMax or 0
    if hwMax <= 0 then hwMax = 20 end
    local maxVal = math.max(hwMax * 1.3, hwMax + 5)
    boostTable = {}
    for i, r in ipairs(rpmPoints) do boostTable[i] = {r, maxVal} end
    log("I", "fueltechBoost", string.format("MAX preset: %.1f PSI per RPM (hw rated max %.1f)", maxVal, hwMax))
  elseif name == "STOCK" then
    -- Display-only reference line. Actual STOCK behaviour for turbos is a
    -- native wastegate passthrough (see updateGFX). The line shows the
    -- factory wastegate target (start + range/2 from jbeam) — NOT
    -- turboBoostMax, which is the hardware ceiling and reads absurdly
    -- high on big-turbo builds.
    local sv = getTurboRefPSI()
    if sv <= 0 then
      sv = (fiType == "supercharger" and stockBoostMax > 0) and stockBoostMax
        or (electrics.values.turboBoostMax or electrics.values.boostMax or 0)
    end
    if sv <= 0 then sv = 14 end
    boostTable = {}
    for i, r in ipairs(rpmPoints) do boostTable[i] = {r, sv} end
  elseif name == "AUTOMAX" then
    autoMax()
    return
  end

  currentPreset = name
  log("I", "fueltechBoost", "Applied preset: " .. name)
  markBoostMapDirty()
  getBoostTable()
  sendPowerCurves()
end

-- Auto Max: calculate maximum safe boost at each RPM keeping torque under the damage limit
-- (assigned to the forward-declared local — see top of file)
autoMax = function()
  if not engine or not hasFI then return end

  -- Determine torque limit: prefer maxTorqueRating (damage threshold), fall back to peak torque
  local torqueLimit = -1
  if engine.maxTorqueRating and engine.maxTorqueRating > 0 then
    torqueLimit = engine.maxTorqueRating
  elseif engine.getTorqueData then
    local td = engine:getTorqueData()
    if td and td.maxTorque and td.maxTorque > 0 then
      torqueLimit = td.maxTorque
    end
  end

  if torqueLimit <= 0 then
    log("W", "fueltechBoost", "No torque limit found for Auto Max, using MAX preset instead")
    setPreset("MAX")
    return
  end

  local turboCoefs = {}
  if fiType == "turbo" and engine.turbocharger and engine.turbocharger.getTorqueCoefs then
    turboCoefs = engine.turbocharger.getTorqueCoefs()
  elseif fiType == "supercharger" and engine.supercharger and engine.supercharger.getTorqueCoefs then
    turboCoefs = engine.supercharger.getTorqueCoefs()
  end

  -- RPM points spread across the engine's actual usable band. The old
  -- fixed {2000..7000} list overran maxRPM on short-revving engines (the
  -- coef lookup fell off the table and silently used 1.0 = NA torque,
  -- overshooting the safe boost at the top point).
  local maxEngRPM = engine.maxRPM or 7000
  local loRPM = 1500
  local hiRPM = math.max(loRPM + 500, maxEngRPM - 300)
  local rpmPoints = {}
  for i = 0, 5 do
    rpmPoints[i + 1] = math.floor((loRPM + (hiRPM - loRPM) * i / 5) / 100 + 0.5) * 100
  end
  boostTable = {}

  local refBoost2 = getTurboRefPSI()
  if refBoost2 <= 0 then
    refBoost2 = stockBoostMax > 0 and stockBoostMax
      or (electrics.values.turboBoostMax or electrics.values.boostMax or 0)
  end

  -- Exact inversion of BeamNG's linear-in-pressure torque model:
  --   torque = base * (1 + K·eff(rpm) * psi)  →  safePSI = (limit/base - 1)/(K·eff)
  -- using the efficiency curve straight from the turbo jbeam. The coef
  -- table CANNOT be used for the slope: at spool-limited RPM it bakes in
  -- the spool pressure rather than the wastegate reference, under-reading
  -- the slope and overshooting the safe boost in the midband.
  -- Then a 95% safety margin, clamp to a sane range, round to 0.5 PSI.
  for i, rpmVal in ipairs(rpmPoints) do
    local baseTorque = getBaseTorque(rpmVal)

    local slope
    if turboModel then
      slope = K_PSI * effAtRPM(rpmVal)
    else
      local coef = turboCoefs[rpmVal + 1] or turboCoefs[rpmVal] or 1
      slope = refBoost2 > 0 and (coef - 1) / refBoost2 or 0
    end

    local safePSI = 0
    if baseTorque > 1 and slope > 1e-6 and baseTorque < torqueLimit then
      safePSI = (torqueLimit / baseTorque - 1) / slope
    end

    safePSI = math.max(0, math.min(safePSI * 0.95, 50))
    safePSI = math.floor(safePSI * 2) / 2

    boostTable[i] = {rpmVal, safePSI}

    log("D", "fueltechBoost",
      string.format("AutoMax @ %d rpm: baseTq=%.0fNm slope=%.4f/psi limit=%.0fNm -> safePSI=%.1f (proj %.0fNm)",
        rpmVal, baseTorque, slope, torqueLimit, safePSI, baseTorque * (1 + slope * safePSI)))
  end

  currentPreset = "AUTOMAX"
  log("I", "fueltechBoost", string.format("Applied Auto Max preset (torque limit: %d Nm, ref boost: %.1f PSI)", torqueLimit, refBoost2))
  markBoostMapDirty()
  getBoostTable()
  sendPowerCurves()
end

M.init = init
M.reset = reset
M.updateGFX = nop
M.setPoint = setPoint
M.getBoostTable = getBoostTable
M.sendPowerCurves = sendPowerCurves
M.setPreset = setPreset
M.autoMax = autoMax
M.toggleBoostByGear = toggleBoostByGear
M.toggleAntiLag = toggleAntiLag
M.setGearMultiplier = setGearMultiplier
M.getBoostByGearInfo = getBoostByGearInfo
M.saveProfile = saveProfile
M.loadProfile = loadProfile
M.deleteProfile = deleteProfile
M.getProfileList = getProfileList

-- Debug / external-tooling state dump (returns a JSON string; also handy
-- for the pause-menu card and MCP-driven verification).
M.dumpState = function()
  local proj = {}
  for i = 1, #boostTable do
    local rpmVal, psi = boostTable[i][1], boostTable[i][2]
    proj[i] = {
      rpm = rpmVal, psi = psi,
      projNm = math.floor(projTorqueExact(rpmVal, psi, getBaseTorque(rpmVal)) + 0.5),
      spoolPSI = turboModel and math.floor(spoolLimitPSI(rpmVal) * 10 + 0.5) / 10 or -1,
    }
  end
  return jsonEncode({
    preset = currentPreset,
    fiType = fiType,
    refPSI = turboModel and turboModel.refPSI or -1,
    torqueLimit = engine and engine.maxTorqueRating or -1,
    points = proj,
  })
end

return M
