import { useEffect, useMemo, useState } from "react";
import { PROVIDER_PRESETS } from "../../shared/constants";
import type { DataStats, EndpointPathMode, ModelCapability, Provider, ProviderInput } from "../../shared/types";
import { useI18n, type Language } from "../i18n";

interface SettingsPageProps {
  onBack: () => void;
}

type SettingsTab = "models" | "context" | "data" | "appearance";
type Notice = { type: "success" | "error" | "info"; text: string } | null;

const EMPTY_FORM: ProviderInput = {
  name: "自定义",
  baseUrl: "",
  apiKey: "",
  model: "",
  enabledModels: [],
  modelCapabilities: {},
  temperature: 0.7,
  maxTokens: 4096,
  stream: true,
  endpointType: "chat_completions",
  autoAppendPath: false,
  endpointPathMode: "append_chat_completions",
};

const TEXT = {
  zh: {
    back: "返回",
    title: "设置",
    tabs: {
      models: "模型配置",
      context: "上下文设置",
      data: "数据管理",
      appearance: "外观",
    },
    providerListTitle: "模型服务商",
    providerListDesc: "管理 Provider，并选择默认服务商。",
    addProvider: "添加 Provider",
    emptyProvider: "暂无 Provider，先添加一个。",
    default: "默认",
    model: "模型",
    unset: "未设置",
    address: "地址",
    editProvider: "编辑 Provider",
    newProvider: "添加 Provider",
    formDesc: "可手动填写模型，也可以先从预设模板填入 Base URL 和申请入口。",
    setDefault: "设为默认",
    delete: "删除",
    deleteConfirm: "删除 Provider「{name}」？",
    preset: "预设模板",
    presetHint: "推荐平台和官方模板都在这里；点击模板会填入名称和 Base URL。",
    usePreset: "使用",
    getApiKey: "获取 API Key",
    recommended: "推荐",
    official: "官方",
    local: "本地",
    custom: "自定义",
    name: "名称",
    baseUrl: "Base URL",
    apiKey: "API Key",
    show: "显示",
    hide: "隐藏",
    modelPlaceholder: "例如 deepseek-chat / gpt-4o-mini / qwen-plus / moonshot-v1-8k",
    addUsableModel: "加入可用模型",
    endpointMode: "接口路径模式",
    pathExact: "精确使用输入地址",
    pathExactDesc: "你填的是完整接口地址时使用，例如 https://api.xxx.com/v1/chat/completions。",
    pathChat: "补 /chat/completions",
    pathChatDesc: "推荐。适合填写到 /v1 的 OpenAI-compatible 地址。",
    pathV1Chat: "补 /v1/chat/completions",
    pathV1ChatDesc: "适合只填写域名或根路径的服务商。",
    stream: "Stream 流式输出",
    multiModel: "多模型管理",
    multiModelDesc: "获取模型列表后勾选；聊天页会显示这些模型，也可以手动添加。",
    fetchModels: "获取模型列表",
    fetchingModels: "获取中...",
    manualModelPlaceholder: "手动添加另一个模型名",
    add: "添加",
    modelFilter: "输入关键字筛选已获取模型",
    noModelMatch: "没有匹配的模型",
    enabledModels: "已启用模型",
    noEnabledModels: "还没有启用模型。",
    modelCapabilities: "模型能力",
    makeProviderDefaultModel: "设为该 Provider 的默认模型",
    removeModel: "删除这个模型",
    save: "保存",
    test: "测试连接",
    testing: "测试中...",
    needRequired: "请至少填写名称、Base URL 和一个模型名。",
    saved: "已保存 Provider。",
    created: "已添加 Provider。",
    testRequired: "测试前请先填写 Base URL 和模型名。",
    testingConnection: "正在测试连接...",
    testSuccess: "连接成功：{message}",
    testFailed: "连接失败：{message}",
    loadingModelList: "正在获取模型列表...",
    loadedModels: "已获取 {count} 个模型。勾选后保存即可在聊天窗口使用。",
    modelListUnsupported: "该接口不支持获取模型，请手动输入模型名。",
    contextTitle: "上下文设置",
    autoSave: "修改后自动保存。",
    recentMessages: "保留最近消息数量",
    compressKeep: "压缩时保留最近消息数量",
    compressThreshold: "自动压缩提醒阈值",
    compressionNotice: "开启自动压缩提醒",
    dataTitle: "数据管理",
    dataDesc: "管理本地数据库路径、导入和导出。",
    refresh: "刷新",
    currentPath: "当前数据保存路径",
    reading: "读取中...",
    conversations: "会话数量",
    messages: "消息数量",
    dbSize: "数据库大小",
    changePath: "修改路径",
    exportData: "导出数据",
    importData: "导入数据",
    migrateConfirm: "将数据从 {oldPath} 迁移到 {newPath}，确定吗？",
    migrating: "正在迁移数据...",
    migrated: "数据路径迁移成功。",
    exported: "已导出到：{path}",
    importConfirm: "导入将覆盖现有数据，确定吗？",
    imported: "数据导入成功。",
    appearanceTitle: "外观",
    appearanceDesc: "切换后立即生效，并自动保存。",
    dark: "深色",
    light: "浅色",
    system: "跟随系统",
  },
  en: {
    back: "Back",
    title: "Settings",
    tabs: {
      models: "Models",
      context: "Context",
      data: "Data",
      appearance: "Appearance",
    },
    providerListTitle: "Model Providers",
    providerListDesc: "Manage Providers and choose the default service.",
    addProvider: "Add Provider",
    emptyProvider: "No Provider yet. Add one first.",
    default: "Default",
    model: "Model",
    unset: "Not set",
    address: "Address",
    editProvider: "Edit Provider",
    newProvider: "Add Provider",
    formDesc: "Enter models manually, or use a preset to fill the Base URL and API Key signup link.",
    setDefault: "Set default",
    delete: "Delete",
    deleteConfirm: "Delete Provider \"{name}\"?",
    preset: "Presets",
    presetHint: "Recommended platforms and official templates are here. Click a preset to fill name and Base URL.",
    usePreset: "Use",
    getApiKey: "Get API Key",
    recommended: "Recommended",
    official: "Official",
    local: "Local",
    custom: "Custom",
    name: "Name",
    baseUrl: "Base URL",
    apiKey: "API Key",
    show: "Show",
    hide: "Hide",
    modelPlaceholder: "For example deepseek-chat / gpt-4o-mini / qwen-plus / moonshot-v1-8k",
    addUsableModel: "Add model",
    endpointMode: "Endpoint path mode",
    pathExact: "Use exact URL",
    pathExactDesc: "Use this when the address is already a full endpoint, such as https://api.xxx.com/v1/chat/completions.",
    pathChat: "Append /chat/completions",
    pathChatDesc: "Recommended for OpenAI-compatible Base URLs ending at /v1.",
    pathV1Chat: "Append /v1/chat/completions",
    pathV1ChatDesc: "Use this when the service only provides a domain or root path.",
    stream: "Stream output",
    multiModel: "Model Management",
    multiModelDesc: "Fetch and enable models for the chat page, or add model names manually.",
    fetchModels: "Fetch models",
    fetchingModels: "Fetching...",
    manualModelPlaceholder: "Add another model name manually",
    add: "Add",
    modelFilter: "Search fetched models",
    noModelMatch: "No matching models",
    enabledModels: "Enabled models",
    noEnabledModels: "No enabled models yet.",
    modelCapabilities: "Model capabilities",
    makeProviderDefaultModel: "Set as this Provider's default model",
    removeModel: "Remove this model",
    save: "Save",
    test: "Test connection",
    testing: "Testing...",
    needRequired: "Please fill name, Base URL, and at least one model.",
    saved: "Provider saved.",
    created: "Provider added.",
    testRequired: "Please fill Base URL and model before testing.",
    testingConnection: "Testing connection...",
    testSuccess: "Connection succeeded: {message}",
    testFailed: "Connection failed: {message}",
    loadingModelList: "Fetching model list...",
    loadedModels: "Fetched {count} models. Select and save them to use in chat.",
    modelListUnsupported: "This endpoint does not support model listing. Enter the model name manually.",
    contextTitle: "Context Settings",
    autoSave: "Changes are saved automatically.",
    recentMessages: "Recent messages to keep",
    compressKeep: "Recent messages kept during compression",
    compressThreshold: "Auto compression reminder threshold",
    compressionNotice: "Enable compression reminder",
    dataTitle: "Data Management",
    dataDesc: "Manage local database path, import, and export.",
    refresh: "Refresh",
    currentPath: "Current data path",
    reading: "Reading...",
    conversations: "Conversations",
    messages: "Messages",
    dbSize: "Database size",
    changePath: "Change path",
    exportData: "Export data",
    importData: "Import data",
    migrateConfirm: "Move data from {oldPath} to {newPath}?",
    migrating: "Migrating data...",
    migrated: "Data path migrated.",
    exported: "Exported to: {path}",
    importConfirm: "Import will overwrite existing data. Continue?",
    imported: "Data imported.",
    appearanceTitle: "Appearance",
    appearanceDesc: "Theme changes apply immediately and are saved automatically.",
    dark: "Dark",
    light: "Light",
    system: "System",
  },
} as const;

const PATH_MODE_VALUES: EndpointPathMode[] = ["exact", "append_chat_completions", "append_v1_chat_completions"];

export default function SettingsPage({ onBack }: SettingsPageProps) {
  const { language } = useI18n();
  const s = makeTranslator(language);
  const [tab, setTab] = useState<SettingsTab>("models");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderInput>(EMPTY_FORM);
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [manualModel, setManualModel] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [message, setMessage] = useState<Notice>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [contextSettings, setContextSettings] = useState({
    recentMessages: 10,
    COMPRESS_KEEP: 6,
    COMPRESS_THRESHOLD: 12000,
    compressionNoticeEnabled: true,
  });
  const [dataStats, setDataStats] = useState<DataStats | null>(null);
  const [dataMessage, setDataMessage] = useState<Notice>(null);
  const [theme, setTheme] = useState("dark");

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedId) ?? null,
    [providers, selectedId],
  );
  const enabledModels = normalizeModels(form.enabledModels ?? [], form.model);

  async function refreshProviders(nextSelectedId?: string | null) {
    const rows = await window.electronAPI.providers.list();
    setProviders(rows);
    const id = nextSelectedId === undefined ? selectedId ?? rows[0]?.id ?? null : nextSelectedId;
    setSelectedId(id);
    const selected = rows.find((provider) => provider.id === id);
    setForm(selected ? toInput(selected) : EMPTY_FORM);
  }

  useEffect(() => {
    void refreshProviders();
    void loadSettings();
    void refreshDataStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  async function loadSettings() {
    const settings = await window.electronAPI.settings.getAll();
    setContextSettings({
      recentMessages: clampInt(settings.recentMessages, 10, 1, 50),
      COMPRESS_KEEP: clampInt(settings.COMPRESS_KEEP, 6, 1, 20),
      COMPRESS_THRESHOLD: clampInt(settings.COMPRESS_THRESHOLD, 12000, 1000, 100000),
      compressionNoticeEnabled: settings.compressionNoticeEnabled !== "false",
    });
    const nextTheme = settings.theme || "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  async function refreshDataStats() {
    setDataStats(await window.electronAPI.data.getStats());
  }

  async function saveContextSetting(key: keyof typeof contextSettings, value: number | boolean) {
    setContextSettings((current) => ({ ...current, [key]: value }));
    await window.electronAPI.settings.set(key, String(value));
  }

  async function saveTheme(value: string) {
    setTheme(value);
    applyTheme(value);
    await window.electronAPI.settings.set("theme", value);
  }

  function update<K extends keyof ProviderInput>(key: K, value: ProviderInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function applyPreset(name: string, baseUrl: string) {
    setSelectedId(null);
    setForm({
      ...EMPTY_FORM,
      name,
      baseUrl,
      endpointPathMode: baseUrl.endsWith("/v1/chat/completions") ? "exact" : "append_chat_completions",
    });
    setFetchedModels([]);
    setManualModel("");
    setModelFilter("");
    setMessage(null);
  }

  function selectProvider(provider: Provider) {
    setSelectedId(provider.id);
    setForm(toInput(provider));
    setFetchedModels(provider.enabledModels ?? []);
    setManualModel("");
    setModelFilter("");
    setMessage(null);
  }

  function newProvider() {
    setSelectedId(null);
    setForm(EMPTY_FORM);
    setFetchedModels([]);
    setManualModel("");
    setModelFilter("");
    setMessage(null);
  }

  async function saveProvider() {
    const normalized = normalizeForm(form);
    if (!normalized.name.trim() || !normalized.baseUrl.trim() || !normalized.model.trim()) {
      setMessage({ type: "error", text: s("needRequired") });
      return;
    }
    if (selectedProvider) {
      const saved = await window.electronAPI.providers.update(selectedProvider.id, normalized);
      await refreshProviders(saved.id);
      setMessage({ type: "success", text: s("saved") });
    } else {
      const saved = await window.electronAPI.providers.create({ ...normalized, isDefault: providers.length === 0 });
      await refreshProviders(saved.id);
      setMessage({ type: "success", text: s("created") });
    }
  }

  async function testConnection() {
    const normalized = normalizeForm(form);
    if (!normalized.baseUrl || !normalized.model) {
      setMessage({ type: "error", text: s("testRequired") });
      return;
    }
    setTesting(true);
    setMessage({ type: "info", text: s("testingConnection") });
    try {
      const result = await window.electronAPI.providers.testConnection(normalized);
      setMessage({
        type: result.ok ? "success" : "error",
        text: s(result.ok ? "testSuccess" : "testFailed", { message: result.message }),
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  }

  async function loadModels() {
    setLoadingModels(true);
    setMessage({ type: "info", text: s("loadingModelList") });
    try {
      const result = await window.electronAPI.providers.listModels(normalizeForm(form));
      setFetchedModels(result.models);
      setModelFilter("");
      if (result.ok && result.models.length) {
        setMessage({ type: "success", text: s("loadedModels", { count: result.models.length }) });
      } else {
        setMessage({ type: "error", text: result.message || s("modelListUnsupported") });
      }
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoadingModels(false);
    }
  }

  function toggleModel(model: string, checked: boolean) {
    setForm((current) => {
      const nextModels = checked
        ? normalizeModels([...(current.enabledModels ?? []), model])
        : normalizeModels(current.enabledModels ?? []).filter((item) => item !== model);
      return chooseDefaultModel({ ...current, enabledModels: nextModels, modelCapabilities: syncCapabilities(current.modelCapabilities, nextModels) });
    });
  }

  function toggleCapability(model: string, capability: ModelCapability, checked: boolean) {
    setForm((current) => {
      const currentCaps = current.modelCapabilities?.[model] ?? inferModelCapabilities(model);
      const nextCaps = checked
        ? normalizeCapabilities([...currentCaps, capability])
        : normalizeCapabilities(currentCaps.filter((item) => item !== capability));
      return {
        ...current,
        modelCapabilities: {
          ...(current.modelCapabilities ?? {}),
          [model]: nextCaps,
        },
      };
    });
  }
  function addManualModel() {
    const model = manualModel.trim() || form.model.trim();
    if (!model) {
      return;
    }
    setForm((current) => { const nextModels = normalizeModels([...(current.enabledModels ?? []), model]); return chooseDefaultModel({ ...current, enabledModels: nextModels, modelCapabilities: syncCapabilities(current.modelCapabilities, nextModels) }); });
    setManualModel("");
  }

  function removeEnabledModel(model: string) {
    setForm((current) => {
      const nextModels = normalizeModels(current.enabledModels ?? []).filter((item) => item !== model);
      return chooseDefaultModel({ ...current, enabledModels: nextModels, modelCapabilities: syncCapabilities(current.modelCapabilities, nextModels) });
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#0f1117] text-slate-100">
      <header className="flex h-14 items-center gap-3 border-b border-[#2a2f3a] bg-[#151820] px-5">
        <button onClick={onBack} className="rounded-md border border-[#343b49] px-3 py-1.5 text-sm hover:bg-[#242936]">
          {s("back")}
        </button>
        <h1 className="text-sm font-semibold">{s("title")}</h1>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border-r border-[#2a2f3a] bg-[#151820] p-3">
          <div className="space-y-1">
            {(["models", "context", "data", "appearance"] as SettingsTab[]).map((item) => (
              <button
                key={item}
                onClick={() => setTab(item)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                  tab === item ? "bg-[#1f2937] text-slate-100" : "text-slate-400 hover:bg-[#1d222d] hover:text-slate-100"
                }`}
              >
                {s(`tabs.${item}`)}
              </button>
            ))}
          </div>
        </aside>

        <main className="overflow-y-auto p-6">
          {tab === "models" ? (
            <ModelConfigTab
              language={language}
              providers={providers}
              selectedId={selectedId}
              selectedProvider={selectedProvider}
              form={form}
              enabledModels={enabledModels}
              fetchedModels={fetchedModels}
              manualModel={manualModel}
              modelFilter={modelFilter}
              message={message}
              testing={testing}
              loadingModels={loadingModels}
              showApiKey={showApiKey}
              onSelectProvider={selectProvider}
              onNewProvider={newProvider}
              onApplyPreset={applyPreset}
              onUpdate={update}
              onManualModelChange={setManualModel}
              onModelFilterChange={setModelFilter}
              onAddManualModel={addManualModel}
              onRemoveEnabledModel={removeEnabledModel}
              onToggleModel={toggleModel}
              onToggleCapability={toggleCapability}
              onLoadModels={() => void loadModels()}
              onTestConnection={() => void testConnection()}
              onSave={() => void saveProvider()}
              onToggleApiKey={() => setShowApiKey((value) => !value)}
              onSetDefault={async () => {
                if (!selectedProvider) return;
                await window.electronAPI.providers.setDefault(selectedProvider.id);
                await refreshProviders(selectedProvider.id);
              }}
              onDelete={async () => {
                if (!selectedProvider) return;
                if (window.confirm(s("deleteConfirm", { name: selectedProvider.name }))) {
                  await window.electronAPI.providers.delete(selectedProvider.id);
                  await refreshProviders(null);
                }
              }}
            />
          ) : tab === "context" ? (
            <ContextSettingsTab language={language} settings={contextSettings} onChange={saveContextSetting} />
          ) : tab === "data" ? (
            <DataManagementTab
              language={language}
              stats={dataStats}
              message={dataMessage}
              onRefresh={() => void refreshDataStats()}
              onChangePath={async () => {
                const newPath = await window.electronAPI.data.selectFolder();
                if (!newPath || !dataStats) return;
                if (!window.confirm(s("migrateConfirm", { oldPath: dataStats.storagePath, newPath }))) return;
                setDataMessage({ type: "info", text: s("migrating") });
                try {
                  await window.electronAPI.data.setStoragePath(newPath);
                  await refreshDataStats();
                  setDataMessage({ type: "success", text: s("migrated") });
                } catch (error) {
                  setDataMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
                }
              }}
              onExport={async () => {
                const filePath = await window.electronAPI.data.selectSaveFile();
                if (!filePath) return;
                try {
                  await window.electronAPI.data.exportJSON(filePath);
                  setDataMessage({ type: "success", text: s("exported", { path: filePath }) });
                } catch (error) {
                  setDataMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
                }
              }}
              onImport={async () => {
                const filePath = await window.electronAPI.data.selectOpenFile();
                if (!filePath) return;
                if (!window.confirm(s("importConfirm"))) return;
                try {
                  await window.electronAPI.data.importJSON(filePath);
                  await Promise.all([refreshProviders(null), refreshDataStats(), loadSettings()]);
                  setDataMessage({ type: "success", text: s("imported") });
                } catch (error) {
                  setDataMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
                }
              }}
            />
          ) : (
            <AppearanceTab language={language} theme={theme} onChange={(value) => void saveTheme(value)} />
          )}
        </main>
      </div>
    </div>
  );
}

function ModelConfigTab({
  language,
  providers,
  selectedId,
  selectedProvider,
  form,
  enabledModels,
  fetchedModels,
  manualModel,
  modelFilter,
  message,
  testing,
  loadingModels,
  showApiKey,
  onSelectProvider,
  onNewProvider,
  onApplyPreset,
  onUpdate,
  onManualModelChange,
  onModelFilterChange,
  onAddManualModel,
  onRemoveEnabledModel,
  onToggleModel,
  onToggleCapability,
  onLoadModels,
  onTestConnection,
  onSave,
  onToggleApiKey,
  onSetDefault,
  onDelete,
}: {
  language: Language;
  providers: Provider[];
  selectedId: string | null;
  selectedProvider: Provider | null;
  form: ProviderInput;
  enabledModels: string[];
  fetchedModels: string[];
  manualModel: string;
  modelFilter: string;
  message: Notice;
  testing: boolean;
  loadingModels: boolean;
  showApiKey: boolean;
  onSelectProvider: (provider: Provider) => void;
  onNewProvider: () => void;
  onApplyPreset: (name: string, baseUrl: string) => void;
  onUpdate: <K extends keyof ProviderInput>(key: K, value: ProviderInput[K]) => void;
  onManualModelChange: (value: string) => void;
  onModelFilterChange: (value: string) => void;
  onAddManualModel: () => void;
  onRemoveEnabledModel: (model: string) => void;
  onToggleModel: (model: string, checked: boolean) => void;
  onToggleCapability: (model: string, capability: ModelCapability, checked: boolean) => void;
  onLoadModels: () => void;
  onTestConnection: () => void;
  onSave: () => void;
  onToggleApiKey: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  const s = makeTranslator(language);
  const selectedMode = getPathModes(language).find((mode) => mode.value === form.endpointPathMode) ?? getPathModes(language)[1];
  const visibleFetchedModels = fetchedModels.filter((model) => model.toLowerCase().includes(modelFilter.trim().toLowerCase()));

  return (
    <div className="grid max-w-7xl gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
      <section className="rounded-lg border border-[#2a2f3a] bg-[#151820] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">{s("providerListTitle")}</h2>
            <p className="mt-1 text-xs text-slate-500">{s("providerListDesc")}</p>
          </div>
          <button onClick={onNewProvider} className="rounded-md bg-[#2563eb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]">
            {s("addProvider")}
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {providers.map((provider) => (
            <button
              key={provider.id}
              onClick={() => onSelectProvider(provider)}
              className={`w-full rounded-md border px-3 py-3 text-left ${
                provider.id === selectedId ? "border-[#3b82f6] bg-[#1f2937]" : "border-[#2a2f3a] bg-[#10141c] hover:bg-[#1d222d]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-100">{provider.name}</span>
                {provider.isDefault && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-200">{s("default")}</span>}
              </div>
              <div className="mt-2 truncate text-xs text-slate-400">
                {s("model")}: {provider.model || s("unset")}
              </div>
              <div className="mt-1 truncate text-xs text-slate-500">
                {s("address")}: {provider.baseUrl}
              </div>
            </button>
          ))}
          {!providers.length && <div className="rounded-md border border-dashed border-[#343b49] p-4 text-sm text-slate-500">{s("emptyProvider")}</div>}
        </div>
      </section>

      <section className="rounded-lg border border-[#2a2f3a] bg-[#151820] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">{selectedProvider ? s("editProvider") : s("newProvider")}</h2>
            <p className="mt-1 text-xs text-slate-500">{s("formDesc")}</p>
          </div>
          <div className="flex gap-2">
            {selectedProvider && !selectedProvider.isDefault && (
              <button onClick={onSetDefault} className="rounded-md border border-[#343b49] px-3 py-1.5 text-sm text-slate-300 hover:bg-[#242936]">
                {s("setDefault")}
              </button>
            )}
            {selectedProvider && (
              <button onClick={onDelete} className="rounded-md border border-rose-500/50 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-500/10">
                {s("delete")}
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-4">
          <div className="grid gap-2 text-sm text-slate-300">
            <div>
              <span>{s("preset")}</span>
              <p className="mt-1 text-xs text-slate-500">{s("presetHint")}</p>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {PROVIDER_PRESETS.map((preset) => (
                <div key={preset.name} className="rounded-md border border-[#343b49] bg-[#0f1117] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-slate-100">{preset.name}</span>
                        <span className="shrink-0 rounded bg-[#1f2937] px-1.5 py-0.5 text-[11px] text-slate-400">{s(preset.kind)}</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500">{preset.baseUrl || s("custom")}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onApplyPreset(preset.name, preset.baseUrl)}
                      className="rounded-md border border-[#343b49] px-2 py-1 text-xs text-slate-300 hover:bg-[#242936]"
                    >
                      {s("usePreset")}
                    </button>
                  </div>
                  {preset.signupUrl && (
                    <button
                      type="button"
                      onClick={() => window.open(preset.signupUrl, "_blank", "noopener,noreferrer")}
                      className="mt-3 w-full rounded-md bg-[#2563eb] px-2 py-1.5 text-xs font-medium text-white hover:bg-[#1d4ed8]"
                    >
                      {s("getApiKey")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Field label={s("name")} value={form.name} onChange={(value) => onUpdate("name", value)} />
            <Field label={s("baseUrl")} value={form.baseUrl} onChange={(value) => onUpdate("baseUrl", value)} placeholder="https://api.openai.com/v1" />
          </div>

          <label className="grid gap-1 text-sm text-slate-300">
            <span>{s("apiKey")}</span>
            <div className="flex gap-2">
              <input
                value={form.apiKey}
                onChange={(event) => onUpdate("apiKey", event.target.value)}
                type={showApiKey ? "text" : "password"}
                className="min-w-0 flex-1 rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none focus:border-[#3b82f6]"
              />
              <button type="button" onClick={onToggleApiKey} className="rounded-md border border-[#343b49] px-3 py-2 text-sm text-slate-300 hover:bg-[#242936]">
                {showApiKey ? s("hide") : s("show")}
              </button>
            </div>
          </label>

          <div className="grid gap-1 text-sm text-slate-300">
            <span>{s("model")}</span>
            <div className="flex gap-2">
              <input
                value={form.model}
                onChange={(event) => onUpdate("model", event.target.value)}
                placeholder={s("modelPlaceholder")}
                className="min-w-0 flex-1 rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#3b82f6]"
              />
              <button onClick={onAddManualModel} className="rounded-md border border-[#343b49] px-3 py-2 text-sm text-slate-300 hover:bg-[#242936]">
                {s("addUsableModel")}
              </button>
            </div>
          </div>

          <label className="grid gap-1 text-sm text-slate-300">
            <span>{s("endpointMode")}</span>
            <select
              value={form.endpointPathMode}
              onChange={(event) => onUpdate("endpointPathMode", event.target.value as EndpointPathMode)}
              className="rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none focus:border-[#3b82f6]"
            >
              {getPathModes(language).map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">{selectedMode.description}</span>
          </label>

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="grid gap-2 text-sm text-slate-300">
              <span>Temperature: {Number(form.temperature ?? 0.7).toFixed(1)}</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={form.temperature ?? 0.7}
                onChange={(event) => onUpdate("temperature", Number(event.target.value))}
                className="accent-[#3b82f6]"
              />
            </label>
            <Field label="Max Tokens" value={String(form.maxTokens)} onChange={(value) => onUpdate("maxTokens", Number.parseInt(value, 10) || 4096)} type="number" />
          </div>

          <label className="flex items-center justify-between rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-sm text-slate-300">
            <span>{s("stream")}</span>
            <input type="checkbox" checked={form.stream !== false} onChange={(event) => onUpdate("stream", event.target.checked)} />
          </label>

          <div className="rounded-lg border border-[#2a2f3a] bg-[#0f1117] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{s("multiModel")}</h3>
                <p className="mt-1 text-xs text-slate-500">{s("multiModelDesc")}</p>
              </div>
              <button onClick={onLoadModels} disabled={loadingModels} className="rounded-md border border-[#343b49] px-3 py-2 text-sm text-slate-300 hover:bg-[#242936] disabled:opacity-50">
                {loadingModels ? s("fetchingModels") : s("fetchModels")}
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              <input
                value={manualModel}
                onChange={(event) => onManualModelChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onAddManualModel();
                  }
                }}
                placeholder={s("manualModelPlaceholder")}
                className="min-w-0 flex-1 rounded-md border border-[#343b49] bg-[#151820] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#3b82f6]"
              />
              <button onClick={onAddManualModel} className="rounded-md border border-[#343b49] px-3 py-2 text-sm text-slate-300 hover:bg-[#242936]">
                {s("add")}
              </button>
            </div>

            {fetchedModels.length > 0 && (
              <>
                <input
                  value={modelFilter}
                  onChange={(event) => onModelFilterChange(event.target.value)}
                  placeholder={s("modelFilter")}
                  className="mt-4 w-full rounded-md border border-[#343b49] bg-[#151820] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#3b82f6]"
                />
                <div className="mt-2 max-h-52 overflow-y-auto rounded-md border border-[#2a2f3a]">
                  {visibleFetchedModels.map((model) => (
                    <label key={model} className="flex items-center gap-2 border-b border-[#202632] px-3 py-2 text-sm last:border-b-0 hover:bg-[#151820]">
                      <input type="checkbox" checked={enabledModels.includes(model)} onChange={(event) => onToggleModel(model, event.target.checked)} />
                      <span className="min-w-0 flex-1 truncate">{model}</span>
                    </label>
                  ))}
                  {!visibleFetchedModels.length && <div className="px-3 py-3 text-sm text-slate-500">{s("noModelMatch")}</div>}
                </div>
              </>
            )}

            <div className="mt-4">
              <div className="mb-2 text-xs text-slate-500">{s("enabledModels")}</div>
              {enabledModels.length ? (
                <div className="flex flex-wrap gap-2">
                  {enabledModels.map((model) => (
                    <span key={model} className="inline-flex items-center gap-2 rounded-md border border-[#343b49] bg-[#151820] px-2 py-1 text-sm">
                      <button
                        onClick={() => onUpdate("model", model)}
                        className={model === form.model ? "font-medium text-emerald-300" : "text-slate-300 hover:text-white"}
                        title={s("makeProviderDefaultModel")}
                      >
                        {model}
                      </button>
                      {model === form.model && <span className="text-xs text-emerald-300">{s("default")}</span>}<CapabilityEditor model={model} capabilities={form.modelCapabilities?.[model] ?? inferModelCapabilities(model)} onToggle={onToggleCapability} />
                      <button onClick={() => onRemoveEnabledModel(model)} className="text-slate-500 hover:text-rose-300" title={s("removeModel")}>
                        x
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-[#343b49] p-3 text-sm text-slate-500">{s("noEnabledModels")}</div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={onSave} className="rounded-md bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]">
            {s("save")}
          </button>
          <button onClick={onTestConnection} disabled={testing} className="rounded-md border border-[#343b49] px-4 py-2 text-sm text-slate-300 hover:bg-[#242936] disabled:opacity-50">
            {testing ? s("testing") : s("test")}
          </button>
        </div>

        {message && <NoticeBlock message={message} />}
      </section>
    </div>
  );
}

function ContextSettingsTab({
  language,
  settings,
  onChange,
}: {
  language: Language;
  settings: {
    recentMessages: number;
    COMPRESS_KEEP: number;
    COMPRESS_THRESHOLD: number;
    compressionNoticeEnabled: boolean;
  };
  onChange: (key: keyof typeof settings, value: number | boolean) => Promise<void>;
}) {
  const s = makeTranslator(language);
  return (
    <section className="max-w-3xl rounded-lg border border-[#2a2f3a] bg-[#151820] p-5">
      <h2 className="font-semibold">{s("contextTitle")}</h2>
      <p className="mt-1 text-sm text-slate-500">{s("autoSave")}</p>
      <div className="mt-5 grid gap-4">
        <NumberSetting label={s("recentMessages")} value={settings.recentMessages} min={1} max={50} onChange={(value) => onChange("recentMessages", value)} />
        <NumberSetting label={s("compressKeep")} value={settings.COMPRESS_KEEP} min={1} max={20} onChange={(value) => onChange("COMPRESS_KEEP", value)} />
        <NumberSetting label={s("compressThreshold")} value={settings.COMPRESS_THRESHOLD} min={1000} max={100000} onChange={(value) => onChange("COMPRESS_THRESHOLD", value)} />
        <label className="flex items-center justify-between rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-3 text-sm text-slate-300">
          <span>{s("compressionNotice")}</span>
          <input type="checkbox" checked={settings.compressionNoticeEnabled} onChange={(event) => void onChange("compressionNoticeEnabled", event.target.checked)} />
        </label>
      </div>
    </section>
  );
}

function DataManagementTab({
  language,
  stats,
  message,
  onRefresh,
  onChangePath,
  onExport,
  onImport,
}: {
  language: Language;
  stats: DataStats | null;
  message: Notice;
  onRefresh: () => void;
  onChangePath: () => void;
  onExport: () => void;
  onImport: () => void;
}) {
  const s = makeTranslator(language);
  return (
    <section className="max-w-4xl rounded-lg border border-[#2a2f3a] bg-[#151820] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{s("dataTitle")}</h2>
          <p className="mt-1 text-sm text-slate-500">{s("dataDesc")}</p>
        </div>
        <button onClick={onRefresh} className="rounded-md border border-[#343b49] px-3 py-2 text-sm text-slate-300 hover:bg-[#242936]">
          {s("refresh")}
        </button>
      </div>

      <div className="mt-5 grid gap-4">
        <div className="rounded-md border border-[#343b49] bg-[#0f1117] p-3">
          <div className="text-xs text-slate-500">{s("currentPath")}</div>
          <div className="mt-2 break-all text-sm text-slate-200">{stats?.storagePath ?? s("reading")}</div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label={s("conversations")} value={String(stats?.conversationCount ?? "-")} />
          <Stat label={s("messages")} value={String(stats?.messageCount ?? "-")} />
          <Stat label={s("dbSize")} value={stats ? formatBytes(stats.dbSizeBytes) : "-"} />
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={onChangePath} className="rounded-md bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]">
            {s("changePath")}
          </button>
          <button onClick={onExport} className="rounded-md border border-[#343b49] px-4 py-2 text-sm text-slate-300 hover:bg-[#242936]">
            {s("exportData")}
          </button>
          <button onClick={onImport} className="rounded-md border border-amber-500/50 px-4 py-2 text-sm text-amber-100 hover:bg-amber-500/10">
            {s("importData")}
          </button>
        </div>

        {message && <NoticeBlock message={message} />}
      </div>
    </section>
  );
}

function AppearanceTab({ language, theme, onChange }: { language: Language; theme: string; onChange: (value: string) => void }) {
  const s = makeTranslator(language);
  return (
    <section className="max-w-3xl rounded-lg border border-[#2a2f3a] bg-[#151820] p-5">
      <h2 className="font-semibold">{s("appearanceTitle")}</h2>
      <p className="mt-1 text-sm text-slate-500">{s("appearanceDesc")}</p>
      <div className="mt-5 grid gap-2">
        {[
          { value: "dark", label: s("dark") },
          { value: "light", label: s("light") },
          { value: "system", label: s("system") },
        ].map((item) => (
          <label key={item.value} className="flex items-center gap-3 rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-3 text-sm text-slate-300">
            <input type="radio" checked={theme === item.value} onChange={() => onChange(item.value)} />
            {item.label}
          </label>
        ))}
      </div>
    </section>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  async function commit() {
    const next = clampInt(draft, value, min, max);
    setDraft(String(next));
    await onChange(next);
  }

  return (
    <label className="grid gap-1 text-sm text-slate-300">
      <span>
        {label} <span className="text-xs text-slate-500">({min}-{max})</span>
      </span>
      <input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        className="rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none focus:border-[#3b82f6]"
      />
    </label>
  );
}

function NoticeBlock({ message }: { message: Exclude<Notice, null> }) {
  return (
    <pre
      className={`whitespace-pre-wrap rounded-md border p-3 text-sm ${
        message.type === "success"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          : message.type === "error"
            ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
            : "border-[#343b49] bg-[#0f1117] text-slate-300"
      }`}
    >
      {message.text}
    </pre>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#343b49] bg-[#0f1117] p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="grid gap-1 text-sm text-slate-300">
      <span>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        className="rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#3b82f6]"
      />
    </label>
  );
}

function toInput(provider: Provider): ProviderInput {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model,
    enabledModels: provider.enabledModels?.length ? provider.enabledModels : [provider.model].filter(Boolean),
    modelCapabilities: provider.modelCapabilities ?? {},
    temperature: provider.temperature,
    maxTokens: provider.maxTokens,
    stream: provider.stream,
    endpointType: provider.endpointType ?? "chat_completions",
    autoAppendPath: provider.autoAppendPath ?? false,
    endpointPathMode: provider.endpointPathMode ?? "append_chat_completions",
    isDefault: provider.isDefault,
  };
}

function normalizeForm(form: ProviderInput): ProviderInput {
  const models = normalizeModels(form.enabledModels ?? [], form.model);
  const model = models.includes(form.model) ? form.model : models[0] ?? form.model.trim();
  return {
    ...form,
    model,
    enabledModels: models,
    baseUrl: form.baseUrl.trim(),
    endpointType: form.endpointType ?? "chat_completions",
    endpointPathMode: form.endpointPathMode ?? "append_chat_completions",
    autoAppendPath: form.endpointPathMode !== "exact",
  };
}

function chooseDefaultModel(form: ProviderInput): ProviderInput {
  const models = normalizeModels(form.enabledModels ?? [], form.model);
  return {
    ...form,
    enabledModels: models,
    model: models.includes(form.model) ? form.model : models[0] ?? "",
  };
}

function normalizeModels(models: string[], fallback?: string) {
  const values = [...models, fallback ?? ""].map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set(values));
}

function clampInt(value: string | number | undefined, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function applyTheme(theme: string) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches;
  root.dataset.effectiveTheme = theme === "system" ? (prefersLight ? "light" : "dark") : theme;
}

function getPathModes(language: Language): Array<{ value: EndpointPathMode; label: string; description: string }> {
  const s = makeTranslator(language);
  return PATH_MODE_VALUES.map((value) => {
    if (value === "exact") return { value, label: s("pathExact"), description: s("pathExactDesc") };
    if (value === "append_v1_chat_completions") return { value, label: s("pathV1Chat"), description: s("pathV1ChatDesc") };
    return { value, label: s("pathChat"), description: s("pathChatDesc") };
  });
}

function makeTranslator(language: Language) {
  return (key: string, params?: Record<string, string | number>) => {
    const table = TEXT[language] as unknown as Record<string, string | Record<string, string>>;
    const raw = key.includes(".")
      ? key.split(".").reduce<unknown>((current, part) => (current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined), TEXT[language])
      : table[key];
    const template = typeof raw === "string" ? raw : key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? ""));
  };
}

const CAPABILITY_OPTIONS: Array<{ value: ModelCapability; label: string; title: string }> = [
  { value: "text", label: "T", title: "文本" },
  { value: "vision", label: "👁", title: "看图" },
  { value: "tools", label: "🔧", title: "工具" },
  { value: "web", label: "🌐", title: "联网" },
  { value: "reasoning", label: "思", title: "思考" },
];

function CapabilityEditor({ model, capabilities, onToggle }: { model: string; capabilities: ModelCapability[]; onToggle: (model: string, capability: ModelCapability, checked: boolean) => void }) {
  return (
    <span className="inline-flex items-center gap-1 border-l border-[#343b49] pl-2">
      {CAPABILITY_OPTIONS.map((item) => (
        <label key={item.value} title={item.title} className="inline-flex cursor-pointer items-center gap-1 rounded border border-[#343b49] px-1 py-0.5 text-[11px] text-slate-400 hover:text-slate-100">
          <input type="checkbox" checked={capabilities.includes(item.value)} onChange={(event) => onToggle(model, item.value, event.target.checked)} className="h-3 w-3" />
          <span>{item.label}</span>
        </label>
      ))}
    </span>
  );
}

function syncCapabilities(current: ProviderInput["modelCapabilities"] | undefined, models: string[]) {
  const out: NonNullable<ProviderInput["modelCapabilities"]> = {};
  for (const model of models) {
    out[model] = normalizeCapabilities(current?.[model] ?? inferModelCapabilities(model));
  }
  return out;
}

function normalizeCapabilities(values: ModelCapability[]) {
  return Array.from(new Set<ModelCapability>(["text", ...values]));
}

function inferModelCapabilities(model: string): ModelCapability[] {
  const lower = model.toLowerCase();
  const caps: ModelCapability[] = ["text"];
  if (/vision|vl|image|visual|gpt-4o|gemini|qwen-vl|qvq|llava|pixtral|claude-3|claude-4|doubao.*vision/.test(lower)) caps.push("vision");
  if (/tool|function|gpt-4o|gpt-5|claude|gemini|qwen|max|deepseek/.test(lower)) caps.push("tools");
  if (/web|search|online|sonar|perplexity|联网/.test(lower)) caps.push("web");
  if (/reason|thinking|r1|o1|o3|o4|qvq|qwq|deepseek-reasoner/.test(lower)) caps.push("reasoning");
  return Array.from(new Set(caps));
}




