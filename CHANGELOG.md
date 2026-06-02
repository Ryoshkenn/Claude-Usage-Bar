# Changelog

All notable changes since the 1.0.0 Chrome Web Store release are documented here.

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
