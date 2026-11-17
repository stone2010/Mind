use crate::db::{get_setting, set_setting, Db};
use crate::models::{ModelConfig, ProviderConfig, ProviderError, TestResult};
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

pub const PROVIDERS_KEY: &str = "app.providers";
pub const DEEPSEEK_BASE_URL: &str = "https://api.deepseek.com";

pub fn default_provider() -> ProviderConfig {
    ProviderConfig {
        id: "deepseek".into(),
        name: "DeepSeek".into(),
        kind: "deepseek".into(),
        base_url: DEEPSEEK_BASE_URL.into(),
        models: vec![
            ModelConfig {
                id: "deepseek-flash".into(),
                label: "DeepSeek Flash".into(),
                supports_thinking: true,
                supports_vision: true,
                supports_web_search: Some(true),
                temperature: None,
                max_tokens: None,
            },
            ModelConfig {
                id: "deepseek-v4-pro".into(),
                label: "DeepSeek V4 Pro".into(),
                supports_thinking: true,
                supports_vision: false,
                supports_web_search: Some(false),
                temperature: None,
                max_tokens: None,
            },
        ],
        is_builtin: true,
    }
}

/// Fills capabilities that older stored configs did not have yet.
pub fn normalize_providers(list: &mut [ProviderConfig]) {
    for provider in list.iter_mut() {
        if provider.kind == "deepseek" {
            for model in provider.models.iter_mut() {
                if model.supports_web_search.is_none() {
                    model.supports_web_search = Some(model.id == "deepseek-flash");
                }
            }
        }
    }
}

pub fn load_providers(db: &Db) -> Result<Vec<ProviderConfig>, String> {
    let raw = {
        let conn = db.conn.lock().unwrap();
        get_setting(&conn, PROVIDERS_KEY)
    };
    match raw {
        Some(s) => {
            let mut list: Vec<ProviderConfig> = serde_json::from_str(&s)
                .map_err(|e| format!("模型配置读取失败: {e}"))?;
            if list.is_empty() {
                list.push(default_provider());
            }
            normalize_providers(&mut list);
            Ok(list)
        }
        None => Ok(vec![default_provider()]),
    }
}

pub fn save_providers(db: &Db, providers: &[ProviderConfig]) -> Result<(), String> {
    let s = serde_json::to_string(providers).map_err(|e| e.to_string())?;
    let conn = db.conn.lock().unwrap();
    set_setting(&conn, PROVIDERS_KEY, &s)
}

pub fn client() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .user_agent("Mind/0.1")
                .build()
                .expect("failed to build HTTP client")
        })
        .clone()
}

pub fn endpoint(base_url: &str) -> String {
    format!("{}/chat/completions", base_url.trim().trim_end_matches('/'))
}

pub fn map_reqwest_error(e: reqwest::Error) -> ProviderError {
    let detail = Some(e.to_string());
    if e.is_timeout() {
        ProviderError::new("timeout", "请求超时，请检查网络后重试。", detail)
    } else if e.is_connect() || e.is_request() || e.is_body() || e.is_decode() {
        ProviderError::new("network", "网络连接失败，请检查网络后重试。", detail)
    } else {
        ProviderError::new("unknown", "连接失败，请稍后再试。", detail)
    }
}

pub fn map_http_error(status: u16, body: &str) -> ProviderError {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v["error"]["message"]
                .as_str()
                .or_else(|| v["error"]["code"].as_str())
                .or_else(|| v["message"].as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| body.chars().take(600).collect());
    let (code, message) = match status {
        401 | 403 => ("invalid_key", "API Key 无效或没有访问权限，请检查后重试。"),
        402 => (
            "insufficient_balance",
            "账户余额或额度不足，请前往服务商平台充值后重试。",
        ),
        429 => ("rate_limit", "请求过于频繁，请稍后再试。"),
        400 | 404 | 422 => ("bad_request", "请求未能被服务接受，请检查模型配置。"),
        500..=599 => ("server", "服务暂时不可用，请稍后再试。"),
        _ => ("unknown", "连接失败，请稍后再试。"),
    };
    ProviderError::new(code, message, Some(format!("HTTP {status}: {detail}")))
}

/// Performs a real, minimal chat completion request to verify the key and endpoint.
pub async fn test_connection(
    provider: &ProviderConfig,
    model_id: &str,
    api_key: &str,
) -> TestResult {
    let started = Instant::now();
    let url = endpoint(&provider.base_url);
    let mut body = json!({
        "model": model_id,
        "messages": [{"role": "user", "content": "ping"}],
        "stream": false,
        "max_tokens": 16
    });
    if provider.kind == "deepseek" {
        body["thinking"] = json!({"type": "disabled"});
    }

    let fut = client()
        .post(&url)
        .bearer_auth(api_key.trim())
        .json(&body)
        .send();

    let response = match tokio::time::timeout(Duration::from_secs(30), fut).await {
        Err(_) => {
            return TestResult {
                ok: false,
                latency_ms: started.elapsed().as_millis() as u64,
                error: Some(ProviderError::new(
                    "timeout",
                    "请求超时，请检查网络后重试。",
                    Some("测试连接超过 30 秒未返回".into()),
                )),
            }
        }
        Ok(Err(e)) => {
            return TestResult {
                ok: false,
                latency_ms: started.elapsed().as_millis() as u64,
                error: Some(map_reqwest_error(e)),
            }
        }
        Ok(Ok(r)) => r,
    };

    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let text = response.text().await.unwrap_or_default();
        return TestResult {
            ok: false,
            latency_ms: started.elapsed().as_millis() as u64,
            error: Some(map_http_error(status, &text)),
        };
    }

    match response.json::<Value>().await {
        Ok(v) => {
            if v.get("choices").is_some() || v.get("error").is_none() {
                TestResult {
                    ok: true,
                    latency_ms: started.elapsed().as_millis() as u64,
                    error: None,
                }
            } else {
                TestResult {
                    ok: false,
                    latency_ms: started.elapsed().as_millis() as u64,
                    error: Some(ProviderError::new(
                        "server",
                        "服务返回了异常响应，请稍后再试。",
                        Some(v.to_string()),
                    )),
                }
            }
        }
        Err(e) => TestResult {
            ok: false,
            latency_ms: started.elapsed().as_millis() as u64,
            error: Some(ProviderError::new(
                "server",
                "服务返回了无法识别的响应。",
                Some(e.to_string()),
            )),
        },
    }
}
