import { ipcMain } from "electron";
import type { AIAgentInput } from "../../shared/types";
import {
  createAgent,
  deleteAgent,
  listAgents,
  setAgentEnabled,
  setPrimaryAgent,
  updateAgent,
} from "../database/agents";

export function registerAgentsIpc() {
  ipcMain.handle("agents:list", () => listAgents());
  ipcMain.handle("agents:create", (_event, agent: AIAgentInput) => createAgent(agent));
  ipcMain.handle("agents:update", (_event, id: string, agent: Partial<AIAgentInput>) => updateAgent(id, agent));
  ipcMain.handle("agents:delete", (_event, id: string) => {
    deleteAgent(id);
    return { ok: true as const };
  });
  ipcMain.handle("agents:set-primary", (_event, id: string) => setPrimaryAgent(id));
  ipcMain.handle("agents:set-enabled", (_event, id: string, enabled: boolean) => setAgentEnabled(id, enabled));
}
