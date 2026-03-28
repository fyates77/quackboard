# Quick start guide

This walks you through your first dashboard in under 5 minutes.

## Step 1: Open the project in VS Code

1. Unzip the downloaded folder
2. Open VS Code
3. Go to **File → Open Folder** and select the `quackboard` folder

## Step 2: Install dependencies

Open the terminal in VS Code: **Terminal → New Terminal** (or press `` Ctrl+` ``)

```bash
npm install
```

This downloads all the libraries (~30 seconds). Ignore any "warn" messages.

## Step 3: Start the app

```bash
npm run dev
```

You'll see:

```
  VITE v5.4.0  ready in 300 ms
  ➜  Local:   http://localhost:5173/
```

**Click that link** to open the app.

## Step 4: Add your API key

1. Click the **gear icon** (⚙) in the top-right corner
2. Choose your AI provider (Anthropic or OpenAI)
3. Paste your API key and click **Save**

Don't have a key yet?
- Anthropic: https://console.anthropic.com → API Keys → Create Key
- OpenAI: https://platform.openai.com → API Keys → Create new secret key

## Step 5: Upload data

Drag a CSV, Parquet, or JSON file into the **drop zone** on the left sidebar.
You'll see the table appear with its column names and types.

You can load the included sample: `sample-data/sales.csv`

## Step 6: Generate your first dashboard

Type this into the prompt bar and press Enter:

> Show me a sales dashboard with KPI cards for total revenue and total orders,
> a monthly revenue trend chart, a bar chart comparing revenue by region,
> and a table of top 10 products.

Wait 10–20 seconds. The dashboard will appear in the preview pane.

## Step 7: Edit a SQL query

Hover over any chart or table and click **Edit SQL**. A drawer slides up from the
bottom showing that visual's SQL query in an editor. Change the query and click
**Run** to update just that visual instantly.

## Step 8: Style a visual

Hover over any chart and click **Style**. A panel slides in from the right with
controls for chart type (bar/line/area), color, legend, card background, border
radius, and font size. Changes apply live.

## Step 9: Enable cross-filtering

In the Style panel, toggle **Use as filter** on for a chart. Now clicking a bar
in that chart will filter all other visuals on the page that share the same
dimension column. Click the same bar again to clear the filter.

## Step 10: Refine with AI

Type a follow-up prompt:

> Add a drill-down: when I click a region in the bar chart,
> show a detail page with that region's monthly breakdown

The AI will add a second page with navigation wired up.

## Example prompts

**Scenario analysis:**
> Add a what-if slider for "price increase %" that recalculates projected revenue

**Filters:**
> Add a date range filter and a region dropdown to the overview page

**Executive summary:**
> Create a clean executive summary with large KPI cards and a red/yellow/green
> status indicator for each region based on whether they hit their target

## Troubleshooting

**"Failed to start DuckDB"**
→ Use Chrome or Edge. Firefox can have issues with WebAssembly threads.

**"Anthropic API error (401)"**
→ Your API key is invalid. Go to Settings and re-enter it.

**"Anthropic API error (429)"**
→ Rate limit hit. Wait a minute and retry.

**"AI returned invalid JSON"**
→ The response was cut off. Try a simpler prompt or ask for fewer visuals.

**Visual shows "Column not found"**
→ The AI named a column differently in the visual spec vs. the SQL query.
  Click **Edit SQL** on that visual to check the actual column names returned,
  then re-prompt asking the AI to fix the mismatch.

**"npm install" fails**
→ Run `node --version`. If "not found", install Node.js from https://nodejs.org
