// Shared page state and small helpers used by every tab module.

export const $ = (id) => document.getElementById(id);

export const state = {
  functions: [], algos: [], surrogates: [],
  problem: null,       // /api/problem reply (describe + landscape)
  x0: null,            // start point for single runs and comparisons
  opts: {},            // {algoKey: {option: value}} edited in the single-run tab
  tab: 'problem',
};

export const algoByKey = (k) => state.algos.find((a) => a.key === k);

const STORE_KEY = 'optimization_sim.settings';
export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
export function saveSettings(patch) {
  try {
    const cur = loadSettings();
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch { /* storage blocked */ }
}

export function showError(msg) {
  const el = $('error');
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

export async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  showError('');
  try { return await fn(); } catch (e) { showError(e.message); return undefined; } finally { if (btn) btn.disabled = false; }
}

// "x=1.2, y=−0.4"
export function pointText(x, digits = 5) {
  if (!x) return '—';
  const names = ['x', 'y'];
  return x.map((v, i) => `${names[i]}=${fmtNum(v, digits)}`).join(', ');
}

function fmtNum(v, digits) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  const s = a >= 1e5 || a < 1e-4 ? v.toExponential(digits - 1).replace(/\.?0+e/, 'e') : Number(v.toPrecision(digits)).toString();
  return s.replace(/-/g, '−');
}

// Tolerance used for "reached the global minimum"; the multi-start tab can override it.
export function reached(run, tol) {
  return run && typeof run.gap === 'number' && run.gap <= tol && (run.violation ?? 0) <= 1e-6;
}
