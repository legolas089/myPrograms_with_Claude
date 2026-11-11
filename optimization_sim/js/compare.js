// Comparison tab: many algorithms from the same start point.
import { applyPreset, renderChecklist } from './algos.js';
import { runJob } from './api.js';
import { fmt, fmtInt } from './format.js';
import {
  C, draw, landscape, layout, onPick, PALETTE, pathTraces,
} from './plots.js';
import * as run from './run.js';
import {
  $, busy, pointText, reached, saveSettings, state,
} from './state.js';
import { escapeHtml, tableHtml } from './ui.js';

const selected = new Set();
let result = null;
let highlight = null;
const signal = {};

export function init(saved) {
  if (saved.cmpSel) saved.cmpSel.forEach((k) => selected.add(k));
  else applyPreset('rep', state.algos, selected);
  document.querySelectorAll('[data-target="cmp"]').forEach((b) => b.addEventListener('click', () => {
    applyPreset(b.dataset.preset, state.algos, selected);
    renderList();
    persist();
  }));
  $('cmp-run').addEventListener('click', () => busy($('cmp-run'), execute));
  $('cmp-cancel').addEventListener('click', () => signal.cancel?.());
  $('cmp-logx').addEventListener('change', () => result && drawConv());
  $('cmp-table').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    const i = Number(tr.dataset.i);
    highlight = highlight === i ? null : i;
    renderTable();
    drawPaths();
  });
}

function persist() {
  saveSettings({ cmpSel: [...selected] });
}

function renderList() {
  renderChecklist($('cmp-algos'), state.algos, selected, new Set(Object.keys(state.opts)), persist);
}

export function onProblem() {
  result = null;
  highlight = null;
  $('cmp-results').classList.add('hidden');
  $('cmp-empty').classList.remove('hidden');
}

export function show() {
  renderList();
  $('cmp-x0').textContent = pointText(state.x0, 4);
  if (result) render();
}

function progress(el, job) {
  el.classList.remove('hidden');
  const frac = job.total ? job.done / job.total : 0;
  el.querySelector('.bar').style.width = `${(frac * 100).toFixed(1)}%`;
  el.querySelector('span').textContent = `${job.done}/${job.total} ${job.label ? `· ${job.label}` : ''} · ${job.elapsed.toFixed(1)} s`;
}

async function execute() {
  if (!selected.size) throw new Error('알고리즘을 하나 이상 고르세요');
  const keys = state.algos.map((a) => a.key).filter((k) => selected.has(k));
  const runs = keys.map((k) => ({ algo: k, options: state.opts[k] || {} }));
  const bar = $('cmp-progress');
  $('cmp-cancel').classList.remove('hidden');
  try {
    const r = await runJob('/api/compare', { problem_id: state.problem.problem_id, runs, x0: state.x0 },
      (job) => progress(bar, job), signal);
    if (r) {
      result = r;
      highlight = null;
      render();
    }
  } finally {
    $('cmp-cancel').classList.add('hidden');
    setTimeout(() => bar.classList.add('hidden'), 600);
  }
}

function ordered() {
  const runs = result.runs.map((r, i) => ({ ...r, i, color: PALETTE[i % PALETTE.length] }));
  const key = (r) => (r.error ? [2, 0] : [r.violation > 1e-6 ? 1 : 0, r.f]);
  return runs.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || (a.nfev ?? 0) - (b.nfev ?? 0);
  });
}

function render() {
  $('cmp-empty').classList.add('hidden');
  $('cmp-results').classList.remove('hidden');
  renderTable();
  drawConv();
  drawPaths();
}

function renderTable() {
  const p = state.problem;
  const cons = p.constraints.length > 0;
  const head = ['알고리즘', 'f', 'f − f*', '판정', '평가', '기울기', '헤시안', '반복', '시간', ...(cons ? ['제약 위반'] : []), '솔버 메시지'];
  const rows = ordered().map((r) => {
    if (r.error) {
      return { cls: '', cells: [r.label, { html: escapeHtml(r.error), cls: 'err' }, ...Array(head.length - 2).fill('')] };
    }
    const ok = reached(r, p.success_tol);
    const verdict = ok ? '<span class="badge badge-ok">전역 도달</span>'
      : r.violation > 1e-6 ? '<span class="badge badge-bad">제약 위반</span>' : '<span class="badge badge-bad">국소/미수렴</span>';
    return {
      cls: highlight === r.i ? 'sel' : '',
      cells: [`<span class="swatch" style="background:${r.color}"></span>${escapeHtml(r.label)}`,
        fmt(r.f, 7), fmt(r.gap, 3), verdict, fmtInt(r.nfev), fmtInt(r.njev), fmtInt(r.nhev), fmtInt(r.nit),
        `${(r.time * 1000).toFixed(r.time < 0.1 ? 1 : 0)} ms`, ...(cons ? [fmt(r.violation, 2)] : []),
        { html: escapeHtml(r.message || ''), cls: 'msg' }],
    };
  });
  $('cmp-table').innerHTML = tableHtml(head, rows, -1, -1);
  // tableHtml has no row attributes: tag rows with their run index for clicks
  const trs = $('cmp-table').querySelectorAll('tbody tr');
  ordered().forEach((r, k) => trs[k]?.setAttribute('data-i', String(r.i)));
}

function drawConv() {
  const p = state.problem;
  const tiny = 1e-16;
  const traces = ordered().filter((r) => !r.error && r.curve.n.length).map((r) => ({
    type: 'scatter', mode: 'lines', name: r.label + (r.curve.approx ? ' (근사)' : ''), x: r.curve.n,
    y: r.curve.best.map((v) => (v === null || v === 'inf' ? null : Math.max(v - p.reference.f, tiny))),
    line: { color: r.color, width: highlight === r.i ? 3.5 : 1.8, shape: 'hv', dash: r.curve.approx ? 'dot' : 'solid' },
    opacity: highlight === null || highlight === r.i ? 1 : 0.35,
    hovertemplate: `${escapeHtml(r.label)}<br>평가 %{x}: %{y:.3g}<extra></extra>`,
  }));
  draw($('plot-cmp-conv'), traces, layout({
    xaxis: { title: { text: '함수 평가 수' }, type: $('cmp-logx').checked ? 'log' : 'linear' },
    yaxis: { title: { text: '지금까지 최선 f − f*' }, type: 'log', exponentformat: 'power' },
    shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: p.success_tol, y1: p.success_tol, line: { color: C.good, dash: 'dot', width: 1 } }],
    legend: { orientation: 'v', x: 1.01, y: 1, xanchor: 'left', yanchor: 'top', bgcolor: 'rgba(0,0,0,0)' },
    margin: { l: 60, r: 10, t: 10, b: 42 },
  }));
}

function drawPaths() {
  const p = state.problem;
  const el = $('plot-cmp-path');
  const { traces, layout: lay } = landscape(p, { log: !!p.skewed, showData: false, showMinima: true, colorbar: false });
  for (const r of ordered()) {
    if (r.error) continue;
    const on = highlight === null || highlight === r.i;
    traces.push(...pathTraces(p, r, r.color, r.label, { markers: p.dim === 2 ? on : true, width: highlight === r.i ? 3.5 : 1.8, visible: on ? true : 'legendonly' }));
  }
  draw(el, traces, { ...lay, legend: { orientation: 'v', x: 1.01, y: 1, xanchor: 'left', yanchor: 'top', bgcolor: 'rgba(0,0,0,0)' } })
    .then(() => onPick(el, (x, y) => run.setX0(p.dim === 1 ? [x] : [x, y], true)));
}
