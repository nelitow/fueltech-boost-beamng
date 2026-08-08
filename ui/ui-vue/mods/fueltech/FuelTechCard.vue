<template>
  <div class="ftk-card">
    <div class="ftk-head">
      <span class="ftk-brand">FUELTECH</span>
      <span class="ftk-sub">BOOST CONTROLLER</span>
      <span v-if="pkNm > 0" class="ftk-peaks">▲ {{ pkNm }}<i>Nm</i> {{ pkHp }}<i>HP</i></span>
      <span class="ftk-ver">v8.7.0</span>
    </div>

    <div class="ftk-row-label">Boost map — drag the dots, changes apply instantly</div>
    <canvas ref="mapCvs" class="ftk-canvas ftk-map"
            @mousedown="mapDown" @mousemove="mapMove" @mouseup="mapUp" @mouseleave="mapUp"
            @touchstart.prevent="mapTouchDown" @touchmove.prevent="mapTouchMove" @touchend="mapUp"></canvas>

    <div class="ftk-row-label">Projected power &amp; torque
      <span v-if="stockPkNm > 0" class="ftk-stockref">stock {{ stockPkNm }}Nm · {{ stockPkHp }}HP</span>
    </div>
    <canvas ref="pwrCvs" class="ftk-canvas ftk-pwr"></canvas>

    <div class="ftk-row-label">Presets</div>
    <div class="ftk-actions">
      <button v-for="p in presets" :key="p.id" class="ftk-btn"
              :class="{ 'ftk-btn-active': preset === p.id }"
              @click="applyPreset(p.id)">
        <span class="ftk-btn-label">{{ p.label }}</span>
        <span class="ftk-btn-hint">{{ p.hint }}</span>
      </button>
    </div>

    <div class="ftk-row-label">Systems</div>
    <div class="ftk-actions">
      <button class="ftk-btn" @click="toggleALS">
        <span class="ftk-btn-label">ANTI-LAG</span>
        <span class="ftk-btn-hint">toggle ALS</span>
      </button>
      <button class="ftk-btn" @click="toggleTC">
        <span class="ftk-btn-label">TRACTION</span>
        <span class="ftk-btn-hint">toggle custom TC</span>
      </button>
    </div>

    <template v-if="n2oAvailable === true">
      <div class="ftk-row-label">Nitrous — progressive shot, tune by RPM</div>
      <canvas ref="n2oCvs" class="ftk-canvas ftk-n2o"
              @mousedown="n2oDown" @mousemove="n2oMove" @mouseup="n2oUp" @mouseleave="n2oUp"
              @touchstart.prevent="n2oTouchDown" @touchmove.prevent="n2oTouchMove" @touchend="n2oUp"></canvas>

      <div class="ftk-row-label">Nitrous by gear — tap to cycle OFF / HALF / FULL</div>
      <div class="ftk-geargrid">
        <button v-for="(m, i) in n2oGearMul.slice(0, n2oNumGears)" :key="i" class="ftk-gear-btn"
                :class="{ 'ftk-gear-off': m === 0, 'ftk-gear-half': m > 0 && m < 1, 'ftk-gear-full': m >= 1 }"
                @click="cycleGear(i)">
          <span class="ftk-gear-num">G{{ i + 1 }}</span>
          <span class="ftk-gear-pct">{{ Math.round(m * 100) }}%</span>
        </button>
      </div>

      <div class="ftk-row-label">Nitrous presets</div>
      <div class="ftk-actions">
        <button v-for="p in n2oPresets" :key="p.id" class="ftk-btn" @click="applyN2OPreset(p.id)">
          <span class="ftk-btn-label">{{ p.label }}</span>
          <span class="ftk-btn-hint">{{ p.hint }}</span>
        </button>
      </div>

      <div class="ftk-row-label">Nitrous settings</div>
      <div class="ftk-n2o-settings">
        <label class="ftk-slider-row">
          <span>Activation RPM</span>
          <input type="range" min="1000" max="7000" step="100" v-model.number="n2oActivationRpm" @change="applyN2OSettings">
          <span class="ftk-slider-val">{{ n2oActivationRpm }}</span>
        </label>
        <label class="ftk-slider-row">
          <span>Ramp-in time</span>
          <input type="range" min="0.2" max="3" step="0.1" v-model.number="n2oRampUp" @change="applyN2OSettings">
          <span class="ftk-slider-val">{{ n2oRampUp.toFixed(1) }}s</span>
        </label>
      </div>

      <div class="ftk-actions">
        <button class="ftk-btn" :class="{ 'ftk-btn-active': n2oArmed }" @click="toggleN2OArm">
          <span class="ftk-btn-label">ARM N2O</span>
          <span class="ftk-btn-hint">{{ n2oArmed ? 'armed' : 'toggle arm' }}</span>
        </button>
      </div>
    </template>

    <div class="ftk-foot">
      <span v-if="feedback" class="ftk-feedback">{{ feedback }}</span>
      <span v-else>Same tuner as the FuelTech Dashboard HUD app — edits sync both ways.</span>
    </div>
  </div>
</template>

<script setup>
// Pause-menu tuner card — full feature parity with the HUD app's TUNE
// panel: interactive boost map, projected power/torque curves with peaks,
// presets, and ALS/TC toggles. Talks to the same vehicle controllers over
// the same guihooks, so HUD and card stay in sync automatically.
import { ref, onMounted, onUnmounted, nextTick } from "vue"
import { useBridge } from "@/bridge"

const { api, events } = useBridge()

/* ── Nelitomorphism canvas palette ── */
const PAL = {
  accent: "#22ccee", accentHi: "#67e0f9", accent2: "#a78bfa",
  torque: "#f87171", power: "#22ccee",
  ink: "#eceaf4", muted: "#8b8fa8", grid: "#232336",
  bg: "rgba(15,14,23,0.65)",
}

const presets = [
  { id: "MIN", label: "OFF", hint: "zero boost" },
  { id: "STOCK", label: "STOCK", hint: "factory wastegate" },
  { id: "AUTOMAX", label: "AUTO MAX", hint: "max power, engine safe" },
  { id: "MAX", label: "MAX", hint: "rated max +30%" },
]

const preset = ref("")
const pkNm = ref(0), pkHp = ref(0)
const stockPkNm = ref(0), stockPkHp = ref(0)
const feedback = ref("")
const mapCvs = ref(null), pwrCvs = ref(null)

let map = [[2000, 5], [3000, 10], [4000, 15], [5000, 20], [6000, 20], [7000, 18]]
let pwrData = null
let boostMax = 0
let maxRPM = 8000
const maxPSI = 40
let feedbackTimer = null

/* ── Nitrous ── */
const n2oPresets = [
  { id: "OFF", label: "OFF", hint: "zero shot" },
  { id: "MILD", label: "MILD", hint: "street shot" },
  { id: "AGGRESSIVE", label: "AGGRESSIVE", hint: "big shot" },
]
const n2oCvs = ref(null)
// Defaults to hidden until the controller confirms it's actually usable —
// reset()/toggleArm() can leave other nitrous electrics keys defined even
// on a disabled controller, so "unknown" must never render as "shown".
const n2oAvailable = ref(false)
const n2oArmed = ref(false)
const n2oActivationRpm = ref(2500)
const n2oRampUp = ref(1.2)
const n2oGearMul = ref([0, 0.5, 1, 1, 1, 1, 1, 1])
const n2oNumGears = ref(6)
let n2oMap = [[2500, 15], [3500, 25], [4500, 35], [5500, 40], [6500, 35], [7500, 25]]
let n2oRampDown = 0.35
let n2oDragIdx = -1, n2oHoverIdx = -1
let n2oMaxHp = 100

function requestN2OData() {
  luaCall('controller.getControllerSafe("fueltechNitrous").getAvailability()')
  luaCall('controller.getControllerSafe("fueltechNitrous").getNitrousTable()')
  luaCall('controller.getControllerSafe("fueltechNitrous").getGearInfo()')
  luaCall('controller.getControllerSafe("fueltechNitrous").getSettings()')
}

function onN2OAvailable(d) {
  n2oAvailable.value = !!(d && d.available)
}
function onN2OTable(d) {
  if (d && d.length) {
    n2oMap = []
    for (let i = 0; i < d.length; i++) n2oMap.push([d[i].rpm, d[i].hp])
    n2oMaxHp = Math.max(100, Math.ceil((Math.max(...n2oMap.map(p => p[1])) * 1.25) / 10) * 10)
    drawN2O()
  }
}
function onN2OGearInfo(d) {
  if (d && d.multipliers) n2oGearMul.value = d.multipliers.slice(0, 8)
  if (d && d.numGears) n2oNumGears.value = d.numGears
}
function onN2OSettings(d) {
  if (!d) return
  n2oArmed.value = !!d.armed
  if (d.rampUp) n2oRampUp.value = d.rampUp
  if (d.rampDown) n2oRampDown = d.rampDown
  if (d.activationRPM) n2oActivationRpm.value = d.activationRPM
}

function cycleGear(i) {
  const cur = n2oGearMul.value[i]
  const next = cur >= 1 ? 0 : cur > 0 ? 1 : 0.5
  const arr = n2oGearMul.value.slice()
  arr[i] = next
  n2oGearMul.value = arr
  luaCall('controller.getControllerSafe("fueltechNitrous").setGearMultiplier(' + (i + 1) + "," + next + ")")
}
function applyN2OPreset(id) {
  luaCall('controller.getControllerSafe("fueltechNitrous").setPreset("' + id + '")')
  flash("Applied " + id + " nitrous shot.")
  setTimeout(() => luaCall('controller.getControllerSafe("fueltechNitrous").getNitrousTable()'), 150)
}
function toggleN2OArm() {
  n2oArmed.value = !n2oArmed.value
  luaCall('controller.getControllerSafe("fueltechNitrous").toggleArm()')
  flash(n2oArmed.value ? "Nitrous armed." : "Nitrous disarmed.")
}
function applyN2OSettings() {
  luaCall('controller.getControllerSafe("fueltechNitrous").setActivationRPM(' + n2oActivationRpm.value + ")")
  luaCall('controller.getControllerSafe("fueltechNitrous").setRampTimes(' + n2oRampUp.value + "," + n2oRampDown + ")")
}

/* ── Nitrous curve canvas (RPM vs added HP) ── */
function n2oGeom() {
  const s = setupCanvas(n2oCvs.value)
  if (!s) return null
  return { ...s, gw: s.w - PADL - PADR, gh: s.h - PADT - PADB }
}
const n2x = (g, r) => PADL + cl(r / maxRPM, 0, 1) * g.gw
const n2y = (g, hp) => PADT + g.gh - cl(hp / n2oMaxHp, 0, 1) * g.gh
function lerpN2O(r) {
  if (!n2oMap.length) return 0
  if (r <= n2oMap[0][0]) return n2oMap[0][1]
  if (r >= n2oMap[n2oMap.length - 1][0]) return n2oMap[n2oMap.length - 1][1]
  for (let i = 0; i < n2oMap.length - 1; i++) {
    if (r >= n2oMap[i][0] && r <= n2oMap[i + 1][0]) {
      const span = n2oMap[i + 1][0] - n2oMap[i][0]
      if (span < 1) return n2oMap[i][1]
      return n2oMap[i][1] + (n2oMap[i + 1][1] - n2oMap[i][1]) * ((r - n2oMap[i][0]) / span)
    }
  }
  return 0
}
function drawN2O() {
  const g = n2oGeom()
  if (!g) return
  const { ctx, w, h } = g
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = PAL.bg; ctx.fillRect(0, 0, w, h)

  ctx.strokeStyle = PAL.grid; ctx.lineWidth = 0.5
  ctx.font = "9px Consolas,monospace"; ctx.fillStyle = PAL.muted
  for (let i = 0; i <= 4; i++) {
    const yy = PADT + (g.gh / 4) * i
    ctx.beginPath(); ctx.moveTo(PADL, yy); ctx.lineTo(w - PADR, yy); ctx.stroke()
    ctx.textAlign = "right"
    ctx.fillText((n2oMaxHp - (n2oMaxHp / 4) * i).toFixed(0) + "hp", PADL - 4, yy + 3)
  }
  for (let i = 0; i <= 4; i++) {
    const xx = PADL + (g.gw / 4) * i
    ctx.beginPath(); ctx.moveTo(xx, PADT); ctx.lineTo(xx, PADT + g.gh); ctx.stroke()
    ctx.textAlign = "center"
    ctx.fillText(Math.round((maxRPM / 4) * i / 1000) + "k", xx, h - 8)
  }

  const steps = 40
  ctx.beginPath(); ctx.moveTo(n2x(g, 0), n2y(g, 0))
  for (let s = 0; s <= steps; s++) ctx.lineTo(n2x(g, (maxRPM / steps) * s), n2y(g, lerpN2O((maxRPM / steps) * s)))
  ctx.lineTo(n2x(g, maxRPM), n2y(g, 0)); ctx.closePath()
  const grad = ctx.createLinearGradient(0, PADT, 0, PADT + g.gh)
  grad.addColorStop(0, "rgba(167,139,250,0.30)"); grad.addColorStop(1, "rgba(167,139,250,0.02)")
  ctx.fillStyle = grad; ctx.fill()
  ctx.beginPath(); ctx.moveTo(n2x(g, 0), n2y(g, lerpN2O(0)))
  for (let s = 1; s <= steps; s++) ctx.lineTo(n2x(g, (maxRPM / steps) * s), n2y(g, lerpN2O((maxRPM / steps) * s)))
  ctx.strokeStyle = PAL.accent2; ctx.lineWidth = 1.5; ctx.lineJoin = "round"; ctx.stroke()

  for (let i = 0; i < n2oMap.length; i++) {
    const bx = n2x(g, n2oMap[i][0]), by = n2y(g, n2oMap[i][1])
    const hot = i === n2oHoverIdx || i === n2oDragIdx
    ctx.beginPath(); ctx.arc(bx, by, hot ? 7 : 5, 0, 6.283)
    ctx.fillStyle = hot ? "#c4b0fc" : PAL.accent2; ctx.fill()
    ctx.beginPath(); ctx.arc(bx, by, 2, 0, 6.283); ctx.fillStyle = "rgba(15,14,23,0.9)"; ctx.fill()
    if (hot) {
      ctx.font = "bold 11px Consolas,monospace"; ctx.fillStyle = PAL.ink; ctx.textAlign = "center"
      ctx.fillText(n2oMap[i][0] + " / " + n2oMap[i][1].toFixed(0) + " hp", bx, by - 12)
    }
  }
}
function n2oNearest(x, y) {
  const g = n2oGeom(); if (!g) return -1
  let best = -1, bd = 18 * 18
  for (let i = 0; i < n2oMap.length; i++) {
    const dx = n2x(g, n2oMap[i][0]) - x, dy = n2y(g, n2oMap[i][1]) - y
    if (dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = i }
  }
  return best
}
function n2oPtFromEvent(e) {
  const r = n2oCvs.value.getBoundingClientRect()
  const p = (e.touches && e.touches[0]) || e
  return { x: p.clientX - r.left, y: p.clientY - r.top }
}
function n2oDown(e) { const p = n2oPtFromEvent(e); n2oDragIdx = n2oNearest(p.x, p.y) }
function n2oTouchDown(e) { n2oDown(e) }
function n2oMoveTo(x, y) {
  const g = n2oGeom(); if (!g || n2oDragIdx < 0) return
  n2oMap[n2oDragIdx][0] = cl(Math.round(((x - PADL) / g.gw) * maxRPM / 100) * 100, 1000, Math.max(2000, maxRPM - 100))
  n2oMap[n2oDragIdx][1] = cl(Math.round(((PADT + g.gh - y) / g.gh) * n2oMaxHp), 0, n2oMaxHp)
  drawN2O()
}
function n2oMove(e) {
  const p = n2oPtFromEvent(e)
  if (n2oDragIdx >= 0) { n2oMoveTo(p.x, p.y); return }
  const h2 = n2oNearest(p.x, p.y)
  if (h2 !== n2oHoverIdx) { n2oHoverIdx = h2; n2oCvs.value.style.cursor = h2 >= 0 ? "grab" : "default"; drawN2O() }
}
function n2oTouchMove(e) { const p = n2oPtFromEvent(e); n2oMoveTo(p.x, p.y) }
function n2oUp() {
  if (n2oDragIdx < 0) return
  n2oMap.sort((a, b) => a[0] - b[0])
  for (let i = 0; i < n2oMap.length; i++) {
    luaCall('controller.getControllerSafe("fueltechNitrous").setPoint(' + (i + 1) + "," + n2oMap[i][0] + "," + n2oMap[i][1] + ")")
  }
  n2oDragIdx = -1
  drawN2O()
}

function flash(msg) {
  feedback.value = msg
  if (feedbackTimer) clearTimeout(feedbackTimer)
  feedbackTimer = setTimeout(() => { feedback.value = "" }, 2500)
}

function luaCall(code) {
  try { api.activeObjectLua(code) } catch (e) { /* no active vehicle */ }
}
function requestData() {
  luaCall('controller.getControllerSafe("fueltechBoostController").getBoostTable()')
  luaCall('controller.getControllerSafe("fueltechBoostController").sendPowerCurves()')
}

function applyPreset(id) {
  preset.value = id
  luaCall('controller.getControllerSafe("fueltechBoostController").setPreset("' + id + '")')
  flash("Applied " + id + " to the current vehicle.")
  setTimeout(requestData, 150)
}
function toggleALS() {
  luaCall('controller.getControllerSafe("fueltechBoostController").toggleAntiLag()')
  flash("Toggled Anti-Lag.")
}
function toggleTC() {
  luaCall('controller.getControllerSafe("fueltechDrivetrain").toggleDriveMode("tcs")')
  flash("Toggled custom traction control.")
}

/* ── Events (same guihooks the HUD app uses) ── */
function onBoostTable(d) {
  if (d && d.length) {
    map = []
    for (let i = 0; i < d.length; i++) map.push([d[i].rpm, d[i].psi])
    drawMap()
  }
}
function onPowerCurves(d) {
  if (!d) return
  pwrData = d
  pkNm.value = d.projPeakTorque || 0
  pkHp.value = d.projPeakHP || 0
  stockPkNm.value = d.stockPeakTorque || 0
  stockPkHp.value = d.stockPeakPowerHP || 0
  if (d.maxRPM) maxRPM = Math.max(d.maxRPM, 4000)
  drawPwr()
}

/* ── Canvas: shared helpers ── */
const cl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
function lerpMap(r) {
  if (!map.length) return 0
  if (r <= map[0][0]) return map[0][1]
  if (r >= map[map.length - 1][0]) return map[map.length - 1][1]
  for (let i = 0; i < map.length - 1; i++) {
    if (r >= map[i][0] && r <= map[i + 1][0]) {
      const span = map[i + 1][0] - map[i][0]
      if (span < 1) return map[i][1]
      return map[i][1] + (map[i + 1][1] - map[i][1]) * ((r - map[i][0]) / span)
    }
  }
  return 0
}

function setupCanvas(cvs) {
  if (!cvs) return null
  const dpr = window.devicePixelRatio || 1
  const w = cvs.clientWidth, h = cvs.clientHeight
  if (w < 20 || h < 20) return null
  // Reassigning canvas.width/height ALWAYS clears the bitmap, even to the
  // same value — and this runs on every hover-hit-test (nearest()), not
  // just on actual redraws. Without this guard the canvas got blanked on
  // nearly every mousemove and only repainted when the hover index
  // happened to change, which is exactly what made dragging unusable
  // while looking fine at rest.
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr)
  if (cvs.width !== pw || cvs.height !== ph) {
    cvs.width = pw
    cvs.height = ph
  }
  const ctx = cvs.getContext("2d")
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, w, h }
}

/* ── Boost map editor ── */
const PADL = 34, PADR = 10, PADT = 10, PADB = 22
let dragIdx = -1, hoverIdx = -1

function mapGeom() {
  const s = setupCanvas(mapCvs.value)
  if (!s) return null
  return { ...s, gw: s.w - PADL - PADR, gh: s.h - PADT - PADB }
}
const mx = (g, r) => PADL + cl(r / maxRPM, 0, 1) * g.gw
const my = (g, v) => PADT + g.gh - cl(v / maxPSI, 0, 1) * g.gh

function drawMap() {
  const g = mapGeom()
  if (!g) return
  const { ctx, w, h } = g
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = PAL.bg; ctx.fillRect(0, 0, w, h)

  ctx.strokeStyle = PAL.grid; ctx.lineWidth = 0.5
  ctx.font = "9px Consolas,monospace"; ctx.fillStyle = PAL.muted
  for (let i = 0; i <= 4; i++) {
    const yy = PADT + (g.gh / 4) * i
    ctx.beginPath(); ctx.moveTo(PADL, yy); ctx.lineTo(w - PADR, yy); ctx.stroke()
    ctx.textAlign = "right"
    ctx.fillText(((maxPSI - (maxPSI / 4) * i)).toFixed(0) + "psi", PADL - 4, yy + 3)
  }
  for (let i = 0; i <= 4; i++) {
    const xx = PADL + (g.gw / 4) * i
    ctx.beginPath(); ctx.moveTo(xx, PADT); ctx.lineTo(xx, PADT + g.gh); ctx.stroke()
    ctx.textAlign = "center"
    ctx.fillText(Math.round((maxRPM / 4) * i / 1000) + "k", xx, h - 8)
  }

  if (boostMax > 0 && boostMax < maxPSI) {
    const ly = my(g, boostMax)
    ctx.save(); ctx.setLineDash([5, 4])
    ctx.strokeStyle = "rgba(167,139,250,0.5)"; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(PADL, ly); ctx.lineTo(w - PADR, ly); ctx.stroke()
    ctx.restore()
  }

  const steps = 40
  ctx.beginPath(); ctx.moveTo(mx(g, 0), my(g, 0))
  for (let s = 0; s <= steps; s++) ctx.lineTo(mx(g, (maxRPM / steps) * s), my(g, lerpMap((maxRPM / steps) * s)))
  ctx.lineTo(mx(g, maxRPM), my(g, 0)); ctx.closePath()
  const grad = ctx.createLinearGradient(0, PADT, 0, PADT + g.gh)
  grad.addColorStop(0, "rgba(34,204,238,0.30)"); grad.addColorStop(1, "rgba(34,204,238,0.02)")
  ctx.fillStyle = grad; ctx.fill()
  ctx.beginPath(); ctx.moveTo(mx(g, 0), my(g, lerpMap(0)))
  for (let s = 1; s <= steps; s++) ctx.lineTo(mx(g, (maxRPM / steps) * s), my(g, lerpMap((maxRPM / steps) * s)))
  ctx.strokeStyle = PAL.accent; ctx.lineWidth = 1.5; ctx.lineJoin = "round"; ctx.stroke()

  for (let i = 0; i < map.length; i++) {
    const bx = mx(g, map[i][0]), by = my(g, map[i][1])
    const hot = i === hoverIdx || i === dragIdx
    ctx.beginPath(); ctx.arc(bx, by, hot ? 7 : 5, 0, 6.283)
    ctx.fillStyle = hot ? PAL.accentHi : PAL.accent; ctx.fill()
    ctx.beginPath(); ctx.arc(bx, by, 2, 0, 6.283); ctx.fillStyle = "rgba(15,14,23,0.9)"; ctx.fill()
    if (hot) {
      ctx.font = "bold 11px Consolas,monospace"; ctx.fillStyle = PAL.ink; ctx.textAlign = "center"
      ctx.fillText(map[i][0] + " / " + map[i][1].toFixed(1) + " PSI", bx, by - 12)
    }
  }
}

function ptFromEvent(e) {
  const r = mapCvs.value.getBoundingClientRect()
  const p = (e.touches && e.touches[0]) || e
  return { x: p.clientX - r.left, y: p.clientY - r.top }
}
function nearest(x, y) {
  const g = mapGeom(); if (!g) return -1
  let best = -1, bd = 18 * 18
  for (let i = 0; i < map.length; i++) {
    const dx = mx(g, map[i][0]) - x, dy = my(g, map[i][1]) - y
    if (dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = i }
  }
  return best
}
function mapDown(e) { const p = ptFromEvent(e); dragIdx = nearest(p.x, p.y) }
function mapTouchDown(e) { mapDown(e) }
function moveTo(x, y) {
  const g = mapGeom(); if (!g || dragIdx < 0) return
  map[dragIdx][0] = cl(Math.round(((x - PADL) / g.gw) * maxRPM / 100) * 100, 1000, Math.max(2000, maxRPM - 100))
  map[dragIdx][1] = cl(Math.round(((PADT + g.gh - y) / g.gh) * maxPSI * 2) / 2, 0, maxPSI)
  drawMap()
}
function mapMove(e) {
  const p = ptFromEvent(e)
  if (dragIdx >= 0) { moveTo(p.x, p.y); return }
  const h2 = nearest(p.x, p.y)
  if (h2 !== hoverIdx) { hoverIdx = h2; mapCvs.value.style.cursor = h2 >= 0 ? "grab" : "default"; drawMap() }
}
function mapTouchMove(e) { const p = ptFromEvent(e); moveTo(p.x, p.y) }
function mapUp() {
  if (dragIdx < 0) return
  preset.value = "CUSTOM"
  map.sort((a, b) => a[0] - b[0])
  for (let i = 0; i < map.length; i++) {
    luaCall('controller.getControllerSafe("fueltechBoostController").setPoint(' + (i + 1) + "," + map[i][0] + "," + map[i][1] + ")")
  }
  dragIdx = -1
  setTimeout(() => luaCall('controller.getControllerSafe("fueltechBoostController").sendPowerCurves()'), 120)
  drawMap()
}

/* ── Power / torque graph ── */
function drawPwr() {
  const s = setupCanvas(pwrCvs.value)
  if (!s || !pwrData) return
  const { ctx, w, h } = s
  const gw = w - PADL - PADR, gh = h - PADT - PADB
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = PAL.bg; ctx.fillRect(0, 0, w, h)

  const td = pwrData.torque || [], pd = pwrData.power || []
  const bt = pwrData.baseTorque || [], bp = pwrData.basePower || []
  if (!td.length) return
  const eR = pwrData.maxRPM || 7000
  let maxNm = 0, maxHP = 0
  for (const p of td) if (p.nm > maxNm) maxNm = p.nm
  for (const p of bt) if (p.nm > maxNm) maxNm = p.nm
  for (const p of pd) if (p.hp > maxHP) maxHP = p.hp
  for (const p of bp) if (p.hp > maxHP) maxHP = p.hp
  const lim = pwrData.maxTorqueRating || -1
  if (lim > 0 && lim > maxNm) maxNm = lim * 1.05
  maxNm = Math.ceil(maxNm / 50) * 50 || 400
  maxHP = Math.ceil(maxHP / 25) * 25 || 200

  const tx = r => PADL + cl(r / eR, 0, 1) * gw
  const tyN = nm => PADT + gh - cl(nm / maxNm, 0, 1) * gh
  const tyH = hp => PADT + gh - cl(hp / maxHP, 0, 1) * gh

  ctx.strokeStyle = PAL.grid; ctx.lineWidth = 0.5
  ctx.font = "9px Consolas,monospace"; ctx.fillStyle = PAL.muted
  for (let i = 0; i <= 4; i++) {
    const yy = PADT + (gh / 4) * i
    ctx.beginPath(); ctx.moveTo(PADL, yy); ctx.lineTo(w - PADR, yy); ctx.stroke()
    ctx.textAlign = "right"; ctx.fillText((maxNm - (maxNm / 4) * i).toFixed(0), PADL - 4, yy + 3)
  }
  ctx.textAlign = "center"
  for (let i = 0; i <= 4; i++) ctx.fillText(Math.round((eR / 4) * i / 1000) + "k", PADL + (gw / 4) * i, h - 8)

  if (lim > 0) {
    const ly = tyN(lim)
    ctx.save(); ctx.setLineDash([5, 4])
    ctx.strokeStyle = "rgba(255,51,85,0.55)"; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(PADL, ly); ctx.lineTo(w - PADR, ly); ctx.stroke()
    ctx.restore()
    ctx.fillStyle = "rgba(255,51,85,0.7)"; ctx.textAlign = "right"
    ctx.fillText("LIMIT " + lim + "Nm", w - PADR - 2, ly - 3)
  }

  function line(data, yF, key, col, dash) {
    ctx.save(); if (dash) ctx.setLineDash([4, 3])
    ctx.beginPath()
    for (let i = 0; i < data.length; i++) {
      const px = tx(data[i].rpm), py = yF(data[i][key])
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.lineJoin = "round"; ctx.stroke(); ctx.restore()
  }
  line(bt, tyN, "nm", "rgba(248,113,113,0.2)", true)
  line(bp, tyH, "hp", "rgba(34,204,238,0.2)", true)
  line(td, tyN, "nm", PAL.torque, false)
  line(pd, tyH, "hp", PAL.power, false)

  ctx.font = "10px Consolas,monospace"; ctx.textAlign = "left"
  ctx.fillStyle = PAL.torque; ctx.fillText("TQ " + (pwrData.projPeakTorque || 0) + "Nm", PADL + 6, PADT + 12)
  ctx.fillStyle = PAL.power; ctx.fillText("PWR " + (pwrData.projPeakHP || 0) + "HP", PADL + 6, PADT + 24)
}

/* ── Lifecycle ── */
let redrawTimer = null
onMounted(() => {
  events.on("fueltechBoostTable", onBoostTable)
  events.on("fueltechPowerCurves", onPowerCurves)
  events.on("fueltechNitrousTable", onN2OTable)
  events.on("fueltechNitrousGearInfo", onN2OGearInfo)
  events.on("fueltechNitrousSettings", onN2OSettings)
  events.on("fueltechNitrousAvailable", onN2OAvailable)
  requestData()
  requestN2OData()
  // canvases have zero size until the pause layout settles
  nextTick(() => { drawMap(); drawPwr(); drawN2O() })
  redrawTimer = setTimeout(() => { drawMap(); drawPwr(); drawN2O() }, 400)
})
onUnmounted(() => {
  events.off("fueltechBoostTable", onBoostTable)
  events.off("fueltechPowerCurves", onPowerCurves)
  events.off("fueltechNitrousTable", onN2OTable)
  events.off("fueltechNitrousGearInfo", onN2OGearInfo)
  events.off("fueltechNitrousSettings", onN2OSettings)
  events.off("fueltechNitrousAvailable", onN2OAvailable)
  if (redrawTimer) clearTimeout(redrawTimer)
  if (feedbackTimer) clearTimeout(feedbackTimer)
})
</script>

<style lang="scss" scoped>
/* Nelitomorphism tokens (github.com/nelitow/Nelitomorphism-UI-Kit). */
.ftk-card {
  --bg-0: hsl(250, 14%, 7%);
  --bg-1: hsl(250, 12%, 10%);
  --bg-2: hsl(250, 11%, 14%);
  --line: hsl(250, 12%, 22%);
  --text-1: hsl(250, 18%, 92%);
  --text-2: hsl(250, 10%, 62%);
  --accent: hsl(190, 95%, 55%);
  --accent-2: hsl(262, 85%, 66%);

  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: var(--bg-0);
  border: 1px solid var(--line);
  border-radius: 14px;
  color: var(--text-1);
  font-size: 13.5px;
  line-height: 1.45;
}

.ftk-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);

  .ftk-brand {
    font-family: "Geist Mono", Consolas, monospace;
    font-weight: 700;
    letter-spacing: 2px;
    color: var(--accent);
  }
  .ftk-sub {
    font-size: 11px;
    letter-spacing: 1.5px;
    color: var(--text-2);
  }
  .ftk-peaks {
    margin-left: auto;
    font-family: "Geist Mono", Consolas, monospace;
    font-size: 12px;
    font-weight: 700;
    color: var(--accent-2);

    i { font-style: normal; font-size: 9px; font-weight: 400; color: var(--text-2); margin-right: 4px; }
  }
  .ftk-ver {
    font-family: "Geist Mono", Consolas, monospace;
    font-size: 11px;
    color: var(--text-2);
  }
  .ftk-peaks + .ftk-ver { margin-left: 0; }
  .ftk-ver:first-of-type { margin-left: auto; }
}

.ftk-row-label {
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-2);

  .ftk-stockref {
    text-transform: none;
    letter-spacing: 0;
    margin-left: 8px;
    color: var(--text-2);
    opacity: 0.8;
  }
}

.ftk-canvas {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 10px;
  touch-action: none;
}
.ftk-map { height: 150px; cursor: default; }
.ftk-pwr { height: 130px; }
.ftk-n2o { height: 130px; cursor: default; }

.ftk-geargrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(56px, 1fr));
  gap: 6px;
}
.ftk-gear-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 4px;
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text-1);
  cursor: pointer;
  font-family: "Geist Mono", Consolas, monospace;
  transition: border-color 120ms ease, background 120ms ease;

  &:hover { border-color: var(--accent-2); }

  .ftk-gear-num { font-size: 11px; font-weight: 700; letter-spacing: 1px; }
  .ftk-gear-pct { font-size: 9px; color: var(--text-2); }
}
.ftk-gear-off .ftk-gear-pct { color: hsl(348, 90%, 65%); }
.ftk-gear-half { border-color: var(--warn); }
.ftk-gear-half .ftk-gear-pct { color: var(--warn); }
.ftk-gear-full { border-color: var(--accent-2); background: var(--bg-2); }
.ftk-gear-full .ftk-gear-pct { color: var(--accent-2); }

.ftk-n2o-settings {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ftk-slider-row {
  display: grid;
  grid-template-columns: 110px 1fr 56px;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-2);

  input[type="range"] {
    width: 100%;
    accent-color: var(--accent-2);
  }
  .ftk-slider-val {
    text-align: right;
    font-family: "Geist Mono", Consolas, monospace;
    color: var(--text-1);
  }
}

.ftk-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  gap: 8px;
}

.ftk-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 12px;
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--text-1);
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;

  &:hover {
    background: var(--bg-2);
    border-color: var(--accent);
  }

  .ftk-btn-label {
    font-family: "Geist Mono", Consolas, monospace;
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 1px;
  }
  .ftk-btn-hint {
    font-size: 10px;
    color: var(--text-2);
  }
}

.ftk-btn-active {
  border-color: var(--accent);
  background: var(--bg-2);

  .ftk-btn-label { color: var(--accent); }
}

.ftk-foot {
  padding-top: 8px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--text-2);

  .ftk-feedback { color: var(--accent); }
}
</style>
