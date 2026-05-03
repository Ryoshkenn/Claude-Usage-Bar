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

- `src/background/background.ts` — service worker. Owns all Claude API calls (`/api/organizations`, `/api/organizations/{id}/usage` with `credentials: "include"`). Throttles to 60 s, caches org id in `chrome.storage.local`, deduplicates in-flight requests.
- `src/shared/claudeUsageApi.ts` — normalizes raw `/usage` JSON into `RealUsageSnapshot`. Also extracts org UUID from `/api/organizations` response.
- `src/shared/storage.ts` — allowlist-gated storage. Rejects unsafe fields (cookies, auth, raw payloads, conversation text).
- `src/shared/types.ts` — all shared TypeScript types (`RealUsageSnapshot`, `UsageMetadata`, `AppStorage`, etc.).
- `src/content/content.tsx` — mounts overlay into composer, triggers background refresh, bridges page-probe events.
- `src/content/ContentApp.tsx` — renders plan usage bar, usage hover panel, context ring, context hover panel.
- `src/content/claudeDom.ts` — extracts transcript text from DOM for token estimation. Strict selector list; do not broaden to generic textareas.
- `src/content/usageEstimator.ts` — local `text.length / 4` token approximation. Never stores text.
- `src/popup/popup.tsx` — extension popup; shows status, manual refresh button.
- `public/pageProbe.js` — injected into page world; intercepts same-origin JSON, sanitizes to usage metadata, posts to content script. Fallback path, not primary.

## Key Constraints

- **Composer mounting**: find controls near the "Add files, connectors, and more" button; reject `#conversation-preferences` and settings containers.
- **Storage allowlist**: only percentages, reset display strings, routines counters, numeric token estimates, settings, and cached org id. Never raw payloads, cookies, or conversation text.
- **Usage API shape**: `five_hour.utilization` (5-hour %), `seven_day.utilization` (weekly %), `resets_at` timestamps. See `AGENTS.md` § "Claude Usage API" for full field list.
- **No third-party calls**: only `https://claude.ai` endpoints.
- **Tests**: `src/test/` with Vitest/jsdom. Run `npm test` + `npm run build` before any PR.
