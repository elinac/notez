/** Editable regions keep WebView2 default context menu; chrome suppresses it. */
function isEditableContextMenuTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      '[contenteditable="true"], textarea, input:not([type="hidden"]):not([readonly]), .cm-content, .cm-editor, .milkdown, .milkdown-editor',
    ),
  );
}

/** Suppress WebView2 default context menu on app chrome (T3). */
export function installNativeChromeGuards(): void {
  document.addEventListener(
    'contextmenu',
    (e) => {
      if (isEditableContextMenuTarget(e.target)) return;
      e.preventDefault();
    },
    { capture: true },
  );
}
