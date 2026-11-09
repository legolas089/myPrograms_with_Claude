// Backend access. The page may be served by the backend itself (port 5002)
// or by the unified launcher (port 3100), so the API origin is absolute.
export const API_BASE = 'http://localhost:5002';
const PIP_HINT = 'flask flask-cors numpy scipy pandas openpyxl statsmodels';

export async function call(path, { json, body, method } = {}) {
  const opts = { method: method || (json || body ? 'POST' : 'GET') };
  if (json) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(json);
  } else if (body) {
    opts.body = body;
  }
  let r;
  try {
    r = await fetch(`${API_BASE}${path}`, opts);
  } catch {
    throw new Error('백엔드에 연결할 수 없습니다 — "Data Analysis Sim.bat" 을 실행하세요');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

async function health() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${API_BASE}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// Resolve once the backend answers; start it through the unified launcher if
// the page is embedded there. `status` is the header badge element.
export async function ensureBackend(status) {
  const ok = (h) => {
    status.textContent = `백엔드 연결됨 · Python ${h.python} · SciPy ${h.scipy}`;
    status.className = 'status status-ok';
    status.title = '';
    return true;
  };
  let h = await health();
  if (h) return ok(h);
  status.textContent = '백엔드 시작 중…';
  status.className = 'status status-wait';
  let startError = null;
  try {
    const r = await fetch('/api/start-backend', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'data_analysis_sim' }),
    });
    if (!r.ok) startError = await r.json().catch(() => null);
  } catch { /* standalone: nothing to ask */ }
  if (startError?.error && startError.python) {
    const missing = /No module named '([^']+)'/.exec(startError.error);
    status.textContent = missing
      ? `백엔드 시작 실패: '${missing[1]}' 패키지 없음 → "${startError.python}" -m pip install ${PIP_HINT}`
      : `백엔드 시작 실패: ${startError.error}`;
    status.title = `Python: ${startError.python}\n로그: ${startError.log}`;
    status.className = 'status status-bad';
    return false;
  }
  for (let i = 0; i < 25; i++) {
    await new Promise((res) => setTimeout(res, 700));
    h = await health();
    if (h) return ok(h);
  }
  status.textContent = '백엔드 연결 안 됨 — "Data Analysis Sim.bat" 을 실행하세요';
  status.className = 'status status-bad';
  return false;
}
