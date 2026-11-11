// Small DOM helpers shared by the tabs.

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// rows: {group} for a section header, or {cells: [html | {html, cls}…], tip?, cls?}.
// thCol / diffCol: column indices styled as theory / difference (-1 = none).
export function tableHtml(head, rows, thCol = 2, diffCol = 3) {
  const body = rows.map((r) => {
    if (r.group) return `<tr class="group"><td colspan="${head.length}">${r.group}</td></tr>`;
    return `<tr${r.cls ? ` class="${r.cls}"` : ''}>${r.cells.map((cell, i) => {
      let c = cell;
      let cls = i === thCol ? ' class="th"' : i === diffCol ? ' class="diff"' : '';
      if (cell && typeof cell === 'object') {
        c = cell.html;
        cls = ` class="${cell.cls}"`;
      }
      const tip = i === 0 && r.tip ? ` title="${escapeHtml(r.tip)}"` : '';
      return `<td${cls}${tip}>${c}</td>`;
    }).join('')}</tr>`;
  }).join('');
  return `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody>`;
}

export function kpiHtml(items) {
  return items.map(([k, v, sub]) => `
    <div class="kpi"><div class="k">${k}</div><div class="v">${v}</div>
    ${sub ? `<div class="t">${sub}</div>` : ''}</div>`).join('');
}

export function setNote(el, lines) {
  const text = (Array.isArray(lines) ? lines : [lines]).filter(Boolean).join('\n');
  el.textContent = text;
  el.style.whiteSpace = 'pre-line';
  el.classList.toggle('hidden', !text);
}
