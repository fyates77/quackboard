/**
 * Filter bar component.
 *
 * Renders page-level filter controls (declared by the AI in the page's
 * "filters" array) above the preview iframe. When any filter value changes,
 * calls the onchange callback with the full current values map so the
 * page can be re-rendered with the new params.
 */

import { runQuery } from '../engine/duckdb.js';

let containerEl = null;
let onChangeCallback = null;
let currentValues = {};

/**
 * Mount the filter bar inside a container element.
 * @param {HTMLElement} el
 */
export function mountFilterBar(el) {
  containerEl = el;
}

/**
 * Render filters for the current page.
 * Hides the bar when the page has no filters.
 *
 * @param {object[]} filters  - Array from page.filters
 * @param {function} onChange - Called with { filterId: value, ... } on every change
 */
export async function renderFilters(filters, onChange) {
  if (!containerEl) return;
  onChangeCallback = onChange;
  currentValues = {};

  if (!filters || filters.length === 0) {
    containerEl.innerHTML = '';
    containerEl.classList.remove('has-filters');
    return;
  }

  containerEl.classList.add('has-filters');

  // Set defaults immediately so first render uses them
  for (const f of filters) {
    currentValues[f.id] = f.default ?? '';
  }

  // Render skeleton (select options load async)
  containerEl.innerHTML =
    filters.map(f => buildControlHTML(f)).join('') +
    `<button class="filter-reset" id="filter-reset" title="Reset filters">Reset</button>`;

  wireListeners(containerEl);

  // Populate select options from their SQL queries
  for (const f of filters) {
    if (f.type !== 'select') continue;
    const selectEl = containerEl.querySelector(`[data-filter-id="${f.id}"]`);
    if (!selectEl) continue;
    try {
      const result = await runQuery(f.optionsQuery);
      const opts = result.rows.map(r => r[0]).filter(v => v !== null && v !== undefined);
      selectEl.innerHTML =
        `<option value="">All</option>` +
        opts.map(o => `<option value="${o}" ${String(o) === String(f.default) ? 'selected' : ''}>${o}</option>`).join('');
      // Apply saved default after options load
      if (f.default) selectEl.value = f.default;
    } catch (err) {
      console.warn(`Filter "${f.id}" optionsQuery failed:`, err);
      selectEl.innerHTML = `<option value="">— failed —</option>`;
    }
  }
}

/**
 * Return the current filter values (used when re-rendering after SQL edits).
 */
export function getCurrentFilterValues() {
  return { ...currentValues };
}

// ─────────────────────────────────────────────────────────────

function buildControlHTML(f) {
  const label = `<label class="filter-label" for="filter-${f.id}">${f.label}</label>`;
  let input = '';

  if (f.type === 'select') {
    input = `<select class="filter-select" id="filter-${f.id}" data-filter-id="${f.id}">
      <option value="">Loading…</option>
    </select>`;
  } else if (f.type === 'date') {
    input = `<input type="date" class="filter-input" id="filter-${f.id}"
      data-filter-id="${f.id}" value="${f.default || ''}">`;
  } else if (f.type === 'number') {
    input = `<input type="number" class="filter-input filter-input-number" id="filter-${f.id}"
      data-filter-id="${f.id}" value="${f.default || ''}" placeholder="${f.label}">`;
  } else {
    // text
    input = `<input type="text" class="filter-input" id="filter-${f.id}"
      data-filter-id="${f.id}" value="${f.default || ''}" placeholder="Search…">`;
  }

  return `<div class="filter-item">${label}${input}</div>`;
}

function wireListeners(root) {
  root.querySelectorAll('[data-filter-id]').forEach(el => {
    // Selects and date/number fire on change; text fires on input for live search
    el.addEventListener('change', handleChange);
    if (el.tagName === 'INPUT' && el.type === 'text') {
      el.addEventListener('input', handleChange);
    }
  });

  const resetBtn = root.querySelector('#filter-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      root.querySelectorAll('[data-filter-id]').forEach(el => {
        el.value = '';
        currentValues[el.dataset.filterId] = '';
      });
      if (onChangeCallback) onChangeCallback({ ...currentValues });
    });
  }
}

function handleChange(e) {
  currentValues[e.target.dataset.filterId] = e.target.value;
  if (onChangeCallback) onChangeCallback({ ...currentValues });
}
