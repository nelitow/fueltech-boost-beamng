<template>
  <div class="ftk-card">
    <div class="ftk-head">
      <span class="ftk-brand">FUELTECH</span>
      <span class="ftk-sub">BOOST CONTROLLER</span>
      <span class="ftk-ver">v8.5.0</span>
    </div>

    <p class="ftk-desc">
      Boost-by-RPM controller — auto-attached to every vehicle. Set a target
      pressure per RPM point and the controller delivers it. Tune from the
      <b>FuelTech Dashboard</b> HUD app (add it via HUD Apps) or apply a quick
      preset below to the current vehicle.
    </p>

    <div class="ftk-row-label">Quick presets — current vehicle</div>
    <div class="ftk-actions">
      <button v-for="p in presets" :key="p.id" class="ftk-btn"
              :class="{ 'ftk-btn-active': applied === p.id }"
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

    <div class="ftk-foot">
      <span v-if="feedback" class="ftk-feedback">{{ feedback }}</span>
      <span v-else>Full tuning (drag-to-edit boost map, power curves) lives in the HUD app.</span>
    </div>
  </div>
</template>

<script setup>
// Pause-menu card for the shared "Mods" tab. Quick actions only — the
// deep-tuning surface stays in the FuelTech Dashboard HUD app.
import { ref } from "vue"
import { useBridge } from "@/bridge"

const { api } = useBridge()

const presets = [
  { id: "MIN", label: "OFF", hint: "zero boost" },
  { id: "STOCK", label: "STOCK", hint: "factory boost" },
  { id: "AUTOMAX", label: "AUTO MAX", hint: "max safe boost" },
  { id: "MAX", label: "MAX", hint: "rated max +30%" },
]

const applied = ref("")
const feedback = ref("")
let feedbackTimer = null

function flash(msg, id) {
  applied.value = id || ""
  feedback.value = msg
  if (feedbackTimer) clearTimeout(feedbackTimer)
  feedbackTimer = setTimeout(() => { feedback.value = "" }, 2500)
}

function luaCall(code) {
  try { api.activeObjectLua(code) } catch (e) { /* no active vehicle */ }
}

function applyPreset(id) {
  luaCall('controller.getControllerSafe("fueltechBoostController").setPreset("' + id + '")')
  flash("Applied " + id + " to the current vehicle.", id)
}
function toggleALS() {
  luaCall('controller.getControllerSafe("fueltechBoostController").toggleAntiLag()')
  flash("Toggled Anti-Lag on the current vehicle.")
}
function toggleTC() {
  luaCall('controller.getControllerSafe("fueltechDrivetrain").toggleDriveMode("tcs")')
  flash("Toggled custom traction control.")
}
</script>

<style lang="scss" scoped>
/* Nelitomorphism tokens (github.com/nelitow/Nelitomorphism-UI-Kit):
   cool near-blacks at hue 250, cyan accent + violet accent-2,
   4px spacing grid, 6/10/14px radii, mono for data. */
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
  gap: 12px;
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
  .ftk-ver {
    margin-left: auto;
    font-family: "Geist Mono", Consolas, monospace;
    font-size: 11px;
    color: var(--accent-2);
  }
}

.ftk-desc {
  margin: 0;
  color: var(--text-2);

  b { color: var(--text-1); }
}

.ftk-row-label {
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-2);
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
