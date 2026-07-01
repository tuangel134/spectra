/**
 * Headroom — context compression layer.
 *
 * Inspired by the open-source Headroom project (Apache-2.0), Spectra ships a
 * local-first, model-agnostic compression layer that shrinks the bulky tool
 * output, logs, and structured data that bloat every prompt — *before* they
 * reach the model. Compression is reversible (CCR): the original content is
 * cached locally and the model can pull it back on demand via the
 * `headroom_retrieve` tool.
 *
 * Unlike the upstream project this implementation is pure TypeScript with no
 * native or ML dependencies, so it works with any provider and any model.
 */

/** The kind of content a payload holds, used to pick a compressor. */
export type ContentType = "json" | "logs" | "code" | "text"

/** The result of attempting to compress a payload. */
export interface CompressionResult {
  /** The (possibly compressed) text to send to the model. */
  text: string
  /** Whether compression actually changed the content. */
  compressed: boolean
  /** Detected content type. */
  type: ContentType
  /** Estimated tokens in the original payload. */
  originalTokens: number
  /** Estimated tokens after compression. */
  compressedTokens: number
  /** Reference id for retrieving the original, if it was stored. */
  ref?: string
}

/** Options controlling the compression layer. */
export interface HeadroomOptions {
  /** Master switch. */
  enabled: boolean
  /** Payloads estimated below this many tokens are passed through untouched. */
  minTokens: number
  /** Store originals so the model can retrieve them (reversible / CCR). */
  reversible: boolean
  /** Max entries to keep in the in-memory original store (LRU-evicted). */
  maxStored: number
  /**
   * Persist cached originals to disk so they survive memory eviction and
   * process restarts. When off, originals live only in memory and any on-disk
   * cache is purged. User-toggleable.
   */
  persist: boolean
}

export const DEFAULT_HEADROOM_OPTIONS: HeadroomOptions = {
  enabled: true,
  minTokens: 200,
  reversible: true,
  maxStored: 256,
  persist: true,
}
