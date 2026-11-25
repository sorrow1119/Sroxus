import { ipcMain } from "electron";
import { getAllSettings, getAppVersion, getSetting, setSetting } from "../database/settings";

export function registerSettingsIpc() {
  ipcMain.handle("app:get-version", () => getAppVersion());
  ipcMain.handle("settings:get", (_event, key: string) => getSetting(key));
  ipcMain.handle("settings:set", (_event, key: string, value: string) => {
    setSetting(assertSettingKey(key), String(value));
    return { ok: true as const };
  });
  ipcMain.handle("settings:get-all", () => getAllSettings());
}

function assertSettingKey(key: unknown): string {
  if (typeof key !== "string" || !key.trim()) {
    throw new Error("设置项名称无效。");
  }
  if (key.length > 128) {
    throw new Error("设置项名称过长。");
  }
  // 拒绝控制字符，防止通过 IPC 注入异常键名。
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(key)) {
    throw new Error("设置项名称包含非法字符。");
  }
  return key;
}
