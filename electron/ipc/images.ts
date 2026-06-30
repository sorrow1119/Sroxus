import { ipcMain } from "electron";
import type { ImageGenerationInput } from "../../shared/types";
import { getDefaultProvider, getProvider } from "../database/providers";
import { OpenAICompatibleImageClient } from "../services/image-client";

export function registerImagesIpc() {
  ipcMain.handle("images:generate", async (_event, input: ImageGenerationInput) => {
    const provider = input.providerId ? getProvider(input.providerId) : getDefaultProvider();
    const client = new OpenAICompatibleImageClient({
      ...provider,
      model: input.model || provider.model,
      stream: false,
    });
    return client.generate(input);
  });
}
