// help.js — Minimal offline Markdown renderer + help modal controller

// ── Minimal Markdown → HTML ──
// Supports: headers, paragraphs, bold/italic, inline code, fenced code blocks,
// unordered & ordered lists, blockquotes, horizontal rules, links, tables.
// Intentionally dependency-free so it works inside a bundled exe with no CDN.

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(text) {
  // Protect inline code first
  const codes = [];
  text = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000CODE${codes.length - 1}\u0000`;
  });

  text = escapeHtml(text);

  // Links [label](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label, url) => `<a href="${url}" target="_blank" rel="noopener">${label}</a>`);

  // Bold **text**
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic *text* (avoid already-consumed **)
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  // Restore inline code
  text = text.replace(/\u0000CODE(\d+)\u0000/g,
    (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);

  return text;
}

function parseTableRow(line) {
  // Strip leading/trailing pipes, split on |
  const trimmed = line.trim().replace(/^\||\|$/g, '');
  return trimmed.split('|').map(c => c.trim());
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line);
}

function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      i++;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const cls = lang ? ` class="lang-${escapeHtml(lang)}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // Horizontal rule
    if (/^\s*---\s*$/.test(line) || /^\s*\*\*\*\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Table (header line + separator line + rows)
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = parseTableRow(line);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      const thead = '<thead><tr>' +
        headers.map(h => `<th>${renderInline(h)}</th>`).join('') +
        '</tr></thead>';
      const tbody = '<tbody>' +
        rows.map(r => '<tr>' +
          r.map(c => `<td>${renderInline(c)}</td>`).join('') +
          '</tr>').join('') +
        '</tbody>';
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // Blockquote (may span multiple lines)
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderInline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      out.push('<ul>' + items.map(it => `<li>${renderInline(it)}</li>`).join('') + '</ul>');
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push('<ol>' + items.map(it => `<li>${renderInline(it)}</li>`).join('') + '</ol>');
      continue;
    }

    // Blank line → paragraph separator
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: collect consecutive non-blank lines
    const buf = [];
    while (i < lines.length && lines[i].trim() !== ''
           && !/^#{1,6}\s/.test(lines[i])
           && !/^```/.test(lines[i])
           && !/^\s*[-*+]\s+/.test(lines[i])
           && !/^\s*\d+\.\s+/.test(lines[i])
           && !/^>\s?/.test(lines[i])
           && !/^\s*---\s*$/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    if (buf.length > 0) {
      out.push(`<p>${renderInline(buf.join(' '))}</p>`);
    }
  }

  return out.join('\n');
}

// ── Modal Controller ──
let loaded = false;
let loadedHtml = '';

async function loadContent() {
  if (loaded) return loadedHtml;
  try {
    const res = await fetch('README_exe.md', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const md = await res.text();
    loadedHtml = renderMarkdown(md);
  } catch (err) {
    loadedHtml = `<h1>Help</h1><p>README_exe.md 파일을 불러올 수 없습니다.</p>` +
                 `<pre><code>${String(err)}</code></pre>`;
  }
  loaded = true;
  return loadedHtml;
}

export function initHelp() {
  const btn = document.getElementById('btn-help');
  const overlay = document.getElementById('help-overlay');
  const closeBtn = document.getElementById('help-close');
  const content = document.getElementById('help-content');
  if (!btn || !overlay || !closeBtn || !content) return;

  const open = async () => {
    content.innerHTML = '<p style="color:#888;">Loading…</p>';
    overlay.classList.remove('help-hidden');
    content.innerHTML = await loadContent();
    content.scrollTop = 0;
  };

  const close = () => overlay.classList.add('help-hidden');

  btn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('help-hidden')) close();
  });
}
