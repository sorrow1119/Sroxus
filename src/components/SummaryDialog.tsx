import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Conversation } from "../../shared/types";

interface SummaryDialogProps {
  open: boolean;
  conversation: Conversation | null;
  onClose: () => void;
  onSave: (summary: string) => Promise<void> | void;
  onClear: () => Promise<void> | void;
  onContinue: () => Promise<void> | void;
}

export default function SummaryDialog({ open, conversation, onClose, onSave, onClear, onContinue }: SummaryDialogProps) {
  const summary = conversation?.summary ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (open) {
      setEditing(false);
      setDraft(summary);
      setNotice("");
    }
  }, [open, summary]);

  if (!open) {
    return null;
  }

  async function save() {
    setSaving(true);
    setNotice("");
    try {
      await onSave(draft);
      setEditing(false);
      setNotice("已保存");
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(summary);
    setNotice("已复制");
  }

  async function clear() {
    if (!window.confirm("清空后不可恢复，确定吗？")) {
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      await onClear();
      setDraft("");
      setEditing(false);
      setNotice("摘要已清空");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-4">
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col rounded-lg border border-[#343b49] bg-[#151820] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[#2a2f3a] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-100">会话摘要</h2>
            <p className="mt-1 truncate text-xs text-slate-500">{conversation?.title ?? "未选择会话"}</p>
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-slate-300 hover:bg-[#242936]">
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!summary.trim() && !editing ? (
            <div className="rounded-md border border-dashed border-[#343b49] p-6 text-center text-sm text-slate-500">
              暂无摘要，请先压缩上下文生成摘要
            </div>
          ) : editing ? (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="h-[48vh] w-full resize-none rounded-md border border-[#343b49] bg-[#0f1117] p-3 text-sm leading-6 text-slate-200 outline-none focus:border-[#3b82f6]"
              placeholder="在这里编辑会话摘要"
            />
          ) : (
            <div className="prose prose-invert max-w-none prose-pre:bg-[#0f1117] prose-code:before:content-none prose-code:after:content-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#2a2f3a] px-5 py-4">
          <div className="text-sm text-emerald-300">{notice}</div>
          <div className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <button
                  onClick={() => {
                    setDraft(summary);
                    setEditing(false);
                    setNotice("");
                  }}
                  disabled={saving}
                  className="rounded-md border border-[#343b49] px-3 py-2 text-sm text-slate-300 hover:bg-[#242936] disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={() => void save()}
                  disabled={saving}
                  className="rounded-md bg-[#2563eb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setEditing(true)}
                  disabled={!conversation}
                  className="rounded-md border border-[#343b49] px-3 py-2 text-sm text-slate-300 hover:bg-[#242936] disabled:opacity-50"
                >
                  编辑
                </button>
                <button
                  onClick={() => void copy()}
                  disabled={!summary.trim()}
                  className="rounded-md border border-[#343b49] px-3 py-2 text-sm text-slate-300 hover:bg-[#242936] disabled:opacity-50"
                >
                  复制
                </button>
                <button
                  onClick={() => void onContinue()}
                  disabled={!summary.trim()}
                  className="rounded-md border border-[#343b49] px-3 py-2 text-sm text-slate-300 hover:bg-[#242936] disabled:opacity-50"
                >
                  用摘要新建会话
                </button>
                <button
                  onClick={() => void clear()}
                  disabled={!summary.trim() || saving}
                  className="rounded-md border border-rose-500/50 px-3 py-2 text-sm text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
                >
                  清空摘要
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
