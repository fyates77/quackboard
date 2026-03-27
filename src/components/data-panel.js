/**
 * Data panel component.
 *
 * Shows in the left sidebar. Handles file upload (drag-and-drop or click)
 * and displays the loaded tables with their column schemas.
 */

import { loadFile } from '../engine/duckdb.js';

let tables = [];
let onTablesChanged = null;

/**
 * Create and mount the data panel.
 *
 * @param {HTMLElement} container - Where to mount
 * @param {function} onChange - Called when tables are added/removed
 */
export function mountDataPanel(container, onChange) {
  onTablesChanged = onChange;

  container.innerHTML = `
    <div class="sidebar-header">Data sources</div>
    <div class="sidebar-content">
      <div class="drop-zone" id="drop-zone">
        <svg class="drop-zone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 16V4m0 0L8 8m4-4l4 4"/>
          <path d="M3 16v1a4 4 0 004 4h10a4 4 0 004-4v-1"/>
        </svg>
        <div class="drop-zone-text">
          Drop files here or <strong>browse</strong>
        </div>
        <div class="drop-zone-formats">CSV, Parquet, JSON</div>
        <input type="file" id="file-input" multiple accept=".csv,.tsv,.parquet,.json,.jsonl" style="display:none"/>
      </div>
      <div class="table-list" id="table-list"></div>
    </div>
  `;

  const dropZone = container.querySelector('#drop-zone');
  const fileInput = container.querySelector('#file-input');

  // Click to browse
  dropZone.addEventListener('click', () => fileInput.click());

  // File input change
  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    fileInput.value = ''; // reset so same file can be re-uploaded
  });

  // Drag and drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });
}

/**
 * Process uploaded files.
 */
async function handleFiles(fileList) {
  for (const file of fileList) {
    try {
      const tableInfo = await loadFile(file);
      tables.push(tableInfo);
      renderTableList();
      if (onTablesChanged) onTablesChanged(tables);
    } catch (err) {
      console.error('Failed to load file:', err);
      showToast(`Failed to load ${file.name}: ${err.message}`, 'error');
    }
  }
}

/**
 * Render the list of loaded tables.
 */
function renderTableList() {
  const list = document.getElementById('table-list');
  if (!list) return;

  list.innerHTML = tables.map((table, i) => `
    <div class="table-item" data-index="${i}">
      <div class="table-item-name">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M3 9h18M9 3v18"/>
        </svg>
        ${table.tableName}
      </div>
      <div class="table-item-meta">
        ${table.rowCount.toLocaleString()} rows · ${table.columns.length} columns
      </div>
      <div class="table-columns" id="cols-${i}" style="display:none">
        ${table.columns.map(col => `
          <div class="table-column">
            <span>${col.name}</span>
            <span class="table-column-type">${col.type}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  // Toggle column display on click
  list.querySelectorAll('.table-item').forEach(item => {
    item.addEventListener('click', () => {
      const cols = item.querySelector('.table-columns');
      const isOpen = cols.style.display !== 'none';
      cols.style.display = isOpen ? 'none' : 'flex';
    });
  });
}

/**
 * Get the current list of loaded tables.
 */
export function getTables() {
  return tables;
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
