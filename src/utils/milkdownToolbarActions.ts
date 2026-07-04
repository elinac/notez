/**
 * Milkdown formatting toolbar actions.
 * Uses preset dedicated commands verified against 7.19 source.
 */
import type { Crepe } from '@milkdown/crepe';
import type { Ctx } from '@milkdown/kit/ctx';
import type { MarkType } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  headingSchema,
  inlineCodeSchema,
  strongSchema,
  emphasisSchema,
  linkSchema,
  isMarkSelectedCommand,
} from '@milkdown/kit/preset/commonmark';
import {
  toggleStrikethroughCommand,
  strikethroughSchema,
  insertTableCommand,
} from '@milkdown/kit/preset/gfm';
import { toggleLinkCommand } from '@milkdown/kit/component/link-tooltip';

// ── Guard: only run when editor is created ──────────────────────────────────

function withEditor(crepe: Crepe, fn: (ctx: Ctx) => void): void {
  crepe.editor.action((ctx) => {
    try {
      fn(ctx);
    } catch {
      // editor not ready or command failed — swallow silently
    }
  });
}

// ── isMarkActive — check storedMarks + cursor marks ─────────────────────────

function isMarkActive(ctx: Ctx, markType: MarkType): boolean {
  const commands = ctx.get(commandsCtx);
  const view = ctx.get(editorViewCtx);
  const selected = commands.call(isMarkSelectedCommand.key, markType);
  if (selected) return true;

  const { state } = view;
  if (state.storedMarks) {
    return state.storedMarks.some((m) => m.type === markType);
  }
  if (state.selection instanceof TextSelection) {
    const { $cursor } = state.selection as TextSelection;
    if ($cursor) {
      return $cursor.marks().some((m) => m.type === markType);
    }
  }
  return false;
}

// ── Inline marks ──────────────────────────────────────────────────────────────

export function toggleBold(crepe: Crepe): void {
  withEditor(crepe, (ctx) => {
    ctx.get(commandsCtx).call(toggleStrongCommand.key);
  });
}

export function toggleItalic(crepe: Crepe): void {
  withEditor(crepe, (ctx) => {
    ctx.get(commandsCtx).call(toggleEmphasisCommand.key);
  });
}

export function toggleStrikethrough(crepe: Crepe): void {
  withEditor(crepe, (ctx) => {
    ctx.get(commandsCtx).call(toggleStrikethroughCommand.key);
  });
}

export function toggleInlineCode(crepe: Crepe): void {
  withEditor(crepe, (ctx) => {
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    if (state.selection.empty) {
      const markType = inlineCodeSchema.type(ctx);
      const has = isMarkActive(ctx, markType);
      if (has) {
        view.dispatch(state.tr.removeStoredMark(markType));
      } else {
        view.dispatch(state.tr.addStoredMark(markType.create()));
      }
    } else {
      ctx.get(commandsCtx).call(toggleInlineCodeCommand.key);
    }
  });
}

// ── Block structures ─────────────────────────────────────────────────────────

export function setHeading(crepe: Crepe, level: number): void {
  withEditor(crepe, (ctx) => {
    if (level < 1) {
      ctx.get(commandsCtx).call(turnIntoTextCommand.key);
    } else {
      ctx.get(commandsCtx).call(wrapInHeadingCommand.key, level);
    }
  });
}

export function toggleBlockquote(crepe: Crepe): void {
  withEditor(crepe, (ctx) => {
    ctx.get(commandsCtx).call(wrapInBlockquoteCommand.key);
  });
}

export function toggleBulletList(crepe: Crepe): void {
  withEditor(crepe, (ctx) => {
    ctx.get(commandsCtx).call(wrapInBulletListCommand.key);
  });
}

export function toggleOrderedList(crepe: Crepe): void {
  withEditor(crepe, (ctx) => {
    ctx.get(commandsCtx).call(wrapInOrderedListCommand.key);
  });
}

export function insertTaskList(crepe: Crepe): void {
  withEditor(crepe, (ctx) => {
    const commands = ctx.get(commandsCtx);
    const view = ctx.get(editorViewCtx);
    commands.call(wrapInBulletListCommand.key);
    const { state } = view;
    const { $from } = state.selection;
    let depth = $from.depth;
    while (depth > 0) {
      const node = $from.node(depth);
      if (node.type.name === 'list_item') {
        const pos = $from.before(depth);
        view.dispatch(
          state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            checked: false,
          }),
        );
        break;
      }
      depth--;
    }
  });
}

// ── Insert actions ───────────────────────────────────────────────────────────

export function insertCodeBlock(crepe: Crepe): void {
  withEditor(crepe, (ctx) => {
    ctx.get(commandsCtx).call(createCodeBlockCommand.key, '');
  });
}

export function insertHr(crepe: Crepe): void {
  withEditor(crepe, (ctx) => {
    ctx.get(commandsCtx).call(insertHrCommand.key);
  });
}

export function toggleLink(crepe: Crepe): void {
  withEditor(crepe, (ctx) => {
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    if (
      state.selection.empty &&
      isMarkActive(ctx, linkSchema.type(ctx))
    ) {
      view.dispatch(state.tr.removeStoredMark(linkSchema.type(ctx)));
      return;
    }
    ctx.get(commandsCtx).call(toggleLinkCommand.key);
  });
}

export function insertImage(crepe: Crepe): void {
  withEditor(crepe, (ctx) => {
    ctx.get(commandsCtx).call(insertImageCommand.key, {
      src: '',
      alt: '',
      title: '',
    });
  });
}

export function insertMilkdownTable(
  crepe: Crepe,
  row: number,
  col: number,
): void {
  withEditor(crepe, (ctx) => {
    ctx.get(commandsCtx).call(insertTableCommand.key, { row, col });
  });
}

// ── State detection ──────────────────────────────────────────────────────────

export type MarkState = {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  inlineCode: boolean;
  link: boolean;
};

export type HeadingState = {
  label: string;
  level: number;
};

export function getMarkState(crepe: Crepe): MarkState {
  const result: MarkState = {
    bold: false,
    italic: false,
    strikethrough: false,
    inlineCode: false,
    link: false,
  };
  try {
    crepe.editor.action((ctx) => {
      result.bold = isMarkActive(ctx, strongSchema.type(ctx));
      result.italic = isMarkActive(ctx, emphasisSchema.type(ctx));
      result.strikethrough = isMarkActive(
        ctx,
        strikethroughSchema.type(ctx),
      );
      result.inlineCode = isMarkActive(ctx, inlineCodeSchema.type(ctx));
      result.link = isMarkActive(ctx, linkSchema.type(ctx));
    });
  } catch {
    // editor not ready
  }
  return result;
}

export function getCurrentHeading(crepe: Crepe): HeadingState {
  const result: HeadingState = { label: '正文', level: 0 };
  try {
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { $from } = view.state.selection;
      const node = $from.parent;
      if (node.type === headingSchema.type(ctx)) {
        const lvl = node.attrs.level as number;
        result.label = `H${lvl}`;
        result.level = lvl;
      }
    });
  } catch {
    // editor not ready
  }
  return result;
}
