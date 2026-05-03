# Claude Usage Bar

A privacy-conscious Chrome Manifest V3 extension that adds a compact local usage overlay to `https://claude.ai/*`.

The extension never sends data anywhere. It stores only settings and usage metadata in `chrome.storage.local`; prompts, responses, cookies, auth headers, request bodies, and raw response payloads are not persisted.

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
- Toggle show/hide and compact/expanded in the popup.
- Reset usage from the popup.
- Inspect `chrome.storage.local` and verify no conversation text, auth data, cookies, or raw response bodies are stored.

## How Usage Is Detected

The overlay uses three local-only sources:

- Visible Claude UI text for model labels, reset windows, and visible limit text.
- A page-world probe that sanitizes same-origin JSON responses down to allowlisted usage metadata before posting it to the content script.
- A fallback estimator that counts visible sent user messages and estimates current-chat tokens from visible text length without storing the text.
