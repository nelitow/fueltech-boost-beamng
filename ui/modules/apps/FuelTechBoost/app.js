angular.module('beamng.apps')
.directive('fuelTechBoost', [function () {
  return {
    templateUrl: '/ui/modules/apps/FuelTechBoost/app.html',
    replace: true,
    restrict: 'EA',
    scope: true,
    link: function (scope, element) {
      var streamsList = ['electrics', 'engineInfo', 'wheelThermalData']
      StreamsManager.add(streamsList)
      // Force app widget to fill the game viewport
      var root = element[0]
      function forceFullscreen () {
        var vw = window.innerWidth, vh = window.innerHeight
        if (vw < 100 || vh < 100) return

        // Resize the widget container (parent of our app root)
        // BeamNG stores widget size in the parent's inline style
        var container = root.parentElement
        while (container && container !== document.body) {
          if (container.style && (container.style.width || container.style.height)) {
            container.style.width = vw + 'px'
            container.style.height = vh + 'px'
            container.style.left = '0px'
            container.style.top = '0px'
            container.style.right = ''
            container.style.bottom = ''
          }
          container = container.parentElement
        }

        // Also size our root element
        root.style.width = vw + 'px'
        root.style.height = vh + 'px'

        if (!lay || appW !== vw || appH !== vh) {
          lay = null
          doLayout(vw, vh)
          drawAll()
        }
      }
      var resizeObs = null
      try {
        resizeObs = new ResizeObserver(forceFullscreen)
        resizeObs.observe(document.body)
      } catch(e) {}
      window.addEventListener('resize', forceFullscreen)
      // Run immediately and periodically to catch late layout changes
      setTimeout(forceFullscreen, 100)
      setTimeout(forceFullscreen, 500)
      var fullscreenInterval = setInterval(forceFullscreen, 2000)

      scope.$on('$destroy', function () {
        StreamsManager.remove(streamsList)
        if (resizeObs) resizeObs.disconnect()
        window.removeEventListener('resize', forceFullscreen)
        if (fullscreenInterval) clearInterval(fullscreenInterval)
        if (initTimer) clearTimeout(initTimer)
        if (cvsMap) {
          cvsMap.removeEventListener('mousedown', onDown)
          cvsMap.removeEventListener('mousemove', onMove)
          cvsMap.removeEventListener('mouseup', onUp)
          cvsMap.removeEventListener('mouseleave', onUp)
          cvsMap.removeEventListener('touchstart', onTouchDown)
          cvsMap.removeEventListener('touchmove', onTouchMove)
          cvsMap.removeEventListener('touchend', onUp)
          cvsMap.removeEventListener('touchcancel', onUp)
        }
      })

      /* ==================== STATE ==================== */
      var rpm = 0, boost = 0, tgt = 0, speed = 0
      var oilT = 0, h2oT = 0, throttle = 0, turboRpm = 0
      var maxRPM = 8000, maxPSI = 40, peakBoost = 0, boostMax = 0
      var peakRPM = 0
      var gForceX = 0, gForceY = 0
      var gear = 0
      var engineLoad = 0, fuelVol = 0, fuelCap = 0, exhFlow = 0
      var clutchPos = 0, altitude = 0, odometer = 0, vehMass = 0
      var cel = false, lowFuel = false

      // Feature detection: auto-hide gauges that never receive data
      var hasTurbo = false, hasTurboRpm = false
      var detectFrames = 0, detectDone = false

      scope.hasTurbo = false
      scope.active = false; scope.overboost = false
      scope.rpmStr = '0'; scope.boostStr = '0.0'; scope.tgtStr = '0.0'; scope.peakStr = '0.0'
      scope.peakRpmStr = '0'
      scope.speedStr = '0'; scope.gearStr = 'N'; scope.gearModeStr = ''
      scope.preset = 'CUSTOM'
      scope.dtFeatures = []
      scope.dmodes = []
      scope.forceOB = false
      scope.hasTCS = false
      scope.tcsActive = true
      scope.tcsCut = 0  // 0-1, how much throttle is being cut
      scope.hasABS = false
      scope.absActive = true
      scope.absInterfering = false

      // Anti-lag system
      scope.alsActive = false
      scope.alsFiring = false
      scope.loadStr = '0'; scope.fuelStr = '0'; scope.exhFlowStr = '0.0'
      scope.clutchStr = '0'; scope.altStr = '0'; scope.odoStr = '0.0'
      scope.weightStr = '0'
      scope.cel = false; scope.lowFuel = false
      scope.brakeTemps = []
      scope.damageLog = []

      // TUNE overlay — on-demand boost map + power curve. Hidden by default
      // so the dashboard's middle stays clear; opened via the TUNE button.
      // Position is user-draggable: tuneOffsetX/Y are added to the centered
      // base position (so 0,0 = centered, default first-open behavior).
      scope.tuneOpen = false
      var tuneOffsetX = 0, tuneOffsetY = 0
      var tuneDrag = null  // {startX, startY, baseX, baseY} while dragging

      // Shift light
      scope.shiftLight = false
      var shiftRpmPct = 0.9

      // Warnings
      scope.warnings = []

      // Drag timer
      scope.drag100str = '--.---'
      scope.drag200str = '--.---'
      scope.drag100done = false
      scope.drag200done = false
      var dragActive = false, dragStart = 0, drag100t = 0, drag200t = 0

      // Turbo cooldown timer
      scope.turboTimerActive = false
      scope.turboTimerStr = '0'
      var turboTimerStart = 0, turboTimerDuration = 30

      var map = [[2000,5],[3000,10],[4000,15],[5000,20],[6000,20],[7000,18]]
      var pwrData = null

      // Stock torque/power curves from BeamNG's mainController (authoritative source)
      var stockTorqueArr = null  // array indexed by RPM: stockTorqueArr[rpm] = torque in Nm
      var stockPowerArr = null   // array indexed by RPM: stockPowerArr[rpm] = power in kW
      var stockMaxRPM = 0
      var stockCurveName = ''

      scope.$on('fueltechBoostTable', function (_, d) {
        if (d && d.length) { map = []; for (var i = 0; i < d.length; i++) map.push([d[i].rpm, d[i].psi]) }
      })
      scope.$on('fueltechPowerCurves', function (_, d) { if (d) { pwrData = d; drawPower() } })

      // Listen for BeamNG's native torque curve data (same source as default power app)
      scope.$on('TorqueCurveChanged', function (_, data) {
        if (!data || !data.curves) return
        stockMaxRPM = data.maxRPM || 7000
        // Find the last curve (highest index = with forced induction if present)
        var lastKey = null
        for (var key in data.curves) {
          if (lastKey === null || parseInt(key) > parseInt(lastKey)) lastKey = key
        }
        if (lastKey !== null && data.curves[lastKey]) {
          stockTorqueArr = data.curves[lastKey].torque  // raw Nm array indexed by RPM
          stockPowerArr = data.curves[lastKey].power     // raw kW array indexed by RPM
          stockCurveName = data.curves[lastKey].name || ''
        }
        // Rebuild power graph with authoritative data
        if (stockTorqueArr) drawPower()
      })

      scope.$on('fueltechDrivetrainInfo', function (_, data) {
        if (!data || !data.length) return
        scope.$evalAsync(function () {
          scope.dtFeatures = []
          for (var i = 0; i < data.length; i++) {
            scope.dtFeatures.push({
              type: data[i].type,
              name: data[i].name,
              label: data[i].label,
              modeLabels: data[i].modeLabels || [],
              electricsName: data[i].electricsName,
              modeIndex: 0,
              modeLabel: (data[i].modeLabels || [])[0] || '?',
              active: false
            })
          }
        })
      })

      scope.$on('fueltechDriveModesInfo', function (_, data) {
        if (!data || !data.length) return
        scope.$evalAsync(function () {
          scope.dmodes = []
          for (var i = 0; i < data.length; i++) {
            scope.dmodes.push({
              name: data[i].name,
              label: data[i].label,
              electricsKey: data[i].electricsKey,
              active: true
            })
            // Detect TCS/ABS availability for dedicated buttons
            if (data[i].name === 'tcs') scope.hasTCS = true
            if (data[i].name === 'absController') scope.hasABS = true
          }
        })
      })

      // Boost-by-gear data
      scope.$on('fueltechBoostByGearInfo', function (_, d) {
        if (d) {
          scope.$evalAsync(function () {
            scope.boostByGear = d.enabled
            scope.gearMultipliers = d.multipliers || []
          })
        }
      })

      // Damage tracking — friendly labels for BeamNG damage keys
      var damageLabels = {
        // Engine
        'engine.oilStarvation': 'OIL STARVE', 'engine.coolantHot': 'COOLANT HOT',
        'engine.oilHot': 'OIL HOT', 'engine.pistonRingsDamaged': 'PISTON RINGS',
        'engine.rodBearingsDamaged': 'ROD BEARINGS', 'engine.headGasketDamaged': 'HEAD GASKET',
        'engine.turbochargerHot': 'TURBO HOT', 'engine.engineReducedTorque': 'REDUCED POWER',
        'engine.mildOverrevDamage': 'OVERREV', 'engine.catastrophicOverrevDamage': 'OVERREV CRITICAL',
        'engine.engineDisabled': 'ENGINE DEAD', 'engine.blockMelted': 'BLOCK MELTED',
        'engine.engineLockedUp': 'ENGINE LOCKED', 'engine.radiatorLeak': 'RAD LEAK',
        'engine.oilpanLeak': 'OIL PAN LEAK', 'engine.engineHydrolocked': 'HYDROLOCKED',
        'engine.oilRadiatorLeak': 'OIL COOLER LEAK',
        'engine.fuelLeak': 'FUEL LEAK', 'engine.exhaustLeak': 'EXHAUST LEAK',
        'engine.transmissionDamage': 'TRANS DMG',
        // Body panels (FL/FR/ML/MR/RL/RR — front/mid/rear, left/right)
        'body.FL': 'BODY FRONT-L', 'body.FR': 'BODY FRONT-R',
        'body.ML': 'BODY MID-L',   'body.MR': 'BODY MID-R',
        'body.RL': 'BODY REAR-L',  'body.RR': 'BODY REAR-R',
        'body.F':  'BODY FRONT',   'body.R':  'BODY REAR',
        'body.M':  'BODY MID',     'body.L':  'BODY LEFT',
        'body.RT': 'BODY RIGHT',
        'body.hood': 'HOOD', 'body.trunk': 'TRUNK', 'body.roof': 'ROOF',
        'body.windshield': 'WINDSHIELD', 'body.bumperF': 'FRONT BUMPER',
        'body.bumperR': 'REAR BUMPER',
        // Wheels
        'wheels.brakeOverHeatFL': 'BRK OVERHEAT FL', 'wheels.brakeOverHeatFR': 'BRK OVERHEAT FR',
        'wheels.brakeOverHeatRL': 'BRK OVERHEAT RL', 'wheels.brakeOverHeatRR': 'BRK OVERHEAT RR',
        'wheels.tireFL': 'TIRE DMG FL', 'wheels.tireFR': 'TIRE DMG FR',
        'wheels.tireRL': 'TIRE DMG RL', 'wheels.tireRR': 'TIRE DMG RR',
        'wheels.brakeFL': 'BRK DMG FL', 'wheels.brakeFR': 'BRK DMG FR',
        'wheels.brakeRL': 'BRK DMG RL', 'wheels.brakeRR': 'BRK DMG RR',
        // Powertrain
        'powertrain.mainEngine': 'ENGINE DMG', 'powertrain.driveshaft': 'DRIVESHAFT',
        'powertrain.gearbox': 'GEARBOX', 'powertrain.transfercase': 'TRANSFER CASE',
        'powertrain.differential_F': 'DIFF FRONT', 'powertrain.differential_R': 'DIFF REAR',
        'powertrain.wheelaxleFL': 'AXLE FL', 'powertrain.wheelaxleFR': 'AXLE FR',
        'powertrain.wheelaxleRL': 'AXLE RL', 'powertrain.wheelaxleRR': 'AXLE RR'
      }

      // Last-resort prettifier for keys not in the dictionary above —
      // turns 'engine.somethingBroken' into 'SOMETHING BROKEN' instead of
      // shouting the raw camelCase identifier.
      function prettifyDamageKey (key) {
        var leaf = key.indexOf('.') >= 0 ? key.substring(key.lastIndexOf('.') + 1) : key
        // Insert space before each capital letter, then uppercase the result
        var spaced = leaf.replace(/([A-Z])/g, ' $1').replace(/^\s+/, '')
        return spaced.toUpperCase()
      }

      scope.$on('DamageData', function (_, data) {
        if (!data) return
        scope.$evalAsync(function () {
          var log = []
          function scan(obj, prefix) {
            if (!obj || typeof obj !== 'object') return
            for (var k in obj) {
              var key = prefix ? prefix + '.' + k : k
              var v = obj[k]
              if (typeof v === 'object' && v !== null) {
                scan(v, key)
              } else if (v && v !== 0 && v !== false) {
                var label = damageLabels[key] || prettifyDamageKey(key)
                var color = '#ff6600'
                var vs = String(v).toLowerCase()
                if (vs === 'true' || vs === '1') color = '#ff4466'
                else if (typeof v === 'number' && v > 50) color = '#ff2244'
                else if (typeof v === 'number' && v > 20) color = '#ff6600'
                else color = '#ffcc00'
                log.push({text: label, color: color})
              }
            }
          }
          scan(data, '')
          scope.damageLog = log
        })
      })

      function requestData () {
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").getBoostTable()') } catch (e) {}
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").sendPowerCurves()') } catch (e) {}
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechDrivetrain").getInfo()') } catch (e) {}
        // Request BeamNG's native torque curve data (same as default power app)
        try { bngApi.activeObjectLua('controller.mainController.sendTorqueData()') } catch (e) {}
      }
      requestData()

      // Also request torque data on vehicle focus change
      scope.$on('VehicleFocusChanged', function () {
        stockTorqueArr = null; stockPowerArr = null
        try { bngApi.activeObjectLua('controller.mainController.sendTorqueData()') } catch (e) {}
        requestData()
      })

      scope.setPreset = function (n) {
        scope.preset = n
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").setPreset("'+n+'")') } catch(e){}
      }
      scope.resetPeak = function () { peakBoost = 0; scope.peakStr = '0.0' }
      scope.resetPeakRpm = function () { peakRPM = 0; scope.peakRpmStr = '0' }
      scope.toggleDt = function (f) {
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechDrivetrain").toggleFeature("' + f.name + '")') } catch(e) {}
      }
      scope.toggleDm = function (dm) {
        dm.active = !dm.active
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechDrivetrain").toggleDriveMode("' + dm.name + '")') } catch(e) {}
      }
      scope.toggleForceOB = function () {
        scope.forceOB = !scope.forceOB
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").toggleForceOverboost()') } catch(e) {}
      }
      // Debounce flags — prevent electrics sync from overwriting optimistic toggle for a few frames
      var tcToggleDebounce = 0, alsToggleDebounce = 0, absToggleDebounce = 0
      scope.toggleTC = function () {
        scope.tcsActive = !scope.tcsActive
        tcToggleDebounce = 10  // ignore electrics sync for 10 frames
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechDrivetrain").toggleDriveMode("tcs")') } catch(e) {}
      }
      scope.toggleALS = function () {
        scope.alsActive = !scope.alsActive
        alsToggleDebounce = 10
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").toggleAntiLag()') } catch(e) {}
      }
      scope.toggleABS = function () {
        scope.absActive = !scope.absActive
        absToggleDebounce = 10
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechDrivetrain").toggleDriveMode("absController")') } catch(e) {}
      }

      // Open/close the TUNE overlay (boost map + power curve). Forces a
      // relayout so doLayout can reposition the canvases and refresh sizes.
      scope.toggleTune = function () {
        scope.tuneOpen = !scope.tuneOpen
        lay = null
        if (appW && appH) doLayout(appW, appH)
        // Repaint graphs immediately when opening so the user doesn't see a blank panel
        if (scope.tuneOpen) {
          try { drawBoostMap(); drawPower() } catch(e) {}
        }
      }

      // ── TUNE panel drag handlers ──
      // The title bar is the drag handle. While dragging, we update
      // tuneOffsetX/Y and re-run doLayout each frame so the panel follows
      // the cursor (no separate transform — keeps the layout authoritative).
      scope.tuneDragStart = function (ev) {
        // Don't start a drag when the user is aiming for the × close button —
        // mousedown would begin dragging and the click would never register.
        var t = ev.target
        if (t && t.classList && t.classList.contains('ft-tune-close')) return
        ev.preventDefault()
        var pt = (ev.touches && ev.touches[0]) || ev
        tuneDrag = { startX: pt.clientX, startY: pt.clientY, baseX: tuneOffsetX, baseY: tuneOffsetY }
        // Use document-level listeners so dragging continues even if the
        // cursor leaves the title bar (or the panel) mid-drag.
        document.addEventListener('mousemove', tuneDragMove)
        document.addEventListener('mouseup',   tuneDragEnd)
        document.addEventListener('touchmove', tuneDragMove, {passive:false})
        document.addEventListener('touchend',  tuneDragEnd)
      }
      function tuneDragMove (ev) {
        if (!tuneDrag) return
        ev.preventDefault()
        var pt = (ev.touches && ev.touches[0]) || ev
        tuneOffsetX = tuneDrag.baseX + (pt.clientX - tuneDrag.startX)
        tuneOffsetY = tuneDrag.baseY + (pt.clientY - tuneDrag.startY)
        lay = null
        if (appW && appH) doLayout(appW, appH)
        try { drawBoostMap(); drawPower() } catch(e) {}
      }
      function tuneDragEnd () {
        tuneDrag = null
        document.removeEventListener('mousemove', tuneDragMove)
        document.removeEventListener('mouseup',   tuneDragEnd)
        document.removeEventListener('touchmove', tuneDragMove)
        document.removeEventListener('touchend',  tuneDragEnd)
      }

      // Drag timer
      scope.resetDrag = function () {
        dragActive = false; dragStart = 0; drag100t = 0; drag200t = 0
        scope.drag100str = '--.---'; scope.drag200str = '--.---'
        scope.drag100done = false; scope.drag200done = false
      }

      // Visibility hook for feature-detection: invalidate the cached layout
      // so doLayout re-runs with fresh hasTurbo / hasTurboRpm flags.
      function applyGraphVisibility () {
        lay = null
      }

      function cl (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }
      function lerpMap (r) {
        if (!map.length) return 0
        if (r <= map[0][0]) return map[0][1]
        if (r >= map[map.length-1][0]) return map[map.length-1][1]
        for (var i = 0; i < map.length-1; i++) {
          if (r >= map[i][0] && r <= map[i+1][0]) {
            var span = map[i+1][0] - map[i][0]
            if (span < 1) return map[i][1]
            var t = (r - map[i][0]) / span
            return map[i][1] + (map[i+1][1] - map[i][1]) * t
          }
        }
        return 0
      }

      /* ==================== LAYOUT ==================== */
      /*  Clear-view layout — gauges hug the edges, the middle is transparent
       *  so the player can see the car. ~66% width × ~70% height stays clear.
       *
       *  ┌─ HEADER ─────────────────────────────────────────┐  3.5%
       *  ├─ TELEM STRIP ────────────────────────────────────┤  2.8%
       *  │ RPM       │                              │ BOOST │
       *  │ GAUGE     │                              │       │  ~70%
       *  │ (cols 1-2)│   ── transparent center ──   │ (11-12)
       *  ├───────────┤      (see the car here)      ├───────┤
       *  │ SPEED     │                              │ TURBO │
       *  │ + GEAR    │                              │ RPM   │
       *  ├───────────┴──────────────────────────────┴───────┤
       *  │ OIL │ H2O │ THR │ G-FORCE │ DRAG TIMER           │  ~10%
       *  ├──────────────────────────────────────────────────┤
       *  │ [OFF][STOCK][MAX][AUTOMAX][CUSTOM][OB][ALS][TC]  │  3.5%
       *  └──────────────────────────────────────────────────┘
       *
       *  NA cars: right band hides Boost + Turbo RPM.
       *  Supercharger: right band shows Boost full-height (no Turbo RPM).
       */
      var GAP = 4
      var appW = 0, appH = 0
      var lay = null

      function q (sel) { return element[0].querySelector(sel) }

      var GRAPH_BG = 'background:rgba(6,8,14,0.6);border:1px solid rgba(24,28,40,0.3);border-radius:8px'

      function doLayout (W, H) {
        if (W < 100 || H < 100) return null
        if (lay && appW === W && appH === H) return lay
        appW = W; appH = H

        var root = element[0]
        root.style.cssText = 'position:relative;overflow:hidden;width:'+W+'px;height:'+H+'px;background:transparent'

        var G = GAP
        var usableW = W - G * 2

        // ── Layout philosophy ──
        // Hug the edges: gauges live in narrow LEFT and RIGHT bands (~17% each)
        // and in TOP and BOTTOM bands (header/telemetry up top, secondary row +
        // control bar at bottom). The middle ~66% × ~70% of the dashboard stays
        // transparent so the player can see the car.

        // ── Vertical zone heights ──
        var hdrH  = cl(Math.round(H * 0.035), 26, 40)
        var telH  = cl(Math.round(H * 0.028), 20, 32)
        var barH  = cl(Math.round(H * 0.035), 26, 36)
        var secH  = cl(Math.round(H * 0.10), 56, 100)

        var topY   = G
        var telY   = topY + hdrH + 2
        var barY   = H - barH - G                 // control bar at very bottom
        var secY   = barY - secH - G              // secondary row above control bar

        // Side bands sit between telemetry and secondary row
        var sideY  = telY + telH + G
        var sideH  = secY - sideY - G
        if (sideH < 80) sideH = 80                // safety floor for tiny windows

        // ── 12-column grid ──
        var colW = usableW / 12
        function cx (c) { return G + (c - 1) * colW }
        function cw2 (n) { return n * colW - G }

        function box (el, c, n, y, h, extra) {
          if (!el) return
          el.style.cssText = 'position:absolute;box-sizing:border-box;left:'+cx(c)+'px;top:'+y+'px;width:'+cw2(n)+'px;height:'+h+'px;overflow:hidden'
          if (extra) el.style.cssText += ';' + extra
        }

        // ── Header (top band) ──
        box(q('.ft-hdr'), 1, 12, topY, hdrH,
          'display:flex;align-items:center;gap:10px;background:rgba(10,12,20,0.82);border:1px solid rgba(40,46,66,0.5);border-radius:6px;padding:0 14px')

        // ── Telemetry strip (top band) ──
        box(q('.ft-telem'), 1, 12, telY, telH,
          'display:flex;align-items:center;gap:12px;padding:0 14px;background:rgba(10,12,20,0.6);border:1px solid rgba(40,46,66,0.3);border-radius:4px')

        // ── Warning bar (overlay just under telemetry) ──
        var warnEl = q('.ft-warn')
        if (warnEl) {
          warnEl.style.cssText = 'position:absolute;box-sizing:border-box;z-index:20;left:'+G+'px;top:'+sideY+'px;width:'+usableW+'px;height:'+cl(telH,14,24)+'px;overflow:hidden;display:flex;justify-content:center;align-items:center;gap:20px;padding:0 14px;background:rgba(255,34,68,0.15);border:1px solid rgba(255,34,68,0.4);border-radius:4px'
        }

        // ── Damage log (overlay below warning) ──
        var dmgEl = q('.ft-dmg')
        if (dmgEl) {
          dmgEl.style.cssText = 'position:absolute;box-sizing:border-box;z-index:19;left:'+G+'px;top:'+(sideY+cl(telH,14,24)+2)+'px;width:'+usableW+'px;max-height:'+(telH*2)+'px;overflow:hidden;display:flex;flex-wrap:wrap;gap:4px 10px;padding:2px 14px;background:rgba(10,12,20,0.6);border:1px solid rgba(40,46,66,0.3);border-radius:4px'
        }

        // ── Side gauges ──
        // LEFT band (cols 1-2): RPM (top ~62%) + Speed/Gear (bottom ~38%)
        // RIGHT band (cols 11-12): Boost (top) + Turbo RPM (bottom) — turbo only
        // Middle (cols 3-10) stays transparent → 66% horizontal clear zone
        var sideCols = 2
        var rpmH = Math.round(sideH * 0.62)
        var spdH = sideH - rpmH - G

        box(q('.ft-c-rpm'), 1, sideCols, sideY, rpmH)
        box(q('.ft-c-spd'), 1, sideCols, sideY + rpmH + G, spdH,
          'display:flex;flex-direction:column;align-items:center;justify-content:center')

        var bstH, trbH
        if (hasTurbo) {
          var bstEl = q('.ft-c-bst')
          var trbEl = q('.ft-c-trb')
          if (hasTurboRpm) {
            // Boost top 62%, Turbo RPM bottom 38% — right band
            bstH = Math.round(sideH * 0.62)
            trbH = sideH - bstH - G
            box(bstEl, 11, sideCols, sideY, bstH)
            box(trbEl, 11, sideCols, sideY + bstH + G, trbH)
          } else {
            // Supercharger: boost full height in right band
            bstH = sideH
            trbH = 0
            box(bstEl, 11, sideCols, sideY, sideH)
            if (trbEl) trbEl.style.display = 'none'
          }
        } else {
          bstH = 0; trbH = 0
          var bstEl2 = q('.ft-c-bst'); if (bstEl2) bstEl2.style.display = 'none'
          var trbEl2 = q('.ft-c-trb'); if (trbEl2) trbEl2.style.display = 'none'
        }

        // ── Secondary row (bottom band, just above control bar) ──
        // Oil + Water + Throttle + G-force + Drag timer
        box(q('.ft-c-oil'), 1, 3, secY, secH)
        box(q('.ft-c-h2o'), 4, 3, secY, secH)
        box(q('.ft-c-thr'), 7, 2, secY, secH)
        box(q('.ft-c-gforce'), 9, 2, secY, secH)
        box(q('.ft-c-drag'), 11, 2, secY, secH,
          'display:flex;flex-direction:column;justify-content:center;padding:4px;' + GRAPH_BG)

        // ── TUNE overlay (compact centered panel, on-demand) ──
        // Holds the interactive boost map + power curve. Only positioned
        // when scope.tuneOpen is true, so the dashboard middle stays clear
        // by default. Sized as a compact panel: 55% width × 45% height,
        // clamped to keep it readable on small/large dashboards.
        var tunePanel = q('.ft-tune-panel')
        var mapEl = q('.ft-c-map')
        var pwrEl = q('.ft-c-pwr')
        var tuneMapW = 0, tuneMapH = 0, tunePwrW = 0
        if (scope.tuneOpen && tunePanel) {
          var tuneW = cl(Math.round(W * 0.55), 420, 760)
          var tuneH = cl(Math.round(H * 0.45), 220, 380)
          // Centered base position + user drag offset. Clamp so the title
          // bar always stays grabbable inside the dashboard (at least 60px
          // of the panel on each axis must remain on-screen).
          var baseX = (W - tuneW) / 2
          var baseY = (H - tuneH) / 2
          var minX = -tuneW + 60, maxX = W - 60
          var minY = 0,            maxY = H - 30
          var tuneX = cl(baseX + tuneOffsetX, minX, maxX)
          var tuneY = cl(baseY + tuneOffsetY, minY, maxY)
          tunePanel.style.cssText = 'position:absolute;z-index:31;box-sizing:border-box;left:'+tuneX+'px;top:'+tuneY+'px;width:'+tuneW+'px;height:'+tuneH+'px;background:rgba(10,12,20,0.96);border:1px solid rgba(255,102,0,0.4);border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,0.6);padding:6px;overflow:hidden'

          // Inside the panel: title strip on top, then map (left) + pwr (right)
          var titleH = 22
          var pad = 6
          var inW = tuneW - pad * 2
          var inH = tuneH - titleH - pad
          var halfW = Math.floor(inW / 2) - 3
          tuneMapW = halfW; tuneMapH = inH
          tunePwrW = halfW
          var innerY = titleH
          if (mapEl) mapEl.style.cssText = 'position:absolute;box-sizing:border-box;left:'+pad+'px;top:'+innerY+'px;width:'+halfW+'px;height:'+inH+'px;overflow:hidden;' + GRAPH_BG
          if (pwrEl) pwrEl.style.cssText = 'position:absolute;box-sizing:border-box;left:'+(pad+halfW+6)+'px;top:'+innerY+'px;width:'+halfW+'px;height:'+inH+'px;overflow:hidden;' + GRAPH_BG
        } else {
          if (tunePanel) tunePanel.style.cssText = 'display:none'
          if (mapEl) mapEl.style.display = 'none'
          if (pwrEl) pwrEl.style.display = 'none'
        }

        // ── Control bar (very bottom) ──
        var barEl = q('.ft-bar')
        if (barEl) {
          barEl.style.cssText = 'position:absolute;box-sizing:border-box;left:'+G+'px;top:'+barY+'px;width:'+usableW+'px;height:'+barH+'px;display:flex;gap:3px;align-items:center'
        }

        // ── Turbo timer overlay (top-center, small — out of clear zone) ──
        var ttEl = q('.ft-turbo-timer')
        if (ttEl) {
          var ttW = cw2(4), ttH2 = Math.round(sideH * 0.28)
          ttEl.style.cssText = 'position:absolute;z-index:18;left:'+((W-ttW)/2)+'px;top:'+(sideY+G)+'px;width:'+ttW+'px;height:'+ttH2+'px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(10,12,20,0.85);border:1px solid rgba(255,102,0,0.3);border-radius:10px;pointer-events:none'
        }

        // ── Build lay object for canvas sizing ──
        var col2W = cw2(2), col3W = cw2(3), col6W = cw2(6)
        var sideW = cw2(sideCols)

        lay = {
          gaugeW: sideW, gaugeH: rpmH,
          bstW: sideW, bstH: bstH || sideH,
          trbW: sideW, trbH: trbH || sideH,
          oilW: col3W, oilH: secH,
          h2oW: col3W, h2oH: secH,
          thrW: col2W, thrH: secH,
          // Boost map + power curve get real sizes only when the TUNE panel
          // is open; otherwise they're hidden and never drawn.
          graphW: tuneMapW, graphH: tuneMapH,
          pwrW: tunePwrW,
          gfW: col2W, gfH: secH
        }
        return lay
      }

      /* ==================== CANVAS ==================== */
      var cvsRpm = null, ctxRpm = null
      var cvsMap = null, ctxMap = null
      var cvsBst = null, ctxBst = null
      var cvsPwr = null, ctxPwr = null
      var cvsOil = null, ctxOil = null
      var cvsH2o = null, ctxH2o = null
      var cvsThr = null, ctxThr = null
      var cvsTrb = null, ctxTrb = null
      var cvsGf = null, ctxGf = null
      var dpr = window.devicePixelRatio || 1

      function initCanvases () {
        if (!cvsRpm) { try { cvsRpm = q('.ft-cv-rpm'); if (cvsRpm) ctxRpm = cvsRpm.getContext('2d') } catch(e){} }
        if (!cvsBst || !cvsBst.parentNode) { cvsBst = null; ctxBst = null; try { cvsBst = q('.ft-cv-bst'); if (cvsBst) ctxBst = cvsBst.getContext('2d') } catch(e){} }
        if (!cvsOil) { try { cvsOil = q('.ft-cv-oil'); if (cvsOil) ctxOil = cvsOil.getContext('2d') } catch(e){} }
        if (!cvsH2o) { try { cvsH2o = q('.ft-cv-h2o'); if (cvsH2o) ctxH2o = cvsH2o.getContext('2d') } catch(e){} }
        if (!cvsThr) { try { cvsThr = q('.ft-cv-thr'); if (cvsThr) ctxThr = cvsThr.getContext('2d') } catch(e){} }
        if (!cvsTrb) { try { cvsTrb = q('.ft-cv-trb'); if (cvsTrb) ctxTrb = cvsTrb.getContext('2d') } catch(e){} }
        if (!cvsGf) { try { cvsGf = q('.ft-cv-gforce'); if (cvsGf) ctxGf = cvsGf.getContext('2d') } catch(e){} }
        if (!cvsMap) {
          try { cvsMap = q('.ft-cv-map'); if (cvsMap) { ctxMap = cvsMap.getContext('2d')
            cvsMap.addEventListener('mousedown', onDown); cvsMap.addEventListener('mousemove', onMove)
            cvsMap.addEventListener('mouseup', onUp); cvsMap.addEventListener('mouseleave', onUp)
            cvsMap.addEventListener('touchstart', onTouchDown, {passive:false})
            cvsMap.addEventListener('touchmove', onTouchMove, {passive:false})
            cvsMap.addEventListener('touchend', onUp); cvsMap.addEventListener('touchcancel', onUp)
          }} catch(e){}
        }
        if (!cvsPwr) { try { cvsPwr = q('.ft-cv-pwr'); if (cvsPwr) ctxPwr = cvsPwr.getContext('2d') } catch(e){} }
      }

      function sizeCvs (cvs, w, h) {
        w -= 2; h -= 2
        if (w < 10 || h < 10) return null
        cvs.width = Math.round(w * dpr)
        cvs.height = Math.round(h * dpr)
        cvs.style.cssText = 'position:absolute;top:0;left:0;width:'+w+'px;height:'+h+'px;display:block;border-radius:7px'
        return { w: w, h: h }
      }

      /* ==================== GAUGE (large — RPM/PSI) ==================== */
      function drawGauge (ctx, w, h, value, maxV, valTxt, unit, label, c1, c2, wPct) {
        ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h)
        var cx = w/2, cy = h*0.45, r = Math.min(w,h)*0.34, aw = Math.max(r*0.08,2.5)
        var sA = 0.75*Math.PI, eA = 2.25*Math.PI, sw = eA-sA, pct = cl(value/maxV,0,1), vA = sA+pct*sw

        ctx.beginPath(); ctx.arc(cx,cy,r+aw*2.2,sA,eA); ctx.strokeStyle='rgba(12,14,22,0.4)'; ctx.lineWidth=1; ctx.stroke()
        ctx.beginPath(); ctx.arc(cx,cy,r,sA,eA); ctx.strokeStyle='rgba(18,20,30,0.5)'; ctx.lineWidth=aw; ctx.lineCap='butt'; ctx.stroke()

        for (var i=0; i<=8; i++) {
          var a=sA+sw*i/8, mj=i%2===0, ln=mj?aw*1.8:aw*0.9
          ctx.beginPath()
          ctx.moveTo(cx+Math.cos(a)*(r-ln/2),cy+Math.sin(a)*(r-ln/2))
          ctx.lineTo(cx+Math.cos(a)*(r+ln/2),cy+Math.sin(a)*(r+ln/2))
          ctx.strokeStyle=mj?'#6a7498':'#3a4258'; ctx.lineWidth=mj?1.5:0.7; ctx.stroke()
          if(mj){var lr=r+aw*3.2,lv=Math.round(maxV/8*i);if(maxV>=1000)lv=(lv/1000).toFixed(0)
            var fs=Math.max(Math.min(r*0.13,13),10)
            ctx.font=fs.toFixed(0)+'px Consolas,monospace';ctx.fillStyle='#a0a8c0'
            ctx.textAlign='center';ctx.textBaseline='middle'
            ctx.fillText(lv.toString(),cx+Math.cos(a)*lr,cy+Math.sin(a)*lr)}
        }

        if(wPct&&wPct<1){ctx.beginPath();ctx.arc(cx,cy,r,sA+wPct*sw,eA);ctx.strokeStyle='rgba(255,34,68,0.1)';ctx.lineWidth=aw;ctx.lineCap='butt';ctx.stroke()}

        if(pct>0.002){
          var ac=pct<0.55?c1:pct<0.8?c2:'#ff2244'
          ctx.beginPath();ctx.arc(cx,cy,r,sA,vA);ctx.strokeStyle=ac;ctx.lineWidth=aw;ctx.lineCap='round';ctx.stroke()
          ctx.shadowColor=ac;ctx.shadowBlur=aw*3
          ctx.beginPath();ctx.arc(cx+Math.cos(vA)*r,cy+Math.sin(vA)*r,aw*0.7,0,6.283);ctx.fillStyle=ac;ctx.fill()
          ctx.shadowBlur=0
        }

        var fS=Math.min(r*0.48,w*0.26)
        ctx.fillStyle='#ffffff';ctx.font='700 '+fS.toFixed(0)+'px Consolas,monospace'
        ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(valTxt,cx,cy-fS*0.05)
        ctx.fillStyle='#b0b8d0';ctx.font=Math.max(r*0.14,10).toFixed(0)+'px Consolas,monospace';ctx.fillText(unit,cx,cy+fS*0.55)
        ctx.fillStyle='#c0c8e0';ctx.font='700 '+Math.max(r*0.11,10).toFixed(0)+'px Consolas,monospace';ctx.fillText(label,cx,h-Math.max(r*0.1,6))
      }

      /* ==================== MINI GAUGE (OIL/H2O/THR/TRB) ==================== */
      function drawMiniGauge (ctx, w, h, value, maxV, valTxt, unit, label, c1, c2) {
        ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h)
        var cx = w/2, cy = h*0.42, r = Math.min(w,h)*0.32, aw = Math.max(r*0.1,2)
        var sA = 0.75*Math.PI, eA = 2.25*Math.PI, sw = eA-sA, pct = cl(value/maxV,0,1), vA = sA+pct*sw

        ctx.beginPath(); ctx.arc(cx,cy,r,sA,eA); ctx.strokeStyle='#2a3048'; ctx.lineWidth=aw; ctx.lineCap='butt'; ctx.stroke()

        for (var i=0; i<=4; i++) {
          var a=sA+sw*i/4, ln=aw*1.2
          ctx.beginPath()
          ctx.moveTo(cx+Math.cos(a)*(r-ln/2),cy+Math.sin(a)*(r-ln/2))
          ctx.lineTo(cx+Math.cos(a)*(r+ln/2),cy+Math.sin(a)*(r+ln/2))
          ctx.strokeStyle='#6a7498'; ctx.lineWidth=1; ctx.stroke()
        }

        if(pct>0.005){
          var ac=pct<0.6?c1:pct<0.85?c2:'#ff2244'
          ctx.beginPath();ctx.arc(cx,cy,r,sA,vA);ctx.strokeStyle=ac;ctx.lineWidth=aw;ctx.lineCap='round';ctx.stroke()
          ctx.shadowColor=ac;ctx.shadowBlur=aw*2
          ctx.beginPath();ctx.arc(cx+Math.cos(vA)*r,cy+Math.sin(vA)*r,aw*0.5,0,6.283);ctx.fillStyle=ac;ctx.fill()
          ctx.shadowBlur=0
        }

        var fS=Math.min(r*0.55,w*0.25)
        ctx.fillStyle='#ffffff';ctx.font='700 '+Math.max(fS,12).toFixed(0)+'px Consolas,monospace'
        ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(valTxt,cx,cy)
        ctx.fillStyle='#b0b8d0';ctx.font=Math.max(fS*0.55,10).toFixed(0)+'px Consolas,monospace';ctx.fillText(unit,cx,cy+fS*0.7)
        ctx.fillStyle='#c0c8e0';ctx.font='700 '+Math.max(fS*0.5,10).toFixed(0)+'px Consolas,monospace';ctx.fillText(label,cx,h-Math.max(fS*0.3,6))
      }

      /* ==================== BAR GAUGE (compact horizontal — OIL/H2O/THR) ==================== */
      function drawBarGauge (ctx, w, h, value, maxV, valTxt, unit, label, c1, c2) {
        ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h)
        var pad = Math.max(w * 0.04, 6)
        var labelFs = cl(h * 0.20, 10, 14)
        var valFs = cl(h * 0.36, 13, 26)
        var unitFs = cl(valFs * 0.5, 10, 14)
        var barH2 = cl(h * 0.12, 3, 8)
        var pct = cl(value / maxV, 0, 1)

        // Semi-transparent panel background
        ctx.fillStyle = 'rgba(10,12,20,0.5)'
        ctx.fillRect(0, 0, w, h)
        ctx.strokeStyle = 'rgba(40,46,66,0.3)'; ctx.lineWidth = 1
        ctx.strokeRect(0.5, 0.5, w - 1, h - 1)

        // Label (top-left)
        ctx.font = '700 ' + labelFs.toFixed(0) + 'px Consolas,monospace'
        ctx.fillStyle = '#6a7498'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
        ctx.fillText(label, pad, pad)

        // Value (center)
        ctx.font = '700 ' + valFs.toFixed(0) + 'px Consolas,monospace'
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(valTxt, w / 2, h * 0.45)

        // Unit (below value)
        ctx.font = unitFs.toFixed(0) + 'px Consolas,monospace'
        ctx.fillStyle = '#8890a8'
        ctx.fillText(unit, w / 2, h * 0.45 + valFs * 0.55)

        // Horizontal bar (bottom)
        var barY2 = h - pad - barH2
        var barX = pad, barW = w - pad * 2

        ctx.fillStyle = 'rgba(30,34,50,0.6)'
        ctx.fillRect(barX, barY2, barW, barH2)

        if (pct > 0.005) {
          var fillW = barW * pct
          var ac = pct < 0.6 ? c1 : pct < 0.85 ? c2 : '#ff2244'
          ctx.fillStyle = ac
          ctx.fillRect(barX, barY2, fillW, barH2)
          ctx.shadowColor = ac; ctx.shadowBlur = barH2 * 3
          ctx.fillRect(barX + fillW - 2, barY2, 2, barH2)
          ctx.shadowBlur = 0
        }
      }

      function drawRpmGauge () {
        initCanvases(); if(!ctxRpm||!lay) return
        var sz=sizeCvs(cvsRpm,lay.gaugeW,lay.gaugeH); if(!sz) return
        drawGauge(ctxRpm,sz.w,sz.h,rpm,maxRPM,Math.round(rpm).toString(),'RPM','ENGINE','#00ff88','#ffcc00',0.8)
      }
      function drawBoostGauge () {
        initCanvases(); if(!ctxBst||!lay) return
        var sz=sizeCvs(cvsBst,lay.bstW,lay.bstH); if(!sz) return
        var bstMax = boostMax > 0 ? Math.ceil(boostMax * 1.2) : maxPSI
        drawGauge(ctxBst,sz.w,sz.h,Math.max(boost,0),bstMax,boost.toFixed(1),'PSI','BOOST','#00bbff','#ff7700',0.85)
      }
      function drawTurboRpmGauge () {
        initCanvases(); if(!ctxTrb||!lay) return
        var sz=sizeCvs(cvsTrb,lay.trbW,lay.trbH); if(!sz) return
        var tv=turboRpm>1000?(turboRpm/1000).toFixed(1)+'k':Math.round(turboRpm).toString()
        drawGauge(ctxTrb,sz.w,sz.h,turboRpm,200000,tv,'RPM','TURBO','#224466','#00bbff')
      }

      /* OIL & H2O */
      function drawOilH2oGauges () {
        initCanvases(); if(!lay) return
        var ms
        if(ctxOil){ms=sizeCvs(cvsOil,lay.oilW,lay.oilH);if(ms) drawBarGauge(ctxOil,ms.w,ms.h,oilT,150,Math.round(oilT).toString(),'°C','OIL','#00aa44','#ff8800')}
        if(ctxH2o){ms=sizeCvs(cvsH2o,lay.h2oW,lay.h2oH);if(ms) drawBarGauge(ctxH2o,ms.w,ms.h,h2oT,130,Math.round(h2oT).toString(),'°C','H2O','#0077ee','#ff3344')}
      }

      /* THR */
      function drawThrTrbGauges () {
        initCanvases(); if(!lay) return
        var ms
        if(ctxThr){ms=sizeCvs(cvsThr,lay.thrW,lay.thrH);if(ms) drawBarGauge(ctxThr,ms.w,ms.h,throttle*100,100,Math.round(throttle*100).toString(),'%','THR','#225533','#00ff88')}
      }

      /* ==================== G-FORCE METER ==================== */
      function drawGForce () {
        initCanvases(); if(!ctxGf||!lay) return
        var sz = sizeCvs(cvsGf, lay.gfW, lay.gfH); if(!sz) return
        var w = sz.w, h = sz.h, ctx = ctxGf
        ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h)

        var fs = cl(Math.min(w,h)*0.12, 10, 16)
        var cx = w/2, cy = h/2 - fs*0.6
        var r = Math.min(w,h)*0.4
        var maxG = 2.0

        // Semi-transparent panel background
        ctx.fillStyle = 'rgba(10,12,20,0.5)'
        ctx.fillRect(0, 0, w, h)
        ctx.strokeStyle = 'rgba(40,46,66,0.3)'; ctx.lineWidth = 1
        ctx.strokeRect(0.5, 0.5, w - 1, h - 1)

        // Label
        var lfs = cl(fs * 0.7, 10, 12)
        ctx.font = '700 ' + lfs.toFixed(0) + 'px Consolas,monospace'
        ctx.fillStyle = '#6a7498'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
        ctx.fillText('G-FORCE', 6, 4)

        // Circle + crosshairs + 1G ring
        ctx.strokeStyle='#2a3048'; ctx.lineWidth=0.5
        ctx.beginPath(); ctx.arc(cx,cy,r,0,6.283); ctx.lineWidth=1; ctx.stroke()
        ctx.beginPath(); ctx.moveTo(cx-r,cy); ctx.lineTo(cx+r,cy); ctx.moveTo(cx,cy-r); ctx.lineTo(cx,cy+r); ctx.stroke()
        ctx.beginPath(); ctx.arc(cx,cy,r*0.5,0,6.283); ctx.stroke()

        // Dot
        var gx = cl(gForceX/maxG, -1, 1) * r
        var gy = cl(-gForceY/maxG, -1, 1) * r
        var gMag = Math.sqrt(gForceX*gForceX + gForceY*gForceY)
        var dotC = gMag < 0.5 ? '#00ff88' : gMag < 1.2 ? '#ffcc00' : '#ff2244'
        var dotR = cl(r*0.09, 3, 8)
        ctx.shadowColor = dotC; ctx.shadowBlur = dotR*3
        ctx.beginPath(); ctx.arc(cx+gx, cy+gy, dotR, 0, 6.283); ctx.fillStyle = dotC; ctx.fill()
        ctx.shadowBlur = 0

        // G value
        ctx.font = '700 '+fs.toFixed(0)+'px Consolas,monospace'; ctx.textAlign='center'; ctx.textBaseline='middle'
        ctx.fillStyle = '#ffffff'; ctx.fillText(gMag.toFixed(2)+'G', cx, cy+r+fs*1.1)
      }

      /* ==================== GRID HELPER ==================== */
      function drawGrid (ctx,w,h,maxX,maxY,extraRight) {
        var fs=cl(w*0.03,10,16),pl=Math.round(fs*3.2)
        var pr = extraRight ? Math.round(fs*2.8) : 6
        var p={l:pl,r:pr,t:6,b:Math.round(fs*1.8)},gw=w-p.l-p.r,gh=h-p.t-p.b
        var nY=h>100?4:2,nX=w>200?4:2
        ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='rgba(6,8,14,0.7)';ctx.fillRect(0,0,w,h)
        ctx.strokeStyle='#1a2030';ctx.lineWidth=0.5
        for(var i=0;i<=nY;i++){var yy=p.t+gh/nY*i;ctx.beginPath();ctx.moveTo(p.l,yy);ctx.lineTo(w-p.r,yy);ctx.stroke()}
        for(var j=0;j<=nX*2;j++){var xx=p.l+gw/(nX*2)*j;ctx.beginPath();ctx.moveTo(xx,p.t);ctx.lineTo(xx,p.t+gh);ctx.stroke()}
        ctx.font=fs.toFixed(0)+'px Consolas,monospace';ctx.fillStyle='#5a6280';ctx.textAlign='right'
        for(var i=0;i<=nY;i++){ctx.fillText((maxY-maxY/nY*i).toFixed(0),p.l-3,p.t+gh/nY*i+fs*0.35)}
        ctx.textAlign='center'
        for(var i=0;i<=nX;i++){var rv=maxX/nX*i;ctx.fillText(rv>=1000?(rv/1000).toFixed(0)+'k':'0',p.l+gw/nX*i,h-p.b+fs+2)}
        return {p:p,gw:gw,gh:gh,fs:fs}
      }

      /* ==================== BOOST MAP ==================== */
      var BP={},BGW=0,BGH=0,BMW2=0,BMH2=0
      function drawBoostMap () {
        initCanvases(); if(!ctxMap||!lay) return
        var sz=sizeCvs(cvsMap,lay.graphW,lay.graphH); if(!sz) return
        BMW2=sz.w;BMH2=sz.h; var ctx=ctxMap
        var g=drawGrid(ctx,BMW2,BMH2,maxRPM,maxPSI); if(!g) return
        BP=g.p;BGW=g.gw;BGH=g.gh
        function tx(r){return BP.l+cl(r/maxRPM,0,1)*BGW}
        function ty(v){return BP.t+BGH-cl(v/maxPSI,0,1)*BGH}

        // ── Hardware turbo limit zone ──
        // Anything above the stock turbo's boostMax can't be reached by the
        // wastegate alone — it requires OVERBOOST. Tint the unreachable zone
        // and draw a labeled limit line so users can see why their target
        // isn't being delivered.
        if (boostMax > 0 && boostMax < maxPSI) {
          var limY = ty(boostMax)
          // Fill the zone above the line
          ctx.fillStyle = scope.forceOB ? 'rgba(255,170,0,0.07)' : 'rgba(120,130,150,0.10)'
          ctx.fillRect(BP.l, BP.t, BGW, limY - BP.t)
          // Dashed limit line
          ctx.save()
          ctx.setLineDash([6, 4])
          ctx.strokeStyle = scope.forceOB ? 'rgba(255,170,0,0.7)' : 'rgba(160,170,190,0.6)'
          ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(BP.l, limY); ctx.lineTo(BP.l + BGW, limY); ctx.stroke()
          ctx.restore()
          // Label on the right edge
          ctx.font = cl(g.fs, 9, 12).toFixed(0) + 'px Consolas,monospace'
          ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
          ctx.fillStyle = scope.forceOB ? '#ffaa00' : '#a0aabe'
          ctx.fillText('TURBO MAX ' + boostMax.toFixed(1) + ' PSI', BP.l + BGW - 4, limY - 2)
          if (!scope.forceOB) {
            ctx.textAlign = 'left'; ctx.textBaseline = 'top'
            ctx.fillStyle = 'rgba(160,170,190,0.55)'
            ctx.fillText('above limit — enable OVERBOOST to reach', BP.l + 4, BP.t + 2)
          }
        }

        var steps=Math.max(Math.round(BGW/2),20),step=maxRPM/steps
        ctx.beginPath();ctx.moveTo(tx(0),ty(0))
        for(var i=0;i<=steps;i++)ctx.lineTo(tx(step*i),ty(lerpMap(step*i)))
        ctx.lineTo(tx(maxRPM),ty(0));ctx.closePath()
        var grd=ctx.createLinearGradient(0,BP.t,0,BP.t+BGH)
        grd.addColorStop(0,'rgba(255,102,0,0.1)');grd.addColorStop(1,'rgba(255,102,0,0)')
        ctx.fillStyle=grd;ctx.fill()

        ctx.beginPath();ctx.moveTo(tx(0),ty(lerpMap(0)))
        for(var i=1;i<=steps;i++)ctx.lineTo(tx(step*i),ty(lerpMap(step*i)))
        var lw=cl(BMW2*0.004,1,2.5)
        ctx.strokeStyle='#ff6600';ctx.lineWidth=lw;ctx.lineJoin='round';ctx.stroke()

        var dr=cl(BMW2*0.008,3,7)
        for(var i=0;i<map.length;i++){
          var bx=tx(map[i][0]),by=ty(map[i][1]),hot=(i===hoverIdx||i===dragIdx)
          // Mark dots that target above the turbo's hardware limit when
          // OVERBOOST is off — the wastegate alone cannot deliver this.
          var aboveLimit = boostMax > 0 && map[i][1] > boostMax && !scope.forceOB
          if(hot){ctx.beginPath();ctx.arc(bx,by,dr+6,0,6.283);ctx.fillStyle='rgba(255,102,0,0.08)';ctx.fill()}
          ctx.beginPath();ctx.arc(bx,by,dr+1,0,6.283);ctx.strokeStyle=hot?'#ff8833':'rgba(255,102,0,0.3)';ctx.lineWidth=1;ctx.stroke()
          ctx.beginPath();ctx.arc(bx,by,dr,0,6.283);ctx.fillStyle = aboveLimit ? '#888a96' : (hot ? '#ff8833' : '#ff6600'); ctx.fill()
          ctx.beginPath();ctx.arc(bx,by,dr*0.3,0,6.283);ctx.fillStyle='rgba(6,8,14,0.9)';ctx.fill()
          if (aboveLimit) {
            ctx.font = 'bold ' + cl(BMW2*0.018, 9, 13).toFixed(0) + 'px sans-serif'
            ctx.fillStyle = '#ffaa00'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
            ctx.fillText('!', bx + dr + 6, by)
          }
          if(hot){
            ctx.font='bold '+cl(g.fs+1,10,14).toFixed(0)+'px Consolas,monospace'
            ctx.fillStyle='#dde0ec'; ctx.textAlign='center'; ctx.textBaseline='alphabetic'
            var tip = map[i][0]+' / '+map[i][1].toFixed(1)+' PSI'
            if (aboveLimit) tip += '  (above turbo limit)'
            ctx.fillText(tip, bx, by-dr-6)
          }
        }

        if(!scope.active||rpm<50)return
        var cx2=cl(tx(rpm),BP.l,BMW2-BP.r),cy2=cl(ty(boost),BP.t,BP.t+BGH),tgy=cl(ty(tgt),BP.t,BP.t+BGH)
        var vg=ctx.createLinearGradient(0,BP.t,0,BP.t+BGH)
        vg.addColorStop(0,'rgba(0,255,136,0)');vg.addColorStop(0.5,'rgba(0,255,136,0.05)');vg.addColorStop(1,'rgba(0,255,136,0)')
        ctx.fillStyle=vg;ctx.fillRect(cx2-0.5,BP.t,1,BGH)
        ctx.beginPath();ctx.arc(cx2,tgy,dr*1.5,0,6.283);ctx.strokeStyle='rgba(255,102,0,0.4)';ctx.lineWidth=cl(lw*0.5,0.5,1);ctx.stroke()
        var dotC=scope.overboost?'#ff2244':'#00bbff'
        ctx.shadowColor=dotC;ctx.shadowBlur=cl(BMW2*0.01,3,10)
        ctx.beginPath();ctx.arc(cx2,cy2,dr*1.2,0,6.283);ctx.fillStyle=dotC;ctx.fill();ctx.shadowBlur=0
      }

      /* ==================== POWER / TORQUE ==================== */
      function drawPower () {
        initCanvases(); if(!ctxPwr||!lay) return
        // Need either BeamNG native curves OR our fallback pwrData
        if (!stockTorqueArr && !pwrData) return
        var sz=sizeCvs(cvsPwr,lay.pwrW,lay.graphH); if(!sz) return
        var w=sz.w,h=sz.h,ctx=ctxPwr

        var eR = stockMaxRPM || (pwrData && pwrData.maxRPM) || 7000
        var useNative = !!(stockTorqueArr && stockTorqueArr.length > 100)

        // Build stock and projected curve data points from native BeamNG data
        var td=[], pd=[], bt=[], bp=[]
        var maxNm=0, maxHP=0
        var stockPkNm=0, stockPkHP=0, projPkNm=0, projPkHP=0

        if (useNative) {
          var step = 250
          // MAP-based torque ratio (atmospheric ~14.7 PSI gauge → atmospheric MAP).
          // Engine torque scales with MANIFOLD ABSOLUTE pressure, not gauge boost,
          // so 0 PSI gauge ≠ 0 torque. See lua/.../fueltechBoostController.lua
          // for the matching server-side formula.
          var ATM_PSI = 14.7
          var stockBoost = boostMax > 0 ? boostMax : 0
          var stockMAP = ATM_PSI + (stockBoost > 0 ? stockBoost : 0)
          for (var r = 0; r <= eR; r += step) {
            var idx = Math.min(r, stockTorqueArr.length - 1)
            var sNm = stockTorqueArr[idx] || 0       // stock-with-OEM-boost torque (Nm)
            var sPkw = stockPowerArr ? (stockPowerArr[idx] || 0) : (sNm * r * 0.10471975 / 1000)
            var sHP = sPkw * 1.34102

            // Stock curves
            bt.push({rpm: r, nm: sNm})
            bp.push({rpm: r, hp: sHP})
            if (sNm > stockPkNm) stockPkNm = sNm
            if (sHP > stockPkHP) stockPkHP = sHP

            // Projected: scale by ratio of target MAP to stock MAP
            var ourTarget = lerpMap(r)
            if (ourTarget < 0) ourTarget = 0
            var targetMAP = ATM_PSI + ourTarget
            var torqueRatio = stockMAP > 0 ? (targetMAP / stockMAP) : 1
            var pNm = sNm * torqueRatio
            var pHP = sHP * torqueRatio

            td.push({rpm: r, nm: pNm})
            pd.push({rpm: r, hp: pHP})
            if (pNm > projPkNm) projPkNm = pNm
            if (pHP > projPkHP) projPkHP = pHP

            if (sNm > maxNm) maxNm = sNm
            if (pNm > maxNm) maxNm = pNm
            if (sHP > maxHP) maxHP = sHP
            if (pHP > maxHP) maxHP = pHP
          }
        } else if (pwrData) {
          // Fallback to our Lua-calculated curves
          td=pwrData.torque||[]; pd=pwrData.power||[]; bt=pwrData.baseTorque||[]; bp=pwrData.basePower||[]
          stockPkNm = pwrData.stockPeakTorque || 0
          stockPkHP = pwrData.stockPeakPowerHP || 0
          projPkNm = pwrData.projPeakTorque || 0
          projPkHP = pwrData.projPeakHP || 0
          for(var i=0;i<td.length;i++){if(td[i].nm>maxNm)maxNm=td[i].nm;if(i<pd.length&&pd[i].hp>maxHP)maxHP=pd[i].hp}
          for(var i=0;i<bt.length;i++){if(bt[i].nm>maxNm)maxNm=bt[i].nm;if(i<bp.length&&bp[i].hp>maxHP)maxHP=bp[i].hp}
        }

        if(!td.length||!pd.length) return

        var tqRating = (pwrData && pwrData.maxTorqueRating) || -1
        if (tqRating > 0 && tqRating > maxNm) maxNm = tqRating * 1.05

        maxNm=Math.ceil(maxNm/50)*50||400;maxHP=Math.ceil(maxHP/25)*25||200
        var g=drawGrid(ctx,w,h,eR,maxNm,true); if(!g) return
        var gp=g.p,ggw=g.gw,ggh=g.gh
        function ttx(r){return gp.l+cl(r/eR,0,1)*ggw}
        function tty(nm){return gp.t+ggh-cl(nm/maxNm,0,1)*ggh}
        function pty(hp){return gp.t+ggh-cl(hp/maxHP,0,1)*ggh}

        // Torque limit line
        if (tqRating > 0) {
          var limY = tty(tqRating)
          ctx.save()
          ctx.fillStyle = 'rgba(255,34,68,0.04)'
          ctx.fillRect(gp.l, gp.t, ggw, limY - gp.t)
          ctx.setLineDash([6,4])
          ctx.beginPath(); ctx.moveTo(gp.l, limY); ctx.lineTo(gp.l+ggw, limY)
          ctx.strokeStyle = 'rgba(255,34,68,0.5)'; ctx.lineWidth = 1.2; ctx.stroke()
          ctx.restore()
          ctx.font = cl(g.fs,10,13).toFixed(0)+'px Consolas,monospace'
          ctx.fillStyle = 'rgba(255,34,68,0.6)'; ctx.textAlign = 'right'
          ctx.fillText('MAX '+tqRating+' Nm', gp.l+ggw-3, limY-3)
        }

        // Stock peak torque line
        if (stockPkNm > 0) {
          var spY = tty(stockPkNm)
          ctx.save(); ctx.setLineDash([3,5])
          ctx.beginPath(); ctx.moveTo(gp.l, spY); ctx.lineTo(gp.l+ggw, spY)
          ctx.strokeStyle = 'rgba(255,160,60,0.25)'; ctx.lineWidth = 0.8; ctx.stroke()
          ctx.restore()
          ctx.font = cl(g.fs-1,10,12).toFixed(0)+'px Consolas,monospace'
          ctx.fillStyle = 'rgba(255,160,60,0.4)'; ctx.textAlign = 'left'
          ctx.fillText('STOCK '+Math.round(stockPkNm)+' Nm', gp.l+3, spY-2)
        }

        // Draw curves: stock (dashed), projected (solid)
        var lw2=cl(w*0.004,1,2)
        function dc(data,yF,key,col,dash){ctx.save();if(dash)ctx.setLineDash([4,3]);ctx.beginPath()
          for(var i=0;i<data.length;i++){var px=ttx(data[i].rpm),py=yF(data[i][key]);if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py)}
          ctx.strokeStyle=col;ctx.lineWidth=lw2;ctx.lineJoin='round';ctx.stroke();ctx.restore()}
        dc(bt,tty,'nm','rgba(255,100,100,0.15)',true);dc(bp,pty,'hp','rgba(100,150,255,0.15)',true)
        dc(td,tty,'nm','#ff6666',false);dc(pd,pty,'hp','#6699ff',false)

        // Legend
        var lx=gp.l+8,ly=gp.t+10,lfs=cl(g.fs,10,14).toFixed(0)
        ctx.font=lfs+'px Consolas,monospace'; ctx.textAlign='left'
        ctx.fillStyle='#ff6666'; ctx.fillRect(lx,ly-5,9,3)
        ctx.fillText('TQ Nm'+(projPkNm>0?' ('+Math.round(projPkNm)+')':''),lx+14,ly)
        ctx.fillStyle='#6699ff'; ctx.fillRect(lx,ly+parseInt(lfs)+2,9,3)
        ctx.fillText('HP'+(projPkHP>0?' ('+Math.round(projPkHP)+')':''),lx+14,ly+parseInt(lfs)+6)
        ctx.fillStyle='#6a7498'
        ctx.fillText('-- stock',lx+14,ly+parseInt(lfs)*2+10)

        // Over-limit shading
        if (tqRating > 0) {
          for(var i=0;i<td.length;i++){
            if(td[i].nm > tqRating){
              var px=ttx(td[i].rpm), py=tty(td[i].nm), limYY=tty(tqRating)
              ctx.fillStyle='rgba(255,34,68,0.08)'
              ctx.fillRect(px-2,py,4,limYY-py)
            }
          }
        }

        // Right axis labels (HP)
        ctx.textAlign='left'; ctx.fillStyle='#5a6280'
        var nY = h > 100 ? 4 : 2
        for(var i=0;i<=nY;i++){ctx.fillText((maxHP-maxHP/nY*i).toFixed(0),w-gp.r+3,gp.t+ggh/nY*i+g.fs*0.35)}

        // Live RPM indicator + power/torque dots
        if(rpm>50){var rx=ttx(rpm)
          var vg2=ctx.createLinearGradient(0,gp.t,0,gp.t+ggh)
          vg2.addColorStop(0,'rgba(0,255,136,0)');vg2.addColorStop(0.5,'rgba(0,255,136,0.04)');vg2.addColorStop(1,'rgba(0,255,136,0)')
          ctx.fillStyle=vg2;ctx.fillRect(rx-0.5,gp.t,1,ggh)

          // Live power/torque: interpolate stock curve at current RPM, scale by actual boost
          var liveNm=0, liveHP=0
          if (useNative && stockTorqueArr) {
            var rpmIdx = Math.floor(rpm)
            if (rpmIdx >= 0 && rpmIdx < stockTorqueArr.length) {
              var sNmLive = stockTorqueArr[rpmIdx] || 0
              var sPkwLive = stockPowerArr ? (stockPowerArr[rpmIdx] || 0) : (sNmLive * rpm * 0.10471975 / 1000)
              // Scale by actual boost ratio and engine load
              // Stock curve already includes stock boost, so ratio = actual / stock
              var refB = boostMax > 0 ? boostMax : 1
              var liveRatio = boost > 0 ? (boost / refB) : 1
              liveNm = sNmLive * liveRatio * Math.max(engineLoad, 0.01)
              liveHP = sPkwLive * 1.34102 * liveRatio * Math.max(engineLoad, 0.01)
            }
          } else {
            // Fallback: interpolate from bt/bp arrays
            for(var li=0;li<bt.length-1;li++){
              if(rpm>=bt[li].rpm&&rpm<=bt[li+1].rpm){
                var lt=(rpm-bt[li].rpm)/(bt[li+1].rpm-bt[li].rpm)
                var bNm=bt[li].nm+(bt[li+1].nm-bt[li].nm)*lt
                var bHP=bp[li].hp+(bp[li+1].hp-bp[li].hp)*lt
                var bRef = boostMax > 0 ? boostMax : 1
                var aRatio = boost > 0 ? boost / bRef : 1
                liveNm=bNm*aRatio*Math.max(engineLoad,0.01)
                liveHP=bHP*aRatio*Math.max(engineLoad,0.01)
                break
              }
            }
          }

          var dotR2=cl(w*0.008,3,6)
          if(liveNm>0){
            var tDotY=tty(liveNm)
            ctx.shadowColor='#ff6666';ctx.shadowBlur=dotR2*3
            ctx.beginPath();ctx.arc(rx,tDotY,dotR2,0,6.283);ctx.fillStyle='#ff6666';ctx.fill()
            ctx.shadowBlur=0
          }
          if(liveHP>0){
            var pDotY=pty(liveHP)
            ctx.shadowColor='#6699ff';ctx.shadowBlur=dotR2*3
            ctx.beginPath();ctx.arc(rx,pDotY,dotR2,0,6.283);ctx.fillStyle='#6699ff';ctx.fill()
            ctx.shadowBlur=0
          }
          var lfx=gp.l+ggw-4, lfy=gp.t+ggh-6
          ctx.font='700 '+cl(g.fs,10,16).toFixed(0)+'px Consolas,monospace'
          ctx.textAlign='right'; ctx.fillStyle='#ff6666'
          ctx.fillText(Math.round(liveNm)+' Nm',lfx,lfy-g.fs*1.1)
          ctx.fillStyle='#6699ff'
          ctx.fillText(Math.round(liveHP)+' HP',lfx,lfy)
        }
      }

      /* ==================== DRAG (mouse + touch) ==================== */
      var dragIdx=-1,hoverIdx=-1,GRAB_R=18
      function boostTx(r){return BP.l+cl(r/maxRPM,0,1)*BGW}
      function boostTy(v){return BP.t+BGH-cl(v/maxPSI,0,1)*BGH}
      function fromX(px){return cl((px-BP.l)/BGW,0,1)*maxRPM}
      function fromY(py){return cl((BP.t+BGH-py)/BGH,0,1)*maxPSI}
      function nearestPt(mx,my){var b=-1,bd=GRAB_R*GRAB_R;for(var i=0;i<map.length;i++){var dx=boostTx(map[i][0])-mx,dy=boostTy(map[i][1])-my;if(dx*dx+dy*dy<bd){bd=dx*dx+dy*dy;b=i}};return b}

      function onDown(e){var r=cvsMap.getBoundingClientRect();dragIdx=nearestPt(e.clientX-r.left,e.clientY-r.top)}
      function onMove(e){var r=cvsMap.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top
        if(dragIdx>=0){map[dragIdx][0]=cl(Math.round(fromX(mx)/100)*100,1000,9000);map[dragIdx][1]=cl(Math.round(fromY(my)*2)/2,0,maxPSI);drawBoostMap();cvsMap.style.cursor='grabbing'}
        else{var h2=nearestPt(mx,my);if(h2!==hoverIdx){hoverIdx=h2;cvsMap.style.cursor=h2>=0?'grab':'default';drawBoostMap()}}}

      function onTouchDown(e){e.preventDefault();var t=e.touches[0];var r=cvsMap.getBoundingClientRect();dragIdx=nearestPt(t.clientX-r.left,t.clientY-r.top)}
      function onTouchMove(e){e.preventDefault();if(dragIdx<0)return;var t=e.touches[0];var r=cvsMap.getBoundingClientRect(),mx=t.clientX-r.left,my=t.clientY-r.top
        map[dragIdx][0]=cl(Math.round(fromX(mx)/100)*100,1000,9000);map[dragIdx][1]=cl(Math.round(fromY(my)*2)/2,0,maxPSI);drawBoostMap()}

      function onUp(){if(dragIdx>=0){scope.$evalAsync(function(){scope.preset='CUSTOM'});map.sort(function(a,b){return a[0]-b[0]})
        for(var i=0;i<map.length;i++){try{bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").setPoint('+(i+1)+','+map[i][0]+','+map[i][1]+')')}catch(e){}}
        dragIdx=-1;setTimeout(function(){try{bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").sendPowerCurves()')}catch(e){}},100);drawBoostMap()}
        cvsMap.style.cursor=hoverIdx>=0?'grab':'default'}

      /* ==================== RESIZE + INIT ==================== */
      scope.$on('app:resized', function (_, data) {
        if (data && data.width > 0 && data.height > 0) {
          lay = null
          doLayout(data.width, data.height)
          drawAll()
        }
      })

      scope.$on('windowResize', function () {
        var root = element[0]
        var W = root.offsetWidth || window.innerWidth || 800
        var H = root.offsetHeight || window.innerHeight || 600
        if (W > 100 && H > 100) {
          lay = null
          doLayout(W, H)
          drawAll()
        }
      })

      var initTimer = setTimeout(function () {
        if (!lay) {
          var root = element[0]
          var W = root.offsetWidth || window.innerWidth || 800
          var H = root.offsetHeight || window.innerHeight || 600
          if (W > 100 && H > 100) {
            doLayout(W, H)
            drawAll()
          }
        }
      }, 200)

      function drawAll () {
        drawRpmGauge(); drawOilH2oGauges(); drawThrTrbGauges(); drawGForce()
        if (hasTurbo) { drawBoostGauge(); if (hasTurboRpm) drawTurboRpmGauge() }
        // Boost map + power curve only render when the TUNE overlay is open
        if (hasTurbo && scope.tuneOpen) { drawBoostMap(); drawPower() }
      }

      /* ==================== WARNINGS ==================== */
      var safetyCut = false, lastElectrics = null
      function updateWarnings () {
        var w = []
        safetyCut = !!(lastElectrics && lastElectrics.fueltech_safetyCut)
        if (safetyCut) w.push('BOOST CUT — OVERTEMP')
        if (oilT > 130) w.push('OIL TEMP ' + Math.round(oilT) + '°C')
        if (h2oT > 110) w.push('COOLANT ' + Math.round(h2oT) + '°C')
        if (scope.overboost && !safetyCut) w.push('OVERBOOST')
        if (scope.alsFiring) w.push('ALS ACTIVE')
        if (scope.tcsCut > 0.05) w.push('TC -' + Math.round(scope.tcsCut * 100) + '%')
        if (scope.absInterfering) w.push('ABS')
        scope.warnings = w
      }

      /* ==================== DRAG TIMER ==================== */
      function updateDragTimer () {
        var now = Date.now()
        var spd = speed

        // Start when moving from standstill (speed < 2 km/h) and throttle applied
        if (!dragActive && spd < 2 && throttle > 0.1 && gear > 0) {
          dragActive = true; dragStart = 0; drag100t = 0; drag200t = 0
          scope.drag100done = false; scope.drag200done = false
          scope.drag100str = '0.000'; scope.drag200str = '0.000'
        }

        // Arm: record start time when speed first crosses 2 km/h
        if (dragActive && dragStart === 0 && spd >= 2) {
          dragStart = now
        }

        if (dragActive && dragStart > 0) {
          var elapsed = (now - dragStart) / 1000
          if (!drag100t && spd >= 100) {
            drag100t = elapsed
            scope.drag100str = drag100t.toFixed(3)
            scope.drag100done = true
          }
          if (!drag200t && spd >= 200) {
            drag200t = elapsed
            scope.drag200str = drag200t.toFixed(3)
            scope.drag200done = true
          }
          if (!drag100t) scope.drag100str = elapsed.toFixed(3)
          if (!drag200t && drag100t) scope.drag200str = elapsed.toFixed(3)

          // Auto-stop if braking or stopped
          if (spd < 1 && elapsed > 2) dragActive = false
        }
      }

      /* ==================== TURBO TIMER ==================== */
      // Turbo cooldown timer: after sustained boost driving, when you come to
      // idle, shows a countdown recommending you let the engine idle before
      // shutdown. This protects the turbo bearings from oil coking.
      var turboWasHot = false
      var turboHotSeconds = 0   // how long the turbo was driven hard (proxy for heat)

      function updateTurboTimer () {
        // Track when turbo was under hard load (high boost + high RPM)
        var isHardDriving = boost > 10 && rpm > 4000
        if (isHardDriving) {
          turboWasHot = true
          turboHotSeconds += 1 / 60  // approx — called once per frame
        }

        // Trigger: was hot, now idling (low RPM, low throttle, low speed)
        var isIdling = rpm > 300 && rpm < 1200 && throttle < 0.05 && speed < 5

        if (turboWasHot && isIdling) {
          if (!scope.turboTimerActive) {
            scope.turboTimerActive = true
            turboTimerStart = Date.now()
            // Duration scales with how long the turbo was hot: 30s base, up to 90s
            turboTimerDuration = cl(30 + turboHotSeconds * 2, 30, 90)
          }
          var elapsed = (Date.now() - turboTimerStart) / 1000
          var remaining = Math.max(0, turboTimerDuration - elapsed)
          scope.turboTimerStr = remaining.toFixed(0)
          if (remaining <= 0) {
            scope.turboTimerActive = false
            turboWasHot = false
            turboHotSeconds = 0
          }
        } else if (rpm > 2000 || speed > 20) {
          // Driving again — cancel timer, reset if turbo has cooled
          scope.turboTimerActive = false
          turboTimerStart = 0
          if (boost < 3) {
            turboWasHot = false
            turboHotSeconds = Math.max(0, turboHotSeconds - 0.5)
          }
        }
      }

      /* ==================== STREAMS ==================== */
      scope.$on('streamsUpdate', function (_, s) {
        if (!s) return
        scope.$evalAsync(function () {
          if (s.engineInfo) { rpm = s.engineInfo[4]||0; if (s.engineInfo[1]&&s.engineInfo[1]>1000) maxRPM = s.engineInfo[1] }
          if (s.electrics) {
            lastElectrics = s.electrics
            boost=s.electrics.turboBoost||s.electrics.boost||0; tgt=s.electrics.fueltech_targetBoost||0; boostMax=s.electrics.fueltech_boostMax||s.electrics.turboBoostMax||s.electrics.boostMax||0
            speed=(s.electrics.wheelspeed||s.electrics.airspeed||0)*3.6
            oilT=s.electrics.oiltemp||0; h2oT=s.electrics.watertemp||0
            throttle=s.electrics.throttle||0; turboRpm=s.electrics.turboRPM||0
            gForceX=(s.electrics.accXSmooth||s.electrics.accX||0)/9.81
            gForceY=(s.electrics.accYSmooth||s.electrics.accY||0)/9.81
            engineLoad=s.electrics.engineLoad||0
            fuelVol=s.electrics.fuelVolume||0; fuelCap=s.electrics.fuelCapacity||1
            exhFlow=s.electrics.exhaustFlow||0
            clutchPos=s.electrics.clutch||0
            altitude=s.electrics.altitude||0
            odometer=s.electrics.odometer||0
            vehMass=s.electrics.fueltech_mass||0
            cel=!!(s.electrics.checkengine)
            lowFuel=!!(s.electrics.lowfuel)
            scope.active=!!(s.electrics.fueltech_active)
            // ── Gear display ──
            // Prefer BeamNG's pre-formatted `gear` string — that's the
            // canonical "what the cluster shows" value and already includes
            // P/R/N/D/S/M etc. for automatics. Fall back to numeric for
            // manuals on builds that don't publish `gear`.
            //
            // Gearbox mode classification:
            //   gear_A  — auto trans display (P/R/N/D/S/M/2/L)
            //   gear_M  — manual trans gear (numeric, or set when in M mode)
            //   gear    — whichever the gauge cluster wants to show
            var gearAuto = s.electrics.gear_A
            var gearManual = s.electrics.gear_M
            var gearStr = s.electrics.gear
            var gearIdx = s.electrics.gearIndex
            if (gearIdx === undefined) gearIdx = (typeof gearManual === 'number') ? gearManual : 0
            gear = gearIdx

            // Auto in M (manumatic) — append the numeric gear so the user
            // sees both the mode AND which gear they're locked in.
            if (gearAuto === 'M' && typeof gearManual === 'number' && gearManual > 0) {
              scope.gearStr = 'M' + gearManual
            } else if (typeof gearStr === 'string' && gearStr !== '') {
              scope.gearStr = gearStr
            } else if (typeof gearAuto === 'string' && gearAuto !== '') {
              scope.gearStr = gearAuto
            } else if (gearIdx < 0) {
              scope.gearStr = 'R'
            } else if (gearIdx === 0) {
              scope.gearStr = 'N'
            } else {
              scope.gearStr = String(gearIdx)
            }

            // Mode label shown under the gear: tells you whether you're
            // looking at an auto, a manual, or an auto in manual mode.
            if (gearAuto !== undefined) {
              scope.gearModeStr = (gearAuto === 'M') ? 'AUTO · MANUAL' : 'AUTO'
            } else if (gearManual !== undefined) {
              scope.gearModeStr = 'MANUAL'
            } else {
              scope.gearModeStr = ''
            }

            // Drivetrain features
            for (var di = 0; di < scope.dtFeatures.length; di++) {
              var df = scope.dtFeatures[di]
              var dv = s.electrics[df.electricsName]
              if (dv !== undefined) {
                df.modeIndex = dv
                df.modeLabel = df.modeLabels[dv] || '?'
                df.active = dv > 0
              }
            }
            // Drive modes (ESC/TCS/ABS) — read active state from electrics
            for (var dmi = 0; dmi < scope.dmodes.length; dmi++) {
              var dm = scope.dmodes[dmi]
              var ev = s.electrics[dm.electricsKey]
              if (ev !== undefined) {
                dm.active = !!ev
              }
            }
            // Custom TCS cut amount (0 = no cut, >0 = intervening)
            scope.tcsCut = s.electrics.fueltech_tcs_cut || 0
            // Sync TC state from electrics (with debounce after toggle)
            if (tcToggleDebounce > 0) { tcToggleDebounce-- }
            else { scope.tcsActive = !!(s.electrics.tcs) }

            // Anti-lag system state (with debounce after toggle)
            if (alsToggleDebounce > 0) { alsToggleDebounce-- }
            else { scope.alsActive = !!(s.electrics.fueltech_als_enabled) }
            scope.alsFiring = !!(s.electrics.fueltech_als_firing)

            // ABS state (with debounce after toggle)
            if (absToggleDebounce > 0) { absToggleDebounce-- }
            else { scope.absActive = !!(s.electrics.abs) }
            scope.absInterfering = !!(s.electrics.absActive)
          }

          // Feature detection — detect forced induction (turbo or supercharger)
          var hasFI = !!(s.electrics && s.electrics.fueltech_active)
          var hasBoostData = turboRpm > 0 || boost > 0.5 || boostMax > 0 || hasFI
          if (!detectDone) {
            detectFrames++
            if (hasBoostData) { hasTurbo = true; scope.hasTurbo = true }
            if (turboRpm > 0) hasTurboRpm = true
            if (detectFrames >= 30) {
              detectDone = true
              lay = null
              applyGraphVisibility()
            }
          } else {
            if (!hasTurbo && hasBoostData) { hasTurbo = true; scope.hasTurbo = true; lay = null; applyGraphVisibility() }
            if (!hasTurboRpm && turboRpm > 0) { hasTurboRpm = true; lay = null; applyGraphVisibility() }
          }

          // Peak trackers
          if(boost>peakBoost)peakBoost=boost
          if(rpm>peakRPM)peakRPM=rpm
          scope.overboost=(tgt>0&&boost>tgt+2)

          // Shift light at 90% of max RPM
          scope.shiftLight = (rpm > maxRPM * shiftRpmPct && rpm > 1000)

          // Warnings
          updateWarnings()

          // Drag timer
          updateDragTimer()

          // Turbo timer
          updateTurboTimer()

          // Update display strings
          scope.rpmStr=Math.round(rpm).toString(); scope.boostStr=boost.toFixed(1)
          scope.tgtStr=tgt.toFixed(1); scope.peakStr=peakBoost.toFixed(1); scope.boostMaxStr=boostMax>0?boostMax.toFixed(1):''
          scope.peakRpmStr=Math.round(peakRPM).toString()
          scope.speedStr=Math.round(speed).toString()
          scope.loadStr=Math.round(engineLoad*100).toString()
          scope.fuelStr=Math.round(fuelVol).toString()
          scope.exhFlowStr=exhFlow.toFixed(1)
          scope.clutchStr=Math.round((1-clutchPos)*100).toString()
          scope.altStr=Math.round(altitude).toString()
          scope.odoStr=(odometer/1000).toFixed(1)
          scope.weightStr=Math.round(vehMass).toString()
          scope.cel=cel; scope.lowFuel=lowFuel

          // Brake temperatures from wheelThermalData or electrics
          var bts = []
          var wheelNames = ['FL','FR','RL','RR']
          if (s.wheelThermalData) {
            for (var wi = 0; wi < wheelNames.length; wi++) {
              var wn = wheelNames[wi]
              var wt = null
              // wheelThermalData can be indexed by name or number
              for (var wk in s.wheelThermalData) {
                var wd = s.wheelThermalData[wk]
                if (wd && wd.name && wd.name.indexOf(wn) >= 0 && wd.brakeSurfaceTemperature !== undefined) {
                  wt = wd.brakeSurfaceTemperature
                  break
                }
              }
              if (wt === null && s.electrics) {
                wt = s.electrics['brakeSurfaceTemperature_' + wn] || null
              }
              if (wt !== null) {
                var c = wt < 100 ? '#4488ff' : wt < 300 ? '#00cc55' : wt < 500 ? '#ffcc00' : '#ff2244'
                bts.push({val: Math.round(wt) + '°', color: c})
              }
            }
          }
          scope.brakeTemps = bts

          if (!lay) {
            var root = element[0]
            var W = root.offsetWidth || window.innerWidth || 800
            var H = root.offsetHeight || window.innerHeight || 600
            if (W > 100 && H > 100) doLayout(W, H)
          }
          if (lay) drawAll()
        })
      })
    }
  }
}])
