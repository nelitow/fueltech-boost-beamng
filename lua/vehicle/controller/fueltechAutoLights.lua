-- FuelTech Auto Lights Controller
-- Forces low-beam headlights and fog lights on by default, every time the
-- vehicle loads or resets. Previous versions tried to track day/night and
-- only light up after dusk — dropped in favor of "just always on", which
-- is what was actually being asked for and needs no GE-side polling.

local M = {}
M.type = "auxiliary"

-- controller.loadControllerExternal unconditionally calls c.init(data);
-- without an init() the load pcall throws ("attempt to call field 'init'"),
-- the controller never registers, and the GE extension retries the
-- attach forever — spamming 'Can't load controller' into the log for
-- every vehicle (the v8.4.0 bug).
local function applyDefaultLights()
  electrics.setLightsState(1)   -- 0=off, 1=low beam, 2=high beam
  electrics.set_fog_lights(true)
end

local function init(jbeamData)
  applyDefaultLights()
end

local function reset()
  applyDefaultLights()
end

M.init = init
M.reset = reset

return M
