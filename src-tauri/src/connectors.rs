//! Local MCP (Model Context Protocol) connectors over stdio.
//! Every tool call requires explicit user approval in the UI.

use crate::db::{get_setting, set_setting, Db};
use crate::models::*;
use crate::AppState;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot};

pub type ApprovalRegistry =
    Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>;

const CONNECTORS_KEY: &str = "app.connectors";
const MAX_TOOLS: usize = 32;

pub fn load_configs(db: &Db) -> Vec<ConnectorConfig> {
    let conn = db.conn.lock().unwrap();
    get_setting(&conn, CONNECTORS_KEY)
        .and_then(|raw| serde_json::from_str::<Vec<ConnectorConfig>>(&raw).ok())
        .unwrap_or_default()
}

fn save_configs(db: &Db, configs: &[ConnectorConfig]) -> Result<(), String> {
    let raw = serde_json::to_string(configs).map_err(|e| e.to_string())?;
    let conn = db.conn.lock().unwrap();
    set_setting(&conn, CONNECTORS_KEY, &raw)
}

fn truncate_chars(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

fn is_sensitive_key(raw: &str) -> bool {
    let key = raw
        .trim_matches(|c| {
            matches!(
                c,
                '"' | '\'' | '-' | ':' | '{' | '}' | '[' | ']' | ',' | ' '
            )
        })
        .to_lowercase();
    [
        "token",
        "api_key",
        "apikey",
        "api-key",
        "key",
        "secret",
        "password",
        "passwd",
        "authorization",
        "auth",
        "bearer",
    ]
    .iter()
    .any(|part| key == *part || key.ends_with(&format!("_{part}")) || key.ends_with(&format!("-{part}")))
}

fn looks_like_secret(token: &str) -> bool {
    let lower = token.to_lowercase();
    if ["sk-", "ghp_", "github_pat_", "glpat-", "xoxb-", "xoxp-"]
        .iter()
        .any(|prefix| lower.starts_with(prefix))
    {
        return true;
    }
    let digits = token.chars().filter(|c| c.is_ascii_digit()).count();
    let letters = token.chars().filter(|c| c.is_ascii_alphabetic()).count();
    token.len() >= 32
        && digits >= 4
        && letters >= 4
        && !token.contains('/')
        && !token.contains('\\')
        && !token.contains('.')
}

/// Redacts credentials that a child process may print to stderr or echo in an
/// error. This is intentionally applied before any text reaches the UI.
pub(crate) fn redact_sensitive(text: &str) -> String {
    text.split('\n')
        .map(|line| {
            let mut out = String::new();
            let mut mask_next = false;
            for (index, token) in line.split_whitespace().enumerate() {
                if index > 0 {
                    out.push(' ');
                }
                if mask_next {
                    out.push_str("***");
                    mask_next = token.to_lowercase().starts_with("bearer");
                    continue;
                }
                let assignment = token
                    .split_once('=')
                    .map(|(key, value)| ("=", key, value))
                    .or_else(|| {
                        token
                            .split_once(':')
                            .map(|(key, value)| (":", key, value))
                    });
                if let Some((separator, key, value)) = assignment {
                    if is_sensitive_key(key) {
                        out.push_str(key);
                        out.push_str(separator);
                        out.push_str("***");
                        if value.is_empty() {
                            mask_next = true;
                        }
                        continue;
                    }
                }
                if is_sensitive_key(token) {
                    out.push_str(token);
                    mask_next = true;
                    continue;
                }
                if looks_like_secret(token) {
                    out.push_str("***");
                    continue;
                }
                out.push_str(token);
            }
            out
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn sanitize_name(raw: &str, max: usize) -> String {
    let mut out: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    while out.contains("__") {
        out = out.replace("__", "_");
    }
    out = out.trim_matches('_').to_string();
    if out.is_empty() {
        out = "tool".into();
    }
    out.chars().take(max).collect()
}

fn build_process_command(config: &ConnectorConfig) -> Command {
    #[cfg(windows)]
    {
        let lower = config.command.to_lowercase();
        let needs_shell = lower.ends_with(".cmd")
            || lower.ends_with(".bat")
            || matches!(
                lower.as_str(),
                "npx" | "npm" | "pnpm" | "yarn" | "bun" | "uvx"
            );
        let mut cmd = if needs_shell {
            let mut c = Command::new("cmd");
            c.arg("/C").arg(&config.command);
            c
        } else {
            Command::new(&config.command)
        };
        cmd.args(&config.args);
        // CREATE_NO_WINDOW: MCP servers should not flash a console window.
        cmd.creation_flags(0x0800_0000);
        cmd
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new(&config.command);
        cmd.args(&config.args);
        cmd
    }
}

#[derive(Clone, Debug)]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

pub struct ToolCallOutput {
    pub text: String,
    pub is_error: bool,
}

pub struct McpClient {
    pub name: String,
    out: mpsc::UnboundedSender<String>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_id: AtomicU64,
    alive: Arc<AtomicBool>,
    child: tokio::sync::Mutex<Child>,
    tools: Mutex<Vec<McpTool>>,
    stderr_tail: Arc<Mutex<Vec<String>>>,
}

impl McpClient {
    pub async fn start(config: &ConnectorConfig) -> Result<Arc<Self>, String> {
        let mut command = build_process_command(config);
        command
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|e| format!("无法启动连接器: {e}"))?;
        let stdin = child.stdin.take().ok_or("无法打开连接器输入流")?;
        let stdout = child.stdout.take().ok_or("无法打开连接器输出流")?;
        let stderr = child.stderr.take();
        let alive = Arc::new(AtomicBool::new(true));
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let (out, mut out_rx) = mpsc::unbounded_channel::<String>();

        tokio::spawn(async move {
            let mut stdin = stdin;
            while let Some(mut line) = out_rx.recv().await {
                line.push('\n');
                if stdin.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
                if stdin.flush().await.is_err() {
                    break;
                }
            }
        });

        let stderr_tail: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        if let Some(stderr) = stderr {
            let stderr_tail = stderr_tail.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.trim().is_empty() {
                        continue;
                    }
                    let mut tail = stderr_tail.lock().unwrap();
                    tail.push(line);
                    if tail.len() > 100 {
                        tail.remove(0);
                    }
                }
            });
        }

        {
            let pending = pending.clone();
            let alive = alive.clone();
            let out = out.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let Ok(value) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };
                    let id = value.get("id").and_then(|v| v.as_u64());
                    let Some(id) = id else { continue };
                    if value.get("method").is_some() {
                        // Server-initiated request; Mind supports only these basics.
                        let method = value.get("method").and_then(|m| m.as_str()).unwrap_or("");
                        let response = match method {
                            "ping" => json!({"jsonrpc": "2.0", "id": id, "result": {}}),
                            "roots/list" => {
                                json!({"jsonrpc": "2.0", "id": id, "result": {"roots": []}})
                            }
                            _ => json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "error": {"code": -32601, "message": "Method not supported by Mind"}
                            }),
                        };
                        let _ = out.send(response.to_string());
                    } else if let Some(tx) = pending.lock().unwrap().remove(&id) {
                        let _ = tx.send(value);
                    }
                }
                alive.store(false, Ordering::SeqCst);
                let mut map = pending.lock().unwrap();
                for (_, tx) in map.drain() {
                    let _ = tx.send(json!({"error": {"message": "连接器进程已退出"}}));
                }
            });
        }

        let client = Arc::new(Self {
            name: config.name.clone(),
            out,
            pending,
            next_id: AtomicU64::new(1),
            alive,
            child: tokio::sync::Mutex::new(child),
            tools: Mutex::new(Vec::new()),
            stderr_tail,
        });
        if let Err(error) = client.initialize().await {
            let tail = client
                .stderr_tail
                .lock()
                .unwrap()
                .iter()
                .rev()
                .take(14)
                .rev()
                .cloned()
                .collect::<Vec<_>>()
                .join("\n");
            client.stop().await;
            let error = redact_sensitive(&error);
            return Err(if tail.trim().is_empty() {
                error
            } else {
                format!("{error}\n{}", redact_sensitive(&tail))
            });
        }
        Ok(client)
    }

    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn notify(&self, method: &str, params: Value) {
        let message = json!({"jsonrpc": "2.0", "method": method, "params": params});
        let _ = self.out.send(message.to_string());
    }

    async fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        if !self.is_alive() {
            return Err("连接器已断开".into());
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel::<Value>();
        self.pending.lock().unwrap().insert(id, tx);
        let message = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        if self.out.send(message.to_string()).is_err() {
            self.pending.lock().unwrap().remove(&id);
            return Err("连接器已断开".into());
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(value)) => {
                if let Some(error) = value.get("error").filter(|v| !v.is_null()) {
                    let message = error
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("连接器返回了错误");
                    return Err(redact_sensitive(message));
                }
                Ok(value.get("result").cloned().unwrap_or(Value::Null))
            }
            Ok(Err(_)) => Err("连接器已断开".into()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!("连接器请求超时: {method}"))
            }
        }
    }

    async fn initialize(&self) -> Result<(), String> {
        self.request(
            "initialize",
            json!({
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "Mind", "version": env!("CARGO_PKG_VERSION")}
            }),
            Duration::from_secs(20),
        )
        .await?;
        self.notify("notifications/initialized", json!({}));
        self.refresh_tools().await
    }

    async fn refresh_tools(&self) -> Result<(), String> {
        let mut tools: Vec<McpTool> = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..10 {
            let params = cursor
                .as_ref()
                .map(|c| json!({"cursor": c}))
                .unwrap_or_else(|| json!({}));
            let result = self
                .request("tools/list", params, Duration::from_secs(20))
                .await?;
            if let Some(items) = result.get("tools").and_then(|t| t.as_array()) {
                for item in items {
                    let Some(name) = item.get("name").and_then(|n| n.as_str()) else {
                        continue;
                    };
                    let description = item
                        .get("description")
                        .and_then(|d| d.as_str())
                        .unwrap_or("")
                        .to_string();
                    let mut schema = item
                        .get("inputSchema")
                        .or_else(|| item.get("input_schema"))
                        .cloned()
                        .unwrap_or_else(|| json!({"type": "object", "properties": {}}));
                    if !schema.is_object() {
                        schema = json!({"type": "object", "properties": {}});
                    }
                    tools.push(McpTool {
                        name: name.to_string(),
                        description,
                        input_schema: schema,
                    });
                }
            }
            cursor = result
                .get("nextCursor")
                .and_then(|c| c.as_str())
                .map(|s| s.to_string());
            if cursor.is_none() {
                break;
            }
        }
        *self.tools.lock().unwrap() = tools;
        Ok(())
    }

    pub fn tools(&self) -> Vec<McpTool> {
        self.tools.lock().unwrap().clone()
    }

    pub async fn call_tool(
        &self,
        name: &str,
        arguments: Value,
    ) -> Result<ToolCallOutput, String> {
        let result = self
            .request(
                "tools/call",
                json!({"name": name, "arguments": arguments}),
                Duration::from_secs(120),
            )
            .await;
        match result {
            Ok(value) => Ok(convert_tool_result(&value)),
            Err(error) => {
                // A hung server would otherwise block every later call.
                // Kill it; ConnectorManager restarts it on the next request.
                if error.contains("请求超时") {
                    self.stop().await;
                }
                Err(error)
            }
        }
    }

    pub async fn stop(&self) {
        let mut child = self.child.lock().await;
        let _ = child.kill().await;
        self.alive.store(false, Ordering::SeqCst);
    }
}

fn convert_tool_result(result: &Value) -> ToolCallOutput {
    let is_error = result
        .get("isError")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let mut parts: Vec<String> = Vec::new();
    if let Some(content) = result.get("content").and_then(|c| c.as_array()) {
        for item in content {
            match item.get("type").and_then(|t| t.as_str()) {
                Some("text") => {
                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                        parts.push(text.to_string());
                    }
                }
                Some("image") => parts.push("[图片内容已省略]".into()),
                Some("resource") => {
                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                        parts.push(text.to_string());
                    } else if let Some(uri) = item.get("uri").and_then(|u| u.as_str()) {
                        parts.push(format!("[资源: {uri}]"));
                    }
                }
                _ => {
                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                        parts.push(text.to_string());
                    }
                }
            }
        }
    } else if let Some(text) = result.as_str() {
        parts.push(text.to_string());
    }
    let mut text = parts.join("\n");
    if text.trim().is_empty() {
        text = if is_error {
            "工具执行出错".into()
        } else {
            "工具执行完成，没有返回文本内容。".into()
        };
    }
    ToolCallOutput {
        text: truncate_chars(&text, 30_000),
        is_error,
    }
}

struct Entry {
    client: Option<Arc<McpClient>>,
    error: Option<String>,
    connecting: bool,
    config: ConnectorConfig,
}

pub struct ConnectorManager {
    inner: tokio::sync::Mutex<HashMap<String, Entry>>,
}

impl Default for ConnectorManager {
    fn default() -> Self {
        Self {
            inner: tokio::sync::Mutex::new(HashMap::new()),
        }
    }
}

impl ConnectorManager {
    pub async fn ensure(&self, config: &ConnectorConfig) -> Result<Arc<McpClient>, String> {
        let id = &config.id;
        let mut starter = false;
        {
            let mut map = self.inner.lock().await;
            match map.get_mut(id) {
                Some(entry) => {
                    entry.config = config.clone();
                    if let Some(client) = &entry.client {
                        if client.is_alive() {
                            return Ok(client.clone());
                        }
                    }
                    if !entry.connecting {
                        entry.connecting = true;
                        starter = true;
                    }
                }
                None => {
                    map.insert(
                        id.clone(),
                        Entry {
                            client: None,
                            error: None,
                            connecting: true,
                            config: config.clone(),
                        },
                    );
                    starter = true;
                }
            }
        }

        if !starter {
            for _ in 0..300 {
                tokio::time::sleep(Duration::from_millis(100)).await;
                let map = self.inner.lock().await;
                if let Some(entry) = map.get(id) {
                    if let Some(client) = &entry.client {
                        if client.is_alive() {
                            return Ok(client.clone());
                        }
                    }
                    if !entry.connecting {
                        return Err(entry
                            .error
                            .clone()
                            .unwrap_or_else(|| "连接器连接失败".into()));
                    }
                }
            }
            return Err("连接器连接超时".into());
        }

        let result = McpClient::start(config).await;
        let mut map = self.inner.lock().await;
        let entry = map.entry(id.clone()).or_insert(Entry {
            client: None,
            error: None,
            connecting: false,
            config: config.clone(),
        });
        entry.connecting = false;
        entry.config = config.clone();
        match result {
            Ok(client) => {
                entry.client = Some(client.clone());
                entry.error = None;
                Ok(client)
            }
            Err(error) => {
                entry.client = None;
                entry.error = Some(error.clone());
                Err(error)
            }
        }
    }

    pub async fn status(&self, config: &ConnectorConfig) -> ConnectorInfo {
        let map = self.inner.lock().await;
        let entry = map.get(&config.id);
        let connected = entry
            .and_then(|e| e.client.as_ref())
            .map(|c| c.is_alive())
            .unwrap_or(false);
        let connecting = entry.map(|e| e.connecting).unwrap_or(false);
        let error = entry.and_then(|e| e.error.clone()).or_else(|| {
            if entry.and_then(|e| e.client.as_ref()).is_some() && !connected {
                Some("连接器进程已退出，可点击「连接」重启。".to_string())
            } else {
                None
            }
        });
        let tools = entry
            .and_then(|e| e.client.as_ref())
            .filter(|c| c.is_alive())
            .map(|c| {
                c.tools()
                    .into_iter()
                    .map(|t| ConnectorToolInfo {
                        name: t.name,
                        description: truncate_chars(&t.description, 240),
                    })
                    .collect()
            })
            .unwrap_or_default();
        ConnectorInfo {
            config: config.clone(),
            connected,
            connecting,
            tools,
            error,
        }
    }

    pub async fn disconnect(&self, id: &str) {
        let client = {
            let mut map = self.inner.lock().await;
            map.remove(id).and_then(|entry| entry.client)
        };
        if let Some(client) = client {
            client.stop().await;
        }
    }

    pub async fn client(&self, id: &str) -> Option<Arc<McpClient>> {
        let map = self.inner.lock().await;
        map.get(id)
            .and_then(|e| e.client.as_ref())
            .filter(|c| c.is_alive())
            .cloned()
    }

    /// Returns a live client, restarting a crashed process once before a tool
    /// call begins. A call that already started is never retried: replaying it
    /// could duplicate a side effect.
    pub async fn client_or_restart(&self, id: &str) -> Option<Arc<McpClient>> {
        if let Some(client) = self.client(id).await {
            return Some(client);
        }
        let config = {
            let map = self.inner.lock().await;
            map.get(id).map(|entry| entry.config.clone())
        }?;
        self.ensure(&config).await.ok()
    }

    pub async fn connect_all(self: &Arc<Self>, configs: Vec<ConnectorConfig>) {
        let mut tasks = Vec::new();
        for config in configs
            .into_iter()
            .filter(|c| c.enabled && c.trusted)
        {
            let manager = self.clone();
            tasks.push(tokio::spawn(async move {
                let _ = manager.ensure(&config).await;
            }));
        }
        for task in tasks {
            let _ = task.await;
        }
    }
}

#[derive(Clone)]
pub enum ToolBackend {
    Mcp {
        connector_id: String,
        tool_name: String,
    },
    GitHub,
}

#[derive(Clone)]
pub struct ToolRoute {
    pub connector_name: String,
    pub tool_name: String,
    pub backend: ToolBackend,
}

pub struct ToolBundle {
    pub defs: Vec<Value>,
    pub routes: HashMap<String, ToolRoute>,
}

pub async fn build_tool_bundle(
    manager: &Arc<ConnectorManager>,
    configs: &[ConnectorConfig],
) -> ToolBundle {
    let mut defs: Vec<Value> = Vec::new();
    let mut routes: HashMap<String, ToolRoute> = HashMap::new();

    for config in configs.iter().filter(|c| c.enabled && c.trusted) {
        let Ok(client) = manager.ensure(config).await else {
            continue;
        };
        let prefix = sanitize_name(&config.name, 24);
        for tool in client.tools() {
            if defs.len() >= MAX_TOOLS {
                break;
            }
            let tool_part = sanitize_name(&tool.name, 64usize.saturating_sub(prefix.len() + 6).max(1));
            let mut exposed = format!("{prefix}__{tool_part}");
            let mut suffix = 2;
            while routes.contains_key(&exposed) || defs.iter().any(|d| {
                d.pointer("/function/name").and_then(|n| n.as_str()) == Some(exposed.as_str())
            }) {
                exposed = format!("{prefix}__{tool_part}_{suffix}");
                suffix += 1;
            }
            routes.insert(
                exposed.clone(),
                ToolRoute {
                    connector_name: config.name.clone(),
                    tool_name: tool.name.clone(),
                    backend: ToolBackend::Mcp {
                        connector_id: config.id.clone(),
                        tool_name: tool.name.clone(),
                    },
                },
            );
            defs.push(json!({
                "type": "function",
                "function": {
                    "name": exposed,
                    "description": truncate_chars(&tool.description, 1024),
                    "parameters": tool.input_schema
                }
            }));
        }
    }

    ToolBundle { defs, routes }
}

// ----------------------------------------------------------------- commands

async fn probe_runtime(command: &str, args: &[&str]) -> Option<String> {
    #[cfg(windows)]
    let mut cmd = {
        let lower = command.to_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            let mut c = Command::new("cmd");
            c.arg("/C").arg(command);
            c
        } else {
            Command::new(command)
        }
    };
    #[cfg(not(windows))]
    let mut cmd = Command::new(command);
    cmd.args(args);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let output = tokio::time::timeout(Duration::from_secs(6), cmd.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text.chars().take(80).collect())
    }
}

#[tauri::command]
pub async fn runtime_check() -> RuntimeInfo {
    let node_version = probe_runtime("node", &["--version"]).await;
    let npx_version = probe_runtime("npx.cmd", &["--version"])
        .await
        .or(probe_runtime("npx", &["--version"]).await);
    let uvx_version = probe_runtime("uvx", &["--version"]).await;
    RuntimeInfo {
        node: node_version.is_some(),
        npx: npx_version.is_some(),
        uvx: uvx_version.is_some(),
        node_version,
        uvx_version,
    }
}

#[tauri::command]
pub async fn connectors_get(state: State<'_, AppState>) -> Result<Vec<ConnectorInfo>, String> {
    let configs = load_configs(&state.db);
    let mut infos = Vec::new();
    for config in configs {
        infos.push(state.connectors.status(&config).await);
    }
    Ok(infos)
}

fn validate(config: &ConnectorConfig) -> Result<ConnectorConfig, String> {
    let name = config.name.trim();
    let command = config.command.trim();
    if name.is_empty() {
        return Err("请填写连接器名称".into());
    }
    if command.is_empty() {
        return Err("请填写启动命令".into());
    }
    let args = config
        .args
        .iter()
        .map(|a| a.trim().to_string())
        .filter(|a| !a.is_empty())
        .collect::<Vec<_>>();
    Ok(ConnectorConfig {
        id: config.id.clone(),
        name: name.to_string(),
        command: command.to_string(),
        args,
        enabled: config.enabled,
        trusted: config.trusted,
    })
}

#[tauri::command]
pub async fn connector_save(
    state: State<'_, AppState>,
    config: ConnectorConfig,
) -> Result<ConnectorInfo, String> {
    let mut config = validate(&config)?;
    if config.id.trim().is_empty() {
        config.id = uuid::Uuid::new_v4().to_string();
    }
    let mut configs = load_configs(&state.db);
    let previous = configs.iter().find(|c| c.id == config.id).cloned();
    let changed = previous
        .as_ref()
        .map(|p| p.command != config.command || p.args != config.args)
        .unwrap_or(true);
    if changed {
        // A changed command must be reviewed again, even when the old entry
        // was trusted. The UI confirms the exact command before saving.
        config.trusted = false;
    }
    match configs.iter_mut().find(|c| c.id == config.id) {
        Some(existing) => *existing = config.clone(),
        None => configs.push(config.clone()),
    }
    save_configs(&state.db, &configs)?;

    if changed || !config.enabled || !config.trusted {
        state.connectors.disconnect(&config.id).await;
    }
    if config.enabled && config.trusted {
        let _ = state.connectors.ensure(&config).await;
    }
    Ok(state.connectors.status(&config).await)
}

#[tauri::command]
pub async fn connector_set_trusted(
    state: State<'_, AppState>,
    id: String,
    trusted: bool,
) -> Result<ConnectorInfo, String> {
    let mut configs = load_configs(&state.db);
    let Some(config) = configs.iter_mut().find(|c| c.id == id) else {
        return Err("连接器不存在".into());
    };
    config.trusted = trusted;
    let config = config.clone();
    save_configs(&state.db, &configs)?;
    if !trusted {
        state.connectors.disconnect(&config.id).await;
    } else if config.enabled {
        let _ = state.connectors.ensure(&config).await;
    }
    Ok(state.connectors.status(&config).await)
}

#[tauri::command]
pub async fn connector_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut configs = load_configs(&state.db);
    configs.retain(|c| c.id != id);
    save_configs(&state.db, &configs)?;
    state.connectors.disconnect(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn connector_set_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<ConnectorInfo, String> {
    let mut configs = load_configs(&state.db);
    let Some(config) = configs.iter_mut().find(|c| c.id == id) else {
        return Err("连接器不存在".into());
    };
    config.enabled = enabled;
    let config = config.clone();
    save_configs(&state.db, &configs)?;
    if enabled && config.trusted {
        let _ = state.connectors.ensure(&config).await;
    } else {
        state.connectors.disconnect(&config.id).await;
    }
    Ok(state.connectors.status(&config).await)
}

#[tauri::command]
pub async fn connector_test(config: ConnectorConfig) -> Result<Vec<ConnectorToolInfo>, String> {
    let config = validate(&config)?;
    let client = McpClient::start(&config).await?;
    let tools = client
        .tools()
        .into_iter()
        .map(|t| ConnectorToolInfo {
            name: t.name,
            description: truncate_chars(&t.description, 240),
        })
        .collect();
    client.stop().await;
    Ok(tools)
}

#[tauri::command]
pub async fn connectors_connect_all(state: State<'_, AppState>) -> Result<(), String> {
    let configs = load_configs(&state.db);
    let manager = state.connectors.clone();
    tauri::async_runtime::spawn(async move {
        manager.connect_all(configs).await;
    });
    Ok(())
}

#[tauri::command]
pub fn connector_approve(
    state: State<'_, AppState>,
    approval_id: String,
    approved: bool,
) -> Result<(), String> {
    if let Some(tx) = state.approvals.lock().unwrap().remove(&approval_id) {
        let _ = tx.send(approved);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_common_credentials_from_child_output() {
        let text = "starting with --token abc123\n\
                    Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789\n\
                    api_key=sk-secret-value\n\
                    token: colon-secret\n\
                    {\"token\":\"json-secret\"}\n\
                    server started on port 8080";
        let redacted = redact_sensitive(text);
        assert!(!redacted.contains("abc123"), "{redacted}");
        assert!(
            !redacted.contains("ghp_abcdefghijklmnopqrstuvwxyz0123456789"),
            "{redacted}"
        );
        assert!(!redacted.contains("sk-secret-value"), "{redacted}");
        assert!(!redacted.contains("colon-secret"), "{redacted}");
        assert!(!redacted.contains("json-secret"), "{redacted}");
        assert!(redacted.contains("--token ***"), "{redacted}");
        assert!(redacted.contains("api_key=***"), "{redacted}");
        assert!(redacted.contains("port 8080"), "{redacted}");
    }

    #[test]
    fn legacy_connector_is_trusted_and_explicit_false_is_kept() {
        let legacy: ConnectorConfig = serde_json::from_str(
            r#"{"id":"c1","name":"旧插件","command":"npx","args":[],"enabled":true}"#,
        )
        .unwrap();
        assert!(legacy.trusted);

        let explicit: ConnectorConfig = serde_json::from_str(
            r#"{"id":"c2","name":"新插件","command":"npx","args":[],"enabled":true,"trusted":false}"#,
        )
        .unwrap();
        assert!(!explicit.trusted);
    }
}
