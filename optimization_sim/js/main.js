// Problem definition (sidebar), the problem/landscape tab and tab switching.
/* global Plotly */
import { call, ensureBackend } from './api.js';
import * as compare from './compare.js';
import { fmt, fmtInt } from './format.js';
import * as multi from './multi.js';
import { colorScale, CONFIG, draw, landscape, layout, onPick, resizeAll } from './plots.js';
import * as run from './run.js';
import {
  $, busy, loadSettings, pointText, saveSettings, showError, state,
} from './state.js';
import { escapeHtml, kpiHtml, setNote, tableHtml } from './ui.js';

const form = {
  src: 'function', dim: 2,
  func: { 1: 'forrester', 2: 'rosenbrock' },
  params: {},   // "key/dim" -> {p: v}
  bounds: {},   // "key/dim" -> [[lo, hi], …]
  expr: {},     // dim -> text
  dataset: null,
};

// ── sidebar: test function ─────────────────────────────────────────
function funcsFor(dim) {
  return state.functions.filter((f) => f.dim === dim);
}
function currentFunc() {
  return funcsFor(form.dim).find((f) => f.key === form.func[form.dim]) || funcsFor(form.dim)[0];
}
const fkey = (f) => `${f.key}/${f.dim}`;

function renderFuncForm() {
  document.querySelectorAll('#dim-seg .seg-btn').forEach((b) => b.classList.toggle('active', Number(b.dataset.dim) === form.dim));
  const list = funcsFor(form.dim);
  $('func-select').innerHTML = list.map((f) => `<option value="${f.key}">${escapeHtml(f.label)}</option>`).join('');
  const f = currentFunc();
  form.func[form.dim] = f.key;
  $('func-select').value = f.key;
  $('func-formula').textContent = f.formula ? `f = ${f.formula}` : '';
  $('func-note').textContent = f.note || '';
  $('func-note').className = f.note ? 'note' : 'note hidden';
  const custom = f.key === 'custom';
  $('expr-field').classList.toggle('hidden', !custom);
  if (custom) $('expr-input').value = form.expr[form.dim] ?? f.example;
  const vals = form.params[fkey(f)] || {};
  $('param-fields').innerHTML = f.params.map((p) => `
    <label class="field"><span>${escapeHtml(p.label)}</span>
      <input type="number" data-param="${p.key}" step="${p.step}" value="${vals[p.key] ?? p.default}"></label>`).join('');
  renderBounds(form.bounds[fkey(f)] || f.domain);
}

function renderBounds(b) {
  const names = ['x', 'y'];
  $('bounds-fields').innerHTML = b.map((r, i) => `
    <span class="var">${names[i]}</span><input type="number" step="any" data-b="${i}-0" value="${r[0]}">
    <span class="sep">~</span><input type="number" step="any" data-b="${i}-1" value="${r[1]}">`).join('');
}

function readFuncForm() {
  const f = currentFunc();
  const params = {};
  for (const el of $('param-fields').querySelectorAll('[data-param]')) params[el.dataset.param] = Number(el.value);
  form.params[fkey(f)] = params;
  const bounds = f.domain.map((_, i) => [0, 1].map((j) => Number($('bounds-fields').querySelector(`[data-b="${i}-${j}"]`).value)));
  form.bounds[fkey(f)] = bounds;
  if (f.key === 'custom') form.expr[form.dim] = $('expr-input').value;
  return { f, params, bounds };
}

function updateSourceUi() {
  document.querySelectorAll('#src-seg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.src === form.src));
  $('src-function').classList.toggle('hidden', form.src !== 'function');
  $('src-data').classList.toggle('hidden', form.src !== 'data');
  const samples = $('objective-mode').value === 'samples';
  $('samples-block').classList.toggle('hidden', !samples);
  $('surrogate-block').classList.toggle('hidden', !(form.src === 'data' || samples));
  $('sur-smooth-field').classList.toggle('hidden', $('sur-method').value !== 'rbf');
  $('map-y-field').classList.toggle('hidden', $('map-dim').value !== '2');
}

// ── sidebar: user data ─────────────────────────────────────────────
async function uploadBytes(body, filename) {
  const r = await call(`/api/upload?filename=${encodeURIComponent(filename)}`, { body });
  if (r.columns.length < 2) throw new Error('열이 2개 이상 필요합니다 — x, f (1차원) 또는 x, y, f (2차원)');
  form.dataset = r;
  const opts = r.columns.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} (${fmtInt(c.n)}개)</option>`).join('');
  for (const id of ['map-x', 'map-y', 'map-f']) $(id).innerHTML = opts;
  const names = r.columns.map((c) => c.name);
  const two = names.length >= 3;
  $('map-dim').value = two ? '2' : '1';
  $('map-x').value = names[0];
  $('map-y').value = names[1];
  $('map-f').value = two ? names[2] : names[1];
  $('data-name').textContent = `${r.meta.filename} · 열 ${names.length}개`;
  $('data-map').classList.remove('hidden');
  updateSourceUi();
  await buildProblem();
}

function wireUpload() {
  const drop = $('drop-zone');
  const send = (file) => busy($('paste-btn'), async () => uploadBytes(await file.arrayBuffer(), file.name));
  $('file-input').addEventListener('change', (e) => e.target.files[0] && send(e.target.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files[0]) send(e.dataTransfer.files[0]);
  });
  $('paste-btn').addEventListener('click', () => busy($('paste-btn'), async () => {
    if (!$('paste-input').value.trim()) throw new Error('붙여넣은 데이터가 없습니다');
    await uploadBytes(new Blob([$('paste-input').value], { type: 'text/plain' }), '');
  }));
}

// ── problem ─────────────────────────────────────────────────────────
function constraintsList() {
  return $('cons-input').value.split('\n').map((s) => s.trim()).filter(Boolean);
}

function readSpec() {
  const surrogate = { method: $('sur-method').value, smoothing: Number($('sur-smooth').value) || 0 };
  const constraints = constraintsList();
  if (form.src === 'data') {
    if (!form.dataset) throw new Error('먼저 데이터를 불러오세요');
    return {
      source: 'data', dataset_id: form.dataset.dataset_id, dim: Number($('map-dim').value),
      x_col: $('map-x').value, y_col: $('map-y').value, f_col: $('map-f').value, surrogate, constraints,
    };
  }
  const { f, params, bounds } = readFuncForm();
  return {
    source: 'function', dim: form.dim, func: f.key, params, bounds,
    expr: f.key === 'custom' ? $('expr-input').value : undefined,
    objective: $('objective-mode').value,
    sampling: {
      n: Number($('smp-n').value), method: $('smp-method').value,
      noise_pct: Number($('smp-noise').value) || 0, seed: Number($('smp-seed').value) || 0,
    },
    surrogate, constraints,
  };
}

function persist() {
  saveSettings({
    src: form.src, dim: form.dim, func: form.func, params: form.params, bounds: form.bounds, expr: form.expr,
    objective: $('objective-mode').value, cons: $('cons-input').value,
    sampling: { n: $('smp-n').value, method: $('smp-method').value, noise: $('smp-noise').value, seed: $('smp-seed').value },
    surrogate: { method: $('sur-method').value, smoothing: $('sur-smooth').value },
  });
}

async function buildProblem() {
  const spec = readSpec();
  const p = await call('/api/problem', { json: spec });
  persist();
  state.problem = p;
  state.x0 = p.x0_default.slice();
  // heavy right tail (Rosenbrock, Beale, …): colour on a log scale unless the user chose
  const fs = p.f_stats;
  p.skewed = fs.median - fs.min < 0.1 * (fs.max - fs.min);
  for (const id of ['land-log', 'path-log']) if (!$(id).dataset.touched) $(id).checked = p.skewed;
  renderInfo();
  $('problem-card').classList.remove('hidden');
  $('empty').classList.add('hidden');
  run.onProblem();
  compare.onProblem();
  multi.onProblem();
  showTab(state.tab);
}

function renderInfo() {
  const p = state.problem;
  const rows = [];
  if (p.source === 'data') {
    rows.push(['출처', escapeHtml(p.label)], ['식', escapeHtml(p.formula)], ['점', fmtInt(p.data.n)]);
  } else {
    rows.push(['함수', escapeHtml(p.label)]);
    const ps = Object.entries(p.params || {}).map(([k, v]) => `${k}=${fmt(v)}`).join(', ');
    if (ps) rows.push(['파라미터', ps]);
    if (p.func === 'custom') rows.push(['f', `<code>${escapeHtml(p.formula)}</code>`]);
    if (p.source === 'samples') {
      const s = p.sampling;
      rows.push(['목적', `샘플 ${fmtInt(s.n)}개 → 대리모델`], ['표본', `${s.method} · seed ${s.seed} · 잡음 ${fmt(s.noise_pct)}% (σ=${fmt(s.noise_sigma, 3)})`]);
    }
  }
  if (p.surrogate) rows.push(['대리모델', `${escapeHtml(p.surrogate.label)}${p.surrogate.method === 'rbf' ? ` · λ=${fmt(p.surrogate.smoothing)}` : ''}`]);
  rows.push(['영역', p.bounds.map((b, i) => `${p.names[i]} ∈ [${fmt(b[0])}, ${fmt(b[1])}]`).join('<br>')]);
  if (p.constraints.length) rows.push(['제약', p.constraints.map((c) => `<code>${escapeHtml(c.text)}</code>`).join('<br>')]);
  rows.push(['f*', `${fmt(p.reference.f, 6)} @ ${pointText(p.reference.x, 4)}`]);
  $('problem-info').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ── problem tab ─────────────────────────────────────────────────────
function renderProblemTab() {
  const p = state.problem;
  const surrogate = !!p.landscape.f_true;
  const kp = [
    ['전역 최솟값 f*', fmt(p.reference.f, 6), pointText(p.reference.x, 4)],
    ['전역 최솟점 수', String(p.reference.all.length), p.reference.all.length > 1 ? '같은 높이의 최솟값 여러 개' : ''],
    ['국소 최솟값', fmtInt(p.n_local_minima), p.constraints.length ? '제약 무시한 지형 기준' : ''],
    ['f 범위 (영역 안)', `${fmt(p.f_stats.min, 4)} ~ ${fmt(p.f_stats.max, 4)}`, `중앙값 ${fmt(p.f_stats.median, 4)}`],
  ];
  if (p.feasible_frac !== null && p.feasible_frac !== undefined) kp.push(['실현가능 영역', `${(p.feasible_frac * 100).toFixed(1)}%`, '박스 중 제약을 만족하는 비율']);
  if (p.surrogate) {
    kp.push(['대리모델 적합 RMSE', fmt(p.surrogate.rmse, 3), p.surrogate.noise_std !== undefined ? `추정 잡음 σ ${fmt(p.surrogate.noise_std, 3)}` : '데이터 점에서의 오차']);
  }
  if (p.true_min) {
    kp.push(['대리모델 최적점의 참 f', fmt(p.reference.f_true, 5), `참 함수 최솟값 ${fmt(p.true_min.f, 5)} @ ${pointText(p.true_min.x, 3)}`]);
  }
  $('prob-kpis').innerHTML = kpiHtml(kp);
  $('land-title').textContent = p.dim === 1 ? '목적 함수 f(x)' : '목적 함수 지형 f(x, y)';
  document.querySelectorAll('#tab-problem .dim2').forEach((e) => e.classList.toggle('hidden', p.dim !== 2));
  $('land-true-wrap').classList.toggle('hidden', !surrogate);
  $('land-true-wrap').lastChild.textContent = p.dim === 1 ? ' 참 함수' : ' 참 함수로 칠하기';
  if (p.dim === 2 && !$('land-true').dataset.touched) $('land-true').checked = false;
  $('land-data-wrap').classList.toggle('hidden', !p.data);
  setNote($('prob-notes'), p.notes.map((n) => `⚠ ${n}`));
  drawLandscape();

  // minima
  const loc = p.local_minima.slice(0, 20);
  $('minima-hint').textContent = p.n_local_minima > 20 ? `낮은 20개 / 전체 ${p.n_local_minima}개` : `${p.n_local_minima}개`;
  $('minima-table').innerHTML = tableHtml(['#', '위치', 'f', 'f − f*'],
    loc.map((m, i) => ({ cells: [String(i + 1), pointText(m.x, 5), fmt(m.f, 6), fmt(m.f - p.reference.f, 3)] })), -1, 3);

  const rows = [
    { cells: ['기준 전역 최솟점', p.reference.all.map((x) => pointText(x, 6)).join('<br>')] },
    { cells: ['f*', fmt(p.reference.f, 8)] },
    { cells: ['전역 도달 허용오차', `|f − f*| ≤ ${fmt(p.success_tol, 3)}`], tip: '1e-4 × (중앙값 − 최솟값) + 1e-9' },
  ];
  if (p.known) {
    rows.push({ cells: ['문헌 최솟점', p.known.xs.map((x) => pointText(x, 6)).join('<br>')] },
      { cells: ['문헌 f*', fmt(p.known.f, 8)] });
  }
  if (p.true_min) {
    rows.push({ cells: ['참 함수 최솟점 (격자)', pointText(p.true_min.x, 5)] },
      { cells: ['참 함수 최솟값', fmt(p.true_min.f, 6)] },
      { cells: ['대리모델 최적점의 참 f', fmt(p.reference.f_true, 6)], tip: '데이터로 만든 모델의 최솟점이 실제로 얼마나 좋은지' });
  }
  $('ref-table').innerHTML = tableHtml(['항목', '값'], rows, -1, -1);
}

function drawLandscape() {
  const p = state.problem;
  const el = $('plot-land');
  const opts = {
    log: $('land-log').checked, showData: $('land-data').checked, showMinima: $('land-minima').checked,
    useTrue: p.landscape.f_true ? $('land-true').checked : undefined,
  };
  if (p.dim === 2 && $('land-3d').checked) {
    const L = p.landscape;
    const raw = opts.useTrue && L.f_true ? L.f_true : L.f;
    const cs = colorScale(p, raw, opts.log);
    const traces = [{
      type: 'surface', x: L.axes[0], y: L.axes[1], z: cs.z, customdata: raw, colorscale: 'Viridis',
      colorbar: { title: { text: cs.title }, thickness: 12 }, hovertemplate: 'x=%{x:.4g}<br>y=%{y:.4g}<br>f=%{customdata:.5g}<extra></extra>',
      contours: { z: { show: true, usecolormap: true, project: { z: true }, width: 1 } },
    }];
    const g = p.reference.all;
    traces.push({ type: 'scatter3d', mode: 'markers', name: '전역 최솟값', x: g.map((q) => q[0]), y: g.map((q) => q[1]),
      z: g.map(() => cs.tf(p.reference.f)), marker: { size: 6, color: '#ffd84a', symbol: 'diamond' } });
    if (opts.showData && p.data) {
      traces.push({ type: 'scatter3d', mode: 'markers', name: '데이터', x: p.data.points.map((q) => q[0]),
        y: p.data.points.map((q) => q[1]), z: p.data.values.map(cs.tf), marker: { size: 2.5, color: '#fff' } });
    }
    Plotly.react(el, traces, layout({
      margin: { l: 0, r: 0, t: 0, b: 0 },
      scene: { xaxis: { title: 'x', gridcolor: '#444' }, yaxis: { title: 'y', gridcolor: '#444' }, zaxis: { title: cs.title, gridcolor: '#444' },
        bgcolor: '#262626' },
    }), CONFIG);
    return;
  }
  const { traces, layout: lay } = landscape(p, opts);
  draw(el, traces, lay).then(() => onPick(el, (x, y) => run.setX0(p.dim === 1 ? [x] : [x, y], true)));
}

// ── tabs ────────────────────────────────────────────────────────────
function showTab(name) {
  state.tab = name;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  const has = !!state.problem;
  $('empty').classList.toggle('hidden', has);
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('hidden', !has || p.id !== `tab-${name}`));
  if (!has) return;
  if (name === 'problem') renderProblemTab();
  if (name === 'run') run.show();
  if (name === 'compare') compare.show();
  if (name === 'multi') multi.show();
  resizeAll($(`tab-${name}`));
}

// ── wiring ──────────────────────────────────────────────────────────
function wire() {
  document.querySelectorAll('#src-seg .seg-btn').forEach((b) => b.addEventListener('click', () => {
    form.src = b.dataset.src;
    updateSourceUi();
  }));
  document.querySelectorAll('#dim-seg .seg-btn').forEach((b) => b.addEventListener('click', () => {
    readFuncForm();
    form.dim = Number(b.dataset.dim);
    renderFuncForm();
  }));
  $('func-select').addEventListener('change', () => {
    readFuncForm();
    form.func[form.dim] = $('func-select').value;
    renderFuncForm();
  });
  $('bounds-reset').addEventListener('click', () => {
    const f = currentFunc();
    delete form.bounds[fkey(f)];
    renderBounds(f.domain);
  });
  for (const id of ['objective-mode', 'sur-method', 'map-dim']) $(id).addEventListener('change', updateSourceUi);
  $('smp-dice').addEventListener('click', () => {
    $('smp-seed').value = Math.floor(Math.random() * 100000);
    busy($('build-btn'), buildProblem);
  });
  $('build-btn').addEventListener('click', () => busy($('build-btn'), buildProblem));
  document.querySelector('.sidebar').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') busy($('build-btn'), buildProblem);
  });
  wireUpload();
  document.querySelectorAll('.tab[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('path-log').addEventListener('change', () => { $('path-log').dataset.touched = '1'; });
  for (const id of ['land-log', 'land-3d', 'land-data', 'land-minima', 'land-true']) {
    $(id).addEventListener('change', () => {
      if (id === 'land-true' || id === 'land-log') $(id).dataset.touched = '1';
      if (state.problem) drawLandscape();
    });
  }
}

function restore(s) {
  if (s.src) form.src = s.src;
  if (s.dim) form.dim = s.dim;
  Object.assign(form.func, s.func || {});
  Object.assign(form.params, s.params || {});
  Object.assign(form.bounds, s.bounds || {});
  Object.assign(form.expr, s.expr || {});
  if (s.objective) $('objective-mode').value = s.objective;
  if (s.cons) {
    $('cons-input').value = s.cons;
    $('cons-details').open = true;
  }
  const sm = s.sampling || {};
  if (sm.n) $('smp-n').value = sm.n;
  if (sm.method) $('smp-method').value = sm.method;
  if (sm.noise !== undefined) $('smp-noise').value = sm.noise;
  if (sm.seed !== undefined) $('smp-seed').value = sm.seed;
  const su = s.surrogate || {};
  if (su.method) $('sur-method').value = su.method;
  if (su.smoothing !== undefined) $('sur-smooth').value = su.smoothing;
  if (form.src === 'data') form.src = 'function'; // the dataset itself is not kept
}

async function init() {
  wire();
  if (!(await ensureBackend($('backend-status')))) return;
  try {
    const cat = await call('/api/catalog');
    state.functions = cat.functions;
    state.algos = cat.algorithms;
    state.surrogates = cat.surrogates;
    $('sur-method').innerHTML = cat.surrogates.map((s) => `<option value="${s.key}">${escapeHtml(s.label)}</option>`).join('');
    const saved = loadSettings();
    restore(saved);
    renderFuncForm();
    updateSourceUi();
    run.init(saved);
    compare.init(saved);
    multi.init(saved);
    await busy($('build-btn'), buildProblem);
  } catch (e) {
    showError(e.message);
  }
}

export { showTab };
init();
