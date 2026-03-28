# Quackboard

An AI-powered dashboard builder that runs entirely in your browser. Upload your data, describe what you want, and get a live interactive dashboard backed by DuckDB SQL — no servers, no drag-and-drop grids, no data leaving your machine.

## What it does

1. Upload your data (CSV, Parquet, or JSON)
2. DuckDB-WASM loads it in the browser — nothing leaves your machine
3. Describe what you want in plain English
4. The AI generates a structured dashboard spec (queries + visuals + layout)
5. The app renders it deterministically — charts, tables, KPI cards, filters
6. Edit any SQL query per-visual, style each chart individually, or re-prompt to refine

## Prerequisites

### Node.js (v18 or higher)
- Download from https://nodejs.org (the LTS version)
- Verify: open a terminal and run `node --version`

### VS Code (recommended)
- https://code.visualstudio.com

## Setup

```bash
npm install
```

## Running

```bash
npm run dev
```

Open the URL shown (usually http://localhost:5173).

## API key

Click the **gear icon** in the top-right and paste your key.

- **Anthropic (Claude)** — https://console.anthropic.com
- **OpenAI** — https://platform.openai.com

Your key is stored in your browser only.

---

## Project structure

```
quackboard/
├── index.html
├── package.json
├── src/
│   ├── main.js                    App entry point
│   ├── app.js                     Shell — wires all components together
│   ├── engine/
│   │   ├── ai.js                  Prompt builder + LLM API calls + schema validation
│   │   ├── duckdb.js              DuckDB-WASM init, file loading, query execution
│   │   ├── sandbox.js             Iframe renderer — builds dashboard HTML from spec
│   │   └── project.js             Project state, save/load, navigation
│   ├── components/
│   │   ├── data-panel.js          Sidebar: file upload + table schema display
│   │   ├── prompt-bar.js          AI prompt input
│   │   ├── editor-panel.js        SQL query list + per-visual SQL drawer
│   │   ├── preview-panel.js       Live iframe preview with page tabs + filter bar
│   │   ├── filter-bar.js          Page-level filter controls (date, select, text, number)
│   │   ├── visual-editor-panel.js Per-visual style editor (color, type, legend, etc.)
│   │   ├── quick-edit-panel.js    Global theme editor (kept for reference)
│   │   └── settings-modal.js      API key + provider config
│   └── styles/
│       └── main.css               All styles
└── docs/
    └── ARCHITECTURE.md            Detailed technical reference
```

---

## How it works

### Dashboard spec

The AI generates a structured JSON spec — not free-form HTML. Every dashboard has:

```json
{
  "pages": [
    {
      "id": "overview",
      "title": "Overview",
      "queries": {
        "revenue_by_month": "SELECT month, SUM(revenue) AS revenue FROM sales GROUP BY month ORDER BY month",
        "total_revenue":    "SELECT SUM(revenue) AS total_revenue FROM sales"
      },
      "visuals": [
        { "id": "rev_chart",  "type": "bar",   "query": "revenue_by_month", "title": "Revenue by Month", "x": "month", "y": "revenue" },
        { "id": "total_kpi",  "type": "kpi",   "query": "total_revenue",    "title": "Total Revenue",    "value": "total_revenue", "format": "currency" }
      ],
      "layout": [
        { "id": "total_kpi",  "w": 4 },
        { "id": "rev_chart",  "w": 8 }
      ],
      "filters": [
        { "id": "region", "label": "Region", "type": "select", "optionsQuery": "SELECT DISTINCT region FROM sales ORDER BY 1", "default": "" }
      ]
    }
  ],
  "navigation": []
}
```

The app's renderer reads this spec and generates all chart, table, and KPI HTML deterministically. No user-authored JavaScript is injected.

### Visual types

| Type | Description | Required fields |
|------|-------------|----------------|
| `bar` | Bar chart | `x`, `y` |
| `line` | Line chart | `x`, `y` |
| `area` | Area chart | `x`, `y` |
| `pie` | Donut chart | `label`, `value` |
| `kpi` | Big metric card | `value` |
| `table` | Data table | — |

Optional on all: `color` (hex), `showLegend` (bool), `title`, `crossFilter` (bool).

KPI `format`: `"number"` / `"currency"` / `"percent"` / `"integer"`.

### Layout

Visuals are arranged on a 12-column grid. Each item in `layout` has:
- `id` — references a visual
- `w` — width in columns (1–12)

Items flow left-to-right, wrapping to the next row when they exceed 12. Typical sizes: KPI = 3–4, chart = 6–8, table = 12.

### Filters

Page-level filters render in a bar above the dashboard. Supported types:

- `select` — dropdown populated from an `optionsQuery`
- `date` — date picker
- `number` — numeric input
- `text` — free-text search

Filter values are passed as `{{filter_id}}` params into SQL queries. Unset filters default to empty string, which should match an "all rows" condition in the query:

```sql
-- select filter (empty = show all)
WHERE ('{{region}}' = '' OR region = '{{region}}')

-- number filter (empty = show all)
WHERE (TRY_CAST('{{week}}' AS INTEGER) IS NULL OR week = TRY_CAST('{{week}}' AS INTEGER))
```

### Cross-filtering

Any visual can be enabled as a filter source via the **Style** panel → **Use as filter** toggle. When active:

- A funnel badge appears on the card
- Clicking a bar, slice, or table row filters every other visual on the page that shares the same dimension column name
- Clicking the same point again clears the filter
- The source card gets an orange outline; filtered cards get a dashed outline

For cross-filtering to work across visuals, the shared dimension must be the same column name in all related queries.

### Per-visual editing

Hover any visual card to reveal two buttons:

- **Edit SQL** — opens a SQL drawer at the bottom of the preview. Edit and run the query directly; the visual updates instantly.
- **Style** — opens a panel on the right with controls for chart type, color, legend, card background, border radius, font size, and the cross-filter toggle. Changes apply live and persist to the spec.

### Bridge API

The iframe communicates with the app through `window.quackboard`:

```javascript
// Pre-fetched data (available immediately, no async needed)
const { columns, rows } = quackboard.data.my_query_name;

// Run an ad-hoc SQL query (for dynamic filters, search, drill-downs)
const result = await quackboard.query("SELECT region, SUM(revenue) FROM sales GROUP BY region");

// Navigate to another page
quackboard.navigate('detail', { product_id: 42 });

// Get current page parameters (from navigation)
const { product_id } = quackboard.getParams();
```

### Security

- The iframe runs with `sandbox="allow-scripts allow-modals"` — no DOM access to the parent, no localStorage, no network.
- All SQL executes in the parent via `postMessage` → DuckDB → results back.
- `data-qb-query` attributes on visual cards are how the app identifies which query backs each visual for SQL editing and cross-filtering.

---

## Editing & refinement

**Re-prompt**: type a follow-up like *"add a drill-down by region"* — the AI receives the current project JSON and patches it.

**SQL drawer**: click **Edit SQL** on any visual hover → edit the query → click **Run** to update that visual without touching anything else.

**Style panel**: click **Style** on any visual hover → adjust colors, chart type, legend, card background, border radius, font size.

**Query list**: the left panel lists all SQL queries for the current page. Click any query to open it in the SQL drawer.

---

## Troubleshooting

**"Failed to start DuckDB"**
→ Use Chrome or Edge. Firefox can have issues with WebAssembly threads.

**"Anthropic API error (401)"**
→ Invalid API key. Go to Settings and re-enter it.

**"Anthropic API error (429)"**
→ Rate limit hit. Wait a minute and retry.

**"AI returned invalid JSON"**
→ The response was cut off. Try a simpler prompt or ask for fewer visuals.

**Visual shows "Column not found"**
→ The AI generated a visual spec with a column name that doesn't match what the query returns. Click **Edit SQL** on that visual and check the column names, or re-prompt asking the AI to fix it.

**Visual shows "Query error"**
→ The SQL has an error. Click **Edit SQL** to see and fix it.

**"npm install" fails**
→ Run `node --version`. If it says "not found", install Node.js from https://nodejs.org.
