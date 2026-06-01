# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome Manifest V3 extension (Vite + TypeScript + React + CRXJS) that adds a compact usage overlay to `https://claude.ai/*`. Full architecture, behavior spec, and coding guidelines live in `AGENTS.md` — read it first.

## Commands

```sh
npm install          # install dependencies
npm run dev          # Vite/CRXJS dev server (hot reload)
npm run build        # tsc --noEmit typecheck + build → dist/
npm test             # run Vitest once
npm run test:watch   # Vitest watch mode
```

Load from `dist/` in Chrome (`chrome://extensions`, Developer Mode, Load unpacked). Permission/manifest changes require a full extension reload.

## Architecture

Data flows in one direction: **background worker → storage → content script UI**.

- `src/background/background.ts` — service worker. Owns all Claude API calls (`/api/organizations`, `/api/organizations/{id}/usage`, and current conversation JSON with `credentials: "include"`). Throttles usage refreshes to 60 s, caches org id in `chrome.storage.local`, deduplicates in-flight requests.
- `src/shared/claudeConversationContext.ts` — reconstructs the active branch from Claude conversation JSON and estimates current context from messages, attachments, files, concrete connectors/sync metadata, and prompt-cache metadata. It also calculates compounded input usage by summing the context present at each user prompt; `estimatedTokens` is the compounded display value, while `currentContextTokens` is diagnostic. It returns only numeric `ChatUsage` for storage; counted text is only returned transiently for local console debugging.
- `src/shared/claudeUsageApi.ts` — normalizes raw `/usage` JSON into `RealUsageSnapshot`. Also extracts org UUID from `/api/organizations` response.
- `src/shared/storage.ts` — allowlist-gated storage. Rejects unsafe fields (cookies, auth, raw payloads, conversation text).
- `src/shared/types.ts` — all shared TypeScript types (`RealUsageSnapshot`, `UsageMetadata`, `AppStorage`, etc.).
- `src/content/content.tsx` — mounts overlay into composer, triggers background refresh, bridges page-probe events.
- `src/content/ContentApp.tsx` — renders plan usage bar, usage hover panel, context ring, context hover panel.
- `src/content/claudeDom.ts` — fallback transcript extraction and sent-message counting. Strict selector list; do not broaden to generic textareas.
- `src/content/usageEstimator.ts` — DOM fallback token approximation. Current chat pages should prefer the background conversation JSON result.
- `src/popup/popup.tsx` — extension popup; shows status, manual refresh button.
- `public/pageProbe.js` — injected into page world; intercepts same-origin JSON, sanitizes to usage metadata, posts to content script. Fallback path, not primary.

## Key Constraints

- **Composer mounting**: find controls near the "Add files, connectors, and more" button; reject `#conversation-preferences` and settings containers.
- **Usage Bar settings route**: link to `/settings/usage-bar`, the extension-owned settings page injected into Claude settings.
- **Light mode UI**: light mode should use white/light-warm surfaces, dark gray text, muted gray supporting text, warm gray bar/wheel tracks, Claude orange fills, light hover panels, and high-contrast message rail markers.
- **Theme detection**: detect Claude page theme from explicit DOM signals first, computed Claude UI background colors second, and `prefers-color-scheme` last. Persist the detected page theme in local storage for the toolbar popup. The popup defaults to dark when no Claude page theme has been saved yet.
- **Storage allowlist**: only percentages, reset display strings, routines counters, numeric token estimates/cache metadata, settings, and cached org id. Never raw payloads, cookies, or conversation text.
- **Weekly projection settings**: `weeklyPaceMode` chooses smart learned vs manual schedule, while `weeklyEstimateDisplay` chooses active-hours vs calendar-time output. Smart mode ignores manual work days/hours/start time. Calendar-time estimates use browser-local learned day-hour buckets when available, then fall back to manual work days, active hours per day, and local `weeklyManualStartHour` only in manual mode or when learning is disabled.
- **Context counting**: prefer Claude conversation JSON over DOM text. Avoid broad fixed feature overhead from settings alone; count tool/connector/file/project data when concrete JSON evidence is present. Use a modest Claude chat prompt overhead, not Claude Code overhead. The displayed compounded usage is not discounted for prompt caching; cache metadata is stored separately as numbers.
- **Usage API shape**: `five_hour.utilization` (5-hour %), `seven_day.utilization` (weekly %), `resets_at` timestamps. See `AGENTS.md` § "Claude Usage API" for full field list.
- **No third-party calls**: only `https://claude.ai` endpoints.
- **Future tokenizer work**: README mentions planned optional Anthropic API-key support for official token counting. It is not implemented yet.
- **Large feature handoff**: after a large feature lands, update `AGENTS.md` and `CLAUDE.md` with the new behavior, architecture, commands, verification notes, or follow-up constraints before starting the next task.
- **Tests**: `src/test/` with Vitest/jsdom. Run `npm test` + `npm run build` before any PR.
