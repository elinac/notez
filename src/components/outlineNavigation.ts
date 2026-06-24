import { EditorView } from '@codemirror/view';

export interface OutlineItem {
  level: number;
  text: string;
  lineIndex: number;
}

/** Parse ATX Markdown headings from raw content. */
export function parseOutline(content: string): OutlineItem[] {
  const lines = content.split('\n');
  const items: OutlineItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      items.push({
        level: match[1].length,
        text: match[2].trim(),
        lineIndex: i,
      });
    }
  }
  return items;
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';

/** Scroll the nth heading (0-based) inside a scrollable container. */
export function scrollToHeadingInContainer(
  container: HTMLElement | null | undefined,
  headingIndex: number
): boolean {
  if (!container || headingIndex < 0) return false;
  const headings = container.querySelectorAll(HEADING_SELECTOR);
  const target = headings.item(headingIndex);
  if (!target) return false;
  target.scrollIntoView({ block: 'start', behavior: 'auto' });
  return true;
}

/** Scroll CodeMirror source editor to a markdown line index (0-based). */
export function scrollCodeMirrorToLine(
  view: EditorView | null | undefined,
  lineIndex: number
): boolean {
  if (!view || lineIndex < 0) return false;

  const doc = view.state.doc;
  if (lineIndex >= doc.lines) return false;

  const line = doc.line(lineIndex + 1);
  view.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
  });
  view.focus();
  return true;
}
