import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AboutSettings } from '../AboutSettings';

vi.mock('../../../hooks/useAppVersion', () => ({
  useAppVersion: () => ({ version: '0.2.0', loading: false, error: null }),
}));

vi.mock('../../../components/FileOperations', () => ({
  isTauri: vi.fn(() => false),
}));

describe('AboutSettings', () => {
  it('显示应用名、版本与许可证', () => {
    render(<AboutSettings />);
    expect(screen.getByText('NoteZ')).toBeTruthy();
    expect(screen.getByText('v0.2.0')).toBeTruthy();
    expect(screen.getByText(/Apache-2\.0/)).toBeTruthy();
    expect(screen.getByText(/NoteZ Contributors/)).toBeTruthy();
  });

  it('浏览器 dev 下打开按钮 disabled', () => {
    render(<AboutSettings />);
    expect((screen.getByRole('button', { name: '查看许可证' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
