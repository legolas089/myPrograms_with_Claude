/**
 * Main application logic: rendering, font size slider, line spacing,
 * snippet buttons, saved formulas, PNG copy.
 */
(function () {
  const input = document.getElementById('latex-input');
  const output = document.getElementById('render-output');
  const errorEl = document.getElementById('render-error');
  const slider = document.getElementById('font-size-slider');
  const sizeVal = document.getElementById('font-size-val');
  const lineSlider = document.getElementById('line-spacing-slider');
  const lineVal = document.getElementById('line-spacing-val');
  const dropdown = document.getElementById('autocomplete-dropdown');
  const copyBtn = document.getElementById('copy-btn');
  const copyToast = document.getElementById('copy-toast');
  const saveBtn = document.getElementById('save-formula-btn');
  const savedBar = document.getElementById('saved-bar');

  // --- Multi-line KaTeX Rendering ---
  let debounceTimer = null;

  function render() {
    const raw = input.value.trim();
    if (!raw) {
      output.innerHTML = '<span style="color:#999;">Enter LaTeX to preview</span>';
      errorEl.classList.add('hidden');
      return;
    }

    // Split by blank lines into separate formula blocks
    const blocks = raw.split(/\n\s*\n/).filter(b => b.trim());
    output.innerHTML = '';
    let hasError = false;
    let firstError = '';

    blocks.forEach(block => {
      // Wrap in \displaystyle so sum/int/prod show limits above/below
      const latex = `\\displaystyle ${block.trim()}`;
      const div = document.createElement('div');
      div.className = 'formula-block';

      try {
        katex.render(latex, div, {
          displayMode: false, // inline mode for auto line-breaking at operators
          throwOnError: true,
          trust: true,
        });
      } catch (e) {
        try {
          katex.render(latex, div, {
            displayMode: false,
            throwOnError: false,
            trust: true,
          });
        } catch (_) {
          div.className = 'formula-error';
          div.textContent = 'Error: ' + latex;
        }
        if (!hasError) firstError = e.message;
        hasError = true;
      }

      output.appendChild(div);
    });

    if (hasError) {
      errorEl.textContent = firstError;
      errorEl.classList.remove('hidden');
    } else {
      errorEl.classList.add('hidden');
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, 150);
  });

  // --- Font Size Slider ---
  function updateFontSize() {
    const size = slider.value;
    output.style.fontSize = size + 'px';
    sizeVal.textContent = size + 'px';
  }

  slider.addEventListener('input', updateFontSize);

  // --- Line Spacing Slider ---
  function updateLineSpacing() {
    const gap = lineSlider.value;
    lineVal.textContent = gap + 'px';
    output.style.setProperty('--formula-gap', gap + 'px');
  }

  lineSlider.addEventListener('input', updateLineSpacing);

  // --- Copy as PNG (html2canvas) ---
  copyBtn.addEventListener('click', async () => {
    try {
      const canvas = await html2canvas(output, {
        backgroundColor: '#ffffff',
        scale: 3,
      });
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          showToast();
          copyBtn.textContent = 'Copied!';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = 'Copy PNG';
            copyBtn.classList.remove('copied');
          }, 1500);
        } catch (err) {
          // Fallback: download as file
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'latex-formula.png';
          a.click();
          URL.revokeObjectURL(a.href);
        }
      }, 'image/png');
    } catch (err) {
      console.error('Copy failed:', err);
    }
  });

  function showToast() {
    copyToast.classList.remove('hidden', 'show');
    void copyToast.offsetWidth;
    copyToast.classList.add('show');
    setTimeout(() => {
      copyToast.classList.remove('show');
      copyToast.classList.add('hidden');
    }, 1200);
  }

  // --- Snippet Buttons ---
  document.querySelectorAll('.snippet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.snippet;
      const snip = SNIPPETS[key];
      if (!snip) return;
      insertSnippet(snip.text, snip.cursor);
    });
  });

  function insertSnippet(text, cursorOffset) {
    const pos = input.selectionStart;
    const before = input.value.substring(0, pos);
    const after = input.value.substring(input.selectionEnd);

    input.value = before + text + after;
    input.selectionStart = input.selectionEnd = pos + cursorOffset;
    input.focus();
    input.dispatchEvent(new Event('input'));
  }

  // --- Saved Formulas (localStorage) ---
  const STORAGE_KEY = 'latex-renderer-saved';

  function loadSaved() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveSavedList(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function renderSavedBar() {
    savedBar.innerHTML = '';
    const list = loadSaved();
    list.forEach((item, idx) => {
      const btn = document.createElement('button');
      btn.className = 'saved-btn';
      btn.title = item.latex;

      const label = document.createElement('span');
      label.textContent = item.name;
      btn.appendChild(label);

      const del = document.createElement('span');
      del.className = 'saved-delete';
      del.textContent = '\u00d7';
      del.title = 'Delete';
      btn.appendChild(del);

      // Click label → insert formula
      label.addEventListener('click', () => {
        input.value = item.latex;
        input.focus();
        input.dispatchEvent(new Event('input'));
      });

      // Click × → delete
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const list = loadSaved();
        list.splice(idx, 1);
        saveSavedList(list);
        renderSavedBar();
      });

      savedBar.appendChild(btn);
    });
  }

  saveBtn.addEventListener('click', () => {
    const latex = input.value.trim();
    if (!latex) return;

    // Prompt for a short name
    const name = prompt('Save formula as:', latex.substring(0, 30));
    if (!name) return;

    const list = loadSaved();
    list.push({ name: name.substring(0, 40), latex });
    saveSavedList(list);
    renderSavedBar();
  });

  // --- Autocomplete ---
  const ac = new Autocomplete(input, dropdown);

  // --- Initial render ---
  function init() {
    updateFontSize();
    updateLineSpacing();
    renderSavedBar();
    render();
  }

  if (typeof katex !== 'undefined') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
