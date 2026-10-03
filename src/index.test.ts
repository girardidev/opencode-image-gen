import { describe, expect, test } from "bun:test"
import plugin from "../index"

describe("default export", () => {
  test("exposes V2 id/setup and V1 server", () => {
    expect(plugin.id).toBe("opencode-image-gen")
    expect(typeof plugin.setup).toBe("function")
    expect(typeof plugin.server).toBe("function")
  })

  test("V1 server registers generate_image", async () => {
    const hooks = await plugin.server({} as never, { model: "gpt-5.4" })
    const tool = hooks.tool?.generate_image
    expect(tool).toBeDefined()
    expect(Object.keys(tool!.args)).toEqual([
      "prompt",
      "outputPath",
      "inputImages",
      "size",
      "quality",
      "background",
      "format",
      "overwrite",
    ])
  })

  test("V2 setup registers generate_image as a direct tool", async () => {
    const added: any[] = []
    const ctx = {
      options: {},
      location: { directory: "/tmp" },
      integration: { connection: { active: async () => undefined, resolve: async () => undefined } },
      session: { get: async () => ({ location: { directory: "/tmp" } }) },
      tool: { transform: async (cb: (editor: any) => void) => cb({ add: (t: any) => added.push(t) }) },
    }
    await plugin.setup(ctx as never)
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ name: "generate_image", options: { codemode: false } })
    expect(added[0].input.required).toEqual(["prompt", "outputPath"])
  })
})
