// ============================================================
// Ironshelf — EPUB Reader Module (IIFE)
// ============================================================

const IronshelfReader = (() => {
  'use strict';

  const API = '/api/v1';
  const EPUB_JS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/epub.js/0.3.93/epub.min.js';
  const STORAGE_THEME_KEY = 'ironshelf_reader_theme';
  const STORAGE_FONT_SIZE_KEY = 'ironshelf_reader_font_size';

  let epubJsLoaded = false;
  let currentBook = null;
  let currentRendition = null;
  let currentBookId = null;
  let chromeVisible = true;
  let chromeTimeout = null;
  let tocVisible = false;
  let settingsVisible = false;
  let saveProgressTimer = null;
  let tableOfContents = [];
  let currentLocationData = null;
  let containerElement = null;
  let swipeStartX = 0;
  let swipeStartY = 0;

  // --- Settings ---
  function getTheme() {
    return localStorage.getItem(STORAGE_THEME_KEY) || 'dark';
  }

  function setTheme(theme) {
    localStorage.setItem(STORAGE_THEME_KEY, theme);
  }

  function getFontSize() {
    return parseInt(localStorage.getItem(STORAGE_FONT_SIZE_KEY) || '100', 10);
  }

  function setFontSizeStorage(size) {
    localStorage.setItem(STORAGE_FONT_SIZE_KEY, String(size));
  }

  // --- CDN Loader ---
  function loadEpubJs() {
    if (epubJsLoaded && window.ePub) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = EPUB_JS_CDN;
      script.onload = () => { epubJsLoaded = true; resolve(); };
      script.onerror = () => reject(new Error('Failed to load epub.js from CDN'));
      document.head.appendChild(script);
    });
  }

  // --- Progress API ---
  async function fetchProgress(bookId) {
    try {
      const response = await fetch(`${API}/books/${bookId}/progress`, {
        credentials: 'same-origin',
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (Array.isArray(data)) {
        return data.find(entry => entry.format === 'EPUB') || data[0] || null;
      }
      return data;
    } catch {
      return null;
    }
  }

  async function saveProgress(bookId, locator, percent) {
    try {
      await fetch(`${API}/books/${bookId}/progress`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: 'EPUB',
          locator: locator,
          percent: percent,
        }),
      });
    } catch {
      // Silent fail — non-critical
    }
  }

  function debouncedSaveProgress(bookId, locator, percent) {
    if (saveProgressTimer) clearTimeout(saveProgressTimer);
    saveProgressTimer = setTimeout(() => {
      saveProgress(bookId, locator, percent);
    }, 2000);
  }

  // --- UI Construction ---
  function buildReaderHTML(bookTitle) {
    return `
      <div class="reader-progress-bar">
        <div class="reader-progress-bar-fill" id="reader-progress-fill" style="width:0%"></div>
      </div>

      <div class="reader-chrome-top" id="reader-chrome-top">
        <div class="reader-chrome-left">
          <button class="reader-chrome-btn" id="reader-close-btn" aria-label="Close reader" title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <button class="reader-chrome-btn" id="reader-toc-btn" aria-label="Table of contents" title="Contents">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
        </div>
        <span class="reader-title" id="reader-title">${escapeHtml(bookTitle)}</span>
        <div class="reader-chrome-right">
          <button class="reader-chrome-btn" id="reader-settings-btn" aria-label="Reading settings" title="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          <button class="reader-chrome-btn" id="reader-fullscreen-btn" aria-label="Toggle fullscreen" title="Fullscreen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          </button>
        </div>
      </div>

      <div class="reader-chrome-bottom" id="reader-chrome-bottom">
        <div class="reader-bottom-info">
          <span id="reader-chapter-display" class="reader-chapter-name"></span>
          <span id="reader-page-display"></span>
          <span id="reader-percent-display">0%</span>
        </div>
      </div>

      <div class="reader-viewport" id="reader-viewport">
        <div class="reader-viewport-inner" id="reader-area"></div>
        <div class="reader-nav-zone reader-nav-zone-left" id="reader-nav-left" aria-label="Previous page"></div>
        <div class="reader-nav-zone reader-nav-zone-right" id="reader-nav-right" aria-label="Next page"></div>
        <div class="reader-nav-arrow reader-nav-arrow-left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </div>
        <div class="reader-nav-arrow reader-nav-arrow-right">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>

      <div class="reader-loading" id="reader-loading">
        <div class="reader-loading-spinner"></div>
        <div class="reader-loading-text">Loading book...</div>
      </div>

      <div class="reader-settings-panel" id="reader-settings-panel">
        <div class="reader-settings-group">
          <div class="reader-settings-label">Font Size</div>
          <div class="reader-font-controls">
            <button class="reader-font-btn" id="reader-font-decrease" aria-label="Decrease font size">A-</button>
            <span class="reader-font-size-display" id="reader-font-size-display">${getFontSize()}%</span>
            <button class="reader-font-btn" id="reader-font-increase" aria-label="Increase font size">A+</button>
          </div>
        </div>
        <div class="reader-settings-group">
          <div class="reader-settings-label">Theme</div>
          <div class="reader-theme-options">
            <button class="reader-theme-btn reader-theme-btn-light" data-theme="light">Light</button>
            <button class="reader-theme-btn reader-theme-btn-sepia" data-theme="sepia">Sepia</button>
            <button class="reader-theme-btn reader-theme-btn-dark" data-theme="dark">Dark</button>
          </div>
        </div>
      </div>

      <div class="reader-toc-overlay" id="reader-toc-overlay"></div>
      <div class="reader-toc" id="reader-toc">
        <div class="reader-toc-header">
          <h3>Contents</h3>
          <button class="reader-chrome-btn" id="reader-toc-close" aria-label="Close table of contents">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="reader-toc-list" id="reader-toc-list" role="list"></div>
      </div>
    `;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // --- Theme Application ---
  function applyTheme(theme) {
    if (!containerElement) return;
    containerElement.classList.remove('reader-theme-light', 'reader-theme-sepia', 'reader-theme-dark');
    containerElement.classList.add(`reader-theme-${theme}`);

    // Update theme button active states
    containerElement.querySelectorAll('.reader-theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });

    // Apply to rendition
    if (currentRendition) {
      const themes = {
        light: { body: { background: '#ffffff', color: '#1a1a1a' } },
        sepia: { body: { background: '#f4ecd8', color: '#5b4636' } },
        dark: { body: { background: '#1a1a1a', color: '#d4d4d4' } },
      };
      currentRendition.themes.default(themes[theme] || themes.dark);
    }

    setTheme(theme);
  }

  function applyFontSize(size) {
    if (!currentRendition) return;
    currentRendition.themes.fontSize(`${size}%`);
    setFontSizeStorage(size);

    const display = document.getElementById('reader-font-size-display');
    if (display) display.textContent = `${size}%`;
  }

  // --- Chrome Visibility ---
  function showChrome() {
    chromeVisible = true;
    if (!containerElement) return;
    containerElement.classList.remove('reader-chrome-hidden');
    resetChromeTimeout();
  }

  function hideChrome() {
    chromeVisible = false;
    if (!containerElement) return;
    containerElement.classList.add('reader-chrome-hidden');
  }

  function toggleChrome() {
    if (chromeVisible) {
      hideChrome();
    } else {
      showChrome();
    }
  }

  function resetChromeTimeout() {
    if (chromeTimeout) clearTimeout(chromeTimeout);
    chromeTimeout = setTimeout(() => {
      if (chromeVisible && !tocVisible && !settingsVisible) {
        hideChrome();
      }
    }, 4000);
  }

  // --- TOC ---
  function openToc() {
    tocVisible = true;
    const overlay = document.getElementById('reader-toc-overlay');
    const panel = document.getElementById('reader-toc');
    if (overlay) overlay.classList.add('visible');
    if (panel) panel.classList.add('visible');
  }

  function closeToc() {
    tocVisible = false;
    const overlay = document.getElementById('reader-toc-overlay');
    const panel = document.getElementById('reader-toc');
    if (overlay) overlay.classList.remove('visible');
    if (panel) panel.classList.remove('visible');
  }

  function renderToc(toc) {
    const list = document.getElementById('reader-toc-list');
    if (!list) return;

    function flattenToc(items, level = 1) {
      let result = [];
      for (const item of items) {
        result.push({ label: item.label, href: item.href, level });
        if (item.subitems && item.subitems.length > 0) {
          result = result.concat(flattenToc(item.subitems, level + 1));
        }
      }
      return result;
    }

    const flatItems = flattenToc(toc);
    list.innerHTML = flatItems.map((item, index) => `
      <button class="reader-toc-item" data-toc-index="${index}" data-href="${escapeHtml(item.href)}" data-level="${item.level}" role="listitem">
        ${escapeHtml(item.label.trim())}
      </button>
    `).join('');

    list.querySelectorAll('.reader-toc-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const href = btn.dataset.href;
        if (currentRendition && href) {
          currentRendition.display(href);
          closeToc();
        }
      });
    });
  }

  // --- Settings Panel ---
  function toggleSettings() {
    settingsVisible = !settingsVisible;
    const panel = document.getElementById('reader-settings-panel');
    if (panel) panel.classList.toggle('visible', settingsVisible);
    if (settingsVisible) showChrome();
  }

  function closeSettings() {
    settingsVisible = false;
    const panel = document.getElementById('reader-settings-panel');
    if (panel) panel.classList.remove('visible');
  }

  // --- Location / Progress Display ---
  function updateLocationDisplay(location) {
    if (!location) return;
    currentLocationData = location;

    const percentEl = document.getElementById('reader-percent-display');
    const pageEl = document.getElementById('reader-page-display');
    const progressFill = document.getElementById('reader-progress-fill');
    const chapterEl = document.getElementById('reader-chapter-display');

    const percent = location.start?.percentage || 0;
    const displayPercent = Math.round(percent * 100);

    if (percentEl) percentEl.textContent = `${displayPercent}%`;
    if (progressFill) progressFill.style.width = `${displayPercent}%`;

    if (pageEl && location.start?.displayed) {
      const { page, total } = location.start.displayed;
      pageEl.textContent = `${page} / ${total}`;
    }

    // Chapter name from TOC
    if (chapterEl && currentBook) {
      const currentHref = location.start?.href;
      if (currentHref && tableOfContents.length > 0) {
        const chapterName = findChapterName(tableOfContents, currentHref);
        chapterEl.textContent = chapterName || '';
      }
    }

    // Save progress (debounced)
    if (currentBookId && location.start?.cfi) {
      debouncedSaveProgress(currentBookId, location.start.cfi, percent);
    }
  }

  function findChapterName(toc, href) {
    for (const item of toc) {
      if (href && item.href && href.includes(item.href.split('#')[0])) {
        return item.label.trim();
      }
      if (item.subitems && item.subitems.length > 0) {
        const found = findChapterName(item.subitems, href);
        if (found) return found;
      }
    }
    return null;
  }

  // --- Core: Open ---
  async function open(bookId) {
    currentBookId = bookId;

    // Create container
    containerElement = document.createElement('div');
    containerElement.className = `reader-container reader-theme-${getTheme()}`;
    containerElement.setAttribute('role', 'application');
    containerElement.setAttribute('aria-label', 'EPUB Reader');
    containerElement.innerHTML = buildReaderHTML('Loading...');
    document.body.appendChild(containerElement);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    bindEvents();
    showChrome();

    try {
      // Load epub.js
      await loadEpubJs();

      // Fetch saved progress
      const savedProgress = await fetchProgress(bookId);

      // Create epub book from the file endpoint
      const bookUrl = `${API}/books/${bookId}/file?format=EPUB`;
      currentBook = ePub(bookUrl);

      // Wait for book to be ready
      await currentBook.ready;

      // Get metadata for title
      const metadata = currentBook.packaging?.metadata;
      if (metadata?.title) {
        const titleEl = document.getElementById('reader-title');
        if (titleEl) titleEl.textContent = metadata.title;
      }

      // Load TOC
      const navigation = await currentBook.loaded.navigation;
      tableOfContents = navigation.toc || [];
      renderToc(tableOfContents);

      // Create rendition
      const readerArea = document.getElementById('reader-area');
      currentRendition = currentBook.renderTo(readerArea, {
        width: '100%',
        height: '100%',
        spread: 'none',
        flow: 'paginated',
      });

      // Apply stored theme and font size
      applyTheme(getTheme());
      applyFontSize(getFontSize());

      // Display at saved location or beginning
      const startLocation = savedProgress?.locator || undefined;
      await currentRendition.display(startLocation);

      // Hide loading
      const loadingEl = document.getElementById('reader-loading');
      if (loadingEl) loadingEl.style.display = 'none';

      // Listen for location changes
      currentRendition.on('relocated', (location) => {
        updateLocationDisplay(location);
      });

      // Handle internal link clicks in epub content
      currentRendition.on('rendered', () => {
        resetChromeTimeout();
      });

    } catch (error) {
      showError(error.message || 'Failed to load this book');
    }
  }

  // --- Error Display ---
  function showError(message) {
    const loadingEl = document.getElementById('reader-loading');
    if (loadingEl) {
      loadingEl.innerHTML = `
        <div class="reader-error">
          <div class="reader-error-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div class="reader-error-title">Unable to open book</div>
          <div class="reader-error-message">${escapeHtml(message)}</div>
          <button class="reader-error-btn" id="reader-error-close">Go Back</button>
        </div>
      `;
      loadingEl.style.display = 'flex';

      document.getElementById('reader-error-close')?.addEventListener('click', () => {
        close();
      });
    }
  }

  // --- Core: Close ---
  function close() {
    // Capture bookId before clearing state
    const bookId = currentBookId;

    // Save final progress immediately
    if (bookId && currentLocationData?.start?.cfi) {
      saveProgress(bookId, currentLocationData.start.cfi, currentLocationData.start.percentage || 0);
    }

    if (saveProgressTimer) clearTimeout(saveProgressTimer);
    if (chromeTimeout) clearTimeout(chromeTimeout);

    // Destroy epub instance
    if (currentBook) {
      try { currentBook.destroy(); } catch {}
    }

    currentBook = null;
    currentRendition = null;
    currentBookId = null;
    currentLocationData = null;
    tableOfContents = [];
    chromeVisible = true;
    tocVisible = false;
    settingsVisible = false;

    // Exit fullscreen if active
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    // Remove container
    if (containerElement) {
      containerElement.remove();
      containerElement = null;
    }

    // Restore body scroll
    document.body.style.overflow = '';

    // Navigate back to book detail
    if (bookId) {
      window.location.hash = `#/book/${bookId}`;
    }
  }

  // --- Event Binding ---
  function bindEvents() {
    if (!containerElement) return;

    // Close button (close() already navigates back to book detail)
    document.getElementById('reader-close-btn')?.addEventListener('click', () => {
      close();
    });

    // TOC toggle
    document.getElementById('reader-toc-btn')?.addEventListener('click', () => {
      if (tocVisible) closeToc();
      else openToc();
    });
    document.getElementById('reader-toc-close')?.addEventListener('click', closeToc);
    document.getElementById('reader-toc-overlay')?.addEventListener('click', closeToc);

    // Settings toggle
    document.getElementById('reader-settings-btn')?.addEventListener('click', toggleSettings);

    // Fullscreen
    document.getElementById('reader-fullscreen-btn')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        containerElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    // Navigation zones
    document.getElementById('reader-nav-left')?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (currentRendition) currentRendition.prev();
    });
    document.getElementById('reader-nav-right')?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (currentRendition) currentRendition.next();
    });

    // Tap center to toggle chrome
    const viewport = document.getElementById('reader-viewport');
    if (viewport) {
      viewport.addEventListener('click', (event) => {
        // Only toggle chrome if clicking the center area (not nav zones)
        const rect = viewport.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const width = rect.width;
        if (clickX > width * 0.25 && clickX < width * 0.75) {
          toggleChrome();
          closeSettings();
        }
      });

      // Touch/swipe handling
      viewport.addEventListener('touchstart', (event) => {
        swipeStartX = event.touches[0].clientX;
        swipeStartY = event.touches[0].clientY;
      }, { passive: true });

      viewport.addEventListener('touchend', (event) => {
        const deltaX = event.changedTouches[0].clientX - swipeStartX;
        const deltaY = event.changedTouches[0].clientY - swipeStartY;

        // Only count horizontal swipes (not vertical scrolls)
        if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
          if (deltaX > 0) {
            if (currentRendition) currentRendition.prev();
          } else {
            if (currentRendition) currentRendition.next();
          }
        }
      }, { passive: true });
    }

    // Keyboard navigation
    const keyHandler = (event) => {
      if (!containerElement || !document.body.contains(containerElement)) {
        document.removeEventListener('keydown', keyHandler);
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
        case 'PageUp':
          event.preventDefault();
          if (currentRendition) currentRendition.prev();
          break;
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          event.preventDefault();
          if (currentRendition) currentRendition.next();
          break;
        case 'Escape':
          event.preventDefault();
          if (tocVisible) { closeToc(); }
          else if (settingsVisible) { closeSettings(); }
          else {
            close();
          }
          break;
        case 'f':
        case 'F':
          if (!event.ctrlKey && !event.metaKey) {
            if (!document.fullscreenElement) {
              containerElement.requestFullscreen().catch(() => {});
            } else {
              document.exitFullscreen().catch(() => {});
            }
          }
          break;
        case 't':
        case 'T':
          if (!event.ctrlKey && !event.metaKey) {
            if (tocVisible) closeToc();
            else openToc();
          }
          break;
      }
    };
    document.addEventListener('keydown', keyHandler);

    // Mouse movement shows chrome
    containerElement.addEventListener('mousemove', () => {
      if (!chromeVisible) showChrome();
      else resetChromeTimeout();
    });

    // Font size controls
    document.getElementById('reader-font-decrease')?.addEventListener('click', () => {
      let size = getFontSize();
      size = Math.max(60, size - 10);
      applyFontSize(size);
    });
    document.getElementById('reader-font-increase')?.addEventListener('click', () => {
      let size = getFontSize();
      size = Math.min(200, size + 10);
      applyFontSize(size);
    });

    // Theme buttons
    containerElement.querySelectorAll('.reader-theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        applyTheme(btn.dataset.theme);
      });
    });

    // Apply initial active state to theme buttons
    const currentTheme = getTheme();
    containerElement.querySelectorAll('.reader-theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === currentTheme);
    });

    // Close settings on outside click
    document.addEventListener('click', function settingsOutsideClick(event) {
      if (!containerElement || !document.body.contains(containerElement)) {
        document.removeEventListener('click', settingsOutsideClick);
        return;
      }
      if (settingsVisible) {
        const panel = document.getElementById('reader-settings-panel');
        const settingsBtn = document.getElementById('reader-settings-btn');
        if (panel && !panel.contains(event.target) && settingsBtn && !settingsBtn.contains(event.target)) {
          closeSettings();
        }
      }
    });
  }

  // --- Public API ---
  return {
    open,
    close,
  };
})();

// Attach to window for use by app.js
if (typeof window !== 'undefined') {
  window.IronshelfReader = IronshelfReader;
}
