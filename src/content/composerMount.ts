const DISCLAIMER_SELECTOR = '[data-disclaimer="true"]';

// Claude keeps the disclaimer in a flex row that survives composer updates.
// The row is the mount point; the disclaimer itself is replaced by our bar.
export const findDisclaimerMount = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(DISCLAIMER_SELECTOR)?.parentElement ?? null;

// Cowork chats (claude.ai/cowork/*) use the same disclaimer mount as regular
// chats, but the disclaimer sits in a right-aligned (`ms-auto`) container while
// Skip/Approve controls live in the same chin-trail row's left group:
//   div[data-size="xs"].flex...justify-between
//     ├─ div.flex.items-center.self-start > ... > button[data-cds="Button"] "Skip"
//     └─ div.ms-auto... > div.group/chin-trail.grid > ... > div[data-disclaimer="true"]
// When such a row is detected, the fixed overlay anchors next to the left
// controls group instead of over the right-side disclaimer rect. Regular chats
// have no Skip/Approve button, so this returns null and their geometry is
// byte-identical.
const COWORK_ROW_SELECTOR = 'div[data-size="xs"]';
const COWORK_CONTROL_SELECTOR = 'button[data-cds="Button"]';

export const findCoworkControlsAnchor = (disclaimerMount: HTMLElement | null): HTMLElement | null => {
  if (!(disclaimerMount instanceof HTMLElement)) {
    return null;
  }
  if (!document.body.contains(disclaimerMount)) {
    return null;
  }
  const row = disclaimerMount.closest(COWORK_ROW_SELECTOR);
  if (!(row instanceof HTMLElement) || !document.body.contains(row)) {
    return null;
  }
  const buttons = row.querySelectorAll<HTMLButtonElement>(COWORK_CONTROL_SELECTOR);
  let controlButton: HTMLButtonElement | null = null;
  for (const button of buttons) {
    const label = (button.textContent ?? "").trim().toLowerCase();
    if (label === "skip" || label === "approve") {
      controlButton = button;
      break;
    }
  }
  if (!controlButton) {
    return null;
  }
  // The left controls group: the row's direct child hosting the Skip/Approve
  // button. Walk up so nested wrappers (and DOM reshuffles) still resolve.
  let group: HTMLElement | null = controlButton;
  while (group && group.parentElement !== row) {
    group = group.parentElement;
    if (group !== null && !(group instanceof HTMLElement)) {
      return null;
    }
  }
  if (!(group instanceof HTMLElement) || group === row) {
    return null;
  }
  // Never anchor to a group that contains the disclaimer itself — the overlay
  // must sit next to the controls, not over its own mount.
  if (group.contains(disclaimerMount)) {
    return null;
  }
  return group;
};

const NEW_CHAT_ACTIONS_SELECTOR = 'div[data-cds="ChatComposerActions"]';

// On claude.ai/new the composer has no disclaimer row. The composer card is the
// flex-col ancestor of the ChatComposerActions wrapper (the card carries the
// rounded-composer surface and the ChatComposerEditor). The bar mounts as its
// own row directly underneath the entire card: parent.insertBefore(host,
// card.nextSibling).
export const findNewChatActions = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(NEW_CHAT_ACTIONS_SELECTOR);

export const findNewChatComposerCard = (): HTMLElement | null => {
  const actions = findNewChatActions();
  const card = actions?.parentElement ?? null;
  if (!(card instanceof HTMLElement)) {
    return null;
  }
  // Guard against DOM reshuffles: only treat the parent as the composer card
  // when it actually contains the composer editor.
  if (!card.querySelector('[data-cds="ChatComposerEditor"]')) {
    return null;
  }
  return card;
};

export interface NewChatInsertionPoint {
  parent: HTMLElement;
  anchor: Element | null;
}

// The visible composer card is the rounded-composer surface: an ancestor of
// the inner card (ChatComposerActions' parent) that draws the bordered box.
// Verified live on claude.ai/new: actions(div.contents) > inner card
// (div.relative.w-full, borderless) > surface (div.rounded-composer, 14px
// radius) > flex-col grandparent. Mounting inside the surface stretches the
// composer taller, so the bar belongs *below* the surface, outside the card.
export const findNewChatComposerSurface = (): HTMLElement | null => {
  const card = findNewChatComposerCard();
  if (!card) {
    return null;
  }
  const surface = card.closest('[class*="rounded-composer"]');
  if (
    surface instanceof HTMLElement &&
    surface.querySelector('[data-cds="ChatComposerEditor"]')
  ) {
    return surface;
  }
  return null;
};

export const findNewChatInsertionPoint = (): NewChatInsertionPoint | null => {
  // Preferred: own row directly below the whole composer surface (outside the
  // bordered card, so the composer never grows).
  const surface = findNewChatComposerSurface();
  if (surface) {
    const parent = surface.parentElement;
    if (!(parent instanceof HTMLElement)) {
      return null;
    }
    return { parent, anchor: surface.nextElementSibling };
  }

  // Fallback when no rounded surface exists (older markup): directly below the
  // inner card, the previous behavior.
  const card = findNewChatComposerCard();
  const parent = card?.parentElement ?? null;
  if (!card || !(parent instanceof HTMLElement)) {
    return null;
  }
  return { parent, anchor: card.nextElementSibling };
};

const ADD_FILES_BUTTON_SELECTOR = 'button[aria-label="Add files, connectors, and more"]';const COMPOSER_INPUT_SELECTOR =
  'form textarea:not(#conversation-preferences), form [contenteditable="true"][role="textbox"], form [role="textbox"]';
const SEND_BUTTON_SELECTOR = 'button[type="submit"], button[aria-label*="Send" i]';

// On /design the composer uses styled-components (no stable Tailwind classes).
// Navigate up from the send button to the outer composer card:
// button -> right-controls div -> toolbar row -> card.
export const findDesignComposer = (): HTMLElement | null => {
  const sendBtn = document.querySelector<HTMLElement>('[data-testid="chat-send-button"]');
  return sendBtn?.parentElement?.parentElement?.parentElement ?? null;
};

// Mount the bar as its own row between the prompt input and the toolbar:
// insert before the card's direct child that contains the send button.
export const findDesignInsertionPoint = (composer: HTMLElement): Element | null => {
  let row = composer.querySelector<HTMLElement>('[data-testid="chat-send-button"]')?.parentElement ?? null;
  while (row && row.parentElement !== composer) {
    row = row.parentElement;
  }
  return row;
};

export const findComposerControls = (): HTMLElement | null => {
  const addButton = document.querySelector<HTMLElement>(ADD_FILES_BUTTON_SELECTOR);
  if (!addButton) {
    return null;
  }

  const currentControls = addButton.closest<HTMLElement>(
    "div.relative.flex.gap-2.w-full.items-center",
  );
  if (currentControls) {
    return currentControls;
  }

  return (
    addButton.closest<HTMLElement>(
      "div.relative.flex-1.flex.items-center.shrink.min-w-0.gap-1",
    ) ?? null
  );
};

export const isPreferencesComposer = (element: HTMLElement): boolean =>
  Boolean(
    element.querySelector("#conversation-preferences") ||
      element.closest('[data-testid*="preferences"], [aria-label*="preferences" i]'),
  );

export const findComposer = (): HTMLElement | null => {
  const controls = findComposerControls();
  if (controls && !isPreferencesComposer(controls)) {
    return controls;
  }

  const input = document.querySelector<HTMLElement>(COMPOSER_INPUT_SELECTOR);
  const form = input?.closest("form");

  if (
    form instanceof HTMLElement &&
    !isPreferencesComposer(form) &&
    form.querySelector(SEND_BUTTON_SELECTOR)
  ) {
    return form;
  }

  return null;
};

export const findComposerInsertionPoint = (composer: HTMLElement): Element | null =>
  composer.children[1] ?? null;
