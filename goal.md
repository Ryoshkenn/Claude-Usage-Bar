# Claude Usage Bar — Goals & Feature Loop

## How this file works (read first)
You are an autonomous dev agent working on this project on a schedule. Each run:
1. Read this whole file.
2. Pick the single highest-value unchecked item from Backlog.
3. Implement it. Run `npm test` / build it. Fix anything you break.
4. Move the finished item to Done with a one-line note and today's date.
5. Add 1-3 new feature or improvement ideas to Backlog for the next run.
Keep each run's diff small and shippable. Never leave the build broken.

## Vision
A Chrome (MV3) extension that shows compact Claude usage, reset timing, context,
cache, and pacing indicators inside claude.ai, fully local, no telemetry.

## Backlog
- [ ] Localize the remaining UI surfaces (OnboardingTour.tsx, PromptClipboard.tsx)
      with `t()` + `src/locales` entries. Overlay, popup, and settings panel are done.
- [ ] Add a settings popup to toggle which indicators are visible.
- [ ] Show time-until-reset as a live countdown.
- [ ] Add a compact vs expanded view toggle for the usage bar.
- [ ] Persist the user's last view choice across page loads.

## Done
