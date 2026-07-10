import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { UserAdaptationStore, defaultAdaptationProfile, normalizeAdaptationProfile, recommendationsFor, adaptationPrompt } from "../src/adaptation/profile.js"

test("adaptation profile defaults are safe and usable", () => {
  const profile = defaultAdaptationProfile()
  assert.equal(profile.autonomy, "balanced")
  assert.equal(profile.language, "es")
  assert.equal(profile.accessibility.fontScale, 1)
})

test("adaptation profile normalizes hostile or invalid values", () => {
  const profile = normalizeAdaptationProfile({ autonomy: "root", accessibility: { fontScale: 99 }, budgets: { dailyUsd: -5 } })
  assert.equal(profile.autonomy, "balanced")
  assert.equal(profile.accessibility.fontScale, 1.6)
  assert.equal(profile.budgets.dailyUsd, null)
})

test("adaptation profile saves atomically and exports/imports", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spectra-adapt-"))
  const file = path.join(dir, "profile.json")
  const store = new UserAdaptationStore(file)
  const saved = store.save({ language: "en", onboardingCompleted: true, experience: "beginner" })
  assert.equal(saved.language, "en")
  assert.equal(store.load().experience, "beginner")
  const exported = store.export()
  const other = new UserAdaptationStore(path.join(dir, "imported.json"))
  assert.equal(other.import(exported).language, "en")
})

test("recommendations map user intent to runtime behavior", () => {
  const profile = normalizeAdaptationProfile({ autonomy: "supervised", privacy: "local", experience: "beginner", modelStrategy: "local-first" })
  const recommendations = recommendationsFor(profile)
  assert.equal(recommendations["securityProfile"], "safe")
  assert.equal(recommendations["preferredProvider"], "local")
  assert.equal(recommendations["teachingMode"], true)
})


test("adaptation prompt changes agent behavior without exposing secrets", () => {
  const prompt = adaptationPrompt(normalizeAdaptationProfile({ experience: "beginner", privacy: "local", explanation: "guided", budgets: { sessionUsd: 1 } }))
  assert.match(prompt, /learning/)
  assert.match(prompt, /local models/)
  assert.match(prompt, /session USD 1/)
  assert.doesNotMatch(prompt, /api.?key/i)
})
