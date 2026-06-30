import { ipcMain } from "electron";
import type { Role } from "../../shared/types";
import { createMessage, listMessages, markMessagesCompressed, searchMessages } from "../database/messages";

export function registerMessagesIpc() {
  ipcMain.handle("messages:list", (_event, conversationId: string) => listMessages(conversationId));
  ipcMain.handle("messages:create", (_event, conversationId: string, role: Role, content: string) =>
    createMessage(conversationId, role, content),
  );
  ipcMain.handle("messages:mark-compressed", (_event, ids: string[]) => ({
    updated: markMessagesCompressed(Array.isArray(ids) ? ids : []),
  }));
  ipcMain.handle("messages:search", (_event, query: string, conversationId?: string | null) =>
    searchMessages(query, conversationId),
  );
}
