// "시계열" and "주파수" tabs.
import { fmt, fmtInt, isNum } from './format.js';
import { drawCorr, drawDfa, drawFft, drawPsd, drawSegments, drawStft, drawTs } from './tsplots.js';
import { kpiHtml, setNote, tableHtml } from './ui.js';

const $ = (id) => document.getElementById(id);
const pFmt = (p) => (!isNum(p) ? '—' : p < 1e-4 ? '< 0.0001' : fmt(p, 3));
const badge = (bad, yes, no) => (bad ? `<span class="badge badge-bad">${yes}</span>` : `<span class="badge badge-ok">${no}</span>`);
const left = (html) => ({ html, cls: 'left' });

export function tsParams() {
  return {
    window: Number($('ts-window').value) || null,
    lags: Number($('ts-lags').value) || null,
    segments: Number($('ts-segments').value) || 10,
  };
}

export function specParams() {
  return {
    detrend: $('spec-detrend').value,
    nperseg: $('spec-nperseg').value || null,
    spec_nperseg: $('spec-stft').value || null,
  };
}

// ── time series ─────────────────────────────────────────────────────
export function renderTs(ts) {
  const fs = ts.fs;
  const tUnit = fs === 1 ? '샘플' : 's';
  const tr = ts.trend;
  const corr = ts.correlation;
  $('ts-window').placeholder = String(ts.rolling.window);
  $('ts-lags').placeholder = String(corr.lags.length - 1);
  $('ts-kpis').innerHTML = kpiHtml([
    ['추세 기울기', `${fmt(tr.slope, 4)} /${tUnit}`, `± ${fmt(tr.stderr, 2)} (SE)`],
    ['추세 R²', fmt(tr.r2, 3), `전체 구간 변화 ${fmt(tr.change, 4)}`],
    ['lag-1 자기상관', fmt(corr.acf[1], 3), corr.decorrelation_lag ? `${corr.decorrelation_lag} 시차 뒤 무상관 수준` : '시차 범위 안에서 계속 상관'],
    ['DFA α', ts.dfa.alpha === null ? '—' : fmt(ts.dfa.alpha, 3), ts.dfa.hurst === null ? '' : `Hurst H ≈ ${fmt(ts.dfa.hurst, 3)}`],
  ]);
  drawTs($('plot-ts'), ts, { band: $('ts-band').checked, trend: $('ts-trend-show').checked });

  const st = ts.stationarity;
  const rows = [];
  for (const lb of corr.ljung_box) {
    rows.push([`Ljung–Box Q(${lb.lag})`, fmt(lb.stat, 5), pFmt(lb.p), badge(lb.p < 0.05, '자기상관 있음', '독립 가정 유지'),
      left(`H0: 시차 1~${lb.lag} 의 자기상관이 모두 0`)]);
  }
  const rn = ts.runs;
  rows.push(['런 검정 (중앙값 기준)', fmt(rn.z, 4), pFmt(rn.p), badge(rn.p < 0.05, '무작위 아님', '무작위 가정 유지'),
    left(rn.runs === null ? '값이 한쪽에만 있음' : `런 ${fmtInt(rn.runs)}개 (무작위면 ${fmt(rn.expected, 5)}). 적으면 뭉침(추세·양의 상관), 많으면 교대(음의 상관)`)]);
  if (st.adf) {
    rows.push(['ADF', fmt(st.adf.stat, 4), pFmt(st.adf.p), badge(st.adf.p >= 0.05, '단위근 의심 (비정상)', '정상 (단위근 기각)'),
      left(`H0: 단위근이 있다(랜덤워크형). 시차 ${st.adf.lag}, 5% 임계값 ${fmt(st.adf.crit5, 4)}`)]);
    rows.push(['KPSS (수준)', fmt(st.kpss.stat, 4), st.kpss.p <= 0.01 ? '≤ 0.01' : st.kpss.p >= 0.1 ? '≥ 0.1' : pFmt(st.kpss.p),
      badge(st.kpss.p < 0.05, '비정상', '정상 가정 유지'),
      left(`H0: 정상이다 — ADF 와 반대 방향. p 는 표 범위 0.01~0.1 로 잘림. 5% 임계값 ${fmt(st.kpss.crit5, 4)}`)]);
  }
  rows.push(['추세 기울기 t 검정', fmt(tr.slope, 4), pFmt(tr.p), badge(tr.p < 0.05, '추세 있음', '추세 유의하지 않음'),
    left('H0: 기울기 = 0 (잔차 독립 가정 — 자기상관이 크면 p 가 과소평가됨)')]);
  const seg = ts.segments;
  if (seg.anova_p !== null) {
    rows.push([`구간 평균 같음 (ANOVA, ${seg.k}구간)`, '', pFmt(seg.anova_p), badge(seg.anova_p < 0.05, '평균이 변함', '평균 일정'),
      left(`구간 평균의 최대 차 ${fmt(seg.mean_spread, 4)}`)]);
    rows.push(['구간 분산 같음 (Levene)', '', pFmt(seg.levene_p), badge(seg.levene_p < 0.05, '변동성이 변함', '변동성 일정'),
      left(`구간 표준편차 최대/최소 ${fmt(seg.std_ratio, 4)}`)]);
  }
  $('ts-tests').innerHTML = tableHtml(['검정', '통계량', 'p 값', '판정', '설명'], rows.map((cells) => ({ cells })), -1, -1);

  const notes = [];
  if (st.adf) {
    const adfStat = st.adf.p < 0.05;
    const kpssStat = st.kpss.p >= 0.05;
    notes.push(adfStat && kpssStat ? 'ADF·KPSS 모두 정상 시계열로 판단합니다.'
      : !adfStat && !kpssStat ? 'ADF·KPSS 모두 비정상(랜덤워크·추세형)으로 판단합니다 — 차분하거나 증분으로 보고 분석하는 편이 맞습니다.'
        : 'ADF 와 KPSS 의 판단이 엇갈립니다 — 추세 정상, 장기 기억, 또는 표본이 짧은 경우에 흔합니다.');
  }
  if (corr.acf[1] > 0.3) notes.push('자기상관이 커서 표본들이 독립이 아닙니다 — 평균의 표준오차·신뢰구간(개요 탭)은 실제보다 좁게 나옵니다.');
  if (st.note) notes.push(`ADF·KPSS: ${st.note}`);
  if (ts.dfa.note) notes.push(`DFA: ${ts.dfa.note}`);
  setNote($('ts-note'), notes);
  $('ts-note').classList.remove('warn');

  drawCorr($('plot-acf'), corr, 'acf');
  drawCorr($('plot-pacf'), corr, 'pacf');
  drawSegments($('plot-seg'), seg);
  drawDfa($('plot-dfa'), ts.dfa);
}

export function redrawTsMain(ts) {
  drawTs($('plot-ts'), ts, { band: $('ts-band').checked, trend: $('ts-trend-show').checked });
}

// ── frequency ───────────────────────────────────────────────────────
export function renderSpec(spec, meta) {
  const hz = spec.fs !== 1;
  const fU = hz ? 'Hz' : 'cycles/sample';
  const tU = hz ? 's' : '샘플';
  const d = spec.descriptors;
  const top = spec.peaks[0];
  $('spec-kpis').innerHTML = kpiHtml([
    ['가장 강한 주기 성분', top ? `${fmt(top.f, 5)} ${fU}` : '없음', top ? `주기 ${fmt(top.period, 4)} ${tU} · 진폭 ${fmt(top.amp, 4)}` : ''],
    ['스펙트럼 중심', `${fmt(d.centroid, 4)} ${fU}`, `대역폭 ${fmt(d.bandwidth, 4)}`],
    ['스펙트럼 엔트로피', fmt(d.entropy, 3), '1 = 백색잡음, 0 에 가까우면 몇 개의 선'],
    ['주파수 해상도 Δf', `${fmt(spec.df, 4)} ${fU}`, `Nyquist ${fmt(spec.nyquist, 4)} ${fU}`],
  ]);
  const notes = [];
  if (!hz) {
    notes.push(meta.source === 'synthetic'
      ? 'fs = 1 이라 주파수 단위가 cycles/sample 입니다. 합성 데이터의 fs 는 "시계열 성분"에서 정합니다.'
      : 'fs 를 모르는 상태(1)라 주파수 단위가 cycles/sample 입니다. 왼쪽 "현재 데이터"에서 fs 나 시간 열을 지정하세요.');
  }
  if (meta.fs_note) notes.push(meta.fs_note);
  if (spec.fft.decimated) notes.push(`스펙트럼 점이 많아 구간별 최댓값으로 줄여 그렸습니다 (봉우리는 유지).`);
  setNote($('spec-note'), notes);

  drawFft($('plot-fft'), spec, $('spec-log').checked);
  drawPsd($('plot-psd'), spec);
  $('psd-note').textContent = `구간 길이 ${fmtInt(spec.welch.nperseg)} · ${fmtInt(spec.welch.segments)}개 구간 평균 (50% 겹침) — 분산이 작은 대신 해상도 ${fmt(spec.fs / spec.welch.nperseg, 4)} ${fU}`;
  $('peaks-table').innerHTML = tableHtml(['#', `주파수 [${fU}]`, `주기 [${tU}]`, '진폭', '파워 비율'],
    spec.peaks.map((p, i) => ({
      cells: [String(i + 1), fmt(p.f, 6), fmt(p.period, 5), fmt(p.amp, 4), isNum(p.power_frac) ? `${fmt(p.power_frac * 100, 3)}%` : '—'],
    })), -1, -1);
  if (!spec.peaks.length) $('peaks-table').innerHTML += '<tbody><tr><td colspan="5" class="left">뚜렷한 봉우리가 없습니다</td></tr></tbody>';
  $('desc-table').innerHTML = tableHtml(['지표', '값', '뜻'], [
    ['중앙 주파수', `${fmt(d.median_freq, 4)} ${fU}`, left('파워의 절반이 이 아래')],
    ['85% roll-off', `${fmt(d.rolloff85, 4)} ${fU}`, left('파워의 85% 가 이 아래')],
    ['PSD 최대 주파수', `${fmt(d.peak_freq, 4)} ${fU}`, left('Welch PSD 기준')],
    ['스펙트럼 평탄도', fmt(d.flatness, 3), left('기하평균/산술평균: 1 백색잡음, 0 순음')],
  ].map((cells) => ({ cells })), -1, -1);
  drawStft($('plot-stft'), spec);
}

export function redrawFft(spec) {
  drawFft($('plot-fft'), spec, $('spec-log').checked);
}
