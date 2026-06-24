# 随包 PlantUML 运行环境（JRE + plantuml.jar + Graphviz）

打包前将本目录填齐，**开发**与 **`tauri build`** 会把内容打进安装包的 **`$RESOURCE/resources/plantuml-runtime/`**。  
桌面端预览通过 Tauri 调用此处 JRE + PlantUML + Graphviz 渲染 SVG；若本地管线失败，编辑器会显示错误提示（不再回退到浏览器 WASM）。

## 目录约定（与 `plantuml_runtime.rs` 一致）

路径：**`src-tauri/resources/plantuml-runtime/`**（本文件所在目录）

```
plantuml-runtime/
  plantuml.jar
  jre/
    bin/
      java.exe     ← Windows
      java         ← macOS / Linux
  graphviz/
    bin/
      dot.exe      ← Windows
      dot          ← macOS / Linux
```

## 下载完成后怎么放（Windows 示例）

1. **plantuml.jar**  
   - 从 [PlantUML Download](https://plantuml.com/download) 下载 **GPL**（或你需要的许可证版本）的 `plantuml-xxxx.jar`。  
   - 复制到本目录并改名为 **`plantuml.jar`**。

2. **JRE（64 位，与 NoteZ 一致）**  
   - 从 [Adoptium Temurin](https://adoptium.net/) 下载 **JRE** zip（如 **Windows x64**）。  
   - 解压后应看到 `bin/java.exe`。将整个解压目录 **改名为 `jre`**，放到本目录下，得到：  
     `plantuml-runtime/jre/bin/java.exe`。

3. **Graphviz（64 位）**  
   - 从 [Graphviz Download](https://graphviz.org/download/) 下载 **Windows 64-bit** 安装包或 zip。  
   - 需要得到 `bin/dot.exe`。若安装程序默认在 `C:\Program Files\Graphviz`，可复制其中 **`bin` 的上一级**（含 `bin` 文件夹的那一整个目录）到本目录并改名为 **`graphviz`**，即：  
     `plantuml-runtime/graphviz/bin/dot.exe`。

4. **验证**  
   - 确认三个路径存在：  
     `jre/bin/java.exe`、`plantuml.jar`、`graphviz/bin/dot.exe`。  
   - 运行 `npm run tauri dev`，打开含 PlantUML 的笔记；控制台若未报 PlantUML 错误且图正常，即成功。

## macOS / Linux

- 将 `java`、`dot` 可执行文件放在上述对应 **`jre/bin/`**、**`graphviz/bin/`** 下即可（无需 `.exe`）。  
- macOS 若解压 JDK 得到 `…/Contents/Home`，请把 **`Home` 目录内容** 整理进 `jre/`（使 `jre/bin/java` 存在），或自行建软链接。

## 与 LGPL 版 PlantUML

LGPL 版 **不自带内置 Graphviz**，必须按上面方式提供 **`dot`**。GPL 版仍建议随包带 Graphviz，行为最稳定。

## 许可证

分发 PlantUML、Temurin、Graphviz 时，请在产品文档中保留相应许可说明。

## 排查：PlantUML 渲染失败

安装运行后，在 **可执行文件同目录**（与 `notez.exe` 相邻）会生成 **`notez-plantuml.log`**。  
每次尝试本地渲染都会追加日志，包括 `resource_dir`、解析出的 `java`/`dot` 路径、是否存在、PlantUML 的 **stderr** 与退出码。若图表未显示，请以该日志为准。

Windows 下若日志里出现类似「无法访问 jar、Invalid path」等，而路径以 **`\\?\`** 开头：这是系统 **扩展路径前缀**，部分 JVM 无法正确打开。本应用已在调用 `java -jar` 前将路径规范为普通 `D:\...` 形式（日志中可见 `normalized_*` 行）。

## 不入库

大文件默认在 `src-tauri/.gitignore` 中忽略；换机器发布前需重新放好上述目录再执行 `tauri build`。
