/**
 * Editor panel component.
 *
 * A tabbed code editor (HTML, SQL) powered by CodeMirror 6.
 * Users can manually edit the AI-generated code, and changes
 * are reflected live in the preview.
 */

import { EditorView, basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorState } from '@codemirror/state';

let container = null;
let currentTab = 'html';
let editorView = null;
let currentPage = null;
let onHTMLChange = null;
let onSQLChange = null;
let changeTimeout = null;

/**
 * Create and mount the editor panel.
 *
 * @param {HTMLElement} el - Where to mount
 * @param {object} callbacks - { onHTMLChange, onSQLChange }
 */
export function mountEditorPanel(el, callbacks) {
  container = el;
  onHTMLChange = callbacks.onHTMLChange;
  onSQLChange = callbacks.onSQLChange;

  container.innerHTML = `
    <div class="editor-tabs">
      <button class="editor-tab active" data-tab="html">HTML</button>
      <button class="editor-tab" data-tab="sql">SQL</button>
      <button class="editor-sql-refresh" id="sql-refresh-btn" style="display:none">Refresh</button>
    </div>
    <div class="editor-container" id="editor-mount"></div>
  `;

  // Tab switching
  container.querySelectorAll('.editor-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
  });

  // Manual SQL refresh button
  container.querySelector('#sql-refresh-btn').addEventListener('click', () => {
    if (!currentPage || !editorView) return;
    const queries = parseSQLContent(editorView.state.doc.toString());
    if (onSQLChange) onSQLChange(currentPage.id, queries);
  });
}

/**
 * Load a page's code into the editor.
 *
 * @param {object} page - { id, html, queries }
 */
export function setEditorPage(page) {
  currentPage = page;
  currentTab = 'html';
  updateTabUI();
  createEditor();
}

/**
 * Switch between HTML and SQL tabs.
 */
function switchTab(tab) {
  currentTab = tab;
  updateTabUI();
  createEditor();
}

function updateTabUI() {
  container.querySelectorAll('.editor-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === currentTab);
  });
  const refreshBtn = container.querySelector('#sql-refresh-btn');
  if (refreshBtn) refreshBtn.style.display = currentTab === 'sql' ? '' : 'none';
}

/**
 * Create or recreate the CodeMirror editor with the right content and language.
 */
function createEditor() {
  const mount = container.querySelector('#editor-mount');
  if (!mount) return;

  // Destroy existing editor
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

  let content, language;

  if (currentTab === 'html') {
    content = currentPage.html || '';
    language = html();
  } else {
    // Show all queries as named SQL blocks with a header
    const entries = Object.entries(currentPage.queries || {});
    const header = `-- ${entries.length} quer${entries.length === 1 ? 'y' : 'ies'} on this page  •  add or rename with: -- Query: name`;
    const blocks = entries
      .map(([name, sqlText]) => `-- Query: ${name}\n${sqlText.trimEnd()};`)
      .join('\n\n');
    content = header + '\n\n' + blocks;
    language = sql();
  }

  // Detect dark mode
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  const extensions = [
    basicSetup,
    language,
    EditorView.lineWrapping,
    EditorView.updateListener.of(update => {
      if (update.docChanged) {
        handleChange(update.state.doc.toString());
      }
    }),
  ];

  if (prefersDark) {
    extensions.push(oneDark);
  }

  editorView = new EditorView({
    state: EditorState.create({
      doc: content,
      extensions,
    }),
    parent: mount,
  });
}

/**
 * Handle editor changes. HTML auto-refreshes with debounce; SQL waits for the Refresh button.
 */
function handleChange(newContent) {
  if (currentTab !== 'html') return;
  clearTimeout(changeTimeout);
  changeTimeout = setTimeout(() => {
    if (!currentPage) return;
    if (onHTMLChange) onHTMLChange(currentPage.id, newContent);
  }, 500);
}

/**
 * Parse the SQL editor content back into a {name: sql} object.
 * Expects the format: -- Query: name\nSELECT ...;
 */
function parseSQLContent(content) {
  const queries = {};
  const blocks = content.split(/^-- Query: /m).filter(Boolean);

  for (const block of blocks) {
    const newlineIndex = block.indexOf('\n');
    if (newlineIndex === -1) continue;

    const name = block.substring(0, newlineIndex).trim();
    const sqlText = block.substring(newlineIndex + 1).trim().replace(/;$/, '');

    if (name && sqlText) {
      queries[name] = sqlText;
    }
  }

  return queries;
}

/**
 * Get the current editor content.
 */
export function getEditorContent() {
  return editorView ? editorView.state.doc.toString() : '';
}

/**
 * Switch to the SQL tab and scroll to a specific named query.
 *
 * @param {string} queryName - The query name to jump to
 */
export function focusQuery(queryName) {
  if (currentTab !== 'sql') {
    switchTab('sql');
  }

  if (!editorView) return;

  const content = editorView.state.doc.toString();
  const marker = `-- Query: ${queryName}`;
  const pos = content.indexOf(marker);
  if (pos === -1) return;

  editorView.dispatch({
    selection: { anchor: pos, head: pos + marker.length },
    effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 20 }),
  });
  editorView.focus();
}
