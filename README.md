# Claude Usage Bar

A privacy-conscious Chrome Manifest V3 extension that adds a compact usage overlay to `https://claude.ai/*`.

The extension uses Claude's authenticated browser session to fetch usage metadata and the current chat's conversation JSON from `claude.ai`. It stores only settings, sanitized usage metadata, and numeric context estimates in `chrome.storage.local`; prompts, responses, cookies, auth headers, request bodies, and raw response payloads are not persisted.

## Current Context Counting

For an open chat, the context ring is driven by Claude's conversation JSON rather than the rendered DOM. The background worker fetches:

```text
GET /api/organizations/{orgId}/chat_conversations/{conversationId}?tree=true&rendering_mode=messages&render_all_tools=true
```

It reconstructs the active branch from `current_leaf_message_uuid`, detects user vs assistant messages from Claude's `sender` field, then estimates the current context from:

- user and assistant message content
- nested content and tool inputs present in the conversation JSON
- extracted attachment text
- image and document metadata estimates
- connector/sync-source size metadata
- project/knowledge indicators when concrete token-size metadata is present
- prompt-cache metadata for the current branch

The estimator avoids adding large fixed feature costs just because a Claude setting is enabled. Tool, connector, file, and project costs are counted only when there is concrete JSON evidence for that chat.

Two token values are tracked:

```text
currentContextTokens = chatPromptOverhead + sum(messageTokens in active branch)

compoundedInputTokens =
  sum(currentContextTokensAtUserPrompt)
  for each user message in the active branch
```

For example, if the first user prompt is 300 tokens and the next user prompt happens after the chat has grown by another 600 tokens, compounded input is `300 + (300 + 600) = 1,200`. Assistant text is included once it exists in the branch, so it is included in later user prompts.

The displayed ring uses `compoundedInputTokens` as the main usage value. `currentContextTokens` is still shown as a diagnostic in the hover panel. Prompt caching is detected and stored as numeric metadata (`cachedPrefixTokens`, `cacheExpiresAt`), but neither value is discounted for caching because cached tokens are still present in the model context.

The current tokenizer is still an estimate. Anthropic's official guidance is that the `messages/count_tokens` endpoint accepts the same structured inputs as message creation, including system prompts, tools, images, and PDFs, and returns estimated input tokens. Anthropic also notes counts may include automatically added system-optimization tokens, but billing reflects only user content. Until official counting is added, the extension uses a modest `1,000` token chat prompt overhead instead of the much larger Claude Code-style overheads. Future versions will add optional Anthropic API-key support for the official endpoint and richer file/token accounting.

## Settings & Onboarding

The extension injects its own settings page into Claude's settings UI at `/settings/usage-bar`. From there you can configure the weekly-usage projection — `weeklyPaceMode` (smart learned vs. manual schedule) and `weeklyEstimateDisplay` (active-hours vs. calendar-time) — clear learned weekly history, and replay the onboarding tour.

First-time users get an onboarding tooltip tour with an animated walkthrough and navigation controls; it can be replayed any time from the settings page.

## Development

```sh
npm install
npm run dev
```

For a packaged build:

```sh
npm run build
```

Load the generated `dist/` directory in Chrome at `chrome://extensions` with Developer Mode enabled.

## Manual Checklist

- Run `npm test` and `npm run build`.
- Load unpacked `dist/` in Chrome.
- Open `https://claude.ai/`.
- Confirm the overlay appears only on Claude.
- Send a test message and confirm local message/token estimates update.
- Open DevTools on Claude and confirm the conversation API token debug group logs the text parts counted for the current chat.
- Toggle show/hide and compact/expanded in the popup.
- Reset usage from the popup.
- Inspect `chrome.storage.local` and verify no conversation text, auth data, cookies, or raw response bodies are stored.

## How Usage Is Detected

The overlay uses these sources:

- Claude's `/usage` API for 5-hour, weekly, Claude Design, and routines usage metadata.
- Claude's current conversation JSON for the context ring.
- Visible Claude UI text for model labels, reset windows, and fallback limit text.
- A page-world probe that sanitizes same-origin JSON responses down to allowlisted usage metadata before posting it to the content script.
- A DOM transcript estimator only as a fallback when no conversation id is available.
