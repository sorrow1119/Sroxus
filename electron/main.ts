import { BrowserWindow, app } from "electron";
import { createMainWindow } from "./windows";
import { initDatabase } from "./database";
import { registerChatIpc } from "./ipc/chat";
import { registerConversationIpc } from "./ipc/conversations";
import { registerSettingsIpc } from "./ipc/settings";
import { registerDataIpc } from "./ipc/data";
import { registerMessagesIpc } from "./ipc/messages";
import { registerProvidersIpc } from "./ipc/providers";
import { registerAgentsIpc } from "./ipc/agents";
import { registerPluginsIpc } from "./ipc/plugins";
import { registerImagesIpc } from "./ipc/images";

app.setName("Sroxus");

async function bootstrap() {
  await app.whenReady();
  initDatabase();
  registerConversationIpc();
  registerMessagesIpc();
  registerProvidersIpc();
  registerAgentsIpc();
  registerSettingsIpc();
  registerChatIpc();
  registerDataIpc();
  registerPluginsIpc();
  registerImagesIpc();
  createMainWindow();

  app.on("activate", () => {
    if (process.platform === "darwin" && !BrowserWindow.getAllWindows().length) {
      createMainWindow();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

void bootstrap();
