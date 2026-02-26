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

-- Preset boost maps
local presets = {
  LOW    = {{2000, 4}, {3000, 6}, {4000, 8}, {5000, 10}, {6000, 8}, {7000, 6}},
  STREET = {{2000, 5}, {3000, 10}, {4000, 15}, {5000, 18}, {6000, 18}, {7000, 15}},
  SPORT  = {{2000, 8}, {3000, 14}, {4000, 22}, {5000, 26}, {6000, 26}, {7000, 22}},
  RACE   = {{2000, 10}, {3000, 18}, {4000, 28}, {5000, 35}, {6000, 35}, {7000, 30}},
}

local function lerp(a, b, t)
  return a + (b - a) * t
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
      local t = (rpm - rpmLow) / (rpmHigh - rpmLow)
      return lerp(boostTable[i][2], boostTable[i + 1][2], t)
    end
  end
  return baseWastegate
end

local function updateGFX(dt)
  if not enabled or not engine or not hasTurbo then
    electrics.values.fueltech_active = 0
    electrics.values.fueltech_targetBoost = 0
    return
  end

  local currentRPM = engine.outputRPM or 0
  local targetPSI = getTargetBoost(currentRPM)

  engine.turbocharger.setWastegateOffset(-baseWastegate + targetPSI)

  electrics.values.fueltech_targetBoost = targetPSI
  electrics.values.fueltech_currentBoost = electrics.values.turboBoost or 0
  electrics.values.fueltech_active = 1
  electrics.values.fueltech_currentRPM = currentRPM
end

local function init(jbeamData)
  local engineName = jbeamData.engineName or "mainEngine"
  engine = powertrain.getDevice(engineName)

  if not engine then
    log("W", "fueltechBoost", "No engine found, boost controller disabled")
    enabled = false
    return
  end

  local turboData = v.data[engineName] and v.data[engineName].turbocharger
  if turboData then
    local turboJbeam = v.data[turboData]
    if turboJbeam then
      if turboJbeam.wastegateLimit and type(turboJbeam.wastegateLimit) == "number" then
        baseWastegate = turboJbeam.wastegateLimit
      elseif turboJbeam.wastegateStart and type(turboJbeam.wastegateStart) == "number" then
        baseWastegate = turboJbeam.wastegateStart + 0.01
      end
    end
  end

  if engine.turbocharger and engine.turbocharger.isExisting then
    hasTurbo = true
  else
    log("W", "fueltechBoost", "No turbocharger detected, boost controller disabled")
    hasTurbo = false
    enabled = false
    return
  end

  enabled = (jbeamData.enabled or 1) >= 1

  boostTable = {}
  for i = 1, 6 do
    local rpm = jbeamData["rpm" .. i]
    local boost = jbeamData["boost" .. i]
    if rpm and boost then
      table.insert(boostTable, {rpm, boost})
    end
  end
  table.sort(boostTable, function(a, b) return a[1] < b[1] end)

  currentPreset = "CUSTOM"

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
  if engine and hasTurbo and engine.turbocharger then
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

local function sendPowerCurves()
  if not engine or not hasTurbo then return end

  local turboCoefs = {}
  if engine.turbocharger.getTorqueCoefs then
    turboCoefs = engine.turbocharger.getTorqueCoefs()
  end

  -- Get engine torque data for peak torque and damage limits
  local peakTorqueNm = 0
  local peakTorqueRPM = 0
  local peakPowerKw = 0
  local peakPowerRPM = 0
  local maxTorqueRating = -1  -- soft damage limit (-1 means no limit)

  if engine.getTorqueData then
    local td = engine:getTorqueData()
    if td then
      peakTorqueNm = td.maxTorque or 0
      peakTorqueRPM = td.maxTorqueRPM or 0
      peakPowerKw = td.maxPower or 0
      peakPowerRPM = td.maxPowerRPM or 0
    end
  end

  -- maxTorqueRating is the soft damage threshold from jbeam
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
    local baseTorque = 0
    if engine.torqueCurve and engine.torqueCurve[rpmVal] then
      baseTorque = engine.torqueCurve[rpmVal]
    end

    local stockCoef = turboCoefs[rpmVal + 1] or 1
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

    -- Track projected peaks
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
    -- Engine limits for the UI to display
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

M.init = init
M.reset = reset
M.updateGFX = nop
M.setPoint = setPoint
M.getBoostTable = getBoostTable
M.sendPowerCurves = sendPowerCurves
M.setPreset = setPreset

return M