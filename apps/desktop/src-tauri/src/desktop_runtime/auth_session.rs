use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::time::Duration;
use tracing::{instrument, warn};

const AUTH_SESSION_FILE: &str = "auth_session.json";
const JWT_REFRESH_SKEW_SECS: i64 = 15;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNativeAuthSession {
    pub token: String,
    pub user_id: String,
    pub session_id: String,
    pub profile: serde_json::Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedDesktopAuthSession {
    session_id: String,
    user_id: String,
    profile: serde_json::Value,
}

fn auth_session_path() -> PathBuf {
    crate::app_paths::data_dir().join(AUTH_SESSION_FILE)
}

fn write_restricted_file(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed creating desktop auth state directory: {error}"))?;
    }
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(path)
        .map_err(|error| format!("Failed opening desktop auth file: {error}"))?;
    file.write_all(bytes)
        .map_err(|error| format!("Failed persisting desktop auth state: {error}"))?;
    Ok(())
}

pub(crate) fn persist_desktop_auth_session(
    session_id: &str,
    user_id: &str,
    profile: &serde_json::Value,
) -> Result<(), String> {
    let persisted = PersistedDesktopAuthSession {
        session_id: session_id.trim().to_string(),
        user_id: user_id.trim().to_string(),
        profile: profile.clone(),
    };
    let encoded = serde_json::to_vec(&persisted)
        .map_err(|error| format!("Failed encoding desktop auth session: {error}"))?;
    write_restricted_file(&auth_session_path(), &encoded)
}

pub(crate) fn read_desktop_auth_session() -> Option<PersistedDesktopAuthSession> {
    let bytes = fs::read(auth_session_path()).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub(crate) fn clear_desktop_auth_session() -> Result<(), String> {
    let path = auth_session_path();
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Failed removing desktop auth session: {error}"))?;
    }
    Ok(())
}

pub(crate) fn read_persisted_auth_token() -> Option<String> {
    let token_file = crate::app_paths::data_dir().join("auth_token.txt");
    fs::read_to_string(token_file)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn decode_jwt_payload(token: &str) -> Option<serde_json::Value> {
    let payload = token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload.as_bytes())
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(payload.as_bytes()))
        .ok()?;
    serde_json::from_slice(&decoded).ok()
}

pub(crate) fn jwt_needs_refresh(token: &str) -> bool {
    let Some(payload) = decode_jwt_payload(token) else {
        return true;
    };
    let Some(exp) = payload.get("exp").and_then(|value| value.as_i64()) else {
        return true;
    };
    exp <= Utc::now().timestamp() + JWT_REFRESH_SKEW_SECS
}

pub(crate) fn hydrate_auth_memory<R: Runtime>(
    app: &AppHandle<R>,
    token: &str,
    user_id: &str,
) {
    update_auth_state(app, |state| {
        state.token = Some(token.to_string());
        if !user_id.trim().is_empty() {
            state.user_id = Some(user_id.to_string());
        }
        state.last_updated_at_ms = Some(Utc::now().timestamp_millis());
    });
}

fn read_native_session_from_disk() -> Option<DesktopNativeAuthSession> {
    let persisted = read_desktop_auth_session()?;
    if persisted.session_id.trim().is_empty() || persisted.user_id.trim().is_empty() {
        return None;
    }
    Some(DesktopNativeAuthSession {
        token: read_persisted_auth_token().unwrap_or_default(),
        user_id: persisted.user_id,
        session_id: persisted.session_id,
        profile: persisted.profile,
    })
}

fn hosted_refresh_session<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
) -> Result<DesktopNativeAuthSession, String> {
    let url = super::auth_handoff::desktop_auth_handoff_consume_url(
        &super::auth_handoff::resolve_hosted_auth_origin(),
    );
    let body = serde_json::json!({ "sessionId": session_id });
    let encoded = serde_json::to_string(&body)
        .map_err(|error| format!("Failed encoding desktop auth refresh request: {error}"))?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Failed creating desktop auth refresh client: {error}"))?;
    let response = client
        .request(reqwest::Method::PATCH, &url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(
            reqwest::header::USER_AGENT,
            format!("RitualDesktop/{}", app.package_info().version),
        )
        .body(encoded)
        .send()
        .map_err(|error| format!("Desktop authentication refresh request failed: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .map_err(|error| format!("Failed reading desktop authentication refresh response: {error}"))?;
    let payload: serde_json::Value =
        serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({}));
    if status.as_u16() == 401 || status.as_u16() == 403 {
        let _ = clear_desktop_auth_session();
        let _ = crate::native_widget::clear_auth_token_on_disk();
        return Err("Desktop session refresh was rejected".to_string());
    }
    parse_hosted_session_payload(&payload, status)
}

pub(crate) fn parse_hosted_session_payload(
    payload: &serde_json::Value,
    status: reqwest::StatusCode,
) -> Result<DesktopNativeAuthSession, String> {
    let ticket = payload
        .get("ticket")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let access_token = payload
        .get("accessToken")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let session_id = payload
        .get("sessionId")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let user_id = payload
        .get("userId")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let profile = payload.get("profile").cloned().unwrap_or(serde_json::Value::Null);
    if !status.is_success() || access_token.is_none() || session_id.is_none() || user_id.is_none() {
        if ticket.is_some() {
            return Err(
                "Desktop authentication handoff returned a ticket instead of a session JWT"
                    .to_string(),
            );
        }
        let detail = payload
            .get("detail")
            .and_then(|value| value.as_str())
            .or_else(|| payload.get("error").and_then(|value| value.as_str()))
            .unwrap_or("Desktop authentication handoff was rejected.");
        return Err(detail.to_string());
    }
    Ok(DesktopNativeAuthSession {
        token: access_token.expect("access token checked"),
        user_id: user_id.expect("user id checked"),
        session_id: session_id.expect("session id checked"),
        profile,
    })
}

pub(crate) fn persist_native_auth_session(
    session: &DesktopNativeAuthSession,
) -> Result<(), String> {
    crate::native_widget::write_auth_token_to_disk(&session.token)?;
    persist_desktop_auth_session(&session.session_id, &session.user_id, &session.profile)
}

#[tauri::command]
#[instrument(skip(app))]
pub fn desktop_get_auth_token<R: Runtime>(
    app: AppHandle<R>,
    refresh: Option<bool>,
) -> Result<DesktopNativeAuthSession, String> {
    let Some(mut session) = read_native_session_from_disk() else {
        return Ok(DesktopNativeAuthSession {
            token: String::new(),
            user_id: String::new(),
            session_id: String::new(),
            profile: serde_json::Value::Null,
        });
    };
    let force_refresh = refresh.unwrap_or(false);
    if force_refresh || session.token.is_empty() || jwt_needs_refresh(&session.token) {
        match hosted_refresh_session(&app, &session.session_id) {
            Ok(refreshed) => {
                persist_native_auth_session(&refreshed)?;
                session = refreshed;
            }
            Err(error) => {
                warn!(error = %error, "Desktop auth session refresh failed");
                return Err(error);
            }
        }
    }
    hydrate_auth_memory(&app, &session.token, &session.user_id);
    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jwt_with_exp(exp: i64) -> String {
        let payload = URL_SAFE_NO_PAD.encode(format!(r#"{{"exp":{exp}}}"#));
        format!("aaa.{payload}.sig")
    }

    #[test]
    fn expired_jwt_needs_refresh() {
        assert!(jwt_needs_refresh(&jwt_with_exp(Utc::now().timestamp() - 30)));
        assert!(jwt_needs_refresh("not-a-jwt"));
        assert!(!jwt_needs_refresh(&jwt_with_exp(
            Utc::now().timestamp() + 120
        )));
    }

    #[test]
    fn consume_payload_rejects_ticket_without_access_token() {
        let payload = serde_json::json!({ "ticket": "sit_xxx" });
        let error = parse_hosted_session_payload(&payload, reqwest::StatusCode::OK)
            .expect_err("ticket-only payload");
        assert!(error.contains("ticket"));
    }

    #[test]
    fn consume_payload_reads_session_jwt() {
        let payload = serde_json::json!({
            "accessToken": "jwt-token",
            "sessionId": "sess_1",
            "userId": "user_1",
            "profile": { "id": "user_1" }
        });
        let session = parse_hosted_session_payload(&payload, reqwest::StatusCode::OK)
            .expect("session jwt payload");
        assert_eq!(session.token, "jwt-token");
        assert_eq!(session.session_id, "sess_1");
        assert_eq!(session.user_id, "user_1");
    }
}
