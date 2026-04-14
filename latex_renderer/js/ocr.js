/**
 * OCR module: image paste/drag/upload → pix2tex server → LaTeX insertion.
 */
(function () {
  const OCR_URL = 'http://localhost:5000/ocr';

  const dropzone = document.getElementById('ocr-dropzone');
  const fileInput = document.getElementById('ocr-file-input');
  const browseBtn = document.getElementById('ocr-browse-btn');
  const preview = document.getElementById('ocr-preview');
  const status = document.getElementById('ocr-status');
  const input = document.getElementById('latex-input');

  // --- Browse button ---
  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      processFile(fileInput.files[0]);
    }
    fileInput.value = '';
  });

  // --- Drag & Drop ---
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      processFile(file);
    }
  });

  // --- Click dropzone to browse ---
  dropzone.addEventListener('click', () => {
    fileInput.click();
  });

  // --- Paste (Ctrl+V) anywhere on page ---
  document.addEventListener('paste', (e) => {
    // Only intercept if not typing in textarea (or if paste has image)
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) processFile(file);
        return;
      }
    }
  });

  // --- Process image file ---
  function processFile(file) {
    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.src = e.target.result;
      preview.classList.remove('hidden');
      sendToOCR(e.target.result);
    };
    reader.readAsDataURL(file);
  }

  // --- Send to OCR server ---
  async function sendToOCR(dataUrl) {
    setStatus('Recognizing...', 'loading');

    try {
      const resp = await fetch(OCR_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${resp.status}`);
      }

      const data = await resp.json();

      if (data.latex) {
        insertLatex(data.latex);
        setStatus('Done!', 'success');
        setTimeout(() => setStatus(''), 2000);
      } else {
        throw new Error('No LaTeX returned');
      }
    } catch (err) {
      if (err.message.includes('Failed to fetch')) {
        setStatus('Server offline — run: python server.py', 'error');
      } else {
        setStatus('Error: ' + err.message, 'error');
      }
    }
  }

  // --- Insert LaTeX at cursor or append ---
  function insertLatex(latex) {
    const pos = input.selectionStart;
    const before = input.value.substring(0, pos);
    const after = input.value.substring(input.selectionEnd);

    // Add blank line separation if needed
    const sep = before.length > 0 && !before.endsWith('\n\n') ? '\n\n' : '';
    input.value = before + sep + latex + after;
    input.selectionStart = input.selectionEnd = pos + sep.length + latex.length;
    input.focus();
    input.dispatchEvent(new Event('input'));
  }

  // --- Status display ---
  function setStatus(text, type) {
    status.textContent = text;
    status.className = type || '';
  }
})();
