/* Builds the printable document (one HTML string) from the article list.
   Used both for headless-Chrome PDF rendering and the browser print window. */

const PrintDoc = (() => {
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function css(opts) {
    return `
      @page { size: A4; margin: 18mm 16mm 18mm 16mm; }
      html, body { margin: 0; padding: 0; }
      body {
        font-family: "Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif;
        font-size: ${opts.fontSize}pt;
        line-height: ${opts.lineHeight};
        color: #111;
        background: #fff;
        word-break: keep-all;
        overflow-wrap: anywhere;
      }
      .article { ${opts.newPage ? 'page-break-before: always;' : 'margin-top: 2.5em;'} }
      .article.first { page-break-before: auto; margin-top: 0; }
      .article h1.title { font-size: 1.75em; line-height: 1.3; margin: 0 0 0.35em; }
      .meta { color: #555; font-size: 0.82em; border-bottom: 1px solid #bbb; padding-bottom: 0.6em; margin-bottom: 1.1em; }
      .meta span + span::before { content: " · "; color: #999; }
      .meta a { color: #555; text-decoration: none; }
      .body p { margin: 0 0 0.85em; }
      .body h1, .body h2, .body h3, .body h4 { line-height: 1.3; margin: 1.3em 0 0.5em; page-break-after: avoid; }
      .body h1 { font-size: 1.35em; } .body h2 { font-size: 1.25em; } .body h3 { font-size: 1.12em; } .body h4 { font-size: 1em; }
      .body img { max-width: 100%; height: auto; vertical-align: middle; }
      .body > img, .body figure img, .body > p > img:only-child, .body > div > img:only-child {
        display: block; margin: 0.9em auto; max-height: 110mm; page-break-inside: avoid;
      }
      .body figure { margin: 0.9em 0; page-break-inside: avoid; }
      .body figcaption { font-size: 0.85em; color: #555; text-align: center; margin-top: 0.3em; }
      .body table { border-collapse: collapse; width: 100%; font-size: 0.88em; margin: 0.8em 0; page-break-inside: auto; }
      .body td, .body th { border: 1px solid #bbb; padding: 3px 6px; vertical-align: top; }
      .body th { background: #f0f0f0; }
      .body ul, .body ol { margin: 0 0 0.85em; padding-left: 1.6em; }
      .body blockquote { border-left: 3px solid #bbb; margin: 0.8em 0; padding: 0.2em 0.9em; color: #444; }
      .body pre, .body code { font-family: Consolas, "D2Coding", monospace; font-size: 0.85em; }
      .body pre { white-space: pre-wrap; background: #f4f4f4; padding: 0.6em 0.8em; border-radius: 3px; }
      .body a { color: inherit; text-decoration: none; }
      .cover { page-break-after: always; }
      .cover h1 { font-size: 1.9em; margin: 0 0 0.3em; }
      .cover .gen { color: #666; font-size: 0.85em; margin-bottom: 1.6em; }
      .cover ol { padding-left: 1.6em; }
      .cover li { margin-bottom: 0.7em; }
      .cover li .src { display: block; color: #666; font-size: 0.8em; word-break: break-all; }
    `;
  }

  function metaLine(a, opts) {
    if (!opts.includeMeta) return '';
    const parts = [];
    if (a.sitename) parts.push(`<span>${esc(a.sitename)}</span>`);
    if (a.author) parts.push(`<span>${esc(a.author)}</span>`);
    if (a.date) parts.push(`<span>${esc(a.date)}</span>`);
    const link = a.finalUrl || a.url;
    if (link) parts.push(`<span><a href="${esc(link)}">${esc(link)}</a></span>`);
    return parts.length ? `<div class="meta">${parts.join('')}</div>` : '';
  }

  function articleHtml(a, idx, opts) {
    let blocks = a.blocks
      .filter(b => b.included)
      .filter(b => opts.includeImages || b.type !== 'image')
      .map(b => b.html)
      .join('\n');
    if (!opts.includeImages) {
      // Also drop images embedded inside text blocks (figures with captions, infobox icons…).
      blocks = blocks.replace(/<figure\b[\s\S]*?<\/figure>/gi, '').replace(/<img\b[^>]*>/gi, '');
    }
    return `
      <section class="article${idx === 0 ? ' first' : ''}">
        <h1 class="title">${esc(a.title || a.url)}</h1>
        ${metaLine(a, opts)}
        <div class="body">${blocks}</div>
      </section>`;
  }

  function coverHtml(articles, opts) {
    if (!opts.coverPage || articles.length < 2) return '';
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const items = articles.map(a => `
      <li>${esc(a.title || a.url)}
        <span class="src">${esc(a.sitename || '')}${a.date ? ' · ' + esc(a.date) : ''}${(a.finalUrl || a.url) ? ' · ' + esc(a.finalUrl || a.url) : ''}</span>
      </li>`).join('');
    return `
      <section class="cover">
        <h1>${esc(opts.coverTitle || '스크랩 모음')}</h1>
        <div class="gen">${articles.length}개 문서 · ${stamp}</div>
        <ol>${items}</ol>
      </section>`;
  }

  /** @returns {string} full standalone HTML document */
  function build(articles, opts) {
    const ready = articles.filter(a => a.status === 'ok' && a.blocks.some(b => b.included));
    const body = coverHtml(ready, opts) + ready.map((a, i) => articleHtml(a, i, opts)).join('\n');
    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${esc(opts.title || 'Article Printer')}</title>
<style>${css(opts)}</style>
</head>
<body>
${body}
</body>
</html>`;
  }

  return { build };
})();
