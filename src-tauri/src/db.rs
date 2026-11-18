use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub struct Db {
    pub conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("无法打开本地数据库: {e}"))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;",
        )
        .map_err(|e| format!("数据库初始化失败: {e}"))?;
        let db = Db {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                model_id TEXT,
                project_id TEXT,
                pinned INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0,
                summary TEXT,
                summary_upto INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                reasoning TEXT,
                attachments TEXT,
                status TEXT NOT NULL DEFAULT 'complete',
                feedback INTEGER,
                model_id TEXT,
                sources TEXT,
                server_tool_calls TEXT,
                connector_calls TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);

            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'manual',
                source_conversation_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS usage_logs (
                id TEXT PRIMARY KEY,
                conversation_id TEXT,
                message_id TEXT,
                provider_id TEXT,
                model_id TEXT,
                kind TEXT NOT NULL DEFAULT 'chat',
                prompt_tokens INTEGER NOT NULL DEFAULT 0,
                completion_tokens INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                prompt_cache_hit_tokens INTEGER NOT NULL DEFAULT 0,
                prompt_cache_miss_tokens INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_logs(created_at DESC);
            "#,
        )
        .map_err(|e| format!("数据库迁移失败: {e}"))?;

        // Columns added after the first release; duplicate-column errors are fine.
        let _ = conn.execute("ALTER TABLE messages ADD COLUMN sources TEXT", []);
        let _ = conn.execute(
            "ALTER TABLE messages ADD COLUMN server_tool_calls TEXT",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE memories ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE memories ADD COLUMN source_conversation_id TEXT",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE messages ADD COLUMN connector_calls TEXT",
            [],
        );
        let _ = conn.execute("ALTER TABLE conversations ADD COLUMN summary TEXT", []);
        let _ = conn.execute(
            "ALTER TABLE conversations ADD COLUMN summary_upto INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE usage_logs ADD COLUMN prompt_cache_hit_tokens INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE usage_logs ADD COLUMN prompt_cache_miss_tokens INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE memories ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'profile'",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE memories ADD COLUMN subject TEXT NOT NULL DEFAULT ''",
            [],
        );
        let _ = conn.execute("ALTER TABLE memories ADD COLUMN source_message_id TEXT", []);
        let _ = conn.execute(
            "ALTER TABLE memories ADD COLUMN confidence REAL NOT NULL DEFAULT 0.8",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE memories ADD COLUMN importance REAL NOT NULL DEFAULT 0.5",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
            [],
        );
        let _ = conn.execute("ALTER TABLE memories ADD COLUMN valid_from INTEGER", []);
        let _ = conn.execute("ALTER TABLE memories ADD COLUMN valid_until INTEGER", []);
        let _ = conn.execute("ALTER TABLE memories ADD COLUMN last_accessed_at INTEGER", []);
        let _ = conn.execute("ALTER TABLE memories ADD COLUMN metadata TEXT", []);

        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS memory_versions (
                id TEXT PRIMARY KEY,
                memory_id TEXT NOT NULL,
                content TEXT NOT NULL,
                memory_type TEXT NOT NULL,
                subject TEXT NOT NULL,
                status TEXT NOT NULL,
                confidence REAL NOT NULL,
                importance REAL NOT NULL,
                changed_at INTEGER NOT NULL,
                reason TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_memory_versions_memory
                ON memory_versions(memory_id, changed_at DESC);

            CREATE TABLE IF NOT EXISTS memory_sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                memory_id TEXT NOT NULL,
                conversation_id TEXT,
                message_id TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_memory_sources_memory
                ON memory_sources(memory_id);
            "#,
        )
        .map_err(|e| format!("记忆表迁移失败: {e}"))?;

        // FTS5 is optional at runtime: if this SQLite build lacks it, the app
        // falls back to LIKE-based search. Triggers keep the index in sync.
        let _ = conn.execute_batch(
            r#"
            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                memory_id UNINDEXED,
                content,
                subject,
                tokenize='unicode61'
            );
            CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
                INSERT INTO memories_fts(memory_id, content, subject)
                VALUES (new.id, new.content, new.subject);
            END;
            CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
                DELETE FROM memories_fts WHERE memory_id = old.id;
                INSERT INTO memories_fts(memory_id, content, subject)
                SELECT new.id, new.content, new.subject WHERE new.status = 'active';
            END;
            CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
                DELETE FROM memories_fts WHERE memory_id = old.id;
            END;
            DELETE FROM memories_fts;
            INSERT INTO memories_fts(memory_id, content, subject)
                SELECT id, content, subject FROM memories WHERE status = 'active';
            "#,
        );
        Ok(())
    }
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        [key],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_and_migrates_memory_engine_schema() {
        let path = std::env::temp_dir().join(format!(
            "mind-db-test-{}.db",
            uuid::Uuid::new_v4()
        ));
        let db = Db::open(&path).expect("database opens and migrates");
        {
            let conn = db.conn.lock().unwrap();
            let columns: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('memories')
                     WHERE name IN ('memory_type','subject','confidence','importance',
                                    'status','valid_from','valid_until','metadata',
                                    'source_message_id')",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(columns, 9);
            let tables: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master
                     WHERE name IN ('memory_versions','memory_sources')",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(tables, 2);
            // FTS5 is optional; if present it must be queryable.
            let has_fts: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE name = 'memories_fts'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            if has_fts > 0 {
                conn.execute(
                    "INSERT INTO memories_fts(memory_id, content, subject)
                     VALUES ('test', '用户喜欢简洁回答', 'response_style')",
                    [],
                )
                .expect("FTS insert works");
            }
        }
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
