// Plotly chart builders (dark theme shared with the other programs).
/* global Plotly */
import { fmt } from './format.js';

export const C = {
  hist: 'rgba(140, 160, 190, 0.45)',
  kde: '#4ea1ff',
  true: '#f0a050',
  mean: '#8fe0a2',
  median: '#d0a0ff',
  grid: '#333',
  text: '#ccc',
};

export const CONFIG = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d'] };

export function layout(extra = {}) {
  return {
    paper_bgcolor: '#262626',
    plot_bgcolor: '#262626',
    font: { family: 'Segoe UI, Malgun Gothic, sans-serif', size: 12, color: C.text },
    margin: { l: 56, r: 16, t: 10, b: 36 },
    xaxis: { gridcolor: C.grid, zerolinecolor: '#444' },
    yaxis: { gridcolor: C.grid, zerolinecolor: '#444' },
    // above the plot; Plotly grows the top margin to fit however many rows it wraps to
    legend: { orientation: 'h', x: 0, xanchor: 'left', y: 1.02, yanchor: 'bottom', bgcolor: 'rgba(0,0,0,0)' },
    hovermode: 'x unified',
    ...extra,
  };
}

export function vline(x, color, dash) {
  return { type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1, line: { color, width: 1.5, dash } };
}

// Legend-only trace so a vertical marker line gets a legend entry.
function legendLine(name, color, dash, x) {
  return { type: 'scatter', mode: 'lines', name: `${name} ${fmt(x)}`, x: [null], y: [null],
    line: { color, width: 1.5, dash }, hoverinfo: 'skip' };
}

// density: /api/density result; stats: {mean, median}; show: {hist, kde, true}
export function drawDensity(el, density, stats, show) {
  const { hist, kde, discrete } = density;
  const traces = [];
  const centers = hist.edges.slice(0, -1).map((e, i) => (e + hist.edges[i + 1]) / 2);
  const widths = hist.edges.slice(0, -1).map((e, i) => hist.edges[i + 1] - e);
  if (show.hist) {
    traces.push({
      type: 'bar', name: discrete ? '상대도수' : '히스토그램', x: centers, y: hist.density,
      width: discrete ? widths.map((w) => w * 0.8) : widths, marker: { color: C.hist, line: { width: 0 } },
      hovertemplate: '%{y:.4g}',
    });
  }
  if (show.kde) {
    traces.push({
      type: 'scatter', mode: 'lines', name: `KDE (h=${kde.h.toPrecision(3)})`, x: kde.x, y: kde.y,
      line: { color: C.kde, width: 2 }, hovertemplate: '%{y:.4g}',
    });
  }
  if (show.true && density.true) {
    traces.push(discrete
      ? { type: 'scatter', mode: 'markers', name: '참 PMF', x: density.true.x, y: density.true.y,
        marker: { color: C.true, size: 7, symbol: 'diamond' }, hovertemplate: '%{y:.4g}' }
      : { type: 'scatter', mode: 'lines', name: '참 PDF', x: density.true.x, y: density.true.y,
        line: { color: C.true, width: 1.8, dash: 'dash' }, hovertemplate: '%{y:.4g}' });
  }
  const shapes = [];
  if (Number.isFinite(stats.mean) && stats.mean >= density.view.lo && stats.mean <= density.view.hi) {
    shapes.push(vline(stats.mean, C.mean, 'solid'));
    traces.push(legendLine('평균', C.mean, 'solid', stats.mean));
  }
  shapes.push(vline(stats.median, C.median, 'dot'));
  traces.push(legendLine('중앙값', C.median, 'dot', stats.median));
  const xr = [Math.min(kde.x[0], density.view.lo), Math.max(kde.x[kde.x.length - 1], density.view.hi)];
  Plotly.react(el, traces, layout({
    bargap: 0,
    xaxis: { gridcolor: C.grid, zerolinecolor: '#444', range: xr },
    yaxis: { gridcolor: C.grid, zerolinecolor: '#444', title: { text: discrete ? '확률' : '밀도' }, rangemode: 'tozero' },
    shapes,
    margin: { l: 56, r: 16, t: 30, b: 36 },
  }), CONFIG);
  return xr;
}

export function drawBox(el, box, xr) {
  const trace = {
    type: 'box', orientation: 'h', name: '', y: [''],
    q1: [box.q1], median: [box.median], q3: [box.q3], mean: [box.mean],
    lowerfence: [box.lowerfence], upperfence: [box.upperfence],
    boxmean: true, fillcolor: 'rgba(78,161,255,0.25)', line: { color: C.kde }, hoverinfo: 'x',
  };
  Plotly.react(el, [trace], layout({
    margin: { l: 56, r: 16, t: 4, b: 30 },
    xaxis: { gridcolor: C.grid, zerolinecolor: '#444', range: xr },
    yaxis: { showticklabels: false, gridcolor: C.grid },
    showlegend: false, hovermode: 'closest',
  }), CONFIG);
}

export function drawSeries(el, series, fs) {
  Plotly.react(el, [{
    type: 'scattergl', mode: 'lines', x: series.t, y: series.y, name: '값',
    line: { color: C.kde, width: 1 }, hovertemplate: 't=%{x:.4g}<br>%{y:.4g}<extra></extra>',
  }], layout({
    xaxis: { gridcolor: C.grid, zerolinecolor: '#444', title: { text: fs === 1 ? '샘플 번호' : '시간 [s]' } },
    yaxis: { gridcolor: C.grid, zerolinecolor: '#444' },
    showlegend: false, hovermode: 'closest',
  }), CONFIG);
}

// ── risk tab ────────────────────────────────────────────────────────
export const FAMILY_COLORS = ['#4ea1ff', '#f0a050', '#8fe0a2', '#d0a0ff', '#f08f8f', '#7fd8d8', '#e0d070', '#b0b0b0'];
const LEFT = '#f08f8f';
const RIGHT = '#f0a050';

// Density with the chosen tail(s) shaded; VaR dashed, CVaR solid.
export function drawRisk(el, density, row, side) {
  const { kde, hist, discrete } = density;
  const traces = [];
  const shapes = [];
  const tails = side === 'both' ? ['left', 'right'] : [side];
  if (discrete) {
    const centers = hist.edges.slice(0, -1).map((e, i) => (e + hist.edges[i + 1]) / 2);
    const colorOf = (x) => {
      if (tails.includes('left') && x <= row.left.var) return LEFT;
      if (tails.includes('right') && x >= row.right.var) return RIGHT;
      return C.hist;
    };
    traces.push({ type: 'bar', name: '상대도수', x: centers, y: hist.density, width: 0.8,
      marker: { color: centers.map(colorOf) }, hovertemplate: '%{y:.4g}' });
  } else {
    traces.push({ type: 'scatter', mode: 'lines', name: 'KDE', x: kde.x, y: kde.y,
      line: { color: C.kde, width: 1.6 }, hovertemplate: '%{y:.4g}' });
    for (const t of tails) {
      const v = row[t].var;
      const idx = kde.x.map((x, i) => i).filter((i) => (t === 'left' ? kde.x[i] <= v : kde.x[i] >= v));
      traces.push({
        type: 'scatter', mode: 'lines', name: t === 'left' ? '왼쪽 꼬리' : '오른쪽 꼬리',
        x: idx.map((i) => kde.x[i]), y: idx.map((i) => kde.y[i]), fill: 'tozeroy',
        line: { color: t === 'left' ? LEFT : RIGHT, width: 0 },
        fillcolor: t === 'left' ? 'rgba(240,143,143,0.45)' : 'rgba(240,160,80,0.45)', hoverinfo: 'skip',
        showlegend: false,
      });
    }
  }
  for (const t of tails) {
    const color = t === 'left' ? LEFT : RIGHT;
    const name = t === 'left' ? '왼쪽' : '오른쪽';
    for (const [key, dash, label] of [['var', 'dash', 'VaR'], ['cvar', 'solid', 'CVaR']]) {
      const x = row[t][key];
      if (typeof x !== 'number' || x < density.view.lo || x > density.view.hi) continue;
      shapes.push(vline(x, color, dash));
      traces.push(legendLine(`${name} ${label}`, color, dash, x));
    }
  }
  const xr = [Math.min(kde.x[0], density.view.lo), Math.max(kde.x[kde.x.length - 1], density.view.hi)];
  Plotly.react(el, traces, layout({
    bargap: 0,
    xaxis: { gridcolor: C.grid, zerolinecolor: '#444', range: xr },
    yaxis: { gridcolor: C.grid, zerolinecolor: '#444', title: { text: discrete ? '확률' : '밀도' }, rangemode: 'tozero' },
    shapes, margin: { l: 56, r: 16, t: 30, b: 36 },
  }), CONFIG);
}

export function drawDrawdown(el, dd, fs) {
  const traces = [
    { type: 'scattergl', mode: 'lines', name: '값', x: dd.series.t, y: dd.series.y, line: { color: C.kde, width: 1 } },
    { type: 'scattergl', mode: 'lines', name: '누적 최고점', x: dd.peak.t, y: dd.peak.y,
      line: { color: C.mean, width: 1, dash: 'dot' } },
    { type: 'scatter', mode: 'lines', name: '낙폭', x: dd.dd.t, y: dd.dd.y, fill: 'tozeroy', yaxis: 'y2',
      line: { color: LEFT, width: 1 }, fillcolor: 'rgba(240,143,143,0.3)' },
  ];
  const pts = [[dd.peak_t, '고점', C.mean], [dd.trough_t, '저점', LEFT]];
  if (dd.recovery_t !== null) pts.push([dd.recovery_t, '회복', C.true]);
  const shapes = pts.map(([x, , color]) => ({
    type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1, line: { color, width: 1, dash: 'dash' },
  }));
  const annotations = pts.map(([x, label, color]) => ({
    x, xref: 'x', yref: 'paper', y: 1, yanchor: 'bottom', text: label, showarrow: false, font: { color, size: 11 },
  }));
  Plotly.react(el, traces, layout({
    xaxis: { gridcolor: C.grid, zerolinecolor: '#444', title: { text: fs === 1 ? '샘플 번호' : '시간 [s]' }, anchor: 'y2' },
    yaxis: { gridcolor: C.grid, zerolinecolor: '#444', domain: [0.36, 1], title: { text: '값' } },
    yaxis2: { gridcolor: C.grid, zerolinecolor: '#444', domain: [0, 0.28], title: { text: '낙폭' } },
    shapes, annotations, hovermode: 'x', margin: { l: 56, r: 16, t: 30, b: 40 },
  }), CONFIG);
}

// ── fit tab ─────────────────────────────────────────────────────────
export function drawFitPdf(el, fit, density, chosen, colorOf) {
  const { hist } = density;
  const centers = hist.edges.slice(0, -1).map((e, i) => (e + hist.edges[i + 1]) / 2);
  const widths = hist.edges.slice(0, -1).map((e, i) => hist.edges[i + 1] - e);
  const traces = [{
    type: 'bar', name: fit.discrete ? '상대도수' : '히스토그램', x: centers, y: hist.density,
    width: fit.discrete ? widths.map((w) => w * 0.8) : widths, marker: { color: C.hist }, hovertemplate: '%{y:.4g}',
  }];
  for (const f of fit.families) {
    if (!chosen.has(f.key)) continue;
    traces.push({
      type: 'scatter', mode: fit.discrete ? 'lines+markers' : 'lines', name: f.label,
      x: fit.curves.x, y: fit.curves.pdf[f.key], line: { color: colorOf(f.key), width: 2 },
      marker: { size: 5 }, hovertemplate: '%{y:.4g}',
    });
  }
  Plotly.react(el, traces, layout({
    bargap: 0,
    xaxis: { gridcolor: C.grid, zerolinecolor: '#444', range: [fit.view.lo, fit.view.hi] },
    yaxis: { gridcolor: C.grid, zerolinecolor: '#444', title: { text: fit.discrete ? '확률' : '밀도' }, rangemode: 'tozero' },
    margin: { l: 56, r: 16, t: 30, b: 36 },
  }), CONFIG);
}

export function drawQQ(el, fit, key, color) {
  const th = fit.qq.theory[key];
  const xs = [];
  const ys = [];
  th.forEach((t, i) => {
    const s = fit.qq.sample[i];
    if (Number.isFinite(t) && Number.isFinite(s)) { xs.push(t); ys.push(s); }
  });
  const lo = Math.min(...xs, ...ys);
  const hi = Math.max(...xs, ...ys);
  Plotly.react(el, [
    { type: 'scatter', mode: 'lines', name: 'y = x', x: [lo, hi], y: [lo, hi],
      line: { color: '#666', dash: 'dash', width: 1 }, hoverinfo: 'skip' },
    { type: 'scattergl', mode: 'markers', name: '분위수', x: xs, y: ys, marker: { color, size: 4 },
      hovertemplate: '이론 %{x:.4g}<br>표본 %{y:.4g}<extra></extra>' },
  ], layout({
    xaxis: { gridcolor: C.grid, zerolinecolor: '#444', title: { text: '이론 분위수' } },
    yaxis: { gridcolor: C.grid, zerolinecolor: '#444', title: { text: '표본 분위수' } },
    showlegend: false, hovermode: 'closest',
  }), CONFIG);
}

export function drawEcdf(el, fit, chosen, colorOf) {
  const traces = [{
    type: 'scattergl', mode: 'lines', name: 'ECDF', x: fit.ecdf.x, y: fit.ecdf.y,
    line: { color: '#ddd', width: 1.5, shape: 'hv' },
  }];
  for (const f of fit.families) {
    if (!chosen.has(f.key)) continue;
    traces.push({
      type: 'scatter', mode: 'lines', name: f.label, x: fit.curves.x, y: fit.curves.cdf[f.key],
      line: { color: colorOf(f.key), width: 1.6, dash: 'dash', shape: fit.discrete ? 'hv' : 'linear' },
    });
  }
  Plotly.react(el, traces, layout({
    xaxis: { gridcolor: C.grid, zerolinecolor: '#444', range: [fit.view.lo, fit.view.hi] },
    yaxis: { gridcolor: C.grid, zerolinecolor: '#444', range: [0, 1.02], title: { text: 'F(x)' } },
  }), CONFIG);
}

export function resizeAll(container) {
  container.querySelectorAll('.js-plotly-plot').forEach((p) => Plotly.Plots.resize(p));
}
