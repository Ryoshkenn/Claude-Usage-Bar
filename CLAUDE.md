# Claude Usage Bar

Chrome MV3 extension (React + TypeScript + Vite via `@crxjs/vite-plugin`) that overlays
Claude usage metrics into the `claude.ai` chat composer. Privacy-first: only numeric usage
metadata is ever read or stored — never prompts, responses, cookies, or raw payloads.

Public pages:
- Landing page: `https://ryoshkenn.github.io/Claude-Usage-Bar/`
- Privacy policy: `https://ryoshkenn.github.io/Claude-Usage-Bar/privacy-policy.html`

Weekly learning is opt-in by default: `weeklyMetricsEnabled: false` and
`weeklyPaceMode: "manual"`. Core live display state still persists locally so the overlay works.

## Commands
- `npm run dev` — Vite watch build. **Use this while iterating.** After every change you
  must still reload the extension at `chrome://extensions` (Chrome caches the old bundle).
- `npm run build` — `tsc --noEmit` + production build into `dist/`.
- `npm run test` — Vitest (jsdom). Run before considering anything done.

⚠️ A stale `dist/` is the #1 footgun: if logs/behavior don't match your edits, confirm the
bundle was rebuilt (check file timestamps/hashes in `dist/assets/`) and the extension reloaded.

For Chrome Web Store releases, verify the public privacy policy URL returns `HTTP 200` before
packaging/resubmission. GitHub Pages must be enabled from `main` + `/docs`.

## Architecture
Three contexts, message-passed via `MESSAGE_TYPES` (`src/shared/constants.ts`):

- **Background worker** (`src/background/background.ts`) — the only place that calls Claude's
  authenticated APIs (`fetch` with `credentials: "include"`; 60s freshness cooldown). Fetches:
  - `GET /api/organizations/{org}/usage` → 5-hour + 7-day percentages (`normalizeUsagePayload`).
  - `GET /api/organizations/{org}/chat_conversations/{id}?...` → context tokens + prompt-cache.
  - `GET /v1/code/routines/run-budget` → routines count (see note below).
- **Content script** (`src/content/content.tsx`) — mounts React overlay (`ContentApp.tsx`) into
  the composer, the cache timer into the chat header, the settings panel (`settingsPage.tsx`),
  onboarding tour, and the user-message rail. Reads DOM usage via `claudeDom.ts`. Owns all
  render/lifecycle/theme syncing.
- **Page probe** (`src/pageProbe/pageProbe.ts`) — injected into page context to observe usage
  metadata; hard-allowlists output keys and blocks anything prompt/auth-shaped.

Shared logic in `src/shared/`: `storage.ts` (`DEFAULT_SETTINGS`, typed `chrome.storage.local`
wrappers), `types.ts` (all interfaces — `Settings`, `RealUsageSnapshot`, etc.), `claudeUsageApi.ts`
(payload parsers), `usageProjection.ts` (weekly pacing/learning), `claudeTokenizer.ts` (context
token estimation).

## Routines / run-budget (fragile)
`/v1/code/routines/run-budget` is the **`/v1` gateway**, not the `/api` web routes — it needs
extra headers or it 404s (`not_found_error`, empty `resource_id`). Required, sent from
`ROUTINES_HEADERS` + runtime org id in `background.ts`:
- `x-organization-uuid: <org id>` (from `getOrganizationId()`) — without it, 404.
- `anthropic-client-platform: web_claude_ai`, `anthropic-version: 2023-06-01`,
  `anthropic-beta: ccr-triggers-2026-01-30`.

Response is `{ limit, used, unified_billing_enabled }` with `used`/`limit` as **strings**;
`parseRunBudgetText` coerces them. Limit comes from the payload — never hardcode (Max plans
differ). The fetch is best-effort (failure doesn't sink the usage snapshot). The `anthropic-beta`
flag and client version are values Claude may bump over time — if routines silently revert to
"—", re-check those header strings against a fresh browser request first.

## Conventions
- Match surrounding CDS class strings exactly when extending the settings panel — they're copied
  verbatim from Claude's DOM (`settingsPage.tsx`).
- New `Settings` fields: add to `types.ts` **and** `DEFAULT_SETTINGS`, and update the settings
  fixtures in `storage.test.ts` and `ContentApp.test.tsx` (they assert the full object).
- Never log or persist raw API payloads; strip all debug logs before finishing.
- Two themes: every overlay style needs a `.cub-theme-light` counterpart in `styles.css`.
