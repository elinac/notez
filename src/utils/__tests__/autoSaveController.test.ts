import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginAutoSaveWrite,
  cancelPendingAutoSave,
  clearAutoSaveTimerOnly,
  isAutoSaveWriteCurrent,
  scheduleAutoSave,
} from '../autoSaveController';

describe('autoSaveController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cancelPendingAutoSave();
  });
  afterEach(() => {
    cancelPendingAutoSave();
    vi.useRealTimers();
  });

  it('schedule 后 debounce 执行；cancel 后不执行', () => {
    const fn = vi.fn();
    scheduleAutoSave(fn, 1000);
    cancelPendingAutoSave();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel 使进行中 write generation 过期', () => {
    const gen = beginAutoSaveWrite();
    expect(isAutoSaveWriteCurrent(gen)).toBe(true);
    cancelPendingAutoSave();
    expect(isAutoSaveWriteCurrent(gen)).toBe(false);
  });

  it('后一次 schedule 取代前一次', () => {
    const a = vi.fn();
    const b = vi.fn();
    scheduleAutoSave(a, 1000);
    scheduleAutoSave(b, 1000);
    vi.advanceTimersByTime(1000);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it('clearAutoSaveTimerOnly 只清 timer 不 bump generation', () => {
    const fn = vi.fn();
    scheduleAutoSave(fn, 1000);
    const gen = beginAutoSaveWrite();
    clearAutoSaveTimerOnly();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
    expect(isAutoSaveWriteCurrent(gen)).toBe(true);
  });
});
