/**
 * Theme system.
 *
 * Spectra's identity is the "spectrum": a gradient accent bar that distinguishes
 * it from monochrome terminal agents. Themes define the accent palette used for
 * that bar, borders, and highlights.
 */

/** 24-bit foreground color escape. */
export function rgb(r: number, g: number, b: number, text: string): string {
  if (process.env["NO_COLOR"] !== undefined) return text
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`
}

/** 24-bit background color escape (with a foreground for contrast). */
export function bg(
  bgc: [number, number, number],
  fgc: [number, number, number],
  text: string,
): string {
  if (process.env["NO_COLOR"] !== undefined) return text
  return `\x1b[48;2;${bgc[0]};${bgc[1]};${bgc[2]}m\x1b[38;2;${fgc[0]};${fgc[1]};${fgc[2]}m${text}\x1b[0m`
}

export interface Theme {
  id: string
  name: string
  /** The spectrum gradient stops (RGB) used for the accent bar. */
  spectrum: [number, number, number][]
  /** Accent color for borders/labels. */
  accent: [number, number, number]
}

export const THEMES: Record<string, Theme> = {
  prism: {
    id: "prism",
    name: "Prism",
    spectrum: [
      [255, 89, 94], // red
      [255, 202, 58], // yellow
      [138, 201, 38], // green
      [25, 130, 196], // blue
      [106, 76, 147], // violet
    ],
    accent: [106, 176, 222],
  },
  aurora: {
    id: "aurora",
    name: "Aurora",
    spectrum: [
      [0, 201, 167],
      [0, 168, 204],
      [88, 120, 232],
      [148, 92, 222],
    ],
    accent: [0, 201, 167],
  },
  ember: {
    id: "ember",
    name: "Ember",
    spectrum: [
      [255, 94, 58],
      [255, 149, 0],
      [255, 204, 0],
    ],
    accent: [255, 149, 0],
  },
  mono: {
    id: "mono",
    name: "Mono",
    spectrum: [
      [120, 120, 120],
      [160, 160, 160],
      [200, 200, 200],
      [240, 240, 240],
    ],
    accent: [180, 180, 180],
  },
}

export const DEFAULT_THEME = "prism"

/** Render a horizontal spectrum bar of the given width using the theme stops. */
export function spectrumBar(theme: Theme, width: number, char = "─"): string {
  if (width <= 0) return ""
  const stops = theme.spectrum
  let out = ""
  for (let i = 0; i < width; i++) {
    const t = stops.length === 1 ? 0 : (i / (width - 1)) * (stops.length - 1)
    const lo = Math.floor(t)
    const hi = Math.min(stops.length - 1, lo + 1)
    const f = t - lo
    const a = stops[lo]!
    const b = stops[hi]!
    const r = Math.round(a[0] + (b[0] - a[0]) * f)
    const g = Math.round(a[1] + (b[1] - a[1]) * f)
    const bl = Math.round(a[2] + (b[2] - a[2]) * f)
    out += rgb(r, g, bl, char)
  }
  return out
}

/** Apply the theme accent color to text. */
export function accent(theme: Theme, text: string): string {
  return rgb(theme.accent[0], theme.accent[1], theme.accent[2], text)
}

/** Color a piece of text by its position along the spectrum (0..1). */
export function spectrumAt(theme: Theme, t: number, text: string): string {
  const stops = theme.spectrum
  const clamped = Math.max(0, Math.min(1, t))
  const pos = clamped * (stops.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.min(stops.length - 1, lo + 1)
  const f = pos - lo
  const a = stops[lo]!
  const b = stops[hi]!
  return rgb(
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
    text,
  )
}

export function getTheme(id: string | undefined): Theme {
  return THEMES[id ?? DEFAULT_THEME] ?? THEMES[DEFAULT_THEME]!
}

/** Darken an RGB color by a factor (0..1). */
export function darken(c: [number, number, number], factor: number): [number, number, number] {
  return [
    Math.round(c[0] * factor),
    Math.round(c[1] * factor),
    Math.round(c[2] * factor),
  ]
}
