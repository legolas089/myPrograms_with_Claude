import { mergePDFs, getPDFPageCount } from './merge.js';
import { splitAll, splitByRanges, reorderPages } from './split.js';

// ── State ──
let mergeFiles = []; // [{name, data, pageCount}]
let splitFile = null; // {name, data, pageCount}
let pageOrder = [];    // [{origPage (1-based), selected, canvas}]

// ── DOM ──
const tabs = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const loading = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

// Merge
const mergeDrop = document.getElementById('merge-drop');
const mergeAddBtn = document.getElementById('merge-add-btn');
const mergeFileInput = document.getElementById('merge-file-input');
const mergeList = document.getElementById('merge-list');
const mergeActions = document.getElementById('merge-actions');
const mergeBtn = document.getElementById('merge-btn');
const mergeClearBtn = document.getElementById('merge-clear-btn');

// Split
const splitDrop = document.getElementById('split-drop');
const splitAddBtn = document.getElementById('split-add-btn');
const splitFileInput = document.getElementById('split-file-input');
const splitInfo = document.getElementById('split-info');
const splitFilename = document.getElementById('split-filename');
const splitPagecount = document.getElementById('split-pagecount');
const splitRemoveBtn = document.getElementById('split-remove-btn');
const splitPreview = document.getElementById('split-preview');
const splitBtn = document.getElementById('split-btn');
const rangeInputWrap = document.getElementById('range-input-wrap');

// ── Tabs ──
tabs.forEach(btn => {
  btn.addEventListener('click', () => {
    tabs.forEach(b => b.classList.remove('active'));
    tabContents.forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Loading ──
function showLoading(text = '처리 중...') {
  loadingText.textContent = text;
  loading.classList.add('active');
}
function hideLoading() {
  loading.classList.remove('active');
}

// ── Download helper ──
function downloadBlob(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadZip(files) {
  // If single file, download directly
  if (files.length === 1) {
    downloadBlob(files[0].bytes, files[0].label + '.pdf');
    return;
  }
  // Multiple files: download each
  for (const f of files) {
    downloadBlob(f.bytes, f.label + '.pdf');
  }
}

// ══════════════════════════════════════════
// MERGE
// ══════════════════════════════════════════

// Drag & drop on zone
setupDropZone(mergeDrop, async (files) => {
  const pdfFiles = [...files].filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (pdfFiles.length === 0) return alert('PDF 파일만 지원합니다.');
  await addMergeFiles(pdfFiles);
});

mergeAddBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  mergeFileInput.click();
});
mergeDrop.addEventListener('click', () => mergeFileInput.click());

mergeFileInput.addEventListener('change', async () => {
  if (mergeFileInput.files.length > 0) {
    await addMergeFiles([...mergeFileInput.files]);
    mergeFileInput.value = '';
  }
});

async function addMergeFiles(files) {
  showLoading('PDF 로딩 중...');
  try {
    for (const file of files) {
      const data = await file.arrayBuffer();
      const pageCount = await getPDFPageCount(data);
      mergeFiles.push({ name: file.name, data, pageCount });
    }
    renderMergeList();
  } catch (err) {
    alert('PDF 로드 실패: ' + err.message);
  } finally {
    hideLoading();
  }
}

function renderMergeList() {
  mergeList.innerHTML = '';

  if (mergeFiles.length === 0) {
    mergeActions.style.display = 'none';
    mergeDrop.style.display = '';
    return;
  }

  mergeDrop.style.display = 'none';
  mergeActions.style.display = 'flex';

  mergeFiles.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.draggable = true;
    item.dataset.index = idx;

    item.innerHTML = `
      <span class="file-drag-handle">&#9776;</span>
      <span class="file-name">${file.name}</span>
      <span class="file-pages">${file.pageCount}p</span>
      <button class="btn-remove" data-idx="${idx}">&#10060;</button>
    `;

    // Drag reorder
    item.addEventListener('dragstart', (e) => {
      item.classList.add('dragging');
      e.dataTransfer.setData('text/plain', idx);
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const toIdx = idx;
      if (fromIdx !== toIdx) {
        const [moved] = mergeFiles.splice(fromIdx, 1);
        mergeFiles.splice(toIdx, 0, moved);
        renderMergeList();
      }
    });

    // Remove button
    item.querySelector('.btn-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      mergeFiles.splice(idx, 1);
      renderMergeList();
    });

    mergeList.appendChild(item);
  });

  // "Add more" button
  const addMore = document.createElement('div');
  addMore.className = 'file-item';
  addMore.style.justifyContent = 'center';
  addMore.style.cursor = 'pointer';
  addMore.style.color = '#0078d4';
  addMore.textContent = '+ 파일 추가';
  addMore.addEventListener('click', () => mergeFileInput.click());
  mergeList.appendChild(addMore);
}

mergeClearBtn.addEventListener('click', () => {
  mergeFiles = [];
  renderMergeList();
  mergeDrop.style.display = '';
});

mergeBtn.addEventListener('click', async () => {
  if (mergeFiles.length < 2) return alert('2개 이상의 PDF를 추가하세요.');
  showLoading('PDF 합치는 중...');
  try {
    const bytes = await mergePDFs(mergeFiles.map(f => ({ data: f.data, name: f.name })));
    downloadBlob(bytes, 'merged.pdf');
  } catch (err) {
    alert('합치기 실패: ' + err.message);
  } finally {
    hideLoading();
  }
});

// ══════════════════════════════════════════
// SPLIT / REORDER
// ══════════════════════════════════════════

const splitSelectedCount = document.getElementById('split-selected-count');

setupDropZone(splitDrop, async (files) => {
  const file = [...files].find(f => f.name.toLowerCase().endsWith('.pdf'));
  if (!file) return alert('PDF 파일만 지원합니다.');
  await loadSplitFile(file);
});

splitAddBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  splitFileInput.click();
});
splitDrop.addEventListener('click', () => splitFileInput.click());

splitFileInput.addEventListener('change', async () => {
  if (splitFileInput.files[0]) {
    await loadSplitFile(splitFileInput.files[0]);
    splitFileInput.value = '';
  }
});

async function loadSplitFile(file) {
  showLoading('PDF 로딩 중...');
  try {
    const data = await file.arrayBuffer();
    const pageCount = await getPDFPageCount(data);
    splitFile = { name: file.name, data, pageCount };

    // Init page order: all selected, original order
    pageOrder = [];
    for (let i = 1; i <= pageCount; i++) {
      pageOrder.push({ origPage: i, selected: true, canvas: null });
    }

    splitDrop.style.display = 'none';
    splitInfo.style.display = 'block';
    splitFilename.textContent = file.name;
    splitPagecount.textContent = `${pageCount}페이지`;

    await renderThumbnails(data, pageCount);
    renderPageList();
  } catch (err) {
    alert('PDF 로드 실패: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function renderThumbnails(data, pageCount) {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) return;

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  const loadingTask = pdfjsLib.getDocument({ data: data.slice(0) });
  const pdf = await loadingTask.promise;

  const maxThumbs = Math.min(pageCount, 100);
  for (let i = 1; i <= maxThumbs; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 0.4 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    pageOrder[i - 1].canvas = canvas;
  }
}

function renderPageList() {
  splitPreview.innerHTML = '';
  const selectedCount = pageOrder.filter(p => p.selected).length;
  splitSelectedCount.textContent = `(${selectedCount}/${pageOrder.length} 선택됨)`;

  pageOrder.forEach((page, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'page-thumb' + (page.selected ? ' selected' : ' deselected');
    thumb.draggable = true;
    thumb.dataset.idx = idx;

    // Order badge
    const order = document.createElement('div');
    order.className = 'page-order';
    order.textContent = idx + 1;
    thumb.appendChild(order);

    // Canvas
    if (page.canvas) {
      const canvasClone = document.createElement('canvas');
      canvasClone.width = page.canvas.width;
      canvasClone.height = page.canvas.height;
      canvasClone.getContext('2d').drawImage(page.canvas, 0, 0);
      thumb.appendChild(canvasClone);
    }

    // Footer with checkbox and page number
    const footer = document.createElement('div');
    footer.className = 'page-footer';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = page.selected;
    cb.addEventListener('change', () => {
      page.selected = cb.checked;
      renderPageList();
    });
    const num = document.createElement('span');
    num.className = 'page-num';
    num.textContent = `p${page.origPage}`;
    footer.appendChild(cb);
    footer.appendChild(num);
    thumb.appendChild(footer);

    // ── Drag reorder ──
    thumb.addEventListener('dragstart', (e) => {
      thumb.classList.add('dragging');
      e.dataTransfer.setData('text/plain', idx);
      e.dataTransfer.effectAllowed = 'move';
    });
    thumb.addEventListener('dragend', () => {
      thumb.classList.remove('dragging');
      document.querySelectorAll('.page-thumb').forEach(t => {
        t.classList.remove('drag-over-left', 'drag-over-right');
      });
    });
    thumb.addEventListener('dragover', (e) => {
      e.preventDefault();
      const rect = thumb.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      thumb.classList.remove('drag-over-left', 'drag-over-right');
      if (e.clientX < midX) {
        thumb.classList.add('drag-over-left');
      } else {
        thumb.classList.add('drag-over-right');
      }
    });
    thumb.addEventListener('dragleave', () => {
      thumb.classList.remove('drag-over-left', 'drag-over-right');
    });
    thumb.addEventListener('drop', (e) => {
      e.preventDefault();
      thumb.classList.remove('drag-over-left', 'drag-over-right');
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      let toIdx = idx;
      // Determine insert position based on drop side
      const rect = thumb.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (e.clientX >= midX && toIdx < pageOrder.length - 1) {
        toIdx = toIdx + 1;
      }
      if (fromIdx !== toIdx) {
        const [moved] = pageOrder.splice(fromIdx, 1);
        const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
        pageOrder.splice(insertAt, 0, moved);
        renderPageList();
      }
    });

    splitPreview.appendChild(thumb);
  });
}

// Toolbar buttons
document.getElementById('select-all-btn').addEventListener('click', () => {
  pageOrder.forEach(p => p.selected = true);
  renderPageList();
});
document.getElementById('deselect-all-btn').addEventListener('click', () => {
  pageOrder.forEach(p => p.selected = false);
  renderPageList();
});
document.getElementById('invert-select-btn').addEventListener('click', () => {
  pageOrder.forEach(p => p.selected = !p.selected);
  renderPageList();
});

splitRemoveBtn.addEventListener('click', () => {
  splitFile = null;
  pageOrder = [];
  splitDrop.style.display = '';
  splitInfo.style.display = 'none';
  splitPreview.innerHTML = '';
});

// Split mode radio
document.querySelectorAll('input[name="split-mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    rangeInputWrap.style.display = radio.value === 'range' && radio.checked ? 'block' : 'none';
  });
});

splitBtn.addEventListener('click', async () => {
  if (!splitFile) return;
  const mode = document.querySelector('input[name="split-mode"]:checked').value;
  const baseName = splitFile.name.replace(/\.pdf$/i, '');

  // Get selected pages in current order (0-based indices into original PDF)
  const selectedPages = pageOrder
    .filter(p => p.selected)
    .map(p => p.origPage - 1);

  if (selectedPages.length === 0) {
    return alert('최소 1개 페이지를 선택하세요.');
  }

  showLoading('PDF 처리 중...');
  try {
    if (mode === 'save-reorder') {
      const bytes = await reorderPages(splitFile.data, selectedPages);
      downloadBlob(bytes, `${baseName}_edited.pdf`);
    } else if (mode === 'all') {
      const results = [];
      for (const pageIdx of selectedPages) {
        const bytes = await reorderPages(splitFile.data, [pageIdx]);
        results.push({ bytes, label: `${baseName}_page_${pageIdx + 1}` });
      }
      downloadZip(results);
    } else if (mode === 'range') {
      const rangeText = document.getElementById('split-range').value;
      const results = await splitByRanges(splitFile.data, rangeText);
      results.forEach(r => r.label = `${baseName}_${r.label}`);
      downloadZip(results);
    }
  } catch (err) {
    alert('처리 실패: ' + err.message);
  } finally {
    hideLoading();
  }
});

// ══════════════════════════════════════════
// Drop zone helper
// ══════════════════════════════════════════

function setupDropZone(el, onFiles) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.classList.add('dragover');
  });
  el.addEventListener('dragleave', () => {
    el.classList.remove('dragover');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      onFiles(e.dataTransfer.files);
    }
  });
}

// Prevent browser default file open
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());
