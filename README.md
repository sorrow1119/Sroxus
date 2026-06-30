# Sroxus

**Sroxus** is a local-first desktop AI chat client built with Electron, React,
Vite, TypeScript, Tailwind CSS, and SQLite. It focuses on long conversations,
context compression, multi-provider AI access, multi-agent collaboration,
privacy protection, attachments, and image generation.

**Sroxus** 是一个本地优先的 AI 聊天桌面客户端，基于 Electron + React +
Vite + TypeScript + Tailwind CSS + SQLite 构建。它重点解决长会话上下文
过长、多 Provider 接入、多 AI 协作、隐私保护、附件对话和生图等个人使用场景。

## Highlights / 主要特点

- **Local-first storage / 本地优先**  
  Conversations, messages, settings, providers, and API keys are stored on your
  own machine. API keys are encrypted with Electron `safeStorage` when possible.

- **Context compression / 长会话上下文压缩**  
  Keep full chat history locally, while sending only the rolling summary and
  recent uncompressed messages to reduce token usage.

- **Multi-provider support / 多 Provider 支持**  
  Supports OpenAI-compatible APIs, including OpenAI, DeepSeek, OpenRouter,
  SiliconFlow, Qwen-compatible endpoints, Kimi, Ollama, and custom gateways.

- **Multi-agent collaboration / 多 AI 协作**  
  Add multiple AI agents with names, descriptions, models, and prompts. Mention
  agents with `@name`, assign tasks manually, or let the primary AI coordinate.

- **Privacy filtering / 隐私过滤**  
  Best-effort local redaction for common secrets and personal data before sending
  requests, plus log sanitization for raw AI responses.

- **Attachments / 附件对话**  
  Attach multiple documents and images, and paste screenshots directly into the
  chat composer.

- **Image generation / AI 生图**  
  Use providers that support `/v1/images/generations` to generate images from
  prompts without downloading local models.

- **Plugins foundation / 插件系统雏形**  
  Includes a local plugin manifest and management foundation for future extension
  features.

- **Data tools / 数据管理**  
  Export/import local data, configure the storage path, and manage summaries.

## Screenshots / 截图

Screenshots are not included yet.

暂未加入截图。

## Tech Stack / 技术栈

- Electron
- React
- Vite
- TypeScript
- Tailwind CSS
- better-sqlite3
- electron-builder

## Getting Started / 开发运行

Requirements:

- Windows
- Node.js 22 LTS recommended
- npm

Install dependencies:

```bash
npm install
```

Run in development mode:

```bash
npm run dev
```

Type check:

```bash
npm run typecheck
```

Build Windows package:

```bash
npm run dist
```

The unpacked app will be generated under:

```text
release/win-unpacked/Sroxus.exe
```

## Data And Privacy / 数据与隐私

Sroxus stores application data outside the project folder, typically under the
Electron user data directory:

```text
%APPDATA%/Sroxus
```

If you customize the storage path in settings, data will be stored in the path
you choose.

Do **not** commit local databases, logs, exported JSON files, attachments, or
storage configuration files. The repository `.gitignore` excludes common local
data and build artifacts.

Sroxus includes privacy filtering and log redaction, but these protections are
best-effort. They do not guarantee absolute security.

Sroxus 的应用数据通常不保存在项目源码目录中，而是保存在 Electron 的用户
数据目录：

```text
%APPDATA%/Sroxus
```

如果你在设置里修改过数据保存路径，数据会保存在你选择的路径中。

请不要提交本地数据库、日志、导出的 JSON、附件或本地存储配置文件。
仓库中的 `.gitignore` 已经排除了常见本地数据和构建产物。

隐私过滤和日志脱敏是尽力而为，不代表绝对安全。

## Provider Notes / Provider 说明

Sroxus supports OpenAI-compatible APIs. Some models only support chat, while
others support vision, tools, or image generation. If image generation fails,
make sure the selected provider and model support `/v1/images/generations`.

Sroxus 支持 OpenAI-compatible API。不同模型能力不同，有些只支持聊天，
有些支持看图、工具调用或生图。如果生图失败，请确认服务商和模型支持
`/v1/images/generations`。

## Support / 支持

If you like this project, you can support it on Ko-fi:

如果你喜欢这个项目，可以在 Ko-fi 支持：

https://ko-fi.com/ichinosun

## Disclaimer / 免责声明

Please read [docs/DISCLAIMER.md](docs/DISCLAIMER.md).

请阅读 [docs/DISCLAIMER.md](docs/DISCLAIMER.md)。

## License / 开源协议

MIT License.

Copyright (c) 2026 ichinosun.
