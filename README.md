# opencode-image-gen

OpenCode plugin that adds a `generate_image` tool. Images are generated with GPT image generation and billed to your **ChatGPT Plus/Pro subscription**, not to an OpenAI API key.

Works on OpenCode V2 and falls back to the V1 plugin API from the same package.

## Requirements

A ChatGPT login, in one of these (checked in this order):

1. OpenCode V2: `/connect` → OpenAI → **ChatGPT Pro/Plus**
2. OpenCode V1: `opencode auth login` → OpenAI → ChatGPT Pro/Plus (`~/.local/share/opencode/auth.json`)
3. Codex CLI: `codex login` (`~/.codex/auth.json`, or `$CODEX_HOME/auth.json`)

An OpenAI API key does not work here; the plugin skips API-key connections.

## Install

```jsonc
// opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-image-gen"]
}
```

For local development, point at the repository directory:

```jsonc
{ "plugins": ["/path/to/opencode-image-gen"] }
```

V1 uses the `plugin` key instead: `"plugin": ["opencode-image-gen"]`.

## Tool: `generate_image`

| Input | Required | Description |
| --- | --- | --- |
| `prompt` | yes | What to generate, or the edit to apply to `inputImages`. |
| `outputPath` | yes | Where to save the image, chosen by the agent. Relative to the session directory. The extension sets the format (`.png`, `.webp`, `.jpg`/`.jpeg`). |
| `inputImages` | no | Local images (png, jpeg, webp, gif, ≤ 20 MB) to edit or use as references. |
| `size` | no | `auto` (default) or `WIDTHxHEIGHT`, e.g. `1024x1024`, `1536x1024`, `1024x1536`. |
| `quality` | no | `low`, `medium`, `high`, `auto` (default). |
| `background` | no | `opaque`, `transparent` (png/webp only), `auto` (default). |
| `format` | no | `png`, `webp`, `jpeg`. Must match the extension. |
| `overwrite` | no | Replace an existing file. Default `false`. |

The result includes the saved path and the image itself, so vision-capable models can check what they made. To refine an image, pass the previous output as `inputImages`.

## Options

Set them as plugin options (V2: `{ "package": "opencode-image-gen", "options": { ... } }`, V1: `["opencode-image-gen", { ... }]`) or as environment variables. Plugin options take precedence.

| Option | Env var | Default |
| --- | --- | --- |
| `model` | `OPENCODE_IMAGE_GEN_MODEL` | `gpt-5.5` (model that drives the image tool) |
| `imageModel` | `OPENCODE_IMAGE_GEN_IMAGE_MODEL` | backend default (e.g. `gpt-image-2`) |
| `baseURL` | `OPENCODE_IMAGE_GEN_BASE_URL` | `https://chatgpt.com/backend-api/codex` |
| `originator` | `OPENCODE_IMAGE_GEN_ORIGINATOR` | `opencode` |
| `timeoutSec` | `OPENCODE_IMAGE_GEN_TIMEOUT_SEC` | `300` |

## How it works

The tool sends a streaming request to ChatGPT's Codex Responses backend (`/backend-api/codex/responses`) with the hosted `image_generation` tool forced, reads the base64 image from the `image_generation_call` result, and writes it to `outputPath`. Nothing is written if the request fails or is cancelled.

Tokens are never logged or returned. OpenCode V2 refreshes its own login. For file-based logins (V1, Codex) the plugin refreshes an expired token and writes it back to the same file.

## Caveats

- The Codex backend is **not a documented public API**. It can change or start rejecting third-party clients without notice.
- Using subscription credentials outside first-party clients may be against OpenAI's terms. You decide whether to use it.
- Usage counts against your ChatGPT plan limits. Rate-limit errors are returned as they are.
- The backend may not match `size` exactly. A `1024x1024` request came back as 1254×1254 in testing.

## Development

```sh
bun install
bun test
bun run typecheck
```
