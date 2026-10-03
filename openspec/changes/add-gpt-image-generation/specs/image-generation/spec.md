## ADDED Requirements

### Requirement: generate_image tool
The plugin SHALL register a tool named `generate_image` that accepts:
- `prompt` (string, required): description of the image to generate or of the edit to apply.
- `outputPath` (string, required): file path where the image is written, chosen by the agent. Relative paths resolve against the session's working directory.
- `inputImages` (string[], optional): local paths of reference images to edit or draw from.
- `size` (string, optional, default `auto`): for example `1024x1024`, `1536x1024`, `1024x1536`, or `auto`.
- `quality` (`low` | `medium` | `high` | `auto`, optional, default `auto`).
- `background` (`opaque` | `transparent` | `auto`, optional, default `auto`).
- `format` (`png` | `webp` | `jpeg`, optional): defaults to the format implied by the `outputPath` extension, otherwise `png`.
- `overwrite` (boolean, optional, default `false`).

#### Scenario: Agent generates an image to a chosen path
- **WHEN** the agent calls `generate_image` with `prompt: "a red fox logo"` and `outputPath: "assets/fox.png"`
- **THEN** the plugin writes a PNG to `<session directory>/assets/fox.png`, creating missing parent directories, and returns a successful result referencing that path

#### Scenario: Missing prompt
- **WHEN** the agent calls `generate_image` without `prompt` or with an empty prompt
- **THEN** the tool fails with a validation error and makes no network request

### Requirement: Output path safety
The plugin MUST NOT overwrite an existing file unless `overwrite` is `true`, and it SHALL make sure the output extension matches the requested format.

#### Scenario: Target file exists
- **WHEN** `outputPath` points to an existing file and `overwrite` is not `true`
- **THEN** the tool fails before calling the backend with an error saying the file exists and `overwrite: true` is required

#### Scenario: Extension and format conflict
- **WHEN** `outputPath` ends in `.jpg` and `format` is `png`
- **THEN** the tool fails with a validation error describing the mismatch

#### Scenario: Transparent background with JPEG
- **WHEN** `background` is `transparent` and the resolved format is `jpeg`
- **THEN** the tool fails with a validation error before calling the backend

### Requirement: Codex Responses request
The plugin SHALL generate images by sending `POST https://chatgpt.com/backend-api/codex/responses` with `stream: true`, `store: false`, a configurable mainline model (default `gpt-5.5`), a hosted tool `{ type: "image_generation", output_format, size, quality, background }`, and `tool_choice: { type: "image_generation" }`. The user input SHALL contain the prompt as `input_text` and each reference image as an `input_image` data URL.

#### Scenario: Request carries reference images
- **WHEN** the agent passes `inputImages: ["ref/a.png"]`
- **THEN** the request input contains an `input_image` with a `data:image/png;base64,...` URL for `ref/a.png`, in addition to the prompt text

#### Scenario: Reference image missing
- **WHEN** any `inputImages` path does not exist or is not a supported image type (png, jpeg, webp, gif)
- **THEN** the tool fails with an error naming the path and makes no network request

### Requirement: SSE result extraction
The plugin SHALL parse the server-sent event stream and take the image from the `image_generation_call` item's `result` (base64). It SHALL prefer the items in `response.completed` → `response.output`, and fall back to `response.output_item.done` events. It SHALL also capture `revised_prompt` when present.

#### Scenario: Image delivered in the stream
- **WHEN** the stream contains `response.output_item.done` with `item.type == "image_generation_call"` and a non-empty `item.result`
- **THEN** the plugin decodes the base64 and writes the bytes to the output path

#### Scenario: Stream ends without an image
- **WHEN** the stream completes without any `image_generation_call` result (for example, a refusal or a text-only answer)
- **THEN** the tool fails with an error that includes any text or refusal message from the response

#### Scenario: Backend error event
- **WHEN** the stream emits `response.failed` or `error`, or the HTTP status is not 2xx
- **THEN** the tool fails with an error that includes the status and the backend's message, and never includes the access token

### Requirement: Tool result
On success, the tool SHALL return a text summary containing the absolute output path, format, byte size, and `revised_prompt` when available. The result SHALL also include the image as a `data:` URI file attachment so the model can inspect it.

#### Scenario: V2 result includes the image
- **WHEN** generation succeeds on OpenCode V2
- **THEN** the tool result contains a text part with the saved path and a file part with the image's mime type and data URI

#### Scenario: V1 result includes an attachment
- **WHEN** generation succeeds on OpenCode V1
- **THEN** the tool returns `output` with the saved absolute path and metadata, plus an `attachments` entry with the image's mime type and data URI

### Requirement: Cancellation and timeout
The plugin SHALL abort the backend request when the tool's abort signal fires, and SHALL fail after a configurable timeout (default 300 seconds).

#### Scenario: User interrupts the session
- **WHEN** the session is interrupted while an image is generating
- **THEN** the HTTP request is aborted and no file is written

#### Scenario: Timeout
- **WHEN** no completed image arrives within the timeout
- **THEN** the request is aborted and the tool fails with a timeout error

### Requirement: Progress reporting
On OpenCode V2, the plugin SHALL report progress to the tool context as the SSE stream moves through stages (for example `queued`, `generating`, `partial image`, `saving`).

#### Scenario: Generating status
- **WHEN** the stream emits `response.image_generation_call.generating`
- **THEN** the plugin calls `context.progress` with a `generating` status
