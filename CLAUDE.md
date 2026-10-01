# Claude Usage Bar

Chrome MV3 extension (React + TypeScript + Vite via `@crxjs/vite-plugin`) that overlays
Claude usage metrics into the `claude.ai` chat composer. Privacy-first: only numeric usage
metadata is ever read or stored — never prompts, responses, cookies, or raw payloads.

Public pages:
- GitHub: `https://github.com/Ryoshkenn/Claude-Usage-Bar`
- Privacy policy: `https://sites.google.com/view/claude-usage-bar-privacy/home`

Weekly learning is **on by default**: `weeklyMetricsEnabled: true` and `weeklyPaceMode: "smart"`
(`weeklyManualActiveHoursPerDay: 5`). Learning is local-only — it records numeric usage samples
in `chrome.storage.local` to model your pacing, and nothing leaves the machine. Users can turn it
off under Weekly in the settings panel, which drops the pace estimate back to the manual schedule.
Core live display state persists locally regardless so the overlay works.

## Commands
- `npm run dev` — Vite watch build. **Use this while iterating.** After every change you
  must still reload the extension at `chrome://extensions` (Chrome caches the old bundle).
- `npm run build` — `tsc --noEmit` + production build into `dist/`.
- `npm run test` — Vitest (jsdom). Run before considering anything done.

⚠️ A stale `dist/` is the #1 footgun: if logs/behavior don't match your edits, confirm the
bundle was rebuilt (check file timestamps/hashes in `dist/assets/`) and the extension reloaded.

For Chrome Web Store releases, verify the public privacy policy URL returns `HTTP 200` before
packaging/resubmission.

## Architecture
Three contexts, message-passed via `MESSAGE_TYPES` (`src/shared/constants.ts`):

- **Background worker** (`src/background/background.ts`) — the only place that calls Claude's
  authenticated APIs (`fetch` with `credentials: "include"`; 60s freshness cooldown). Fetches:
  - `GET /api/organizations/{org}/usage` → 5-hour + 7-day percentages (`normalizeUsagePayload`).
  - `GET /api/organizations/{org}/chat_conversations/{id}?...` → context tokens + prompt-cache.
- **Content script** (`src/content/content.tsx`) — mounts React overlay (`ContentApp.tsx`) into
  the composer, the cache timer into the chat header, the settings panel (`settingsPage.tsx`),
  onboarding tour, and the user-message rail. Reads DOM usage via `claudeDom.ts`. Owns all
  render/lifecycle/theme syncing.
- **Page probe** (`src/pageProbe/pageProbe.ts`) — injected into page context to observe usage
  metadata; hard-allowlists output keys and blocks anything prompt/auth-shaped.

### Reset banners (`src/background/resetNotifier.ts`)
`chrome.alarms` fires at each `resetsAt`; MV3 kills the worker after ~30s idle, so `setTimeout`
can never reach a reset hours out. On wake the worker **re-fetches and confirms the reset time
actually moved forward** before announcing — the alarm alone only proves the clock passed, not
that the window rolled over. A confirmed rollover injects a shadow-DOM banner via
`chrome.scripting.executeScript({func})` (no bundled entry point needed) into the tabs open at
that moment. The banner lives 10s and that is the end of it.

**The announcement is one-shot by design.** Nothing is persisted, so tabs opened later never see
it. An earlier version stored a `pendingResetNotice` and replayed it via `chrome.tabs.onUpdated`
so pages opened after the rollover still got the banner — in practice that meant the banner
reappearing on every new page for hours, which reads as a bug. The only thing written to storage
is `announcedResets` (dedupe by `resetAt`, so a retrying alarm can't double-announce), and a test
asserts storage holds nothing else. Do not reintroduce a replayable notice.

The toolbar icon is never touched; `chrome.action` is absent from the test stub so a badge call
would throw rather than pass silently.

A rollover is only announced if the **closing** window was actually used
(`usedPercentBeforeReset >= 1`). Resetting from 0% changes nothing the user can see, and the
5-hour window rolls over all night regardless of activity. That number must be read from the
snapshot taken *before* the confirming fetch — afterwards it's already the new window's zero and
every banner would be suppressed. `undefined` announces, so unknown state never eats a real reset.

Controls live in the injected settings panel under **Reset alerts** (`settingsPage.tsx`), including
a "Send test" button that fires the real path after 5s via `MESSAGE_TYPES.testResetBanner`. The
test passes `force: true`, which skips the per-window toggles, the once-only dedupe, and the
unused-window check but still honours scope — so a broken scope shows up in testing instead of
being masked.

Scope is `settings.resetBannerScope`: `"off"` | `"claude"` (default, no extra permission) |
`"everywhere"`. `"everywhere"` needs the **optional** `*://*/*` host permission, declared under
`optional_host_permissions` rather than `host_permissions` on purpose — a required all-sites
permission would disable the extension for every existing install until each user re-accepted it.
`chrome.permissions.request()` can't run in a content script (and needs a user gesture on an
extension page), so choosing "Any site" messages the worker, which opens `src/grant/grant.html`
in a small popup window to collect the grant. That page is **not** referenced from the manifest,
so crxjs can't discover it — it's an explicit `rollupOptions.input` entry in `vite.config.ts`.
Verify `dist/src/grant/grant.html` still emits after touching the build config.

⚠️ `optional_host_permissions` is spread in with a cast in `manifest.ts` — `@crxjs/vite-plugin`'s
types predate it. Verify it survives into `dist/manifest.json` after touching that file.

Shared logic in `src/shared/`: `storage.ts` (`DEFAULT_SETTINGS`, typed `chrome.storage.local`
wrappers), `types.ts` (all interfaces — `Settings`, `RealUsageSnapshot`, etc.), `claudeUsageApi.ts`
(payload parsers), `usageProjection.ts` (weekly pacing/learning), `claudeTokenizer.ts` (context
token estimation).

## Conventions
- Match surrounding CDS class strings exactly when extending the settings panel — they're copied
  verbatim from Claude's DOM (`settingsPage.tsx`).
- New `Settings` fields: add to `types.ts` **and** `DEFAULT_SETTINGS`, and update the settings
  fixtures in `storage.test.ts` and `ContentApp.test.tsx` (they assert the full object).
- Never log or persist raw API payloads; strip all debug logs before finishing.
- Two themes: every overlay style needs a `.cub-theme-light` counterpart in `styles.css`.
- i18n: wrap user-facing strings with `t("key", "English fallback", subs?)` from `src/shared/i18n.ts`
  (positional `$1`..`$9` placeholders). Catalogs are `src/locales/<lang>.json` (Chrome message format,
  bundled at build — not chrome.i18n). Add the key to **every** catalog; resolution is active language →
  English catalog → inline fallback, so partial coverage is safe. The active language is the `language`
  setting (default `"en"`, user-picked under General), applied via `setLanguage()` when storage loads in
  `content.tsx` and `popup.tsx` — NOT the browser locale. New languages: add a `src/locales/<lang>.json`
  and an entry in `SUPPORTED_LANGUAGES`. Brand names (Claude, Opus/Sonnet/Haiku, Usage Bar) stay untranslated.
