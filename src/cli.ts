#!/usr/bin/env node
/**
 * Spectra CLI entry point.
 *
 * Usage:
 *   spectra                 Launch the interactive TUI
 *   spectra run "<prompt>"  One-shot execution
 *   spectra spec "<desc>"   Generate a spec
 *   spectra run-spec <id>   Execute a spec's tasks
 *   spectra serve           Start the HTTP API server
 *   spectra models          List configured providers and models
 *   spectra agent [list]    List agents
 *   spectra init            Initialize .spectra in the project
 *   spectra --help          Show help
 */

import { stdout } from "node:process"
import * as readline from "node:readline/promises"
import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"

import { createRuntime, connectIntegrations } from "./runtime.js"
import { createServer } from "./server/index.js"
import { Repl } from "./tui/repl.js"
import { TuiApp } from "./tui/app.js"
import { Screen } from "./tui/screen.js"
import { runSpecWorkflow, runSpecExecution } from "./workflow/spec-workflow.js"
import { color, BRAND, logger } from "./util/logger.js"
import type { LoopHandlers } from "./session/loop.js"

/** Non-interactive handlers for one-shot/headless commands. */
function consoleHandlers(): LoopHandlers {
  return {
    onText: (text) => stdout.write("\n" + text + "\n"),
    onToolStart: (name, args) => {
      const detail =
        name === "bash" ? String(args["command"] ?? "") : String(args["path"] ?? args["pattern"] ?? "")
      stdout.write(color.gray(`  ⚙ ${name} ${color.dim(detail)}\n`))
    },
    onToolEnd: (name, success, output) => {
      const mark = success ? color.green("✓") : color.red("✗")
      stdout.write(color.gray(`  ${mark} ${name}: ${output.split("\n")[0]?.slice(0, 100) ?? ""}\n`))
    },
    report: (message) => stdout.write(color.gray(`  ${message}\n`)),
    // In headless mode, auto-deny anything that needs approval for safety.
    requestApproval: async () => false,
  }
}

/**
 * Handlers for interactive one-shot commands (e.g. `spectra fix`): stream output
 * and prompt the user on the terminal (y/N) for any action that needs approval
 * (privileged/destructive shell commands, writes outside the project).
 */
function interactiveHandlers(): LoopHandlers {
  return {
    onText: (text) => stdout.write("\n" + text + "\n"),
    onToolStart: (name, args) => {
      const detail =
        name === "bash" ? String(args["command"] ?? "") : String(args["path"] ?? args["pattern"] ?? "")
      stdout.write(color.gray(`  ⚙ ${name} ${color.dim(detail)}\n`))
    },
    onToolEnd: (name, success, output) => {
      const mark = success ? color.green("✓") : color.red("✗")
      stdout.write(color.gray(`  ${mark} ${name}: ${output.split("\n")[0]?.slice(0, 100) ?? ""}\n`))
    },
    report: (message) => stdout.write(color.gray(`  ${message}\n`)),
    requestApproval: async (_tool, detail) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      try {
        const answer = await rl.question(color.yellow(`  ⚠ Allow: ${detail}? [y/N] `))
        return /^y(es)?$/i.test(answer.trim())
      } finally {
        rl.close()
      }
    },
  }
}

function printHelp(): void {
  stdout.write(`${BRAND} ${color.gray("— the spec-driven AI coding agent")}\n\n`)
  const lines: [string, string][] = [
    ["spectra", "Launch the interactive TUI (resumes your last session)"],
    ["spectra --new", "Launch the TUI with a fresh session"],
    ['spectra ops "<problem>"', "Fix this computer: audio, wifi, drivers, services (alias: fix)"],
    ['spectra run "<prompt>"', "Run a single prompt non-interactively"],
    ['spectra spec "<desc>"', "Generate a spec (requirements, design, tasks)"],
    ["spectra run-spec <id>", "Execute a generated spec's tasks"],
    ["spectra serve", "Start the HTTP API + web UI server"],
    ["spectra acp", "Run as an ACP agent for editors (Zed, etc.) over stdio"],
    ["spectra web", "Start the graphical web interface"],
    ["spectra desktop", "Launch the native desktop app"],
    ["spectra models", "List configured providers and models"],
    ["spectra eval", "Run the capability eval scorecard"],
    ["spectra bench", "Run the agent task benchmark (needs a model)"],
    ["spectra auth login <p>", "Log in to a subscription provider (device flow)"],
    ["spectra freebuff", "Start the Freebuff proxy (free models, no login)"],
    ["spectra agent", "List available agents"],
    ["spectra init", "Initialize .spectra in this project"],
  ["spectra core <status|start|stop|restart>", "Control the persistent project Core daemon"],
    ["spectra doctor", "Check your environment & config (Node, git, model, keys)"],
    ["spectra update", "Update Spectra to the latest version and rebuild"],
    ["spectra completion <shell>", "Print a shell completion script (bash/zsh/fish/pwsh)"],
    ["spectra --help", "Show this help"],
    ["spectra --version", "Show version"],
  ]
  for (const [cmd, desc] of lines) {
    stdout.write(`  ${color.cyan(cmd.padEnd(24))} ${color.gray(desc)}\n`)
  }
  stdout.write(color.gray("\nDocs: https://spectra.dev/docs\n"))
}

async function cmdInit(projectRoot: string): Promise<void> {
  const dirs = [".spectra", ".spectra/steering", ".spectra/hooks", ".spectra/agents", ".spectra/specs"]
  for (const d of dirs) mkdirSync(join(projectRoot, d), { recursive: true })

  const configPath = join(projectRoot, "spectra.jsonc")
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      `{
  // Spectra configuration. Docs: https://spectra.dev/docs/config
  // Default: a free model that works with NO API key. Change "model" to a
  // paid/local provider (e.g. "anthropic/claude-...", "openai/gpt-...",
  // "ollama/llama3") and add its key under "provider" when you want more power.
  "model": "free/deepseek-v4-flash-free",
  "small_model": "free/mimo-v2.5-free",
  "permission": {
    "edit": "allow",
    "bash": { "*": "allow", "rm -rf *": "deny" }
  }
}
`,
    )
    stdout.write(color.green(`  Created spectra.jsonc\n`))
  }

  const steeringPath = join(projectRoot, ".spectra/steering/defaults.md")
  if (!existsSync(steeringPath)) {
    writeFileSync(
      steeringPath,
      `---
inclusion: always
---

# Project Standards

- Describe your coding conventions here.
- Spectra includes this context in every interaction.
`,
    )
  }

  stdout.write(color.green(`  Initialized .spectra/ in ${projectRoot}\n`))
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  let command: string | undefined = argv[0]

  if (command === "--help" || command === "-h") {
    printHelp()
    return
  }
  if (command === "--version" || command === "-v") {
    stdout.write("spectra v1.0.0\n")
    return
  }
  // `spectra --new` / `-n` launches the default interactive UI with a fresh
  // session (the flag is still read from argv inside the default case).
  if (command === "--new" || command === "-n") command = undefined


  // Desktop owns a persistent Core process. Handle these commands before
  // constructing a second in-process runtime in the launcher process.
  if (command === "core-daemon") {
    const { runCoreDaemonCli } = await import("./core/daemon.js")
    await runCoreDaemonCli(argv.slice(1))
    return
  }
  if (command === "core") {
    const { runCoreCommand } = await import("./core/supervisor.js")
    await runCoreCommand(argv.slice(1), process.cwd())
    return
  }
  if (command === "desktop") {
    const { launchDesktop } = await import("./desktop/launcher.js")
    await launchDesktop(undefined, process.cwd())
    return
  }

  const rt = createRuntime()
  // Connect MCP servers (if any) and register their tools. No-op when none
  // are configured; best-effort so a bad server never blocks startup.
  await connectIntegrations(rt)

  switch (command) {
    case undefined: {
      // Full-screen TUI when attached to a terminal; line-mode REPL otherwise
      // (pipes, CI, non-TTY environments) so scripting and tests still work.
      const fresh = argv.includes("--new") || argv.includes("-n")
      if (Screen.isInteractive()) {
        const app = new TuiApp(rt)
        await app.run({ fresh })
      } else {
        const repl = new Repl(rt)
        await repl.start({ fresh })
      }
      break
    }

    case "ops":
    case "fix": {
      // System troubleshooter. With a description → one-shot diagnosis that
      // streams output and prompts (y/N) before any privileged/destructive
      // step. Without a description → interactive TUI with ops preselected.
      rt.agents.setCurrent("ops")
      const ops = rt.agents.get("ops") ?? rt.agents.current_()
      const desc = argv.slice(1).join(" ").trim()
      if (desc) {
        stdout.write(`${BRAND} ${color.gray("ops mode — diagnosing your system…")}\n`)
        const session = rt.sessions.create(ops.id, ops.model ?? rt.config.config.model)
        await rt.loop.run({ sessionId: session.id, agent: ops, userMessage: desc, handlers: interactiveHandlers() })
      } else if (Screen.isInteractive()) {
        const app = new TuiApp(rt)
        await app.run({ fresh: true })
      } else {
        const repl = new Repl(rt)
        await repl.start({ fresh: true })
      }
      break
    }

    case "run": {
      let args = argv.slice(1)
      let agentId: string | undefined
      if (args[0] === "--agent" && args[1]) {
        agentId = args[1]
        args = args.slice(2)
      }
      const prompt = args.join(" ")
      if (!prompt) {
        logger.error('Usage: spectra run [--agent <id>] "<prompt>"')
        process.exitCode = 1
        return
      }
      const agent = (agentId && rt.agents.get(agentId)) || rt.agents.current_()
      const session = rt.sessions.create(agent.id, agent.model ?? rt.config.config.model)
      await rt.loop.run({
        sessionId: session.id,
        agent,
        userMessage: prompt,
        handlers: consoleHandlers(),
      })
      break
    }

    case "spec": {
      const desc = argv.slice(1).join(" ")
      if (!desc) {
        logger.error('Usage: spectra spec "<description>"')
        process.exitCode = 1
        return
      }
      await runSpecWorkflow(rt, desc, consoleHandlers())
      break
    }

    case "run-spec": {
      const id = argv[1]
      if (!id) {
        logger.error("Usage: spectra run-spec <spec-id>")
        process.exitCode = 1
        return
      }
      await runSpecExecution(rt, id, consoleHandlers())
      break
    }

    case "acp": {
      const { runAcpServer } = await import("./acp/index.js")
      await runAcpServer(rt)
      break
    }

    case "serve":
    case "web": {
      const envPort = process.env["SPECTRA_PORT"] ? Number(process.env["SPECTRA_PORT"]) : undefined
      const envHost = process.env["SPECTRA_HOST"] // e.g. 0.0.0.0 in Docker/LAN
      const serverConfig = {
        ...rt.config.config.server,
        ...(envPort ? { port: envPort } : {}),
        ...(envHost ? { hostname: envHost } : {}),
      }
      const server = createServer(rt, serverConfig)
      await server.listen()
      const { hostname, port } = serverConfig
      const url = `http://${hostname}:${port}`
      if (command === "web") {
        stdout.write(`${BRAND} web UI at ${color.cyan(url)}\n`)
        stdout.write(color.gray("Open it in your browser. Press Ctrl-C to stop.\n"))
      } else {
        stdout.write(`${BRAND} API server at ${color.cyan(url)}\n`)
        stdout.write(color.gray("Web UI also available at the same URL. Press Ctrl-C to stop.\n"))
      }
      break
    }

    case "models": {
      stdout.write(`${BRAND} ${color.gray("available models")}\n\n`)
      for (const p of rt.providers.list()) {
        stdout.write(color.bold(`  ${p.name} (${p.id})\n`))
        if (p.models.length === 0) {
          stdout.write(color.gray(`    use: ${p.id}/<model-id>\n`))
        }
        for (const m of p.models) {
          stdout.write(color.gray(`    ${p.id}/${m.id}  ${color.dim(m.name)}\n`))
        }
      }
      break
    }

    case "agent": {
      stdout.write(`${BRAND} ${color.gray("agents")}\n\n`)
      for (const a of rt.agents.all()) {
        const mode = a.mode === "primary" ? color.green("primary") : color.blue("subagent")
        stdout.write(`  ${color.bold(a.id.padEnd(10))} ${mode}  ${color.gray(a.description)}\n`)
      }
      break
    }

    case "auth": {
      const { AuthManager } = await import("./auth/index.js")
      const auth = new AuthManager()
      const sub = argv[1]
      if (sub === "list") {
        const provs = auth.list()
        stdout.write(`${BRAND} ${color.gray("logged-in providers")}\n\n`)
        stdout.write(provs.length ? provs.map((p) => `  ${color.green("●")} ${p}`).join("\n") + "\n" : color.gray("  (none)\n"))
        break
      }
      if (sub === "logout") {
        const provider = argv[2]
        if (!provider) { logger.error("Usage: spectra auth logout <provider>"); process.exitCode = 1; break }
        stdout.write(auth.logout(provider) ? `Logged out of ${provider}.\n` : `No token stored for ${provider}.\n`)
        break
      }
      if (sub === "login") {
        const provider = argv[2]
        if (!provider) { logger.error("Usage: spectra auth login <provider>  (e.g. copilot)"); process.exitCode = 1; break }
        try {
          await auth.login(provider, (info) => {
            stdout.write(`\n${BRAND} ${color.gray("device login")}\n`)
            stdout.write(`  1. Open ${color.cyan(info.verification_uri)}\n`)
            stdout.write(`  2. Enter the code: ${color.bold(info.user_code)}\n`)
            stdout.write(color.gray(`  Waiting for approval…\n`))
          })
          stdout.write(color.green(`\n✓ Logged in to ${provider}. Token saved.\n`))
        } catch (err) {
          logger.error((err as Error).message)
          process.exitCode = 1
        }
        break
      }
      stdout.write(color.gray("Usage: spectra auth <login|logout|list> [provider]\n"))
      break
    }

    case "bench": {
      const { runBenchmark } = await import("./bench/index.js")
      stdout.write(`${BRAND} ${color.gray("agent task benchmark")}\n\n`)
      const report = await runBenchmark(rt)
      for (const r of report.results) {
        const mark = r.pass ? color.green("✓") : color.red("✗")
        stdout.write(`  ${mark} ${r.name.padEnd(20)} ${color.gray(`${r.steps} steps · ${Math.round(r.durationMs / 1000)}s · ${r.detail}`)}\n`)
      }
      stdout.write(
        `\n  ${color.bold(`${report.passed}/${report.total} tasks passed`)} · success rate ${Math.round(report.successRate * 100)}% · ${Math.round(report.totalDurationMs / 1000)}s total\n`,
      )
      if (report.passed < report.total) process.exitCode = 1
      break
    }

    case "eval": {
      const { runProjectEvals } = await import("./eval/index.js")
      stdout.write(`${BRAND} ${color.gray("capability eval scorecard")}\n\n`)
      const report = await runProjectEvals(rt.config.projectRoot)
      for (const r of report.results) {
        const mark = r.pass ? color.green("✓") : color.red("✗")
        stdout.write(`  ${mark} ${r.name.padEnd(32)} ${color.gray(`${Math.round(r.score * 100)}%  ${r.detail}`)}\n`)
      }
      stdout.write(
        `\n  ${color.bold(`${report.passed}/${report.total} passed`)} · avg score ${Math.round(report.averageScore * 100)}%\n`,
      )
      if (report.passed < report.total) process.exitCode = 1
      break
    }

    case "freebuff": {
      const sub = argv[1]
      const { startFreebuffProxy, stopFreebuffProxy } = await import("./provider/freebuff-proxy.js")
      if (sub === "stop") {
        await stopFreebuffProxy()
        stdout.write("Freebuff proxy stopped.\n")
        break
      }
      stdout.write(`${BRAND} ${color.gray("starting Freebuff free-model proxy…")}\n`)
      const result = await startFreebuffProxy((line) => stdout.write(color.gray(`  ${line}\n`)))
      if (result.ok) {
        stdout.write(color.green(`\n✓ ${result.message}\n`))
        stdout.write(color.gray(`  Tip: set "model": "freebuff/deepseek-v4-pro" or pick one with /models.\n`))
      } else {
        stdout.write(color.yellow(`\n${result.message}\n`))
        process.exitCode = 1
      }
      break
    }

    case "init": {
      await cmdInit(rt.config.projectRoot)
      break
    }

    case "doctor": {
      const { runDoctor } = await import("./cli/doctor.js")
      process.exitCode = runDoctor(rt)
      break
    }

    case "update": {
      const { runUpdate } = await import("./cli/update.js")
      process.exitCode = await runUpdate(argv.slice(1))
      break
    }

    case "completion": {
      const { completionScript } = await import("./cli/completion.js")
      const script = completionScript(argv[1] ?? "")
      if (!script) {
        logger.error("Usage: spectra completion <bash|zsh|fish|powershell>")
        process.exitCode = 1
      } else {
        stdout.write(script)
      }
      break
    }

    case "desktop": {
      const { launchDesktop } = await import("./desktop/launcher.js")
      await launchDesktop(rt, rt.config.projectRoot)
      break
    }

    default: {
      logger.error(`Unknown command: ${command}`)
      printHelp()
      process.exitCode = 1
    }
  }
}

main().catch((err) => {
  logger.error((err as Error).message)
  if (process.env["SPECTRA_LOG_LEVEL"] === "debug") {
    console.error(err)
  }
  process.exitCode = 1
})
