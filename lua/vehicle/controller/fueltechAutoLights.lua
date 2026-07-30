-- FuelTech Auto Lights Controller
-- Turns headlights on at night and off at dawn. Never fights a manual
-- toggle: only acts on state changes it caused itself.

local M = {}
M.type = "auxiliary"

local weTurnedOn = false
local lastKnownState = nil

-- Called from the GE-side fueltech extension once per day/night transition.
local function setNight(isNight)
  local state = electrics.values.lights_state or 0

  -- If the lights changed since we last looked and it wasn't us, the driver
  -- touched them manually — stop managing this vehicle's lights until the
  -- next transition re-syncs us.
  if lastKnownState ~= nil and state ~= lastKnownState then
    weTurnedOn = false
  end

  if isNight then
    if state == 0 then
      electrics.setLightsState(1)
      weTurnedOn = true
      state = 1
    end
  else
    if weTurnedOn and state == 1 then
      electrics.setLightsState(0)
      weTurnedOn = false
      state = 0
    end
  end

  lastKnownState = state
end

M.setNight = setNight

return M
