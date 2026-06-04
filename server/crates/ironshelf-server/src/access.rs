//! Per-user library access enforcement (Plex-style: a user is either limited to
//! specific libraries or sees all of them).
//!
//! The owner UI stores grants in the `library_access` table; these helpers are
//! what every content route uses to actually apply them. A user with no grant
//! rows — and every owner — is unrestricted.

use std::collections::HashSet;

use crate::auth::AuthUser;
use crate::state::AppState;

/// The set of library IDs a user may access. `None` means unrestricted (owner,
/// or a user with no grants configured). `Some(set)` restricts to that set.
pub async fn accessible_library_ids(
    state: &AppState,
    user: &AuthUser,
) -> Option<HashSet<String>> {
    if user.is_owner {
        return None;
    }
    match state.ironshelf_db.get_accessible_libraries(&user.user_id).await {
        // Specific grants configured → restrict to them.
        Ok(Some(ids)) => Some(ids.into_iter().collect()),
        // No grant rows → unrestricted (sees all libraries).
        Ok(None) => None,
        // Lookup error → fail CLOSED (deny all) rather than leak every library.
        Err(_) => Some(HashSet::new()),
    }
}

/// Whether a specific library is permitted under the given access set.
pub fn library_allowed(allowed: &Option<HashSet<String>>, library_id: &str) -> bool {
    match allowed {
        None => true,
        Some(set) => set.contains(library_id),
    }
}
