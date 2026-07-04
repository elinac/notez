# MDXEditor 全屏引擎替换评估（方案 B · 备选）

**状态：** 待后续评估（方案 A 进行中）  
**日期：** 2026-07-03  
**触发条件：** 方案 A Spike 失败，或 `patch-package` 在可预见版本内无法消除  
**已批准路径：** [Milkdown 工具栏治理设计](./2026-07-03-milkdown-toolbar-governance-design.md)

---

## 摘要

将 NoteZ **全屏 WYSIWYG 模式**的引擎从 Milkdown Crepe 替换为 [MDXEditor](https://mdxeditor.dev/)，保留 CodeMirror 驱动的源码/分屏模式与 `PlantUMLRenderer` 预览管线。

**核心价值：** 代码块工具栏与图表扩展在 **React 层**完成，彻底避免 patch Vue 编译产物。

**主要代价：** 全屏体验从 Typora 感变为 Notion/Google Docs 式富文本；一次性迁移工作量；包体增大。

---

## 何时启动本方案

满足以下 **任一** 条件时，将状态更新为「建议启动」并安排 Spike：

1. 方案 A 阶段 0 Spike 结论：Crepe 7.x 无法在 **不 patch `node_modules`** 的情况下实现图表代码块工具栏
2. Milkdown 连续两个 minor 版本破坏现有 patch，合并成本 > 2 人日
3. 产品决策明确优先「编辑器可维护性」 over 「Typora 语义」

**不启动的情况：**

- 方案 A 成功删除 patch 或缩小到可接受范围
- 团队资源不足以承担 1–2 周 WYSIWYG 迁移

---

## 现状 vs 目标架构

### 现状（双引擎）

```
edit / split  → CodeMirror 6 + PlantUMLRenderer（不变）
wysiwyg       → Milkdown Crepe + patch + DOM 注入
```

### 目标（仍为双引擎，仅替换 wysiwyg）

```
edit / split  → CodeMirror 6 + PlantUMLRenderer（不变）
wysiwyg       → MDXEditor（Lexical + 插件）
```

**不变量：**

- 三种模式 UI（源码 / 分屏 / 全屏）保留
- Markdown 字符串作为持久化格式
- `diagramRenderers` 注册表与 PlantUML/Mermaid 渲染逻辑复用
- 分屏右侧预览仍用 `PlantUMLRenderer`，不用 MDXEditor 预览

---

## 与 Milkdown 的能力对照（NoteZ 相关项）

| 能力 | Milkdown Crepe（现） | MDXEditor（备） | 迁移影响 |
|------|---------------------|-----------------|----------|
| 代码块工具栏定制 | patch Vue | React `toolbarPlugin` + `ConditionalContents` | **主要收益** |
| 代码块预览扩展 | `renderPreview` 回调 | `CodeBlockEditorDescriptor` + React `Editor` | 需重写，逻辑可移植 |
| `previewOnlyByDefault` | 内置 | 需自实现聚焦/失焦状态 | 中等工作量 |
| 表格 | `CrepeFeature.Table` | `tablePlugin()` | 相当 |
| Typora 语法显隐 | 有 | 无（富文本块） | 产品可接受（已确认） |
| 主题 | Crepe CSS 变体 | `contentEditableClassName` + 自有 CSS | 需重做 `editorThemes` 映射 |
| 大纲跳转 | `wysiwygContainerRef` DOM | `editorRootElementRef$` 或容器 ref | 胶水层调整 |
| 包体 | 中等 | ~850KB 级（需实测） | Tauri 需 profiling |

---

## 技术设计草案

### 1. 新组件：`MdxWysiwygEditor.tsx`

替换 `WysiwygEditor.tsx`，接口保持一致：

```ts
interface WysiwygEditorProps {
  content: string;
  onChange: (content: string) => void;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}
```

### 2. 插件组合（最小集）

```tsx
<MDXEditor
  markdown={content}
  onChange={onChange}
  plugins={[
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    imagePlugin(),
    tablePlugin(),
    codeBlockPlugin({
      codeBlockEditorDescriptors: [
        plantUmlCodeBlockDescriptor,
        mermaidCodeBlockDescriptor,
        // fallback: CodeMirrorEditor for other languages
      ],
    }),
    codeMirrorPlugin({
      codeBlockLanguages: [...cmLanguages, ...diagramLanguages],
      codeMirrorExtensions: [getCodeBlockSyntaxExtension(codeBlockThemeId)],
    }),
    toolbarPlugin({ toolbarContents: () => <NoteZToolbar /> }),
  ]}
/>
```

**注意：** 不使用 `diffSourcePlugin` 作为源码模式——源码/分屏继续由外层 `MarkdownEditor` 的 CodeMirror 负责，避免双源码编辑器状态同步问题。

### 3. 图表代码块 Descriptor

为 `plantuml` / `mermaid`（及别名 `puml` / `mmd`）各实现一个 `CodeBlockEditorDescriptor`：

| 职责 | 实现要点 |
|------|----------|
| `match` | `language` 小写匹配注册表 |
| `Editor` | React 组件：`useCodeBlockEditorContext()` 读写 `code` / `language` |
| 预览 | 复用 `renderDiagramPreview` 或内联调用 `registerDiagramRenderer` |
| 工具栏 | 组件内渲染缩放、复制；或通过 `ConditionalContents` 在全局 toolbar 显示 |
| 键盘 | `onKeyDown` 内 `e.nativeEvent.stopImmediatePropagation()` 防止 Lexical 抢事件 |
| 聚焦行为 | 聚焦：CodeMirror 或 textarea 编辑；失焦：显示 SVG 预览（模拟 `previewOnlyByDefault`） |

### 4. 工具栏：`NoteZToolbar`

```tsx
<ConditionalContents
  options={[
    {
      when: (editor) => editor?.editorType === 'codeblock',
      contents: () => (
        <>
          <ChangeCodeMirrorLanguage />
          <DiagramZoomControls />
          <DiagramCopyControls />
        </>
      ),
    },
    {
      fallback: () => (
        <>
          <UndoRedo />
          <BoldItalicUnderlineToggles />
          <ListsToggle />
          <InsertCodeBlock />
          <InsertTable />
          {/* 按产品需求裁剪 */}
        </>
      ),
    },
  ]}
/>
```

### 5. 主题

- 停用 `useCrepeThemeStylesheet` 对 wysiwyg 的路径
- 新增 `useMdxEditorTheme`：映射 `editorThemeId`（frame / nord / crepe）到 `contentEditableClassName` 与 CSS 变量
- 代码块主题继续复用 `getCodeBlockSyntaxExtension`

### 6. 与 `MarkdownEditor` 集成

- `showWysiwyg` 时渲染 `MdxWysiwygEditor` 而非 `WysiwygEditor`
- `key` 策略：主题变化时 remount（与现 Crepe 行为一致）
- 外部 `content` 同步：监听 `markdown` prop，避免循环更新（对照现有 `externalContent` / `editingContent` ref 模式）

---

## 迁移步骤（预估）

| 阶段 | 工作项 | 预估 |
|------|--------|------|
| B0 Spike | 单文件原型：plantuml descriptor + 预览 + 一个工具栏按钮 | 2–3 天 |
| B1 核心替换 | `MdxWysiwygEditor`  Feature parity：标题、列表、链接、代码块、表格 | 3–5 天 |
| B2 图表parity | 缩放、复制代码/图片、mermaid、错误 UI | 2–3 天 |
| B3 集成 | 主题、大纲、模式切换、测试 | 2–3 天 |
| B4 清理 | 移除 `@milkdown/*`、patch、`useCrepeThemeStylesheet`（若仅 wysiwyg 使用） | 1 天 |

**合计：** 约 10–15 人日（视 Spike 结果浮动）

---

## 依赖变更

### 新增

```json
"@mdxeditor/editor": "^3.x"
```

### 可移除（迁移完成后）

```json
"@milkdown/crepe": "^7.19.2",
"@milkdown/kit": "^7.19.2",
"@milkdown/react": "^7.19.2"
```

以及 `patches/@milkdown+components+7.19.2.patch`、`postinstall` 若仅服务该 patch 可评估是否保留 patch-package。

---

## 风险

| 风险 | 严重度 | 说明 |
|------|--------|------|
| Lexical ↔ Markdown 往返损失 | 中 | 复杂嵌套列表、表格边缘情况需回归 |
| 包体与冷启动 | 中 | Tauri WebView 需实测首屏与内存 |
| MDXEditor 版本迭代 | 低 | API 较稳定，但需 pin 版本 |
| 双引擎状态同步 | 低 | 模式切换时已有 `replaceAll` 模式可复用 |
| 图表块「预览仅失焦」自实现 bug | 中 | 需单测 + 手工用例覆盖 |

---

## 测试计划（迁移后）

与方案 A 手工冒烟清单一致，额外增加：

- [ ] MDXEditor 往返：全屏编辑 → 切源码模式，Markdown 无意外改写
- [ ] 嵌套列表、表格、链接在两种模式间一致
- [ ] `editorThemeId` 三主题在全屏模式视觉正确
- [ ] 生产构建 `npm run tauri build` 包体与启动时间对比基线

---

## 决策记录

| 日期 | 决策 |
|------|------|
| 2026-07-03 | 方案 B 存档；优先执行方案 A |
| 2026-07-03 | Typora 体验非硬性需求，方案 B 产品阻力降低 |

---

## 参考

- [MDXEditor 代码块文档](https://mdxeditor.dev/editor/docs/code-blocks)
- [MDXEditor 工具栏定制](https://mdxeditor.dev/editor/docs/customizing-toolbar)
- [MDXEditor 表格](https://mdxeditor.dev/editor/docs/tables)
- [CodeBlockEditorDescriptor API](https://mdxeditor.dev/editor/api/interfaces/CodeBlockEditorDescriptor)
- 项目内对比讨论：2026-07-03 brainstorming（Milkdown vs MDXEditor 工具栏/代码块/表格/三模式）
