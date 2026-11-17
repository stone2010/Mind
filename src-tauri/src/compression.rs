//! Rolling conversation summaries. Used when a chat history grows past the
//! configured context budget, so older turns can be represented cheaply.

use crate::credentials;
use crate::models::*;
use crate::providers::{client, endpoint, load_providers, map_http_error, map_reqwest_error};
use crate::AppState;
use serde_json::{json, Value};
use tauri::State;

fn provider_error_string(error: ProviderError) -> String {
    match error.detail {
        Some(detail) => format!("{}（{}）", error.message, detail),
        None => error.message,
    }
}

fn clip_chars(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

fn tail_chars(text: &str, max: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max {
        return text.to_string();
    }
    chars[chars.len() - max..].iter().collect()
}

#[tauri::command]
pub async fn context_compress(
    state: State<'_, AppState>,
    provider_id: String,
    model_id: String,
    existing_summary: Option<String>,
    messages: Vec<ChatTurn>,
) -> Result<CompressResult, String> {
    let providers = load_providers(&state.db)?;
    let provider = providers
        .into_iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| "找不到用于压缩上下文的模型提供商".to_string())?;

    let model = if provider.kind == "deepseek" {
        provider
            .models
            .iter()
            .find(|m| m.id.contains("flash"))
            .or_else(|| provider.models.iter().find(|m| m.id == model_id))
            .or_else(|| provider.models.first())
            .cloned()
    } else {
        provider
            .models
            .iter()
            .find(|m| m.id == model_id)
            .or_else(|| provider.models.first())
            .cloned()
    }
    .ok_or_else(|| "当前提供商没有可用模型".to_string())?;

    let api_key = credentials::get_api_key(&provider.id)
        .ok_or_else(|| "尚未配置 API Key，无法压缩上下文".to_string())?;

    let mut transcript = String::new();
    for message in messages
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
    {
        let content = message.content.trim();
        if content.is_empty() {
            continue;
        }
        transcript.push_str(if message.role == "user" {
            "用户: "
        } else {
            "助手: "
        });
        transcript.push_str(content);
        transcript.push('\n');
    }
    if transcript.trim().is_empty() {
        return Err("没有需要压缩的对话内容".into());
    }
    // One compression call should stay bounded even for very long histories.
    let transcript = tail_chars(&transcript, 60_000);
    let existing = clip_chars(existing_summary.as_deref().unwrap_or("").trim(), 2_000);

    let system = "你是对话压缩器。请把对话压缩成简洁、事实准确的中文摘要，保留用户目标、关键事实、已做决定、未完成事项和重要偏好。不要编造，不要加入建议，不要使用 Markdown 标题。输出纯文本，不超过 500 字。";
    let user = format!(
        "已有摘要：\n{}\n\n需要合并的新对话：\n{}",
        if existing.is_empty() {
            "（无）"
        } else {
            existing.as_str()
        },
        transcript
    );

    let mut body = json!({
        "model": model.id,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user}
        ],
        "stream": false,
        "temperature": 0.2,
        "max_tokens": 600
    });
    if provider.kind == "deepseek" {
        body["thinking"] = json!({"type": "disabled"});
    }

    let response = client()
        .post(endpoint(&provider.base_url))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| provider_error_string(map_reqwest_error(error)))?;

    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let text = response.text().await.unwrap_or_default();
        return Err(provider_error_string(map_http_error(status, &text)));
    }

    let value: Value = response
        .json()
        .await
        .map_err(|e| format!("无法解析压缩结果: {e}"))?;
    if let Some(error) = value.get("error").filter(|v| !v.is_null()) {
        let detail = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("服务返回错误");
        return Err(format!("压缩失败: {detail}"));
    }

    let content = value
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if content.is_empty() {
        return Err("压缩失败：模型没有返回摘要".into());
    }

    let usage = value.get("usage").filter(|u| !u.is_null()).map(|usage| Usage {
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
        prompt_cache_hit_tokens: usage
            .get("prompt_cache_hit_tokens")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        prompt_cache_miss_tokens: usage
            .get("prompt_cache_miss_tokens")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
    });

    Ok(CompressResult {
        summary: clip_chars(&content, 2_000),
        usage,
    })
}
