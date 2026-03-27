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
let onSelectVisualCallback = null;
let currentThemeCSS = '';
// queryName → overrides object, persisted across renders
let visualOverrides = {};

/**
 * Initialise the sandbox in a given iframe element.
 *
 * @param {HTMLIFrameElement} iframe - The iframe to use
 * @param {function} onNavigate - Called when generated code requests navigation
 * @param {function} onViewQuery - Called when user clicks "View query" on a visual
 */
export function initSandbox(iframe, onNavigate, onViewQuery, onSelectVisual) {
  currentIframe = iframe;
  onNavigateCallback = onNavigate;
  onViewQueryCallback = onViewQuery;
  onSelectVisualCallback = onSelectVisual;

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
  <style id="qb-theme">${currentThemeCSS}</style>
  <script>
    // ─── Quackboard bridge API ───
    // This is what generated code uses to interact with the app.
    // Raw unproxied results — used by the error/empty-state overlay below.
    window.__qbRawData = ${JSON.stringify(queryResults)};
    // Per-visual style overrides — applied after user scripts run.
    window.__qbVisualOverrides = ${JSON.stringify(visualOverrides)};

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

    // ─── Inline error/empty-state overlay ───────────────────────────
    // After the page scripts run, scan every [data-qb-query] card.
    // If its query failed or returned no rows, show a visible message
    // directly on the card so users never see a mysteriously blank visual.
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() {
        var data = window.__qbRawData;
        if (!data) return;

        // Styles for the overlay banner
        var s = document.createElement('style');
        s.textContent =
          '.qb-state-banner{' +
          '  position:absolute;inset:0;display:flex;flex-direction:column;' +
          '  align-items:center;justify-content:center;gap:6px;' +
          '  background:rgba(250,250,248,0.92);border-radius:inherit;' +
          '  z-index:8000;pointer-events:none;padding:16px;text-align:center;' +
          '}' +
          '.qb-state-banner svg{opacity:0.35;}' +
          '.qb-state-banner .qb-state-title{font-size:13px;font-weight:500;color:#6b6a65;}' +
          '.qb-state-banner .qb-state-detail{font-size:11px;color:#9c9a92;font-family:monospace;' +
          '  max-width:260px;word-break:break-all;}';
        document.head.appendChild(s);

        document.querySelectorAll('[data-qb-query]').forEach(function(card) {
          var qName = card.getAttribute('data-qb-query');
          var result = data[qName];
          if (!result) return; // query name mismatch — leave it alone

          var title, detail, icon;

          if (result.error) {
            title  = 'Query error';
            detail = result.error;
            icon   = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e24b4a" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
          } else if (!result.rows || result.rows.length === 0) {
            title  = 'No data';
            detail = 'This query returned 0 rows.';
            icon   = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9c9a92" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';
          } else {
            return; // data is fine
          }

          // Card needs relative positioning for the overlay to anchor to
          if (window.getComputedStyle(card).position === 'static') {
            card.style.position = 'relative';
          }

          var overlay = document.createElement('div');
          overlay.className = 'qb-state-banner';
          overlay.innerHTML =
            icon +
            '<span class="qb-state-title">' + title + '</span>' +
            '<span class="qb-state-detail">' + detail + '</span>';
          card.appendChild(overlay);
        });
      }, 0);
    });

    // Handle messages from the parent (query results + live theme updates)
    window.addEventListener('message', function(event) {
      if (!event.data) return;
      if (event.data.type === 'quackboard_query_result') {
        var pending = window.__pendingQueries && window.__pendingQueries[event.data.id];
        if (pending) {
          if (event.data.error) {
            pending.reject(new Error(event.data.error));
          } else {
            pending.resolve(event.data.result);
          }
          delete window.__pendingQueries[event.data.id];
        }
      } else if (event.data.type === 'quackboard_update_theme') {
        var themeEl = document.getElementById('qb-theme');
        if (themeEl) themeEl.textContent = event.data.css || '';
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

  // ── Styles ───────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent =
    '.qb-wrap { position: relative !important; }' +
    '.qb-edit-btn {' +
    '  position: absolute !important; top: 8px !important; right: 8px !important;' +
    '  z-index: 9999 !important;' +
    '  background: rgba(10,10,10,0.78) !important; color: #fff !important;' +
    '  border: none !important; border-radius: 4px !important;' +
    '  padding: 4px 10px !important;' +
    '  font-size: 11px !important; font-family: system-ui, sans-serif !important;' +
    '  cursor: pointer !important; white-space: nowrap !important;' +
    '  line-height: 1.4 !important;' +
    '  opacity: 0 !important; transition: opacity 0.15s !important;' +
    '  pointer-events: none !important;' +
    '}' +
    '.qb-edit-btn:hover { background: rgba(0,0,0,0.95) !important; }' +
    '.qb-wrap:hover .qb-edit-btn { opacity: 1 !important; pointer-events: auto !important; }' +
    '.qb-style-btn {' +
    '  position: absolute !important; top: 8px !important; right: 80px !important;' +
    '  z-index: 9999 !important;' +
    '  background: rgba(10,10,10,0.78) !important; color: #fff !important;' +
    '  border: none !important; border-radius: 4px !important;' +
    '  padding: 4px 10px !important;' +
    '  font-size: 11px !important; font-family: system-ui, sans-serif !important;' +
    '  cursor: pointer !important; white-space: nowrap !important;' +
    '  line-height: 1.4 !important;' +
    '  opacity: 0 !important; transition: opacity 0.15s !important;' +
    '  pointer-events: none !important;' +
    '}' +
    '.qb-style-btn:hover { background: rgba(232,93,36,0.9) !important; }' +
    '.qb-wrap:hover .qb-style-btn { opacity: 1 !important; pointer-events: auto !important; }' +
    '.qb-selected { outline: 2px solid #e85d24 !important; outline-offset: 2px !important; }';
  document.head.appendChild(style);

  // ── Fallback tracking: double-Proxy + Chart constructor wrap ──
  // Used only when data-qb-query attributes are absent (old dashboards).
  //
  // The outer Proxy records which query is accessed; the inner Proxy
  // on the returned result object re-fires _lastQuery every time .rows
  // or .columns is accessed — even when data was stored in a variable
  // before the Chart() call.
  var _lastQuery = null;
  var _chartQueryMap = new Map();  // canvas → queryName
  var _origData = window.quackboard.data;

  try {
    window.quackboard.data = new Proxy(_origData, {
      get: function(outerTarget, outerProp) {
        var s = String(outerProp);
        if (queryNames.indexOf(s) !== -1) {
          _lastQuery = s;
          var resultObj = outerTarget[s];
          // Wrap the result so accessing .rows/.columns refreshes _lastQuery
          try {
            return new Proxy(resultObj, {
              get: function(innerTarget, innerProp) {
                _lastQuery = s;
                return innerTarget[innerProp];
              }
            });
          } catch(e) { return resultObj; }
        }
        return outerTarget[outerProp];
      }
    });
  } catch(e) {
    // Proxy not available — will rely entirely on data-qb-query attributes
  }

  // Wrap Chart constructor: at the moment new Chart(canvas, config) is called,
  // _lastQuery reflects whichever query's .rows/.columns was most recently touched
  // (because the config object is constructed inline, triggering the inner Proxy).
  var _OrigChart = window.Chart;
  if (_OrigChart) {
    window.Chart = function(el, config) {
      var canvas = (el instanceof HTMLCanvasElement) ? el
        : (el instanceof Element && el.tagName === 'CANVAS') ? el
        : (typeof el === 'string') ? (document.getElementById(el) || document.querySelector(el))
        : null;
      if (canvas && _lastQuery) {
        _chartQueryMap.set(canvas, _lastQuery);
        _lastQuery = null;
      }
      return new _OrigChart(el, config);
    };
    window.Chart.prototype = _OrigChart.prototype;
    try {
      Object.keys(_OrigChart).forEach(function(k) { window.Chart[k] = _OrigChart[k]; });
    } catch(e) {}
  }

  // ── Helpers ───────────────────────────────────────────────────
  function findCard(el) {
    var current = el;
    while (current.parentElement && current.parentElement !== document.body) {
      var p = current.parentElement;
      var d = window.getComputedStyle(p).display;
      if (d === 'grid' || d === 'flex' || d === 'inline-flex' || d === 'inline-grid') {
        return current;
      }
      current = p;
    }
    return (el.parentElement && el.parentElement !== document.body) ? el.parentElement : el;
  }

  function attachBtn(card, queryName) {
    if (!card || card === document.body || card.__qbDone) return;
    card.__qbDone = true;
    if (window.getComputedStyle(card).position === 'static') {
      card.style.setProperty('position', 'relative', 'important');
    }
    card.classList.add('qb-wrap');
    var btn = document.createElement('button');
    btn.className = 'qb-edit-btn';
    btn.textContent = 'Edit SQL';
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      window.parent.postMessage({ type: 'quackboard_view_query', queryName: queryName }, '*');
    });
    card.appendChild(btn);
  }

  // ── Attach buttons ────────────────────────────────────────────
  setTimeout(function() {
    var matched = new Set(); // query names already matched

    // ── Path A: explicit data-qb-query attributes (always correct) ──
    // The AI is instructed to add data-qb-query="query_name" to every
    // visual card. When present, this is the ground truth.
    document.querySelectorAll('[data-qb-query]').forEach(function(el) {
      var q = el.getAttribute('data-qb-query');
      if (queryNames.indexOf(q) !== -1) {
        attachBtn(el, q);
        matched.add(q);
      }
    });

    if (matched.size === queryNames.length) return; // all matched — done

    // ── Path B: Chart constructor interception (for charts) ──────
    // Catches charts that don't have data-qb-query (old dashboards).
    _chartQueryMap.forEach(function(queryName, canvas) {
      if (matched.has(queryName)) return;
      var card = findCard(canvas);
      attachBtn(card, queryName);
      matched.add(queryName);
    });

    if (matched.size === queryNames.length) return;

    // ── Path C: scan canvas/table elements, positional fallback ──
    // For any still-unmatched queries, scan the DOM for visual
    // elements and pair them up positionally.
    var unmatchedQueries = queryNames.filter(function(q) { return !matched.has(q); });
    var seenCards = new Set();
    var candidateCards = [];

    // Collect unmapped canvas cards
    document.querySelectorAll('canvas').forEach(function(el) {
      if (_chartQueryMap.has(el)) return; // already handled in Path B
      var card = findCard(el);
      if (card && card !== document.body && !card.__qbDone && !seenCards.has(card)) {
        seenCards.add(card);
        candidateCards.push(card);
      }
    });

    // Collect unmapped table cards
    document.querySelectorAll('table').forEach(function(el) {
      var card = findCard(el);
      if (card && card !== document.body && !card.__qbDone && !seenCards.has(card)) {
        seenCards.add(card);
        candidateCards.push(card);
      }
    });

    // Positional match: unmatched query N → candidate card N
    unmatchedQueries.forEach(function(q, i) {
      if (candidateCards[i]) attachBtn(candidateCards[i], q);
    });

    // ── Add "Style" button and selection to every [data-qb-query] card ──
    document.querySelectorAll('[data-qb-query]').forEach(function(card) {
      if (card.__qbStyleBtn) return;
      card.__qbStyleBtn = true;

      // "Style" button (sits next to "Edit SQL")
      var styleBtn = document.createElement('button');
      styleBtn.className = 'qb-style-btn';
      styleBtn.textContent = 'Style';
      if (window.getComputedStyle(card).position === 'static') {
        card.style.setProperty('position', 'relative', 'important');
      }
      card.appendChild(styleBtn);

      styleBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var queryName = card.getAttribute('data-qb-query');
        var canvas = card.querySelector('canvas');
        var table  = card.querySelector('table');

        var info = { queryName: queryName, type: 'kpi' };

        if (canvas) {
          info.type = 'chart';
          var chart = window.Chart && window.Chart.getChart && window.Chart.getChart(canvas);
          if (chart) {
            var ds0 = chart.data.datasets && chart.data.datasets[0];
            var rawColor = ds0 ? (ds0.borderColor || ds0.backgroundColor) : null;
            // Normalise to a hex string if possible
            info.chartType = chart.config.type === 'line' && ds0 && ds0.fill ? 'area' : chart.config.type;
            info.currentColor = typeof rawColor === 'string' && rawColor.match(/^#[0-9a-f]{6}/i)
              ? rawColor : '#e85d24';
            info.hasLegend = !!(chart.options.plugins && chart.options.plugins.legend
              && chart.options.plugins.legend.display !== false);
            info.hasMultipleDatasets = chart.data.datasets.length > 1;
          }
        } else if (table) {
          info.type = 'table';
        }

        // Current card styles
        var cs = window.getComputedStyle(card);
        info.currentBg     = rgbToHex(cs.backgroundColor) || '#ffffff';
        info.currentRadius = parseInt(cs.borderRadius) || 12;

        // Highlight selected card
        document.querySelectorAll('.qb-selected').forEach(function(el) { el.classList.remove('qb-selected'); });
        card.classList.add('qb-selected');

        window.parent.postMessage({ type: 'quackboard_select_visual', info: info }, '*');
      });
    });

    // Deselect on outside click
    document.addEventListener('click', function(e) {
      if (!e.target.closest('[data-qb-query]')) {
        document.querySelectorAll('.qb-selected').forEach(function(el) { el.classList.remove('qb-selected'); });
        window.parent.postMessage({ type: 'quackboard_deselect_visual' }, '*');
      }
    });

  }, 0);

  // ── Apply stored overrides on page load ──────────────────────
  // Wait longer than the Edit SQL scan so charts are definitely rendered.
  setTimeout(function() {
    var overrides = window.__qbVisualOverrides;
    if (!overrides) return;
    Object.keys(overrides).forEach(function(queryName) {
      applyVisualOverride(queryName, overrides[queryName]);
    });
  }, 150);

  // ── Handle apply-override messages from parent ───────────────
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'quackboard_apply_visual_override') {
      applyVisualOverride(e.data.queryName, e.data.overrides);
    }
  });

  // ── Core apply function ──────────────────────────────────────
  function applyVisualOverride(queryName, overrides) {
    if (!overrides) return;
    var card = document.querySelector('[data-qb-query="' + queryName + '"]');
    if (!card) return;

    if (overrides._reset) {
      card.style.cssText = '';
      var canvas = card.querySelector('canvas');
      // Can't easily reset Chart.js colors without a re-render; skip for now
      return;
    }

    // Card-level CSS
    if (overrides.background)   card.style.setProperty('background', overrides.background, 'important');
    if (overrides.borderRadius !== undefined)
      card.style.setProperty('border-radius', overrides.borderRadius + 'px', 'important');
    if (overrides.fontSize !== undefined)
      card.style.setProperty('font-size', overrides.fontSize + 'px', 'important');

    // Table-specific
    if (overrides.striped !== undefined) {
      var table = card.querySelector('table');
      if (table) {
        if (overrides.striped) {
          var stripStyle = document.getElementById('qb-strip-style') || document.createElement('style');
          stripStyle.id = 'qb-strip-style';
          stripStyle.textContent = 'tr:nth-child(even){background:rgba(0,0,0,0.03)!important}';
          document.head.appendChild(stripStyle);
        } else {
          var el = document.getElementById('qb-strip-style');
          if (el) el.remove();
        }
      }
    }
    if (overrides.compact !== undefined) {
      var tbl = card.querySelector('table');
      if (tbl) {
        tbl.querySelectorAll('td,th').forEach(function(cell) {
          cell.style.setProperty('padding', overrides.compact ? '4px 8px' : '', 'important');
        });
      }
    }

    // Chart-specific — use Chart.js API directly
    var canvas = card.querySelector('canvas');
    if (canvas && window.Chart && window.Chart.getChart) {
      var chart = window.Chart.getChart(canvas);
      if (chart) {
        if (overrides.chartColor) {
          var color = overrides.chartColor;
          var isBar = (overrides.chartType || chart.config.type) === 'bar';
          var isArea = overrides.chartType === 'area';
          chart.data.datasets.forEach(function(ds) {
            ds.borderColor = color;
            ds.backgroundColor = isBar ? hexToRgba(color, 0.7)
                                : isArea ? hexToRgba(color, 0.15)
                                : color;
            if (isArea) ds.fill = true;
          });
        }

        if (overrides.chartType) {
          var newType = overrides.chartType === 'area' ? 'line' : overrides.chartType;
          chart.config.type = newType;
          chart.data.datasets.forEach(function(ds) {
            ds.fill = overrides.chartType === 'area';
          });
        }

        if (overrides.showLegend !== undefined) {
          chart.options.plugins = chart.options.plugins || {};
          chart.options.plugins.legend = chart.options.plugins.legend || {};
          chart.options.plugins.legend.display = overrides.showLegend;
        }

        chart.update('none');
      }
    }
  }

  function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function rgbToHex(rgb) {
    var m = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!m) return null;
    return '#' + [m[1], m[2], m[3]].map(function(x) {
      return ('0' + parseInt(x).toString(16)).slice(-2);
    }).join('');
  }

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
  } else if (msg.type === 'quackboard_select_visual') {
    if (onSelectVisualCallback) {
      onSelectVisualCallback(msg.info);
    }
  } else if (msg.type === 'quackboard_deselect_visual') {
    if (onSelectVisualCallback) {
      onSelectVisualCallback(null);
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
 * Set the theme CSS that gets injected into every rendered page.
 * Call this before renderPage to have it take effect on next render.
 *
 * @param {string} css
 */
export function setRenderTheme(css) {
  currentThemeCSS = css || '';
}

/**
 * Push a theme CSS update into the live iframe without re-rendering.
 * Instant — no flash.
 *
 * @param {string} css
 */
export function injectThemeToIframe(css) {
  currentThemeCSS = css || '';
  if (!currentIframe?.contentWindow) return;
  currentIframe.contentWindow.postMessage({
    type: 'quackboard_update_theme',
    css: currentThemeCSS,
  }, '*');
}

/**
 * Store a visual override and push it live into the iframe.
 *
 * @param {string} queryName
 * @param {object} overrides
 */
export function setVisualOverride(queryName, overrides) {
  if (overrides._reset) {
    delete visualOverrides[queryName];
  } else {
    visualOverrides[queryName] = { ...(visualOverrides[queryName] || {}), ...overrides };
  }
}

/**
 * Push the current override for one visual into the live iframe.
 *
 * @param {string} queryName
 * @param {object} overrides
 */
export function applyVisualOverridesToIframe(queryName, overrides) {
  if (!currentIframe?.contentWindow) return;
  currentIframe.contentWindow.postMessage({
    type: 'quackboard_apply_visual_override',
    queryName,
    overrides,
  }, '*');
}

/**
 * Clear all visual overrides (called when a new project is loaded).
 */
export function clearVisualOverrides() {
  visualOverrides = {};
}

/**
 * Destroy the sandbox, cleaning up event listeners.
 */
export function destroySandbox() {
  window.removeEventListener('message', handleMessage);
  currentIframe = null;
}
