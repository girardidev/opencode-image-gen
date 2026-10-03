export interface SSEEvent {
  event?: string
  data: string
}

export class BackendError extends Error {
  override name = "BackendError"
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export const MAX_STREAM_BYTES = 64 * 1024 * 1024

export async function* parseSSE(stream: ReadableStream<Uint8Array>, maxBytes = MAX_STREAM_BYTES): AsyncGenerator<SSEEvent> {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let buffer = ""
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (value) {
        total += value.byteLength
        if (total > maxBytes) throw new BackendError(`Response stream exceeded ${maxBytes} bytes.`)
        buffer += decoder.decode(value, { stream: true })
      }
      if (done) buffer += decoder.decode()
      buffer = buffer.replace(/\r\n?/g, "\n")
      let boundary: number
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const event = parseBlock(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        if (event) yield event
      }
      if (done) {
        const event = parseBlock(buffer)
        if (event) yield event
        return
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function parseBlock(block: string): SSEEvent | undefined {
  let event: string | undefined
  const data: string[] = []
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "")
    if (field === "event") event = value
    else if (field === "data") data.push(value)
  }
  if (!data.length) return undefined
  return { event, data: data.join("\n") }
}

export type Stage = "queued" | "generating" | "partial image"

export interface ImageResult {
  /** Base64-encoded image bytes. */
  base64: string
  revisedPrompt?: string
  usage?: unknown
}

interface ImageCall {
  type: "image_generation_call"
  result?: string | null
  revised_prompt?: string
}

const isImageCall = (item: any): item is ImageCall => item?.type === "image_generation_call"

function messageText(item: any): string[] {
  if (item?.type !== "message" || !Array.isArray(item.content)) return []
  return item.content.flatMap((part: any) =>
    typeof part?.text === "string" ? [part.text] : typeof part?.refusal === "string" ? [part.refusal] : [],
  )
}

const STAGES: Record<string, Stage> = {
  "response.image_generation_call.in_progress": "queued",
  "response.image_generation_call.generating": "generating",
  "response.image_generation_call.partial_image": "partial image",
}

/**
 * Consumes Codex Responses SSE events and returns the generated image.
 * Prefers `response.completed` output, falling back to `response.output_item.done`.
 */
export async function extractImage(events: AsyncIterable<SSEEvent>, onStage?: (stage: Stage) => void): Promise<ImageResult> {
  const fromItems: ImageCall[] = []
  const text: string[] = []
  let completed: ImageCall[] | undefined
  let usage: unknown

  for await (const { event: name, data } of events) {
    if (data === "[DONE]") break
    let payload: any
    try {
      payload = JSON.parse(data)
    } catch {
      continue
    }
    const type: string = payload?.type ?? name ?? ""

    const stage = STAGES[type]
    if (stage) {
      onStage?.(stage)
      continue
    }

    switch (type) {
      case "response.output_item.done":
        if (isImageCall(payload.item)) fromItems.push(payload.item)
        else text.push(...messageText(payload.item))
        break
      case "response.completed": {
        const output: unknown[] = Array.isArray(payload.response?.output) ? payload.response.output : []
        completed = output.filter(isImageCall)
        if (!text.length) text.push(...output.flatMap(messageText))
        usage = payload.response?.usage
        break
      }
      case "response.failed":
        throw new BackendError(errorMessage(payload.response?.error) ?? "Image generation failed.")
      case "response.incomplete":
        throw new BackendError(
          `Image generation incomplete: ${payload.response?.incomplete_details?.reason ?? "unknown reason"}.`,
        )
      case "error":
        throw new BackendError(errorMessage(payload.error ?? payload) ?? "Image generation failed.")
    }
  }

  const image = [...(completed ?? []), ...fromItems].find((item) => typeof item.result === "string" && item.result.length > 0)
  if (!image) {
    const detail = text.join("\n").trim()
    throw new BackendError(detail ? `No image was generated. The model replied: ${detail}` : "No image was generated.")
  }
  return { base64: image.result!, revisedPrompt: image.revised_prompt, usage }
}

function errorMessage(error: any): string | undefined {
  if (!error) return undefined
  if (typeof error === "string") return error
  const message = typeof error.message === "string" ? error.message : undefined
  const code = typeof error.code === "string" ? error.code : undefined
  if (message && code) return `${message} (${code})`
  return message ?? code
}
