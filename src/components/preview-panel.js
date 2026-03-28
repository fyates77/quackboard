/**
 * Preview panel component.
 *
 * Shows the live-rendered dashboard in a sandboxed iframe.
 * Handles page navigation tabs for multi-page dashboards.
 */

import { initSandbox, renderPage } from '../engine/sandbox.js';

let container = null;
let iframe = null;
let onPageSwitch = null;
let currentProject = null;
let currentPageIndex = 0;

/**
 * Create and mount the preview panel.
 *
 * @param {HTMLElement} el - Where to mount
 * @param {function} onNavigate - Called when a page switch is requested
 * @param {function} onViewQuery - Called when user clicks "Edit SQL" on a visual
 * @param {function} onToggleEditor - Called when the editor toggle button is clicked
 * @param {function} onToggleQuickEdit - Called when the Quick Edit button is clicked
 */
export function mountPreviewPanel(el, onNavigate, onViewQuery, onToggleEditor, onToggleQuickEdit, onSelectVisual) {
  container = el;
  onPageSwitch = onNavigate;

  container.innerHTML = `
    <div class="preview-toolbar">
      <div class="preview-toolbar-group">
        <button class="editor-toggle-btn" id="editor-toggle-btn" title="Show/hide editor">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
        <div class="page-tabs" id="page-tabs"></div>
      </div>
      <div class="preview-toolbar-group">
        <div class="status-bar" id="preview-status">
          <span class="status-dot" id="status-dot"></span>
          <span id="status-text">Ready</span>
        </div>
      </div>
    </div>
    <div class="filter-bar" id="filter-bar"></div>
    <iframe class="preview-iframe" id="preview-iframe" sandbox="allow-scripts allow-modals"></iframe>
  `;

  iframe = container.querySelector('#preview-iframe');

  container.querySelector('#editor-toggle-btn').addEventListener('click', () => {
    if (onToggleEditor) onToggleEditor();
  });

  // Initialise the sandbox bridge
  initSandbox(iframe, (pageId, params) => {
    if (onPageSwitch) onPageSwitch(pageId, params);
  }, (queryName) => {
    if (onViewQuery) onViewQuery(queryName);
  }, (info) => {
    if (onSelectVisual) onSelectVisual(info);
  });

  // Show empty state initially
  showEmptyState();
}

/**
 * Update the editor toggle button icon direction based on editor visibility.
 *
 * @param {boolean} editorVisible
 */
export function setEditorToggleState(editorVisible) {
  const btn = document.getElementById('editor-toggle-btn');
  if (!btn) return;
  // Point right (show) when editor is hidden, point left (hide) when visible
  btn.innerHTML = editorVisible
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
           stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
         <polyline points="15 18 9 12 15 6"/>
       </svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
           stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
         <polyline points="9 18 15 12 9 6"/>
       </svg>`;
}

/**
 * Render a project in the preview.
 *
 * @param {object} project - The dashboard project
 * @param {number} pageIndex - Which page to show
 * @param {object} params - Page parameters
 */
export async function renderProject(project, pageIndex = 0, params = {}) {
  currentProject = project;
  currentPageIndex = pageIndex;

  renderPageTabs();

  const page = project.pages[pageIndex];
  if (page) {
    setStatus('loading', 'Rendering...');
    try {
      await renderPage(page, params);
      setStatus('ready', page.title || page.id);
    } catch (err) {
      setStatus('error', `Error: ${err.message}`);
    }
  }
}

/**
 * Re-render the current page (after code edits).
 * @param {object} [extraParams] - Additional params to merge (e.g. active filter values)
 */
export async function refreshCurrentPage(extraParams = {}) {
  if (!currentProject) return;

  const page = currentProject.pages[currentPageIndex];
  if (page) {
    setStatus('loading', 'Refreshing...');
    try {
      await renderPage(page, { ...(page._params || {}), ...extraParams });
      setStatus('ready', page.title || page.id);
    } catch (err) {
      setStatus('error', `Error: ${err.message}`);
    }
  }
}

/**
 * Render the page navigation tabs.
 */
function renderPageTabs() {
  const tabsContainer = container.querySelector('#page-tabs');
  if (!tabsContainer || !currentProject) return;

  if (currentProject.pages.length <= 1) {
    tabsContainer.innerHTML = '';
    return;
  }

  tabsContainer.innerHTML = currentProject.pages.map((page, i) => `
    <button class="page-tab ${i === currentPageIndex ? 'active' : ''}" data-index="${i}">
      ${page.title || page.id}
    </button>
  `).join('');

  tabsContainer.querySelectorAll('.page-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const index = parseInt(tab.dataset.index);
      if (onPageSwitch) {
        onPageSwitch(currentProject.pages[index].id, {});
      }
    });
  });
}

/**
 * Show the empty state before any dashboard is generated.
 */
function showEmptyState() {
  if (!iframe) return;
  iframe.srcdoc = `
    <!DOCTYPE html>
    <html>
    <head><style>
      body {
        font-family: system-ui, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        margin: 0;
        background: #fafaf8;
        color: #9c9a92;
        text-align: center;
      }
      .empty { max-width: 320px; }
      .empty h2 { font-size: 16px; font-weight: 500; color: #6b6a65; margin: 0 0 6px; }
      .empty p { font-size: 13px; line-height: 1.6; margin: 0; }
    </style></head>
    <body>
      <div class="empty">
        <h2>Your dashboard will appear here</h2>
        <p>Upload some data in the sidebar, then describe what you want to see in the prompt bar above.</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Update the status indicator.
 */
function setStatus(state, text) {
  const dot = container.querySelector('#status-dot');
  const label = container.querySelector('#status-text');

  if (dot) {
    dot.className = 'status-dot';
    if (state === 'loading') dot.classList.add('loading');
    if (state === 'error') dot.classList.add('error');
  }

  if (label) label.textContent = text;
}
