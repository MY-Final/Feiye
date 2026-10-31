import {
  copyActiveAsHtml,
  exportActiveAsHtml,
  printActiveDocument,
} from "../../app/Toolbar";
import {
  PREFERENCE_LIMITS,
  useSettingsStore,
} from "../../stores/settings";
import { useDocumentStore, type ViewMode } from "../../stores/document";
import { useTabsStore } from "../../stores/tabs";
import { useUiStore } from "../../stores/ui";
import { useWorkspaceStore } from "../../stores/workspace";
import { openEditorSearch } from "../editor/editor-bridge";
import { saveActiveDocument } from "../editor/save";
import {
  changeViewMode,
  chooseWorkspace,
  newDocumentNearActive,
  openNextDocument,
  openPreviousDocument,
  renameActiveDocument,
  saveDocumentAs,
} from "../workspace/workspace-actions";

/** 命令是否可用只取决于这几项状态，菜单和命令面板共用同一份判断。 */
export interface CommandContext {
  hasDoc: boolean;
  hasWorkspace: boolean;
  canBack: boolean;
  canForward: boolean;
  viewMode: ViewMode;
  sidebarVisible: boolean;
}

export type CommandGroup = "file" | "nav" | "view" | "find" | "app";

/** 不可用时用来解释原因，菜单项的 title 直接取这里的描述。 */
type CommandNeed = "workspace" | "doc" | "back" | "forward";

export interface AppCommand {
  id: string;
  /** 命令面板里显示的完整名称。 */
  title: string;
  /** 菜单里更短的名称，缺省沿用 title。 */
  menuLabel?: string;
  hint?: string;
  shortcut?: string;
  keywords?: string;
  group: CommandGroup;
  need?: CommandNeed;
  enabled(ctx: CommandContext): boolean;
  checked?(ctx: CommandContext): boolean;
  /** 只为命令面板提供，不进入 ⋯ 菜单。 */
  menu?: false;
  /** 只为 ⋯ 菜单提供，不进入命令面板。 */
  palette?: false;
  run(): void | Promise<void>;
}

export function readCommandContext(): CommandContext {
  const doc = useDocumentStore.getState();
  const workspace = useWorkspaceStore.getState();
  const ui = useUiStore.getState();
  return {
    hasDoc: Boolean(doc.path),
    hasWorkspace: Boolean(workspace.root),
    canBack: Boolean(doc.path) && workspace.history.length > 0,
    canForward: Boolean(doc.path) && workspace.forward.length > 0,
    viewMode: doc.viewMode,
    sidebarVisible: ui.sidebarVisible,
  };
}

export function disabledReason(
  command: AppCommand,
  context: CommandContext,
): string | undefined {
  switch (command.need) {
    case "workspace":
      return "先打开一个工作区";
    case "doc":
      return "先打开一篇笔记";
    case "back":
      return context.hasDoc
        ? "本次会话里还没有可返回的笔记"
        : "先打开一篇笔记";
    case "forward":
      return context.hasDoc ? "还没有可前进的笔记" : "先打开一篇笔记";
    default:
      return undefined;
  }
}

const hasDoc = (ctx: CommandContext) => ctx.hasDoc;
const hasWorkspace = (ctx: CommandContext) => ctx.hasWorkspace;

function changeFontSize(delta: number): void {
  const { preferences, update } = useSettingsStore.getState();
  const { min, max, step } = PREFERENCE_LIMITS.fontSize;
  const next = Math.min(max, Math.max(min, preferences.fontSize + delta * step));
  if (next !== preferences.fontSize) update({ fontSize: next });
}

/** 应用内动作的单一来源：命令面板按 available 过滤，⋯ 菜单显示全部分组。 */
export const APP_COMMANDS: AppCommand[] = [
  {
    id: "new",
    title: "新建笔记",
    hint: "在当前笔记旁",
    shortcut: "Ctrl+N",
    keywords: "new note 新建",
    group: "file",
    need: "workspace",
    enabled: hasWorkspace,
    run: async () => {
      if (!useWorkspaceStore.getState().root) {
        useUiStore.getState().toast("先打开一个工作区再新建笔记");
        return;
      }
      await newDocumentNearActive();
    },
  },
  {
    id: "open-workspace",
    title: "打开文件夹…",
    shortcut: "Ctrl+O",
    keywords: "workspace folder 工作区 库",
    group: "file",
    enabled: () => true,
    run: () => chooseWorkspace(),
  },
  {
    id: "save",
    title: "保存",
    shortcut: "Ctrl+S",
    keywords: "save 保存",
    group: "file",
    need: "doc",
    enabled: hasDoc,
    run: () => {
      void saveActiveDocument();
    },
  },
  {
    id: "save-as",
    title: "另存为…",
    shortcut: "Ctrl+Shift+S",
    keywords: "save as 副本",
    group: "file",
    need: "doc",
    enabled: hasDoc,
    run: () => saveDocumentAs(),
  },
  {
    id: "rename",
    title: "重命名当前笔记…",
    menuLabel: "重命名…",
    shortcut: "F2",
    keywords: "rename 改名",
    group: "file",
    need: "doc",
    enabled: hasDoc,
    run: () => renameActiveDocument(),
  },
  {
    id: "copy-html",
    title: "复制 HTML",
    hint: "按预览排版，可直接粘进邮件",
    shortcut: "Ctrl+Shift+E",
    keywords: "copy html 剪贴板",
    group: "file",
    need: "doc",
    enabled: hasDoc,
    run: () => copyActiveAsHtml(),
  },
  {
    id: "export-html",
    title: "导出 HTML…",
    hint: "写到当前笔记同目录",
    keywords: "export html 导出",
    group: "file",
    need: "doc",
    enabled: hasDoc,
    run: () => exportActiveAsHtml(),
  },
  {
    id: "print-pdf",
    title: "导出 PDF…",
    hint: "按打印版式打开系统打印对话框，可选另存为 PDF",
    shortcut: "Ctrl+P",
    keywords: "pdf print 打印 导出 另存",
    group: "file",
    need: "doc",
    enabled: hasDoc,
    run: () => printActiveDocument(),
  },
  {
    id: "history",
    title: "版本历史…",
    hint: "回看每次保存留下的快照并恢复",
    shortcut: "Ctrl+Alt+H",
    keywords: "history version 历史 快照 版本",
    group: "file",
    need: "doc",
    enabled: hasDoc,
    run: () => useUiStore.getState().openHistory(),
  },
  {
    id: "back",
    title: "返回上一篇笔记",
    menuLabel: "返回上一篇",
    shortcut: "Alt+←",
    keywords: "back history 返回 后退",
    group: "nav",
    need: "back",
    enabled: (ctx) => ctx.canBack,
    run: () => openPreviousDocument(),
  },
  {
    id: "forward",
    title: "前进到下一篇笔记",
    menuLabel: "前进下一篇",
    shortcut: "Alt+→",
    keywords: "forward history 前进",
    group: "nav",
    need: "forward",
    enabled: (ctx) => ctx.canForward,
    run: () => openNextDocument(),
  },
  {
    id: "view-source",
    title: "视图：源码",
    menuLabel: "源码",
    keywords: "view source 源码",
    group: "view",
    need: "doc",
    enabled: hasDoc,
    checked: (ctx) => ctx.viewMode === "source",
    run: () => changeViewMode("source"),
  },
  {
    id: "view-split",
    title: "视图：分栏",
    menuLabel: "分栏",
    keywords: "view split 分栏",
    group: "view",
    need: "doc",
    enabled: hasDoc,
    checked: (ctx) => ctx.viewMode === "split",
    run: () => changeViewMode("split"),
  },
  {
    id: "view-preview",
    title: "视图：预览",
    menuLabel: "预览",
    keywords: "view preview 预览 阅读",
    group: "view",
    need: "doc",
    enabled: hasDoc,
    checked: (ctx) => ctx.viewMode === "preview",
    run: () => changeViewMode("preview"),
  },
  {
    id: "view-live",
    title: "视图：所见即所得",
    menuLabel: "所见即所得",
    keywords: "view live wysiwyg 所见",
    group: "view",
    need: "doc",
    enabled: hasDoc,
    checked: (ctx) => ctx.viewMode === "wysiwyg",
    run: () => changeViewMode("wysiwyg"),
  },
  {
    id: "zen",
    title: "专注模式",
    shortcut: "Ctrl+Shift+F",
    keywords: "zen focus 专注",
    group: "view",
    need: "doc",
    enabled: hasDoc,
    run: () => useUiStore.getState().toggleZenMode(),
  },
  {
    id: "sidebar",
    title: "显示 / 隐藏侧栏",
    menuLabel: "显示侧栏",
    hint: "Ctrl+B 同样可以切换",
    shortcut: "Ctrl+B",
    keywords: "sidebar 侧栏",
    group: "view",
    need: "workspace",
    enabled: hasWorkspace,
    checked: (ctx) => ctx.sidebarVisible,
    run: () => useUiStore.getState().toggleSidebar(),
  },
  {
    id: "split-preview",
    title: "分屏对照",
    hint: "右侧并排预览另一篇已打开的笔记",
    shortcut: "Ctrl+\\",
    keywords: "split 分屏 对照 并排",
    group: "view",
    need: "workspace",
    enabled: hasWorkspace,
    menu: false,
    run: () => {
      if (useTabsStore.getState().tabs.length < 2) {
        useUiStore.getState().toast("先打开至少两篇笔记再分屏对照");
        return;
      }
      useUiStore.getState().toggleSplitPreview();
    },
  },
  {
    id: "find",
    title: "查找与替换",
    shortcut: "Ctrl+F",
    keywords: "find search 搜索",
    group: "find",
    need: "doc",
    enabled: hasDoc,
    run: async () => {
      if (useDocumentStore.getState().viewMode === "preview") {
        await changeViewMode("split");
      }
      openEditorSearch();
    },
  },
  {
    id: "search-workspace",
    title: "在工作区中搜索",
    hint: "跨全部笔记，结果直接跳到命中行",
    keywords: "search find 全文 搜索 工作区",
    group: "find",
    need: "workspace",
    enabled: hasWorkspace,
    run: () => useUiStore.getState().openSearchPanel(),
  },
  {
    id: "refresh-tree",
    title: "刷新文件树",
    keywords: "refresh 刷新",
    group: "find",
    need: "workspace",
    enabled: hasWorkspace,
    menu: false,
    run: () => useWorkspaceStore.getState().refreshTree(),
  },
  {
    id: "font-larger",
    title: "放大正文字号",
    shortcut: "Ctrl+=",
    keywords: "zoom font 字号 放大",
    group: "app",
    enabled: () => true,
    menu: false,
    run: () => changeFontSize(1),
  },
  {
    id: "font-smaller",
    title: "缩小正文字号",
    shortcut: "Ctrl+-",
    keywords: "zoom font 字号 缩小",
    group: "app",
    enabled: () => true,
    menu: false,
    run: () => changeFontSize(-1),
  },
  {
    id: "palette",
    title: "命令面板",
    hint: "搜索并执行所有应用内动作",
    shortcut: "Ctrl+Shift+P",
    keywords: "command palette 命令 面板",
    group: "app",
    enabled: () => true,
    palette: false,
    run: () => useUiStore.getState().openPalette(),
  },
  {
    id: "settings",
    title: "偏好设置…",
    shortcut: "Ctrl+,",
    keywords: "settings preferences 设置",
    group: "app",
    enabled: () => true,
    run: () => useUiStore.getState().openSettings(),
  },
];
