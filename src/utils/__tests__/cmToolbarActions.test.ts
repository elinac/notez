import { describe, it, expect } from 'vitest';
import { EditorView } from 'codemirror';
import { EditorState } from '@codemirror/state';
import {
  wrapSelection,
  toggleLinePrefix,
  removeHeadingPrefix,
  detectHeadingLevel,
  insertBlock,
  insertTable,
  insertLink,
  insertImage,
  isInlineMarkActive,
  isLinePrefixActive,
} from '../cmToolbarActions';

function createView(doc: string, anchor?: number, head?: number): EditorView {
  const a = anchor ?? doc.length;
  const h = head ?? a;
  const state = EditorState.create({
    doc,
    selection: { anchor: a, head: h },
  });
  return new EditorView({ state });
}

function docText(view: EditorView): string {
  return view.state.doc.toString();
}

describe('wrapSelection', () => {
  it('wraps selected text with marker', () => {
    const view = createView('hello world', 6, 11);
    wrapSelection(view, '**');
    expect(docText(view)).toBe('hello **world**');
  });

  it('inserts placeholder when selection is empty', () => {
    const view = createView('hello ', 6, 6);
    wrapSelection(view, '**');
    expect(docText(view)).toBe('hello **text**');
  });

  it('unwraps when selection includes markers', () => {
    const doc = 'hello **world**';
    const view = createView(doc, 6, 15);
    wrapSelection(view, '**');
    expect(docText(view)).toBe('hello world');
  });

  it('unwraps when selecting the text between markers', () => {
    const doc = 'hello **world** end';
    // select "world" (positions 8–13)
    const view = createView(doc, 6, 15);
    wrapSelection(view, '**');
    expect(docText(view)).toBe('hello world end');
  });
});

describe('toggleLinePrefix', () => {
  it('adds heading prefix', () => {
    const view = createView('hello', 2);
    toggleLinePrefix(view, '## ');
    expect(docText(view)).toBe('## hello');
  });

  it('removes same prefix when toggled', () => {
    const view = createView('## hello', 4);
    toggleLinePrefix(view, '## ');
    expect(docText(view)).toBe('hello');
  });

  it('replaces heading prefix with another level', () => {
    const view = createView('## hello', 4);
    toggleLinePrefix(view, '### ');
    expect(docText(view)).toBe('### hello');
  });

  it('adds list prefix', () => {
    const view = createView('item', 2);
    toggleLinePrefix(view, '- ');
    expect(docText(view)).toBe('- item');
  });
});

describe('removeHeadingPrefix', () => {
  it('removes heading from line', () => {
    const view = createView('### hello', 5);
    removeHeadingPrefix(view);
    expect(docText(view)).toBe('hello');
  });

  it('does nothing on plain text', () => {
    const view = createView('hello', 2);
    removeHeadingPrefix(view);
    expect(docText(view)).toBe('hello');
  });
});

describe('detectHeadingLevel', () => {
  it('returns 0 for plain text', () => {
    const view = createView('hello', 0);
    expect(detectHeadingLevel(view)).toBe(0);
  });

  it('detects H2', () => {
    const view = createView('## heading', 5);
    expect(detectHeadingLevel(view)).toBe(2);
  });

  it('detects H6', () => {
    const view = createView('###### heading', 8);
    expect(detectHeadingLevel(view)).toBe(6);
  });
});

describe('insertBlock', () => {
  it('inserts template at cursor', () => {
    const view = createView('', 0);
    insertBlock(view, '---');
    expect(docText(view)).toBe('---\n');
  });

  it('adds newline before template when line has content', () => {
    const view = createView('hello', 5);
    insertBlock(view, '---');
    expect(docText(view)).toBe('hello\n---\n');
  });
});

describe('insertTable', () => {
  it('creates a 3x2 table', () => {
    const view = createView('', 0);
    insertTable(view, 3, 2);
    const text = docText(view);
    const lines = text.split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('|');
    expect(lines[1]).toContain('---');
  });
});

describe('insertLink', () => {
  it('inserts link template', () => {
    const view = createView('', 0);
    insertLink(view);
    expect(docText(view)).toBe('[text](url)');
  });

  it('uses selected text as link text', () => {
    const view = createView('hello', 0, 5);
    insertLink(view);
    expect(docText(view)).toBe('[hello](url)');
  });
});

describe('insertImage', () => {
  it('inserts image template', () => {
    const view = createView('', 0);
    insertImage(view);
    expect(docText(view)).toBe('![alt](url)');
  });
});

describe('isInlineMarkActive', () => {
  it('detects active bold in selection', () => {
    const view = createView('hello **world** end', 6, 15);
    expect(isInlineMarkActive(view, '**')).toBe(true);
  });

  it('detects active bold when selecting marked text', () => {
    const view = createView('hello **world** end', 6, 15);
    expect(isInlineMarkActive(view, '**')).toBe(true);
  });

  it('returns false for inactive', () => {
    const view = createView('hello world', 6, 11);
    expect(isInlineMarkActive(view, '**')).toBe(false);
  });
});

describe('isLinePrefixActive', () => {
  it('detects heading prefix', () => {
    const view = createView('## hello', 5);
    expect(isLinePrefixActive(view, '## ')).toBe(true);
  });

  it('returns false for different prefix', () => {
    const view = createView('## hello', 5);
    expect(isLinePrefixActive(view, '### ')).toBe(false);
  });
});
