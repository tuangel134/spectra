/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628).
 *
 * Lets a user log in to a subscription provider from the terminal without
 * pasting an API key: Spectra shows a short code + URL, the user approves in a
 * browser, and Spectra polls for an access token. This is how OpenCode/Copilot
 * sign you in.
 */

export interface DeviceFlowConfig {
  /** Endpoint that issues device + user codes. */
  deviceCodeUrl: string
  /** Endpoint that exchanges the device code for a token. */
  tokenUrl: string
  /** OAuth client id for the application. */
  clientId: string
  /** Requested scopes. */
  scope?: string
}

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
}

export type TokenPoll =
  | { status: "pending"; intervalMs: number }
  | { status: "slow_down"; intervalMs: number }
  | { status: "success"; accessToken: string; tokenType?: string }
  | { status: "error"; error: string }

/**
 * Interpret a token-endpoint response body per RFC 8628 §3.5.
 * Pure and unit-testable.
 */
export function interpretTokenResponse(body: Record<string, unknown>, intervalMs: number): TokenPoll {
  if (typeof body["access_token"] === "string") {
    return {
      status: "success",
      accessToken: body["access_token"] as string,
      tokenType: typeof body["token_type"] === "string" ? (body["token_type"] as string) : undefined,
    }
  }
  const error = String(body["error"] ?? "unknown_error")
  if (error === "authorization_pending") return { status: "pending", intervalMs }
  if (error === "slow_down") return { status: "slow_down", intervalMs: intervalMs + 5000 }
  return { status: "error", error: String(body["error_description"] ?? error) }
}

const FORM = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }

/** Request a device + user code from the provider. */
export async function requestDeviceCode(config: DeviceFlowConfig): Promise<DeviceCodeResponse> {
  const res = await fetch(config.deviceCodeUrl, {
    method: "POST",
    headers: FORM,
    body: new URLSearchParams({ client_id: config.clientId, scope: config.scope ?? "" }).toString(),
  })
  if (!res.ok) throw new Error(`device code request failed (${res.status})`)
  const data = (await res.json()) as DeviceCodeResponse
  if (!data.device_code || !data.user_code) throw new Error("invalid device code response")
  return data
}

/** Poll the token endpoint once. */
export async function pollTokenOnce(
  config: DeviceFlowConfig,
  deviceCode: string,
  intervalMs: number,
): Promise<TokenPoll> {
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: FORM,
    body: new URLSearchParams({
      client_id: config.clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }).toString(),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return interpretTokenResponse(data, intervalMs)
}

/**
 * Run the full device flow: request a code, surface it, then poll until the
 * user approves (or the flow times out).
 */
export async function runDeviceFlow(
  config: DeviceFlowConfig,
  onPrompt: (info: DeviceCodeResponse) => void,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<string> {
  const code = await requestDeviceCode(config)
  onPrompt(code)
  const deadline = Date.now() + code.expires_in * 1000
  let intervalMs = Math.max(1000, (code.interval || 5) * 1000)

  while (Date.now() < deadline) {
    await sleep(intervalMs)
    const poll = await pollTokenOnce(config, code.device_code, intervalMs)
    if (poll.status === "success") return poll.accessToken
    if (poll.status === "error") throw new Error(`login failed: ${poll.error}`)
    intervalMs = poll.intervalMs
  }
  throw new Error("login timed out; please try again")
}

/** Built-in device-flow presets for known subscription providers. */
export const DEVICE_FLOW_PRESETS: Record<string, DeviceFlowConfig> = {
  // GitHub Copilot — public, stable device-flow endpoints.
  copilot: {
    deviceCodeUrl: "https://github.com/login/device/code",
    tokenUrl: "https://github.com/login/oauth/access_token",
    clientId: "Iv1.b507a08c87ecfe98", // GitHub Copilot public client id
    scope: "read:user",
  },
}
