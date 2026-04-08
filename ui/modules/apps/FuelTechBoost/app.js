angular.module('beamng.apps')
.directive('fuelTechBoost', [function () {
  return {
    templateUrl: '/ui/modules/apps/FuelTechBoost/app.html',
    replace: true,
    restrict: 'EA',
    scope: true,
    link: function (scope, element) {
      var streamsList = ['electrics', 'engineInfo']
      StreamsManager.add(streamsList)
      // Force app to fill viewport
      var root = element[0]
      function forceFullscreen () {
        var parent = root.parentElement
        if (parent) {
          var pw = parent.offsetWidth || window.innerWidth
          var ph = parent.offsetHeight || window.innerHeight
          if (pw > 100 && ph > 100) {
            root.style.width = pw + 'px'
            root.style.height = ph + 'px'
            if (!lay || appW !== pw || appH !== ph) {
              lay = null
              doLayout(pw, ph)
              drawAll()
            }
          }
        }
      }
      var resizeObs = null
      try {
        resizeObs = new ResizeObserver(forceFullscreen)
        resizeObs.observe(root.parentElement || root)
      } catch(e) {}
      window.addEventListener('resize', forceFullscreen)

      scope.$on('$destroy', function () {
        StreamsManager.remove(streamsList)
        if (resizeObs) resizeObs.disconnect()
        window.removeEventListener('resize', forceFullscreen)
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
      var egt = 0
      var gear = 0
      var engineLoad = 0, fuelVol = 0, fuelCap = 0, exhFlow = 0
      var clutchPos = 0, altitude = 0, odometer = 0
      var cel = false, lowFuel = false

      // Feature detection: auto-hide gauges that never receive data
      var hasTurbo = false, hasEgt = false
      var detectFrames = 0, detectDone = false

      scope.hasTurbo = false; scope.hasEgt = false
      scope.active = false; scope.overboost = false
      scope.rpmStr = '0'; scope.boostStr = '0.0'; scope.tgtStr = '0.0'; scope.peakStr = '0.0'
      scope.peakRpmStr = '0'
      scope.speedStr = '0'; scope.gearStr = 'N'
      scope.preset = 'CUSTOM'
      scope.dtFeatures = []
      scope.dmodes = []
      scope.forceOB = false
      scope.loadStr = '0'; scope.fuelStr = '0'; scope.exhFlowStr = '0.0'
      scope.clutchStr = '0'; scope.altStr = '0'; scope.odoStr = '0.0'
      scope.cel = false; scope.lowFuel = false

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

      // Turbo timer
      scope.turboTimerActive = false
      scope.turboTimerStr = '0.0'
      var turboTimerStart = 0, turboTimerDuration = 30, turboWasRunning = false, lastTurboRpm = 0

      var map = [[2000,5],[3000,10],[4000,15],[5000,20],[6000,20],[7000,18]]
      var pwrData = null

      scope.$on('fueltechBoostTable', function (_, d) {
        if (d && d.length) { map = []; for (var i = 0; i < d.length; i++) map.push([d[i].rpm, d[i].psi]) }
      })
      scope.$on('fueltechPowerCurves', function (_, d) { if (d) { pwrData = d; drawPower() } })

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

      function requestData () {
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").getBoostTable()') } catch (e) {}
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").sendPowerCurves()') } catch (e) {}
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechDrivetrain").getInfo()') } catch (e) {}
      }
      requestData()

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

      // Drag timer
      scope.resetDrag = function () {
        dragActive = false; dragStart = 0; drag100t = 0; drag200t = 0
        scope.drag100str = '--.---'; scope.drag200str = '--.---'
        scope.drag100done = false; scope.drag200done = false
      }

      scope.showGraphs = true
      scope.toggleGraphs = function () {
        scope.showGraphs = !scope.showGraphs
        applyGraphVisibility()
      }

      function applyGraphVisibility () {
        var vis = scope.showGraphs ? '' : 'none'
        var els = ['.ft-c-thr','.ft-c-drag']
        // Turbo-only toggleable elements (boost map, power, presets)
        if (hasTurbo) { els.push('.ft-c-map','.ft-c-pwr') }
        // EGT only if available
        if (hasEgt) { els.push('.ft-c-egt') }
        for (var i = 0; i < els.length; i++) {
          var el = q(els[i])
          if (el) el.style.display = vis
        }
        // Always hide unavailable elements regardless of graph toggle
        if (!hasTurbo) {
          var hide = ['.ft-c-map','.ft-c-pwr','.ft-c-bst','.ft-c-trb']
          for (var j = 0; j < hide.length; j++) { var hel = q(hide[j]); if (hel) hel.style.display = 'none' }
        }
        if (!hasEgt) {
          var egtEl = q('.ft-c-egt'); if (egtEl) egtEl.style.display = 'none'
        }
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

      /* ==================== 12x12 GRID LAYOUT ==================== */
      /*
       *      1    2    3    4    5    6    7    8    9   10   11   12
       *  1  [HEADER BAR ─────────────────────────────────────────── ]
       *  2  │ G-FORCE     │                            │ RPM       │
       *  3  │             │                            │ GAUGE     │
       *  4  │             │                            │           │
       *  5  │ DRAG TIMER  │                            │ PSI       │
       *  6  │             │                            │ GAUGE     │
       *  7  │ THR  │ TRB  │ EGT  │                     │           │
       *  8  │      │      │      │                     │ OIL │ H2O │
       *  9  │ BOOST MAP          │ PWR/TQ       │      │     │     │
       * 10  │                    │              │ SPD/GEAR         │
       * 11  │                    │              │                  │
       * 12  [MIN] [MAX] [AUTOMAX] [CUSTOM]      │                  │
       */
      var GAP = 4
      var appW = 0, appH = 0
      var lay = null

      function q (sel) { return element[0].querySelector(sel) }

      var GRAPH_BG = 'background:rgba(6,8,14,0.6);border:1px solid rgba(24,28,40,0.3);border-radius:8px'

      function gridBox (el, col, row, cs, rs, extra) {
        if (!el) return
        var cw = (appW - GAP) / 12
        var ch = (appH - GAP) / 12
        var x = GAP + (col - 1) * cw
        var y = GAP + (row - 1) * ch
        var w = cs * cw - GAP
        var h = rs * ch - GAP
        el.style.cssText = 'position:absolute;box-sizing:border-box;left:'+x+'px;top:'+y+'px;width:'+w+'px;height:'+h+'px;overflow:hidden'
        if (extra) el.style.cssText += ';' + extra
      }

      function doLayout (W, H) {
        if (W < 100 || H < 100) return null
        if (lay && appW === W && appH === H) return lay
        appW = W; appH = H

        var root = element[0]
        root.style.cssText = 'position:relative;overflow:hidden;width:'+W+'px;height:'+H+'px;background:transparent'

        var cw = (W - GAP) / 12
        var ch = (H - GAP) / 12

        // Header: row 1, full width
        gridBox(q('.ft-hdr'), 1, 1, 12, 1,
          'display:flex;align-items:center;gap:10px;background:rgba(10,12,20,0.82);border:1px solid rgba(40,46,66,0.5);border-radius:6px;padding:0 14px')

        // Warning bar + Telemetry strip: stacked below header in row 2
        var hdrH = ch - GAP
        var subY = GAP + hdrH + 2
        var subW = W - GAP * 2
        var subH = Math.round(ch * 0.45)

        var warnEl = q('.ft-warn')
        if (warnEl) {
          warnEl.style.cssText = 'position:absolute;box-sizing:border-box;z-index:20;left:'+GAP+'px;top:'+subY+'px;width:'+subW+'px;height:'+subH+'px;overflow:hidden;display:flex;justify-content:center;align-items:center;gap:20px;padding:0 14px;background:rgba(255,34,68,0.15);border:1px solid rgba(255,34,68,0.4);border-radius:4px'
          subY += subH + 2
        }

        var telemEl = q('.ft-telem')
        if (telemEl) {
          telemEl.style.cssText = 'position:absolute;box-sizing:border-box;left:'+GAP+'px;top:'+subY+'px;width:'+subW+'px;height:'+subH+'px;overflow:hidden;display:flex;align-items:center;gap:12px;padding:0 14px;background:rgba(10,12,20,0.6);border:1px solid rgba(40,46,66,0.3);border-radius:4px'
        }

        // RPM gauge: rows 2-4, cols 10-12
        gridBox(q('.ft-c-rpm'), 10, 2, 3, 3)

        // PSI + TRB: rows 5-7, cols 10-12 side by side (like OIL/H2O)
        var rightX = GAP + 9 * cw
        var bstY = GAP + 4 * ch
        var bstTotalW = 3 * cw - GAP
        var bstH = 3 * ch - GAP
        var bstHalfW = (bstTotalW - GAP) / 2

        if (hasTurbo) {
          var bstEl = q('.ft-c-bst')
          if (bstEl) bstEl.style.cssText = 'position:absolute;box-sizing:border-box;left:'+rightX+'px;top:'+bstY+'px;width:'+bstHalfW+'px;height:'+bstH+'px;overflow:hidden'
          var trbEl = q('.ft-c-trb')
          if (trbEl) trbEl.style.cssText = 'position:absolute;box-sizing:border-box;left:'+(rightX+bstHalfW+GAP)+'px;top:'+bstY+'px;width:'+bstHalfW+'px;height:'+bstH+'px;overflow:hidden'
        }

        // OIL & H2O: rows 8-9, cols 10-12
        var ohY = GAP + 7 * ch
        var ohTotalW = 3 * cw - GAP
        var ohH = 2 * ch - GAP
        var halfW = (ohTotalW - GAP) / 2

        var oilEl = q('.ft-c-oil')
        if (oilEl) oilEl.style.cssText = 'position:absolute;box-sizing:border-box;left:'+rightX+'px;top:'+ohY+'px;width:'+halfW+'px;height:'+ohH+'px;overflow:hidden'

        var h2oEl = q('.ft-c-h2o')
        if (h2oEl) h2oEl.style.cssText = 'position:absolute;box-sizing:border-box;left:'+(rightX+halfW+GAP)+'px;top:'+ohY+'px;width:'+halfW+'px;height:'+ohH+'px;overflow:hidden'

        // G-Force: rows 3-4, cols 1-2 (below telem strip)
        gridBox(q('.ft-c-gforce'), 1, 3, 2, 2)

        // Drag Timer: rows 5-6, cols 1-2
        gridBox(q('.ft-c-drag'), 1, 5, 2, 2,
          'display:flex;flex-direction:column;justify-content:center;padding:4px;' + GRAPH_BG.replace('background:', 'background:'))

        // THR: rows 7-8, cols 1-2
        gridBox(q('.ft-c-thr'), 1, 7, 2, 2)
        // EGT: rows 7-8, cols 3-4 (if available)
        if (hasEgt) gridBox(q('.ft-c-egt'), 3, 7, 2, 2)

        // Boost Map & Power graph (turbo only)
        if (hasTurbo) {
          gridBox(q('.ft-c-map'), 1, 9, 5, 3, GRAPH_BG)
          gridBox(q('.ft-c-pwr'), 6, 9, 3, 3, GRAPH_BG)
        }

        // Speed/Gear: rows 10-12, cols 9-12
        gridBox(q('.ft-c-spd'), 9, 10, 4, 3,
          'display:flex;flex-direction:column;align-items:center;justify-content:center')

        // Preset buttons: pinned to bottom, thin strip (turbo only)
        var barEl = q('.ft-bar')
        if (barEl) {
          if (hasTurbo) {
            var barW = 8 * cw - GAP
            barEl.style.cssText = 'position:absolute;box-sizing:border-box;left:'+GAP+'px;bottom:'+GAP+'px;width:'+barW+'px;height:14px;display:flex;gap:3px;align-items:center'
          } else {
            barEl.style.display = 'none'
          }
        }

        // Turbo timer: centered overlay
        var ttEl = q('.ft-turbo-timer')
        if (ttEl) {
          var ttW = 4 * cw, ttH = 2 * ch
          var ttX = (W - ttW) / 2, ttY = (H - ttH) / 2
          ttEl.style.cssText = 'position:absolute;z-index:18;left:'+ttX+'px;top:'+ttY+'px;width:'+ttW+'px;height:'+ttH+'px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(10,12,20,0.85);border:1px solid rgba(255,102,0,0.3);border-radius:10px;pointer-events:none'
        }

        // Canvas sizes
        var gaugeW = 3 * cw - GAP
        var gaugeH = 3 * ch - GAP
        var thrW = 2 * cw - GAP
        var thrH = 2 * ch - GAP
        var mapW = 5 * cw - GAP
        var mapH = 3 * ch - GAP
        var pwrW = 3 * cw - GAP
        var gfW = 2 * cw - GAP
        var gfH = 2 * ch - GAP

        lay = {
          gaugeW: gaugeW, gaugeH: gaugeH,
          bstW: bstHalfW, bstH: bstH,
          oilW: halfW, oilH: ohH,
          thrW: thrW, thrH: thrH,
          graphW: mapW, graphH: mapH,
          pwrW: pwrW,
          gfW: gfW, gfH: gfH
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
      var cvsEgt = null, ctxEgt = null
      var dpr = window.devicePixelRatio || 1

      function initCanvases () {
        if (!cvsRpm) { try { cvsRpm = q('.ft-cv-rpm'); if (cvsRpm) ctxRpm = cvsRpm.getContext('2d') } catch(e){} }
        if (!cvsBst || !cvsBst.parentNode) { cvsBst = null; ctxBst = null; try { cvsBst = q('.ft-cv-bst'); if (cvsBst) ctxBst = cvsBst.getContext('2d') } catch(e){} }
        if (!cvsOil) { try { cvsOil = q('.ft-cv-oil'); if (cvsOil) ctxOil = cvsOil.getContext('2d') } catch(e){} }
        if (!cvsH2o) { try { cvsH2o = q('.ft-cv-h2o'); if (cvsH2o) ctxH2o = cvsH2o.getContext('2d') } catch(e){} }
        if (!cvsThr) { try { cvsThr = q('.ft-cv-thr'); if (cvsThr) ctxThr = cvsThr.getContext('2d') } catch(e){} }
        if (!cvsTrb) { try { cvsTrb = q('.ft-cv-trb'); if (cvsTrb) ctxTrb = cvsTrb.getContext('2d') } catch(e){} }
        if (!cvsEgt) { try { cvsEgt = q('.ft-cv-egt'); if (cvsEgt) ctxEgt = cvsEgt.getContext('2d') } catch(e){} }
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
            var fs=Math.max(Math.min(r*0.13,11),6)
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
        ctx.fillStyle='#b0b8d0';ctx.font=Math.max(r*0.14,7).toFixed(0)+'px Consolas,monospace';ctx.fillText(unit,cx,cy+fS*0.55)
        ctx.fillStyle='#c0c8e0';ctx.font='700 '+Math.max(r*0.11,6).toFixed(0)+'px Consolas,monospace';ctx.fillText(label,cx,h-Math.max(r*0.08,4))
      }

      /* ==================== MINI GAUGE (OIL/H2O/THR/TRB/EGT) ==================== */
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
        ctx.fillStyle='#ffffff';ctx.font='700 '+Math.max(fS,9).toFixed(0)+'px Consolas,monospace'
        ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(valTxt,cx,cy)
        ctx.fillStyle='#b0b8d0';ctx.font=Math.max(fS*0.55,7).toFixed(0)+'px Consolas,monospace';ctx.fillText(unit,cx,cy+fS*0.7)
        ctx.fillStyle='#c0c8e0';ctx.font='700 '+Math.max(fS*0.5,6).toFixed(0)+'px Consolas,monospace';ctx.fillText(label,cx,h-Math.max(fS*0.25,3))
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
        drawMiniGauge(ctxBst,sz.w,sz.h,Math.max(boost,0),bstMax,boost.toFixed(1),'PSI','BOOST','#00bbff','#ff7700')
      }
      function drawTurboRpmGauge () {
        initCanvases(); if(!ctxTrb||!lay) return
        var sz=sizeCvs(cvsTrb,lay.bstW,lay.bstH); if(!sz) return
        var tv=turboRpm>1000?(turboRpm/1000).toFixed(1)+'k':Math.round(turboRpm).toString()
        drawMiniGauge(ctxTrb,sz.w,sz.h,turboRpm,200000,tv,'rpm','TURBO','#224466','#00bbff')
      }

      /* OIL & H2O */
      function drawOilH2oGauges () {
        initCanvases(); if(!lay) return
        var ms
        if(ctxOil){ms=sizeCvs(cvsOil,lay.oilW,lay.oilH);if(ms) drawMiniGauge(ctxOil,ms.w,ms.h,oilT,150,Math.round(oilT).toString(),'°C','OIL','#00aa44','#ff8800')}
        if(ctxH2o){ms=sizeCvs(cvsH2o,lay.oilW,lay.oilH);if(ms) drawMiniGauge(ctxH2o,ms.w,ms.h,h2oT,130,Math.round(h2oT).toString(),'°C','H2O','#0077ee','#ff3344')}
      }

      /* THR & EGT */
      function drawThrTrbGauges () {
        initCanvases(); if(!lay) return
        var ms
        if(ctxThr){ms=sizeCvs(cvsThr,lay.thrW,lay.thrH);if(ms) drawMiniGauge(ctxThr,ms.w,ms.h,throttle*100,100,Math.round(throttle*100).toString(),'%','THR','#225533','#00ff88')}
        if(hasEgt&&ctxEgt){ms=sizeCvs(cvsEgt,lay.thrW,lay.thrH);if(ms) drawMiniGauge(ctxEgt,ms.w,ms.h,egt,1000,Math.round(egt).toString(),'°C','EGT','#884400','#ff4400')}
      }

      /* ==================== G-FORCE METER ==================== */
      function drawGForce () {
        initCanvases(); if(!ctxGf||!lay) return
        var sz = sizeCvs(cvsGf, lay.gfW, lay.gfH); if(!sz) return
        var w = sz.w, h = sz.h, ctx = ctxGf
        ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h)

        var fs = cl(Math.min(w,h)*0.1, 7, 11)
        var cx = w/2, cy = h/2 - fs*0.6
        var r = Math.min(w,h)*0.4
        var maxG = 2.0

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
        var dotR = cl(r*0.07, 2, 6)
        ctx.shadowColor = dotC; ctx.shadowBlur = dotR*3
        ctx.beginPath(); ctx.arc(cx+gx, cy+gy, dotR, 0, 6.283); ctx.fillStyle = dotC; ctx.fill()
        ctx.shadowBlur = 0

        // G value
        ctx.font = '700 '+fs.toFixed(0)+'px Consolas,monospace'; ctx.textAlign='center'; ctx.textBaseline='middle'
        ctx.fillStyle = '#ffffff'; ctx.fillText(gMag.toFixed(2)+'G', cx, cy+r+fs*1.1)
      }

      /* ==================== GRID HELPER ==================== */
      function drawGrid (ctx,w,h,maxX,maxY,extraRight) {
        var fs=cl(w*0.025,7,12),pl=Math.round(fs*3.2)
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
          if(hot){ctx.beginPath();ctx.arc(bx,by,dr+6,0,6.283);ctx.fillStyle='rgba(255,102,0,0.08)';ctx.fill()}
          ctx.beginPath();ctx.arc(bx,by,dr+1,0,6.283);ctx.strokeStyle=hot?'#ff8833':'rgba(255,102,0,0.3)';ctx.lineWidth=1;ctx.stroke()
          ctx.beginPath();ctx.arc(bx,by,dr,0,6.283);ctx.fillStyle=hot?'#ff8833':'#ff6600';ctx.fill()
          ctx.beginPath();ctx.arc(bx,by,dr*0.3,0,6.283);ctx.fillStyle='rgba(6,8,14,0.9)';ctx.fill()
          if(hot){ctx.font='bold '+cl(g.fs+1,8,12).toFixed(0)+'px Consolas,monospace';ctx.fillStyle='#dde0ec';ctx.textAlign='center'
            ctx.fillText(map[i][0]+' / '+map[i][1].toFixed(1)+' PSI',bx,by-dr-6)}
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
        initCanvases(); if(!ctxPwr||!pwrData||!lay) return
        var sz=sizeCvs(cvsPwr,lay.pwrW,lay.graphH); if(!sz) return
        var w=sz.w,h=sz.h,ctx=ctxPwr
        var maxNm=0,maxHP=0,eR=pwrData.maxRPM||7000
        var td=pwrData.torque||[],pd=pwrData.power||[],bt=pwrData.baseTorque||[],bp=pwrData.basePower||[]
        if(!td.length||!pd.length) return

        for(var i=0;i<td.length;i++){if(td[i].nm>maxNm)maxNm=td[i].nm;if(i<pd.length&&pd[i].hp>maxHP)maxHP=pd[i].hp}
        for(var i=0;i<bt.length;i++){if(bt[i].nm>maxNm)maxNm=bt[i].nm;if(i<bp.length&&bp[i].hp>maxHP)maxHP=bp[i].hp}

        var tqRating = pwrData.maxTorqueRating || -1
        if (tqRating > 0 && tqRating > maxNm) maxNm = tqRating * 1.05

        maxNm=Math.ceil(maxNm/50)*50||400;maxHP=Math.ceil(maxHP/25)*25||200
        var g=drawGrid(ctx,w,h,eR,maxNm,true); if(!g) return
        var gp=g.p,ggw=g.gw,ggh=g.gh
        function ttx(r){return gp.l+cl(r/eR,0,1)*ggw}
        function tty(nm){return gp.t+ggh-cl(nm/maxNm,0,1)*ggh}
        function pty(hp){return gp.t+ggh-cl(hp/maxHP,0,1)*ggh}

        if (tqRating > 0) {
          var limY = tty(tqRating)
          ctx.save()
          ctx.fillStyle = 'rgba(255,34,68,0.04)'
          ctx.fillRect(gp.l, gp.t, ggw, limY - gp.t)
          ctx.setLineDash([6,4])
          ctx.beginPath(); ctx.moveTo(gp.l, limY); ctx.lineTo(gp.l+ggw, limY)
          ctx.strokeStyle = 'rgba(255,34,68,0.5)'; ctx.lineWidth = 1.2; ctx.stroke()
          ctx.restore()
          ctx.font = cl(g.fs-1,7,10).toFixed(0)+'px Consolas,monospace'
          ctx.fillStyle = 'rgba(255,34,68,0.6)'; ctx.textAlign = 'right'
          ctx.fillText('MAX '+tqRating+' Nm', gp.l+ggw-3, limY-3)
        }

        var stockPkTq = pwrData.stockPeakTorque || 0
        if (stockPkTq > 0) {
          var spY = tty(stockPkTq)
          ctx.save(); ctx.setLineDash([3,5])
          ctx.beginPath(); ctx.moveTo(gp.l, spY); ctx.lineTo(gp.l+ggw, spY)
          ctx.strokeStyle = 'rgba(255,160,60,0.25)'; ctx.lineWidth = 0.8; ctx.stroke()
          ctx.restore()
          ctx.font = cl(g.fs-2,6,9).toFixed(0)+'px Consolas,monospace'
          ctx.fillStyle = 'rgba(255,160,60,0.4)'; ctx.textAlign = 'left'
          ctx.fillText('STOCK '+stockPkTq+' Nm', gp.l+3, spY-2)
        }

        var lw2=cl(w*0.004,1,2)
        function dc(data,yF,key,col,dash){ctx.save();if(dash)ctx.setLineDash([4,3]);ctx.beginPath()
          for(var i=0;i<data.length;i++){var px=ttx(data[i].rpm),py=yF(data[i][key]);if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py)}
          ctx.strokeStyle=col;ctx.lineWidth=lw2;ctx.lineJoin='round';ctx.stroke();ctx.restore()}
        dc(bt,tty,'nm','rgba(255,100,100,0.15)',true);dc(bp,pty,'hp','rgba(100,150,255,0.15)',true)
        dc(td,tty,'nm','#ff6666',false);dc(pd,pty,'hp','#6699ff',false)

        var lx=gp.l+6,ly=gp.t+8,lfs=cl(g.fs-1,7,10).toFixed(0)
        ctx.font=lfs+'px Consolas,monospace'; ctx.textAlign='left'
        var projPkTq = pwrData.projPeakTorque || 0
        var projPkHP = pwrData.projPeakHP || 0
        ctx.fillStyle='#ff6666'; ctx.fillRect(lx,ly-4,7,2)
        ctx.fillText('TQ Nm'+(projPkTq>0?' ('+projPkTq+')':''),lx+10,ly)
        ctx.fillStyle='#6699ff'; ctx.fillRect(lx,ly+8,7,2)
        ctx.fillText('HP'+(projPkHP>0?' ('+projPkHP+')':''),lx+10,ly+12)
        ctx.fillStyle='#6a7498'
        ctx.fillText('-- stock',lx+10,ly+24)

        if (tqRating > 0) {
          for(var i=0;i<td.length;i++){
            if(td[i].nm > tqRating){
              var px=ttx(td[i].rpm), py=tty(td[i].nm), limYY=tty(tqRating)
              ctx.fillStyle='rgba(255,34,68,0.08)'
              ctx.fillRect(px-2,py,4,limYY-py)
            }
          }
        }

        ctx.textAlign='left'; ctx.fillStyle='#5a6280'
        var nY = h > 100 ? 4 : 2
        for(var i=0;i<=nY;i++){ctx.fillText((maxHP-maxHP/nY*i).toFixed(0),w-gp.r+3,gp.t+ggh/nY*i+g.fs*0.35)}

        if(scope.active&&rpm>50){var rx=ttx(rpm)
          var vg2=ctx.createLinearGradient(0,gp.t,0,gp.t+ggh)
          vg2.addColorStop(0,'rgba(0,255,136,0)');vg2.addColorStop(0.5,'rgba(0,255,136,0.04)');vg2.addColorStop(1,'rgba(0,255,136,0)')
          ctx.fillStyle=vg2;ctx.fillRect(rx-0.5,gp.t,1,ggh)

          // Live power/torque — use BASE (stock) curve scaled by actual boost ratio and load
          var baseNm=0,baseHP=0
          for(var li=0;li<bt.length-1;li++){
            if(rpm>=bt[li].rpm&&rpm<=bt[li+1].rpm){
              var lt=(rpm-bt[li].rpm)/(bt[li+1].rpm-bt[li].rpm)
              baseNm=bt[li].nm+(bt[li+1].nm-bt[li].nm)*lt
              baseHP=bp[li].hp+(bp[li+1].hp-bp[li].hp)*lt
              break
            }
          }
          // Scale by actual boost ratio (actual/stock) and engine load
          var bMaxRef = boostMax > 0 ? boostMax : 1
          var actualRatio = boost > 0 ? boost / bMaxRef : (boost > -5 ? 1 : 0.5)
          var liveNm=baseNm*actualRatio*engineLoad
          var liveHP=baseHP*actualRatio*engineLoad

          var dotR2=cl(w*0.008,3,6)
          // Torque dot (red)
          if(liveNm>0){
            var tDotY=tty(liveNm)
            ctx.shadowColor='#ff6666';ctx.shadowBlur=dotR2*3
            ctx.beginPath();ctx.arc(rx,tDotY,dotR2,0,6.283);ctx.fillStyle='#ff6666';ctx.fill()
            ctx.shadowBlur=0
          }
          // Power dot (blue)
          if(liveHP>0){
            var pDotY=pty(liveHP)
            ctx.shadowColor='#6699ff';ctx.shadowBlur=dotR2*3
            ctx.beginPath();ctx.arc(rx,pDotY,dotR2,0,6.283);ctx.fillStyle='#6699ff';ctx.fill()
            ctx.shadowBlur=0
          }
          // Live readout text
          var lfx=gp.l+ggw-4, lfy=gp.t+ggh-4
          ctx.font='700 '+cl(g.fs,7,11).toFixed(0)+'px Consolas,monospace'
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
        drawRpmGauge(); drawOilH2oGauges(); drawGForce()
        if (hasTurbo) { drawBoostGauge(); drawTurboRpmGauge() }
        if (scope.showGraphs) {
          drawThrTrbGauges()
          if (hasTurbo) { drawBoostMap(); drawPower() }
        }
        applyGraphVisibility()
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
        if (egt > 850) w.push('EGT ' + Math.round(egt) + '°C')
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
      function updateTurboTimer () {
        var turboRunning = turboRpm > 5000
        if (turboRunning) {
          turboWasRunning = true
          lastTurboRpm = turboRpm
        }
        // Engine off but turbo was spinning fast
        if (turboWasRunning && rpm < 100 && lastTurboRpm > 10000) {
          if (!scope.turboTimerActive) {
            scope.turboTimerActive = true
            turboTimerStart = Date.now()
            turboTimerDuration = cl(lastTurboRpm / 10000, 10, 60)
          }
          var elapsed = (Date.now() - turboTimerStart) / 1000
          var remaining = Math.max(0, turboTimerDuration - elapsed)
          scope.turboTimerStr = remaining.toFixed(1)
          if (remaining <= 0) {
            scope.turboTimerActive = false
            turboWasRunning = false
          }
        } else if (rpm > 500) {
          // Engine running again, cancel timer
          scope.turboTimerActive = false
          if (turboRpm < 1000) turboWasRunning = false
        }
      }

      /* ==================== STREAMS ==================== */
      scope.$on('streamsUpdate', function (_, s) {
        if (!s) return
        scope.$evalAsync(function () {
          if (s.engineInfo) { rpm = s.engineInfo[4]||0; if (s.engineInfo[1]&&s.engineInfo[1]>1000) maxRPM = s.engineInfo[1] }
          if (s.electrics) {
            lastElectrics = s.electrics
            boost=s.electrics.turboBoost||0; tgt=s.electrics.fueltech_targetBoost||0; boostMax=s.electrics.fueltech_boostMax||s.electrics.turboBoostMax||s.electrics.boostMax||0
            speed=(s.electrics.wheelspeed||s.electrics.airspeed||0)*3.6
            oilT=s.electrics.oiltemp||0; h2oT=s.electrics.watertemp||0
            throttle=s.electrics.throttle||0; turboRpm=s.electrics.turboRPM||0
            gForceX=(s.electrics.accXSmooth||s.electrics.accX||0)/9.81
            gForceY=(s.electrics.accYSmooth||s.electrics.accY||0)/9.81
            egt=s.electrics.exhaustTemperature||s.electrics.egt||0
            engineLoad=s.electrics.engineLoad||0
            fuelVol=s.electrics.fuelVolume||0; fuelCap=s.electrics.fuelCapacity||1
            exhFlow=s.electrics.exhaustFlow||0
            clutchPos=s.electrics.clutch||0
            altitude=s.electrics.altitude||0
            odometer=s.electrics.odometer||0
            cel=!!(s.electrics.checkengine)
            lowFuel=!!(s.electrics.lowfuel)
            scope.active=!!(s.electrics.fueltech_active)
            var gv=s.electrics.gear_M; if(gv===undefined)gv=s.electrics.gearIndex; if(gv===undefined)gv=0
            gear = gv
            if(gv<0)scope.gearStr='R'; else if(gv===0)scope.gearStr='N'; else scope.gearStr=gv.toString()

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
              if (ev !== undefined) dm.active = !!ev
            }
          }

          // Feature detection — sample first 30 frames to detect turbo/EGT
          if (!detectDone) {
            detectFrames++
            if (turboRpm > 0 || boost > 0.5 || (s.electrics && s.electrics.turboBoost > 0)) { hasTurbo = true; scope.hasTurbo = true }
            if (egt > 0) { hasEgt = true; scope.hasEgt = true }
            if (detectFrames >= 30) {
              detectDone = true
              lay = null // force re-layout to adjust for hidden elements
              applyGraphVisibility()
            }
          } else {
            // Late detection: if turbo/EGT appears after initial scan
            if (!hasTurbo && (turboRpm > 0 || boost > 0.5)) { hasTurbo = true; scope.hasTurbo = true; lay = null; applyGraphVisibility() }
            if (!hasEgt && egt > 0) { hasEgt = true; scope.hasEgt = true; lay = null; applyGraphVisibility() }
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
          scope.cel=cel; scope.lowFuel=lowFuel

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
