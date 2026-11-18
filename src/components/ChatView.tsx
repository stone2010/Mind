import { Brain, FolderClosed, Menu, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { readAttachment } from "../lib/attachments";
import { currentModel, useAppStore } from "../store/app";
import { useChatStore } from "../store/chat";
import { pushToast } from "../store/toast";
import type { Attachment, Message } from "../types";
import { Composer } from "./Composer";
import { ConversationCost } from "./ConversationCost";
import { MessageList } from "./MessageList";

const EMPTY: Message[] = [];

export function ChatView({
  mobile = false,
  onOpenSidebar,
}: {
  mobile?: boolean;
  onOpenSidebar?: () => void;
}) {
  const activeId = useChatStore((s) => s.activeId);
  const messagesMap = useChatStore((s) => s.messages);
  const conversations = useChatStore((s) => s.conversations);
  const streaming = useChatStore((s) => s.streaming);
  const send = useChatStore((s) => s.send);
  const pendingProjectId = useChatStore((s) => s.pendingProjectId);
  const settings = useAppStore((s) => s.settings);
  const memories = useAppStore((s) => s.memories);
  const keyPresent = useAppStore((s) => s.keyPresent);
  const projects = useAppStore((s) => s.projects);
  const setView = useAppStore((s) => s.setView);

  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);

  const conversation = conversations.find((c) => c.id === activeId);
  const messages = activeId ? messagesMap[activeId] ?? EMPTY : EMPTY;
  const streamingMessageId =
    streaming && streaming.conversationId === activeId ? streaming.messageId : null;
  const project = conversation?.projectId
    ? projects.find((p) => p.id === conversation.projectId)
    : pendingProjectId
      ? projects.find((p) => p.id === pendingProjectId)
      : undefined;

  useEffect(() => {
    setDraft("");
    setAttachments([]);
  }, [activeId]);

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const room = 5 - attachments.length;
    if (room <= 0) {
      pushToast({ kind: "info", title: "最多同时添加 5 个附件" });
      return;
    }
    const added: Attachment[] = [];
    for (const file of list.slice(0, room)) {
      try {
        const result = await readAttachment(file);
        if (result.error) pushToast({ kind: "error", title: result.error });
        else if (result.attachment) added.push(result.attachment);
      } catch (err) {
        pushToast({
          kind: "error",
          title: `无法读取「${file.name}」`,
          detail: String(err),
        });
      }
    }
    if (added.length) setAttachments((prev) => [...prev, ...added]);
  };

  const handleSend = async () => {
    if (streaming) return;
    const model = currentModel();
    if (!settings.demoMode && !keyPresent[settings.providerId]) {
      pushToast({ kind: "error", title: "尚未配置 API Key，请先连接模型。" });
      setView({ name: "settings", section: "model" });
      return;
    }
    if (
      model &&
      !model.supportsVision &&
      attachments.some((a) => a.kind === "image")
    ) {
      pushToast({
        kind: "error",
        title: `${model.label} 不支持图片输入，请切换模型或移除图片。`,
      });
      return;
    }
    const text = draft;
    const files = attachments;
    if (!text.trim() && files.length === 0) return;
    setDraft("");
    setAttachments([]);
    await send(text, files);
    requestAnimationFrame(() => document.getElementById("composer-input")?.focus());
  };

  const suggestion = (text: string) => {
    setDraft(text);
    requestAnimationFrame(() => {
      const el = document.getElementById("composer-input") as HTMLTextAreaElement | null;
      el?.focus();
      el?.setSelectionRange(text.length, text.length);
    });
  };

  return (
    <div
      className="relative flex h-full min-w-0 flex-1 flex-col bg-bg"
      onDragEnter={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          dragDepth.current += 1;
          setDragActive(true);
        }
      }}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragActive(false);
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
    >
      <div
        className={clsx(
          "flex shrink-0 items-center gap-2",
          mobile ? "h-12 px-3" : "h-[52px] px-5",
        )}
      >
        {mobile && (
          <button
            onClick={onOpenSidebar}
            aria-label="打开菜单"
            className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink"
          >
            <Menu size={19} />
          </button>
        )}
        <h1 className="min-w-0 truncate text-[13.5px] font-medium text-ink">
          {conversation?.title ?? "新对话"}
        </h1>
        {project && (
          <span className="flex shrink-0 items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted">
            <FolderClosed size={11} />
            {project.name}
          </span>
        )}
        <div className="flex-1" />
        {settings.longTermMemory && memories.length > 0 && (
          <button
            onClick={() => setView({ name: "settings", section: "memory" })}
            title={`长期记忆已启用：${memories.length} 条，点击管理`}
            className="flex shrink-0 items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink"
          >
            <Brain size={11} />
            {memories.length}
          </button>
        )}
        <ConversationCost conversationId={activeId} />
        {settings.demoMode && (
          <span className="shrink-0 rounded-md border border-line bg-sidebar px-2 py-0.5 text-[11px] text-muted">
            演示模式
          </span>
        )}
      </div>

      <MessageList
        conversationId={activeId}
        messages={messages}
        streamingMessageId={streamingMessageId}
        onSuggestion={suggestion}
      />

      <Composer
        draft={draft}
        onDraftChange={setDraft}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        onFiles={addFiles}
        onSend={handleSend}
      />

      {dragActive && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-bg/90">
          <div className="flex flex-col items-center gap-2 text-accent">
            <UploadCloud size={26} strokeWidth={1.6} />
            <span className="text-[13px] font-medium">松开以添加附件</span>
          </div>
        </div>
      )}
    </div>
  );
}
