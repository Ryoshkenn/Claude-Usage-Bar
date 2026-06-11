# Claude Usage Bar

Claude Usage Bar is a Chrome extension that adds compact Claude usage indicators
directly inside `claude.ai`.

It is designed for people who want a quick view of usage, reset timing, context,
cache, and pacing information without leaving the Claude page.

Claude Usage Bar is not affiliated with Anthropic.

## Features

- View Claude usage and reset information while using Claude.
- See estimated context usage for the active conversation.
- Track cache and pacing indicators in the same compact overlay.
- Optionally enable local weekly learning for smarter pace estimates.
- Keep weekly learning off by default unless you choose to enable it.

## Privacy

Claude Usage Bar is built to keep data local and limited to the extension's
purpose.

- It runs only on `https://claude.ai/*`.
- It does not send user data anywhere except the Claude requests needed for the
  extension's usage display.
- It does not use analytics, ads, telemetry, or tracking.
- It uses your existing logged-in Claude browser session to request usage data
  from Claude.
- Conversation content may be processed locally in your browser to estimate
  context usage.
- It does not store prompts, responses, uploaded file contents, cookies,
  passwords, authorization headers, or authentication tokens.
- Optional weekly learning history is stored locally only when you enable it.

Read the full [privacy policy](docs/privacy-policy.html).

## Installation

Install Claude Usage Bar from the Chrome Web Store when available.

For manual installation from a release package:

1. Download the latest release package.
2. Open `chrome://extensions`.
3. Enable Developer Mode.
4. Choose "Load unpacked".
5. Select the extracted extension folder.
6. Open or refresh `https://claude.ai`.

## Usage

After installation, Claude Usage Bar appears inside Claude when the extension can
read usage information from your active browser session.

You can change display options from the extension controls inside Claude. Weekly
learning stays disabled until you turn it on.

## Support

For bugs, questions, or feature requests, open an issue in this repository.

Please include:

- What happened.
- What you expected to happen.
- Your browser version.
- Whether the issue happens after refreshing Claude.

Do not include private prompts, responses, files, cookies, tokens, or account
credentials in public issue reports.

## Contributing

Contributions are welcome. Before opening a pull request, please make sure the
change matches the extension's privacy goals and keeps user data handling clear.
