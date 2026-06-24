import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  openMarkdownFile, 
  saveMarkdownFile, 
  createNewFile,
  addRecentFile 
} from '../FileOperations';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('FileOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  // 测试用例 1: 创建新文件
  describe('createNewFile', () => {
    it('TC1: 应创建带有默认内容的新文件', () => {
      const result = createNewFile();
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('title');
      expect(result.content).toContain('# ');
      expect(result.isDirty).toBe(false);
    });

    it('TC2: 新文件 ID 应该是唯一的', () => {
      const file1 = createNewFile();
      const file2 = createNewFile();
      expect(file1.id).not.toBe(file2.id);
    });
  });

  // 测试用例 3: 打开 Markdown 文件
  describe('openMarkdownFile', () => {
    it('TC3: 应正确解析 Markdown 文件内容', async () => {
      const mockContent = '# Test File\n\nThis is content.';
      const mockFile = new File([mockContent], 'test.md', { type: 'text/markdown' });
      
      const result = await openMarkdownFile(mockFile);
      expect(result.content).toBe(mockContent);
      expect(result.title).toBe('test');
      expect(result.extension).toBe('.md');
    });

    it('TC4: 应处理非 .md 扩展名的文件', async () => {
      const mockContent = 'Plain text content';
      const mockFile = new File([mockContent], 'test.txt', { type: 'text/plain' });
      
      const result = await openMarkdownFile(mockFile);
      expect(result.extension).toBe('.txt');
    });

    it('TC5: 应处理空文件', async () => {
      const mockFile = new File([''], 'empty.md', { type: 'text/markdown' });
      
      const result = await openMarkdownFile(mockFile);
      expect(result.content).toBe('');
    });

    it('TC6: 应处理包含特殊字符的文件名', async () => {
      const mockContent = 'Content';
      const mockFile = new File([mockContent], 'my-file_test (1).md', { type: 'text/markdown' });
      
      const result = await openMarkdownFile(mockFile);
      expect(result.title).toBe('my-file_test (1)');
    });
  });

  // 测试用例 7: 保存 Markdown 文件
  describe('saveMarkdownFile', () => {
    it('TC7: 应生成正确的文件内容 Blob', () => {
      const content = '# Test\n\nContent';
      const title = 'test-file';
      
      const result = saveMarkdownFile(content, title);
      expect(result).toHaveProperty('blob');
      expect(result).toHaveProperty('filename');
      expect(result.filename).toBe('test-file.md');
      expect(result.blob.type).toBe('text/markdown');
    });

    it('TC8: 文件名不应包含非法字符', () => {
      const content = 'Content';
      const title = 'file/with\\illegal<chars>';
      
      const result = saveMarkdownFile(content, title);
      expect(result.filename).not.toContain('/');
      expect(result.filename).not.toContain('\\');
      expect(result.filename).not.toContain('<');
      expect(result.filename).not.toContain('>');
    });

    it('TC9: 应处理大文件内容', () => {
      const content = 'A'.repeat(100000); // 100KB content
      const title = 'large-file';
      
      const result = saveMarkdownFile(content, title);
      expect(result.blob.size).toBe(100000);
    });
  });

  // 测试用例 10: 最近文件列表
  describe('Recent Files', () => {
    it('TC10: 应能添加文件到最近列表', () => {
      const file = { id: '1', title: 'Test', path: '/test.md', lastOpened: Date.now() };
      
      // Mock localStorage to return empty array initially
      localStorageMock.getItem.mockReturnValueOnce(null);
      
      addRecentFile(file);
      
      // Verify localStorage.setItem was called
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });

    it('TC11: 最近列表不应超过 10 个文件', () => {
      const existingFiles = Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        title: `File ${i}`,
        path: `/file${i}.md`,
        lastOpened: Date.now() - i * 1000,
      }));
      
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(existingFiles));
      
      addRecentFile({ 
        id: 'new', 
        title: 'New File', 
        path: '/new.md', 
        lastOpened: Date.now() 
      });
      
      const setItemCall = localStorageMock.setItem.mock.calls[0];
      const savedFiles = JSON.parse(setItemCall[1]);
      expect(savedFiles.length).toBeLessThanOrEqual(10);
    });

    it('TC12: 重复添加同一文件应更新位置而非重复', () => {
      const file = { id: '1', title: 'Test', path: '/test.md', lastOpened: Date.now() };
      
      localStorageMock.getItem.mockReturnValueOnce(null);
      addRecentFile(file);
      
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify([file]));
      addRecentFile({ ...file, lastOpened: Date.now() + 1000 });
      
      const setItemCall = localStorageMock.setItem.mock.calls[1];
      const savedFiles = JSON.parse(setItemCall[1]);
      expect(savedFiles).toHaveLength(1);
    });

    it('TC13: 最近文件应按打开时间排序', () => {
      const file1 = { id: '1', title: 'First', path: '/first.md', lastOpened: 1000 };
      const file2 = { id: '2', title: 'Second', path: '/second.md', lastOpened: 2000 };
      
      localStorageMock.getItem.mockReturnValueOnce(null);
      addRecentFile(file1);
      
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify([file1]));
      addRecentFile(file2);
      
      const setItemCall = localStorageMock.setItem.mock.calls[1];
      const savedFiles = JSON.parse(setItemCall[1]);
      expect(savedFiles[0].title).toBe('Second');
    });
  });
});
