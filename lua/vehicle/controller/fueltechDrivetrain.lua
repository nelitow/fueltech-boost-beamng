-- FuelTech Drivetrain Controller
-- Scans powertrain for switchable differentials, range boxes, and transfer cases
-- Publishes current modes to UI via electrics values

local M = {}
M.type = "auxiliary"

local features = {}
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

  -- Also check common device names directly
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

  log("I", "fueltechDT", "Drivetrain scan: " .. #features .. " switchable features found")

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

local function getInfo()
  scanDrivetrain()
end

local function init(jbeamData)
  scanned = false
  scanTimer = 0
  features = {}
end

local function reset()
  scanned = false
  scanTimer = 0
end

M.init = init
M.reset = reset
M.updateGFX = updateGFX
M.toggleFeature = toggleFeature
M.getInfo = getInfo

return M
