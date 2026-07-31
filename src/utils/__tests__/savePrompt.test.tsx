// @vitest-environment jsdom
import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import {
  promptSaveChanges,
  registerSavePromptHandler,
  type SavePromptChoice,
} from '../savePrompt';
import { SavePromptHost } from '../../components/SavePromptHost';

describe('promptSaveChanges', () => {
  beforeEach(() => registerSavePromptHandler(null));
  afterEach(() => registerSavePromptHandler(null));

  it('未注册 handler → cancel', async () => {
    await expect(promptSaveChanges('x')).resolves.toBe('cancel');
  });

  it('委托已注册 handler', async () => {
    registerSavePromptHandler(async () => 'save');
    await expect(promptSaveChanges('msg')).resolves.toBe('save');
  });

  it('排队：前一个未完成时后一个等待', async () => {
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    registerSavePromptHandler(async (msg) => {
      calls.push(msg);
      if (msg === '1') await gate;
      return 'discard';
    });

    const p1 = promptSaveChanges('1');
    const p2 = promptSaveChanges('2');

    expect(calls).toEqual(['1']);
    release();

    await expect(p1).resolves.toBe('discard');
    await expect(p2).resolves.toBe('discard');
    expect(calls).toEqual(['1', '2']);
  });
});

describe('SavePromptHost', () => {
  afterEach(() => {
    cleanup();
    registerSavePromptHandler(null);
  });

  it('显示消息并允许选择保存', async () => {
    render(<SavePromptHost />);
    const promise = promptSaveChanges('文档有未保存的更改');

    await waitFor(() => {
      expect(screen.getByText('文档有未保存的更改')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await expect(promise).resolves.toBe('save');
  });

  it('点击不保存返回 discard', async () => {
    render(<SavePromptHost />);
    const promise = promptSaveChanges('是否放弃？');

    await screen.findByText('是否放弃？');
    fireEvent.click(screen.getByRole('button', { name: '不保存' }));
    await expect(promise).resolves.toBe('discard');
  });

  it('点击遮罩或按 Esc 返回 cancel', async () => {
    render(<SavePromptHost />);
    const promise = promptSaveChanges('取消测试');

    await screen.findByText('取消测试');
    fireEvent.click(screen.getByTestId('save-prompt-overlay'));
    await expect(promise).resolves.toBe('cancel');
  });

  it('多个提示排队，依次处理', async () => {
    render(<SavePromptHost />);
    const p1 = promptSaveChanges('第一个');
    await screen.findByText('第一个');

    const p2 = promptSaveChanges('第二个');
    expect(screen.queryByText('第二个')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '不保存' }));
    await screen.findByText('第二个');

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await expect(p1).resolves.toBe('discard');
    await expect(p2).resolves.toBe('cancel');
  });
});
