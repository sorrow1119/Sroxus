export type Role = "system" | "user" | "assistant";
export type MessageStatus = "sending" | "success" | "error";
export type EndpointPathMode = "exact" | "append_chat_completions" | "append_v1_chat_completions";
export type AttachmentKind = "image" | "document";
export type ModelCapability = "text" | "vision" | "tools" | "web" | "reasoning";
export type ModelCapabilitiesMap = Record<string, ModelCapability[]>;

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
  modelCapabilities?: ModelCapabilitiesMap;
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

export type ImageGenerationSize = string;
export type ImageGenerationMode = "openai_images" | "openai_image_edits" | "chat_completions_image" | "gemini_generate_content";

export interface ImageAsset {
  path: string;
  name: string;
  bytes: number;
  modifiedAt: number;
  error?: string;
}

export interface ImageHistoryEntry {
  id: string;
  createdAt: string;
  status: "running" | "completed" | "partial" | "failed" | "interrupted";
  input: ImageGenerationInput;
  result?: ImageGenerationResult;
  error?: string;
}

export interface ImagePromptInput {
  providerId: string;
  model: string;
  prompt: string;
  creative: boolean;
  referencePaths?: string[];
}

export interface ImageGenerationInput {
  prompt: string;
  negativePrompt?: string;
  providerId?: string;
  model?: string;
  mode?: ImageGenerationMode;
  creationMode?: "text" | "edit" | "reference";
  protocolAutomatic?: boolean;
  endpointOverride?: string;
  size: ImageGenerationSize;
  resolution?: "auto" | "1K" | "2K" | "4K";
  count: number;
  referencePaths?: string[];
  referenceMode?: "edit" | "reference";
  aspectRatio?: "auto" | "1:1" | "3:4" | "4:3" | "9:16" | "16:9" | "2:3" | "3:2" | "custom";
}

export interface GeneratedImage {
  url?: string;
  dataUrl?: string;
  revisedPrompt?: string;
  savedPath?: string;
  savedFileName?: string;
  width?: number;
  height?: number;
}

export interface ImageGenerationResult {
  providerName: string;
  model: string;
  endpoint: string;
  prompt: string;
  images: GeneratedImage[];
  warning?: string;
  sizeNote?: string;
}

export type VideoProtocol = "ark" | "openai_video" | "grok_video" | "newapi_video" | "muse_video";
export type VideoMode = "text" | "first_frame" | "first_last_frame" | "reference_images";
export interface VideoReferenceImage {
  path: string;
  purpose: "subject" | "scene" | "clothing" | "style" | "other";
}
export type VideoTaskStatus = "submitting" | "submission_unknown" | "queued" | "running" | "downloading" | "download_failed" | "completed" | "failed" | "cancelled" | "expired";

export interface VideoGenerationInput {
  providerId: string;
  model: string;
  prompt: string;
  protocol: "auto" | VideoProtocol;
  mode: VideoMode;
  firstFramePath?: string;
  lastFramePath?: string;
  referenceImages?: VideoReferenceImage[];
  duration: number;
  aspectRatio: string;
  resolution: string;
  audio: "default" | "on" | "off";
  seed?: number;
  endpointOverride?: string;
  queryEndpointOverride?: string;
  downloadEndpointOverride?: string;
}

export interface VideoTask {
  id: string;
  createdAt: string;
  updatedAt: string;
  providerName: string;
  input: VideoGenerationInput;
  protocol: VideoProtocol;
  endpoint: string;
  remoteId?: string;
  status: VideoTaskStatus;
  stage: "submit" | "query" | "download" | "cancel" | "recovery";
  pollingPaused: boolean;
  error?: string;
  savedPath?: string;
  savedFileName?: string;
  playbackUrl?: string;
  sourceName?: string;
  diagnostic: string;
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
    listModels: (provider: ProviderInput) => Promise<{ ok: boolean; models: string[]; modelCapabilities?: ModelCapabilitiesMap; message: string }>;
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
    chooseFolder: () => Promise<string | null>;
    gallery: (folder: string) => Promise<ImageAsset[]>;
    chooseReferences: (limit?: number) => Promise<ImageAsset[]>;
    importReferences: (paths: string[], limit?: number) => Promise<ImageAsset[]>;
    thumbnail: (filePath: string, variant?: "gallery" | "result") => Promise<string>;
    preview: (filePath: string) => Promise<string>;
    reveal: (filePath: string) => Promise<void>;
    saveAs: (filePath: string) => Promise<string | null>;
    history: () => Promise<ImageHistoryEntry[]>;
    cancel: (id: string) => Promise<void>;
    delete: (id: string) => Promise<void>;
    improvePrompt: (input: ImagePromptInput) => Promise<string>;
  };
  videos: {
    listModels: (providerId: string) => Promise<{ ok: boolean; models: string[]; message: string; museProtocol?: VideoProtocol }>;
    create: (input: VideoGenerationInput) => Promise<VideoTask>;
    history: () => Promise<VideoTask[]>;
    refresh: (id: string) => Promise<VideoTask>;
    pause: (id: string) => Promise<VideoTask>;
    resume: (id: string) => Promise<VideoTask>;
    cancel: (id: string) => Promise<VideoTask>;
    delete: (id: string) => Promise<void>;
    attach: (input: VideoGenerationInput, remoteId: string, localId?: string) => Promise<VideoTask>;
    saveAs: (id: string) => Promise<string | null>;
    reveal: (id: string) => Promise<void>;
    improvePrompt: (input: ImagePromptInput) => Promise<string>;
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



