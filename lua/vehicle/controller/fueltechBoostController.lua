-- FuelTech Boost Controller
-- Boost-by-RPM controller inspired by FuelTech standalone ECUs
-- Controls boost pressure targets at different RPM breakpoints via wastegate offset

local M = {}
M.type = "auxiliary"
M.relevantDevice = "mainEngine"

local engine = nil
local enabled = false
local hasTurbo = false
local baseWastegate = 0
local currentPreset = "CUSTOM"

-- RPM/boost table: sorted pairs of {rpm, boostPSI}
local boostTable = {}

-- Boost-by-gear: multiplier per gear (1.0 = full boost)
local boostByGear = false
local gearMultipliers = {0.5, 0.65, 0.8, 1.0, 1.0, 1.0, 1.0, 1.0}

-- Saved profiles
local savedProfiles = {}
local profileDir = nil

-- Forward declarations
local loadProfiles
local sendProfileList

-- Preset boost maps
local presets = {
  MIN = {{2000, 4}, {3000, 6}, {4000, 8}, {5000, 10}, {6000, 8}, {7000, 6}},
  MAX = {{2000, 10}, {3000, 18}, {4000, 28}, {5000, 35}, {6000, 35}, {7000, 30}},
}

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

local function updateGFX(dt)
  if not enabled or not engine or not hasTurbo then
    electrics.values.fueltech_active = 0
    electrics.values.fueltech_targetBoost = 0
    boostOffset = 0
    integralError = 0
    return
  end

  if not engine.turbocharger or not engine.turbocharger.setWastegateOffset then
    electrics.values.fueltech_active = 0
    return
  end

  local currentRPM = engine.outputRPM or 0
  local targetPSI = getTargetBoost(currentRPM)

  -- Apply gear multiplier
  local gearMul = getGearMultiplier()
  targetPSI = targetPSI * gearMul

  -- Read the turbo's hardware max boost (from BeamNG's tuning slider)
  local turboMax = electrics.values.turboBoostMax or electrics.values.boostMax or 0

  -- Clamp target to turbo hardware max unless user explicitly set higher
  -- (turboMax of 0 means no limit / not available)
  if turboMax > 0 and targetPSI > turboMax then
    targetPSI = turboMax
  end

  local actualBoost = electrics.values.turboBoost or 0

  -- Publish turbo max for UI
  electrics.values.fueltech_boostMax = turboMax

  -- Closed-loop PI controller: adjust offset based on error between target and actual
  if currentRPM > 1500 and targetPSI > 0 then
    local err = targetPSI - actualBoost
    integralError = integralError + err * dt * KI
    integralError = math.max(-IMAX, math.min(integralError, IMAX))
    boostOffset = err * KP + integralError
  else
    -- Below boost threshold: reset controller, let turbo idle naturally
    integralError = 0
    boostOffset = -10  -- pull wastegate open to prevent boost at idle
  end

  engine.turbocharger.setWastegateOffset(boostOffset)

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

  if engine.turbocharger then
    hasTurbo = true
    if not engine.turbocharger.setWastegateOffset then
      log("W", "fueltechBoost", "Turbo found but setWastegateOffset not available")
    end
  else
    log("W", "fueltechBoost", "No turbocharger detected, boost controller disabled")
    hasTurbo = false
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

  -- If all boost values are 0 (e.g. saved config wiped the defaults), apply safe defaults
  if allZero and #boostTable > 0 then
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

  if enabled and hasTurbo then
    M.updateGFX = updateGFX
    log("I", "fueltechBoost", "FuelTech Boost Controller initialized with " .. #boostTable .. " breakpoints, base wastegate: " .. baseWastegate .. " PSI")
  end
end

local function reset()
  electrics.values.fueltech_active = 0
  electrics.values.fueltech_targetBoost = 0
  electrics.values.fueltech_currentBoost = 0
  electrics.values.fueltech_currentRPM = 0
  electrics.values.fueltech_gearMul = 1
  boostOffset = 0
  integralError = 0
  if engine and hasTurbo and engine.turbocharger and engine.turbocharger.setWastegateOffset then
    engine.turbocharger.setWastegateOffset(0)
  end
end

local function setPoint(index, rpmVal, psiVal)
  if index >= 1 and index <= #boostTable then
    boostTable[index][1] = rpmVal
    boostTable[index][2] = psiVal
    table.sort(boostTable, function(a, b) return a[1] < b[1] end)
    currentPreset = "CUSTOM"
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
  guihooks.trigger("fueltechBoostByGearInfo", {
    enabled = boostByGear,
    multipliers = gearMultipliers
  })
end

local function setGearMultiplier(gearIdx, mul)
  if gearIdx >= 1 and gearIdx <= 8 then
    gearMultipliers[gearIdx] = math.max(0, math.min(mul, 1.5))
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
    table.insert(names, name)
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
  if not engine or not hasTurbo or not engine.turbocharger then return end

  local turboCoefs = {}
  if engine.turbocharger.getTorqueCoefs then
    turboCoefs = engine.turbocharger.getTorqueCoefs()
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

  for rpmVal = 500, maxEngRPM, 250 do
    local baseTorque = getBaseTorque(rpmVal)
    local stockCoef = turboCoefs[rpmVal] or 1
    local stockTorque = baseTorque * stockCoef
    local ourBoostPSI = getTargetBoost(rpmVal)
    local stockBoostPSI = baseWastegate

    local boostRatio = 1
    if stockBoostPSI > 0 then
      boostRatio = ourBoostPSI / stockBoostPSI
    elseif ourBoostPSI > 0 then
      boostRatio = 1 + ourBoostPSI * 0.06
    end

    local projTorque = stockTorque * boostRatio
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
  if presets[name] then
    boostTable = {}
    for i, pt in ipairs(presets[name]) do
      boostTable[i] = {pt[1], pt[2]}
    end
    currentPreset = name
    log("I", "fueltechBoost", "Applied preset: " .. name)
    getBoostTable()
    sendPowerCurves()
  end
end

-- Auto Max: calculate maximum safe boost at each RPM keeping torque under the damage limit
local function autoMax()
  if not engine or not hasTurbo or not engine.turbocharger then return end

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
  if engine.turbocharger.getTorqueCoefs then
    turboCoefs = engine.turbocharger.getTorqueCoefs()
  end

  local rpmPoints = {2000, 3000, 4000, 5000, 6000, 7000}
  boostTable = {}

  for i, rpmVal in ipairs(rpmPoints) do
    local baseTorque = getBaseTorque(rpmVal)
    local stockCoef = turboCoefs[rpmVal] or 1
    local stockTorque = baseTorque * stockCoef

    local safePSI = 0
    if stockTorque > 1 then
      if baseWastegate > 0 then
        safePSI = (torqueLimit / stockTorque) * baseWastegate
      else
        safePSI = ((torqueLimit / stockTorque) - 1) / 0.06
      end
    end

    -- 95% safety margin, clamp to sane range
    safePSI = math.max(0, math.min(safePSI * 0.95, 50))
    -- Round to nearest 0.5 PSI
    safePSI = math.floor(safePSI * 2) / 2

    boostTable[i] = {rpmVal, safePSI}
  end

  currentPreset = "AUTOMAX"
  log("I", "fueltechBoost", "Applied Auto Max preset (limit: " .. torqueLimit .. " Nm)")
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
M.setGearMultiplier = setGearMultiplier
M.getBoostByGearInfo = getBoostByGearInfo
M.saveProfile = saveProfile
M.loadProfile = loadProfile
M.deleteProfile = deleteProfile
M.getProfileList = getProfileList

return M
