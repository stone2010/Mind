import { create } from "zustand";
import { api, errorMessage, listenChatEvents } from "../lib/bridge";
import { buildSystemPrompt } from "../lib/prompts";
import { pickRelevantMemories } from "../lib/memoryRecall";
import { deriveTitle, parseAttachments, uuid } from "../lib/utils";
import { hasPendingQuestion } from "../components/AskBlock";
import type {
  Attachment,
  ChatEvent,
  ChatTurn,
  ConnectorCall,
  Conversation,
  Message,
  MessageStatus,
  ProviderError,
  TokenUsage,
  UsageLogEntry,
} from "../types";
import { useAppStore } from "./app";
import { useApprovalStore } from "./approvals";
import { pushToast } from "./toast";

interface StreamingState {
  requestId: string;
  conversationId: string;
  messageId: string;
  startedAt: number;
  providerId: string;
  modelId: string;
  demo: boolean;
  usage: TokenUsage;
  search: {
    queries: string[];
    status: "searching" | "sources" | "error";
    error?: string;
  } | null;
}

interface ChatStore {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  activeId: string | null;
  pendingProjectId: string | null;
  loading: boolean;
  streaming: StreamingState | null;
  stopping: boolean;
  compacting: boolean;
  usageByConversation: Record<string, UsageLogEntry[]>;
  answeredQuestions: Record<string, boolean>;

  bootstrap: () => Promise<void>;
  loadConversations: () => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  newChat: (projectId?: string | null) => void;
  send: (text: string, attachments: Attachment[], fromAskBlock?: boolean) => Promise<void>;
  stop: () => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
  editAndResend: (messageId: string, content: string) => Promise<void>;
  setFeedback: (messageId: string, value: number | null) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  moveToProject: (id: string, projectId: string | null) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  setConversationModel: (id: string, modelId: string) => Promise<void>;
  refreshConversationUsage: (id: string) => Promise<void>;
  markQuestionAnswered: (messageId: string) => void;
}

let contentBuf = "";
let reasoningBuf = "";
let flushTimer: number | null = null;
let lastPersist = 0;
let listenerReady: Promise<void> | null = null;
let memoryExtractionRunning = false;
let memoryErrorNotified = false;

function scheduleMemoryExtraction(
  conversationId: string,
  messages: Message[],
  providerId: string,
  modelId: string,
) {
  if (memoryExtractionRunning) return;
  const turns: ChatTurn[] = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content, images: [] }));
  if (!turns.some((t) => t.role === "user")) return;

  window.setTimeout(async () => {
    const settings = useAppStore.getState().settings;
    // 自动“记住”与是否把记忆注入对话是两个独立开关：即使注入关闭，
    // 用户开启自动记忆后仍应积累记忆。
    if (memoryExtractionRunning || !settings.autoMemory || settings.demoMode) return;
    memoryExtractionRunning = true;
    try {
      const added = await api.memoryAutoExtract(
        providerId,
        modelId,
        conversationId,
        turns,
      );
      memoryErrorNotified = false;
      if (added.length > 0) {
        await useAppStore.getState().refreshMemories();
        pushToast({
          kind: "success",
          title: `已记住 ${added.length} 条信息`,
          action: {
            label: "查看记忆",
            onClick: () =>
              useAppStore.getState().setView({ name: "settings", section: "memory" }),
          },
        });
      }
    } catch (err) {
      // Surface the first failure per session: silent failures made the
      // feature look unimplemented even when the key or model was wrong.
      if (!memoryErrorNotified) {
        memoryErrorNotified = true;
        pushToast({
          kind: "error",
          title: "自动记忆提取失败",
          detail: errorMessage(err),
          action: {
            label: "查看记忆",
            onClick: () =>
              useAppStore.getState().setView({ name: "settings", section: "memory" }),
          },
        });
      }
    } finally {
      memoryExtractionRunning = false;
    }
  }, 1200);
}

function upsertConnectorCall(list: ConnectorCall[], call: ConnectorCall): ConnectorCall[] {
  const index = list.findIndex((c) => c.callId === call.callId);
  if (index < 0) return [...list, call];
  const next = [...list];
  next[index] = { ...next[index], ...call };
  return next;
}

function settleConnectorCalls(raw?: string | null): string | null {
  if (!raw) return raw ?? null;
  try {
    const calls = JSON.parse(raw) as ConnectorCall[];
    let changed = false;
    const next = calls.map((call) => {
      if (call.status === "pending" || call.status === "running") {
        changed = true;
        return { ...call, status: "error" as const, error: "生成已停止" };
      }
      return call;
    });
    return changed ? JSON.stringify(next) : raw;
  } catch {
    return raw;
  }
}

function approxTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return cjk + Math.ceil(other / 4) + 4;
}

function estimateMessageTokens(message: Message): number {
  let tokens = approxTokens(message.content);
  for (const attachment of parseAttachments(message.attachments)) {
    if (attachment.kind === "text" && attachment.text) tokens += approxTokens(attachment.text);
    if (attachment.kind === "image") tokens += 1000;
  }
  if (message.reasoning) tokens += approxTokens(message.reasoning);
  return tokens;
}

async function compressIfNeeded(
  conversationId: string,
  history: Message[],
  providerId: string,
  modelId: string,
  demo: boolean,
): Promise<{ summary: string | null; summaryUpto: number }> {
  const app = useAppStore.getState();
  const settings = app.settings;
  const conversation = useChatStore
    .getState()
    .conversations.find((c) => c.id === conversationId);
  let summary = conversation?.summary?.trim() || null;
  let summaryUpto = Math.max(0, conversation?.summaryUpto ?? 0);

  if (summaryUpto > history.length) {
    summary = null;
    summaryUpto = 0;
    await api.setConversationSummary(conversationId, null, 0).catch(() => {});
  }

  if (settings.contextTokens <= 0) {
    return { summary: null, summaryUpto: 0 };
  }
  if (demo || !settings.autoCompress || history.length <= summaryUpto + 2) {
    return { summary, summaryUpto };
  }

  const budget = settings.contextTokens;
  let total = summary ? approxTokens(summary) + 16 : 0;
  for (let i = summaryUpto; i < history.length; i += 1) {
    total += estimateMessageTokens(history[i]);
  }
  if (total <= budget * 0.85) return { summary, summaryUpto };

  const keepBudget = Math.max(600, Math.floor(budget * 0.35));
  let kept = 0;
  let cutoff = history.length;
  for (let i = history.length - 1; i >= summaryUpto; i -= 1) {
    const cost = estimateMessageTokens(history[i]);
    if (kept + cost > keepBudget && history.length - i >= 2) break;
    kept += cost;
    cutoff = i;
  }
  cutoff = Math.max(summaryUpto, Math.min(cutoff, history.length - 2));
  if (cutoff - summaryUpto < 2) return { summary, summaryUpto };

  const slice = history
    .slice(summaryUpto, cutoff)
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim());
  if (slice.length < 2) return { summary, summaryUpto };

  useChatStore.setState({ compacting: true });
  pushToast({
    kind: "info",
    title: "正在压缩较早的对话…",
    detail: "压缩后会自动继续发送，之后的请求不必重复携带这些历史。",
  });
  try {
    const result = await api.contextCompress(
      providerId,
      modelId,
      summary,
      slice.map((m) => ({ role: m.role, content: m.content, images: [] })),
    );
    const usage = result.usage;
    const total = (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0);
    if (usage && total > 0 && useAppStore.getState().settings.usageEnabled) {
      api
        .logUsage({
          id: uuid(),
          conversationId,
          messageId: null,
          providerId,
          modelId,
          kind: "compact",
          promptTokens: usage.promptTokens ?? 0,
          completionTokens: usage.completionTokens ?? 0,
          totalTokens: usage.totalTokens ?? total,
          promptCacheHitTokens: usage.promptCacheHitTokens ?? 0,
          promptCacheMissTokens: usage.promptCacheMissTokens ?? 0,
          createdAt: Date.now(),
        })
        .then(() =>
          useChatStore.getState().refreshConversationUsage(conversationId),
        )
        .catch(() => {});
    }
    const nextSummary = result.summary.trim();
    if (!nextSummary) throw new Error("模型没有返回摘要");
    summary = nextSummary;
    summaryUpto = cutoff;
    await api.setConversationSummary(conversationId, summary, summaryUpto);
    useChatStore.setState((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, summary, summaryUpto } : c,
      ),
    }));
    pushToast({
      kind: "success",
      title: "已自动压缩较早的对话",
      detail: `${slice.length} 条消息已合并为摘要，后续请求会携带摘要和最近消息。`,
    });
  } catch (err) {
    pushToast({
      kind: "error",
      title: "上下文压缩失败，将改为只发送最近消息。",
      detail: errorMessage(err),
    });
  } finally {
    useChatStore.setState({ compacting: false });
  }
  return { summary, summaryUpto };
}

async function resetSummaryAfterCut(conversationId: string, keepCount: number) {
  const conversation = useChatStore
    .getState()
    .conversations.find((c) => c.id === conversationId);
  if (!conversation?.summary) return;
  if ((conversation.summaryUpto ?? 0) <= keepCount) return;
  await api.setConversationSummary(conversationId, null, 0).catch(() => {});
  useChatStore.setState((state) => ({
    conversations: state.conversations.map((c) =>
      c.id === conversationId ? { ...c, summary: null, summaryUpto: 0 } : c,
    ),
  }));
}

function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

function buildTurns(history: Message[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const m of history) {
    if (m.role === "system") continue;
    if (m.role === "assistant" && (m.status === "error" || m.status === "streaming")) {
      if (!m.content.trim()) continue;
    }
    const atts = parseAttachments(m.attachments);
    let content = m.content;
    const textFiles = atts.filter((a) => a.kind === "text" && a.text);
    if (textFiles.length) {
      content +=
        "\n\n" +
        textFiles
          .map((a) => `<file name="${a.name}">\n${a.text}\n</file>`)
          .join("\n\n");
    }
    const images = atts
      .filter((a) => a.kind === "image" && a.dataUrl)
      .map((a) => a.dataUrl as string);
    if (!content.trim() && images.length === 0) continue;
    const turn: ChatTurn = { role: m.role, content, images };
    if (m.role === "assistant") {
      if (m.reasoning) turn.reasoning = m.reasoning;
      if (m.serverToolCalls) {
        try {
          turn.serverToolCalls = JSON.parse(m.serverToolCalls);
        } catch {
          /* ignore malformed tool history */
        }
      }
    }
    turns.push(turn);
  }
  return turns;
}

/**
 * 根据「记忆注入模式」挑选要携带的长期记忆：
 * - recent（默认）：注入最近的记忆，行为与原版一致；
 * - recall：用 CJK 关键词打分，只挑与当前问题相关的记忆（省 token、更准）。
 */
function pickMemoriesFor(
  settings: { memoryRecall?: "recall" | "recent" },
  history: Message[],
): string[] {
  const all = useAppStore.getState().memories;
  if (all.length === 0) return [];
  if (settings.memoryRecall !== "recall") {
    return all.map((m) => m.content);
  }
  const query =
    [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  return pickRelevantMemories(
    all.map((m) => ({ id: m.id, content: m.content })),
    query,
    8,
  ).map((m) => m.content);
}

function scheduleFlush() {
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flushBuffers();
  }, 40);
}

function flushBuffers(persist = true) {
  const st = useChatStore.getState();
  const streaming = st.streaming;
  if (!streaming) {
    contentBuf = "";
    reasoningBuf = "";
    return;
  }
  const deltaContent = contentBuf;
  const deltaReasoning = reasoningBuf;
  contentBuf = "";
  reasoningBuf = "";
  if (!deltaContent && !deltaReasoning) return;

  const list = st.messages[streaming.conversationId] ?? [];
  const next = list.map((m) =>
    m.id === streaming.messageId
      ? {
          ...m,
          content: m.content + deltaContent,
          reasoning: deltaReasoning ? (m.reasoning ?? "") + deltaReasoning : m.reasoning,
        }
      : m,
  );
  useChatStore.setState({
    messages: { ...st.messages, [streaming.conversationId]: next },
  });

  if (persist && Date.now() - lastPersist > 900) {
    lastPersist = Date.now();
    const msg = next.find((m) => m.id === streaming.messageId);
    if (msg) {
      api
        .finishMessage(
          msg.id,
          msg.content,
          msg.reasoning ?? null,
          "streaming",
          msg.sources ?? null,
          msg.serverToolCalls ?? null,
          msg.connectorCalls ?? null,
        )
        .catch(() => {});
    }
  }
}

function finalize(status: MessageStatus, error?: ProviderError) {
  const st = useChatStore.getState();
  const streaming = st.streaming;
  if (!streaming) return;

  if (flushTimer != null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushBuffers(false);

  const fresh = useChatStore.getState();
  const list = fresh.messages[streaming.conversationId] ?? [];
  const msg = list.find((m) => m.id === streaming.messageId);
  const connectorCalls =
    status === "stopped" || status === "error"
      ? settleConnectorCalls(msg?.connectorCalls)
      : msg?.connectorCalls ?? null;
  const nextMessages = list.map((m) =>
    m.id === streaming.messageId ? { ...m, status, connectorCalls } : m,
  );
  const now = Date.now();

  useChatStore.setState({
    streaming: null,
    stopping: false,
    messages: { ...fresh.messages, [streaming.conversationId]: nextMessages },
    conversations: sortConversations(
      fresh.conversations.map((c) =>
        c.id === streaming.conversationId ? { ...c, updatedAt: now } : c,
      ),
    ),
  });

  if (msg) {
    api
      .finishMessage(
        msg.id,
        msg.content,
        msg.reasoning ?? null,
        status,
        msg.sources ?? null,
        msg.serverToolCalls ?? null,
        connectorCalls,
      )
      .catch(() => {});
  }
  const usage = streaming.usage;
  const totalUsage =
    (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
  if (
    !streaming.demo &&
    totalUsage > 0 &&
    useAppStore.getState().settings.usageEnabled
  ) {
    api
      .logUsage({
        id: uuid(),
        conversationId: streaming.conversationId,
        messageId: streaming.messageId,
        providerId: streaming.providerId,
        modelId: streaming.modelId,
        kind: "chat",
        promptTokens: usage.promptTokens ?? 0,
        completionTokens: usage.completionTokens ?? 0,
        totalTokens: usage.totalTokens ?? totalUsage,
        promptCacheHitTokens: usage.promptCacheHitTokens ?? 0,
        promptCacheMissTokens: usage.promptCacheMissTokens ?? 0,
        createdAt: Date.now(),
      })
      .then(() =>
        useChatStore
          .getState()
          .refreshConversationUsage(streaming.conversationId),
      )
      .catch(() => {});
  }
  useApprovalStore.getState().clear(streaming.requestId);
  if (useAppStore.getState().settings.connectors) {
    void useAppStore.getState().refreshConnectors();
  }
  if (error) {
    pushToast({
      kind: "error",
      title: error.message,
      detail: error.detail,
      action:
        error.code === "invalid_key"
          ? {
              label: "前往模型连接",
              onClick: () => {
                useAppStore.getState().setView({ name: "settings", section: "model" });
              },
            }
          : undefined,
    });
  }

  if (status === "complete" && !streaming.demo) {
    const settings = useAppStore.getState().settings;
    if (settings.autoMemory) {
      scheduleMemoryExtraction(
        streaming.conversationId,
        nextMessages,
        streaming.providerId,
        streaming.modelId,
      );
    }
  }
}

function handleEvent(event: ChatEvent) {
  const st = useChatStore.getState();
  if (!st.streaming || st.streaming.requestId !== event.requestId) return;

  switch (event.kind) {
    case "content":
      if (event.delta) {
        contentBuf += event.delta;
        scheduleFlush();
      }
      break;
    case "reasoning":
      if (event.delta) {
        reasoningBuf += event.delta;
        scheduleFlush();
      }
      break;
    case "done":
      finalize(event.cancelled ? "stopped" : "complete");
      break;
    case "usage": {
      const usage = event.usage;
      if (!usage || !st.streaming) break;
      const previous = st.streaming.usage;
      useChatStore.setState({
        streaming: {
          ...st.streaming,
          usage: {
            promptTokens: (previous.promptTokens ?? 0) + (usage.promptTokens ?? 0),
            completionTokens:
              (previous.completionTokens ?? 0) + (usage.completionTokens ?? 0),
            totalTokens: (previous.totalTokens ?? 0) + (usage.totalTokens ?? 0),
            promptCacheHitTokens:
              (previous.promptCacheHitTokens ?? 0) +
              (usage.promptCacheHitTokens ?? 0),
            promptCacheMissTokens:
              (previous.promptCacheMissTokens ?? 0) +
              (usage.promptCacheMissTokens ?? 0),
          },
        },
      });
      break;
    }
    case "search": {
      const update = event.search;
      if (!update) break;
      const { conversationId, messageId, search: previousSearch } = st.streaming;
      const list = st.messages[conversationId] ?? [];
      const sourcesJson =
        update.sources && update.sources.length ? JSON.stringify(update.sources) : null;
      const toolCallsJson = update.serverToolCalls
        ? JSON.stringify(update.serverToolCalls)
        : null;
      const nextMessages = list.map((m) =>
        m.id === messageId
          ? {
              ...m,
              sources: sourcesJson ?? m.sources,
              serverToolCalls: toolCallsJson ?? m.serverToolCalls,
            }
          : m,
      );
      useChatStore.setState({
        messages: { ...st.messages, [conversationId]: nextMessages },
        streaming: {
          ...st.streaming,
          search: {
            queries:
              update.queries && update.queries.length
                ? update.queries
                : (previousSearch?.queries ?? []),
            status: update.status,
            error: update.error,
          },
        },
      });
      // Persist sources immediately so they survive an app close before the
      // first content flush.
      if (sourcesJson || toolCallsJson) {
        const msg = nextMessages.find((m) => m.id === messageId);
        if (msg) {
          api
            .finishMessage(
              msg.id,
              msg.content,
              msg.reasoning ?? null,
              "streaming",
              msg.sources ?? null,
              msg.serverToolCalls ?? null,
              msg.connectorCalls ?? null,
            )
            .catch(() => {});
        }
      }
      break;
    }
    case "connector": {
      const call = event.connector;
      if (!call) break;
      const { conversationId, messageId } = st.streaming;
      const list = st.messages[conversationId] ?? [];
      let callsJson: string | null = null;
      const nextMessages = list.map((m) => {
        if (m.id !== messageId) return m;
        let existing: ConnectorCall[] = [];
        if (m.connectorCalls) {
          try {
            existing = JSON.parse(m.connectorCalls) as ConnectorCall[];
          } catch {
            existing = [];
          }
        }
        const merged = upsertConnectorCall(existing, call);
        callsJson = JSON.stringify(merged);
        return { ...m, connectorCalls: callsJson };
      });
      useChatStore.setState({
        messages: { ...st.messages, [conversationId]: nextMessages },
      });
      const msg = nextMessages.find((m) => m.id === messageId);
      if (msg && callsJson) {
        api
          .finishMessage(
            msg.id,
            msg.content,
            msg.reasoning ?? null,
            "streaming",
            msg.sources ?? null,
            msg.serverToolCalls ?? null,
            msg.connectorCalls ?? null,
          )
          .catch(() => {});
      }
      break;
    }
    case "error":
      if (event.cancelled) finalize("stopped");
      else finalize("error", event.error);
      break;
    default:
      break;
  }
}

async function startAssistant(conversationId: string, history: Message[]) {
  const app = useAppStore.getState();
  const settings = app.settings;

  if (!settings.demoMode) {
    const provider = app.providers.find((p) => p.id === settings.providerId);
    const model = provider?.models.find((m) => m.id === settings.modelId);
    if (!provider || !model) {
      pushToast({ kind: "error", title: "当前模型不可用，请在设置中重新选择模型。" });
      return;
    }
    if (!app.keyPresent[provider.id]) {
      pushToast({
        kind: "error",
        title: "尚未配置 API Key，请先连接模型。",
        action: {
          label: "前往模型连接",
          onClick: () => {
            useAppStore.getState().setView({ name: "settings", section: "model" });
          },
        },
      });
      return;
    }
  }

  let requestHistory = history;
  let summary: string | null = null;
  if (!settings.demoMode) {
    const compressed = await compressIfNeeded(
      conversationId,
      history,
      settings.providerId,
      settings.modelId,
      false,
    );
    summary = compressed.summary;
    requestHistory = history.slice(compressed.summaryUpto);
  }

  const requestId = uuid();
  const messageModelId = settings.demoMode ? `demo:${settings.modelId}` : settings.modelId;
  const assistant: Message = {
    id: uuid(),
    conversationId,
    role: "assistant",
    content: "",
    reasoning: null,
    attachments: null,
    status: "streaming",
    feedback: null,
    modelId: messageModelId,
    sources: null,
    serverToolCalls: null,
    connectorCalls: null,
    createdAt: Date.now(),
  };

  try {
    await api.insertMessage(assistant);
  } catch (err) {
    pushToast({ kind: "error", title: "消息保存失败", detail: errorMessage(err) });
    return;
  }

  const st = useChatStore.getState();
  const list = st.messages[conversationId] ?? [];
  contentBuf = "";
  reasoningBuf = "";
  lastPersist = 0;

  useChatStore.setState({
    messages: { ...st.messages, [conversationId]: [...list, assistant] },
    streaming: {
      requestId,
      conversationId,
      messageId: assistant.id,
      startedAt: Date.now(),
      providerId: settings.providerId,
      modelId: settings.modelId,
      demo: settings.demoMode,
      usage: {},
      search: null,
    },
    stopping: false,
  });

  const memories =
    settings.longTermMemory
      ? pickMemoriesFor(settings, requestHistory)
      : [];

  try {
    const customInstructions = settings.customInstructions?.trim();
    const hasTools =
      settings.connectors &&
      !settings.demoMode &&
      (useAppStore.getState().connectors.some((c) => c.config.enabled) ||
        !!useAppStore.getState().github?.connected);
    await api.chatStream({
      requestId,
      providerId: settings.providerId,
      modelId: settings.modelId,
      messages: buildTurns(requestHistory),
      thinking: settings.thinking,
      webSearch: settings.webSearch,
      connectors: settings.connectors && !settings.demoMode,
      memories,
      demo: settings.demoMode,
      temperature: null,
      maxTokens: null,
      contextTokens: settings.contextTokens,
      summary,
      systemPrompt: buildSystemPrompt({
        demoMode: settings.demoMode,
        useMemory: settings.longTermMemory,
        clarify: settings.clarify,
        visual: settings.visualHints,
        thinking: settings.thinking,
        chatMode: settings.chatMode,
        webSearch: settings.webSearch && !settings.demoMode,
        hasTools,
        customInstructions,
      }),
    });
  } catch (err) {
    handleEvent({
      requestId,
      kind: "error",
      error: {
        code: "unknown",
        message: "无法发起请求，请稍后再试。",
        detail: errorMessage(err),
      },
    });
  }
}


export const useChatStore = create<ChatStore>((set, get) => ({
  conversations: [],
  messages: {},
  activeId: null,
  pendingProjectId: null,
  loading: false,
  streaming: null,
  stopping: false,
  compacting: false,
  usageByConversation: {},
  answeredQuestions: {},

  bootstrap: async () => {
    if (!listenerReady) {
      listenerReady = listenChatEvents(handleEvent);
    }
    await listenerReady;
    const conversations = await api.listConversations();
    set({ conversations: sortConversations(conversations) });
    const active = get().activeId;
    if (!active) {
      const first = conversations.find((c) => !c.archived && !c.pinned) ??
        conversations.find((c) => !c.archived);
      if (first) await get().openConversation(first.id);
    }
  },

  loadConversations: async () => {
    const conversations = await api.listConversations();
    set({ conversations: sortConversations(conversations) });
  },

  openConversation: async (id) => {
    set({ activeId: id, loading: true, pendingProjectId: null });
    try {
      const messages = await api.getMessages(id);
      const { streaming } = get();
      const existing = get().messages[id] ?? [];
      const normalized = messages.map((m) => {
        if (streaming?.conversationId === id && m.id === streaming.messageId) {
          return existing.find((e) => e.id === m.id) ?? m;
        }
        return m.status === "streaming"
          ? {
              ...m,
              status: "stopped" as MessageStatus,
              connectorCalls: settleConnectorCalls(m.connectorCalls),
            }
          : m;
      });
      set((s) => ({
        messages: { ...s.messages, [id]: normalized },
        loading: false,
      }));
      void get().refreshConversationUsage(id);
    } catch (err) {
      set({ loading: false });
      pushToast({ kind: "error", title: "无法加载对话", detail: errorMessage(err) });
    }
  },

  newChat: (projectId = null) => {
    set({ activeId: null, pendingProjectId: projectId ?? null });
  },

  send: async (text, attachments, fromAskBlock = false) => {
    const state = get();
    if (state.streaming || state.compacting) return;
    const app = useAppStore.getState();
    const content = text.trim();
    if (!content && attachments.length === 0) return;

    let convId = state.activeId;
    if (!convId) {
      try {
        const conv = await api.createConversation(
          deriveTitle(content || attachments[0]?.name || "新对话"),
          app.settings.modelId,
          state.pendingProjectId,
        );
        set((s) => ({
          conversations: sortConversations([conv, ...s.conversations]),
          activeId: conv.id,
          pendingProjectId: null,
        }));
        convId = conv.id;
        if (conv.projectId) void useAppStore.getState().refreshProjects();
      } catch (err) {
        pushToast({ kind: "error", title: "无法创建对话", detail: errorMessage(err) });
        return;
      }
    }

    // Only mark the pending ask-block as answered when this send actually
    // came from the ask block UI. A free-form reply typed in the composer
    // (the user "skipping" clarification) must NOT be treated as answered,
    // otherwise the questions re-open on the next turn.
    if (fromAskBlock) {
      const pendingList = state.messages[convId] ?? [];
      const pendingAsk = [...pendingList].reverse().find(
        (m) => m.role === "assistant" && hasPendingQuestion(m.content),
      );
      if (pendingAsk && !state.answeredQuestions[pendingAsk.id]) {
        set((s) => ({
          answeredQuestions: { ...s.answeredQuestions, [pendingAsk.id]: true },
        }));
      }
    }

    const userMessage: Message = {
      id: uuid(),
      conversationId: convId,
      role: "user",
      content,
      reasoning: null,
      attachments: attachments.length ? JSON.stringify(attachments) : null,
      status: "complete",
      feedback: null,
      modelId: app.settings.demoMode
        ? `demo:${app.settings.modelId}`
        : app.settings.modelId,
      sources: null,
      serverToolCalls: null,
      connectorCalls: null,
      createdAt: Date.now(),
    };

    try {
      await api.insertMessage(userMessage);
    } catch (err) {
      pushToast({ kind: "error", title: "消息保存失败", detail: errorMessage(err) });
      return;
    }

    const list = get().messages[convId] ?? [];
    const nextList = [...list, userMessage];
    set((s) => ({
      messages: { ...s.messages, [convId as string]: nextList },
      conversations: sortConversations(
        s.conversations.map((c) =>
          c.id === convId ? { ...c, updatedAt: Date.now() } : c,
        ),
      ),
    }));

    await startAssistant(convId, nextList);
  },

  markQuestionAnswered: (messageId) => {
    set((s) => ({
      answeredQuestions: { ...s.answeredQuestions, [messageId]: true },
    }));
  },

  stop: async () => {
    const { streaming } = get();
    if (!streaming) return;
    set({ stopping: true });
    try {
      await api.chatCancel(streaming.requestId);
    } catch {
      set({ stopping: false });
    }
  },

  regenerate: async (messageId) => {
    const st = get();
    if (st.streaming) return;
    const convId = st.activeId;
    if (!convId) return;
    const list = st.messages[convId] ?? [];
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const history = list.slice(0, idx);
    try {
      await api.deleteMessagesFrom(convId, messageId);
    } catch (err) {
      pushToast({ kind: "error", title: "操作失败", detail: errorMessage(err) });
      return;
    }
    set((s) => ({ messages: { ...s.messages, [convId]: history } }));
    await resetSummaryAfterCut(convId, idx);
    await startAssistant(convId, history);
  },

  editAndResend: async (messageId, content) => {
    const st = get();
    if (st.streaming) return;
    const convId = st.activeId;
    if (!convId) return;
    const list = st.messages[convId] ?? [];
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const trimmed = content.trim();
    if (!trimmed) return;

    const updated = list.map((m, i) => (i === idx ? { ...m, content: trimmed } : m));
    const history = updated.slice(0, idx + 1);
    const nextMessage = updated[idx + 1];

    try {
      await api.updateMessageContent(messageId, trimmed);
      if (nextMessage) await api.deleteMessagesFrom(convId, nextMessage.id);
    } catch (err) {
      pushToast({ kind: "error", title: "操作失败", detail: errorMessage(err) });
      return;
    }

    set((s) => ({ messages: { ...s.messages, [convId]: history } }));
    await resetSummaryAfterCut(convId, idx + 1);
    await startAssistant(convId, history);
  },

  setFeedback: async (messageId, value) => {
    const convId = get().activeId;
    if (!convId) return;
    set((s) => ({
      messages: {
        ...s.messages,
        [convId]: (s.messages[convId] ?? []).map((m) =>
          m.id === messageId ? { ...m, feedback: value } : m,
        ),
      },
    }));
    try {
      await api.setMessageFeedback(messageId, value);
    } catch {
      /* feedback is non-critical */
    }
  },

  renameConversation: async (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      await api.renameConversation(id, trimmed);
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === id ? { ...c, title: trimmed, updatedAt: Date.now() } : c,
        ),
      }));
    } catch (err) {
      pushToast({ kind: "error", title: "重命名失败", detail: errorMessage(err) });
    }
  },

  setPinned: async (id, pinned) => {
    try {
      await api.setConversationPinned(id, pinned);
      set((s) => ({
        conversations: sortConversations(
          s.conversations.map((c) => (c.id === id ? { ...c, pinned } : c)),
        ),
      }));
    } catch (err) {
      pushToast({ kind: "error", title: "操作失败", detail: errorMessage(err) });
    }
  },

  setArchived: async (id, archived) => {
    try {
      await api.setConversationArchived(id, archived);
      set((s) => ({
        conversations: sortConversations(
          s.conversations.map((c) => (c.id === id ? { ...c, archived } : c)),
        ),
        activeId: archived && s.activeId === id ? null : s.activeId,
      }));
      useAppStore.getState().refreshProjects();
    } catch (err) {
      pushToast({ kind: "error", title: "操作失败", detail: errorMessage(err) });
    }
  },

  moveToProject: async (id, projectId) => {
    try {
      await api.setConversationProject(id, projectId);
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === id ? { ...c, projectId, updatedAt: Date.now() } : c,
        ),
      }));
      await useAppStore.getState().refreshProjects();
    } catch (err) {
      pushToast({ kind: "error", title: "操作失败", detail: errorMessage(err) });
    }
  },

  deleteConversation: async (id) => {
    const st = get();
    if (st.streaming?.conversationId === id) {
      await st.stop();
    }
    try {
      await api.deleteConversation(id);
      set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== id),
        activeId: s.activeId === id ? null : s.activeId,
        messages: Object.fromEntries(Object.entries(s.messages).filter(([k]) => k !== id)),
      }));
      await useAppStore.getState().refreshProjects();
    } catch (err) {
      pushToast({ kind: "error", title: "删除失败", detail: errorMessage(err) });
    }
  },

  setConversationModel: async (id, modelId) => {
    try {
      await api.setConversationModel(id, modelId);
      set((s) => ({
        conversations: s.conversations.map((c) => (c.id === id ? { ...c, modelId } : c)),
      }));
    } catch {
      /* non-critical */
    }
  },

  refreshConversationUsage: async (id) => {
    try {
      const logs = await api.listConversationUsage(id);
      set((s) => ({
        usageByConversation: { ...s.usageByConversation, [id]: logs },
      }));
    } catch {
      /* non-critical */
    }
  },
}));
