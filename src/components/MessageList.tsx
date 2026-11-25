import { cloneElement, isValidElement, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { Message, MessageAttachment, RegenerateMode } from "../../shared/types";
import { APP_NAME } from "../../shared/constants";
import { useI18n } from "../i18n";
import AgentBadge from "./AgentBadge";
import AgentResultGroup from "./AgentResultGroup";

interface MessageListProps {
  messages: Message[];
  hasConversation: boolean;
  generating: boolean;
  targetMessageId?: string | null;
  onTargetMessageHandled?: () => void;
  searchQuery?: string;
  searchMatches?: SearchMatchSpec[];
  searchActiveIndex?: number | null;
  onRegenerate: (assistantMessageId: string, mode: RegenerateMode) => Promise<void> | void;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onQuote: (quote: MessageQuote) => void;
}

export type MessageQuote = { messageId: string; author: string; text: string };
type TextSelection = MessageQuote & { left: number; top: number };

type RenderItem =
  | { type: "message"; message: Message }
  | { type: "group"; key: string; parentMessage?: Message; messages: Message[] };

export type SearchMatchSpec = { messageId: string; globalStart: number; count: number };

export default function MessageList({
  messages,
  hasConversation,
  generating,
  targetMessageId,
  onTargetMessageHandled,
  searchQuery = "",
  searchMatches = [],
  searchActiveIndex = null,
  onRegenerate,
  scrollContainerRef,
  onQuote,
}: MessageListProps) {
  const { t } = useI18n();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [copyNotice, setCopyNotice] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const followingBottom = useRef(true);
  const selecting = useRef(false);
  const messageRef = useRef(messages);
  messageRef.current = messages;
  const items = useMemo(() => buildRenderItems(messages), [messages]);
  const searchStartByMessageId = useMemo(() => {
    const map = new Map<string, SearchMatchSpec>();
    for (const item of searchMatches) {
      map.set(item.messageId, item);
    }
    return map;
  }, [searchMatches]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => { followingBottom.current = container.scrollHeight - container.scrollTop - container.clientHeight < 64; };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [scrollContainerRef]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (container && followingBottom.current && !selecting.current && !window.getSelection()?.toString()) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, scrollContainerRef]);

  useEffect(() => {
    const capture = () => {
      const selected = window.getSelection();
      if (!selected || selected.isCollapsed || !selected.rangeCount) { setSelection(null); return; }
      const range = selected.getRangeAt(0);
      const contentAt = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-message-content]");
      const start = contentAt(range.startContainer), end = contentAt(range.endContainer);
      if (!start || start !== end || !listRef.current?.contains(start)) { setSelection(null); return; }
      const text = selected.toString();
      const message = messageRef.current.find((item) => item.id === start.dataset.messageContent);
      if (!text.trim() || !message) { setSelection(null); return; }
      const rect = range.getBoundingClientRect();
      const next = { messageId: message.id, author: message.role === "user" ? t("messages.you") : message.agentName || "AI", text, left: Math.max(8, Math.min(rect.left, window.innerWidth - 260)), top: Math.max(8, Math.min(rect.top >= 48 ? rect.top - 42 : rect.bottom + 8, window.innerHeight - 44)) };
      setSelection((old) => old && Object.keys(next).every((key) => old[key as keyof TextSelection] === next[key as keyof TextSelection]) ? old : next);
    };
    const onDown = (event: PointerEvent) => {
      if ((event.target as Element).closest?.("[data-selection-toolbar]")) return;
      selecting.current = Boolean((event.target as Element).closest?.("[data-message-content]"));
    };
    const onUp = () => { selecting.current = false; capture(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { window.getSelection()?.removeAllRanges(); setSelection(null); } };
    document.addEventListener("selectionchange", capture);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", capture);
    window.addEventListener("scroll", capture, true);
    return () => {
      document.removeEventListener("selectionchange", capture);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", capture);
      window.removeEventListener("scroll", capture, true);
    };
  }, [t]);

  useEffect(() => {
    if (!copyNotice) return;
    const timer = window.setTimeout(() => setCopyNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [copyNotice]);

  useEffect(() => {
    if (!targetMessageId || !messages.some((message) => message.id === targetMessageId)) {
      return;
    }
    const timer = window.setTimeout(() => {
      const node = document.getElementById(messageDomId(targetMessageId));
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedId(targetMessageId);
      onTargetMessageHandled?.();
      window.setTimeout(() => setHighlightedId((current) => (current === targetMessageId ? null : current)), 2400);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [messages, onTargetMessageHandled, targetMessageId]);

  useEffect(() => {
    if (searchActiveIndex === null || searchActiveIndex < 0 || !searchMatches.length) {
      return;
    }
    const node = document.querySelector<HTMLElement>(`[data-search-index="${searchActiveIndex}"]`);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [searchActiveIndex, searchMatches]);

  if (!hasConversation) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-lg text-center">
          <h1 className="text-3xl font-semibold text-slate-100">{t("chat.welcomeTitle", { app: APP_NAME })}</h1>
          <p className="mt-4 text-sm leading-7 text-slate-400">{t("chat.welcomeBody")}</p>
        </div>
      </div>
    );
  }

  if (!messages.length) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="rounded-lg border border-dashed border-[#343b49] px-8 py-7 text-center">
          <h2 className="text-xl font-semibold text-slate-100">{t("chat.startTitle")}</h2>
          <p className="mt-2 text-sm text-slate-500">{t("chat.startBody")}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={listRef} className="space-y-5 p-6">
      {items.map((item) =>
        item.type === "group" ? (
          <AgentResultGroup
            key={item.key}
            parentMessage={item.parentMessage}
            messages={item.messages}
            generating={generating}
            onRegenerate={onRegenerate}
            renderMessage={(message) => (
              <MessageBubble
                message={message}
                generating={generating}
                highlighted={message.id === highlightedId}
                onRegenerate={onRegenerate}
                onQuote={onQuote}
                selectionPaused={selection?.messageId === message.id}
                inGroup
                searchQuery={searchQuery}
                searchStart={searchStartByMessageId.get(message.id)?.globalStart ?? 0}
                searchActiveIndex={searchQuery.trim() ? searchActiveIndex : null}
              />
            )}
          />
        ) : (
          <MessageBubble
            key={item.message.id}
            message={item.message}
            generating={generating}
            highlighted={item.message.id === highlightedId}
            onRegenerate={onRegenerate}
            onQuote={onQuote}
            selectionPaused={selection?.messageId === item.message.id}
            inGroup={false}
            searchQuery={searchQuery}
            searchStart={searchStartByMessageId.get(item.message.id)?.globalStart ?? 0}
            searchActiveIndex={searchQuery.trim() ? searchActiveIndex : null}
          />
        ),
      )}
      <div ref={bottomRef} />
      {selection && <div data-selection-toolbar role="toolbar" aria-label={t("messages.selectionActions")} className="chat-selection-toolbar" style={{ left: selection.left, top: selection.top }} onMouseDown={(event) => event.preventDefault()}>
        <button type="button" onClick={() => { void navigator.clipboard.writeText(selection.text).then(() => setCopyNotice(t("messages.copied")), () => setCopyNotice(t("messages.copyFailed"))); }}>{t("messages.copySelection")}</button>
        <button type="button" onClick={() => { onQuote({ messageId: selection.messageId, author: selection.author, text: selection.text }); window.getSelection()?.removeAllRanges(); setSelection(null); }}>{t("messages.quoteSelection")}</button>
      </div>}
      {copyNotice && <div role="status" className="chat-copy-notice" onClick={() => setCopyNotice("")}>{copyNotice}</div>}
    </div>
  );
}

function buildRenderItems(messages: Message[]): RenderItem[] {
  const grouped = new Map<string, Message[]>();
  for (const message of messages) {
    if (message.role === "assistant" && message.messageType === "agent" && message.parentMessageId) {
      const group = grouped.get(message.parentMessageId) ?? [];
      group.push(message);
      grouped.set(message.parentMessageId, group);
    }
  }

  const consumed = new Set<string>();
  const result: RenderItem[] = [];
  for (const message of messages) {
    if (consumed.has(message.id)) {
      continue;
    }
    const group = grouped.get(message.id);
    if (group && group.length > 1) {
      for (const child of group) {
        consumed.add(child.id);
      }
      result.push({ type: "message", message });
      result.push({ type: "group", key: `group-${message.id}`, parentMessage: message, messages: group });
      continue;
    }
    if (message.parentMessageId && grouped.get(message.parentMessageId)?.length && grouped.get(message.parentMessageId)!.length > 1) {
      consumed.add(message.id);
      continue;
    }
    result.push({ type: "message", message });
  }
  return result;
}

const MessageBubble = memo(function MessageBubble({
  message,
  generating,
  highlighted,
  onRegenerate,
  onQuote,
  selectionPaused,
  inGroup,
  searchQuery,
  searchStart,
  searchActiveIndex,
}: {
  message: Message;
  generating: boolean;
  highlighted: boolean;
  onRegenerate: (assistantMessageId: string, mode: RegenerateMode) => Promise<void> | void;
  onQuote: (quote: MessageQuote) => void;
  selectionPaused: boolean;
  inGroup: boolean;
  searchQuery: string;
  searchStart: number;
  searchActiveIndex: number | null;
}) {
  const { t } = useI18n();
  const isUser = message.role === "user";
  const canRegenerate = !isUser && message.status !== "sending";

  return (
    <div id={messageDomId(message.id)} key={message.id} className={`scroll-mt-20 flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`flex ${inGroup ? "max-w-full" : "max-w-[76%]"} flex-col ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`w-full rounded-lg border px-4 py-3 text-sm leading-6 shadow-sm ${
            highlighted
              ? "border-amber-300 bg-amber-500/15 text-slate-100 ring-2 ring-amber-300/30"
              : isUser
                ? "border-[#2563eb]/40 bg-[#1d4ed8] text-white"
                : "border-[#343b49] bg-[#1a1f2a] text-slate-100"
          }`}
        >
          {message.compressed && <div className="mb-2 inline-flex rounded bg-[#2b3240] px-1.5 py-0.5 text-xs text-slate-400">{t("messages.compressed")}</div>}
          {!isUser && message.agentName && <AgentHeader name={message.agentName} />}
          <MessageBody message={message} selectionPaused={selectionPaused} searchQuery={searchQuery} searchStart={searchStart} searchActiveIndex={searchActiveIndex} />
          {message.status === "sending" && <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-slate-300 align-middle" />}
          {message.status === "error" && <div className="mt-2 text-xs text-rose-300">{t("messages.failed")}</div>}
        </div>

        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <ActionButton disabled={false} onClick={() => navigator.clipboard.writeText(message.content)}>
            {t("messages.copy")}
          </ActionButton>
          <ActionButton disabled={!message.content.trim()} onClick={() => onQuote({ messageId: message.id, author: isUser ? t("messages.you") : message.agentName || "AI", text: message.content })}>
            {t("messages.quote")}
          </ActionButton>
        </div>

        {canRegenerate && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <ActionButton disabled={generating} onClick={() => onRegenerate(message.id, "retry")}>
              {message.status === "error" ? t("messages.retry") : t("messages.regenerate")}
            </ActionButton>
            <ActionButton disabled={generating} onClick={() => onRegenerate(message.id, "concise")}>
              {t("messages.concise")}
            </ActionButton>
            <ActionButton disabled={generating} onClick={() => onRegenerate(message.id, "detailed")}>
              {t("messages.detailed")}
            </ActionButton>
          </div>
        )}
      </div>
    </div>
  );
});

function messageDomId(messageId: string) {
  return `message-${messageId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function AgentHeader({ name }: { name: string }) {
  return (
    <div className="mb-2">
      <AgentBadge name={name} />
    </div>
  );
}

function MessageBody({
  message,
  selectionPaused,
  searchQuery,
  searchStart,
  searchActiveIndex,
}: {
  message: Message;
  selectionPaused: boolean;
  searchQuery: string;
  searchStart: number;
  searchActiveIndex: number | null;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const stableContent = useRef(message.content);
  if (!selectionPaused) stableContent.current = message.content;
  const content = stableContent.current || (message.status === "sending" ? " " : "");
  const tooLong = content.length > 1600;
  const visible = tooLong && !expanded ? `${content.slice(0, 1600)}\n\n...` : content;

  return (
    <>
      <div className="chat-message-content" data-message-content={message.id}>
        <MarkdownContent content={visible} searchQuery={searchQuery} searchStart={searchStart} searchActiveIndex={searchActiveIndex} />
      </div>
      <AttachmentList attachments={message.attachments ?? []} />
      {tooLong && (
        <button
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 rounded-md border border-[#343b49] px-2 py-1 text-xs text-slate-400 hover:bg-[#242936] hover:text-slate-100"
        >
          {expanded ? t("messages.collapse") : t("messages.expand")}
        </button>
      )}
    </>
  );
}

function AttachmentList({ attachments }: { attachments: MessageAttachment[] }) {
  const { t } = useI18n();
  if (!attachments.length) {
    return null;
  }
  return (
    <div className="mt-3 grid gap-2">
      {attachments.map((attachment) => {
        const fileUrl = `file:///${attachment.storedPath.replace(/\\/g, "/")}`;
        const previewUrl = attachment.previewDataUrl || fileUrl;
        return (
          <div key={attachment.id} className="rounded-md border border-[#343b49] bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-slate-100">
                  {attachment.kind === "image" ? t("composer.image") : t("messages.document")} {attachment.name}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {attachment.mimeType} / {formatBytes(attachment.size)}
                </div>
              </div>
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded border border-[#343b49] px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10"
              >
                {t("messages.open")}
              </a>
            </div>
            {attachment.kind === "image" && <img src={previewUrl} alt={attachment.name} className="mt-3 max-h-64 rounded-md border border-[#343b49] object-contain" />}
            {attachment.kind === "document" && attachment.note && <div className="mt-2 text-[11px] text-slate-400">{attachment.note}</div>}
          </div>
        );
      })}
    </div>
  );
}

function ActionButton({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled: boolean;
  onClick: () => Promise<void> | void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={() => void onClick()}
      className="rounded-md border border-[#343b49] bg-[#151820] px-2 py-1 text-slate-400 hover:border-[#4b5563] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function extractText(value: unknown): string {
  if (value === null || value === undefined || typeof value === "boolean") {
    return "";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(extractText).join("");
  }
  if (typeof value === "object" && "props" in value) {
    return extractText((value as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

const MarkdownContent = memo(function MarkdownContent({
  content,
  searchQuery,
  searchStart,
  searchActiveIndex,
}: {
  content: string;
  searchQuery: string;
  searchStart: number;
  searchActiveIndex: number | null;
}) {
  const { t } = useI18n();
  const counter = { value: 0 };
  const remap = (children: ReactNode) =>
    searchQuery.trim() ? highlightChildren(children, searchQuery, searchStart, searchActiveIndex, counter) : children;

  return (
    <div className="prose prose-invert max-w-none break-words prose-pre:my-3 prose-pre:bg-transparent prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          p: ({ children }) => <p>{remap(children)}</p>,
          h1: ({ children }) => <h1>{remap(children)}</h1>,
          h2: ({ children }) => <h2>{remap(children)}</h2>,
          h3: ({ children }) => <h3>{remap(children)}</h3>,
          h4: ({ children }) => <h4>{remap(children)}</h4>,
          h5: ({ children }) => <h5>{remap(children)}</h5>,
          h6: ({ children }) => <h6>{remap(children)}</h6>,
          li: ({ children }) => <li>{remap(children)}</li>,
          blockquote: ({ children }) => <blockquote>{remap(children)}</blockquote>,
          td: ({ children }) => <td>{remap(children)}</td>,
          th: ({ children }) => <th>{remap(children)}</th>,
          strong: ({ children }) => <strong>{remap(children)}</strong>,
          em: ({ children }) => <em>{remap(children)}</em>,
          a: ({ children, ...rest }) => (
            <a {...rest} target="_blank" rel="noreferrer">
              {remap(children)}
            </a>
          ),
          code(props) {
            const { children, className, ...rest } = props;
            const inline = !className;
            if (inline) {
              return (
                <code className="rounded bg-black/25 px-1 py-0.5 text-[0.92em]" {...rest}>
                  {children}
                </code>
              );
            }
            const code = extractText(children).replace(/\n$/, "");
            return (
              <div className="overflow-hidden rounded-md border border-[#343b49] bg-[#0b0d12]">
                <div className="flex items-center justify-between border-b border-[#343b49] px-3 py-1.5 text-xs text-slate-400">
                  <span>{t("messages.code")}</span>
                  <button className="rounded px-2 py-1 hover:bg-[#242936]" onClick={() => void navigator.clipboard.writeText(code)}>
                    {t("messages.copy")}
                  </button>
                </div>
                <pre className="overflow-x-auto p-3">
                  <code className={className} {...rest}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

function highlightChildren(
  children: ReactNode,
  query: string,
  start: number,
  activeGlobalIndex: number | null,
  counter: { value: number },
): ReactNode {
  if (Array.isArray(children)) {
    return children.map((child) => highlightChildren(child, query, start, activeGlobalIndex, counter));
  }
  if (typeof children === "string") {
    return highlightString(children, query, start, activeGlobalIndex, counter);
  }
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return cloneElement(children, {}, highlightChildren(children.props.children, query, start, activeGlobalIndex, counter));
  }
  return children;
}

function highlightString(text: string, query: string, start: number, activeGlobalIndex: number | null, counter: { value: number }): ReactNode {
  const lowerQuery = query.trim().toLowerCase();
  if (!lowerQuery) {
    return text;
  }
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  while (cursor < lower.length) {
    const found = lower.indexOf(lowerQuery, cursor);
    if (found < 0) {
      if (cursor < lower.length) {
        parts.push(text.slice(cursor));
      }
      break;
    }
    if (found > cursor) {
      parts.push(text.slice(cursor, found));
    }
    const globalIndex = start + counter.value;
    counter.value += 1;
    parts.push(
      <mark
        key={`search-${globalIndex}`}
        data-search-index={globalIndex}
        className={
          activeGlobalIndex === globalIndex
            ? "rounded bg-amber-300 px-0.5 text-black ring-2 ring-amber-300"
            : "rounded bg-amber-400/45 px-0.5 text-inherit"
        }
      >
        {text.slice(found, found + lowerQuery.length)}
      </mark>,
    );
    cursor = found + lowerQuery.length;
  }
  return <>{parts}</>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
