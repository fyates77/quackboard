/**
 * Editor panel component.
 *
 * HTML editor with collapse/expand toggle.
 * SQL editing is handled per-visualization via the SQL drawer (see mountSQLDrawer).
 */

import { EditorView, basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorState } from '@codemirror/state';

// ─── HTML editor state ────────────────────────────────────────

let container = null;
let editorView = null;
let currentPage = null;
let onHTMLChange = null;
let changeTimeout = null;

// ─── SQL drawer state ─────────────────────────────────────────

let drawerEl = null;
let drawerEditorView = null;
let drawerQueryName = null;
let onSQLApply = null;

/**
 * Create and mount the editor panel (HTML only).
 *
 * @param {HTMLElement} el - Where to mount
 * @param {object} callbacks - { onHTMLChange, onCollapse }
 */
export function mountEditorPanel(el, callbacks) {
  container = el;
  onHTMLChange = callbacks.onHTMLChange;

  container.innerHTML = `
    <div class="editor-tabs">
      <span class="editor-tab active" data-tab="html">HTML</span>
      <button class="editor-collapse-btn" id="editor-collapse-btn" title="Hide editor">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
    </div>
    <div class="editor-container" id="editor-mount"></div>
  `;

  container.querySelector('#editor-collapse-btn').addEventListener('click', () => {
    if (callbacks.onCollapse) callbacks.onCollapse();
  });
}

/**
 * Load a page's HTML into the editor.
 *
 * @param {object} page - { id, html, queries }
 */
export function setEditorPage(page) {
  currentPage = page;
  createEditor();
}

function createEditor() {
  const mount = container?.querySelector('#editor-mount');
  if (!mount) return;

  if (editorView) {
    editorView.destroy();
    editorView = null;
  }

  if (!currentPage) {
    mount.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No dashboard yet</div>
        <div class="empty-state-text">Generate a dashboard first, then edit the code here.</div>
      </div>
    `;
    return;
  }

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const extensions = [
    basicSetup,
    html(),
    EditorView.lineWrapping,
    EditorView.updateListener.of(update => {
      if (update.docChanged) handleChange(update.state.doc.toString());
    }),
  ];
  if (prefersDark) extensions.push(oneDark);

  editorView = new EditorView({
    state: EditorState.create({ doc: currentPage.html || '', extensions }),
    parent: mount,
  });
}

function handleChange(newContent) {
  clearTimeout(changeTimeout);
  changeTimeout = setTimeout(() => {
    if (!currentPage || !onHTMLChange) return;
    onHTMLChange(currentPage.id, newContent);
  }, 500);
}

/**
 * Get the current editor content.
 */
export function getEditorContent() {
  return editorView ? editorView.state.doc.toString() : '';
}

// ─── SQL Drawer ───────────────────────────────────────────────

/**
 * Mount the SQL drawer inside the preview panel element.
 * The drawer slides up from the bottom when a visualization is clicked.
 *
 * @param {HTMLElement} previewPanelEl - The preview panel container
 * @param {object} callbacks - { onApply(queryName, sqlText) }
 */
export function mountSQLDrawer(previewPanelEl, callbacks) {
  onSQLApply = callbacks.onApply;

  const drawer = document.createElement('div');
  drawer.className = 'sql-drawer';
  drawer.id = 'sql-drawer';
  drawer.innerHTML = `
    <div class="sql-drawer-header">
      <div class="sql-drawer-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             width="14" height="14" style="flex-shrink:0">
          <ellipse cx="12" cy="6" rx="8" ry="3"/>
          <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/>
          <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>
        </svg>
        <span id="sql-drawer-query-name">query</span>
      </div>
      <div class="sql-drawer-actions">
        <button class="btn btn-primary sql-drawer-run" id="sql-drawer-run">Run</button>
        <button class="sql-drawer-close" id="sql-drawer-close" title="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" width="14" height="14">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="sql-drawer-editor" id="sql-drawer-editor"></div>
  `;

  previewPanelEl.appendChild(drawer);
  drawerEl = drawer;

  drawer.querySelector('#sql-drawer-close').addEventListener('click', closeSQLDrawer);
  drawer.querySelector('#sql-drawer-run').addEventListener('click', () => {
    if (!drawerEditorView || !drawerQueryName || !onSQLApply) return;
    onSQLApply(drawerQueryName, drawerEditorView.state.doc.toString().trim());
  });
}

/**
 * Open the SQL drawer for a specific query.
 *
 * @param {string} queryName - The query identifier
 * @param {string} sqlText - The current SQL for this query
 */
export function openSQLDrawer(queryName, sqlText) {
  if (!drawerEl) return;

  drawerQueryName = queryName;
  drawerEl.querySelector('#sql-drawer-query-name').textContent = queryName;
  drawerEl.classList.add('open');

  const mount = drawerEl.querySelector('#sql-drawer-editor');
  if (drawerEditorView) {
    drawerEditorView.destroy();
    drawerEditorView = null;
  }

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const extensions = [basicSetup, sql(), EditorView.lineWrapping];
  if (prefersDark) extensions.push(oneDark);

  drawerEditorView = new EditorView({
    state: EditorState.create({ doc: sqlText || '', extensions }),
    parent: mount,
  });
  drawerEditorView.focus();
}

/**
 * Close the SQL drawer.
 */
export function closeSQLDrawer() {
  if (!drawerEl) return;
  drawerEl.classList.remove('open');
  if (drawerEditorView) {
    drawerEditorView.destroy();
    drawerEditorView = null;
  }
  drawerQueryName = null;
}
