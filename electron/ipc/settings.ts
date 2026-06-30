import { ipcMain } from "electron";
import { getAllSettings, getAppVersion, getSetting, setSetting } from "../database/settings";

export function registerSettingsIpc() {
  ipcMain.handle("app:get-version", () => getAppVersion());
  ipcMain.handle("settings:get", (_event, key: string) => getSetting(key));
  ipcMain.handle("settings:set", (_event, key: string, value: string) => {
    setSetting(key, value);
    return { ok: true as const };
  });
  ipcMain.handle("settings:get-all", () => getAllSettings());
}
