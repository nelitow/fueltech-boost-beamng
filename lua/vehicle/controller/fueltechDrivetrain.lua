-- FuelTech Drivetrain Controller
-- Scans powertrain for switchable differentials, range boxes, transfer cases
-- Also detects ESC, TCS, and drive mode controllers
-- Publishes current modes to UI via electrics values

local M = {}
M.type = "auxiliary"

local features = {}
local driveModes = {}
local scanned = false
local scanTimer = 0

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

  for _, cc in ipairs(ctrlChecks) do
    local ok3, ctrl = pcall(controller.getController, cc.name)
    if ok3 and ctrl then
      table.insert(driveModes, {
        name = cc.name,
        label = cc.label,
        electricsKey = cc.electricsKey,
        active = true
      })
    end
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
end

local function toggleFeature(featureName)
  local ok, err = pcall(powertrain.toggleDeviceMode, featureName)
  if not ok then
    log("W", "fueltechDT", "Failed to toggle " .. tostring(featureName) .. ": " .. tostring(err))
  end
end

local function toggleDriveMode(modeName)
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
end

local function reset()
  scanned = false
  scanTimer = 0
end

M.init = init
M.reset = reset
M.updateGFX = updateGFX
M.toggleFeature = toggleFeature
M.toggleDriveMode = toggleDriveMode
M.getInfo = getInfo

return M
