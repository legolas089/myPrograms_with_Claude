const { PDFDocument } = PDFLib;

export async function reorderPages(data, pageIndices) {
  // pageIndices: array of 0-based page indices in desired order
  const src = await PDFDocument.load(data);
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(src, pageIndices);
  for (const page of pages) {
    doc.addPage(page);
  }
  return await doc.save();
}

export async function splitAll(data) {
  const src = await PDFDocument.load(data);
  const total = src.getPageCount();
  const results = [];

  for (let i = 0; i < total; i++) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    const bytes = await doc.save();
    results.push({ bytes, label: `page_${i + 1}` });
  }

  return results;
}

export async function splitByRanges(data, rangeText) {
  const src = await PDFDocument.load(data);
  const total = src.getPageCount();
  const ranges = parseRanges(rangeText, total);
  const results = [];

  for (const range of ranges) {
    const doc = await PDFDocument.create();
    // range.pages is array of 0-based indices
    const pages = await doc.copyPages(src, range.pages);
    for (const page of pages) {
      doc.addPage(page);
    }
    const bytes = await doc.save();
    results.push({ bytes, label: range.label });
  }

  return results;
}

function parseRanges(text, totalPages) {
  const parts = text.split(',').map(s => s.trim()).filter(Boolean);
  const ranges = [];

  for (const part of parts) {
    const dashMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (dashMatch) {
      const start = Math.max(1, parseInt(dashMatch[1]));
      const end = Math.min(totalPages, parseInt(dashMatch[2]));
      if (start > end) throw new Error(`잘못된 범위: ${part}`);
      const pages = [];
      for (let i = start - 1; i < end; i++) pages.push(i);
      ranges.push({ pages, label: `pages_${start}-${end}` });
    } else {
      const num = parseInt(part);
      if (isNaN(num) || num < 1 || num > totalPages) {
        throw new Error(`잘못된 페이지 번호: ${part} (전체 ${totalPages}페이지)`);
      }
      ranges.push({ pages: [num - 1], label: `page_${num}` });
    }
  }

  if (ranges.length === 0) throw new Error('범위를 입력하세요');
  return ranges;
}
