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
        if (cvsMap) {
          cvsMap.removeEventListener('mousedown', onDown)
          cvsMap.removeEventListener('mousemove', onMove)
          cvsMap.removeEventListener('mouseup', onUp)
          cvsMap.removeEventListener('mouseleave', onUp)
        }
      })

      /* ==================== STATE ==================== */
      var rpm = 0, boost = 0, tgt = 0, speed = 0
      var oilT = 0, h2oT = 0, throttle = 0, turboRpm = 0
      var maxRPM = 8000, maxPSI = 40, peakBoost = 0

      scope.active = false; scope.overboost = false
      scope.rpmStr = '0'; scope.boostStr = '0.0'; scope.tgtStr = '0.0'; scope.peakStr = '0.0'
      scope.speedStr = '0'; scope.gearStr = 'N'
      scope.oilStr = '0'; scope.h2oStr = '0'; scope.thrStr = '0'; scope.turboRpmStr = '0'
      scope.oilPct = 0; scope.h2oPct = 0; scope.thrPct = 0; scope.turboPct = 0
      scope.preset = 'CUSTOM'

      var map = [[2000,5],[3000,10],[4000,15],[5000,20],[6000,20],[7000,18]]
      var pwrData = null

      scope.$on('fueltechBoostTable', function (_, d) {
        if (d && d.length) { map = []; for (var i = 0; i < d.length; i++) map.push([d[i].rpm, d[i].psi]) }
      })
      scope.$on('fueltechPowerCurves', function (_, d) { if (d) { pwrData = d; drawPower() } })

      function requestData () {
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").getBoostTable()') } catch (e) {}
        try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").sendPowerCurves()') } catch (e) {}
      }
      requestData()

      scope.setPreset = function (n) { scope.preset = n; try { bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").setPreset("'+n+'")') } catch(e){} }
      scope.resetPeak = function () { peakBoost = 0; scope.peakStr = '0.0' }
      scope.showGraphs = true
      scope.toggleGraphs = function () {
        scope.showGraphs = !scope.showGraphs
        applyGraphVisibility()
      }

      function applyGraphVisibility () {
        var vis = scope.showGraphs ? '' : 'none'
        var els = ['.ft-c-map','.ft-c-pwr','.ft-c-oil','.ft-c-h2o','.ft-c-thr','.ft-c-trb','.ft-bar']
        for (var i = 0; i < els.length; i++) {
          var el = q(els[i])
          if (el) el.style.display = vis
        }
      }

      function cl (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }
      function lerpMap (r) {
        if (!map.length) return 0
        if (r <= map[0][0]) return map[0][1]
        if (r >= map[map.length-1][0]) return map[map.length-1][1]
        for (var i = 0; i < map.length-1; i++) {
          if (r >= map[i][0] && r <= map[i+1][0]) {
            var t = (r - map[i][0]) / (map[i+1][0] - map[i][0])
            return map[i][1] + (map[i+1][1] - map[i][1]) * t
          }
        }
        return 0
      }

      /* ==================== LAYOUT ENGINE ==================== */
      /*
       * HUD Layout (transparent overlay):
       *
       *  ┌─────────────────────────────────────────────────┐
       *  │ [HEADER BAR — full width]                       │
       *  │                                                 │
       *  │                                        ┌─────┐  │
       *  │           [SPD/GEAR]                   │ RPM │  │
       *  │           center-left                  │gauge│  │
       *  │                                        ├─────┤  │
       *  │                                        │ PSI │  │
       *  │                                        │gauge│  │
       *  │  ┌────┐┌────┐┌────┐┌────┐             └─────┘  │
       *  │  │OIL ││H2O ││THR ││TRB │                      │
       *  │  │mini││mini││mini││mini│                       │
       *  │  └────┘└────┘└────┘└────┘                       │
       *  │  ┌───────────┐┌───────────┐                     │
       *  │  │ Boost Map ││ Pwr/Torq  │                     │
       *  │  └───────────┘└───────────┘                     │
       *  │  [LOW] [STREET] [SPORT] [RACE] [CUSTOM]        │
       *  └─────────────────────────────────────────────────┘
       */
      var PAD = 8, GAP = 6, HDR_H = 34, BAR_H = 34
      var appW = 0, appH = 0
      var lay = null

      function q (sel) { return element[0].querySelector(sel) }

      function setBox (el, x, y, w, h) {
        if (!el) return
        el.style.cssText = 'position:absolute;box-sizing:border-box;left:'+x+'px;top:'+y+'px;width:'+w+'px;height:'+h+'px;overflow:hidden'
      }

      function doLayout (W, H) {
        if (W < 100 || H < 100) return null
        if (lay && appW === W && appH === H) return lay
        appW = W; appH = H

        /* root */
        var root = element[0]
        root.style.cssText = 'position:relative;overflow:hidden;width:'+W+'px;height:'+H+'px;background:transparent'

        /* Right gauges: RPM + PSI stacked vertically */
        var gaugeW = Math.round(Math.min(W * 0.16, 200))
        var gaugeH = Math.round((H - HDR_H - BAR_H - PAD * 2 - GAP * 4) * 0.45)
        gaugeH = Math.min(gaugeH, gaugeW * 1.2)
        var gx = W - PAD - gaugeW
        var gy1 = PAD + HDR_H + GAP
        var gy2 = gy1 + gaugeH + GAP

        /* Header: full width */
        setBox(q('.ft-hdr'), PAD, PAD, W - PAD * 2, HDR_H)
        /* Make header flex work */
        var hdr = q('.ft-hdr')
        if (hdr) hdr.style.cssText += ';display:flex;align-items:center;gap:10px;background:rgba(10,12,20,0.85);border:1px solid #181c28;border-radius:6px;padding:0 14px;box-sizing:border-box'

        /* RPM gauge */
        setBox(q('.ft-c-rpm'), gx, gy1, gaugeW, gaugeH)
        /* PSI gauge */
        setBox(q('.ft-c-bst'), gx, gy2, gaugeW, gaugeH)

        /* Speed/Gear: center-left area */
        var spdW = Math.round(gaugeW * 0.9)
        var spdH = Math.round(gaugeH * 1.1)
        var spdX = Math.round((gx - PAD) * 0.38)
        var spdY = gy1 + Math.round((gy2 + gaugeH - gy1 - spdH) / 2)
        setBox(q('.ft-c-spd'), spdX, spdY, spdW, spdH)
        var spd = q('.ft-c-spd')
        if (spd) spd.style.cssText += ';display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(10,12,20,0.82);border:1px solid rgba(24,28,40,0.7);border-radius:8px;box-sizing:border-box'

        /* Bottom section baseline */
        var botBase = gy2 + gaugeH + GAP

        /* Mini gauges row: OIL, H2O, THR, TRB */
        var miniS = Math.round(Math.min((gx - PAD * 2 - GAP * 3) / 4, H * 0.14, 110))
        var miniY = botBase

        setBox(q('.ft-c-oil'), PAD, miniY, miniS, miniS)
        setBox(q('.ft-c-h2o'), PAD + miniS + GAP, miniY, miniS, miniS)
        setBox(q('.ft-c-thr'), PAD + (miniS + GAP) * 2, miniY, miniS, miniS)
        setBox(q('.ft-c-trb'), PAD + (miniS + GAP) * 3, miniY, miniS, miniS)

        /* Graphs: Boost Map + Power, side by side below mini gauges */
        var graphY = miniY + miniS + GAP
        var graphH = H - graphY - BAR_H - GAP * 2 - PAD
        if (graphH < 60) graphH = 60
        var graphTotalW = gx - PAD * 2 - GAP
        var graphW = Math.round(graphTotalW / 2)

        setBox(q('.ft-c-map'), PAD, graphY, graphW, graphH)
        setBox(q('.ft-c-pwr'), PAD + graphW + GAP, graphY, graphTotalW - graphW, graphH)

        /* Preset bar: bottom */
        var barY = H - PAD - BAR_H
        setBox(q('.ft-bar'), PAD, barY, W - PAD * 2, BAR_H)
        var bar = q('.ft-bar')
        if (bar) bar.style.cssText += ';display:flex;gap:4px;border-radius:6px;box-sizing:border-box'

        lay = { gaugeW: gaugeW, gaugeH: gaugeH, miniS: miniS, graphW: graphW, graphH: graphH, graphTotalW: graphTotalW }
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
      var dpr = window.devicePixelRatio || 1

      function initCanvases () {
        if (!cvsRpm) { try { cvsRpm = q('.ft-cv-rpm'); if (cvsRpm) ctxRpm = cvsRpm.getContext('2d') } catch(e){} }
        if (!cvsBst) { try { cvsBst = q('.ft-cv-bst'); if (cvsBst) ctxBst = cvsBst.getContext('2d') } catch(e){} }
        if (!cvsOil) { try { cvsOil = q('.ft-cv-oil'); if (cvsOil) ctxOil = cvsOil.getContext('2d') } catch(e){} }
        if (!cvsH2o) { try { cvsH2o = q('.ft-cv-h2o'); if (cvsH2o) ctxH2o = cvsH2o.getContext('2d') } catch(e){} }
        if (!cvsThr) { try { cvsThr = q('.ft-cv-thr'); if (cvsThr) ctxThr = cvsThr.getContext('2d') } catch(e){} }
        if (!cvsTrb) { try { cvsTrb = q('.ft-cv-trb'); if (cvsTrb) ctxTrb = cvsTrb.getContext('2d') } catch(e){} }
        if (!cvsMap) {
          try { cvsMap = q('.ft-cv-map'); if (cvsMap) { ctxMap = cvsMap.getContext('2d')
            cvsMap.addEventListener('mousedown', onDown); cvsMap.addEventListener('mousemove', onMove)
            cvsMap.addEventListener('mouseup', onUp); cvsMap.addEventListener('mouseleave', onUp)
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

        ctx.beginPath(); ctx.arc(cx,cy,r+aw*2.2,sA,eA); ctx.strokeStyle='#0c0e16'; ctx.lineWidth=1; ctx.stroke()
        ctx.beginPath(); ctx.arc(cx,cy,r,sA,eA); ctx.strokeStyle='#12141e'; ctx.lineWidth=aw; ctx.lineCap='butt'; ctx.stroke()

        for (var i=0; i<=8; i++) {
          var a=sA+sw*i/8, mj=i%2===0, ln=mj?aw*1.8:aw*0.9
          ctx.beginPath()
          ctx.moveTo(cx+Math.cos(a)*(r-ln/2),cy+Math.sin(a)*(r-ln/2))
          ctx.lineTo(cx+Math.cos(a)*(r+ln/2),cy+Math.sin(a)*(r+ln/2))
          ctx.strokeStyle=mj?'#4a5068':'#2a2e3a'; ctx.lineWidth=mj?1.5:0.7; ctx.stroke()
          if(mj){var lr=r+aw*3.2,lv=Math.round(maxV/8*i);if(maxV>=1000)lv=(lv/1000).toFixed(0)
            var fs=Math.max(Math.min(r*0.13,11),6)
            ctx.font=fs.toFixed(0)+'px Consolas,monospace';ctx.fillStyle='#8890a8'
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

      /* ==================== MINI GAUGE (OIL/H2O/THR/TRB) ==================== */
      function drawMiniGauge (ctx, w, h, value, maxV, valTxt, unit, label, c1, c2) {
        ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h)
        var cx = w/2, cy = h*0.42, r = Math.min(w,h)*0.32, aw = Math.max(r*0.1,2)
        var sA = 0.75*Math.PI, eA = 2.25*Math.PI, sw = eA-sA, pct = cl(value/maxV,0,1), vA = sA+pct*sw

        /* background arc */
        ctx.beginPath(); ctx.arc(cx,cy,r,sA,eA); ctx.strokeStyle='#1e2230'; ctx.lineWidth=aw; ctx.lineCap='butt'; ctx.stroke()

        /* ticks — fewer for mini */
        for (var i=0; i<=4; i++) {
          var a=sA+sw*i/4, ln=aw*1.2
          ctx.beginPath()
          ctx.moveTo(cx+Math.cos(a)*(r-ln/2),cy+Math.sin(a)*(r-ln/2))
          ctx.lineTo(cx+Math.cos(a)*(r+ln/2),cy+Math.sin(a)*(r+ln/2))
          ctx.strokeStyle='#4a5068'; ctx.lineWidth=1; ctx.stroke()
        }

        /* value arc */
        if(pct>0.005){
          var ac=pct<0.6?c1:pct<0.85?c2:'#ff2244'
          ctx.beginPath();ctx.arc(cx,cy,r,sA,vA);ctx.strokeStyle=ac;ctx.lineWidth=aw;ctx.lineCap='round';ctx.stroke()
          ctx.shadowColor=ac;ctx.shadowBlur=aw*2
          ctx.beginPath();ctx.arc(cx+Math.cos(vA)*r,cy+Math.sin(vA)*r,aw*0.5,0,6.283);ctx.fillStyle=ac;ctx.fill()
          ctx.shadowBlur=0
        }

        /* value text */
        var fS=Math.min(r*0.55,w*0.25)
        ctx.fillStyle='#ffffff';ctx.font='700 '+Math.max(fS,9).toFixed(0)+'px Consolas,monospace'
        ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(valTxt,cx,cy)
        /* unit */
        ctx.fillStyle='#b0b8d0';ctx.font=Math.max(fS*0.55,7).toFixed(0)+'px Consolas,monospace';ctx.fillText(unit,cx,cy+fS*0.7)
        /* label */
        ctx.fillStyle='#c0c8e0';ctx.font='700 '+Math.max(fS*0.5,6).toFixed(0)+'px Consolas,monospace';ctx.fillText(label,cx,h-Math.max(fS*0.25,3))
      }

      function drawRpmGauge () {
        initCanvases(); if(!ctxRpm||!lay) return
        var sz=sizeCvs(cvsRpm,lay.gaugeW,lay.gaugeH); if(!sz) return
        drawGauge(ctxRpm,sz.w,sz.h,rpm,maxRPM,Math.round(rpm).toString(),'RPM','ENGINE','#00ff88','#ffcc00',0.8)
      }
      function drawBoostGauge () {
        initCanvases(); if(!ctxBst||!lay) return
        var sz=sizeCvs(cvsBst,lay.gaugeW,lay.gaugeH); if(!sz) return
        drawGauge(ctxBst,sz.w,sz.h,Math.max(boost,0),maxPSI,boost.toFixed(1),'PSI','BOOST','#00bbff','#ff7700',null)
      }
      function drawMiniGauges () {
        initCanvases(); if(!lay) return
        var s = lay.miniS
        if(ctxOil){var sz=sizeCvs(cvsOil,s,s);if(sz) drawMiniGauge(ctxOil,sz.w,sz.h,oilT,150,Math.round(oilT).toString(),'°C','OIL','#00aa44','#ff8800')}
        if(ctxH2o){var sz=sizeCvs(cvsH2o,s,s);if(sz) drawMiniGauge(ctxH2o,sz.w,sz.h,h2oT,130,Math.round(h2oT).toString(),'°C','H2O','#0077ee','#ff3344')}
        if(ctxThr){var sz=sizeCvs(cvsThr,s,s);if(sz) drawMiniGauge(ctxThr,sz.w,sz.h,throttle*100,100,Math.round(throttle*100).toString(),'%','THR','#225533','#00ff88')}
        if(ctxTrb){var sz=sizeCvs(cvsTrb,s,s);if(sz){var tv=turboRpm>1000?(turboRpm/1000).toFixed(1)+'k':Math.round(turboRpm).toString();drawMiniGauge(ctxTrb,sz.w,sz.h,turboRpm,200000,tv,'rpm','TURBO','#224466','#00bbff')}}
      }

      /* ==================== GRID HELPER ==================== */
      function drawGrid (ctx,w,h,maxX,maxY,extraRight) {
        var fs=cl(w*0.025,7,12),pl=Math.round(fs*3.2)
        var pr = extraRight ? Math.round(fs*2.8) : 6
        var p={l:pl,r:pr,t:6,b:Math.round(fs*1.8)},gw=w-p.l-p.r,gh=h-p.t-p.b
        var nY=h>100?4:2,nX=w>200?4:2
        ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='rgba(6,8,14,0.9)';ctx.fillRect(0,0,w,h)
        ctx.strokeStyle='#0e1018';ctx.lineWidth=0.5
        for(var i=0;i<=nY;i++){var yy=p.t+gh/nY*i;ctx.beginPath();ctx.moveTo(p.l,yy);ctx.lineTo(w-p.r,yy);ctx.stroke()}
        for(var j=0;j<=nX*2;j++){var xx=p.l+gw/(nX*2)*j;ctx.beginPath();ctx.moveTo(xx,p.t);ctx.lineTo(xx,p.t+gh);ctx.stroke()}
        ctx.font=fs.toFixed(0)+'px Consolas,monospace';ctx.fillStyle='#222838';ctx.textAlign='right'
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
        var gW2 = lay.graphTotalW - lay.graphW
        var sz=sizeCvs(cvsPwr,gW2,lay.graphH); if(!sz) return
        var w=sz.w,h=sz.h,ctx=ctxPwr
        var maxNm=0,maxHP=0,eR=pwrData.maxRPM||7000
        var td=pwrData.torque,pd=pwrData.power,bt=pwrData.baseTorque,bp=pwrData.basePower

        /* Find axis maxima */
        for(var i=0;i<td.length;i++){if(td[i].nm>maxNm)maxNm=td[i].nm;if(pd[i].hp>maxHP)maxHP=pd[i].hp}
        for(var i=0;i<bt.length;i++){if(bt[i].nm>maxNm)maxNm=bt[i].nm;if(bp[i].hp>maxHP)maxHP=bp[i].hp}

        /* Include maxTorqueRating in the axis range so the limit line is visible */
        var tqRating = pwrData.maxTorqueRating || -1
        if (tqRating > 0 && tqRating > maxNm) maxNm = tqRating * 1.05

        maxNm=Math.ceil(maxNm/50)*50||400;maxHP=Math.ceil(maxHP/25)*25||200
        var g=drawGrid(ctx,w,h,eR,maxNm,true); if(!g) return
        var gp=g.p,ggw=g.gw,ggh=g.gh
        function ttx(r){return gp.l+cl(r/eR,0,1)*ggw}
        function tty(nm){return gp.t+ggh-cl(nm/maxNm,0,1)*ggh}
        function pty(hp){return gp.t+ggh-cl(hp/maxHP,0,1)*ggh}

        /* --- Draw torque limit / damage threshold line --- */
        if (tqRating > 0) {
          var limY = tty(tqRating)
          /* Red danger zone fill above the limit */
          ctx.save()
          ctx.fillStyle = 'rgba(255,34,68,0.04)'
          ctx.fillRect(gp.l, gp.t, ggw, limY - gp.t)
          /* Dashed red limit line */
          ctx.setLineDash([6,4])
          ctx.beginPath(); ctx.moveTo(gp.l, limY); ctx.lineTo(gp.l+ggw, limY)
          ctx.strokeStyle = 'rgba(255,34,68,0.5)'; ctx.lineWidth = 1.2; ctx.stroke()
          ctx.restore()
          /* Label */
          ctx.font = cl(g.fs-1,7,10).toFixed(0)+'px Consolas,monospace'
          ctx.fillStyle = 'rgba(255,34,68,0.6)'; ctx.textAlign = 'right'
          ctx.fillText('MAX '+tqRating+' Nm', gp.l+ggw-3, limY-3)
        }

        /* --- Draw stock peak torque line --- */
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

        /* --- Draw curves --- */
        var lw2=cl(w*0.004,1,2)
        function dc(data,yF,key,col,dash){ctx.save();if(dash)ctx.setLineDash([4,3]);ctx.beginPath()
          for(var i=0;i<data.length;i++){var px=ttx(data[i].rpm),py=yF(data[i][key]);if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py)}
          ctx.strokeStyle=col;ctx.lineWidth=lw2;ctx.lineJoin='round';ctx.stroke();ctx.restore()}
        dc(bt,tty,'nm','rgba(255,100,100,0.15)',true);dc(bp,pty,'hp','rgba(100,150,255,0.15)',true)
        dc(td,tty,'nm','#ff6666',false);dc(pd,pty,'hp','#6699ff',false)

        /* --- Legend with peak values --- */
        var lx=gp.l+6,ly=gp.t+8,lfs=cl(g.fs-1,7,10).toFixed(0)
        ctx.font=lfs+'px Consolas,monospace'; ctx.textAlign='left'
        var projPkTq = pwrData.projPeakTorque || 0
        var projPkHP = pwrData.projPeakHP || 0
        ctx.fillStyle='#ff6666'; ctx.fillRect(lx,ly-4,7,2)
        ctx.fillText('TQ Nm'+(projPkTq>0?' ('+projPkTq+')':''),lx+10,ly)
        ctx.fillStyle='#6699ff'; ctx.fillRect(lx,ly+8,7,2)
        ctx.fillText('HP'+(projPkHP>0?' ('+projPkHP+')':''),lx+10,ly+12)
        ctx.fillStyle='#3a4058'
        ctx.fillText('-- stock',lx+10,ly+24)

        /* Highlight region where projected torque exceeds the limit */
        if (tqRating > 0) {
          for(var i=0;i<td.length;i++){
            if(td[i].nm > tqRating){
              var px=ttx(td[i].rpm), py=tty(td[i].nm), limYY=tty(tqRating)
              ctx.fillStyle='rgba(255,34,68,0.08)'
              ctx.fillRect(px-2,py,4,limYY-py)
            }
          }
        }

        /* HP axis labels on right side */
        ctx.textAlign='left'; ctx.fillStyle='#222838'
        var nY = h > 100 ? 4 : 2
        for(var i=0;i<=nY;i++){ctx.fillText((maxHP-maxHP/nY*i).toFixed(0),w-gp.r+3,gp.t+ggh/nY*i+g.fs*0.35)}

        /* RPM indicator */
        if(scope.active&&rpm>50){var rx=ttx(rpm)
          var vg2=ctx.createLinearGradient(0,gp.t,0,gp.t+ggh)
          vg2.addColorStop(0,'rgba(0,255,136,0)');vg2.addColorStop(0.5,'rgba(0,255,136,0.04)');vg2.addColorStop(1,'rgba(0,255,136,0)')
          ctx.fillStyle=vg2;ctx.fillRect(rx-0.5,gp.t,1,ggh)}
      }

      /* ==================== DRAG ==================== */
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
      function onUp(){if(dragIdx>=0){scope.preset='CUSTOM';map.sort(function(a,b){return a[0]-b[0]})
        for(var i=0;i<map.length;i++){try{bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").setPoint('+(i+1)+','+map[i][0]+','+map[i][1]+')')}catch(e){}}
        dragIdx=-1;setTimeout(function(){try{bngApi.activeObjectLua('controller.getControllerSafe("fueltechBoostController").sendPowerCurves()')}catch(e){}},100);drawBoostMap()}
        cvsMap.style.cursor=hoverIdx>=0?'grab':'default'}

      /* ==================== RESIZE + INIT ==================== */
      /* BeamNG fires app:resized with {width, height} on init and user resize */
      scope.$on('app:resized', function (_, data) {
        if (data && data.width > 0 && data.height > 0) {
          lay = null /* force re-layout */
          doLayout(data.width, data.height)
          drawAll()
        }
      })

      /* Also handle window resize */
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

      /* Fallback: try initial layout after a short delay */
      setTimeout(function () {
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
        drawRpmGauge(); drawBoostGauge()
        if (scope.showGraphs) { drawMiniGauges(); drawBoostMap(); drawPower() }
        applyGraphVisibility()
      }

      /* ==================== STREAMS ==================== */
      scope.$on('streamsUpdate', function (_, s) {
        if (!s) return
        scope.$evalAsync(function () {
          if (s.engineInfo) { rpm = s.engineInfo[4]||0; if (s.engineInfo[1]&&s.engineInfo[1]>1000) maxRPM = s.engineInfo[1] }
          if (s.electrics) {
            boost=s.electrics.turboBoost||0; tgt=s.electrics.fueltech_targetBoost||0
            speed=(s.electrics.wheelspeed||s.electrics.airspeed||0)*3.6
            oilT=s.electrics.oiltemp||0; h2oT=s.electrics.watertemp||0
            throttle=s.electrics.throttle||0; turboRpm=s.electrics.turboRPM||0
            scope.active=!!(s.electrics.fueltech_active)
            var gv=s.electrics.gear_M; if(gv===undefined)gv=s.electrics.gearIndex; if(gv===undefined)gv=0
            if(gv<0)scope.gearStr='R'; else if(gv===0)scope.gearStr='N'; else scope.gearStr=gv.toString()
          }
          if(boost>peakBoost)peakBoost=boost
          scope.overboost=(tgt>0&&boost>tgt+2)
          scope.rpmStr=Math.round(rpm).toString(); scope.boostStr=boost.toFixed(1)
          scope.tgtStr=tgt.toFixed(1); scope.peakStr=peakBoost.toFixed(1)
          scope.speedStr=Math.round(speed).toString()
          scope.oilStr=Math.round(oilT).toString(); scope.h2oStr=Math.round(h2oT).toString()
          scope.thrStr=Math.round(throttle*100).toString()
          scope.turboRpmStr=turboRpm>1000?(turboRpm/1000).toFixed(1)+'k':Math.round(turboRpm).toString()
          scope.oilPct=cl(oilT/150*100,0,100); scope.h2oPct=cl(h2oT/130*100,0,100)
          scope.thrPct=cl(throttle*100,0,100); scope.turboPct=cl(turboRpm/200000*100,0,100)

          /* Only run layout once from streams if app:resized hasn't fired yet */
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
