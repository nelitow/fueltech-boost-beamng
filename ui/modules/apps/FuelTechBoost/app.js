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
      scope.$on('$destroy', function () {
        StreamsManager.remove(streamsList)
        if (cvsBoost) {
          cvsBoost.removeEventListener('mousedown', onDown)
          cvsBoost.removeEventListener('mousemove', onMove)
          cvsBoost.removeEventListener('mouseup', onUp)
          cvsBoost.removeEventListener('mouseleave', onUp)
        }
      })

      /* ---- state ---- */
      var rpm = 0, boost = 0, tgt = 0
      var maxRPM = 8000, maxPSI = 40

      scope.active   = false
      scope.rpmStr   = '0'
      scope.boostStr = '0.0'
      scope.tgtStr   = '0.0'

      /* boost map — mutable */
      var map = [
        [2000, 5], [3000, 10], [4000, 15],
        [5000, 20], [6000, 20], [7000, 18]
      ]

      /* power/torque data from Lua */
      var pwrData = null

      scope.$on('fueltechBoostTable', function (_, data) {
        if (data && data.length) {
          map = []
          for (var i = 0; i < data.length; i++) map.push([data[i].rpm, data[i].psi])
        }
      })

      scope.$on('fueltechPowerCurves', function (_, data) {
        if (data) { pwrData = data; drawPower() }
      })

      function requestData () {
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").getBoostTable()') } catch (e) {}
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").sendPowerCurves()') } catch (e) {}
      }
      requestData()

      function cl (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

      function lerpMap (r) {
        if (map.length === 0) return 0
        if (r <= map[0][0]) return map[0][1]
        if (r >= map[map.length - 1][0]) return map[map.length - 1][1]
        for (var i = 0; i < map.length - 1; i++) {
          if (r >= map[i][0] && r <= map[i + 1][0]) {
            var t = (r - map[i][0]) / (map[i + 1][0] - map[i][0])
            return map[i][1] + (map[i + 1][1] - map[i][1]) * t
          }
        }
        return 0
      }

      /* ---- canvases ---- */
      var cvsBoost = null, ctxBoost = null
      var cvsPower = null, ctxPower = null
      var dpr = window.devicePixelRatio || 1

      function initCanvases () {
        if (!cvsBoost) {
          try {
            cvsBoost = element[0].querySelector('.ft-cv-boost')
            if (cvsBoost) {
              ctxBoost = cvsBoost.getContext('2d')
              cvsBoost.addEventListener('mousedown', onDown)
              cvsBoost.addEventListener('mousemove', onMove)
              cvsBoost.addEventListener('mouseup', onUp)
              cvsBoost.addEventListener('mouseleave', onUp)
            }
          } catch (e) {}
        }
        if (!cvsPower) {
          try {
            cvsPower = element[0].querySelector('.ft-cv-power')
            if (cvsPower) ctxPower = cvsPower.getContext('2d')
          } catch (e) {}
        }
      }

      /* size a canvas from its .ft-chart parent */
      function sizeCanvas (cvs) {
        var box = cvs.parentElement
        if (!box) return null
        var w = box.clientWidth, h = box.clientHeight
        if (w < 20 || h < 20) return null
        cvs.width = w * dpr; cvs.height = h * dpr
        return { w: w, h: h }
      }

      /* ---- shared drawing helpers ---- */
      function drawGrid (ctx, w, h, maxX, maxY, unitX, unitY) {
        var fs = cl(w * 0.038, 6, 10)
        var pl = Math.round(fs * 3.2)
        var p = { l: pl, r: 4, t: 3, b: Math.round(fs * 1.6) }
        var gw = w - p.l - p.r, gh = h - p.t - p.b
        var nY = h > 70 ? 4 : 2, nX = w > 140 ? 4 : 2

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, w, h)

        ctx.strokeStyle = '#141414'; ctx.lineWidth = 0.5
        for (var i = 0; i <= nY; i++) {
          var yy = p.t + gh / nY * i
          ctx.beginPath(); ctx.moveTo(p.l, yy); ctx.lineTo(w - p.r, yy); ctx.stroke()
        }
        for (var i = 0; i <= nX * 2; i++) {
          var xx = p.l + gw / (nX * 2) * i
          ctx.beginPath(); ctx.moveTo(xx, p.t); ctx.lineTo(xx, p.t + gh); ctx.stroke()
        }

        ctx.font = fs.toFixed(0) + 'px Consolas,monospace'; ctx.fillStyle = '#333'
        ctx.textAlign = 'right'
        for (var i = 0; i <= nY; i++) {
          var val = maxY - maxY / nY * i
          ctx.fillText(val.toFixed(0) + (unitY || ''), p.l - 2, p.t + gh / nY * i + fs * 0.38)
        }
        ctx.textAlign = 'center'
        for (var i = 0; i <= nX; i++) {
          var rv = maxX / nX * i
          ctx.fillText(rv >= 1000 ? (rv / 1000).toFixed(0) + 'k' : '0', p.l + gw / nX * i, h - p.b + fs + 1)
        }

        return { p: p, gw: gw, gh: gh, fs: fs }
      }

      /* ========== BOOST MAP DRAWING ========== */
      /* cached coords for interaction */
      var BP = {}, BGW = 0, BGH = 0, BW = 0, BH = 0

      function drawBoost () {
        initCanvases()
        if (!ctxBoost) return
        var sz = sizeCanvas(cvsBoost)
        if (!sz) return
        BW = sz.w; BH = sz.h

        var g = drawGrid(ctxBoost, BW, BH, maxRPM, maxPSI)
        if (!g) return
        BP = g.p; BGW = g.gw; BGH = g.gh
        var ctx = ctxBoost

        function tx (r) { return BP.l + cl(r / maxRPM, 0, 1) * BGW }
        function ty (v) { return BP.t + BGH - cl(v / maxPSI, 0, 1) * BGH }

        /* interpolated curve */
        var steps = Math.round(BGW), step = maxRPM / steps
        ctx.beginPath()
        ctx.moveTo(tx(0), ty(0))
        for (var i = 0; i <= steps; i++) ctx.lineTo(tx(step * i), ty(lerpMap(step * i)))
        ctx.lineTo(tx(maxRPM), ty(0)); ctx.closePath()
        var grd = ctx.createLinearGradient(0, BP.t, 0, BP.t + BGH)
        grd.addColorStop(0, 'rgba(255,102,0,0.13)'); grd.addColorStop(1, 'rgba(255,102,0,0.01)')
        ctx.fillStyle = grd; ctx.fill()

        ctx.beginPath()
        ctx.moveTo(tx(0), ty(lerpMap(0)))
        for (var i = 1; i <= steps; i++) ctx.lineTo(tx(step * i), ty(lerpMap(step * i)))
        var lw = cl(BW * 0.007, 1, 2.5)
        ctx.strokeStyle = '#ff6600'; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke()

        /* breakpoints */
        var dr = cl(BW * 0.014, 3, 6)
        for (var i = 0; i < map.length; i++) {
          var bx = tx(map[i][0]), by = ty(map[i][1])
          var hot = (i === hoverIdx || i === dragIdx)
          if (hot) { ctx.beginPath(); ctx.arc(bx, by, dr + 5, 0, 6.283); ctx.fillStyle = 'rgba(255,102,0,0.12)'; ctx.fill() }
          ctx.beginPath(); ctx.arc(bx, by, dr, 0, 6.283); ctx.fillStyle = hot ? '#ff8833' : '#ff6600'; ctx.fill()
          ctx.beginPath(); ctx.arc(bx, by, dr * 0.35, 0, 6.283); ctx.fillStyle = '#0a0a0a'; ctx.fill()
          if (hot) {
            ctx.font = 'bold ' + cl(g.fs + 1, 8, 11).toFixed(0) + 'px Consolas,monospace'
            ctx.fillStyle = '#fff'; ctx.textAlign = 'center'
            ctx.fillText(map[i][0] + ' / ' + map[i][1].toFixed(1), bx, by - dr - 4)
          }
        }

        /* live indicators */
        if (!scope.active || rpm < 50) return
        var cx = cl(tx(rpm), BP.l, BW - BP.r), cy = cl(ty(boost), BP.t, BP.t + BGH), tgy = cl(ty(tgt), BP.t, BP.t + BGH)

        var vg = ctx.createLinearGradient(0, BP.t, 0, BP.t + BGH)
        vg.addColorStop(0, 'rgba(0,255,102,0)'); vg.addColorStop(0.5, 'rgba(0,255,102,0.08)'); vg.addColorStop(1, 'rgba(0,255,102,0)')
        ctx.fillStyle = vg; ctx.fillRect(cx - 0.5, BP.t, 1, BGH)

        ctx.save(); ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(0,204,255,0.2)'; ctx.lineWidth = 0.5
        ctx.beginPath(); ctx.moveTo(BP.l, cy); ctx.lineTo(BW - BP.r, cy); ctx.stroke(); ctx.restore()

        ctx.beginPath(); ctx.arc(cx, tgy, dr * 1.6, 0, 6.283); ctx.strokeStyle = 'rgba(255,102,0,0.6)'; ctx.lineWidth = cl(lw * 0.7, 0.5, 1.5); ctx.stroke()

        if (Math.abs(cy - tgy) > dr * 2) {
          ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 0.5
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, tgy); ctx.stroke(); ctx.restore()
        }

        ctx.shadowColor = '#00ccff'; ctx.shadowBlur = cl(BW * 0.025, 3, 8)
        ctx.beginPath(); ctx.arc(cx, cy, dr * 1.2, 0, 6.283); ctx.fillStyle = '#00ccff'; ctx.fill()
        ctx.shadowBlur = 0
      }

      /* ========== POWER/TORQUE DRAWING ========== */
      function drawPower () {
        initCanvases()
        if (!ctxPower || !pwrData) return
        var sz = sizeCanvas(cvsPower)
        if (!sz) return
        var w = sz.w, h = sz.h
        var ctx = ctxPower

        /* find max values for scaling */
        var maxNm = 0, maxKw = 0, engMaxRPM = pwrData.maxRPM || 7000
        var td = pwrData.torque, pd = pwrData.power, bt = pwrData.baseTorque, bp = pwrData.basePower
        for (var i = 0; i < td.length; i++) {
          if (td[i].nm > maxNm) maxNm = td[i].nm
          if (pd[i].kw > maxKw) maxKw = pd[i].kw
        }
        for (var i = 0; i < bt.length; i++) {
          if (bt[i].nm > maxNm) maxNm = bt[i].nm
          if (bp[i].kw > maxKw) maxKw = bp[i].kw
        }
        maxNm = Math.ceil(maxNm / 50) * 50 || 400
        maxKw = Math.ceil(maxKw / 25) * 25 || 200

        /* use torque scale for Y axis */
        var g = drawGrid(ctx, w, h, engMaxRPM, maxNm, 'k', '')
        if (!g) return
        var gp = g.p, ggw = g.gw, ggh = g.gh

        function ttx (r) { return gp.l + cl(r / engMaxRPM, 0, 1) * ggw }
        function tty (nm) { return gp.t + ggh - cl(nm / maxNm, 0, 1) * ggh }
        function pty (kw) { return gp.t + ggh - cl(kw / maxKw, 0, 1) * ggh }

        /* right axis labels for kW */
        ctx.textAlign = 'left'; ctx.fillStyle = '#333'
        var nY = h > 70 ? 4 : 2
        for (var i = 0; i <= nY; i++) {
          var kv = maxKw - maxKw / nY * i
          ctx.fillText(kv.toFixed(0), w - gp.r + 1, gp.t + ggh / nY * i + g.fs * 0.38)
        }

        var lw = cl(w * 0.006, 0.8, 2)

        /* draw a curve helper */
        function drawCurve (data, yFn, key, color, dashed) {
          ctx.save()
          if (dashed) ctx.setLineDash([4, 3])
          ctx.beginPath()
          for (var i = 0; i < data.length; i++) {
            var px = ttx(data[i].rpm), py = yFn(data[i][key])
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
          }
          ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke()
          ctx.restore()
        }

        /* base curves (dashed) */
        drawCurve(bt, tty, 'nm', 'rgba(255,100,100,0.25)', true)
        drawCurve(bp, pty, 'kw', 'rgba(100,150,255,0.25)', true)

        /* projected curves (solid) */
        drawCurve(td, tty, 'nm', '#ff6666', false)
        drawCurve(pd, pty, 'kw', '#6699ff', false)

        /* legend */
        var lx = gp.l + 6, ly = gp.t + 10
        ctx.font = cl(g.fs, 7, 9).toFixed(0) + 'px Consolas,monospace'
        ctx.fillStyle = '#ff6666'; ctx.fillText('Torque (Nm)', lx + 10, ly)
        ctx.fillStyle = '#6699ff'; ctx.fillText('Power (kW)', lx + 10, ly + 11)
        ctx.fillStyle = '#555';    ctx.fillText('--- Stock', lx + 10, ly + 22)

        ctx.fillStyle = '#ff6666'; ctx.fillRect(lx, ly - 5, 7, 2)
        ctx.fillStyle = '#6699ff'; ctx.fillRect(lx, ly + 6, 7, 2)
        ctx.save(); ctx.setLineDash([2, 2]); ctx.strokeStyle = '#555'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(lx, ly + 18); ctx.lineTo(lx + 7, ly + 18); ctx.stroke()
        ctx.restore()

        /* RPM indicator */
        if (scope.active && rpm > 50) {
          var rx = ttx(rpm)
          var vg2 = ctx.createLinearGradient(0, gp.t, 0, gp.t + ggh)
          vg2.addColorStop(0, 'rgba(0,255,102,0)'); vg2.addColorStop(0.5, 'rgba(0,255,102,0.06)'); vg2.addColorStop(1, 'rgba(0,255,102,0)')
          ctx.fillStyle = vg2; ctx.fillRect(rx - 0.5, gp.t, 1, ggh)
        }
      }

      /* ========== DRAG INTERACTION (boost canvas only) ========== */
      var dragIdx = -1, hoverIdx = -1, GRAB_R = 14

      function boostTx (r) { return BP.l + cl(r / maxRPM, 0, 1) * BGW }
      function boostTy (v) { return BP.t + BGH - cl(v / maxPSI, 0, 1) * BGH }
      function fromX (px) { return cl((px - BP.l) / BGW, 0, 1) * maxRPM }
      function fromY (py) { return cl((BP.t + BGH - py) / BGH, 0, 1) * maxPSI }

      function nearestPoint (mx, my) {
        var best = -1, bestD = GRAB_R * GRAB_R
        for (var i = 0; i < map.length; i++) {
          var dx = boostTx(map[i][0]) - mx, dy = boostTy(map[i][1]) - my
          var d = dx * dx + dy * dy
          if (d < bestD) { bestD = d; best = i }
        }
        return best
      }

      function onDown (e) {
        var rect = cvsBoost.getBoundingClientRect()
        dragIdx = nearestPoint(e.clientX - rect.left, e.clientY - rect.top)
      }

      function onMove (e) {
        var rect = cvsBoost.getBoundingClientRect()
        var mx = e.clientX - rect.left, my = e.clientY - rect.top
        if (dragIdx >= 0) {
          map[dragIdx][0] = cl(Math.round(fromX(mx) / 100) * 100, 1000, 9000)
          map[dragIdx][1] = cl(Math.round(fromY(my) * 2) / 2, 0, maxPSI)
          drawBoost()
          cvsBoost.style.cursor = 'grabbing'
        } else {
          var h = nearestPoint(mx, my)
          if (h !== hoverIdx) { hoverIdx = h; cvsBoost.style.cursor = h >= 0 ? 'grab' : 'default'; drawBoost() }
        }
      }

      function onUp () {
        if (dragIdx >= 0) {
          map.sort(function (a, b) { return a[0] - b[0] })
          for (var i = 0; i < map.length; i++) {
            try {
              bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").setPoint(' + (i + 1) + ',' + map[i][0] + ',' + map[i][1] + ')')
            } catch (e) {}
          }
          dragIdx = -1
          /* request updated power curves after changing boost map */
          setTimeout(function () {
            try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").sendPowerCurves()') } catch (e) {}
          }, 100)
          drawBoost()
        }
        cvsBoost.style.cursor = hoverIdx >= 0 ? 'grab' : 'default'
      }

      /* ---- stream updates ---- */
      scope.$on('streamsUpdate', function (_, s) {
        if (!s) return
        scope.$evalAsync(function () {
          if (s.engineInfo) rpm = s.engineInfo[4] || 0
          if (s.electrics) {
            boost = s.electrics.turboBoost || 0
            tgt   = s.electrics.fueltech_targetBoost || 0
            scope.active = !!(s.electrics.fueltech_active)
          }
          scope.rpmStr   = Math.round(rpm).toString()
          scope.boostStr = boost.toFixed(1)
          scope.tgtStr   = tgt.toFixed(1)
          drawBoost()
          drawPower()
        })
      })
    }
  }
}])
