# Quackboard — Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│                                                                 │
│  ┌────────────┐  ┌──────────────────────────────────────────┐  │
│  │ Data panel │  │ Main area                                │  │
│  │            │  │                                          │  │
│  │ Upload     │  │ ┌──────────────────────────────────────┐ │  │
│  │ CSV/JSON/  │  │ │ Prompt bar (AI generation/refinement)│ │  │
│  │ Parquet    │  │ └──────────────────────────────────────┘ │  │
│  │            │  │                                          │  │
│  │ View table │  │ ┌─────────────┬────────────────────────┐ │  │
│  │ schemas    │  │ │ SQL query   │  Preview (iframe)      │ │  │
│  │            │  │ │ list panel  │                        │ │  │
│  │            │  │ │             │  ┌──────────────────┐  │ │  │
│  │            │  │ │ Click any   │  │ Filter bar       │  │ │  │
│  │            │  │ │ query →     │  ├──────────────────┤  │ │  │
│  │            │  │ │ SQL drawer  │  │ Dashboard grid   │  │ │  │
│  │            │  │ │             │  │ (12-col CSS grid)│  │ │  │
│  │            │  │ │             │  │                  │  │ │  │
│  └────────────┘  │ └─────────────┤  └──────────────────┘  │ │  │
│                  │               │  Visual editor panel → │ │  │
│                  │               └────────────────────────┘ │  │
│                  └──────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  DuckDB-WASM (WebWorker — all data stays in browser)     │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core design principle: spec-driven rendering

The AI does **not** generate HTML or JavaScript. It generates a **structured spec**:

```
queries   →  SQL strings (DuckDB handles all aggregation)
visuals   →  { type, query, column bindings, title, color }
layout    →  { visual_id, w: 1–12 } (12-column grid)
filters   →  { id, type, optionsQuery, default }
```

The app's renderer (`sandbox.js`) reads the spec and builds the complete iframe document deterministically. This means:

- Every visual is fully understood by the app (type, column mappings, query)
- Editing is reliable — no reverse-engineering of AI-generated code
- Cross-filtering is precise — the app knows which column each visual uses
- Style overrides persist correctly — they map to spec fields the renderer uses

---

## Data flow

```
User prompt
    │
    ▼
engine/ai.js
  buildSystemPrompt(schemaContext, relationships)
    │  includes: table schemas, sample rows, join hints
    ▼
  LLM API (Anthropic / OpenAI)
    │  returns: JSON spec { pages, navigation }
    ▼
  validateProject(project)
    │  checks: visuals exist, layout valid, queries non-empty,
    │          column fields present, filter types valid
    ▼
engine/project.js  setProject(project)
    │  saves to localStorage, notifies subscribers
    ▼
app.js  handleStateChange(state)
    │  pre-seeds filter defaults, calls renderProject
    ▼
components/preview-panel.js  renderProject(project, pageIndex, params)
    │
    ▼
engine/sandbox.js  renderPage(page, params)
  1. Run page queries sequentially against DuckDB
     (sequential to avoid single-connection contention)
  2. Replace {{param}} placeholders with escaped values
  3. Build iframe document from spec + results
    │
    ▼
  buildIframeDocument(page, queryResults, params, resolvedQueries)
    │  generates: CSS grid, visual card HTML, Chart.js init scripts
    │  injects:   bridge API, raw data, visual overrides, page spec
    ▼
  iframe.srcdoc = fullHTML
```

---

## Dashboard spec schema

```typescript
interface Project {
  pages:      Page[];
  navigation: NavLink[];
}

interface Page {
  id:          string;
  title:       string;
  description: string;
  queries:     Record<string, string>;   // name → SQL
  visuals:     Visual[];
  layout:      LayoutItem[];
  filters?:    Filter[];
}

interface Visual {
  id:           string;
  type:         'bar' | 'line' | 'area' | 'pie' | 'kpi' | 'table';
  query:        string;           // key in page.queries
  title?:       string;
  // bar/line/area
  x?:           string;           // x-axis column
  y?:           string | string[];// y-axis column(s)
  // pie
  label?:       string;           // slice label column
  value?:       string;           // slice value column (also kpi)
  // kpi
  format?:      'number' | 'currency' | 'percent' | 'integer';
  // table
  columns?:     string[];         // subset of columns to display
  // styling (also controlled via visual editor)
  color?:       string;
  showLegend?:  boolean;
  crossFilter?: boolean;
}

interface LayoutItem {
  id: string;   // references Visual.id
  w:  number;   // 1–12 column width
}

interface Filter {
  id:            string;
  label:         string;
  type:          'select' | 'date' | 'number' | 'text';
  default:       string;
  optionsQuery?: string;   // required for type: 'select'
}
```

---

## Iframe document structure

```html
<!DOCTYPE html>
<html>
<head>
  <script src="Chart.js CDN"></script>
  <style>/* grid, cards, tables, KPIs, error states */</style>
  <style id="qb-theme">/* theme overrides injected by parent */</style>
  <script>
    window.__qbRawData        = { queryName: { columns, rows } };
    window.__qbVisualOverrides= { visualId: { chartColor, ... } };
    window.__qbOriginalSQL    = { queryName: 'SELECT ...' };
    window.__qbPageSpec       = { visuals, layout };
    window.__qbCrossFilters   = {};
    window.__qbCharts         = {};  // visualId → Chart instance (set by init scripts)

    window.quackboard = { data, query(), navigate(), getParams() };

    // Message handlers: query_result, update_theme, apply_cross_filter,
    //                   apply_visual_override
  </script>
</head>
<body>
  <div class="dashboard-grid">
    <!-- Visual cards (static HTML rendered by app) -->
    <div class="visual-card" data-visual-id="rev_chart" data-qb-query="revenue_by_month"
         style="grid-column: span 8">
      <div class="visual-header"><span class="visual-title">Revenue by Month</span></div>
      <div class="visual-body"><canvas id="chart-rev_chart"></canvas></div>
    </div>
    <!-- more cards ... -->
  </div>
  <script>
  (function() {
    // Chart.js init IIFEs (one per chart/pie visual)
    // Each wrapped in try-catch — errors show in card, can't cascade
    (function() {
      try {
        var canvas = document.getElementById('chart-rev_chart');
        var d = window.__qbRawData['revenue_by_month'];
        var xIdx = d.columns.indexOf('month');
        window.__qbCharts['rev_chart'] = new Chart(canvas, { ... });
        // cross-filter click handler if visual.crossFilter is true
      } catch(err) { /* show error in card */ }
    }());

    // Edit SQL + Style button injection (runs in setTimeout to let charts init first)
    // Table cross-filter click handlers
    // window.__qbApplyCrossFilters — updates all non-source visuals on filter change
    // window.__qbApplyOverride — applies live style overrides (color, type, etc.)
  }());
  </script>
</body>
</html>
```

---

## postMessage protocol

| Direction | Type | Payload | Description |
|-----------|------|---------|-------------|
| iframe → parent | `quackboard_query` | `{ id, sql }` | Execute SQL in DuckDB |
| parent → iframe | `quackboard_query_result` | `{ id, result?, error? }` | Query result |
| iframe → parent | `quackboard_navigate` | `{ pageId, params }` | Navigate to page |
| iframe → parent | `quackboard_view_query` | `{ queryName }` | Open SQL drawer |
| iframe → parent | `quackboard_select_visual` | `{ info }` | Open visual editor |
| iframe → parent | `quackboard_deselect_visual` | — | Close visual editor |
| iframe → parent | `quackboard_cross_filter` | `{ queryName, column, value }` | Toggle cross-filter |
| parent → iframe | `quackboard_apply_cross_filter` | `{ filters }` | Apply/clear cross-filters |
| parent → iframe | `quackboard_apply_visual_override` | `{ visualId, overrides }` | Live style update |
| parent → iframe | `quackboard_update_theme` | `{ css }` | Inject global CSS |

---

## Visual overrides

Overrides let the visual editor apply style changes instantly without re-rendering the page. They live in `sandbox.js` module state (`visualOverrides`) keyed by `visualId`.

On render, overrides are baked into the card's `style` attribute and chart init config. When the user changes a style in the editor:

1. `applyVisualOverridesToIframe(visualId, overrides)` — live update via postMessage
2. `setVisualOverride(visualId, overrides)` — stored in module state for next render
3. `updateVisual(pageId, visualId, changes)` — spec fields updated (color, type, legend) so changes survive page navigation
4. Persisted to `localStorage` under `quackboard_overrides`

---

## Cross-filtering

```
User clicks bar in "rev_chart" (crossFilter: true)
    │
    ▼ iframe sends quackboard_cross_filter { queryName: 'rev_chart', column: 'month', value: '2024-03' }
    │
    ▼ sandbox.js handleMessage
      activeCrossFilters['month'] = { queryName: 'rev_chart', value: '2024-03' }
      postMessage quackboard_apply_cross_filter { filters: activeCrossFilters }
    │
    ▼ iframe __qbApplyCrossFilters(filters)
      for each non-source visual:
        if visual's query result has 'month' column:
          SELECT * FROM (<original_sql>) __qb_cf WHERE "month" = '2024-03'
          update Chart.js instance via __qbCharts[visualId]
          or rebuild table tbody rows
```

Clicking the same bar again removes that column from `activeCrossFilters` and restores original data from `window.__qbRawData`.

Cross-filtering requires consistent column names across related queries — the app matches on column name, not position.

---

## Filter bar

Page-level filters live in `components/filter-bar.js`. On page load:

1. `renderFilters(page.filters, onchange)` renders the filter controls
2. `select` filters run their `optionsQuery` against DuckDB to populate options
3. Filter options load **after** the page renders (to avoid DuckDB contention)
4. On any filter change, `handleFilterChange(values)` merges values into params and calls `renderProject` to re-render the page with new SQL substitutions

---

## Security model

- Iframe sandbox: `allow-scripts allow-modals` only — no DOM access to parent, no `localStorage`, no network fetch
- All DuckDB access goes through `postMessage` → parent executes → returns results
- SQL values are escaped via `escapeSQL()` before substitution
- AI-generated SQL never runs in the parent context directly (only via `runQuery` which validates the connection)

---

## File reference

```
src/
├── main.js                  Entry point — imports CSS, calls initApp()
├── app.js                   Shell — mounts all components, handles state changes,
│                            wires prompt → generation → render → edit cycle
├── engine/
│   ├── ai.js                buildSystemPrompt, generateDashboard, validateProject
│   │                        Calls Anthropic/OpenAI API, parses + validates JSON response
│   ├── duckdb.js            initDuckDB, loadFile, runQuery, getSchemaContext,
│   │                        detectRelationships, normalizeValue (Arrow → JS primitives)
│   ├── sandbox.js           renderPage, buildIframeDocument, all renderer helpers
│   │                        (buildChartJS, buildPieJS, buildTableHTML, buildKPIHTML)
│   │                        postMessage bridge, visual overrides, cross-filter state
│   └── project.js           Project state machine — setProject, navigateToPage,
│                            updatePageQueries, updateVisual, loadFromStorage,
│                            exportProject, localStorage persistence
└── components/
    ├── data-panel.js         File drag-and-drop → loadFile → schema display
    ├── prompt-bar.js         Text input, generating spinner
    ├── editor-panel.js       SQL query list (left panel) + SQL drawer (slide-up,
    │                         CodeMirror 6 editor)
    ├── preview-panel.js      Toolbar, page tabs, filter bar slot, iframe
    ├── filter-bar.js         Renders filter controls, runs optionsQuery for selects,
    │                         fires onchange with current filter values
    ├── visual-editor-panel.js Style panel (slide-in from right) with Interactions,
    │                         Chart, Table, and Card sections
    ├── quick-edit-panel.js   Global CSS theme injector (kept, not currently surfaced)
    └── settings-modal.js     Provider + API key + model selection
```
