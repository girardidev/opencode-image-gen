import { describe, expect, test } from "bun:test"
import type { Credential } from "./credentials"
import { CredentialError } from "./credentials"
import { DEFAULTS } from "./options"
import { BackendError } from "./sse"
import { buildBody, requestImage, TimeoutError, type ImageRequest } from "./transport"

const sse = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")

const request: ImageRequest = {
  prompt: "a fox",
  images: ["data:image/png;base64,AAAA"],
  format: "png",
  size: "1024x1024",
  quality: "high",
  background: "auto",
}

const okStream = () =>
  sse([
    {
      type: "response.completed",
      response: { output: [{ type: "image_generation_call", result: "aGk=" }] },
    },
  ])

const credential = (overrides: Partial<Credential> = {}): Credential => ({
  source: "codex",
  access: "tok-1",
  accountId: "acc",
  ...overrides,
})

type Call = { url: string; init: RequestInit }

const fakeFetch = (responses: (() => Response)[]) => {
  const calls: Call[] = []
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init! })
    const next = responses.shift()
    if (!next) throw new Error("unexpected request")
    return next()
  }
  return { fn, calls }
}

describe("buildBody", () => {
  test("forces the hosted image tool and streams", () => {
    const body = buildBody(request, { model: "gpt-5.5", imageModel: "gpt-image-2" })
    expect(body).toMatchObject({
      model: "gpt-5.5",
      stream: true,
      store: false,
      tool_choice: { type: "image_generation" },
      tools: [{ type: "image_generation", output_format: "png", size: "1024x1024", quality: "high", model: "gpt-image-2" }],
    })
    expect(body.input[0]!.content).toEqual([
      { type: "input_text", text: "a fox" },
      { type: "input_image", image_url: "data:image/png;base64,AAAA" },
    ])
  })
})

describe("requestImage", () => {
  test("sends ChatGPT headers to /responses", async () => {
    const { fn, calls } = fakeFetch([() => new Response(okStream())])
    const result = await requestImage(request, { credential: credential(), options: DEFAULTS, fetch: fn })
    expect(result.base64).toBe("aGk=")
    expect(calls[0]!.url).toBe("https://chatgpt.com/backend-api/codex/responses")
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer tok-1")
    expect(headers["chatgpt-account-id"]).toBe("acc")
    expect(headers.originator).toBe("opencode")
  })

  test("refreshes once on 401 and retries", async () => {
    const { fn, calls } = fakeFetch([() => new Response("", { status: 401 }), () => new Response(okStream())])
    const cred = credential({ refresh: async () => credential({ access: "tok-2" }) })
    await requestImage(request, { credential: cred, options: DEFAULTS, fetch: fn })
    expect(calls).toHaveLength(2)
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok-2")
  })

  test("second 401 fails with sign-in help", async () => {
    const { fn } = fakeFetch([() => new Response("", { status: 401 }), () => new Response("", { status: 401 })])
    const cred = credential({ refresh: async () => credential({ access: "tok-2" }) })
    const error = await requestImage(request, { credential: cred, options: DEFAULTS, fetch: fn }).catch((e) => e)
    expect(error).toBeInstanceOf(CredentialError)
  })

  test("HTTP errors are sanitized", async () => {
    const { fn } = fakeFetch([
      () => new Response(JSON.stringify({ error: { message: "quota for tok-1 exceeded" } }), { status: 429 }),
    ])
    const error = await requestImage(request, { credential: credential(), options: DEFAULTS, fetch: fn }).catch((e) => e)
    expect(error).toBeInstanceOf(BackendError)
    expect(error.status).toBe(429)
    expect(error.message).toBe("ChatGPT backend returned HTTP 429: quota for [redacted] exceeded")
  })

  test("times out", async () => {
    const fn = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)))
    const error = await requestImage(request, {
      credential: credential(),
      options: { ...DEFAULTS, timeoutMs: 20 },
      fetch: fn,
    }).catch((e) => e)
    expect(error).toBeInstanceOf(TimeoutError)
  })

  test("user abort is not reported as timeout", async () => {
    const controller = new AbortController()
    const fn = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)))
    const pending = requestImage(request, { credential: credential(), options: DEFAULTS, fetch: fn, signal: controller.signal })
    controller.abort()
    const error = await pending.catch((e) => e)
    expect(error).not.toBeInstanceOf(TimeoutError)
  })
})
