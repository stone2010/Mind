use crate::connectors::{
    self, ApprovalRegistry, ConnectorManager, ToolBackend, ToolBundle, ToolRoute,
};
use crate::credentials;
use crate::models::*;
use crate::providers::{client, endpoint, load_providers, map_reqwest_error};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::oneshot;
use uuid::Uuid;

pub type StreamRegistry = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;

fn emit(app: &tauri::AppHandle, event: ChatEvent) {
    let _ = app.emit("chat-event", event);
}

fn emit_delta(app: &tauri::AppHandle, request_id: &str, kind: &str, text: &str) {
    if text.is_empty() {
        return;
    }
    emit(
        app,
        ChatEvent {
            request_id: request_id.to_string(),
            kind: kind.to_string(),
            delta: Some(text.to_string()),
            finish_reason: None,
            usage: None,
            search: None,
            connector: None,
            error: None,
            cancelled: false,
        },
    );
}

fn emit_done(app: &tauri::AppHandle, request_id: &str, finish_reason: Option<String>, cancelled: bool) {
    emit(
        app,
        ChatEvent {
            request_id: request_id.to_string(),
            kind: "done".into(),
            delta: None,
            finish_reason,
            usage: None,
            search: None,
            connector: None,
            error: None,
            cancelled,
        },
    );
}

#[allow(clippy::too_many_arguments)]
fn emit_search(
    app: &tauri::AppHandle,
    request_id: &str,
    status: &str,
    queries: &[String],
    sources: &[SearchSource],
    error: Option<String>,
    server_tool_calls: Option<Value>,
) {
    emit(
        app,
        ChatEvent {
            request_id: request_id.to_string(),
            kind: "search".into(),
            delta: None,
            finish_reason: None,
            usage: None,
            search: Some(SearchUpdate {
                status: status.to_string(),
                queries: queries.to_vec(),
                sources: sources.to_vec(),
                error,
                server_tool_calls,
            }),
            connector: None,
            error: None,
            cancelled: false,
        },
    );
}

fn text_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string())
    })
}

fn source_from_value(value: &Value) -> Option<SearchSource> {
    let url = text_field(value, &["url"])?;
    Some(SearchSource {
        title: text_field(value, &["title"]).unwrap_or_else(|| url.clone()),
        snippet: text_field(value, &["snippet"]).unwrap_or_default(),
        site_name: text_field(value, &["site_name", "siteName"]).unwrap_or_default(),
        site_icon: text_field(value, &["site_icon", "siteIcon"]),
        published_at: text_field(value, &["published_at", "publishedAt"]),
        url,
    })
}

fn extract_sources(value: &Value) -> Vec<SearchSource> {
    value
        .as_array()
        .map(|items| items.iter().filter_map(source_from_value).collect())
        .unwrap_or_default()
}

fn merge_sources(acc: &mut Vec<SearchSource>, incoming: Vec<SearchSource>) {
    for source in incoming {
        if let Some(existing) = acc.iter_mut().find(|s| s.url == source.url) {
            if existing.title.is_empty() && !source.title.is_empty() {
                existing.title = source.title;
            }
            if existing.snippet.is_empty() && !source.snippet.is_empty() {
                existing.snippet = source.snippet;
            }
            if existing.site_name.is_empty() && !source.site_name.is_empty() {
                existing.site_name = source.site_name;
            }
            if existing.site_icon.is_none() {
                existing.site_icon = source.site_icon;
            }
            if existing.published_at.is_none() {
                existing.published_at = source.published_at;
            }
        } else {
            acc.push(source);
        }
    }
}

fn sources_from_tool_calls(value: &Value) -> Vec<SearchSource> {
    let mut out: Vec<SearchSource> = Vec::new();
    if let Some(steps) = value.as_array() {
        for step in steps {
            if let Some(calls) = step.get("calls").and_then(|c| c.as_array()) {
                for call in calls {
                    if let Some(sources) = call.get("sources") {
                        merge_sources(&mut out, extract_sources(sources));
                    }
                    if let Some(page) = call.get("page").filter(|p| p.is_object()) {
                        merge_sources(&mut out, extract_sources(&json!([page])));
                    }
                }
            }
        }
    }
    out
}

fn sources_from_annotations(value: &Value) -> Vec<SearchSource> {
    let mut out: Vec<SearchSource> = Vec::new();
    if let Some(items) = value.as_array() {
        for item in items {
            if let Some(citation) = item.get("url_citation").filter(|v| v.is_object()) {
                merge_sources(&mut out, extract_sources(&json!([citation])));
            } else {
                merge_sources(&mut out, extract_sources(&json!([item])));
            }
        }
    }
    out
}

fn tool_error(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(|s| s.to_string())
        .or_else(|| text_field(value, &["message", "detail", "code"]))
}

#[tauri::command]
pub async fn chat_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
    request: ChatRequest,
) -> Result<(), String> {
    let request_id = request.request_id.clone();
    if request.messages.is_empty() {
        return Err("消息内容为空".into());
    }

    let (provider, model) = if request.demo {
        (None, None)
    } else {
        let providers = load_providers(&state.db)?;
        let provider = providers
            .into_iter()
            .find(|p| p.id == request.provider_id)
            .ok_or_else(|| "找不到该模型提供商，请检查设置。".to_string())?;
        let model = provider
            .models
            .iter()
            .find(|m| m.id == request.model_id)
            .cloned()
            .ok_or_else(|| "找不到该模型，请检查设置。".to_string())?;
        (Some(provider), Some(model))
    };

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut streams = state.streams.lock().unwrap();
        streams.insert(request_id.clone(), cancel.clone());
    }
    let registry = state.streams.clone();
    let app_task = app.clone();
    let connector_configs = if request.connectors {
        connectors::load_configs(&state.db)
    } else {
        Vec::new()
    };
    let connector_manager = state.connectors.clone();
    let approvals = state.approvals.clone();
    let github_context = if request.connectors {
        crate::github::load_context(&state.db)
    } else {
        None
    };

    tauri::async_runtime::spawn(async move {
        let result = if request.demo {
            run_mock(&app_task, &request, &cancel).await
        } else {
            run_http(
                &app_task,
                &request,
                provider.as_ref().unwrap(),
                model.as_ref().unwrap(),
                &cancel,
                connector_configs,
                connector_manager,
                approvals,
                github_context,
            )
            .await
        };
        if let Err(err) = result {
            let was_cancelled = cancel.load(Ordering::Relaxed);
            emit(
                &app_task,
                ChatEvent {
                    request_id: request_id.clone(),
                    kind: "error".into(),
                    delta: None,
                    finish_reason: None,
                    usage: None,
                    search: None,
                    connector: None,
                    error: Some(err),
                    cancelled: was_cancelled,
                },
            );
            if was_cancelled {
                emit_done(&app_task, &request_id, Some("cancelled".into()), true);
            }
        }
        if let Ok(mut streams) = registry.lock() {
            streams.remove(&request_id);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn chat_cancel(state: tauri::State<'_, crate::AppState>, request_id: String) {
    if let Ok(streams) = state.streams.lock() {
        if let Some(flag) = streams.get(&request_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

fn is_cjk(ch: char) -> bool {
    matches!(
        ch,
        '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}'
    )
}

/// Deliberately conservative: CJK characters count as one token each,
/// other characters as a quarter token. Overestimating trims a little more
/// and is safer for cost than underestimating.
fn approx_tokens(text: &str) -> usize {
    let mut cjk = 0usize;
    let mut other = 0usize;
    for ch in text.chars() {
        if is_cjk(ch) {
            cjk += 1;
        } else {
            other += 1;
        }
    }
    cjk + (other + 3) / 4 + 4
}

fn message_tokens(value: &Value) -> usize {
    let mut tokens = 4;
    if let Some(content) = value.get("content") {
        match content {
            Value::String(text) => tokens += approx_tokens(text),
            Value::Array(parts) => {
                for part in parts {
                    if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                        tokens += approx_tokens(text);
                    }
                    if part.get("type").and_then(|t| t.as_str()) == Some("image_url") {
                        tokens += 1000;
                    }
                }
            }
            _ => {}
        }
    }
    if let Some(reasoning) = value.get("reasoning_content").and_then(|r| r.as_str()) {
        tokens += approx_tokens(reasoning);
    }
    if let Some(calls) = value.get("server_tool_calls") {
        if !calls.is_null() {
            tokens += approx_tokens(&calls.to_string());
        }
    }
    tokens
}

fn trim_history(turns: Vec<Value>, budget: usize) -> Vec<Value> {
    if budget == 0 || turns.is_empty() {
        return turns;
    }
    let mut total = 0usize;
    let mut start = turns.len();
    for index in (0..turns.len()).rev() {
        let cost = message_tokens(&turns[index]);
        // Always keep the newest message, even if it alone exceeds the budget.
        if total + cost > budget && index + 1 < turns.len() {
            break;
        }
        total += cost;
        start = index;
    }
    // A conversation should not begin with an orphan assistant answer.
    if let Some(pos) = (start..turns.len())
        .find(|&index| turns[index].get("role").and_then(|r| r.as_str()) == Some("user"))
    {
        start = pos;
    }
    turns.into_iter().skip(start).collect()
}

fn build_messages(request: &ChatRequest, model: &ModelConfig, use_tools: bool) -> Vec<Value> {
    let mut system_messages: Vec<Value> = Vec::new();
    let memory_cap = if request.context_tokens == 0 {
        1600
    } else {
        ((request.context_tokens as usize) / 4).clamp(200, 1200)
    };
    let mut memory_lines: Vec<String> = Vec::new();
    let mut used_chars = 0usize;
    for memory in &request.memories {
        if memory_lines.len() >= 12 || used_chars >= memory_cap {
            break;
        }
        let trimmed = memory.trim();
        if trimmed.is_empty() {
            continue;
        }
        let take = (memory_cap - used_chars).min(200);
        let piece: String = trimmed.chars().take(take).collect();
        if piece.trim().is_empty() {
            continue;
        }
        used_chars += piece.chars().count();
        memory_lines.push(format!("- {piece}"));
    }
    if !memory_lines.is_empty() {
        system_messages.push(json!({
            "role": "system",
            "content": format!(
                "以下是关于用户的长期记忆，回答时酌情参考，不要主动提及：\n{}",
                memory_lines.join("\n")
            )
        }));
    }
    if let Some(summary) = request.summary.as_deref().map(str::trim).filter(|s| !s.is_empty())
    {
        let clipped: String = summary.chars().take(2000).collect();
        system_messages.push(json!({
            "role": "system",
            "content": format!(
                "以下是本次对话较早内容的摘要，请结合它理解当前对话：\n{clipped}"
            )
        }));
    }

    let mut turns: Vec<Value> = Vec::new();
    for turn in &request.messages {
        if turn.role == "user" && !turn.images.is_empty() && model.supports_vision {
            let mut parts: Vec<Value> = Vec::new();
            if !turn.content.trim().is_empty() {
                parts.push(json!({"type": "text", "text": turn.content}));
            }
            for img in &turn.images {
                parts.push(json!({"type": "image_url", "image_url": {"url": img}}));
            }
            turns.push(json!({"role": "user", "content": parts}));
        } else if turn.role == "assistant" && use_tools {
            let mut message = json!({"role": "assistant", "content": turn.content});
            // Only tool-carrying assistant turns need their reasoning passed
            // back; sending reasoning for every old answer would waste tokens.
            if let Some(calls) = &turn.server_tool_calls {
                if !calls.is_null() {
                    if let Some(reasoning) = &turn.reasoning {
                        if !reasoning.trim().is_empty() {
                            message["reasoning_content"] = json!(reasoning);
                        }
                    }
                    message["server_tool_calls"] = calls.clone();
                }
            }
            turns.push(message);
        } else {
            turns.push(json!({"role": turn.role, "content": turn.content}));
        }
    }

    if request.context_tokens == 0 {
        let mut out = system_messages;
        out.extend(turns);
        return out;
    }

    let system_cost: usize = system_messages.iter().map(message_tokens).sum();
    let available = (request.context_tokens as usize).saturating_sub(system_cost).max(1);
    let mut out = system_messages;
    out.extend(trim_history(turns, available));
    out
}

#[allow(clippy::too_many_arguments)]
fn emit_connector(
    app: &tauri::AppHandle,
    request_id: &str,
    call_id: &str,
    server: &str,
    tool: &str,
    status: &str,
    arguments: Option<Value>,
    result: Option<String>,
    error: Option<String>,
) {
    emit(
        app,
        ChatEvent {
            request_id: request_id.to_string(),
            kind: "connector".into(),
            delta: None,
            finish_reason: None,
            usage: None,
            search: None,
            connector: Some(ConnectorCallEvent {
                request_id: request_id.to_string(),
                call_id: call_id.to_string(),
                server: server.to_string(),
                tool: tool.to_string(),
                status: status.to_string(),
                arguments,
                result,
                error,
            }),
            error: None,
            cancelled: false,
        },
    );
}

fn preview_text(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

#[derive(Default, Clone)]
struct ToolCallAcc {
    id: String,
    name: String,
    arguments: String,
}

struct RoundOutcome {
    content: String,
    reasoning: String,
    tool_calls: Vec<ToolCallAcc>,
    finish_reason: Option<String>,
    server_tool_calls: Option<Value>,
    cancelled: bool,
}

async fn wait_for_approval(
    rx: oneshot::Receiver<bool>,
    cancel: &Arc<AtomicBool>,
) -> bool {
    let mut rx = Box::pin(rx);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(180);
    loop {
        if cancel.load(Ordering::Relaxed) {
            return false;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        match tokio::time::timeout(Duration::from_millis(300), &mut rx).await {
            Ok(Ok(value)) => return value,
            Ok(Err(_)) => return false,
            Err(_) => {}
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn stream_round(
    app: &tauri::AppHandle,
    request: &ChatRequest,
    provider: &ProviderConfig,
    model: &ModelConfig,
    cancel: &Arc<AtomicBool>,
    messages: &[Value],
    tools: &[Value],
    thinking: bool,
    api_key: &str,
    search_sources: &mut Vec<SearchSource>,
    search_queries: &mut Vec<String>,
    emitted_search: &mut bool,
) -> Result<RoundOutcome, ProviderError> {
    let mut body = json!({
        "model": model.id,
        "messages": messages,
        "stream": true
    });
    let use_web_search = tools
        .iter()
        .any(|t| t.get("type").and_then(|v| v.as_str()) == Some("deepseek_web_search"));

    if provider.kind == "deepseek" {
        body["thinking"] = json!({"type": if thinking { "enabled" } else { "disabled" }});
        body["stream_options"] = json!({"include_usage": true});
    }
    if !thinking {
        if let Some(t) = request.temperature.or(model.temperature) {
            body["temperature"] = json!(t);
        }
    }
    if let Some(mt) = request.max_tokens.or(model.max_tokens) {
        body["max_tokens"] = json!(mt);
    }
    if !tools.is_empty() {
        body["tools"] = json!(tools);
    }

    let url = endpoint(&provider.base_url);
    let response = client()
        .post(&url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let text = response.text().await.unwrap_or_default();
        return Err(crate::providers::map_http_error(status, &text));
    }

    let mut stream = response.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let mut finish_reason: Option<String> = None;
    let mut saw_done = false;
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut tool_calls: Vec<ToolCallAcc> = Vec::new();
    let mut server_tool_calls: Option<Value> = None;

    loop {
        if cancel.load(Ordering::Relaxed) {
            emit_done(app, &request.request_id, Some("cancelled".into()), true);
            return Ok(RoundOutcome {
                content,
                reasoning,
                tool_calls,
                finish_reason,
                server_tool_calls,
                cancelled: true,
            });
        }
        let next = tokio::time::timeout(Duration::from_millis(250), stream.next()).await;
        let chunk = match next {
            Err(_) => continue,
            Ok(None) => break,
            Ok(Some(Err(e))) => return Err(map_reqwest_error(e)),
            Ok(Some(Ok(c))) => c,
        };
        buf.extend_from_slice(&chunk);

        loop {
            let Some(pos) = buf.iter().position(|&b| b == b'\n') else {
                break;
            };
            let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            let line = line.trim();
            if line.is_empty() || line.starts_with(':') {
                continue;
            }
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                saw_done = true;
                break;
            }
            let Ok(value) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            if let Some(err) = value.get("error").filter(|v| !v.is_null()) {
                let detail = err
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown error")
                    .to_string();
                return Err(ProviderError::new(
                    "server",
                    "生成过程中服务返回了错误，请稍后再试。",
                    Some(detail),
                ));
            }
            if let Some(choices) = value.get("choices").and_then(|c| c.as_array()) {
                for choice in choices {
                    if let Some(reason) = choice.get("finish_reason").and_then(|f| f.as_str()) {
                        if !reason.is_empty() {
                            finish_reason = Some(reason.to_string());
                        }
                    }
                    let delta = &choice["delta"];

                    if let Some(event) = choice
                        .get("server_tool_event")
                        .filter(|v| v.is_object())
                        .or_else(|| delta.get("server_tool_event").filter(|v| v.is_object()))
                    {
                        let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        let call = event.get("call").unwrap_or(&Value::Null);
                        match event_type {
                            "call_started" => {
                                if let Some(queries) = call
                                    .get("action")
                                    .and_then(|a| a.get("queries"))
                                    .and_then(|q| q.as_array())
                                {
                                    for query in queries {
                                        if let Some(query) = query.as_str() {
                                            let query = query.trim();
                                            if !query.is_empty()
                                                && !search_queries.iter().any(|q| q == query)
                                            {
                                                search_queries.push(query.to_string());
                                            }
                                        }
                                    }
                                }
                                emit_search(
                                    app,
                                    &request.request_id,
                                    "searching",
                                    search_queries.as_slice(),
                                    search_sources.as_slice(),
                                    None,
                                    None,
                                );
                                *emitted_search = true;
                            }
                            "call_completed" => {
                                if let Some(sources) = call.get("sources") {
                                    merge_sources(search_sources, extract_sources(sources));
                                }
                                if let Some(page) = call.get("page").filter(|p| p.is_object()) {
                                    merge_sources(
                                        search_sources,
                                        extract_sources(&json!([page])),
                                    );
                                }
                                let error = call
                                    .get("error")
                                    .filter(|v| !v.is_null())
                                    .and_then(tool_error);
                                emit_search(
                                    app,
                                    &request.request_id,
                                    if error.is_some() { "error" } else { "sources" },
                                    search_queries.as_slice(),
                                    search_sources.as_slice(),
                                    error,
                                    None,
                                );
                                *emitted_search = true;
                            }
                            _ => {}
                        }
                    }

                    if let Some(reasoning_delta) =
                        delta.get("reasoning_content").and_then(|v| v.as_str())
                    {
                        reasoning.push_str(reasoning_delta);
                        emit_delta(app, &request.request_id, "reasoning", reasoning_delta);
                    }
                    if let Some(content_delta) = delta.get("content").and_then(|v| v.as_str()) {
                        content.push_str(content_delta);
                        emit_delta(app, &request.request_id, "content", content_delta);
                    }

                    if let Some(calls) = delta.get("tool_calls").and_then(|c| c.as_array()) {
                        for call in calls {
                            let index = call
                                .get("index")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0) as usize;
                            while tool_calls.len() <= index {
                                tool_calls.push(ToolCallAcc::default());
                            }
                            let acc = &mut tool_calls[index];
                            if let Some(id) = call.get("id").and_then(|v| v.as_str()) {
                                if !id.is_empty() {
                                    acc.id = id.to_string();
                                }
                            }
                            if let Some(function) = call.get("function") {
                                if let Some(name) = function.get("name").and_then(|v| v.as_str()) {
                                    if !name.is_empty() {
                                        acc.name = name.to_string();
                                    }
                                }
                                if let Some(arguments) =
                                    function.get("arguments").and_then(|v| v.as_str())
                                {
                                    acc.arguments.push_str(arguments);
                                }
                            }
                        }
                    }

                    let server_calls = delta
                        .get("server_tool_calls")
                        .filter(|v| !v.is_null())
                        .or_else(|| choice.get("server_tool_calls").filter(|v| !v.is_null()));
                    if let Some(calls) = server_calls {
                        server_tool_calls = Some(calls.clone());
                        merge_sources(search_sources, sources_from_tool_calls(calls));
                    }

                    let annotations = delta
                        .get("annotations")
                        .filter(|v| !v.is_null())
                        .or_else(|| choice.get("annotations").filter(|v| !v.is_null()));
                    if let Some(annotations) = annotations {
                        merge_sources(
                            search_sources,
                            sources_from_annotations(annotations),
                        );
                    }

                    if server_tool_calls.is_some() || annotations.is_some() {
                        emit_search(
                            app,
                            &request.request_id,
                            "sources",
                            search_queries.as_slice(),
                            search_sources.as_slice(),
                            None,
                            server_tool_calls.clone(),
                        );
                        *emitted_search = true;
                    }
                }
            }
            if let Some(usage) = value.get("usage").filter(|u| !u.is_null()) {
                let u = Usage {
                    prompt_tokens: usage
                        .get("prompt_tokens")
                        .and_then(|v| v.as_u64())
                        .map(|v| v as u32),
                    completion_tokens: usage
                        .get("completion_tokens")
                        .and_then(|v| v.as_u64())
                        .map(|v| v as u32),
                    total_tokens: usage
                        .get("total_tokens")
                        .and_then(|v| v.as_u64())
                        .map(|v| v as u32),
                };
                emit(
                    app,
                    ChatEvent {
                        request_id: request.request_id.clone(),
                        kind: "usage".into(),
                        delta: None,
                        finish_reason: None,
                        usage: Some(u),
                        search: None,
                        connector: None,
                        error: None,
                        cancelled: false,
                    },
                );
            }
        }
        if saw_done {
            break;
        }
    }

    if use_web_search
        && (*emitted_search || !search_sources.is_empty() || server_tool_calls.is_some())
    {
        emit_search(
            app,
            &request.request_id,
            "sources",
            search_queries.as_slice(),
            search_sources.as_slice(),
            None,
            server_tool_calls.clone(),
        );
    }

    for call in tool_calls.iter_mut() {
        if call.id.trim().is_empty() {
            call.id = format!("call_{}", Uuid::new_v4());
        }
    }
    tool_calls.retain(|c| !c.name.trim().is_empty());

    Ok(RoundOutcome {
        content,
        reasoning,
        tool_calls,
        finish_reason,
        server_tool_calls,
        cancelled: false,
    })
}

#[allow(clippy::too_many_arguments)]
async fn run_http(
    app: &tauri::AppHandle,
    request: &ChatRequest,
    provider: &ProviderConfig,
    model: &ModelConfig,
    cancel: &Arc<AtomicBool>,
    connector_configs: Vec<ConnectorConfig>,
    connector_manager: Arc<ConnectorManager>,
    approvals: ApprovalRegistry,
    github_context: Option<crate::github::GithubContext>,
) -> Result<(), ProviderError> {
    let api_key = credentials::get_api_key(&provider.id).ok_or_else(|| {
        ProviderError::new(
            "invalid_key",
            "尚未配置 API Key，请先在设置中连接模型。",
            None,
        )
    })?;

    let thinking = request.thinking && model.supports_thinking;
    let use_web_search = request.web_search
        && provider.kind == "deepseek"
        && model.supports_web_search.unwrap_or(false);

    let mut tool_bundle = if connector_configs.is_empty() {
        ToolBundle {
            defs: Vec::new(),
            routes: HashMap::new(),
        }
    } else {
        connectors::build_tool_bundle(&connector_manager, &connector_configs).await
    };
    if github_context.is_some() {
        for (name, definition) in crate::github::definitions() {
            let exposed = definition
                .pointer("/function/name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            if exposed.is_empty() {
                continue;
            }
            tool_bundle.routes.insert(
                exposed,
                ToolRoute {
                    connector_name: "GitHub".into(),
                    tool_name: name,
                    backend: ToolBackend::GitHub,
                },
            );
            tool_bundle.defs.push(definition);
        }
    }
    let mut tools = tool_bundle.defs.clone();
    if use_web_search {
        tools.push(json!({"type": "deepseek_web_search"}));
    }
    let use_tools_for_history = use_web_search || !tool_bundle.defs.is_empty();
    let mut messages = build_messages(request, model, use_tools_for_history);

    let mut search_sources: Vec<SearchSource> = Vec::new();
    let mut search_queries: Vec<String> = Vec::new();
    let mut emitted_search = false;
    let mut last_finish: Option<String> = None;
    let mut final_server_tool_calls: Option<Value> = None;
    let max_rounds = 4usize;

    for round in 0..=max_rounds {
        if cancel.load(Ordering::Relaxed) {
            emit_done(app, &request.request_id, Some("cancelled".into()), true);
            return Ok(());
        }
        let outcome = stream_round(
            app,
            request,
            provider,
            model,
            cancel,
            &messages,
            &tools,
            thinking,
            &api_key,
            &mut search_sources,
            &mut search_queries,
            &mut emitted_search,
        )
        .await?;
        if outcome.cancelled {
            return Ok(());
        }
        if outcome.finish_reason.is_some() {
            last_finish = outcome.finish_reason.clone();
        }
        if let Some(calls) = &outcome.server_tool_calls {
            final_server_tool_calls = Some(calls.clone());
        }
        if outcome.tool_calls.is_empty() {
            break;
        }
        if round == max_rounds {
            emit_delta(
                app,
                &request.request_id,
                "content",
                "\n\n已达到工具调用次数上限，已停止继续调用。",
            );
            break;
        }

        let mut assistant = json!({"role": "assistant", "content": outcome.content});
        if provider.kind == "deepseek" && !outcome.reasoning.trim().is_empty() {
            assistant["reasoning_content"] = json!(outcome.reasoning);
        }
        if let Some(calls) = &outcome.server_tool_calls {
            assistant["server_tool_calls"] = calls.clone();
        }
        let calls_json = outcome
            .tool_calls
            .iter()
            .map(|call| {
                json!({
                    "id": call.id,
                    "type": "function",
                    "function": {"name": call.name, "arguments": call.arguments}
                })
            })
            .collect::<Vec<_>>();
        assistant["tool_calls"] = json!(calls_json);
        messages.push(assistant);

        for call in &outcome.tool_calls {
            if cancel.load(Ordering::Relaxed) {
                emit_done(app, &request.request_id, Some("cancelled".into()), true);
                return Ok(());
            }
            let route = tool_bundle.routes.get(&call.name).cloned();
            let args: Value = serde_json::from_str(if call.arguments.trim().is_empty() {
                "{}"
            } else {
                call.arguments.as_str()
            })
            .unwrap_or_else(|_| json!({}));
            let (server, tool_name) = match &route {
                Some(route) => (route.connector_name.clone(), route.tool_name.clone()),
                None => ("未知连接器".to_string(), call.name.clone()),
            };

            emit_connector(
                app,
                &request.request_id,
                &call.id,
                &server,
                &tool_name,
                "pending",
                Some(args.clone()),
                None,
                None,
            );

            let Some(route) = route else {
                let error = format!("找不到工具: {}", call.name);
                emit_connector(
                    app,
                    &request.request_id,
                    &call.id,
                    &server,
                    &tool_name,
                    "error",
                    Some(args),
                    None,
                    Some(error.clone()),
                );
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": format!("Tool error: {error}")
                }));
                continue;
            };

            let approval_id = Uuid::new_v4().to_string();
            let (tx, rx) = oneshot::channel::<bool>();
            approvals
                .lock()
                .unwrap()
                .insert(approval_id.clone(), tx);
            let _ = app.emit(
                "connector-approval",
                ApprovalEvent {
                    approval_id: approval_id.clone(),
                    request_id: request.request_id.clone(),
                    server: server.clone(),
                    tool: tool_name.clone(),
                    arguments: args.clone(),
                },
            );
            let approved = wait_for_approval(rx, cancel).await;
            approvals.lock().unwrap().remove(&approval_id);

            if !approved {
                if cancel.load(Ordering::Relaxed) {
                    emit_done(app, &request.request_id, Some("cancelled".into()), true);
                    return Ok(());
                }
                emit_connector(
                    app,
                    &request.request_id,
                    &call.id,
                    &server,
                    &tool_name,
                    "denied",
                    Some(args),
                    None,
                    Some("用户拒绝了这个工具调用".into()),
                );
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": "用户拒绝了这个工具调用。不要重试，直接基于已有信息回答。"
                }));
                continue;
            }

            if cancel.load(Ordering::Relaxed) {
                emit_done(app, &request.request_id, Some("cancelled".into()), true);
                return Ok(());
            }

            emit_connector(
                app,
                &request.request_id,
                &call.id,
                &server,
                &tool_name,
                "running",
                Some(args.clone()),
                None,
                None,
            );

            let output = match &route.backend {
                ToolBackend::Mcp {
                    connector_id,
                    tool_name,
                } => match connector_manager.client(connector_id).await {
                    Some(client) => client.call_tool(tool_name, args.clone()).await,
                    None => Err("连接器未连接".into()),
                },
                ToolBackend::GitHub => match &github_context {
                    Some(context) => {
                        crate::github::call_tool(context, &route.tool_name, args.clone()).await
                    }
                    None => Err("GitHub 尚未连接".into()),
                },
            };
            match output {
                Ok(output) => {
                    let status = if output.is_error { "error" } else { "done" };
                    emit_connector(
                        app,
                        &request.request_id,
                        &call.id,
                        &server,
                        &tool_name,
                        status,
                        Some(args),
                        Some(preview_text(&output.text, 4000)),
                        if output.is_error {
                            Some("工具返回了错误".into())
                        } else {
                            None
                        },
                    );
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": output.text
                    }));
                }
                Err(error) => {
                    emit_connector(
                        app,
                        &request.request_id,
                        &call.id,
                        &server,
                        &tool_name,
                        "error",
                        Some(args),
                        None,
                        Some(error.clone()),
                    );
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": format!("Tool error: {error}")
                    }));
                }
            }
        }
    }

    if use_web_search
        && (emitted_search
            || !search_sources.is_empty()
            || final_server_tool_calls.is_some())
    {
        emit_search(
            app,
            &request.request_id,
            "sources",
            search_queries.as_slice(),
            search_sources.as_slice(),
            None,
            final_server_tool_calls,
        );
    }

    emit_done(app, &request.request_id, last_finish, false);
    Ok(())
}

const MOCK_REASONING: &str = "用户正在演示模式中。我应该说明当前是模拟回复，并展示聊天界面支持的内容格式。保持简洁、友好，不要假装自己是真实模型。";

const MOCK_ANSWER: &str = r#"这是一条**演示回复**，当前会话没有连接真实模型，因此不会产生任何费用。

Mind 的聊天界面支持：

- Markdown 渲染、代码高亮与表格
- 行内公式 $E = mc^2$ 与独立公式
- 流式输出，并且随时可以停止

```python
def greet(name: str) -> str:
    return f"你好，{name}！"
```

| 能力 | 状态 |
| --- | --- |
| DeepSeek 真实接入 | 已支持 |
| 本地历史记录 | 已保存 |

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

在「设置 → 模型连接」中填写 DeepSeek API Key，就能获得真实回复。"#;

async fn run_mock(
    app: &tauri::AppHandle,
    request: &ChatRequest,
    cancel: &Arc<AtomicBool>,
) -> Result<(), ProviderError> {
    let sleep = |ms: u64| tokio::time::sleep(Duration::from_millis(ms));

    if request.thinking {
        for chunk in split_chunks(MOCK_REASONING, 4) {
            if cancel.load(Ordering::Relaxed) {
                emit_done(app, &request.request_id, Some("cancelled".into()), true);
                return Ok(());
            }
            emit_delta(app, &request.request_id, "reasoning", &chunk);
            sleep(18).await;
        }
    }

    for chunk in split_chunks(MOCK_ANSWER, 3) {
        if cancel.load(Ordering::Relaxed) {
            emit_done(app, &request.request_id, Some("cancelled".into()), true);
            return Ok(());
        }
        emit_delta(app, &request.request_id, "content", &chunk);
        sleep(22).await;
    }

    emit_done(app, &request.request_id, Some("stop".into()), false);
    Ok(())
}

fn split_chunks(text: &str, size: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    chars
        .chunks(size)
        .map(|c| c.iter().collect::<String>())
        .collect()
}

#[cfg(test)]
mod context_tests {
    use super::*;

    fn test_model() -> ModelConfig {
        ModelConfig {
            id: "test".into(),
            label: "Test".into(),
            supports_thinking: false,
            supports_vision: false,
            supports_web_search: Some(false),
            temperature: None,
            max_tokens: None,
        }
    }

    fn test_request(messages: Vec<ChatTurn>, context_tokens: u32) -> ChatRequest {
        ChatRequest {
            request_id: "test-request".into(),
            provider_id: "test-provider".into(),
            model_id: "test-model".into(),
            messages,
            thinking: false,
            web_search: false,
            connectors: false,
            memories: Vec::new(),
            demo: false,
            temperature: None,
            max_tokens: None,
            context_tokens,
            summary: None,
        }
    }

    fn test_turn(role: &str, content: &str) -> ChatTurn {
        ChatTurn {
            role: role.into(),
            content: content.into(),
            images: Vec::new(),
            reasoning: None,
            server_tool_calls: None,
        }
    }

    #[test]
    fn approximate_tokens_are_conservative_for_chinese() {
        assert!(approx_tokens("你好世界") >= 8);
        assert!(
            approx_tokens("你好世界") > approx_tokens("hello world"),
            "CJK text should not be estimated more cheaply than ASCII"
        );
    }

    #[test]
    fn trim_history_keeps_latest_user_and_stays_within_budget() {
        let mut turns = Vec::new();
        for index in 0..21 {
            let role = if index % 2 == 0 { "user" } else { "assistant" };
            turns.push(json!({"role": role, "content": "字".repeat(100)}));
        }
        let total_before: usize = turns.iter().map(message_tokens).sum();
        assert!(total_before > 1000);

        let trimmed = trim_history(turns, 300);
        assert_eq!(trimmed.last().and_then(|m| m["role"].as_str()), Some("user"));
        assert_eq!(
            trimmed.first().and_then(|m| m["role"].as_str()),
            Some("user"),
            "trimmed history must not start with an orphan assistant answer"
        );
        let total_after: usize = trimmed.iter().map(message_tokens).sum();
        assert!(total_after <= 300);
    }

    #[test]
    fn zero_budget_keeps_everything() {
        let turns = vec![
            json!({"role": "user", "content": "a"}),
            json!({"role": "assistant", "content": "b"}),
        ];
        assert_eq!(trim_history(turns.clone(), 0).len(), 2);
        let request = test_request(vec![test_turn("user", "a"), test_turn("assistant", "b")], 0);
        assert_eq!(build_messages(&request, &test_model(), false).len(), 2);
    }

    #[test]
    fn build_messages_applies_context_budget() {
        let messages = (0..31)
            .map(|index| {
                let role = if index % 2 == 0 { "user" } else { "assistant" };
                test_turn(role, &"上下文".repeat(40))
            })
            .collect();
        let request = test_request(messages, 600);
        let out = build_messages(&request, &test_model(), false);
        assert_eq!(out.last().and_then(|m| m["role"].as_str()), Some("user"));
        assert_eq!(out.first().and_then(|m| m["role"].as_str()), Some("user"));
        let total: usize = out.iter().map(message_tokens).sum();
        assert!(total <= 600, "estimated input was {total} tokens");
    }

    #[test]
    fn summary_is_injected_before_history() {
        let mut request = test_request(vec![test_turn("user", "hello")], 8000);
        request.summary = Some("earlier conversation summary".into());
        let out = build_messages(&request, &test_model(), false);
        assert_eq!(out[0]["role"].as_str(), Some("system"));
        assert!(out[0]["content"]
            .as_str()
            .unwrap_or_default()
            .contains("earlier conversation summary"));
        assert_eq!(out[1]["role"].as_str(), Some("user"));
    }

    #[test]
    fn memory_injection_is_capped() {
        let mut request = test_request(vec![test_turn("user", "hi")], 8000);
        request.memories = (0..15)
            .map(|index| format!("记忆{index}：{}", "内容".repeat(150)))
            .collect();
        let out = build_messages(&request, &test_model(), false);
        let system = out.first().expect("memory system message");
        assert_eq!(system["role"].as_str(), Some("system"));
        let content = system["content"].as_str().unwrap_or_default();
        assert!(content.chars().count() <= 1400);
        assert!(content.matches("- ").count() <= 12);
    }

    #[test]
    fn reasoning_is_only_replayed_for_tool_turns() {
        let mut plain = test_turn("assistant", "answer");
        plain.reasoning = Some("unused private reasoning".into());
        let out = build_messages(&test_request(vec![plain], 8000), &test_model(), true);
        assert!(out[0].get("reasoning_content").is_none());

        let mut with_tool = test_turn("assistant", "answer");
        with_tool.reasoning = Some("needed for tool history".into());
        with_tool.server_tool_calls = Some(json!([{"calls": []}]));
        let out = build_messages(&test_request(vec![with_tool], 8000), &test_model(), true);
        assert_eq!(
            out[0].get("reasoning_content").and_then(|r| r.as_str()),
            Some("needed for tool history")
        );
    }
}
