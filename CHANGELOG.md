# Changelog

All notable changes since the 1.0.0 Chrome Web Store release are documented here.

## [1.5.0] - 2026-10-06

### Added
- Added a "Percentage at reset" option for the weekly estimate. It projects where your weekly usage will land at reset, using the days and hours you usually use Claude once those are learned.
- Added a percentage display for the context window indicator, as an alternative to the ring.
- Reset banners can now be swiped away to the right with a two-finger trackpad swipe.

### Changed
- Reorganized settings from seven sections into four (Display, Pacing, Reset alerts, General) with fewer, shorter rows. Existing choices carry over.
- The usage bar and context window each use a single picker that includes "Off", instead of a separate on/off switch.
- Pacing has a single switch that turns pace estimates on or off. Turning it off also stops collecting local usage samples.
- Removed the manual weekly schedule. Weekly estimates always learn from local usage, and fall back to a default schedule while learning or when pacing is off.
- Reset alerts now always cover both the 5-hour and weekly limits. If you had turned off both, alerts are now off.
- Review, privacy policy, and GitHub links moved to a compact row of icon links under General.
- The reset banner is simpler: a title and a shorter, thicker bar with a percentage that counts up from 0% to 100%. Clicking anywhere on the banner opens a new Claude chat.
- The usage bar now sits in the empty space of the composer toolbar, or on its own row below it when the chat column is too narrow.

### Fixed
- Fixed the reset banner's bar appearing already full instead of filling up, and the green celebration firing before the bar finished.

## [1.2.0] - 2026-06-06

### Added
- Added model-aware 5-hour estimates that account for the active Claude model family, thinking level, and learned per-message usage from recent real API samples.
- Added a "Messages left" pace display option for the 5-hour bar, with conservative estimates that update when the selected model or thinking level changes.
- Added a redesigned toolbar popup with live 5-hour and weekly usage, refresh and settings shortcuts, 14-day and monthly message charts, model split legend, all-time total, and active-day streak.
- Added daily per-model message history for Opus, Sonnet, Haiku, and undetected/other usage so the popup can show usage trends over time.
- Added toolbar-popup light/dark matching based on the browser theme.
- Added Claude Design route support with a simplified 5-hour-only usage bar that hides unsupported chat-specific controls.

### Changed
- The popup settings button now opens the in-page Usage Bar settings panel on the active Claude tab, or opens Claude and surfaces the settings panel after load.
- The onboarding tour now auto-starts only on Claude's new-chat route.
- Reset time labels now include more precise hour/minute and day/hour text when the API provides reset timestamps.
- Usage projections now show depletion when current pace will run out exactly at reset, and ahead-of-pace fallback estimates no longer go blank.
- Storage writes tolerate Chrome extension context invalidation during extension reloads instead of throwing noisy errors.

### Fixed
- Fixed model detection so the active model switcher wins over open model-picker menu items.
- Fixed thinking-level detection by combining the effort menu switch with the composer-visible effort label.
- Fixed 5-hour and weekly reset metadata parsing so the two windows stay separate.
- Fixed usage tooltip hover and tour behavior so details remain visible while interacting with the panel or walkthrough.
- Fixed popup theme behavior so it follows the browser rather than Claude's page theme.

### Tests
- Added coverage for model/thinking usage math, daily usage charts, page-probe reset parsing, Claude DOM thinking detection, popup browser themes, storage reload handling, and projection edge cases.

## [1.0.1] - 2026-06-01

### Changed
- Reworked the settings integration for Claude's redesigned settings, which is now a **modal overlay** rather than a page. The extension injects a "Usage Bar" item into the overlay's nav and renders its panel inside the overlay, driven by click state — it no longer navigates to a `/settings/usage-bar` route, which had been exposing Claude's legacy settings page in the background.
- The in-bar settings shortcut and the onboarding tour now open the settings overlay via Claude's settings shortcut (and dismiss it with Escape), so they land on the current UI instead of the old one.
- The "Usage Bar" settings item now appears instantly when the settings overlay opens (previously took ~2 seconds).

### Removed
- The **"Claude Design"** usage metric. Claude folded that usage into normal weekly usage, so it's removed from the bar/wheel metric options, the usage hover panel, and the underlying `/usage` parsing. Existing installs that had "Claude Design" selected are migrated to "Weekly".

### Fixed
- Clicking away from the Usage Bar settings — or closing the overlay — no longer reveals Claude's old settings UI.
- "Replay Tour" now closes the settings overlay before (re)starting the tour.
- Onboarding tour spotlight steps no longer overflow the settings overlay, and the step card is clamped on-screen so the metrics/privacy step is always visible.

### Added
- Onboarding tooltip tour for first-time users: an animated walkthrough with navigation controls, a demo cache timer, and a replay option from the Usage Bar settings.
