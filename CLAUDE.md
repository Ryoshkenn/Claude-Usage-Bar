# Claude Usage Bar

Chrome MV3 extension (React + TypeScript + Vite via `@crxjs/vite-plugin`) that overlays
Claude usage metrics into the `claude.ai` chat composer. Privacy-first: only numeric usage
metadata is ever read or stored — never prompts, responses, cookies, or raw payloads.

Public pages:
- GitHub: `https://github.com/Ryoshkenn/Claude-Usage-Bar`
- Privacy policy: `https://sites.google.com/view/claude-usage-bar-privacy/home`

Weekly learning is **on by default** (`weeklyMetricsEnabled: true`). Learning is local-only — it
records numeric usage samples in `chrome.storage.local` to model your pacing, and nothing leaves the
machine. The **Pacing** switch in the settings panel controls both `showPace` and
`weeklyMetricsEnabled`, so turning pace estimates off also stops collection. There is no manual
pacing mode any more; `weeklyManual*` survive only as the hidden fallback schedule used while
learning (or with learning off).
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
test passes `force: true`, which skips the once-only dedupe and the unused-window check but still
honours scope — so a broken scope shows up in testing instead of
being masked.

Scope is `settings.resetBannerScope`: `"off"` | `"claude"` (default, no extra permission) |
`"everywhere"`, and it covers both windows — there are no per-window toggles. `"everywhere"` needs the **optional** `*://*/*` host permission, declared under
`optional_host_permissions` rather than `host_permissions` on purpose — a required all-sites
permission would disable the extension for every existing install until each user re-accepted it.
`chrome.permissions.request()` can't run in a content script (and needs a user gesture on an
extension page), so choosing "Any site" messages the worker, which opens `src/grant/grant.html`
in a small popup window to collect the grant. That page is **not** referenced from the manifest,
so crxjs can't discover it — it's an explicit `rollupOptions.input` entry in `vite.config.ts`.
Verify `dist/src/grant/grant.html` still emits after touching the build config.

⚠️ `optional_host_permissions` is spread in with a cast in `manifest.ts` — `@crxjs/vite-plugin`'s
types predate it. Verify it survives into `dist/manifest.json` after touching that file.

### Thread sidebar (`src/content/threadSidebar.ts`)
Optional T3-style sidebar (`settings.threadSidebar`, off by default, under **Sidebar** in the
settings panel): pinned, live (working / waiting / done / unread) and the N most recent threads
become cards, the rest fold under "Settled (N)", pinned projects are hidden (they stay under
Projects), Claude's nav rows fold into one "Projects & tools" row, and a Search / sort / new-chat row
sits at the top (beside Claude's own search bar when the layout has one; Search and New always drive
Claude's own controls). Claude's sidebar is React we don't own, so the module never moves, clones or
re-parents its nodes — it sets `data-cub-thread*` attributes and an inline `order` per row, and
`threadSidebar.css` sections the rows inside the sidebar's scroll column (wrappers in between are
flattened with `display: contents`). Its own nodes are the two toggles, the top row / actions and a
`.cub-thread-meta` line inside each card. Turning it off strips everything, and tests assert the DOM
is byte-identical afterwards — keep it that way. Text uses Claude's CDS tokens; the only per-theme
values are the surface tints keyed off `data-cub-threads-theme` (set from `syncTheme`).

Live state is read from Claude's own markers: `.status-dot[data-kind=running|clay|awaiting|error|ready|unread]`,
`[data-unread-mark]`, and rows under the `label:unread-unread` group. Don't put a `::before` on
`[data-row-main-button]`: Claude uses it for the row's hit area. Claude Code sessions are only in the
DOM while the sidebar is in Code mode; nothing merges them into the chat list.

"Done" is ours: a row this tab saw working that stops while you weren't looking at it. The marks
live in `chrome.storage.session` (`threadActivity`, row keys + timestamps only, shared by every
claude.ai tab; the worker opens that area to content scripts with `setAccessLevel`). The transition
is sent to the worker (`MESSAGE_TYPES.threadDone`), which banners the active tab of each window per
`settings.threadDoneAlerts` (`src/background/threadNotifier.ts`) — one-shot, deduped across tabs,
never stored. The banner carries the thread title only to label itself, inside a closed shadow root
in the isolated world; "Any site" reuses the reset alerts' optional all-sites grant
(`grant.html?purpose=threads`).

Sorting ("newest edited" / "newest created") uses timestamps the page probe lifts from Claude's own
**list** responses (`MESSAGE_TYPES.threadTimes`): ids and created/updated times only — never names
or titles — and single-thread endpoints are skipped because they carry the transcript. The shipped
probe is `public/pageProbe.js`; `src/pageProbe/pageProbe.ts` mirrors it, so change both.

Shared logic in `src/shared/`: `storage.ts` (`DEFAULT_SETTINGS`, typed `chrome.storage.local`
wrappers), `types.ts` (all interfaces — `Settings`, `RealUsageSnapshot`, etc.), `claudeUsageApi.ts`
(payload parsers), `usageProjection.ts` (weekly pacing/learning), `claudeTokenizer.ts` (context
token estimation).

## Conventions
- Match surrounding CDS class strings exactly when extending the settings panel — they're copied
  verbatim from Claude's DOM (`settingsPage.tsx`).
- New `Settings` fields: add to `types.ts` **and** `DEFAULT_SETTINGS`, and update the settings
  fixtures in `storage.test.ts` and `ContentApp.test.tsx` (they assert the full object).
- Removing a `Settings` field: strip it in `migrateSettings` (`storage.ts`) so the next write drops
  it from storage, mapping any stored value that still matters onto the remaining settings.
- Never log or persist raw API payloads; strip all debug logs before finishing.
- Two themes: every overlay style needs a `.cub-theme-light` counterpart in `styles.css`.
- i18n: wrap user-facing strings with `t("key", "English fallback", subs?)` from `src/shared/i18n.ts`
  (positional `$1`..`$9` placeholders). Catalogs are `src/locales/<lang>.json` (Chrome message format,
  bundled at build — not chrome.i18n). Add the key to **every** catalog; resolution is active language →
  English catalog → inline fallback, so partial coverage is safe. The active language is the `language`
  setting (default `"en"`, user-picked under General), applied via `setLanguage()` when storage loads in
  `content.tsx` and `popup.tsx` — NOT the browser locale. New languages: add a `src/locales/<lang>.json`
  and an entry in `SUPPORTED_LANGUAGES`. Brand names (Claude, Opus/Sonnet/Haiku, Usage Bar) stay untranslated.
