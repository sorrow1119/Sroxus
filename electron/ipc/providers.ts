import { ipcMain } from "electron";
import type { ProviderInput } from "../../shared/types";
import {
  createProvider,
  deleteProvider,
  listProviders,
  setDefaultProvider,
  updateProvider,
} from "../database/providers";
import { OpenAICompatibleClient } from "../services/ai-client";

export function registerProvidersIpc() {
  ipcMain.handle("providers:list", () => listProviders());
  ipcMain.handle("providers:create", (_event, provider: ProviderInput) => createProvider(provider));
  ipcMain.handle("providers:update", (_event, id: string, provider: Partial<ProviderInput>) => updateProvider(id, provider));
  ipcMain.handle("providers:delete", (_event, id: string) => {
    deleteProvider(id);
    return { ok: true as const };
  });
  ipcMain.handle("providers:set-default", (_event, id: string) => setDefaultProvider(id));
  ipcMain.handle("providers:test-connection", async (_event, provider: ProviderInput) => {
    const client = new OpenAICompatibleClient({
      ...provider,
      stream: provider.stream !== false,
      temperature: provider.temperature ?? 0.7,
      maxTokens: provider.maxTokens ?? 4096,
    });
    return client.testConnection();
  });
  ipcMain.handle("providers:list-models", async (_event, provider: ProviderInput) => {
    const client = new OpenAICompatibleClient({
      ...provider,
      stream: provider.stream !== false,
      temperature: provider.temperature ?? 0.7,
      maxTokens: provider.maxTokens ?? 4096,
    });
    return client.listModels();
  });
  ipcMain.handle("providers:benchmark-base-urls", async (_event, provider: ProviderInput) => {
    const client = new OpenAICompatibleClient({
      ...provider,
      stream: provider.stream !== false,
      temperature: provider.temperature ?? 0.7,
      maxTokens: provider.maxTokens ?? 4096,
    });
    return client.benchmarkBaseUrls();
  });
}
