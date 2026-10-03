## Why

Agents running in OpenCode cannot generate images today without a separate, pay-per-image OpenAI API key. Users with a ChatGPT Plus/Pro subscription already have image generation included, and OpenCode already holds their ChatGPT OAuth credential (the `openai` integration's "Sign in with ChatGPT" connection). This plugin exposes that capability to agents as a tool, so image generation uses the subscription instead of API billing.

## What Changes

- New OpenCode plugin package (`opencode-image-gen`) whose default export supports OpenCode V2 (`Plugin.define` + `setup`) and falls back to the V1 plugin API (`server()`).
- New tool `generate_image` that agents can call with a prompt, an agent-chosen output path, and optional reference images and image options (size, quality, background, format).
- The tool calls ChatGPT's Codex Responses backend (`https://chatgpt.com/backend-api/codex/responses`) with the hosted `image_generation` tool, parses the SSE stream, decodes the base64 image, and writes it to the requested path.
- Credentials come from the user's existing ChatGPT OAuth login: the V2 `openai` integration connection first, then V1 `~/.local/share/opencode/auth.json`, then `~/.codex/auth.json`.
- The V2 tool result includes the generated image as file content so the model can see what it produced. V1 returns a text result with the saved path.

## Capabilities

### New Capabilities
- `image-generation`: The `generate_image` tool contract: inputs, output-path handling, request to the Codex backend, SSE parsing, result shape, and errors.
- `chatgpt-credentials`: How the plugin finds, validates, and refreshes the ChatGPT OAuth credential across V2, V1, and Codex CLI sources.
- `plugin-compatibility`: Packaging and loading as a single plugin entrypoint that works on OpenCode V2 and V1.

### Modified Capabilities

## Impact

- New TypeScript package: `package.json`, `src/` (plugin entry, V2 adapter, V1 adapter, transport, credentials, SSE parser).
- Dependencies: `@opencode/plugin` (V2), `@opencode-ai/plugin` (V1 tool helper / types). No OpenAI SDK; plain `fetch`.
- External system: depends on an undocumented ChatGPT backend endpoint that may change without notice.
- Files are written to the user's project at paths chosen by the agent, subject to OpenCode's permission rules.
