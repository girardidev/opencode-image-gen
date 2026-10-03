## ADDED Requirements

### Requirement: Credential source order
The plugin SHALL resolve a ChatGPT OAuth credential (access token + account ID) from the first available source, in this order:
1. OpenCode V2: the active `openai` integration connection whose method is OAuth (`ctx.integration.connection.active("openai")` + `resolve`).
2. OpenCode V1: the `openai` entry with `type: "oauth"` in `~/.local/share/opencode/auth.json`.
3. Codex CLI: `tokens.access_token` / `tokens.account_id` in `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`).

#### Scenario: V2 integration connected
- **WHEN** the plugin runs on V2 and the `openai` integration has an active OAuth connection
- **THEN** that credential is used and the file-based sources are not read

#### Scenario: Only Codex CLI login exists
- **WHEN** no OpenCode OAuth credential is available but `~/.codex/auth.json` holds ChatGPT tokens
- **THEN** the plugin uses the Codex credential

#### Scenario: OpenAI integration uses an API key
- **WHEN** the active `openai` connection is an API key, not OAuth
- **THEN** that source is skipped, because API keys are not valid against the ChatGPT backend

### Requirement: Missing credential guidance
If no source yields a credential, the tool MUST fail with an actionable message telling the user to sign in with ChatGPT in OpenCode (`/connect` → OpenAI → ChatGPT Pro/Plus) or run `codex login`.

#### Scenario: No login anywhere
- **WHEN** none of the sources has a ChatGPT credential
- **THEN** the tool fails with the sign-in instructions and makes no network request

### Requirement: Account ID derivation
When a source provides an access token but no account ID, the plugin SHALL derive it from the JWT claim `https://api.openai.com/auth` → `chatgpt_account_id`.

#### Scenario: Account ID missing from stored credential
- **WHEN** the resolved credential has no `accountId`
- **THEN** the plugin decodes the access token payload and uses `chatgpt_account_id` for the `ChatGPT-Account-ID` header

### Requirement: Token refresh ownership
The plugin MUST NOT rotate refresh tokens it does not own. For V2 credentials it SHALL rely on OpenCode to provide a fresh token. For file-based sources, when the access token is expired, the plugin SHALL refresh it via `https://auth.openai.com/oauth/token` and atomically write the new tokens back to the same file it read them from.

#### Scenario: Expired V1 token
- **WHEN** the V1 `auth.json` OAuth entry has `expires` in the past
- **THEN** the plugin refreshes it, writes the updated `access`, `refresh`, and `expires` back to that entry, and preserves every other entry in the file

#### Scenario: 401 from backend
- **WHEN** the backend returns 401 for a file-based credential
- **THEN** the plugin refreshes once and retries the request once; a second 401 fails with the sign-in guidance

### Requirement: Secret handling
The plugin MUST NOT log, return, or include access tokens, refresh tokens, or ID tokens in tool results, errors, or plugin storage.

#### Scenario: Error message sanitization
- **WHEN** any request fails
- **THEN** the error returned to the agent contains no token material
