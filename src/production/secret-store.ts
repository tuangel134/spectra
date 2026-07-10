import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { configDir, IS_MAC, IS_WINDOWS } from "../util/platform.js"

export interface SecretBackend {
  readonly name: string
  readonly secure: boolean
  available(): boolean
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): boolean
}

function validKey(key: string): string {
  const normalized = key.trim()
  if (!/^[A-Za-z0-9._:-]{1,180}$/.test(normalized)) throw new Error("Invalid secret key")
  return normalized
}

function commandExists(command: string): boolean {
  const result = IS_WINDOWS
    ? spawnSync("where.exe", [command], { stdio: "ignore", timeout: 1_500 })
    : spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore", timeout: 1_500 })
  return result.status === 0
}

export class LinuxSecretServiceBackend implements SecretBackend {
  readonly name = "linux-secret-service"
  readonly secure = true
  available(): boolean { return !IS_WINDOWS && !IS_MAC && commandExists("secret-tool") }
  get(key: string): string | undefined {
    const result = spawnSync("secret-tool", ["lookup", "service", "spectra", "account", validKey(key)], { encoding: "utf8", timeout: 5_000 })
    return result.status === 0 ? result.stdout.trim() || undefined : undefined
  }
  set(key: string, value: string): void {
    const result = spawnSync("secret-tool", ["store", "--label=Spectra", "service", "spectra", "account", validKey(key)], { input: value, encoding: "utf8", timeout: 5_000 })
    if (result.status !== 0) throw new Error("Linux Secret Service rejected the secret")
  }
  delete(key: string): boolean { return spawnSync("secret-tool", ["clear", "service", "spectra", "account", validKey(key)], { stdio: "ignore", timeout: 5_000 }).status === 0 }
}

export class MacKeychainBackend implements SecretBackend {
  readonly name = "macos-keychain"
  readonly secure = true
  available(): boolean { return IS_MAC && commandExists("security") }
  get(key: string): string | undefined {
    const result = spawnSync("security", ["find-generic-password", "-s", "Spectra", "-a", validKey(key), "-w"], { encoding: "utf8", timeout: 5_000 })
    return result.status === 0 ? result.stdout.trim() || undefined : undefined
  }
  set(key: string, value: string): void {
    const result = spawnSync("security", ["add-generic-password", "-U", "-s", "Spectra", "-a", validKey(key), "-w", value], { stdio: "ignore", timeout: 5_000 })
    if (result.status !== 0) throw new Error("macOS Keychain rejected the secret")
  }
  delete(key: string): boolean { return spawnSync("security", ["delete-generic-password", "-s", "Spectra", "-a", validKey(key)], { stdio: "ignore", timeout: 5_000 }).status === 0 }
}

export class WindowsDpapiBackend implements SecretBackend {
  readonly name = "windows-dpapi"
  readonly secure = true
  constructor(private readonly root = join(configDir(), "secrets-dpapi")) {}
  available(): boolean { return IS_WINDOWS && commandExists("powershell.exe") }
  private path(key: string): string { return join(this.root, createHash("sha256").update(validKey(key)).digest("hex") + ".txt") }
  get(key: string): string | undefined {
    const file = this.path(key)
    if (!existsSync(file)) return undefined
    const script = "$s=Get-Content -Raw -LiteralPath $args[0]|ConvertTo-SecureString;$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}"
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, file], { encoding: "utf8", timeout: 10_000 })
    return result.status === 0 ? result.stdout.trim() || undefined : undefined
  }
  set(key: string, value: string): void {
    mkdirSync(this.root, { recursive: true })
    const script = "$i=[Console]::In.ReadToEnd();$i|ConvertTo-SecureString -AsPlainText -Force|ConvertFrom-SecureString|Set-Content -NoNewline -LiteralPath $args[0]"
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, this.path(key)], { input: value, encoding: "utf8", timeout: 10_000 })
    if (result.status !== 0) throw new Error("Windows DPAPI rejected the secret")
  }
  delete(key: string): boolean { const file = this.path(key); if (!existsSync(file)) return false; rmSync(file, { force: true }); return true }
}

interface CipherRecord { version: 1; iv: string; tag: string; data: string }

export class EncryptedFileBackend implements SecretBackend {
  readonly name = "encrypted-local-file"
  readonly secure = false
  constructor(private readonly root = join(configDir(), "secrets")) {}
  available(): boolean { return true }
  private keyPath(): string { return join(this.root, ".master-key") }
  private itemPath(key: string): string { return join(this.root, createHash("sha256").update(validKey(key)).digest("hex") + ".json") }
  private masterKey(): Buffer {
    mkdirSync(this.root, { recursive: true })
    const file = this.keyPath()
    if (!existsSync(file)) {
      writeFileSync(file, randomBytes(32), { mode: 0o600 })
      try { chmodSync(file, 0o600) } catch { /* Windows */ }
    }
    const key = readFileSync(file)
    if (key.length !== 32) throw new Error("Invalid Spectra secret master key")
    return key
  }
  get(key: string): string | undefined {
    const file = this.itemPath(key)
    if (!existsSync(file)) return undefined
    try {
      const record = JSON.parse(readFileSync(file, "utf8")) as CipherRecord
      const decipher = createDecipheriv("aes-256-gcm", this.masterKey(), Buffer.from(record.iv, "base64"))
      decipher.setAuthTag(Buffer.from(record.tag, "base64"))
      return Buffer.concat([decipher.update(Buffer.from(record.data, "base64")), decipher.final()]).toString("utf8")
    } catch { return undefined }
  }
  set(key: string, value: string): void {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", this.masterKey(), iv)
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
    const record: CipherRecord = { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") }
    const file = this.itemPath(key)
    const temporary = file + ".tmp"
    writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 })
    renameSync(temporary, file)
    try { chmodSync(file, 0o600) } catch { /* Windows */ }
  }
  delete(key: string): boolean { const file = this.itemPath(key); if (!existsSync(file)) return false; rmSync(file, { force: true }); return true }
}

export class SecretStore {
  private readonly backends: SecretBackend[]
  backend: SecretBackend
  constructor(backend?: SecretBackend) {
    this.backends = backend
      ? [backend]
      : [new MacKeychainBackend(), new WindowsDpapiBackend(), new LinuxSecretServiceBackend(), new EncryptedFileBackend()].filter((candidate) => candidate.available())
    this.backend = this.backends[0] ?? new EncryptedFileBackend()
  }
  get(key: string): string | undefined {
    const normalized = validKey(key)
    for (const candidate of this.backends) {
      try {
        const value = candidate.get(normalized)
        if (value !== undefined) { this.backend = candidate; return value }
      } catch { /* try the next available backend */ }
    }
    return undefined
  }
  set(key: string, value: string): string {
    if (!value) throw new Error("Secret cannot be empty")
    const normalized = validKey(key)
    let lastError: unknown
    for (const candidate of this.backends) {
      try {
        candidate.set(normalized, value)
        for (const other of this.backends) if (other !== candidate) { try { other.delete(normalized) } catch { /* remove stale copies best-effort */ } }
        this.backend = candidate
        return `{secret:${normalized}}`
      } catch (error) { lastError = error }
    }
    throw lastError instanceof Error ? lastError : new Error("No Spectra secret backend is available")
  }
  delete(key: string): boolean {
    const normalized = validKey(key)
    let deleted = false
    for (const candidate of this.backends) {
      try { deleted = candidate.delete(normalized) || deleted } catch { /* best effort across backends */ }
    }
    return deleted
  }
  status(): { name: string; secure: boolean } { return { name: this.backend.name, secure: this.backend.secure } }
}
