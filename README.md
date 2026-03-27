# Quackboard

An AI-powered dashboard builder that lets you create bespoke HTML dashboards
backed by DuckDB — no drag-and-drop grids, just describe what you want.

## What this does

1. You upload your data (CSV, Parquet, JSON)
2. DuckDB loads it in your browser — nothing leaves your machine
3. You describe what you want in plain English
4. An AI generates a full HTML dashboard with live SQL queries
5. You can manually edit the code or re-prompt to refine it

## Prerequisites

You need two things installed on your computer:

### 1. Node.js (version 18 or higher)
- Go to https://nodejs.org
- Download the "LTS" version (the green button)
- Run the installer, click Next through everything
- To verify: open a terminal and type `node --version`

### 2. VS Code
- You probably already have this!
- If not: https://code.visualstudio.com

## Setup (one time)

Open this folder in VS Code, then open the built-in terminal
(Terminal → New Terminal from the menu bar, or press Ctrl+` ).

Run these commands one at a time:

```bash
npm install
```

That's it. This installs all the libraries the project needs.

## Running the app

In the same terminal, run:

```bash
npm run dev
```

This starts a local development server. Open the URL it shows
(usually http://localhost:5173) in your browser.

To stop the server, press Ctrl+C in the terminal.

## Using your own AI API key

This app needs an API key from an AI provider to generate dashboards.
When you first open the app, click the settings icon and paste your key.

Supported providers:
- **Anthropic (Claude)** — get a key at https://console.anthropic.com
- **OpenAI** — get a key at https://platform.openai.com

Your key is stored in your browser only. It never leaves your machine
except to make requests directly to the AI provider.

## Project structure

```
quackboard/
├── index.html          ← The app entry point
├── package.json        ← Project config and dependencies
├── vite.config.js      ← Build tool config
├── src/
│   ├── main.js         ← App startup
│   ├── app.js          ← Main application shell
│   ├── components/     ← UI pieces
│   │   ├── data-panel.js      ← File upload + table preview
│   │   ├── prompt-bar.js      ← AI prompt input
│   │   ├── editor-panel.js    ← Code editor
│   │   ├── preview-panel.js   ← Live dashboard preview
│   │   └── settings-modal.js  ← API key configuration
│   ├── engine/         ← Core logic
│   │   ├── duckdb.js          ← DuckDB-WASM wrapper
│   │   ├── ai.js              ← AI generation engine
│   │   ├── sandbox.js         ← Secure iframe runtime
│   │   └── project.js         ← Multi-page dashboard state
│   └── styles/
│       └── main.css           ← All styles
└── docs/
    └── ARCHITECTURE.md        ← Detailed technical docs
```
