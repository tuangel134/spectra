/**
 * Freebuff proxy launcher.
 *
 * Freebuff's backend (codebuff.com) is proprietary and NOT OpenAI-compatible:
 * it uses a free-session/waiting-room flow, an agent-run lifecycle, and a custom
 * message format. Rather than re-implement that fragile, undocumented protocol
 * inside Spectra (which would break whenever Codebuff changes), we delegate to
 * the maintained, OpenAI-compatible community proxy `freebuff2api`.
 *
 * This module starts that proxy via Docker (the only zero-build option),
 * injecting the auto-detected Freebuff token, so `provider.freebuff` (pointing
 * at http://localhost:8080/v1) just works.
 */

import { spawn } from "node:child_process"

import { detectFreebuffToken } from "./freebuff.js"

const PROXY_IMAGE = "ghcr.io/quorinex/freebuff2api:latest"
const PROXY_PORT = 8080

export interface ProxyStartResult {
  ok: boolean
  message: string
  baseURL?: string
}

/** Check whether a command exists on PATH. */
function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, ["--version"], { stdio: "ignore" })
    child.on("error", () => resolve(false))
    child.on("close", (code) => resolve(code === 0))
  })
}

/**
 * Launch the freebuff2api proxy as a background container.
 * Returns guidance when Docker or the Freebuff token is missing.
 */
export async function startFreebuffProxy(
  onLog: (line: string) => void = () => {},
): Promise<ProxyStartResult> {
  const token = process.env["FREEBUFF_AUTH_TOKEN"] ?? detectFreebuffToken()
  if (!token) {
    return {
      ok: false,
      message:
        "No Freebuff token found. Run `npm i -g freebuff && freebuff` once " +
        "(it provisions an anonymous token, no login), then retry.",
    }
  }
  if (!(await commandExists("docker"))) {
    return {
      ok: false,
      message:
        "Docker is required to run the Freebuff proxy. Install Docker, or run the proxy manually:\n" +
        `  docker run -d -p ${PROXY_PORT}:${PROXY_PORT} -e AUTH_TOKENS="${token}" ${PROXY_IMAGE}\n` +
        "Then set provider.freebuff.baseURL to http://localhost:8080/v1.",
    }
  }

  return new Promise<ProxyStartResult>((resolve) => {
    const args = [
      "run", "-d", "--rm",
      "--name", "spectra-freebuff-proxy",
      "-p", `${PROXY_PORT}:${PROXY_PORT}`,
      "-e", `AUTH_TOKENS=${token}`,
      PROXY_IMAGE,
    ]
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (c: Buffer) => { out += c.toString(); onLog(c.toString().trim()) })
    child.stderr.on("data", (c: Buffer) => { out += c.toString(); onLog(c.toString().trim()) })
    child.on("error", (err) => resolve({ ok: false, message: `Failed to start proxy: ${err.message}` }))
    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          ok: true,
          message: `Freebuff proxy running on port ${PROXY_PORT}. Select a freebuff/* model to use it.`,
          baseURL: `http://localhost:${PROXY_PORT}/v1`,
        })
      } else if (/already in use|Conflict/i.test(out)) {
        resolve({ ok: true, message: "Freebuff proxy is already running.", baseURL: `http://localhost:${PROXY_PORT}/v1` })
      } else {
        resolve({ ok: false, message: `Proxy failed to start (exit ${code}): ${out.trim().slice(0, 300)}` })
      }
    })
  })
}

/** Stop the managed Freebuff proxy container. */
export function stopFreebuffProxy(): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["stop", "spectra-freebuff-proxy"], { stdio: "ignore" })
    child.on("error", () => resolve())
    child.on("close", () => resolve())
  })
}
