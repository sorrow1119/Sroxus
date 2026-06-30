import { dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { exportAllDataToFile, importAllDataFromFile } from "../services/data-transfer";
import { getDataStats, getStoragePath, migrateStoragePath } from "../services/storage-path";

export function registerDataIpc() {
  ipcMain.handle("data:get-storage-path", () => getStoragePath());
  ipcMain.handle("data:set-storage-path", (_event, newPath: string) => migrateStoragePath(newPath));
  ipcMain.handle("data:get-stats", () => getDataStats());
  ipcMain.handle("data:export-json", (_event, filePath: string) => {
    exportAllDataToFile(filePath);
    return { ok: true as const, filePath };
  });
  ipcMain.handle("data:import-json", (_event, filePath: string) => {
    importAllDataFromFile(filePath);
    return { ok: true as const, filePath };
  });
  ipcMain.handle("data:select-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("data:select-save-file", async () => {
    const result = await dialog.showSaveDialog({
      filters: [{ name: "JSON", extensions: ["json"] }],
      defaultPath: "local-ai-chat-export.json",
    });
    return result.canceled ? null : result.filePath ?? null;
  });
  ipcMain.handle("data:select-open-file", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("data:select-open-files", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Supported Files",
          extensions: [
            "png",
            "jpg",
            "jpeg",
            "gif",
            "webp",
            "bmp",
            "svg",
            "txt",
            "md",
            "markdown",
            "json",
            "csv",
            "pdf",
            "doc",
            "docx",
            "xls",
            "xlsx",
            "ppt",
            "pptx",
            "py",
            "js",
            "ts",
            "tsx",
            "jsx",
            "html",
            "css",
            "xml",
            "yaml",
            "yml",
            "log",
          ],
        },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("data:save-pasted-image", async (_event, dataUrl: string) => {
    const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(dataUrl);
    if (!match) {
      throw new Error("剪贴板中没有可保存的图片。");
    }
    const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
    const buffer = Buffer.from(match[2], "base64");
    const dir = path.join(getStoragePath(), "pasted-images");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `pasted-${Date.now()}.${ext}`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  });
}
