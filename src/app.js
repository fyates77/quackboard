/**
 * Main application shell.
 *
 * Wires together all the components: data panel, prompt bar,
 * editor, preview, and settings. Manages the generation flow.
 */

import { initDuckDB } from './engine/duckdb.js';
import { generateDashboard } from './engine/ai.js';
import {
  setProject,
  getState,
  subscribe,
  navigateToPage,
  navigateToPageIndex,
  updatePageHTML,
  updatePageQueries,
  loadFromStorage,
  exportProject,
  clearProject,
} from './engine/project.js';
import { mountDataPanel } from './components/data-panel.js';
import { mountPromptBar, setGenerating, clearPrompt } from './components/prompt-bar.js';
import { mountEditorPanel, setEditorPage, focusQuery } from './components/editor-panel.js';
import { mountPreviewPanel, renderProject, refreshCurrentPage } from './components/preview-panel.js';
import { mountSettingsModal, showSettings, loadSettings, isConfigured } from './components/settings-modal.js';

/**
 * Boot the application.
 */
export async function initApp() {
  const app = document.getElementById('app');

  // Render the shell
  app.innerHTML = `
    <header class="app-header">
      <div class="app-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3C7.03 3 3 7.03 3 12c0 2.76 1.24 5.23 3.19 6.89"/>
          <path d="M12 3c4.97 0 9 4.03 9 9 0 2.76-1.24 5.23-3.19 6.89"/>
          <circle cx="12" cy="12" r="2"/>
          <path d="M12 8v2"/>
          <path d="M12 14v2"/>
          <path d="M8.93 10.5l1.73 1"/>
          <path d="M13.34 12.5l1.73 1"/>
          <path d="M8.93 13.5l1.73-1"/>
          <path d="M13.34 11.5l1.73-1"/>
        </svg>
        Quackboard
      </div>
      <div class="header-actions">
        <button class="btn-icon" id="btn-export" title="Export dashboard">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 3v12m0 0l-4-4m4 4l4-4"/>
            <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>
          </svg>
        </button>
        <button class="btn-icon" id="btn-clear" title="Clear dashboard">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/>
          </svg>
        </button>
        <button class="btn-icon" id="btn-settings" title="Settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
          </svg>
        </button>
      </div>
    </header>

    <div class="app-body">
      <aside class="sidebar" id="sidebar"></aside>
      <div class="main-area">
        <div class="prompt-bar" id="prompt-bar"></div>
        <div class="workspace" id="workspace">
          <div class="editor-panel" id="editor-panel"></div>
          <div class="preview-panel" id="preview-panel" style="position:relative">
            <div class="generating-overlay" id="generating-overlay">
              <div class="spinner" style="width:28px;height:28px;border-width:3px"></div>
              <div class="generating-text">Generating your dashboard...</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Mount all components
  mountDataPanel(document.getElementById('sidebar'), handleTablesChanged);
  mountPromptBar(document.getElementById('prompt-bar'), handlePromptSubmit);
  mountEditorPanel(document.getElementById('editor-panel'), {
    onHTMLChange: handleHTMLChange,
    onSQLChange: handleSQLChange,
  });
  mountPreviewPanel(document.getElementById('preview-panel'), handlePageNavigate, focusQuery);
  mountSettingsModal();

  // Wire up header buttons
  document.getElementById('btn-settings').addEventListener('click', showSettings);
  document.getElementById('btn-export').addEventListener('click', exportProject);
  document.getElementById('btn-clear').addEventListener('click', () => {
    if (confirm('Clear the current dashboard? This cannot be undone.')) {
      clearProject();
      location.reload();
    }
  });

  // Subscribe to project state changes
  subscribe(handleStateChange);

  // Initialise DuckDB
  try {
    await initDuckDB();
    console.log('DuckDB-WASM initialised.');
  } catch (err) {
    console.error('Failed to initialise DuckDB:', err);
    showToast('Failed to start DuckDB. Try refreshing the page.', 'error');
  }

  // Restore any saved project
  loadFromStorage();
}

/**
 * Handle prompt submission — generate or refine a dashboard.
 */
async function handlePromptSubmit(prompt) {
  // Check settings
  if (!isConfigured()) {
    showSettings();
    showToast('Please configure your API key first.', 'error');
    return;
  }

  const settings = loadSettings();
  const state = getState();

  setGenerating(true);
  showGeneratingOverlay(true);

  try {
    const project = await generateDashboard(
      prompt,
      settings,
      state.hasProject ? state.project : null
    );

    setProject(project);
    clearPrompt();
    showToast('Dashboard generated!');
  } catch (err) {
    console.error('Generation failed:', err);
    showToast(`Generation failed: ${err.message}`, 'error');
  } finally {
    setGenerating(false);
    showGeneratingOverlay(false);
  }
}

/**
 * Handle project state changes — update editor and preview.
 */
function handleStateChange(state) {
  if (state.hasProject && state.currentPage) {
    setEditorPage(state.currentPage);
    renderProject(state.project, state.currentPageIndex, state.currentPage._params || {});
  }
}

/**
 * Handle code editor HTML changes — live update the preview.
 */
function handleHTMLChange(pageId, newHTML) {
  updatePageHTML(pageId, newHTML);
  refreshCurrentPage();
}

/**
 * Handle code editor SQL changes.
 */
function handleSQLChange(pageId, newQueries) {
  updatePageQueries(pageId, newQueries);
  refreshCurrentPage();
}

/**
 * Handle page navigation (from preview or page tabs).
 */
function handlePageNavigate(pageId, params) {
  navigateToPage(pageId, params);
}

/**
 * Handle data tables changing.
 */
function handleTablesChanged(tables) {
  // Could update prompt placeholder, show table count, etc.
  console.log(`${tables.length} table(s) loaded.`);
}

/**
 * Show/hide the generating overlay.
 */
function showGeneratingOverlay(show) {
  const overlay = document.getElementById('generating-overlay');
  if (overlay) overlay.classList.toggle('visible', show);
}

/**
 * Show a toast notification.
 */
function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 4000);
}
