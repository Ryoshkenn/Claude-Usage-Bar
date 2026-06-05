const ADD_FILES_BUTTON_SELECTOR = 'button[aria-label="Add files, connectors, and more"]';
const COMPOSER_INPUT_SELECTOR =
  'form textarea:not(#conversation-preferences), form [contenteditable="true"][role="textbox"], form [role="textbox"]';
const SEND_BUTTON_SELECTOR = 'button[type="submit"], button[aria-label*="Send" i]';

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
