/**
 * DuckDB-WASM wrapper.
 *
 * This module initialises DuckDB inside the browser and provides
 * simple methods for loading data files and running SQL queries.
 * Everything happens locally — no data leaves the user's machine.
 */

import * as duckdb from '@duckdb/duckdb-wasm';

BigInt.prototype.toJSON = function() { return Number(this); };

/**
 * Normalize an Arrow/DuckDB cell value to a plain JSON-safe JS primitive.
 * Arrow returns proxy objects for many types; this unwraps them cleanly.
 */
function normalizeValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  // Arrow Int64, Decimal, etc. expose toNumber()
  if (typeof v.toNumber === 'function') return v.toNumber();
  // Fallback: valueOf() for any other boxed primitive
  if (typeof v.valueOf === 'function') {
    const prim = v.valueOf();
    if (prim !== v && typeof prim !== 'object') return prim;
  }
  // Arrow List / nested types
  if (Array.isArray(v)) return v.map(normalizeValue);
  // Last resort: string representation
  return String(v);
}

let db = null;
let conn = null;

/**
 * Boot DuckDB-WASM. Call once at app startup.
 * Returns the connection object.
 */
export async function initDuckDB() {
  if (conn) return conn;

  // Use the CDN bundles that ship with the npm package
  const DUCKDB_BUNDLES = await duckdb.selectBundle({
    mvp: {
      mainModule: new URL(
        '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm',
        import.meta.url
      ).href,
      mainWorker: new URL(
        '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js',
        import.meta.url
      ).href,
    },
    eh: {
      mainModule: new URL(
        '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm',
        import.meta.url
      ).href,
      mainWorker: new URL(
        '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js',
        import.meta.url
      ).href,
    },
  });

  const worker = new Worker(DUCKDB_BUNDLES.mainWorker);
  const logger = new duckdb.ConsoleLogger();
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(DUCKDB_BUNDLES.mainModule);
  conn = await db.connect();
  return conn;
}

/**
 * Load a file into DuckDB as a named table.
 *
 * @param {File} file       - The uploaded File object
 * @param {string} tableName - What to call the table (auto-derived if omitted)
 * @returns {object}         - { tableName, columns: [{name, type}], rowCount }
 */
export async function loadFile(file, tableName) {
  if (!conn) throw new Error('DuckDB not initialised. Call initDuckDB() first.');

  // Derive a clean table name from the filename
  if (!tableName) {
    tableName = file.name
      .replace(/\.[^.]+$/, '')           // strip extension
      .replace(/[^a-zA-Z0-9_]/g, '_')   // sanitise
      .replace(/^(\d)/, '_$1')           // can't start with digit
      .toLowerCase();
  }

  // Read the file into an ArrayBuffer and register it with DuckDB
  const buffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(buffer);
  await db.registerFileBuffer(file.name, uint8);

  // Detect format and create table
  const ext = file.name.split('.').pop().toLowerCase();
  let createSQL;

  if (ext === 'csv' || ext === 'tsv') {
    createSQL = `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${file.name}')`;
  } else if (ext === 'parquet') {
    createSQL = `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_parquet('${file.name}')`;
  } else if (ext === 'json' || ext === 'jsonl') {
    createSQL = `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_json_auto('${file.name}')`;
  } else {
    throw new Error(`Unsupported file type: .${ext}. Use CSV, Parquet, or JSON.`);
  }

  await conn.query(createSQL);

  // Get schema info
  const schemaResult = await conn.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${tableName}' ORDER BY ordinal_position`
  );
  const columns = schemaResult.toArray().map(row => ({
    name: row.column_name,
    type: row.data_type,
  }));

  // Get row count
  const countResult = await conn.query(`SELECT count(*) as cnt FROM "${tableName}"`);
  const rowCount = Number(countResult.toArray()[0].cnt);

  // Get sample values (first 3 rows) for AI context
  const sampleResult = await conn.query(`SELECT * FROM "${tableName}" LIMIT 3`);
  const sampleRows = sampleResult.toArray().map(row => {
    const obj = {};
    for (const col of columns) {
      obj[col.name] = normalizeValue(row[col.name]);
    }
    return obj;
  });

  return { tableName, columns, rowCount, sampleRows };
}

/**
 * Run a SQL query and return results.
 *
 * @param {string} sql - The SQL to execute
 * @returns {object}   - { columns: string[], rows: any[][] }
 */
export async function runQuery(sql) {
  if (!conn) throw new Error('DuckDB not initialised.');

  const result = await conn.query(sql);
  const schema = result.schema.fields.map(f => f.name);
  const rows = result.toArray().map(row =>
    schema.map(col => normalizeValue(row[col]))
  );

  return { columns: schema, rows };
}

/**
 * List all user-created tables and their schemas.
 * This is injected into the AI prompt so it knows what data is available.
 *
 * @returns {object[]} - Array of { tableName, columns, rowCount, sampleRows }
 */
export async function getSchemaContext() {
  if (!conn) return [];

  const tablesResult = await conn.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name`
  );
  const tableNames = tablesResult.toArray().map(r => r.table_name);

  const tables = [];
  for (const name of tableNames) {
    const colResult = await conn.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${name}' ORDER BY ordinal_position`
    );
    const columns = colResult.toArray().map(r => ({
      name: r.column_name,
      type: r.data_type,
    }));

    const countResult = await conn.query(`SELECT count(*) as cnt FROM "${name}"`);
    const rowCount = Number(countResult.toArray()[0].cnt);

    const sampleResult = await conn.query(`SELECT * FROM "${name}" LIMIT 3`);
    const sampleRows = sampleResult.toArray().map(row => {
      const obj = {};
      for (const col of columns) {
        obj[col.name] = normalizeValue(row[col.name]);
      }
      return obj;
    });

    tables.push({ tableName: name, columns, rowCount, sampleRows });
  }

  return tables;
}

/**
 * Detect potential join relationships by finding column names that appear
 * in two or more tables. Returns pairs suitable for the AI prompt.
 *
 * @returns {{ column: string, table1: string, table2: string }[]}
 */
export async function detectRelationships() {
  if (!conn) return [];

  const result = await conn.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'main'
     ORDER BY table_name, ordinal_position`
  );

  const columnToTables = {};
  for (const row of result.toArray()) {
    const col = row.column_name;
    const tbl = row.table_name;
    if (!columnToTables[col]) columnToTables[col] = [];
    columnToTables[col].push(tbl);
  }

  const relationships = [];
  for (const [col, tables] of Object.entries(columnToTables)) {
    if (tables.length >= 2) {
      for (let i = 0; i < tables.length; i++) {
        for (let j = i + 1; j < tables.length; j++) {
          relationships.push({ column: col, table1: tables[i], table2: tables[j] });
        }
      }
    }
  }
  return relationships;
}

/**
 * Returns true if at least one user table is loaded in DuckDB.
 */
export async function hasLoadedTables() {
  if (!conn) return false;
  try {
    const result = await conn.query(
      `SELECT count(*) as cnt FROM information_schema.tables WHERE table_schema = 'main'`
    );
    return Number(result.toArray()[0].cnt) > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Get the raw DuckDB connection for advanced use.
 */
export function getConnection() {
  return conn;
}
