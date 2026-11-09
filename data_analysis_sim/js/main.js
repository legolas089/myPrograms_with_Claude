import { call, ensureBackend } from './api.js';
import { diff, fmt, fmtInt, fmtTheory, isNum } from './format.js';
import { renderFit, wireFit } from './fit.js';
import { drawBox, drawDensity, drawSeries, resizeAll } from './plots.js';
import { renderDrawdown, renderRisk } from './risk.js';
import {
  redrawFft, redrawTsMain, renderSpec, renderTs, specParams, tsParams,
} from './ts.js';
import { escapeHtml, tableHtml } from './ui.js';

const $ = (id) => document.getElementById(id);
const el = {
  status: $('backend-status'),
  distSelect: $('dist-select'), distNote: $('dist-note'), params: $('param-fields'),
  n: $('n-input'), seed: $('seed-input'), dice: $('dice-btn'), gen: $('gen-btn'),
  tsFs: $('ts-fs'), tsTrend: $('ts-trend'), tsPhi: $('ts-phi'), tsRw: $('ts-rw'), sines: $('sine-rows'),
  drop: $('drop-zone'), file: $('file-input'), paste: $('paste-input'), pasteBtn: $('paste-btn'),
  card: $('dataset-card'), colField: $('column-field'), colSelect: $('column-select'), info: $('dataset-info'),
  empty: $('empty'), error: $('error'), overview: $('tab-overview'),
  kpis: $('kpis'), bwMethod: $('bw-method'), bwScale: $('bw-scale'), bwScaleVal: $('bw-scale-val'),
  bwH: $('bw-h'), showHist: $('show-hist'), showKde: $('show-kde'), showTrue: $('show-true'),
  viewMode: $('view-mode'), viewNote: $('view-note'),
  plotDensity: $('plot-density'), plotBox: $('plot-box'), plotSeries: $('plot-series'),
  seriesNote: $('series-note'),
  statsTable: $('stats-table'), momentsTable: $('moments-table'), pctTable: $('pct-table'),
};

const SINES = 3;
const STORE_KEY = 'data_analysis_sim.settings';
const state = {
  dists: [], paramValues: {}, dataset: null, column: null, result: null, densitySeq: 0,
  tab: 'overview',
  tabData: {}, // lazily loaded results per tab
  tabKeys: {}, // dataset + column + tab inputs each result was computed for
};

// Endpoint and renderer of each lazily loaded tab.
// params(): extra request fields; a change in them refetches the tab.
const TABS = {
  risk: { path: '/api/risk', render: (d) => renderRisk(d, state.result) },
  fit: { path: '/api/fit', render: (d) => renderFit(d, state.result, trueParamText()) },
  ts: { path: '/api/timeseries', params: tsParams, render: (d) => renderTs(d) },
  spec: { path: '/api/spectral', params: specParams, render: (d) => renderSpec(d, state.dataset.meta) },
};

// ── settings memory (per-viewer convenience only) ───────────────────
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      dist: el.distSelect.value, params: state.paramValues, n: el.n.value, seed: el.seed.value,
    }));
  } catch { /* storage blocked */ }
}

// ── errors / busy ───────────────────────────────────────────────────
function showError(msg) {
  el.error.textContent = msg;
  el.error.classList.toggle('hidden', !msg);
}
async function busy(btn, fn) {
  btn.disabled = true;
  showError('');
  try { await fn(); } catch (e) { showError(e.message); } finally { btn.disabled = false; }
}

// ── synthetic-data form ─────────────────────────────────────────────
function buildDistForm(saved) {
  el.distSelect.innerHTML = state.dists.map((d) => `<option value="${d.key}">${d.label}</option>`).join('');
  state.paramValues = saved.params || {};
  if (saved.dist && state.dists.some((d) => d.key === saved.dist)) el.distSelect.value = saved.dist;
  if (saved.n) el.n.value = saved.n;
  if (saved.seed) el.seed.value = saved.seed;
  renderParams();
  el.sines.innerHTML = Array.from({ length: SINES }, (_, i) => `
    <div class="sine-row">
      <span class="hint">#${i + 1}</span>
      <input type="number" step="any" min="0" data-sine="freq" data-i="${i}" placeholder="${[5, 12, 30][i]}">
      <input type="number" step="any" data-sine="amp" data-i="${i}" placeholder="0">
    </div>`).join('');
}

function currentDist() {
  return state.dists.find((d) => d.key === el.distSelect.value);
}

function renderParams() {
  const d = currentDist();
  const vals = state.paramValues[d.key] || {};
  el.params.innerHTML = d.params.map((p) => `
    <label class="field"><span>${p.label}</span>
      <input type="number" data-param="${p.key}" step="${p.step}" value="${vals[p.key] ?? p.default}">
    </label>`).join('');
  el.distNote.textContent = d.note ? `⚠ ${d.note}` : '';
  el.distNote.className = d.note ? 'note warn' : 'note hidden';
}

function readParams() {
  const d = currentDist();
  const out = {};
  for (const input of el.params.querySelectorAll('[data-param]')) {
    out[input.dataset.param] = Number(input.value);
  }
  state.paramValues[d.key] = out;
  return out;
}

function readTs() {
  const sines = [];
  for (let i = 0; i < SINES; i++) {
    const f = el.sines.querySelector(`[data-sine=freq][data-i="${i}"]`).value;
    const a = el.sines.querySelector(`[data-sine=amp][data-i="${i}"]`).value;
    if (Number(a)) sines.push({ freq: Number(f) || 0, amp: Number(a) });
  }
  return {
    fs: Number(el.tsFs.value) || 1,
    trend: Number(el.tsTrend.value) || 0,
    ar_phi: Number(el.tsPhi.value) || 0,
    random_walk: el.tsRw.checked,
    sines,
  };
}

async function generate() {
  const n = Number(el.n.value);
  if (!Number.isInteger(n) || n < 2) throw new Error('샘플 수 N 은 2 이상의 정수여야 합니다');
  const reply = await call('/api/generate', {
    json: { dist: el.distSelect.value, params: readParams(), n, seed: Number(el.seed.value), ts: readTs() },
  });
  saveSettings();
  await setDataset(reply);
}

// ── user data ───────────────────────────────────────────────────────
async function uploadBytes(body, filename) {
  const reply = await call(`/api/upload?filename=${encodeURIComponent(filename)}`, { body });
  await setDataset(reply);
}

function wireUpload() {
  const send = (file) => busy(el.pasteBtn, async () => uploadBytes(await file.arrayBuffer(), file.name));
  el.file.addEventListener('change', () => el.file.files[0] && send(el.file.files[0]));
  el.drop.addEventListener('dragover', (e) => { e.preventDefault(); el.drop.classList.add('over'); });
  el.drop.addEventListener('dragleave', () => el.drop.classList.remove('over'));
  el.drop.addEventListener('drop', (e) => {
    e.preventDefault();
    el.drop.classList.remove('over');
    if (e.dataTransfer.files[0]) send(e.dataTransfer.files[0]);
  });
  el.pasteBtn.addEventListener('click', () => busy(el.pasteBtn, async () => {
    if (!el.paste.value.trim()) throw new Error('붙여넣은 데이터가 없습니다');
    await uploadBytes(new Blob([el.paste.value], { type: 'text/plain' }), '');
  }));
}

// ── dataset card ────────────────────────────────────────────────────
async function setDataset(reply) {
  state.dataset = reply;
  state.column = reply.columns[0].name;
  el.colSelect.innerHTML = reply.columns
    .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} (N=${fmtInt(c.n)})</option>`).join('');
  el.colField.classList.toggle('hidden', reply.columns.length < 2);
  renderFsField();
  renderInfo();
  el.card.classList.remove('hidden');
  await analyze();
}

// "k=2, θ=1" — parameter symbols are the first word of each catalog label.
function paramText(m) {
  const d = state.dists.find((x) => x.key === m.dist);
  const labels = Object.fromEntries(d.params.map((p) => [p.key, p.label.split(' ')[0]]));
  return Object.entries(m.params).map(([k, v]) => `${labels[k]}=${fmt(v)}`).join(', ');
}

function trueParamText() {
  const m = state.dataset.meta;
  return m.source === 'synthetic' && !m.ts_active ? paramText(m) : '';
}

function renderInfo() {
  const m = state.dataset.meta;
  const col = state.dataset.columns.find((c) => c.name === state.column);
  const rows = [];
  if (m.source === 'synthetic') {
    rows.push(['출처', '합성 데이터'], ['분포', m.dist_label], ['파라미터', paramText(m)],
      ['N', fmtInt(m.n)], ['seed', String(m.seed)]);
    const ts = [];
    if (m.ts.ar_phi) ts.push(`AR(1) φ=${fmt(m.ts.ar_phi)}`);
    if (m.ts.random_walk) ts.push('랜덤워크');
    if (m.ts.trend) ts.push(`추세 ${fmt(m.ts.trend)}/s`);
    for (const s of m.ts.sines) ts.push(`사인 ${fmt(s.freq)} Hz × ${fmt(s.amp)}`);
    rows.push(['fs', `${fmt(m.fs)} Hz`], ['시계열 성분', ts.length ? ts.join(', ') : '없음 (i.i.d.)']);
  } else {
    rows.push(['출처', escapeHtml(m.filename)], ['열', escapeHtml(state.column)], ['N', fmtInt(col.n)],
      ['fs', m.time_column ? `${fmt(m.fs, 6)} Hz (시간 열 '${escapeHtml(m.time_column)}')` : m.fs === 1 ? '1 (모름 — 샘플 단위)' : `${fmt(m.fs)} Hz`]);
  }
  el.info.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// Uploaded data: sampling rate typed in, or taken from a time column.
function renderFsField() {
  const m = state.dataset.meta;
  const upload = m.source !== 'synthetic';
  $('fs-field').classList.toggle('hidden', !upload);
  if (!upload) return;
  $('fs-input').value = m.time_column ? '' : (m.fs === 1 ? '' : m.fs);
  $('fs-input').placeholder = m.time_column ? `${fmt(m.fs, 6)} (시간 열)` : '1';
  $('fs-time-col').innerHTML = '<option value="">시간 열 없음</option>'
    + state.dataset.columns.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
  $('fs-time-col').value = m.time_column || '';
  const note = $('fs-note');
  note.textContent = m.fs_note || '';
  note.className = m.fs_note ? 'note warn' : 'note hidden';
}

async function applyFs() {
  const tcol = $('fs-time-col').value;
  const body = { dataset_id: state.dataset.dataset_id };
  if (tcol) body.time_column = tcol;
  else body.fs = Number($('fs-input').value) || 1;
  const r = await call('/api/set_fs', { json: body });
  state.dataset.meta = r.meta;
  renderFsField();
  renderInfo();
  await analyze();
}

// ── analysis ────────────────────────────────────────────────────────
function kdeOptions() {
  return {
    dataset_id: state.dataset.dataset_id, column: state.column,
    kde: { method: el.bwMethod.value, scale: 2 ** Number(el.bwScale.value) },
    view: el.viewMode.value,
  };
}

async function analyze() {
  const r = await call('/api/analyze', { json: kdeOptions() });
  // A KDE on integer data only draws ripples between the integers: off by default.
  if (!state.result || state.result.density.discrete !== r.density.discrete) {
    el.showKde.checked = !r.density.discrete;
  }
  state.result = r;
  state.tabData = {};
  state.tabKeys = {};
  el.empty.classList.add('hidden');
  renderKpis();
  renderDensity();
  renderTables();
  const fs = r.meta.fs || 1;
  drawSeries(el.plotSeries, r.series, fs);
  el.seriesNote.textContent = r.series.decimated
    ? `N이 커서 구간별 최솟값·최댓값 ${fmtInt(r.series.t.length)}점으로 줄여 표시` : '';
  await showTab(state.tab);
}

// ── tabs ────────────────────────────────────────────────────────────
async function showTab(name) {
  state.tab = name;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (!state.result) return;
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${name}`));
  const pane = $(`tab-${name}`);
  const tab = TABS[name];
  if (tab) {
    const extra = tab.params ? tab.params() : {};
    const key = JSON.stringify([state.dataset.dataset_id, state.column, extra]);
    if (state.tabKeys[name] !== key) {
      const loading = pane.querySelector('[data-loading]');
      loading.classList.remove('hidden');
      try {
        const data = await call(tab.path, { json: { dataset_id: state.dataset.dataset_id, column: state.column, ...extra } });
        const now = JSON.stringify([state.dataset.dataset_id, state.column, tab.params ? tab.params() : {}]);
        if (key !== now) return; // inputs changed meanwhile; the newer request renders
        state.tabData[name] = data;
        state.tabKeys[name] = key;
      } catch (e) {
        showError(e.message);
        return;
      } finally {
        loading.classList.add('hidden');
      }
    }
    if (state.tab === name) tab.render(state.tabData[name]);
  }
  resizeAll(pane);
}

async function refreshDensity() {
  if (!state.result) return;
  const seq = ++state.densitySeq;
  try {
    const r = await call('/api/density', { json: kdeOptions() });
    if (seq !== state.densitySeq) return; // a newer request is in flight
    showError('');
    state.result.density = r.density;
    state.result.mode = r.mode;
    renderDensity();
    renderKpis();
    renderTables();
  } catch (e) {
    showError(e.message);
  }
}

let densityTimer = null;
function scheduleDensity() {
  el.bwScaleVal.textContent = `×${(2 ** Number(el.bwScale.value)).toFixed(2)}`;
  clearTimeout(densityTimer);
  densityTimer = setTimeout(refreshDensity, 120);
}

function renderDensity() {
  const { density: d, summary: s, box, meta } = state.result;
  const xr = drawDensity(el.plotDensity, d, s, {
    hist: el.showHist.checked, kde: el.showKde.checked, true: el.showTrue.checked,
  });
  drawBox(el.plotBox, box, xr);
  el.bwH.textContent = `h = ${fmt(d.kde.h, 4)}`;
  el.showTrue.parentElement.classList.toggle('hidden', !d.true);
  const notes = [];
  if (d.view.clipped) {
    notes.push(`꼬리가 길어 Q1−6·IQR ~ Q3+6·IQR 구간만 표시합니다 — 데이터 ${fmtInt(d.view.n_outside)}개`
      + ` (${(d.view.frac_outside * 100).toFixed(2)}%)가 화면 밖. 범위를 '전체'로 바꾸면 모두 봅니다.`);
  }
  if (meta.source === 'synthetic' && meta.ts_active) {
    notes.push('시계열 성분이 더해져 기저 분포와 달라졌으므로 이론값·참 분포는 표시하지 않습니다.');
  }
  if (meta.note) notes.push(`⚠ ${meta.note}`);
  el.viewNote.textContent = notes.join('\n');
  el.viewNote.className = notes.length ? 'note warn' : 'note hidden';
  el.viewNote.style.whiteSpace = 'pre-line';
}

function renderKpis() {
  const { summary: s, theory: t, mode, density } = state.result;
  const items = [
    ['N', fmtInt(s.n), null],
    ['평균', fmt(s.mean), t && fmtTheory(t.mean)],
    ['표준편차', fmt(s.std), t && fmtTheory(t.std)],
    ['왜도', fmt(s.skew, 4), t && fmtTheory(t.skew)],
    ['초과첨도', fmt(s.exkurt, 4), t && fmtTheory(t.exkurt)],
    [density.discrete ? '최빈값' : '최빈값 (KDE 봉우리)', fmt(mode), null],
  ];
  el.kpis.innerHTML = items.map(([k, v, th]) => `
    <div class="kpi"><div class="k">${k}</div><div class="v">${v}</div>
    ${th !== null && th !== undefined ? `<div class="t">이론 ${th}</div>` : ''}</div>`).join('');
}

function renderTables() {
  const { summary: s, theory: t, mode, density } = state.result;
  const hasT = !!t;
  const row = (label, est, th, tip) => ({
    cells: hasT ? [label, fmt(est), th === undefined ? '' : fmtTheory(th), th === undefined ? '' : diff(est, th)]
      : [label, fmt(est)],
    tip,
  });
  const head = hasT ? ['항목', '표본', '이론', '차이'] : ['항목', '표본'];
  const pm = (v, se) => (isNum(se) ? `${fmt(v, 4)} <span class="sub">± ${fmt(se, 2)} (SE)</span>` : fmt(v, 4));
  const rows = [
    { group: '위치' },
    row('평균', s.mean, t?.mean),
    { cells: hasT ? ['평균 95% CI', `${fmt(s.ci95_low)} ~ ${fmt(s.ci95_high)}`,
      '', isNum(t.mean) ? (t.mean >= s.ci95_low && t.mean <= s.ci95_high ? '이론값 포함' : '이론값 밖') : '']
      : ['평균 95% CI', `${fmt(s.ci95_low)} ~ ${fmt(s.ci95_high)}`], tip: 't 분포 기반' },
    row('중앙값', s.median, t?.median),
    row(density.discrete ? '최빈값' : '최빈값 (KDE 봉우리)', mode),
    row('10% 절사평균', s.trim_mean_10, undefined, '위·아래 10%씩 버린 평균'),
    row('기하평균', s.geo_mean, undefined, '모든 값이 양수일 때만'),
    row('조화평균', s.harm_mean, undefined, '모든 값이 양수일 때만'),
    { group: '산포' },
    row('분산 (불편, N−1)', s.var, t?.var),
    row('표준편차', s.std, t?.std),
    row('평균의 표준오차 SEM', s.sem, undefined, 'σ / √N'),
    row('최솟값', s.min), row('최댓값', s.max), row('범위', s.range),
    row('Q1 (25%)', s.q1, t?.q1), row('Q3 (75%)', s.q3, t?.q3), row('IQR', s.iqr, t?.iqr),
    row('MAD (중앙값 절대편차)', s.mad, undefined, 'median(|x − median|)'),
    row('MAD × 1.4826', s.mad_sigma, undefined, '정규분포라면 σ 와 같아지는 강건한 산포'),
    row('평균절대편차', s.mean_abs_dev, undefined, 'mean(|x − mean|)'),
    row('변동계수 CV', s.cv, undefined, '표준편차 / |평균|'),
    { group: '모양' },
    { cells: hasT ? ['왜도 G1 (보정)', pm(s.skew, s.se_skew), fmtTheory(t.skew), diff(s.skew, t.skew)]
      : ['왜도 G1 (보정)', pm(s.skew, s.se_skew)], tip: 'pandas·Excel 과 같은 표본 보정 왜도' },
    row('왜도 g1 (m3/m2^1.5)', s.skew_g1, t?.skew),
    { cells: hasT ? ['초과첨도 G2 (보정)', pm(s.exkurt, s.se_kurt), fmtTheory(t.exkurt), diff(s.exkurt, t.exkurt)]
      : ['초과첨도 G2 (보정)', pm(s.exkurt, s.se_kurt)], tip: '정규분포 = 0. pandas·Excel 과 같은 보정값' },
    row('초과첨도 g2 (m4/m2²−3)', s.exkurt_g2, t?.exkurt),
    { cells: hasT ? ['KDE 봉우리 수', String(density.kde.n_peaks), '', ''] : ['KDE 봉우리 수', String(density.kde.n_peaks)],
      tip: '높이 2% 이상 돌출된 극대점 수 (대역폭에 따라 달라짐)' },
  ];
  el.statsTable.innerHTML = tableHtml(head, rows);

  // moments
  const cm = s.central_moments;
  const thCentral = hasT && isNum(t.var) ? [0, t.var,
    isNum(t.skew) ? t.skew * t.var ** 1.5 : null,
    isNum(t.exkurt) ? (t.exkurt + 3) * t.var ** 2 : null] : null;
  const mHead = ['k', '원점 E[Xᵏ]', '중심 E[(X−μ)ᵏ]', ...(hasT ? ['중심 이론'] : [])];
  el.momentsTable.innerHTML = tableHtml(mHead, [1, 2, 3, 4].map((k) => ({
    cells: [String(k), fmt(s.raw_moments[k - 1]), fmt(cm[k - 1]),
      ...(hasT ? [thCentral ? fmtTheory(thCentral[k - 1]) : '정의 안 됨'] : [])],
  })), 3, -1);

  // percentiles
  const keys = Object.keys(s.percentiles);
  el.pctTable.innerHTML = tableHtml(head, keys.map((p) => ({
    cells: hasT ? [`${p}%`, fmt(s.percentiles[p]), fmtTheory(t.percentiles[p]), diff(s.percentiles[p], t.percentiles[p])]
      : [`${p}%`, fmt(s.percentiles[p])],
  })));
}

// ── wiring ──────────────────────────────────────────────────────────
function wire() {
  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    $('src-synth').classList.toggle('hidden', b.dataset.src !== 'synth');
    $('src-upload').classList.toggle('hidden', b.dataset.src !== 'upload');
  }));
  el.distSelect.addEventListener('change', () => { renderParams(); saveSettings(); });
  el.params.addEventListener('change', () => { readParams(); saveSettings(); });
  $('n-chips').addEventListener('click', (e) => {
    if (e.target.dataset.n) el.n.value = e.target.dataset.n;
  });
  el.gen.addEventListener('click', () => busy(el.gen, generate));
  el.dice.addEventListener('click', () => {
    el.seed.value = Math.floor(Math.random() * 2 ** 32);
    busy(el.gen, generate);
  });
  $('src-synth').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') busy(el.gen, generate);
  });
  el.colSelect.addEventListener('change', () => {
    state.column = el.colSelect.value;
    renderInfo();
    busy(el.gen, analyze);
  });
  el.bwScale.addEventListener('input', scheduleDensity);
  el.bwMethod.addEventListener('change', scheduleDensity);
  el.viewMode.addEventListener('change', scheduleDensity);
  for (const c of [el.showHist, el.showKde, el.showTrue]) {
    c.addEventListener('change', () => state.result && renderDensity());
  }
  wireUpload();
  document.querySelectorAll('.tab[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  const rerenderRisk = () => state.tabData.risk && renderRisk(state.tabData.risk, state.result);
  $('risk-level').addEventListener('change', rerenderRisk);
  $('risk-side').addEventListener('change', rerenderRisk);
  $('dd-mode').addEventListener('change', () => state.tabData.risk && renderDrawdown(state.tabData.risk));
  wireFit();
  const reloadTab = () => busy(el.gen, () => showTab(state.tab));
  for (const id of ['ts-window', 'ts-lags', 'ts-segments', 'spec-detrend', 'spec-nperseg', 'spec-stft']) {
    $(id).addEventListener('change', reloadTab);
  }
  for (const id of ['ts-band', 'ts-trend-show']) {
    $(id).addEventListener('change', () => state.tabData.ts && redrawTsMain(state.tabData.ts));
  }
  $('spec-log').addEventListener('change', () => state.tabData.spec && redrawFft(state.tabData.spec));
  $('fs-apply').addEventListener('click', () => busy(el.gen, applyFs));
  $('fs-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') busy(el.gen, applyFs); });
}

async function init() {
  wire();
  if (!(await ensureBackend(el.status))) return;
  try {
    const { distributions } = await call('/api/distributions');
    state.dists = distributions;
    buildDistForm(loadSettings());
    await busy(el.gen, generate); // show something right away
  } catch (e) {
    showError(e.message);
  }
}

init();
