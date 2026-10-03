import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  accountIdFromToken,
  codexFileSource,
  CredentialError,
  opencodeIntegrationSource,
  opencodeV1FileSource,
  resolveCredential,
  SIGN_IN_HELP,
} from "./credentials"

const jwt = (claims: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`

const NOW = 1_800_000_000_000

const tempFile = async (name: string, value: unknown) => {
  const dir = await mkdtemp(path.join(tmpdir(), "image-gen-"))
  const file = path.join(dir, name)
  await writeFile(file, JSON.stringify(value))
  return file
}

const tokenFetch = (body: Record<string, unknown>) => {
  const calls: RequestInit[] = []
  const fn = async (_url: string, init?: RequestInit) => {
    calls.push(init!)
    return new Response(JSON.stringify(body), { status: 200 })
  }
  return { fn, calls }
}

describe("accountIdFromToken", () => {
  test("reads the namespaced claim", () => {
    expect(accountIdFromToken(jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_1" } }))).toBe("acc_1")
  })
  test("falls through tokens in order", () => {
    expect(accountIdFromToken(undefined, "garbage", jwt({ chatgpt_account_id: "acc_2" }))).toBe("acc_2")
  })
})

describe("resolveCredential", () => {
  test("returns the first source that yields", async () => {
    const order: string[] = []
    const credential = await resolveCredential([
      async () => (order.push("a"), undefined),
      async () => (order.push("b"), { source: "codex", access: "t", accountId: "x" }),
      async () => (order.push("c"), { source: "opencode", access: "u", accountId: "y" }),
    ])
    expect(credential.source).toBe("codex")
    expect(order).toEqual(["a", "b"])
  })

  test("fails with sign-in help when nothing is available", async () => {
    const error = await resolveCredential([async () => undefined]).catch((e) => e)
    expect(error).toBeInstanceOf(CredentialError)
    expect(error.message).toBe(SIGN_IN_HELP)
  })

  test("keeps going after a broken source and reports it", async () => {
    const error = await resolveCredential([
      async () => {
        throw new CredentialError("bad file")
      },
      async () => undefined,
    ]).catch((e) => e)
    expect(error.message).toContain(SIGN_IN_HELP)
    expect(error.message).toContain("bad file")
  })
})

describe("opencodeIntegrationSource", () => {
  test("uses OAuth connections with stored account ID", async () => {
    const source = opencodeIntegrationSource({
      active: async () => ({ id: "c" }),
      resolve: async () => ({ type: "oauth", access: "tok", refresh: "r", expires: 0, metadata: { accountID: "acc" } }),
    })
    expect(await source()).toMatchObject({ source: "opencode", access: "tok", accountId: "acc" })
  })

  test("skips API key connections", async () => {
    const source = opencodeIntegrationSource({
      active: async () => ({ id: "c" }),
      resolve: async () => ({ type: "key", key: "sk-..." }),
    })
    expect(await source()).toBeUndefined()
  })

  test("derives account ID from the token", async () => {
    const access = jwt({ chatgpt_account_id: "from-jwt" })
    const source = opencodeIntegrationSource({
      active: async () => ({ id: "c" }),
      resolve: async () => ({ type: "oauth", access }),
    })
    expect((await source())?.accountId).toBe("from-jwt")
  })
})

describe("opencodeV1FileSource", () => {
  test("returns a valid token without refreshing", async () => {
    const file = await tempFile("auth.json", {
      openai: { type: "oauth", access: "a", refresh: "r", expires: NOW + 3_600_000, accountId: "acc" },
    })
    const { fn, calls } = tokenFetch({})
    const credential = await opencodeV1FileSource({ path: file, fetch: fn, now: () => NOW })()
    expect(credential).toMatchObject({ source: "opencode-v1", access: "a", accountId: "acc" })
    expect(calls).toHaveLength(0)
  })

  test("refreshes an expired token and preserves other entries", async () => {
    const file = await tempFile("auth.json", {
      anthropic: { type: "api", key: "keep-me" },
      openai: { type: "oauth", access: "old", refresh: "r1", expires: NOW - 1, accountId: "acc" },
    })
    const { fn, calls } = tokenFetch({ access_token: "new", refresh_token: "r2", expires_in: 100 })
    const credential = await opencodeV1FileSource({ path: file, fetch: fn, now: () => NOW })()
    expect(credential?.access).toBe("new")
    expect(String(calls[0]!.body)).toContain("refresh_token=r1")
    const saved = JSON.parse(await readFile(file, "utf8"))
    expect(saved.anthropic).toEqual({ type: "api", key: "keep-me" })
    expect(saved.openai).toMatchObject({ type: "oauth", access: "new", refresh: "r2", expires: NOW + 100_000, accountId: "acc" })
  })

  test("ignores non-OAuth openai entries", async () => {
    const file = await tempFile("auth.json", { openai: { type: "api", key: "sk" } })
    expect(await opencodeV1FileSource({ path: file })()).toBeUndefined()
  })

  test("missing file yields nothing", async () => {
    expect(await opencodeV1FileSource({ path: "/nonexistent/auth.json" })()).toBeUndefined()
  })
})

describe("codexFileSource", () => {
  test("refreshes when the access JWT is expired", async () => {
    const expired = jwt({ exp: NOW / 1000 - 10, chatgpt_account_id: "acc" })
    const file = await tempFile("auth.json", {
      auth_mode: "chatgpt",
      tokens: { access_token: expired, refresh_token: "r1", id_token: "i", account_id: "acc" },
    })
    const { fn } = tokenFetch({ access_token: "fresh", refresh_token: "r2" })
    const credential = await codexFileSource({ path: file, fetch: fn, now: () => NOW })()
    expect(credential).toMatchObject({ source: "codex", access: "fresh", accountId: "acc" })
    const saved = JSON.parse(await readFile(file, "utf8"))
    expect(saved.auth_mode).toBe("chatgpt")
    expect(saved.tokens).toMatchObject({ access_token: "fresh", refresh_token: "r2", id_token: "i", account_id: "acc" })
    expect(saved.last_refresh).toBe(new Date(NOW).toISOString())
  })

  test("refresh failure does not leak tokens", async () => {
    const expired = jwt({ exp: 1 })
    const file = await tempFile("auth.json", { tokens: { access_token: expired, refresh_token: "secret-refresh", account_id: "a" } })
    const fn = async () => new Response("nope secret-refresh", { status: 401 })
    const error = await codexFileSource({ path: file, fetch: fn, now: () => NOW })().catch((e) => e)
    expect(error).toBeInstanceOf(CredentialError)
    expect(error.message).not.toContain("secret-refresh")
  })
})
