/* Paragraph-level editor: renders one article's blocks with checkboxes,
   shift-click range selection, and "cut everything above/below" buttons. */

const Editor = (() => {
  const el = {
    blocks: document.getElementById('blocks'),
    toolbar: document.getElementById('preview-toolbar'),
    title: document.getElementById('preview-title'),
    count: document.getElementById('preview-count'),
  };

  let article = null;
  let lastClicked = -1;
  let onChange = () => {};

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function updateCount() {
    if (!article) { el.count.textContent = ''; return; }
    const total = article.blocks.length;
    const inc = article.blocks.filter(b => b.included).length;
    el.count.textContent = `${inc} / ${total} 블록 포함`;
  }

  function setIncluded(i, v) {
    article.blocks[i].included = v;
    const row = el.blocks.querySelector(`.block[data-i="${i}"]`);
    if (row) {
      row.classList.toggle('excluded', !v);
      row.querySelector('input[type=checkbox]').checked = v;
    }
  }

  function commit() {
    updateCount();
    onChange(article);
  }

  function render(a) {
    article = a;
    lastClicked = -1;
    el.blocks.innerHTML = '';

    if (!a) {
      el.title.textContent = '미리보기';
      el.toolbar.style.display = 'none';
      el.blocks.innerHTML = '<div class="empty">왼쪽 목록에서 문서를 선택하면 문단이 표시됩니다.</div>';
      updateCount();
      return;
    }

    el.title.textContent = '미리보기';
    if (a.status !== 'ok') {
      el.toolbar.style.display = 'none';
      el.blocks.innerHTML = `<div class="empty">${a.status === 'loading' ? '가져오는 중…' : esc(a.error || '추출 실패')}</div>`;
      updateCount();
      return;
    }

    el.toolbar.style.display = '';

    const head = document.createElement('div');
    head.className = 'article-head';
    const link = a.finalUrl || a.url;
    head.innerHTML = `
      <h2>${esc(a.title || a.url)}</h2>
      <div class="meta">${[a.sitename, a.author, a.date].filter(Boolean).map(esc).join(' · ')}
        ${link ? ` · <a href="${esc(link)}" target="_blank" rel="noopener">원문 열기</a>` : ''}
        · 추출: ${esc(a.engine || '')}</div>`;
    el.blocks.appendChild(head);

    a.blocks.forEach((b, i) => {
      const row = document.createElement('div');
      row.className = 'block' + (b.included ? '' : ' excluded');
      row.dataset.i = i;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = b.included;
      cb.title = '이 블록 포함/제외';
      cb.addEventListener('click', (e) => {
        if (e.shiftKey && lastClicked >= 0) {
          const [lo, hi] = [Math.min(lastClicked, i), Math.max(lastClicked, i)];
          const v = cb.checked;
          for (let k = lo; k <= hi; k++) setIncluded(k, v);
        } else {
          setIncluded(i, cb.checked);
        }
        lastClicked = i;
        commit();
      });

      const body = document.createElement('div');
      body.className = 'block-body';
      body.innerHTML = b.html;

      const cut = document.createElement('div');
      cut.className = 'block-cut';
      const up = document.createElement('button');
      up.textContent = '▲ 여기 위 모두 제외';
      up.title = '이 블록부터 포함, 그 위는 전부 제외';
      up.addEventListener('click', (e) => {
        e.stopPropagation();
        for (let k = 0; k < i; k++) setIncluded(k, false);
        setIncluded(i, true);
        commit();
      });
      const down = document.createElement('button');
      down.textContent = '▼ 여기 아래 모두 제외';
      down.title = '이 블록까지 포함, 그 아래는 전부 제외';
      down.addEventListener('click', (e) => {
        e.stopPropagation();
        for (let k = i + 1; k < a.blocks.length; k++) setIncluded(k, false);
        setIncluded(i, true);
        commit();
      });
      cut.append(up, down);

      row.append(cb, body, cut);
      el.blocks.appendChild(row);
    });

    updateCount();
  }

  function selectAll(v) {
    if (!article || article.status !== 'ok') return;
    article.blocks.forEach((_, i) => setIncluded(i, v));
    commit();
  }

  function excludeImages() {
    if (!article || article.status !== 'ok') return;
    article.blocks.forEach((b, i) => { if (b.type === 'image') setIncluded(i, false); });
    commit();
  }

  document.getElementById('select-all-btn').addEventListener('click', () => selectAll(true));
  document.getElementById('deselect-all-btn').addEventListener('click', () => selectAll(false));
  document.getElementById('no-images-btn').addEventListener('click', excludeImages);

  return {
    render,
    current: () => article,
    setOnChange(fn) { onChange = fn; },
  };
})();
