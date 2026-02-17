use std::collections::{HashMap, HashSet};
use std::time::Instant;

use libsql::{Builder, Connection};
use ritual_db::recorder::RecorderOps;
use ritual_db::types::{OcrFrame, SearchOptions};
use ritual_db::vector::{VectorOps, EMBEDDING_DIM};
use tempfile::TempDir;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QueryKind {
    Lexical,
    Semantic,
}

#[derive(Debug, Clone)]
struct TaskSpec {
    id: &'static str,
    app_bundle_id: &'static str,
    app_name: &'static str,
    window_title: &'static str,
    lexical_terms: &'static [&'static str],
    semantic_phrases: &'static [&'static str],
    seed: u64,
}

#[derive(Debug, Clone)]
struct QueryCase {
    id: &'static str,
    target_task: &'static str,
    query: &'static str,
    kind: QueryKind,
}

#[derive(Debug, Default)]
struct ModeMetrics {
    latencies_ms: Vec<f64>,
    recall_at_k: Vec<f64>,
    hit_at_k: Vec<f64>,
    mrr: Vec<f64>,
}

#[derive(Debug, Default)]
struct BenchmarkSummary {
    text: ModeMetrics,
    vector: ModeMetrics,
    hybrid: ModeMetrics,
}

#[derive(Debug)]
struct Dataset {
    task_relevant_frames: HashMap<&'static str, HashSet<i64>>,
    task_embeddings: HashMap<&'static str, Vec<f32>>,
    queries: Vec<QueryCase>,
}

#[tokio::test]
#[ignore = "benchmark-style test; run manually to profile retrieval quality"]
async fn benchmark_retrieval_quality_on_synthetic_timeline() {
    let (_db, conn, _temp) = create_test_db().await;
    let recorder_ops = RecorderOps::new(&conn);
    let vector_ops = VectorOps::new(&conn);

    if !vector_runtime_available(&vector_ops).await {
        eprintln!("Skipping benchmark: vector_distance_cos is unavailable in this runtime");
        return;
    }

    let dataset = seed_synthetic_timeline(&recorder_ops, &vector_ops).await;
    let summary = run_benchmark(&recorder_ops, &vector_ops, &dataset).await;

    print_mode_summary("text", &summary.text);
    print_mode_summary("vector", &summary.vector);
    print_mode_summary("hybrid", &summary.hybrid);

    // Basic quality expectations for the synthetic workload.
    let text_semantic_hit = mean_for_query_kind(&summary.text.hit_at_k, &dataset.queries, QueryKind::Semantic);
    let vector_semantic_hit = mean_for_query_kind(&summary.vector.hit_at_k, &dataset.queries, QueryKind::Semantic);
    let hybrid_semantic_hit = mean_for_query_kind(&summary.hybrid.hit_at_k, &dataset.queries, QueryKind::Semantic);

    assert!(vector_semantic_hit > 0.75, "Vector semantic hit@k too low: {}", vector_semantic_hit);
    assert!(hybrid_semantic_hit >= vector_semantic_hit - 0.05, "Hybrid semantic hit@k regressed vs vector");
    assert!(hybrid_semantic_hit >= text_semantic_hit + 0.25, "Hybrid should materially outperform text on semantic queries");
}

#[tokio::test]
async fn benchmark_dataset_builds_and_text_mode_is_functional() {
    let (_db, conn, _temp) = create_test_db().await;
    let recorder_ops = RecorderOps::new(&conn);
    let vector_ops = VectorOps::new(&conn);

    let dataset = seed_synthetic_timeline(&recorder_ops, &vector_ops).await;
    assert!(!dataset.queries.is_empty());

    // Text mode should always run, even when vector runtime support is absent.
    let case = &dataset.queries[0];
    let frames = recorder_ops.search_ocr_text(case.query, 10).await.unwrap();
    assert!(!frames.is_empty());
}

async fn create_test_db() -> (libsql::Database, Connection, TempDir) {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("benchmark.db");
    let db = Builder::new_local(db_path.to_str().unwrap())
        .build()
        .await
        .unwrap();
    let conn = db.connect().unwrap();
    ritual_db::schema::initialize_schema(&conn).await.unwrap();
    (db, conn, temp_dir)
}

async fn vector_runtime_available(vector_ops: &VectorOps<'_>) -> bool {
    let query_embedding = normalized_embedding(42);
    let options = SearchOptions::new(1);
    match vector_ops.semantic_search(&query_embedding, &options).await {
        Ok(_) => true,
        Err(e) => !e.to_string().to_lowercase().contains("no such function: vector_distance_cos"),
    }
}

async fn seed_synthetic_timeline(recorder_ops: &RecorderOps<'_>, vector_ops: &VectorOps<'_>) -> Dataset {
    let tasks = task_specs();
    let mut task_relevant_frames: HashMap<&'static str, HashSet<i64>> = HashMap::new();
    let mut task_embeddings: HashMap<&'static str, Vec<f32>> = HashMap::new();

    let base_ts = 1_710_000_000_000i64;
    for (task_idx, task) in tasks.iter().enumerate() {
        let centroid = normalized_embedding(task.seed);
        task_embeddings.insert(task.id, centroid.clone());

        let mut relevant_ids = HashSet::new();
        for day in 0..3 {
            for i in 0..24 {
                let timestamp = base_ts
                    + (day as i64 * 86_400_000)
                    + (task_idx as i64 * 7_500)
                    + (i as i64 * 45_000);

                let lexical_term = task.lexical_terms[i % task.lexical_terms.len()];
                let semantic_phrase = task.semantic_phrases[i % task.semantic_phrases.len()];
                let ocr_text = format!(
                    "{}. {}. Session note {}.",
                    lexical_term, semantic_phrase, i
                );

                let mut frame = OcrFrame::new(
                    timestamp,
                    task.app_bundle_id,
                    task.app_name,
                    ocr_text,
                    format!("hash-{}-{}-{}", task.id, day, i),
                );
                frame.window_title = Some(task.window_title.to_string());

                let frame_id = recorder_ops.insert_ocr_frame(&frame).await.unwrap();
                relevant_ids.insert(frame_id);

                // Vector benchmark needs vectors, but this insert may be a no-op in runtimes
                // without vector support (handled by caller checks).
                let embedding = task_frame_embedding(task.seed, (day * 100 + i) as u64);
                let _ = vector_ops.insert_embedding(frame_id, &embedding).await;
            }
        }
        task_relevant_frames.insert(task.id, relevant_ids);
    }

    Dataset {
        task_relevant_frames,
        task_embeddings,
        queries: query_cases(),
    }
}

async fn run_benchmark(
    recorder_ops: &RecorderOps<'_>,
    vector_ops: &VectorOps<'_>,
    dataset: &Dataset,
) -> BenchmarkSummary {
    let mut summary = BenchmarkSummary::default();
    let k = 10usize;

    for query_case in &dataset.queries {
        let _query_id = query_case.id;
        let query_embedding = dataset.task_embeddings.get(query_case.target_task).unwrap();
        let search_options = SearchOptions::new(k).with_min_relevance(0.15);
        let relevant = dataset.task_relevant_frames.get(query_case.target_task).unwrap();

        let start = Instant::now();
        let text_results = recorder_ops.search_ocr_text(query_case.query, k).await.unwrap();
        let text_ms = start.elapsed().as_secs_f64() * 1000.0;
        let text_ids: Vec<i64> = text_results.into_iter().filter_map(|f| f.id).collect();
        push_metrics(&mut summary.text, &text_ids, relevant, text_ms, k);

        let start = Instant::now();
        let vector_results = vector_ops.semantic_search(query_embedding, &search_options).await.unwrap();
        let vector_ms = start.elapsed().as_secs_f64() * 1000.0;
        let vector_ids: Vec<i64> = vector_results.into_iter().filter_map(|r| r.frame.id).collect();
        push_metrics(&mut summary.vector, &vector_ids, relevant, vector_ms, k);

        let start = Instant::now();
        let hybrid_results = vector_ops.hybrid_search(
            query_case.query,
            query_embedding,
            &search_options,
            0.35,
            0.65,
        ).await.unwrap();
        let hybrid_ms = start.elapsed().as_secs_f64() * 1000.0;
        let hybrid_ids: Vec<i64> = hybrid_results.into_iter().filter_map(|r| r.frame.id).collect();
        push_metrics(&mut summary.hybrid, &hybrid_ids, relevant, hybrid_ms, k);
    }

    summary
}

fn push_metrics(
    metrics: &mut ModeMetrics,
    result_ids: &[i64],
    relevant_ids: &HashSet<i64>,
    latency_ms: f64,
    k: usize,
) {
    metrics.latencies_ms.push(latency_ms);
    metrics.recall_at_k.push(recall_at_k_capped(result_ids, relevant_ids, k));
    metrics.hit_at_k.push(hit_at_k(result_ids, relevant_ids, k));
    metrics.mrr.push(mrr_at_k(result_ids, relevant_ids, k));
}

fn recall_at_k_capped(result_ids: &[i64], relevant_ids: &HashSet<i64>, k: usize) -> f64 {
    let relevant_in_top_k = result_ids
        .iter()
        .take(k)
        .filter(|id| relevant_ids.contains(id))
        .count();
    let denom = relevant_ids.len().min(k).max(1);
    relevant_in_top_k as f64 / denom as f64
}

fn hit_at_k(result_ids: &[i64], relevant_ids: &HashSet<i64>, k: usize) -> f64 {
    if result_ids.iter().take(k).any(|id| relevant_ids.contains(id)) {
        1.0
    } else {
        0.0
    }
}

fn mrr_at_k(result_ids: &[i64], relevant_ids: &HashSet<i64>, k: usize) -> f64 {
    for (rank, id) in result_ids.iter().take(k).enumerate() {
        if relevant_ids.contains(id) {
            return 1.0 / (rank as f64 + 1.0);
        }
    }
    0.0
}

fn print_mode_summary(mode: &str, metrics: &ModeMetrics) {
    let p50 = percentile(&metrics.latencies_ms, 0.50);
    let p95 = percentile(&metrics.latencies_ms, 0.95);
    let recall = mean(&metrics.recall_at_k);
    let hit = mean(&metrics.hit_at_k);
    let mrr = mean(&metrics.mrr);
    eprintln!(
        "[retrieval-benchmark] mode={} p50_ms={:.2} p95_ms={:.2} recall@10={:.3} hit@10={:.3} mrr@10={:.3}",
        mode, p50, p95, recall, hit, mrr
    );
}

fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f64>() / values.len() as f64
}

fn percentile(values: &[f64], p: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let idx = ((sorted.len() - 1) as f64 * p).round() as usize;
    sorted[idx]
}

fn mean_for_query_kind(values: &[f64], queries: &[QueryCase], kind: QueryKind) -> f64 {
    let mut selected = Vec::new();
    for (idx, query) in queries.iter().enumerate() {
        if query.kind == kind {
            selected.push(values[idx]);
        }
    }
    mean(&selected)
}

fn task_specs() -> Vec<TaskSpec> {
    vec![
        TaskSpec {
            id: "sync_reliability",
            app_bundle_id: "com.ritual.desktop",
            app_name: "Ritual Desktop",
            window_title: "Sync Queue Worker",
            lexical_terms: &[
                "sync queue retry backoff",
                "failed uploads replay",
                "dedup state recovery",
            ],
            semantic_phrases: &[
                "reprocessing unsent events after reconnect",
                "stabilizing delivery during offline intervals",
                "investigating dropped activity payloads",
            ],
            seed: 11,
        },
        TaskSpec {
            id: "metrics_ui",
            app_bundle_id: "com.microsoft.VSCode",
            app_name: "Visual Studio Code",
            window_title: "metrics page improvements",
            lexical_terms: &[
                "dashboard charts rendering",
                "react metrics component polish",
                "timeline aggregation widget",
            ],
            semantic_phrases: &[
                "cleaning up usage analytics presentation",
                "improving how focus sessions are visualized",
                "tightening summary panel behavior",
            ],
            seed: 23,
        },
        TaskSpec {
            id: "auth_research",
            app_bundle_id: "com.google.Chrome",
            app_name: "Google Chrome",
            window_title: "OAuth design notes",
            lexical_terms: &[
                "oauth token refresh docs",
                "auth flow architecture notes",
                "session security checklist",
            ],
            semantic_phrases: &[
                "reading design guidance for login reliability",
                "studying identity handoff edge cases",
                "capturing notes on account authorization flow",
            ],
            seed: 37,
        },
    ]
}

fn query_cases() -> Vec<QueryCase> {
    vec![
        QueryCase {
            id: "q_sync_lex",
            target_task: "sync_reliability",
            query: "sync queue retry backoff",
            kind: QueryKind::Lexical,
        },
        QueryCase {
            id: "q_sync_sem",
            target_task: "sync_reliability",
            query: "where did I debug offline delivery stability",
            kind: QueryKind::Semantic,
        },
        QueryCase {
            id: "q_metrics_lex",
            target_task: "metrics_ui",
            query: "dashboard charts rendering",
            kind: QueryKind::Lexical,
        },
        QueryCase {
            id: "q_metrics_sem",
            target_task: "metrics_ui",
            query: "when was I improving analytics visualization",
            kind: QueryKind::Semantic,
        },
        QueryCase {
            id: "q_auth_lex",
            target_task: "auth_research",
            query: "oauth token refresh docs",
            kind: QueryKind::Lexical,
        },
        QueryCase {
            id: "q_auth_sem",
            target_task: "auth_research",
            query: "where did I read identity flow guidance",
            kind: QueryKind::Semantic,
        },
    ]
}

fn task_frame_embedding(seed: u64, frame_idx: u64) -> Vec<f32> {
    let mut emb = normalized_embedding(seed);
    for (i, val) in emb.iter_mut().enumerate() {
        let jitter = hash_noise(seed.wrapping_add(frame_idx), i as u64) * 0.02;
        *val += jitter;
    }
    normalize(&mut emb);
    emb
}

fn normalized_embedding(seed: u64) -> Vec<f32> {
    let mut emb = vec![0.0f32; EMBEDDING_DIM];
    for (i, val) in emb.iter_mut().enumerate() {
        *val = hash_noise(seed, i as u64);
    }
    normalize(&mut emb);
    emb
}

fn hash_noise(seed: u64, index: u64) -> f32 {
    let mut x = seed ^ index.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    x ^= x >> 30;
    x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^= x >> 31;
    let unit = (x as u32) as f32 / u32::MAX as f32;
    unit * 2.0 - 1.0
}

fn normalize(values: &mut [f32]) {
    let norm = values.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm <= f32::EPSILON {
        return;
    }
    for v in values.iter_mut() {
        *v /= norm;
    }
}
