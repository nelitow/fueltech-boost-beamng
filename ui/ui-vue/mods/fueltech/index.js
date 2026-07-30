// FuelTech Boost Controller — Vue UI mod entry point (BeamNG 0.39+).
//
// Registers a card on the pause menu's shared "Mods" tab so the mod has a
// discoverable home outside the HUD widget. The runtime calls onUnload
// before a reload, then re-evaluates this module and calls onLoad again —
// keep top-level code side-effect free.
import { lua } from "@/bridge"

const BUTTON_ID = "fueltech-boost-controller"

export async function onLoad() {
  try {
    await lua.extensions.ui_pause_actions.registerModButton({
      id: BUTTON_ID,
      tabId: "mods",
      label: "FuelTech Boost",
      icon: "wrench",
      componentName: "/ui/ui-vue/mods/fueltech/FuelTechCard.vue",
    })
  } catch (e) {
    console.error("[fueltech] failed to register pause-menu button", e)
  }
}

export async function onUnload() {
  try {
    await lua.extensions.ui_pause_actions.unregisterModButton(BUTTON_ID)
  } catch (e) {
    /* pause actions already gone during shutdown — fine */
  }
}
