/**
 * Quick Edit panel component.
 *
 * A slide-in panel with live controls for colors, typography,
 * and layout. Changes are applied instantly to the preview iframe
 * via CSS injection (no re-render required).
 */

const DEFAULTS = {
  bgBase:       '#fafaf8',
  bgCard:       '#ffffff',
  accent:       '#e85d24',
  textPrimary:  '#1a1a18',
  fontScale:    1,      // multiplier applied to 14px base
  borderRadius: 12,     // px, 0–24
  cardPadding:  20,     // px, 8–48
  darkMode:     false,
};

let panelEl = null;
let currentTheme = { ...DEFAULTS };
let onChangeCallback = null;
let visible = false;

/**
 * Mount the quick-edit panel inside a container element.
 *
 * @param {HTMLElement} containerEl - Parent element (the preview panel)
 * @param {object} callbacks - { onChange(cssString) }
 */
export function mountQuickEditPanel(containerEl, { onChange }) {
  onChangeCallback = onChange;

  panelEl = document.createElement('div');
  panelEl.className = 'quick-edit-panel';
  panelEl.id = 'quick-edit-panel';
  panelEl.innerHTML = buildPanelHTML();
  containerEl.appendChild(panelEl);

  wireControls();
}

function buildPanelHTML() {
  const t = currentTheme;
  return `
    <div class="qe-header">
      <span class="qe-title">Quick Edit</span>
      <button class="qe-close" id="qe-close" title="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" width="13" height="13">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="qe-body">

      <div class="qe-section">
        <div class="qe-section-title">Colors</div>

        <div class="qe-row">
          <label class="qe-label">Page background</label>
          <input type="color" class="qe-color" id="qe-bg-base" value="${t.bgBase}">
        </div>
        <div class="qe-row">
          <label class="qe-label">Card background</label>
          <input type="color" class="qe-color" id="qe-bg-card" value="${t.bgCard}">
        </div>
        <div class="qe-row">
          <label class="qe-label">Accent</label>
          <input type="color" class="qe-color" id="qe-accent" value="${t.accent}">
        </div>
        <div class="qe-row">
          <label class="qe-label">Text</label>
          <input type="color" class="qe-color" id="qe-text-primary" value="${t.textPrimary}">
        </div>

        <div class="qe-row qe-dark-row">
          <label class="qe-label" for="qe-dark-mode">Dark mode</label>
          <label class="qe-toggle">
            <input type="checkbox" id="qe-dark-mode" ${t.darkMode ? 'checked' : ''}>
            <span class="qe-toggle-track"></span>
          </label>
        </div>
      </div>

      <div class="qe-section">
        <div class="qe-section-title">Typography</div>
        <div class="qe-row">
          <label class="qe-label">Size</label>
          <div class="qe-chips">
            <button class="qe-chip ${t.fontScale === 0.85  ? 'active' : ''}" data-scale="0.85">S</button>
            <button class="qe-chip ${t.fontScale === 1     ? 'active' : ''}" data-scale="1">M</button>
            <button class="qe-chip ${t.fontScale === 1.15  ? 'active' : ''}" data-scale="1.15">L</button>
            <button class="qe-chip ${t.fontScale === 1.3   ? 'active' : ''}" data-scale="1.3">XL</button>
          </div>
        </div>
      </div>

      <div class="qe-section">
        <div class="qe-section-title">Layout</div>

        <div class="qe-row qe-row-slider">
          <div class="qe-slider-label">
            <label class="qe-label">Radius</label>
            <span class="qe-slider-val" id="qe-radius-val">${t.borderRadius}px</span>
          </div>
          <input type="range" class="qe-slider" id="qe-border-radius"
                 min="0" max="24" value="${t.borderRadius}">
        </div>

      </div>

    </div>

    <div class="qe-footer">
      <button class="btn btn-secondary qe-reset-btn" id="qe-reset">Reset defaults</button>
    </div>
  `;
}

function wireControls() {
  panelEl.querySelector('#qe-close').addEventListener('click', hideQuickEditPanel);

  // Color inputs
  const colorMap = {
    'qe-bg-base':      'bgBase',
    'qe-bg-card':      'bgCard',
    'qe-accent':       'accent',
    'qe-text-primary': 'textPrimary',
  };
  for (const [id, key] of Object.entries(colorMap)) {
    panelEl.querySelector(`#${id}`).addEventListener('input', e => {
      currentTheme[key] = e.target.value;
      emit();
    });
  }

  // Dark mode toggle
  panelEl.querySelector('#qe-dark-mode').addEventListener('change', e => {
    currentTheme.darkMode = e.target.checked;
    if (currentTheme.darkMode) {
      currentTheme.bgBase      = '#1a1a18';
      currentTheme.bgCard      = '#242422';
      currentTheme.textPrimary = '#f0ede8';
    } else {
      currentTheme.bgBase      = DEFAULTS.bgBase;
      currentTheme.bgCard      = DEFAULTS.bgCard;
      currentTheme.textPrimary = DEFAULTS.textPrimary;
    }
    syncColorInputs();
    emit();
  });

  // Font size chips
  panelEl.querySelectorAll('.qe-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      panelEl.querySelectorAll('.qe-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTheme.fontScale = parseFloat(btn.dataset.scale);
      emit();
    });
  });

  // Sliders
  const radiusInput  = panelEl.querySelector('#qe-border-radius');
  const radiusVal    = panelEl.querySelector('#qe-radius-val');

  radiusInput.addEventListener('input', () => {
    currentTheme.borderRadius = parseInt(radiusInput.value);
    radiusVal.textContent = currentTheme.borderRadius + 'px';
    emit();
  });

  // Reset
  panelEl.querySelector('#qe-reset').addEventListener('click', () => {
    currentTheme = { ...DEFAULTS };
    panelEl.innerHTML = buildPanelHTML();
    wireControls();
    emit();
  });
}

function syncColorInputs() {
  panelEl.querySelector('#qe-bg-base').value      = currentTheme.bgBase;
  panelEl.querySelector('#qe-bg-card').value      = currentTheme.bgCard;
  panelEl.querySelector('#qe-text-primary').value = currentTheme.textPrimary;
}

function emit() {
  if (onChangeCallback) onChangeCallback(compileCSS(currentTheme));
}

export function toggleQuickEditPanel() {
  visible = !visible;
  panelEl?.classList.toggle('open', visible);
}

export function hideQuickEditPanel() {
  visible = false;
  panelEl?.classList.remove('open');
}

/**
 * Get the current compiled theme CSS (used when re-rendering a page).
 */
export function getCurrentThemeCSS() {
  return compileCSS(currentTheme);
}

/**
 * Compile the theme object into a CSS string that gets injected into the iframe.
 * Uses !important overrides so they beat the generated inline styles.
 */
export function compileCSS(theme) {
  const fontSize = Math.round(14 * theme.fontScale);
  const r = theme.borderRadius;

  return `
/* ── Quackboard Quick Edit ── */
body {
  background: ${theme.bgBase} !important;
  color: ${theme.textPrimary} !important;
  font-size: ${fontSize}px !important;
}
h1, h2, h3, h4, h5, h6, .metric-value, .kpi-value, .stat-value, [class*="title"], [class*="heading"] {
  color: ${theme.textPrimary} !important;
}
p, span, td, th, li, label, .label, .subtitle, .description, [class*="label"], [class*="subtitle"] {
  color: color-mix(in srgb, ${theme.textPrimary} 70%, transparent) !important;
}
.card, .panel, .widget, .chart-container, .chart-wrapper,
.metric-card, .kpi-card, .stat-card, .visual-card, .data-card,
[class*="card"], [class*="panel"], [class*="widget"] {
  background: ${theme.bgCard} !important;
  border-radius: ${r}px !important;
}
canvas {
  border-radius: ${Math.max(0, r - 4)}px !important;
}
select, input[type="text"], input[type="search"], input[type="date"], textarea {
  border-radius: ${Math.min(r, 8)}px !important;
}
button, .btn, [class*="btn-"], [class*="-button"] {
  border-radius: ${Math.min(r, 8)}px !important;
}
a, .link, .accent, [class*="accent"], [class*="brand"] {
  color: ${theme.accent} !important;
}
`.trim();
}
