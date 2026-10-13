/* Article Printer — app state, URL fetching, article list, PDF export. */

const API_BASE = 'http://localhost:5001';
const MAX_URLS = 10;

const state = {
  articles: [],       // {id, url, status:'loading'|'ok'|'error', error, title, author, date, sitename, finalUrl, engine, blocks[]}
  selectedId: null,
  nextId: 1,
  backendOk: false,
};

const el = {
  status: document.getElementById('backend-status'),
  urlInput: document.getElementById('url-input'),
  urlCount: document.getElementById('url-count'),
  fetchBtn: document.getElementById('fetch-btn'),
  manualBtn: document.getElementById('manual-btn'),
  clearBtn: document.getElementById('clear-btn'),
  list: document.getElementById('article-list'),
  articleCount: document.getElementById('article-count'),
  pdfBtn: document.getElementById('pdf-btn'),
  printBtn: document.getElementById('print-btn'),
  previewDocBtn: document.getElementById('preview-doc-btn'),
  saveResult: document.getElementById('save-result'),
  optImages: document.getElementById('opt-images'),
  optMeta: document.getElementById('opt-meta'),
  optNewPage: document.getElementById('opt-newpage'),
  optCover: document.getElementById('opt-cover'),
  optFont: document.getElementById('opt-font'),
  optFontVal: document.getElementById('opt-font-val'),
  optLh: document.getElementById('opt-lh'),
  optLhVal: document.getElementById('opt-lh-val'),
  optFilename: document.getElementById('opt-filename'),
  modal: document.getElementById('manual-modal'),
  manualTitle: document.getElementById('manual-title'),
  manualUrl: document.getElementById('manual-url'),
  manualText: document.getElementById('manual-text'),
  manualAdd: document.getElementById('manual-add-btn'),
  manualCancel: document.getElementById('manual-cancel-btn'),
};

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Backend health (auto-start through the unified launcher if needed) ──
async function checkHealth() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${API_BASE}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error();
    const j = await r.json();
    state.backendOk = true;
    el.status.textContent = j.chrome ? '백엔드 연결됨 · PDF 저장 가능' : '백엔드 연결됨 · Chrome/Edge 없음 → 브라우저 인쇄만 가능';
    el.status.className = 'status status-ok';
    return true;
  } catch {
    state.backendOk = false;
    return false;
  }
}

async function ensureBackend() {
  if (await checkHealth()) return;
  el.status.textContent = '백엔드 시작 중…';
  el.status.className = 'status status-wait';
  // When embedded in the unified launcher (same origin), ask it to spawn server.py.
  try {
    await fetch('/api/start-backend', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'article_printer' }),
    });
  } catch { /* standalone mode: nothing to ask */ }
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 700));
    if (await checkHealth()) return;
  }
  el.status.textContent = '백엔드 연결 안 됨 — "Article Printer.bat"를 실행하세요';
  el.status.className = 'status status-bad';
}

// ── URL parsing ──
function parseUrls(text) {
  const seen = new Set();
  const out = [];
  for (const raw of text.split(/\s+/)) {
    let u = raw.trim();
    if (!u) continue;
    if (!/^https?:\/\//i.test(u)) {
      if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(u)) u = 'https://' + u; else continue;
    }
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function updateUrlCount() {
  const n = parseUrls(el.urlInput.value).length;
  const room = MAX_URLS - state.articles.length;
  el.urlCount.textContent = n ? `${n}개 링크 (추가 가능 ${Math.max(room, 0)}개)` : '';
  el.urlCount.style.color = n > room ? '#f08f8f' : '';
}

// ── Fetching ──
async function extractOne(article, payload) {
  try {
    const r = await fetch(`${API_BASE}/api/extract`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    Object.assign(article, {
      status: 'ok', error: '',
      title: j.title, author: j.author, date: j.date, sitename: j.sitename,
      finalUrl: j.finalUrl, engine: j.engine,
      blocks: (j.blocks || []).map(b => ({ ...b, included: b.included !== false })),
    });
  } catch (e) {
    article.status = 'error';
    article.error = e.message || String(e);
  }
  renderList();
  if (state.selectedId === article.id) Editor.render(article);
  updateSaveButtons();
}

async function fetchUrls() {
  const urls = parseUrls(el.urlInput.value);
  if (!urls.length) return;
  const room = MAX_URLS - state.articles.length;
  if (room <= 0) { alert(`한 번에 최대 ${MAX_URLS}개까지 묶을 수 있습니다. 목록을 비우거나 일부를 삭제하세요.`); return; }
  const batch = urls.slice(0, room);
  if (urls.length > room) alert(`최대 ${MAX_URLS}개까지만 받습니다. 앞의 ${batch.length}개만 가져옵니다.`);

  if (!state.backendOk && !(await checkHealth())) { await ensureBackend(); if (!state.backendOk) return; }

  const created = batch.map(url => {
    const a = { id: state.nextId++, url, status: 'loading', error: '', title: hostOf(url), blocks: [] };
    state.articles.push(a);
    return a;
  });
  el.urlInput.value = '';
  updateUrlCount();
  if (!state.selectedId) select(created[0].id);
  renderList();
  await Promise.all(created.map(a => extractOne(a, { url: a.url })));
}

// ── Article list ──
function renderList() {
  el.articleCount.textContent = state.articles.length ? `${state.articles.length} / ${MAX_URLS}` : '';
  if (!state.articles.length) {
    el.list.innerHTML = '<div class="empty">위에 링크를 붙여넣고 <b>가져오기</b>를 누르세요.</div>';
    return;
  }
  el.list.innerHTML = '';
  state.articles.forEach((a, idx) => {
    const card = document.createElement('div');
    card.className = 'article-card' + (a.id === state.selectedId ? ' selected' : '') + (a.status === 'error' ? ' error' : '');
    const badge = a.status === 'ok' ? `<span class="badge badge-ok">${a.blocks.filter(b => b.included).length}/${a.blocks.length}</span>`
      : a.status === 'loading' ? '<span class="badge badge-loading">가져오는 중</span>'
      : '<span class="badge badge-error">실패</span>';
    const sub = a.status === 'error'
      ? `<div class="card-sub err">${esc(a.error)}</div>`
      : `<div class="card-sub" title="${esc(a.url)}">${esc(a.sitename || hostOf(a.url))}${a.date ? ' · ' + esc(a.date) : ''}</div>`;
    card.innerHTML = `
      <div class="card-index">${idx + 1}</div>
      <div class="card-title">${esc(a.title || a.url)}</div>
      ${sub}
      <div class="card-tools">
        ${badge}
        <span class="spacer"></span>
        <button class="btn-icon" data-act="up" title="위로" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="btn-icon" data-act="down" title="아래로" ${idx === state.articles.length - 1 ? 'disabled' : ''}>▼</button>
        ${a.status === 'error' ? '<button class="btn-icon" data-act="retry" title="다시 시도">↻</button><button class="btn-icon" data-act="manual" title="직접 입력으로 대체">✎</button>' : ''}
        <button class="btn-icon" data-act="remove" title="삭제">✕</button>
      </div>`;
    card.addEventListener('click', (e) => {
      const act = e.target.dataset.act;
      if (act) { e.stopPropagation(); handleCardAction(a, act); return; }
      select(a.id);
    });
    el.list.appendChild(card);
  });
}

function handleCardAction(a, act) {
  const idx = state.articles.indexOf(a);
  if (act === 'remove') {
    state.articles.splice(idx, 1);
    if (state.selectedId === a.id) select(state.articles[0]?.id ?? null);
  } else if (act === 'up' && idx > 0) {
    [state.articles[idx - 1], state.articles[idx]] = [state.articles[idx], state.articles[idx - 1]];
  } else if (act === 'down' && idx < state.articles.length - 1) {
    [state.articles[idx + 1], state.articles[idx]] = [state.articles[idx], state.articles[idx + 1]];
  } else if (act === 'retry') {
    a.status = 'loading';
    a.error = '';
    renderList();
    if (state.selectedId === a.id) Editor.render(a);
    extractOne(a, { url: a.url });
    return;
  } else if (act === 'manual') {
    openManual(a);
    return;
  }
  renderList();
  updateUrlCount();
  updateSaveButtons();
}

function select(id) {
  state.selectedId = id;
  renderList();
  Editor.render(state.articles.find(a => a.id === id) || null);
}

Editor.setOnChange(() => { renderList(); updateSaveButtons(); });

// ── Manual paste ──
let manualTarget = null;

function openManual(replace = null) {
  manualTarget = replace;
  el.manualTitle.value = replace?.title && replace.status === 'error' ? '' : (replace?.title || '');
  el.manualUrl.value = replace?.url || '';
  el.manualText.value = '';
  el.modal.classList.remove('hidden');
  el.manualText.focus();
}

function closeManual() {
  el.modal.classList.add('hidden');
  manualTarget = null;
}

async function submitManual() {
  const text = el.manualText.value;
  if (!text.trim()) { el.manualText.focus(); return; }
  const url = el.manualUrl.value.trim();
  const title = el.manualTitle.value.trim();
  const looksHtml = /<\s*(p|div|article|body|html|h[1-6]|br|img|table)\b/i.test(text);
  const payload = looksHtml ? { html: text, url, title } : { text, url, title };

  let a = manualTarget;
  if (!a) {
    if (state.articles.length >= MAX_URLS) { alert(`한 번에 최대 ${MAX_URLS}개까지 묶을 수 있습니다.`); return; }
    a = { id: state.nextId++, url, status: 'loading', error: '', title: title || '직접 입력', blocks: [] };
    state.articles.push(a);
  } else {
    Object.assign(a, { url, status: 'loading', error: '', blocks: [] });
  }
  closeManual();
  select(a.id);
  if (!state.backendOk && !(await checkHealth())) { await ensureBackend(); }
  await extractOne(a, payload);
}

// ── Options / export ──
function readOptions() {
  return {
    includeImages: el.optImages.checked,
    includeMeta: el.optMeta.checked,
    newPage: el.optNewPage.checked,
    coverPage: el.optCover.checked,
    fontSize: parseFloat(el.optFont.value),
    lineHeight: parseFloat(el.optLh.value),
    title: (el.optFilename.value.trim() || `articles_${todayStamp()}`).replace(/\.pdf$/i, ''),
    coverTitle: el.optFilename.value.trim().replace(/\.pdf$/i, '') || '스크랩 모음',
  };
}

function readyArticles() {
  return state.articles.filter(a => a.status === 'ok' && a.blocks.some(b => b.included));
}

function updateSaveButtons() {
  const ok = readyArticles().length > 0 && !state.articles.some(a => a.status === 'loading');
  el.pdfBtn.disabled = !ok;
  el.printBtn.disabled = !ok;
  el.previewDocBtn.disabled = !ok;
}

function buildDocument() {
  return PrintDoc.build(state.articles, readOptions());
}

function setResult(msg, cls = '') {
  el.saveResult.className = 'save-result ' + cls;
  el.saveResult.innerHTML = msg;
}

async function savePdf() {
  const html = buildDocument();
  const opts = readOptions();
  el.pdfBtn.disabled = true;
  setResult('PDF 생성 중… (이미지가 많으면 수십 초 걸릴 수 있습니다)');
  try {
    const r = await fetch(`${API_BASE}/api/pdf`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, filename: opts.title + '.pdf' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    const kb = Math.round(j.size / 1024);
    setResult(`저장됨: <b>${esc(j.name)}</b> (${kb} KB)<br>${esc(j.path)}<br>
      <button class="btn-small" id="open-pdf-btn">파일 열기</button>`, 'ok');
    document.getElementById('open-pdf-btn').addEventListener('click', () => {
      fetch(`${API_BASE}/api/open`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: j.path }),
      });
    });
  } catch (e) {
    setResult(`실패: ${esc(e.message)}`, 'err');
  } finally {
    updateSaveButtons();
  }
}

// Full document preview / print lives in an in-page iframe so it works without
// popups, including when this app is embedded in the unified launcher.
const docModal = document.getElementById('doc-modal');
const docFrame = document.getElementById('doc-frame');

function printFrame() {
  const w = docFrame.contentWindow;
  if (!w) return;
  try { w.focus(); w.print(); } catch (e) { setResult(`인쇄 실패: ${esc(e.message)}`, 'err'); }
}

function openDocWindow(autoPrint) {
  const html = buildDocument();
  document.getElementById('doc-modal-title').textContent = autoPrint ? '브라우저 인쇄' : '전체 미리보기';
  docModal.classList.remove('hidden');
  docFrame.srcdoc = html;
  if (autoPrint) {
    // Wait for the document (and its images) to load before opening the print dialog.
    docFrame.addEventListener('load', () => setTimeout(printFrame, 400), { once: true });
  }
}

function closeDocModal() {
  docModal.classList.add('hidden');
  docFrame.srcdoc = '';
}

document.getElementById('doc-print-btn').addEventListener('click', printFrame);
document.getElementById('doc-close-btn').addEventListener('click', closeDocModal);
docModal.addEventListener('click', (e) => { if (e.target === docModal) closeDocModal(); });

// ── Wire up ──
el.fetchBtn.addEventListener('click', fetchUrls);
el.urlInput.addEventListener('input', updateUrlCount);
el.urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) fetchUrls(); });
el.clearBtn.addEventListener('click', () => {
  if (state.articles.length && !confirm('목록을 모두 비울까요?')) return;
  state.articles = [];
  select(null);
  updateUrlCount();
  updateSaveButtons();
  setResult('');
});
el.manualBtn.addEventListener('click', () => openManual(null));
el.manualAdd.addEventListener('click', submitManual);
el.manualCancel.addEventListener('click', closeManual);
el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeManual(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!el.modal.classList.contains('hidden')) closeManual();
  if (!docModal.classList.contains('hidden')) closeDocModal();
});

el.optFont.addEventListener('input', () => { el.optFontVal.textContent = el.optFont.value; });
el.optLh.addEventListener('input', () => { el.optLhVal.textContent = el.optLh.value; });
el.optFilename.placeholder = `articles_${todayStamp()}`;

el.pdfBtn.addEventListener('click', savePdf);
el.printBtn.addEventListener('click', () => openDocWindow(true));
el.previewDocBtn.addEventListener('click', () => openDocWindow(false));

ensureBackend();
updateSaveButtons();
