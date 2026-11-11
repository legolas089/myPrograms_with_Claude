// Single-run tab: algorithm + options + start point, then path, convergence,
// and method-specific views (Bayesian optimisation steps, IPOPT iterations).
import { badgesHtml, fillSelect, readOptions, renderOptions } from './algos.js';
import { call } from './api.js';
import { fmt, fmtInt } from './format.js';
import {
  C, draw, landscape, layout, onPick, pathTraces, resizeAll,
} from './plots.js';
import {
  $, algoByKey, busy, pointText, reached, saveSettings, state,
} from './state.js';
import { kpiHtml, setNote } from './ui.js';

let result = null;
let playTimer = null;

export function init(saved) {
  fillSelect($('algo-select'), state.algos, saved.algo || 'BFGS');
  state.opts = saved.opts || {};
  $('algo-select').addEventListener('change', () => {
    renderAlgo();
    saveSettings({ algo: $('algo-select').value });
  });
  $('opt-fields').addEventListener('change', storeOptions);
  $('opt-reset').addEventListener('click', () => {
    delete state.opts[$('algo-select').value];
    renderAlgo();
    storeOptions();
  });
  $('x0-random').addEventListener('click', () => {
    const b = state.problem.bounds;
    setX0(b.map(([lo, hi]) => lo + Math.random() * (hi - lo)), true);
  });
  $('x0-default').addEventListener('click', () => setX0(state.problem.x0_default.slice(), true));
  $('x0-fields').addEventListener('change', () => {
    const v = [...$('x0-fields').querySelectorAll('input')].map((i) => Number(i.value));
    setX0(v, false);
  });
  $('run-btn').addEventListener('click', () => busy($('run-btn'), execute));
  $('path-evals').addEventListener('change', () => result && drawPath());
  $('path-log').addEventListener('change', () => result && drawPath());
  $('conv-y').addEventListener('change', () => result && drawConv());
  $('bo-step').addEventListener('input', () => drawBo());
  $('bo-play').addEventListener('click', togglePlay);
  renderAlgo();
}

function storeOptions() {
  const a = algoByKey($('algo-select').value);
  try {
    const o = readOptions($('opt-fields'), a);
    if (Object.keys(o).length) state.opts[a.key] = o; else delete state.opts[a.key];
    saveSettings({ opts: state.opts });
    $('run-hint').textContent = '';
  } catch (e) {
    $('run-hint').textContent = e.message;
  }
}

function renderAlgo() {
  const a = algoByKey($('algo-select').value);
  renderOptions($('opt-fields'), a, state.opts[a.key] || {});
  $('algo-desc').textContent = a.desc;
  $('algo-badges').innerHTML = badgesHtml(a, state.problem);
  $('x0-fields').closest('.field').style.opacity = a.x0 ? '' : '0.5';
  $('run-hint').textContent = a.x0 ? '' : '이 방법은 시작점을 쓰지 않습니다 (영역 전체에서 탐색).';
}

export function setX0(x, rerenderInputs) {
  const p = state.problem;
  state.x0 = x.map((v, i) => Math.min(Math.max(v, p.bounds[i][0]), p.bounds[i][1]));
  if (rerenderInputs) renderX0();
  // the start point also appears on the run tab's plot and the compare tab text
  $('cmp-x0').textContent = pointText(state.x0, 4);
  if (result && state.tab === 'run') drawPath();
}

function renderX0() {
  const p = state.problem;
  $('x0-fields').innerHTML = p.names.map((n, i) => `
    <label>${n}<input type="number" step="any" value="${Number(state.x0[i].toPrecision(6))}"></label>`).join('');
}

export function onProblem() {
  result = null;
  stopPlay();
  renderX0();
  $('cmp-x0').textContent = pointText(state.x0, 4);
  $('run-results').classList.add('hidden');
  $('run-empty').classList.remove('hidden');
  renderAlgo();
}

export function show() {
  renderAlgo();
  if (result) renderResult();
}

async function execute() {
  const a = algoByKey($('algo-select').value);
  storeOptions();
  const options = readOptions($('opt-fields'), a);
  const loading = $('tab-run').querySelector('[data-loading]');
  loading.textContent = a.key === 'optuna_gp' ? '최적화 중… (Optuna GP 는 처음 한 번 PyTorch 를 불러옵니다)' : '최적화 중…';
  loading.classList.remove('hidden');
  try {
    result = await call('/api/run', {
      json: { problem_id: state.problem.problem_id, algo: a.key, options, x0: state.x0 },
    });
  } finally {
    loading.classList.add('hidden');
  }
  stopPlay();
  renderResult();
}

function renderResult() {
  const r = result;
  const p = state.problem;
  $('run-empty').classList.add('hidden');
  $('run-results').classList.remove('hidden');
  const ok = reached(r, p.success_tol);
  const badge = ok ? '<span class="badge badge-ok">전역 도달</span>'
    : r.violation > 1e-6 ? '<span class="badge badge-bad">제약 위반</span>' : '<span class="badge badge-bad">국소/미수렴</span>';
  const kp = [
    ['최종 f', fmt(r.f, 7), pointText(r.x, 5)],
    ['f − f*', `${fmt(r.gap, 3)} ${badge}`, `영역 정규화 거리 ${fmt(r.dist, 3)}`],
    ['함수 평가', fmtInt(r.nfev), `기울기 ${fmtInt(r.njev)} · 헤시안 ${fmtInt(r.nhev)}`],
    ['반복', fmtInt(r.nit), `${(r.time * 1000).toFixed(r.time < 0.1 ? 1 : 0)} ms`],
  ];
  if (p.constraints.length) kp.push(['최대 제약 위반', fmt(r.violation, 3), r.violation <= 1e-6 ? '만족' : '위반']);
  if (r.f_true !== null && r.f_true !== undefined) kp.push(['참 함수 값', fmt(r.f_true, 6), p.true_min ? `참 최솟값 ${fmt(p.true_min.f, 5)}` : '']);
  kp.push(['솔버 판정', r.success ? '성공' : '실패/중단', r.message.length > 60 ? `${r.message.slice(0, 60)}…` : r.message]);
  $('run-kpis').innerHTML = kpiHtml(kp);
  $('run-kpis').lastElementChild.title = r.message;
  setNote($('run-notes'), r.notes.map((n) => `⚠ ${n}`));
  $('path-title').textContent = `${r.label} — ${r.path_kind === 'iterate' ? '반복점 경로' : '지금까지의 최선점 경로'}`;
  drawPath();
  drawConv();
  const bo = r.extra?.bo;
  $('bo-card').classList.toggle('hidden', !bo);
  if (bo) {
    $('bo-step').max = String(bo.snaps.length - 1);
    $('bo-step').value = '0';
    drawBo();
  }
  const ip = r.extra?.ipopt;
  $('ipopt-card').classList.toggle('hidden', !ip);
  if (ip) drawIpopt(ip);
  resizeAll($('tab-run'));
}

function drawPath() {
  const r = result;
  const p = state.problem;
  const el = $('plot-path');
  const { traces, layout: lay } = landscape(p, { log: $('path-log').checked, showData: false, showMinima: false, colorbar: false });
  const two = p.dim === 2;
  if ($('path-evals').checked && r.evals && r.evals.x.length) {
    const E = r.evals;
    traces.push({
      type: 'scatter', mode: 'markers', name: `평가점 (${fmtInt(r.nfev)}회${E.x.length < r.nfev ? `, ${fmtInt(E.x.length)}개 표시` : ''})`,
      x: E.x.map((q) => q[0]), y: two ? E.x.map((q) => q[1]) : E.f, customdata: E.idx,
      marker: { size: two ? 4 : 6, color: E.idx, colorscale: [[0, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,60,60,0.9)']],
        line: { width: 0 }, opacity: 0.75 },
      hovertemplate: '평가 #%{customdata}<extra></extra>',
    });
  }
  const st = r.extra?.stages;
  if (two && st && st.pts.length) {
    traces.push({
      type: 'scatter', mode: 'markers', name: st.label, x: st.pts.map((q) => q[0]), y: st.pts.map((q) => q[1]),
      marker: { symbol: 'diamond-open', size: 9, color: '#00e5ff', line: { width: 1.5 } }, hoverinfo: 'skip',
    });
  }
  traces.push(...pathTraces(p, r, C.path, r.path_kind === 'iterate' ? '반복점' : '최선점'));
  draw(el, traces, lay).then(() => onPick(el, (x, y) => setX0(p.dim === 1 ? [x] : [x, y], true)));
  const n = r.path.x.length;
  $('path-note').textContent = r.path_kind === 'iterate'
    ? `반복점 ${n}개 (○ 시작 · ✕ 끝). 흰→빨강 점은 함수를 계산한 모든 위치(선탐색·유한차분 포함)입니다.`
    : `전역/표본 방법은 반복점 대신 '지금까지의 최선점'이 바뀐 ${n}곳을 잇습니다. 흰→빨강 점은 평가 순서입니다.`;
}

function drawConv() {
  const r = result;
  const p = state.problem;
  const gapMode = $('conv-y').value === 'gap';
  const tiny = 1e-16;
  const tr = (v) => (gapMode ? Math.max(v - p.reference.f, tiny) : v);
  const traces = [];
  if (r.evals && r.evals.f.length && !r.curve.approx) {
    traces.push({
      type: 'scatter', mode: 'markers', name: '각 평가의 f', x: r.evals.idx, y: r.evals.f.map(tr),
      marker: { size: 3, color: 'rgba(180,180,180,0.45)' }, hovertemplate: '#%{x}: %{y:.4g}<extra></extra>',
    });
  }
  traces.push({
    type: 'scatter', mode: 'lines', name: '지금까지 최선', x: r.curve.n, y: r.curve.best.map(tr), line: { color: C.path, width: 2, shape: 'hv' },
    hovertemplate: '평가 %{x}: %{y:.5g}<extra></extra>',
  });
  const shapes = [];
  if (gapMode) {
    shapes.push({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: p.success_tol, y1: p.success_tol, line: { color: C.good, dash: 'dot', width: 1 } });
  } else {
    shapes.push({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: p.reference.f, y1: p.reference.f, line: { color: C.global, dash: 'dash', width: 1 } });
  }
  draw($('plot-conv'), traces, layout({
    xaxis: { title: { text: '함수 평가 수' }, type: 'log' },
    yaxis: { title: { text: gapMode ? 'f − f*' : 'f' }, type: gapMode ? 'log' : 'linear', exponentformat: 'power' },
    shapes,
  }));
  $('conv-note').textContent = (r.curve.approx
    ? 'CasADi 솔버는 함수 호출을 하나하나 기록할 수 없어, 반복점을 솔버 통계의 총 평가 수에 고르게 배치했습니다 (근사). '
    : '')
    + (gapMode ? `초록 점선 = 전역 도달 허용오차 ${fmt(p.success_tol, 3)}.` : '노란 점선 = 기준 전역 최솟값 f*.');
}

// ── Bayesian optimisation viewer ───────────────────────────────────
function drawBo() {
  const bo = result?.extra?.bo;
  if (!bo) return;
  const p = state.problem;
  const k = Number($('bo-step').value);
  const s = bo.snaps[k];
  const obs = result.evals.x.slice(0, s.n_obs);
  const obsF = result.evals.f.slice(0, s.n_obs);
  $('bo-step-val').textContent = `${k + 1}/${bo.snaps.length} · 관측 ${s.n_obs}개`;
  const acqName = { ei: 'EI', pi: 'PI', lcb: '−LCB' }[bo.acquisition];
  const el = $('plot-bo');
  if (p.dim === 1) {
    const xs = bo.axes[0];
    const up = s.mu.map((m, i) => m + 2 * s.sd[i]);
    const dn = s.mu.map((m, i) => m - 2 * s.sd[i]);
    const traces = [
      { type: 'scatter', mode: 'lines', x: xs, y: up, line: { width: 0 }, showlegend: false, hoverinfo: 'skip' },
      { type: 'scatter', mode: 'lines', x: xs, y: dn, fill: 'tonexty', fillcolor: 'rgba(78,161,255,0.18)', line: { width: 0 }, name: 'μ ± 2σ', hoverinfo: 'skip' },
      { type: 'scatter', mode: 'lines', x: p.landscape.axes[0], y: p.landscape.f, name: '목적 함수 (숨겨진 값)', line: { color: '#888', dash: 'dot', width: 1.2 } },
      { type: 'scatter', mode: 'lines', x: xs, y: s.mu, name: 'GP 평균 μ', line: { color: C.accent, width: 2 } },
      { type: 'scatter', mode: 'markers', x: obs.map((q) => q[0]), y: obsF, name: '관측',
        marker: { color: obs.map((_, i) => (i < bo.n_init ? '#fff' : C.path)), size: 7, line: { color: '#000', width: 1 } } },
      { type: 'scatter', mode: 'lines', x: xs, y: s.acq, name: `획득함수 ${acqName}`, xaxis: 'x', yaxis: 'y2', line: { color: C.good, width: 1.8 } },
    ];
    const shapes = [];
    if (s.next) {
      shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: s.next[0], x1: s.next[0], y0: 0, y1: 1, line: { color: C.global, dash: 'dash', width: 1.5 } });
    }
    draw(el, traces, layout({
      grid: { rows: 2, columns: 1, roworder: 'top to bottom' },
      xaxis: { title: { text: 'x' }, range: [p.bounds[0][0], p.bounds[0][1]], anchor: 'y2' },
      yaxis: { title: { text: 'f' }, domain: [0.36, 1] },
      yaxis2: { title: { text: acqName }, domain: [0, 0.28], gridcolor: C.grid, zerolinecolor: '#444' },
      shapes,
    }));
  } else {
    const [xs, ys] = bo.axes;
    const panels = [['GP 평균 μ', s.mu, 'Viridis'], ['GP 표준편차 σ', s.sd, 'Cividis'], [`획득함수 ${acqName}`, s.acq, 'Hot']];
    const traces = [];
    panels.forEach(([name, z, cs], i) => {
      const ax = i === 0 ? '' : String(i + 1);
      traces.push({ type: 'heatmap', x: xs, y: ys, z, colorscale: cs, name, xaxis: `x${ax}`, yaxis: `y${ax}`, showscale: false,
        hovertemplate: `${name}: %{z:.4g}<extra></extra>` });
      traces.push({ type: 'scatter', mode: 'markers', x: obs.map((q) => q[0]), y: obs.map((q) => q[1]), xaxis: `x${ax}`, yaxis: `y${ax}`,
        showlegend: i === 0, name: '관측 (흰 = 초기 설계)',
        marker: { size: 6, color: obs.map((_, j) => (j < bo.n_init ? '#fff' : C.path)), line: { color: '#000', width: 1 } } });
      if (s.next) {
        traces.push({ type: 'scatter', mode: 'markers', x: [s.next[0]], y: [s.next[1]], xaxis: `x${ax}`, yaxis: `y${ax}`,
          showlegend: i === 0, name: '다음 평가점', marker: { symbol: 'star', size: 14, color: C.global, line: { color: '#000', width: 1 } } });
      }
    });
    const ax = (i) => ({ domain: [i / 3 + 0.01, (i + 1) / 3 - 0.02], range: [p.bounds[0][0], p.bounds[0][1]], gridcolor: C.grid, title: { text: panels[i][0] } });
    const ay = (i) => ({ range: [p.bounds[1][0], p.bounds[1][1]], gridcolor: C.grid, anchor: i === 0 ? 'x' : `x${i + 1}`, scaleanchor: undefined });
    draw(el, traces, layout({
      xaxis: ax(0), yaxis: ay(0), xaxis2: ax(1), yaxis2: ay(1), xaxis3: ax(2), yaxis3: ay(2),
      margin: { l: 46, r: 10, t: 10, b: 46 },
    }));
  }
  const info = bo.info;
  $('bo-note').textContent = `흰 점 = 초기 설계 ${bo.n_init}개, 빨간 점 = 획득함수로 고른 점, 노란 ★/점선 = 이 단계에서 고른 다음 점. `
    + `마지막 GP 길이척도 ${info.length_scale.map((v) => fmt(v, 3)).join(', ')}`
    + (info.noise_std !== undefined ? ` · 추정 잡음 σ ${fmt(info.noise_std, 3)}` : '');
}

function togglePlay() {
  if (playTimer) { stopPlay(); return; }
  const max = Number($('bo-step').max);
  if (Number($('bo-step').value) >= max) $('bo-step').value = '0';
  $('bo-play').textContent = '⏸ 정지';
  playTimer = setInterval(() => {
    const v = Number($('bo-step').value);
    if (v >= max) { stopPlay(); return; }
    $('bo-step').value = String(v + 1);
    drawBo();
  }, 700);
}
function stopPlay() {
  clearInterval(playTimer);
  playTimer = null;
  $('bo-play').textContent = '▶ 재생';
}

function drawIpopt(ip) {
  const it = ip.inf_pr.map((_, i) => i);
  const pos = (a) => a.map((v) => (v > 0 ? v : null));
  draw($('plot-ipopt'), [
    { type: 'scatter', mode: 'lines+markers', name: 'inf_pr (제약 위반)', x: it, y: pos(ip.inf_pr), line: { color: C.path } },
    { type: 'scatter', mode: 'lines+markers', name: 'inf_du (KKT 쌍대 오차)', x: it, y: pos(ip.inf_du), line: { color: C.accent } },
    { type: 'scatter', mode: 'lines+markers', name: 'μ (장벽 매개변수)', x: it, y: pos(ip.mu), line: { color: C.global, dash: 'dot' } },
  ], layout({ xaxis: { title: { text: 'IPOPT 반복' } }, yaxis: { type: 'log', exponentformat: 'power' } }));
}
