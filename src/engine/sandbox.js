/**
 * Sandbox engine.
 *
 * Renders dashboard pages from structured visual specs inside a sandboxed
 * iframe. The app generates all HTML/JS from the spec — no user-authored
 * markup is injected. This gives the app full knowledge of every visual,
 * enabling reliable cross-filtering, per-visual editing, and overrides.
 */

import { runQuery } from './duckdb.js';

// ── Color palettes ────────────────────────────────────────────
const CHART_COLORS = ['#e85d24', '#378add', '#1d9e75', '#ba7517', '#e24b4a', '#8b5cf6'];
const PIE_COLORS   = ['#e85d24', '#378add', '#1d9e75', '#ba7517', '#e24b4a', '#8b5cf6', '#06b6d4', '#84cc16'];

// ── Module state ──────────────────────────────────────────────
let currentIframe          = null;
let currentPageId          = null;
let currentParams          = {};
let onNavigateCallback     = null;
let onViewQueryCallback    = null;
let onSelectVisualCallback = null;
let currentThemeCSS        = '';
let visualOverrides        = {}; // visualId → overrides object
let activeCrossFilters     = {}; // column → { queryName, value }

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export function initSandbox(iframe, onNavigate, onViewQuery, onSelectVisual) {
  currentIframe          = iframe;
  onNavigateCallback     = onNavigate;
  onViewQueryCallback    = onViewQuery;
  onSelectVisualCallback = onSelectVisual;
  window.addEventListener('message', handleMessage);
}

export async function renderPage(page, params = {}) {
  if (!currentIframe) throw new Error('Sandbox not initialised.');

  currentPageId      = page.id;
  currentParams      = params;
  activeCrossFilters = {};

  // Run all queries in parallel, capturing resolved SQL for cross-filter use.
  const resolvedQueries = {};
  const entries  = Object.entries(page.queries);
  const settled  = await Promise.all(entries.map(async ([name, sql]) => {
    let resolvedSQL = sql;
    for (const [key, value] of Object.entries(params)) {
      resolvedSQL = resolvedSQL.replaceAll(`{{${key}}}`, escapeSQL(value));
    }
    resolvedSQL = resolvedSQL.replace(/\{\{[^}]+\}\}/g, '');
    resolvedQueries[name] = resolvedSQL;
    try {
      return [name, await runQuery(resolvedSQL)];
    } catch (err) {
      console.error(`Query "${name}" failed:`, err);
      return [name, { columns: [], rows: [], error: err.message }];
    }
  }));
  const queryResults = Object.fromEntries(settled);

  currentIframe.srcdoc = buildIframeDocument(page, queryResults, params, resolvedQueries);
}

// ─────────────────────────────────────────────────────────────
// Renderer helpers (module scope — run in Node/browser context)
// ─────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hexToRgbaSandbox(hex, alpha) {
  if (!hex || hex[0] !== '#') return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function defaultVisualWidth(type) {
  if (type === 'kpi')   return 3;
  if (type === 'table') return 12;
  return 6;
}

function buildStateOverlay(data) {
  if (!data || data.error) {
    const msg = escHtml((data && data.error) || 'Unknown error');
    return `<div class="qb-state-overlay qb-state-error"><svg viewBox="0 0 24 24" fill="none" stroke="#e24b4a" stroke-width="1.5" width="28" height="28"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span class="qb-state-title">Query error</span><span class="qb-state-detail">${msg}</span></div>`;
  }
  return `<div class="qb-state-overlay"><svg viewBox="0 0 24 24" fill="none" stroke="#9c9a92" stroke-width="1.5" width="28" height="28"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg><span class="qb-state-title">No data</span><span class="qb-state-detail">This query returned 0 rows.</span></div>`;
}

function buildChartJS(visual, data, ov) {
  const vid        = visual.id;
  const qname      = visual.query;
  const type       = ov.chartType || (visual.type === 'area' ? 'line' : visual.type);
  const isArea     = (ov.chartType || visual.type) === 'area';
  const yCols      = Array.isArray(visual.y) ? visual.y : (visual.y ? [visual.y] : []);
  const showLegend = ov.showLegend !== undefined ? ov.showLegend : (visual.showLegend !== false);
  const cfBaked    = visual.crossFilter ? 'true' : 'false';

  const datasetsJS = yCols.map((yCol, i) => {
    const c  = i === 0 ? (ov.chartColor || visual.color || CHART_COLORS[0]) : (CHART_COLORS[i] || CHART_COLORS[0]);
    const bg = type === 'bar' ? hexToRgbaSandbox(c, 0.75) : isArea ? hexToRgbaSandbox(c, 0.12) : c;
    return `{label:${JSON.stringify(yCol)},data:d.rows.map(function(r){var yi=d.columns.indexOf(${JSON.stringify(yCol)});return yi>=0?r[yi]:null;}),borderColor:${JSON.stringify(c)},backgroundColor:${JSON.stringify(bg)},fill:${isArea},tension:0.3,borderWidth:2,pointRadius:${type === 'bar' ? 0 : 3},pointHoverRadius:5}`;
  }).join(',');

  return `(function(){
var canvas=document.getElementById(${JSON.stringify('chart-' + vid)});
if(!canvas)return;
var d=window.__qbRawData[${JSON.stringify(qname)}];
if(!d||!d.rows.length)return;
var xIdx=d.columns.indexOf(${JSON.stringify(visual.x || '')});
if(xIdx<0)return;
window.__qbCharts[${JSON.stringify(vid)}]=new Chart(canvas,{
  type:${JSON.stringify(type)},
  data:{labels:d.rows.map(function(r){return r[xIdx];}),datasets:[${datasetsJS}]},
  options:{responsive:true,maintainAspectRatio:false,
    plugins:{legend:{display:${showLegend}},tooltip:{mode:'index',intersect:false}},
    scales:{x:{grid:{display:false},ticks:{font:{size:11},maxRotation:30}},
            y:{grid:{color:'rgba(0,0,0,0.04)'},ticks:{font:{size:11}}}}}
});
canvas.addEventListener('click',function(e){
  var ov2=(window.__qbVisualOverrides&&window.__qbVisualOverrides[${JSON.stringify(vid)}])||{};
  var isCF=ov2.crossFilter!==undefined?ov2.crossFilter:${cfBaked};
  if(!isCF)return;
  var chart=window.__qbCharts[${JSON.stringify(vid)}];
  if(!chart)return;
  var pts=chart.getElementsAtEventForMode(e,'nearest',{intersect:true},false);
  if(!pts.length)return;
  window.parent.postMessage({type:'quackboard_cross_filter',queryName:${JSON.stringify(vid)},column:${JSON.stringify(visual.x || '')},value:String(chart.data.labels[pts[0].index])},'*');
});
}());`;
}

function buildPieJS(visual, data, ov) {
  const vid      = visual.id;
  const qname    = visual.query;
  const labelCol = visual.label || data.columns[0] || '';
  const valueCol = visual.value || data.columns[1] || data.columns[0] || '';
  const showLeg  = ov.showLegend !== undefined ? ov.showLegend : (visual.showLegend !== false);
  const cfBaked  = visual.crossFilter ? 'true' : 'false';

  return `(function(){
var canvas=document.getElementById(${JSON.stringify('chart-' + vid)});
if(!canvas)return;
var d=window.__qbRawData[${JSON.stringify(qname)}];
if(!d||!d.rows.length)return;
var lIdx=d.columns.indexOf(${JSON.stringify(labelCol)});
var vIdx=d.columns.indexOf(${JSON.stringify(valueCol)});
if(lIdx<0||vIdx<0)return;
window.__qbCharts[${JSON.stringify(vid)}]=new Chart(canvas,{
  type:'doughnut',
  data:{labels:d.rows.map(function(r){return r[lIdx];}),datasets:[{data:d.rows.map(function(r){return r[vIdx];}),backgroundColor:${JSON.stringify(PIE_COLORS)},borderWidth:1,borderColor:'#fff'}]},
  options:{responsive:true,maintainAspectRatio:false,cutout:'50%',plugins:{legend:{display:${showLeg},position:'right'},tooltip:{mode:'index'}}}
});
canvas.addEventListener('click',function(e){
  var ov2=(window.__qbVisualOverrides&&window.__qbVisualOverrides[${JSON.stringify(vid)}])||{};
  var isCF=ov2.crossFilter!==undefined?ov2.crossFilter:${cfBaked};
  if(!isCF)return;
  var chart=window.__qbCharts[${JSON.stringify(vid)}];
  if(!chart)return;
  var pts=chart.getElementsAtEventForMode(e,'nearest',{intersect:true},false);
  if(!pts.length)return;
  window.parent.postMessage({type:'quackboard_cross_filter',queryName:${JSON.stringify(vid)},column:${JSON.stringify(labelCol)},value:String(chart.data.labels[pts[0].index])},'*');
});
}());`;
}

function buildTableHTML(visual, data, ov) {
  const allCols = data.columns.map((c, i) => ({ name: c, idx: i }));
  const cols    = visual.columns
    ? visual.columns.map(c => allCols.find(x => x.name === c)).filter(Boolean)
    : allCols;
  const tdPad = ov.compact ? '4px 8px' : '8px 12px';
  const thead = `<tr>${cols.map(c => `<th>${escHtml(c.name)}</th>`).join('')}</tr>`;
  const tbody = data.rows.map(row =>
    `<tr>${cols.map(c => `<td>${row[c.idx] !== null && row[c.idx] !== undefined ? escHtml(String(row[c.idx])) : ''}</td>`).join('')}</tr>`
  ).join('');
  return `<div class="table-wrap"><table${ov.striped ? ' class="striped"' : ''} style="--td-pad:${tdPad}"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
}

function buildKPIHTML(visual, data, ov) {
  const valueCol = visual.value || data.columns[0];
  const idx      = data.columns.indexOf(valueCol);
  if (idx < 0 || !data.rows.length) return `<div class="kpi-value">—</div>`;
  const raw = data.rows[0][idx];
  const fmt = visual.format || 'number';
  let formatted = raw === null ? '—' : String(raw);
  if (raw !== null && typeof raw === 'number') {
    if (fmt === 'currency')  formatted = '$' + raw.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    else if (fmt === 'percent')  formatted = (raw * 100).toFixed(1) + '%';
    else if (fmt === 'integer')  formatted = Math.round(raw).toLocaleString('en-US');
    else                         formatted = raw.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  return `<div class="kpi-value">${escHtml(formatted)}</div>`;
}

function buildVisualParts(visual, data, ov, w) {
  const hasData = data && !data.error && data.rows && data.rows.length > 0;
  let bodyHTML = '';
  let js = '';

  if (!hasData) {
    bodyHTML = buildStateOverlay(data);
  } else {
    switch (visual.type) {
      case 'bar': case 'line': case 'area':
        bodyHTML = `<canvas id="chart-${visual.id}"></canvas>`;
        js = buildChartJS(visual, data, ov);
        break;
      case 'pie':
        bodyHTML = `<canvas id="chart-${visual.id}"></canvas>`;
        js = buildPieJS(visual, data, ov);
        break;
      case 'table':
        bodyHTML = buildTableHTML(visual, data, ov);
        break;
      case 'kpi':
        bodyHTML = buildKPIHTML(visual, data, ov);
        break;
      default:
        bodyHTML = buildStateOverlay(null);
    }
  }

  const styles = [
    ov.background        ? `background:${ov.background}`           : '',
    ov.borderRadius !== undefined ? `border-radius:${ov.borderRadius}px` : '',
    ov.fontSize          ? `font-size:${ov.fontSize}px`             : '',
  ].filter(Boolean).join(';');

  const html = `<div class="visual-card${visual.type === 'kpi' ? ' kpi-card' : ''}" data-visual-id="${visual.id}" data-qb-query="${visual.query}" style="grid-column:span ${w}${styles ? ';' + styles : ''}">
  <div class="visual-header"><span class="visual-title">${escHtml(visual.title || '')}</span></div>
  <div class="visual-body">${bodyHTML}</div>
</div>`;

  return { html, js };
}

// ─────────────────────────────────────────────────────────────
// Main iframe document builder
// ─────────────────────────────────────────────────────────────

function buildIframeDocument(page, queryResults, params, resolvedQueries) {
  const visuals   = page.visuals  || [];
  const layout    = page.layout   || [];
  const layoutMap = Object.fromEntries(layout.map(item => [item.id, item]));

  const parts    = visuals.map(v => {
    const data = queryResults[v.query];
    const ov   = visualOverrides[v.id] || {};
    const w    = (layoutMap[v.id] || {}).w || defaultVisualWidth(v.type);
    return buildVisualParts(v, data, ov, w);
  });

  const gridHTML = parts.map(p => p.html).join('\n');
  const initJS   = parts.map(p => p.js).filter(Boolean).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#fafaf8;color:#1a1a18;font-size:14px;line-height:1.5}
.dashboard-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px;padding:20px;align-items:start}
.visual-card{background:#fff;border:1px solid #e8e7e3;border-radius:12px;padding:16px;overflow:hidden;position:relative}
.kpi-card{display:flex;flex-direction:column}
.visual-header{margin-bottom:10px;display:flex;align-items:center;justify-content:space-between}
.visual-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#9c9a92}
.visual-body{height:220px;position:relative}
.kpi-card .visual-body{height:auto;display:flex;align-items:center;justify-content:center;padding:12px 0}
.kpi-value{font-size:34px;font-weight:700;letter-spacing:-.03em;color:#1a1a18;line-height:1}
.table-wrap{height:100%;overflow-y:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#9c9a92;padding:6px 12px;border-bottom:1px solid #e8e7e3;position:sticky;top:0;background:#fff;z-index:1}
td{padding:var(--td-pad,8px 12px);border-bottom:1px solid #f4f3f0;color:#1a1a18}
tbody tr:hover{background:#fafaf8}
table.striped tbody tr:nth-child(even){background:rgba(0,0,0,.025)}
.qb-state-overlay{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:100%;min-height:80px;color:#9c9a92;text-align:center}
.qb-state-title{font-size:13px;font-weight:500}
.qb-state-detail{font-size:11px;font-family:monospace;max-width:240px;word-break:break-all}
.qb-edit-btn,.qb-style-btn{position:absolute;top:8px;z-index:9999;background:rgba(10,10,10,.78);color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:11px;font-family:system-ui,sans-serif;cursor:pointer;white-space:nowrap;line-height:1.4;opacity:0;transition:opacity .15s;pointer-events:none}
.qb-edit-btn{right:8px}.qb-style-btn{right:80px}
.qb-edit-btn:hover{background:rgba(0,0,0,.95)}.qb-style-btn:hover{background:rgba(232,93,36,.9)}
.visual-card:hover .qb-edit-btn,.visual-card:hover .qb-style-btn{opacity:1;pointer-events:auto}
.qb-selected{outline:2px solid #e85d24 !important;outline-offset:2px !important}
.qb-cf-badge{position:absolute;top:8px;left:8px;z-index:9998;background:rgba(232,93,36,.12);color:#e85d24;border:1px solid rgba(232,93,36,.3);border-radius:4px;padding:2px 6px;font-size:10px;font-weight:600;font-family:system-ui,sans-serif;display:flex;align-items:center;gap:3px;pointer-events:none;user-select:none}
.qb-cf-source{outline:2px solid #e85d24 !important;outline-offset:2px !important}
.qb-cf-source canvas,.qb-cf-source tbody tr{cursor:crosshair !important}
.qb-cf-active{outline:1px dashed rgba(232,93,36,.55) !important;outline-offset:2px !important}
</style>
<style id="qb-theme">${currentThemeCSS}</style>
<script>
window.__qbRawData=${JSON.stringify(queryResults)};
window.__qbVisualOverrides=${JSON.stringify(visualOverrides)};
window.__qbOriginalSQL=${JSON.stringify(resolvedQueries)};
window.__qbPageSpec=${JSON.stringify({ visuals, layout })};
window.__qbCrossFilters={};
window.__qbCharts={};
window.quackboard={
  data:${JSON.stringify(queryResults)},
  query:function(sql){return new Promise(function(resolve,reject){var id='q_'+Math.random().toString(36).substr(2,9);window.__pendingQueries=window.__pendingQueries||{};window.__pendingQueries[id]={resolve:resolve,reject:reject};window.parent.postMessage({type:'quackboard_query',id:id,sql:sql},'*');});},
  navigate:function(pageId,params){window.parent.postMessage({type:'quackboard_navigate',pageId:pageId,params:params||{}},'*');},
  getParams:function(){return ${JSON.stringify(params)};}
};
window.addEventListener('message',function(event){
  if(!event.data)return;
  var msg=event.data;
  if(msg.type==='quackboard_query_result'){
    var p=window.__pendingQueries&&window.__pendingQueries[msg.id];
    if(p){if(msg.error)p.reject(new Error(msg.error));else p.resolve(msg.result);delete window.__pendingQueries[msg.id];}
  }else if(msg.type==='quackboard_update_theme'){
    var el=document.getElementById('qb-theme');if(el)el.textContent=msg.css||'';
  }else if(msg.type==='quackboard_apply_cross_filter'){
    window.__qbCrossFilters=msg.filters||{};
    if(typeof window.__qbApplyCrossFilters==='function')window.__qbApplyCrossFilters(window.__qbCrossFilters);
  }else if(msg.type==='quackboard_apply_visual_override'){
    if(typeof window.__qbApplyOverride==='function')window.__qbApplyOverride(msg.visualId,msg.overrides);
  }
});
<\/script>
</head>
<body>
<div class="dashboard-grid">
${gridHTML}
</div>
<script>
(function(){
${initJS}

function rgbToHex(rgb){var m=rgb&&rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);if(!m)return null;return'#'+[m[1],m[2],m[3]].map(function(x){return('0'+parseInt(x).toString(16)).slice(-2);}).join('');}
function hexRgba(hex,a){var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return'rgba('+r+','+g+','+b+','+a+')';}

// ── Edit SQL + Style button injection ─────────────────────
function attachButtons(card,visualId,queryName){
  if(card.__qbBtnsDone)return;
  card.__qbBtnsDone=true;
  var eb=document.createElement('button');
  eb.className='qb-edit-btn';eb.textContent='Edit SQL';
  eb.addEventListener('click',function(e){e.stopPropagation();window.parent.postMessage({type:'quackboard_view_query',queryName:queryName},'*');});
  card.appendChild(eb);
  var sb=document.createElement('button');
  sb.className='qb-style-btn';sb.textContent='Style';
  sb.addEventListener('click',function(e){
    e.stopPropagation();
    var spec=window.__qbPageSpec.visuals.find(function(v){return v.id===visualId;});
    if(!spec)return;
    var ov=window.__qbVisualOverrides[visualId]||{};
    var cs=window.getComputedStyle(card);
    var info={
      visualId:visualId,queryName:queryName,
      type:spec.type==='table'?'table':spec.type==='kpi'?'kpi':'chart',
      chartType:ov.chartType||spec.type,
      currentColor:ov.chartColor||spec.color||'#e85d24',
      hasLegend:ov.showLegend!==undefined?ov.showLegend:(spec.showLegend!==false),
      currentBg:ov.background||rgbToHex(cs.backgroundColor)||'#ffffff',
      currentRadius:ov.borderRadius!==undefined?ov.borderRadius:parseInt(cs.borderRadius)||12,
      crossFilter:ov.crossFilter!==undefined?ov.crossFilter:(spec.crossFilter||false),
    };
    document.querySelectorAll('.qb-selected').forEach(function(el){el.classList.remove('qb-selected');});
    card.classList.add('qb-selected');
    window.parent.postMessage({type:'quackboard_select_visual',info:info},'*');
  });
  card.appendChild(sb);
}

setTimeout(function(){
  document.querySelectorAll('.visual-card').forEach(function(card){
    attachButtons(card,card.dataset.visualId,card.dataset.qbQuery);
  });

  // Table cross-filter click handlers
  document.querySelectorAll('.visual-card').forEach(function(card){
    var tbl=card.querySelector('table');
    if(!tbl)return;
    var visualId=card.dataset.visualId;
    tbl.addEventListener('click',function(e){
      var ov=(window.__qbVisualOverrides&&window.__qbVisualOverrides[visualId])||{};
      var spec=window.__qbPageSpec.visuals.find(function(v){return v.id===visualId;});
      if(!spec)return;
      var isCF=ov.crossFilter!==undefined?ov.crossFilter:(spec.crossFilter||false);
      if(!isCF)return;
      var row=e.target.closest('tbody tr');if(!row)return;
      var d=window.__qbRawData&&window.__qbRawData[card.dataset.qbQuery];
      if(!d||!d.rows||!d.columns)return;
      var rows=Array.from(tbl.querySelectorAll('tbody tr'));
      var ri=rows.indexOf(row);if(ri<0||!d.rows[ri])return;
      var filterCol=spec.x||d.columns[0];
      var colIdx=d.columns.indexOf(filterCol);if(colIdx<0)colIdx=0;
      window.parent.postMessage({type:'quackboard_cross_filter',queryName:visualId,column:filterCol,value:String(d.rows[ri][colIdx])},'*');
    });
  });

  // Apply stored overrides
  var ov=window.__qbVisualOverrides;
  if(ov)Object.keys(ov).forEach(function(vid){window.__qbApplyOverride(vid,ov[vid]);});

  // Deselect visual on outside click
  document.addEventListener('click',function(e){
    if(!e.target.closest('.visual-card')){
      document.querySelectorAll('.qb-selected').forEach(function(el){el.classList.remove('qb-selected');});
      window.parent.postMessage({type:'quackboard_deselect_visual'},'*');
    }
  });
},0);

// ── Cross-filter application ──────────────────────────────
window.__qbApplyCrossFilters=function(filters){
  var fe=Object.entries(filters);var active=fe.length>0;
  var spec=window.__qbPageSpec;if(!spec||!spec.visuals)return;
  spec.visuals.forEach(function(visual){
    var card=document.querySelector('[data-visual-id="'+visual.id+'"]');if(!card)return;
    var isSource=fe.some(function(e){return e[1].queryName===visual.id;});
    card.classList.toggle('qb-cf-source',isSource&&active);
    if(!isSource)card.classList.remove('qb-cf-active');
    if(isSource)return;
    var raw=window.__qbRawData&&window.__qbRawData[visual.query];
    if(!raw||!raw.columns)return;
    if(!active){updateVisualFromSpec(card,visual,raw);return;}
    var applicable=fe.filter(function(e){return raw.columns.indexOf(e[0])>=0;});
    if(!applicable.length)return;
    var origSQL=window.__qbOriginalSQL&&window.__qbOriginalSQL[visual.query];if(!origSQL)return;
    var where=applicable.map(function(e){return'"'+e[0].replace(/"/g,'""')+'" = \''+String(e[1].value).replace(/'/g,"''")+'\''}).join(' AND ');
    window.quackboard.query('SELECT * FROM ('+origSQL+') __qb_cf WHERE '+where).then(function(res){
      card.classList.add('qb-cf-active');updateVisualFromSpec(card,visual,res);
    }).catch(function(err){console.warn('Cross-filter failed:',visual.id,err.message);});
  });
};

function updateVisualFromSpec(card,visual,result){
  var chart=window.__qbCharts&&window.__qbCharts[visual.id];
  if(chart&&visual.x){
    var xIdx=result.columns.indexOf(visual.x);
    if(xIdx>=0){
      chart.data.labels=result.rows.map(function(r){return r[xIdx];});
      var yCols=Array.isArray(visual.y)?visual.y:(visual.y?[visual.y]:[]);
      chart.data.datasets.forEach(function(ds,i){
        var yCol=yCols[i]||yCols[0];
        var yIdx=yCol?result.columns.indexOf(yCol):-1;
        if(yIdx>=0)ds.data=result.rows.map(function(r){return r[yIdx];});
      });
      chart.update('active');return;
    }
  }
  if(chart&&visual.type==='pie'){
    var lIdx=result.columns.indexOf(visual.label||result.columns[0]);
    var vIdx=result.columns.indexOf(visual.value||(result.columns[1]||result.columns[0]));
    if(lIdx>=0&&vIdx>=0){
      chart.data.labels=result.rows.map(function(r){return r[lIdx];});
      chart.data.datasets[0].data=result.rows.map(function(r){return r[vIdx];});
      chart.update('active');return;
    }
  }
  var tbody=card.querySelector('table tbody');
  if(tbody){tbody.innerHTML=result.rows.map(function(row){return'<tr>'+row.map(function(cell){return'<td>'+(cell!==null&&cell!==undefined?cell:'')+'</td>';}).join('')+'</tr>';}).join('');}
}

// ── Visual override application ───────────────────────────
window.__qbApplyOverride=function(visualId,overrides){
  if(!overrides)return;
  window.__qbVisualOverrides=window.__qbVisualOverrides||{};
  if(overrides._reset){delete window.__qbVisualOverrides[visualId];}
  else{window.__qbVisualOverrides[visualId]=Object.assign({},window.__qbVisualOverrides[visualId],overrides);}
  var card=document.querySelector('[data-visual-id="'+visualId+'"]');if(!card)return;
  if(overrides._reset){card.style.cssText='';return;}
  if(overrides.background)card.style.setProperty('background',overrides.background,'important');
  if(overrides.borderRadius!==undefined)card.style.setProperty('border-radius',overrides.borderRadius+'px','important');
  if(overrides.fontSize!==undefined)card.style.setProperty('font-size',overrides.fontSize+'px','important');
  if(overrides.striped!==undefined){var tbl=card.querySelector('table');if(tbl)tbl.classList.toggle('striped',overrides.striped);}
  if(overrides.compact!==undefined){var tbl2=card.querySelector('table');if(tbl2)tbl2.querySelectorAll('td,th').forEach(function(c){c.style.setProperty('padding',overrides.compact?'4px 8px':'','important');});}
  if(overrides.crossFilter!==undefined){
    var badge=card.querySelector('.qb-cf-badge');
    if(overrides.crossFilter&&!badge){badge=document.createElement('div');badge.className='qb-cf-badge';badge.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>Filter';card.appendChild(badge);}
    else if(!overrides.crossFilter&&badge){badge.remove();card.classList.remove('qb-cf-source');}
  }
  var chart=window.__qbCharts&&window.__qbCharts[visualId];
  if(chart){
    var color=overrides.chartColor;
    var newType=overrides.chartType?(overrides.chartType==='area'?'line':overrides.chartType):null;
    var isArea=overrides.chartType==='area';
    if(color){chart.data.datasets.forEach(function(ds){ds.borderColor=color;var t=newType||chart.config.type;ds.backgroundColor=t==='bar'?hexRgba(color,.75):isArea?hexRgba(color,.12):color;if(isArea)ds.fill=true;});}
    if(newType){chart.config.type=newType;chart.data.datasets.forEach(function(ds){ds.fill=isArea;});}
    if(overrides.showLegend!==undefined){chart.options.plugins=chart.options.plugins||{};chart.options.plugins.legend=chart.options.plugins.legend||{};chart.options.plugins.legend.display=overrides.showLegend;}
    chart.update('none');
  }
};

}());
<\/script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// Message handler
// ─────────────────────────────────────────────────────────────

async function handleMessage(event) {
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'quackboard_query') {
    try {
      const result = await runQuery(msg.sql);
      currentIframe.contentWindow.postMessage({ type: 'quackboard_query_result', id: msg.id, result }, '*');
    } catch (err) {
      currentIframe.contentWindow.postMessage({ type: 'quackboard_query_result', id: msg.id, error: err.message }, '*');
    }
  } else if (msg.type === 'quackboard_navigate') {
    if (onNavigateCallback) onNavigateCallback(msg.pageId, msg.params || {});
  } else if (msg.type === 'quackboard_view_query') {
    if (onViewQueryCallback) onViewQueryCallback(msg.queryName);
  } else if (msg.type === 'quackboard_select_visual') {
    if (onSelectVisualCallback) onSelectVisualCallback(msg.info);
  } else if (msg.type === 'quackboard_deselect_visual') {
    if (onSelectVisualCallback) onSelectVisualCallback(null);
  } else if (msg.type === 'quackboard_cross_filter') {
    const key = msg.column;
    if (activeCrossFilters[key] &&
        activeCrossFilters[key].queryName === msg.queryName &&
        activeCrossFilters[key].value === msg.value) {
      delete activeCrossFilters[key];
    } else {
      activeCrossFilters[key] = { queryName: msg.queryName, value: msg.value };
    }
    if (currentIframe?.contentWindow) {
      currentIframe.contentWindow.postMessage({ type: 'quackboard_apply_cross_filter', filters: activeCrossFilters }, '*');
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Utilities & exports
// ─────────────────────────────────────────────────────────────

function escapeSQL(value) {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.replace(/'/g, "''");
  return String(value);
}

export function setRenderTheme(css) {
  currentThemeCSS = css || '';
}

export function injectThemeToIframe(css) {
  currentThemeCSS = css || '';
  if (!currentIframe?.contentWindow) return;
  currentIframe.contentWindow.postMessage({ type: 'quackboard_update_theme', css: currentThemeCSS }, '*');
}

export function setVisualOverride(visualId, overrides) {
  if (overrides._reset) {
    delete visualOverrides[visualId];
  } else {
    visualOverrides[visualId] = { ...(visualOverrides[visualId] || {}), ...overrides };
  }
}

export function applyVisualOverridesToIframe(visualId, overrides) {
  if (!currentIframe?.contentWindow) return;
  currentIframe.contentWindow.postMessage({ type: 'quackboard_apply_visual_override', visualId, overrides }, '*');
}

export function clearVisualOverrides() {
  visualOverrides = {};
}

export function getVisualOverrides() {
  return { ...visualOverrides };
}

export function loadVisualOverrides(data) {
  visualOverrides = data && typeof data === 'object' ? { ...data } : {};
}

export function destroySandbox() {
  window.removeEventListener('message', handleMessage);
  currentIframe = null;
}
