import { describe, expect, it } from 'vitest';
import type { EditorTab } from '../../store/useAppStore';
import { countDirtyInTargets, getCloseTargetIds } from '../tabCloseTargets';

function fileTab(id: string, dirty = false): EditorTab {
  return {
    kind: 'file',
    id,
    content: '',
    file: {
      id: `f-${id}`,
      title: id,
      content: '',
      isDirty: dirty,
    },
  };
}

const tabs = [fileTab('a'), fileTab('b', true), fileTab('c')];

describe('getCloseTargetIds', () => {
  it('close: 仅锚点', () => {
    expect(getCloseTargetIds(tabs, 'close', 'b')).toEqual(['b']);
  });

  it('others: 除锚点外全部', () => {
    expect(getCloseTargetIds(tabs, 'others', 'b')).toEqual(['a', 'c']);
  });

  it('left / right', () => {
    expect(getCloseTargetIds(tabs, 'left', 'b')).toEqual(['a']);
    expect(getCloseTargetIds(tabs, 'right', 'b')).toEqual(['c']);
    expect(getCloseTargetIds(tabs, 'left', 'a')).toEqual([]);
    expect(getCloseTargetIds(tabs, 'right', 'c')).toEqual([]);
  });

  it('all: 忽略锚点，返回全部 id', () => {
    expect(getCloseTargetIds(tabs, 'all', 'missing')).toEqual(['a', 'b', 'c']);
  });

  it('锚点无效且非 all → []', () => {
    expect(getCloseTargetIds(tabs, 'others', 'x')).toEqual([]);
    expect(getCloseTargetIds(tabs, 'close', 'x')).toEqual([]);
  });
});

describe('countDirtyInTargets', () => {
  it('只计 dirty file tab', () => {
    expect(countDirtyInTargets(tabs, ['a', 'b', 'c'])).toBe(1);
    expect(countDirtyInTargets(tabs, ['a', 'c'])).toBe(0);
  });
});
