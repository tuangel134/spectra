import { assertProtocolCompatible, type CoreHealth } from "./protocol.js"

export class CoreClient {
  readonly baseURL: string
  private token = ""

  constructor(hostname: string, port: number) {
    this.baseURL = `http://${hostname}:${port}`
  }

  async health(): Promise<CoreHealth> {
    const response = await fetch(`${this.baseURL}/health`, { signal: AbortSignal.timeout(2_500) })
    if (!response.ok) throw new Error(`Spectra Core health check failed: HTTP ${response.status}`)
    const health = await response.json() as CoreHealth
    assertProtocolCompatible(health.protocolVersion)
    if (typeof health.token === "string") this.token = health.token
    return health
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" })
  }

  async post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    if (!this.token) await this.health()
    const headers = new Headers(init.headers)
    if (this.token) headers.set("authorization", `Bearer ${this.token}`)
    const response = await fetch(`${this.baseURL}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(10_000),
    })
    const text = await response.text()
    let data: unknown = {}
    if (text) {
      try { data = JSON.parse(text) } catch { data = { error: text } }
    }
    if (!response.ok) {
      const error = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `HTTP ${response.status}`
      throw new Error(error)
    }
    return data as T
  }
}
