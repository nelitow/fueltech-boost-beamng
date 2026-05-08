-- BeamNG scans every installed mod for `scripts/*modScript.lua` files at
-- game start and executes them after the mod manager is ready. We use
-- this to load and pin our GE-side auto-attach extension — without this
-- bootstrap the extension would never be loaded (BeamNG does NOT auto-
-- discover and load files placed in `lua/ge/extensions/`).
--
-- See: lua/ge/extensions/core/modmanager.lua (`-- execute modScripts`)
-- in the BeamNG install for the discovery + load logic.

extensions.load('fueltech_main')
-- Belt-and-suspenders: when called from a modScript, extensions.load()
-- already wraps with setExtensionUnloadMode("manual") to keep the
-- extension loaded across level changes, but pinning explicitly costs
-- nothing and documents intent.
setExtensionUnloadMode('fueltech_main', 'manual')
