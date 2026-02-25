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

-- RPM/boost table: sorted pairs of {rpm, boostPSI}
local boostTable = {}

local function lerp(a, b, t)
  return a + (b - a) * t
end

-- Linear interpolation of boost target from RPM table
local function getTargetBoost(rpm)
  if #boostTable == 0 then return baseWastegate end

  -- Below first breakpoint: use first value
  if rpm <= boostTable[1][1] then
    return boostTable[1][2]
  end

  -- Above last breakpoint: use last value
  if rpm >= boostTable[#boostTable][1] then
    return boostTable[#boostTable][2]
  end

  -- Find surrounding breakpoints and interpolate
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

  -- setWastegateOffset takes PSI offset from zero
  -- To achieve our target, we offset by: -baseWastegate + targetPSI
  -- This cancels the stock wastegate and replaces it with our target
  engine.turbocharger.setWastegateOffset(-baseWastegate + targetPSI)

  -- Expose values to electrics for UI
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

  -- Read turbocharger data from vehicle jbeam to get the base wastegate value
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

  -- Check if the engine actually has a turbocharger
  if engine.turbocharger and engine.turbocharger.isExisting then
    hasTurbo = true
  else
    log("W", "fueltechBoost", "No turbocharger detected, boost controller disabled")
    hasTurbo = false
    enabled = false
    return
  end

  -- Read enable flag
  enabled = (jbeamData.enabled or 1) >= 1

  -- Build the RPM/boost table from jbeamData
  boostTable = {}
  local numPoints = 6
  for i = 1, numPoints do
    local rpm = jbeamData["rpm" .. i]
    local boost = jbeamData["boost" .. i]
    if rpm and boost then
      table.insert(boostTable, {rpm, boost})
    end
  end

  -- Sort table by RPM ascending
  table.sort(boostTable, function(a, b) return a[1] < b[1] end)

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

-- Called from UI to update a single breakpoint
local function setPoint(index, rpmVal, psiVal)
  if index >= 1 and index <= #boostTable then
    boostTable[index][1] = rpmVal
    boostTable[index][2] = psiVal
    table.sort(boostTable, function(a, b) return a[1] < b[1] end)
  end
end

-- Called from UI to get the current table (serialized as JSON-friendly)
local function getBoostTable()
  local result = {}
  for i = 1, #boostTable do
    result[i] = { rpm = boostTable[i][1], psi = boostTable[i][2] }
  end
  guihooks.trigger("fueltechBoostTable", result)
end

-- Send projected torque/power curves to the UI based on current boost map
local function sendPowerCurves()
  if not engine or not hasTurbo then return end

  local psiToPascal = 6894.757293178
  local avToRPM = 9.5493

  -- Get the turbo's torque coefficient function (maps RPM to boost multiplier)
  local turboCoefs = {}
  if engine.turbocharger.getTorqueCoefs then
    turboCoefs = engine.turbocharger.getTorqueCoefs()
  end

  -- Build curves: sample every 250 RPM
  local torqueCurve = {}
  local powerCurve = {}
  local baseTorqueCurve = {}
  local basePowerCurve = {}
  local maxEngRPM = engine.maxRPM or 7000
  local idx = 0

  for rpmVal = 500, maxEngRPM, 250 do
    -- Base torque (without any forced induction modification from our map)
    local baseTorque = 0
    if engine.torqueCurve and engine.torqueCurve[rpmVal] then
      baseTorque = engine.torqueCurve[rpmVal]
    end

    -- Stock turbo coef at this RPM
    local stockCoef = turboCoefs[rpmVal + 1] or 1

    -- Base torque with stock turbo
    local stockTorque = baseTorque * stockCoef

    -- Our boost target at this RPM
    local ourBoostPSI = getTargetBoost(rpmVal)
    -- Stock boost is roughly baseWastegate
    local stockBoostPSI = baseWastegate

    -- Approximate: each PSI adds ~6% power (from turbocharger.lua: 1 + 0.0000087 * pascals * efficiency)
    -- The ratio of our coef to stock coef
    local boostRatio = 1
    if stockBoostPSI > 0 then
      boostRatio = ourBoostPSI / stockBoostPSI
    elseif ourBoostPSI > 0 then
      boostRatio = 1 + ourBoostPSI * 0.06
    end

    local projTorque = stockTorque * boostRatio
    local projPower = projTorque * rpmVal * 0.10471975 / 1000 -- kW
    local stockPower = stockTorque * rpmVal * 0.10471975 / 1000

    idx = idx + 1
    torqueCurve[idx] = { rpm = rpmVal, nm = math.floor(projTorque) }
    powerCurve[idx]  = { rpm = rpmVal, kw = math.floor(projPower) }
    baseTorqueCurve[idx] = { rpm = rpmVal, nm = math.floor(stockTorque) }
    basePowerCurve[idx]  = { rpm = rpmVal, kw = math.floor(stockPower) }
  end

  guihooks.trigger("fueltechPowerCurves", {
    torque = torqueCurve,
    power = powerCurve,
    baseTorque = baseTorqueCurve,
    basePower = basePowerCurve,
    maxRPM = maxEngRPM
  })
end

M.init = init
M.reset = reset
M.updateGFX = nop
M.setPoint = setPoint
M.getBoostTable = getBoostTable
M.sendPowerCurves = sendPowerCurves

return M