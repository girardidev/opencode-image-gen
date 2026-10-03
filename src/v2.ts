import { Plugin } from "@opencode/plugin"
import { codexFileSource, opencodeIntegrationSource, opencodeV1FileSource } from "./credentials"
import { BACKGROUNDS, FORMATS, generateImage, QUALITIES, type GenerateInput } from "./generate"
import { resolveOptions } from "./options"
import { DESCRIPTION, FIELD_DESCRIPTIONS, TOOL_NAME } from "./tool"

const input = {
  type: "object",
  properties: {
    prompt: { type: "string", minLength: 1, description: FIELD_DESCRIPTIONS.prompt },
    outputPath: { type: "string", minLength: 1, description: FIELD_DESCRIPTIONS.outputPath },
    inputImages: { type: "array", items: { type: "string" }, description: FIELD_DESCRIPTIONS.inputImages },
    size: { type: "string", description: FIELD_DESCRIPTIONS.size },
    quality: { type: "string", enum: [...QUALITIES], description: FIELD_DESCRIPTIONS.quality },
    background: { type: "string", enum: [...BACKGROUNDS], description: FIELD_DESCRIPTIONS.background },
    format: { type: "string", enum: [...FORMATS], description: FIELD_DESCRIPTIONS.format },
    overwrite: { type: "boolean", description: FIELD_DESCRIPTIONS.overwrite },
  },
  required: ["prompt", "outputPath"],
  additionalProperties: false,
} as const

export const v2 = Plugin.define({
  id: "opencode-image-gen",
  async setup(ctx) {
    const options = resolveOptions(ctx.options)
    const credentialSources = [opencodeIntegrationSource(ctx.integration.connection), opencodeV1FileSource(), codexFileSource()]

    const sessionDirectory = async (sessionID: string) => {
      const session = await ctx.session.get({ sessionID }).catch(() => undefined)
      return session?.location.directory ?? ctx.location.directory
    }

    await ctx.tool.transform((editor) => {
      editor.add({
        name: TOOL_NAME,
        description: DESCRIPTION,
        input,
        options: { codemode: false },
        execute: async (args, context) => {
          const result = await generateImage(args as GenerateInput, {
            directory: await sessionDirectory(context.sessionID),
            options,
            credentialSources,
            signal: context.signal,
            progress: (status) => void context.progress({ status }).catch(() => {}),
          })
          return {
            content: [
              { type: "text", text: result.summary },
              { type: "file", uri: result.dataUrl, mime: result.mime, name: result.path.split(/[\\/]/).pop() },
            ],
            metadata: { path: result.path, format: result.format, bytes: result.bytes, revisedPrompt: result.revisedPrompt },
          }
        },
      })
    })
  },
})
