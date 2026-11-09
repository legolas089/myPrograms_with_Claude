// "분포 적합·검정" tab: normality tests, MLE fits ranked by AIC, Q-Q, ECDF.
import { fmt } from './format.js';
import { FAMILY_COLORS, drawEcdf, drawFitPdf, drawQQ } from './plots.js';
import { escapeHtml, setNote, tableHtml } from './ui.js';

const $ = (id) => document.getElementById(id);
let current = null; // { fit, overview, chosen:Set, colors:Map }

const pFmt = (p) => (p < 1e-4 ? '< 0.0001' : fmt(p, 3));
const paramTxt = (params) => params.map(([k, v]) => `${k}=${fmt(v, 4)}`).join(', ');

// trueParams: "k=2, θ=1" for untouched synthetic data, else ''
export function renderFit(fit, overview, trueParams) {
  const colors = new Map(fit.families.map((f, i) => [f.key, FAMILY_COLORS[i % FAMILY_COLORS.length]]));
  const chosen = new Set(fit.families.slice(0, 3).map((f) => f.key));
  if (fit.true_family && colors.has(fit.true_family)) chosen.add(fit.true_family);
  current = { fit, overview, chosen, colors, trueParams };

  // normality
  const nt = fit.normality;
  $('norm-table').innerHTML = tableHtml(['검정', '통계량', 'p 값', '판정', '설명'], nt.tests.map((t) => ({
    cells: [t.name, fmt(t.stat, 4), pFmt(t.p),
      t.reject ? '<span class="badge badge-bad">정규 기각</span>' : '<span class="badge badge-ok">기각 못 함</span>',
      { html: escapeHtml(t.note), cls: 'left' }],
  })), -1, -1);
  setNote($('norm-note'), nt.note);

  setNote($('fit-notes'), [
    fit.true_family ? `참 분포: ${escapeHtml(fit.families.find((f) => f.key === fit.true_family)?.label ?? fit.true_family)} (${trueParams})` : '',
    ...fit.notes,
  ]);
  $('fit-notes').classList.remove('warn');

  // Q-Q family choice: normal by default (the classic normal Q-Q plot)
  const sel = $('qq-family');
  const prev = sel.value;
  sel.innerHTML = fit.families.map((f) => `<option value="${f.key}">${escapeHtml(f.label)}</option>`).join('');
  sel.value = fit.families.some((f) => f.key === prev) ? prev
    : fit.families.some((f) => f.key === 'norm') ? 'norm' : fit.families[0]?.key;

  renderFitTable();
  redrawFit();
  redrawQQ();
}

function renderFitTable() {
  const { fit, chosen, colors } = current;
  const bestBic = Math.min(...fit.families.map((f) => f.bic));
  $('fit-table').innerHTML = tableHtml(
    ['', '순위', '분포', '파라미터 (MLE)', 'log L', 'AIC', 'ΔAIC', 'BIC', 'ΔBIC', '가중치', 'KS D (p)'],
    fit.families.map((f, i) => ({
      cls: i === 0 ? 'best' : '',
      cells: [
        `<input type="checkbox" data-fam="${f.key}" ${chosen.has(f.key) ? 'checked' : ''}>`,
        String(i + 1),
        { html: `<span class="swatch" style="background:${colors.get(f.key)}"></span>${escapeHtml(f.label)}`
          + (f.key === fit.true_family ? '<span class="badge badge-true">참 분포</span>' : ''), cls: 'name' },
        { html: paramTxt(f.params), cls: 'left' },
        fmt(f.loglik, 7), fmt(f.aic, 7), fmt(f.daic, 4), fmt(f.bic, 7), fmt(f.bic - bestBic, 4),
        fmt(f.weight, 3),
        f.ks ? `${fmt(f.ks.stat, 3)} (${pFmt(f.ks.p)})` : '—',
      ],
    })), -1, -1);
}

function redrawFit() {
  const { fit, overview, chosen, colors } = current;
  const colorOf = (k) => colors.get(k);
  drawFitPdf($('plot-fit-pdf'), fit, overview.density, chosen, colorOf);
  drawEcdf($('plot-ecdf'), fit, chosen, colorOf);
}

function redrawQQ() {
  const { fit } = current;
  const key = $('qq-family').value;
  if (key) drawQQ($('plot-qq'), fit, key, '#4ea1ff');
}

export function wireFit() {
  $('fit-table').addEventListener('change', (e) => {
    const key = e.target.dataset.fam;
    if (!key || !current) return;
    if (e.target.checked) current.chosen.add(key); else current.chosen.delete(key);
    redrawFit();
  });
  $('qq-family').addEventListener('change', () => current && redrawQQ());
}
