// Algorithm catalog helpers: grouped <select>, option forms built from the
// backend schema, capability badges, and check-lists for comparison runs.
import { escapeHtml } from './ui.js';

export const PRESETS = {
  rep: ['Nelder-Mead', 'COBYQA', 'BFGS', 'L-BFGS-B', 'SLSQP', 'trust-exact', 'dual_annealing',
    'differential_evolution', 'basinhopping', 'ipopt', 'bo_gp', 'random'],
  local: (a) => !['전역 (SciPy)', '베이지안 · 표본 기반'].includes(a.group),
  global: (a) => ['전역 (SciPy)', '베이지안 · 표본 기반'].includes(a.group) && a.key !== 'optuna_gp',
  all: () => true,
  none: () => false,
};

export function groups(algos) {
  const out = new Map();
  for (const a of algos) {
    if (!out.has(a.group)) out.set(a.group, []);
    out.get(a.group).push(a);
  }
  return out;
}

export function fillSelect(sel, algos, value) {
  sel.innerHTML = [...groups(algos)].map(([g, list]) => `<optgroup label="${escapeHtml(g)}">${
    list.map((a) => `<option value="${a.key}">${escapeHtml(a.label)}</option>`).join('')}</optgroup>`).join('');
  if (value && algos.some((a) => a.key === value)) sel.value = value;
}

export function badgesHtml(a, prob) {
  const b = (on, text, title) => `<span class="badge ${on ? 'badge-ok' : 'badge-off'}" title="${title}">${text}</span>`;
  const hasCons = prob && prob.constraints.length > 0;
  return [
    `<span class="badge badge-lib">${escapeHtml(a.lib)}</span>`,
    b(a.grad, a.grad ? '기울기 사용' : '미분 불필요', '목적 함수의 기울기를 쓰는지'),
    a.hess ? b(true, '헤시안 사용', '2차 도함수 사용') : '',
    b(a.bounds, a.bounds ? '경계 ✓' : '경계 ✗', '탐색 영역(박스) 제약을 지키는지'),
    b(a.cons || (a.group.startsWith('베이지안') && !(prob?.constraints || []).some((c) => c.kind === 'eq')),
      a.cons ? '제약식 ✓' : a.group.startsWith('베이지안') ? '부등식만 ✓' : '제약식 ✗',
      hasCons ? '이 문제에는 제약식이 있습니다' : '제약식(부등식·등식)을 다루는지'),
    b(a.x0, a.x0 ? '시작점 사용' : '시작점 안 씀', '초기점 x₀ 에서 출발하는지'),
    a.stochastic ? b(true, '확률적 (seed)', '난수에 따라 결과가 달라짐') : b(false, '결정론적', ''),
  ].join('');
}

function fieldHtml(o, v) {
  const id = `opt-${o.key}`;
  const help = o.help ? ` title="${escapeHtml(o.help)}"` : '';
  if (o.type === 'bool') {
    return `<label class="field check"${help}><input type="checkbox" id="${id}" data-opt="${o.key}" ${v ? 'checked' : ''}><span>${escapeHtml(o.label)}</span></label>`;
  }
  if (o.type === 'select') {
    return `<label class="field"${help}><span>${escapeHtml(o.label)}</span><select id="${id}" data-opt="${o.key}">${
      o.choices.map(([k, t]) => `<option value="${escapeHtml(k)}" ${k === v ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></label>`;
  }
  const step = o.type === 'int' ? '1' : 'any';
  const lim = `${o.min !== undefined ? ` min="${o.min}"` : ''}${o.max !== undefined ? ` max="${o.max}"` : ''}`;
  return `<label class="field"${help}><span>${escapeHtml(o.label)}</span><input type="number" id="${id}" data-opt="${o.key}" step="${step}"${lim} value="${v}"></label>`;
}

export function renderOptions(el, algo, values = {}) {
  el.innerHTML = algo.options.map((o) => fieldHtml(o, values[o.key] ?? o.default)).join('')
    || '<span class="hint">조정할 옵션이 없습니다</span>';
}

// Values from the form; only the ones that differ from the defaults are returned.
export function readOptions(el, algo) {
  const out = {};
  for (const o of algo.options) {
    const input = el.querySelector(`[data-opt="${o.key}"]`);
    if (!input) continue;
    let v;
    if (o.type === 'bool') v = input.checked;
    else if (o.type === 'select') v = input.value;
    else {
      v = Number(input.value);
      if (input.value === '' || !Number.isFinite(v)) throw new Error(`'${o.label}' 에 숫자를 넣으세요`);
    }
    if (v !== o.default) out[o.key] = v;
  }
  return out;
}

// Grouped check-list. selected: Set of keys (mutated). edited: Set of keys with custom options.
export function renderChecklist(el, algos, selected, edited, onChange) {
  el.innerHTML = [...groups(algos)].map(([g, list]) => `
    <div class="algo-group">
      <div class="gtitle" data-group="${escapeHtml(g)}" title="그룹 전체 켜기/끄기">${escapeHtml(g)}</div>
      ${list.map((a) => `<label class="${edited.has(a.key) ? 'edited' : ''}"><input type="checkbox" data-key="${a.key}" ${selected.has(a.key) ? 'checked' : ''}> ${escapeHtml(a.label)}</label>`).join('')}
    </div>`).join('');
  el.onchange = (e) => {
    const k = e.target.dataset.key;
    if (!k) return;
    if (e.target.checked) selected.add(k); else selected.delete(k);
    onChange();
  };
  el.onclick = (e) => {
    const g = e.target.dataset.group;
    if (!g) return;
    const keys = algos.filter((a) => a.group === g).map((a) => a.key);
    const allOn = keys.every((k) => selected.has(k));
    for (const k of keys) if (allOn) selected.delete(k); else selected.add(k);
    renderChecklist(el, algos, selected, edited, onChange);
    onChange();
  };
}

export function applyPreset(name, algos, selected) {
  selected.clear();
  const p = PRESETS[name];
  for (const a of algos) {
    if (Array.isArray(p) ? p.includes(a.key) : p(a)) selected.add(a.key);
  }
}
