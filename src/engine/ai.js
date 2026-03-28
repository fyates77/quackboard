/**
 * AI generation engine.
 *
 * Takes a user prompt + DuckDB schema context, calls an LLM API,
 * and returns a structured dashboard project (pages with HTML + SQL).
 */

import { getSchemaContext, detectRelationships } from './duckdb.js';

/**
 * Build the system prompt that teaches the AI how to generate dashboards.
 */
function buildSystemPrompt(schemaContext, relationships = []) {
  const schemaBlock = schemaContext.map(table => {
    const cols = table.columns.map(c => `    ${c.name} (${c.type})`).join('\n');
    const samples = table.sampleRows.length > 0
      ? '\n  Sample data:\n' + table.sampleRows.map(r => '    ' + JSON.stringify(r)).join('\n')
      : '';
    return `  Table: "${table.tableName}" (${table.rowCount.toLocaleString()} rows)\n  Columns:\n${cols}${samples}`;
  }).join('\n\n');

  const relationshipsBlock = relationships.length > 0
    ? `\n## Possible joins (shared column names across tables)\n` +
      relationships.map(r => `  "${r.table1}".${r.column} ↔ "${r.table2}".${r.column}`).join('\n')
    : '';

  return `You are a dashboard generation engine. You produce interactive HTML dashboards backed by DuckDB SQL queries.

## Available data
${schemaBlock || '  No tables loaded yet.'}${relationshipsBlock}

## Output format
Respond with ONLY a JSON object (no markdown, no backticks, no explanation). The JSON must match this schema:

{
  "pages": [
    {
      "id": "overview",
      "title": "Overview",
      "filters": [
        { "id": "region", "label": "Region", "type": "select", "optionsQuery": "SELECT DISTINCT region FROM sales ORDER BY 1", "default": "" },
        { "id": "start_date", "label": "From", "type": "date", "default": "2024-01-01" }
      ],
      "queries": {
        "query_name": "SELECT ... FROM table_name WHERE ('{{region}}' = '' OR region = '{{region}}')"
      },
      "html": "<div>...full HTML for this page...</div>",
      "description": "Brief description of what this page shows"
    }
  ],
  "navigation": [
    {
      "from": "overview",
      "to": "detail",
      "trigger": "Click on a row in the summary table",
      "params": ["selected_id"]
    }
  ]
}

## Rules for generated HTML

1. QUERIES: Each page MUST declare multiple named SQL queries — one per distinct visualization or data need.
   Use valid DuckDB SQL against the tables above. DuckDB is the computation engine; do all heavy lifting here.
   - Declare a separate named query for EACH chart, table, KPI group, or data component on the page.
     Example: "revenue_by_month", "top_10_customers", "kpi_totals", "category_breakdown" — not one big query.
   - ALL aggregation MUST happen in SQL: GROUP BY, SUM(), COUNT(), AVG(), PERCENTILE_CONT(), window functions,
     CTEs, subqueries — use them. Never aggregate, group, sort, or filter in JavaScript.
   - For parameterised queries (drill-downs), use {{param_name}} placeholders.
   - Pre-compute everything: if a chart needs labels and values, the SQL query must return exactly those columns.
   - Prefer DuckDB-native features: PIVOT, LIST_AGG, STRUCT_PACK, DATE_TRUNC, STRFTIME, etc.

2. HTML STRUCTURE: Each page's "html" field is a complete HTML fragment. It will be injected into a sandboxed iframe.
   - Include a <style> tag at the top for all CSS.
   - Include a <script> tag at the bottom for all JavaScript.
   - Use modern CSS (grid, flexbox). Make it responsive within the preview pane.
   - REQUIRED: Every visual card element (chart wrapper, table wrapper, KPI card, etc.) MUST have a
     data-qb-query attribute set to the query name it is backed by.
     Example: <div class="card" data-qb-query="monthly_revenue">...</div>
     The value must exactly match the key in the "queries" object for that page.
     Every declared query must have exactly one matching data-qb-query element.

3. DATA BINDING: Pre-fetched query results are available immediately as window.quackboard.data[queryName].
   Each result has shape: { columns: string[], rows: any[][] }
   All numeric columns will always be JS numbers (never strings). Null cells are JS null.
   - ALWAYS use window.quackboard.data to render the initial page — no async needed for declared queries.
   - ALWAYS guard against empty or failed data before rendering. Every chart/table must begin with:
       const d = window.quackboard.data.my_query;
       if (!d || d.rows.length === 0) { /* show empty message */ return; }
   - Never assume rows is non-empty. Never index row[0] without checking length first.
   - window.quackboard.query(sql) → Promise<{columns, rows}> — use ONLY for user-triggered interactions
     (filter changes, search, drill-downs). The SQL must still do all aggregation; never reduce results in JS.
   - window.quackboard.navigate(pageId, params) → navigates to another page
   - window.quackboard.getParams() → returns current page parameters
   - BANNED in JavaScript: .reduce() for aggregation, manual sum/count loops, Array.sort() on large datasets
     for ranking, .filter() to subset raw data before display. If you need it, write a SQL query instead.

4. CHART RENDERING: Use Chart.js (loaded globally in the sandbox). Create charts via:
   - new Chart(canvasElement, config)
   - Feed Chart.js directly from window.quackboard.data[queryName].rows — the SQL already shaped the data.
   - Prefer clean, minimal chart styles. Use the color palette below.

5. DESIGN: Create beautiful, professional dashboards.
   - Use a clean design with plenty of whitespace.
   - Color palette: #1a1a18 (primary), #e85d24 (brand/accent), #378add (info/blue),
     #1d9e75 (success/green), #ba7517 (warning/amber), #e24b4a (danger/red).
   - Neutral backgrounds: #fafaf8 (base), #ffffff (cards), #f4f3f0 (surface alt).
   - Font: system-ui, -apple-system, sans-serif. Mono: 'Courier New', monospace.
   - Cards: white background, 1px solid #e8e7e3 border, 12px border-radius, 20px padding.
   - Metric cards: large number (28px, bold), small label above (12px, gray).

6. INTERACTIVITY: Add click handlers, hover effects, and in-chart sorting where appropriate.
   - Tables should be sortable; use ORDER BY in SQL or re-query with the new sort column.
   - Charts should have tooltips.
   - Do NOT put filter form controls (dropdowns, date pickers, search boxes) inside the HTML —
     declare them as "filters" instead (see Rule 9). The app renders the filter UI automatically.

7. MULTI-PAGE: If the user asks for drill-downs or multiple views, create multiple pages.
   - The first page is always the landing/overview page.
   - Use window.quackboard.navigate('page_id', {param: value}) for navigation.
   - Detail pages should have a "Back" button.

8. SCENARIO ANALYSIS: If the user asks for what-if analysis, add input controls (sliders, number inputs).
   - The base aggregated data comes from SQL queries.
   - JS may apply scalar multipliers or offsets to pre-aggregated totals (e.g. multiply a revenue total
     by a growth rate slider) — this is the only acceptable JS arithmetic on data values.

9. FILTERS: Declare page-level filters as a "filters" array on each page that needs user-controllable filtering.
   Filter types:
     - "select"  — dropdown populated from a SQL query. Requires "optionsQuery": "SELECT DISTINCT col FROM tbl ORDER BY 1".
     - "date"    — date picker. Use "default": "YYYY-MM-DD" or "".
     - "number"  — numeric input. Use "default": "0" or any number string.
     - "text"    — free-text search input.
   Each filter has { "id", "label", "type", "default" } plus "optionsQuery" for select type.
   Use {{filter_id}} placeholders in your SQL queries. Handle the "All" / empty case:
     - Select / text: WHERE ('{{region}}' = '' OR region = '{{region}}')
     - Date:          WHERE ('{{start_date}}' = '' OR order_date >= '{{start_date}}'::DATE)
     - Number:        WHERE (TRY_CAST('{{week}}' AS INTEGER) IS NULL OR week = TRY_CAST('{{week}}' AS INTEGER))
     NEVER use CAST for number filters — always TRY_CAST, which returns NULL on empty string instead of erroring.
   Only declare filters when the user's prompt implies filtering or slicing (e.g. "by region", "date range").
   Do not add filters just to have them — only when they add genuine analytical value.

Remember: output ONLY the JSON. No markdown fences, no explanation text.`;
}

/**
 * Generate a dashboard from a user prompt.
 *
 * @param {string} userPrompt - What the user wants
 * @param {object} options - { provider, apiKey, model }
 * @param {object|null} existingProject - If refining an existing dashboard
 * @returns {object} - The parsed dashboard project JSON
 */
export async function generateDashboard(userPrompt, options, existingProject = null) {
  // Run sequentially — both use the same DuckDB connection and must not overlap
  const schemaContext = await getSchemaContext();
  const relationships = await detectRelationships();
  const systemPrompt = buildSystemPrompt(schemaContext, relationships);

  // Build the user message, including existing project context for refinement
  let userMessage = userPrompt;
  if (existingProject) {
    userMessage = `I have an existing dashboard. Please modify it based on my request.

Current dashboard structure:
${JSON.stringify(existingProject, null, 2)}

My request: ${userPrompt}

Return the complete updated dashboard JSON (all pages, even unchanged ones).`;
  }

  const messages = [
    { role: 'user', content: userMessage },
  ];

  let responseText;

  if (options.provider === 'anthropic') {
    responseText = await callAnthropic(systemPrompt, messages, options);
  } else if (options.provider === 'openai') {
    responseText = await callOpenAI(systemPrompt, messages, options);
  } else {
    throw new Error(`Unknown provider: ${options.provider}`);
  }

  // Parse the JSON response
  // Strip markdown fences if the model included them anyway
  let cleaned = responseText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const project = JSON.parse(cleaned);
    validateProject(project);
    return project;
  } catch (err) {
    console.error('Failed to parse AI response:', cleaned);
    if (err.message.includes('Unterminated') || err.message.includes('Unexpected end')) {
      throw new Error('Response was cut off — the dashboard was too large. Try a simpler prompt or fewer charts.');
    }
    throw new Error(`AI returned invalid JSON: ${err.message}`);
  }
}

/**
 * Call the Anthropic Messages API.
 */
async function callAnthropic(systemPrompt, messages, options) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': options.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: options.model || 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      system: systemPrompt,
      messages: messages,
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`Anthropic API error (${resp.status}): ${errBody}`);
  }

  const data = await resp.json();
  return data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');
}

/**
 * Call the OpenAI Chat Completions API.
 */
async function callOpenAI(systemPrompt, messages, options) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model || 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      max_tokens: 16000,
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`OpenAI API error (${resp.status}): ${errBody}`);
  }

  const data = await resp.json();
  return data.choices[0].message.content;
}

/**
 * Validate and normalise the generated project structure.
 * Throws a descriptive error on any structural problem.
 */
export function validateProject(project) {
  if (!project || typeof project !== 'object') {
    throw new Error('Project must be an object.');
  }
  if (!Array.isArray(project.pages) || project.pages.length === 0) {
    throw new Error('Project must have at least one page.');
  }

  const pageIds = new Set();
  for (const page of project.pages) {
    if (!page.id || typeof page.id !== 'string') throw new Error('Each page needs a string id.');
    if (pageIds.has(page.id)) throw new Error(`Duplicate page id: "${page.id}".`);
    pageIds.add(page.id);

    if (!page.html || typeof page.html !== 'string') {
      throw new Error(`Page "${page.id}" is missing html.`);
    }

    // queries must be a plain object (not null, not array) with string values
    if (!page.queries || Array.isArray(page.queries) || typeof page.queries !== 'object') {
      throw new Error(`Page "${page.id}" is missing a queries object.`);
    }
    for (const [name, sql] of Object.entries(page.queries)) {
      if (typeof sql !== 'string' || !sql.trim()) {
        throw new Error(`Query "${name}" on page "${page.id}" must be a non-empty SQL string.`);
      }
    }

    // Validate optional filters array
    if (page.filters !== undefined && !Array.isArray(page.filters)) {
      throw new Error(`Page "${page.id}" has invalid filters (must be an array).`);
    }
    page.filters = page.filters || [];
    const validFilterTypes = ['text', 'select', 'date', 'number'];
    for (const f of page.filters) {
      if (!f.id || typeof f.id !== 'string') {
        throw new Error(`A filter on page "${page.id}" is missing a string id.`);
      }
      if (!validFilterTypes.includes(f.type)) {
        throw new Error(`Filter "${f.id}" on page "${page.id}" has invalid type "${f.type}".`);
      }
      if (f.type === 'select' && (typeof f.optionsQuery !== 'string' || !f.optionsQuery.trim())) {
        throw new Error(`Select filter "${f.id}" on page "${page.id}" requires a non-empty optionsQuery.`);
      }
    }

    // Fill optional fields so downstream code can always rely on them
    page.title = page.title || page.id;
    page.description = page.description || '';
  }

  // Validate navigation references
  if (Array.isArray(project.navigation)) {
    for (const nav of project.navigation) {
      if (nav.from && !pageIds.has(nav.from)) {
        throw new Error(`Navigation references unknown page "${nav.from}".`);
      }
      if (nav.to && !pageIds.has(nav.to)) {
        throw new Error(`Navigation references unknown page "${nav.to}".`);
      }
    }
  } else {
    project.navigation = [];
  }
}
