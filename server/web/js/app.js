// ============================================================
// Ironshelf — Production Web UI (Vanilla JS)
// ============================================================

(() => {
  'use strict';

  // Hosted mode: this same UI runs both embedded in the server (same-origin,
  // cookie auth) and on the hosted dashboard (cross-origin, Bearer-token auth).
  // ironshelf-web's index.html sets window.IRONSHELF_HOSTED = true.
  const HOSTED = !!window.IRONSHELF_HOSTED;
  const SERVER_URL = HOSTED ? (localStorage.getItem('ironshelf_server_url') || '') : '';
  const API = (HOSTED && SERVER_URL) ? `${SERVER_URL}/api/v1` : '/api/v1';
  const CLOUD_API = 'https://cloud.inknironapps.com';

  // Cross-origin media (<img>/downloads) can't set an Authorization header, so
  // we append a token as a query param the server also accepts. Empty (no-op) on
  // the same-origin server UI, which authenticates media via the session cookie.
  //
  // Preferred credential is a SHORT-LIVED, media-only scoped token fetched from
  // /auth/media-token (cached below). A leaked media URL then only exposes media
  // access for ~15 min, not a live session. If that token isn't available yet we
  // fall back to the legacy `access_token=<session-id>` so nothing breaks.
  let cachedMediaToken = null;        // current scoped media token string
  let cachedMediaTokenExpiry = 0;     // epoch ms when it expires
  let mediaTokenRefreshInFlight = null; // de-dupe concurrent refreshes

  // Re-fetch when within this window of expiry (or already expired).
  const MEDIA_TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

  function mediaTokenIsFresh() {
    return !!cachedMediaToken
      && (cachedMediaTokenExpiry - Date.now()) > MEDIA_TOKEN_REFRESH_MARGIN_MS;
  }

  // Fetch + cache a scoped media token. Safe to call repeatedly; only hits the
  // network when the cache is stale (or `force`). Never throws — on failure the
  // cache is left as-is and synchronous URL builders fall back to the session.
  async function refreshMediaToken(force = false) {
    if (!HOSTED) return;
    if (!force && mediaTokenIsFresh()) return;
    if (mediaTokenRefreshInFlight) return mediaTokenRefreshInFlight;

    mediaTokenRefreshInFlight = (async () => {
      try {
        const result = await apiGet('/auth/media-token');
        if (result && result.token) {
          cachedMediaToken = result.token;
          const ttlSeconds = Number(result.expires_in) || 900;
          cachedMediaTokenExpiry = Date.now() + ttlSeconds * 1000;
        }
      } catch {
        // Leave cache untouched; fall back to legacy behaviour.
      } finally {
        mediaTokenRefreshInFlight = null;
      }
    })();
    return mediaTokenRefreshInFlight;
  }

  function clearMediaToken() {
    cachedMediaToken = null;
    cachedMediaTokenExpiry = 0;
  }

  // Expose the scoped media token to the separate reader IIFE modules
  // (reader.js / pdf-reader.js / cbz-reader.js) so their book-file URLs can use
  // it too. Returns the current token only while fresh; readers fall back to the
  // session token when this is null. Also kicks a background refresh when stale.
  window.IronshelfMediaToken = function () {
    if (!HOSTED) return null;
    if (mediaTokenIsFresh()) return cachedMediaToken;
    refreshMediaToken();
    return cachedMediaToken; // possibly near-expiry; readers fall back if null
  };

  function mediaToken(separator = '?') {
    if (!HOSTED) return '';
    // Prefer the scoped media token. Kick off a background refresh when it's
    // getting close to expiry so subsequent synchronous builds stay valid.
    if (mediaTokenIsFresh()) {
      return `${separator}token=${encodeURIComponent(cachedMediaToken)}`;
    }
    if (cachedMediaToken) {
      // Still present but near/at expiry — use it once more and refresh.
      refreshMediaToken();
      return `${separator}token=${encodeURIComponent(cachedMediaToken)}`;
    }
    // No scoped token yet — trigger a fetch for next time, fall back to session.
    refreshMediaToken();
    const sessionToken = localStorage.getItem('ironshelf_server_token');
    return sessionToken ? `${separator}access_token=${encodeURIComponent(sessionToken)}` : '';
  }

  // Reusable author avatar: a circular initial with the portrait layered on top
  // (revealed once it loads; removed on error so the initial shows). `enabled`
  // gates the network request when author photos are turned off.
  function authorAvatarHtml(authorId, name, enabled, extraClass = 'author-avatar-sm') {
    const initial = ((name || '?').trim().charAt(0) || '?').toUpperCase();
    const img = enabled
      ? `<img class="author-avatar-img" loading="lazy" alt="" src="${API}/authors/${authorId}/photo${mediaToken()}">`
      : '';
    return `<span class="author-avatar ${extraClass}"><span class="author-avatar-initial">${escapeHtml(initial)}</span>${img}</span>`;
  }

  // Reveal portraits on load, drop them on error (CSP blocks inline handlers).
  function bindAuthorAvatars(root) {
    (root || document).querySelectorAll('.author-avatar-img:not([data-bound])').forEach((img) => {
      img.dataset.bound = '1';
      img.addEventListener('load', () => img.classList.add('loaded'));
      img.addEventListener('error', () => img.remove());
    });
  }

  let currentUser = null;
  let sidebarOpen = false;

  // --- Reading state (in-progress percents + finished set), fetched per session ---
  // inProgress: Map<bookId(string), percent(0..1)>; completed: Set<bookId(string)>.
  let readingStateInProgress = new Map();
  let readingStateCompleted = new Set();
  let readingStateLoaded = false;
  // Set when the reader is opened or a mark action runs, so the next navigation
  // re-fetches the snapshot instead of using the stale cache.
  let readingStateDirty = false;

  // Fetch the user's reading-state snapshot once and cache it. Safe to call
  // repeatedly; pass forceRefresh after progress/mark changes.
  async function loadReadingStates(forceRefresh = false) {
    if (readingStateLoaded && !forceRefresh) return;
    try {
      const states = await apiGet('/me/reading-states');
      readingStateInProgress = new Map(
        (states.in_progress || []).map(entry => [String(entry.book_id), entry.percent])
      );
      readingStateCompleted = new Set((states.completed || []).map(id => String(id)));
      readingStateLoaded = true;
    } catch (err) {
      // Non-fatal — cards just render without status overlays.
      readingStateLoaded = true;
    }
  }

  // Classify a book for the current user. Completed wins over in-progress.
  function bookReadingStatus(bookId) {
    const key = String(bookId);
    if (readingStateCompleted.has(key)) return 'finished';
    if (readingStateInProgress.has(key)) return 'reading';
    return 'unread';
  }

  // Furthest-read percent (0..100 integer) for an in-progress book, else 0.
  function bookProgressPercent(bookId) {
    const fraction = readingStateInProgress.get(String(bookId));
    return fraction ? Math.round(Math.max(0, Math.min(1, fraction)) * 100) : 0;
  }

  // Build the status overlay (progress bar + finished badge) for a book cover.
  function readingStatusOverlay(bookId) {
    const status = bookReadingStatus(bookId);
    if (status === 'finished') {
      return `<span class="read-badge" title="Read" aria-label="Read">${Icons.check || '✓'}</span>`;
    }
    if (status === 'reading') {
      const percent = bookProgressPercent(bookId);
      return `<div class="card-progress" title="${percent}% read" aria-label="${percent}% read">
        <div class="card-progress-fill" style="width:${percent}%"></div>
      </div>`;
    }
    return '';
  }

  // Mark read / mark unread toggle for the book detail page.
  function renderMarkReadButton(bookId) {
    const isFinished = bookReadingStatus(bookId) === 'finished';
    return `<button class="btn btn-secondary" id="toggle-read-btn" data-finished="${isFinished}">
      ${isFinished ? `${icon('refresh', 16)} Mark as Unread` : `${icon('check', 16)} Mark as Read`}
    </button>`;
  }

  // One-line status pill for the detail page header (Reading 42% / Read / Unread).
  function renderDetailStatusPill(bookId) {
    const status = bookReadingStatus(bookId);
    if (status === 'finished') {
      return `<span class="status-pill status-pill-finished">${icon('check', 14)} Read</span>`;
    }
    if (status === 'reading') {
      return `<span class="status-pill status-pill-reading">${bookProgressPercent(bookId)}% read</span>`;
    }
    return `<span class="status-pill status-pill-unread">Unread</span>`;
  }

  // --- Notification State ---
  let notificationUnreadCount = 0;
  let notificationPollTimer = null;
  let notificationPanelOpen = false;
  let activeScanLibraryId = null;
  let scanPollTimer = null;
  let conversionPollTimer = null;

  // --- Server Version (fetched once from /health) ---
  let cachedServerVersion = null;

  // --- Server settings (feature toggles, fetched once) ---
  let cachedServerSettings = null;
  async function getServerSettings(forceRefresh = false) {
    if (cachedServerSettings && !forceRefresh) return cachedServerSettings;
    try {
      cachedServerSettings = await apiGet('/server/settings');
    } catch (_) {
      cachedServerSettings = { author_images_enabled: true };
    }
    return cachedServerSettings;
  }

  // --- Navigation Generation Counter (race condition guard) ---
  // Incremented on every route change. Async render functions capture it
  // before awaiting and bail out if it changed (user navigated elsewhere).
  let navigationGeneration = 0;

  function isStaleNavigation(capturedGeneration) {
    return capturedGeneration !== navigationGeneration;
  }

  // --- SVG Icons ---
  const Icons = {
    library: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    author: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    series: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="6" height="18" rx="1"/><rect x="9" y="6" width="6" height="15" rx="1"/><rect x="16" y="1" width="6" height="20" rx="1"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    alertCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    sortAsc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
    sortDesc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    bookOpen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    collection: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    arrowUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
    arrowDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    barChart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>',
    activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    hardDrive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    bellOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
    scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    grip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    fileText: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    package: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
    wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
    rss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>',
    crosshair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>',
    arrowDownCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="8" x2="12" y2="16"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z"/></svg>',
    pinOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M15 9.34V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1v2.34"/><path d="M2 2l20 20"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  };

  function icon(name, size = 20) {
    return `<span class="nav-icon" style="width:${size}px;height:${size}px">${Icons[name] || ''}</span>`;
  }

  // --- Utility ---

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // --- Pinned Libraries (localStorage) ---

  const PINNED_LIBRARIES_KEY = 'ironshelf_pinned_libraries';
  const MAX_PINNED_LIBRARIES = 10;

  function getPinnedLibraries() {
    try {
      const stored = localStorage.getItem(PINNED_LIBRARIES_KEY);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore corrupt data */ }
    return [];
  }

  // localStorage holds a cache of the server-synced pins for instant render and
  // offline use; the server is the source of truth (see refreshPinnedLibraries).
  function setPinnedLibraries(pinned) {
    localStorage.setItem(PINNED_LIBRARIES_KEY, JSON.stringify(pinned));
  }

  function isLibraryPinned(libraryId) {
    return getPinnedLibraries().some(p => p.id === libraryId);
  }

  // Push the full pin set to the server (pin/unpin/reorder are all "replace the
  // list"). Best-effort: the localStorage cache is already updated, so a failed
  // sync just means it retries on the next change / next load.
  async function syncPinnedLibraries(pinned) {
    try {
      await apiPut('/me/pinned-libraries', { libraries: pinned });
    } catch (syncError) {
      console.warn('Failed to sync pinned libraries to server:', syncError);
    }
  }

  // Pull the authoritative pin set from the server into the localStorage cache.
  // Called after auth so pins follow the account across devices/origins. Silent
  // on failure (offline, or an older server without the endpoint) — the cache
  // is kept as-is so pins still render.
  async function refreshPinnedLibraries() {
    try {
      const serverPinned = await apiGet('/me/pinned-libraries');
      if (!Array.isArray(serverPinned)) return;
      const localPinned = getPinnedLibraries();
      // First run after upgrade: the user has local pins but the server has none
      // yet. Migrate the local set up instead of clobbering it with empty.
      if (serverPinned.length === 0 && localPinned.length > 0) {
        await syncPinnedLibraries(localPinned);
        return;
      }
      setPinnedLibraries(serverPinned);
    } catch { /* keep cached pins */ }
  }

  function togglePinLibrary(library) {
    let pinned = getPinnedLibraries();
    const existingIndex = pinned.findIndex(p => p.id === library.id);
    if (existingIndex !== -1) {
      pinned.splice(existingIndex, 1);
    } else {
      if (pinned.length >= MAX_PINNED_LIBRARIES) {
        toast(`Maximum ${MAX_PINNED_LIBRARIES} pinned libraries reached`, 'warning');
        return false;
      }
      pinned.push({
        id: library.id,
        name: library.name,
        source_kind: library.source_kind,
      });
    }
    setPinnedLibraries(pinned);
    syncPinnedLibraries(pinned);
    return true;
  }

  /**
   * Sanitize HTML description content from the API.
   * Allows a safe subset of tags (p, br, em, strong, i, b, ul, ol, li, a, span)
   * and strips everything else to prevent XSS from untrusted metadata.
   */
  function sanitizeDescription(html) {
    if (!html) return '';
    const allowedTags = new Set([
      'p', 'br', 'em', 'strong', 'i', 'b', 'u', 'ul', 'ol', 'li',
      'a', 'span', 'div', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    ]);
    const allowedAttributes = { a: ['href', 'title'], span: ['class'], div: ['class'] };

    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html), 'text/html');

    // Some inputs (e.g. <frameset> or otherwise malformed markup) yield a
    // document with no body. Fall back to escaped plain text instead of crashing.
    if (!doc || !doc.body) return escapeHtml(String(html));

    function cleanNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toLowerCase();
        if (!allowedTags.has(tagName)) {
          // Replace with text content
          const textNode = doc.createTextNode(node.textContent);
          node.parentNode.replaceChild(textNode, node);
          return;
        }
        // Strip disallowed attributes
        const allowed = allowedAttributes[tagName] || [];
        const attributeNames = [...node.getAttributeNames()];
        for (const attributeName of attributeNames) {
          if (!allowed.includes(attributeName)) {
            node.removeAttribute(attributeName);
          }
        }
        // Sanitize href to prevent javascript: URLs
        if (tagName === 'a' && node.hasAttribute('href')) {
          const href = node.getAttribute('href');
          if (href && !href.match(/^https?:\/\//i) && !href.startsWith('/') && !href.startsWith('#')) {
            node.removeAttribute('href');
          }
          // Force external links to open in new tab
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
        // Recurse into children (iterate in reverse since we may modify the list)
        const children = [...node.childNodes];
        for (const child of children) {
          cleanNode(child);
        }
      }
    }

    // Clean the body's children, not the body node itself: cleanNode replaces
    // any element whose tag is not allowed, and 'body' is not in allowedTags,
    // so cleaning the body would delete it and null out doc.body.
    for (const child of [...doc.body.childNodes]) {
      cleanNode(child);
    }
    return doc.body.innerHTML;
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function setTitle(parts) {
    document.title = parts.filter(Boolean).concat('Ironshelf').join(' — ');
  }

  // --- API Helpers ---

  async function api(path, options = {}) {
    // Hosted UI is cross-origin → authenticate with the stored server token as
    // a Bearer header (cookies don't cross origins). Server UI uses the cookie.
    const serverToken = HOSTED ? localStorage.getItem('ironshelf_server_token') : null;
    const response = await fetch(`${API}${path}`, {
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(serverToken ? { 'Authorization': `Bearer ${serverToken}` } : {}),
        ...options.headers,
      },
      ...options,
    });

    if (response.status === 401) {
      currentUser = null;
      navigateTo('/login');
      return null;
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ error: `Request failed (${response.status})` }));
      throw new Error(errorBody.error || `HTTP ${response.status}`);
    }

    if (response.status === 204) return null;
    // Tolerate empty/non-JSON success bodies (e.g. 202 Accepted from scan).
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function apiGet(path) { return api(path); }
  function apiPost(path, body) { return api(path, { method: 'POST', body: JSON.stringify(body) }); }
  function apiPut(path, body) { return api(path, { method: 'PUT', body: JSON.stringify(body) }); }
  function apiPatch(path, body) { return api(path, { method: 'PATCH', body: JSON.stringify(body) }); }
  function apiDelete(path) { return api(path, { method: 'DELETE' }); }

  // --- Server Version ---

  // Health endpoint lives on the server (cross-origin in hosted mode).
  const HEALTH_URL = (HOSTED && SERVER_URL) ? `${SERVER_URL}/health` : '/health';

  // Version the UI booted with; if the server later reports a different one,
  // the binary was updated and the cached UI is stale → reload.
  let bootServerVersion = null;
  let reloadingForUpdate = false;

  async function fetchServerVersion(forceRefresh = false) {
    if (cachedServerVersion && !forceRefresh) return cachedServerVersion;
    try {
      const healthResponse = await fetch(HEALTH_URL);
      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        cachedServerVersion = healthData.version || null;
        if (bootServerVersion === null) bootServerVersion = cachedServerVersion;
        updateSidebarVersion();
      }
    } catch {
      // Silently ignore — version display is non-critical.
    }
    return cachedServerVersion;
  }

  // Detect a server update and reload so the new embedded UI is loaded.
  async function checkForServerUpdate() {
    if (reloadingForUpdate || !bootServerVersion) return;
    try {
      const healthResponse = await fetch(HEALTH_URL, { cache: 'no-store' });
      if (!healthResponse.ok) return;
      const healthData = await healthResponse.json();
      const liveVersion = healthData.version || null;
      if (liveVersion && liveVersion !== bootServerVersion) {
        reloadingForUpdate = true;
        cachedServerVersion = liveVersion;
        try { toast(`Server updated to v${liveVersion} — refreshing…`, 'success'); } catch {}
        setTimeout(() => window.location.reload(), 1200);
      }
    } catch {
      // Ignore — server may be briefly restarting during an update.
    }
  }

  function updateSidebarVersion() {
    const versionElement = document.getElementById('sidebar-version');
    if (versionElement && cachedServerVersion) {
      versionElement.textContent = `v${cachedServerVersion}`;
    }
  }

  // --- Toast System ---

  function toast(message, type = 'success', duration = 4000) {
    const container = document.getElementById('toast-container');
    const iconMap = { success: Icons.check, error: Icons.alertCircle, info: Icons.info, warning: Icons.warning };

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', 'alert');
    el.innerHTML = `
      <span class="toast-icon">${iconMap[type] || iconMap.info}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
      <button class="toast-dismiss" aria-label="Dismiss notification">${Icons.x}</button>
    `;

    container.appendChild(el);

    const dismiss = () => {
      el.classList.add('toast-exit');
      setTimeout(() => el.remove(), 200);
    };

    el.querySelector('.toast-dismiss').addEventListener('click', dismiss);
    setTimeout(dismiss, duration);
  }

  // --- Notification System ---

  const NotificationTypeConfig = {
    new_book:           { icon: 'book',     accentClass: 'notif-accent-teal',    label: 'New Book' },
    metadata_enriched:  { icon: 'database', accentClass: 'notif-accent-green',   label: 'Metadata Updated' },
    collection_shared:  { icon: 'users',    accentClass: 'notif-accent-blue',    label: 'Collection Shared' },
    system:             { icon: 'info',     accentClass: 'notif-accent-yellow',  label: 'System' },
  };

  function getNotificationPreferences() {
    try {
      const stored = localStorage.getItem('ironshelf_notification_prefs');
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return { new_book: true, metadata_enriched: true, collection_shared: true, system: true };
  }

  function setNotificationPreferences(prefs) {
    localStorage.setItem('ironshelf_notification_prefs', JSON.stringify(prefs));
  }

  function formatRelativeTime(dateString) {
    if (!dateString) return '';
    const now = Date.now();
    const then = new Date(dateString).getTime();
    const diffSeconds = Math.floor((now - then) / 1000);
    if (diffSeconds < 60) return 'just now';
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return new Date(dateString).toLocaleDateString();
  }

  async function fetchNotificationCount() {
    if (!currentUser) return;
    try {
      const result = await apiGet('/notifications/count');
      notificationUnreadCount = result?.unread || 0;
      updateNotificationBadge();
    } catch { /* silent fail on poll */ }
  }

  function updateNotificationBadge() {
    const badgeElements = document.querySelectorAll('.notif-badge-count');
    badgeElements.forEach(badge => {
      if (notificationUnreadCount > 0) {
        badge.textContent = notificationUnreadCount > 99 ? '99+' : notificationUnreadCount;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    });
  }

  function startNotificationPolling() {
    stopNotificationPolling();
    fetchNotificationCount();
    notificationPollTimer = setInterval(() => {
      fetchNotificationCount();
      checkForServerUpdate();
    }, 30000);
  }

  function stopNotificationPolling() {
    if (notificationPollTimer) {
      clearInterval(notificationPollTimer);
      notificationPollTimer = null;
    }
  }

  async function openNotificationPanel() {
    if (notificationPanelOpen) {
      closeNotificationPanel();
      return;
    }

    notificationPanelOpen = true;
    const bellButton = document.getElementById('notification-bell');
    if (!bellButton) return;

    // Remove existing panel
    document.getElementById('notification-panel')?.remove();

    const panel = document.createElement('div');
    panel.id = 'notification-panel';
    panel.className = 'notification-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Notifications');

    panel.innerHTML = `
      <div class="notification-panel-header">
        <h3>Notifications</h3>
        <button class="btn btn-ghost btn-sm" id="notif-mark-all-read" aria-label="Mark all as read">
          ${icon('check', 14)} Mark all read
        </button>
      </div>
      <div class="notification-panel-body" id="notification-panel-body">
        <div style="padding:var(--space-6);text-align:center;color:var(--color-muted);font-size:var(--text-sm)">Loading...</div>
      </div>
    `;

    // Position panel below bell
    bellButton.parentElement.appendChild(panel);

    // Load notifications
    await loadNotificationItems();

    // Bind mark all read
    document.getElementById('notif-mark-all-read')?.addEventListener('click', async () => {
      try {
        await apiPost('/notifications/read-all', {});
        notificationUnreadCount = 0;
        updateNotificationBadge();
        await loadNotificationItems();
        toast('All notifications marked as read', 'info');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    // Close on outside click (next tick)
    requestAnimationFrame(() => {
      document.addEventListener('click', handleNotificationOutsideClick);
    });
  }

  function handleNotificationOutsideClick(event) {
    const panel = document.getElementById('notification-panel');
    const bell = document.getElementById('notification-bell');
    if (panel && !panel.contains(event.target) && bell && !bell.contains(event.target)) {
      closeNotificationPanel();
    }
  }

  function closeNotificationPanel() {
    notificationPanelOpen = false;
    document.getElementById('notification-panel')?.remove();
    document.removeEventListener('click', handleNotificationOutsideClick);
  }

  async function loadNotificationItems() {
    const body = document.getElementById('notification-panel-body');
    if (!body) return;

    try {
      const notifications = await apiGet('/notifications?unread=true&limit=50') || [];
      const prefs = getNotificationPreferences();

      // Filter by user preferences
      const filteredNotifications = notifications.filter(n => {
        const notificationType = n.notification_type || n.type || 'system';
        return prefs[notificationType] !== false;
      });

      if (filteredNotifications.length === 0) {
        body.innerHTML = `
          <div class="notification-empty">
            ${Icons.bell}
            <p>No unread notifications</p>
          </div>
        `;
        return;
      }

      body.innerHTML = filteredNotifications.map(notification => {
        const notificationType = notification.notification_type || notification.type || 'system';
        const typeConfig = NotificationTypeConfig[notificationType] || NotificationTypeConfig.system;
        const isUnread = !notification.read_at;
        const timeAgo = formatRelativeTime(notification.created_at);

        return `
          <div class="notification-item ${typeConfig.accentClass} ${isUnread ? 'notification-unread' : ''}"
               data-notification-id="${notification.id}"
               ${notification.link ? `data-notification-link="${escapeHtml(notification.link)}"` : ''}
               role="button" tabindex="0">
            <div class="notification-item-icon">
              ${Icons[typeConfig.icon] || Icons.info}
            </div>
            <div class="notification-item-content">
              <div class="notification-item-title">${escapeHtml(notification.title || typeConfig.label)}</div>
              ${notification.message ? `<div class="notification-item-message">${escapeHtml(notification.message)}</div>` : ''}
              <div class="notification-item-time">${timeAgo}</div>
            </div>
            <div class="notification-item-actions">
              ${isUnread ? '<span class="notification-unread-dot" aria-label="Unread"></span>' : ''}
              <button class="notification-dismiss-btn" data-dismiss-id="${notification.id}" aria-label="Dismiss notification" title="Dismiss">
                ${Icons.x}
              </button>
            </div>
          </div>
        `;
      }).join('');

      // Bind click on notification items
      body.querySelectorAll('.notification-item').forEach(item => {
        item.addEventListener('click', async (event) => {
          if (event.target.closest('.notification-dismiss-btn')) return;
          const notificationId = item.dataset.notificationId;
          const notificationLink = item.dataset.notificationLink;

          // Mark as read
          try {
            await apiPatch(`/notifications/${notificationId}/read`, {});
            item.classList.remove('notification-unread');
            item.querySelector('.notification-unread-dot')?.remove();
            notificationUnreadCount = Math.max(0, notificationUnreadCount - 1);
            updateNotificationBadge();
          } catch { /* ignore */ }

          // Navigate if link present
          if (notificationLink) {
            closeNotificationPanel();
            navigateTo(notificationLink);
          }
        });

        item.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            item.click();
          }
        });
      });

      // Bind dismiss buttons
      body.querySelectorAll('.notification-dismiss-btn').forEach(btn => {
        btn.addEventListener('click', async (event) => {
          event.stopPropagation();
          const dismissId = btn.dataset.dismissId;
          const item = btn.closest('.notification-item');

          try {
            await apiDelete(`/notifications/${dismissId}`);
            if (item?.classList.contains('notification-unread')) {
              notificationUnreadCount = Math.max(0, notificationUnreadCount - 1);
              updateNotificationBadge();
            }
            item?.remove();

            // Check if empty
            if (!body.querySelector('.notification-item')) {
              body.innerHTML = `
                <div class="notification-empty">
                  ${Icons.bell}
                  <p>No unread notifications</p>
                </div>
              `;
            }
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      });
    } catch (err) {
      body.innerHTML = `
        <div style="padding:var(--space-6);text-align:center;color:var(--color-muted);font-size:var(--text-sm)">
          Failed to load notifications
        </div>
      `;
    }
  }

  // --- Library Scan Progress ---

  async function startLibraryScan(libraryId) {
    if (activeScanLibraryId) return;
    activeScanLibraryId = libraryId;

    const scanButton = document.getElementById('scan-library-btn');
    const scanStatusContainer = document.getElementById('scan-status');

    if (scanButton) {
      scanButton.disabled = true;
      scanButton.innerHTML = `${icon('scan', 16)} Scanning...`;
    }

    if (scanStatusContainer) {
      scanStatusContainer.classList.remove('hidden');
      scanStatusContainer.innerHTML = `
        <div class="scan-progress-wrap">
          <div class="progress-bar progress-bar-indeterminate">
            <div class="progress-bar-fill"></div>
          </div>
          <span class="scan-status-text">Scanning library...</span>
        </div>
      `;
    }

    // Get initial book count
    let initialBookCount = 0;
    try {
      const library = await apiGet(`/libraries/${libraryId}`);
      initialBookCount = library?.book_count || 0;
    } catch { /* ignore */ }

    // Trigger scan
    try {
      await api(`/libraries/${libraryId}/scan`, { method: 'POST' });
    } catch (err) {
      toast(err.message || 'Failed to start scan', 'error');
      resetScanState();
      return;
    }

    // Poll for completion
    let pollCount = 0;
    const maxPolls = 150; // 5 minutes at 2-second intervals

    scanPollTimer = setInterval(async () => {
      pollCount++;

      try {
        const library = await apiGet(`/libraries/${libraryId}`);
        const currentBookCount = library?.book_count || 0;
        const isScanDone = library?.scanning === false || library?.scan_status === 'idle' || library?.scan_status === 'complete';

        if (isScanDone || pollCount >= maxPolls) {
          clearInterval(scanPollTimer);
          scanPollTimer = null;
          activeScanLibraryId = null;

          const newBooksFound = Math.max(0, currentBookCount - initialBookCount);
          toast(`Scan complete: ${newBooksFound} new book${newBooksFound !== 1 ? 's' : ''} found`, 'success');
          resetScanState();

          // Refresh the library view
          renderLibrary(libraryId);
        }
      } catch {
        // Network hiccup — keep polling
      }
    }, 2000);
  }

  function resetScanState() {
    const scanButton = document.getElementById('scan-library-btn');
    const scanStatusContainer = document.getElementById('scan-status');

    if (scanButton) {
      scanButton.disabled = false;
      scanButton.innerHTML = `${icon('scan', 16)} Scan`;
    }

    if (scanStatusContainer) {
      scanStatusContainer.classList.add('hidden');
      scanStatusContainer.innerHTML = '';
    }

    if (scanPollTimer) {
      clearInterval(scanPollTimer);
      scanPollTimer = null;
    }
    activeScanLibraryId = null;
  }

  // --- Modal System ---

  function showModal({ title, description, content, actions, onClose }) {
    const root = document.getElementById('modal-root');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'modal-title');

    overlay.innerHTML = `
      <div class="modal">
        <button class="modal-close" aria-label="Close dialog">${Icons.x}</button>
        <h2 id="modal-title">${escapeHtml(title)}</h2>
        ${description ? `<p class="modal-description">${escapeHtml(description)}</p>` : ''}
        <div class="modal-content">${content}</div>
        ${actions ? `<div class="modal-actions">${actions}</div>` : ''}
      </div>
    `;

    root.appendChild(overlay);

    const closeModal = () => {
      overlay.remove();
      if (onClose) onClose();
    };

    overlay.querySelector('.modal-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Focus trap and keyboard handling
    // Query focusable elements dynamically since modal content may change
    function getFocusableElements() {
      return overlay.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
    }

    const initialFocusable = getFocusableElements();
    if (initialFocusable[0]) initialFocusable[0].focus();

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal();
        return;
      }
      if (e.key === 'Tab') {
        const focusableElements = getFocusableElements();
        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];
        if (!firstFocusable) return;
        if (e.shiftKey && document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable.focus();
        } else if (!e.shiftKey && document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable.focus();
        }
      }
    });

    return { overlay, close: closeModal };
  }

  function showConfirmModal({ title, message, confirmText = 'Confirm', confirmClass = 'btn-danger', onConfirm }) {
    const { close } = showModal({
      title,
      description: message,
      content: '',
      actions: `
        <button class="btn btn-ghost" data-action="cancel">Cancel</button>
        <button class="btn ${confirmClass}" data-action="confirm">${escapeHtml(confirmText)}</button>
      `,
    });

    const modal = document.querySelector('.modal-overlay:last-child');
    modal.querySelector('[data-action="cancel"]').addEventListener('click', close);
    modal.querySelector('[data-action="confirm"]').addEventListener('click', async () => {
      if (onConfirm) await onConfirm();
      close();
    });
  }

  // --- Router ---

  const routes = new Map();
  let currentRoute = null;
  let breadcrumbTrail = [];

  function navigateTo(path) {
    window.location.hash = '#' + path;
  }

  function getHashPath() {
    return window.location.hash.slice(1) || '/';
  }

  function parseRoute(hash) {
    // Strip query string before parsing path segments
    const pathOnly = hash.split('?')[0];
    const parts = pathOnly.split('/').filter(Boolean);
    if (parts.length === 0) return { name: 'home', params: {} };

    const name = parts[0];
    const params = {};

    if (parts.length > 1) params.id = parts[1];
    if (parts.length > 2) params.sub = parts[2];

    return { name, params };
  }

  async function route() {
    const path = getHashPath();
    const parsed = parseRoute(path);

    navigationGeneration++;
    closeSidebar();
    closeNotificationPanel();

    // Refresh reading-state overlays when returning from the reader (progress
    // may have advanced) or after a mark read/unread action; otherwise use the
    // cached snapshot. Logged-in routes only.
    if (currentUser) {
      await loadReadingStates(readingStateDirty);
      readingStateDirty = false;
    }

    // Clear any active conversion poll from previous page
    if (conversionPollTimer) {
      clearInterval(conversionPollTimer);
      conversionPollTimer = null;
    }
    // Clear acquisition download auto-refresh
    if (acquisitionDownloadTimer) {
      clearInterval(acquisitionDownloadTimer);
      acquisitionDownloadTimer = null;
    }

    const handlers = {
      home: renderHome,
      login: renderLogin,
      register: renderRegister,
      'cloud-login': renderCloudLogin,
      'cloud-servers': renderCloudServerPicker,
      libraries: renderLibraries,
      library: () => renderLibrary(parsed.params.id),
      author: () => renderAuthor(parsed.params.id),
      series: () => renderSeries(parsed.params.id),
      book: () => renderBook(parsed.params.id),
      read: () => openReader(parsed.params.id, detectReaderFormat(parsed.params.sub) || 'epub', parsed.params.sub),
      mybooks: renderMyBooks,
      collections: renderCollections,
      collection: () => renderCollectionDetail(parsed.params.id),
      settings: () => renderSettings(parsed.params.id),
      users: renderUsers,
      stats: renderStats,
      activity: renderActivity,
      queue: renderReadingQueue,
      highlights: renderHighlights,
      bookmarks: renderBookmarks,
      genres: renderGenres,
      genre: () => renderGenreDetail(parsed.params.id),
      webhooks: renderWebhooks,
      duplicates: renderDuplicates,
      acquisition: () => renderAcquisition(parsed.params.id),
      books: () => {
        if (parsed.params.id === 'missing-metadata') return renderMissingMetadata();
        return renderHome();
      },
    };

    const handler = handlers[parsed.name];
    if (handler) {
      currentRoute = parsed.name;
      await handler();
    } else {
      navigateTo('/');
    }
  }

  // --- Reader Integration ---

  const readerScripts = {
    epub: { loaded: false, src: '/js/reader.js', global: 'IronshelfReader' },
    pdf: { loaded: false, src: '/js/pdf-reader.js', global: 'IronshelfPdfReader' },
    cbz: { loaded: false, src: '/js/cbz-reader.js', global: 'IronshelfCbzReader' },
  };

  function loadReaderScript(format) {
    const entry = readerScripts[format || 'epub'];
    if (!entry) return Promise.reject(new Error(`Unknown reader format: ${format}`));
    if (entry.loaded && window[entry.global]) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = entry.src;
      script.onload = () => { entry.loaded = true; resolve(); };
      script.onerror = () => reject(new Error(`Failed to load ${format} reader module`));
      document.head.appendChild(script);
    });
  }

  function detectReaderFormat(formatString) {
    const lower = (formatString || '').toLowerCase();
    if (lower === 'epub') return 'epub';
    if (lower === 'pdf') return 'pdf';
    if (lower === 'cbz' || lower === 'cbr' || lower === 'cb7') return 'cbz';
    return null;
  }

  async function openReader(bookId, format, actualFormat) {
    const readerFormat = format || 'epub';
    const entry = readerScripts[readerFormat];
    if (!entry) {
      toast(`No reader available for ${readerFormat.toUpperCase()} format`, 'error');
      navigateTo(`/book/${bookId}`);
      return;
    }

    try {
      await loadReaderScript(readerFormat);
      const reader = window[entry.global];
      if (reader) {
        readingStateDirty = true; // progress will change while reading
        reader.open(bookId, actualFormat || readerFormat);
      } else {
        toast('Reader module failed to initialize', 'error');
        navigateTo(`/book/${bookId}`);
      }
    } catch (err) {
      toast(err.message || 'Failed to open reader', 'error');
      navigateTo(`/book/${bookId}`);
    }
  }

  // --- Auth ---

  async function checkAuth() {
    try {
      currentUser = await apiGet('/auth/me');
      // Pre-fetch a scoped media token so synchronous URL builders (covers,
      // author photos, download links) can use it instead of the session id.
      // Non-blocking and best-effort: media falls back to the session if absent.
      refreshMediaToken(true);
      // Sync server-side pinned libraries into the localStorage cache before the
      // first render so the sidebar shows the account's pins on any device/origin.
      await refreshPinnedLibraries();
      return true;
    } catch {
      return false;
    }
  }

  /** Check if the current user has a specific permission.
   *  Owners implicitly have all permissions. */
  function hasPermission(permission) {
    if (!currentUser) return false;
    if (currentUser.is_owner) return true;
    return Array.isArray(currentUser.permissions) && currentUser.permissions.includes(permission);
  }

  // --- Skeleton Loaders ---

  function skeletonCards(count = 6) {
    return `<div class="grid grid-books">${Array(count).fill('<div class="skeleton skeleton-cover"></div>').join('')}</div>`;
  }

  function skeletonList(count = 5) {
    return `<div class="list-group">${Array(count).fill(`
      <div class="list-item" style="pointer-events:none">
        <div class="list-item-content">
          <div class="skeleton" style="width:40px;height:40px;border-radius:8px"></div>
          <div class="list-item-text" style="flex:1">
            <div class="skeleton skeleton-text" style="width:60%"></div>
            <div class="skeleton skeleton-text" style="width:30%"></div>
          </div>
        </div>
      </div>
    `).join('')}</div>`;
  }

  // --- Pagination ---

  function renderPagination(currentPage, totalPages, onPageChange) {
    if (totalPages <= 1) return '';

    let pages = [];
    const maxVisible = 7;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
        pages.push(i);
      }
      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }

    const buttonsHtml = pages.map(p => {
      if (p === '...') return `<span class="pagination-info">...</span>`;
      return `<button class="pagination-btn ${p === currentPage ? 'active' : ''}" data-page="${p}" ${p === currentPage ? 'aria-current="page"' : ''}>${p}</button>`;
    }).join('');

    return `
      <nav class="pagination" aria-label="Pagination">
        <button class="pagination-btn" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''} aria-label="Previous page">${Icons.chevronLeft}</button>
        ${buttonsHtml}
        <button class="pagination-btn" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''} aria-label="Next page">${Icons.chevronRight}</button>
      </nav>
    `;
  }

  function bindPagination(container, onPageChange) {
    container.querySelectorAll('.pagination-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = parseInt(btn.dataset.page);
        if (!isNaN(page) && !btn.disabled) onPageChange(page);
      });
    });
  }

  // --- Search + Sort Toolbar ---

  function renderToolbar({ searchPlaceholder = 'Search...', searchValue = '', sortOptions = [], currentSort = '', currentDirection = 'asc', onSearch, onSort }) {
    const sortOptionsHtml = sortOptions.map(opt =>
      `<option value="${opt.value}" ${opt.value === currentSort ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`
    ).join('');

    return `
      <div class="toolbar">
        <div class="toolbar-left">
          <div class="search-bar">
            <span class="search-icon">${Icons.search}</span>
            <input type="search" placeholder="${escapeHtml(searchPlaceholder)}" aria-label="Search" id="toolbar-search" value="${escapeHtml(searchValue)}">
          </div>
        </div>
        ${sortOptions.length > 0 ? `
          <div class="toolbar-right">
            <div class="sort-controls">
              <select id="toolbar-sort" aria-label="Sort by">${sortOptionsHtml}</select>
              <button type="button" class="sort-direction-btn" id="toolbar-sort-dir" aria-label="Toggle sort direction" title="${currentDirection === 'asc' ? 'Ascending' : 'Descending'}">
                ${currentDirection === 'asc' ? Icons.sortAsc : Icons.sortDesc}
              </button>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function bindToolbar(container, { onSearch, onSort, currentDirection = 'asc' }) {
    const searchInput = container.querySelector('#toolbar-search');
    const sortSelect = container.querySelector('#toolbar-sort');
    const sortDirBtn = container.querySelector('#toolbar-sort-dir');

    let direction = currentDirection;

    if (searchInput && onSearch) {
      const debouncedSearch = debounce((value) => onSearch(value), 300);
      searchInput.addEventListener('input', () => debouncedSearch(searchInput.value));

      // When the toolbar is re-rendered mid-search (the search handler rebuilds
      // the view), restore focus and put the caret at the end so typing keeps
      // going instead of resetting to a single character.
      if (searchInput.value) {
        searchInput.focus();
        const preserved = searchInput.value;
        searchInput.value = '';
        searchInput.value = preserved;
      }
    }

    if (sortSelect && onSort) {
      sortSelect.addEventListener('change', () => onSort(sortSelect.value, direction));
    }

    if (sortDirBtn && onSort) {
      sortDirBtn.addEventListener('click', () => {
        direction = direction === 'asc' ? 'desc' : 'asc';
        sortDirBtn.innerHTML = direction === 'asc' ? Icons.sortAsc : Icons.sortDesc;
        sortDirBtn.title = direction === 'asc' ? 'Ascending' : 'Descending';
        if (sortSelect) onSort(sortSelect.value, direction);
      });
    }
  }

  // --- Shell Layout ---

  function renderShell(bodyContent, activePage = '') {
    const app = document.getElementById('app');

    // Grouped sidebar nav. Home sits on top with no heading; the rest is split
    // into "Library" (browse) and "Reading" (personal) sections so the section
    // headings actually describe what's under them.
    const homeNavItem = { id: 'home', label: 'Home', icon: 'home', path: '/' };
    const libraryNavItems = [
      { id: 'genres', label: 'Genres', icon: 'collection', path: '/genres' },
    ];
    const readingNavItems = [
      { id: 'queue', label: 'Reading Queue', icon: 'clock', path: '/queue' },
      { id: 'collections', label: 'Collections', icon: 'collection', path: '/collections' },
      { id: 'highlights', label: 'Highlights', icon: 'edit', path: '/highlights' },
      { id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark', path: '/bookmarks' },
      { id: 'activity', label: 'Activity', icon: 'activity', path: '/activity' },
    ];

    const adminNavItems = [];
    if (hasPermission('manage_library')) {
      adminNavItems.push({ id: 'stats', label: 'Stats', icon: 'barChart', path: '/stats' });
      adminNavItems.push({ id: 'acquisition', label: 'Acquisition', icon: 'package', path: '/acquisition' });
    }
    if (hasPermission('manage_users')) {
      adminNavItems.push({ id: 'users', label: 'Users', icon: 'users', path: '/users' });
    }

    const renderNavItem = (item) => `
      <a href="#${item.path}" class="${activePage === item.id ? 'active' : ''}" aria-current="${activePage === item.id ? 'page' : 'false'}">
        ${icon(item.icon)}
        <span>${item.label}</span>
      </a>
    `;

    const sectionLabel = (text) => `<div class="sidebar-section-label">${text}</div>`;

    // Pinned-library links (no heading of their own — they live under "Library").
    const pinnedLibraries = getPinnedLibraries();
    const pinnedLibrariesHtml = pinnedLibraries.map(lib => {
      const sourceIcon = lib.source_kind === 'calibre' ? 'book' : 'folder';
      return `<a href="#/library/${lib.id}" aria-label="${escapeHtml(lib.name)} library">
        ${icon(sourceIcon)}
        <span>${escapeHtml(lib.name)}</span>
      </a>`;
    }).join('');

    const navHtml =
      renderNavItem(homeNavItem) +
      sectionLabel('Library') +
      pinnedLibrariesHtml +
      libraryNavItems.map(renderNavItem).join('') +
      sectionLabel('Reading') +
      readingNavItems.map(renderNavItem).join('');

    const isAdminActive = adminNavItems.some(item => activePage === item.id);
    const adminSectionHtml = adminNavItems.length > 0 ? `
      <div class="sidebar-admin-section">
        <button class="sidebar-admin-toggle${isAdminActive ? ' open' : ''}" id="sidebar-admin-toggle" aria-expanded="${isAdminActive ? 'true' : 'false'}">
          ${icon('shield', 16)}
          <span>Admin</span>
          <span class="sidebar-admin-chevron">${Icons.chevronDown}</span>
        </button>
        <nav class="sidebar-admin-nav${isAdminActive ? ' expanded' : ''}" id="sidebar-admin-nav">
          ${adminNavItems.map(item => `
            <a href="#${item.path}" class="${activePage === item.id ? 'active' : ''}" aria-current="${activePage === item.id ? 'page' : 'false'}">
              ${icon(item.icon)}
              <span>${item.label}</span>
            </a>
          `).join('')}
        </nav>
      </div>
    ` : '';

    // Bottom nav: only essential items for mobile
    const bottomNavItems = [
      { id: 'home', label: 'Home', icon: 'home', path: '/' },
      { id: 'collections', label: 'Collections', icon: 'collection', path: '/collections' },
      { id: 'queue', label: 'Queue', icon: 'clock', path: '/queue' },
      { id: 'settings', label: 'Settings', icon: 'settings', path: '/settings' },
    ];

    const bottomNavHtml = bottomNavItems.map(item => `
      <a href="#${item.path}" class="${activePage === item.id ? 'active' : ''}" aria-label="${item.label}">
        <span class="nav-icon">${Icons[item.icon]}</span>
        <span>${item.label}</span>
      </a>
    `).join('');

    const userInitial = currentUser ? currentUser.username.charAt(0).toUpperCase() : '?';

    const breadcrumbHtml = breadcrumbTrail.length > 0 ? breadcrumbTrail.map((crumb, i) => {
      if (i === breadcrumbTrail.length - 1) {
        return `<span class="current">${escapeHtml(crumb.label)}</span>`;
      }
      return `<a href="#${crumb.path}">${escapeHtml(crumb.label)}</a><span class="separator">${Icons.chevronRight}</span>`;
    }).join('') : '';

    app.innerHTML = `
      <div class="app-shell">
        <div class="sidebar-overlay" id="sidebar-overlay"></div>
        <aside class="sidebar" id="sidebar" role="navigation" aria-label="Main navigation">
          <div class="sidebar-brand">
            <span class="text-brand">Ironshelf</span>
          </div>
          <div class="sidebar-notification-wrap" id="notification-bell-wrap">
            <button class="notification-bell-btn" id="notification-bell" aria-label="Notifications" title="Notifications">
              <span class="nav-icon">${Icons.bell}</span>
              <span class="notif-badge-count hidden" aria-live="polite">0</span>
            </button>
          </div>
          <button class="sidebar-search-btn" id="sidebar-search-btn" aria-label="Search books, authors, and series">
            <span class="nav-icon">${Icons.search}</span>
            <span>Search...</span>
            <span class="search-slash-hint">/</span>
          </button>
          <nav class="sidebar-nav" id="sidebar-main-nav">
            ${navHtml}
          </nav>
          ${adminSectionHtml}
          <div class="sidebar-spacer"></div>
          <div class="sidebar-bottom">
            <a href="#/settings" class="sidebar-settings-btn${activePage === 'settings' ? ' active' : ''}" aria-label="Settings" title="Settings">
              <span class="nav-icon">${Icons.settings}</span>
            </a>
            <span class="sidebar-version-label" id="sidebar-version">${cachedServerVersion ? `v${cachedServerVersion}` : ''}</span>
            <div class="sidebar-bottom-user">
              <div class="user-avatar" aria-hidden="true">${userInitial}</div>
              <span class="user-name">${currentUser ? escapeHtml(currentUser.username) : ''}</span>
            </div>
            <button class="logout-btn" id="logout-btn" aria-label="Sign out" title="Sign out">
              ${Icons.logout}
            </button>
          </div>
        </aside>
        <div class="main-content">
          <header class="main-header">
            <button class="mobile-menu-btn" id="mobile-menu-btn" aria-label="Open menu">
              ${Icons.menu}
            </button>
            <nav class="breadcrumbs" aria-label="Breadcrumb">
              ${breadcrumbHtml}
            </nav>
          </header>
          <div class="main-body page-enter">
            ${bodyContent}
          </div>
        </div>
        <div class="bottom-nav">
          <nav>${bottomNavHtml}</nav>
        </div>
      </div>
    `;

    // Event bindings
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await apiPost('/auth/logout', {}).catch(() => {});
      if (HOSTED) localStorage.removeItem('ironshelf_server_token');
      clearMediaToken();
      currentUser = null;
      stopNotificationPolling();
      closeNotificationPanel();
      navigateTo('/login');
    });

    document.getElementById('mobile-menu-btn')?.addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);
    document.getElementById('sidebar-search-btn')?.addEventListener('click', openGlobalSearch);
    document.getElementById('notification-bell')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openNotificationPanel();
    });

    // Admin section toggle
    document.getElementById('sidebar-admin-toggle')?.addEventListener('click', () => {
      const adminNav = document.getElementById('sidebar-admin-nav');
      const adminToggle = document.getElementById('sidebar-admin-toggle');
      if (adminNav && adminToggle) {
        const isExpanded = adminNav.classList.toggle('expanded');
        adminToggle.classList.toggle('open', isExpanded);
        adminToggle.setAttribute('aria-expanded', String(isExpanded));
      }
    });

    // Update notification badge on shell render
    updateNotificationBadge();
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    document.getElementById('sidebar')?.classList.toggle('open', sidebarOpen);
    document.getElementById('sidebar-overlay')?.classList.toggle('visible', sidebarOpen);
  }

  function closeSidebar() {
    sidebarOpen = false;
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('visible');
  }

  // --- Login ---

  async function renderLogin() {
    setTitle(['Sign In']);
    breadcrumbTrail = [];

    // Fetch server info for registration status
    let serverInfo = null;
    try {
      serverInfo = await fetch(`${API}/server/info`).then(r => r.ok ? r.json() : null).catch(() => null);
    } catch { /* ignore */ }

    const isRegistrationOpen = serverInfo?.registration_open !== false;
    const isInviteRequired = serverInfo?.invite_required === true;

    let serverInfoHtml = '';
    if (serverInfo?.server_name) {
      serverInfoHtml = `<div class="login-server-info">${escapeHtml(serverInfo.server_name)}</div>`;
    }

    let registerLinkHtml = '';
    if (isRegistrationOpen) {
      registerLinkHtml = `<div class="login-footer">No account? <a href="#/register">Create one</a></div>`;
    } else {
      registerLinkHtml = `<div class="login-footer" style="color:var(--color-muted)">Registration is closed on this server.</div>`;
    }

    // Legacy file-config OIDC button (kept for back-compat).
    const isOidcEnabled = serverInfo?.oidc_enabled === true;
    let ssoButtonsHtml = isOidcEnabled
      ? `<a href="${API}/auth/oidc/login" class="btn btn-sso">${icon('shield', 18)} Sign in with SSO</a>`
      : '';

    // DB-driven login providers (Google, GitHub, custom) configured by the owner.
    try {
      const providers = await fetch(`${API}/auth/providers`)
        .then(r => (r.ok ? r.json() : []))
        .catch(() => []);
      for (const provider of providers || []) {
        ssoButtonsHtml += `
          <a href="${API}/auth/sso/${encodeURIComponent(provider.id)}/login" class="btn btn-sso">${icon('shield', 18)} Sign in with ${escapeHtml(provider.display_name)}</a>
        `;
      }
    } catch { /* providers endpoint optional */ }

    const oidcButtonHtml = ssoButtonsHtml
      ? `<div class="login-divider">or</div>${ssoButtonsHtml}`
      : '';

    // Check if server is claimed (cloud login available)
    let cloudLoginHtml = '';
    try {
      const claimStatus = await fetch(`${API}/auth/claim-status`).then(r => r.ok ? r.json() : null).catch(() => null);
      if (claimStatus?.is_claimed && claimStatus?.cloud_service_url) {
        cloudLoginHtml = `
          <div class="login-divider">or</div>
          <a href="#/cloud-login" class="btn btn-cloud">${icon('globe', 18)} Sign in with Ironshelf Cloud</a>
        `;
      }
    } catch { /* ignore */ }

    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <div class="brand">
            <h1 class="text-brand">Ironshelf</h1>
            <p>Your self-hosted library</p>
          </div>
          ${serverInfoHtml}
          <form id="login-form" novalidate>
            <div class="form-group">
              <label class="form-label" for="login-username">Username</label>
              <input type="text" class="form-input" id="login-username" name="username" required autocomplete="username" autofocus>
            </div>
            <div class="form-group">
              <label class="form-label" for="login-password">Password</label>
              <input type="password" class="form-input" id="login-password" name="password" required autocomplete="current-password">
            </div>
            <button type="submit" class="btn btn-primary btn-lg">Sign In</button>
          </form>
          ${oidcButtonHtml}
          ${cloudLoginHtml}
          ${registerLinkHtml}
        </div>
      </div>
    `;

    // Store invite info for register page
    window._ironshelfServerInfo = serverInfo;

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in...';

      try {
        const loginResult = await apiPost('/auth/login', {
          username: document.getElementById('login-username').value,
          password: document.getElementById('login-password').value,
        });
        // Hosted UI is cross-origin: keep the session as a Bearer token.
        if (HOSTED && loginResult?.session_id) {
          localStorage.setItem('ironshelf_server_token', loginResult.session_id);
        }
        await checkAuth();
        navigateTo('/');
      } catch (err) {
        toast(err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    });
  }

  // --- Register ---

  async function renderRegister() {
    setTitle(['Create Account']);
    breadcrumbTrail = [];

    const serverInfo = window._ironshelfServerInfo || null;
    const isInviteRequired = serverInfo?.invite_required === true;

    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <div class="brand">
            <h1 class="text-brand">Ironshelf</h1>
            <p>Create your account</p>
          </div>
          ${isInviteRequired ? `<div class="login-server-info"><span class="badge badge-warning">${icon('lock', 12)} Invite required</span></div>` : ''}
          <form id="register-form" novalidate>
            ${isInviteRequired ? `
              <div class="form-group invite-code-group">
                <label class="form-label" for="reg-invite-code">Invite Code</label>
                <input type="text" class="form-input" id="reg-invite-code" name="invite_code" required placeholder="Enter your invite code" autocomplete="off">
              </div>
            ` : ''}
            <div class="form-group">
              <label class="form-label" for="reg-username">Username</label>
              <input type="text" class="form-input" id="reg-username" name="username" required autocomplete="username" ${isInviteRequired ? '' : 'autofocus'}>
            </div>
            <div class="form-group">
              <label class="form-label" for="reg-password">Password</label>
              <input type="password" class="form-input" id="reg-password" name="password" required minlength="6" autocomplete="new-password">
              <p class="form-hint">Minimum 6 characters</p>
            </div>
            <button type="submit" class="btn btn-primary btn-lg">Create Account</button>
          </form>
          <div class="login-footer">
            Already have an account? <a href="#/login">Sign in</a>
          </div>
        </div>
      </div>
    `;

    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating...';

      try {
        const registerPayload = {
          username: document.getElementById('reg-username').value,
          password: document.getElementById('reg-password').value,
        };
        const inviteCodeInput = document.getElementById('reg-invite-code');
        if (inviteCodeInput) {
          registerPayload.invite_code = inviteCodeInput.value.trim();
        }
        await apiPost('/auth/register', registerPayload);
        toast('Account created successfully!', 'success');
        await checkAuth();
        navigateTo('/');
      } catch (err) {
        toast(err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account';
      }
    });
  }

  // --- Libraries ---

  async function renderLibraries() {
    if (!await checkAuth()) return;
    setTitle(['Libraries']);
    breadcrumbTrail = [{ label: 'Settings', path: '/settings' }, { label: 'Libraries', path: '/libraries' }];

    // Show skeleton
    renderShell(`
      <div class="page-header">
        <h1>Libraries</h1>
      </div>
      ${skeletonList(3)}
    `, 'settings');

    try {
      const libraries = await apiGet('/libraries');
      let bodyContent = '';

      const addBtnHtml = hasPermission('manage_library')
        ? `<div class="actions"><button class="btn btn-primary" id="add-library-btn">${icon('plus', 16)} Add Library</button></div>`
        : '';

      bodyContent += `<div class="page-header"><h1>Libraries</h1>${addBtnHtml}</div>`;

      if (!libraries || libraries.length === 0) {
        bodyContent += `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.library}</div>
            <h3>No libraries yet</h3>
            <p>${hasPermission('manage_library') ? 'Add a Calibre library or folder to start browsing your collection.' : 'No libraries are available. Ask an administrator to add one.'}</p>
            ${hasPermission('manage_library') ? '<button class="btn btn-primary btn-lg" id="add-library-empty-btn">Add Your First Library</button>' : ''}
          </div>
        `;
      } else {
        bodyContent += '<div class="grid grid-libraries">';
        for (const lib of libraries) {
          const sourceLabel = lib.source_kind === 'calibre' ? 'Calibre' : 'Folder';
          const isPinned = isLibraryPinned(lib.id);
          bodyContent += `
            <div class="card card-interactive library-card" data-library-id="${lib.id}" role="link" tabindex="0" aria-label="${escapeHtml(lib.name)} library">
              <div class="library-card-header">
                <div class="library-card-icon">${lib.source_kind === 'calibre' ? Icons.book : Icons.folder}</div>
                <span class="badge badge-teal">${escapeHtml(sourceLabel)}</span>
                <button class="pin-library-btn ${isPinned ? 'is-pinned' : ''}" data-pin-library-id="${lib.id}" data-pin-library-name="${escapeHtml(lib.name)}" data-pin-library-source="${lib.source_kind}" aria-label="${isPinned ? 'Unpin' : 'Pin'} ${escapeHtml(lib.name)}" title="${isPinned ? 'Unpin from sidebar' : 'Pin to sidebar'}">
                  <span class="nav-icon" style="width:16px;height:16px">${isPinned ? Icons.pinOff : Icons.pin}</span>
                </button>
              </div>
              <div class="library-card-name">${escapeHtml(lib.name)}</div>
              <div class="library-card-path">${escapeHtml(lib.path || '')}</div>
              <div class="library-card-stats">
                <span class="library-card-stat"><strong>${escapeHtml(lib.library_type || 'book')}</strong></span>
              </div>
            </div>
          `;
        }
        bodyContent += '</div>';
      }

      renderShell(bodyContent, 'settings');

      // Bind events
      document.querySelectorAll('[data-library-id]').forEach(card => {
        const handler = () => navigateTo(`/library/${card.dataset.libraryId}`);
        card.addEventListener('click', handler);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

      // Bind pin toggle buttons (stop propagation so card click doesn't fire)
      document.querySelectorAll('.pin-library-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const libraryForPin = {
            id: btn.dataset.pinLibraryId,
            name: btn.dataset.pinLibraryName,
            source_kind: btn.dataset.pinLibrarySource,
          };
          const wasPinned = isLibraryPinned(libraryForPin.id);
          if (togglePinLibrary(libraryForPin)) {
            toast(wasPinned ? `Unpinned "${libraryForPin.name}"` : `Pinned "${libraryForPin.name}" to sidebar`, 'success');
            renderLibraries();
          }
        });
      });

      document.getElementById('add-library-btn')?.addEventListener('click', showAddLibraryModal);
      document.getElementById('add-library-empty-btn')?.addEventListener('click', showAddLibraryModal);
    } catch (err) {
      renderShell(renderError('Failed to load libraries', err.message, () => renderLibraries()), 'settings');
    }
  }

  function showAddLibraryModal(editData = null) {
    const isEdit = editData && editData.id;
    const title = isEdit ? 'Edit Library' : 'Add Library';

    const { close } = showModal({
      title,
      description: isEdit ? 'Update the library configuration.' : 'Connect a Calibre database or folder to browse.',
      content: `
        <form id="library-form" novalidate>
          <div class="form-group">
            <label class="form-label" for="lib-name">Name</label>
            <input type="text" class="form-input" id="lib-name" name="name" required placeholder="My Books" value="${isEdit ? escapeHtml(editData.name) : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="lib-path">Path on server</label>
            <div class="form-input-with-button">
              <input type="text" class="form-input" id="lib-path" name="path" required placeholder="/mnt/books/calibre-library" value="${isEdit ? escapeHtml(editData.path || '') : ''}" ${isEdit ? 'readonly style="opacity:0.6;cursor:not-allowed"' : ''}>
              ${!isEdit ? `<button type="button" class="btn btn-secondary" id="browse-path-btn">${icon('folder', 16)} Browse</button>` : ''}
            </div>
            <p class="form-hint">${isEdit ? 'Path cannot be changed after creation.' : 'Absolute path to the Calibre library or book folder'}</p>
          </div>
          <div class="form-group">
            <label class="form-label" for="lib-source">Source Type</label>
            <select class="form-input" id="lib-source" name="source_kind">
              <option value="calibre" ${isEdit && editData.source_kind === 'calibre' ? 'selected' : ''}>Calibre (metadata.db)</option>
              <option value="folder" ${isEdit && editData.source_kind === 'folder' ? 'selected' : ''}>Folder Scan</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="lib-type">Content Type</label>
            <select class="form-input" id="lib-type" name="library_type">
              <option value="book" ${isEdit && editData.library_type === 'book' ? 'selected' : ''}>Book</option>
              <option value="light_novel" ${isEdit && editData.library_type === 'light_novel' ? 'selected' : ''}>Light Novel</option>
              <option value="web_novel" ${isEdit && editData.library_type === 'web_novel' ? 'selected' : ''}>Web Novel</option>
              <option value="fanfiction" ${isEdit && editData.library_type === 'fanfiction' ? 'selected' : ''}>Fanfiction</option>
              <option value="comic" ${isEdit && editData.library_type === 'comic' ? 'selected' : ''}>Comic</option>
              <option value="manga" ${isEdit && editData.library_type === 'manga' ? 'selected' : ''}>Manga</option>
              <option value="mixed" ${isEdit && editData.library_type === 'mixed' ? 'selected' : ''}>Mixed</option>
            </select>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
            ${isEdit ? `<button type="button" class="btn btn-danger" id="delete-library-btn">Delete</button>` : ''}
            <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Add Library'}</button>
          </div>
        </form>
      `,
    });

    const form = document.getElementById('library-form');
    form.querySelector('[data-action="cancel"]').addEventListener('click', close);

    // Browse button opens folder picker modal
    document.getElementById('browse-path-btn')?.addEventListener('click', () => {
      const currentPathValue = document.getElementById('lib-path').value.trim();
      const currentSourceKind = document.getElementById('lib-source').value;
      showFolderPickerModal(currentPathValue, currentSourceKind, (selectedPath) => {
        document.getElementById('lib-path').value = selectedPath;
      });
    });

    if (isEdit) {
      document.getElementById('delete-library-btn')?.addEventListener('click', () => {
        close();
        showConfirmModal({
          title: 'Delete Library',
          message: `Are you sure you want to remove "${editData.name}"? This only removes the library from Ironshelf — your files on disk are not affected.`,
          confirmText: 'Delete',
          onConfirm: async () => {
            try {
              await apiDelete(`/libraries/${editData.id}`);
              toast('Library removed', 'success');
              renderLibraries();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        });
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      const payload = {
        name: document.getElementById('lib-name').value.trim(),
        path: document.getElementById('lib-path').value.trim(),
        source_kind: document.getElementById('lib-source').value,
        library_type: document.getElementById('lib-type').value,
      };

      if (!payload.name) {
        toast('Library name is required', 'error');
        submitBtn.disabled = false;
        return;
      }
      if (!payload.path) {
        toast('Library path is required', 'error');
        submitBtn.disabled = false;
        return;
      }

      try {
        if (isEdit) {
          await apiPatch(`/libraries/${editData.id}`, payload);
          toast('Library updated', 'success');
        } else {
          await apiPost('/libraries', payload);
          toast('Library added!', 'success');
        }
        close();
        renderLibraries();
      } catch (err) {
        toast(err.message, 'error');
        submitBtn.disabled = false;
      }
    });
  }


  // --- Folder Picker Modal ---

  function showFolderPickerModal(initialPath, sourceKind, onSelectCallback) {
    const overlay = document.createElement('div');
    overlay.className = 'folder-picker-overlay';

    overlay.innerHTML = `
      <div class="folder-picker">
        <div class="folder-picker-header">
          <h3>Browse Server Folders</h3>
          <button class="folder-picker-close" aria-label="Close">${Icons.x}</button>
        </div>
        <div class="folder-picker-toolbar">
          <div class="folder-picker-roots">
            <select id="folder-picker-root-select" aria-label="Root drive"></select>
          </div>
          <div class="folder-picker-breadcrumb" id="folder-picker-breadcrumb"></div>
        </div>
        <div class="folder-picker-manual">
          <input type="text" id="folder-picker-path-input" placeholder="Type a path and press Go" aria-label="Manual path entry">
          <button class="btn btn-sm btn-secondary" id="folder-picker-go-btn">Go</button>
        </div>
        <div class="folder-picker-listing" id="folder-picker-listing">
          <div class="folder-picker-loading">Loading...</div>
        </div>
        <div class="folder-picker-footer">
          <div class="folder-picker-selected">
            <span class="folder-picker-selected-path" id="folder-picker-selected-path">No folder selected</span>
            <span class="folder-picker-validation" id="folder-picker-validation"></span>
          </div>
          <button class="btn btn-ghost" id="folder-picker-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="folder-picker-select-btn" disabled>Select</button>
        </div>
      </div>
    `;

    document.getElementById('modal-root').appendChild(overlay);

    let currentBrowsePath = '';
    let currentSeparator = '/';
    let currentRoots = [];
    let validationResult = null;

    const listingContainer = document.getElementById('folder-picker-listing');
    const breadcrumbContainer = document.getElementById('folder-picker-breadcrumb');
    const rootSelect = document.getElementById('folder-picker-root-select');
    const pathInput = document.getElementById('folder-picker-path-input');
    const selectedPathDisplay = document.getElementById('folder-picker-selected-path');
    const validationDisplay = document.getElementById('folder-picker-validation');
    const selectButton = document.getElementById('folder-picker-select-btn');

    function closePicker() {
      overlay.remove();
    }

    overlay.querySelector('.folder-picker-close').addEventListener('click', closePicker);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closePicker();
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closePicker();
    });
    document.getElementById('folder-picker-cancel-btn').addEventListener('click', closePicker);

    document.getElementById('folder-picker-select-btn').addEventListener('click', () => {
      if (currentBrowsePath) {
        onSelectCallback(currentBrowsePath);
        closePicker();
      }
    });

    document.getElementById('folder-picker-go-btn').addEventListener('click', () => {
      const manualPath = pathInput.value.trim();
      if (manualPath) {
        browseTo(manualPath);
      }
    });

    pathInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const manualPath = pathInput.value.trim();
        if (manualPath) {
          browseTo(manualPath);
        }
      }
    });

    rootSelect.addEventListener('change', () => {
      const selectedRoot = rootSelect.value;
      if (selectedRoot) {
        browseTo(selectedRoot);
      }
    });

    async function browseTo(targetPath) {
      listingContainer.innerHTML = '<div class="folder-picker-loading">Loading...</div>';

      try {
        const queryParameter = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
        const browseResponse = await apiGet(`/filesystem/browse${queryParameter}`);

        currentBrowsePath = browseResponse.current_path;
        currentSeparator = browseResponse.separator || '/';
        currentRoots = browseResponse.roots || [];

        pathInput.value = currentBrowsePath;
        selectedPathDisplay.textContent = currentBrowsePath || 'Select a folder';

        // Update roots dropdown
        updateRootsDropdown();

        // Update breadcrumb
        updateBreadcrumb(currentBrowsePath);

        // Render directory entries
        renderDirectoryEntries(browseResponse);

        // Validate the current path
        if (currentBrowsePath) {
          await validateCurrentPath();
        } else {
          validationDisplay.innerHTML = '';
          selectButton.disabled = true;
        }
      } catch (fetchError) {
        listingContainer.innerHTML = `
          <div class="folder-picker-error">
            ${Icons.alertCircle} ${escapeHtml(fetchError.message || 'Failed to browse directory')}
          </div>
        `;
        validationDisplay.innerHTML = '';
        selectButton.disabled = true;
      }
    }

    function updateRootsDropdown() {
      const previousValue = rootSelect.value;
      rootSelect.innerHTML = '<option value="">Root...</option>';
      for (const rootPath of currentRoots) {
        const optionElement = document.createElement('option');
        optionElement.value = rootPath;
        optionElement.textContent = rootPath;
        rootSelect.appendChild(optionElement);
      }
      // Select the root that matches the current path prefix
      const matchingRoot = currentRoots.find(
        (rootPath) => currentBrowsePath && currentBrowsePath.startsWith(rootPath)
      );
      if (matchingRoot) {
        rootSelect.value = matchingRoot;
      } else if (previousValue && currentRoots.includes(previousValue)) {
        rootSelect.value = previousValue;
      }
    }

    function updateBreadcrumb(fullPath) {
      breadcrumbContainer.innerHTML = '';

      if (!fullPath) return;

      // Split path into segments. Handle both / and \ separators.
      const normalizedPath = fullPath.replace(/\\/g, '/');
      const pathSegments = normalizedPath.split('/').filter(Boolean);

      // On Windows, the first segment might be "C:" — reconstruct properly.
      let accumulatedPath = '';

      // Handle root differently on Windows vs Unix
      if (currentSeparator === '\\') {
        // Windows: first segment is drive like "C:"
        if (pathSegments.length > 0) {
          accumulatedPath = pathSegments[0] + '\\';
          const rootButton = document.createElement('button');
          rootButton.className = 'folder-picker-breadcrumb-segment';
          rootButton.textContent = pathSegments[0] + '\\';
          rootButton.addEventListener('click', () => browseTo(accumulatedPath));
          breadcrumbContainer.appendChild(rootButton);

          for (let segmentIndex = 1; segmentIndex < pathSegments.length; segmentIndex++) {
            const separatorSpan = document.createElement('span');
            separatorSpan.className = 'folder-picker-breadcrumb-separator';
            separatorSpan.textContent = '\\';
            breadcrumbContainer.appendChild(separatorSpan);

            accumulatedPath += pathSegments[segmentIndex] + (segmentIndex < pathSegments.length - 1 ? '\\' : '');
            const segmentButton = document.createElement('button');
            segmentButton.className = 'folder-picker-breadcrumb-segment';
            segmentButton.textContent = pathSegments[segmentIndex];
            const targetPath = accumulatedPath;
            segmentButton.addEventListener('click', () => browseTo(targetPath));
            breadcrumbContainer.appendChild(segmentButton);
          }
        }
      } else {
        // Unix: root is /
        const rootButton = document.createElement('button');
        rootButton.className = 'folder-picker-breadcrumb-segment';
        rootButton.textContent = '/';
        rootButton.addEventListener('click', () => browseTo('/'));
        breadcrumbContainer.appendChild(rootButton);

        for (let segmentIndex = 0; segmentIndex < pathSegments.length; segmentIndex++) {
          const separatorSpan = document.createElement('span');
          separatorSpan.className = 'folder-picker-breadcrumb-separator';
          separatorSpan.textContent = '/';
          breadcrumbContainer.appendChild(separatorSpan);

          accumulatedPath = '/' + pathSegments.slice(0, segmentIndex + 1).join('/');
          const segmentButton = document.createElement('button');
          segmentButton.className = 'folder-picker-breadcrumb-segment';
          segmentButton.textContent = pathSegments[segmentIndex];
          const targetPath = accumulatedPath;
          segmentButton.addEventListener('click', () => browseTo(targetPath));
          breadcrumbContainer.appendChild(segmentButton);
        }
      }

      // Auto-scroll breadcrumb to the end
      breadcrumbContainer.scrollLeft = breadcrumbContainer.scrollWidth;
    }

    function renderDirectoryEntries(browseResponse) {
      const directoryEntries = browseResponse.entries || [];

      if (directoryEntries.length === 0 && !browseResponse.parent_path) {
        listingContainer.innerHTML = '<div class="folder-picker-empty">No accessible folders</div>';
        return;
      }

      let entriesHtml = '';

      // "Go Up" entry
      if (browseResponse.parent_path) {
        entriesHtml += `
          <button class="folder-picker-entry folder-picker-up" data-path="${escapeHtml(browseResponse.parent_path)}" data-action="navigate">
            <span class="folder-picker-entry-icon">${Icons.arrowUp}</span>
            <span class="folder-picker-entry-name">..</span>
          </button>
        `;
      }

      for (const directoryEntry of directoryEntries) {
        entriesHtml += `
          <button class="folder-picker-entry" data-path="${escapeHtml(directoryEntry.path)}" data-action="navigate">
            <span class="folder-picker-entry-icon">${Icons.folder}</span>
            <span class="folder-picker-entry-name">${escapeHtml(directoryEntry.name)}</span>
          </button>
        `;
      }

      listingContainer.innerHTML = entriesHtml;

      // Attach click handlers for navigation
      listingContainer.querySelectorAll('[data-action="navigate"]').forEach((entryButton) => {
        entryButton.addEventListener('click', () => {
          const targetDirectoryPath = entryButton.getAttribute('data-path');
          browseTo(targetDirectoryPath);
        });
      });

      // Check each entry for metadata.db presence (async, decorative)
      if (sourceKind === 'calibre') {
        detectCalibreLibraries(directoryEntries);
      }
    }

    async function detectCalibreLibraries(directoryEntries) {
      for (const directoryEntry of directoryEntries) {
        try {
          const validationResponse = await apiGet(
            `/filesystem/validate?path=${encodeURIComponent(directoryEntry.path)}&source_kind=calibre`
          );
          if (validationResponse.has_metadata_db) {
            const matchingButton = listingContainer.querySelector(
              `[data-path="${CSS.escape(directoryEntry.path)}"]`
            );
            if (matchingButton) {
              matchingButton.querySelector('.folder-picker-entry-icon')?.classList.add('is-calibre');
              // Add Calibre badge
              const badgeSpan = document.createElement('span');
              badgeSpan.className = 'folder-picker-entry-badge';
              badgeSpan.textContent = 'Calibre';
              matchingButton.appendChild(badgeSpan);
            }
          }
        } catch (_) {
          // Non-critical — skip silently
        }
      }
    }

    async function validateCurrentPath() {
      if (!currentBrowsePath) {
        validationDisplay.innerHTML = '';
        selectButton.disabled = true;
        return;
      }

      try {
        const validationResponse = await apiGet(
          `/filesystem/validate?path=${encodeURIComponent(currentBrowsePath)}&source_kind=${encodeURIComponent(sourceKind)}`
        );
        validationResult = validationResponse;

        if (validationResponse.valid) {
          validationDisplay.className = 'folder-picker-validation is-valid';
          let validationLabel = 'Valid folder';
          if (validationResponse.has_metadata_db) {
            validationLabel = 'Calibre library detected';
          }
          validationDisplay.innerHTML = `${icon('check', 14)} ${validationLabel}`;
          selectButton.disabled = false;
        } else {
          validationDisplay.className = 'folder-picker-validation is-invalid';
          let invalidReason = 'Not a valid folder';
          if (validationResponse.is_directory && sourceKind === 'calibre' && !validationResponse.has_metadata_db) {
            invalidReason = 'No metadata.db found';
          }
          validationDisplay.innerHTML = `${icon('alertCircle', 14)} ${invalidReason}`;
          // Still allow selection even if Calibre validation fails — user may
          // want to pick the folder anyway (e.g. for folder source type change).
          selectButton.disabled = !validationResponse.is_directory;
        }
      } catch (_) {
        validationDisplay.innerHTML = '';
        // Allow selection on validation failure — the create/update endpoint
        // will do its own validation.
        selectButton.disabled = false;
      }
    }

    // Initial browse: start at the provided path or roots
    browseTo(initialPath || '');
  }

  // --- Library Detail (Authors) ---

  let librarySearchQuery = '';
  let librarySortField = 'sort_name';
  let librarySortDirection = 'asc';
  let libraryPage = 1;
  let libraryScrollObserver = null;
  // Reading-status filter for the library view: all | reading | finished | unread.
  // "all" shows the Author hierarchy; any other value shows a flat book grid
  // filtered to that status.
  let libraryStatusFilter = 'all';

  const READING_STATUS_TABS = [
    { value: 'all', label: 'All' },
    { value: 'reading', label: 'Reading' },
    { value: 'finished', label: 'Finished' },
    { value: 'unread', label: 'Unread' },
  ];

  // Render a status tab bar. `active` = current value; `idPrefix` namespaces the
  // data attribute so callers can bind their own click handler.
  function renderReadingStatusTabs(active, idPrefix = 'lib-status') {
    return `<div class="status-tabs" role="tablist" data-status-group="${idPrefix}">
      ${READING_STATUS_TABS.map(tab => `
        <button class="status-tab ${tab.value === active ? 'is-active' : ''}" role="tab"
          aria-selected="${tab.value === active}" data-status-value="${tab.value}">${tab.label}</button>
      `).join('')}
    </div>`;
  }

  async function renderLibrary(libraryId) {
    if (!await checkAuth()) return;
    const thisGeneration = navigationGeneration;

    breadcrumbTrail = [
      { label: 'Libraries', path: '/libraries' },
      { label: '...', path: `/library/${libraryId}` },
    ];

    renderShell(`
      <div class="page-header"><h1>Loading...</h1></div>
      ${skeletonList(8)}
    `, 'libraries');

    try {
      const library = await apiGet(`/libraries/${libraryId}`);
      if (isStaleNavigation(thisGeneration)) return;

      setTitle([library.name]);
      breadcrumbTrail[1].label = library.name;

      const isScanningThisLibrary = activeScanLibraryId === libraryId;

      const headerHtml = `
        <div class="page-header">
          <h1>${escapeHtml(library.name)}</h1>
          <div class="actions">
            <button class="btn btn-secondary" id="scan-library-btn" ${isScanningThisLibrary ? 'disabled' : ''} aria-label="Scan library for new books">
              ${icon('scan', 16)} ${isScanningThisLibrary ? 'Scanning...' : 'Scan'}
            </button>
            ${hasPermission('manage_library') ? `<button class="btn btn-ghost" id="edit-library-btn" aria-label="Edit library">${icon('edit', 16)} Edit</button>` : ''}
          </div>
        </div>
        <div id="scan-status" class="${isScanningThisLibrary ? '' : 'hidden'}" aria-live="polite">
          ${isScanningThisLibrary ? `
            <div class="scan-progress-wrap">
              <div class="progress-bar progress-bar-indeterminate">
                <div class="progress-bar-fill"></div>
              </div>
              <span class="scan-status-text">Scanning library...</span>
            </div>
          ` : ''}
        </div>
        ${renderReadingStatusTabs(libraryStatusFilter)}
      `;

      // Shared header bindings (status tabs, edit, scan) used by both paths.
      const bindLibraryHeader = () => {
        document.querySelectorAll('.status-tabs[data-status-group="lib-status"] .status-tab').forEach((tabButton) => {
          tabButton.addEventListener('click', () => {
            const nextStatus = tabButton.dataset.statusValue;
            if (nextStatus === libraryStatusFilter) return;
            libraryStatusFilter = nextStatus;
            libraryPage = 1;
            renderLibrary(libraryId);
          });
        });
        document.getElementById('edit-library-btn')?.addEventListener('click', () => showAddLibraryModal(library));
        document.getElementById('scan-library-btn')?.addEventListener('click', () => startLibraryScan(libraryId));
      };

      // --- Flat filtered book grid (status = reading | finished | unread) ---
      if (libraryStatusFilter !== 'all') {
        await loadReadingStates();
        const buildBooksParams = (pageNumber) => new URLSearchParams({
          page: pageNumber, per_page: 50, status: libraryStatusFilter, sort: 'sort_title', dir: 'asc',
        });
        const booksResponse = await apiGet(`/libraries/${libraryId}/books?${buildBooksParams(1)}`);
        if (isStaleNavigation(thisGeneration)) return;
        const books = Array.isArray(booksResponse) ? booksResponse : (booksResponse?.items || []);
        let booksTotalPages = booksResponse?.total_pages || 1;

        let gridBody = headerHtml;
        if (books.length === 0) {
          const emptyLabel = { reading: 'No books in progress', finished: 'No finished books', unread: 'No unread books' }[libraryStatusFilter] || 'No books';
          gridBody += `<div class="empty-state"><div class="empty-state-icon">${Icons.book || Icons.bookOpen || ''}</div><h3>${emptyLabel}</h3><p>Switch tabs to see more of your library.</p></div>`;
          renderShell(gridBody, 'settings');
          bindLibraryHeader();
          return;
        }
        gridBody += `
          <div class="grid grid-books" id="library-book-grid"></div>
          <div id="library-scroll-loader" class="hidden" style="text-align:center;padding:var(--space-4);color:var(--color-muted)">Loading more…</div>
          <div id="library-scroll-sentinel" style="height:1px"></div>
        `;
        renderShell(gridBody, 'settings');
        bindLibraryHeader();

        const gridEl = document.getElementById('library-book-grid');
        const loaderEl = document.getElementById('library-scroll-loader');
        const sentinelEl = document.getElementById('library-scroll-sentinel');
        let nextPage = 2;
        let loading = false;

        const appendBooks = (batch) => {
          gridEl.insertAdjacentHTML('beforeend', batch.map(bookItem => renderBookCard(bookItem)).join(''));
          gridEl.querySelectorAll('.book-card:not([data-bound])').forEach((card) => {
            card.dataset.bound = '1';
            const openBook = () => navigateTo(`/book/${card.dataset.bookId}`);
            card.addEventListener('click', openBook);
            card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBook(); } });
          });
        };
        appendBooks(books);

        if (libraryScrollObserver) { libraryScrollObserver.disconnect(); libraryScrollObserver = null; }
        if (sentinelEl && booksTotalPages > 1) {
          const loadMore = async () => {
            if (loading || nextPage > booksTotalPages) return;
            loading = true;
            if (loaderEl) loaderEl.classList.remove('hidden');
            try {
              const moreResp = await apiGet(`/libraries/${libraryId}/books?${buildBooksParams(nextPage)}`);
              const moreBooks = Array.isArray(moreResp) ? moreResp : (moreResp?.items || []);
              appendBooks(moreBooks);
              booksTotalPages = moreResp?.total_pages || booksTotalPages;
              nextPage += 1;
            } catch {
              // ignore — retry on next intersection
            } finally {
              loading = false;
              if (loaderEl) loaderEl.classList.add('hidden');
              if (nextPage > booksTotalPages && libraryScrollObserver) { libraryScrollObserver.disconnect(); libraryScrollObserver = null; }
            }
          };
          libraryScrollObserver = new IntersectionObserver((entries) => { if (entries.some(entry => entry.isIntersecting)) loadMore(); }, { rootMargin: '400px' });
          libraryScrollObserver.observe(sentinelEl);
        }
        return;
      }

      // --- Author hierarchy (status = all) ---
      const params = new URLSearchParams({
        page: libraryPage,
        per_page: 50,
        sort: librarySortField,
        dir: librarySortDirection,
      });
      if (librarySearchQuery) params.set('search', librarySearchQuery);

      const authorsResponse = await apiGet(`/libraries/${libraryId}/authors?${params}`);
      if (isStaleNavigation(thisGeneration)) return;

      const authors = Array.isArray(authorsResponse) ? authorsResponse : (authorsResponse?.items || authorsResponse?.data || []);
      const totalPages = authorsResponse?.total_pages || 1;
      const photosEnabled = (await getServerSettings()).author_images_enabled !== false;

      let bodyContent = headerHtml + `
        ${renderToolbar({
          searchPlaceholder: 'Search authors...',
          searchValue: librarySearchQuery,
          sortOptions: [
            { value: 'sort_name', label: 'Last name' },
            { value: 'name', label: 'First name' },
            { value: 'book_count', label: 'Book Count' },
          ],
          currentSort: librarySortField,
          currentDirection: librarySortDirection,
        })}
      `;

      if (authors.length === 0) {
        bodyContent += `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.author}</div>
            <h3>${librarySearchQuery ? 'No authors match your search' : 'No authors found'}</h3>
            <p>${librarySearchQuery ? 'Try adjusting your search terms.' : 'This library appears to be empty or still scanning.'}</p>
          </div>
        `;
      } else {
        // Infinite scroll: authors load into this list as you scroll.
        bodyContent += `
          <div class="list-group" id="library-author-list"></div>
          <div id="library-scroll-loader" class="hidden" style="text-align:center;padding:var(--space-4);color:var(--color-muted)">Loading more…</div>
          <div id="library-scroll-sentinel" style="height:1px"></div>
        `;
      }

      renderShell(bodyContent, 'settings');

      // Infinite scroll: render page 1, then fetch more as the sentinel nears.
      if (authors.length > 0) {
        const listEl = document.getElementById('library-author-list');
        const loaderEl = document.getElementById('library-scroll-loader');
        const sentinelEl = document.getElementById('library-scroll-sentinel');
        const sortingByName = !librarySortField || librarySortField === 'name';
        let lastLetter = '';
        let nextPage = 2;
        let scrollTotalPages = totalPages;
        let loading = false;

        const appendAuthors = (batch) => {
          let html = '';
          for (const author of batch) {
            const firstLetter = (author.name || '')[0]?.toUpperCase() || '';
            if (sortingByName && firstLetter && firstLetter !== lastLetter) {
              lastLetter = firstLetter;
              html += `<div style="padding:var(--space-2) var(--space-5);background:var(--color-bg-elevated);font-size:var(--text-xs);font-weight:600;color:var(--color-teal-bright);letter-spacing:0.05em;text-transform:uppercase">${escapeHtml(firstLetter)}</div>`;
            }
            html += `
              <div class="list-item" data-author-id="${author.id}" role="link" tabindex="0" aria-label="${escapeHtml(author.name)}">
                <div class="list-item-content">
                  <div class="list-item-icon">${authorAvatarHtml(author.id, author.name, photosEnabled)}</div>
                  <div class="list-item-text">
                    <div class="list-item-name">${escapeHtml(author.name)}</div>
                    <div class="list-item-subtitle">${author.book_count || 0} book${(author.book_count || 0) !== 1 ? 's' : ''}${author.series_count ? ` · ${author.series_count} series` : ''}</div>
                  </div>
                </div>
                <div class="list-item-meta">
                  <span class="nav-icon" style="width:16px;height:16px;color:var(--color-muted)">${Icons.chevronRight}</span>
                </div>
              </div>`;
          }
          listEl.insertAdjacentHTML('beforeend', html);
          bindAuthorAvatars(listEl);
          listEl.querySelectorAll('[data-author-id]:not([data-bound])').forEach((item) => {
            item.dataset.bound = '1';
            const handler = () => navigateTo(`/author/${item.dataset.authorId}`);
            item.addEventListener('click', handler);
            item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
          });
        };

        appendAuthors(authors);

        if (libraryScrollObserver) { libraryScrollObserver.disconnect(); libraryScrollObserver = null; }
        if (sentinelEl && scrollTotalPages > 1) {
          const loadMore = async () => {
            if (loading || nextPage > scrollTotalPages) return;
            loading = true;
            if (loaderEl) loaderEl.classList.remove('hidden');
            try {
              const moreParams = new URLSearchParams({ page: nextPage, per_page: 50, sort: librarySortField, dir: librarySortDirection });
              if (librarySearchQuery) moreParams.set('search', librarySearchQuery);
              const moreResp = await apiGet(`/libraries/${libraryId}/authors?${moreParams}`);
              const moreAuthors = Array.isArray(moreResp) ? moreResp : (moreResp?.items || []);
              appendAuthors(moreAuthors);
              scrollTotalPages = moreResp?.total_pages || scrollTotalPages;
              nextPage += 1;
            } catch {
              // ignore — will retry on next intersection
            } finally {
              loading = false;
              if (loaderEl) loaderEl.classList.add('hidden');
              if (nextPage > scrollTotalPages && libraryScrollObserver) {
                libraryScrollObserver.disconnect();
                libraryScrollObserver = null;
              }
            }
          };
          libraryScrollObserver = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) loadMore();
          }, { rootMargin: '400px' });
          libraryScrollObserver.observe(sentinelEl);
        }
      }

      bindToolbar(document.querySelector('.main-body'), {
        currentDirection: librarySortDirection,
        onSearch: (query) => {
          librarySearchQuery = query;
          libraryPage = 1;
          renderLibrary(libraryId);
        },
        onSort: (field, direction) => {
          librarySortField = field;
          librarySortDirection = direction;
          libraryPage = 1;
          renderLibrary(libraryId);
        },
      });

      bindLibraryHeader();
    } catch (err) {
      renderShell(renderError('Failed to load library', err.message, () => renderLibrary(libraryId)), 'libraries');
    }
  }

  // --- Author Detail ---

  async function renderAuthor(authorId) {
    if (!await checkAuth()) return;
    const thisGeneration = navigationGeneration;

    breadcrumbTrail = [
      { label: 'Libraries', path: '/libraries' },
      { label: '...', path: '#' },
    ];

    renderShell(`
      <div class="page-header"><h1>Loading...</h1></div>
      ${skeletonList(3)}
      <div class="mt-6">${skeletonCards(4)}</div>
    `, 'libraries');

    try {
      const [author, seriesList, standaloneBooks] = await Promise.all([
        apiGet(`/authors/${authorId}`),
        apiGet(`/authors/${authorId}/series`),
        apiGet(`/authors/${authorId}/standalone`),
      ]);

      if (isStaleNavigation(thisGeneration)) return;

      setTitle([author.name]);
      breadcrumbTrail = [
        { label: 'Libraries', path: '/libraries' },
        { label: author.name, path: `/author/${authorId}` },
      ];

      const serverSettings = await getServerSettings();
      const authorInitial = (author.name || '?').trim().charAt(0).toUpperCase() || '?';
      const seriesCountVal = author.series_count || (Array.isArray(seriesList) ? seriesList.length : 0);
      const bookCountVal = author.book_count || 0;
      const heroAvatar = `
        <div class="author-avatar author-avatar-lg" id="author-avatar">
          <span class="author-avatar-initial">${escapeHtml(authorInitial)}</span>
          ${serverSettings.author_images_enabled
            ? `<img class="author-avatar-img" id="author-avatar-img" alt="" src="${API}/authors/${authorId}/photo${mediaToken()}">`
            : ''}
        </div>
      `;

      let bodyContent = `
        <div class="page-header author-page-header">
          ${heroAvatar}
          <div class="author-hero-text">
            <h1>${escapeHtml(author.name)}</h1>
            <div class="author-hero-stats text-caption">
              ${bookCountVal} book${bookCountVal !== 1 ? 's' : ''}${seriesCountVal ? ` · ${seriesCountVal} series` : ''}<span id="author-hero-dates"></span>
            </div>
            <div id="author-hero-links" class="author-hero-links"></div>
          </div>
        </div>
        <div id="author-bio" class="author-bio"></div>
      `;

      const series = Array.isArray(seriesList) ? seriesList : (seriesList?.items || []);
      const standalone = Array.isArray(standaloneBooks) ? standaloneBooks : (standaloneBooks?.items || []);

      if (series.length === 0 && standalone.length === 0) {
        bodyContent += `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.bookOpen}</div>
            <h3>No books found</h3>
            <p>This author has no books in the library yet.</p>
          </div>
        `;
      } else {
        if (series.length > 0) {
          bodyContent += `
            <div class="mb-6">
              <h2 class="mb-4" style="display:flex;align-items:center;gap:var(--space-2)">${icon('series', 22)} Series</h2>
              <div class="list-group">
          `;
          for (const s of series) {
            bodyContent += `
              <div class="list-item" data-series-id="${s.id}" role="link" tabindex="0" aria-label="${escapeHtml(s.name)} series">
                <div class="list-item-content">
                  <div class="list-item-icon">${Icons.series}</div>
                  <div class="list-item-text">
                    <div class="list-item-name">${escapeHtml(s.name)}</div>
                    <div class="list-item-subtitle">${s.book_count || 0} book${(s.book_count || 0) !== 1 ? 's' : ''}</div>
                  </div>
                </div>
                <div class="list-item-meta">
                  <span class="nav-icon" style="width:16px;height:16px;color:var(--color-muted)">${Icons.chevronRight}</span>
                </div>
              </div>
            `;
          }
          bodyContent += `</div></div>`;
        }

        if (standalone.length > 0) {
          bodyContent += `
            <div>
              <h2 class="mb-4" style="display:flex;align-items:center;gap:var(--space-2)">${icon('book', 22)} Standalone Books</h2>
              <div class="grid grid-books">
          `;
          for (const book of standalone) {
            bodyContent += renderBookCard(book);
          }
          bodyContent += `</div></div>`;
        }
      }

      renderShell(bodyContent, 'settings');

      // Reveal the portrait only once it loads; drop it (showing the initial)
      // on error. Bound here because CSP blocks inline event handlers.
      const authorAvatarImg = document.getElementById('author-avatar-img');
      if (authorAvatarImg) {
        authorAvatarImg.addEventListener('load', () => authorAvatarImg.classList.add('loaded'));
        authorAvatarImg.addEventListener('error', () => authorAvatarImg.remove());
      }

      // Lazy-load author bio + metadata (Open Library / Wikipedia).
      apiGet(`/authors/${authorId}/info`).then((info) => {
        if (!info) return;
        const datesEl = document.getElementById('author-hero-dates');
        if (datesEl && (info.birth_date || info.death_date)) {
          const born = info.birth_date ? `b. ${escapeHtml(info.birth_date)}` : '';
          const died = info.death_date ? `d. ${escapeHtml(info.death_date)}` : '';
          datesEl.textContent = ` · ${[born, died].filter(Boolean).join(' – ')}`;
        }
        const bioEl = document.getElementById('author-bio');
        if (bioEl && info.bio) {
          const full = String(info.bio);
          const isLong = full.length > 600;
          const shown = isLong ? `${full.slice(0, 600)}…` : full;
          bioEl.innerHTML = `<p class="author-bio-text">${escapeHtml(shown)}</p>${isLong ? `<button class="btn btn-ghost btn-sm" id="author-bio-more">Read more</button>` : ''}`;
          document.getElementById('author-bio-more')?.addEventListener('click', () => {
            bioEl.querySelector('.author-bio-text').textContent = full;
            document.getElementById('author-bio-more').remove();
          });
        }
        const linksEl = document.getElementById('author-hero-links');
        if (linksEl) {
          const links = [];
          if (info.wikipedia_url) links.push(`<a class="btn btn-ghost btn-sm" href="${escapeHtml(info.wikipedia_url)}" target="_blank" rel="noopener">${icon('globe', 14)} Wikipedia</a>`);
          if (info.openlibrary_url) links.push(`<a class="btn btn-ghost btn-sm" href="${escapeHtml(info.openlibrary_url)}" target="_blank" rel="noopener">${icon('book', 14)} Open Library</a>`);
          linksEl.innerHTML = links.join('');
        }
      }).catch(() => {});

      // Bind
      document.querySelectorAll('[data-series-id]').forEach(item => {
        const handler = () => navigateTo(`/series/${item.dataset.seriesId}`);
        item.addEventListener('click', handler);
        item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

      document.querySelectorAll('[data-book-id]').forEach(card => {
        const handler = () => navigateTo(`/book/${card.dataset.bookId}`);
        card.addEventListener('click', handler);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });
    } catch (err) {
      renderShell(renderError('Failed to load author', err.message, () => renderAuthor(authorId)), 'libraries');
    }
  }

  // --- Series Detail ---

  async function renderSeries(seriesId) {
    if (!await checkAuth()) return;
    const thisGeneration = navigationGeneration;

    breadcrumbTrail = [
      { label: 'Libraries', path: '/libraries' },
      { label: '...', path: '#' },
    ];

    renderShell(`
      <div class="page-header"><h1>Loading...</h1></div>
      ${skeletonCards(6)}
    `, 'libraries');

    try {
      const data = await apiGet(`/series/${seriesId}`);

      if (isStaleNavigation(thisGeneration)) return;

      const books = data.books || [];

      setTitle([data.name]);
      breadcrumbTrail = [
        { label: 'Libraries', path: '/libraries' },
        { label: data.name, path: `/series/${seriesId}` },
      ];

      let bodyContent = `
        <div class="page-header">
          <h1>${escapeHtml(data.name)}</h1>
          <div class="actions">
            <span class="badge badge-teal">${books.length} book${books.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      `;

      if (books.length === 0) {
        bodyContent += `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.bookOpen}</div>
            <h3>No books in this series</h3>
            <p>This series appears to be empty.</p>
          </div>
        `;
      } else {
        bodyContent += `<div class="grid grid-books">`;
        for (const book of books) {
          bodyContent += renderBookCard(book, true);
        }
        bodyContent += `</div>`;
      }

      renderShell(bodyContent, 'settings');

      document.querySelectorAll('[data-book-id]').forEach(card => {
        const handler = () => navigateTo(`/book/${card.dataset.bookId}`);
        card.addEventListener('click', handler);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });
    } catch (err) {
      renderShell(renderError('Failed to load series', err.message, () => renderSeries(seriesId)), 'libraries');
    }
  }

  // --- Book Detail ---

  async function renderBook(bookId) {
    if (!await checkAuth()) return;
    const thisGeneration = navigationGeneration;

    breadcrumbTrail = [
      { label: 'Libraries', path: '/libraries' },
      { label: '...', path: '#' },
    ];

    renderShell(`
      <div class="book-detail">
        <div class="book-detail-cover"><div class="skeleton skeleton-cover"></div></div>
        <div>
          <div class="skeleton skeleton-title"></div>
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text" style="width:40%"></div>
        </div>
      </div>
    `, 'libraries');

    try {
      const book = await apiGet(`/books/${bookId}`);

      if (isStaleNavigation(thisGeneration)) return;

      setTitle([book.title]);
      breadcrumbTrail = [
        { label: 'Libraries', path: '/libraries' },
        { label: book.title, path: `/book/${bookId}` },
      ];

      const coverUrl = book.has_cover ? `${API}/books/${bookId}/cover${mediaToken()}` : '';
      const formats = book.formats || [];
      const tags = book.tags || [];
      const genres = book.genres || [];
      const languages = book.languages || [];
      const customFields = book.custom || {};

      // Build rating stars
      let ratingHtml = '';
      if (book.rating) {
        const stars = Math.round(book.rating / 2);
        ratingHtml = `<span class="rating">`;
        for (let i = 0; i < 5; i++) {
          ratingHtml += i < stars ? '<span>&#9733;</span>' : '<span class="star-empty">&#9733;</span>';
        }
        ratingHtml += `</span>`;
      }

      // Genre chips
      let genreChipsHtml = '';
      if (genres.length > 0) {
        genreChipsHtml = `<div class="genre-chips">${genres.map(genreItem => {
          const genreItemName = typeof genreItem === 'string' ? genreItem : genreItem.name;
          return `<a href="#/genre/${encodeURIComponent(genreItemName)}" class="genre-chip" style="background:${genreColorFromName(genreItemName)}">${escapeHtml(genreItemName)}</a>`;
        }).join('')}</div>`;
      }

      let bodyContent = `
        <div class="book-detail">
          <div class="book-detail-cover">
            ${coverUrl
              ? `<div class="book-cover" id="cover-zoom-trigger" role="button" tabindex="0" aria-label="Zoom cover image"><img src="${coverUrl}" alt="Cover of ${escapeHtml(book.title)}" loading="lazy"></div>`
              : `<div class="book-cover-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>`
            }
          </div>
          <div class="book-detail-info">
            <h1>${escapeHtml(book.title)} ${renderDetailStatusPill(bookId)}</h1>
            ${(book.author_names && book.author_names.length > 0) ? `<a class="author-link" href="#/author/${(book.author_ids && book.author_ids[0]) || ''}">${escapeHtml(book.author_names.join(', '))}</a>` : ''}
            ${book.series_name ? `<p class="text-caption" style="margin-top:var(--space-2)">Book ${book.series_index || '?'} of <a href="#/series/${book.series_id || ''}">${escapeHtml(book.series_name)}</a></p>` : ''}
            ${genreChipsHtml}

            <dl class="book-detail-metadata">
              ${tags.length > 0 ? `<dt>Tags</dt><dd>${tags.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join(' ')}</dd>` : ''}
              ${languages.length > 0 ? `<dt>Language</dt><dd>${escapeHtml(languages.join(', '))}</dd>` : ''}
              ${book.rating ? `<dt>Rating</dt><dd>${ratingHtml}</dd>` : ''}
              ${book.pubdate ? `<dt>Published</dt><dd>${escapeHtml(book.pubdate)}</dd>` : ''}
              ${book.publisher ? `<dt>Publisher</dt><dd>${escapeHtml(book.publisher)}</dd>` : ''}
              ${book.isbn ? `<dt>ISBN</dt><dd><code>${escapeHtml(book.isbn)}</code></dd>` : ''}
            </dl>

            ${formats.length > 0 ? `
              <div class="book-detail-formats">
                ${(() => {
                  const readableFormats = formats
                    .map(f => f.kind.toLowerCase())
                    .filter(k => k === 'epub' || k === 'pdf' || k === 'cbz' || k === 'cbr');
                  if (readableFormats.length === 0) return '';
                  // Pick best format to read: epub > pdf > cbz
                  const preferredOrder = ['epub', 'pdf', 'cbz', 'cbr'];
                  const bestFormat = preferredOrder.find(pf => readableFormats.includes(pf)) || readableFormats[0];
                  const formatLabel = bestFormat === 'epub' ? 'Read' : `Read ${bestFormat.toUpperCase()}`;
                  return `<a href="#/read/${bookId}/${bestFormat}" class="btn btn-read" aria-label="${formatLabel}">
                    ${icon('bookOpen', 16)} ${formatLabel}
                  </a>`;
                })()}
                ${formats.map(f => `
                  <a href="${API}/books/${bookId}/file?format=${f.kind}${mediaToken("&")}" class="btn btn-primary" download aria-label="Download ${f.kind} format">
                    ${icon('download', 16)} ${escapeHtml(f.kind.toUpperCase())}
                  </a>
                `).join('')}
                ${renderAddToCollectionButton(bookId)}
                <button class="btn btn-secondary" id="add-to-queue-btn">${icon('clock', 16)} Add to Queue</button>
                ${renderMarkReadButton(bookId)}
                <div id="convert-btn-container"></div>
                ${(!book.description || hasPermission('manage_library')) ? `<button class="btn btn-secondary" id="enrich-metadata-btn">${icon('zap', 16)} Enrich Metadata</button>` : ''}
                ${hasPermission('manage_library') && book.author_names && book.author_names.length > 0 ? `<button class="btn btn-secondary" id="find-more-author-btn">${icon('search', 16)} Find More by Author</button>` : ''}
              </div>
            ` : `
              <div class="book-detail-formats">
                ${renderAddToCollectionButton(bookId)}
                <button class="btn btn-secondary" id="add-to-queue-btn">${icon('clock', 16)} Add to Queue</button>
                ${renderMarkReadButton(bookId)}
                <div id="convert-btn-container"></div>
                ${(!book.description || hasPermission('manage_library')) ? `<button class="btn btn-secondary" id="enrich-metadata-btn">${icon('zap', 16)} Enrich Metadata</button>` : ''}
                ${hasPermission('manage_library') && book.author_names && book.author_names.length > 0 ? `<button class="btn btn-secondary" id="find-more-author-btn">${icon('search', 16)} Find More by Author</button>` : ''}
              </div>
            `}

            ${Object.keys(customFields).length > 0 ? `
              <div class="book-detail-custom">
                <h3 class="mb-4">Custom Fields</h3>
                <dl class="book-detail-metadata">
                  ${Object.entries(customFields).map(([key, value]) => `
                    <dt>${escapeHtml(key)}</dt>
                    <dd>${escapeHtml(String(value))}</dd>
                  `).join('')}
                </dl>
              </div>
            ` : ''}

            ${book.description ? `
              <div class="book-detail-description">
                ${sanitizeDescription(book.description)}
              </div>
            ` : ''}
          </div>
        </div>
      `;

      renderShell(bodyContent, 'settings');

      // Post-render event bindings — wrapped in try-catch so one failed
      // binding does not kill the entire page render.
      try {
        // Cover zoom
        const coverTrigger = document.getElementById('cover-zoom-trigger');
        if (coverTrigger && coverUrl) {
          const openZoom = () => {
            const overlay = document.createElement('div');
            overlay.className = 'cover-zoom-overlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-label', 'Enlarged cover image');
            overlay.innerHTML = `<img src="${coverUrl}" alt="Cover of ${escapeHtml(book.title)}">`;
            document.body.appendChild(overlay);

            const closeZoom = () => overlay.remove();
            overlay.addEventListener('click', closeZoom);
            document.addEventListener('keydown', function escHandler(e) {
              if (e.key === 'Escape') { closeZoom(); document.removeEventListener('keydown', escHandler); }
            });
          };
          coverTrigger.addEventListener('click', openZoom);
          coverTrigger.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openZoom(); } });
        }

        // Bind add-to-collection
        bindAddToCollectionButton(bookId);

        // Bind add-to-queue
        document.getElementById('add-to-queue-btn')?.addEventListener('click', async () => {
          const queueBtn = document.getElementById('add-to-queue-btn');
          if (queueBtn) queueBtn.disabled = true;
          try {
            await apiPost('/me/queue', { book_id: bookId });
            toast('Added to reading queue', 'success');
            if (queueBtn) queueBtn.innerHTML = `${icon('check', 16)} In Queue`;
          } catch (queueError) {
            toast(queueError.message, 'error');
            if (queueBtn) queueBtn.disabled = false;
          }
        });

        // Bind mark read / unread toggle
        document.getElementById('toggle-read-btn')?.addEventListener('click', () => {
          const toggleBtn = document.getElementById('toggle-read-btn');
          const isFinished = toggleBtn?.dataset.finished === 'true';

          const markUnread = async () => {
            try {
              await apiDelete(`/books/${bookId}/complete`);
              toast('Marked as unread', 'success');
              await loadReadingStates(true);
              renderBook(bookId);
            } catch (toggleError) {
              toast(toggleError.message, 'error');
            }
          };

          const markRead = async () => {
            if (toggleBtn) toggleBtn.disabled = true;
            try {
              await apiPost(`/books/${bookId}/complete`, {});
              toast('Marked as read', 'success');
              await loadReadingStates(true);
              renderBook(bookId);
            } catch (toggleError) {
              toast(toggleError.message, 'error');
              if (toggleBtn) toggleBtn.disabled = false;
            }
          };

          if (isFinished) {
            showConfirmModal({
              title: 'Mark as unread?',
              message: 'This clears your saved position so the book reopens from the beginning.',
              confirmText: 'Mark Unread',
              confirmClass: 'btn-primary',
              onConfirm: markUnread,
            });
          } else {
            markRead();
          }
        });

        // Bind enrich metadata
        document.getElementById('enrich-metadata-btn')?.addEventListener('click', () => showMetadataSearchModal(bookId));

        // Bind find-more-by-author
        const findMoreAuthorBtn = document.getElementById('find-more-author-btn');
        if (findMoreAuthorBtn && book.author_names && book.author_names.length > 0) {
          findMoreAuthorBtn.addEventListener('click', () => {
            const authorName = book.author_names[0];
            navigateTo(`/acquisition/search?author=${encodeURIComponent(authorName)}`);
          });
        }
      } catch (bindingError) {
        console.warn('Book detail: non-critical binding failed:', bindingError);
      }

      // Render ratings & reviews below description (async, independent)
      renderBookRatingsAndReviews(bookId, '.book-detail-info').catch(ratingsError => {
        console.warn('Book detail: ratings/reviews failed:', ratingsError);
      });

      // Render conversion button if converters available (async, independent)
      renderConversionButton(bookId, '#convert-btn-container').catch(conversionError => {
        console.warn('Book detail: conversion button failed:', conversionError);
      });
    } catch (err) {
      console.error('renderBook crash:', err);
      console.error('renderBook stack:', err?.stack);
      const errorMessage = (err && typeof err.message === 'string') ? err.message : String(err || 'Unknown error');
      renderShell(renderError('Failed to load book', errorMessage, () => renderBook(bookId)), 'libraries');
    }
  }

  // --- Settings ---

  // Plex-style settings categories. Order shown in the left nav; categories
  // with no present sections (e.g. owner-only ones for a normal user) are
  // automatically omitted.
  const SETTINGS_CATEGORY_ORDER = ['general', 'library', 'network', 'devices', 'users', 'account', 'notifications', 'reader', 'data'];
  const SETTINGS_CATEGORY_META = {
    general: { label: 'General', icon: 'settings' },
    library: { label: 'Library', icon: 'library' },
    network: { label: 'Cloud & Remote Access', icon: 'globe' },
    devices: { label: 'Devices & API', icon: 'link' },
    users: { label: 'Users', icon: 'users' },
    account: { label: 'Account', icon: 'lock' },
    notifications: { label: 'Notifications', icon: 'bell' },
    reader: { label: 'Reader', icon: 'book' },
    data: { label: 'Data', icon: 'download' },
  };

  function setupSettingsNav(requestedCategory) {
    const nav = document.getElementById('settings-nav');
    if (!nav) return;
    const sections = Array.from(document.querySelectorAll('.settings-content [data-cat]'));
    const present = [];
    sections.forEach((section) => {
      if (!present.includes(section.dataset.cat)) present.push(section.dataset.cat);
    });
    const ordered = SETTINGS_CATEGORY_ORDER.filter((cat) => present.includes(cat));
    if (ordered.length === 0) return;
    const activeCategory = ordered.includes(requestedCategory) ? requestedCategory : ordered[0];

    nav.innerHTML = ordered.map((cat) => {
      const meta = SETTINGS_CATEGORY_META[cat] || { label: cat, icon: 'settings' };
      return `<a href="#/settings/${cat}" class="settings-nav-item${cat === activeCategory ? ' active' : ''}">${icon(meta.icon, 18)}<span>${escapeHtml(meta.label)}</span></a>`;
    }).join('');

    sections.forEach((section) => { section.hidden = section.dataset.cat !== activeCategory; });
  }

  // --- Background task monitor ---
  let backgroundTasksPollInterval = null;
  async function loadBackgroundTasks() {
    const container = document.getElementById('background-tasks-list');
    if (!container) {
      if (backgroundTasksPollInterval) { clearInterval(backgroundTasksPollInterval); backgroundTasksPollInterval = null; }
      return;
    }
    try {
      const tasks = await apiGet('/server/tasks');
      const list = Array.isArray(tasks) ? tasks : [];
      if (list.length === 0) {
        container.innerHTML = `<p class="text-caption" style="color:var(--color-muted)">No recent tasks.</p>`;
        return;
      }
      container.innerHTML = list.slice().reverse().slice(0, 10).map((task) => {
        const pct = task.total > 0 ? Math.round((task.current / task.total) * 100) : (task.status === 'completed' ? 100 : 0);
        const statusColor = task.status === 'completed' ? 'var(--color-success)'
          : task.status === 'failed' ? 'var(--color-danger)' : 'var(--color-teal-bright)';
        const statusText = task.status === 'running' ? `running ${task.current}/${task.total}` : task.status;
        return `
          <div class="card" style="margin-bottom:var(--space-2);padding:var(--space-3)">
            <div style="display:flex;justify-content:space-between;gap:var(--space-2);align-items:center">
              <strong>${escapeHtml(task.label)}</strong>
              <span style="color:${statusColor};font-size:var(--text-sm)">${escapeHtml(statusText)}</span>
            </div>
            <div class="progress-bar" style="margin-top:var(--space-2)"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
            ${task.message ? `<p class="text-caption" style="margin-top:var(--space-1);color:var(--color-muted)">${escapeHtml(task.message)}</p>` : ''}
          </div>`;
      }).join('');
    } catch {
      // ignore — non-critical
    }
  }

  async function renderSettings(activeCategory) {
    if (!await checkAuth()) return;
    setTitle(['Settings']);
    breadcrumbTrail = [{ label: 'Settings', path: '/settings' }];

    renderShell(`
      <div class="page-header"><h1>Settings</h1></div>
      ${skeletonList(2)}
    `, 'settings');

    try {
      const keys = await apiGet('/auth/api-keys').catch(() => []);
      const serverSettings = await getServerSettings(true);

      let bodyContent = `
        <div class="page-header"><h1>Settings</h1></div>

        <div class="settings-layout">
        <aside class="settings-nav" id="settings-nav"></aside>
        <div class="settings-content">

        <div class="settings-section" id="libraries-section" data-cat="library">
          <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('library', 20)} Libraries</h3>
          <p class="description">Browse, add, scan, and manage your libraries. Pin a library to keep it in the sidebar for quick access.</p>
          <a href="#/libraries" class="btn btn-primary">${icon('library', 16)} Manage Libraries</a>
        </div>

        ${currentUser?.is_owner ? `
        <div class="settings-section" data-cat="library" id="calibre-writeback-section">
          <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('database', 20)} Calibre Write-Back</h3>
          <p class="description">Optionally write applied metadata changes back to your Calibre library. Direct database writes are never used — choose Calibre's <code>calibredb</code> CLI or its Content Server API. Leave off to keep changes as Ironshelf-only overrides.</p>
          <div class="form-group">
            <label class="form-label" for="calibre-wb-mode">Mode</label>
            <select class="form-input" id="calibre-wb-mode" style="width:auto;min-width:300px">
              <option value="none" ${serverSettings.calibre_writeback_mode === 'none' ? 'selected' : ''}>Off — Ironshelf overrides only</option>
              <option value="calibredb" ${serverSettings.calibre_writeback_mode === 'calibredb' ? 'selected' : ''}>calibredb CLI</option>
              <option value="content_server" ${serverSettings.calibre_writeback_mode === 'content_server' ? 'selected' : ''}>Calibre Content Server API</option>
            </select>
          </div>
          <div id="calibre-wb-calibredb-fields" class="${serverSettings.calibre_writeback_mode === 'calibredb' ? '' : 'hidden'}">
            <div class="form-group">
              <label class="form-label" for="calibre-wb-path">calibredb path</label>
              <input type="text" class="form-input" id="calibre-wb-path" placeholder="calibredb" value="${escapeHtml(serverSettings.calibredb_path || '')}">
              <p class="form-hint">Leave as <code>calibredb</code> if it's on the server's PATH. The Calibre desktop app must be closed while writing (it locks the library).</p>
            </div>
          </div>
          <div id="calibre-wb-cs-fields" class="${serverSettings.calibre_writeback_mode === 'content_server' ? '' : 'hidden'}">
            <div class="form-group">
              <label class="form-label" for="calibre-wb-url">Content Server URL</label>
              <input type="url" class="form-input" id="calibre-wb-url" placeholder="http://localhost:8080" value="${escapeHtml(serverSettings.calibre_cs_url || '')}">
            </div>
            <div class="form-group">
              <label class="form-label" for="calibre-wb-library">Library ID</label>
              <input type="text" class="form-input" id="calibre-wb-library" placeholder="Calibre_Library" value="${escapeHtml(serverSettings.calibre_cs_library_id || '')}">
              <p class="form-hint">The library name as it appears in the Content Server URL (e.g. <code>Calibre_Library</code>).</p>
            </div>
            <div class="form-group">
              <label class="form-label" for="calibre-wb-username">Username</label>
              <input type="text" class="form-input" id="calibre-wb-username" autocomplete="off" value="${escapeHtml(serverSettings.calibre_cs_username || '')}">
            </div>
            <div class="form-group">
              <label class="form-label" for="calibre-wb-password">Password</label>
              <input type="password" class="form-input" id="calibre-wb-password" autocomplete="new-password" placeholder="${serverSettings.calibre_cs_password_set ? '•••••••• (unchanged)' : ''}">
              <p class="form-hint">Leave blank to keep the current password. Content Server must allow writes (run with user accounts that have write permission).</p>
            </div>
          </div>
          <button class="btn btn-primary" id="calibre-wb-save">${icon('check', 16)} Save</button>
        </div>
        ` : ''}

        ${currentUser?.is_owner ? `
        <div class="settings-section" id="author-photos-section" data-cat="general">
          <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('users', 20)} Author Photos</h3>
          <p class="description">Download author portraits from Open Library and cache them on this server. Disabling stops all lookups and clears the cache.</p>
          <label style="display:flex;align-items:center;gap:var(--space-2);cursor:pointer">
            <input type="checkbox" id="author-photos-toggle" ${serverSettings.author_images_enabled ? 'checked' : ''}>
            <span>Enable author photos</span>
          </label>
          <div style="display:flex;flex-wrap:wrap;gap:var(--space-3);margin-top:var(--space-4)">
            <button class="btn btn-secondary" id="prefetch-author-photos-btn">${icon('download', 16)} Download all author metadata</button>
            <button class="btn btn-ghost" id="refetch-author-photos-btn">${icon('refresh', 16)} Re-fetch all (clear cache)</button>
          </div>
          <p class="form-hint" style="margin-top:var(--space-2)">Fetches a portrait <em>and</em> bio for every author (Open Library + Wikipedia) in the background. "Re-fetch all" clears cached results first — use it if data is missing after a network/tunnel issue.</p>
        </div>
        ` : ''}

        ${currentUser?.is_owner ? `
        <div class="settings-section" id="background-tasks-section" data-cat="general">
          <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('activity', 20)} Background Tasks</h3>
          <p class="description">Long-running jobs such as author-photo downloads. Updates live while this page is open.</p>
          <div id="background-tasks-list"><p class="text-caption" style="color:var(--color-muted)">Loading…</p></div>
        </div>
        ` : ''}

        ${currentUser?.is_owner ? `
        <div class="settings-section" id="server-update-section" data-cat="general">
          <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('download', 20)} Server Update</h3>
          <p class="description">Check for new Ironshelf server releases and apply updates directly from the UI.</p>
          <div class="update-card" id="update-card">
            <div class="update-actions">
              <button class="btn btn-primary" id="check-update-btn">${icon('refresh', 16)} Check for Updates</button>
            </div>
          </div>
        </div>
        ` : ''}

        ${currentUser?.is_owner ? `
        <div class="settings-section" id="cloud-settings-section" data-cat="network">
          <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('globe', 20)} Ironshelf Cloud &amp; Remote Access</h3>
          <p class="description">Connect this server to Ironshelf Cloud for remote access. Enabling it starts a Cloudflare Tunnel automatically and lets users sign in with their cloud account from anywhere.</p>
          <div class="cloud-claim-card" id="cloud-claim-card">
            <div class="cloud-claim-loading">
              <div class="skeleton skeleton-text" style="width:100%;height:48px"></div>
            </div>
          </div>

          <details class="remote-access-advanced" style="margin-top:var(--space-4)">
            <summary style="cursor:pointer;color:var(--color-muted)">Advanced — remote access method</summary>
            <p class="description" style="margin-top:var(--space-3)">Choose how this server is reachable from outside your network. Cloudflare Tunnel (used by Cloud) is recommended; UPnP or manual port-forwarding are alternatives.</p>
            <div class="card remote-access-card" id="remote-access-card">
              <div class="remote-access-loading">
                <div class="skeleton skeleton-text" style="width:100%;height:48px"></div>
              </div>
            </div>
          </details>
        </div>
        ` : ''}

        <div class="settings-section" data-cat="devices">
          <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('key', 20)} API Keys</h3>
          <p class="description">API keys authenticate the Flutter app or external tools. The key is shown once upon creation.</p>

          <div class="list-group" id="api-keys-list">
            ${(keys || []).length === 0 ? `
              <div style="padding:var(--space-6);text-align:center;color:var(--color-muted);font-size:var(--text-sm)">
                No API keys created yet
              </div>
            ` : (keys || []).map(k => `
              <div class="list-item" style="cursor:default">
                <div class="list-item-content">
                  <div class="list-item-icon">${Icons.key}</div>
                  <div class="list-item-text">
                    <div class="list-item-name">${escapeHtml(k.label || 'Unnamed key')}</div>
                    <div class="list-item-subtitle" style="font-family:var(--font-mono)">irs_${escapeHtml(k.prefix)}...</div>
                  </div>
                </div>
                <div class="list-item-meta">
                  <button class="btn btn-ghost btn-sm delete-key-btn" data-key-id="${k.id}" aria-label="Delete API key ${escapeHtml(k.label)}">
                    ${icon('trash', 14)}
                  </button>
                </div>
              </div>
            `).join('')}
          </div>

          <button class="btn btn-primary mt-4" id="create-api-key-btn">${icon('plus', 16)} Create API Key</button>
        </div>

        <div class="settings-section" data-cat="devices">
          <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('link', 20)} Device Integration</h3>
          <p class="description">Connect e-readers and third-party apps to your Ironshelf server.</p>

          ${(() => {
            const origin = window.location.origin;
            const firstKey = (keys || []).length > 0 ? keys[0] : null;
            const keyDisplay = firstKey ? `irs_${escapeHtml(firstKey.prefix)}...` : '&lt;create-api-key-first&gt;';
            const keyForUrl = firstKey ? `irs_${firstKey.prefix}...` : '<create-api-key-first>';
            const noKeyNote = !firstKey ? '<p class="text-caption" style="margin-top:var(--space-2);color:var(--color-warning)">Create an API key above first.</p>' : '';

            return `
              <div class="device-integration-cards">
                <div class="card device-card">
                  <div class="device-card-header">
                    <span class="device-card-icon">${Icons.rss}</span>
                    <h4>OPDS Connection</h4>
                  </div>
                  <p class="text-caption">Connect KOReader, Moon+ Reader, or other OPDS readers.</p>
                  <div class="device-url-row">
                    <code class="device-url" id="opds-url">${origin}/opds</code>
                    <button class="btn btn-ghost btn-sm copy-device-url" data-copy-target="opds-url" aria-label="Copy OPDS URL">${icon('copy', 14)}</button>
                  </div>
                  <p class="form-hint">Use your API key as Bearer token in the reader's authentication settings.</p>
                  ${noKeyNote}
                </div>

                <div class="card device-card">
                  <div class="device-card-header">
                    <span class="device-card-icon">${Icons.book}</span>
                    <h4>Kobo Sync</h4>
                  </div>
                  <p class="text-caption">Connect your Kobo e-reader.</p>
                  <div class="device-url-row">
                    <code class="device-url" id="kobo-url">${origin}/kobo/${escapeHtml(keyForUrl)}/v1/initialization</code>
                    <button class="btn btn-ghost btn-sm copy-device-url" data-copy-target="kobo-url" aria-label="Copy Kobo URL">${icon('copy', 14)}</button>
                  </div>
                  <p class="form-hint">In Kobo settings, set your custom server to this URL.</p>
                  ${noKeyNote}
                </div>

                <div class="card device-card">
                  <div class="device-card-header">
                    <span class="device-card-icon">${Icons.hardDrive}</span>
                    <h4>WebDAV (KOReader Sync)</h4>
                  </div>
                  <p class="text-caption">Sync KOReader reading progress via WebDAV.</p>
                  <div class="device-url-row">
                    <code class="device-url" id="webdav-url">${origin}/webdav/${escapeHtml(keyForUrl)}/</code>
                    <button class="btn btn-ghost btn-sm copy-device-url" data-copy-target="webdav-url" aria-label="Copy WebDAV URL">${icon('copy', 14)}</button>
                  </div>
                  <p class="form-hint">In KOReader, go to Settings &rarr; Cloud Storage &rarr; WebDAV and enter this URL.</p>
                  ${noKeyNote}
                </div>
              </div>
            `;
          })()}
        </div>

        <div class="settings-section" data-cat="account">
          <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('lock', 20)} Change Password</h3>
          <p class="description">Update your account password. You must provide your current password for verification.</p>
          <form id="change-password-form" class="card" style="max-width:400px;display:flex;flex-direction:column;gap:var(--space-4)" novalidate>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label" for="current-password">Current Password</label>
              <input type="password" class="form-input" id="current-password" name="current_password" required autocomplete="current-password">
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label" for="new-password">New Password</label>
              <input type="password" class="form-input" id="new-password" name="new_password" required minlength="8" autocomplete="new-password">
              <p class="form-hint">Minimum 8 characters.</p>
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label" for="confirm-password">Confirm New Password</label>
              <input type="password" class="form-input" id="confirm-password" name="confirm_password" required minlength="8" autocomplete="new-password">
            </div>
            <div id="password-error" class="form-error hidden" role="alert"></div>
            <button type="submit" class="btn btn-primary" style="align-self:flex-start">${icon('check', 16)} Update Password</button>
          </form>
        </div>

        ${currentUser?.is_owner ? `
        <div class="settings-section" data-cat="users">
          <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('mail', 20)} Pending Invites</h3>
          <p class="description">Invite new users by creating invite codes. Share the code with someone to let them create an account.</p>
          <div class="list-group" id="invites-list">
            <div style="padding:var(--space-6);text-align:center;color:var(--color-muted);font-size:var(--text-sm)">Loading invites...</div>
          </div>
          <button class="btn btn-primary mt-4" id="create-invite-btn">${icon('plus', 16)} Create Invite</button>
        </div>
        ` : ''}

        ${currentUser?.is_owner ? `
        <div class="settings-section" data-cat="users" id="auth-providers-section">
          <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('shield', 20)} Login Providers</h3>
          <p class="description">Let users sign in with Google, GitHub, or any OIDC/OAuth2 provider. In the provider's console, register the callback URL <code id="sso-callback-base">${escapeHtml(location.origin)}</code><code>/api/v1/auth/sso/&lt;id&gt;/callback</code>.</p>
          <div class="list-group" id="auth-providers-list">
            <div style="padding:var(--space-6);text-align:center;color:var(--color-muted);font-size:var(--text-sm)">Loading providers...</div>
          </div>
          <div class="card mt-4">
            <h4 style="margin-bottom:var(--space-3)" id="sso-form-title">Add provider</h4>
            <div class="form-group">
              <label class="form-label" for="sso-preset">Preset</label>
              <select class="form-input" id="sso-preset">
                <option value="google">Google (OIDC)</option>
                <option value="github">GitHub (OAuth2)</option>
                <option value="custom">Custom…</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="sso-id">Provider ID (slug)</label>
              <input class="form-input" id="sso-id" placeholder="google" autocomplete="off">
            </div>
            <div class="form-group">
              <label class="form-label" for="sso-name">Display name</label>
              <input class="form-input" id="sso-name" placeholder="Google" autocomplete="off">
            </div>
            <div class="form-group" id="sso-kind-group" style="display:none">
              <label class="form-label" for="sso-kind">Kind</label>
              <select class="form-input" id="sso-kind">
                <option value="oidc">oidc</option>
                <option value="oauth2">oauth2</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="sso-client-id">Client ID</label>
              <input class="form-input" id="sso-client-id" autocomplete="off">
            </div>
            <div class="form-group">
              <label class="form-label" for="sso-client-secret">Client Secret</label>
              <input class="form-input" id="sso-client-secret" type="password" placeholder="(leave blank to keep existing)" autocomplete="off">
            </div>
            <div id="sso-custom-fields" style="display:none">
              <div class="form-group"><label class="form-label" for="sso-issuer">Issuer URL (OIDC)</label><input class="form-input" id="sso-issuer" autocomplete="off"></div>
              <div class="form-group"><label class="form-label" for="sso-authorize">Authorize URL (OAuth2)</label><input class="form-input" id="sso-authorize" autocomplete="off"></div>
              <div class="form-group"><label class="form-label" for="sso-token">Token URL (OAuth2)</label><input class="form-input" id="sso-token" autocomplete="off"></div>
              <div class="form-group"><label class="form-label" for="sso-userinfo">Userinfo URL (OAuth2)</label><input class="form-input" id="sso-userinfo" autocomplete="off"></div>
              <div class="form-group"><label class="form-label" for="sso-scopes">Scopes (space-separated)</label><input class="form-input" id="sso-scopes" autocomplete="off"></div>
            </div>
            <label style="display:flex;gap:var(--space-2);align-items:center;margin-bottom:var(--space-2)"><input type="checkbox" id="sso-enabled" checked> Enabled</label>
            <label style="display:flex;gap:var(--space-2);align-items:center"><input type="checkbox" id="sso-auto-register" checked> Auto-register new users on first login</label>
            <div style="display:flex;gap:var(--space-2);margin-top:var(--space-4)">
              <button class="btn btn-primary" id="sso-save-btn">${icon('plus', 16)} Save Provider</button>
              <button class="btn btn-secondary" id="sso-reset-btn" style="display:none">Cancel edit</button>
            </div>
          </div>
        </div>
        ` : ''}

        <div class="settings-section" data-cat="data">
          <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('download', 20)} Export / Import</h3>
          <p class="description">Export your reading progress, collections, and preferences as JSON. Import a previously exported file to restore data.</p>
          <div class="card" style="display:flex;flex-wrap:wrap;gap:var(--space-4);align-items:center">
            <div style="flex:1;min-width:200px">
              <h4 style="margin-bottom:var(--space-1)">Export Data</h4>
              <p class="text-caption">Download all your user data as a JSON file.</p>
              <button class="btn btn-primary mt-4" id="export-data-btn">${icon('download', 16)} Download Export</button>
            </div>
            <div style="width:1px;height:60px;background:var(--color-border-subtle)"></div>
            <div style="flex:1;min-width:200px">
              <h4 style="margin-bottom:var(--space-1)">Import Data</h4>
              <p class="text-caption">Restore from a previous export file.</p>
              <label class="btn btn-secondary mt-4" style="cursor:pointer" id="import-data-label">
                ${icon('upload', 16)} Choose File
                <input type="file" accept=".json,application/json" id="import-data-input" style="display:none">
              </label>
            </div>
          </div>
        </div>

        <div class="settings-section" data-cat="notifications">
          <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('bell', 20)} Notification Preferences</h3>
          <p class="description">Control which notification types appear in your notification panel. Preferences are stored locally in this browser.</p>

          <div class="list-group" id="notification-prefs-list">
            ${Object.entries(NotificationTypeConfig).map(([typeKey, typeConfig]) => {
              const prefs = getNotificationPreferences();
              const isEnabled = prefs[typeKey] !== false;
              return `
                <div class="list-item" style="cursor:default">
                  <div class="list-item-content">
                    <div class="list-item-icon notif-pref-icon ${typeConfig.accentClass}">${Icons[typeConfig.icon]}</div>
                    <div class="list-item-text">
                      <div class="list-item-name">${escapeHtml(typeConfig.label)}</div>
                      <div class="list-item-subtitle">${escapeHtml(typeKey.replace(/_/g, ' '))}</div>
                    </div>
                  </div>
                  <div class="list-item-meta">
                    <label class="form-toggle">
                      <input type="checkbox" data-notif-type="${typeKey}" ${isEnabled ? 'checked' : ''}>
                    </label>
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <button class="btn btn-danger mt-4" id="clear-all-notifications-btn">${icon('trash', 16)} Clear All Notifications</button>
        </div>

        ${renderReaderPreferencesSection()}

        ${hasPermission('manage_library') ? `
          <div class="settings-section" data-cat="library">
            <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('globe', 20)} Integrations</h3>
            <p class="description">Manage webhooks, duplicate detection, and other advanced features.</p>
            <div style="display:flex;flex-wrap:wrap;gap:var(--space-3)">
              ${hasPermission('manage_library') ? `<a href="#/webhooks" class="btn btn-secondary">${icon('globe', 16)} Webhooks</a>` : ''}
              ${currentUser?.is_owner ? `<a href="#/duplicates" class="btn btn-secondary">${icon('search', 16)} Duplicate Detection</a>` : ''}
            </div>
          </div>
        ` : ''}

        <div class="settings-section" data-cat="account">
          <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('globe', 20)} Ironshelf Cloud Account</h3>
          <p class="description">Link your Ironshelf Cloud account to this user so you can sign into this server with your cloud login. They become one account.</p>
          ${currentUser?.cloud_linked
            ? `<p style="display:flex;align-items:center;gap:var(--space-2);color:var(--color-teal-bright)">${icon('check', 16)} Linked to Ironshelf Cloud.</p>
               <button class="btn btn-danger" id="unlink-cloud-btn">${icon('x', 16)} Unlink Cloud Account</button>`
            : `<button class="btn btn-secondary" id="link-cloud-btn">${icon('globe', 16)} Link Ironshelf Cloud Account</button>`}
        </div>

        <div class="settings-section" data-cat="account">
          <h3>Account</h3>
          <div class="card">
            <dl class="book-detail-metadata" style="margin:0;padding:0;background:transparent;border:0">
              <dt>Username</dt>
              <dd>${escapeHtml(currentUser?.username || '')}</dd>
              <dt>Role</dt>
              <dd><span class="badge ${currentUser?.is_owner ? 'badge-teal' : 'badge-muted'}">${currentUser?.is_owner ? 'Owner' : 'User'}</span></dd>
            </dl>
          </div>
        </div>

        </div><!-- settings-content -->
        </div><!-- settings-layout -->

        <div class="settings-version-footer" id="settings-version-footer">
          <span class="settings-version-text">${cachedServerVersion ? `Ironshelf v${cachedServerVersion}` : 'Ironshelf'}</span>
        </div>
      `;

      renderShell(bodyContent, 'settings');
      setupSettingsNav(activeCategory);

      // If version was not yet fetched, populate it now
      if (!cachedServerVersion) {
        fetchServerVersion().then(() => {
          const versionFooter = document.getElementById('settings-version-footer');
          if (versionFooter && cachedServerVersion) {
            versionFooter.querySelector('.settings-version-text').textContent = `Ironshelf v${cachedServerVersion}`;
          }
        });
      }

      // Author photos toggle
      document.getElementById('author-photos-toggle')?.addEventListener('change', async (toggleEvent) => {
        const enabled = toggleEvent.target.checked;
        toggleEvent.target.disabled = true;
        try {
          const updated = await apiPut('/server/settings', { author_images_enabled: enabled });
          cachedServerSettings = updated;
          toast(enabled ? 'Author photos enabled' : 'Author photos disabled (cache cleared)', 'success');
        } catch (toggleError) {
          toggleEvent.target.checked = !enabled;
          toast(toggleError.message || 'Failed to update setting', 'error');
        } finally {
          toggleEvent.target.disabled = false;
        }
      });

      // Bulk-download author photos
      const prefetchPhotos = async (refresh) => {
        const buttons = [document.getElementById('prefetch-author-photos-btn'), document.getElementById('refetch-author-photos-btn')];
        buttons.forEach(b => { if (b) b.disabled = true; });
        try {
          const result = await apiPost(`/authors/photos/prefetch${refresh ? '?refresh=true' : ''}`, {});
          toast(`Fetching metadata for ${result.total} authors in the background — it'll appear as it downloads.`, 'success');
        } catch (prefetchError) {
          toast(prefetchError.message || 'Failed to start photo download', 'error');
        } finally {
          buttons.forEach(b => { if (b) b.disabled = false; });
        }
      };
      document.getElementById('prefetch-author-photos-btn')?.addEventListener('click', () => prefetchPhotos(false));
      document.getElementById('refetch-author-photos-btn')?.addEventListener('click', () => {
        showConfirmModal({
          title: 'Re-fetch all author photos',
          message: 'This clears all cached author photos and re-fetches every author from Open Library. Useful if photos are missing. Continue?',
          confirmText: 'Re-fetch all',
          onConfirm: () => prefetchPhotos(true),
        });
      });

      // Link Ironshelf Cloud account to this local user
      document.getElementById('link-cloud-btn')?.addEventListener('click', () => {
        const { close } = showModal({
          title: 'Link Ironshelf Cloud Account',
          description: 'Sign in with your Ironshelf Cloud account. It will become a sign-in for this server, mapped to your current user.',
          content: `
            <form id="link-cloud-form" novalidate>
              <div class="form-group">
                <label class="form-label" for="link-cloud-email">Cloud Email or Username</label>
                <input type="text" class="form-input" id="link-cloud-email" required autocomplete="username" autofocus>
              </div>
              <div class="form-group">
                <label class="form-label" for="link-cloud-password">Cloud Password</label>
                <input type="password" class="form-input" id="link-cloud-password" required autocomplete="current-password">
              </div>
              <div id="link-cloud-error" class="form-error hidden" role="alert"></div>
              <div class="modal-actions">
                <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
                <button type="submit" class="btn btn-primary" id="link-cloud-submit">${icon('globe', 16)} Link Account</button>
              </div>
            </form>
          `,
        });
        const form = document.getElementById('link-cloud-form');
        form.querySelector('[data-action="cancel"]').addEventListener('click', close);
        form.addEventListener('submit', async (submitEvent) => {
          submitEvent.preventDefault();
          const errorEl = document.getElementById('link-cloud-error');
          const submitBtn = document.getElementById('link-cloud-submit');
          errorEl.classList.add('hidden');
          submitBtn.disabled = true;
          try {
            // 1. Authenticate with cloud.
            const authResponse = await fetch(`${CLOUD_API}/auth/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email_or_username: document.getElementById('link-cloud-email').value,
                password: document.getElementById('link-cloud-password').value,
              }),
            });
            const authData = await authResponse.json().catch(() => ({}));
            if (!authResponse.ok || !authData.data?.token) {
              throw new Error(authData.error || 'Cloud sign-in failed');
            }
            const cloudJwt = authData.data.token;

            // 2. This server must be claimed (need its cloud server_id).
            const claimStatus = await apiGet('/auth/claim-status').catch(() => null);
            const serverId = claimStatus?.server_id;
            if (!claimStatus?.is_claimed || !serverId) {
              throw new Error('Claim this server to Ironshelf Cloud first (Settings → Ironshelf Cloud).');
            }

            // 3. Get a server-scoped access token (signed with the claim token).
            const tokenResponse = await fetch(`${CLOUD_API}/servers/${serverId}/token`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${cloudJwt}` },
            });
            const tokenData = await tokenResponse.json().catch(() => ({}));
            if (!tokenResponse.ok || !tokenData.data?.server_access_token) {
              throw new Error(tokenData.error || 'Could not get a server access token (is your cloud account linked to this server?)');
            }

            // 4. Link on this server.
            const linkResult = await apiPost('/auth/link-cloud', { cloud_token: tokenData.data.server_access_token });
            close();
            toast(`Linked cloud account "${linkResult.cloud_username || ''}" to your user`, 'success');
            if (currentUser) currentUser.cloud_linked = true;
            renderSettings(parseRoute(getHashPath()).params.id);
          } catch (linkError) {
            errorEl.textContent = linkError.message || 'Failed to link cloud account';
            errorEl.classList.remove('hidden');
            submitBtn.disabled = false;
          }
        });
      });

      // Unlink cloud account
      document.getElementById('unlink-cloud-btn')?.addEventListener('click', () => {
        showConfirmModal({
          title: 'Unlink Cloud Account',
          message: 'Signing in with your cloud account will no longer log into this user.',
          confirmText: 'Unlink',
          onConfirm: async () => {
            try {
              await apiPost('/auth/unlink-cloud', {});
              if (currentUser) currentUser.cloud_linked = false;
              toast('Cloud account unlinked', 'success');
              renderSettings(parseRoute(getHashPath()).params.id);
            } catch (unlinkError) {
              toast(unlinkError.message || 'Failed to unlink', 'error');
            }
          },
        });
      });

      // Calibre write-back settings
      const calibreWbMode = document.getElementById('calibre-wb-mode');
      if (calibreWbMode) {
        const calibredbFields = document.getElementById('calibre-wb-calibredb-fields');
        const csFields = document.getElementById('calibre-wb-cs-fields');
        calibreWbMode.addEventListener('change', () => {
          calibredbFields?.classList.toggle('hidden', calibreWbMode.value !== 'calibredb');
          csFields?.classList.toggle('hidden', calibreWbMode.value !== 'content_server');
        });
        document.getElementById('calibre-wb-save')?.addEventListener('click', async () => {
          const saveBtn = document.getElementById('calibre-wb-save');
          saveBtn.disabled = true;
          const payload = {
            calibre_writeback_mode: calibreWbMode.value,
            calibredb_path: document.getElementById('calibre-wb-path')?.value || '',
            calibre_cs_url: document.getElementById('calibre-wb-url')?.value || '',
            calibre_cs_library_id: document.getElementById('calibre-wb-library')?.value || '',
            calibre_cs_username: document.getElementById('calibre-wb-username')?.value || '',
          };
          const newPassword = document.getElementById('calibre-wb-password')?.value;
          if (newPassword) payload.calibre_cs_password = newPassword;
          try {
            cachedServerSettings = await apiPut('/server/settings', payload);
            toast('Calibre write-back settings saved', 'success');
          } catch (saveError) {
            toast(saveError.message || 'Failed to save settings', 'error');
          } finally {
            saveBtn.disabled = false;
          }
        });
      }

      // Bind events
      document.getElementById('create-api-key-btn')?.addEventListener('click', () => {
        const { close } = showModal({
          title: 'Create API Key',
          description: 'Give this key a name so you can identify it later.',
          content: `
            <form id="create-key-form" novalidate>
              <div class="form-group">
                <label class="form-label" for="key-label">Label</label>
                <input type="text" class="form-input" id="key-label" name="label" required placeholder="e.g., Flutter app, Tablet" autofocus>
              </div>
              <div class="modal-actions">
                <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
                <button type="submit" class="btn btn-primary">Create</button>
              </div>
            </form>
          `,
        });

        const form = document.getElementById('create-key-form');
        form.querySelector('[data-action="cancel"]').addEventListener('click', close);

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const label = document.getElementById('key-label').value.trim();
          if (!label) return;

          try {
            const result = await apiPost('/auth/api-keys', { label });
            close();

            const createdKeyOrigin = window.location.origin;
            showModal({
              title: 'API Key Created',
              description: 'Copy this key now. It will not be shown again.',
              content: `
                <div class="api-key-display" id="new-key-value">${escapeHtml(result.key)}</div>
                <button class="btn btn-secondary" id="copy-key-btn">${icon('copy', 16)} Copy to Clipboard</button>

                <details class="key-usage-guide">
                  <summary>${icon('info', 14)} How to use this key</summary>
                  <div class="key-usage-guide-content">
                    <div class="key-usage-item">
                      <h4>cURL</h4>
                      <code class="key-usage-code">curl -H "Authorization: Bearer ${escapeHtml(result.key)}" ${createdKeyOrigin}/api/v1/libraries</code>
                    </div>
                    <div class="key-usage-item">
                      <h4>OPDS Reader</h4>
                      <p>Use as Bearer token in your reader app's authentication settings.</p>
                    </div>
                    <div class="key-usage-item">
                      <h4>Kobo Sync</h4>
                      <code class="key-usage-code">${createdKeyOrigin}/kobo/${escapeHtml(result.key)}/v1/initialization</code>
                    </div>
                    <div class="key-usage-item">
                      <h4>WebDAV (KOReader)</h4>
                      <code class="key-usage-code">${createdKeyOrigin}/webdav/${escapeHtml(result.key)}/</code>
                    </div>
                  </div>
                </details>
              `,
              actions: '<button class="btn btn-primary" data-action="done">Done</button>',
            });

            const modal = document.querySelector('.modal-overlay:last-child');
            modal.querySelector('[data-action="done"]')?.addEventListener('click', () => {
              modal.remove();
              renderSettings(parseRoute(getHashPath()).params.id);
            });
            modal.querySelector('#copy-key-btn')?.addEventListener('click', () => {
              navigator.clipboard.writeText(result.key).then(() => {
                toast('Key copied to clipboard', 'success');
              }).catch(() => {
                toast('Failed to copy — select and copy manually', 'warning');
              });
            });
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      });

      document.querySelectorAll('.delete-key-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const keyId = btn.dataset.keyId;
          showConfirmModal({
            title: 'Delete API Key',
            message: 'Any applications using this key will lose access immediately.',
            confirmText: 'Delete Key',
            onConfirm: async () => {
              try {
                await apiDelete(`/auth/api-keys/${keyId}`);
                toast('API key deleted', 'success');
                renderSettings(parseRoute(getHashPath()).params.id);
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          });
        });
      });

      // Export data
      document.getElementById('export-data-btn')?.addEventListener('click', async () => {
        try {
          const exportToken = HOSTED ? localStorage.getItem('ironshelf_server_token') : null;
          const response = await fetch(`${API}/export/all`, {
            credentials: 'same-origin',
            headers: exportToken ? { 'Authorization': `Bearer ${exportToken}` } : {},
          });
          if (!response.ok) throw new Error(`Export failed (${response.status})`);
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `ironshelf-export-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(url);
          toast('Export downloaded', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      });

      // Import data
      document.getElementById('import-data-input')?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
          const text = await file.text();
          const importData = JSON.parse(text);
          const result = await apiPost('/import', importData);
          toast(result?.message || 'Data imported successfully', 'success');
          renderSettings(parseRoute(getHashPath()).params.id);
        } catch (err) {
          toast(err.message || 'Import failed — check file format', 'error');
        }
        e.target.value = '';
      });

      // Notification preference toggles
      document.querySelectorAll('[data-notif-type]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
          const prefs = getNotificationPreferences();
          prefs[checkbox.dataset.notifType] = checkbox.checked;
          setNotificationPreferences(prefs);
        });
      });

      // Bind reader preferences
      bindReaderPreferences();

      // Clear all notifications
      document.getElementById('clear-all-notifications-btn')?.addEventListener('click', () => {
        showConfirmModal({
          title: 'Clear All Notifications',
          message: 'This will permanently delete all your notifications. This action cannot be undone.',
          confirmText: 'Clear All',
          onConfirm: async () => {
            try {
              // Mark all read first, then we rely on the panel showing empty
              await apiPost('/notifications/read-all', {});
              notificationUnreadCount = 0;
              updateNotificationBadge();
              toast('All notifications cleared', 'success');
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        });
      });

      // Server update check (owner only)
      bindServerUpdateEvents();

      // Remote access (owner only)
      if (currentUser?.is_owner) {
        loadRemoteAccessCard();
      }

      // Cloud settings (owner only)
      if (currentUser?.is_owner) {
        loadCloudSettingsCard();
      }

      // Background tasks monitor (owner only) — poll while Settings is open.
      if (currentUser?.is_owner) {
        loadBackgroundTasks();
        if (backgroundTasksPollInterval) clearInterval(backgroundTasksPollInterval);
        backgroundTasksPollInterval = setInterval(loadBackgroundTasks, 3000);
      }

      // Device integration copy buttons
      document.querySelectorAll('.copy-device-url').forEach(btn => {
        btn.addEventListener('click', () => {
          const targetElement = document.getElementById(btn.dataset.copyTarget);
          if (!targetElement) return;
          navigator.clipboard.writeText(targetElement.textContent.trim()).then(() => {
            toast('URL copied to clipboard', 'success');
          }).catch(() => {
            toast('Failed to copy — select and copy manually', 'warning');
          });
        });
      });

      // Change password form
      document.getElementById('change-password-form')?.addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const passwordError = document.getElementById('password-error');
        passwordError.classList.add('hidden');

        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;

        if (newPassword.length < 8) {
          passwordError.textContent = 'New password must be at least 8 characters.';
          passwordError.classList.remove('hidden');
          return;
        }

        if (newPassword !== confirmPassword) {
          passwordError.textContent = 'New passwords do not match.';
          passwordError.classList.remove('hidden');
          return;
        }

        try {
          await apiPut('/auth/password', { current_password: currentPassword, new_password: newPassword });
          toast('Password updated successfully', 'success');
          document.getElementById('change-password-form').reset();
        } catch (passwordChangeError) {
          passwordError.textContent = passwordChangeError.message || 'Failed to change password.';
          passwordError.classList.remove('hidden');
        }
      });

      // Login providers (owner only)
      if (currentUser?.is_owner) {
        setupAuthProvidersSection();
      }

      // Invite management (owner only)
      if (currentUser?.is_owner) {
        loadInvitesList();
        document.getElementById('create-invite-btn')?.addEventListener('click', async () => {
          try {
            const inviteResult = await apiPost('/users/invite', {});
            const inviteCode = inviteResult?.code || inviteResult?.invite_code || '';
            showModal({
              title: 'Invite Created',
              description: 'Share this code with someone to let them create an account.',
              content: `
                <div class="api-key-display" id="invite-code-value">${escapeHtml(inviteCode)}</div>
                <button class="btn btn-secondary" id="copy-invite-btn">${icon('copy', 16)} Copy to Clipboard</button>
              `,
              actions: '<button class="btn btn-primary" data-action="done">Done</button>',
            });
            const inviteModal = document.querySelector('.modal-overlay:last-child');
            inviteModal.querySelector('[data-action="done"]')?.addEventListener('click', () => {
              inviteModal.remove();
              loadInvitesList();
            });
            inviteModal.querySelector('#copy-invite-btn')?.addEventListener('click', () => {
              navigator.clipboard.writeText(inviteCode).then(() => {
                toast('Invite code copied', 'success');
              }).catch(() => {
                toast('Failed to copy — select and copy manually', 'warning');
              });
            });
          } catch (inviteError) {
            toast(inviteError.message, 'error');
          }
        });
      }
    } catch (err) {
      renderShell(renderError('Failed to load settings', err.message, () => renderSettings()), 'settings');
    }
  }

  // ---- Login Providers (SSO) ----

  const SSO_PRESETS = {
    google: { id: 'google', name: 'Google', kind: 'oidc' },
    github: { id: 'github', name: 'GitHub', kind: 'oauth2' },
  };

  function ssoApplyPresetUi() {
    const preset = document.getElementById('sso-preset')?.value;
    if (!preset) return;
    const idInput = document.getElementById('sso-id');
    const nameInput = document.getElementById('sso-name');
    const kindGroup = document.getElementById('sso-kind-group');
    const customFields = document.getElementById('sso-custom-fields');
    if (preset === 'custom') {
      idInput.readOnly = false;
      kindGroup.style.display = '';
      customFields.style.display = '';
    } else {
      const presetConfig = SSO_PRESETS[preset];
      idInput.value = presetConfig.id;
      idInput.readOnly = true;
      if (!nameInput.value) nameInput.value = presetConfig.name;
      document.getElementById('sso-kind').value = presetConfig.kind;
      kindGroup.style.display = 'none';
      customFields.style.display = 'none';
    }
  }

  function ssoResetForm() {
    document.getElementById('sso-form-title').textContent = 'Add provider';
    document.getElementById('sso-preset').value = 'google';
    ['sso-id', 'sso-name', 'sso-client-id', 'sso-client-secret', 'sso-issuer',
     'sso-authorize', 'sso-token', 'sso-userinfo', 'sso-scopes'].forEach(fieldId => {
      const field = document.getElementById(fieldId);
      if (field) field.value = '';
    });
    document.getElementById('sso-id').readOnly = false;
    document.getElementById('sso-enabled').checked = true;
    document.getElementById('sso-auto-register').checked = true;
    document.getElementById('sso-reset-btn').style.display = 'none';
    ssoApplyPresetUi();
  }

  function ssoFillForm(provider) {
    document.getElementById('sso-form-title').textContent = `Edit "${provider.display_name}"`;
    const isPreset = provider.id === 'google' || provider.id === 'github';
    document.getElementById('sso-preset').value = isPreset ? provider.id : 'custom';
    ssoApplyPresetUi();
    document.getElementById('sso-id').value = provider.id;
    document.getElementById('sso-id').readOnly = true; // id is the key
    document.getElementById('sso-name').value = provider.display_name;
    document.getElementById('sso-kind').value = provider.kind;
    document.getElementById('sso-client-id').value = provider.client_id || '';
    document.getElementById('sso-client-secret').value = '';
    document.getElementById('sso-issuer').value = provider.issuer_url || '';
    document.getElementById('sso-authorize').value = provider.authorize_url || '';
    document.getElementById('sso-token').value = provider.token_url || '';
    document.getElementById('sso-userinfo').value = provider.userinfo_url || '';
    document.getElementById('sso-scopes').value = provider.scopes || '';
    document.getElementById('sso-enabled').checked = !!provider.enabled;
    document.getElementById('sso-auto-register').checked = !!provider.auto_register;
    document.getElementById('sso-reset-btn').style.display = '';
    document.getElementById('auth-providers-section')?.scrollIntoView({ behavior: 'smooth' });
  }

  async function loadAuthProvidersList() {
    const listElement = document.getElementById('auth-providers-list');
    if (!listElement) return;
    try {
      const providers = (await apiGet('/admin/auth-providers')) || [];
      if (!providers.length) {
        listElement.innerHTML = `<div style="padding:var(--space-4);color:var(--color-muted);font-size:var(--text-sm)">No providers configured yet.</div>`;
        return;
      }
      listElement.innerHTML = providers.map(provider => `
        <div class="list-group-item" style="display:flex;align-items:center;gap:var(--space-3)">
          <div style="flex:1">
            <strong>${escapeHtml(provider.display_name)}</strong>
            <span class="badge ${provider.enabled ? 'badge-teal' : 'badge-muted'}">${provider.enabled ? 'enabled' : 'disabled'}</span>
            <div class="text-caption">${escapeHtml(provider.id)} · ${escapeHtml(provider.kind)}${provider.has_client_secret ? ' · secret set' : ' · no secret'}</div>
          </div>
          <button class="btn btn-secondary" data-edit="${escapeHtml(provider.id)}">${icon('settings', 14)} Edit</button>
          <button class="btn btn-secondary" data-delete="${escapeHtml(provider.id)}">${icon('trash', 14)} Delete</button>
        </div>
      `).join('');
      listElement.querySelectorAll('[data-edit]').forEach(button => {
        button.addEventListener('click', () => {
          const provider = providers.find(candidate => candidate.id === button.dataset.edit);
          if (provider) ssoFillForm(provider);
        });
      });
      listElement.querySelectorAll('[data-delete]').forEach(button => {
        button.addEventListener('click', async () => {
          if (!confirm(`Delete login provider "${button.dataset.delete}"?`)) return;
          try {
            await apiDelete(`/admin/auth-providers/${encodeURIComponent(button.dataset.delete)}`);
            toast('Provider deleted', 'success');
            loadAuthProvidersList();
          } catch (deleteError) {
            toast(deleteError.message, 'error');
          }
        });
      });
    } catch (loadError) {
      listElement.innerHTML = `<div style="padding:var(--space-4);color:var(--color-danger);font-size:var(--text-sm)">${escapeHtml(loadError.message)}</div>`;
    }
  }

  function setupAuthProvidersSection() {
    if (!document.getElementById('auth-providers-section')) return;
    document.getElementById('sso-preset').addEventListener('change', ssoApplyPresetUi);
    document.getElementById('sso-reset-btn').addEventListener('click', ssoResetForm);
    document.getElementById('sso-save-btn').addEventListener('click', async () => {
      const providerId = document.getElementById('sso-id').value.trim();
      if (!providerId) {
        toast('Provider ID is required', 'error');
        return;
      }
      const body = {
        kind: document.getElementById('sso-kind').value,
        display_name: document.getElementById('sso-name').value.trim() || providerId,
        client_id: document.getElementById('sso-client-id').value.trim(),
        client_secret: document.getElementById('sso-client-secret').value || undefined,
        issuer_url: document.getElementById('sso-issuer').value.trim() || undefined,
        authorize_url: document.getElementById('sso-authorize').value.trim() || undefined,
        token_url: document.getElementById('sso-token').value.trim() || undefined,
        userinfo_url: document.getElementById('sso-userinfo').value.trim() || undefined,
        scopes: document.getElementById('sso-scopes').value.trim() || undefined,
        enabled: document.getElementById('sso-enabled').checked,
        auto_register: document.getElementById('sso-auto-register').checked,
      };
      try {
        await apiPut(`/admin/auth-providers/${encodeURIComponent(providerId)}`, body);
        toast('Provider saved', 'success');
        ssoResetForm();
        loadAuthProvidersList();
      } catch (saveError) {
        toast(saveError.message, 'error');
      }
    });
    ssoApplyPresetUi();
    loadAuthProvidersList();
  }

  // ---- Remote Access Card ----

  let remoteAccessPollingInterval = null;

  async function loadRemoteAccessCard(methodOverride = null) {
    const cardContainer = document.getElementById('remote-access-card');
    if (!cardContainer) return;

    // Stop any previous polling interval.
    if (remoteAccessPollingInterval) {
      clearInterval(remoteAccessPollingInterval);
      remoteAccessPollingInterval = null;
    }

    try {
      const status = await apiGet('/server/remote-access');

      // Method selector (always shown at top). An explicit override (from the
      // dropdown) wins so selecting a method shows its panel even before it is
      // started — the server only reports a non-none method once one is active.
      const currentMethod = methodOverride || status.method || 'none';
      const methodSelectorHtml = `
        <div class="remote-access-method-selector" style="margin-bottom:var(--space-4)">
          <label class="form-label" for="remote-access-method-select">Method</label>
          <select class="form-input" id="remote-access-method-select" style="width:auto;min-width:280px">
            <option value="none" ${currentMethod === 'none' ? 'selected' : ''}>None (local network only)</option>
            <option value="upnp" ${currentMethod === 'upnp' ? 'selected' : ''}>UPnP (auto port forward)</option>
            <option value="tunnel" ${currentMethod === 'tunnel' ? 'selected' : ''}>Cloudflare Tunnel (recommended)</option>
            <option value="manual" ${currentMethod === 'manual' ? 'selected' : ''}>Manual (you handle forwarding)</option>
          </select>
        </div>
      `;

      // Build method-specific panel.
      let methodPanelHtml = '';

      if (currentMethod === 'tunnel' || status.tunnel?.active) {
        methodPanelHtml = buildTunnelPanel(status);
      } else if (currentMethod === 'upnp' || (status.upnp?.enabled)) {
        methodPanelHtml = buildUpnpPanel(status);
      } else if (currentMethod === 'manual') {
        methodPanelHtml = `
          <div class="remote-access-status">
            <div class="remote-access-status-header">
              <span class="remote-access-indicator ${status.public_url ? 'remote-access-connected' : 'remote-access-connecting'}"></span>
              <strong>Manual / own tunnel</strong>
            </div>
            <p class="form-hint" style="margin-top:var(--space-2)">
              Use this if you run your own Cloudflare named tunnel, reverse proxy, or port-forwarding. Enter the public URL this server is reachable at — Ironshelf reports it to the cloud (and keeps it fresh) but doesn't launch anything.
            </p>
            <label class="form-label" for="manual-url-input" style="margin-top:var(--space-3)">Public URL</label>
            <input type="text" class="form-input" id="manual-url-input" placeholder="https://ironshelf.example.com" value="${escapeHtml(status.public_url || '')}">
            <button class="btn btn-primary btn-sm" id="manual-url-save-btn" style="margin-top:var(--space-3)">${icon('check', 14)} Save URL</button>
          </div>
        `;
      } else {
        methodPanelHtml = `
          <div class="remote-access-status">
            <div class="remote-access-status-header">
              <span class="remote-access-indicator remote-access-disconnected"></span>
              <strong>Disabled</strong>
            </div>
            <p class="form-hint" style="margin-top:var(--space-2)">Select a method above to enable remote access.</p>
          </div>
        `;
      }

      // Local-network auth bypass — only offered when fully local.
      let localBypassHtml = '';
      if (status.local_bypass_allowed || status.local_bypass) {
        localBypassHtml = `
          <div class="card" style="margin-top:var(--space-5);padding:var(--space-4)">
            <label style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer">
              <input type="checkbox" id="local-bypass-toggle" ${status.local_bypass ? 'checked' : ''}>
              <strong>Skip login on the local network</strong>
            </label>
            <p class="form-hint" style="margin-top:var(--space-2)">
              Anyone on your local network can open this server <em>without signing in</em>. Use only on a trusted home network. Automatically disabled if you connect to cloud or enable remote access.
            </p>
          </div>`;
      } else {
        localBypassHtml = `
          <p class="form-hint" style="margin-top:var(--space-5)">
            ${status.cloud_connected
              ? 'Local-network login bypass is unavailable while connected to a cloud account.'
              : 'Local-network login bypass is unavailable while remote access is enabled.'}
          </p>`;
      }

      cardContainer.innerHTML = methodSelectorHtml + methodPanelHtml + localBypassHtml;

      // Bind event handlers.
      bindRemoteAccessEvents(status);

      // Start polling every 10 seconds while the card is visible.
      remoteAccessPollingInterval = setInterval(async () => {
        if (!document.getElementById('remote-access-card')) {
          clearInterval(remoteAccessPollingInterval);
          remoteAccessPollingInterval = null;
          return;
        }
        try {
          const refreshedStatus = await apiGet('/server/remote-access');
          const currentIndicator = document.querySelector('.remote-access-indicator');
          const wasActive = currentIndicator?.classList.contains('remote-access-connected');
          const wasConnecting = currentIndicator?.classList.contains('remote-access-connecting');
          const isNowActive = refreshedStatus.active;
          const isNowConnecting = refreshedStatus.enabled && !refreshedStatus.active;
          if ((isNowActive && !wasActive) || (isNowConnecting && !wasConnecting) || (!refreshedStatus.enabled && (wasActive || wasConnecting))) {
            loadRemoteAccessCard();
          }
        } catch (_) {
          // Silently ignore polling errors.
        }
      }, 10000);

    } catch (loadError) {
      cardContainer.innerHTML = `
        <div class="remote-access-status">
          <p class="remote-access-error">Failed to load remote access status: ${escapeHtml(loadError.message)}</p>
          <button class="btn btn-secondary btn-sm" style="margin-top:var(--space-3)" onclick="loadRemoteAccessCard()">Retry</button>
        </div>
      `;
    }
  }

  function buildTunnelPanel(status) {
    const tunnel = status.tunnel || {};

    if (tunnel.active && tunnel.public_url) {
      return `
        <div class="remote-access-status">
          <div class="remote-access-status-header">
            <span class="remote-access-indicator remote-access-connected"></span>
            <strong>Connected via Cloudflare Tunnel</strong>
          </div>
          <dl class="remote-access-details">
            <dt>Public URL</dt>
            <dd>
              <div class="device-url-row" style="margin:0">
                <code class="device-url" id="remote-access-public-url">${escapeHtml(tunnel.public_url)}</code>
                <button class="btn btn-ghost btn-sm copy-remote-url" aria-label="Copy public URL">${icon('copy', 14)}</button>
              </div>
            </dd>
          </dl>
          <div class="remote-access-actions" style="margin-top:var(--space-4);display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center">
            <button class="btn btn-danger btn-sm" id="tunnel-stop-btn">${icon('x', 14)} Stop Tunnel</button>
          </div>
        </div>
      `;
    }

    if (!tunnel.available) {
      return `
        <div class="remote-access-status">
          <div class="remote-access-status-header">
            <span class="remote-access-indicator remote-access-disconnected"></span>
            <strong>cloudflared not installed</strong>
          </div>
          <p class="form-hint" style="margin-top:var(--space-2)">
            Cloudflare Tunnel requires <code>cloudflared</code>. Click Start Tunnel below — it will be installed automatically.
          </p>
          <button class="btn btn-primary mt-4" id="tunnel-start-btn">${icon('download', 16)} Install &amp; Start Tunnel</button>
          ${tunnel.error ? `<p class="remote-access-error" style="margin-top:var(--space-2)">${escapeHtml(tunnel.error)}</p>` : ''}
        </div>
      `;
    }

    // Available but not active.
    return `
      <div class="remote-access-status">
        <div class="remote-access-status-header">
          <span class="remote-access-indicator remote-access-disconnected"></span>
          <strong>Tunnel not running</strong>
        </div>
        ${tunnel.error ? `<p class="remote-access-error" style="margin-top:var(--space-2)">${escapeHtml(tunnel.error)}</p>` : ''}
        <p class="form-hint" style="margin-top:var(--space-2)">
          Start a Cloudflare Quick Tunnel to get a public URL instantly. No account or configuration required. The URL changes each restart.
        </p>
        <div class="remote-access-actions" style="margin-top:var(--space-4)">
          <button class="btn btn-primary btn-sm" id="tunnel-start-btn">${icon('globe', 14)} Start Quick Tunnel</button>
        </div>
        <details class="remote-access-named" style="margin-top:var(--space-4)">
          <summary style="cursor:pointer">Use a named tunnel (stable URL)</summary>
          <p class="form-hint" style="margin-top:var(--space-3)">
            Create a Tunnel in the <strong>Cloudflare Zero Trust dashboard</strong>, route a hostname to <code>http://localhost:${escapeHtml(String(status.internal_port || 10810))}</code>, then paste the tunnel token and that hostname here. The URL never changes across restarts.
          </p>
          <label class="form-label" for="tunnel-named-hostname" style="margin-top:var(--space-3)">Public hostname</label>
          <input type="text" class="form-input" id="tunnel-named-hostname" placeholder="ironshelf.example.com">
          <label class="form-label" for="tunnel-named-token" style="margin-top:var(--space-3)">Tunnel token</label>
          <input type="password" class="form-input" id="tunnel-named-token" placeholder="eyJ...">
          <button class="btn btn-secondary btn-sm" id="tunnel-start-named-btn" style="margin-top:var(--space-3)">${icon('globe', 14)} Start Named Tunnel</button>
        </details>
      </div>
    `;
  }

  function buildUpnpPanel(status) {
    const upnp = status.upnp || {};

    if (upnp.enabled && upnp.active) {
      return `
        <div class="remote-access-status">
          <div class="remote-access-status-header">
            <span class="remote-access-indicator remote-access-connected"></span>
            <strong>Connected via UPnP</strong>
          </div>
          <dl class="remote-access-details">
            <dt>Public URL</dt>
            <dd>
              <div class="device-url-row" style="margin:0">
                <code class="device-url" id="remote-access-public-url">${escapeHtml(upnp.public_url)}</code>
                <button class="btn btn-ghost btn-sm copy-remote-url" aria-label="Copy public URL">${icon('copy', 14)}</button>
              </div>
            </dd>
            <dt>Public IP</dt>
            <dd><code>${escapeHtml(upnp.public_ip || 'unknown')}</code></dd>
            <dt>External Port</dt>
            <dd>${upnp.external_port}</dd>
            <dt>Internal Port</dt>
            <dd>${upnp.internal_port}</dd>
          </dl>
          <div class="remote-access-actions" style="margin-top:var(--space-4);display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center">
            <button class="btn btn-secondary btn-sm" id="remote-access-test-btn">${icon('check', 14)} Test Reachability</button>
            <button class="btn btn-danger btn-sm" id="remote-access-disable-btn">${icon('x', 14)} Disable</button>
          </div>
          <div class="remote-access-port-change" style="margin-top:var(--space-4)">
            <label class="form-label" for="remote-access-port-input">External Port</label>
            <div style="display:flex;gap:var(--space-2);align-items:center">
              <input type="number" class="form-input" id="remote-access-port-input" value="${upnp.external_port}" min="1" max="65535" style="width:120px">
              <button class="btn btn-secondary btn-sm" id="remote-access-apply-port-btn">Apply</button>
            </div>
          </div>
        </div>
      `;
    }

    if (upnp.enabled && !upnp.active) {
      return `
        <div class="remote-access-status">
          <div class="remote-access-status-header">
            <span class="remote-access-indicator remote-access-connecting"></span>
            <strong>UPnP not reachable</strong>
          </div>
          ${upnp.error ? `<p class="remote-access-error">${escapeHtml(upnp.error)}</p>` : ''}
          <p class="form-hint" style="margin-top:var(--space-2)">You can manually forward port ${upnp.external_port} on your router if UPnP is not supported, or try Cloudflare Tunnel instead.</p>
          <div class="remote-access-actions" style="margin-top:var(--space-4);display:flex;flex-wrap:wrap;gap:var(--space-3)">
            <button class="btn btn-primary btn-sm" id="remote-access-retry-btn">${icon('refresh', 14)} Retry</button>
            <button class="btn btn-danger btn-sm" id="remote-access-disable-btn">${icon('x', 14)} Disable</button>
          </div>
        </div>
      `;
    }

    // UPnP not enabled yet.
    return `
      <div class="remote-access-status">
        <div class="remote-access-status-header">
          <span class="remote-access-indicator remote-access-disconnected"></span>
          <strong>UPnP disabled</strong>
        </div>
        <p class="form-hint" style="margin-top:var(--space-2)">Enable UPnP port forwarding to make this server reachable from outside your local network.</p>
        <div class="remote-access-actions" style="margin-top:var(--space-4);display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center">
          <button class="btn btn-primary btn-sm" id="remote-access-enable-btn">${icon('globe', 14)} Enable UPnP</button>
          <div style="display:flex;gap:var(--space-2);align-items:center">
            <label class="form-label" for="remote-access-port-input-disabled" style="margin:0;white-space:nowrap">External Port:</label>
            <input type="number" class="form-input" id="remote-access-port-input-disabled" value="${upnp.external_port}" min="1" max="65535" style="width:120px">
          </div>
        </div>
      </div>
    `;
  }

  function bindRemoteAccessEvents(status) {
    const upnp = status.upnp || {};

    // Method selector change.
    document.getElementById('remote-access-method-select')?.addEventListener('change', async (changeEvent) => {
      const selectedMethod = changeEvent.target.value;

      // If switching away from an active method, stop the current one first.
      if (status.tunnel?.active && selectedMethod !== 'tunnel') {
        try { await apiPost('/server/remote-access/tunnel/stop', {}); } catch (_) {}
      }
      if (upnp.enabled && selectedMethod !== 'upnp') {
        try { await apiPost('/server/remote-access/disable', {}); } catch (_) {}
      }

      // Show the selected method's panel (with its Start/enable controls).
      loadRemoteAccessCard(selectedMethod);
    });

    // --- Tunnel events ---
    document.getElementById('tunnel-start-btn')?.addEventListener('click', async () => {
      const startButton = document.getElementById('tunnel-start-btn');
      startButton.disabled = true;
      startButton.textContent = 'Starting tunnel...';
      try {
        const tunnelResult = await apiPost('/server/remote-access/tunnel/start', {});
        if (tunnelResult.active) {
          toast('Cloudflare tunnel started', 'success');
        } else {
          toast(tunnelResult.error || 'Failed to start tunnel', 'error');
        }
        loadRemoteAccessCard();
      } catch (startError) {
        toast(startError.message || 'Failed to start tunnel', 'error');
        loadRemoteAccessCard();
      }
    });

    document.getElementById('local-bypass-toggle')?.addEventListener('change', async (event) => {
      const toggle = event.target;
      const wantEnabled = toggle.checked;

      const apply = async (enabled) => {
        try {
          const result = await apiPost('/server/remote-access/local-bypass', { enabled });
          if (result.error) {
            toast(result.error, 'error');
          } else {
            toast(enabled ? 'Local login bypass enabled' : 'Local login bypass disabled',
              enabled ? 'warning' : 'success');
          }
        } catch (bypassError) {
          toast(bypassError.message || 'Failed to update', 'error');
        }
        loadRemoteAccessCard();
      };

      if (wantEnabled) {
        // Revert the optimistic check until confirmed.
        toggle.checked = false;
        showConfirmModal({
          title: 'Disable login for your local network?',
          message: 'Anyone who can reach this server on your local network will be able to read your whole library and change settings WITHOUT a password. Only do this on a trusted private network. Are you sure?',
          confirmText: 'Yes, skip local login',
          confirmClass: 'btn-danger',
          onConfirm: () => apply(true),
        });
      } else {
        apply(false);
      }
    });

    document.getElementById('manual-url-save-btn')?.addEventListener('click', async () => {
      const url = document.getElementById('manual-url-input')?.value.trim();
      if (!url) {
        toast('Enter a public URL', 'error');
        return;
      }
      const saveButton = document.getElementById('manual-url-save-btn');
      saveButton.disabled = true;
      try {
        const result = await apiPost('/server/remote-access/manual-url', { url });
        if (result.ok) {
          toast('Public URL saved and reported to cloud', 'success');
        } else {
          toast(result.error || 'Failed to save URL', 'error');
        }
        loadRemoteAccessCard();
      } catch (saveError) {
        toast(saveError.message || 'Failed to save URL', 'error');
        if (saveButton) saveButton.disabled = false;
      }
    });

    document.getElementById('tunnel-start-named-btn')?.addEventListener('click', async () => {
      const hostname = document.getElementById('tunnel-named-hostname')?.value.trim();
      const token = document.getElementById('tunnel-named-token')?.value.trim();
      if (!hostname || !token) {
        toast('Enter both a hostname and a tunnel token', 'error');
        return;
      }
      const namedButton = document.getElementById('tunnel-start-named-btn');
      namedButton.disabled = true;
      namedButton.textContent = 'Starting named tunnel...';
      try {
        const tunnelResult = await apiPost('/server/remote-access/tunnel/start', { hostname, token });
        if (tunnelResult.active) {
          toast('Named tunnel started', 'success');
        } else {
          toast(tunnelResult.error || 'Failed to start named tunnel', 'error');
        }
        loadRemoteAccessCard();
      } catch (startError) {
        toast(startError.message || 'Failed to start named tunnel', 'error');
        loadRemoteAccessCard();
      }
    });

    document.getElementById('tunnel-stop-btn')?.addEventListener('click', async () => {
      try {
        await apiPost('/server/remote-access/tunnel/stop', {});
        toast('Cloudflare tunnel stopped', 'success');
        loadRemoteAccessCard();
      } catch (stopError) {
        toast(stopError.message || 'Failed to stop tunnel', 'error');
      }
    });

    // --- UPnP events ---
    document.getElementById('remote-access-enable-btn')?.addEventListener('click', async () => {
      const portInput = document.getElementById('remote-access-port-input-disabled');
      const externalPort = portInput ? parseInt(portInput.value, 10) : upnp.external_port;
      const enableButton = document.getElementById('remote-access-enable-btn');
      enableButton.disabled = true;
      enableButton.textContent = 'Enabling...';
      try {
        await apiPost('/server/remote-access/enable', { external_port: externalPort });
        toast('UPnP remote access enabled', 'success');
        loadRemoteAccessCard();
      } catch (enableError) {
        toast(enableError.message || 'Failed to enable UPnP', 'error');
        loadRemoteAccessCard();
      }
    });

    document.getElementById('remote-access-disable-btn')?.addEventListener('click', async () => {
      try {
        await apiPost('/server/remote-access/disable', {});
        toast('UPnP remote access disabled', 'success');
        loadRemoteAccessCard();
      } catch (disableError) {
        toast(disableError.message || 'Failed to disable UPnP', 'error');
      }
    });

    document.getElementById('remote-access-retry-btn')?.addEventListener('click', async () => {
      const retryButton = document.getElementById('remote-access-retry-btn');
      retryButton.disabled = true;
      retryButton.textContent = 'Retrying...';
      try {
        await apiPost('/server/remote-access/enable', { external_port: upnp.external_port });
        toast('UPnP re-established', 'success');
        loadRemoteAccessCard();
      } catch (retryError) {
        toast(retryError.message || 'Retry failed', 'error');
        loadRemoteAccessCard();
      }
    });

    document.getElementById('remote-access-test-btn')?.addEventListener('click', async () => {
      const testButton = document.getElementById('remote-access-test-btn');
      testButton.disabled = true;
      testButton.textContent = 'Testing...';
      try {
        const testResult = await apiPost('/server/remote-access/test', {});
        if (testResult.reachable) {
          toast('Port mapping is registered on your router', 'success');
        } else {
          toast('Port mapping not found on router. It may have expired or been removed.', 'warning');
        }
      } catch (testError) {
        toast(testError.message || 'Reachability test failed', 'error');
      }
      testButton.disabled = false;
      testButton.innerHTML = `${icon('check', 14)} Test Reachability`;
    });

    document.getElementById('remote-access-apply-port-btn')?.addEventListener('click', async () => {
      const portInput = document.getElementById('remote-access-port-input');
      const newPort = parseInt(portInput.value, 10);
      if (isNaN(newPort) || newPort < 1 || newPort > 65535) {
        toast('Invalid port number (1-65535)', 'warning');
        return;
      }
      const applyButton = document.getElementById('remote-access-apply-port-btn');
      applyButton.disabled = true;
      applyButton.textContent = 'Applying...';
      try {
        await apiPost('/server/remote-access/disable', {});
        await apiPost('/server/remote-access/enable', { external_port: newPort });
        toast(`Port changed to ${newPort}`, 'success');
        loadRemoteAccessCard();
      } catch (portChangeError) {
        toast(portChangeError.message || 'Failed to change port', 'error');
        loadRemoteAccessCard();
      }
    });

    // Copy public URL button (works for both UPnP and tunnel).
    document.querySelector('.copy-remote-url')?.addEventListener('click', () => {
      const urlElement = document.getElementById('remote-access-public-url');
      if (!urlElement) return;
      navigator.clipboard.writeText(urlElement.textContent.trim()).then(() => {
        toast('Public URL copied to clipboard', 'success');
      }).catch(() => {
        toast('Failed to copy -- select and copy manually', 'warning');
      });
    });
  }

  async function loadCloudSettingsCard() {
    const cardContainer = document.getElementById('cloud-claim-card');
    if (!cardContainer) return;

    try {
      const claimStatus = await fetch(`${API}/auth/claim-status`).then(r => r.ok ? r.json() : null).catch(() => null);

      if (claimStatus?.is_claimed) {
        // Server is claimed — show status and unclaim button
        const cloudUrl = claimStatus.cloud_service_url || CLOUD_API;
        const serverId = claimStatus.server_id || 'unknown';

        cardContainer.innerHTML = `
          <div class="card cloud-status-card cloud-status-claimed">
            <div class="cloud-status-header">
              <span class="cloud-status-indicator cloud-status-connected"></span>
              <strong>Linked to Ironshelf Cloud</strong>
            </div>
            <dl class="cloud-status-details">
              <dt>Server ID</dt>
              <dd><code>${escapeHtml(serverId)}</code></dd>
              <dt>Cloud Service</dt>
              <dd>${escapeHtml(cloudUrl)}</dd>
            </dl>
            <p class="text-caption" style="margin-top:var(--space-3)">Users with Ironshelf Cloud accounts can sign in to this server.</p>
            <button class="btn btn-danger mt-4" id="unclaim-server-btn">${icon('x', 16)} Disconnect from Cloud</button>
          </div>
        `;

        document.getElementById('unclaim-server-btn')?.addEventListener('click', () => {
          showConfirmModal({
            title: 'Disconnect from Ironshelf Cloud',
            message: 'This will remove the cloud link. Users who signed in via Ironshelf Cloud will lose access on their next session. You can reclaim the server later.',
            confirmText: 'Disconnect',
            onConfirm: async () => {
              try {
                await apiDelete('/auth/unclaim');
                toast('Server disconnected from Ironshelf Cloud', 'success');
                loadCloudSettingsCard();
              } catch (unclaimError) {
                toast(unclaimError.message, 'error');
              }
            },
          });
        });
      } else {
        // Server is NOT claimed — show claim button
        cardContainer.innerHTML = `
          <div class="card cloud-status-card">
            <div class="cloud-status-header">
              <span class="cloud-status-indicator cloud-status-disconnected"></span>
              <strong>Not connected</strong>
            </div>
            <p class="text-caption" style="margin-top:var(--space-2)">Enable Ironshelf Cloud to reach this server from anywhere — it starts a Cloudflare Tunnel automatically and lets users sign in with their cloud account. This is <strong>completely optional</strong> — your server works fully without it.</p>
            <p class="text-caption" style="margin-top:var(--space-1);font-size:var(--text-xs);color:var(--color-muted)">Cloud only stores your server URL and who has access. No book data, reading history, or files ever leave your server.</p>
            <button class="btn btn-cloud mt-4" id="claim-server-btn" style="width:auto">${icon('globe', 16)} Enable Ironshelf Cloud</button>
          </div>
        `;

        document.getElementById('claim-server-btn')?.addEventListener('click', () => {
          const { close } = showModal({
            title: 'Claim Server via Ironshelf Cloud',
            description: 'Sign in with your Ironshelf Cloud account to claim this server.',
            content: `
              <form id="cloud-claim-form" novalidate>
                <div class="form-group hidden" id="claim-register-fields">
                  <label class="form-label" for="claim-reg-email">Cloud Email</label>
                  <input type="email" class="form-input" id="claim-reg-email" autocomplete="email">
                  <label class="form-label" for="claim-reg-username" style="margin-top:var(--space-3)">Username</label>
                  <input type="text" class="form-input" id="claim-reg-username" autocomplete="username" placeholder="2-32 chars, letters/numbers/underscore">
                </div>
                <div class="form-group" id="claim-login-identifier-group">
                  <label class="form-label" for="claim-cloud-email">Cloud Email or Username</label>
                  <input type="text" class="form-input" id="claim-cloud-email" required autocomplete="email" autofocus>
                </div>
                <div class="form-group">
                  <label class="form-label" for="claim-cloud-password">Cloud Password</label>
                  <input type="password" class="form-input" id="claim-cloud-password" required autocomplete="current-password">
                </div>
                <div class="form-group">
                  <label class="form-label" for="claim-server-name">Server Name</label>
                  <input type="text" class="form-input" id="claim-server-name" placeholder="My Ironshelf Server" value="${escapeHtml(window.location.hostname)}">
                  <p class="form-hint">A friendly name for this server in your cloud dashboard.</p>
                </div>
                <div id="claim-error" class="form-error hidden" role="alert"></div>
                <div class="modal-actions">
                  <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
                  <button type="submit" class="btn btn-primary" id="claim-submit-btn">${icon('globe', 16)} Claim Server</button>
                </div>
                <div class="login-footer" style="margin-top:var(--space-3);text-align:center">
                  <span id="claim-mode-hint">No Ironshelf Cloud account?</span>
                  <a href="#" id="claim-mode-toggle">Create one</a>
                </div>
              </form>
            `,
          });

          const claimForm = document.getElementById('cloud-claim-form');
          claimForm.querySelector('[data-action="cancel"]').addEventListener('click', close);

          // Toggle between sign-in and register modes.
          let isRegisterMode = false;
          const registerFields = document.getElementById('claim-register-fields');
          const loginIdentifierGroup = document.getElementById('claim-login-identifier-group');
          const claimSubmitBtnEl = document.getElementById('claim-submit-btn');
          const modeHint = document.getElementById('claim-mode-hint');
          const modeToggle = document.getElementById('claim-mode-toggle');
          modeToggle.addEventListener('click', (toggleEvent) => {
            toggleEvent.preventDefault();
            isRegisterMode = !isRegisterMode;
            registerFields.classList.toggle('hidden', !isRegisterMode);
            loginIdentifierGroup.classList.toggle('hidden', isRegisterMode);
            document.getElementById('claim-cloud-email').required = !isRegisterMode;
            claimSubmitBtnEl.innerHTML = isRegisterMode
              ? `${icon('globe', 16)} Create account &amp; claim`
              : `${icon('globe', 16)} Claim Server`;
            modeHint.textContent = isRegisterMode ? 'Already have a cloud account?' : 'No Ironshelf Cloud account?';
            modeToggle.textContent = isRegisterMode ? 'Sign in' : 'Create one';
          });

          // Shared: take an authenticated cloud JWT, claim the server, persist locally.
          async function completeCloudClaim(cloudJwt) {
            const claimCloudResponse = await fetch(`${CLOUD_API}/servers/claim`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${cloudJwt}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                server_url: window.location.origin,
                server_name: document.getElementById('claim-server-name').value || window.location.hostname,
              }),
            });
            if (!claimCloudResponse.ok) {
              const claimCloudError = await claimCloudResponse.json().catch(() => ({}));
              throw new Error(claimCloudError.error || 'Failed to claim server on cloud');
            }
            const claimCloudData = await claimCloudResponse.json();
            const claimToken = claimCloudData.data?.claim_token;
            const serverId = claimCloudData.data?.server_id;
            if (!claimToken) {
              throw new Error('Cloud did not return a claim token');
            }
            await apiPost('/auth/claim', {
              claim_token: claimToken,
              cloud_service_url: CLOUD_API,
              server_id: serverId,
            });
          }

          claimForm.addEventListener('submit', async (formEvent) => {
            formEvent.preventDefault();
            const claimError = document.getElementById('claim-error');
            const claimSubmitBtn = document.getElementById('claim-submit-btn');
            claimError.classList.add('hidden');
            claimSubmitBtn.disabled = true;
            claimSubmitBtn.textContent = isRegisterMode ? 'Creating account...' : 'Claiming...';

            try {
              const password = document.getElementById('claim-cloud-password').value;
              let cloudJwt;

              if (isRegisterMode) {
                // Create a new Ironshelf Cloud account, which returns a token.
                const registerResponse = await fetch(`${CLOUD_API}/auth/register`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    email: document.getElementById('claim-reg-email').value,
                    username: document.getElementById('claim-reg-username').value,
                    password,
                  }),
                });
                if (!registerResponse.ok) {
                  const registerError = await registerResponse.json().catch(() => ({}));
                  throw new Error(registerError.error || 'Failed to create cloud account');
                }
                const registerData = await registerResponse.json();
                cloudJwt = registerData.data?.token;
                if (!cloudJwt) throw new Error('Invalid response from cloud service');
              } else {
                // Authenticate with an existing cloud account.
                const cloudAuthResponse = await fetch(`${CLOUD_API}/auth/login`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    email_or_username: document.getElementById('claim-cloud-email').value,
                    password,
                  }),
                });
                if (!cloudAuthResponse.ok) {
                  const cloudAuthError = await cloudAuthResponse.json().catch(() => ({}));
                  throw new Error(cloudAuthError.error || 'Cloud authentication failed');
                }
                const cloudAuthData = await cloudAuthResponse.json();
                cloudJwt = cloudAuthData.data?.token;
                if (!cloudAuthData.ok || !cloudJwt) {
                  throw new Error('Invalid response from cloud service');
                }
              }

              await completeCloudClaim(cloudJwt);

              close();
              toast('Server claimed successfully! Cloud login is now enabled.', 'success');
              loadCloudSettingsCard();
            } catch (claimAttemptError) {
              claimError.textContent = claimAttemptError.message;
              claimError.classList.remove('hidden');
              claimSubmitBtn.disabled = false;
              claimSubmitBtn.innerHTML = isRegisterMode
                ? `${icon('globe', 16)} Create account &amp; claim`
                : `${icon('globe', 16)} Claim Server`;
            }
          });
        });
      }
    } catch (loadError) {
      cardContainer.innerHTML = `
        <div class="card" style="color:var(--color-muted);text-align:center;padding:var(--space-6)">
          Failed to load cloud status
        </div>
      `;
    }
  }

  async function loadInvitesList() {
    const invitesList = document.getElementById('invites-list');
    if (!invitesList) return;
    try {
      const invitesData = await apiGet('/users/invites').catch(() => []);
      const invites = Array.isArray(invitesData) ? invitesData : (invitesData?.items || []);
      if (invites.length === 0) {
        invitesList.innerHTML = `
          <div style="padding:var(--space-6);text-align:center;color:var(--color-muted);font-size:var(--text-sm)">
            No pending invites
          </div>
        `;
        return;
      }
      invitesList.innerHTML = invites.map(invite => {
        const isUsed = invite.used_at || invite.is_used;
        const createdDate = invite.created_at ? new Date(invite.created_at).toLocaleDateString() : 'Unknown';
        return `
          <div class="list-item" style="cursor:default">
            <div class="list-item-content">
              <div class="list-item-icon">${Icons.mail}</div>
              <div class="list-item-text">
                <div class="list-item-name" style="font-family:var(--font-mono);font-size:var(--text-sm)">${escapeHtml(invite.code || invite.invite_code || '')}</div>
                <div class="list-item-subtitle">Created ${createdDate}</div>
              </div>
            </div>
            <div class="list-item-meta">
              <span class="badge ${isUsed ? 'badge-muted' : 'badge-success'}">${isUsed ? 'Used' : 'Available'}</span>
            </div>
          </div>
        `;
      }).join('');
    } catch {
      invitesList.innerHTML = `
        <div style="padding:var(--space-6);text-align:center;color:var(--color-muted);font-size:var(--text-sm)">
          Failed to load invites
        </div>
      `;
    }
  }

  // --- Server Update Helpers ---

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function bindServerUpdateEvents() {
    const checkButton = document.getElementById('check-update-btn');
    if (!checkButton) return;

    checkButton.addEventListener('click', async () => {
      const updateCard = document.getElementById('update-card');
      if (!updateCard) return;

      checkButton.disabled = true;
      checkButton.innerHTML = `<span class="update-spinner"></span> Checking...`;

      try {
        const updateInfo = await apiGet('/server/update/check');
        renderUpdateCheckResult(updateCard, updateInfo);
      } catch (checkError) {
        updateCard.innerHTML = `
          <div style="display:flex;align-items:center;gap:var(--space-3);color:var(--color-danger);font-size:var(--text-sm)">
            ${icon('alertCircle', 18)}
            <span>Failed to check for updates: ${escapeHtml(checkError.message)}</span>
          </div>
          <div class="update-actions" style="margin-top:var(--space-4)">
            <button class="btn btn-primary" id="check-update-btn">${icon('refresh', 16)} Retry</button>
          </div>
        `;
        bindServerUpdateEvents();
      }
    });
  }

  function renderUpdateCheckResult(updateCard, updateInfo) {
    const isUpdateAvailable = updateInfo.update_available;
    const downloadSizeText = updateInfo.download_size ? formatBytes(updateInfo.download_size) : '';

    let releaseNotesHtml = '';
    if (updateInfo.release_notes && updateInfo.release_notes.trim()) {
      releaseNotesHtml = `
        <button class="update-release-notes-toggle" id="toggle-release-notes">Show release notes</button>
        <div class="update-release-notes" id="release-notes-content" style="display:none">
          ${escapeHtml(updateInfo.release_notes)}
        </div>
      `;
    }

    updateCard.innerHTML = `
      <div class="update-version-row">
        <span class="update-version-badge is-current">Current: v${escapeHtml(updateInfo.current_version)}</span>
        ${isUpdateAvailable ? `
          <span class="update-version-arrow">&rarr;</span>
          <span class="update-version-badge is-latest">v${escapeHtml(updateInfo.latest_version)}</span>
        ` : ''}
      </div>

      ${isUpdateAvailable ? `
        <div class="update-available-banner">
          ${icon('arrowUp', 18)}
          <span>A new version is available${downloadSizeText ? ` (${downloadSizeText})` : ''}</span>
        </div>
      ` : `
        <div class="update-up-to-date">
          ${icon('check', 18)}
          <span>Server is up to date</span>
        </div>
      `}

      ${releaseNotesHtml}

      <div class="update-actions" style="margin-top:var(--space-4)">
        <button class="btn btn-secondary" id="check-update-btn">${icon('refresh', 16)} Check Again</button>
        ${isUpdateAvailable ? `
          <button class="btn btn-primary" id="apply-update-btn">${icon('download', 16)} Update to v${escapeHtml(updateInfo.latest_version)}</button>
        ` : ''}
      </div>
    `;

    // Bind release notes toggle
    const toggleButton = document.getElementById('toggle-release-notes');
    const notesContent = document.getElementById('release-notes-content');
    if (toggleButton && notesContent) {
      toggleButton.addEventListener('click', () => {
        const isHidden = notesContent.style.display === 'none';
        notesContent.style.display = isHidden ? 'block' : 'none';
        toggleButton.textContent = isHidden ? 'Hide release notes' : 'Show release notes';
      });
    }

    // Re-bind check button
    bindServerUpdateEvents();

    // Bind apply button
    const applyButton = document.getElementById('apply-update-btn');
    if (applyButton) {
      applyButton.addEventListener('click', () => {
        showConfirmModal({
          title: 'Update Server',
          message: `This will download v${updateInfo.latest_version} and restart the server. All active connections will be closed. Continue?`,
          confirmText: 'Update Now',
          confirmClass: 'btn-primary',
          onConfirm: () => startServerUpdate(updateCard, updateInfo.latest_version),
        });
      });
    }
  }

  async function startServerUpdate(updateCard, targetVersion) {
    updateCard.innerHTML = `
      <div class="update-progress" id="update-progress">
        <div class="update-progress-step is-active" id="step-downloading">
          <span class="update-spinner"></span>
          <span>Downloading v${escapeHtml(targetVersion)}...</span>
        </div>
        <div class="update-progress-bar">
          <div class="update-progress-bar-fill" id="update-download-bar" style="width:0%"></div>
        </div>
        <div class="update-progress-step" id="step-replacing">
          <span class="nav-icon" style="width:16px;height:16px;opacity:0.3">${Icons.check}</span>
          <span>Replacing binary</span>
        </div>
        <div class="update-progress-step" id="step-restarting">
          <span class="nav-icon" style="width:16px;height:16px;opacity:0.3">${Icons.check}</span>
          <span>Restarting server</span>
        </div>
      </div>
    `;

    try {
      await apiPost('/server/update/apply', {});
    } catch (applyError) {
      // If the POST itself fails, show error immediately
      if (!applyError.message?.includes('Failed to fetch')) {
        updateCard.innerHTML = `
          <div style="display:flex;align-items:center;gap:var(--space-3);color:var(--color-danger);font-size:var(--text-sm)">
            ${icon('alertCircle', 18)}
            <span>Update failed: ${escapeHtml(applyError.message)}</span>
          </div>
          <div class="update-actions" style="margin-top:var(--space-4)">
            <button class="btn btn-primary" id="check-update-btn">${icon('refresh', 16)} Check Again</button>
          </div>
        `;
        bindServerUpdateEvents();
        return;
      }
    }

    // Poll the update status endpoint until the server restarts
    pollUpdateStatus(updateCard, targetVersion);
  }

  function pollUpdateStatus(updateCard, targetVersion) {
    let updatePollTimer = null;
    let serverDownDetected = false;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 15; // 30 seconds at 2-second intervals

    updatePollTimer = setInterval(async () => {
      try {
        if (serverDownDetected) {
          // Server went down — now try to reach health endpoint with new version
          reconnectAttempts++;
          if (reconnectAttempts > maxReconnectAttempts) {
            clearInterval(updatePollTimer);
            updateCard.innerHTML = `
              <div class="update-progress">
                <div class="update-progress-step is-complete">
                  <span class="update-success-icon">${Icons.check}</span>
                  <span>Downloaded</span>
                </div>
                <div class="update-progress-step is-complete">
                  <span class="update-success-icon">${Icons.check}</span>
                  <span>Binary replaced</span>
                </div>
              </div>
              <div style="display:flex;align-items:flex-start;gap:var(--space-3);color:var(--color-warning);font-size:var(--text-sm);margin-top:var(--space-4);padding:var(--space-3) var(--space-4);border-radius:var(--radius);background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.2)">
                ${icon('alertCircle', 18)}
                <div>
                  <strong>Server is updating.</strong> Please refresh this page manually once the server restarts.
                  <br><span style="opacity:0.7;font-size:var(--text-xs)">If the server does not come back, it may need to be restarted manually from the command line.</span>
                </div>
              </div>
            `;
            return;
          }

          try {
            const healthResponse = await fetch(HEALTH_URL, { cache: 'no-store' });
            if (healthResponse.ok) {
              const healthData = await healthResponse.json();
              clearInterval(updatePollTimer);
              updateCard.innerHTML = `
                <div class="update-progress">
                  <div class="update-progress-step is-complete">
                    <span class="update-success-icon">${Icons.check}</span>
                    <span>Downloaded</span>
                  </div>
                  <div class="update-progress-step is-complete">
                    <span class="update-success-icon">${Icons.check}</span>
                    <span>Binary replaced</span>
                  </div>
                  <div class="update-progress-step is-complete">
                    <span class="update-success-icon">${Icons.check}</span>
                    <span>Server restarted</span>
                  </div>
                </div>
                <div class="update-available-banner" style="margin-top:var(--space-4);background:rgba(34,197,94,0.08);border-color:rgba(34,197,94,0.2);color:var(--color-success)">
                  ${icon('check', 18)}
                  <span>Successfully updated to v${escapeHtml(targetVersion)}</span>
                </div>
              `;
              toast('Server updated successfully', 'success');
              fetchServerVersion(true);
            }
          } catch {
            // Still down — keep polling
            const restartStep = document.getElementById('step-restarting');
            if (restartStep) {
              restartStep.querySelector('span:last-child').textContent =
                `Waiting for server... (${reconnectAttempts}s)`;
            }
          }
          return;
        }

        // Server is still up — poll the update status endpoint
        const statusResponse = await apiGet('/server/update/status');
        const downloadBar = document.getElementById('update-download-bar');
        const downloadStep = document.getElementById('step-downloading');
        const replaceStep = document.getElementById('step-replacing');
        const restartStep = document.getElementById('step-restarting');

        switch (statusResponse.phase) {
          case 'downloading':
            if (downloadBar && statusResponse.progress_percent >= 0) {
              downloadBar.style.width = statusResponse.progress_percent + '%';
            }
            break;

          case 'replacing':
            if (downloadStep) {
              downloadStep.className = 'update-progress-step is-complete';
              downloadStep.innerHTML = `<span class="update-success-icon">${Icons.check}</span><span>Downloaded</span>`;
            }
            if (downloadBar) downloadBar.style.width = '100%';
            if (replaceStep) {
              replaceStep.className = 'update-progress-step is-active';
              replaceStep.innerHTML = `<span class="update-spinner"></span><span>Replacing binary...</span>`;
            }
            break;

          case 'restarting':
            if (downloadStep) {
              downloadStep.className = 'update-progress-step is-complete';
              downloadStep.innerHTML = `<span class="update-success-icon">${Icons.check}</span><span>Downloaded</span>`;
            }
            if (downloadBar) downloadBar.style.width = '100%';
            if (replaceStep) {
              replaceStep.className = 'update-progress-step is-complete';
              replaceStep.innerHTML = `<span class="update-success-icon">${Icons.check}</span><span>Binary replaced</span>`;
            }
            if (restartStep) {
              restartStep.className = 'update-progress-step is-active';
              restartStep.innerHTML = `<span class="update-spinner"></span><span>Restarting server...</span>`;
            }
            serverDownDetected = true;
            break;

          case 'manual_restart_required':
            clearInterval(updatePollTimer);
            if (downloadStep) {
              downloadStep.className = 'update-progress-step is-complete';
              downloadStep.innerHTML = `<span class="update-success-icon">${Icons.check}</span><span>Downloaded</span>`;
            }
            if (downloadBar) downloadBar.style.width = '100%';
            if (replaceStep) {
              replaceStep.className = 'update-progress-step is-complete';
              replaceStep.innerHTML = `<span class="update-success-icon">${Icons.check}</span><span>Binary staged</span>`;
            }
            updateCard.innerHTML = `
              <div class="update-progress">
                <div class="update-progress-step is-complete">
                  <span class="update-success-icon">${Icons.check}</span>
                  <span>Downloaded v${escapeHtml(targetVersion)}</span>
                </div>
                <div class="update-progress-step is-complete">
                  <span class="update-success-icon">${Icons.check}</span>
                  <span>Binary staged</span>
                </div>
              </div>
              <div style="display:flex;align-items:flex-start;gap:var(--space-3);font-size:var(--text-sm);margin-top:var(--space-4);padding:var(--space-3) var(--space-4);border-radius:var(--radius);background:rgba(59,179,201,0.08);border:1px solid rgba(59,179,201,0.2);color:var(--color-text-secondary)">
                ${icon('info', 18)}
                <div>
                  <strong style="color:var(--color-text)">Update downloaded. Please restart the server to apply.</strong>
                  <br>Restart the Ironshelf service or re-run the server executable, then refresh this page.
                </div>
              </div>
            `;
            toast('Update downloaded — restart the server to apply', 'success');
            break;

          case 'failed':
            clearInterval(updatePollTimer);
            updateCard.innerHTML = `
              <div style="display:flex;align-items:center;gap:var(--space-3);color:var(--color-danger);font-size:var(--text-sm)">
                ${icon('alertCircle', 18)}
                <span>Update failed: ${escapeHtml(statusResponse.message)}</span>
              </div>
              <div class="update-actions" style="margin-top:var(--space-4)">
                <button class="btn btn-primary" id="check-update-btn">${icon('refresh', 16)} Check Again</button>
              </div>
            `;
            bindServerUpdateEvents();
            break;
        }
      } catch {
        // If the status poll itself fails, the server may have already gone down for restart
        if (!serverDownDetected) {
          serverDownDetected = true;
          const restartStep = document.getElementById('step-restarting');
          if (restartStep) {
            restartStep.className = 'update-progress-step is-active';
            restartStep.innerHTML = `<span class="update-spinner"></span><span>Server restarting...</span>`;
          }
        }
      }
    }, 2000);
  }

  // --- Users (owner only) ---

  async function renderUsers() {
    if (!await checkAuth()) return;
    if (!hasPermission('manage_users')) { navigateTo('/'); return; }
    setTitle(['Users']);
    breadcrumbTrail = [{ label: 'Users', path: '/users' }];

    let bodyContent = `
      <div class="page-header">
        <h1>Users</h1>
        <div class="actions">
          <button class="btn btn-primary" id="invite-user-btn">${icon('plus', 16)} Invite User</button>
        </div>
      </div>
    `;

    try {
      const users = await apiGet('/users').catch(() => null);

      if (users && users.length > 0) {
        bodyContent += `
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${users.map(u => `
                  <tr>
                    <td><strong>${escapeHtml(u.username)}</strong></td>
                    <td><span class="badge ${u.is_owner ? 'badge-teal' : 'badge-muted'}">${u.is_owner ? 'Owner' : 'User'}</span></td>
                    <td class="text-caption">${u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                    <td class="text-right" style="display:flex;gap:var(--space-1);justify-content:flex-end">
                      <button class="btn btn-ghost btn-sm reset-pw-btn" data-user-id="${u.id}" data-username="${escapeHtml(u.username)}" aria-label="Reset password for ${escapeHtml(u.username)}" title="Reset password">${icon('lock', 14)}</button>
                      ${!u.is_owner ? `<button class="btn btn-ghost btn-sm library-access-btn" data-user-id="${u.id}" aria-label="Library access for ${escapeHtml(u.username)}" title="Library access">${icon('library', 14)}</button>` : ''}
                      ${!u.is_owner ? `<button class="btn btn-ghost btn-sm delete-user-btn" data-user-id="${u.id}" aria-label="Remove ${escapeHtml(u.username)}">${icon('trash', 14)}</button>` : ''}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      } else {
        bodyContent += `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.users}</div>
            <h3>Only you here</h3>
            <p>Invite others to share your library collection.</p>
          </div>
        `;
      }
    } catch {
      bodyContent += `
        <div class="card" style="text-align:center;padding:var(--space-8)">
          <p class="text-caption">User management is available in a future update.</p>
        </div>
      `;
    }

    renderShell(bodyContent, 'users');

    document.getElementById('invite-user-btn')?.addEventListener('click', () => {
      const { close } = showModal({
        title: 'Invite User',
        description: 'Create credentials for a new user. Share the password with them securely.',
        content: `
          <form id="invite-form" novalidate>
            <div class="form-group">
              <label class="form-label" for="invite-username">Username</label>
              <input type="text" class="form-input" id="invite-username" required autofocus>
            </div>
            <div class="form-group">
              <label class="form-label" for="invite-password">Password</label>
              <input type="password" class="form-input" id="invite-password" required minlength="6">
              <p class="form-hint">Minimum 6 characters. Share securely with the user.</p>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">Create User</button>
            </div>
          </form>
        `,
      });

      const form = document.getElementById('invite-form');
      form.querySelector('[data-action="cancel"]').addEventListener('click', close);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await apiPost('/auth/register', {
            username: document.getElementById('invite-username').value.trim(),
            password: document.getElementById('invite-password').value,
          });
          toast('User created', 'success');
          close();
          renderUsers();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });

    document.querySelectorAll('.delete-user-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        showConfirmModal({
          title: 'Remove User',
          message: 'This user will lose all access. This cannot be undone.',
          confirmText: 'Remove',
          onConfirm: async () => {
            try {
              await apiDelete(`/users/${btn.dataset.userId}`);
              toast('User removed', 'success');
              renderUsers();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        });
      });
    });

    // Library access buttons
    document.querySelectorAll('.library-access-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        showLibraryAccessModal(btn.dataset.userId);
      });
    });

    // Reset password buttons
    document.querySelectorAll('.reset-pw-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const userId = btn.dataset.userId;
        const username = btn.dataset.username;
        const { close } = showModal({
          title: `Reset Password — ${username}`,
          description: 'Set a new password for this user. Their existing sessions will be signed out.',
          content: `
            <form id="reset-user-pw-form" novalidate>
              <div class="form-group">
                <label class="form-label" for="reset-user-new-pw">New Password</label>
                <input type="password" class="form-input" id="reset-user-new-pw" required minlength="8" autocomplete="new-password" autofocus>
                <p class="form-hint">Minimum 8 characters.</p>
              </div>
              <div id="reset-user-pw-error" class="form-error hidden" role="alert"></div>
              <div class="modal-actions">
                <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
                <button type="submit" class="btn btn-primary">Set Password</button>
              </div>
            </form>
          `,
        });
        const form = document.getElementById('reset-user-pw-form');
        form.querySelector('[data-action="cancel"]').addEventListener('click', close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const errorEl = document.getElementById('reset-user-pw-error');
          errorEl.classList.add('hidden');
          const newPassword = document.getElementById('reset-user-new-pw').value;
          if (newPassword.length < 8) {
            errorEl.textContent = 'Password must be at least 8 characters.';
            errorEl.classList.remove('hidden');
            return;
          }
          try {
            await apiPut(`/users/${userId}/password`, { new_password: newPassword });
            close();
            toast(`Password reset for ${username}`, 'success');
          } catch (err) {
            errorEl.textContent = err.message || 'Failed to reset password.';
            errorEl.classList.remove('hidden');
          }
        });
      });
    });
  }

  // --- Home / Dashboard ---

  async function renderHome() {
    if (!await checkAuth()) return;
    const thisGeneration = navigationGeneration;
    setTitle(['Home']);
    breadcrumbTrail = [{ label: 'Home', path: '/' }];

    renderShell(`
      <div class="page-header"><h1>Home</h1></div>
      <div class="dashboard-section">
        <div class="skeleton" style="height:200px;border-radius:var(--radius-lg)"></div>
      </div>
      ${skeletonCards(4)}
    `, 'home');

    try {
      const [continueReading, collections, libraries] = await Promise.all([
        apiGet('/books/continue').catch(() => []),
        apiGet('/collections').catch(() => []),
        apiGet('/libraries').catch(() => []),
      ]);

      if (isStaleNavigation(thisGeneration)) return;

      const continueBooks = Array.isArray(continueReading) ? continueReading : (continueReading?.items || []);
      const collectionsList = Array.isArray(collections) ? collections : (collections?.items || []);
      const libraryList = Array.isArray(libraries) ? libraries : (libraries?.items || []);

      let bodyContent = `<div class="page-header"><h1>Home</h1></div>`;

      // Continue Reading section
      if (continueBooks.length > 0) {
        bodyContent += `
          <div class="dashboard-section">
            <div class="dashboard-section-header">
              <h2>${icon('clock', 22)} Continue Reading</h2>
            </div>
            <div class="continue-reading-row">
        `;
        for (const entry of continueBooks) {
          // /books/continue returns { book: {...}, progress: { percent, format } }.
          const book = entry.book || entry;
          const progress = entry.progress || {};
          const coverUrl = book.has_cover ? `${API}/books/${book.id}/cover${mediaToken()}` : '';
          const progressPercent = Math.round((progress.percent || 0) * 100);
          const readFormat = (progress.format || 'epub').toLowerCase();
          bodyContent += `
            <div class="continue-reading-card" data-read-book-id="${book.id}" data-read-format="${readFormat}" role="link" tabindex="0" aria-label="Continue reading ${escapeHtml(book.title)}">
              ${coverUrl
                ? `<div class="book-cover"><img src="${coverUrl}" alt="" loading="lazy"><div class="cover-progress-wrap"><div class="cover-progress-bar"><div class="cover-progress-fill" style="width:${progressPercent}%"></div></div><div class="cover-progress-label">${progressPercent}%</div></div></div>`
                : `<div class="book-cover-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg><div class="cover-progress-wrap"><div class="cover-progress-bar"><div class="cover-progress-fill" style="width:${progressPercent}%"></div></div><div class="cover-progress-label">${progressPercent}%</div></div></div>`
              }
              <div class="book-title" title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</div>
              <div class="book-meta">${(book.author_names && book.author_names.length > 0) ? escapeHtml(book.author_names.join(', ')) : ''}</div>
            </div>
          `;
        }
        bodyContent += `</div></div>`;
      }

      // Your Collections section
      if (collectionsList.length > 0) {
        bodyContent += `
          <div class="dashboard-section">
            <div class="dashboard-section-header">
              <h2>${icon('collection', 22)} Your Collections</h2>
              <a href="#/collections" class="section-link">View all ${icon('chevronRight', 14)}</a>
            </div>
            <div class="grid grid-collections">
        `;
        for (const collection of collectionsList.slice(0, 6)) {
          bodyContent += renderCollectionCard(collection);
        }
        bodyContent += `</div></div>`;
      }

      // Your Libraries section (always shown when libraries exist)
      if (libraryList.length > 0) {
        bodyContent += `
          <div class="dashboard-section">
            <div class="dashboard-section-header">
              <h2>${icon('library', 22)} Your Libraries</h2>
              <a href="#/libraries" class="section-link">View all ${icon('chevronRight', 14)}</a>
            </div>
            <div class="grid grid-libraries">
        `;
        for (const lib of libraryList.slice(0, 6)) {
          const sourceLabel = lib.source_kind === 'calibre' ? 'Calibre' : 'Folder';
          bodyContent += `
            <div class="card card-interactive library-card" data-library-id="${lib.id}" role="link" tabindex="0" aria-label="${escapeHtml(lib.name)} library">
              <div class="library-card-header">
                <div class="library-card-icon">${lib.source_kind === 'calibre' ? Icons.book : Icons.folder}</div>
                <span class="badge badge-teal">${escapeHtml(sourceLabel)}</span>
              </div>
              <div class="library-card-name">${escapeHtml(lib.name)}</div>
              <div class="library-card-path">${escapeHtml(lib.path || '')}</div>
            </div>
          `;
        }
        bodyContent += `</div></div>`;

        // Recently Added section
        let recentBooks = [];
        try {
          const recentResponse = await apiGet(`/libraries/${libraryList[0].id}/books?sort=added&direction=desc&per_page=12`).catch(() => null);
          recentBooks = Array.isArray(recentResponse) ? recentResponse : (recentResponse?.items || recentResponse?.data || []);
        } catch { /* ignore */ }

        if (isStaleNavigation(thisGeneration)) return;

        if (recentBooks.length > 0) {
          bodyContent += `
            <div class="dashboard-section">
              <div class="dashboard-section-header">
                <h2>${icon('star', 22)} Recently Added</h2>
              </div>
              <div class="grid grid-books">
          `;
          for (const book of recentBooks) {
            bodyContent += renderBookCard(book);
          }
          bodyContent += `</div></div>`;
        }
      } else {
        // No libraries at all — show welcome empty state
        bodyContent += `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.library}</div>
            <h3>Welcome to Ironshelf</h3>
            <p>${hasPermission('manage_library') ? 'Get started by adding your first Calibre library or book folder.' : 'No libraries are available yet. Ask an administrator to set one up.'}</p>
            ${hasPermission('manage_library') ? `<button class="btn btn-primary btn-lg" id="home-add-library-btn">Add Your First Library</button>` : ''}
          </div>
        `;
      }

      renderShell(bodyContent, 'home');

      // Bind home add-library button
      document.getElementById('home-add-library-btn')?.addEventListener('click', showAddLibraryModal);

      // Bind continue reading cards
      document.querySelectorAll('[data-read-book-id]').forEach(card => {
        const format = card.dataset.readFormat || 'epub';
        const handler = () => navigateTo(`/read/${card.dataset.readBookId}/${format}`);
        card.addEventListener('click', handler);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

      // Bind collection cards
      document.querySelectorAll('[data-collection-id]').forEach(card => {
        const handler = () => navigateTo(`/collection/${card.dataset.collectionId}`);
        card.addEventListener('click', handler);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

      // Bind library cards
      document.querySelectorAll('[data-library-id]').forEach(card => {
        const handler = () => navigateTo(`/library/${card.dataset.libraryId}`);
        card.addEventListener('click', handler);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

      // Bind book cards
      document.querySelectorAll('[data-book-id]').forEach(card => {
        const handler = () => navigateTo(`/book/${card.dataset.bookId}`);
        card.addEventListener('click', handler);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

    } catch (err) {
      renderShell(renderError('Failed to load dashboard', err.message, () => renderHome()), 'home');
    }
  }

  // --- Global Search ---

  let globalSearchOpen = false;

  function openGlobalSearch() {
    if (globalSearchOpen) return;
    globalSearchOpen = true;

    const overlay = document.createElement('div');
    overlay.className = 'search-overlay';
    overlay.id = 'global-search-overlay';
    overlay.innerHTML = `
      <div class="search-overlay-container" role="dialog" aria-modal="true" aria-label="Search">
        <div class="search-overlay-input-wrap">
          <span class="search-icon">${Icons.search}</span>
          <input type="search" id="global-search-input" placeholder="Search books, authors, series..." autocomplete="off" autofocus>
          <span class="search-shortcut-hint">Esc</span>
        </div>
        <div class="search-overlay-results" id="global-search-results" role="listbox" aria-label="Search results"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = document.getElementById('global-search-input');
    const resultsContainer = document.getElementById('global-search-results');

    // Focus input
    requestAnimationFrame(() => input?.focus());

    const closeSearch = () => {
      globalSearchOpen = false;
      overlay.remove();
    };

    // Click backdrop to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeSearch();
    });

    // Keyboard handling
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeSearch();
      }
    });

    let highlightIndex = -1;

    const navigateToResult = (resultElement) => {
      const path = resultElement?.dataset?.resultPath;
      if (path) {
        closeSearch();
        navigateTo(path);
      }
    };

    const updateHighlight = () => {
      const items = resultsContainer.querySelectorAll('.search-result-item');
      items.forEach((item, index) => {
        item.classList.toggle('highlighted', index === highlightIndex);
      });
      if (highlightIndex >= 0 && items[highlightIndex]) {
        items[highlightIndex].scrollIntoView({ block: 'nearest' });
      }
    };

    input.addEventListener('keydown', (e) => {
      const items = resultsContainer.querySelectorAll('.search-result-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightIndex = Math.min(highlightIndex + 1, items.length - 1);
        updateHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightIndex = Math.max(highlightIndex - 1, 0);
        updateHighlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightIndex >= 0 && items[highlightIndex]) {
          navigateToResult(items[highlightIndex]);
        }
      }
    });

    // Debounced search
    const performSearch = debounce(async (query) => {
      if (!query || query.length < 2) {
        resultsContainer.innerHTML = '';
        highlightIndex = -1;
        return;
      }

      try {
        const searchResults = await apiGet(`/search?q=${encodeURIComponent(query)}`);

        // Guard: if search overlay was closed while request was in flight, bail out
        if (!globalSearchOpen || !document.getElementById('global-search-overlay')) return;

        const authors = searchResults?.authors || [];
        const series = searchResults?.series || [];
        const books = searchResults?.books || [];

        if (authors.length === 0 && series.length === 0 && books.length === 0) {
          resultsContainer.innerHTML = `<div class="search-no-results">No results for "${escapeHtml(query)}"</div>`;
          highlightIndex = -1;
          return;
        }

        let html = '';

        if (authors.length > 0) {
          html += `<div class="search-results-group"><div class="search-results-group-label">Authors</div>`;
          for (const author of authors) {
            html += `
              <div class="search-result-item" data-result-path="/author/${author.id}" role="option">
                <div class="result-icon">${Icons.author}</div>
                <div class="result-text">
                  <div class="result-name">${escapeHtml(author.name)}</div>
                  ${author.book_count ? `<div class="result-subtitle">${author.book_count} book${author.book_count !== 1 ? 's' : ''}</div>` : ''}
                </div>
              </div>
            `;
          }
          html += `</div>`;
        }

        if (series.length > 0) {
          html += `<div class="search-results-group"><div class="search-results-group-label">Series</div>`;
          for (const s of series) {
            html += `
              <div class="search-result-item" data-result-path="/series/${s.id}" role="option">
                <div class="result-icon">${Icons.series}</div>
                <div class="result-text">
                  <div class="result-name">${escapeHtml(s.name)}</div>
                  ${s.book_count ? `<div class="result-subtitle">${s.book_count} book${s.book_count !== 1 ? 's' : ''}</div>` : ''}
                </div>
              </div>
            `;
          }
          html += `</div>`;
        }

        if (books.length > 0) {
          html += `<div class="search-results-group"><div class="search-results-group-label">Books</div>`;
          for (const book of books) {
            html += `
              <div class="search-result-item" data-result-path="/book/${book.id}" role="option">
                <div class="result-icon">${Icons.book}</div>
                <div class="result-text">
                  <div class="result-name">${escapeHtml(book.title)}</div>
                  ${(book.author_names && book.author_names.length > 0) ? `<div class="result-subtitle">${escapeHtml(book.author_names.join(', '))}</div>` : ''}
                </div>
              </div>
            `;
          }
          html += `</div>`;
        }

        resultsContainer.innerHTML = html;
        highlightIndex = -1;

        // Bind click on results
        resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
          item.addEventListener('click', () => navigateToResult(item));
        });

      } catch (err) {
        resultsContainer.innerHTML = `<div class="search-no-results">Search failed: ${escapeHtml(err.message)}</div>`;
      }
    }, 300);

    input.addEventListener('input', () => performSearch(input.value.trim()));
  }

  // --- Collections ---

  async function renderCollections() {
    if (!await checkAuth()) return;
    setTitle(['Collections']);
    breadcrumbTrail = [{ label: 'Collections', path: '/collections' }];

    renderShell(`
      <div class="page-header"><h1>Collections</h1></div>
      ${skeletonList(3)}
    `, 'collections');

    try {
      const collections = await apiGet('/collections');
      const collectionsList = Array.isArray(collections) ? collections : (collections?.items || []);

      let bodyContent = `
        <div class="page-header">
          <h1>Collections</h1>
          <div class="actions">
            <button class="btn btn-primary" id="create-collection-btn">${icon('plus', 16)} New Collection</button>
          </div>
        </div>
      `;

      if (collectionsList.length === 0) {
        bodyContent += `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.collection}</div>
            <h3>No collections yet</h3>
            <p>Create a collection to organize books your way.</p>
            <button class="btn btn-primary btn-lg" id="create-collection-empty-btn">${icon('plus', 16)} Create Your First Collection</button>
          </div>
        `;
      } else {
        bodyContent += `<div class="grid grid-collections">`;
        for (const collection of collectionsList) {
          bodyContent += renderCollectionCard(collection);
        }
        bodyContent += `</div>`;
      }

      renderShell(bodyContent, 'collections');

      // Bind
      document.querySelectorAll('[data-collection-id]').forEach(card => {
        const handler = () => navigateTo(`/collection/${card.dataset.collectionId}`);
        card.addEventListener('click', handler);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

      document.getElementById('create-collection-btn')?.addEventListener('click', () => showCreateCollectionModal());
      document.getElementById('create-collection-empty-btn')?.addEventListener('click', () => showCreateCollectionModal());

    } catch (err) {
      renderShell(renderError('Failed to load collections', err.message, () => renderCollections()), 'collections');
    }
  }

  function renderCollectionCard(collection) {
    const bookCount = collection.book_count || 0;
    return `
      <div class="card card-interactive collection-card" data-collection-id="${collection.id}" role="link" tabindex="0" aria-label="${escapeHtml(collection.name)} collection">
        <div class="collection-card-header">
          <div class="collection-card-icon">${Icons.collection}</div>
          ${collection.is_public ? `<span class="badge badge-teal">${icon('globe', 10)} Public</span>` : `<span class="badge badge-muted">${icon('lock', 10)} Private</span>`}
        </div>
        <div class="collection-card-name">${escapeHtml(collection.name)}</div>
        ${collection.description ? `<div class="collection-card-description">${escapeHtml(collection.description)}</div>` : ''}
        <div class="collection-card-footer">
          <span>${bookCount} book${bookCount !== 1 ? 's' : ''}</span>
        </div>
      </div>
    `;
  }

  function showCreateCollectionModal() {
    const { close } = showModal({
      title: 'Create Collection',
      description: 'Organize books into a custom collection.',
      content: `
        <form id="collection-form" novalidate>
          <div class="form-group">
            <label class="form-label" for="collection-name">Name</label>
            <input type="text" class="form-input" id="collection-name" name="name" required placeholder="Reading List" autofocus>
          </div>
          <div class="form-group">
            <label class="form-label" for="collection-description">Description</label>
            <input type="text" class="form-input" id="collection-description" name="description" placeholder="Optional description">
          </div>
          <div class="form-group">
            <label class="form-toggle">
              <input type="checkbox" id="collection-public" name="is_public">
              <span>Make this collection public</span>
            </label>
            <p class="form-hint">Public collections are visible to all users on this server.</p>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Create</button>
          </div>
        </form>
      `,
    });

    const form = document.getElementById('collection-form');
    form.querySelector('[data-action="cancel"]').addEventListener('click', close);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      try {
        const payload = {
          name: document.getElementById('collection-name').value.trim(),
          description: document.getElementById('collection-description').value.trim() || null,
          is_public: document.getElementById('collection-public').checked,
        };
        if (!payload.name) {
          toast('Collection name is required', 'error');
          submitBtn.disabled = false;
          return;
        }
        await apiPost('/collections', payload);
        toast('Collection created!', 'success');
        close();
        renderCollections();
      } catch (err) {
        toast(err.message, 'error');
        submitBtn.disabled = false;
      }
    });
  }

  // --- Collection Detail ---

  async function renderCollectionDetail(collectionId) {
    if (!await checkAuth()) return;

    breadcrumbTrail = [
      { label: 'Collections', path: '/collections' },
      { label: '...', path: `/collection/${collectionId}` },
    ];

    renderShell(`
      <div class="page-header"><h1>Loading...</h1></div>
      ${skeletonCards(6)}
    `, 'collections');

    try {
      const collection = await apiGet(`/collections/${collectionId}`);
      const books = collection.books || [];

      setTitle([collection.name]);
      breadcrumbTrail[1].label = collection.name;

      let bodyContent = `
        <div class="page-header">
          <h1>${escapeHtml(collection.name)}</h1>
          <div class="actions">
            ${collection.is_public ? `<span class="badge badge-teal">${icon('globe', 10)} Public</span>` : `<span class="badge badge-muted">${icon('lock', 10)} Private</span>`}
            <span class="badge badge-teal">${books.length} book${books.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        ${collection.description ? `<p class="text-caption mb-6">${escapeHtml(collection.description)}</p>` : ''}
      `;

      if (books.length === 0) {
        bodyContent += `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.bookOpen}</div>
            <h3>No books in this collection</h3>
            <p>Add books from book detail pages to build this collection.</p>
          </div>
        `;
      } else {
        bodyContent += `<div class="grid grid-books">`;
        for (const book of books) {
          const coverUrl = book.has_cover ? `${API}/books/${book.id}/cover${mediaToken()}` : '';
          bodyContent += `
            <div class="book-card collection-book-card" data-book-id="${book.id}" role="link" tabindex="0" aria-label="${escapeHtml(book.title)}">
              <button class="remove-from-collection" data-remove-book-id="${book.id}" aria-label="Remove ${escapeHtml(book.title)} from collection" title="Remove from collection">
                ${Icons.x}
              </button>
              ${book.series_index ? `<span class="series-badge">#${book.series_index}</span>` : ''}
              ${coverUrl
                ? `<div class="book-cover"><img src="${coverUrl}" alt="" loading="lazy"></div>`
                : `<div class="book-cover-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>`
              }
              <div class="book-title" title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</div>
              <div class="book-meta">${(book.author_names && book.author_names.length > 0) ? escapeHtml(book.author_names.join(', ')) : ''}</div>
            </div>
          `;
        }
        bodyContent += `</div>`;
      }

      renderShell(bodyContent, 'collections');

      // Bind book navigation
      document.querySelectorAll('[data-book-id]').forEach(card => {
        const handler = () => navigateTo(`/book/${card.dataset.bookId}`);
        card.addEventListener('click', (e) => {
          // Don't navigate if clicking the remove button
          if (e.target.closest('.remove-from-collection')) return;
          handler();
        });
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

      // Bind remove buttons
      document.querySelectorAll('.remove-from-collection').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const bookId = btn.dataset.removeBookId;
          showConfirmModal({
            title: 'Remove from Collection',
            message: 'Remove this book from the collection?',
            confirmText: 'Remove',
            onConfirm: async () => {
              try {
                await apiDelete(`/collections/${collectionId}/books/${bookId}`);
                toast('Book removed from collection', 'success');
                renderCollectionDetail(collectionId);
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          });
        });
      });

    } catch (err) {
      renderShell(renderError('Failed to load collection', err.message, () => renderCollectionDetail(collectionId)), 'collections');
    }
  }

  // --- Relative Time ---

  function relativeTime(dateString) {
    if (!dateString) return '';
    const now = Date.now();
    const then = new Date(dateString).getTime();
    const diffSeconds = Math.floor((now - then) / 1000);

    if (diffSeconds < 60) return 'just now';
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths} month${diffMonths !== 1 ? 's' : ''} ago`;
    const diffYears = Math.floor(diffMonths / 12);
    return `${diffYears} year${diffYears !== 1 ? 's' : ''} ago`;
  }

  function formatStorageBytes(bytes) {
    if (bytes == null || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, exponent);
    return `${value.toFixed(exponent > 0 ? 1 : 0)} ${units[exponent]}`;
  }

  function activityIcon(actionType) {
    const actionMap = {
      open: 'bookOpen',
      read: 'bookOpen',
      download: 'download',
      create_collection: 'collection',
      add_to_collection: 'collection',
      remove_from_collection: 'collection',
      login: 'users',
      register: 'users',
      create_library: 'library',
      delete_library: 'trash',
      update_progress: 'clock',
    };
    return actionMap[actionType] || 'activity';
  }

  function activityDescription(entry) {
    const action = entry.action || entry.action_type || '';
    const target = entry.target_title || entry.target || '';
    const descriptionMap = {
      open: `Opened ${target}`,
      read: `Read ${target}`,
      download: `Downloaded ${target}`,
      create_collection: `Created collection ${target}`,
      add_to_collection: `Added ${target} to collection`,
      remove_from_collection: `Removed ${target} from collection`,
      login: 'Signed in',
      register: 'Account created',
      create_library: `Added library ${target}`,
      delete_library: `Removed library ${target}`,
      update_progress: `Updated progress on ${target}`,
    };
    return descriptionMap[action] || `${action} ${target}`.trim() || 'Unknown action';
  }

  // --- Stats Dashboard (owner only) ---

  async function renderStats() {
    if (!await checkAuth()) return;
    // Allow all users to see personal stats; server stats only for owners
    setTitle(['Stats']);
    breadcrumbTrail = [{ label: 'Stats', path: '/stats' }];

    const showServerTab = hasPermission('manage_library');

    renderShell(`
      <div class="page-header"><h1>Stats</h1></div>
      <div class="stats-grid">
        ${Array(8).fill('<div class="skeleton stat-card-skeleton" style="height:100px;border-radius:var(--radius-lg)"></div>').join('')}
      </div>
    `, 'stats');

    try {
      const stats = showServerTab ? await apiGet('/stats') : {};

      const statCards = [
        { label: 'Total Books', value: stats.total_books ?? 0, iconName: 'book', color: 'var(--color-teal-bright)' },
        { label: 'Authors', value: stats.total_authors ?? 0, iconName: 'author', color: 'var(--color-teal-bright)' },
        { label: 'Series', value: stats.total_series ?? 0, iconName: 'series', color: 'var(--color-teal-bright)' },
        { label: 'Users', value: stats.total_users ?? 0, iconName: 'users', color: 'var(--color-info)' },
        { label: 'Libraries', value: stats.total_libraries ?? 0, iconName: 'library', color: 'var(--color-info)' },
        { label: 'Books Read', value: stats.books_read ?? 0, iconName: 'check', color: 'var(--color-success)' },
        { label: 'Active Readers', value: stats.active_readers ?? 0, iconName: 'eye', color: 'var(--color-success)' },
        { label: 'Storage', value: formatStorageBytes(stats.storage_bytes), iconName: 'hardDrive', color: 'var(--color-warning)' },
      ];

      let bodyContent = `
        <div class="page-header"><h1>Stats</h1></div>
        <div class="tab-nav" id="stats-tabs">
          <button class="tab-nav-item active" data-tab="personal">My Reading</button>
          ${showServerTab ? '<button class="tab-nav-item" data-tab="server">Server</button>' : ''}
        </div>
        <div class="tab-panel active" id="personal-stats-panel" data-tab-panel="personal">
          <div style="padding:var(--space-4);text-align:center;color:var(--color-muted);font-size:var(--text-sm)">Loading personal stats...</div>
        </div>
        ${showServerTab ? `<div class="tab-panel" data-tab-panel="server">` : '<div style="display:none">'}
        <div class="stats-grid">
          ${statCards.map(card => `
            <div class="card stat-card">
              <div class="stat-card-icon" style="color:${card.color};background:${card.color}15">
                ${icon(card.iconName, 22)}
              </div>
              <div class="stat-card-value">${typeof card.value === 'number' ? card.value.toLocaleString() : escapeHtml(String(card.value))}</div>
              <div class="stat-card-label">${escapeHtml(card.label)}</div>
            </div>
          `).join('')}
        </div>
      `;

      // Popular books
      const popularBooks = stats.popular_books || [];
      if (popularBooks.length > 0) {
        bodyContent += `
          <div class="dashboard-section mt-6">
            <div class="dashboard-section-header">
              <h2>${icon('star', 22)} Popular Books</h2>
            </div>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th style="width:50px">#</th>
                    <th>Title</th>
                    <th style="text-align:right">Opens</th>
                  </tr>
                </thead>
                <tbody>
                  ${popularBooks.map((popularBook, index) => `
                    <tr>
                      <td><span class="badge badge-teal">${index + 1}</span></td>
                      <td>
                        <a href="#/book/${popularBook.id || ''}" style="font-weight:var(--weight-medium)">${escapeHtml(popularBook.title || 'Unknown')}</a>
                        ${popularBook.author ? `<div class="text-caption">${escapeHtml(popularBook.author)}</div>` : ''}
                      </td>
                      <td style="text-align:right;font-family:var(--font-mono);font-size:var(--text-sm)">${popularBook.opens ?? popularBook.count ?? 0}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      }

      // Recent server activity
      const recentActivity = stats.recent_activity || [];
      if (recentActivity.length > 0) {
        bodyContent += `
          <div class="dashboard-section mt-6">
            <div class="dashboard-section-header">
              <h2>${icon('activity', 22)} Recent Server Activity</h2>
            </div>
            <div class="activity-timeline">
              ${recentActivity.map(entry => `
                <div class="activity-entry">
                  <div class="activity-entry-icon" style="background:var(--color-teal-dim);color:var(--color-teal-bright)">
                    ${icon(activityIcon(entry.action || entry.action_type), 16)}
                  </div>
                  <div class="activity-entry-content">
                    <div class="activity-entry-description">
                      ${entry.username ? `<strong>${escapeHtml(entry.username)}</strong> ` : ''}${escapeHtml(activityDescription(entry))}
                    </div>
                    <div class="activity-entry-time">${relativeTime(entry.timestamp || entry.created_at)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      bodyContent += `</div>`; // close server tab panel

      renderShell(bodyContent, 'stats');

      // Bind tab switching
      document.querySelectorAll('#stats-tabs .tab-nav-item').forEach(tab => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('#stats-tabs .tab-nav-item').forEach(tabItem => tabItem.classList.remove('active'));
          tab.classList.add('active');
          document.querySelectorAll('[data-tab-panel]').forEach(panel => {
            panel.classList.toggle('active', panel.dataset.tabPanel === tab.dataset.tab);
          });
        });
      });

      // Load personal stats
      renderPersonalStats();
    } catch (err) {
      renderShell(renderError('Failed to load stats', err.message, () => renderStats()), 'stats');
    }
  }

  // --- Activity Feed ---

  async function renderActivity() {
    if (!await checkAuth()) return;
    setTitle(['Activity']);
    breadcrumbTrail = [{ label: 'Activity', path: '/activity' }];

    renderShell(`
      <div class="page-header"><h1>Activity</h1></div>
      ${skeletonList(8)}
    `, 'activity');

    try {
      const activityData = await apiGet('/activity');
      const entries = Array.isArray(activityData) ? activityData : (activityData?.items || []);

      let bodyContent = `
        <div class="page-header">
          <h1>Your Activity</h1>
        </div>
      `;

      if (entries.length === 0) {
        bodyContent += `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.activity}</div>
            <h3>No activity yet</h3>
            <p>Your reading history and actions will appear here.</p>
          </div>
        `;
      } else {
        bodyContent += `
          <div class="activity-timeline">
            ${entries.map(entry => `
              <div class="activity-entry">
                <div class="activity-entry-icon" style="background:var(--color-teal-dim);color:var(--color-teal-bright)">
                  ${icon(activityIcon(entry.action || entry.action_type), 16)}
                </div>
                <div class="activity-entry-content">
                  <div class="activity-entry-description">${escapeHtml(activityDescription(entry))}</div>
                  <div class="activity-entry-time">${relativeTime(entry.timestamp || entry.created_at)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }

      renderShell(bodyContent, 'activity');
    } catch (err) {
      renderShell(renderError('Failed to load activity', err.message, () => renderActivity()), 'activity');
    }
  }

  // --- Metadata Enrichment Modal ---

  async function showMetadataSearchModal(bookId) {
    const { overlay, close } = showModal({
      title: 'Enrich Metadata',
      description: 'Searching for metadata matches...',
      content: `
        <div class="metadata-search-loading">
          <div class="progress-bar progress-bar-indeterminate" style="margin:var(--space-4) 0">
            <div class="progress-bar-fill"></div>
          </div>
          <p class="text-caption text-center">Querying external providers...</p>
        </div>
      `,
    });

    try {
      const searchResults = await apiGet(`/books/${bookId}/metadata/search`);
      const matches = searchResults?.matches || searchResults || [];

      const contentContainer = overlay.querySelector('.modal-content');
      if (!contentContainer) return;

      if (matches.length === 0) {
        contentContainer.innerHTML = `
          <div class="empty-state" style="padding:var(--space-8) 0">
            <div class="empty-state-icon" style="width:48px;height:48px">${Icons.search}</div>
            <h3>No matches found</h3>
            <p>No metadata was found from external providers for this book.</p>
          </div>
        `;
        return;
      }

      // Update description
      const descriptionElement = overlay.querySelector('.modal-description');
      if (descriptionElement) descriptionElement.textContent = `Found ${matches.length} match${matches.length !== 1 ? 'es' : ''}. Select one to apply.`;

      let matchesHtml = `
        <button class="btn btn-primary btn-sm mb-4" id="apply-best-metadata">
          ${icon('zap', 14)} Apply Best Match
        </button>
        <div class="metadata-matches">
      `;

      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const providerName = match.provider || match.source || 'Unknown';
        const confidence = match.confidence != null ? Math.round(match.confidence * 100) : null;
        const providerClass = providerName.toLowerCase().includes('google') ? 'badge-info' : 'badge-success';

        matchesHtml += `
          <div class="metadata-match-card card">
            <div class="metadata-match-header">
              <div class="metadata-match-info">
                <span class="badge ${providerClass}">${escapeHtml(providerName)}</span>
                ${confidence != null ? `<span class="badge badge-muted">${confidence}% match</span>` : ''}
              </div>
              <button class="btn btn-primary btn-sm apply-metadata-btn" data-match-index="${i}">Apply</button>
            </div>
            ${match.thumbnail || match.cover_url ? `
              <div class="metadata-match-cover">
                <img src="${escapeHtml(match.thumbnail || match.cover_url)}" alt="" loading="lazy">
              </div>
            ` : ''}
            <div class="metadata-match-title">${escapeHtml(match.title || 'No title')}</div>
            ${match.authors ? `<div class="text-caption">${escapeHtml(Array.isArray(match.authors) ? match.authors.join(', ') : match.authors)}</div>` : ''}
            ${match.description ? `<div class="metadata-match-description">${escapeHtml(match.description.length > 200 ? match.description.slice(0, 200) + '...' : match.description)}</div>` : ''}
          </div>
        `;
      }

      matchesHtml += `</div>`;
      contentContainer.innerHTML = matchesHtml;

      // Widen modal for metadata results
      const modalElement = overlay.querySelector('.modal');
      if (modalElement) modalElement.style.maxWidth = '600px';

      // Bind apply buttons
      contentContainer.querySelectorAll('.apply-metadata-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = 'Applying...';
          try {
            await apiPost(`/books/${bookId}/metadata/apply`, { match_index: parseInt(btn.dataset.matchIndex) });
            toast('Metadata applied successfully', 'success');
            close();
            renderBook(bookId);
          } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Apply';
          }
        });
      });

      // Bind apply best
      document.getElementById('apply-best-metadata')?.addEventListener('click', async () => {
        const bestButton = document.getElementById('apply-best-metadata');
        bestButton.disabled = true;
        bestButton.textContent = 'Applying...';
        try {
          await apiPost(`/books/${bookId}/metadata/apply`, { match_index: 0 });
          toast('Best metadata applied successfully', 'success');
          close();
          renderBook(bookId);
        } catch (err) {
          toast(err.message, 'error');
          bestButton.disabled = false;
          bestButton.innerHTML = `${icon('zap', 14)} Apply Best Match`;
        }
      });
    } catch (err) {
      const contentContainer = overlay.querySelector('.modal-content');
      if (contentContainer) {
        contentContainer.innerHTML = `
          <div class="error-state" style="padding:var(--space-6) 0;background:transparent;border:0">
            <div class="error-state-icon" style="width:40px;height:40px">${Icons.alertCircle}</div>
            <h3>Search failed</h3>
            <p>${escapeHtml(err.message)}</p>
          </div>
        `;
      }
    }
  }

  // --- Add to Collection (on book detail) ---

  function renderAddToCollectionButton(bookId) {
    return `
      <div class="add-to-collection-wrap" id="add-to-collection-wrap">
        <button class="btn btn-secondary" id="add-to-collection-btn" aria-haspopup="true" aria-expanded="false">
          ${icon('collection', 16)} Add to Collection
        </button>
      </div>
    `;
  }

  async function bindAddToCollectionButton(bookId) {
    const wrap = document.getElementById('add-to-collection-wrap');
    const btn = document.getElementById('add-to-collection-btn');
    if (!wrap || !btn) return;

    let dropdownOpen = false;

    const closeDropdown = () => {
      const existing = wrap.querySelector('.add-to-collection-dropdown');
      if (existing) existing.remove();
      btn.setAttribute('aria-expanded', 'false');
      dropdownOpen = false;
    };

    btn.addEventListener('click', async () => {
      if (dropdownOpen) {
        closeDropdown();
        return;
      }

      dropdownOpen = true;
      btn.setAttribute('aria-expanded', 'true');

      // Fetch user's collections
      let collections = [];
      try {
        const response = await apiGet('/collections');
        collections = Array.isArray(response) ? response : (response?.items || []);
      } catch { /* ignore */ }

      const dropdown = document.createElement('div');
      dropdown.className = 'add-to-collection-dropdown';
      dropdown.setAttribute('role', 'listbox');

      let dropdownHtml = '';
      if (collections.length > 0) {
        for (const collection of collections) {
          dropdownHtml += `
            <button class="dropdown-item" data-add-collection-id="${collection.id}" role="option">
              <span class="nav-icon" style="width:16px;height:16px">${Icons.collection}</span>
              ${escapeHtml(collection.name)}
            </button>
          `;
        }
        dropdownHtml += `<div class="dropdown-divider"></div>`;
      }
      dropdownHtml += `
        <button class="dropdown-item" id="dropdown-new-collection" role="option">
          <span class="nav-icon" style="width:16px;height:16px">${Icons.plus}</span>
          New Collection...
        </button>
      `;

      dropdown.innerHTML = dropdownHtml;
      wrap.appendChild(dropdown);

      // Bind add-to-collection items
      dropdown.querySelectorAll('[data-add-collection-id]').forEach(item => {
        item.addEventListener('click', async () => {
          const collectionId = item.dataset.addCollectionId;
          try {
            await apiPost(`/collections/${collectionId}/books`, { book_id: bookId });
            toast('Book added to collection', 'success');
          } catch (err) {
            toast(err.message, 'error');
          }
          closeDropdown();
        });
      });

      // Bind new collection
      dropdown.querySelector('#dropdown-new-collection')?.addEventListener('click', () => {
        closeDropdown();
        showCreateCollectionModal();
      });

      // Close on outside click
      const outsideClickHandler = (e) => {
        if (!wrap.contains(e.target)) {
          closeDropdown();
          document.removeEventListener('click', outsideClickHandler);
        }
      };
      setTimeout(() => document.addEventListener('click', outsideClickHandler), 0);
    });
  }

  // --- Helpers ---

  function renderBookCard(book, showSeriesIndex = false) {
    const coverUrl = book.has_cover ? `${API}/books/${book.id}/cover${mediaToken()}` : '';
    const statusOverlay = readingStatusOverlay(book.id);
    return `
      <div class="book-card" data-book-id="${book.id}" role="link" tabindex="0" aria-label="${escapeHtml(book.title)}">
        ${showSeriesIndex && book.series_index ? `<span class="series-badge">#${book.series_index}</span>` : ''}
        ${coverUrl
          ? `<div class="book-cover"><img src="${coverUrl}" alt="" loading="lazy">${statusOverlay}</div>`
          : `<div class="book-cover-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>${statusOverlay}</div>`
        }
        <div class="book-title" title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</div>
        <div class="book-meta">${(book.author_names && book.author_names.length > 0) ? escapeHtml(book.author_names.join(', ')) : ''}</div>
      </div>
    `;
  }

  function renderError(title, message, retryFn) {
    return `
      <div class="error-state">
        <div class="error-state-icon">${Icons.alertCircle}</div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <button class="btn btn-primary" id="retry-btn">${icon('refresh', 16)} Try Again</button>
      </div>
    `;
  }

  // ============================================================
  // New Feature Pages
  // ============================================================

  // --- Star Rating Widget Helper ---

  function renderStarRatingWidget(currentValue = 0, options = {}) {
    const { readonly = false, widgetId = 'star-rating' } = options;
    // currentValue is 1-10 mapped to 5 stars (half-star increments)
    const starCount = 5;
    const normalizedValue = Math.max(0, Math.min(10, currentValue));

    let starsHtml = '';
    for (let i = 1; i <= starCount; i++) {
      const fullThreshold = i * 2;
      const halfThreshold = fullThreshold - 1;
      let starClass = '';
      if (normalizedValue >= fullThreshold) {
        starClass = 'filled';
      } else if (normalizedValue >= halfThreshold) {
        starClass = 'half';
      }
      starsHtml += `<button type="button" class="star-btn ${starClass}" data-star-value="${fullThreshold}" aria-label="Rate ${i} star${i !== 1 ? 's' : ''}" ${readonly ? 'tabindex="-1"' : ''}>&#9733;</button>`;
    }

    return `<div class="star-rating-widget ${readonly ? 'readonly' : ''}" id="${widgetId}" data-value="${normalizedValue}" role="radiogroup" aria-label="Rating">${starsHtml}</div>`;
  }

  function bindStarRatingWidget(containerId, onChange) {
    const widget = document.getElementById(containerId);
    if (!widget || widget.classList.contains('readonly')) return;

    widget.querySelectorAll('.star-btn').forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        const hoverValue = parseInt(btn.dataset.starValue);
        widget.querySelectorAll('.star-btn').forEach(starButton => {
          const starButtonValue = parseInt(starButton.dataset.starValue);
          starButton.classList.toggle('hovered', starButtonValue <= hoverValue);
        });
      });

      btn.addEventListener('mouseleave', () => {
        widget.querySelectorAll('.star-btn').forEach(starButton => {
          starButton.classList.remove('hovered');
        });
      });

      btn.addEventListener('click', () => {
        const clickedValue = parseInt(btn.dataset.starValue);
        const currentStored = parseInt(widget.dataset.value) || 0;
        // Click same star toggles between full and half
        let newValue = clickedValue;
        if (currentStored === clickedValue) {
          newValue = clickedValue - 1; // half star
        } else if (currentStored === clickedValue - 1) {
          newValue = 0; // clear
        }
        widget.dataset.value = newValue;
        // Update visual state
        widget.querySelectorAll('.star-btn').forEach(starButton => {
          const starButtonValue = parseInt(starButton.dataset.starValue);
          starButton.classList.remove('filled', 'half');
          if (newValue >= starButtonValue) {
            starButton.classList.add('filled');
          } else if (newValue >= starButtonValue - 1 && newValue % 2 !== 0) {
            starButton.classList.add('half');
          }
        });
        if (onChange) onChange(newValue);
      });
    });
  }

  // --- Genre Color Helper ---

  function genreColorFromName(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 55%, 40%)`;
  }

  // --- Reading Preferences (localStorage) ---

  function getReaderPreferences() {
    try {
      const stored = localStorage.getItem('ironshelf_reader_prefs');
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return { theme: 'dark', fontSize: 16, direction: 'ltr' };
  }

  function setReaderPreferences(prefs) {
    localStorage.setItem('ironshelf_reader_prefs', JSON.stringify(prefs));
  }

  // ============================================================
  // 1. Ratings + Reviews on Book Detail
  // ============================================================

  async function renderBookRatingsAndReviews(bookId, containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    let ratingsHtml = '';

    try {
      const [ratingsData, reviewsData] = await Promise.all([
        apiGet(`/books/${bookId}/ratings`).catch(() => null),
        apiGet(`/books/${bookId}/reviews`).catch(() => []),
      ]);

      const averageRating = ratingsData?.average_rating || 0;
      const totalRatings = ratingsData?.total_ratings || 0;
      const userRating = ratingsData?.user_rating || 0;
      const reviews = Array.isArray(reviewsData) ? reviewsData : (reviewsData?.items || []);

      // Rating section
      ratingsHtml += `
        <div class="reviews-section" id="ratings-reviews-section">
          <h3>${icon('star', 20)} Ratings & Reviews</h3>

          <div class="rating-summary">
            <div class="rating-summary-value">${averageRating ? (averageRating / 2).toFixed(1) : '—'}</div>
            <div>
              ${renderStarRatingWidget(averageRating, { readonly: true, widgetId: 'book-avg-rating' })}
              <div class="rating-summary-meta">${totalRatings} rating${totalRatings !== 1 ? 's' : ''}</div>
            </div>
          </div>

          <div style="margin-bottom:var(--space-6)">
            <p class="text-caption mb-4">Your rating</p>
            ${renderStarRatingWidget(userRating, { readonly: false, widgetId: 'user-rating-widget' })}
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-4)">
            <h4>Reviews (${reviews.length})</h4>
            <button class="btn btn-primary btn-sm" id="write-review-btn">${icon('edit', 14)} Write Review</button>
          </div>

          <div id="reviews-list">
      `;

      if (reviews.length === 0) {
        ratingsHtml += `<p class="text-caption" style="padding:var(--space-4)">No reviews yet. Be the first to share your thoughts.</p>`;
      } else {
        for (const review of reviews) {
          ratingsHtml += renderReviewCard(review, bookId);
        }
      }

      ratingsHtml += `</div></div>`;
    } catch {
      ratingsHtml = '';
    }

    container.insertAdjacentHTML('beforeend', ratingsHtml);

    // Bind user rating widget
    bindStarRatingWidget('user-rating-widget', async (newValue) => {
      try {
        await apiPost(`/books/${bookId}/ratings`, { rating: newValue });
        toast('Rating saved', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    // Bind write review
    document.getElementById('write-review-btn')?.addEventListener('click', () => {
      showWriteReviewModal(bookId);
    });

    // Bind edit/delete review buttons
    bindReviewActions(bookId);

    // Bind spoiler toggles
    document.querySelectorAll('.spoiler-hidden').forEach(el => {
      el.addEventListener('click', () => el.classList.add('revealed'));
    });
  }

  function renderReviewCard(review, bookId) {
    const reviewUserInitial = (review.username || '?').charAt(0).toUpperCase();
    const isOwnReview = currentUser && (review.user_id === currentUser.id || review.username === currentUser.username);
    const reviewRating = review.rating || 0;

    return `
      <div class="card review-card" data-review-id="${review.id}">
        <div class="review-card-header">
          <div class="review-card-user">
            <div class="user-avatar">${reviewUserInitial}</div>
            <div>
              <div class="username">${escapeHtml(review.username || 'Anonymous')}</div>
              <div class="review-date">${relativeTime(review.created_at)}</div>
            </div>
            ${reviewRating ? renderStarRatingWidget(reviewRating, { readonly: true, widgetId: `review-stars-${review.id}` }) : ''}
          </div>
          ${isOwnReview ? `
            <div class="review-card-actions">
              <button class="btn btn-ghost btn-sm edit-review-btn" data-review-id="${review.id}" aria-label="Edit review">${icon('edit', 14)}</button>
              <button class="btn btn-ghost btn-sm delete-review-btn" data-review-id="${review.id}" aria-label="Delete review">${icon('trash', 14)}</button>
            </div>
          ` : ''}
        </div>
        ${review.is_spoiler ? `<div class="spoiler-tag">${icon('warning', 12)} Contains spoilers</div>` : ''}
        ${review.title ? `<div class="review-title">${escapeHtml(review.title)}</div>` : ''}
        <div class="review-body ${review.is_spoiler ? 'spoiler-hidden' : ''}">${escapeHtml(review.body || '')}</div>
      </div>
    `;
  }

  function bindReviewActions(bookId) {
    document.querySelectorAll('.edit-review-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const reviewId = btn.dataset.reviewId;
        try {
          const review = await apiGet(`/reviews/${reviewId}`).catch(() => null);
          showWriteReviewModal(bookId, review);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });

    document.querySelectorAll('.delete-review-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const reviewId = btn.dataset.reviewId;
        showConfirmModal({
          title: 'Delete Review',
          message: 'Are you sure you want to delete your review? This cannot be undone.',
          confirmText: 'Delete',
          onConfirm: async () => {
            try {
              await apiDelete(`/reviews/${reviewId}`);
              toast('Review deleted', 'success');
              renderBook(bookId);
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        });
      });
    });
  }

  function showWriteReviewModal(bookId, existingReview = null) {
    const isEditing = !!existingReview;
    const { close } = showModal({
      title: isEditing ? 'Edit Review' : 'Write a Review',
      content: `
        <form id="review-form" novalidate>
          <div class="form-group">
            <label class="form-label">Rating</label>
            ${renderStarRatingWidget(existingReview?.rating || 0, { widgetId: 'review-modal-rating' })}
          </div>
          <div class="form-group">
            <label class="form-label" for="review-title-input">Title</label>
            <input type="text" class="form-input" id="review-title-input" placeholder="Sum up your thoughts" value="${existingReview ? escapeHtml(existingReview.title || '') : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="review-body-input">Review</label>
            <textarea class="form-input" id="review-body-input" rows="6" placeholder="What did you think of this book?" style="resize:vertical">${existingReview ? escapeHtml(existingReview.body || '') : ''}</textarea>
          </div>
          <div class="form-group">
            <label class="form-toggle">
              <input type="checkbox" id="review-spoiler-checkbox" ${existingReview?.is_spoiler ? 'checked' : ''}>
              <span>Contains spoilers</span>
            </label>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">${isEditing ? 'Save Changes' : 'Submit Review'}</button>
          </div>
        </form>
      `,
    });

    bindStarRatingWidget('review-modal-rating', () => {});
    const form = document.getElementById('review-form');
    form.querySelector('[data-action="cancel"]').addEventListener('click', close);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      const ratingWidget = document.getElementById('review-modal-rating');
      const payload = {
        rating: parseInt(ratingWidget?.dataset.value) || 0,
        title: document.getElementById('review-title-input').value.trim(),
        body: document.getElementById('review-body-input').value.trim(),
        is_spoiler: document.getElementById('review-spoiler-checkbox').checked,
      };

      if (!payload.body && !payload.rating) {
        toast('Please add a rating or write a review', 'error');
        submitBtn.disabled = false;
        return;
      }

      try {
        if (isEditing) {
          await apiPatch(`/reviews/${existingReview.id}`, payload);
          toast('Review updated', 'success');
        } else {
          await apiPost(`/books/${bookId}/reviews`, payload);
          toast('Review submitted', 'success');
        }
        close();
        renderBook(bookId);
      } catch (err) {
        toast(err.message, 'error');
        submitBtn.disabled = false;
      }
    });
  }

  // ============================================================
  // My Books — reading-status shelves across all libraries
  // ============================================================

  let myBooksStatus = 'reading';
  let myBooksLibraryId = 'all';

  async function renderMyBooks() {
    if (!await checkAuth()) return;
    const thisGeneration = navigationGeneration;
    setTitle(['My Books']);
    breadcrumbTrail = [{ label: 'My Books', path: '/mybooks' }];

    renderShell(`
      <div class="page-header"><h1>My Books</h1></div>
      ${skeletonCards(8)}
    `, 'mybooks');

    try {
      await loadReadingStates();
      const librariesResponse = await apiGet('/libraries');
      if (isStaleNavigation(thisGeneration)) return;
      const libraries = Array.isArray(librariesResponse) ? librariesResponse : (librariesResponse?.items || []);

      // Validate sticky library scope still exists.
      if (myBooksLibraryId !== 'all' && !libraries.some(lib => String(lib.id) === String(myBooksLibraryId))) {
        myBooksLibraryId = 'all';
      }

      // Fetch the chosen status across the chosen scope. Pull a generous page so
      // most personal libraries render fully; note if more remains.
      const targetLibraries = myBooksLibraryId === 'all'
        ? libraries
        : libraries.filter(lib => String(lib.id) === String(myBooksLibraryId));

      let books = [];
      let truncated = false;
      for (const lib of targetLibraries) {
        const params = new URLSearchParams({ page: 1, per_page: 200, status: myBooksStatus, sort: 'sort_title', dir: 'asc' });
        try {
          const response = await apiGet(`/libraries/${lib.id}/books?${params}`);
          if (isStaleNavigation(thisGeneration)) return;
          const libBooks = Array.isArray(response) ? response : (response?.items || []);
          books = books.concat(libBooks);
          if ((response?.total_pages || 1) > 1) truncated = true;
        } catch {
          // skip a library that fails; others still render
        }
      }

      // Reading shelf: order by furthest-read recency feel — keep title sort for
      // the others, but reading is more useful most-progressed first.
      if (myBooksStatus === 'reading') {
        books.sort((a, b) => bookProgressPercent(b.id) - bookProgressPercent(a.id));
      }

      const libraryOptions = [`<option value="all" ${myBooksLibraryId === 'all' ? 'selected' : ''}>All libraries</option>`]
        .concat(libraries.map(lib => `<option value="${lib.id}" ${String(lib.id) === String(myBooksLibraryId) ? 'selected' : ''}>${escapeHtml(lib.name)}</option>`))
        .join('');

      let body = `
        <div class="page-header">
          <h1>My Books</h1>
          <div class="actions">
            <select id="mybooks-library-scope" class="form-input" aria-label="Library scope" style="min-width:180px">
              ${libraryOptions}
            </select>
          </div>
        </div>
        ${renderReadingStatusTabsMyBooks(myBooksStatus)}
      `;

      if (books.length === 0) {
        const emptyLabel = { reading: "You're not reading anything yet", finished: 'No finished books yet', unread: 'No unread books' }[myBooksStatus] || 'No books';
        const emptyHint = myBooksStatus === 'reading'
          ? 'Open a book to start tracking your progress here.'
          : (myBooksStatus === 'finished' ? 'Books you finish (or mark as read) show up here.' : 'Everything you have not started appears here.');
        body += `<div class="empty-state"><div class="empty-state-icon">${Icons.bookOpen || ''}</div><h3>${emptyLabel}</h3><p>${emptyHint}</p></div>`;
      } else {
        body += `<div class="grid grid-books" id="mybooks-grid">${books.map(bookItem => renderBookCard(bookItem)).join('')}</div>`;
        if (truncated) {
          body += `<p class="text-caption" style="text-align:center;color:var(--color-muted);margin-top:var(--space-4)">Showing the first ${books.length}. Open a specific library to browse the rest.</p>`;
        }
      }

      renderShell(body, 'mybooks');

      // Bind status tabs
      document.querySelectorAll('.status-tabs[data-status-group="mybooks"] .status-tab').forEach((tabButton) => {
        tabButton.addEventListener('click', () => {
          const nextStatus = tabButton.dataset.statusValue;
          if (nextStatus === myBooksStatus) return;
          myBooksStatus = nextStatus;
          renderMyBooks();
        });
      });

      // Bind library scope
      document.getElementById('mybooks-library-scope')?.addEventListener('change', (e) => {
        myBooksLibraryId = e.target.value;
        renderMyBooks();
      });

      // Bind cards
      document.querySelectorAll('#mybooks-grid .book-card').forEach((card) => {
        const openBook = () => navigateTo(`/book/${card.dataset.bookId}`);
        card.addEventListener('click', openBook);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBook(); } });
      });
    } catch (err) {
      renderShell(renderError('Failed to load your books', err.message, renderMyBooks), 'mybooks');
    }
  }

  // My Books uses Reading | Finished | Unread (no "All" — that's the library view).
  function renderReadingStatusTabsMyBooks(active) {
    const tabs = [
      { value: 'reading', label: 'Reading' },
      { value: 'finished', label: 'Finished' },
      { value: 'unread', label: 'Unread' },
    ];
    return `<div class="status-tabs" role="tablist" data-status-group="mybooks">
      ${tabs.map(tab => `
        <button class="status-tab ${tab.value === active ? 'is-active' : ''}" role="tab"
          aria-selected="${tab.value === active}" data-status-value="${tab.value}">${tab.label}</button>
      `).join('')}
    </div>`;
  }

  // ============================================================
  // 2. Reading Queue
  // ============================================================

  async function renderReadingQueue() {
    if (!await checkAuth()) return;
    setTitle(['Reading Queue']);
    breadcrumbTrail = [{ label: 'Reading Queue', path: '/queue' }];

    renderShell(`
      <div class="page-header"><h1>Reading Queue</h1></div>
      ${skeletonList(5)}
    `, 'queue');

    try {
      const queueData = await apiGet('/me/queue');
      const queueItems = Array.isArray(queueData) ? queueData : (queueData?.items || []);

      let bodyContent = `
        <div class="page-header">
          <h1>Reading Queue</h1>
          <div class="actions">
            <span class="badge badge-teal">${queueItems.length} book${queueItems.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      `;

      if (queueItems.length === 0) {
        bodyContent += `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.clock}</div>
            <h3>Your queue is empty</h3>
            <p>Add books to your reading queue from any book detail page.</p>
            <a href="#/libraries" class="btn btn-primary btn-lg">Browse Libraries</a>
          </div>
        `;
      } else {
        bodyContent += `<div class="queue-list" id="queue-list">`;
        for (let i = 0; i < queueItems.length; i++) {
          const queueItem = queueItems[i];
          const coverUrl = queueItem.has_cover ? `${API}/books/${queueItem.book_id || queueItem.id}/cover${mediaToken()}` : '';
          bodyContent += `
            <div class="queue-item" data-queue-id="${queueItem.id}" data-queue-position="${i}" draggable="true">
              <div class="queue-item-drag" aria-label="Drag to reorder" title="Drag to reorder">
                ${Icons.menu}
              </div>
              <div class="queue-item-position">${i + 1}</div>
              <div class="queue-item-cover">
                ${coverUrl ? `<img src="${coverUrl}" alt="" loading="lazy">` : `<div style="width:100%;height:100%;background:var(--color-surface-active);display:flex;align-items:center;justify-content:center;color:var(--color-muted)">${Icons.book}</div>`}
              </div>
              <div class="queue-item-info" role="link" tabindex="0" data-navigate-book="${queueItem.book_id || queueItem.id}">
                <div class="queue-item-title">${escapeHtml(queueItem.title || 'Unknown')}</div>
                <div class="queue-item-author">${queueItem.authors ? escapeHtml(Array.isArray(queueItem.authors) ? queueItem.authors.join(', ') : queueItem.authors) : ''}</div>
              </div>
              <div class="queue-item-actions">
                <button class="btn btn-ghost btn-icon queue-move-up" ${i === 0 ? 'disabled' : ''} data-queue-id="${queueItem.id}" aria-label="Move up" title="Move up">
                  ${Icons.arrowUp}
                </button>
                <button class="btn btn-ghost btn-icon queue-move-down" ${i === queueItems.length - 1 ? 'disabled' : ''} data-queue-id="${queueItem.id}" aria-label="Move down" title="Move down">
                  ${Icons.arrowDown}
                </button>
                <button class="btn btn-ghost btn-icon queue-remove" data-queue-id="${queueItem.id}" aria-label="Remove from queue" title="Remove">
                  ${Icons.x}
                </button>
              </div>
            </div>
          `;
        }
        bodyContent += `</div>`;
      }

      renderShell(bodyContent, 'queue');

      // Bind navigate to book
      document.querySelectorAll('[data-navigate-book]').forEach(el => {
        const handler = () => navigateTo(`/book/${el.dataset.navigateBook}`);
        el.addEventListener('click', handler);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

      // Bind move up/down
      document.querySelectorAll('.queue-move-up').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await apiPatch(`/me/queue/${btn.dataset.queueId}/move`, { direction: 'up' });
            renderReadingQueue();
          } catch (err) { toast(err.message, 'error'); }
        });
      });

      document.querySelectorAll('.queue-move-down').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await apiPatch(`/me/queue/${btn.dataset.queueId}/move`, { direction: 'down' });
            renderReadingQueue();
          } catch (err) { toast(err.message, 'error'); }
        });
      });

      // Bind remove
      document.querySelectorAll('.queue-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await apiDelete(`/me/queue/${btn.dataset.queueId}`);
            toast('Removed from queue', 'success');
            renderReadingQueue();
          } catch (err) { toast(err.message, 'error'); }
        });
      });

      // Simple drag-and-drop reorder
      bindQueueDragReorder();

    } catch (err) {
      renderShell(renderError('Failed to load reading queue', err.message, () => renderReadingQueue()), 'queue');
    }
  }

  function bindQueueDragReorder() {
    const list = document.getElementById('queue-list');
    if (!list) return;

    let draggedItem = null;

    list.addEventListener('dragstart', (e) => {
      draggedItem = e.target.closest('.queue-item');
      if (draggedItem) {
        draggedItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      }
    });

    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      const afterElement = getDragAfterElement(list, e.clientY);
      if (afterElement) {
        list.insertBefore(draggedItem, afterElement);
      } else {
        list.appendChild(draggedItem);
      }
    });

    list.addEventListener('dragend', async () => {
      if (draggedItem) {
        draggedItem.classList.remove('dragging');
        // Collect new order
        const newOrder = [...list.querySelectorAll('.queue-item')].map(item => item.dataset.queueId);
        draggedItem = null;
        // Update positions visually
        list.querySelectorAll('.queue-item-position').forEach((pos, idx) => { pos.textContent = idx + 1; });
        // Send new order to server
        try {
          await apiPost('/me/queue/reorder', { order: newOrder });
        } catch (err) {
          toast(err.message, 'error');
          renderReadingQueue();
        }
      }
    });
  }

  function getDragAfterElement(container, y) {
    const items = [...container.querySelectorAll('.queue-item:not(.dragging)')];
    return items.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  // ============================================================
  // 3. Reading Goals & Stats (Personal Tab)
  // ============================================================

  async function renderPersonalStats() {
    // Called as a tab inside renderStats
    const tabPanel = document.getElementById('personal-stats-panel');
    if (!tabPanel) return;

    tabPanel.innerHTML = `<div style="padding:var(--space-4);text-align:center;color:var(--color-muted);font-size:var(--text-sm)">Loading personal stats...</div>`;

    try {
      const personalStats = await apiGet('/me/stats').catch(() => ({}));
      const readingGoal = await apiGet('/me/reading-goal').catch(() => null);
      const currentYear = new Date().getFullYear();

      let html = '';

      // Reading Goal
      const goalTarget = readingGoal?.target || 0;
      const goalCompleted = readingGoal?.completed || personalStats.books_completed_this_year || 0;
      const goalPercent = goalTarget > 0 ? Math.min(100, Math.round((goalCompleted / goalTarget) * 100)) : 0;

      html += `
        <div class="card reading-goal-card mb-6">
          <div class="reading-goal-header">
            <h3>${icon('star', 18)} ${currentYear} Reading Goal</h3>
            <button class="btn btn-ghost btn-sm" id="set-reading-goal-btn">${icon('edit', 14)} ${goalTarget > 0 ? 'Edit' : 'Set Goal'}</button>
          </div>
          ${goalTarget > 0 ? `
            <div class="reading-goal-progress">
              <div class="reading-goal-progress-fill" style="width:${goalPercent}%"></div>
            </div>
            <div class="reading-goal-counts">
              <span><strong>${goalCompleted}</strong> of <strong>${goalTarget}</strong> books</span>
              <span>${goalPercent}% complete</span>
            </div>
          ` : `
            <p class="text-caption">Set a reading goal to track your progress this year.</p>
          `}
        </div>
      `;

      // Reading Streak
      const currentStreak = personalStats.current_streak || 0;
      const longestStreak = personalStats.longest_streak || 0;
      html += `
        <div class="streak-display">
          <div class="card streak-card">
            <div class="streak-card-icon" style="background:rgba(245,158,11,0.15);color:var(--color-warning)">&#128293;</div>
            <div>
              <div class="streak-card-value">${currentStreak} day${currentStreak !== 1 ? 's' : ''}</div>
              <div class="streak-card-label">Current streak</div>
            </div>
          </div>
          <div class="card streak-card">
            <div class="streak-card-icon" style="background:rgba(34,197,94,0.15);color:var(--color-success)">&#127942;</div>
            <div>
              <div class="streak-card-value">${longestStreak} day${longestStreak !== 1 ? 's' : ''}</div>
              <div class="streak-card-label">Longest streak</div>
            </div>
          </div>
        </div>
      `;

      // Monthly chart
      const monthlyData = personalStats.monthly_books || [];
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const maxMonthly = Math.max(1, ...monthlyData.map(m => m.count || 0));
      html += `
        <h3 class="mt-6 mb-4">${icon('barChart', 18)} Books per Month</h3>
        <div class="monthly-chart">
          ${monthNames.map((monthName, monthIndex) => {
            const monthData = monthlyData.find(m => m.month === monthIndex + 1) || { count: 0 };
            const barHeight = Math.max(2, (monthData.count / maxMonthly) * 100);
            return `
              <div class="monthly-chart-bar">
                <div class="bar" style="height:${barHeight}%" title="${monthData.count} book${monthData.count !== 1 ? 's' : ''}">
                  ${monthData.count > 0 ? `<span class="bar-label">${monthData.count}</span>` : ''}
                </div>
                <span class="month-label">${monthName}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;

      // Year in Books summary stats
      const totalBooks = personalStats.total_books_read || 0;
      const shortestBook = personalStats.shortest_book || null;
      const longestBook = personalStats.longest_book || null;
      const topAuthor = personalStats.top_author || null;
      const topGenre = personalStats.top_genre || null;

      html += `
        <h3 class="mt-6 mb-4">${icon('book', 18)} Year in Books</h3>
        <div class="stats-grid">
          <div class="card stat-card">
            <div class="stat-card-icon" style="color:var(--color-teal-bright);background:var(--color-teal-dim)">${icon('check', 22)}</div>
            <div class="stat-card-value">${totalBooks}</div>
            <div class="stat-card-label">Books Read</div>
          </div>
          ${shortestBook ? `
            <div class="card stat-card">
              <div class="stat-card-icon" style="color:var(--color-info);background:rgba(59,130,246,0.15)">${icon('book', 22)}</div>
              <div class="stat-card-value">${shortestBook.pages || '?'}</div>
              <div class="stat-card-label">Shortest (pages)</div>
            </div>
          ` : ''}
          ${longestBook ? `
            <div class="card stat-card">
              <div class="stat-card-icon" style="color:var(--color-warning);background:rgba(245,158,11,0.15)">${icon('book', 22)}</div>
              <div class="stat-card-value">${longestBook.pages || '?'}</div>
              <div class="stat-card-label">Longest (pages)</div>
            </div>
          ` : ''}
          ${topAuthor ? `
            <div class="card stat-card">
              <div class="stat-card-icon" style="color:var(--color-success);background:rgba(34,197,94,0.15)">${icon('author', 22)}</div>
              <div class="stat-card-value" style="font-size:var(--text-base);font-family:var(--font-body)">${escapeHtml(topAuthor)}</div>
              <div class="stat-card-label">Top Author</div>
            </div>
          ` : ''}
          ${topGenre ? `
            <div class="card stat-card">
              <div class="stat-card-icon" style="color:var(--color-teal-bright);background:var(--color-teal-dim)">${icon('collection', 22)}</div>
              <div class="stat-card-value" style="font-size:var(--text-base);font-family:var(--font-body)">${escapeHtml(topGenre)}</div>
              <div class="stat-card-label">Top Genre</div>
            </div>
          ` : ''}
        </div>
      `;

      // Completed book covers grid
      const completedBooks = personalStats.completed_books || [];
      if (completedBooks.length > 0) {
        html += `
          <h3 class="mt-6 mb-4">Completed</h3>
          <div class="year-in-books-grid">
            ${completedBooks.map(completedBook => {
              const completedCoverUrl = completedBook.has_cover ? `${API}/books/${completedBook.id}/cover${mediaToken()}` : '';
              return `
                <div class="mini-cover" data-book-id="${completedBook.id}" role="link" tabindex="0" title="${escapeHtml(completedBook.title || '')}">
                  ${completedCoverUrl ? `<img src="${completedCoverUrl}" alt="" loading="lazy">` : `<div style="width:100%;height:100%;background:var(--color-surface-active);display:flex;align-items:center;justify-content:center;color:var(--color-muted)">${Icons.book}</div>`}
                </div>
              `;
            }).join('')}
          </div>
        `;
      }

      // Formats breakdown (pie chart via conic-gradient)
      const formatBreakdown = personalStats.format_breakdown || [];
      if (formatBreakdown.length > 0) {
        const formatColors = ['#095F73', '#3BB3C9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
        const formatTotal = formatBreakdown.reduce((sum, formatItem) => sum + (formatItem.count || 0), 0);
        let cumulativePercent = 0;
        const gradientStops = formatBreakdown.map((formatItem, formatIndex) => {
          const percentage = formatTotal > 0 ? (formatItem.count / formatTotal) * 100 : 0;
          const start = cumulativePercent;
          cumulativePercent += percentage;
          return `${formatColors[formatIndex % formatColors.length]} ${start}% ${cumulativePercent}%`;
        }).join(', ');

        html += `
          <h3 class="mt-6 mb-4">Formats</h3>
          <div style="display:flex;align-items:center;gap:var(--space-6);flex-wrap:wrap">
            <div class="formats-pie" style="background:conic-gradient(${gradientStops})">
              <div class="formats-pie-inner">${formatTotal}</div>
            </div>
            <div class="formats-legend">
              ${formatBreakdown.map((formatItem, formatIndex) => `
                <div class="formats-legend-item">
                  <span class="formats-legend-dot" style="background:${formatColors[formatIndex % formatColors.length]}"></span>
                  ${escapeHtml(formatItem.format || 'Other')} (${formatItem.count})
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      tabPanel.innerHTML = html;

      // Bind set reading goal
      document.getElementById('set-reading-goal-btn')?.addEventListener('click', () => {
        const { close: closeGoalModal } = showModal({
          title: 'Set Reading Goal',
          content: `
            <form id="reading-goal-form" novalidate>
              <div class="form-group">
                <label class="form-label" for="goal-target-input">Books to read in ${currentYear}</label>
                <input type="number" class="form-input" id="goal-target-input" min="1" max="500" value="${goalTarget || 12}" required>
              </div>
              <div class="modal-actions">
                <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Goal</button>
              </div>
            </form>
          `,
        });

        const goalForm = document.getElementById('reading-goal-form');
        goalForm.querySelector('[data-action="cancel"]').addEventListener('click', closeGoalModal);
        goalForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const targetValue = parseInt(document.getElementById('goal-target-input').value);
          if (!targetValue || targetValue < 1) return;
          try {
            await apiPost('/me/reading-goal', { target: targetValue, year: currentYear });
            toast('Reading goal set!', 'success');
            closeGoalModal();
            renderPersonalStats();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      });

      // Bind completed book covers
      tabPanel.querySelectorAll('.mini-cover[data-book-id]').forEach(cover => {
        const handler = () => navigateTo(`/book/${cover.dataset.bookId}`);
        cover.addEventListener('click', handler);
        cover.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

    } catch (err) {
      tabPanel.innerHTML = `<div class="error-state" style="padding:var(--space-6)"><p>${escapeHtml(err.message)}</p></div>`;
    }
  }

  // ============================================================
  // 4. Highlights Page
  // ============================================================

  async function renderHighlights() {
    if (!await checkAuth()) return;
    setTitle(['Highlights']);
    breadcrumbTrail = [{ label: 'Highlights', path: '/highlights' }];

    renderShell(`
      <div class="page-header"><h1>Highlights</h1></div>
      ${skeletonList(5)}
    `, 'highlights');

    try {
      const highlightsData = await apiGet('/me/highlights');
      const allHighlights = Array.isArray(highlightsData) ? highlightsData : (highlightsData?.items || []);

      // Group by book
      const groupedByBook = {};
      for (const highlight of allHighlights) {
        const bookKey = highlight.book_id || 'unknown';
        if (!groupedByBook[bookKey]) {
          groupedByBook[bookKey] = {
            bookTitle: highlight.book_title || 'Unknown Book',
            bookId: highlight.book_id,
            highlights: [],
          };
        }
        groupedByBook[bookKey].highlights.push(highlight);
      }

      let bodyContent = `
        <div class="page-header">
          <h1>Highlights</h1>
          <div class="actions">
            <button class="btn btn-secondary" id="export-highlights-btn">${icon('download', 16)} Export</button>
          </div>
        </div>
      `;

      // Color filter + search
      bodyContent += `
        <div class="toolbar">
          <div class="toolbar-left">
            <div class="search-bar">
              <span class="search-icon">${Icons.search}</span>
              <input type="search" placeholder="Search highlights..." aria-label="Search highlights" id="highlight-search-input">
            </div>
          </div>
          <div class="toolbar-right">
            <div class="color-filter-pills" id="highlight-color-filters">
              <button class="color-filter-pill pill-all active" data-color="all" aria-label="All colors" title="All colors"></button>
              <button class="color-filter-pill pill-yellow" data-color="yellow" aria-label="Yellow" title="Yellow"></button>
              <button class="color-filter-pill pill-green" data-color="green" aria-label="Green" title="Green"></button>
              <button class="color-filter-pill pill-blue" data-color="blue" aria-label="Blue" title="Blue"></button>
              <button class="color-filter-pill pill-pink" data-color="pink" aria-label="Pink" title="Pink"></button>
              <button class="color-filter-pill pill-purple" data-color="purple" aria-label="Purple" title="Purple"></button>
            </div>
          </div>
        </div>
      `;

      if (allHighlights.length === 0) {
        bodyContent += `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.edit}</div>
            <h3>No highlights yet</h3>
            <p>Highlight passages while reading to save them here.</p>
          </div>
        `;
      } else {
        bodyContent += `<div id="highlights-container">`;
        for (const bookKey of Object.keys(groupedByBook)) {
          const group = groupedByBook[bookKey];
          bodyContent += `
            <div class="highlights-group" data-book-group="${bookKey}">
              <div class="highlights-group-header">
                <h3>${icon('book', 16)} ${escapeHtml(group.bookTitle)}</h3>
                ${group.bookId ? `<a href="#/book/${group.bookId}">View book</a>` : ''}
              </div>
          `;
          for (const highlight of group.highlights) {
            const colorClass = `highlight-${highlight.color || 'yellow'}`;
            bodyContent += `
              <div class="card highlight-card ${colorClass}" data-highlight-color="${highlight.color || 'yellow'}" data-highlight-text="${escapeHtml(highlight.text || '')}">
                <div class="highlight-card-content">
                  <div class="highlight-text">"${escapeHtml(highlight.text || '')}"</div>
                  ${highlight.note ? `<div class="highlight-note">${escapeHtml(highlight.note)}</div>` : ''}
                  <div class="highlight-meta">
                    <span>${relativeTime(highlight.created_at)}</span>
                    ${highlight.chapter ? `<span>Ch. ${escapeHtml(highlight.chapter)}</span>` : ''}
                    ${highlight.position ? `<span>Pos. ${highlight.position}</span>` : ''}
                  </div>
                </div>
              </div>
            `;
          }
          bodyContent += `</div>`;
        }
        bodyContent += `</div>`;
      }

      renderShell(bodyContent, 'highlights');

      // Bind color filter
      const colorFilters = document.getElementById('highlight-color-filters');
      colorFilters?.querySelectorAll('.color-filter-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          colorFilters.querySelectorAll('.color-filter-pill').forEach(filterPill => filterPill.classList.remove('active'));
          pill.classList.add('active');
          filterHighlights(pill.dataset.color, document.getElementById('highlight-search-input')?.value || '');
        });
      });

      // Bind search
      const highlightSearchInput = document.getElementById('highlight-search-input');
      if (highlightSearchInput) {
        const debouncedHighlightSearch = debounce((value) => {
          const activeColor = colorFilters?.querySelector('.color-filter-pill.active')?.dataset.color || 'all';
          filterHighlights(activeColor, value);
        }, 300);
        highlightSearchInput.addEventListener('input', () => debouncedHighlightSearch(highlightSearchInput.value));
      }

      // Bind export
      document.getElementById('export-highlights-btn')?.addEventListener('click', () => {
        showHighlightExportModal(allHighlights);
      });

    } catch (err) {
      renderShell(renderError('Failed to load highlights', err.message, () => renderHighlights()), 'highlights');
    }
  }

  function filterHighlights(color, searchQuery) {
    const cards = document.querySelectorAll('.highlight-card');
    const groups = document.querySelectorAll('.highlights-group');

    cards.forEach(card => {
      const matchColor = color === 'all' || card.dataset.highlightColor === color;
      const matchSearch = !searchQuery || (card.dataset.highlightText || '').toLowerCase().includes(searchQuery.toLowerCase());
      card.style.display = (matchColor && matchSearch) ? '' : 'none';
    });

    // Hide empty groups
    groups.forEach(group => {
      const visibleCards = group.querySelectorAll('.highlight-card:not([style*="display: none"])');
      group.style.display = visibleCards.length > 0 ? '' : 'none';
    });
  }

  function showHighlightExportModal(highlights) {
    const { close } = showModal({
      title: 'Export Highlights',
      description: 'Choose a format to export your highlights.',
      content: `
        <div class="modal-actions" style="border-top:0;padding-top:0;margin-top:0;justify-content:center;gap:var(--space-4)">
          <button class="btn btn-primary" id="export-highlights-json">${icon('download', 16)} JSON</button>
          <button class="btn btn-secondary" id="export-highlights-md">${icon('download', 16)} Markdown</button>
        </div>
      `,
    });

    document.getElementById('export-highlights-json')?.addEventListener('click', () => {
      downloadBlob(JSON.stringify(highlights, null, 2), 'ironshelf-highlights.json', 'application/json');
      toast('Highlights exported as JSON', 'success');
      close();
    });

    document.getElementById('export-highlights-md')?.addEventListener('click', () => {
      let markdownContent = '# My Highlights\n\n';
      const groupedByBookForExport = {};
      for (const highlight of highlights) {
        const exportBookKey = highlight.book_title || 'Unknown';
        if (!groupedByBookForExport[exportBookKey]) groupedByBookForExport[exportBookKey] = [];
        groupedByBookForExport[exportBookKey].push(highlight);
      }
      for (const [exportBookTitle, exportBookHighlights] of Object.entries(groupedByBookForExport)) {
        markdownContent += `## ${exportBookTitle}\n\n`;
        for (const highlight of exportBookHighlights) {
          markdownContent += `> ${highlight.text || ''}\n`;
          if (highlight.note) markdownContent += `\n*${highlight.note}*\n`;
          markdownContent += '\n---\n\n';
        }
      }
      downloadBlob(markdownContent, 'ironshelf-highlights.md', 'text/markdown');
      toast('Highlights exported as Markdown', 'success');
      close();
    });
  }

  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  // ============================================================
  // 5a. Bookmarks Page
  // ============================================================

  async function renderBookmarks() {
    if (!await checkAuth()) return;
    const thisGeneration = navigationGeneration;
    setTitle(['Bookmarks']);
    breadcrumbTrail = [{ label: 'Bookmarks', path: '/bookmarks' }];

    renderShell(`
      <div class="page-header"><h1>Bookmarks</h1></div>
      ${skeletonList(5)}
    `, 'bookmarks');

    try {
      const bookmarksData = await apiGet('/me/bookmarks');

      if (isStaleNavigation(thisGeneration)) return;

      const allBookmarks = Array.isArray(bookmarksData) ? bookmarksData : (bookmarksData?.items || []);

      // Group by book
      const groupedByBook = {};
      for (const bookmarkItem of allBookmarks) {
        const bookKey = bookmarkItem.book_id || 'unknown';
        if (!groupedByBook[bookKey]) {
          groupedByBook[bookKey] = {
            bookTitle: bookmarkItem.book_title || 'Unknown Book',
            bookId: bookmarkItem.book_id,
            bookmarks: [],
          };
        }
        groupedByBook[bookKey].bookmarks.push(bookmarkItem);
      }

      let bodyContent = `
        <div class="page-header">
          <h1>Bookmarks</h1>
          <div class="actions">
            <span class="badge badge-teal">${allBookmarks.length} total</span>
          </div>
        </div>
      `;

      if (allBookmarks.length === 0) {
        bodyContent += `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.bookmark}</div>
            <h3>No bookmarks yet</h3>
            <p>Bookmark pages while reading to save your place and return later.</p>
          </div>
        `;
      } else {
        bodyContent += `<div id="bookmarks-container">`;
        for (const bookKey of Object.keys(groupedByBook)) {
          const group = groupedByBook[bookKey];
          bodyContent += `
            <div class="bookmarks-group">
              <div class="bookmarks-group-header">
                <h3>${icon('book', 16)} ${escapeHtml(group.bookTitle)}</h3>
                ${group.bookId ? `<a href="#/book/${group.bookId}" class="btn btn-ghost btn-sm">View book</a>` : ''}
              </div>
          `;
          for (const bookmarkEntry of group.bookmarks) {
            const createdDate = bookmarkEntry.created_at ? new Date(bookmarkEntry.created_at).toLocaleDateString() : '';
            const locatorDisplay = bookmarkEntry.chapter || bookmarkEntry.cfi || bookmarkEntry.position || '';
            bodyContent += `
              <div class="card bookmark-card" data-navigate-book="${group.bookId || ''}" role="link" tabindex="0">
                <div class="bookmark-card-content">
                  <div class="bookmark-card-header">
                    <span class="bookmark-icon">${Icons.bookmark}</span>
                    ${locatorDisplay ? `<span class="bookmark-locator">${escapeHtml(String(locatorDisplay))}</span>` : ''}
                  </div>
                  ${bookmarkEntry.note ? `<div class="bookmark-note">${escapeHtml(bookmarkEntry.note)}</div>` : ''}
                  ${createdDate ? `<div class="bookmark-meta">${createdDate}</div>` : ''}
                </div>
              </div>
            `;
          }
          bodyContent += `</div>`;
        }
        bodyContent += `</div>`;
      }

      renderShell(bodyContent, 'bookmarks');

      // Bind bookmark cards to navigate to book
      document.querySelectorAll('[data-navigate-book]').forEach(card => {
        if (!card.dataset.navigateBook) return;
        const handler = () => navigateTo(`/book/${card.dataset.navigateBook}`);
        card.addEventListener('click', handler);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

    } catch (err) {
      renderShell(renderError('Failed to load bookmarks', err.message, () => renderBookmarks()), 'bookmarks');
    }
  }

  // ============================================================
  // 5. Genre Browse Page
  // ============================================================

  async function renderGenres() {
    if (!await checkAuth()) return;
    setTitle(['Genres']);
    breadcrumbTrail = [{ label: 'Genres', path: '/genres' }];

    renderShell(`
      <div class="page-header"><h1>Genres</h1></div>
      ${skeletonCards(12)}
    `, 'genres');

    try {
      const genresData = await apiGet('/genres');
      const genres = Array.isArray(genresData) ? genresData : (genresData?.items || []);

      let bodyContent = `
        <div class="page-header">
          <h1>Genres</h1>
        </div>
      `;

      if (genres.length === 0) {
        bodyContent += `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.collection}</div>
            <h3>No genres found</h3>
            <p>Genre data is extracted from your book metadata.</p>
          </div>
        `;
      } else {
        bodyContent += `<div class="grid grid-genres">`;
        for (const genre of genres) {
          const genreName = genre.name || genre;
          const backgroundColor = genreColorFromName(genreName);
          const bookCount = genre.book_count || 0;
          bodyContent += `
            <div class="genre-card" data-genre-name="${escapeHtml(genreName)}" role="link" tabindex="0"
                 aria-label="${escapeHtml(genreName)} (${bookCount} books)"
                 style="background:${backgroundColor}">
              ${escapeHtml(genreName)}
              ${bookCount ? `<span style="opacity:0.7;margin-left:var(--space-1);font-weight:400;font-size:var(--text-xs)">(${bookCount})</span>` : ''}
            </div>
          `;
        }
        bodyContent += `</div>`;
      }

      renderShell(bodyContent, 'genres');

      // Bind genre cards
      document.querySelectorAll('[data-genre-name]').forEach(card => {
        const handler = () => navigateTo(`/genre/${encodeURIComponent(card.dataset.genreName)}`);
        card.addEventListener('click', handler);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

    } catch (err) {
      renderShell(renderError('Failed to load genres', err.message, () => renderGenres()), 'genres');
    }
  }

  // Genre Detail
  let genreSortField = 'title';
  let genreSortDirection = 'asc';
  let genrePageNumber = 1;
  let genreActiveTab = 'books';

  async function renderGenreDetail(genreName) {
    if (!await checkAuth()) return;
    const thisGeneration = navigationGeneration;
    const decodedGenreName = decodeURIComponent(genreName);
    setTitle([decodedGenreName]);
    breadcrumbTrail = [
      { label: 'Genres', path: '/genres' },
      { label: decodedGenreName, path: `/genre/${genreName}` },
    ];

    renderShell(`
      <div class="page-header"><h1>${escapeHtml(decodedGenreName)}</h1></div>
      ${skeletonCards(8)}
    `, 'genres');

    try {
      const params = new URLSearchParams({
        page: genrePageNumber,
        per_page: 40,
        sort: genreSortField,
        direction: genreSortDirection,
      });

      const booksResponse = await apiGet(`/genres/${encodeURIComponent(decodedGenreName)}/books?${params}`);

      if (isStaleNavigation(thisGeneration)) return;

      const books = Array.isArray(booksResponse) ? booksResponse : (booksResponse?.items || booksResponse?.data || []);
      const totalPages = booksResponse?.total_pages || 1;

      let bodyContent = `
        <div class="page-header">
          <h1 style="display:flex;align-items:center;gap:var(--space-3)">
            <span class="genre-chip" style="background:${genreColorFromName(decodedGenreName)};font-size:var(--text-sm);padding:var(--space-2) var(--space-4)">${escapeHtml(decodedGenreName)}</span>
          </h1>
          <div class="actions">
            <span class="badge badge-teal">${books.length}${totalPages > 1 ? '+' : ''} book${books.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        <div class="tab-bar" role="tablist" aria-label="Genre sections">
          <button class="tab-btn ${genreActiveTab === 'books' ? 'active' : ''}" role="tab" aria-selected="${genreActiveTab === 'books'}" data-genre-tab="books">
            ${icon('book', 16)} Books
          </button>
          <button class="tab-btn ${genreActiveTab === 'authors' ? 'active' : ''}" role="tab" aria-selected="${genreActiveTab === 'authors'}" data-genre-tab="authors">
            ${icon('author', 16)} Authors
          </button>
          <button class="tab-btn ${genreActiveTab === 'series' ? 'active' : ''}" role="tab" aria-selected="${genreActiveTab === 'series'}" data-genre-tab="series">
            ${icon('series', 16)} Series
          </button>
        </div>

        <div id="genre-tab-content">
      `;

      if (genreActiveTab === 'books') {
        bodyContent += renderToolbar({
          searchPlaceholder: 'Search in genre...',
          sortOptions: [
            { value: 'title', label: 'Title' },
            { value: 'added', label: 'Date Added' },
            { value: 'rating', label: 'Rating' },
          ],
          currentSort: genreSortField,
          currentDirection: genreSortDirection,
        });

        if (books.length === 0) {
          bodyContent += `
            <div class="empty-state">
              <div class="empty-state-icon">${Icons.bookOpen}</div>
              <h3>No books in this genre</h3>
            </div>
          `;
        } else {
          bodyContent += `<div class="grid grid-books">`;
          for (const book of books) {
            bodyContent += renderBookCard(book);
          }
          bodyContent += `</div>`;
          bodyContent += renderPagination(genrePageNumber, totalPages);
        }
      } else if (genreActiveTab === 'authors') {
        bodyContent += `<div id="genre-authors-content"><div style="padding:var(--space-8);text-align:center;color:var(--color-muted)">Loading authors...</div></div>`;
      } else if (genreActiveTab === 'series') {
        bodyContent += `<div id="genre-series-content"><div style="padding:var(--space-8);text-align:center;color:var(--color-muted)">Loading series...</div></div>`;
      }

      bodyContent += `</div>`;

      renderShell(bodyContent, 'genres');

      // Bind tab buttons
      document.querySelectorAll('[data-genre-tab]').forEach(tabButton => {
        tabButton.addEventListener('click', () => {
          genreActiveTab = tabButton.dataset.genreTab;
          genrePageNumber = 1;
          renderGenreDetail(genreName);
        });
      });

      // Load authors/series tab content asynchronously
      if (genreActiveTab === 'authors') {
        loadGenreAuthors(decodedGenreName);
      } else if (genreActiveTab === 'series') {
        loadGenreSeries(decodedGenreName);
      }

      // Bind book cards
      document.querySelectorAll('[data-book-id]').forEach(card => {
        const handler = () => navigateTo(`/book/${card.dataset.bookId}`);
        card.addEventListener('click', handler);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

      if (genreActiveTab === 'books') {
        bindToolbar(document.querySelector('.main-body'), {
          currentDirection: genreSortDirection,
          onSearch: () => {},
          onSort: (field, direction) => {
            genreSortField = field;
            genreSortDirection = direction;
            genrePageNumber = 1;
            renderGenreDetail(genreName);
          },
        });

        bindPagination(document.querySelector('.main-body'), (page) => {
          genrePageNumber = page;
          renderGenreDetail(genreName);
        });
      }

    } catch (err) {
      renderShell(renderError('Failed to load genre', err.message, () => renderGenreDetail(genreName)), 'genres');
    }
  }

  async function loadGenreAuthors(genreName) {
    const container = document.getElementById('genre-authors-content');
    if (!container) return;
    try {
      const authorsData = await apiGet(`/genres/${encodeURIComponent(genreName)}/authors`);
      const authors = Array.isArray(authorsData) ? authorsData : (authorsData?.items || []);
      if (authors.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.author}</div>
            <h3>No authors found in this genre</h3>
          </div>
        `;
        return;
      }
      const genrePhotosEnabled = (await getServerSettings()).author_images_enabled !== false;
      container.innerHTML = `<div class="list-group">${authors.map(authorItem => `
        <div class="list-item" data-author-id="${authorItem.id}" role="link" tabindex="0" aria-label="${escapeHtml(authorItem.name)}">
          <div class="list-item-content">
            <div class="list-item-icon">${authorAvatarHtml(authorItem.id, authorItem.name, genrePhotosEnabled)}</div>
            <div class="list-item-text">
              <div class="list-item-name">${escapeHtml(authorItem.name)}</div>
              <div class="list-item-subtitle">${authorItem.book_count || 0} book${(authorItem.book_count || 0) !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <div class="list-item-meta">
            <span class="nav-icon" style="width:16px;height:16px;color:var(--color-muted)">${Icons.chevronRight}</span>
          </div>
        </div>
      `).join('')}</div>`;
      bindAuthorAvatars(container);

      container.querySelectorAll('[data-author-id]').forEach(item => {
        const handler = () => navigateTo(`/author/${item.dataset.authorId}`);
        item.addEventListener('click', handler);
        item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });
    } catch (genreAuthorsError) {
      container.innerHTML = `<div style="padding:var(--space-6);text-align:center;color:var(--color-danger)">${escapeHtml(genreAuthorsError.message)}</div>`;
    }
  }

  async function loadGenreSeries(genreName) {
    const container = document.getElementById('genre-series-content');
    if (!container) return;
    try {
      const seriesData = await apiGet(`/genres/${encodeURIComponent(genreName)}/series`);
      const seriesList = Array.isArray(seriesData) ? seriesData : (seriesData?.items || []);
      if (seriesList.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.series}</div>
            <h3>No series found in this genre</h3>
          </div>
        `;
        return;
      }
      container.innerHTML = `<div class="list-group">${seriesList.map(seriesItem => `
        <div class="list-item" data-series-id="${seriesItem.id}" role="link" tabindex="0" aria-label="${escapeHtml(seriesItem.name)}">
          <div class="list-item-content">
            <div class="list-item-icon">${Icons.series}</div>
            <div class="list-item-text">
              <div class="list-item-name">${escapeHtml(seriesItem.name)}</div>
              <div class="list-item-subtitle">${seriesItem.book_count || 0} book${(seriesItem.book_count || 0) !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <div class="list-item-meta">
            <span class="nav-icon" style="width:16px;height:16px;color:var(--color-muted)">${Icons.chevronRight}</span>
          </div>
        </div>
      `).join('')}</div>`;

      container.querySelectorAll('[data-series-id]').forEach(item => {
        const handler = () => navigateTo(`/series/${item.dataset.seriesId}`);
        item.addEventListener('click', handler);
        item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });
    } catch (genreSeriesError) {
      container.innerHTML = `<div style="padding:var(--space-6);text-align:center;color:var(--color-danger)">${escapeHtml(genreSeriesError.message)}</div>`;
    }
  }

  // ============================================================
  // 6. Webhooks Management
  // ============================================================

  const WEBHOOK_EVENT_TYPES = [
    'book.added', 'book.removed', 'book.updated',
    'library.scanned', 'user.registered', 'user.login',
    'collection.created', 'collection.updated',
    'progress.updated', 'metadata.enriched',
  ];

  async function renderWebhooks() {
    if (!await checkAuth()) return;
    if (!hasPermission('manage_library')) { navigateTo('/settings'); return; }
    setTitle(['Webhooks']);
    breadcrumbTrail = [
      { label: 'Settings', path: '/settings' },
      { label: 'Webhooks', path: '/webhooks' },
    ];

    renderShell(`
      <div class="page-header"><h1>Webhooks</h1></div>
      ${skeletonList(3)}
    `, 'settings');

    try {
      const webhooksData = await apiGet('/webhooks');
      const webhooks = Array.isArray(webhooksData) ? webhooksData : (webhooksData?.items || []);

      let bodyContent = `
        <div class="page-header">
          <h1>Webhooks</h1>
          <div class="actions">
            <button class="btn btn-primary" id="create-webhook-btn">${icon('plus', 16)} New Webhook</button>
          </div>
        </div>
      `;

      if (webhooks.length === 0) {
        bodyContent += `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.globe}</div>
            <h3>No webhooks configured</h3>
            <p>Set up webhooks to notify external services when events happen.</p>
          </div>
        `;
      } else {
        bodyContent += `<div style="display:flex;flex-direction:column;gap:var(--space-4)">`;
        for (const webhook of webhooks) {
          const events = webhook.events || [];
          bodyContent += `
            <div class="card webhook-card" data-webhook-id="${webhook.id}">
              <div class="webhook-card-header">
                <div>
                  <div class="webhook-card-name">${escapeHtml(webhook.name || 'Unnamed')}</div>
                  <div class="webhook-card-url">${escapeHtml(webhook.url || '')}</div>
                </div>
                <div style="display:flex;align-items:center;gap:var(--space-3)">
                  <label class="form-toggle">
                    <input type="checkbox" class="webhook-active-toggle" data-webhook-id="${webhook.id}" ${webhook.is_active !== false ? 'checked' : ''}>
                  </label>
                  <button class="btn btn-ghost btn-sm webhook-test-btn" data-webhook-id="${webhook.id}" aria-label="Test webhook" title="Send test event">${icon('zap', 14)} Test</button>
                  <button class="btn btn-ghost btn-sm webhook-edit-btn" data-webhook-id="${webhook.id}" aria-label="Edit webhook">${icon('edit', 14)}</button>
                  <button class="btn btn-ghost btn-sm webhook-delete-btn" data-webhook-id="${webhook.id}" aria-label="Delete webhook">${icon('trash', 14)}</button>
                </div>
              </div>
              <div class="webhook-events">
                ${events.map(eventName => `<span class="badge badge-muted">${escapeHtml(eventName)}</span>`).join('')}
              </div>
              <details>
                <summary style="font-size:var(--text-xs);color:var(--color-muted);cursor:pointer;margin-top:var(--space-2)">Delivery history</summary>
                <div class="delivery-history" id="deliveries-${webhook.id}">
                  <p style="padding:var(--space-3);font-size:var(--text-xs);color:var(--color-muted)">Loading...</p>
                </div>
              </details>
            </div>
          `;
        }
        bodyContent += `</div>`;
      }

      renderShell(bodyContent, 'settings');

      // Bind create
      document.getElementById('create-webhook-btn')?.addEventListener('click', () => showWebhookModal());

      // Bind edit/delete/test/toggle
      document.querySelectorAll('.webhook-edit-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            const webhookDetail = webhooks.find(webhookItem => webhookItem.id === btn.dataset.webhookId);
            showWebhookModal(webhookDetail);
          } catch (err) { toast(err.message, 'error'); }
        });
      });

      document.querySelectorAll('.webhook-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          showConfirmModal({
            title: 'Delete Webhook',
            message: 'This webhook and all its delivery history will be permanently deleted.',
            confirmText: 'Delete',
            onConfirm: async () => {
              try {
                await apiDelete(`/webhooks/${btn.dataset.webhookId}`);
                toast('Webhook deleted', 'success');
                renderWebhooks();
              } catch (err) { toast(err.message, 'error'); }
            },
          });
        });
      });

      document.querySelectorAll('.webhook-test-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.innerHTML = `${icon('zap', 14)} Sending...`;
          try {
            const testResult = await apiPost(`/webhooks/${btn.dataset.webhookId}/test`, {});
            if (testResult?.success) {
              toast('Test webhook delivered successfully', 'success');
            } else {
              toast(`Test delivery failed: ${testResult?.error || 'Unknown error'}`, 'error');
            }
          } catch (err) { toast(err.message, 'error'); }
          btn.disabled = false;
          btn.innerHTML = `${icon('zap', 14)} Test`;
        });
      });

      document.querySelectorAll('.webhook-active-toggle').forEach(toggle => {
        toggle.addEventListener('change', async () => {
          try {
            await apiPatch(`/webhooks/${toggle.dataset.webhookId}`, { is_active: toggle.checked });
            toast(toggle.checked ? 'Webhook enabled' : 'Webhook disabled', 'info');
          } catch (err) {
            toast(err.message, 'error');
            toggle.checked = !toggle.checked;
          }
        });
      });

      // Load delivery history on details expand
      document.querySelectorAll('details').forEach(details => {
        details.addEventListener('toggle', async () => {
          if (!details.open) return;
          const deliveriesContainer = details.querySelector('.delivery-history');
          const webhookId = details.closest('[data-webhook-id]')?.dataset.webhookId;
          if (!webhookId || !deliveriesContainer) return;
          try {
            const deliveries = await apiGet(`/webhooks/${webhookId}/deliveries`);
            const deliveryItems = Array.isArray(deliveries) ? deliveries : (deliveries?.items || []);
            if (deliveryItems.length === 0) {
              deliveriesContainer.innerHTML = `<p style="padding:var(--space-3);font-size:var(--text-xs);color:var(--color-muted)">No deliveries yet</p>`;
            } else {
              deliveriesContainer.innerHTML = deliveryItems.map(delivery => `
                <div class="delivery-item" data-delivery-id="${delivery.id}">
                  <span class="delivery-status-dot ${delivery.status_code >= 200 && delivery.status_code < 300 ? 'success' : 'failure'}"></span>
                  <span style="flex:1">${escapeHtml(delivery.event || '')} &rarr; ${delivery.status_code || '?'}</span>
                  <span style="color:var(--color-muted)">${formatRelativeTime(delivery.created_at)}</span>
                </div>
              `).join('');

              deliveriesContainer.querySelectorAll('.delivery-item').forEach(deliveryItem => {
                deliveryItem.addEventListener('click', () => {
                  const existingDetail = deliveryItem.nextElementSibling;
                  if (existingDetail?.classList.contains('delivery-detail')) {
                    existingDetail.remove();
                    return;
                  }
                  const matchedDelivery = deliveryItems.find(d => d.id === deliveryItem.dataset.deliveryId);
                  if (matchedDelivery) {
                    const detailEl = document.createElement('div');
                    detailEl.className = 'delivery-detail';
                    detailEl.textContent = JSON.stringify(matchedDelivery.response || matchedDelivery, null, 2);
                    deliveryItem.insertAdjacentElement('afterend', detailEl);
                  }
                });
              });
            }
          } catch {
            deliveriesContainer.innerHTML = `<p style="padding:var(--space-3);font-size:var(--text-xs);color:var(--color-muted)">Failed to load deliveries</p>`;
          }
        });
      });

    } catch (err) {
      renderShell(renderError('Failed to load webhooks', err.message, () => renderWebhooks()), 'settings');
    }
  }

  function showWebhookModal(existingWebhook = null) {
    const isEditing = !!existingWebhook;
    const existingEvents = existingWebhook?.events || [];

    const { close } = showModal({
      title: isEditing ? 'Edit Webhook' : 'Create Webhook',
      content: `
        <form id="webhook-form" novalidate>
          <div class="form-group">
            <label class="form-label" for="webhook-name-input">Name</label>
            <input type="text" class="form-input" id="webhook-name-input" required placeholder="e.g., Discord notification" value="${isEditing ? escapeHtml(existingWebhook.name || '') : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="webhook-url-input">URL</label>
            <input type="url" class="form-input" id="webhook-url-input" required placeholder="https://example.com/webhook" value="${isEditing ? escapeHtml(existingWebhook.url || '') : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="webhook-secret-input">Secret (optional)</label>
            <input type="text" class="form-input" id="webhook-secret-input" placeholder="Used for HMAC signature verification" value="${isEditing ? escapeHtml(existingWebhook.secret || '') : ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Events</label>
            <div class="event-checkbox-grid">
              ${WEBHOOK_EVENT_TYPES.map(eventType => `
                <label>
                  <input type="checkbox" name="webhook_events" value="${eventType}" ${existingEvents.includes(eventType) ? 'checked' : ''}>
                  ${escapeHtml(eventType)}
                </label>
              `).join('')}
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">${isEditing ? 'Save' : 'Create'}</button>
          </div>
        </form>
      `,
    });

    // Widen modal
    const modalElement = document.querySelector('.modal-overlay:last-child .modal');
    if (modalElement) modalElement.style.maxWidth = '560px';

    const webhookForm = document.getElementById('webhook-form');
    webhookForm.querySelector('[data-action="cancel"]').addEventListener('click', close);

    webhookForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = webhookForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      const selectedEvents = [...webhookForm.querySelectorAll('input[name="webhook_events"]:checked')].map(cb => cb.value);
      const payload = {
        name: document.getElementById('webhook-name-input').value.trim(),
        url: document.getElementById('webhook-url-input').value.trim(),
        secret: document.getElementById('webhook-secret-input').value.trim() || null,
        events: selectedEvents,
      };

      if (!payload.name) {
        toast('Webhook name is required', 'error');
        submitBtn.disabled = false;
        return;
      }
      if (!payload.url) {
        toast('Webhook URL is required', 'error');
        submitBtn.disabled = false;
        return;
      }
      if (selectedEvents.length === 0) {
        toast('Select at least one event', 'error');
        submitBtn.disabled = false;
        return;
      }

      try {
        if (isEditing) {
          await apiPatch(`/webhooks/${existingWebhook.id}`, payload);
          toast('Webhook updated', 'success');
        } else {
          await apiPost('/webhooks', payload);
          toast('Webhook created', 'success');
        }
        close();
        renderWebhooks();
      } catch (err) {
        toast(err.message, 'error');
        submitBtn.disabled = false;
      }
    });
  }

  // ============================================================
  // 8. Duplicate Detection
  // ============================================================

  async function renderDuplicates() {
    if (!await checkAuth()) return;
    if (!currentUser?.is_owner) { navigateTo('/'); return; }
    setTitle(['Duplicate Detection']);
    breadcrumbTrail = [{ label: 'Duplicates', path: '/duplicates' }];

    renderShell(`
      <div class="page-header">
        <h1>Duplicate Detection</h1>
        <div class="actions">
          <button class="btn btn-primary" id="scan-duplicates-btn">${icon('search', 16)} Scan for Duplicates</button>
        </div>
      </div>
      <div class="empty-state">
        <div class="empty-state-icon">${Icons.search}</div>
        <h3>Ready to scan</h3>
        <p>Click "Scan for Duplicates" to find potential duplicate books in your libraries.</p>
      </div>
    `, 'settings');

    document.getElementById('scan-duplicates-btn')?.addEventListener('click', async () => {
      const scanBtn = document.getElementById('scan-duplicates-btn');
      scanBtn.disabled = true;
      scanBtn.innerHTML = `${icon('search', 16)} Scanning...`;

      const mainBody = document.querySelector('.main-body');
      const emptyState = mainBody.querySelector('.empty-state');
      if (emptyState) {
        emptyState.innerHTML = `
          <div class="progress-bar progress-bar-indeterminate" style="max-width:300px;margin:var(--space-8) auto">
            <div class="progress-bar-fill"></div>
          </div>
          <p class="text-caption">Analyzing your library for duplicates...</p>
        `;
      }

      try {
        const duplicateResults = await apiGet('/duplicates/scan');
        const groups = Array.isArray(duplicateResults) ? duplicateResults : (duplicateResults?.groups || []);

        if (groups.length === 0) {
          if (emptyState) {
            emptyState.innerHTML = `
              <div class="empty-state-icon">${Icons.check}</div>
              <h3>No duplicates found</h3>
              <p>Your library looks clean. No potential duplicates were detected.</p>
            `;
          }
          scanBtn.disabled = false;
          scanBtn.innerHTML = `${icon('search', 16)} Scan for Duplicates`;
          return;
        }

        let duplicateHtml = `<h3 class="mb-6">Found ${groups.length} potential duplicate group${groups.length !== 1 ? 's' : ''}</h3>`;

        for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
          const duplicateGroup = groups[groupIndex];
          const confidence = duplicateGroup.confidence != null ? Math.round(duplicateGroup.confidence * 100) : null;
          const duplicateBooks = duplicateGroup.books || [];

          duplicateHtml += `
            <div class="card duplicate-group" data-group-index="${groupIndex}">
              <div class="duplicate-group-header">
                <div style="display:flex;align-items:center;gap:var(--space-2)">
                  ${confidence != null ? `<span class="badge badge-warning">${confidence}% match</span>` : ''}
                  <span class="duplicate-group-reason">${escapeHtml(duplicateGroup.reason || 'Similar metadata')}</span>
                </div>
                <button class="btn btn-ghost btn-sm dismiss-duplicate-group" data-group-index="${groupIndex}" aria-label="Dismiss this group">Dismiss</button>
              </div>
              <div class="duplicate-books-row">
                ${duplicateBooks.map(duplicateBook => {
                  const duplicateCoverUrl = duplicateBook.has_cover ? `${API}/books/${duplicateBook.id}/cover${mediaToken()}` : '';
                  return `
                    <div class="duplicate-book-card">
                      <div class="book-cover" style="height:200px;width:133px;margin:0 auto var(--space-3)">
                        ${duplicateCoverUrl ? `<img src="${duplicateCoverUrl}" alt="" loading="lazy">` : `<div style="width:100%;height:100%;background:var(--color-surface-active);display:flex;align-items:center;justify-content:center;color:var(--color-muted)">${Icons.book}</div>`}
                      </div>
                      <div class="book-title">${escapeHtml(duplicateBook.title || 'Unknown')}</div>
                      <div class="book-meta">${duplicateBook.format || ''} ${duplicateBook.file_size ? `(${formatStorageBytes(duplicateBook.file_size)})` : ''}</div>
                      <button class="btn btn-primary btn-sm mt-2 keep-book-btn" data-book-id="${duplicateBook.id}">Keep</button>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }

        if (emptyState) emptyState.remove();
        mainBody.querySelector('.page-header').insertAdjacentHTML('afterend', duplicateHtml);

        // Bind dismiss
        mainBody.querySelectorAll('.dismiss-duplicate-group').forEach(btn => {
          btn.addEventListener('click', () => {
            btn.closest('.duplicate-group')?.remove();
            toast('Group dismissed', 'info');
          });
        });

        // Bind keep
        mainBody.querySelectorAll('.keep-book-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            toast('Book marked as preferred copy', 'success');
            btn.disabled = true;
            btn.textContent = 'Kept';
          });
        });

        scanBtn.disabled = false;
        scanBtn.innerHTML = `${icon('search', 16)} Scan Again`;

      } catch (err) {
        toast(err.message, 'error');
        scanBtn.disabled = false;
        scanBtn.innerHTML = `${icon('search', 16)} Scan for Duplicates`;
      }
    });
  }

  // ============================================================
  // 9. Format Conversion on Book Detail
  // ============================================================

  async function renderConversionButton(bookId, containerSelector) {
    try {
      const converters = await apiGet('/server/converters').catch(() => null);
      if (!converters || !converters.available || converters.formats?.length === 0) return;

      const container = document.querySelector(containerSelector);
      if (!container) return;

      const convertWrap = document.createElement('div');
      convertWrap.className = 'convert-dropdown-wrap';
      convertWrap.innerHTML = `
        <button class="btn btn-secondary" id="convert-btn" aria-haspopup="true" aria-expanded="false">
          ${icon('refresh', 16)} Convert
        </button>
      `;
      container.appendChild(convertWrap);

      let convertDropdownOpen = false;

      document.getElementById('convert-btn')?.addEventListener('click', () => {
        if (convertDropdownOpen) {
          convertWrap.querySelector('.convert-dropdown')?.remove();
          convertDropdownOpen = false;
          return;
        }
        convertDropdownOpen = true;

        const dropdown = document.createElement('div');
        dropdown.className = 'convert-dropdown';
        dropdown.innerHTML = (converters.formats || []).map(targetFormat => `
          <button class="dropdown-item" data-convert-format="${targetFormat}">
            ${icon('download', 16)} Convert to ${escapeHtml(targetFormat.toUpperCase())}
          </button>
        `).join('');
        convertWrap.appendChild(dropdown);

        dropdown.querySelectorAll('[data-convert-format]').forEach(formatBtn => {
          formatBtn.addEventListener('click', async () => {
            const targetFormat = formatBtn.dataset.convertFormat;
            dropdown.remove();
            convertDropdownOpen = false;

            // Show conversion status
            const statusEl = document.createElement('div');
            statusEl.className = 'conversion-status';
            statusEl.innerHTML = `
              <span>Converting to ${escapeHtml(targetFormat.toUpperCase())}...</span>
              <div class="progress-bar progress-bar-indeterminate">
                <div class="progress-bar-fill"></div>
              </div>
            `;
            convertWrap.after(statusEl);

            try {
              const conversionJob = await apiPost(`/books/${bookId}/convert`, { target_format: targetFormat });
              const jobId = conversionJob?.job_id || conversionJob?.id;

              if (jobId) {
                // Poll for completion
                let conversionPollCount = 0;
                const conversionPollMax = 60;
                if (conversionPollTimer) clearInterval(conversionPollTimer);
                conversionPollTimer = setInterval(async () => {
                  conversionPollCount++;
                  try {
                    const jobStatus = await apiGet(`/conversions/${jobId}`);
                    if (jobStatus?.status === 'completed' || jobStatus?.status === 'done') {
                      clearInterval(conversionPollTimer); conversionPollTimer = null;
                      statusEl.innerHTML = `
                        <span style="color:var(--color-success)">Conversion complete!</span>
                        <a href="${API}/books/${bookId}/file?format=${targetFormat}${mediaToken("&")}" class="btn btn-primary btn-sm" download>${icon('download', 14)} Download ${targetFormat.toUpperCase()}</a>
                      `;
                      toast('Format conversion complete', 'success');
                    } else if (jobStatus?.status === 'failed') {
                      clearInterval(conversionPollTimer); conversionPollTimer = null;
                      statusEl.innerHTML = `<span style="color:var(--color-danger)">Conversion failed: ${escapeHtml(jobStatus.error || 'Unknown error')}</span>`;
                    }
                    if (conversionPollCount >= conversionPollMax) {
                      clearInterval(conversionPollTimer); conversionPollTimer = null;
                      statusEl.innerHTML = `<span style="color:var(--color-warning)">Conversion timed out. Check back later.</span>`;
                    }
                  } catch {
                    // Keep polling
                  }
                }, 3000);
              } else {
                // Immediate result
                statusEl.innerHTML = `
                  <span style="color:var(--color-success)">Conversion complete!</span>
                  <a href="${API}/books/${bookId}/file?format=${targetFormat}${mediaToken("&")}" class="btn btn-primary btn-sm" download>${icon('download', 14)} Download ${targetFormat.toUpperCase()}</a>
                `;
                toast('Format conversion complete', 'success');
              }
            } catch (err) {
              statusEl.innerHTML = `<span style="color:var(--color-danger)">Conversion failed: ${escapeHtml(err.message)}</span>`;
            }
          });
        });

        // Close on outside click
        const closeConvertDropdown = (e) => {
          if (!convertWrap.contains(e.target)) {
            dropdown.remove();
            convertDropdownOpen = false;
            document.removeEventListener('click', closeConvertDropdown);
          }
        };
        setTimeout(() => document.addEventListener('click', closeConvertDropdown), 0);
      });

    } catch {
      // No converters available — don't show button
    }
  }

  // ============================================================
  // 12. Reading Preferences in Settings
  // ============================================================

  function renderReaderPreferencesSection() {
    const prefs = getReaderPreferences();

    return `
      <div class="settings-section" data-cat="reader">
        <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('bookOpen', 20)} Reading Preferences</h3>
        <p class="description">Defaults applied when opening a reader. Stored locally in this browser.</p>

        <div class="reader-prefs-grid">
          <div class="card reader-pref-card">
            <h4>Reader Theme</h4>
            <div class="reader-pref-option-group" id="reader-theme-options">
              <button class="reader-pref-option ${prefs.theme === 'dark' ? 'active' : ''}" data-pref-theme="dark" style="background:${prefs.theme === 'dark' ? '' : '#1a1d23'};color:${prefs.theme === 'dark' ? '' : '#e5e7eb'}">Dark</button>
              <button class="reader-pref-option ${prefs.theme === 'sepia' ? 'active' : ''}" data-pref-theme="sepia" style="background:${prefs.theme === 'sepia' ? '' : '#f4ecd8'};color:${prefs.theme === 'sepia' ? '' : '#5c4b37'}">Sepia</button>
              <button class="reader-pref-option ${prefs.theme === 'light' ? 'active' : ''}" data-pref-theme="light" style="background:${prefs.theme === 'light' ? '' : '#ffffff'};color:${prefs.theme === 'light' ? '' : '#1a1a1a'}">Light</button>
            </div>
          </div>

          <div class="card reader-pref-card">
            <h4>Font Size</h4>
            <input type="range" class="font-size-slider" id="reader-font-size" min="12" max="28" step="1" value="${prefs.fontSize || 16}">
            <div class="font-size-value" id="font-size-display">${prefs.fontSize || 16}px</div>
          </div>

          <div class="card reader-pref-card">
            <h4>Reading Direction</h4>
            <div class="reader-pref-option-group" id="reader-direction-options">
              <button class="reader-pref-option ${prefs.direction === 'ltr' ? 'active' : ''}" data-pref-direction="ltr">LTR (Left to Right)</button>
              <button class="reader-pref-option ${prefs.direction === 'rtl' ? 'active' : ''}" data-pref-direction="rtl">RTL (Manga)</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function bindReaderPreferences() {
    const prefs = getReaderPreferences();

    // Theme
    document.querySelectorAll('[data-pref-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-pref-theme]').forEach(themeBtn => themeBtn.classList.remove('active'));
        btn.classList.add('active');
        prefs.theme = btn.dataset.prefTheme;
        setReaderPreferences(prefs);
        toast(`Reader theme set to ${prefs.theme}`, 'info');
      });
    });

    // Font size
    const fontSizeSlider = document.getElementById('reader-font-size');
    const fontSizeDisplay = document.getElementById('font-size-display');
    if (fontSizeSlider) {
      fontSizeSlider.addEventListener('input', () => {
        const sizeValue = parseInt(fontSizeSlider.value);
        if (fontSizeDisplay) fontSizeDisplay.textContent = `${sizeValue}px`;
        prefs.fontSize = sizeValue;
        setReaderPreferences(prefs);
      });
    }

    // Direction
    document.querySelectorAll('[data-pref-direction]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-pref-direction]').forEach(dirBtn => dirBtn.classList.remove('active'));
        btn.classList.add('active');
        prefs.direction = btn.dataset.prefDirection;
        setReaderPreferences(prefs);
        toast(`Reading direction set to ${prefs.direction.toUpperCase()}`, 'info');
      });
    });
  }

  // ============================================================
  // 11. Library Access Control (in user edit)
  // ============================================================

  async function showLibraryAccessModal(userId) {
    const [libraries, userAccessData] = await Promise.all([
      apiGet('/libraries').catch(() => []),
      apiGet(`/users/${userId}/library-access`).catch(() => null),
    ]);

    const allLibraries = Array.isArray(libraries) ? libraries : (libraries?.items || []);
    const userAccess = userAccessData?.library_ids || [];
    const hasAllAccess = userAccessData?.all_libraries !== false;

    const { close } = showModal({
      title: 'Library Access',
      description: 'Select which libraries this user can access.',
      content: `
        <form id="library-access-form" novalidate>
          <div class="form-group">
            <label class="form-toggle">
              <input type="checkbox" id="all-libraries-toggle" ${hasAllAccess ? 'checked' : ''}>
              <span>All libraries</span>
            </label>
          </div>
          <div class="library-access-list" id="library-access-list" style="${hasAllAccess ? 'opacity:0.5;pointer-events:none' : ''}">
            ${allLibraries.map(lib => `
              <div class="library-access-item">
                <label>
                  <input type="checkbox" name="library_access" value="${lib.id}" ${hasAllAccess || userAccess.includes(lib.id) ? 'checked' : ''}>
                  ${icon('library', 16)} ${escapeHtml(lib.name)}
                </label>
              </div>
            `).join('')}
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Save Access</button>
          </div>
        </form>
      `,
    });

    const accessForm = document.getElementById('library-access-form');
    accessForm.querySelector('[data-action="cancel"]').addEventListener('click', close);

    // Toggle all libraries
    document.getElementById('all-libraries-toggle')?.addEventListener('change', (e) => {
      const list = document.getElementById('library-access-list');
      if (list) {
        list.style.opacity = e.target.checked ? '0.5' : '1';
        list.style.pointerEvents = e.target.checked ? 'none' : '';
      }
    });

    accessForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const isAllLibraries = document.getElementById('all-libraries-toggle').checked;
      const selectedLibraryIds = isAllLibraries
        ? []
        : [...accessForm.querySelectorAll('input[name="library_access"]:checked')].map(cb => cb.value);

      try {
        await apiPatch(`/users/${userId}/library-access`, {
          all_libraries: isAllLibraries,
          library_ids: selectedLibraryIds,
        });
        toast('Library access updated', 'success');
        close();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // ============================================================
  // 13. Acquisition Engine UI
  // ============================================================

  let acquisitionDownloadTimer = null;

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, exponent);
    return `${value.toFixed(exponent > 0 ? 1 : 0)} ${units[exponent]}`;
  }

  function acquisitionStatusBadge(status) {
    const statusMap = {
      pending: 'badge-muted',
      searching: 'badge-teal',
      downloading: 'badge-info',
      importing: 'badge-warning',
      imported: 'badge-success',
      completed: 'badge-success',
      active: 'badge-teal',
      fulfilled: 'badge-success',
      failed: 'badge-danger',
      error: 'badge-danger',
    };
    const badgeClass = statusMap[status] || 'badge-muted';
    return `<span class="badge ${badgeClass}">${escapeHtml(status || 'unknown')}</span>`;
  }

  function indexerTypeIcon(indexerType) {
    const typeIconMap = {
      torznab: 'wifi',
      newznab: 'rss',
      rss: 'rss',
      custom: 'globe',
    };
    return icon(typeIconMap[indexerType] || 'globe', 16);
  }

  function clientTypeIcon(clientType) {
    const typeIconMap = {
      qbittorrent: 'server',
      transmission: 'server',
      deluge: 'server',
      direct: 'download',
    };
    return icon(typeIconMap[clientType] || 'server', 16);
  }

  const ACQUISITION_TABS = [
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'wanted', label: 'Wanted', icon: 'crosshair' },
    { id: 'downloads', label: 'Downloads', icon: 'arrowDownCircle' },
    { id: 'indexers', label: 'Indexers', icon: 'wifi' },
    { id: 'clients', label: 'Clients', icon: 'server' },
  ];

  function renderAcquisitionTabs(activeTab) {
    return `<nav class="acq-tabs" role="tablist" aria-label="Acquisition sections">
      ${ACQUISITION_TABS.map(tab => `
        <a href="#/acquisition/${tab.id === 'search' ? '' : tab.id}"
           class="acq-tab ${activeTab === tab.id ? 'active' : ''}"
           role="tab"
           aria-selected="${activeTab === tab.id}"
           aria-controls="acq-panel-${tab.id}">
          ${icon(tab.icon, 16)}
          <span>${tab.label}</span>
        </a>
      `).join('')}
    </nav>`;
  }

  async function renderAcquisition(subRoute) {
    if (!await checkAuth()) return;
    if (!hasPermission('manage_library')) { navigateTo('/'); return; }

    // Stop any running download poll
    if (acquisitionDownloadTimer) {
      clearInterval(acquisitionDownloadTimer);
      acquisitionDownloadTimer = null;
    }

    // Parse sub-route and query params
    const hashFull = getHashPath();
    const queryIndex = hashFull.indexOf('?');
    const queryString = queryIndex >= 0 ? hashFull.slice(queryIndex + 1) : '';
    const queryParams = new URLSearchParams(queryString);

    // Determine active tab
    let activeTab = subRoute || 'search';
    if (!ACQUISITION_TABS.find(t => t.id === activeTab)) activeTab = 'search';

    setTitle(['Acquisition']);
    breadcrumbTrail = [{ label: 'Acquisition', path: '/acquisition' }];

    const tabHandlers = {
      search: () => renderAcquisitionSearch(queryParams),
      wanted: renderAcquisitionWanted,
      downloads: renderAcquisitionDownloads,
      indexers: renderAcquisitionIndexers,
      clients: renderAcquisitionClients,
    };

    // Render shell with tab bar + loading
    renderShell(`
      ${renderAcquisitionTabs(activeTab)}
      <div id="acq-tab-content" role="tabpanel">
        ${skeletonList(3)}
      </div>
    `, 'acquisition');

    await tabHandlers[activeTab]();
  }

  // --- Acquisition: Search ---

  async function renderAcquisitionSearch(queryParams) {
    const initialQuery = queryParams?.get('q') || '';
    const initialAuthor = queryParams?.get('author') || '';

    const container = document.getElementById('acq-tab-content');
    if (!container) return;

    container.innerHTML = `
      <div class="acq-search-bar">
        <div class="acq-search-fields">
          <div class="form-group" style="margin-bottom:0;flex:1">
            <input type="text" class="form-input" id="acq-search-query" placeholder="Search ebooks across indexers..." value="${escapeHtml(initialQuery)}" aria-label="Search query">
          </div>
          <div class="form-group" style="margin-bottom:0;flex:0 0 200px">
            <input type="text" class="form-input" id="acq-search-author" placeholder="Author filter..." value="${escapeHtml(initialAuthor)}" aria-label="Author filter">
          </div>
          <button class="btn btn-primary" id="acq-search-btn">${icon('search', 16)} Search</button>
        </div>
      </div>
      <div id="acq-search-results"></div>
    `;

    const searchButton = document.getElementById('acq-search-btn');
    const queryInput = document.getElementById('acq-search-query');
    const authorInput = document.getElementById('acq-search-author');

    async function executeSearch() {
      const searchQuery = queryInput.value.trim();
      const searchAuthor = authorInput.value.trim();
      if (!searchQuery && !searchAuthor) {
        toast('Enter a search query or author name', 'warning');
        return;
      }

      const resultsContainer = document.getElementById('acq-search-results');
      resultsContainer.innerHTML = `<div class="acq-loading">${skeletonList(5)}</div>`;
      searchButton.disabled = true;
      searchButton.innerHTML = `${icon('search', 16)} Searching...`;

      try {
        const searchParams = new URLSearchParams();
        // The server requires a non-empty q; when only an author is given
        // (e.g. "Find More by Author"), use the author name as the query too.
        searchParams.set('q', searchQuery || searchAuthor);
        if (searchAuthor) searchParams.set('author', searchAuthor);
        const results = await apiGet(`/acquisition/search?${searchParams.toString()}`);
        const resultItems = Array.isArray(results) ? results : (results?.items || results?.results || []);

        if (resultItems.length === 0) {
          resultsContainer.innerHTML = `
            <div class="empty-state" style="padding:var(--space-8) 0">
              <div class="empty-state-icon">${Icons.search}</div>
              <h3>No results found</h3>
              <p>Try adjusting your search terms or check that your indexers are configured.</p>
            </div>
          `;
        } else {
          resultsContainer.innerHTML = `
            <div class="acq-results-header">
              <span class="text-caption">${resultItems.length} result${resultItems.length !== 1 ? 's' : ''} found</span>
            </div>
            <div class="acq-results-list">
              ${resultItems.map((result, resultIndex) => `
                <div class="acq-result-row" data-result-index="${resultIndex}">
                  <div class="acq-result-info">
                    <div class="acq-result-title">${escapeHtml(result.title || result.name || 'Untitled')}</div>
                    <div class="acq-result-meta">
                      ${result.size ? `<span>${formatBytes(result.size)}</span>` : ''}
                      ${result.seeders != null ? `<span class="acq-seeders">${Icons.arrowUp} ${result.seeders}</span>` : ''}
                      ${result.leechers != null ? `<span class="acq-leechers">${Icons.arrowDown} ${result.leechers}</span>` : ''}
                      ${result.indexer ? `<span class="badge badge-muted">${escapeHtml(result.indexer)}</span>` : ''}
                      ${result.published_date || result.publish_date ? `<span>${formatRelativeTime(result.published_date || result.publish_date)}</span>` : ''}
                    </div>
                  </div>
                  <button class="btn btn-primary btn-sm acq-grab-btn" data-result-index="${resultIndex}" aria-label="Grab ${escapeHtml(result.title || '')}">
                    ${icon('download', 14)} Grab
                  </button>
                </div>
              `).join('')}
            </div>
          `;

          // Bind grab buttons
          resultsContainer.querySelectorAll('.acq-grab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              const resultItem = resultItems[parseInt(btn.dataset.resultIndex, 10)];
              if (resultItem) showGrabModal(resultItem);
            });
          });
        }
      } catch (err) {
        resultsContainer.innerHTML = `
          <div class="error-state" style="padding:var(--space-8) 0">
            <div class="error-state-icon">${Icons.alertCircle}</div>
            <h3>Search failed</h3>
            <p>${escapeHtml(err.message)}</p>
          </div>
        `;
      }

      searchButton.disabled = false;
      searchButton.innerHTML = `${icon('search', 16)} Search`;
    }

    searchButton.addEventListener('click', executeSearch);
    queryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') executeSearch(); });
    authorInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') executeSearch(); });

    // Auto-search if query params provided
    if (initialQuery || initialAuthor) {
      executeSearch();
    }
  }

  async function showGrabModal(searchResult) {
    let downloadClients = [];
    let libraries = [];
    try {
      const [clientsData, librariesData] = await Promise.all([
        apiGet('/download-clients'),
        apiGet('/libraries'),
      ]);
      downloadClients = Array.isArray(clientsData) ? clientsData : (clientsData?.items || []);
      libraries = Array.isArray(librariesData) ? librariesData : (librariesData?.items || []);
    } catch (err) {
      toast('Failed to load clients or libraries: ' + err.message, 'error');
      return;
    }

    if (downloadClients.length === 0) {
      toast('No download clients configured. Add one in the Clients tab.', 'warning');
      return;
    }

    const enabledClients = downloadClients.filter(clientItem => clientItem.enabled !== false);
    if (enabledClients.length === 0) {
      toast('All download clients are disabled. Enable one in the Clients tab.', 'warning');
      return;
    }

    const { close } = showModal({
      title: 'Grab Download',
      description: searchResult.title || searchResult.name || '',
      content: `
        <form id="grab-form" novalidate>
          <div class="form-group">
            <label class="form-label" for="grab-client-select">Download Client</label>
            <select class="form-input" id="grab-client-select" required>
              ${enabledClients.map(clientItem => `<option value="${clientItem.id}">${escapeHtml(clientItem.name)} (${escapeHtml(clientItem.type || '')})</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="grab-library-select">Target Library</label>
            <select class="form-input" id="grab-library-select">
              <option value="">None (manual import)</option>
              ${libraries.map(libraryItem => `<option value="${libraryItem.id}">${escapeHtml(libraryItem.name)}</option>`).join('')}
            </select>
          </div>
          ${searchResult.size ? `<p class="text-caption" style="margin-top:var(--space-2)">Size: ${formatBytes(searchResult.size)}</p>` : ''}
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">${icon('download', 16)} Grab</button>
          </div>
        </form>
      `,
    });

    const modalElement = document.querySelector('.modal-overlay:last-child .modal');
    if (modalElement) modalElement.style.maxWidth = '480px';

    const grabForm = document.getElementById('grab-form');
    grabForm.querySelector('[data-action="cancel"]').addEventListener('click', close);

    grabForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitButton = grabForm.querySelector('button[type="submit"]');
      submitButton.disabled = true;

      const grabPayload = {
        ...searchResult,
        download_client_id: document.getElementById('grab-client-select').value,
        library_id: document.getElementById('grab-library-select').value || null,
      };

      try {
        await apiPost('/acquisition/grab', grabPayload);
        toast('Download started', 'success');
        close();
      } catch (err) {
        toast(err.message, 'error');
        submitButton.disabled = false;
      }
    });
  }

  // --- Acquisition: Wanted ---

  async function renderAcquisitionWanted() {
    const container = document.getElementById('acq-tab-content');
    if (!container) return;

    try {
      const wantedData = await apiGet('/wanted');
      const wantedItems = Array.isArray(wantedData) ? wantedData : (wantedData?.items || []);

      const activeItems = wantedItems.filter(wantedItem => wantedItem.status !== 'fulfilled');
      const fulfilledItems = wantedItems.filter(wantedItem => wantedItem.status === 'fulfilled');

      container.innerHTML = `
        <div class="page-header" style="margin-bottom:var(--space-6)">
          <h2>Wanted List</h2>
          <div class="actions">
            <button class="btn btn-primary" id="add-wanted-btn">${icon('plus', 16)} Add Wanted</button>
          </div>
        </div>
        ${activeItems.length === 0 && fulfilledItems.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.crosshair}</div>
            <h3>Nothing on the wanted list</h3>
            <p>Add books, authors, or series you want to automatically find and download.</p>
          </div>
        ` : ''}
        ${activeItems.length > 0 ? `
          <div class="acq-wanted-section">
            <div class="text-overline" style="margin-bottom:var(--space-3)">Active (${activeItems.length})</div>
            <div class="acq-wanted-list">
              ${activeItems.map(wantedItem => renderWantedCard(wantedItem)).join('')}
            </div>
          </div>
        ` : ''}
        ${fulfilledItems.length > 0 ? `
          <div class="acq-wanted-section" style="margin-top:var(--space-8)">
            <div class="text-overline" style="margin-bottom:var(--space-3)">Fulfilled (${fulfilledItems.length})</div>
            <div class="acq-wanted-list">
              ${fulfilledItems.map(wantedItem => renderWantedCard(wantedItem)).join('')}
            </div>
          </div>
        ` : ''}
      `;

      // Bind add wanted
      document.getElementById('add-wanted-btn')?.addEventListener('click', () => showWantedModal());

      // Bind per-item actions
      container.querySelectorAll('.wanted-search-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const wantedId = btn.dataset.wantedId;
          btn.disabled = true;
          btn.innerHTML = `${icon('search', 14)} Searching...`;
          try {
            const searchResults = await apiPost(`/wanted/${wantedId}/search`, {});
            const resultItems = Array.isArray(searchResults) ? searchResults : (searchResults?.items || searchResults?.results || []);
            showWantedSearchResultsModal(wantedId, resultItems);
          } catch (err) {
            toast(err.message, 'error');
          }
          btn.disabled = false;
          btn.innerHTML = `${icon('search', 14)} Search`;
        });
      });

      container.querySelectorAll('.wanted-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          showConfirmModal({
            title: 'Remove Wanted Item',
            message: 'This item will be removed from the wanted list.',
            confirmText: 'Remove',
            onConfirm: async () => {
              try {
                await apiDelete(`/wanted/${btn.dataset.wantedId}`);
                toast('Removed from wanted list', 'success');
                renderAcquisitionWanted();
              } catch (err) { toast(err.message, 'error'); }
            },
          });
        });
      });

      container.querySelectorAll('.wanted-fulfill-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await apiPatch(`/wanted/${btn.dataset.wantedId}`, { status: 'fulfilled' });
            toast('Marked as fulfilled', 'success');
            renderAcquisitionWanted();
          } catch (err) { toast(err.message, 'error'); }
        });
      });

    } catch (err) {
      container.innerHTML = renderError('Failed to load wanted list', err.message, () => renderAcquisitionWanted());
    }
  }

  function renderWantedCard(wantedItem) {
    const isFulfilled = wantedItem.status === 'fulfilled';
    return `
      <div class="card acq-wanted-card ${isFulfilled ? 'acq-wanted-fulfilled' : ''}">
        <div class="acq-wanted-card-header">
          <div>
            <div class="acq-wanted-card-title">${escapeHtml(wantedItem.title || 'Untitled')}</div>
            <div class="acq-wanted-card-meta">
              ${wantedItem.author ? `<span>${escapeHtml(wantedItem.author)}</span>` : ''}
              ${wantedItem.type ? `<span class="badge badge-muted">${escapeHtml(wantedItem.type)}</span>` : ''}
              ${wantedItem.isbn ? `<span class="text-caption">ISBN: ${escapeHtml(wantedItem.isbn)}</span>` : ''}
              ${wantedItem.preferred_format ? `<span class="badge badge-teal">${escapeHtml(wantedItem.preferred_format)}</span>` : ''}
              ${wantedItem.quality_profile ? `<span class="badge badge-muted">${escapeHtml(wantedItem.quality_profile)}</span>` : ''}
            </div>
          </div>
          <div class="acq-wanted-card-actions">
            ${acquisitionStatusBadge(wantedItem.status)}
            ${!isFulfilled ? `
              <button class="btn btn-ghost btn-sm wanted-search-btn" data-wanted-id="${wantedItem.id}" aria-label="Search for this item">${icon('search', 14)} Search</button>
              <button class="btn btn-ghost btn-sm wanted-fulfill-btn" data-wanted-id="${wantedItem.id}" aria-label="Mark as fulfilled">${icon('check', 14)}</button>
            ` : ''}
            <button class="btn btn-ghost btn-sm wanted-delete-btn" data-wanted-id="${wantedItem.id}" aria-label="Remove wanted item">${icon('trash', 14)}</button>
          </div>
        </div>
        ${isFulfilled && wantedItem.fulfilled_at ? `<div class="text-caption" style="margin-top:var(--space-2)">Fulfilled ${formatRelativeTime(wantedItem.fulfilled_at)}</div>` : ''}
      </div>
    `;
  }

  function showWantedModal(existingItem = null) {
    const isEditing = !!existingItem;

    const { close } = showModal({
      title: isEditing ? 'Edit Wanted Item' : 'Add to Wanted List',
      content: `
        <form id="wanted-form" novalidate>
          <div class="form-group">
            <label class="form-label" for="wanted-type-select">Type</label>
            <select class="form-input" id="wanted-type-select">
              <option value="book" ${existingItem?.type === 'book' ? 'selected' : ''}>Book</option>
              <option value="author" ${existingItem?.type === 'author' ? 'selected' : ''}>Author</option>
              <option value="series" ${existingItem?.type === 'series' ? 'selected' : ''}>Series</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="wanted-title-input">Title</label>
            <input type="text" class="form-input" id="wanted-title-input" required placeholder="e.g., The Hobbit" value="${isEditing ? escapeHtml(existingItem.title || '') : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="wanted-author-input">Author</label>
            <input type="text" class="form-input" id="wanted-author-input" placeholder="e.g., J.R.R. Tolkien" value="${isEditing ? escapeHtml(existingItem.author || '') : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="wanted-isbn-input">ISBN (optional)</label>
            <input type="text" class="form-input" id="wanted-isbn-input" placeholder="e.g., 978-0-547-92822-7" value="${isEditing ? escapeHtml(existingItem.isbn || '') : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="wanted-format-select">Preferred Format</label>
            <select class="form-input" id="wanted-format-select">
              <option value="">Any</option>
              <option value="epub" ${existingItem?.preferred_format === 'epub' ? 'selected' : ''}>EPUB</option>
              <option value="pdf" ${existingItem?.preferred_format === 'pdf' ? 'selected' : ''}>PDF</option>
              <option value="mobi" ${existingItem?.preferred_format === 'mobi' ? 'selected' : ''}>MOBI</option>
              <option value="azw3" ${existingItem?.preferred_format === 'azw3' ? 'selected' : ''}>AZW3</option>
              <option value="cbz" ${existingItem?.preferred_format === 'cbz' ? 'selected' : ''}>CBZ</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="wanted-quality-select">Quality Profile</label>
            <select class="form-input" id="wanted-quality-select">
              <option value="">Default</option>
              <option value="any" ${existingItem?.quality_profile === 'any' ? 'selected' : ''}>Any Quality</option>
              <option value="high" ${existingItem?.quality_profile === 'high' ? 'selected' : ''}>High Quality</option>
              <option value="preferred" ${existingItem?.quality_profile === 'preferred' ? 'selected' : ''}>Preferred Format Only</option>
            </select>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">${isEditing ? 'Save' : 'Add'}</button>
          </div>
        </form>
      `,
    });

    const modalElement = document.querySelector('.modal-overlay:last-child .modal');
    if (modalElement) modalElement.style.maxWidth = '520px';

    const wantedForm = document.getElementById('wanted-form');
    wantedForm.querySelector('[data-action="cancel"]').addEventListener('click', close);

    wantedForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitButton = wantedForm.querySelector('button[type="submit"]');
      submitButton.disabled = true;

      const wantedPayload = {
        type: document.getElementById('wanted-type-select').value,
        title: document.getElementById('wanted-title-input').value.trim(),
        author: document.getElementById('wanted-author-input').value.trim() || null,
        isbn: document.getElementById('wanted-isbn-input').value.trim() || null,
        preferred_format: document.getElementById('wanted-format-select').value || null,
        quality_profile: document.getElementById('wanted-quality-select').value || null,
      };

      if (!wantedPayload.title) {
        toast('Title is required', 'error');
        submitButton.disabled = false;
        return;
      }

      try {
        if (isEditing) {
          await apiPatch(`/wanted/${existingItem.id}`, wantedPayload);
          toast('Wanted item updated', 'success');
        } else {
          await apiPost('/wanted', wantedPayload);
          toast('Added to wanted list', 'success');
        }
        close();
        renderAcquisitionWanted();
      } catch (err) {
        toast(err.message, 'error');
        submitButton.disabled = false;
      }
    });
  }

  function showWantedSearchResultsModal(wantedId, searchResults) {
    if (searchResults.length === 0) {
      toast('No results found for this wanted item', 'info');
      return;
    }

    const { close } = showModal({
      title: 'Search Results',
      description: `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''} found`,
      content: `
        <div class="acq-results-list acq-results-modal">
          ${searchResults.map((result, resultIndex) => `
            <div class="acq-result-row" data-result-index="${resultIndex}">
              <div class="acq-result-info">
                <div class="acq-result-title">${escapeHtml(result.title || result.name || 'Untitled')}</div>
                <div class="acq-result-meta">
                  ${result.size ? `<span>${formatBytes(result.size)}</span>` : ''}
                  ${result.seeders != null ? `<span class="acq-seeders">${Icons.arrowUp} ${result.seeders}</span>` : ''}
                  ${result.leechers != null ? `<span class="acq-leechers">${Icons.arrowDown} ${result.leechers}</span>` : ''}
                  ${result.indexer ? `<span class="badge badge-muted">${escapeHtml(result.indexer)}</span>` : ''}
                </div>
              </div>
              <button class="btn btn-primary btn-sm acq-grab-result-btn" data-result-index="${resultIndex}">
                ${icon('download', 14)} Grab
              </button>
            </div>
          `).join('')}
        </div>
      `,
    });

    const modalElement = document.querySelector('.modal-overlay:last-child .modal');
    if (modalElement) modalElement.style.maxWidth = '680px';

    modalElement.querySelectorAll('.acq-grab-result-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const resultItem = searchResults[parseInt(btn.dataset.resultIndex, 10)];
        if (resultItem) {
          close();
          showGrabModal({ ...resultItem, wanted_id: wantedId });
        }
      });
    });
  }

  // --- Acquisition: Downloads ---

  async function renderAcquisitionDownloads() {
    const container = document.getElementById('acq-tab-content');
    if (!container) return;

    async function loadDownloads() {
      try {
        const downloadsData = await apiGet('/downloads');
        const downloadItems = Array.isArray(downloadsData) ? downloadsData : (downloadsData?.items || []);

        const activeDownloads = downloadItems.filter(downloadItem =>
          downloadItem.status !== 'imported' && downloadItem.status !== 'completed' && downloadItem.status !== 'failed'
        );
        const historyDownloads = downloadItems.filter(downloadItem =>
          downloadItem.status === 'imported' || downloadItem.status === 'completed' || downloadItem.status === 'failed'
        );

        container.innerHTML = `
          <div class="page-header" style="margin-bottom:var(--space-6)">
            <h2>Downloads</h2>
            <div class="actions">
              <button class="btn btn-ghost" id="refresh-downloads-btn">${icon('refresh', 16)} Refresh</button>
            </div>
          </div>
          ${activeDownloads.length > 0 ? `
            <div class="text-overline" style="margin-bottom:var(--space-3)">Active (${activeDownloads.length})</div>
            <div class="acq-downloads-list">
              ${activeDownloads.map(downloadItem => renderDownloadCard(downloadItem)).join('')}
            </div>
          ` : `
            <div class="empty-state" style="padding:var(--space-6) 0">
              <div class="empty-state-icon">${Icons.arrowDownCircle}</div>
              <h3>No active downloads</h3>
              <p>Search for ebooks and grab them to start downloading.</p>
            </div>
          `}
          ${historyDownloads.length > 0 ? `
            <div class="text-overline" style="margin-top:var(--space-8);margin-bottom:var(--space-3)">History (${historyDownloads.length})</div>
            <div class="acq-downloads-list">
              ${historyDownloads.map(downloadItem => renderDownloadCard(downloadItem)).join('')}
            </div>
          ` : ''}
        `;

        // Bind refresh
        document.getElementById('refresh-downloads-btn')?.addEventListener('click', loadDownloads);

        // Bind cancel buttons
        container.querySelectorAll('.download-cancel-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            showConfirmModal({
              title: 'Cancel Download',
              message: 'This will cancel and remove the download.',
              confirmText: 'Cancel Download',
              onConfirm: async () => {
                try {
                  await apiDelete(`/downloads/${btn.dataset.downloadId}`);
                  toast('Download cancelled', 'success');
                  loadDownloads();
                } catch (err) { toast(err.message, 'error'); }
              },
            });
          });
        });

        // Bind retry buttons
        container.querySelectorAll('.download-retry-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            try {
              await apiPost(`/downloads/${btn.dataset.downloadId}/retry`, {});
              toast('Retrying download', 'success');
              loadDownloads();
            } catch (err) {
              toast(err.message, 'error');
              btn.disabled = false;
            }
          });
        });

        // Auto-refresh while active downloads exist
        if (acquisitionDownloadTimer) {
          clearInterval(acquisitionDownloadTimer);
          acquisitionDownloadTimer = null;
        }
        if (activeDownloads.length > 0) {
          acquisitionDownloadTimer = setInterval(() => {
            // Only refresh if still on the downloads tab
            if (getHashPath().includes('acquisition/downloads') || getHashPath() === '/acquisition/downloads') {
              loadDownloads();
            } else {
              clearInterval(acquisitionDownloadTimer);
              acquisitionDownloadTimer = null;
            }
          }, 5000);
        }

      } catch (err) {
        container.innerHTML = renderError('Failed to load downloads', err.message, loadDownloads);
      }
    }

    await loadDownloads();
  }

  function renderDownloadCard(downloadItem) {
    const progressPercent = downloadItem.progress != null ? Math.min(100, Math.max(0, downloadItem.progress)) : null;
    const isFailed = downloadItem.status === 'failed' || downloadItem.status === 'error';
    const isComplete = downloadItem.status === 'imported' || downloadItem.status === 'completed';
    const isActive = !isFailed && !isComplete;

    let progressBarClass = 'acq-progress-downloading';
    if (downloadItem.status === 'pending') progressBarClass = 'acq-progress-pending';
    if (downloadItem.status === 'importing') progressBarClass = 'acq-progress-importing';
    if (isComplete) progressBarClass = 'acq-progress-imported';
    if (isFailed) progressBarClass = 'acq-progress-failed';

    return `
      <div class="card acq-download-card ${isActive ? 'acq-download-active' : ''}">
        <div class="acq-download-header">
          <div class="acq-download-info">
            <div class="acq-download-title">${escapeHtml(downloadItem.title || downloadItem.name || 'Unknown')}</div>
            <div class="acq-download-meta">
              ${acquisitionStatusBadge(downloadItem.status)}
              ${downloadItem.client_name ? `<span class="text-caption">${escapeHtml(downloadItem.client_name)}</span>` : ''}
              ${downloadItem.speed ? `<span class="text-caption">${escapeHtml(downloadItem.speed)}</span>` : ''}
              ${downloadItem.eta ? `<span class="text-caption">ETA: ${escapeHtml(downloadItem.eta)}</span>` : ''}
              ${downloadItem.size ? `<span class="text-caption">${formatBytes(downloadItem.size)}</span>` : ''}
              ${downloadItem.completed_at ? `<span class="text-caption">${formatRelativeTime(downloadItem.completed_at)}</span>` : ''}
            </div>
          </div>
          <div class="acq-download-actions">
            ${isFailed ? `<button class="btn btn-ghost btn-sm download-retry-btn" data-download-id="${downloadItem.id}">${icon('refresh', 14)} Retry</button>` : ''}
            ${!isComplete ? `<button class="btn btn-ghost btn-sm download-cancel-btn" data-download-id="${downloadItem.id}" aria-label="Cancel download">${icon('trash', 14)}</button>` : ''}
          </div>
        </div>
        ${progressPercent != null && isActive ? `
          <div class="acq-progress-bar ${progressBarClass}">
            <div class="acq-progress-fill" style="width:${progressPercent}%"></div>
          </div>
          <div class="acq-progress-label">${progressPercent.toFixed(0)}%</div>
        ` : ''}
        ${isFailed && downloadItem.error ? `<div class="text-caption" style="color:var(--color-danger);margin-top:var(--space-2)">${escapeHtml(downloadItem.error)}</div>` : ''}
      </div>
    `;
  }

  // --- Acquisition: Indexers ---

  async function renderAcquisitionIndexers() {
    const container = document.getElementById('acq-tab-content');
    if (!container) return;

    try {
      const indexersData = await apiGet('/indexers');
      const indexerItems = Array.isArray(indexersData) ? indexersData : (indexersData?.items || []);

      container.innerHTML = `
        <div class="page-header" style="margin-bottom:var(--space-6)">
          <h2>Indexers</h2>
          <div class="actions">
            <button class="btn btn-primary" id="add-indexer-btn">${icon('plus', 16)} Add Indexer</button>
          </div>
        </div>
        ${indexerItems.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.wifi}</div>
            <h3>No indexers configured</h3>
            <p>Add indexers to search for ebooks across torrent and usenet sites.</p>
          </div>
        ` : `
          <div class="acq-indexer-list">
            ${indexerItems.map(indexerItem => `
              <div class="card acq-indexer-card" data-indexer-id="${indexerItem.id}">
                <div class="acq-indexer-header">
                  <div class="acq-indexer-type-icon">${indexerTypeIcon(indexerItem.type)}</div>
                  <div class="acq-indexer-info">
                    <div class="acq-indexer-name">${escapeHtml(indexerItem.name || 'Unnamed')}</div>
                    <div class="acq-indexer-meta">
                      <span class="badge badge-muted">${escapeHtml(indexerItem.type || 'custom')}</span>
                      ${indexerItem.url ? `<span class="text-caption" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(indexerItem.url)}</span>` : ''}
                      ${indexerItem.last_searched ? `<span class="text-caption">Last: ${formatRelativeTime(indexerItem.last_searched)}</span>` : ''}
                      ${indexerItem.priority != null ? `<span class="text-caption">Priority: ${indexerItem.priority}</span>` : ''}
                    </div>
                  </div>
                  <div class="acq-indexer-actions">
                    <label class="form-toggle">
                      <input type="checkbox" class="indexer-enabled-toggle" data-indexer-id="${indexerItem.id}" ${indexerItem.enabled !== false ? 'checked' : ''}>
                    </label>
                    <button class="btn btn-ghost btn-sm indexer-test-btn" data-indexer-id="${indexerItem.id}" aria-label="Test indexer">${icon('zap', 14)} Test</button>
                    <button class="btn btn-ghost btn-sm indexer-edit-btn" data-indexer-id="${indexerItem.id}" aria-label="Edit indexer">${icon('edit', 14)}</button>
                    <button class="btn btn-ghost btn-sm indexer-delete-btn" data-indexer-id="${indexerItem.id}" aria-label="Delete indexer">${icon('trash', 14)}</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      `;

      // Bind add
      document.getElementById('add-indexer-btn')?.addEventListener('click', () => showIndexerModal());

      // Bind edit
      container.querySelectorAll('.indexer-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const indexerDetail = indexerItems.find(indexerItem => indexerItem.id === btn.dataset.indexerId);
          if (indexerDetail) showIndexerModal(indexerDetail);
        });
      });

      // Bind delete
      container.querySelectorAll('.indexer-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          showConfirmModal({
            title: 'Delete Indexer',
            message: 'This indexer will be permanently removed.',
            confirmText: 'Delete',
            onConfirm: async () => {
              try {
                await apiDelete(`/indexers/${btn.dataset.indexerId}`);
                toast('Indexer deleted', 'success');
                renderAcquisitionIndexers();
              } catch (err) { toast(err.message, 'error'); }
            },
          });
        });
      });

      // Bind test
      container.querySelectorAll('.indexer-test-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.innerHTML = `${icon('zap', 14)} Testing...`;
          try {
            const testResult = await apiPost(`/indexers/${btn.dataset.indexerId}/test`, {});
            if (testResult?.success) {
              toast('Indexer connection successful', 'success');
            } else {
              toast(`Indexer test failed: ${testResult?.error || 'Unknown error'}`, 'error');
            }
          } catch (err) { toast(err.message, 'error'); }
          btn.disabled = false;
          btn.innerHTML = `${icon('zap', 14)} Test`;
        });
      });

      // Bind toggle
      container.querySelectorAll('.indexer-enabled-toggle').forEach(toggle => {
        toggle.addEventListener('change', async () => {
          try {
            await apiPatch(`/indexers/${toggle.dataset.indexerId}`, { enabled: toggle.checked });
            toast(toggle.checked ? 'Indexer enabled' : 'Indexer disabled', 'info');
          } catch (err) {
            toast(err.message, 'error');
            toggle.checked = !toggle.checked;
          }
        });
      });

    } catch (err) {
      container.innerHTML = renderError('Failed to load indexers', err.message, renderAcquisitionIndexers);
    }
  }

  function showIndexerModal(existingIndexer = null) {
    const isEditing = !!existingIndexer;

    const { close } = showModal({
      title: isEditing ? 'Edit Indexer' : 'Add Indexer',
      content: `
        <form id="indexer-form" novalidate>
          <div class="form-group">
            <label class="form-label" for="indexer-name-input">Name</label>
            <input type="text" class="form-input" id="indexer-name-input" required placeholder="e.g., My Torznab Indexer" value="${isEditing ? escapeHtml(existingIndexer.name || '') : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="indexer-type-select">Type</label>
            <select class="form-input" id="indexer-type-select">
              <option value="torznab" ${existingIndexer?.type === 'torznab' ? 'selected' : ''}>Torznab</option>
              <option value="newznab" ${existingIndexer?.type === 'newznab' ? 'selected' : ''}>Newznab</option>
              <option value="rss" ${existingIndexer?.type === 'rss' ? 'selected' : ''}>RSS</option>
              <option value="custom" ${existingIndexer?.type === 'custom' ? 'selected' : ''}>Custom</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="indexer-url-input">URL</label>
            <input type="url" class="form-input" id="indexer-url-input" required placeholder="https://indexer.example.com/api" value="${isEditing ? escapeHtml(existingIndexer.url || '') : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="indexer-apikey-input">API Key</label>
            <input type="text" class="form-input" id="indexer-apikey-input" placeholder="Your indexer API key" value="${isEditing ? escapeHtml(existingIndexer.api_key || '') : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="indexer-categories-input">Categories (comma-separated)</label>
            <input type="text" class="form-input" id="indexer-categories-input" placeholder="e.g., 7000,7020" value="${isEditing ? escapeHtml((existingIndexer.categories || []).join(', ')) : ''}">
            <div class="form-hint">Newznab/Torznab category IDs. 7000=Books, 7020=eBooks.</div>
          </div>
          <div class="form-group">
            <label class="form-label" for="indexer-priority-input">Priority</label>
            <input type="number" class="form-input" id="indexer-priority-input" min="0" max="100" placeholder="0 (highest)" value="${isEditing ? (existingIndexer.priority ?? 25) : 25}">
            <div class="form-hint">Lower number = higher priority. Used to sort results.</div>
          </div>
          <div class="form-group">
            <label class="form-label" for="indexer-interval-input">Search Interval (minutes)</label>
            <input type="number" class="form-input" id="indexer-interval-input" min="5" placeholder="60" value="${isEditing ? (existingIndexer.search_interval ?? 60) : 60}">
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">${isEditing ? 'Save' : 'Add'}</button>
          </div>
        </form>
      `,
    });

    const modalElement = document.querySelector('.modal-overlay:last-child .modal');
    if (modalElement) modalElement.style.maxWidth = '560px';

    const indexerForm = document.getElementById('indexer-form');
    indexerForm.querySelector('[data-action="cancel"]').addEventListener('click', close);

    indexerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitButton = indexerForm.querySelector('button[type="submit"]');
      submitButton.disabled = true;

      const categoriesRaw = document.getElementById('indexer-categories-input').value.trim();
      const indexerPayload = {
        name: document.getElementById('indexer-name-input').value.trim(),
        type: document.getElementById('indexer-type-select').value,
        url: document.getElementById('indexer-url-input').value.trim(),
        api_key: document.getElementById('indexer-apikey-input').value.trim() || null,
        categories: categoriesRaw ? categoriesRaw.split(',').map(categoryString => categoryString.trim()).filter(Boolean) : [],
        priority: parseInt(document.getElementById('indexer-priority-input').value, 10) || 25,
        search_interval: parseInt(document.getElementById('indexer-interval-input').value, 10) || 60,
      };

      if (!indexerPayload.name) {
        toast('Indexer name is required', 'error');
        submitButton.disabled = false;
        return;
      }
      if (!indexerPayload.url) {
        toast('Indexer URL is required', 'error');
        submitButton.disabled = false;
        return;
      }

      try {
        if (isEditing) {
          await apiPatch(`/indexers/${existingIndexer.id}`, indexerPayload);
          toast('Indexer updated', 'success');
        } else {
          await apiPost('/indexers', indexerPayload);
          toast('Indexer added', 'success');
        }
        close();
        renderAcquisitionIndexers();
      } catch (err) {
        toast(err.message, 'error');
        submitButton.disabled = false;
      }
    });
  }

  // --- Acquisition: Download Clients ---

  async function renderAcquisitionClients() {
    const container = document.getElementById('acq-tab-content');
    if (!container) return;

    try {
      const clientsData = await apiGet('/download-clients');
      const clientItems = Array.isArray(clientsData) ? clientsData : (clientsData?.items || []);

      container.innerHTML = `
        <div class="page-header" style="margin-bottom:var(--space-6)">
          <h2>Download Clients</h2>
          <div class="actions">
            <button class="btn btn-primary" id="add-client-btn">${icon('plus', 16)} Add Client</button>
          </div>
        </div>
        ${clientItems.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.server}</div>
            <h3>No download clients configured</h3>
            <p>Add a download client to handle grabbed downloads from indexers.</p>
          </div>
        ` : `
          <div class="acq-client-list">
            ${clientItems.map(clientItem => `
              <div class="card acq-client-card" data-client-id="${clientItem.id}">
                <div class="acq-client-header">
                  <div class="acq-client-type-icon">${clientTypeIcon(clientItem.type)}</div>
                  <div class="acq-client-info">
                    <div class="acq-client-name">${escapeHtml(clientItem.name || 'Unnamed')}</div>
                    <div class="acq-client-meta">
                      <span class="badge badge-muted">${escapeHtml(clientItem.type || 'unknown')}</span>
                      ${clientItem.host ? `<span class="text-caption">${escapeHtml(clientItem.host)}${clientItem.port ? ':' + clientItem.port : ''}</span>` : ''}
                      ${clientItem.use_ssl ? `<span class="badge badge-teal">SSL</span>` : ''}
                    </div>
                  </div>
                  <div class="acq-client-actions">
                    <label class="form-toggle">
                      <input type="checkbox" class="client-enabled-toggle" data-client-id="${clientItem.id}" ${clientItem.enabled !== false ? 'checked' : ''}>
                    </label>
                    <button class="btn btn-ghost btn-sm client-test-btn" data-client-id="${clientItem.id}" aria-label="Test client">${icon('zap', 14)} Test</button>
                    <button class="btn btn-ghost btn-sm client-edit-btn" data-client-id="${clientItem.id}" aria-label="Edit client">${icon('edit', 14)}</button>
                    <button class="btn btn-ghost btn-sm client-delete-btn" data-client-id="${clientItem.id}" aria-label="Delete client">${icon('trash', 14)}</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      `;

      // Bind add
      document.getElementById('add-client-btn')?.addEventListener('click', () => showClientModal());

      // Bind edit
      container.querySelectorAll('.client-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const clientDetail = clientItems.find(clientItem => clientItem.id === btn.dataset.clientId);
          if (clientDetail) showClientModal(clientDetail);
        });
      });

      // Bind delete
      container.querySelectorAll('.client-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          showConfirmModal({
            title: 'Delete Client',
            message: 'This download client will be permanently removed.',
            confirmText: 'Delete',
            onConfirm: async () => {
              try {
                await apiDelete(`/download-clients/${btn.dataset.clientId}`);
                toast('Client deleted', 'success');
                renderAcquisitionClients();
              } catch (err) { toast(err.message, 'error'); }
            },
          });
        });
      });

      // Bind test
      container.querySelectorAll('.client-test-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.innerHTML = `${icon('zap', 14)} Testing...`;
          try {
            const testResult = await apiPost(`/download-clients/${btn.dataset.clientId}/test`, {});
            if (testResult?.success) {
              toast('Client connection successful', 'success');
            } else {
              toast(`Client test failed: ${testResult?.error || 'Unknown error'}`, 'error');
            }
          } catch (err) { toast(err.message, 'error'); }
          btn.disabled = false;
          btn.innerHTML = `${icon('zap', 14)} Test`;
        });
      });

      // Bind toggle
      container.querySelectorAll('.client-enabled-toggle').forEach(toggle => {
        toggle.addEventListener('change', async () => {
          try {
            await apiPatch(`/download-clients/${toggle.dataset.clientId}`, { enabled: toggle.checked });
            toast(toggle.checked ? 'Client enabled' : 'Client disabled', 'info');
          } catch (err) {
            toast(err.message, 'error');
            toggle.checked = !toggle.checked;
          }
        });
      });

    } catch (err) {
      container.innerHTML = renderError('Failed to load download clients', err.message, renderAcquisitionClients);
    }
  }

  function showClientModal(existingClient = null) {
    const isEditing = !!existingClient;

    const { close } = showModal({
      title: isEditing ? 'Edit Download Client' : 'Add Download Client',
      content: `
        <form id="client-form" novalidate>
          <div class="form-group">
            <label class="form-label" for="client-name-input">Name</label>
            <input type="text" class="form-input" id="client-name-input" required placeholder="e.g., My qBittorrent" value="${isEditing ? escapeHtml(existingClient.name || '') : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="client-type-select">Type</label>
            <select class="form-input" id="client-type-select">
              <option value="qbittorrent" ${existingClient?.type === 'qbittorrent' ? 'selected' : ''}>qBittorrent</option>
              <option value="transmission" ${existingClient?.type === 'transmission' ? 'selected' : ''}>Transmission</option>
              <option value="deluge" ${existingClient?.type === 'deluge' ? 'selected' : ''}>Deluge</option>
              <option value="direct" ${existingClient?.type === 'direct' ? 'selected' : ''}>Direct Download</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="client-host-input">Host</label>
            <input type="text" class="form-input" id="client-host-input" required placeholder="localhost" value="${isEditing ? escapeHtml(existingClient.host || '') : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="client-port-input">Port</label>
            <input type="number" class="form-input" id="client-port-input" placeholder="8080" value="${isEditing ? (existingClient.port || '') : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="client-username-input">Username</label>
            <input type="text" class="form-input" id="client-username-input" placeholder="Optional" value="${isEditing ? escapeHtml(existingClient.username || '') : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="client-password-input">Password</label>
            <input type="password" class="form-input" id="client-password-input" placeholder="Optional" value="${isEditing ? escapeHtml(existingClient.password || '') : ''}">
          </div>
          <div class="form-group">
            <label class="form-toggle" for="client-ssl-toggle">
              <input type="checkbox" id="client-ssl-toggle" ${existingClient?.use_ssl ? 'checked' : ''}>
              Use SSL
            </label>
          </div>
          <div class="form-group">
            <label class="form-label" for="client-directory-input">Download Directory</label>
            <input type="text" class="form-input" id="client-directory-input" placeholder="/downloads/ebooks" value="${isEditing ? escapeHtml(existingClient.download_directory || '') : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="client-category-input">Category / Label</label>
            <input type="text" class="form-input" id="client-category-input" placeholder="ironshelf" value="${isEditing ? escapeHtml(existingClient.category || '') : ''}">
            <div class="form-hint">Torrent category to keep Ironshelf downloads organized.</div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">${isEditing ? 'Save' : 'Add'}</button>
          </div>
        </form>
      `,
    });

    const modalElement = document.querySelector('.modal-overlay:last-child .modal');
    if (modalElement) modalElement.style.maxWidth = '560px';

    const clientForm = document.getElementById('client-form');
    clientForm.querySelector('[data-action="cancel"]').addEventListener('click', close);

    clientForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitButton = clientForm.querySelector('button[type="submit"]');
      submitButton.disabled = true;

      const clientPayload = {
        name: document.getElementById('client-name-input').value.trim(),
        type: document.getElementById('client-type-select').value,
        host: document.getElementById('client-host-input').value.trim(),
        port: parseInt(document.getElementById('client-port-input').value, 10) || null,
        username: document.getElementById('client-username-input').value.trim() || null,
        password: document.getElementById('client-password-input').value || null,
        use_ssl: document.getElementById('client-ssl-toggle').checked,
        download_directory: document.getElementById('client-directory-input').value.trim() || null,
        category: document.getElementById('client-category-input').value.trim() || null,
      };

      if (!clientPayload.name) {
        toast('Client name is required', 'error');
        submitButton.disabled = false;
        return;
      }
      if (!clientPayload.host) {
        toast('Host is required', 'error');
        submitButton.disabled = false;
        return;
      }

      try {
        if (isEditing) {
          await apiPatch(`/download-clients/${existingClient.id}`, clientPayload);
          toast('Client updated', 'success');
        } else {
          await apiPost('/download-clients', clientPayload);
          toast('Client added', 'success');
        }
        close();
        renderAcquisitionClients();
      } catch (err) {
        toast(err.message, 'error');
        submitButton.disabled = false;
      }
    });
  }

  // --- Keyboard Shortcuts ---

  document.addEventListener('keydown', (e) => {
    // Escape closes search overlay, modals, zoom
    if (e.key === 'Escape') {
      if (notificationPanelOpen) {
        closeNotificationPanel();
        return;
      }
      const searchOverlay = document.getElementById('global-search-overlay');
      if (searchOverlay) {
        globalSearchOpen = false;
        searchOverlay.remove();
        return;
      }
      const modal = document.querySelector('.modal-overlay');
      if (modal) {
        modal.remove();
        return;
      }
      const zoom = document.querySelector('.cover-zoom-overlay');
      if (zoom) {
        zoom.remove();
        return;
      }
      if (sidebarOpen) {
        closeSidebar();
      }
    }

    // `/` opens global search (only when not typing in an input)
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (activeTag !== 'input' && activeTag !== 'textarea' && activeTag !== 'select') {
        e.preventDefault();
        openGlobalSearch();
      }
    }
  });

  // --- Cloud Login ---

  let cloudToken = null;
  let cloudServiceUrl = null;

  async function renderCloudLogin() {
    setTitle(['Sign in with Ironshelf Cloud']);
    breadcrumbTrail = [];

    // Try to get cloud service URL from server's claim-status
    let claimStatus = null;
    try {
      claimStatus = await fetch(`${API}/auth/claim-status`).then(r => r.ok ? r.json() : null).catch(() => null);
    } catch { /* ignore */ }

    const defaultCloudUrl = claimStatus?.cloud_service_url || CLOUD_API;

    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <div class="brand">
            <h1 class="text-brand">Ironshelf</h1>
            <p>Sign in with Ironshelf Cloud</p>
          </div>
          <form id="cloud-login-form" novalidate>
            <div class="form-group">
              <label class="form-label" for="cloud-email">Email or Username</label>
              <input type="text" class="form-input" id="cloud-email" name="email_or_username" required autocomplete="email" autofocus>
            </div>
            <div class="form-group">
              <label class="form-label" for="cloud-password">Password</label>
              <input type="password" class="form-input" id="cloud-password" name="password" required autocomplete="current-password">
            </div>
            <input type="hidden" id="cloud-service-url" value="${escapeHtml(defaultCloudUrl)}">
            <button type="submit" class="btn btn-primary btn-lg">${icon('globe', 18)} Sign In</button>
          </form>
          <div class="login-footer">
            <a href="#/login">Back to server login</a>
          </div>
        </div>
      </div>
    `;

    document.getElementById('cloud-login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in...';

      const serviceUrl = document.getElementById('cloud-service-url').value;

      try {
        // Authenticate with the central cloud service
        const cloudResponse = await fetch(`${serviceUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email_or_username: document.getElementById('cloud-email').value,
            password: document.getElementById('cloud-password').value,
          }),
        });

        if (!cloudResponse.ok) {
          const errorData = await cloudResponse.json().catch(() => ({}));
          throw new Error(errorData.error || 'Cloud authentication failed');
        }

        const cloudData = await cloudResponse.json();
        if (!cloudData.ok || !cloudData.data?.token) {
          throw new Error('Invalid response from cloud service');
        }

        // Store the cloud token and service URL for the server picker
        cloudToken = cloudData.data.token;
        cloudServiceUrl = serviceUrl;

        // If this is a direct server login (server is claimed), try to get a token directly
        if (claimStatus?.is_claimed && claimStatus?.server_id) {
          await cloudLoginToServer(serviceUrl, cloudData.data.token, claimStatus.server_id);
        } else {
          // Show server picker — user picks which server to connect to
          navigateTo('/cloud-servers');
        }
      } catch (err) {
        toast(err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    });
  }

  // Remove (unclaim) a server from the cloud account. Owner-authed via the cloud
  // JWT, so it works even when the server itself is offline/broken — unlike the
  // server-side /auth/unclaim path, which needs the server reachable. Returns
  // true if removed, false if the user cancelled the confirm.
  async function removeCloudServer(serviceUrl, serviceToken, serverId, serverName) {
    if (!window.confirm(`Remove "${serverName}" from your cloud account?\n\nThis unlinks it from Ironshelf Cloud (it does not modify the server itself). You can re-claim it later from the server's Settings → Ironshelf Cloud.`)) {
      return false;
    }
    const response = await fetch(`${serviceUrl}/servers/${serverId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${serviceToken}` },
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to remove server');
    }
    return true;
  }

  async function renderCloudServerPicker() {
    setTitle(['Select Server']);
    breadcrumbTrail = [];

    if (!cloudToken || !cloudServiceUrl) {
      navigateTo('/cloud-login');
      return;
    }

    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card" style="max-width: 500px">
          <div class="brand">
            <h1 class="text-brand">Ironshelf</h1>
            <p>Select a server to connect to</p>
          </div>
          <div class="cloud-servers-loading">
            <div class="skeleton skeleton-text" style="width:100%;height:48px;margin-bottom:8px"></div>
            <div class="skeleton skeleton-text" style="width:100%;height:48px;margin-bottom:8px"></div>
          </div>
        </div>
      </div>
    `;

    try {
      // Fetch servers the user has access to (owned + shared)
      const [ownedResponse, sharedResponse] = await Promise.all([
        fetch(`${cloudServiceUrl}/servers/mine`, {
          headers: { 'Authorization': `Bearer ${cloudToken}` },
        }),
        fetch(`${cloudServiceUrl}/servers/shared`, {
          headers: { 'Authorization': `Bearer ${cloudToken}` },
        }),
      ]);

      const ownedData = ownedResponse.ok ? await ownedResponse.json() : { data: [] };
      const sharedData = sharedResponse.ok ? await sharedResponse.json() : { data: [] };

      const ownedServers = ownedData.data || [];
      const sharedServers = sharedData.data || [];
      const allServers = [
        ...ownedServers.map(s => ({ ...s, relationship: 'owned' })),
        ...sharedServers.map(s => ({ ...s, relationship: 'shared' })),
      ];

      if (allServers.length === 0) {
        document.querySelector('.cloud-servers-loading').innerHTML = `
          <div class="empty-state">
            ${icon('server', 48)}
            <p>No servers available</p>
            <p class="text-muted" style="font-size:0.85rem">You don't have access to any servers yet. Ask a server owner to share access with you.</p>
          </div>
          <div class="login-footer" style="margin-top:1rem">
            <a href="#/login">Back to server login</a>
          </div>
        `;
        return;
      }

      const serverListHtml = allServers.map(server => `
        <div class="cloud-server-row" style="display:flex;gap:8px;align-items:stretch">
          <button class="cloud-server-btn" style="flex:1" data-server-id="${escapeHtml(server.id)}" data-server-url="${escapeHtml(server.url)}">
            <div class="cloud-server-info">
              <span class="cloud-server-name">${icon('server', 16)} ${escapeHtml(server.name)}</span>
              <span class="cloud-server-url text-muted">${escapeHtml(server.url)}</span>
            </div>
            <div class="cloud-server-meta">
              <span class="badge ${server.relationship === 'owned' ? 'badge-primary' : 'badge-default'}">${server.relationship}</span>
              ${server.is_verified ? `<span class="badge badge-success" title="Verified">${icon('check', 12)}</span>` : `<span class="badge badge-warning" title="Unverified">${icon('alertCircle', 12)}</span>`}
            </div>
          </button>
          ${server.relationship === 'owned' ? `<button class="btn btn-danger cloud-server-remove" data-server-id="${escapeHtml(server.id)}" data-server-name="${escapeHtml(server.name)}" title="Remove server" aria-label="Remove ${escapeHtml(server.name)}">${icon('trash', 16)}</button>` : ''}
        </div>
      `).join('');

      document.querySelector('.cloud-servers-loading').innerHTML = `
        <div class="cloud-server-list">
          ${serverListHtml}
        </div>
        <div class="login-footer" style="margin-top:1rem">
          <a href="#/cloud-login">Sign in as different user</a> | <a href="#/login">Back to server login</a>
        </div>
      `;

      // Bind click handlers for server buttons
      document.querySelectorAll('.cloud-server-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const serverId = btn.dataset.serverId;
          btn.disabled = true;
          btn.style.opacity = '0.6';
          try {
            await cloudLoginToServer(cloudServiceUrl, cloudToken, serverId);
          } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false;
            btn.style.opacity = '1';
          }
        });
      });

      // Bind remove handlers (owned servers only)
      document.querySelectorAll('.cloud-server-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
          const serverId = btn.dataset.serverId;
          const serverName = btn.dataset.serverName;
          btn.disabled = true;
          try {
            const removed = await removeCloudServer(cloudServiceUrl, cloudToken, serverId, serverName);
            if (removed) {
              toast(`Removed "${serverName}"`, 'success');
              renderCloudServerPicker();
            } else {
              btn.disabled = false;
            }
          } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      toast('Failed to load servers: ' + err.message, 'error');
      document.querySelector('.cloud-servers-loading').innerHTML = `
        <div class="empty-state">
          ${icon('alertCircle', 48)}
          <p>Failed to load servers</p>
          <p class="text-muted">${escapeHtml(err.message)}</p>
        </div>
        <div class="login-footer" style="margin-top:1rem">
          <a href="#/cloud-login">Try again</a>
        </div>
      `;
    }
  }

  /**
   * Complete cloud login: get a server access token from the cloud service,
   * then send it to the server's cloud-login endpoint to create a local session.
   */
  async function cloudLoginToServer(serviceUrl, centralToken, serverId) {
    // 1. Get a short-lived server access token from the cloud service
    const tokenResponse = await fetch(`${serviceUrl}/servers/${serverId}/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${centralToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to get server access token');
    }

    const tokenData = await tokenResponse.json();
    if (!tokenData.ok || !tokenData.data?.server_access_token) {
      throw new Error('Invalid token response from cloud service');
    }

    // 2. Send the server access token to the server's cloud-login endpoint
    const cloudLoginResponse = await fetch(`${API}/auth/cloud-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ cloud_token: tokenData.data.server_access_token }),
    });

    if (!cloudLoginResponse.ok) {
      const errorData = await cloudLoginResponse.json().catch(() => ({}));
      throw new Error(errorData.error || 'Server rejected cloud login');
    }

    // 3. Session cookie is set by the server response. Check auth and navigate.
    cloudToken = null;
    cloudServiceUrl = null;

    if (await checkAuth()) {
      startNotificationPolling();
      fetchServerVersion();
      toast('Signed in via Ironshelf Cloud', 'success');
      navigateTo('/');
    } else {
      throw new Error('Cloud login succeeded but session was not established');
    }
  }

  // --- Init ---

  window.addEventListener('hashchange', route);

  window.addEventListener('DOMContentLoaded', async () => {
    // Hosted dashboard: a cloud-reset deep link, or no server chosen yet, shows
    // the connect/cloud screen instead of the normal app bootstrap.
    if (HOSTED && (window.location.hash.includes('cloud-reset') || !SERVER_URL)) {
      renderConnectServer();
      return;
    }

    if (await checkAuth()) {
      startNotificationPolling();
      fetchServerVersion(); // fire-and-forget; populates sidebar + settings
      if (!getHashPath() || getHashPath() === '/login') {
        navigateTo('/');
      } else {
        route();
      }
    } else {
      stopNotificationPolling();
      // Allow cloud login routes without redirecting to /login
      const currentPath = getHashPath();
      if (currentPath === '/cloud-login' || currentPath === '/cloud-servers') {
        route();
      } else {
        navigateTo('/login');
      }
    }
  });

  // Bind retry buttons via delegation
  document.addEventListener('click', (e) => {
    if (e.target.id === 'retry-btn' || e.target.closest('#retry-btn')) {
      route();
    }
  });

  // --- Missing Metadata page (linked from notifications) ---

  async function renderMissingMetadata() {
    if (!await checkAuth()) return;
    setTitle(['Books Missing Metadata']);
    breadcrumbTrail = [{ label: 'Home', path: '/' }, { label: 'Missing Metadata', path: '/books/missing-metadata' }];

    renderShell(`
      <div class="page-header"><h1>Books Missing Metadata</h1></div>
      ${skeletonCards(6)}
    `, 'libraries');

    try {
      const libraries = await apiGet('/libraries').catch(() => []);
      const libraryList = Array.isArray(libraries) ? libraries : (libraries?.items || []);
      let allBooks = [];

      for (const library of libraryList) {
        const booksResponse = await apiGet(`/libraries/${library.id}/books?per_page=200`).catch(() => ({ items: [] }));
        const books = Array.isArray(booksResponse) ? booksResponse : (booksResponse?.items || []);
        allBooks = allBooks.concat(books.filter(book => !book.description));
      }

      let bodyContent = `
        <div class="page-header">
          <h1>Books Missing Metadata (${allBooks.length})</h1>
        </div>
      `;

      if (allBooks.length === 0) {
        bodyContent += renderEmptyState('All books have metadata', 'Every book in your library has a description.');
      } else {
        bodyContent += `<p style="color:var(--color-text-dim);margin-bottom:var(--space-6)">These books have no description. Click a book to view it, then use "Enrich Metadata" to fetch information from Google Books or Open Library.</p>`;
        bodyContent += '<div class="grid grid-4">';
        for (const book of allBooks) {
          const coverUrl = book.has_cover ? `${API}/books/${book.id}/cover${mediaToken()}` : '';
          const authorNames = (book.author_names || []).join(', ');
          bodyContent += `
            <div class="book-card" data-book-id="${book.id}" role="link" tabindex="0">
              ${coverUrl ? `<img src="${coverUrl}" class="book-cover" loading="lazy" alt="">` : '<div class="book-cover-placeholder"></div>'}
              <div class="book-title">${escapeHtml(book.title)}</div>
              ${authorNames ? `<div class="book-meta">${escapeHtml(authorNames)}</div>` : ''}
            </div>
          `;
        }
        bodyContent += '</div>';
      }

      renderShell(bodyContent, 'settings');

      document.querySelectorAll('[data-book-id]').forEach(card => {
        const handler = () => navigateTo(`/book/${card.dataset.bookId}`);
        card.addEventListener('click', handler);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });
    } catch (err) {
      renderShell(renderError('Failed to load books', String(err?.message || err), renderMissingMetadata), 'libraries');
    }
  }

  function renderConnectServer() {
    const app = document.getElementById('app');
    const savedUrl = localStorage.getItem('ironshelf_server_url') || '';

    app.innerHTML = `
      <div class="login-container">
        <div class="login-card" style="max-width:520px">
          <div class="login-brand" style="text-align:center;margin-bottom:var(--space-6)">
            <img src="/favicon.svg" alt="" width="48" height="48" style="margin-bottom:var(--space-2)">
            <h1 class="text-brand" style="font-size:var(--text-2xl)">Ironshelf</h1>
            <p style="color:var(--color-text-dim);font-size:var(--text-sm)">Your books, everywhere</p>
          </div>

          <!-- Cloud Sign In -->
          <div id="cloud-section" style="margin-bottom:var(--space-6)">
            <div id="cloud-login-view">
              <button class="btn btn-primary" style="width:100%;padding:var(--space-3)" id="cloud-signin-btn">
                Sign in with Ironshelf Cloud
              </button>
              <p style="text-align:center;margin-top:var(--space-2);font-size:var(--text-sm);color:var(--color-muted)">
                Access your servers from anywhere · <a href="#" id="cloud-register-link">Create account</a>
              </p>
              <p style="text-align:center;margin-top:var(--space-2);font-size:var(--text-xs);color:var(--color-muted)">
                Your server must be reachable over HTTPS (e.g. its Cloudflare Tunnel URL). Connecting to a plain http:// address from this HTTPS dashboard is blocked by the browser.
              </p>
            </div>

            <!-- Cloud Login Form (hidden initially) -->
            <form id="cloud-login-form" style="display:none">
              <h3 style="margin-bottom:var(--space-4)">Sign in to Ironshelf Cloud</h3>
              <div class="form-group">
                <label>Email or Username</label>
                <input type="text" class="form-input" name="email_or_username" required autofocus>
              </div>
              <div class="form-group">
                <label>Password</label>
                <input type="password" class="form-input" name="password" required>
              </div>
              <div id="cloud-login-status" style="margin-bottom:var(--space-3)"></div>
              <button type="submit" class="btn btn-primary" style="width:100%">Sign In</button>
              <p style="text-align:center;margin-top:var(--space-2);font-size:var(--text-sm)">
                <a href="#" id="cloud-forgot-link">Forgot password?</a> · <a href="#" id="cloud-back-link">← Back</a>
              </p>
            </form>

            <!-- Cloud Forgot Password Form (hidden initially) -->
            <form id="cloud-forgot-form" style="display:none">
              <h3 style="margin-bottom:var(--space-4)">Reset your password</h3>
              <p style="color:var(--color-muted);font-size:var(--text-sm);margin-bottom:var(--space-3)">Enter your account email and we'll send you a reset link.</p>
              <div class="form-group">
                <label>Email</label>
                <input type="email" class="form-input" name="email" required autofocus>
              </div>
              <div id="cloud-forgot-status" style="margin-bottom:var(--space-3)"></div>
              <button type="submit" class="btn btn-primary" style="width:100%">Send reset link</button>
              <p style="text-align:center;margin-top:var(--space-2);font-size:var(--text-sm)">
                <a href="#" id="cloud-forgot-back-link">← Back to sign in</a>
              </p>
            </form>

            <!-- Cloud Reset Password Form (shown via emailed link) -->
            <form id="cloud-reset-form" style="display:none">
              <h3 style="margin-bottom:var(--space-4)">Choose a new password</h3>
              <div class="form-group">
                <label>New Password</label>
                <input type="password" class="form-input" name="new_password" required minlength="8" placeholder="At least 8 characters">
              </div>
              <div class="form-group">
                <label>Confirm Password</label>
                <input type="password" class="form-input" name="confirm_password" required minlength="8">
              </div>
              <div id="cloud-reset-status" style="margin-bottom:var(--space-3)"></div>
              <button type="submit" class="btn btn-primary" style="width:100%">Set new password</button>
            </form>

            <!-- Cloud Register Form (hidden initially) -->
            <form id="cloud-register-form" style="display:none">
              <h3 style="margin-bottom:var(--space-4)">Create Ironshelf Cloud Account</h3>
              <div class="form-group">
                <label>Email</label>
                <input type="email" class="form-input" name="email" required>
              </div>
              <div class="form-group">
                <label>Username</label>
                <input type="text" class="form-input" name="username" required placeholder="2-32 chars, alphanumeric">
              </div>
              <div class="form-group">
                <label>Password</label>
                <input type="password" class="form-input" name="password" required minlength="8">
              </div>
              <div id="cloud-register-status" style="margin-bottom:var(--space-3)"></div>
              <button type="submit" class="btn btn-primary" style="width:100%">Create Account</button>
              <p style="text-align:center;margin-top:var(--space-2);font-size:var(--text-sm)">
                Already have an account? <a href="#" id="cloud-login-link">Sign in</a>
              </p>
            </form>

            <!-- Server Picker (shown after cloud auth) -->
            <div id="cloud-server-picker" style="display:none">
              <h3 style="margin-bottom:var(--space-4)">Your Servers</h3>
              <div id="cloud-server-list"></div>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-6)">
            <hr style="flex:1;border:none;border-top:1px solid var(--color-border)">
            <span style="color:var(--color-muted);font-size:var(--text-sm)">or connect directly</span>
            <hr style="flex:1;border:none;border-top:1px solid var(--color-border)">
          </div>

          <!-- Direct Server URL -->
          <form id="connect-form">
            <div class="form-group">
              <label for="server-url">Server URL</label>
              <input type="url" class="form-input" id="server-url" name="server_url"
                     placeholder="https://books.example.com"
                     value="${escapeHtml(savedUrl)}">
              <p class="form-hint" style="margin-top:var(--space-1);font-size:var(--text-sm);color:var(--color-muted)">
                Must be an <strong>HTTPS</strong> URL — this dashboard is served over HTTPS and browsers block insecure (http://) connections. Use your Cloudflare Tunnel URL or any HTTPS reverse-proxy address. Plain <code>http://</code> LAN addresses won't work here; open the server's own UI directly for local-only access.
              </p>
            </div>
            <div id="connect-status" style="margin-bottom:var(--space-4)"></div>
            <button type="submit" class="btn btn-ghost" style="width:100%" id="connect-btn">
              Connect to Server
            </button>
          </form>

          <div style="text-align:center;margin-top:var(--space-6);padding-top:var(--space-4);border-top:1px solid var(--color-border)">
            <p style="font-size:var(--text-sm);color:var(--color-muted)">
              Don't have a server? <a href="https://github.com/LightWraith8268/ironshelf" target="_blank" rel="noopener">Install Ironshelf</a>
            </p>
          </div>
        </div>
      </div>
    `;

    document.getElementById('connect-form').onsubmit = async (e) => {
      e.preventDefault();
      const urlInput = document.getElementById('server-url');
      const statusDiv = document.getElementById('connect-status');
      const connectBtn = document.getElementById('connect-btn');
      let serverUrl = urlInput.value.trim().replace(/\/+$/, '');

      if (!serverUrl) return;

      connectBtn.disabled = true;
      connectBtn.textContent = 'Connecting...';
      statusDiv.innerHTML = '';

      try {
        // Test connection by hitting /health
        const response = await fetch(`${serverUrl}/health`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        const health = await response.json();

        if (health.status !== 'healthy' && health.status !== 'ok') {
          throw new Error('Server is not healthy');
        }

        statusDiv.innerHTML = '<p style="color:var(--color-success)">&#10003; Connected to Ironshelf v' + escapeHtml(health.version || '?') + '</p>';

        // Save and reload
        localStorage.setItem('ironshelf_server_url', serverUrl);
        setTimeout(() => window.location.reload(), 500);

      } catch (err) {
        statusDiv.innerHTML = '<p style="color:var(--color-danger)">&#10007; Could not connect: ' + escapeHtml(String(err.message || err)) + '</p>';
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect';
      }
    };

    // --- Cloud auth event handlers ---

    const cloudLoginView = document.getElementById('cloud-login-view');
    const cloudLoginForm = document.getElementById('cloud-login-form');
    const cloudRegisterForm = document.getElementById('cloud-register-form');
    const cloudForgotForm = document.getElementById('cloud-forgot-form');
    const cloudResetForm = document.getElementById('cloud-reset-form');
    const cloudServerPicker = document.getElementById('cloud-server-picker');

    function showView(view) {
      cloudLoginView.style.display = view === 'buttons' ? '' : 'none';
      cloudLoginForm.style.display = view === 'login' ? '' : 'none';
      cloudRegisterForm.style.display = view === 'register' ? '' : 'none';
      cloudForgotForm.style.display = view === 'forgot' ? '' : 'none';
      cloudResetForm.style.display = view === 'reset' ? '' : 'none';
      cloudServerPicker.style.display = view === 'servers' ? '' : 'none';
    }

    document.getElementById('cloud-signin-btn')?.addEventListener('click', () => showView('login'));
    document.getElementById('cloud-register-link')?.addEventListener('click', (e) => { e.preventDefault(); showView('register'); });
    document.getElementById('cloud-back-link')?.addEventListener('click', (e) => { e.preventDefault(); showView('buttons'); });
    document.getElementById('cloud-login-link')?.addEventListener('click', (e) => { e.preventDefault(); showView('login'); });
    document.getElementById('cloud-forgot-link')?.addEventListener('click', (e) => { e.preventDefault(); showView('forgot'); });
    document.getElementById('cloud-forgot-back-link')?.addEventListener('click', (e) => { e.preventDefault(); showView('login'); });

    // Cloud forgot password — request a reset email.
    cloudForgotForm.onsubmit = async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const statusDiv = document.getElementById('cloud-forgot-status');
      const submitBtn = e.target.querySelector('button[type="submit"]');
      statusDiv.innerHTML = '';
      submitBtn.disabled = true;
      try {
        await fetch(`${CLOUD_API}/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: form.get('email') }),
        });
        // Always show the same message (no account enumeration).
        statusDiv.innerHTML = `<p style="color:var(--color-success)">If an account exists for that email, a reset link is on its way. Check your inbox — and your spam/junk folder if you don't see it within a few minutes.</p>`;
      } catch (err) {
        statusDiv.innerHTML = `<p style="color:var(--color-danger)">${escapeHtml(String(err.message))}</p>`;
      } finally {
        submitBtn.disabled = false;
      }
    };

    // Cloud reset password — set a new password using the emailed token.
    let cloudResetToken = '';
    cloudResetForm.onsubmit = async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const statusDiv = document.getElementById('cloud-reset-status');
      const submitBtn = e.target.querySelector('button[type="submit"]');
      statusDiv.innerHTML = '';
      const newPassword = form.get('new_password');
      if (newPassword !== form.get('confirm_password')) {
        statusDiv.innerHTML = `<p style="color:var(--color-danger)">Passwords do not match.</p>`;
        return;
      }
      submitBtn.disabled = true;
      try {
        const res = await fetch(`${CLOUD_API}/auth/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: cloudResetToken, new_password: newPassword }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Reset failed');
        statusDiv.innerHTML = `<p style="color:var(--color-success)">Password updated. You can sign in now.</p>`;
        // Clear the token from the URL and return to sign-in.
        if (window.history?.replaceState) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        setTimeout(() => showView('login'), 1200);
      } catch (err) {
        statusDiv.innerHTML = `<p style="color:var(--color-danger)">${escapeHtml(String(err.message))}</p>`;
      } finally {
        submitBtn.disabled = false;
      }
    };

    // If arriving from a reset email (#/cloud-reset?token=...), show the reset form.
    const resetTokenMatch = window.location.hash.match(/[?&]token=([^&]+)/);
    if (window.location.hash.includes('cloud-reset') && resetTokenMatch) {
      cloudResetToken = decodeURIComponent(resetTokenMatch[1]);
      showView('reset');
    }

    // Cloud login
    cloudLoginForm.onsubmit = async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const statusDiv = document.getElementById('cloud-login-status');
      statusDiv.innerHTML = '';

      try {
        const res = await fetch(`${CLOUD_API}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email_or_username: form.get('email_or_username'),
            password: form.get('password'),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');

        localStorage.setItem('ironshelf_cloud_token', data.data.token);
        localStorage.setItem('ironshelf_cloud_username', data.data.username);

        // Load user's servers
        await loadCloudServers(data.data.token);
      } catch (err) {
        statusDiv.innerHTML = `<p style="color:var(--color-danger)">${escapeHtml(String(err.message))}</p>`;
      }
    };

    // Cloud register
    cloudRegisterForm.onsubmit = async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const statusDiv = document.getElementById('cloud-register-status');
      statusDiv.innerHTML = '';

      try {
        const res = await fetch(`${CLOUD_API}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: form.get('email'),
            username: form.get('username'),
            password: form.get('password'),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');

        localStorage.setItem('ironshelf_cloud_token', data.data.token);
        localStorage.setItem('ironshelf_cloud_username', data.data.username);

        // Show servers (will be empty for new user)
        await loadCloudServers(data.data.token);
      } catch (err) {
        statusDiv.innerHTML = `<p style="color:var(--color-danger)">${escapeHtml(String(err.message))}</p>`;
      }
    };

    async function loadCloudServers(token) {
      showView('servers');
      const serverList = document.getElementById('cloud-server-list');
      serverList.innerHTML = '<p style="color:var(--color-muted)">Loading servers...</p>';

      try {
        const [ownedRes, sharedRes] = await Promise.all([
          fetch(`${CLOUD_API}/servers/mine`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${CLOUD_API}/servers/shared`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        const owned = (await ownedRes.json())?.data || [];
        const shared = (await sharedRes.json())?.data || [];
        const allServers = [
          ...owned.map(s => ({ ...s, _owned: true })),
          ...shared.map(s => ({ ...s, _owned: false })),
        ];

        if (allServers.length === 0) {
          serverList.innerHTML = `
            <div style="text-align:center;padding:var(--space-6);color:var(--color-muted)">
              <p>No servers linked to your account yet.</p>
              <p style="font-size:var(--text-sm);margin-top:var(--space-2)">
                Install Ironshelf on your server, then claim it from Settings → Ironshelf Cloud.
              </p>
            </div>
          `;
          return;
        }

        serverList.innerHTML = allServers.map(server => `
          <div class="cloud-server-row" style="display:flex;gap:8px;align-items:stretch">
            <button class="cloud-server-btn" style="flex:1" data-server-url="${escapeHtml(server.url)}" data-server-id="${escapeHtml(server.id)}" data-server-name="${escapeHtml(server.name)}">
              <span class="cloud-server-name">${escapeHtml(server.name)}</span>
              <span class="cloud-server-url">${escapeHtml(server.url)}</span>
            </button>
            ${server._owned ? `<button class="btn btn-danger cloud-server-remove" data-server-id="${escapeHtml(server.id)}" data-server-name="${escapeHtml(server.name)}" title="Remove server" aria-label="Remove ${escapeHtml(server.name)}">${icon('trash', 16)}</button>` : ''}
          </div>
        `).join('');

        // Click server → connect
        serverList.querySelectorAll('.cloud-server-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const serverUrl = btn.dataset.serverUrl;
            const serverId = btn.dataset.serverId;
            btn.disabled = true;
            btn.querySelector('.cloud-server-url').textContent = 'Connecting...';

            try {
              // Get access token from cloud
              const tokenRes = await fetch(`${CLOUD_API}/servers/${serverId}/token`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
              });
              const tokenData = await tokenRes.json();
              if (!tokenRes.ok) throw new Error(tokenData.error || 'Failed to get access token');

              // Login to server with cloud token
              const loginRes = await fetch(`${serverUrl}/api/v1/auth/cloud-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cloud_token: tokenData.data.server_access_token }),
              });

              if (!loginRes.ok) {
                const err = await loginRes.json().catch(() => ({}));
                throw new Error(err.error || 'Server rejected cloud login');
              }

              // Store the server session as a Bearer token (cross-origin: no
              // cookie), then save the URL and reload into the connected UI.
              const loginData = await loginRes.json().catch(() => ({}));
              if (loginData?.session_id) {
                localStorage.setItem('ironshelf_server_token', loginData.session_id);
              }
              localStorage.setItem('ironshelf_server_url', serverUrl);
              window.location.reload();
            } catch (err) {
              btn.disabled = false;
              btn.querySelector('.cloud-server-url').textContent = err.message;
              btn.querySelector('.cloud-server-url').style.color = 'var(--color-danger)';
            }
          });
        });

        // Remove (unclaim) owned servers — works even if the server is offline
        serverList.querySelectorAll('.cloud-server-remove').forEach(btn => {
          btn.addEventListener('click', async () => {
            const serverId = btn.dataset.serverId;
            const serverName = btn.dataset.serverName;
            btn.disabled = true;
            try {
              const removed = await removeCloudServer(CLOUD_API, token, serverId, serverName);
              if (removed) {
                toast(`Removed "${serverName}"`, 'success');
                await loadCloudServers(token);
              } else {
                btn.disabled = false;
              }
            } catch (err) {
              toast(err.message, 'error');
              btn.disabled = false;
            }
          });
        });
      } catch (err) {
        serverList.innerHTML = `<p style="color:var(--color-danger)">Failed to load servers: ${escapeHtml(String(err.message))}</p>`;
      }
    }
  }

})();
