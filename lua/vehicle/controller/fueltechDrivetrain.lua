-- FuelTech Drivetrain Controller
-- Detects ESC, TCS, and ABS controllers for the dashboard's TC/ABS buttons.
-- Includes custom TCS for vehicles without native traction control.
-- Publishes current modes to UI via electrics values, and publishes vehicle
-- mass (works on every vehicle, unlike the boost controller which only
-- attaches to forced-induction cars).

local M = {}
M.type = "auxiliary"

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

-- Vehicle mass cache (refreshed at 1 Hz — mass only changes with damage,
-- fuel burn, or part swaps). Published from THIS controller (not the boost
-- controller) because this one attaches to every vehicle, so the WT readout
-- works on NA and EV cars too.
local cachedMass = 0
local massUpdateTimer = 0

local function publishMass(dt)
  massUpdateTimer = massUpdateTimer + dt
  if cachedMass == 0 or massUpdateTimer > 1.0 then
    massUpdateTimer = 0
    local m = 0
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
end

local function scanDrivetrain()
  driveModes = {}

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

  log("I", "fueltechDT", "Drivetrain scan: " .. #driveModes .. " drive modes")

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
  -- Mass publishes unconditionally — even before the drivetrain scan
  -- completes, and on vehicles with nothing switchable.
  publishMass(dt)

  if not scanned then
    scanTimer = scanTimer + dt
    if scanTimer >= 0.5 then
      scanDrivetrain()
    end
    return
  end

  -- Custom TCS: monitor wheel slip and reduce throttle
  updateCustomTCS(dt)
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
  cachedMass = 0        -- re-derive after reset (part swaps change mass)
  massUpdateTimer = 0
end

M.init = init
M.reset = reset
M.updateGFX = updateGFX
M.toggleDriveMode = toggleDriveMode
M.getInfo = getInfo

return M
