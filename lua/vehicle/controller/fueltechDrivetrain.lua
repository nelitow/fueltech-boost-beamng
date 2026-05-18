-- FuelTech Drivetrain Controller
-- Scans powertrain for switchable differentials, range boxes, transfer cases
-- Also detects ESC, TCS, and drive mode controllers
-- Includes custom TCS for vehicles without native traction control
-- Publishes current modes to UI via electrics values

local M = {}
M.type = "auxiliary"

local features = {}
local driveModes = {}
local scanned = false
local scanTimer = 0

-- Custom TCS state
local hasNativeTCS = false
local customTCSEnabled = false    -- user toggle — default OFF (user opt-in)
local customTCSIntervening = false
local tcsThrottleMul = 1.0

-- Custom TCS tuning
local TCS_SLIP_THRESHOLD = 0.10   -- 10% slip triggers intervention
local TCS_SLIP_FULL_CUT  = 0.35   -- at 35%+ slip, maximum cut applied
local TCS_MAX_CUT         = 0.85  -- max 85% throttle reduction
local TCS_CUT_RATE        = 10.0  -- how fast throttle cuts (per second)
local TCS_RECOVER_RATE    = 3.0   -- how fast throttle recovers (per second)
local TCS_MIN_SPEED       = 2.0   -- m/s — don't intervene below ~7 km/h

local function getLabel(name, devType)
  local n = string.lower(name or "")
  if devType == "range" then return "RANGE" end
  if string.find(n, "center") or string.find(n, "centre") or string.find(n, "transfer") then return "CTR" end
  if string.find(n, "front") then return "F.DIFF" end
  if string.find(n, "rear") then return "R.DIFF" end
  if devType == "diff" then return "DIFF" end
  return string.upper(string.sub(name or "DEV", 1, 5))
end

local function getModeLabel(modeName)
  if not modeName or type(modeName) ~= "string" then return "?" end
  local m = string.lower(modeName)
  if m == "open" then return "OPEN" end
  if m == "locked" or m == "lock" then return "LOCK" end
  if m == "viscous" then return "VISC" end
  if m == "lsd" then return "LSD" end
  if m == "high" or m == "hi" then return "HI" end
  if m == "low" or m == "lo" then return "LO" end
  if m == "connected" or m == "awd" or m == "4wd" then return "AWD" end
  if m == "disconnected" or m == "2wd" then return "2WD" end
  return string.upper(string.sub(modeName, 1, 4))
end

local function findModeIndex(modes, currentMode)
  if not modes or not currentMode then return 0 end
  if type(currentMode) == "number" then
    return math.max(0, currentMode - 1)
  end
  for i, m in ipairs(modes) do
    if m == currentMode then return i - 1 end
  end
  return 0
end

local function scanDrivetrain()
  features = {}
  driveModes = {}

  -- Scan powertrain devices (diffs, range boxes)
  local scanTypes = {
    {"diff", "differential"},
    {"range", "rangeBox"},
  }

  for _, st in ipairs(scanTypes) do
    local devType, scanType = st[1], st[2]
    local ok, devices = pcall(powertrain.getDevicesByType, scanType)
    if ok and devices then
      for _, dev in pairs(devices) do
        if dev and dev.name and dev.availableModes and type(dev.availableModes) == "table" and #dev.availableModes > 1 then
          local modeLabels = {}
          for i, m in ipairs(dev.availableModes) do
            modeLabels[i] = getModeLabel(m)
          end
          table.insert(features, {
            type = devType,
            name = dev.name,
            label = getLabel(dev.name, devType),
            modes = dev.availableModes,
            modeLabels = modeLabels,
            electricsName = "fueltech_dt_" .. dev.name
          })
        end
      end
    end
  end

  -- Check common device names directly
  local commonNames = {"rearDiff", "frontDiff", "centerDiff", "transferCase", "diff_R", "diff_F", "diff_C"}
  for _, name in ipairs(commonNames) do
    local ok2, dev = pcall(powertrain.getDevice, name)
    if ok2 and dev and dev.name then
      local found = false
      for _, f in ipairs(features) do
        if f.name == dev.name then found = true; break end
      end
      if not found and dev.availableModes and type(dev.availableModes) == "table" and #dev.availableModes > 1 then
        local modeLabels = {}
        for i, m in ipairs(dev.availableModes) do
          modeLabels[i] = getModeLabel(m)
        end
        table.insert(features, {
          type = "diff",
          name = dev.name,
          label = getLabel(dev.name, "diff"),
          modes = dev.availableModes,
          modeLabels = modeLabels,
          electricsName = "fueltech_dt_" .. dev.name
        })
      end
    end
  end

  -- Scan for drive mode controllers (ESC, TCS, etc.)
  local ctrlChecks = {
    {name = "esc", label = "ESC", electricsKey = "esc"},
    {name = "tcs", label = "TCS", electricsKey = "tcs"},
    {name = "absController", label = "ABS", electricsKey = "abs"},
  }

  hasNativeTCS = false
  for _, cc in ipairs(ctrlChecks) do
    local ok3, ctrl = pcall(controller.getController, cc.name)
    if ok3 and ctrl then
      table.insert(driveModes, {
        name = cc.name,
        label = cc.label,
        electricsKey = cc.electricsKey,
        active = true
      })
      if cc.name == "tcs" then hasNativeTCS = true end
    end
  end

  -- If no native TCS, register our custom TCS as a drive mode. Default OFF
  -- because users on cars without native TCS often want raw driving (drift,
  -- drag, etc.) — toggle on demand via the TC button in the control bar.
  if not hasNativeTCS then
    table.insert(driveModes, {
      name = "tcs",
      label = "TC",
      electricsKey = "tcs",
      active = false,
      custom = true
    })
    customTCSEnabled = false
    log("I", "fueltechDT", "No native TCS found — custom traction control registered (off by default)")
  end

  log("I", "fueltechDT", "Drivetrain scan: " .. #features .. " switchable features, " .. #driveModes .. " drive modes")

  -- Send all to UI
  local uiData = {}
  for i, f in ipairs(features) do
    uiData[i] = {
      type = f.type,
      name = f.name,
      label = f.label,
      modeLabels = f.modeLabels,
      electricsName = f.electricsName
    }
  end
  guihooks.trigger("fueltechDrivetrainInfo", uiData)

  local uiModes = {}
  for i, dm in ipairs(driveModes) do
    uiModes[i] = {
      name = dm.name,
      label = dm.label,
      electricsKey = dm.electricsKey
    }
  end
  guihooks.trigger("fueltechDriveModesInfo", uiModes)

  scanned = true
end

local function updateCustomTCS(dt)
  if hasNativeTCS or not customTCSEnabled then
    tcsThrottleMul = 1.0
    customTCSIntervening = false
    electrics.values.tcs = hasNativeTCS and (electrics.values.tcs or 0) or 0
    return
  end

  electrics.values.tcs = 1  -- report as active

  local vehSpeed = electrics.values.wheelspeed or 0  -- m/s

  -- Don't intervene at very low speed (parking, launch)
  if vehSpeed < TCS_MIN_SPEED then
    tcsThrottleMul = math.min(1.0, tcsThrottleMul + TCS_RECOVER_RATE * dt)
    customTCSIntervening = tcsThrottleMul < 0.99
    electrics.values.fueltech_tcs_cut = 1.0 - tcsThrottleMul
    return
  end

  -- Find maximum slip ratio across driven wheels
  local maxSlip = 0
  local wc = wheels and wheels.wheelCount or 0
  for i = 0, wc - 1 do
    local w = wheels.wheels[i]
    if w then
      -- A wheel is driven if it has propulsion torque applied
      local isDriven = w.isPropulsed or (w.propulsionTorque and math.abs(w.propulsionTorque) > 1)
      if isDriven then
        local wheelGroundSpeed = math.abs((w.angularVelocity or 0) * (w.radius or 0.3))
        local slip = (wheelGroundSpeed - vehSpeed) / math.max(vehSpeed, 0.5)
        if slip > maxSlip then maxSlip = slip end
      end
    end
  end

  -- Calculate target throttle multiplier based on slip
  if maxSlip > TCS_SLIP_THRESHOLD then
    local slipExcess = (maxSlip - TCS_SLIP_THRESHOLD) / (TCS_SLIP_FULL_CUT - TCS_SLIP_THRESHOLD)
    slipExcess = math.max(0, math.min(slipExcess, 1.0))
    local targetMul = 1.0 - slipExcess * TCS_MAX_CUT
    -- Quickly cut toward target
    if targetMul < tcsThrottleMul then
      tcsThrottleMul = math.max(targetMul, tcsThrottleMul - TCS_CUT_RATE * dt)
    else
      tcsThrottleMul = math.min(targetMul, tcsThrottleMul + TCS_RECOVER_RATE * dt)
    end
    customTCSIntervening = true
  else
    -- No slip — recover throttle smoothly
    tcsThrottleMul = math.min(1.0, tcsThrottleMul + TCS_RECOVER_RATE * dt)
    customTCSIntervening = tcsThrottleMul < 0.99
  end

  -- Clamp
  tcsThrottleMul = math.max(1.0 - TCS_MAX_CUT, math.min(tcsThrottleMul, 1.0))

  -- Apply throttle reduction
  local currentThrottle = electrics.values.throttle or 0
  if currentThrottle > 0 and tcsThrottleMul < 1.0 then
    electrics.values.throttle = currentThrottle * tcsThrottleMul
  end

  -- Publish cut amount for UI (0 = no cut, 1 = full cut)
  electrics.values.fueltech_tcs_cut = 1.0 - tcsThrottleMul
end

local function updateGFX(dt)
  if not scanned then
    scanTimer = scanTimer + dt
    if scanTimer >= 0.5 then
      scanDrivetrain()
    end
    return
  end

  -- Update drivetrain feature modes
  for _, f in ipairs(features) do
    local dev = powertrain.getDevice(f.name)
    if dev and dev.mode ~= nil then
      electrics.values[f.electricsName] = findModeIndex(f.modes, dev.mode)
    end
  end

  -- Custom TCS: monitor wheel slip and reduce throttle
  updateCustomTCS(dt)
end

local function toggleFeature(featureName)
  local ok, err = pcall(powertrain.toggleDeviceMode, featureName)
  if not ok then
    log("W", "fueltechDT", "Failed to toggle " .. tostring(featureName) .. ": " .. tostring(err))
  end
end

local function toggleDriveMode(modeName)
  -- Handle custom TCS toggle
  if modeName == "tcs" and not hasNativeTCS then
    customTCSEnabled = not customTCSEnabled
    if not customTCSEnabled then
      tcsThrottleMul = 1.0
      customTCSIntervening = false
      electrics.values.tcs = 0
      electrics.values.fueltech_tcs_cut = 0
    end
    log("I", "fueltechDT", "Custom TCS " .. (customTCSEnabled and "enabled" or "disabled"))
    return
  end

  local ok, ctrl = pcall(controller.getController, modeName)
  if ok and ctrl then
    if ctrl.toggleActive then
      ctrl.toggleActive()
    elseif ctrl.toggle then
      ctrl.toggle()
    elseif ctrl.setActive then
      -- Read current state and invert
      local key = nil
      for _, dm in ipairs(driveModes) do
        if dm.name == modeName then key = dm.electricsKey; break end
      end
      local current = key and (electrics.values[key] or 0) or 0
      ctrl.setActive(current == 0)
    else
      log("W", "fueltechDT", "No toggle method found for " .. modeName)
    end
  else
    log("W", "fueltechDT", "Controller not found: " .. tostring(modeName))
  end
end

local function getInfo()
  scanDrivetrain()
end

local function init(jbeamData)
  scanned = false
  scanTimer = 0
  features = {}
  driveModes = {}
  hasNativeTCS = false
  customTCSEnabled = false
  customTCSIntervening = false
  tcsThrottleMul = 1.0
end

local function reset()
  scanned = false
  scanTimer = 0
  tcsThrottleMul = 1.0
  customTCSIntervening = false
end

M.init = init
M.reset = reset
M.updateGFX = updateGFX
M.toggleFeature = toggleFeature
M.toggleDriveMode = toggleDriveMode
M.getInfo = getInfo

return M
