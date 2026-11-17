import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppInfo,
  ApprovalRequest,
  ChatEvent,
  ChatRequest,
  ChatTurn,
  CompressResult,
  ConnectorConfig,
  ConnectorInfo,
  ConnectorToolInfo,
  ExportResult,
  GithubInfo,
  ImportResult,
  Conversation,
  Memory,
  Message,
  Project,
  ProviderConfig,
  RuntimeInfo,
  SearchHit,
  TestResult,
  UsageLogEntry,
} from "../types";

export const api = {
  settingsGetAll: () => invoke<Record<string, string>>("settings_get_all"),
  settingsSet: (key: string, value: string) => invoke<void>("settings_set", { key, value }),

  providersGet: () => invoke<ProviderConfig[]>("providers_get"),
  providersSave: (providersList: ProviderConfig[]) =>
    invoke<void>("providers_save", { providersList }),
  providerRemove: (id: string) => invoke<void>("provider_remove", { id }),
  credentialStatus: (providerId: string) =>
    invoke<boolean>("credential_status", { providerId }),
  credentialSave: (providerId: string, apiKey: string) =>
    invoke<void>("credential_save", { providerId, apiKey }),
  credentialDelete: (providerId: string) => invoke<void>("credential_delete", { providerId }),
  providerTest: (provider: ProviderConfig, modelId: string, apiKey?: string) =>
    invoke<TestResult>("provider_test", { provider, modelId, apiKey: apiKey ?? null }),
  onboardingConnect: (provider: ProviderConfig, apiKey: string, modelId: string) =>
    invoke<TestResult>("onboarding_connect", { provider, apiKey, modelId }),

  listConversations: () => invoke<Conversation[]>("db_list_conversations"),
  getConversation: (id: string) => invoke<Conversation | null>("db_get_conversation", { id }),
  createConversation: (title: string, modelId?: string | null, projectId?: string | null) =>
    invoke<Conversation>("db_create_conversation", {
      title,
      modelId: modelId ?? null,
      projectId: projectId ?? null,
    }),
  renameConversation: (id: string, title: string) =>
    invoke<void>("db_rename_conversation", { id, title }),
  setConversationPinned: (id: string, pinned: boolean) =>
    invoke<void>("db_set_conversation_pinned", { id, pinned }),
  setConversationArchived: (id: string, archived: boolean) =>
    invoke<void>("db_set_conversation_archived", { id, archived }),
  setConversationProject: (id: string, projectId: string | null) =>
    invoke<void>("db_set_conversation_project", { id, projectId }),
  setConversationModel: (id: string, modelId: string) =>
    invoke<void>("db_set_conversation_model", { id, modelId }),
  deleteConversation: (id: string) => invoke<void>("db_delete_conversation", { id }),
  touchConversation: (id: string) => invoke<void>("db_touch_conversation", { id }),

  getMessages: (conversationId: string) =>
    invoke<Message[]>("db_get_messages", { conversationId }),
  insertMessage: (message: Message) => invoke<void>("db_insert_message", { message }),
  finishMessage: (
    id: string,
    content: string,
    reasoning: string | null,
    status: string,
    sources: string | null,
    serverToolCalls: string | null,
    connectorCalls: string | null,
  ) =>
    invoke<void>("db_finish_message", {
      id,
      content,
      reasoning,
      status,
      sources,
      serverToolCalls,
      connectorCalls,
    }),
  updateMessageContent: (id: string, content: string) =>
    invoke<void>("db_update_message_content", { id, content }),
  setMessageFeedback: (id: string, feedback: number | null) =>
    invoke<void>("db_set_message_feedback", { id, feedback }),
  deleteMessage: (id: string) => invoke<void>("db_delete_message", { id }),
  deleteMessagesFrom: (conversationId: string, messageId: string) =>
    invoke<void>("db_delete_messages_from", { conversationId, messageId }),
  setConversationSummary: (id: string, summary: string | null, summaryUpto: number) =>
    invoke<void>("db_set_conversation_summary", { id, summary, summaryUpto }),

  search: (query: string) => invoke<SearchHit[]>("db_search", { query }),

  logUsage: (log: UsageLogEntry) => invoke<void>("db_log_usage", { log }),
  listUsage: (limit = 2000) => invoke<UsageLogEntry[]>("db_list_usage", { limit }),
  listConversationUsage: (conversationId: string, limit = 1000) =>
    invoke<UsageLogEntry[]>("db_conversation_usage", { conversationId, limit }),
  clearUsage: () => invoke<void>("db_clear_usage"),

  dataExport: (path: string) => invoke<ExportResult>("data_export", { path }),
  dataImport: (path: string, replace: boolean) =>
    invoke<ImportResult>("data_import", { path, replace }),

  listProjects: () => invoke<Project[]>("db_list_projects"),
  createProject: (name: string, description?: string | null) =>
    invoke<Project>("db_create_project", { name, description: description ?? null }),
  updateProject: (id: string, name: string, description: string | null) =>
    invoke<void>("db_update_project", { id, name, description }),
  deleteProject: (id: string) => invoke<void>("db_delete_project", { id }),
  projectConversations: (projectId: string) =>
    invoke<Conversation[]>("db_project_conversations", { projectId }),

  listMemories: () => invoke<Memory[]>("db_list_memories"),
  createMemory: (content: string) => invoke<Memory>("db_create_memory", { content }),
  updateMemory: (id: string, content: string) =>
    invoke<void>("db_update_memory", { id, content }),
  deleteMemory: (id: string) => invoke<void>("db_delete_memory", { id }),
  memoryAutoExtract: (
    providerId: string,
    modelId: string,
    conversationId: string,
    messages: ChatTurn[],
  ) =>
    invoke<Memory[]>("memory_auto_extract", {
      providerId,
      modelId,
      conversationId,
      messages,
    }),
  contextCompress: (
    providerId: string,
    modelId: string,
    existingSummary: string | null,
    messages: ChatTurn[],
  ) =>
    invoke<CompressResult>("context_compress", {
      providerId,
      modelId,
      existingSummary,
      messages,
    }),

  chatStream: (request: ChatRequest) => invoke<void>("chat_stream", { request }),
  chatCancel: (requestId: string) => invoke<void>("chat_cancel", { requestId }),

  connectorsGet: () => invoke<ConnectorInfo[]>("connectors_get"),
  connectorSave: (config: ConnectorConfig) =>
    invoke<ConnectorInfo>("connector_save", { config }),
  connectorDelete: (id: string) => invoke<void>("connector_delete", { id }),
  connectorSetEnabled: (id: string, enabled: boolean) =>
    invoke<ConnectorInfo>("connector_set_enabled", { id, enabled }),
  connectorTest: (config: ConnectorConfig) =>
    invoke<ConnectorToolInfo[]>("connector_test", { config }),
  connectorsConnectAll: () => invoke<void>("connectors_connect_all"),
  connectorApprove: (approvalId: string, approved: boolean) =>
    invoke<void>("connector_approve", { approvalId, approved }),
  runtimeCheck: () => invoke<RuntimeInfo>("runtime_check"),

  githubGet: () => invoke<GithubInfo>("github_get"),
  githubConnect: (token: string, baseUrl?: string | null) =>
    invoke<GithubInfo>("github_connect", { token, baseUrl: baseUrl ?? null }),
  githubTest: () => invoke<GithubInfo>("github_test"),
  githubDisconnect: () => invoke<GithubInfo>("github_disconnect"),
  githubSetEnabled: (enabled: boolean) =>
    invoke<GithubInfo>("github_set_enabled", { enabled }),

  appInfo: () => invoke<AppInfo>("app_info"),
  appReady: () => invoke<void>("app_ready"),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
  openDataDir: () => invoke<void>("open_data_dir"),
};

let chatUnlisten: UnlistenFn | null = null;

export async function listenChatEvents(handler: (event: ChatEvent) => void) {
  if (chatUnlisten) {
    chatUnlisten();
    chatUnlisten = null;
  }
  chatUnlisten = await listen<ChatEvent>("chat-event", (e) => handler(e.payload));
}

export async function listenConnectorApprovals(
  handler: (request: ApprovalRequest) => void,
) {
  return listen<ApprovalRequest>("connector-approval", (e) => handler(e.payload));
}

export function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}
