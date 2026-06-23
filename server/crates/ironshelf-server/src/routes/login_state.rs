//! In-memory stores for login-flow state: per-account lockout and pending 2FA tokens.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

// --- Account lockout ---

const MAX_FAILED_ATTEMPTS: u32 = 5;
const LOCKOUT_DURATION: Duration = Duration::from_secs(15 * 60); // 15 min
const ATTEMPT_WINDOW: Duration = Duration::from_secs(10 * 60); // 10 min sliding

struct AttemptEntry {
    count: u32,
    window_start: Instant,
    locked_until: Option<Instant>,
}

/// Per-username failed-login backoff store.
/// Cap at MAX_FAILED_ATTEMPTS failures → 15-min lockout with LOCKOUT_DURATION.
#[derive(Clone, Default)]
pub struct LoginAttemptStore {
    entries: Arc<RwLock<HashMap<String, AttemptEntry>>>,
}

impl LoginAttemptStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns (is_locked, retry_after_secs). Does NOT consume or modify state.
    pub async fn check_locked(&self, username: &str) -> (bool, u64) {
        let entries = self.entries.read().await;
        let Some(entry) = entries.get(username) else {
            return (false, 0);
        };
        if let Some(locked_until) = entry.locked_until {
            if Instant::now() < locked_until {
                let remaining = locked_until.duration_since(Instant::now());
                return (true, remaining.as_secs() + 1);
            }
        }
        (false, 0)
    }

    /// Record one failed attempt. Returns (is_now_locked, retry_after_secs).
    pub async fn record_failure(&self, username: &str) -> (bool, u64) {
        let mut entries = self.entries.write().await;
        let now = Instant::now();

        let entry = entries.entry(username.to_string()).or_insert(AttemptEntry {
            count: 0,
            window_start: now,
            locked_until: None,
        });

        // Reset window if it's expired.
        if now.duration_since(entry.window_start) > ATTEMPT_WINDOW {
            entry.count = 0;
            entry.window_start = now;
            entry.locked_until = None;
        }

        entry.count += 1;

        if entry.count >= MAX_FAILED_ATTEMPTS {
            let locked_until = now + LOCKOUT_DURATION;
            entry.locked_until = Some(locked_until);
            (true, LOCKOUT_DURATION.as_secs())
        } else {
            (false, 0)
        }
    }

    /// Reset attempts on successful login.
    pub async fn record_success(&self, username: &str) {
        let mut entries = self.entries.write().await;
        entries.remove(username);
    }
}

// --- Pending 2FA token store ---

const TOTP_TOKEN_TTL: Duration = Duration::from_secs(5 * 60); // 5 min
const MAX_TOTP_ENTRIES: usize = 500;
const MAX_TOTP_ATTEMPTS: u32 = 6;

pub struct PendingTotp {
    pub user_id: String,
    pub username: String,
    pub is_owner: bool,
    pub created_at: Instant,
    pub attempt_count: u32,
}

impl PendingTotp {
    pub fn new(user_id: String, username: String, is_owner: bool) -> Self {
        Self {
            user_id,
            username,
            is_owner,
            created_at: Instant::now(),
            attempt_count: 0,
        }
    }
}

/// Short-lived token store bridging step-1 (password OK) → step-2 (TOTP code).
#[derive(Clone, Default)]
pub struct PendingTotpStore {
    entries: Arc<RwLock<HashMap<String, PendingTotp>>>,
}

impl PendingTotpStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn insert(&self, token: String, pending: PendingTotp) {
        let mut entries = self.entries.write().await;
        // Evict expired entries and cap size.
        let now = Instant::now();
        entries.retain(|_, e| now.duration_since(e.created_at) < TOTP_TOKEN_TTL);
        if entries.len() >= MAX_TOTP_ENTRIES {
            if let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, e)| e.created_at)
                .map(|(k, _)| k.clone())
            {
                entries.remove(&oldest);
            }
        }
        entries.insert(token, pending);
    }

    /// Take (consume) a pending entry by token. Returns None if missing/expired.
    pub async fn take(&self, token: &str) -> Option<PendingTotp> {
        let mut entries = self.entries.write().await;
        let entry = entries.remove(token)?;
        if Instant::now().duration_since(entry.created_at) >= TOTP_TOKEN_TTL {
            return None;
        }
        Some(entry)
    }

    /// Peek attempt count and return entry back into store with incremented count.
    /// Returns None if token missing/expired or attempt limit reached.
    pub async fn increment_attempt(&self, token: &str) -> Option<u32> {
        let mut entries = self.entries.write().await;
        let now = Instant::now();
        let entry = entries.get_mut(token)?;
        if now.duration_since(entry.created_at) >= TOTP_TOKEN_TTL {
            entries.remove(token);
            return None;
        }
        entry.attempt_count += 1;
        let count = entry.attempt_count;
        if count >= MAX_TOTP_ATTEMPTS {
            entries.remove(token);
            return None;
        }
        Some(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- LoginAttemptStore tests ---

    #[tokio::test]
    async fn test_lockout_not_locked_initially() {
        let store = LoginAttemptStore::new();
        let (locked, retry_after) = store.check_locked("alice").await;
        assert!(!locked);
        assert_eq!(retry_after, 0);
    }

    #[tokio::test]
    async fn test_lockout_triggers_at_max_attempts() {
        let store = LoginAttemptStore::new();
        let username = "bob";

        // Record MAX_FAILED_ATTEMPTS - 1 failures; not yet locked.
        for _ in 0..(MAX_FAILED_ATTEMPTS - 1) {
            let (locked, _) = store.record_failure(username).await;
            assert!(!locked, "should not be locked before max attempts");
        }

        // The final failure locks the account.
        let (locked, retry_after) = store.record_failure(username).await;
        assert!(locked, "should be locked at max attempts");
        assert!(retry_after > 0);

        // check_locked also confirms lockout.
        let (locked2, _) = store.check_locked(username).await;
        assert!(locked2);
    }

    #[tokio::test]
    async fn test_lockout_cleared_on_success() {
        let store = LoginAttemptStore::new();
        let username = "carol";

        // Trigger lockout.
        for _ in 0..MAX_FAILED_ATTEMPTS {
            store.record_failure(username).await;
        }
        let (locked, _) = store.check_locked(username).await;
        assert!(locked);

        // Successful login clears it.
        store.record_success(username).await;
        let (locked2, _) = store.check_locked(username).await;
        assert!(!locked2);
    }

    // --- PendingTotpStore tests ---

    #[tokio::test]
    async fn test_pending_totp_insert_and_take() {
        let store = PendingTotpStore::new();
        let token = "tok-abc".to_string();
        let pending = PendingTotp::new("uid-1".to_string(), "dave".to_string(), false);

        store.insert(token.clone(), pending).await;

        let result = store.take(&token).await;
        assert!(result.is_some());
        let p = result.unwrap();
        assert_eq!(p.user_id, "uid-1");
        assert_eq!(p.username, "dave");
        assert!(!p.is_owner);

        // Second take returns None (consumed).
        assert!(store.take(&token).await.is_none());
    }

    #[tokio::test]
    async fn test_pending_totp_missing_token_returns_none() {
        let store = PendingTotpStore::new();
        assert!(store.take("nonexistent").await.is_none());
    }

    #[tokio::test]
    async fn test_pending_totp_increment_blocks_at_max() {
        let store = PendingTotpStore::new();
        let token = "tok-xyz".to_string();
        store
            .insert(token.clone(), PendingTotp::new("uid-2".to_string(), "eve".to_string(), false))
            .await;

        // Increment up to MAX_TOTP_ATTEMPTS - 1; each returns Some.
        for i in 1..MAX_TOTP_ATTEMPTS {
            let result = store.increment_attempt(&token).await;
            assert_eq!(result, Some(i), "attempt {i} should succeed");
        }

        // The MAX_TOTP_ATTEMPTS-th increment removes the entry and returns None.
        let result = store.increment_attempt(&token).await;
        assert!(result.is_none(), "should be None at max attempts");

        // Token is gone now.
        assert!(store.take(&token).await.is_none());
    }
}
