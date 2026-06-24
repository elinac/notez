import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { 
  FilePlus, 
  FolderOpen, 
  Save, 
  Clock,
  X
} from 'lucide-react';
import { 
  NoteFile, 
  createNewFile, 
  openMarkdownFile, 
  saveMarkdownFile, 
  downloadFile,
  getRecentFiles,
  RecentFile,
  openMarkdownFileTauri,
  saveMarkdownFileTauri,
  isTauri,
} from './FileOperations';
import { showMessage } from '../utils/nativeDialog';

interface FileToolbarProps {
  currentFile: NoteFile;
  onFileChange: (file: NoteFile) => void;
  onContentChange: (content: string) => void;
}

/** Methods exposed via ref for keyboard shortcut triggers */
export interface FileToolbarHandle {
  triggerNew: () => void;
  triggerOpen: () => void;
  triggerSave: () => void;
}

export const FileToolbar = forwardRef<FileToolbarHandle, FileToolbarProps>(
  function FileToolbar({ currentFile, onFileChange, onContentChange }, ref) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [showRecent, setShowRecent] = useState(false);

  useEffect(() => {
    setRecentFiles(getRecentFiles());
  }, []);

  const handleNewFile = () => {
    const newFile = createNewFile();
    onFileChange(newFile);
    onContentChange(newFile.content);
  };

  const handleOpenFile = async () => {
    if (isTauri()) {
      // Native file dialog in Tauri
      try {
        const noteFile = await openMarkdownFileTauri();
        if (noteFile) {
          onFileChange(noteFile);
          onContentChange(noteFile.content);
          setRecentFiles(getRecentFiles());
        }
      } catch (error) {
        console.error('Failed to open file:', error);
        void showMessage('打开文件失败', { kind: 'error' });
      }
    } else {
      // Browser: trigger hidden file input
      fileInputRef.current?.click();
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const noteFile = await openMarkdownFile(file);
        onFileChange(noteFile);
        onContentChange(noteFile.content);
        setRecentFiles(getRecentFiles()); // Refresh recent files
      } catch (error) {
        console.error('Failed to open file:', error);
        void showMessage('打开文件失败', { kind: 'error' });
      }
    }
    // Reset input
    e.target.value = '';
  };

  const handleSaveFile = async () => {
    if (isTauri()) {
      // Native save in Tauri (overwrites existing path or shows save-as dialog)
      try {
        const savedPath = await saveMarkdownFileTauri(currentFile, currentFile.content);
        if (savedPath) {
          onFileChange({ ...currentFile, isDirty: false, path: savedPath });
        }
      } catch (error) {
        console.error('Failed to save file:', error);
        void showMessage('保存文件失败', { kind: 'error' });
      }
    } else {
      // Browser: download
      const { blob, filename } = saveMarkdownFile(currentFile.content, currentFile.title);
      downloadFile(blob, filename);
      onFileChange({ ...currentFile, isDirty: false });
    }
  };

  const handleRecentFileClick = (recentFile: RecentFile) => {
    if (recentFile.content !== undefined) {
      // Restore file from stored content snapshot
      const noteFile: import('./FileOperations').NoteFile = {
        id: recentFile.id,
        title: recentFile.title,
        content: recentFile.content,
        path: recentFile.path,
        extension: '.md',
        isDirty: false,
        lastModified: recentFile.lastOpened,
      };
      onFileChange(noteFile);
      onContentChange(noteFile.content);
    } else {
      // No cached content — ask user to re-open manually
      void showMessage(
        `请重新打开文件：${recentFile.path}\n（内容未缓存，请使用 Open 按鈕打开）`,
        { kind: 'info' },
      );
    }
    setShowRecent(false);
  };

  // Expose imperative handles for keyboard shortcuts
  useImperativeHandle(ref, () => ({
    triggerNew: handleNewFile,
    triggerOpen: handleOpenFile,
    triggerSave: handleSaveFile,
  }));

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-gray-100 border-b border-gray-300">
      {/* New File */}
      <button
        onClick={handleNewFile}
        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
        title="New File (Ctrl+N)"
      >
        <FilePlus size={16} />
        <span>New</span>
      </button>

      {/* Open File */}
      <button
        onClick={handleOpenFile}
        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
        title="Open File (Ctrl+O)"
      >
        <FolderOpen size={16} />
        <span>Open</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt,.markdown"
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Save File */}
      <button
        onClick={handleSaveFile}
        className={`flex items-center gap-1 px-3 py-1.5 text-sm border rounded transition-colors ${
          currentFile.isDirty 
            ? 'bg-blue-500 text-white border-blue-500 hover:bg-blue-600' 
            : 'bg-white border-gray-300 hover:bg-gray-50'
        }`}
        title="Save File (Ctrl+S)"
      >
        <Save size={16} />
        <span>Save{currentFile.isDirty && ' *'}</span>
      </button>

      <div className="w-px h-6 bg-gray-300 mx-2" />

      {/* Recent Files */}
      <div className="relative">
        <button
          onClick={() => setShowRecent(!showRecent)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          title="Recent Files"
        >
          <Clock size={16} />
          <span>Recent</span>
          {recentFiles.length > 0 && (
            <span className="ml-1 text-xs bg-gray-200 px-1.5 rounded-full">
              {recentFiles.length}
            </span>
          )}
        </button>

        {showRecent && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-300 rounded shadow-lg z-50">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
              <span className="text-sm font-medium">Recent Files</span>
              <button
                onClick={() => setShowRecent(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            </div>
            {recentFiles.length === 0 ? (
              <div className="px-3 py-4 text-sm text-gray-500 text-center">
                No recent files
              </div>
            ) : (
              <ul className="max-h-48 overflow-auto">
                {recentFiles.map((file) => (
                  <li key={file.id}>
                    <button
                      onClick={() => handleRecentFileClick(file)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 transition-colors"
                    >
                      <div className="font-medium truncate">{file.title}</div>
                      <div className="text-xs text-gray-500 truncate">{file.path}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Current File Info */}
      <div className="text-sm text-gray-600">
        {currentFile.title}
        {currentFile.isDirty && <span className="text-blue-500 ml-1">*</span>}
      </div>
    </div>
  );
}
);
