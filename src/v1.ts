import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import path from "node:path"
import { codexFileSource, opencodeV1FileSource } from "./credentials"
import { BACKGROUNDS, FORMATS, generateImage, QUALITIES } from "./generate"
import { resolveOptions } from "./options"
import { DESCRIPTION, FIELD_DESCRIPTIONS, TOOL_NAME } from "./tool"

const z = tool.schema

export const server: Plugin = async (_input, pluginOptions) => {
  const options = resolveOptions(pluginOptions)
  const credentialSources = [opencodeV1FileSource(), codexFileSource()]

  return {
    tool: {
      [TOOL_NAME]: tool({
        description: DESCRIPTION,
        args: {
          prompt: z.string().min(1).describe(FIELD_DESCRIPTIONS.prompt),
          outputPath: z.string().min(1).describe(FIELD_DESCRIPTIONS.outputPath),
          inputImages: z.array(z.string()).optional().describe(FIELD_DESCRIPTIONS.inputImages),
          size: z.string().optional().describe(FIELD_DESCRIPTIONS.size),
          quality: z.enum(QUALITIES).optional().describe(FIELD_DESCRIPTIONS.quality),
          background: z.enum(BACKGROUNDS).optional().describe(FIELD_DESCRIPTIONS.background),
          format: z.enum(FORMATS).optional().describe(FIELD_DESCRIPTIONS.format),
          overwrite: z.boolean().optional().describe(FIELD_DESCRIPTIONS.overwrite),
        },
        async execute(args, context) {
          const target = path.resolve(context.directory, args.outputPath)
          await context.ask({
            permission: "edit",
            patterns: [path.relative(context.worktree, target)],
            always: ["*"],
            metadata: { filepath: target },
          })
          const result = await generateImage(args, {
            directory: context.directory,
            options,
            credentialSources,
            signal: context.abort,
            progress: (status) => context.metadata({ title: `Generating image (${status})` }),
          })
          return {
            title: path.relative(context.worktree, result.path),
            output: result.summary,
            metadata: { path: result.path, format: result.format, bytes: result.bytes, revisedPrompt: result.revisedPrompt },
            attachments: [{ type: "file", mime: result.mime, url: result.dataUrl, filename: path.basename(result.path) }],
          }
        },
      }),
    },
  }
}
