import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import type { InstalledPlugin, PluginManifest } from "../../shared/types";
import { getSetting, setSetting } from "../database/settings";
import { getStoragePath } from "./storage-path";

const MANIFEST_FILE = "plugin.json";

export function getPluginsPath() {
  const dir = path.join(getStoragePath(), "plugins");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listPlugins(): InstalledPlugin[] {
  const root = getPluginsPath();
  const enabledMap = readEnabledMap();
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readPluginDirectory(path.join(root, entry.name), enabledMap))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function setPluginEnabled(id: string, enabled: boolean) {
  const plugins = listPlugins();
  const plugin = plugins.find((item) => item.id === id);
  if (!plugin) {
    throw new Error(`Plugin not found: ${id}`);
  }
  const enabledMap = readEnabledMap();
  enabledMap[id] = enabled;
  writeEnabledMap(enabledMap);
  return { ...plugin, enabled };
}

export function uninstallPlugin(id: string) {
  const plugin = listPlugins().find((item) => item.id === id);
  if (!plugin) {
    throw new Error(`Plugin not found: ${id}`);
  }
  assertPluginPath(plugin.path);
  fs.rmSync(plugin.path, { recursive: true, force: true });
  const enabledMap = readEnabledMap();
  delete enabledMap[id];
  writeEnabledMap(enabledMap);
  return { ok: true as const };
}

export async function openPluginsFolder() {
  const dir = getPluginsPath();
  await shell.openPath(dir);
  return { ok: true as const, path: dir };
}

export function installPluginFromFolder(sourceDir: string) {
  const manifest = readManifest(path.join(sourceDir, MANIFEST_FILE));
  const targetDir = path.join(getPluginsPath(), safeFolderName(manifest.id));
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  copyDirectory(sourceDir, targetDir);
  const enabledMap = readEnabledMap();
  enabledMap[manifest.id] = true;
  writeEnabledMap(enabledMap);
  return readPluginDirectory(targetDir, enabledMap);
}

function readPluginDirectory(dir: string, enabledMap: Record<string, boolean>): InstalledPlugin {
  try {
    const manifest = readManifest(path.join(dir, MANIFEST_FILE));
    return {
      ...manifest,
      enabled: enabledMap[manifest.id] ?? true,
      path: dir,
      valid: true,
    };
  } catch (error) {
    const fallbackId = path.basename(dir);
    return {
      id: fallbackId,
      name: fallbackId,
      version: "0.0.0",
      enabled: false,
      path: dir,
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readManifest(filePath: string): PluginManifest {
  if (!fs.existsSync(filePath)) {
    throw new Error("Missing plugin.json");
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<PluginManifest>;
  if (!data.id || !/^[a-zA-Z0-9._-]+$/.test(data.id)) {
    throw new Error("plugin.json requires a valid id");
  }
  if (!data.name) {
    throw new Error("plugin.json requires name");
  }
  if (!data.version) {
    throw new Error("plugin.json requires version");
  }
  return {
    id: data.id,
    name: data.name,
    version: data.version,
    description: data.description ?? "",
    author: data.author ?? "",
    main: data.main ?? "",
    permissions: Array.isArray(data.permissions) ? data.permissions.filter((item): item is string => typeof item === "string") : [],
    commands: Array.isArray(data.commands)
      ? data.commands
          .filter((item) => item && typeof item.id === "string" && typeof item.title === "string")
          .map((item) => ({ id: item.id, title: item.title, description: item.description ?? "" }))
      : [],
  };
}

function readEnabledMap() {
  try {
    return JSON.parse(getSetting("plugins.enabled") ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeEnabledMap(value: Record<string, boolean>) {
  setSetting("plugins.enabled", JSON.stringify(value));
}

function safeFolderName(id: string) {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function assertPluginPath(pluginPath: string) {
  const root = path.resolve(getPluginsPath());
  const resolved = path.resolve(pluginPath);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error("Invalid plugin path");
  }
}

function copyDirectory(from: string, to: string) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(source, target);
    } else if (entry.isFile()) {
      fs.copyFileSync(source, target);
    }
  }
}
