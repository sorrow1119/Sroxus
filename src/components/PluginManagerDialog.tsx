import { useEffect, useState } from "react";
import type { InstalledPlugin } from "../../shared/types";
import { useI18n } from "../i18n";

interface PluginManagerDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function PluginManagerDialog({ open, onClose }: PluginManagerDialogProps) {
  const { t } = useI18n();
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [pluginsPath, setPluginsPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [rows, path] = await Promise.all([window.electronAPI.plugins.list(), window.electronAPI.plugins.getPluginsPath()]);
      setPlugins(rows);
      setPluginsPath(path);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  async function installFromFolder() {
    setMessage(null);
    const plugin = await window.electronAPI.plugins.installFromFolder();
    if (plugin) {
      setMessage(t("plugins.installed", { name: plugin.name }));
      await refresh();
    }
  }

  async function togglePlugin(plugin: InstalledPlugin) {
    setMessage(null);
    await window.electronAPI.plugins.setEnabled(plugin.id, !plugin.enabled);
    await refresh();
  }

  async function uninstall(plugin: InstalledPlugin) {
    if (!window.confirm(t("plugins.uninstallConfirm", { name: plugin.name }))) {
      return;
    }
    setMessage(null);
    await window.electronAPI.plugins.uninstall(plugin.id);
    setMessage(t("plugins.uninstalled", { name: plugin.name }));
    await refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[86vh] w-full max-w-5xl flex-col rounded-lg border border-[#2a2f3a] bg-[#151820] shadow-2xl">
        <header className="flex items-center justify-between border-b border-[#2a2f3a] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">{t("plugins.title")}</h2>
            <p className="mt-1 text-xs text-slate-500">{t("plugins.subtitle")}</p>
          </div>
          <button onClick={onClose} className="rounded-md border border-[#343b49] px-3 py-1.5 text-sm text-slate-300 hover:bg-[#242936]">
            {t("common.close")}
          </button>
        </header>

        <div className="border-b border-[#2a2f3a] px-5 py-3">
          <div className="break-all rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-xs text-slate-400">
            {t("plugins.folder")}: <span className="text-slate-200">{pluginsPath || t("common.loading")}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => void installFromFolder()}
              disabled={loading}
              className="rounded-md bg-[#2563eb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50"
            >
              {t("plugins.install")}
            </button>
            <button
              onClick={() => void window.electronAPI.plugins.openPluginsFolder()}
              className="rounded-md border border-[#343b49] px-3 py-2 text-sm text-slate-300 hover:bg-[#242936]"
            >
              {t("common.openFolder")}
            </button>
            <button
              onClick={() => void refresh()}
              disabled={loading}
              className="rounded-md border border-[#343b49] px-3 py-2 text-sm text-slate-300 hover:bg-[#242936] disabled:opacity-50"
            >
              {loading ? t("common.loading") : t("common.refresh")}
            </button>
          </div>
          {message && <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</div>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!plugins.length ? (
            <div className="rounded-lg border border-dashed border-[#343b49] p-6 text-sm leading-6 text-slate-500">{t("plugins.empty")}</div>
          ) : (
            <div className="grid gap-3">
              {plugins.map((plugin) => (
                <div key={`${plugin.id}:${plugin.path}`} className="rounded-lg border border-[#2a2f3a] bg-[#0f1117] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-slate-100">{plugin.name}</h3>
                        <span className="rounded bg-[#1f2937] px-2 py-0.5 text-xs text-slate-400">v{plugin.version}</span>
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${
                            plugin.valid
                              ? plugin.enabled
                                ? "bg-emerald-500/15 text-emerald-200"
                                : "bg-slate-500/15 text-slate-300"
                              : "bg-rose-500/15 text-rose-200"
                          }`}
                        >
                          {plugin.valid ? (plugin.enabled ? t("common.enabled") : t("common.disabled")) : t("common.invalid")}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {plugin.id}
                        {plugin.author ? ` · ${plugin.author}` : ""}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void togglePlugin(plugin)}
                        disabled={!plugin.valid}
                        className="rounded-md border border-[#343b49] px-3 py-1.5 text-sm text-slate-300 hover:bg-[#242936] disabled:opacity-50"
                      >
                        {plugin.enabled ? t("common.disable") : t("common.enable")}
                      </button>
                      <button
                        onClick={() => void uninstall(plugin)}
                        className="rounded-md border border-rose-500/50 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-500/10"
                      >
                        {t("common.uninstall")}
                      </button>
                    </div>
                  </div>

                  {plugin.description && <p className="mt-3 text-sm leading-6 text-slate-300">{plugin.description}</p>}
                  {plugin.error && <p className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{plugin.error}</p>}

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <MetaList title={t("plugins.permissions")} values={plugin.permissions ?? []} empty={t("plugins.noPermissions")} />
                    <MetaList title={t("plugins.commands")} values={(plugin.commands ?? []).map((command) => `${command.id} · ${command.title}`)} empty={t("plugins.noCommands")} />
                  </div>
                  <div className="mt-3 break-all text-xs text-slate-600">{plugin.path}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaList({ title, values, empty }: { title: string; values: string[]; empty: string }) {
  return (
    <div className="rounded-md border border-[#252b36] bg-[#111722] p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</div>
      {values.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span key={value} className="rounded bg-[#1f2937] px-2 py-1 text-xs text-slate-300">
              {value}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-xs text-slate-600">{empty}</div>
      )}
    </div>
  );
}
