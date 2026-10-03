import type { Credential } from "./credentials"
import { CredentialError, SIGN_IN_HELP } from "./credentials"
import type { Options } from "./options"
import { BackendError, extractImage, parseSSE, type ImageResult, type Stage } from "./sse"

export type ImageFormat = "png" | "webp" | "jpeg"

export interface ImageRequest {
  prompt: string
  /** Data URLs for reference images. */
  images: string[]
  format: ImageFormat
  size: string
  quality: string
  background: string
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class TimeoutError extends Error {
  override name = "TimeoutError"
}

export function buildBody(request: ImageRequest, options: Pick<Options, "model" | "imageModel">) {
  return {
    model: options.model,
    instructions: "",
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: request.prompt },
          ...request.images.map((url) => ({ type: "input_image", image_url: url })),
        ],
      },
    ],
    tools: [
      {
        type: "image_generation",
        output_format: request.format,
        size: request.size,
        quality: request.quality,
        background: request.background,
        ...(options.imageModel ? { model: options.imageModel } : {}),
      },
    ],
    tool_choice: { type: "image_generation" },
    parallel_tool_calls: false,
    stream: true,
    store: false,
  }
}

export function buildHeaders(credential: Credential, options: Pick<Options, "originator">, sessionId: string) {
  return {
    authorization: `Bearer ${credential.access}`,
    "chatgpt-account-id": credential.accountId,
    "openai-beta": "responses=experimental",
    originator: options.originator,
    session_id: sessionId,
    "content-type": "application/json",
    accept: "text/event-stream",
  }
}

export interface SendOptions {
  credential: Credential
  options: Options
  signal?: AbortSignal
  onStage?: (stage: Stage) => void
  fetch?: FetchLike
}

export async function requestImage(request: ImageRequest, send: SendOptions): Promise<ImageResult> {
  const fetchImpl = send.fetch ?? fetch
  const timeout = AbortSignal.timeout(send.options.timeoutMs)
  const signal = send.signal ? AbortSignal.any([send.signal, timeout]) : timeout
  const body = JSON.stringify(buildBody(request, send.options))
  const sessionId = crypto.randomUUID()

  const post = (credential: Credential) =>
    fetchImpl(`${send.options.baseURL}/responses`, {
      method: "POST",
      headers: buildHeaders(credential, send.options, sessionId),
      body,
      signal,
    })

  try {
    let credential = send.credential
    let response = await post(credential)
    if (response.status === 401 && credential.refresh) {
      await response.body?.cancel()
      const refreshed = await credential.refresh()
      if (refreshed) {
        credential = refreshed
        response = await post(credential)
      }
    }
    if (response.status === 401) {
      await response.body?.cancel()
      throw new CredentialError(`ChatGPT rejected the login (HTTP 401). ${SIGN_IN_HELP}`)
    }
    if (!response.ok) {
      const detail = sanitize(await response.text().catch(() => ""), credential)
      throw new BackendError(`ChatGPT backend returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`, response.status)
    }
    if (!response.body) throw new BackendError("ChatGPT backend returned an empty response.")
    return await extractImage(parseSSE(response.body), send.onStage)
  } catch (error) {
    if (timeout.aborted && !send.signal?.aborted)
      throw new TimeoutError(`Image generation timed out after ${Math.round(send.options.timeoutMs / 1000)}s.`)
    throw error
  }
}

function sanitize(text: string, credential: Credential) {
  let detail = text.trim()
  try {
    const parsed = JSON.parse(detail)
    const message = parsed?.error?.message ?? parsed?.detail ?? parsed?.message
    if (typeof message === "string") detail = message
  } catch {}
  return detail.replaceAll(credential.access, "[redacted]").replace(/Bearer\s+[\w.-]+/gi, "Bearer [redacted]").slice(0, 1000)
}
