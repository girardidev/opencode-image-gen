import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { CredentialSource } from "./credentials"
import { generateImage, resolveFormat, ValidationError, type GenerateContext, type ProgressStatus } from "./generate"
import { DEFAULTS } from "./options"

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")

const stream = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")

const success = () =>
  new Response(
    stream([
      { type: "response.image_generation_call.generating" },
      {
        type: "response.completed",
        response: { output: [{ type: "image_generation_call", result: PNG, revised_prompt: "a cute fox" }] },
      },
    ]),
  )

const credentialSource: CredentialSource = async () => ({ source: "codex", access: "tok", accountId: "acc" })

const setup = async (respond: () => Response = success) => {
  const directory = await mkdtemp(path.join(tmpdir(), "image-gen-"))
  const bodies: any[] = []
  const progress: ProgressStatus[] = []
  const context: GenerateContext = {
    directory,
    options: DEFAULTS,
    credentialSources: [credentialSource],
    progress: (s) => progress.push(s),
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init!.body)))
      return respond()
    },
  }
  return { directory, bodies, progress, context }
}

describe("resolveFormat", () => {
  test("infers from extension", () => {
    expect(resolveFormat("a.JPG")).toBe("jpeg")
    expect(resolveFormat("a.webp")).toBe("webp")
    expect(resolveFormat("noext")).toBe("png")
    expect(resolveFormat("noext", "webp")).toBe("webp")
  })
  test("rejects mismatch and unsupported extensions", () => {
    expect(() => resolveFormat("a.jpg", "png")).toThrow(ValidationError)
    expect(() => resolveFormat("a.gif")).toThrow(ValidationError)
  })
})

describe("generateImage", () => {
  test("writes the image to an agent-chosen relative path", async () => {
    const { directory, progress, context } = await setup()
    const result = await generateImage({ prompt: "a fox", outputPath: "assets/nested/fox.png" }, context)
    const file = path.join(directory, "assets/nested/fox.png")
    expect(result.path).toBe(file)
    expect((await readFile(file)).toString("base64")).toBe(PNG)
    expect(result.dataUrl).toBe(`data:image/png;base64,${PNG}`)
    expect(result.summary).toContain("Revised prompt: a cute fox")
    expect(progress).toEqual(["authenticating", "generating", "saving"])
  })

  test("sends reference images as data URLs", async () => {
    const { directory, bodies, context } = await setup()
    await writeFile(path.join(directory, "ref.jpg"), Buffer.from("jpg"))
    await generateImage({ prompt: "edit", outputPath: "out.png", inputImages: ["ref.jpg"] }, context)
    expect(bodies[0].input[0].content[1]).toEqual({
      type: "input_image",
      image_url: `data:image/jpeg;base64,${Buffer.from("jpg").toString("base64")}`,
    })
  })

  test("validation errors make no request", async () => {
    const { directory, bodies, context } = await setup()
    await writeFile(path.join(directory, "exists.png"), "x")
    const cases = [
      { prompt: "  ", outputPath: "a.png" },
      { prompt: "x", outputPath: "exists.png" },
      { prompt: "x", outputPath: "a.jpg", background: "transparent" as const },
      { prompt: "x", outputPath: "a.png", size: "big" },
      { prompt: "x", outputPath: "a.png", inputImages: ["missing.png"] },
      { prompt: "x", outputPath: "a.png", inputImages: ["doc.pdf"] },
    ]
    for (const input of cases) await expect(generateImage(input, context)).rejects.toBeInstanceOf(ValidationError)
    await Bun.sleep(10)
    expect(bodies).toHaveLength(0)
  })

  test("overwrite replaces an existing file", async () => {
    const { directory, context } = await setup()
    const file = path.join(directory, "exists.png")
    await writeFile(file, "old")
    await generateImage({ prompt: "x", outputPath: "exists.png", overwrite: true }, context)
    expect((await readFile(file)).toString("base64")).toBe(PNG)
  })

  test("aborted request writes nothing", async () => {
    const controller = new AbortController()
    const { directory, context } = await setup()
    context.signal = controller.signal
    context.fetch = async (_url, init) => {
      controller.abort()
      init!.signal!.throwIfAborted()
      return success()
    }
    await expect(generateImage({ prompt: "x", outputPath: "out.png" }, context)).rejects.toThrow()
    await Bun.sleep(10)
    expect(await Bun.file(path.join(directory, "out.png")).exists()).toBe(false)
  })
})
