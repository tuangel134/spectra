/** Subscription login with OS-backed secret storage and plaintext migration. */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { runDeviceFlow, DEVICE_FLOW_PRESETS, type DeviceFlowConfig, type DeviceCodeResponse } from "./device.js"
import { saveProviderKey } from "../config/writer.js"
import { configDir } from "../util/platform.js"
import { SecretStore } from "../production/secret-store.js"
export * from "./device.js"

interface LegacyToken { accessToken?: string; createdAt?: number }
interface AuthFile { providers?: Record<string, { createdAt: number }>; tokens?: Record<string, LegacyToken> }
function authPath(): string { return join(configDir(), "auth.json") }
function readAuth(): AuthFile { if (!existsSync(authPath())) return { providers: {} }; try { return JSON.parse(readFileSync(authPath(), "utf8")) as AuthFile } catch { return { providers: {} } } }
function writeAuth(data: AuthFile): void {
  const file = authPath(); mkdirSync(dirname(file), { recursive: true })
  const temporary = file + ".tmp"
  writeFileSync(temporary, JSON.stringify({ providers: data.providers ?? {} }, null, 2), { encoding: "utf8", mode: 0o600 })
  renameSync(temporary, file)
  try { chmodSync(file, 0o600) } catch { /* Windows */ }
}
function secretKey(provider: string): string { return `auth:${provider}` }

export class AuthManager {
  private readonly secrets = new SecretStore()
  private migrate(provider: string, auth = readAuth()): string | undefined {
    const stored = this.secrets.get(secretKey(provider))
    if (stored) return stored
    const legacy = auth.tokens?.[provider]?.accessToken
    if (!legacy) return undefined
    this.secrets.set(secretKey(provider), legacy)
    auth.providers ??= {}
    auth.providers[provider] = { createdAt: auth.tokens?.[provider]?.createdAt ?? Date.now() }
    if (auth.tokens) delete auth.tokens[provider]
    writeAuth(auth)
    return legacy
  }
  has(provider: string): boolean { return Boolean(this.migrate(provider)) }
  token(provider: string): string | undefined { return this.migrate(provider) }
  list(): string[] {
    const auth = readAuth()
    const names = new Set([...Object.keys(auth.providers ?? {}), ...Object.keys(auth.tokens ?? {})])
    return [...names].filter((provider) => Boolean(this.migrate(provider, auth))).sort()
  }
  save(provider: string, accessToken: string): void {
    this.secrets.set(secretKey(provider), accessToken)
    const auth = readAuth(); auth.providers ??= {}; auth.providers[provider] = { createdAt: Date.now() }; if (auth.tokens) delete auth.tokens[provider]; writeAuth(auth)
    saveProviderKey(provider, accessToken)
  }
  logout(provider: string): boolean {
    const auth = readAuth()
    const removedAuthSecret = this.secrets.delete(secretKey(provider))
    const removedProviderSecret = this.secrets.delete(`provider:${provider}`)
    const existed = removedAuthSecret || removedProviderSecret || Boolean(auth.providers?.[provider]) || Boolean(auth.tokens?.[provider])
    if (auth.providers) delete auth.providers[provider]
    if (auth.tokens) delete auth.tokens[provider]
    writeAuth(auth)
    return existed
  }
  configFor(provider: string, custom?: DeviceFlowConfig): DeviceFlowConfig | undefined { return custom ?? DEVICE_FLOW_PRESETS[provider] }
  async login(provider: string, onPrompt: (info: DeviceCodeResponse) => void, custom?: DeviceFlowConfig): Promise<void> {
    const config = this.configFor(provider, custom)
    if (!config) throw new Error(`No device-flow config for "${provider}". Known: ${Object.keys(DEVICE_FLOW_PRESETS).join(", ") || "(none)"}.`)
    this.save(provider, await runDeviceFlow(config, onPrompt))
  }
}
