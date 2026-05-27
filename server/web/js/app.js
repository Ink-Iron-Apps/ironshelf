// ============================================================
// Ironshelf — Production Web UI (Vanilla JS)
// ============================================================

(() => {
  'use strict';

  const API = '/api/v1';
  let currentUser = null;
  let sidebarOpen = false;

  // --- Notification State ---
  let notificationUnreadCount = 0;
  let notificationPollTimer = null;
  let notificationPanelOpen = false;
  let activeScanLibraryId = null;
  let scanPollTimer = null;
  let conversionPollTimer = null;

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
    const doc = parser.parseFromString(html, 'text/html');

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

    cleanNode(doc.body);
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
    const response = await fetch(`${API}${path}`, {
      headers: {
        'Content-Type': 'application/json',
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
    return response.json();
  }

  function apiGet(path) { return api(path); }
  function apiPost(path, body) { return api(path, { method: 'POST', body: JSON.stringify(body) }); }
  function apiPatch(path, body) { return api(path, { method: 'PATCH', body: JSON.stringify(body) }); }
  function apiDelete(path) { return api(path, { method: 'DELETE' }); }

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
    notificationPollTimer = setInterval(fetchNotificationCount, 30000);
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
    const parts = hash.split('/').filter(Boolean);
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

    // Clear any active conversion poll from previous page
    if (conversionPollTimer) {
      clearInterval(conversionPollTimer);
      conversionPollTimer = null;
    }

    const handlers = {
      home: renderHome,
      login: renderLogin,
      register: renderRegister,
      libraries: renderLibraries,
      library: () => renderLibrary(parsed.params.id),
      author: () => renderAuthor(parsed.params.id),
      series: () => renderSeries(parsed.params.id),
      book: () => renderBook(parsed.params.id),
      read: () => openReader(parsed.params.id, detectReaderFormat(parsed.params.sub) || 'epub'),
      collections: renderCollections,
      collection: () => renderCollectionDetail(parsed.params.id),
      settings: renderSettings,
      users: renderUsers,
      stats: renderStats,
      activity: renderActivity,
      queue: renderReadingQueue,
      highlights: renderHighlights,
      genres: renderGenres,
      genre: () => renderGenreDetail(parsed.params.id),
      webhooks: renderWebhooks,
      duplicates: renderDuplicates,
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

  async function openReader(bookId, format) {
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
        reader.open(bookId);
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
      return true;
    } catch {
      return false;
    }
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

  function renderToolbar({ searchPlaceholder = 'Search...', sortOptions = [], currentSort = '', currentDirection = 'asc', onSearch, onSort }) {
    const sortOptionsHtml = sortOptions.map(opt =>
      `<option value="${opt.value}" ${opt.value === currentSort ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`
    ).join('');

    return `
      <div class="toolbar">
        <div class="toolbar-left">
          <div class="search-bar">
            <span class="search-icon">${Icons.search}</span>
            <input type="search" placeholder="${escapeHtml(searchPlaceholder)}" aria-label="Search" id="toolbar-search">
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

    const navItems = [
      { id: 'home', label: 'Home', icon: 'home', path: '/' },
      { id: 'libraries', label: 'Libraries', icon: 'library', path: '/libraries' },
      { id: 'genres', label: 'Genres', icon: 'collection', path: '/genres' },
      { id: 'collections', label: 'Collections', icon: 'collection', path: '/collections' },
      { id: 'queue', label: 'Queue', icon: 'clock', path: '/queue' },
      { id: 'highlights', label: 'Highlights', icon: 'edit', path: '/highlights' },
      { id: 'settings', label: 'Settings', icon: 'settings', path: '/settings' },
    ];

    navItems.push({ id: 'activity', label: 'Activity', icon: 'activity', path: '/activity' });

    navItems.push({ id: 'stats', label: 'Stats', icon: 'barChart', path: '/stats' });

    if (currentUser?.is_owner) {
      navItems.push({ id: 'users', label: 'Users', icon: 'users', path: '/users' });
    }

    const navHtml = navItems.map(item => `
      <a href="#${item.path}" class="${activePage === item.id ? 'active' : ''}" aria-current="${activePage === item.id ? 'page' : 'false'}">
        ${icon(item.icon)}
        <span>${item.label}</span>
      </a>
    `).join('');

    const bottomNavHtml = navItems.map(item => `
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
            <span class="text-brand">Iron<em>&</em>shelf</span>
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
          <div class="sidebar-section-label">Navigation</div>
          <nav class="sidebar-nav">
            ${navHtml}
          </nav>
          <div class="sidebar-footer">
            <div class="user-info">
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

    const isOidcEnabled = serverInfo?.oidc_enabled === true;
    const oidcButtonHtml = isOidcEnabled ? `
      <div class="login-divider">or</div>
      <a href="${API}/auth/oidc/login" class="btn btn-sso">${icon('shield', 18)} Sign in with SSO</a>
    ` : '';

    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <div class="brand">
            <h1 class="text-brand">Iron<em>&</em>shelf</h1>
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
        await apiPost('/auth/login', {
          username: document.getElementById('login-username').value,
          password: document.getElementById('login-password').value,
        });
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
            <h1 class="text-brand">Iron<em>&</em>shelf</h1>
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
    breadcrumbTrail = [{ label: 'Libraries', path: '/libraries' }];

    // Show skeleton
    renderShell(`
      <div class="page-header">
        <h1>Libraries</h1>
      </div>
      ${skeletonList(3)}
    `, 'libraries');

    try {
      const libraries = await apiGet('/libraries');
      let bodyContent = '';

      const addBtnHtml = currentUser?.is_owner
        ? `<div class="actions"><button class="btn btn-primary" id="add-library-btn">${icon('plus', 16)} Add Library</button></div>`
        : '';

      bodyContent += `<div class="page-header"><h1>Libraries</h1>${addBtnHtml}</div>`;

      if (!libraries || libraries.length === 0) {
        bodyContent += `
          <div class="empty-state">
            <div class="empty-state-icon">${Icons.library}</div>
            <h3>No libraries yet</h3>
            <p>Add a Calibre library or folder to start browsing your collection.</p>
            ${currentUser?.is_owner ? '<button class="btn btn-primary btn-lg" id="add-library-empty-btn">Add Your First Library</button>' : ''}
          </div>
        `;
      } else {
        bodyContent += '<div class="grid grid-libraries">';
        for (const lib of libraries) {
          const sourceLabel = lib.source_kind === 'calibre' ? 'Calibre' : 'Folder';
          bodyContent += `
            <div class="card card-interactive library-card" data-library-id="${lib.id}" role="link" tabindex="0" aria-label="${escapeHtml(lib.name)} library">
              <div class="library-card-header">
                <div class="library-card-icon">${lib.source_kind === 'calibre' ? Icons.book : Icons.folder}</div>
                <span class="badge badge-teal">${escapeHtml(sourceLabel)}</span>
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

      renderShell(bodyContent, 'libraries');

      // Bind events
      document.querySelectorAll('[data-library-id]').forEach(card => {
        const handler = () => navigateTo(`/library/${card.dataset.libraryId}`);
        card.addEventListener('click', handler);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

      document.getElementById('add-library-btn')?.addEventListener('click', showAddLibraryModal);
      document.getElementById('add-library-empty-btn')?.addEventListener('click', showAddLibraryModal);
    } catch (err) {
      renderShell(renderError('Failed to load libraries', err.message, () => renderLibraries()), 'libraries');
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
            <input type="text" class="form-input" id="lib-path" name="path" required placeholder="/mnt/books/calibre-library" value="${isEdit ? escapeHtml(editData.path || '') : ''}">
            <p class="form-hint">Absolute path to the Calibre library or book folder</p>
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

  // --- Library Detail (Authors) ---

  let librarySearchQuery = '';
  let librarySortField = 'name';
  let librarySortDirection = 'asc';
  let libraryPage = 1;

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
      const params = new URLSearchParams({
        page: libraryPage,
        per_page: 50,
        sort: librarySortField,
        direction: librarySortDirection,
      });
      if (librarySearchQuery) params.set('search', librarySearchQuery);

      const [library, authorsResponse] = await Promise.all([
        apiGet(`/libraries/${libraryId}`),
        apiGet(`/libraries/${libraryId}/authors?${params}`),
      ]);

      if (isStaleNavigation(thisGeneration)) return;

      setTitle([library.name]);
      breadcrumbTrail[1].label = library.name;

      const authors = Array.isArray(authorsResponse) ? authorsResponse : (authorsResponse?.items || authorsResponse?.data || []);
      const totalPages = authorsResponse?.total_pages || 1;

      // Build alpha jump
      const letters = [...new Set(authors.map(a => (a.name || '')[0]?.toUpperCase()).filter(Boolean))].sort();

      const isScanningThisLibrary = activeScanLibraryId === libraryId;

      let bodyContent = `
        <div class="page-header">
          <h1>${escapeHtml(library.name)}</h1>
          <div class="actions">
            <button class="btn btn-secondary" id="scan-library-btn" ${isScanningThisLibrary ? 'disabled' : ''} aria-label="Scan library for new books">
              ${icon('scan', 16)} ${isScanningThisLibrary ? 'Scanning...' : 'Scan'}
            </button>
            ${currentUser?.is_owner ? `<button class="btn btn-ghost" id="edit-library-btn" aria-label="Edit library">${icon('edit', 16)} Edit</button>` : ''}
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
        ${renderToolbar({
          searchPlaceholder: 'Search authors...',
          sortOptions: [
            { value: 'name', label: 'Name' },
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
        bodyContent += `<div style="display:flex;gap:var(--space-4);align-items:flex-start">`;

        // Alpha jump sidebar (desktop only)
        if (letters.length > 5) {
          bodyContent += `<div class="alpha-jump" aria-label="Jump to letter">`;
          for (const letter of letters) {
            bodyContent += `<a href="#letter-${letter}" aria-label="Jump to ${letter}">${letter}</a>`;
          }
          bodyContent += `</div>`;
        }

        bodyContent += `<div class="list-group" style="flex:1">`;
        let currentLetter = '';
        for (const author of authors) {
          const firstLetter = (author.name || '')[0]?.toUpperCase() || '';
          if (firstLetter !== currentLetter && letters.length > 5) {
            currentLetter = firstLetter;
            bodyContent += `<div id="letter-${firstLetter}" style="padding:var(--space-2) var(--space-5);background:var(--color-bg-elevated);font-size:var(--text-xs);font-weight:600;color:var(--color-teal-bright);letter-spacing:0.05em;text-transform:uppercase">${firstLetter}</div>`;
          }

          bodyContent += `
            <div class="list-item" data-author-id="${author.id}" role="link" tabindex="0" aria-label="${escapeHtml(author.name)}">
              <div class="list-item-content">
                <div class="list-item-icon">${Icons.author}</div>
                <div class="list-item-text">
                  <div class="list-item-name">${escapeHtml(author.name)}</div>
                  <div class="list-item-subtitle">${author.book_count || 0} book${(author.book_count || 0) !== 1 ? 's' : ''}${author.series_count ? ` · ${author.series_count} series` : ''}</div>
                </div>
              </div>
              <div class="list-item-meta">
                <span class="nav-icon" style="width:16px;height:16px;color:var(--color-muted)">${Icons.chevronRight}</span>
              </div>
            </div>
          `;
        }
        bodyContent += `</div></div>`;
        bodyContent += renderPagination(libraryPage, totalPages);
      }

      renderShell(bodyContent, 'libraries');

      // Bind
      document.querySelectorAll('[data-author-id]').forEach(item => {
        const handler = () => navigateTo(`/author/${item.dataset.authorId}`);
        item.addEventListener('click', handler);
        item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

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

      bindPagination(document.querySelector('.main-body'), (page) => {
        libraryPage = page;
        renderLibrary(libraryId);
      });

      document.getElementById('edit-library-btn')?.addEventListener('click', () => {
        showAddLibraryModal(library);
      });

      document.getElementById('scan-library-btn')?.addEventListener('click', () => {
        startLibraryScan(libraryId);
      });
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

      let bodyContent = `
        <div class="page-header">
          <h1>${escapeHtml(author.name)}</h1>
        </div>
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

      renderShell(bodyContent, 'libraries');

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

      renderShell(bodyContent, 'libraries');

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

      const coverUrl = book.has_cover ? `${API}/books/${bookId}/cover` : '';
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
            <h1>${escapeHtml(book.title)}</h1>
            ${book.authors ? `<a class="author-link" href="#/author/${book.author_id || ''}">${escapeHtml(Array.isArray(book.authors) ? book.authors.join(', ') : book.authors)}</a>` : ''}
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
                  <a href="${API}/books/${bookId}/file?format=${f.kind}" class="btn btn-primary" download aria-label="Download ${f.kind} format">
                    ${icon('download', 16)} ${escapeHtml(f.kind.toUpperCase())}
                  </a>
                `).join('')}
                ${renderAddToCollectionButton(bookId)}
                <button class="btn btn-secondary" id="add-to-queue-btn">${icon('clock', 16)} Add to Queue</button>
                <div id="convert-btn-container"></div>
                ${(!book.description || currentUser?.is_owner) ? `<button class="btn btn-secondary" id="enrich-metadata-btn">${icon('zap', 16)} Enrich Metadata</button>` : ''}
              </div>
            ` : `
              <div class="book-detail-formats">
                ${renderAddToCollectionButton(bookId)}
                <button class="btn btn-secondary" id="add-to-queue-btn">${icon('clock', 16)} Add to Queue</button>
                <div id="convert-btn-container"></div>
                ${(!book.description || currentUser?.is_owner) ? `<button class="btn btn-secondary" id="enrich-metadata-btn">${icon('zap', 16)} Enrich Metadata</button>` : ''}
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

      renderShell(bodyContent, 'libraries');

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
        queueBtn.disabled = true;
        try {
          await apiPost('/me/queue', { book_id: bookId });
          toast('Added to reading queue', 'success');
          queueBtn.innerHTML = `${icon('check', 16)} In Queue`;
        } catch (err) {
          toast(err.message, 'error');
          queueBtn.disabled = false;
        }
      });

      // Bind enrich metadata
      document.getElementById('enrich-metadata-btn')?.addEventListener('click', () => showMetadataSearchModal(bookId));

      // Render ratings & reviews below description
      renderBookRatingsAndReviews(bookId, '.book-detail-info');

      // Render conversion button if converters available
      renderConversionButton(bookId, '#convert-btn-container');
    } catch (err) {
      renderShell(renderError('Failed to load book', err.message, () => renderBook(bookId)), 'libraries');
    }
  }

  // --- Settings ---

  async function renderSettings() {
    if (!await checkAuth()) return;
    setTitle(['Settings']);
    breadcrumbTrail = [{ label: 'Settings', path: '/settings' }];

    renderShell(`
      <div class="page-header"><h1>Settings</h1></div>
      ${skeletonList(2)}
    `, 'settings');

    try {
      const keys = await apiGet('/auth/api-keys').catch(() => []);

      let bodyContent = `
        <div class="page-header"><h1>Settings</h1></div>

        <div class="settings-section">
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

        <div class="settings-section">
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

        <div class="settings-section">
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

        ${currentUser?.is_owner ? `
          <div class="settings-section">
            <h3 style="display:flex;align-items:center;gap:var(--space-2)">${icon('globe', 20)} Integrations</h3>
            <p class="description">Manage webhooks, duplicate detection, and other advanced features.</p>
            <div style="display:flex;flex-wrap:wrap;gap:var(--space-3)">
              <a href="#/webhooks" class="btn btn-secondary">${icon('globe', 16)} Webhooks</a>
              <a href="#/duplicates" class="btn btn-secondary">${icon('search', 16)} Duplicate Detection</a>
            </div>
          </div>
        ` : ''}

        <div class="settings-section">
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
      `;

      renderShell(bodyContent, 'settings');

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

            showModal({
              title: 'API Key Created',
              description: 'Copy this key now. It will not be shown again.',
              content: `
                <div class="api-key-display" id="new-key-value">${escapeHtml(result.key)}</div>
                <button class="btn btn-secondary" id="copy-key-btn">${icon('copy', 16)} Copy to Clipboard</button>
              `,
              actions: '<button class="btn btn-primary" data-action="done">Done</button>',
            });

            const modal = document.querySelector('.modal-overlay:last-child');
            modal.querySelector('[data-action="done"]')?.addEventListener('click', () => {
              modal.remove();
              renderSettings();
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
                renderSettings();
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
          const response = await fetch(`${API}/export/all`, { credentials: 'same-origin' });
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
          renderSettings();
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
    } catch (err) {
      renderShell(renderError('Failed to load settings', err.message, () => renderSettings()), 'settings');
    }
  }

  // --- Users (owner only) ---

  async function renderUsers() {
    if (!await checkAuth()) return;
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
      const hasDashboardContent = continueBooks.length > 0 || collectionsList.length > 0;

      if (!hasDashboardContent) {
        // Fall back to libraries view
        renderLibraries();
        return;
      }

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
        for (const book of continueBooks) {
          const coverUrl = book.has_cover ? `${API}/books/${book.id}/cover` : '';
          const progressPercent = Math.round((book.progress || 0) * 100);
          bodyContent += `
            <div class="continue-reading-card" data-read-book-id="${book.id}" data-read-format="${book.format || 'epub'}" role="link" tabindex="0" aria-label="Continue reading ${escapeHtml(book.title)}">
              ${coverUrl
                ? `<div class="book-cover"><img src="${coverUrl}" alt="" loading="lazy"><div class="cover-progress-wrap"><div class="cover-progress-bar"><div class="cover-progress-fill" style="width:${progressPercent}%"></div></div><div class="cover-progress-label">${progressPercent}%</div></div></div>`
                : `<div class="book-cover-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg><div class="cover-progress-wrap"><div class="cover-progress-bar"><div class="cover-progress-fill" style="width:${progressPercent}%"></div></div><div class="cover-progress-label">${progressPercent}%</div></div></div>`
              }
              <div class="book-title" title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</div>
              <div class="book-meta">${book.authors ? escapeHtml(Array.isArray(book.authors) ? book.authors.join(', ') : book.authors) : ''}</div>
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

      // Recently Added section
      let recentBooks = [];
      if (libraries && libraries.length > 0) {
        try {
          const recentResponse = await apiGet(`/libraries/${libraries[0].id}/books?sort=added&direction=desc&per_page=12`).catch(() => null);
          recentBooks = Array.isArray(recentResponse) ? recentResponse : (recentResponse?.items || recentResponse?.data || []);
        } catch { /* ignore */ }
      }

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

      renderShell(bodyContent, 'home');

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
                  ${book.authors ? `<div class="result-subtitle">${escapeHtml(Array.isArray(book.authors) ? book.authors.join(', ') : book.authors)}</div>` : ''}
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
          const coverUrl = book.has_cover ? `${API}/books/${book.id}/cover` : '';
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
              <div class="book-meta">${book.authors ? escapeHtml(Array.isArray(book.authors) ? book.authors.join(', ') : book.authors) : ''}</div>
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

    const showServerTab = currentUser?.is_owner;

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
    const coverUrl = book.has_cover ? `${API}/books/${book.id}/cover` : '';
    return `
      <div class="book-card" data-book-id="${book.id}" role="link" tabindex="0" aria-label="${escapeHtml(book.title)}">
        ${showSeriesIndex && book.series_index ? `<span class="series-badge">#${book.series_index}</span>` : ''}
        ${coverUrl
          ? `<div class="book-cover"><img src="${coverUrl}" alt="" loading="lazy"></div>`
          : `<div class="book-cover-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>`
        }
        <div class="book-title" title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</div>
        <div class="book-meta">${book.authors ? escapeHtml(Array.isArray(book.authors) ? book.authors.join(', ') : book.authors) : ''}</div>
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
          const coverUrl = queueItem.has_cover ? `${API}/books/${queueItem.book_id || queueItem.id}/cover` : '';
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
              const completedCoverUrl = completedBook.has_cover ? `${API}/books/${completedBook.id}/cover` : '';
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
        ${renderToolbar({
          searchPlaceholder: 'Search in genre...',
          sortOptions: [
            { value: 'title', label: 'Title' },
            { value: 'added', label: 'Date Added' },
            { value: 'rating', label: 'Rating' },
          ],
          currentSort: genreSortField,
          currentDirection: genreSortDirection,
        })}
      `;

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

      renderShell(bodyContent, 'genres');

      // Bind book cards
      document.querySelectorAll('[data-book-id]').forEach(card => {
        const handler = () => navigateTo(`/book/${card.dataset.bookId}`);
        card.addEventListener('click', handler);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });

      bindToolbar(document.querySelector('.main-body'), {
        currentDirection: genreSortDirection,
        onSearch: () => {}, // Server-side search not yet supported for genres
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

    } catch (err) {
      renderShell(renderError('Failed to load genre', err.message, () => renderGenreDetail(genreName)), 'genres');
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
    if (!currentUser?.is_owner) { navigateTo('/settings'); return; }
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
                  const duplicateCoverUrl = duplicateBook.has_cover ? `${API}/books/${duplicateBook.id}/cover` : '';
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
                        <a href="${API}/books/${bookId}/file?format=${targetFormat}" class="btn btn-primary btn-sm" download>${icon('download', 14)} Download ${targetFormat.toUpperCase()}</a>
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
                  <a href="${API}/books/${bookId}/file?format=${targetFormat}" class="btn btn-primary btn-sm" download>${icon('download', 14)} Download ${targetFormat.toUpperCase()}</a>
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
      <div class="settings-section">
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

  // --- Init ---

  window.addEventListener('hashchange', route);

  window.addEventListener('DOMContentLoaded', async () => {
    if (await checkAuth()) {
      startNotificationPolling();
      if (!getHashPath() || getHashPath() === '/login') {
        navigateTo('/');
      } else {
        route();
      }
    } else {
      stopNotificationPolling();
      navigateTo('/login');
    }
  });

  // Bind retry buttons via delegation
  document.addEventListener('click', (e) => {
    if (e.target.id === 'retry-btn' || e.target.closest('#retry-btn')) {
      route();
    }
  });

})();
