/**
 * Autocomplete engine for LaTeX commands in a textarea.
 */
class Autocomplete {
  constructor(textarea, dropdown) {
    this.textarea = textarea;
    this.dropdown = dropdown;
    this.items = [];
    this.selectedIndex = -1;
    this.active = false;
    this.onAccept = null; // callback(insertedText) after accepting

    this._bindEvents();
  }

  _bindEvents() {
    this.textarea.addEventListener('input', () => this._onInput());
    this.textarea.addEventListener('keydown', (e) => this._onKeyDown(e));
    this.textarea.addEventListener('blur', () => {
      // Delay to allow click on dropdown item
      setTimeout(() => this.close(), 150);
    });
    this.textarea.addEventListener('click', () => this.close());
  }

  _onInput() {
    const match = this._getCommandAtCursor();
    if (match && match.length >= 2) {
      this._filter(match);
    } else {
      this.close();
    }
  }

  _onKeyDown(e) {
    if (!this.active) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._moveSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._moveSelection(-1);
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (this.selectedIndex >= 0 && this.selectedIndex < this.items.length) {
        e.preventDefault();
        this._accept(this.items[this.selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  /**
   * Extract the LaTeX command being typed at cursor position.
   * Looks backward from cursor for `\` followed by letters.
   */
  _getCommandAtCursor() {
    const pos = this.textarea.selectionStart;
    const text = this.textarea.value;
    // Search backward for `\`
    let start = pos - 1;
    while (start >= 0 && /[a-zA-Z]/.test(text[start])) {
      start--;
    }
    if (start >= 0 && text[start] === '\\') {
      return text.substring(start, pos);
    }
    return null;
  }

  _filter(typed) {
    const lower = typed.toLowerCase();
    this.items = AUTOCOMPLETE_DICT.filter(cmd =>
      cmd.name.toLowerCase().startsWith(lower)
    ).slice(0, 15);

    if (this.items.length === 0) {
      this.close();
      return;
    }

    this.active = true;
    this.selectedIndex = 0;
    this._renderDropdown(typed);
    this._positionDropdown();
  }

  _renderDropdown(typed) {
    this.dropdown.innerHTML = '';
    this.items.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'ac-item' + (i === this.selectedIndex ? ' selected' : '');
      el.innerHTML = `<span class="ac-name">${this._highlight(item.name, typed)}</span><span class="ac-desc">${item.desc}</span>`;
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._accept(item);
      });
      el.addEventListener('mouseenter', () => {
        this.selectedIndex = i;
        this._updateSelection();
      });
      this.dropdown.appendChild(el);
    });
    this.dropdown.classList.remove('hidden');
  }

  _highlight(name, typed) {
    const matchLen = typed.length;
    return `<strong>${name.substring(0, matchLen)}</strong>${name.substring(matchLen)}`;
  }

  _updateSelection() {
    const children = this.dropdown.children;
    for (let i = 0; i < children.length; i++) {
      children[i].classList.toggle('selected', i === this.selectedIndex);
    }
    // Scroll into view
    if (children[this.selectedIndex]) {
      children[this.selectedIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  _moveSelection(delta) {
    this.selectedIndex = Math.max(0, Math.min(this.items.length - 1, this.selectedIndex + delta));
    this._updateSelection();
  }

  _accept(item) {
    const pos = this.textarea.selectionStart;
    const text = this.textarea.value;

    // Find the start of the command being typed
    let start = pos - 1;
    while (start >= 0 && /[a-zA-Z]/.test(text[start])) {
      start--;
    }
    // start is at `\`

    const before = text.substring(0, start);
    const after = text.substring(pos);

    let insertText, cursorPos;
    if (item.snippet) {
      insertText = item.snippet;
      cursorPos = start + item.cursorInSnippet;
    } else {
      insertText = item.name + ' ';
      cursorPos = start + insertText.length;
    }

    this.textarea.value = before + insertText + after;
    this.textarea.selectionStart = this.textarea.selectionEnd = cursorPos;
    this.textarea.focus();
    this.close();

    // Trigger input event for re-render
    this.textarea.dispatchEvent(new Event('input'));
  }

  _positionDropdown() {
    const coords = this._getCursorCoords();
    this.dropdown.style.left = coords.left + 'px';
    this.dropdown.style.top = coords.top + 'px';
  }

  /**
   * Calculate pixel coordinates of the cursor in the textarea
   * using the mirror-div technique.
   */
  _getCursorCoords() {
    const ta = this.textarea;
    const mirror = document.createElement('div');
    const style = getComputedStyle(ta);
    const props = [
      'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
      'letterSpacing', 'wordSpacing', 'textIndent',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'whiteSpace', 'wordWrap', 'overflowWrap', 'tabSize'
    ];

    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.width = style.width;
    props.forEach(p => mirror.style[p] = style[p]);

    const text = ta.value.substring(0, ta.selectionStart);
    const textNode = document.createTextNode(text);
    const span = document.createElement('span');
    span.textContent = '|';

    mirror.appendChild(textNode);
    mirror.appendChild(span);
    document.body.appendChild(mirror);

    const taRect = ta.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();

    const left = spanRect.left - mirrorRect.left;
    const top = spanRect.top - mirrorRect.top - ta.scrollTop + parseInt(style.lineHeight || style.fontSize);

    document.body.removeChild(mirror);

    // Clamp within editor-wrapper
    const wrapperRect = ta.parentElement.getBoundingClientRect();
    const clampedLeft = Math.min(left, wrapperRect.width - 220);

    return {
      left: Math.max(0, clampedLeft),
      top: Math.min(top, wrapperRect.height - 50)
    };
  }

  close() {
    this.active = false;
    this.items = [];
    this.selectedIndex = -1;
    this.dropdown.classList.add('hidden');
  }
}
