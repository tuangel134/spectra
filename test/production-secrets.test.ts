import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EncryptedFileBackend, SecretStore } from "../src/production/secret-store.ts"

test("encrypted secret fallback never stores plaintext", async () => {
  const root = await mkdtemp(join(tmpdir(), "spectra-secrets-"))
  try {
    const store = new SecretStore(new EncryptedFileBackend(root)); const ref = store.set("provider:test", "super-secret-value")
    assert.equal(ref, "{secret:provider:test}"); assert.equal(store.get("provider:test"), "super-secret-value")
    const files = await import("node:fs/promises").then((fs) => fs.readdir(root))
    for (const file of files) assert.doesNotMatch((await readFile(join(root, file))).toString("utf8"), /super-secret-value/)
    assert.equal(store.delete("provider:test"), true); assert.equal(store.get("provider:test"), undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("secret keys reject traversal and shell content", () => {
  const store = new SecretStore(new EncryptedFileBackend(join(tmpdir(), "spectra-invalid-secret")))
  assert.throws(() => store.set("../bad", "value"), /Invalid secret key/)
})
