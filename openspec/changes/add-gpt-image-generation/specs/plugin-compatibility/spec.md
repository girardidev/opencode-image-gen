## ADDED Requirements

### Requirement: Single entrypoint for V2 and V1
The package's default export SHALL be one object that spreads `Plugin.define({ id, setup })` for OpenCode V2 and provides a `server()` function for OpenCode V1. Both SHALL register the same `generate_image` tool backed by shared core code.

#### Scenario: Loaded by OpenCode V2
- **WHEN** OpenCode V2 loads the plugin
- **THEN** `setup(ctx)` registers `generate_image` through `ctx.tool.transform`, and `server()` is ignored

#### Scenario: Loaded by OpenCode V1
- **WHEN** OpenCode V1 loads the plugin
- **THEN** `server()` returns `{ tool: { generate_image } }` defined with the V1 `tool()` helper

### Requirement: Plugin options
The plugin SHALL accept options (V2 `ctx.options`; V1 environment variables) for the mainline model (default `gpt-5.5`), the image model (optional, sent as the tool's `model`), the backend base URL, and the timeout. Environment variables `OPENCODE_IMAGE_GEN_MODEL`, `OPENCODE_IMAGE_GEN_IMAGE_MODEL`, `OPENCODE_IMAGE_GEN_BASE_URL`, and `OPENCODE_IMAGE_GEN_TIMEOUT_SEC` SHALL apply on both versions, with V2 options taking precedence.

#### Scenario: Custom model via V2 options
- **WHEN** `opencode.jsonc` sets `{ "package": "opencode-image-gen", "options": { "model": "gpt-5.4" } }`
- **THEN** requests use `gpt-5.4` as the top-level Responses model

### Requirement: Local and package loading
The plugin SHALL work when installed from npm (listed in `plugins`) and when loaded from a local path, without a build step (TypeScript source entrypoint).

#### Scenario: Local development
- **WHEN** a project lists the repository path under `plugins`
- **THEN** OpenCode loads the plugin and `generate_image` appears in the tool list
