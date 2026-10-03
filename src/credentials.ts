import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

export const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
export const OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token"
const EXPIRY_MARGIN_MS = 60_000

export type CredentialSourceName = "opencode" | "opencode-v1" | "codex"

export interface Credential {
  readonly source: CredentialSourceName
  readonly access: string
  readonly accountId: string
  /** Returns a fresh credential after a 401. Undefined when the source cannot refresh. */
  readonly refresh?: () => Promise<Credential | undefined>
}

export type CredentialSource = () => Promise<Credential | undefined>

export class CredentialError extends Error {
  override name = "CredentialError"
}

export const SIGN_IN_HELP =
  "No ChatGPT login found. Sign in with ChatGPT in OpenCode (/connect → OpenAI → ChatGPT Pro/Plus) or run `codex login`, then try again."

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface Claims {
  exp?: number
  chatgpt_account_id?: string
  "https://api.openai.com/auth"?: { chatgpt_account_id?: string }
  organizations?: { id?: string }[]
}

export function decodeJwt(token: string): Claims | undefined {
  const payload = token.split(".")[1]
  if (!payload) return undefined
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    return value && typeof value === "object" ? (value as Claims) : undefined
  } catch {
    return undefined
  }
}

export function accountIdFromToken(...tokens: (string | undefined)[]): string | undefined {
  for (const token of tokens) {
    if (!token) continue
    const claims = decodeJwt(token)
    const id =
      claims?.chatgpt_account_id ?? claims?.["https://api.openai.com/auth"]?.chatgpt_account_id ?? claims?.organizations?.[0]?.id
    if (id) return id
  }
  return undefined
}

function tokenExpiry(token: string): number | undefined {
  const exp = decodeJwt(token)?.exp
  return typeof exp === "number" ? exp * 1000 : undefined
}

const isExpired = (expiresAt: number | undefined, now: number) => expiresAt !== undefined && expiresAt - EXPIRY_MARGIN_MS <= now

export async function resolveCredential(sources: readonly CredentialSource[]): Promise<Credential> {
  const problems: string[] = []
  for (const source of sources) {
    try {
      const credential = await source()
      if (credential) return credential
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new CredentialError(problems.length ? `${SIGN_IN_HELP}\n${problems.map((p) => `- ${p}`).join("\n")}` : SIGN_IN_HELP)
}

// --- OpenCode V2 integration -------------------------------------------------

interface IntegrationConnection {
  active(integrationID: string): Promise<unknown>
  resolve(connection: any): Promise<unknown>
}

interface OAuthValue {
  type: "oauth"
  access: string
  metadata?: Record<string, unknown>
}

const isOAuthValue = (value: unknown): value is OAuthValue =>
  !!value && typeof value === "object" && (value as { type?: unknown }).type === "oauth" && typeof (value as { access?: unknown }).access === "string"

export function opencodeIntegrationSource(connection: IntegrationConnection): CredentialSource {
  const load = async (): Promise<Credential | undefined> => {
    const active = await connection.active("openai")
    if (!active) return undefined
    const value = await connection.resolve(active)
    // API keys are not valid against the ChatGPT backend.
    if (!isOAuthValue(value)) return undefined
    const stored = value.metadata?.accountID
    const accountId = (typeof stored === "string" && stored) || accountIdFromToken(value.access)
    if (!accountId) throw new CredentialError("OpenCode's OpenAI login has no ChatGPT account ID.")
    // OpenCode owns refresh for its connections; re-resolving picks up whatever it has now.
    return { source: "opencode", access: value.access, accountId, refresh: load }
  }
  return load
}

// --- File-based sources -------------------------------------------------------

export interface FileSourceOptions {
  path?: string
  fetch?: FetchLike
  now?: () => number
}

export function opencodeAuthPath(env: NodeJS.ProcessEnv = process.env) {
  const base = env.XDG_DATA_HOME || path.join(homedir(), ".local", "share")
  return path.join(base, "opencode", "auth.json")
}

export function codexAuthPath(env: NodeJS.ProcessEnv = process.env) {
  return path.join(env.CODEX_HOME || path.join(homedir(), ".codex"), "auth.json")
}

async function readJson(file: string): Promise<Record<string, any> | undefined> {
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
  try {
    const value = JSON.parse(text)
    return value && typeof value === "object" ? value : undefined
  } catch {
    throw new CredentialError(`Could not parse ${file}.`)
  }
}

async function writeJsonAtomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 })
  await rename(temp, file)
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
}

export async function refreshTokens(refreshToken: string, fetchImpl: FetchLike = fetch): Promise<TokenResponse> {
  const response = await fetchImpl(process.env.CODEX_REFRESH_TOKEN_URL_OVERRIDE || OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: OAUTH_CLIENT_ID }).toString(),
  })
  if (!response.ok) throw new CredentialError(`ChatGPT token refresh failed (HTTP ${response.status}). Sign in again.`)
  const body = (await response.json()) as Partial<TokenResponse>
  if (typeof body.access_token !== "string") throw new CredentialError("ChatGPT token refresh returned no access token.")
  return body as TokenResponse
}

/** OpenCode V1 `auth.json`: `{ openai: { type: "oauth", access, refresh, expires, accountId? } }`. */
export function opencodeV1FileSource(options: FileSourceOptions = {}): CredentialSource {
  const file = options.path ?? opencodeAuthPath()
  const fetchImpl = options.fetch ?? fetch
  const now = options.now ?? Date.now

  const refresh = async (): Promise<Credential | undefined> => {
    const data = await readJson(file)
    const entry = data?.openai
    if (!data || entry?.type !== "oauth" || typeof entry.refresh !== "string") return undefined
    const tokens = await refreshTokens(entry.refresh, fetchImpl)
    // Re-read so entries written by others in the meantime are preserved.
    const latest = (await readJson(file)) ?? data
    const accountId = entry.accountId ?? accountIdFromToken(tokens.id_token, tokens.access_token)
    latest.openai = {
      ...latest.openai,
      access: tokens.access_token,
      refresh: tokens.refresh_token ?? entry.refresh,
      expires: now() + (tokens.expires_in ?? 3600) * 1000,
      ...(accountId ? { accountId } : {}),
    }
    await writeJsonAtomic(file, latest)
    return toCredential(latest.openai)
  }

  const toCredential = (entry: Record<string, any>): Credential => {
    const accountId = entry.accountId || accountIdFromToken(entry.access)
    if (!accountId) throw new CredentialError(`${file} has no ChatGPT account ID.`)
    return { source: "opencode-v1", access: entry.access, accountId, refresh }
  }

  return async () => {
    const entry = (await readJson(file))?.openai
    if (entry?.type !== "oauth" || typeof entry.access !== "string") return undefined
    if (isExpired(typeof entry.expires === "number" ? entry.expires : tokenExpiry(entry.access), now())) return refresh()
    return toCredential(entry)
  }
}

/** Codex CLI `auth.json`: `{ tokens: { access_token, refresh_token, id_token, account_id } }`. */
export function codexFileSource(options: FileSourceOptions = {}): CredentialSource {
  const file = options.path ?? codexAuthPath()
  const fetchImpl = options.fetch ?? fetch
  const now = options.now ?? Date.now

  const toCredential = (tokens: Record<string, any>): Credential => {
    const accountId = tokens.account_id || accountIdFromToken(tokens.id_token, tokens.access_token)
    if (!accountId) throw new CredentialError(`${file} has no ChatGPT account ID.`)
    return { source: "codex", access: tokens.access_token, accountId, refresh }
  }

  const refresh = async (): Promise<Credential | undefined> => {
    const data = await readJson(file)
    const current = data?.tokens
    if (!data || typeof current?.refresh_token !== "string") return undefined
    const tokens = await refreshTokens(current.refresh_token, fetchImpl)
    const latest = (await readJson(file)) ?? data
    latest.tokens = {
      ...latest.tokens,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? current.refresh_token,
      ...(tokens.id_token ? { id_token: tokens.id_token } : {}),
    }
    latest.last_refresh = new Date(now()).toISOString()
    await writeJsonAtomic(file, latest)
    return toCredential(latest.tokens)
  }

  return async () => {
    const tokens = (await readJson(file))?.tokens
    if (typeof tokens?.access_token !== "string") return undefined
    if (isExpired(tokenExpiry(tokens.access_token), now())) return refresh()
    return toCredential(tokens)
  }
}
