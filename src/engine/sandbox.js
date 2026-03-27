/**
 * Sandbox engine.
 *
 * Renders generated dashboard HTML inside a sandboxed iframe,
 * providing a bridge API so the generated code can execute SQL
 * queries against DuckDB without direct access to the database.
 */

import { runQuery } from './duckdb.js';

let currentIframe = null;
let currentPageId = null;
let currentParams = {};
let onNavigateCallback = null;
let onViewQueryCallback = null;

/**
 * Initialise the sandbox in a given iframe element.
 *
 * @param {HTMLIFrameElement} iframe - The iframe to use
 * @param {function} onNavigate - Called when generated code requests navigation
 * @param {function} onViewQuery - Called when user clicks "View query" on a visual
 */
export function initSandbox(iframe, onNavigate, onViewQuery) {
  currentIframe = iframe;
  onNavigateCallback = onNavigate;
  onViewQueryCallback = onViewQuery;

  // Listen for messages from the iframe
  window.addEventListener('message', handleMessage);
}

/**
 * Render a dashboard page in the sandbox.
 *
 * @param {object} page - { id, html, queries }
 * @param {object} params - Parameters passed from navigation (e.g. {region: "Northeast"})
 */
export async function renderPage(page, params = {}) {
  if (!currentIframe) throw new Error('Sandbox not initialised.');

  currentPageId = page.id;
  currentParams = params;

  // Pre-execute all the page's declared queries, substituting params
  const queryResults = {};
  for (const [name, sql] of Object.entries(page.queries)) {
    try {
      // Replace {{param}} placeholders with actual values
      let resolvedSQL = sql;
      for (const [key, value] of Object.entries(params)) {
        resolvedSQL = resolvedSQL.replaceAll(`{{${key}}}`, escapeSQL(value));
      }
      queryResults[name] = await runQuery(resolvedSQL);
    } catch (err) {
      console.error(`Query "${name}" failed:`, err);
      queryResults[name] = { columns: [], rows: [], error: err.message };
    }
  }

  // Build the full HTML document for the iframe
  const fullHTML = buildIframeDocument(page.html, queryResults, params, Object.keys(page.queries));

  // Write to iframe using srcdoc
  currentIframe.srcdoc = fullHTML;
}

/**
 * Build a complete HTML document to inject into the iframe.
 * This includes the bridge API, Chart.js, and pre-fetched query data.
 */
function buildIframeDocument(userHTML, queryResults, params, queryNames = []) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #fafaf8;
      color: #1a1a18;
      font-size: 14px;
      line-height: 1.5;
      padding: 20px;
    }
  </style>
  <script>
    // ─── Quackboard bridge API ───
    // This is what generated code uses to interact with the app.
    window.quackboard = {
      // Pre-fetched query results (available immediately, no async needed)
      data: ${JSON.stringify(queryResults)},

      // Execute an ad-hoc SQL query (for filters, drill-downs, etc.)
      query: function(sql) {
        return new Promise(function(resolve, reject) {
          var id = 'q_' + Math.random().toString(36).substr(2, 9);
          window.__pendingQueries = window.__pendingQueries || {};
          window.__pendingQueries[id] = { resolve: resolve, reject: reject };
          window.parent.postMessage({
            type: 'quackboard_query',
            id: id,
            sql: sql
          }, '*');
        });
      },

      // Navigate to another page
      navigate: function(pageId, params) {
        window.parent.postMessage({
          type: 'quackboard_navigate',
          pageId: pageId,
          params: params || {}
        }, '*');
      },

      // Get current page parameters
      getParams: function() {
        return ${JSON.stringify(params)};
      }
    };

    // Handle query responses from the parent
    window.addEventListener('message', function(event) {
      if (event.data && event.data.type === 'quackboard_query_result') {
        var pending = window.__pendingQueries && window.__pendingQueries[event.data.id];
        if (pending) {
          if (event.data.error) {
            pending.reject(new Error(event.data.error));
          } else {
            pending.resolve(event.data.result);
          }
          delete window.__pendingQueries[event.data.id];
        }
      }
    });
  <\/script>
</head>
<body>
${userHTML}
<script>
(function() {
  var queryNames = ${JSON.stringify(queryNames)};
  if (!queryNames.length) return;

  var style = document.createElement('style');
  style.textContent =
    '.qb-hover-wrap { position: relative; }' +
    '.qb-view-query-btn {' +
    '  position: absolute; top: 8px; left: 8px; z-index: 9999;' +
    '  background: rgba(10,10,10,0.75); color: #fff;' +
    '  border: none; border-radius: 4px; padding: 4px 10px;' +
    '  font-size: 11px; font-family: system-ui, sans-serif;' +
    '  cursor: pointer; display: none; white-space: nowrap; line-height: 1.4;' +
    '}' +
    '.qb-view-query-btn:hover { background: rgba(0,0,0,0.92); }' +
    '.qb-hover-wrap:hover > .qb-view-query-btn { display: block; }';
  document.head.appendChild(style);

  // Collect all inline script text — queries are in a sibling <script> at the bottom,
  // not inside the visual card elements, so we scan script text directly.
  var scriptText = '';
  document.querySelectorAll('script').forEach(function(s) { scriptText += s.textContent + '\n'; });

  // For each query name, find the DOM element it is associated with by searching the
  // script text in the region between this query reference and the adjacent ones.
  function findElementForQuery(name) {
    var pattern = 'quackboard.data.' + name;
    var pos = scriptText.indexOf(pattern);
    if (pos === -1) return null;

    // Determine search bounds: end of previous query reference → start of next
    var prevEnd = 0;
    var nextStart = scriptText.length;
    for (var i = 0; i < queryNames.length; i++) {
      var other = queryNames[i];
      if (other === name) continue;
      var otherPattern = 'quackboard.data.' + other;
      var otherPos = scriptText.indexOf(otherPattern);
      if (otherPos === -1) continue;
      if (otherPos < pos && otherPos + otherPattern.length > prevEnd) {
        prevEnd = otherPos + otherPattern.length;
      }
      if (otherPos > pos && otherPos < nextStart) {
        nextStart = otherPos;
      }
    }

    // Search the bounded region (also look a bit before the query reference)
    var regionStart = Math.max(prevEnd, pos - 300);
    var region = scriptText.slice(regionStart, nextStart);

    var m = region.match(/getElementById\(['"]([^'"]+)['"]\)/);
    if (m && document.getElementById(m[1])) return document.getElementById(m[1]);

    m = region.match(/querySelector\(['"]#([^'"]+)['"]\)/);
    if (m) {
      var el = document.querySelector('#' + m[1]);
      if (el) return el;
    }

    return null;
  }

  // Walk up from a found element to the nearest visual card container.
  // Stop when the parent is <body> or is a grid/flex layout container.
  function findVisualContainer(el) {
    var current = el;
    while (current.parentElement && current.parentElement !== document.body) {
      var parentDisplay = window.getComputedStyle(current.parentElement).display;
      if (parentDisplay === 'grid' || parentDisplay === 'flex') {
        return current; // current is a direct child of the layout — the card itself
      }
      current = current.parentElement;
    }
    return current !== document.body ? current : el;
  }

  function attachButton(container, queryName, offset) {
    if (window.getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    container.classList.add('qb-hover-wrap');
    var btn = document.createElement('button');
    btn.className = 'qb-view-query-btn';
    btn.style.top = (8 + offset * 28) + 'px';
    btn.textContent = 'View query';
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      window.parent.postMessage({ type: 'quackboard_view_query', queryName: queryName }, '*');
    });
    container.appendChild(btn);
  }

  // Build container → [queryNames] map
  var containerMap = new Map();
  queryNames.forEach(function(name) {
    var el = findElementForQuery(name);
    if (!el) return;
    var container = findVisualContainer(el);
    if (!container || container === document.body) return;
    if (!containerMap.has(container)) containerMap.set(container, []);
    containerMap.get(container).push(name);
  });

  containerMap.forEach(function(names, container) {
    names.forEach(function(name, i) { attachButton(container, name, i); });
  });
})();
<\/script>
</body>
</html>`;
}

/**
 * Handle messages from the sandboxed iframe.
 */
async function handleMessage(event) {
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'quackboard_query') {
    // Execute a SQL query from the iframe and send the result back
    try {
      const result = await runQuery(msg.sql);
      currentIframe.contentWindow.postMessage({
        type: 'quackboard_query_result',
        id: msg.id,
        result: result,
      }, '*');
    } catch (err) {
      currentIframe.contentWindow.postMessage({
        type: 'quackboard_query_result',
        id: msg.id,
        error: err.message,
      }, '*');
    }
  } else if (msg.type === 'quackboard_navigate') {
    // Request to navigate to a different page
    if (onNavigateCallback) {
      onNavigateCallback(msg.pageId, msg.params || {});
    }
  } else if (msg.type === 'quackboard_view_query') {
    // User clicked "View query" on a visual
    if (onViewQueryCallback) {
      onViewQueryCallback(msg.queryName);
    }
  }
}

/**
 * Escape a value for safe SQL string interpolation.
 * In production you'd want parameterised queries, but for a
 * browser-only tool where users control their own data, this is fine.
 */
function escapeSQL(value) {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.replace(/'/g, "''");
  return String(value);
}

/**
 * Destroy the sandbox, cleaning up event listeners.
 */
export function destroySandbox() {
  window.removeEventListener('message', handleMessage);
  currentIframe = null;
}
