# 需求池与决策记录

> 每轮追加一条记录，最新的在最上面。轮次编号与 `state.md` 对应。

## 模板

```
## 第 N 轮 · YYYY-MM-DD HH:mm
**用户需求**：场景 → 问题 → 期望
**产品经理**：结论（做 / 不做 / 延后）+ 一句理由
**前端**：影响模块 · 风险 · 工作量
**后端**：影响模块 · 风险 · 工作量
**裁决**：做 / 不做 / 延后
**改动**：文件列表，或「无」
**构建**：通过 / 失败 / 未运行
```

---

<!-- 从这里开始追加 -->

## 第 386 轮 · 2026-11-12 12:46
**用户需求**：场景：几千篇笔记的库里在侧栏搜正文，边想边改关键词 → 现在的问题：每改一个字，上一次全量递归扫描仍要继续读完整库，旧结果还可能晚到盖住新关键词的结果 → 期望：新查询一发出，旧扫描尽快停下，界面只显示最新关键词的结果。
**产品经理**：做。R-07 第一小步，契合「本地优先、快、安静」：不发网络请求、不建索引、不扩大产品边界；取消只影响正在跑的扫描，不改变搜索能力。
**前端**：`SearchPanel.tsx` 每次关键词变化 / 面板隐藏 / 卸载先推进代号再（去抖后）查询，收到 `cancelled` 结果直接丢弃；去抖 200ms / 保鲜 400ms 保留。`tauri.ts` 补 `nextSearchGeneration` 与 `SearchResponse`。风险：推进代号的 IPC 与下一次查询的先后；由「每次 effect 只推进一次 + 200ms 去抖窗口」规避。工作量 S。
**后端**：`commands/search.rs` 新增 `SearchState(AtomicU64)`（只原子读写，不持锁读盘）、`next_search_generation` 命令；`search_workspace` 接收 `generation`，`walk` 在每个文件 / 子目录前检查代号，不符立刻返回 `SearchResponse { hits: [], cancelled: true }`；未被取消时结果字段与原 `SearchHit` 一致（外层多一个 `cancelled`）。`lib.rs` 注册状态与命令。工作量 S。
**裁决**：做（M 级控制在小步：4 个代码文件，约 110 行）。
**改动**：`src-tauri/src/commands/search.rs`、`src-tauri/src/lib.rs`、`src/lib/tauri.ts`、`src/features/workspace/SearchPanel.tsx`；另更新 `docs/loop/backlog.md`、`docs/loop/state.md`、`docs/loop/requirements.md`。
**构建**：通过（含 tsc，vite 1.12s，仅既有的 chunk 体积与 ineffective dynamic import 提示）。`(cd src-tauri && cargo test)` 53 passed、0 failed（原 50 + 新增 3）。

**测试**
- `cargo test` 新增 3 项：
  - `walk_stops_after_cancel`：未取消时三篇都命中；检查函数第一次即返回 true 时 `walk` 返回 true、不读任何文件、`hits` 为空、只检查 1 次。
  - `stale_generation_cancels_search_state`：`SearchState.bump()` 返回 1，旧代号查询正常返回 1 条；再 `bump()` 到 2 后用旧代号检查即返回 `cancelled`、结果为空。
  - `cancel_checked_per_file_not_per_line`：50 行文件只触发 2 次检查（根目录 + 文件），证明检查频率与文件数相关而非行数。
- 其余既有测试（frontmatter、忽略目录、容器上限、2MB 上限相关路径）全部保持通过；未取消时 `hits` 结构未变。
- CDP 不可用（9222 未运行，`curl` 探一次失败），未启动应用；取消的真实手感按下列步骤人工复现。

**测试步骤（人工复现）**
1. 准备几百篇以上、总体积数十 MB 的工作区，侧栏切到「搜索」。
2. 输入一个常见词（如「的」），随即快速连续改成另一个词（如把「写作」逐字敲成「写作示例」）。预期：输入框与结果列表不卡顿；状态行只在最后一次关键词的结果返回后显示条数，旧关键词的条数不会闪回覆盖。
3. 如何观察取消生效：在关键词 A 的扫描尚未结束时改成 B，`search_workspace` 会在下一个文件前返回 `cancelled: true`（前端丢弃）；可临时在 Rust `walk` 的取消分支加一行 `eprintln!`，或观察 CPU / 磁盘占用在改词后明显早于「扫完整库」的时间回落（大库下差异最明显）。
4. 查询中途把侧栏从「搜索」切到「文件」再切回：旧扫描应被推进的代号中止；切回后按当前关键词补跑一次，结果与关键词一致。
5. 关闭标签 / 切换工作区后再搜索：结果正常，不出现空列表代替新结果（若出现，说明代号推进误伤了新查询）。
6. 回归：大小写不敏感、2MB 上限、200 条上限、跳过 frontmatter、点击结果落在命中词，均不变。

**遗留 / 下一轮候选**：
- R-07 仍保持未勾：本轮只完成「查询可取消」；mtime 增量索引（只重读变化文件）与首搜进度反馈按后续小步做。
- 代号为进程内单调递增，应用重启后从 0 开始，无持久化需求；旧查询的结果结构仍为 `SearchResponse`，前端所有调用点已同步。

## 第 385 轮 · 2026-11-12 12:40
**用户需求**：场景：记得笔记名，但不想在文件树里逐层找，也不想先搜正文 → 现在的问题：命令面板只列应用动作，全文搜索噪音大 → 期望：`Ctrl+Shift+O` 打开浮层，输入即模糊匹配文件名与相对路径，↑↓ 选择、回车打开、Esc 关闭，最近打开过的排前面。
**产品经理**：做。R-08 第一小步，契合「本地优先、纯文本、快」：只读目录项、不读正文，不建索引、不引入模糊库，也不扩大产品边界。
**前端**：新增 `QuickOpen.tsx`（复用 `.palette` / `trapTab` / 组合框语义与焦点归还）；`commands.ts` 注册一条带快捷键显示的命令；`App.tsx` 挂载浮层并把 Ctrl+Shift+O 纳入弹层互斥；`tauri.ts` 补封装。最近顺序复用工作区已有的 `recent`（打开笔记时本来就会 `noteRecent`）。风险：浮层与命令面板 / 速查的按键互斥。工作量 M（约 170 行）。
**后端**：`commands/workspace.rs` 新增 `list_markdown_files`：递归列出 Markdown，跳过隐藏项 / 符号链接 / `IGNORED_DIRS`（node_modules 等），按相对路径排序，上限 20,000；只 `read_dir`，不读文件内容。工作量 S。
**裁决**：做（M 级，6 个文件，前后端各一小块）。
**改动**：`src/features/commands/QuickOpen.tsx`（新增）、`src/features/commands/commands.ts`、`src/app/App.tsx`、`src/lib/tauri.ts`、`src-tauri/src/commands/workspace.rs`、`src-tauri/src/lib.rs`；另更新 `docs/loop/backlog.md`、`docs/loop/state.md`、`docs/loop/requirements.md`。
**构建**：通过（含 tsc，vite 1.11s，仅既有的 chunk 体积与 ineffective dynamic import 提示）。`(cd src-tauri && cargo test)` 50 passed、0 failed（原 49 + 新增 1）。

**测试**
- 快捷键核对：`Ctrl+O` 是打开工作区，`Ctrl+Shift+O` 此前未注册（带 Shift 时旧逻辑仍走 Ctrl+O），本轮把 Shift 分支提前拦截；与 `Ctrl+/`、`Ctrl+Shift+P`、`Ctrl+Alt+H`、`Ctrl+,` 无冲突。
- bun 直调 `fuzzyMatch`（从 `QuickOpen.tsx` 原样抽取函数体，Bun.Transpiler 转译后直调）10 组用例 10/10 PASS：空查询 / 纯空白、大小写不敏感（RD→README.md）、子序列（rdm）、顺序不符不匹配（dmr）、路径分隔（a/b）、首尾空白、无匹配、中文路径、中文子序列。
- `cargo test` 新增 `lists_markdown_files_recursively`：递归命中 `子目录/c.md`、跳过 `.hidden/` 与 `node_modules/`、忽略 `.png`、结果按相对路径排序、均为文件。
- CDP 不可用（9222 未运行，`curl` 探一次失败），未启动应用；浮层交互按下述步骤人工复现。

**测试步骤（人工复现）**
1. 打开工作区，按 `Ctrl+Shift+O`：浮层出现，输入框获焦；尚未输入时应先看到最近打开过的笔记，其余按相对路径排序（同一目录内按路径字典序）。
2. 输入文件名片段（如 `rdm` 命中 `README.md`、`a/b` 命中子目录里的 `a/b.md`），大小写不敏感；无匹配显示「没有匹配的笔记」。
3. ↑↓ 移动高亮（列表跟随滚动），回车打开；标签、浏览历史与阅读位置行为应与文件树打开一致，焦点落到正文。子目录里的笔记标题行显示文件名、右侧显示所在目录。
4. 打开后再次 `Ctrl+Shift+O`：刚打开的那篇应排在最前（复用工作区「最近打开」）。
5. Esc / 点遮罩关闭，焦点回到打开前的控件；命令面板 / 设置 / 历史 / 速查开着时按 `Ctrl+Shift+O` 不叠开，快速打开开着时按其它弹层快捷键也不叠开。
6. 未打开工作区时按 `Ctrl+Shift+O`：提示「先打开一个工作区再快速打开笔记」，不出现浮层。
7. 命令面板输入「快速打开」应能看到该命令及 `Ctrl+Shift+O` 快捷键；执行效果同上。
8. 读取失败（如临时移除目录权限）：浮层内一行「读取文件失败，请稍后重试」，不崩溃。

**遗留 / 下一轮候选**：
- 只按文件路径做子序列过滤，未做相关性打分（如文件名命中优先）；正文 / 路径混合匹配与最近使用持久化按需求拆到后续轮次。
- 每次打开都重读目录；大库（上万篇）打开时可能有短暂延迟，后续可复用第 368 轮的目录 revision 做缓存。
- R-08 保持未勾，待真机交互确认后再勾。

## 第 384 轮 · 2026-11-12 14:05（检验轮：回归 380–383）
**用户需求**：无新需求；按循环规则系统性回归上一批 4 条改动（380–383），确认构建、后端测试与关键路径没有回退，并重点复核第 381 轮存储清理这类不可逆操作。
**产品经理**：检验轮不扩大产品边界，只核对 380–383 是否兑现承诺；发现真实缺陷才修，否则记录结论。
**前端**：逐项静态核对 `HistoryDialog.tsx`、`SettingsDialog.tsx` / `settings.css`、`editor-bridge.ts` / `scroll-sync.ts`；用 bun 从源码切出 `shouldIgnoreProgrammaticScroll` 与 `APPLIED_SCROLL_GRACE_MS`（原样抽取，不复制实现）直调 12 组边界用例。
**后端**：核对 `commands/search.rs`、`commands/history.rs`（`clear_history` / `clear_recoveries` 返回值）、`history.rs` / `recovery.rs` 的清理实现；从已安装的 tauri 2.12.5 源码（`scripts/process-ipc-message-fn.js`）确认 IPC 参数走 `JSON.stringify`，值为 `undefined` 的键被丢弃，`clearHistory()` 不传参在 Rust 侧得到 `None`（清空全部）而非 `Some(0)`。
**裁决**：检验轮，无新功能；发现 1 个真实缺陷并本轮修复。

**逐项结论**
- **380 历史版本单条删除：通过。** `deleteHistory(relPath, id)` 与 Rust `delete_history(rel_path, id, …)` 参数顺序一致；确认框文案含时间与「删除后不可恢复」，`choice !== "delete"` 时直接返回、不发请求、不改列表；删除成功后 `nextIndex = min(原位置, 剩余数-1)`，删中间选中原位置的下一条、删末条退到上一条、删空进空态并把焦点交给「关闭」（`pendingFocus = -1`）；失败只 Toast、`entries` 不变；`deleting` 同时挡住重复点击与再次确认；Esc 在 `ui.confirm` 打开时放行给确认框，方向键 / Home / End / 对比 / 恢复路径未改。唯一的瞬态：`setSelected` 到读盘 effect 之间有一帧，恢复按钮尚未被 `reading` 禁用而 `content` 仍是旧版本，实际不可点中（<16ms，未处理）。
- **381 设置「存储」区：发现并修复 1 个缺陷，其余通过。** 分类顺序为外观排版 / 编辑行为 / 视图与预览 / **存储** / 快捷键 / 关于，符合设计；统计读取失败时 `stats` 为 null，`summary` 显示「无法读取存储统计」且三个按钮全部禁用（`emptyHistory` / `emptyRecovery` 为 true），不会在失败态可点；0 份时对应按钮禁用；「取消」只返回、绝不调用命令（仅在 `choice === "clear"` 时 `run`）；完成后重读统计；三个按钮分别调 `clearHistory(30)` / `clearHistory()` / `clearRecoveries()`，返回值都是删除份数（`history::clear_history` → `usize`，`recovery::clear_all` → `usize`），Toast「已清理 N 份快照 / 恢复副本」与数量一致；「清空全部快照」不影响已保存正文，历史弹层每次打开都重新 `listHistory`，会话中已打开文档的历史列表在下次打开时自然一致。**缺陷**：清理期间三个按钮被 `busy` 禁用，确认框关闭时 `DialogHost` 把焦点还给触发按钮，该按钮随即禁用 → 浏览器把焦点丢回 `body`，键盘用户清理完要从设置顶部重走（三个按钮均受影响，全清空后更明显）。修复 `b9f2d73`：清理落定后若 `document.activeElement` 仍是 `body`，焦点交给存储区第一个可用按钮，全部清空时交给存储区容器（`tabIndex=-1`，`trapTab` 已排除 -1 不会多出 Tab 停靠点）；用户已移到别处则不抢。
- **382 分栏恢复阅读位置抑制：通过。** `restoringScroll` 只在 `restoreEditorScroll` 里 +1，两层 rAF 里 `Math.max(0, …)` 减 1，计数器成对；`unmountEditor` 归零时残留回调再减也被钳在 0，异常路径不会永久 >0（唯一理论风险是窗口隐藏时 rAF 暂停、计数器短暂留着，恢复可见即解除）。bun 直调 12 组用例全部符合预期：未写入不忽略、±1 回声忽略、宽限内被钳制 205px 忽略、119ms 忽略、恰 120ms 视为用户滚动、宽限后同位置仍按回声、零值 ±1 边界。`restorePending` 在恢复结束后只做一次「编辑器 → 预览」对齐，方向固定，不会反向推挤；宽限窗口内极快的用户滚动最多被吞一次，下一次滚动事件即恢复。窄窗口（≤880px）仍跳过同步。
- **383 搜索跳过 frontmatter：通过。** `frontmatter_end` 边界与测试一致（空 / 首行非 `---` 返回 0、BOM 与行尾空白、CRLF、未闭合、第 500 行闭合算、第 501 行不算）；`walk` 用 `enumerate().skip(skip)`，行号仍按原文计算；匹配仍 `line.to_lowercase().contains(&needle)`，大小写不敏感与查询 trim 未变；只影响文件开头，正文分隔线不受影响；其它搜索行为（忽略目录 / 隐藏项 / 2MB 上限 / 200 条上限）未动。

**改动**：`src/features/settings/SettingsDialog.tsx`（+17/−1，修复）；另更新 `docs/loop/backlog.md`、`docs/loop/state.md`。未新增依赖、未改构建配置、未碰 README「暂不做」、未改 `src-tauri/`。
**构建**：`$HOME/.bun/bin/bun run build` 通过（含 tsc，vite 1.13s / 修复后 1.31s，仅既有的 chunk 体积与 ineffective dynamic import 提示）；`(cd src-tauri && cargo test)` 49 passed、0 failed。
**测试**：bun 直调 `shouldIgnoreProgrammaticScroll`（从源码原样抽取函数与常量）12 组用例 12/12 PASS；CDP 不可用（9222 未运行，`curl` 探一次失败），未启动应用。
**测试步骤（人工复现）**：
1. 启动应用，`Ctrl+,` →「存储」，确认两块统计正常显示、三个按钮按份数启用 / 禁用。
2. 用键盘 Tab 到「清理 30 天前的快照」回车 → 确认框「清理 / 取消」：选「取消」，数字与列表不变。
3. 再执行并选「清理」：完成后 Toast 显示「已清理 N 份快照」，数字减少；改动前焦点回到页面开头（`document.activeElement` 为 `BODY`），修复后焦点落在存储区第一个可用按钮。
4. 依次清空全部快照与恢复副本：Toast 数量与减少量一致，两行变「0 份」、对应按钮禁用；修复后焦点停在存储区容器上（不会再丢到页面）。
5. 历史弹层一致性：清空全部快照后打开「文档历史」，应为空态（弹层每次打开重新读盘）；恢复副本清空不影响已保存正文与文件树。
6. 统计失败态：临时让 `storage_stats` 失败（如无数据目录权限），两行显示「无法读取存储统计」，三个按钮保持禁用。
7. 历史单条删除回归：`Ctrl+Alt+H` → 方向键选中中间版本 → 删除并确认，选中并聚焦相邻版本；删到空显示空态、焦点在「关闭」；取消不改列表。
8. 搜索回归：frontmatter 笔记搜「写作」只命中正文一行、行号对得上；搜「tags」无结果；正文中段的 `---` 分隔线不影响其后命中。
9. 分栏回归：长文档滚到中段切走再切回，两侧 `scrollTop` 回到原处（偏差 <2px），随后手动滚两侧仍双向跟随。

**遗留 / 下一轮候选**：
- R-04 仍需真机按第 382 轮步骤复核后再勾 `[x]`；本轮只做了纯函数边界复核。
- 380 的瞬态（删除后一帧内恢复按钮仍指旧内容）未修，实际不可点中；若后续给删除加动画再评估。
- 存储清理后历史目录可能残留空哈希目录（第 379 轮已记录），不影响统计。
- 计数清零，第 385 轮按正常需求轮，从 `requirements.md` 取候选。

## 第 383 轮 · 2026-11-12 13:42
**用户需求**：场景：笔记开头用 frontmatter 记 `tags: [写作]` 和注释 → 现在的问题：全文搜索把 `title:` / `tags:` / 注释里的 `#` 也当正文命中，结果点开常落在元数据行 → 期望：搜索只命中正文，结果行号仍对应编辑器里的真实位置。
**产品经理**：做。R-10 搜索侧收尾，与第 376 轮预览 / 大纲规则保持一致；只过滤文件开头的元数据区，不改搜索的匹配、排序与返回结构，属于「快、安静」边界内的修正。
**前端**：无改动。搜索面板文案已能覆盖「正文」，不做调整。
**后端**：`src-tauri/src/commands/search.rs` 新增纯函数 `is_fence` / `frontmatter_end(&[&str]) -> usize`：首行（允许 BOM）与闭合行去掉行尾空白后都是 `---`，闭合须在前 500 行内，否则返回 0（不丢任何内容）；`walk` 读取文件后按 `content.lines()` 收集行，跳过前 N 行参与匹配，但 `enumerate()` 仍按原文计算行号。风险：`str::lines` 已去掉 CRLF 的 `\r`，与前端 `Text` 行文本规则一致；仅影响文件开头，正文中的 `---` 分隔线不受影响。工作量 S。
**裁决**：做（S 级，1 个源码文件，约 +50/−2 行）。
**改动**：`src-tauri/src/commands/search.rs`；另更新 `docs/loop/requirements.md`（R-10 备注）、`docs/loop/backlog.md`、`docs/loop/state.md`。未新增依赖、未改构建配置、未碰 README「暂不做」。
**构建**：`$HOME/.bun/bin/bun run build` 通过（含 tsc，vite 1.05s，仅既有的 chunk 体积与 ineffective dynamic import 提示）；`(cd src-tauri && cargo test)` 49 passed、0 failed（原 47 + 新增 2）。
**测试**：`frontmatter_end` 覆盖无 frontmatter、标准闭合、BOM + 行尾空白、CRLF、未闭合、首行非 `---`（正文分隔线不误判）、第 501 行才闭合（视为没有）、恰在第 500 行闭合；`walk` 用例确认 `tags:` / `title:` 行不命中、正文命中行号仍为 6。CDP 不可用（9222 未运行），未启动应用。
**测试步骤（人工复现）**：
1. 新建一篇笔记，开头写：
   ```
   ---
   tags: [写作]
   title: 写作草稿
   ---
   第一行
   这里提到写作。
   ```
2. 在工作区搜索框输入「写作」：只应出现「这里提到写作。」一条，不再出现 `tags` / `title` 两行。
3. 搜索「tags」：应无结果。
4. 点击该结果：编辑器光标应落在第 6 行「这里提到写作。」，而不是 frontmatter 里。
5. 反向对照：把同一段移到笔记中间（首行不是 `---`），搜索「写作」应正常命中 3 处，行号与编辑器一致。
6. 边界：frontmatter 未写闭合 `---` 时，搜索照常命中其后的正文（不丢内容）。
**遗留 / 下一轮候选**：
- 无。R-10 的搜索侧已完成；所见模式仍按源码显示（需求文档已有说明）。
- 计数到 4，第 384 轮做检验轮（回归 379–383）。

## 第 382 轮 · 2026-11-12 13:35
**用户需求**：场景：分栏模式下切走再切回一篇读在中段的笔记 → 现在的问题：预览恢复位置经滚动同步把编辑器再推约 205px，回来时不是原来那一屏 → 期望：恢复阅读位置期间两侧都不被对方推走，手动滚动时双向同步照旧。
**产品经理**：做。R-04 是已记录的真实手感缺陷，属于「快、安静」边界内；只收敛同步时序，不重写映射算法、不新增依赖、不改产品边界。真机没复核前不勾掉需求。
**前端**：`scroll-sync.ts` 新增 `shouldIgnoreProgrammaticScroll`（写入值 ±1 即回声；写入后 120ms 内位置对不上也视为布局钳制 / 滚动锚定，不反推另一侧），`run` / `schedule` 在 `isEditorScrollRestoring()` 期间只记 `restorePending` 不互推，恢复结束后以编辑器为准补对齐一次；`editor-bridge.ts` 增加 `restoringScroll` 计数与 `isEditorScrollRestoring()`，`restoreEditorScroll` 写入滚动位置后再放一帧才解除。风险：宽限窗口内极快的用户滚动会被吞一次（下一次滚动事件即恢复）；恢复结束若两侧都已落定只做一次编辑器→预览对齐，不改用户手动滚动方向。工作量 S。
**后端**：无改动。工作量 0。
**裁决**：做（S 级，2 个源码文件，+78/−2 行）。
**改动**：`src/features/editor/editor-bridge.ts`、`src/features/preview/scroll-sync.ts`；另更新 `docs/loop/requirements.md`（R-04 标题注明待真机复核，未勾选）、`docs/loop/backlog.md`、`docs/loop/state.md`。未新增依赖、未改构建配置、未碰 README「暂不做」、未改 `src-tauri/`。
**根因判断**：分栏同步把「自己刚写入预览的滚动」只按第一帧位置校验一次；写入后被图片加载 / 内容变短钳制，或滚动锚定修正了 `scrollTop`，其后的 scroll 事件就被当成用户滚动，用标题锚点 `preview → editor` 反向映射；该映射不是 `editor → preview` 的可逆映射（两个标题之间线性插值，往返不闭合），于是编辑器被推走。同时 `restoreEditorScroll` 只等一帧，恢复期与同步对齐帧重叠，加剧了互推。
**构建**：`$HOME/.bun/bin/bun run build` 通过（含 tsc，vite 1.24s，仅既有的 chunk 体积与 ineffective dynamic import 提示）；未改 `src-tauri/`，未重跑 `cargo test`。
**测试**：bun 直调 `shouldIgnoreProgrammaticScroll`（从源码切出同一份实现）7 组用例全部符合预期：无写入、±1 回声、宽限内被钳制 205px、宽限内锚定修正均忽略；宽限刚过且位置不符、边界 119ms 分别按用户滚动 / 忽略。CDP 不可用（9222 未运行），未启动应用。
**测试步骤（人工复现，改动前后对照）**：
1. 启动应用，切到分栏（宽度 > 880px），打开一篇有多个标题、能滚到中段的笔记。
2. 用真实滚轮把编辑器和预览一起滚到中段，记下编辑器 `.cm-scroller` 的 `scrollTop`（下称 A）与预览 `.preview-pane` 的 `scrollTop`（下称 B）。
3. 从文件树切到另一篇笔记，再切回原笔记；等预览渲染完成。
4. 再读两侧 `scrollTop`：改动前编辑器会相对 A 偏移约 205px；改动后两侧都应回到 A / B 附近，偏差应 < 2px，且预览显示的章节与编辑器一致。
5. 手动滚动编辑器：预览跟随；手动滚动预览：编辑器跟随，均无回弹、无来回抖动。
6. 在分栏里连续快速切 5 篇再切回，重复第 4 步，位置保持稳定。
7. 窄窗口（≤ 880px）上下堆叠时两侧各自独立滚动，不互相带动。
**遗留 / 下一轮候选**：
- R-04 需真机按上面步骤复核后再勾 `[x]`；若仍有偏差，下一步考虑把「恢复结束」改为等预览 `ResizeObserver` 稳定（连续两帧尺寸不变）再解除抑制。
- 宽限窗口 120ms 是经验值；真机上若发现快速滚轮首帧被吞，可改为「有 wheel / pointerdown / keydown 立即清除 applied 标记」。
**用户需求**：场景：长期使用后，设置里想看历史快照和崩溃恢复副本占了多少空间，也想清掉旧快照。现在的问题：设置里没有任何存储入口，只能手动翻数据目录。期望：设置新增「存储」区，显示两类文件的份数与体积，提供清理 30 天前快照、清空全部快照、清空恢复副本，清理前说明后果并二次确认。
**产品经理**：做。R-02 的 UI 收尾，属于「本地优先、数据安全、安静」边界内的存储可见与可清理；复用第 378 轮已就绪的四个命令，不新增依赖、不扩大产品边界。破坏性操作全部二次确认并写明不可恢复。图片资源统计后端没有命令，标为后续小步。
**前端**：仅 `src/features/settings/SettingsDialog.tsx` + `settings.css`。`CATEGORIES` 在「视图与预览」后新增「存储」；同文件定义 `StoragePanel`：打开分类时读一次 `storageStats()`，两块分别显示份数与 `formatBytes`（KB / MB / GB，一位小数，0 份只显示「0 份」），读取中「统计中…」、失败「无法读取存储统计」且保留上一次数字与布局；三个按钮分别调 `clearHistory(30)` / `clearHistory()` / `clearRecoveries()`，均经 `useUiStore.ask` 二次确认（danger 按钮、写明不可恢复 / 不影响正文），操作期间禁用全部按钮，完成后重读统计；成功 Toast 报清理数量，失败 Toast 报错且数字保持原值；统计为 0 时对应按钮禁用。风险：确认框与设置弹层焦点还原；面板卸载后异步回写。工作量 S。
**后端**：无改动，直接调用第 378 轮的 `storage_stats` / `clear_history` / `clear_recoveries`。工作量 0。
**裁决**：做（S 级，2 个源码文件，约 +180/−3 行）。
**改动**：`src/features/settings/SettingsDialog.tsx`（新增分类与 `StoragePanel`）、`src/features/settings/settings.css`（存储区计数与按钮行样式）；另更新 `docs/loop/backlog.md`、`docs/loop/state.md`、`docs/loop/requirements.md`。未新增依赖、未改构建配置、未碰 README「暂不做」、未改 `src-tauri/`。
**构建**：`$HOME/.bun/bin/bun run build` 通过（含 tsc，vite 1.11s，仅既有的 chunk 体积与 ineffective dynamic import 提示）；`(cd src-tauri && cargo test)` 47 passed、0 failed（本轮未改 Rust）。
**测试步骤（CDP 不可用，9222 未运行，未启动应用；以下为人工复现）**：
1. 启动应用，`Ctrl+,` 打开设置，切到「存储」：两块分别显示「文档快照」「崩溃恢复副本」的「N 份 · X MB」，首次进入短暂显示「统计中…」。
2. 与数据目录实际比对：`history/` 下 `.md` 数量与体积、恢复副本 `.json` 数量与体积一致。
3. 点「清理 30 天前的快照」：弹出确认框，正文含「将删除 30 天前的历史快照，不可恢复」；点「取消」后数字不变、焦点回到该按钮。
4. 再次执行并确认：Toast 出现「已清理 N 份快照」，数字随之减少（被保留的 30 天内快照仍在）。
5. 点「清空全部快照」：确认框写明「全部笔记的历史快照都会被删除，不可恢复」；确认后快照显示「0 份」，该行两个快照按钮变为禁用。
6. 点「清空全部恢复副本」：确认框写明「仅删除崩溃恢复副本，不影响已保存的笔记正文」；确认后恢复副本显示「0 份」且按钮禁用，笔记正文与文件树不受影响。
7. 断开 / 模拟 `storage_stats` 失败：两行显示「无法读取存储统计」，布局不跳动，按钮保持禁用。
8. 既有行为不变：设置分类键盘 ←/→ 可到「存储」，切换分类滚回顶部，Esc 关闭后焦点回正文。
**遗留 / 下一轮候选**：
- R-02 的「图片资源」统计后端暂无命令（未内联的本地图片引用数），需求文档已记为后续小步。
- 清理完成后历史目录里可能残留空的文档哈希目录（第 379 轮已记录），不影响统计。
- 存储面板的「每篇最多 20 份」是历史保留上限的说明文案，本轮未接入动态上限。

## 第 380 轮 · 2026-11-12 13:15
**用户需求**：场景：打开「文档历史」想清掉某次误存的大版本。现在的问题：历史列表只能看与恢复，单条快照无法删除，只能等它被 20 份上限挤掉。期望：选中某个版本后可以删除它，删前有明确确认，删完列表少一条并选中相邻版本。
**产品经理**：做。补上 R-06 的最后一块，属于「本地优先、数据安全」边界内的存储管理；复用第 378 轮已落地的 `delete_history` 命令，不新增依赖、不扩大产品边界。删除是破坏性操作，必须有二次确认并写明不可恢复。
**前端**：仅 `src/features/history/HistoryDialog.tsx`。`modal-actions` 增加「删除此版本」（`btn danger`，无选中项或删除中禁用，`aria-label` 带版本时间）；点击用 `useUiStore.getState().ask` 二次确认（`tone: "danger"`，说明「删除后不可恢复」）；成功后从 `entries` 移除、优先选中原位置的下一条、否则上一条，删空进空态；失败只 Toast 报错、列表保持不变；用 `pendingFocus` 在重渲染后把焦点交给新的选中项（删空则交给「关闭」）。副标题补一句「删除后不可恢复」。风险：与既有 Esc / 方向键 / 对比 / 恢复 / autoFocus 的焦点逻辑要有先后，确认框关闭的焦点还原先于删除完成的焦点交接。工作量 S。
**后端**：无改动，直接调用第 378 轮的 `delete_history` 命令与 `src/lib/tauri.ts` 的 `deleteHistory(relPath, id)`。工作量 0。
**裁决**：做（S 级，1 个源码文件，+72/−2 行）。
**改动**：`src/features/history/HistoryDialog.tsx`；另更新 `docs/loop/backlog.md`、`docs/loop/state.md`、`docs/loop/requirements.md`。未新增依赖、未改构建配置、未碰 README「暂不做」、未改 `src-tauri/`。
**构建**：`$HOME/.bun/bin/bun run build` 通过（含 tsc，vite 1.14s，仅既有的 chunk 体积与 ineffective dynamic import 提示）；未改 Rust，未重跑 `cargo test`（第 379 轮 47 项全过）。
**测试步骤（CDP 不可用，9222 未运行，未启动应用；以下为人工复现）**：
1. 打开一篇有多次保存历史的笔记，`Ctrl+Alt+H` 打开「文档历史」。
2. 用方向键选中中间某个版本，Tab 到「删除此版本」按回车（或直接点击）。
3. 确认框标题为「删除这个历史版本？」，正文含该版本时间与「删除后不可恢复」，按钮为「删除 / 取消」。
4. 点「取消」：列表条数不变，焦点回到「删除此版本」。
5. 再删除并点「删除」：列表少一条，选中并聚焦原位置的下一条（删的是最后一条则选上一条）；被删版本的内容不再出现。
6. 连续删到空：显示「还没有历史版本」空态，「删除此版本」禁用，焦点落在「关闭」。
7. 打开另一篇笔记再打开历史：删除按钮的 `aria-label` 随所选版本时间变化（如「删除 2026-11-12 14:03 的版本」）。
8. 既有行为不变：Esc 关闭并回原焦点、方向键 / Home / End 换版本、对比当前、恢复此版本。
**遗留 / 下一轮候选**：
- R-02 UI 仍未做：设置「存储」区（统计、清理 N 天前 / 全部快照、清空恢复副本与二次确认），建议第 381 轮起继续拆小步。
- 删除后若该版本正是编辑器当前内容的来源，编辑器不会自动刷新；恢复流程保持不变。
- 历史列表的「最新」标记按位置计算，删掉首条后原第二条自然成为「最新」，与后端按时间排序一致。

## 第 379 轮 · 2026-11-12 13:05（检验轮：回归 374–378）
**用户需求**：无新需求；按循环规则系统性回归上一批 5 条改动，确认构建、后端测试、命令注册与关键路径没有回退。
**产品经理**：检验轮不扩大产品边界，只核对 374–378 是否兑现承诺；发现真实缺陷才修，否则记录结论。
**前端**：逐项静态核对 `commands.ts` / `CommandPalette.tsx` / `AppMenu.tsx` / `Toolbar.tsx` / `markdown.worker.ts` / `outline.ts` / `preview.css` / `HistoryDialog.tsx`；用 bun 从源码切出 `diffLines` 与 `splitFrontmatter` 直调（组件 / Worker 模块不能直接 import）。
**后端**：核对 `history.rs` / `recovery.rs` / `commands/history.rs` / `lib.rs` 四个新命令的注册与参数映射，核实 `clear_history` 缺省参数在 Tauri 侧的 `Option` 行为。
**裁决**：检验轮，无新功能；未发现需要修改源码的缺陷。
**改动**：仅 `docs/loop/backlog.md`、`docs/loop/state.md`、`docs/loop/requirements.md`；源码零改动。
**构建**：`$HOME/.bun/bin/bun run build` 通过（含 tsc，vite 1.04s，仅既有的 chunk 体积与 ineffective dynamic import 提示）；`(cd src-tauri && cargo test)` 47 passed、0 failed。
**逐项结论**：
- 374 命令分组单一来源：`COMMAND_GROUPS` 的 8 个分组 id / 文案 / 顺序与 374 前 `AppMenu.GROUPS`、`CommandPalette.GROUP_LABELS` 完全一致；`AppMenu` 按 `onlyGroups` 过滤同一份定义，`MenuBar.MENUS` 的顶层菜单到分组映射（编辑含 find、视图含 nav）不变；命令面板「最近使用」段与分组标题仍按合并列表位置计算。一致，无回退。
- 375 导出 / 复制前内容体检：`renderMarkdownForExport` 返回 `{ html, mermaid }`，复制路径（`Toolbar.tsx` 156–197）与导出路径（405–436）都调用 `scanContentRisks`；导出有风险时走确认框、取消不写盘，复制把风险拼进成功 Toast；两条路径的渲染 / 内联 / 体检都在 `try/catch` 内，Worker 侧 `onmessage` 的 `error` 与 `onerror` 都会 `reject` `pendingExport`，因此 Worker 抛错会被既有「生成 HTML 失败 / 导出 HTML 失败」接住。生效，无回退。
- 376 折叠 YAML frontmatter 并跳过大纲：`FRONTMATTER` 锚定文件开头、允许 BOM / CRLF、无闭合不识别；正文截断后交给 remark，Mermaid 只收集正文；`details` 块在 `String(file)` 后拼接并用 `escapeHtml` 转义，导出样式也有 `details.frontmatter` 的亮 / 暗配色；`outline.ts` 在首行 `---` 后最多 500 行找闭合，跳过之前偏移的标题。直调用例（标准 LF、CRLF、空 frontmatter、中段 `---` 不识别、BOM、无闭合）全部符合预期。
- 377 历史版本对比当前：`diffLines` 去公共前后缀、变化块先删除后新增、不做逐行配对；直调用例（全同、中间改一行、开头 / 结尾插入、空旧内容、结尾换行）符合预期；`mode` / `currentText` 在每次打开或切文档时重置为「内容」与 `null`，不会把上次的快照带进下一次；`restore` 仍用所选版本内容并标记未保存。无回退。
- 378 存储命令与 API：`storage_stats` / `delete_history` / `clear_history` / `clear_recoveries` 均已在 `lib.rs` 的 `generate_handler` 中注册；`src/lib/tauri.ts` 的命令名与参数（`relPath` / `id` / `beforeDays`）与 Rust 的 `rel_path` / `id` / `before_days` 对应，`StorageStats` 的 camelCase 字段与 Rust 序列化一致。`clearHistory()` 不传参数时 `invoke` 的 args 中 `beforeDays` 为 `undefined`，JSON 序列化丢弃该键；Tauri 2.12.5 的 `CommandItem::deserialize_option` 在键缺失时 `visit_none()`（`src/ipc/command.rs:146–157`），Rust 侧得到 `None`，与「不传则清空全部」一致；传 `null` 同样落 `None`，传数字得到 `Some(days)`。无缺陷。
**遗留 / 下一轮候选**：
- R-02 UI 尚未接入：设置「存储」区（显示统计、清理 30 天前 / 全部快照、清空恢复副本，清理前二次确认）与 `HistoryDialog` 单条删除，建议第 380 轮起拆小步实现。
- 376 的搜索侧仍未跳过 frontmatter：R-10 期望「大纲与搜索跳过」，当前只有预览折叠与大纲跳过；全文搜索仍会命中 YAML 行。
- 376 的 frontmatter 识别在预览侧无行数上限、`outline.ts` 限 500 行；超过 500 行的 frontmatter 极少见，暂不处理。
- `clear_history(None)` 只删 `.md`、保留空的文档哈希目录；统计按文件计不受影响，如后续在意目录残留可在清理时顺带删空目录。
**测试步骤（CDP 不可用，9222 未运行，未启动应用；以下为人工复现）**：
- 命令面板 `Ctrl+Shift+P` 与标题栏各菜单：分组标题 / 顺序、菜单项、快捷键、禁用态与 374 前一致；执行命令后「最近使用」顺序正常。
- 打开含外链图 / 本地图 / Mermaid 的笔记：`Ctrl+Shift+C` 复制 HTML，成功 Toast 括号内出现对应风险；「导出 HTML」有风险时先弹「导出内容有风险」，选「取消」不产生文件，选「仍然导出」才写盘；打开超过 1 MB 的文档导出，应提示「导出 HTML 失败：文档超过 1 MB…」。
- 打开以 `---` 开头且有闭合的笔记：预览首屏为「元信息」折叠块，正文无横线 / 大标题；大纲不含 YAML 注释里的 `#`；导出 HTML 同样带折叠块且亮 / 暗主题可读。
- 打开有历史版本的笔记，`Ctrl+Alt+H` →「对比当前」：正常显示增删行；关闭后改正文再打开，默认回到「内容」，再切「对比当前」使用新快照。
- 接入 UI 后：设置「存储」显示的四个数字与数据目录实际一致；`clearHistory(30)` 保留最近 30 天、`clearHistory()` 清空全部；`clearRecoveries()` 只删 `.json`。
**检验计数**：0（已回归 374–378；下次检验轮为 384）。

## 第 378 轮 · 2026-11-12 12:55
**用户需求**：场景：长期使用后，应用数据目录里堆着每篇笔记最近 20 份历史快照和崩溃恢复副本。现在的问题：看不到它们占了多少空间，也没有清理入口。期望：先有后端命令与前端调用封装——统计快照 / 恢复副本的文件数与体积、删除单条快照、清理 N 天前或全部快照、清空全部恢复副本；设置 UI 下一轮再接。
**产品经理**：做（M 级里程碑拆分）。存储可见与可清理属于「本地优先、数据安全、安静」的边界内补强，不新增依赖、不扩大产品边界；本轮只做后端与 API 层，UI 拆分到 379，避免单轮过大。R-02 保持未完成。
**前端**：`src/lib/tauri.ts` 新增 `StorageStats` 类型与 `storageStats()`、`deleteHistory(relPath, id)`、`clearHistory(beforeDays?)`、`clearRecoveries()` 四个 `invoke` 封装，风格与现有函数一致；不改任何组件，UI 零变化。风险：无（未接入调用点）。工作量 S。
**后端**：`history.rs` 新增递归 `storage_stats`（只计 `.md`）、`delete_history`（复用 `document_dir` / `snapshot_path`，不存在视为成功）、`clear_history`（`None` 清空全部，`Some(cutoff)` 只删除时间戳更早的，无法解析的文件保留，删除失败跳过）；`recovery.rs` 新增 `storage_stats` 与 `clear_all`（只删 `.json`）；`commands/history.rs` 新增 `StorageStats`（camelCase）与四个命令，`storage_stats` / `clear_recoveries` 用 `AppHandle` 定位两个目录；`lib.rs` 注册四个命令；`commands/recovery.rs` 的 `recovery_dir` 放宽为 `pub(crate)` 复用。风险：递归遍历数据目录只在用户主动打开设置 / 清理时发生，文档数量级下开销可忽略；`clear_history` 的 cutoff 用毫秒时间戳，只有 `None` 表示清空全部，避免超大天数饱和到 0 时被误当成清空。工作量 M。
**裁决**：做（本轮只完成后端与 API，UI 留给 379）。
**改动**：`src-tauri/src/history.rs`（+115/−1 行，含 2 个测试）、`src-tauri/src/recovery.rs`（+54 行，含 1 个测试）、`src-tauri/src/commands/history.rs`（+54/−1 行）、`src-tauri/src/commands/recovery.rs`（+1/−1 行，`recovery_dir` 改 `pub(crate)`）、`src-tauri/src/lib.rs`（+4 行）、`src/lib/tauri.ts`（+26 行）；另更新 `docs/loop/state.md`、`docs/loop/backlog.md`、`docs/loop/requirements.md`。未新增依赖、未改构建配置、未碰 README「暂不做」。
**构建**：`cargo test` 通过（47 passed，新增 3 项）；`$HOME/.bun/bin/bun run build` 通过（含 tsc，vite 1.26s，仅既有的 chunk 体积与 ineffective dynamic import 提示）。
**用例（`cargo test` 覆盖）**：
- 写入 2 条快照（不同文档）后 `storage_stats` 文件数为 2、字节数 > 0。
- `delete_history` 只删指定 id，另一篇快照仍在；重复删除同一条仍返回成功；非法 id / 非法相对路径报错。
- `clear_history(Some(1))`（截止点在全部快照之前）删 0 份；`Some(now + 60s)` 全删；`Some(0)` 只删早于 1970 的快照（0 份）；`None` 才全删。
- `clear_all` 只删 `recovery/` 下 2 个 `.json`，同目录的 `notes.txt` 保留，再次调用返回 0。
**测试步骤（CDP 不可用，9222 未运行，未启动应用；UI 尚未接入，以下为 379 接 UI 后的验收点）**：
- 设置 →「存储」区应显示历史快照与恢复副本的文件数 / 体积（与数据目录实际文件一致）。
- 打开历史弹层删除单条：列表少一条，重新打开仍不在；对应 `history/<hash>/<id>.md` 已消失。
- 点「清理 30 天前快照」：只保留最近 30 天的快照；点「清空全部快照」：历史列表为空、统计归零。
- 点「清空全部恢复副本」：下次启动不再提示恢复；`recovery/` 下的非 `.json` 文件不受影响。
**遗留**：本轮 UI 未接，设置页「存储」区、HistoryDialog 单条删除、清理前确认与影响说明留给第 379 轮；R-02 第 39 行提到的「图片资源」统计尚未实现（需另查资源目录，本轮范围外）；清理不可撤销，379 需按 R-02 期望加二次确认。
**检验计数**：5（第 378 轮为正常需求轮，第 379 轮做检验轮）。

## 第 377 轮 · 2026-11-12 12:40
**用户需求**：场景：准备点「恢复此版本」。现在的问题：列表只有时间与大小，右侧只能看所选版本的纯文本，得靠记忆和当前正文比对，判断不出差在哪。期望：历史弹层加「内容 / 对比当前」切换；对比视图按行标出新增（`+`）与删除（`-`），顶部说明是与编辑器当前内容对比；恢复按钮行为不变。单条快照删除不在本轮。
**产品经理**：做。恢复是不可撤销的关键操作，恢复前看清差异属于「数据安全、纯文本、安静」的边界内补强，不新增依赖、不扩大产品边界；只在用户主动切换时出现，对不用对比的人零打扰，成本 S。
**前端**：`features/history/HistoryDialog.tsx` 用 `getEditorText()` 在切到对比时给正文拍快照，新增 `diffLines`（按行切分、去公共前后缀、中间变化块先列删除行再列新增行；不做 LCS，任意行数都是线性开销）；预览区顶部加两个原生按钮（复用 `.segmented`，`aria-pressed`），对比区 `<pre role="region" aria-label>` 每行 `+` / `-` / 空格前缀；无差异显示「与当前内容一致」，编辑器为空时说明无法对比；恢复仍用所选版本 `content`。风险：弹层打开期间编辑器不可编辑，快照不会过期；对比行数很多时 `<pre>` 一次性渲染，文档极大时仍可能略慢（无逐行配对，不卡构建）。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/history/HistoryDialog.tsx`（+100/−8 行）、`src/features/history/history.css`（+45/−1 行），共 2 个源码文件；另更新 `docs/loop/state.md`、`docs/loop/backlog.md`、`docs/loop/requirements.md`。
**构建**：`bun run build` 通过（含 tsc，vite 1.09s，仅既有的 chunk 体积与 ineffective dynamic import 提示）；未改 `src-tauri/`，未跑 cargo test。
**用例（`$HOME/.bun/bin/bun` 直调 `diffLines`，全部符合预期）**：组件模块会拉起依赖 DOM 的 store / 编辑器模块，不能直接 import；测试脚本读取源码切出 `DiffLine` / `diffLines` 同一份实现后执行。
- 完全相同 → 全部 `same`（界面判为「与当前内容一致」）。
- 只改中间一行 → `same a / del b / add X / same c`，一增一删。
- 开头插入一行 → 只有一条 `add`，后续 `same`。
- 结尾插入一行 → 只有一条 `add`。
- 空旧内容 → 全部 `add`，无多余删除行。
- 2500 行旧内容末尾追加一行 → 正常返回 2501 行、无报错；把中间一行替换 → 仅 1 条 `del` + 1 条 `add`（前后缀裁剪生效）。
**测试步骤（CDP 不可用，9222 未运行，未做 CDP 实测；以下为人工复现）**：
- 打开一篇已有保存历史的笔记（先按 `Ctrl+S` 留下快照），按 `Ctrl+Alt+H` 打开「文档历史」：预览区上方出现「内容 / 对比当前」两个按钮，默认「内容」且显示所选版本原文；恢复按钮可用。
- 点「对比当前」：顶部出现「与编辑器当前内容对比 · + 新增 / - 删除」，每行行首为 `+` / `-` / 空格；新增行绿字浅绿底、删除行红字浅红底；不改正文时再次切换应显示「与当前内容一致」。
- 关闭弹层，在正文里改一行、再加一行，重新打开历史并切「对比当前」：应看到对应的一增一删与一条新增，顺序在变化块内为删除行在前、新增行在后。
- 清空当前笔记正文（或打开一篇空笔记并已保存过历史）→ 切「对比当前」：显示「编辑器里还没有内容，无法对比。」而不是空白。
- 键盘：Tab 能到两个分段按钮、回车切换；对比区作为 `region` 有「与编辑器当前内容对比」名称；在左侧历史列表按 ↑↓ / Home / End 仍能换版本，不被分段按钮抢走。
- 点「恢复此版本」并确认：行为与改动前一致（载入编辑器、标记未保存、提示按 `Ctrl+S` 写盘），对比模式不影响恢复内容。
- 暗色主题下重复对比，增删行文字与底色仍可读。
**遗留**：对比只与「编辑器当前内容」比，历史版本之间互相比对未做；diff 无行内字符级高亮；弹层内的对比快照在打开期间不刷新（正文被弹层挡住，无需刷新）；单条快照删除仍留给 R-02「存储管理」。
**检验计数**：4（第 377 轮为正常需求轮，第 378 轮做检验轮）。

## 第 376 轮 · 2026-11-12 12:30
**用户需求**：场景：笔记开头用 `---` 写 `title` / `tags` / `date`。现在的问题：frontmatter 被当成 Markdown 正文，两个 `---` 触发分隔线 / Setext 标题语义，预览里出现横线和大标题，大纲也会混入 YAML 注释里的 `#`。期望：识别文件开头的 frontmatter，预览折叠成低调的「元信息」块（默认收起、可展开看原文），大纲跳过这段；所见模式本轮可以继续按源码显示，在 backlog 记为遗留。
**产品经理**：做。frontmatter 是纯文本笔记的常见约定，正确识别它属于「本地优先、纯文本、安静」的边界内修正，不新增依赖、不扩大产品边界；默认收起、只在预览出现，对不用 frontmatter 的用户零打扰，成本 S。
**前端**：`markdown.worker.ts` 在 `processor.parse` 前用锚定开头的正则（`^\uFEFF?---`，允许 CRLF）取出 YAML 与截断正文，Mermaid 收集基于截断后正文；`details` 块在 `String(file)` 后拼接，YAML 内容经 `escapeHtml`（`& < > "`），不走 remark 原始 HTML 节点，避免 sanitize 的 schema 改动；`outline.ts` 计算开头 frontmatter 结束偏移（首行必须是 `---`，向下最多 500 行找闭合 `---`，找不到当没有），忽略 `node.from` 小于偏移的标题；`preview.css` 新增折叠块样式。风险：以 `---` 开头但本意是分隔线的文档会被当成 frontmatter（与常见编辑器行为一致）；导出 HTML 里的折叠块已在 `Toolbar.tsx` 的导出样式中补亮 / 暗配色，与预览一致。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/preview/markdown.worker.ts`（+33/−2 行）、`src/features/editor/outline.ts`（+19 行）、`src/features/preview/preview.css`（+25 行），共 3 个源码文件；另更新 `docs/loop/state.md`、`docs/loop/backlog.md`、`docs/loop/requirements.md`。
**构建**：`bun run build` 通过（含 tsc，vite 1.42s，仅既有的 chunk 体积与 ineffective dynamic import 提示）；未改 `src-tauri/`，未跑 cargo test。
**用例（`$HOME/.bun/bin/bun -e` 直调正则，全部符合预期）**：标准 LF、CRLF、空 frontmatter（`---\n---`）、文档中段的 `---` 不识别、带 BOM 的开头识别、没有闭合时整体按正文。
**测试步骤（CDP 不可用，9222 未运行，未做 CDP 实测；以下为人工复现）**：
- 准备一篇以 `---` 开头、含 `title` / `tags` / `date`、以 `---` 闭合、后接正文的笔记。纯预览与分栏下，首屏只显示一行「元信息」摘要（浅底细边框，约 12.5px），点开后是等宽的 YAML 原文；正文不再出现那条横线和大标题。
- 同篇笔记的大纲（侧栏「大纲」）不应出现 YAML 注释里的 `#`；正文自己的 `#` 标题仍在。
- 在正文中段插入一行 `---`（前后有空行）：预览里仍是分隔线，不被当作 frontmatter；大纲不受影响。
- 打开一篇没有 frontmatter 的普通笔记：预览、大纲、分栏同步与改动前一致。
- 工具栏「导出 HTML」导出一篇含 frontmatter 的笔记，打开生成的 `.html`：`<main class="markdown-body">` 开头能看到 `<details class="frontmatter">` 折叠块（默认收起），块底色 / 边框随亮暗主题变化，与预览里的观感一致。
- 暗色主题下重复第一、二步，折叠块应为深色浅字、边框随主题变暗。
**遗留**：所见（Live Preview）模式仍按源码显示 frontmatter，未做折叠或装饰；以 `---` 开头、本意是正文分隔线的文档会被当作 frontmatter（与常见编辑器一致）；没有把 frontmatter 用于标题 / 标签等元数据展示。
**检验计数**：3（第 376 轮为正常需求轮，第 378 轮做检验轮）。

## 第 375 轮 · 2026-11-12 12:20
**用户需求**：场景：把笔记复制到公众号、邮件或导出 HTML。现在的问题：Mermaid 在导出里仍是代码块；外链图片、未成功内联的本地图片不会提前说明，用户到收件人那里才发现。期望：导出 HTML 前汇总提示已内联本地图片 N 张、外链图片 M 张可能失效、Mermaid K 个未渲染、未内联本地图 X 张；有风险时让用户选「仍然导出 / 取消」。复制 HTML 不阻断，但成功提示里带上同类风险摘要。
**产品经理**：做。提前说明导出结果的可靠性，属于「数据安全、安静」的具体化，不扩大边界；只在有风险时打扰，正常文档流程不变，成本 S。
**前端**：`lib/images.ts` 的 `countLocalImages` 升级为 `scanContentRisks`（一次 DOM 扫描，统计外链图片与未内联本地图）；Mermaid 代码块经 Shiki 高亮后 class 变为 `language-text`，按 class 会漏检，改由 `preview-controller.ts` 新增的 `renderMarkdownForExport` 从 Worker 结果带出数量（`renderMarkdownToHtml` 签名不变）；`Toolbar.tsx` 导出前用既有 `ui.ask` 确认框列明风险，取消直接返回、不写盘不刷新目录；复制成功 Toast 拼接风险摘要。风险：确认框放在文件名输入之前（先渲染再问名字），取消时不会留下半套输入；预览区选中复制的 HTML 已无 Mermaid 代码块，按 0 计。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/lib/images.ts`（+18/−9 行）、`src/features/preview/preview-controller.ts`（+26/−8 行）、`src/app/Toolbar.tsx`（+43/−10 行），共 3 个源码文件；另更新 `docs/loop/state.md`、`docs/loop/backlog.md`、`docs/loop/requirements.md`。
**构建**：`bun run build` 通过（含 tsc，vite 1.21s，仅既有的 chunk 体积与 ineffective dynamic import 提示）；未改 `src-tauri/`，未跑 cargo test。
**补充**：渲染与风险统计已移入 `try/catch`，文档超过 1 MB、Worker 报错或读图失败时仍会弹「导出 HTML 失败：…」，不会把未处理的 Promise 拒绝抛给全局。
**测试步骤（CDP 不可用，9222 未运行，未做 CDP 实测；以下为人工复现）**：
- 准备一篇笔记，含：1 张工作区内本地图、1 张 `https://` 外链图、1 个 ```mermaid 代码块、1 个指向不存在文件的本地图（如 `![](missing.png)`）。
- 标题栏「导出 HTML」：应先弹出「导出内容有风险」，正文包含「已内联 1 张本地图片。」「1 张外链图片可能失效」「1 个 Mermaid 图表未渲染」「1 张本地图片未内联」四项（顺序为外链 → Mermaid → 本地）；点「取消」后不出现文件名输入框、目录里没有新 `.html`、文件树不刷新。
- 再次导出并点「仍然导出」：出现文件名输入框；导出后用文本编辑器打开生成的 `.html`，确认本地图是 `data:` 地址、外链图仍是 `https://`、Mermaid 仍是代码块。
- 准备一篇只有普通文字与已内联本地图的笔记：导出不应弹确认框，直接进入文件名输入框，流程与改动前一致。
- 复制 HTML（工具栏「复制 HTML」或 `Ctrl+Shift+C` 对应入口）：Toast 应包含同类摘要，例如「HTML 已复制…（1 张本地图片已内联；1 张外链图片可能失效；1 个 Mermaid 未渲染）」；纯文字笔记的复制文案保持原样。
- 预览模式下用鼠标选中一段含外链图的预览内容复制，确认 Toast 的风险数与选中内容一致、不误报未选中的图片。
**遗留**：Mermaid 数量依赖导出走 Worker 渲染；如果未来导出改走预览缓存，需要把 `mermaid` 一并从缓存带出。风险统计只看 `<img>` 与 Mermaid，未覆盖公式 / 视频等其他外链资源，可按需扩展。
**检验计数**：2（第 375 轮为正常需求轮，第 378 轮做检验轮）。

## 第 374 轮 · 2026-11-12 12:10
**用户需求**：场景：给编辑器加一条命令或一个新分组。现在的问题：命令面板的 `GROUP_LABELS` 与标题栏菜单的 `GROUPS` 各存一份分组文案 / 顺序，历史上已记「后续加组需两处同步」，实际已经漂移。期望：从命令注册表派生唯一的分组定义，菜单与面板都从它读取，新增命令只改一处，现有菜单结构与面板分组视觉不变。
**产品经理**：做。收敛的是内部一致性问题，不新增用户可见功能、不改菜单结构与交互，契合「安静、可控」与本地优先边界；成本仅 3 个文件的小重构。
**前端**：`features/commands/commands.ts` 新增 `COMMAND_GROUPS`（id / label / 顺序）与 `COMMAND_GROUP_LABELS`（按 id 查文案，由前者派生）；`CommandPalette.tsx` 删除本地 `GROUP_LABELS` 改用导出映射；`AppMenu.tsx` 删除本地 `GROUPS`，改为过滤 `COMMAND_GROUPS`。风险：分组顺序与文案必须与旧值逐字一致，否则菜单与面板视觉漂移；已核对 8 项一致。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/commands/commands.ts`（+20 行）、`src/features/commands/CommandPalette.tsx`（+2/−14 行）、`src/app/AppMenu.tsx`（+2/−12 行），共 3 个源码文件（+24/−26 行）；另更新 `docs/loop/state.md`、`docs/loop/backlog.md`、`docs/loop/requirements.md`。
**构建**：`bun run build` 通过（含 tsc，vite 1.44s，仅既有的 chunk 体积与 ineffective dynamic import 提示）；未改 `src-tauri/`，未跑 cargo test。
**测试步骤（CDP 不可用，9222 未运行，未做 CDP 实测；以下为人工复现）**：
- 逐一打开标题栏六个菜单（文件 / 编辑 / 段落 / 格式 / 视图 / 应用），核对项文案、顺序、分隔线、右侧快捷键与禁用态和改动前一致；「编辑」里应依次为撤销 / 重做 / 查找与替换 / 在工作区中搜索，「视图」里应依次为返回 / 前进 / 四个视图单选 / 专注模式 / 显示侧栏。
- `Ctrl+Shift+P` 打开命令面板，空查询下核对分组标题依次为「最近使用」（若有用过）、文件、编辑、段落、格式、导航、视图、查找、应用，且标题只在分组切换处出现一次。
- 在面板输入「视图」核对只过滤出视图相关命令且分组标题正确；清空后输入「保存」，核对「保存」「另存为…」出现，执行后按 `Ctrl+Shift+P` 应出现在「最近使用」段。
**遗留**：顶层菜单到分组的归属仍写在 `MenuBar.tsx` 的 `MENUS`（本轮受 3 文件上限未触及）；新增「分组」已单点，新增「顶层菜单」仍需改 `MenuBar.tsx`，可作后续小项。
**检验计数**：1（第 374 轮为正常需求轮，满 5 或到第 378 轮做检验轮）。

## 第 373 轮（检验轮）· 2026-11-12 12:00
**回归范围**：第 368–372 轮（368 搜索结果自动保鲜、369 快捷键速查、370 自定义 CSS 校验、371 导出跟随主题、372 标签上限可配置）。
**构建**：`bun run build` 通过（含 tsc，vite 1.17s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**静态与单测检查**：
- 368：`SearchPanel.tsx` 的查询 effect 依赖含 `dirRevision`、`savedModifiedMs`、`visible`；`workspace.ts` 在 `refreshDir` 成功后自增 `dirRevision`，失败不增。
- 369：`commands.ts` 有 `shortcut-sheet` 命令与 `Ctrl+/`；`App.tsx` 的全局守卫与弹层互斥包含速查；`ShortcutSheet.tsx` 打开聚焦搜索框、Esc 关闭、`trapTab` 收束。
- 370：`bun -e` 重跑 4 组 `checkCssBalance` 用例全部 PASS（缺 `}`、多 `}`、字符串内 `}`、注释内括号）。
- 371：`exportStyle` 按主题生成；暗色含 `--shiki-dark` 切换；`PRINT_STYLE` 固定白底深字。
- 372：`maxTabs` 只接受 8 / 12 / 20；`MAX_TABS` 初始取当前偏好并订阅变化；设置页有「最多同时打开」三档。
**发现并修复**：
1. 暗色导出里 Shiki 代码块仍用亮色内联 token（`defaultColor: "light"` + `--shiki-dark` 变量未被切换），深底上会出现深色字。`Toolbar.tsx` 的暗色导出补 `.shiki` / `.shiki span` 变量切换与 `pre.shiki` 底色，提交 `a0b7b9c`。
2. 标签上限调低后，原实现会在下一次打开时 `while` 一次关闭多篇标签，可能丢掉多篇未保存内容，且提示只点名一篇。改回每次打开最多挤掉一个、逐步收敛，并让 `MAX_TABS` 初始值取当前偏好，提交 `03faf7e`。
**未覆盖**：CDP 9222 未运行，本轮没有在应用里做真实交互回归；368、369、371、372 的焦点 / 主题 / 标签收敛仍需人工或后续真机验证。
**结论**：三条正常、两条发现并修复；计数清零，下一轮 374 按正常需求轮。
**检验计数**：0。

## 第 372 轮 · 2026-11-12 11:45
**用户需求**：场景：同时参考十几篇笔记。现在的问题：`MAX_TABS = 12` 是硬编码，超出时挤掉最久未用的标签，用户无法调整。期望：设置里提供 8 / 12 / 20 三档，默认 12；调低后不立刻关闭已开的标签，只在下一次打开新标签时按新上限收敛（沿用现有「已关闭最久未用的标签…」提示）；偏好持久化，重启保留。
**产品经理**：做。上限开放是「安静但可控」的偏好细化，不改变挤占策略、不引入依赖，契合本地优先边界；三档穷举避免用户设成 0 / 1 导致编辑器不可用。
**前端**：`stores/settings.ts` 的 `Preferences` 新增 `maxTabs`（默认 12），`normalizePreferences` 仅接受 8 / 12 / 20、其它值回落 12，`reset()` 随 `DEFAULT_PREFERENCES` 回 12；导出 `MAX_TABS_OPTIONS`。`stores/tabs.ts` 的 `addTab` 用当前上限判断，超出时仍只挤掉最久未用的一个；上限被调低时不一次清掉一批，之后每次打开最多挤掉一个、逐步收敛，避免一次关闭多篇（可能含未保存内容）。`MAX_TABS` 由 `const` 改为 `export let`，初始值取 settings store 当前偏好并订阅后续变化，供 `workspace-actions.ts` 的挤占提示显示真实上限（不新增文件改动）。`SettingsDialog.tsx`「视图与预览」新增「最多同时打开」分段控件，8 / 12 / 20 即时写入偏好。风险：上限调低后不会立刻收敛，需要再打开几次才逐步降到新上限；`export let` 依赖 ESM 活绑定（Rollup / 同 chunk 内成立）。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/stores/settings.ts`（+11 行）、`src/stores/tabs.ts`（+21/−5 行）、`src/features/settings/SettingsDialog.tsx`（+18 行），共 3 个源码文件；另更新 `README.md`（多标签一句）、`docs/loop/state.md`、`docs/loop/backlog.md`、`docs/loop/requirements.md`。
**构建**：`bun run build` 通过（含 tsc，vite 1.29s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**用例（`$HOME/.bun/bin/bun -e` 直调，全部符合预期）**：
- `normalizePreferences`：缺省 / `null` / `{maxTabs:7}` / `{maxTabs:"8"}` / `{maxTabs:Infinity}` → 12；`{maxTabs:8}` → 8；`{maxTabs:12}` → 12；`{maxTabs:20}` → 20；`DEFAULT_PREFERENCES.maxTabs` = 12。
- 标签收敛（stub `window.setTimeout`）：默认上限 12 时打开第 13 篇挤掉 `n1`、仍 12 个；上限改 8 后已开的 12 个不立即关闭，下一次打开只挤掉最旧的一个、变为 12 个，继续打开才逐步降到 8 个；上限改 20 后再开两篇不挤占。
- 活绑定：namespace 导入下 `MAX_TABS` 随设置从 12 → 8 → 20 同步。
**测试步骤（CDP 不可用，9222 未运行，未做 CDP 实测；以下为人工复现）**：
- 打开「设置 → 视图与预览」，应看到「最多同时打开」三档分段控件，默认停在「12 个」；键盘 ←/→ 移动焦点、回车切换。
- 设为 8 → 已开的标签不应立刻关闭；再打开一篇新笔记，标签数应收敛到 8，最久未用的被挤掉，并出现「已关闭最久未用的标签「…」（最多同时打开 8 个）」提示。
- 设回 12 → 重启应用，设置应仍为 12；已开标签不被立即关闭，打开第 13 篇时才按 12 收敛。
- 恢复默认设置 → 上限回到 12；偏好文件里写入非法值（如 7 或 `"8"`）后重启，应回落到 12。
**检验计数**：4（第 368–372 轮为正常需求轮，满 5 后做检验轮）。

## 第 371 轮 · 2026-11-12 11:35
**用户需求**：场景：深色主题下写作，把笔记导出成 HTML 发给别人或自己归档。现在的问题：导出样式写死浅色（`#fdfdfb` 背景、深色字），和当前观感完全脱节；打印也不该被暗色影响。期望：导出 HTML 跟随当前解析后的主题（亮 / 暗），配色沿用应用设计令牌；打印 / 导出 PDF 仍强制白底深字。
**产品经理**：做。导出的归档文件与应用观感脱节是「所见即所得」的粗糙处；只把已有的内联样式按主题分成两套，不新增选项、不改导出流程、不引入依赖，契合纯文本与本地优先边界。
**前端**：`src/app/Toolbar.tsx` 新增 `EXPORT_PALETTE`（亮 / 暗两套：背景 / 文字、标题、链接、引用、行内代码 / 代码块、表格边框、分隔线；暗色取 `global.css` 的 `--bg` `#151817`、`--text` `#e7e8e2`、`--accent-strong` `#b0cdd3`、`--line-strong` `#3b433f`、`--text-muted` `#a0a69e`、`--code-bg` `#1b201e`、`--line` `#2b312e`）；`exportStyle(theme)` 生成 CSS，`standaloneHtml` 增加 `theme` 参数；`currentExportTheme()` 用 `resolveTheme(useSettingsStore 的 theme 偏好)`，跟随系统时按系统主题，不读瞬时 `data-theme`。`PRINT_STYLE` 补 `color:#22211d`，`buildPrintableHtml` 固定传 `"light"`。复制 HTML（`Ctrl+Shift+E`）只拷贝片段、不内联样式，由目标应用决定配色，本轮不改。风险：仅在导出时多一次主题解析；亮色导出样式值与原实现一致，无视觉回归。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/app/Toolbar.tsx`（+73/−15 行），共 1 个源码文件；另更新 `docs/loop/state.md`、`docs/loop/backlog.md`、`docs/loop/requirements.md`。
**构建**：`bun run build` 通过（含 tsc，vite 1.56s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**测试步骤（CDP 不可用，9222 未运行，未做 CDP 实测；以下为人工复现）**：
- 亮色主题（设置 → 外观排版选「浅色」，或系统为浅色且选「跟随系统」）导出一次 HTML：用浏览器打开，背景应为 `#fdfdfb`、正文 `#22211d`，链接、引用、代码块、表格与改动前一致。
- 暗色主题（选「深色」，或系统为深色且选「跟随系统」）再导出一次：打开后背景应为深色 `#151817`、正文浅色 `#e7e8e2`；标题同正文色，链接为浅青 `#b0cdd3`，引用左边框 `#3b433f`、文字 `#a0a69e`，行内代码 / 代码块为深底 `#232a27` / `#1b201e`，表格边框与分隔线为 `#2b312e`。
- 暗色导出里的代码块：Shiki 输出的是亮色内联色 + `--shiki-dark` 变量，导出样式已补 `.shiki` / `.shiki span` 的暗色变量切换与 `pre.shiki` 底色；打开后代码块应呈 github-dark 配色，不出现深底深字或亮底亮字。
- 主题切换时导出：在设置里切换亮 / 暗后立刻导出，结果应与切换后的主题一致，不出现两套样式混用。
- 打印不受影响：暗色主题下按 `Ctrl+P`（或导出 PDF）预览打印视图，应仍是白底 `#fff`、深字 `#22211d`，链接为正文色，代码块不跨页断开。
- 复制 HTML：`Ctrl+Shift+E` 粘贴到邮件或公众号草稿，行为与改动前一致（粘贴片段不带页面底色，由目标应用决定）。
**检验计数**：3（第 368、369、370、371 轮为正常需求轮，满 5 后做检验轮）。

## 第 370 轮 · 2026-11-12 11:25
**用户需求**：场景：从别处粘一大段 CSS 进「设置 → 外观排版 → 自定义 CSS」。现在的问题：只校验长度上限，括号不配平、引号未闭合时浏览器静默忽略，用户以为样式已生效。期望：输入时做轻量校验（花括号 / 圆括号 / 方括号配平、字符串引号闭合），在文本域下方行内提示出错位置与原因；不阻止保存、不实时打断输入；留空不提示；读屏能听到错误。
**产品经理**：做。粘贴外部样式是自定义 CSS 的主要用法，静默失效直接违背「所见即所得、安静但可信」；只做只读的配平检查、不引入解析器、不改存储与注入，契合纯文本与本地优先边界。
**前端**：新增 `src/lib/css-check.ts`：纯函数 `checkCssBalance(source)` 单遍扫描，状态机处理 `/* */` 注释与单 / 双引号字符串（含 `\` 转义），注释与字符串内的括号不参与配对；用栈记录开括号的行列，返回第一处问题的 `{line, column, message}`（行列从 1 开始），合法 / 空串返回 null。`SettingsDialog.tsx` 在打开时对 `preferences.customCss` 求值，文本域下方渲染「第 N 行第 M 列：原因」错误行（`role="alert"`、id 供 `aria-describedby`），文本域补 `aria-invalid` / `aria-describedby`，无错误时两者移除；不改 `changeCustomCss`（长度截断与上限 Toast 保持原样），不聚焦、不拦保存。`settings.css` 补 `.settings-custom-css-error`（`--danger`、11.5px）。风险：只在输入时多算一次线性扫描（上限内有界）；错误行会占一点高度，合法时不留空。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/lib/css-check.ts`（新建，92 行）、`src/features/settings/SettingsDialog.tsx`（+17/−1 行）、`src/features/settings/settings.css`（+7 行），共 3 个源码文件；另更新 `docs/loop/state.md`、`docs/loop/backlog.md`、`docs/loop/requirements.md`。
**构建**：`bun run build` 通过（含 tsc，vite 1.12s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**用例（`$HOME/.bun/bin/bun -e` 直调 `checkCssBalance`，全部符合预期）**：
- `a { color: red; }` → null；`a{color:red}\n@media (min-width: 600px){ b{margin:0} }` → null；空串 → null。
- `a{color:red` → `第 1 行第 2 列：缺少 }`（报第一个未闭合的开括号）。
- `a{color:red}}` → `第 1 行第 13 列：多余的 }`。
- `a{content:"}"}` → null（字符串内 `}` 不误报）；`a::before{content:'}'}` → null；`a{content:"x\"y"}` → null（`\` 转义后的引号不结束字符串）。
- `a {\n  color: red;\n  }\n]` → `第 4 行第 1 列：多余的 ]`。
- `/* } ] ) */\na{color:red}` → null（注释内括号不误报）。
- `a{\n  content: "x;\n}` → `第 2 行第 12 列：字符串缺少结束引号 "`。
- `a{ b{ c:1 }` → `第 1 行第 2 列：缺少 }`（嵌套时先报第一个未闭合的）。
**测试步骤（CDP 不可用，9222 未运行，未做 CDP 实测；以下为人工复现）**：
- 打开设置：`Ctrl+,` →「外观排版」，自定义 CSS 留空或写 `a { color: red; }`，文本域下方不应出现错误行，`aria-invalid` / `aria-describedby` 均不存在。
- 粘贴 `a{color:red`：下方出现红字「第 1 行第 2 列：缺少 }」，文本域 `aria-invalid="true"`、`aria-describedby` 指向该行；读屏应播报该错误；输入框焦点与光标不受影响，继续打字。
- 粘贴 `a{color:red}}`：错误变为「第 1 行第 13 列：多余的 }」。
- 粘贴 `a{content:"}"}` 与 `/* } */ a{color:red}`：均不报错。
- 把内容补成 `a{color:red}`：错误行消失、两个 aria 属性移除；关闭设置后样式正常生效。
- 保存不被拦：带着错误行按 Esc 关闭设置，重新打开后内容仍在（长度上限提示与截断逻辑不变）。
**检验计数**：2（第 368、369、370 轮为正常需求轮，满 5 后做检验轮）。

## 第 369 轮 · 2026-11-12 11:10
**用户需求**：场景：想查某个动作的快捷键，不想打开设置逐页翻。现在的问题：快捷键只列在「设置 → 快捷键」，命令面板只显示单条快捷键，没有一次看全的入口。期望：`Ctrl+/`（以及命令面板里的「快捷键速查」）打开一个可搜索的快捷键浮层，按「文件 / 编辑 / 视图 / 标签与分屏」分组；输入框过滤动作名或按键；Esc 关闭并把焦点还给打开前的控件；内容优先从命令注册表自动生成，避免和设置页漂移。
**产品经理**：做。快捷键是高频查阅、低频修改的信息，藏在设置第二层不符合「快、安静」；浮层只读、不新增数据与命令，从注册表派生还能顺手收敛展示漂移，契合本地优先与纯文本边界。
**前端**：`features/shortcuts/ShortcutSheet.tsx`（新建）用 zustand 模块内布尔状态控制开合，复用 `.modal-backdrop` / `.palette` / `.palette-input` / `.palette-list` / `.palette-item` / `.palette-item-key` 既有样式，不新建 CSS；行数据由 `APP_COMMANDS` 中带 `shortcut` 的命令按 `GROUP_OF` 映射到四个大组，另补 5 行编辑区专有按键并标注「编辑区 / 全局」来源；搜索按「动作名 + 按键 + 来源」过滤，空结果给空态；打开时记录 `document.activeElement` 并聚焦搜索框，Esc / 点遮罩关闭，关闭后原控件仍在则还焦点、否则回正文，Tab 复用 `trapTab`。`commands.ts` 新增「快捷键速查」（`palette` 可见，`shortcut: "Ctrl+/"`），经 `SHORTCUT_SHEET_EVENT` 自定义事件打开浮层，避免 commands ↔ ShortcutSheet 循环引用。`App.tsx` 挂载浮层，`Ctrl+/` 在输入框 / 文本域内不抢键，其它弹层开着时不叠开、速查开着时再按一次关闭，并把速查并入 `dialogOpen()` 与 `Ctrl+,` / `Ctrl+Shift+P` / `Ctrl+Alt+H` 的互斥判断。风险：新增浮层与全局按键分支，仅影响组合键与弹层互斥；菜单命令、设置页快捷键表不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/shortcuts/ShortcutSheet.tsx`（新建，173 行）、`src/features/commands/commands.ts`（+16 行）、`src/app/App.tsx`（+62/−3 行），共 3 个源码文件；另更新 `docs/loop/state.md`、`docs/loop/backlog.md`、`docs/loop/requirements.md`。
**构建**：`bun run build` 通过（含 tsc，vite 1.27s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**测试步骤（CDP 不可用，9222 未运行，未做 CDP 实测；以下为人工复现）**：
- 打开：焦点在正文（或文件树）时按 `Ctrl+/`，应弹出「快捷键速查」浮层，搜索框自动获得焦点；分组依次为「文件 / 编辑 / 视图 / 标签与分屏」，文件组含「新建笔记 Ctrl+N」「保存 Ctrl+S」等，标签与分屏组含 `Ctrl+Tab`、`Ctrl+W`。
- 过滤：在搜索框输入「保存」，列表只剩含「保存」的动作（保存、另存为等）；输入 `ctrl+shift+k` 应命中「代码块」；输入一串乱码应显示「没有匹配的快捷键」。
- 关闭与焦点：按 Esc（或点遮罩）关闭，焦点应回到打开前的控件；若从命令面板执行「快捷键速查」后关闭，焦点回到执行命令前的焦点。
- 命令面板：`Ctrl+Shift+P` 输入「快捷键」，应能看到「快捷键速查 Ctrl+/」，回车后面板关闭并弹出速查浮层。
- 互斥：速查开着时按 `Ctrl+,`、`Ctrl+Shift+P`、`Ctrl+Alt+H` 都不应叠开对应弹层；设置 / 命令面板 / 历史 / 更新弹窗开着时按 `Ctrl+/` 不应打开速查。
- 不误触：焦点在侧栏搜索框或重命名输入框里按 `Ctrl+/`，不应弹出速查，输入内容不受影响。
- 焦点环：速查打开后连按 Tab / Shift+Tab，焦点应停在搜索框（经 `trapTab`），不会跑到背后界面。
**检验计数**：1（第 368、369 轮为正常需求轮，满 5 后做检验轮）。

## 第 368 轮 · 2026-11-12 10:45
**用户需求**：场景：在侧栏「搜索」里搜到一半，回到正文改并保存；或在应用外改 / 删 / 改名了一篇笔记。现在的问题：搜索结果不会跟着更新，行号还是旧的，点进去甚至提示文件不存在。期望：保存成功、目录监听刷新后自动按当前关键词重搜（稍等一下即可），选中项尽量留在原处，已失效的条目从结果里消失。
**产品经理**：做。搜索结果指向已变化或已删除的文件会直接打断写作，是「本地优先、快、安静」的基本一致性；只让现有查询跟着保存与目录刷新重跑，不引入索引、不改搜索命令，契合边界。
**前端**：`stores/workspace.ts` 新增 `dirRevision`，`refreshDir` 成功重读后自增；`features/workspace/SearchPanel.tsx` 的查询 effect 增加 `dirRevision` / `savedModifiedMs` / `visible` 依赖，同一关键词保鲜重跑去抖 400ms 并按 `relPath + line` 找回选中项（找不到回 0），隐藏时不搜、切回可见补跑；输入框值与焦点不动。风险：结果刷新时短暂显示「搜索中」，`loading` 期间沿用既有的旧结果保护；新关键词路径行为不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/stores/workspace.ts`（+7 行）、`src/features/workspace/SearchPanel.tsx`（+31/−4 行），共 2 个文件 +38/−4。
**构建**：`bun run build` 通过（含 tsc，vite 1.55s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**测试步骤（CDP 不可用，9222 未运行，未做实测；以下为人工复现）**：
- 搜索：在侧栏「搜索」输入一个能在当前笔记里命中的词，记下某条结果的行号；回到正文在该词上方插入几行，分别用 `Ctrl+S` 手动保存与等自动保存落盘，停顿约 0.5 秒后结果行号应随之上移，选中项若仍在同一命中上保持不变。
- 外部删除：在应用外（资源管理器）删掉一条命中所在的笔记，等目录监听刷新（约 0.5 秒）后该篇结果应从列表消失，不再能点进报错。
- 外部改名 / 修改：在应用外给一篇命中笔记追加一行再保存，结果的行号 / 命中行文本应在约 0.5 秒内更新。
- 切换标签：切到「大纲」再切回「搜索」，关键词与结果仍在，并会重新执行一次查询；输入框焦点与内容不被重置。
**检验计数**：0（下一轮如继续，按正常需求轮）。

## 第 367 轮（检验轮）· 2026-11-02 15:45
**回归范围**：第 362–366 轮（362 设置切分类滚回顶部、363 输入弹层校验错误关联读屏、364 最近工作区删除后焦点落相邻库、365 取消选择文件夹后焦点归还、366 关闭最后一篇后编辑区 inert 与空状态落焦）。
**构建**：`bun run build` 通过（含 tsc，vite 1.21s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始单标签 `CaseTest.md`、分栏、焦点正文）**：
- 362：`Ctrl+,` 打开设置，「快捷键」内容区滚到底（`scrollTop` 1042）；鼠标点「外观排版」后 `scrollTop` 0、「排版」标题距内容区顶 22px；再回「快捷键」滚到底，聚焦当前分类按 `Home` 切回「外观排版」同样 `scrollTop` 0；Esc 关闭后焦点回 `.cm-content`。
- 363：焦点正文按 F2 打开「重命名」，输入 `a/b` 回车后值补为 `a/b.md`，输入框 `aria-invalid=true`、`aria-describedby` 指向 `role=alert` 的「名称不能包含路径分隔符」；Esc 取消后标签仍为 `CaseTest.md`，焦点回正文。
- 364：临时最近库 `_c367ws` / `_c367ws2` 写入后打开菜单，三行为「切换到 _c367ws2 / 切换到 _c367ws / 打开其他文件夹…」；焦点在第二行按 Delete 后落到第一行 `_c367ws2`，菜单保持展开、`aria-expanded=true`；Esc 关闭后焦点回库名按钮。
- 365：最近库为空时键盘在库名按钮按 Enter，弹出原生 `#32770`「选择工作区文件夹」；关闭该原生窗口（取消）后焦点为 `BUTTON.workspace-switch`，连续采样 2.5 秒保持稳定。
- 366：单标签焦点正文按 `Ctrl+W` 后标签 0、空状态出现、`.editor-pane.inert=true`、焦点在「新建文件」按钮，`Shift+Tab` 落到分隔条而不进入编辑区；从文件树重开 `CaseTest.md` 后 `inert=false`、焦点回正文；再开 `长文档.md` 后按 `Ctrl+W` 关当前标签，切到相邻 `CaseTest.md` 且焦点仍在正文。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**结论**：五条均正常，未发现功能缺陷，无源码改动。
**清理**：临时目录 `D:\clawWorkSpeace\_c367ws` / `_c367ws2` 已删除，`recentWorkspaces` 还原为检验前空列表；未修改任何笔记；应用停在单标签 `CaseTest.md`、分栏、侧栏「文件」、无弹层、焦点正文；临时 CDP 脚本已删除。
**检验计数**：0（下一轮 368 按正常需求轮）。

## 第 366 轮 · 2026-11-02 15:39
**用户需求**：场景：用键盘 `Ctrl+W` 关掉最后一篇打开的笔记（或删掉当前正在看的笔记），编辑区回到「从左侧选择一篇 Markdown」的空状态。现在的问题：焦点仍留在被空状态遮住的编辑器里，看不见光标却还能打字，读屏也停在隐藏的正文上；按 Tab / Shift+Tab 还会钻进这块不该再操作的编辑区。期望：空状态出现时焦点落到「新建文件」按钮，隐藏的编辑区不再接收键盘焦点。
**产品经理**：做。关闭最后一篇后落在空状态是常用路径，焦点留在遮罩后违反「安静、可预期」与可访问；只调整隐藏编辑区的可聚焦性与空状态落焦，不改关闭、切库、删除与数据逻辑。另复核第 294 轮「程序化折叠文件树时焦点回 body」观察：真实鼠标 / 键盘激活「全部折叠」时焦点都在按钮上，仅脚本 `.click()` 不聚焦的路径才会掉 body，无用户可见缺陷，本轮不改。
**前端**：`app/App.tsx` 给 `.editor-pane` 加 `inert={!docPath}`，并在文档由有到无时（用 ref 记住上一状态）下一帧把焦点交给 `.empty-state .btn`，仅当焦点已在 body 或编辑区内才接手，切库后马上恢复文档则不抢；`features/editor/editor-bridge.ts` 的 `setEditorDocument` 新增 `focus=true` 选项，`workspace-actions.ts` 的 `resetDocument` 传 `false`，清空文档时不再把焦点拉回遮罩后的编辑器。风险：仅在文档清空时改变焦点与可聚焦性；正常打开、切换标签、切视图的聚焦不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/app/App.tsx`（+23/−1 行）、`src/features/editor/editor-bridge.ts`（+7/−2 行）、`src/features/workspace/workspace-actions.ts`（+1/−1 行），共 3 个文件 +32/−6。
**构建**：`bun run build` 通过（含 tsc，vite 1.45s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`；文档从文件树打开，全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning）**：
- 改前复核：两标签时焦点在正文按 `Ctrl+W` 逐篇关到 0，空状态已出现，`document.activeElement` 仍是 `DIV.cm-content`（在 `.pane-overlay` 遮罩之后，`elementFromPoint` 命中的是遮罩），`.editor-pane` 没有 `inert`。
- 改后关闭最后一篇（焦点在正文）：标签 0、空状态出现，`document.activeElement` 为 `BUTTON.btn`（文案「新建文件」），`.editor-pane.inert === true`；从该按钮 `Shift+Tab` 落到空状态内的「清空最近打开」按钮，不再进入编辑区。
- 回归：两标签时在正文按 `Ctrl+W` 关当前标签，切到相邻标签且焦点仍为 `.cm-content`；从文件树打开笔记后 `inert === false`、焦点回正文，可正常继续编辑。
- 回归：只剩一篇时焦点在文件树行上按 `Ctrl+W`，空状态出现后焦点仍留在原树行（不再被拉进编辑器或空状态按钮）。
**人工复现**：打开至少一篇笔记，焦点放正文按 `Ctrl+W` 关掉最后一篇：应看到空状态，焦点在「新建文件」按钮，按 Shift+Tab 不会进入正文区域；再从文件树打开一篇，正文可正常聚焦编辑。
**清理**：未修改任何笔记（未输入正文）；应用现停在空状态、侧栏「文件」、无弹层；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp366*.mjs` 已删除。
**检验计数**：5（下一轮 367 做检验轮，回归 362–366）。

## 第 365 轮 · 2026-11-02 15:33
**用户需求**：场景：最近工作区里没有别的库时，用键盘在标题栏库名按钮上按 Enter，弹出「选择工作区文件夹」，随后取消。现在的问题：焦点落在正文，而不是刚才的库名按钮；从有最近库的菜单走「打开其他文件夹…」取消时焦点却会回到库名按钮，两条路径不一致。期望：取消选择（或选择失败）后焦点回到触发它的控件，可以直接再按 Enter 重开。
**产品经理**：做。打开文件夹是常用入口，取消对话框后焦点归还是键盘用户的基本预期；只补焦点归还，不改选择、切库与最近记录逻辑，契合「安静」与可访问，不碰「暂不做」。
**前端**：`features/workspace/workspace-actions.ts` 的 `chooseWorkspace` 在弹选择器前记住 `document.activeElement`；选中目录时照旧切库并提前返回，取消或失败时仅在原控件仍挂载且焦点已移走时交还。菜单项会随菜单卸载，`isConnected` 挡住，避免与 `ContextMenu` / 命令面板自己的焦点恢复互抢。风险：只影响取消 / 失败后的焦点；成功切库与最近记录不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/workspace/workspace-actions.ts`（+13/−1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.88s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始两标签 `长文档.md` / `CaseTest.md`、当前 `CaseTest.md`、分栏、焦点正文；最近列表仅当前库，菜单不出现）**：
- 改前复核：焦点在库名按钮 `.workspace-switch` 时触发选择器，关闭原生「#32770」对话框后 `document.activeElement` 为 `DIV.cm-content`，不在触发按钮上。
- 改后同一路径：同样关闭原生对话框后焦点为 `BUTTON.workspace-switch`（`aria-label` 为「当前工作区：新建文件夹，切换或打开工作区」），连续采样 1.5 秒保持稳定。
- 菜单路径回归：临时目录 `_c365ws` 存在时菜单两行「切换到 _c365ws」/「打开其他文件夹…」，点末项后关闭原生对话框，焦点仍回到库名按钮（与改前一致，未出现双恢复抢焦）。
- 命令面板路径回归：`Ctrl+Shift+P` →「打开文件夹…」→ 关闭原生对话框后，面板已关闭、焦点回正文，无残留弹层。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：让最近工作区只剩当前库（或清空最近记录），键盘聚焦标题栏库名按钮按 Enter，取消系统文件夹选择器：焦点应回到库名按钮，再按 Enter 可重新打开；从有最近库的菜单选「打开其他文件夹…」取消时行为相同。
**清理**：临时目录 `D:\clawWorkSpeace\_c365ws` 与 CDP 脚本已删除；`recentWorkspaces` 还原为仅当前库；未修改任何笔记；应用停在两标签、当前 `CaseTest.md`、分栏、侧栏「文件」、无弹层、焦点正文。
**检验计数**：4（下一轮 366 按正常需求轮）。

## 第 364 轮 · 2026-11-02 15:22
**用户需求**：场景：用键盘打开库名旁的「最近工作区」菜单，整理记录时在一条临时库上按 Delete 删掉。现在的问题：菜单还开着，焦点却不落在相邻的库上，而跳到菜单末尾的「打开其他文件夹…」；想接着删或切另一个库还要先按 ↑ 找回来。期望：删掉一行后焦点落到相邻的最近库（上一行优先），菜单只剩一条时删掉仍回库名按钮。
**产品经理**：做。最近记录多了以后用键盘整理是真实会遇到的路径；只改删除后的焦点落点，不改删除、撤销与切库逻辑，契合「安静、快」，不碰「暂不做」。
**前端**：`components/Menu.tsx` 新增 `removedRow` ref；按 Delete 与点行尾 × 两条路径都记下被删行号，`actions` 缩短后的补焦优先落到上一行（删的是首行则落到新的首行），没有发生删除时沿用原来的「原位置或最后一行」逻辑。风险：只影响带 `onRemove` 的菜单（当前仅最近工作区），普通右键菜单打开即聚焦首项不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/components/Menu.tsx`（+16/−3 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.21s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始两标签 `长文档.md` / `CaseTest.md`、当前 `CaseTest.md`、分栏、焦点正文；临时最近库 `_c364ws` / `_c364ws2` 经 Tauri Store 写入，结束后已还原为仅当前库）**：
- 改前复核：菜单三行 `切换到 _c364ws` / `切换到 _c364ws2` / `打开其他文件夹…`，焦点在第二行按 Delete 后，焦点落到末尾的「打开其他文件夹…」。
- 改后同一路径：焦点落到上一行「切换到 _c364ws」，菜单保持展开，可直接继续 ↑↓ / Delete。
- 删首行：焦点在第一行按 Delete 后落到顶到首位的「切换到 _c364ws2」。
- 鼠标路径：点第二行行尾 × 后同样落到「切换到 _c364ws」，不会跳到末尾动作。
- 仅剩一条最近库时按 Delete：菜单收起、焦点回到库名按钮 `.workspace-switch`、`aria-expanded=false`；第 343 轮观察到的收起路径当前未复现掉到 body。
- 回归：无 `onRemove` 的文件树右键菜单打开后仍聚焦首项「新建 Markdown」。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：打开至少两个最近库，键盘在库名按钮按 Enter 打开菜单，↓ 到第二条按 Delete：焦点应落在第一条库上，而不是「打开其他文件夹…」；再删到只剩一个最近库时，菜单收起且焦点回到库名按钮。
**清理**：临时目录 `D:\clawWorkSpeace\_c364ws` / `_c364ws2` 与 CDP 脚本已删除；`recentWorkspaces` 还原为仅当前库；未修改任何笔记；应用停在两标签、当前 `CaseTest.md`、分栏、侧栏「文件」、无弹层、焦点正文。
**检验计数**：3（下一轮 365 按正常需求轮）。

## 第 363 轮 · 2026-11-02 15:15
**用户需求**：场景：用读屏软件在扉页里新建笔记 / 用 F2 重命名，文件名里带了斜杠或与已有文件重名。现在的问题：按回车后只有视觉上多出一行红字，读屏没有任何提示，输入框也没被标成无效，不知道提交为什么没成功。期望：错误一出现就能听到原因，重新聚焦输入框时也能复查。
**产品经理**：做。新建、另存为、重命名、插入链接共用这个输入弹层，校验失败是真实会遇到的路径；只把已有错误行关联到输入框，不改校验规则、按钮与关闭流程，契合「安静、数据安全」，不碰「暂不做」。
**前端**：`components/Dialog.tsx` 的 `PromptDialog` 用 `useId` 给错误行生成 id，出现错误时给输入框补 `aria-invalid` / `aria-describedby`，错误行加 `role="alert"`；输入变化清空错误时属性一并移除，避免读屏继续报无效。风险：仅影响提示语义；输入、选中主文件名、回车提交与 Esc 取消不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/components/Dialog.tsx`（+11/−1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.67s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始两标签 `长文档.md` / `CaseTest.md`、当前 `CaseTest.md`、分栏、焦点正文）**：
- 改前：用一个校验函数返回「文件名不能包含路径分隔符」的输入弹层，提交非法值后错误行无 `role` / `id`，输入框 `aria-invalid` 与 `aria-describedby` 均为 `null`。
- 改后同一路径：输入框 `aria-invalid="true"`、`aria-describedby` 指向错误行 `id`，错误行 `role="alert"`、文案正确，关联成立。
- 真实路径：焦点在正文按 `F2` 打开「重命名」，初始值 `CaseTest.md`、选中 `[0,8]`（只选主名）；输入 `a/b` 回车后同样得到 `aria-invalid` / `role=alert` / `aria-describedby` 关联；Esc 关闭后弹层 0 个、焦点回正文、状态栏仍为 `CaseTest.md`，未改名。
- 改成合法名后错误行立即消失，再提交弹层正常关闭（0 个）、焦点回正文；临时探测用最近工作区记录已清理（`listRecentWorkspaces` 为空）。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：打开读屏软件，在正文按 `F2`，把文件名改成含 `/` 的名称并回车：应听到「名称不能包含路径分隔符」；再次聚焦输入框应能听到同一条错误说明。修好后按 Esc 不应改名。
**清理**：未修改任何笔记；应用停在两标签、当前 `CaseTest.md`、分栏、焦点正文、无弹层；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp363-*.mjs` 已删除。
**检验计数**：2（下一轮 364 按正常需求轮）。

## 第 362 轮 · 2026-11-02 15:09
**用户需求**：场景：在「设置 → 快捷键」里往下滚着查一个组合键，接着点左侧「外观排版」想调字号。现在的问题：右侧内容区沿用了快捷键页的滚动位置，切过去落在半页，页首的「排版」标题和第一组设置被顶到可视区外，还得先手动滚回顶部。期望：切换设置分类时，右侧从顶部开始显示。
**产品经理**：做。设置分类是并列的五页，切换分类应像打开新页面一样从顶部开始；当前把上一页的滚动位置带过去，会让用户以为新分类缺了开头，属于已实现分类切换的真实粗糙处。只重置滚动位置，不改任何设置项、键盘切换与记忆逻辑，契合「安静、快」，不碰「暂不做」。
**前端**：`features/settings/SettingsDialog.tsx` 给 `.settings-content` 加 `contentRef`，在 `category` 变化时 `scrollTo({ top: 0 })`；鼠标点击与 ←/→ 方向键切换都会经过同一状态，关闭后焦点仍回正文。风险：只影响分类切换的滚动位置；打开设置时记住上次分类、设置项与自动保存均不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/settings/SettingsDialog.tsx`（+9/−1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.79s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始两标签 `CaseTest.md` / `长文档.md`、当前 `CaseTest.md`、分栏）**：
- 改前：`Ctrl+,` → 快捷键，把内容区滚到底（`scrollTop` 1042 / 高 1554），点「外观排版」后 `scrollTop` 仍为 221（高 733），「排版」标题 `top` 为 −76，落在可视区上方、看不到第一组设置。
- 改后：同样先滚到快捷键底部再点「外观排版」，`scrollTop` 为 0，「排版」标题 `top` 145（内容区顶 123），完整可见。
- 键盘路径：在外观排版把内容滚到底后，聚焦左侧分类按 `→` 切到「编辑行为」，内容区 `scrollTop` 同样回到 0。
- 关闭设置后无 `.settings-dialog`、焦点回 `DIV.cm-content`，标签仍为 `长文档.md` / `CaseTest.md`，未修改任何笔记；全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：`Ctrl+,` 打开设置 → 快捷键，滚到列表底部，再点「外观排版」：右侧应从「排版」标题开始显示，而不是停在半页。
**清理**：已把设置分类还原为「外观排版」；未修改任何笔记；应用停在两标签、当前 `CaseTest.md`、分栏、侧栏「文件」、无弹层、焦点正文；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp362-*.mjs` / `cdp362-*.png` 待删除。
**检验计数**：1（下一轮 363 按正常需求轮）。

## 第 361 轮（检验轮）· 2026-11-02 15:02
**回归范围**：第 356–360 轮（356 外部 CRLF 笔记切回保留阅读位置、357 分栏预览选区字数、358 手动保存读屏播报、359 快捷键表补全、360 侧栏搜索切走切回保状态）。
**构建**：`bun run build` 通过（含 tsc，vite 1.17s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始两标签 `CaseTest.md` / `长文档.md`、当前 `长文档.md`、分栏）**：
- 356：外部新建的 CRLF 笔记（900 行）打开后滚到 600px，切到 `CaseTest.md` 再切回，`scrollTop` 仍为 600；在该笔记插入标记后切走再切回，标记仍在、`Ctrl+Z` 可撤销，撤销历史随 EditorState 一起恢复。
- 357：分栏下编辑区 `Ctrl+A` 状态栏报「选中 18,900 字」，在预览首段选 6 个字后变为「选中 3 字」，回编辑区再全选恢复 18,900；清空选区切到纯预览无「选中」行，在预览选 10 个字显示「选中 7 字」。
- 358：打开临时笔记输入后状态为「待保存」、播报区为空；`Ctrl+S` 后播报区出现「已保存」（1 次节点新增），再输入再存子节点被替换（累计 3 次），再输入等待 2.8 秒自动保存播报区不变。
- 359：`Ctrl+,` → 快捷键：文件组末尾为 `Ctrl + Alt + H`「文档历史…」与 `Ctrl + P`「导出 PDF…」，新增「标签与分屏」组三行（切换标签、`Ctrl + W`、`Ctrl + \`）文案完整；Esc 关闭后焦点回正文。
- 360：搜索「写作」9 条，切到「大纲」时 `.search-panel` 为 `hidden` / `display:none`、关键词与 9 条结果仍在；点回「搜索」仍是「写作」9 条且焦点回输入框；键盘在「文件」标签按 → 两次焦点停在「搜索」标签，Tab 才进输入框。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**结论**：五条均正常，未发现功能缺陷，无源码改动。
**清理**：临时笔记 `_c361-crlf.md` / `_c361-crlf2.md` / `_c361save.md` 已删除，标签关回 `CaseTest.md` / `长文档.md`（当前 `CaseTest.md`）；应用停在分栏、侧栏「文件」、无搜索词、无弹层、焦点正文；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp361-*.mjs` 待删除。
**检验计数**：0（下一轮 362 按正常需求轮）。

## 第 360 轮 · 2026-11-02 14:57
**用户需求**：场景：在侧栏「搜索」里搜到一半，顺手切到「大纲」看一眼结构，再切回搜索。现在的问题：关键词和结果都被清空，只能重新输入；侧栏标签还会记住「搜索」，下次启动看到的是一个空搜索框。期望：切走再切回来仍是刚才的关键词和结果，光标也回到搜索框。
**产品经理**：做。搜索是用户进行中的工作，侧栏标签切换只是看一眼别的面板，不该把已完成一半的输入当临时状态丢掉；只保留面板实例与结果，不改搜索逻辑，契合「快、安静」，不碰「暂不做」。
**前端**：`features/workspace/WorkspaceSidebar.tsx` 让 `SearchPanel` 始终挂载，非搜索标签时用 `hidden` 隐藏；`SearchPanel.tsx` 新增 `visible`，切回且这次是从点击 / 命令面板进入时把焦点送回输入框；`search.css` 补 `.search-panel[hidden]{display:none}`（类选择器的 `display` 会盖过 `[hidden]` 的 UA 规则）。风险：隐藏面板不参与布局与 Tab 序；查询、读屏播报与结果点击逻辑不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/workspace/SearchPanel.tsx`（+17/−3 行）、`src/features/workspace/WorkspaceSidebar.tsx`（+4/−3 行）、`src/features/workspace/search.css`（+5/−0 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.09s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始两标签 `CaseTest.md` / `长文档.md`、当前 `长文档.md`、分栏）**：
- 改前：搜索「写作」得到 9 条结果，切到「大纲」再点回「搜索」，输入框为空、结果 0 条。
- 改后：同样搜「写作」9 条，切到「大纲」时 `.search-panel` 为 `hidden`、`display:none`、高度 0，文件树高度 660px 不受影响；点回「搜索」后输入框仍是「写作」、仍 9 条、焦点回到输入框；改成「CaseTest」实时刷新为 3 条。
- 键盘路径：焦点在「文件」标签上按 → 两次切到「搜索」，焦点留在「搜索」标签、不抢进输入框；鼠标点击「搜索」仍直接聚焦输入框。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：侧栏搜索一个词，切到「大纲」再切回「搜索」：关键词与结果仍在；用键盘方向键切到搜索时焦点停在标签上，Tab 才进输入框。
**清理**：未修改任何笔记；搜索词已清空、侧栏还原「文件」，应用停在两标签、当前 `长文档.md`、分栏、焦点正文、无弹层 / 提示；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp360*.mjs` 已删除。
**检验计数**：5（下一轮 361 做检验轮，回归 356–360）。

## 第 359 轮 · 2026-11-02 14:51
**用户需求**：场景：想查标签、分屏或导出 PDF 的快捷键，打开「设置 → 快捷键」。现在的问题：帮助页只列了文件和编辑类动作，`Ctrl+Tab` / `Ctrl+W` / `Ctrl+\` / `Ctrl+Alt+H` / `Ctrl+P` 都不在里面，只能去 README 或猜。期望：常用动作都收进这份快捷键表，一页能查全。
**产品经理**：做。快捷键表是已实现动作的自助入口，漏掉多标签、分屏、历史与导出会让用户误以为没做；只补静态帮助行，不改行为、不扩产品边界，契合「安静、快」。
**前端**：`features/settings/SettingsDialog.tsx` 的 `SHORTCUT_GROUPS`：文件组补 `Ctrl+Alt+H` 文档历史与 `Ctrl+P` 导出 PDF，新增「标签与分屏」组列出 `Ctrl+Tab` / `Ctrl+Shift+Tab` / `Ctrl+W` / `Ctrl+\`。风险：仅静态文案；分组滚动、键盘切换分类与关闭方式不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/settings/SettingsDialog.tsx`（+11/−0 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.52s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始两标签 `CaseTest.md` / `长文档.md`、当前 `长文档.md`、分栏）**：
- 改前 `Ctrl+,` → 快捷键：只有「文件 / 编辑 / 格式 / 视图与查找」四组，无标签、分屏、历史与导出快捷键。
- 改后同一路径：文件组末尾为 `Ctrl + Alt + H`「文档历史…」与 `Ctrl + P`「导出 PDF…」；新增「标签与分屏」组三行：`Ctrl + Tab / Ctrl + Shift + Tab`、`Ctrl + W`、`Ctrl + \`，文案正确、无横向溢出。
- 列表可滚到底，新组完整落在可视区（组 454–587，内容区 123–635）；Esc 关闭后焦点回正文，应用仍停在两标签、当前 `长文档.md`、分栏，0 error / warning。
**人工复现**：`Ctrl+,` → 快捷键：文件组应有「文档历史」「导出 PDF」；最下方应有「标签与分屏」组，列出切换 / 关闭标签与分屏对照。
**清理**：未修改任何笔记；设置分类还原为「外观排版」，无弹层、无提示；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp359-*.mjs` 待删除。
**检验计数**：4（下一轮 360 按正常需求轮）。

## 第 358 轮 · 2026-11-02 14:41
**用户需求**：场景：用读屏软件在扉页里写笔记，写完按 `Ctrl+S` 保存。现在的问题：状态栏的「已保存 14:40」只是普通文本，读屏不会主动念，也没法聚焦过去查看；保存成功、内容已落盘这件事没有任何听觉确认。期望：手动保存成功后轻声播报一次「已保存」，默认的自动保存不要每 1.8 秒念一遍。
**产品经理**：做。手动保存是用户明确的动作，缺少读屏反馈是「数据安全」在无障碍路径上的真实断点；只播报手动保存的终态、自动保存保持安静，契合「安静」，不碰「暂不做」。
**前端**：`stores/document.ts` 新增 `manualSaveSeq`，`markSaved` 增加第三个参数 `manual`，仅在手动保存且不残留脏内容时递增；`features/editor/save.ts` 按 `!options.auto` 传入；`app/StatusBar.tsx` 增加常驻 `.sr-only` 的 `role=status` / `aria-live=polite` 区域，序号变化时用带 key 的子节点重建一次「已保存」，让读屏再次播报。风险：只影响保存成功后的播报；文件写入、自动保存计时、状态栏视觉与保存失败提示均不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/stores/document.ts`（+10/−4 行）、`src/features/editor/save.ts`（+1/−1 行）、`src/app/StatusBar.tsx`（+13/−0 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.28s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，临时笔记 `_c358save.md`）**：
- 初始状态栏 `.sr-only[role=status]` 为空、`aria-live=polite`；打开临时笔记并输入一个字符后状态为「待保存」，播报区仍为空。
- 按 `Ctrl+S`：播报区变为 `<span>已保存</span>`，状态栏为「已保存 14:40」，`MutationObserver` 记录 1 次新增。
- 再输入一个字符并按 `Ctrl+S`：播报区文本仍为「已保存」，但子节点被替换（累计 3 次变更），读屏会再播报一次，不会因为文案相同而静音。
- 再输入一个字符后不按键，等待约 2.6 秒自动保存：状态栏显示「已保存」，播报区变更次数仍为 3，自动保存不播报。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：打开读屏软件（如 NVDA）在扉页里写一篇笔记并按 `Ctrl+S`，应听到一次「已保存」；继续输入并等待自动保存，读屏不应反复播报。
**清理**：临时笔记 `_c358save.md` 已删除，标签关回 `CaseTest.md` / `长文档.md`（当前 `长文档.md`）；`recentWorkspaces` 恢复为仅当前库；未修改任何既有笔记；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp358*.mjs` 待删除。
**检验计数**：3（下一轮 359 按正常需求轮）。

## 第 357 轮 · 2026-11-02 14:31
**用户需求**：场景：分栏模式下先在编辑区 `Ctrl+A` 选中一段，再去右侧预览里拖动选中一小段文字。现在的问题：状态栏一直显示编辑区旧的「选中 44 字」，与眼前刚选的预览文字对不上，想确认复制了多长会被误导。期望：预览里的选区也参与，显示最近真正选中的那段。
**产品经理**：做。状态栏「选中 N 字」本应描述当前选区，分栏里预览选区被编辑区旧选区盖住属于显示优先级错误；只调整状态栏取值来源，符合「安静、快」，不碰「暂不做」。
**前端**：`app/StatusBar.tsx` 的 `shownSelectedWords`：分栏下优先取预览选区（`previewSelectedWords > 0`），否则回编辑区选中字数；纯预览仍只认预览选区，避免切到预览时显示编辑区旧选区。风险：仅影响状态栏派生值；`previewSelectedWords` 在选区离开预览（含选回编辑区）时由既有 `selectionchange` 归零。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/app/StatusBar.tsx`（+5/−3 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.59s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始单标签 `CaseTest.md` / 分栏）**：
- 改前复现：编辑区 `Ctrl+A` 后状态栏「选中 44 字」；再在预览首段真实拖动选中一段，状态栏仍为「选中 44 字」。
- 改后：同样先 `Ctrl+A`（44 字），在预览首段拖动选中，状态栏变为「选中 6 字」；回到编辑区再 `Ctrl+A`，恢复「选中 44 字」，两个方向都跟随真实选区。
- 纯预览：带着编辑区旧选区切到「预览」，状态栏只有总字数、无「选中」；在预览里拖动选中显示「选中 10 字」，未误用编辑区旧值。
- 松开选区 / 点击正文后状态栏回到只显示总字数；全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：分栏下 `Ctrl+A` 选中编辑区，状态栏应报编辑区字数；再用鼠标在预览里选一小段，状态栏应改为预览字数；回到编辑区重新选中，应再跟随编辑区。
**清理**：未修改任何笔记内容；应用停在单标签 `CaseTest.md`、分栏、侧栏「文件」、焦点正文、无弹层、无选区；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp357-*.mjs` 已删除。
**检验计数**：2（下一轮 358 按正常需求轮）。

## 第 356 轮 · 2026-11-02 14:26
**用户需求**：场景：用别的工具（记事本、脚本、另一台机器的同步）在库里新建一篇笔记，在扉页里打开滚到中段，再切去别的标签又切回来。现在的问题：阅读位置回到开头；同样操作下既有笔记和应用内新建的笔记都正常。期望：外部新建的笔记切走再切回也停在原处，撤销历史一样还在。
**产品经理**：做。这是「多标签切走再切回位置仍在」这条既有承诺在外部文件上的破口，只修缓存命中判断、不改文件写入与阅读流程，符合「本地优先、快、安静、数据安全」，不碰「暂不做」。
**前端**：`features/editor/editor-bridge.ts`。根因：Windows 外部工具新建的文件多为 CRLF，CodeMirror 的 `Text` 统一按 LF 存，`candidate.doc.toString() === content` 对这类文件永远不成立，切回时把缓存状态和 `scrollCache` 一起作废、重建到开头。新增 `normalizeLineEndings`，比较前把磁盘内容归一化为 LF。风险：只影响「缓存内容是否仍与磁盘一致」的判断；真正的文件修改仍会因内容不同而重建。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/editor/editor-bridge.ts`（+6/−1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.37s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始单标签 `CaseTest.md` / 分栏）**：
- 改前复现：外部脚本新建的 CRLF 笔记 `_c356crlf.md`（300 行）打开后滚到 600，切到 `CaseTest.md` 再切回，`scrollTop` 600 → 0；同样脚本生成的 LF 笔记 `_c356ext.md` 600 → 600，说明触发条件是磁盘文件的行尾。
- 改后：`_c356crlf.md` 滚到 600，切走再切回 `scrollTop` 仍为 600，标签仍为同一篇；`长文档.md` 同样 600 → 600，既有笔记无回归。
- 撤销历史：在 CRLF 笔记里插入 `REV-MARK`，切到 `CaseTest.md` 再切回，`REV-MARK` 仍在，模拟 `Ctrl+Z` 后消失，说明缓存 `EditorState`（含撤销栈）随阅读位置一起命中。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：用记事本（默认 CRLF）在库里新建一篇长笔记，在扉页里打开滚到中段，切去别的标签再切回，应停在原处；在其中改几个字、切走切回后按 `Ctrl+Z` 能撤销。
**清理**：临时笔记 `_c356ext.md` / `_c356crlf.md` 已删除，标签关回单标签 `CaseTest.md`；重载后失效的「最近打开」记录被自动摘除；应用停在单标签 `CaseTest.md`、分栏、侧栏「文件」、焦点正文、无弹层；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp356.mjs` / `c356-*.mjs` 待删除。
**检验计数**：1（下一轮 357 按正常需求轮）。

## 第 355 轮 · 2026-11-02 14:19（检验轮）
**用户需求**：无新增；按 `.claude/loop.md` 第 6 节，系统性回归第 350–354 轮的五条改动。
**产品经理**：检验轮，不做新功能。五条都是「记录路径跟着改名 / 移动 / 另存为迁移」与「删除 / 图片浮层后的键盘焦点」，需确认后续提交没有把它们带坏。
**前端**：回归 `features/workspace/workspace-actions.ts`（350、353、354）、`features/workspace/WorkspaceSidebar.tsx`（351）、`features/preview/PreviewPane.tsx`（352）、`features/editor/editor-bridge.ts`（353）；无源码改动。
**后端**：无（未改 `src-tauri/`）。
**裁决**：五条均正常；另记录一项既有的阅读位置问题为下一轮候选。
**改动**：无源码改动；仅更新 `docs/loop/backlog.md` 与 `docs/loop/state.md`。
**构建**：`bun run build` 通过（含 tsc，vite 1.55s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始单标签 `CaseTest.md` / 分栏）**：
- 350：开 `写作示例.md` 与 `CaseTest.md`、`Ctrl+\` 对照；F2 改名 `写作示例-t.md` 后下拉与右侧仍为同一篇正文、标签同步；Shift+F10 →「移动到…」进 `子目录` 后下拉为 `子目录/写作示例-t.md`、正文不变；再移回根目录、改名回 `写作示例.md`，全程无空态。
- 351：右键 `_c355del.md` →「删除」→「移到回收站」后约 700ms 焦点落在相邻行 `_c355del2.md`（`tree-row`），确认框已关；再对 `_c355del2.md` 走同样菜单点「取消」，约 800ms 后焦点回到原行，行仍在。
- 352：`写作示例.md` 预览里 Tab 聚焦首图按 Enter 打开「1 / 4」；按 `+` 十四次到 400%（提示「拖动或 Shift + 方向键平移」、播报「缩放 400%」）；`Shift+→` ×2 得 `translate(80px, 0px) scale(4)` 且仍 `1 / 4`；不按 Shift 的 `→` 翻到 `2 / 4 · 400%` 并把平移归零；Esc 关闭后焦点回到原图 `IMG`（`role=button`）。
- 353：`跨笔记链接.md` 滚到 300 后 F2 改名为 `跨笔记链接-t.md`，切到 `CaseTest.md` 再切回，`scrollTop` 仍为 300、标签为新路径；再改名回 `跨笔记链接.md`。改名后撤销历史也在（改名前在 `_c355plain.md` 输入标记、切走再切回后 `Ctrl+Z` 能撤销）。
- 354：`跨笔记链接.md` 按 `Ctrl+Shift+S` 另存为 `_c355-as.md` 后，标签栏原位置的标签换成 `_c355-as.md` 并保持选中、Toast「已另存为 _c355-as.md」；在副本里插入标记后切到 `CaseTest.md` 再切回，`Ctrl+Z` 能撤销该标记。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**观察（下一轮候选）**：用外部工具在运行中的应用里新建、且从未在应用内编辑 / 保存过的笔记，打开后滚动再切走切回，阅读位置会回到开头（300 行外部文件滚到 600 → 切回 0；同流程的既有笔记 `长文档.md` 600、`跨笔记链接.md` 300 均能保持）。应用内「新建 Markdown」创建并自动保存的笔记滚动位置正常保持（9031）。该现象不经过 350–354 的任何改动路径（未改名、未另存），应是更早的阅读位置恢复与外部文件首次打开的差异，建议下一轮单独立项排查 `openFile` 的 `restoreEditorScroll` 与光标恢复顺序。
**清理**：临时笔记 `_c355-*` 与 `_c355ui.md` 已删除并从「最近打开」移除（`_c355del.md` 进回收站）；`写作示例.md` 已改回并在根目录，`跨笔记链接.md` 已改回原名，未修改任何笔记内容；应用停在单标签 `CaseTest.md`、分栏、侧栏「文件」、焦点正文、无弹层；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp355.mjs` / `c355-*.json` 待删除。
**检验计数**：0（下一轮 356 按正常需求轮）。

## 第 354 轮 · 2026-11-02 14:06
**用户需求**：场景：写一篇笔记时按 `Ctrl+Shift+S`「另存为…」，存成 `名字-副本.md`。现在的问题：编辑区、状态栏和「已另存为」提示都切到了副本，标签栏却仍写着旧文件名，副本没有自己的标签；点回旧标签会切走，副本只能从「最近打开」里找回，这时按 `Ctrl+W` 关掉的也是旧标签。期望：另存为后原位置的标签直接换成副本名字并保持选中，撤销历史与阅读位置也跟着过去。
**产品经理**：做。另存为已有新建、写入、切换文档与提示的完整路径，只是漏了标签与编辑器缓存的路径迁移，导致当前文档「没有标签」；只补两处路径同步，不改另存为的文件写入与命名规则，符合「安静、数据安全」，不碰「暂不做」。
**前端**：`features/workspace/workspace-actions.ts` 的 `saveDocumentAs` 在 `renameActive` 后调用 `useTabsStore.getState().remap(oldPath, created.relPath)`（原位置的标签换成副本并保持选中）与 `remapEditorState(oldPath, created.relPath)`（撤销历史、选区、阅读位置迁到副本键）。风险：仅影响另存为成功后的路径键；目标名已被占用的文件会被创建前的校验挡住，不存在同路径双标签；旧文件仍在磁盘上，可照常从文件树打开。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/workspace/workspace-actions.ts`（+6 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.51s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始单标签 `CaseTest.md` / 分栏）**：
- 改前：执行「另存为…」存为 `_c354-as.md` 后，`document.path` 为 `_c354-as.md`，`tabs` 仍只有 `CaseTest.md`，没有任何标签对应当前文档。
- 改后：另存为 `_c354-as2.md` 后，`tabs` 变为 `[{ path: "_c354-as2.md" }]`，`.doc-tab.is-active` 为 `_c354-as2.md`、状态栏路径同步，无重复或残留旧标签。
- 撤销历史：在副本里插入标记后切到 `CaseTest.md` 再切回，模拟 `Ctrl+Z` 能撤销该标记（光标随之回退），说明 `EditorState` 与撤销栈随标签键一起迁移；选区位置在往返后保持。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：打开一篇笔记按 `Ctrl+Shift+S` 另存为副本：标签栏原位置的标签应直接变成副本文件名并保持选中；在副本里改几个字，切到别的标签再切回，撤销仍能回退这些修改。
**清理**：两篇临时副本 `_c354-as.md` / `_c354-as2.md` 已删除并从「最近打开」移除，未修改 `CaseTest.md`；应用停在单标签 `CaseTest.md`、分栏、侧栏「文件」、焦点正文、无弹层；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp354*.mjs` 已删除。
**检验计数**：5（下一轮 355 做检验轮，回归 350–354）。

## 第 353 轮 · 2026-11-02 14:00
**用户需求**：场景：读一篇长笔记时滚到中段，在文件树里 F2 改名（或把所在文件夹改名 / 移动到别处）。现在的问题：标签与正文都跟着换了新路径，但切去别的笔记再切回来，阅读位置和撤销历史都丢了，又回到开头。期望：改名 / 移动后切走再切回，阅读位置与撤销历史仍在，和没改名时一致。
**产品经理**：做。多标签本来就承诺「切走再切回时撤销历史与光标位置都还在」，改名 / 移动也已有标签、光标、历史、恢复副本的迁移，唯独编辑器状态缓存仍按旧路径存放；只补一处路径迁移，不改编辑行为，符合「安静、数据安全」，不碰「暂不做」。
**前端**：`features/editor/editor-bridge.ts` 新增 `remapEditorState(from,to)`，把 `stateCache` 与 `scrollCache` 里旧路径（含目录前缀）的条目迁到新路径，并同步 `currentKey`；`features/workspace/workspace-actions.ts` 的 `renameEntry` / `moveEntry` 在 `migrateCursor` 后调用。风险：只影响缓存键；未命中时原样返回；不改编辑器内容、撤销栈结构与滚动同步。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/editor/editor-bridge.ts`（+24 行）、`src/features/workspace/workspace-actions.ts`（+4 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.41s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，临时 300 行笔记）**：
- 改前：临时笔记（原 `_c353.md`）打开后编辑区滚到 600px，F2 改名为 `_c353-renamed.md`，切到 `CaseTest.md` 再切回，`scrollTop` 由 600 变为 0。
- 改后：同样流程（`_c353-verify.md` → `_c353-verify2.md`）在整页重载后重跑，切走再切回 `scrollTop` 保持 600，活动标签为改名后的新路径；撤销历史与 `EditorState` 存在同一 `stateCache` 键下，随该函数一并迁移，本轮实测以阅读位置为准。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：打开一篇长笔记滚到中段，F2 改名或把所在文件夹移动到别处，切到另一篇再切回：编辑区应停在原来的阅读位置，撤销历史也应保留。
**清理**：临时笔记与临时 CDP 脚本已删除，未修改其它笔记；应用停在单标签 `CaseTest.md`、分栏、侧栏「文件」、焦点正文、无弹层。
**检验计数**：4（下一轮 354 按正常需求轮）。

## 第 352 轮 · 2026-11-02 13:55
**用户需求**：场景：只用键盘在预览里看带插图的笔记，按 `+` 把图放大到 175%–400% 想看细节。现在的问题：放大后图片超出可视区，底部提示写着「拖动平移」，但键盘用户没法拖动，只能看到图片中间，四角内容永远够不到。期望：`Shift + 方向键` 能平移放大后的图片，提示里写明；方向键翻页、Esc 关闭与焦点归还照旧。
**产品经理**：做。第 346 轮给图片浮层补了键盘缩放，但放大后仍只有鼠标拖动一条平移路径，是同一无障碍主线里真实的下一步；只补键盘平移与提示文案，不改缩放范围、翻页、双击复位、拖动逻辑与视觉，符合「快、安静」，不碰「暂不做」。
**前端**：`features/preview/PreviewPane.tsx` 浮层全局 keydown 在缩放分支后新增：`Shift` + 方向键且 `zoom > 1` 时拦截（避免误翻页），`canPan` 时按 40px 步长经既有 `clampPan` 平移，贴边即停；`canPan` 为 false 时只拦截不移动。底部提示在可平移时改为「拖动或 Shift + 方向键平移」。风险：只作用于图片浮层打开且已放大；无输入框冲突；未按 Shift 的方向键仍翻页。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/preview/PreviewPane.tsx`（+27/−2 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.51s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，`写作示例.md` 纯预览，4 张图）**：
- 键盘聚焦首图后点击打开浮层，`1 / 4`，焦点 `.image-lightbox`；按 `+` 十四次到 400%，提示变为「拖动或 Shift + 方向键平移 · 双击复位 · 滚轮或 + / − 缩放 · Esc 关闭」。
- `Shift+→` 两次后 `transform` 为 `translate(80px, 0px) scale(4)`，仍停 `1 / 4`（未误翻页）；继续按到贴边停在 `translate(1082px, 0px)`，与按可视宽算出的余量 1082 一致；`Shift+↑` 得 `translate(1082px, -40px)`。
- 不按 Shift 的 `→` 仍翻到 `2 / 4 · 400%` 并把平移归零；`Esc` 关闭后焦点回到原图 `IMG`（`alt=示意图：蓝紫渐变`）。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：预览里 Tab 到图片按 Enter 打开，`+` 放大到超过一屏，按住 Shift 再按方向键：图片应朝对应方向平移、贴边停住，底部提示写明该操作；不按 Shift 的方向键仍翻页，Esc 关闭后焦点回原图。
**清理**：标签关回单标签 `CaseTest.md`、视图还原「分栏」、侧栏「文件」、焦点正文、无弹层；临时目录 `D:\clawWorkSpeace\_c352other` 与临时 CDP 脚本已删除，`recentWorkspaces` 恢复为仅当前库；未修改任何笔记。
**检验计数**：3（下一轮 353 按正常需求轮）。

## 第 351 轮 · 2026-11-02 13:45
**用户需求**：场景：在文件树里右键一篇笔记（或按 Shift+F10 打开菜单），选「删除」→「移到回收站」。现在的问题：删完后焦点掉进正文，取消删除时也一样；接着按 ↑↓ / Delete 是在改光标，而不是继续整理文件树，与行内 Delete 键「删完留在树里」不一致。期望：删除或取消后焦点留在文件树的相邻行 / 原行，键盘能接着操作。
**产品经理**：做。删除已有确认框与回收站兜底，只是删完的焦点断档；只补焦点归位，不改删除确认文案、删除行为与树刷新，符合「安静、数据安全」，不碰「暂不做」。
**前端**：`features/workspace/WorkspaceSidebar.tsx` 新增 `keepTreeFocusAfterDelete(path,index)`：删除完成后持续几拍，在焦点落到 body / 正文 / 正在关闭的确认框时，把焦点落回原位置（末尾则最后一行）的相邻行；行还在（取消 / 失败）则还给原行；用户把焦点移到别的行 / 控件就停手。菜单「删除」与行内 Delete 键统一走它。风险：只在文件树删除后触发；树重读期间会短暂等待；不抢用户主动移走的焦点。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/workspace/WorkspaceSidebar.tsx`（+66/−9 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.23s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始单标签 `CaseTest.md` / 分栏；临时笔记 `_c351.md` / `_c351b.md`）**：
- 改前：右键 `_c351.md` →「删除」→「移到回收站」，树从 14 行变 13 行，`document.activeElement` 停在 `DIV.cm-content`；取消删除时同样落进正文。
- 改后：同一路径删除后焦点落在相邻行 `BUTTON.tree-row:CaseTest.md`（树重读期间约 100ms 的 body 空档后自动接回）；Shift+F10 → ↑ → 鼠标点「删除」的键盘菜单路径同样。
- 取消删除：确认框关掉约 330ms 后焦点回到原行 `_c351b.md`；行内 Delete 删除后焦点落在相邻行 `CaseTest.md`，与原有行为一致。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：在文件树里右键一篇笔记 → 删除 → 移到回收站，或先点取消：焦点应留在文件树（相邻行 / 原行），接着按 ↑↓ / Delete 仍作用于文件树。
**清理**：两篇临时笔记已删除（进回收站），未修改其它笔记；应用停在单标签 `CaseTest.md`、分栏、侧栏「文件」、焦点正文、无弹层；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp351*.mjs` 已删除。
**检验计数**：2（下一轮 352 按正常需求轮）。

## 第 350 轮 · 2026-11-02 13:41
**用户需求**：场景：开着分屏对照看另一篇笔记，同时在文件树里把对照那篇（或它所在文件夹）改名 / 移到别的目录。现在的问题：标签与编辑区的路径都跟着变了，右侧对照却还拿着旧路径，自动跳成另一篇或直接变成「先打开另一篇笔记，再来对照」，得重新在下拉里挑。期望：对照继续显示同一篇，路径跟着改名 / 移动走。
**产品经理**：做。分屏对照已有完整的挑篇 / 关闭 / 空态路径，改名与移动也已有标签、历史、光标、恢复副本的迁移，唯独对照路径漏了；只补一处路径迁移，不改对照渲染与只读规则，符合「安静、数据安全」，不碰「暂不做」。
**前端**：`features/workspace/workspace-actions.ts` 新增 `remapSplitPath`（仅当 `ui.splitPath` 位于改名 / 移动的路径内时，换前缀或整体替换），在 `renameEntry` 与 `moveEntry` 完成标签重映射后调用。风险：仅影响分屏路径记录；未开对照时直接返回；对照篇被删除时仍走原有自动换篇 / 空态。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/workspace/workspace-actions.ts`（+13/−0 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.28s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始单标签 `CaseTest.md` / 分栏）**：
- 打开 `写作示例.md` 再回到 `CaseTest.md`，`Ctrl+\` 打开对照，下拉为 `写作示例.md`，右侧正文「写作示例…」。
- 在文件树给对照篇按 F2 改名为 `写作示例-t.md`：标签同步，下拉变为 `写作示例-t.md`，右侧仍是同一篇正文、无空态；改回 `写作示例.md` 后同样保持。
- 用 Shift+F10 →「移动到…」把对照篇移到 `子目录`：下拉变为 `子目录/写作示例.md`，右侧仍是同一篇；再移回根目录恢复为 `写作示例.md`。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning；测完恢复单标签 `CaseTest.md`、关闭对照、焦点正文。
**人工复现**：开两篇笔记并用 `Ctrl+\` 对照其中一篇；在文件树把对照篇（或其所在文件夹）F2 改名 / 拖动或「移动到…」。右侧对照应继续显示同一篇，下拉里的路径跟着变，而不是换成别篇或空态。
**清理**：`写作示例.md` 已改回并在根目录，`子目录` 内容未动；应用停在单标签 `CaseTest.md`、分栏、侧栏「文件」、焦点正文、无弹层；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp-test350.mjs` / `cdp-eval.mjs` / `cdp-shot.mjs` 已删除。
**检验计数**：1（下一轮 351 按正常需求轮）。

## 第 349 轮 · 2026-11-02 13:40（检验轮）
**用户需求**：无新增；按 `.claude/loop.md` 第 6 节，系统性回归第 344–348 轮的五条改动。
**产品经理**：检验轮，不做新功能。五条都是命令面板滚动、查找焦点、图片浮层键盘缩放、分屏关闭焦点与最近工作区菜单开合，需确认后续提交没有把它们带坏。
**前端**：回归 `features/commands/CommandPalette.tsx`（344）、`features/editor/editor-bridge.ts` / `features/workspace/workspace-actions.ts`（345）、`features/preview/PreviewPane.tsx`（346）、`features/split/SplitPane.tsx`（347）、`app/TitleBar.tsx`（348）；无源码改动。
**后端**：无（未改 `src-tauri/`）。
**裁决**：检验完成，未发现缺陷。
**改动**：无源码改动；仅更新 `docs/loop/backlog.md` 与 `docs/loop/state.md`。
**构建**：`bun run build` 通过（含 tsc，vite 1.14s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始 `CaseTest.md` / 分栏）**：
- 344：`Ctrl+Shift+P` 打开 43 条命令，列表可视高 406 / 内容高 1659；连按 20 次 ↓ 后 `scrollTop` 0 → 390，高亮「段落：引用」底边在列表内；Esc 关闭后焦点回正文。
- 345：焦点在 `.tab-new` 按 `Ctrl+F`，`activeElement` 为 `.cm-search` 内的 `INPUT.cm-textfield`（占位符「查找」），Esc 关闭后回正文；纯预览里按 `Ctrl+F` 先切「分栏」并同样聚焦查找框。
- 346：`写作示例.md` 预览首图可聚焦（`IMG` / `role=button` / `tabIndex=0`），Enter 打开浮层「1 / 4」；`+` 三次到 175%（`scale(1.75)`、播报「缩放 175%」），`0` 回 100%，`-` 到 75%，连按到底分别停在 50% / 400%；`→` 翻到「2 / 4」且倍率保留；Esc 关闭后焦点回到原图 `IMG`。
- 347：`Ctrl+\` 打开对照，点右上角「关闭对照」后 `activeElement` 为 `DIV.cm-content`；重新打开、把焦点放到对照下拉再按 `Ctrl+\`，关闭后同样回到正文。
- 348：临时把 `D:\clawWorkSpeace\_c349other` 加进 `recentWorkspaces`；真实鼠标点库名菜单打开（`切换到 _c349other` + `打开其他文件夹…`、`aria-expanded=true`），再点同一按钮菜单归 0、`aria-expanded=false`、焦点回库名；测完恢复为仅当前库。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：命令面板连按 ↓ 应看到高亮项滚进视野；从文件树按 `Ctrl+F` 光标应在查找框；预览里 Tab 到图片 Enter 打开后按 `+ / - / 0` 缩放；关掉分屏对照焦点应回正文；最近工作区菜单开着时再点库名应收起。
**清理**：未修改任何笔记；`_c349other` 未创建，`recentWorkspaces` 已恢复为仅 `D:\clawWorkSpeace\新建文件夹`；整页重载后应用回到单标签 `CaseTest.md`、分栏、侧栏「文件」、焦点正文、无弹层；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp349-*.mjs` 已删除。
**检验计数**：0（下一轮 350 按正常需求轮）。

## 第 348 轮 · 2026-11-02 13:35
**用户需求**：场景：点标题栏的库名打开「最近工作区」，扫了一眼又不想切库。现在的问题：再点一次库名菜单不收，只有点别处或按 Esc 才关，和状态栏视图菜单「再点一次收起」不一致。期望：同一个按钮再点一次就把菜单收起来，Esc 与点别处关闭照旧。
**产品经理**：做。最近工作区菜单已完整，只是触发按钮缺「再点收起」这一下；只改开合判断，不改菜单项、切库、移除记录与焦点归还，符合「安静、快」，不碰「暂不做」。
**前端**：`app/TitleBar.tsx` 给库名按钮（有 / 无工作区两种形态）加 `onMouseDown`：菜单开着时拦下这次冒泡，避免 `ContextMenu` 的全局 mousedown 先关、随后 `onClick` 又重开；`onClick` 改为 `toggleRecentMenu`，开着就 `setRecentMenu(null)`，否则沿用 `openRecentMenu`。风险：只影响库名按钮的鼠标路径；菜单项选择、行尾 × 移除、Esc、点别处与关闭后焦点回库名均不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/app/TitleBar.tsx`（+18/−2 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.17s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始 `CaseTest.md` / 分栏）**：
- 改前：临时把最近工作区设为可切换的一项，真实鼠标点库名后菜单 1 个、`aria-expanded=true`；再点同一按钮，菜单仍为 1 个、`aria-expanded=true`，只是焦点回到按钮。
- 改后：第一下点开（菜单项「切换到…」「打开其他文件夹…」），第二下点同一按钮菜单归 0、`aria-expanded=false`，焦点回到 `.workspace-switch`；第三下重新打开。
- Esc 关闭后菜单归 0、焦点回库名按钮；点正文空白处同样关闭；全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`，0 error / warning。
**人工复现**：点库名打开最近工作区菜单，再点一次库名：菜单应收起；再点仍能打开，Esc / 点别处关闭与切库行为不变。
**清理**：`recentWorkspaces` 已恢复为仅当前库 `D:\clawWorkSpeace\新建文件夹`，未切库、未修改任何笔记；整页重载后应用回到单标签 `CaseTest.md`、分栏、侧栏「文件」、焦点正文、无弹层；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp348*.mjs`、`cdp-click-seq.mjs` 已删除。
**检验计数**：5（下一轮 349 做检验轮，回归 344–348）。

## 第 347 轮 · 2026-11-02 13:20
**用户需求**：场景：用键盘打开分屏对照（`Ctrl+\`），Tab 到右上角 × 按回车关闭，或焦点在对照下拉里再按 `Ctrl+\` 收起。现在的问题：触发关闭的 × / 下拉随面板一起卸载，焦点掉回 body，下一次 Tab 从窗口最左边重走，方向键也不再作用于正文。期望：关掉对照后焦点回到编辑器，键盘操作不断档。
**产品经理**：做。分屏对照已有完整的打开 / 切换 / 关闭路径，但关闭时是焦点黑洞；只补焦点归还，不改对照布局、渲染、滚动与只读规则，符合「快、安静」，不碰「暂不做」。
**前端**：`features/split/SplitPane.tsx` 新增 `wasOpen` ref 与随 `open` 变化的 effect：对照打开时记下，关闭后在下一帧检查 `document.activeElement === body`，只有焦点确实无处可去才聚焦 `.cm-content`，不抢用户已移走的焦点。风险：只在用户关闭对照时触发；打开时焦点保持原样，关闭后焦点若已在别处则不动作。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/split/SplitPane.tsx`（+18/−0 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.11s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始 `CaseTest.md` / 分栏）**：
- 改前：打开 `写作示例.md` 组成两个标签、`Ctrl+\` 打开对照，点右上角 × 关闭后 `document.activeElement` 为 `BODY`。
- 改后：同一路径点 × 关闭后 `activeElement` 为 `DIV.cm-content`；重新打开后把焦点放到「选择对照的笔记」下拉，按 `Ctrl+\` 关闭，焦点同样回到正文。
- 焦点本来就在正文时用 `Ctrl+\` 开 / 关对照，焦点保持 `cm-content` 不被抢；全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`，0 error / warning。
**人工复现**：开两篇笔记，`Ctrl+\` 打开对照；Tab 到右上角 × 按回车关闭，或直接点 ×：焦点应回到正文，Tab 接着走到标签 / 工具栏而不是窗口开头；焦点在对照下拉时按 `Ctrl+\` 关闭也一样。
**清理**：未修改任何笔记；标签关回单标签 `CaseTest.md`，对照已关闭，应用分栏、侧栏「文件」、焦点正文；临时 CDP 脚本 `/tmp/cdp347*.mjs` 已删除。
**检验计数**：4（下一轮 348 按正常需求轮）。

## 第 346 轮 · 2026-11-02 13:15
**用户需求**：场景：只用键盘在预览里看一篇带插图的笔记（第 342 轮已能 Tab 到图片、Enter 打开放大浮层）。现在的问题：浮层里只能用滚轮缩放，键盘用户打开大图后没法放大看细节，底部提示也只写「滚轮缩放」。期望：`+` / `-` 能在 50%–400% 间缩放、`0` 回到 100%，提示里写明，读屏能听到当前倍率。
**产品经理**：做。图片放大浮层已经补过键盘入口，但打开后的缩放只有鼠标滚轮一条路，是已实现功能里键盘用户的真实断点；只补键盘缩放与提示文案，不改缩放范围、拖动平移、翻页、双击复位与关闭逻辑，符合「快、安静」，不碰「暂不做」。
**前端**：`features/preview/PreviewPane.tsx` 打开浮层时的全局 keydown：`+` / `=` 放大 25%、`-` / `_` 缩小 25%（夹在 50%–400%）、`0` 回到 100%；带 Ctrl / Meta / Alt 的组合直接放行，方向键与 Esc 行为不变；底部提示改为「滚轮或 + / − 缩放」，浮层内新增常驻 `.sr-only` `role=status` 播报「缩放 N%」。风险：只在浮层打开时监听键盘，没有输入框可冲突；缩回 100% 时由既有 `zoom` effect 复位平移。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/preview/PreviewPane.tsx`（+26/−3 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.04s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始 `CaseTest.md` / 分栏）**：
- 打开 `写作示例.md` 切「预览」，点击首张图打开浮层：`aria-label`「示意图：蓝紫渐变」、计数「1 / 4」、提示「滚轮或 + / − 缩放 · Esc 关闭」、`scale(1)`，焦点在 `.image-lightbox` 容器。
- 真实按键 `+`（Shift+=）：计数「1 / 4 · 125%」、`scale(1.25)`、`.sr-only` 播报「缩放 125%」、提示切为「双击复位 · 滚轮或 + / − 缩放 · Esc 关闭」；再按两次到 175%，提示出现「拖动平移」。
- 按 `0`：回到 `scale(1)`、计数「1 / 4」、提示回初始文案、播报区清空；按 `-` 到 75%；连按六次 `-` 停在 50% 不再缩小；连按十三次 `+` 停在 400% 不再放大。
- 方向键翻页仍正常（`→` 到「2 / 4」、说明换成「小图：64 × 64」）；Esc 关闭浮层、回到单标签 `CaseTest.md`。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：预览里 Tab 到一张图按 Enter 打开浮层，不碰滚轮：按 `+` 应逐步放大并在底部看到百分比，按 `-` 缩小，按 `0` 回 100%；读屏应念出「缩放 N%」；左右键翻页、Esc 关闭不受影响。
**清理**：未修改任何笔记；`写作示例.md` 标签已关闭，视图还原「分栏」，应用回到单标签 `CaseTest.md`、侧栏「文件」、焦点正文、无弹层；临时 CDP 脚本 `/tmp/cdp346-*.mjs` 已删除。
**检验计数**：3（下一轮 347 按正常需求轮）。

## 第 345 轮 · 2026-11-02 13:11
**用户需求**：场景：焦点在文件树、大纲或工具栏上，想找正文里的一个词。现在的问题：按 `Ctrl+F` 查找面板确实弹出来了，但焦点仍留在正文（纯预览里按更明显：先切到分栏、焦点落到正文），直接输入会改到笔记内容。期望：面板一出现，光标就在「查找」框里，输入的是关键词。
**产品经理**：做。查找是核心写作动作，面板本身已存在，只是焦点落错；只修焦点、不改查找 / 替换逻辑与界面，符合「快、安静」，不碰「暂不做」。
**前端**：`features/editor/editor-bridge.ts` 去掉 `openEditorSearch()` 里打开面板后的 `view.focus()`——CodeMirror 面板挂载时会 `select()` 查找框，再把焦点交给正文反而会把它抢走；`features/workspace/workspace-actions.ts` 的 `changeViewMode` 在下一帧把焦点交给正文前，若焦点已在 `.cm-search` 内则跳过（覆盖「预览里 Ctrl+F 先切分栏再开面板」与命令面板执行「查找与替换」）。风险：只影响打开查找面板时的焦点；普通视图切换仍把焦点交给正文，Esc 关闭面板仍由 CodeMirror 把焦点还给正文。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/editor/editor-bridge.ts`（+2/−1 行）、`src/features/workspace/workspace-actions.ts`（+7/−1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.08s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始 `CaseTest.md` / 分栏）**：
- 改前：焦点在 `.tab-new` 时按 `Ctrl+F`，面板打开但 `document.activeElement` 为 `DIV.cm-content`；纯预览里按 `Ctrl+F` 先弹「已切到分栏」提示、焦点同样落在正文。直接键入会改到笔记。
- 改后：`.tab-new` 聚焦时按 `Ctrl+F`，`activeElement` 为 `INPUT.cm-textfield`、占位符「查找」；键入「CaseTest」只进入查找框，文档未变脏（`.doc-tab-dirty` 0 个，状态栏仍「已保存 12:48」）；按 Esc 面板关闭、焦点回到 `DIV.cm-content`。
- 纯预览（`mode-preview`）里按 `Ctrl+F`：切到 `mode-split` 后焦点在 `INPUT.cm-textfield`；命令面板执行「查找与替换」从预览切到分栏后同样聚焦查找框；编辑器内按 `Ctrl+F` 仍聚焦查找框。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：把焦点放到文件树 / 大纲 / 工具栏，按 `Ctrl+F`：光标应在「查找」框，直接打字只出现在框里；在纯预览里按 `Ctrl+F`：应切到分栏且光标在查找框；按 Esc 关闭后光标回正文。
**清理**：临时工作区 `D:\clawWorkSpeace\_c345rec` 已删除，`recentWorkspaces` 恢复为仅当前库；未打开 / 修改任何笔记；应用回到单标签 `CaseTest.md`、分栏、无弹层、焦点正文；临时 CDP 脚本已删除。
**检验计数**：2（下一轮 346 按正常需求轮）。

## 第 344 轮 · 2026-11-02 13:10
**用户需求**：场景：在命令面板里用方向键找一条不常用的命令。现在的问题：命令有四十多条，列表一屏放不下，焦点始终留在输入框，高亮项往下走几步就出了可视区，屏幕上看不到自己选到了哪条，只能盲按。期望：高亮项移动时列表跟着滚动，始终能看到当前选中的命令。
**产品经理**：做。命令面板的方向键选择与读屏播报都已完成，只差「选中项滚进视野」这一条视觉反馈；不改命令集、分组、搜索与执行逻辑，符合「快、安静」，不碰「暂不做」。
**前端**：`features/commands/CommandPalette.tsx` 给命令列表加 `listRef`，新增一个随 `index` / `visible` / `open` 变化的 effect，把 `.palette-item.is-active` 用 `scrollIntoView({ block: "nearest" })` 收进列表可视区。风险：只影响列表滚动位置；输入过滤后回到第一项并滚回顶部，鼠标悬停、回车执行、Esc 关闭与焦点归还均不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/commands/CommandPalette.tsx`（+11/−0 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.05s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始 `CaseTest.md`）**：
- `Ctrl+Shift+P` 打开面板：43 条命令，列表可视高 406、内容高 1659，初始高亮「另存为…」在框内。
- 连按 20 次 ↓：高亮移到「无序列表」，列表 `scrollTop` 0 → 390，高亮项底边 653 与列表底边 653 对齐、完全可见（改前停在 1009，落在框外）；20 次 `scrollIntoView` 调用全部发生在 `.palette-list` 内。
- 再连按 10 次 ↑：高亮回到「导出 PDF」，列表保持滚动、高亮项仍在框内。
- 在输入框键入「视图」：结果收窄为 4 条，高亮回到第一条「源码」，列表滚回顶部且可见。
- 按 Esc 关闭：面板 0 个，焦点回到正文，文档仍为 `CaseTest.md`。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：`Ctrl+Shift+P` 打开命令面板，按住 ↓ 走过一屏：高亮条应一直跟着滚进视野；输入关键词过滤后列表应回到顶部并从第一条开始选。
**清理**：未打开 / 修改任何笔记；面板已关闭，应用回到 `CaseTest.md`、焦点正文；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp344*.mjs` 与 `/tmp/cdp344*.mjs` 已删除。
**检验计数**：1（下一轮 345 按正常需求轮）。

## 第 343 轮 · 2026-11-02 13:00（检验轮）
**用户需求**：无新增；按 `.claude/loop.md` 第 6 节，系统性回归第 338–342 轮的五条改动。
**产品经理**：检验轮，不做新功能。五条都是搜索展示、弹层焦点、菜单焦点归还、待办名称与预览图片键盘入口，仍需在真实运行的应用里确认后续提交没有把它们带坏。
**前端**：回归 `SearchPanel.tsx`（338）、`HistoryDialog.tsx` / `MoveDialog.tsx`（339）、`AppMenu.tsx`（340）、`PreviewPane.tsx` / `decorations.ts` / `widgets.ts`（341、342）；无源码改动。
**后端**：无（未改 `src-tauri/`）。
**裁决**：检验完成，未发现缺陷。
**改动**：无源码改动；仅更新 `docs/loop/backlog.md` 与 `docs/loop/state.md`。
**构建**：`bun run build` 通过（含 tsc，vite 1.06s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始 `CaseTest.md` / 分栏）**：
- 338：临时笔记 `_c343long.md` 的单行段落 129 字，搜索「独特尾巴词」（位于约第 120 字）得 1 条结果；结果文本以「…」开头，`<mark>` 矩形 185–201 落在两行结果框 166–202 内，`markVisible=true`，不再被裁掉。
- 339：打开 `空笔记.md`（0 条历史）按 `Ctrl+Alt+H`，焦点落在 `DIV.modal.history-modal`（`tabindex=-1`），Tab 到「关闭」仍在框内，Esc 关闭后回正文；临时工作区 `_c343ws`（只有 `only.md`、无子文件夹）里对 `only.md` 打开「移动到…」，0 个目标时焦点落在 `DIV.modal.move-modal`，Tab 到「取消」，Esc 后焦点回 `only.md` 文件行。
- 340：键盘展开「视图」并执行「预览」，焦点回到 `BUTTON.menubar-item`（「视图」），视图为预览；「分栏」由命令把焦点交给正文、「隐藏 / 显示侧栏」焦点回「视图」；「文件 → 另存为…」焦点进入文件名输入框，Esc 取消后回正文。
- 341：预览 4 个复选框名称为「切换任务完成状态：打开工作区」等；所见模式滚动到任务列表后 4 个 `.cm-wysiwyg-task` 名称为「标记为未完成 / 完成：…」，状态与动作方向正确。
- 342：预览 4 张非链接图片均为 `role=button` / `tabIndex=0`，名称「查看大图：…」（无替代文字一张为「查看大图」）；聚焦首张按 Enter 打开浮层并聚焦容器，计数「1 / 4」、→ 到「2 / 4」，Esc 后焦点回原图，空格同样可打开。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning；整页重载后回到单标签 `CaseTest.md`、分栏、侧栏「文件」、焦点正文、无弹层。
**人工复现**：按各轮记录中的复现步骤逐条执行（长段落搜索、空历史 / 空目标弹层、菜单执行后焦点、待办名称、预览图片键盘放大），应得到上述结果。
**清理**：临时笔记 `_c343long.md`、临时工作区 `D:\clawWorkSpeace\_c343ws` 与 CDP 脚本均已删除；`recentWorkspaces` 恢复为仅当前库，`lastWorkspace` 未变。
**观察**：删除最近工作区中的临时条目后菜单收起时，焦点未回到库名按钮而落在正文——该路径属于第 326 轮，不属本批五条，未深究；若下一轮涉及最近工作区可复核。
**检验计数**：0（下一轮 344 按正常需求轮）。

## 第 342 轮 · 2026-11-02 12:55
**用户需求**：场景：只用键盘或读屏在预览里看一篇带插图的笔记。现在的问题：图片点击会打开放大浮层，但图片本身不在 Tab 序里、也没有可操作的语义，键盘用户永远打不开大图，读屏也听不出这张图能放大。期望：Tab 能走到图片，回车 / 空格与鼠标点击一样打开浮层，Esc 关闭后焦点回到这张图。
**产品经理**：做。图片放大是已实现的预览功能，但只写了鼠标路径，是键盘 / 读屏用户完全够不到的真实断点；只补入口与焦点归还，不改放大、缩放、翻页逻辑与视觉，符合「安静、快」，不碰「暂不做」。
**前端**：`features/preview/PreviewPane.tsx` 在预览每次上屏后给非链接图片补 `tabIndex=0`、`role=button` 与「查看大图：替代文字」名称；既有预览点击委托补 `keydown`（Enter / 空格），复用 `openLightbox`。浮层原本就会聚焦容器、关闭后还原原焦点，无需改动。`features/preview/preview.css` 给这类图片加 `cursor: zoom-in`。风险：图片进入 Tab 序；链接里的图片继续由链接承担停靠点，不重复进入。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/preview/PreviewPane.tsx`（+29/−0 行）、`src/features/preview/preview.css`（+5/−0 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.07s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始 `CaseTest.md` / 分栏）**：
- 打开 `写作示例.md` 切「预览」：4 张非链接图片的 `role=button`、`tabIndex=0`、名称为「查看大图：示意图：蓝紫渐变」等，无替代文字的一张为「查看大图」，`cursor: zoom-in`；正文里的「打开宽图」等仍是普通链接。
- 聚焦首张图按 Enter：`.image-lightbox` 出现、焦点进入浮层（`aria-label` 为图片说明）、计数「1 / 4」；→ 翻到第 2 张，计数「2 / 4」、替代文字同步。
- 按 Esc 关闭：浮层移除，焦点回到同一张 `IMG`（`role=button`）；再按空格同样打开浮层，Esc 关闭正常。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：整页重载后打开含图片的笔记，切「预览」，只用 Tab 走到图片（应有焦点描边、鼠标样式为放大镜），按回车或空格：应打开放大浮层；按 Esc 关闭后焦点仍在原图，Tab 可继续往后走。
**清理**：未修改任何笔记；`写作示例.md` 标签已关闭，视图还原「分栏」，应用回到单标签 `CaseTest.md`、无弹层、焦点正文；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp342*.mjs` 已删除。
**检验计数**：5（下一轮 343 做检验轮，回归 338–342）。

## 第 341 轮 · 2026-11-02 12:53
**用户需求**：场景：一篇笔记里有好几条待办，用读屏在预览或所见即所得里逐项勾选。现在的问题：每个复选框的名称都一样（预览里是「切换任务完成状态」，编辑器里是「标记为完成 / 标记为未完成」），听完不知道正在勾的是哪一条待办。期望：复选框的名称里带上这一条的任务文字。
**产品经理**：做。任务复选框本身已可点击 / 空格切换，但读屏名称没有上下文，是已实现待办勾选的粗糙处；只补名称、不改勾选逻辑、列表渲染或布局，符合「安静、快」，不碰「暂不做」。
**前端**：`features/preview/PreviewPane.tsx` 在放开预览复选框时，从所在 `li` 取任务文字，超过 40 字截断，拼成「切换任务完成状态：…」；`features/editor/live-preview/decorations.ts` 在创建 `TaskWidget` 时取复选框标记到行尾的文字，`widgets.ts` 的 `TaskWidget` 新增 `text` 并纳入 `eq`，名称为「标记为完成 / 未完成：…」。风险：仅影响 `aria-label`，勾选写回、键盘 / 鼠标操作与视觉不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/preview/PreviewPane.tsx`（+9/−1 行）、`src/features/editor/live-preview/decorations.ts`（+6/−1 行）、`src/features/editor/live-preview/widgets.ts`（+11/−2 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.07s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始 `CaseTest.md` / 分栏）**：
- 打开含 4 条待办的 `写作示例.md`，切「预览」：四个复选框的 `aria-label` 依次为「切换任务完成状态：打开工作区」「…：在预览里直接勾选任务」「…：回到源码确认 [x] 已写回」「…：试试回车自动续写 - [ ]」，不再全是同一句。
- 切「所见」（编辑器滚动到任务列表）：四个 `.cm-wysiwyg-task` 的名称分别为「标记为未完成：打开工作区」「标记为未完成：在预览里直接勾选任务」「标记为完成：回到源码确认 `[x]` 已写回」「标记为完成：试试回车自动续写 `- [ ] `」，完成状态与动作方向对应。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：开读屏，打开一篇有多条 `- [ ]` 待办的笔记，Tab 到预览里的任务复选框（或所见模式里的复选框）：每一下都应念出该条任务文字，而不是每个都念同一句。
**清理**：未勾选 / 未修改任何笔记；`写作示例.md` 标签已关闭，应用回到单标签 `CaseTest.md`、分栏、无弹层、焦点正文；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp341*.mjs` 已删除。
**检验计数**：4（下一轮 342 按正常需求轮）。

## 第 340 轮 · 2026-11-02 12:48
**用户需求**：场景：只用键盘从标题栏菜单执行动作，比如「视图 → 预览」「视图 → 显示侧栏」或「文件 → 保存」。现在的问题：菜单项一执行，菜单随即卸载，这些命令又不会自己把焦点交给编辑器或弹层，焦点掉到 `body`，下一次 Tab 从窗口最开头（侧栏开关）重走；可是按 Esc 关菜单却会把焦点还给触发菜单的顶层按钮，两者不一致。期望：执行菜单项后，若没有别的控件接管焦点，就回到触发菜单的那一项，Tab 从这里继续。
**产品经理**：做。这是键盘用户从菜单执行动作后的真实断点；菜单本身已实现单停靠点、↑↓ / Home / End 与 Esc 回焦，只差「执行完」这一条路径。改动只补焦点兜底，不改命令内容、菜单布局与快捷键，符合「安静、快」，不碰「暂不做」。
**前端**：`app/AppMenu.tsx` 的 `choose` 在 `command.run()` 之后用 `requestAnimationFrame` 检查一次：只有焦点确实落在 `body` 时才 `anchor.focus()`；弹层 / 编辑器自己接管焦点的命令（另存为输入框、切换可编辑视图后的正文、加粗等）不受影响。风险：仅影响「命令执行后没人接焦点」的情形，鼠标操作几乎无感。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/app/AppMenu.tsx`（+7/−0 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.07s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，当前 `CaseTest.md` / 分栏 / 侧栏显示）**：
- 改前：键盘聚焦「视图」并回车展开，选中「预览」回车——视图切到「预览」，焦点 `BODY`，下一次 Tab 从窗口最开头重走（与 Esc 关闭却回到「视图」不一致）。
- 改后：同一路径选「预览」，焦点落在 `BUTTON.menubar-item`（「视图」，`aria-expanded=false`），视图为「预览」。
- 「视图 → 分栏」：命令自身会把焦点交给正文，最终仍在 `DIV.cm-content`，没有被兜底抢回触发按钮；「视图 → 隐藏 / 显示侧栏」：侧栏状态翻转，焦点回到「视图」。
- 「文件 → 保存」：文档保持已保存，焦点回到「文件」；「文件 → 另存为…」：弹窗输入框 `INPUT.text-input` 照常获得焦点（`modal` 标题「另存为」），Esc 取消后无弹窗、焦点回正文。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：用键盘 `Tab` 到标题栏「视图」→ 回车 → ↓ 选「预览」→ 回车：焦点应仍停在「视图」按钮上，Tab 继续在菜单栏 / 标签区前进，而不是从窗口开头重来；对「显示侧栏」同样。再用「另存为…」确认焦点进入文件名输入框。
**清理**：另存为弹窗已按 Esc 取消，未创建副本；应用回到单标签 `CaseTest.md`、分栏、侧栏显示、焦点正文；临时 CDP 脚本 `cdp340*.mjs` 已删除。
**检验计数**：3（下一轮 341 按正常需求轮）。

## 第 339 轮 · 2026-11-02 12:43
**用户需求**：场景：只用键盘 / 读屏，在一篇还没保存过的新笔记上按 `Ctrl+Alt+H` 看历史，或在没有子文件夹的库里对文件选「移动到…」。现在的问题：框里暂时没有可聚焦的条目（空历史 / 没有目标文件夹 / 正在读取）时，焦点仍留在后面的编辑器 / 文件树，读屏不报弹层，Tab 会穿过界面跑到弹层后面；期望：打开时焦点先进入弹层本身，有选项后再交给第一项，Esc 关闭后回到原处。
**产品经理**：做。确认框、设置、更新弹窗都已采用「打开即聚焦弹层容器」的同一规则；文档历史与「移动到…」在空态 / 读取中漏了这一步，是已实现功能的真实无障碍粗糙处。只补焦点入口，不改历史读取、移动目标与按钮逻辑，符合「安静、快」，不碰「暂不做」。
**前端**：`features/history/HistoryDialog.tsx`、`features/workspace/MoveDialog.tsx` 各给弹层容器补 `tabIndex={-1}` 与 ref，打开时聚焦容器（历史在记录原焦点之后执行）；已有版本 / 目标时沿用原有「首项 autoFocus / 读到目标后聚焦首项」，空态则停在弹层、Tab 收进「关闭 / 取消」并在框内循环。风险：仅影响打开瞬间的焦点，关闭后还原原焦点的顺序不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/history/HistoryDialog.tsx`（+10/−0 行）、`src/features/workspace/MoveDialog.tsx`（+6/−0 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.07s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- 空历史：打开 `空笔记.md`（历史 0 条）按 `Ctrl+Alt+H`，改前焦点在 `.cm-content`；改后焦点落在 `DIV.modal.history-modal`（`tabindex=-1`，框内），读屏可获得对话框标题；Tab 到「关闭」，再 Tab 仍留在框内，Esc 关闭后焦点回 `.cm-content`。
- 有历史：`CaseTest.md`（3 条）打开历史，焦点仍落在首条 `history-item is-active`，与改前一致，无回归；Esc 关闭正常。
- 移动（有目标）：对 `CaseTest.md` 选「移动到…」，焦点落在第一个 `.move-option`（2 个目标），无回归；Esc 关闭后焦点回正文。
- 移动（空目标）：临时建一个只有 `only.md`、没有子文件夹的工作区 `D:\clawWorkSpeace\_c339ws`，打开「移动到…」显示「没有其它可以放进去的文件夹。」，改后焦点落在 `DIV.modal.move-modal`；Tab 到「取消」，再 Tab 仍在框内；Esc 关闭后焦点回 `.cm-content`。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：用键盘打开一篇从未保存过的新笔记（历史为空）按 `Ctrl+Alt+H`：焦点应进入对话框，第一次 Tab 落到「关闭」而不是背后界面；在一个没有子文件夹的库中对根目录文件右键选「移动到…」，焦点应进入对话框，Tab 只到「取消」。
**清理**：临时工作区 `D:\clawWorkSpeace\_c339ws` 已删除；最近工作区恢复为仅当前库、`lastWorkspace` 未变；临时标签 `空笔记.md` 已关闭，应用回到单标签 `CaseTest.md`、焦点正文、无弹层；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp339*.mjs`、截图与探测文件已删除。
**检验计数**：2（下一轮 340 按正常需求轮）。

## 第 338 轮 · 2026-11-02 12:37
**用户需求**：场景：在侧栏全文搜索一个写在长段落靠后的词。现在的问题：搜索结果只露出这一行开头的两行，命中词在后面被裁掉，结果行里看不到任何高亮，甚至分不清这一条为什么会算命中。期望：结果从命中词前一小段开始显示，让高亮始终落在可见的两行里。
**产品经理**：做。第 182 轮就承诺「结果显示命中行并高亮」，但长行只从行首截取两行，高亮经常落在裁掉的部分，是已实现搜索功能的真实粗糙处；只改结果文本的截取起点，不改搜索、排序、打开与跳转，符合「快、安静」，不碰「暂不做」。
**前端**：`features/workspace/SearchPanel.tsx` 新增 `contextAround`：在命中行中大小写不敏感地找首个命中，位置超过 16 个字符时从命中前 16 个字符开始显示并加「…」，否则保持行首；渲染结果时先截窗口再包 `<mark>`。`hitOffset` 仍用编辑器里的完整行计算落点，不受影响。风险：仅影响结果行的展示文本；同词多处命中仍取第一个，命中在返回文本前 240 字符内都能露出（后端本身只回传前 240 字符）。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/workspace/SearchPanel.tsx`（+13/−1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.22s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，当前 `CaseTest.md`）**：
- 改前：临时笔记 `_c338long.md` 的单行段落约 182 字，搜索「独特尾巴词」（位于约第 140 字），结果行文本 2 行高 36px（166–202），`<mark>` 矩形 top 311、bottom 327，落在裁切区外，`markVisible=false`，行内看不到高亮。
- 改后：同一搜索的结果文本以「…」开头、截到命中前 16 字，`<mark>` 矩形 top 185、bottom 201，落在 166–202 内，`markVisible=true`；结果条数与状态「1 条结果」不变。
- 回归：搜索「写作」得 10 条（含临时笔记），首条命中在行首、文本不以「…」开头，10 条的 `<mark>` 全部在可见两行内；视觉状态与键盘 / 点击逻辑未变。
- 清理临时笔记后整页重载：回到单标签 `CaseTest.md`、侧栏「文件」、焦点在正文 `.cm-content`、无弹层；全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：在一篇笔记里写一段一百多字的单行长段落，把某个不重复的词放在靠后位置 → 侧栏「搜索」输入它：结果行应从命中词附近开始显示（前面可能带「…」），且该词有高亮，而不是只显示段落开头、看不到高亮。
**清理**：临时笔记 `D:\clawWorkSpeace\新建文件夹\_c338long.md` 与临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp338*.mjs` 已删除；未修改任何既有笔记。
**检验计数**：1（下一轮 339 按正常需求轮）。

## 第 337 轮 · 2026-11-02 12:33（检验轮）
**用户需求**：无新增；按 `.claude/loop.md` 第 6 节，系统性回归第 332–336 轮的五条改动。
**产品经理**：检验轮，不做新功能。五条都属于搜索 / 编辑器 / 分屏 / 命令面板的无障碍与文案打磨，仍需在真实运行的应用里确认键盘与读屏路径没有被后续提交带坏。
**前端**：回归 `SearchPanel.tsx`（332、333）、`editor-setup.ts`（334）、`SplitPane.tsx`（335）、`CommandPalette.tsx`（336）；无源码改动。
**后端**：无（未改 `src-tauri/`）。
**裁决**：检验完成，未发现缺陷。
**改动**：无源码改动；仅更新 `docs/loop/backlog.md` 与 `docs/loop/state.md`。
**构建**：`bun run build` 通过（含 tsc，vite 1.40s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，起始 `CaseTest.md`）**：
- 332：侧栏搜索「不影响文件本身」得 28 条，点首条打开 `长文档.md`，光标落在命中行「…都不|不影响…」处（0-based 偏移 41，即第 42 字），行高亮与结果列表不变。
- 333：常驻播报区 `role=status` / `aria-live=polite` / `aria-atomic=true`，查询后播「找到 28 条结果」且与结果行数一致；乱码词播「没有匹配的内容」、行数 0；清空回空串，视觉状态行仍 `aria-hidden`。
- 334：`Ctrl+F` 面板三个勾选框为「区分大小写 / 正则表达式 / 全字匹配」，面板内不再出现「by word」，查找 / 替换输入与按钮文案未变。
- 335：同时打开根目录与 `子目录/README.md` 后切回 `CaseTest.md`，对照下拉两项分别为「README.md（根目录）」「README.md（子目录）」，当前对照项选中根目录那篇；`aria-label` 未变；关闭分屏与 README 标签后回单标签。
- 336：`Ctrl+Shift+P` 输入框为 `role=combobox` / `aria-autocomplete=list` / `aria-expanded=true` / `aria-controls=palette-list`，初始 `aria-activedescendant=palette-opt-new`（新建笔记），↓ 两次依次「打开文件夹…」「保存」，`aria-selected` 同步；输入 `zzzqqq` 后 `expanded=false`、引用移除；Esc 关闭后焦点回正文。
- 全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning；应用回到单标签 `CaseTest.md`、侧栏「文件」、无分屏 / 弹层 / 提示。
**人工复现**：见上五条；重点用读屏确认 332 的落点、333 的条数播报与 336 的方向键命令名。
**清理**：临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp337*.mjs` 已删除；未打开或修改任何笔记内容。
**检验计数**：清零（下一轮 338 按正常需求轮）。

## 第 336 轮 · 2026-11-02 12:29
**用户需求**：场景：只用键盘 / 读屏在命令面板里找动作，按 `Ctrl+Shift+P` 后连按 ↓ 挑命令。现在的问题：焦点一直在输入框，只有视觉高亮跟着走，读屏听不出当前选中了哪一条，只能靠记忆数按了几下；期望：像搜索面板一样，选中项被读成「第几条 / 命令名」，方向键移动时跟着报。
**产品经理**：做。第 285 轮已给侧栏搜索结果补上 `aria-activedescendant`，命令面板是同一类「焦点留在输入框、方向键换高亮」的交互，却一直没告诉读屏选中项；只补无障碍语义，不改搜索、排序、↑↓ 与回车执行，符合「安静、快」，不碰「暂不做」。
**前端**：`features/commands/CommandPalette.tsx` 的输入框改为组合框语义（`role="combobox"` / `aria-autocomplete="list"` / `aria-expanded` / `aria-controls="palette-list"` / `aria-activedescendant`），结果列表加 `id`，每个选项加 `palette-opt-<命令 id>`；当前高亮项由既有 `index` 推出，无结果时移除引用，避免指向不存在的节点。风险：仅影响无障碍树与 DOM id；键盘执行、鼠标悬停、最近使用分组与空结果提示不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/commands/CommandPalette.tsx`（+16/−1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.29s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，当前 `CaseTest.md`）**：
- 改前代码中输入框只有 `aria-label`，没有 `role` / `aria-controls` / `aria-activedescendant`，选项也没有 id。
- 改后 `Ctrl+Shift+P`：输入框 `role="combobox"`、`aria-autocomplete="list"`、`aria-expanded="true"`、`aria-controls="palette-list"`，`aria-activedescendant="palette-opt-new"`，对应选项「新建笔记」为 `aria-selected="true"`，焦点仍在输入框，列表 43 条。
- 按 ↓ 一次指向 `palette-opt-open-workspace`（「打开文件夹…」）、两次指向 `palette-opt-save`（「保存」），每步仅该选项 `aria-selected="true"`，高亮与引用同步。
- 输入不存在的 `zzzqqq`：选项 0 条、`aria-expanded="false"`、`aria-activedescendant` 移除，视觉仍是「没有匹配的命令」。
- Esc 关闭后命令面板移除，焦点回到正文 `.cm-content`；全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：开读屏 → `Ctrl+Shift+P` → 连按 ↓：读屏应念出当前高亮的命令名，而不是一直停在输入框；输入无结果关键词时不应再报旧命令；Esc 后焦点回正文。
**清理**：命令面板已关闭，标签仅 `CaseTest.md`、所见、侧栏「文件」；未打开或修改任何笔记；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp336.mjs` 已删除。
**检验计数**：5（下一轮 337 做检验轮，回归 332–336）。


## 第 335 轮 · 2026-11-02 12:27
**用户需求**：场景：同时开着根目录和子目录下的两篇 `README.md`，打开右侧「对照」想选其中一篇。现在的问题：下拉里两行都只写 `README.md`，完全分不清谁是谁，只能猜一个再关掉重开。期望：重名时像标签栏一样带上一段所在目录。
**产品经理**：做。第 274 轮只解决了标签栏同名笔记的区分，分屏对照的选择下拉仍只显示文件名，是同一批多标签使用流里的真实粗糙处；只补选项文案，不改对照渲染、切换或分屏布局，符合「安静、快」，不碰「暂不做」。
**前端**：`features/split/SplitPane.tsx` 新增 `distinguishLabels`，与标签栏同一规则：仅在打开的笔记重名时，从最近一级父目录往外找一段足以区分的后缀，根目录显示「根目录」，不重名的笔记保持原文案；下拉选项改用该映射。风险：仅影响 `select` 的选项文本；对照笔记的读取、渲染、选择值与「没有其他打开的笔记」空态不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/split/SplitPane.tsx`（+42/−2 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.29s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，当前 `CaseTest.md`）**：
- 打开根目录 `README.md` 与 `子目录/README.md` 两个标签（标签栏按既有规则显示「README.md · 根目录 / README.md · 子目录」），按 `Ctrl+\` 打开分屏对照。
- 当前为 `子目录/README.md` 时，下拉选项为 `CaseTest.md`（保持原名）与 `README.md（根目录）`，当前对照项选中正确。
- 切回 `CaseTest.md` 后，两个重名笔记同时成为可选项，下拉为 `README.md（根目录）`、`README.md（子目录）`，不再有两行相同文本；`select` 的 `aria-label`、选择值与对照渲染不变。
- 关闭两个 README 标签与分屏后回到单标签 `CaseTest.md`、无弹层 / 提示；全程收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：同时打开不同目录下的两篇同名笔记 → `Ctrl+\` 打开「对照」→ 点顶部下拉：两个同名选项应分别带「（根目录）」「（子目录）」等目录后缀；只打开不重名的笔记时仍显示原始文件名。
**清理**：README 标签与分屏已关闭，应用回到单标签 `CaseTest.md`、侧栏「文件」；未打开或修改任何笔记内容；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp335.mjs`、`cdp335b.mjs` 已删除。
**检验计数**：4（下一轮 336 按正常需求轮）。

## 第 334 轮 · 2026-11-02 12:24
**用户需求**：场景：在中文界面里按 Ctrl+F 查找或替换。现在的问题：查找面板已经整体是中文，但「区分大小写」「正则表达式」旁边的第三个勾选框仍写着英文「by word」，和周围格格不入；期望：它也说中文，比如「全字匹配」，勾上后的行为不变。
**产品经理**：做。查找面板的中文短语是第 196 轮统一过的，`searchPhrases` 漏了 CodeMirror 的这一个键，是既有功能的真实粗糙处；只补一处文案，不改查找 / 替换逻辑、快捷键或面板布局，符合「安静、本地优先」，不碰「暂不做」。
**前端**：`features/editor/editor-setup.ts` 的 `searchPhrases` 增加 `"by word": "全字匹配"`（与「区分大小写 / 正则表达式」并排，沿用编辑器全字匹配的常见译法）。风险：仅影响该勾选框的可读文本，勾选状态与匹配行为不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/editor/editor-setup.ts`（+1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.41s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，当前 `CaseTest.md`、所见）**：
- 改前：Ctrl+F 面板三个勾选框为「区分大小写 / 正则表达式 / by word」。
- 改后：同样的 Ctrl+F，三个标签为「区分大小写 / 正则表达式 / 全字匹配」；占位符「查找 / 替换」、按钮「下一个 / 上一个 / 全部 / 替换 / 全部替换」与关闭按钮均保持中文。
- 点「全字匹配」后 `name=word` 勾选框 `checked=true`，关闭面板（× / Esc）后焦点回到正文 `.cm-content`，文档与视图（`CaseTest.md` / 所见）不变。
- 整页重载与操作期间收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：中文界面里在正文按 Ctrl+F：查找面板的第三个勾选框应显示「全字匹配」而不是「by word」；勾选后只匹配整词，取消后恢复子串匹配，其余查找 / 替换按钮与快捷键不变。
**清理**：查找面板已关闭，焦点回正文；标签仅 `CaseTest.md`，未打开或修改任何笔记；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp334*.mjs` 已删除。
**检验计数**：3（下一轮 335 按正常需求轮）。

## 第 333 轮 · 2026-11-02 12:25
**用户需求**：场景：用读屏软件在侧栏做全文搜索。现在的问题：输入关键词后只有输入框和结果列表，听不到这次搜到多少条、有没有匹配，想确认得 Tab 出输入框逐条听或凭感觉按 ↓；期望：结果落地后读屏安静地念一句「找到 N 条结果」或「没有匹配的内容」，不要在每次敲字时先念「搜索中」打断。
**产品经理**：做。第 285 轮让读屏知道「选中哪一条」，但「有没有结果 / 共几条」仍只在视觉状态行里；只补一条常驻播报，不改搜索、结果排序、打开与跳转，查询期间保持安静，符合「安静、快」，不碰「暂不做」。
**前端**：`features/workspace/SearchPanel.tsx` 新增常驻 `.sr-only` 播报区（`role="status"` / `aria-live="polite"` / `aria-atomic="true"`）；`loading` 时内容留空，结果落地后播「找到 N 条结果」、达到上限播「找到 200+ 条结果，仅显示前 200 条」、无匹配播「没有匹配的内容」；视觉状态行加 `aria-hidden="true"` 避免重复朗读，样式与布局不变。风险：只影响读屏播报；查询、↑↓ / 回车、点击打开与高亮均不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/workspace/SearchPanel.tsx`（+25/−2 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.16s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，当前 `CaseTest.md`）**：
- 打开侧栏「搜索」：`.search-panel [role="status"]` 已存在、`sr-only`、文本为空；输入框获得焦点；无查询时视觉 `.search-status` 不渲染（与改前一致，常驻播报区不占布局）。
- 输入「写作」：播报区为「找到 9 条结果」，视觉状态仍为「9 条结果」且 `aria-hidden="true"`，结果 9 条。
- 输入「zzzqqqxxx」：播报「没有匹配的内容」，视觉一致，结果 0 条。
- 输入「的」：播报「找到 69 条结果」；清空查询后播报区回到空串、视觉状态消失。
- 无障碍树：新增的 `role=status` 节点 `live=polite`、`atomic=true`（既有 Toast 的 status 仍为 `atomic=false`，互不影响）。
- 整页重载与操作期间收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**人工复现**：开读屏 → 侧栏「搜索」输入一个能出结果的词：结果出现后应念「找到 N 条结果」；换成一个不存在的词应念「没有匹配的内容」；连续敲字过程中不应每次都先念「搜索中」。视觉上的「搜索中… / N 条结果」与结果列表、键盘选择行为保持原样。
**清理**：查询已清空，侧栏回到「文件」，焦点回正文 `.cm-content`；标签仅 `CaseTest.md`，未打开或修改任何笔记；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp333.mjs`、`cdp333b.mjs` 已删除。
**检验计数**：2（下一轮 334 按正常需求轮）。

## 第 332 轮 · 2026-11-02 12:17
**用户需求**：场景：用侧栏全文搜索一句写在长句中间的话。现在的问题：点搜索结果打开笔记后，光标总停在命中那一行的行首，长句里的匹配常在中后段，还得再横向找一遍；期望：直接落在命中词上。
**产品经理**：做。第 323 轮只补了查询期间旧结果误开，命中落点仍是行首，是搜索落地后剩下的一处手感粗糙；只把光标从行首挪到匹配词，不改搜索、结果排序、打开文档与视图切换，符合「快、安静」，不碰「暂不做」。
**前端**：`features/workspace/SearchPanel.tsx` 新增 `hitOffset`：在编辑器正文里取出命中行，按与高亮一致的大小写不敏感找到首个匹配，偏移 = 行首 + 匹配字符位置；找不到时仍回行首。`openHit` 改用该偏移跳转。风险：同一行多处命中仍取第一个（后端每行只返回一条）；中文与拉丁大小写不敏感；查询前后空白仍按既有 `trim` 处理。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/workspace/SearchPanel.tsx`（+19/−3 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.17s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，`长文档.md` 分栏）**：
- 改前基线：侧栏搜索「不影响文件本身」得 28 条，首条 `长文档.md:9`；点击后状态栏光标为 `9:1`。
- 改后同一路径：首条仍为 `长文档.md:9`，点击后光标为 `9:42`——该行第 42 个字符正是「不」；命中行、结果条数与列表内容均未变。`scrollLeft` 为 0，该行在视宽内。
- 整页重载后收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning；标签、视图与侧栏状态正常恢复。
**人工复现**：侧栏「搜索」输入一句出现在长句中间的话 → 点或回车打开首个结果：状态栏列号应指向匹配词而不是 1，编辑器光标停在匹配词上；同一行有多个匹配时停在第一个。搜索仍应边输边搜、列出路径 / 行号 / 命中行。
**清理**：搜索框查询随面板卸载清空，侧栏回「文件」；临时打开的长文档标签已关闭，应用回到单标签 `CaseTest.md`、所见、焦点正文、无弹层 / 提示；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp332*.mjs` 已删除。
**检验计数**：1（下一轮 333 按正常需求轮）。


## 第 331 轮 · 2026-11-02 12:11（检验轮）
**回归范围**：第 326–330 轮（最近工作区 Delete 移除、Toast 聚焦暂停自动关闭、移动对话框单停靠点、最近工作区菜单「打开其他文件夹…」、F2 改名后焦点跟随新路径）。
**构建**：`bun run build` 通过（含 tsc，vite 1.29s，仅既有的 chunk 体积与动态导入提示）；本轮未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，当前 `CaseTest.md`；按键用 CDP `Input.dispatchKeyEvent` 真实派发，原生窗口按 Feiye 进程的 `#32770` 计数）**：
- 326：临时把 `Feiye` 与一个不存在的库记入最近工作区后打开菜单，2 条最近 +「打开其他文件夹…」共 3 行；首项自动聚焦，`Delete` 移除后设置剩 1 条、菜单保持展开、出现「已从最近工作区移除…」提示、焦点落到相邻项；再按 `Delete` 删最后一条，菜单收起、焦点回到 `.workspace-switch`，最近列表清空。
- 327：置入一条带动作提示并把焦点交给它，4 秒后提示仍在、焦点仍在按钮（改前 3 秒即消失）；焦点移回正文约 3.5 秒后提示消失；无焦点普通提示仍按 3 秒消失。
- 328：从 `CaseTest.md` 右键「移动到…」打开对话框，2 个目标初始 `tabIndex` 为 `[0,-1]`，焦点在首项；`↓` 后为 `[-1,0]` 且仍只有 1 个 0；一次 `Tab` 直接到「取消」；`Esc` 关闭、弹层归 0。
- 329：菜单末项为「打开其他文件夹…」，`title` 含 Ctrl+O，无行尾 ×、无 `aria-keyshortcuts`；库名 `aria-label` 为「…切换或打开工作区」；`↓` 到末项按 `Enter` 后菜单收起，Feiye 进程出现 1 个可见 `#32770`「选择工作区文件夹」，关闭后归 0。
- 330：临时建 `_r331a.md` / `_r331b.md` / `_c331dir`。F2 改名 `_r331a.md → _z331a.md`（改名后按字母序换位）时复现一个缺陷：创建文件后立刻改名，目录监听在输入框打开期间刷新了树，输入框关闭时旧行已断开，焦点回退到正文 `.cm-content`；330 的补焦逻辑只认 `null` / `body` / 旧行，把正文当作「用户主动移走」而提前停止，焦点没跟到新行（稳定树况下则正常）。
- 修复后重跑：同样立即改名的路径下焦点落在 `_z331a.md` 行；再按 F2 初始值为新名字，Esc 取消后仍在该行；文件夹 `_c331dir → _z331dir` 改名后焦点同样跟随。
- 整页重载收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**发现并修复**：`src/features/workspace/WorkspaceSidebar.tsx` 的 F2 补焦逻辑在 `lost` 判定中补上「补焦开始的前几拍内焦点落在 `.cm-content`」视为可夺回（`tries < 5`），覆盖输入框关闭时树被外部刷新、焦点回退到正文的竞态；之后用户自己点进编辑器仍不抢。共 +4 行，只影响 F2 改名后的焦点落点。
**未发现其它缺陷**：326、327、328、329 均按第 326–329 轮描述工作，无代码改动。
**清理**：临时笔记 / 目录均已删除并刷新；`recentWorkspaces` 还原为仅 `[D:\clawWorkSpeace\新建文件夹]`；应用停在单标签 `CaseTest.md`、所见、侧栏「文件」、焦点正文、无弹层 / 提示；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp331.mjs`、`probe330.mjs`、`final-check331.mjs`、`rmtest*.mjs`、`cdp-probe*.mjs`、`win-dialogs.ps1` 已删除。
**检验计数**：0（下一轮 332 按正常需求轮）。

## 第 330 轮 · 2026-11-02 11:59
**用户需求**：场景：只用键盘整理文件树里的笔记（键盘用户在文件树里按 F2 改名）。现在的问题：改完名后焦点掉回页面（body），接着按 F2 / 方向键没有反应，再按 F2 改的是当前打开的正文笔记；按位置恢复也不可靠，改名后文件会按新名字重新排序。期望：改名完成后焦点落在改名后的那一行，继续按 F2 改的还是这一篇，方向键也能接着走。
**产品经理**：做。第 317、328 轮已经把弹层与列表的焦点交接补齐，F2 改名是文件树里真实剩下的断档——鼠标改名没问题，键盘改完就失焦；只补焦点落点，不改改名逻辑、文件排序、删除 / 移动与快捷键，不新增依赖，不碰「暂不做」。
**前端**：`workspace-actions.ts` 的 `renameEntry` 改为返回改名后的相对路径（取消 / 失败返回 `null`）；`WorkspaceSidebar.tsx` 的 F2 分支不再按旧下标找行，而是等树刷新后按新路径把焦点交回去。改名后目录监听可能再刷新一次树、行被短暂卸下重建，因此在约 1.5 秒内补焦，直到稳定；用户已把焦点移到别的行 / 控件就不再抢。风险：只影响 F2 成功后的焦点；菜单 / 右键「重命名」、鼠标改名、Delete 删除与取消路径不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/workspace/workspace-actions.ts`（+6/−3 行）、`src/features/workspace/WorkspaceSidebar.tsx`（+29/−12 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.93s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，当前 `CaseTest.md`；F2 / 回车 / Esc 为 CDP `Input.dispatchKeyEvent` 真实派发）**：
- 改前复现：在文件树聚焦 `_r330b.md` 按 F2、改名为 `_z330b.md` 回车；树刷新后 `document.activeElement` 为 `BODY`，焦点丢失。
- 改后文件改名：把 `_r330a.md` 改名为 `_z330a.md`（从第 3 行挪到第 4 行，旧下标处是 `_r330b.md`），焦点落在改名后的行（`data-path` 为新路径），而不是旧下标上的其它笔记；紧接着再按 F2，弹窗初始值就是刚改好的文件名；Esc 取消后焦点仍在该行。
- 改后文件夹改名：临时目录 `_c330dir` → `_z330dir` 后焦点同样落在改名后的目录行。
- 清理临时文件并整页重载后收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning；标签仅 `CaseTest.md`、所见、侧栏「文件」、无弹层与提示，焦点在正文 `.cm-content`。
**人工复现**：在文件树里用方向键选一篇笔记，按 F2 改名（改成按字母序会换位置的名字）回车；焦点应停在改名后的那一行，再按 F2 时输入框里应是新的文件名；用方向键还能继续在树里移动。改名后立即用鼠标点正文则焦点不再被抢回。
**清理**：临时笔记 `_r330a.md` / `_r330b.md` / `_z330a.md`、临时目录 `_z330dir`（原 `_c330dir`）及其中的文件均已删除；应用停在单标签 `CaseTest.md`、所见、侧栏「文件」、焦点正文；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp330err.mjs` 已删除。
**检验计数**：5（下一轮 331 做检验轮，回归 326–330）。

## 第 329 轮 · 2026-11-02 11:50
**用户需求**：场景：同时开过好几个笔记库，点标题栏库名想打开另一个新文件夹。现在的问题：有历史时点击库名只列出「切换到 …」，菜单里没有「打开文件夹」；想换到新目录只能记得 Ctrl+O 或去「文件」菜单。期望：最近工作区菜单末尾也有「打开其他文件夹…」，点它直接弹系统文件夹选择器。
**产品经理**：做。库名入口本来就同时承担「切换工作区」的职责，第 256 轮把入口合并后漏掉了「打开新目录」；只补一个菜单项，复用既有 `chooseWorkspace` 与同一菜单，不新增控件、依赖或数据变更，符合「安静、本地优先」，不碰「暂不做」。
**前端**：`src/app/TitleBar.tsx` 的最近工作区菜单在最近项之后追加一项「打开其他文件夹…」（带 title 提示 Ctrl+O），复用 `chooseWorkspace()`；同时把库名按钮的 title / aria-label 从「切换最近工作区」改为「切换或打开工作区」，与新能力一致。风险：菜单多 32px 高；该项无行尾 ×、不参与 Delete 移除；无历史时点击库名仍直接弹文件夹选择器；菜单键位、切换与移除逻辑不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/app/TitleBar.tsx`（+26/−17 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.20s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，活动文档 `CaseTest.md`；临时把 `D:\clawWorkSpeace\Feiye` 记为最近库，测试后已还原）**：
- 点击库名：菜单 2 行，依次为「切换到 Feiye」（带行尾 × 与 `aria-keyshortcuts="Delete"`）和「打开其他文件夹…」（无 ×、无 Delete 快捷键，`title="选择文件夹作为工作区（Ctrl+O）"`），首项自动聚焦。
- 键盘：按 ↓ 从首项移到「打开其他文件夹…」，停靠点跟随；按 Enter 后菜单关闭，Feiye 进程出现一个可见的 `#32770` 原生窗口「选择工作区文件夹」——说明走的是既有 `chooseWorkspace()` 系统选择器，而不是切到某个最近库。
- 原生选择器关闭后应用回到正文、无弹层残留；`recentWorkspaces` 已还原为 `["D:\\clawWorkSpeace\\新建文件夹"]`。
- 最后整页重载收集 `Runtime.exceptionThrown` / `Log.entryAdded`（error / warning）：0 条；标签仅 `CaseTest.md`、所见、侧栏「文件」、无弹层。
**人工复现**：打开过的最近库不止当前一个 → 点标题栏库名：菜单最后一项应是「打开其他文件夹…」；点它或键盘 ↓ 到底按 Enter，应弹出系统「选择工作区文件夹」对话框；取消后菜单已收起、当前库不变。最近列表每行仍可用 Delete / × 移除。
**清理**：临时最近库记录已还原；原生文件夹选择器已关闭（`visibleDialogs=0`）；未打开 / 修改任何笔记；应用停在单标签 `CaseTest.md`、所见、侧栏「文件」，焦点正文；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp329*.mjs` 已删除。
**检验计数**：4（下一轮 330 按正常需求轮）。

## 第 328 轮 · 2026-11-02 11:43
**用户需求**：场景：在文件树里对一篇笔记选「移动到…」，工作区里文件夹不少。现在的问题：目标文件夹列表里每一个文件夹都是独立的 Tab 停靠点，最多 200 个，从列表 Tab 到「取消」要一路按过去；键盘进列表后也只能靠 ↑↓，Tab 键反而会穿过整份清单。期望：这个列表只占一个 Tab 停靠点，↑↓ / Home / End 在列表里移动，Tab 一次就离开到「取消」。
**产品经理**：做。本窗口无障碍主线已把大纲、文件树、菜单栏、标签、工具栏、设置分类都收敛为一个停靠点，迁移对话框的文件夹列表是同类里最后一处漏网；只补焦点停靠点，不改移动逻辑、列表内容与弹层结构，不新增依赖，不碰「暂不做」。
**前端**：`src/features/workspace/MoveDialog.tsx` 新增 `stop` 状态，目标按钮按「最后聚焦 / 首项」渲染 roving `tabIndex`（整列只留一个 0），`onFocus` 同步；既有 ↑↓ / Home / End 只移焦点、回车才移动，Esc 与关闭后焦点归还触发行均不变。风险：只影响键盘 Tab 序与焦点样式，鼠标点击、读取失败跳过、空列表提示与移动动作不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/workspace/MoveDialog.tsx`（+15/−8 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.74s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，活动文档 `CaseTest.md`；右键菜单与列表项点击为真实派发）**：
- 从文件树 `CaseTest.md` 的右键菜单点「移动到…」打开对话框，目标为「子目录 / 空文件夹」两条：初始只有首项「子目录」`tabIndex=0`，第二项为 -1，焦点落在首项（改前两条都是 0）。
- 列表内派发 ArrowDown：焦点与停靠点一起移到「空文件夹」（`[-1, 0]`），列表仍只有 1 个可 Tab 项；End 停在末项不变。
- 对话框内可 Tab 元素为「一个目标项 + 取消」，从列表一次 Tab 即可离开到取消；Esc 关闭后焦点回到正文 `.cm-content`，弹层归 0。
- 整页重载收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning；标签仍仅 `CaseTest.md`，未移动或修改任何笔记。
**人工复现**：右键文件树里的 Markdown 文件 →「移动到…」；按 Tab 进入文件夹列表后，再按一次 Tab 应直接离开列表到「取消」，而不是逐个跳过文件夹；↑↓ / Home / End 在列表内移动焦点，回车仍把文件移到选中的文件夹。空文件夹列表与「正在读取文件夹…」提示保持原样。
**清理**：对话框已 Esc 关闭，焦点回正文；工作区文件未改动（未执行移动）；标签仅 `CaseTest.md`、所见、侧栏「文件」；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp328.mjs`、`cdp328err.mjs` 已删除。
**检验计数**：3（下一轮 329 按正常需求轮）。


## 第 327 轮 · 2026-11-02 11:53
**用户需求**：场景：只用键盘操作时，屏幕右下角弹出一条带动作的提示（例如刚按 Delete 移除最近工作区后的「点击撤销」）。现在的问题：用 Tab 把焦点移到提示上、正准备按回车，提示却按 3 秒计时自动消失，焦点随之掉回页面开头，撤销也来不及。期望：焦点停在提示上时先别让它消失，焦点离开后再照常计时。
**产品经理**：做。本窗口「无障碍补漏」的最后一块：提示的鼠标悬停已会暂停计时，键盘焦点却没有同等保护；只补焦点暂停与恢复，不改提示样式、3 条上限、动作与读屏播报，不新增依赖，不碰「暂不做」。
**前端**：`src/components/Toast.tsx` 的提示按钮补 `onFocus` / `onBlur`，复用既有的 `pauseToast` / `resumeToast`，焦点进入时清掉该条的计时器、离开后重新按类型计时。风险：只影响正在获得焦点的提示，鼠标悬停、点击执行 / 关闭、自动消失与 3 条上限均不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/components/Toast.tsx`（+6 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.21s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，当前 `CaseTest.md`；提示经 Vite dev 的 `/src/stores/ui.ts` 置入）**：
- 置入一条带动作的 info 提示并把焦点交给提示按钮：4 秒后提示仍在、`document.activeElement` 仍是该 `BUTTON`（改前 3 秒即移除、焦点回 body）。
- 让焦点离开提示：约 3.4 秒后自动消失，容器仍常驻、子节点 0。
- 对照组：无焦点的普通提示在 3.4 秒后消失，自动关闭逻辑不变。
- 鼠标悬停路径：派发 `mouseover` 后 3.6 秒提示仍在，仍在暂停；`mouseout` 后恢复计时的既有行为未受影响。
- 全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**人工复现**：触发一条带动作的提示（如从标题栏「最近工作区」按 Delete 移除一条记录），立即用 Tab 把焦点移到右下角提示上并停住：提示不应在 3 秒后消失，焦点也不应掉回页面；按 Shift+Tab 或点到别处离开提示后，它应再按正常时长自动关闭。普通无焦点提示仍照常自动消失。
**清理**：提示已全部关闭（`.toast` 0 条），焦点回正文 `.cm-content`；标签仅 `CaseTest.md`、所见、侧栏「文件」，未打开或修改笔记；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp327.mjs` 已删除。
**检验计数**：2（下一轮 328 按正常需求轮）。

## 第 326 轮 · 2026-11-02 11:37
**用户需求**：场景：只用键盘整理标题栏「最近工作区」里的旧库。现在的问题：每行右边的 × 键盘够不到——Tab 会直接关闭菜单，↑↓ 只在主按钮间移动，只有鼠标能点；想清掉几条记录就得去拿鼠标。期望：在某一行上按 Delete 就能移除这条记录（与点 × 一样），焦点留在菜单里相邻的一项；删到最后一条时菜单收起、焦点回到库名按钮。
**产品经理**：做。第 164 轮加入行尾 × 时明确留了「键盘上下仍只在主按钮间移动」；同一能力鼠标可用、键盘不可用，是本窗口无障碍补漏里真实剩下的一处。只补键位与焦点交接，不改菜单结构、移除逻辑与撤销提示，不新增依赖，不碰「暂不做」。
**前端**：`src/components/Menu.tsx` 在菜单的 `onKeyDown` 里识别当前行与 Delete（仅对带 `onRemove` 的行动作，普通右键菜单无变化），触发同一 `onRemove`；`onFocusCapture` 记住当前行，`actions.length` 变化后若焦点已掉出菜单就落回原位置或最后一行；带移除动作的菜单项补 `aria-keyshortcuts="Delete"`，悬停提示追加「按 Delete 移除」。风险：只影响带行尾 × 的菜单（当前仅「最近工作区」）；方向键、Home/End、Tab 关闭菜单、主按钮切换与鼠标点 × 均不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/components/Menu.tsx`（+46/−1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.30s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，活动文档 `CaseTest.md`；经 Vite 动态导入临时把 `Feiye` 与 `clawWorkSpeace` 记入最近工作区，按键用 CDP `Input.dispatchKeyEvent` 真实派发）**：
- 改前基线：菜单列出 2 条，首项自动聚焦；↓ 到第二项后按 Delete，`recentWorkspaces` 不变、菜单仍是 2 行、无提示——键盘移不掉。
- 改后：两个菜单项均带 `aria-keyshortcuts="Delete"` 与「… · 按 Delete 移除」提示；↓ 到「切换到 Feiye」按 Delete，设置变为 `[clawWorkSpeace, 新建文件夹]`、菜单剩 1 行且保持展开、提示「已从最近工作区移除：Feiye · 点击撤销」，焦点落在剩下的「切换到 clawWorkSpeace」。
- 再按 Delete 删最后一条：设置只剩当前库 `[新建文件夹]`、菜单收起、焦点回到标题栏库名按钮（`.workspace-switch`，文本「新建文件夹」），提示第二条正确。
- 鼠标路径无回归：重新种子后点第一行的 ×，该行消失、菜单保持展开、焦点落到相邻「切换到 Feiye」，与其既有行为一致。
- 整页重载收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning；标签仍仅 `CaseTest.md`，无多余弹层。
**人工复现**：打开过两个及以上库后，点标题栏库名打开「最近工作区」；用 ↓ 选到某一项按 Delete：该条应从列表消失并提示已移除（与点行尾 × 相同），焦点停在相邻项；继续删除到最后一条时菜单收起、焦点回到库名按钮。普通右键菜单（文件树 / 标签）里按 Delete 行为不变。
**清理**：`recentWorkspaces` 已还原为 `[D:\clawWorkSpeace\新建文件夹]`；菜单与提示均已关闭，标签仅 `CaseTest.md`、所见、侧栏「文件」；未修改笔记内容；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp326.mjs`、`cdp326-check.mjs` 已删除。
**检验计数**：1（下一轮 327 按正常需求轮）。

## 第 325 轮 · 2026-11-02 11:31（检验轮）
**回归范围**：第 320–324 轮（切回文档还原阅读位置、更新弹窗纳入弹层互斥、Toast 只播报新增提示、搜索改词期间不误开旧结果、菜单命令计入最近使用）。
**构建**：`bun run build` 通过（含 tsc，vite 1.50s，仅既有的 chunk 体积与动态导入提示）；本轮未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，当前 `CaseTest.md`；快捷键用 CDP `Input.dispatchKeyEvent` 真实派发）**：
- 320：`长文档.md` 所见模式下把光标放到文首，编辑区滚到 400px 后切到 `CaseTest.md` 再切回，视口仍为 400px（等待 1.5s 不变），可见正文行距顶部 336 → 336px；搜索「第 25 节」点命中后到第 234 行、视口 7923px，未被旧阅读位置覆盖。
- 321：更新弹窗置 `available / 9.9.9` 后按 `Ctrl+,` / `Ctrl+Shift+P` / `Ctrl+Alt+H`，设置 / 命令面板 / 历史均未打开、`.modal` 始终 1 个且焦点留在其中；设置开着时调用 `presentUpdateWhenQuiet` 不弹，关闭设置后补弹 `9.9.9` 并把焦点收进弹窗，Esc 关闭后归 0。
- 322：`.toast-host` 为 `role=status` / `aria-live=polite` / `aria-atomic=false`，空时 0×0；连发两条只产生两次 `childList` 新增（各自只带当次文案），无字符节点改写；点掉第一条第二条留存，全部关闭后容器仍在、0×0。
- 323：`写作` 返回 9 条、首条 `README.md:8`；改成 `a` 的「搜索中…」期间按回车，文档仍是 `CaseTest.md`，输入框 `aria-controls` / `aria-activedescendant` 为空；点击旧列表首条同样不切换；结果返回 32 条、首条 `CaseTest.md:2` 后回车跳到第 2 行并聚焦正文。
- 324：从「应用」菜单执行「偏好设置…」后，命令面板顶部出现「最近使用」且首条为「偏好设置…」；再在面板执行「保存」，顺序变为「保存 / 偏好设置…」无重复；清空后回到无「最近使用」。
- 整页重载收集 `Runtime.exceptionThrown` / `Log.entryAdded`：0 error / warning。
**观察（未改代码）**：分栏模式下，程序化把编辑器滚到 500px（此时预览侧尚未同步）后切走再切回，预览恢复自身位置并经滚动同步把编辑器再推到约 705px，可见正文行上移约 205px；所见模式不受影响。真实滚轮滚动时两侧同步，预期一致，留待下一轮按真实操作复核后再决定是否收紧切回时的同步顺序。
**结论**：五条改动均按预期工作，未发现需要立即修复的回归；无源码改动。检验计数清零，下一轮 326 按正常需求轮。
**清理**：标签仅 `CaseTest.md`、所见、侧栏「文件」；命令面板最近使用已清空，更新弹窗与设置 / 搜索均已关闭，笔记内容未改。

## 第 324 轮 · 2026-11-02 11:23
**用户需求**：场景：平时用标题栏菜单（文件 / 视图 / 应用）执行保存、导出、设置等动作。现在的问题：命令面板空查询的「最近使用」只记录在面板里执行过的命令，从菜单执行的动作从来不出现在里面，面板里的常用项和真实使用习惯对不上。期望：无论从菜单还是命令面板执行，都计入最近使用；面板里本来就不显示的命令不必占位。
**产品经理**：做。这是第 305 轮「最近使用」落地后的真实粗糙处——记录只挂在面板的 `run` 上；只补记录入口，不新增控件与依赖，不改命令分组、快捷键与搜索，只影响空查询时的排序，契合「安静」，不碰「暂不做」。
**前端**：`src/features/commands/commands.ts` 抽出 `rememberCommand(command)`（去重、最多 8 条，`palette === false` 的命令不记录），`CommandPalette.tsx` 与 `AppMenu.tsx` 在执行处统一调用。风险：仅空查询排序；菜单里的「命令面板」自身不再占位；搜索、执行与快捷键路径不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/commands/commands.ts`（+17 行）、`src/features/commands/CommandPalette.tsx`（+2/−10 行）、`src/app/AppMenu.tsx`（+3 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.50s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，当前 `CaseTest.md`）**：
- 改前基线：从「应用」菜单点「偏好设置…」并关闭设置后，打开命令面板仍是纯分组（无「最近使用」），首项「新建笔记」。
- 改后同一路径：打开面板首段为「最近使用」，首项「偏好设置…」。
- 再在面板里执行「保存」并重开：最近使用依次为「保存」「偏好设置…」，无重复，其余分组与条目完整。
- 只在菜单里出现、面板里不显示的命令「命令面板」执行后，不会进入最近使用。
- 整页重载后顺序仍为「保存」「偏好设置…」，说明随偏好持久化。
- 全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**人工复现**：清空最近使用（或新装）→ 从顶部菜单执行「偏好设置…」→ 关闭设置 → `Ctrl+Shift+P` 打开命令面板：顶部应出现「最近使用」，第一条是「偏好设置…」；再用面板执行「保存」，重开面板应把它提到第一条；重启后仍保留。菜单里的「命令面板」本身不应出现在最近使用里。
**清理**：`recentCommands` 已清空并落盘；未改动笔记内容；侧栏回到「文件」、标签仅 `CaseTest.md`，与开工时一致；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp324*.mjs` 已删除。
**检验计数**：5（下一轮 325 做检验轮，回归 320–324）。

## 第 323 轮 · 2026-11-02 11:14
**用户需求**：场景：在侧栏搜索里改了关键词，等结果刷新。现在的问题：新结果还没回来的一小段时间里，列表仍是上一次关键词的命中，此时按回车会打开上一个关键词的第一条，容易误开另一篇笔记。期望：新结果返回前，↑↓ / 回车与点击不作用于旧列表。
**产品经理**：做。搜索结果的正确性属于核心编辑流，误开别的笔记比慢半拍更糟；只收紧查询中的输入，不改搜索算法、界面与快捷键，不新增依赖，不碰「暂不做」。
**前端**：`src/features/workspace/SearchPanel.tsx` 在 `loading`（去抖中 / 查询中）时让 `openHit` 与 `onKeyDown` 直接返回，并暂时移除输入框的 `aria-controls` / `aria-activedescendant`，避免读屏把焦点描述成旧结果；结果返回后恢复原行为。风险：仅影响约 200ms 的过渡窗口，空查询、正常结果、鼠标点击与键盘选择路径不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/workspace/SearchPanel.tsx`（+14/−3 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.13s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，活动文档 `CaseTest.md`）**：
- 改前基线：搜索 `写作` 返回 9 条、首条 `README.md:8`；改成 `a` 后 60ms 内按回车，文档被切到 `README.md`——打开的是上一次查询的首条，而 `a` 的首条是 `CaseTest.md:2`。
- 改后同一路径：查询期间状态为「搜索中…」、列表仍显示旧的 9 条；选中项保持第 0 条（按 ↓ 不移动）；在输入框按回车后文档仍是 `CaseTest.md`、焦点仍在搜索框；点击旧列表首条也不切换文档。
- 查询期间输入框的 `aria-controls` / `aria-activedescendant` 为空；结果返回后恢复为 `workspace-search-results` / `workspace-search-hit-0`。
- 正常路径不变：`a` 返回 32 条后在搜索框按回车，光标跳到 `CaseTest.md:2` 并聚焦正文；`写作` 返回 9 条后回车打开 `README.md`；鼠标点击、↑↓ 选择与高亮正常。
- 全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**人工复现**：在侧栏「搜索」里输入一个能出结果的关键词，等结果出现；把关键词改成另一个，在结果数量还没更新（仍显示「搜索中…」）时立刻按回车或点第一条：不应打开上一篇笔记；等「N 条结果」出现后再按回车，才按新关键词的首条打开。
**清理**：搜索词已清空、侧栏回到「文件」、关闭测试打开的 `README.md` 标签，仅留 `CaseTest.md`；测试工作区文件已核对为 188 字节、内容未改；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp323*.mjs` 已删除。
**检验计数**：4（下一轮 324 按正常需求轮）。

## 第 322 轮 · 2026-11-02 11:07
**用户需求**：场景：屏幕上已经挂着一条提示（例如「导出失败」），紧接着另一篇笔记的操作又弹出一条。现在的问题：Toast 容器用 `role="status"`，该角色隐含 `aria-atomic="true"`，新增提示时读屏会把仍在显示的前几条整段重念一遍，最新那条反而被淹没。期望：只念新增的那条，旧提示不重复。
**产品经理**：做。本窗口「无障碍」候选的收尾——第 315 轮把播报容器改为常驻，但漏了原子性；不改视觉、计时、3 条上限与点击行为，不新增依赖，契合「安静」，不碰「暂不做」。
**前端**：`src/components/Toast.tsx` 给常驻容器补 `aria-atomic="false"` 并注释原因；保留 `role="status"` / `aria-live="polite"`。风险：只影响读屏播报粒度，DOM 结构与视觉无变化。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/components/Toast.tsx`（+8/−1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.25s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- 初始容器：`.toast-host` 1 个，`role=status`、`aria-live=polite`、`aria-atomic=false`、子节点 0、0×0。
- 连续两条提示（「第一条：保存失败」→「第二条：导出失败」）：MutationObserver 只记录到容器上两次 `childList` 新增，各自只带当次的新文本；旧提示没有字符节点改写（`added` 分别为各自文案、无 `characterData` 记录），即读屏只需播报新增节点。
- 视觉与既有行为不变：两条时有 2 个子节点（127×80），点第一条只关掉它、第二条留存；再连加 4 条只保留最后 3 条；逐条点击后容器仍在、子节点归 0。
- Chrome 无障碍树（`Accessibility.getPartialAXTree`）：容器为 `status`，`live=polite`、`atomic=false`、`relevant="additions text"`；临时移除该属性后 `atomic` 变为 `true`（改前基线），补回后恢复 `false`。
- 全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**人工复现**：连着触发两条 Toast（例如两次失败操作），读屏应只念新增的那条，不再重念仍显示的第一条；DOM 中容器应为 `<div class="toast-host" role="status" aria-live="polite" aria-atomic="false">`。
**清理**：测试提示已逐条关闭（容器子节点 0）；未打开 / 修改笔记，无标签、偏好与工作区改动；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp322.mjs`、`cdp322b.mjs` 已删除。
**检验计数**：3（下一轮 323 按正常需求轮）。

## 第 321 轮 · 2026-11-02 11:04
**用户需求**：场景：应用启动几秒后自动发现新版本，更新弹窗正开着；或正在设置 / 命令面板里调整。现在的问题：更新弹窗开着时按 `Ctrl+,` / `Ctrl+Shift+P` / `Ctrl+Alt+H` 还能把设置、命令面板、历史叠上来，Esc 该关谁、焦点在哪一层都说不清；反过来，设置或命令面板开着时静默检查发现了新版本，更新弹窗会直接盖在它们上面。期望：同一时间只出现一个弹层——更新弹窗开着时全局弹层快捷键不生效；别的弹层开着时更新先等待，等它关掉再出现。
**产品经理**：做。本窗口「更新功能收尾」的最后一块：更新弹窗此前不在第 241 轮建立的弹层互斥里。只收敛弹层叠加，不改检查 / 下载 / 跳过流程，不新增控件与依赖，不碰「暂不做」。
**前端**：`src/app/App.tsx` 的 `dialogOpen()` 纳入更新弹窗，`Ctrl+,` / `Ctrl+Shift+P` / `Ctrl+Alt+H` 的守卫补上 `updateOpen`（更新弹窗开着时不再叠设置 / 命令面板 / 历史，其它应用快捷键也一并让位）；`src/features/updates/update-service.ts` 新增 `presentUpdateWhenQuiet`：发现新版本时若有设置 / 命令面板 / 历史 / 确认框开着，先记下待显示的更新，订阅 ui store，等所有弹层关闭后补弹；等待期间被顶掉则不弹。风险：只在「发现更新且有弹层」时多一条等待路径，键盘守卫仅新增更新弹窗条件；检查节流、下载、跳过、关于页均不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/app/App.tsx`（+10/−7 行）、`src/features/updates/update-service.ts`（+44/−9 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.38s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`；更新弹层经 Vite dev 的 store 置入，键盘用 CDP `Input.dispatchKeyEvent` 真实派发）**：
- 更新弹窗置 `available / 9.9.9`：`.modal` 1 个，焦点在 `.modal`。
- 更新弹窗开着时按 `Ctrl+,` / `Ctrl+Shift+P` / `Ctrl+Alt+H`：`settingsOpen` / `paletteOpen` / `historyOpen` 均保持 false，`.modal` 仍为 1，焦点仍在 `.modal`——三个弹层都没有叠上来。
- 设置开着时调用 `presentUpdateWhenQuiet({version:'9.9.9'})`：设置仍开、更新 `open=false`、只有设置这 1 个 `.modal`；关闭设置后更新弹窗补弹（`available / 9.9.9`，焦点 `.modal`）。
- 命令面板开着时同样：面板开着时不弹，关闭后补弹。
- 补弹后按 Esc：弹层归 0、更新 store 复位、焦点回到正文 `.cm-content`。
- 全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**人工复现**：触发更新弹窗（关于页「检查更新」或等自动弹窗）后按 `Ctrl+,` / `Ctrl+Shift+P` / `Ctrl+Alt+H`：不应再出现设置 / 命令面板 / 历史，更新弹窗仍是唯一一层；反过来，先开着设置或命令面板，等启动约 4 秒的静默检查（有可用新版本时）：更新弹窗应先等待，关掉设置 / 面板后再出现。
**清理**：更新 store 复位 `open:false / phase:idle`；设置、命令面板、历史均关闭，焦点回到正文；未打开 / 修改笔记，无标签、偏好与工作区改动；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp321*.mjs` 已删除。
**检验计数**：2（下一轮 322 按正常需求轮）。

## 第 320 轮 · 2026-11-02 10:59
**用户需求**：场景：在长文档里读到中段，切到另一篇查点资料，再切回来接着读。现在的问题：切回来的视口又被拉回光标附近（读到的 800px 处变回 126px），只能重新往下滚找刚才的位置。期望：每篇笔记记住切走前读到哪里，切回来停在原处；从搜索结果打开时仍以命中的那一行为准。
**产品经理**：做。属于本窗口「编辑手感」候选里尚未覆盖的阅读位置记忆——光标与撤销历史已按文档缓存，唯独视口位置不属于 EditorState；只补一处按文档的记忆，不新增控件、不改标签与打开流程，契合「安静」，不碰「暂不做」。
**前端**：`src/features/editor/editor-bridge.ts` 新增 `scrollCache`，`cacheCurrentState` 切走时与 EditorState 一起记录 `scrollDOM.scrollTop`，缓存淘汰 / 关闭标签 / 切库时同步清理；`restoreEditorScroll(cacheKey)` 在 `setState` 测量完成后的下一帧还原，避免被「滚到光标」覆盖，并用当前文档 key 守卫快速连切。`src/features/workspace/workspace-actions.ts` 在 `restoreCursorFor` 之后调用它；带 `anchor`（搜索命中）的打开不还原，保持跳到命中行。风险：仅在切回缓存文档的打开路径追加一次滚动；新打开、外部重载、关闭再打开、搜索跳转行为不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/editor/editor-bridge.ts`（+28 行）、`src/features/workspace/workspace-actions.ts`（+4 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.34s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`；真实点击文件树 / 标签 / 搜索）**：
- 改前基线：`长文档.md` 滚到 800px，切到 `写作示例.md` 再切回，视口为 126px（分栏下 500px → 77px）——被光标恢复拉回。
- 改后（所见）：同一路径切回仍为 800px；`写作示例.md` 切回也停在它各自记录的位置，两篇互不串用。
- 改后（分栏）：滚到 500px，切走再切回仍为 500px，预览侧随标题锚点同步，无抖动。
- 搜索锚点对照：在 `写作示例.md` 时用侧栏搜索「第 25 节」并点 `长文档.md` 的命中，切到 `长文档.md`、视口 960px，当前行为「第 25 节的代码块占位」——未被旧阅读位置 800 覆盖。
- 全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**人工复现**：打开 `长文档.md`（或任一长笔记），滚到中段；点另一个标签再切回：应停在刚才读到的位置，而不是光标附近。切到「源码 / 分栏 / 所见」重复均成立；从全文搜索点一条命中应跳到命中行而不是旧位置。关闭标签会清掉这篇的阅读位置记录，重新打开仍按既有「记住光标」逻辑定位。
**清理**：视图还原「所见」、侧栏还原「文件」、搜索词已清空、标签回到单篇 `CaseTest.md`；未修改笔记内容，无偏好与工作区改动；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp320*.mjs` 已删除。
**检验计数**：1（下一轮 321 按正常需求轮）。

## 第 319 轮 · 2026-11-02 10:51（检验轮）
**回归范围**：第 314–318 轮（大纲跳转顶部留白、Toast 播报区域常驻、更新弹窗关闭焦点归位、下载期间焦点留在弹窗内、跳过版本后恢复提醒）。
**构建**：`bun run build` 通过（含 tsc，vite 1.04s，仅既有的 chunk 体积与动态导入提示）；本轮未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，当前 `CaseTest.md`；更新弹窗经 Vite dev 的 `/src/stores/updates.ts` 置入状态，Tab / Esc 用 CDP `Input.dispatchKeyEvent` 真实派发）**：
- 314：打开 `README.md` 切分栏、侧栏「大纲」，点「目录结构」后预览标题距顶部 24px（`scrollTop=860`），大纲高亮仍在该标题；点首标题「扉页测试库」距顶部 24px、高亮首条；纯预览模式同一标题距顶部 23.7px（`scrollTop=457`）、高亮正确。
- 315：无提示时 `.toast-host` 恒为 1 个、`role=status` / `aria-live=polite`、子节点 0、0×0，空容器所在点 `elementFromPoint` 不落在提示层；首条提示出现前后容器节点未重建（同一节点）、文案正确且为 127×36；连续 4 条保留 3 条，类型依次 info / error / success；逐条关闭后容器仍在、子节点 0、回到 0×0。
- 316：焦点在正文时打开弹窗 → 焦点在 `.modal`；点「稍后」后弹层 0、焦点回到同一 `.cm-content`；焦点在工具栏「加粗」时按 Esc → 弹层 0、焦点回到该按钮（`title=加粗 (Ctrl+B)`）；从 body 模拟自动弹窗，关闭后焦点落到 `.cm-content`。
- 317：聚焦「下载并安装」后置 `downloading` → 焦点收回 `.modal`，两按钮禁用；Tab / Shift+Tab 均留在弹窗内；置 `ready` 后 Tab 依次到「稍后」「重启以完成更新」；关闭后弹层 0。
- 318：真实点「跳过此版本」→ 弹层 0，`skippedUpdateVersion` 写为 `9.9.9`，Toast「已跳过 v9.9.9，可在「设置 → 关于」恢复提醒」；打开设置 →「关于」出现「已跳过 v9.9.9 的自动提醒」与「恢复提醒」（`tabIndex=0`）；点恢复后该行消失、记录清为 `""`、Toast「已恢复自动检查更新」，关于页只剩「检查更新」；关闭设置后弹层 0、焦点回正文。
- 全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**结论**：5 条改动均符合预期，未发现功能缺陷，无源码改动。
**清理**：更新 store 归 `open:false / phase:idle`，跳过记录已清空；视图还原「所见」、侧栏还原「文件」、标签回到单篇 `CaseTest.md`，无弹层与提示；临时 CDP 脚本 `cdp319probe.mjs`、`cdp319a.mjs`、`cdp319b.mjs`、`cdp319c.mjs` 已删除。
**检验计数**：清零（下一轮 320 按正常需求轮）。

## 第 318 轮 · 2026-11-02 10:48
**用户需求**：场景：我在更新弹窗里手滑点了「跳过此版本」。现在的问题：这个版本再也不会自动提醒，设置里也找不到任何撤销入口，只能等下次手动「检查更新」才发现。期望：关于页能看到当前跳过的是哪个版本，并一键恢复自动提醒。
**产品经理**：做。属于本窗口「更新功能收尾」候选——第 309 轮给了跳过能力，却没给反悔出口；补在「设置 → 关于」（已有「检查更新」）最自然，不新增依赖、不改自动检查逻辑，不碰「暂不做」。
**前端**：`update-service.ts` 新增 `getSkippedUpdateVersion` / `restoreUpdateReminders`（读 / 清 `skippedUpdateVersion`），跳过成功提示补一句「可在设置 → 关于恢复提醒」；`SettingsDialog.tsx` 的关于页打开时读取跳过记录，有记录时显示「已跳过 vX 的自动提醒」+「恢复提醒」按钮；`settings.css` 补布局。风险：仅多一个条件区块与两个读 / 清设置函数，自动检查、手动检查与更新弹窗流程不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/updates/update-service.ts`（+14/−1 行）、`src/features/settings/SettingsDialog.tsx`（+24/−1 行）、`src/features/settings/settings.css`（+9 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.33s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`；用 Vite dev 的 store 置入更新弹层状态并真实点击）**：
- 无跳过记录：打开设置 → 关于，无 `.settings-about-skipped`，只有「检查更新」按钮。
- 置 `open:true / available / 9.9.9` 后真实点「跳过此版本」：弹层关闭，Toast 文案为「已跳过 v9.9.9，可在「设置 → 关于」恢复提醒」，`skippedUpdateVersion` 写为 `9.9.9`。
- 再打开设置 → 关于：出现「已跳过 v9.9.9 的自动提醒」与「恢复提醒」按钮，按钮 `tabIndex=0`；该行在「检查更新」上方 50px，无重叠。
- 点击「恢复提醒」：该行消失，Toast「已恢复自动检查更新」，`skippedUpdateVersion` 清为 `""`，关于页只剩「检查更新」。
- 关闭设置后弹层 0、焦点回正文；全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**人工复现**：更新弹窗里点「跳过此版本」→ 打开 `Ctrl+,` →「关于」，应看到「已跳过 vX 的自动提醒」与「恢复提醒」；点按钮后提示「已恢复自动检查更新」，该行消失。再次打开关于页确认行不再出现。
**清理**：`skippedUpdateVersion` 置空、`settingsCategory` 还原「外观排版」、更新 store 归 `open:false / phase:idle`，Toast 已消失；未打开 / 修改笔记，无标签与工作区改动；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp318*.mjs` 已删除。
**检验计数**：5（下一轮 319 做检验轮，回归 314–318）。

## 第 317 轮 · 2026-11-02 10:45
**用户需求**：场景：在更新弹窗里用键盘 Tab 到「下载并安装」按回车。现在的问题：按钮立刻变成禁用的「下载中…」，焦点被浏览器丢回 body——按 Tab 会跑到弹窗后面的标题栏 / 侧栏，读屏也不再报当前在更新弹窗里，只能干等下载结束。期望：下载期间焦点留在弹窗内，Tab 不会跑到下面的界面；下载完成后能 Tab 到「重启以完成更新」。
**产品经理**：做。属于本窗口无障碍候选的收尾（更新弹窗的焦点管理），与第 316 轮关闭后焦点归位是同一处缺口的两端；只改焦点落点与 Tab 循环，不新增控件、不改下载流程，符合「安静、键盘可达」，不碰「暂不做」。
**前端**：`src/features/updates/UpdateDialog.tsx` 在进入 `downloading` 时把焦点收回弹窗容器；`src/components/Dialog.tsx` 的 `trapTab` 在框内暂无可聚焦元素（下载中按钮全禁用）时 `preventDefault` 按住焦点，避免 Tab 逃出弹层。风险：共享的 `trapTab` 仅在「一个可聚焦元素都没有」时行为变化，确认框 / 设置等仍有按钮的弹层不受影响；Esc 与遮罩关闭在下载中仍被禁止。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/updates/UpdateDialog.tsx`（+6 行）、`src/components/Dialog.tsx`（+6/−1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.29s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`；用 Vite dev 的 `/src/stores/updates.ts` 置入弹层状态，真实派发 Tab / Shift+Tab）**：
- 改前基线：聚焦主按钮「下载并安装」后把阶段切到 `downloading`，`document.activeElement` 为 `BODY`、不在弹窗内——下一次 Tab 会从窗口最开头重走。
- 改后 A（开始下载）：焦点落到 `DIV.modal`（`inDialog=true`），弹层仍为 1 个。
- 改后 B（下载中 Tab / Shift+Tab）：焦点都停在 `DIV.modal`，没有跑到弹层后面的界面；下载中按钮保持禁用。
- 改后 C（切到 `ready`）：焦点仍在弹窗内；第一次 Tab 到「稍后」，第二次 Tab 到「重启以完成更新」。
- 改后 D（对照，`available` 阶段）：焦点在弹窗容器时按 Tab 进入「跳过此版本」，共享 `trapTab` 的正常首尾循环未回归。
- 关闭弹层后焦点回到正文 `.cm-content`（沿用第 316 轮）；全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**人工复现**：触发更新弹窗（关于页「检查更新」或等自动弹窗），Tab 到「下载并安装」按回车开始下载：焦点应留在弹窗内，反复按 Tab / Shift+Tab 不应跳到后面的标题栏或侧栏；下载完成后 Tab 应依次到「稍后」「重启以完成更新」。Esc 与点遮罩在下载中仍不应关闭弹层。
**清理**：更新 store 已复位 `open:false / phase:idle`，焦点回到正文；未打开 / 修改笔记，无标签、偏好与工作区改动；临时 CDP 脚本 `/tmp/cdp317a.mjs`、`/tmp/cdp317b.mjs` 已删除。
**检验计数**：4（下一轮 318 按正常需求轮）。

## 第 316 轮 · 2026-11-02 10:44
**用户需求**：场景：新版本弹窗弹出时，我正用键盘写作，于是顺手按 Esc 或点「稍后」把它关掉。现在的问题：焦点直接掉到窗口最开头（body），下一次 Tab 要从标题栏依次穿过标签、视图、工具栏才能回到刚才的位置；读屏也失去上下文。期望：关掉更新弹窗后，焦点回到弹窗前所在的那个控件或正文，Tab 接着往下走。
**产品经理**：做。属于本窗口无障碍候选的最后一块拼图（弹层焦点管理），与第 284 / 287 / 302 轮修的焦点回位一致；不改下载、跳过与稍后流程，不新增控件与依赖，不碰「暂不做」。
**前端**：`src/features/updates/UpdateDialog.tsx` 把「打开即聚焦弹窗」的 effect 改为同时记录打开前的 `document.activeElement`，关闭（稍后 / Esc / 跳过此版本 / 点遮罩）时若原控件仍在就还原焦点；自动弹窗或原控件已被移除（如从关于页触发、设置先关掉）时回到正文 `.cm-content`。风险：只影响弹层关闭后的焦点落点；`trapTab`、下载中禁止关闭、进度播报均不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/updates/UpdateDialog.tsx`（+15/−1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.08s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`；用 Vite dev 的 `/src/stores/updates.ts` 置入弹层状态，避免依赖真实新版本）**：
- 改前基线：焦点在正文 `.cm-content`，置 `open:true / available / 9.9.9` 后焦点为 `.modal`；关闭后 `document.activeElement` 为 `BODY`、不在编辑器内——Tab 会从窗口最开头重走。
- 改后 A（正文 → 点「稍后」）：打开时焦点在 `.modal`，点「稍后」后弹层归 0、焦点回到同一 `.cm-content`（`inEditor=true`）。
- 改后 B（工具栏「加粗」→ Esc）：打开时焦点在 `.modal`，Esc 后弹层归 0、焦点回到 `button.tool-btn`，`title` 仍为「加粗 (Ctrl+B)」。
- 改后 C（模拟启动自动弹窗，先 `blur` 到 body）：关闭后焦点回落到正文 `.cm-content`，不是 body。
- 改后 D（正文 → 点「跳过此版本」）：弹层关闭、Toast「已跳过 v9.9.9，不再自动提醒」出现，焦点仍回到正文。
- 弹层 Tab 环未回归：焦点在 `.modal` 时按 Tab 落到「跳过此版本」按钮；全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**人工复现**：把焦点放到工具栏「加粗」，用命令面板或关于页触发更新弹窗（或等自动弹窗），按 Esc：焦点应回到「加粗」，再按 Tab 接着到下一个按钮；焦点在正文时点「稍后 / 跳过此版本」：焦点应回到正文原光标处，可直接继续输入。
**清理**：更新 store 已复位 `open:false / phase:idle`；跳过记录已清空；未打开 / 修改笔记，无标签、偏好与工作区改动；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp316.mjs`、`cdp316b.mjs` 已删除。
**检验计数**：3（下一轮 317 按正常需求轮）。

## 第 315 轮 · 2026-11-02 10:41
**用户需求**：场景：用读屏软件写笔记，保存失败、标签到上限、跳过更新版本时都会有右下角提示。现在的问题：应用刚启动、或上一条提示消失一段时间后再出现新提示时，读屏一声不吭——只有一直有提示在屏上时才偶尔念；提示本身是 `role=status`，可这个区域是随第一条提示才挂到页面上的，区域和文字同时出现，读屏不会播报。期望：每条新提示都能被读屏念出来，提示的外观、停留时间与点击行为都不变。
**产品经理**：做。补全本窗口无障碍候选里「Toast 用 aria-live 播报」的缺口——保留既有 `role=status` / `aria-live=polite`，只修正 live region 的生命周期；不改视觉、不改提示数量与时长、不加依赖，不碰「暂不做」。
**前端**：`src/components/Toast.tsx` 去掉「无提示就 `return null`」，让 `.toast-host`（`role=status` / `aria-live=polite`）从应用启动起常驻，新提示只往已存在的区域里追加文字；空容器无子节点时宽高为 0，不占布局。风险：空容器常驻需确认不拦截鼠标点击；提示最多 3 条、计时器、悬停暂停、点击执行动作与错误 / 成功配色均沿用 store 现有逻辑。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/components/Toast.tsx`（+3/−2 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.39s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`；通过 Vite dev 的 `/src/stores/ui.ts` 驱动提示）**：
- 改前（按代码）：初始 `toasts` 为空时 `ToastHost` 返回 `null`，页面上没有 live region，第一条提示与 `role=status` 容器同一帧插入。
- 改后初始：没有任何提示时 `.toast-host` 仍为 1 个，`role=status` / `aria-live=polite`、子节点 0，`getBoundingClientRect()` 为 0×0；对空容器所在点做 `elementFromPoint` 命中的是下方编辑器 `.cm-scroller`，不拦截点击。
- 改后首条：记录容器节点引用后调用 `toast('第 315 轮测试提示')`，容器节点未重建（`sameNode=true`）、区域仍为 1 个、其中 1 条提示、文案正确且可见；提示出现后容器为 127×36，位置仍在右下。
- 连续再发 3 条：屏上保持 3 条（第二条 / 第三条 / 第四条），类型分别为 `toast info` / `toast error` / `toast success`，容器节点不变。
- 点击第一条：只关闭该条（剩「第三条 / 第四条」），容器仍在；逐条关闭并等自动消失后，`.toast-host` 仍为 1 个、子节点 0、0×0，供下一次播报使用。
- 全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**说明**：CDP 无法直接断言读屏是否发声，本轮验证的是「live region 在提示文字出现之前就已存在、后续文字追加在同一节点内」这一读屏播报前提；实际朗读留人工复现。
**人工复现**：打开 NVDA（Windows）或 VoiceOver（macOS），冷启动应用后不做任何操作、等待上一条提示完全消失，再触发一条提示（如命令面板执行「切换侧栏」或在空状态按保存）：应能听到提示文字；连续触发多条应各念一次，最多同时 3 条；提示仍在右下角出现、3 秒（错误 6 秒）后消失，点击行为不变。
**清理**：测试提示已全部关闭，UI store `toasts` 为空；未打开 / 修改笔记，无标签、偏好与工作区改动；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp315.mjs`、`cdp315b.mjs` 已删除。
**检验计数**：2（下一轮 316 按正常需求轮）。

## 第 314 轮 · 2026-11-02 10:35
**用户需求**：场景：长文里用侧栏大纲跳到「目录结构」这一节。现在的问题：预览区把标题滚到离顶部只有约 10px，标题几乎贴着边缘，和编辑器里 24px 的留白不一致，读了半天才找到上一段的边界。期望：跳转后标题与顶部留出一样的呼吸距离，大纲高亮仍落在刚点的标题上。
**产品经理**：做。属于本窗口「编辑手感」候选；只调整预览跳转的上边距，不新增控件、不改跳转方式，契合「安静」，不碰「暂不做」。
**前端**：`src/features/preview/preview-scroll.ts` 提取 `HEADING_TOP_MARGIN = 24`，`scrollPreviewToHeading` 用它留白；`previewActiveHeadingIndex` 用同一阈值判断当前标题，避免跳转后高亮退回上一个标题。风险：只影响预览内的滚动目标与大纲高亮阈值（12 → 24px），编辑器的 24px 上边距、滚动同步与阅读位置恢复不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/preview/preview-scroll.ts`（+6/−2 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.11s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，当前 `README.md`；真实点开侧栏「大纲」并点击条目）**：
- 改前：点击第 3 个标题「目录结构」后 `scrollTop=471`，该标题距预览区顶部 10px，大纲高亮在它。
- 改后预览：同一标题距顶部 23.7px（约 24px），`previewActiveHeadingIndex=2`，大纲高亮「目录结构」；点第一个标题「扉页测试库」时文档已到顶部，标题距顶部 24px、高亮首条。
- 改后分栏：点同一标题后预览标题距顶部 24px，编辑器对应行距滚动区顶部 18.3px（沿用原 24px 上边距），大纲高亮「目录结构」。
- 点最后一个标题时文档已滚到底、无法再留 24px（标题距顶部 113.9px），高亮回落到上一标题——与改前一致，属既有边界，本轮未改。
- 全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**人工复现**：切到「预览」或「分栏」，侧栏打开「大纲」，点中段任意标题：标题应停在离顶部约 24px 处，而不是贴边；大纲中该标题保持高亮。文档顶部的首标题仍贴齐正常留白，末标题受文档长度限制无法留白。
**清理**：视图还原「所见」，侧栏还原「文件」；未打开 / 修改笔记，无标签、偏好与工作区改动；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp314*.mjs` 已删除。
**检验计数**：1（下一轮 315 按正常需求轮）。

## 第 313 轮 · 2026-11-02 10:32（检验轮）
**回归范围**：第 308–312 轮（静默检查每天一次、跳过此版本、发布说明链接可点、下载失败重试、预览链接焦点描边）。
**构建**：`bun run build` 通过（含 tsc，vite 1.06s，仅既有的 chunk 体积与动态导入提示）；修复后再次构建通过（1.04s）；本轮未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`；标签 `CaseTest.md` / `写作示例.md` / `README.md`，当前 `README.md`）**：
- 308：重载后启动静默检查把 `lastSilentUpdateCheck` 写成 `2026-11-02`；同会话再次调用静默检查阶段保持 `idle`、标记不变（模块内 gate 生效）；手动检查走 `checking → idle` 并弹「已是最新版本」；把标记改为 `2000-01-01` 再重载，又写回当天，跨天恢复有效。
- 309：置 `available/9.9.9`，三按钮为「跳过此版本 / 稍后 / 下载并安装」；点击跳过写入 `skippedUpdateVersion=9.9.9`、弹「已跳过 v9.9.9，不再自动提醒」、弹层关闭且 store 复位 `open:false / phase:idle / version:null`；「跳过此版本」只在 `available` 出现（`downloading` / `ready` 均无）。自动检查命中已跳过版本的分支因无真实新版本未直接触发，按代码路径核对（`silent` 且版本一致 → 复位 idle、不弹窗）；手动检查不受限。
- 310（发现缺陷并修复）：两条链接均渲染为 `.update-note-link`（强调色 + 下划线），Tab 顺序为 链接 1 → 链接 2 → 跳过 → 稍后 → 下载并安装 → 回绕，键盘描边均为 2px 强调色。**缺陷**：链接后跟中文句末标点（如 `https://example.com/docs。`）时，`。` 被 `URL_PATTERN` 吞进锚文本与 `href`，点击会带着标点打开；此前只处理了 ASCII 句点。修复：`UpdateDialog.tsx` 的 `URL_PATTERN` 排除常用中日韩 / 全角标点（`，。、；：！？…` 及 `【】「」『』《》` 等），保留原有的全角括号与 ASCII 句末处理。修复后重载实测 `…/docs`、`…/a`、`…/b` 的锚文本与 `href` 均不含 `。，！`，标点仍留在正文；全角括号 `（URL）.` 照旧在链接外；无报错。
- 311：`available + error` 时主按钮为「重试下载」、未禁用，错误行 `role=alert`、文案「下载失败：network error」、危险色 `rgb(166, 61, 52)`；切 `downloading/5%` 后错误与 `role=alert` 消失、主按钮「下载中…」禁用、`aria-valuenow=5`、状态区「正在下载更新…」；`ready` 时按钮「重启以完成更新」、进度 100、播报完成；清掉 error 恢复「下载并安装」且跳过项仍在。
- 312：切「预览」后 README 有 8 条链接；真实 Tab 落在正文第一条链接「写作示例」，`:focus-visible` 命中，`outline: solid 2px rgb(47, 85, 97)`、`outline-offset: 1px`，不再是浏览器默认细黑框。
- 全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**结论**：308、309、311、312 回归通过；310 发现并当场修复中文标点被并入链接的问题（1 行）。检验计数清零，下一轮 314 按正常需求轮。
**清理**：`useUpdateStore` 已复位 `open:false / phase:idle`；`skippedUpdateVersion` 置空，`lastSilentUpdateCheck` 保留当天（符合正常节流）；视图还原「所见」，标签与笔记内容未改；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp313.mjs`、`cdp313fix.mjs`、`cdp313.out.json` 已删除。

## 第 312 轮 · 2026-11-02 10:30
**用户需求**：场景：只用「预览」读笔记，用 Tab 在正文里的笔记 / 外部链接之间走。现在的问题：焦点圈是浏览器默认的 1px 黑框，深色主题下几乎看不见，和旁边按钮统一的 2px 靛青描边完全不是一套。期望：预览里的链接也用同一套强调色描边，键盘走到哪里一眼能看见。
**产品经理**：做。属于本窗口无障碍候选「统一 `:focus-visible`」；只补全全局焦点样式，不新增控件、不引入依赖，不碰「暂不做」。
**前端**：`src/styles/global.css` 的全局焦点规则加入 `a:focus-visible`（与 button / input / select / textarea / [tabindex] 共用 2px 强调色、1px 偏移）；预览正文链接、Markdown 里的笔记链接因此不再落到浏览器默认描边。风险：仅影响链接的键盘焦点外观，鼠标点击与链接跳转不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/styles/global.css`（+1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.14s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`；预览视图，README 内链接）**：
- 改前：真实 Tab 到预览里的「写作示例」链接，计算样式 `outline: auto 1px rgb(16, 16, 16)`——浏览器默认黑框。
- 改后重载，真实键盘 Tab 依次经过标签 / 视图 / 工具栏后落在同一链接，`outline: solid 2px rgb(47, 85, 97)`（即 `--accent` 浅色靛青）、`outline-offset: 1px`，与此前按钮的焦点圈一致。
- 把 `data-theme` 临时切到 `dark`（不改偏好）：同一链接描边变为 `rgb(143, 180, 188)`（`#8fb4bc`，深色强调色），深色底上清晰可见；随后还原 `light` 与 2px 靛青。
- 重载与按键全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**人工复现**：切到「预览」，用 Tab 走进正文链接：应看到 2px 强调色描边（浅色靛青 / 深色浅蓝），而不是浏览器默认细黑框；换主题后描边颜色随强调色变化，点击链接仍正常打开笔记 / 外部浏览器。
**清理**：视图已还原「所见」、侧栏还原「文件」、主题 `light`；未打开 / 修改笔记，无标签、偏好与工作区改动；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\` 之外的 `/tmp/cdp*.mjs` 已删除。
**检验计数**：5（下一轮 313 做检验轮，回归 308–312）。

## 第 311 轮 · 2026-11-02 10:24
**用户需求**：场景：更新下到一半断网，弹窗停在原地。现在的问题：只多出一行英文错误，主按钮仍是「下载并安装」，分不清是在重新下载还是重来一次；读屏也不会主动报失败。期望：明确告诉我下载失败，主按钮变成「重试下载」，失败原因用中文起头，读屏能立即听到。
**产品经理**：做。本窗口更新收尾里最后一项「下载失败可重试」；不改下载流程、不新增控件，只把已有的失败态说清楚，符合「安静」与「数据安全」，不碰「暂不做」。
**前端**：`src/features/updates/UpdateDialog.tsx` 新增 `failed = !busy && !ready && error !== null`，失败态主按钮显示「重试下载」（仍走既有 `downloadAndInstallUpdate`，`pending` 保留、点击即重新开始下载并清空错误）；错误行补 `role="alert"` 并在原文前加「下载失败：」。风险：只影响 available + error 的文案与播报，正常下载 / 跳过 / 稍后 / ready 路径不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/updates/UpdateDialog.tsx`（+11/−2 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.07s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`；用 Vite dev 的 `/src/stores/updates.ts` 驱动弹层状态）**：
- 置 `open:true / phase:available / version:9.9.9 / error:"network error"`：1 个 `role=dialog`，按钮依次「跳过此版本 / 稍后 / 重试下载」，主按钮未禁用；错误行 `role=alert`、文本「下载失败：network error」、危险色 `rgb(166,61,52)` 且实际可见；读到屏的进度状态区为空。
- 模拟重试开始（`phase:downloading / progress:0.05 / error:null`）：主按钮变为「下载中…」且禁用，错误行与 `role=alert` 消失，进度条 `aria-valuenow=5`，状态区播「正在下载更新…」。
- 真实 Tab 键从弹窗容器出发：跳过此版本 → 稍后 → 重试下载 → 回绕到跳过此版本，三键均有两像素描边（`outline-style: solid`）。
- 清掉 error（正常 available）：主按钮恢复「下载并安装」，无 `role=alert`，「跳过此版本」仍在。
- 关闭后弹层归 0；全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**人工复现**：断网后点「下载并安装」触发真实失败：弹窗应出现红字「下载失败：…」并由读屏立即播报；主按钮变为「重试下载」。恢复网络后点它应重新开始下载，出现进度条与「下载中…」，错误行消失；「跳过此版本 / 稍后」仍可用。正常网络下首次按钮仍是「下载并安装」。
**清理**：更新 store 已复位 `open:false / phase:idle`；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp311.mjs` 已删除；未打开 / 修改笔记，无标签、偏好与工作区改动。
**检验计数**：4（下一轮 312 按正常需求轮）。

## 第 310 轮 · 2026-11-02 10:22
**用户需求**：场景：更新弹窗里写着「修复了崩溃，详见 https://github.com/…/issues/42」。现在的问题：发布说明被压成纯文本，链接看得见却点不动，想读细节只能自己选中、复制、再去浏览器粘贴。期望：说明里的链接可以直接点，交给系统浏览器打开，弹窗本身不跳走。
**产品经理**：做。契合「本地优先、安静」——不引入 Markdown 渲染管线、不新增依赖，只把已有的说明文字里的 http(s) 链接变成可点链接；不新增控件、不改下载与重启流程，不碰「暂不做」。
**前端**：`src/features/updates/update-service.ts` 的 `summarizeNotes` 先把 Markdown 行内链接压成「文字（URL）」，其余行照旧保留 ≤8 行；`src/features/updates/UpdateDialog.tsx` 新增 `NoteText`，按 http(s) 切分说明并把 URL 渲染成 `<a>`，点击 `preventDefault` 后交 `plugin-opener` 的系统浏览器打开，句末标点留在链接外；`src/app/App.css` 补链接的强调色 / 下划线与 `:focus-visible` 描边。风险：只影响发布说明的呈现；无链接时保持纯文本，弹层 Tab 顺序把链接排在按钮前（共用 `trapTab` 的 `a[href]`）。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/updates/update-service.ts`（+4/−1 行）、`src/features/updates/UpdateDialog.tsx`（+44/−2 行）、`src/app/App.css`（+11 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.13s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`；当前没有真实待更新版本，且 `__TAURI_INTERNALS__.invoke` 不可写、无法桩掉 IPC，因此用 Vite dev 的 `/src/stores/updates.ts` 直接置入弹层状态，notes 采用 `summarizeNotes` 处理后的形态）**：
- 置 `open:true / phase:available / version:9.9.9`，notes 为「· 修复了崩溃，详见 #42（https://example.com/issues/42）」+「· 详情 https://example.com/notes.」：出现 1 个 `role=dialog`，标题「发现新版本 v9.9.9」，说明文字原样保留换行（`white-space: pre-line`），生成 2 个 `.update-note-link`。
- 两个链接 `href` 分别为 `https://example.com/issues/42`、`https://example.com/notes`（句末 `.` 未被吞进 URL），`text` 与 href 一致；计算样式为强调色 `rgb(47, 85, 97)` + `underline`。
- 焦点在 `.modal` 时按 Tab：第一个链接（`outline: solid 2px` 强调色）→ 第二个链接 → 「跳过此版本」按钮，说明链接进入了弹层原有的 Tab 环，且键盘聚焦有可见描边。
- 把 notes 换成无 URL 的「· 修复了崩溃 / · 没有链接的说明」：链接数为 0、文字完整；关闭后弹层归 0。
- `summarizeNotes` 的两种 Markdown 写法另在 Bun 里按同一表达式核对：`[#42](https://…)` → `#42（https://…）`、`[发布说明](https://…)` → `发布说明（https://…）`、裸链接原样保留、`#` 标题行跳过，与置入弹层的文本一致。
- 全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**人工复现**：发布一个带链接的 GitHub Release（例如正文写 `- 修复 [#42](https://github.com/…)`），启动应用或手动「检查更新」→ 弹窗说明里应显示「修复 #42（https://…）」，其中 URL 为强调色下划线；用键盘 Tab 可聚焦并看到描边；点击后应交给系统默认浏览器打开，弹窗仍留在应用内；句子末尾的句号不应变蓝或进入 URL。
**清理**：更新 store 已复位 `open:false / phase:idle`，临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp310.mjs` 已删除；未打开 / 修改笔记，无标签、偏好、工作区与设置改动。
**检验计数**：3（下一轮 311 按正常需求轮）。

## 第 309 轮 · 2026-11-02 10:18
**用户需求**：场景：一个版本在 GitHub 上挂了几天还没升，我每天开合几次扉页。现在的问题：每次自动检查到同一个新版本都会弹窗，昨天已经点过「稍后」也一样，只能反复关掉。期望：弹窗里给一个「跳过此版本」，点过之后自动检查不再为它弹窗；我主动点「检查更新」时仍能看到并安装；等发布更新的版本时再提醒。
**产品经理**：做。契合「安静」——只是记住一个被跳过的版本号，不新增常驻控件、不改下载与重启流程；手动检查保持完全可见，不扩大产品边界，不碰「暂不做」。
**前端**：`src/features/updates/update-service.ts` 新增 `SKIPPED_VERSION_KEY = "skippedUpdateVersion"`；`checkForUpdates` 拿到更新后，若为静默检查且版本号与记录一致就复位为 `idle`、不弹窗（手动检查不受此限制）；新增 `skipUpdateVersion()`，写入版本号、弹 info Toast 并复用 `dismissUpdate()` 关闭弹层。`src/features/updates/UpdateDialog.tsx` 仅在 `phase === "available"` 时显示「跳过此版本」按钮（下载中 / 已就绪不出现），顺序为 跳过此版本 / 稍后 / 下载并安装。风险：只影响检测到新版本后的静默弹窗；下载失败回到 available 时仍可重试或跳过；设置写入失败照常关闭弹层。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/updates/update-service.ts`（+25 行）、`src/features/updates/UpdateDialog.tsx`（+12 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.05s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`；用 Vite dev 的 `/src/stores/updates.ts` 驱动弹层状态，避免依赖真实新版本）**：
- 初始无弹层；置 `phase=available, version=9.9.9` 后出现 1 个 `role=dialog`，标题「发现新版本 v9.9.9」，按钮依次「跳过此版本 / 稍后 / 下载并安装」，焦点在 `.modal`。
- 点击「跳过此版本」：弹层关闭（0 个），Toast「已跳过 v9.9.9，不再自动提醒」，设置 `skippedUpdateVersion` 读回 `"9.9.9"`，store 复位 `open:false / phase:idle`。
- `phase=downloading` 与 `phase=ready` 时按钮只剩「稍后 / 下载中…」「稍后 / 重启以完成更新」，不出现跳过项；回到 `available` 又出现。
- 全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**人工复现**：已发布更新的版本时启动（或命令面板手动检查）→ 弹窗点「跳过此版本」→ 应看到「已跳过 vX，不再自动提醒」并关窗；之后自动检查不再为同一版本弹窗；手动「检查更新」仍应弹出该版本；发布更高的版本后自动检查应重新提醒。
**清理**：`skippedUpdateVersion` 已置空，更新 store 复位为 `open:false / phase:idle`（无弹层）；未打开 / 修改笔记，无标签、偏好与工作区改动；临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp309.mjs` 已删除。
**检验计数**：2（下一轮 310 按正常需求轮）。


## 第 308 轮 · 2026-11-02 10:16
**用户需求**：场景：一天里因为查资料反复打开、关掉扉页好几次。现在的问题：每次启动 4 秒后都会静默联网检查更新，刚查过也一样，弱网下还得多等一次。期望：自动静默检查每天最多一次，同一天重开应用不再联网；手动「检查更新」不受限制，随时可查。
**产品经理**：做。契合「安静」与「本地优先」——减少无谓联网，不新增可见控件、不改手动检查与更新对话框；标记只落在本机设置里，不扩产品边界，不碰「暂不做」。
**前端**：`src/features/updates/update-service.ts` 新增本地日期标记 `lastSilentUpdateCheck` 与模块内一次性 gate：静默检查先读标记，等于今天就直接返回；否则先把今天写进标记再发请求（弱网失败也不在同一天反复重试），跨天自然恢复；读设置失败时照常检查。手动检查（`silent: false`）完全绕过节流。`src/app/App.tsx` 只更新一行注释。风险：仅影响启动后的自动检查频率；手动检查、更新弹窗与下载流程不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/updates/update-service.ts`（+29/−0 行）、`src/app/App.tsx`（+1/−1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.33s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- 清空标记后整页重载：等待约 6.5 秒，设置 `lastSilentUpdateCheck` 变为 `2026-11-02`，说明当天第一次启动确实跑了静默检查；无弹层、页面 `readyState=complete`。
- 同一会话内再调用一次 `checkForUpdates({ silent: true })`：`useUpdateStore` 订阅记录到 0 次阶段变化（没有进入 `checking`），标记仍为今天——被节流。
- 紧接着调用 `checkForUpdates({ silent: false })`：阶段依次 `checking → idle`，弹出「已是最新版本」Toast——手动检查不受影响。
- 跨天：把标记改为 `2000-01-01` 后整页重载，等待约 6.5 秒，标记重新写为 `2026-11-02`——日期变化后自动检查恢复。
- 全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**人工复现**：同一天内启动扉页两次（中间不跨零点）：第一次启动约 4 秒后应联网检查一次（设置里 `lastSilentUpdateCheck` 为当天日期），第二次启动不再发请求；命令面板 / 关于页点「检查更新」仍应立即检查并给出「已是最新版本」或新版本提示。把系统日期改到第二天再启动，应恢复一次自动检查。
**清理**：标记已置空（下一次真实冷启动仍会检查一次）；临时 CDP 脚本 `cdp308.mjs` 已删除；未打开 / 修改笔记，无标签、偏好与工作区改动。
**检验计数**：1（下一轮 309 按正常需求轮）。

## 第 307 轮 · 2026-11-02 10:15（检验轮）
**回归范围**：第 302–306 轮（关于页检查更新、标签上限提示、跨库文件树停靠点、命令面板最近使用、更新下载进度播报）。
**构建**：`bun run build` 通过（含 tsc，vite 1.29s，仅既有的 chunk 体积与动态导入提示）；本轮未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹` + 临时库 `D:\clawWorkSpeace\_c307lib`，所见模式，标签 `CaseTest.md` / `写作示例.md` / `README.md`，当前 `README.md`）**：
- 302：`Ctrl+,` →「关于」只有一个分类停靠点（关于），按钮文案「检查更新」、`title="检查是否有新版本"`、`margin-top: 22px` 且可见；点击后设置立即关闭（`role=dialog` 1 → 0），真实检查返回「已是最新版本」Toast，焦点回到正文 `.cm-content`。
- 303：从 3 个标签起依次打开 10 篇临时笔记；第 12 个标签（`_c307i.md`）时无提示，第 13 个（`_c307j.md`）后标签仍为 12，最早打开的 `CaseTest.md` 被移除并弹「已关闭最久未用的标签「CaseTest.md」（最多同时打开 12 个）」。
- 304：主库聚焦 `长文档.md`（当前笔记 `_c307j.md`）后停靠点为该项；切到临时库首次回落 `aaa.md`，聚焦 `bbb.md` 后停靠点跟随；切回主库停靠点回到 `长文档.md`、标签原样恢复；再切临时库停靠点回到 `bbb.md`，最后切回主库仍为 `长文档.md`。
- 305：清空最近命令后打开面板为 6 个原分组、43 条、首项「新建笔记」；执行「保存」后重开出现「最近使用」且首项「保存」，总数仍 43；再执行「显示 / 隐藏侧栏」后顺序变为「显示 / 隐藏侧栏」「保存」；整页重载后仍保留；输入「视图」只剩原「视图」分组 4 条、无「最近使用」，清空恢复。
- 306：更新弹层内 `.sr-only[role=status][aria-live=polite]` 为 1×1px 绝对定位，进度条 `aria-label=更新下载进度`；3%→9% 同档推进 6 次，状态区文本变化 0 次（视觉到 9）；跨档 12 / 19 / 24 / 30 / 55 / 99% 依次播报 10 / 10 / 20 / 30 / 50 / 90%，完成播「更新已下载，可以重启以完成更新」，进度条 `aria-valuenow` 同步；关闭后无弹层。
- 全程 `Runtime.exceptionThrown` / `Log.entryAdded` 无 error / warning。
**结论**：未发现功能缺陷，无源码改动；检验计数清零，下一轮 308 按正常需求轮。
**清理**：临时笔记 `_c307a.md`–`_c307j.md`、临时库 `_c307lib` 与全部临时 CDP 脚本已删除；标签恢复 `CaseTest.md` / `写作示例.md` / `README.md`（当前 `README.md`）、所见模式、侧栏可见、停放点 `README.md`；`recentCommands` 清空，`settingsCategory` 还原「外观排版」，`tabsByWorkspace` / `lastDocumentByWorkspace` / `recentDocuments` / `recentWorkspaces` 中无本轮临时路径；未修改笔记内容，无历史快照与恢复副本新增。

## 第 306 轮 · 2026-11-02 10:08
**用户需求**：场景：用读屏软件操作「检查更新 → 下载并安装」。现在的问题：下载时只有一条视觉进度条，读屏全程不播报；若直接给进度条挂 `aria-live`，每收到一块数据就念一次百分比，吵得没法听。期望：读屏能知道正在下载、大致进度和下载完成，但不要每个数据块都念。
**产品经理**：做。本窗口无障碍候选里「Toast 的 aria-live」已具备（`role=status` + `aria-live=polite`），剩下更新下载进度没有播报；只补读屏文案、不改视觉进度条与下载流程，不加依赖，不碰「暂不做」。
**前端**：`src/features/updates/UpdateDialog.tsx` 在进度条旁新增常驻的 `.sr-only` 状态区（`role=status` / `aria-live=polite`）：下载中按 10% 一档播报「正在下载更新，已完成 N%」，起手未到 10% 只播「正在下载更新…」，完成后播「更新已下载，可以重启以完成更新」；进度条补 `aria-label`，视觉百分比仍逐块更新。`src/app/App.css` 新增通用 `.sr-only`（1px、绝对定位、overflow hidden）。风险：仅影响更新弹层的读屏文案；下载行为、ESC / 防关闭与按钮禁用不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/updates/UpdateDialog.tsx`（+16 行）、`src/app/App.css`（+13 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.22s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`；用 Vite dev 的 `/src/stores/updates.ts` 直接驱动弹层状态，避免依赖真实新版本）**：
- 打开 `phase=downloading, progress=0.03`：出现 1 个 `role=dialog`，焦点在 `.modal`；`.sr-only` 为 `role=status` / `aria-live=polite`，计算样式 `position:absolute`、1×1px、`overflow:hidden`，文案「正在下载更新…」；进度条 `aria-label=更新下载进度`、`aria-valuenow=3`。
- 同档推进 3%→9%（6 次 `setState`）：`.sr-only` 的 `MutationObserver` 记录 0 次文本变化，视觉 `aria-valuenow` 已到 9——不会按数据块刷屏。
- 跨档推进 12% / 19% / 24% / 30% / 55% / 99%：文案依次停在「10%」「10%」「20%」「30%」「50%」「90%」，视觉 `aria-valuenow` 同步 12 / 19 / 24 / 30 / 55 / 99；切到 `phase=ready` 后文案变为「更新已下载，可以重启以完成更新」，进度 100。
- 关闭弹层后 `role=dialog` 与 Toast 均为 0；全程无 exception / console error，正文与标签未受影响。
**人工复现**：用读屏软件（NVDA / VoiceOver）在工作区触发一次有可用新版本的检查并点「下载并安装」：开始下载时应听到「正在下载更新…」，之后大致每 10% 报一次，完成时报「更新已下载，可以重启以完成更新」；中途不应连续念百分比。
**清理**：临时 CDP 脚本 `C:\Users\EDY\AppData\Local\Temp\cdp306.mjs` 已删除；`useUpdateStore` 状态已还原为 `open:false / phase:idle`，无标签、文档内容与偏好改动。
**检验计数**：5（下一轮 307 做检验轮，回归 302–306）。

## 第 305 轮 · 2026-11-02 09:35
**用户需求**：场景：每天写作时反复用命令面板里的同几个动作（保存、切侧栏、切视图）。现在的问题：每次 `Ctrl+Shift+P` 打开都是一份按菜单分组的固定顺序，常用动作混在四十多条里，要么往下翻要么先输几个字。期望：最近用过的命令排在面板最前面，不输入时一眼就能点；开始搜索时仍按原来的分组结果。
**产品经理**：做。命令面板是高频入口，把最近用过的动作提前只是重排已有项，不新增按钮、不改菜单与快捷键，也不扩大产品边界，不碰「暂不做」。
**前端**：`src/stores/settings.ts` 的偏好新增 `recentCommands`（最多 8 条、去重、随偏好持久化）；`src/features/commands/CommandPalette.tsx` 在空查询时把仍可用的最近命令（最多 5 条）单独放在「最近使用」一段，其余命令保持原来的菜单分组顺序，键盘 ↑↓ / 回车与鼠标索引都按合并后的列表计算；执行命令时把 id 提到最前。开始输入后完全恢复原分组结果。风险：只影响空查询下的命令顺序；搜索、快捷执行与命令可用性判断不变；重置偏好会一并清空。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/stores/settings.ts`（+12 行）、`src/features/commands/CommandPalette.tsx`（+53/−8 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.16s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，亮色、分栏、标签 `CaseTest.md` / `写作示例.md` / `README.md`，当前 `README.md`）**：
- 清空最近记录后打开面板：43 条命令，分组为「文件 / 段落 / 格式 / 视图 / 查找 / 应用」，首项「新建笔记」，无「最近使用」。
- 执行「保存」后重开：最上方出现「最近使用」，首项为「保存」（`aria-selected=true`），其余分组与顺序不变，总数仍 43（未重复）。
- 再执行「显示 / 隐藏侧栏」后重开：最近使用依次为「显示 / 隐藏侧栏」「保存」，首项高亮。
- 整页重载后重开：最近使用仍是这两条同序，说明随偏好持久化；搜索框输入「视图」后分组回到只剩「视图」，无「最近使用」段；清空搜索后恢复两段。
- 在最近使用首项按 Enter 执行「显示 / 隐藏侧栏」，面板关闭且侧栏重新显示（原为隐藏）；全程无 exception / error。
- 测后已清空 `recentCommands` 并重载确认面板恢复无「最近使用」；侧栏可见、标签与主文档未变，正文未被保存改写。
**人工复现**：打开命令面板执行一个命令（如「保存」）→ 再次打开：最上方应出现「最近使用」，刚执行的那条排第一；再执行一条，顺序应随之变化；重启应用后仍保留。输入关键词时，结果应回到原来的菜单分组。
**清理**：临时 CDP 脚本 `cdp305.mjs` / `cdp305b.mjs` 已删除；`recentCommands` 已清空；侧栏恢复显示，标签恢复 `CaseTest.md` / `写作示例.md` / `README.md`（当前 `README.md`）、亮色、分栏；未修改笔记内容，无历史快照与恢复副本新增。
**检验计数**：4（下一轮 306 按正常需求轮）。

## 第 304 轮 · 2026-11-02 09:19
**用户需求**：场景：同时开着主库和资料库，用标题栏「最近工作区」在两边来回切。现在的问题：文件树的 Tab 停靠点一换库就重算到新库的当前笔记，切回刚离开的库时也得重新用方向键找回刚才那一行。期望：每个库各自记住离开前聚焦的那一行，切回来还停在原地；没去过的库仍从当前笔记开始。
**产品经理**：做。这是第 292 / 294 轮检验时记下的观察项，属于既有键盘模型的收尾；只改焦点停靠点，不新增可见控件、不加依赖，也不扩大产品边界，不碰「暂不做」。
**前端**：`src/features/workspace/WorkspaceSidebar.tsx`：切库时侧栏会随 `hasWorkspace` 卸载，组件内 state 留不住，因此把「库根路径 → 最近聚焦行」放到模块级 `Map`；组件的 `treeStop` 初始值从 Map 读取，库根变化时用 effect 再同步一次，聚焦行与折叠兜底同时写回 Map。风险：首次进入某库仍回落到当前笔记 / 第一行；停靠行被折叠或删除仍按原逻辑落到第一行；只记会话内，不写入设置。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/workspace/WorkspaceSidebar.tsx`（+25/−13 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.37s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹` + 临时库 `_c304lib`，亮色、所见、窗口不在前台）**：
- 说明：窗口不在前台时，程序化 `focus()` 不会派发原生 focus 事件（`document.activeElement` 变了、`focus` / `focusin` 监听器不触发）；本轮用 `new FocusEvent("focusin", { bubbles: true })` 模拟真实聚焦来驱动 React 的 `onFocus`，行本身的真实 Tab / 方向键行为已在第 291 / 292 / 294 轮验证过。
- 主库：聚焦 `长文档.md` 后停靠点为该行、当前笔记仍是 `写作示例.md`（停靠点不被当前笔记覆盖）。
- 主库 → 临时库：首次进入（本会话未记过）停靠点回落当前笔记 `bbb.md`；聚焦 `aaa.md` 后停靠点为 `aaa.md`、当前笔记仍是 `bbb.md`。
- 临时库 → 主库：停靠点回到离开前的 `长文档.md`，当前笔记 `写作示例.md`，没有跟着当前笔记重算。
- 主库 → 临时库（第二次）：停靠点回到离开前的 `aaa.md`，当前笔记 `bbb.md`。
- 全程监听 `error` / `unhandledrejection`，无报错；切库、打开文档、标签切换均正常。
**人工复现**：准备两个库，各自打开一篇笔记 → 在主库文件树里用 Tab / 方向键把焦点移到另一行（不要打开它）→ 切到资料库 → 再切回主库：文件树的 Tab 停靠点应回到刚才那一行；在资料库也聚焦一行后同样往返一次，两边应各记各的。首次打开新库时仍应落在当前笔记 / 第一行。
**清理**：临时库 `_c304lib` 已删除，`recentWorkspaces` / `tabsByWorkspace` / `lastDocumentByWorkspace` / `recentDocuments` 中的相关条目已移除；主库标签恢复为 `CaseTest.md` / `写作示例.md` / `README.md`（当前 `README.md`），文件树停靠点回到 `README.md`；未修改笔记内容，无历史快照与恢复副本新增；临时 CDP 脚本与设置备份已删除。
**检验计数**：3（下一轮 305 按正常需求轮）。

## 第 303 轮 · 2026-11-02 08:43
**用户需求**：场景：写稿时同时开着很多篇笔记，标签栏最多 12 个。现在的问题：开第 13 篇时，最早打开的那篇标签自己消失了，没有任何提示，我以为是文件被删了，还得回头重新找。期望：超过上限时明确告诉我关掉了哪个标签（不是悄悄消失）。
**产品经理**：做。上限本身保持 12，不改「打开新笔记」的既有行为；只把已经发生的挤占说出来，属于「安静但透明」的反馈，不扩大产品边界、不加依赖、不碰「暂不做」。
**前端**：`src/stores/tabs.ts` 的 `addTab` 返回被挤掉的最旧标签（`MAX_TABS` 导出），`src/features/workspace/workspace-actions.ts` 的 `openFile` 在发生挤占时弹一条 info Toast；若剩余标签里还有同名文件，提示里补相对路径（如「子目录/README.md」），避免分不清是哪个「README」。风险：只影响到达 12 个标签后的那一次打开；恢复标签（≤12）不会触发提示，正常打开 / 关标签不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/stores/tabs.ts`（+16/−13 行）、`src/features/workspace/workspace-actions.ts`（+15/−2 行）。
**构建**：`bun run build` 通过（含 tsc，vite 0.99s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，亮色、分栏，测前标签 `README.md` / `写作示例.md`）**：
- 准备 13 篇可打开笔记（11 篇现有 + 临时 `_c303a.md` / `_c303b.md`），先关到只剩 `写作示例.md`，再按顺序点开其余笔记。
- 打开到第 12 个标签时没有提示；点开第 13 篇（根目录 `README.md`）后标签数仍为 12，最早打开的 `子目录/README.md` 被移除，Toast 文案为「已关闭最久未用的标签「子目录/README.md」（最多同时打开 12 个）」——因剩余标签里有同名 `README.md`，提示带上了目录。
- 另一轮把唯一前缀不同的 `写作示例.md` 挤掉时，提示为「已关闭最久未用的标签「写作示例.md」（最多同时打开 12 个）」，未带路径。
- 关闭额外标签回单标签 `写作示例.md` 期间监听 `Runtime.exceptionThrown` / `Log.entryAdded`，无报错；正文未改动，Toast 3 秒后自行消失。
**人工复现**：在工作区里准备至少 13 篇 Markdown → 依次打开到 12 个标签（应无提示）→ 再打开第 13 篇：最早打开的标签应被关闭，并弹出「已关闭最久未用的标签「…」（最多同时打开 12 个）」；若被关掉的篇目与仍开着的标签同名，提示应带上级目录路径。
**清理**：临时 `_c303a.md` / `_c303b.md` 已删除，文件树无残留；标签回到单标签 `写作示例.md`（分栏、亮色、侧栏「文件」），未修改笔记内容，无历史快照与恢复副本新增；临时 CDP 脚本已删除。
**检验计数**：2（下一轮 304 按正常需求轮）。

## 第 302 轮 · 2026-11-01 23:41
**用户需求**：场景：想确认自己是不是最新版，打开「设置 → 关于」。现在的问题：这里只显示版本号，没有「检查更新」入口，只能去命令面板里找「检查更新…」，大多数时候找不到。期望：关于页直接给一个「检查更新」按钮，点完要么提示已是最新，要么弹出新版本。
**产品经理**：做。手动检查更新是「关于」页的基本动作，复用已有的非静默检查路径（检查中防重入、已最新 / 失败有 Toast、发现新版本走更新对话框），不改视觉语言、不加依赖，不扩大产品边界，不碰「暂不做」。
**前端**：`src/features/settings/SettingsDialog.tsx` 的 `AboutPanel` 在版本信息后加「检查更新」按钮：点击先关设置（避免更新对话框与设置两个弹层叠加），再调用 `checkForUpdates({ silent: false })`，结果由既有逻辑提示；`src/features/settings/settings.css` 给按钮加 22px 上距。按钮天然进入 Tab 顺序，不改变 301 轮的分类单停靠点。风险：只影响关于页；启动静默检查、命令面板入口与更新对话框均不变。工作量 S。
**后端**：无（更新检查命令已存在，未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/settings/SettingsDialog.tsx`（+13/−0 行）、`src/features/settings/settings.css`（+4/−0 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.23s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，亮色、分栏、标签 `README.md` / `写作示例.md`）**：
- `Ctrl+,` 打开设置并切到「关于」：版本显示 0.0.4，新增按钮文案「检查更新」、`title="检查是否有新版本"`、`margin-top: 22px` 且实际可见。
- 点击按钮：设置立即关闭，`role="dialog"` 数量为 0（无叠加弹层），随后真实检查返回并弹出「已是最新版本」Toast；焦点回到正文 `.cm-content`，控制台无报错（无 exception / error）。
- 测后用 CDP 重新打开设置并把分类点回「外观排版」、Esc 关闭，分类持久化恢复；未修改笔记内容，无历史快照与恢复副本新增。
**人工复现**：打开设置（`Ctrl+,`）→「关于」→ 点「检查更新」：设置应关闭，稍候提示「已是最新版本」或弹出新版本对话框；断网时应提示「检查更新失败」。
**清理**：临时 CDP 脚本已删除；设置分类还原「外观排版」；测前已有的两个标签与文档内容未改动。
**检验计数**：1（下一轮 303 按正常需求轮）。

## 第 301 轮 · 2026-11-01 08:50
**用户需求**：场景：用键盘打开设置（`Ctrl+,`）后想直接进到右侧选项。现在的问题：左侧「外观排版 / 编辑行为 / 视图与预览 / 快捷键 / 关于」五个分类各占一个 Tab 停靠点，要连按五次才能到内容区，和侧栏标签（293）、工具栏（297）的键盘模型不一致。期望：分类只占一个停靠点（当前分类），←/→ 仍可逐项切换，再按 Tab 直接进入右侧内容。
**产品经理**：做。这是第 289–299 轮「一组控件一个停靠点 + 方向键」在设置弹层里的收尾；只改焦点顺序、不改视觉与分类行为，属于既有键盘可达性的补齐，不扩大产品边界，不碰「暂不做」。
**前端**：只改 `src/features/settings/SettingsDialog.tsx`（+2 行）：分类按钮按 `category === item.id` 渲染 roving `tabIndex`（当前分类为 0，其余 -1）；既有 ←/→ / Home / End 会先移动焦点再 `click()` 切换分类，切换后停靠点随之跟到新分类。关闭按钮、内容区控件与弹层 Tab 回绕不变。风险：只影响设置分类的 Tab 顺序。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/settings/SettingsDialog.tsx`（+2/−0 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.27s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，亮色、分栏、单标签 `写作示例.md`）**：
- `Ctrl+,` 打开设置：五个分类中只有当前「外观排版」`tabIndex=0`，其余四项均为 -1（共 1 个停靠点）。
- 聚焦「外观排版」按 Tab：焦点直接进入右侧内容的「浅色」主题按钮，不再逐个经过分类；Shift+Tab 回到「外观排版」。
- 按 →：切到「编辑行为」并聚焦，停靠点随之移到该项（整组仍只有 1 个 0），`aria-selected` 同步。
- Esc 关闭，弹层数量归 0，焦点回正文；控制台无报错（无 exception）。
- 测后已用 ← 把设置分类还原为「外观排版」。
**人工复现**：`Ctrl+,` 打开设置 → 从任意位置按 Tab 到左侧分类，应只停在当前分类一次，再按 Tab 直接进入右侧内容；←/→ / Home / End 仍能切换分类，切完停靠点跟着走。
**清理**：临时 CDP 脚本已删除；设置分类还原「外观排版」；测后为单标签 `写作示例.md`、分栏、亮色、侧栏「文件」，焦点在正文；未修改笔记内容。
**检验计数**：1（下一轮 302 按正常需求轮）。

## 第 300 轮 · 2026-11-01 08:50（检验轮）
**回归范围**：第 295–299 轮（分段控件 / 工具栏格式组 / 标签条 / 侧栏搜索焦点 / 预览代码块的单停靠点与方向键），抽检第 290–294 轮（大纲、文件树、菜单栏停靠点），并关联第 289 / 293 / 296 轮的键盘模型。
**构建**：`bun run build` 通过（含 tsc，vite 1.30s，仅既有的 chunk 体积与动态导入提示）；本轮未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，1100×760，亮色、分栏、单标签 `写作示例.md`、侧栏「文件」，共 3 个预览代码块）**：
- 295 分段控件：`.view-switch` 四个按钮只有「分栏」`tabIndex=0`；聚焦后 → 只把焦点与停靠点移到「预览」，`aria-pressed` 仍在「分栏」，← 回到「分栏」，视图未变。
- 297 工具栏：16 个格式按钮只有「加粗」为 0（其余 15 个 -1）；Tab 到「段落样式」下拉、Shift+Tab 回到「加粗」；→ 到「斜体」、End 到「插入图片」、末尾 → 回绕到「加粗」，整组始终只有 1 个 0，正文长度 407 未变。
- 296 标签条：单标签下主按钮与它的 × 各 1 个 0（共 2 个）；从主按钮 Tab 到 ×，再 Tab 直接离开标签条落到 `+`。
- 298 侧栏：聚焦「文件」按 End 切到「搜索」且焦点仍在「搜索」标签、搜索框未聚焦（三个标签只有搜索为 0）；Tab 才进输入框，Shift+Tab 回「搜索」；Home 回「文件」。
- 299 预览代码块：3 个 `pre` 的 `tabindex` 均为 -1，3 个「复制」按钮为 0；从第 1 个复制按 Tab 依次到第 2、第 3 个（`indexOf` 0 → 1 → 2，不经过 `pre`），Shift+Tab 回到上一个；第 2 个复制上 → 让本块 `scrollLeft` 0 → 119、← 回 0，未触发复制。
- 抽检 290 / 291 / 289：大纲 10 条只有当前标题「代码块」为 0 且 `aria-selected` 同步；文件树 13 行只有当前笔记 `写作示例.md` 为 0；菜单栏 6 项只有「文件」为 0。
- 设置主题（295 关联）：`Ctrl+,` 打开后「主题」「点缀色」两组各只有 1 个 0（浅色 / 靛青）；在「浅色」上 → 只把焦点与停靠点移到「深色」，`aria-pressed` 仍为浅色、`--bg` 仍 `#f5f5f1`；Esc 关闭，主题未变。
- 控制台无报错（`Runtime.enable` 期间无 exception / error）；测后回到单标签 `写作示例.md`、分栏、亮色、侧栏「文件」，焦点在正文。
**结论**：未发现功能缺陷，无源码改动；检验计数清零，下一轮 301 按正常需求轮。
**清理**：临时 CDP 脚本已删除；未修改笔记内容，无历史快照与恢复副本新增。

## 第 299 轮 · 2026-11-01 08:25
**用户需求**：场景：在分栏 / 预览里用键盘从正文一路 Tab 穿过一篇带多个代码块的笔记。现在的问题：每个代码块占两个停靠点——Shiki 给 `pre` 加了 `tabindex=0`，横向滚动区算一个，旁边的「复制」按钮又算一个，代码块一多就要按两倍次数。期望：每个代码块只停一次（落在「复制」上），仍能用 ←/→ 横向滚动代码。
**产品经理**：做。这是第 289–298 轮「一组控件一个停靠点」的收尾，预览代码块的唯一操作是复制，滚动区不应另占一格；把横向滚动挪到唯一停靠点的 ←/→ 上，能力和按键都不丢，不改视觉、不加界面，不扩大产品边界，不碰「暂不做」。
**前端**：只改 `features/preview/PreviewPane.tsx`（+20 行）：补复制按钮时把 `pre.tabIndex` 设为 -1（覆盖 Shiki 默认的 0），每个代码块只留复制按钮一个停靠点；委托的 `keydown` 在焦点位于 `.preview-code-copy` 且代码溢出时，用 ←/→ 滚动本块 `pre`（约 0.6 屏宽，最小 48px），不溢出时不拦截。所见即所得代码块本就是「语言框 + 复制」两个有意义控件，保持原样。风险：只影响预览代码块的 Tab 顺序与按钮上的方向键；Enter / 空格 / 鼠标点击复制、语言标签、Mermaid、增量替换均不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/preview/PreviewPane.tsx`（+20/−0 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.34s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，1100×760，亮色、分栏、单标签 `写作示例.md`，预览 3 个代码块）**：
- 改前基线：3 个 `pre` 的 `tabindex` 均为 `0`、「复制」按钮也均为 0，共 6 个停靠点；改后 3 个 `pre` 全部为 -1，只剩 3 个按钮为 0。
- 焦点在第 1 个「复制」按 Tab：直接落到第 2 个「复制」（不再经过 `pre`）；在第 2 个按 Shift+Tab 回到第 1 个。
- 焦点在第 2 个「复制」时按 →：该块 `scrollLeft` 从 0 到 119；按 ← 回到 0；未触发复制，其它代码块不受影响。
- 键盘激活：Enter（rawKeyDown + char）与空格均让按钮变为「已复制」、`aria-label` 变「已复制代码」，约 1.5 秒后恢复「复制」；鼠标点击同一按钮同样复制并短暂反馈。
- 控制台无报错；测后焦点回正文，仍为单标签 `写作示例.md`、分栏、亮色、侧栏「文件」。
**人工复现**：打开一篇含 2 个以上代码块的笔记，切到分栏 / 预览 → 从正文按 Tab 进入预览：每个代码块只停一次（停在「复制」上），再按 Tab 直接到下一个代码块；在「复制」上按 ←/→ 应横向滚动本块代码，Enter / 空格 / 点击仍复制。
**清理**：临时 CDP 脚本已删除；测后回到单标签 `写作示例.md`、分栏、亮色、侧栏「文件」，焦点在正文；未修改笔记内容，无历史快照与恢复副本新增。
**检验计数**：5（下一轮 300 做检验轮，回归 295–299）。

## 第 298 轮 · 2026-11-01 08:15
**用户需求**：场景：习惯用键盘，Tab 到侧栏标签后按 End 或 → 打开「搜索」。现在的问题：侧栏确实切到了搜索，但焦点被搜索框抢走，紧接着按 ←/→ 改的是输入框里的光标，回不到标签行；想继续用方向键换标签只能先 Shift+Tab。期望：用方向键 / Home / End 切标签时焦点留在标签上；只有鼠标点击、回车激活标签或从命令面板打开搜索时，才把光标送进输入框。
**产品经理**：做。这是第 293 / 294 轮侧栏单停靠点的收尾：`role="tablist"` 的方向键导航不应被内容区自动抢焦，与菜单栏（289）、文档标签（296）、工具栏（297）的键盘模型一致；只改焦点落点，不改视觉、不加界面，符合「快、安静」，不扩大产品边界，不碰「暂不做」。
**前端**：`features/workspace/SearchPanel.tsx` 把写死的 `autoFocus` 改为可选 prop（默认 true，保持其它入口原有行为）；`features/workspace/WorkspaceSidebar.tsx` 新增 `focusSearchOnOpen`，`selectTab(next, focusSearch)` 在切到搜索时记录是否抢焦；标签行三个按钮补 `data-sidebar-tab`，方向键 / Home / End 不再走 `click()`，改为 `focus()` 后直接 `selectTab(next, false)`；命令面板 / 快捷键的 `searchRequest` 分支显式 `setFocusSearchOnOpen(true)` 与 `setTabStop("search")`，并保留原来的 rAF 聚焦（面板尚未挂载时由 autoFocus 兜底）。风险：鼠标点击搜索仍直接进输入框；命令面板打开搜索与从输入框 Shift+Tab 回标签均按既有预期；文件 / 大纲标签的行为不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/workspace/SearchPanel.tsx`（+2/−2 行）、`src/features/workspace/WorkspaceSidebar.tsx`（+16/−3 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.30s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，1100×760，亮色、分栏、单标签 `写作示例.md`、侧栏「文件」）**：
- 改前基线与改后对照：聚焦「文件」标签按 End 后，侧栏切到「搜索」且焦点停在「搜索」标签（`aria-selected=true`、`tabIndex=0`），搜索框未被聚焦；改前同一操作焦点直接落进 `.search-input`。
- 从该状态按 Tab 一次进搜索框，Shift+Tab 回到「搜索」标签；再按 ←/→ / Home 时作用在标签行而不是输入框文字。
- 从「文件」按 → → 到「搜索」：焦点与停靠点都在启动标签上，搜索框未聚焦；鼠标真实点击「搜索」标签（CDP 鼠标事件）仍直接聚焦搜索框，停靠点跟随该标签。
- 命令面板路径：先用方向键切到搜索（此时 autoFocus 已关闭）再离开，随后 `Ctrl+Shift+P` → 输入「在工作区中搜索」→ 回车，搜索标签激活且焦点在搜索框；Shift+Tab 回到「搜索」标签（`tabIndex=0`），不再跳过搜索落到「文件」。
- 文件 / 大纲标签切换、搜索框 ↑↓、Esc 清空和标签持久化均无回归；控制台无报错（`consoleErrors []`）。
**人工复现**：键盘聚焦侧栏「文件」→ End（或 → 两次）打开搜索：焦点应仍在「搜索」标签，搜索框未被聚焦；再按 Tab 才进输入框，Shift+Tab 回到标签。用鼠标点「搜索」标签则应直接进输入框；用 `Ctrl+Shift+P` 执行「在工作区中搜索」也应直接进输入框，Shift+Tab 回到「搜索」标签。
**清理**：临时 CDP 脚本已删除；测完回到单标签 `写作示例.md`、分栏、亮色、侧栏「文件」，焦点在正文；未修改笔记内容，无历史快照与恢复副本新增。
**检验计数**：4（下一轮 299 按正常需求轮）。

## 第 297 轮 · 2026-11-01 08:07
**用户需求**：场景：用键盘从标题栏、标签条一路 Tab 进正文。现在的问题：工具栏的撤销 / 加粗 / 斜体 / 列表 / 插入图片等按钮各占一个 Tab 停靠点，仅从标签条走到正文就要穿过十几个按钮；这些动作平时都有快捷键或方向键。期望：格式按钮整组只占一个停靠点，←/→ / Home / End 在按钮间移动，再按 Tab 就离开工具栏。
**产品经理**：做。这是既有工具栏的键盘可达性收敛，与菜单栏（289）、大纲（290）、文件树（291）、侧栏标签（293）、分段控件（295）、文档标签（296）的「一组控件一个停靠点 + 方向键」一致；符合 `role="toolbar"` 的 ARIA 惯例，不改视觉、不加界面、不扩大产品边界，不碰「暂不做」。
**前端**：只改 `src/app/Toolbar.tsx`：工具栏容器持有 `toolbarRef`；`.toolbar-group .tool-btn` 通过 `useLayoutEffect` 校正为 roving `tabIndex`（整组只留一个 0），`onFocus` 跟随最后聚焦的按钮，容器处理 ←/→ / Home / End（首尾循环、跳过禁用按钮）只移动焦点。标题下拉框保留自己的停靠点与原生方向键；右侧视图分段控件与专注按钮不在组内，行为不变。切到纯预览等导致格式按钮全部禁用时，整组退出 Tab 序；恢复后落到第一枚可用按钮。风险：只改焦点顺序，点击与命令执行不变；禁用态兜底每次渲染重算一次，成本可忽略。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/app/Toolbar.tsx`（+79 / −2 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.37s，仅既有的 chunk 体积与动态导入提示）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，1100×760，亮色、分栏、单标签 `写作示例.md`）**：
- 改前工具栏 16 个格式按钮中 14 个可用的各占一个停靠点；改后整组只有 1 个 `tabIndex=0`（重载后撤销 / 重做无历史而禁用，停靠点落在「加粗」），标题下拉框、视图分段控件与专注按钮各自仍为 0。
- 焦点在「加粗」按 Tab 直接到「段落样式」下拉框，Shift+Tab 回到「加粗」且停靠点仍在原按钮；整组不再逐个穿越。
- 方向键：→ 到「斜体」、再 → 到「删除线」，End 到「插入图片」，在末尾 → 回绕到「加粗」，Home 回「加粗」，在首位 ← 回绕到「插入图片」；每一步整组仍只有 1 个 `tabIndex=0`，正文内容不变（方向键未误触格式）。
- 切到「预览」后 14 个格式按钮全部禁用，整组没有任何 `tabIndex=0`（Tab 直接跳过工具栏）；切回「分栏」后停靠点自动恢复到「加粗」。
- 控制台无报错；测完关闭额外标签，回到单标签 `写作示例.md`、分栏、亮色，焦点在正文。
**人工复现**：整页重载后从标签条按 Tab 进入工具栏，整组格式按钮只停一次；←/→ 在可用按钮间移动、Home / End 到首尾、两端回绕，回车 / 空格才执行；再按 Tab 应到「段落样式」下拉框；切到纯预览后 Tab 不应再停在格式按钮上。
**清理**：测试时打开的 10 个额外标签已全部关闭，标签持久化回到单标签 `写作示例.md`；视图回到分栏、主题亮色；未修改笔记内容，无历史快照与恢复副本新增；临时 CDP 脚本已删除。
**检验计数**：3（下一轮 298 按正常需求轮）。

## 第 296 轮 · 2026-11-01 07:57
**用户需求**：同时开七八篇笔记后，从正文 Shift+Tab 或侧栏按 Tab 回到标签条，每篇笔记的主按钮和它旁边的 × 各占一个 Tab 停靠点，光穿过标签条就要按十几次；期望整条标签只占一个停靠点（当前那篇），←/→ / Home / End 在标签间移动并切换，Tab 一次就能离开。
**产品经理**：做。与菜单栏（289）、侧栏标签（293）、大纲（290）、文件树（291）、分段控件（295）的「一组控件一个停靠点 + 方向键」一致；不改视觉、不加界面，不扩大产品边界，不碰「暂不做」。方向键本来就逐篇打开，收敛停靠点只是让键盘路径与之一致。
**前端**：只改 `src/features/tabs/TabBar.tsx`：计算 `stopPath`（当前标签，找不到则第一个），主按钮与 × 按它渲染 roving `tabIndex`（整条只留主按钮 + 当前 × 两个 0）；焦点停在 × 时方向键按所在标签解析，不必先 Shift+Tab 回主按钮。风险：非当前标签的 × 不再在 Tab 序里，可先用方向键切过去，或用已有的 Shift+F10 标签菜单关闭；鼠标点击、中键、Ctrl+Tab 不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/features/tabs/TabBar.tsx`（+18/−1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.41s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，亮色、分栏）**：
- 5 个标签（写作示例 / CaseTest / final / 跨笔记链接 / 长文档）时，只有当前「长文档」的主按钮与 × 为 `tabIndex=0`，其余 4 个标签的主按钮与 × 均为 -1；改前 10 个停靠点。
- 从当前标签主按钮按 Tab → 落到它的 ×，再按 Tab 直接离开标签条到 `+` 新建按钮；Shift+Tab 回到同一个 ×；整条标签栏最多 2 次按键即可穿过。
- 焦点停在 × 上按 → 从「长文档」回绕到「写作示例」并打开，焦点与停靠点都到「写作示例」；← 到「长文档」、Home 到首个、End 到末个、在末尾按 → 回绕到首个，`aria-selected` 与 `tabIndex=0` 始终同步。
- 关闭 4 个额外标签后回到单标签 `写作示例.md`，焦点回正文，视图仍为「分栏」；控制台无报错。
**人工复现**：同时开 5 篇以上笔记，在正文按 Shift+Tab 回标签条：只有当前标签可 Tab 停靠，再按一次 Tab 离开标签条；←/→ / Home / End 逐篇切换且当前项高亮与停靠点跟随；焦点停在当前标签的 × 时方向键同样可用。
**清理**：额外标签已全部关闭，回到单标签 `写作示例.md`、分栏、亮色、焦点在正文；未修改笔记内容，无历史快照与恢复副本新增；临时 CDP 脚本已删除。

## 第 295 轮 · 2026-11-01 07:56
**用户需求**：我用键盘切视图，工具栏右侧的「源码 / 分栏 / 预览 / 所见即所得」是四个按钮，各占一个 Tab 停靠点，要按好几次才能离开；焦点进组后按 ←/→ 毫无反应，可菜单里的视图组早就能用方向键。设置里的「主题 / 点缀色」也是同一组控件，同样只能一个个 Tab 过去。期望：同一组只占一个 Tab 停靠点，←/→ / Home / End 在组内移动焦点，回车才真正切换。
**产品经理**：做。这是既有分段控件的键盘可达性收敛，与菜单栏（289）、大纲（290）、文件树（291）、侧栏标签（293）的「一组控件一个停靠点 + 方向键」一致；方向键只移焦点、回车才生效，扫过时不会误改视图或主题；不改视觉、不加界面，符合「快、安静」，不扩大产品边界，不触碰「暂不做」。
**前端**：只改共用组件 `src/components/SlidingSegmented.tsx`：新增 `stop` 状态与 `stopValue`（默认当前值，焦点进入后跟随焦点），按钮按它渲染 roving `tabIndex`（只留一个 0），`onFocus` 同步；容器处理 ←/→ / Home / End（首尾循环）只移动焦点，Enter / 空格沿用按钮默认行为切换。同时作用于工具栏视图切换与设置里的「主题 / 点缀色」两组。风险：设置里方向键扫过不立即换肤，行为符合「移动焦点、回车生效」；鼠标点击与滑块动画不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。工作量无。
**裁决**：做。
**改动**：`src/components/SlidingSegmented.tsx`（+30 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.31s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，1100 宽，亮色、分栏、单标签 `写作示例.md`）**：
- 工具栏视图切换：改前四个按钮 `tabIndex` 全为 0；改后只有当前「分栏」为 0。聚焦「分栏」按 → 后焦点到「预览」，当前视图仍是「分栏」，停靠点仍只有 1 个；再 → 到「所见」，← 从「源码」回绕到「所见」，Home 到「源码」、End 到「所见」、在「所见」按 → 回绕到「源码」。
- 激活：焦点停在「所见」时点击该按钮，视图切到所见（`changeViewMode` 按既有行为把焦点交给正文，与鼠标点击一致）；再回到「分栏」后当前视图与停靠点均恢复为「分栏」。
- 设置（共用组件）：打开偏好设置 →「外观排版」，「主题」「点缀色」两组各 3 个按钮都只有 1 个 `tabIndex=0`；聚焦「浅色」按 → 焦点到「深色」而主题仍是「浅色」，End 到末项，点击后主题才切过去（停靠点仍 1 个），还原「浅色」后关闭设置正常。
- 鼠标点击、滑块底色与其余界面无回归；测完回到单标签 `写作示例.md`、分栏、亮色、侧栏「文件」，设置已关闭，视图按钮 `tabIndex` 为 `[-1,0,-1,-1]`。
**人工复现**：工具栏右侧视图组按 Tab 进入只停一次，←/→ 只移焦点不改视图，回车才切；设置 → 外观排版 →「主题 / 点缀色」同样只占一个停靠点，方向键扫过不换肤、回车生效。
**清理**：临时 CDP 脚本已删除；主题已还原「浅色」，未修改笔记内容，无额外标签、历史快照与恢复副本。

## 第 294 轮（检验轮）· 2026-11-01 07:39
**回归范围**：第 289–293 轮（菜单栏单停靠点 + ←/→ / Home / End、大纲 roving 停靠点、文件树行 roving 与折叠兜底、切库后 `treeStop` 重算、侧栏「文件 / 大纲 / 搜索」单停靠点），并关联第 285–288 轮（搜索结果读屏选中、历史方向键、确认框焦点层级与 Tab 链路）。
**产品经理**：检验轮只做回归与修复，不开新功能；发现的问题若属既有功能的粗糙处则当场修。
**前端**：回归 `app/MenuBar.tsx`、`features/outline/OutlinePanel.tsx`、`features/workspace/WorkspaceSidebar.tsx`、`features/workspace/SearchPanel.tsx`、`features/history/HistoryDialog.tsx`、`components/Dialog.tsx`。本轮未发现功能缺陷，无源码改动。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做（检验轮回归）。
**改动**：无（仅更新 `docs/loop/backlog.md`、`docs/loop/state.md`）。
**构建**：`bun run build` 通过（含 tsc，vite 1.31s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，1100×760，亮色、分栏、单标签 `写作示例.md`）**：
- 菜单栏（289）：改后六项只有「文件」为 `tabIndex=0`；→ 依次移到「编辑」…「应用」且停靠点跟随，Home / End 到首尾，← 在「文件」回绕到「应用」；从「应用」按 Tab 一次离开菜单栏到窗口控制「最小化」，Shift+Tab 回到「应用」；回车打开「视图」菜单、Esc 关闭后焦点与停靠点回到「视图」。
- 侧栏标签（293）：三个 `role=tab` 只有当前 / 最后用过的一个为 0；从侧栏宽度分隔条按 Tab 落在「文件」，再 Tab 直接到「新建 Markdown」，Shift+Tab 回到「文件」；聚焦标签后 Home 回「文件」、→ 切「大纲」并打开、← 回「文件」，停靠点同步；End 打开「搜索」并按既有行为把焦点送进搜索框。
- 大纲（290）：10 条标题只有当前标题 `tabIndex=0`；聚焦后 ↓ / End / Home 移动焦点与停靠点（当前标题的 `aria-selected` 不随焦点变），Tab 离开到文档标签、Shift+Tab 回来仍停在同一标题。
- 文件树（291）：13 行只有当前笔记为 0；聚焦后 ↓ 进 `子目录/README.md`、End 到 `长文档.md`、Home 回 `子目录`，停靠点跟随；Tab 离开到文档标签、Shift+Tab 回到原行；聚焦嵌套行后「全部折叠」使停靠点兜底到首行 `子目录`。
- 切库（292）：临时库 `_c294lib`（`README.md` / `aaa.md`）。键盘聚焦主库 `写作示例.md` 时切到临时库，停靠点落在临时库当前笔记 `README.md`；在临时库聚焦 `README.md` 后切回主库，停靠点回到主库当前笔记 `写作示例.md`；反向再切也按当前笔记重算。临时库无上次文档时停靠点落第一行 `aaa.md`，符合「没有笔记落第一行」。
- 搜索（285）：输入「的」得 69 条，`aria-activedescendant` / `aria-selected` 指向 hit-0、焦点留在输入框；↓×20 后指向 hit-20、列表 `scrollTop` 644 且选中项完整可见；↑ 回 hit-19；Esc 清空后列表与 ARIA 属性移除。
- 历史（286）：`Ctrl+Alt+H` 3 个版本，只有选中项 `tabIndex=0`；↓ / ↑ / Home / End 同步选中、焦点与预览，两端夹住。
- 确认框（287 / 288）：设置里点「恢复默认设置」后焦点落在 `div.modal`，Tab / Shift+Tab 只在「恢复默认 / 取消」间循环；Esc 只关确认框、设置保留，再 Esc 关闭设置并回焦正文。历史列表从选中项 Tab 依次为「右侧预览（可滚动容器）→ 关闭 → 恢复此版本 → 选中项」，288 的修复仍然有效，不再被绕回第一项。
- 控制台只有 WebView 图片懒加载 info，无报错。
**观察（不修）**：
- 切库停靠点按「最后聚焦所属的库」记忆：若只在 A 库聚焦过某行、切到 B 后没在 B 的树里落过焦点，切回 A 时会回到 A 上次聚焦的那一行（不是当前笔记）；这是同库记忆、不会把别的库路径带过来，符合「最近聚焦」的设计。
- 侧栏 End 到「搜索」后焦点进入搜索框，此时 Home / 方向键作用于输入框，需 Shift+Tab 或点标签再回到标签行；沿用 293 记录的既有行为。
- 折叠时若焦点正停在将被折叠掉的行上（仅程序化点击按钮会这样，真实鼠标点击会先把焦点交给按钮），焦点按浏览器默认回到 body；停靠点兜底正常，未影响真实操作路径。
**人工复现**：从标题栏菜单栏按 Tab 一次应离开六项菜单；侧栏标签 / 大纲 / 文件树各只留一个 Tab 停靠点，用方向键与 Home / End 移动后 Tab 出去、Shift+Tab 回来仍在原处；在 A 库聚焦某行切到 B 库，停靠点应落在 B 当前笔记（无笔记落第一行）；搜索框 ↑↓ 时读屏属性与滚动跟随；历史与确认框的 Tab / Esc 层级同前。
**清理**：临时库 `_c294lib` 及其在 `recentWorkspaces` / `recentDocuments` / `tabsByWorkspace` / `lastDocumentByWorkspace` 的条目已删除；关闭测试中打开的额外标签，回到单标签 `写作示例.md`、分栏、亮色，侧栏「文件」并展开 `子目录`（13 行），焦点在正文；未修改笔记内容，无历史快照与恢复副本新增；临时 CDP 脚本与设置备份已删除。
**检验计数**：0（下一轮 295 按正常需求轮）。

## 第 293 轮 · 2026-11-01 07:26
**用户需求**：场景：习惯用键盘，从标题栏一路 Tab 到正文，侧栏停在「文件 / 大纲 / 搜索」。现在的问题：三个侧栏标签各自是一个 Tab 停靠点，即使 ←/→ 已经能在三者间切换，Tab 仍要一格一格穿过「文件」「大纲」才能离开标签行。期望：整行侧栏标签只算一个 Tab 停靠点（停在当前 / 最后用过的那个），←/→ / Home / End 在三个标签间移动并打开，再按 Tab 就直接进入后面的控件。
**产品经理**：做。与菜单栏（289）、大纲（290）、文件树（291）的 roving 停靠点做法一致，只改焦点顺序，不改视觉与交互，符合「快、安静」，不扩大产品边界，不触碰「暂不做」。
**前端**：`features/workspace/WorkspaceSidebar.tsx` 新增 `tabStop`（`SidebarTab | null`，未聚焦过时回落到当前标签），三个 `role="tab"` 按钮按 `stopTab` 渲染 `tabIndex`（只留一个 0），`onFocus` 同步停靠点；既有的 ←/→ / Home / End 与点击切换逻辑不变。风险：只影响标签行的 Tab 顺序；标签切换与持久化、搜索输入自动聚焦、分隔条、树 / 大纲 / 搜索内容都不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/workspace/WorkspaceSidebar.tsx`（+10 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.37s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，1100×760，侧栏当前「文件」）**：
- 改前基线：三个标签 `tabIndex` 全为 0；改后只有当前 / 最后用过的那个为 0，其余 -1。
- 从侧栏宽度分隔条按 Tab，落在唯一的停靠点「文件」；再按 Tab 直接离开标签行到侧栏「新建 Markdown」按钮，Shift+Tab 回到「文件」。
- → 切到「大纲」并打开，停靠点跟着移动（只剩「大纲」为 0）；End 到「搜索」并打开，焦点按既有行为进入搜索输入框。
- 真实鼠标点「大纲」「文件」后停靠点跟随被点项，再按 Tab 进入标签行即落在该项；标签切换与持久化照常。
- 回归：文件树、当前笔记、文档标签、侧栏宽度分隔条均无变化；控制台无新增报错。
**人工复现**：整页重载 → 从侧栏宽度分隔条按 Tab，应一次落在当前侧栏标签；再按 Tab 直接进入侧栏内容 / 右上按钮。用 ←/→ / Home / End 换标签后 Tab 出去、Shift+Tab 回来应停在最后用过的那项。
**清理**：只切换过侧栏标签，未修改任何笔记（无脏标记、无历史快照与恢复副本新增）；临时 CDP 脚本已删除；应用回到单标签 `写作示例.md`、分栏、亮色，侧栏「文件」，窗口 1100×760。
**检验计数**：5（下一轮 294 做检验轮，回归 289–293）。

## 第 292 轮 · 2026-11-01 07:17
**用户需求**：场景：先在一个库里写东西，用键盘停在文件树某一行，然后从标题栏切到另一个笔记库。现在的问题：切库后文件树的 Tab 停靠点还记着上一个库的那一行；新库里恰好有同名文件时就会停在名字相同却不相干的那篇上，没有同名文件时又落到第一行，而不是新库当前打开的笔记。期望：切库后停靠点按新库重新算，落在新库当前笔记（没有笔记时落第一行）。
**产品经理**：做。这是第 291 轮 roving 停靠点的收尾，只让停靠点跟随所属工作区，不新增界面、不改视觉与交互，符合「快、安静」，不扩大产品边界，不触碰「暂不做」。
**前端**：`features/workspace/WorkspaceSidebar.tsx` 的 `treeStop` 从裸路径改为 `{ root, path }`，`stopPath` 只在 `treeStop.root === 当前库` 时采用，否则回落到当前笔记 / 第一行；聚焦行与兜底（行被折叠 / 删除）写入时一并带上当前库；新增 `root` 订阅。风险：只影响停靠点归属；↑↓ / Home / End、Enter、点击、F2 / Delete、右键、拖拽与折叠兜底都不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/workspace/WorkspaceSidebar.tsx`（+9 / −4 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.34s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，1100×760；临时库 `D:\clawWorkSpeace\_c292lib` 含 `README.md` / `aaa.md`，测试后已删除并还原设置）**：
- 改前路径：在主库聚焦 `长文档.md`（停靠点确认为该行）后切到临时库——旧实现会把 `长文档.md` 带过去，新库没有该路径只能兜底到第一行 `aaa.md`，不会落在新库当前笔记 `README.md`。
- 改后方向一：临时库当前笔记 `README.md`、停靠点在 `README.md` 时切回主库（当前笔记 `写作示例.md`，两库都有 `README.md`）——切库后唯一 `tabIndex=0` 的是 `写作示例.md`，`README.md` 为 -1，没有沿用同名行。
- 改后方向二：再从主库切到临时库——停靠点回到新库当前笔记 `README.md`，标签为 `README.md`，无残留旧行。
- 真实按键：在主库把焦点放到「全部折叠」按 Tab，直接落在 `写作示例.md`（新库当前笔记），Shift+Tab 回到「全部折叠」。
- 回归：切库后标签恢复、当前文档、状态栏路径、展开 / 折叠与文件树 ↑↓ 导航均正常；控制台无新增报错。
**人工复现**：在库 A 用键盘聚焦文件树某一行（与当前笔记不同）→ 切到库 B（库 B 有同名文件、当前笔记是另一篇）→ 从侧栏上方按 Tab 进入文件树，应落在库 B 当前笔记上，而不是库 A 那一行或第一行；再切回库 A，停靠点同样按库 A 当前笔记重算。
**清理**：临时库 `_c292lib`、临时脚本与设置备份已删除；`settings.json` 已还原（无 `_c292lib`、`lastWorkspace` 为 `新建文件夹`）；`recentWorkspaces` / `tabsByWorkspace` / `lastDocumentByWorkspace` 均无测试条目。应用回到单标签 `写作示例.md`、分栏、亮色，侧栏「文件」，焦点在正文；窗口 1100×760；未修改任何笔记。
**检验计数**：4（下一轮 293 按正常需求轮）。

## 第 291 轮 · 2026-11-01 07:10
**用户需求**：场景：库里有几十上百个 Markdown，习惯用键盘从标题栏一路 Tab 到正文。现在的问题：文件树每一行都是一个 Tab 停靠点，焦点进了文件树就要一格一格穿过所有文件才能离开侧栏，文件多时几乎出不去；方向键明明已经能在树里移动。期望：整棵文件树只算一个 Tab 停靠点（停在当前笔记 / 最后聚焦的那一行），↑↓ / Home / End / ←→ 在树里移动，再按 Tab 就直接进入后面的控件。
**产品经理**：做。文件树既有的方向键导航（第 56 轮）已覆盖树内移动，唯一缺的是把整棵树收敛为一个 Tab 停靠点，与菜单栏（289）、大纲（290）一致；不新增界面、不改视觉，符合「安静、快」，不扩大产品边界，不触碰「暂不做」。
**前端**：`features/workspace/WorkspaceSidebar.tsx` 新增 `treeStop` 状态与 `treeRef`，行按 `entry.relPath === stopPath` 渲染 roving `tabIndex`（只留一个 0），`onFocus` 记住最后聚焦行；`stopPath` 默认取当前笔记路径，没有笔记时取第一行；行被折叠 / 删除导致树里没有停靠点时，effect 兜底挪到第一行；行补 `data-path` 供兜底与测试定位。风险：只改行的 Tab 顺序；↑↓ / ←→ / Home / End、Enter / 点击、F2 / Delete、右键与拖拽（含焦点还原本就调用 `.focus()`）都不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/workspace/WorkspaceSidebar.tsx`（+32 / −0 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.34s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，1100×760，侧栏「文件」13 行）**：
- 改前基线：13 行 `tabIndex` 全为 0；焦点进树后要按满 13 次 Tab 才能离开侧栏。
- 改后初始：仅当前笔记 `写作示例.md` 为 0，其余 -1。
- 真实按键：焦点放到「全部折叠」后按 Tab，直接落在 `写作示例.md`；再按 Tab 离开树到文档标签，Shift+Tab 回到同一行（停靠点不变）。
- 方向键：聚焦首行「子目录」按 ↓ 到 `子目录/README.md`，焦点与 `tabIndex` 一起移动（只剩该行 0），Tab 出去再 Shift+Tab 回来仍停在它；End 到末行 `长文档.md`、Home 回首行，停靠点同步。
- 兜底：聚焦 `子目录/笔记.md`（停靠点确认为该行）后点「全部折叠」，该行随目录消失，停靠点自动落到第一行「子目录」；再从「全部折叠」按 Tab，能一次进入树（不再无处可落）。
- 回归：展开 / 折叠目录、当前笔记高亮、侧栏标签、文档标签、正文焦点与分栏视图均正常；控制台无新增报错。
**人工复现**：整理多文件的工作区 → 从侧栏上方按钮按 Tab 进入文件树，应只落在当前笔记（或第一行）上；再按 Tab 直接离开侧栏。用 ↑↓ / Home / End 换行后 Tab 出去、Shift+Tab 回来应仍停在那一行。把停靠点所在行折叠起来，再 Tab 进入树应落到第一行而不是无处可进。
**清理**：只展开 / 折叠过目录、移动焦点，未修改任何笔记（无脏标记、无历史快照与恢复副本新增）；已把 `子目录` 恢复为展开，回到单标签 `写作示例.md`、分栏、亮色，侧栏「文件」，焦点在正文；窗口 1100×760。
**遗留 / 观察**：停靠点在切库后仍保留上一库的相对路径，若新库无该路径会由兜底落到第一行；如需切库后落在新库当前笔记，可另立一轮把 `treeStop` 随工作区重置。
**检验计数**：3（下一轮 292 按正常需求轮）。

## 第 290 轮 · 2026-11-01 06:56
**用户需求**：场景：写长文，一篇笔记有几十上百个小标题，用键盘从标题栏一路 Tab 到正文。现在的问题：整张大纲每一条标题都是一个 Tab 停靠点，焦点进了大纲就要一格一格穿过所有标题才能离开侧栏；标题上千时几乎出不去，方向键明明已经能在大纲里移动。期望：整张大纲只算一个 Tab 停靠点（停在最后聚焦 / 当前标题上），↑↓ / Home / End 在条目间移动，再按 Tab 就直接进入后面的控件。
**产品经理**：做。这是大纲既有键盘路径的可达性收敛，与菜单栏（289）、文档历史（286）的「一组控件一个 Tab 停靠点 + 方向键」一致；不改视觉、不加界面，符合「快、安静」，不扩大产品边界，不触碰「暂不做」。
**前端**：`features/outline/OutlinePanel.tsx` 新增 `tabStop` 状态（`number | null`），条目按 `index === tabStopIndex` 渲染 `tabIndex`（只留一个 0），`onFocus` 同步停靠点；未聚焦过时从当前标题（`activeIndex`，没有标题落在光标前时取第一条）进入，换文档时重置；`OutlineRow` 仍是 memo，只多两个 prop，标题增删时不会整表重渲染。风险：只改大纲条目的 Tab 顺序；↑↓ / Home / End、Enter / 空格跳转、点击跳转、当前标题高亮、滚动跟随都不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/outline/OutlinePanel.tsx`（+23 / −0 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.28s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，1100×760，侧栏「大纲」10 条）**：
- 改前基线：10 条条目 `tabIndex` 全为 0；焦点在第 1 条按 Tab 落到第 2 条「小标题」，要继续离开侧栏得按满 10 次。
- 改后初始：仅当前标题（第 5 条，光标所在处）`tabIndex=0`，其余 `-1`。
- 真实按键：从侧栏「搜索」Tab 进入大纲只落在唯一的停靠点；再按 Tab 直接离开大纲到文档标签，Shift+Tab 回到同一停靠点。
- 方向键：↓ 从第 1 条到第 2 条，焦点与 `tabIndex` 一起移动（只剩第 2 条为 0）；Tab 出去再 Shift+Tab 回来仍停在第 2 条；End 到第 10 条、停靠点同步。
- 跳转：在第 3 条按 Enter，光标从 `7:1` 移到 `11:1`、焦点回正文，未产生脏标记；鼠标点第 3 条同样跳转并把停靠点移到该条（随后焦点按原行为进正文）。
- 换文档：切到 `子目录/笔记.md`（2 条标题，光标在第 2 条）后停靠点是第 2 条（`aria-selected` 同步），没有沿用上一篇停留位置。
- 回归：侧栏三个标签、resizer、文档标签、正文焦点与分栏视图均无变化；控制台无新增报错。
**人工复现**：打开一篇标题较多的笔记 → 侧栏「大纲」→ 从侧栏标签区按 Tab 进入大纲，应只落在一条上；再按 Tab 直接离开侧栏。用 ↓ / Home / End 换条目后 Tab 出去、Shift+Tab 回来应仍停在该条。换一篇笔记再进大纲，停靠点应落在新文档当前标题。
**清理**：只移动光标并切过一次标签，未修改任何笔记（无脏标记、无历史快照与恢复副本新增）；切回的 `写作示例.md` 已恢复单标签、分栏、亮色，侧栏「文件」，焦点在正文；窗口 1100×760。
**遗留 / 观察**：文件树行目前仍逐行占 Tab 停靠点（通常条目数远少于大纲，影响较小），若后续想统一，可另立一轮把同样的 roving 停靠点用到 `.tree-row`。
**检验计数**：2（下一轮 291 按正常需求轮）。

## 第 289 轮 · 2026-11-01 06:43
**用户需求**：场景：习惯用键盘，从标题栏一路 Tab 到正文。现在的问题：整条菜单栏「文件 / 编辑 / 段落 / 格式 / 视图 / 应用」每一项都是一个 Tab 停靠点，想离开菜单栏得连按六次 Tab，中间还会把焦点停在不想打开的菜单上；←/→ 明明已经能在菜单间移动，Tab 却被占住。期望：整条菜单栏只算一个 Tab 停靠点（停在最后用过的那项），←/→ 在六项间移动，Home / End 直接到首尾，再从菜单栏按 Tab 就直接进入后面的控件。
**产品经理**：做。这是菜单栏既定键盘路径的可达性收敛，与标签栏、文件树、大纲已有的「一组控件一个 Tab 停靠点 + 方向键」习惯一致；不新增界面、不占空间，符合「安静、快」，不扩大产品边界，不触碰「暂不做」。
**前端**：`app/MenuBar.tsx` 新增 `tabStop` 状态，顶层按钮按 `index === tabStop` 渲染 `tabIndex`（只留一个 0），`onFocus` 记住最后聚焦项；原 ←/→ 分支扩成 ←/→ / Home / End，打开菜单时同样切到相邻 / 首尾菜单。关闭菜单仍由 `AppMenu` 把焦点还回锚点，`onFocus` 同步停靠点。风险：只改菜单栏焦点顺序与 Tab 停靠点；点击、悬停切换、下拉内容、Esc 回焦、命令面板与其它菜单都不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/app/MenuBar.tsx`（+18 / −3 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.38s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，1100×760）**：
- 改前基线：六个顶层按钮 `tabIndex` 全为 0；焦点在「文件」按 Tab 落到「编辑」、再 Tab 到「段落」，离开菜单栏要六次。
- 改后：仅「文件」为 0、其余为 -1；焦点在「文件」按 Tab 直接离开菜单栏到窗口控制「最小化」，Shift+Tab 回到「文件」。
- 方向键：→ 到「编辑」且停靠点跟着换成「编辑」；End 到「应用」、Home 回「文件」、在「文件」按 ← 回绕到「应用」；Tab 出去再 Shift+Tab 回来仍停在最后用过的「编辑」（不回到「文件」）。
- 菜单：`ArrowDown` 打开「文件菜单」、焦点进首项；在菜单内 → 切到「编辑菜单」、`aria-expanded` 同步；Esc 关闭并回焦「编辑」、停靠点同步。鼠标点「段落」打开菜单、Esc 关闭后焦点与停靠点都在「段落」。
- 回归：菜单项、悬停切换、单选组 ←/→、命令面板与正文焦点均未受影响；控制台无新增报错。
**人工复现**：整页重载后按若干次 Tab 进入菜单栏，应一次落在「文件」；再按 Tab 直接进入后续控件；用 ←/→ / Home / End 在六个顶层菜单间移动，再按 Enter / ↓ 打开，Esc 关闭后焦点回到刚用的那项。
**清理**：未执行任何菜单命令；回到单标签 `写作示例.md`、分栏、亮色，侧栏「文件」，焦点在正文；窗口 1100×760；未修改笔记内容，无历史快照与恢复副本新增。
**检验计数**：1（下一轮 290 按正常需求轮）。

## 第 288 轮（检验轮）· 2026-11-01 06:36
**回归范围**：第 283–287 轮（搜索键盘选结果跟随滚动、关闭非当前标签焦点落相邻、搜索结果读屏选中项、文档历史方向键切版本、确认框焦点与 Esc 层级），并关联第 278–282 轮的标签与菜单键盘能力。
**构建**：`bun run build` 通过（含 tsc，vite 1.31s）；本轮未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，1100×760，亮色、分栏、单标签 `写作示例.md`）**：
- 搜索（283 / 285）：侧栏「搜索」输入「一」得 74 条，列表 `role=listbox`、`aria-controls` / `aria-activedescendant` 指向 hit-0，焦点留在 `search-input`；↓×21 后指向 hit-21、`scrollTop` 780 且选中项完整可见；随后 ↑×21 选中回到 hit-0、`scrollTop` 归 0，跟随滚动上下行都正常；回车打开命中笔记并跳到 `41:1`，Esc 清空后列表与 ARIA 属性一并移除。
- 标签（284 及关联 278–280）：4 个标签下聚焦中间非当前标签的 × 按 Enter，焦点落到右邻标签、Tab 接得到它的 ×；`Shift+F10` 打开菜单、菜单项随位置收敛，Enter 关闭非当前标签后焦点落到相邻标签；菜单内 Tab 关闭菜单并前进到触发标签的 ×、Shift+Tab 反向到文件树；Esc 关闭菜单并把焦点还给触发标签；标签间 ←/→ 与 Home / End 切换文档且焦点跟随，末尾 → 回绕到首标签；聚焦当前标签 × 按 Enter 关闭后焦点进入正文。
- 历史（286）：`Ctrl+Alt+H` 打开 3 个版本，列表 `role=listbox`、选中项 roving `tabIndex=0`；↓ / ↑ / Home / End 同步选中、焦点、预览（v1 内容校验和与 v0 / v2 不同，预览随选择刷新），两端夹住不越界。
- 确认框（287）：历史里点「恢复此版本」后焦点落在 `div.modal`（`aria-label=恢复这个历史版本？`），Tab / Shift+Tab 只在「载入此版本 / 取消」间循环；Esc 只关确认框，历史仍在且焦点回到「恢复此版本」；设置里「恢复默认设置」同样成立，Esc 只关确认框、设置保留，再 Esc 关闭设置并回焦正文。
- 控制台无新增报错。

**发现与修复**：第 286 轮给 `trapTab` 过滤 `tabIndex<0` 后，判断「焦点不在可 Tab 列表里」一律绕回首 / 末项；历史右侧 `.history-preview` 是浏览器默认可聚焦的滚动容器、却不在该列表里，导致选中版本按 Tab 到预览后再按 Tab 被拉回版本列表，「关闭 / 恢复此版本」两枚按钮正向 Tab 永远到不了（Shift+Tab 反向正常）。第 287 轮依赖同一函数，确认框首焦点场景须保留。改为只在焦点确实落在对话框容器本身时收进首尾，框内其它可聚焦元素交给浏览器按 DOM 顺序走。修后 Tab 为「选中版本 → 预览 → 关闭 → 恢复此版本 → 选中版本」，Shift+Tab 反向对称；命令面板、设置、命名对话框与确认框的首尾循环均无回归。

**人工复现**：`Ctrl+Alt+H` 打开有多个版本的笔记 → 焦点在版本列表按 Tab，应依次经过右侧预览、关闭、恢复此版本后回到选中版本；Shift+Tab 反向一致。再点「恢复此版本」，确认框一出现按 Tab / Shift+Tab 只在两键间循环，Esc 只关确认框。
**清理**：未载入历史版本、未恢复默认设置；关闭测试中打开的额外标签，回到单标签 `写作示例.md`、分栏、亮色，侧栏「文件」，焦点在正文；窗口 1100×760；未修改笔记内容，无历史快照与恢复副本新增。
**检验计数**：0（下一轮 289 按正常需求轮）。

## 第 287 轮 · 2026-11-01 06:26
**用户需求**：场景：在文档历史里挑好一版，点「恢复此版本」。现在的问题：确认框虽然弹出来，焦点却还留在下面的历史列表里，Tab 一直在后面的界面里绕，键盘完全走不到「载入此版本 / 取消」，读屏也不报这个确认框；按 Esc 还把历史和确认框一起关掉。期望：确认框打开就把焦点收进去，Tab / Shift+Tab 只在框内循环；Esc 只关确认框，历史仍开着。
**产品经理**：做。确认框是所有高风险动作的最后一道闸，焦点没进去等于键盘 / 读屏用户既看不见也确认不了；只补弹层焦点与 Esc 层级，不改文案与按钮，符合「安静、数据安全」，不扩大产品边界，不触碰「暂不做」。
**前端**：`components/Dialog.tsx` 的 `ConfirmDialog` 给卡片加 `tabIndex={-1}` 与 ref，挂载后 `focus()` 容器，读屏会报出标题；`trapTab` 在焦点落在容器（不在可 Tab 元素内）时，Tab 收到首项、Shift+Tab 收到末项，不再从对话框后面绕出去；`features/history/HistoryDialog.tsx` 的 Esc 监听在 `confirm / prompt` 开着时直接返回，让确认框自己关。`App.css` 补 `.modal:focus { outline: none; }`，容器不是可点控件，不画默认焦点框。风险：只影响确认框打开时的初始焦点与首尾循环；命令面板、设置、移动对话框、历史、图片浮层原有的 `trapTab` 行为不变（焦点本就在可 Tab 元素上）。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/components/Dialog.tsx`（+16 / −2 行，含 trapTab）、`src/features/history/HistoryDialog.tsx`（+3 行）、`src/app/App.css`（+6 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.34s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，1100×760）**：
- 改前基线：`Ctrl+Alt+H` 打开历史，焦点在第一个版本；点「恢复此版本」后确认框出现，但 `document.activeElement` 仍是下层历史的「恢复此版本」按钮；Tab 在历史列表里回绕，确认框两个按钮都到不了；Esc 一次后两个 dialog 全消失，焦点落到正文。
- 改后焦点：确认框出现时 `document.activeElement` 是 `div.modal`（`role=dialog`、`aria-label=恢复这个历史版本？`、`tabIndex=-1`），读屏可报出标题。
- Tab / Shift+Tab：从容器按 Tab 落到「载入此版本」，Shift+Tab 从首项回绕到「取消」，焦点始终在确认框内。
- Esc 层级：在确认框上按 Esc 后只剩「文档历史」，焦点回到下层的「恢复此版本」按钮，历史没有被一起关掉。
- 独立确认框：设置里点「恢复默认设置」→ 焦点同样进入 `div.modal`（`aria-label=恢复默认设置`）；Esc 只关确认框、设置仍在，焦点回到「恢复默认设置」；再 Esc 关设置、焦点回正文。
- 回归：命令面板 `Ctrl+Shift+P` 打开后焦点仍在搜索框，Shift+Tab 回绕到末项「偏好设置」，Esc 关闭并回焦正文；历史列表 ↑↓ / 预览未受影响；未点「载入此版本 / 恢复默认」，无内容或偏好改动。
- 控制台无新增报错。
**人工复现**：打开有历史版本的笔记 → `Ctrl+Alt+H` → 点「恢复此版本」→ 确认框一出现就用 Tab / Shift+Tab，焦点应只在「载入此版本 / 取消」两键间；按 Esc 只关确认框，历史列表仍在。再在设置底部点「恢复默认设置」重复一次。
**清理**：未恢复历史版本、未恢复默认设置；回到单标签 `写作示例.md`、分栏、亮色，侧栏「文件」，焦点在正文；窗口 1100×760；未修改笔记内容，无历史快照与恢复副本新增。
**检验计数**：5（下一轮 288 按规则做检验轮，回归 283–287）。

## 第 286 轮 · 2026-11-01 06:17
**用户需求**：场景：一篇笔记反复保存后，按 `Ctrl+Alt+H` 打开文档历史，想回看前几天某一版。现在的问题：列表里最多 20 个版本，焦点虽然落在第一条，但 ↑/↓ 完全没有反应，只能按 Tab 一格一格穿过每一条才能到「关闭 / 恢复此版本」；读屏也听不出当前选中的是哪一版。期望：像大纲 / 文件树一样用 ↑↓、Home / End 在版本间移动并同步右侧预览，读屏能报出当前选中版本；Tab 不再需要穿过整张列表。
**产品经理**：做。这是文档历史既有列表的键盘可达性缺口，与大纲、文件树、搜索结果已有的方向键习惯保持一致；不改弹层结构与阅读行为，安静、不占空间，不扩大产品边界，不触碰「暂不做」。
**前端**：`features/history/HistoryDialog.tsx` 给版本列表加 `role="listbox"`、每项按钮 `role="option"` + `aria-selected` + `data-history-index`，按选中项做 roving `tabIndex`（只留当前版本在 Tab 顺序里）；容器 `onKeyDown` 处理 ↑↓ / Home / End，夹在首尾，移动焦点的同时 `setSelected`，右侧预览沿用既有读取逻辑。`components/Dialog.tsx` 的 `trapTab` 首尾循环过滤掉 `tabIndex < 0` 的元素，避免 Tab 绕到不可 Tab 的旧版本上。风险：只动历史列表的焦点与 ARIA；命令面板、设置、图片浮层等共用 `trapTab` 的弹层不受影响（其中没有显式 `tabIndex=-1` 的按钮）。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/history/HistoryDialog.tsx`（+43 / −3 行）、`src/components/Dialog.tsx`（+6 / −1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.36s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，1100×760）**：
- 改前基线：`写作示例.md` 有 3 个历史版本，`ul` 无 role、`button` 无 `aria-selected`，三项 `tabIndex` 均为 0；焦点在第一条时按 ↓ 无反应，仍停在第一条。
- 改后语义：版本列表为 `role=listbox`（`aria-label=历史版本列表`），3 项 `role=option`，首项 `aria-selected=true`、`tabIndex=0`，其余 `false` / `-1`；打开后焦点落在选中项。
- ↓ 从第 1 条到第 2 条、再到第 3 条；第 3 条再 ↓ 停住不越界；↑ 回到第 2 条；Home 回第 1 条、End 到第 3 条；每次 `aria-selected`、`is-active` 与 roving `tabIndex` 同步，焦点跟随，右侧预览按选中项重新读取。
- Tab 路径（真实按键）：选中第 3 条时 Tab 依次到版本预览滚动区、关闭、恢复此版本，再 Tab 回绕到「选中的第 3 条」（改前会绕到第一条未选中项）；Shift+Tab 反向依次回「恢复此版本 / 关闭」。
- 回归：Esc 关闭弹层、焦点回到正文；命令面板 43 项仍可用 ↑↓、`Shift+Tab` 从输入框绕到最后一项、`Tab` 从最后一项绕回输入框，Esc 关闭并回焦；历史「关闭 / 恢复此版本」按钮与预览内容未变。
- 控制台无新增报错。
**人工复现**：打开一篇有多次保存记录的笔记 → `Ctrl+Alt+H` → 在左侧版本列表按 ↑↓ / Home / End，选中项与右侧预览一起变；Tab 一次即可离开列表到「关闭 / 恢复此版本」，Shift+Tab 反向也不穿过全部版本。
**清理**：未修改任何笔记内容（只读历史版本，未点「恢复此版本」），回到单标签 `写作示例.md`、分栏、亮色，侧栏「文件」，焦点在正文；窗口 1100×760；无历史快照与恢复副本新增。
**检验计数**：4（下一轮 287 按正常需求轮）。

## 第 285 轮 · 2026-11-01 06:06
**用户需求**：场景：用读屏软件在侧栏「搜索」里搜一个常用字，结果出来后用 ↑/↓ 挑条目。现在的问题：焦点一直留在输入框，读屏只会重复输入框和编辑框，不会告诉我现在选中了哪一条、它来自哪个文件；高亮只是视觉上的，盲选只能靠记忆或干脆用鼠标。期望：用 ↑/↓ 换选中项时，读屏能报出当前结果（文件名、行号、命中行），并且能知道这是第几条；视觉与键盘行为完全不变。
**产品经理**：做。这是全文搜索既有键盘路径的可访问性缺口，与大纲 / 文件树已有的 `aria-selected` 语义保持一致；不新增界面、不占空间，符合「安静、快」，不扩大产品边界，不触碰「暂不做」。
**前端**：`features/workspace/SearchPanel.tsx` 给结果列表加 `role="listbox"` 与固定 id，每项按钮改为 `role="option"` + `aria-selected` + 稳定 id，`li` 标 `role="presentation"`；输入框挂 `aria-controls` 与 `aria-activedescendant`（指向当前项，无结果 / 清空时移除），焦点仍留在输入框，↑↓ / 回车 / 鼠标、283 轮的跟随滚动与去抖搜索都不变。风险：只加 ARIA 属性，不改 class 与事件。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/workspace/SearchPanel.tsx`（+22 / −2 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.32s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，1100×760）**：
- 搜索「一」→ 74 条结果：`#workspace-search-results` 是 `role=listbox`，74 个 `role=option`，首项 `aria-selected=true`；输入框 `aria-controls=workspace-search-results`、`aria-activedescendant=workspace-search-hit-0`，`li` 均为 `role=presentation`。
- ↓ ×1：`aria-activedescendant` 与 `aria-selected` 一起移到 `workspace-search-hit-1`，焦点仍在 `search-input`；↓ 连按共 21 次后指向 hit-21，`scrollTop` 780、选中项完整可见（283 轮跟随滚动未回归）。
- Enter：打开当前选中项的笔记（标签新增 `写作示例.md`），光标跳到命中行（状态栏 `9:1`），焦点进正文。
- 鼠标点击第 4 条同样打开并跳转；Esc 清空输入后 `aria-controls` / `aria-activedescendant` 移除、结果列表卸载，与改前一致。
- 控制台无新增报错。
**人工复现**：侧栏「搜索」输入常用字 → 用 ↑/↓ 挑结果，读屏（NVDA / 讲述人）应报出「第 N 项：相对路径第 X 行 …」，回车打开；Esc 清空后不再报选中项。
**清理**：关掉测试打开的 `README.md` 标签，回到单标签 `写作示例.md`、分栏、亮色，侧栏切回「文件」，焦点在正文；窗口 1100×760；未修改笔记内容，无历史快照与恢复副本残留。
**检验计数**：3（下一轮 286 按正常需求轮）。

## 第 284 轮 · 2026-11-01 05:55
**用户需求**：场景：同时开着几篇笔记，用键盘 Tab 到中间某个非当前标签的 × 按 Enter 关掉它，或在该标签上按 Shift+F10 选「关闭标签」。现在的问题：标签消失后焦点掉回 body，下一格 Tab 从窗口最左边（侧栏开关）重算，跳过整条标签栏，只能摸鼠标点回来。期望：关闭非当前标签后焦点落在紧邻的剩余标签上（后面那枚，关最后一枚则前面），接着 Tab 能到它的 ×；关当前标签仍照旧进入正文。
**产品经理**：做。这是标签既有键盘路径的焦点脱节，不是新界面；只补落点，安静、不占空间，符合「快、安静」，不扩大产品边界，不触碰「暂不做」。
**前端**：`features/tabs/TabBar.tsx` 新增 `focusSurvivingTab(index)`：从标签条里按 `index + 1` / `index - 1` / 首枚取仍存活的标签主按钮并 `focus()`。× 的 `onClick` 在非当前标签时先移走焦点再关闭——被点的 × 会随标签一起从 DOM 消失，先移走才不掉回 body；右键 / Shift+F10 菜单的「关闭标签」因为 `ContextMenu` 卸载时会把焦点还给即将移除的标签，改为关闭完成后在 `requestAnimationFrame` 里落到相邻标签；关当前标签仍由编辑器接管焦点，不抢。风险：只动标签条内的焦点落点，鼠标点击 / 中键 / 方向键 / Home / End / 菜单位置与批量关闭都不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/tabs/TabBar.tsx`（+23 / −1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.28s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，1100×760）**：
- 改前基线：4 个标签（`写作示例.md` / `final.md` / `README.md` / `CaseTest.md`，当前 `CaseTest.md`），焦点在第二个标签的 × 上按 Enter，`final.md` 被关掉，但 `document.activeElement` 变成 `BODY`。
- 改后 × 键盘（中间）：同样路径关闭 `final.md` 后当前文档仍是 `CaseTest.md`，焦点落到右侧 `README.md` 的主按钮；再按 Tab 走到 `README.md` 的 ×（`.doc-tab-close`）。
- 改后 × 键盘（末尾）：3 个标签、当前 `README.md` 时，关掉最后那个非当前标签 `CaseTest.md` → 焦点落到左侧 `README.md`。
- 鼠标：不预置焦点直接点非当前标签 `写作示例.md` 的 × → 当前文档不变、焦点落到右侧相邻标签的主按钮。
- 菜单路径：焦点在非当前 `CaseTest.md` 主按钮上按 `Shift+F10` → Enter「关闭标签」→ 焦点落到左侧 `写作示例.md`（改前为 `BODY`），当前文档不变；在当前标签上走同一菜单关闭，仍切到邻居并聚焦正文（`cm-content`）。
- 回归：点当前标签的 × 仍正常切篇并聚焦正文；中键关闭、标签方向键 / Home / End、滚轮横向滚动与菜单位置均未改动。
- 控制台无新增报错。
**人工复现**：打开 3–4 篇笔记 → 用键盘聚焦中间某个非当前标签的 × 按 Enter（或在该标签上按 Shift+F10、Enter 选「关闭标签」）→ 标签关掉后焦点停到右侧（末尾则左侧）那枚标签上，再按 Tab 能走到它的 ×；关当前标签时仍直接回到正文。
**清理**：回到单标签 `写作示例.md`、分栏、亮色，焦点在正文；窗口 1100×760；未修改任何笔记内容，无历史快照与恢复副本残留。
**检验计数**：2（下一轮 285 按正常需求轮）。

## 第 283 轮 · 2026-11-01 05:44
**用户需求**：场景：在侧栏「搜索」里搜一个常用字，结果有几十条，于是一直按 ↓ / ↑ 在输入框里挑。现在的问题：高亮一条条往下走，走到列表可视区域之外时列表完全不跟着滚，屏幕上没有任何选中标记，只能盲选、盲按回车，得切回鼠标去滚一下才能继续看。期望：键盘上下选结果时，选中项始终留在列表可见范围内，列表跟着走；换关键词后结果重置时回到顶部。
**产品经理**：做。这是全文搜索既有键盘路径的缺陷，不是新界面；只让选中项跟随滚动，安静、不抢空间，符合「快、安静」，不扩大产品边界，不触碰「暂不做」。
**前端**：`features/workspace/SearchPanel.tsx` 给结果列表加 `listRef`，新增一个依赖 `[active, hits]` 的 effect：把 `.search-result.is-active` 用 `scrollIntoView({ block: "nearest" })` 滚进视野（与大纲面板同一做法）。键盘焦点仍留在输入框，↑↓ / Enter、鼠标悬停 / 点击、200ms 去抖搜索都不变；`block: "nearest"` 只在选中项出界时滚动，不会把已可见的条目来回推。风险：无。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/workspace/SearchPanel.tsx`（+19 / −2 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.35s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`，1100×760）**：
- 准备：侧栏切到「搜索」，输入「一」，等去抖搜索完成后显示「74 条结果」；结果列表 `scrollHeight 4652 / clientHeight 592`，确实可滚。
- 初始：选中第 0 条，`scrollTop 0`，选中项在可视区内，焦点仍在搜索输入框。
- ↓ ×16：选中第 16 条，`scrollTop 460`，选中项仍完整可见（改前会停在 0、高亮已出界）。
- 再 ↓ ×24（共 40）：选中第 40 条，`scrollTop 1978`，始终可见；焦点未离开输入框。
- ↑ ×36：回到第 4 条，`scrollTop 256`，向上也跟随，可见。
- 换关键词「在」：42 条结果，选中重置到第 0 条，`scrollTop` 回到 0，不再停在上一轮的滚动位置。
- 回归：↓ 后按 Enter 打开当前选中项，`CaseTest.md` 被打开并生成标签、焦点进入正文（`cm-content`），原有的打开并跳转路径未变。
- 控制台无新增报错。
**人工复现**：侧栏「搜索」输入一个常用字（如「一」）→ 结果多于约 14 条时，用 ↓ 一直往下选：高亮始终留在列表可见范围内、列表跟着往下滚；再一路 ↑ 回来，列表跟着往回滚；换一个关键词，列表回到顶部并从第一条开始。
**清理**：关掉测试打开的 `CaseTest.md` 标签，回到单标签 `写作示例.md`、分栏、亮色，侧栏切回「文件」、搜索面板已卸载，焦点在正文；窗口 1100×760；未修改笔记内容，无历史快照与恢复副本残留。
**检验计数**：1（下一轮 284 按正常需求轮）。

## 第 282 轮 · 2026-11-01 05:38（检验轮）
**用户需求**：检验轮，无新需求。系统性回归第 277–281 轮：窄窗口状态栏视图切换入口、标签右键菜单的键盘打开（Shift+F10 / 菜单键）、ContextMenu 的 Tab 焦点闭环、标签 ←/→ 连续切换与 Home/End、标签溢出边缘渐隐；并关联回归 272–276 的标签能力。
**产品经理**：检验轮只做回归与修复，不开新功能；发现的问题若属既有功能的粗糙处则当场修。
**前端**：回归 `app/StatusBar.tsx`、`components/Menu.tsx`、`features/tabs/TabBar.tsx`、`features/tabs/tabs.css`、`features/workspace/workspace-actions.ts`。本轮未发现功能缺陷，无源码改动。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做（检验轮回归）。
**改动**：无（仅更新 `docs/loop/backlog.md`、`docs/loop/state.md`）。
**构建**：`bun run build` 通过（含 tsc，vite 1.38s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- 277：720×800（编辑区列 480）下工具栏视图分段收起（`display: none`、无可见按钮），状态栏「分栏 ▾」常驻且不溢出；点开菜单四项齐全、当前项带 ✓，选「预览」后入口文案同步；Esc 关闭并把焦点还给入口；1600×800 下工具栏分段与状态栏入口并存，标签条 904 / 904、无横向溢出。
- 278：焦点在标签按钮时，`Shift+F10` 与菜单键都能打开与右键相同的四项菜单，首项获焦；Esc 关闭后焦点回到该标签。
- 279：标签菜单里按 Tab 关闭菜单并落到同一标签的 ×，Shift+Tab 落到左邻标签的 ×；文件树菜单按 Tab 落到下一行 `treeitem`，不再跳回窗口开头。
- 280：8 个标签下从第一个开始连按 → 依次切到第 2 / 3 / 4 篇且焦点跟随；End 到最后一篇、末尾再 → 回绕到第一篇、Home 回第一篇；鼠标点标签仍进入正文（`cm-content`），`Ctrl+Tab` 切篇后焦点仍在正文。
- 281：720 宽 8 个标签溢出（内容 904 / 可视 436）；滚到最左只剩 `is-fade-right`、中段两侧、滚到右端（`scrollLeft` 等于上限）只剩 `is-fade-left`；滚轮向下 240 后状态同步，键盘切标签时同样更新；1600 宽全部放下（904 / 904）时类名清空、`mask: none`；关到单标签后不再渐隐。
- 272–276：中键关非当前标签不切走当前文档，中键关当前标签切到左邻；右键菜单四项顺序正确、挂在 `BODY`、出现在点击位置；最左标签省略「关闭左侧标签」、最右标签省略「关闭右侧标签」；关闭左侧 / 关闭其它后活动标签符合预期；两个 `README.md` 分别显示「· 子目录」「· 根目录」；滚轮在标签条上向下 240 移动 240px、向上 400 回到 0，端头停住。
- 观察（不修）：缩窄窗口后最后一个标签自动滚进视野时 `scrollLeft` 可能停在 `max - 2`，此时确实还有 2px 内容被裁，两侧渐隐属于如实提示；滚到真正的端头后右渐隐立即消失。控制台只有 WebView 的图片懒加载 info，无报错。
**人工复现**：打开 8 篇笔记 → 拖窄到 720 → 滚到标签条最左 / 中间 / 最右，确认只有被截断的一侧渐隐；焦点放标签上按 Shift+F10 或菜单键、再用 ↓ + Enter / Esc；连按 ←/→ 与 Home/End；缩窄后点状态栏「分栏 ▾」切换四种视图。
**清理**：回到单标签 `写作示例.md`、分栏、亮色，焦点在正文；窗口恢复 1100×760；未修改笔记内容，无恢复副本与历史快照残留。
**检验计数**：0（下一轮 283 按正常需求轮）。

## 第 281 轮 · 2026-11-01 05:24
**用户需求**：场景：同时开着七八篇笔记，把窗口缩窄或打开侧栏后，标签条只露出一半标签。现在的问题：横向滚动条被隐藏、也没有任何提示，最后露出的标签被切掉一半，看不出右边还压着几篇；向左滚动之后同样不知道左边还有没有。滚轮虽然能滚，但得先想到去滚。期望：在被截断的那一侧边缘轻轻渐隐，让「这边还有标签」一眼可见；滚到端头或标签不再溢出时渐隐消失，不新增按钮、滚动条或常驻控件。
**产品经理**：做。这是标签条既有横向溢出交互的可发现性粗糙处，不是新功能；用 16px 的边缘渐隐提示，安静、不占空间，符合「安静、快」，不扩大产品边界，不触碰「暂不做」。
**前端**：`features/tabs/TabBar.tsx` 记录标签条两端是否还有被截掉的内容（`scrollLeft > 1` / `scrollWidth - clientWidth - scrollLeft > 1`），在滚动、`ResizeObserver`（开合侧栏、缩放窗口）与标签增删时更新，给 `.tab-bar` 加上 `is-fade-left` / `is-fade-right`；`features/tabs/tabs.css` 用 `mask-image` 线性渐变在被截断的一侧淡出 16px，两侧都截断时拼成一条渐变，端头无内容或不再溢出时不加类名、不产生渐隐。风险：只改标签条自身的视觉与两个状态位，点击、中键 / 右键菜单、方向键 / Home / End、滚轮横向滚动都不受影响；遮罩只作用于标签条边框盒内，菜单已挂在 body 上不受裁剪。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/tabs/TabBar.tsx`、`src/features/tabs/tabs.css`（共 +57 / −1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.35s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- 准备：打开 `CaseTest.md`、`README.md`、`final.md`、`写作示例.md`、`标题#标签.md`、`空笔记.md`、`覆盖测试.md`、`跨笔记链接.md` 共 8 个标签；窗口 720×800 时标签条 `scrollWidth 819 / clientWidth 436`，确实溢出。
- 初始（当前为最后一篇，标签条停在右端）：只有 `is-fade-left`，`mask` 为 `linear-gradient(to right, transparent, #000 16px)`；左侧第一枚可见标签轻微淡出。
- 滚到最左（`scrollLeft 0`）：只剩 `is-fade-right`，`mask` 为 `linear-gradient(to left, transparent, #000 16px)`；截图确认右端被截的标签渐隐，左端完整清晰。
- 中段（`scrollLeft 260`）：两侧都有，`mask` 为两端各 16px 的对称渐变。
- 滚到最右（`scrollLeft 383`，`scrollWidth - clientWidth - scrollLeft = 0`）：只剩 `is-fade-left`，右侧不再渐隐。
- 滚轮：在标签条上滚动 120px 后状态同步为两侧渐隐；原有横向滚动行为不变。
- 键盘 `End`：切到最后一篇并自动滚进视野后只有左渐隐。
- 1600 宽：8 个标签恰好放下（`scrollWidth 819 / clientWidth 819`、残差 0），无任何类名、`mask: none`，不出现多余渐隐。
- 关闭标签：在左端关掉最右一篇后仍按新宽度正确判断（702 / 436，两侧渐隐）；一直关到单标签后类名清空，任意宽度都不再渐隐。
- 控制台无新增报错。
**人工复现**：同时打开 8 篇笔记 → 把窗口拖窄到标签只露出几枚（或打开侧栏再拖窄）→ 右端最后一个露出的标签会轻轻渐隐；在标签条上滚轮或 `Ctrl+Tab` 继续往右 → 左端也出现渐隐、右端到头后消失；把窗口拉宽到全部放下 → 渐隐完全消失。
**清理**：回到单标签 `写作示例.md`、分栏、亮色，焦点在正文，窗口宽度恢复；未修改任何笔记内容，无历史快照与恢复副本残留。
**检验计数**：5（下一轮 282 做检验轮，回归 277–281）。

## 第 280 轮 · 2026-11-01 05:17
**用户需求**：场景：同时开着五六篇笔记，用键盘点中第一个标签，想依次往后翻。现在的问题：按 → 只切到第二篇，再按还是第二篇——焦点没跟着走，每次按键都从最初那个标签重新算一格；如果第二篇本来不是当前文档，焦点还会被编辑器接走，之后 → 变成移动光标。Home / End 也毫无反应，侧栏的「文件 / 大纲 / 搜索」早就能跳首尾。期望：←/→ 每次切到相邻一篇并让焦点停在新标签上，Home / End 直接到第一个 / 最后一个标签。
**产品经理**：做。这是既有标签键盘交互的缺陷，也是与侧栏标签页行为对齐；不新增界面、不改鼠标路径与快捷键，符合「安静、快」，不扩大产品边界。
**前端**：`features/tabs/TabBar.tsx` 的 `onKeyDown` 增加 `Home` / `End`（到首尾），←/→ 仍循环；计算目标后先 `focus()` 再调用 `openFile`，并在打开完成（结果 `opened`）后把焦点还给目标标签——`openFile` 内部的 `setEditorDocument` 会主动 `focus()` 编辑器，只调用一次 `focus()` 无法扛住。风险：只影响标签条内键盘路径；鼠标点击、Enter、Ctrl+Tab、右键菜单与关闭按钮保持原行为。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/tabs/TabBar.tsx`（+32 / −7 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.36s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- 准备：打开 `CaseTest.md`、`final.md`、`README.md`、`笔记.md`、`写作示例.md` 五个标签。
- 改前基线：焦点在第一个标签 `写作示例.md`，当前文档是第二个 `final.md`；连按 → 三次，当前文档始终停在 `final.md`、焦点仍在 `写作示例.md`；按 End / Home 焦点与当前文档均无变化。
- ←/→：焦点在第三个标签 `README.md` 时，← 落到 `final.md`（焦点与当前文档同步），再 ← 到 `CaseTest.md`，再 ← 从第一个回绕到最后的 `写作示例.md`；焦点在最后时按 → 回绕到第一个 `CaseTest.md`。
- Home / End：焦点在 `写作示例.md` 按 End 到最后一个 `笔记.md`，再按 Home 回到第一个 `写作示例.md`；焦点与当前文档始终一致。
- 回归：真实鼠标点第三个标签 → 切到 `README.md` 且焦点仍在正文（`cm-content`）；焦点在 `final.md` 标签按 Enter → 切到 `final.md` 并聚焦正文；`Ctrl+Tab` → 切到下一篇且焦点留在正文；`Shift+F10` 仍打开四项标签菜单、Esc 关闭并把焦点还给标签；点非当前标签的 × 正常关闭。
- 控制台无新增报错。
**人工复现**：同时打开 5 篇以上笔记 → 用键盘聚焦第一个标签（点一下再按 Tab 或直接用鼠标聚焦）→ 连按 →：每按一次切到下一篇，焦点也跟着停在新标签上，到末尾回绕；按 End 直接到最后一个标签、Home 回到第一个。鼠标点标签后仍会进入正文，可直接打字。
**清理**：回到单标签 `写作示例.md`、分栏、亮色，焦点在正文；未修改任何笔记内容，无历史快照与恢复副本残留。
**检验计数**：4（下一轮 281 按正常需求轮）。

## 第 279 轮 · 2026-11-01 05:08
**用户需求**：场景：键盘用户用 `Shift+F10` 叫出标签菜单，或用 Enter 打开状态栏视图菜单、文件树的右键菜单。现在的问题：菜单挂在 body 末尾，焦点在第一项时按 Tab，菜单虽然关了，焦点却绕回窗口最左边（侧栏开关按钮），跳过触发菜单的那个标签自己的 × 和后面一整排控件；Shift+Tab 同样从窗口开头重新算。期望：Tab / Shift+Tab 关闭菜单，并从触发菜单的元素按正常顺序前进 / 后退一格，焦点不脱节。
**产品经理**：做。这是共用的 `ContextMenu` 在键盘路径上的粗糙处，不是新界面；修一次，标签、状态栏视图、文件树等所有右键菜单都受益，符合「安静、快」，不扩大产品边界。
**前端**：`components/Menu.tsx` 的 `onKeyDown` 识别 `Tab`：`preventDefault` 后取触发元素（`previousFocus`）在文档焦点顺序（`a[href]`、可用按钮 / 输入、`[contenteditable]`、`tabindex >= 0`，排除菜单自身与不可见元素）中的位置，关闭菜单并把焦点移到下一项 / 上一项，末尾循环；用 `skipRestore` 标记避免卸载时又把焦点抢回触发元素。Esc、↑↓ / Home / End、鼠标点击与关闭回焦均不变。风险：共享组件，所有菜单共用同一套 Tab 规则，已逐一实测。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/components/Menu.tsx`（+36 / −1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.31s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- 准备：打开 `写作示例.md`、`README.md`、`CaseTest.md` 三个标签，当前 `CaseTest.md`。
- 改前基线：焦点在中间标签 `README.md` 上按 `Shift+F10` 打开菜单后按 Tab，菜单关闭但焦点落到窗口最左的侧栏开关 `.icon-btn`，跳过该标签的 × 与右侧所有控件。
- 改后正向：同样路径下 Tab 关闭菜单并把焦点送到该标签旁的 ×（`.doc-tab-close`）；再按 Tab 继续到下一个标签。
- 改后反向：菜单里 Shift+Tab 关闭后焦点落到左侧相邻标签的 ×，而不是窗口起点。
- 鼠标右键：真实右键中间标签打开同一菜单，Tab 同样关闭并落到该标签的 ×。
- 其它菜单：文件树右键 / `Shift+F10` 菜单按 Tab 关闭并落到下一行树项；状态栏「分栏 ▾」菜单按 Tab 关闭、焦点落到状态栏之后的下一站（末尾循环到侧栏开关）。
- 回归：菜单内 ↓ 从「关闭标签」移到「关闭左侧标签」、Esc 关闭并把焦点还给触发标签；状态栏视图菜单 ↓ + Enter 仍执行切换，鼠标点击项照旧关闭菜单。
- 控制台无新增报错。
**人工复现**：同时打开 3 篇以上笔记 → 键盘聚焦中间的标签，按 `Shift+F10` 打开菜单 → 按 Tab：菜单关闭，焦点落到这个标签的 ×（不是窗口最左边）；再打开菜单按 Shift+Tab：焦点落到左边那个标签的 ×。文件树右键菜单、窄窗口状态栏的「分栏 ▾」菜单同样适用。
**清理**：回到单标签 `写作示例.md`、分栏、亮色，焦点在正文；未修改任何笔记内容，无历史快照与恢复副本残留。
**检验计数**：3（下一轮 280 按正常需求轮）。

## 第 278 轮 · 2026-11-01 04:57
**用户需求**：场景：键盘用户用 `Ctrl+Tab` 或标签上的 ←/→ 切到某一篇，想把右侧一串或其它标签批量关掉。现在的问题：标签右键菜单只能用鼠标右键打开，焦点在标签上按 `Shift+F10` 或菜单键毫无反应；文件树早就支持这两个键，标签却只能摸鼠标。期望：焦点在任一标签上按 `Shift+F10` / 菜单键，弹出与右键完全相同、按位置收敛的菜单，↑↓ / Enter 可用，Esc 关闭并把焦点还给该标签。
**产品经理**：做。把已有的标签右键菜单补上键盘入口，与文件树的 `Shift+F10` / 菜单键行为对齐；不新增界面、不改变菜单内容与关闭逻辑，只是让同一份操作不再依赖鼠标，符合「安静、快」且不扩大产品边界。
**前端**：`features/tabs/TabBar.tsx` 的 `.doc-tab` 增加 `onKeyDown`：识别 `ContextMenu` 键与 `Shift+F10`，`preventDefault` + `stopPropagation`（避开标签条的 ←/→ 逻辑）后按该标签矩形（`left + 16`、`bottom - 4`）调用与右键相同的 `setMenu`，菜单项仍按标签位置收敛；`ContextMenu` 打开时本就聚焦首项、关闭时归还焦点。风险：无；标签的点击 / 中键 / 右键、标签条方向键与滚轮均不受影响。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/tabs/TabBar.tsx`（+18 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.34s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- 准备：重新打开 `笔记.md`、`CaseTest.md`、`跨笔记链接.md`，共 4 个标签，当前 `跨笔记链接.md`。
- 改前基线：焦点在标签上真实按 `Shift+F10`，`.context-menu` 不存在、焦点仍在标签上。
- `Shift+F10`：焦点在第 2 个标签（`笔记.md`）上按下，菜单出现于该标签下方（`x=371 / y=70`，标签 `left=355 / bottom=74`），四项「关闭标签 / 关闭左侧标签 / 关闭右侧标签 / 关闭其它标签」，焦点落在首项。
- 键盘操作：↓ 移到「关闭左侧标签」，Enter 后左侧 `写作示例.md` 关闭、其余三个标签与当前文档不变，菜单关闭并把焦点还给 `笔记.md` 标签。
- 菜单键：焦点在 `CaseTest.md` 上按 `ContextMenu`，菜单同样在标签下方（`x=347 / y=70`）打开并聚焦首项；Esc 关闭后焦点回到该标签。
- 鼠标回归：真实右键第一个标签仍按原坐标打开菜单（当前最左项只剩「关闭标签 / 关闭右侧标签 / 关闭其它标签」）；Esc 关闭、焦点归还。控制台无新增报错。
**人工复现**：同时打开 3 篇以上笔记 → 用键盘聚焦某个中间的标签（点一下标签后按 Tab 或直接用鼠标点它）→ 按 `Shift+F10` 或键盘上的菜单键 → 弹出与右键相同的菜单，↓ 选「关闭左侧标签」按 Enter → 左侧标签被关掉；按 Esc 则只关闭菜单，焦点回到该标签。
**清理**：回到单标签 `写作示例.md`、分栏、亮色，焦点在正文；未修改任何笔记内容，无历史快照与恢复副本残留。
**检验计数**：2（下一轮 279 按正常需求轮）。

## 第 277 轮 · 2026-11-01 04:47
**用户需求**：把窗口缩到 800px 以下，或者开着侧栏让编辑区变窄时，工具栏上的「源码 / 分栏 / 预览 / 所见」整块视图切换就消失了；想换个视图只能在顶部「视图」菜单里翻，或者凭记忆按 `Ctrl+E`，不看菜单根本不知道有这回事。期望窄窗口里也能看见当前是哪种视图，点一下就能换。
**产品经理**：做。这是既有视图切换的可发现性粗糙处，不是新功能；不动「暂不做」。不挤占工具栏：窄窗下工具栏已经刚好排满格式按钮，硬塞小型分段控件会把图片 / 代码块按钮挤出可视区，所以把入口放在状态栏——只显示当前模式的两个字（如「分栏 ▾」），点开是同一组四项，安静且随时可见。
**前端**：`app/StatusBar.tsx` 在右侧状态区最前加一个 `.status-view` 按钮，文案取 `VIEW_MODES` 的当前项，点击打开已有的 `ContextMenu`（经 portal 挂 body，从状态栏上方弹出），当前项带 ✓；再点一次收起，Esc 关闭并把焦点还给按钮，点别处关闭。`app/App.css` 只加按钮复位样式与 9px 弱色箭头。风险：宽窗时与工具栏的分段控件并存（状态栏作模式提示 + 快捷入口，不新增布局）；窄窗状态栏已隐藏行列 / 编码，空间足够。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/app/StatusBar.tsx`、`src/app/App.css`（共 +72 / −1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.28s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- 720×800（编辑区列 480px）：工具栏分段控件 `display: none`，状态栏入口可见、显示「分栏▾」，`title` 为「切换视图（当前：分栏 · Ctrl+E）」；状态栏与工具栏横向溢出均为 0。
- 点入口：菜单四项「源码 / ✓ 分栏 / 预览 / 所见」，挂在 body、`x=488 / y=630 / bottom=756`，落在状态栏上方且不越出 800px 视口；首项获得焦点。
- 选「预览」：`workspace-main` 变为 `mode-preview`，入口变为「预览▾」，菜单关闭；再用菜单切回「分栏」，入口同步。
- 键盘：真实鼠标点入口后焦点进菜单首项，Esc 关闭并回到「分栏」按钮（`focus-visible` 生效）；聚焦按钮按 Enter（真实按键）同样能打开菜单、Esc 收回焦点。
- 开关与外部关闭：菜单开着再点入口只关闭、不会重新打开（`mousedown` 阻止冒泡 + 点击分支处理）；点状态栏别处关闭。
- 窄窗回归：`Ctrl+E` 仍切到预览、再按回到分栏；工具栏格式按钮仍完整（未隐藏任何一项）。
- 1100px 宽窗：工具栏分段控件 `display: flex`，状态栏入口仍在并显示「分栏▾」，状态栏无溢出；同四项菜单正常。
- 控制台无新增报错；测试后回到单标签 `写作示例.md`、分栏、亮色，焦点在正文。
**人工复现**：把窗口拖窄到 800px 以下（或打开侧栏后拖窄）→ 工具栏视图切换消失，但右下角状态栏仍显示「分栏 ▾」→ 点它选「预览」→ 正文切到纯预览、状态栏文字变成「预览 ▾」；再点一次直接收起菜单；按 Esc 关闭后焦点留在该按钮。
**清理**：回到单标签 `写作示例.md`、分栏、亮色；未修改任何笔记内容，无恢复副本与历史快照；窗口尺寸恢复。
**检验计数**：1（下一轮 278 按正常需求轮）。

## 第 276 轮 · 2026-11-01 04:39（检验轮）
**用户需求**：检验轮，无新需求。系统性回归第 271–275 轮：标签滚轮横向滚动、中键关闭标签、右键菜单批量关闭（关闭右侧 / 关闭其它 / 关闭标签）、同名标签目录后缀、关闭左侧标签。
**产品经理**：检验轮只做回归与修复，不开新功能；发现的问题若属既有功能的粗糙处则当场修。
**前端**：回归 `features/tabs/TabBar.tsx`、`features/workspace/workspace-actions.ts`。发现中键关闭偶发失效：Chromium 对中键按下会启动页面自动滚动，滚动浮层吞掉随后的 `auxclick`（实测 11 个标签时连续多次中键只有 mousedown / mouseup、没有 auxclick，标签不关）。按 S 级修复：`.doc-tab` 的 `onMouseDown` 在 `button === 1` 时 `preventDefault`，从源头拦住自动滚动；`onAuxClick` 的既有逻辑不变。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做（检验轮修复）。
**改动**：`src/features/tabs/TabBar.tsx`（+6 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.33s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- 274：同时打开 11 个标签，两个 `README.md` 分别显示「· 子目录」「· 根目录」，关闭按钮 `aria-label` 为「关闭 README.md（子目录 / 根目录）」；不重名的 `写作示例.md` 无后缀、标签高度仍 28px。
- 272：中键关非当前标签标签移除、当前文档不切走；中键关当前标签切到最近邻；右键只开菜单不关标签，Esc 关闭；左键切换正常。修复前同一路径连续多次中键无 `auxclick`、标签不关；修复后连续中键每次都能关闭，且不再出现自动滚动浮标。
- 273 / 275：中间标签菜单四项顺序为「关闭标签 / 关闭左侧标签 / 关闭右侧标签 / 关闭其它标签」，菜单挂在 `BODY`、出现在点击位置；关闭右侧只留下标 0..2，当前篇在范围内时活动标签落到被右键项、不在范围内则不切走；关闭其它只剩这一篇且为当前；关闭左侧删掉左侧两篇、被右键项与右侧保留、当前文档不切走；最左 / 最右 / 单标签的菜单项按位置收敛。
- 271：720px 宽下 10 个标签溢出（条 436 / 内容 1104），滚轮向下到右端停住、向上 400px 左移 400px、`deltaX` 120 原生右移 120px；1600px 无溢出时滚轮不动。
- 合计 34 项 CDP 断言全部通过；控制台无新增报错。关闭脏标签仍走既有 `guardUnsaved` 自动落盘（不误弹窗），测试中对 `final.md` 的临时输入已还原。
**人工复现（修复点）**：同时打开 6 篇以上笔记 → 鼠标中键点一个非当前标签 → 改前偶尔不关闭、屏幕出现自动滚动光标；改后每次都能关闭且无滚动浮标；左键切换、右键菜单、× 关闭均不受影响。
**清理**：回到单标签 `写作示例.md`、分栏、亮色；`final.md` 已还原为原内容；无恢复副本与历史快照残留；窗口尺寸恢复。
**检验计数**：0（下一轮 277 按正常需求轮）。

## 第 275 轮 · 2026-11-01 04:24
**用户需求**：同时开着五六篇笔记时，右键标签菜单能把右侧一串或其它标签都关掉，却没有「关闭左侧标签」；想关掉左边一路点开的几篇参考资料，仍然只能逐个找 × 或切过去按 `Ctrl+W`。期望右键菜单左右对称。
**产品经理**：做。这是把上一轮已有的「关闭右侧 / 关闭其它」补全成左右对称的一组操作，不新增常驻界面、不改布局，复用同一套关闭逻辑（含自动保存与未保存守卫），符合「安静、快、数据安全」。
**前端**：`features/workspace/workspace-actions.ts` 新增 `closeDocumentTabsToLeft`，与 `closeDocumentTabsToRight` 对称，同样走 `closeTabsInOrder`（当前文档那篇排到最后，避免关闭当前时的自动切换被相邻标签带偏）；`features/tabs/TabBar.tsx` 右键菜单按位置补项，最左标签不显示「关闭左侧标签」，菜单顺序调整为 关闭标签 / 关闭左侧 / 关闭右侧 / 关闭其它。风险：批量关闭仍可能部分完成（某篇保存失败选取消时），与既有「关闭其它 / 右侧」一致。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/tabs/TabBar.tsx`、`src/features/workspace/workspace-actions.ts`（共 +21 / −4 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.29s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- 准备：依次打开 `写作示例.md`、`跨笔记链接.md`、`笔记.md`、`CaseTest.md`，共 4 个标签，当前 `CaseTest.md`。
- 菜单：右键 `笔记.md`（第 3 个）→ 菜单四项依次为「关闭标签 / 关闭左侧标签 / 关闭右侧标签 / 关闭其它标签」，挂在 body 下、出现在点击位置。
- 关闭左侧：选「关闭左侧标签」→ 左侧 `写作示例.md`、`跨笔记链接.md` 消失，只剩 `笔记.md` 与 `CaseTest.md`，当前文档仍是 `CaseTest.md`，菜单关闭。
- 边界：右键最左标签只剩「关闭标签 / 关闭右侧标签 / 关闭其它标签」，无「关闭左侧标签」；右键最右标签只剩「关闭标签 / 关闭左侧标签 / 关闭其它标签」，无「关闭右侧标签」；只剩一个标签时菜单只有「关闭标签」。
- 回归：原有 × / 左键切换 / 中键关闭 / 右键「关闭其它标签」正常；测试结束用「关闭其它标签」回到单标签 `写作示例.md`。
**人工复现**：同时打开 4 篇以上笔记 → 右键从右数第二个标签 → 选「关闭左侧标签」→ 它左边的标签全部关闭、它和右侧标签保留、当前文档不切走；右键最左标签时该项不出现。
**清理**：回到单标签 `写作示例.md`、分栏、亮色；未修改任何笔记内容，无历史快照与恢复副本；自动保存间隔仍为 1.8 秒。
**检验计数**：5（下一轮 276 按规则做检验轮，回归 271–275）。

## 第 274 轮 · 2026-11-01 04:14
**用户需求**：库里不同目录下有同名笔记（比如根目录和 `子目录` 下各有一个 `README.md`，或者两个项目目录下都有 `笔记.md`），同时打开后标签上只显示同一个文件名，切来切去分不清哪篇是哪篇；只能逐个悬停等完整路径浮出来。期望同名标签直接带上所在目录，一眼就能区分。
**产品经理**：做。只在重名时才补一小段目录名，不重名的标签完全不变，不新增常驻界面元素、不挤占正文，符合「安静、快」；目录只是路径的一部分，不引入私有元数据，符合「纯文本、本地优先」。
**前端**：`features/tabs/TabBar.tsx` 在渲染前统计可见标签名的出现次数；只对重名项从最近一级父目录开始向外找，取第一个足够区分的目录后缀（如 `子目录`、`docs/api`），根目录项显示「根目录」，同目录仅扩展名不同时退回带扩展名的文件名；后缀以弱色小字跟在文件名后（`README.md · 子目录`），关闭按钮的 `aria-label` 同步带上级目录，读屏也能分清。`features/tabs/tabs.css` 加 `.doc-tab-dir` 弱色 11px、可省略样式，标签高度与不重名时的宽度不变。风险：重名标签会略宽，但每项仍有 200 / 170px 上限并会省略，不影响横向滚动。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/tabs/TabBar.tsx`、`src/features/tabs/tabs.css`（共 +61 / −3 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.28s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- 准备：当前单标签 `写作示例.md`；从文件树依次打开 `子目录/README.md` 与根目录 `README.md`，共 3 个标签。
- 同名区分：两个 README 标签分别显示 `README.md · 子目录` 与 `README.md · 根目录`；`写作示例.md` 没有后缀，宽度保持 103px。
- 样式与几何：后缀 11px、弱色 `rgb(104,110,101)`，标签仍为 28px 高，标签条 31px，与改前一致。
- 无障碍：两个同名标签的关闭按钮 `aria-label` 分别为「关闭 README.md（子目录）」「关闭 README.md（根目录）」。
- 切换与关闭：点 `子目录/README.md` 标签，`aria-selected` 与编辑区同步切到该篇；依次用 × 关闭两个 README 后回到单标签 `写作示例.md`，后缀随之消失。
**人工复现**：打开 `子目录/README.md` 和根目录 `README.md` → 两个标签分别带「· 子目录」「· 根目录」；再打开一个不重名的笔记（如 `写作示例.md`）→ 它不带后缀；关掉任一同名标签后，剩下的那个恢复为普通文件名。
**清理**：回到单标签 `写作示例.md`、分栏、亮色；未修改任何笔记内容，无历史快照与恢复副本；自动保存间隔仍为 1.8 秒。
**检验计数**：4（下一轮 275 按正常需求轮）。

## 第 273 轮 · 2026-11-01 04:02
**用户需求**：同时开着五六篇笔记时，想只留下正在看的这篇，或者把某个标签右边的一串都关掉，只能在每个标签上找很小的 ×，或者逐个切过去按 `Ctrl+W`；右键点标签毫无反应。期望右键标签就能直接「关闭 / 关闭其它 / 关闭右侧」。
**产品经理**：做。右键菜单是按需出现的桌面习惯，不新增常驻界面元素、不改布局，复用已有的关闭逻辑（含自动保存与未保存守卫），符合「安静、快」与数据安全。
**前端**：`features/tabs/TabBar.tsx` 记录菜单坐标与目标标签，`.doc-tab` 的 `onContextMenu` 打开已有 `ContextMenu`，菜单经 `createPortal` 挂到 body（标签条横向滚动，菜单不跟着滚、不被裁切）；只列出有意义的项（单标签无「关闭其它标签」，最右标签无「关闭右侧标签」）。`features/workspace/workspace-actions.ts` 新增 `closeOtherDocumentTabs` / `closeDocumentTabsToRight`，批量关闭时把当前文档那篇放到最后，避免关闭当前时的自动切换被相邻标签带偏。风险：批量关闭先关其它、再关当前；若当前篇保存失败后选「取消」，其余标签已关，属可接受的部分完成。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/tabs/TabBar.tsx`、`src/features/workspace/workspace-actions.ts`（共 +92 / −2 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.33s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- 准备：打开 `写作示例.md`、`README.md`、`笔记.md`、`CaseTest.md`、`跨笔记链接.md` 共 5 个标签。
- 菜单：右键 `笔记.md`（非当前）→ 菜单出现在点击坐标 `(468,60)`、挂在 `BODY` 下，三项「关闭标签 / 关闭其它标签 / 关闭右侧标签」，焦点落在首项；右键最右标签时「关闭右侧标签」不出现，只剩一个标签时只出现「关闭标签」。
- 关闭右侧：右键 `笔记.md` 选「关闭右侧标签」→ 右侧 `CaseTest.md`、`跨笔记链接.md`（当前篇）消失，活动标签落到被右键的 `笔记.md`，编辑区同步。
- 关闭其它：右键 `README.md` 选「关闭其它标签」→ 只剩 `README.md` 且为当前，编辑区显示该篇正文。
- 关闭标签：右键 `笔记.md` 选「关闭标签」→ 该标签移除，当前 `写作示例.md` 不受影响。
- 数据安全：关闭自动保存后把当前篇改脏（输入 `TEMP274`），再从别的标签「关闭其它标签」；脏篇被排到最后，走既有 `closeDocumentTab → guardUnsaved` 先落盘再关闭，磁盘上有该标记、没有误报弹窗；随后已移除并恢复自动保存 1.8 秒。
- 回归：左键切标签、× 关闭、中键关闭与滚轮横向滚动正常；整页重载回到单标签 `写作示例.md`。
**人工复现**：同时打开 3 篇以上笔记 → 鼠标右键点任一标签 → 菜单出现；选「关闭右侧标签」关掉它右边的全部标签、选「关闭其它标签」只留这一篇；只剩一个标签时菜单只有「关闭标签」。
**清理**：回到单标签 `写作示例.md`、分栏、亮色；`TEMP273 / TEMP274` 已从测试笔记中移除，自动保存间隔已恢复 1.8 秒，无历史快照与恢复副本残留。
**检验计数**：3（下一轮 274 按正常需求轮）。

## 第 272 轮 · 2026-11-01 03:57
**用户需求**：同时开着五六篇笔记时，想关掉中间某几篇，只能先点标签切过去再按 `Ctrl+W`，或者去瞄准每个标签上那个很小的 ×；浏览器和大多数编辑器里鼠标中键点标签就能关，这里点了毫无反应。
**产品经理**：做。中键关标签是桌面端常见手势，不增加界面元素、不改变布局，也不扩大产品边界；复用现有关闭逻辑（含自动保存与未保存守卫），符合「安静、快」。
**前端**：`features/tabs/TabBar.tsx` 在 `.doc-tab` 外层挂 `onAuxClick`，只响应 `button === 1`，`preventDefault` 后调用 `closeDocumentTab(tab.path)`；左键点击、× 按钮、方向键与滚轮逻辑完全不变。风险：中键默认的自动滚动被拦掉（标签条本来也没有纵向滚动）。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/tabs/TabBar.tsx`（8 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.31s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- 准备：从文件树打开 `README.md`、`笔记.md`、`跨笔记链接.md`，连同 `写作示例.md` 共 4 个标签，当前为 `跨笔记链接.md`。
- 中键关非当前标签：在 `README.md` 标签中心发送真实 `mousePressed/Released button=middle` → 标签剩 3 个，当前文档仍是 `跨笔记链接.md`，编辑区未被切走。
- 中键关当前标签：在 `跨笔记链接.md` 上中键 → 该标签关闭，自动切到左侧 `笔记.md`，状态栏与正文同步。
- 右键对照：在 `笔记.md` 上右键（button=2）→ 标签数不变，确认只响应中键。
- 未保存内容：在 `笔记.md` 里输入 `TEMP-GUARD` 后立刻中键关标签，自动保存开启时按既有 `guardUnsaved` 路径先落盘再关闭（与 `Ctrl+W` 一致），磁盘上出现该文本；随后已还原笔记内容，工作区无 `TEMP-` 残留。
- 回归：左键点击首个标签正常切换；中键关掉多开的 `README.md` 后回到单标签 `写作示例.md`。
**人工复现**：同时打开 3 篇以上笔记 → 用鼠标中键点任意标签 → 该标签关闭，若不是当前篇则当前文档不变；对着标签右键无反应。
**清理**：恢复到单标签 `写作示例.md`、分栏、亮色；测试写入的 `TEMP-` 标记已从笔记中移除，无历史快照与恢复副本残留。
**检验计数**：2（下一轮 273 按正常需求轮）。

## 第 271 轮 · 2026-11-01 03:37
**用户需求**：开着一排笔记、窗口又变窄时，标签会横向溢出，两侧被截掉；鼠标滚轮停在标签条上毫无反应，只能靠 `Ctrl+Tab` 一篇篇试，或者先关掉当前篇。
**产品经理**：做。标签栏本来就是横向滚动容器，只是隐藏了滚动条；把纵向滚轮映射成横向滚动，不改变布局与产品边界，属于真实使用流里的卡点，也符合「安静」。
**前端**：`features/tabs/TabBar.tsx` 在标签条上挂原生非被动 `wheel` 监听：仅当 `scrollWidth > clientWidth` 且纵向增量占主导时拦截并调整 `scrollLeft`，按 `deltaMode` 换算行 / 页；触控板横向滑动与无溢出时保持原生行为。风险：标签条上的滚轮不再冒泡，但该区域本来就没有纵向滚动。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/tabs/TabBar.tsx`（22 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.37s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- 准备：打开 10 篇标签，窗口缩到 720 宽，标签条 `clientWidth=436 / scrollWidth=993`。
- 改前复现：在标签条中心发送真实 `mouseWheel deltaY=240`，`scrollLeft` 从 555 到 555，纹丝不动。
- 改后：先滚到 `scrollLeft=157`，向下 240 → 397；向上 -400 → 157；两端 0 / 557 自然停住，不越界。
- 触控板横向：`scrollLeft=0` 时发 `deltaX=200, deltaY=0` → 200，原生横向滚动未被拦截。
- 无溢出：窗口 1600 宽（标签条 `clientWidth=993`）时向下滚 240，`scrollLeft` 保持 0。
- 回归：整页重载恢复 10 个标签；聚焦首个标签按 `→` 切到第二篇（`aria-selected` 移到索引 1，焦点仍按原逻辑落到正文）；逐个关闭多余标签回到单标签 `写作示例.md`。
**清理**：窗口恢复 1100×760、位置 (738,317)，单标签 `写作示例.md`、分栏、亮色；未修改笔记内容，无历史快照与恢复副本。
**检验计数**：1（下一轮 272 按正常需求轮）。

## 第 270 轮 · 2026-11-01 02:49（检验轮）
**回归范围**：266 文字菜单栏、267 标签行独立成行、268 标签行与工具栏收进编辑区列、269 标签条宽度变化时滚到当前标签。
**构建**：`bun run build` 通过（含 tsc，vite 1.22s）；本窗口未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（整页重载后，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- 菜单栏：六个顶层项依次位于 152 / 191 / 230 / 269 / 308 / 347，宽 38、`role=menuitem`，容器 `aria-label=应用菜单`；文件 9 项、编辑 4 项（1 分隔线）、段落 15 项、格式 5 项、视图 8 项（1 分隔线）、应用 2 项，每个面板左缘与触发器对齐。
- 菜单键盘：顶层 `↓` 打开并把焦点放到首项；`→` 切到「编辑」；`Esc` 关闭且焦点回到顶层按钮。鼠标点击同一按钮收起、点外部关闭（上一轮已验，本轮抽查通过）。
- 菜单执行：视图 → 源码 / 预览 / 分栏，`.workspace-main` 依次变为 `mode-source` / `mode-preview` / `mode-split`；菜单每次只关一次。
- 命令面板：`Ctrl+Shift+P` 打开，分组为 文件 / 段落 / 格式 / 导航 / 视图 / 查找 / 应用，共 43 条命令。
- 标签行：侧栏展开时从 240 开始；关到 0 个标签后重新打开 6 篇，标签条 248–850、`+` 854–878；`←` 在标签间切换、`Ctrl+Tab` 切换、`Ctrl+W` 关闭均正常。
- 窄窗 720：标签条 `scrollLeft=164` 且当前标签完整可见；`+` 未越界；工具栏 0 个按钮越出右缘（视图切换按容器查询隐藏）；页面无横向滚动。
- 专注模式：标签行与工具栏收起、标题栏中部显示文档名，退出后标签恢复；`Ctrl+\` 分屏在主列内打开、工具栏仍止于 720。
- 侧栏：`Ctrl+B` 收起后标签行左缘变 0、宽度满窗；再按恢复 240。
- 主题：临时切到 `data-theme=dark` 读取，菜单底 `#1a1e1d`、菜单项文字 `#e7e8e2`、当前标签 `#151817` 与标签行 `#1a1e1d` 有可见层次；读取后切回亮色。
- 控制台：仅 3 条 404，全部是测试库里 `子目录/assets/示意图.png`、`小图.png`、`坏图.png` 不存在（示例笔记自带的占位图片），与本窗口改动无关。
**结论**：266–269 未发现功能缺陷，无需修代码；只把 `tabs.css` 里两处仍写着「嵌在标题栏」的注释改成「标题栏下方的独立一行」。检验计数清零。
**本轮改动**：`src/features/tabs/tabs.css`（仅注释 2 行）。
**清理**：测试标签全部关回单标签 `写作示例.md`（未保存状态为否、分栏视图、亮色主题）；未修改任何笔记内容；无历史快照与恢复副本。
**检验计数**：0。

## 第 269 轮 · 2026-11-01 02:40
**用户需求**：把「窗口变窄后当前标签滚进视野」补上。
**产品经理**：做。第 268 轮把标签行收窄到编辑区后，标签更容易被推出视野；切标签时有滚动，但缩放窗口 / 开合侧栏没有。复查发现 `TabBar` 里其实已有 `ResizeObserver`，只是挂载时若一个标签都没有（`TabBar` 渲染为 `null`），观察器会因拿不到节点而永远缺席，之后标签重新打开也不再补挂——这才是「有时不滚」的根因。
**前端**：`features/tabs/TabBar.tsx` 把观察器 effect 的依赖从 `[]` 改为 `[hasTabs]`，标签从零开回来时重新挂载观察器，并补注释说明这个空列表坑；滚动行为、方向键与点击逻辑不变。风险：标签开合会重建一次观察器，成本可忽略。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/tabs/TabBar.tsx`（6 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.18s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（改后）**：工作区 `D:\clawWorkSpeace\新建文件夹`，整页重载。
- 复现路径：逐个关闭到 0 个标签（标签条消失）→ 从文件树重新打开 6 篇 → 窗口从 2560 缩到 720。改后 `scrollLeft=164`，当前标签 `569–684` 落在标签条 `248–684` 内，完整可见。
- 对照路径：8 个标签、当前为最后一篇，2560 → 720 后 `scrollLeft=369`，当前标签贴住右缘（`593–684`），未被裁切。
- 侧栏开合（`Ctrl+B`）改变标签条宽度时同样会滚到当前标签；恢复宽窗后 `scrollLeft` 回到 0。
- 截图确认 720px 下标签条停在右侧、当前标签 `跨笔记链接.md` 完整显示，`+` 仍在行内。
**遗留 / 观察**：用户手动横向滚动标签条后再缩放窗口，位置会按「当前标签可见」重新校正，这是预期行为。
**清理**：测试中关闭又重开的标签已收回到单标签 `写作示例.md`、未保存状态为否；未修改任何笔记内容，无历史快照与恢复副本。
**检验计数**：8（下一轮 270 建议做检验轮，回归 266–269 的菜单栏、标签行与工具栏列布局）。

## 第 268 轮 · 2026-11-01 02:37
**用户需求**：标签行不要横跨整窗，只占编辑区宽度（侧栏保持原高度）。
**产品经理**：做。标签属于「文档」，让它与编辑器左缘对齐，侧栏从标题栏下方开始占满整列更符合层级；顺手把工具栏也移进同一列，否则工具栏横跨侧栏、标签又缩在编辑区，会像两层错位的带子。
**前端**：`app/App.tsx` 把 `.tab-strip`、`Toolbar`、`.main-row`（正文 + 分屏）一起放进新的 `.main-column`，`.app-body` 仍是「侧栏 + 主列」；`app/App.css` 网格恢复三行（标题栏 / 主体 / 状态栏），新增 `.main-column`（纵向 flex、`container-type: inline-size`），`.toolbar` 与 `.tab-strip` 加 `flex: none`。工具栏宽度从窗口宽度变成列宽，原有按窗口宽度的媒体查询会失效，新增容器查询：列宽 ≤800px 时收起工具栏右侧的视图切换（改由标题栏「视图」菜单提供）。风险：侧栏展开时工具栏可用宽度减少约 240px；标签行多标签时横向滚动。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/app/App.tsx`、`src/app/App.css`，共 2 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.15–1.19s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（改后）**：工作区 `D:\clawWorkSpeace\新建文件夹`，整页重载后测量。
- 几何：侧栏 0–240（`top=44`，整列高 1324）、`main-column` 240–2560、标签行 240–2560（`top=44`、高 32）、工具栏 240–2560（`top=76`、高 36）、正文从 112 开始；标签左缘 250，与编辑区左缘对齐。
- 宽度 1440 / 1100 / 980 / 880 / 760 / 720（侧栏展开）：工具栏 `scrollWidth == clientWidth`，无任何按钮越出右缘；≤800px 列宽时视图切换隐藏，其余按钮与右侧空白正常；页面无横向溢出。
- 多标签：7 个标签时标签条在列内滚动（scrollWidth 714 > clientWidth 436），`+` 固定在 688–712px；720px 下同样可见。
- 侧栏开合：`Ctrl+B` 收起后标签行左缘变为 0、宽度 2560；再按一次恢复 240 左缘。
- 分屏：`Ctrl+\` 打开后 `.split-pane` 1632–2560 仍在主列右侧，工具栏继续横跨主列，关闭后复原。
- 专注模式：标签行与工具栏一起收起、标题栏中部显示文档名；退出后 7 个标签原样回来。
**遗留 / 观察**：视图切换在列宽 ≤800px 时只能从「视图」菜单或 `Ctrl+E` 进入；如果之后觉得这个阈值太早，可按具体按钮宽度再调。窗口从宽拖到窄时，当前标签不会自动滚进可见区（沿用 `active` 变化才滚动，非本轮引入），可另立一轮处理。
**清理**：测试中多开的 6 个标签已全部关闭，回到单标签 `写作示例.md`、未保存状态为否、焦点在正文；未修改任何笔记内容，无历史快照与恢复副本。
**检验计数**：7（下一轮 269 为检验轮）。

## 第 267 轮 · 2026-11-01 02:33
**用户需求**：文字菜单栏很好，但文档标签挤在标题栏右侧看着别扭，觉得标签放到下面一行更合适。
**产品经理**：做。标题栏现在要同时容纳「应用菜单 + 文档标签 + 窗口控制」，三者的层级不同：菜单与窗口控制属于窗口外壳，标签属于当前文档。把标签移到标题栏下方的独立一行，标题栏只留菜单与窗口控制，标签也能用满整行宽度；格式工具栏继续在标签下方，层级变成「窗口 → 文档 → 正文」。
**前端**：`app/App.tsx` 在 `TitleBar` 之后渲染 `.tab-strip`（`TabBar` + `+`，有工作区且非专注模式时显示），`+` 从标题栏移到这里；`app/TitleBar.tsx` 删除标签与 `+`，中部只保留专注模式的文档名；`app/App.css` 网格行增加一行 `auto`，新增 `.tab-strip`（32px、`--bg-elevated`、底部发丝线、内容可横向滚动）。`tabs.css` 的标签样式与滚动条隐藏沿用不变。风险：纵向 chrome 增加 32px，侧栏与正文下移；标签行横跨整窗宽度（不只覆盖编辑区），多标签时横向滚动、`+` 始终可见。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/app/App.tsx`、`src/app/TitleBar.tsx`、`src/app/App.css`，共 3 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.57s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（改后）**：工作区 `D:\clawWorkSpeace\新建文件夹`，整页重载后测量。
- 几何：标题栏 44px、标签行 32px（`top=44`）、工具栏 36px（`top=76`）、侧栏从 112px 开始；标签 28px 居中，`+` 在标签之后。
- 多标签（6 个 / 8 个）：标签行左起排开，标签超出时 `.tab-bar` 自身横向滚动（scrollWidth 795 > clientWidth 676），`+` 仍在行内可见；`←` 键切到相邻标签、`Ctrl+W` 关闭、`Ctrl+Tab` 均正常。
- 专注模式：标签行与工具栏一起收起，标题栏中部显示当前文档名，退出后标签行与 6 个标签原样回来。
- 宽度 1440 / 980 / 760 / 720：标签行始终占满宽度，无横向溢出，窗口控制与菜单栏不受影响；720px 下 8 个标签仍可横向滚动，`+` 位于 688–712px。
- 截图确认：标题栏只留「☰ 扉 新建文件夹 ▾ 文件 编辑 段落 格式 视图 应用」与窗口控制，标签与新建按钮在下一行。
**遗留 / 观察**：标签行横跨整窗，侧栏顶部也让出 32px；若之后觉得标签离正文太远，可再评估让标签行只占编辑区宽度或与工具栏合并。本轮是用户直接提出的需求，检验计数顺延到 6，下一轮 268 仍为检验轮。
**清理**：测试中打开的额外 7 个标签已全部关闭，回到单标签 `写作示例.md`、未保存状态为否、焦点在正文；未修改任何笔记内容，无历史快照与恢复副本。
**检验计数**：6（下一轮 268 为检验轮）。

## 第 266 轮 · 2026-11-01 02:26
**用户需求**：标题栏里那个很小的 ⋯ 根本看不见，「不仔细看一点都不知道」；希望做成 Typora 那样直接写着「文件 / 编辑 / 段落…」的菜单栏。
**产品经理**：做。⋯ 的问题不是位置而是不可发现——没有文字标签、没有悬停提示就没人会点。改用常驻文字菜单：顶层只列 6 组（文件 / 编辑 / 段落 / 格式 / 视图 / 应用），下拉里再按需分组；所有动作仍来自同一份命令注册表，命令面板与菜单不会漂移。本轮比常规 S 级大，属用户明确指定的界面结构调整，仍在单轮内完成。
**前端**：新增 `app/MenuBar.tsx`、`app/MenuBar.css`（六个 `role=menuitem` 按钮 + 单个下拉，悬停 / ←→ 切换、↓ 打开）；`app/AppMenu.tsx` 增加 `groups`、`showGroupLabels`、`onSwitchMenu`、`label` 参数，单选组内 ←→ 优先于切换顶层菜单；`app/TitleBar.tsx` 用 `<MenuBar />` 取代 ⋯ 按钮并删除菜单状态与锚点 ref；`app/App.css` 删除 `.app-menu-trigger`；`features/commands/commands.ts` 新增 `edit / paragraph / format` 分组与撤销重做、标题 0–6、引用、三种列表、代码块、公式、表格、分隔线、加粗 / 斜体 / 删除线 / 行内代码 / 链接（复用工具栏同一批 formatting 函数，`CommandContext` 增加 `canUndo / canRedo`、`CommandNeed` 增加 `editable`）；`CommandPalette.tsx` 补上新分组名称。风险：左区宽度增加约 233px，窄窗标签可用宽度减少；段落菜单高 432px，低窗口依赖 `maxHeight` 滚动。工作量 L。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/app/MenuBar.tsx`（新）、`src/app/MenuBar.css`（新）、`src/app/AppMenu.tsx`、`src/app/TitleBar.tsx`、`src/app/App.css`、`src/features/commands/commands.ts`、`src/features/commands/CommandPalette.tsx`，共 7 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.24s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（改后）**：工作区 `D:\clawWorkSpeace\新建文件夹`，标签 `写作示例.md`；整页重载后测量。
- 六个文字菜单 `left` 152/191/230/269/308/347，宽 38、高 24，`titlebar-left` 右缘 387；窗口 1440 / 980 / 880 / 760 / 720 下均完整可见（项宽 38 → 34 → 30），标签区未被撑破、文档无横向滚动条，窗口控制仍在最右。
- 逐项打开：文件 9 项、编辑 4 项（1 条分隔线，撤销 / 重做在无修改时禁用）、段落 15 项、格式 5 项、视图 8 项（1 条分隔线，含导航两条与四个视图单选）、应用 2 项；面板均 `left` = 触发器 `left`、`top=38`、宽 236，未溢出。
- 键盘：顶层 `↓` 打开并把焦点放到首项；打开后 `→` 切到相邻菜单、`←` 反向；`Esc` 关闭且焦点回到顶层按钮；首项聚焦时 `←/→` 在顶层按钮间移动。
- 鼠标：打开一个菜单后悬停相邻顶层项即切换；点同一个按钮收起；点正文关闭。
- 真实命令：在临时笔记里输入「菜单测试」并全选，经「格式 → 加粗」得到 `**菜单测试**`、经「段落 → 标题 1」得到 `# **菜单测试**`，菜单只关一次、焦点回到 `.cm-content`，随后「编辑」菜单的撤销变为可用；视图菜单切「源码 / 分栏」生效。
- 命令面板：`Ctrl+Shift+P` 打开后出现 文件 / 段落 / 格式 / 导航 / 视图 / 查找 / 应用 分组，共 43 条可用命令，过滤与 ↑↓/Enter 未变。
**遗留 / 观察**：菜单栏占左区 233px，标签多时可用宽度相应变少；若以后觉得挤，可把「应用」并进「文件」或在窄窗收起部分顶层项。临时笔记 `菜单栏测试.md` 测完已删除，无历史快照与恢复副本残留。
**清理**：临时笔记与残留文件已删除；无多余标签；主题为亮色；菜单已关闭，应用停在单标签 `写作示例.md`、侧栏「文件」、分栏视图。
**检验计数**：5（下一轮 267 为检验轮）。

## 第 265 轮 · 2026-11-01 02:13
**用户需求**：把右上角的 ⋯ 移到左边试试，看看是否更像应用菜单。
**产品经理**：做。⋯ 是全局菜单，放在库名之后、标签之前，语义上更接近「当前应用 / 工作区的操作入口」；右侧只留窗口控制，减少把菜单误认成第四个窗口按钮。左侧已有侧栏开关、印章与库名，⋯ 只占 26px，仍在可接受范围。
**前端**：`app/TitleBar.tsx` 把 `.app-menu-trigger` 从 `.titlebar-right` 移到 `.titlebar-left` 的库名之后，锚点 ref 与菜单状态不变；`app/AppMenu.tsx` 按触发器所在半区选择对齐方式——左半区左对齐、右半区仍右对齐，并继续夹在窗口内；`app/App.css` 删除 `.titlebar-right` 已无意义的 8px 间距。风险：左区宽度增加约 32px，标签可用宽度相应减少；菜单在左侧打开时会覆盖侧栏顶部，属正常下拉行为。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/app/TitleBar.tsx`、`src/app/AppMenu.tsx`、`src/app/App.css`，共 3 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.14s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（改后）**：工作区 `D:\clawWorkSpeace\新建文件夹`，单标签 `写作示例.md`。
- 触发器位于左侧库名之后：`left=150`、右缘 176，`titlebar-left` 宽 170px；窗口控制仍在右端（`left=2422`），右侧不再有 ⋯。
- 打开菜单：`left=150`、`top=39`、宽 236、高 729，与触发器左对齐，未溢出窗口；Esc 关闭后 `aria-expanded=false`，焦点回到 `.app-menu-trigger`。
- 截图确认菜单从左侧 ⋯ 下方展开、覆盖侧栏顶部；关闭后左区为「☰ 扉 新建文件夹 ⌄ ⋯」，标签紧随其后。
- 观察：HMR 热替换后第一次打开菜单，`anchor` 曾为空并回退到右侧（`left=2316`）；整页重载后稳定在 `left=150`。这是开发态 ref 热替换现象，不是代码逻辑问题，后续验证以重载为准。
**遗留 / 观察**：菜单在左侧打开会遮住侧栏内容，属于下拉菜单的常规行为；若之后觉得左区拥挤，可再评估把 ⋯ 放回右侧或收进标签区。
**清理**：未打开或修改任何笔记；无历史快照与恢复副本；主题为亮色；菜单已关闭，应用停在单标签 `写作示例.md`、侧栏「文件」。
**检验计数**：4（下一轮 266 按正常需求轮）。

## 第 264 轮 · 2026-11-01 02:11
**用户需求**：右上角的 ⋯ 菜单紧挨着最小化按钮，看起来像第四个窗口按钮，问这样是否合适。
**产品经理**：位置本身合适——桌面应用常把应用菜单放在窗口控制左侧（VS Code 的 More Actions 也在这里）；问题是无间隔导致语义混淆。保留位置，拉开间距；不把 ⋯ 移到左侧，避免刚精简过的品牌 / 库名区域重新变挤。
**前端**：`app/App.css` 的 `.titlebar-right` 间距 `gap: 2px` → `8px`，只影响 ⋯ 与窗口控制之间；不新增分隔线、不改按钮尺寸与顺序。风险：右区宽 6px，标签区少 6px 可用宽度；窄窗仍有 92px 库名上限兜底。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/app/App.css`（1 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.19s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（改后）**：工作区 `D:\clawWorkSpeace\新建文件夹`，单标签 `写作示例.md`。
- ⋯ 右边缘 2414px、窗口控制左边缘 2422px，间距 8px（改前 2px）；⋯ 仍为 26×26、垂直居中，窗口控制宽度 138px 不变。
- 截图确认 ⋯ 与最小化之间出现明确空白，不再像连在一起的四个窗口按钮；标签、`+`、库名入口与左区宽度未变。
**遗留 / 观察**：若之后仍觉得 ⋯ 孤独或更像窗口按钮，可再评估移到左侧库名旁；本轮不扩大改动。
**清理**：未打开或修改任何笔记；无历史快照与恢复副本；主题为亮色；应用停在单标签 `写作示例.md`、侧栏「文件」。
**检验计数**：3（下一轮 265 按正常需求轮）。

## 第 263 轮 · 2026-11-01 02:08
**用户需求**：标题栏左侧「扉 扉页 / 新建文件夹 ▾」看起来有点奇怪——品牌名与印章重复，斜杠又像一条并不存在的目录层级，希望更安静、更像一个整体。
**产品经理**：做。印章「扉」已经承担应用标识，库名是标题栏左侧真正有用的上下文；去掉重复的「扉页」文字和斜杠，只保留「印章 + 库名 + 箭头」，不再制造假面包屑。
**前端**：`app/TitleBar.tsx` 删除 `brand-name` 与 `brand-divider` 两个节点；`app/App.css` 删除对应规则及 ≤760px 的隐藏规则。库名按钮、最近工作区菜单、焦点与无障碍属性均未改。风险：左侧宽度由约 176px 缩到约 138px，标签获得更多空间；窄窗规则少两条，已由固定库名最大宽度兜住。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/app/TitleBar.tsx`（−7/+2）、`src/app/App.css`（−18），共 2 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.18s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（改后）**：工作区 `D:\clawWorkSpeace\新建文件夹`，单标签 `写作示例.md`。
- DOM 中 `.brand-name` / `.brand-divider` 均为 `false`，印章仍为「扉」，库名仍为「新建文件夹」；`.titlebar-left` 宽 137.7px，首个标签从 153.7px 开始，较改前左移，标签区更宽。
- 截图确认左侧为「☰ 扉 新建文件夹 ▾」，不再有「扉页 /」；库名按钮的 `aria-haspopup`、`aria-expanded` 与点击逻辑未动，标签、`+`、窗口控制无位移。
- 窄窗不再需要单独隐藏品牌名 / 斜杠，≤760px 只保留库名 92px 上限。
**遗留 / 观察**：无。若以后想在标题栏重新露出完整品牌名，可放到欢迎页或关于页，不再塞回标签旁。
**清理**：未打开或修改任何笔记；无历史快照与恢复副本；主题为亮色；应用停在单标签 `写作示例.md`、侧栏「文件」。
**检验计数**：2（下一轮 264 按正常需求轮）。

## 第 262 轮 · 2026-11-01 01:48
**用户需求**：当前标签下面那条彩色装饰线很有「AI 生成」的味道，不想要这种下划线；选中状态安静一点。
**产品经理**：做。当前标签已经同时用纸色底与正文文字色区分，彩色下划线是额外装饰；去掉它符合「安静、克制」，不改变标签切换与关闭行为。
**前端**：`features/tabs/tabs.css` 删除 `.doc-tab.is-active` 的 `inset 0 -2px 0 var(--accent)`，保留 `--bg` 底与 `--text` 文字色；不新增边框、阴影或动画。风险：亮 / 暗主题下选中态对比略降，靠底色与文字色区分；标签宽度、悬停与关闭按钮不变。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/tabs/tabs.css`（−1 行 box-shadow，+2 行注释）。
**构建**：`bun run build` 通过（含 tsc，vite 1.28s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（改后）**：工作区 `D:\clawWorkSpeace\新建文件夹`，单标签 `写作示例.md`。
- 选中标签 computed `box-shadow` 为 `none`，不再有底部彩色线；亮色 `background` `rgb(245,245,241)`、文字 `rgb(26,27,24)`，标题栏 `rgb(250,250,247)`，仍靠底色与文字色区分。
- 临时切到暗色核对：选中标签 `rgb(21,24,23)`、标题栏 `rgb(26,30,29)`、文字 `rgb(231,232,226)`，无下划线或残余阴影；随后切回亮色。
- 标签切换、悬停、`×` 关闭与脏点显示未改动；截图确认标题栏、工具栏、侧栏与状态栏无位移。
**遗留 / 观察**：无。若后续觉得选中态太弱，可再评估中性描边或字重，但不恢复彩色下划线。
**清理**：未打开或修改任何笔记；无历史快照与恢复副本；主题已回亮色；应用停在单标签 `写作示例.md`、侧栏「文件」。
**检验计数**：1（下一轮 263 按正常需求轮）。

## 第 261 轮（检验轮）· 2026-11-01 01:44
**用户需求**：检验轮，不开新功能；系统性回归第 256–260 轮这批标题栏、⋯ 菜单、工具栏与命令面板的 UI 改动，必要时修回归。
**产品经理**：检验轮，不涉及产品边界。
**前端**：回归范围 `TitleBar.tsx` / `AppMenu.tsx` / `Toolbar.tsx` / `CommandPalette.tsx` 与对应 CSS；本轮未改源码。
**后端**：无（未改 `src-tauri/`）。
**裁决**：检验（不新增需求）。
**改动**：无。
**构建**：`bun run build` 通过（含 tsc，vite 1.11s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（回归）**：工作区 `D:\clawWorkSpeace\新建文件夹`，单标签 `写作示例.md`，用 `Emulation.setDeviceMetricsOverride` 量宽高。
- 第 256 轮：合并入口为 80×24 按钮，`aria-label` 为「当前工作区：新建文件夹，切换最近工作区」，库名与箭头同属一个 Tab 停靠点。临时向设置塞入一条最近工作区（测试后已还原）后点击：菜单展开、`aria-expanded=true`、锚点 y = 按钮底部 +4，Esc 关闭后 `aria-expanded=false`、焦点回到按钮；无其它最近工作区时点击回退到文件夹选择框（测试后关闭）。长库名在 1440 下截到 200px、704 下缩到 92px，均出省略号，13px 箭头完整可见，页面无横向溢出。
- 第 257 轮：5 个分组标题「文件 / 导航 / 视图 / 查找 / 应用」，`.app-menu-sep` 为 0，整菜单 729px；1392×800 与 760×800 下 `maxHeight` 753px、`scrollHeight-clientHeight=0`、无横向溢出；↓×3 / End / Home 只在 21 个菜单项间移动、跳过标题；5 个 `role=group` 的 `aria-label` 正确，标题均为 `aria-hidden`。
- 第 258 轮：焦点在「源码」按 → 依次「分栏 → 预览 → 所见即所得 → 源码 → 分栏」，← 回到「源码」；全程勾选保持「分栏」；在「新建笔记」等非单选项上 ←/→ 不动焦点。
- 第 259 轮：4 条分隔线均为 18px，亮色 `rgb(195,198,188)`、暗色 `rgb(59,67,63)`（均为 `--line-strong`）；760 / 704 / 680 下 `toolbar-sep-zen` 为 `display:none`，工具栏与页面均无横向溢出。
- 第 260 轮：面板 22 条命令，标题「文件 / 视图 / 查找 / 应用」（当前无浏览历史，「导航」不出现，符合只列可用命令）；标题 10.5px、`rgb(104,110,101)`、首组 `2px 10px` / 其余 `8px 10px 2px`；↓×4 依次落在「打开文件夹… / 保存 / 另存为… / 重命名当前笔记…」；过滤「导出」只剩「文件」标题与「导出 HTML… / 导出 PDF…」；回车执行「视图：分栏」后工具栏 `aria-pressed` 切到分栏，再打开面板 Esc 关闭且焦点回到 `.cm-content`。
- 主题：亮色下分隔线与菜单标题对比正常；暗色下分隔线 `rgb(59,67,63)`、标题 `rgb(124,131,122)`、菜单底 `rgb(26,30,29)`、菜单项 `rgb(231,232,226)`，可读性正常，测后已切回亮色。
**遗留 / 观察**：命令面板与 ⋯ 菜单仍各存一份分组文案（260 轮已记录），后续加组需两处同步。无产品缺陷，未改源码。
**清理**：测试临时写入的 `recentWorkspaces` 已还原；两次误开的原生文件夹选择框已关闭；未打开或修改任何笔记；临时 CDP 脚本已删；主题回亮色、无浮层，应用停在单标签 `写作示例.md`、侧栏「文件」。
**检验计数**：0（下一轮 262 按正常需求轮）。

## 第 260 轮 · 2026-11-01 01:40
**用户需求**：我按 Ctrl+Shift+P 打开命令面板，二十多条命令平铺成一列，「导出 PDF」「视图：分栏」「偏好设置」混在一起，只能逐行扫。⋯ 菜单里已经有「文件 / 导航 / 视图 / 查找 / 应用」的小标题，命令面板却还是老样子。期望：面板里也按同样分组加轻量标题，搜索过滤后只显示命中的组，键盘 ↑↓ 与回车行为不变。
**产品经理**：做。只把 ⋯ 菜单已有的分组标题复用到命令面板，不新增命令、不改执行逻辑，属于同一套信息架构的补齐；保持安静的小字标题，不引入边框或折叠。
**前端**：`features/commands/CommandPalette.tsx` 在渲染过滤结果时，遇到分组变化插入一枚 `aria-hidden` 的 `palette-group` 标题（标签与 `AppMenu.tsx` 的 GROUPS 同顺序、同文案）；键盘索引仍基于扁平的 `filtered`，标题不参与 ↑↓ / Enter。`features/commands/commands.css` 补标题样式（10.5px、`--text-faint`、字距），选择器写成 `.palette-list li.palette-group` 以压过列表项清零的 padding。风险：列表本来就会滚动，标题小幅增加滚动高度；过滤后同一组不会重复出现（原顺序保持连续）。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/commands/CommandPalette.tsx`（+15/−2）、`src/features/commands/commands.css`（+12），共 2 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.09s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（改后）**：工作区 `D:\clawWorkSpeace\新建文件夹`，Ctrl+Shift+P 打开面板。
- 未搜索时 22 条命令，分组标题依次「文件 / 视图 / 查找 / 应用」（当前无浏览历史，「导航」两条命令被过滤所以不出现，与面板只列可用命令一致）；标题 `padding` 为 `2px 10px`（首组）/ `8px 10px 2px`（其余），与菜单标题同为 10.5px 弱色小字。
- 键盘：焦点在「新建笔记」，↓ ×3 依次到「打开文件夹… / 保存 / 另存为…」，标题不参与；回车仍执行当前项（过滤「偏好设置」后回车打开设置面板，Esc 关闭并把焦点还给正文）。
- 过滤：输入「导出」只剩「文件」一个标题与「导出 HTML… / 导出 PDF…」两条；输入「视图」只剩「视图」标题与四个视图项。
**遗留 / 观察**：命令面板与 ⋯ 菜单各自维护一份分组文案（菜单在 `AppMenu.tsx` 的 GROUPS、面板在本轮新增的 `GROUP_LABELS`），本轮为避免多改文件未抽出共享常量；若后续新增分组，两处需同步。
**清理**：未打开或修改任何笔记；无历史快照与恢复副本；临时 CDP 脚本已删；面板已关闭，应用停在单标签 `写作示例.md`、侧栏「文件」。
**检验计数**：5（下一轮 261 按检验轮执行）。

## 第 259 轮 · 2026-11-01 01:35
**用户需求**：工具栏一排图标扫过去像连成一片——组间的竖线太淡，几乎和底色融在一起，分不清「撤销 / 行内格式 / 段落 / 插入」；窄窗下专注按钮收起后，视图切换右边还悬着一条短线。期望：分组一眼可辨，窄窗别留悬空线，也不挤压按钮。
**产品经理**：做。实测工具栏本来就有 4 条 1px `--line` 分隔线，问题不是缺线而是对比度太低；只把现有分组线调清晰一档，并让最后一条随专注按钮一起收起，不新增元素、不改布局，符合「安静、快」。
**前端**：`app/App.css` 把 `.toolbar-sep` 从 `--line` 改为 `--line-strong`、高 16 → 18px；`@media (max-width: 760px)` 隐藏 `.toolbar-sep-zen`。`app/Toolbar.tsx` 给专注按钮前的分隔线加 `toolbar-sep-zen` 类。风险：色阶只强一档，亮 / 暗主题仍属弱色；1px 宽度与 7/5/4px 外边距未变，不挤占按钮。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/app/App.css`（+6/−3）、`src/app/Toolbar.tsx`（+1/−1），共 2 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.11s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（改后）**：工作区 `D:\clawWorkSpeace\新建文件夹`，用设备模拟量 1440 / 760 / 680 三种宽度。
- 1440：4 条分隔线 `display:block`、高 18px、`rgb(195,198,188)`（改前 16px / `rgb(220,221,213)`），四组起点 x = 10 / 88 / 249 / 445 与改前完全一致，无按钮位移；截图确认四段分组一眼可辨。
- 760：专注按钮收起时最后一条 `toolbar-sep-zen` 为 `display:none`，视图切换右侧不再有悬空线（截图确认），`scrollWidth - clientWidth = 0`，视图切换 580 → 752、右侧仍留 8px。
- 680：工具栏仍无溢出（overflow 0），三条分组线保留，p2 / p3 / 专注按钮按原断点收起。
**遗留 / 观察**：暗色主题下分隔线同步使用 `--line-strong`（`#3b433f`），未单独截图；如需更明显可再用 `--line-strong` + 20px 高度评估。
**清理**：未打开或修改任何笔记；无历史快照与恢复副本；临时 CDP 脚本与截图已删；设备模拟已清除，应用停在单标签 `写作示例.md`、侧栏「文件」。
**检验计数**：4（下轮 260 按正常需求轮）。

## 第 258 轮 · 2026-11-01 01:33
**用户需求**：我在 ⋯ 菜单里看到「源码 / 分栏 / 预览 / 所见即所得」是一组单选（前有 ✓），想换视图时按 ←/→ 没反应，只能用 ↑↓ 一行行越过别的项再回车。期望：焦点在这四个视图项上时，←/→ 能在组内直接移动。
**产品经理**：做。只补单选项的方向键习惯，不改变「回车才执行」的菜单语义；不新增命令、不改快捷键，符合「安静、快」。
**前端**：`app/AppMenu.tsx` 的 `onKeyDown` 识别焦点在 `role=menuitemradio` 时处理 ←/→：在未禁用的视图项间循环移动焦点，不立即切换（扫菜单不误改视图），其余菜单项上 ←/→ 保持无动作。风险：与 ↑↓ 的全局遍历互不干扰；视图项全部禁用（未打开笔记）时不做处理。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/app/AppMenu.tsx`（+16），共 1 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.14s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（改后）**：工作区 `D:\clawWorkSpeace\新建文件夹`，打开 ⋯ 菜单（焦点在「新建笔记」）后 ↓ 到「源码」。
- → 依次聚焦「✓分栏 → 预览 → 所见即所得」，← 回到「预览」，再 → 回「所见即所得」；从「分栏」按 → 到「源码」，从「所见即所得」按 → 回绕到「源码」。
- 只移焦点不误切：整组操作期间勾选始终停在「✓分栏」；↓ 从「源码」到「✓分栏」（原 ↑↓ 遍历不变）。
- 非单选项上 → 不动焦点（焦点仍在「新建笔记」）；Esc 关闭后焦点回到 ⋯ 按钮（`aria-label=应用菜单`）。
**遗留 / 观察**：←/→ 只移焦点，回车才切换视图（与菜单「选中后关闭」一致）；若用户更希望方向键直接生效，可另记一条评估。
**清理**：未打开或修改任何笔记；无历史快照与恢复副本；临时 CDP 脚本已删；菜单已收起，应用停在单标签 `写作示例.md`、侧栏「文件」。
**检验计数**：3（下轮 259 按正常需求轮）。

## 第 257 轮 · 2026-10-31 22:52
**用户需求**：我点标题栏的 ⋯ 想找「导出 PDF」，菜单一开就是 21 行，只有几条细灰线隔开，得从头一行行读才知道哪段是文件、哪段是视图。期望：每段前有一个很轻的小标题，扫一眼就知道该往哪看；菜单别因此长到要滚动。
**产品经理**：做。只把菜单内部已有的 5 个 `role=group`（文件 / 导航 / 视图 / 查找 / 应用）显示出来，不新增命令、不改快捷键；用标题替代原来的分隔线，控制高度，符合「安静、快」。
**前端**：`app/AppMenu.tsx` 在每个分组前渲染 `app-menu-heading`，去掉分隔线；`app/AppMenu.css` 补标题样式（10.5px、弱色、字距），菜单项 30 → 28px 抵消标题带来的高度。风险：键盘 ↑↓ 只遍历 `.app-menu-item`，标题不参与；读屏已有 `aria-label`，标题设为 `aria-hidden` 避免重复。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/app/AppMenu.tsx`（+5/−4）、`src/app/AppMenu.css`（+15/−7），共 2 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.07s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测（改后）**：
- 结构：菜单仍 21 项，5 个分组标题「文件 / 导航 / 视图 / 查找 / 应用」，`.app-menu-sep` 为 0；整菜单高 729px（改前 686px），当前 1392px 高窗口无需滚动（`scrollHeight - clientHeight = 0`）；按 800px 高窗口的 `maxHeight`（744px）仍放得下。
- 键盘：打开后焦点在第一项「新建笔记」；↓ 三次依次到「打开文件夹… / 保存 / 另存为…」，End 到「偏好设置…」，Home 回「新建笔记」，标题不会被聚焦；Esc 关闭后焦点回到 ⋯ 按钮，`aria-expanded=false`。
- 视觉：截图确认 5 段标题为弱色小字，组间无细线、留白自然；禁用项「返回上一篇 / 前进下一篇」与勾选「分栏」「隐藏侧栏」显示不变。
**遗留 / 观察**：菜单项高度由 30 → 28px，命中区仍高于常见菜单；分组标题目前固定显示，不做折叠。
**清理**：未打开或修改任何笔记；无历史快照与恢复副本；临时 CDP / 截图脚本与图片已删；菜单已收起，应用停在单标签 `写作示例.md`、侧栏「文件」。
**检验计数**：2（下轮 258 按正常需求轮）。

## 第 256 轮 · 2026-10-31 22:37
**用户需求**：我在标题栏看到「扉页 / 新建文件夹 ⌄」，想切回上一个库。场景 → 现在的问题：库名是纯文本，点它没有任何反应，只有旁边 26px 的小箭头能点，库名看着却像入口。期望：库名和箭头合成一个可点击区域，点名字或箭头都能打开「最近工作区」，键盘 Tab 也只停在这一个入口上。
**产品经理**：做。只把已有的「最近工作区」入口扩大、合并点击目标，不新增能力、不改数据，符合「安静、快」；也修掉一处看着可点却点不动的假入口。
**前端**：`app/TitleBar.tsx` 把库名与箭头包进同一个 `workspace-switch` 按钮，沿用 `openRecentMenu` 与 ContextMenu，补 `aria-haspopup` / `aria-expanded`；没有工作区时仍保留单独的箭头按钮。`app/App.css` 补按钮的命中区、悬停、焦点与箭头尺寸，长库名继续省略。风险：标题栏左侧多一个按钮，窄窗下需确认不挤压标签栏。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/app/TitleBar.tsx`（+26/−14）、`src/app/App.css`（+43），共 2 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.19s）；未改 `src-tauri/`，未跑 cargo test。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；标题栏 `.workspace-name` 是 `SPAN`，对它调用 `click()` 后没有 `.context-menu`，也没有任何反馈；只有右侧独立的 `icon-btn`（26×26）能打开最近工作区。测试时先在设置里临时补一条最近库，确保「最近工作区」非空。
**CDP 实测（改后）**：
- 合并入口：`workspace-switch` 为 `BUTTON`，宽约 80px、高 24px（库名 5 字时），含库名与箭头；真实鼠标点击库名中心（141, 22）弹出「切换到 clawWorkSpeace」，菜单出现在按钮下方（x 62 / y 38），`aria-expanded` 由 false 变 true。
- 键盘：菜单打开后焦点在第一项；Esc 关闭后焦点回到 `workspace-switch`，`aria-expanded` 回到 false；Tab 顺序不新增第二个入口。
- 窄窗：窗口缩到 704px，库名上限 92px，长名（18 字）实测 `text-overflow: ellipsis` 生效，箭头仍在可视区内，标签栏与 `+`、`⋯`、窗口控制不重叠。
- 回归：侧栏开关、标签切换与关闭、文件树点击打开笔记、工具栏与分栏预览正常；全宽 2560px 标题栏布局无跳动。
**遗留 / 观察**：没有工作区时仍只显示箭头按钮（点了会走原有「无历史则打开文件夹」）；库名点击目标高度 24px，小于标题栏 44px，是为避免误触拖动区，暂不铺满整高。
**清理**：只打开未修改 `写作示例.md`，无历史快照与恢复副本；测试时临时写入的第二条最近库已还原为原来 1 条；窗口先缩到 704×800 验证后已恢复最大化 2560×1392；应用停在小标签 `写作示例.md`、侧栏「文件」、设置面板关闭。
**检验计数**：1（下轮 257 按正常需求轮）。

## 第 254 轮 · 2026-10-31 06:28（检验轮）
**范围**：回归本窗口第 249–253 轮，不开新功能。249 自动保存从「关闭」切回间隔时为脏内容立即排期；250 恢复副本间隔变化时为脏文档重排（调短尽快、调长按新间隔）；251 只改自动保存间隔不打断恢复副本倒计时；252 设置排版数值直接输入、边界夹取、非法回退提示与非预设间隔「当前」项；253 自定义 CSS 超长提示与字符计数。另回归重启回显、实际排版生效与冲突 / 外部删除错误路径。
**产品经理**：检验轮，只确认这批交互与数据安全改动没有回归；发现问题按 S 级修复或记入 backlog。
**前端**：回归 `features/editor/autosave.ts` 的 `resyncAutoSave` / `scheduleAutoSave` / `scheduleRecovery`，`features/settings/SettingsDialog.tsx` 的 `NumberInput`、非预设间隔选项与 `changeCustomCss`；未改源码。
**后端**：未改 `src-tauri/`。
**裁决**：检验轮（未发现产品缺陷，无源码改动）。
**改动**：无。
**构建**：`bun run build` 通过（含 tsc，vite 1.07s）；未改 `src-tauri/`，未跑 cargo test。
**CDP 实测**（9222，工作区 `D:\clawWorkSpeace\新建文件夹`）：
- 252 数值输入：默认回显 16 / 1.80 / 900；字号输入 `0` → 13、`99` → 20、`abc` → 回退 20 且只弹一次「「正文字号」需要数字，已保留 20」；行高 `0.1` → 1.40、`1.62` → 1.60；行宽 `0` → 600、`99999` → 1200。`.cm-content` computed 字号 / 行高与 `--editor-measure` 随输入即时变化（16→13→20、1.8→1.4→1.6、900→600→1200），重载后数字框仍为 16 / 1.80 / 900。
- 252 非预设间隔：把 `settings.json` 写成 2500 / 6000 并用 store reload 模拟重启（插件 store 在页面重载间缓存，必须重读磁盘），两个下拉分别显示「2.5 秒（当前）」「6 秒（当前）」且 `selectedIndex=0`；2500ms 实测 1.9s 未写盘、3.2s 写盘。
- 253 自定义 CSS：粘贴 25000 字符后输入框停在 20000，计数显示「20000 / 20000 字符（已达上限，超出部分不会保存）」，只弹一次「自定义 CSS 最多 20000 个字符，超出部分未保存」；满额再输入不重复提示；清空后 `#feiye-custom-css` 移除、计数 0；合法 CSS 正常注入。
- 249：自动保存关闭时输入 `B` 等 1.5 秒磁盘不变、状态栏「未保存」；切回 1 秒且不再输入，2.2 秒后写入 `BASEAB`、状态栏「已保存」，无需再敲字。
- 250：自动保存关闭 / 恢复副本 8 秒，输入 `C` 后约 0.8 秒出现副本；输入 `D` 后 8→2 秒约 1.1 秒副本更新为含 `D` 内容；2→8 秒后输入 `E`，+2.5 秒副本仍是旧内容、+8.5 秒才写入 `E`。另跑无计时器分支：保存两版后从历史载入旧版（脏、副本目录空），8→2 秒约 1.3 秒出现新副本，无需再输入。
- 251：恢复副本 8 秒 / 自动保存关闭，输入 `K` 后 1.3 秒副本为 `…K`；输入 `L` 后只把自动保存 0→5 秒，+2.4 秒副本仍是 `…K`、磁盘未变；+5.3 秒自动保存写入 `…KL` 并清空副本——恢复副本未被提前到 900ms。
- 错误路径：应用外追加内容后 Ctrl+S 弹「文件已被其他程序修改」（另存副本… / 覆盖保存 / 重新加载 / 取消），取消后不动磁盘；应用外删除后 Ctrl+S 弹「文件已不在磁盘上」（另存为… / 重新创建 / 取消），取消后编辑器内容保留。
**问题与修复**：未发现产品缺陷，本轮无源码改动。观察：① 设置通过 Tauri 插件 store 持久化，页面重载会复用内存中的 store，手改 `settings.json` 后必须重读磁盘才能模拟旧版本配置；② 历史恢复的确认框是第二层 `modal`，恢复动作需再点「载入此版本」。
**清理**：临时笔记 `_c254test.md` 已删除；其历史快照目录 `8a1d8e6652600dba` 已删（历史目录回到 9 个）；恢复副本目录为空；`settings.json` 已还原（字号 16 / 行高 1.8 / 行宽 900 / 自动保存 1800 / 恢复副本 4000 / 自定义 CSS 空 / 分类「编辑行为」，与轮前备份语义 diff 仅分类已改回）；`_c254test.md` 的光标记录已移除；临时 CDP 脚本与备份已删；应用停在单标签 `写作示例.md`、侧栏「文件」、设置面板已关闭。
**检验计数**：0（下轮 255 按正常需求轮）。

## 第 253 轮 · 2026-10-31 06:18
**用户需求**：我从别处复制了一整段主题 CSS 粘进设置，看起来只留下前面一部分，应用却什么都没说；期望超出上限时明确告诉我截断了、现在用了多少字符，别让我以为整段都保存了。
**产品经理**：做。上限本身是防止超大样式拖慢界面的既有护栏，不扩大产品边界；但无声丢弃用户输入违背「数据安全、安静但不隐瞒」，只补计数与一次轻提示。
**前端**：`features/settings/SettingsDialog.tsx` 的自定义 CSS 输入改为走 `changeCustomCss`：原始输入超过 `CUSTOM_CSS_LIMIT` 时第一次提示「最多 20000 个字符，超出部分未保存」，仍按旧逻辑截断并落盘；删回上限内重置提示状态，继续越界不会重复刷屏。输入框下增加「当前 / 20000 字符」，到达上限追加「已达上限，超出部分不会保存」。`settings.css` 补计数行样式。风险：只改单一输入的反馈，不改存储与注入逻辑。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/settings/SettingsDialog.tsx`（+28/−3）、`src/features/settings/settings.css`（+8），共 2 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.00s）；未改 `src-tauri/`，未跑 cargo test。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；设置 → 外观排版，把 25000 个字符粘贴进自定义 CSS：输入框只剩 20000 字符，样式元素也只注入 20000，没有任何提示，计数区域不存在，用户无法知道其余 5000 字符被丢弃。
**CDP 实测（改后）**：
- 超长粘贴：粘贴 25000 字符后输入框为 20000，计数显示「20000 / 20000 字符（已达上限，超出部分不会保存）」，弹出一次「自定义 CSS 最多 20000 个字符，超出部分未保存」。
- 不重复提示：等提示消失后在已满时再输入一个字符，输入框仍为 20000、不产生新提示；清空到 0 时计数为「0 / 20000 字符」，样式元素移除。
- 正常 CSS 与主题切换（回归）：输入 `.markdown-body h1{color:rgb(1, 2, 3);}` 后预览标题 computed color 为 `rgb(1, 2, 3)`；切到深色再回浅色，样式仍在、颜色不变；清空后样式元素移除。
- 设置还原：关闭面板后 `settings.json` 与轮前备份 diff 为空（含 `customCss: ""`、主题浅色、分类「编辑行为」）。
**遗留 / 观察**：只对「超长」给反馈，未对语法错误的 CSS 做校验（浏览器会忽略非法规则，应用仍照常运行）；若后续用户反馈，可再加轻量花括号配平提示。
**清理**：本轮只改设置、未动笔记；历史目录仍 9 个、恢复副本目录为空；`settings.json` 已按轮前备份还原（diff 为空）；临时 CDP 脚本与备份已删；应用停在单标签 `写作示例.md`、侧栏「文件」、设置面板已关闭。
**检验计数**：5（下轮 254 为检验轮：回归 249–253 的自动保存 / 恢复副本排期、设置边界与本轮修复）。

## 第 252 轮 · 2026-10-31 06:10
**用户需求**：设置里的字号、行高、行宽只能拖滑块，对不齐想要的值，我想点数字直接输入；手滑清空、输成 0、负数、超大值或粘贴「九百」这类非数字时，别把设置弄坏，也别让界面显示和实际生效值对不上。（现状核实：面板里没有自由数字输入框——三个排版项是滑块 + 只读数值，两个保存间隔是预设下拉；按这个现状补精确输入与边界处理。）
**产品经理**：做。数值仍夹在既有 `PREFERENCE_LIMITS` 内，「自动保存：关闭（手动保存）= 0」保持原样；只给现有控件补精确输入、失焦规范化与非法回退，不扩大产品边界，符合「安静、快」。
**前端**：`features/settings/SettingsDialog.tsx` 新增 `NumberInput`：失焦 / 回车解析，按 step 取整后夹到 min–max；空值与非数字保留上一次有效值并轻提示；三个排版项用它替代只读 `output`，滑块保留。两个保存间隔仍为预设下拉，仅当 settings.json 的值不在预设里（旧版本 / 手改）时补一项「x 秒（当前）」，避免下拉空白。`settings.css` 补输入框样式。风险：数字框与滑块共用同一 store 更新，无新增状态源。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/settings/SettingsDialog.tsx`（+91/−11）、`src/features/settings/settings.css`（+31/−11），共 2 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.01s）；未改 `src-tauri/`，未跑 cargo test。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；设置面板三个排版项只有 range 滑块和只读 `<output>`，字号/行高/行宽无法键入精确值；两个保存间隔是预设 `<select>`。把 range 的 value 强设为 0 / 负数 / 超大值，浏览器自身与 store 都会夹回 min–max，未见字号消失或非法落盘。把 `settings.json` 的 `autoSaveDelay` / `recoveryInterval` 设为 2500 / 6000（旧版本或手改配置），重载后两个下拉 `selectedIndex=-1`、显示空白，而自动保存实际按 2.5 秒生效——显示值与生效值漂移。
**CDP 实测（改后）**：
- 字号：输入 `0` → 13（下限），`99` → 20（上限），`abc` → 回退 16 且只弹一条「「正文字号」需要数字，已保留 16」；清空同样回退并提示；回车与真实失焦都只结算一次（无重复提示）。
- 行高：`0.1` → 1.40，`1.62` → 1.60（按 0.05 取整），`xx` 回退并提示；行宽：`0` → 600、`99999` → 1200、`850` → 860（按 20 取整）。
- 生效值：`.workspace-main` 的 `--editor-font-size` / `--editor-line-height` / `--editor-measure` 与 `.cm-content` computed `font-size` / `line-height` 随输入即时变化（14→13px、1.8→1.4、900→600 等）。
- 合法值回填：重载页面后数字框显示 16 / 1.80 / 900，滑块同步。
- 合法档位未误伤：自动保存下拉仍有且只有一个「关闭（手动保存）=0」，选中 0 时不会被补成别的值。
- 非预设间隔：注入 2500 / 6000 并重载，下拉分别显示「2.5 秒（当前）」「6 秒（当前）」，`selectedIndex=0`、不再空白；实测自动保存 1.9 秒未写盘、3.2 秒写盘，确认按 2500ms 生效；选回 1800 / 4000 后落盘，重载回显正常。
**遗留 / 观察**：行高按 0.05 取整，输入 1.62 会落到 1.60；这是现有 step 的预期，不是丢输入（失焦后立即显示取整结果）。非预设间隔仍可通过下拉改回预设档位；本轮不新增任意毫秒输入。
**清理**：测试写入 `写作示例.md` 后已撤销并保存回原文（2150 B），本轮产生的 2 个历史快照（`1793398120356.md` / `1793398121412.md`）已删，历史目录仍为 9 个；恢复副本目录为空；设置回到字号 16 / 行高 1.8 / 行宽 900 / 自动保存 1800 / 恢复副本 4000；临时 CDP 脚本已删；应用停在单标签 `写作示例.md`、侧栏「文件」、设置面板已关闭。
**检验计数**：4（下轮 253 按正常需求轮）。

## 第 251 轮 · 2026-10-31 06:00
**用户需求**：我把「自动保存」从关闭改回开启，或从 1.8 秒改成 5 秒，只是调保存节奏、没动恢复副本。结果正在等的恢复副本计时器被重置成约 0.9 秒的首次延迟，马上又写了一份副本；期望只改自动保存时，恢复副本继续按原来的倒计时走，不要被打断提前写。
**产品经理**：做。恢复副本的节奏应由它自己的间隔决定，无关设置变化不应触发额外写盘；只修重排逻辑，不改变保存 / 恢复策略与产品边界，符合「快、安静、数据安全」。
**前端**：`features/editor/autosave.ts` 的 `resyncAutoSave`：原来只要存在待触发的恢复计时器，就会先清掉再按首次延迟（≤900ms）重排；现在仅当 `recoveryInterval` 真的变化时才清除并重排，未变化直接返回，让原计时器按原倒计时继续。自动保存部分保持第 249 / 250 轮行为。风险：恢复间隔自身变短 / 变长的重排仍走上一轮逻辑。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/editor/autosave.ts`（+17/−13），共 1 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.03s）；未改 `src-tauri/`，未跑 cargo test。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；打开临时笔记 `_c251rec.md`，设置自动保存「关闭」、恢复副本 8 秒；输入后约 0.9 秒写入首次副本，再输入一个新字符，随即把自动保存从「关闭」改到「5 秒」：约 0.9 秒后副本即被改写为包含新字符的内容（mtime 与 content 都变），而原 8 秒倒计时本应还剩约 7 秒。
**CDP 实测（改后）**：
- 仅改自动保存：同样流程（自动保存关闭 / 恢复副本 8 秒，先输入 A 等首次副本，再输入 B 后改自动保存 0→5 秒），改动后 2.4 秒内副本内容始终是含 A 的旧内容，没有在 900ms 提前重写；约 5 秒后自动保存把源文件写成含 B 的最新内容，副本目录清空。
- 恢复副本调短（回归）：8 秒节奏下输入 C 等首次副本，再输入 D 后把恢复副本 8→2 秒，约 0.9 秒后副本更新为含 D 的内容。
- 恢复副本调长（回归）：2→8 秒后输入 E，2.5 秒内副本仍未写入 E（按新的 8 秒计时，不立刻再写）。
- 自动保存照常：恢复默认 1.8 秒后输入 F，约 2.6 秒源文件落盘、恢复副本目录清空、状态栏「已保存」。
- 崩溃恢复提示：副本存在时 `Page.reload` 正常弹「发现未保存的恢复副本」，选「丢弃副本」后副本目录清空、磁盘仍是上次保存内容。
- 设置落盘：`settings.json` 回到 `autoSaveDelay` 1800 / `recoveryInterval` 4000，重载后保持。
**遗留 / 观察**：恢复副本没有「关闭」档，最小 2 秒；本轮只改「何时重排」，不改备份频率策略。
**清理**：`_c251rec.md` 已删除；其历史快照目录 `3a3edcf6353cf33d` 已删（历史目录回到 9 个）；恢复副本目录为空；`settings.json` 中 `_c251rec.md` 的标签 / 最近打开 / 光标记录已清除（重载启动校验后引用为 0）；临时 CDP 脚本已删；应用停在单标签 `写作示例.md`、侧栏「文件」。
**检验计数**：3（下轮 252 按正常需求轮）。

## 第 250 轮 · 2026-10-31 05:50
**用户需求**：我在文档历史里载入了一个旧版本（编辑器已显示「未保存」，但还没敲字），想让它更频繁地写崩溃恢复副本，就把「恢复副本」从 8 秒改成 2 秒。现在只要不再敲字，就一份新副本都不会写，得先随便打一个字才按新间隔开始；期望一改短，当前未保存内容就按新间隔开始写副本，改长时也别立刻又写一份。
**产品经理**：做。恢复副本是崩溃保护，间隔设置理应立即作用于当前未保存内容，而不是要用户再输入一次来「唤醒」计时器；只修重排逻辑，不涉及保存策略与产品边界。
**前端**：`features/editor/autosave.ts` 的 `resyncAutoSave`：原来只有存在待触发恢复计时器时才重排；现在间隔真的变化时，只要当前文档有路径且脏、间隔为正，无论有无旧计时器都重排——调短按首次延迟尽快落一份，调长按新的完整间隔计时（不再沿用旧的短间隔 / 900ms 首次延迟）；自动保存部分保持第 249 轮行为。设置订阅把旧恢复间隔传入以区分「变长 / 变短」。风险：仅自动保存间隔变化时不改变恢复计时器的既有重排行为。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/editor/autosave.ts`（+12/−3），共 1 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.01s）；未改 `src-tauri/`，未跑 cargo test。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；打开临时笔记 `_c250rec.md` 保存一次后，用 Ctrl+Alt+H 历史面板「恢复此版本」载入，编辑器显示「未保存」（此路径只标记脏、不建自动保存 / 恢复计时器，且恢复副本目录为空）。设置里把「恢复副本」从 2 秒改到 8 秒再改回 2 秒，等 2.6 秒：恢复副本目录仍为空、无任何提示，只有再敲一个字才会开始写副本。
**CDP 实测（改后）**：
- 无计时器的脏文档改短：同样载入历史版本后（未保存、副本目录空），恢复副本 2→8→2 秒：改回 2 秒后约 0.9 秒（0.7 秒时空、1.5 秒时已写入）出现新的恢复副本，`content` 与编辑器正文一致。
- 有待触发计时器改短（回归）：关自动保存后输入新内容、等待下一次 4 秒计时中把它改为 2 秒，约 0.9 秒后副本写入新内容。
- 改长：在 2 秒节奏下输入 `F` 后立即改为 4 秒，+2.5 秒时副本仍是旧内容（224 B），+4.5 秒时更新为含 `F` 的新内容（225 B）——没有刚调长就立刻再写，之后按 4 秒节奏。
- 自动保存不受影响：改回 1.8 秒后输入 `G`，约 2.4 秒后源文件落盘为最新内容、恢复副本被清空、状态栏「已保存」。
- 崩溃恢复：关自动保存后输入 `H` 并等副本写入，`Page.reload` 后正常弹「发现未保存的恢复副本」（恢复内容 / 丢弃副本 / 稍后），选「丢弃副本」后副本目录清空、磁盘仍是上次保存内容。
- 收尾：设置还原为自动保存 1.8 秒 / 恢复副本 4 秒；重载后单标签 `写作示例.md`、活动标签与状态栏一致。
**遗留 / 观察**：仅「自动保存间隔」变化时，若恰有恢复计时器在等，仍会按既有逻辑重排到首次延迟（900ms）；这与恢复间隔本身无关，未在本轮改动。恢复副本没有「关闭」档，最小 2 秒，因此「从关闭变开启」只以 `interval > 0` 守卫预留。
**清理**：`_c250rec.md` 已删除；其历史快照目录 `2a39bc0af6badfe2` 已删（历史目录回到 9 个）；恢复副本目录为空；`settings.json` 中 `_c250rec.md` 的最近打开与编辑器位置记录已移除，设置回到自动保存 1800 / 恢复副本 4000；临时 CDP 脚本已删；应用停在单标签 `写作示例.md`、侧栏「文件」。
**检验计数**：2（下轮 251 按正常需求轮）。

## 第 249 轮 · 2026-10-31 05:40
**用户需求**：我为了自己掌控保存，把「自动保存」设为「关闭（手动保存）」，改了一段后切回「1 秒」，以为当前未保存的内容会按新间隔落盘。现在只要切回后不再敲字，状态栏就一直「待保存」、文件也没写入，非得再打一个字才保存；期望开启自动保存后，现有的未保存内容也能自己存下去。
**产品经理**：做。设置项写的是「停止输入后等待多久写入源文件」，从关闭切回开启理应覆盖当下已有的未保存内容；不涉及保存策略、恢复副本或产品边界，改动只在重新排期。
**前端**：`features/editor/autosave.ts` 的 `resyncAutoSave`：原来只有「原先已有自动保存计时器」时才按新间隔重排；改为从关闭切到开启时，若当前文档脏且未被暂停，也调用一次 `scheduleAutoSave`。风险：自动保存仍为 0（关闭）时不排期；`saveBlocked` 仍不排期；正常改间隔仍是重排旧计时器。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/editor/autosave.ts`（+5/−1），共 1 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.01s）；未改 `src-tauri/`，未跑 cargo test。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；打开临时笔记 `_c249auto.md`，在设置把「自动保存」设为「关闭（手动保存）」，输入 `ZZ` 后等 2.5 秒：文件仍是初始内容、状态栏「待保存」；再把选择改回「1 秒」并等 2.2 秒，文件仍未变化、状态栏仍「待保存」，编辑器里的修改只有下一次按键才会触发保存。
**CDP 实测（改后）**：
- 关闭时修改：同样设为「关闭」后输入 `YY`，等 1.5 秒确认磁盘未写入、状态栏「未保存」。
- 切回开启：把选择改回「1 秒」，不碰编辑器，等待约 2 秒后文件出现 `YY`，标签脏点消失、状态栏「已保存」。
- 常规自动保存：切回开启后再输入 `QQ`，约 1.6 秒后文件同步更新、状态栏「已保存 05:39」，计时器行为未变。
- 设置还原：自动保存恢复「1.8 秒（默认）」，`settings.json` 的 `autoSaveDelay` 回到 1800；页面重载后单标签 `写作示例.md`、光标 93:1。
**遗留 / 观察**：「关闭（手动保存）」下不写源文件、只保留恢复副本，仍是既有预期；本轮只补从关闭切回开启后的首次排期，不改恢复副本节奏。
**清理**：`_c249mermaid.md`、`_c249auto.md` 已删除；本轮保存产生的历史快照目录 `e87f924d69a5e1ed` 已删，历史目录回到 9 个；`settings.json` 中 `_c249auto.md` 的光标记录已移除，`tabsByWorkspace` / `recentDocuments` 经启动校验已无临时条目；恢复副本目录为空；临时 CDP 脚本已删；应用停在单标签 `写作示例.md`、侧栏「文件」、设置未改。
**检验计数**：1（下轮 250 按正常需求轮）。

## 第 248 轮 · 2026-10-31 05:35（检验轮）
**范围**：回归本窗口第 243–247 轮，不开新功能。243 关当前标签时相邻文件失效仍切到可用标签；244 启动恢复摘除失效标签 / 上次文档并补位、全部失效回空状态、最近打开同步清理；245 上次库被删 / 移走时提示并摘除；246 启动单次批量校验最近工作区；247 搜索命中文件被外部删 / 改名后只提示一次并清理失效命中、取消与并发打开不误删。
**产品经理**：检验轮，只确认这五条交互与数据安全修复没有回归；发现问题按 S 级修复或记入 backlog。
**前端**：回归 `closeDocumentTab` 的邻居补位、`restoreSavedTabs` / `filterExistingPaths`、`restoreLastWorkspace` 失败分支、`pruneRecentWorkspaces`、`SearchPanel.openHit` 的 `failed` 过滤与取消 / 并发分支；未改源码。
**后端**：回归 `dir_exists` 的 stat 语义与启动批量清理；未改 `src-tauri/`。
**裁决**：检验轮（未发现产品缺陷，无源码改动）。
**改动**：无。
**构建**：`bun run build` 通过（含 tsc，vite 1.43s）；`(cd src-tauri && cargo test)` 44 项全部通过。
**CDP 实测**（9222，工作区 `D:\clawWorkSpeace\新建文件夹`；第 246 轮后开发服务器重启过，先确认页面与 9222 正常）：
- 243：打开 `_c248b / _c248a / _c248c`（标签 `写作示例 / B / A / C`），应用外删 A 后点 C 的 ×：只弹一次「打开文件失败…_c248a.md」，A 标签摘除，活动标签、状态栏与正文均为 `_c248b.md`，无无标签编辑区。
- 244：以 B 为上次文档后删 B 重载 → 失效标签消失、落到 `写作示例.md` 且活动态 / 状态栏一致，`tabsByWorkspace` 与 `lastDocumentByWorkspace` 同步清理；在临时库 `_c248libD` 打开唯一笔记后删文件重载 → 标签栏空、空状态「从左侧选择一篇 Markdown…」、状态栏「未选择文件」，该库标签与上次文档记录删除。
- 245：把 `_c248libC` 设为上次库并删除（最近列表含 A/B/C/D）后重载 → 提示「上次的库已不在：_c248libC（…已从最近工作区移除）」，无可切换库的空状态含「打开文件夹」，`lastWorkspace` 为 null。
- 246：同一启动中 A/B/C 未点击即从最近工作区静默摘除，只剩 `新建文件夹` 与仍存在的 `_c248libD`；点菜单切到 D 正常列出 `_c248note.md`、空状态正常；行尾 × 移除后提示「已从最近工作区移除…· 点击撤销」，点提示恢复并提示「已恢复最近工作区」；删除 D 后再重载，D 也被静默摘除。（5 条上限本轮未重跑：`rememberWorkspace` 本轮未改，246 已实测。）
- 247：搜索 `c248needle` 得 3 条（`_c248keep:2`、`_c248s:1/3`），应用外删 `_c248s.md` 后点其结果：只提示一次「打开文件失败」，该文件两条命中清空、状态「1 条结果」，剩余命中正常打开并跳转；把当前笔记设为只读后输入再点另一结果，弹「有未保存的修改」（保存并继续 / 放弃修改 / 取消），选「取消」后两条命中仍在、当前标签与脏状态不变；快速连点两条命中时只打开后点的那篇，命中列表与提示均不受影响。
**问题与修复**：未发现产品缺陷，本轮无源码改动。观察：全部标签失效时 `recentDocuments` 会留下该库的空数组（用户不可见，属设置里的极小残留）；应用外删文件不会清理其历史快照（只有应用内删除才清，属既有行为）。测试面板里第 247 轮遗留的 `_c247keep.md` 光标记录被应用内存中的旧设置写回一次，本轮设置还原时一并清除。
**清理**：`_c248a/b/c/s/r1/r2/keep/keep2.md`、`_c248libA/B/C/D` 均已删除；本轮新增 `_c248keep` / `_c248keep2` 的 2 个历史快照目录已删，历史目录回到 9 个；恢复副本目录为空；`settings.json` 已按本轮开始时备份还原（diff 为空）；临时 CDP 脚本已删；应用停在单标签 `写作示例.md`、侧栏「文件」、设置未改。
**检验计数**：0（下轮 249 按正常需求轮）。

## 第 247 轮 · 2026-10-31 05:20
**用户需求**：我在搜索面板里搜到几行结果，切到系统里把那个文件删掉 / 改名，再回来点结果。现在只会反复弹「打开文件失败」，这些已经不存在的结果还挂在列表里，点几次报几次，还显示「2 条结果」。期望点一次就提示一次，并把这个文件的所有命中从列表里去掉；全没了就显示「没有匹配的内容」。
**产品经理**：做。文件在应用外被删 / 改名是真实路径，失效搜索结果留着只会反复报错、让人误以为文件还在；只清理失效项，不改搜索索引、打开策略与产品边界。
**前端**：`features/workspace/SearchPanel.tsx` 的 `openHit` 根据 `openFile` 的结果，仅当明确失败时过滤掉该 `relPath` 的全部命中并重置键盘选中；取消未保存提示、被新打开请求取代时保留列表。`features/workspace/workspace-actions.ts` 的 `openFile` 由 `Promise<void>` 改为返回 `"opened" | "cancelled" | "failed" | "superseded"`，现有调用方忽略返回值不受影响。风险：只在读盘完成后的失败分支过滤，过期的并发结果不会误删。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/workspace/SearchPanel.tsx`（+14/−1）、`src/features/workspace/workspace-actions.ts`（+14/−10），共 2 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.39s）；未改 `src-tauri/`，未跑 cargo test。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；建 `_c247gone.md`（两行 `c247needle`）后在搜索面板搜到「2 条结果」，应用外删除该文件再点第一条：弹「打开文件失败：文件或目录不存在…」，列表仍是 `_c247gone.md:3` / `:5` 两行、状态仍「2 条结果」，再点仍重复报错。
**CDP 实测（改后）**：
- 删除后点结果：同样搜索出 2 条，应用外删除后点第一条，弹一次「打开文件失败」，列表清空、状态变为「没有匹配的内容」；再没有可重复点的失效项。
- 取消未保存提示：把当前文档设为只读并输入，点搜索到的另一篇；确认弹「有未保存的修改」后点「取消」，搜索列表仍保留该结果、当前标签与正文不变（只在 `failed` 时清理，`cancelled` 不误删）。
- 有效结果：点仍存在的命中仍能正常打开、跳转到命中行，多标签与状态栏一致。
- 清理后应用重启：单标签 `写作示例.md`、正文与状态栏一致，光标回到 93:1。
**遗留 / 观察**：文件树里仍失效的条目（若此前已展开）点击时仍按原逻辑报错并摘除，本轮只处理搜索面板；改名后的文件需要重新搜索才会以新路径出现（不猜新路径）。
**清理**：`_c247gone.md` / `_c247keep.md` / `_c247keep2.md` 均已删除；`写作示例.md` 测试时误插入的 `xz` 已还原（字节数回到 2150），`_c247keep` 的编辑器位置记录已从 `settings.json` 移除；本轮新增的 `_c247*` 历史快照 4 个已删除，空历史目录已恢复原有数量（9 个）；恢复副本目录为空；临时 CDP 脚本已删；应用停在单标签 `写作示例.md`、侧栏「文件」、设置未改。
**检验计数**：5（下轮 248 为检验轮，回归 243–247）。

## 第 246 轮 · 2026-10-31 05:12
**用户需求**：我先后用过几个笔记库，其中一些后来在系统里被删掉 / 改名 / 移走了。现在「最近工作区」下拉里它们一直留着，只有点下去才报错并消失；期望应用启动后就把已经不存在的库清掉，剩下的都能正常点开，也别为了清列表每次打开菜单都去翻磁盘。
**产品经理**：做。启动时静默清理一次过期历史，符合「安静、本地优先、数据安全」；不改恢复策略与产品边界，也不新增后台轮询。
**前端**：`features/workspace/workspace-actions.ts` 新增 `pruneRecentWorkspaces`：每会话最多执行一次，用一条新命令批量 stat 所有最近库；只摘「确认不存在」的，校验后重读设置再写，避免覆盖校验期间新加的库；没有上次库时也触发。启动恢复（成功 / 失败 / 无上次库）后以 `void` 调用，不阻塞首屏；打开菜单仍是纯读设置，不做探测。风险：首次启动多一次轻量 IPC；权限等非 NotFound 错误保守保留。工作量 S。
**后端**：`commands/workspace.rs` 新增 `dir_exists`（`fs::metadata` 只 stat，不扫目录；NotFound 视为失效，其它错误保守视为仍可用），`lib.rs` 注册。风险：无状态、无写入，不影响现有命令。工作量 S。
**裁决**：做。
**改动**：`src-tauri/src/commands/workspace.rs`（+10）、`src-tauri/src/lib.rs`（+1）、`src/features/workspace/workspace-actions.ts`（+43/−1），共 3 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.46s）；`(cd src-tauri && cargo test)` 44 项全部通过。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；建 `_c246libA/B/C/D` 四个临时库并记入最近（上限 5），应用外删掉 A/B/C 后 `Page.reload`：菜单仍列出 D/C/B/A 四条，A/B/C 已不存在；点 C 才提示「打开工作区失败：文件或目录不存在…（已从最近工作区移除）」。
**CDP 实测（改后）**：
- 启动清理：最近列表为 `[新建文件夹, _c246libD, _c246libC, _c246libB, _c246libA]`、A/B/C 已删除时重启应用：约 6 秒内设置落盘为 `[新建文件夹, _c246libD]`，A/B/C 未点击即被摘除；菜单只显示「切换到 _c246libD」。
- 正常项：点 `_c246libD` 正常切库、文件树列出 `_c246d.md`、显示空状态；再从菜单切回 `新建文件夹`，标签 `写作示例.md`、活动标签与状态栏一致。
- 重启后当前库仍在：全新进程加载同一份设置，启动清理保留 `新建文件夹` 与仍存在的 `_c246libD`；失效测试路径不再出现在菜单。
- 撤销移除：单条 `_c246libD` 点行尾 × 后菜单收起、设置只剩当前库、提示「已从最近工作区移除…· 点击撤销」；点提示恢复，设置回到 `[_c246libD, 新建文件夹]` 并提示「已恢复最近工作区」。
- 数量上限：连续 `rememberWorkspace` 6 个路径后设置仍为 5 条（最早的被挤出），与既有 `RECENT_WORKSPACES_LIMIT` 一致。
- 点击失效入口的兜底未改：改前已确认点不存在路径会报错并摘除；启动清理后同类条目直接不再展示。
**遗留 / 观察**：清理只发生在启动（每会话一次），应用运行期间才被删掉的库仍按旧行为在点击时提示并摘除；这是为「不每次开菜单都全量 IO」做的取舍。清理静默进行，不弹提示。
**清理**：`_c246libA/B/C/D` 均已删除，测试用 `_c246fake*` 从未创建；`settings.json` 已按本轮开始时备份还原（语义 diff 为空），应用停在单标签 `写作示例.md`、工作区 `新建文件夹`；恢复副本 / 历史目录未变动；临时 CDP 脚本已删。
**检验计数**：4（下轮 247 按正常需求轮）。

## 第 245 轮 · 2026-10-31 04:59
**用户需求**：我上次用的整个笔记库在系统里被删掉 / 改名 / 移到了别处，第二天启动扉页。现在应用会悄悄回到空白页，一句提示都没有，让人以为笔记全丢了；「最近工作区」里那个已经不存在的库还留着，点它才报错并消失。期望启动时发现上次的库不在了就明确说一句「上次的库已不在」，自动把失效路径从最近工作区摘掉，停在能直接打开别的库的空状态；库还在时照旧恢复，未保存副本提示也不受影响。
**产品经理**：做。库被外部删 / 移是真实会发生的路径，静默回空状态既不解释也不可操作，违背「数据安全、安静但不隐瞒」；只补启动失败时的提示与列表清理，不改恢复策略与产品边界。
**前端**：`features/workspace/workspace-actions.ts` 的 `restoreLastWorkspace` 失败分支：仍清掉 `lastWorkspace`；`not-found` 视为库已不在，调用 `forgetWorkspace(last)` 从最近列表摘除并发一条 info 提示「上次的库已不在：<名>（可能已被删除或移走，已从最近工作区移除）」；其它错误保留记录并发错误提示「恢复上次工作区失败：…」。提示只在这次恢复仍是最后一次切库时发出，不覆盖用户随后手动打开的库。风险：启动失败会多一次设置写入与一条提示；正常恢复、未保存副本提示路径未改。工作量 S。
**后端**：无（未改 `src-tauri/`；`open_workspace` 对不存在路径已返回 `not-found`）。
**裁决**：做。
**改动**：`src/features/workspace/workspace-actions.ts`（+14/−2 行），共 1 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.05s）；未改 `src-tauri/`，未跑 cargo test。
**复现（改前）**：CDP 9222；把临时库 `D:\clawWorkSpeace\_c245lib`（含 `_c245note.md` / `_c245rec.md`）设为上次工作区并重载，确认正常打开；应用外删除库目录后 `Page.reload`：界面静默回到「未打开工作区」空状态，无任何提示，`lastWorkspace` 被清空，但 `recentWorkspaces` 仍留着 `_c245lib`，最近工作区菜单照常显示「切换到 _c245lib」，点击后才提示失败并移除。无错误循环、无反复弹错。
**CDP 实测（改后）**：
- 删除库：重载后弹出「上次的库已不在：_c245lib（可能已被删除或移走，已从最近工作区移除）」，空状态含「打开文件夹」，`lastWorkspace` 为 null，`recentWorkspaces` 只剩 `新建文件夹`。
- 改名 / 移动：`_c245lib` 改名为 `_c245lib-moved`、以及移动到 `_c245dest\_c245lib` 后重载，提示与清理同上；路径恢复原处并重新记为上次工作区后，两标签、活动文档与状态栏正常恢复。
- 恢复原路径：库移回后重载，应用照常进入 `_c245lib`，标签 `_c245note.md` / `_c245rec.md` 与上次文档一致。
- 未保存副本：`_c245rec.md` 设为只读后输入，恢复副本落盘；重载仍弹「发现未保存的恢复副本」（恢复内容 / 丢弃副本 / 稍后），选「丢弃副本」后副本目录清空。
- 最近工作区失效项：仍可正常展示与点击，点击不存在路径会提示「打开工作区失败：文件或目录不存在…（已从最近工作区移除）」并摘除该条，当前库与标签不受影响。
**遗留 / 观察**：更早会话遗留、又不是本次上次工作区的失效最近条目，仍要等用户点一次才移除；启动时不额外扫全部最近条目（避免为历史记录多读盘）。
**清理**：`_c245lib`（含两篇笔记）、`_c245lib-moved`、`_c245dest` 均已删除，临时伪造的 `_c245gone` 从未创建；恢复副本目录为空、历史目录仍为 9 个；`settings.json` 已按本轮开始时备份原样还原（diff 为空），标签回到单标签 `写作示例.md`、光标 93:1、侧栏「文件」；临时 CDP 脚本已删。
**检验计数**：3（下轮 246 按正常需求轮）。

## 第 244 轮 · 2026-10-31 04:52
**用户需求**：我退出时开着两篇笔记，第二天先在系统里删掉了其中一篇（或改名 / 移到别的文件夹）再启动扉页。期望应用直接落到还找得到的标签上；找不到的标签别留在标签栏，也不要出现「有标签但没有当前文档」的空白编辑区；两篇都不在了就回到干净的空状态，并让「最近打开」与文件树一致。
**产品经理**：做。启动恢复是最容易被外部改动撞上的路径，留下幽灵标签 / 无标签文档会让人误以为笔记还在、也分不清该从哪继续；只调整恢复时的存在性校验与补位，不改保存策略与产品边界。
**前端**：`features/workspace/workspace-actions.ts`：新增 `filterExistingPaths`（按父目录 `listDir` 批量校验，目录 `not-found` 视为失效、其它读错保守保留）；`restoreSavedTabs` 改为异步——先过滤失效标签、把它们从「最近打开」摘掉，再按保存顺序以「上次那篇」为锚由近到远补位（同距先右，和关标签一致），只摆回仍存在的标签；候选逐个 `openFile`，读盘失败摘掉该标签继续，全部失败回空状态并清掉上次文档；最后再校验一遍「最近打开」，删掉应用外已消失的条目。启动 / 切库两条路径共用。风险：启动多几次目录读取（最多标签数与最近条目涉及的去重父目录）；校验只认父目录里同名文件，改名 / 移动按失效处理（不猜新路径）。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/workspace/workspace-actions.ts`（+93/−29 行，净 +64），共 1 个文件。
**构建**：`bun run build` 通过（含 tsc，vite ~1.0s）；未改 `src-tauri/`，未跑 cargo test。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；打开 `_c244b.md` 再打开 `_c244a.md`（A 为上次文档，标签 `写作示例 / B / A`），应用外删除 A 后 `Page.reload`：标签栏只剩 `写作示例`、`B` 但都没有活动态，状态栏「未选择文件」、显示空状态，编辑区空白——有标签却没有当前文档。
**CDP 实测（改后）**：
- 删除上次文档：同一序列改后自动落到最近的可用标签（A 在最右时落到 `写作示例`；A 在中间时先试右侧 `_c244b.md`），状态栏、正文与唯一活动标签一致，失效的 A 不在标签栏，`最近打开` 里也同步移除。
- 改名 / 移动上次文档：`_c244a.md` 在应用外改名为 `_c244a2.md`（移动同理，路径失效）后重载，不残留旧路径标签，按距离补位到可用标签；新文件名仍可从文件树正常打开。
- 全部失效：只留 `_c244b.md` 且删除后重载，标签栏为空、显示「从左侧选择一篇 Markdown，或新建一篇。新建文件 / 最近打开」，上次文档记录清除，`tabsByWorkspace` 中该库条目删除，「最近打开」只剩仍存在的 `写作示例.md`。
- 正常恢复：单标签 `写作示例.md` 重载后标签、活动态、正文与状态栏一致；多标签顺序保持（非当前标签先摆回、当前文档随后）。
- 未保存恢复副本：把 `_c244r.md` 设为只读后输入并等自动保存失败，恢复副本落盘；重载后仍弹「发现未保存的恢复副本」（恢复内容 / 丢弃副本 / 稍后），选「丢弃副本」后副本目录清空，提示行为未变。
**遗留 / 观察**：应用外改名或移动不会自动关联到新路径（按失效处理，静默补位，不弹错）；「最近打开」中更早会话遗留、又不在本次标签 / 上次文档里的失效条目，会在每次启动时统一补扫清除（本轮同时清掉了上轮遗留的 `_c243a.md` / `_c243b2.md`）。
**清理**：`_c244a/b/r.md`、`_c244a2.md` 均已删除；`settings.json` 中 `_c244*` 的标签、上次文档、最近打开与光标记录已清空，`写作示例.md` 为唯一标签 / 上次文档 / 最近打开；恢复副本目录为空、历史目录仍为 9 个；临时 CDP 脚本已删；应用停在单标签 `写作示例.md`，侧栏「文件」。
**检验计数**：2（下轮 245 按正常需求轮）。

## 第 243 轮 · 2026-10-31 04:38
**用户需求**：我关掉当前笔记的标签时，如果相邻那个标签的文件刚在应用外被删了，界面就变得说不清：标签栏里我一个活动标签都没有，状态栏却还显示刚关掉的那篇，编辑区也还能继续编辑它。期望关掉标签后总有一个明确的活动标签；相邻标签打不开就继续找别的，实在没有就回到干净的空状态。
**产品经理**：做。这是多标签与打开失败交界处的状态不一致：用户已经关掉这篇，界面却把「无标签的文档」当成当前文档，容易误以为它还处于打开状态，也违背「安静、不打断」——提示之外不该留下半截界面。只调整关闭后的兜底切换，不改保存策略与产品边界。
**前端**：`features/workspace/workspace-actions.ts` 的 `closeDocumentTab`：先按与关闭位置的距离对剩余标签排序（同距离仍先右侧，保持原行为），关闭后逐个尝试打开；`openFile` 对失效文件会摘掉其标签并保留当前文档，因此每次检查当前文档是否已离开刚关闭的路径，没离开就继续；全部打不开才 `resetDocument()`。风险：正常情况下仍切到最近的邻居，只是失效邻居不再让界面停在无标签文档；同时会为每个失效候选各提示一次「打开文件失败」。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/workspace/workspace-actions.ts`（+17/−6 行），共 1 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 995ms）；未改 `src-tauri/`，未跑 cargo test。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；打开 `_c243x.md`、`_c243y.md`（另有两个旧标签），从应用外删除 `_c243x.md` 后点 `_c243y.md` 的标签内 ×：`_c243y.md` 标签消失、提示「打开文件失败：文件或目录不存在：…_c243x.md」，但状态栏仍是 `_c243y.md`、编辑区仍是 YYY，`.doc-tab.is-active` 为空。
**CDP 实测（改后）**：
- 同一序列（`_c243x2.md` / `_c243y2.md`）：关掉 `_c243y2.md` 后连续跳过两个失效邻居（各提示一次），最终打开最近的可用 `_c243a.md`，状态栏、编辑区与唯一活动标签一致，无残留无标签文档。
- 失效标签直接点击（非关闭路径）：`_c243c2.md` 被删后点其标签，仍提示「打开文件失败：文件或目录不存在」，标签自动摘除，当前 `写作示例.md` 与活动标签不变。
- 普通关闭当前标签：切到相邻 `写作示例.md`；关闭最后一个标签：回到空状态（本轮以保留单标签收尾，未额外制造空状态）。
- 保存暂停回归：`_c243b2.md` 输入后外部删除，状态栏「保存暂停」可点，点击弹「文件已不在磁盘上」三选项，取消后仍暂停；Ctrl+W 选「放弃修改」一次关闭并切到相邻标签。
**清理**：`_c243a/b/b2/c/c2/x/x2/y/y2.md` 均已删除；`settings.json` 中 `_c243*` 的光标与最近打开记录已移除（`recentDocuments` 回到仅 `写作示例.md`）；恢复副本目录为空、历史目录仍为 9 个；临时 CDP 脚本已删；应用停在单标签 `写作示例.md`，侧栏「文件」。
**检验计数**：1（下轮 244 按正常需求轮）。

## 第 242 轮 · 2026-10-31 04:34（检验轮）
**范围**：回归本窗口第 237–241 轮，不开新功能。237 删除笔记 / 文件夹清理历史快照；238 重命名 / 移动时历史快照迁移；239 外部删除后的 `not-found` 提示与重建；240 保存暂停时放弃脏标签只关一次；241 设置 / 历史 / 命令面板快捷键互斥。
**产品经理**：检验轮，只确认这五条数据安全与交互修复没有回归；发现问题按 S 级修复或记入 backlog。
**前端**：回归历史面板、`renameEntry` / `moveEntry`、`save.ts` 暂停分支与 `guardUnsaved`、`App.tsx` 弹层快捷键守卫；修复 1 处 S 级缺陷（见「问题与修复」）。
**后端**：回归 `history::clear_documents` / `move_documents`、`write_path` 的 `not-found` / `conflict` 分支；未改 `src-tauri/`。
**裁决**：检验轮（修复 1 处 S 级缺陷）。
**改动**：`src/app/App.tsx`（+13/−3 行），共 1 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.06s）；`(cd src-tauri && cargo test)` 44 项全部通过。
**CDP 实测**（9222，工作区 `D:\clawWorkSpeace\新建文件夹`）：
- 237（`_c242h.md`）：保存两版后面板 2 条、快照目录 +1；文件树 Delete → 移到回收站后文件与标签消失、快照目录同时删除（10 → 9，其余 9 个目录不变）；同路径新建后 Ctrl+Alt+H 显示「还没有历史版本」。
- 238：`_c242r.md` 存 4 版后 F2 改名 `_c242r2.md`，当前文档 / 标签跟随，历史仍 4 版；原路径新建同名笔记 0 条历史。`_c242dir` 改名 `_c242dir2` 后 `a.md` / `sub/b.md` 各保留 1 版；把 `_c242r2.md` 移动进 `_c242dir2` 仍 4 版；只改大小写 `_C242R2.md` 仍 4 版。另测文件改名往返（`b.md` → `_c242dir2.md` → `b.md`）历史未丢。
- 239：`_c242e.md` 输入后从外部删除，自动保存提示「文件已不在磁盘上…」、状态栏「保存暂停」；Ctrl+S 弹「文件已不在磁盘上」（另存为… / 重新创建 / 取消），取消不重建；再次 Ctrl+S 选「重新创建」写回原路径、状态「已保存」并提示。真实外部追加后 Ctrl+S 仍是四选项「文件已被其他程序修改」冲突框。
- 240：`_c242c.md` 脏、外部删除、等「保存暂停」后 Ctrl+W → 选「放弃修改」：标签一次关闭、切到相邻 `_c242b.md`、状态「已保存」、2.4 秒内无二次弹窗，恢复副本目录清空；同类 conflict 暂停的 `_c242k.md` 单次操作也一次关闭。取消分支保留标签 / 脏点 / 保存暂停；「保存并继续」仍进入原「文件已不在磁盘上」或冲突框，取消不落盘。
- 241：设置开着按 Ctrl+Shift+P 仍只有设置；命令面板开着按 Ctrl+, 仍只有面板；面板 / 设置开着按 Ctrl+Alt+H 不叠历史；历史开着按 Ctrl+Shift+P 仍只有历史；各自再按一次均正常关闭。
**问题与修复**：241 的互斥守卫在拦截时只 `return` 未 `preventDefault`，快捷键字符会打进命令面板搜索框——实测面板里按 Ctrl+, 输入框变 `,`、再按 Ctrl+Alt+H 变 `,h`，结果「没有匹配的命令」。在三个互斥分支（Ctrl+, / Ctrl+Shift+P / Ctrl+Alt+H）与「先打开笔记」分支补 `event.preventDefault()`；修后面板打开时两键均不再改动输入框，仍保持只有一个弹层。另：测试脚本在保存 / 冲突框尚未结束时连发 Ctrl+W 曾叠出第二个守卫框；按单次操作复测 not-found 与 conflict 两种暂停均只弹一次、切换相邻标签、恢复副本清空，判定为脚本连发时序，非产品回归，未改代码。
**清理**：`_c242h/r/r2/e/b/c/k.md`、`_c242dir2`（含 `a.md`、`sub/b.md`、`_C242R2.md`）已删除；本轮新增 4 个历史快照目录已删，历史目录回到 9 个；恢复副本目录为空；`settings.json` 已按本轮开始时备份还原；临时 CDP 脚本已删；标签回到单标签 `写作示例.md`，侧栏「文件」。
**检验计数**：0（下轮 243 按正常需求轮）。

## 第 241 轮 · 2026-10-31 04:21
**用户需求**：偏好设置打开时按 `Ctrl+Shift+P`，命令面板直接叠在设置上；反过来命令面板开着按 `Ctrl+,`，设置又在面板背后打开；按 `Ctrl+Alt+H` 也会在设置 / 命令面板上再叠一层。两个浮层同时存在，Esc 只关最上面一个，焦点和动作用哪个都不确定。期望同一时间只有一个弹层，打开另一个之前先被拦住。
**产品经理**：做。弹层是互斥的临时状态，叠在一起会抢键盘、让 Esc 与焦点归属含糊，违背「安静、不打断」；只拦快捷键入口，不改各弹层自己的功能与产品边界。
**前端**：`app/App.tsx` 的三个全局快捷键守卫各补一层互斥：`Ctrl+,` 在命令面板 / 历史打开时不响应（设置自己仍可再按一次关闭），`Ctrl+Shift+P` 在设置 / 历史打开时不响应（面板自己仍可再按一次关闭），`Ctrl+Alt+H` 在设置 / 命令面板打开时不响应（历史自己仍可再按一次关闭）；`confirm` / `prompt` 原有优先级不变。风险：只影响快捷键，工具栏 / 命令面板内的入口仍受既有弹层遮挡；未改动作本身。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/app/App.tsx`（+6/−3 行，含 3 行注释），共 1 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.02s）。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；`Ctrl+,` 打开偏好设置（`[role=dialog]` 仅「偏好设置」），再按 `Ctrl+Shift+P` → 同时存在「偏好设置」「命令面板」两个 dialog，面板 23 项可操作；反向先开命令面板再按 `Ctrl+,` → 同样两个 dialog 并存。
**CDP 实测（改后）**：
- 命令面板打开时按 `Ctrl+,`：仍只有「命令面板」（23 项）；按 Esc 关闭后 `Ctrl+,` 正常打开「偏好设置」。
- 偏好设置打开时按 `Ctrl+Shift+P`：仍只有「偏好设置」，`.palette-item` 数量 0；设置面板再按 `Ctrl+,` 正常关闭。
- 文档历史打开时按 `Ctrl+Shift+P`：仍只有「文档历史」，无命令面板；命令面板打开时按 `Ctrl+Alt+H`：仍只有「命令面板」，无历史层。
- 各自开关回归：`Ctrl+Shift+P` 再按一次关闭面板，`Ctrl+Alt+H` 再按一次关闭历史，`Ctrl+,` 再按一次关闭设置；无工作区 / 无文档时命令面板仍能打开（9 项，动作按原有过滤）。
**清理**：`_c241a.md` / `_c241b.md` 已从工作区删除（b 为外部改名后的测试文件），`settings.json` 中的 `_c241a.md` 最近打开记录已移除，恢复副本目录为空、历史目录仍为 9 个；侧栏切回「文件」，应用停在单标签 `写作示例.md`。
**检验计数**：5（下轮 242 为检验轮，回归 237–241）。

## 第 240 轮 · 2026-10-31 04:09
**用户需求**：保存被暂停时（文件被外部修改 / 删除或保存失败），我关掉这个脏标签并明确选「放弃修改」，期望它就直接关掉、切到相邻标签；现在标签关掉后立刻又弹一次「有未保存的修改」，好像我刚才的放弃没算数。
**产品经理**：做。用户已经明确放弃，同一个操作里再问一次既打断也让人不信任提示；清掉脏标记与保存暂停也能避免恢复副本在离开前把已放弃的内容写回。不改保存策略与产品边界。
**前端**：`save.ts` 的 `guardUnsaved` 在「放弃修改」分支先 `markDirty(false)`（同时清 `saveBlocked`），再清理该路径的恢复副本；后续 `openFile` / 关标签 / 切库 / 关窗口里的守卫看到文档已干净就不再重复询问。风险：放弃后若紧接着的打开失败，当前文档会显示为已保存，但用户已明确丢弃这些修改，不再弹窗更符合意图。工作量 S。
**后端**：无（未改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/editor/save.ts`（+4 行），共 1 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 996ms）。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；`_c240a.md`（有 `_c240b.md` 相邻标签）输入后从应用外删除它，等自动保存显示「保存暂停」；Ctrl+W 弹「有未保存的修改」，点「放弃修改」后标签已移除、当前文档为空，紧接着又弹出同一对话框，再点一次才打开 `_c240b.md`。
**CDP 实测（改后）**：
- 同一序列点「放弃修改」后不再二次弹窗，`_c240a.md` 标签一次关闭，当前切到 `_c240b.md`，状态栏回到「已保存」，恢复副本目录为空。
- 取消：同一暂停状态下点「取消」，标签保留、脏点仍在、状态栏仍为「保存暂停」。
- 保存：点「保存并继续」仍弹原来的「文件已不在磁盘上」对话框（另存为… / 重新创建 / 取消），取消后回到暂停状态，行为不变。
- 状态栏重试：暂停时点状态栏「保存暂停」按钮，同样弹「文件已不在磁盘上」对话框，取消不落盘。
- 普通脏标签关闭（`_c240c.md`）：未暂停，Ctrl+W 自动保存后关闭并切到相邻标签，磁盘含新输入。
- 切换标签（`_c240d.md`）：Ctrl+Tab 自动保存后切换，磁盘含新输入。
- 切换工作区 / 关窗口：都只调用一次 `guardUnsaved`，本轮未自动化（无第二个工作区；关闭窗口会结束应用），按代码路径不再有二次询问。
**已知边界**：若「放弃修改」后紧接着的打开读取失败（比如目标文件刚被删），当前文档保持打开且显示为已保存；用户已明确丢弃这份修改，不再二次询问，记录留待评估。
**清理**：`_c240a/b/c/d/e.md` 与本节新增历史快照目录（`107295b190e15ce9`、`5137e5c9a887b182`、`52bff1db5358c748`）已删除，恢复副本目录为空、历史目录回到 9 个；`settings.json` 中的 c240 最近文档 / 光标记录已移除；临时 CDP 脚本已删；应用停在单标签 `写作示例.md`。
**检验计数**：4（下轮 241 按正常需求轮）。

## 第 239 轮 · 2026-10-31 04:00
**用户需求**：我在应用外把正在写的笔记删了（同步盘 / 资源管理器），回来继续打字，状态栏只写「保存暂停」，提示说「文件已被其他程序修改」，按 Ctrl+S 又是一个「外部修改」的冲突框；期望明确告诉我文件已经不在了，并给我另存或重建的选择。
**产品经理**：做。文件被删除和内容被外部修改是两种不同的数据状态：前者的「覆盖保存」会静默重建，后者的「重新加载」无从加载；文案与选项必须如实，才符合「数据安全、不自作主张」。只区分错误与对话框，不改保存策略与产品边界。
**前端**：`save.ts` 的保存失败分支新增 `not-found` 处理：自动保存提示「文件已不在磁盘上」并暂停；手动保存弹「文件已不在磁盘上」对话框（另存为… / 重新创建 / 取消），「重新创建」复用覆盖保存路径写入原路径并提示。风险：只在用户显式选择后写盘；真正的外部修改仍走原冲突框。工作量 S。
**后端**：`write_path` 在带 `expected_modified_ms` 且目标已不存在时返回 `NotFound`（原为 `Conflict`），其他读取失败仍按冲突；不改写入的原子性与校验。新增单测覆盖「删除后保存 → not-found」「mtime 不同 → conflict」。工作量 S。
**裁决**：做。
**改动**：`src/features/editor/save.ts`（+48/−4 行）、`src-tauri/src/commands/file.rs`（+28/−1 行，含 1 条单测），共 2 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.04s）；`(cd src-tauri && cargo test)` 44 项全部通过（含新增 `missing_target_with_expected_mtime_reports_not_found`）。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；打开 `_c239a.md` 输入 `AFTER-DELETE`，在应用外删除该文件后等自动保存：状态栏「保存暂停」，提示「自动保存已暂停：文件已被其他程序修改。按 Ctrl+S 处理。」；Ctrl+S 弹出「文件已被其他程序修改」冲突框（另存副本… / 覆盖保存 / 重新加载 / 取消），与文件实际不存在不符。
**CDP 实测（改后）**：
- 同一序列：自动保存提示改为「自动保存已暂停：文件已不在磁盘上。按 Ctrl+S 另存或重新创建。」，状态栏仍为「保存暂停」。
- Ctrl+S 弹出「文件已不在磁盘上」，选项「另存为… / 重新创建 / 取消」；选「取消」后文件仍未重建，磁盘无 `_c239a.md`。
- 再次 Ctrl+S 选「重新创建」：原路径重建文件，内容为 `# C239 / MISSING-SAVE-BASE / AFTER-DELETE`，状态栏回到「已保存」，提示「已在原位置重新创建文件」。
- 「另存为…」分支打开命名框，默认名 `_c239a-副本.md`，取消不落盘。
- 回归真实外部修改：`_c239b.md` 输入后从应用外追加内容，自动保存仍提示「文件已被其他程序修改」，Ctrl+S 仍是原冲突框与四个选项。
**已排查边界（未改）**：保存被暂停（文件缺失 / 冲突）时，关闭有未保存修改的标签选「放弃修改」后，切到相邻标签会第二次弹「有未保存的修改」——`guardUnsaved` 放弃时不清脏标记，紧接的 `openFile` 又检查一次；直接清脏会在后续打开失败时误报「已保存」，需区分「确实离开文档」再处理，留待后续轮次。
**清理**：`_c239a.md`、`_c239b.md` 已删除，本轮历史快照目录 `1d51905e953c1230` 已删，恢复副本目录为空（历史目录回到 9 个）；临时 CDP 脚本已删；应用重启后停在单标签 `写作示例.md`。
**检验计数**：3（下轮 240 按正常需求轮）。

## 第 238 轮 · 2026-10-31 03:53
**用户需求**：我重命名或移动一篇存过好几版的笔记，期望历史版本跟着笔记走；现在改名后按 Ctrl+Alt+H 是空的，只有恢复副本和光标迁过去了。更糟的是旧路径的历史还留着，我在原位置新建同名笔记，能看到不属于它的旧版本。
**产品经理**：做。重命名 / 移动是同一份文档换了个位置，历史快照按「工作区 + 相对路径」关联，路径变了就应该跟着迁移；旧历史留给同名新文件既误导又有数据混淆风险。沿用第 237 轮的哈希目录操作，不改历史保留份数与面板策略。
**前端**：无改动（`renameEntry` / `moveEntry` 已迁移最近打开、浏览历史、标签、光标与恢复副本，历史由后端跟随）。
**后端**：`history::move_documents` 按新旧相对路径对迁移快照目录：新路径已有历史则保留新的、删除旧的；旧目录不存在或迁移失败静默跳过，不阻断文件操作。`rename_entry` / `move_entry` 增加 `AppHandle`，操作前用既有 `collect_history_paths` 收集旧路径（文件夹递归其下 Markdown），成功后把每条旧路径按同名前缀换成 `Entry.rel_path` 下的新路径再迁移。路径均经 `normalize_rel` / `document_dir` 校验。风险：文件夹超过 2000 篇时只迁上限内的历史；只做同工作区内迁移。工作量 S。
**裁决**：做。
**改动**：`src-tauri/src/commands/file.rs`（+37/−2 行）、`src-tauri/src/history.rs`（+62 行，含 1 条单测），共 2 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.10s）；`(cd src-tauri && cargo test)` 43 项全部通过（含新增 `moves_documents_and_keeps_existing_target`，覆盖目标已有历史时保留新删旧、无关文档不动、重复迁移空操作）。
**复现（改前，代码路径）**：保存按「工作区根 + 相对路径」哈希建快照目录；`rename_entry` / `move_entry` 只 `fs::rename` 文件，哈希目录仍挂在旧路径，改名后 `list_history` 指向不存在的新哈希目录（空），旧哈希目录仍在（同路径新建继承）。
**CDP 实测（改后，9222，工作区 `D:\clawWorkSpeace\新建文件夹`）**：
- `_c238a.md` 保存出 4 个版本后 F2 改名 `_c238b.md`：树与当前文档跟随更新，Ctrl+Alt+H 仍列出 4 版，最新预览 `C238-VERSION-THREE`。
- 同路径新建 `_c238a.md` 后打开：历史面板 0 条，不再继承改名前的版本。
- 文件夹 `_c238dir`（`a.md`、`sub/b.md` 各 1 份历史）重命名为 `_c238dir2`：两篇分别打开历史均为 1 条，预览 `DIR-A-V1` / `DIR-B-V1`。
- 把 `_c238b.md` 移动到 `_c238dir2`：4 个版本随文档迁移，预览不变。
- 只改大小写 `_c238dir2/_c238b.md` → `_C238B.md`：4 个版本仍在。
**已知边界**：单次迁移文件夹最多 2000 篇 Markdown，超出部分历史留在旧路径；定位不到应用数据目录或迁移失败时静默跳过（与删除清理一致）。
**清理**：`_c238a.md`、`_c238dir2`（含 `a.md`、`sub/b.md`、`_C238B.md`）用 `delete_entry` 删除并清掉对应历史，应用数据中已无 C238 快照与恢复副本；测试标签全部关闭，未保存提示选「保留」后关掉；应用停在单标签 `写作示例.md`。
**检验计数**：2（下轮 239 按正常需求轮）。

## 第 237 轮 · 2026-10-31 03:41
**用户需求**：我把一篇存过好几版的笔记（或整个文件夹）删进了回收站，期望它的历史快照也一起清掉；现在应用数据里的历史目录一直留着占地方，而且在同一路径新建同名笔记后按 Ctrl+Alt+H 还能看到删除前的旧版本，数据对不上。
**产品经理**：做。删除是用户明确的数据处置，历史快照只对仍存在的文档有意义；删后残留既占空间，又会让同名新文件继承旧历史，违背「本地优先、数据安全、不自作主张」。只补删除时的清理，不改历史保留份数与面板策略。
**前端**：无改动（删除仍走既有 `delete_entry`，重命名 / 移动到回收站等入口行为不变）。
**后端**：`delete_entry` 增加 `AppHandle`，删除前收集目标下的 Markdown 相对路径（文件夹递归、上限 2000），移到回收站成功后调用 `history::clear_documents`，按「工作区根 + 相对路径」的既有哈希删除快照目录；定位不到应用数据目录、清理失败都静默跳过，不阻断删除本身。只删应用数据目录 `history/` 内由该模块生成的目录，路径经 `normalize_rel` / `resolve_in_workspace` 校验。风险：删除大目录时多一次遍历（有上限）；文件名大小写 / 路径编码与保存时一致才命中。工作量 S。
**裁决**：做。
**改动**：`src-tauri/src/commands/file.rs`（+81/−3 行）、`src-tauri/src/history.rs`（+32 行，含 2 条单测），共 2 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.15s）；`(cd src-tauri && cargo test)` 42 项全部通过（含新增 `clears_only_target_documents`、`collects_history_paths_for_files_and_folders`）。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；`_c237h.md` 保存两次（`HIST-TWO` / `HIST-THREE`），生成 `history/fd696841d7007e97` 两份快照；在文件树选中按 Delete 确认删除后，笔记从树与磁盘消失，但该快照目录仍在。
**CDP 实测（改后）**：
- 同路径重建 `_c237h.md` 后打开：Ctrl+Alt+H 仍列出删除前的 `HIST-THREE`（复现数据混淆）；再次保存并删除后，`fd696841d7007e97` 目录消失。
- 再同路径新建 `_c237h.md`：历史面板显示「还没有历史版本」，旧版本不再可见。
- 文件夹 `_c237dir`（`a.md`、`sub/b.md`）各自保存后再删除整个文件夹：确认框正确提示 2 个文件 / 1 个子文件夹，删除后 3 个快照目录全部消失（历史目录数 12 → 10）。
- 不误清：同期保存过的无关笔记 `_c237keep.md` 删除文件夹后历史仍在，Ctrl+Alt+H 能看到 `KEEP-TWO`；该笔记自身删除后其快照也被清掉。
**已知边界**：单次删除文件夹的清理遍历上限 2000 个 Markdown；超出的文档快照会残留（不新增可见问题，后续可按需处理）。原生目录选择与系统回收站恢复未自动化。
**清理**：`_c237h.md`、`_c237keep.md`、`_c237dir` 及本轮新增快照目录均已清除，历史目录回到开始时的 9 个；临时 CDP 脚本已删；应用停在单标签 `写作示例.md`。
**检验计数**：1（下轮 238 按正常需求轮）。

## 第 236 轮 · 2026-10-31 03:37（检验轮）
**范围**：回归本窗口第 231–235 轮，不开新功能。231 组词中保存 / 关标签 / 关窗口不落半截拼音；232 保存前 / 写盘后路径校验与打开请求序号；233 关闭 / 点回标签作废在途打开、未保存切换 / 撤销 / 外部冲突；234 连续切库的库代号守卫与正常切库自动保存；235 删除笔记 / 文件夹清理其恢复副本。
**产品经理**：检验轮，只确认这五条数据安全与竞态修复没有回归、没有引入新的静默覆盖；发现问题按 S 级修复或记入 backlog。
**前端**：回归 `composition` / `save` / `recovery`、`workspace-actions` 的打开与切库序号、`tabs-memory` 暂停计数；不做代码改动。
**后端**：无（未改 `src-tauri/`）。
**裁决**：检验轮（无源码改动）。
**改动**：无产品代码，仅 `docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc，vite 1.41s）；未改 `src-tauri/`，未跑 `cargo test`。
**CDP 实测**（9222，工作区 `D:\clawWorkSpeace\新建文件夹`；`Input.dispatchKeyEvent` / `Input.imeSetComposition` / 真实点击与 DOM 校验）：
- 231（`_c236ime.md`）：源码视图组词 `nihao` 时编辑器显示拼音、预览仍停在已提交文本；组词中按 Ctrl+S 等 1 秒读盘，文件未写入拼音；组词中按 Ctrl+W 约 2 秒后弹出「有未保存的修改」，选「放弃修改」后标签关闭，磁盘保持原样、无 `shijie`。提交后的最终汉字随后续保存正常落盘（`开头你好BC测试NORMAL-SAVE`），全程未出现拼音入盘。关窗口复用 `flushAutoSave → saveActiveDocument` 同一路径，未单独关窗（避免结束运行中的应用）。
- 232（`_c236v.md` / `_c236o.md`，8MB `_c236slowA/B`）：VICTIM 组词中按 Ctrl+S 后立刻点开 OTHER 并提交，约 1.8 秒后当前为 OTHER，两篇磁盘正文均保持原样、无整篇串写；同一 tick 点 8MB A 与 B 停在最后点的 B；点 A 后 100ms 点回当前 B，2.6 秒内仍停在 B；8MB A 打开后再点其标签并在 3ms 内关掉，A 不再冒出来、当前始终 B。
- 233：编辑 `_c236undo.md` 后直接切走，等待自动保存再切回，正文与撤销历史都在；Ctrl+Z 回原文、Ctrl+Y 重做正常。`_c236conf.md` 外部改写后 Ctrl+S 弹冲突框：覆盖保存写回编辑器内容、重新加载显示磁盘版本、另存副本生成 `_c236conf-副本.md` 且两边的修改都保留，三条分支均通过。
- 234（`_c236libA` 根目录 6 万个非 Markdown 文件把 `list_dir` 拖慢）：正常切换 A ↔ B 时文件树、标签、正文、状态栏路径都只属于当前库；在 A 编辑后切到 B 的自动保存生效，切回 A 内容仍在、标签恢复。连点：点 A 后约 38ms 点 B，采样显示 A 的标签栏 / 文档恢复从未落地，最终只有 B 的文件树与 `B-ONLY.md`；随后正常切回 A，A 的标签与正文完整恢复（旧请求没有抹掉 A 的记录），设置里 `lastWorkspace` / 最近工作区顺序与最后一次选择一致。测试库的「最近工作区」记录在收尾用菜单 × 移除。
- 235（`_c236del.md` / `_c236keep.md` / `_c236dir/x.md`）：未保存内容经窗口失焦写入恢复副本后整页重载模拟崩溃，弹出恢复提示；选「稍后」、关标签、删笔记后恢复副本目录为空，重载不再提示，文件未复活。恢复副本存在时删除无关的 `_c236conf-副本.md`，该副本保留、重载仍提示，选「丢弃副本」后清空。文件夹 `_c236dir` 带子文件 `x.md` 的副本时整目录删除，副本目录为空、重载无提示。
**问题与修复**：未发现产品缺陷，本轮无源码改动。两条观察：① 保存过的笔记删除后历史快照目录仍保留（本轮 `_c236del.md` 留下 `dc4d2cd1ce1fe1bb`，与 235 记录一致，属已记录的后续需求）；② CDP 的 `Input.imeSetComposition` + `Input.insertText` 连续使用后会让 CodeMirror 处于残留组词态（DOM 有字但 `onChange` / 脏标记不触发），需整页重载后再继续输入，属测试工具限制，不影响真实键盘输入；后续输入法回归建议每组 IME 用例后重载页面。
**清理**：`_c236ime/v/o/slowA/B/C/keep/undo/conf.md`、已删的 `_c236del.md`、`_c236conf-副本.md`、`_c236dir` 与 `_c236libA/B`（6 万临时文件）均已删除；本轮 7 个历史快照目录（`05c7a62ae2d840de`、`2cc12b016d1d32bc`、`4f0bc41fca765336`、`516d6f0ee8792352`、`c689c5ec7a211ea4`、`dc4d2cd1ce1fe1bb`、`f210e5455fd123a3`）已删，恢复副本目录为空；「最近工作区」里的测试库已用菜单移除，`settings.json` 已按本轮开始时的备份还原；临时 CDP 脚本已删；应用停在单标签 `写作示例.md`。
**检验计数**：0（下轮 237 按正常需求轮）。

## 第 235 轮 · 2026-10-31 03:25
**用户需求**：我有一篇笔记留着未保存修改（崩过一次、启动时先点了「稍后」），后来把这篇笔记删进回收站；期望删掉就是删掉，恢复副本别再把文件「复活」，也不想它一直占着应用数据目录。
**产品经理**：做。删除是用户明确的数据处置，恢复副本只能在文件仍存在或崩溃后首次启动时提示；删掉后仍残留、下次启动「恢复为文件」违背「数据安全、不自作主张」，只补删除时的清理，不改恢复策略与产品边界。
**前端**：`recovery.ts` 新增 `clearRecoveryForEntry(relPath)`：等正在写的副本落盘后列出当前工作区副本，删除路径本身及子目录下的全部副本（`isWithin`），并重置最近写入缓存；`workspace-actions.ts` 的 `deleteEntry` 在删除成功、处理完当前文档与光标后调用它，替掉只清当前打开文档的旧逻辑。风险：只清被删路径，其他笔记的副本不受影响；清理失败不阻止删除。工作量 S。
**后端**：无（仍走既有 `delete_entry` / `list_recoveries` / `delete_recovery`，不改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/editor/recovery.ts`（+23/−1 行）、`src/features/workspace/workspace-actions.ts`（+4/−1 行），共 2 个文件。
**构建**：`bun run build` 通过（含 tsc，vite 1.44s）；未改 `src-tauri/`，未跑 `cargo test`。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；`_c235a.md` 输入 `C235-UNSAVED` 后约 1 秒生成恢复副本，立即整页重载模拟崩溃；启动弹出「发现未保存的恢复副本」，选「稍后」；Ctrl+W 关掉唯一标签，再在文件树选中 `_c235a.md` 按 Delete、确认「移到回收站」。此时 `%APPDATA%\com.myfinal.feiye\recovery` 里 `_c235a.md` 的副本仍在；再次启动弹出「原文件已经不在。可以把它写回原来的位置」，点「恢复为文件」后 `_c235a.md` 被重建，正文是已删除的 `C235-UNSAVED`。
**CDP 实测（改后）**：
- 同一序列删除 `_c235a.md` 后恢复副本目录为空，重载启动不再出现任何恢复提示，文件树与磁盘都没有 `_c235a.md`。
- 删除文件夹：`_c235dir/x.md` 留下副本后关闭标签、删除整个 `_c235dir`，副本目录为空，重载无提示。
- 不误清：`_c235c.md` 保留副本，期间删除无关的 `_c235d.md`；重载仍正常提示 C 的副本，「丢弃副本」后目录清空。
**已排查（未改）**：保存过的笔记删除后，历史快照目录仍会保留（`_c235h.md` 保存一次后删除，`history/c8de2c25ae2a8191` 仍有 1 份），单个文档上限 20 份、每份 8MB；本轮按候选 A 范围只清恢复副本，历史清理留作后续需求评估。
**清理**：测试笔记 `_c235a/c/d/h`、`_c235dir` 与测试产生历史快照 `c8de2c25ae2a8191` 已删，恢复副本目录为空，`settings.json` 已按本轮开始时的备份还原，临时 CDP 脚本已删；应用停在单标签 `写作示例.md`。
**检验计数**：5（下轮 236 按检验轮回归 231–235）。

## 第 234 轮 · 2026-10-31 03:17
**用户需求**：我快速从 A 库切到 B 库（或打开一个很大的库又立刻换走），切过去以后标签栏里冒出 A 库的笔记，A 的「上次打开的文档」还可能被继续拿来恢复；期望切到哪个库就只看到哪个库的东西，慢读的旧库结果不能落到新库。
**产品经理**：做。跨库串标签 / 串「上次文档」违背「本地优先、安静、数据安全」；只加请求序号与库代号守卫，不改切库行为与产品边界。
**前端**：`stores/workspace.ts` 增加库代号，`setWorkspace` 时递增，`loadDir` 结果返回后比对代号，过期结果（含失败提示）直接丢弃；`workspace-actions.ts` 给 `openWorkspaceAt` / `restoreLastWorkspace` 加切库请求序号，读盘、恢复标签、上次文档前后都校验，过期请求不再写 `lastWorkspace`、不恢复旧库标签、不打开旧库文档；`tabs-memory.ts` 的暂停落盘改为计数，过期请求只释放不写盘，避免旧库的结束把标签记录抹掉。风险：连续切库只有最后一次生效（符合预期）；无新增依赖。工作量 S。
**后端**：无（仍走既有命令，不改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/stores/workspace.ts`、`src/features/workspace/workspace-actions.ts`、`src/features/workspace/tabs-memory.ts`，共 3 个文件（+71/−10 行）。
**构建**：`bun run build` 通过（含 tsc，vite 1.52s）；未改 `src-tauri/`，未跑 `cargo test`。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；A 库 `_c234libA` 根目录放 48 万个非 Markdown 文件，把 `list_dir` 拉到约 300ms（树里仍只有 2 篇 md），B 库 `_c234libB` 只有 `B-ONLY.md`；A 的库记录里有两个标签、上次文档 `A-ONLY.md`。先点 A，约 20ms 后再从「最近工作区」点 B：约 3 秒后当前库是 B、正文 `B-ONLY.md`，但标签栏多出 A 库的 `A-EXTRA.md`，说明 A 的后续恢复仍在新库里执行。
**CDP 实测（改后）**：同一脚本切到 B 后，标签只有 `B-ONLY.md`、文件树只有 `B-ONLY.md`，`lastWorkspace` 为 B，B 的「上次文档」保留；A 的标签记录没有被旧请求抹掉——随后正常点开 A，两个 A 标签与上次文档 `A-ONLY.md` 都完整恢复。
**回归（CDP 真实点击 / 输入）**：正常切 A → 点 `A-EXTRA.md` → 切回原库，标签、正文、文件树、状态栏路径都只含当前库；编辑后立即切库走自动保存，切回内容仍在，示例文件已还原；子目录收起 / 展开（aria-expanded 与子项显隐）正常；应用停在单标签 `写作示例.md`。
**已排查边界（未改）**：Tauri 同步命令按到达顺序执行，A 的根目录读取先于 B 的 `open_workspace` 时，结果通常会在 B 清空树之前返回，因此没复现「A 的目录条目直接显示在 B 的树里」；守卫仍覆盖该时序（含子目录与展开恢复的每次 `loadDir`）。原生目录选择无法自动化，未测。
**清理**：`_c234libA` / `_c234libB`（48 万临时文件）已删除，测试期间的设置写入已按备份还原，含测试标记的两个历史快照 `1793387747139.md` / `1793387748792.md` 已删，恢复副本目录为空，临时 CDP 脚本已删；应用停在单标签 `写作示例.md`。
**检验计数**：4。

## 第 233 轮 · 2026-10-31 03:00
**用户需求**：我点开一篇大笔记又马上反悔——点回当前标签，或把还在转的那篇标签关掉，结果它读完后还是自己蹦出来、顶掉我正在写的文档；期望关掉 / 点回就以最后一次操作为准，慢读的旧请求不能翻盘。
**产品经理**：做。232 轮的打开序号只挡住了「再点另一篇」，没挡住「关标签 / 点回当前标签」；慢读完成后把已关闭的标签加回来并抢走当前文档，违背「安静、不自作主张」，只补时序守卫，不改打开行为与产品边界。
**前端**：`workspace-actions.ts` 记录在途打开的目标路径，关闭该标签时作废这次打开（序号 +1），打开成功 / 取消 / 失败时清理记录；`TabBar.tsx` 点击当前标签也走一次 `openFile`，由序号作废在途打开（同一路径立即返回，无其它副作用）。风险：只有目标路径被关闭才取消，关别的标签不影响在途打开。工作量 S。
**后端**：无（仍走既有读文件命令，不改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/workspace/workspace-actions.ts`（+25/−2 行）、`src/features/tabs/TabBar.tsx`（+2/−1 行），共 2 个文件。
**构建**：`bun run build` 通过（含 tsc，1.36s）；未改 `src-tauri/`，未跑 `cargo test`。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；`_c233a.md` 为 7.6MB 慢读文件且已是非当前标签，当前 `_c233b.md`。点击 A 后 5ms 点 A 标签的 ×：A 标签先消失，约 800ms 后 A 被重新加回并成为当前文档，B 被顶掉。另一路径：点 A 后 30ms 点仍高亮的 B 标签，点击被 `isActive` 提前返回吞掉，约 240ms 后 A 仍打开。
**CDP 实测（改后）**：
- 同一关标签脚本：A 标签关闭后 2.4 秒内不再出现，当前始终 `_c233b.md`；再正常点 A 仍可打开（作废状态不残留）。
- 点 A 后 30ms 点当前 B 标签：2 秒内保持 `_c233b.md`，A 不再打开。
- 普通标签切换 / 关闭非当前标签正常，当前文档不被无关操作影响。
**回归（第 232 轮相关，CDP 真实输入）**：
- 未保存切换 / 撤销：`_c233v.md` 编辑后切走（自动保存）再切回，正文保留；Ctrl+Z 回到原文、Ctrl+Y 重做，脏标记正确；7.6MB A 与 B 同一 tick 连点仍停在最后点击的 B。
- 保存状态栏 / 组词：Ctrl+S 后状态变「已保存」，磁盘内容一致；组词 `ceshi` 中按 Ctrl+S，提交「测试」后磁盘为已提交文字，无拼音。
- 外部冲突：磁盘外部改动后 Ctrl+S 弹「文件已被其他程序修改」；重新加载取磁盘版本、覆盖保存写编辑器版本、另存副本生成 `_c233r-副本.md` 并切换，三者均正常。
**已排查边界（未改）**：
- `reloadActiveDocument` 有读盘后路径校验；冲突重载与切走后不套回旧正文均正常。读盘期间切走再切回同一篇时理论上仍可能应用较早读到的内容，需两次切换落在同一次慢读窗口内，本轮未复现。
- 恢复副本「恢复内容」后立刻点 B：7.9MB 慢读的恢复先上屏、B 随后覆盖，最终停在 B，无错路径正文写入，副本仍在；Tauri 读命令按发起顺序返回，未出现 B 先到而被 A 覆盖。
- 切换工作区：`resetDocument` 已作废在途打开；但 `loadDir` 结果不带库标识、连续切换工作区没有请求序号，属 M 级，本轮未改（当前最近工作区只有一项，原生目录选择无法自动化稳定复现）。
**清理**：`_c233a/b/o/r/v/rec.md` 与 `_c233r-副本.md` 已删除，对应历史快照目录 `32a0fcc94db13879` / `21e4fcec0782f955` 与恢复副本 `2efa0154287cfed1.json` 已删，临时 CDP 脚本已删；应用停在单标签 `写作示例.md`。
**检验计数**：3。

## 第 232 轮 · 2026-10-31 02:52
**用户需求**：开着输入法打中文时按 Ctrl+S，又顺手点开另一篇笔记，结果原来那篇的源文件被另一篇的正文覆盖了；期望保存与打开各认各的文档，切换期间绝不把 B 的正文写进 A 的文件。
**产品经理**：做。上一轮记录的「路径与正文短暂不一致」已复现为真实串写，属于「本地优先、纯文本、数据安全」底线内的缺陷；只加时序守卫，不改保存与打开的对外行为，不扩大产品边界。
**前端**：`save.ts` 保存前在等组词结束后重新校验当前路径，写盘后再读正文时也校验是否仍停在同一篇；覆盖保存 / 重新加载同样加路径守卫。`workspace-actions.ts` 给 `openFile` 加打开请求序号，读盘、展开目录、恢复光标返回后都丢弃过期结果，点回当前标签会作废进行中的打开，`resetDocument` 也作废在途打开。风险：连续打开时只有最后一次生效（符合预期）；保存等待期间切走会直接放弃本次落盘（内容未丢，切回后可再存）。工作量 S。
**后端**：无（仍走既有读写命令，不改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/editor/save.ts`（+18/−5 行）、`src/features/workspace/workspace-actions.ts`（+19 行），共 2 个文件。
**构建**：`bun run build` 通过（含 tsc，1.39s）；未改 `src-tauri/`，未跑 `cargo test`。
**复现（改前）**：CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；`_c232v.md`（VICTIM）为当前文档，`Input.imeSetComposition` 组词 `nihao` 后按 Ctrl+S（保存进入等待组词），随即点开 `_c232o.md`（OTHER）并触发 `compositionend`，保存恢复后磁盘上 `_c232v.md` 变成 `# OTHER-HEAD / OTHER-UNIQUE-CONTENT`，VICTIM 正文被整篇覆盖。
**CDP 实测（改后）**：
- 同一复现脚本：`_c232v.md` 保持 `VICTIM-UNIQUE-CONTENT`，OTHER 不再串入；组词中保存仍不落拼音。
- 普通保存：文末输入 `X-NORMAL` 后 Ctrl+S，磁盘写为 `…VICTIM-UNIQUE-CONTENT\nX-NORMAL`；再组词 `ceshi` 按 Ctrl+S、提交「测试」后磁盘为 `X-NORMAL测试`，无拼音。
- 快速连点：同一 tick 依次点开 8 MB 的 `_c232a.md` 与 `_c232b.md`，最终停在最后点的 `_c232b.md`、正文与标签一致；先点 `_c232a.md`（慢读）再点回当前 `_c232b.md`，2.5 秒后仍停在 `_c232b.md`，在途的 A 被作废。
**清理**：`_c232a/b/v/o.md` 已删除，测试历史快照目录 `f267712b36534f62` 已删，恢复副本为空，临时 CDP 脚本已删；整页重载后应用停在单标签 `写作示例.md`。
**检验计数**：2。

## 第 231 轮 · 2026-10-31 02:37
**用户需求**：用中文输入法打字时，拼音还没上屏就顺手按了 Ctrl+S（或切标签、关窗口），结果源文件里被写进半截拼音，恢复副本里也会带着拼音；期望先等输入法提交，再按最终汉字落盘，组词没结束就宁可先不写。
**产品经理**：做。219 轮只推迟了自动保存、预览与统计，手动保存 / 关闭路径仍会读取未上屏拼音，属于「数据安全」底线内的缺陷；只改等待时机，不改保存与恢复行为，不扩大产品边界。
**前端**：`src/features/editor/composition.ts` 增加组词结束等待（带 2 秒超时）；`save.ts` 手动 / 自动保存前等待，超时放弃本次写盘并提示；`recovery.ts` 恢复副本快照同样等待。风险：组词异常不结束时保存会被推后；只影响组词中的落盘时机。工作量 S。
**后端**：无（仍走既有写文件命令，不改 `src-tauri/`）。
**裁决**：做。
**改动**：`src/features/editor/composition.ts`（+28 行）、`src/features/editor/save.ts`（+10 行）、`src/features/editor/recovery.ts`（+5 行），共 3 个文件。
**构建**：`bun run build` 通过（含 tsc，1.17s）；未改 `src-tauri/`，未跑 `cargo test`。
**CDP 实测**（9222，工作区 `D:\clawWorkSpeace\新建文件夹`；`Input.imeSetComposition` / `Input.insertText` / `Input.dispatchKeyEvent`）：
- 临时笔记 `_c231ime.md`，源码视图，文末输入 `A` 后组词 `nihao`（DOM 中可见 `Anihao`，预览仍停在 `A`）；组词中按 Ctrl+S，等待 0.9 秒读盘：文件仍是「# IME 测试 / 开头」，不含拼音。
- `Input.insertText` 提交「你好」后，被推迟的保存自动落盘为 `A你好`，磁盘不含 `nihao`；再按 Ctrl+S 内容不变。
- 组词中关标签：先输入已提交的 `B` 制造脏状态，再组词 `shijie`，按 Ctrl+W；2 秒后弹出「有未保存的修改」而非写入拼音，选择「放弃修改」后标签关闭，磁盘只保留已提交的 `A你好`，不含 `shijie`。
- 关窗口复用同一保存路径（`flushAutoSave` → `saveActiveDocument`），按代码路径确认；真实 IME 人工复现：组词中按 Ctrl+S → 预期不出现拼音，提交汉字后自动保存。
**观察（留待后续）**：首次测试时连续快速点击文件树中的两个笔记（间隔 0.5 秒），曾出现标签路径与编辑器正文短暂不一致、保存把 A 文档正文写入 B 文档的迹象；慢速重试未复现，疑似打开文档的异步竞态，建议下一轮专项复现确认。
**清理**：`_c231ime.md` / `_c231ime2.md` 已删除，对应历史快照目录 `b2d643bea107d7f2` 已删，恢复副本目录为空，临时 CDP 脚本已删；整页重载后应用停在单标签 `写作示例.md`。
**检验计数**：1。

## 第 229 轮 · 2026-10-31 02:27（检验轮）
**范围**：回归本窗口第 219–228 轮，不开新功能。按优先级实测 219 输入法组词、226 恢复副本写盘去重、227 代码块复制委托、228 冷启动 / 整页重载恢复；221 / 222 因窗口时间不足未重跑（相关代码自 224 检验轮后未变），留待下次检验轮。
**产品经理**：检验轮，只确认前十条改动未破坏输入、恢复、预览与标签行为；发现问题按 S 级修复或记入 backlog。
**前端**：回归 `editor-setup` / `autosave` / `recovery`、`PreviewPane` 复制委托、启动恢复与标签；不做代码改动。
**后端**：无。
**裁决**：检验轮（无源码改动）。
**改动**：无产品代码，仅 `docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc，1.10s）；未改 `src-tauri/`，未跑 `cargo test`。
**CDP 实测**（9222，工作区 `D:\clawWorkSpeace\新建文件夹`；`Input.imeSetComposition` / `Input.insertText` / 真实点击）：
- 219（分栏，`_c229ime.md`）：光标置文末，组词 `nihao` 暂停 2.4 秒，预览保持「开头 你好你好你好」不含 `nihao`；提交「词典」后预览追加「词典」。磁盘最终内容只含已提交文字、无拼音；期间自动保存未落盘组词。本轮未单独读取字数（测试脚本状态栏选择器未命中，不影响产品判断）。
- 226（`_c229copy.md`，自动保存设为「关闭」、恢复间隔临时改 2 秒）：输入 `A` 后 2.6 秒内恢复副本出现；再无改动等 2.6 秒，mtime 完全不变；输入 `B` 后 mtime 立即更新；`Ctrl+S` 保存后副本文件被删除。设置已恢复为 1.8 秒 / 4 秒。
- 227（`_c229copy.md` 分栏）：2 个代码块、2 个复制按钮；行内代码无按钮。点首块复制得 `const a = 1;\r\nconsole.log(a + b);`，按钮显示「已复制」且 `aria-label` 为「已复制代码」，1.6 秒后复位「复制」；第二块中文多行复制得 `print("你好，世界")\r\nprint("第二行")`。
- 228（整页 `Page.reload`）：3 个标签（`写作示例.md`、`_c229ime.md`、`_c229copy.md`）按原顺序恢复，活动标签 `_c229copy.md`、分栏模式、正文与之前一致。
- 221 / 222：本轮时间不足未重跑；224 检验轮已覆盖关闭标签缓存释放、重开 / 切回预览与光标撤销、图片图注 / 锚点 / 复制 / Mermaid，且 225–228 未触及这些模块。
**问题与修复**：未发现产品缺陷，无需修复；没有为产出硬改代码。
**清理**：`_c229ime.md` / `_c229copy.md` 已删除，对应历史快照目录 `2ec84ab978f75e57` / `b07f64253c783655` 与恢复副本已清理，临时 CDP 脚本已删；应用停在单标签 `写作示例.md`（分栏）。
**检验计数**：0。

## 第 228 轮 · 2026-10-31 02:22
**用户需求**：一篇五十万字符的笔记，关掉应用或整页重载后，要等多久才能重新打字看预览？现在感觉要愣一下，而且恢复副本、上次打开的标签和视图模式不能丢。
**产品经理**：做（先测量再定）。冷启动到可输入是「快、安静」的第一印象；若拆解发现只是浏览器解析 / 排版且无应用层冗余，则如实记录不改代码，不扩大产品边界。
**前端**：候选为 `src/app/App.tsx` 启动恢复、`features/workspace/workspace-actions.ts`（读设置 / 读文件 / 恢复标签）、`features/editor/editor-setup.ts`（EditorState 创建）、`features/outline`（首次大纲）、`features/preview/PreviewPane.tsx`（首次注入）。风险：启动链路涉及恢复副本提示与光标 / 标签恢复；工作量 S（测量）。
**后端**：无（读文件仍走既有命令，不改 `src-tauri/`）。
**裁决**：不改代码。冷启动到可输入 145ms、首屏 116ms，应用层函数累计不足 5ms；唯一长任务 123ms 是 500k HTML 的预览 DOM 注入与浏览器排版，S 级无冗余可省。
**改动**：无（仅 `docs/loop/state.md`、`docs/loop/backlog.md`）。
**构建**：`bun run build` 通过（含 tsc）；未改 `src-tauri/`，未跑 `cargo test`。
**测量（CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`）**：临时笔记 `_c228big.md`（500,013 字符 / 1,397,933 字节，2,500 个二级标题 + 正文），分栏模式打开后作为上次文档，`Page.reload` 整页冷启动；`addScriptToEvaluateOnNewDocument` 在文档起点装 MutationObserver / PerformanceObserver，并用 Profiler（100µs 采样）记前 2.5 秒调用栈。
- 时间线（以导航起点计）：`DOMContentLoaded` 80ms、first-paint 92ms、FCP 116ms、编辑器与正文 DOM 145ms、状态栏字数与当前标签 284ms、预览第 100 块 697ms、第 1000 块 697ms、最终 5,384 个块约 825ms。
- 拆解：读文件 + `EditorState` 创建 + 正文挂载合计约 64ms（`load` 81ms → 编辑器 145ms）；状态栏/大纲延迟来自 150ms 去抖（`countTextStats` 单次 3.6ms）；预览 Worker 解析约 550ms 在后台线程，主线程只在 702ms 发生 1 个 123ms 长任务（注入 500k HTML + 5,384 个节点 + 首帧排版）。
- CPU 采样（前 2.5 秒）：应用函数自耗时最高为 `countTextStats` 3.6ms、`cleanHeadingText` 0.9ms、`patchPreviewBlocks` 1.1ms，其余均 <1ms；开发态 `jsxDEV` 合计 38.6ms；约 95% 采样落在 native / idle。无「预览在源码 / 所见模式下仍解析」的情况（本轮为分栏，预览本就可见；源码 / 所见路径在 205 轮已停掉）。
- 结论：内容可编辑已接近首屏（145ms），文件读取与 EditorState 创建没有可再省的整篇工作；123ms 长任务全在浏览器解析 500k HTML 与排版，削减需分片注入 / 视口懒构建（M 级），本轮不改代码。
**回归（CDP 真实输入 + 整页重载）**：
- 冷启动恢复：活动标签 `_c228big.md`、分栏模式、光标 1:1、状态栏 418,600 字、预览 5,384 个块，首行 `## 第 1 节 冷启动测试标题`，无脏标记。
- 未保存 / 恢复副本：`Input.dispatchKeyEvent` 在文首输入 `Z`（字数 418,601、状态「待保存」），1.25 秒后整页重载，弹出「发现未保存的恢复副本」，按钮「恢复内容 / 丢弃副本 / 稍后」，磁盘版正文完整（418,600 字）；点「丢弃副本」后对话框关闭、脏标记消失、正文不含 `Z`，活动标签仍为 `_c228big.md`。
- 标签与视图模式：重载后只恢复当时打开的 1 个标签；分栏保持。跨标签切换后关闭临时标签只剩 `写作示例.md`，状态恢复「已保存」。
**清理**：`_c228big.md` 已删除；临时 CDP 脚本已删；应用回到单标签 `写作示例.md` 分栏，上次文档已恢复为 `写作示例.md`。
**检验计数**：4。

## 第 227 轮 · 2026-10-31 02:11
**用户需求**：一篇两千多个代码块的长笔记，切到分栏 / 纯预览时明明内容早就解析完了，界面还要再卡一下；期望代码块的语言标签和复制按钮别拖慢上屏，复制照常可用。
**产品经理**：做。预览上屏属于「快、安静」的核心体验；只改按钮挂载方式，不改外观与交互，不扩大产品边界。
**前端**：`src/features/preview/PreviewPane.tsx`：把每个复制按钮上的 mousedown / click 监听改为预览容器上一组委托监听，按钮只留标记；复制内容、成功 / 失败反馈、1.5 秒复位、行内代码不误触都保持不变。风险：委托后新按钮需能正确找到所属 `pre`，按块更新与增量上屏路径要回归。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/preview/PreviewPane.tsx`（42 增 / 26 删，1 个文件）。
**构建**：`bun run build` 通过（含 tsc，1.41s）；未改 `src-tauri/`，未跑 `cargo test`。
**测量（CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`）**：临时笔记 `_c227code.md`（397KB，2500 个 3–5 行代码块）、`_c227plain.md`（126KB，2500 段纯文本），均为源码模式打开后切分栏；从切换起用 MutationObserver 记录首个 2500 `pre` 与 2500 复制按钮出现的时间，并采集长任务、节点数与堆内存。
- 改前：注入 160ms、按钮齐备 562ms（装饰窗口约 400ms），长任务 139 / 352ms；`markdown-body` 内 87,492 个节点，每个按钮 2 个监听器（2500 块共 5,000 个），堆 73.8MB。
- 改后：注入 145ms、按钮齐备 608ms，长任务 135 / 406 / 56ms；节点数与 87,492 相同，按钮监听器 0，容器只有 1 个 click + 1 个 mousedown 委托，堆 73.5MB。
- 对照：无代码块文档 `markdown-body` 仅 2,501 个节点、整页 3,053 个节点，说明代码块装饰的 8.5 万节点来自 Shiki 语法高亮本身；本轮去掉的 5,000 个监听器没有改变上屏耗时（差异在长任务波动内），约 400ms 的装饰窗口主要花在创建 2,500 个包装 div / 按钮与浏览器排版，S 级无法再靠委托消除。
- 结论：监听器不是瓶颈，但委托把 5,000 个闭包降为 2 个且行为不变，保留改动；如实记录「上屏耗时前后持平」。
**回归（CDP 真实点击）**：
- `_c227copy.md`（英文多行 JS + 中文 Python）两块均可复制，剪贴板分别为 `const a = 1;…console.log(a + b);` 与 `print("你好，世界")…`，按钮显示「已复制」、`aria-label` 为「已复制代码」，1.5 秒后复位为「复制」；行内代码 `const inline = 1;` 不生成按钮、不误触。
- 分栏下在编辑器里新增一个 `js` 代码块，预览增量出现第 3 个块，点击新块复制到 `console.log(42);`，说明按块更新后的新按钮同样走委托。
- 主题切换与撤销不涉及按钮监听路径（未改编辑 / 主题代码），人工复现：打开含代码块笔记 → 分栏 → 偏好设置切深色再切回，按钮「复制 → 已复制」正常；编辑后再 `Ctrl+Z`，按钮仍可复制。
**清理**：`_c227code.md` / `_c227plain.md` / `_c227copy.md` 已删除，对应历史快照目录 `44b4913878b28def` 已删，临时 CDP 脚本已删，应用回到单标签 `写作示例.md` 分栏。
**检验计数**：3。

## 第 226 轮 · 2026-10-31 02:04
**用户需求**：我把自动保存关掉、只靠恢复副本防崩溃，结果停在一段没改的脏文本上，硬盘灯每几秒闪一次——同样的内容被整篇反复写；期望内容没变就不重复写，崩溃后仍能恢复最新编辑。
**产品经理**：做。恢复副本是数据安全底线，但「同样的文本每 4 秒重写一次」纯属浪费磁盘与电量，违背「安静、快」；只跳过未变化的重复写，不改变恢复行为与产品边界。
**前端**：`src/features/editor/recovery.ts`：记住每个文档最近一次成功写入的副本文本，内容未变直接返回；保存 / 放弃 / 重命名清理时复位。风险：跳过判断若在保存前失效，可能导致副本缺失或过旧；只影响恢复副本写盘频率。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/editor/recovery.ts`（约 15 行）。
**构建**：`bun run build` 通过（含 tsc，1.22s）；未改 `src-tauri/`，未跑 `cargo test`。
**测量（CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`）**：临时笔记 `_c226rec.md`（约 22KB），偏好设置把「自动保存间隔」设为「关闭」，源码模式输入一个字符后，每秒采样恢复副本文件 mtime / `savedAt`。
- 改前：14 秒内写入 5 次（02:01:01 / 05 / 09 / 13 / 17），内容完全相同，即每 4 秒整篇重写一次。
- 改后：同样 14 秒内只写 1 次（02:02:39），之后 mtime 与 `savedAt` 恒定不变；再改一个字符后立即又写 1 次（`savedAt` 更新、内容含新字符），说明只跳过未变化的重复写。
- 回归：`Ctrl+S` 保存后恢复副本文件被删除、源文件含最新内容；保存后再次编辑，副本立即重建且内容与编辑器一致（崩溃恢复可取回最新编辑）；临时笔记与副本已清理，应用回到单标签 `写作示例.md`，自动保存间隔已恢复为 1.8 秒。
**检验计数**：2。

---

## 第 225 轮 · 2026-10-31 02:06
**用户需求**：50 万字的笔记手动保存、自动保存时会不会明显等磁盘和快照；连按保存时会不会重复写同一份历史；一篇带十几个 Mermaid 图的笔记进预览时图表是不是一下把界面卡住 → 期望保存和图表都顺滑，内容、冲突提示与历史照常。
**产品经理**：做（先测量再定）。保存与预览卡顿都属「快、安静」的核心体验；但只有确认存在应用层重复拷贝或一次性占满主线程才改，否则保持现状，不扩大产品边界。
**前端**：候选为 `features/editor/save.ts` / `autosave.ts`、`features/history`（保存与快照）、`features/preview/mermaid.ts`（批量渲染）、所见模式首次 `EditorState` 创建；风险：保存链路涉及冲突检测与恢复副本，Mermaid 涉及错误提示与主题重画。工作量 S（测量）。
**后端**：候选为 `src-tauri/src/history.rs`（快照去重与写盘）、`commands/history.rs`；风险：历史目录与原子写入，不改即为零风险。工作量 S（测量）。
**裁决**：不改代码。三条路径实测均无应用层一次性卡顿或重复全量写：保存 35–38ms、18 图无长任务、首次所见仅一个 58ms 长任务，剩余都在 IPC / 浏览器排版，S 级无法消除。
**改动**：无（仅 `docs/loop/state.md`、`docs/loop/backlog.md`）。
**构建**：`bun run build` 通过（含 tsc，1.17s）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**测量 A（保存与历史快照）**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`），临时笔记 `_c225save.md` 500,058 字符 / 1,288,585 字节，打开后插入一个字符再按 `Ctrl+S`。
- 第一次保存 38ms、第二次（内容未变）35ms，`PerformanceObserver` 长任务 0；状态栏「已保存 01:48」，保存期间无「保存中」滞留。
- 磁盘内容正确：首部 `X# 大文档保存测试`、尾部 `END_SAVE_MARK`。
- 历史快照只新增 1 份（1,288,585 字节）；第二次相同内容的保存没有新文件——后端 `push_snapshot` 先读最新一份比对后跳过，没有重复写同一快照。
- 保存耗时由一次 IPC 传全文 + 写盘 + 快照命令构成，前后端均无多余的全量拷贝或同步等待，S 级无可省项。
**测量 B（多 Mermaid 图）**：临时笔记 `_c225m.md` 含 18 个 `flowchart LR` 代码块（2,038 字符），分栏模式打开。
- 18 个 `figure.mermaid-figure` 全部生成 SVG，错误 0；5 秒内 370 帧、最长帧间隔 27ms，`PerformanceObserver` 长任务 0（单图渲染未形成 >50ms 的阻塞）。
- 错误路径：`_c225bad.md` 中非法图语法显示「图表渲染失败：Parse error on line 3: …」，并保留源码 `flowchart LR / A -->`。
- 主题重画未独立观测（验证时预览不在前台，统计到 0 个图），本轮未改渲染代码；人工步骤：打开含多图笔记 → 分栏 / 纯预览 → 偏好设置切「深色」→ 预期全部图重画为深色、无错误提示，切回浅色恢复。
**测量 C（首次切所见）**：同一 500k 文档从分栏切到所见，编辑区约 111ms 可见，期间 1 个 58ms 长任务；属于首次装饰构建，进一步优化需按视口懒构建，属 M 级，本轮不做。
**回归**：保存正确性与冲突检测——`_c225conf.md` 编辑后从外部追加内容，再按 `Ctrl+S` 弹出「文件已被其他程序修改」对话框（另存副本 / 覆盖保存 / 重新加载 / 取消），取消后不写盘；自动保存状态显示正常（「已保存 HH:mm」）。
**清理**：`_c225m.md` / `_c225save.md` / `_c225bad.md` / `_c225conf.md` 已删除；对应历史快照目录 `09c65a8dcf2023cd` 已删；临时 CDP 脚本已删；应用回到单标签 `写作示例.md`。
**检验计数**：1。

---

## 第 224 轮 · 2026-10-31 01:42（检验轮）
**范围**：回归第 219–223 轮，不开新功能——219 输入法组词期间推迟预览 / 统计 / 自动保存；220 大纲与粘贴仅测量；221 关闭标签释放预览缓存；222 预览注入的两处整篇无效工作优化；223 滚动与多标签恢复仅测量。
**产品经理**：检验轮，不新增需求；只确认前五轮改动没有破坏输入、预览、缓存与标签行为，发现问题按 S 级修复或记入 backlog。
**前端**：回归 `editor-setup` / `autosave` / `composition`、`preview-controller` / `workspace-actions`、`PreviewPane` / `lib/images`、纯预览大纲与分屏对照；不做代码改动，避免检验轮引入新风险。
**后端**：无。
**裁决**：检验轮（无源码改动）。
**改动**：无产品代码，仅 `docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc，1.10s）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**CDP 实测**（9222，工作区 `D:\clawWorkSpeace\新建文件夹`，`Input.imeSetComposition` / `Input.insertText` / 真实点击）：
- 219 分栏：临时笔记 `_c224ime.md`，组词 `n→…→nihao` 并暂停 2.4 秒，预览保持「IME 测试 / 开头」10 字不变、字数保持 5、磁盘文件不含拼音；提交「你好」后预览 12 字、字数 7、文件写入「开头你好」。
- 219 源码：先输入 `Y` 留一个 1.8 秒自动保存计时器，紧接着组词 `nihao` 暂停 2.4 秒，磁盘仍为旧的「开头你好」、不含 `Y` 与拼音，字数 8 含 `Y`；提交「好」后文件写入「开头你好Y好」。
- 219 所见：组词期间字数 9 不变、磁盘不变；提交「词典」后字数 11、文件正确落盘。
- 219 回归：普通输入 `AB`、粘贴「粘贴文本」（字数 12 → 16）、一次 `Ctrl+Z` 只撤销粘贴；切到 `写作示例.md` 再切回，内容与模式保持并自动保存。
- 220 / 223 抽查：普通输入、粘贴与滚动路径正常；纯预览 `写作示例.md` 滚到 55% 时大纲高亮「图片」、滚到文末时 `_c224anchor.md` 高亮「锚点验证」（视口顶部所在章节），与 212 / 223 轮行为一致。
- 221 非当前标签：`_c224a.md` / `_c224b.md` 分栏打开，关闭非当前 A 后重新打开，预览「缓存 A / A 的正文。」正确；关闭当前 A 时自动切到相邻 B，再开 A 预览正确。
- 221 切回保状态：在 A 输入 `XYZ`、光标 4:4，切到 B 再切回，内容与光标保持，`Ctrl+Z` 撤销整次输入；关闭 A 后在外部改写文件，重开显示「外部修改了。」而不是旧缓存。
- 221 打开失败：删除 `_c224fail2.md` 后立刻点仍显示在树里的条目，提示「打开文件失败：文件或目录不存在」，不新增标签；随后重建文件并打开，预览为新内容；关闭已被删除文件的旧标签时出现「文件已不在磁盘上」提示，选「保留」正常收起。
- 222：`_c224v.md`（标题 / 内链 / 代码 / 带 title 图片 / width 图片 / Mermaid）——2 张图片均改写为 `feiyeimg` 地址，首图 `figure.md-figure` + 图注「图注：示例图片」，次图 `width="40%" class="md-align-center"`，Mermaid SVG 1 个，复制按钮「复制 → 已复制」；点击「跳到第二节」后预览滚动到目标、编辑区同步滚动；`Ctrl+\` 分屏对照正常渲染另一篇；纯预览大纲高亮如 223 抽查。
**问题与修复**：未发现产品缺陷，无需修复；没有为产出硬改代码。
**清理**：临时笔记 `_c224ime.md` / `_c224v.md` / `_c224anchor.md` / `_c224a.md` / `_c224b.md` / `_c224fail2.md` 已删除；对应历史快照目录 `49f9835f90ab67bc` / `a4367c03f9b8699a` 已删（`_c224fail.md` 已被应用外删除）；临时 CDP 脚本已删；应用回到单标签 `写作示例.md`（分栏、文件标签）。
**检验计数**：0（本轮为检验轮已清零，下一轮 225 按正常需求轮）。

---

## 第 223 轮 · 2026-10-31 01:38
**用户需求**：700k 字、几千个代码块的长笔记在所见模式和分栏里往下滚，总有一部分滚轮帧像被吞掉，画面轻微一顿；同时开着十来个标签重启，担心恢复时把所有大文档都初始化一遍 → 期望滚动少掉帧，重启只初始化当前这篇。
**产品经理**：不做（只测量与定论）。滚动流畅与启动快属于「快」的核心体验，但本轮两条路径测下来都没有应用层的重复工作可省，改动只会带来风险；不改任何交互、数据与界面，不扩大产品边界。
**前端**：候选路径为所见模式的块级装饰 / 行内高亮、`PreviewPane` 纯预览滚动的大纲高亮与位置记忆、`scroll-sync` 分栏锚点、启动时 `restoreSavedTabs` 与 `openFile`。风险：装饰增量与滚动锚点缓存已在 197/202/211/212 轮优化过，再动容易破坏滚动同步与大纲高亮。工作量 S（测量）。
**后端**：无。
**裁决**：不做（不改代码）。见下：滚动帧的差值是浏览器对 CodeMirror 视口与块级 widget 的排版，JS 与应用回调占比 <1.5%；标签恢复本就只为当前文档创建 EditorState。
**改动**：无（仅 `docs/loop/state.md`、`docs/loop/backlog.md`）。
**构建**：`bun run build` 通过（含 tsc，1.14s）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**测量 A（滚动）**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`），临时笔记 `_c223a.md` 700,061 字符 / 3800 个 js 代码块 / 7175 个标题；CDP 每 16ms 派发一次 `mouseWheel`（deltaY 260）连续 120 次，页面内 `requestAnimationFrame` 采样帧间隔并用 `PerformanceObserver` 记长任务。
- 所见模式：305 帧，中位 13.4ms、p90 26.7、最高 26.8，长任务 0，滚到 36,379。同法测短文档 `写作示例.md`：中位 13.3、p90 13.4、最高 13.5——差值确实来自长文档，但全部落在浏览器排版。
- 分栏（同一篇，预览 18,294 个顶层块）：中位 13.4、p90 26.7、最高 26.8，长任务 0；`scroll-sync` 锚点缓存生效，滚动帧无整篇重算。
- 纯预览（同一篇）：中位 13.3、p90 13.4、最高 13.5，长任务 0；大纲高亮每帧一次二分（212 轮）后无掉帧。
- CPU 采样（所见滚动 2 秒，200µs 间隔）：idle 87.3%、program 8.0%、measure 1.4%、getBoundingClientRect 0.6%、GC 0.4%、`observers.scroll` 0.2%，其余应用函数均 ≤0.1%——滚动路径上没有可省的重复应用工作。
- Tracing（100 次滚轮）：UpdateLayoutTree 10.6ms、Commit 11.2ms、EventDispatch 7.6ms、HitTest 5.0ms、FunctionCall 4.3ms、PrePaint 1.7ms、IntersectionObserver 0.6ms；即浏览器排版 / 合成，S 级无法通过改代码消除（要动需虚拟化或改 CodeMirror 渲染，属 M 级以上）。
**测量 B（启动恢复）**：`restoreSavedTabs` 只向 tabs store 写标签记录，`openFile` 只打开当前文档；2 个保存标签重载后约 350ms 恢复到「2 个标签 + 1 个编辑器」，DOM 中 `.cm-editor` 恒为 1，后台标签不创建 EditorState、不建大纲、不解析预览，已天然是首次点开才初始化；撤销历史由 `stateCache` 在切回时按需保留。无可延后的初始化可省。
**验证**：本轮未改产品代码，未做功能回归；测量用的长文档与临时脚本已清理，应用回到单标签 `写作示例.md`。
**清理**：`_c223a.md` 已删除（未编辑，未产生历史快照），临时 CDP 脚本已删。
**检验计数**：5（下一轮 224 为检验轮，回归 219–223）。

---

## 第 222 轮 · 2026-10-31 01:27
**用户需求**：在纯预览里左右切两篇几千标题的长笔记时，整页还是会僵一下，滚轮和键盘短暂没反应 → 期望切换大文档时少卡一点，同时预览内容、锚点、代码复制、图注、图表和分栏同步都照常。
**产品经理**：做。切换长文档的停顿属于「快」的核心体验；只减少预览上屏的无效工作，不改渲染结果、交互、数据与界面，符合「快、安静」，不扩大产品边界。
**前端**：`PreviewPane.tsx` 删除给每级预览标题写 `id` / `data-heading-index` 的循环（标题定位已按文本与下标完成，全仓库无其它消费方）；`lib/images.ts` 的 `rewritePreviewImages` 在 HTML 不含 `<img` 时直接返回，跳过整篇 template 解析与再序列化。风险：无图文档不再走图片改写（本来也没有可改写的图片）；有图文档路径不变，预览内容与后处理全部保留。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/preview/PreviewPane.tsx`、`src/lib/images.ts`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc，1.14s）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**测量**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`），临时笔记 `_c222a/b.md` 各 8000 个二级标题 / 337KB / 20 个代码块，纯预览模式，两篇都命中预览缓存，A↔B 由 `PerformanceObserver` 记长任务、`Profiler` / `Tracing` 拆分，并在页面里包了 `innerHTML` / `outerHTML` / `querySelectorAll` 计时。
- 拆帧（修复前，大纲可见，长任务 106–124ms）：`rewritePreviewImages` 的 template 解析 5.2–5.8ms ×2（开发态 StrictMode 双算）+ 正文 `innerHTML` 解析 / 插入 10.5–12.7ms；8020 个顶层块读 `outerHTML` 约 2.5ms；后处理 querySelectorAll 合计约 1ms；给 8000 个标题写 id / dataset 约 4.5ms。Tracing 的长任务里 Layout 35ms、UpdateLayoutTree 24ms、ParseHTML 13ms，React 大纲与预览渲染约 30ms——剩余大头是浏览器对 8000 个标题与大纲的排版，S 级无法消除。
- 两种情况：切回缓存 HTML 时只有上述主线程工作；首次打开（Worker 未命中）额外 207–222ms 的 Worker 解析（首次加载模块 436ms），不在主线程长任务里。
- 修复后（大纲可见）：97 / 90 / 90ms（中位 90），较修复前中位 116ms 降约 26ms；`rewritePreviewImages` 的 template 解析调用 0 次，正文 `innerHTML` 9.2–9.8ms，标题 id 不再写。
- 修复后（大纲隐藏）：56 / 65 / 72ms（中位 65），较修复前中位 86ms 降约 21ms；大纲边际约 20–25ms，与 220 轮一致。
**验证**：CDP 真实交互。
- `_c222v.md`（标题 / 内链 / 代码 / 带 title 图片 / Mermaid）：6 个标题齐全，`figure.md-figure` + 图注「图注：示例图片」，图片地址走 `feiyeimg`，Mermaid SVG 1 个，代码块复制按钮 1 个，内链 title 为「跳转到「第二节」」；点击内链预览滚动 244 → 564（受短文档最大滚动限制），点击复制按钮「复制 → 已复制」。
- `_c222b.md`：8000 个二级标题首条 Sec 1001、末条 Sec 8000，复制按钮 20 个。
- 分栏滚动同步：编辑区滚到 50%（116238 / 232700），预览同步到 50%（310238 / 621498）。
- `Ctrl+\` 分屏对照：右侧正常渲染 `写作示例.md` 4 个标题。
- 纯预览大纲高亮：滚到 95% 时大纲 8000 条中高亮第 7558 条（Sec 7559）。
**清理**：`_c222a/b/v.md` 已删除（未产生历史快照），临时 CDP 脚本已删；应用停在单标签 `写作示例.md`（分栏、文件标签）。
**检验计数**：4。

---

## 第 221 轮 · 2026-10-31 01:21
**用户需求**：开着一堆长文档写一整天，关掉标签后感觉内存没有还回来，切来切去也担心越用越涨 → 期望关闭标签能真正释放该文档占的内存，切走再切回时堆内存保持平稳，同时撤销历史、光标和未保存内容都不能丢。
**产品经理**：做。长时间会话的内存回落属于「快」与「本地优先」的核心体验；只补上关闭标签时的缓存清理，不改缓存容量、淘汰策略、交互与数据，不扩大产品边界。
**前端**：`features/preview/preview-controller.ts` 增加按文档删除预览结果的入口；`features/workspace/workspace-actions.ts` 在关闭标签（当前 / 非当前）与打开失败时调用，与既有的 `forgetEditorState` 对齐。风险：只影响关闭后的缓存命中，重新打开必然按磁盘内容重新解析；切标签命中路径不变。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/preview/preview-controller.ts`、`src/features/workspace/workspace-actions.ts`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc，1.19s）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**测量**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`），12 篇临时笔记各 20 万字符（约 388KB、372 个标题、5 个 Mermaid 图），每步 `HeapProfiler.collectGarbage` 后读 `Performance.getMetrics` 的 `JSHeapUsedSize` / `Nodes` / `Documents`。
- 分栏（修复前，库已加载）：普通笔记基线 22.9MB → 12 篇大文档 51.4MB（+28.5）→ 全部关闭 45.7MB（只回落 5.7）→ 重开普通笔记仍 45.5MB。
- 分栏（修复后，页面重载冷启动）：基线 17.7MB → 12 篇 52.5MB → 全部关闭 39.3MB（回落 13.2MB）→ 重开普通笔记 39.4MB。
- 单篇关闭成本（修复后）：两篇大文档 43.21MB，关闭非当前的一篇 42.14MB（−1.07），重开 44.15MB（+2.01），再关 42.22MB（−1.93）——每篇约 2MB 的 EditorState + 预览条目可随关闭释放。
- 所见模式（不走预览缓存）：重载基线 17.3MB → 12 篇 33.0MB（+15.7，约 1.3MB/篇的 EditorState）→ 全部关闭 18.5MB → 重开普通笔记 18.8MB（残留 1.5MB，为大纲标题文本 / 行号缓存与解析器缓存）。
- 缓存量级：预览缓存上限 6 份 / 1200 万字符；单篇大文档条目 ≈ 全文 0.2M + HTML 0.64–0.66M + Mermaid SVG 0.12–0.15M 字符，约 2MB 字符串负载；SVG 早已计入权重。历史快照只在磁盘（%APPDATA%\com.myfinal.feiye\history，每篇最多 20 份、单份上限 8MB），不占 JS 堆。
- 残留归因：修复后全关再取堆快照，90.2MB 快照中 `ExternalStringData` 46MB，主要是首次预览后常驻的 Mermaid / ELK / cytoscape / Shiki 模块代码；匹配关闭文档标题、预览 HTML 标记的字符串仅十几条、不足 0.1MB，说明关闭文档的正文与 HTML 已不再滞留。
- 稳定性（修复后，6 篇大文档在 m01/m02 间真实切换 10 次，每步 GC）：47.4 / 46.9 / 46.7 / 45.9 / 46.9 / 47.4 / 47.4 / 46.3 / 46.4 / 46.3 / 46.4MB，无单调增长。
**验证**：CDP 真实输入（`Input.insertText` / `Input.dispatchKeyEvent`）。
- 在 `_c221m01.md` 末尾输入标记 → 切到 m02 再切回：标记与光标都在，`Ctrl+Z` 撤销跨标签仍生效（撤销历史未丢）。
- 带未保存内容点关闭：自动保存生效后直接关标签（未丢内容），符合既有策略；临时文件随后恢复。
- 把 m01 磁盘内容改成「已修改标题」后重开分栏：预览 h1 为「已修改标题」、新正文出现、旧标题不再显示，未误用关闭前的缓存。
- 普通笔记 `写作示例.md`：分栏标题 10 条、正文与改前一致；单标签状态正常。
**清理**：12 篇 `_c221m*.md`、m01 的历史快照目录 `ef07c0d926ce8230` 与临时 CDP 脚本已删除；应用停在单标签 `写作示例.md`（分栏）。
**检验计数**：3。

---

## 第 220 轮 · 2026-10-31 01:07
**用户需求**：在纯预览里读一篇几千标题的长资料，侧栏停在大纲页，切到另一篇同样很长的笔记时整页会僵一下，滚轮和键盘短暂没反应 → 期望切大文档不再出现长任务，至少别让大纲列表成为负担；顺手也想知道贴一大段文字或写超长单行时会不会卡。
**产品经理**：做（只做性能定位与测量）。长文档切换与输入延迟属于「快」的核心体验，先弄清大纲在隐藏 / 可见时的真实成本再决定是否改；不改变任何交互、数据与界面，不扩大产品边界。若 S 级无法显著降耗则只记录，不硬改。
**前端**：候选路径是 `features/outline/OutlinePanel.tsx`（8001 条按钮的重建与 DOM）、`features/tabs/TabBar.tsx`（切换文档时为标签强制布局）、编辑器粘贴 / 超长单行输入。风险：大纲窗口化会牵动键盘导航、当前项高亮、跳转与分栏滚动同步，若收益不足不落地。工作量 S（测量）。
**后端**：无。
**裁决**：延后（本轮只测量，不改代码）。隐藏时不渲染已成立；可见时大纲边际成本约 20ms，窗口化收益有限且属 M 级；长任务大头是预览整篇注入与布局。
**改动**：无。
**构建**：`bun run build` 通过（含 tsc，1.23s）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**测量**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`），临时笔记 `_c220a/b.md` 各 8001 个标题（255KB），纯预览模式，`PerformanceObserver` 记长任务、`Profiler` 取自耗时。
- 大纲隐藏时：侧栏停在「文件」标签或 `Ctrl+B` 收起侧栏，大纲条目 DOM 均为 0 条（组件按 `tab === "outline" && 侧栏可见` 条件挂载），切换文档不产生大纲渲染。
- 大纲可见时：`[data-outline-index]` 8001 条；A↔B 切换长任务 179 / 190 / 196ms（中位 190）。同样切换在「文件」标签下 145 / 169 / 178ms（中位 169）——大纲边际约 20ms，大头是预览整篇注入与布局。
- CPU 采样（大纲可见）：`ReactElement` 38ms、`jsxDEV` key 校验 21ms，其余集中在 `(program)` 169–434ms（预览 DOM 布局 / 绘制）、标签栏 `scrollIntoView` 强制布局 73–156ms、`rewritePreviewImages` 27ms、GC 40ms；没有可单独解释长任务的函数。
- 反证：把标签栏 `scrollIntoView` 在运行时跳过，切换长任务 131 / 146ms vs 133 / 165ms，无显著差异，故不改 `TabBar`。
- 新建 8001 标题文档首开并立即切大纲：153ms 长任务，4 秒时大纲 4654 条（未滚动预览，符合 197 / 213 记录的按解析进度补齐）。
- 结论：窗口化（只渲染视口 ± N 条）可省去约 20ms 与 8001 个按钮的布局，但需要重做键盘跨窗、Home/End、跳转与自动高亮，属 M 级且收益有限；与「隐藏不渲染 + 显示时按需」相比不划算，本轮不硬改。下一步若继续攻切换延迟，应针对预览整篇注入 / 布局或生产构建复测。
**粘贴 / 超长单行（备选路径，按同一规则裁决）**：源码模式，临时笔记 `_c220p.md`。
- 一次粘贴 20 万字符（4000 个段落）：事件同步耗时 25.1ms、首帧 31.3ms，无长任务。
- 一次粘贴 15 万字符单行：同步 18.7ms、首帧 27.1ms，无长任务。
- 在该 15 万字符单行末尾连打 20 个字：每键到下一帧中位 22.1ms、最高 23.9ms，无长任务（同法在普通短文档为 8.9ms）。
- 结论：粘贴与超长单行均无长任务、无可修的阻塞点，不改代码；留作后续回归基线。
**清理**：临时笔记 `_c220a/b/p/q.md` 及其历史快照已删除，临时 CDP 脚本已删；应用停在单标签 `写作示例.md`（所见模式、文件标签）。
**检验计数**：2。

---

## 第 219 轮 · 2026-10-31 00:55
**用户需求**：用拼音输入法在分栏 / 所见里写中文，候选词还没上屏时，预览里已经出现半截拼音「nihao」，底部字数也跟着跳；手停下来想一想候选词，超过一两秒后自动保存还把拼音写进了文件 → 期望组词期间预览、字数和自动保存都等上屏后再更新，文件里只出现最终汉字。
**产品经理**：做。输入法是日常写作主路径，半截拼音被计入统计、甚至在暂停组词时落盘属于已实现功能的粗糙处与数据安全问题；只推迟组词期间的派生更新，不改输入内容、保存策略与界面，符合「快、安静、数据安全」，不扩大产品边界。
**前端**：`editor-setup.ts` 在 `compositionstart` / `compositionend` 间标记组词状态，组词中的 `docChanged` 不再触发 `onChange` / `onStats` / 大纲刷新，`compositionend` 后等一拍按最终文本补一次；`autosave.ts` 的自动保存与恢复副本计时器在组词期间不落盘、稍后重试；新增 `composition.ts` 共享组词标志。风险：只影响输入法组合事务，普通输入 / 粘贴 / 撤销路径不变。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/editor/editor-setup.ts`、`src/features/editor/autosave.ts`、`src/features/editor/composition.ts`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc，1.16s）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**验证**：CDP（9222）`Input.imeSetComposition` 模拟拼音 `n→ni→…→nihao`，提交为「你好 / 世界 / 好」，临时笔记 `_c219.md` / `_c219b.md`。
- 修复前（分栏）：组词中预览变成「开头nihao」，字数 7 → 8（把拼音计入）；组词暂停 2.4 秒后自动保存把 `开头nihao` 写入源文件。源码模式下先输入 `Y` 再组词，预存的 1.8 秒计时器同样把 `Ynihao` 落盘。
- 修复后（分栏）：组词中预览 DOM 变更 0 次、字数保持 10、暂停 2.4 秒文件仍为「开头[粘贴]」；提交「世界」后预览只刷新一次、字数 12、文件写入「开头[粘贴]世界」，无长任务。
- 修复后（所见）：表格 widget 在组词中保持 1 个、正文只有 5 次输入自带的 DOM 变更；提交「词典」后 widget 仍为 1、字数 20 → 22、文件正确写入，无长任务。
- 修复后（源码，预存自动保存计时器 + 组词）：暂停 2.4 秒文件仍为「开头」，不含 `Y` 与拼音；提交「好」后写入「开头Y好」。
- 回归：一次 `Ctrl+Z` 撤销整次组词（未拆成多步）；普通输入、合成粘贴「粘贴文本」、标签切到 `写作示例.md` 再切回、自动保存状态与落盘均正常。
**清理**：临时笔记 `_c219.md` / `_c219b.md` 及对应历史快照目录 `b5d122ab0aa0914b` / `ff334ed83848b8b9` 已删除，临时 CDP 脚本已删；应用停在单标签 `写作示例.md`（所见）。
**检验计数**：1。

---

## 第 217 轮 · 2026-10-30 23:44
**用户需求**：所见模式里文章中间有一条分隔线，想点它改成别的写法（或删掉），但鼠标点在线上几乎没反应，光标跑到文档开头 / 相邻空行，分隔线还是渲染样子 → 期望点分隔线本身就进入源码编辑，和点表格、公式一样。
**产品经理**：做。已实现功能的粗糙处，只修点击命中与可点区域，分隔线渲染、文档内容与其它交互不变，符合「快、安静」的写作体验，不扩大产品边界。
**前端**：`live-preview/widgets.ts` 的 `RuleWidget.toDOM` 增加 `mousedown` 处理：在整块可点区域按下左键时阻止默认行为，用 `view.posAtDOM(wrapper, 0)` 定位到 `---` 起点并聚焦编辑器；`live-preview.css` 把 `margin: 12px 0` 改为 `padding: 11px 0; margin: 1px 0`，把点击区域从 1px 线体扩大到约 23px，行高与纵向占位保持不变。风险：仅影响分隔线块，表格 / 公式 / 段落路径不动。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/editor/live-preview/widgets.ts`、`src/features/editor/live-preview/live-preview.css`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc，960ms）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**验证**：CDP（9222）所见模式，`写作示例.md`（第 73 行 `---`）。
- 修复前证据：分隔线 wrapper 高 1px；真实点击线体中心后 `cm-wysiwyg-hr` 仍为 1 个，`cm-activeLine` 为文档第一行 `# 写作示例`，选择锚点在 `cm-content` 偏移 0——坐标映射完全落到文档开头。
- 修复后：wrapper 高 23px、行高 28.8px（与改前一致，纵向占位不变）；真实点击线体中心、上内边距、下内边距三处，`cm-wysiwyg-hr` 均变为 0、`cm-activeLine` 为 `---`、光标在 `---` 开头（offset 0）；`ArrowDown` 离开后分隔线渲染恢复 1 个。
- 回归：点表格单元格进入源码（activeLine `| 功能 | 快捷键 | 备注`、表格 widget 0）；点块级公式进入源码（activeLine `$$`、光标偏移 2、块 widget 0）；点回正文后块级公式与分隔线 widget 各恢复 1 个，行内公式 2 个、加粗 1 个仍渲染；普通段落点击光标正常落回。
**清理**：上一轮遗留的 `_c216a.md` / `_c216b.md` 临时标签已关闭，应用停在单标签 `写作示例.md`（所见）；临时 CDP 脚本已删除。
**检验计数**：3。

---

## 第 216 轮 · 2026-10-30 23:47
**用户需求**：在纯预览里读一篇几千标题的长资料，切到另一篇大文档时会整页僵住两三秒，滚轮和键盘都没反应 → 期望切换大文档时不再有长任务，加载期间界面仍可响应。
**产品经理**：做。只做性能定位与降耗，切换结果、阅读位置与数据不变，符合「快」与长文档方向，不扩大产品边界。
**前端**：目标路径涉及 `EditorPane` 的纯预览 `forceParsing` 补全、预览 Worker 结果 `patchPreviewBlocks`、`OutlinePanel` 数千项重建、`preview-scroll` 与滚动恢复。先以 CDP 打点，确认长任务来源后再决定是否落在 S 级；若来源分散则记录数据与下一步。
**后端**：无。
**裁决**：延后（本轮只测量，不改代码）。实测未复现 2.7s 单条长任务，热点分散在 React 开发态渲染与预览补丁，超出单点 S 级范围。
**改动**：无（仅测量记录）。
**构建**：`bun run build` 通过（含 tsc，1.01s）；未改 `src-tauri/`，未跑 `cargo test`。
**测量**：CDP（9222）纯预览，临时笔记 `_c216a.md` / `_c216b.md` 各 8000 个二级标题（341KB，另做过 1.66MB 版本），侧栏停在大纲页，用 `PerformanceObserver` 记长任务、`Profiler` 取自耗时。
- 大纲页打开时 A→B 切换：长任务 140ms 与 187ms；进入纯预览（1.66MB）：320ms + 55ms×3。
- CPU 采样自耗时前列（开发态）：`ReactElement` 277ms、`jsxDEV` key 校验 92ms、`SlidingSegmented` 178ms、`OutlinePanel` 33ms、`rewritePreviewImages` 24–39ms、`scrollIntoView` 83–107ms、`patchPreviewBlocks` 12–17ms，CodeMirror 解析均为 ≤8ms 碎片；无单函数可解释 2.7s。
- 结论：第 213 轮观察到的 2.7s 未复现，可能是一次开发态渲染 / GC 尖峰；常态化成本分散在「数千项大纲在解析推进中反复建元素」与「预览整篇补丁」，任一项要根治都需虚拟化 / 改渲染调度，非 S 级。
**下一步建议**：下一窗口在 production 构建下复测并保留 CPU profile；优先考虑在纯预览 `forceParsing` 补全期间合并 / 暂停大纲列表更新（保持计数更新），以及大纲列表虚拟化；另可为切换加一次性 `performance.mark` 以便日后归因。
**清理**：临时笔记 `_c216a.md` / `_c216b.md` 已删除，临时 CDP / 测量脚本已删；应用已切回单标签 `写作示例.md`。

---

## 第 215 轮 · 2026-10-30 23:35
**用户需求**：所见模式里有一块居中的公式，想点它直接改源码，点视觉正中却总把光标放到公式下面的空行，公式还是渲染样子、像没点中；只有点上边缘才进得去 → 期望点公式块任何位置（上、中、下）都进入源码编辑，光标落在公式里。
**产品经理**：做。已实现功能的粗糙处，只修点击命中，不改公式渲染、数据与其它交互，符合「快、安静」与不受打扰的写作体验，不扩大产品边界。
**前端**：`live-preview/widgets.ts` 的 `MathWidget.toDOM` 为块级公式加 `mousedown` 处理：点击落在元素纵向中线以下时 `preventDefault` / `stopPropagation`，用 `view.posAtCoords` 取块起点并把光标放到开头 `$$` 之后、聚焦编辑器。根因是 CodeMirror 的块级 widget 坐标映射以块中线为界，下半部分返回替换范围末尾之外的位置（块后空行），不在 `MathBlock` 节点内，装饰不退出；上半部分仍走原有路径。风险：仅影响块级公式下半部分的点击，行内公式、表格、分隔线不动。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/editor/live-preview/widgets.ts`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc，968ms）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**验证**：CDP（9222）所见模式，临时笔记 `_c215.md`（`aligned` 块级公式、行内公式与粗体、表格、分隔线、普通段落）。
- 修复前证据：块级公式 widget 高约 63.8px，点纵向 94% 处后块级公式 widget 仍为 1 个、`cm-activeLine` 为公式后的空行（无文本），光标不在公式里；点上半部分可进入源码。
- 修复后：同一位置点击 → 公式 widget 0 个、`cm-activeLine` 为 `$$`、光标在本行偏移 2（开头 `$$` 之后）；点纵向 8%（上）、50%（正中）、85–90%（下）均进入源码且块 widget 消失。
- 进入后键入 `z` 落在公式源码；`Ctrl+Z` 撤销后 `$$z` 消失、内容复原，公式 widget 正常显示。
- 回归：表格下半部分点击仍进入源码（activeLine `| E | F |`、表格 widget 0），点回正文表格 widget 恢复 1 个；行内公式点击进入源码（widget 0）；普通段落点击正常、光标落回段内。分隔线 1px 线体点击会落到相邻空行——用 `git stash` 对照改前同样如此，非本轮引入（`RuleWidget` 未改）。`写作示例.md` 所见模式正常。
**清理**：临时笔记 `_c215.md`、历史快照目录 `1adeb28ac473223f`、临时 CDP 脚本均已删除；临时标签已关闭，应用停在单标签 `写作示例.md`（所见）。
**检验计数**：2。

---

## 第 214 轮 · 2026-10-30 23:23
**用户需求**：在所见模式里写笔记，表格（或块级公式）后面那段正文的加粗、行内代码、链接、行内公式都不生效，Markdown 记号原样露着；把表格删掉同一段立刻正常 → 期望表格 / 公式后面的正文和其它段落一样渲染，光标进入、离开也照常切换源码与渲染。
**产品经理**：做。所见模式已有功能的一致性缺陷，只修装饰生成逻辑，渲染结果、交互与数据都不变；表格后面正文写不了格式化内容影响日常写作，符合「快、安静」与已实现功能的粗糙处，不扩大产品边界。
**前端**：`live-preview/decorations.ts` 的 `buildDecorations` 按 `view.visibleRanges` 分段遍历语法树；块级 widget（表格等）会把可见区切成多段，每段都从 `Document` 等祖先节点重新进入，而 `seen` 去重时对重复节点返回 `false` 会跳过该祖先的整棵子树，导致该段后面的内容全部丢失装饰。改为对重复节点继续下探（`return true`），子节点仍按位置 key 去重。风险：仅多走一遍跨段祖先的有界子树；同段内去重不变。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/editor/live-preview/decorations.ts`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc，970ms）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**验证**：CDP（9222）所见模式，临时笔记 `_c214.md`（表格后接加粗 / 行内代码 / 行内公式 / 链接、标题、列表、引用、围栏）、`_c214m.md`（块级公式后同类内容）、`_c214big.md`（1,050,027 字符 / 1.47MB）。
- 根因证据：修复前 `_c214.md` 打开后表格之后所有行都没有行内装饰——段落 `strong/code/math` 均 0、`cm-wysiwyg-h2` / `cm-wysiwyg-li` / `cm-wysiwyg-quote` / `cm-wysiwyg-code-line` 全部缺失；经 CDP 读取 `view.visibleRanges` 为 `[{0,36},{69,206}]`（表格块 widget 把可见区切开），插件生成的 8 条装饰全部落在第一段（0–36）；第二段从 `Document` 重新进入时因 `seen` 命中返回 `false` 而被整段跳过。围栏只占一行（替换长度 < 20）的文档不切分可见区，所以不触发，与「只有多行表格 / 公式后丢失」的现象吻合。
- 修复后：`_c214.md` 表格后段落 `strong 1 / code 1 / math 2`，`cm-wysiwyg-h2`、`cm-wysiwyg-li`、`cm-wysiwyg-quote`、代码行样式均恢复；围栏后的段落同样恢复。`_c214m.md` 块级公式后段落 `strong 1 / code 1 / math 2`、标题与列表样式正常。
- 回归第 202 轮路径：在表格后段落上方空行键入 `Z`（增行）后表格后装饰保持、标题 / 列表 / 引用 / 围栏样式仍在，`Ctrl+Z` 复原且光标回到 128；点表格单元格进入源码（69，`| 1 | 2 |`）时表格后段落装饰仍为 `strong 1 / math 2`，点回正文后表格 widget 恢复（1 个）、装饰不变；点块级公式进入源码（`$$`，26）、点回后公式 widget 恢复、后段装饰不变；点表格后段落里的「粗体」露出 `**` 源码、点回开头段落后 `strong 1 / code 1 / math 1`、`cm-wysiwyg-h2` 恢复；代码块语言栏与「复制」按钮仍在，点击提示「语言已复制」；>1MB 笔记打开后 `cm-wysiwyg-strong` / 表格 widget 均为 0（既有降级路径），编辑器正常；`写作示例.md` 滚到文首后 `strong 2 / code 2 / math 3 / 表格 1 / 代码行 11 / 标题样式 8`，与改前一致。
**清理**：临时笔记 `_c214.md`、`_c214b.md`、`_c214m.md`、`_c214big.md` 与历史快照目录 `9921969307d36e1a` 已删除，临时 CDP 脚本已删；临时标签全部关闭，应用停在单标签 `写作示例.md`（所见）。
**检验计数**：1。

---

## 第 213 轮（检验轮）· 2026-10-30 23:14
**范围**：只回归本窗口第 208–212 轮（所见表格 / 公式点击、预览缓存 LRU、缓存按笔记各留一份、分栏锚点缓存、纯预览大纲二分），并复核上一轮「纯预览大纲只覆盖已解析部分」；不开新功能。
**构建**：`bun run build` 通过（含 tsc，1.06s）；本轮只改 `src/features/editor/EditorPane.tsx`，未改 `src-tauri/`，未跑 `cargo test`。
**CDP 实测**：
- 208：临时笔记表格点中后 widget 消失、光标 5:10（表内）、键入 `X` 落在 5:11、`Ctrl+Z` 后文本与光标复原；块级公式点上部进入源码（9:3、`$$` 可见），点行内公式 3:11、键入 / 撤销正常；点正文后表格 / 公式 widget 各恢复 1 个。
- 209：8 篇 65KB / 800 标题 / 800 围栏笔记，分栏下按 `A…G` 依次打开（未命中 383–506ms），切回 `B` 命中 166ms；再打开 `H`（未命中 368ms）后再次切 `B` 仍命中 195ms → 命中会刷新最近使用顺序，`H` 淘汰的是更久未用的条目，而不是刚看过的 `B`。
- 210：在 `B` 标题插入 `Z` 后切 `D` 命中 160ms（其它笔记未被编辑中的版本挤掉）；切回 `B` 154ms、预览显示 `LRU BZ`；`Ctrl+Z` 后预览为 `LRU B`，再切 `D` / `B` 命中 147 / 148ms 且内容正确 → 每篇只留一份、命中前核对全文。
- 211：8000 标题 / 317KB 笔记分栏，滚动 40 帧 × 3 次，`getBoundingClientRect` 每帧中位 0（首轮首帧建锚点 16,000 次，之后只剩其它 UI 的约 96 次），整帧中位 13.1–13.4ms、p90 13.5ms、最高 18.4ms；点大纲第 7000 条，预览落在标题 7000、大纲高亮 7000；预览再滚 50,000px 后编辑器首行 29,664 对应第 7416 条、预览为 7415，差 0；文首插入空行后大纲仍 8000、同样滚动同步差 0，`Ctrl+Z` 后首行复原并已保存。
- 212：2500 标题笔记纯预览，滚动帧矩形调用恒定 12–13 次；滚到 10% / 50% / 95% 时线性复核期望 249 / 1247 / 2369，大纲高亮同为 249 / 1247 / 2369（对应标题 250 / 1248 / 2370）；点大纲第 2000 条，平滑滚动结束后高亮 2000、该标题距预览顶部 11px。
**问题与修复**：
- 上一轮发现的「纯预览大纲只覆盖已解析部分」确为既有缺陷：8000 标题 / 317KB 笔记冷启动到纯预览，大纲只到 3941 条，滚到 95% 时 `scrollIndex` 超出列表、没有任何条目高亮，标题跳转也只能到前半篇。判为 S 级，本轮修复：`EditorPane` 在 `viewMode === "preview"` 时以 24ms 时间片循环 `forceParsing`，解析推进经既有 `onOutline` 补齐大纲。A/B 对照：关闭该 effect 时大纲停在 3941（8 秒不涨），开启后 1 秒内到 8000；滚到 95% 高亮第 7594 条，大纲跳第 7000 条准确。代价是纯预览载入长文时多一次分片解析，载入阶段仍有一次约 0.29s 长任务（与既有预览渲染同在，未单独归因）。
- 观察（既有，未改，下一轮候选）：所见模式下表格之后的整段正文不应用行内装饰——加粗 / 行内代码 / 链接标记原样显示、行内公式不渲染；把表格删掉后同一段立即正常。疑为表格块级替换与后续装饰的边界问题，范围可能到 M，记入下一轮需求。
- 观察（既有，未改）：所见模式块级公式点视觉正中会落到块后空行、widget 不退出（点上半部才能进入源码 9:3），与块 widget 的命中区域有关，非 208 引入。
- 观察（既有，未改）：纯预览下从 8000 标题文档切到另一篇时有一次约 2.7s 长任务；关闭本轮 effect 仍复现，属既有切换 / 重建成本。
**清理**：临时笔记 `_reg213_*` / `_rr.md` 与 4 个历史快照目录已删除；临时 CDP / 生成脚本已删；所有临时标签关闭并整页重载，应用停在单标签 `写作示例.md`（分栏、已保存 22:33）。
**检验计数**：清零。

---

## 第 212 轮 · 2026-10-30 22:51
**用户需求**：纯预览里读一篇几千个标题的长资料，越往文末滚越卡，滚轮跟手变差 → 期望滚动时大纲高亮别每帧把前几千个标题从头量到尾。
**产品经理**：做。纯性能优化，高亮位置、交互与数据都不变；标题本来按文档顺序单调排列，二分查找只量约 13 个标题，符合「快」与长文档方向，不扩大产品边界。
**前端**：`preview-scroll.ts` 的 `previewActiveHeadingIndex` 改签名接收标题数组，并用二分查找最后一个顶部不超过阈值的标题（阈值仍是 `scrollTop + 12`）；`PreviewPane.tsx` 在 HTML 变化的 effect 里缓存一次 `previewHeadingElements`，滚动帧不再每帧 `querySelectorAll` 整篇。风险：增量替换只发生在 HTML 变化时、且布局 effect 先于滚动 effect，缓存列表不会过期；行位置每次都现量，图片 / 图表撑高不影响精度。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/preview/preview-scroll.ts`、`src/features/preview/PreviewPane.tsx`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc，1.00s）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**验证**：CDP（9222）纯预览模式，临时笔记 `_c212.md`（549,807 字节 / 8000 个二级标题 / 8000 段短正文）。
- 性能测量方法：在页面里临时包一层 `Element.prototype.getBoundingClientRect` 统计每帧调用次数，用 40 个 rAF 把预览 `scrollTop` 从 85% 均匀推到 95%（最坏位置）；同一页面、同一状态各跑 3 次取中位 / p90。
- 修复前：每帧矩形调用中位 14,436（最高 15,194），整帧中位 13.9–14.3ms、p90 18.8–19.6ms、最高 21.2–24.5ms。
- 修复后：每帧矩形调用恒定 14 次（仅二分 + 面板），整帧中位 13.3ms、p90 13.6–14.7ms、最高 13.9–19.1ms；p90 与最长帧明显收敛到 vsync 附近。
- 高亮准确性：临时笔记 `_c212s.md`（2501 个标题，大纲完整覆盖）滚到 50% 时预期第 1247 条、实际高亮 1247；滚到文末预期 2493、实际 2493。点大纲第 2000 条，动画结束后高亮 2000、该标题距预览顶部 10px。`写作示例.md`（10 个标题）中段预期 6 / 实际 6，文末预期 9 / 实际 9；文首无标题进入 12px 阈值时仍按既有逻辑回退到光标所在条。
- 观察（未改，供检验轮考虑）：纯预览下大纲仍取编辑器语法树，8000 标题的文档只解析出约 2773 条，滚到后段 `scrollIndex` 超出列表时无条目高亮；这是既有行为，与本轮二分无关。
**清理**：临时笔记 `_c212.md`、`_c212s.md` 与临时 CDP / 测量脚本已删除；两个临时标签关闭，应用停在单标签 `写作示例.md`（分栏、已保存）。

---

## 第 211 轮 · 2026-10-30 22:45
**用户需求**：在标题上千条的资料笔记里用分栏读，滚动时画面一顿一顿的，鼠标滚轮要等半拍才跟手，标题越多越明显 → 期望长文档滚动也顺滑，别每一帧都把整篇标题量一遍。
**产品经理**：做。纯性能优化，滚动同步的映射结果、交互与数据都不变；标题位置只在标题或布局变化时重算，符合「快」与长文档优化方向，不扩大产品边界。
**前端**：`scroll-sync.ts` 的 `buildAnchors` 不再每帧执行——按大纲标题数组的引用缓存锚点，只有标题位置变化（数组引用变）或布局变化（窗口 resize、正文 / 预览 ResizeObserver、图片 load）时才重建；`buildAnchors` 改为显式接收标题。风险：缓存过期会让同步偏移，已用编辑（标题行位移）与图片 / Mermaid 撑高场景核对；标题数量不一致时仍退回比例映射。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/preview/scroll-sync.ts`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc，1.01s）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**验证**：CDP（9222）分栏模式，临时笔记 `_c211b.md`（381,785 字节 / 8000 个二级标题 / 8000 段短正文）。测量方法：在页面里临时包一层 `Element.prototype.getBoundingClientRect` 统计调用次数与耗时，随后用 40 个 rAF 把预览 `scrollTop` 从顶部均匀推到 55%，记录每帧 rAF 间隔与当帧矩形调用；同一页面、同一状态各跑 3 次取中位 / p90。
- 修复前：每帧约 16,000 次 `getBoundingClientRect`（8000 标题 + 预览容器），矩形耗时中位 10.9–11.9ms，整帧中位 24.7–25.5ms、p90 30.8–31.7ms、最高 42.8ms。
- 修复后：滚动帧矩形调用中位 0（仅偶发其它 UI 的 <100 次），整帧中位 13.3–13.5ms、p90 15.6–16.4ms、最高 15.9–17.2ms，回到 vsync 附近；首次滚动或布局变化时仍会重建一次锚点。
- 同步准确性：点大纲第 7000 条，两侧都停在第 6999/7000 条附近（预览 7000 在视口 69px、编辑器 7000 在 20px）；点最后一条「C211B 标题 8000」，预览滚到最大值 961,389/961,390、编辑器滚到 921,366（文末），两侧可见章节同为 7995–7996；从预览滚到标题 5000，预览 4999/5000、编辑器 5000 在 0px 附近；跳到标题 3000 后编辑器再滚 100,000px，两侧同为 3867/3868。
- 缓存失效：在文档最前插入一个空行（所有标题行号位移、预览 HTML 不变），滚 50,000px 后两侧仍同为第 434 条；`Ctrl+Z` 后大纲仍 8000 条、首行复原、文件已保存且内容与生成时一致。`写作示例.md`（10 标题）分栏双向滚动与改前一致（用临时 `git stash` 对照编辑器滚到底的映射值：改前 2265、改后 2268，均为既有行为）。
**清理**：临时笔记 `_c211.md`、`_c211b.md` 与本轮历史快照目录 `21ee879a28d49e41` 已删除，临时 CDP 脚本已删；两个临时标签关闭并整页重载，应用停在单标签 `写作示例.md`（分栏、已保存 22:44）。

---

## 第 210 轮 · 2026-10-30 22:34
**用户需求**：分栏里开着几篇长笔记来回看，停下来在某一篇改几句话再切回之前那篇，明明刚看过却又要等预览整篇重算 → 期望每篇笔记只占缓存里的一份，编辑中间版本别把别的笔记挤出去，缓存占用也按真实内存算。
**产品经理**：做。缓存从「按全文」改为「每篇笔记最近一次结果」，命中前核对全文，正确性不变（外部修改 / 撤销 / 换库仍重新解析）；同时把 Mermaid SVG 计入内存上限，符合「快、安静」与长文档内存约束，不扩大产品边界。
**前端**：`preview-controller.ts` 缓存键由 Markdown 全文改为当前文档路径（`useDocumentStore`），值存 `{markdown, result, weight}`；命中时再比较全文，同篇旧版本在写入时被替换而不是另占一格；权重改为预计算并计入 `result.mermaid` 的 SVG 长度。风险：跨工作区同名路径靠全文比较兜底；历史版本恢复会替换当前篇缓存，最多少一次命中。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/preview/preview-controller.ts`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc，985ms）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**验证**：CDP（9222）分栏模式，7 篇 67–68 字符的临时笔记 `_c210_a..g.md` 从文件树依次打开；用当轮临时导出的 `__previewCacheInfo()`（提交前已删除）经 CDP 动态 import 读取缓存键。
- 修复前：打开 7 篇后缓存 6 份（`b..g`）；在 `g` 里输入一个字符并等去抖，缓存变成 `c,d,e,f,g + g 的旧版本`，只剩 5 篇不同笔记，刚看过的 `b` 被一条无用中间版本挤掉。
- 修复后：同样操作后仍为 `b..g` 6 篇不同笔记，`g` 的条目原地替换（67 → 69 字符），无旧版本残留；由 `b` 切回命中 11.8ms、预览标题正确，编辑后按 `Ctrl+Z` 缓存替换为撤销后的文本（68 字符）、预览同步去掉字符。
- 回归：`长文档.md` ↔ `写作示例.md` 切换预览标题正确；在 `写作示例.md` 输入 `Q` 后预览出现、`Ctrl+Z` 后消失并保存，文件内容复原。
**清理**：7 篇临时笔记、`_c210` 标签、临时 CDP 脚本与当轮产生的历史快照（临时笔记目录、示例文档的两份重复快照）已删除；应用停在单标签 `写作示例.md`（分栏、已保存 22:33）。

---

## 第 209 轮 · 2026-10-30 22:26
**用户需求**：分栏里以一篇长笔记为主，中间点开几篇参考资料对照，切回刚看过的那篇又要等它整篇重算（约 0.38 秒、一次 100ms 卡顿）→ 期望缓存按最近使用淘汰，刚看过的先留住，别被随后打开的一篇踢掉。
**产品经理**：做。只改预览结果缓存的淘汰顺序，不扩大缓存上限、不改渲染与交互；注释本来就承诺「按最久未用淘汰」，改动让行为与承诺一致，符合「快、安静」。
**前端**：`preview-controller.ts` 的 `flush` 命中缓存时把该键 `delete` 后 `set` 回 Map 末尾（Map 按插入顺序迭代），使条目数 / 总量超限时的淘汰真正按最近使用而不是首次插入顺序。风险：命中路径只多两次 O(1) 映射操作；缓存键仍是全文，外部修改 / 撤销照常换新键。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/preview/preview-controller.ts`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc，978ms）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**验证**：CDP（9222）7 篇各 121,072 字节 / 800 个二级标题 / 800 个围栏代码块的临时笔记 `_c209_a..g.md`，分栏模式，点击文件树行到预览首个 `h2` 变成对应「C209 X 标题 1」计时，用 `PerformanceObserver` 记录长任务；每次测量前整页重载，固定点击顺序。
- 命中 / 未命中基线：未命中 351–383ms + 88–101ms 长任务，命中 133–155ms、无长任务（首屏替换 5,601 vs 7,201 个节点）。
- 修复前（顺序 `A,B,C,D,E,F,G,B`：B 第 2 步命中，随后插入 5 篇）：最后一次切回 B 仍是 377.9ms + 101ms 长任务（按首次插入顺序被淘汰）；修复后同一顺序最后一次 B 为 143.7ms、无长任务；两次运行其余各步均为未命中 353–383ms，可直接对照。
- 第 7 份淘汰仍正确：修复后 `A,B,C,D,E,F,G,A` 最后一次 A 为 361.7ms + 88ms 长任务，预览 800 个 h2 / 800 个代码块，确为重新解析而非复用旧结果，说明超限仍会释放并重建。
- 日常编辑未受影响：切到 `写作示例.md` 分栏，`Input.insertText` 输入 `Z` 约 1.2s 后预览出现，`Ctrl+Z` 后消失，正文与预览复原。
**清理**：7 篇临时笔记与临时标签已删除 / 关闭（无新增历史快照），整页重载后停在单标签 `写作示例.md`（所见、已保存 22:25）。

---

## 第 208 轮 · 2026-10-30 22:08
**用户需求**：在「所见」模式里看到一张表格或一个块级公式，想改里面的字，鼠标点上去却没有反应，只能先切到源码 / 分栏再去原文里找 → 期望点一下就直接就地显示这一块的 Markdown 源码，光标落在点的地方。
**产品经理**：做。所见模式里分隔线早已支持点击进入源码，表格 / 公式是同类的已实现功能粗糙处；只让被替换的块接受点击，渲染、数据、只读边界都不变，符合「快、安静」。
**前端**：`widgets.ts` 的 `MathWidget`（行内与块级共用）和 `TableWidget` 增加 `ignoreEvent(): false`，与 `RuleWidget` 同一做法，让 mousedown 由 CodeMirror 处理、光标映射进被替换的块，选区命中后 `block-decorations.ts` 现有的 `isActive` 逻辑自然退回源码。风险：表格单元格 / 公式里没有可交互元素，不会截获链接或图片点击；点击正文后 widget 照常恢复。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/editor/live-preview/widgets.ts`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc，1.06s）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**验证**：CDP（9222）临时笔记 `_rp208.md`（表格 + 块级公式）。改前点表格中心无任何反应，光标仍在 1:1、`.cm-wysiwyg-table` 仍为 1；改后点表格：widget 消失、状态栏 8:10（表格分隔行内）、源码 `| 列 A | …` 可见；键入 `X` 落在 8:11，`Ctrl+Z` 回到 8:10 且文本复原；点最后一段正文后表格 widget 恢复（计数 1）、光标 15:1。块级公式点击后公式 widget 消失、光标 12:3（`$$` 行内），表格 widget 同步恢复。另一篇 `_rp208i.md` 行内公式点击后光标 3:6、源码 `$E = mc^2$` 可见，点末段正文后行内 widget 恢复（计数 1）。`写作示例.md` 切回所见正常，无异常。
**清理**：临时笔记 `_rp208.md`、`_rp208i.md` 与历史快照目录 `0f4bc37f9d3663b8` 已删除；两个临时标签关闭并整页重载，应用停在单标签 `写作示例.md`（所见、93:1500 字、已保存 21:11）。

---

## 第 207 轮（检验轮）· 2026-10-30 22:03
**范围**：只回归本窗口第 202–206 轮（所见块级装饰增量、源码 / 所见隐藏预览不重写、大纲 memo + 位置 key、所见 / 源码不后台解析、预览结果缓存），不开新功能。
**构建**：`bun run build` 通过（含 tsc，966ms）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**CDP 实测**：
- 202：123KB / 1202 标题 / 1200 围栏的临时笔记，所见模式连打 20 字无长任务，6 个可见复制按钮节点未被重建（打标记后仍在）；语言框 js→python 保存后磁盘围栏语言正确变为 python，复制按钮截获内容与代码块一致；光标在围栏内 `Ctrl+Shift+L` 聚焦语言框；Enter 两次按设计整篇重建（6/6 组件仍在、无长任务），撤销恢复；表格 / 公式 widget 各 1 个正常渲染；1.26M 字符文档走 >1MB 回退，0 个块 widget，输入与撤销正常。
- 203：源码模式打开 C 时隐藏预览仍停在 A，切到分栏 126ms 显示 C；预览锚点 `#A207tail` 平滑滚到末尾标题；1200 个复制按钮与 1 个表格齐全。
- 204：大纲 1202 条，点「A207 标题 101」编辑器到 907:1、预览滚到 23119，仅该条选中；聚焦条目按 ↓ 移到「标题 102」；标题改名后大纲变为「…101Z」，Ctrl+Z 还原；源码模式连按 8 次 Enter 无长任务、大纲仍 1202 条（所见模式同操作有 100/78ms 长任务，来自 202 的整篇装饰重建，符合预期）；普通笔记大纲 10 条。
- 205：源码打开 C 后隐藏预览不变、切分栏 126ms 补上；1.26M 字符文档显示「预览失败：文档超过 1 MB，实时预览已暂停」；分屏对照开关正常（列出其它已开笔记），历史弹层与「导出 HTML」弹层可打开、Esc 关闭且焦点回正文。
- 206：A/B 两篇 123KB 首次打开 598/835ms；8 次标签互切缓存命中 214–369ms、标题正确、1200 个复制按钮；磁盘改 B 标题后切回 760ms 显示新标题；分栏输入 `ZZZ_207` 459ms 后出现在预览，Ctrl+Z 后消失；深色下代码文字 rgb(225,228,232)，切回跟随系统后内容与按钮不变；源码↔分栏 126ms。缓存上限淘汰未单独实测（需 7 篇大文档，路径未改）。
**问题与修复**：未发现产品缺陷，无需修复。观察：所见模式里表格 / 公式块为 atomic 替换 widget，点击与方向键都不会把光标放进块内（初始 WYSIWYG 设计如此，非本轮回归），表格编辑仍走源码 / 分栏，未改动。
**清理**：临时笔记 `_reg207a/b/c/big/huge.md` 与对应 4 个历史快照目录已删除；临时标签全部关闭并整页重载，应用停在单标签 `写作示例.md`（所见、500 字、已保存 21:11）。
**检验计数**：清零。

---

## 第 206 轮 · 2026-10-30 21:50
**用户需求**：分栏模式下在几篇几十万字的资料笔记之间来回切标签，每次都像第一次打开一样整篇重新解析，切回刚看过的那篇也要等一两秒 → 期望看过的笔记切回来能直接显示，别再让预览后台把同一篇重算一遍。
**产品经理**：做。纯性能优化，预览可见时的渲染结果、交互、数据都不变；缓存键就是 Markdown 全文，外部修改 / 撤销 / 重新读盘后内容不同必然换一份，符合「快、安静」，不扩大产品边界。
**前端**：`preview-controller.ts` 增加按 Markdown 全文索引的结果缓存（只存成功结果，最多 6 份、文本 + HTML 合计 1,200 万字符，超限按最久未用淘汰）；`flush` 命中时直接回结果并作废在途请求，Worker 回来时按最近一次发出的文本入缓存。风险：缓存不能跨内容复用，主题在 CSS 变量里切换、HTML 与主题无关，浮现的 DOM 后处理仍按 `docPath` / 主题各自重跑；均已验证。工作量 S。
**后端**：无。
**改动**：`src/features/preview/preview-controller.ts`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**裁决**：做。
**构建**：`bun run build` 通过（含 tsc）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**验证**：CDP（9222）两篇 461,965 字节 / 2500 个二级标题 / 2500 个代码块的临时笔记，分栏下点击标签到预览首个标题更新。改前 6 次互切每次 2,305–2,535ms、长任务 322–375ms、每次替换 22,497 个节点；改后状态恢复时 B 已入缓存，A 首次 2,371ms，此后 6 次缓存命中 472–532ms、无长任务。源码 ↔ 分栏来回时预览 0.3ms 就位（2500 个复制按钮仍在）。正确性：在磁盘上把 A 的首个标题改成「A 外部修改 1」再切回，预览 2,512ms 显示新标题、无旧内容；在 B 开头输入 `ZZZ` 预览出现，Ctrl+Z 后 `ZZZ` 消失、2500 个 h2 与复制按钮复原；设置里切深色 / 浅色，代码块文字色 rgb(36,41,46) ↔ rgb(225,228,232)、背景 rgb(255,255,255) ↔ rgb(27,32,30)，内容与 2500 个复制按钮不变；普通笔记 `写作示例.md` 3 个复制按钮、2 个链接提示、标题锚点齐全。
**清理**：临时笔记 `_perf206a.md`、`_perf206b.md` 与其历史快照目录 `959c697ee0333b25` 已删除；两个临时标签关闭并整页重载，应用停在单标签 `写作示例.md`（所见、500 字、已保存 21:11）。

---

## 第 205 轮 · 2026-10-30 21:42
**用户需求**：在「所见」或「源码」里从文件树、最近打开或标签来回切十几篇几十万字的大笔记，明明没在看预览，风扇却一直转、切一次响一下 → 期望没显示预览时别在后台解析整篇，切到分栏时再给当前这篇。
**产品经理**：做。只调整「什么时候让预览 Worker 解析」，预览可见时的渲染、交互与数据都不变；切到分栏本来就会由 `changeViewMode` 立即按当前内容请求一次，符合「快、安静」，不扩大产品边界。
**前端**：`workspace-actions.ts` 的 `openFile` 不再无条件 `requestPreview(file.content, true)`——只有分栏 / 纯预览模式才请求；所见 / 源码模式改为 `clearPreview()`，顺手释放上一篇留下的预览 HTML。风险：纯预览下打开必须照常显示（保留 `preview` 分支）；分栏切换与输入更新不能受影响，已逐项验证。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/workspace/workspace-actions.ts`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**验证**：CDP（9222）连 Worker 目标用 `Profiler`（200µs 采样）统计后台 CPU。8 篇 721,734 字节 / 370,252 字符、3000 个二级标题的临时笔记，所见模式依次切标签（点击到状态栏换篇后等 700ms）：改前采样 6,460ms 中非空闲约 3,500ms（remark-parse `go` 356ms、Shiki wasm 453ms、`consume` 215ms、`subtokenize` 136ms、GC 222ms 等），单篇整篇解析约 430ms；改后同样 8 次切换 6,420ms 全部 idle（0ms 解析）。主线程点击到状态栏换篇改前 94–104ms、改后 95–104ms，省下的是后台 CPU 而非把卡顿挪走。源码模式同样 8 次切换 6,141ms 全 idle。功能：所见下打开「内存测量文档 4」再切分栏，约 0.8s 后预览显示「内存测量文档 4」、600 个代码复制按钮、3001 个标题；分栏里切到文档 9 / 5 预览标题分别为「内存测量文档 9 / 5」（681 / 1009ms）；分栏里输入 `aaa` 预览出现 `aaa# 内存测量文档 5`，`Ctrl+Z` 三次后正文与预览都回到原文、状态栏 175,535 字「已保存」；普通笔记 `写作示例.md` 切分栏 h1「写作示例」、3 个代码复制按钮，再切回所见正常。
**清理**：临时笔记 `_mem205_01..12.md`、`_mem205_3mb.md` 删除；对应历史快照目录 `61762a694ee10184`、`ed61bac7564573fc`、`f1835ab8b144e41b` 删除；多余标签关闭并整页重载，应用停在单标签 `写作示例.md`（所见、大纲 10 条、500 字、已保存 21:11）。

---

## 第 204 轮 · 2026-10-30 21:26
**用户需求**：在大纲有几千个标题的资料笔记里按 Enter 另起一行，界面会定住一下，敲字时偶尔整块卡两百毫秒 → 期望加新行、改标题时大纲照样跟手，别每次重建整张列表。
**产品经理**：做。输入延迟与长文档是优化窗口的第一优先级；只改大纲列表的渲染方式，标题数据、跳动、键盘操作与高亮都不变，符合「快、安静」。
**前端**：`OutlinePanel.tsx` 把条目抽成 `memo(OutlineRow)`，只接收 `text/level/index/active/onJump` 这些原始值；跳转回调通过 ref 读取最新标题与视图模式，保持同一引用；列表 key 从 `heading-${from}` 改为位置下标——在标题上方插入文字会让所有 `from` 位移，旧 key 会让 React 卸载重建全部条目。风险：位置 key 在标题增删时依赖 props 更新，条目本身无内部状态；标题文本变化仍靠 `text` 触发重绘，已验证。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/outline/OutlinePanel.tsx`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**验证**：CDP（9222）用 981,806 字节 / 272,007 字符、8000 个二级标题的临时笔记，所见模式、大纲标签展开，每次 Enter 间隔 400ms。同一页面同一状态下 A/B：`key={heading.id}` 时 8 次 Enter 触发 7 个 160–203ms 长任务（另有 51/68/71ms），主线程在停手约 150ms 的大纲刷新里整体阻塞；改为 memo + 位置 key 后同样 8 次 Enter 只剩 1 个 54ms 长任务，无 160–203ms 阻塞（键按下到状态栏更新中位均约 27ms，收益在于不再订阅后卡顿）。功能：点第 100 项「标题 101」跳到 460:1 且只有它高亮；聚焦第 100 项按 ↓ 焦点移到「标题 102」；在标题里输入 `Z` 后大纲条目变为「标Z题 101」、`Ctrl+Z` 还原为「标题 101」；切分栏后点「标题 301」编辑器到 1260:1、预览滚到 36202、8000 个预览标题；普通笔记 `写作示例.md` 大纲 10 条、点「收尾」跳到 93:1。
**清理**：临时笔记 `_perf204.md` 与其历史快照目录 `58edc9c1b91c201d` 已删除，临时标签关闭并整页重载，应用停在单标签 `写作示例.md`（大纲 10 条、500 字、已保存 21:11）。

---

## 第 203 轮 · 2026-10-30 21:13
**用户需求**：在源码或所见模式下，几篇几十万字的资料笔记来回切标签，每切一次界面先停一下、随后又卡近一秒；明明没在看预览 → 期望切标签立即跟手，切到分栏时预览仍正确显示当前这篇。
**产品经理**：做。纯性能改动，预览可见时的渲染结果、交互与数据都不变；源码 / 所见模式下没有人看得到隐藏预览，没必要为它重建整篇 DOM，符合「快、安静」。
**前端**：`PreviewPane.tsx` 用 `previewVisible = split | preview` 门控预览 DOM 的全部工作——图片地址重写、整篇 innerHTML / 按块比对、标题锚点与链接提示、任务复选框、图注、Mermaid、代码块复制按钮；切换到分栏 / 预览时依赖里加上 `previewVisible`，再按最新结果重做一次。风险：漏掉某个后处理会让预览退回未加工状态，已逐项验证。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/preview/PreviewPane.tsx`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**验证**：CDP（9222）用三篇约 30 万字符的临时笔记实测。修复前源码模式下缓存标签互切：点击到状态栏换篇 109ms，另有 78ms 与约 695ms 两个长任务；CPU profile 显示 `patchPreviewBlocks` 395ms、`insertBefore` 206ms、DOM `remove` 125ms、`rewritePreviewImages` 54ms，全部来自 `display:none` 的隐藏预览。修复后同样两篇互切：源码模式 40.8–50.2ms、所见模式 29.1–45.4ms，均无长任务。切换后进入分栏：预览标题为当前笔记「性能对比笔记」，首屏 220ms、一个 186ms 长任务——重建成本从每次切标签移到真正打开预览时。普通笔记 `写作示例.md`：分栏 / 纯预览都有 3 个代码块复制按钮、标题锚点与链接提示；分栏输入 `Z` 预览约 0.8s 内出现、撤销后消失，复制按钮原地保留；纯预览显示正常。
**清理**：临时笔记 `_perf203a/b/c.md` 与 `_perf203b.md` 的 1 份历史快照已删除；三个临时标签关闭并整页重载，应用停在单标签 `写作示例.md`（所见、500 字、已保存 21:11）。

---

## 第 202 轮 · 2026-10-30 21:04
**用户需求**：在几十万字的资料笔记里用「所见」模式写作，每敲一个字都要顿一下，风扇也一直转；同样一篇在源码模式里就很顺 → 期望所见模式打字和源码模式一样跟手。
**产品经理**：做。输入延迟是优化窗口的第一优先级；只改「什么时候重建块级装饰」，界面、交互与渲染结果都不变，不扩大产品边界。
**前端**：`live-preview/block-decorations.ts` 的 `blockWidgets` 从「每次改动 / 光标移动都整篇遍历语法树重建 7624 条装饰」改为增量：普通输入把已有 `DecorationSet` 按 `changes` 映射即可；只有改动落在表格 / 公式内、增删换行、改动行以围栏 / `$$` 开头、普通段落里出现 `|`、或跨过 1 MB 阈值时才重建。选区变化只在「进入 / 离开表格 / 公式」时重建，其余直接复用。映射后 widget 缓存的绝对坐标会过期，`widgets.ts` 的代码语言框与复制按钮改为按 `view.posAtDOM` + 语法树找回当前围栏（`formatting.ts` 的 `Ctrl+Shift+L` 同样优先按 DOM 位置匹配）。风险：块边界识别漏判会留下过期的块 widget；已覆盖围栏开合、行合并、撤销、表格 / 公式进出与内容更新。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/editor/live-preview/block-decorations.ts`、`src/features/editor/live-preview/widgets.ts`、`src/features/editor/formatting.ts`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过（含 tsc）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**验证**：CDP（9222）构造 700k 字符、约 3800 个围栏代码块的临时笔记：修复前所见模式 36 次击键中位 57.9ms / p90 72.4ms / 最大 88.9ms，每个键一个约 58ms 长任务；修复后中位 3.7–4.0ms、p90 6.2–17.8ms、最大 22–32ms，无长任务。先是把光标前的 36 个字符打入文档使所有块坐标整体后移，再滚动到第一个代码块：聚焦语言框输入 `python` 回车，第一行围栏正确变为 ```` ```python ````，段落文字无污染（修复前会在旧坐标处插入 `python`）；复制按钮经 `execCommand` 截获的文本为 `const n1 = 1;\nconsole.log(n1);`，与块内容一致。`Ctrl+Shift+L` 在围栏内聚焦到语言框。表格 / 公式：选区进入时退回源码（表格、公式 widget 0 个），离开后恢复为 1 个；表格内输入 `X` 后源码即时可见，离开后表格 widget 显示 `甲X`；全选撤销后 2 个代码围栏对应 1 个语言框，无残留幽灵 widget。围栏在正文里新建（回车、回车、`` ```js ``）后语言框立即出现，撤销回原文后不残留。
**清理**：临时笔记 `_prof202.md`、`_prof202b.md`、`_test202.md` 与其 3 个历史快照目录已删除；_temp 标签关闭并整页重载，应用停在单标签 `写作示例.md`（所见、大纲 10 条、500 字、无未保存标记）。

---

## 第 201 轮（检验轮）· 2026-10-30 20:47
**范围**：只回归本窗口第 196–200 轮（字数统计单遍扫描、长文档大纲补齐、大纲读取缓存、状态栏保存时间缓存、预览去抖 / 源码不后台刷新），不开新功能。
**构建**：`bun run build` 通过（含 tsc）；本轮未改 `src-tauri/`，未跑 `cargo test`。
**CDP 实测**：
- 196：新建临时笔记输入「你好世界 Hello, world! 😀👍🏽 123 标点，。！？」→ 状态栏 9 字、悬停 28 个字符；拖选「你好世界 H」显示「选中 5 字」；emoji 与标点不计字，代理对按一个字符计。
- 197：打开 1.08MB / 8000 标题临时笔记，打开时大纲 767 条，滚到文末后自动补齐到 8000 条（末条「标题 8000」）；再插入 `## 新标题201` 立即变为 6 条且无重复。
- 198：Setext / 链接 / 图片 / 闭合 ATX / 转义 `\#` / 围栏内 `#` 边界文档大纲 5 条与预期逐条一致（围栏内不计）；在大文档（8000 条）与边界文档（5 条）间来回切换，条数不串、不重复。
- 199：输入后「待保存」悬停仍是上次保存时间；Ctrl+S 后显示「已保存 20:45」、悬停「2026/10/30 20:45:12」；切到另一篇显示其自己的 20:39。跨小时判断每次渲染都执行、时间字符串按 `savedModifiedMs` 缓存，未改系统时钟实测。
- 200：源码模式输入后隐藏预览 DOM 不变，切到分栏立即出现最新内容；分栏输入 `YYY` 即时预览不含、约 0.6 秒后出现、Ctrl+Z 撤回；>1MB 文档显示「实时预览已暂停」；分屏对照正常列出其他已开笔记，版本历史弹层列出 2 个版本并显示源码内容。
**问题与修复**：未发现产品缺陷。CDP 合成的 Home / 方向键在 CodeMirror 里不生效属测试工具限制（Enter、Ctrl+Z 正常），改用鼠标拖选与 `Input.insertText` 完成验证。
**清理**：临时笔记 `_reg201.md`、`_reg201big.md`、`_reg201edge.md` 及其两个历史快照目录已删除；多余标签关闭并整页重载，应用停在单标签 `写作示例.md`（大纲 10 条、500 字、已保存 20:39，2150 字节）。
**检验计数**：清零。

---

## 第 200 轮 · 2026-10-30 20:40
**用户需求**：在几十万字的资料笔记里用「源码」模式写作，明明没开预览，停手后风扇还是转、还卡一下；切到分栏时每敲一个字都像把整篇文档复制一遍 → 期望预览不可见时别在后台刷新，分栏里也别每一击键都取全文。
**产品经理**：做。只改「什么时候取全文、什么时候刷新预览」，预览可见时的行为与文案不变；本地优先、快、安静的延续，不扩大产品边界。
**前端**：`preview-controller.ts` 的 `requestPreview` 接受「文本或取文本的函数」，打字路径只存 getter，去抖结束才 `doc.toString()`；记住请求时的文档长度，超过 1 MB 直接给出「实时预览已暂停」而不取全文。`EditorPane.tsx` 在所见与纯源码模式下不再发起预览刷新（切回分栏 / 预览时 `changeViewMode` 会立即补一次）。风险：切视图前源码中的改动必须可见、历史与导出路径不能被影响；均已验证。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/preview/preview-controller.ts`、`src/features/editor/EditorPane.tsx`、`docs/loop/state.md`、`docs/loop/backlog.md`。
**构建**：`bun run build` 通过。
**验证**：先复测上一轮留下的假设：CDP 实测 30 次击键状态栏提交 34 次（约 1.1 次/键），并非约 4.4 次；不装调试钩子时单键到状态栏更新中位 1.9ms，按帧合并 / 拆分订阅收益有限，转而去掉真实的浪费。源码模式：466k 字符文档输入 `QQQ` 等 1.2s，隐藏预览 DOM 未变（改动前会更新）；切到分栏后立即出现 `QQQ`。分栏模式：输入 `YYY` 约 0.6s 后预览出现，撤销后恢复；466k 文档逐键延迟中位 1.6ms → 1.1–1.5ms（前后各 3 组、整页重载后测量），3.1MB 文档 1.2–1.5ms → 1.1–1.5ms——该档主要收益是源码模式不再后台解析、不再更新隐藏预览。3.1MB 文档仍正确显示「文档超过 1 MB，实时预览已暂停」，现在按长度短路、不取全文。文档历史弹层预览正常（字符串 + 立即路径未变）。临时笔记 `_prof200.md` / `_big200.md` / `_huge200.md` 与其历史快照已清理；应用停在单标签 `写作示例.md`（所见、大纲 10 条、500 字、已保存，2150 字节）。

---

## 第 199 轮 · 2026-10-30 20:22
**用户需求**：打字时状态栏跟着光标刷新，每敲一个字都要重新格式化一次「已保存」时间 → 长文档或快速输入时每一击键都多花一点时间 → 期望保存时间只在真的保存后才重算，打字时状态栏只更新光标与字数。
**产品经理**：做。输入延迟是优化窗口的第一优先级；只改状态栏的展示缓存，不动保存逻辑与界面文案，跨午夜仍按当天重新判断。
**前端**：`src/app/StatusBar.tsx` 把已保存时间的时分与悬停提示里的完整时间用 `useMemo` 按 `savedModifiedMs` 缓存，字数 / 字符数的本地化字符串按对应数值缓存；同一天 / 隔天的判断仍每次渲染执行（成本极低），保持跨午夜正确。风险：保存后 `savedModifiedMs` 变化即失效，已用真实保存验证。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/app/StatusBar.tsx`、`docs/loop/state.md`。
**构建**：`bun run build` 通过。
**验证**：CDP（9222）实测：30 次击键内 `toLocaleTimeString` 调用由 268 次 / 9.1ms 降为 0（改前每次击键约 0.30ms，全部来自 StatusBar 渲染）；键按下到状态栏光标提交延迟 90 次中位 1.9ms → 1.6–1.7ms，p90 2.2ms → 1.9–2.0ms。真实保存后「已保存 20:18」→「20:22」，悬停完整时间同步更新；撤销并再保存后字数回到 500，示例文件保持 2150 字节。测试输入已撤销，页面已重载，应用停在单标签 `写作示例.md`。

---

## 第 198 轮 · 2026-10-30 20:20
**用户需求**：打开一篇三兆多、八千个标题的资料笔记，滚动时大纲每 150ms 重读一遍，打字时状态栏统计也顺带重算全文大纲，输入偶尔发涩 → 期望大纲只重算真正变了的标题，别每次都把整篇标题去标记、清正则。
**产品经理**：做。输入延迟与长文档是优化窗口的第一优先级；这次只改进 `readOutline` 的内部缓存，不改大纲数据、不改交互与解析策略，8000 个标题的输出与旧实现逐项一致。
**前端**：`src/features/editor/outline.ts` 增加两层缓存——清洗后的标题文本按「原始标题行 + ATX/Setext」缓存（超过 12000 条整体清空），同一份文档内按标题位置缓存行号（文档对象变了才清，上限 20000 条）；遍历时先按节点名首字母挡掉非标题节点，少跑大量正则。风险：缓存键必须覆盖 Setext 与 ATX 差异、行号缓存不能跨文档复用，已分别处理。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/editor/outline.ts`、`docs/loop/state.md`。
**构建**：`bun run build` 通过。
**验证**：CDP（9222）在 3.6MB / 8000 标题的临时笔记里实测：同一状态反复读大纲 9.0–10.2ms → 4.6ms；模拟连续输入（每次新文档状态取一次）9.9ms → 6.9ms。新旧实现对 8000 个标题的 `id/level/text/from/line` 逐项比对完全一致；Setext、链接 / 图片、闭合 ATX、转义、围栏内 `#` 等边界文档输出也一致。整页重载后真实运行：大纲面板 8000 条、光标在文末时高亮「标题 8000」，真实键入后仍是 8000 条、高亮不跳。临时笔记、其历史快照与多余标签已清理，应用停在单标签 `写作示例.md`。

---

## 第 197 轮 · 2026-10-30 20:04
**用户需求**：打开一篇几十万字的资料笔记，左侧大纲只列出前几百个标题，后面全缺 → 一直不输入就永远不补，滚动到文末也不更新，只有随手敲一个字才突然补齐 → 期望大纲随文档解析进度自动补齐。
**产品经理**：做。属于长文档下的真实粗糙处（大纲 / 跨笔记锚点定位都读这份数据），只在大纲数据上加刷新时机，不改解析策略、不改交互。
**前端**：先实测再动手——38 万字 / 2812 个标题时 `readOutline` 约 2.6ms，150ms 统计定时器整次 3.7ms，单独优化收益有限；测量时发现更大的问题：后台解析推进（滚动长文档）产生的事务只更新语法树、不触发大纲刷新，大纲停在打开时解析到的部分。修复：`editor-setup` 在无文档改动的更新里比较 `syntaxTree(startState/state)`，有推进就调新回调 `onOutline`；`editor-bridge` 透传；`EditorPane` 用独立 150ms 去抖只重读大纲，不重算字数。风险：解析频繁时分片刷新会增加少量开销（每次约 2.6ms，仅解析期间）。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/features/editor/editor-setup.ts`、`src/features/editor/editor-bridge.ts`、`src/features/editor/EditorPane.tsx`。
**构建**：`bun run build` 通过。
**验证**：CDP（9222）用 2.24MB / 8000 个标题的临时笔记：打开后大纲 803；修复前滚到文末等 2.5s 仍是 803，输入一次才补齐；修复后滚到文末 500ms 内增至 8000，再输入一个新标题变 8001。普通笔记 `写作示例.md` 大纲 10 条正常。临时文件与多余标签已清理，应用停在单标签 `写作示例.md`，无未保存标记、无恢复弹层。

---

## 第 196 轮 · 2026-10-30 19:50
**用户需求**：在几十万字的资料笔记里连续打字，状态栏字数每跳一次就轻微卡一下 → 期望长文档输入不被字数统计拖慢，字数与字符数仍然准确。
**产品经理**：做。输入延迟是优化窗口的第一优先级；字数统计每 150ms 在主线程全量重算，长文档下会落在输入路径上，纯函数优化不改交互与内容。
**前端**：`src/lib/text-stats.ts` 把「全局正则 match + replace + Array.from」换成单遍扫描：CJK 基本区走快路径，ASCII 区分空白 / 单词 / 连接符，非 ASCII 处理兼容区汉字、Unicode 空白与代理对；字数与字符数语义保持不变（代理对按一个字符、emoji 不计字）。风险：边界字符统计需与旧实现逐项对照。工作量 S。
**后端**：无。
**裁决**：做。
**改动**：`src/lib/text-stats.ts`。
**构建**：`bun run build` 通过。
**验证**：CDP（9222）在运行中的应用里与旧算法对照：5 万条随机混排样本、全部 65536 个 BMP 码点逐字符检查，字数与字符数零差异；50 万字符文本单次统计中位 12.8ms → 1.9ms（约 6.7 倍）；打开 `子目录/笔记.md` 后状态栏显示 53 字 / 92 字符，与磁盘内容直接计算一致。测试后关闭标签、视图恢复为「所见」，未留下临时文件或历史快照。

---

## 第 195 轮（检验轮 / 收尾）· 2026-10-30 22:15
**范围**：只回归第 192–194 轮及相邻功能（标签记忆、标签栏宽度、超长文档去抖），修问题不开新功能；同时给本轮循环收尾。
**构建**：`bun run build` 通过；`cargo test` 40 passed（后端自第 183 轮后未再改动）。
**CDP 实测**：三篇标签整页重载后按原顺序恢复、当前笔记不变；关掉标签后重载不再出现；删除文件后点击失效标签报错并自动摘除；820px 视口下文档宽 820、标签栏在自身滚动区滑动、`Ctrl+Tab` 切到屏幕外标签会滚进视野；49.6 万字符文档预览刷新 723ms、普通笔记 206ms；分屏 `Ctrl+\` 开合与对照下拉正常；搜索「笔记」19 条结果；命令面板按「PDF」筛出「导出 PDF…」；历史弹层可打开。
**问题与修复**：文档历史弹层不响应 Esc（其他弹层都有），在 `HistoryDialog` 挂全局 Esc 监听，关闭后焦点归还正文；修后复测 Esc 与「关闭」按钮都生效。
**清理**：测试用 `_reg191.md`、`_long191.md`、`_big194.md` 及其历史快照、测试输入与多余标签全部清理；应用停在单标签 `子目录/笔记.md`，无未保存标记。
**检验计数**：清零，循环收尾。

---

## 第 194 轮 · 2026-10-30 21:58
**用户需求**：整理一篇几十万字的资料笔记，打字时预览跟着每一击键整篇重解析，风扇一直转 → 期望大文档停手后再刷新，别抢输入。
**产品经理**：做。按块更新解决的是「重绘」，「解析」频率还没管；只延长大文档的去抖，普通笔记手感不变，符合「快、安静」。
**前端**：`preview/preview-controller.ts` 按 `markdown.length` 分档：超过 12 万字符用 600ms 去抖，其余仍 200ms。风险：大文档停手后预览晚 0.4 秒出现，可接受。
**后端**：无。
**裁决**：做。
**改动**：`src/features/preview/preview-controller.ts`、README、`docs/loop/state.md`。
**构建**：`bun run build` 通过。CDP 实测：3000 块 / 49.6 万字符文档，输入到预览出现 723ms；普通笔记 206ms；大文档预览块数与正文一致。临时大文档、其历史快照与测试输入均已清理（笔记.md 已还原并保存，无未保存标记）。

---

## 第 193 轮 · 2026-10-30 21:34
**用户需求**：窗口没最大化时同时开了十来篇笔记 → 标签栏把整个窗口撑出横向滚动条，状态栏也跟着变宽 → 期望标签只在标签栏里滚动，切到哪个标签就看得见哪个。
**产品经理**：做。属于多标签落地的粗糙处，纯样式修复，不改交互与数据。
**前端**：`app/App.css` 给根网格补 `grid-template-columns: minmax(0, 1fr)`，压住标签栏的最小内容宽度；`tabs/TabBar.tsx` 记住当前标签并在切换时 `scrollIntoView`。风险：`scrollIntoView` 可能连页面一起滚，用 `block/inline: nearest` 限制在标签栏内。
**后端**：无。
**裁决**：做。
**改动**：`src/app/App.css`、`src/features/tabs/TabBar.tsx`、README、`docs/loop/state.md`。
**构建**：`bun run build` 通过。CDP 模拟 820px 视口、10 个标签：修复前文档宽 1035（横向溢出）、修复后文档宽 820、标签栏 580 且 `scrollWidth` 1035；连按 9 次 `Ctrl+Tab`，标签栏 `scrollLeft` 到 351，当前标签完整可见；恢复宽屏无变化。

---

## 第 192 轮 · 2026-10-30 21:20
**用户需求**：每天在同一个库里同时开着三四篇笔记，关掉应用再开 → 标签栏只剩上一篇，其余都要去文件树里重新点 → 期望上次的一组标签原样回来。
**产品经理**：做。只记相对路径、不碰内容，符合本地优先与纯文本；切库、重启都能接上，标签的已有语义不变。
**前端**：新增 `workspace/tabs-memory.ts`（按工作区存标签路径、恢复期间暂停落盘）；`workspace-actions.ts` 在工作区打开 / 启动恢复时先读旧标签再清空，恢复后补回非当前笔记；`App.tsx` 订阅标签变化落盘。风险：换库时先清空后补回的中间态可能覆盖记录，用暂停 / 恢复写入规避。
**后端**：无。
**裁决**：做。
**改动**：`src/features/workspace/tabs-memory.ts`（新）、`src/features/workspace/workspace-actions.ts`、`src/app/App.tsx`、README、`docs/loop/roadmap.md`、`docs/loop/state.md`。
**构建**：`bun run build` 通过。CDP 实测：打开三篇笔记后整页重载，标签按原顺序恢复、当前笔记不变；关掉一个标签再重载不再出现；把临时文件删掉后点它的标签提示打开失败并自动摘掉标签，重载只剩有效标签。
**探索与回退**：为「长文档虚拟化」试了 `.markdown-body > * { content-visibility: auto }`（1260 块文档），跳转到末节时目标标题实际偏出 34773px、`scrollHeight` 从 158683 虚估成 92207，分屏滚动同步同样失真；已完整回退，改在 roadmap 记为需架构改造的项目。

---

## 第 191 轮（检验轮）· 2026-10-30 20:52
**范围**：只回归第 186–190 轮（分屏对照、图片宽度/对齐/图注、自定义 CSS、导出 PDF、预览按块更新），不开新功能。
**构建**：`bun run build` 通过；`cargo test` 40 passed。
**CDP 实测**：分屏对照 `Ctrl+\` 打开、下拉只列其他已开笔记、关闭正常；图片 `width=50%` 与 `md-align-center`、figure + `figcaption`「回归图注」；标签栏多标签切换；自定义 CSS 写入后 `#feiye-custom-css` 生效（标题字距 3px），清空后样式节点移除、字距复原；命令面板 22 条含「导出 PDF…Ctrl+P」；`buildPrintableHtml` 生成 79k 字符、`size:A4`、KaTeX、图片内联；真实点击输入后预览顶层块 3/4 保持同一节点、图注与分屏内容不动。
**问题**：无产品缺陷。测试期间误点标题栏「关闭」造成一次应用退出，已重启并复测；临时笔记 `_reg191.md` 与其历史快照已删除。
**修复**：无。
**检验计数**：清零。

---

## 第 190 轮 · 2026-10-30 20:32
**用户需求**：在一篇几千字的笔记里改一个段首字 → 现在每停一下预览就整篇重建，代码高亮闪一下、图表重画、滚动位置也跟着跳 → 期望只重画改动的那一段，未变的内容保持原样。
**产品经理**：做。预览是核心阅读面，长文输入手感直接决定是否「快、安静」；按块更新不改 Markdown 管线，只在主线程按顶层块做差量替换，风险可控。
**前端**：`preview/PreviewPane.tsx` 去掉 `dangerouslySetInnerHTML`，改由 `useLayoutEffect` 调用 `patchPreviewBlocks`（前缀 / 后缀比对 + 中间段替换），换文档时整篇重来；Mermaid 效果改为只处理新代码块，主题变化时才重画已有图表。风险：后处理效果（复制按钮、标题 id、图注）需要保持幂等，已逐项确认。
**后端**：无。
**裁决**：做。
**改动**：`src/features/preview/PreviewPane.tsx`、README、`docs/loop/roadmap.md`、`docs/loop/state.md`。
**构建**：`bun run build` 通过。CDP 实测：改动第 4 块时前 3 块与末块仍是同一 DOM 节点（`sameCount: 4/5`）；中间插入一段后首尾节点保留、块数正确；含 Mermaid + 代码 + 图注的文档改动末段，Mermaid 图与代码包裹节点原样保留，图注仍为「图注」；主题切换后图表仍在位。

---

## 第 189 轮 · 2026-10-30 20:15
**用户需求**：写完一篇带代码、公式和图片的笔记，想发给不用 Markdown 的人 → 现在只能导 HTML / 复制富文本，对方未必会开浏览器看，也不方便打印 → 期望按打印版式一键导出 PDF。
**产品经理**：做。本地优先、不新增依赖，走系统打印对话框（「另存为 PDF」）即可；不是静默写盘，用户对版式与打印目标有最终控制。
**前端**：`app/Toolbar.tsx` 增 `buildPrintableHtml`（复用预览 Worker 渲染、内联图片、嵌入 KaTeX CSS 与 A4 打印样式）/ `printActiveDocument`（隐藏 iframe + `print()`）；`app/App.tsx` 绑定 `Ctrl+P`；`commands/CommandPalette.tsx` 增「导出 PDF…」。风险：WebView2 打印对话框阻塞 UI，已在测试中用 `buildPrintableHtml` 单独验。
**后端**：无。
**裁决**：做。
**改动**：`src/app/Toolbar.tsx`、`src/app/App.tsx`、`src/features/commands/CommandPalette.tsx`、README、`docs/loop/roadmap.md`、`docs/loop/state.md`。
**构建**：`bun run build` 通过；CDP 动态导入 `buildPrintableHtml` 实测：101k 字符自足 HTML，含 `size:A4`、KaTeX 样式、标题 `<h1>`、3 张图片全部内联为 data URI，无 `feiyeimg://` 残留。真实打印对话框需人工点 `Ctrl+P` 验证。

---

## 第 188 轮 · 2026-10-30 20:10
**用户需求**：默认排版看久了想微调（标题颜色、引用线、行距），又不想改源码重新构建 → 希望设置里能直接写一小段 CSS，立刻看到效果，重启后还在。

**产品经理**：做。README「后续」里的「自定义 CSS 与主题」。自定义样式是本地优先编辑器常见的个性化出口；只在设置里存一段文本、注入本机页面，不碰工作区与构建，也不引入主题市场。

**前端**：`lib/theme.ts` 新增 `applyCustomCss`：按需创建 / 更新 `<style id="feiye-custom-css">`，空白内容直接移除，单条上限 20k 字符；`stores/settings.ts` 增加 `customCss` 偏好（默认空、加载校验、变更即应用、恢复默认一并清空）；`SettingsDialog` 外观排版底部新增「自定义 CSS」文本域与示例、说明（只存本机）；设置样式补文本域外观。风险：样式作用于全局页面，用户写法可能影响界面——说明里注明作用于编辑器与预览，留空即关闭；读取时截断超长内容。工作量 S。

**后端**：无改动。

**裁决**：做

**改动**：`src/lib/theme.ts`、`src/stores/settings.ts`、`src/features/settings/SettingsDialog.tsx`、`settings.css`；README / roadmap 勾选。

**构建**：通过（`bun run build` 1.06s，含 tsc）。

**验证**：CDP（9222）：设置 → 外观排版输入 `.markdown-body h1 { color: rgb(199, 21, 133) !important; }` → 页面出现 `#feiye-custom-css`，预览 H1 计算色变为 rgb(199, 21, 133)；整页刷新后样式仍应用、文本域回显原值；清空文本域后 `<style>` 移除、H1 颜色恢复默认；Esc 关闭设置。测试后已清空自定义样式。

**遗留 / 下一轮建议**：无实时语法校验；样式注入后不区分亮暗主题（用户可自行写 `[data-theme]` 选择器）。下一轮可做「导出 PDF」或「预览性能优化」。

---

## 第 187 轮 · 2026-10-30 19:55
**用户需求**：插图后只能按原尺寸铺满行宽，长图太大、小图又居中不了 → 希望预览里能按比例缩小、左右 / 居中摆放，并给图片加一行图注，而不用写 HTML。

**产品经理**：做。README「后续」里的「图片缩放、对齐与图注」。用纯文本属性块与 title 表达排版，不引入内嵌 HTML、不改图片文件；属性解析白名单化，守住安全与「纯文本」。

**前端**：`markdown.worker.ts` 增加图片属性解析：识别图片后的 `{width=50% align=center}`，只接受 `width`（1–4 位数字 + `%` / `px`）与 `align`（left/center/right），通过 mdast `hProperties` 输出为 `width` 与 `md-align-*` 类，并从正文里移除属性文本；sanitize 白名单只放行这两个。新增 `features/preview/figures.ts`：把带 `title` 的图片包进 `figure.md-figure` 并生成 `figcaption`，对齐类同步到 figure；主预览与分屏对照都调用。`preview.css` 补宽度、对齐与图注样式（figure 内对齐用更具体选择器覆盖居中）。风险：属性块必须是图片后紧跟的独立文本节点；非法属性静默忽略，不报错也不透传。工作量 S。

**后端**：无改动。

**裁决**：做

**改动**：`src/features/preview/markdown.worker.ts`、`figures.ts`、`PreviewPane.tsx`、`preview.css`、`src/features/split/SplitPane.tsx`；README / roadmap 勾选。

**构建**：通过（`bun run build` 997ms，含 tsc）。

**验证**：CDP（9222）：新建含三张图的笔记（默认 / 50% 居中 / 30% 居右，后两张分别带图注）→ 预览里生成 2 个 `figure`，图注为「默认图注」「右侧小图」；第二张 `width=50%`、类 `md-align-center`、左右边距相等，第三张 `width=30%`、`md-align-right`、左边距推开且右边距 0，图注右对齐；属性文本不出现在正文；`{width` 字样不可见。主预览与分屏对照共用同一增强逻辑。测试后切回源码视图、删除测试笔记。

**遗留 / 下一轮建议**：宽度需手写属性，不能用鼠标拖拽调整；图注字号跟随 `0.82em`。下一轮可做「自定义 CSS 与主题」或「导出 PDF」。

---

## 第 186 轮 · 2026-10-30 19:39
**用户需求**：写一篇总结时要反复对照另一篇笔记，来回点标签切来切去 → 希望两篇并排，左边写、右边能看另一篇；切换主文档时对照的那篇不要跟着乱跳。

**产品经理**：做「分屏对照」这一半：右侧并排渲染另一篇已打开笔记，左侧照常编辑。把两篇同时可写拆成独立条目：当前编辑器是单实例架构（工具栏 / 保存 / 大纲 / 光标都围绕当前文档），双编辑器同屏写需要整体重构，不是一轮能安全完成的事；先交付最常用的对照阅读，符合「快、安静」。

**前端**：`ui` store 增加 `splitOpen / splitPath / toggleSplitPreview / closeSplitPreview / setSplitPath`；新增 `features/split/SplitPane.tsx`、`split-preview.ts`、`split.css`：右侧栏从已打开标签里选一篇（排除当前主文档），独立 Worker 渲染、图片改写、Mermaid 按主题重画；监听 `workspace-changed` 与窗口聚焦，外部修改后自动重读；对照区链接点击不跳转，避免主文档被切走。App 把 `<main>` 包进 `.main-row`，`Ctrl+\` 开关；命令面板新增「分屏对照」（至少两篇才可用）。风险：自动选取逻辑在「当前对照被切成主文档 / 标签关闭」时换到下一篇；主预览与对照各用一个 Worker，互不顶掉结果。工作量 M。

**后端**：无改动。

**裁决**：做（分屏对照；双编辑器同屏编辑另列）

**改动**：`src/stores/ui.ts`、`src/features/split/SplitPane.tsx`、`split-preview.ts`、`split.css`、`src/app/App.tsx`、`src/features/commands/CommandPalette.tsx`；README / roadmap 更新（「分屏并排编辑」拆为已完成的对照与未做的双编辑器）。

**构建**：通过（`bun run build` 1.48s，含 tsc）。

**验证**：CDP（9222）：打开 A / B 两篇 → `Ctrl+\` 后右侧出现对照栏，B 为主文档时右侧渲染 A，切到 A 后右侧自动换成 B；B 的加粗、行内代码、列表均正确渲染；对照下拉可切换；`×` 与再次 `Ctrl+\` 均能关闭；外部改写 B 文件后约 1 秒右侧自动刷新为新内容。测试后已关闭标签、删除测试笔记。

**遗留 / 下一轮建议**：对照区只读，不能直接编辑；双编辑器同屏编辑待架构重构。下一轮可做「图片缩放、对齐与图注」或「自定义 CSS 与主题」。

---

## 第 185 轮（检验轮）· 2026-10-30 19:18
**用户需求**：按节奏检验第 180–184 轮（点缀色、命令面板、全文搜索、文档历史、多标签），只回归与修复，不开新功能。

**产品经理**：检验轮。重点看新功能之间的交叉：标签与搜索 / 历史 / 命令面板、专注模式与标签栏、主题与标签选中态。

**前端**：本次修复 1 处：专注模式此前只收侧栏与工具栏，新加的标签栏仍留在正文上方；改为专注时一并隐藏，退出后恢复。其余未改动。

**后端**：无改动。

**裁决**：修复 + 清零检验计数

**改动**：`src/app/App.tsx`（专注模式隐藏 `TabBar`）。

**构建**：通过（`bun run build` 1.53s，含 tsc）；`cargo test` 40 passed。

**验证**：CDP（9222）：① 设置 → 外观：赭石切换后 `data-accent=umber`，切回靛青无属性；Esc 关闭设置。② `Ctrl+Shift+P` 打开命令面板 21 条命令，含「在工作区中搜索」「版本历史…」，Esc 关闭。③ 标签：打开 A / B 两篇，A 输入并保存两版 → `Ctrl+Alt+H` 历史显示 2 条，恢复旧版后「待保存」，切到 B 再切回 A 内容仍为恢复版本（缓存未覆盖）；搜索「第二篇」命中 B，点击后定位命中行且标签不重复；`Ctrl+Tab` / `Ctrl+W` 正常。④ 专注模式 `Ctrl+Shift+F` 后标签栏与工具栏均隐藏，退出后标签栏恢复。测试后已关闭标签、删除测试笔记。

**遗留 / 下一轮建议**：未发现其他回归；标签不跨重启恢复属既定设计。下一轮继续路线图：分屏并排编辑、图片缩放 / 对齐 / 图注、自定义 CSS、PDF 导出、预览性能。

---

## 第 184 轮 · 2026-10-30 19:05
**用户需求**：来回对照两篇笔记时，每次都要从文件树点开另一篇、再点回来，光标和撤销历史还会丢 → 希望像常见编辑器一样多开几个标签，点一下就能切换，切回来还能接着撤销。

**产品经理**：做。README「后续」里的「多标签与分屏编辑」，先做多标签；只增加一个轻量标签栏，不改变单文档保存与预览模型，符合「快、安静」；上限 12 个避免标签栏被挤爆。

**前端**：新增 `stores/tabs.ts`（增删 / 改名移动重映射 / 清空，上限 12）；`features/tabs/TabBar.tsx` + `tabs.css`，标签可点击切换、`×` 关闭、左右方向键在标签间移动，未保存标签带点；App 在主区上方加 `.main-column` 包裹标签栏，`Ctrl+Tab` / `Ctrl+Shift+Tab` 循环、`Ctrl+W` 关闭；`workspace-actions` 新增 `closeDocumentTab`（未保存先走 `guardUnsaved`，关闭当前标签切到相邻标签，最后一个关闭回到空状态）与 `switchDocumentTab`；打开 / 重命名 / 移动 / 删除 / 打开失败时同步标签。编辑器按文档路径缓存 `EditorState`（最多 12 份），切回内容一致时直接恢复，撤销历史与选区不再丢；重新加载、历史恢复走新状态。风险：缓存状态跨源码 / 所见模式切换时重新套用当前模式；切换工作区与编辑器重挂载时清空缓存。工作量 M。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/stores/tabs.ts`、`src/features/tabs/TabBar.tsx`、`tabs.css`、`src/features/editor/editor-bridge.ts`、`src/features/workspace/workspace-actions.ts`、`src/features/editor/save.ts`、`src/features/history/HistoryDialog.tsx`、`src/app/App.tsx`；README / roadmap 勾选（分屏拆为独立条目）。

**构建**：通过（`bun run build` 1.10s，含 tsc）。

**验证**：CDP（9222）：新建 A / B 两篇 → 从文件树打开后标签栏依次出现 A、B，B 带焦点；点 A 标签切回 A；在 A 末尾输入 `UNDO_MARKER`（标签出现未保存点）后立刻切到 B，再切回 A，`Ctrl+Z` 能撤销掉标记（撤销历史随标签保留）；`Ctrl+Tab` 从 A 切到 B、`Ctrl+W` 关闭 B 并自动切回 A；点 A 的 × 关闭最后一个标签后回到空状态；状态栏「待保存」与保存均正常。测试后已删除测试笔记。

**遗留 / 下一轮建议**：标签不跨重启恢复；分屏并排编辑尚未做。按节奏下一轮为检验轮（第 180–184 共 5 条需求），回归后清零。

---

## 第 183 轮 · 2026-10-30 18:58
**用户需求**：改稿时把一段话越改越远，想找回半小时前的版本 → 撤销历史只管当前会话，切换文档或重启后就没了；希望每次保存都有留档，能看、能恢复，而且不要把历史混进工作区。

**产品经理**：做。README「后续」里的「文档历史与本地快照」。保存快照是本地优先编辑器的兜底能力，直接服务「数据安全」；快照存应用数据目录、不写工作区、不自动覆盖源文件，「恢复」只载入编辑器并标记未保存，符合「安静、可反悔」。

**前端**：新增 `features/history/HistoryDialog.tsx` + `history.css`：左侧版本列表（时间、大小、最新标记）、右侧纯文本预览，恢复前二次确认；恢复时纯预览先切分栏，`setEditorDocument` 载入旧内容后 `markDirty(true)`，提示「按 Ctrl+S 保存后写入磁盘」。`ui` store 增加 `historyOpen` / `openHistory()` / `closeHistory()`；App 绑定 `Ctrl+Alt+H`、计入 `dialogOpen()`、渲染对话框；命令面板新增「版本历史…」；`save.ts` 在两处成功写盘后异步调用 `saveHistory`（失败不影响保存）。风险：恢复不直接写盘，避免绕过未保存守卫与 mtime 校验。工作量 M。

**后端**：新增 `src-tauri/src/history.rs`：按「工作区 + 文档路径」哈希分目录，快照为 `<毫秒时间戳>[-序号].md`；内容与最新快照相同则跳过；每篇只留最近 20 份，超出自动清理；`read_history` 校验编号只允许数字与 `-`，防止路径穿越。`commands/history.rs` 暴露 `save_history / list_history / read_history`，注册到 `lib.rs` 与 `lib/tauri.ts`。含 4 个单元测试。工作量 M。

**裁决**：做

**改动**：`src-tauri/src/history.rs`、`commands/history.rs`、`commands/mod.rs`、`src-tauri/src/lib.rs`、`src/lib/tauri.ts`、`src/features/editor/save.ts`、`src/features/history/HistoryDialog.tsx`、`history.css`、`src/stores/ui.ts`、`src/app/App.tsx`、`src/features/commands/CommandPalette.tsx`；README / roadmap 勾选。

**构建**：通过（`bun run build` 878ms，含 tsc）；`cargo test` 40 passed（新增 4 个）。

**验证**：CDP（9222）：新建 `历史测试-183.md`，编辑并保存两版 → `Ctrl+Alt+H` 打开面板显示 2 条（最新 54 B / 旧版 42 B），默认预览最新；点旧版预览为「版本二的内容」，点「恢复此版本」弹确认，载入后编辑器回到旧内容、状态栏「待保存」、提示按 Ctrl+S 写盘；保存后磁盘内容确为旧版。相同内容重复保存由单测验证不新增快照；20 份上限、路径穿越拒绝由单测覆盖。测试后已删除测试笔记并切到 `写作示例.md`。

**遗留 / 下一轮建议**：历史目录留给用户缓存的条目没有清理入口（可在后续设置里加「清空历史」）；恢复不提供 diff 对比。下一轮可做「多标签与分屏编辑」或「图片缩放、对齐与图注」。

---

## 第 182 轮 · 2026-10-30 18:56
**用户需求**：笔记散在多个文件夹里，记得写过「某句话」，但忘记在哪一篇 → 只能逐个打开文件树翻找；编辑器里的 Ctrl+F 又只搜当前文档。希望跨整个工作区搜关键词，点结果直接到命中行。

**产品经理**：做。README「后续」里的工作区全文搜索，是本地优先编辑器最常用的检索入口；只读文件、不改内容，结果即时呈现，符合「快、安静」；搜索范围与文件树一致，不引入索引库。

**前端**：新增 `features/workspace/SearchPanel.tsx` + `search.css`：输入停顿 200ms 去抖调用后端，显示「搜索中 / N 条结果 / 没有匹配」；每行结果为「相对路径:行号 + 命中行预览」，关键词用 `<mark>` 高亮；↑↓ 选择、回车或点击打开（复用 `openFile` 的未保存守卫），纯预览模式下先切分栏，再按行号换算字符偏移 `jumpToEditorPosition` 定位。`SidebarTab` 扩展 `search` 并持久化；`ui` store 增加 `searchRequest` / `openSearchPanel()`，命令面板新增「在工作区中搜索」并切到搜索标签、聚焦输入框。风险：文档未切换成功（守卫取消 / 读盘失败）时不跳转；同一篇已打开时直接定位。工作量 M。

**后端**：新增 `commands/search.rs`：`search_workspace(query, limit)` 从当前工作区根递归扫描，跳过隐藏项、`IGNORED_DIRS`、符号链接与非 Markdown，单文件 > 2MB 跳过，按行大小写不敏感匹配，返回 `relPath / line / text`（长行截断 240 字符），默认最多 200 条；注册到 `lib.rs` 与 `lib/tauri.ts`。含 2 个单元测试。工作量 S。

**裁决**：做

**改动**：`src-tauri/src/commands/search.rs`、`commands/mod.rs`、`src-tauri/src/lib.rs`、`src/lib/tauri.ts`、`src/features/workspace/SearchPanel.tsx`、`search.css`、`WorkspaceSidebar.tsx`、`src/stores/ui.ts`、`src/features/commands/CommandPalette.tsx`；README / roadmap 勾选。

**构建**：通过（`bun run build` 1.21s，含 tsc）；`cargo test` 36 passed（新增 2 个）。

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`）：新建根目录与 `子目录/` 两篇含 `ZEBRAFISH_182` / `zebrafish_182` 的测试笔记 → 搜索标签输入小写 `zebrafish_182`，200ms 后显示「2 条结果」，路径 / 行号 / 命中行正确且高亮 2 处（大小写不敏感）；点击第一条打开 `子目录/搜索测试-182b.md` 且活动行就是第 3 行；↑↓ 切到第二条回车打开根目录笔记，活动行为第 4 行；命令面板搜「工作区中搜索」回车后切到搜索标签并聚焦输入框。隐藏目录 / 非 Markdown / `.git` 由单测覆盖。测试后已删除测试笔记并切回文件标签。

**遗留 / 下一轮建议**：结果不随文件保存实时刷新（重新输入或切回标签即可）；未做跳行后高亮关键词（只定位行首）。下一轮可做「文档历史与本地快照」或「多标签与分屏编辑」。

---

## 第 181 轮 · 2026-10-30 18:47
**用户需求**：写东西时手不离键盘，想切视图、导出 HTML、进专注模式，要么去点工具栏，要么临时翻快捷键表 → 希望有一个输入框，打几个字就能搜索并执行这些动作。

**产品经理**：做。README「后续」里的命令面板；只把已有动作汇总成一个入口，不新增能力、不改数据，符合「快、安静」；菜单文字带键位，顺便让快捷键被发现。

**前端**：新增 `features/commands/CommandPalette.tsx`（± 420 行含样式）：输入过滤标题 / 提示 / 关键词，↑↓ 选择、回车执行、Esc 关闭并归还焦点；动作直接调用工具栏与快捷键用的同一批函数（保存、另存为、复制 / 导出 HTML、四种视图、专注、侧栏、字号、返回 / 前进等），按当前文档 / 工作区 / 历史栈过滤不可用项。`ui` store 增加 `paletteOpen`；`App` 处理 `Ctrl+Shift+P` 并把面板计入 `dialogOpen`，避免面板打开时全局快捷键漏到后台。设置快捷键表补一行。风险：`CommandPalette` 引用 `app/Toolbar` 的导出，需保持无循环依赖（Toolbar 不依赖 App）；面板动作大多复用现有提示与守卫。工作量 M。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/commands/CommandPalette.tsx`、`commands.css`、`src/stores/ui.ts`、`src/app/App.tsx`、`src/features/settings/SettingsDialog.tsx`；README 后续移除命令面板并补功能说明。

**构建**：通过（`bun run build` 927ms，含 tsc）。

**验证**：CDP（9222，真实按键事件）：Ctrl+Shift+P 打开面板，输入框自动聚焦，列出 18 条可用命令；输入「导出」只剩「导出 HTML…」；输入「视图：预览」回车后视图切到预览、面板关闭、焦点回正文；面板打开时按 Ctrl+B 侧栏不变（全局快捷键被拦住）；再次打开后 Esc 关闭、焦点回 `.cm-content`。测试后已切回源码视图。

**遗留 / 下一轮建议**：命令列表里「复制 HTML」因提示含「预览」会跟「预览」查询同时命中，属可接受的模糊匹配；面板暂无自定义命令 / 最近使用排序。下一轮可做「文档历史与本地快照」或「工作区全文搜索」。

---


## 第 180 轮 · 2026-10-30 18:34
**用户需求**：靛青用了很久，想给不同用途的库换个感觉（工作用赭石、读书用松绿），又不想每次手动改 CSS → 希望设置里能直接挑点缀色，亮暗主题各自协调，重启后保持。

**产品经理**：做。README「计划中」最后一项；只换强调色、不动背景与正文，符合「墨线」气质也守住「安静」；自包含在偏好设置里，不扩大产品边界。

**前端**：`lib/theme.ts` 新增 `AccentPreset`（indigo / umber / pine）与 `applyAccent`，写 `data-accent` 并缓存到 localStorage；`stores/settings.ts` 增加 `accent` 偏好（默认靛青、载入校验、变更即应用、恢复默认一并重置）；`SettingsDialog` 外观页新增「点缀色」分段控件；`global.css` 为赭石 / 松绿各写亮暗两套变量（含选中态、当前行、`--on-accent`）；`index.html` 首屏脚本套用缓存色。风险：只覆盖 `--accent` 系列变量，未改的组件继续用别名；暗色下每个预设单独定义，避免与 `data-theme` 规则互相覆盖。工作量 S（5 个文件）。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/lib/theme.ts`、`src/stores/settings.ts`、`src/features/settings/SettingsDialog.tsx`、`src/styles/global.css`、`index.html`；README 计划中清空。

**构建**：通过（`bun run build` 872ms，含 tsc）。

**验证**：CDP（9222）设置 → 外观排版：初始 `--accent` 为 `#2f5561`；点「赭石」后 `data-accent=umber`、暗色 `--accent=#d8a26b`、切浅色 `#8a4f26`；点「松绿」后浅色 `#2f6144`、暗色 `#8fc7a4`；整页刷新后仍是松绿（首屏脚本与设置载入都生效）。测试后已还原「靛青 + 跟随系统」。人工复现：设置 → 外观排版 → 点缀色切换，按钮 / 链接 / 选中态应即时变色，重启后保留。

**遗留 / 下一轮建议**：点缀色只影响界面强调色，Shiki 代码配色与 Mermaid 主题仍按亮暗走默认；「计划中」已清空，下一轮进入「后续」第一项「命令面板」。

---


## 第 179 轮 · 2026-10-30 18:25（检验轮）
**类型**：检验轮，不实现新功能；系统性回归第 173–178 轮。

**回归范围**：173 最近打开清空 + 撤销落盘；174 纯预览按篇记住阅读位置、源码 / 分栏按光标；175 预览选区显示「选中 N 字」、清空消失；176 纯预览不显示旧「行:列」；177 Mermaid 渲染 / 失败保留源码 / 主题重画 / 普通代码块不受影响 / 无图表不加载库；178 目录监听外部增删改刷新与当前文档提示、自身保存不误报。

**构建**：通过（`bun run build` 1.14s，含 tsc）；`cargo test` 34 passed。

**CDP 实测**（9222，工作区 `D:\clawWorkSpeace\新建文件夹`）：
- 173：最近打开 5 篇点「清空」→ 列表即时消失并提示「已清空最近打开（5 篇） · 点击撤销」；点提示后按原顺序恢复（SelfSave.md、WatchDoc.md、覆盖测试.md、MermaidTest.md、ErrorMermaid.md）并提示「已恢复最近打开」，`settings.json` 的 `recentDocuments` 同步为同一顺序。符合预期。
- 174：长文档切「预览」滚到 1500 → 打开 final.md 再返回，滚回 1500；切「源码」后 Ctrl+End 再切「预览」落到文末（7489/7539），不沿用旧位置；「分栏」下 Ctrl+Home 后编辑区与预览一起回到顶部（38/38）。符合预期。
- 175/176：预览选中一段显示「选中 27 字」，清空选区后消失；纯预览状态栏无「行:列」，切回「源码」恢复「1:1」。符合预期。
- 177：`MermaidTest179.md` 的 ```mermaid 生成 1 个含 SVG 的图，普通 js 代码块保留且复制按钮 1 个；此时才加载 `node_modules/.vite/deps/mermaid.js`；切深色后 SVG 文本 `#333 → #ccc`，切回浅色恢复；非法图表保留源码并显示 Parse error。符合预期。
- 178：应用外新建 / 删除文件，不聚焦窗口约 1 秒内文件树同步；外部追加当前文档后弹「文件已被其他程序修改」，点「重新加载」出现新行；外部删除当前文档弹「文件已不在磁盘上」且树中移除；应用内新建并输入等待自动保存，状态「已保存」、无冲突提示，磁盘内容正确。符合预期。
- 测试产生的 `MermaidTest179.md`、`ErrorMermaid179.md`、`SelfSave179.md`、`未命名.md` 及最近打开中的对应条目已清理，主题已还原为浅色。

**结论**：六项均符合预期，无需修复；检验计数清零。

**下一轮建议**：进入路线图「计划中」最后一项「更多主题预设」——在现有浅色 / 深色之外增加 2–3 套可切换配色。

---


## 第 178 轮 · 2026-10-30 18:20
**用户需求**：把笔记库放在同步盘 / 手机上编辑，回到电脑前用应用打开：外面新建或改过的笔记，窗口不聚焦就看不到；正在写的这篇在外面被改过，只有切走再切回才提示 → 希望目录变化实时出现在文件树里，当前笔记被外部修改或删除时立刻提示。

**产品经理**：做。README「计划中」第二项；外部修改检测已有 mtime 语义与提示文案，缺的只是「主动发现」的触发源。只监听当前工作区、只读不写，符合「本地优先、数据安全」。

**前端**：`App.tsx` 在原有「重新聚焦时检查」的 effect 里接入 `listen("workspace-changed")`，事件去抖 350ms 后统一 `refreshTree()` + 外部修改检查；工作区根变化时重新挂监听、关闭时解除。`lib/tauri.ts` 增加 `watchWorkspace` / `unwatchWorkspace` 包装。风险：应用自身保存也会触发事件，但 `checkExternalChange` 在 dirty / saving 时早退、mtime 相同时直接返回；监听失败时回落到原有的聚焦刷新。工作量 M。

**后端**：`src-tauri/src/watcher.rs` 实现 `watch_workspace` / `unwatch_workspace`：`notify` 递归监听工作区，事件带 kind 与路径以 `workspace-changed` 发给前端；监听器放在受管 `WatchState` 里，切换工作区替换旧的、关闭时释放；路径必须是已存在的目录。新增依赖 `notify = "8"`（8.2.1）。工作量 S。

**裁决**：做

**改动**：`src-tauri/src/watcher.rs`（约 65 行）、`src-tauri/src/lib.rs`、`src-tauri/Cargo.toml`、`src/app/App.tsx`、`src/lib/tauri.ts`；README 计划中移除目录监听并补充说明。

**构建**：通过（`bun run build` 890ms，含 tsc；`cargo check` 10.34s）；`cargo test` 34 passed。

**验证**：重启 `bun run tauri dev` 后 CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`）：①在应用外新建 `WatchDoc.md`，不聚焦窗口，文件树 1 秒内自动出现；②打开它后在外部追加一行，约 2 秒弹出「文件已被其他程序修改」，点「重新加载」后编辑器出现新行；③外部删除该文件，弹出「文件已不在磁盘上」（另存为… / 保留），文件树同步移除该行；④新建 `SelfSave.md` 在应用内输入并等自动保存，状态变「已保存」且没有误报冲突。测试文件已删除。

**遗留 / 下一轮建议**：检验计数已满 5，第 179 轮按规则做检验轮（回归第 173–178 轮）；目录监听在大库（数万文件）下的资源占用尚未压测，可作为后续观察项。

---


## 第 177 轮 · 2026-10-30 18:15
**用户需求**：写架构笔记时用 ```mermaid 画流程，预览里只看到一段代码 → 希望预览直接画成图；图写错时别整块消失，要能看出错在哪；切换深色主题时图也要跟着换配色。

**产品经理**：做。README 技术栈早就承诺 Mermaid（严格模式），是「计划中」的第一项；只在文档真出现图表时才加载，不拖慢普通笔记。

**前端**：预览 Worker 解析 mdast 时收集 ```mermaid 源码随 HTML 一并返回（`preview-protocol` / `markdown.worker` / `preview-controller`）；`PreviewPane` 在每次 HTML 上屏后按源码匹配代码块，懒加载 `mermaid`（12.2.0，动态 import）渲染成 SVG，替换代码块并保留 `data-source`；主题切换时按源码重画。渲染失败保留源码并显示 Mermaid 的解析错误；先打 `data-mermaid` 标记，避免补「复制代码」按钮。风险：图表源码与普通代码块内容完全相同时会被当成图表（罕见）；「复制 / 导出 HTML」仍是代码块形态，图表 SVG 内联留作后续。工作量 M。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/preview/mermaid.ts`（新增，约 90 行）、`PreviewPane.tsx`、`markdown.worker.ts`、`preview-controller.ts`、`preview-protocol.ts`、`preview.css`（6 个文件）；`package.json` / `bun.lock` 新增 `mermaid@12.2.0`（README 技术栈承诺，经用户要求补齐）；README 计划中移除 Mermaid。

**构建**：通过（`bun run build` 986ms，含 tsc；Mermaid 按需拆成独立 chunk）。

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`）建临时 `MermaidTest.md`（流程图 + 时序图 + 普通 js 代码块），整页刷新后打开：2 个 `.mermaid-figure` 均生成 SVG、普通代码块仍有复制按钮、无残留源码块；`ErrorMermaid.md`（非法语法）显示「图表渲染失败：Parse error…」并保留源码；设置里切「深色」后 SVG 样式从 `fill:#333` 变 `#ccc`（重画成功），切回浅色恢复。测试笔记与截图已删除。

**遗留 / 下一轮建议**：「复制 / 导出 HTML」里的 mermaid 仍是代码块，若要图表随 HTML 导出需在主线程渲染后替换（M）；检验计数已满 5，下一轮按规则为检验轮，回归第 173–177 轮。

---


## 第 176 轮 · 2026-10-30 17:51
**用户需求**：切到纯「预览」读一篇长文，状态栏左边还挂着「102:38」这样的光标行列 → 预览里根本没有编辑器，这个数字是切走前留下的旧位置，读长文时容易被误当成「读到第几行」→ 纯预览时不要显示光标行列，切回源码 / 分栏再出现。

**产品经理**：做。这是第 175 轮预览选区计数的同一条「预览状态栏」收尾：预览模式下编辑器不可见，行列信息已失去意义；只少显示一项旧状态，不新增入口、不读写文件、不改变编辑与阅读行为，符合「安静」，不扩大产品边界。

**前端**：影响 `src/app/StatusBar.tsx`。`viewMode === "preview"` 时不渲染 `行:列`；源码 / 所见即所得 / 分栏仍照常显示（分栏里编辑器可见）。风险极低，仅影响状态栏 DOM 的一项显示。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/StatusBar.tsx`（约 +6/−1 行，1 个文件）

**构建**：通过（`bun run build` 561ms，含 tsc）；未改后端，未跑 `cargo test`。

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`，`写作示例.md`）。预览 → 状态栏为「500 字 · UTF-8 · 已保存」，无行列；点「源码」→ 出现「102:38」；点「分栏」→ 仍显示「102:38」；再点「预览」→ 行列消失，字数不变。人工复现：打开一篇笔记切到预览，状态栏左侧不应再有 `行:列`；切到源码或分栏应恢复；纯预览读长文时看到的只有字数等阅读信息。

**遗留 / 下一轮建议**：预览选区字数随 `selectionchange` 实时计算，超长全选时计算量略大，暂不节流。「导出后浏览器打开」需改 capabilities，只记录；目录监听 / Mermaid / 全文搜索 / 多标签、切换文档丢撤销历史仍在候选。本轮后检验计数为 4，再一条需求即进入检验轮。

## 第 175 轮 · 2026-10-30 17:47
**用户需求**：在纯预览里读到一段想引用的话，用鼠标选中后想知道这段有多少字 → 状态栏只显示整篇字数，`选中 N 字` 只有在编辑区选字时才出现；而且从编辑区带着选区切到预览，状态栏还挂着旧选区的字数 → 希望在预览里选中正文时状态栏也报出选中字数，切视图后不残留旧数字。

**产品经理**：做。选中字数早已是状态栏的能力，只是在预览模式下断档；补上同一套计数不新增入口、不读写文件、不改变阅读与编辑行为，符合「安静、数据安全」，不扩大产品边界。

**前端**：影响 `src/app/StatusBar.tsx`。监听 `selectionchange`，仅当视图为预览 / 分栏且选区落在 `.preview-pane .markdown-body` 内时用 `countTextStats` 统计选中字数；纯预览时以预览选区为准，不再沿用编辑器里切走前的旧选区；源码 / 所见即所得仍走原来的编辑器 `selectedWords`。切换视图或文档时重新同步，选区清空即隐藏。风险：只影响状态栏「选中 N 字」的取值来源，复制、字数总计与保存状态不变。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/StatusBar.tsx`（约 +44/−2 行，1 个文件）

**构建**：通过（`bun run build` 532ms，含 tsc）；未改后端，未跑 `cargo test`。

**验证**：CDP（9222，整页刷新，工作区 `D:\clawWorkSpeace\新建文件夹`，`写作示例.md`）。切到「预览」，用 Range 选中正文一段（「这一篇把常用的 Markdown 写法…」）→ 状态栏出现「选中 26 字」，整篇字数「500 字」不变；清空选区 → 「选中 26 字」立即消失；切到「源码」→ 预览选区不再计入，状态栏只保留整篇字数。人工复现：预览里用鼠标选中一段文字，状态栏应显示「选中 N 字」；点空白清掉选区后该数字消失；切回源码时不应残留预览里的选中字数。

**遗留 / 下一轮建议**：预览选区计数随 `selectionchange` 实时计算，超长整篇全选时会略有多余计算，暂不需要节流；预览里没有选区时仍显示编辑器光标行列（纯阅读时意义有限）。目录监听 / Mermaid / 全文搜索 / 多标签、切换文档丢撤销历史、「导出后浏览器打开」（需改 capabilities）仍在候选。本轮后检验计数为 3，下一轮（第 176 轮）继续常规需求。

## 第 174 轮 · 2026-10-30 17:40
**用户需求**：在预览里把一篇长笔记读到中间，点开另一篇参考笔记查资料，再点「返回」回来 → 预览直接跳回开头或光标所在标题，刚才读到的位置没了，长文里只能重新往下滚很久 → 希望切走再切回来时，接着上次读到的地方看。

**产品经理**：做。这是纯预览阅读链路里最常被长文用户碰到的一处断点；只在会话内记住每篇笔记的滚动位置，不写设置、不碰文件、不改变编辑视图行为，符合「安静、快、数据安全」，不扩大产品边界。跨会话不保留，避免把上一次启动的阅读位置强加给用户。

**前端**：影响 `src/features/preview/PreviewPane.tsx`。预览滚动时把当前笔记的 `scrollTop` 记进会话级 Map（上限 100 条，按最近使用淘汰）；预览 Worker 返回 HTML 时附带它所属的文档路径，等新内容真正上屏后再恢复位置，避免拿旧 HTML 去滚。切到源码 / 分栏时清掉该笔记的阅读位置，回到编辑仍以光标为准；没有记录的笔记沿用原「停在光标所在标题」逻辑。风险：只影响纯预览模式的滚动定位，分栏同步、大纲高亮、任务勾选与放大浮层不变。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/preview/PreviewPane.tsx`（约 +64/−6 行，1 个文件）

**构建**：通过（`bun run build` 547ms，含 tsc）；未改后端，未跑 `cargo test`。

**验证**：CDP（9222，整页刷新，工作区 `D:\clawWorkSpeace\新建文件夹`，预览模式）。打开 `长文档.md` 滚到 `scrollTop=800`（`scrollHeight=8164`），点文件树打开 `写作示例.md`，再点工具栏「返回」→ 回到 `长文档.md` 时 `scrollTop` 恢复为 800，图片与标题均正常。再切到「源码」再切回「预览」→ 阅读位置被清掉、落回光标所在标题（`scrollTop=30`），不会把旧阅读位置带到编辑后的视图。测试后点回 `写作示例.md`，应用停在预览模式，工作树仅本轮 1 个源码文件。人工复现：预览中打开一篇长文滚到中段 → 打开另一篇 → 用工具栏「返回」或 Alt+← 回来，应停在刚才的位置；切换视图后回来则按光标定位。

**遗留 / 下一轮建议**：阅读位置只在本次会话内保留，重启后回到光标/开头；位置按滚动像素记录，预览内容在外部被大幅改动后可能略有偏差。目录监听 / Mermaid / 全文搜索 / 多标签、切换文档丢撤销历史、「导出后浏览器打开」（需改 capabilities）仍在候选。本轮后检验计数为 2，下一轮（第 175 轮）继续常规需求。

## 第 173 轮 · 2026-10-30 17:44
**用户需求**：在空笔记页整理「最近打开」时手滑点了「清空」，五条记录瞬间消失，没有任何提示或补救，只能靠记忆重新翻目录 → 希望清空后能像移除工作区那样，点提示一下就能恢复刚才的列表。

**产品经理**：做。第 169 轮为「最近工作区移除」做了可点击撤销，这次是同一类误触防护；只改单库内的「最近打开」列表与设置，不动磁盘文件、不切换文档，符合「安静、数据安全」，不扩大产品边界。

**前端**：影响 `src/stores/workspace.ts`、`src/app/App.tsx`。`clearRecent()` 返回清空前的列表；新增 `restoreRecent(paths)` 把列表放回并落盘（仍受 5 条上限约束）；清空后提示「已清空最近打开（N 篇） · 点击撤销」，点击恢复并提示「已恢复最近打开」。撤销时若已切到别的库则放弃恢复，避免把旧路径写进新库。风险：只影响「最近打开」清空入口，打开文档、最近列表排序与打开行为不变。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/stores/workspace.ts`（约 +14/−4 行）、`src/app/App.tsx`（约 +16/−3 行，2 个文件）

**构建**：通过（`bun run build` 598ms，含 tsc）；未改后端，未跑 `cargo test`。

**验证**：CDP（9222，整页刷新 + Vite 模块热取，工作区 `D:\clawWorkSpeace\新建文件夹`）。清空当前文档进入空状态 → 「最近打开」列出 5 篇，点「清空」→ 列表立即清空、提示「已清空最近打开（5 篇） · 点击撤销」、悬停说明「点击撤销清空」；点提示 → 5 篇按原顺序恢复、提示「已恢复最近打开」，`settings.json` 的 `recentDocuments` 同步恢复为原数组。测试后设置已从备份逐键还原（`lastDocumentByWorkspace` 回到 `写作示例.md`），整页刷新回到 `写作示例.md`，工作树仅本轮 2 个源码文件。人工复现：空状态点「最近打开」右侧「清空」→ 点底部提示，列表应恢复；提示几秒后自动消失，需在消失前点。

**遗留 / 下一轮建议**：撤销只在提示停留期间有效，过期后仍需重新打开文件才会回到列表；清空空列表时不会弹提示（按钮本身仅在有记录时出现）。目录监听 / Mermaid / 全文搜索 / 多标签、切换文档丢撤销历史、「导出后浏览器打开」（需改 capabilities）仍在候选。本轮后检验计数为 1，下一轮（第 174 轮）继续常规需求。

## 第 172 轮 · 2026-10-30 17:36（检验轮）
**用户需求**：不新增功能；系统性回归第 167–171 轮（图片放大拖动钳制、双击复位、最近工作区移除撤销、同名库上级目录、小图放大提示收敛）。

**产品经理**：检验轮按 `.claude/loop.md` 第 6 节执行，只回归与修复，不扩边界。

**前端**：回归 `src/features/preview/PreviewPane.tsx`、`src/app/TitleBar.tsx`、`src/components/Menu.tsx`、`src/components/Toast.tsx`、`src/stores/ui.ts`、`src/app/App.css`。未发现需要修复的问题。

**后端**：无改动；未涉及后端命令。

**裁决**：检验完成，无需修复

**改动**：无源码改动

**构建**：通过（`bun run build` 575ms，含 tsc）；未改后端，未跑 `cargo test`。

**回归结果（CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`，`写作示例.md` 预览）**：
1. 第 167 轮 拖动钳制 / 小图居中：800×450 大图放大 175% 拖动 (+100,+100) → `translate(100px, 45.75px) scale(1.75)`，纵向按可视余量钳在 45.75；猛拖到 (2600,2400) → 钳在 `translate(182px, 45.75px)`，浮层未关；小图放大后 transform 恒为 `translate(0px,0px)`。通过。
2. 第 168 轮 双击复位 / 单击关闭：放大态双击 → 回到 `scale(1)`、居中、`1 / 4` 提示恢复、浮层未关；100% 单击后约 250ms 内关闭。提示在放大态含「双击复位」。通过。
3. 第 169 轮 移除撤销：最近工作区移除一条 → 菜单保持展开、其余项即时更新、设置里路径被删、提示「已从最近工作区移除：同名库 · 点击撤销」（`title` 为「点击撤销移除」）；点提示 → 设置恢复该路径并排到最前、提示「已恢复最近工作区：同名库」、菜单可再列出该项。通过。
4. 第 170 轮 同名库分辨：种子 `D:/a/同名库`、`D:/b/同名库` → 菜单显示「切换到 同名库（a）」「切换到 同名库（b）」，`title` 为各自完整路径；不同名时保持原名；超长名 `clientWidth 148 < scrollWidth 248` 且 `text-overflow: ellipsis` 生效。通过。
5. 第 171 轮 小图提示收敛：64×64 小图放大 175% → 提示「双击复位 · 滚轮缩放 · Esc 关闭」、`img.className` 为空、光标 `zoom-out`；拖动 (+150,+100) → transform 不变、浮层未关；翻页到下一张后 pan 归零。大图放大仍显示「拖动平移 · 双击复位…」、`is-zoomed`、光标 `grab`。通过。

**测试后清理**：临时种入的 `recentWorkspaces` 已还原为原值（`D:\clawWorkSpeace\新建文件夹`），settings.json 与测试前逐键比对无差异；浮层已 Esc 关闭，应用停在 `写作示例.md` 预览；工作树干净。

**人工复现**：预览放大一张大图，拖动应能平移且边缘贴边停住，双击回 100%；放大一张小图，不应出现「拖动平移」与抓手光标，拖动不移位也不关闭；最近工作区移除一条后点提示应能撤销并恢复设置；同名库应带上级目录后缀、悬停见完整路径。

**遗留 / 下一轮建议**：本轮无需修复；检验计数清零。候选仍为「导出后浏览器打开」（需改 capabilities）、目录监听 / Mermaid / 全文搜索 / 多标签、切换文档丢撤销历史。

## 第 171 轮 · 2026-10-30 17:21
**用户需求**：预览里点开放大一张 64×64 的小图，滚轮到 200% 后底部仍写着「拖动平移」，我抓着图拖却一动不动；换大图才拖得动，看起来像坏了 → 小图放大后既然没有可拖的余量，就别提示拖动、也别显示抓手光标。

**产品经理**：做。第 167 轮给小图锁定居中后，提示与光标没有同步收敛，属于同一功能的收尾；只改浮层内判断与文案，不扩展交互、不读写文件，符合「安静、快、数据安全」，不扩大产品边界。

**前端**：影响 `src/features/preview/PreviewPane.tsx`。把「最多可拖多少」抽成 `panLimits()`，`clampPan` 与新的 `canPan` 共用；用 `ResizeObserver` 监听图片与浮层尺寸，图片加载完成或窗口缩放后重新判断放大图是否真的超出可视区。`canPan` 为真才给 `is-zoomed` 抓手光标、才在拖动时平移；放大不足一屏时提示降为「双击复位 · 滚轮缩放 · Esc 关闭」。拖动仍会标记「移动过」，松手不会误关浮层；100% 单击关闭、双击复位、大图边界钳制均不变。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/preview/PreviewPane.tsx`（约 +41/−10 行，1 个文件）

**构建**：通过（`bun run build` 563ms，含 tsc）；未改后端，未跑 `cargo test`。

**验证**：CDP（9222，整页刷新，工作区 `D:\clawWorkSpeace\新建文件夹`，`写作示例.md` 预览）。点开 64×64 小图 → 100% 提示「滚轮缩放 · Esc 关闭」；滚轮放大到 200% → 底部 `2 / 4 · 200%`，提示「双击复位 · 滚轮缩放 · Esc 关闭」，`img.className` 为空、光标 `zoom-out`；按住拖 (+100,+100) → `transform` 仍为 `translate(0px,0px) scale(2)`，浮层保持打开（拖动不当点击）。Esc 后点开 800×450 大图，放大到 200% → 提示「拖动平移 · 双击复位 · 滚轮缩放 · Esc 关闭」、`is-zoomed`、光标 `grab`；拖 (+100,+100) → `translate(100px,100px) scale(2)`；再猛拖到 (2600,2400) → 钳制在 `translate(282px,102px)`（与大图边缘贴边值一致）；双击 → 回 100% 居中、提示恢复。测试后 Esc 关闭浮层，应用停在 `写作示例.md`（预览视图）。人工复现：预览放大一张小图，底部不应再出现「拖动平移」、光标应是缩小图标，拖动不移位也不关闭；放大普通大图仍可拖动、能贴边停住。

**遗留 / 下一轮建议**：小图放大后仍锁定居中，不提供自由摆放（无必要，保持安静）；`ResizeObserver` 不可用时退化为打开 / 缩放时判断一次。本轮后检验计数为 5，下一轮（第 172 轮）为检验轮，回归第 167–171 轮（图片拖动钳制、双击复位、移除撤销、同名最近工作区、小图提示收敛）。「导出后浏览器打开」（需改 capabilities）、目录监听 / Mermaid / 全文搜索 / 多标签 / 切换文档丢撤销历史仍在候选。

## 第 170 轮 · 2026-10-30 17:16
**用户需求**：我在两个项目里各有一个叫 `笔记` 的文件夹，都作为工作区用过；打开「最近工作区」只看到两行「切换到 笔记」，分不清哪个是哪个，只能凭运气点或去文件夹里重新打开 → 同名时希望能标出上一级目录，悬停能看到完整路径。

**产品经理**：做。第 32 轮已为「最近打开」的同名笔记显示所在目录，这是一个已验证的模式；本轮只改最近工作区菜单的展示与悬停提示，不切换工作区、不读写文件，符合「安静、数据安全」，不扩大产品边界。

**前端**：影响 `src/app/TitleBar.tsx`、`src/components/Menu.tsx`、`src/app/App.css`。仅在最近列表出现同名文件夹时为 label 补「（上一级目录）」，不重名时保持原样；`MenuAction` 新增可选 `title` 渲染为悬停完整路径；菜单项补省略号，长路径不再溢出菜单。风险：只影响右键 / 最近工作区菜单的展示，菜单键盘操作、移除按钮行为不变。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/TitleBar.tsx`（约 +23/−7 行）、`src/components/Menu.tsx`（约 +3 行）、`src/app/App.css`（约 +3 行，3 个文件）

**构建**：通过（`bun run build` 557ms，含 tsc）；未改后端，未跑 `cargo test`。

**验证**：CDP（9222，整页刷新，工作区 `D:\clawWorkSpeace\新建文件夹`）。种子 `D:/a/同名库` 与 `D:/b/同名库` 后打开「最近工作区」→ 两行分别为「切换到 同名库（a）」「切换到 同名库（b）」，悬停 `title` 为各自完整路径；只种子一个 `D:/某处一个名字特别长的笔记库目录` → label 保持「切换到 …」不加后缀、`title` 为完整路径，`clientWidth 148 < scrollWidth 248` 且 `text-overflow: ellipsis` 生效不溢出；点空白关闭菜单后设置已还原为 `[新建文件夹]`。测试后临时记录已清理，应用仍在 `新建文件夹`。人工复现：准备两个同名但位置不同的工作区并都用一次 → 标题栏「最近工作区」应显示「切换到 名字（上级目录）」，悬停显示完整路径；只有一个或名字不重名时保持原样。

**遗留 / 下一轮建议**：同名判断按列表内重名，两个库若名称和上级目录都相同（不同盘符的深层同名链）仍可能分不清，但悬停有完整路径兜底。放大浮层小图不足一屏时的可移动性、目录监听 / Mermaid / 全文搜索 / 多标签 / 切换文档丢撤销历史仍在候选。本轮后检验计数为 4，下一轮（第 171 轮）继续常规需求。


## 第 169 轮 · 2026-10-30 17:18
**用户需求**：整理最近工作区时手滑点了某项右边的 ×，本想删下面一项，结果这一项立刻从列表消失，没有任何补救，只能重新去文件夹打开一次 → 希望移除后的提示里能点一下撤销，把刚移掉的库放回去。

**产品经理**：做。第 164 轮的逐项 × 解决了「还在但不想留」，但误触后没有退路；复用已有提示动作（第 159 轮）做撤销，只改设置里的路径列表、不切换工作区、不碰文件，符合「安静、数据安全」，不扩大产品边界。

**前端**：影响 `src/stores/ui.ts`、`src/components/Toast.tsx`、`src/app/TitleBar.tsx`。提示条目新增可选 `actionTitle`，带动作的提示可按场景给出悬停说明（默认仍是「在资源管理器中显示」）；标题栏移除记录后的提示改为「已从最近工作区移除：X · 点击撤销」，点击调用 `rememberWorkspace(path)` 放回列表并提示「已恢复最近工作区：X」。风险：仅影响带动作的提示文案与最近工作区菜单，导出成功提示行为不变；撤销窗口等于提示停留时长（约数秒）。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/stores/ui.ts`（约 +12/−4 行）、`src/components/Toast.tsx`（约 +4/−1 行）、`src/app/TitleBar.tsx`（约 +17/−3 行，3 个文件）

**构建**：通过（`bun run build` 548ms，含 tsc）；未改后端，未跑 `cargo test`。

**验证**：CDP（9222，整页刷新，工作区 `D:\clawWorkSpeace\新建文件夹`）。把临时库 `撤销169A` / `撤销169B` 种子进 recentWorkspaces 后打开「最近工作区」→ 两项；点 169A 行 × → 菜单保持展开、仅剩 169B，提示「已从最近工作区移除：撤销169A · 点击撤销」、悬停说明「点击撤销移除」，设置同步只剩 169B；点提示 → 提示变为「已恢复最近工作区：撤销169A」、设置恢复为 `[169A, 169B]`，重开菜单两项都在。再只种子 169A：移除后菜单自动收起，点提示撤销后设置恢复、重开菜单又有 169A。测试后删除两个临时目录，recentWorkspaces 还原为 `[新建文件夹]`，应用回到 `新建文件夹 / 写作示例.md`。人工复现：标题栏「最近工作区」→ 点某项右侧 × → 点底部提示，该项应回到列表并提示「已恢复」；提示几秒后自动消失，需在消失前点。

**遗留 / 下一轮建议**：撤销只在提示停留期间有效，过期后仍需重新打开文件夹；撤销会把库放回列表最前（按最近使用排序），不保留原位置。放大浮层小图不足一屏时的可移动性、目录监听 / Mermaid / 全文搜索 / 多标签 / 切换文档丢撤销历史仍在候选。本轮后检验计数为 3，下一轮（第 170 轮）继续常规需求。

## 第 168 轮 · 2026-10-30 17:08
**用户需求**：放大图片看完细节后，想回到整张图的样子，只能一路滚轮往下转回 100% → 希望放大状态下双击图片就直接回到 100% 居中，而且双击不会把浮层关掉。

**产品经理**：做。第 39 / 93 / 125 / 129 / 130 / 165 / 167 轮的图片浮层已有滚轮缩放、拖动平移和边界钳制，唯独缺一个「一键复位」；双击是图片查看器的通用手势。只改浮层内交互，不新增依赖、不读写文件，符合「安静、快、数据安全」，不扩大产品边界。

**前端**：影响 `src/features/preview/PreviewPane.tsx`。图片 `onDoubleClick` 里清掉待触发的关闭定时器并把 `zoom` / `pan` 归零；放大时单击关闭改为延迟 250ms 执行，给双击复位留出判定时间，浮层关闭时清理定时器；放大态操作提示补「双击复位」。风险：只在放大态延迟关闭，100% 时单击仍是立即关闭；拖动判定、翻页、边界钳制不变。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/preview/PreviewPane.tsx`（约 +32/−3 行，1 个文件）

**构建**：通过（`bun run build` 529ms，含 tsc）；未改后端，未跑 `cargo test`。

**验证**：CDP（9222，整页刷新，工作区 `D:\clawWorkSpeace\新建文件夹`，`写作示例.md`）。切预览、滚动到首图并点开 → 浮层 `1 / 4`、`translate(0px, 0px) scale(1)`、提示「滚轮缩放 · Esc 关闭」；滚轮放大到 150% → 提示变为「拖动平移 · 双击复位 · 滚轮缩放 · Esc 关闭」；标准双击序列（clickCount 1 后 clickCount 2）后等待 500ms → 浮层仍打开、`scale(1)`、`is-zoomed` 移除、提示回到 100% 文案；再次放大到 125% 后单击 → 150ms 时浮层仍打开，450ms 时关闭，单击关闭语义保留；测试后切回源码视图、浮层已关。人工复现：预览点开图片 → 滚轮放大 → 双击图片，应直接回到 100% 居中且浮层不关；放大后单击一次，约 0.25 秒后浮层关闭。

**遗留 / 下一轮建议**：双击复位与单击关闭共用鼠标手势，放大态关闭有 250ms 延迟；小图放大不足一屏时仍锁定居中。「导出后浏览器打开」（需改 capabilities）、目录监听 / Mermaid / 全文搜索 / 多标签 / 切换文档丢撤销历史仍在候选。本轮后检验计数为 2，下一轮（第 169 轮）继续常规需求。

## 第 167 轮 · 2026-10-30 17:06
**用户需求**：看长截图时放大到 200%，按住拖动想看右下角的字，结果一拖就直接甩出屏幕外，整张图不见了，只能松开再滚轮缩回 100% 重找 → 希望放大后拖动时图片不要被拖出可视区域，看到边角就停住。

**产品经理**：做。第 165 轮的拖动平移是图片放大的自然延伸，但没有边界约束：图片可以被拖到完全不可见，属于同一功能的明显粗糙处。只改前端浮层内的偏移计算，不新增依赖、不读写文件，符合「安静、快、数据安全」，不扩大产品边界。

**前端**：影响 `src/features/preview/PreviewPane.tsx`。放大后拖动时按图片显示尺寸与浮层可视区计算最大偏移，图片边缘最多贴住可视区边缘；某个方向放大后仍小于可视区时该方向锁定居中。滚轮缩小后重新钳制偏移，缩回 100% 仍归零。风险：只作用于图片浮层，预览正文、翻页、缩放行为不变；`offsetWidth` 不受 transform 影响，尺寸稳定。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/preview/PreviewPane.tsx`（约 +30/−2 行，1 个文件）

**构建**：通过（`bun run build` 557ms，含 tsc）；未改后端，未跑 `cargo test`。

**验证**：CDP（9222，整页刷新，工作区 `D:\clawWorkSpeace\新建文件夹`）。打开 `写作示例.md` 切到预览，点开首张图（800×450，可视区 1036×696），滚轮放大到 200% → 浮层 `matrix(2,0,0,2,0,0)`；向右下猛拖 +1000,+1000 → 停在 `translate(282px, 102px)`，图片左上角恰好在 32px 内边距处（`rect.x=32, rect.y=32`），整图仍在可视区内；再向左上猛拖 −2000,−2000 → 停在 `translate(-282px, -102px)`，右 / 下边缘恰好贴住可视区内边距；滚轮缩回 100% → `translate(0,0)`、`is-zoomed` 移除、提示恢复「滚轮缩放 · Esc 关闭」；对 64×64 小图放大到 200%（128px < 可视区）后同样拖动，偏移保持 `0,0`，该方向不会产生无意义平移。Esc 关闭浮层，视图已还原为源码。人工复现：预览点开一张大图 → 滚轮放大 → 向任意方向猛拖，图片应在边缘贴住屏幕时停住、不会被甩出可视区；缩回 100% 或翻页后仍应居中。

**遗留 / 下一轮建议**：拖动暂无惯性 / 双击复位；小图放大不足一屏时锁定居中，用户如想移动小图可考虑允许小幅自由拖（待评估）。「导出后浏览器打开」（需改 capabilities）、目录监听 / Mermaid / 全文搜索 / 多标签 / 切换文档丢撤销历史仍在候选。本轮后检验计数为 1，下一轮（第 168 轮）继续常规需求。


## 第 166 轮 · 2026-10-30 16:57（检验轮）
**用户需求**：无新需求。按第 6 节系统性回归第 161–165 轮：导出默认名跨会话避让、最近工作区下拉与切换、失效库摘除、单项移除、图片放大平移。

**产品经理**：检验轮只做回归与必要小修，不开新功能、不扩大产品边界。

**前端 / 后端**：回归范围涉及 `src/app/Toolbar.tsx`、`src/features/workspace/workspace-actions.ts`、`src/app/TitleBar.tsx`、`src/components/Menu.tsx`、`src/features/preview/PreviewPane.tsx` 与 `src-tauri` 的 `next_export_name`；未发现需要修改的回归问题，无代码改动。

**裁决**：检验（无改动）

**改动**：无（仅更新 `docs/loop/backlog.md`、`docs/loop/state.md`）

**构建**：通过（`bun run build` 532ms，含 tsc）；后端 `cargo test` **34 passed**。

**回归结果**（CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`）：
1. 第 161 轮（导出默认名）：工作区外部放入 `写作示例.html` 与 `写作示例-2.html` 后，点「导出 HTML…」对话框默认名直接为 `写作示例-3.html`；手填已存在的 `写作示例-2.html` 导出后顺延为 `写作示例-2-2.html`；原有两个旧文件内容保持 `OLD-HTML` / `OLD2` 未被覆盖；后端 `next_export_name` 对 `写作示例.html` 返回 `写作示例-3.html`、对全新名原样返回。
2. 第 162 轮（最近工作区）：种子 `[新建文件夹, 回归166B]` 后菜单只列「切换到 回归166B」（排除当前库）；点开切到 B 正常；在 B 打开 `其他B.md` 后切回 A 自动恢复 `写作示例.md`，再切回 B 自动恢复 `其他B.md`（每库上次文档）；把 B 编辑出未保存改动后从菜单切换，守卫自动保存后再切换，改动落盘未丢；`rememberWorkspace` 对 6 条输入截为最新 5 条。
3. 第 163 轮（失效库）：种子 `[新建文件夹, 不存在库166]`，点「不存在库166」提示「打开工作区失败：…（已从最近工作区移除）」，设置只剩 `[新建文件夹]`，当前工作区与文档不变；不存在的路径被摘除，取消 / 其他失败路径未改动。
4. 第 164 轮（单项移除）：种子 `[新建文件夹, 回归166B, 回归166C]`，点 B 行 × 后该行消失、菜单保持展开、提示「已从最近工作区移除：回归166B」、设置同步且不切换库；再点 C 行 × 删空后菜单自动收起，标题栏仍是 `新建文件夹 / 写作示例.md`。
5. 第 165 轮（图片平移）：预览点开第 2 张图 → 浮层 `translate(0px, 0px) scale(1)`；滚轮上滚 3 次 → `scale(1.75)`、`is-zoomed`、提示「拖动平移 · 滚轮可调回 100%」、计数 `2 / 4 · 175%`；真实鼠标拖动 (+120, +120) → `translate(120px, 120px) scale(1.75)` 且浮层保持展开；滚轮下滚 3 次 → 偏移归零、`is-zoomed` 移除；再放大到 150% 并拖动后按 → 翻到第 3 张，偏移清零为 `translate(0px, 0px) scale(1.5)`；Esc 正常关闭。

**修复**：无（5 项均符合预期）

**清理**：测试用 `写作示例*.html`、临时库 `回归166B` / `回归166C` 已删除；`recentWorkspaces` 还原为 `[新建文件夹]`，`lastDocumentByWorkspace` 仅保留当前库，测试编辑器改动已还原；应用停在 `新建文件夹 / 写作示例.md`、源码视图。

**人工复现步骤**：① 在工作区里用记事本放一个与笔记同名的 `.html` → 对同名笔记点「导出 HTML…」，对话框默认名应是 `名字-2.html`；手填另一个已存在的名字导出，落盘应自动顺延且旧文件不变。② 打开过两个库后点标题栏「最近工作区」→ 只应列出非当前库，点一项切换，切回后应各自恢复上次文档。③ 把最近列表里某个库文件夹删掉 → 点它，应提示失败并说明已从最近工作区移除，再开后菜单无此条。④ 菜单每项 × 应只移除该项、不切换、菜单不关，删空自动收起。⑤ 预览点开图片 → 滚轮放大 → 按住拖动应能平移且不误关，缩回 100% / 翻页后应居中。

**遗留 / 下一轮建议**：图片拖动仍不限制边界，图可能被拖出可视区（可按显示尺寸钳制）；最近工作区暂无「撤销移除」。目录监听、Mermaid、全文搜索、多标签、切换文档丢撤销历史仍在候选。本轮检验计数清零，下一轮（第 167 轮）回到常规需求。

## 第 165 轮 · 2026-10-30 16:57
**用户需求**：看长截图时滚轮把图放大，只能看到画面正中，边角的文字被裁在外面；想挪过去看，用鼠标拖动却没有反应，只能缩回 100% 重新找 → 希望放大后可以用鼠标拖动图片平移查看，缩回 100% 时自动回到居中。

**产品经理**：做。图片放大查看（第 39 / 93 / 125 / 129 / 130 轮）已支持滚轮缩放，但放大后无法平移，是同一功能的明显粗糙处。只改前端浮层交互，不新增依赖、不读写文件，符合「安静、快、数据安全」，不扩大产品边界。

**前端**：影响 `src/features/preview/PreviewPane.tsx`、`src/features/preview/preview.css`。浮层新增 `pan` / `dragging` 状态与指针拖拽（仅 `zoom > 1` 时生效，`setPointerCapture` 保证拖出图片仍跟随）；拖动超过 3px 记作拖拽，随后的 click 不再误关浮层；翻页、切换文档、缩回 100% 时把偏移清零。图片 `transform` 改为 `translate(...) scale(...)`，放大时显示 grab 光标、拖动时关掉过渡动画；底部提示在放大后补「拖动平移」。风险：只作用于图片浮层，预览正文、缩放与翻页行为不变。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/preview/PreviewPane.tsx`（约 +72/−3 行）、`src/features/preview/preview.css`（+12 行，2 个文件）

**构建**：通过（`bun run build` 869ms，含 tsc）；未改后端，未跑 `cargo test`。

**验证**：CDP（9222，整页刷新，工作区 `D:\clawWorkSpeace\新建文件夹`）。打开 `写作示例.md` 切到预览，点击首张图片放大 → 浮层 `transform: translate(0px, 0px) scale(1)`，提示「滚轮缩放 · Esc 关闭」；滚轮上滚 3 次 → `scale(1.75)`、图片类名 `is-zoomed`、提示「拖动平移 · 滚轮可调回 100% · Esc 关闭」、计数「1 / 4 · 175%」；从图片中心拖到右下 (+120, +80) → `translate(120px, 80px) scale(1.75)`，浮层保持展开（拖拽后的 click 未误关）；滚轮下滚 3 次回 100% → `translate(0px, 0px)`、`is-zoomed` 移除、提示恢复；再次放大并拖动 (+80, +60) 后按 → → 翻到第 2 张，偏移清零为 `translate(0px, 0px) scale(1.25)`，计数「2 / 4 · 125%」；Esc 关闭浮层，切回源码视图。人工复现：预览里点开一张大图 → 滚轮放大 → 按住图片拖动，应能平移看到边角且拖动结束不关闭浮层；滚轮缩回 100% 应自动居中；左右键翻页后新图也应居中。

**遗留 / 下一轮建议**：拖动目前不限制边界，图可能被拖出可视区域，可按图片显示尺寸做钳制；拖动不支持惯性 / 双击复位。目录监听、Mermaid、全文搜索、多标签、切换文档丢撤销历史仍在候选。本轮后检验计数为 5，下一轮（第 166 轮）为检验轮，回归第 161–165 轮。

## 第 164 轮 · 2026-10-30 16:59
**用户需求**：标题栏「最近工作区」里有些库我已经不用了，但文件夹还在。现在只能先切过去、让它变成当前库才会从菜单消失，切回来它又回来了 → 希望菜单每一项旁边有个小按钮，可以直接把这条记录移掉，不用真的切过去。

**产品经理**：做。第 163 轮只解决了「点开才发现失效」的自动摘除；「还在但不想留」是最近工作区的另一个粗糙处。手动移除只改设置里的路径列表，不碰任何文件，也不改当前工作区，符合「本地优先、安静、数据安全」，不扩大产品边界。

**前端**：影响 `src/components/Menu.tsx`、`src/app/TitleBar.tsx`、`src/app/App.css`。`MenuAction` 增加可选 `onRemove` / `removeTitle`，菜单项改为「主按钮 + 行尾 ×」的一行（不传 `onRemove` 的菜单外观与行为不变，文件树右键菜单不受影响）；标题栏的最近工作区菜单给每项挂上移除动作，调用已有的 `forgetWorkspace(path)`，从本地菜单状态里滤掉该项并提示「已从最近工作区移除：X」，删空则收起菜单。风险：菜单关闭依赖的 window `mousedown` 在菜单内部被阻止，× 不会误关；键盘上下仍只在主按钮间移动。工作量 S。

**后端**：无改动（复用设置读写，无文件系统写操作）。工作量 0。

**裁决**：做

**改动**：`src/components/Menu.tsx`（约 +18 行）、`src/app/TitleBar.tsx`（约 +22 行）、`src/app/App.css`（约 +30 行，3 个文件）

**构建**：通过（`bun run build` 631ms，含 tsc）；未改后端，未跑 `cargo test`。

**验证**：CDP（9222，前端整页刷新，工作区 `D:\clawWorkSpeace\新建文件夹`）。把 `recentWorkspaces` 设为 `[新建文件夹, 临时工作区D, 不存在库]` → 点标题栏「最近工作区」箭头，菜单只列「切换到 临时工作区D」「切换到 不存在库」，每行都有 title 为「从最近工作区移除」的 ×；点第一行的 × → 该行立即消失、菜单保持展开、提示「已从最近工作区移除：临时工作区D」，设置变为 `[新建文件夹, 不存在库]`；再点剩下那行的 × → 菜单收起，设置变为 `[新建文件夹]`。接着建临时库 `D:\clawWorkSpeace\临时工作区D`（含 `D笔记.md`），重新写入 `[新建文件夹, 临时工作区D]` → 点菜单主按钮「切换到 临时工作区D」仍能正常切换（标题栏显示「临时工作区D」）；再开菜单点「切换到 新建文件夹」，切回并自动打开 `写作示例.md`。测试库已删除，`recentWorkspaces` 已还原为 `null`，工作区停在 `写作示例.md`。人工复现：打开过两个库后点标题栏「最近工作区」箭头 → 点某项右侧的 × → 该条应消失且不切换库，提示已移除；点条目主体仍应正常切换。

**遗留 / 下一轮建议**：最近工作区暂无「撤销移除」；库临时离线（如网络盘）时点开会按 `not-found` 自动摘除，是否保留条目待定。「导出后浏览器打开」（需改 capabilities）、目录监听 / Mermaid / 全文搜索 / 多标签 / 切换文档丢撤销历史仍在候选。本轮后检验计数为 4，下一轮（第 165 轮）继续常规需求，之后第 166 轮为检验轮。

## 第 163 轮 · 2026-10-30 16:54
**用户需求**：我上个月建过一个资料库，后来整个文件夹改名 / 删掉了，但标题栏的「最近工作区」里还挂着它。点一下只弹「打开工作区失败」，下次再点还是同一个错，菜单里越积越多打不开的库 → 希望切不过去时把这条过期记录从最近列表里摘掉，别一直留着。

**产品经理**：做。第 162 轮引入的最近工作区只存路径，失效后既删不掉也点不开，属于该功能的粗糙处。自动摘除只改设置里的路径列表，不碰任何文件，符合「本地优先、安静、数据安全」；且只在「库确实不存在」时摘除，取消未保存提示或其他失败仍保留条目，不扩大产品边界。

**前端**：影响 `src/features/workspace/workspace-actions.ts`、`src/app/TitleBar.tsx`。新增 `forgetWorkspace(path)`（读设置、滤掉该路径、空则写 `null`）；`openWorkspaceAt` 增加 `fromRecent` 可选参数，从最近菜单进来且错误码为 `not-found` 时先 `forgetWorkspace` 再提示「…（已从最近工作区移除）」，其他失败与取消未保存守卫不受影响；标题栏菜单项改为传 `fromRecent=true`。风险：只多一次设置读写，无文件系统写操作；库临时离线（如网络盘）不会被误删，因为只有 `not-found` 才摘除。工作量 S。

**后端**：无改动（`open_workspace` 的 `not-found` 错误码已存在）。工作量 0。

**裁决**：做

**改动**：`src/features/workspace/workspace-actions.ts`（约 +25 行）、`src/app/TitleBar.tsx`（1 行，2 个文件）

**构建**：通过（`bun run build` 681ms，含 tsc）；未改后端，未跑 `cargo test`。

**验证**：CDP（9222，前端整页刷新，工作区 `D:\clawWorkSpeace\新建文件夹`）。建临时库 `D:\clawWorkSpeace\临时工作区C`（含 `C笔记.md`），把 `recentWorkspaces` 设为 `[临时工作区C, 不存在库, 新建文件夹]` → 点标题栏「最近工作区」箭头，菜单只列「切换到 临时工作区C」「切换到 不存在库」（当前库被排除）；点「不存在库」→ 提示「打开工作区失败：…（已从最近工作区移除）」，设置里变为 `[临时工作区C, 新建文件夹]`；再开菜单只剩「临时工作区C」。点它成功切到临时库（标题栏显示「临时工作区C」），再从菜单切回「新建文件夹」并自动打开 `写作示例.md`。测试库已删除，`recentWorkspaces` 已还原为 `null`，工作区停在 `写作示例.md`。人工复现：把一个打开过的库在资源管理器里删掉或改名 → 标题栏箭头 → 点它 → 应提示失败并说明已从最近工作区移除，再开菜单该条消失；点仍存在的库应正常切换。

**遗留 / 下一轮建议**：最近工作区仍没有手动「移除」入口（目前靠失效自动摘除）；库临时离线后条目会保留，可作后续小项。「导出后浏览器打开」（需改 capabilities）、目录监听 / Mermaid / 全文搜索 / 多标签 / 切换文档丢撤销历史仍在候选。本轮后检验计数为 3，下一轮（第 164 轮）继续常规需求。


## 第 162 轮 · 2026-10-30 16:46
**用户需求**：我同时维护两个笔记库——工作资料放在一个文件夹，个人写作放在另一个盘。每次想切回去，都得点「打开文件夹」再用系统对话框一层层翻；应用只记得上次那一个库 → 希望标题栏能列出手动打开过的最近工作区，点一下直接切回去。

**产品经理**：做。这是已实现「记住上次工作区」的自然补全：只把路径记进设置，不复制内容、不建索引，切回时重新扫盘；切换仍走原有的未保存守卫，符合「本地优先、纯文本、数据安全」，不扩大产品边界。

**前端**：影响 `src/app/TitleBar.tsx`、`src/features/workspace/workspace-actions.ts`。新增 `rememberWorkspace` / `listRecentWorkspaces`（设置键 `recentWorkspaces`，最多 5 条，最新在前；列表排除当前库），在 `openWorkspaceAt` 与启动恢复成功后记录；标题栏文件夹图标旁加一个下拉箭头，点开用现有 `ContextMenu` 列出「切换到 X」，切换复用 `openWorkspaceAt`（未保存守卫、恢复该库上次文档、提示逻辑都不变）。最近列表为空时箭头退回原行为，直接弹「打开文件夹」对话框。风险：多一次设置读写，无文件系统写操作；菜单只存路径，库被删时切换会按原有错误提示，不影响当前库。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/TitleBar.tsx`（+58 行）、`src/features/workspace/workspace-actions.ts`（+29 行，2 个文件）

**构建**：通过（`bun run build` 817ms，含 tsc）；未改后端，未跑 `cargo test`。

**验证**：CDP（9222，前端整页刷新）。建临时库 `D:\clawWorkSpeace\临时工作区B`（含 `B笔记.md`），经应用内设置把 `lastWorkspace` 指过去并重载 → 标题栏显示「临时工作区B」，设置里 `recentWorkspaces` 变为 `[临时工作区B, 新建文件夹]`；点标题栏新出现的「最近工作区」箭头 → 菜单只列「切换到 新建文件夹」（当前库被排除）；点它后切回原库，标题栏与状态栏恢复「新建文件夹」，并自动打开上次的 `写作示例.md`，无报错提示；设置里顺序变为 `[新建文件夹, 临时工作区B]`。测试库已删除，设置恢复到原库，工作区停在 `写作示例.md`。人工复现：依次打开两个不同文件夹 → 点文件夹图标右侧的箭头 → 选另一个库，应直接切回并打开它上次的笔记；从未打开过第二个库时，箭头行为与「打开文件夹」一致。

**遗留 / 下一轮建议**：最近工作区的失效路径不会自动摘除，选中失败只提示「打开工作区失败」，可留待后续加「从列表移除」；「导出后浏览器打开」（需改 capabilities）、目录监听 / Mermaid / 全文搜索 / 多标签 / 切换文档丢撤销历史仍在候选。本轮后检验计数为 2，下一轮（第 163 轮）继续常规需求。


## 第 161 轮 · 2026-10-30 16:39
**用户需求**：同名笔记在不同的应用会话里各导出过一次 HTML。现在打开导出对话框，默认名仍显示「写作示例.html」，点「导出」后才被悄悄改成「写作示例-2.html」；有时还要等一下。文件树里又看不到 `.html`，我根本不知道到底会存成哪个名字 → 希望对话框一打开就给出真正可用的名字，确认后按显示的名字落盘。

**产品经理**：做。导出 HTML 已承诺「不覆盖已有文件」，但可用名的判断只靠会话内记录和文件树（只列 Markdown），跨会话 / 外部放入的 `.html` 看不到。把探测交给后端只读磁盘，不新增能力、不落盘记录，符合「本地优先、数据安全」，也让默认名和实际落盘一致。

**前端**：影响 `src/app/Toolbar.tsx`。删掉会话级 `exportedHtml` 集合与 1000 次循环，改为调用后端 `next_export_name`：打开对话框前取一次准确默认名，写盘前再探测一次避免对话框期间外部新增同名文件；`already-exists` 的 50 次重试链随之删除。风险：新增一次 IPC 探测，失败时回退到笔记名，导出主流程不变。工作量 S。

**后端**：影响 `src-tauri/src/commands/file.rs`、`src-tauri/src/lib.rs`。新增只读命令 `next_export_name(parentRelPath, name)`：校验 `.html` 扩展名与文件名、目录必须存在且在工作区内，然后按 `名字.html`、`名字-2.html`… 扫到第一个磁盘上不存在的名字返回；不写文件、不覆盖。附单元测试覆盖顺延、跨目录、非 `.html`、逃逸与缺失目录。工作量 S。

**裁决**：做

**改动**：`src-tauri/src/commands/file.rs`（+64 行，含测试）、`src-tauri/src/lib.rs`（+1 行注册）、`src/app/Toolbar.tsx`（−46/+17 行，3 个文件）

**构建**：通过（`bun run build` 556ms，含 tsc）；`cargo test` 34 passed（新增 `finds_free_export_name_on_disk`）。

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`，Tauri dev 已随 Rust 改动重建）。在工作区放一个外部 `写作示例.html`（22 B，内容 `<p>外部旧文件</p>`），打开 `写作示例.md` 点「导出 HTML…」→ 对话框默认名直接是 `写作示例-2.html`；确认后提示「已导出 HTML：写作示例-2.html」，落盘文件带完整文档头，外部旧文件内容未变。再打开对话框默认名变为 `写作示例-3.html`；手动把文件名改成 `写作示例.html` 后确认，提示仍为 `写作示例-3.html`，旧文件未被覆盖（写盘前二次探测生效）。测试生成的三个 `.html` 已删除。人工复现：在工作区手工放一个与笔记同名的 `.html`，重开应用后导出该笔记，对话框默认名应直接是 `名字-2.html`，确认后文件与提示一致。

**遗留 / 下一轮建议**：「导出后浏览器打开」仍需扩 capabilities 或加后端命令；目录监听 / Mermaid / 全文搜索 / 多标签 / 切换文档丢撤销历史仍在候选。本轮后检验计数为 1，下一轮（第 162 轮）常规需求。


## 第 160 轮 · 2026-10-30 16:34（检验轮）
**范围**：回归第 155–159 轮导出 HTML / 浏览历史 / 覆盖保存 / 导出提示动作，不开新功能。

**逐项结果**
1. **构建 + 后端测试**：`bun run build` 通过（569ms，含 tsc）；`cargo test` 33 passed（本轮未改后端）。
2. **第 155 轮 · 撞名顺延**：在工作区手工放一个外部 `写作示例.html`（45 B），整页刷新清空会话记录后导出 `写作示例.md` → 默认名仍是 `写作示例.html`，后端拒绝后自动落 `写作示例-2.html`，外部旧文件未被改写；再连续导出依次落到 `-3`、`-4`。跨会话已有 `.html` 的 `-2`…`-50` 顺延路径有效。
3. **第 156 轮 · 完整文档头**：落盘的 `写作示例-2.html` 开头为 `<!doctype html>`、`charset=utf-8`、`<title>写作示例-2</title>` 与自足内联样式；3 张工作区图片仍是 `data:image/png`；撞名顺延后 `<title>` 与文件名一致。
4. **第 157 轮 · 浏览历史同步**（发现真问题，已修）：文件改名 `笔记.md → 笔记-改名.md` 后「返回」打开新路径、无报错，「前进」回原篇。**目录改名** `子目录 → 子目录B` 时，`renameEntry` 为重建文件树调用 `setWorkspace`，把刚重映射的 `history/forward` 一并清空，「返回」变哑；`moveEntry` 的目录移动分支同样受影响。**当场修复**：重建前取出 `history/forward`，`setWorkspace` 后立即恢复（6 行、2 处）。修复后目录改名，历史为 `子目录B/笔记.md`，「返回」正确打开新目录下的笔记。**目录删除**：删掉含笔记的临时目录后，其历史项被摘除，「返回」打开上一篇且无「打开文件失败」。
5. **第 158 轮 · 覆盖保存**：关闭自动保存后制造外部修改并触发保存，冲突对话框四按钮齐全。「取消」→ 保存返回 false、`dirty=true`、编辑器内容保留、磁盘仍是外部版本；再次冲突点「覆盖保存」→ 返回 true、`dirty=false`、磁盘变为编辑器内容、提示「已覆盖保存，磁盘上的外部修改已被替换」。
6. **第 159 轮 · 导出提示动作**：成功提示 title 为「点击在资源管理器中显示」，点击后气泡收起、无错误提示，Shell 窗口定位到工作区目录（资源管理器已打开）；把刚导出的 `.html` 删掉再点提示，得到「打开资源管理器失败：文件或目录不存在：…」。

**改动**：`src/features/workspace/workspace-actions.ts`（+6/−2 行，1 个文件）

**构建**：通过（`bun run build` 569ms，含 tsc）；`cargo test` 33 passed。

**遗留 / 下一轮建议**：目录移动（拖拽 / 「移动到…」）与目录改名走同一段重建逻辑，本轮抽查了改名与删除，移动分支按同一路径推断可用；跨会话默认名探测（后端 `next_export_name`）仍是候选。检验计数清零，下一轮（第 161 轮）恢复常规需求。

**人工复现**：① 在工作区放一个与笔记同名的外部 `.html`，重开应用后导出该笔记，应落到 `名字-2.html` 且旧文件不变；② 改一篇笔记名后点「返回」，应打开改名后的笔记；③ 把当前笔记所在目录改名后点「返回」，应打开新目录下的笔记（修复前无反应）；④ 有未保存修改时用记事本改同一文件并保存，回扉页 Ctrl+S：「取消」保留两边，「覆盖保存」让磁盘变成扉页里的内容。


## 第 159 轮 · 2026-10-30 16:26
**用户需求**：导出 HTML 成功提示一闪而过，文件树又只显示 Markdown，想找刚导出的 `.html` 发给别人，只能自己打开资源管理器一层层翻 → 希望「已导出 HTML」那条提示本身能点，点一下就打开所在文件夹并选中该文件。

**产品经理**：做。复用已有的 `reveal_entry`（工作区边界校验 + 系统资源管理器定位），不新增后端能力、不落盘任何记录；提示仍在 3 秒后自动收起，悬停可暂停，不影响「安静」原则。也让「导出后文件在哪」这个粗糙处有了直达入口。

**前端**：影响 `src/stores/ui.ts`、`src/components/Toast.tsx`、`src/app/Toolbar.tsx`。`ToastItem` 增加可选 `action`，`toast()` 增加可选第三参；ToastHost 点击时先执行 `action` 再收起（无 action 仍是「点击关闭」），带动作的提示 title 改为「点击在资源管理器中显示」。导出成功提示文案追加「· 点击在文件夹中显示」，并传入 `reveal_entry` 动作，失败时再弹一条错误提示。风险：提示的点击语义从「关闭」变成「执行 + 关闭」，只对显式传 action 的提示生效，其余保持不变。工作量 S。

**后端**：无改动（`reveal_entry` 早已支持工作区内任意已存在文件）。工作量 0。

**裁决**：做

**改动**：`src/stores/ui.ts`（约 8 行）、`src/components/Toast.tsx`（约 9 行）、`src/app/Toolbar.tsx`（约 8 行，3 个文件）

**构建**：通过（`bun run build` 579ms，含 tsc）。

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`，整页刷新后停在 `写作示例.md`）。点「导出 HTML…」→ 确认后提示为「已导出 HTML：写作示例.html · 点击在文件夹中显示」，title 为「点击在资源管理器中显示」；点击提示后提示收起、无错误提示，磁盘上 `写作示例.html` 存在（75 KB）。再次导出默认名已避让为 `写作示例-2.html`；导出后把文件删掉再点提示，出现「打开资源管理器失败：文件或目录不存在：写作示例-2.html」，证明提示点击确实执行了 `reveal_entry` 并走到失败分支。测试生成的 `.html` 已删除。人工复现：导出任意笔记 → 点击成功提示 → 应在资源管理器中打开该笔记所在目录并选中 `.html` 文件。

**遗留 / 下一轮建议**：「导出后在浏览器中打开」仍需扩 `opener` capabilities，未做；跨会话默认名探测（后端 `next_export_name`）仍是候选。本轮后检验计数为 5，下一轮（第 160 轮）按规则为**检验轮**，回归第 155–159 轮的导出 / 导航 / 覆盖保存 / 提示动作。

---

## 第 158 轮 · 2026-10-30 16:20
**用户需求**：在别的编辑器里顺手改了一行，切回扉页按 Ctrl+S → 对话框只有「另存副本 / 重新加载 / 取消」，两边都有改动，我只想以当前编辑内容为准 → 希望冲突时能明确选择「覆盖保存」，并说清楚会丢掉磁盘上的外部修改。

**产品经理**：做。README「计划中」的「覆盖 / 另存副本」里，「另存副本」已完成，缺的正是显式覆盖。它不是静默覆盖：只有用户在冲突对话框里主动点击才发生，文案说明会丢弃外部修改；符合「数据安全」原则，也不扩大边界。

**前端**：影响 `src/features/editor/save.ts`。冲突对话框加入「覆盖保存」（danger），选择后 `overwriteActiveDocument()` 用 `writeFile(path, text, null)` 跳过 mtime 校验写回，再 `markSaved` 更新基线、清恢复副本并提示；写盘期间的新输入仍保留脏状态。风险：显式覆盖会丢外部修改，已用按钮与提示标明；另存 / 重载 / 取消分支不变。工作量 S。

**后端**：无改动（`write_file` 的 `expected_modified_ms` 本就是 `Option`，传 `null` 即跳过冲突检查）。工作量 0。

**裁决**：做

**改动**：`src/features/editor/save.ts`（约 38 行，1 个文件）

**构建**：通过（`bun run build` 812ms，含 tsc）。

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`，整页刷新后）。建临时笔记 `覆盖测试.md` 并打开，把编辑区改成「编辑器里的新内容」，以 `write_file`（expected 传 null）模拟外部改盘后再 Ctrl+S：弹出「文件已被其他程序修改」，按钮为「另存副本… / 覆盖保存 / 重新加载 / 取消」；点「覆盖保存」后保存返回 true、`dirty=false`、`saveBlocked=null`，磁盘内容变为编辑器里的文本，提示「已覆盖保存，磁盘上的外部修改已被替换」。另验证「取消」：保存返回 false、`dirty` 保持 true、磁盘仍是外部内容。测试笔记已删除，工作区恢复在 `写作示例.md`。人工复现：打开任意笔记改几个字 → 用记事本改同一文件并保存 → 回扉页 Ctrl+S → 选「覆盖保存」，文件应变成扉页里的内容；选「取消」则两边都不变。

**遗留 / 下一轮建议**：覆盖是整篇替换，不提供逐行合并（属后续「文档历史」范畴）；「另存副本」仍是主按钮，回车不会误触覆盖。本轮后检验计数为 4，下一轮再完成 1 条需求后进入检验轮，届时回归第 156–159 轮的导出 / 导航 / 覆盖保存。

---

## 第 157 轮 · 2026-10-30 16:12
**用户需求**：沿着链接读完 A→B，回文件树把刚才那篇 A 改个名（或拖进子目录），再点「返回」→ 却提示「打开文件失败」，返回入口直接作废，只能重新去树里找 → 希望改名 / 移动后「返回」仍能打开那篇笔记，删掉的目录则从历史里干净移除，不再撞旧路径。

**产品经理**：做。第 139–142 轮已经把「返回 / 前进」做成会话级浏览历史，改名、移动、删除却只同步「最近打开」，历史里留着旧路径，等于让已有承诺打折。只同步内存中的会话历史，不落盘、不碰文件，符合「本地优先、安静、数据安全」。

**前端**：影响 `src/stores/workspace.ts` 与 `src/features/workspace/workspace-actions.ts`。抽出 `remapPath` / `remapPaths`（前缀映射，`null` 表示移除，无变化时返回原数组避免多余更新），新增 `remapHistory` 同时映射 `history` 与 `forward`；重命名、移动、删除三处与 `updateRecent` 并排调用。风险：只影响会话内数组，无持久化副作用；删除目录时其下笔记一并从历史摘除。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/stores/workspace.ts`（约 45 行）、`src/features/workspace/workspace-actions.ts`（3 处调用，2 个文件）

**构建**：通过（`bun run build` 577ms，含 tsc）。

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`，整页刷新后）：点开 `子目录/笔记.md`，再点开 `写作示例.md`（历史栈顶为 `子目录/笔记.md`）→ 在树里聚焦 `笔记.md` 按 F2 改名为 `笔记-改名.md` → 点工具栏「返回」，状态栏显示 `子目录/笔记-改名.md`，无「打开文件失败」提示。随后把名字改回 `笔记.md`，点「前进」回到 `写作示例.md`，工作区恢复原状。删除分支留人工步骤：删掉一个曾读过的目录（里面有笔记）后按「返回」，应跳过已删笔记而不是弹打开失败。

**遗留 / 下一轮建议**：本轮未跑 `cargo test`（未改后端）。「删除目录后返回」分支只做了代码路径，建议下一轮顺手回归；跨会话空闲导出名（后端 `next_export_name`）仍是候选。

---

## 第 156 轮 · 2026-10-30 16:08
**用户需求**：把导出的 `笔记.html` 发给朋友，对方在浏览器里打开 → 标题和正文一样大、莫名字体、行距全挤在一起，中文还可能是乱码，和预览里完全两个样子 → 希望导出的文件自己带着排版，双击打开就像在「扉页」里读到的那样。

**产品经理**：做。导出 HTML 是给应用外的人看的，载体自带样式才算真正可用；补一份精简、自足的样式不触碰「纯文本 / 本地优先」原则，也不改后端写入语义（仍原子写、不覆盖）。不引入主题设置或外部 CSS，避免扩大边界。

**前端**：影响 `src/app/Toolbar.tsx`。新增 `escapeHtml` 与 `standaloneHtml(title, body)`：给渲染片段包上 `<!doctype html>`、`<meta charset="utf-8">`、视口、`<title>`（取最终落盘文件名，撞名顺延后也一致）与约 20 行内联样式（正文宽度、标题字号、引号、代码块、表格、图片最大宽度）；`exportActiveAsHtml` 在 `write` 内按 `candidate` 生成完整文档再交给 `export_html`。风险：只影响导出落盘，不改变「复制 HTML」的片段语义；`.html` 体积略增。工作量 S。

**后端**：无改动（`export_html` 原样接收完整文档内容，边界与不覆盖不变）。工作量 0。

**裁决**：做

**改动**：`src/app/Toolbar.tsx`（约 45 行，1 个文件）

**构建**：通过（`bun run build` 718ms，含 tsc）。

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`，整页刷新后）：打开 `写作示例.md` → 点工具栏「导出 HTML…」→ 默认名 `写作示例.html`，回车后提示「已导出 HTML：写作示例.html」。落盘文件 75 KB，开头为 `<!doctype html>` + `<meta charset="utf-8">` + `<title>写作示例</title>` + 内联样式，3 张本地图片仍是 `data:image/png`。再次导出撞名自动落到 `写作示例-2.html`，其 `<title>` 同步为「写作示例-2」。测试生成的 `.html` 已删除。人工复现：导出任意笔记，双击 `.html` 用浏览器打开，应有居中正文、标题层级、代码块底色与中文正常显示。

**遗留 / 下一轮建议**：导出的 HTML 仍是浅色一套样式，暗色主题的笔记导出后跟随浅色，属预期；「复制 HTML」粘贴到邮件时仍依赖剪贴板富文本、未强制内联样式，若邮件客户端丢样式可另立条目。跨会话默认名探测（后端 `next_export_name`）仍是候选。

---

## 第 155 轮 · 2026-10-30 15:50
**用户需求**：昨天导过一份 `笔记.html`，今天重开应用改完再导出 → 对话框默认名仍是 `笔记.html`，回车被「已存在，未覆盖」拦下，可用名还得自己猜 → 希望这次直接落到下一个空闲名，别让用户在两个对话框之间来回。

**产品经理**：做。延续「不覆盖、默认名避让」的既有承诺，不改后端语义；自动顺延比报错更贴合「连续导出」的真实动作，落盘结果仍在提示里明说。

**前端**：影响 `src/app/Toolbar.tsx`。渲染与图片内联提到 try 之前；`already-exists` 时按 `名字-2.html`…`名字-50.html` 逐个试写，首个成功即返回并提示实际文件名，非撞名错误原样报出。风险：最多 50 次 invoke，均在冲突时发生；始终不覆盖。工作量 S。

**后端**：无改动（`export_html` 仍是原子写 + 存在即拒绝）。工作量 0。

**裁决**：做

**改动**：`src/app/Toolbar.tsx`（约 30 行，1 个文件）

**构建**：通过（`bun run build` 555ms，含 tsc）。

**验证**（本轮未跑 CDP，留人工步骤）：① 手工在工作区目录放一个 `写作示例.html`；② 打开 `写作示例.md` → 工具栏「导出 HTML…」→ 默认名若仍是 `写作示例.html`（跨会话看不到已有文件），直接回车；③ 预期提示「已导出 HTML：写作示例-2.html」，目录里出现 `写作示例-2.html`，原 `写作示例.html` 未被改写；④ 再导出一次应落到 `写作示例-3.html`；⑤ 同目录放满 `名字-2`…`名字-50` 时提示「及其后 50 个序号都被占用」。

**遗留 / 下一轮建议**：对话框默认名仍只按会话内记录避让，跨会话时首个默认名可能撞名，但导出会自动顺延，不再是死路；若要进一步让默认名本身准，可让后端新增「探测可用导出名」命令，属下一轮候选。

---

## 第 154 轮 · 2026-10-30 15:49（检验轮）
**范围**：回归第 149–153 轮「复制 / 导出 HTML」链路，不开新功能。

**逐项结果**
1. **构建 + 后端测试**：`bun run build` 通过（535ms，含 tsc）；`cargo test` 通过（33 passed）。
2. **导出 HTML / 默认名避让**：发现真问题——`list_dir` 只返回 Markdown（`workspace.rs` 按 `is_markdown` 过滤），第 153 轮 `nextFreeHtmlName` 读 `children[parent]` 永远看不到已导出的 `.html`，第二次导出默认名仍是 `写作示例.html`，撞名提示也只回退到「换个文件名再试」。**当场修复**：Toolbar 增加模块级 `exportedHtml` 集合，导出成功时记下 `${parent}\u0000${文件名}`，`nextFreeHtmlName` 把它并入占用集合。重载应用后 CDP 实测：首次导出默认 `写作示例.html` 成功；再次打开对话框默认 `写作示例-2.html`，回车导出成功，两个文件都落盘。测试生成的 `.html` 已删除。
3. **选中正文 Ctrl+Shift+E（编辑区）**：CDP 聚焦后用键盘选区 14 字符（11 个非空白字），提示「所选内容（11 字）已复制为 HTML…」，剪贴板 `text/plain` 只含所选文本，同时带 `text/html`，符合预期。
4. **预览模式选区复制（第 149 轮）**：复制内容正确（剪贴板 37 字符即所选段落），但提示恒为「所选内容（0 字）」——原因是 `window.getSelection()` 在 `await`（渲染 / 内联 / 写剪贴板）之后才读，选区已丢失。**当场修复**：选中预览 HTML 时立刻记下 `previewPlain`，字数提示用这份快照。重载后复测提示「所选内容（35 字）」，与剪贴板内容一致，切回分栏正常。

**改动**：`src/app/Toolbar.tsx`（约 12 行，1 个文件）

**构建**：通过（`bun run build` 585ms，含 tsc）；`cargo test` 33 passed（未改后端）。

**遗留 / 下一轮建议**：①默认名避让目前只覆盖「本次会话内连续导出」，跨会话 / 外部放入的 `.html` 仍看不到；根因是 `list_dir` 只列 Markdown，彻底修复可新增后端 `next_export_name`（或让导出接口在读目录时自行避让），属下一轮候选。②`Page.bringToFront` 之前文档无焦点时 `navigator.clipboard.write` 会失败并提示「复制 HTML 失败」，属 CDP 环境限制，非产品缺陷。

---

## 第 153 轮 · 2026-10-30 15:49
**用户需求**：笔记发出去之前改了几句，想再导出一份最新 HTML → 对话框默认名还是 `笔记.html`，回车就被「已存在，未覆盖」拦下，还得关掉重来、自己数着改成 `-2` → 希望连续导出时默认名自动避让，撞名提示里也直接给出可用名。

**产品经理**：做。与「另存为」的默认名避让保持一致，不覆盖、不新增后端能力；把「导出后一键在浏览器打开」评估为暂不做——`opener:default` 只允许 `http/https/mailto/tel` 与 `reveal-item-in-dir`，打开本地文件需改 capabilities（属构建 / 权限配置，本轮不动）。

**前端**：影响 `src/app/Toolbar.tsx`（新增 `nextFreeHtmlName(parent, leaf)`：读同目录已加载条目，按大小写不敏感取下一个空闲的 `名字-N.html`；默认名与 `already-exists` 提示共用）。风险：目录未加载时不改动默认名，由后端兜底拒绝；序号上限 999 后回退原名。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/Toolbar.tsx`（约 28 行，1 个文件）

**构建**：通过（`bun run build` 531ms，含 tsc）。

**验证**（本轮受限只跑构建，未跑 CDP）：人工步骤——打开 `写作示例.md` → 工具栏「导出 HTML…」→ 直接回车导出 `写作示例.html`；再点一次「导出 HTML…」，默认名应已是 `写作示例-2.html`，回车成功提示「已导出 HTML：写作示例-2.html」；若手动把名字改回 `写作示例.html`，提示应为「「写作示例.html」已存在，未覆盖；可改用「写作示例-2.html」」。同目录已有 `a.html`、`a-2.html` 时默认应为 `a-3.html`；大小写不同的 `A.HTML` 也算占用。

**遗留 / 下一轮建议**：本窗口「自上次检验轮」已满 5，下一轮按规则做**检验轮**（回归第 149–153 轮复制 / 导出 HTML 链路）。「导出一键在浏览器打开」需在 capabilities 增加 `opener:allow-open-path` 作用域，属配置改动，留给人工评估。

---

## 第 152 轮 · 2026-10-30 15:48
**用户需求**：写完笔记想直接把 HTML 发给别人 → 上一轮后端已经能写文件，但工具栏只有「复制 HTML」，没有落盘入口 → 希望「复制 HTML」旁有「导出 HTML…」，填个文件名就导出到当前笔记同目录，重名不覆盖。

**产品经理**：做。把第 151 轮的后端能力接到界面，复用现有输入对话框与 HTML 渲染 / 图片内联管线；默认文件名取当前笔记名，成功提示相对路径，重名由后端拒绝并明确提示「未覆盖」，符合「本地优先、数据安全、安静」。

**前端**：影响 `src/app/Toolbar.tsx`（新增 `exportActiveAsHtml`：`askInput` 取文件名、自动补 `.html`、复用 `renderMarkdownToHtml` + `inlineLocalImages`，`invoke("export_html")`，成功后刷新所在目录并提示相对路径；重名按 `already-exists` 提示不覆盖）与 `src/features/workspace/workspace-actions.ts`（导出 `nameCharError` / `existingNameError` 供复用）。风险：导出始终整篇（即使编辑区有选区），与「复制 HTML」的选区行为区分；文件树不显示 `.html`，重名由后端兜底。工作量 S。

**后端**：无改动（复用第 151 轮 `export_html`）。工作量 0。

**裁决**：做

**改动**：`src/app/Toolbar.tsx`（约 55 行）、`src/features/workspace/workspace-actions.ts`（2 处 `export`，2 个文件）

**构建**：通过（`bun run build` 582ms，含 tsc）。

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`，停在 `写作示例.md`）。①工具栏出现「导出 HTML…」；点开对话框标题「导出 HTML」、默认名 `写作示例.html`；回车确认后提示「已导出 HTML：写作示例.html」，同目录生成 74 KB `.html`，3 张图片已内联为 `data:image/`；②再次导出同名文件，后端拒绝并提示「「写作示例.html」已存在，未覆盖；换个文件名再试」，原文件未被改写。测试文件已删除，仓库内无残留。人工复现：打开笔记 → 工具栏「导出 HTML…」→ 直接回车或改名 → 应在同目录看到 `.html`，浏览器可打开；重复导出同名应提示已存在。

**遗留 / 下一轮建议**：文件树暂不列出 `.html`（只列 Markdown），导出后不会出现在树里，属预期；若需要「导出后一键在浏览器打开」可另立条目。

---

## 第 151 轮 · 2026-10-30 15:46
**用户需求**：写完一篇笔记想存成独立 HTML 发给别人 → 现在只能「复制 HTML」粘到别处，应用里没有落盘入口 → 希望应用能把它写成一个 `.html` 文件（导出 HTML 落盘的第一步）。

**产品经理**：做。先加后端受控写入，落盘范围严格限定在当前工作区、只允许 `.html`、不覆盖已有文件，符合「本地优先、数据安全」；前端入口留到下一步接，避免本轮超出 S 级。

**前端**：无改动（下一步在工具栏「复制 HTML」旁接「导出 HTML…」，复用第 143 轮已实现的 HTML 管线）。

**后端**：影响 `src-tauri/src/commands/file.rs`（新增 `export_to` + `export_html` 命令，沿用 `resolve_in_workspace` 边界校验与 `write_path` 的临时文件 + 原子 rename）与 `src-tauri/src/lib.rs`（注册命令）。风险：`.html` 扩展名大小写不敏感；目标已存在直接 `AlreadyExists`，不静默覆盖；父目录必须已存在，不做隐式建目录。工作量 S。

**裁决**：做

**改动**：`src-tauri/src/commands/file.rs`（约 50 行，含单测）、`src-tauri/src/lib.rs`（1 行，2 个文件）

**构建**：通过（`bun run build` 722ms，含 tsc）；`cargo test` 通过（33 passed，新增 `exports_html_inside_workspace_only`）。

**验证**：自动化已覆盖——工作区内写 `.html` 成功且内容一致、`.md` / 无扩展名被拒、`../` 逃逸被拒、同名不覆盖、子目录可写、目录缺失报错。人工步骤（前端接上后再做）：打开工作区 → 触发导出 → 生成 `.html` 可在浏览器打开；再次导出同名文件应提示已存在而非覆盖。

**遗留 / 下一轮建议**：下一轮在工具栏接「导出 HTML…」，用保存对话框选路径（限工作区内 `.html`），成功提示相对路径，失败按 `AlreadyExists` 提示改名。

## 第 150 轮 · 2026-10-30 15:42
**用户需求**：选中一段正文按 Ctrl+Shift+E 复制 HTML → 提示只说「所选内容已复制」，看不出到底复制了多少，选多了选少了都没法当场确认 → 希望提示里带上复制内容的字数。

**产品经理**：做。纯提示文案补全，不改复制逻辑、不增依赖，符合「安静但诚实」；整篇复制仍保持原提示，避免每篇都报一个不准确的数字（整篇含 Markdown 语法）。

**前端**：影响 `src/app/Toolbar.tsx`（`copyActiveAsHtml` 内拼提示时，选区来源取编辑区 `sliceDoc` 或预览 `selection.toString()`，去空白后计字）；风险：预览选区文本可能含装饰文字，仅作参考字数；整篇路径不变。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/Toolbar.tsx`（1 个文件，约 10 行）

**构建**：通过（`bun run build` 603ms，含 tsc）。

**验证**（构建通过，未跑 CDP）：人工复现——①分栏 / 预览里选中一段按 Ctrl+Shift+E，提示应为「所选内容（N 字）已复制为 HTML…」；②编辑区选中一行再按，字数与去空白后的所选字符数一致；③不选中直接按，提示仍为「HTML 已复制…」且不出现字数。

**遗留 / 下一轮建议**：字数按去空白字符计，中文标点计入；若用户更需要「行数 / 图片张数」可另立条目。「导出 HTML 落盘」仍按第 145 轮拆好的两步执行。

---

## 第 149 轮 · 2026-10-30 15:39
**用户需求**：分栏或纯预览里读一篇长文，直接鼠标选中一小段想贴进邮件 → 按 Ctrl+Shift+E 却把整篇复制了，选区白选 → 希望预览里选中什么就复制什么，图片也照样带上。

**产品经理**：做。这是第 148 轮遗留的体验不一致，复用已有「复制 HTML + 图片内联」管线，不新增依赖、不改剪贴板格式，符合「快、安静、诚实」。编辑区有选区时仍优先编辑区选区，行为不变。

**前端**：影响 `src/app/Toolbar.tsx`（新增 `previewSelectionHtml`：校验选区落在预览正文内，`cloneContents` 后去掉代码块复制按钮 / 语言标签 / 预览补的标题 id 与链接路径提示；`feiyeimgRel` 把预览图片的 feiyeimg 地址还原成工作区相对路径，交给现有 `inlineLocalImages`）。风险：只读 DOM、不改文档；选区在预览外或已折叠时回落到原有的整篇 / 编辑区逻辑；预览装饰节点在克隆后统一剔除。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/Toolbar.tsx`（1 个文件，约 61 行）

**构建**：通过（`bun run build` 566ms，含 tsc）。

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`，整页刷新后停在 `写作示例.md`）。①在预览里选中第一段再按 Ctrl+Shift+E，提示「所选内容已复制为 HTML…」，剪贴板纯文本 37 字（正好该段），HTML 1021 字节、无复制按钮 / 语言标签 / 标题 id；②选中含截图的段落（图片 src 为 `feiyeimg://`），提示「（1 张本地图片已内联）」，剪贴板 HTML 52 KB、`data:image/` 1 处、`feiyeimg` 0 处。人工复现：分栏或预览里用鼠标选中一两段，按 Ctrl+Shift+E，粘到邮件应只有所选内容；选中带截图的段落，图片应能显示。

**遗留 / 下一轮建议**：编辑区与预览区同时有选区时以编辑区为准（符合预期，不再记录）；「导出 HTML 落盘」仍按第 145 轮拆好的两步执行。

---

## 第 148 轮 · 2026-10-30 15:36（检验轮）
**范围**：回归第 143–147 轮「复制 HTML」链路——整篇 / 选区复制、Ctrl+Shift+E 快捷键、设置快捷键表、本地图片内联（4 MB 上限与失败降级）、提示文案。不实现新功能。

**构建**：`bun run build` 通过（563ms，含 tsc；修复后复跑 525ms）；`cargo test` 32 passed / 0 failed。

**逐项结果**（CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`；快捷键与选区均用 CDP Input 的真实按键 / 鼠标事件触发，纯 JS 合成事件缺少用户激活会让 `execCommand("copy")` 返回 false）：
1. **整篇复制**：通过。打开 `写作示例.md` 按 Ctrl+Shift+E，提示「HTML 已复制，可直接粘贴到邮件或公众号草稿（3 张本地图片已内联）」；剪贴板 `HTML Format` 111,253 字节，`data:image/` 3 处、`feiyeimg` 0 处、`<img>` 3 个。
2. **选区复制**：通过。编辑区内用 Shift+↓ 选中一段（含「链接到图片」一行）再按快捷键，提示「所选内容已复制为 HTML…」；剪贴板纯文本 15 字、HTML 994 字节且无图片，只有所选内容。
3. **按钮状态**：通过。无笔记时「复制 HTML」置灰，按键提示「先打开一篇笔记再复制 HTML」；纯预览模式下按钮仍可点，复制整篇（纯文本 1014 字、3 张图片内联）；空笔记复制提示不带括号。
4. **4 MB 上限与失败降级**：通过。造 4 MB + 1 字节的 `assets/big-test.png`，`read_image_data_url` 返回 null；不存在的路径返回 null；`../x.png` 越界报错；小图正常返回 data URL。另建引用「大图 + 小图」的临时笔记复制，提示「（1 张本地图片已内联；1 张本地图片在应用外可能无法显示）」，剪贴板 1 个 data URL、大图保留原相对地址；测试后已删除临时文件。
5. **快捷键误触发**：通过。焦点在查找输入框内、设置对话框打开时按 Ctrl+Shift+E 均不复制、无提示；设置「文件」分组可见 `Ctrl + Shift + E · 复制 HTML…`。

**发现并修复**：`copyActiveAsHtml` 原先在等待 `renderMarkdownToHtml` 之后才读取当前文档路径；若渲染期间切到另一篇笔记，`inlineLocalImages` 会把旧文档 HTML 里的相对图片按新文档目录解析，导致内联失败或指向错误图片。修复：按下快捷键时先快照 `root` / `docPath`，再传给 `inlineLocalImages`（`src/app/Toolbar.tsx`，约 8 行）。复测整篇复制仍为 3 张图片内联、0 个 `feiyeimg`。

**遗留 / 下一轮建议**：
- 分栏模式下在预览区选中文本再按 Ctrl+Shift+E，仍复制整篇（第 145 轮只排除了纯预览模式），提示也仍是整篇。属于体验不一致，修法需从预览 DOM 选区生成 HTML 并处理 `feiyeimg` 图片，工作量 M，另立需求。
- 改 Rust 后仍需重启 `bun run tauri dev`；剪贴板富文本在邮件 / Word 里的实际外观需人工确认。

**改动**：`src/app/Toolbar.tsx`（约 8 行）。

**人工复现步骤**：
- 打开含本地图片的笔记按 Ctrl+Shift+E，粘到邮件或 Word 应看到图片，提示带「N 张本地图片已内联」。
- 选中一两行再按，只有所选内容进剪贴板，提示为「所选内容已复制…」。
- 把某张图换成超过 4 MB 的文件再复制，该图保留原地址并提示「1 张本地图片在应用外可能无法显示」。
- 查找框内或设置对话框打开时按 Ctrl+Shift+E 不应复制。
- 无笔记时按钮置灰，按键提示先打开笔记。

---

## 第 147 轮 · 2026-10-30 15:33
**用户需求**：把笔记里的截图用「复制 HTML」贴进邮件或公众号后，收件人看到的是裂图 → 第 146 轮只提示了「可能无法显示」，问题还在 → 希望复制时就把本地图片一并带上，单张别太大，超限的再保留原地址并提示。

**产品经理**：做。把图片内联进剪贴板是「导出 HTML / 复制 HTML」的自然收尾，不落盘、不新增依赖，图片仍只从当前工作区读取，符合「本地优先、数据安全」。4 MB 上限避免剪贴板与正文被撑爆，超限或读取失败回落到第 146 轮的提示，不静默丢图。

**前端**：影响 `src/app/Toolbar.tsx`（新增 `inlineLocalImages`：解析预览 HTML 里的相对 / 根路径图片，逐个 `invoke("read_image_data_url")` 换成 data URL；成功数与剩余本地图片数一起写进提示）。风险：仅处理 `img[src]` 且跳过 http(s) / data / blob，远程图片不动；单张失败只保留原地址，不阻断复制。工作量 S。

**后端**：影响 `src-tauri/src/commands/image_asset.rs`（新增 `read_image_data_url`：`normalize_rel` + `resolve_in_workspace` 做工作区边界校验，扩展名白名单 png/jpg/jpeg/gif/webp/avif/bmp/ico，只读、不写盘；超过 4 MB、非图片或不存在返回 `None`，交由前端保留原地址）、`src-tauri/src/lib.rs`（注册命令）。风险：沿用现有路径校验，无新增文件系统写行为；新增单元测试覆盖小图成功、超大 / 非图片 / 不存在跳过、`..` 越界报错。工作量 S。

**裁决**：做

**改动**：`src-tauri/src/commands/image_asset.rs`、`src-tauri/src/lib.rs`、`src/app/Toolbar.tsx`（3 个文件，约 115 行，含 15 行单元测试）

**构建**：通过（`bun run build` 538ms，含 tsc）；`cargo test` 32 passed / 0 failed（新增 `inlines_small_images_and_skips_large_or_unsupported`）。

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`）整页刷新后停在 `写作示例.md`。①直接 `invoke("read_image_data_url", {relPath:"assets/小图.png"})` 返回 `data:image/png;base64,…`（10,858 字节）；②按 Ctrl+Shift+E，提示为「HTML 已复制，可直接粘贴到邮件或公众号草稿（3 张本地图片已内联）」；③PowerShell 读取剪贴板 `HTML Format`：`data:image/` 出现 3 次、`feiyeimg` 0 次、3 个 `<img>`，整篇 HTML 约 111 KB。人工复现：打开含本地图片的笔记复制 HTML，粘贴到邮件 / Word 应能直接看到图；把某张图换成超过 4 MB 的文件再复制，该图保留原地址且提示「（1 张本地图片在应用外可能无法显示）」。改完 Rust 源码需重启 `bun run tauri dev`，前端改动请整页刷新。

---

## 第 146 轮 · 2026-10-30 15:29
**用户需求**：笔记里的截图用「复制 HTML」贴进邮件后是裂图 → 现在提示只说复制成功，让人以为整篇都能用，也不知道坏的是哪些 → 希望复制时就说明有本地图片、在应用外可能看不到，别等到收件人发现。

**产品经理**：做。把「本地图片离开应用会失效」这件事当场说清楚，属于第 143–145 轮复制 HTML 的诚实补全；真正把图片内联成 data URL 需要前端读到图片字节，而现有 `feiyeimg` 协议响应不带 CORS、`read_file` 只返回 UTF-8 文本，必须新增后端命令（或放宽协议跨域）——**延后**，另立条目：后端新增受工作区限制的「读取图片为 data URL」命令（带大小上限），前端复制时逐张替换并限制总大小。

**前端**：影响 `src/lib/images.ts`（新增 `countLocalImages`，从渲染后的 HTML 统计非 http(s)/data/blob 的 `<img>`）、`src/app/Toolbar.tsx`（复制成功提示末尾补「（N 张本地图片在应用外可能无法显示）」）。风险：只做提示、不改剪贴板内容；远程图片与 data URL 不计入；数字来自本次渲染结果。工作量 S（2 个文件，约 18 行）。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/lib/images.ts`、`src/app/Toolbar.tsx`

**构建**：通过（bun run build，543ms，含 tsc）。

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`）整页刷新后打开 `写作示例.md`（含 3 张本地图片），按 Ctrl+Shift+E，提示为「HTML 已复制，可直接粘贴到邮件或公众号草稿（3 张本地图片在应用外可能无法显示）」。人工复现：打开含本地图片的笔记复制 HTML，提示应带图片张数；打开不含本地图片的笔记，提示保持原文案、不出现括号。改完源码请重启或整页刷新应用，避免 HMR 留下旧模块。

---

## 第 145 轮 · 2026-10-30 15:25
**用户需求**：写长文档时只想把其中一小节贴进邮件或群里 → 现在点「复制 HTML」总是整篇复制，选中正文也不起作用 → 希望选中时只复制所选部分，没选中仍整篇，提示能说清复制的是哪一块。

**产品经理**：做。这是第 143 轮「复制 HTML」的自然补全，复用同一渲染管线，只在调用前截取选区，不新增界面或依赖，符合「快、安静」。另评估 README「计划中 · 导出 HTML」落盘：`write_file` 用 `ensure_markdown` 强制 `.md` 且 `resolve_in_workspace` 仅限工作区内，保存到用户选中位置需新增 Rust 命令或放开扩展名校验与工作区边界（超 S 级），**延后，拆成两步**：①后端新增导出写入命令（任意路径 + 原子写 + 覆盖确认）；②前端接 `dialog:save` 与工具栏「导出 HTML」入口。

**前端**：影响 `src/app/Toolbar.tsx`（`copyActiveAsHtml` 读取编辑器主选区，非预览模式且选区非空时只渲染所选 Markdown；提示区分「所选内容已复制」与整篇；按钮提示补充说明）。风险：预览模式可能残留旧选区，因此该模式下固定整篇复制；选区超过 1 MB 由 `renderMarkdownToHtml` 现有上限拒绝。工作量 S（1 个文件，约 22 行）。

**后端**：本轮无改动；导出落盘结论见上。工作量 0。

**裁决**：做

**改动**：`src/app/Toolbar.tsx`

**构建**：通过（bun run build，660ms，含 tsc）。

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`）整页刷新后在 `写作示例.md` 实测。①用真实鼠标拖选正文「带说明的窄图：」，按 Ctrl+Shift+E，提示为「所选内容已复制为 HTML，可直接粘贴到邮件或公众号草稿」；PowerShell `Get-Clipboard -Raw` 只读出所选这一行。②不选任何文本再按 Ctrl+Shift+E，提示仍为「HTML 已复制…」，剪贴板是整篇正文（含标题、表格、代码块）。人工复现：打开任意笔记，拖选一两行后按 Ctrl+Shift+E 粘贴到邮件，应只有所选部分；清掉选区再按一次应复制整篇。改完源码请重启或整页刷新应用，避免 HMR 留下旧模块。

## 第 144 轮 · 2026-10-30 15:22
**用户需求**：工具栏的「复制 HTML」很好用，但我一直是键盘写作，手不离键盘；翻设置里的快捷键表也找不到它，好像这个功能只能用鼠标点。

**产品经理**：做。给已有动作补快捷键并写进快捷键表，不新增界面或数据结构，符合「快、安静」；选 Ctrl+Shift+E：E 对应导出 / 复制，且现有应用快捷键、CodeMirror 格式键位与浏览器默认都未占用（Ctrl+Shift+C 在 WebView2 / Edge 里是「检查元素」，主动避开）。

**前端**：影响 `src/app/Toolbar.tsx`（导出 `copyActiveAsHtml`，按钮提示补上键位）、`src/app/App.tsx`（`case "e"` 里 Shift 分支调用复制 HTML，无笔记时提示）、`src/features/settings/SettingsDialog.tsx`（「文件」分组加一行）。风险：与 Ctrl+E 共用一个 case，Shift 分支先于视图切换判断；输入框中沿用现有全局快捷键过滤。工作量 S（约 15 行）。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/Toolbar.tsx`、`src/app/App.tsx`、`src/features/settings/SettingsDialog.tsx`

**构建**：通过（bun run build，559ms，含 tsc）。

**验证**：CDP（9222）整页刷新后，打开笔记按 Ctrl+Shift+E，出现提示「HTML 已复制，可直接粘贴到邮件或公众号草稿」；Ctrl+, 打开设置，「文件」分组可见 `Ctrl + Shift + E`。人工复现：打开任意笔记按 Ctrl+Shift+E，粘贴到邮件应保留排版；未打开笔记时按该键应提示「先打开一篇笔记再复制 HTML」。

---

## 第 143 轮 · 2026-10-30 15:20
**用户需求**：笔记写完想发到邮件或公众号草稿，现在只能复制 Markdown 源码，或在预览里手动选中文字，代码块、表格和公式的排版一过剪贴板就没了；希望工具栏能一键把当前笔记按预览排版复制成 HTML，直接粘贴就能用。

**产品经理**：做。这是 README「计划中 · 导出 HTML」的第一步：复用实时预览同一套渲染管线，只写剪贴板、不落盘、不新增依赖，也不扩大产品边界；立刻能贴进邮件 / 公众号草稿，符合「本地优先、安静」的原则。

**前端**：影响 `src/app/Toolbar.tsx`（文件操作组在「另存为」右侧加「复制 HTML」，无笔记时置灰）、`src/features/preview/preview-controller.ts`（新增 `renderMarkdownToHtml`，与预览共用 Worker，导出请求使用独立 id 区间，不打断预览；Worker 崩溃时一并拒绝挂起的导出）、`src/lib/clipboard.ts`（新增 `copyHtml`，先用隐藏 contenteditable + `execCommand("copy")` 写入富文本与纯文本两份，失败再退回现有 `copyText`）。风险：文档超过 1 MB 时与预览一致拒绝并提示；连续点击以最后一次导出为准；`execCommand` 在 WebView2 中已验证可用。工作量 S（3 个文件，约 110 行，略超 80 行预算，但没有拆出第 4 个文件）。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/Toolbar.tsx`、`src/features/preview/preview-controller.ts`、`src/lib/clipboard.ts`

**构建**：通过（bun run build，528ms，含 tsc）。

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`，整页刷新后测试）。打开 `写作示例.md`，用真实鼠标点击工具栏「复制 HTML」，出现提示「HTML 已复制，可直接粘贴到邮件或公众号草稿」。PowerShell 读取剪贴板：`HTML Format` 存在（约 48,970 字节），含 `<h1>`、`<pre>`、`<table>`、Shiki 高亮与 `color: rgb(...)` 行内样式、KaTeX 节点；纯文本 flavor 是可读正文（「写作示例 / 这一篇把常用的 Markdown 写法…」），不是 Markdown 源码或 HTML 标签。另在 `CaseTest.md` 上复测，复制内容与当前文档一致。注：改完源码后 HMR 会留下新旧模块实例，`getEditorText` 可能读到空；整页刷新后按钮工作正常，人工复测请先重启或刷新应用。

**人工复现步骤**：
- 打开任意笔记，点工具栏「复制 HTML」，出现成功提示后把内容粘贴到支持富文本的编辑器（邮件、公众号草稿、Word），应保留标题层级、列表、表格、代码块配色与公式。
- 粘贴到纯文本框时得到可读正文，而不是 `# 标题` 或 `<h1>` 源码。
- 没有打开笔记时按钮置灰；超过 1 MB 的文档会提示「文档超过 1 MB，无法生成 HTML。」。
- 连续快速点两次按钮，不应出现卡死或旧内容覆盖新内容。

---

## 第 142 轮 · 2026-10-30 15:11（检验轮）
**范围**：回归第 137–141 轮导航改动——工具栏「返回」、Alt+←、会话级浏览历史、Alt+→ 前进栈、工具栏「前进」与快捷键表。不实现新功能。

**构建**：`bun run build` 通过（660ms，含 tsc）。本批未改 `src-tauri/`，`cargo check` 作为基线通过（1.83s）。

**逐项结果**（CDP 9222，工作区 `D:\clawWorkSpeace\新建文件夹`）：
1. **A→B→C 逐级退回 / 前进**：通过。依次打开 `README.md` → `写作示例.md` → `长文档.md` 后连按 Alt+←，路径逐级回到 `写作示例.md` → `子目录/README.md` → `子目录/笔记.md`；再连按 Alt+→ 原路走回 `写作示例.md` → `长文档.md`。每次按键 `defaultPrevented` 均为 true。注：会话中已有更早历史，首次测量多退了一步，属栈内既有条目，不是异常。
2. **栈用尽无动作**：通过。继续按 Alt+← 直到「返回」置灰（共 6 步），再按一次路径不变、按钮仍灰；「前进」置灰时按 Alt+→ 同样不变，事件仍 `preventDefault`（拦住 WebView 后退）。
3. **新打开清空前进栈**：通过。退到 `写作示例.md` 后（前进栈顶 `长文档.md`）从文件树打开 `CaseTest.md`，前进按钮立即置灰、提示「还没有可前进的笔记」，Alt+→ 无动作。
4. **工具栏按钮**：通过。鼠标点「返回」回到 `写作示例.md`，「前进」同步变为可点且提示 `CaseTest.md`；再点「前进」回到 `CaseTest.md`，按钮重新置灰。各步按钮置灰状态、悬停目标与栈顶一致。
5. **快捷键表**：通过。Ctrl+, 打开设置，「视图与查找」中存在 `Alt + ← / Alt + →` 行，说明为「浏览历史里后退 / 前进」。
6. **切换工作区清空历史**：代码级确认。`openWorkspaceAt` / `restoreLastWorkspace` 均调用 `setWorkspace`，其中 `history`、`forward` 一并重置为空；原生「打开文件夹」对话框无法自动化，留人工步骤。

**发现并修复**：前进栈里的文件被改名 / 删除后，Alt+→ 会反复报「打开文件失败」，而返回栈在同样情况下会自动摘掉失效条目。修复：`src/stores/workspace.ts` 新增 `forgetForward(relPath)`；`src/features/workspace/workspace-actions.ts` 在 `openFile` 失败分支同时调用，让它和 `forgetHistory` 一样摘掉失效路径。复测：`CaseTest.md` → `写作示例.md` → `长文档.md` 后 Alt+← 两次，把 `写作示例.md` 在应用外改名，按 Alt+→ 第一次报错后按钮自动指向 `长文档.md`，再按一次正常打开；文件已改回原名，工作区无残留。

**改动**：`src/stores/workspace.ts`、`src/features/workspace/workspace-actions.ts`（约 12 行）。

**人工复现步骤**：
- 打开 A → B → C，连按 Alt+← 应逐级退回，Alt+→ 应逐级前进；退到尽头按钮置灰、按键无动作。
- 退到 A 后从文件树打开 D，再按 Alt+→ 应无动作，「前进」置灰。
- 悬停「返回 / 前进」时应显示目标路径，与实际栈一致。
- Ctrl+, 的设置「视图与查找」里应看到 `Alt + ← / Alt + → · 浏览历史里后退 / 前进`。
- 打开 A → B 后退回 A（前进栈顶 B），在应用外把 B 改名，按 Alt+→ 应报一次错后按钮改为指向下一个可前进项（或置灰），不再每次重试同一条失效路径。
- 用 Ctrl+O 切到另一个工作区再切回，历史与前进栈应为空（「返回 / 前进」均置灰），文件不受影响。

---

## 第 141 轮 · 2026-10-30 15:07
**用户需求**：退回上一篇之后想回到刚才那篇，知道 Alt+→ 的人还能按键盘，可工具栏只有「返回」没有「前进」，鼠标用户只能去文件树里重新找；翻设置里的快捷键表也只写着 Alt+←，看不出还有前进。

**产品经理**：做。第 140 轮已经有前进栈，缺的是让这个动作被发现：工具栏给一个与「返回」并列的「前进」，快捷键表把两者写在一行；不新增数据结构、不改交互模型，符合「安静、快」的原则。

**前端**：影响 `src/app/Toolbar.tsx`（文件操作组在「返回」右侧加「前进」文字按钮，读 `forward` 栈顶决定禁用与悬停目标，点击调用 `openNextDocument`）、`src/features/settings/SettingsDialog.tsx`（「视图与查找」里的 Alt+← 一行改为 `Alt + ← / Alt + →`，说明「浏览历史里后退 / 前进」）。风险：无前进目标时按钮置灰并说明原因；沿用已有 `.toolbar-text-btn` 样式，无需改 CSS。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/Toolbar.tsx`、`src/features/settings/SettingsDialog.tsx`

**构建**：通过（bun run build，601ms）

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`，每步间隔 900ms）。当前 `子目录/笔记.md` 时「前进」置灰、提示「还没有可前进的笔记」；按 Alt+← 退回 `长文档.md` 后「前进」可点、提示目标为 `子目录/笔记.md`；按 Alt+→ 回到 `子目录/笔记.md`，事件 `defaultPrevented` 为 true，「前进」重新置灰。再从 Alt+← 退到 `长文档.md`，用鼠标点「前进」也回到 `子目录/笔记.md`。Ctrl+, 打开设置，「视图与查找」里能看到「Alt + ← / Alt + → · 浏览历史里后退 / 前进」。人工复现：打开 A → B，Alt+← 回 A 后工具栏「前进」应可点并回到 B；新打开一篇 C 后「前进」应置灰。

---

## 第 140 轮 · 2026-10-30 15:06
**用户需求**：按 Alt+← 退回后想再回到刚才那篇，只能去文件树里重新找；浏览器里退一步之后 Alt+→ 就能原路走回来，编辑器里按 Alt+→ 却毫无反应。

**产品经理**：做。第 139 轮已经有了会话级后退，缺的只是对称的前进；前进栈只在「返回 / 前进」之间移动，任何一次新的打开都会清空它，不会把旧分支混进来，不新增界面、不落盘，符合「安静、快」的原则。

**前端**：影响 `src/stores/workspace.ts`（新增 `forward` 栈与 `pushForward` / `popForward` / `clearForward`，换库时清空，沿用 50 步上限）、`src/features/workspace/workspace-actions.ts`（新增 `forwardDocumentPath` / `openNextDocument`；`openPreviousDocument` 成功退一步后把刚离开的文档压入前进栈；`openFile` 走正常打开时清空前进栈）、`src/app/App.tsx`（Alt+→ 与 Alt+← 对称处理并 `preventDefault`）。风险：连续快速按键时异步读盘可能重复入栈，与第 139 轮同一类边界；本轮为守住 3 个文件的预算，没有新增工具栏「前进」按钮，快捷键表也待下一轮补。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/stores/workspace.ts`、`src/features/workspace/workspace-actions.ts`、`src/app/App.tsx`

**构建**：通过（bun run build，527ms）

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`），每步间隔 800ms。依次打开 `README.md` → `长文档.md`，Alt+← 退到 `README.md`、再退到起点的 `子目录/笔记.md`，第三次无动作；Alt+→ 依次回到 `README.md`、`长文档.md`，第三次无动作（前进栈用尽）。随后点开 `子目录/笔记.md`（新的打开会清空前进栈），再按 Alt+→ 仍停在 `子目录/笔记.md`；再 Alt+← 回到 `长文档.md`、Alt+→ 回到 `子目录/笔记.md`，后退 / 前进成对可用。每次按键 `defaultPrevented` 均为 true。人工复现：打开 A → B → C，Alt+← 两次到 A，Alt+→ 两次应回到 C；退到 A 后从文件树打开 D，再按 Alt+→ 应无反应。

---

## 第 139 轮 · 2026-10-30 15:03
**用户需求**：顺着链接 A → B → C 读下去，按一次 Alt+← 退回 B，再按一次却跳回了 C，像在两页之间来回弹；想一路退回 A 只能去文件树里找。

**产品经理**：做。「返回」应该是浏览器那样的后退，而不是最近两篇的切换；第 137 轮借用「最近打开」只是临时方案。改成会话内真正的浏览历史后，返回语义与按钮文字一致，不新增界面、不落盘、不扩大产品边界，符合「安静、快」的原则。

**前端**：影响 `src/stores/workspace.ts`（新增会话级 `history` 栈与 `pushHistory` / `popHistory` / `forgetHistory`，换库时清空，上限 50 步）、`src/features/workspace/workspace-actions.ts`（`openFile` 成功读盘后压入上一篇并支持 `recordHistory = false`；`previousDocumentPath` 读栈顶；`openPreviousDocument` 成功后才出栈，读盘失败时从历史中摘掉）、`src/app/Toolbar.tsx`（按钮状态改看 `history`，无历史时提示「本次会话里还没有打开过其他笔记」）。风险：重启后历史清空，按钮从灰色开始；被改名 / 移动的旧文档仍在历史里时退回会提示打开失败并自动摘除。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/stores/workspace.ts`、`src/features/workspace/workspace-actions.ts`、`src/app/Toolbar.tsx`

**构建**：通过（bun run build，534ms）

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`）。依次打开 `子目录/README.md` → `写作示例.md` → `长文档.md`，连按三次 Alt+←，状态栏路径依次回到 `写作示例.md` → `子目录/README.md` → `CaseTest.md`（不是来回跳），历史用尽后「返回」按钮置灰；Alt+← 事件 `defaultPrevented` 为 true。人工复现：沿链接打开 A → B → C，按 Alt+← 应依次退回 B、A；点工具栏「返回」行为相同；只有一篇时按钮置灰，悬停提示「本次会话里还没有打开过其他笔记」。

---

## 第 138 轮 · 2026-10-30 14:33
**用户需求**：沿链接读完一篇后想回上一页，眼睛还停在正文上，手却得去够工具栏点「返回」；浏览器里 Alt+← 就是后退，编辑器里也该有同一个键。

**产品经理**：做。「返回」已经解决导航本身，缺的只是键盘入口；Alt+← 是跨应用通行的「后退」语义，补上后读长文不用离开键盘，也不新增任何按钮或数据结构，符合「安静、快」的原则。

**前端**：影响 `src/app/App.tsx`（应用级 keydown 里处理 Alt+←，与工具栏「返回」共用 `previousDocumentPath` / `openPreviousDocument`，并 `preventDefault` 拦掉 WebView 自带后退）、`src/app/Toolbar.tsx`（悬停提示补 `Alt+←`）、`src/features/settings/SettingsDialog.tsx`（「视图与查找」分组新增一行）。风险：输入框内沿用既有规则不触发；没有上一篇时静默无动作，与按钮置灰一致；macOS 上 Option+← 原生是「按词左移」，本窗口以 Windows 为主要验证环境，后续如支持 macOS 再单独裁决。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/App.tsx`、`src/app/Toolbar.tsx`、`src/features/settings/SettingsDialog.tsx`

**构建**：通过（bun run build，619ms）

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`）。当前 `CaseTest.md` 时模拟 Alt+←，状态栏切到 `README.md`、工具栏提示变为「返回上一篇笔记 (Alt+←)：CaseTest.md」；再按一次回到 `CaseTest.md`，事件 `defaultPrevented` 为 true（不会触发 WebView 后退）。Ctrl+, 打开设置，「视图与查找」里能看到「Alt + ← 返回上一篇打开的笔记」。人工复现：打开 A、再打开 B → 按 Alt+← 应回到 A，再按回到 B；输入框内按 Alt+← 不跳转；只有一篇笔记时按了无反应。

---

## 第 137 轮 · 2026-10-30 14:24
**用户需求**：用相对链接在笔记之间跳来跳去读一章，读完想回到原来那篇，只能在文件树里一层层找回；链接跳转后没有「上一页」，读长文像走单行道。

**产品经理**：做。本地笔记库天然靠链接组织，链接能打开却回不去，导航只完成一半；「最近打开」已经按顺序记着刚看过的文档，复用它做一个「返回上一篇」入口即可，不新增数据结构、不扩大产品边界，符合「安静、快」的原则。

**前端**：影响 `src/features/workspace/workspace-actions.ts`（新增 `previousDocumentPath` / `openPreviousDocument`，复用 `openFile` 的未保存守卫与目录展开）、`src/app/Toolbar.tsx`（文件操作组最左侧加「返回」文字按钮，无上一篇时置灰，悬停显示目标路径）。风险：最近打开只保留 5 条，超过则返回更早那篇；连续点两次会在最近两篇之间切换，与「上一篇」字面一致。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/workspace/workspace-actions.ts`、`src/app/Toolbar.tsx`

**构建**：通过（bun run build，602ms）

**验证**：CDP（9222，工作区 `D:\clawWorkSpeace\新建文件夹`）。打开 `写作示例.md` 后点工具栏「返回」，状态栏路径变为 `README.md`、标题栏同步，按钮提示「返回上一篇笔记：写作示例.md」；再点一次回到 `写作示例.md`。人工复现：打开两篇笔记（先 A 后 B）→ 工具栏最左侧「返回」→ 应打开 A，路径与标题同步；只有一篇或未打开笔记时按钮置灰。

---

## 第 136 轮 · 2026-10-30 15:45
**用户需求**：想查加粗的快捷键，在「文件」分组里翻了半天才看到 Ctrl+B，还在同一行讲了收起侧栏；查一个格式键不该跑到文件那一栏去找。

**产品经理**：做。快捷键表的分组就是检索路径；Ctrl+B 的主语义是加粗，归到「格式」，侧栏那一半放到「视图与查找」并注明光标不在正文时。

**前端**：影响 `src/features/settings/SettingsDialog.tsx`（Ctrl+B 条目拆分并移动到对应分组）。风险：无。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/settings/SettingsDialog.tsx`

**构建**：通过（bun run build，516ms）

---


## 第 135 轮 · 2026-10-30 15:43
**用户需求**：设置里的快捷键表有一行写着「Ctrl + 1 … 6 / Ctrl + 0 — 标题级别 / 正文」，扫过去像在说 Ctrl+0 也是其中一级，想回正文时不敢按。

**产品经理**：做。快捷键表是用来看懂键位的，一行塞两种语义反而看不懂；拆成「Ctrl + 1 … 6 → 标题 1–6 级」和「Ctrl + 0 → 转回正文段落」。

**前端**：影响 `src/features/settings/SettingsDialog.tsx`（「格式」分组拆行）。风险：无。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/settings/SettingsDialog.tsx`

**构建**：通过（bun run build，521ms）

---


## 第 134 轮 · 2026-10-30 15:41
**用户需求**：刚装好、还没选文件夹时，界面上写着「未打开工作区」，可它只是行灰字，点不动；我盯着它想知道下一步该做什么。

**产品经理**：做。空状态的第一行文字应当是入口而不是说明；这里最自然的动作就是打开文件夹，和 Ctrl+O 同一件事。

**前端**：影响 `src/app/StatusBar.tsx`（无工作区时把「未打开工作区」换成「未打开工作区 · 打开文件夹」按钮，点击调用 `chooseWorkspace`）。风险：无，复用已有 `.status-path-button` 样式。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/StatusBar.tsx`

**构建**：通过（bun run build，507ms）

---


## 第 133 轮 · 2026-10-30 15:39
**用户需求**：隔天打开昨天写过的笔记，状态栏只写「已保存 10/29」，看不出是昨晚还是前天早上存的；要判断有没有丢修改只能去悬停。

**产品经理**：做。保存时间是判断「这份内容新不新」的第一眼线索，日期旁边补上时分，一行字就够。

**前端**：影响 `src/app/StatusBar.tsx`（`formatSavedAt` 非当天也带 `HH:mm`）。风险：状态栏宽度略增，文案仍在常规长度内。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/StatusBar.tsx`

**构建**：通过（bun run build，518ms）

---


## 第 132 轮 · 2026-10-30 15:37
**用户需求**：第一次打开应用、还没选工作区时按 Ctrl+N，没有任何反应；和刚才 Ctrl+S 的情况一样，看不出是没东西可新建。

**产品经理**：做。新建依赖工作区，空状态下说一句「先打开一个工作区再新建笔记」，把入口指回真正缺的那一步。

**前端**：影响 `src/app/App.tsx`（Ctrl+N 无工作区时给出提示）。风险：无。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/App.tsx`

**构建**：通过（bun run build，543ms）

---


## 第 131 轮 · 2026-10-30 15:35
**用户需求**：刚打开工作区、还没点开任何笔记时按 Ctrl+S，什么提示都没有；不像 Ctrl+E / Ctrl+F 会告诉我先打开一篇。

**产品经理**：做。三个快捷键的空状态行为要一致；Ctrl+S 是最常用的键，没反应最容易被当成"存不上"。

**前端**：影响 `src/app/App.tsx`（无当前文档时提示「先打开一篇笔记再保存」，Ctrl+Shift+S 一并覆盖）。风险：无。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/App.tsx`

**构建**：通过（bun run build，517ms）

---


## 第 130 轮 · 2026-10-30 15:33
**用户需求**：把图片放大以后底部只剩一个百分比，原先那句「滚轮缩放 · Esc 关闭」不见了，不知道该怎么缩回去，也不敢按 Esc 怕连图片一起关了。

**产品经理**：做。操作提示一旦消失，用户就只能靠试；放大状态下换成「滚轮可调回 100% · Esc 关闭」，既说明怎么恢复，也说明 Esc 只会关浮层。

**前端**：影响 `src/features/preview/PreviewPane.tsx`（提示行常驻，按当前缩放切换文案）。风险：无。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/preview/PreviewPane.tsx`

**构建**：通过（bun run build，515ms）

---


## 第 129 轮 · 2026-10-30 15:31
**用户需求**：预览里只有一张图、又没写替代文字时，用滚轮把它放大，画面是变大了，可底部什么都不显示，不知道现在放大到几倍；图片多的时候才看得到百分比。

**产品经理**：做。缩放的反馈不该取决于这张图是不是"图组里的一员"；单图放大到 400% 还以为是原尺寸，容易误判。

**前端**：影响 `src/features/preview/PreviewPane.tsx`（状态行改为始终渲染，张数 / 百分比按需拼接，单图缩放也显示 `125%` 这类比例）。风险：无。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/preview/PreviewPane.tsx`

**构建**：通过（bun run build，529ms）

---


## 第 127 轮 · 2026-10-30 15:26
**用户需求**：专注模式里把鼠标移到标题栏的侧栏按钮上，提示还是「收起侧栏」，可它实际上会退出专注，说法和结果对不上。

**产品经理**：做。上一轮让这个按钮在专注模式下有了新含义，提示也要跟着换；悬停文案是用户判断"点下去会怎样"的唯一线索。

**前端**：影响 `src/app/TitleBar.tsx`（专注模式下按钮提示改为「退出专注模式并显示侧栏」）。风险：无。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/TitleBar.tsx`

**构建**：通过（bun run build，519ms；实现与第 128 轮改动同批提交）

---


## 第 128 轮 · 2026-10-30 15:27
**用户需求**：新建、另存为或重命名时，输入的名字正好和目录里已有的文件重名，对话框照样关掉，过一会儿弹出「目标已存在」，只能从头再来。期望在输入框里就提示重名。

**产品经理**：做。命名冲突是最常见的输入错误，能在输入阶段发现就不该等后端拒绝；只查已经加载到树里的同级条目，未加载的目录仍由后端兜底，不会误拦。

**前端**：影响 `src/features/workspace/workspace-actions.ts`（新增同名检查，接入新建、新建文件夹、另存为与重命名；重命名排除自身，只改大小写不受影响）。风险：目录尚未加载时不提示，行为与之前一致。工作量 S。

**后端**：无改动（仍保留 `already-exists` 兜底）。工作量 0。

**裁决**：做

**改动**：`src/features/workspace/workspace-actions.ts`

**构建**：通过（bun run build，524ms）

---


## 第 126 轮 · 2026-10-30 15:24
**用户需求**：专注模式里想打开侧栏，点了标题栏左上角那个侧栏按钮，什么也没发生——它只是切换了被专注模式盖住的可见性。期望这个按钮和 Ctrl+B 一样管用。

**产品经理**：做。标题栏在专注模式下仍然可见，它的按钮却"看起来失灵"，和已经修过的 Ctrl+B 是同一个问题；让按钮走同一套逻辑，两处行为一致。

**前端**：影响 `src/app/TitleBar.tsx`（侧栏按钮：专注模式时退出专注并确保侧栏显示，否则照旧切换）。风险：非专注状态行为不变；按钮禁用条件不变。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/TitleBar.tsx`

**构建**：通过（bun run build，515ms）

---


## 第 125 轮 · 2026-10-30 15:21
**用户需求**：大图浮层加了滚轮缩放，可界面上没有任何提示，不试一下根本不知道；关闭方式也只有 Esc，鼠标用户容易卡住。

**产品经理**：做。新能力要能被发现；提示只在 100% 时出现，一开始缩放就淡出，不干扰看图。

**前端**：影响 `src/features/preview/PreviewPane.tsx`（浮层信息区在未缩放时补一行提示）、`src/features/preview/preview.css`（提示样式）。风险：已有说明 / 张数仍按原顺序显示。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/preview/PreviewPane.tsx`、`src/features/preview/preview.css`

**构建**：通过（bun run build，530ms）

---


## 第 124 轮 · 2026-10-30 15:18
**用户需求**：最近一直在调「视图与预览」里的设置，每次打开偏好面板都回到「外观排版」，要重新点一次分类。期望记住上次看的是哪一页。

**产品经理**：做。设置分类是"上次停在哪"的弱偏好，和侧栏标签、文件树展开一样值得记住；不再每次强制回到第一页，减少重复点击。

**前端**：影响 `src/features/settings/SettingsDialog.tsx`（打开时读取上次分类，点击分类时写回设置）。风险：读到未知分类时回退到第一页，旧版本数据不会出错。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/settings/SettingsDialog.tsx`

**构建**：通过（bun run build，525ms）

---


## 第 123 轮 · 2026-10-30 15:15
**用户需求**：文件树里能用 Shift+F10 叫出右键菜单，但这个键在任何地方都查不到，只能碰巧发现。期望快捷键表里列出来。

**产品经理**：做。上一批补的键盘能力都要在快捷键表里能查到，否则等于没做；F2 / Delete 已在表内，Shift+F10 补一行即可。

**前端**：影响 `src/features/settings/SettingsDialog.tsx`（「文件」分组补一行）。风险：无。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/settings/SettingsDialog.tsx`

**构建**：通过（bun run build，526ms）

---


## 第 122 轮 · 2026-10-30 15:12
**用户需求**：设置里有五个分类，用方向键一个个挪太慢；按 Home / End 想直接到第一个或最后一个，没有反应。

**产品经理**：做。上一轮给标签页补了左右方向键，Home / End 是同一套键盘约定的另一半；补上之后侧栏的文件 / 大纲两个标签也不吃亏。

**前端**：影响 `src/features/settings/SettingsDialog.tsx` 与 `src/features/workspace/WorkspaceSidebar.tsx`（标签页按键扩展 Home / End）。风险：焦点不在标签上时不拦截。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/settings/SettingsDialog.tsx`、`src/features/workspace/WorkspaceSidebar.tsx`

**构建**：通过（bun run build，517ms）

---


## 第 121 轮 · 2026-10-30 15:09
**用户需求**：设置了「隐藏扩展名」，文件树和「最近打开」都只剩标题，可窗口标题 / 任务栏里还挂着 `.md`，同一篇笔记三个地方三种写法。

**产品经理**：做。偏好既然是"显示时不带扩展名"，窗口标题也属于展示层，一并跟随；真实文件名在树行的悬停与重命名框里仍然完整可见。

**前端**：影响 `src/app/App.tsx`（窗口标题复用同一显示名处理，偏好变化时重设标题）。风险：重命名与磁盘操作不受影响。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/App.tsx`

**构建**：通过（bun run build，525ms）

---


## 第 120 轮 · 2026-10-30 15:06
**用户需求**：空页面上按 Ctrl+F，没有任何反应——和 Ctrl+E、Ctrl+Shift+F 的问题一样，不知道是没打开笔记还是快捷键失效。

**产品经理**：做。三个依赖"当前笔记"的快捷键现在口径一致：没有笔记时都提示"先打开一篇笔记再…"，不再静默。

**前端**：影响 `src/app/App.tsx`（Ctrl+F 无笔记时提示）。风险：有笔记时的查找行为不变。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/App.tsx`

**构建**：通过（bun run build，522ms）

---


## 第 119 轮 · 2026-10-30 15:03
**用户需求**：没选笔记时按 Ctrl+E 想切到阅读视图，什么也没发生；和上一轮的专注快捷键一样，容易怀疑快捷键坏了。

**产品经理**：做。这两个键都依赖"当前有一篇笔记"，没有时就该说清楚；提示文案统一成"先打开一篇笔记再…"。

**前端**：影响 `src/app/App.tsx`（Ctrl+E 在没有打开笔记时提示）。风险：无。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/App.tsx`

**构建**：通过（bun run build，521ms）

---


## 第 118 轮 · 2026-10-30 15:00
**用户需求**：刚打开库还没选笔记时按 Ctrl+Shift+F，界面没任何变化，以为快捷键坏了或者没生效。期望至少说一句为什么进不去。

**产品经理**：做。上一轮把"没有笔记不能进专注"作为约束，但静默忽略等于没解释；补一句提示，和 Ctrl+F 没有笔记时的处理态度一致。

**前端**：影响 `src/app/App.tsx`（快捷键命中但没有打开笔记时提示「先打开一篇笔记再进入专注模式」）。风险：工具栏按钮此时是禁用态，不会触发这条提示。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/App.tsx`

**构建**：通过（bun run build，513ms）

---


## 第 117 轮 · 2026-10-30 14:57
**用户需求**：磁盘临时断开或权限变化时，整个工作区根目录读不出来，文件树一片空白，看着像库被清空了；此时也没有重试的地方。

**产品经理**：做。上一轮补上了子目录的失败提示，根目录是同一类情况，而且更吓人（看起来像整个库没了）；提示与重试按钮沿用同一套样式。

**前端**：影响 `src/features/workspace/WorkspaceSidebar.tsx`（根目录无子项、未在加载且标记失败时显示「读取工作区目录失败 · 重试」，重试走现有的刷新流程）。风险：正常空库仍显示「新建第一篇」引导。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/workspace/WorkspaceSidebar.tsx`

**构建**：通过（bun run build，527ms）

---


## 第 116 轮 · 2026-10-30 14:54
**用户需求**：展开一个没有权限或刚被外部删掉的文件夹，树里只多出一块空白，看着像"空文件夹"；提示一闪而过，想再试也没有入口。

**产品经理**：做。读目录失败与"目录里没东西"是两件事，前者必须能看出来、也能就地重试；提示条只在真正失败过之后出现，不会在启动加载瞬间闪一下。

**前端**：影响 `src/stores/workspace.ts`（记录每个目录的读取失败状态，成功时清掉）、`src/features/workspace/WorkspaceSidebar.tsx`（失败且无子项时显示「读取失败，重试」，复用空状态的动作样式）。风险：重试成功后提示自动消失；其他目录照常。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/stores/workspace.ts`、`src/features/workspace/WorkspaceSidebar.tsx`

**构建**：通过（bun run build，521ms）

---


## 第 115 轮 · 2026-10-30 14:51
**用户需求**：状态栏那个「专注」小标签，用读屏只被念成"专注"，听不出点它是退出还是进入专注模式。

**产品经理**：做。标签的视觉文字求短，可访问名称要说清楚动作；视觉与提示不变，只补 `aria-label`。

**前端**：影响 `src/app/StatusBar.tsx`（按钮补「退出专注模式」可访问名称）。风险：无。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/StatusBar.tsx`

**构建**：通过（bun run build，523ms）

---


## 第 114 轮 · 2026-10-30 14:48
**用户需求**：另存为之后界面安静地切到了副本，不确定文件到底建没建、建在哪一层目录；去树里找又容易看花。期望成功时给一句提示，带上路径。

**产品经理**：做。另存为是一次会改变"当前文件是谁"的操作，结果需要显式确认；提示里带相对路径，正好回答"存哪了"。

**前端**：影响 `src/features/workspace/workspace-actions.ts`（刷新并展开目标目录后弹出提示）。风险：写入失败仍走原有的错误提示。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/workspace/workspace-actions.ts`

**构建**：通过（bun run build，517ms）

---


## 第 113 轮 · 2026-10-30 14:45
**用户需求**：在文件树里按 F2 改完名字，焦点又跑到正文去了；一次要整理十来篇，每次都得回来点一下。期望改完还停在树里刚才那行的位置。

**产品经理**：做。和上一轮的删除是同一类"键盘流断档"：改名会让这一行重建，旧焦点元素失效，需要按位置重新聚焦；取消时上一轮的兜底仍在，两处都顺。

**前端**：影响 `src/features/workspace/WorkspaceSidebar.tsx`（F2 处理记住行序号，改名完成后再聚焦同位置的行）。风险：重名失败或取消时行还在，聚焦到原行无副作用。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/workspace/WorkspaceSidebar.tsx`

**构建**：通过（bun run build，558ms）

---


## 第 112 轮 · 2026-10-30 14:42
**用户需求**：换了库还没打开笔记时，任务栏和 Alt-Tab 里两个窗口都只叫「扉页」，分不清哪个是哪个库。期望这时窗口标题显示库的名字。

**产品经理**：做。标题本来就承担"我在哪"的信息，没选笔记时补上库名是零成本的改进；打开笔记后仍以笔记名为主，未保存圆点不变。

**前端**：影响 `src/app/App.tsx`（标题回退顺序：笔记名 → 库名 → 扉页）。风险：无库时与原来一致。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/App.tsx`

**构建**：通过（bun run build，538ms）

---


## 第 111 轮 · 2026-10-30 14:39
**用户需求**：在文件树里用 Delete 删掉一篇，确认之后焦点就不知道去哪了，想接着删下一篇还得重新点回树里。期望删完焦点还停在原来的位置附近。

**产品经理**：做。上一轮把"取消对话框"的焦点接住了，删除成功后这一行本身消失，还缺一次"落到邻近行"的处理；连着整理笔记时才顺。

**前端**：影响 `src/features/workspace/WorkspaceSidebar.tsx`（删除前记住行序号，删除完成后聚焦同位置的行；末尾行被删则落到新的最后一行，树空了就不动）。风险：取消删除时仍聚焦原行，行为不变。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/workspace/WorkspaceSidebar.tsx`

**构建**：通过（bun run build，526ms）

---


## 第 110 轮 · 2026-10-30 14:36
**用户需求**：在文件树里按 F2 打开重命名，发现点错了按 Esc 取消，焦点却跳到正文去了——还得重新用鼠标点回那一行。期望取消后回到刚才那一行。

**产品经理**：做。之前的处理一律把焦点还给正文，对"从正文里打开的对话框"是对的，对文件树里发起的操作就断了键盘流；记住打开前的焦点、关掉时还回去，才两边都对。

**前端**：影响 `src/stores/ui.ts`（`ask` / `askInput` 记录打开前的焦点元素）、`src/components/Dialog.tsx`（关闭时优先还回原元素，已不存在再退回正文，设置面板仍不抢焦点）。风险：工具栏按钮在 mousedown 时已阻止聚焦，重命名 → 仍回到正文，体验不变。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/stores/ui.ts`、`src/components/Dialog.tsx`

**构建**：通过（bun run build，520ms）

---


## 第 109 轮 · 2026-10-30 14:33
**用户需求**：在查找框里搜索时，手顺按了 Ctrl+E / Ctrl+B，视图和侧栏跟着变了，搜索框还在但界面已经换了个样；这些按键在输入框里应该只是输输入框自己的事。

**产品经理**：做。全局快捷键应该以"编辑器有焦点"为语义，在输入框里抢键盘会打断输入；只保留随时都应该生效的保存，其它让给输入框。

**前端**：影响 `src/app/App.tsx`（全局按键处理里识别输入框 / 多行输入，除 Ctrl+S 外不响应）。风险：设置面板与重命名框本就由 `dialogOpen` 提前拦截，不受影响。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/App.tsx`

**构建**：通过（bun run build，527ms）

---


## 第 108 轮 · 2026-10-30 14:30
**用户需求**：一篇教程里连着插了好几张截图，点开放大后满屏都是图，分不清现在是"步骤二"还是"步骤三"；图片下面其实写过替代文字，却看不到。期望浮层底部把说明显示出来。

**产品经理**：做。替代文字本来就是写在 Markdown 里的说明，是给"看不到图时"读的，放大查看时把它显示出来正好复用；与张数、缩放比例叠放在底部同一处，不额外占界面。

**前端**：影响 `src/features/preview/PreviewPane.tsx`（浮层底部统一的信息区：说明 + 张数 / 缩放）、`src/features/preview/preview.css`（信息区纵向排列、说明单行省略）。风险：没有 alt 且只有一张图时底部不出现任何内容。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/preview/PreviewPane.tsx`、`src/features/preview/preview.css`

**构建**：通过（bun run build，528ms）

---


## 第 107 轮 · 2026-10-30 14:27
**用户需求**：长文开头写了「跳到某节」的锚点链接，鼠标悬上去什么提示都没有，不像外链和跨笔记链接那样能看到目标，点之前不知道会去哪。

**产品经理**：做。上一版给外链与跨笔记链接补了悬停提示，唯独 `#` 锚点被跳过了；这里补一句「跳转到「某节」」，和编辑区 Ctrl+点击的体验对齐。

**前端**：影响 `src/features/preview/PreviewPane.tsx`（锚点链接补 title，片段先做百分号解码，非法转义保留原文）。风险：用户自己写了 title 的仍不会被覆盖。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/preview/PreviewPane.tsx`

**构建**：通过（bun run build，521ms）

---


## 第 106 轮 · 2026-10-30 14:24
**用户需求**：点「恢复默认设置」时，确认框只列举了主题、字体、保存间隔和默认视图，但行号、行宽、隐藏扩展名其实也会被重置；说得不全，点下去心里没底。

**产品经理**：做。确认框的职责是把影响讲全；新增的偏好（行宽、行号、隐藏扩展名）没有补进文案，属于遗漏，改一句话就能对齐。

**前端**：影响 `src/features/settings/SettingsDialog.tsx`（确认文案补全选项）。风险：无。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/settings/SettingsDialog.tsx`

**构建**：通过（bun run build，523ms）

---


## 第 105 轮 · 2026-10-30 14:21
**用户需求**：笔记在子目录里时按 Ctrl+Shift+S 另存为，对话框只写「新文件名」，看不出副本会放到哪个文件夹，保存完才发现不在以为的地方。期望对话框上就写清楚保存位置。

**产品经理**：做。右键新建已经用"标题带目录"的做法解决同样的问题，另存为保持一致即可；只是文案，不新增交互。

**前端**：影响 `src/features/workspace/workspace-actions.ts`（标题与输入框标签带上所在目录，根目录时保持原样）。风险：无。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/workspace/workspace-actions.ts`

**构建**：通过（bun run build，528ms）

---


## 第 104 轮 · 2026-10-30 14:18
**用户需求**：用读屏软件跟着大纲往下读时，听不出当前写到了哪一节——视觉上有高亮，读屏却没有对应信息。

**产品经理**：做。大纲本来就用 `role="treeitem"` 表达层级，补一个 `aria-selected` 就能把"当前章节"告诉辅助技术，和文件树的处理保持一致。

**前端**：影响 `src/features/outline/OutlinePanel.tsx`（当前项加 `aria-selected`）。风险：无视觉变化。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/outline/OutlinePanel.tsx`

**构建**：通过（bun run build，534ms）

---


## 第 103 轮 · 2026-10-30 14:15
**用户需求**：在别的程序里加了几个文件，回到应用想刷新一下树，右键菜单里只有新建和显示，刷新按钮藏在右上角。期望右键就能刷新。

**产品经理**：做。刷新按的是"当前注视的位置"，放进右键菜单符合直觉；右上角按钮保留，两处都能用。

**前端**：影响 `src/features/workspace/WorkspaceSidebar.tsx`（右键菜单新增「刷新文件树」，调用文件树已有的刷新动作）。风险：菜单项多了一条，行与空白处的菜单都可用。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/workspace/WorkspaceSidebar.tsx`

**构建**：通过（bun run build，531ms）

---


## 第 102 轮 · 2026-10-30 14:12
**用户需求**：侧栏的「文件 / 大纲」和设置里的几个分类都是标签页样式，但按左右方向键没反应，只能再按 Tab 逐个跳。期望标签页之间能用方向键切换。

**产品经理**：做。这两处都声明了 `role="tablist"`，方向键切换是标签页的基本无障碍约定；补上之后外观与鼠标行为都不变。

**前端**：影响 `src/features/workspace/WorkspaceSidebar.tsx` 与 `src/features/settings/SettingsDialog.tsx`（在 tablist 上处理左右方向键，焦点跟随到目标标签并选中）。风险：焦点不在标签上时不拦截按键。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/workspace/WorkspaceSidebar.tsx`、`src/features/settings/SettingsDialog.tsx`

**构建**：通过（bun run build，576ms）

---


## 第 101 轮 · 2026-10-30 14:09
**用户需求**：大图打开后用 Tab 在翻页按钮之间切换，按两下焦点就跑到背后的编辑区去了，浮层还在最前面，键盘却已经不在它上面。期望 Tab 只在这个浮层里循环。

**产品经理**：做。上一轮把焦点收进了浮层，但 Tab 仍能穿出去；对话框与设置面板早就用的是同一个 `trapTab`，浮层沿用即可，行为一致。

**前端**：影响 `src/features/preview/PreviewPane.tsx`（浮层挂上 `trapTab`）。风险：单张图没有可聚焦按钮时 Tab 照常离开，不会卡住焦点。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/preview/PreviewPane.tsx`

**构建**：通过（bun run build，525ms）

---


## 第 100 轮 · 2026-10-30 14:06
**用户需求**：进入专注模式后过了一会儿，忘了当时的快捷键，界面上又没有任何可见的"退出"入口，只能去设置里翻快捷键表。期望专注模式本身在界面上留一个出口。

**产品经理**：做。专注模式按设计要收起工具栏，等于把入口一起藏了；状态栏本来就常驻，给它一个「专注」小标签，点一下就退出，既提示当前状态也给退路。

**前端**：影响 `src/app/StatusBar.tsx`（专注时在状态栏右侧显示可点击的「专注」标签）、`src/app/App.css`（标签样式与悬停反馈）。风险：不在专注模式时不渲染，状态栏宽度不变。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/StatusBar.tsx`、`src/app/App.css`

**构建**：通过（bun run build，528ms）

---


## 第 99 轮 · 2026-10-30 14:03
**用户需求**：点开大图后，焦点其实还留在背后的编辑区里，用键盘或读屏时浮层像是"贴"在页面上，看不出它在最前面；关掉以后焦点也不知道落在哪了。

**产品经理**：做。浮层本身就声明了 `role="dialog" aria-modal`，焦点却不在里面，语义和行为不一致；打开时收进浮层、关闭时还给原来的位置，是这类浮层的基本礼仪。

**前端**：影响 `src/features/preview/PreviewPane.tsx`（记录打开前的焦点、聚焦浮层容器，关闭或卸载时归还）。风险：原来的元素已卸载时不强行聚焦；滚轮缩放、翻页与 Esc 行为不变。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/preview/PreviewPane.tsx`

**构建**：通过（bun run build，526ms）

---


## 第 98 轮 · 2026-10-30 14:00
**用户需求**：用读屏软件看文件树时，一串条目被读成普通按钮，听不出谁在哪个文件夹里，也不知道当前打开的是哪一篇。期望它像目录树一样被读出来。

**产品经理**：做。方向键、Home / End、F2 / Delete 都已经按文件管理器的习惯做好了，唯独语义没告诉辅助技术；补上这层不改变任何鼠标与键盘行为。

**前端**：影响 `src/features/workspace/WorkspaceSidebar.tsx`（容器 `role="tree"`、行 `role="treeitem"` 带 `aria-level` 与 `aria-selected`、子层 `role="group"`）。风险：无视觉变化；按钮本身仍可 Tab 聚焦。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/workspace/WorkspaceSidebar.tsx`

**构建**：通过（bun run build，543ms）

---


## 第 97 轮 · 2026-10-30 13:57
**用户需求**：专注模式是"专心写这一篇"，可有时候根本没打开笔记也能进去，界面只剩一块空白；反过来，在专注模式里把正在写的笔记删掉，界面同样空着、侧栏也不在，得自己找快捷键出来。

**产品经理**：做。专注的前提是有正文可看：没有笔记时按钮禁用、快捷键不响应；正在专注时笔记消失（删除或关闭）就自动退出，并沿用已有的退出提示。

**前端**：影响 `src/app/App.tsx`（快捷键改为要求已打开笔记；笔记路径变空时自动退出专注）、`src/app/Toolbar.tsx`（没有笔记时专注按钮禁用，与保存 / 重命名等按钮一致）。风险：切换工作区已在上一轮处理，不会重复触发提示。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/App.tsx`、`src/app/Toolbar.tsx`

**构建**：通过（bun run build，521ms）

---


## 第 96 轮 · 2026-10-30 13:54
**用户需求**：在专注模式里按 Ctrl+O 换了一个笔记库，界面却还停在专注模式——侧栏和工具栏都没回来，新库有什么完全看不到，只能自己想起快捷键退出。期望换库后自动回到常规布局。

**产品经理**：做。换库意味着重新浏览目录、挑一篇开始写，专注模式的前提（正在写某一篇）已经不成立；自动退出并给出提示，符合用户的下一步动作。

**前端**：影响 `src/features/workspace/workspace-actions.ts`（打开新工作区时若处于专注模式就退出，复用切换动作的提示）。风险：启动恢复工作区时专注模式本来就是关的，不会多出提示。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/workspace/workspace-actions.ts`

**构建**：通过（bun run build，522ms）

---


## 第 95 轮 · 2026-10-30 13:51
**用户需求**：删除有未保存修改的笔记时，确认框里用 Tab 把焦点移到「取消」，按回车却执行了「保存后删除」——明明选的是取消。期望回车触发的是当前焦点所在的按钮。

**产品经理**：做。回车"一律走主按钮"在纯键盘操作下会把取消变成执行，属于容易造成误操作的一致性缺陷；焦点在具体按钮上时应遵循按钮自身的语义。

**前端**：影响 `src/components/Dialog.tsx`（回车处理先看焦点是否在对话框按钮区，是则放行原生点击；否则才走主按钮兜底）。风险：对话框打开时焦点不在按钮上，回车仍按主按钮执行，原有快捷操作不受影响。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/components/Dialog.tsx`

**构建**：通过（bun run build，510ms）

---


## 第 94 轮 · 2026-10-30 13:48
**用户需求**：笔记名一直是小写的 `readme.md`，想统一改成大写的 `README.md`，重命名却提示目标已存在，改不了。期望只改大小写时能正常重命名。

**产品经理**：做。Windows / macOS 文件系统不区分大小写，"目标存在"的检查把同一个文件自己当成了冲突；只影响大小写改名这一种情况，放开它不会让真正撞名的重命名通过。

**前端**：无改动（重命名流程与迁移逻辑照旧）。工作量 0。

**后端**：影响 `src-tauri/src/commands/file.rs`（目标存在时比较规范化后的真实路径，同一个文件才放行；不同文件仍报 `already-exists`）。风险：Linux 等区分大小写的文件系统上，大小写不同的两个文件互为不同文件，仍按原逻辑拦截。工作量 S。

**裁决**：做

**改动**：`src-tauri/src/commands/file.rs`

**构建**：通过（cargo check，2.04s）

---


## 第 93 轮 · 2026-10-30 13:45
**用户需求**：笔记里的截图字很小，点开放大后还是原图大小，看不清上面的细节；期望在大图里能像看图软件那样滚轮缩放。

**产品经理**：做。放大查看的目的就是看清细节，只放大到"适应窗口"常常不够；滚轮是最顺手的缩放方式，缩放比例显示在张数旁边，不额外占界面。

**前端**：影响 `src/features/preview/PreviewPane.tsx`（浮层内滚轮改为 0.5×–4× 缩放，打开与切换文档时复位；张数提示附带当前比例）、`src/features/preview/preview.css`（图片缩放加短过渡）。风险：浮层本来就要挡住穿透的滚轮，改为调缩放后背后正文仍不会被滚动。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/preview/PreviewPane.tsx`、`src/features/preview/preview.css`

**构建**：通过（bun run build，517ms）

---


## 第 92 轮 · 2026-10-30 13:41
**用户需求**：想把当前笔记的完整路径贴到终端或别的工具里，状态栏明明显示着这篇的路径，却只能去文件树里右键那一行找「复制路径」。期望直接点状态栏的路径就能复制全路径。

**产品经理**：做。路径已经在眼前，加一个点击复制比让用户去树里定位同一篇更直接；提示沿用现有 toast，右键菜单里的「复制路径」保留不动。

**前端**：影响 `src/app/StatusBar.tsx`（路径改为按钮，按工作区根拼完整路径并复制，悬停显示全路径与提示）、`src/app/App.css`（按钮重置为文本样式，悬停下划线）。风险：无笔记时仍是普通文本，不多出 Tab 停靠点。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/StatusBar.tsx`、`src/app/App.css`

**构建**：通过（bun run build，516ms）

---


## 第 91 轮 · 2026-10-30 13:38
**用户需求**：看预览的时候把截图直接拖到右边，想着就插到当前笔记里，结果毫无反应，有时候应用还像要去打开那个文件。期望拖到预览区和拖到编辑区一样能插图。

**产品经理**：做。分栏 / 阅读时预览区占了半屏，用户拖放的目标常常落在那里；两处行为不一致会让人觉得"拖放坏了"。顺手把非图片文件拦下，避免 WebView 把它当导航打开。

**前端**：影响 `src/features/preview/PreviewPane.tsx`（预览面板拦截拖拽并复用图片插入流程；非图片文件同样阻止默认行为，由插入流程给出提示）。风险：插入仍以编辑器当前光标位置为准，与从工具栏选图一致。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/preview/PreviewPane.tsx`

**构建**：通过（bun run build，514ms）

---


## 第 90 轮 · 2026-10-30 13:35
**用户需求**：刚把文件树里的 `.md` 藏起来了，可空文档页的「最近打开」还照样带着扩展名，同一篇笔记在两处名字不一样，看着别扭。期望这里也跟着隐藏。

**产品经理**：做。显示规则属于整体偏好，只在一处生效会造成"同一篇笔记两个名字"的困惑；顺手把两处对齐，标题与副目录的层级关系不变。

**前端**：影响 `src/app/App.tsx`（抽出与文件树一致的显示名处理，「最近打开」按偏好隐去 md / markdown / mdx 后缀；移除按钮的可访问名称仍用完整文件名）。风险：无，仅影响显示。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/App.tsx`

**构建**：通过（bun run build，516ms）

---


## 第 89 轮 · 2026-10-30 13:32
**用户需求**：文件树每一行都挂着 `.md`，名字长了就挤成一行省略号，和别的笔记应用比显得啰嗦。希望能把扩展名藏起来，只显示标题；需要确认真实文件名时，悬停还能看到。

**产品经理**：做。本地优先应用里文件名仍是真实文件，扩展名不该被强行隐藏，所以做成设置项、默认保持现状；打开后树里只留可读的标题，悬停 title 仍是完整文件名，两边都不丢信息。

**前端**：影响 `src/stores/settings.ts`（新增布尔偏好，含默认值与载入校验）、`src/features/settings/SettingsDialog.tsx`（视图分类加开关）、`src/features/workspace/WorkspaceSidebar.tsx`（按偏好去掉 md / markdown / mdx 后缀，目录与标题不变）。风险：仅影响显示，重命名、链接生成仍用完整文件名。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/stores/settings.ts`、`src/features/settings/SettingsDialog.tsx`、`src/features/workspace/WorkspaceSidebar.tsx`

**构建**：通过（bun run build，520ms）

---


## 第 88 轮 · 2026-10-30 13:29
**用户需求**：只用键盘整理笔记时，F2 重命名、Delete 删除都能用，但「新建文件夹」「复制链接」这些只藏在右键菜单里，键盘按不出来。期望在文件树的某一行上能直接用键盘打开这个菜单。

**产品经理**：做。菜单本身早就支持方向键和回车，缺的只是"用键盘把它叫出来"这一步；补上后文件树的常用操作可以完全不碰鼠标。

**前端**：影响 `src/features/workspace/WorkspaceSidebar.tsx`（行内按键增加 Shift+F10 与菜单键，按行位置弹出菜单；打开菜单的入口统一成坐标函数，鼠标与键盘共用）。风险：弹出位置沿用菜单组件的边界夹取，靠近窗口底部也不会溢出。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/workspace/WorkspaceSidebar.tsx`

**构建**：通过（bun run build，542ms）

---


## 第 87 轮 · 2026-10-30 13:26
**用户需求**：手上有好几个笔记库，想换一个库时按 Ctrl+O，系统对话框总是从别的地方开始，得重新一层层点回去。期望对话框直接停在我现在这个库的位置。

**产品经理**：做。换库是本地优先应用的常规动作，对话框从当前库所在位置起步能省掉每次的导航；首次打开时没有当前库，保持系统默认行为，不引入新状态。

**前端**：影响 `src/lib/tauri.ts`（`pickWorkspaceFolder` 支持传入 `defaultPath`）、`src/features/workspace/workspace-actions.ts`（把当前根目录传进去）。风险：若当前库的目录已被移走，对话框回退到系统默认，不影响选择。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/lib/tauri.ts`、`src/features/workspace/workspace-actions.ts`

**构建**：通过（bun run build，527ms）

---


## 第 86 轮 · 2026-10-30 13:23
**用户需求**：偶尔预览区会红字提示「预览失败」，但从头到尾没有恢复的办法，只能关掉应用重开。期望提示旁边给个「重试」，按一下重新渲染。

**产品经理**：做。预览 Worker 崩溃后原来不会被丢弃，后续请求石沉大海，表现为"预览彻底坏了"；给一个重试入口成本很低，能把偶发失败变成一次点击的事。

**前端**：影响 `src/features/preview/preview-controller.ts`（`onerror` 时终止并丢弃 Worker，下次请求按需重建）、`src/features/preview/PreviewPane.tsx`（错误提示加重试按钮，用当前正文立刻重渲染）、`src/features/preview/preview.css`（错误条改成两端对齐，补按钮样式）。风险：文档超过 1 MB 时重试仍会提示暂停，属预期。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/preview/preview-controller.ts`、`src/features/preview/PreviewPane.tsx`、`src/features/preview/preview.css`

**构建**：通过（bun run build，860ms）

---


## 第 85 轮 · 2026-10-30 13:20
**用户需求**：笔记放在好几层目录里，写的时候手一抖点「全部折叠」，正在写的这篇也从树里消失了，要重新一层层点开才找回来。期望全部折叠时把自己正在写的那篇留着显出来。

**产品经理**：做。「全部折叠」是为了看清结构，不是为了把当前上下文藏起来；保留当前笔记的目录链展开、并滚到可见位置，符合文件管理器的习惯，也不影响其余目录折叠。

**前端**：影响 `src/features/workspace/workspace-actions.ts`（新增"折叠但保留当前文档祖先目录"的动作，逐级 `expandDir`）、`src/features/workspace/WorkspaceSidebar.tsx`（按钮改调新动作，完成后把当前行滚进视野）。风险：没有打开笔记时行为与原来完全一致；展开状态照常写回偏好。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/features/workspace/workspace-actions.ts`、`src/features/workspace/WorkspaceSidebar.tsx`

**构建**：通过（bun run build，759ms）

---


## 第 84 轮 · 2026-10-30 13:17
**用户需求**：删一个文件夹时确认框只写「移到回收站」，看不出里面还压着好几篇笔记；误删之后要靠回忆才知道丢了什么。期望确认前就说明里面有多少文件、多少子文件夹会一起删掉。

**产品经理**：做。删除是少数不可在应用内撤销的操作，确认框必须让用户看清影响范围；报出数量比空泛的"文件夹及其内容"更具体，也不会让操作变复杂。

**前端**：影响 `src/features/workspace/workspace-actions.ts`（新增目录内容统计，带 500 项上限避免大目录拖慢确认框；统计结果拼进确认文案，覆盖"有未保存修改"与普通删除两种提示）。风险：统计失败时退回到原文案，不阻塞删除。工作量 S。

**后端**：无改动，复用已有的 `list_dir`。工作量 0。

**裁决**：做

**改动**：`src/features/workspace/workspace-actions.ts`

**构建**：通过（bun run build，512ms）

---


## 第 83 轮 · 2026-10-30 13:14
**用户需求**：点了工具栏上的专注模式按钮，界面干净了，但直接敲键盘没反应，得先用鼠标点一下正文才继续输入。期望进入专注后就能接着写。

**产品经理**：做。按钮随工具栏一起收起，浏览器把焦点退回到页面根节点，编辑器便收不到输入；这是新入口带来的焦点断档，写作流不该被打断。

**前端**：影响 `src/app/App.tsx`（渲染完成后把焦点交给正文；纯预览模式没有可见编辑区，不抢焦点）。风险：从快捷键进入时本来焦点就在正文，重复 focus 无副作用。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/App.tsx`

**构建**：通过（bun run build，564ms）

---


## 第 82 轮 · 2026-10-30 13:12
**用户需求**：听说有个"专注模式"，但界面上完全找不到入口，只能去设置里翻快捷键才发现要按 Ctrl+Shift+F。期望在工具栏上就能看到、点一下进入。

**产品经理**：做。上一轮补的专注模式目前只有一个快捷键入口，触发方式藏在快捷键表里；给写作型功能一个可见按钮，才有人会用。按钮放在工具栏最右侧、视图切换旁边，和"怎么显示正文"属于同一组。

**前端**：影响 `src/app/Toolbar.tsx`（新增焦点框图标与最右侧按钮，带分隔线与提示文字，调用 `toggleZenMode`）。风险：窄窗口下工具栏本来就换行，多一个按钮只占一行末尾，不影响其他分组。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/Toolbar.tsx`

**构建**：通过（bun run build，523ms）

---


## 第 81 轮 · 2026-10-30 13:09
**用户需求**：开了专注模式以后想找文件，下意识按 Ctrl+B（平时就是开关侧栏），结果界面毫无反应，工具栏也没回来，像是按键坏了。期望在专注模式里按 Ctrl+B 能退出专注并把侧栏打开。

**产品经理**：做。上一轮刚加的专注模式让 Ctrl+B 变成了"静默无效"的按键，这属于新功能带出来的不一致，趁早补上；行为和按键字面意思对齐，不必再记新键位。

**前端**：影响 `src/app/App.tsx`（`Ctrl+B` 分支：专注模式时退出专注，若侧栏此前被收起则一并打开）、`src/features/settings/SettingsDialog.tsx`（快捷键说明同步一句）。风险：侧栏显示偏好会被写成"显示"，与用户按下的"打开侧栏"一致。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/app/App.tsx`、`src/features/settings/SettingsDialog.tsx`

**构建**：通过（bun run build，510ms）

---


## 第 80 轮 · 2026-10-30 13:06
**用户需求**：晚上开着电脑写长文时，侧栏的文件树、工具栏的一排按钮一直在眼前，字写着写着就走神。希望能一键把界面收干净，只留正文；再按一次回到原来的样子，而且下次启动不要还是这个"空荡荡"的状态。

**产品经理**：做。写作者的无干扰模式是这类应用的基础体验；用快捷键临时切换、不写进偏好，既满足当前的专注需求，也不会让下次启动少掉工具栏而不知所措。进入时用提示说明怎么退出，入口在快捷键列表里也列出来。

**前端**：影响 `src/stores/ui.ts`（新增会话级 `zenMode` 与切换动作，切换时提示退出方式）、`src/app/App.tsx`（渲染时收起 `Toolbar` 与侧栏、`Ctrl+Shift+F` 快捷键；与已有的 `Ctrl+F` 查找按 Shift 区分）、`src/features/settings/SettingsDialog.tsx`（快捷键表补一行）。风险：侧栏的显示偏好不被改写，退出后按原样还原。工作量 S。

**后端**：无改动。工作量 0。

**裁决**：做

**改动**：`src/stores/ui.ts`、`src/app/App.tsx`、`src/features/settings/SettingsDialog.tsx`

**构建**：通过（bun run build，513ms）

---


## 第 79 轮 · 2026-10-30 13:01

**用户需求**：另存为之后，编辑器已经切到新副本，但空状态里的「最近打开」还找不到它；当前打开的笔记按理说一定在列表里。

**产品经理**：「最近打开」的定义就是最近打开过的笔记，另存后新副本立刻成了当前文档，漏掉它属于状态不一致；一处调用即可补齐。结论：**做**。

**前端**：`saveDocumentAs` 在记录「本工作区上次文档」之后补一次 `noteRecent(created.relPath)`，与 `openFile` 的路径保持一致；原来那篇仍作为历史保留。影响模块：另存为、最近打开。风险：无。工作量 **S**（1 个文件，3 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.51s，含 tsc）。

## 第 78 轮 · 2026-10-30 12:59

**用户需求**：我喜欢收起侧栏专心写，但每次启动侧栏又自己出来了，得再按一次 Ctrl + B；这个偏好应该被记住。

**产品经理**：侧栏开合是长期偏好而不是会话状态，和上一轮的窗口最大化同类；用现有设置通道记一个布尔即可。结论：**做**。

**前端**：`toggleSidebar / setSidebarVisible` 在改状态的同时写入 `sidebarVisible`；启动 bootstrap 里和其它设置一起读取，直接写 store（不回写设置）。影响模块：侧栏可见性。风险：低。工作量 **S**（2 个文件，约 15 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/stores/ui.ts`、`src/app/App.tsx`。

**构建**：通过（`bun run build` 0.51s，含 tsc）。

## 第 77 轮 · 2026-10-30 12:56

**用户需求**：想快速把当前笔记切到只读阅读、再切回来接着写，现在只能去点工具栏的切换按钮；希望能像别的笔记软件那样有个 Ctrl + E。

**产品经理**：阅读 / 编辑切换是最常按的视图操作，Ctrl + E 是笔记软件的通行键；保留「分栏」的记忆，切回来时还原，不改变三种视图的语义。结论：**做**。

**前端**：应用级快捷键新增 `Ctrl + E`：当前不在预览就记下编辑态（源码 / 分栏）并切到预览，已在预览则切回记下的模式；`changeViewMode` 切到可编辑视图后把焦点交给正文，来回按也能接着写。设置里的快捷键表补一行。影响模块：全局快捷键、视图切换。风险：低（无文档时不响应）。工作量 **S**（3 个文件，约 30 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/app/App.tsx`、`src/features/workspace/workspace-actions.ts`、`src/features/settings/SettingsDialog.tsx`。

**构建**：通过（`bun run build` 0.53s，含 tsc）。

## 第 76 轮 · 2026-10-30 12:53

**用户需求**：我习惯把窗口最大化用，可每次启动都是小窗，还得再双击一次标题栏；窗口状态应该被记住。

**产品经理**：窗口状态是桌面应用最基本的记忆点之一，只记一个布尔就够用；不动构建配置、不加插件。结论：**做**。

**前端**：`useWindowControls` 里用现有设置通道存 `windowMaximized`：状态变化时写一次（读到旧值之前不写，免得把还没读到的 true 覆盖成 false），启动时若上次是最大化、当前不是，就调用已授权的 `toggleMaximize` 还原（capabilities 只开放了 toggle）。影响模块：窗口控制。风险：低（失败时保持默认窗口大小）。工作量 **S**（1 个文件，约 40 行）。

**后端**：无改动，沿用 `core:window` 现有权限。工作量 **S**。

**裁决**：做。

**改动**：`src/features/window/use-window-controls.ts`。

**构建**：通过（`bun run build` 0.54s，含 tsc）。

## 第 75 轮 · 2026-10-30 12:50

**用户需求**：在文件树里点开另一篇笔记，接着就敲字，结果字没进去——焦点还停在左边树里，得先用鼠标点一下正文。

**产品经理**：打开笔记后的默认下一步就是写作，焦点应该跟着过去；和上一轮的「对话框关闭归还焦点」是同一类契约。结论：**做**。

**前端**：`openFile` 恢复光标后把焦点交给编辑器；纯预览模式没有可见的编辑区，跳过。链接跳转、启动恢复、切换工作区共用这条路径，一并受益。影响模块：打开文档。风险：低。工作量 **S**（1 个文件，约 7 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.60s，含 tsc）。

## 第 74 轮 · 2026-10-30 12:49

**用户需求**：Esc 取消重命名、关掉设置之后直接敲字没反应，得先用鼠标点一下正文；键盘流的习惯被硬生生打断。

**产品经理**：对话框是临时插入的交互，关掉后焦点回到原来的写作位置是桌面应用的默认契约；现在的实现把焦点丢给了 body。结论：**做**。

**前端**：`DialogHost` 记录对话框的开合，关闭时把焦点还给 `.cm-content`（只在没有设置面板或其它对话框同时打开时做，避免焦点跑到遮罩后面）；设置面板在关闭清理时同样归还焦点。用 DOM 选择器而不引入反向依赖。影响模块：对话框焦点。风险：低。工作量 **S**（2 个文件，约 20 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/components/Dialog.tsx`、`src/features/settings/SettingsDialog.tsx`。

**构建**：通过（`bun run build` 0.54s，含 tsc）。

## 第 73 轮 · 2026-10-30 12:46

**用户需求**：打开一个空文件夹时，文件树只写了一句「这个文件夹里还没有 Markdown 文件」，没有下一步；希望直接点一下就能新建第一篇。

**产品经理**：首次使用的第一屏应该给出动作而不是只陈述状态，空状态里带上入口是最小成本的首启引导。结论：**做**。

**前端**：空工作区的提示里加「新建第一篇」文字按钮，复用 `createMarkdownFile("")`，建完自动打开；提示块改为居中排版。目录级的「空」提示保持原样。影响模块：文件树空状态。风险：低。工作量 **S**（2 个文件，约 30 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/WorkspaceSidebar.tsx`、`src/app/App.css`。

**构建**：通过（`bun run build` 0.54s，含 tsc）。

## 第 72 轮 · 2026-10-30 12:44

**用户需求**：写待办清单时，`- [ ] ` 开头的那一行按回车，下一行只有 `- `，没有复选框，每加一条都要自己补 `[ ] `，很打断。

**产品经理**：任务列表是笔记里的高频用法，「回车续写同一项」是最低预期；只在任务行上生效，其它行完全不变。结论：**做**。

**前端**：formatting 新增 `continueTaskList`：光标在任务行末尾、选区为空时插入 `
` + 同级缩进 + 同一个标记 + `[ ] `；代码块（围栏 / 缩进）里直接放弃，空任务项交回默认行为删标记。绑定在 `handleCodeBlockEnter` 之后，代码块里的回车仍由它先接住。设置里的快捷键表补一行。影响模块：编辑键位。风险：低（返回 false 时行为与原来一致）。工作量 **S**（3 个文件，约 45 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/editor/formatting.ts`、`src/features/editor/format-keymap.ts`、`src/features/settings/SettingsDialog.tsx`。

**构建**：通过（`bun run build` 0.58s，含 tsc）。

## 第 71 轮 · 2026-10-30 12:41

**用户需求**：笔记里写了 `mailto:` 这类链接，预览里点了一点反应都没有，编辑区里 Ctrl + 点击同样无效；明明系统能打开邮件客户端。

**产品经理**：只认 `http(s)` 等于把有协议的链接一律当成坏链接；`opener` 插件的默认权限本来就覆盖 http / https / mailto / tel，改判断即可。结论：**做**。

**前端**：新增 `lib/links.ts` 的 `isExternalHref`（任意 `scheme:` 都算外部链接），预览点击、预览悬停提示、编辑区 Ctrl + 点击三处统一改用它；仍没有协议的按相对路径解析，行为不变。影响模块：预览链接、编辑区链接。风险：低（协议不合法时 `openUrl` 失败被吞掉，页面不动）。工作量 **S**（3 个文件，约 20 行）。

**后端**：无改动，沿用 `opener:default` 的允许范围。工作量 **S**。

**裁决**：做。

**改动**：`src/lib/links.ts`（新增）、`src/features/preview/PreviewPane.tsx`、`src/features/editor/EditorPane.tsx`。

**构建**：通过（`bun run build` 0.84s，含 tsc）。

## 第 70 轮 · 2026-10-30 12:38

**用户需求**：新建笔记时名字里带了冒号或星号，点「创建」才弹一句看不懂的失败；这些字符到底能不能用，希望输入时就讲清楚。

**产品经理**：文件系统的命名规则可以提前讲清楚，省掉一次失败往返，也能防住「名字看着建好了其实没建成」的困惑。结论：**做**。

**前端**：新建文件 / 另存为 / 新建文件夹 / 重命名四处共用一份 `nameCharError` 校验：拦下 Windows 不允许的 `< > : " | ? *` 与控制字符、以句点或空格结尾的名称、`CON / NUL / COM1` 等保留字，错误直接显示在输入框下方。影响模块：四个命名对话框。风险：低（只加校验，不改创建逻辑）。工作量 **S**（1 个文件，约 35 行）。

**后端**：无改动，后端原有校验继续兜底。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.57s，含 tsc）。

## 第 69 轮 · 2026-10-30 12:36

**用户需求**：空状态里的「最近打开」攒了一堆不想看的历史，要一条条点 × 才能清掉，希望能一键清空。

**产品经理**：最近打开只是方便回到上一篇的快捷方式，清空不涉及任何文件，属于低风险的用户自主整理；上一轮已经支持逐条移除，补一个整体入口收尾。结论：**做**。

**前端**：store 新增 `clearRecent()`，一次 `set` + 一次持久化（不再逐条写），只清当前工作区的历史；空状态在「最近打开」标题右侧加一个低调的「清空」文字按钮，仅有条目时出现。影响模块：最近打开列表、工作区 store。风险：低。工作量 **S**（3 个文件，约 35 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/stores/workspace.ts`、`src/app/App.tsx`、`src/app/App.css`。

**构建**：通过（`bun run build` 0.56s，含 tsc）。

## 第 68 轮 · 2026-10-30 12:33

**用户需求**：右键菜单只能用鼠标点；用键盘打开（Shift+F10 / 菜单键）后按 ↑↓ 没反应，Tab 也进不去，除了 Esc 什么都做不了。

**产品经理**：桌面应用的右键菜单天生该能用键盘走，菜单里还有删除这类操作，键盘不可达就是可达性缺口。结论：**做**。

**前端**：菜单打开时把焦点放到第一项（单独的空依赖 effect，父组件重渲染不会反复抢焦点），↑↓ 循环移动、Home / End 到首尾，Enter / 空格沿用按钮原生点击；关闭时把焦点还给原来的元素；容器和条目补 `role="menu" / "menuitem"`。影响模块：右键菜单。风险：低。工作量 **S**（1 个文件，约 40 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/components/Menu.tsx`。

**构建**：通过（`bun run build` 0.54s，含 tsc）。

## 第 67 轮 · 2026-10-30 12:31

**用户需求**：看久了觉得字小，想顺手 Ctrl + = 放大一点、Ctrl + - 缩小，现在只能打开设置去拉滑块，打断阅读。

**产品经理**：字号调整是高频微操作，编辑器类应用的通行做法就是 `Ctrl + = / -`；复用现有偏好与持久化，不新增状态。结论：**做**。

**前端**：应用级快捷键里新增 `Ctrl + = / + / -`，按 `PREFERENCE_LIMITS.fontSize` 的步长调整（到上下限即停），通过 `useSettingsStore.update` 走既有的防抖持久化；对话框打开时仍被 `dialogOpen` 拦住，不会误触。设置里的快捷键表补一行。影响模块：全局快捷键、设置文案。风险：低。工作量 **S**（2 个文件，约 20 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/app/App.tsx`、`src/features/settings/SettingsDialog.tsx`。

**构建**：通过（`bun run build` 0.58s，含 tsc）。

## 第 66 轮 · 2026-10-30 12:28

**用户需求**：在文件树里点中一行再按 F2，改的却是编辑器里打开的那篇，不是选中的文件；按 Delete 更是毫无反应。键盘操作在这儿对不上号，容易改错文件。

**产品经理**：F2 改错对象是实打实的误操作风险；文件树里的 F2 / Delete 应该和作用对象一致，和文件管理器对齐。结论：**做**。

**前端**：树行按钮上监听 keydown，F2 调 `renameEntry(entry)`、Delete 调 `deleteEntry(entry)`（仍是进回收站的确认框），并 `stopPropagation` 挡住 App 里对「当前文档」的 F2 处理；方向键逻辑不受影响。设置里的快捷键说明拆成两行，写明文件树里的作用范围。影响模块：文件树、设置文案。风险：低。工作量 **S**（2 个文件，约 20 行）。

**后端**：无改动，复用既有重命名 / 删除命令。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/WorkspaceSidebar.tsx`、`src/features/settings/SettingsDialog.tsx`。

**构建**：通过（`bun run build` 0.62s，含 tsc）。

## 第 65 轮 · 2026-10-30 12:26

**用户需求**：设置里的快捷键一览只有常用的十几个，工具栏上那些标题、引用、列表、代码块、表格其实都有快捷键，列表里却没有，只能靠猜。

**产品经理**：已有能力没有入口等于没有；补全列表是零风险的可发现性投入，不新增功能、不改行为。结论：**做**。

**前端**：对照 `format-keymap.ts` 逐条核对后新增「格式」分组：标题级别、引用、两种列表、任务列表、删除线、行内代码、代码块与语言定位、退出代码块、数学公式、表格、分隔线；顺序放在「编辑」之后。影响模块：设置 · 快捷键。风险：无（纯文案）。工作量 **S**（1 个文件，约 15 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/settings/SettingsDialog.tsx`。

**构建**：通过（`bun run build` 0.69s，含 tsc）。

## 第 64 轮 · 2026-10-30 12:23

**用户需求**：放大看图时滚一下鼠标滚轮，背后的正文跟着滚走了；关掉浮层回到阅读，已经不在刚才那一段，得重新找。

**产品经理**：浮层打开时滚动条属于这张图，背景被挪走是明显的失控感；只拦浮层期间的滚轮，不影响正常阅读。结论：**做**。

**前端**：浮层是预览面板的子节点，滚轮会冒泡到预览的滚动容器。浮层打开期间在面板上挂 `wheel` 监听并 `preventDefault`（`passive: false` 才能生效），关闭时移除；方向键翻页逻辑不变。影响模块：预览放大浮层。风险：低。工作量 **S**（1 个文件，约 12 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/preview/PreviewPane.tsx`。

**构建**：通过（`bun run build` 0.58s，含 tsc）。

## 第 63 轮 · 2026-10-30 12:21

**用户需求**：想把这篇文章的完整路径贴到终端或别的应用里，只能自己去资源管理器翻；文件树右键菜单里希望能直接「复制路径」。

**产品经理**：桌面编辑器的右键菜单都有这一项，成本极低、用途明确（贴终端、发给同事）。结论：**做**。

**前端**：文件树右键菜单新增「复制路径」，按工作区根拼出完整路径，按根的分隔符把 `/` 换成本机风格（Windows 用 `\`）；复制成功 / 失败沿用统一提示。影响模块：文件树右键菜单。风险：低。工作量 **S**（1 个文件，约 20 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/WorkspaceSidebar.tsx`。

**构建**：通过（`bun run build` 0.57s，含 tsc）。

## 第 62 轮 · 2026-10-30 12:18

**用户需求**：预览里外链和笔记间的相对链接长得一模一样，鼠标悬停也没有任何提示，点之前不知道会去哪，怕点错。

**产品经理**：链接目标是最基本的可预期性信息，悬停提示零学习成本；不改跳转逻辑，只补提示。结论：**做**。

**前端**：渲染后给 `a[href]` 补 `title`：外链显示完整地址，相对链接解析成工作区路径；用户自己在 Markdown 里写了 `"title"` 的保留不动。自己加的提示用 `data-link-hint` 标记，切换文档后按新路径重算，不会残留上一篇的解析结果。影响模块：预览链接。风险：低。工作量 **S**（1 个文件，约 15 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/preview/PreviewPane.tsx`。

**构建**：通过（`bun run build` 0.63s，含 tsc）。

## 第 61 轮 · 2026-10-30 12:16

**用户需求**：文件树上一轮已经能用方向键走了，大纲面板却还是只能鼠标点；长文档调结构时，希望 Tab 到大纲后也能 ↑↓ 挨个看标题、回车跳过去。

**产品经理**：同一块侧栏里两个列表行为不一致，键盘用户会觉得大纲「半残」；补上是一致性收尾，且跳转仍沿用已有逻辑。结论：**做**。

**前端**：大纲容器监听 keydown，↑↓ / Home / End 在 `data-outline-index` 的条目间移动焦点，越界时只拦住默认滚动、不跳走；Enter / 空格沿用按钮原生点击跳转。顺带给条目补 `aria-level`，让读屏知道标题层级。影响模块：大纲面板。风险：低。工作量 **S**（1 个文件，约 35 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/outline/OutlinePanel.tsx`。

**构建**：通过（`bun run build` 0.64s，含 tsc）。

## 第 60 轮 · 2026-10-30 12:13

**用户需求**：教程类笔记里截图一大串，放大看完一张想接着看下一张，只能先关掉浮层再回去点，来回折腾；有键盘时更希望直接按左右键翻。

**产品经理**：放大查看本来就是「连着看」的场景，上一张 / 下一张是最自然的动作；只改浮层内部，不动正文与链接行为。结论：**做**。

**前端**：打开浮层时顺带收集文档里的所有图片（`resolveMarkdownImageSrc` 之后已是可用的 feimg 地址），记下当前这张的下标；← → 循环翻页，只有一张时不显示翻页控件；链接指向的图片若不在正文里就单独补一张。点击空白或 Esc 仍是关闭，翻页按钮 `stopPropagation` 避免误关。影响模块：预览放大浮层。风险：低。工作量 **S**（2 个文件，约 90 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/preview/PreviewPane.tsx`、`src/features/preview/preview.css`。

**构建**：通过（`bun run build` 0.59s，含 tsc）。

## 第 59 轮 · 2026-10-30 12:11

**用户需求**：连着操作几次，右下角的提示会堆成一列挡住状态栏；想停下来看清楚，鼠标移上去它还是按原来的时间消失，来不及读。

**产品经理**：提示是反馈而不是主体，堆叠会抢走界面重心；悬停暂停是通知类 UI 的通行做法，两处都不改文案、不改触发时机。结论：**做**。

**前端**：`toast()` 最多保留 3 条，被挤掉的旧提示同时清掉计时器；计时器收进 store 里的 Map，新增 `pauseToast / resumeToast`，提示条 `onMouseEnter` 暂停、`onMouseLeave` 重新计时（错误提示仍按 6 秒）。影响模块：全局提示。风险：低。工作量 **S**（2 个文件，约 40 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/stores/ui.ts`、`src/components/Toast.tsx`。

**构建**：通过（`bun run build` 0.60s，含 tsc）。

## 第 58 轮 · 2026-10-30 12:08

**用户需求**：笔记里贴的代码块，预览时看不出是什么语言；想复制去别处之前得先回头翻源码看围栏，希望像 GitHub 那样在左上角标个语言名。

**产品经理**：技术笔记里代码块很常见，语言标注是零成本的识别线索，还能顺手确认 Shiki 有没有把语言认对（认不出会回退成纯文本着色）。结论：**做**。

**前端**：复用现有给代码块挂复制按钮的 effect：Shiki 会把语言写成 `language-*` 类，从中取出语言名放进左上角的小标签；未知语言回退成 `text` 时不标（那种标签没有信息量）。标签用等宽小字、不响应鼠标，不挡选中代码。影响模块：预览代码块。风险：低。工作量 **S**（2 个文件，约 30 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/preview/PreviewPane.tsx`、`src/features/preview/preview.css`。

**构建**：通过（`bun run build` 0.71s，含 tsc）。

## 第 57 轮 · 2026-10-30 12:06

**用户需求**：上一轮文件树能用方向键了，但想调侧栏宽窄还是得拖鼠标；分栏那条分隔线早就能 Tab 聚焦、用方向键调了，侧栏这条却完全按不到。

**产品经理**：两根分隔条行为不一致，用户会以为侧栏那条是「坏了」；补上键盘调整是一致性和可达性的基本盘。结论：**做**。

**前端**：分隔条加 `tabIndex`、`aria-valuemin / max / now`，方向键每次 8px（Shift 32px）、Home 回默认宽度，复用现有 `commitWidth` 持久化；聚焦时用高亮细线代替默认描边（6px 宽的条放 2px 描边很挤），与分栏分隔条一致。影响模块：侧栏分隔条。风险：低。工作量 **S**（2 个文件，约 30 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/WorkspaceSidebar.tsx`、`src/app/App.css`。

**构建**：通过（`bun run build` 0.70s，含 tsc）。

## 第 56 轮 · 2026-10-30 12:05

**用户需求**：文件树里文件一多，只想用键盘翻：希望能 ↑↓ 在可见行之间走、←→ 折叠 / 展开文件夹、Home / End 跳到首尾，和文件管理器一样。

**产品经理**：笔记库动辄几十个文件，逐行点鼠标太累；方向键是文件管理器的通用习惯，而且现在 Tab 进来后按上下键毫无反应，像是坏了一半。结论：**做**。

**前端**：在文件树容器上监听 keydown，按 DOM 顺序取当前可见的 `.tree-row`（页面里只渲染展开的节点，天然就是可见列表），↑↓ / Home / End 移动焦点；→ 展开折叠的文件夹或进入第一个子项；← 折叠已展开的文件夹，否则回到同层父行。行上加 `data-depth` 与 `aria-expanded` 支撑上面的判断，顺带把文件夹的展开状态暴露给读屏。Enter 沿用按钮原生点击。影响模块：侧栏文件树。风险：低（不改点击路径）。工作量 **S**（1 个文件，约 60 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/WorkspaceSidebar.tsx`。

**构建**：通过（`bun run build` 0.68s，含 tsc）。

## 第 55 轮 · 2026-10-30 12:08

**用户需求**：笔记里截图有时是当链接写的（`[流程截图](assets/flow.png)`），在预览里点了完全没反应，只能用 `![]()` 的写法才能看图。

**产品经理**：上一轮做的放大浮层正好能复用；点链接没有任何反馈是典型的「是不是坏了」，补上就是顺手的事。结论：**做**。

**前端**：预览的相对链接分支里先判断图片扩展名，能解析出工作区内的地址就用放大浮层打开（复用 `resolveMarkdownImageSrc` 与上一轮的浮层），越界或解析失败保持不动作；顺带修正上一轮那句已不准确的注释。影响模块：预览点按。风险：低。工作量 **S**（1 个文件，约 15 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/preview/PreviewPane.tsx`。

**构建**：通过（`bun run build` 0.65s，含 tsc）。

## 第 54 轮 · 2026-10-30 12:04

**用户需求**：习惯性地双击标题栏想最大化，结果什么都没发生，只能去点右上角那个按钮；用别的窗口都不会这样。

**产品经理**：标题栏是自绘的（`decorations: false`），系统自带的双击行为跟着没了；这是所有窗口的通识操作，补回来成本极低。结论：**做**。

**前端**：标题栏空白处双击调用已有的 `toggleMaximize()`，点在按钮上时不触发（避免双击「关闭」误关窗口）。影响模块：标题栏。风险：低。工作量 **S**（1 个文件，约 5 行）。

**后端**：无改动，复用已授权的 `allow-toggle-maximize`。工作量 **S**。

**裁决**：做。

**改动**：`src/app/TitleBar.tsx`。

**构建**：通过（`bun run build` 0.62s，含 tsc）。

## 第 53 轮 · 2026-10-30 12:01

**用户需求**：空状态里的「最近打开」攒了几条早就不想看的条目（比如临时建错的文件），却没有办法清掉，只能等它被新打开的笔记挤出去。

**产品经理**：最近打开是用户自己的历史，应该能自己整理；加一个只在悬停 / 聚焦时出现的移除按钮，不打扰正常浏览。结论：**做**。

**前端**：条目外面包一层 `.recent-row`，右侧加「×」按钮调用现有的 `updateRecent(relPath, null)`；按钮默认透明，悬停或键盘聚焦时显现，并补暗色主题的悬停底色。影响模块：空状态最近列表、样式。风险：低。工作量 **S**（2 个文件，约 45 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/app/App.tsx`、`src/app/App.css`。

**构建**：通过（`bun run build` 0.60s，含 tsc）。

## 第 52 轮 · 2026-10-30 11:59

**用户需求**：扉页的快捷键其实不少（F2、Ctrl+Shift+S、Ctrl+B、Ctrl+F…），可都藏在按钮 tooltip 里，用久了也记不全，想查一下没地方查。

**产品经理**：快捷键是熟练用户的主要操作方式，没有统一入口就只能靠摸索；放进设置里成本很低，还能顺手说明 Ctrl+B 在不同位置的两种含义。结论：**做**。

**前端**：设置面板新增「快捷键」分类，按「文件 / 编辑 / 视图与查找」分组列出按键与说明，重设默认值不受影响。影响模块：设置面板与样式。风险：低，纯静态内容。工作量 **S**（2 个文件，约 60 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/settings/SettingsDialog.tsx`、`src/features/settings/settings.css`。

**构建**：通过（`bun run build` 0.59s，含 tsc）。

## 第 51 轮 · 2026-10-30 11:56

**用户需求**：保存冲突、恢复副本、有未保存修改这些确认框，按回车没任何反应，只能去点按钮；Esc 倒是能取消，键盘用起来很别扭。

**产品经理**：键盘流用户对确认框的预期就是「回车确认、Esc 取消」，现在只有一半；危险操作不该被回车误触，所以只让带「主按钮」的确认框响应回车。结论：**做**。

**前端**：确认框的全局按键处理补上 Enter：有主按钮（tone 为 primary）时确认主按钮，没有主按钮（如「移到回收站」）时保持原样。影响模块：对话框组件。风险：低。工作量 **S**（1 个文件，约 15 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/components/Dialog.tsx`。

**构建**：通过（`bun run build` 0.61s，含 tsc）。

## 第 50 轮 · 2026-10-30 11:53

**用户需求**：重命名对话框开着的时候我按了几下 Tab，之后随手打字，结果字打到后面正文里去了，对话框还盖在上面——差点把内容改坏。

**产品经理**：模态对话框却不拦焦点，等于在「正在做一件别的事」的时候偷偷编辑正文，属于会改坏内容的问题，必须堵上。结论：**做**。

**前端**：抽一个 Tab 循环处理，确认框、输入框、设置面板三处共用：焦点在最后一个可聚焦元素时 Tab 回到第一个，Shift+Tab 反向，焦点意外跑到外面时拉回来；禁用元素不计入。影响模块：对话框组件、设置面板。风险：低。工作量 **S**（2 个文件，约 45 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/components/Dialog.tsx`、`src/features/settings/SettingsDialog.tsx`。

**构建**：通过（`bun run build` 0.71s，含 tsc）。

## 第 49 轮 · 2026-10-30 11:48

**用户需求**：在文件树上右键某个目录「新建 Markdown」，弹出来的框只写「新建 Markdown 文件」，看不出会建到哪儿；目录一多，建错了还得再挪。

**产品经理**：删除、重命名两个对话框上一轮都补了路径，新建同样需要说清目标位置，否则「建对地方」全靠记刚刚右键的是哪一行。结论：**做**。

**前端**：新建 Markdown / 新建文件夹的标题在非根目录时显示目标目录（`新建 Markdown · notes/周报`），根目录保持原样。影响模块：新建动作文案。风险：低。工作量 **S**（1 个文件，约 5 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.66s，含 tsc）。

## 第 48 轮 · 2026-10-30 11:32（按系统时钟校时；前几轮的时间是估算值，略快于实际）

**用户需求**：我几乎只用「大纲」标签，可每次重开扉页侧栏又回到「文件」，得再点一次；侧栏宽度都能记住，标签反倒记不住。

**产品经理**：同一类「界面状态该记住」的诉求，宽度、展开目录、最近打开都做了，标签漏了；成本几乎为零。结论：**做**。

**前端**：标签切换时写入 `sidebarTab`，启动时读回并校验取值；切换标签时顺手关闭右键菜单。影响模块：侧栏。风险：低，非法值退回「文件」。工作量 **S**（1 个文件，约 20 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/WorkspaceSidebar.tsx`。

**构建**：通过（`bun run build` 0.58s，含 tsc）。

## 第 47 轮 · 2026-10-30 12:24

**用户需求**：重命名对话框里只有一个文件名，同名笔记一多就分不清改的是哪一篇；而且每次都要手动删掉 `.md` 只改主名，不然全选一敲扩展名也没了。

**产品经理**：上一轮删除确认补了路径，重命名同样需要「改的是哪一个」的上下文；聚焦就选中主名属于零成本的操作优化。结论：**做**。

**前端**：对话框标题在非根目录时显示相对路径；输入框新增「只选中主名」模式（按最后一个 `.` 切分），重命名文件时启用，目录与新建对话框保持全选。影响模块：提示框请求类型、对话框组件、重命名动作。风险：低。工作量 **S**（3 个文件，约 25 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/stores/ui.ts`、`src/components/Dialog.tsx`、`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.61s，含 tsc）。

## 第 46 轮 · 2026-10-30 12:13

**用户需求**：我库里好几个项目目录都有 `README.md`，在文件树上右键删除时，确认框只写「确定将『README.md』移到回收站吗」，我完全不确定删的是哪一个，手一抖就删错。

**产品经理**：删除是不可逆动作（还要去回收站捞），确认框里却省掉了唯一能区分目标的目录信息；「最近打开」上一版刚补过路径，这里更该补。结论：**做**。

**前端**：确认框里的名称改为带目录的相对路径（根目录下的文件仍只显示文件名），两种文案（有未保存修改 / 普通删除）统一使用。影响模块：删除动作。风险：低，纯文案。工作量 **S**（1 个文件，约 5 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.58s，含 tsc）。

## 第 45 轮 · 2026-10-30 12:07

**用户需求**：新建出来的笔记编辑区就是一整片白，连光标在哪里都看不太清，也不知道除了打字还能用什么格式。

**产品经理**：空白页是新用户唯一会遇到的「零状态」，一句起手提示成本极低，还能顺手把最常用的 `#` 标题用法说清楚。结论：**做**。

**前端**：用 CodeMirror 自带的 `placeholder` 扩展，只在文档为空时显示；颜色走主题里的 `--text-faint`，暗色主题下同样合适。影响模块：编辑器扩展与主题。风险：低，不参与排版与保存。工作量 **S**（1 个文件，约 10 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/editor/editor-setup.ts`。

**构建**：通过（`bun run build` 0.63s，含 tsc）。

## 第 44 轮 · 2026-10-30 12:01

**用户需求**：工具栏加粗、标题这些按钮都有，偏偏没有撤销和重做；写坏了只能靠记 Ctrl+Z，鼠标党完全没入口，而且不知道现在还能不能撤销。

**产品经理**：撤销是所有编辑操作里回退成本最低的一个，工具栏顶部却缺这一对按钮；按钮置灰还能顺手告诉用户「没得撤了」。结论：**做**。

**前端**：把撤销 / 重做栈是否非空纳入现有格式状态（每次事务都会同步），工具栏新增一组按钮，无历史或预览模式时置灰；命令直接用 CodeMirror 的 `undo` / `redo`。影响模块：格式状态、编辑器状态、工具栏。风险：低。工作量 **S**（3 个文件，约 60 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/editor/formatting.ts`、`src/stores/editor.ts`、`src/app/Toolbar.tsx`。

**构建**：通过（`bun run build` 0.92s，含 tsc）。

## 第 43 轮 · 2026-10-30 11:51

**用户需求**：状态栏一直写着「保存暂停」，点它一点反应也没有，我还以为坏了；提示里说要按 Ctrl+S，可我早忘了这茬。

**产品经理**：状态栏是唯一常驻的保存状态提示，写「暂停」却点不动，等于把一个死胡同摆在最显眼的位置；让它可点重试，冲突处理对话框顺手就弹出来。结论：**做**。

**前端**：`saveBlocked` 时把保存状态渲染成按钮，点击重试保存（冲突时进入已有的「另存副本 / 重新加载」对话框），并补上悬停下划线；其余状态保持纯文本。影响模块：状态栏、状态栏样式。风险：低。工作量 **S**（2 个文件，约 25 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/app/StatusBar.tsx`、`src/app/App.css`。

**构建**：通过（`bun run build` 0.64s，含 tsc）。

## 第 42 轮 · 2026-10-30 11:46

**用户需求**：上一个版本开始每个库各自记住上次看的笔记了，可启动时才会自动打开；我中途切到另一个库，看到的还是一张空白页，照样得自己去找那篇。

**产品经理**：既然记录了就该在切换时用上，否则用户只在重启时才感受到这个功能；和启动恢复保持同一行为，心智一致。结论：**做**。

**前端**：打开工作区成功后读取该工作区上次的文档并静默打开（文件已不存在时静默跳过并清掉记录），与启动恢复走同一个 `openFile`。影响模块：打开工作区。风险：低——切到一个从未打开过的库时行为不变。工作量 **S**（1 个文件，约 15 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.61s，含 tsc）。

## 第 41 轮 · 2026-10-30 11:41

**用户需求**：我平时在工作库和个人库之间来回切换。每次切完再启动，打开的是最后一次看的那篇笔记；另一个库上次看到哪儿完全不记得，总得在文件树里再翻一遍。

**产品经理**：「记住上次打开的文档」对一个库成立，对多个库就是半截功能；展开状态、最近打开早就按工作区分别记了，这里也该一致。结论：**做**。

**前端**：把单个全局路径换成「工作区根目录 → 文档」映射，收进独立模块供工作区动作与崩溃恢复共用（避免与 `workspace-actions` 形成循环依赖）；打开工作区时不再清空记录，旧版本存的单个路径在首次读取时迁移到当前工作区名下。影响模块：工作区动作、崩溃恢复、新建的 `last-document`。风险：低，读取失败时退回「不自动打开」。工作量 **S**（3 个文件，约 70 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/last-document.ts`（新增）、`src/features/workspace/workspace-actions.ts`、`src/features/editor/recovery.ts`。

**构建**：通过（`bun run build` 1.03s，含 tsc）。

## 第 40 轮 · 2026-10-30 11:35

**用户需求**：同一篇笔记连着「另存为」两次，第二次默认名还是 `笔记-副本.md`，直接点确定就报「目标已存在」，得自己改名字。

**产品经理**：默认值本该是「点一下就能用」，撞名报错等于把改名的活推回给用户；新建文件 / 文件夹早就自动加序号了，另存为漏了同一个处理。结论：**做**。

**前端**：另存为的默认文件名改走现有的 `nextAvailableName`，连续另存会得到 `笔记-副本 2.md`。影响模块：另存为动作。风险：低，只改输入框默认值。工作量 **S**（1 个文件，约 5 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.57s，含 tsc）。

## 第 39 轮 · 2026-10-30 11:30

**用户需求**：我的笔记里贴了不少截图，预览时图片按正文宽度缩得很小，看不清上面的字，只能去资源管理器里找原图打开。

**产品经理**：读带图的笔记时放大看一眼是最常见的动作，成本只有一个浮层；不动正文排版，也不影响点击链接的行为。结论：**做**。

**前端**：预览的点按处理里补一条「点图片放大」：浮层铺满窗口显示原图，单击任意位置或按 Esc 关闭，切换文档时自动关闭；图片外面包着链接时仍按链接处理。影响模块：预览点按、预览样式。风险：低。工作量 **S**（2 个文件，约 60 行）。

**后端**：无改动，图片仍走现有的 `feiyeimg` 协议。工作量 **S**。

**裁决**：做。

**改动**：`src/features/preview/PreviewPane.tsx`、`src/features/preview/preview.css`。

**构建**：通过（`bun run build` 0.67s，含 tsc）。

## 第 38 轮 · 2026-10-30 11:25

**用户需求**：保存时提示「文件已被其他程序修改」，可选只有「重新加载」——等于让我扔掉刚写的修改——和「取消」。我想两边都留着，把本地这版存成另一篇。

**产品经理**：冲突是双份内容都值得保留的场景，只给一个会丢掉一方的出口明显不够；README「计划中」也已经写了「覆盖 / 另存副本」。结论：**做**。

**前端**：冲突对话框加主按钮「另存副本…」，复用现有「另存为」流程（切到副本继续编辑，磁盘上的另一版保持不动）；`save` 与 `workspace-actions` 互相引用，用动态导入避免静态循环。影响模块：保存流程。风险：低，需用户显式选择。工作量 **S**（1 个文件，约 15 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/editor/save.ts`。

**构建**：通过（`bun run build` 0.79s，含 tsc）。

## 第 37 轮 · 2026-10-30 11:20

**用户需求**：上次崩溃后我急着把那个文件在资源管理器里删了，结果再打开扉页提示「有一份恢复副本，但原文件已经不在」，只给我「丢弃」和「稍后」——我的内容明明就在副本里，却没有办法拿出来。

**产品经理**：恢复副本存在的唯一理由就是救内容；原文件不在时只能丢弃，等于把最需要它的情况做成了死角。加一个「恢复为文件」把内容写回原路径即可。结论：**做**。

**前端**：缺失场景的确认框增加主按钮「恢复为文件」，新建同名文件写入副本内容、删除副本、刷新文件树并直接打开；父目录也被删掉时创建失败，保留副本并提示。影响模块：崩溃恢复。风险：低（用户显式点击才写入；写回的是原路径）。工作量 **S**（1 个文件，约 45 行）。

**后端**：无改动，复用现有 `create_file` / `write_file`。工作量 **S**。

**裁决**：做。

**改动**：`src/features/editor/recovery.ts`。

**构建**：通过（`bun run build` 0.72s，含 tsc）。

## 第 36 轮 · 2026-10-30 11:16

**用户需求**：删掉一篇写得很长的旧笔记后，我新建了一篇同名的（比如每次日报都叫 `日报.md`），打开时光标直接跳到文章中间，还得先 Ctrl+Home 回开头。

**产品经理**：删掉的文件不该再留任何本地状态；带着旧光标记录会让人以为打开了别的内容。删除时顺手清一下，成本几乎为零。结论：**做**。

**前端**：光标记录模块加「按路径（含目录前缀）清空」的方法，删除成功后调用；注意必须放在 `resetDocument()` 之后，否则它会把当前光标记回已删除的路径。影响模块：光标记忆、删除动作。风险：低。工作量 **S**（2 个文件，约 25 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/editor/cursor-memory.ts`、`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.77s，含 tsc）。

## 第 35 轮 · 2026-10-30 11:13

**用户需求**：我把一个文件夹改了个名，再点开里面那篇写了一半的笔记，光标回到文章开头了；文件本身改名倒是没问题。

**产品经理**：「记住每篇文档的光标位置」是已经承诺过的能力，改个名就失效属于回归；恢复副本、最近打开早就跟着改名迁移了，光标记录漏了同一个逻辑。结论：**做**。

**前端**：在光标记录模块加按前缀迁移的方法（文件精确匹配、目录前缀替换），重命名成功后统一调用一次，与恢复副本 / 最近打开的处理对齐。影响模块：光标记忆、重命名动作。风险：低，纯本地状态迁移。工作量 **S**（2 个文件，约 30 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/editor/cursor-memory.ts`、`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.76s，含 tsc）。

## 第 34 轮 · 2026-10-30 11:09

**用户需求**：我平时就停在「预览」里看排版，想找一段话按 Ctrl+F 什么反应都没有，只能先切回编辑模式再搜。

**产品经理**：查找是读文档时的基本动作，预览模式按了没反应会让人以为快捷键坏了；切到分栏就能看到高亮，和现有行为一致。结论：**做**。

**前端**：窗口级快捷键补上 Ctrl+F：预览模式下先切到分栏（并轻提示原因）再打开 CodeMirror 查找面板；编辑 / 分栏模式下若焦点不在正文（例如在文件树），也能直接打开面板。编辑器内的 Ctrl+F 仍由 CodeMirror 自己处理，不重复响应。影响模块：应用级快捷键、编辑器桥接。风险：低。工作量 **S**（2 个文件，约 25 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/app/App.tsx`、`src/features/editor/editor-bridge.ts`。

**构建**：通过（`bun run build` 0.71s，含 tsc）。

## 第 33 轮 · 2026-10-30 11:05

**用户需求**：我在资源管理器里把一篇正在看的笔记挪走了，扉页这边照样显示着，状态栏还写着「已保存」。我以为磁盘上还有这篇，结果关掉窗口这段内容就没了。

**产品经理**：这是「以为已保存、其实不在磁盘上」的静默风险，和丢失数据直接相关；窗口重新聚焦时已经会读盘校验，顺手区分「找不到文件」即可。结论：**做**。

**前端**：在已有的聚焦校验里识别 `not-found`，提示「文件已不在磁盘上」并给「另存为…」/「保留」两个出口；同一路径只提醒一次，不打断正常切窗口。影响模块：窗口聚焦校验。风险：低，只多一种错误分支。工作量 **S**（1 个文件，约 20 行）。

**后端**：无改动，`read_file` 已经返回结构化的 `not-found` 错误码。工作量 **S**。

**裁决**：做。

**改动**：`src/app/App.tsx`。

**构建**：通过（`bun run build` 0.63s，含 tsc）。

## 第 32 轮 · 2026-10-30 11:02

**用户需求**：我的库里每个项目目录都有一篇 `README.md`，空状态「最近打开」里全是同样的 `README.md`，光看名字分不出哪篇是哪篇，只能一个个点开试。希望顺带显示它所在的目录。

**产品经理**：最近打开是入口列表，条目无法区分就失去了入口价值；显示父目录成本很低，也和文件树里的上下文一致。结论：**做**。

**前端**：空状态里的最近条目改为「文件名 + 淡色目录」两段，目录为空（根目录）时只显示文件名；长路径两端省略，完整路径仍在 `title` 里。影响模块：空状态最近列表、样式。风险：低，纯展示。工作量 **S**（2 个文件，约 20 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/app/App.tsx`、`src/app/App.css`。

**构建**：通过（`bun run build` 0.95s，含 tsc）。

## 第 31 轮 · 2026-10-30 10:59

**用户需求**：另存为对话框一关我就接着往下写，状态栏显示「已保存」，可新副本里少了我刚写的那一句；关掉重开才发现。希望另存为期间的新输入不会被当成已保存。

**产品经理**：状态栏的「已保存」必须等于磁盘内容。另存为写入的是点击确认前的文本快照，写入期间的新输入如果被一并标记为已保存，自动保存不会再触发，关闭窗口时 `flushAutoSave` 看到「不脏」直接放行，这段内容就静默丢了。结论：**做**。

**前端**：`saveDocumentAs` 写入完成后重新取编辑器文本，与写入内容比较；不一致时 `markSaved(modifiedMs, true)` 保持脏状态，并在 `resetAutoSave()` 之后重新调用 `noteDocumentChange()` 排上自动保存与恢复副本。影响模块：另存为、自动保存状态。风险：低，仅在写入与新输入竞争时改变脏标记；正常路径仍视为已保存。工作量 **S**（1 个文件，约 10 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.89s，含 tsc）。

## 第 30 轮 · 2026-10-30 10:56

**用户需求**：我在资源管理器里新建或改名了几篇笔记，切回扉页后文件树还是旧的，每次都要手动点刷新。希望回到窗口时自动刷新一下。

**产品经理**：和本地文件管理器并行使用是常态，应用每次聚焦都在检测当前文档的外部修改，却不管文件树，属同一时机的半截能力；自动刷新能消除「文件明明在却看不到」。结论：**做**。

**前端**：`App` 的 focus / visibility 处理在已打开工作区时调用 `refreshTree()`，用 2 秒节流避免反复 Alt-Tab 读盘；`refreshTree` 跳过正在加载的目录（含根目录），避免 `refreshDir` 先清空子项、再撞上 `loadDir` 的 loading 早退而留下空目录。影响模块：文件树刷新、窗口聚焦。风险：低，只读目录列表；展开目录很多时每次都读盘，已用节流限制。工作量 **S**（2 个文件，约 20 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/app/App.tsx`、`src/stores/workspace.ts`。

**构建**：通过（`bun run build` 0.69s，含 tsc）。

## 第 29 轮 · 2026-10-30 10:53

**用户需求**：我用别的工具复制标题链接时，生成的是 `笔记名.md#某小节` 这种带文件名的形式，哪怕指向的是当前这篇。点它却毫无反应——纯 `#某小节` 是能跳的。希望这种自链接也能在当前笔记里跳过去。

**产品经理**：带文件名的锚点链是常见工具的默认输出，指向自身时静默失败会让用户以为链接写错了；上一轮刚补了跨笔记锚点，这一处正好是同一能力的缺口。结论：**做**。

**前端**：编辑区与预览的链接处理在解析出 `relPath === 当前文档` 时不再调用 `openFile`（它会因同路径直接返回），改为本地跳转：编辑区复用 `openEditorAnchor`，预览复用 `findHeadingByAnchor` + `scrollPreviewToHeading`；找不到标题时保持原样。影响模块：编辑器 / 预览链接点击。风险：低，仅新增同路径分支，其他链接路径不变。工作量 **S**（2 个文件，约 20 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/editor/EditorPane.tsx`、`src/features/preview/PreviewPane.tsx`。

**构建**：通过（`bun run build` 0.83s，含 tsc）。

## 第 28 轮 · 2026-10-30 10:50

**用户需求**：上次应用崩溃了，重开时它自动打开了我崩溃前正在写的那篇，但恢复副本一直没弹提示，没保存的段落就这么找不回来了；只有先换个库才会提示。希望自动打开的那篇也能看到恢复提示。

**产品经理**：崩溃恢复是应用的核心承诺。启动时自动打开上次文档会先把 `document.path` 设上，而 `promptPendingRecoveries` 只要发现「有文档打开」就整体返回，导致刚恢复出来的文档自己的副本永远提示不到，未保存内容事实上不可达。结论：**做**。

**前端**：取消「有文档打开就整体跳过」，改为逐条判断：只有当前打开的是**别的**文档时才跳过该副本，当前文档自己的副本照常询问；恢复内容仍先进入编辑器、不直接写盘。影响模块：崩溃恢复提示。风险：低，恢复 / 丢弃流程本身未改；并发提示仍由 `prompting` 挡住。工作量 **S**（1 个文件，约 8 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/editor/recovery.ts`。

**构建**：通过（`bun run build` 0.55s，含 tsc）。

## 第 27 轮 · 2026-10-30 10:47

**用户需求**：我整理目录时给一个展开着的文件夹改名，整个文件树立刻缩回去了，刚打开的笔记也被藏起来，只能在新的位置一层层重新点开。希望改名后原来展开的目录还保持展开。

**产品经理**：改名是整理笔记的日常动作，改完树全收起会直接打断整理；这是目录改名系列（第 12 / 19 / 20 轮）里还剩下的体验缺口。结论：**做**。

**前端**：`workspace` store 增加 `expandDirs(paths)` 批量展开并只持久化一次；`renameEntry` 在重建工作区前把展开路径按旧前缀换成新前缀，重建后按层级恢复；`restoreExpanded` 改为与当前状态合并，避免异步恢复旧列表覆盖刚改好的路径。影响模块：文件树展开状态、目录重命名。风险：低，仅影响展开记录，旧路径失效后会被忽略。工作量 **S**（2 个文件，约 35 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/stores/workspace.ts`、`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.57s，含 tsc）。

## 第 26 轮 · 2026-10-30 10:44

**用户需求**：我的索引页写了 `[第二章](第二卷.md#二、雨夜)`。点开能到那篇笔记，但总是停在开头，还得自己往下找。希望链接里的 `#标题` 在跨笔记时也能定位。

**产品经理**：写作者做长文索引时天然会带锚点；现在只有同文档锚点和跨笔记文件两种能力，组合起来反而失效。补上后深链接才完整。结论：**做**。

**前端**：`openFile` 增加可选 `anchor`，打开并恢复光标后按标题文字解析大纲、移动光标，分栏时同步滚动预览；编辑区 Ctrl+点击与预览点击两处解析 `#` 片段后传入。找不到对应标题时保持原有打开行为。影响模块：打开文件、编辑器 / 预览链接。风险：低，锚点仅在显式提供时生效，不改打开与保存流程。工作量 **S**（3 个文件，约 40 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`、`src/features/editor/EditorPane.tsx`、`src/features/preview/PreviewPane.tsx`。

**构建**：通过（`bun run build` 0.55s，含 tsc）。

## 第 25 轮 · 2026-10-30 10:41

**用户需求**：长笔记开头做了目录，写着 `[一、开头](#一、开头)`。预览里点能跳到对应标题，可回到编辑区用 Ctrl+点击这些锚点毫无反应，得自己滚过去找。希望编辑区里的锚点也能跳。

**产品经理**：编辑器已经支持 Ctrl+点击外链和笔记间链接，唯独文档内锚点静默失效，属于同一交互的半截实现；补上后与预览行为一致。结论：**做**。

**前端**：把 `normalizeAnchor` 提到 `preview-scroll` 供两处复用；`EditorPane` 在 Ctrl+点击命中 `#片段` 时按标题文字在大纲里定位，`jumpToEditorPosition` 移动光标，分栏时同时滚动预览。影响模块：编辑器链接点击、预览锚点。风险：低，只在现有点击分支前增加锚点判断，找不到标题时保持原样。工作量 **S**（3 个文件，约 35 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/preview/preview-scroll.ts`、`src/features/preview/PreviewPane.tsx`、`src/features/editor/EditorPane.tsx`。

**构建**：通过（`bun run build` 0.56s，含 tsc）。

## 第 24 轮 · 2026-10-30 10:38

**用户需求**：我在同一个文件夹里连续新建笔记或文件夹，第二次默认名还是「未命名.md」「新建文件夹」，确认后直接报「已存在」，只能自己再改个名。希望默认名自动加序号。

**产品经理**：连续新建是常见动作，默认名一撞名就失败，属于新建流程的明显粗糙处；自动取下一个可用名不改变用户最终命名权。结论：**做**。

**前端**：新增 `nextAvailableName(parent, base, ext)`，从已加载的同级条目里按不区分大小写找第一个可用名（`未命名`、`未命名 2`…）；新建文件与新建文件夹的默认值改用它，同级尚未加载或仍冲突时保持原有报错。影响模块：新建文件 / 文件夹对话框。风险：低，仅改默认值，不改变创建逻辑。工作量 **S**（1 个文件，约 18 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.70s，含 tsc）。

## 第 23 轮 · 2026-10-30 10:36

**用户需求**：上一轮删除前的提示让我知道会丢内容，但选项只有「直接删」和「取消」。想删又不想丢，只能取消、手动保存、再删一次。希望确认框直接给我「保存后删除」。

**产品经理**：只提示风险是止损，给出「保存后删除」才真正保住内容，且删除语义不变——文件连同最新内容一起进回收站，仍可还原。结论：**做**。

**前端**：`deleteEntry` 在存在未保存修改时提供三选一：保存后删除 / 直接删除 / 取消；选择保存后先 `saveActiveDocument()`，保存失败（冲突、IO、用户取消重载）则放弃删除，避免「保存没成功却把文件删了」。普通情况保持原两按钮。影响模块：文件树删除、保存。风险：低，删除路径本身不变，新增前置保存且有失败中止。工作量 **S**（1 个文件，约 25 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.59s，含 tsc）。

## 第 22 轮 · 2026-10-30 10:33

**用户需求**：我在写一篇笔记，顺手把这篇（或它所在的文件夹）删掉了。确认框只说「移到回收站可以撤销」，结果刚写还没保存的内容直接没了，回收站里也没有。希望删除前明确提醒未保存内容会丢。

**产品经理**：应用承诺「不静默丢弃未保存内容」，删除当前脏文档时旧文案只提回收站，容易让用户以为都能找回；这是文案层面的数据安全缺口，必须补。结论：**做**。

**前端**：`deleteEntry` 在弹确认框前判断被删条目是否包含当前文档且 `dirty`，是则换成明确说明「未保存修改不会写入文件、会直接丢失」的文案；删除逻辑不变。影响模块：文件树删除。风险：低，纯文案分支，不改任何删除 / 保存行为。工作量 **S**（1 个文件，约 12 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.62s，含 tsc）。

## 第 21 轮 · 2026-10-30 10:30

**用户需求**：设置面板底部的「恢复默认设置」一按，主题、字体、字号全被改回去，没有任何确认；我在手机上误触过一次，只能一项项调回来。希望先问一句再动手。

**产品经理**：应用在删除文件时都会二次确认，这里一次性覆盖全部偏好却是一键生效，和「操作前确认」的原则不一致；补确认成本很低。结论：**做**。

**前端**：`SettingsDialog` 的恢复按钮改为先弹出确认框，说明会覆盖哪些设置；确认后才调用 `reset()`，并 toast「已恢复默认设置」。确认框与设置面板同层，`DialogHost` 在设置弹层之后渲染，层级已够。影响模块：偏好设置。风险：低，仅增加一步确认，取消路径不改任何状态。工作量 **S**（1 个文件，约 20 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/settings/SettingsDialog.tsx`。

**构建**：通过（`bun run build` 0.79s，含 tsc）。

## 第 20 轮 · 2026-10-30 10:26

**用户需求**：我改完正在写的笔记的文件名后，没过几秒应用意外退出，重新打开却找不到刚才未保存的内容——原来改名时把恢复副本一并删掉了。改名只是换路径，希望恢复副本也跟着过去。

**产品经理**：改名不应降低崩溃保护；上一轮刚为「目录改名」做了副本迁移，文件改名仍停在直接删除，同一场景两套行为。结论：**做**。

**前端**：`workspace-actions` 的文件改名分支改为调用 `migrateRecoverySnapshot(oldPath, newPath)`，与目录改名走同一条安全路径（等写入完成、按新路径保存、再删旧副本）。影响模块：重命名、崩溃恢复。风险：低，只影响副本文件，不触碰源文件；新路径已有更新副本时仍只删旧的。工作量 **S**（1 个文件，约 6 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.66s，含 tsc）。

## 第 19 轮 · 2026-10-30 10:23

**用户需求**：我把正在写的笔记所在的文件夹改了名，下次打开应用却提示「某笔记有恢复副本，但原文件已经不在」，只能丢弃或稍后——文件明明还在，只是跟着目录换了位置。希望改名后恢复副本也跟着迁移到新路径。

**产品经理**：恢复提示是数据安全的最后一道提示，误报「文件已丢失」会让用户不敢信任它，甚至误丢未保存内容；上一轮修好了改名后保持文档打开，但恢复副本仍按旧路径保存。结论：**做**。

**前端**：`recovery.ts` 新增 `migrateRecoverySnapshot(oldPath, nextPath)`：等当前副本写入完成后读取快照，新路径已有副本则只删旧副本（避免旧内容覆盖新内容），否则按新路径重新保存再删旧的；失败时保留旧副本。`workspace-actions` 在「当前文档所在目录被改名」分支调用。影响模块：恢复副本、目录重命名。风险：低，与自动保存共用写入锁，不触碰源文件。工作量 **S**（2 个文件，约 40 行）。

**后端**：无改动（复用现有 `save_recovery` / `delete_recovery`）。工作量 **S**。

**裁决**：做。

**改动**：`src/features/editor/recovery.ts`、`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.62s，含 tsc）。

## 第 18 轮 · 2026-10-30 10:17

**用户需求**：我的笔记里有一篇叫「C# 入门」，在文件树右键「复制链接」粘到别的笔记里，点开却打不开（预览里也跳到错误位置）。希望文件名里带 `#` 之类的字符时，链接照样能用。

**产品经理**：生成的链接打不开，等于上一轮「复制链接」功能在常见文件名下失效；正确转义是链接生成的基本要求，修复只影响编码、不改变已有正常链接。结论：**做**。

**前端**：`paths.relativeLinkPath` 在原有 `%`、空格、括号转义后补上 `#` → `%23`、`?` → `%3F`；解析侧 `resolveRelLink` 先按 `#` / `?` 切分再 `decodeURIComponent`，转义后能正确还原。影响模块：复制链接、编辑器 Ctrl+点击、预览相对链接。风险：低，正常文件名编码结果不变。工作量 **S**（1 个文件，2 行 + 注释）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/lib/paths.ts`。

**构建**：通过（`bun run build` 0.58s，含 tsc）。另用 bun 对 `C# 入门.md`、`?`、括号与 `%` 文件名做了生成 → 解析往返校验，均还原为目标路径。

## 第 17 轮 · 2026-10-30 10:11

**用户需求**：我习惯切到纯预览读长文，滚到文档中段时，左边大纲还高亮着开头那一节，完全不知道自己在哪一章。希望预览里滚动时大纲能跟着亮起当前章节。

**产品经理**：大纲的核心价值是「我在哪」，只跟光标走等于在阅读场景下失效；分栏已经有滚动同步，预览模式补上高亮属于同一交互的收尾。不移动光标、不改正文，风险低。结论：**做**。

**前端**：`outline` store 增加 `scrollIndex`（仅预览模式有效，切换模式 / 切换文档时清空）；`preview-scroll` 增加只读的 `previewActiveHeadingIndex`；`PreviewPane` 在预览模式下监听滚动（rAF 节流）写入下标；`OutlinePanel` 预览模式优先用滚动下标，编辑 / 分栏仍跟随光标。影响模块：预览滚动、大纲高亮。风险：低，纯装饰性状态，不触发编辑器事务；点击大纲跳转仍会通过滚动事件自然对齐。工作量 **S**（4 个文件，约 55 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/stores/outline.ts`、`src/features/preview/preview-scroll.ts`、`src/features/preview/PreviewPane.tsx`、`src/features/outline/OutlinePanel.tsx`。

**构建**：通过（`bun run build` 0.56s，含 tsc）。

## 第 16 轮 · 2026-10-30 10:06

**用户需求**：我把一篇笔记改名或删掉后，空状态里的「最近打开」还挂着旧名字，点进去直接报错；在应用外删掉的文件也一样。希望这个列表跟着文件变化，不留下打不开的死链接。

**产品经理**：最近打开是上一轮刚加的功能，列表失效会直接变成错误入口，比没有这个功能更糟；删除 / 改名是日常操作，必须在同一次操作里同步。结论：**做**。

**前端**：`workspace` store 新增 `updateRecent(oldPath, nextPath)`，对文件本身和目录下的子项统一做替换 / 移除并持久化；`workspace-actions` 在重命名、删除成功后调用，打开失败时也顺手摘掉该条（覆盖应用外删除）。影响模块：工作区状态、文件树操作。风险：低，仅改动最近列表数据，不碰文件本身；空操作时不写存储。工作量 **S**（2 个文件，约 30 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/stores/workspace.ts`、`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.58s，含 tsc）。

## 第 15 轮 · 2026-10-30 10:01

**用户需求**：工具栏上写着重命名快捷键是 F2，可我正在正文里写字的时候按 F2 毫无反应，必须先用鼠标点一下左边的文件树才管用。希望光标在正文里时按 F2 也能直接弹出重命名。

**产品经理**：这是「界面承诺了、最常用场景下却不生效」的缺陷，用户按提示操作失败会怀疑快捷键坏了。修复不改变任何写作行为，也不与编辑器自有快捷键冲突。结论：**做**。

**前端**：`App.tsx` 的全局按键处理里，F2 分支原先用 `isTextEntry` 排除了正文（contenteditable），去掉该拦截并删除随之无用的 helper；设置面板、重命名输入框等场景仍由前面的 `dialogOpen()` 拦住，不会误触。影响模块：应用级快捷键。风险：低，F2 不是编辑器或浏览器默认按键。工作量 **S**（1 个文件，约 6 行）。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/app/App.tsx`。

**构建**：通过（`bun run build` 0.55s，含 tsc）。

## 第 14 轮 · 2026-10-30 09:58

**用户需求**：整个界面都是中文，按 Ctrl+F 弹出的查找替换面板却是英文（Find / Replace / next / regexp），每次都要在脑子里对一遍。希望查找栏也用中文。

**产品经理**：界面语言不一致是明显的粗糙处，尤其对不熟英文的用户；CodeMirror 原生提供短语表，不改任何行为、不新增依赖。结论：**做**。

**前端**：`editor-setup.ts` 注册 `EditorState.phrases`，把查找、替换、上一个/下一个、区分大小写、正则、跳到行等短语译成中文；未覆盖的短语仍回退英文。风险：短语键必须与 CodeMirror 内部字面量完全一致，否则该条不生效。工作量 **S**。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/editor/editor-setup.ts`。

**构建**：通过（`bun run build` 0.61s，含 tsc）。短语键取自 `@codemirror/search` 源码字面量；未做真机 Ctrl+F 验证。

## 第 13 轮 · 2026-10-30 09:55

**用户需求**：我从「工作」切回「个人」笔记库后，编辑器是空的，只能在一层层目录里翻昨天写的那几篇。希望打开工作区、还没选文件时，能看到这个库最近打开的几篇笔记，点一下直接继续写。

**产品经理**：README「计划中」明确列了「最近打开」；把范围收敛为「空编辑状态下的最近 5 篇」，不做菜单和全局列表，符合「安静」原则。结论：**做**。

**前端**：`stores/workspace.ts` 按工作区根路径持久化最近 5 条（沿用 `expandedDirs` 的 Tauri Store 模式），`openFile` 成功后记录；`App.tsx` 空状态在「新建文件」下方列出最近笔记（文件名 + 完整路径 tooltip），点击复用 `openFile`。风险：文件被外部删除或改名后条目会失效，点击时由现有错误 toast 兜底。工作量 **S**。

**后端**：无改动，复用 Tauri Store。工作量 **S**。

**裁决**：做。

**改动**：`src/stores/workspace.ts`、`src/features/workspace/workspace-actions.ts`、`src/app/App.tsx`。

**构建**：通过（`bun run build` 0.59s，含 tsc）。未做真机空状态验证。

## 第 12 轮 · 2026-10-30 09:48

**用户需求**：我正编辑着 `项目/设计.md`，在文件树里把 `项目` 文件夹改名，编辑器直接把文章关掉了；如果刚才有没保存的修改，内容就没了，连恢复副本也被清掉。希望改名后文章继续开着，路径跟着更新，未保存内容不丢。

**产品经理**：这是数据安全层面的缺陷——重命名一个目录就静默关闭文档并清恢复副本，违背「任何可能覆盖用户内容的行为都必须明确提示」。不改界面，只修正行为。结论：**做**。

**前端**：`workspace-actions.ts` 的重命名分支：目录改名时不再 `resetDocument`，而是把当前文档路径按新目录前缀替换并同步 `lastDocument`，正文、脏状态与自动保存都继续；不再清旧路径的恢复副本。风险：旧路径的光标记忆与恢复副本会成为孤立记录，属于无害残留；目录改名后展开状态仍按旧路径恢复，需手动再展开。工作量 **S**。

**后端**：无改动，仍走 `rename_entry`。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.58s，含 tsc）。未做真机重命名验证。

## 第 11 轮 · 2026-10-30 09:46

**用户需求**：我的笔记库在 OneDrive 里，另一台电脑改过同一篇后回到扉页，编辑器里还是旧内容，毫无提示，直到我按保存才弹出冲突。希望窗口重新获得焦点时，发现磁盘文件变了就提醒我重新加载。

**产品经理**：README「计划中」列了目录监听，完整监听成本高；窗口聚焦时做一次轻量 mtime 对比，能在不新增依赖、不加常驻监听的前提下覆盖跨设备同步这个最常见场景，契合「数据安全、不静默覆盖」。结论：**做**。

**前端**：`App.tsx` 监听 `window focus` 与 `visibilitychange`，在当前文档干净时读取文件 mtime，与 `savedModifiedMs` 不一致就弹「重新加载 / 稍后」，选择重新加载走现有 `reloadActiveDocument`；同一 mtime 只提示一次，脏文档交给现有保存冲突流程。风险：同步工具仅 touch 不换内容时会误报一次，可点「稍后」。工作量 **S**。

**后端**：无新命令，复用 `read_file` 的 mtime。工作量 **S**。

**裁决**：做。

**改动**：`src/app/App.tsx`。

**构建**：通过（`bun run build` 0.54s，含 tsc）。未做真机跨程序修改验证。

## 第 10 轮 · 2026-10-30 09:42

**用户需求**：同时开着几篇笔记、或者把窗口最小化再切回来时，任务栏和 Alt-Tab 里永远只显示「扉页」，分不清哪一个是正在写的那篇。希望系统层面显示的窗口标题跟着当前笔记名走，有未保存修改时也能看出来。

**产品经理**：应用内标题栏已经显示文件名，但系统级标题没跟上，在多任务切换时是实际困扰；不改界面、不引入依赖。结论：**做**。

**前端**：`App.tsx` 监听当前文档名与 dirty，调用 `getCurrentWindow().setTitle()`，格式 `文件名 — 扉页`，未保存时加 `• `；关闭文档时回到应用名，失败静默。风险：非 Tauri 环境忽略错误。工作量 **S**。

**后端**：`capabilities/default.json` 增加 `core:window:allow-set-title`（默认权限集不含该命令），无 Rust 逻辑改动；`cargo check` 验证权限清单可编译。工作量 **S**。

**裁决**：做。

**改动**：`src/app/App.tsx`、`src-tauri/capabilities/default.json`。

**构建**：通过（`bun run build` 0.81s；`cargo check` 退出码 0）。未做真机任务栏验证。

## 第 9 轮 · 2026-10-30 09:36

**用户需求**：我在笔记之间互相引用，每次都要手动敲 `[标题](03-结构/编辑内核.md)`，目录一深就容易写错；照着状态栏抄路径也麻烦。希望文件树右键笔记时能「复制链接」，得到相对当前文档的 Markdown 链接，直接粘到正文里。

**产品经理**：前几轮刚让预览与编辑区都能打开笔记链接，创建链接却仍靠手写，是链接工作流的另一半；不新增面板、不引入依赖。结论：**做**。

**前端**：`lib/paths.ts` 新增 `relativeLinkPath`（计算相对当前文档目录的路径，只转义空格、括号、百分号，中文保持原样）；`workspace-actions.ts` 新增 `copyEntryLink`，用现有 `copyText` 写入 `[标题](路径)` 并 toast；`WorkspaceSidebar` 右键文件时显示「复制链接」。风险：没有打开文档时以工作区根目录为基准；重名笔记由路径区分。工作量 **S**。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/lib/paths.ts`、`src/features/workspace/workspace-actions.ts`、`src/features/workspace/WorkspaceSidebar.tsx`。

**构建**：通过（`bun run build` 0.62s，含 tsc）。`relativeLinkPath` 用 bun 跑了 5 组路径用例并验证 `resolveRelLink` 往返还原（空格与括号转义）；未做真机菜单验证。

## 第 8 轮 · 2026-10-30 09:30

**用户需求**：写嵌套列表或代码块时按 Tab 想缩进，焦点却直接跳到工具栏，光标离开正文；Shift+Tab 也一样。希望 Tab / Shift+Tab 在编辑器里就是缩进 / 反缩进。

**产品经理**：写作与写代码都离不开 Tab 缩进，现在它是唯一会「逃出编辑器」的常用键，属于编辑器基础体验缺口；不新增控件、不引入依赖。结论：**做**。

**前端**：`format-keymap.ts` 新增 `indentLines`：对主选区的每一行在行首加两个空格，Shift+Tab 去掉至多一个 Tab 或两个空格；单选区时同步移动光标，多行选区交给变更映射；直接复用 CodeMirror 现有 API，不引入 `@codemirror/commands` 新依赖。风险：Tab 被编辑器捕获后无法用 Tab 移出焦点，CodeMirror 内置的 `Ctrl+M` 可临时恢复 Tab 焦点模式；列表标记本身不在行首时只调整缩进，不做结构性提升。工作量 **S**。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/editor/format-keymap.ts`。

**构建**：通过（`bun run build` 0.72s，含 tsc）。未做真机按键验证。

## 第 7 轮 · 2026-10-30 09:25

**用户需求**：改稿前想留一份当前版本，只能新建文件再全选复制粘贴。希望工具栏有「另存为」：把当前内容存成同目录下的新笔记并切过去，原文件保持上次保存的样子。

**产品经理**：README「计划中」已列出「另存副本」，是本地写作的真实需求；复用现有新建/写入命令，不新增后端接口、不改文件格式。结论：**做**。

**前端**：`workspace-actions.ts` 新增 `saveDocumentAs`：输入新文件名（沿用第 6 轮的后缀补全与校验），`create_file` + `write_file` 写入同目录，然后把当前文档改指向新文件并标记已保存、清理旧路径恢复副本、更新 `lastDocument`；`Toolbar` 加「另存为」按钮，`App` 绑定 `Ctrl+Shift+S`。风险：写入失败会留下空文件；原文件的未保存修改不会回写（另存为的常规语义）。工作量 **S**。

**后端**：无新命令，复用 `create_file` / `write_file` 的原子写入与工作区校验。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`、`src/app/Toolbar.tsx`、`src/app/App.tsx`。

**构建**：通过（`bun run build` 0.93s，含 tsc）。未做真机验证；未同步 README 的「计划中」条目，留待评审时更新。

## 第 6 轮 · 2026-10-30 09:19

**用户需求**：新建笔记时输入框默认全选「未命名.md」，我直接打「周报」，回车却提示「文件名需要以 .md 结尾」，只好退回去补后缀。重命名也一样。希望没写扩展名时自动补 `.md`，只有写了别的扩展名才报错。

**产品经理**：新建与重命名是每天都用的动作，默认全选又逼用户记住后缀，属于已实现流程的粗糙处；不改界面、不加依赖，只放宽输入。结论：**做**。

**前端**：`workspace-actions.ts` 新增统一的扩展名处理：校验时无扩展名的名称放行、有非 Markdown 扩展名才报错；提交前给无扩展名的名称补 `.md`，重命名补完后与原名相同则静默不操作。风险：`v1.2` 这类含点的名字仍会被当成扩展名报错，可手动补后缀。工作量 **S**。

**后端**：无改动，仍走现有 `validate_name` 与重名检查。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build` 0.82s，含 tsc）。未做真机验证。

## 第 5 轮 · 2026-10-30 09:16

**用户需求**：我把自动保存关了改用 Ctrl+S（OneDrive 同步会冲突），可状态栏从此一直显示「待保存」，一小时也不变，看着像保存卡住了。希望关掉自动保存时，状态栏明确写「未保存 · Ctrl+S」，而不是暗示它在等自动保存。

**产品经理**：第 6 轮加入「关闭自动保存」后，状态栏文案没有跟着区分，语义上把「等你手动保存」说成了「待自动保存」；只改一个文案与提示，不新增控件。结论：**做**。

**前端**：`StatusBar.tsx` 读取 `preferences.autoSaveDelay`，为 0 且 dirty 时显示「未保存 · Ctrl+S」，`title` 说明自动保存已关闭；其余状态（保存中 / 保存暂停 / 已保存）不变。风险：仅文案变化，不影响保存逻辑。工作量 **S**。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/app/StatusBar.tsx`。

**构建**：通过（`bun run build` 0.55s，含 tsc）。未做真机验证。

## 第 4 轮 · 2026-10-30 09:10

**用户需求**：我用笔记之间的相对链接（或在编辑区 Ctrl+点击）跳到另一篇，文章打开了，但左侧文件树没有跟着展开、也没滚到那个文件，深一点的目录里完全看不出自己现在在哪。希望打开任何文档时，文件树都自动展开并定位到它。

**产品经理**：第 3 轮刚让编辑区链接可点、第 12 轮让预览链接可点，但跳转后文件树不动，跨笔记导航只完成了一半；不新增控件，属于已实现功能的粗糙处。结论：**做**。

**前端**：把启动恢复里的「逐级展开父目录」抽成 `expandAncestors`，在 `openFile` 成功后统一调用（启动恢复改为复用）；`TreeNode` 在当前文件变为激活时 `scrollIntoView({ block: "nearest" })`。风险：打开文件会展开用户手动收起的父目录——这是定位所必需；根目录文件为空操作。工作量 **S**。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`、`src/features/workspace/WorkspaceSidebar.tsx`。

**构建**：通过（`bun run build` 0.74s，含 tsc）。未做真机点击验证。

## 第 3 轮 · 2026-10-30 09:06

**用户需求**：我默认用所见即所得写笔记，正文里有 `[下一章](02-结构.md)` 这样的链接，点上去只会把光标放进去，打不开；同样的链接切到预览就能点开。希望所见即所得里按住 Ctrl（Mac 是 ⌘）点击链接也能打开。

**产品经理**：预览已支持外链与相对链接，默认视图却点不动，是同一能力在不同视图下的缺口；不新增控件、不引入依赖。结论：**做**。

**前端**：`editor-bridge.ts` 新增 `linkAtPosition`，从语法树里向上找到 `Link` / `Autolink` 节点并取 `URL` 子节点；`EditorPane` 在捕获阶段监听 Ctrl/⌘+左键，解析出地址后复用预览的打开逻辑（http(s) 交系统浏览器，`.md` 相对链接走 `openFile`）。风险：macOS 上 ⌘+点击与 CodeMirror 多选冲突，捕获阶段拦截后只剩打开链接；锚点与其它协议保持不处理。工作量 **S**。

**后端**：无改动，复用 `openFile` 与现有工作区校验。工作量 **S**。

**裁决**：做。

**改动**：`src/features/editor/editor-bridge.ts`、`src/features/editor/EditorPane.tsx`。

**构建**：通过（`bun run build` 0.65s，含 tsc）。未做真机点击验证。

## 第 2 轮 · 2026-10-30 09:00

**用户需求**：在预览里点大纲跳到第五章看完，切回所见即所得想接着改，光标却还停在第一章开头，得再滚一遍。希望点大纲时编辑器光标也跟着到那一章。

**产品经理**：大纲跳转在源码 / 分栏里会移动光标，只有预览模式不移动——同一交互在不同视图下不一致，属于已实现功能的粗糙处；不新增控件、不引入依赖。结论：**做**。

**前端**：只改 `OutlinePanel.tsx` 的 `jump`：预览模式下先用 `jumpToEditorPosition(heading.from, false)` 同步光标但不抢焦点，再滚动预览。风险：光标变化会触发预览「切到预览停在光标标题」的效果，但目标同一标题，最多重复滚一次。工作量 **S**。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/outline/OutlinePanel.tsx`。

**构建**：通过（`bun run build` 0.61s）。预览模式下编辑器常驻挂载（仅 CSS 隐藏），光标同步与切回编辑后的位置由同一 CodeMirror state 保证；未做真机点击验证。

## 第 1 轮 · 2026-10-30 08:55

**用户需求**：写完一篇笔记想在资源管理器里看看它在磁盘上的位置、顺手把配图放进去，现在只能自己从文件夹一层层找过去；文件树右键只有新建 / 重命名 / 删除。希望右键笔记或文件夹时能「在资源管理器中显示」，直接定位到那一项。

**产品经理**：桌面编辑器的基本动作，属于文件树右键菜单的自然补全；不新增面板、不引入依赖，也不触碰「暂不做」。结论：**做**。

**前端**：`lib/tauri.ts` 新增 `revealEntry` 封装；`workspace-actions.ts` 新增调用与失败 toast；`WorkspaceSidebar` 右键菜单加「在资源管理器中显示」，空白处右键定位工作区根目录。风险：根目录传空路径由后端解析为根；失败不打断编辑。工作量 **S**。

**后端**：`commands/file.rs` 新增 `reveal_entry`：复用 `resolve_in_workspace` 做边界与符号链接校验，抽 `reveal_target` 校验目标存在，再调已有的 `tauri_plugin_opener::reveal_item_in_dir`（不新增依赖、不改 capabilities）；`lib.rs` 注册命令并补充单测。风险：目标被外部删除时返回 NotFound；跨平台定位由插件处理。工作量 **S**。

**裁决**：做。

**改动**：`src/lib/tauri.ts`、`src/features/workspace/workspace-actions.ts`、`src/features/workspace/WorkspaceSidebar.tsx`、`src-tauri/src/commands/file.rs`、`src-tauri/src/lib.rs`。

**构建**：通过（`bun run build` 0.71s；`cargo test` 30 项全通过，含新增 `resolves_reveal_targets_inside_workspace`）。未在真机点开资源管理器做手动验证，路径解析由单测覆盖。

## 第 13 轮 · 2026-10-30 07:29

**用户需求**：长文开头写了目录，用 `[第二章](#第二章--编辑内核)` 这种文档内锚点互相跳转。源码里点不动，切到预览点上去也没有任何反应——预览给每个标题重新编号成内部锚点，自己写的 `#章节` 链接全都悬空。希望点目录能直接滚到对应标题。

**产品经理**：文章内目录是长文写作的常见结构，Markdown 的锚点语法本来就该能用；不新增界面，也不需要新依赖或新文件格式。结论：**做**。

**前端**：只改 `PreviewPane.tsx`：点击处理新增 `#` 片段分支，用「只保留字母与数字」的归一化把片段和预览标题文字对齐（同时兼容中文标题、`·` / 空格 / 破折号等分隔符与百分号编码），命中后 `preventDefault` 并复用现有的 `scrollPreviewToHeading`；找不到标题就交还浏览器默认行为。风险：归一化后仍可能撞到同名标题（取第一个），这是文档作者本就要避免的；不会误拦截图片等其它链接。工作量 **S**。

**后端**：无改动：锚点解析完全在前端已完成渲染的 DOM 上做，不涉及命令与文件系统。工作量 **S**。

**裁决**：做。

**改动**：`src/features/preview/PreviewPane.tsx`。

**构建**：通过（`bun run build`，1.23s；首次报退出码 9，本机内存紧张，重试通过）。手动验证：临时文档含目录链接与三章内容，预览中点「去编辑内核」，第二章标题从视口下方（Y=1142）滚到预览顶部（Y=407）；验证后已删除临时文件。

## 第 12 轮 · 2026-10-30 07:15

**用户需求**：我在笔记里用 `[上一篇](04-长文与大纲.md)` 这样的相对链接互相引用，源码里看着没问题，切到预览点上去却毫无反应——外部 http 链接会自动交给系统浏览器，指向本库其他笔记的链接反而什么都不做。希望点一下就在应用内打开那篇笔记。

**产品经理**：外部链接已经能打开，内部链接却断在这里，是同一处交互的半成品；本地优先的笔记库天然靠相对链接组织，不修等于让预览只读不能用。不新增界面、不引入依赖。结论：**做**。

**前端**：`lib/paths.ts` 新增 `resolveRelLink(href, fromFile)`：去掉 `#锚点` 与 `?查询`，尝试 `decodeURIComponent`，拒绝协议链接与以 `/`、`\` 开头的绝对路径，按当前文档所在目录拼接并归一化 `./`、`../`，跳出工作区返回 `null`；`PreviewPane.tsx` 在 http 分支之后接上相对链接：解析结果以 `.md` / `.markdown` / `.mdx` 结尾时 `preventDefault` 并 `openFile`，其余（图片、锚点、未知扩展名）保持浏览器默认。风险：文件名与目录重名时按解析出的完整路径打开即可；指向不存在文件的链接由 `openFile` 的 toast 兜底，不会白屏。工作量 **S**。

**后端**：无改动，复用现有 `read_file` 与工作区路径校验，不新增命令。工作量 **S**。

**裁决**：做。

**改动**：`src/lib/paths.ts`、`src/features/preview/PreviewPane.tsx`。

**构建**：通过（`bun run build`，5.02s）。手动验证：新建临时文件写入 `[打开长篇](04-长文与大纲.md)`，预览中点击后标题、路径与字数切到 `04-长文与大纲.md`（847 字）；`resolveRelLink` 另用脚本核对相对路径、百分号编码、`../` 越界与协议链接七种输入。验证后已删除临时文件。

## 第 11 轮 · 2026-10-29 20:57

**用户需求**：我用预览模式检查周报，清单里的任务想顺手勾掉已经做完的，点方框完全没反应——它是灰的，只能切回源码把 `[ ]` 手动改成 `[x]`。希望预览里的复选框能直接点。

**产品经理**：README 已承诺「所见模式任务复选框」可交互，预览却只渲染不能点，属于同一能力的不一致；不新增界面、不引入依赖。结论：**做**。

**前端**：`editor-bridge.ts` 新增 `toggleTaskMarkerAt`：在语法树里按顺序取出 `TaskMarker`，数量与预览复选框一致时才翻转第 N 个的 `[ ] / [x]`，否则放弃，避免勾错行；`PreviewPane.tsx` 渲染后放开 `disabled` 并在点击时阻止默认行为；`preview.css` 加手型光标。风险：预览复选框与语法树节点顺序不一致（如原始 HTML 里的 input）时由数量校验兜底，最坏是不响应。工作量 **S**。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/editor/editor-bridge.ts`、`src/features/preview/PreviewPane.tsx`、`src/features/preview/preview.css`。

**构建**：通过（`bun run build`，1.20s）。手动验证：预览里勾选「目录监听」，文件从 `- [ ]` 变为 `- [x]` 并由自动保存落盘；再点一次恢复为 `- [ ]`。

## 第 10 轮 · 2026-10-29 20:52

**用户需求**：在源码里改到文章后半段，切到「预览」想看排版效果，预览却总是从标题开始，得重新滚下来找刚才的位置。希望切到预览时停在光标所在的标题附近。

**产品经理**：连续阅读体验的补全，不新增任何控件；复用现有大纲与标题锚点，不引入新状态。结论：**做**。

**前端**：只改 `PreviewPane.tsx`：视图切到 `preview` 时，按光标行在大纲里找最近的标题索引，调用现有 `scrollPreviewToHeading`，等一帧恢复布局后再滚动。风险：依赖大纲与预览标题顺序一致，这和分栏滚动同步、大纲跳转是同一套假设；没有标题的文档保持原滚动位置。工作量 **S**。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/preview/PreviewPane.tsx`。

**构建**：通过（`bun run build`，1.34s）。手动验证：源码里 `Ctrl+End` 到第 91 行 → 切到预览，直接停在第 6 章「暂不做 / 长期」而不是开头。

## 第 9 轮 · 2026-10-29 20:45

**用户需求**：一篇长笔记常常要分几次打开。现在每次点开文件光标都回到第一行，得一路滚回去找刚才写到哪。希望打开文档时直接回到上次的光标位置。

**产品经理**：和「恢复上次文档」「展开所在目录」属于同一类连续性体验；不新增界面，也不往正文写任何标记，记录只存在本地 Store。结论：**做**。

**前端**：新增 `cursor-memory.ts`：内存 Map 保存路径 → 偏移，400ms 防抖写入，最多保留 200 条；`openFile` 切换前记录、加载后恢复；`EditorPane` 在光标移动时更新。停在文档顶部时清掉记录，避免下次跳回旧位置；偏移由 `jumpToEditorPosition` 夹到文档长度内。风险：新文档加载瞬间的 0 偏移会被忽略，不会覆盖已存位置。工作量 **S**。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/editor/cursor-memory.ts`（新增）、`src/features/workspace/workspace-actions.ts`、`src/features/editor/EditorPane.tsx`。

**构建**：通过（`bun run build`）。手动验证：点击正文第 56 行 → 切到另一篇再切回，状态栏回到 `56:1`。

## 第 8 轮 · 2026-10-29 20:25

**用户需求**：启动后文章是自动打开了，但左侧文件树还停在收起状态，看不到这篇文章在哪个文件夹里，也不知道自己在库里的位置。

**产品经理**：这是第 7 轮「恢复上次文档」留下的缺口，补上才算完整；不新增控件。结论：**做**。

**前端**：只改 `workspace-actions.ts`：恢复文档前按路径逐级展开父目录，`expandDir` 会顺带持久化展开状态，下次启动仍保持。风险：与第 3 轮异步恢复展开状态存在极小竞态，最坏结果是某一级需要手动再点开，不影响数据。工作量 **S**。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build`，1.26s）。首次构建报 `memory allocation ... failed`（退出码 9），重试通过；本机内存压力偏大。


## 第 7 轮 · 2026-10-29 20:19

**用户需求**：每天早上打开扉页继续写昨晚的文章，工作区是恢复了，但编辑器还是空的，得在文件树里再找一遍。希望启动时直接打开上次那篇，接着写。

**产品经理**：和「记住上次工作区」属于同一类连续性体验；不新增界面，失败时静默回退，不打扰启动。结论：**做**。

**前端**：只改 `workspace-actions.ts`：打开文件时记录 `lastDocument`，启动恢复工作区后按记录打开；`openFile` 增加静默参数，文件已删除时清掉记录；删除/重命名当前文档时同步更新。风险：启动阶段 `guardUnsaved` 无文档可守，不会弹窗。工作量 **S**。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/workspace-actions.ts`。

**构建**：通过（`bun run build`，1.09s）。首次构建在 vite transform 阶段异常退出（253），重试通过；与本机 rustc 崩溃疑似同一环境问题。


## 第 6 轮 · 2026-10-29 20:14

**用户需求**：我把笔记库放在 OneDrive 里，扉页每停两秒就写一次文件，同步客户端一直上传、偶尔还生成冲突副本。希望能关掉自动保存、改用 Ctrl+S 手动存，但崩溃恢复副本要保留。

**产品经理**：自动保存本来就只是「默认」，不是不可关闭的承诺；关掉后仍有恢复副本与未保存守卫，数据安全底线不变。契合本地优先与用户可控。结论：**做**。

**前端**：`PREFERENCE_LIMITS.autoSaveDelay` 允许 0；设置面板新增「关闭（手动保存）」选项；`scheduleAutoSave` 在延迟 ≤ 0 时不再排定时器，`noteDocumentChange` 仍照常刷新恢复副本。风险：关闭后状态栏会长期显示「待保存」，切换/关闭文档时仍有未保存守卫。工作量 **S**。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/stores/settings.ts`、`src/features/settings/SettingsDialog.tsx`、`src/features/editor/autosave.ts`。

**构建**：通过（`bun run build`，1.17s）。


## 第 5 轮 · 2026-10-29 20:13

**用户需求**：翻译和校对时经常框选一段文字，想知道选中的到底有多少字；现在状态栏只有全文总字数，得全选复制到别处才能数。希望选中文字时，状态栏直接显示选区字数。

**产品经理**：写作工具的基础信息，契合「为写作服务」；不新增面板，只在状态栏多一个数字，符合「安静」原则。结论：**做**。

**前端**：`stores/editor.ts` 增加 `selectedWords`；`EditorPane` 在现有 `onCursor` 回调里用 `countTextStats` 统计选区；`StatusBar` 在选中时显示「选中 N 字」。风险：选区很大时每次选区变化都要统计，但只在 `docChanged || selectionSet` 且非空时计算，可接受。工作量 **S**。

**后端**：无改动。工作量 **S**。

**裁决**：做。

**改动**：`src/stores/editor.ts`、`src/features/editor/EditorPane.tsx`、`src/app/StatusBar.tsx`。

**构建**：通过（`bun run build`，1.38s）。

**备注**：本轮另评估过「拖入图片保留原文件名」，需要改 Rust 的 `sanitize_base_name`。本机 `cargo check` 在编译依赖 `memchr` / `windows` 时 rustc 直接崩溃（`STATUS_STACK_BUFFER_OVERRUN`），无法验证 Rust 改动，已回滚并延后。


## 第 4 轮 · 2026-10-29 20:05

**用户需求**：侧栏固定 240px，我的文件夹和文件名比较长，标题经常被截断成省略号；写长文档时又希望侧栏窄一点、正文宽一点。希望侧栏右边缘能拖动调宽，双击回到默认宽度。

**产品经理**：契合「安静、正文优先」——把空间控制权交给用户，属于文件树的可用性补全；没有新增功能面，也没有新依赖。结论：**做**。

**前端**：`WorkspaceSidebar` 增加指针拖拽与宽度状态，宽度写入 Tauri Store；`App.css` 增加 6px 命中区与悬停反馈。风险：指针捕获要在 `pointerup` / `pointercancel` 正确释放；宽度需限幅 180–420，双击恢复 240。工作量 **S**。

**后端**：无 Rust 改动，复用现有 Tauri Store 读写。工作量 **S**。

**裁决**：做。

**改动**：`src/features/workspace/WorkspaceSidebar.tsx`、`src/app/App.css`。

**构建**：通过（`bun run build`，1.27s）。


## 第 3 轮 · 2026-10-29 19:50

**用户需求**：我的笔记库分了三层文件夹。每次打开扉页，所有目录都是折叠的，得先一层层点开才能找到昨天写的文件。希望它能记住我上次展开了哪些文件夹，下次打开直接保持原样。

**产品经理**：契合「本地优先、安静」；不引入新格式或云服务；和「记住上次工作区」属于同一类便利，是既有能力的补全。结论：**做**。

**前端**：只改 `stores/workspace.ts`：按工作区根路径把展开集合写进 Tauri Store，`setWorkspace` 时异步恢复并重新加载这些目录。风险：外部删掉的目录会加载失败，恢复阶段需静默跳过；`collapseAll` 也要写回。工作量 **S**。

**后端**：无 Rust 改动，复用现有 Tauri Store 读写，路径只作为键，不触碰文件系统。工作量 **S**。

**裁决**：做。

**改动**：`src/stores/workspace.ts`。

**构建**：通过（`bun run build`，1.20s）。


## 第 2 轮 · 2026-10-29 19:47

**用户需求**：我写旅行笔记时照片都在磁盘里。扉页支持粘贴截图和拖拽，但工具栏里没有「插入图片」的按钮，每次都得先打开资源管理器再拖进来，很别扭。希望工具栏有个图片按钮，点开选图，插到光标处。

**产品经理**：README 已完成项「本地图片」承诺的就是粘贴与拖入，补一个文件选择入口属于同一能力的自然补全，没有扩大产品边界；复用现有 `assets/` 与安全校验，不引入新依赖。结论：**做**。

**前端**：`Toolbar` 增加隐藏 `input[type=file]` 与图片按钮；`image-insert.ts` 导出 `insertImageFiles`，沿用当前选区。风险：重复选择同一张图片需重置 `input.value`；预览视图下应禁用；文件对话框打开期间选区由 CodeMirror 保持。工作量 **S**。

**后端**：不涉及 `src-tauri/` 改动，复用 `save_image_asset`（图片头校验、唯一命名、工作区限制）。工作量 **S**。

**裁决**：做。

**改动**：`src/app/Toolbar.tsx`、`src/features/editor/image-insert.ts`。

**构建**：通过（`bun run build`，1.06s）。


## 第 1 轮 · 2026-10-29 19:40（手动演练）

**用户需求**：我平时用扉页写中文长篇，偶尔夹杂英文。现在正文只有系统默认的一类无衬线字体，看久了眼睛累；设置里能调字号、行高、行宽，却唯独不能换字体。希望能像 Typora 一样选正文字体（至少「系统默认 / 宋体 / 楷体」），选完编辑区和预览一起变，标题保持现在的衬线气质。

**产品经理**：契合「安静、为写作服务」的定位；README「计划中」已明确列出「字体族选择与更多主题预设」，在边界内；只动正文不动标题，不破坏「墨线 · 靛青」的气质；成本低。结论：**做**。

**前端**：`stores/settings.ts` 增加 `fontFamily` 与字体栈常量；`SettingsDialog` 在「排版」里加一个下拉；`App.tsx` 把字体栈注入 `--font-body` 与 `--font-editor`。风险：`--font-editor: var(--font-body)` 在 `:root` 已解析，只覆盖 `--font-body` 不会生效，必须两个变量同时覆盖；字体缺失时依赖回退栈。工作量 **S**。

**后端**：不涉及 `src-tauri/`。偏好仍写入现有 Tauri Store 的 `preferences` 键，`normalizePreferences` 对旧数据回退到默认值；无文件系统与原子写入影响。工作量 **S**。

**裁决**：做。

**改动**：`src/stores/settings.ts`、`src/features/settings/SettingsDialog.tsx`、`src/app/App.tsx`。

**构建**：通过（`bun run build`：tsc + vite，1.33s）。
