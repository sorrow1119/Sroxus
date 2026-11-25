import { useCallback, useEffect, useRef, useState } from "react";
import type { AIAgent } from "../../shared/types";
import { useI18n } from "../i18n";
import AgentMentionInput from "./AgentMentionInput";
import type { MessageQuote } from "./MessageList";

type ComposerDraft = { value: string; attachments: string[]; quotes: MessageQuote[] };
const emptyDraft = (): ComposerDraft => ({ value: "", attachments: [], quotes: [] });
const draftKey = (id: string) => `sroxus.chatDraft.v1:${id}`;
function readDraft(id?: string): ComposerDraft {
  if (!id) return emptyDraft();
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey(id)) || "null");
    return {
      value: typeof draft?.value === "string" ? draft.value : "",
      attachments: Array.isArray(draft?.attachments) ? draft.attachments.filter((item: unknown) => typeof item === "string") : [],
      quotes: Array.isArray(draft?.quotes) ? draft.quotes.filter((item: MessageQuote) => item && typeof item.messageId === "string" && typeof item.author === "string" && typeof item.text === "string") : [],
    };
  } catch { return emptyDraft(); }
}
function saveDraft(id: string, draft: ComposerDraft) {
  localStorage.setItem(draftKey(id), JSON.stringify(draft));
}
function mergeQuotes(first: MessageQuote[], second: MessageQuote[]) {
  return [...first, ...second.filter((quote) => !first.some((item) => item.messageId === quote.messageId && item.text === quote.text))];
}

interface MessageComposerProps {
  conversationId?: string;
  quoteRequest?: { quote: MessageQuote; conversationId: string; id: number } | null;
  onQuoteHandled?: (id: number) => void;
  agents: AIAgent[];
  disabled?: boolean;
  /** 仅禁用发送按钮（例如还没选模型），不影响输入框聚焦与打字。 */
  sendDisabled?: boolean;
  generating?: boolean;
  focusSignal?: number;
  mentionPrefix?: string;
  mentionSignal?: number;
  onSend: (content: string, attachments: string[]) => Promise<void> | void;
  onStop: () => Promise<void> | void;
}

export default function MessageComposer({
  conversationId,
  quoteRequest,
  onQuoteHandled,
  agents,
  disabled,
  sendDisabled,
  generating,
  focusSignal = 0,
  mentionPrefix = "",
  mentionSignal = 0,
  onSend,
  onStop,
}: MessageComposerProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ComposerDraft>(() => readDraft(conversationId));
  const { value, attachments, quotes } = draft;
  const setValue = (next: string | ((current: string) => string)) => setDraft((current) => ({ ...current, value: typeof next === "function" ? next(current.value) : next }));
  const setAttachments = (next: (current: string[]) => string[]) => setDraft((current) => ({ ...current, attachments: next(current.attachments) }));
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const mounted = useRef(true);
  const handledQuote = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const disabledRef = useRef(Boolean(disabled));
  disabledRef.current = Boolean(disabled);

  useEffect(() => {
    mounted.current = true;
    const restore = (event: Event) => {
      if ((event as CustomEvent<string>).detail === conversationId) setDraft(readDraft(conversationId));
    };
    window.addEventListener("sroxus:chat-draft-restored", restore);
    return () => { mounted.current = false; window.removeEventListener("sroxus:chat-draft-restored", restore); };
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    try { saveDraft(conversationId, draft); }
    catch { setSendError(t("composer.draftSaveFailed")); }
  }, [conversationId, draft, t]);

  useEffect(() => {
    if (!quoteRequest || quoteRequest.conversationId !== conversationId || handledQuote.current === quoteRequest.id) return;
    handledQuote.current = quoteRequest.id;
    setDraft((current) => ({ ...current, quotes: mergeQuotes(current.quotes, [quoteRequest.quote]) }));
    onQuoteHandled?.(quoteRequest.id);
    requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
  }, [conversationId, quoteRequest, onQuoteHandled]);

  const focusComposer = useCallback(() => {
    if (disabledRef.current) {
      return;
    }
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!disabledRef.current && textarea && !textarea.disabled &&
          (document.activeElement === document.body || document.activeElement === textarea)) {
        textarea.focus({ preventScroll: true });
      }
    });
  }, []);

  useEffect(() => {
    focusComposer();
  }, [focusComposer, focusSignal]);

  // 输入框从「禁用」变为可用（例如新建会话选完模型、生成结束）时自动聚焦，
  // 避免出现「明明能输入却点不进去」的卡顿体验。
  const wasDisabled = useRef(Boolean(disabled));
  useEffect(() => {
    const nowDisabled = Boolean(disabled);
    if (wasDisabled.current && !nowDisabled) {
      const id = requestAnimationFrame(() => focusComposer());
      wasDisabled.current = nowDisabled;
      return () => cancelAnimationFrame(id);
    }
    wasDisabled.current = nowDisabled;
  }, [disabled, focusComposer]);

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
    if ((!text && !attachments.length && !quotes.length) || sending || disabled || generating || sendDisabled) {
      return;
    }
    const sentDraft = draft;
    const quoteText = quotes.map((quote) => `> ${t("composer.quoteFrom", { author: quote.author.replace(/[\r\n]/g, " ") })}\n${quote.text.split(/\r?\n/).map((line) => `> ${line}`).join("\n")}`).join("\n\n");
    const content = [text, quoteText].filter(Boolean).join("\n\n");
    setSending(true);
    setSendError(null);
    setDraft(emptyDraft());
    try {
      await onSend(content, attachments);
    } catch (error) {
      // Restore the failed message without discarding a draft typed while waiting.
      const restore = (current: ComposerDraft): ComposerDraft => ({
        value: current.value ? `${sentDraft.value}\n\n${current.value}` : sentDraft.value,
        attachments: Array.from(new Set([...sentDraft.attachments, ...current.attachments])),
        quotes: mergeQuotes(sentDraft.quotes, current.quotes),
      });
      if (mounted.current) {
        setDraft(restore);
        setSendError(error instanceof Error ? error.message : String(error));
      } else if (conversationId) {
        try {
          saveDraft(conversationId, restore(readDraft(conversationId)));
          window.dispatchEvent(new CustomEvent("sroxus:chat-draft-restored", { detail: conversationId }));
        } catch { /* The active composer reports local storage failures. */ }
      }
    } finally {
      if (mounted.current) { setSending(false); focusComposer(); }
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
    <div className="border-t border-[#2a2f3a] bg-[#11141b] p-4" onClick={(event) => { if (event.target === event.currentTarget) textareaRef.current?.focus({ preventScroll: true }); }}>
      <div className="mx-auto max-w-4xl space-y-3">
        {sendError && <p role="alert" className="text-sm text-rose-300">{sendError}</p>}
        {quotes.length > 0 && <section aria-label={t("composer.quotes")} className="max-h-48 space-y-2 overflow-y-auto">
          {quotes.map((quote, index) => <div key={`${quote.messageId}-${index}`} className="rounded-md border border-[#343b49] border-l-4 border-l-blue-400 bg-[#151820] px-3 py-2">
            <div className="flex items-center justify-between gap-3 text-xs text-slate-400"><span>{t("composer.quoteFrom", { author: quote.author })}</span><button type="button" aria-label={t("composer.removeQuote", { index: index + 1 })} onClick={() => setDraft((current) => ({ ...current, quotes: current.quotes.filter((_, i) => i !== index) }))} className="rounded px-2 py-1 hover:bg-white/10">×</button></div>
            <blockquote className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm text-slate-200">{quote.text}</blockquote>
          </div>)}
        </section>}
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
            disabled={disabled}
            inputRef={textareaRef}
            onChange={setValue}
            onPaste={(event) => void handlePaste(event)}
            onSubmit={() => void submit()}
            placeholder={disabled ? t("composer.noConversation") : sendDisabled ? t("composer.noModel") : t("composer.placeholder")}
          />
          {generating ? (
            <button
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => { void Promise.resolve().then(onStop).catch((error) => setSendError(error instanceof Error ? error.message : String(error))); }}
              className="h-10 shrink-0 rounded-md border border-rose-500/50 px-4 text-sm font-medium text-rose-200 hover:bg-rose-500/10"
            >
              {t("composer.stop")}
            </button>
          ) : (
            <button
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void submit()}
              disabled={disabled || sendDisabled || sending || (!value.trim() && !attachments.length && !quotes.length)}
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

