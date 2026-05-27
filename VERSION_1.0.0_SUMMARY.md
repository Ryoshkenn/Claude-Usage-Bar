# Claude Usage Bar - Version 1.0.0 Release Summary

## Overview
Claude Usage Bar is a privacy-conscious Chrome Manifest V3 extension that adds a compact usage overlay to `https://claude.ai/*`. The extension uses Claude's authenticated browser session to fetch usage metadata while strictly preserving user privacy by storing only sanitized data.

**Version**: 1.0.0  
**Build Date**: May 26, 2026  
**Manifest Version**: 3  
**Tech Stack**: Vite + TypeScript + React + CRXJS

---

## Core Features

### 1. **Real-Time Usage Overlay**
- **Usage Bar**: Horizontal plan usage indicator that tracks 5-hour window usage with visual fill indicator
- **Context Ring**: Circular indicator showing current chat context/token usage relative to 200k token limit
- **Compact Integration**: Seamlessly injected into Claude's composer near the "Add files, connectors, and more" button
- **Theme Detection**: Automatically detects and adapts to both light and dark modes on Claude.ai

### 2. **Comprehensive Usage Tracking**
Sources usage data from multiple channels:
- **Claude `/usage` API**: Fetches authenticated plan usage for 5-hour and weekly limits
- **Conversation JSON API**: Reconstructs active chat branch to estimate real-time token usage
- **DOM Fallback**: Uses visible transcript extraction when API data unavailable
- **Page Probe**: Sanitized same-origin JSON response interception as secondary channel

### 3. **Advanced Context Counting**
- Tracks both **current context tokens** (active chat window) and **compounded input tokens** (sum of all user prompts in conversation)
- Includes metadata from:
  - User and assistant messages
  - Nested content and tool inputs
  - Attachment and image metadata
  - Connector/sync-source size estimates
  - Project/knowledge indicators with concrete evidence
  - Prompt cache metadata detection
- Uses Claude tokenizer (`@huggingface/tokenizers` with `Xenova/claude-tokenizer`) for accurate token counting
- Falls back to `text.length / 4` heuristic if tokenizer initialization fails

### 4. **Weekly Usage Projections**
Smart pace estimation with two modes:

**Smart (Learned) Mode**:
- Automatically learns user's 5-hour and weekly usage patterns
- Samples stored locally in browser as numeric buckets (day, hour, day-hour slots)
- No prompts, responses, or raw payloads stored
- Shows "hours until limit" or "calendar time at limit" estimates
- Automatically ignores manual settings when enabled

**Manual Mode**:
- User configures work days, active hours per day, and start time
- Calendar-time mode places active windows on user's local clock hours
- Falls back to active-hours estimate if learning disabled

### 5. **Onboarding Tour**
- **First-Time User Experience**: Interactive guided tour highlights all features
- **Tour Steps**:
  1. Welcome introduction at `/new`
  2. Usage Bar explanation with visual highlight
  3. Usage Details Panel hover interaction
  4. Settings Shortcut to `/settings/usage-bar`
  5. Extension Settings overview
  6. Usage metrics learning explanation and privacy assurances
  7. Demo message counter
  8. Demo cache timer
  9. Final tour completion
- **Replay Capability**: Users can replay tour anytime from settings
- **Navigation Integration**: Automatically navigates between `/new` and `/settings/usage-bar` during tour
- **Interactive Elements**: Allows user interaction at key steps (e.g., settings toggle during tour)

### 6. **Extension Settings Page**
Injected into Claude's native settings at `/settings/usage-bar` with controls for:

**Display Settings**:
- Toggle overlay visibility
- Compact vs Expanded layout mode
- Show/hide usage bar with optional label
- Show/hide context ring with optional label
- Show/hide pace projection

**Metrics Configuration**:
- Primary metric selection (Session/Weekly/Context/Design)
- Context ring target (Session/Weekly/Context/Design/Hidden)
- Pace surplus format (Percent or Time remaining)

**Weekly Learning Settings**:
- Enable/disable usage metrics learning
- Smart (learned) vs Manual pace mode
- Calendar time vs Active hours display
- Manual work days configuration (checkboxes for each day)
- Manual active hours per day
- Manual start hour for calendar-time calculations

**Other Controls**:
- Manual refresh button for API usage
- Tour replay button
- Clear weekly learning data
- Privacy-focused feature explanations

### 7. **Multi-Model & Product Support**
Tracks usage for:
- 5-hour session limit (all models combined)
- Weekly all-models limit
- Claude Design model specific limits
- Routines usage counters
- Additional Claude products by plan

### 8. **Cache Timer Support**
- Displays prompt cache TTL and expiration time when available
- Integrated into context ring information
- Stored as numeric metadata (`cachedPrefixTokens`, `cacheExpiresAt`)

### 9. **Usage Projection & History**
- **Usage History**: Maintains log of historical usage samples with reset timestamps
- **Weighted Drain Rate**: Calculates usage consumption rate from historical data
- **ETA Calculation**: Estimates time until weekly/5-hour limit reset
- **Smart Fallback**: Uses linear projection when insufficient learning data available
- **Tolerance Handling**: Accounts for minor reset timestamp variations (±60s tolerance)

---

## Privacy & Security

### Data Storage (Allowlisted Only)
✅ **Stored**:
- Settings and user preferences
- Numeric token estimates and cache metadata
- Sanitized usage percentages (5-hour, weekly, design)
- Reset display strings (e.g., "Resets in 2 hours")
- Routines usage counters
- Cached organization UUID
- Weekly usage learning metrics (numeric buckets only)
- Installed/review dates

❌ **Never Stored**:
- Prompts or responses
- Cookies or auth tokens
- Request/response bodies
- Raw Claude API payloads
- Conversation text or message content
- Attachment/file contents
- User personal information beyond what's necessary

### Authentication & Permissions
- Uses Chrome's `credentials: "include"` for authenticated API calls
- Only requests `storage` permission in manifest
- Host-permission limited to `https://claude.ai/*`
- Service worker handles all authenticated requests (background.ts)
- Content scripts cannot access raw auth credentials

---

## Technical Architecture

### Module Organization
```
src/
├── background/
│   └── background.ts          # Service worker - API calls, throttling
├── content/
│   ├── content.tsx            # Content script entry
│   ├── ContentApp.tsx         # Main UI component
│   ├── OnboardingTour.tsx     # First-time tour component
│   ├── claudeDom.ts           # DOM extraction heuristics
│   ├── messageRail.ts         # Message rail indicators
│   ├── settingsPage.tsx       # Settings page injection
│   ├── usageEstimator.ts      # Token counting helpers
│   └── styles.css            # All injected UI styling
├── popup/
│   └── popup.tsx             # Extension popup UI
├── shared/
│   ├── storage.ts            # Sanitized storage layer
│   ├── types.ts              # TypeScript type definitions
│   ├── constants.ts          # Shared constants
│   ├── claudeUsageApi.ts    # API response normalization
│   ├── claudeConversationContext.ts  # Chat context extraction
│   ├── claudeTokenizer.ts   # Tokenizer wrapper
│   ├── claude-tokenizer.json  # Tokenizer assets
│   └── usageProjection.ts   # Projection calculations
├── test/
│   └── *.test.ts            # Vitest unit tests
└── manifest.ts              # Extension manifest definition
```

### Key Classes & Interfaces

**ChatUsage**:
- `estimatedTokens`: Calculated token count
- `currentContextTokens`: Current window size
- `compoundedInputTokens`: Sum of user prompts
- `visibleMessageCount`: Message counter
- `cachedPrefixTokens`: Cache metadata
- `cacheExpiresAt`: Cache TTL

**RealUsageSnapshot**:
- `percentageUsed`: 5-hour usage %
- `weeklyAllModelsPercentageUsed`: Weekly usage %
- `claudeDesignPercentageUsed`: Design model usage %
- `resetText`, `sessionResetsAt`: 5-hour reset info
- `routinesText`: Routines usage counter

**Settings**:
- Display preferences (bar, ring, labels, compact/expanded)
- Weekly learning options (smart/manual, active_hours/calendar_time)
- Metric targets and pace format
- Manual schedule (work days, hours per day, start time)

---

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server with hot reload
npm run build        # TypeCheck + build to dist/
npm test             # Run Vitest once
npm run test:watch   # Watch mode testing
```

**Loading in Chrome**:
1. Build with `npm run build`
2. Open `chrome://extensions`
3. Enable "Developer Mode"
4. Click "Load unpacked"
5. Select `dist/` directory

---

## Testing Coverage

Tests in `src/test/` cover:
- Storage behavior and allowlist enforcement
- Usage API response normalization
- Token estimation calculations
- Usage projection math
- Date rollover logic
- Context counting accuracy
- Type system validation
- Settings defaults and persistence

---

## Browser Compatibility

- **Chrome**: 120+
- **Manifest Version**: 3 (future-proof)
- **Architecture**: Works with service workers (not content scripts for privileged calls)

---

## Known Limitations & Future Work

1. **Token Counting**: Uses local Claude tokenizer estimate (planned Anthropic API key support for official counting)
2. **Cache Discount**: Cached tokens not discounted from usage display (metadata tracked separately)
3. **Light Mode**: Uses warm Claude-style palette with high-contrast UI
4. **API Key Support**: Future optional Anthropic `/messages/count_tokens` endpoint integration planned

---

## Files Changed for v1.0.0

**New Features**:
- `src/content/OnboardingTour.tsx` - Interactive first-time user tour
- `src/shared/claudeConversationContext.ts` - Chat JSON parsing
- `src/shared/claudeTokenizer.ts` - Token estimation
- `src/shared/usageProjection.ts` - Weekly projection math
- Tokenizer assets: `claude-tokenizer.json`, `claude-tokenizer-config.json`

**Enhanced**:
- `src/content/ContentApp.tsx` - New UI panels, cache timer, message rail
- `src/background/background.ts` - Conversation API integration
- `src/content/settingsPage.tsx` - Complete settings UI
- `src/shared/types.ts` - Extended data models
- `src/shared/storage.ts` - New allowed fields
- `src/content/styles.css` - Light mode, tour styles
- `src/popup/popup.tsx` - New controls
- `AGENTS.md` & `CLAUDE.md` - Updated documentation

**Removed**:
- Icon files (regenerated with new design)

---

## Verification Checklist

✅ Tests pass: `npm test`  
✅ Build succeeds: `npm run build`  
✅ Extension loads unpacked in Chrome  
✅ Overlay appears on `claude.ai/*`  
✅ Usage bar updates on message send  
✅ Context ring shows token usage  
✅ Settings page accessible at `/settings/usage-bar`  
✅ Weekly projection calculates correctly  
✅ Onboarding tour completes  
✅ No conversation text in `chrome.storage.local`  
✅ Light/dark theme detection works  
✅ Privacy: No auth tokens, cookies, or raw payloads stored  

---

## Release Notes

**Claude Usage Bar v1.0.0** is a production-ready extension delivering:
- Accurate, real-time usage tracking with dual context and compounded token counting
- Smart weekly pace projections with learned usage patterns
- First-time user onboarding with interactive feature tour
- Comprehensive settings for all major features
- Privacy-by-design architecture with strict storage allowlisting
- Support for 5-hour, weekly, and model-specific usage limits
- Prompt cache TTL tracking
- Theme-aware light/dark mode UI

The extension is ready for Chrome Web Store submission and wider user adoption.
