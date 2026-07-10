/**
 * `spectra update` — pull the latest code and rebuild in place.
 *
 * Works for git-based installs (the one-line installer clones the repo). Runs
 * `git pull` then `npm install` (which rebuilds via the prepare script) in the
 * install directory, cross-platform.
 */

import { stdout } from "node:process"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { color, BRAND } from "../util/logger.js"
import { shellFor } from "../util/platform.js"

/** The Spectra install root (two levels up from dist/cli/update.js). */
export function installRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..")
}

function runIn(root: string, command: string): { ok: boolean; out: string } {
  const { file, args } = shellFor(command)
  const r = spawnSync(file, args, { cwd: root, encoding: "utf-8" })
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? "") }
}

/** Update and rebuild. Returns a process exit code. */
export function runUpdate(): number {
  const root = installRoot()
  if (!existsSync(join(root, ".git"))) {
    stdout.write(
      color.yellow(
        "This isn't a git-based install, so 'spectra update' can't self-update.\n",
      ) +
        color.gray(
          "Re-run the installer to update:\n" +
            "  curl -fsSL https://raw.githubusercontent.com/tuangel134/spectra/main/install.sh | bash\n",
        ),
    )
    return 1
  }

  stdout.write(`${BRAND} ${color.gray(`updating in ${root}…`)}\n`)

  const pull = runIn(root, "git pull --ff-only")
  stdout.write(color.gray(pull.out.trim() + "\n"))
  if (!pull.ok) {
    stdout.write(color.red("git pull failed. Resolve the above and retry (local changes?).\n"))
    return 1
  }
  if (/Already up to date/i.test(pull.out)) {
    stdout.write(color.green("✓ Already on the latest version.\n"))
    return 0
  }

  stdout.write(color.gray("Rebuilding (npm install)…\n"))
  const build = runIn(root, "npm install")
  if (!build.ok) {
    stdout.write(color.red("Rebuild failed:\n") + color.gray(build.out.trim().slice(-1500) + "\n"))
    return 1
  }

  stdout.write(color.green("\n✓ Spectra updated. Restart any running session to use the new build.\n"))
  return 0
}
