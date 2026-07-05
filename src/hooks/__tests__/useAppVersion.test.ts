import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../components/FileOperations', () => ({
  isTauri: vi.fn(),
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(),
}));

import { isTauri } from '../../components/FileOperations';
import { getVersion } from '@tauri-apps/api/app';
import { useAppVersion } from '../useAppVersion';
import pkg from '../../../package.json';

describe('useAppVersion', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(getVersion).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('非 Tauri 环境返回 package.json 版本', async () => {
    const { result } = renderHook(() => useAppVersion());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.version).toBe(pkg.version);
    expect(result.current.error).toBeNull();
  });

  it('Tauri 环境调用 getVersion', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(getVersion).mockResolvedValue('0.2.0');
    const { result } = renderHook(() => useAppVersion());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.version).toBe('0.2.0');
    expect(getVersion).toHaveBeenCalled();
  });

  it('getVersion 失败时回退 package.json', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(getVersion).mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useAppVersion());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.version).toBe(pkg.version);
    expect(result.current.error).toBeTruthy();
  });
});
