/**
 * AI generation engine.
 *
 * Takes a user prompt + DuckDB schema context, calls an LLM API,
 * and returns a structured dashboard project (pages with HTML + SQL).
 */

import { getSchemaContext } from './duckdb.js';

/**
 * Build the system prompt that teaches the AI how to generate dashboards.
 */
function buildSystemPrompt(schemaContext) {
  const schemaBlock = schemaContext.map(table => {
    const cols = table.columns.map(c => `    ${c.name} (${c.type})`).join('\n');
    const samples = table.sampleRows.length > 0
      ? '\n  Sample data:\n' + table.sampleRows.map(r => '    ' + JSON.stringify(r)).join('\n')
      : '';
    return `  Table: "${table.tableName}" (${table.rowCount.toLocaleString()} rows)\n  Columns:\n${cols}${samples}`;
  }).join('\n\n');

  return `You are a dashboard generation engine. You produce interactive HTML dashboards backed by DuckDB SQL queries.

## Available data
${schemaBlock || '  No tables loaded yet.'}

## Output format
Respond with ONLY a JSON object (no markdown, no backticks, no explanation). The JSON must match this schema:

{
  "pages": [
    {
      "id": "overview",
      "title": "Overview",
      "queries": {
        "query_name": "SELECT ... FROM table_name"
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

3. DATA BINDING: Pre-fetched query results are available immediately as window.quackboard.data[queryName].
   Each result has shape: { columns: string[], rows: any[][] }
   - ALWAYS use window.quackboard.data to render the initial page — no async needed for declared queries.
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

6. INTERACTIVITY: Add filters, click handlers, hover effects, and sorting where appropriate.
   - Date filters, dropdowns, search boxes — use real HTML form elements styled to match.
   - When a filter changes, call window.quackboard.query() with a new SQL query that includes the filter
     condition in a WHERE clause — do NOT filter the existing rows array in JavaScript.
   - Tables should be sortable; use ORDER BY in SQL or re-query with the new sort column.
   - Charts should have tooltips.

7. MULTI-PAGE: If the user asks for drill-downs or multiple views, create multiple pages.
   - The first page is always the landing/overview page.
   - Use window.quackboard.navigate('page_id', {param: value}) for navigation.
   - Detail pages should have a "Back" button.

8. SCENARIO ANALYSIS: If the user asks for what-if analysis, add input controls (sliders, number inputs).
   - The base aggregated data comes from SQL queries.
   - JS may apply scalar multipliers or offsets to pre-aggregated totals (e.g. multiply a revenue total
     by a growth rate slider) — this is the only acceptable JS arithmetic on data values.

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
  const schemaContext = await getSchemaContext();
  const systemPrompt = buildSystemPrompt(schemaContext);

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
      max_tokens: 8192,
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
      max_tokens: 8192,
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
 * Basic validation of the generated project structure.
 */
function validateProject(project) {
  if (!project.pages || !Array.isArray(project.pages) || project.pages.length === 0) {
    throw new Error('Project must have at least one page.');
  }
  for (const page of project.pages) {
    if (!page.id) throw new Error('Each page needs an id.');
    if (!page.html) throw new Error(`Page "${page.id}" is missing html.`);
    if (!page.queries || typeof page.queries !== 'object') {
      throw new Error(`Page "${page.id}" is missing queries object.`);
    }
  }
}
