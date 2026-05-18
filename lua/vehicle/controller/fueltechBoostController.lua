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

-- Vehicle mass cache (recomputed once per second — see updateGFX)
local cachedMass = 0
local massUpdateTimer = 0

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

-- Preset boost maps
local presets = {}
local stockBoostMax = 0  -- saved from the turbo's boostMax at init

-- Atmospheric pressure (PSI) — used for the manifold-absolute-pressure (MAP)
-- model. Engine torque scales with absolute pressure, not gauge boost; at
-- 0 PSI gauge an engine still makes its NA torque from the ~14.7 PSI of
-- atmosphere it's breathing.
local ATM_PSI = 14.7

-- Project the torque an engine would make at a given gauge boost, given the
-- stock-with-OEM-boost torque and the OEM boost it was measured at.
--   torqueRatio = (atm + targetBoost) / (atm + stockBoost)
-- so projected torque = stockTorque * torqueRatio.
local function projectTorqueFromBoost(stockTorqueWithStockBoost, targetGaugePSI, stockGaugePSI)
  local stockMAP  = ATM_PSI + math.max(0, stockGaugePSI or 0)
  local targetMAP = ATM_PSI + math.max(0, targetGaugePSI or 0)
  if stockMAP <= 0 then return stockTorqueWithStockBoost end
  return stockTorqueWithStockBoost * (targetMAP / stockMAP)
end

-- Inverse of projectTorqueFromBoost: given a torque limit and the stock
-- torque/boost reference, what gauge PSI keeps us at exactly the limit?
--   targetMAP = (limit / stockTorque) * stockMAP
--   safeGaugePSI = targetMAP - atm
local function safeBoostForTorqueLimit(stockTorqueWithStockBoost, torqueLimit, stockGaugePSI)
  if stockTorqueWithStockBoost <= 0 then return 0 end
  local stockMAP = ATM_PSI + math.max(0, stockGaugePSI or 0)
  local targetMAP = (torqueLimit / stockTorqueWithStockBoost) * stockMAP
  return targetMAP - ATM_PSI
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

  -- Total vehicle mass (kg) — published for the dashboard top bar.
  -- Cached and refreshed once per second (mass only changes with damage,
  -- fuel burn, or part swaps — no need for per-frame work).
  massUpdateTimer = (massUpdateTimer or 0) + dt
  if cachedMass == 0 or massUpdateTimer > 1.0 then
    massUpdateTimer = 0
    local m = 0
    -- Try the official API first
    local ok, val = pcall(function() return obj:getTotalMass() end)
    if ok and type(val) == "number" and val > 0 then
      m = val
    elseif v and v.data and v.data.nodes then
      -- Fallback: sum node weights directly (works on every build)
      for _, node in pairs(v.data.nodes) do
        m = m + (node.nodeWeight or 0)
      end
    end
    cachedMass = m
  end
  electrics.values.fueltech_mass = cachedMass

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

  -- Closed-loop PI controller
  if currentRPM > 1500 and targetPSI > 0 then
    local err = targetPSI - actualBoost
    integralError = integralError + err * dt * KI
    integralError = math.max(-IMAX, math.min(integralError, IMAX))
    boostOffset = err * KP + integralError
  else
    integralError = 0
    boostOffset = -10
  end

  -- ALS wastegate override: keep wastegate from dumping when ALS fires
  if alsWastagateOverride then
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
    log("I", "fueltechBoost", "Using turbocharger (setWastegateOffset)")
  elseif hasSCReal and engine.supercharger.setBypassPressure then
    fiType = "supercharger"
    hasFI = true
    stockBoostMax = electrics.values.turboBoostMax or electrics.values.boostMax or 0
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

  -- Use actual stock boost max for ratio calculations
  local refBoost = stockBoostMax
  if refBoost <= 0 then refBoost = electrics.values.turboBoostMax or electrics.values.boostMax or 0 end

  for rpmVal = 500, maxEngRPM, 250 do
    local baseTorque = getBaseTorque(rpmVal)
    local stockCoef = turboCoefs[rpmVal] or 1
    local stockTorque = baseTorque * stockCoef
    local ourBoostPSI = getTargetBoost(rpmVal)

    -- MAP-based torque projection. The OEM stock torque curve already
    -- bakes in the stock boost (refBoost), so we scale by the ratio of
    -- target manifold pressure to stock manifold pressure — both absolute,
    -- not gauge. At 0 gauge boost this correctly returns NA torque (not 0).
    local projTorque = projectTorqueFromBoost(stockTorque, ourBoostPSI, refBoost)
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
    local sv = stockBoostMax > 0 and stockBoostMax or (electrics.values.turboBoostMax or electrics.values.boostMax or 0)
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
local function autoMax()
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

  local rpmPoints = {2000, 3000, 4000, 5000, 6000, 7000}
  boostTable = {}

  local refBoost2 = stockBoostMax
  if refBoost2 <= 0 then refBoost2 = electrics.values.turboBoostMax or electrics.values.boostMax or 0 end

  -- Per-RPM math, MAP-based. Solve for the gauge PSI that puts projected
  -- torque exactly at torqueLimit, then apply a 95% safety margin and clamp.
  for i, rpmVal in ipairs(rpmPoints) do
    local baseTorque = getBaseTorque(rpmVal)
    local stockCoef = turboCoefs[rpmVal] or 1
    local stockTorque = baseTorque * stockCoef

    local safePSI = 0
    if stockTorque > 1 then
      safePSI = safeBoostForTorqueLimit(stockTorque, torqueLimit, refBoost2)
    end

    -- 95% safety margin, clamp to a sane range
    safePSI = math.max(0, math.min(safePSI * 0.95, 50))
    -- Round to nearest 0.5 PSI
    safePSI = math.floor(safePSI * 2) / 2

    boostTable[i] = {rpmVal, safePSI}

    -- Sanity-check log entry per RPM (visible in BeamNG console / log)
    log("D", "fueltechBoost",
      string.format("AutoMax @ %d rpm: stockTq=%.0fNm limit=%.0fNm refBoost=%.1f -> safePSI=%.1f",
        rpmVal, stockTorque, torqueLimit, refBoost2, safePSI))
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

return M
