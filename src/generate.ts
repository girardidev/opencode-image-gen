import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { resolveCredential, type CredentialSource } from "./credentials"
import type { Options } from "./options"
import { requestImage, type ImageFormat } from "./transport"

export const QUALITIES = ["low", "medium", "high", "auto"] as const
export const BACKGROUNDS = ["opaque", "transparent", "auto"] as const
export const FORMATS = ["png", "webp", "jpeg"] as const
export const MAX_INPUT_IMAGE_BYTES = 20 * 1024 * 1024

export interface GenerateInput {
  prompt: string
  outputPath: string
  inputImages?: string[]
  size?: string
  quality?: (typeof QUALITIES)[number]
  background?: (typeof BACKGROUNDS)[number]
  format?: ImageFormat
  overwrite?: boolean
}

export type ProgressStatus = "authenticating" | "queued" | "generating" | "partial image" | "saving"

export interface GenerateContext {
  /** Directory used to resolve relative paths. */
  directory: string
  options: Options
  credentialSources: readonly CredentialSource[]
  signal?: AbortSignal
  progress?: (status: ProgressStatus) => void
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
}

export interface GenerateResult {
  path: string
  format: ImageFormat
  mime: string
  bytes: number
  dataUrl: string
  revisedPrompt?: string
  summary: string
}

export class ValidationError extends Error {
  override name = "ValidationError"
}

const OUTPUT_EXTENSIONS: Record<string, ImageFormat> = { ".png": "png", ".webp": "webp", ".jpg": "jpeg", ".jpeg": "jpeg" }
const INPUT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
}
const FORMAT_MIME: Record<ImageFormat, string> = { png: "image/png", webp: "image/webp", jpeg: "image/jpeg" }

const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  )

export function resolveFormat(outputPath: string, format?: ImageFormat): ImageFormat {
  if (format && !FORMATS.includes(format)) throw new ValidationError(`Unsupported format "${format}". Use png, webp or jpeg.`)
  const extension = path.extname(outputPath).toLowerCase()
  if (!extension) return format ?? "png"
  const implied = OUTPUT_EXTENSIONS[extension]
  if (!implied) throw new ValidationError(`Unsupported output extension "${extension}". Use .png, .webp, .jpg or .jpeg.`)
  if (format && format !== implied)
    throw new ValidationError(`outputPath extension "${extension}" does not match format "${format}".`)
  return implied
}

interface Prepared {
  outputPath: string
  format: ImageFormat
  size: string
  quality: string
  background: string
  images: string[]
}

export async function prepare(input: GenerateInput, directory: string): Promise<Prepared> {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : ""
  if (!prompt) throw new ValidationError("prompt is required.")
  if (typeof input.outputPath !== "string" || !input.outputPath.trim()) throw new ValidationError("outputPath is required.")

  const format = resolveFormat(input.outputPath, input.format)
  const size = input.size?.trim() || "auto"
  if (size !== "auto" && !/^\d+x\d+$/.test(size))
    throw new ValidationError(`Invalid size "${size}". Use "auto" or WIDTHxHEIGHT, e.g. 1024x1024.`)
  const quality = input.quality ?? "auto"
  if (!QUALITIES.includes(quality)) throw new ValidationError(`Invalid quality "${quality}".`)
  const background = input.background ?? "auto"
  if (!BACKGROUNDS.includes(background)) throw new ValidationError(`Invalid background "${background}".`)
  if (background === "transparent" && format === "jpeg")
    throw new ValidationError("Transparent backgrounds are not supported with jpeg. Use png or webp.")

  const outputPath = path.resolve(directory, input.outputPath)
  if (!input.overwrite && (await exists(outputPath)))
    throw new ValidationError(`${outputPath} already exists. Pass overwrite: true to replace it.`)

  const images = await Promise.all((input.inputImages ?? []).map((file) => toDataUrl(path.resolve(directory, file))))
  return { outputPath, format, size, quality, background, images }
}

async function toDataUrl(file: string) {
  const mime = INPUT_MIME[path.extname(file).toLowerCase()]
  if (!mime) throw new ValidationError(`Unsupported reference image type: ${file}. Use png, jpeg, webp or gif.`)
  const info = await stat(file).catch(() => undefined)
  if (!info?.isFile()) throw new ValidationError(`Reference image not found: ${file}`)
  if (info.size > MAX_INPUT_IMAGE_BYTES) throw new ValidationError(`Reference image is larger than 20 MB: ${file}`)
  return `data:${mime};base64,${(await readFile(file)).toString("base64")}`
}

export async function generateImage(input: GenerateInput, context: GenerateContext): Promise<GenerateResult> {
  const prepared = await prepare(input, context.directory)

  context.progress?.("authenticating")
  const credential = await resolveCredential(context.credentialSources)

  const result = await requestImage(
    {
      prompt: input.prompt.trim(),
      images: prepared.images,
      format: prepared.format,
      size: prepared.size,
      quality: prepared.quality,
      background: prepared.background,
    },
    {
      credential,
      options: context.options,
      signal: context.signal,
      onStage: context.progress,
      fetch: context.fetch,
    },
  )

  context.signal?.throwIfAborted()
  context.progress?.("saving")
  const bytes = Buffer.from(result.base64, "base64")
  await mkdir(path.dirname(prepared.outputPath), { recursive: true })
  await writeFile(prepared.outputPath, bytes, input.overwrite ? undefined : { flag: "wx" })

  const mime = FORMAT_MIME[prepared.format]
  const lines = [
    `Saved image to ${prepared.outputPath}`,
    `Format: ${prepared.format}, ${bytes.byteLength} bytes`,
    ...(result.revisedPrompt ? [`Revised prompt: ${result.revisedPrompt}`] : []),
  ]
  return {
    path: prepared.outputPath,
    format: prepared.format,
    mime,
    bytes: bytes.byteLength,
    dataUrl: `data:${mime};base64,${result.base64}`,
    revisedPrompt: result.revisedPrompt,
    summary: lines.join("\n"),
  }
}
