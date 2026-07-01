/**
 * Spectra — the spec-driven AI coding agent.
 *
 * Public API surface for embedding Spectra in other tools.
 */

export * from "./config/index.js"
export * from "./provider/index.js"
export * from "./agent/index.js"
export * from "./tool/index.js"
export * from "./session/index.js"
export * from "./spec/index.js"
export * from "./hook/index.js"
export * from "./permission/index.js"
export { createServer, type ServerOptions } from "./server/index.js"
export { createRuntime, type Runtime } from "./runtime.js"
export { color, logger, setLogLevel, BRAND } from "./util/logger.js"
