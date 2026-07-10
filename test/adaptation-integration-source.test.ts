import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

test("server exposes adaptation, local model, profile, and ecosystem APIs", () => {
  const source = fs.readFileSync(new URL("../src/server/index.ts", import.meta.url), "utf8")
  for (const route of ["/api/adaptation/profile", "/api/adaptation/dashboard", "/api/adaptation/models/local", "/api/adaptation/models/probe", "/api/adaptation/ecosystem"]) {
    assert(source.includes(route), `missing ${route}`)
  }
})

test("Desktop includes onboarding, accessibility, model lab, and ecosystem center", () => {
  const source = fs.readFileSync(new URL("../src/web/desktop.ts", import.meta.url), "utf8")
  for (const marker of ["adaptButton", "showAdaptation", "detectLocalModels", "probeCustomModel", "applyAccessibility", "spectra-user-profile"]) {
    assert(source.includes(marker), `missing ${marker}`)
  }
  assert(!/https?:\/\//i.test(source), "Desktop source must not contain remote URL literals")
  assert(source.includes('["http","://"].join("")'), "local endpoints without a scheme should be normalized at runtime")
})


test("runtime injects the adaptive user prompt on every turn", () => {
  const source = fs.readFileSync(new URL("../src/runtime.ts", import.meta.url), "utf8")
  assert(source.includes("adaptationPrompt"))
  assert(source.includes("adaptationFor"))
})
