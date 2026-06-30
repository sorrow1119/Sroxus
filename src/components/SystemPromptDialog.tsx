import { useEffect, useState } from "react";
import type { Conversation } from "../../shared/types";

interface SystemPromptDialogProps {
  open: boolean;
  conversation: Conversation | null;
  onClose: () => void;
  onSave: (prompt: string) => Promise<void> | void;
}

export default function SystemPromptDialog({ open, conversation, onClose, onSave }: SystemPromptDialogProps) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(conversation?.systemPrompt ?? "");
    }
  }, [open, conversation]);

  if (!open) return null;

  async function save() {
    setSaving(true);
    try {
      await onSave(value);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-2xl rounded-lg border border-[#343b49] bg-[#151820] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">系统提示词</h2>
            <p className="mt-1 text-xs text-slate-500">{conversation?.title ?? "未选择会话"}</p>
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-slate-300 hover:bg-[#242936]">
            关闭
          </button>
        </div>
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="为当前会话设置独立系统提示词，例如：你是一个简洁直接的编程助手。"
          className="mt-4 h-56 w-full resize-none rounded-md border border-[#343b49] bg-[#0f1117] p-3 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#3b82f6]"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="rounded-md border border-[#343b49] px-3 py-2 text-sm text-slate-300 hover:bg-[#242936] disabled:opacity-50">
            取消
          </button>
          <button onClick={() => void save()} disabled={saving} className="rounded-md bg-[#2563eb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50">
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
