import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  parseOutline,
  scrollCodeMirrorToLine,
  scrollToHeadingInContainer,
} from '../outlineNavigation';

describe('parseOutline', () => {
  it('extracts ATX headings in document order', () => {
    const md = '# One\n\n## Two\n\nplain\n\n### Three';
    expect(parseOutline(md)).toEqual([
      { level: 1, text: 'One', lineIndex: 0 },
      { level: 2, text: 'Two', lineIndex: 2 },
      { level: 3, text: 'Three', lineIndex: 6 },
    ]);
  });
});

describe('scrollToHeadingInContainer', () => {
  it('scrolls the selected heading into view', () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    const container = document.createElement('div');
    container.innerHTML = '<h1>First</h1><div style="height:800px"></div><h2>Second</h2>';

    expect(scrollToHeadingInContainer(container, 1)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
  });

  it('returns false when heading index is out of range', () => {
    const container = document.createElement('div');
    container.innerHTML = '<h1>Only</h1>';
    expect(scrollToHeadingInContainer(container, 1)).toBe(false);
  });
});

describe('scrollCodeMirrorToLine', () => {
  it('moves selection to the requested line', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
      state: EditorState.create({ doc: '# Title\n\nBody' }),
      parent,
    });

    expect(scrollCodeMirrorToLine(view, 2)).toBe(true);
    expect(view.state.selection.main.anchor).toBe(view.state.doc.line(3).from);

    view.destroy();
    parent.remove();
  });
});
