# Claude Usage Bar

Agent-oriented repo map for the Claude Usage Bar Chrome extension.

## What This Is

Claude Usage Bar is a Chrome Manifest V3 extension that overlays Claude usage,
reset, context, cache, and pacing indicators into `https://claude.ai/*`.

The extension is privacy-conscious by design:

- It runs only on `https://claude.ai/*`.
- It calls Claude endpoints directly from the user's browser session.
- It does not send user data to developer servers.
- It does not use analytics, ads, telemetry, or tracking.
- Historical weekly learning is off by default and opt-in.

Public pages:

- Landing page: `https://ryoshkenn.github.io/Claude-Usage-Bar/`
- Privacy policy: `https://ryoshkenn.github.io/Claude-Usage-Bar/privacy-policy.html`
- Support/issues: `https://github.com/Ryoshkenn/Claude-Usage-Bar/issues`

Claude Usage Bar is not affiliated with Anthropic.

## Commands

```sh
npm install
npm test
npm run build
```

- `npm run dev` starts Vite's watch build.
- `npm run build` runs `tsc --noEmit` and writes the production extension to `dist/`.
- Load `dist/` in Chrome at `chrome://extensions` with Developer Mode enabled.

Chrome caches extension bundles aggressively. After code changes, rebuild and reload the
unpacked extension before judging browser behavior.

## Main Entry Points

| Path | Responsibility |
|---|---|
| `src/manifest.ts` | MV3 manifest source. Keep version aligned with `package.json` and `package-lock.json`. |
| `src/background/background.ts` | Service worker. Owns authenticated Claude API fetches with `credentials: "include"`. |
| `src/content/content.tsx` | Content-script lifecycle, overlay mount, settings panel wiring, cache timer, onboarding. |
| `src/content/ContentApp.tsx` | Usage bar, wheel, hover panels, pace labels, and prompt clipboard rendering. |
| `src/content/settingsPage.tsx` | Injected Claude settings panel for Usage Bar controls and public links. |
| `src/shared/storage.ts` | `DEFAULT_SETTINGS`, storage adapters, allowlist storage helpers, learned history helpers. |
| `src/shared/types.ts` | Shared TypeScript contracts. Add new settings fields here and in `DEFAULT_SETTINGS`. |
| `src/shared/claudeUsageApi.ts` | Claude usage payload normalization. |
| `src/shared/claudeConversationContext.ts` | Conversation JSON parsing and context/token estimates. |
| `src/shared/usageProjection.ts` | 5-hour and weekly pacing math. |
| `src/pageProbe/pageProbe.ts` | Page-world usage metadata probe with allowlisted output only. |
| `public/pageProbe.js` | Built/static probe entry consumed by the extension. |
| `docs/index.html` | GitHub Pages landing page. |
| `docs/privacy-policy.html` | Public Chrome Web Store privacy policy. |

## Data Flow

1. Content script detects Claude state and requests usage/context refreshes.
2. Background worker fetches Claude org, usage, routines, and conversation metadata.
3. Parsers normalize payloads into numeric/sanitized shapes.
4. Storage helpers persist only allowed extension state in `chrome.storage.local`.
5. Content UI renders the latest stored snapshot.

Stored by default:

- Settings.
- Current numeric usage/context/cache display state.
- Local message counters and sanitized usage metadata needed for the overlay.

Not stored:

- Prompts.
- Responses.
- Cookies.
- Auth headers or tokens.
- Request bodies.
- Raw Claude API payloads.
- Uploaded file contents.

Opt-in only:

- Historical weekly learning samples for smarter weekly pace estimates.

## Privacy And Chrome Web Store

The Web Store privacy policy URL must be:

```text
https://ryoshkenn.github.io/Claude-Usage-Bar/privacy-policy.html
```

Before resubmitting a release, verify GitHub Pages is serving both:

```sh
curl -I -L https://ryoshkenn.github.io/Claude-Usage-Bar/
curl -I -L https://ryoshkenn.github.io/Claude-Usage-Bar/privacy-policy.html
```

Expected: `HTTP/2 200`, not a GitHub 404 page.

If Pages is not enabled, configure the GitHub repo:

- Settings -> Pages
- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/docs`

## Settings Defaults

Important privacy defaults:

- `weeklyMetricsEnabled: false`
- `weeklyPaceMode: "manual"`

That means new installs use fixed/manual weekly pacing until the user explicitly enables
`Learn weekly patterns`. The live overlay still stores current numeric state needed to
display usage and context information.

## Release Process

For a Chrome Web Store release:

1. Align the version in:
   - `package.json`
   - `package-lock.json`
   - `src/manifest.ts`
2. Run:
   ```sh
   npm test
   npm run build
   ```
3. Zip the contents of `dist`, not the `dist` directory itself:
   ```sh
   mkdir -p release
   cd dist
   zip -r ../release/claude-usage-bar-<version>-webstore.zip . -x ".vite/*"
   cd ..
   zip -T release/claude-usage-bar-<version>-webstore.zip
   unzip -l release/claude-usage-bar-<version>-webstore.zip | head
   ```
4. Confirm `manifest.json` is at the archive root.
5. Confirm `.vite/*` is excluded.
6. Confirm the public privacy policy URL returns `200`.

Expected archive contents include `manifest.json`, `service-worker-loader.js`,
`pageProbe.js`, `icons/`, `assets/`, and `src/popup/popup.html`.

## Test Notes

- Use plain `npm test`; Vitest does not accept `--runInBand`.
- Storage tests assert the full default settings object, so update
  `src/test/storage.test.ts` when `DEFAULT_SETTINGS` changes.
- `ContentApp` tests often use explicit smart-learning fixtures even though new installs
  default to manual/no-learning.
