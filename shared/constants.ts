export const APP_NAME = "Sroxus";
export const DEFAULT_DATA_DIR_NAME = "Sroxus";

export const DEFAULT_RECENT_MESSAGES = 10;
export const DEFAULT_COMPRESS_KEEP = 6;
export const DEFAULT_COMPRESS_THRESHOLD = 12000;

export const PROVIDER_PRESETS = [
  {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    signupUrl: "https://platform.deepseek.com",
    kind: "official",
    tags: ["official", "text"],
  },
  {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    signupUrl: "https://platform.openai.com/api-keys",
    kind: "official",
    tags: ["official", "multimodal"],
  },
  {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    signupUrl: "https://openrouter.ai/keys",
    kind: "official",
    tags: ["official", "multi-model"],
  },
  {
    name: "APIKEY.FUN",
    baseUrl: "https://api.apikey.fun",
    signupUrl: "https://apikey.fun/register?aff=9DLXUDEP26GZ",
    kind: "recommended",
    tags: ["recommended", "gateway"],
  },
  {
    name: "兔子",
    baseUrl: "https://api.tu-zi.com",
    signupUrl: "https://api.tu-zi.com/register?aff=tTqN",
    kind: "recommended",
    tags: ["recommended", "gateway"],
  },
  {
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    signupUrl: "https://cloud.siliconflow.cn/i/0b570dED",
    kind: "official",
    tags: ["official", "domestic"],
  },
  {
    name: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    signupUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key",
    kind: "official",
    tags: ["official", "domestic"],
  },
  {
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    signupUrl: "https://platform.moonshot.cn/console/api-keys",
    kind: "official",
    tags: ["official", "long-context"],
  },
  {
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    signupUrl: "https://ollama.com",
    kind: "local",
    tags: ["local", "no-api-key"],
  },
  {
    name: "自定义",
    baseUrl: "",
    signupUrl: "",
    kind: "custom",
    tags: ["custom"],
  },
] as const;

export const RECOMMENDED_PROVIDERS = PROVIDER_PRESETS.filter((provider) => provider.signupUrl);
