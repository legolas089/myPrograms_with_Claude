// "리스크·꼬리" tab: VaR / CVaR, tail heaviness, outliers, drawdown.
import { fmt, fmtInt, fmtTheory, isNum } from './format.js';
import { drawDrawdown, drawRisk } from './plots.js';
import { kpiHtml, setNote, tableHtml } from './ui.js';

const $ = (id) => document.getElementById(id);
const SIDE = { left: '왼쪽', right: '오른쪽' };
const pctLabel = (c) => `${+(c * 100).toFixed(1)}%`;

// risk: /api/risk result; overview: /api/analyze result (density, summary)
export function renderRisk(risk, overview) {
  const row = risk.levels[Number($('risk-level').value)];
  const side = $('risk-side').value;
  const tails = side === 'both' ? ['left', 'right'] : [side];
  const hasT = row.left.var_theory !== undefined;
  const lvl = pctLabel(row.level);

  const items = [];
  for (const t of tails) {
    const r = row[t];
    items.push([`${SIDE[t]} VaR ${lvl}`, fmt(r.var), hasT ? `이론 ${fmtTheory(r.var_theory)}` : `꼬리 표본 ${fmtInt(r.n_tail)}개`]);
    items.push([`${SIDE[t]} CVaR ${lvl}`, fmt(r.cvar), hasT ? `이론 ${fmtTheory(r.cvar_theory)}` : '꼬리 평균']);
  }
  $('risk-kpis').innerHTML = kpiHtml(items);
  drawRisk($('plot-risk'), overview.density, row, side);

  const notes = [];
  const { lo, hi } = overview.density.view;
  for (const t of tails) {
    if (row[t].cvar < lo || row[t].cvar > hi) notes.push(`${SIDE[t]} CVaR (${fmt(row[t].cvar)}) 가 그래프 범위 밖에 있습니다.`);
    if (row[t].cvar_theory === 'inf' || row[t].cvar_theory === '-inf') {
      notes.push(`${SIDE[t]} 꼬리는 평균이 존재하지 않아 이론 CVaR 이 무한대입니다 — 표본 CVaR 은 N 을 늘릴수록 계속 커집니다.`);
    }
  }
  setNote($('risk-note'), notes);

  // all levels
  const cell = (v, th) => (hasT ? `${fmt(v)}<span class="sub th">이론 ${fmtTheory(th)}</span>` : fmt(v));
  $('risk-table').innerHTML = tableHtml(
    ['신뢰수준', '꼬리확률 α', '왼쪽 VaR', '왼쪽 CVaR', '오른쪽 VaR', '오른쪽 CVaR', '꼬리 표본 수 (왼/오)'],
    risk.levels.map((r) => ({
      cls: r === row ? 'best' : '',
      cells: [pctLabel(r.level), fmt(r.alpha, 3), cell(r.left.var, r.left.var_theory), cell(r.left.cvar, r.left.cvar_theory),
        cell(r.right.var, r.right.var_theory), cell(r.right.cvar, r.right.cvar_theory),
        `${fmtInt(r.left.n_tail)} / ${fmtInt(r.right.n_tail)}`],
    })), -1, -1);

  // tail heaviness
  const s = overview.summary;
  const p = s.percentiles;
  const hill = risk.hill;
  const hillTxt = (a) => (a === null ? '—' : fmt(a, 3));
  const ratio = (num, den) => (den > 0 ? fmt(num / den, 3) : '—');
  $('tail-table').innerHTML = tableHtml(['지표', '왼쪽 꼬리', '오른쪽 꼬리', '정규분포 기준'], [
    { cells: [`Hill 꼬리지수 α (k=${fmtInt(hill.k)})`, hillTxt(hill.left), hillTxt(hill.right), '∞ (N 과 함께 커짐)'],
      tip: '중앙값에서 가장 먼 k=√N 개로 추정. 작을수록 두꺼운 꼬리: α ≤ 2 분산 무한, α ≤ 4 첨도 무한. 파레토 α, t 분포 ν, 코시 1' },
    { cells: [`(CVaR−중앙값)/(VaR−중앙값) @${lvl}`, fmt(row.left.shape, 4), fmt(row.right.shape, 4), fmt(row.normal_shape, 4)],
      tip: 'VaR 너머로 꼬리가 얼마나 더 뻗는지. 위치·척도와 무관, 정규보다 크면 두꺼운 꼬리' },
    { cells: ['꼬리 폭 50%→95% (중앙값~5%/95% 분위수)', fmt(p['50'] - p['5']), fmt(p['95'] - p['50']),
      `오른쪽/왼쪽 = ${ratio(p['95'] - p['50'], p['50'] - p['5'])} (정규 1)`], tip: '1 보다 크면 오른쪽 꼬리가 더 길다' },
    { cells: ['꼬리 폭 50%→99%', fmt(p['50'] - p['1']), fmt(p['99'] - p['50']),
      `오른쪽/왼쪽 = ${ratio(p['99'] - p['50'], p['50'] - p['1'])} (정규 1)`] },
  ], -1, -1);

  // outliers
  const o = risk.outliers;
  $('outlier-table').innerHTML = tableHtml(['규칙', '정상 범위', '아래', '위', '비율', '정규분포 기대'],
    o.rules.map((r) => ({
      cells: [r.label, `${fmt(r.bounds[0], 4)} ~ ${fmt(r.bounds[1], 4)}`, fmtInt(r.low), fmtInt(r.high),
        `${fmt(r.frac * 100, 3)}%`, `${fmt(r.normal_frac * 100, 3)}%`],
    })), -1, -1);
  const fs = risk.fs;
  $('extreme-table').innerHTML = tableHtml(['#', fs === 1 ? '위치 (샘플)' : '위치 [s]', '값', '강건 z'],
    o.extremes.map((e, i) => ({
      cells: [String(i + 1), fs === 1 ? fmtInt(e.index) : fmt(e.t), fmt(e.value), fmt(e.robust_z, 3)],
    })), -1, -1);
  $('extreme-table').title = '강건 z = (값 − 중앙값) / (1.4826·MAD)';

  // Cumulating all-positive (or all-negative) values gives a monotone curve with no
  // drawdown, so such data start in "level" mode; mixed signs look like increments.
  if (!risk.ddModeSet) {
    $('dd-mode').value = s.min < 0 && s.max > 0 ? 'cumulative' : 'level';
    risk.ddModeSet = true;
  }
  renderDrawdown(risk);
}

export function renderDrawdown(risk) {
  const d = risk.drawdown[$('dd-mode').value];
  const fs = risk.fs;
  const unit = fs === 1 ? '샘플' : 's';
  const tm = (v) => (v === null ? '—' : `${fs === 1 ? fmtInt(v) : fmt(v)} ${unit}`);
  if (d.mdd === 0) {
    $('dd-kpis').innerHTML = kpiHtml([['최대 낙폭 MDD', '0', '낙폭 없음 — 직전 최고점 아래로 내려간 적이 없음']]);
    drawDrawdown($('plot-dd'), d, fs);
    return;
  }
  $('dd-kpis').innerHTML = kpiHtml([
    ['최대 낙폭 MDD', fmt(d.mdd), isNum(d.mdd_rel) ? `고점 대비 ${fmt(d.mdd_rel * 100, 4)}%` : '값 단위'],
    ['고점 → 저점', `${tm(d.peak_t)} → ${tm(d.trough_t)}`, `하락 기간 ${tm(d.fall_time)}`],
    ['회복', d.recovery_t === null ? '미회복' : tm(d.recovery_t),
      d.underwater_time === null ? '고점을 다시 넘지 못함' : `수중 기간 ${tm(d.underwater_time)}`],
  ]);
  drawDrawdown($('plot-dd'), d, fs);
}
