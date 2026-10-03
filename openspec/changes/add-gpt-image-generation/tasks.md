## 1. Project setup

- [ ] 1.1 Initialize git repo and `package.json` (`type: module`, `exports: { ".": "./src/index.ts" }`, deps `@opencode/plugin`, `@opencode-ai/plugin`)
- [ ] 1.2 Add `tsconfig.json`, Bun test setup, and `.gitignore`
- [ ] 1.3 Confirm V2 `Tool.FileContent` and OAuth `connection.resolve()` shapes against the running server (`opencode api get /openapi.json`) and record them in design.md

## 2. Core: options and credentials

- [ ] 2.1 Implement `src/options.ts` (defaults, env vars, V2 options precedence)
- [ ] 2.2 Implement JWT `chatgpt_account_id` extraction
- [ ] 2.3 Implement V2 integration credential source (OAuth only; skip API keys)
- [ ] 2.4 Implement V1 `~/.local/share/opencode/auth.json` source with expiry check, refresh, and atomic write-back preserving other entries
- [ ] 2.5 Implement `~/.codex/auth.json` (`$CODEX_HOME`) source with refresh and atomic write-back
- [ ] 2.6 Implement the source chain plus the "no credential" error with sign-in guidance
- [ ] 2.7 Unit tests for the source order, expired-token refresh, account ID derivation, and secret-free errors

## 3. Core: transport and SSE

- [ ] 3.1 Implement `src/sse.ts` incremental parser with size cap
- [ ] 3.2 Implement image extraction (`response.completed` first, `output_item.done` fallback), `revised_prompt`, text/refusal capture, and error events
- [ ] 3.3 Implement `src/transport.ts` (headers, body builder, abort signal + timeout, single 401 refresh-and-retry, sanitized HTTP errors)
- [ ] 3.4 Unit tests for SSE fixtures: success, no image, `response.failed`, chunk boundaries splitting events

## 4. Core: generate

- [ ] 4.1 Implement input validation (prompt, format/extension, transparent+jpeg, overwrite, reference image existence/type/size)
- [ ] 4.2 Implement reference images → `input_image` data URLs
- [ ] 4.3 Implement output path resolution, `mkdir -p`, and write-after-complete
- [ ] 4.4 Implement the progress callback mapping from SSE status events
- [ ] 4.5 Unit tests for `generate` with a mocked `fetch`

## 5. Adapters

- [ ] 5.1 Implement `src/v2.ts`: `ctx.tool.transform` registration, JSON Schema input, `context.signal`, `context.progress`, text + file content result
- [ ] 5.2 Implement `src/v1.ts`: `server()` returning `{ tool: { generate_image } }` with Zod args and a string result
- [ ] 5.3 Implement `src/index.ts` combined default export (`...Plugin.define(...)`, `server`)

## 6. Verification and docs

- [ ] 6.1 Load the plugin locally in OpenCode V2 via `plugins: ["<repo path>"]` and confirm `generate_image` is listed
- [ ] 6.2 Manual end-to-end: generate an image to an agent-chosen path; edit it using `inputImages`
- [ ] 6.3 Smoke test on OpenCode V1 (1.18.x) with the same package
- [ ] 6.4 Write README: install, ChatGPT sign-in requirement, options/env vars, tool reference, endpoint-stability and ToS caveats
