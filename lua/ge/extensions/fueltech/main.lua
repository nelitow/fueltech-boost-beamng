-- FuelTech Boost Controller — game-engine-side auto-attach
--
-- This GE extension hooks the vehicle-spawn lifecycle and injects the
-- boost + drivetrain controllers into every vehicle's lua VM. Replaces
-- the old "you must enable the part in Vehicle Config" workflow that
-- caused most of the early "doesn't show up" reviews.
--
-- The legacy `vehicles/common/fueltech_boost/fueltech_boost.jbeam` part
-- still ships, so users with existing saved configs that have the part
-- enabled keep working. The injection here is idempotent — it checks
-- whether the controller is already loaded before attaching.

local M = {}
M.dependencies = {}

-- The vehicle-side lua we queue per vehicle. Kept as a single string so
-- it gets shipped to the vehicle's VM in one round-trip. The vehicle's
-- own controller code handles all FI detection and configuration.
local INJECT_CMD = [[
  if controller and controller.getController then
    -- Boost controller: always attach, same as the drivetrain controller
    -- below. Its own init() (fueltechBoostController.lua) does the real FI
    -- detection and disables itself on NA cars — checking hasFI here too,
    -- from the GE side, raced the vehicle's own powertrain setup and could
    -- skip attaching even on turbo cars if this ran before the powertrain
    -- had built its devices.
    if not controller.getController('fueltechBoostController') then
      local ok, err = pcall(function()
        controller.loadControllerExternal('fueltechBoostController', 'fueltechBoostController', {})
      end)
      if not ok then
        log('W', 'fueltech.ge', 'failed to attach fueltechBoostController: ' .. tostring(err))
      end
    end
    -- Drivetrain controller: auto-detects diff/range/TCS/ABS, safe to
    -- attach to every vehicle (no-ops on cars without those features).
    if not controller.getController('fueltechDrivetrain') then
      local ok2, err2 = pcall(function()
        controller.loadControllerExternal('fueltechDrivetrain', 'fueltechDrivetrain', {})
      end)
      if not ok2 then
        log('W', 'fueltech.ge', 'failed to attach fueltechDrivetrain: ' .. tostring(err2))
      end
    end
    -- Auto lights: every vehicle has headlights, safe to attach to all.
    if not controller.getController('fueltechAutoLights') then
      local ok3, err3 = pcall(function()
        controller.loadControllerExternal('fueltechAutoLights', 'fueltechAutoLights', {})
      end)
      if not ok3 then
        log('W', 'fueltech.ge', 'failed to attach fueltechAutoLights: ' .. tostring(err3))
      end
    end
  end
]]

-- ── Auto headlights: day/night detection ──
-- Vehicle-side lua has no access to the environment/time-of-day — only the
-- GE side does — so this extension polls it and pushes a night/day flag
-- down to every vehicle's fueltechAutoLights controller.
local NIGHT_CHECK_INTERVAL = 1.0   -- seconds between checks
local DUSK_START = 0.77            -- time-of-day fraction (0-1) — night begins
local DAWN_END = 0.23               -- time-of-day fraction — night ends
local nightCheckTimer = 0

local function isTimeOfDayNight(t)
  if not t then return false end
  return t >= DUSK_START or t <= DAWN_END
end

local function pushNightState(vehicleId, isNight)
  if not vehicleId then return end
  local veh = scenetree.findObjectById(vehicleId)
  if not veh then return end
  veh:queueLuaCommand(
    "local c = controller.getControllerSafe('fueltechAutoLights') if c and c.setNight then c.setNight(" ..
    tostring(isNight) .. ") end"
  )
end

local function onUpdate(dtReal, dtSim, dtRaw)
  nightCheckTimer = nightCheckTimer + (dtReal or dtSim or 0)
  if nightCheckTimer < NIGHT_CHECK_INTERVAL then return end
  nightCheckTimer = 0

  if not core_environment or not core_environment.getTimeOfDay then return end
  local tod = core_environment.getTimeOfDay()
  local isNight = isTimeOfDayNight(tod and tod.time)

  if getAllVehicles then
    local vehs = getAllVehicles() or {}
    for _, veh in ipairs(vehs) do
      if veh and veh.getId then pushNightState(veh:getId(), isNight) end
    end
  end
end

local function attachToVehicle(vehicleId)
  if not vehicleId then return end
  local veh = scenetree.findObjectById(vehicleId)
  if not veh then return end
  veh:queueLuaCommand(INJECT_CMD)
end

-- ── BeamNG lifecycle hooks ──

-- Fired when ANY vehicle spawns (player car, AI traffic, replay, etc.).
local function onVehicleSpawned(vehicleId)
  attachToVehicle(vehicleId)
end

-- Fired when a vehicle is fully reset (Ctrl+R). The vehicle's lua VM
-- restarts, so we need to re-inject. The boost controller's autosave
-- profile (introduced in v7.2.3) restores the user's tuned map.
local function onVehicleResetted(vehicleId)
  attachToVehicle(vehicleId)
end

-- Fired when the user changes the active vehicle. The new VM is fresh.
local function onVehicleSwitched(_, newVehicleId)
  attachToVehicle(newVehicleId)
end

-- On extension load (game start, mod install, level change), sweep over
-- any vehicles already present and inject into them.
local function onExtensionLoaded()
  log('I', 'fueltech.ge', 'FuelTech GE extension loaded — auto-attaching to spawned vehicles')
  if getAllVehicles then
    local existing = getAllVehicles() or {}
    for _, veh in ipairs(existing) do
      if veh and veh.getId then attachToVehicle(veh:getId()) end
    end
  end
end

M.onVehicleSpawned  = onVehicleSpawned
M.onVehicleResetted = onVehicleResetted
M.onVehicleSwitched = onVehicleSwitched
M.onExtensionLoaded = onExtensionLoaded
M.onUpdate           = onUpdate

return M
