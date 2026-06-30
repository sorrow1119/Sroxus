import { dialog, ipcMain } from "electron";
import {
  getPluginsPath,
  installPluginFromFolder,
  listPlugins,
  openPluginsFolder,
  setPluginEnabled,
  uninstallPlugin,
} from "../services/plugins";

export function registerPluginsIpc() {
  ipcMain.handle("plugins:list", () => listPlugins());
  ipcMain.handle("plugins:get-path", () => getPluginsPath());
  ipcMain.handle("plugins:open-folder", () => openPluginsFolder());
  ipcMain.handle("plugins:install-from-folder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Sroxus plugin folder",
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return installPluginFromFolder(result.filePaths[0]);
  });
  ipcMain.handle("plugins:set-enabled", (_event, id: string, enabled: boolean) => setPluginEnabled(id, enabled));
  ipcMain.handle("plugins:uninstall", (_event, id: string) => uninstallPlugin(id));
}
