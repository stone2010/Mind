//! Credential storage.
//! Windows uses Windows Credential Manager; the Android preview keeps secrets
//! in process memory only (never plaintext on disk, but re-entry is required
//! after an app restart until Android Keystore storage is wired in).

#[cfg(windows)]
mod platform {
    const SERVICE: &str = "com.mind.desktop";

    fn entry(provider_id: &str) -> Result<keyring::Entry, String> {
        if provider_id.trim().is_empty() {
            return Err("无效的模型提供商".into());
        }
        keyring::Entry::new(SERVICE, &format!("provider:{provider_id}"))
            .map_err(|e| format!("无法访问 Windows 凭据存储: {e}"))
    }

    pub fn save_api_key(provider_id: &str, api_key: &str) -> Result<(), String> {
        entry(provider_id)?
            .set_password(api_key.trim())
            .map_err(|e| format!("无法将 API Key 保存到 Windows 凭据存储: {e}"))
    }

    pub fn get_api_key(provider_id: &str) -> Option<String> {
        entry(provider_id)
            .ok()
            .and_then(|e| e.get_password().ok())
            .filter(|k| !k.trim().is_empty())
    }

    pub fn delete_api_key(provider_id: &str) -> Result<(), String> {
        match entry(provider_id) {
            Ok(e) => match e.delete_credential() {
                Ok(()) => Ok(()),
                // Deleting a credential that does not exist is not an error for us.
                Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(format!("无法从 Windows 凭据存储中删除 API Key: {e}")),
            },
            Err(e) => Err(e),
        }
    }

    pub fn has_api_key(provider_id: &str) -> bool {
        get_api_key(provider_id).is_some()
    }

    fn github_entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, "github:main")
            .map_err(|e| format!("无法访问 Windows 凭据存储: {e}"))
    }

    pub fn save_github_token(token: &str) -> Result<(), String> {
        let token = token.trim();
        if token.is_empty() {
            return Err("GitHub Token 不能为空".into());
        }
        github_entry()?
            .set_password(token)
            .map_err(|e| format!("无法将 GitHub Token 保存到 Windows 凭据存储: {e}"))
    }

    pub fn get_github_token() -> Option<String> {
        github_entry()
            .ok()
            .and_then(|entry| entry.get_password().ok())
            .filter(|token| !token.trim().is_empty())
    }

    pub fn delete_github_token() -> Result<(), String> {
        match github_entry() {
            Ok(entry) => match entry.delete_credential() {
                Ok(()) => Ok(()),
                Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(format!("无法从 Windows 凭据存储中删除 GitHub Token: {e}")),
            },
            Err(e) => Err(e),
        }
    }

    pub fn has_github_token() -> bool {
        get_github_token().is_some()
    }
}

#[cfg(not(windows))]
mod platform {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    fn memory() -> &'static Mutex<HashMap<String, String>> {
        static STORE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
        STORE.get_or_init(|| Mutex::new(HashMap::new()))
    }

    fn api_key_slot(provider_id: &str) -> String {
        format!("provider:{provider_id}")
    }

    pub fn save_api_key(provider_id: &str, api_key: &str) -> Result<(), String> {
        let key = api_key.trim();
        if key.is_empty() {
            return Err("API Key 不能为空".into());
        }
        memory()
            .lock()
            .map_err(|_| "凭据存储不可用".to_string())?
            .insert(api_key_slot(provider_id), key.to_string());
        Ok(())
    }

    pub fn get_api_key(provider_id: &str) -> Option<String> {
        memory()
            .lock()
            .ok()
            .and_then(|map| map.get(&api_key_slot(provider_id)).cloned())
            .filter(|key| !key.trim().is_empty())
    }

    pub fn delete_api_key(provider_id: &str) -> Result<(), String> {
        if let Ok(mut map) = memory().lock() {
            map.remove(&api_key_slot(provider_id));
        }
        Ok(())
    }

    pub fn has_api_key(provider_id: &str) -> bool {
        get_api_key(provider_id).is_some()
    }

    pub fn save_github_token(token: &str) -> Result<(), String> {
        let token = token.trim();
        if token.is_empty() {
            return Err("GitHub Token 不能为空".into());
        }
        memory()
            .lock()
            .map_err(|_| "凭据存储不可用".to_string())?
            .insert("github:main".into(), token.to_string());
        Ok(())
    }

    pub fn get_github_token() -> Option<String> {
        memory()
            .lock()
            .ok()
            .and_then(|map| map.get("github:main").cloned())
            .filter(|token| !token.trim().is_empty())
    }

    pub fn delete_github_token() -> Result<(), String> {
        if let Ok(mut map) = memory().lock() {
            map.remove("github:main");
        }
        Ok(())
    }

    pub fn has_github_token() -> bool {
        get_github_token().is_some()
    }
}

pub use platform::*;

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn credential_manager_roundtrip() {
        let id = format!("test-{}", uuid::Uuid::new_v4());
        let secret = "sk-roundtrip-test-value";
        save_api_key(&id, secret).expect("save to Windows Credential Manager");
        assert_eq!(get_api_key(&id).as_deref(), Some(secret));
        delete_api_key(&id).expect("delete credential");
        assert!(get_api_key(&id).is_none());
    }
}
