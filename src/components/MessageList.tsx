import { useEffect, useMemo, useRef, useState } from "react";
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
  onRegenerate: (assistantMessageId: string, mode: RegenerateMode) => Promise<void> | void;
}

type RenderItem =
  | { type: "message"; message: Message }
  | { type: "group"; key: string; parentMessage?: Message; messages: Message[] };

export default function MessageList({ messages, hasConversation, generating, targetMessageId, onTargetMessageHandled, onRegenerate }: MessageListProps) {
  const { t } = useI18n();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const items = useMemo(() => buildRenderItems(messages), [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

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
    <div className="space-y-5 p-6">
      {items.map((item) =>
        item.type === "group" ? (
          <AgentResultGroup
            key={item.key}
            parentMessage={item.parentMessage}
            messages={item.messages}
            generating={generating}
            onRegenerate={onRegenerate}
            renderMessage={(message) => (
              <MessageBubble message={message} generating={generating} highlighted={message.id === highlightedId} onRegenerate={onRegenerate} inGroup />
            )}
          />
        ) : (
          <MessageBubble
            key={item.message.id}
            message={item.message}
            generating={generating}
            highlighted={item.message.id === highlightedId}
            onRegenerate={onRegenerate}
            inGroup={false}
          />
        ),
      )}
      <div ref={bottomRef} />
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

function MessageBubble({
  message,
  generating,
  highlighted,
  onRegenerate,
  inGroup,
}: {
  message: Message;
  generating: boolean;
  highlighted: boolean;
  onRegenerate: (assistantMessageId: string, mode: RegenerateMode) => Promise<void> | void;
  inGroup: boolean;
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
          <MessageBody message={message} />
          {message.status === "sending" && <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-slate-300 align-middle" />}
          {message.status === "error" && <div className="mt-2 text-xs text-rose-300">{t("messages.failed")}</div>}
        </div>

        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <ActionButton disabled={false} onClick={() => navigator.clipboard.writeText(message.content)}>
            {t("messages.copy")}
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
}

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

function MessageBody({ message }: { message: Message }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const content = message.content || (message.status === "sending" ? " " : "");
  const tooLong = content.length > 1600;
  const visible = tooLong && !expanded ? `${content.slice(0, 1600)}\n\n...` : content;

  return (
    <>
      <MarkdownContent content={visible} />
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

function MarkdownContent({ content }: { content: string }) {
  const { t } = useI18n();

  return (
    <div className="prose prose-invert max-w-none break-words prose-pre:my-3 prose-pre:bg-transparent prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
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
