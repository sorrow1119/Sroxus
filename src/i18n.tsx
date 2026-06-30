import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Language = "zh" | "en";

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const messages: Record<Language, Record<string, string>> = {
  zh: {
    "app.subtitle": "本地 AI 聊天客户端",
    "common.close": "关闭",
    "common.loading": "加载中...",
    "common.refresh": "刷新",
    "common.openFolder": "打开文件夹",
    "common.enabled": "已启用",
    "common.disabled": "已禁用",
    "common.invalid": "无效",
    "common.enable": "启用",
    "common.disable": "禁用",
    "common.uninstall": "卸载",
    "common.settings": "设置",
    "common.plugins": "插件",
    "sidebar.newChat": "新建会话",
    "sidebar.search": "搜索会话",
    "sidebar.empty": "暂无会话。点击上方按钮创建第一个会话。",
    "sidebar.noMatch": "没有匹配的会话。",
    "sidebar.edit": "改",
    "sidebar.delete": "删",
    "sidebar.deleteConfirm": "删除会话「{title}」？",
    "sidebar.language": "语言",
    "chat.noConversation": "未选择会话",
    "chat.contextStats": "未压缩消息 {count} 条 / {chars} 字符",
    "chat.compressing": "压缩中...",
    "chat.compress": "压缩上下文",
    "chat.summary": "查看摘要",
    "chat.systemPrompt": "系统提示词",
    "chat.closeNotice": "关闭",
    "chat.welcomeTitle": "欢迎使用 {app}",
    "chat.welcomeBody": "创建一个会话开始聊天。这里会保留完整本地记录，也支持把文档和图片作为附件一起带进对话。",
    "chat.startTitle": "开始对话",
    "chat.startBody": "输入第一条消息，或直接附加文档、图片后发送。",
    "composer.attach": "添加附件",
    "composer.stop": "停止生成",
    "composer.send": "发送",
    "composer.noConversation": "请选择或新建一个会话",
    "composer.placeholder": "输入消息，支持粘贴截图、多文件和图片；Enter 发送，Shift+Enter 换行",
    "composer.image": "[图片]",
    "composer.file": "[文件]",
    "notice.longContext": "当前上下文较长（{chars} 字符），建议压缩以节省 token",
    "notice.compressNow": "立即压缩",
    "notice.ignore": "暂时忽略",
    "agents.online": "在线 AI",
    "agents.none": "暂无在线 AI",
    "agents.primary": "主",
    "agents.manage": "管理 AI",
    "models.selectTitle": "选择本次对话使用的 Provider 和模型",
    "models.empty": "请先到设置添加模型",
    "models.search": "搜索 Provider 或模型名",
    "models.noMatch": "没有匹配的模型",
    "models.text": "文本",
    "models.vision": "看图",
    "models.tools": "工具",
    "models.web": "联网",
    "messages.compressed": "已压缩",
    "messages.copy": "复制",
    "messages.retry": "重试",
    "messages.regenerate": "重新回答",
    "messages.concise": "更简洁",
    "messages.detailed": "更详细",
    "messages.failed": "生成失败或已停止",
    "messages.expand": "展开全文",
    "messages.collapse": "收起",
    "messages.open": "打开",
    "messages.document": "[文档]",
    "messages.code": "代码",
    "plugins.title": "插件",
    "plugins.subtitle": "本地 Sroxus 插件。插件代码执行会在后续更安全的运行时中开放。",
    "plugins.folder": "插件文件夹",
    "plugins.install": "从文件夹安装",
    "plugins.empty": "还没有安装插件。创建一个包含 plugin.json 的文件夹，然后在这里安装，或复制到插件文件夹。",
    "plugins.installed": "已安装 {name}",
    "plugins.uninstalled": "已卸载 {name}",
    "plugins.uninstallConfirm": "卸载插件「{name}」？",
    "plugins.permissions": "权限",
    "plugins.commands": "命令",
    "plugins.noPermissions": "未声明权限",
    "plugins.noCommands": "未声明命令",
  },
  en: {
    "app.subtitle": "Local AI chat client",
    "common.close": "Close",
    "common.loading": "Loading...",
    "common.refresh": "Refresh",
    "common.openFolder": "Open folder",
    "common.enabled": "Enabled",
    "common.disabled": "Disabled",
    "common.invalid": "Invalid",
    "common.enable": "Enable",
    "common.disable": "Disable",
    "common.uninstall": "Uninstall",
    "common.settings": "Settings",
    "common.plugins": "Plugins",
    "sidebar.newChat": "New chat",
    "sidebar.search": "Search chats",
    "sidebar.empty": "No chats yet. Create your first chat with the button above.",
    "sidebar.noMatch": "No matching chats.",
    "sidebar.edit": "Edit",
    "sidebar.delete": "Delete",
    "sidebar.deleteConfirm": "Delete chat \"{title}\"?",
    "sidebar.language": "Language",
    "chat.noConversation": "No conversation selected",
    "chat.contextStats": "Uncompressed messages {count} / {chars} chars",
    "chat.compressing": "Compressing...",
    "chat.compress": "Compress context",
    "chat.summary": "View summary",
    "chat.systemPrompt": "System prompt",
    "chat.closeNotice": "Close",
    "chat.welcomeTitle": "Welcome to {app}",
    "chat.welcomeBody": "Create a conversation to start chatting. Full local history is kept, and documents or images can be attached to the conversation.",
    "chat.startTitle": "Start chatting",
    "chat.startBody": "Type your first message, or attach documents and images before sending.",
    "composer.attach": "Attach",
    "composer.stop": "Stop",
    "composer.send": "Send",
    "composer.noConversation": "Select or create a conversation",
    "composer.placeholder": "Type a message. Paste screenshots, attach multiple files or images. Enter to send, Shift+Enter for newline",
    "composer.image": "[Image]",
    "composer.file": "[File]",
    "notice.longContext": "Current context is long ({chars} chars). Compressing is recommended to save tokens.",
    "notice.compressNow": "Compress now",
    "notice.ignore": "Ignore",
    "agents.online": "Online AI",
    "agents.none": "No online AI",
    "agents.primary": "Primary",
    "agents.manage": "Manage AI",
    "models.selectTitle": "Select the Provider and model for this chat",
    "models.empty": "Add a model in Settings first",
    "models.search": "Search Provider or model",
    "models.noMatch": "No matching models",
    "models.text": "Text",
    "models.vision": "Vision",
    "models.tools": "Tools",
    "models.web": "Web",
    "messages.compressed": "Compressed",
    "messages.copy": "Copy",
    "messages.retry": "Retry",
    "messages.regenerate": "Regenerate",
    "messages.concise": "More concise",
    "messages.detailed": "More detailed",
    "messages.failed": "Generation failed or stopped",
    "messages.expand": "Expand",
    "messages.collapse": "Collapse",
    "messages.open": "Open",
    "messages.document": "[Document]",
    "messages.code": "Code",
    "plugins.title": "Plugins",
    "plugins.subtitle": "Local Sroxus plugins. Plugin code execution is reserved for a later safer runtime.",
    "plugins.folder": "Plugin folder",
    "plugins.install": "Install from folder",
    "plugins.empty": "No plugins installed yet. Create a folder with a plugin.json file, then install it here or copy it into the plugin folder.",
    "plugins.installed": "Installed {name}",
    "plugins.uninstalled": "Uninstalled {name}",
    "plugins.uninstallConfirm": "Uninstall plugin \"{name}\"?",
    "plugins.permissions": "Permissions",
    "plugins.commands": "Commands",
    "plugins.noPermissions": "No permissions declared",
    "plugins.noCommands": "No commands declared",
  },
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("zh");

  useEffect(() => {
    window.electronAPI.settings
      .get("language")
      .then((value) => setLanguageState(value === "en" ? "en" : "zh"))
      .catch(() => setLanguageState("zh"));
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage: async (nextLanguage) => {
        setLanguageState(nextLanguage);
        await window.electronAPI.settings.set("language", nextLanguage);
      },
      t: (key, params) => translate(language, key, params),
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}

function translate(language: Language, key: string, params?: Record<string, string | number>) {
  const template = messages[language][key] ?? messages.zh[key] ?? key;
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? ""));
}
