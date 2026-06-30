import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  AIAgentInput,
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ElectronAPI,
  ImageGenerationInput,
  ProviderInput,
  RegenerateMode,
  Role,
} from "../shared/types";

const api: ElectronAPI = {
  app: {
    getVersion: () => ipcRenderer.invoke("app:get-version"),
  },
  conversations: {
    list: () => ipcRenderer.invoke("conversations:list"),
    create: (title: string) => ipcRenderer.invoke("conversations:create", title),
    rename: (id: string, title: string) => ipcRenderer.invoke("conversations:rename", id, title),
    delete: (id: string) => ipcRenderer.invoke("conversations:delete", id),
    updateSummary: (id: string, summary: string) => ipcRenderer.invoke("conversations:update-summary", id, summary),
    updateSystemPrompt: (id: string, prompt: string) => ipcRenderer.invoke("conversations:update-system-prompt", id, prompt),
  },
  messages: {
    list: (conversationId: string) => ipcRenderer.invoke("messages:list", conversationId),
    create: (conversationId: string, role: Role, content: string) =>
      ipcRenderer.invoke("messages:create", conversationId, role, content),
    markCompressed: (ids: string[]) => ipcRenderer.invoke("messages:mark-compressed", ids),
    search: (query: string, conversationId?: string | null) => ipcRenderer.invoke("messages:search", query, conversationId),
  },
  providers: {
    list: () => ipcRenderer.invoke("providers:list"),
    create: (provider: ProviderInput) => ipcRenderer.invoke("providers:create", provider),
    update: (id: string, provider: Partial<ProviderInput>) => ipcRenderer.invoke("providers:update", id, provider),
    delete: (id: string) => ipcRenderer.invoke("providers:delete", id),
    setDefault: (id: string) => ipcRenderer.invoke("providers:set-default", id),
    testConnection: (provider: ProviderInput) => ipcRenderer.invoke("providers:test-connection", provider),
    listModels: (provider: ProviderInput) => ipcRenderer.invoke("providers:list-models", provider),
    benchmarkBaseUrls: (provider: ProviderInput) => ipcRenderer.invoke("providers:benchmark-base-urls", provider),
  },
  agents: {
    list: () => ipcRenderer.invoke("agents:list"),
    create: (agent: AIAgentInput) => ipcRenderer.invoke("agents:create", agent),
    update: (id: string, agent: Partial<AIAgentInput>) => ipcRenderer.invoke("agents:update", id, agent),
    delete: (id: string) => ipcRenderer.invoke("agents:delete", id),
    setPrimary: (id: string) => ipcRenderer.invoke("agents:set-primary", id),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke("agents:set-enabled", id, enabled),
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke("settings:get", key),
    set: (key: string, value: string) => ipcRenderer.invoke("settings:set", key, value),
    getAll: () => ipcRenderer.invoke("settings:get-all"),
  },
  data: {
    getStoragePath: () => ipcRenderer.invoke("data:get-storage-path"),
    setStoragePath: (newPath: string) => ipcRenderer.invoke("data:set-storage-path", newPath),
    getStats: () => ipcRenderer.invoke("data:get-stats"),
    exportJSON: (filePath: string) => ipcRenderer.invoke("data:export-json", filePath),
    importJSON: (filePath: string) => ipcRenderer.invoke("data:import-json", filePath),
    selectFolder: () => ipcRenderer.invoke("data:select-folder"),
    selectSaveFile: () => ipcRenderer.invoke("data:select-save-file"),
    selectOpenFile: () => ipcRenderer.invoke("data:select-open-file"),
    selectOpenFiles: () => ipcRenderer.invoke("data:select-open-files"),
    savePastedImage: (dataUrl: string) => ipcRenderer.invoke("data:save-pasted-image", dataUrl),
  },
  plugins: {
    list: () => ipcRenderer.invoke("plugins:list"),
    getPluginsPath: () => ipcRenderer.invoke("plugins:get-path"),
    openPluginsFolder: () => ipcRenderer.invoke("plugins:open-folder"),
    installFromFolder: () => ipcRenderer.invoke("plugins:install-from-folder"),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke("plugins:set-enabled", id, enabled),
    uninstall: (id: string) => ipcRenderer.invoke("plugins:uninstall", id),
  },
  images: {
    generate: (input: ImageGenerationInput) => ipcRenderer.invoke("images:generate", input),
  },
  chat: {
    sendMessage: (conversationId: string, content: string, attachments?: string[], providerId?: string, model?: string) =>
      ipcRenderer.invoke("chat:send-message", conversationId, content, attachments, providerId, model),
    regenerate: (conversationId: string, assistantMessageId: string, mode: RegenerateMode, providerId?: string, model?: string) =>
      ipcRenderer.invoke("chat:regenerate", conversationId, assistantMessageId, mode, providerId, model),
    stopGeneration: () => ipcRenderer.invoke("chat:stop-generation"),
    compress: (conversationId: string, providerId?: string, model?: string) =>
      ipcRenderer.invoke("chat:compress", conversationId, providerId, model),
    getCompressThreshold: () => ipcRenderer.invoke("chat:get-compress-threshold"),
    onDelta: (handler: (event: ChatDeltaEvent) => void) => {
      const listener = (_event: IpcRendererEvent, payload: ChatDeltaEvent) => handler(payload);
      ipcRenderer.on("chat:delta", listener);
      return () => ipcRenderer.removeListener("chat:delta", listener);
    },
    onDone: (handler: (event: ChatDoneEvent) => void) => {
      const listener = (_event: IpcRendererEvent, payload: ChatDoneEvent) => handler(payload);
      ipcRenderer.on("chat:done", listener);
      return () => ipcRenderer.removeListener("chat:done", listener);
    },
    onError: (handler: (event: ChatErrorEvent) => void) => {
      const listener = (_event: IpcRendererEvent, payload: ChatErrorEvent) => handler(payload);
      ipcRenderer.on("chat:error", listener);
      return () => ipcRenderer.removeListener("chat:error", listener);
    },
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);
