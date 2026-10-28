# 扉页 · Feiye

> 每一篇，都从扉页开始。

扉页是一款**本地优先的 Markdown 桌面编辑器**。它不接管你的文件，不要求登录，也不把内容藏进数据库——每一篇文档都是磁盘上一个普通的 `.md` 文件。打开即写，保存即落盘。

---

## 为什么叫扉页

扉页是一本书的标题页，是正文开始之前的那一页。它不喧宾夺主，却决定了读者对一本书的第一印象。

我们希望这款编辑器也是这样：安静地待在系统里，不打断思路，只负责把文字稳稳地留在本地。

英文名 **Feiye** 直接取自拼音，短、好记，也方便作为仓库名、包名和命令名。

## 项目状态

> **第一个功能里程碑已完成。** 打开文件夹作为工作区、Markdown 文件树、CodeMirror 6 源码编辑、手动保存（Ctrl+S）、保存冲突检测，以及「源码 / 分栏 / 预览」三种视图已经可用，预览支持 GFM、KaTeX 与 Shiki。
>
> 下一步是类 Typora 的所见即所得模式（`viewMode` 已预留接缝）。自动保存、目录监听、Mermaid、大纲与滚动同步尚未实现。

本文档同时作为项目的产品说明与技术方案，后续的实现、迭代和发布都以这里为准。

## 设计原则

1. **本地优先**
   文档保存在用户自己的磁盘上，离线可用，不需要账号，不依赖任何云服务。

2. **纯文本**
   Markdown 是唯一事实来源，不引入私有格式、数据库或隐藏元数据。用户随时可以用任何编辑器打开自己的文件。

3. **快**
   Tauri 2 使用系统 WebView，冷启动和内存占用都优于 Electron；编辑器采用 CodeMirror 6，面向大文档优化。

4. **安静**
   界面克制，默认只保留写作需要的东西。功能可以多，但不能挤占正文。

5. **数据安全**
   原子写入、自动保存、外部修改检测、异常恢复。任何可能覆盖用户内容的行为都必须明确提示。

6. **安全渲染**
   Markdown 中的 HTML 经过清理；Mermaid 使用严格模式；外部链接交给系统浏览器打开。

## 功能规划

### 已完成（当前里程碑）

- 工作区与文件树：打开一个文件夹作为工作区；只展示目录与 `.md` / `.markdown` / `.mdx`；懒加载、右键新建/重命名/删除（进回收站）；记住上次工作区
- 文件操作：打开、手动保存（Ctrl/Cmd+S）、保存冲突检测（拒绝静默覆盖，可重新加载）
- CodeMirror 6 编辑器：Markdown 语法高亮、行号、查找替换、撤销/重做、换行与光标状态
- 三种视图：源码 / 分栏 / 预览，选择会持久化
- 实时预览：GFM（表格、任务列表、删除线）、Shiki 代码高亮、KaTeX 行内与块级公式
- 安全渲染：先 `rehype-sanitize` 再渲染，原始 HTML 中的脚本与事件属性会被清除
- 未保存守卫：切换文件、切换工作区、关闭窗口时提示保存 / 放弃 / 取消
- 写入可靠性：临时文件 + 原子替换；外部修改以 mtime 检测
- 主题：亮 / 暗跟随系统（`prefers-color-scheme`）

### 计划中

- 类 Typora 的所见即所得编辑模式
- 标题锚点与目录、大纲与滚动同步
- Mermaid 图表
- 自动保存与异常恢复副本
- 目录监听（保存之外的外部修改提示）、覆盖 / 另存副本
- 设置界面：字体、字号、行宽、预览开关
- 手动亮/暗主题切换
- 另存为、最近打开、导出 HTML

### 后续

- 多标签与分屏编辑
- 工作区全文搜索
- 文档历史与本地快照
- 导出 PDF
- 图片粘贴与拖拽，自动保存到文档同级的 `assets/` 目录
- 自定义 CSS 与主题
- 命令面板
- 更细的预览性能优化（按块更新、长文档虚拟化）

### 暂不做

- 账号、云同步、多人协作
- 私有文档格式或数据库
- 移动端（先把桌面端做好）
- 插件市场（先稳定核心编辑体验）

## 技术栈

| 层 | 技术 | 作用 | 选择理由 |
| --- | --- | --- | --- |
| 桌面容器 | **Tauri 2**（Rust） | 原生窗口、文件系统、目录监听、系统对话框、安装包 | 体积小、启动快、权限模型清晰 |
| 前端框架 | **React + TypeScript** | 界面与交互 | 生态成熟，类型安全，便于长期维护 |
| 构建工具 | **Vite** | 开发服务器、HMR、生产构建 | 启动快，配置简单 |
| 包管理与脚本 | **Bun** | 依赖安装、脚本入口 | 安装与执行速度快；Rust 侧仍由 Tauri CLI 与 Cargo 负责 |
| UI | **手写组件 + CSS 变量** | 组件与样式 | 当前用原生 CSS 设计令牌实现亮/暗主题；组件代码归项目所有，后续再评估 Tailwind / shadcn/ui |
| 编辑器 | **CodeMirror 6** | 编辑核心、Markdown 语法、扩展 | 模块化、性能好、可深度定制 |
| Markdown 解析 | **remark + rehype**（unified） | Markdown → AST → HTML/React | 插件生态完整，GFM、数学、清理都能组合 |
| 代码高亮 | **Shiki** | 代码块高亮 | 与 VS Code 同源的语法和主题，输出稳定 |
| 数学公式 | **KaTeX** | 行内/块级公式 | 渲染快，排版质量高 |
| 图表 | **Mermaid** | 流程图、时序图、甘特图等 | 文本即图表，适合 Markdown 工作流 |
| 状态管理 | **Zustand** | 工作区、UI、设置状态 | 轻量，避免把整篇文档塞进全局 store |
| 数据存储 | **本地 Markdown 文件** + Tauri Store | 文档与设置分离 | 文档保持纯文本；设置放在应用配置目录 |

### 依赖说明

- **Bun 不是 Rust 构建器**：它负责 `bun install`、前端脚本和统一的命令入口；Tauri 的 Rust 编译与安装包生成仍由 `tauri` CLI / Cargo 完成。
- **UI 层保持轻量**：不使用重型组件库；模态框、右键菜单、Toast 都是项目内的小组件，样式由 `src/styles/global.css` 的 CSS 变量统一控制。
- **Markdown 渲染不直接拼接 HTML**：统一走 `remark → rehype → sanitize` 管线，渲染结果可审计、可清理。

## 架构设计

```
┌──────────────────────────────────────────────────┐
│ Tauri 2（Rust）                                   │
│ 窗口 · 文件系统 · 目录监听 · 对话框 · 系统集成     │
└──────────────────────▲───────────────────────────┘
                       │ commands / events
┌──────────────────────┴───────────────────────────┐
│ React + TypeScript（系统 WebView）                │
│                                                  │
│  CodeMirror 6  ←── 编辑状态的唯一来源             │
│       │                                          │
│       ├── 预览管线：remark → rehype → sanitize    │
│       ├── Zustand：工作区 / 文档 / UI             │
│       └── 自绘组件 + CSS 设计令牌                 │
└──────────────────────────────────────────────────┘
```

### 数据流

1. **打开文件**
   系统对话框或文件树 → Rust 读取文件 → 交给 CodeMirror 的 `EditorState`。

2. **编辑**
   CodeMirror 事务更新文档 → 防抖 150–250ms → 交给预览管线 → 生成经过清理的 HTML/React 节点 → 更新预览。

3. **保存**
   Ctrl/Cmd+S 或保存按钮 → 从 CodeMirror 取全文 → Rust 携带打开/上次保存时的 mtime 原子写入 → 成功后更新状态栏；不自动保存。

4. **外部修改**
   保存时若磁盘 mtime 与记录不一致 → 拒绝写入 → 提示「文件已被其他程序修改」，可重新加载磁盘内容或取消。目录监听的主动提示留到后续。

### 关键设计

- **CodeMirror 是编辑状态的唯一来源。** React 不保留整篇文本的副本，避免大文档下的双份内存与状态不同步。
- **预览管线放在 Web Worker。** 解析、高亮等 CPU 工作不阻塞输入；过期的渲染任务直接取消。
- **Shiki 按需加载并缓存。** 以「语言 + 主题 + 代码哈希」为缓存键，避免重复高亮。
- **KaTeX 与 Mermaid 懒加载。** 只有文档中出现公式或图表时才加载对应模块。
- **Mermaid 严格模式。** 禁止图表中的任意脚本执行；渲染失败时保留源码并显示错误信息。
- **文件权限最小化。** Tauri capabilities 只授予工作区目录所需的读写权限，不开放任意路径。

## 性能策略

- 编辑输入不做同步的全量 Markdown 解析。
- 预览更新防抖 150–250ms，并丢弃过期的异步结果。
- 代码高亮与 Markdown 解析在 Web Worker 中执行。
- 大文档优先保证输入响应；预览可以降级为「延迟渲染」或「仅渲染可视区域」。
- 避免在 React 中逐字符更新；编辑器与预览之间只传递必要的文档版本号。
- 主题切换时复用已加载的 Shiki 主题，不重复初始化 highlighter。

## 安全与数据可靠性

### 安全

- Tauri capabilities 按工作区授权，默认不授予全局文件访问。
- 渲染进程启用 CSP，不加载远程脚本。
- Markdown 原始 HTML 经过 `rehype-sanitize` 或等价清理；禁止 `script`、`iframe`、`object`、`embed`、`form` 等标签。
- Mermaid 使用 `securityLevel: 'strict'`。
- 外部链接通过系统浏览器打开，不把任意 URL 直接交给 WebView。
- 远程图片默认允许 `https`，可在设置中关闭，避免不必要的网络请求与追踪。

### 数据可靠性

- 保存采用「临时文件 + 原子替换」，降低写入中断导致的文件损坏。
- 当前采用手动保存；切换文档、切换工作区、关闭窗口前都会检查未保存内容并提示。
- 自动保存与恢复副本属于后续计划；将来会采用防抖写入，并把恢复副本放在应用数据目录，不污染工作区。
- 外部修改检测基于文件 mtime，冲突时拒绝写入，绝不静默覆盖。
- 任何删除操作都需要确认，优先提供「移到回收站」而不是永久删除。

## 目录结构

```
Feiye/
├─ src/                          # React 前端
│  ├─ app/                       # 应用壳：标题栏、侧栏、编辑/预览分栏、状态栏
│  ├─ components/                # Dialog / Menu / Toast
│  ├─ features/
│  │  ├─ editor/                 # CodeMirror 视图、桥接、保存与未保存守卫
│  │  ├─ preview/                # Worker 渲染管线、预览面板与样式
│  │  ├─ workspace/              # 文件树与打开/新建/重命名/删除动作
│  │  └─ settings/               # 设置界面（预留）
│  ├─ stores/                    # Zustand：workspace / document / ui
│  ├─ lib/                       # Tauri invoke 封装、路径工具
│  ├─ styles/                    # 全局样式与设计令牌
│  ├─ main.tsx
│  └─ vite-env.d.ts
├─ src-tauri/                    # Rust 桌面壳
│  ├─ src/
│  │  ├─ commands/
│  │  │  ├─ workspace.rs         # open / current / close、list_dir
│  │  │  └─ file.rs              # read / write / create / rename / delete
│  │  ├─ fs_path.rs              # 相对路径校验与工作区包含检查
│  │  ├─ error.rs                # AppError → { code, message }
│  │  ├─ lib.rs
│  │  └─ main.rs
│  ├─ capabilities/              # Tauri 权限配置（不含 fs 插件）
│  ├─ .cargo/config.toml         # rsproxy 镜像（可删除恢复默认源）
│  ├─ icons/
│  └─ tauri.conf.json
├─ public/                       # 静态资源
├─ index.html
├─ package.json
├─ vite.config.ts
├─ tsconfig.json
└─ README.md
```

## 开发

### 前置要求

- Node.js 与 **Bun**
- **Rust** 工具链（stable）
- Tauri 2 的系统依赖：
  - Windows：WebView2（Windows 10/11 通常已内置）
  - macOS：Xcode Command Line Tools
  - Linux：WebKitGTK、libappindicator 等，参见 Tauri 官方文档

### 命令

```bash
bun install
bun run tauri dev     # 启动桌面开发模式
bun run build         # 构建前端
bun run tauri build   # 打包桌面安装包
```

> 首次 `bun run tauri dev` 会编译 Rust 依赖，耗时较长；之后增量编译会快很多。

> 仓库内的 `src-tauri/.cargo/config.toml` 把 crates.io 指向了 rsproxy 镜像，用于在无法直连 crates.io 的网络下构建。如果你的网络可以直接访问 crates.io，删除该文件即可恢复默认源。

## Roadmap

| 阶段 | 目标 |
| --- | --- |
| M0 · 脚手架 | ✅ Tauri 2 + React + Vite + Bun 跑通；窗口、文件打开/保存 |
| M1 · 编辑 | ✅ CodeMirror 6、Markdown 语法、实时预览；滚动同步待做 |
| M2 · 渲染 | ✅ Shiki、KaTeX、HTML 清理与安全策略；Mermaid 待做 |
| M3 · 工作区 | 🚧 文件树、保存冲突已完成；标签、自动保存、目录监听、恢复副本待做 |
| M4 · 发布 | 主题、设置、HTML 导出、安装包、自动更新 |
| M5 · 增强 | 全文搜索、历史快照、PDF 导出、命令面板 |

## 非目标

- 不做账号体系、云同步与多人协作。
- 不把文档转换成私有格式或写入数据库。
- 不在第一阶段支持移动端。
- 不在核心体验稳定前做插件市场。

## License

待定。若计划开源，建议使用 MIT。
