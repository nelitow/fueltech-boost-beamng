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
    -- Boost controller: only attach if vehicle has controllable FI
    if not controller.getController('fueltechBoostController') then
      local engine = powertrain.getDevice('mainEngine')
      local hasFI = engine and (
        (engine.turbocharger and engine.turbocharger.isExisting) or
        (engine.supercharger and engine.supercharger.isExisting)
      )
      if hasFI then
        local ok, err = pcall(function()
          controller.loadControllerExternal('fueltechBoostController', 'fueltechBoostController', {})
        end)
        if not ok then
          log('W', 'fueltech.ge', 'failed to attach fueltechBoostController: ' .. tostring(err))
        end
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
  end
]]

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

return M
