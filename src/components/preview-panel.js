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
 * @param {function} onViewQuery - Called when user clicks "View query" on a visual
 */
export function mountPreviewPanel(el, onNavigate, onViewQuery) {
  container = el;
  onPageSwitch = onNavigate;

  container.innerHTML = `
    <div class="preview-toolbar">
      <div class="preview-toolbar-group">
        <div class="page-tabs" id="page-tabs"></div>
      </div>
      <div class="preview-toolbar-group">
        <div class="status-bar" id="preview-status">
          <span class="status-dot" id="status-dot"></span>
          <span id="status-text">Ready</span>
        </div>
      </div>
    </div>
    <iframe class="preview-iframe" id="preview-iframe" sandbox="allow-scripts allow-modals"></iframe>
  `;

  iframe = container.querySelector('#preview-iframe');

  // Initialise the sandbox bridge
  initSandbox(iframe, (pageId, params) => {
    if (onPageSwitch) onPageSwitch(pageId, params);
  }, (queryName) => {
    if (onViewQuery) onViewQuery(queryName);
  });

  // Show empty state initially
  showEmptyState();
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

  // Render page tabs
  renderPageTabs();

  // Render the current page
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
 */
export async function refreshCurrentPage() {
  if (!currentProject) return;

  const page = currentProject.pages[currentPageIndex];
  if (page) {
    setStatus('loading', 'Refreshing...');
    try {
      await renderPage(page, page._params || {});
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
