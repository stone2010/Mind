export interface Conversation {
  id: string;
  title: string;
  modelId?: string | null;
  projectId?: string | null;
  pinned: boolean;
  archived: boolean;
  summary?: string | null;
  summaryUpto?: number;
  createdAt: number;
  updatedAt: number;
}

export type MessageStatus = "streaming" | "complete" | "stopped" | "error";

export interface Attachment {
  name: string;
  size: number;
  mime: string;
  kind: "text" | "image";
  text?: string;
  dataUrl?: string;
  truncated?: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string | null;
  attachments?: string | null;
  status: MessageStatus;
  feedback?: number | null;
  modelId?: string | null;
  sources?: string | null;
  serverToolCalls?: string | null;
  connectorCalls?: string | null;
  createdAt: number;
}

export interface ConnectorConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
}

export interface ConnectorToolInfo {
  name: string;
  description: string;
}

export interface ConnectorInfo {
  config: ConnectorConfig;
  connected: boolean;
  connecting: boolean;
  tools: ConnectorToolInfo[];
  error?: string | null;
}

export type ConnectorCallStatus = "pending" | "running" | "done" | "error" | "denied";

export interface ConnectorCall {
  requestId: string;
  callId: string;
  server: string;
  tool: string;
  status: ConnectorCallStatus;
  arguments?: unknown;
  result?: string | null;
  error?: string | null;
}

export interface ApprovalRequest {
  approvalId: string;
  requestId: string;
  server: string;
  tool: string;
  arguments: unknown;
}

export interface SearchSource {
  url: string;
  title: string;
  snippet?: string;
  siteName?: string;
  siteIcon?: string | null;
  publishedAt?: string | null;
}

export interface SearchUpdate {
  status: "searching" | "sources" | "error";
  queries?: string[];
  sources?: SearchSource[];
  error?: string;
  serverToolCalls?: unknown;
}

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  createdAt: number;
  updatedAt: number;
  conversationCount: number;
}

export interface Memory {
  id: string;
  content: string;
  source: "manual" | "auto";
  sourceConversationId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ModelConfig {
  id: string;
  label: string;
  supportsThinking: boolean;
  supportsVision: boolean;
  supportsWebSearch?: boolean | null;
  temperature?: number | null;
  maxTokens?: number | null;
}

export interface ProviderConfig {
  id: string;
  name: string;
  kind: "deepseek" | "openai-compatible";
  baseUrl: string;
  models: ModelConfig[];
  isBuiltin?: boolean;
}

export interface ChatTurn {
  role: string;
  content: string;
  images: string[];
  reasoning?: string | null;
  serverToolCalls?: unknown;
}

export interface ChatRequest {
  requestId: string;
  providerId: string;
  modelId: string;
  messages: ChatTurn[];
  thinking: boolean;
  webSearch: boolean;
  connectors: boolean;
  memories: string[];
  demo: boolean;
  temperature?: number | null;
  maxTokens?: number | null;
  contextTokens: number;
  summary?: string | null;
  systemPrompt?: string | null;
}

export interface ProviderError {
  code: string;
  message: string;
  detail?: string;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  error?: ProviderError;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
}

export interface ModelPrice {
  peakInput: number;
  peakOutput: number;
  offpeakInput: number;
  offpeakOutput: number;
}

export interface CompressResult {
  summary: string;
  usage?: TokenUsage;
}

export interface GithubInfo {
  enabled: boolean;
  connected: boolean;
  login?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  baseUrl: string;
}

export interface RuntimeInfo {
  node: boolean;
  npx: boolean;
  uvx: boolean;
  nodeVersion?: string;
  uvxVersion?: string;
}

export interface ExportResult {
  path: string;
  conversations: number;
  messages: number;
  projects: number;
  memories: number;
  usage: number;
}

export interface ImportResult {
  conversations: number;
  messages: number;
  projects: number;
  memories: number;
  usage: number;
  replaced: boolean;
}

export interface UsageLogEntry {
  id: string;
  conversationId?: string | null;
  messageId?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  kind: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  createdAt: number;
}

export interface ChatEvent {
  requestId: string;
  kind: "reasoning" | "content" | "usage" | "search" | "connector" | "done" | "error";
  delta?: string;
  finishReason?: string;
  usage?: TokenUsage;
  search?: SearchUpdate;
  connector?: ConnectorCall;
  error?: ProviderError;
  cancelled?: boolean;
}

export interface SearchHit {
  conversationId: string;
  title: string;
  snippet: string;
  kind: "title" | "message";
}

export interface AppInfo {
  version: string;
  dataDir: string;
  dbPath: string;
}

export type Theme = "light" | "dark" | "system";

export interface AppSettings {
  theme: Theme;
  providerId: string;
  modelId: string;
  thinking: boolean;
  webSearch: boolean;
  connectors: boolean;
  contextTokens: number;
  autoCompress: boolean;
  autoMemory: boolean;
  usageEnabled: boolean;
  usdCnyRate: number;
  modelPrices: Record<string, ModelPrice>;
  legalAccepted: string;
  demoMode: boolean;
  onboarded: boolean;
  sidebarCollapsed: boolean;
  clarify: boolean;
  visualHints: boolean;
  customInstructions?: string;
  /** 聊天娱乐模式总开关：默认 false，关闭时连选项都不出现 */
  chatMode: boolean;
  /** 聊天娱乐模式是否已被用户确认过风险（避免重复弹窗） */
  chatModeAck: boolean;
  /** 跨对话长期记忆总开关（是否注入记忆到对话） */
  longTermMemory: boolean;
  /** 记忆注入模式：recall = 按当前问题挑相关记忆（省 token）；recent = 注入最近记忆 */
  memoryRecall: "recall" | "recent";
  /** 设置迁移版本；v2 起自动记忆默认开启，且不再受“注入记忆”开关影响 */
  memoryVersion: number;
  /** 旧版字段，仅用于设置迁移，勿再使用 */
  useMemory?: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  providerId: "deepseek",
  modelId: "deepseek-flash",
  thinking: false,
  webSearch: false,
  connectors: true,
  contextTokens: 100000,
  autoCompress: true,
  autoMemory: true,
  usageEnabled: true,
  usdCnyRate: 6.6793,
  modelPrices: {},
  legalAccepted: "",
  demoMode: false,
  onboarded: false,
  sidebarCollapsed: false,
  clarify: true,
  visualHints: true,
  customInstructions: "",
  chatMode: false,
  chatModeAck: false,
  longTermMemory: true,
  memoryRecall: "recent",
  memoryVersion: 2,
};
