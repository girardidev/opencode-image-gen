export interface Options {
  /** Top-level Responses model that drives the hosted image_generation tool. */
  model: string
  /** Optional image model sent inside the image_generation tool (e.g. "gpt-image-2"). */
  imageModel?: string
  /** Codex backend base URL; `/responses` is appended. */
  baseURL: string
  originator: string
  timeoutMs: number
}

export const DEFAULTS: Options = {
  model: "gpt-5.5",
  baseURL: "https://chatgpt.com/backend-api/codex",
  originator: "opencode",
  timeoutMs: 300_000,
}

type Source = Record<string, unknown>

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

const seconds = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : undefined
}

export function resolveOptions(pluginOptions: Source = {}, env: Source = process.env): Options {
  return {
    model: str(pluginOptions.model) ?? str(env.OPENCODE_IMAGE_GEN_MODEL) ?? DEFAULTS.model,
    imageModel: str(pluginOptions.imageModel) ?? str(env.OPENCODE_IMAGE_GEN_IMAGE_MODEL),
    baseURL: (str(pluginOptions.baseURL) ?? str(env.OPENCODE_IMAGE_GEN_BASE_URL) ?? DEFAULTS.baseURL).replace(/\/+$/, ""),
    originator: str(pluginOptions.originator) ?? str(env.OPENCODE_IMAGE_GEN_ORIGINATOR) ?? DEFAULTS.originator,
    timeoutMs: seconds(pluginOptions.timeoutSec) ?? seconds(env.OPENCODE_IMAGE_GEN_TIMEOUT_SEC) ?? DEFAULTS.timeoutMs,
  }
}
