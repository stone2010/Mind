use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    pub pinned: bool,
    pub archived: bool,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub summary_upto: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub reasoning: Option<String>,
    /// JSON array of attachment metadata: [{name, size, mime, kind, dataUrl?}]
    #[serde(default)]
    pub attachments: Option<String>,
    pub status: String,
    #[serde(default)]
    pub feedback: Option<i64>,
    #[serde(default)]
    pub model_id: Option<String>,
    /// JSON array of search sources used by this reply.
    #[serde(default)]
    pub sources: Option<String>,
    /// Raw DeepSeek server_tool_calls JSON, needed to replay tool history.
    #[serde(default)]
    pub server_tool_calls: Option<String>,
    /// JSON array of connector tool calls made for this reply.
    #[serde(default)]
    pub connector_calls: Option<String>,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorToolInfo {
    pub name: String,
    pub description: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorInfo {
    pub config: ConnectorConfig,
    pub connected: bool,
    pub connecting: bool,
    pub tools: Vec<ConnectorToolInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorCallEvent {
    pub request_id: String,
    pub call_id: String,
    pub server: String,
    pub tool: String,
    /// "pending" | "running" | "done" | "error" | "denied"
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalEvent {
    pub approval_id: String,
    pub request_id: String,
    pub server: String,
    pub tool: String,
    pub arguments: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub conversation_count: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub id: String,
    pub content: String,
    /// "manual" | "auto"
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub source_conversation_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub supports_thinking: bool,
    #[serde(default)]
    pub supports_vision: bool,
    /// None means "not specified by an older config"; load_providers fills it.
    #[serde(default)]
    pub supports_web_search: Option<bool>,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    /// "deepseek" | "openai-compatible"
    pub kind: String,
    pub base_url: String,
    pub models: Vec<ModelConfig>,
    #[serde(default)]
    pub is_builtin: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurn {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub reasoning: Option<String>,
    #[serde(default)]
    pub server_tool_calls: Option<serde_json::Value>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub request_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub messages: Vec<ChatTurn>,
    #[serde(default)]
    pub thinking: bool,
    #[serde(default)]
    pub web_search: bool,
    #[serde(default)]
    pub connectors: bool,
    #[serde(default)]
    pub memories: Vec<String>,
    #[serde(default)]
    pub demo: bool,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    /// Approximate input token budget for history; 0 means the full history.
    #[serde(default)]
    pub context_tokens: u32,
    /// Rolling summary of older messages, generated by auto-compression.
    #[serde(default)]
    pub summary: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProviderError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl ProviderError {
    pub fn new(code: &str, message: &str, detail: Option<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            detail,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    pub latency_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ProviderError>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u32>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GithubInfo {
    pub enabled: bool,
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    pub base_url: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub node: bool,
    pub npx: bool,
    pub uvx: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uvx_version: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UsageLog {
    pub id: String,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub message_id: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub kind: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub created_at: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CompressResult {
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatEvent {
    pub request_id: String,
    /// "reasoning" | "content" | "usage" | "search" | "done" | "error"
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search: Option<SearchUpdate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connector: Option<ConnectorCallEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ProviderError>,
    #[serde(default)]
    pub cancelled: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchSource {
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub snippet: String,
    #[serde(default)]
    pub site_name: String,
    #[serde(default)]
    pub site_icon: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchUpdate {
    /// "searching" | "sources" | "error"
    pub status: String,
    #[serde(default)]
    pub queries: Vec<String>,
    #[serde(default)]
    pub sources: Vec<SearchSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Raw server_tool_calls, persisted so tool history can be replayed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_tool_calls: Option<serde_json::Value>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub conversation_id: String,
    pub title: String,
    pub snippet: String,
    /// "title" | "message"
    pub kind: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
    pub db_path: String,
}
