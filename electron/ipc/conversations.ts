import { ipcMain } from "electron";
import {
  createConversation,
  deleteConversation,
  listConversations,
  renameConversation,
  updateConversationSummary,
  updateConversationSystemPrompt,
} from "../database/conversations";

export function registerConversationIpc() {
  ipcMain.handle("conversations:list", () => listConversations());
  ipcMain.handle("conversations:create", (_event, title: string) => createConversation(title));
  ipcMain.handle("conversations:rename", (_event, id: string, title: string) => renameConversation(id, title));
  ipcMain.handle("conversations:delete", (_event, id: string) => {
    deleteConversation(id);
    return { ok: true as const };
  });
  ipcMain.handle("conversations:update-summary", (_event, id: string, summary: string) =>
    updateConversationSummary(id, summary),
  );
  ipcMain.handle("conversations:update-system-prompt", (_event, id: string, prompt: string) =>
    updateConversationSystemPrompt(id, prompt),
  );
}
