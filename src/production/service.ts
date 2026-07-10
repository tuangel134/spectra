import { accessSync, constants as FS, mkdirSync } from "node:fs"
import { configDir } from "../util/platform.js"
import { CrashRecoveryJournal } from "./crash-recovery.js"
import { SecretStore } from "./secret-store.js"
import type { ProductionCheck, ProductionStatus, UpdateChannel } from "./types.js"

export class ProductionService {
  constructor(readonly projectRoot: string, readonly version = "1.0.0", readonly channel: UpdateChannel = "stable") {}
  status(): ProductionStatus {
    const checks: ProductionCheck[] = []
    const add = (id: string, status: ProductionCheck["status"], detail: string): void => { checks.push({ id, status, detail }) }
    const nodeMajor = Number(process.versions.node.split(".")[0])
    add("node", nodeMajor >= 20 ? "ok" : "fail", `Node ${process.versions.node}`)
    try { mkdirSync(configDir(), { recursive: true }); accessSync(configDir(), FS.W_OK); add("config", "ok", "Config directory is writable") } catch { add("config", "fail", "Config directory is not writable") }
    const secrets = new SecretStore().status()
    add("secrets", secrets.secure ? "ok" : "warn", secrets.secure ? secrets.name : `${secrets.name}; install an OS keychain service for stronger protection`)
    const journal = new CrashRecoveryJournal(this.projectRoot, this.version)
    const interrupted = journal.interrupted()
    add("recovery", interrupted ? "warn" : "ok", interrupted ? "An interrupted Core session can be reviewed" : "No interrupted Core session")
    return { version: this.version, channel: this.channel, platform: process.platform, arch: process.arch, node: process.versions.node, secretBackend: secrets, recovery: { interrupted: Boolean(interrupted), record: interrupted }, checks }
  }
  recovery(): CrashRecoveryJournal { return new CrashRecoveryJournal(this.projectRoot, this.version) }
}
