# Third-Party Notices

NoteZ（Apache-2.0）在构建与分发时依赖并/或捆绑下列第三方组件。除特别说明外，下列组件**不是** NoteZ 源码的一部分；其许可独立于本仓库的 `LICENSE`。

完整 npm / Rust 依赖清单可通过以下命令生成：

```powershell
npx license-checker --production --csv
cd src-tauri; cargo license --avoid-dev-deps --avoid-build-deps
```

---

## 随安装包捆绑的运行时（`src-tauri/resources/plantuml-runtime/`）

打包前需自行放入下列二进制；发布安装包时会一并分发。详见 `src-tauri/resources/plantuml-runtime/README.md`。

| 组件 | 典型许可 | 说明 |
|------|----------|------|
| [PlantUML](https://plantuml.com/) (`plantuml.jar`) | **GPL-2.0** 或 **LGPL-3.0**（取决于下载版本） | 通过 `java -jar` 子进程调用，非链接进 NoteZ 本体 |
| [Eclipse Temurin JRE](https://adoptium.net/) | **GPL-2.0 with Classpath Exception** | 随包 JRE，用于运行 PlantUML |
| [Graphviz](https://graphviz.org/) (`dot`) | **EPL-1.0**（以官方发布为准） | 布局引擎，随包分发 |

分发上述组件时，请保留各项目许可文本，并按其要求提供对应源码获取方式（GPL/LGPL/EPL 等）。

---

## 前端生产依赖（ notable ）

绝大多数 npm 生产依赖为 **MIT**、**ISC** 或 **Apache-2.0**。下列组件使用其他许可，分发时需保留其版权声明：

| 组件 | 许可 | 用途 |
|------|------|------|
| [lightningcss](https://github.com/parcel-bundler/lightningcss) | **MPL-2.0** | Tailwind CSS 4 样式编译 |
| [dompurify](https://github.com/cure53/DOMPurify) | **MPL-2.0 OR Apache-2.0** | Mermaid 等 HTML  sanitize（可选 Apache-2.0 路径） |

其余主要依赖（均为宽松许可）：React、Vite 构建链、Mermaid、Milkdown、CodeMirror、Tauri API、Zustand 等。

---

## Rust 后端（Tauri 运行时）

绝大多数 crate 为 **MIT**、**Apache-2.0** 或 **MIT OR Apache-2.0**（含 Tauri、serde、chrono、flate2、rust-sugiyama 等）。

下列 crate 使用 **MPL-2.0**（来自 Tauri / HTML 解析链，未修改使用时按 MPL 保留声明即可）：

- cssparser
- cssparser-macros
- dtoa-short
- option-ext
- selectors

---

## 开发专用依赖（通常不进入发布包）

| 组件 | 许可 | 说明 |
|------|------|------|
| potrace | GPL-2.0 | 图标生成脚本（devDependencies） |
| sharp / libvips 二进制 | LGPL-3.0-or-later 等 | 图标处理（devDependencies） |

---

## 商标

PlantUML、Graphviz、Eclipse Temurin、Tauri 等名称为其各自所有者的商标。本文件不授予任何商标使用权。
