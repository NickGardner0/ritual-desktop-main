use super::*;

fn location_outbox_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| {
        home.join("Library")
            .join("Application Support")
            .join("Ritual")
            .join("location_outbox.json")
    })
}

fn write_location_outbox(path: &PathBuf, pings: &[DesktopLocationPing]) -> Result<(), String> {
    let json = serde_json::to_string(pings)
        .map_err(|error| format!("Failed to encode location outbox: {error}"))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|error| format!("Failed to write location outbox: {error}"))?;
    fs::rename(&tmp, path).map_err(|error| format!("Failed to replace location outbox: {error}"))
}

pub(crate) fn quarantine_text(path: &PathBuf, suffix: &str, body: &str) -> Result<(), String> {
    let quarantine =
        path.with_extension(format!("{suffix}.{}.jsonl", Utc::now().timestamp_millis()));
    fs::write(&quarantine, body).map_err(|error| {
        format!(
            "Failed to write quarantine {}: {error}",
            quarantine.display()
        )
    })
}

pub(crate) fn append_quarantine_records<T: Serialize>(
    path: &PathBuf,
    suffix: &str,
    reason: &str,
    records: &[T],
) -> Result<(), String> {
    if records.is_empty() {
        return Ok(());
    }
    let quarantine = path.with_extension(format!("{suffix}.jsonl"));
    let mut body = String::new();
    for record in records {
        let line = serde_json::to_string(&serde_json::json!({
            "reason": reason,
            "record": record,
            "quarantined_at": Utc::now().to_rfc3339(),
        }))
        .map_err(|error| format!("Failed to encode quarantine record: {error}"))?;
        body.push_str(&line);
        body.push('\n');
    }
    use std::io::Write;
    if let Some(parent) = quarantine.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create quarantine directory: {error}"))?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&quarantine)
        .map_err(|error| {
            format!(
                "Failed to open quarantine {}: {error}",
                quarantine.display()
            )
        })?;
    file.write_all(body.as_bytes()).map_err(|error| {
        format!(
            "Failed to write quarantine {}: {error}",
            quarantine.display()
        )
    })
}

fn classify_location_ack(
    parsed: &LocationIngestResponse,
    chunk: &[DesktopLocationPing],
) -> Result<(HashSet<String>, Vec<DesktopLocationPing>), String> {
    let mut acknowledged: HashSet<String> = parsed
        .accepted_ids
        .iter()
        .chain(parsed.duplicate_ids.iter())
        .cloned()
        .collect();
    let rejected: HashSet<String> = parsed.rejected_ids.iter().cloned().collect();
    if acknowledged.is_empty() && rejected.is_empty() && parsed.rejected == 0 {
        acknowledged.extend(chunk.iter().map(|ping| ping.client_event_id.clone()));
    }
    if acknowledged.is_empty() && rejected.is_empty() && parsed.rejected > 0 {
        return Err(
            "Location ingest returned rejections without IDs; keeping outbox for retry".to_string(),
        );
    }
    let rejected_records: Vec<DesktopLocationPing> = chunk
        .iter()
        .filter(|ping| rejected.contains(&ping.client_event_id))
        .cloned()
        .collect();
    let mut processed_ids = acknowledged;
    processed_ids.extend(rejected);
    Ok((processed_ids, rejected_records))
}

fn drain_location_outbox_blocking(
    auth_token: String,
    backend_base: String,
) -> Result<usize, String> {
    let Some(path) = location_outbox_path() else {
        return Ok(0);
    };
    if !path.exists() {
        return Ok(0);
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read location outbox: {error}"))?;
    if raw.trim().is_empty() {
        return Ok(0);
    }

    let pings: Vec<DesktopLocationPing> = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(error) => {
            quarantine_text(&path, "malformed", &raw)?;
            write_location_outbox(&path, &[])?;
            return Err(format!(
                "Failed to parse location outbox; quarantined malformed file: {error}"
            ));
        }
    };
    if pings.is_empty() {
        return Ok(0);
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Failed to create location outbox client: {error}"))?;
    let url = format!("{backend_base}/api/user/location-pings");
    let mut processed_ids: HashSet<String> = HashSet::new();

    for chunk in pings.chunks(LOCATION_OUTBOX_BATCH_SIZE) {
        let body = serde_json::to_string(&serde_json::json!({ "pings": chunk }))
            .map_err(|error| format!("Failed to encode location ingest body: {error}"))?;
        let response = client
            .post(&url)
            .bearer_auth(&auth_token)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body)
            .send()
            .map_err(|error| format!("Failed to submit location outbox: {error}"))?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("Location outbox request failed with HTTP {status}"));
        }

        let body = response
            .text()
            .map_err(|error| format!("Failed to read location ingest response: {error}"))?;
        let parsed: LocationIngestResponse = serde_json::from_str(&body)
            .map_err(|error| format!("Failed to parse location ingest response: {error}"))?;
        info!(
            accepted = parsed.accepted,
            rejected = parsed.rejected,
            duplicates = parsed.duplicates,
            count = chunk.len(),
            "Submitted location outbox batch"
        );

        let (chunk_processed_ids, rejected_records) = classify_location_ack(&parsed, chunk)?;
        append_quarantine_records(&path, "rejected", "backend_rejected", &rejected_records)?;
        processed_ids.extend(chunk_processed_ids);
    }

    if processed_ids.is_empty() {
        return Ok(0);
    }

    let remaining: Vec<DesktopLocationPing> = pings
        .into_iter()
        .filter(|ping| !processed_ids.contains(&ping.client_event_id))
        .collect();
    write_location_outbox(&path, &remaining)?;
    Ok(processed_ids.len())
}

async fn drain_location_outbox_once<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<usize, String> {
    let auth_state = read_auth_state(&app);
    let auth_token = auth_state
        .token
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| "Auth token is unavailable for location outbox drain".to_string())?;
    let backend_base = auth_state
        .backend_base
        .filter(|base| !base.trim().is_empty())
        .ok_or_else(|| "Backend base URL is unavailable for location outbox drain".to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        drain_location_outbox_blocking(auth_token, backend_base)
    })
    .await
    .map_err(|error| format!("Location outbox drain task failed: {error}"))?
}

pub fn trigger_location_outbox_drain<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        match drain_location_outbox_once(app.clone()).await {
            Ok(count) if count > 0 => {
                info!(count, "Location outbox drained");
            }
            Ok(_) => {}
            Err(error) => {
                if error.contains("HTTP 401") || error.contains("HTTP 403") {
                    request_token_refresh(&app);
                }
                warn!(error = %error, "Location outbox drain skipped");
            }
        }
    });
}

pub fn register_location_outbox_drain_worker<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let mut interval =
            tokio::time::interval(Duration::from_secs(LOCATION_OUTBOX_DRAIN_INTERVAL_SECS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            interval.tick().await;
            match drain_location_outbox_once(app.clone()).await {
                Ok(count) if count > 0 => {
                    info!(count, "Location outbox drained by background worker");
                }
                Ok(_) => {}
                Err(error) => {
                    if error.contains("HTTP 401") || error.contains("HTTP 403") {
                        request_token_refresh(&app);
                    }
                    warn!(error = %error, "Location outbox background drain skipped");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn temp_file(name: &str) -> PathBuf {
        let n = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = env::temp_dir().join(format!(
            "ritual-desktop-runtime-test-{}-{}",
            std::process::id(),
            n
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create test directory");
        dir.join(name)
    }

    fn location_ping(id: &str) -> DesktopLocationPing {
        DesktopLocationPing {
            lat: Some(40.0),
            lon: Some(-73.0),
            horizontal_accuracy_m: Some(25.0),
            source: "iphone_scls".to_string(),
            device_id: Some("iphone".to_string()),
            bssid: None,
            ssid: None,
            client_ts: 1_000,
            client_event_id: id.to_string(),
        }
    }

    #[test]
    fn classify_location_ack_handles_accepted_duplicates_and_rejects() {
        let chunk = vec![
            location_ping("accepted"),
            location_ping("duplicate"),
            location_ping("rejected"),
        ];
        let parsed = LocationIngestResponse {
            accepted: 1,
            rejected: 1,
            duplicates: 1,
            accepted_ids: vec!["accepted".to_string()],
            duplicate_ids: vec!["duplicate".to_string()],
            rejected_ids: vec!["rejected".to_string()],
        };

        let (processed, rejected) = classify_location_ack(&parsed, &chunk).unwrap();

        assert_eq!(processed.len(), 3);
        assert!(processed.contains("accepted"));
        assert!(processed.contains("duplicate"));
        assert!(processed.contains("rejected"));
        assert_eq!(rejected.len(), 1);
        assert_eq!(rejected[0].client_event_id, "rejected");
    }

    #[test]
    fn classify_location_ack_keeps_batch_when_rejects_have_no_ids() {
        let chunk = vec![location_ping("pending")];
        let parsed = LocationIngestResponse {
            accepted: 0,
            rejected: 1,
            duplicates: 0,
            accepted_ids: vec![],
            duplicate_ids: vec![],
            rejected_ids: vec![],
        };

        assert!(classify_location_ack(&parsed, &chunk).is_err());
    }
}
