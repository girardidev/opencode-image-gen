## Context

OpenCode (now V2, 2.0.x) ships an `openai` integration with "Sign in with ChatGPT" OAuth methods. That credential is accepted by ChatGPT's Codex backend (`https://chatgpt.com/backend-api/codex/responses`), which is the same Responses-API surface the Codex CLI uses for its built-in image generation. Several community tools (pi-codex-image, god-tibo-imagen, chatgpt-imagegen, codex-image-gen) confirm the request shape: hosted `image_generation` tool, `stream: true` required, one image per call, and base64 result in `image_generation_call.result`.

The endpoint is undocumented for third-party clients (openai/codex#36886), so the transport must be isolated and easy to adjust.

## Goals / Non-Goals

**Goals:**
- One `generate_image` tool usable by any agent, billed against the ChatGPT subscription.
- The agent decides where the image is written.
- Runs on V2, with a V1 fallback from the same package.
- Reuses existing logins; no new OAuth flow in the plugin.

**Non-Goals:**
- Using `OPENAI_API_KEY` / `api.openai.com` image endpoints.
- Multiple images per call (`n > 1`), partial-image previews written to disk, or masked edits.
- Multi-turn edits via `previous_response_id` (edits are done by passing the prior image as `inputImages`).
- Shelling out to `codex exec` as a fallback transport.
- TUI/CLI plugin UI.

## Decisions

### Layered modules with a thin per-version adapter

```
src/
  index.ts          default export: { ...Plugin.define({ id, setup }), server }
  v2.ts             setup(ctx): ctx.tool.transform → add generate_image; progress; file content result
  v1.ts             server(): { tool: { generate_image: tool({...zod}) } }
  generate.ts       core: validate input → resolve credential → request → extract → write file
  credentials.ts    source chain (V2 integration → V1 auth.json → ~/.codex/auth.json), refresh, JWT account ID
  transport.ts      build Responses body + headers, fetch with signal/timeout, 401 retry
  sse.ts            incremental SSE parser + image/usage/error extraction
  options.ts        merge ctx.options + env vars + defaults
```

The core takes a small interface (`{ directory, signal, progress?, getV2Credential? }`) so both adapters stay a few dozen lines. Alternative considered: two separate packages. Rejected, because the V2 docs explicitly support a combined default export and that keeps one install.

### Credentials: prefer OpenCode's own connection, read-only where possible
V2's `ctx.integration.connection.active("openai")` + `resolve()` returns a credential OpenCode keeps fresh. That avoids the refresh-token rotation race, where two owners refreshing the same token pair log each other out. File-based sources (V1 `auth.json`, `~/.codex/auth.json`) are only refreshed when expired or after a 401, and are written back atomically (write temp + rename) to the file they came from, preserving other keys. The OAuth client ID used for refresh is the public Codex client ID (`app_EMoamEEZ73f0CkXaXp7hrann`), the same one OpenCode and Codex use.

Alternative: always read `~/.codex/auth.json` like the existing libraries. Rejected as the primary source because it forces users to install and log into the Codex CLI even when OpenCode already has the login.

Open detail to confirm during implementation: the exact shape returned by `connection.resolve()` for OAuth (field names for access token, expiry, and account ID). If it lacks `accountId`, derive it from the JWT claim.

### Request shape
Headers: `Authorization: Bearer`, `ChatGPT-Account-ID`, `OpenAI-Beta: responses=experimental`, `originator: opencode`, `session_id: <uuid>`, `accept: text/event-stream`. Body: `model` (default `gpt-5.5`), `instructions: ""`, `input` (user message with `input_text` + `input_image` data URLs), `tools: [{ type: "image_generation", output_format, size, quality, background, model? }]`, `tool_choice: { type: "image_generation" }`, `parallel_tool_calls: false`, `stream: true`, `store: false`.

`originator` is set to the plugin/OpenCode name rather than impersonating `codex_cli_rs`. If the backend rejects it, the value is configurable as an escape hatch.

### SSE parsing
Use a hand-written incremental parser over `response.body` (split on blank lines, `data:` lines, JSON per event). Final images come from `response.completed.response.output[]`, with `response.output_item.done` as the fallback. Status events map to `context.progress`. Cap the buffered size (for example 64 MB) to bound memory. No dependency is needed.

### Output handling
Resolve `outputPath` against the session directory (V2: tool context / `ctx.location.directory`; V1: `context.directory`), `mkdir -p` the parent, refuse to overwrite unless `overwrite: true`, and write bytes only after a complete image is decoded, so an aborted request never leaves a partial file. The format is inferred from the extension when `format` is absent.

### Tool result
V2: `{ content: [text summary, { type: "file", mediaType, data/uri }] }`, following the `Tool.FileContent` schema, so vision-capable models can verify the image. The exact field names are checked against `/api#schema-Tool.FileContent` during implementation. V1: a plain string summary.

### Validation
V2 tool input uses JSON Schema with `additionalProperties: false`. V1 uses the `tool.schema` Zod helpers. Semantic checks (extension/format mismatch, transparent+jpeg, file exists, reference images readable) live in the core so both versions behave the same.

## Risks / Trade-offs

- [Undocumented endpoint changes or starts rejecting third-party `originator`] → transport isolated in one module; base URL, model, and originator configurable; clear error surfaced to the agent.
- [Refresh-token rotation logs out OpenCode or Codex] → prefer the V2 integration credential; refresh file sources only when needed; write back to the same file atomically.
- [Subscription rate limits / usage caps] → surface 429 bodies verbatim (sanitized); no automatic retry loops beyond the single 401 refresh.
- [Large reference images slow or fail uploads] → document a limit; reject files over 20 MB; downscaling is out of scope for now.
- [Terms-of-service gray area for subscription credentials outside first-party clients] → document it in the README; the user opts in by installing.
- [Agent writes outside the project] → V2 file writes go through normal paths; consider rejecting paths outside the session directory unless absolute paths are explicitly allowed (see open questions).
- [V1 tool cannot return image content] → V1 result is text only; acceptable for a fallback.

## Open Questions

- Should absolute paths outside the project directory be allowed for `outputPath`, or restricted to the session directory? The proposal assumes they are allowed but resolved explicitly.
- Should the tool expose an `imageModel` input (for example `gpt-image-2`) to agents, or keep it as a plugin option only? The current design keeps it plugin-only.
- Does V2 permission handling need an explicit permission request (`edit` on the output path) from inside the tool, or is tool-level permission sufficient?
