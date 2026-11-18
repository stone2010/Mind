use crate::credentials;
use crate::db::{now_millis, set_setting};
use crate::models::*;
use crate::providers;
use crate::AppState;
use rusqlite::{params, OptionalExtension};
use std::collections::{HashMap, HashSet};
use tauri::State;
use uuid::Uuid;

fn serr<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

// ---------------------------------------------------------------- settings

#[tauri::command]
pub fn settings_get_all(state: State<AppState>) -> Result<HashMap<String, String>, String> {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT key, value FROM app_settings")
        .map_err(serr)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(serr)?;
    let mut map = HashMap::new();
    for row in rows {
        let (k, v) = row.map_err(serr)?;
        map.insert(k, v);
    }
    Ok(map)
}

#[tauri::command]
pub fn settings_set(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    set_setting(&conn, &key, &value)
}

// --------------------------------------------------------------- providers

#[tauri::command]
pub fn providers_get(state: State<AppState>) -> Result<Vec<ProviderConfig>, String> {
    providers::load_providers(&state.db)
}

#[tauri::command]
pub fn providers_save(
    state: State<AppState>,
    providers_list: Vec<ProviderConfig>,
) -> Result<(), String> {
    if providers_list.is_empty() {
        return Err("至少需要保留一个模型提供商".into());
    }
    for p in &providers_list {
        if p.id.trim().is_empty() || p.name.trim().is_empty() {
            return Err("提供商名称不能为空".into());
        }
        if !p.base_url.starts_with("http://") && !p.base_url.starts_with("https://") {
            return Err("API Base URL 必须以 http:// 或 https:// 开头".into());
        }
        if p.models.is_empty() {
            return Err(format!("「{}」至少需要配置一个模型", p.name));
        }
    }
    providers::save_providers(&state.db, &providers_list)
}

#[tauri::command]
pub fn provider_remove(state: State<AppState>, id: String) -> Result<(), String> {
    let mut list = providers::load_providers(&state.db)?;
    list.retain(|p| p.id != id);
    if list.is_empty() {
        return Err("至少需要保留一个模型提供商".into());
    }
    providers::save_providers(&state.db, &list)?;
    let _ = credentials::delete_api_key(&id);
    Ok(())
}

#[tauri::command]
pub fn credential_status(provider_id: String) -> bool {
    credentials::has_api_key(&provider_id)
}

#[tauri::command]
pub fn credential_delete(provider_id: String) -> Result<(), String> {
    credentials::delete_api_key(&provider_id)
}

#[tauri::command]
pub async fn provider_test(
    provider: ProviderConfig,
    model_id: String,
    api_key: Option<String>,
) -> Result<TestResult, String> {
    let key = match api_key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
        Some(k) => k,
        None => credentials::get_api_key(&provider.id)
            .ok_or_else(|| "尚未填写 API Key".to_string())?,
    };
    Ok(providers::test_connection(&provider, &model_id, &key).await)
}

#[tauri::command]
pub async fn onboarding_connect(
    state: State<'_, AppState>,
    provider: ProviderConfig,
    api_key: String,
    model_id: String,
) -> Result<TestResult, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Ok(TestResult {
            ok: false,
            latency_ms: 0,
            error: Some(ProviderError::new(
                "invalid_key",
                "请输入 DeepSeek API Key。",
                None,
            )),
        });
    }

    let result = providers::test_connection(&provider, &model_id, key).await;
    if !result.ok {
        return Ok(result);
    }

    credentials::save_api_key(&provider.id, key)?;

    let mut list = providers::load_providers(&state.db)?;
    match list.iter_mut().find(|p| p.id == provider.id) {
        Some(existing) => *existing = provider.clone(),
        None => list.push(provider.clone()),
    }
    providers::save_providers(&state.db, &list)?;

    Ok(result)
}

#[tauri::command]
pub fn credential_save(provider_id: String, api_key: String) -> Result<(), String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("API Key 不能为空".into());
    }
    credentials::save_api_key(&provider_id, key)
}

// ----------------------------------------------------------- conversations

fn row_to_conversation(r: &rusqlite::Row) -> rusqlite::Result<Conversation> {
    Ok(Conversation {
        id: r.get(0)?,
        title: r.get(1)?,
        model_id: r.get(2)?,
        project_id: r.get(3)?,
        pinned: r.get::<_, i64>(4)? != 0,
        archived: r.get::<_, i64>(5)? != 0,
        summary: r.get(6)?,
        summary_upto: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

const CONV_COLS: &str =
    "id, title, model_id, project_id, pinned, archived, summary, summary_upto, created_at, updated_at";

#[tauri::command]
pub fn db_list_conversations(state: State<AppState>) -> Result<Vec<Conversation>, String> {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {CONV_COLS} FROM conversations ORDER BY pinned DESC, updated_at DESC"
        ))
        .map_err(serr)?;
    let rows = stmt.query_map([], row_to_conversation).map_err(serr)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(serr)
}

#[tauri::command]
pub fn db_set_conversation_summary(
    state: State<AppState>,
    id: String,
    summary: Option<String>,
    summary_upto: i64,
) -> Result<(), String> {
    let summary = summary
        .map(|value| value.trim().chars().take(4000).collect::<String>())
        .filter(|value| !value.is_empty());
    let summary_upto = summary.as_ref().map(|_| summary_upto.max(0)).unwrap_or(0);
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "UPDATE conversations SET summary = ?2, summary_upto = ?3 WHERE id = ?1",
        params![id, summary, summary_upto],
    )
    .map_err(serr)?;
    Ok(())
}

#[tauri::command]
pub fn db_get_conversation(
    state: State<AppState>,
    id: String,
) -> Result<Option<Conversation>, String> {
    let conn = state.db.conn.lock().unwrap();
    conn.query_row(
        &format!("SELECT {CONV_COLS} FROM conversations WHERE id = ?1"),
        [&id],
        row_to_conversation,
    )
    .optional()
    .map_err(serr)
}

#[tauri::command]
pub fn db_create_conversation(
    state: State<AppState>,
    title: String,
    model_id: Option<String>,
    project_id: Option<String>,
) -> Result<Conversation, String> {
    let now = now_millis();
    let conv = Conversation {
        id: new_id(),
        title: if title.trim().is_empty() {
            "新对话".into()
        } else {
            title
        },
        model_id,
        project_id,
        pinned: false,
        archived: false,
        summary: None,
        summary_upto: 0,
        created_at: now,
        updated_at: now,
    };
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO conversations (id, title, model_id, project_id, pinned, archived, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?6)",
        params![conv.id, conv.title, conv.model_id, conv.project_id, conv.created_at, conv.updated_at],
    )
    .map_err(serr)?;
    Ok(conv)
}

fn update_conv_field(state: &State<AppState>, id: &str, sql: &str, value: rusqlite::types::Value) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute(sql, params![value, now_millis(), id]).map_err(serr)?;
    Ok(())
}

#[tauri::command]
pub fn db_rename_conversation(state: State<AppState>, id: String, title: String) -> Result<(), String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("对话标题不能为空".into());
    }
    update_conv_field(
        &state,
        &id,
        "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::types::Value::Text(title),
    )
}

#[tauri::command]
pub fn db_set_conversation_pinned(state: State<AppState>, id: String, pinned: bool) -> Result<(), String> {
    update_conv_field(
        &state,
        &id,
        "UPDATE conversations SET pinned = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::types::Value::Integer(pinned as i64),
    )
}

#[tauri::command]
pub fn db_set_conversation_archived(state: State<AppState>, id: String, archived: bool) -> Result<(), String> {
    update_conv_field(
        &state,
        &id,
        "UPDATE conversations SET archived = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::types::Value::Integer(archived as i64),
    )
}

#[tauri::command]
pub fn db_set_conversation_project(
    state: State<AppState>,
    id: String,
    project_id: Option<String>,
) -> Result<(), String> {
    update_conv_field(
        &state,
        &id,
        "UPDATE conversations SET project_id = ?1, updated_at = ?2 WHERE id = ?3",
        match project_id {
            Some(p) => rusqlite::types::Value::Text(p),
            None => rusqlite::types::Value::Null,
        },
    )
}

#[tauri::command]
pub fn db_set_conversation_model(state: State<AppState>, id: String, model_id: String) -> Result<(), String> {
    update_conv_field(
        &state,
        &id,
        "UPDATE conversations SET model_id = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::types::Value::Text(model_id),
    )
}

#[tauri::command]
pub fn db_touch_conversation(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now_millis(), id],
    )
    .map_err(serr)?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_conversation(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute("DELETE FROM conversations WHERE id = ?1", [&id])
        .map_err(serr)?;
    Ok(())
}

// ---------------------------------------------------------------- messages

fn row_to_message(r: &rusqlite::Row) -> rusqlite::Result<Message> {
    Ok(Message {
        id: r.get(0)?,
        conversation_id: r.get(1)?,
        role: r.get(2)?,
        content: r.get(3)?,
        reasoning: r.get(4)?,
        attachments: r.get(5)?,
        status: r.get(6)?,
        feedback: r.get(7)?,
        model_id: r.get(8)?,
        sources: r.get(9)?,
        server_tool_calls: r.get(10)?,
        connector_calls: r.get(11)?,
        created_at: r.get(12)?,
    })
}

const MSG_COLS: &str = "id, conversation_id, role, content, reasoning, attachments, status, feedback, model_id, sources, server_tool_calls, connector_calls, created_at";

#[tauri::command]
pub fn db_get_messages(state: State<AppState>, conversation_id: String) -> Result<Vec<Message>, String> {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {MSG_COLS} FROM messages WHERE conversation_id = ?1 ORDER BY rowid ASC"
        ))
        .map_err(serr)?;
    let rows = stmt.query_map([&conversation_id], row_to_message).map_err(serr)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(serr)
}

#[tauri::command]
pub fn db_insert_message(state: State<AppState>, message: Message) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, reasoning, attachments, status, feedback, model_id, sources, server_tool_calls, connector_calls, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            message.id,
            message.conversation_id,
            message.role,
            message.content,
            message.reasoning,
            message.attachments,
            message.status,
            message.feedback,
            message.model_id,
            message.sources,
            message.server_tool_calls,
            message.connector_calls,
            message.created_at
        ],
    )
    .map_err(serr)?;
    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now_millis(), message.conversation_id],
    )
    .map_err(serr)?;
    Ok(())
}

#[tauri::command]
pub fn db_finish_message(
    state: State<AppState>,
    id: String,
    content: String,
    reasoning: Option<String>,
    status: String,
    sources: Option<String>,
    server_tool_calls: Option<String>,
    connector_calls: Option<String>,
) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "UPDATE messages SET content = ?2, reasoning = ?3, status = ?4, sources = ?5, server_tool_calls = ?6, connector_calls = ?7 WHERE id = ?1",
        params![
            id,
            content,
            reasoning,
            status,
            sources,
            server_tool_calls,
            connector_calls
        ],
    )
    .map_err(serr)?;
    Ok(())
}

#[tauri::command]
pub fn db_update_message_content(
    state: State<AppState>,
    id: String,
    content: String,
) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "UPDATE messages SET content = ?2 WHERE id = ?1",
        params![id, content],
    )
    .map_err(serr)?;
    Ok(())
}

#[tauri::command]
pub fn db_set_message_feedback(
    state: State<AppState>,
    id: String,
    feedback: Option<i64>,
) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "UPDATE messages SET feedback = ?2 WHERE id = ?1",
        params![id, feedback],
    )
    .map_err(serr)?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_message(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute("DELETE FROM messages WHERE id = ?1", [&id])
        .map_err(serr)?;
    Ok(())
}

/// Deletes the given message and every message after it in the conversation.
#[tauri::command]
pub fn db_delete_messages_from(
    state: State<AppState>,
    conversation_id: String,
    message_id: String,
) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1 AND rowid >= (SELECT rowid FROM messages WHERE id = ?2)",
        params![conversation_id, message_id],
    )
    .map_err(serr)?;
    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now_millis(), conversation_id],
    )
    .map_err(serr)?;
    Ok(())
}

// ------------------------------------------------------------------ search

fn like_pattern(query: &str) -> String {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn make_snippet(content: &str, query: &str) -> String {
    let lower = content.to_lowercase();
    let q = query.to_lowercase();
    let byte_idx = lower.find(&q).unwrap_or(0);
    let char_idx = content[..byte_idx].chars().count();
    let chars: Vec<char> = content.chars().collect();
    let start = char_idx.saturating_sub(30);
    let end = (char_idx + query.chars().count() + 60).min(chars.len());
    let mut s = String::new();
    if start > 0 {
        s.push('…');
    }
    s.extend(chars[start..end].iter());
    if end < chars.len() {
        s.push('…');
    }
    s.replace('\n', " ")
}

#[tauri::command]
pub fn db_search(state: State<AppState>, query: String) -> Result<Vec<SearchHit>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let pattern = like_pattern(q);
    let conn = state.db.conn.lock().unwrap();
    let mut hits: Vec<SearchHit> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    let mut stmt = conn
        .prepare("SELECT id, title FROM conversations WHERE title LIKE ?1 ESCAPE '\\' ORDER BY updated_at DESC LIMIT 12")
        .map_err(serr)?;
    let rows = stmt
        .query_map([&pattern], |r| {
            Ok(SearchHit {
                conversation_id: r.get(0)?,
                title: r.get(1)?,
                snippet: String::new(),
                kind: "title".into(),
            })
        })
        .map_err(serr)?;
    for row in rows {
        let hit = row.map_err(serr)?;
        seen.insert(hit.conversation_id.clone());
        hits.push(hit);
    }

    let mut stmt = conn
        .prepare(
            "SELECT m.conversation_id, c.title, m.content FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             WHERE m.content LIKE ?1 ESCAPE '\\'
             ORDER BY m.created_at DESC LIMIT 40",
        )
        .map_err(serr)?;
    let rows = stmt
        .query_map([&pattern], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(serr)?;
    for row in rows {
        let (cid, title, content) = row.map_err(serr)?;
        if seen.contains(&cid) {
            continue;
        }
        seen.insert(cid.clone());
        hits.push(SearchHit {
            conversation_id: cid,
            title,
            snippet: make_snippet(&content, q),
            kind: "message".into(),
        });
        if hits.len() >= 20 {
            break;
        }
    }
    Ok(hits)
}

// ---------------------------------------------------------------- projects

#[tauri::command]
pub fn db_list_projects(state: State<AppState>) -> Result<Vec<Project>, String> {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM conversations c WHERE c.project_id = p.id) as cnt
             FROM projects p ORDER BY p.updated_at DESC",
        )
        .map_err(serr)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Project {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
                conversation_count: r.get(5)?,
            })
        })
        .map_err(serr)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(serr)
}

#[tauri::command]
pub fn db_create_project(
    state: State<AppState>,
    name: String,
    description: Option<String>,
) -> Result<Project, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("项目名称不能为空".into());
    }
    let now = now_millis();
    let project = Project {
        id: new_id(),
        name,
        description: description.filter(|d| !d.trim().is_empty()),
        created_at: now,
        updated_at: now,
        conversation_count: 0,
    };
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![project.id, project.name, project.description, project.created_at, project.updated_at],
    )
    .map_err(serr)?;
    Ok(project)
}

#[tauri::command]
pub fn db_update_project(
    state: State<AppState>,
    id: String,
    name: String,
    description: Option<String>,
) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("项目名称不能为空".into());
    }
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "UPDATE projects SET name = ?2, description = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, name, description.filter(|d| !d.trim().is_empty()), now_millis()],
    )
    .map_err(serr)?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_project(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "UPDATE conversations SET project_id = NULL WHERE project_id = ?1",
        [&id],
    )
    .map_err(serr)?;
    conn.execute("DELETE FROM projects WHERE id = ?1", [&id])
        .map_err(serr)?;
    Ok(())
}

#[tauri::command]
pub fn db_project_conversations(
    state: State<AppState>,
    project_id: String,
) -> Result<Vec<Conversation>, String> {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {CONV_COLS} FROM conversations WHERE project_id = ?1 AND archived = 0 ORDER BY updated_at DESC"
        ))
        .map_err(serr)?;
    let rows = stmt
        .query_map([&project_id], row_to_conversation)
        .map_err(serr)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(serr)
}

// ---------------------------------------------------------------- memories

pub(crate) const MEMORY_COLUMNS: &str = "id, memory_type, subject, content, source, source_conversation_id, source_message_id, confidence, importance, status, valid_from, valid_until, last_accessed_at, metadata, created_at, updated_at";

pub(crate) fn memory_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Memory> {
    Ok(Memory {
        id: r.get(0)?,
        memory_type: r.get(1)?,
        subject: r.get(2)?,
        content: r.get(3)?,
        source: r.get(4)?,
        source_conversation_id: r.get(5)?,
        source_message_id: r.get(6)?,
        confidence: r.get(7)?,
        importance: r.get(8)?,
        status: r.get(9)?,
        valid_from: r.get(10)?,
        valid_until: r.get(11)?,
        last_accessed_at: r.get(12)?,
        metadata: r.get(13)?,
        created_at: r.get(14)?,
        updated_at: r.get(15)?,
    })
}

pub(crate) fn normalize_memory_type(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "preference" | "偏好" => "preference",
        "project" | "项目" => "project",
        "episodic" | "episode" | "事件" => "episodic",
        "knowledge" | "知识" => "knowledge",
        _ => "profile",
    }
    .into()
}

pub(crate) fn insert_memory_row(conn: &rusqlite::Connection, memory: &Memory) -> Result<(), String> {
    conn.execute(
        "INSERT INTO memories
         (id, memory_type, subject, content, source, source_conversation_id,
          source_message_id, confidence, importance, status, valid_from,
          valid_until, last_accessed_at, metadata, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            memory.id,
            memory.memory_type,
            memory.subject,
            memory.content,
            memory.source,
            memory.source_conversation_id,
            memory.source_message_id,
            memory.confidence,
            memory.importance,
            memory.status,
            memory.valid_from,
            memory.valid_until,
            memory.last_accessed_at,
            memory.metadata,
            memory.created_at,
            memory.updated_at
        ],
    )
    .map_err(serr)?;
    Ok(())
}

pub(crate) fn record_memory_source(
    conn: &rusqlite::Connection,
    memory_id: &str,
    conversation_id: Option<&str>,
    message_id: Option<&str>,
    now: i64,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO memory_sources (memory_id, conversation_id, message_id, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![memory_id, conversation_id, message_id, now],
    )
    .map_err(serr)?;
    Ok(())
}

pub(crate) fn snapshot_memory(
    conn: &rusqlite::Connection,
    memory: &Memory,
    reason: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO memory_versions
         (id, memory_id, content, memory_type, subject, status, confidence,
          importance, changed_at, reason)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            new_id(),
            memory.id,
            memory.content,
            memory.memory_type,
            memory.subject,
            memory.status,
            memory.confidence,
            memory.importance,
            now_millis(),
            reason
        ],
    )
    .map_err(serr)?;
    Ok(())
}

#[tauri::command]
pub fn db_list_memories(state: State<AppState>) -> Result<Vec<Memory>, String> {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {MEMORY_COLUMNS} FROM memories
             ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'superseded' THEN 1 ELSE 2 END,
                      updated_at DESC"
        ))
        .map_err(serr)?;
    let rows = stmt
        .query_map([], memory_from_row)
        .map_err(serr)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(serr)
}

#[tauri::command]
pub fn db_create_memory(state: State<AppState>, content: String) -> Result<Memory, String> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("记忆内容不能为空".into());
    }
    let conn = state.db.conn.lock().unwrap();
    // "保存到记忆" may be clicked more than once; return the existing row
    // instead of accumulating exact duplicates.
    if let Some(existing) = conn
        .query_row(
            &format!(
                "SELECT {MEMORY_COLUMNS} FROM memories
                 WHERE lower(trim(content)) = lower(?1) AND status = 'active'
                 ORDER BY updated_at DESC LIMIT 1"
            ),
            params![&content],
            memory_from_row,
        )
        .optional()
        .map_err(serr)?
    {
        return Ok(existing);
    }
    let now = now_millis();
    let memory = Memory {
        id: new_id(),
        memory_type: "profile".into(),
        subject: String::new(),
        content,
        source: "manual".into(),
        source_conversation_id: None,
        source_message_id: None,
        confidence: 1.0,
        importance: 0.8,
        status: "active".into(),
        valid_from: Some(now),
        valid_until: None,
        last_accessed_at: None,
        metadata: None,
        created_at: now,
        updated_at: now,
    };
    insert_memory_row(&conn, &memory)?;
    Ok(memory)
}

#[tauri::command]
pub fn db_create_memory_typed(
    state: State<AppState>,
    content: String,
    memory_type: String,
    subject: Option<String>,
) -> Result<Memory, String> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("记忆内容不能为空".into());
    }
    let conn = state.db.conn.lock().unwrap();
    if let Some(existing) = conn
        .query_row(
            &format!(
                "SELECT {MEMORY_COLUMNS} FROM memories
                 WHERE lower(trim(content)) = lower(?1) AND status = 'active'
                 ORDER BY updated_at DESC LIMIT 1"
            ),
            params![&content],
            memory_from_row,
        )
        .optional()
        .map_err(serr)?
    {
        return Ok(existing);
    }
    let now = now_millis();
    let memory = Memory {
        id: new_id(),
        memory_type: normalize_memory_type(&memory_type),
        subject: subject
            .unwrap_or_default()
            .trim()
            .to_lowercase()
            .chars()
            .take(64)
            .collect(),
        content,
        source: "manual".into(),
        source_conversation_id: None,
        source_message_id: None,
        confidence: 1.0,
        importance: 0.8,
        status: "active".into(),
        valid_from: Some(now),
        valid_until: None,
        last_accessed_at: None,
        metadata: None,
        created_at: now,
        updated_at: now,
    };
    insert_memory_row(&conn, &memory)?;
    Ok(memory)
}

#[tauri::command]
pub fn db_update_memory(state: State<AppState>, id: String, content: String) -> Result<(), String> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("记忆内容不能为空".into());
    }
    let conn = state.db.conn.lock().unwrap();
    let old = conn
        .query_row(
            &format!("SELECT {MEMORY_COLUMNS} FROM memories WHERE id = ?1"),
            params![&id],
            memory_from_row,
        )
        .optional()
        .map_err(serr)?
        .ok_or_else(|| "记忆不存在".to_string())?;
    snapshot_memory(&conn, &old, "edited")?;
    conn.execute(
        "UPDATE memories SET content = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, content, now_millis()],
    )
    .map_err(serr)?;
    Ok(())
}

#[tauri::command]
pub fn db_delete_memory(state: State<AppState>, id: String) -> Result<(), String> {
    let mut conn = state.db.conn.lock().unwrap();
    let tx = conn.transaction().map_err(serr)?;
    tx.execute("DELETE FROM memory_versions WHERE memory_id = ?1", params![&id])
        .map_err(serr)?;
    tx.execute("DELETE FROM memory_sources WHERE memory_id = ?1", params![&id])
        .map_err(serr)?;
    tx.execute("DELETE FROM memories WHERE id = ?1", params![&id])
        .map_err(serr)?;
    tx.commit().map_err(serr)?;
    Ok(())
}

fn fts_available(conn: &rusqlite::Connection) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memories_fts'",
        [],
        |_| Ok(true),
    )
    .unwrap_or(false)
}

fn build_fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn active_memories(
    conn: &rusqlite::Connection,
    limit: usize,
) -> Result<Vec<Memory>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {MEMORY_COLUMNS} FROM memories
             WHERE status = 'active'
             ORDER BY importance DESC, updated_at DESC LIMIT ?1"
        ))
        .map_err(serr)?;
    let rows = stmt
        .query_map(params![limit as i64], memory_from_row)
        .map_err(serr)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(serr)
}

fn search_memory_rows(
    conn: &rusqlite::Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<Memory>, String> {
    let query = query.trim();
    if query.is_empty() {
        return active_memories(conn, limit);
    }

    let mut results = Vec::new();
    if fts_available(conn) {
        let fts_query = build_fts_query(query);
        if !fts_query.is_empty() {
            if let Ok(mut stmt) = conn.prepare(
                "SELECT memory_id FROM memories_fts
                 WHERE memories_fts MATCH ?1
                 ORDER BY bm25(memories_fts) LIMIT ?2",
            ) {
                if let Ok(ids) = stmt.query_map(params![fts_query, limit as i64], |r| {
                    r.get::<_, String>(0)
                }) {
                    for id in ids.flatten() {
                        if let Ok(memory) = conn.query_row(
                            &format!(
                                "SELECT {MEMORY_COLUMNS} FROM memories
                                 WHERE id = ?1 AND status = 'active'"
                            ),
                            params![id],
                            memory_from_row,
                        ) {
                            results.push(memory);
                        }
                    }
                }
            }
        }
    }
    if results.is_empty() {
        let like = format!("%{query}%");
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {MEMORY_COLUMNS} FROM memories
                 WHERE status = 'active'
                   AND (content LIKE ?1 OR subject LIKE ?1)
                 ORDER BY importance DESC, updated_at DESC LIMIT ?2"
            ))
            .map_err(serr)?;
        let rows = stmt
            .query_map(params![like, limit as i64], memory_from_row)
            .map_err(serr)?;
        results = rows.collect::<Result<Vec<_>, _>>().map_err(serr)?;
    }
    Ok(results)
}

fn is_cjk(c: char) -> bool {
    matches!(
        c as u32,
        0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF
    )
}

fn push_cjk_tokens(run: &[char], out: &mut HashSet<String>) {
    if run.len() == 1 {
        out.insert(run[0].to_string());
    } else {
        for window in run.windows(2) {
            out.insert(window.iter().collect());
        }
    }
}

fn memory_tokens(text: &str) -> HashSet<String> {
    let lower = text.to_lowercase();
    let mut out = HashSet::new();
    for word in lower.split(|c: char| !c.is_ascii_alphanumeric()) {
        if word.len() >= 2 {
            out.insert(word.to_string());
        }
    }
    let chars: Vec<char> = lower.chars().collect();
    let mut run_start: Option<usize> = None;
    for (index, ch) in chars.iter().copied().enumerate() {
        if is_cjk(ch) {
            if run_start.is_none() {
                run_start = Some(index);
            }
        } else if let Some(start) = run_start.take() {
            push_cjk_tokens(&chars[start..index], &mut out);
        }
    }
    if let Some(start) = run_start {
        push_cjk_tokens(&chars[start..], &mut out);
    }
    out
}

fn memory_score(query: &str, memory: &Memory, now: i64) -> f64 {
    let query_tokens = memory_tokens(query);
    let content_tokens = memory_tokens(&memory.content);
    let overlap = if query_tokens.is_empty() {
        0.0
    } else {
        query_tokens
            .iter()
            .filter(|token| content_tokens.contains(*token))
            .count() as f64
            / query_tokens.len() as f64
    };
    let type_boost = match memory.memory_type.as_str() {
        "preference" | "project" => 1.0,
        "profile" => 0.85,
        "knowledge" => 0.6,
        _ => 0.45,
    };
    let age_days = ((now - memory.updated_at).max(0) as f64) / 86_400_000.0;
    let recency = (1.0 - age_days / 365.0).clamp(0.0, 1.0);
    overlap * 0.45
        + memory.importance.clamp(0.0, 1.0) * 0.2
        + memory.confidence.clamp(0.0, 1.0) * 0.15
        + recency * 0.1
        + type_boost * 0.1
}

#[tauri::command]
pub fn db_search_memories(
    state: State<AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<Memory>, String> {
    let limit = limit.unwrap_or(20).clamp(1, 100);
    let conn = state.db.conn.lock().unwrap();
    search_memory_rows(&conn, &query, limit)
}

#[tauri::command]
pub fn db_memory_recall(
    state: State<AppState>,
    query: String,
    mode: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    let mode = mode.unwrap_or_else(|| "recall".into());
    let default_limit = if mode == "recent" { 24 } else { 8 };
    let limit = limit.unwrap_or(default_limit).clamp(1, 24);
    let conn = state.db.conn.lock().unwrap();
    let now = now_millis();

    if mode == "recent" {
        let memories = active_memories(&conn, limit)?;
        for memory in &memories {
            let _ = conn.execute(
                "UPDATE memories SET last_accessed_at = ?2 WHERE id = ?1",
                params![memory.id, now],
            );
        }
        return Ok(memories.into_iter().map(|m| m.content).collect());
    }

    let query = query.trim().to_string();
    let mut candidates = search_memory_rows(&conn, &query, limit.saturating_mul(4))?;
    if candidates.is_empty() {
        candidates = active_memories(&conn, limit.saturating_mul(4))?;
    }
    candidates.sort_by(|a, b| {
        memory_score(&query, b, now)
            .partial_cmp(&memory_score(&query, a, now))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    candidates.truncate(limit);
    for memory in &candidates {
        let _ = conn.execute(
            "UPDATE memories SET last_accessed_at = ?2 WHERE id = ?1",
            params![memory.id, now],
        );
    }
    Ok(candidates.into_iter().map(|m| m.content).collect())
}

#[tauri::command]
pub fn db_memory_history(
    state: State<AppState>,
    id: String,
) -> Result<MemoryHistory, String> {
    let conn = state.db.conn.lock().unwrap();
    let mut version_stmt = conn
        .prepare(
            "SELECT id, memory_id, content, memory_type, subject, status,
                    confidence, importance, changed_at, reason
             FROM memory_versions WHERE memory_id = ?1
             ORDER BY changed_at DESC",
        )
        .map_err(serr)?;
    let versions = version_stmt
        .query_map(params![&id], |r| {
            Ok(MemoryVersion {
                id: r.get(0)?,
                memory_id: r.get(1)?,
                content: r.get(2)?,
                memory_type: r.get(3)?,
                subject: r.get(4)?,
                status: r.get(5)?,
                confidence: r.get(6)?,
                importance: r.get(7)?,
                changed_at: r.get(8)?,
                reason: r.get(9)?,
            })
        })
        .map_err(serr)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(serr)?;

    let mut source_stmt = conn
        .prepare(
            "SELECT id, memory_id, conversation_id, message_id, created_at
             FROM memory_sources WHERE memory_id = ?1 ORDER BY created_at DESC",
        )
        .map_err(serr)?;
    let sources = source_stmt
        .query_map(params![&id], |r| {
            Ok(MemorySource {
                id: r.get(0)?,
                memory_id: r.get(1)?,
                conversation_id: r.get(2)?,
                message_id: r.get(3)?,
                created_at: r.get(4)?,
            })
        })
        .map_err(serr)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(serr)?;

    Ok(MemoryHistory { versions, sources })
}

#[tauri::command]
pub fn db_memory_consolidate(
    state: State<AppState>,
) -> Result<MemoryConsolidateResult, String> {
    let conn = state.db.conn.lock().unwrap();
    let now = now_millis();
    let memories = active_memories(&conn, 1000)?;
    let mut kept: Vec<Memory> = Vec::new();
    let mut subjects: HashMap<String, String> = HashMap::new();
    let mut superseded = 0usize;

    for memory in memories {
        let subject_key = if memory.subject.trim().is_empty() {
            None
        } else {
            Some(format!(
                "{}::{}",
                memory.memory_type,
                memory.subject.trim().to_lowercase()
            ))
        };
        let duplicate = match &subject_key {
            Some(key) => subjects.contains_key(key),
            None => kept
                .iter()
                .any(|item| crate::memory::similarity(&item.content, &memory.content) >= 0.9),
        };
        if duplicate {
            snapshot_memory(&conn, &memory, "consolidate")?;
            conn.execute(
                "UPDATE memories SET status = 'superseded', valid_until = ?2, updated_at = ?3 WHERE id = ?1",
                params![memory.id, now, now],
            )
            .map_err(serr)?;
            superseded += 1;
        } else {
            if let Some(key) = subject_key {
                subjects.insert(key, memory.id.clone());
            }
            kept.push(memory);
        }
    }

    let active: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM memories WHERE status = 'active'",
            [],
            |r| r.get(0),
        )
        .map_err(serr)?;
    Ok(MemoryConsolidateResult {
        superseded,
        merged: 0,
        active: active as usize,
    })
}

// --------------------------------------------------------------------- usage

#[tauri::command]
pub fn db_log_usage(state: State<AppState>, log: UsageLog) -> Result<(), String> {
    let prompt = log.prompt_tokens.max(0).min(100_000_000);
    let completion = log.completion_tokens.max(0).min(100_000_000);
    let total = if log.total_tokens > 0 {
        log.total_tokens.max(0).min(200_000_000)
    } else {
        prompt + completion
    };
    let cache_hit = log.prompt_cache_hit_tokens.max(0).min(100_000_000);
    let cache_miss = log.prompt_cache_miss_tokens.max(0).min(100_000_000);
    let id = if log.id.trim().is_empty() {
        new_id()
    } else {
        log.id.chars().take(80).collect()
    };
    let kind = if log.kind.trim().is_empty() {
        "chat".to_string()
    } else {
        log.kind.trim().chars().take(32).collect()
    };
    let created_at = if log.created_at > 0 {
        log.created_at
    } else {
        now_millis()
    };
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO usage_logs
         (id, conversation_id, message_id, provider_id, model_id, kind,
          prompt_tokens, completion_tokens, total_tokens,
          prompt_cache_hit_tokens, prompt_cache_miss_tokens, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            id,
            log.conversation_id,
            log.message_id,
            log.provider_id,
            log.model_id,
            kind,
            prompt,
            completion,
            total,
            cache_hit,
            cache_miss,
            created_at
        ],
    )
    .map_err(serr)?;
    Ok(())
}

#[tauri::command]
pub fn db_list_usage(
    state: State<AppState>,
    limit: Option<u32>,
) -> Result<Vec<UsageLog>, String> {
    let limit = limit.unwrap_or(2000).clamp(1, 10_000);
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, message_id, provider_id, model_id, kind,
                    prompt_tokens, completion_tokens, total_tokens,
                    prompt_cache_hit_tokens, prompt_cache_miss_tokens, created_at
             FROM usage_logs ORDER BY created_at DESC LIMIT ?1",
        )
        .map_err(serr)?;
    let rows = stmt
        .query_map([limit], |r| {
            Ok(UsageLog {
                id: r.get(0)?,
                conversation_id: r.get(1)?,
                message_id: r.get(2)?,
                provider_id: r.get(3)?,
                model_id: r.get(4)?,
                kind: r.get(5)?,
                prompt_tokens: r.get(6)?,
                completion_tokens: r.get(7)?,
                total_tokens: r.get(8)?,
                prompt_cache_hit_tokens: r.get(9)?,
                prompt_cache_miss_tokens: r.get(10)?,
                created_at: r.get(11)?,
            })
        })
        .map_err(serr)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(serr)
}

#[tauri::command]
pub fn db_conversation_usage(
    state: State<AppState>,
    conversation_id: String,
    limit: Option<u32>,
) -> Result<Vec<UsageLog>, String> {
    let limit = limit.unwrap_or(1000).clamp(1, 5000);
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, message_id, provider_id, model_id, kind,
                    prompt_tokens, completion_tokens, total_tokens,
                    prompt_cache_hit_tokens, prompt_cache_miss_tokens, created_at
             FROM usage_logs WHERE conversation_id = ?1
             ORDER BY created_at ASC LIMIT ?2",
        )
        .map_err(serr)?;
    let rows = stmt
        .query_map(params![conversation_id, limit], |r| {
            Ok(UsageLog {
                id: r.get(0)?,
                conversation_id: r.get(1)?,
                message_id: r.get(2)?,
                provider_id: r.get(3)?,
                model_id: r.get(4)?,
                kind: r.get(5)?,
                prompt_tokens: r.get(6)?,
                completion_tokens: r.get(7)?,
                total_tokens: r.get(8)?,
                prompt_cache_hit_tokens: r.get(9)?,
                prompt_cache_miss_tokens: r.get(10)?,
                created_at: r.get(11)?,
            })
        })
        .map_err(serr)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(serr)
}

#[tauri::command]
pub fn db_clear_usage(state: State<AppState>) -> Result<(), String> {
    let conn = state.db.conn.lock().unwrap();
    conn.execute("DELETE FROM usage_logs", []).map_err(serr)?;
    Ok(())
}

// -------------------------------------------------------------------- misc

#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> Result<AppInfo, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(serr)?;
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        data_dir: dir.to_string_lossy().into(),
        db_path: dir.join("mind.db").to_string_lossy().into(),
    })
}

#[tauri::command]
pub fn app_ready(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub fn open_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(serr)?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(serr)
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("不支持的链接".into());
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}
