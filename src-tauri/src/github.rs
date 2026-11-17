//! Built-in, read-only GitHub integration.
//! The PAT lives only in Windows Credential Manager; tool calls still require
//! explicit approval in the chat UI.

use crate::connectors::ToolCallOutput;
use crate::credentials;
use crate::db::{get_setting, set_setting, Db};
use crate::models::GithubInfo;
use crate::providers::client;
use crate::AppState;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

const SETTINGS_KEY: &str = "app.github";
const DEFAULT_BASE: &str = "https://api.github.com";
const PREFIX: &str = "github__";
const MAX_OUTPUT: usize = 20_000;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct GithubSettings {
    #[serde(default)]
    enabled: bool,
    #[serde(default = "default_base")]
    base_url: String,
    #[serde(default)]
    login: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    avatar_url: Option<String>,
}

fn default_base() -> String {
    DEFAULT_BASE.to_string()
}

impl Default for GithubSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: default_base(),
            login: None,
            name: None,
            avatar_url: None,
        }
    }
}

#[derive(Clone)]
pub struct GithubContext {
    base_url: String,
    token: String,
}

fn load_settings(db: &Db) -> GithubSettings {
    let conn = db.conn.lock().unwrap();
    get_setting(&conn, SETTINGS_KEY)
        .and_then(|raw| serde_json::from_str::<GithubSettings>(&raw).ok())
        .unwrap_or_default()
}

fn save_settings(db: &Db, settings: &GithubSettings) -> Result<(), String> {
    let raw = serde_json::to_string(settings).map_err(|e| e.to_string())?;
    let conn = db.conn.lock().unwrap();
    set_setting(&conn, SETTINGS_KEY, &raw)
}

fn info(settings: &GithubSettings) -> GithubInfo {
    GithubInfo {
        enabled: settings.enabled,
        connected: credentials::has_github_token(),
        login: settings.login.clone(),
        name: settings.name.clone(),
        avatar_url: settings.avatar_url.clone(),
        base_url: settings.base_url.clone(),
    }
}

pub fn load_context(db: &Db) -> Option<GithubContext> {
    let settings = load_settings(db);
    if !settings.enabled {
        return None;
    }
    let token = credentials::get_github_token()?;
    Some(GithubContext {
        base_url: settings.base_url,
        token,
    })
}

fn normalize_base(value: Option<&str>) -> Result<String, String> {
    let base = value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(DEFAULT_BASE)
        .trim_end_matches('/')
        .to_string();
    if !base.starts_with("http://") && !base.starts_with("https://") {
        return Err("GitHub API 地址必须以 http:// 或 https:// 开头".into());
    }
    Ok(base)
}

fn encode_segment(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn encode_path(path: &str) -> String {
    path.trim_matches('/')
        .split('/')
        .map(encode_segment)
        .collect::<Vec<_>>()
        .join("/")
}

fn clip(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

fn arg_str(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| format!("缺少参数 {key}"))
}

fn repo_args(args: &Value) -> Result<(String, String), String> {
    Ok((arg_str(args, "owner")?, arg_str(args, "repo")?))
}

fn arg_limit(args: &Value, default: usize, max: usize) -> usize {
    args.get("limit")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize)
        .unwrap_or(default)
        .clamp(1, max)
}

fn github_error(status: u16, body: &str) -> String {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| value.get("message")?.as_str().map(ToString::to_string))
        .unwrap_or_else(|| clip(body.trim(), 240));
    match status {
        401 => "GitHub Token 无效或已过期，请重新连接。".into(),
        403 if body.to_lowercase().contains("rate limit") => {
            "GitHub API 速率限制已用尽，请稍后再试。".into()
        }
        403 => format!("GitHub 拒绝了这次请求，Token 可能缺少所需权限。{message}"),
        404 => "GitHub 资源不存在，或当前 Token 没有访问权限。".into(),
        422 => format!("GitHub 参数无效：{message}"),
        _ => format!("GitHub API 请求失败（{status}）：{message}"),
    }
}

async fn api_request(
    base_url: &str,
    token: &str,
    method: reqwest::Method,
    path: &str,
    query: &[(String, String)],
    body: Option<&Value>,
) -> Result<Value, String> {
    let url = format!("{}{}", base_url.trim_end_matches('/'), path);
    let mut request = client()
        .request(method, url)
        .bearer_auth(token)
        .header("User-Agent", "Mind/0.1.0")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if !query.is_empty() {
        request = request.query(query);
    }
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = tokio::time::timeout(Duration::from_secs(30), request.send())
        .await
        .map_err(|_| "GitHub 请求超时，请检查网络。".to_string())?
        .map_err(|e| format!("无法连接 GitHub：{e}"))?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(github_error(status, &text));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| format!("无法解析 GitHub 响应：{e}"))
}

async fn fetch_user(settings: &GithubSettings, token: &str) -> Result<Value, String> {
    api_request(
        &settings.base_url,
        token,
        reqwest::Method::GET,
        "/user",
        &[],
        None,
    )
    .await
}

fn apply_user(settings: &mut GithubSettings, user: &Value) -> Result<(), String> {
    let login = user
        .get("login")
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "GitHub 没有返回账号信息".to_string())?
        .to_string();
    settings.login = Some(login);
    settings.name = user
        .get("name")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);
    settings.avatar_url = user
        .get("avatar_url")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);
    Ok(())
}

#[tauri::command]
pub fn github_get(state: State<'_, AppState>) -> Result<GithubInfo, String> {
    Ok(info(&load_settings(&state.db)))
}

#[tauri::command]
pub async fn github_connect(
    state: State<'_, AppState>,
    token: String,
    base_url: Option<String>,
) -> Result<GithubInfo, String> {
    let token = token.trim();
    if token.len() < 8 || token.contains(char::is_whitespace) {
        return Err("GitHub Token 格式看起来不正确，请检查是否完整复制。".into());
    }
    let mut settings = load_settings(&state.db);
    settings.base_url = normalize_base(base_url.as_deref())?;
    settings.enabled = true;
    let user = fetch_user(&settings, token).await?;
    apply_user(&mut settings, &user)?;
    credentials::save_github_token(token)?;
    save_settings(&state.db, &settings)?;
    Ok(info(&settings))
}

#[tauri::command]
pub async fn github_test(state: State<'_, AppState>) -> Result<GithubInfo, String> {
    let token = credentials::get_github_token()
        .ok_or_else(|| "GitHub 尚未连接，请先填写 Token。".to_string())?;
    let mut settings = load_settings(&state.db);
    let user = fetch_user(&settings, &token).await?;
    apply_user(&mut settings, &user)?;
    save_settings(&state.db, &settings)?;
    Ok(info(&settings))
}

#[tauri::command]
pub fn github_disconnect(state: State<'_, AppState>) -> Result<GithubInfo, String> {
    credentials::delete_github_token()?;
    let mut settings = load_settings(&state.db);
    settings.enabled = false;
    settings.login = None;
    settings.name = None;
    settings.avatar_url = None;
    save_settings(&state.db, &settings)?;
    Ok(info(&settings))
}

#[tauri::command]
pub fn github_set_enabled(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<GithubInfo, String> {
    if enabled && !credentials::has_github_token() {
        return Err("请先填写 GitHub Token 并完成连接。".into());
    }
    let mut settings = load_settings(&state.db);
    settings.enabled = enabled;
    save_settings(&state.db, &settings)?;
    Ok(info(&settings))
}

struct ToolDef {
    name: &'static str,
    description: &'static str,
    schema: Value,
}

fn tools() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "search_repositories",
            description: "在 GitHub 搜索仓库，返回名称、描述、Star、语言和链接。适合先找到相关项目。",
            schema: json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "GitHub 搜索关键词，例如 rust tauri"},
                    "limit": {"type": "integer", "description": "返回条数，1-10", "minimum": 1, "maximum": 10}
                },
                "required": ["query"]
            }),
        },
        ToolDef {
            name: "list_repositories",
            description: "列出当前 GitHub 账号可访问的仓库，按最近更新排序。",
            schema: json!({
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "返回条数，1-20", "minimum": 1, "maximum": 20}
                }
            }),
        },
        ToolDef {
            name: "get_repository",
            description: "读取一个 GitHub 仓库的基本信息：描述、默认分支、Star、语言、开放 Issue 数。",
            schema: json!({
                "type": "object",
                "properties": {
                    "owner": {"type": "string", "description": "仓库所有者"},
                    "repo": {"type": "string", "description": "仓库名"}
                },
                "required": ["owner", "repo"]
            }),
        },
        ToolDef {
            name: "list_issues",
            description: "列出仓库的 Issue（不包含 Pull Request），返回编号、标题、状态、作者和标签。",
            schema: json!({
                "type": "object",
                "properties": {
                    "owner": {"type": "string"},
                    "repo": {"type": "string"},
                    "state": {"type": "string", "enum": ["open", "closed", "all"]},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 30}
                },
                "required": ["owner", "repo"]
            }),
        },
        ToolDef {
            name: "list_pull_requests",
            description: "列出仓库的 Pull Request，返回编号、标题、状态、是否草稿和更新时间。",
            schema: json!({
                "type": "object",
                "properties": {
                    "owner": {"type": "string"},
                    "repo": {"type": "string"},
                    "state": {"type": "string", "enum": ["open", "closed", "all"]},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 30}
                },
                "required": ["owner", "repo"]
            }),
        },
        ToolDef {
            name: "read_file",
            description: "读取仓库中的文件内容（文本，最多 20000 字符），或列出目录中的文件。",
            schema: json!({
                "type": "object",
                "properties": {
                    "owner": {"type": "string"},
                    "repo": {"type": "string"},
                    "path": {"type": "string", "description": "文件或目录路径，例如 README.md 或 src/"},
                    "ref": {"type": "string", "description": "可选的分支、标签或提交 SHA"}
                },
                "required": ["owner", "repo", "path"]
            }),
        },
    ]
}

pub fn definitions() -> Vec<(String, Value)> {
    tools()
        .into_iter()
        .map(|tool| {
            let exposed = format!("{PREFIX}{}", tool.name);
            (
                tool.name.to_string(),
                json!({
                    "type": "function",
                    "function": {
                        "name": exposed,
                        "description": tool.description,
                        "parameters": tool.schema
                    }
                }),
            )
        })
        .collect()
}

fn repo_summary(item: &Value) -> Value {
    json!({
        "full_name": item.get("full_name").and_then(|v| v.as_str()),
        "description": item.get("description").and_then(|v| v.as_str()),
        "private": item.get("private").and_then(|v| v.as_bool()),
        "language": item.get("language").and_then(|v| v.as_str()),
        "stars": item.get("stargazers_count").and_then(|v| v.as_u64()),
        "updated_at": item.get("updated_at").and_then(|v| v.as_str()),
        "url": item.get("html_url").and_then(|v| v.as_str())
    })
}

fn issue_summary(item: &Value) -> Value {
    json!({
        "number": item.get("number").and_then(|v| v.as_u64()),
        "title": item.get("title").and_then(|v| v.as_str()),
        "state": item.get("state").and_then(|v| v.as_str()),
        "author": item.pointer("/user/login").and_then(|v| v.as_str()),
        "labels": item.get("labels").and_then(|v| v.as_array()).map(|labels| {
            labels.iter().filter_map(|l| l.get("name").and_then(|v| v.as_str())).collect::<Vec<_>>()
        }),
        "comments": item.get("comments").and_then(|v| v.as_u64()),
        "created_at": item.get("created_at").and_then(|v| v.as_str()),
        "url": item.get("html_url").and_then(|v| v.as_str())
    })
}

fn pr_summary(item: &Value) -> Value {
    json!({
        "number": item.get("number").and_then(|v| v.as_u64()),
        "title": item.get("title").and_then(|v| v.as_str()),
        "state": item.get("state").and_then(|v| v.as_str()),
        "draft": item.get("draft").and_then(|v| v.as_bool()),
        "author": item.pointer("/user/login").and_then(|v| v.as_str()),
        "updated_at": item.get("updated_at").and_then(|v| v.as_str()),
        "url": item.get("html_url").and_then(|v| v.as_str())
    })
}

fn output(value: Value) -> ToolCallOutput {
    let text = serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string());
    ToolCallOutput {
        text: clip(&text, MAX_OUTPUT),
        is_error: false,
    }
}

pub async fn call_tool(
    context: &GithubContext,
    name: &str,
    args: Value,
) -> Result<ToolCallOutput, String> {
    let base = &context.base_url;
    let token = &context.token;
    match name {
        "search_repositories" => {
            let query = arg_str(&args, "query")?;
            let limit = arg_limit(&args, 5, 10);
            let value = api_request(
                base,
                token,
                reqwest::Method::GET,
                "/search/repositories",
                &[
                    ("q".into(), query),
                    ("per_page".into(), limit.to_string()),
                    ("sort".into(), "stars".into()),
                    ("order".into(), "desc".into()),
                ],
                None,
            )
            .await?;
            let items = value
                .get("items")
                .and_then(|v| v.as_array())
                .map(|items| items.iter().take(limit).map(repo_summary).collect::<Vec<_>>())
                .unwrap_or_default();
            Ok(output(json!({"count": items.len(), "items": items})))
        }
        "list_repositories" => {
            let limit = arg_limit(&args, 10, 20);
            let value = api_request(
                base,
                token,
                reqwest::Method::GET,
                "/user/repos",
                &[
                    ("per_page".into(), limit.to_string()),
                    ("sort".into(), "updated".into()),
                    (
                        "affiliation".into(),
                        "owner,collaborator,organization_member".into(),
                    ),
                ],
                None,
            )
            .await?;
            let items = value
                .as_array()
                .map(|items| items.iter().take(limit).map(repo_summary).collect::<Vec<_>>())
                .unwrap_or_default();
            Ok(output(json!({"count": items.len(), "items": items})))
        }
        "get_repository" => {
            let (owner, repo) = repo_args(&args)?;
            let path = format!(
                "/repos/{}/{}",
                encode_segment(&owner),
                encode_segment(&repo)
            );
            let value = api_request(base, token, reqwest::Method::GET, &path, &[], None).await?;
            let summary = json!({
                "full_name": value.get("full_name").and_then(|v| v.as_str()),
                "description": value.get("description").and_then(|v| v.as_str()),
                "private": value.get("private").and_then(|v| v.as_bool()),
                "default_branch": value.get("default_branch").and_then(|v| v.as_str()),
                "language": value.get("language").and_then(|v| v.as_str()),
                "stars": value.get("stargazers_count").and_then(|v| v.as_u64()),
                "forks": value.get("forks_count").and_then(|v| v.as_u64()),
                "open_issues": value.get("open_issues_count").and_then(|v| v.as_u64()),
                "topics": value.get("topics").and_then(|v| v.as_array()),
                "url": value.get("html_url").and_then(|v| v.as_str())
            });
            Ok(output(summary))
        }
        "list_issues" => {
            let (owner, repo) = repo_args(&args)?;
            let state = args
                .get("state")
                .and_then(|v| v.as_str())
                .filter(|v| ["open", "closed", "all"].contains(v))
                .unwrap_or("open");
            let limit = arg_limit(&args, 10, 30);
            let path = format!(
                "/repos/{}/{}/issues",
                encode_segment(&owner),
                encode_segment(&repo)
            );
            let value = api_request(
                base,
                token,
                reqwest::Method::GET,
                &path,
                &[
                    ("state".into(), state.into()),
                    ("per_page".into(), (limit * 2).min(60).to_string()),
                    ("sort".into(), "updated".into()),
                ],
                None,
            )
            .await?;
            let items = value
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter(|item| item.get("pull_request").is_none())
                        .take(limit)
                        .map(issue_summary)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Ok(output(json!({"count": items.len(), "items": items})))
        }
        "list_pull_requests" => {
            let (owner, repo) = repo_args(&args)?;
            let state = args
                .get("state")
                .and_then(|v| v.as_str())
                .filter(|v| ["open", "closed", "all"].contains(v))
                .unwrap_or("open");
            let limit = arg_limit(&args, 10, 30);
            let path = format!(
                "/repos/{}/{}/pulls",
                encode_segment(&owner),
                encode_segment(&repo)
            );
            let value = api_request(
                base,
                token,
                reqwest::Method::GET,
                &path,
                &[
                    ("state".into(), state.into()),
                    ("per_page".into(), limit.to_string()),
                    ("sort".into(), "updated".into()),
                ],
                None,
            )
            .await?;
            let items = value
                .as_array()
                .map(|items| items.iter().take(limit).map(pr_summary).collect::<Vec<_>>())
                .unwrap_or_default();
            Ok(output(json!({"count": items.len(), "items": items})))
        }
        "read_file" => {
            let (owner, repo) = repo_args(&args)?;
            let path_arg = arg_str(&args, "path")?;
            let path = format!(
                "/repos/{}/{}/contents/{}",
                encode_segment(&owner),
                encode_segment(&repo),
                encode_path(&path_arg)
            );
            let mut query: Vec<(String, String)> = Vec::new();
            if let Some(reference) = args
                .get("ref")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                query.push(("ref".into(), reference.to_string()));
            }
            let value =
                api_request(base, token, reqwest::Method::GET, &path, &query, None).await?;

            if let Some(items) = value.as_array() {
                let entries = items
                    .iter()
                    .take(200)
                    .map(|item| {
                        json!({
                            "name": item.get("name").and_then(|v| v.as_str()),
                            "path": item.get("path").and_then(|v| v.as_str()),
                            "type": item.get("type").and_then(|v| v.as_str()),
                            "size": item.get("size").and_then(|v| v.as_u64())
                        })
                    })
                    .collect::<Vec<_>>();
                return Ok(output(json!({
                    "type": "directory",
                    "path": path_arg,
                    "count": entries.len(),
                    "entries": entries
                })));
            }

            let encoded = value
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .replace(['\n', '\r'], "");
            let decoded = if encoded.is_empty() {
                String::new()
            } else {
                base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
                    .unwrap_or_default()
            };
            let content = clip(&decoded, 20_000);
            let truncated = decoded.chars().count() > content.chars().count();
            Ok(output(json!({
                "type": "file",
                "path": path_arg,
                "size": value.get("size").and_then(|v| v.as_u64()),
                "truncated": truncated,
                "content": content
            })))
        }
        _ => Err(format!("未知的 GitHub 工具: {name}")),
    }
}
