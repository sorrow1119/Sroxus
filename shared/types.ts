export type Role = "system" | "user" | "assistant";
export type MessageStatus = "sending" | "success" | "error";
export type EndpointPathMode = "exact" | "append_chat_completions" | "append_v1_chat_completions";
export type AttachmentKind = "image" | "document";

export interface MessageAttachment {
  id: string;
  name: string;
  originalPath: string;
  storedPath: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  extractedText?: string;
  previewDataUrl?: string;
  note?: string;
}

export interface Conversation {
  id: string;
  title: string;
  summary: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  compressed: boolean;
  createdAt: string;
  status: MessageStatus;
  agentId?: string;
  agentName?: string;
  parentMessageId?: string;
  messageType?: "normal" | "agent";
  attachments?: MessageAttachment[];
}

export interface MessageSearchResult {
  id: string;
  conversationId: string;
  conversationTitle: string;
  role: Role;
  content: string;
  compressed: boolean;
  createdAt: string;
  status: MessageStatus;
  agentId?: string;
  agentName?: string;
  parentMessageId?: string;
  messageType?: "normal" | "agent";
  attachments?: MessageAttachment[];
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabledModels: string[];
  temperature: number;
  maxTokens: number;
  stream: boolean;
  endpointType: "chat_completions" | "responses";
  autoAppendPath: boolean;
  endpointPathMode: EndpointPathMode;
  isDefault: boolean;
  createdAt: string;
}

export type ProviderInput = Omit<Provider, "id" | "createdAt" | "isDefault"> & {
  isDefault?: boolean;
};

export interface AIAgent {
  id: string;
  name: string;
  description: string;
  providerId: string;
  model: string;
  systemPrompt: string;
  rolePreset: string;
  enabled: number;
  isPrimary: number;
  createdAt: string;
  updatedAt: string;
}

export type AIAgentInput = Omit<AIAgent, "id" | "createdAt" | "updatedAt" | "enabled" | "isPrimary"> & {
  enabled?: number | boolean;
  isPrimary?: number | boolean;
};

export type CollaborationMode =
  | "normal"
  | "mention"
  | "manual"
  | "coordinator";

export interface RouteResult {
  mode: CollaborationMode;
  targets: AIAgent[];
  tasks: AgentTask[];
}

export interface AgentTask {
  agentId: string;
  agentName: string;
  task: string;
  parentMessageId?: string;
}

export interface AgentResult {
  agentId: string;
  agentName: string;
  content: string;
  error?: string;
  parentMessageId?: string;
}

export interface MessageMeta {
  agentId?: string;
  agentName?: string;
  parentMessageId?: string;
  messageType?: "normal" | "agent";
  attachments?: MessageAttachment[];
}

export interface AppSettings {
  [key: string]: string;
}

export interface DataStats {
  storagePath: string;
  conversationCount: number;
  messageCount: number;
  dbSizeBytes: number;
}

export interface PluginCommand {
  id: string;
  title: string;
  description?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  main?: string;
  permissions?: string[];
  commands?: PluginCommand[];
}

export interface InstalledPlugin extends PluginManifest {
  enabled: boolean;
  path: string;
  valid: boolean;
  error?: string;
}

export interface ChatSendResult {
  userMessage: Message;
  assistantMessage: Message;
  assistantMessages?: Message[];
}

export type RegenerateMode = "retry" | "concise" | "detailed";

export interface ChatRegenerateResult {
  assistantMessage: Message;
}

export interface ChatCompressResult {
  ok: true;
  summary: string;
  compressedCount: number;
}

export interface ChatDeltaEvent {
  conversationId: string;
  messageId: string;
  delta: string;
  content: string;
}

export interface ChatDoneEvent {
  conversationId: string;
  message: Message;
}

export interface ChatErrorEvent {
  conversationId: string;
  message: Message;
  error: string;
}

export type ImageGenerationSize = "256x256" | "512x512" | "768x768" | "1024x1024" | "1024x1792" | "1792x1024";
export type ImageGenerationMode = "openai_images" | "chat_completions_image" | "gemini_generate_content";

export interface ImageGenerationInput {
  prompt: string;
  providerId?: string;
  model?: string;
  mode?: ImageGenerationMode;
  endpointOverride?: string;
  size: ImageGenerationSize;
  count: number;
}

export interface GeneratedImage {
  url?: string;
  dataUrl?: string;
  revisedPrompt?: string;
}

export interface ImageGenerationResult {
  providerName: string;
  model: string;
  endpoint: string;
  prompt: string;
  images: GeneratedImage[];
}

export interface ElectronAPI {
  app: {
    getVersion: () => Promise<string>;
  };
  conversations: {
    list: () => Promise<Conversation[]>;
    create: (title: string) => Promise<Conversation>;
    rename: (id: string, title: string) => Promise<Conversation>;
    delete: (id: string) => Promise<{ ok: true }>;
    updateSummary: (id: string, summary: string) => Promise<Conversation>;
    updateSystemPrompt: (id: string, prompt: string) => Promise<Conversation>;
  };
  messages: {
    list: (conversationId: string) => Promise<Message[]>;
    create: (conversationId: string, role: Role, content: string) => Promise<Message>;
    markCompressed: (ids: string[]) => Promise<{ updated: number }>;
    search: (query: string, conversationId?: string | null) => Promise<MessageSearchResult[]>;
  };
  providers: {
    list: () => Promise<Provider[]>;
    create: (provider: ProviderInput) => Promise<Provider>;
    update: (id: string, provider: Partial<ProviderInput>) => Promise<Provider>;
    delete: (id: string) => Promise<{ ok: true }>;
    setDefault: (id: string) => Promise<Provider>;
    testConnection: (provider: ProviderInput) => Promise<{ ok: boolean; message: string }>;
    listModels: (provider: ProviderInput) => Promise<{ ok: boolean; models: string[]; message: string }>;
    benchmarkBaseUrls: (
      provider: ProviderInput,
    ) => Promise<{ ok: boolean; bestUrl: string | null; results: Array<{ url: string; ok: boolean; latencyMs: number | null; message: string }> }>;
  };
  agents: {
    list: () => Promise<AIAgent[]>;
    create: (agent: AIAgentInput) => Promise<AIAgent>;
    update: (id: string, agent: Partial<AIAgentInput>) => Promise<AIAgent>;
    delete: (id: string) => Promise<{ ok: true }>;
    setPrimary: (id: string) => Promise<AIAgent>;
    setEnabled: (id: string, enabled: boolean) => Promise<AIAgent>;
  };
  settings: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<{ ok: true }>;
    getAll: () => Promise<AppSettings>;
  };
  data: {
    getStoragePath: () => Promise<string>;
    setStoragePath: (newPath: string) => Promise<{ ok: true; path: string }>;
    getStats: () => Promise<DataStats>;
    exportJSON: (filePath: string) => Promise<{ ok: true; filePath: string }>;
    importJSON: (filePath: string) => Promise<{ ok: true; filePath: string }>;
    selectFolder: () => Promise<string | null>;
    selectSaveFile: () => Promise<string | null>;
    selectOpenFile: () => Promise<string | null>;
    selectOpenFiles: () => Promise<string[]>;
    savePastedImage: (dataUrl: string) => Promise<string>;
  };
  plugins: {
    list: () => Promise<InstalledPlugin[]>;
    getPluginsPath: () => Promise<string>;
    openPluginsFolder: () => Promise<{ ok: true; path: string }>;
    installFromFolder: () => Promise<InstalledPlugin | null>;
    setEnabled: (id: string, enabled: boolean) => Promise<InstalledPlugin>;
    uninstall: (id: string) => Promise<{ ok: true }>;
  };
  images: {
    generate: (input: ImageGenerationInput) => Promise<ImageGenerationResult>;
  };
  chat: {
    sendMessage: (
      conversationId: string,
      content: string,
      attachments?: string[],
      providerId?: string,
      model?: string,
    ) => Promise<ChatSendResult>;
    regenerate: (
      conversationId: string,
      assistantMessageId: string,
      mode: RegenerateMode,
      providerId?: string,
      model?: string,
    ) => Promise<ChatRegenerateResult>;
    stopGeneration: () => Promise<{ ok: true }>;
    compress: (conversationId: string, providerId?: string, model?: string) => Promise<ChatCompressResult>;
    getCompressThreshold: () => Promise<number>;
    onDelta: (handler: (event: ChatDeltaEvent) => void) => () => void;
    onDone: (handler: (event: ChatDoneEvent) => void) => () => void;
    onError: (handler: (event: ChatErrorEvent) => void) => () => void;
  };
}
