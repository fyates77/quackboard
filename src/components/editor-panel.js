/**
 * Editor panel component.
 *
 * Shows the list of SQL queries for the current page.
 * Clicking a query opens the SQL drawer to edit it.
 * SQL editing is per-visualization via the SQL drawer.
 */

import { EditorView, basicSetup } from 'codemirror';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorState } from '@codemirror/state';

let container     = null;
let currentPage   = null;
let callbacks     = {};

// ── SQL Drawer state ──────────────────────────────────────────
let drawerEl         = null;
let drawerEditorView = null;
let drawerQueryName  = null;
let onSQLApply       = null;

/**
 * Mount the editor panel (query list).
 */
export function mountEditorPanel(el, cbs) {
  container = el;
  callbacks = cbs || {};

  container.innerHTML = `
    <div class="editor-tabs">
      <span class="editor-tab active">SQL Queries</span>
      <button class="editor-collapse-btn" id="editor-collapse-btn" title="Hide editor">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
    </div>
    <div class="query-list" id="query-list">
      <div class="empty-state">
        <div class="empty-state-title">No dashboard yet</div>
        <div class="empty-state-text">Generate a dashboard to see its queries here.</div>
      </div>
    </div>
  `;

  container.querySelector('#editor-collapse-btn').addEventListener('click', () => {
    if (callbacks.onCollapse) callbacks.onCollapse();
  });
}

/**
 * Display the queries for a page in the query list panel.
 */
export function setEditorPage(page) {
  currentPage = page;
  renderQueryList(page);
}

function renderQueryList(page) {
  const listEl = container?.querySelector('#query-list');
  if (!listEl) return;

  if (!page?.queries || Object.keys(page.queries).length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No queries</div>
        <div class="empty-state-text">This page has no declared queries.</div>
      </div>`;
    return;
  }

  listEl.innerHTML = Object.entries(page.queries).map(([name, sql]) => {
    const preview = sql.replace(/\s+/g, ' ').trim().slice(0, 72);
    return `<div class="query-item" data-query="${name}">
      <div class="query-item-name">${escHtml(name)}</div>
      <div class="query-item-sql">${escHtml(preview)}${sql.length > 72 ? '…' : ''}</div>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.query-item').forEach(item => {
    item.addEventListener('click', () => {
      if (callbacks.onViewQuery) callbacks.onViewQuery(item.dataset.query);
    });
  });
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── SQL Drawer ────────────────────────────────────────────────

export function mountSQLDrawer(previewPanelEl, cbs) {
  onSQLApply = cbs.onApply;

  const drawer = document.createElement('div');
  drawer.className = 'sql-drawer';
  drawer.id = 'sql-drawer';
  drawer.innerHTML = `
    <div class="sql-drawer-header">
      <div class="sql-drawer-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="flex-shrink:0">
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
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
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

export function openSQLDrawer(queryName, sqlText) {
  if (!drawerEl) return;
  drawerQueryName = queryName;

  const nameEl = drawerEl.querySelector('#sql-drawer-query-name');
  if (nameEl) nameEl.textContent = queryName;

  const mount = drawerEl.querySelector('#sql-drawer-editor');
  if (drawerEditorView) { drawerEditorView.destroy(); drawerEditorView = null; }

  const extensions = [basicSetup, sql(), EditorView.lineWrapping];
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) extensions.push(oneDark);

  drawerEditorView = new EditorView({
    state: EditorState.create({ doc: sqlText || '', extensions }),
    parent: mount,
  });

  drawerEl.classList.add('open');
}

export function closeSQLDrawer() {
  if (drawerEl) drawerEl.classList.remove('open');
}
