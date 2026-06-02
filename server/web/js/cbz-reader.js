// ============================================================
// Ironshelf — CBZ/Comic Reader Module (IIFE)
// ============================================================

const IronshelfCbzReader = (() => {
  'use strict';

  const HOSTED = !!window.IRONSHELF_HOSTED;
  const SERVER_URL = HOSTED ? (localStorage.getItem('ironshelf_server_url') || '') : '';
  const API = (HOSTED && SERVER_URL) ? `${SERVER_URL}/api/v1` : '/api/v1';

  function withToken(url) {
    const token = localStorage.getItem("ironshelf_server_token");
    if (!token) return url;
    return url + (url.includes("?") ? "&" : "?") + "access_token=" + encodeURIComponent(token);
  }
  const JSZIP_CDN = '/js/vendor/jszip.min.js';
  const STORAGE_FIT_KEY = 'ironshelf_cbz_fit';
  const STORAGE_DISPLAY_KEY = 'ironshelf_cbz_display';
  const STORAGE_DIRECTION_KEY = 'ironshelf_cbz_direction';

  let jszipLoaded = false;
  let currentBookId = null;
  let containerElement = null;
  let imageUrls = [];
  let totalPages = 0;
  let currentPage = 1;
  let fitMode = 'fit-width'; // 'fit-width', 'fit-height', 'original'
  let displayMode = 'single'; // 'single', 'double', 'continuous'
  let readingDirection = 'ltr'; // 'ltr', 'rtl'
  let isFullscreen = false;
  let saveProgressTimer = null;
  let preloadedImages = new Map();
  let thumbnailStripVisible = true;
  let continuousScrollObserver = null;

  // --- Settings Persistence ---
  function getStoredFit() {
    return localStorage.getItem(STORAGE_FIT_KEY) || 'fit-width';
  }

  function getStoredDisplay() {
    return localStorage.getItem(STORAGE_DISPLAY_KEY) || 'single';
  }

  function getStoredDirection() {
    return localStorage.getItem(STORAGE_DIRECTION_KEY) || 'ltr';
  }

  // --- CDN Loader ---
  function loadJsZip() {
    if (jszipLoaded && window.JSZip) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = JSZIP_CDN;
      script.onload = () => { jszipLoaded = true; resolve(); };
      script.onerror = () => reject(new Error('Failed to load JSZip from CDN'));
      document.head.appendChild(script);
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
        return data.find(entry => entry.format === 'CBZ') || data[0] || null;
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
          format: 'CBZ',
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

  function naturalSort(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }

  function isImageFile(filename) {
    const extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'];
    const lower = filename.toLowerCase();
    return extensions.some(ext => lower.endsWith(ext));
  }

  // --- UI Construction ---
  function buildReaderHTML(title) {
    return `
      <div class="cbz-toolbar" id="cbz-toolbar" role="toolbar" aria-label="Comic reader controls">
        <div class="cbz-toolbar-left">
          <button class="cbz-btn" id="cbz-close-btn" aria-label="Close reader" title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <span class="cbz-title" id="cbz-title">${escapeHtml(title)}</span>
        </div>
        <div class="cbz-toolbar-center">
          <button class="cbz-btn" id="cbz-prev-btn" aria-label="Previous page" title="Previous page">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="cbz-page-nav">
            <input type="number" id="cbz-page-input" class="cbz-page-input" min="1" aria-label="Current page" title="Go to page">
            <span class="cbz-page-total" id="cbz-page-total">/ 0</span>
          </div>
          <button class="cbz-btn" id="cbz-next-btn" aria-label="Next page" title="Next page">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="cbz-toolbar-right">
          <select class="cbz-select" id="cbz-fit-select" aria-label="Fit mode" title="Fit mode">
            <option value="fit-width">Fit Width</option>
            <option value="fit-height">Fit Height</option>
            <option value="original">Original</option>
          </select>
          <select class="cbz-select" id="cbz-display-select" aria-label="Display mode" title="Display mode">
            <option value="single">Single Page</option>
            <option value="double">Double Page</option>
            <option value="continuous">Continuous</option>
          </select>
          <button class="cbz-btn" id="cbz-direction-btn" aria-label="Toggle reading direction" title="Reading direction: LTR">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><polyline points="12 5 19 12 12 19"/></svg>
          </button>
          <button class="cbz-btn" id="cbz-fullscreen-btn" aria-label="Toggle fullscreen" title="Fullscreen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          </button>
        </div>
      </div>

      <div class="cbz-body">
        <div class="cbz-viewport" id="cbz-viewport" tabindex="0" aria-label="Comic pages">
          <div class="cbz-page-display" id="cbz-page-display"></div>
          <button class="cbz-nav-arrow cbz-nav-arrow-left" id="cbz-nav-left" aria-label="Previous page">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button class="cbz-nav-arrow cbz-nav-arrow-right" id="cbz-nav-right" aria-label="Next page">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="cbz-thumbnail-strip" id="cbz-thumbnail-strip" role="listbox" aria-label="Page thumbnails"></div>
      </div>

      <div class="cbz-loading" id="cbz-loading">
        <div class="cbz-loading-spinner"></div>
        <div class="cbz-loading-text">Extracting comic pages...</div>
        <div class="cbz-loading-progress" id="cbz-loading-progress"></div>
      </div>
    `;
  }

  // --- Image Extraction ---
  async function extractImages(arrayBuffer) {
    let zip;
    try {
      zip = await JSZip.loadAsync(arrayBuffer);
    } catch (err) {
      // CBR archives are RAR, not ZIP. JSZip can only read ZIP-based comics
      // (CBZ, and CBR files that are secretly ZIP). True RAR can't be unpacked
      // in-browser — surface a clear message instead of a generic zip error.
      throw new Error('This comic is a RAR archive (CBR), which cannot be opened in the browser. Convert it to CBZ to read it here.');
    }
    const imageFiles = [];

    zip.forEach((relativePath, zipEntry) => {
      if (!zipEntry.dir && isImageFile(relativePath)) {
        // Skip macOS resource fork files
        if (!relativePath.startsWith('__MACOSX') && !relativePath.startsWith('.')) {
          imageFiles.push({ path: relativePath, entry: zipEntry });
        }
      }
    });

    // Natural sort by filename
    imageFiles.sort((a, b) => naturalSort(a.path, b.path));

    const urls = [];
    const progressEl = document.getElementById('cbz-loading-progress');

    for (let i = 0; i < imageFiles.length; i++) {
      const blob = await imageFiles[i].entry.async('blob');
      const url = URL.createObjectURL(blob);
      urls.push(url);

      if (progressEl) {
        progressEl.textContent = `${i + 1} / ${imageFiles.length} pages`;
      }
    }

    return urls;
  }

  // --- Page Display ---
  function showCurrentPage() {
    const display = document.getElementById('cbz-page-display');
    if (!display) return;

    display.innerHTML = '';
    display.className = `cbz-page-display cbz-fit-${fitMode} cbz-display-${displayMode}`;

    if (displayMode === 'continuous') {
      showContinuousPages(display);
    } else if (displayMode === 'double') {
      showDoublePage(display);
    } else {
      showSinglePage(display);
    }

    updatePageInput();
    updateThumbnailHighlight();
    preloadAdjacentPages();
    debouncedSaveProgress();
  }

  function showSinglePage(display) {
    const pageIndex = currentPage - 1;
    if (pageIndex < 0 || pageIndex >= imageUrls.length) return;

    const img = createPageImage(pageIndex);
    display.appendChild(img);
  }

  function showDoublePage(display) {
    const spreadContainer = document.createElement('div');
    spreadContainer.className = 'cbz-spread';

    if (readingDirection === 'rtl') {
      spreadContainer.classList.add('cbz-spread-rtl');
    }

    const pageIndex = currentPage - 1;

    // First page is always alone (cover)
    if (currentPage === 1) {
      const img = createPageImage(0);
      spreadContainer.appendChild(img);
    } else {
      // Show two pages
      const leftIndex = readingDirection === 'ltr' ? pageIndex : pageIndex + 1;
      const rightIndex = readingDirection === 'ltr' ? pageIndex + 1 : pageIndex;

      if (leftIndex >= 0 && leftIndex < imageUrls.length) {
        spreadContainer.appendChild(createPageImage(leftIndex));
      }
      if (rightIndex >= 0 && rightIndex < imageUrls.length) {
        spreadContainer.appendChild(createPageImage(rightIndex));
      }
    }

    display.appendChild(spreadContainer);
  }

  function showContinuousPages(display) {
    for (let i = 0; i < imageUrls.length; i++) {
      const wrapper = document.createElement('div');
      wrapper.className = 'cbz-continuous-page';
      wrapper.dataset.pageNumber = String(i + 1);
      wrapper.id = `cbz-page-${i + 1}`;

      const img = createPageImage(i);
      wrapper.appendChild(img);
      display.appendChild(wrapper);
    }

    // Scroll to current page
    setTimeout(() => {
      const targetPage = document.getElementById(`cbz-page-${currentPage}`);
      if (targetPage) {
        targetPage.scrollIntoView({ behavior: 'instant', block: 'start' });
      }
    }, 50);

    // Setup scroll observer for continuous mode
    setupContinuousScrollObserver();
  }

  function setupContinuousScrollObserver() {
    // Disconnect previous observer if any
    if (continuousScrollObserver) {
      continuousScrollObserver.disconnect();
      continuousScrollObserver = null;
    }

    const viewport = document.getElementById('cbz-viewport');
    if (!viewport) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio > 0.3) {
          const pageNumber = parseInt(entry.target.dataset.pageNumber, 10);
          if (pageNumber && pageNumber !== currentPage) {
            currentPage = pageNumber;
            updatePageInput();
            updateThumbnailHighlight();
            debouncedSaveProgress();
          }
        }
      }
    }, {
      root: viewport,
      threshold: [0.3, 0.5],
    });

    const pages = document.querySelectorAll('.cbz-continuous-page');
    pages.forEach(page => observer.observe(page));

    // Store for cleanup
    continuousScrollObserver = observer;
  }

  function createPageImage(index) {
    const img = document.createElement('img');
    img.src = imageUrls[index];
    img.className = 'cbz-page-image';
    img.alt = `Page ${index + 1}`;
    img.draggable = false;
    return img;
  }

  // --- Preloading ---
  function preloadAdjacentPages() {
    const pagesToPreload = displayMode === 'double' ? 4 : 3;
    for (let offset = 1; offset <= pagesToPreload; offset++) {
      const nextIndex = currentPage - 1 + offset;
      const prevIndex = currentPage - 1 - offset;

      if (nextIndex < imageUrls.length && !preloadedImages.has(nextIndex)) {
        const img = new Image();
        img.src = imageUrls[nextIndex];
        preloadedImages.set(nextIndex, img);
      }
      if (prevIndex >= 0 && !preloadedImages.has(prevIndex)) {
        const img = new Image();
        img.src = imageUrls[prevIndex];
        preloadedImages.set(prevIndex, img);
      }
    }
  }

  // --- Navigation ---
  function goToPage(pageNumber) {
    const targetPage = Math.max(1, Math.min(totalPages, pageNumber));
    if (targetPage === currentPage && displayMode !== 'continuous') return;

    currentPage = targetPage;

    if (displayMode === 'continuous') {
      const pageEl = document.getElementById(`cbz-page-${targetPage}`);
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      updatePageInput();
      updateThumbnailHighlight();
    } else {
      showCurrentPage();
    }
    debouncedSaveProgress();
  }

  function nextPage() {
    const step = displayMode === 'double' && currentPage > 1 ? 2 : 1;
    goToPage(currentPage + step);
  }

  function prevPage() {
    const step = displayMode === 'double' && currentPage > 2 ? 2 : 1;
    goToPage(currentPage - step);
  }

  function updatePageInput() {
    const pageInput = document.getElementById('cbz-page-input');
    if (pageInput) pageInput.value = currentPage;
  }

  // --- Thumbnails ---
  function buildThumbnailStrip() {
    const strip = document.getElementById('cbz-thumbnail-strip');
    if (!strip) return;
    strip.innerHTML = '';

    for (let i = 0; i < imageUrls.length; i++) {
      const thumb = document.createElement('button');
      thumb.className = 'cbz-thumbnail';
      thumb.dataset.pageNumber = String(i + 1);
      thumb.setAttribute('role', 'option');
      thumb.setAttribute('aria-label', `Page ${i + 1}`);
      thumb.title = `Page ${i + 1}`;

      const img = document.createElement('img');
      img.src = imageUrls[i];
      img.alt = `Thumbnail ${i + 1}`;
      img.draggable = false;

      thumb.appendChild(img);
      thumb.addEventListener('click', () => goToPage(i + 1));
      strip.appendChild(thumb);
    }
  }

  function updateThumbnailHighlight() {
    const thumbs = document.querySelectorAll('.cbz-thumbnail');
    thumbs.forEach(thumb => {
      const pageNum = parseInt(thumb.dataset.pageNumber, 10);
      const isActive = pageNum === currentPage;
      thumb.classList.toggle('cbz-thumbnail-active', isActive);
      thumb.setAttribute('aria-selected', String(isActive));
    });

    // Scroll active thumbnail into view
    const activeThumb = document.querySelector('.cbz-thumbnail-active');
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  // --- Direction ---
  function toggleDirection() {
    readingDirection = readingDirection === 'ltr' ? 'rtl' : 'ltr';
    localStorage.setItem(STORAGE_DIRECTION_KEY, readingDirection);
    updateDirectionButton();
    if (displayMode === 'double') {
      showCurrentPage();
    }
  }

  function updateDirectionButton() {
    const btn = document.getElementById('cbz-direction-btn');
    if (btn) {
      btn.title = `Reading direction: ${readingDirection.toUpperCase()}`;
      btn.classList.toggle('cbz-btn-active', readingDirection === 'rtl');
      // Flip arrow for RTL
      if (readingDirection === 'rtl') {
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>';
      } else {
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><polyline points="12 5 19 12 12 19"/></svg>';
      }
    }
  }

  // --- Event Binding ---
  function bindEvents() {
    if (!containerElement) return;

    // Close
    document.getElementById('cbz-close-btn')?.addEventListener('click', close);

    // Page navigation
    document.getElementById('cbz-prev-btn')?.addEventListener('click', prevPage);
    document.getElementById('cbz-next-btn')?.addEventListener('click', nextPage);
    document.getElementById('cbz-nav-left')?.addEventListener('click', () => {
      readingDirection === 'rtl' ? nextPage() : prevPage();
    });
    document.getElementById('cbz-nav-right')?.addEventListener('click', () => {
      readingDirection === 'rtl' ? prevPage() : nextPage();
    });

    const pageInput = document.getElementById('cbz-page-input');
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

    // Fit mode
    const fitSelect = document.getElementById('cbz-fit-select');
    if (fitSelect) {
      fitSelect.value = fitMode;
      fitSelect.addEventListener('change', () => {
        fitMode = fitSelect.value;
        localStorage.setItem(STORAGE_FIT_KEY, fitMode);
        showCurrentPage();
      });
    }

    // Display mode
    const displaySelect = document.getElementById('cbz-display-select');
    if (displaySelect) {
      displaySelect.value = displayMode;
      displaySelect.addEventListener('change', () => {
        displayMode = displaySelect.value;
        localStorage.setItem(STORAGE_DISPLAY_KEY, displayMode);
        showCurrentPage();
      });
    }

    // Direction
    document.getElementById('cbz-direction-btn')?.addEventListener('click', toggleDirection);

    // Fullscreen
    document.getElementById('cbz-fullscreen-btn')?.addEventListener('click', () => {
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
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT') return;

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          readingDirection === 'rtl' ? nextPage() : prevPage();
          break;
        case 'ArrowRight':
        case ' ':
          event.preventDefault();
          readingDirection === 'rtl' ? prevPage() : nextPage();
          break;
        case 'ArrowUp':
        case 'PageUp':
          event.preventDefault();
          prevPage();
          break;
        case 'ArrowDown':
        case 'PageDown':
          event.preventDefault();
          nextPage();
          break;
        case 'Home':
          event.preventDefault();
          goToPage(1);
          break;
        case 'End':
          event.preventDefault();
          goToPage(totalPages);
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
        default:
          // Number keys for quick page jump (1-9 for 10%, 20%, etc.)
          if (event.key >= '1' && event.key <= '9' && !event.ctrlKey && !event.metaKey) {
            const fraction = parseInt(event.key, 10) / 10;
            goToPage(Math.max(1, Math.round(totalPages * fraction)));
          }
          break;
      }
    };
    document.addEventListener('keydown', keyHandler);

    // Touch: swipe in single/double mode
    const viewport = document.getElementById('cbz-viewport');
    if (viewport) {
      let swipeStartX = 0;
      let swipeStartY = 0;

      viewport.addEventListener('touchstart', (event) => {
        if (event.touches.length === 1) {
          swipeStartX = event.touches[0].clientX;
          swipeStartY = event.touches[0].clientY;
        }
      }, { passive: true });

      viewport.addEventListener('touchend', (event) => {
        if (displayMode === 'continuous') return;
        if (event.changedTouches.length === 1) {
          const deltaX = event.changedTouches[0].clientX - swipeStartX;
          const deltaY = event.changedTouches[0].clientY - swipeStartY;

          if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
            if (readingDirection === 'ltr') {
              if (deltaX > 0) prevPage();
              else nextPage();
            } else {
              if (deltaX > 0) nextPage();
              else prevPage();
            }
          }
        }
      }, { passive: true });
    }
  }

  // --- Error Display ---
  function showError(message) {
    const loadingEl = document.getElementById('cbz-loading');
    if (loadingEl) {
      loadingEl.innerHTML = `
        <div class="cbz-error">
          <div class="cbz-error-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div class="cbz-error-title">Unable to open comic</div>
          <div class="cbz-error-message">${escapeHtml(message)}</div>
          <button class="cbz-error-btn" id="cbz-error-close">Go Back</button>
        </div>
      `;
      loadingEl.style.display = 'flex';
      document.getElementById('cbz-error-close')?.addEventListener('click', close);
    }
  }

  // --- Core: Open ---
  async function open(bookId, format) {
    currentBookId = bookId;
    const fileFormat = (format || 'cbz').toUpperCase();
    currentPage = 1;
    totalPages = 0;
    imageUrls = [];
    preloadedImages.clear();
    fitMode = getStoredFit();
    displayMode = getStoredDisplay();
    readingDirection = getStoredDirection();

    containerElement = document.createElement('div');
    containerElement.className = 'cbz-reader-container';
    containerElement.setAttribute('role', 'application');
    containerElement.setAttribute('aria-label', 'Comic Reader');
    containerElement.innerHTML = buildReaderHTML('Loading...');
    document.body.appendChild(containerElement);
    document.body.style.overflow = 'hidden';

    bindEvents();
    updateDirectionButton();

    try {
      await loadJsZip();

      const savedProgress = await fetchProgress(bookId);
      const fileUrl = withToken(`${API}/books/${bookId}/file?format=${fileFormat}`);

      // Download the CBZ file
      const response = await fetch(fileUrl, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Failed to download file (${response.status})`);
      const arrayBuffer = await response.arrayBuffer();

      // Extract images
      imageUrls = await extractImages(arrayBuffer);
      totalPages = imageUrls.length;

      if (totalPages === 0) {
        throw new Error('No images found in the CBZ archive');
      }

      // Update UI
      const pageTotal = document.getElementById('cbz-page-total');
      if (pageTotal) pageTotal.textContent = `/ ${totalPages}`;
      const pageInput = document.getElementById('cbz-page-input');
      if (pageInput) {
        pageInput.max = totalPages;
        pageInput.value = '1';
      }

      // Restore progress
      if (savedProgress?.locator) {
        const savedPage = parseInt(savedProgress.locator, 10);
        if (!isNaN(savedPage) && savedPage >= 1 && savedPage <= totalPages) {
          currentPage = savedPage;
        }
      }

      // Build thumbnail strip
      buildThumbnailStrip();

      // Show first page
      showCurrentPage();

      // Hide loading
      const loadingEl = document.getElementById('cbz-loading');
      if (loadingEl) loadingEl.style.display = 'none';

    } catch (error) {
      showError(error.message || 'Failed to open comic archive');
    }
  }

  // --- Core: Close ---
  function close() {
    // Save final progress
    if (currentBookId && totalPages > 0) {
      saveProgress(currentBookId, currentPage, currentPage / totalPages);
    }

    if (saveProgressTimer) clearTimeout(saveProgressTimer);
    if (continuousScrollObserver) {
      continuousScrollObserver.disconnect();
      continuousScrollObserver = null;
    }

    // Revoke object URLs
    for (const url of imageUrls) {
      URL.revokeObjectURL(url);
    }
    imageUrls = [];
    preloadedImages.clear();

    const bookId = currentBookId;
    currentBookId = null;
    totalPages = 0;
    currentPage = 1;

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
  window.IronshelfCbzReader = IronshelfCbzReader;
}
