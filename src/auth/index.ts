/**
 * Auth manager — subscription login via device flow + token storage.
 *
 * Tokens are stored in ~/.config/spectra/auth.json (chmod 600) and also written
 * into the provider config so the resolved model picks them up as an API key.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, renameSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"

import { runDeviceFlow, DEVICE_FLOW_PRESETS, type DeviceFlowConfig, type DeviceCodeResponse } from "./device.js"
import { saveProviderKey } from "../config/writer.js"

export * from "./device.js"

interface AuthFile {
  tokens: Record<string, { accessToken: string; createdAt: number }>
}

function authPath(): string {
  return join(homedir(), ".config", "spectra", "auth.json")
}

function readAuth(): AuthFile {
  const path = authPath()
  if (!existsSync(path)) return { tokens: {} }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as AuthFile
  } catch {
    return { tokens: {} }
  }
}

function writeAuth(data: AuthFile): void {
  const path = authPath()
  mkdirSync(dirname(path), { recursive: true })
  // Atomic write (temp + rename); create the temp file 0600 so the token is
  // never briefly world-readable, and a crash mid-write can't corrupt auth.json.
  const tmp = path + ".tmp"
  writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 })
  try {
    renameSync(tmp, path)
    chmodSync(path, 0o600)
  } catch {
    /* best-effort on platforms without chmod/rename semantics */
  }
}

export class AuthManager {
  /** Whether a token is stored for a provider. */
  has(provider: string): boolean {
    return !!readAuth().tokens[provider]
  }

  /** Retrieve a stored access token. */
  token(provider: string): string | undefined {
    return readAuth().tokens[provider]?.accessToken
  }

  /** List providers with a stored token. */
  list(): string[] {
    return Object.keys(readAuth().tokens)
  }

  /** Persist a token and mirror it into the provider config as an API key. */
  save(provider: string, accessToken: string): void {
    const auth = readAuth()
    auth.tokens[provider] = { accessToken, createdAt: Date.now() }
    writeAuth(auth)
    saveProviderKey(provider, accessToken)
  }

  /** Remove a stored token. */
  logout(provider: string): boolean {
    const auth = readAuth()
    if (!auth.tokens[provider]) return false
    delete auth.tokens[provider]
    writeAuth(auth)
    return true
  }

  /** Resolve the device-flow config for a provider (preset or custom). */
  configFor(provider: string, custom?: DeviceFlowConfig): DeviceFlowConfig | undefined {
    return custom ?? DEVICE_FLOW_PRESETS[provider]
  }

  /** Run the device-flow login for a provider and store the token. */
  async login(
    provider: string,
    onPrompt: (info: DeviceCodeResponse) => void,
    custom?: DeviceFlowConfig,
  ): Promise<void> {
    const config = this.configFor(provider, custom)
    if (!config) {
      throw new Error(
        `No device-flow config for "${provider}". Known: ${Object.keys(DEVICE_FLOW_PRESETS).join(", ") || "(none)"}.`,
      )
    }
    const token = await runDeviceFlow(config, onPrompt)
    this.save(provider, token)
  }
}
