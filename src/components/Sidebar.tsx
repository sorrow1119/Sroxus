import { useState } from "react";
import type { Conversation } from "../../shared/types";
import { APP_NAME } from "../../shared/constants";
import { useI18n } from "../i18n";

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  width: number;
  collapsed: boolean;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onToggleCollapse: () => void;
  onOpenImages: () => void;
  onOpenPlugins: () => void;
  onOpenSettings: () => void;
}

export default function Sidebar({
  conversations,
  activeConversationId,
  width,
  collapsed,
  onCreate,
  onSelect,
  onRename,
  onDelete,
  onToggleCollapse,
  onOpenImages,
  onOpenPlugins,
  onOpenSettings,
}: SidebarProps) {
  const { language, setLanguage, t } = useI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [filter, setFilter] = useState("");
  const filteredConversations = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  if (collapsed) {
    return (
      <aside className="flex h-full w-12 shrink-0 flex-col items-center border-r border-[#2a2f3a] bg-[#151820] py-3">
        <button onClick={onToggleCollapse} className="rounded-md px-2 py-1 text-sm text-slate-300 hover:bg-[#242936]">
          &gt;
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full shrink-0 flex-col border-r border-[#2a2f3a] bg-[#151820]" style={{ width }}>
      <div className="border-b border-[#2a2f3a] p-3">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-100">{APP_NAME}</div>
            <div className="text-xs text-slate-500">{t("app.subtitle")}</div>
          </div>
          <button onClick={onToggleCollapse} className="rounded-md px-2 py-1 text-sm text-slate-400 hover:bg-[#242936]">
            &lt;
          </button>
        </div>
        <button onClick={onCreate} className="w-full rounded-md bg-[#2563eb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]">
          {t("sidebar.newChat")}
        </button>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("sidebar.search")}
          className="mt-3 w-full rounded-md border border-[#343b49] bg-[#0f1117] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#3b82f6]"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#343b49] p-3 text-sm leading-6 text-slate-500">{t("sidebar.empty")}</div>
        ) : filteredConversations.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#343b49] p-3 text-sm leading-6 text-slate-500">{t("sidebar.noMatch")}</div>
        ) : (
          filteredConversations.map((conversation) => {
            const active = conversation.id === activeConversationId;
            const editing = conversation.id === editingId;
            return (
              <div
                key={conversation.id}
                className={`group mb-1 rounded-md border px-2 py-2 ${
                  active ? "border-[#3b82f6] bg-[#1f2937] text-slate-100" : "border-transparent text-slate-300 hover:bg-[#1d222d]"
                }`}
              >
                {editing ? (
                  <input
                    autoFocus
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onBlur={() => {
                      onRename(conversation.id, draftTitle);
                      setEditingId(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        onRename(conversation.id, draftTitle);
                        setEditingId(null);
                      }
                      if (event.key === "Escape") {
                        setEditingId(null);
                      }
                    }}
                    className="w-full rounded bg-[#0f1117] px-2 py-1 text-sm text-slate-100 outline-none ring-1 ring-[#3b82f6]"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={() => onSelect(conversation.id)} className="min-w-0 flex-1 truncate text-left text-sm">
                      {conversation.title}
                    </button>
                    <button
                      className="hidden rounded px-1 text-xs text-slate-400 hover:bg-[#2b3240] group-hover:inline"
                      onClick={() => {
                        setEditingId(conversation.id);
                        setDraftTitle(conversation.title);
                      }}
                    >
                      {t("sidebar.edit")}
                    </button>
                    <button
                      className="hidden rounded px-1 text-xs text-rose-300 hover:bg-[#2b3240] group-hover:inline"
                      onClick={() => {
                        if (window.confirm(t("sidebar.deleteConfirm", { title: conversation.title }))) {
                          onDelete(conversation.id);
                        }
                      }}
                    >
                      {t("sidebar.delete")}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-[#2a2f3a] p-2">
        <label className="mb-2 block text-xs text-slate-500">
          {t("sidebar.language")}
          <select
            value={language}
            onChange={(event) => void setLanguage(event.target.value === "en" ? "en" : "zh")}
            className="mt-1 w-full rounded-md border border-[#343b49] bg-[#0f1117] px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-[#3b82f6]"
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <button onClick={onOpenImages} className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-300 hover:bg-[#242936]">
          AI 生图
        </button>
        <button onClick={onOpenPlugins} className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-300 hover:bg-[#242936]">
          {t("common.plugins")}
        </button>
        <button onClick={onOpenSettings} className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-300 hover:bg-[#242936]">
          {t("common.settings")}
        </button>
      </div>
    </aside>
  );
}
