# Prompt Clipboard — Design Spec

## Overview

Add a Prompt Clipboard as the third built-in control in the existing `.cub-root` usage bar row, giving users quick access to saved prompts that can be copied to the system clipboard.

## Layout

```
.cub-root grid: [ usage bar ] [ context ring ] [ prompt clipboard button ]
```

The new 24×24px button is the third grid child, placed after `.cub-wheel-wrap`.

## Data Model

```ts
interface PromptEntry {
  id: string;           // crypto.randomUUID()
  title: string;        // user-editable short label
  content: string;      // the prompt text
  createdAt: number;    // Date.now()
  updatedAt: number;    // Date.now()
}
```

Stored as `PromptEntry[]` under `chrome.storage.local` key `"prompts"`.

## Storage

- Add `prompts` to `STORAGE_KEYS` in `src/shared/constants.ts`
- Add `PromptEntry` type to `src/shared/types.ts`
- Add `prompts` field (optional) to `StorageShape`
- Add `getPrompts`, `savePrompts` helpers to `src/shared/storage.ts`
- Default: empty array `[]`

## Component: PromptClipboard

New file `src/content/PromptClipboard.tsx`.

Props: `none` (self-contained, reads/writes storage via `chrome.storage.local`).

### Button

- 24×24px `<button>` with a clipboard/paper SVG icon
- `aria-label="Prompt clipboard"`
- Visually matches existing bar controls: subdued text color, hover highlight
- `cursor: pointer`

### Panel

- Toggles open/closed on button click (`useState` for open state)
- Positioned above the button (like existing tooltips), `z-index: 2147483647`
- Same visual style as `.cub-usage-tooltip`:
  - Background: `rgb(44 44 43)`
  - Border: `1px solid rgb(255 255 255 / 8%)`
  - Border-radius: `8px`
  - Box-shadow: `0 12px 30px rgb(0 0 0 / 34%)`
  - Color: `rgb(245 245 241)`
- Min-width: `280px`, max-height: `320px` with scroll
- Close on click outside (use `useEffect` with document click listener)

### Prompt List

Each prompt entry in the panel shows:
1. **Title** — bold/serif accent, using `font-family: "Anthropic Serif", Georgia, "Times New Roman", serif`
2. **Content preview** — single-line truncated snippet, muted color
3. **Action buttons row** — Copy, Edit, Delete (small icon buttons)

### Actions

**Copy:**
- `navigator.clipboard.writeText(prompt.content)`
- Brief visual feedback: copy icon becomes a checkmark for 1.5s, then reverts

**Edit:**
- Clicking Edit expands the entry into an inline form
- Editable `<input>` for title, `<textarea>` for content
- Save button persists, Cancel reverts
- On save: update `updatedAt`, save to storage

**Delete:**
- Removes prompt from array, saves to storage
- No undo confirmation (keep it fast; mistaken deletes can be recreated)

### Add Prompt

- "+ New prompt" button at the bottom of the panel
- Clicking it inserts an empty editable entry at the top of the list
- Title is empty (placeholder: "Prompt title"), content is empty
- User fills in and clicks Save; empty prompts are discarded on panel close

## Styles

Add to `src/content/styles.css`:

```css
/* Clipboard button */
.cub-clipboard-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgb(165 164 156);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  pointer-events: auto;
}
.cub-clipboard-btn:hover {
  color: rgb(245 245 241);
  background: rgb(255 255 255 / 8%);
}

/* Clipboard panel */
.cub-clipboard-panel {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 10px);
  z-index: 2147483647;
  min-width: 280px;
  max-height: 320px;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 8px;
  background: rgb(44 44 43);
  box-shadow: 0 12px 30px rgb(0 0 0 / 34%);
  color: rgb(245 245 241);
  font-size: 13px;
  line-height: 1.4;
  transform: translateX(-50%);
}

/* Prompt entries */
.cub-clipboard-entry {
  padding: 6px 8px;
  border-radius: 6px;
}
.cub-clipboard-entry:hover {
  background: rgb(255 255 255 / 6%);
}
.cub-clipboard-entry-title {
  font-family: "Anthropic Serif", Georgia, "Times New Roman", serif;
  font-size: 14px;
  color: rgb(245 245 241);
}
.cub-clipboard-entry-preview {
  font-size: 12px;
  color: rgb(165 164 156);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cub-clipboard-entry-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}
.cub-clipboard-entry-actions button {
  /* small icon buttons */
}

/* Light mode overrides */
#claude-usage-bar-root.cub-theme-light .cub-clipboard-panel {
  background: rgb(255 255 255);
  border: 1px solid rgb(0 0 0 / 10%);
  color: rgb(40 40 38);
  box-shadow: 0 12px 30px rgb(0 0 0 / 12%);
}
#claude-usage-bar-root.cub-theme-light .cub-clipboard-entry-title {
  color: rgb(40 40 38);
}
#claude-usage-bar-root.cub-theme-light .cub-clipboard-entry-preview {
  color: rgb(120 118 112);
}
#claude-usage-bar-root.cub-theme-light .cub-clipboard-btn:hover {
  background: rgb(0 0 0 / 6%);
  color: rgb(40 40 38);
}
```

## Integration

### ContentApp.tsx

After the existing `showWheel` section, add:

```tsx
{showClipboard !== false && (
  <PromptClipboard />
)}
```

Add `showClipboard` setting to `Settings` interface (default `true`).

### content.tsx

No changes needed — `PromptClipboard` is self-contained and reads/writes storage independently. The `ContentApp` rendering is already triggered by storage changes.

## Files Changed

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `PromptEntry` interface, add `showClipboard` to `Settings` |
| `src/shared/constants.ts` | Add `prompts` to `STORAGE_KEYS` |
| `src/shared/storage.ts` | Add `getPrompts`, `savePrompts` helpers, update `DEFAULT_SETTINGS` with `showClipboard` |
| `src/content/PromptClipboard.tsx` | New file — component |
| `src/content/ContentApp.tsx` | Import and render `PromptClipboard` |
| `src/content/styles.css` | All clipboard styles |

## Privacy

Only prompt titles and text content are stored locally in `chrome.storage.local`. No data is sent to any server. Prompts are not logged, not shared, and not included in any analytics.

## Testing

- Verify button renders in the `.cub-root` grid
- Verify panel opens on click, closes on click outside
- Verify copy writes to `navigator.clipboard`
- Verify edit round-trips through storage
- Verify delete removes from storage
- Verify light mode styling
