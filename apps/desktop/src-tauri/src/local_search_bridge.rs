//! Local bridge for on-demand hybrid screen search.
//!
//! Exposes a localhost HTTP endpoint that can be called by local backend services.
//! This keeps retrieval local while allowing tool-time calls to use ritual-db hybrid
//! search (vector + FTS) on demand.

use crate::ritual_database::{self, HybridSearchOptions};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use once_cell::sync::Lazy;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

const DEFAULT_BRIDGE_PORT: u16 = 3031;
const HYBRID_PATH: &str = "/v1/hybrid-search";
const HEALTH_PATH: &str = "/health";
const READINESS_PATH: &str = "/readiness";
const TOKEN_HEADER: &str = "X-Ritual-Bridge-Token";
const DEFAULT_TOKEN_FILE_NAME: &str = "local_search_bridge.token";
const DAY_MS: i64 = 24 * 60 * 60 * 1000;
const AUTO_BACKFILL_PENDING_THRESHOLD: i64 = 800;
const AUTO_BACKFILL_BATCH_SIZE: usize = 200;
const AUTO_BACKFILL_MAX_BATCHES: usize = 600;
const AUTO_BACKFILL_LOOKBACK_DAYS: i64 = 3650;

static BRIDGE_STARTED: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));
static BRIDGE_RESTART_COUNT: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(0));

#[allow(dead_code)]
pub fn bridge_restart_count() -> u64 {
    BRIDGE_RESTART_COUNT.load(Ordering::Relaxed)
}

/// Reset the BRIDGE_STARTED flag so the watchdog can restart the bridge.
#[allow(dead_code)]
pub fn mark_bridge_stopped() {
    BRIDGE_STARTED.store(false, Ordering::SeqCst);
}

/// Check bridge health by connecting to the local health endpoint.
#[allow(dead_code)]
pub fn bridge_health_check() -> bool {
    use std::io::{Read, Write};
    use std::net::TcpStream;

    let port = std::env::var("RITUAL_LOCAL_SEARCH_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(DEFAULT_BRIDGE_PORT);
    let addr = format!("127.0.0.1:{}", port);
    let stream = match TcpStream::connect_timeout(
        &addr.parse().unwrap(),
        std::time::Duration::from_secs(2),
    ) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(2)));
    let mut stream = stream;
    let request = format!("GET {} HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n", HEALTH_PATH);
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 256];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => {
            let response = String::from_utf8_lossy(&buf[..n]);
            response.contains("200")
        }
        _ => false,
    }
}

#[allow(dead_code)]
pub fn is_bridge_started() -> bool {
    BRIDGE_STARTED.load(Ordering::SeqCst)
}

macro_rules! lsb_info {
    ($($arg:tt)*) => {
        log::info!("[LOCAL_SEARCH_BRIDGE] {}", format!($($arg)*))
    };
}

#[derive(Debug, Deserialize)]
struct HybridBridgeRequest {
    query: String,
    days_back: Option<u32>,
    limit: Option<usize>,
    min_relevance: Option<f32>,
    fts_weight: Option<f32>,
    vector_weight: Option<f32>,
    app_filter: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct HybridBridgeResultItem {
    frame_id: i64,
    timestamp: i64,
    app_bundle_id: String,
    app_name: String,
    window_title: Option<String>,
    ocr_text: String,
    relevance_score: f32,
    source: String,
    fts_matched: bool,
}

#[derive(Debug, Serialize)]
struct HybridBridgeResponse {
    success: bool,
    query: String,
    days_back: u32,
    result_count: usize,
    results: Vec<HybridBridgeResultItem>,
    mode_used: String,
    status: String,
    warning: Option<String>,
    error: Option<String>,
}

fn content_type_json() -> Header {
    Header::from_bytes("Content-Type", "application/json")
        .expect("static content-type header should be valid")
}

fn send_json<T: Serialize>(request: Request, status: u16, payload: &T) {
    let body = match serde_json::to_string(payload) {
        Ok(v) => v,
        Err(e) => {
            let fallback = format!(
                r#"{{"success":false,"error":"failed to serialize response: {}"}}"#,
                e
            );
            let response = Response::from_string(fallback)
                .with_status_code(StatusCode(500))
                .with_header(content_type_json());
            let _ = request.respond(response);
            return;
        }
    };

    let response = Response::from_string(body)
        .with_status_code(StatusCode(status))
        .with_header(content_type_json());
    let _ = request.respond(response);
}

fn normalize_days_back(days_back: Option<u32>) -> u32 {
    let value = days_back.unwrap_or(7);
    value.clamp(1, 90)
}

fn normalize_limit(limit: Option<usize>) -> usize {
    let value = limit.unwrap_or(20);
    value.clamp(1, 50)
}

fn normalize_token(value: &str) -> Option<String> {
    let token = value.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

fn bridge_token_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("RITUAL_LOCAL_SEARCH_BRIDGE_TOKEN_PATH") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }

    dirs::home_dir().map(|home| home.join(".ritual").join(DEFAULT_TOKEN_FILE_NAME))
}

fn read_token_from_file(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| normalize_token(&raw))
}

fn write_token_to_file(path: &Path, token: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "failed to create token directory {}: {}",
                parent.display(),
                e
            )
        })?;
    }

    fs::write(path, format!("{}\n", token)).map_err(|e| {
        format!(
            "failed to write bridge token file {}: {}",
            path.display(),
            e
        )
    })?;

    #[cfg(unix)]
    {
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(path, permissions).map_err(|e| {
            format!(
                "failed to set bridge token file permissions on {}: {}",
                path.display(),
                e
            )
        })?;
    }

    Ok(())
}

fn generate_bridge_token() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn resolve_bridge_token() -> Result<(String, String), String> {
    if let Ok(token_from_env) = std::env::var("RITUAL_LOCAL_SEARCH_BRIDGE_TOKEN") {
        if let Some(token) = normalize_token(&token_from_env) {
            return Ok((token, "env:RITUAL_LOCAL_SEARCH_BRIDGE_TOKEN".to_string()));
        }
    }

    let path = bridge_token_path().ok_or_else(|| {
        "could not determine bridge token path; set RITUAL_LOCAL_SEARCH_BRIDGE_TOKEN".to_string()
    })?;

    if let Some(token) = read_token_from_file(&path) {
        return Ok((token, format!("file:{}", path.display())));
    }

    let token = generate_bridge_token();
    write_token_to_file(&path, &token)?;
    Ok((token, format!("generated file:{}", path.display())))
}

fn extract_request_token(request: &Request) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv(TOKEN_HEADER))
        .and_then(|header| normalize_token(header.value.as_str()))
}

fn process_hybrid_request(payload: HybridBridgeRequest) -> HybridBridgeResponse {
    let query = payload.query.trim().to_string();
    let days_back = normalize_days_back(payload.days_back);
    let limit = normalize_limit(payload.limit);

    if query.is_empty() {
        return HybridBridgeResponse {
            success: false,
            query,
            days_back,
            result_count: 0,
            results: Vec::new(),
            mode_used: "none".to_string(),
            status: "unavailable".to_string(),
            warning: None,
            error: Some("query is required".to_string()),
        };
    }

    let now_ms = chrono::Utc::now().timestamp_millis();
    let start_ms = now_ms - i64::from(days_back) * DAY_MS;

    let mut warning: Option<String> = None;

    match ritual_database::ensure_embedding_pipeline_ready() {
        Ok(state) => {
            if let Some(init_error) = state.init_error {
                return HybridBridgeResponse {
                    success: false,
                    query,
                    days_back,
                    result_count: 0,
                    results: Vec::new(),
                    mode_used: "none".to_string(),
                    status: "unavailable".to_string(),
                    warning: Some("embedding pipeline init failed".to_string()),
                    error: Some(init_error),
                };
            }
            if state.frames_without_embeddings > 0 || state.pending_chunks > 0 {
                warning = Some(
                    "Some semantic results may be missing while embeddings finish processing. This affects semantic/evidence matches, not activity-time totals."
                        .to_string(),
                );
            }
            if state.pending_chunks >= AUTO_BACKFILL_PENDING_THRESHOLD {
                match ritual_database::start_chunk_embedding_backfill(
                    Some(AUTO_BACKFILL_BATCH_SIZE),
                    Some(AUTO_BACKFILL_MAX_BATCHES),
                    Some(AUTO_BACKFILL_LOOKBACK_DAYS),
                ) {
                    Ok(message) => {
                        lsb_info!(
                            "🛠️ Auto-triggered chunk backfill (pending_chunks={}): {}",
                            state.pending_chunks,
                            message
                        );
                    }
                    Err(err) => {
                        lsb_info!(
                            "⚠️ Failed to auto-trigger chunk backfill (pending_chunks={}): {}",
                            state.pending_chunks,
                            err
                        );
                    }
                }
            }
        }
        Err(err) => {
            return HybridBridgeResponse {
                success: false,
                query,
                days_back,
                result_count: 0,
                results: Vec::new(),
                mode_used: "none".to_string(),
                status: "unavailable".to_string(),
                warning: Some("embedding pipeline readiness check failed".to_string()),
                error: Some(err),
            };
        }
    }

    let options = HybridSearchOptions {
        query: query.clone(),
        limit: Some(limit),
        min_relevance: Some(payload.min_relevance.unwrap_or(0.3)),
        start_time: Some(start_ms),
        end_time: Some(now_ms),
        app_filter: payload.app_filter,
        fts_weight: Some(payload.fts_weight.unwrap_or(0.3)),
        vector_weight: Some(payload.vector_weight.unwrap_or(0.7)),
    };

    match ritual_database::hybrid_search(options) {
        Ok(items) => {
            let mapped: Vec<HybridBridgeResultItem> = items
                .into_iter()
                .map(|item| HybridBridgeResultItem {
                    frame_id: item.frame_id,
                    timestamp: item.timestamp,
                    app_bundle_id: item.app_bundle_id,
                    app_name: item.app_name,
                    window_title: item.window_title,
                    ocr_text: item.ocr_text,
                    relevance_score: item.combined_score.clamp(0.0, 1.0),
                    source: "hybrid".to_string(),
                    fts_matched: item.fts_matched,
                })
                .collect();

            HybridBridgeResponse {
                success: true,
                query,
                days_back,
                result_count: mapped.len(),
                results: mapped,
                mode_used: "hybrid".to_string(),
                status: "hybrid".to_string(),
                warning,
                error: None,
            }
        }
        Err(err) => HybridBridgeResponse {
            success: false,
            query,
            days_back,
            result_count: 0,
            results: Vec::new(),
            mode_used: "none".to_string(),
            status: "unavailable".to_string(),
            warning,
            error: Some(err),
        },
    }
}

fn handle_request(mut request: Request, expected_token: &str) {
    let method = request.method().clone();
    let path = request.url().split('?').next().unwrap_or(request.url());

    if method == Method::Get && path == HEALTH_PATH {
        let payload = serde_json::json!({
            "success": true,
            "status": "ok",
            "path": HEALTH_PATH,
            "restart_count": BRIDGE_RESTART_COUNT.load(Ordering::Relaxed),
        });
        send_json(request, 200, &payload);
        return;
    }

    if method == Method::Get && path == READINESS_PATH {
        let db_ok = match ritual_database::ensure_embedding_pipeline_ready() {
            Ok(_) => true,
            Err(_) => false,
        };
        let payload = serde_json::json!({
            "success": db_ok,
            "status": if db_ok { "ready" } else { "not_ready" },
            "path": READINESS_PATH,
        });
        send_json(request, if db_ok { 200 } else { 503 }, &payload);
        return;
    }

    if method != Method::Post || path != HYBRID_PATH {
        let payload = serde_json::json!({
            "success": false,
            "error": "not found",
        });
        send_json(request, 404, &payload);
        return;
    }

    if extract_request_token(&request).as_deref() != Some(expected_token) {
        let payload = serde_json::json!({
            "success": false,
            "error": "unauthorized",
        });
        send_json(request, 401, &payload);
        return;
    }

    let mut body = String::new();
    if let Err(err) = request.as_reader().read_to_string(&mut body) {
        let payload = serde_json::json!({
            "success": false,
            "error": format!("failed to read request body: {}", err),
        });
        send_json(request, 400, &payload);
        return;
    }

    let payload: HybridBridgeRequest = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(err) => {
            let payload = serde_json::json!({
                "success": false,
                "error": format!("invalid JSON body: {}", err),
            });
            send_json(request, 400, &payload);
            return;
        }
    };

    let response = process_hybrid_request(payload);
    let status = if response.success { 200 } else { 500 };
    send_json(request, status, &response);
}

pub fn start_local_search_bridge() -> Result<(), String> {
    if BRIDGE_STARTED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(());
    }

    let port = std::env::var("RITUAL_LOCAL_SEARCH_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(DEFAULT_BRIDGE_PORT);
    let addr = format!("127.0.0.1:{}", port);
    let (bridge_token, token_source) = match resolve_bridge_token() {
        Ok(value) => value,
        Err(err) => {
            BRIDGE_STARTED.store(false, Ordering::SeqCst);
            return Err(err);
        }
    };
    let expected_token = Arc::new(bridge_token);

    let server = match Server::http(&addr) {
        Ok(server) => server,
        Err(err) => {
            BRIDGE_STARTED.store(false, Ordering::SeqCst);
            return Err(format!(
                "Failed to start local search bridge at {}: {}",
                addr, err
            ));
        }
    };

    lsb_info!("🔎 Local hybrid search bridge listening on http://{}", addr);
    lsb_info!("🩺 Local hybrid search bridge health endpoint: http://{}{}", addr, HEALTH_PATH);
    lsb_info!(
        "🔐 Local hybrid search bridge token source: {}",
        token_source
    );

    thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            for request in server.incoming_requests() {
                handle_request(request, expected_token.as_str());
            }
        }));
        if let Err(panic_info) = result {
            let msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                s.to_string()
            } else if let Some(s) = panic_info.downcast_ref::<String>() {
                s.clone()
            } else {
                "unknown panic".to_string()
            };
            log::error!("[LOCAL_SEARCH_BRIDGE] Bridge thread panicked: {}. Watchdog can restart.", msg);
            BRIDGE_STARTED.store(false, Ordering::SeqCst);
        }
    });

    BRIDGE_RESTART_COUNT.fetch_add(1, Ordering::Relaxed);
    Ok(())
}
