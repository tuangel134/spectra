/**
 * Headroom — orchestrator + reversible original store (CCR).
 *
 * `compress()` is the single entry point used by the agent loop on every tool
 * result before it enters the conversation. It detects the content type, routes
 * to the right compressor, and — when compression wins and reversibility is on —
 * caches the original locally so the model can recover it through the
 * `headroom_retrieve` tool.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { join } from "node:path"

import { estimateTokens } from "../session/compaction.js"
import { generateId } from "../util/id.js"
import { detectContentType } from "./detect.js"
import { compressJson } from "./json.js"
import { compressLogs } from "./logs.js"
import {
  type CompressionResult,
  type ContentType,
  type HeadroomOptions,
  DEFAULT_HEADROOM_OPTIONS,
} from "./types.js"

export * from "./types.js"
export { detectContentType } from "./detect.js"
export { compressJson } from "./json.js"
export { compressLogs } from "./logs.js"

/** Light, lossless prose tidy: trim trailing space, collapse blank-line runs. */
function compressText(text: string): { text: string; changed: boolean } {
  const tidied = text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
  return { text: tidied, changed: tidied.length < text.length }
}

export interface HeadroomStats {
  payloads: number
  compressedPayloads: number
  originalTokens: number
  compressedTokens: number
  stored: number
}

export class Headroom {
  private readonly opts: HeadroomOptions
  /** Insertion-ordered map doubling as an LRU for CCR originals (fast path). */
  private readonly store = new Map<string, string>()
  /** Durable backing directory for originals, when a project root is given. */
  private readonly diskDir?: string
  private stats: HeadroomStats = {
    payloads: 0,
    compressedPayloads: 0,
    originalTokens: 0,
    compressedTokens: 0,
    stored: 0,
  }

  /**
   * @param options  compression settings
   * @param projectRoot  when provided (and reversible), originals are also
   *   written to `<projectRoot>/.spectra/headroom/` so a memory eviction — or a
   *   process restart — never makes a compressed payload unrecoverable.
   */
  constructor(options: Partial<HeadroomOptions> = {}, projectRoot?: string) {
    this.opts = { ...DEFAULT_HEADROOM_OPTIONS, ...options }
    if (projectRoot) this.diskDir = join(projectRoot, ".spectra", "headroom")
  }

  get enabled(): boolean {
    return this.opts.enabled
  }

  /** Apply a settings patch live (used by the Config UI). */
  configure(patch: Partial<HeadroomOptions>): void {
    const wasPersist = this.opts.persist
    Object.assign(this.opts, patch)
    // Turning persistence off purges the on-disk originals immediately.
    if (wasPersist && this.opts.persist === false) this.clearDiskCache()
  }

  /** Compress a payload, returning the text to actually send to the model. */
  compress(input: string): CompressionResult {
    const originalTokens = estimateTokens(input)
    const passthrough = (type: ContentType): CompressionResult => ({
      text: input,
      compressed: false,
      type,
      originalTokens,
      compressedTokens: originalTokens,
    })

    if (!this.opts.enabled) return passthrough("text")

    const type = detectContentType(input)
    this.stats.payloads++

    // Skip small payloads — not worth the indirection.
    if (originalTokens < this.opts.minTokens) return passthrough(type)

    let compressed: { text: string; changed: boolean }
    switch (type) {
      case "json":
        compressed = compressJson(input)
        break
      case "logs":
        compressed = compressLogs(input)
        break
      case "code":
        // Conservative: code is mostly passthrough (protect active code).
        compressed = { text: input, changed: false }
        break
      default:
        compressed = compressText(input)
        break
    }

    if (!compressed.changed) return passthrough(type)

    const bodyTokens = estimateTokens(compressed.text)

    // Build the FINAL text we will actually send. In reversible mode that
    // includes a retrieval note — and the note costs tokens too. We must count
    // it toward the savings decision, otherwise a small body win can be erased
    // (or even reversed) by the note, inflating the payload past the original.
    let ref: string | undefined
    let text = compressed.text
    if (this.opts.reversible) {
      ref = generateId("hr")
      const pct = Math.max(0, Math.round((1 - bodyTokens / originalTokens) * 100))
      text =
        `${compressed.text}\n\n⟨headroom⟩ compressed ${type}: ${originalTokens}→${bodyTokens} tok (−${pct}%). ` +
        `Original cached as ref "${ref}"; call headroom_retrieve(ref="${ref}") for the full, uncompressed content.`
    }

    // Decide on the text that is actually sent (note included). This guarantees
    // Headroom can never make a payload larger than the original.
    const finalTokens = estimateTokens(text)
    if (finalTokens >= originalTokens * 0.9) return passthrough(type)

    // Commit: store the original (under the pre-generated ref) only now.
    if (ref) this.put(ref, input)

    this.stats.compressedPayloads++
    this.stats.originalTokens += originalTokens
    // Honest accounting: the recorded "after" size is what we really send.
    this.stats.compressedTokens += finalTokens

    return { text, compressed: true, type, originalTokens, compressedTokens: finalTokens, ref }
  }

  /** Store an original under a ref (memory LRU + optional durable disk copy). */
  private put(ref: string, content: string): void {
    this.store.set(ref, content)
    // Durable backing copy so memory eviction never loses the original — only
    // when persistence is enabled.
    if (this.diskDir && this.opts.persist) {
      try {
        mkdirSync(this.diskDir, { recursive: true })
        writeFileSync(join(this.diskDir, `${ref}.txt`), content, "utf-8")
        this.pruneDisk()
      } catch {
        /* best-effort: disk persistence is an enhancement, not a requirement */
      }
    }
    // Bound the in-memory cache; the disk copy (if any) remains the source of truth.
    while (this.store.size > this.opts.maxStored) {
      const oldest = this.store.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.store.delete(oldest)
    }
    this.stats.stored = this.store.size
  }

  /** Delete every persisted original from disk (used when persistence is off). */
  clearDiskCache(): void {
    if (!this.diskDir) return
    try {
      for (const f of readdirSync(this.diskDir)) {
        if (f.endsWith(".txt")) {
          try {
            unlinkSync(join(this.diskDir, f))
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* directory may not exist yet */
    }
  }

  /** Cap the on-disk original count, evicting the oldest by mtime. */
  private pruneDisk(): void {
    if (!this.diskDir) return
    const cap = Math.max(this.opts.maxStored * 8, 2000)
    let files: string[]
    try {
      files = readdirSync(this.diskDir).filter((f) => f.endsWith(".txt"))
    } catch {
      return
    }
    if (files.length <= cap) return
    const withTime = files
      .map((f) => {
        const full = join(this.diskDir!, f)
        let mtime = 0
        try {
          mtime = statSync(full).mtimeMs
        } catch {
          /* ignore */
        }
        return { full, mtime }
      })
      .sort((a, b) => a.mtime - b.mtime)
    for (const r of withTime.slice(0, withTime.length - cap)) {
      try {
        unlinkSync(r.full)
      } catch {
        /* ignore */
      }
    }
  }

  /** Retrieve a previously stored original (memory first, then disk). */
  retrieve(ref: string): string | undefined {
    const inMemory = this.store.get(ref)
    if (inMemory !== undefined) {
      // Refresh recency so the hot set stays in memory (true LRU).
      this.store.delete(ref)
      this.store.set(ref, inMemory)
      return inMemory
    }
    if (this.diskDir) {
      try {
        const path = join(this.diskDir, `${ref}.txt`)
        if (existsSync(path)) return readFileSync(path, "utf-8")
      } catch {
        /* ignore unreadable original */
      }
    }
    return undefined
  }

  /** Current cumulative stats. */
  getStats(): HeadroomStats {
    return { ...this.stats, stored: this.store.size }
  }
}
