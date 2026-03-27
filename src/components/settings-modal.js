/**
 * Settings modal component.
 *
 * Manages AI provider configuration (API key, model selection).
 * Settings are stored in localStorage.
 */

const SETTINGS_KEY = 'quackboard_settings';

const PROVIDERS = {
  anthropic: {
    name: 'Anthropic (Claude)',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (recommended)' },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
    ],
    keyPlaceholder: 'sk-ant-...',
    keyHint: 'Get a key at console.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o (recommended)' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (faster, cheaper)' },
    ],
    keyPlaceholder: 'sk-...',
    keyHint: 'Get a key at platform.openai.com',
  },
};

let modalEl = null;

/**
 * Create and mount the settings modal (hidden by default).
 */
export function mountSettingsModal() {
  modalEl = document.createElement('div');
  modalEl.className = 'modal-overlay';
  modalEl.id = 'settings-modal';

  const settings = loadSettings();

  modalEl.innerHTML = `
    <div class="modal">
      <div class="modal-title">Settings</div>

      <div class="form-group">
        <label class="form-label">AI provider</label>
        <select class="form-select" id="settings-provider">
          ${Object.entries(PROVIDERS).map(([key, p]) =>
            `<option value="${key}" ${settings.provider === key ? 'selected' : ''}>${p.name}</option>`
          ).join('')}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">API key</label>
        <input
          type="password"
          class="form-input"
          id="settings-api-key"
          placeholder="${PROVIDERS[settings.provider]?.keyPlaceholder || ''}"
          value="${settings.apiKey || ''}"
        />
        <div class="form-hint" id="settings-key-hint">
          ${PROVIDERS[settings.provider]?.keyHint || ''}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Model</label>
        <select class="form-select" id="settings-model">
          ${renderModelOptions(settings.provider, settings.model)}
        </select>
      </div>

      <div class="modal-actions">
        <button class="btn btn-secondary" id="settings-cancel">Cancel</button>
        <button class="btn btn-primary" id="settings-save">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  // Close on overlay click
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) hideSettings();
  });

  // Provider change updates model list and hints
  modalEl.querySelector('#settings-provider').addEventListener('change', (e) => {
    const provider = e.target.value;
    const modelSelect = modalEl.querySelector('#settings-model');
    const keyInput = modalEl.querySelector('#settings-api-key');
    const hint = modalEl.querySelector('#settings-key-hint');

    modelSelect.innerHTML = renderModelOptions(provider, null);
    keyInput.placeholder = PROVIDERS[provider]?.keyPlaceholder || '';
    hint.textContent = PROVIDERS[provider]?.keyHint || '';
  });

  // Save
  modalEl.querySelector('#settings-save').addEventListener('click', () => {
    saveSettings({
      provider: modalEl.querySelector('#settings-provider').value,
      apiKey: modalEl.querySelector('#settings-api-key').value,
      model: modalEl.querySelector('#settings-model').value,
    });
    hideSettings();
  });

  // Cancel
  modalEl.querySelector('#settings-cancel').addEventListener('click', hideSettings);
}

function renderModelOptions(provider, selectedModel) {
  const models = PROVIDERS[provider]?.models || [];
  return models.map(m =>
    `<option value="${m.id}" ${m.id === selectedModel ? 'selected' : ''}>${m.name}</option>`
  ).join('');
}

/**
 * Show the settings modal.
 */
export function showSettings() {
  if (modalEl) modalEl.classList.add('visible');
}

/**
 * Hide the settings modal.
 */
export function hideSettings() {
  if (modalEl) modalEl.classList.remove('visible');
}

/**
 * Load settings from localStorage.
 */
export function loadSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) return JSON.parse(saved);
  } catch (err) {
    console.warn('Failed to load settings:', err);
  }
  return { provider: 'anthropic', apiKey: '', model: 'claude-sonnet-4-20250514' };
}

/**
 * Save settings to localStorage.
 */
function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Failed to save settings:', err);
  }
}

/**
 * Check if settings are configured (has an API key).
 */
export function isConfigured() {
  const settings = loadSettings();
  return Boolean(settings.apiKey);
}
