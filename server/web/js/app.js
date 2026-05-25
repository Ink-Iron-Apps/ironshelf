// ============================================================
// Ironshelf — Production Web UI (Vanilla JS)
// ============================================================

(() => {
  'use strict';

  const API = '/api/v1';
  let currentUser = null;
  let sidebarOpen = false;

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
    const focusableElements = overlay.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    if (firstFocusable) firstFocusable.focus();

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal();
        return;
      }
      if (e.key === 'Tab') {
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

    closeSidebar();

    const handlers = {
      home: renderHome,
      login: renderLogin,
      register: renderRegister,
      libraries: renderLibraries,
      library: () => renderLibrary(parsed.params.id),
      author: () => renderAuthor(parsed.params.id),
      series: () => renderSeries(parsed.params.id),
      book: () => renderBook(parsed.params.id),
      read: () => openReader(parsed.params.id),
      collections: renderCollections,
      collection: () => renderCollectionDetail(parsed.params.id),
      settings: renderSettings,
      users: renderUsers,
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

  let readerScriptLoaded = false;

  function loadReaderScript() {
    if (readerScriptLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/js/reader.js';
      script.onload = () => { readerScriptLoaded = true; resolve(); };
      script.onerror = () => reject(new Error('Failed to load reader module'));
      document.head.appendChild(script);
    });
  }

  async function openReader(bookId) {
    try {
      await loadReaderScript();
      if (window.IronshelfReader) {
        window.IronshelfReader.open(bookId);
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
              <button class="sort-direction-btn" id="toolbar-sort-dir" aria-label="Toggle sort direction" title="${currentDirection === 'asc' ? 'Ascending' : 'Descending'}">
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
      { id: 'collections', label: 'Collections', icon: 'collection', path: '/collections' },
      { id: 'settings', label: 'Settings', icon: 'settings', path: '/settings' },
    ];

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
      navigateTo('/login');
    });

    document.getElementById('mobile-menu-btn')?.addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);
    document.getElementById('sidebar-search-btn')?.addEventListener('click', openGlobalSearch);
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

      setTitle([library.name]);
      breadcrumbTrail[1].label = library.name;

      const authors = Array.isArray(authorsResponse) ? authorsResponse : (authorsResponse?.items || authorsResponse?.data || []);
      const totalPages = authorsResponse?.total_pages || 1;

      // Build alpha jump
      const letters = [...new Set(authors.map(a => (a.name || '')[0]?.toUpperCase()).filter(Boolean))].sort();

      let bodyContent = `
        <div class="page-header">
          <h1>${escapeHtml(library.name)}</h1>
          <div class="actions">
            ${currentUser?.is_owner ? `<button class="btn btn-ghost" id="edit-library-btn" aria-label="Edit library">${icon('edit', 16)} Edit</button>` : ''}
          </div>
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
    } catch (err) {
      renderShell(renderError('Failed to load library', err.message, () => renderLibrary(libraryId)), 'libraries');
    }
  }

  // --- Author Detail ---

  async function renderAuthor(authorId) {
    if (!await checkAuth()) return;

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

      setTitle([book.title]);
      breadcrumbTrail = [
        { label: 'Libraries', path: '/libraries' },
        { label: book.title, path: `/book/${bookId}` },
      ];

      const coverUrl = book.has_cover ? `${API}/books/${bookId}/cover` : '';
      const formats = book.formats || [];
      const tags = book.tags || [];
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
                ${formats.some(f => f.kind.toLowerCase() === 'epub') ? `
                  <a href="#/read/${bookId}" class="btn btn-read" aria-label="Read this book">
                    ${icon('bookOpen', 16)} Read
                  </a>
                ` : ''}
                ${formats.map(f => `
                  <a href="${API}/books/${bookId}/file?format=${f.kind}" class="btn btn-primary" download aria-label="Download ${f.kind} format">
                    ${icon('download', 16)} ${escapeHtml(f.kind.toUpperCase())}
                  </a>
                `).join('')}
                ${renderAddToCollectionButton(bookId)}
              </div>
            ` : `
              <div class="book-detail-formats">
                ${renderAddToCollectionButton(bookId)}
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
                ${book.description}
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
                    <td class="text-right">${!u.is_owner ? `<button class="btn btn-ghost btn-sm delete-user-btn" data-user-id="${u.id}" aria-label="Remove ${escapeHtml(u.username)}">${icon('trash', 14)}</button>` : ''}</td>
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
  }

  // --- Home / Dashboard ---

  async function renderHome() {
    if (!await checkAuth()) return;
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
            <div class="continue-reading-card" data-read-book-id="${book.id}" role="link" tabindex="0" aria-label="Continue reading ${escapeHtml(book.title)}">
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
        const handler = () => navigateTo(`/read/${card.dataset.readBookId}`);
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
        <div class="search-overlay-results" id="global-search-results"></div>
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

  // --- Keyboard Shortcuts ---

  document.addEventListener('keydown', (e) => {
    // Escape closes search overlay, modals, zoom
    if (e.key === 'Escape') {
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
      if (!getHashPath() || getHashPath() === '/login') {
        navigateTo('/');
      } else {
        route();
      }
    } else {
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
