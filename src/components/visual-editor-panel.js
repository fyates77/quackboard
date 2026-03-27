/**
 * Visual Editor panel.
 *
 * Opens when the user clicks "Style" on a specific visualization.
 * Shows controls tailored to the visual type (chart, table, KPI).
 * Changes are applied live to the iframe via the sandbox bridge.
 */

let panelEl = null;
let currentVisual = null; // { queryName, type, chartType, currentColor }
let onApplyCallback = null;

// Pending overrides being built before Apply
let pendingOverrides = {};

/**
 * Mount the visual editor panel inside a container element.
 *
 * @param {HTMLElement} containerEl
 * @param {object} callbacks - { onApply(queryName, overrides) }
 */
export function mountVisualEditorPanel(containerEl, { onApply }) {
  onApplyCallback = onApply;

  panelEl = document.createElement('div');
  panelEl.className = 'visual-editor-panel';
  panelEl.id = 'visual-editor-panel';
  renderIdle();
  containerEl.appendChild(panelEl);
}

/**
 * Open the editor for a specific visual.
 *
 * @param {object} info - { queryName, type, chartType, currentColor, hasMultipleDatasets }
 */
export function openVisualEditor(info) {
  currentVisual = info;
  pendingOverrides = {};
  renderForVisual(info);
  panelEl?.classList.add('open');
}

/**
 * Close and reset the panel.
 */
export function closeVisualEditor() {
  currentVisual = null;
  pendingOverrides = {};
  renderIdle();
  panelEl?.classList.remove('open');
}

export function isVisualEditorOpen() {
  return panelEl?.classList.contains('open') ?? false;
}

// ─────────────────────────────────────────────────────────────

function renderIdle() {
  if (!panelEl) return;
  panelEl.innerHTML = `
    <div class="ve-idle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28">
        <rect x="3" y="3" width="7" height="7" rx="1"/>
        <rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/>
        <rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
      <span class="ve-idle-text">Hover a visual and click <strong>Style</strong> to edit it</span>
    </div>
  `;
}

function renderForVisual(info) {
  if (!panelEl) return;

  const typeLabel = info.type === 'chart'
    ? (info.chartType ? info.chartType.charAt(0).toUpperCase() + info.chartType.slice(1) + ' chart' : 'Chart')
    : info.type === 'table' ? 'Table' : 'Card';

  const typeIcon = info.type === 'chart'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`
    : info.type === 'table'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-4 0v2"/></svg>`;

  panelEl.innerHTML = `
    <div class="ve-header">
      <div class="ve-header-title">
        ${typeIcon}
        <span class="ve-query-name">${info.queryName}</span>
      </div>
      <button class="ve-close" id="ve-close" title="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" width="13" height="13">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="ve-body">

      ${info.type === 'chart' ? renderChartSection(info) : ''}
      ${info.type === 'table' ? renderTableSection() : ''}

      <div class="ve-section">
        <div class="ve-section-title">Card</div>
        <div class="ve-row">
          <label class="ve-label">Background</label>
          <input type="color" class="ve-color" id="ve-bg" value="${info.currentBg || '#ffffff'}">
        </div>
        <div class="ve-row ve-row-slider">
          <div class="ve-slider-label">
            <label class="ve-label">Radius</label>
            <span class="ve-slider-val" id="ve-radius-val">${info.currentRadius || 12}px</span>
          </div>
          <input type="range" class="ve-slider" id="ve-radius"
                 min="0" max="24" value="${info.currentRadius || 12}">
        </div>
        <div class="ve-row">
          <label class="ve-label">Font size</label>
          <div class="ve-chips">
            <button class="ve-chip" data-font="12">S</button>
            <button class="ve-chip active" data-font="14">M</button>
            <button class="ve-chip" data-font="17">L</button>
            <button class="ve-chip" data-font="20">XL</button>
          </div>
        </div>
      </div>

    </div>

    <div class="ve-footer">
      <button class="btn btn-secondary ve-reset-btn" id="ve-reset">Reset</button>
    </div>
  `;

  wireControls(info);
}

function renderChartSection(info) {
  const color = info.currentColor || '#e85d24';
  const type  = info.chartType || 'bar';
  return `
    <div class="ve-section">
      <div class="ve-section-title">Chart</div>
      <div class="ve-row">
        <label class="ve-label">Color</label>
        <input type="color" class="ve-color" id="ve-chart-color" value="${color}">
      </div>
      <div class="ve-row">
        <label class="ve-label">Type</label>
        <div class="ve-chips">
          <button class="ve-chip ${type === 'bar'  ? 'active' : ''}" data-chart-type="bar">Bar</button>
          <button class="ve-chip ${type === 'line' ? 'active' : ''}" data-chart-type="line">Line</button>
          <button class="ve-chip ${type === 'area' ? 'active' : ''}" data-chart-type="area">Area</button>
        </div>
      </div>
      <div class="ve-row">
        <label class="ve-label">Legend</label>
        <label class="ve-toggle">
          <input type="checkbox" id="ve-legend" ${info.hasLegend !== false ? 'checked' : ''}>
          <span class="ve-toggle-track"></span>
        </label>
      </div>
    </div>
  `;
}

function renderTableSection() {
  return `
    <div class="ve-section">
      <div class="ve-section-title">Table</div>
      <div class="ve-row">
        <label class="ve-label">Striped rows</label>
        <label class="ve-toggle">
          <input type="checkbox" id="ve-striped">
          <span class="ve-toggle-track"></span>
        </label>
      </div>
      <div class="ve-row">
        <label class="ve-label">Compact</label>
        <label class="ve-toggle">
          <input type="checkbox" id="ve-compact">
          <span class="ve-toggle-track"></span>
        </label>
      </div>
    </div>
  `;
}

function wireControls(info) {
  panelEl.querySelector('#ve-close').addEventListener('click', closeVisualEditor);

  // Chart controls
  if (info.type === 'chart') {
    panelEl.querySelector('#ve-chart-color').addEventListener('input', e => {
      pendingOverrides.chartColor = e.target.value;
      emit();
    });

    panelEl.querySelectorAll('[data-chart-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        panelEl.querySelectorAll('[data-chart-type]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        pendingOverrides.chartType = btn.dataset.chartType;
        emit();
      });
    });

    panelEl.querySelector('#ve-legend').addEventListener('change', e => {
      pendingOverrides.showLegend = e.target.checked;
      emit();
    });
  }

  // Table controls
  if (info.type === 'table') {
    panelEl.querySelector('#ve-striped').addEventListener('change', e => {
      pendingOverrides.striped = e.target.checked;
      emit();
    });
    panelEl.querySelector('#ve-compact').addEventListener('change', e => {
      pendingOverrides.compact = e.target.checked;
      emit();
    });
  }

  // Card controls
  panelEl.querySelector('#ve-bg').addEventListener('input', e => {
    pendingOverrides.background = e.target.value;
    emit();
  });

  const radiusInput = panelEl.querySelector('#ve-radius');
  const radiusVal   = panelEl.querySelector('#ve-radius-val');
  radiusInput.addEventListener('input', () => {
    pendingOverrides.borderRadius = parseInt(radiusInput.value);
    radiusVal.textContent = pendingOverrides.borderRadius + 'px';
    emit();
  });

  panelEl.querySelectorAll('[data-font]').forEach(btn => {
    btn.addEventListener('click', () => {
      panelEl.querySelectorAll('[data-font]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      pendingOverrides.fontSize = parseInt(btn.dataset.font);
      emit();
    });
  });

  panelEl.querySelector('#ve-reset').addEventListener('click', () => {
    pendingOverrides = { _reset: true };
    emit();
    closeVisualEditor();
  });
}

function emit() {
  if (!currentVisual || !onApplyCallback) return;
  onApplyCallback(currentVisual.queryName, { ...pendingOverrides });
}
