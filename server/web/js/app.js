// Ironshelf Web UI — vanilla JS + htmx patterns

const API = '/api/v1';
let currentUser = null;

// --- API helpers ---

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (response.status === 401) {
    window.location.hash = '#/login';
    return null;
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function apiGet(path) { return api(path); }
function apiPost(path, body) { return api(path, { method: 'POST', body: JSON.stringify(body) }); }
function apiPatch(path, body) { return api(path, { method: 'PATCH', body: JSON.stringify(body) }); }
function apiDelete(path) { return api(path, { method: 'DELETE' }); }

// --- Toast ---

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// --- Router ---

function route() {
  const hash = window.location.hash || '#/';
  const [path, ...params] = hash.slice(2).split('/');

  switch (path) {
    case 'login': renderLogin(); break;
    case 'register': renderRegister(); break;
    case 'libraries': renderLibraries(); break;
    case 'library': renderLibraryAuthors(params[0]); break;
    case 'author': renderAuthor(params[0]); break;
    case 'series': renderSeries(params[0]); break;
    case 'book': renderBook(params[0]); break;
    case 'settings': renderSettings(); break;
    case 'users': renderUsers(); break;
    default: renderLibraries(); break;
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

async function renderLogin() {
  document.getElementById('app').innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <h1>Iron<em>&</em>shelf</h1>
        <form id="login-form">
          <div class="form-group">
            <label>Username</label>
            <input type="text" class="form-input" name="username" required autofocus>
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" class="form-input" name="password" required>
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;margin-top:0.5rem">Sign In</button>
        </form>
        <p style="text-align:center;margin-top:1rem;font-size:0.85rem;color:var(--muted)">
          No account? <a href="#/register">Register</a>
        </p>
      </div>
    </div>
  `;

  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await apiPost('/auth/login', {
        username: form.get('username'),
        password: form.get('password'),
      });
      window.location.hash = '#/libraries';
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

async function renderRegister() {
  document.getElementById('app').innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <h1>Iron<em>&</em>shelf</h1>
        <p style="text-align:center;margin-bottom:1rem;font-size:0.85rem;color:var(--muted)">Create your account</p>
        <form id="register-form">
          <div class="form-group">
            <label>Username</label>
            <input type="text" class="form-input" name="username" required autofocus>
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" class="form-input" name="password" required minlength="6">
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;margin-top:0.5rem">Create Account</button>
        </form>
        <p style="text-align:center;margin-top:1rem;font-size:0.85rem;color:var(--muted)">
          Have an account? <a href="#/login">Sign in</a>
        </p>
      </div>
    </div>
  `;

  document.getElementById('register-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await apiPost('/auth/register', {
        username: form.get('username'),
        password: form.get('password'),
      });
      toast('Account created!');
      window.location.hash = '#/libraries';
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// --- Shell ---

function renderShell(content, activePage = '') {
  document.getElementById('app').innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-brand">Iron<em>&</em>shelf</div>
        <nav class="sidebar-nav">
          <a href="#/libraries" class="${activePage === 'libraries' ? 'active' : ''}">📚 Libraries</a>
          <a href="#/settings" class="${activePage === 'settings' ? 'active' : ''}">⚙️ Settings</a>
          ${currentUser?.is_owner ? `<a href="#/users" class="${activePage === 'users' ? 'active' : ''}">👥 Users</a>` : ''}
        </nav>
        <div class="sidebar-footer">
          ${currentUser ? `${currentUser.username} · <a href="#" id="logout-link">Logout</a>` : ''}
        </div>
      </aside>
      <main class="main-content">${content}</main>
    </div>
  `;

  document.getElementById('logout-link')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await apiPost('/auth/logout', {}).catch(() => {});
    currentUser = null;
    window.location.hash = '#/login';
  });
}

// --- Libraries ---

async function renderLibraries() {
  if (!await checkAuth()) return;

  const libraries = await apiGet('/libraries');

  let content = `
    <div class="page-header">
      <h1>Libraries</h1>
      ${currentUser?.is_owner ? '<button class="btn btn-primary" id="add-library-btn">+ Add Library</button>' : ''}
    </div>
  `;

  if (!libraries || libraries.length === 0) {
    content += `
      <div class="card" style="text-align:center;padding:3rem">
        <p style="font-size:1.1rem;margin-bottom:0.5rem">No libraries configured</p>
        <p style="color:var(--muted)">Add a Calibre library or folder to get started.</p>
      </div>
    `;
  } else {
    content += '<div class="grid grid-2">';
    for (const lib of libraries) {
      content += `
        <div class="card" style="cursor:pointer" onclick="window.location.hash='#/library/${lib.id}'">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h3>${lib.name}</h3>
            <span class="badge">${lib.source_kind}</span>
          </div>
          <p style="color:var(--muted);font-size:0.85rem;margin-top:0.25rem">${lib.library_type}</p>
        </div>
      `;
    }
    content += '</div>';
  }

  renderShell(content, 'libraries');

  document.getElementById('add-library-btn')?.addEventListener('click', showAddLibraryModal);
}

function showAddLibraryModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>Add Library</h2>
      <form id="add-library-form">
        <div class="form-group">
          <label>Name</label>
          <input type="text" class="form-input" name="name" required placeholder="My Books">
        </div>
        <div class="form-group">
          <label>Path on server</label>
          <input type="text" class="form-input" name="path" required placeholder="/path/to/calibre/library">
        </div>
        <div class="form-group">
          <label>Source</label>
          <select class="form-input" name="source_kind">
            <option value="calibre">Calibre (metadata.db)</option>
            <option value="folder">Folder scan</option>
          </select>
        </div>
        <div class="form-group">
          <label>Library Type</label>
          <select class="form-input" name="library_type">
            <option value="book">Book</option>
            <option value="light_novel">Light Novel</option>
            <option value="web_novel">Web Novel</option>
            <option value="fanfiction">Fanfiction</option>
            <option value="comic">Comic</option>
            <option value="manga">Manga</option>
            <option value="mixed">Mixed</option>
          </select>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="cancel-modal">Cancel</button>
          <button type="submit" class="btn btn-primary">Add</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#cancel-modal').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.querySelector('#add-library-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await apiPost('/libraries', {
        name: form.get('name'),
        path: form.get('path'),
        source_kind: form.get('source_kind'),
        library_type: form.get('library_type'),
      });
      overlay.remove();
      toast('Library added!');
      renderLibraries();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// --- Library → Authors ---

async function renderLibraryAuthors(libraryId) {
  if (!await checkAuth()) return;

  const [library, authors] = await Promise.all([
    apiGet(`/libraries/${libraryId}`),
    apiGet(`/libraries/${libraryId}/authors`),
  ]);

  let content = `
    <div class="page-header">
      <h1><a href="#/libraries">Libraries</a> / ${library.name}</h1>
    </div>
    <div class="card">
  `;

  if (!authors || authors.length === 0) {
    content += '<p style="color:var(--muted);text-align:center;padding:1rem">No authors found</p>';
  } else {
    for (const author of authors) {
      content += `
        <div class="list-item" onclick="window.location.hash='#/author/${author.id}'">
          <span class="list-item-name">${author.name}</span>
          <span>
            <span class="list-item-count">${author.book_count} books</span>
            ${author.series_count > 0 ? `<span class="list-item-count">${author.series_count} series</span>` : ''}
          </span>
        </div>
      `;
    }
  }

  content += '</div>';
  renderShell(content, 'libraries');
}

// --- Author → Series + Standalone ---

async function renderAuthor(authorId) {
  if (!await checkAuth()) return;

  const [author, series, standalone] = await Promise.all([
    apiGet(`/authors/${authorId}`),
    apiGet(`/authors/${authorId}/series`),
    apiGet(`/authors/${authorId}/standalone`),
  ]);

  let content = `
    <div class="page-header">
      <h1><a href="#/libraries">Libraries</a> / ${author.name}</h1>
    </div>
  `;

  if (series && series.length > 0) {
    content += '<h2 style="margin-bottom:0.75rem">Series</h2><div class="card">';
    for (const s of series) {
      content += `
        <div class="list-item" onclick="window.location.hash='#/series/${s.id}'">
          <span class="list-item-name">${s.name}</span>
          <span class="list-item-count">${s.book_count} books</span>
        </div>
      `;
    }
    content += '</div>';
  }

  if (standalone && standalone.length > 0) {
    content += '<h2 style="margin:1.5rem 0 0.75rem">Standalone</h2><div class="grid grid-4">';
    for (const book of standalone) {
      content += bookCard(book);
    }
    content += '</div>';
  }

  renderShell(content, 'libraries');
}

// --- Series → Books ---

async function renderSeries(seriesId) {
  if (!await checkAuth()) return;

  const data = await apiGet(`/series/${seriesId}`);

  let content = `
    <div class="page-header">
      <h1>${data.name}</h1>
    </div>
    <div class="grid grid-4">
  `;

  for (const book of data.books || []) {
    content += bookCard(book);
  }

  content += '</div>';
  renderShell(content, 'libraries');
}

// --- Book detail ---

async function renderBook(bookId) {
  if (!await checkAuth()) return;

  const book = await apiGet(`/books/${bookId}`);

  const coverUrl = book.has_cover ? `${API}/books/${bookId}/cover` : '';

  let content = `
    <div style="display:flex;gap:2rem;flex-wrap:wrap">
      <div style="width:200px;flex-shrink:0">
        ${coverUrl ? `<img src="${coverUrl}" class="book-cover">` : '<div class="book-cover"></div>'}
      </div>
      <div style="flex:1;min-width:300px">
        <h1>${book.title}</h1>
        ${book.series_index ? `<p style="color:var(--muted);margin-top:0.25rem">Book ${book.series_index}</p>` : ''}

        <div style="margin-top:1rem">
          ${book.tags.length > 0 ? `<p><strong>Tags:</strong> ${book.tags.join(', ')}</p>` : ''}
          ${book.languages.length > 0 ? `<p><strong>Language:</strong> ${book.languages.join(', ')}</p>` : ''}
          ${book.rating ? `<p><strong>Rating:</strong> ${'★'.repeat(book.rating / 2)}${'☆'.repeat(5 - book.rating / 2)}</p>` : ''}
          ${book.pubdate ? `<p><strong>Published:</strong> ${book.pubdate}</p>` : ''}
        </div>

        ${Object.keys(book.custom || {}).length > 0 ? `
          <div style="margin-top:1rem">
            <strong>Custom fields:</strong>
            ${Object.entries(book.custom).map(([k, v]) => `<p style="color:var(--muted)">${k}: ${v}</p>`).join('')}
          </div>
        ` : ''}

        <div style="margin-top:1.5rem;display:flex;gap:0.5rem;flex-wrap:wrap">
          ${book.formats.map(f => `
            <a href="${API}/books/${bookId}/file?format=${f.kind}" class="btn btn-primary" download>
              ⬇ ${f.kind}
            </a>
          `).join('')}
        </div>

        ${book.description ? `
          <div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid #2a2e36">
            <div style="color:var(--text-dim);font-size:0.9rem">${book.description}</div>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  renderShell(content, 'libraries');
}

// --- Settings ---

async function renderSettings() {
  if (!await checkAuth()) return;

  const keys = await apiGet('/auth/api-keys').catch(() => []);

  let content = `
    <div class="page-header">
      <h1>Settings</h1>
    </div>
    <div class="card">
      <h3>API Keys</h3>
      <p style="color:var(--muted);font-size:0.85rem;margin-bottom:1rem">
        Use API keys for Flutter app or external tools. Format: irs_prefix.secret
      </p>
      <div id="api-keys-list">
        ${(keys || []).map(k => `
          <div class="list-item">
            <span><code>irs_${k.prefix}...</code> — ${k.label}</span>
            <button class="btn btn-danger" onclick="deleteApiKey('${k.id}')">Delete</button>
          </div>
        `).join('') || '<p style="color:var(--muted)">No API keys</p>'}
      </div>
      <button class="btn btn-primary" style="margin-top:1rem" onclick="createApiKeyPrompt()">+ Create API Key</button>
    </div>
  `;

  renderShell(content, 'settings');
}

async function createApiKeyPrompt() {
  const label = prompt('Label for this API key:');
  if (!label) return;
  try {
    const result = await apiPost('/auth/api-keys', { label });
    alert(`API Key (copy now — shown once):\n\n${result.key}`);
    renderSettings();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteApiKey(keyId) {
  if (!confirm('Delete this API key?')) return;
  await apiDelete(`/auth/api-keys/${keyId}`);
  toast('Key deleted');
  renderSettings();
}

// --- Users (owner only) ---

async function renderUsers() {
  if (!await checkAuth()) return;
  // TODO: user management (list users, permissions)
  renderShell('<div class="page-header"><h1>Users</h1></div><div class="card"><p style="color:var(--muted)">User management coming soon.</p></div>', 'users');
}

// --- Helpers ---

function bookCard(book) {
  const coverUrl = book.has_cover ? `${API}/books/${book.id}/cover` : '';
  return `
    <div class="book-card" onclick="window.location.hash='#/book/${book.id}'">
      ${coverUrl ? `<img src="${coverUrl}" class="book-cover" loading="lazy">` : '<div class="book-cover"></div>'}
      <div class="book-title">${book.title}</div>
      ${book.series_index ? `<div class="book-meta">#${book.series_index}</div>` : ''}
    </div>
  `;
}

// --- Init ---

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', async () => {
  if (await checkAuth()) {
    route();
  } else {
    window.location.hash = '#/login';
  }
});
