import { BrowserWindow, app, shell } from "electron";
import path from "node:path";

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: "Sroxus",
    backgroundColor: "#f7f7f4",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 阻止页面内的 window.open / 外链新开窗口，统一交给系统浏览器打开。
  // 这能防止恶意链接继承 preload 拿到 electronAPI。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // 阻止渲染进程导航到任意地址（含 file://、自定义协议等）。
  win.webContents.on("will-navigate", (event, url) => {
    const isDevServer = !app.isPackaged && url.startsWith("http://127.0.0.1:5173");
    const isAppFile = app.isPackaged && url.startsWith("file://");
    if (!isDevServer && !isAppFile) {
      event.preventDefault();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        void shell.openExternal(url);
      }
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  if (!app.isPackaged) {
    void win.loadURL(devServerUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }

  return win;
}
