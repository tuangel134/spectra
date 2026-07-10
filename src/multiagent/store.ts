import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { multiagentStateDir } from "./paths.js"
import type { MultiAgentRun } from "./types.js"

export class MultiAgentStore {
  readonly dir: string

  constructor(projectRoot: string) {
    this.dir = join(multiagentStateDir(projectRoot), "runs")
    mkdirSync(this.dir, { recursive: true })
  }

  save(run: MultiAgentRun): void {
    run.updatedAt = Date.now()
    const target = this.path(run.id)
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temp, JSON.stringify(run, null, 2), { mode: 0o600 })
    renameSync(temp, target)
  }

  load(id: string): MultiAgentRun | null {
    const path = this.path(id)
    if (!existsSync(path)) return null
    try { return JSON.parse(readFileSync(path, "utf-8")) as MultiAgentRun } catch { return null }
  }

  list(): MultiAgentRun[] {
    if (!existsSync(this.dir)) return []
    return (readdirSync(this.dir) as string[])
      .filter((name: string) => name.endsWith(".json"))
      .map((name: string) => this.load(name.slice(0, -5)))
      .filter((run: MultiAgentRun | null): run is MultiAgentRun => Boolean(run))
      .sort((a: MultiAgentRun, b: MultiAgentRun) => b.updatedAt - a.updatedAt)
  }

  path(id: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`Invalid multi-agent run id: ${id}`)
    return join(this.dir, `${id}.json`)
  }
}
