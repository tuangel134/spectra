/** Production updater: transactional for git installs, signed-manifest based for packaged installs. */
import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { stdout } from "node:process"
import { color, BRAND } from "../util/logger.js"
import { checkForUpdate, downloadVerifiedArtifact, readUpdatePublicKey } from "../production/updater.js"

export function installRoot(): string { return join(dirname(fileURLToPath(import.meta.url)), "..", "..") }

interface CommandResult { ok: boolean; output: string }
function run(root: string, command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true })
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` }
}

function gitHead(root: string, ref = "HEAD"): string | undefined {
  const result = run(root, "git", ["rev-parse", ref])
  return result.ok ? result.output.trim() : undefined
}

function transactionalGitUpdate(root: string, checkOnly: boolean): number {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"
  const status = run(root, "git", ["status", "--porcelain"])
  if (!status.ok) { stdout.write(color.red("Unable to inspect the Spectra install.\n")); return 1 }
  if (status.output.trim()) { stdout.write(color.yellow("Spectra has local changes; update refused to avoid losing them.\n")); return 1 }
  const before = gitHead(root)
  if (!before) return 1
  stdout.write(`${BRAND} ${color.gray("checking origin/main…")}\n`)
  const fetch = run(root, "git", ["fetch", "--prune", "origin", "main"])
  if (!fetch.ok) { stdout.write(color.red(fetch.output.trim() + "\n")); return 1 }
  const next = gitHead(root, "origin/main")
  if (!next) return 1
  if (next === before) { stdout.write(color.green("✓ Already on the latest version.\n")); return 0 }
  stdout.write(color.gray(`Update available: ${before.slice(0, 8)} → ${next.slice(0, 8)}\n`))
  if (checkOnly) return 0
  const reset = run(root, "git", ["reset", "--hard", next])
  if (!reset.ok) return 1
  const steps: [string, string[]][] = [[npmCommand, ["ci"]], [npmCommand, ["run", "build"]], [npmCommand, ["run", "typecheck", "--if-present"]], [npmCommand, ["test"]]]
  for (const [command, args] of steps) {
    const result = run(root, command, args)
    stdout.write(color.gray(result.output))
    if (result.ok) continue
    stdout.write(color.red("Update validation failed; restoring the previous version.\n"))
    run(root, "git", ["reset", "--hard", before])
    run(root, npmCommand, ["ci"])
    run(root, npmCommand, ["run", "build"])
    return 1
  }
  stdout.write(color.green("\n✓ Spectra updated and validated. Restart running sessions.\n"))
  return 0
}

async function launchInstaller(file: string): Promise<void> {
  if (process.platform === "win32") {
    const isMsi = file.toLowerCase().endsWith(".msi")
    spawn(isMsi ? "msiexec.exe" : file, isMsi ? ["/i", file] : [], { detached: true, stdio: "ignore", windowsHide: true }).unref()
    return
  }
  if (process.platform === "darwin") {
    spawn("open", [file], { detached: true, stdio: "ignore" }).unref()
    return
  }
  if (file.endsWith(".AppImage")) await chmod(file, 0o755)
}

async function packagedUpdate(root: string, checkOnly: boolean): Promise<number> {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version?: string }
  const current = packageJson.version ?? "0.0.0"
  const publicKey = readUpdatePublicKey(root)
  const manifestUrl = process.env["SPECTRA_UPDATE_MANIFEST"]
  const check = await checkForUpdate(current, publicKey, manifestUrl)
  if (!check.available) { stdout.write(color.green(`✓ Spectra ${current} is current.\n`)); return 0 }
  stdout.write(`${BRAND} ${color.gray(`version ${check.latestVersion} is available`)}\n`)
  if (checkOnly) return 0
  if (!check.artifact) { stdout.write(color.red("No compatible release artifact was found.\n")); return 1 }
  const file = await downloadVerifiedArtifact(check.artifact)
  await launchInstaller(file)
  stdout.write(color.green(`✓ Verified update downloaded to ${file}\n`))
  if (process.platform === "linux") stdout.write(color.gray("Run the downloaded installer/package, then restart Spectra.\n"))
  return 0
}

export async function runUpdate(args: string[] = []): Promise<number> {
  const root = installRoot()
  const checkOnly = args.includes("--check")
  try {
    return existsSync(join(root, ".git")) ? transactionalGitUpdate(root, checkOnly) : await packagedUpdate(root, checkOnly)
  } catch (error) {
    stdout.write(color.red(`Update failed: ${(error as Error).message}\n`))
    return 1
  }
}
