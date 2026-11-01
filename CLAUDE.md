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
Restarting the browser is not enough for the background worker: Chrome keeps running its cached
copy of the worker script until the extension itself is reloaded, so worker changes silently don't
apply while pages and the popup do. Check which `background.ts-<hash>.js` the worker actually parsed.

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

### Where the overlay attaches (`composerMount.ts`, `settingsPage.tsx`)
Every composer goes through `mountHostInChin`: a body-level fixed overlay in the widest free gap of
the composer's control row, or its own row (a spacer appended to the composer) when it doesn't fit.
The row comes from one of three finders, tried in order:
- `findChinSlot` — `[data-cds="ChatComposerChin"]` inside `[data-cds="ChatComposer"]` (chats, and
  one of the two `/new` layouts).
- `findToolbarSlot` — the other `/new` layout (Oct 2026): a `<fieldset>` card with no
  ChatComposer markers whose toolbar row holds `chat-input-attach` and `model-selector-dropdown`.
  Claude serves both `/new` layouts, apparently at random — check both after a DOM change.
- `findDesignSlot` — Claude Design's home composer (`/design`): the chip row around the model picker.

The settings nav item anchors on Claude's `li[data-testid]`s (labels get renamed — "General" became
"Appearance" but kept `general-settings`) and sits after `usage-settings`. While our panel shows,
`data-cub-panel-active` on the `<nav>` mutes Claude's still-`aria-current` item in `styles.css`.

### Onboarding tour (`OnboardingTour.tsx`, previews in `tourPreviews.tsx`)
Runs on `/new` while `hasSeenTour` is false (Settings → General → Replay Tour). The cache timer and
thread view steps are choices ("No thanks" / "Use it") that write the setting; finishing or skipping
sets `showBar: true` as well. The tour layer is z 2147483647; while it holds the details panel open
(`body.cub-tour-bar-open`) the bar host sits at 2147483646, one below, so the spotlight ring around
the settings arrow draws over the panel rather than under it.

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
settings panel; the tour offers it). Turning it on opens the 3 latest threads of the list on screen
as cards (`SEED_OPEN_COUNT`, once per list — `threadPlaces.seeded` records "chat" / "code"; places
stored before seeding existed count the chat list as seeded) and settles the rest under a "Settled (N)"
bar; a thread becomes a card once it has activity after that — seen working or done in any tab, a
live mark from Claude, or an `updated_at` past the baseline (which also catches chats made on another
device) — and stays one, uncapped, until its hover Settle button files it back (until its next
activity). Live ones lead, by `LIVE_ORDER_BASE`: waiting on you (or error), then done / unread, then
working; then pinned threads; then the other cards. A pinned thread with a live status sits with the
live ones.

Claude keeps the chat list and the Code session list in the sidebar at once (`[data-kind="cowork"]` /
`.df-session-list[data-kind="code"]` under `.dframe-recents-by-mode[data-mode]`) and hides the other
mode's with an inline `display: none !important`. The module works on whichever list is displayed
(`shownList`), and New in Code mode is Claude's `a[href="/code"]` row (both carry Ctrl+Shift+O). The Settled bar is `position: sticky` at the bottom of the scroll
column (pushed there with `margin-top: auto` when the cards are few) and also at the top while
open; it paints the sidebar's own computed background so rows can pass under it, and opening it
over a long list scrolls its rows into view. Pinned projects are hidden (they stay under Projects), Claude's nav rows fold into
one "Projects & tools" row, and a T3-style Search / sort / new-chat row sits at the top — in place of
Claude's top search bar when the layout shows one (only a *visible*, bar-wide match is replaced),
else of the New row. Search and New always drive Claude's own controls. Claude's sidebar is React we don't own, so the module never moves, clones or
re-parents its nodes — it sets `data-cub-thread*` attributes and an inline `order` per row, and
`threadSidebar.css` sections the rows inside the sidebar's scroll column (wrappers in between are
flattened with `display: contents`). Its own nodes are the two toggles, the top row, and a
`.cub-thread-meta` line and `.cub-thread-settle` button on each card. Turning it off strips everything, and tests assert the DOM
is byte-identical afterwards — keep it that way. Text uses Claude's CDS tokens; the only per-theme
values are the surface tints keyed off `data-cub-threads-theme` (set from `syncTheme`).

Live state is read from Claude's own markers: `.status-dot[data-kind=running|clay|awaiting|error|ready|unread]`,
`[data-unread-mark]`, and rows under the `label:unread-unread` group. Don't put a `::before` on
`[data-row-main-button]`: Claude uses it for the row's hit area. Claude Code sessions are only in the
DOM while the sidebar is in Code mode; nothing merges them into the chat list.

"Done" is ours: a row seen working that stops while you weren't looking at it. The marks live in
`chrome.storage.local` (`threadActivity`, row keys + timestamps only, shared by every claude.ai tab,
expiring after a day) so they survive reloads and restarts; a working mark whose tab is gone shows the
thread as done, and opening the thread clears it (after a few seconds of page load, while the sidebar
may not show its working dot yet). Placement lives there too (`threadPlaces`: `since` — when the view
was turned on, the baseline every thread counts as settled at — plus `open` and hand-`settled` maps of
row key → time, and `seeded`). Turning the view off removes both, so turning it on again starts over.
Nothing opens until places have loaded, or a page load would judge activity against a made-up
baseline; likewise nothing is tracked until the activity marks have loaded.

Tabs never write either store themselves. chrome.storage has no transactions, so two tabs each
reading, merging and writing lost each other's changes. Each tab only writes when its own sidebar's
state changes, and sends the worker per-key patches (`MESSAGE_TYPES.threadActivityPatch` /
`threadPlacesPatch` / `threadPlacesForget`); `src/shared/threadStore.ts` applies them through one
queue (activity per key, places newest-time-per-key), and drops a places patch once the view is off.
A patch that fails stays pending in the tab and is retried. Apart from Claude's language tag
(`claudeLanguage`, e.g. "fr-FR") and the user's own clipboard prompts, those row keys are the only
non-numeric thing the extension stores. There is deliberately no "task finished" banner — it was
tried and removed.

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
  verbatim from Claude's DOM (`settingsPage.tsx`). Dropdowns use `CdsSelect`, our own menu: don't
  go back to a native `<select>` overlaid on the CDS trigger — it relied on Claude's utility classes
  to stay invisible and opened the OS menu wherever the browser put it. The menu portals into
  `#cub-settings-panel` because the nested option groups clip (`overflow: hidden`).
- New `Settings` fields: add to `types.ts` **and** `DEFAULT_SETTINGS`, and update the settings
  fixtures in `storage.test.ts` and `ContentApp.test.tsx` (they assert the full object).
- Removing a `Settings` field: strip it in `migrateSettings` (`storage.ts`) so the next write drops
  it from storage, mapping any stored value that still matters onto the remaining settings.
- Never log or persist raw API payloads; strip all debug logs before finishing.
- Two themes: every overlay style needs a `.cub-theme-light` counterpart in `styles.css`.
- i18n: wrap user-facing strings with `t("key", "English fallback", subs?)` from `src/shared/i18n.ts`
  (positional `$1`..`$9` placeholders). Catalogs are `src/locales/<lang>.json` (Chrome message format,
  bundled at build — not chrome.i18n). Resolution is active language → English catalog → inline fallback,
  but `i18n.test.ts` requires every catalog to carry exactly en.json's keys and `$n` placeholders, so add a
  new key to **every** catalog. There is no language setting (the old `language` field is stripped in
  `migrateSettings`): the UI follows Claude's own language, NOT the browser locale. The content script reads
  `<html lang>` on claude.ai (and watches the attribute — Claude switches without a reload), calls
  `setLanguage(tag)`, and mirrors the tag to `STORAGE_KEYS.claudeLanguage`; the popup, grant page and worker
  can't see the page, so they read it back with `getClaudeLanguage()`. React UI that outlives a switch
  re-renders via `useSyncExternalStore(onLanguageChange, getLanguage)`. `catalogForTag()` maps the BCP-47 tag
  to a catalog (explicit `TAG_TO_CATALOG` → exact catalog name → base language → `en`). Every language in
  Claude's language picker has a catalog (es-419 and es-ES share `es`); if Claude adds one, add
  `src/locales/<lang>.json`, import it into `CATALOGS`, and map the tag if it isn't a catalog name or base
  language. Brand names (Claude, Claude Code, Cowork, Opus/Sonnet/Haiku/Fable, Usage Bar, Chrome, GitHub) stay
  untranslated.
