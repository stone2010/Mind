import {
  AlertCircle,
  BookmarkPlus,
  Brain,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Pencil,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { api, errorMessage } from "../lib/bridge";
import { modelLabel, useAppStore } from "../store/app";
import { useChatStore } from "../store/chat";
import { confirmDialog } from "../store/confirm";
import { pushToast } from "../store/toast";
import type { Attachment, Message } from "../types";
import { copyText, formatBytes, formatTime, parseAttachments } from "../lib/utils";
import { ConnectorPanel, parseConnectorCalls } from "./ConnectorPanel";
import { AskRenderer } from "./AskBlock";
import { Markdown } from "./Markdown";
import { SearchPanel, parseSources } from "./SearchPanel";
import { IconButton } from "./ui";

function ReasoningPanel({
  reasoning,
  streaming,
  hasContent,
}: {
  reasoning: string;
  streaming: boolean;
  hasContent: boolean;
}) {
  const [open, setOpen] = useState(streaming && !hasContent);
  const touched = useRef(false);

  useEffect(() => {
    if (!touched.current && hasContent && open) setOpen(false);
  }, [hasContent, open]);

  return (
    <div className="mb-2.5 overflow-hidden rounded-lg border border-line bg-sidebar">
      <button
        onClick={() => {
          touched.current = true;
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-muted hover:text-ink"
      >
        <Brain size={13} className={clsx("shrink-0", streaming && !hasContent && "text-accent")} />
        <span className="flex-1">
          {streaming && !hasContent ? "正在深度思考…" : "深度思考过程"}
        </span>
        <ChevronDown
          size={13}
          className={clsx("transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap border-t border-line px-3 py-2.5 text-[12.5px] leading-[1.7] text-muted">
          {reasoning}
        </div>
      )}
    </div>
  );
}

function AttachmentChips({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  const images = attachments.filter((a) => a.kind === "image" && a.dataUrl);
  const files = attachments.filter((a) => a.kind !== "image");
  return (
    <div className="mb-2 flex flex-col items-end gap-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {images.map((img, i) => (
            <img
              key={i}
              src={img.dataUrl}
              alt={img.name}
              title={img.name}
              className="h-24 w-24 rounded-lg border border-line object-cover"
            />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {files.map((file, i) => (
            <span
              key={i}
              title={file.name}
              className="inline-flex max-w-[240px] items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] text-muted"
            >
              <FileText size={12} className="shrink-0" />
              <span className="truncate">{file.name}</span>
              <span className="shrink-0 text-faint">{formatBytes(file.size)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label="复制"
      size="sm"
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        }
      }}
    >
      {copied ? <Check size={13.5} className="text-success" /> : <Copy size={13.5} />}
    </IconButton>
  );
}

export function MessageItem({
  message,
  streaming,
  isLast,
}: {
  message: Message;
  streaming: boolean;
  isLast: boolean;
}) {
  const regenerate = useChatStore((s) => s.regenerate);
  const editAndResend = useChatStore((s) => s.editAndResend);
  const setFeedback = useChatStore((s) => s.setFeedback);
  const busy = useChatStore((s) => s.streaming !== null);
  const streamingInfo = useChatStore((s) => s.streaming);
  const liveSearch =
    streamingInfo?.messageId === message.id ? streamingInfo.search : null;
  const isDemoMessage = !!message.modelId?.startsWith("demo:");
  const [remembered, setRemembered] = useState(false);

  const rememberMessage = async () => {
    const content = message.content.trim();
    if (!content) return;
    try {
      await api.createMemory(content.slice(0, 1000));
      await useAppStore.getState().refreshMemories();
      setRemembered(true);
      pushToast({
        kind: "success",
        title: "已保存到长期记忆",
        action: {
          label: "查看记忆",
          onClick: () =>
            useAppStore.getState().setView({ name: "settings", section: "memory" }),
        },
      });
    } catch (err) {
      pushToast({ kind: "error", title: "保存失败", detail: errorMessage(err) });
    }
  };

  const attachments = parseAttachments(message.attachments);
  const searchSources = parseSources(message.sources);
  const connectorCalls = parseConnectorCalls(message.connectorCalls);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      editRef.current?.focus();
      editRef.current?.setSelectionRange(message.content.length, message.content.length);
    }
  }, [editing, message.content]);

  const submitEdit = async () => {
    if (!draft.trim() || busy) return;
    const st = useChatStore.getState();
    const list = st.activeId ? st.messages[st.activeId] ?? [] : [];
    const index = list.findIndex((m) => m.id === message.id);
    const hasLaterUserMessage =
      index >= 0 && list.slice(index + 1).some((m) => m.role === "user");
    if (hasLaterUserMessage) {
      const ok = await confirmDialog({
        title: "重新发送这条消息？",
        body: "这条消息之后的对话会被移除，并基于新的内容重新生成回复。",
        confirmLabel: "继续",
        danger: true,
      });
      if (!ok) return;
    }
    await editAndResend(message.id, draft);
    setEditing(false);
  };

  if (message.role === "user") {
    return (
      <div className="group flex justify-end py-2.5">
        <div className="flex max-w-[82%] flex-col items-end">
          <AttachmentChips attachments={attachments} />
          {editing ? (
            <div className="w-[min(560px,72vw)] rounded-xl border border-line bg-panel p-2.5">
              <textarea
                ref={editRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(8, draft.split("\n").length + 1)}
                className="w-full resize-none bg-transparent px-1 py-0.5 text-[14px] leading-6 text-ink"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditing(false);
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void submitEdit();
                  }
                }}
              />
              <div className="mt-1 flex justify-end gap-2">
                <button
                  className="rounded px-2 py-1 text-[12px] text-muted hover:bg-hover"
                  onClick={() => {
                    setEditing(false);
                    setDraft(message.content);
                  }}
                >
                  取消
                </button>
                <button
                  className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                  disabled={!draft.trim() || busy}
                  onClick={() => void submitEdit()}
                >
                  保存并重新发送
                </button>
              </div>
            </div>
          ) : (
            <div className="whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-[var(--user-bubble)] px-4 py-2.5 text-[14.5px] leading-[1.65] text-ink">
              {message.content}
            </div>
          )}
          {!editing && (
            <div className="mt-1 flex items-center gap-0.5 text-[11px] text-faint">
              <span className="mr-0.5 tabular-nums">{formatTime(message.createdAt)}</span>
              <CopyButton text={message.content} />
              <IconButton
                label={remembered ? "已保存到记忆" : "保存到长期记忆"}
                size="sm"
                active={remembered}
                onClick={() => void rememberMessage()}
              >
                <BookmarkPlus
                  size={13.5}
                  className={remembered ? "text-accent" : ""}
                />
              </IconButton>
              <IconButton
                label="编辑并重新发送"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setDraft(message.content);
                  setEditing(true);
                }}
              >
                <Pencil size={13.5} />
              </IconButton>
            </div>
          )}
        </div>
      </div>
    );
  }

  const hasContent = message.content.trim().length > 0;
  const showError = message.status === "error";
  const showStopped = message.status === "stopped" && !streaming;

  return (
    <div className="group py-3">
      <ConnectorPanel calls={connectorCalls} />
      <SearchPanel sources={searchSources} live={liveSearch} />

      {message.reasoning && (
        <ReasoningPanel
          reasoning={message.reasoning}
          streaming={streaming}
          hasContent={hasContent}
        />
      )}

      {hasContent && <Markdown content={message.content} live={streaming} />}

      {!streaming && (
        <AskRenderer content={message.content} messageId={message.id} />
      )}

      {streaming && !hasContent && (
        <div className="flex items-center gap-2 py-1 text-[13px] text-muted">
          <span className="thinking-dots flex gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-faint" />
            <span className="h-1.5 w-1.5 rounded-full bg-faint" />
            <span className="h-1.5 w-1.5 rounded-full bg-faint" />
          </span>
          {message.reasoning ? "正在思考…" : "正在生成…"}
        </div>
      )}

      {streaming && hasContent && (
        <div className="mt-1">
          <span className="streaming-caret" />
        </div>
      )}

      {showError && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
          <AlertCircle size={14} className="shrink-0" />
          <span className="flex-1">生成中断，已保留已生成的内容。</span>
          {isLast && (
            <button
              onClick={() => regenerate(message.id)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-danger/10 disabled:opacity-50"
            >
              <RotateCcw size={12} />
              重试
            </button>
          )}
        </div>
      )}

      {showStopped && (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-faint">
          <span>已停止生成</span>
          {isLast && (
            <button
              onClick={() => regenerate(message.id)}
              disabled={busy}
              className="inline-flex items-center gap-1 text-muted hover:text-ink disabled:opacity-50"
            >
              <RotateCcw size={12} />
              重新生成
            </button>
          )}
        </div>
      )}

      {!streaming && (
        <div className="mt-1.5 flex items-center gap-0.5 text-[11px] text-faint">
          <span className="mr-1 tabular-nums">{formatTime(message.createdAt)}</span>
          <CopyButton text={message.content} />
          <IconButton
            label={remembered ? "已保存到记忆" : "保存到长期记忆"}
            size="sm"
            active={remembered}
            onClick={() => void rememberMessage()}
          >
            <BookmarkPlus size={13.5} className={remembered ? "text-accent" : ""} />
          </IconButton>
          {isLast && (
            <IconButton
              label="重新生成"
              size="sm"
              disabled={busy}
              onClick={() => regenerate(message.id)}
            >
              <RotateCcw size={13.5} />
            </IconButton>
          )}
          <IconButton
            label="有帮助"
            size="sm"
            active={message.feedback === 1}
            onClick={() => setFeedback(message.id, message.feedback === 1 ? null : 1)}
          >
            <ThumbsUp size={13.5} className={message.feedback === 1 ? "text-accent" : ""} />
          </IconButton>
          <IconButton
            label="没帮助"
            size="sm"
            active={message.feedback === -1}
            onClick={() => setFeedback(message.id, message.feedback === -1 ? null : -1)}
          >
            <ThumbsDown size={13.5} className={message.feedback === -1 ? "text-accent" : ""} />
          </IconButton>
          <span className="ml-1.5 flex items-center gap-1">
            {isDemoMessage && (
              <span className="rounded border border-line px-1 py-px text-[10px] uppercase tracking-wide text-faint">
                Demo
              </span>
            )}
            {modelLabel(message.modelId)}
          </span>
        </div>
      )}
    </div>
  );
}
