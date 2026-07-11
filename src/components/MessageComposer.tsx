import { useCallback, useEffect, useRef, useState } from "react";
import type { AIAgent } from "../../shared/types";
import { useI18n } from "../i18n";
import AgentMentionInput from "./AgentMentionInput";

interface MessageComposerProps {
  agents: AIAgent[];
  disabled?: boolean;
  generating?: boolean;
  focusSignal?: number;
  mentionPrefix?: string;
  mentionSignal?: number;
  onSend: (content: string, attachments: string[]) => Promise<void> | void;
  onStop: () => Promise<void> | void;
}

export default function MessageComposer({
  agents,
  disabled,
  generating,
  focusSignal = 0,
  mentionPrefix = "",
  mentionSignal = 0,
  onSend,
  onStop,
}: MessageComposerProps) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const focusComposer = useCallback(() => {
    if (disabled || sending || generating) {
      return;
    }
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [disabled, generating, sending]);

  useEffect(() => {
    focusComposer();
  }, [focusComposer, focusSignal]);

  useEffect(() => {
    function handleWindowFocus() {
      focusComposer();
    }
    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, [focusComposer]);

  useEffect(() => {
    if (!mentionPrefix) {
      return;
    }
    setValue((current) => {
      const trimmed = current.trimStart();
      if (trimmed.startsWith(mentionPrefix)) {
        return current;
      }
      const withoutOldMention = trimmed.replace(/^@\S+\s*/, "");
      return `${mentionPrefix}${withoutOldMention}`;
    });
    focusComposer();
  }, [focusComposer, mentionPrefix, mentionSignal]);

  async function submit() {
    const text = value.trim();
    if ((!text && !attachments.length) || sending || disabled || generating) {
      return;
    }
    setSending(true);
    setValue("");
    try {
      await onSend(text, attachments);
      setAttachments([]);
    } finally {
      setSending(false);
      focusComposer();
    }
  }

  async function pickAttachments() {
    try {
      const files = await window.electronAPI.data.selectOpenFiles();
      if (files.length) {
        setAttachments((current) => Array.from(new Set([...current, ...files])));
      }
    } finally {
      focusComposer();
    }
  }

  async function handlePaste(event: React.ClipboardEvent) {
    const imageItems = Array.from(event.clipboardData.items).filter((item) => item.type.startsWith("image/"));
    if (!imageItems.length) {
      return;
    }
    event.preventDefault();
    const savedPaths: string[] = [];
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) {
        continue;
      }
      const dataUrl = await readFileAsDataUrl(file);
      savedPaths.push(await window.electronAPI.data.savePastedImage(dataUrl));
    }
    if (savedPaths.length) {
      setAttachments((current) => Array.from(new Set([...current, ...savedPaths])));
    }
    focusComposer();
  }

  return (
    <div className="border-t border-[#2a2f3a] bg-[#11141b] p-4" onClick={(event) => { if (event.target === event.currentTarget) focusComposer(); }}>
      <div className="mx-auto max-w-4xl space-y-3">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((filePath) => {
              const segments = filePath.split(/[/\\]/);
              const fileName = segments[segments.length - 1] || filePath;
              const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName);
              return (
                <div
                  key={filePath}
                  className="flex max-w-[240px] items-center gap-2 rounded-md border border-[#343b49] bg-[#151820] px-3 py-2 text-xs text-slate-300"
                  title={filePath}
                >
                  <span className="shrink-0">{isImage ? t("composer.image") : t("composer.file")}</span>
                  <span className="truncate">{fileName}</span>
                  <button
                    type="button"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => {
                      setAttachments((current) => current.filter((item) => item !== filePath));
                      focusComposer();
                    }}
                    className="shrink-0 rounded px-1 text-slate-500 hover:bg-white/10 hover:text-slate-200"
                  >
                    x
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => void pickAttachments()}
            disabled={disabled || sending || generating}
            className="h-10 shrink-0 rounded-md border border-[#343b49] px-3 text-sm text-slate-300 hover:bg-[#1a1f2a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("composer.attach")}
          </button>
          <AgentMentionInput
            agents={agents}
            value={value}
            disabled={disabled || sending || generating}
            inputRef={textareaRef}
            onChange={setValue}
            onPaste={(event) => void handlePaste(event)}
            onSubmit={() => void submit()}
            placeholder={disabled ? t("composer.noConversation") : t("composer.placeholder")}
          />
          {generating ? (
            <button
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void onStop()}
              className="h-10 shrink-0 rounded-md border border-rose-500/50 px-4 text-sm font-medium text-rose-200 hover:bg-rose-500/10"
            >
              {t("composer.stop")}
            </button>
          ) : (
            <button
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void submit()}
              disabled={disabled || sending || (!value.trim() && !attachments.length)}
              className="h-10 shrink-0 rounded-md bg-[#2563eb] px-4 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#2b3240] disabled:text-slate-500"
            >
              {t("composer.send")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read pasted image."));
    reader.readAsDataURL(file);
  });
}

