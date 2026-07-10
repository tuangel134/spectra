import test from "node:test"
import assert from "node:assert/strict"
import {
  CORE_PROTOCOL_VERSION,
  assertProtocolCompatible,
  isProtocolCompatible,
} from "../src/core/protocol.js"

test("core protocol accepts the current version and rejects future versions", () => {
  assert.equal(isProtocolCompatible(CORE_PROTOCOL_VERSION), true)
  assert.equal(isProtocolCompatible(CORE_PROTOCOL_VERSION + 1), false)
  assert.throws(() => assertProtocolCompatible(CORE_PROTOCOL_VERSION + 1), /Incompatible Spectra Core protocol/)
})
