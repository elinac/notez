/**
 * CodeMirror 6 formatting toolbar actions.
 * Each function dispatches a transaction to the EditorView.
 */
import type { EditorView } from '@codemirror/view';

// ── Inline Mark (wrap selection) ──────────────────────────────────────────────

export function wrapSelection(view: EditorView, marker: string): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);

  const before = view.state.sliceDoc(
    Math.max(0, from - marker.length),
    from,
  );
  const after = view.state.sliceDoc(
    to,
    Math.min(view.state.doc.length, to + marker.length),
  );

  if (before === marker && after === marker) {
    // Cursor inside markers — remove them
    view.dispatch({
      changes: [
        { from: from - marker.length, to: from },
        { from: to, to: to + marker.length },
      ],
    });
  } else if (
    selected.startsWith(marker) &&
    selected.endsWith(marker) &&
    selected.length > marker.length * 2
  ) {
    // Selection includes markers — unwrap
    const inner = selected.slice(marker.length, -marker.length);
    view.dispatch({ changes: { from, to, insert: inner } });
  } else {
    // Wrap selection (or placeholder text)
    const text = selected || 'text';
    view.dispatch({
      changes: { from, to, insert: `${marker}${text}${marker}` },
      selection: {
        anchor: from + marker.length,
        head: from + marker.length + text.length,
      },
    });
  }
  view.focus();
}

// ── Block Prefix (line prefix toggle) ─────────────────────────────────────────

export function toggleLinePrefix(view: EditorView, prefix: string): void {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);

  if (line.text.startsWith(prefix)) {
    view.dispatch({
      changes: { from: line.from, to: line.from + prefix.length },
    });
  } else {
    // Heading mutual exclusion: remove existing # prefix first
    const headingMatch = line.text.match(/^#{1,6}\s/);
    const removeLen = headingMatch ? headingMatch[0].length : 0;
    view.dispatch({
      changes: {
        from: line.from,
        to: line.from + removeLen,
        insert: prefix,
      },
    });
  }
  view.focus();
}

/**
 * Remove any heading prefix from the current line (convert to paragraph).
 */
export function removeHeadingPrefix(view: EditorView): void {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const headingMatch = line.text.match(/^#{1,6}\s/);
  if (headingMatch) {
    view.dispatch({
      changes: { from: line.from, to: line.from + headingMatch[0].length },
    });
  }
  view.focus();
}

/**
 * Detect current heading level at cursor (0 = no heading).
 */
export function detectHeadingLevel(view: EditorView): number {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const match = line.text.match(/^(#{1,6})\s/);
  return match ? match[1].length : 0;
}

// ── Block Insert (insert template) ───────────────────────────────────────────

export function insertBlock(view: EditorView, template: string): void {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const needNewline = line.text.length > 0 ? '\n' : '';
  view.dispatch({
    changes: { from, insert: `${needNewline}${template}\n` },
  });
  view.focus();
}

export function insertTable(
  view: EditorView,
  cols: number,
  rows: number,
): void {
  const header = '| ' + Array(cols).fill('  ').join(' | ') + ' |';
  const separator = '| ' + Array(cols).fill('---').join(' | ') + ' |';
  const dataRow = '| ' + Array(cols).fill('  ').join(' | ') + ' |';
  const lines = [header, separator, ...Array(rows - 1).fill(dataRow)];
  insertBlock(view, lines.join('\n'));
}

export function insertLink(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const text = selected || 'text';
  const template = `[${text}](url)`;
  view.dispatch({
    changes: { from, to, insert: template },
    selection: {
      anchor: from + text.length + 3,
      head: from + text.length + 6,
    },
  });
  view.focus();
}

export function insertImage(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const alt = selected || 'alt';
  const template = `![${alt}](url)`;
  view.dispatch({
    changes: { from, to, insert: template },
    selection: {
      anchor: from + alt.length + 4,
      head: from + alt.length + 7,
    },
  });
  view.focus();
}

// ── Detection helpers ────────────────────────────────────────────────────────

/**
 * Detect whether the current selection/cursor has an inline marker active.
 */
export function isInlineMarkActive(
  view: EditorView,
  marker: string,
): boolean {
  const { from, to } = view.state.selection.main;

  // Check if selection is wrapped by marker
  const selected = view.state.sliceDoc(from, to);
  if (
    selected.startsWith(marker) &&
    selected.endsWith(marker) &&
    selected.length > marker.length * 2
  ) {
    return true;
  }

  // Check if marker exists outside selection
  const before = view.state.sliceDoc(
    Math.max(0, from - marker.length),
    from,
  );
  const after = view.state.sliceDoc(
    to,
    Math.min(view.state.doc.length, to + marker.length),
  );
  return before === marker && after === marker;
}

/**
 * Detect whether the current line starts with a given prefix.
 */
export function isLinePrefixActive(
  view: EditorView,
  prefix: string,
): boolean {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  return line.text.startsWith(prefix);
}
