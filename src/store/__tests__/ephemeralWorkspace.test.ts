import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../useAppStore';

const LS_KEY = 'notez-app-state';

describe('ephemeral workspace store', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      workspaceDirs: [],
      ephemeralWorkspaceDirs: [],
      fileTreeVersion: 0,
    });
  });

  it('addEphemeralWorkspaceDir 追加新目录并 bump fileTreeVersion', () => {
    useAppStore.getState().addEphemeralWorkspaceDir('C:/Docs');
    const s = useAppStore.getState();
    expect(s.ephemeralWorkspaceDirs).toEqual(['C:/Docs']);
    expect(s.fileTreeVersion).toBe(1);
  });

  it('重复 path key 不追加', () => {
    useAppStore.getState().addEphemeralWorkspaceDir('C:/Docs');
    useAppStore.getState().addEphemeralWorkspaceDir('c:\\docs');
    expect(useAppStore.getState().ephemeralWorkspaceDirs).toHaveLength(1);
    expect(useAppStore.getState().fileTreeVersion).toBe(1);
  });

  it('已在 workspaceDirs 中则 skip', () => {
    useAppStore.setState({ workspaceDirs: ['D:/Projects'] });
    useAppStore.getState().addEphemeralWorkspaceDir('d:/projects');
    expect(useAppStore.getState().ephemeralWorkspaceDirs).toEqual([]);
  });

  it('removeEphemeralWorkspaceDir 按 key 移除', () => {
    useAppStore.setState({ ephemeralWorkspaceDirs: ['C:/Docs'] });
    useAppStore.getState().removeEphemeralWorkspaceDir('c:\\docs');
    expect(useAppStore.getState().ephemeralWorkspaceDirs).toEqual([]);
  });

  it('remove 不影响 workspaceDirs', () => {
    useAppStore.setState({
      workspaceDirs: ['C:/Keep'],
      ephemeralWorkspaceDirs: ['C:/Temp'],
    });
    useAppStore.getState().removeEphemeralWorkspaceDir('C:/Temp');
    expect(useAppStore.getState().workspaceDirs).toEqual(['C:/Keep']);
  });

  it('persist 不含 ephemeralWorkspaceDirs', () => {
    useAppStore.getState().addEphemeralWorkspaceDir('C:/Docs');
    useAppStore.getState().setEditorMode('edit');
    const raw = localStorage.getItem(LS_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(parsed.state).not.toHaveProperty('ephemeralWorkspaceDirs');
    expect(parsed.state.workspaceDirs).toEqual([]);
  });
});
