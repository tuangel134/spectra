/**
 * Cross-platform primitives.
 *
 * Spectra runs on Linux, macOS and Windows 10/11. The rest of the codebase must
 * never hardcode a POSIX shell, a process-group kill, or an XDG path — it goes
 * through the helpers here so the same logic works on every OS.
 */

import { platform, homedir } from "node:os"
import { join } from "node:path"
import { spawnSync, type ChildProcess } from "node:child_process"

export const IS_WINDOWS = platform() === "win32"
export const IS_MAC = platform() === "darwin"

/**
 * The shell + argv used to run a full command STRING on this OS.
 *
 * - POSIX: honours $SHELL (falling back to /bin/bash) with `-c`, preserving the
 *   previous behaviour exactly so existing Linux/macOS semantics are unchanged.
 * - Windows: uses %ComSpec% (cmd.exe) with `/d /s /c`, the standard way to run a
 *   command line non-interactively.
 */
export function shellFor(command: string): { file: string; args: string[] } {
  if (IS_WINDOWS) {
    const shell = process.env["ComSpec"] || "cmd.exe"
    return { file: shell, args: ["/d", "/s", "/c", command] }
  }
  const shell = process.env["SHELL"] || "/bin/bash"
  return { file: shell, args: ["-c", command] }
}

/**
 * Extra spawn options so a timeout can later kill the WHOLE process tree.
 *
 * On POSIX we start the child in its own process group (`detached`) so a
 * negative-PID signal reaches every grandchild. On Windows there is no process
 * group to detach into for this purpose — killing the tree is done with
 * `taskkill /t` in `killTree`, so we must NOT set `detached` (it would spawn a
 * separate console window).
 */
export function detachForGroupKill(): { detached?: boolean } {
  return IS_WINDOWS ? {} : { detached: true }
}

/**
 * Kill a spawned child AND all of its descendants, cross-platform.
 *
 * - Windows: `taskkill /pid <pid> /t /f` terminates the whole tree.
 * - POSIX: signal the negative PID (the process group created by `detached`),
 *   falling back to a direct kill if that is not possible.
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals = "SIGKILL"): void {
  const pid = child.pid
  if (pid === undefined) {
    try { child.kill(signal) } catch { /* already gone */ }
    return
  }
  if (IS_WINDOWS) {
    try {
      spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" })
    } catch {
      try { child.kill() } catch { /* already gone */ }
    }
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    try { child.kill(signal) } catch { /* already gone */ }
  }
}

/**
 * The Spectra config/data directory for the current OS.
 *
 * - Windows: %APPDATA%\spectra  (roaming app data — the idiomatic location).
 * - POSIX: $XDG_CONFIG_HOME/spectra, else ~/.config/spectra.
 *
 * On Linux with XDG unset this is exactly ~/.config/spectra, so existing users'
 * config is found unchanged.
 */
export function configDirFor(app: string): string {
  if (IS_WINDOWS) {
    const appData = process.env["APPDATA"]
    return appData ? join(appData, app) : join(homedir(), "AppData", "Roaming", app)
  }
  const xdg = process.env["XDG_CONFIG_HOME"]
  return xdg ? join(xdg, app) : join(homedir(), ".config", app)
}

/** Spectra's own config directory. */
export function configDir(): string {
  return configDirFor("spectra")
}

/** True if `ref` is an absolute path on this OS (POSIX `/…` or Windows `C:\…`). */
export function isAbsolutePath(ref: string): boolean {
  if (ref.startsWith("/")) return true
  // Windows drive-absolute (C:\ or C:/) or UNC (\\server\share).
  return IS_WINDOWS && (/^[A-Za-z]:[\\/]/.test(ref) || ref.startsWith("\\\\"))
}
