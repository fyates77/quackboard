/**
 * AI generation engine.
 *
 * Generates structured dashboard specs (not free-form HTML).
 * The AI produces: queries, visuals (type + column bindings), and layout.
 * The app renders everything deterministically from the spec.
 */

import { getSchemaContext, detectRelationships } from './duckdb.js';

function buildSystemPrompt(schemaContext, relationships = []) {
  const schemaBlock = schemaContext.map(table => {
    const cols    = table.columns.map(c => `    ${c.name} (${c.type})`).join('\n');
    const samples = table.sampleRows.length > 0
      ? '\n  Sample data:\n' + table.sampleRows.map(r => '    ' + JSON.stringify(r)).join('\n')
      : '';
    return `  Table: "${table.tableName}" (${table.rowCount.toLocaleString()} rows)\n  Columns:\n${cols}${samples}`;
  }).join('\n\n');

  const relationshipsBlock = relationships.length > 0
    ? `\n## Possible joins (shared column names across tables)\n` +
      relationships.map(r => `  "${r.table1}".${r.column} ↔ "${r.table2}".${r.column}`).join('\n')
    : '';

  return `You are a dashboard generation engine. You produce structured dashboard specs backed by DuckDB SQL.

## Available data
${schemaBlock || '  No tables loaded yet.'}${relationshipsBlock}

## Output format
Respond with ONLY a JSON object (no markdown, no backticks, no explanation). Schema:

{
  "pages": [
    {
      "id": "overview",
      "title": "Overview",
      "description": "What this page shows",
      "filters": [
        { "id": "region", "label": "Region", "type": "select", "optionsQuery": "SELECT DISTINCT region FROM sales ORDER BY 1", "default": "" }
      ],
      "queries": {
        "revenue_by_month": "SELECT month, SUM(revenue) AS revenue FROM sales GROUP BY month ORDER BY month",
        "total_revenue":    "SELECT SUM(revenue) AS total_revenue FROM sales",
        "top_customers":    "SELECT name, SUM(revenue) AS revenue FROM sales GROUP BY name ORDER BY 2 DESC LIMIT 10"
      },
      "visuals": [
        { "id": "rev_chart",   "type": "bar",   "query": "revenue_by_month", "title": "Revenue by Month",  "x": "month",  "y": "revenue", "color": "#e85d24" },
        { "id": "total_kpi",   "type": "kpi",   "query": "total_revenue",    "title": "Total Revenue",     "value": "total_revenue", "format": "currency" },
        { "id": "cust_table",  "type": "table", "query": "top_customers",    "title": "Top Customers" }
      ],
      "layout": [
        { "id": "total_kpi",  "w": 4 },
        { "id": "rev_chart",  "w": 8 },
        { "id": "cust_table", "w": 12 }
      ]
    }
  ],
  "navigation": [
    { "from": "overview", "to": "detail", "trigger": "Click on a customer row", "params": ["customer_id"] }
  ]
}

## Visual types

- "bar"   — Bar chart. Required: "x" (label column), "y" (value column or array of columns for multi-series).
- "line"  — Line chart. Same as bar.
- "area"  — Area chart. Same as bar.
- "pie"   — Pie/donut chart. Required: "label" (slice label column), "value" (slice value column).
- "kpi"   — Big metric card. Required: "value" (single pre-aggregated value column).
             Optional "format": "number" | "currency" | "percent" | "integer".
- "table" — Data table. Optional "columns": ["col1","col2"] to show specific columns only.

Optional on all types: "color" (hex), "showLegend" (boolean).

## Layout rules

- "layout" is an ordered array of { "id": visual_id, "w": 1–12 }.
- "w" is the visual width in a 12-column grid. Items fill rows left-to-right, wrapping at 12.
- Typical widths: KPI → 3 or 4. Chart → 6, 8, or 12. Table → 6 or 12.
- A row of three equal KPIs: three items with w:4. Full-width chart: w:12.
- Every declared visual must appear in layout exactly once.

## Query rules

1. One query per visual — each query feeds exactly one visual.
2. Return only the columns the visual needs:
   - bar/line/area: the x column then y column(s)
   - pie: the label column then the value column
   - kpi: a single aggregated value column, single-row result
   - table: the columns to display, already sorted and limited
3. ALL aggregation in SQL: GROUP BY, SUM, COUNT, AVG, window functions, CTEs. Never in JavaScript.
4. Use valid DuckDB SQL. Leverage DATE_TRUNC, STRFTIME, TRY_CAST, PIVOT, LIST_AGG, etc.
5. For filter params: use {{filter_id}} placeholders with null-safe patterns:
   - select/text: WHERE ('{{region}}' = '' OR region = '{{region}}')
   - date:        WHERE ('{{start_date}}' = '' OR col >= '{{start_date}}'::DATE)
   - number:      WHERE (TRY_CAST('{{week}}' AS INTEGER) IS NULL OR col = TRY_CAST('{{week}}' AS INTEGER))
   Always use TRY_CAST (never CAST) for numeric filter params.
6. For parameterised drill-down queries use {{param_name}} placeholders.

## Filters

Declare a "filters" array only when the user's request implies filtering/slicing by a dimension.
Filter types: "select" (needs "optionsQuery"), "date", "number", "text".
Do not put filter UI elements in visuals — the app renders the filter bar automatically.

## Cross-filtering

When multiple visuals on a page share a dimension (e.g. all show data broken down by "region"),
they can cross-filter each other — clicking a bar in one chart filters all other visuals on the page.
For this to work, the shared dimension column MUST have the same name across all related queries.
Put the primary dimension as the first column in every query that participates in cross-filtering.
Do NOT write any JavaScript for cross-filtering — the app handles it automatically.
Note cross-filtering availability in the page description.

## Multi-page navigation

- Use window.quackboard.navigate('page_id', {param: value}) for drill-downs.
- Detail pages must have a back link: window.quackboard.navigate('overview', {}).
- The "html" field is NOT used — do not include it.

Remember: output ONLY the JSON. No markdown fences, no explanation text.`;
}

export async function generateDashboard(userPrompt, options, existingProject = null) {
  // Sequential — both use the same DuckDB connection and must not overlap
  const schemaContext   = await getSchemaContext();
  const relationships   = await detectRelationships();
  const systemPrompt    = buildSystemPrompt(schemaContext, relationships);

  let userMessage = userPrompt;
  if (existingProject) {
    userMessage = `I have an existing dashboard. Please modify it based on my request.\n\nCurrent dashboard:\n${JSON.stringify(existingProject, null, 2)}\n\nMy request: ${userPrompt}\n\nReturn the complete updated dashboard JSON (all pages, even unchanged ones).`;
  }

  const messages = [{ role: 'user', content: userMessage }];
  let responseText;

  if (options.provider === 'anthropic') {
    responseText = await callAnthropic(systemPrompt, messages, options);
  } else if (options.provider === 'openai') {
    responseText = await callOpenAI(systemPrompt, messages, options);
  } else {
    throw new Error(`Unknown provider: ${options.provider}`);
  }

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
      throw new Error('Response was cut off — try a simpler prompt or fewer charts.');
    }
    throw new Error(`AI returned invalid JSON: ${err.message}`);
  }
}

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
      messages,
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic API error (${resp.status}): ${await resp.text()}`);
  const data = await resp.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function callOpenAI(systemPrompt, messages, options) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${options.apiKey}` },
    body: JSON.stringify({
      model: options.model || 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      max_tokens: 16000,
      temperature: 0.3,
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI API error (${resp.status}): ${await resp.text()}`);
  const data = await resp.json();
  return data.choices[0].message.content;
}

export function validateProject(project) {
  if (!project || typeof project !== 'object') throw new Error('Project must be an object.');
  if (!Array.isArray(project.pages) || project.pages.length === 0) throw new Error('Project must have at least one page.');

  const VISUAL_TYPES  = new Set(['bar', 'line', 'area', 'pie', 'kpi', 'table']);
  const FILTER_TYPES  = new Set(['text', 'select', 'date', 'number']);
  const CHART_FORMATS = new Set(['number', 'currency', 'percent', 'integer']);
  const pageIds = new Set();

  for (const page of project.pages) {
    if (!page.id || typeof page.id !== 'string') throw new Error('Each page needs a string id.');
    if (pageIds.has(page.id)) throw new Error(`Duplicate page id: "${page.id}".`);
    pageIds.add(page.id);

    // queries
    if (!page.queries || Array.isArray(page.queries) || typeof page.queries !== 'object') {
      throw new Error(`Page "${page.id}" is missing a queries object.`);
    }
    for (const [name, sql] of Object.entries(page.queries)) {
      if (typeof sql !== 'string' || !sql.trim()) throw new Error(`Query "${name}" on page "${page.id}" must be a non-empty SQL string.`);
    }

    // visuals
    if (!Array.isArray(page.visuals) || page.visuals.length === 0) {
      throw new Error(`Page "${page.id}" must have at least one visual.`);
    }
    const visualIds = new Set();
    for (const v of page.visuals) {
      if (!v.id || typeof v.id !== 'string') throw new Error(`A visual on page "${page.id}" is missing a string id.`);
      if (visualIds.has(v.id)) throw new Error(`Duplicate visual id "${v.id}" on page "${page.id}".`);
      visualIds.add(v.id);

      if (!VISUAL_TYPES.has(v.type)) throw new Error(`Visual "${v.id}" has invalid type "${v.type}".`);
      if (!v.query || !page.queries[v.query]) throw new Error(`Visual "${v.id}" references unknown query "${v.query}".`);

      if (['bar', 'line', 'area'].includes(v.type)) {
        if (!v.x) throw new Error(`Visual "${v.id}" (${v.type}) requires an "x" column.`);
        if (!v.y) throw new Error(`Visual "${v.id}" (${v.type}) requires a "y" column.`);
      }
      if (v.type === 'kpi') {
        if (!v.value) throw new Error(`Visual "${v.id}" (kpi) requires a "value" column.`);
        if (v.format && !CHART_FORMATS.has(v.format)) throw new Error(`Visual "${v.id}" has invalid format "${v.format}".`);
      }
      if (v.type === 'pie') {
        if (!v.label) throw new Error(`Visual "${v.id}" (pie) requires a "label" column.`);
        if (!v.value) throw new Error(`Visual "${v.id}" (pie) requires a "value" column.`);
      }
    }

    // layout
    if (!Array.isArray(page.layout) || page.layout.length === 0) {
      throw new Error(`Page "${page.id}" must have a layout array.`);
    }
    for (const item of page.layout) {
      if (!item.id || !visualIds.has(item.id)) throw new Error(`Layout item "${item.id}" on page "${page.id}" references an unknown visual.`);
      if (typeof item.w !== 'number' || item.w < 1 || item.w > 12) throw new Error(`Layout item "${item.id}" has invalid w "${item.w}" (must be 1–12).`);
    }

    // filters
    page.filters = page.filters || [];
    if (!Array.isArray(page.filters)) throw new Error(`Page "${page.id}" filters must be an array.`);
    for (const f of page.filters) {
      if (!f.id || typeof f.id !== 'string') throw new Error(`A filter on page "${page.id}" is missing a string id.`);
      if (!FILTER_TYPES.has(f.type)) throw new Error(`Filter "${f.id}" has invalid type "${f.type}".`);
      if (f.type === 'select' && (typeof f.optionsQuery !== 'string' || !f.optionsQuery.trim())) {
        throw new Error(`Select filter "${f.id}" on page "${page.id}" requires a non-empty optionsQuery.`);
      }
    }

    page.title       = page.title       || page.id;
    page.description = page.description || '';
  }

  if (Array.isArray(project.navigation)) {
    for (const nav of project.navigation) {
      if (nav.from && !pageIds.has(nav.from)) throw new Error(`Navigation references unknown page "${nav.from}".`);
      if (nav.to   && !pageIds.has(nav.to))   throw new Error(`Navigation references unknown page "${nav.to}".`);
    }
  } else {
    project.navigation = [];
  }
}
