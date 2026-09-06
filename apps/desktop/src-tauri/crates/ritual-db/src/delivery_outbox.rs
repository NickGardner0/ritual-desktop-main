use libsql::{params, Connection, TransactionBehavior};

use crate::error::{DatabaseError, Result};
use crate::types::{DeliveryOutboxItem, DeliveryOutboxKind};
use std::collections::HashMap;

fn table(kind: DeliveryOutboxKind) -> &'static str {
    match kind {
        DeliveryOutboxKind::Location => "location_delivery_outbox",
        DeliveryOutboxKind::Biome => "biome_delivery_outbox",
    }
}

pub struct DeliveryOutboxOps<'a> {
    conn: &'a Connection,
}

impl<'a> DeliveryOutboxOps<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub async fn enqueue(
        &self,
        kind: DeliveryOutboxKind,
        event_id: &str,
        payload_json: &str,
    ) -> Result<bool> {
        let now = chrono::Utc::now().timestamp_millis();
        let sql = format!(
            "INSERT OR IGNORE INTO {} (event_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
            table(kind)
        );
        let changed = self
            .conn
            .execute(&sql, params![event_id, payload_json, now, now])
            .await
            .map_err(|error| DatabaseError::Query(error.to_string()))?;
        Ok(changed > 0)
    }

    pub async fn enqueue_many(
        &self,
        kind: DeliveryOutboxKind,
        items: &[(String, String)],
    ) -> Result<u64> {
        if items.is_empty() {
            return Ok(0);
        }
        let now = chrono::Utc::now().timestamp_millis();
        let sql = format!(
            "INSERT OR IGNORE INTO {} (event_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
            table(kind)
        );
        let transaction = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .await
            .map_err(|error| DatabaseError::Query(error.to_string()))?;
        let mut changed = 0;
        for (event_id, payload_json) in items {
            changed += transaction
                .execute(
                    &sql,
                    params![event_id.clone(), payload_json.clone(), now, now],
                )
                .await
                .map_err(|error| DatabaseError::Query(error.to_string()))?;
        }
        transaction
            .commit()
            .await
            .map_err(|error| DatabaseError::Query(error.to_string()))?;
        Ok(changed)
    }

    pub async fn claim(
        &self,
        kind: DeliveryOutboxKind,
        lease_owner: &str,
        limit: i64,
        lease_ms: i64,
    ) -> Result<Vec<DeliveryOutboxItem>> {
        let now = chrono::Utc::now().timestamp_millis();
        let lease_expires_at = now.saturating_add(lease_ms.max(1_000));
        let table = table(kind);
        // One immediate transaction owns selection, leasing, and loading. This
        // prevents two processes from observing the same unleased batch and
        // makes a claimed batch visible only after every row is leased.
        let transaction = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .await
            .map_err(|error| DatabaseError::Query(error.to_string()))?;
        let select_sql = format!(
            "SELECT event_id FROM {table} WHERE next_attempt_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?) ORDER BY created_at, event_id LIMIT ?"
        );
        let mut rows = transaction
            .query(&select_sql, params![now, now, limit.clamp(1, 500)])
            .await
            .map_err(|error| DatabaseError::Query(error.to_string()))?;
        let mut ids = Vec::new();
        while let Some(row) = rows
            .next()
            .await
            .map_err(|error| DatabaseError::Query(error.to_string()))?
        {
            ids.push(
                row.get::<String>(0)
                    .map_err(|error| DatabaseError::Query(error.to_string()))?,
            );
        }

        let claim_sql = format!(
            "UPDATE {table} SET lease_owner = ?, lease_expires_at = ?, updated_at = ? WHERE event_id = ?"
        );
        for event_id in ids {
            transaction
                .execute(
                    &claim_sql,
                    params![lease_owner, lease_expires_at, now, event_id],
                )
                .await
                .map_err(|error| DatabaseError::Query(error.to_string()))?;
        }

        let load_sql = format!(
            "SELECT event_id, payload_json, attempts, lease_owner, lease_expires_at FROM {table} WHERE lease_owner = ? AND lease_expires_at = ? ORDER BY created_at, event_id"
        );
        let mut rows = transaction
            .query(&load_sql, params![lease_owner, lease_expires_at])
            .await
            .map_err(|error| DatabaseError::Query(error.to_string()))?;
        let mut items = Vec::new();
        while let Some(row) = rows
            .next()
            .await
            .map_err(|error| DatabaseError::Query(error.to_string()))?
        {
            items.push(DeliveryOutboxItem {
                event_id: row
                    .get(0)
                    .map_err(|error| DatabaseError::Query(error.to_string()))?,
                payload_json: row
                    .get(1)
                    .map_err(|error| DatabaseError::Query(error.to_string()))?,
                attempts: row.get(2).unwrap_or(0),
                lease_owner: row.get(3).ok(),
                lease_expires_at: row.get(4).ok(),
            });
        }
        drop(rows);
        transaction
            .commit()
            .await
            .map_err(|error| DatabaseError::Query(error.to_string()))?;
        Ok(items)
    }

    pub async fn acknowledge(
        &self,
        kind: DeliveryOutboxKind,
        lease_owner: &str,
        event_ids: &[String],
    ) -> Result<u64> {
        let sql = format!(
            "DELETE FROM {} WHERE event_id = ? AND lease_owner = ?",
            table(kind)
        );
        let mut changed = 0;
        for event_id in event_ids {
            changed += self
                .conn
                .execute(&sql, params![event_id.clone(), lease_owner])
                .await
                .map_err(|error| DatabaseError::Query(error.to_string()))?;
        }
        Ok(changed)
    }

    pub async fn requeue(
        &self,
        kind: DeliveryOutboxKind,
        lease_owner: &str,
        event_ids: &[String],
        next_attempt_at: i64,
        last_error: &str,
    ) -> Result<u64> {
        let now = chrono::Utc::now().timestamp_millis();
        let sql = format!(
            "UPDATE {} SET attempts = attempts + 1, next_attempt_at = ?, lease_owner = NULL, lease_expires_at = NULL, last_error = ?, updated_at = ? WHERE event_id = ? AND lease_owner = ?",
            table(kind)
        );
        let mut changed = 0;
        for event_id in event_ids {
            changed += self
                .conn
                .execute(
                    &sql,
                    params![
                        next_attempt_at,
                        last_error,
                        now,
                        event_id.clone(),
                        lease_owner
                    ],
                )
                .await
                .map_err(|error| DatabaseError::Query(error.to_string()))?;
        }
        Ok(changed)
    }

    pub async fn count(&self, kind: DeliveryOutboxKind) -> Result<i64> {
        let sql = format!("SELECT COUNT(*) FROM {}", table(kind));
        let mut rows = self
            .conn
            .query(&sql, ())
            .await
            .map_err(|error| DatabaseError::Query(error.to_string()))?;
        Ok(rows
            .next()
            .await
            .map_err(|error| DatabaseError::Query(error.to_string()))?
            .and_then(|row| row.get::<i64>(0).ok())
            .unwrap_or(0))
    }

    pub async fn biome_cursors(&self) -> Result<HashMap<String, i64>> {
        let mut rows = self
            .conn
            .query(
                "SELECT source_key, committed_ts FROM biome_delivery_cursors",
                (),
            )
            .await
            .map_err(|error| DatabaseError::Query(error.to_string()))?;
        let mut cursors = HashMap::new();
        while let Some(row) = rows
            .next()
            .await
            .map_err(|error| DatabaseError::Query(error.to_string()))?
        {
            cursors.insert(
                row.get(0)
                    .map_err(|error| DatabaseError::Query(error.to_string()))?,
                row.get(1).unwrap_or(0),
            );
        }
        Ok(cursors)
    }

    pub async fn advance_biome_cursor(&self, source_key: &str, committed_ts: i64) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn
            .execute(
                r#"
                INSERT INTO biome_delivery_cursors (source_key, committed_ts, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(source_key) DO UPDATE SET
                    committed_ts = MAX(biome_delivery_cursors.committed_ts, excluded.committed_ts),
                    updated_at = excluded.updated_at
                "#,
                params![source_key, committed_ts, now],
            )
            .await
            .map_err(|error| DatabaseError::Query(error.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DatabaseConfig, RitualDatabase};
    use tempfile::TempDir;

    #[tokio::test]
    async fn leases_prevent_double_claim_and_expired_work_can_be_reclaimed() {
        let temp = TempDir::new().expect("temp dir");
        let db = RitualDatabase::open(&DatabaseConfig::with_path(temp.path().join("activity.db")))
            .await
            .expect("open database");
        db.enqueue_delivery_outbox(DeliveryOutboxKind::Location, "event-1", "{}")
            .await
            .expect("enqueue");
        let first = db
            .claim_delivery_outbox(DeliveryOutboxKind::Location, "owner-a", 10, 60_000)
            .await
            .expect("first claim");
        assert_eq!(first.len(), 1);
        let second = db
            .claim_delivery_outbox(DeliveryOutboxKind::Location, "owner-b", 10, 60_000)
            .await
            .expect("second claim");
        assert!(second.is_empty());
        db.requeue_delivery_outbox(
            DeliveryOutboxKind::Location,
            "owner-a",
            &["event-1".to_string()],
            0,
            "retry",
        )
        .await
        .expect("requeue");
        let reclaimed = db
            .claim_delivery_outbox(DeliveryOutboxKind::Location, "owner-b", 10, 60_000)
            .await
            .expect("reclaim");
        assert_eq!(reclaimed.len(), 1);
        assert_eq!(reclaimed[0].attempts, 1);
    }

    #[tokio::test]
    async fn acknowledge_requires_the_current_lease_owner() {
        let temp = TempDir::new().expect("temp dir");
        let db = RitualDatabase::open(&DatabaseConfig::with_path(temp.path().join("activity.db")))
            .await
            .expect("open database");
        db.enqueue_delivery_outbox(DeliveryOutboxKind::Biome, "event-1", "{}")
            .await
            .expect("enqueue");
        db.claim_delivery_outbox(DeliveryOutboxKind::Biome, "owner-a", 10, 60_000)
            .await
            .expect("claim");
        let wrong = db
            .acknowledge_delivery_outbox(
                DeliveryOutboxKind::Biome,
                "owner-b",
                &["event-1".to_string()],
            )
            .await
            .expect("wrong ack");
        assert_eq!(wrong, 0);
        assert_eq!(
            db.delivery_outbox_count(DeliveryOutboxKind::Biome)
                .await
                .expect("count"),
            1
        );
    }

    #[tokio::test]
    async fn enqueue_after_claim_survives_acknowledging_the_claimed_batch() {
        let temp = TempDir::new().expect("temp dir");
        let db = RitualDatabase::open(&DatabaseConfig::with_path(temp.path().join("activity.db")))
            .await
            .expect("open database");
        db.enqueue_delivery_outbox(DeliveryOutboxKind::Location, "claimed", "{}")
            .await
            .expect("enqueue claimed event");
        let claimed = db
            .claim_delivery_outbox(DeliveryOutboxKind::Location, "drainer", 10, 60_000)
            .await
            .expect("claim batch");
        assert_eq!(claimed.len(), 1);

        db.enqueue_delivery_outbox(DeliveryOutboxKind::Location, "arrived-during-drain", "{}")
            .await
            .expect("enqueue during drain");
        db.acknowledge_delivery_outbox(
            DeliveryOutboxKind::Location,
            "drainer",
            &["claimed".to_string()],
        )
        .await
        .expect("ack claimed batch");

        let next = db
            .claim_delivery_outbox(DeliveryOutboxKind::Location, "next-drainer", 10, 60_000)
            .await
            .expect("claim next batch");
        assert_eq!(next.len(), 1);
        assert_eq!(next[0].event_id, "arrived-during-drain");
    }

    #[tokio::test]
    async fn expired_lease_recovers_work_after_a_crashed_drainer() {
        let temp = TempDir::new().expect("temp dir");
        let db = RitualDatabase::open(&DatabaseConfig::with_path(temp.path().join("activity.db")))
            .await
            .expect("open database");
        db.enqueue_delivery_outbox(DeliveryOutboxKind::Biome, "crash-recovery", "{}")
            .await
            .expect("enqueue");
        db.claim_delivery_outbox(DeliveryOutboxKind::Biome, "crashed", 10, 1_000)
            .await
            .expect("initial claim");

        tokio::time::sleep(std::time::Duration::from_millis(1_050)).await;
        let recovered = db
            .claim_delivery_outbox(DeliveryOutboxKind::Biome, "recovery", 10, 60_000)
            .await
            .expect("recover expired lease");
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].event_id, "crash-recovery");
    }
}
