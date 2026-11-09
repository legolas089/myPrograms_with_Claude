// "Seed / N 테스트" tab: convergence of estimates over sample size and seeds.
/* global Plotly */
import { fmt, fmtInt, fmtTheory, isNum } from './format.js';
import { C, CONFIG, layout } from './plots.js';
import { setNote, tableHtml } from './ui.js';

const $ = (id) => document.getElementById(id);
const AX = { gridcolor: C.grid, zerolinecolor: '#444' };
let current = null;

export function parseNs(text) {
  return [...new Set(String(text).split(/[\s,;]+/).filter(Boolean).map((t) => Math.round(Number(t.replace(/k$/i, 'e3').replace(/m$/i, 'e6')))))]
    .filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
}

const errName = (s) => (s.error_kind === 'rmse' ? 'RMSE' : 'IQR');
const slopeTxt = (v) => (isNum(v) ? fmt(v, 3) : '—');

function verdictBadge(s) {
  const cls = s.verdict.startsWith('1/√N') || s.verdict.startsWith('오차 0') ? 'badge-ok'
    : s.verdict.startsWith('느리게') ? 'badge-true' : 'badge-bad';
  return `<span class="badge ${cls}">${s.verdict}</span>`;
}

export function renderSweep(res) {
  current = res;
  const ns = res.ns;
  const first = fmtInt(ns[0]);
  const last = fmtInt(ns[ns.length - 1]);
  $('sweep-table').innerHTML = tableHtml(
    ['통계량', '참값', `오차 N=${first}`, `오차 N=${last}`, '수렴 기울기', '판정'],
    res.stats.map((s) => ({
      cls: '',
      cells: [s.label, fmtTheory(s.truth), `${fmt(s.error[0], 3)} <span class="sub">${errName(s)}</span>`,
        `${fmt(s.error[ns.length - 1], 3)} <span class="sub">${errName(s)}</span>`, slopeTxt(s.slope), verdictBadge(s)],
    })), -1, -1);
  [...$('sweep-table').querySelectorAll('tbody tr')].forEach((tr, i) => { tr.dataset.key = res.stats[i].key; });

  const sel = $('sweep-stat');
  const prev = sel.value;
  sel.innerHTML = res.stats.map((s) => `<option value="${s.key}">${s.label}</option>`).join('');
  sel.value = res.stats.some((s) => s.key === prev) ? prev : 'mean';

  const notes = [];
  if (res.note) notes.push(`⚠ ${res.note}`);
  const undef = res.stats.filter((s) => !s.truth_finite).map((s) => s.label);
  if (undef.length) notes.push(`참값이 정의되지 않거나 무한대: ${undef.join(', ')} — 이 통계량들은 seed 간 IQR 로 퍼짐을 봅니다.`);
  setNote($('sweep-note'), notes);
  $('sweep-results').classList.remove('hidden');
  $('sweep-empty').classList.add('hidden');
  renderStat();
}

export function renderStat() {
  if (!current) return;
  const s = current.stats.find((x) => x.key === $('sweep-stat').value) || current.stats[0];
  const ns = current.ns;
  [...$('sweep-table').querySelectorAll('tbody tr')].forEach((tr) => tr.classList.toggle('best', tr.dataset.key === s.key));
  $('sweep-title').textContent = `추정값 경로 — ${s.label}`;
  drawPaths($('plot-sweep'), s, ns, $('sweep-paths').checked);
  drawError($('plot-sweep-err'), s, ns);
  $('sweep-detail').innerHTML = tableHtml(['N', '평균 추정', '편향', 'seed 간 표준편차', errName(s), '5% ~ 95%'],
    ns.map((n, j) => ({
      cells: [fmtInt(n), fmt(s.mean[j], 4), s.truth_finite ? fmt(s.bias[j], 3) : '—', fmt(s.spread[j], 3),
        fmt(s.error[j], 3), `${fmt(s.q05[j], 4)} ~ ${fmt(s.q95[j], 4)}`],
    })), -1, -1);
}

function drawPaths(el, s, ns, showPaths) {
  const traces = [];
  if (showPaths) {
    s.paths.forEach((p, i) => traces.push({
      type: 'scatter', mode: 'lines', x: ns, y: p, line: { color: 'rgba(160,175,200,0.28)', width: 1 },
      hoverinfo: 'skip', showlegend: i === 0, name: 'seed 별 경로',
    }));
  }
  const band = (lo, hi, color, name) => [
    { type: 'scatter', mode: 'lines', x: ns, y: hi, line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
    { type: 'scatter', mode: 'lines', x: ns, y: lo, line: { width: 0 }, fill: 'tonexty', fillcolor: color, name, hoverinfo: 'skip' },
  ];
  traces.push(...band(s.q05, s.q95, 'rgba(78,161,255,0.15)', 'seed 간 5~95%'));
  traces.push(...band(s.q25, s.q75, 'rgba(78,161,255,0.30)', 'seed 간 25~75%'));
  traces.push({ type: 'scatter', mode: 'lines+markers', name: '중앙값', x: ns, y: s.q50, line: { color: C.kde, width: 2 },
    marker: { size: 6 }, hovertemplate: 'N=%{x:,}<br>%{y:.5g}<extra></extra>' });
  const shapes = [];
  if (s.truth_finite) {
    shapes.push({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: s.truth, y1: s.truth, line: { color: C.true, width: 2, dash: 'dash' } });
    traces.push({ type: 'scatter', mode: 'lines', name: `참값 ${fmt(s.truth)}`, x: [null], y: [null], line: { color: C.true, dash: 'dash' } });
  }
  // Scale to the seed quantiles, not the paths: non-converging estimates (Cauchy mean)
  // have paths that would flatten everything else.
  let lo = Math.min(...s.q05.filter(isNum));
  let hi = Math.max(...s.q95.filter(isNum));
  if (s.truth_finite) { lo = Math.min(lo, s.truth); hi = Math.max(hi, s.truth); }
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
  Plotly.react(el, traces, layout({
    xaxis: { ...AX, type: 'log', title: { text: '샘플 수 N' } },
    yaxis: { ...AX, range: [lo - pad, hi + pad], title: { text: s.label } },
    shapes, hovermode: 'closest',
  }), CONFIG);
}

function drawError(el, s, ns) {
  const ok = ns.map((_, j) => isNum(s.error[j]) && s.error[j] > 0);
  const x = ns.filter((_, j) => ok[j]);
  const y = s.error.filter((_, j) => ok[j]);
  const traces = [{ type: 'scatter', mode: 'lines+markers', name: errName(s), x, y, line: { color: C.kde, width: 2 }, marker: { size: 7 },
    hovertemplate: 'N=%{x:,}<br>%{y:.4g}<extra></extra>' }];
  if (x.length) {
    traces.push({ type: 'scatter', mode: 'lines', name: '1/√N 기준', x, y: x.map((n) => y[0] * Math.sqrt(x[0] / n)),
      line: { color: '#888', dash: 'dot' } });
  }
  Plotly.react(el, traces, layout({
    xaxis: { ...AX, type: 'log', title: { text: '샘플 수 N' } },
    yaxis: { ...AX, type: 'log', title: { text: `${errName(s)} (seed 간)` } },
    annotations: isNum(s.slope) ? [{ xref: 'paper', yref: 'paper', x: 1, y: 1, xanchor: 'right', yanchor: 'top', showarrow: false,
      text: `기울기 ${s.slope.toFixed(3)}`, font: { color: C.true, size: 13 } }] : [],
    hovermode: 'closest',
  }), CONFIG);
}

export function wireSweep(run) {
  $('sweep-run').addEventListener('click', run);
  $('sweep-stat').addEventListener('change', renderStat);
  $('sweep-paths').addEventListener('change', renderStat);
  $('sweep-table').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-key]');
    if (!tr) return;
    $('sweep-stat').value = tr.dataset.key;
    renderStat();
  });
}
