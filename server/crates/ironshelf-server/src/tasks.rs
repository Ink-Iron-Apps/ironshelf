//! In-memory registry of background tasks (photo prefetch, scans, etc.) so the
//! UI can show progress. Best-effort + ephemeral — cleared on restart.

use std::sync::Mutex;

use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct TaskInfo {
    pub id: String,
    /// Machine kind, e.g. "author_photos".
    pub kind: String,
    /// Human label shown in the UI.
    pub label: String,
    /// "running" | "completed" | "failed".
    pub status: String,
    pub current: u64,
    pub total: u64,
    pub message: Option<String>,
    pub started_at: String,
    pub updated_at: String,
}

/// Thread-safe registry. Holds the most recent tasks (running + finished).
#[derive(Default)]
pub struct TaskRegistry {
    tasks: Mutex<Vec<TaskInfo>>,
}

impl TaskRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn now() -> String {
        chrono::Utc::now().to_rfc3339()
    }

    /// Register a new running task and return its id.
    pub fn start(&self, kind: &str, label: &str, total: u64) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Self::now();
        let info = TaskInfo {
            id: id.clone(),
            kind: kind.to_string(),
            label: label.to_string(),
            status: "running".to_string(),
            current: 0,
            total,
            message: None,
            started_at: now.clone(),
            updated_at: now,
        };
        let mut guard = self.tasks.lock().unwrap();
        guard.push(info);
        // Keep only the most recent 50 entries.
        let len = guard.len();
        if len > 50 {
            guard.drain(0..len - 50);
        }
        id
    }

    pub fn set_progress(&self, id: &str, current: u64) {
        let mut guard = self.tasks.lock().unwrap();
        if let Some(task) = guard.iter_mut().find(|task| task.id == id) {
            task.current = current;
            task.updated_at = Self::now();
        }
    }

    pub fn finish(&self, id: &str, status: &str, message: Option<String>) {
        let mut guard = self.tasks.lock().unwrap();
        if let Some(task) = guard.iter_mut().find(|task| task.id == id) {
            task.status = status.to_string();
            task.message = message;
            if status == "completed" {
                task.current = task.total;
            }
            task.updated_at = Self::now();
        }
    }

    /// Return running tasks plus finished ones from the last few minutes.
    /// Finished tasks older than the retention window are pruned so completed
    /// jobs don't linger in the UI indefinitely.
    pub fn list(&self) -> Vec<TaskInfo> {
        const FINISHED_RETENTION_SECS: i64 = 300; // 5 minutes
        let now = chrono::Utc::now();
        let mut guard = self.tasks.lock().unwrap();
        guard.retain(|task| {
            if task.status == "running" {
                return true;
            }
            chrono::DateTime::parse_from_rfc3339(&task.updated_at)
                .map(|finished_at| {
                    (now - finished_at.with_timezone(&chrono::Utc)).num_seconds()
                        < FINISHED_RETENTION_SECS
                })
                .unwrap_or(false)
        });
        guard.clone()
    }
}
