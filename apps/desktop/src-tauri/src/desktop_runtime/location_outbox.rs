use super::*;
use ritual_db::DeliveryOutboxKind;
use std::sync::atomic::{AtomicBool, Ordering};

static LOCATION_DRAIN_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

struct LocationDrainGuard;

impl Drop for LocationDrainGuard {
    fn drop(&mut self) {
        LOCATION_DRAIN_IN_FLIGHT.store(false, Ordering::Release);
    }
}

fn location_outbox_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| {
        home.join("Library")
            .join("Application Support")
            .join("Ritual")
            .join("location_outbox.json")
    })
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

fn submit_location_outbox_blocking(
    auth_token: String,
    backend_base: String,
    pings: Vec<DesktopLocationPing>,
) -> Result<(HashSet<String>, Vec<DesktopLocationPing>), String> {
    if pings.is_empty() {
        return Ok((HashSet::new(), Vec::new()));
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Failed to create location outbox client: {error}"))?;
    let url = format!("{backend_base}/api/user/location-pings");
    let mut processed_ids: HashSet<String> = HashSet::new();
    let mut rejected_records_all = Vec::new();

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
        rejected_records_all.extend(rejected_records);
        processed_ids.extend(chunk_processed_ids);
    }
    Ok((processed_ids, rejected_records_all))
}

async fn drain_location_outbox_once<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<usize, String> {
    if LOCATION_DRAIN_IN_FLIGHT.swap(true, Ordering::AcqRel) {
        return Ok(0);
    }
    let _guard = LocationDrainGuard;
    let auth_state = read_auth_state(&app);
    let auth_token = auth_state
        .token
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| "Auth token is unavailable for location outbox drain".to_string())?;
    let backend_base = auth_state
        .backend_base
        .filter(|base| !base.trim().is_empty())
        .ok_or_else(|| "Backend base URL is unavailable for location outbox drain".to_string())?;

    let lease_owner = format!(
        "tauri-location-{}-{}",
        std::process::id(),
        Utc::now().timestamp_millis()
    );
    let db_guard =
        crate::ritual_database::get_or_initialize_activity_db("location_outbox:claim").await?;
    let db = db_guard
        .as_ref()
        .ok_or_else(|| "Activity database is unavailable for location outbox".to_string())?;
    let claimed = db
        .claim_delivery_outbox(
            DeliveryOutboxKind::Location,
            &lease_owner,
            LOCATION_OUTBOX_BATCH_SIZE as i64,
            60_000,
        )
        .await
        .map_err(|error| error.to_string())?;
    drop(db_guard);
    if claimed.is_empty() {
        return Ok(0);
    }
    let mut pings = Vec::new();
    let mut malformed_ids = Vec::new();
    for item in &claimed {
        match serde_json::from_str::<DesktopLocationPing>(&item.payload_json) {
            Ok(ping) => pings.push(ping),
            Err(_) => malformed_ids.push(item.event_id.clone()),
        }
    }
    if !malformed_ids.is_empty() {
        if let Some(path) = location_outbox_path() {
            let malformed_payloads: Vec<String> = claimed
                .iter()
                .filter(|item| malformed_ids.contains(&item.event_id))
                .map(|item| item.payload_json.clone())
                .collect();
            append_quarantine_records(
                &path,
                "malformed",
                "invalid_sqlite_payload",
                &malformed_payloads,
            )?;
        }
        let db_guard =
            crate::ritual_database::get_or_initialize_activity_db("location_outbox:malformed")
                .await?;
        if let Some(db) = db_guard.as_ref() {
            db.acknowledge_delivery_outbox(
                DeliveryOutboxKind::Location,
                &lease_owner,
                &malformed_ids,
            )
            .await
            .map_err(|error| error.to_string())?;
        }
    }
    let submit = tauri::async_runtime::spawn_blocking(move || {
        submit_location_outbox_blocking(auth_token, backend_base, pings)
    })
    .await
    .map_err(|error| format!("Location outbox drain task failed: {error}"))?;
    let all_ids: Vec<String> = claimed.iter().map(|item| item.event_id.clone()).collect();
    let db_guard =
        crate::ritual_database::get_or_initialize_activity_db("location_outbox:commit").await?;
    let db = db_guard
        .as_ref()
        .ok_or_else(|| "Activity database is unavailable for location outbox".to_string())?;
    match submit {
        Ok((processed, rejected)) => {
            if let Some(path) = location_outbox_path() {
                append_quarantine_records(&path, "rejected", "backend_rejected", &rejected)?;
            }
            let processed_ids: Vec<String> = processed.into_iter().collect();
            let acknowledged = db
                .acknowledge_delivery_outbox(
                    DeliveryOutboxKind::Location,
                    &lease_owner,
                    &processed_ids,
                )
                .await
                .map_err(|error| error.to_string())?;
            let remaining: Vec<String> = all_ids
                .into_iter()
                .filter(|event_id| {
                    !processed_ids.contains(event_id) && !malformed_ids.contains(event_id)
                })
                .collect();
            if !remaining.is_empty() {
                db.requeue_delivery_outbox(
                    DeliveryOutboxKind::Location,
                    &lease_owner,
                    &remaining,
                    Utc::now().timestamp_millis() + 30_000,
                    "unacknowledged",
                )
                .await
                .map_err(|error| error.to_string())?;
            }
            Ok(acknowledged as usize)
        }
        Err(error) => {
            db.requeue_delivery_outbox(
                DeliveryOutboxKind::Location,
                &lease_owner,
                &all_ids,
                Utc::now().timestamp_millis() + 30_000,
                &error,
            )
            .await
            .map_err(|db_error| db_error.to_string())?;
            Err(error)
        }
    }
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
