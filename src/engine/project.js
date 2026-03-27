/**
 * Project state manager.
 *
 * Holds the current dashboard project (pages, navigation),
 * manages page switching, and handles save/load to localStorage.
 */

const STORAGE_KEY = 'quackboard_project';

let currentProject = null;
let currentPageIndex = 0;
let listeners = [];

/**
 * Subscribe to project state changes.
 * @param {function} fn - Called with the current state whenever it changes
 * @returns {function} - Unsubscribe function
 */
export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter(l => l !== fn);
  };
}

function notify() {
  const state = getState();
  listeners.forEach(fn => fn(state));
}

/**
 * Get the current state snapshot.
 */
export function getState() {
  return {
    project: currentProject,
    currentPageIndex,
    currentPage: currentProject?.pages?.[currentPageIndex] || null,
    pageCount: currentProject?.pages?.length || 0,
    hasProject: currentProject !== null,
  };
}

/**
 * Set a new project (from AI generation).
 */
export function setProject(project) {
  currentProject = project;
  currentPageIndex = 0;
  saveToStorage();
  notify();
}

/**
 * Navigate to a specific page by ID.
 */
export function navigateToPage(pageId, params = {}) {
  if (!currentProject) return;

  const index = currentProject.pages.findIndex(p => p.id === pageId);
  if (index === -1) {
    console.warn(`Page "${pageId}" not found in project.`);
    return;
  }

  // Attach params to the page for rendering
  currentProject.pages[index]._params = params;
  currentPageIndex = index;
  notify();
}

/**
 * Navigate to a page by index.
 */
export function navigateToPageIndex(index) {
  if (!currentProject || index < 0 || index >= currentProject.pages.length) return;
  currentPageIndex = index;
  notify();
}

/**
 * Update a specific page's HTML (from the code editor).
 */
export function updatePageHTML(pageId, newHTML) {
  if (!currentProject) return;

  const page = currentProject.pages.find(p => p.id === pageId);
  if (page) {
    page.html = newHTML;
    saveToStorage();
    notify();
  }
}

/**
 * Update a specific page's SQL queries (from the code editor).
 */
export function updatePageQueries(pageId, newQueries) {
  if (!currentProject) return;

  const page = currentProject.pages.find(p => p.id === pageId);
  if (page) {
    page.queries = newQueries;
    saveToStorage();
    notify();
  }
}

/**
 * Clear the current project.
 */
export function clearProject() {
  currentProject = null;
  currentPageIndex = 0;
  localStorage.removeItem(STORAGE_KEY);
  notify();
}

/**
 * Save project to localStorage.
 */
function saveToStorage() {
  if (currentProject) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentProject));
    } catch (err) {
      console.warn('Failed to save project to localStorage:', err);
    }
  }
}

/**
 * Load project from localStorage (call on app startup).
 */
export function loadFromStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      currentProject = JSON.parse(saved);
      currentPageIndex = 0;
      notify();
      return true;
    }
  } catch (err) {
    console.warn('Failed to load project from localStorage:', err);
  }
  return false;
}

/**
 * Export the project as a downloadable JSON file.
 */
export function exportProject() {
  if (!currentProject) return;

  const blob = new Blob([JSON.stringify(currentProject, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dashboard.quackboard.json';
  a.click();
  URL.revokeObjectURL(url);
}
