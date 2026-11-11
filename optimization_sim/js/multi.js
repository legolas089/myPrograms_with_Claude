// Multi-start tab: the same random starts (and seeds) for every algorithm,
// summarised as success rate, error distribution and a start-point map.
import { applyPreset, renderChecklist } from './algos.js';
import { runJob } from './api.js';
import { fmt, fmtInt } from './format.js';
import {
  C, draw, landscape, layout, PALETTE,
} from './plots.js';
import {
  $, busy, reached, saveSettings, state,
} from './state.js';
import { escapeHtml, tableHtml } from './ui.js';

const selected = new Set();
let result = null;
const signal = {};
const SLOW = { bo_gp: 2.5, optuna_gp: 5, optuna_tpe: 0.5 };

export function init(saved) {
  if (saved.msSel) saved.msSel.forEach((k) => selected.add(k));
  else applyPreset('rep', state.algos, selected);
  if (saved.ms) {
    $('ms-n').value = saved.ms.n ?? 30;
    $('ms-seed').value = saved.ms.seed ?? 0;
  }
  document.querySelectorAll('[data-target="ms"]').forEach((b) => b.addEventListener('click', () => {
    applyPreset(b.dataset.preset, state.algos, selected);
    renderList();
    persist();
  }));
  $('ms-run').addEventListener('click', () => busy($('ms-run'), execute));
  $('ms-cancel').addEventListener('click', () => signal.cancel?.());
  $('ms-n').addEventListener('input', workHint);
  $('ms-tol').addEventListener('input', () => result && render());
  $('ms-map-algo').addEventListener('change', drawMap);
}

function persist() {
  saveSettings({ msSel: [...selected], ms: { n: $('ms-n').value, seed: $('ms-seed').value } });
  workHint();
}

function renderList() {
  renderChecklist($('ms-algos'), state.algos, selected, new Set(Object.keys(state.opts)), persist);
  workHint();
}

function workHint() {
  const n = Number($('ms-n').value) || 0;
  const runs = n * selected.size;
  const slow = [...selected].reduce((s, k) => s + (SLOW[k] || 0) * n, 0);
  $('ms-work').textContent = `실행 ${fmtInt(runs)}회` + (slow > 20 ? ` · 베이지안 방법 때문에 약 ${Math.round(slow)}초 이상 걸릴 수 있습니다` : '')
    + (runs > 3000 ? ' · 한도(3000회)를 넘습니다' : '');
  $('ms-work').style.color = runs > 3000 ? 'var(--bad)' : '';
}

export function onProblem() {
  result = null;
  $('ms-tol').value = Number(state.problem.success_tol.toPrecision(3));
  $('ms-results').classList.add('hidden');
  $('ms-empty').classList.remove('hidden');
}

export function show() {
  renderList();
  if (result) render();
}

function tol() {
  const v = Number($('ms-tol').value);
  return Number.isFinite(v) && v >= 0 ? v : state.problem.success_tol;
}

async function execute() {
  if (!selected.size) throw new Error('알고리즘을 하나 이상 고르세요');
  const keys = state.algos.map((a) => a.key).filter((k) => selected.has(k));
  const runs = keys.map((k) => ({ algo: k, options: state.opts[k] || {} }));
  const bar = $('ms-progress');
  persist();
  $('ms-cancel').classList.remove('hidden');
  try {
    const r = await runJob('/api/multistart', {
      problem_id: state.problem.problem_id, runs, n_starts: Number($('ms-n').value), seed: Number($('ms-seed').value),
    }, (job) => {
      bar.classList.remove('hidden');
      bar.querySelector('.bar').style.width = `${((job.done / (job.total || 1)) * 100).toFixed(1)}%`;
      bar.querySelector('span').textContent = `${fmtInt(job.done)}/${fmtInt(job.total)} ${job.label ? `· ${job.label}` : ''} · ${job.elapsed.toFixed(1)} s`;
    }, signal);
    if (r) {
      result = r;
      result.algos.forEach((a, i) => { a.color = PALETTE[i % PALETTE.length]; });
      $('ms-map-algo').innerHTML = result.algos.map((a, i) => `<option value="${i}">${escapeHtml(a.label)}</option>`).join('');
      render();
    }
  } finally {
    $('ms-cancel').classList.add('hidden');
    setTimeout(() => bar.classList.add('hidden'), 600);
  }
}

const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quant = (a, q) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
};

function render() {
  $('ms-empty').classList.add('hidden');
  $('ms-results').classList.remove('hidden');
  const t = tol();
  const cons = state.problem.constraints.length > 0;
  const rows = result.algos.map((a) => {
    if (!a.runs.length) {
      return { cells: [a.label, { html: escapeHtml(a.error || '실행 결과 없음'), cls: 'err' }, '', '', '', '', '', '', ''] };
    }
    const n = a.runs.length;
    const succ = a.runs.filter((r) => reached(r, t)).length;
    const gaps = a.runs.map((r) => Math.max(r.gap, 0));
    const basins = new Set(a.runs.filter((r) => r.basin >= 0).map((r) => r.basin)).size;
    const infeas = a.runs.filter((r) => r.violation > 1e-6).length;
    const rate = succ / n;
    return {
      cells: [
        `<span class="swatch" style="background:${a.color}"></span>${escapeHtml(a.label)}${a.error ? ` <span class="badge badge-bad" title="${escapeHtml(a.error)}">오류</span>` : ''}`,
        `<span class="bar-cell"><i style="width:${(rate * 100).toFixed(0)}%"></i></span>${(rate * 100).toFixed(0)}% <span class="sub">${succ}/${n}</span>`,
        fmt(median(gaps), 3), `${fmt(quant(gaps, 0.25), 2)} ~ ${fmt(quant(gaps, 0.75), 2)}`, fmt(Math.max(...gaps), 3),
        fmtInt(Math.round(median(a.runs.map((r) => r.nfev)))),
        `${(median(a.runs.map((r) => r.time)) * 1000).toFixed(1)} ms`,
        String(basins), ...(cons ? [String(infeas)] : []),
      ],
    };
  });
  const head = ['알고리즘', '전역 도달률', '오차 중앙값', '오차 IQR', '최악 오차', '평가 수 (중앙)', '시간 (중앙)', '도달한 분지', ...(cons ? ['제약 위반 횟수'] : [])];
  $('ms-table').innerHTML = tableHtml(head, rows, -1, -1);
  drawBox();
  drawConv();
  drawMap();
}

function drawBox() {
  const tiny = 1e-12;
  const traces = result.algos.filter((a) => a.runs.length).map((a) => ({
    type: 'box', name: a.label, y: a.runs.map((r) => Math.log10(Math.max(r.gap, 0) + tiny)),
    boxpoints: 'all', jitter: 0.4, pointpos: 0, marker: { color: a.color, size: 4, opacity: 0.8 }, line: { color: a.color, width: 1.4 },
    fillcolor: 'rgba(0,0,0,0)', hovertemplate: `${escapeHtml(a.label)}<br>log₁₀ 오차 %{y:.2f}<extra></extra>`,
  }));
  const lt = Math.log10(tol() + tiny);
  draw($('plot-ms-box'), traces, layout({
    showlegend: false, yaxis: { title: { text: 'log₁₀(f − f* + 10⁻¹²)' } }, xaxis: { tickangle: -35, automargin: true },
    shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: lt, y1: lt, line: { color: C.good, dash: 'dot', width: 1 } }],
    margin: { l: 60, r: 10, t: 10, b: 110 },
  }));
}

function drawConv() {
  const traces = [];
  for (const a of result.algos) {
    if (!a.curve) continue;
    const pos = (v) => (v === null ? null : Math.max(v, 1e-16));
    traces.push({ type: 'scatter', mode: 'lines', x: a.curve.n, y: a.curve.q75.map(pos), line: { width: 0 }, showlegend: false, hoverinfo: 'skip', legendgroup: a.label });
    traces.push({ type: 'scatter', mode: 'lines', x: a.curve.n, y: a.curve.q25.map(pos), line: { width: 0 }, fill: 'tonexty',
      fillcolor: hexA(a.color, 0.15), showlegend: false, hoverinfo: 'skip', legendgroup: a.label });
    traces.push({ type: 'scatter', mode: 'lines', name: a.label, x: a.curve.n, y: a.curve.q50.map(pos), legendgroup: a.label,
      line: { color: a.color, width: 2, shape: 'hv' }, hovertemplate: `${escapeHtml(a.label)}<br>평가 %{x}: 중앙값 %{y:.3g}<extra></extra>` });
  }
  draw($('plot-ms-conv'), traces, layout({
    xaxis: { title: { text: '함수 평가 수' }, type: 'log' },
    yaxis: { title: { text: '최선 f − f* (중앙값)' }, type: 'log', exponentformat: 'power' },
    legend: { orientation: 'v', x: 1.01, y: 1, xanchor: 'left', yanchor: 'top', bgcolor: 'rgba(0,0,0,0)', font: { size: 11 } },
    margin: { l: 60, r: 10, t: 10, b: 42 },
  }));
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// f on the 1-D plotting grid, linearly interpolated
function f1d(p, x) {
  const xs = p.landscape.axes[0];
  const f = p.landscape.f;
  const t = ((x - xs[0]) / (xs[xs.length - 1] - xs[0])) * (xs.length - 1);
  const i = Math.max(0, Math.min(xs.length - 2, Math.floor(t)));
  return f[i] + (f[i + 1] - f[i]) * (t - i);
}

function drawMap() {
  if (!result) return;
  const p = state.problem;
  const a = result.algos[Number($('ms-map-algo').value) || 0];
  if (!a) return;
  const t = tol();
  const { traces, layout: lay } = landscape(p, { log: !!p.skewed, showData: false, showMinima: true, colorbar: false });
  const two = p.dim === 2;
  const ok = a.runs.map((r) => reached(r, t));
  const col = ok.map((v) => (v ? C.good : C.bad));
  const finalY = a.runs.map((r) => (two ? r.x[1] : r.f));
  if (a.uses_x0) {
    const starts = a.runs.map((r) => r.x0);
    for (let i = 0; i < a.runs.length; i++) {
      const s = starts[i];
      traces.push({ type: 'scatter', mode: 'lines', x: [s[0], a.runs[i].x[0]], y: two ? [s[1], finalY[i]] : [f1d(p, s[0]), finalY[i]],
        line: { color: col[i], width: 0.7 }, opacity: 0.45, showlegend: false, hoverinfo: 'skip' });
    }
    traces.push({
      type: 'scatter', mode: 'markers', name: '출발점', x: starts.map((s) => s[0]),
      y: two ? starts.map((s) => s[1]) : starts.map((s) => f1d(p, s[0])), customdata: a.runs.map((r) => r.gap),
      marker: { size: 9, color: 'rgba(0,0,0,0)', line: { color: col, width: 2 } },
      hovertemplate: '출발점<br>최종 f − f* = %{customdata:.3g}<extra></extra>',
    });
  }
  traces.push({
    type: 'scatter', mode: 'markers', name: '도착점', x: a.runs.map((r) => r.x[0]), y: finalY, customdata: a.runs.map((r) => r.gap),
    marker: { symbol: 'x', size: 10, color: col, line: { color: '#000', width: 1 } },
    hovertemplate: '도착점<br>f − f* = %{customdata:.3g}<extra></extra>',
  });
  draw($('plot-ms-map'), traces, lay);
}
