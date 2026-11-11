// Plotly building blocks: dark layout, the objective landscape (1-D curve or
// 2-D contour) with constraints / data / minima overlays, and search paths.
/* global Plotly */
import { fmt } from './format.js';

export const C = {
  grid: '#333',
  text: '#ccc',
  true: '#f0a050',
  data: '#ffffff',
  minima: '#c8c8c8',
  global: '#ffd84a',
  path: '#ff6b6b',
  good: '#8fe0a2',
  bad: '#f08f8f',
  accent: '#4ea1ff',
};

// distinguishable on the dark background and on Viridis
export const PALETTE = ['#ff6b6b', '#4ea1ff', '#ffd84a', '#8fe0a2', '#d58cff', '#ff9f43', '#00e5ff', '#ff6fb5',
  '#b8e986', '#f5f5f5', '#a0a0ff', '#ffb3a7', '#50c8a0', '#e0c060', '#7fb0ff', '#ff8080'];

export const CONFIG = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d'] };

export function layout(extra = {}) {
  const base = {
    paper_bgcolor: '#262626',
    plot_bgcolor: '#262626',
    font: { family: 'Segoe UI, Malgun Gothic, sans-serif', size: 12, color: C.text },
    margin: { l: 60, r: 16, t: 10, b: 42 },
    xaxis: { gridcolor: C.grid, zerolinecolor: '#444' },
    yaxis: { gridcolor: C.grid, zerolinecolor: '#444' },
    legend: { orientation: 'h', x: 0, xanchor: 'left', y: 1.02, yanchor: 'bottom', bgcolor: 'rgba(0,0,0,0)' },
    hovermode: 'closest',
  };
  const out = { ...base, ...extra };
  out.xaxis = { ...base.xaxis, ...(extra.xaxis || {}) };
  out.yaxis = { ...base.yaxis, ...(extra.yaxis || {}) };
  return out;
}

export function draw(el, traces, lay) {
  return Plotly.react(el, traces, lay, CONFIG);
}

export function resizeAll(root) {
  root.querySelectorAll('.plot').forEach((p) => {
    if (p.data) Plotly.Plots.resize(p);
  });
}

// ── value transform for colour ──────────────────────────────────────
function flat(z) {
  return Array.isArray(z[0]) ? z.flat() : z;
}

export function colorScale(prob, z, log) {
  let lo = prob.f_stats.min;
  for (const v of flat(z)) if (v !== null && v < lo) lo = v;
  const delta = Math.max((prob.f_stats.median - lo) * 1e-3, 1e-12);
  const tf = (v) => (v === null ? null : log ? Math.log10(v - lo + delta) : v);
  return {
    tf,
    z: Array.isArray(z[0]) ? z.map((r) => r.map(tf)) : z.map(tf),
    title: log ? `log₁₀(f − ${fmt(lo, 4)} + ${fmt(delta, 2)})` : 'f',
  };
}

// ── landscape ───────────────────────────────────────────────────────
// "x (temp)" for uploaded data, so the column behind each variable stays visible
export function axisName(prob, i) {
  const n = prob.names[i];
  return prob.col_names ? `${n} (${prob.col_names[i]})` : n;
}

// opts: {log, useTrue, showData, showMinima, colorbar, title}
export function landscape(prob, opts = {}) {
  return prob.dim === 1 ? landscape1d(prob, opts) : landscape2d(prob, opts);
}

function minimaPoints(prob) {
  const loc = prob.local_minima.slice(0, 150);
  return loc;
}

function landscape2d(prob, opts) {
  const L = prob.landscape;
  const [xs, ys] = L.axes;
  const raw = opts.useTrue && L.f_true ? L.f_true : L.f;
  const cs = colorScale(prob, raw, opts.log);
  const traces = [{
    type: 'contour', x: xs, y: ys, z: cs.z, customdata: raw, name: 'f',
    colorscale: 'Viridis', ncontours: 32, showlegend: false,
    contours: { coloring: 'heatmap', showlines: true },
    line: { width: 0.5, color: 'rgba(0,0,0,0.25)' },
    colorbar: opts.colorbar === false ? undefined : { title: { text: cs.title, side: 'right' }, thickness: 12, len: 0.9 },
    showscale: opts.colorbar !== false,
    hovertemplate: `${prob.names[0]}=%{x:.4g}<br>${prob.names[1]}=%{y:.4g}<br>f=%{customdata:.5g}<extra></extra>`,
  }];
  for (const c of L.cons || []) {
    // Plotly draws heatmaps beneath contours, so the infeasible side is shaded
    // with a 'constraint' contour: g <= 0 stays clear, the rest gets the fill.
    traces.push(c.kind === 'ineq' ? {
      type: 'contour', x: xs, y: ys, z: c.v, showscale: false, hoverinfo: 'skip', showlegend: false, name: c.text,
      contours: { type: 'constraint', operation: '<=', value: 0 },
      fillcolor: 'rgba(8,8,8,0.62)', line: { color: '#fff', width: 2 },
    } : {
      type: 'contour', x: xs, y: ys, z: c.v, showscale: false, hoverinfo: 'skip', showlegend: false, name: c.text,
      contours: { type: 'constraint', operation: '=', value: 0 },
      line: { color: C.true, width: 2, dash: 'dash' },
    });
  }
  if (opts.showData && prob.data) {
    traces.push({
      type: 'scatter', mode: 'markers', name: `데이터 (${prob.data.n}점)`,
      x: prob.data.points.map((p) => p[0]), y: prob.data.points.map((p) => p[1]),
      customdata: prob.data.values,
      marker: { color: 'rgba(255,255,255,0.85)', size: 5, line: { color: '#000', width: 0.8 } },
      hovertemplate: 'data f=%{customdata:.5g}<extra></extra>',
    });
  }
  if (opts.showMinima) {
    const loc = minimaPoints(prob);
    if (loc.length) {
      traces.push({
        type: 'scatter', mode: 'markers', name: `국소 최솟값 (${prob.n_local_minima})`,
        x: loc.map((m) => m.x[0]), y: loc.map((m) => m.x[1]), customdata: loc.map((m) => m.f),
        marker: { symbol: 'triangle-down', size: 7, color: 'rgba(0,0,0,0)', line: { color: C.minima, width: 1.2 } },
        hovertemplate: '국소 최솟값 f=%{customdata:.5g}<extra></extra>',
      });
    }
  }
  const g = prob.reference.all;
  traces.push({
    type: 'scatter', mode: 'markers', name: '전역 최솟값 (기준)', x: g.map((p) => p[0]), y: g.map((p) => p[1]),
    marker: { symbol: 'star', size: 15, color: C.global, line: { color: '#000', width: 1 } },
    hovertemplate: `전역 최솟값 f*=${fmt(prob.reference.f, 6)}<extra></extra>`,
  });
  if (opts.useTrue === false && prob.true_min) {
    traces.push({
      type: 'scatter', mode: 'markers', name: '참 함수의 최솟값', x: [prob.true_min.x[0]], y: [prob.true_min.x[1]],
      marker: { symbol: 'star-open', size: 15, color: C.true, line: { width: 2 } },
      hovertemplate: `참 함수 최솟값 f=${fmt(prob.true_min.f, 5)}<extra></extra>`,
    });
  }
  const [bx, by] = prob.bounds;
  return {
    traces,
    layout: layout({
      xaxis: { title: { text: axisName(prob, 0) }, range: [bx[0], bx[1]], constrain: 'domain' },
      yaxis: { title: { text: axisName(prob, 1) }, range: [by[0], by[1]] },
      margin: { l: 56, r: 10, t: 10, b: 42 },
    }),
  };
}

function landscape1d(prob, opts) {
  const L = prob.landscape;
  const xs = L.axes[0];
  const traces = [];
  const shapes = [];
  const surrogate = !!L.f_true;
  traces.push({
    type: 'scatter', mode: 'lines', name: surrogate ? '대리모델 f̂ (최적화 대상)' : 'f(x)', x: xs, y: L.f,
    line: { color: C.accent, width: 2 }, hovertemplate: 'x=%{x:.5g}<br>f=%{y:.5g}<extra></extra>',
  });
  if (L.f_true && opts.useTrue !== false) {
    traces.push({
      type: 'scatter', mode: 'lines', name: '참 함수', x: xs, y: L.f_true,
      line: { color: C.true, width: 1.6, dash: 'dash' }, hovertemplate: '참 f=%{y:.5g}<extra></extra>',
    });
  }
  for (const c of L.cons || []) {
    if (c.kind === 'ineq') {
      let start = null;
      c.v.forEach((v, i) => {
        if (v > 0 && start === null) start = xs[i];
        if ((v <= 0 || i === c.v.length - 1) && start !== null) {
          shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: start, x1: xs[i], y0: 0, y1: 1,
            fillcolor: 'rgba(0,0,0,0.5)', line: { width: 0 }, layer: 'below' });
          start = null;
        }
      });
    } else {
      for (let i = 1; i < c.v.length; i++) {
        if (Math.sign(c.v[i]) !== Math.sign(c.v[i - 1])) {
          shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: xs[i], x1: xs[i], y0: 0, y1: 1,
            line: { color: C.true, width: 1.5, dash: 'dash' } });
        }
      }
    }
  }
  if (opts.showData && prob.data) {
    traces.push({
      type: 'scatter', mode: 'markers', name: `데이터 (${prob.data.n}점)`,
      x: prob.data.points.map((p) => p[0]), y: prob.data.values,
      marker: { color: 'rgba(255,255,255,0.85)', size: 6, line: { color: '#000', width: 0.8 } },
      hovertemplate: 'data x=%{x:.4g}, f=%{y:.5g}<extra></extra>',
    });
  }
  if (opts.showMinima) {
    const loc = minimaPoints(prob);
    traces.push({
      type: 'scatter', mode: 'markers', name: `국소 최솟값 (${prob.n_local_minima})`,
      x: loc.map((m) => m.x[0]), y: loc.map((m) => m.f),
      marker: { symbol: 'triangle-down', size: 9, color: 'rgba(0,0,0,0)', line: { color: C.minima, width: 1.4 } },
      hovertemplate: '국소 최솟값 f=%{y:.5g}<extra></extra>',
    });
  }
  const g = prob.reference.all;
  traces.push({
    type: 'scatter', mode: 'markers', name: '전역 최솟값 (기준)', x: g.map((p) => p[0]), y: g.map(() => prob.reference.f),
    marker: { symbol: 'star', size: 15, color: C.global, line: { color: '#000', width: 1 } },
    hovertemplate: `전역 최솟값 f*=${fmt(prob.reference.f, 6)}<extra></extra>`,
  });
  return {
    traces,
    layout: layout({
      xaxis: { title: { text: axisName(prob, 0) }, range: [prob.bounds[0][0], prob.bounds[0][1]] },
      yaxis: { title: { text: prob.col_names ? `f (${prob.col_names[1]})` : 'f' }, type: opts.log && prob.f_stats.min > 0 ? 'log' : 'linear' },  // a log axis would hide f ≤ 0
      shapes,
    }),
  };
}

// ── search paths ────────────────────────────────────────────────────
// run: /api/run result. Returns traces for the 2-D landscape or the 1-D curve.
export function pathTraces(prob, run, color, name, { markers = true, width = 2, visible = true, legendgroup } = {}) {
  const P = run.path.x;
  const two = prob.dim === 2;
  const xs = P.map((p) => p[0]);
  const ys = two ? P.map((p) => p[1]) : run.path.f;
  const out = [{
    type: 'scatter', mode: markers ? 'lines+markers' : 'lines', name, x: xs, y: ys, visible,
    legendgroup: legendgroup || name, customdata: run.path.f,
    line: { color, width }, marker: { size: 4, color },
    hovertemplate: `${name}<br>%{x:.4g}${two ? ', %{y:.4g}' : ''}<br>f=%{customdata:.5g}<extra></extra>`,
  }];
  const end = P[P.length - 1];
  out.push({
    type: 'scatter', mode: 'markers', x: [end[0]], y: [two ? end[1] : run.f], showlegend: false, visible,
    legendgroup: legendgroup || name, hovertemplate: `${name} 끝<br>f=${fmt(run.f, 6)}<extra></extra>`,
    marker: { symbol: 'x', size: 12, color, line: { color: '#000', width: 1 } },
  });
  if (run.x0) {
    out.push({
      type: 'scatter', mode: 'markers', x: [run.x0[0]], y: [two ? run.x0[1] : run.path.f[0]], showlegend: false,
      visible, legendgroup: legendgroup || name, hovertemplate: '시작점<extra></extra>',
      marker: { symbol: 'circle', size: 10, color: 'rgba(0,0,0,0)', line: { color, width: 2 } },
    });
  }
  return out;
}

// Make clicks on a landscape plot pick a start point.
export function onPick(el, handler) {
  el.removeAllListeners?.('plotly_click');
  el.on('plotly_click', (ev) => {
    const p = ev.points?.[0];
    if (!p) return;
    handler(p.x, p.y);
  });
}
