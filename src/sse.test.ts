import { describe, expect, test } from "bun:test"
import { BackendError, extractImage, parseSSE, type Stage } from "./sse"

const sse = (events: unknown[]) => events.map((e) => `event: ${(e as any).type}\ndata: ${JSON.stringify(e)}\n\n`).join("")

const streamOf = (text: string, chunkSize = text.length) => {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize))
      controller.close()
    },
  })
}

const run = (events: unknown[], chunkSize?: number, onStage?: (s: Stage) => void) =>
  extractImage(parseSSE(streamOf(sse(events), chunkSize)), onStage)

const imageItem = { type: "image_generation_call", id: "ig_1", status: "completed", result: "aGVsbG8=", revised_prompt: "a fox" }

describe("parseSSE", () => {
  test("handles multi-line data, comments and CRLF", async () => {
    const out = []
    for await (const e of parseSSE(streamOf(": ping\r\nevent: x\r\ndata: a\r\ndata: b\r\n\r\ndata: c"))) out.push(e)
    expect(out).toEqual([
      { event: "x", data: "a\nb" },
      { event: undefined, data: "c" },
    ])
  })

  test("enforces the size cap", async () => {
    const consume = async () => {
      for await (const _ of parseSSE(streamOf("data: 1234567890\n\n"), 5));
    }
    await expect(consume()).rejects.toBeInstanceOf(BackendError)
  })
})

describe("extractImage", () => {
  test("success with stages, split across tiny chunks", async () => {
    const stages: Stage[] = []
    const result = await run(
      [
        { type: "response.created", response: {} },
        { type: "response.image_generation_call.in_progress" },
        { type: "response.image_generation_call.generating" },
        { type: "response.image_generation_call.partial_image", partial_image_b64: "xx" },
        { type: "response.output_item.done", item: imageItem },
        { type: "response.completed", response: { output: [imageItem], usage: { total_tokens: 5 } } },
      ],
      7,
      (s) => stages.push(s),
    )
    expect(result).toEqual({ base64: "aGVsbG8=", revisedPrompt: "a fox", usage: { total_tokens: 5 } })
    expect(stages).toEqual(["queued", "generating", "partial image"])
  })

  test("falls back to output_item.done when completed has no image", async () => {
    const result = await run([
      { type: "response.output_item.done", item: imageItem },
      { type: "response.completed", response: { output: [] } },
    ])
    expect(result.base64).toBe("aGVsbG8=")
  })

  test("no image reports the model's reply", async () => {
    const message = { type: "message", role: "assistant", content: [{ type: "refusal", refusal: "I can't make that." }] }
    const error = await run([
      { type: "response.output_item.done", item: message },
      { type: "response.completed", response: { output: [message] } },
    ]).catch((e) => e)
    expect(error).toBeInstanceOf(BackendError)
    expect(error.message).toContain("I can't make that.")
  })

  test("response.failed surfaces the backend error", async () => {
    const error = await run([
      { type: "response.failed", response: { error: { code: "rate_limit_exceeded", message: "Slow down" } } },
    ]).catch((e) => e)
    expect(error.message).toBe("Slow down (rate_limit_exceeded)")
  })

  test("error event surfaces the message", async () => {
    const error = await run([{ type: "error", message: "boom" }]).catch((e) => e)
    expect(error.message).toBe("boom")
  })
})
