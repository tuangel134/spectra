/**
 * Minimal colored logger for the terminal.
 * Avoids external dependencies by using ANSI escape codes directly.
 */

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const

const useColor = process.stdout.isTTY && process.env["NO_COLOR"] === undefined

function paint(color: keyof typeof COLORS, text: string): string {
  if (!useColor) return text
  return `${COLORS[color]}${text}${COLORS.reset}`
}

export const color = {
  bold: (t: string) => paint("bold", t),
  dim: (t: string) => paint("dim", t),
  red: (t: string) => paint("red", t),
  green: (t: string) => paint("green", t),
  yellow: (t: string) => paint("yellow", t),
  blue: (t: string) => paint("blue", t),
  magenta: (t: string) => paint("magenta", t),
  cyan: (t: string) => paint("cyan", t),
  gray: (t: string) => paint("gray", t),
}

export type LogLevel = "debug" | "info" | "warn" | "error"

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

let currentLevel: LogLevel = ((): LogLevel => {
  const env = process.env["SPECTRA_LOG_LEVEL"]
  // Ignore an unknown value instead of letting it disable ALL logging
  // (including errors), which would happen when LEVEL_ORDER[level] is undefined.
  return env && env in LEVEL_ORDER ? (env as LogLevel) : "info"
})()

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= (LEVEL_ORDER[currentLevel] ?? LEVEL_ORDER.info)
}

function ts(): string {
  return color.gray(new Date().toISOString().slice(11, 23))
}

export const logger = {
  debug(...args: unknown[]): void {
    if (shouldLog("debug")) console.error(ts(), color.gray("DBG"), ...args)
  },
  info(...args: unknown[]): void {
    if (shouldLog("info")) console.error(ts(), ...args)
  },
  warn(...args: unknown[]): void {
    if (shouldLog("warn")) console.error(ts(), color.yellow("WRN"), ...args)
  },
  error(...args: unknown[]): void {
    if (shouldLog("error")) console.error(ts(), color.red("ERR"), ...args)
  },
}

/** The Spectra brand mark for the CLI. */
export const BRAND = color.cyan("⚡ Spectra")
