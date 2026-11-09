// Charts for the time-series and frequency tabs.
/* global Plotly */
import { C, CONFIG, layout } from './plots.js';

const AX = { gridcolor: C.grid, zerolinecolor: '#444' };
const timeTitle = (fs) => (fs === 1 ? '샘플 번호' : '시간 [s]');
export const freqTitle = (fs) => (fs === 1 ? '주파수 [cycles/sample]' : '주파수 [Hz]');

export function drawTs(el, ts, show) {
  const { series, rolling, trend, fs } = ts;
  // SVG, not WebGL: WebGL traces always paint above SVG ones and would hide the rolling mean
  const traces = [{ type: 'scatter', mode: 'lines', name: '값', x: series.t, y: series.y,
    line: { color: 'rgba(160,175,200,0.3)', width: 1 } }];
  if (show.band) {
    traces.push(
      { type: 'scatter', mode: 'lines', x: rolling.t, y: rolling.mean.map((m, i) => m + rolling.std[i]),
        line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
      { type: 'scatter', mode: 'lines', name: '이동평균 ± 1σ', x: rolling.t, y: rolling.mean.map((m, i) => m - rolling.std[i]),
        line: { width: 0 }, fill: 'tonexty', fillcolor: 'rgba(78,161,255,0.18)', hoverinfo: 'skip' },
    );
  }
  traces.push({ type: 'scatter', mode: 'lines', name: `이동평균 (창 ${rolling.window})`, x: rolling.t, y: rolling.mean,
    line: { color: C.kde, width: 2 } });
  if (show.trend) {
    traces.push({ type: 'scatter', mode: 'lines', name: '선형 추세', x: trend.line.t, y: trend.line.y,
      line: { color: C.true, width: 2, dash: 'dash' } });
  }
  Plotly.react(el, traces, layout({
    xaxis: { ...AX, title: { text: timeTitle(fs) } }, yaxis: { ...AX }, hovermode: 'x',
  }), CONFIG);
}

function stems(lags, vals, color) {
  const x = [];
  const y = [];
  lags.forEach((l, i) => { x.push(l, l, null); y.push(0, vals[i], null); });
  return [
    { type: 'scatter', mode: 'lines', x, y, line: { color, width: 2 }, hoverinfo: 'skip', showlegend: false },
    { type: 'scatter', mode: 'markers', x: lags, y: vals, marker: { color, size: 5 },
      hovertemplate: '시차 %{x}<br>%{y:.4f}<extra></extra>', showlegend: false },
  ];
}

export function drawCorr(el, corr, which) {
  const lags = corr.lags.slice(1);
  const vals = (which === 'acf' ? corr.acf : corr.pacf).slice(1);
  const traces = [];
  if (which === 'acf') {
    const band = corr.acf_band.slice(1);
    traces.push(
      { type: 'scatter', mode: 'lines', x: lags, y: band, line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
      { type: 'scatter', mode: 'lines', x: lags, y: band.map((b) => -b), line: { width: 0 }, fill: 'tonexty',
        fillcolor: 'rgba(78,161,255,0.15)', hoverinfo: 'skip', showlegend: false },
    );
  }
  traces.push(...stems(lags, vals, which === 'acf' ? C.kde : C.mean));
  const w = corr.white_band;
  Plotly.react(el, traces, layout({
    xaxis: { ...AX, title: { text: '시차 (샘플)' } }, yaxis: { ...AX, range: [-1.05, 1.05] },
    shapes: [w, -w].map((y) => ({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: y, y1: y,
      line: { color: '#888', width: 1, dash: 'dot' } })),
    hovermode: 'closest',
  }), CONFIG);
}

export function drawSegments(el, seg) {
  const tm = seg.rows.map((r) => r.tm);
  Plotly.react(el, [
    { type: 'scatter', mode: 'lines+markers', name: '평균 ± 표준편차', x: tm, y: seg.rows.map((r) => r.mean),
      error_y: { type: 'data', array: seg.rows.map((r) => r.std), color: 'rgba(78,161,255,0.6)', thickness: 1.2 },
      line: { color: C.kde }, marker: { size: 6 } },
    { type: 'scatter', mode: 'lines+markers', name: '왜도', x: tm, y: seg.rows.map((r) => r.skew), yaxis: 'y2',
      line: { color: C.true, dash: 'dot' }, marker: { size: 5 } },
    { type: 'scatter', mode: 'lines+markers', name: '초과첨도', x: tm, y: seg.rows.map((r) => r.exkurt), yaxis: 'y2',
      line: { color: C.median, dash: 'dot' }, marker: { size: 5 } },
  ], layout({
    xaxis: { ...AX, title: { text: '구간 중앙 위치' } },
    yaxis: { ...AX, title: { text: '평균 ± σ' } },
    yaxis2: { overlaying: 'y', side: 'right', showgrid: false, zerolinecolor: '#555', title: { text: '왜도·첨도' } },
    margin: { l: 56, r: 56, t: 30, b: 40 },
  }), CONFIG);
}

export function drawDfa(el, dfa) {
  if (dfa.alpha === null) {
    Plotly.react(el, [], layout({
      xaxis: { visible: false }, yaxis: { visible: false },
      annotations: [{ text: '데이터가 너무 짧거나 값이 모두 같아 계산하지 않았습니다', showarrow: false,
        xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, font: { color: C.text } }],
    }), CONFIG);
    return;
  }
  Plotly.react(el, [
    { type: 'scatter', mode: 'markers', name: 'F(s)', x: dfa.scales, y: dfa.fluct, marker: { color: C.kde, size: 7 } },
    { type: 'scatter', mode: 'lines', name: `기울기 α = ${dfa.alpha.toFixed(3)}`, x: dfa.scales, y: dfa.fit,
      line: { color: C.true, dash: 'dash' } },
  ], layout({
    xaxis: { ...AX, type: 'log', title: { text: '창 크기 s (샘플)' } },
    yaxis: { ...AX, type: 'log', title: { text: 'F(s)' } },
    hovermode: 'closest',
  }), CONFIG);
}

// ── frequency ───────────────────────────────────────────────────────
export function drawFft(el, spec, logY) {
  // label only clear lines; small bumps would pile their labels on top of each other
  const big = Math.max(0, ...spec.peaks.map((p) => p.amp));
  const pk = spec.peaks.filter((p) => p.amp >= 0.1 * big);
  Plotly.react(el, [
    { type: 'scattergl', mode: 'lines', name: '진폭', x: spec.fft.f, y: spec.fft.amp, line: { color: C.kde, width: 1 },
      hovertemplate: 'f=%{x:.5g}<br>진폭 %{y:.4g}<extra></extra>' },
    { type: 'scatter', mode: 'markers+text', name: '주요 주파수', x: pk.map((p) => p.f), y: pk.map((p) => p.amp),
      text: pk.map((p) => p.f.toPrecision(4)), textposition: 'top center', textfont: { color: C.true, size: 11 },
      marker: { color: C.true, size: 8, symbol: 'triangle-down' }, hoverinfo: 'skip' },
  ], layout({
    xaxis: { ...AX, title: { text: freqTitle(spec.fs) }, range: [0, spec.nyquist] },
    yaxis: { ...AX, type: logY ? 'log' : 'linear', title: { text: '진폭' } },
    hovermode: 'closest', showlegend: false, margin: { l: 56, r: 16, t: 20, b: 40 },
  }), CONFIG);
}

export function drawPsd(el, spec) {
  const { f, psd } = spec.welch;
  Plotly.react(el, [{ type: 'scatter', mode: 'lines', x: f.slice(1), y: psd.slice(1), line: { color: C.mean, width: 1.5 },
    hovertemplate: 'f=%{x:.5g}<br>PSD %{y:.4g}<extra></extra>' }], layout({
    xaxis: { ...AX, title: { text: freqTitle(spec.fs) } },
    yaxis: { ...AX, type: 'log', title: { text: spec.fs === 1 ? 'PSD [단위²/(cycles/sample)]' : 'PSD [단위²/Hz]' } },
    hovermode: 'closest', showlegend: false,
  }), CONFIG);
}

export function drawStft(el, spec) {
  const s = spec.spectrogram;
  const flat = s.db.flat().filter(Number.isFinite).sort((a, b) => a - b);
  const zmin = flat[Math.floor(flat.length * 0.02)];  // clip the deepest 2% so the colours show structure
  const zmax = flat[flat.length - 1];
  Plotly.react(el, [{ type: 'heatmap', x: s.t, y: s.f, z: s.db, zmin, zmax, colorscale: 'Viridis',
    colorbar: { title: { text: 'dB', side: 'right' }, thickness: 12, tickfont: { color: C.text } },
    hovertemplate: 't=%{x:.4g}<br>f=%{y:.4g}<br>%{z:.1f} dB<extra></extra>' }], layout({
    xaxis: { ...AX, title: { text: timeTitle(spec.fs) } },
    yaxis: { ...AX, title: { text: freqTitle(spec.fs) } },
    hovermode: 'closest', margin: { l: 56, r: 16, t: 10, b: 40 },
  }), CONFIG);
}
