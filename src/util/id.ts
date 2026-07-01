import { randomBytes } from "node:crypto"

/** Generate a short, sortable, unique identifier. */
export function generateId(prefix?: string): string {
  const time = Date.now().toString(36)
  const rand = randomBytes(4).toString("hex")
  const id = `${time}-${rand}`
  return prefix ? `${prefix}_${id}` : id
}

/** Slugify a string for use in file paths. */
export function slugify(input: string, maxLength = 50): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
}
