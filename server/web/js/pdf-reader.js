// ============================================================
// Ironshelf — PDF Reader Module (IIFE)
// ============================================================

const IronshelfPdfReader = (() => {
  'use strict';

  const HOSTED = !!window.IRONSHELF_HOSTED;
  const SERVER_URL = HOSTED ? (localStorage.getItem('ironshelf_server_url') || '') : '';
  const API = (HOSTED && SERVER_URL) ? `${SERVER_URL}/api/v1` : '/api/v1';

  function withToken(url) {
    const token = localStorage.getItem("ironshelf_server_token");
    if (!token) return url;
    return url + (url.includes("?") ? "&" : "?") + "access_token=" + encodeURIComponent(token);
  }

  // For media (book file) URLs only: prefer the short-lived scoped media token
  // exposed by app.js, falling back to the session token. The scoped token is
  // only accepted by media routes, so it must NOT be used for /progress etc.
  function withMediaToken(url) {
    const mediaToken = typeof window.IronshelfMediaToken === 'function'
      ? window.IronshelfMediaToken()
      : null;
    if (mediaToken) {
      return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(mediaToken);
    }
    return withToken(url);
  }
  const PDFJS_CDN = '/js/vendor/pdf.min.mjs';
  const PDFJS_WORKER_CDN = '/js/vendor/pdf.worker.min.mjs';
  const STORAGE_ZOOM_KEY = 'ironshelf_pdf_zoom';
  const STORAGE_MODE_KEY = 'ironshelf_pdf_mode';
  const STORAGE_DARK_KEY = 'ironshelf_pdf_dark';

  let pdfjsLoaded = false;
  let pdfjsLib = null;
  let currentDocument = null;
  let currentBookId = null;
  let containerElement = null;
  let totalPages = 0;
  let currentPage = 1;
  let currentZoom = 1.0;
  let zoomMode = 'fit-width'; // 'fit-width', 'fit-page', 'custom'
  let displayMode = 'continuous'; // 'continuous', 'single'
  let isDarkMode = false;
  let isFullscreen = false;
  let thumbnailSidebarVisible = false;
  let saveProgressTimer = null;
  let renderedPages = new Map();
  let pageObserver = null;
  let isRendering = false;
  let renderQueue = [];
  let pinchStartDistance = 0;
  let pinchStartZoom = 1.0;
  let boundResizeHandler = null;

  // --- Settings Persistence ---
  function getStoredZoom() {
    return localStorage.getItem(STORAGE_ZOOM_KEY) || 'fit-width';
  }

  function getStoredMode() {
    return localStorage.getItem(STORAGE_MODE_KEY) || 'continuous';
  }

  function getStoredDarkMode() {
    return localStorage.getItem(STORAGE_DARK_KEY) === 'true';
  }

  // --- CDN Loader ---
  function loadPdfJs() {
    if (pdfjsLoaded && pdfjsLib) return Promise.resolve();
    return new Promise((resolve, reject) => {
      import(PDFJS_CDN).then((module) => {
        pdfjsLib = module;
        pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
        pdfjsLoaded = true;
        resolve();
      }).catch(() => reject(new Error('Failed to load PDF.js from CDN')));
    });
  }

  // --- Progress API ---
  async function fetchProgress(bookId) {
    try {
      const response = await fetch(withToken(`${API}/books/${bookId}/progress`), {
        credentials: 'same-origin',
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (Array.isArray(data)) {
        return data.find(entry => entry.format === 'PDF') || data[0] || null;
      }
      return data;
    } catch {
      return null;
    }
  }

  async function saveProgress(bookId, page, percent) {
    try {
      await fetch(withToken(`${API}/books/${bookId}/progress`), {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: 'PDF',
          locator: String(page),
          percent: percent,
        }),
      });
    } catch {
      // Silent fail
    }
  }

  function debouncedSaveProgress() {
    if (saveProgressTimer) clearTimeout(saveProgressTimer);
    saveProgressTimer = setTimeout(() => {
      if (currentBookId && totalPages > 0) {
        const percent = currentPage / totalPages;
        saveProgress(currentBookId, currentPage, percent);
      }
    }, 2000);
  }

  // --- Utility ---
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // --- UI Construction ---
  function buildReaderHTML(title) {
    return `
      <div class="pdf-toolbar" id="pdf-toolbar" role="toolbar" aria-label="PDF viewer controls">
        <div class="pdf-toolbar-left">
          <button class="pdf-btn" id="pdf-close-btn" aria-label="Close reader" title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <button class="pdf-btn" id="pdf-sidebar-btn" aria-label="Toggle thumbnails" title="Thumbnails">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          </button>
          <span class="pdf-title" id="pdf-title">${escapeHtml(title)}</span>
        </div>
        <div class="pdf-toolbar-center">
          <button class="pdf-btn" id="pdf-prev-btn" aria-label="Previous page" title="Previous page">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="pdf-page-nav">
            <input type="number" id="pdf-page-input" class="pdf-page-input" min="1" aria-label="Current page" title="Go to page">
            <span class="pdf-page-total" id="pdf-page-total">/ 0</span>
          </div>
          <button class="pdf-btn" id="pdf-next-btn" aria-label="Next page" title="Next page">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="pdf-toolbar-right">
          <button class="pdf-btn" id="pdf-zoom-out-btn" aria-label="Zoom out" title="Zoom out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          </button>
          <button class="pdf-btn pdf-zoom-display" id="pdf-zoom-display" aria-label="Zoom level" title="Cycle fit mode">100%</button>
          <button class="pdf-btn" id="pdf-zoom-in-btn" aria-label="Zoom in" title="Zoom in">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          </button>
          <div class="pdf-toolbar-separator"></div>
          <button class="pdf-btn" id="pdf-mode-btn" aria-label="Toggle display mode" title="Display mode">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
          </button>
          <button class="pdf-btn" id="pdf-dark-btn" aria-label="Toggle dark mode" title="Dark mode">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          </button>
          <button class="pdf-btn" id="pdf-print-btn" aria-label="Print" title="Print">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          </button>
          <button class="pdf-btn" id="pdf-fullscreen-btn" aria-label="Toggle fullscreen" title="Fullscreen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          </button>
        </div>
      </div>

      <div class="pdf-body">
        <aside class="pdf-sidebar" id="pdf-sidebar" aria-label="Page thumbnails">
          <div class="pdf-sidebar-content" id="pdf-sidebar-content"></div>
        </aside>
        <main class="pdf-viewport" id="pdf-viewport" tabindex="0" aria-label="PDF document">
          <div class="pdf-page-container" id="pdf-page-container"></div>
        </main>
      </div>

      <div class="pdf-loading" id="pdf-loading">
        <div class="pdf-loading-spinner"></div>
        <div class="pdf-loading-text">Loading PDF...</div>
      </div>
    `;
  }

  // --- Zoom Calculations ---
  function calculateFitWidthScale(page) {
    const viewport = document.getElementById('pdf-viewport');
    if (!viewport) return 1.0;
    const availableWidth = viewport.clientWidth - 48; // padding
    const pageViewport = page.getViewport({ scale: 1.0 });
    return availableWidth / pageViewport.width;
  }

  function calculateFitPageScale(page) {
    const viewport = document.getElementById('pdf-viewport');
    if (!viewport) return 1.0;
    const availableWidth = viewport.clientWidth - 48;
    const availableHeight = viewport.clientHeight - 32;
    const pageViewport = page.getViewport({ scale: 1.0 });
    const scaleWidth = availableWidth / pageViewport.width;
    const scaleHeight = availableHeight / pageViewport.height;
    return Math.min(scaleWidth, scaleHeight);
  }

  function updateZoomDisplay() {
    const display = document.getElementById('pdf-zoom-display');
    if (display) {
      display.textContent = `${Math.round(currentZoom * 100)}%`;
    }
  }

  async function setZoom(newZoom, fitMode) {
    if (fitMode) {
      zoomMode = fitMode;
      localStorage.setItem(STORAGE_ZOOM_KEY, fitMode);
      // Calculate zoom from first page
      if (currentDocument) {
        const page = await currentDocument.getPage(1);
        if (fitMode === 'fit-width') {
          currentZoom = calculateFitWidthScale(page);
        } else if (fitMode === 'fit-page') {
          currentZoom = calculateFitPageScale(page);
        }
      }
    } else {
      zoomMode = 'custom';
      currentZoom = Math.max(0.25, Math.min(4.0, newZoom));
    }
    updateZoomDisplay();
    await rerenderAllPages();
  }

  // --- Page Rendering ---
  async function renderPage(pageNumber, container) {
    if (!currentDocument) return;

    const existingCanvas = container.querySelector('canvas');
    if (existingCanvas) existingCanvas.remove();

    const page = await currentDocument.getPage(pageNumber);
    const scale = currentZoom;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = Math.floor(viewport.width * window.devicePixelRatio);
    canvas.height = Math.floor(viewport.height * window.devicePixelRatio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    canvas.setAttribute('aria-label', `Page ${pageNumber}`);

    context.scale(window.devicePixelRatio, window.devicePixelRatio);

    container.style.width = `${Math.floor(viewport.width)}px`;
    container.style.height = `${Math.floor(viewport.height)}px`;
    container.appendChild(canvas);

    await page.render({ canvasContext: context, viewport }).promise;
    renderedPages.set(pageNumber, true);
  }

  async function renderThumbnail(pageNumber, container) {
    if (!currentDocument) return;
    const page = await currentDocument.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1.0 });
    const thumbnailScale = 120 / baseViewport.width;
    const viewport = page.getViewport({ scale: thumbnailScale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    container.appendChild(canvas);
    await page.render({ canvasContext: context, viewport }).promise;
  }

  function createPageElements() {
    const pageContainer = document.getElementById('pdf-page-container');
    if (!pageContainer) return;
    pageContainer.innerHTML = '';

    for (let i = 1; i <= totalPages; i++) {
      const pageWrapper = document.createElement('div');
      pageWrapper.className = 'pdf-page-wrapper';
      pageWrapper.dataset.pageNumber = String(i);
      pageWrapper.id = `pdf-page-${i}`;

      const pageLabel = document.createElement('div');
      pageLabel.className = 'pdf-page-label';
      pageLabel.textContent = `Page ${i}`;

      pageWrapper.appendChild(pageLabel);
      pageContainer.appendChild(pageWrapper);
    }
  }

  function setupIntersectionObserver() {
    if (pageObserver) pageObserver.disconnect();

    const viewport = document.getElementById('pdf-viewport');
    if (!viewport) return;

    pageObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const pageNumber = parseInt(entry.target.dataset.pageNumber, 10);
        if (entry.isIntersecting) {
          if (!renderedPages.has(pageNumber)) {
            renderPage(pageNumber, entry.target);
          }
          // Update current page (topmost visible)
          if (entry.intersectionRatio > 0.3 || entry.boundingClientRect.top <= viewport.clientHeight * 0.5) {
            if (pageNumber !== currentPage) {
              currentPage = pageNumber;
              updatePageInput();
              debouncedSaveProgress();
            }
          }
        }
      }
    }, {
      root: viewport,
      rootMargin: '200px 0px',
      threshold: [0, 0.3, 0.5, 1.0],
    });

    const pageWrappers = document.querySelectorAll('.pdf-page-wrapper');
    pageWrappers.forEach(wrapper => pageObserver.observe(wrapper));
  }

  async function rerenderAllPages() {
    renderedPages.clear();
    const pageWrappers = document.querySelectorAll('.pdf-page-wrapper');
    for (const wrapper of pageWrappers) {
      const canvas = wrapper.querySelector('canvas');
      if (canvas) canvas.remove();
    }
    // Re-observe to trigger rendering of visible pages
    setupIntersectionObserver();
  }

  function updatePageInput() {
    const pageInput = document.getElementById('pdf-page-input');
    if (pageInput) pageInput.value = currentPage;
  }

  function goToPage(pageNumber) {
    const targetPage = Math.max(1, Math.min(totalPages, pageNumber));
    currentPage = targetPage;
    updatePageInput();

    if (displayMode === 'continuous') {
      const pageEl = document.getElementById(`pdf-page-${targetPage}`);
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
      showSinglePage(targetPage);
    }
    debouncedSaveProgress();
  }

  async function showSinglePage(pageNumber) {
    const pageContainer = document.getElementById('pdf-page-container');
    if (!pageContainer) return;

    // Hide all, show target
    const wrappers = pageContainer.querySelectorAll('.pdf-page-wrapper');
    wrappers.forEach(wrapper => {
      const num = parseInt(wrapper.dataset.pageNumber, 10);
      if (num === pageNumber) {
        wrapper.style.display = '';
        if (!renderedPages.has(num)) {
          renderPage(num, wrapper);
        }
      } else {
        wrapper.style.display = 'none';
      }
    });
  }

  function setDisplayMode(mode) {
    displayMode = mode;
    localStorage.setItem(STORAGE_MODE_KEY, mode);
    const pageContainer = document.getElementById('pdf-page-container');
    if (!pageContainer) return;

    if (mode === 'continuous') {
      pageContainer.classList.remove('pdf-single-mode');
      const wrappers = pageContainer.querySelectorAll('.pdf-page-wrapper');
      wrappers.forEach(wrapper => { wrapper.style.display = ''; });
      setupIntersectionObserver();
      goToPage(currentPage);
    } else {
      pageContainer.classList.add('pdf-single-mode');
      if (pageObserver) pageObserver.disconnect();
      showSinglePage(currentPage);
    }
    updateModeButton();
  }

  function updateModeButton() {
    const modeBtn = document.getElementById('pdf-mode-btn');
    if (modeBtn) {
      modeBtn.classList.toggle('pdf-btn-active', displayMode === 'single');
      modeBtn.title = displayMode === 'continuous' ? 'Switch to page mode' : 'Switch to scroll mode';
    }
  }

  // --- Thumbnails ---
  function buildThumbnails() {
    const sidebarContent = document.getElementById('pdf-sidebar-content');
    if (!sidebarContent) return;
    sidebarContent.innerHTML = '';

    for (let i = 1; i <= totalPages; i++) {
      const thumb = document.createElement('button');
      thumb.className = 'pdf-thumbnail';
      thumb.dataset.pageNumber = String(i);
      thumb.setAttribute('aria-label', `Go to page ${i}`);
      thumb.title = `Page ${i}`;

      const thumbCanvas = document.createElement('div');
      thumbCanvas.className = 'pdf-thumbnail-canvas';
      thumb.appendChild(thumbCanvas);

      const thumbLabel = document.createElement('span');
      thumbLabel.className = 'pdf-thumbnail-label';
      thumbLabel.textContent = String(i);
      thumb.appendChild(thumbLabel);

      thumb.addEventListener('click', () => goToPage(i));
      sidebarContent.appendChild(thumb);

      // Lazy render thumbnails
      renderThumbnail(i, thumbCanvas);
    }
  }

  function updateThumbnailHighlight() {
    const thumbs = document.querySelectorAll('.pdf-thumbnail');
    thumbs.forEach(thumb => {
      const pageNum = parseInt(thumb.dataset.pageNumber, 10);
      thumb.classList.toggle('pdf-thumbnail-active', pageNum === currentPage);
    });
  }

  function toggleSidebar() {
    thumbnailSidebarVisible = !thumbnailSidebarVisible;
    const sidebar = document.getElementById('pdf-sidebar');
    const sidebarBtn = document.getElementById('pdf-sidebar-btn');
    if (sidebar) sidebar.classList.toggle('pdf-sidebar-visible', thumbnailSidebarVisible);
    if (sidebarBtn) sidebarBtn.classList.toggle('pdf-btn-active', thumbnailSidebarVisible);
  }

  // --- Dark Mode ---
  function toggleDarkMode() {
    isDarkMode = !isDarkMode;
    localStorage.setItem(STORAGE_DARK_KEY, String(isDarkMode));
    applyDarkMode();
  }

  function applyDarkMode() {
    if (!containerElement) return;
    containerElement.classList.toggle('pdf-dark-mode', isDarkMode);
    const darkBtn = document.getElementById('pdf-dark-btn');
    if (darkBtn) darkBtn.classList.toggle('pdf-btn-active', isDarkMode);
  }

  // --- Event Binding ---
  function bindEvents() {
    if (!containerElement) return;

    // Close
    document.getElementById('pdf-close-btn')?.addEventListener('click', close);

    // Sidebar
    document.getElementById('pdf-sidebar-btn')?.addEventListener('click', toggleSidebar);

    // Page navigation
    document.getElementById('pdf-prev-btn')?.addEventListener('click', () => goToPage(currentPage - 1));
    document.getElementById('pdf-next-btn')?.addEventListener('click', () => goToPage(currentPage + 1));

    // Tap the left/right quarter of the page to turn pages.
    const pdfViewport = document.getElementById('pdf-viewport');
    pdfViewport?.addEventListener('click', (event) => {
      // Ignore clicks that land on toolbar/controls bubbling up.
      if (event.target.closest('.pdf-toolbar, .pdf-sidebar')) return;
      const rect = pdfViewport.getBoundingClientRect();
      const x = event.clientX - rect.left;
      if (x < rect.width * 0.25) {
        goToPage(currentPage - 1);
      } else if (x > rect.width * 0.75) {
        goToPage(currentPage + 1);
      }
    });

    const pageInput = document.getElementById('pdf-page-input');
    if (pageInput) {
      pageInput.addEventListener('change', () => {
        const value = parseInt(pageInput.value, 10);
        if (!isNaN(value)) goToPage(value);
      });
      pageInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const value = parseInt(pageInput.value, 10);
          if (!isNaN(value)) goToPage(value);
        }
      });
    }

    // Zoom
    document.getElementById('pdf-zoom-out-btn')?.addEventListener('click', () => {
      setZoom(currentZoom - 0.1);
    });
    document.getElementById('pdf-zoom-in-btn')?.addEventListener('click', () => {
      setZoom(currentZoom + 0.1);
    });
    document.getElementById('pdf-zoom-display')?.addEventListener('click', () => {
      // Cycle: fit-width -> fit-page -> custom(100%)
      if (zoomMode === 'fit-width') {
        setZoom(null, 'fit-page');
      } else if (zoomMode === 'fit-page') {
        setZoom(1.0);
      } else {
        setZoom(null, 'fit-width');
      }
    });

    // Display mode
    document.getElementById('pdf-mode-btn')?.addEventListener('click', () => {
      setDisplayMode(displayMode === 'continuous' ? 'single' : 'continuous');
    });

    // Dark mode
    document.getElementById('pdf-dark-btn')?.addEventListener('click', toggleDarkMode);

    // Print
    document.getElementById('pdf-print-btn')?.addEventListener('click', () => {
      window.print();
    });

    // Fullscreen
    document.getElementById('pdf-fullscreen-btn')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        containerElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    // Keyboard
    const keyHandler = (event) => {
      if (!containerElement || !document.body.contains(containerElement)) {
        document.removeEventListener('keydown', keyHandler);
        return;
      }
      // Don't intercept when input is focused
      if (event.target.tagName === 'INPUT') return;

      switch (event.key) {
        case 'ArrowLeft':
        case 'PageUp':
          event.preventDefault();
          goToPage(currentPage - 1);
          break;
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          event.preventDefault();
          goToPage(currentPage + 1);
          break;
        case 'Home':
          event.preventDefault();
          goToPage(1);
          break;
        case 'End':
          event.preventDefault();
          goToPage(totalPages);
          break;
        case '+':
        case '=':
          event.preventDefault();
          setZoom(currentZoom + 0.1);
          break;
        case '-':
          event.preventDefault();
          setZoom(currentZoom - 0.1);
          break;
        case 'Escape':
          event.preventDefault();
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          } else {
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
      }
    };
    document.addEventListener('keydown', keyHandler);

    // Touch: pinch-to-zoom
    const viewport = document.getElementById('pdf-viewport');
    if (viewport) {
      viewport.addEventListener('touchstart', (event) => {
        if (event.touches.length === 2) {
          const dx = event.touches[0].clientX - event.touches[1].clientX;
          const dy = event.touches[0].clientY - event.touches[1].clientY;
          pinchStartDistance = Math.hypot(dx, dy);
          pinchStartZoom = currentZoom;
        }
      }, { passive: true });

      viewport.addEventListener('touchmove', (event) => {
        if (event.touches.length === 2) {
          const dx = event.touches[0].clientX - event.touches[1].clientX;
          const dy = event.touches[0].clientY - event.touches[1].clientY;
          const currentDistance = Math.hypot(dx, dy);
          if (pinchStartDistance > 0) {
            const scale = currentDistance / pinchStartDistance;
            setZoom(pinchStartZoom * scale);
          }
        }
      }, { passive: true });

      viewport.addEventListener('touchend', () => {
        pinchStartDistance = 0;
      }, { passive: true });

      // Swipe in single-page mode
      let swipeStartX = 0;
      viewport.addEventListener('touchstart', (event) => {
        if (event.touches.length === 1 && displayMode === 'single') {
          swipeStartX = event.touches[0].clientX;
        }
      }, { passive: true });

      viewport.addEventListener('touchend', (event) => {
        if (displayMode === 'single' && event.changedTouches.length === 1) {
          const deltaX = event.changedTouches[0].clientX - swipeStartX;
          if (Math.abs(deltaX) > 60) {
            if (deltaX > 0) goToPage(currentPage - 1);
            else goToPage(currentPage + 1);
          }
        }
      }, { passive: true });

      // Scroll tracking for continuous mode
      viewport.addEventListener('scroll', () => {
        if (displayMode === 'continuous') {
          updateThumbnailHighlight();
        }
      }, { passive: true });
    }

    // Resize handler (stored for cleanup on close)
    boundResizeHandler = debounce(() => {
      if (zoomMode === 'fit-width' || zoomMode === 'fit-page') {
        setZoom(null, zoomMode);
      }
    }, 250);
    window.addEventListener('resize', boundResizeHandler);
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  // --- Error Display ---
  function showError(message) {
    const loadingEl = document.getElementById('pdf-loading');
    if (loadingEl) {
      loadingEl.innerHTML = `
        <div class="pdf-error">
          <div class="pdf-error-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div class="pdf-error-title">Unable to open PDF</div>
          <div class="pdf-error-message">${escapeHtml(message)}</div>
          <button class="pdf-error-btn" id="pdf-error-close">Go Back</button>
        </div>
      `;
      loadingEl.style.display = 'flex';
      document.getElementById('pdf-error-close')?.addEventListener('click', close);
    }
  }

  // --- Core: Open ---
  async function open(bookId, format) {
    currentBookId = bookId;
    const fileFormat = (format || 'pdf').toUpperCase();
    currentPage = 1;
    totalPages = 0;
    renderedPages.clear();
    isDarkMode = getStoredDarkMode();
    displayMode = getStoredMode();

    containerElement = document.createElement('div');
    containerElement.className = 'pdf-reader-container';
    containerElement.setAttribute('role', 'application');
    containerElement.setAttribute('aria-label', 'PDF Reader');
    containerElement.innerHTML = buildReaderHTML('Loading...');
    document.body.appendChild(containerElement);
    document.body.style.overflow = 'hidden';

    applyDarkMode();
    bindEvents();

    try {
      await loadPdfJs();

      const savedProgress = await fetchProgress(bookId);
      const fileUrl = withMediaToken(`${API}/books/${bookId}/file?format=${fileFormat}`);

      const loadingTask = pdfjsLib.getDocument(fileUrl);
      currentDocument = await loadingTask.promise;
      totalPages = currentDocument.numPages;

      // Update UI
      const pageTotal = document.getElementById('pdf-page-total');
      if (pageTotal) pageTotal.textContent = `/ ${totalPages}`;
      const pageInput = document.getElementById('pdf-page-input');
      if (pageInput) {
        pageInput.max = totalPages;
        pageInput.value = '1';
      }

      // Title from metadata
      const metadata = await currentDocument.getMetadata().catch(() => null);
      if (metadata?.info?.Title) {
        const titleEl = document.getElementById('pdf-title');
        if (titleEl) titleEl.textContent = metadata.info.Title;
      }

      // Create page elements
      createPageElements();

      // Calculate initial zoom
      const firstPage = await currentDocument.getPage(1);
      const storedZoom = getStoredZoom();
      if (storedZoom === 'fit-width') {
        currentZoom = calculateFitWidthScale(firstPage);
        zoomMode = 'fit-width';
      } else if (storedZoom === 'fit-page') {
        currentZoom = calculateFitPageScale(firstPage);
        zoomMode = 'fit-page';
      } else {
        currentZoom = 1.0;
        zoomMode = 'custom';
      }
      updateZoomDisplay();

      // Set display mode
      setDisplayMode(displayMode);

      // Restore progress
      if (savedProgress?.locator) {
        const savedPage = parseInt(savedProgress.locator, 10);
        if (!isNaN(savedPage) && savedPage >= 1 && savedPage <= totalPages) {
          currentPage = savedPage;
          updatePageInput();
          // Delay so layout settles
          setTimeout(() => goToPage(currentPage), 100);
        }
      }

      // Build thumbnails
      buildThumbnails();

      // Hide loading
      const loadingEl = document.getElementById('pdf-loading');
      if (loadingEl) loadingEl.style.display = 'none';

    } catch (error) {
      showError(error.message || 'Failed to load PDF document');
    }
  }

  // --- Core: Close ---
  function close() {
    // Save final progress
    if (currentBookId && totalPages > 0) {
      saveProgress(currentBookId, currentPage, currentPage / totalPages);
    }

    if (saveProgressTimer) clearTimeout(saveProgressTimer);
    if (pageObserver) pageObserver.disconnect();
    if (boundResizeHandler) {
      window.removeEventListener('resize', boundResizeHandler);
      boundResizeHandler = null;
    }

    if (currentDocument) {
      currentDocument.destroy();
      currentDocument = null;
    }

    const bookId = currentBookId;
    currentBookId = null;
    totalPages = 0;
    currentPage = 1;
    renderedPages.clear();

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    if (containerElement) {
      containerElement.remove();
      containerElement = null;
    }

    document.body.style.overflow = '';

    if (bookId) {
      window.location.hash = `#/book/${bookId}`;
    }
  }

  // --- Public API ---
  return {
    open,
    close,
  };
})();

// Attach to window for use by app.js
if (typeof window !== 'undefined') {
  window.IronshelfPdfReader = IronshelfPdfReader;
}
