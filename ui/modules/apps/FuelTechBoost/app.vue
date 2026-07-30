<template>
  <div ref="rootRef" class="ft" style="width:100%;height:100%">
    <link type="text/css" rel="stylesheet" href="/ui/modules/apps/FuelTechBoost/app.css" />

    <!-- Top header bar -->
    <div class="ft-hdr">
      <span class="ft-brand">FUELTECH</span>
      <span style="flex:1"></span>
      <span v-if="S.hasTurbo" class="ft-peak" @click="resetPeak">BOOST PK {{ S.peakStr }}</span>
      <span v-if="S.hasTurbo" class="ft-hdr-sep">|</span>
      <span v-if="S.hasTurbo" class="ft-dot" :class="S.active ? 'on' : 'off'"></span>
      <span v-if="S.hasTurbo" class="ft-hdr-state">{{ S.active ? 'ACTIVE' : 'STANDBY' }}</span>
      <span v-if="S.hasTurbo" class="ft-toggle ft-tune-btn" :class="{ 'ft-tune-btn-on': S.tuneOpen }"
            @click="toggleTune">{{ S.tuneOpen ? '✕ CLOSE' : '⚙ TUNE BOOST MAP' }}</span>
      <span class="ft-ver">8.5.0</span>
    </div>

    <!-- Warning bar (overlay, z-index above content) -->
    <div v-if="S.warnings.length" class="ft-warn">
      <span v-for="(w, i) in S.warnings" :key="i" class="ft-warn-item ft-blink">{{ w }}</span>
    </div>

    <!-- Telemetry strip — fixed-width values so the row doesn't reflow as numbers change -->
    <div class="ft-telem">
      <span class="ft-telem-item">WT <b class="ft-num4">{{ S.weightStr }}</b>kg</span>
      <span class="ft-telem-item">LOAD <b class="ft-num3">{{ S.loadStr }}</b>%</span>
      <span class="ft-telem-item">FUEL <b class="ft-num3">{{ S.fuelStr }}</b>L</span>
      <span class="ft-telem-item">EXH <b class="ft-num3">{{ S.exhFlowStr }}</b></span>
      <span class="ft-telem-item">CLT <b class="ft-num3">{{ S.clutchStr }}</b>%</span>
      <span class="ft-telem-item">ALT <b class="ft-num4">{{ S.altStr }}</b>m</span>
      <span class="ft-telem-item">ODO <b class="ft-num4">{{ S.odoStr }}</b>km</span>
      <span v-if="S.brakeTemps.length" class="ft-telem-item">BRK
        <b v-for="(bt, i) in S.brakeTemps" :key="i" :style="{ color: bt.color }" class="ft-num3">{{ bt.val }}</b></span>
      <span v-if="S.cel" class="ft-telem-cel ft-blink">CEL</span>
      <span v-if="S.lowFuel" class="ft-telem-fuel ft-blink">LOW FUEL</span>
    </div>

    <!-- Damage log (overlay) -->
    <div v-if="S.damageLog.length" class="ft-dmg">
      <span v-for="(d, i) in S.damageLog" :key="i" class="ft-dmg-item" :style="{ color: d.color }">{{ d.text }}</span>
    </div>

    <!-- Shift light overlay -->
    <div v-if="S.shiftLight" class="ft-shift ft-shift-on"></div>

    <!-- Mini gauges row (bottom band) -->
    <div class="ft-cell ft-c-oil"><canvas class="ft-cv ft-cv-oil"></canvas></div>
    <div class="ft-cell ft-c-h2o"><canvas class="ft-cv ft-cv-h2o"></canvas></div>
    <div v-show="S.hasTurbo" class="ft-cell ft-c-minimap"><canvas class="ft-cv ft-cv-minimap"></canvas></div>
    <div class="ft-cell ft-c-gforce"><canvas class="ft-cv ft-cv-gforce"></canvas></div>

    <!-- Drag timer (always visible) -->
    <div class="ft-cell ft-c-drag">
      <div class="ft-drag-title">DRAG TIMER</div>
      <div class="ft-drag-row">
        <span class="ft-drag-label">0-100</span>
        <span class="ft-drag-time ft-num6" :class="{ 'ft-drag-done': S.drag100done }">{{ S.drag100str }}</span>
      </div>
      <div class="ft-drag-row">
        <span class="ft-drag-label">0-200</span>
        <span class="ft-drag-time ft-num6" :class="{ 'ft-drag-done': S.drag200done }">{{ S.drag200str }}</span>
      </div>
      <div class="ft-drag-reset" @click="resetDrag">RESET</div>
    </div>

    <!-- Tune overlay: on-demand, compact centered panel with boost map + power curve -->
    <div v-if="S.tuneOpen" class="ft-tune-backdrop" @click="toggleTune"></div>
    <div v-show="S.tuneOpen" class="ft-tune-panel">
      <div class="ft-tune-title" @mousedown="tuneDragStart" @touchstart="tuneDragStart">
        <span>⠿ TUNE — drag dots to set boost-by-RPM. Drag this bar to move the panel.</span>
        <span class="ft-tune-close" @click="toggleTune">×</span>
      </div>
      <div class="ft-cell ft-c-map"><canvas class="ft-cv ft-cv-map"></canvas></div>
      <div class="ft-cell ft-c-pwr"><canvas class="ft-cv ft-cv-pwr"></canvas></div>
    </div>

    <!-- Bottom: control bar (always visible) -->
    <div class="ft-bar">
      <span v-if="S.hasTurbo" class="ft-btn" :class="{ 'ft-btn-on': S.preset === 'MIN' }" @click="setPreset('MIN')">OFF</span>
      <span v-if="S.hasTurbo" class="ft-btn" :class="{ 'ft-btn-on': S.preset === 'STOCK' }" @click="setPreset('STOCK')">STOCK</span>
      <span v-if="S.hasTurbo" class="ft-btn" :class="{ 'ft-btn-on': S.preset === 'MAX' }" @click="setPreset('MAX')">MAX</span>
      <span v-if="S.hasTurbo" class="ft-btn" :class="{ 'ft-btn-on': S.preset === 'AUTOMAX' }" @click="setPreset('AUTOMAX')">AUTO MAX</span>
      <span v-if="S.hasTurbo" class="ft-btn" :class="{ 'ft-btn-on': S.preset === 'CUSTOM' }" @click="setPreset('CUSTOM')">CUSTOM</span>
      <span v-if="S.hasTurbo" class="ft-btn ft-btn-als"
            :class="{ 'ft-btn-als-on': S.alsActive, 'ft-btn-als-firing': S.alsFiring }" @click="toggleALS"
            title="ANTI-LAG — keeps the turbo spooled when off-throttle by holding the wastegate shut and feeding small throttle pulses, so boost is ready instantly when you accelerate again. Modeled after rally-car ALS.">
        <span class="ft-btn-main">ANTI-LAG</span>
        <span class="ft-btn-sub">ALS</span>
      </span>
      <span v-if="S.hasTCS" class="ft-btn ft-btn-tc"
            :class="{ 'ft-btn-tc-on': S.tcsActive && S.tcsCut < 0.05, 'ft-btn-tc-off': !S.tcsActive, 'ft-btn-tc-active': S.tcsActive && S.tcsCut >= 0.05 }"
            @click="toggleTC">TC</span>
      <span v-if="S.hasABS" class="ft-btn ft-btn-abs"
            :class="{ 'ft-btn-abs-on': S.absActive && !S.absInterfering, 'ft-btn-abs-off': !S.absActive, 'ft-btn-abs-active': S.absActive && S.absInterfering }"
            @click="toggleABS">ABS</span>
    </div>
  </div>
</template>

<script setup>
// FuelTech Boost Controller HUD app — Vue port (BeamNG 0.39+ dual-mode).
// The Angular app.html/app.js pair stays in the folder as the fallback for
// pre-0.39 builds; the Vue host wins automatically when app.vue exists.
// Canvas engine is a faithful port of app.js — one CSS file shared by both.
import { reactive, ref, onMounted, onUnmounted } from "vue"
import { useBridge } from "@/bridge"
import { useEvents, useStreams } from "@/services/events"

const { api } = useBridge()
const events = useEvents()

const rootRef = ref(null)

/* ==================== REACTIVE UI STATE ==================== */
const S = reactive({
  hasTurbo: false,
  active: false,
  peakStr: "0.0",
  preset: "CUSTOM",
  hasTCS: false,
  tcsActive: false,
  tcsCut: 0,
  hasABS: false,
  absActive: true,
  absInterfering: false,
  alsActive: false,
  alsFiring: false,
  loadStr: "0", fuelStr: "0", exhFlowStr: "0.0",
  clutchStr: "0", altStr: "0", odoStr: "0.0",
  weightStr: "0",
  cel: false, lowFuel: false,
  brakeTemps: [],
  damageLog: [],
  tuneOpen: false,
  shiftLight: false,
  warnings: [],
  drag100str: "--.---", drag200str: "--.---",
  drag100done: false, drag200done: false,
})

/* ==================== PLAIN STATE ==================== */
let rpm = 0, boost = 0, tgt = 0, speed = 0
let oilT = 0, h2oT = 0, throttle = 0, turboRpm = 0
let maxRPM = 8000, maxPSI = 40, peakBoost = 0, boostMax = 0
let gForceX = 0, gForceY = 0
let gear = 0
let engineLoad = 0, fuelVol = 0, exhFlow = 0
let clutchPos = 0, altitude = 0, odometer = 0, vehMass = 0
let hasTurbo = false, hasTurboRpm = false
let detectFrames = 0, detectDone = false
let tuneOffsetX = 0, tuneOffsetY = 0
let tuneDrag = null
const shiftRpmPct = 0.9
let dragActive = false, dragStart = 0, drag100t = 0, drag200t = 0
let map = [[2000, 5], [3000, 10], [4000, 15], [5000, 20], [6000, 20], [7000, 18]]
let pwrData = null
let stockTorqueArr = null, stockPowerArr = null, stockMaxRPM = 0
let safetyCut = false, lastElectrics = null
let tcToggleDebounce = 0, alsToggleDebounce = 0, absToggleDebounce = 0

/* ==================== EVENTS (guihooks → Vue event bus) ==================== */
events.on("fueltechBoostTable", d => {
  if (d && d.length) { map = []; for (let i = 0; i < d.length; i++) map.push([d[i].rpm, d[i].psi]) }
})
events.on("fueltechPowerCurves", d => { if (d) { pwrData = d; drawPower() } })
events.on("TorqueCurveChanged", data => {
  if (!data || !data.curves) return
  stockMaxRPM = data.maxRPM || 7000
  let lastKey = null
  for (const key in data.curves) {
    if (lastKey === null || parseInt(key) > parseInt(lastKey)) lastKey = key
  }
  if (lastKey !== null && data.curves[lastKey]) {
    stockTorqueArr = data.curves[lastKey].torque
    stockPowerArr = data.curves[lastKey].power
  }
  if (stockTorqueArr) drawPower()
})
events.on("fueltechDriveModesInfo", data => {
  if (!data || !data.length) return
  for (let i = 0; i < data.length; i++) {
    if (data[i].name === "tcs") S.hasTCS = true
    if (data[i].name === "absController") S.hasABS = true
  }
})
events.on("DamageData", data => {
  if (!data) return
  const log = []
  const scan = (obj, prefix) => {
    if (!obj || typeof obj !== "object") return
    for (const k in obj) {
      const key = prefix ? prefix + "." + k : k
      const v = obj[k]
      if (typeof v === "object" && v !== null) scan(v, key)
      else if (v && v !== 0 && v !== false) {
        const label = damageLabels[key] || prettifyDamageKey(key)
        let color = "#ff6600"
        const vs = String(v).toLowerCase()
        if (vs === "true" || vs === "1") color = "#ff4466"
        else if (typeof v === "number" && v > 50) color = "#ff2244"
        else if (typeof v === "number" && v > 20) color = "#ff6600"
        else color = "#ffcc00"
        log.push({ text: label, color })
      }
    }
  }
  scan(data, "")
  S.damageLog = log
})
events.on("VehicleFocusChanged", () => {
  stockTorqueArr = null; stockPowerArr = null
  requestData()
})

const damageLabels = {
  "engine.oilStarvation": "OIL STARVE", "engine.coolantHot": "COOLANT HOT",
  "engine.oilHot": "OIL HOT", "engine.pistonRingsDamaged": "PISTON RINGS",
  "engine.rodBearingsDamaged": "ROD BEARINGS", "engine.headGasketDamaged": "HEAD GASKET",
  "engine.turbochargerHot": "TURBO HOT", "engine.engineReducedTorque": "REDUCED POWER",
  "engine.mildOverrevDamage": "OVERREV", "engine.catastrophicOverrevDamage": "OVERREV CRITICAL",
  "engine.engineDisabled": "ENGINE DEAD", "engine.blockMelted": "BLOCK MELTED",
  "engine.engineLockedUp": "ENGINE LOCKED", "engine.radiatorLeak": "RAD LEAK",
  "engine.oilpanLeak": "OIL PAN LEAK", "engine.engineHydrolocked": "HYDROLOCKED",
  "engine.oilRadiatorLeak": "OIL COOLER LEAK",
  "engine.fuelLeak": "FUEL LEAK", "engine.exhaustLeak": "EXHAUST LEAK",
  "engine.transmissionDamage": "TRANS DMG",
  "body.FL": "BODY FRONT-L", "body.FR": "BODY FRONT-R",
  "body.ML": "BODY MID-L", "body.MR": "BODY MID-R",
  "body.RL": "BODY REAR-L", "body.RR": "BODY REAR-R",
  "body.F": "BODY FRONT", "body.R": "BODY REAR",
  "body.M": "BODY MID", "body.L": "BODY LEFT",
  "body.RT": "BODY RIGHT",
  "body.hood": "HOOD", "body.trunk": "TRUNK", "body.roof": "ROOF",
  "body.windshield": "WINDSHIELD", "body.bumperF": "FRONT BUMPER",
  "body.bumperR": "REAR BUMPER",
  "wheels.brakeOverHeatFL": "BRK OVERHEAT FL", "wheels.brakeOverHeatFR": "BRK OVERHEAT FR",
  "wheels.brakeOverHeatRL": "BRK OVERHEAT RL", "wheels.brakeOverHeatRR": "BRK OVERHEAT RR",
  "wheels.tireFL": "TIRE DMG FL", "wheels.tireFR": "TIRE DMG FR",
  "wheels.tireRL": "TIRE DMG RL", "wheels.tireRR": "TIRE DMG RR",
  "wheels.brakeFL": "BRK DMG FL", "wheels.brakeFR": "BRK DMG FR",
  "wheels.brakeRL": "BRK DMG RL", "wheels.brakeRR": "BRK DMG RR",
  "powertrain.mainEngine": "ENGINE DMG", "powertrain.driveshaft": "DRIVESHAFT",
  "powertrain.gearbox": "GEARBOX", "powertrain.transfercase": "TRANSFER CASE",
  "powertrain.differential_F": "DIFF FRONT", "powertrain.differential_R": "DIFF REAR",
  "powertrain.wheelaxleFL": "AXLE FL", "powertrain.wheelaxleFR": "AXLE FR",
  "powertrain.wheelaxleRL": "AXLE RL", "powertrain.wheelaxleRR": "AXLE RR",
}

function prettifyDamageKey(key) {
  const leaf = key.indexOf(".") >= 0 ? key.substring(key.lastIndexOf(".") + 1) : key
  return leaf.replace(/([A-Z])/g, " $1").replace(/^\s+/, "").toUpperCase()
}

/* ==================== LUA CALLS ==================== */
function luaCall(code) {
  try { api.activeObjectLua(code) } catch (e) { /* vehicle VM not ready */ }
}
function requestData() {
  luaCall('controller.getControllerSafe("fueltechBoostController").getBoostTable()')
  luaCall('controller.getControllerSafe("fueltechBoostController").sendPowerCurves()')
  luaCall('controller.getControllerSafe("fueltechDrivetrain").getInfo()')
  luaCall('controller.mainController.sendTorqueData()')
}

function setPreset(n) {
  S.preset = n
  luaCall('controller.getControllerSafe("fueltechBoostController").setPreset("' + n + '")')
}
function resetPeak() { peakBoost = 0; S.peakStr = "0.0" }
function toggleTC() {
  S.tcsActive = !S.tcsActive
  tcToggleDebounce = 10
  luaCall('controller.getControllerSafe("fueltechDrivetrain").toggleDriveMode("tcs")')
}
function toggleALS() {
  S.alsActive = !S.alsActive
  alsToggleDebounce = 10
  luaCall('controller.getControllerSafe("fueltechBoostController").toggleAntiLag()')
}
function toggleABS() {
  S.absActive = !S.absActive
  absToggleDebounce = 10
  luaCall('controller.getControllerSafe("fueltechDrivetrain").toggleDriveMode("absController")')
}
function toggleTune() {
  S.tuneOpen = !S.tuneOpen
  lay = null
  if (appW && appH) doLayout(appW, appH)
  if (S.tuneOpen) { try { drawBoostMap(); drawPower() } catch (e) {} }
}
function resetDrag() {
  dragActive = false; dragStart = 0; drag100t = 0; drag200t = 0
  S.drag100str = "--.---"; S.drag200str = "--.---"
  S.drag100done = false; S.drag200done = false
}

/* ==================== TUNE PANEL DRAG ==================== */
function tuneDragStart(ev) {
  const t = ev.target
  if (t && t.classList && t.classList.contains("ft-tune-close")) return
  ev.preventDefault()
  const pt = (ev.touches && ev.touches[0]) || ev
  tuneDrag = { startX: pt.clientX, startY: pt.clientY, baseX: tuneOffsetX, baseY: tuneOffsetY }
  document.addEventListener("mousemove", tuneDragMove)
  document.addEventListener("mouseup", tuneDragEnd)
  document.addEventListener("touchmove", tuneDragMove, { passive: false })
  document.addEventListener("touchend", tuneDragEnd)
}
function tuneDragMove(ev) {
  if (!tuneDrag) return
  ev.preventDefault()
  const pt = (ev.touches && ev.touches[0]) || ev
  tuneOffsetX = tuneDrag.baseX + (pt.clientX - tuneDrag.startX)
  tuneOffsetY = tuneDrag.baseY + (pt.clientY - tuneDrag.startY)
  lay = null
  if (appW && appH) doLayout(appW, appH)
  try { drawBoostMap(); drawPower() } catch (e) {}
}
function tuneDragEnd() {
  tuneDrag = null
  document.removeEventListener("mousemove", tuneDragMove)
  document.removeEventListener("mouseup", tuneDragEnd)
  document.removeEventListener("touchmove", tuneDragMove)
  document.removeEventListener("touchend", tuneDragEnd)
}

/* ==================== HELPERS ==================== */
function cl(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }
function lerpMap(r) {
  if (!map.length) return 0
  if (r <= map[0][0]) return map[0][1]
  if (r >= map[map.length - 1][0]) return map[map.length - 1][1]
  for (let i = 0; i < map.length - 1; i++) {
    if (r >= map[i][0] && r <= map[i + 1][0]) {
      const span = map[i + 1][0] - map[i][0]
      if (span < 1) return map[i][1]
      const t = (r - map[i][0]) / span
      return map[i][1] + (map[i + 1][1] - map[i][1]) * t
    }
  }
  return 0
}

/* ==================== LAYOUT ==================== */
const GAP = 4
let appW = 0, appH = 0
let lay = null

function q(sel) { return rootRef.value ? rootRef.value.querySelector(sel) : null }

const GRAPH_BG = "background:rgba(6,8,14,0.6);border:1px solid rgba(24,28,40,0.3);border-radius:8px"

function doLayout(W, H) {
  if (W < 200 || H < 120) return null
  if (lay && appW === W && appH === H) return lay
  appW = W; appH = H

  const root = rootRef.value
  if (!root) return null
  root.style.cssText = "position:relative;overflow:hidden;width:" + W + "px;height:" + H + "px;background:transparent"

  const G = GAP
  const usableW = W - G * 2

  const hdrH = cl(Math.round(H * 0.11), 24, 36)
  const telH = cl(Math.round(H * 0.09), 18, 28)
  const barH = cl(Math.round(H * 0.11), 24, 32)

  const topY = G
  const telY = topY + hdrH + 2
  const barY = H - barH - G
  const rowY = telY + telH + 2
  let rowH = barY - rowY - 2
  if (rowH < 40) rowH = 40

  const colW = usableW / 12
  const cx = c => G + (c - 1) * colW
  const cw2 = n => n * colW - G

  function box(el, c, n, y, h, extra) {
    if (!el) return
    el.style.cssText = "position:absolute;box-sizing:border-box;left:" + cx(c) + "px;top:" + y + "px;width:" + cw2(n) + "px;height:" + h + "px;overflow:hidden"
    if (extra) el.style.cssText += ";" + extra
  }

  box(q(".ft-hdr"), 1, 12, topY, hdrH,
    "display:flex;align-items:center;gap:10px;background:rgba(10,12,20,0.82);border:1px solid rgba(40,46,66,0.5);border-radius:6px;padding:0 14px")
  box(q(".ft-telem"), 1, 12, telY, telH,
    "display:flex;align-items:center;gap:12px;padding:0 14px;background:rgba(10,12,20,0.6);border:1px solid rgba(40,46,66,0.3);border-radius:4px")

  const warnEl = q(".ft-warn")
  if (warnEl) {
    warnEl.style.cssText = "position:absolute;box-sizing:border-box;z-index:20;left:" + G + "px;top:" + rowY + "px;width:" + usableW + "px;height:" + cl(telH, 14, 24) + "px;overflow:hidden;display:flex;justify-content:center;align-items:center;gap:20px;padding:0 14px;background:rgba(255,34,68,0.15);border:1px solid rgba(255,34,68,0.4);border-radius:4px"
  }
  const dmgEl = q(".ft-dmg")
  if (dmgEl) {
    dmgEl.style.cssText = "position:absolute;box-sizing:border-box;z-index:19;left:" + G + "px;top:" + (rowY + cl(telH, 14, 24) + 2) + "px;width:" + usableW + "px;max-height:" + (telH * 2) + "px;overflow:hidden;display:flex;flex-wrap:wrap;gap:4px 10px;padding:2px 14px;background:rgba(10,12,20,0.6);border:1px solid rgba(40,46,66,0.3);border-radius:4px"
  }

  if (hasTurbo) {
    box(q(".ft-c-oil"), 1, 2, rowY, rowH)
    box(q(".ft-c-h2o"), 3, 2, rowY, rowH)
    box(q(".ft-c-minimap"), 5, 3, rowY, rowH, GRAPH_BG)
    box(q(".ft-c-gforce"), 8, 2, rowY, rowH)
    box(q(".ft-c-drag"), 10, 3, rowY, rowH,
      "display:flex;flex-direction:column;justify-content:center;padding:4px;" + GRAPH_BG)
  } else {
    box(q(".ft-c-oil"), 1, 3, rowY, rowH)
    box(q(".ft-c-h2o"), 4, 3, rowY, rowH)
    box(q(".ft-c-gforce"), 7, 3, rowY, rowH)
    box(q(".ft-c-drag"), 10, 3, rowY, rowH,
      "display:flex;flex-direction:column;justify-content:center;padding:4px;" + GRAPH_BG)
  }

  const tunePanel = q(".ft-tune-panel")
  const mapEl = q(".ft-c-map")
  const pwrEl = q(".ft-c-pwr")
  let tuneMapW = 0, tuneMapH = 0, tunePwrW = 0
  if (S.tuneOpen && tunePanel) {
    const tuneW = cl(Math.round(W * 0.7), 400, 760)
    const tuneH = cl(Math.round(H * 0.88), 180, 380)
    const baseX = (W - tuneW) / 2
    const baseY = (H - tuneH) / 2
    const minX = -tuneW + 60, maxX = W - 60
    const minY = 0, maxY = H - 30
    const tuneX = cl(baseX + tuneOffsetX, minX, maxX)
    const tuneY = cl(baseY + tuneOffsetY, minY, maxY)
    tunePanel.style.cssText = "position:absolute;z-index:31;box-sizing:border-box;left:" + tuneX + "px;top:" + tuneY + "px;width:" + tuneW + "px;height:" + tuneH + "px;background:rgba(10,12,20,0.96);border:1px solid rgba(255,102,0,0.4);border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,0.6);padding:6px;overflow:hidden"

    const titleH = 22, pad = 6
    const inW = tuneW - pad * 2
    const inH = tuneH - titleH - pad
    const halfW = Math.floor(inW / 2) - 3
    tuneMapW = halfW; tuneMapH = inH; tunePwrW = halfW
    if (mapEl) mapEl.style.cssText = "position:absolute;box-sizing:border-box;left:" + pad + "px;top:" + titleH + "px;width:" + halfW + "px;height:" + inH + "px;overflow:hidden;" + GRAPH_BG
    if (pwrEl) pwrEl.style.cssText = "position:absolute;box-sizing:border-box;left:" + (pad + halfW + 6) + "px;top:" + titleH + "px;width:" + halfW + "px;height:" + inH + "px;overflow:hidden;" + GRAPH_BG
  } else {
    if (tunePanel) tunePanel.style.cssText = "display:none"
    if (mapEl) mapEl.style.display = "none"
    if (pwrEl) pwrEl.style.display = "none"
  }

  const barEl = q(".ft-bar")
  if (barEl) {
    barEl.style.cssText = "position:absolute;box-sizing:border-box;left:" + G + "px;top:" + barY + "px;width:" + usableW + "px;height:" + barH + "px;display:flex;gap:3px;align-items:center"
  }

  const col2W = cw2(2), col3W = cw2(3)
  lay = {
    oilW: hasTurbo ? col2W : col3W, oilH: rowH,
    h2oW: hasTurbo ? col2W : col3W, h2oH: rowH,
    miniW: hasTurbo ? cw2(3) : 0, miniH: rowH,
    gfW: hasTurbo ? col2W : col3W, gfH: rowH,
    graphW: tuneMapW, graphH: tuneMapH,
    pwrW: tunePwrW,
  }
  return lay
}

/* ==================== CANVAS ==================== */
let cvsMap = null, ctxMap = null
let cvsPwr = null, ctxPwr = null
let cvsOil = null, ctxOil = null
let cvsH2o = null, ctxH2o = null
let cvsGf = null, ctxGf = null
let cvsMini = null, ctxMini = null
const dpr = window.devicePixelRatio || 1

function initCanvases() {
  if (!cvsOil) { try { cvsOil = q(".ft-cv-oil"); if (cvsOil) ctxOil = cvsOil.getContext("2d") } catch (e) {} }
  if (!cvsH2o) { try { cvsH2o = q(".ft-cv-h2o"); if (cvsH2o) ctxH2o = cvsH2o.getContext("2d") } catch (e) {} }
  if (!cvsGf) { try { cvsGf = q(".ft-cv-gforce"); if (cvsGf) ctxGf = cvsGf.getContext("2d") } catch (e) {} }
  if (!cvsMini) { try { cvsMini = q(".ft-cv-minimap"); if (cvsMini) ctxMini = cvsMini.getContext("2d") } catch (e) {} }
  if (!cvsMap) {
    try {
      cvsMap = q(".ft-cv-map")
      if (cvsMap) {
        ctxMap = cvsMap.getContext("2d")
        cvsMap.addEventListener("mousedown", onDown); cvsMap.addEventListener("mousemove", onMove)
        cvsMap.addEventListener("mouseup", onUp); cvsMap.addEventListener("mouseleave", onUp)
        cvsMap.addEventListener("touchstart", onTouchDown, { passive: false })
        cvsMap.addEventListener("touchmove", onTouchMove, { passive: false })
        cvsMap.addEventListener("touchend", onUp); cvsMap.addEventListener("touchcancel", onUp)
      }
    } catch (e) {}
  }
  if (!cvsPwr) { try { cvsPwr = q(".ft-cv-pwr"); if (cvsPwr) ctxPwr = cvsPwr.getContext("2d") } catch (e) {} }
}

function sizeCvs(cvs, w, h) {
  w -= 2; h -= 2
  if (w < 10 || h < 10) return null
  cvs.width = Math.round(w * dpr)
  cvs.height = Math.round(h * dpr)
  cvs.style.cssText = "position:absolute;top:0;left:0;width:" + w + "px;height:" + h + "px;display:block;border-radius:7px"
  return { w, h }
}

/* ==================== BAR GAUGE ==================== */
function drawBarGauge(ctx, w, h, value, maxV, valTxt, unit, label, c1, c2) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h)
  const pad = Math.max(w * 0.04, 6)
  const labelFs = cl(h * 0.20, 10, 14)
  const valFs = cl(h * 0.36, 13, 26)
  const unitFs = cl(valFs * 0.5, 10, 14)
  const barH2 = cl(h * 0.12, 3, 8)
  const pct = cl(value / maxV, 0, 1)

  ctx.fillStyle = "rgba(10,12,20,0.5)"
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = "rgba(40,46,66,0.3)"; ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1)

  ctx.font = "700 " + labelFs.toFixed(0) + "px Consolas,monospace"
  ctx.fillStyle = "#6a7498"; ctx.textAlign = "left"; ctx.textBaseline = "top"
  ctx.fillText(label, pad, pad)

  ctx.font = "700 " + valFs.toFixed(0) + "px Consolas,monospace"
  ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"
  ctx.fillText(valTxt, w / 2, h * 0.45)

  ctx.font = unitFs.toFixed(0) + "px Consolas,monospace"
  ctx.fillStyle = "#8890a8"
  ctx.fillText(unit, w / 2, h * 0.45 + valFs * 0.55)

  const barY2 = h - pad - barH2
  const barX = pad, barW = w - pad * 2

  ctx.fillStyle = "rgba(30,34,50,0.6)"
  ctx.fillRect(barX, barY2, barW, barH2)

  if (pct > 0.005) {
    const fillW = barW * pct
    const ac = pct < 0.6 ? c1 : pct < 0.85 ? c2 : "#ff2244"
    ctx.fillStyle = ac
    ctx.fillRect(barX, barY2, fillW, barH2)
    ctx.shadowColor = ac; ctx.shadowBlur = barH2 * 3
    ctx.fillRect(barX + fillW - 2, barY2, 2, barH2)
    ctx.shadowBlur = 0
  }
}

function drawOilH2oGauges() {
  initCanvases(); if (!lay) return
  let ms
  if (ctxOil) { ms = sizeCvs(cvsOil, lay.oilW, lay.oilH); if (ms) drawBarGauge(ctxOil, ms.w, ms.h, oilT, 150, Math.round(oilT).toString(), "°C", "OIL", "#00aa44", "#ff8800") }
  if (ctxH2o) { ms = sizeCvs(cvsH2o, lay.h2oW, lay.h2oH); if (ms) drawBarGauge(ctxH2o, ms.w, ms.h, h2oT, 130, Math.round(h2oT).toString(), "°C", "H2O", "#0077ee", "#ff3344") }
}

/* ==================== G-FORCE ==================== */
function drawGForce() {
  initCanvases(); if (!ctxGf || !lay) return
  const sz = sizeCvs(cvsGf, lay.gfW, lay.gfH); if (!sz) return
  const w = sz.w, h = sz.h, ctx = ctxGf
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h)

  const fs = cl(Math.min(w, h) * 0.12, 10, 16)
  const cx = w / 2, cy = h / 2 - fs * 0.6
  const r = Math.min(w, h) * 0.4
  const maxG = 2.0

  ctx.fillStyle = "rgba(10,12,20,0.5)"
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = "rgba(40,46,66,0.3)"; ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1)

  const lfs = cl(fs * 0.7, 10, 12)
  ctx.font = "700 " + lfs.toFixed(0) + "px Consolas,monospace"
  ctx.fillStyle = "#6a7498"; ctx.textAlign = "left"; ctx.textBaseline = "top"
  ctx.fillText("G-FORCE", 6, 4)

  ctx.strokeStyle = "#2a3048"; ctx.lineWidth = 0.5
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.283); ctx.lineWidth = 1; ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke()
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, 6.283); ctx.stroke()

  const gx = cl(gForceX / maxG, -1, 1) * r
  const gy = cl(-gForceY / maxG, -1, 1) * r
  const gMag = Math.sqrt(gForceX * gForceX + gForceY * gForceY)
  const dotC = gMag < 0.5 ? "#00ff88" : gMag < 1.2 ? "#ffcc00" : "#ff2244"
  const dotR = cl(r * 0.09, 3, 8)
  ctx.shadowColor = dotC; ctx.shadowBlur = dotR * 3
  ctx.beginPath(); ctx.arc(cx + gx, cy + gy, dotR, 0, 6.283); ctx.fillStyle = dotC; ctx.fill()
  ctx.shadowBlur = 0

  ctx.font = "700 " + fs.toFixed(0) + "px Consolas,monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"
  ctx.fillStyle = "#ffffff"; ctx.fillText(gMag.toFixed(2) + "G", cx, cy + r + fs * 1.1)
}

/* ==================== GRID HELPER ==================== */
function drawGrid(ctx, w, h, maxX, maxY, extraRight) {
  const fs = cl(w * 0.03, 10, 16), pl = Math.round(fs * 3.2)
  const pr = extraRight ? Math.round(fs * 2.8) : 6
  const p = { l: pl, r: pr, t: 6, b: Math.round(fs * 1.8) }, gw = w - p.l - p.r, gh = h - p.t - p.b
  const nY = h > 100 ? 4 : 2, nX = w > 200 ? 4 : 2
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = "rgba(6,8,14,0.7)"; ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = "#1a2030"; ctx.lineWidth = 0.5
  for (let i = 0; i <= nY; i++) { const yy = p.t + gh / nY * i; ctx.beginPath(); ctx.moveTo(p.l, yy); ctx.lineTo(w - p.r, yy); ctx.stroke() }
  for (let j = 0; j <= nX * 2; j++) { const xx = p.l + gw / (nX * 2) * j; ctx.beginPath(); ctx.moveTo(xx, p.t); ctx.lineTo(xx, p.t + gh); ctx.stroke() }
  ctx.font = fs.toFixed(0) + "px Consolas,monospace"; ctx.fillStyle = "#5a6280"; ctx.textAlign = "right"
  for (let i = 0; i <= nY; i++) { ctx.fillText((maxY - maxY / nY * i).toFixed(0), p.l - 3, p.t + gh / nY * i + fs * 0.35) }
  ctx.textAlign = "center"
  for (let i = 0; i <= nX; i++) { const rv = maxX / nX * i; ctx.fillText(rv >= 1000 ? (rv / 1000).toFixed(0) + "k" : "0", p.l + gw / nX * i, h - p.b + fs + 2) }
  return { p, gw, gh, fs }
}

/* ==================== MINI BOOST MAP ==================== */
function drawMiniBoostMap() {
  initCanvases(); if (!ctxMini || !lay) return
  if (!lay.miniW || lay.miniW < 40) return
  const sz = sizeCvs(cvsMini, lay.miniW, lay.miniH); if (!sz) return
  const w = sz.w, h = sz.h, ctx = ctxMini
  const pad = 4
  const pw = w - pad * 2, ph = h - pad * 2
  let yMax = boostMax > 0 ? boostMax * 1.1 : 30
  for (let i = 0; i < map.length; i++) if (map[i][1] > yMax) yMax = map[i][1] * 1.05
  const mx = r => pad + cl(r / maxRPM, 0, 1) * pw
  const my = v => pad + ph - cl(v / yMax, 0, 1) * ph

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h)

  if (boostMax > 0 && boostMax < yMax) {
    const ly = my(boostMax)
    ctx.strokeStyle = "rgba(160,170,190,0.35)"
    ctx.setLineDash([3, 3]); ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(pad, ly); ctx.lineTo(pad + pw, ly); ctx.stroke()
    ctx.setLineDash([])
  }

  const steps = 32, stepRpm = maxRPM / steps
  ctx.beginPath(); ctx.moveTo(mx(0), my(0))
  for (let s = 0; s <= steps; s++) ctx.lineTo(mx(stepRpm * s), my(lerpMap(stepRpm * s)))
  ctx.lineTo(mx(maxRPM), my(0)); ctx.closePath()
  const grad = ctx.createLinearGradient(0, pad, 0, pad + ph)
  grad.addColorStop(0, "rgba(255,102,0,0.32)")
  grad.addColorStop(1, "rgba(255,102,0,0.02)")
  ctx.fillStyle = grad; ctx.fill()
  ctx.beginPath(); ctx.moveTo(mx(0), my(lerpMap(0)))
  for (let s2 = 1; s2 <= steps; s2++) ctx.lineTo(mx(stepRpm * s2), my(lerpMap(stepRpm * s2)))
  ctx.strokeStyle = "#ff8833"; ctx.lineWidth = 1.5
  ctx.lineJoin = "round"; ctx.stroke()

  if (S.active && rpm > 50) {
    const cxp = cl(mx(rpm), pad, pad + pw)
    ctx.strokeStyle = "rgba(0,187,255,0.5)"; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(cxp, pad); ctx.lineTo(cxp, pad + ph); ctx.stroke()
    const cyp = cl(my(boost), pad, pad + ph)
    ctx.fillStyle = "#00bbff"
    ctx.beginPath(); ctx.arc(cxp, cyp, 3, 0, 6.283); ctx.fill()
  }

  ctx.font = "bold 9px Consolas,monospace"
  ctx.fillStyle = "rgba(180,190,210,0.55)"; ctx.textAlign = "left"; ctx.textBaseline = "top"
  ctx.fillText("BOOST MAP", pad + 2, pad + 1)
}

/* ==================== BOOST MAP (TUNE panel) ==================== */
let BP = {}, BGW = 0, BGH = 0, BMW2 = 0, BMH2 = 0
function drawBoostMap() {
  initCanvases(); if (!ctxMap || !lay) return
  const sz = sizeCvs(cvsMap, lay.graphW, lay.graphH); if (!sz) return
  BMW2 = sz.w; BMH2 = sz.h; const ctx = ctxMap
  const g = drawGrid(ctx, BMW2, BMH2, maxRPM, maxPSI); if (!g) return
  BP = g.p; BGW = g.gw; BGH = g.gh
  const tx = r => BP.l + cl(r / maxRPM, 0, 1) * BGW
  const ty = v => BP.t + BGH - cl(v / maxPSI, 0, 1) * BGH

  if (boostMax > 0 && boostMax < maxPSI) {
    const limY = ty(boostMax)
    ctx.fillStyle = "rgba(255, 170, 0, 0.05)"
    ctx.fillRect(BP.l, BP.t, BGW, limY - BP.t)
    ctx.save()
    ctx.setLineDash([6, 4])
    ctx.strokeStyle = "rgba(255, 170, 0, 0.55)"
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(BP.l, limY); ctx.lineTo(BP.l + BGW, limY); ctx.stroke()
    ctx.restore()
    ctx.font = cl(g.fs, 9, 12).toFixed(0) + "px Consolas,monospace"
    ctx.textAlign = "right"; ctx.textBaseline = "bottom"
    ctx.fillStyle = "#ffaa44"
    ctx.fillText("TURBO RATED MAX " + boostMax.toFixed(1) + " PSI", BP.l + BGW - 4, limY - 2)
  }

  const steps = Math.max(Math.round(BGW / 2), 20), step = maxRPM / steps
  ctx.beginPath(); ctx.moveTo(tx(0), ty(0))
  for (let i = 0; i <= steps; i++) ctx.lineTo(tx(step * i), ty(lerpMap(step * i)))
  ctx.lineTo(tx(maxRPM), ty(0)); ctx.closePath()
  const grd = ctx.createLinearGradient(0, BP.t, 0, BP.t + BGH)
  grd.addColorStop(0, "rgba(255,102,0,0.1)"); grd.addColorStop(1, "rgba(255,102,0,0)")
  ctx.fillStyle = grd; ctx.fill()

  ctx.beginPath(); ctx.moveTo(tx(0), ty(lerpMap(0)))
  for (let i = 1; i <= steps; i++) ctx.lineTo(tx(step * i), ty(lerpMap(step * i)))
  const lw = cl(BMW2 * 0.004, 1, 2.5)
  ctx.strokeStyle = "#ff6600"; ctx.lineWidth = lw; ctx.lineJoin = "round"; ctx.stroke()

  const dr = cl(BMW2 * 0.008, 3, 7)
  for (let i = 0; i < map.length; i++) {
    const bx = tx(map[i][0]), by = ty(map[i][1]), hot = (i === hoverIdx || i === dragIdx)
    if (hot) { ctx.beginPath(); ctx.arc(bx, by, dr + 6, 0, 6.283); ctx.fillStyle = "rgba(255,102,0,0.08)"; ctx.fill() }
    ctx.beginPath(); ctx.arc(bx, by, dr + 1, 0, 6.283); ctx.strokeStyle = hot ? "#ff8833" : "rgba(255,102,0,0.3)"; ctx.lineWidth = 1; ctx.stroke()
    ctx.beginPath(); ctx.arc(bx, by, dr, 0, 6.283); ctx.fillStyle = hot ? "#ff8833" : "#ff6600"; ctx.fill()
    ctx.beginPath(); ctx.arc(bx, by, dr * 0.3, 0, 6.283); ctx.fillStyle = "rgba(6,8,14,0.9)"; ctx.fill()
    if (hot) {
      ctx.font = "bold " + cl(g.fs + 1, 10, 14).toFixed(0) + "px Consolas,monospace"
      ctx.fillStyle = "#dde0ec"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"
      ctx.fillText(map[i][0] + " / " + map[i][1].toFixed(1) + " PSI", bx, by - dr - 6)
    }
  }

  if (!S.active || rpm < 50) return
  const cx2 = cl(tx(rpm), BP.l, BMW2 - BP.r), cy2 = cl(ty(boost), BP.t, BP.t + BGH), tgy = cl(ty(tgt), BP.t, BP.t + BGH)
  const vg = ctx.createLinearGradient(0, BP.t, 0, BP.t + BGH)
  vg.addColorStop(0, "rgba(0,255,136,0)"); vg.addColorStop(0.5, "rgba(0,255,136,0.05)"); vg.addColorStop(1, "rgba(0,255,136,0)")
  ctx.fillStyle = vg; ctx.fillRect(cx2 - 0.5, BP.t, 1, BGH)
  ctx.beginPath(); ctx.arc(cx2, tgy, dr * 1.5, 0, 6.283); ctx.strokeStyle = "rgba(255,102,0,0.4)"; ctx.lineWidth = cl(lw * 0.5, 0.5, 1); ctx.stroke()
  const dotC = "#00bbff"
  ctx.shadowColor = dotC; ctx.shadowBlur = cl(BMW2 * 0.01, 3, 10)
  ctx.beginPath(); ctx.arc(cx2, cy2, dr * 1.2, 0, 6.283); ctx.fillStyle = dotC; ctx.fill(); ctx.shadowBlur = 0
}

/* ==================== POWER / TORQUE ==================== */
function drawPower() {
  initCanvases(); if (!ctxPwr || !lay) return
  if (!stockTorqueArr && !pwrData) return
  const sz = sizeCvs(cvsPwr, lay.pwrW, lay.graphH); if (!sz) return
  const w = sz.w, h = sz.h, ctx = ctxPwr

  const eR = stockMaxRPM || (pwrData && pwrData.maxRPM) || 7000
  const useNative = !!(stockTorqueArr && stockTorqueArr.length > 100)

  let td = [], pd = [], bt = [], bp = []
  let maxNm = 0, maxHP = 0
  let stockPkNm = 0, projPkNm = 0, projPkHP = 0

  if (useNative) {
    const step = 250
    const ATM_PSI = 14.7
    const stockBoost = boostMax > 0 ? boostMax : 0
    const stockMAP = ATM_PSI + (stockBoost > 0 ? stockBoost : 0)
    for (let r = 0; r <= eR; r += step) {
      const idx = Math.min(r, stockTorqueArr.length - 1)
      const sNm = stockTorqueArr[idx] || 0
      const sPkw = stockPowerArr ? (stockPowerArr[idx] || 0) : (sNm * r * 0.10471975 / 1000)
      const sHP = sPkw * 1.34102

      bt.push({ rpm: r, nm: sNm })
      bp.push({ rpm: r, hp: sHP })
      if (sNm > stockPkNm) stockPkNm = sNm

      let ourTarget = lerpMap(r)
      if (ourTarget < 0) ourTarget = 0
      const targetMAP = ATM_PSI + ourTarget
      const torqueRatio = stockMAP > 0 ? (targetMAP / stockMAP) : 1
      const pNm = sNm * torqueRatio
      const pHP = sHP * torqueRatio

      td.push({ rpm: r, nm: pNm })
      pd.push({ rpm: r, hp: pHP })
      if (pNm > projPkNm) projPkNm = pNm
      if (pHP > projPkHP) projPkHP = pHP

      if (sNm > maxNm) maxNm = sNm
      if (pNm > maxNm) maxNm = pNm
      if (sHP > maxHP) maxHP = sHP
      if (pHP > maxHP) maxHP = pHP
    }
  } else if (pwrData) {
    td = pwrData.torque || []; pd = pwrData.power || []; bt = pwrData.baseTorque || []; bp = pwrData.basePower || []
    stockPkNm = pwrData.stockPeakTorque || 0
    projPkNm = pwrData.projPeakTorque || 0
    projPkHP = pwrData.projPeakHP || 0
    for (let i = 0; i < td.length; i++) { if (td[i].nm > maxNm) maxNm = td[i].nm; if (i < pd.length && pd[i].hp > maxHP) maxHP = pd[i].hp }
    for (let i = 0; i < bt.length; i++) { if (bt[i].nm > maxNm) maxNm = bt[i].nm; if (i < bp.length && bp[i].hp > maxHP) maxHP = bp[i].hp }
  }

  if (!td.length || !pd.length) return

  const tqRating = (pwrData && pwrData.maxTorqueRating) || -1
  if (tqRating > 0 && tqRating > maxNm) maxNm = tqRating * 1.05

  maxNm = Math.ceil(maxNm / 50) * 50 || 400; maxHP = Math.ceil(maxHP / 25) * 25 || 200
  const g = drawGrid(ctx, w, h, eR, maxNm, true); if (!g) return
  const gp = g.p, ggw = g.gw, ggh = g.gh
  const ttx = r => gp.l + cl(r / eR, 0, 1) * ggw
  const tty = nm => gp.t + ggh - cl(nm / maxNm, 0, 1) * ggh
  const pty = hp => gp.t + ggh - cl(hp / maxHP, 0, 1) * ggh

  if (tqRating > 0) {
    const limY = tty(tqRating)
    ctx.save()
    ctx.fillStyle = "rgba(255,34,68,0.04)"
    ctx.fillRect(gp.l, gp.t, ggw, limY - gp.t)
    ctx.setLineDash([6, 4])
    ctx.beginPath(); ctx.moveTo(gp.l, limY); ctx.lineTo(gp.l + ggw, limY)
    ctx.strokeStyle = "rgba(255,34,68,0.5)"; ctx.lineWidth = 1.2; ctx.stroke()
    ctx.restore()
    ctx.font = cl(g.fs, 10, 13).toFixed(0) + "px Consolas,monospace"
    ctx.fillStyle = "rgba(255,34,68,0.6)"; ctx.textAlign = "right"
    ctx.fillText("MAX " + tqRating + " Nm", gp.l + ggw - 3, limY - 3)
  }

  if (stockPkNm > 0) {
    const spY = tty(stockPkNm)
    ctx.save(); ctx.setLineDash([3, 5])
    ctx.beginPath(); ctx.moveTo(gp.l, spY); ctx.lineTo(gp.l + ggw, spY)
    ctx.strokeStyle = "rgba(255,160,60,0.25)"; ctx.lineWidth = 0.8; ctx.stroke()
    ctx.restore()
    ctx.font = cl(g.fs - 1, 10, 12).toFixed(0) + "px Consolas,monospace"
    ctx.fillStyle = "rgba(255,160,60,0.4)"; ctx.textAlign = "left"
    ctx.fillText("STOCK " + Math.round(stockPkNm) + " Nm", gp.l + 3, spY - 2)
  }

  const lw2 = cl(w * 0.004, 1, 2)
  function dc(data, yF, key, col, dash) {
    ctx.save(); if (dash) ctx.setLineDash([4, 3]); ctx.beginPath()
    for (let i = 0; i < data.length; i++) { const px = ttx(data[i].rpm), py = yF(data[i][key]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py) }
    ctx.strokeStyle = col; ctx.lineWidth = lw2; ctx.lineJoin = "round"; ctx.stroke(); ctx.restore()
  }
  dc(bt, tty, "nm", "rgba(255,100,100,0.15)", true); dc(bp, pty, "hp", "rgba(100,150,255,0.15)", true)
  dc(td, tty, "nm", "#ff6666", false); dc(pd, pty, "hp", "#6699ff", false)

  const lx = gp.l + 8, ly = gp.t + 10, lfs = cl(g.fs, 10, 14).toFixed(0)
  ctx.font = lfs + "px Consolas,monospace"; ctx.textAlign = "left"
  ctx.fillStyle = "#ff6666"; ctx.fillRect(lx, ly - 5, 9, 3)
  ctx.fillText("TQ Nm" + (projPkNm > 0 ? " (" + Math.round(projPkNm) + ")" : ""), lx + 14, ly)
  ctx.fillStyle = "#6699ff"; ctx.fillRect(lx, ly + parseInt(lfs) + 2, 9, 3)
  ctx.fillText("HP" + (projPkHP > 0 ? " (" + Math.round(projPkHP) + ")" : ""), lx + 14, ly + parseInt(lfs) + 6)
  ctx.fillStyle = "#6a7498"
  ctx.fillText("-- stock", lx + 14, ly + parseInt(lfs) * 2 + 10)

  if (tqRating > 0) {
    for (let i = 0; i < td.length; i++) {
      if (td[i].nm > tqRating) {
        const px = ttx(td[i].rpm), py = tty(td[i].nm), limYY = tty(tqRating)
        ctx.fillStyle = "rgba(255,34,68,0.08)"
        ctx.fillRect(px - 2, py, 4, limYY - py)
      }
    }
  }

  ctx.textAlign = "left"; ctx.fillStyle = "#5a6280"
  const nY = h > 100 ? 4 : 2
  for (let i = 0; i <= nY; i++) { ctx.fillText((maxHP - maxHP / nY * i).toFixed(0), w - gp.r + 3, gp.t + ggh / nY * i + g.fs * 0.35) }

  if (rpm > 50) {
    const rx = ttx(rpm)
    const vg2 = ctx.createLinearGradient(0, gp.t, 0, gp.t + ggh)
    vg2.addColorStop(0, "rgba(0,255,136,0)"); vg2.addColorStop(0.5, "rgba(0,255,136,0.04)"); vg2.addColorStop(1, "rgba(0,255,136,0)")
    ctx.fillStyle = vg2; ctx.fillRect(rx - 0.5, gp.t, 1, ggh)

    let liveNm = 0, liveHP = 0
    if (useNative && stockTorqueArr) {
      const rpmIdx = Math.floor(rpm)
      if (rpmIdx >= 0 && rpmIdx < stockTorqueArr.length) {
        const sNmLive = stockTorqueArr[rpmIdx] || 0
        const sPkwLive = stockPowerArr ? (stockPowerArr[rpmIdx] || 0) : (sNmLive * rpm * 0.10471975 / 1000)
        const refB = boostMax > 0 ? boostMax : 1
        const liveRatio = boost > 0 ? (boost / refB) : 1
        liveNm = sNmLive * liveRatio * Math.max(engineLoad, 0.01)
        liveHP = sPkwLive * 1.34102 * liveRatio * Math.max(engineLoad, 0.01)
      }
    } else {
      for (let li = 0; li < bt.length - 1; li++) {
        if (rpm >= bt[li].rpm && rpm <= bt[li + 1].rpm) {
          const lt = (rpm - bt[li].rpm) / (bt[li + 1].rpm - bt[li].rpm)
          const bNm = bt[li].nm + (bt[li + 1].nm - bt[li].nm) * lt
          const bHP = bp[li].hp + (bp[li + 1].hp - bp[li].hp) * lt
          const bRef = boostMax > 0 ? boostMax : 1
          const aRatio = boost > 0 ? boost / bRef : 1
          liveNm = bNm * aRatio * Math.max(engineLoad, 0.01)
          liveHP = bHP * aRatio * Math.max(engineLoad, 0.01)
          break
        }
      }
    }

    const dotR2 = cl(w * 0.008, 3, 6)
    if (liveNm > 0) {
      ctx.shadowColor = "#ff6666"; ctx.shadowBlur = dotR2 * 3
      ctx.beginPath(); ctx.arc(rx, tty(liveNm), dotR2, 0, 6.283); ctx.fillStyle = "#ff6666"; ctx.fill()
      ctx.shadowBlur = 0
    }
    if (liveHP > 0) {
      ctx.shadowColor = "#6699ff"; ctx.shadowBlur = dotR2 * 3
      ctx.beginPath(); ctx.arc(rx, pty(liveHP), dotR2, 0, 6.283); ctx.fillStyle = "#6699ff"; ctx.fill()
      ctx.shadowBlur = 0
    }
    const lfx = gp.l + ggw - 4, lfy = gp.t + ggh - 6
    ctx.font = "700 " + cl(g.fs, 10, 16).toFixed(0) + "px Consolas,monospace"
    ctx.textAlign = "right"; ctx.fillStyle = "#ff6666"
    ctx.fillText(Math.round(liveNm) + " Nm", lfx, lfy - g.fs * 1.1)
    ctx.fillStyle = "#6699ff"
    ctx.fillText(Math.round(liveHP) + " HP", lfx, lfy)
  }
}

/* ==================== BOOST-MAP DRAG (mouse + touch) ==================== */
let dragIdx = -1, hoverIdx = -1
const GRAB_R = 18
const boostTx = r => BP.l + cl(r / maxRPM, 0, 1) * BGW
const boostTy = v => BP.t + BGH - cl(v / maxPSI, 0, 1) * BGH
const fromX = px => cl((px - BP.l) / BGW, 0, 1) * maxRPM
const fromY = py => cl((BP.t + BGH - py) / BGH, 0, 1) * maxPSI
function nearestPt(mx, my) {
  let b = -1, bd = GRAB_R * GRAB_R
  for (let i = 0; i < map.length; i++) {
    const dx = boostTx(map[i][0]) - mx, dy = boostTy(map[i][1]) - my
    if (dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; b = i }
  }
  return b
}

function onDown(e) { const r = cvsMap.getBoundingClientRect(); dragIdx = nearestPt(e.clientX - r.left, e.clientY - r.top) }
function onMove(e) {
  const r = cvsMap.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top
  if (dragIdx >= 0) {
    map[dragIdx][0] = cl(Math.round(fromX(mx) / 100) * 100, 1000, 9000)
    map[dragIdx][1] = cl(Math.round(fromY(my) * 2) / 2, 0, maxPSI)
    drawBoostMap(); cvsMap.style.cursor = "grabbing"
  } else {
    const h2 = nearestPt(mx, my)
    if (h2 !== hoverIdx) { hoverIdx = h2; cvsMap.style.cursor = h2 >= 0 ? "grab" : "default"; drawBoostMap() }
  }
}
function onTouchDown(e) { e.preventDefault(); const t = e.touches[0]; const r = cvsMap.getBoundingClientRect(); dragIdx = nearestPt(t.clientX - r.left, t.clientY - r.top) }
function onTouchMove(e) {
  e.preventDefault(); if (dragIdx < 0) return
  const t = e.touches[0]; const r = cvsMap.getBoundingClientRect(), mx = t.clientX - r.left, my = t.clientY - r.top
  map[dragIdx][0] = cl(Math.round(fromX(mx) / 100) * 100, 1000, 9000)
  map[dragIdx][1] = cl(Math.round(fromY(my) * 2) / 2, 0, maxPSI)
  drawBoostMap()
}
function onUp() {
  if (dragIdx >= 0) {
    S.preset = "CUSTOM"
    map.sort((a, b) => a[0] - b[0])
    for (let i = 0; i < map.length; i++) {
      luaCall('controller.getControllerSafe("fueltechBoostController").setPoint(' + (i + 1) + "," + map[i][0] + "," + map[i][1] + ")")
    }
    dragIdx = -1
    setTimeout(() => luaCall('controller.getControllerSafe("fueltechBoostController").sendPowerCurves()'), 100)
    drawBoostMap()
  }
  if (cvsMap) cvsMap.style.cursor = hoverIdx >= 0 ? "grab" : "default"
}

/* ==================== DRAW-ALL / WARNINGS / DRAG TIMER ==================== */
function drawAll() {
  drawOilH2oGauges(); drawGForce()
  if (hasTurbo) drawMiniBoostMap()
  if (hasTurbo && S.tuneOpen) { drawBoostMap(); drawPower() }
}

function updateWarnings() {
  const w = []
  safetyCut = !!(lastElectrics && lastElectrics.fueltech_safetyCut)
  if (safetyCut) w.push("BOOST CUT — OVERTEMP")
  if (oilT > 130) w.push("OIL TEMP " + Math.round(oilT) + "°C")
  if (h2oT > 110) w.push("COOLANT " + Math.round(h2oT) + "°C")
  if (S.alsFiring) w.push("ALS ACTIVE")
  if (S.tcsCut > 0.05) w.push("TC -" + Math.round(S.tcsCut * 100) + "%")
  if (S.absInterfering) w.push("ABS")
  S.warnings = w
}

function updateDragTimer() {
  const now = Date.now()
  const spd = speed
  if (!dragActive && spd < 2 && throttle > 0.1 && gear > 0) {
    dragActive = true; dragStart = 0; drag100t = 0; drag200t = 0
    S.drag100done = false; S.drag200done = false
    S.drag100str = "0.000"; S.drag200str = "0.000"
  }
  if (dragActive && dragStart === 0 && spd >= 2) dragStart = now
  if (dragActive && dragStart > 0) {
    const elapsed = (now - dragStart) / 1000
    if (!drag100t && spd >= 100) { drag100t = elapsed; S.drag100str = drag100t.toFixed(3); S.drag100done = true }
    if (!drag200t && spd >= 200) { drag200t = elapsed; S.drag200str = drag200t.toFixed(3); S.drag200done = true }
    if (!drag100t) S.drag100str = elapsed.toFixed(3)
    if (!drag200t && drag100t) S.drag200str = elapsed.toFixed(3)
    if (spd < 1 && elapsed > 2) dragActive = false
  }
}

/* ==================== STREAMS ==================== */
useStreams(["electrics", "engineInfo", "wheelThermalData"], s => {
  if (!s) return
  if (s.engineInfo) { rpm = s.engineInfo[4] || 0; if (s.engineInfo[1] && s.engineInfo[1] > 1000) maxRPM = s.engineInfo[1] }
  if (s.electrics) {
    lastElectrics = s.electrics
    boost = s.electrics.turboBoost || s.electrics.boost || 0
    tgt = s.electrics.fueltech_targetBoost || 0
    boostMax = s.electrics.fueltech_boostMax || s.electrics.turboBoostMax || s.electrics.boostMax || 0
    speed = (s.electrics.wheelspeed || s.electrics.airspeed || 0) * 3.6
    oilT = s.electrics.oiltemp || 0; h2oT = s.electrics.watertemp || 0
    throttle = s.electrics.throttle || 0; turboRpm = s.electrics.turboRPM || 0
    gForceX = (s.electrics.accXSmooth || s.electrics.accX || 0) / 9.81
    gForceY = (s.electrics.accYSmooth || s.electrics.accY || 0) / 9.81
    engineLoad = s.electrics.engineLoad || 0
    fuelVol = s.electrics.fuelVolume || 0
    exhFlow = s.electrics.exhaustFlow || 0
    clutchPos = s.electrics.clutch || 0
    altitude = s.electrics.altitude || 0
    odometer = s.electrics.odometer || 0
    vehMass = s.electrics.fueltech_mass || 0
    S.cel = !!(s.electrics.checkengine)
    S.lowFuel = !!(s.electrics.lowfuel)
    S.active = !!(s.electrics.fueltech_active)

    let gearIdx = s.electrics.gearIndex
    const gearManual = s.electrics.gear_M
    if (gearIdx === undefined) gearIdx = (typeof gearManual === "number") ? gearManual : 0
    gear = gearIdx

    S.tcsCut = s.electrics.fueltech_tcs_cut || 0
    if (tcToggleDebounce > 0) tcToggleDebounce--
    else S.tcsActive = !!(s.electrics.tcs)

    if (alsToggleDebounce > 0) alsToggleDebounce--
    else S.alsActive = !!(s.electrics.fueltech_als_enabled)
    S.alsFiring = !!(s.electrics.fueltech_als_firing)

    if (absToggleDebounce > 0) absToggleDebounce--
    else S.absActive = !!(s.electrics.abs)
    S.absInterfering = !!(s.electrics.absActive)
  }

  const hasFI = !!(s.electrics && s.electrics.fueltech_active)
  const hasBoostData = turboRpm > 0 || boost > 0.5 || boostMax > 0 || hasFI
  if (!detectDone) {
    detectFrames++
    if (hasBoostData) { hasTurbo = true; S.hasTurbo = true }
    if (turboRpm > 0) hasTurboRpm = true
    if (detectFrames >= 30) { detectDone = true; lay = null }
  } else {
    if (!hasTurbo && hasBoostData) { hasTurbo = true; S.hasTurbo = true; lay = null }
    if (!hasTurboRpm && turboRpm > 0) { hasTurboRpm = true; lay = null }
  }

  if (boost > peakBoost) peakBoost = boost
  S.shiftLight = (rpm > maxRPM * shiftRpmPct && rpm > 1000)

  updateWarnings()
  updateDragTimer()

  S.peakStr = peakBoost.toFixed(1)
  S.loadStr = Math.round(engineLoad * 100).toString()
  S.fuelStr = Math.round(fuelVol).toString()
  S.exhFlowStr = exhFlow.toFixed(1)
  S.clutchStr = Math.round((1 - clutchPos) * 100).toString()
  S.altStr = Math.round(altitude).toString()
  S.odoStr = (odometer / 1000).toFixed(1)
  S.weightStr = Math.round(vehMass).toString()

  const bts = []
  const wheelNames = ["FL", "FR", "RL", "RR"]
  if (s.wheelThermalData) {
    for (let wi = 0; wi < wheelNames.length; wi++) {
      const wn = wheelNames[wi]
      let wt = null
      for (const wk in s.wheelThermalData) {
        const wd = s.wheelThermalData[wk]
        if (wd && wd.name && wd.name.indexOf(wn) >= 0 && wd.brakeSurfaceTemperature !== undefined) {
          wt = wd.brakeSurfaceTemperature
          break
        }
      }
      if (wt === null && s.electrics) wt = s.electrics["brakeSurfaceTemperature_" + wn] || null
      if (wt !== null) {
        const c = wt < 100 ? "#4488ff" : wt < 300 ? "#00cc55" : wt < 500 ? "#ffcc00" : "#ff2244"
        bts.push({ val: Math.round(wt) + "°", color: c })
      }
    }
  }
  S.brakeTemps = bts

  if (!lay && rootRef.value) {
    const W = rootRef.value.offsetWidth || 800
    const H = rootRef.value.offsetHeight || 300
    if (W > 200 && H > 120) doLayout(W, H)
  }
  if (lay) drawAll()
})

/* ==================== LIFECYCLE ==================== */
let resizeObserver = null
let initTimer = null

onMounted(() => {
  requestData()

  // The HUD-app host resizes our container when the user drags widget
  // edges — a ResizeObserver is the framework-agnostic way to relayout.
  if (rootRef.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const W = Math.round(entry.contentRect.width)
        const H = Math.round(entry.contentRect.height)
        if (W > 200 && H > 120) {
          lay = null
          doLayout(W, H)
          drawAll()
        }
      }
    })
    resizeObserver.observe(rootRef.value)
  }

  initTimer = setTimeout(() => {
    if (!lay && rootRef.value) {
      const W = rootRef.value.offsetWidth || 800
      const H = rootRef.value.offsetHeight || 300
      if (W > 200 && H > 120) { doLayout(W, H); drawAll() }
    }
  }, 200)
})

onUnmounted(() => {
  if (initTimer) clearTimeout(initTimer)
  if (resizeObserver) resizeObserver.disconnect()
  tuneDragEnd()
  if (cvsMap) {
    cvsMap.removeEventListener("mousedown", onDown)
    cvsMap.removeEventListener("mousemove", onMove)
    cvsMap.removeEventListener("mouseup", onUp)
    cvsMap.removeEventListener("mouseleave", onUp)
    cvsMap.removeEventListener("touchstart", onTouchDown)
    cvsMap.removeEventListener("touchmove", onTouchMove)
    cvsMap.removeEventListener("touchend", onUp)
    cvsMap.removeEventListener("touchcancel", onUp)
  }
})
</script>
