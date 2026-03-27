# Quick start guide

This walks you through your first dashboard in under 5 minutes.

## Step 1: Open the project in VS Code

1. Unzip the downloaded folder
2. Open VS Code
3. Go to **File → Open Folder** and select the `quackboard` folder

## Step 2: Install dependencies

1. Open the terminal in VS Code: **Terminal → New Terminal** (or press `` Ctrl+` ``)
2. Type this command and press Enter:

```
npm install
```

This downloads all the libraries. It takes about 30 seconds.
You'll see a progress bar, then a summary. Ignore any "warn" messages — they're normal.

## Step 3: Start the app

In the same terminal, type:

```
npm run dev
```

You'll see something like:

```
  VITE v5.4.0  ready in 300 ms

  ➜  Local:   http://localhost:5173/
```

**Click that link** (or copy-paste it into your browser).

## Step 4: Add your API key

1. Click the **gear icon** (⚙) in the top-right corner
2. Choose your AI provider (Anthropic or OpenAI)
3. Paste your API key
4. Click **Save**

Don't have a key yet? Get one at:
- Anthropic: https://console.anthropic.com (create account → API Keys → Create Key)
- OpenAI: https://platform.openai.com (create account → API Keys → Create new secret key)

## Step 5: Upload data

Drag the file `sample-data/sales.csv` from your file explorer into the
**drop zone** on the left sidebar. You'll see the table appear with its columns.

## Step 6: Generate your first dashboard

Type this into the prompt bar and press Enter:

> Show me a sales dashboard with:
> - KPI cards for total revenue, total units, and profit margin
> - A monthly revenue trend line chart
> - A bar chart comparing revenue by region
> - A sortable table of all products with their total revenue

Wait 10–20 seconds. The AI will generate the dashboard and it will
appear in the preview pane on the right.

## Step 7: Try editing

Click the **HTML** tab on the left editor pane. Try changing a color
or a heading. The preview updates live as you type (with a short delay).

## Step 8: Try iterative refinement

Now type a follow-up prompt:

> Add a drill-down: when I click a region in the bar chart,
> show a detail page with that region's monthly breakdown and product mix

The AI will add a second page to your dashboard with navigation wired up.

## Example prompts to try

Here are some prompts that show off different capabilities:

**Scenario analysis:**
> Add a what-if section with sliders for "price increase %" and
> "volume change %" that recalculate projected revenue in real time

**Custom filtering:**
> Add a filter bar at the top with a date range picker, a region
> multi-select dropdown, and a product category toggle

**Executive summary:**
> Create a clean executive summary page with large KPI cards,
> sparkline trends, and a red/yellow/green status indicator
> for each region based on whether they hit their target

**Data table with features:**
> Show me a full data table with search, column sorting, and
> alternating row colors. Highlight rows where profit margin
> is below 30% in red.

## Troubleshooting

**"Failed to start DuckDB"**
→ Try a different browser (Chrome or Edge work best). Firefox sometimes
  has issues with WebAssembly threads.

**"Anthropic API error (401)"**
→ Your API key is invalid. Go to Settings and check it.

**"Anthropic API error (429)"**
→ You've hit the rate limit. Wait a minute and try again.

**The preview is blank**
→ Open browser DevTools (F12) → Console tab. Look for red error messages.
  The generated code might have a bug — try re-prompting with a simpler request.

**"npm install" fails**
→ Make sure Node.js is installed: run `node --version` in the terminal.
  If it says "not found", install Node.js from https://nodejs.org
