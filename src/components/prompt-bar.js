/**
 * Prompt bar component.
 *
 * The text input where users describe what dashboard they want.
 * Supports both initial generation and iterative refinement.
 */

let onSubmit = null;
let isGenerating = false;

/**
 * Create and mount the prompt bar.
 *
 * @param {HTMLElement} container - Where to mount
 * @param {function} onPromptSubmit - Called with the prompt text
 */
export function mountPromptBar(container, onPromptSubmit) {
  onSubmit = onPromptSubmit;

  container.innerHTML = `
    <textarea
      class="prompt-input"
      id="prompt-input"
      placeholder="Describe the dashboard you want... e.g. 'Show me a sales overview with monthly revenue chart, top products table, and a drill-down by region'"
      rows="1"
    ></textarea>
    <button class="btn btn-primary" id="generate-btn">
      Generate
    </button>
  `;

  const input = container.querySelector('#prompt-input');
  const btn = container.querySelector('#generate-btn');

  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  // Submit on Enter (Shift+Enter for new line)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  btn.addEventListener('click', submit);
}

function submit() {
  if (isGenerating) return;

  const input = document.getElementById('prompt-input');
  const text = input.value.trim();
  if (!text) return;

  if (onSubmit) onSubmit(text);
}

/**
 * Set the generating state (disables input during generation).
 */
export function setGenerating(generating) {
  isGenerating = generating;
  const btn = document.getElementById('generate-btn');
  const input = document.getElementById('prompt-input');

  if (btn) {
    btn.disabled = generating;
    btn.innerHTML = generating
      ? '<span class="spinner" style="width:14px;height:14px;border-width:1.5px"></span>'
      : 'Generate';
  }

  if (input) {
    input.disabled = generating;
  }
}

/**
 * Clear the prompt input after successful generation.
 */
export function clearPrompt() {
  const input = document.getElementById('prompt-input');
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }
}
