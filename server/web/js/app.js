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
    if (parts.length === 0) return { name: 'libraries', params: {} };

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
      login: renderLogin,
      register: renderRegister,
      libraries: renderLibraries,
      library: () => renderLibrary(parsed.params.id),
      author: () => renderAuthor(parsed.params.id),
      series: () => renderSeries(parsed.params.id),
      book: () => renderBook(parsed.params.id),
      settings: renderSettings,
      users: renderUsers,
    };

    const handler = handlers[parsed.name];
    if (handler) {
      currentRoute = parsed.name;
      await handler();
    } else {
      navigateTo('/libraries');
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
      { id: 'libraries', label: 'Libraries', icon: 'library', path: '/libraries' },
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

    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <div class="brand">
            <h1 class="text-brand">Iron<em>&</em>shelf</h1>
            <p>Your self-hosted library</p>
          </div>
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
          <div class="login-footer">
            No account? <a href="#/register">Create one</a>
          </div>
        </div>
      </div>
    `;

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
        navigateTo('/libraries');
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

    document.getElementById('app').innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <div class="brand">
            <h1 class="text-brand">Iron<em>&</em>shelf</h1>
            <p>Create your account</p>
          </div>
          <form id="register-form" novalidate>
            <div class="form-group">
              <label class="form-label" for="reg-username">Username</label>
              <input type="text" class="form-input" id="reg-username" name="username" required autocomplete="username" autofocus>
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
        await apiPost('/auth/register', {
          username: document.getElementById('reg-username').value,
          password: document.getElementById('reg-password').value,
        });
        toast('Account created successfully!', 'success');
        await checkAuth();
        navigateTo('/libraries');
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
                ${formats.map(f => `
                  <a href="${API}/books/${bookId}/file?format=${f.kind}" class="btn btn-primary" download aria-label="Download ${f.kind} format">
                    ${icon('download', 16)} ${escapeHtml(f.kind.toUpperCase())}
                  </a>
                `).join('')}
              </div>
            ` : ''}

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
    // Escape closes modals
    if (e.key === 'Escape') {
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
  });

  // --- Init ---

  window.addEventListener('hashchange', route);

  window.addEventListener('DOMContentLoaded', async () => {
    if (await checkAuth()) {
      if (!getHashPath() || getHashPath() === '/' || getHashPath() === '/login') {
        navigateTo('/libraries');
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
