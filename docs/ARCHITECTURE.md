# Quackboard architecture

## How it all fits together

```
┌─────────────────────────────────────────────────────┐
│  Browser                                            │
│                                                     │
│  ┌───────────┐  ┌──────────────────────────────┐   │
│  │ Data      │  │ Main area                     │   │
│  │ panel     │  │                               │   │
│  │           │  │ ┌──────────────────────────┐  │   │
│  │ Upload    │  │ │ Prompt bar               │  │   │
│  │ files     │  │ └──────────────────────────┘  │   │
│  │           │  │                               │   │
│  │ View      │  │ ┌────────────┬─────────────┐  │   │
│  │ schemas   │  │ │ Code       │ Live         │  │   │
│  │           │  │ │ editor     │ preview      │  │   │
│  │           │  │ │ (Monaco)   │ (iframe)     │  │   │
│  │           │  │ │            │              │  │   │
│  └───────────┘  │ └────────────┴─────────────┘  │   │
│                 └──────────────────────────────┘   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ DuckDB-WASM (runs entirely in the browser)  │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Data flow

1. User drops a CSV/Parquet/JSON file onto the data panel.
2. `engine/duckdb.js` loads the file into DuckDB-WASM as a table.
3. The sidebar shows the table name, row count, and column types.
4. User types a prompt like "Show me monthly revenue with a drill-down by product."
5. `engine/ai.js` builds a system prompt that includes:
   - All loaded table schemas (column names, types, sample rows)
   - Instructions for generating a multi-page HTML dashboard
   - The output contract (JSON with pages, queries, and HTML)
6. The AI responds with a JSON project containing one or more pages.
7. `engine/project.js` stores the project and notifies all components.
8. `engine/sandbox.js` renders the first page in the preview iframe:
   - Pre-executes all declared SQL queries via DuckDB
   - Injects the results + a bridge API into the iframe
   - The bridge lets generated JS run ad-hoc queries (for filters, etc.)
9. `components/editor-panel.js` loads the page's HTML and SQL into CodeMirror.
10. User can edit code → changes are debounced → preview refreshes live.
11. User can re-prompt → AI receives the existing project + new instruction → patches it.

## The bridge API

Generated code inside the iframe communicates with the main app
through `window.quackboard`:

```javascript
// Pre-fetched data (available immediately)
const { columns, rows } = quackboard.data.my_query_name;

// Run an ad-hoc query (for dynamic filters)
const result = await quackboard.query("SELECT * FROM sales WHERE region = 'West'");
// result = { columns: ['id', 'amount', ...], rows: [[1, 500, ...], ...] }

// Navigate to another page
quackboard.navigate('product_detail', { product_id: 42 });

// Get current page parameters
const params = quackboard.getParams();
// params = { product_id: 42 }
```

## Multi-page model

A "dashboard project" is a JSON object:

```json
{
  "pages": [
    {
      "id": "overview",
      "title": "Sales overview",
      "queries": {
        "monthly_revenue": "SELECT month, SUM(amount) as revenue FROM sales GROUP BY month",
        "top_products": "SELECT product, SUM(amount) as total FROM sales GROUP BY product ORDER BY total DESC LIMIT 10"
      },
      "html": "<style>...</style><div>...</div><script>...</script>",
      "description": "High-level KPIs and monthly trend"
    },
    {
      "id": "product_detail",
      "title": "Product detail",
      "queries": {
        "product_sales": "SELECT * FROM sales WHERE product_id = {{product_id}}"
      },
      "html": "...",
      "description": "Deep dive into a specific product"
    }
  ],
  "navigation": [
    {
      "from": "overview",
      "to": "product_detail",
      "trigger": "Click a row in the top products table",
      "params": ["product_id"]
    }
  ]
}
```

Pages are rendered one at a time. Navigation swaps the active page
in the iframe and re-executes that page's queries with the provided params.

## Security model

- Generated HTML runs in an iframe with `sandbox="allow-scripts allow-modals"`.
- The iframe has NO access to the parent window's DOM, localStorage, or DuckDB.
- All SQL queries go through `postMessage` → the parent executes them → sends results back.
- There is no network access from the iframe (no `allow-same-origin`).

## File structure

```
src/
├── main.js              Entry point, imports CSS, boots app
├── app.js               Shell layout, wires components together
├── engine/
│   ├── duckdb.js        DuckDB-WASM init, file loading, query execution
│   ├── ai.js            Prompt construction + LLM API calls
│   ├── sandbox.js       Iframe rendering + postMessage bridge
│   └── project.js       State management, save/load, navigation
├── components/
│   ├── data-panel.js    Sidebar: file upload, table schema display
│   ├── prompt-bar.js    Text input for AI prompts
│   ├── editor-panel.js  CodeMirror 6 editor with HTML/SQL tabs
│   ├── preview-panel.js Iframe preview with page tabs
│   └── settings-modal.js API key + provider configuration
└── styles/
    └── main.css         All styles (design tokens, layout, components)
```
