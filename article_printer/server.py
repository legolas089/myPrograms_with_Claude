"""Article Printer backend.

Fetches web pages (news, wiki, blog), extracts the main article body with
trafilatura (readability-lxml as fallback), and renders the user-composed
document to a single PDF with headless Chrome/Edge.

Serves the static frontend too, so `python server.py` alone is a full app:
    http://localhost:5001

API
    GET  /api/health            -> {ok, chrome}
    POST /api/extract {url}     -> article JSON (title, meta, blocks[])
    POST /api/extract {html|text, url?, title?} -> same, from pasted content
    POST /api/pdf {html, filename} -> writes <Downloads>/<filename>.pdf
    POST /api/open {path}       -> opens a file inside Downloads
"""

# Lazy annotations so `tuple[str, str]` etc. also run on Python 3.8.
from __future__ import annotations

import os
import re
import sys
import json
import html as htmlmod
import shutil
import tempfile
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, urljoin, parse_qs

import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from lxml import html as lxml_html
import trafilatura

HERE = Path(__file__).resolve().parent
DOWNLOADS_DIR = Path.home() / "Downloads"
API_PORT = 5001
MAX_URLS = 10
FETCH_TIMEOUT = 25

UA_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}

CHROME_CANDIDATES = [
    (r"C:\Program Files\Google\Chrome\Application\chrome.exe", "--headless=new"),
    (r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe", "--headless=new"),
    (os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"), "--headless=new"),
    (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "--headless"),
    (r"C:\Program Files\Microsoft\Edge\Application\msedge.exe", "--headless"),
]

app = Flask(__name__, static_folder=str(HERE), static_url_path="")
CORS(app)


# ── static frontend ───────────────────────────────────────────────
@app.route("/")
def index():
    return send_from_directory(HERE, "index.html")


# ── site adapters ─────────────────────────────────────────────────
# XPath lists of junk to strip BEFORE extraction, keyed by host suffix.
# XPath (not CSS) so we need no extra dependency.
JUNK_XPATH = {
    "wikipedia.org": [
        "//*[contains(@class,'mw-editsection')]",
        "//sup[contains(@class,'reference')]",
        "//*[contains(@class,'reflist')]",
        "//*[contains(@class,'navbox')]",
        "//*[@id='toc']",
        "//*[contains(@class,'mw-jump-link')]",
        "//*[contains(@class,'hatnote')]",
        "//*[contains(@class,'ambox')]",
        "//*[contains(@class,'sistersitebox')]",
        "//*[contains(@class,'metadata')]",
        "//*[@id='catlinks']",
        "//*[contains(@class,'mw-authority-control')]",
        "//*[contains(@class,'printfooter')]",
        "//*[@id='mw-navigation']",
        "//*[@id='footer']",
        "//*[contains(@class,'noprint')]",
        "//*[contains(@class,'vertical-navbox')]",
    ],
    "naver.com": [
        "//*[contains(@class,'Disclaimer')]",
        "//*[contains(@class,'CategorizeGuide')]",
        "//*[@id='wa_categorize_guide']",
        "//*[contains(@class,'media_end_linked_more')]",
        "//*[contains(@class,'copyright')]",
        "//*[contains(@class,'media_end_head_journalist')]",
    ],
    "namu.wiki": [
        "//*[contains(@class,'wiki-category')]",
        "//*[contains(@class,'wiki-footnote')]",
    ],
}

# Trailing-paragraph patterns that are never article body (copyright, "무단전재" etc.)
TAIL_JUNK_RE = re.compile(
    r"(무단\s*전재|재배포\s*금지|All rights reserved|Copyright\s*[©ⓒ]|저작권자\s*[©ⓒ]|"
    r"^\s*[\w.+-]+@[\w-]+\.[\w.]+\s*$|오분류\s*제보|기사\s*섹션\s*분류\s*안내)",
    re.IGNORECASE,
)


def host_of(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""


def resolve_url(url: str) -> str:
    """Rewrite known 'wrapper' URLs to the page that actually holds the body."""
    host = host_of(url)
    p = urlparse(url)

    # Naver blog: the outer page is just a frame; the body is in PostView.naver.
    if host in ("blog.naver.com", "m.blog.naver.com"):
        qs = parse_qs(p.query)
        blog_id = (qs.get("blogId") or [None])[0]
        log_no = (qs.get("logNo") or [None])[0]
        if not (blog_id and log_no):
            m = re.match(r"^/([^/]+)/(\d+)/?$", p.path)
            if m:
                blog_id, log_no = m.group(1), m.group(2)
        if blog_id and log_no:
            return f"https://blog.naver.com/PostView.naver?blogId={blog_id}&logNo={log_no}&redirect=Dlog"
    return url


def fetch_html(url: str, _depth: int = 0) -> tuple[str, str]:
    """Download a page and return (decoded_html, final_url)."""
    r = requests.get(url, headers=UA_HEADERS, timeout=FETCH_TIMEOUT, allow_redirects=True)
    r.raise_for_status()
    ctype = r.headers.get("Content-Type", "")
    if "charset" not in ctype.lower():
        # requests defaults to ISO-8859-1 for text/* with no charset -> wrong for EUC-KR/UTF-8 pages
        r.encoding = r.apparent_encoding
    text = r.text

    # Naver blog outer page (when resolve_url could not parse ids): follow the mainFrame.
    if _depth == 0 and host_of(r.url).endswith("blog.naver.com") and "PostView" not in r.url:
        m = re.search(r'id="mainFrame"[^>]*src="([^"]+)"', text)
        if m:
            inner = urljoin(r.url, htmlmod.unescape(m.group(1)))
            return fetch_html(inner, _depth=1)
    return text, r.url


def parse_html(text: str):
    try:
        return lxml_html.fromstring(text)
    except ValueError:
        # "Unicode strings with encoding declaration are not supported"
        return lxml_html.fromstring(text.encode("utf-8"))


def pre_clean(text: str, url: str) -> str:
    host = host_of(url)
    xpaths = []
    for suffix, xp in JUNK_XPATH.items():
        if host == suffix or host.endswith("." + suffix):
            xpaths.extend(xp)
    if not xpaths:
        return text
    try:
        root = parse_html(text)
    except Exception:  # noqa: BLE001 - fall back to the raw page
        return text
    for xp in xpaths:
        for el in root.xpath(xp):
            parent = el.getparent()
            if parent is not None:
                parent.remove(el)
    return lxml_html.tostring(root, encoding="unicode")


# ── extraction ────────────────────────────────────────────────────
def _absolutize_images(el, base_url: str):
    for img in el.iter("img"):
        # Lazy-loaded images carry a placeholder or a blurred thumbnail in src
        # (e.g. Naver SmartEditor's "?type=w80_blur"); the real file is in a data-* attribute.
        src = (img.get("data-lazy-src") or img.get("data-src") or img.get("data-original")
               or img.get("src") or "")
        if src:
            img.set("src", urljoin(base_url, src))
        for attr in ("srcset", "data-src", "data-lazy-src", "data-original",
                     "style", "class", "id", "onload", "onerror"):
            if attr in img.attrib:
                del img.attrib[attr]
        img.set("referrerpolicy", "no-referrer")


def _strip_unsafe(el):
    """Remove scripts, event handlers and inline styles from extracted content."""
    for bad in el.xpath(".//script|.//style|.//iframe|.//object|.//embed|.//form|.//input|.//button"):
        parent = bad.getparent()
        if parent is not None:
            parent.remove(bad)
    for node in el.iter():
        if not isinstance(node.tag, str):
            continue
        for attr in list(node.attrib):
            if attr.startswith("on") or attr in ("style", "id"):
                del node.attrib[attr]
        if node.tag == "a":
            href = node.get("href", "")
            if href.lower().startswith("javascript:"):
                del node.attrib["href"]


_INVISIBLE = {ord(c): " " for c in "​‌‍⁠﻿ "}
BLOCK_TAGS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "dl", "table",
              "pre", "blockquote", "figure", "img", "hr"}
WRAPPER_TAGS = {"div", "section", "article", "main", "span", "center", "font"}
_HAS_BLOCK_DESCENDANT = ".//p|.//h1|.//h2|.//h3|.//h4|.//h5|.//h6|.//ul|.//ol|.//table|.//figure|.//pre|.//blockquote|.//img"


def _collect_block_elements(el, out):
    """Flatten nested wrapper <div>s into a list of leaf block elements.

    Site editors (Naver SmartEditor, MediaWiki's .mw-heading wrappers, …) nest
    paragraphs several <div>s deep; we want one block per paragraph/figure/table.
    """
    for child in el:
        if not isinstance(child.tag, str):
            continue
        tag = child.tag.lower()
        if tag in BLOCK_TAGS:
            out.append(child)
        elif tag in WRAPPER_TAGS and child.xpath(_HAS_BLOCK_DESCENDANT):
            _collect_block_elements(child, out)
        else:
            out.append(child)
    return out


def _body_to_blocks(body, base_url: str):
    """Turn the (flattened) children of an element into renderable blocks."""
    blocks = []
    for child in _collect_block_elements(body, []):
        _strip_unsafe(child)
        _absolutize_images(child, base_url)
        tag = child.tag.lower()
        # Editors pad empty lines with zero-width spaces / NBSP; treat those as empty.
        text = " ".join(child.text_content().translate(_INVISIBLE).split())
        imgs = child.xpath(".//img|self::img")
        if tag == "img" or (not text and imgs):
            for img in imgs:
                src = img.get("src")
                if src:
                    blocks.append({
                        "type": "image", "src": src, "text": "",
                        "html": lxml_html.tostring(img, encoding="unicode", method="html"),
                    })
            continue
        if not text:
            continue
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            kind = "heading"
        elif tag == "table":
            kind = "table"
        else:
            kind = "text"
        blocks.append({
            "type": kind,
            "html": lxml_html.tostring(child, encoding="unicode", method="html"),
            "text": text,
        })
    return blocks


def _flag_tail_junk(blocks):
    """Pre-uncheck obvious boilerplate (copyright lines, bare e-mails) near the end."""
    for b in blocks:
        b["included"] = True
    for b in blocks[-6:]:
        if b["type"] == "text" and len(b["text"]) < 200 and TAIL_JUNK_RE.search(b["text"]):
            b["included"] = False


def extract_with_trafilatura(text: str, url: str):
    out = trafilatura.extract(
        text, url=url, output_format="html",
        include_images=True, include_tables=True, include_links=False,
        include_formatting=True, with_metadata=True,
    )
    if not out:
        return None
    root = parse_html(out)
    meta = {}
    for m in root.xpath("//meta[@name]"):
        meta[m.get("name")] = m.get("content") or ""
    body = root.find("body")
    if body is None:
        return None
    blocks = _body_to_blocks(body, url)
    if not any(b["type"] != "image" for b in blocks):
        return None
    return {
        "title": meta.get("title") or "",
        "author": meta.get("author") or "",
        "date": meta.get("date") or "",
        "sitename": meta.get("sitename") or host_of(url),
        "blocks": blocks,
        "engine": "trafilatura",
    }


def extract_with_readability(text: str, url: str):
    try:
        from readability import Document
    except ImportError:
        return None
    try:
        doc = Document(text, url=url)
        summary = doc.summary(html_partial=True)
        title = doc.short_title()
    except Exception:  # noqa: BLE001 - readability raises assorted parse errors
        return None
    root = parse_html(f"<div>{summary}</div>")
    # readability wraps everything in nested divs; descend to the first container with several children.
    body = root
    while len(body) == 1 and isinstance(body[0].tag, str) and body[0].tag in ("div", "article", "section"):
        body = body[0]
    blocks = _body_to_blocks(body, url)
    if not any(b["type"] != "image" for b in blocks):
        return None
    return {"title": title or "", "author": "", "date": "", "sitename": host_of(url),
            "blocks": blocks, "engine": "readability"}


def extract_from_plain_text(text: str, title: str):
    paras = [p.strip() for p in re.split(r"\n\s*\n", text.replace("\r\n", "\n")) if p.strip()]
    if not paras:
        paras = [p.strip() for p in text.splitlines() if p.strip()]
    blocks = [{
        "type": "text", "included": True,
        "html": "<p>" + htmlmod.escape(p).replace("\n", "<br>") + "</p>",
        "text": " ".join(p.split()),
    } for p in paras]
    return {"title": title, "author": "", "date": "", "sitename": "직접 입력", "blocks": blocks, "engine": "text"}


# Known body containers: when one of these exists we take its content directly
# (flattened), which keeps headings/images that generic extraction tends to drop.
CONTAINER_XPATH = {
    "wikipedia.org": ["//div[@id='mw-content-text']//div[contains(@class,'mw-parser-output')]"],
    "blog.naver.com": [
        "//div[contains(@class,'se-main-container')]",   # SmartEditor ONE
        "//div[@id='postViewArea']",                      # old editor
        "//div[contains(@class,'post-view')]",
    ],
    "m.blog.naver.com": [
        "//div[contains(@class,'se-main-container')]",
        "//div[@id='postViewArea']",
    ],
}


def _metadata(text: str, url: str):
    try:
        doc = trafilatura.extract_metadata(text, default_url=url)
    except Exception:  # noqa: BLE001
        doc = None
    if doc is None:
        return {"title": "", "author": "", "date": "", "sitename": host_of(url)}
    return {
        "title": doc.title or "",
        "author": doc.author or "",
        "date": doc.date or "",
        "sitename": doc.sitename or host_of(url),
    }


def extract_with_container(text: str, url: str):
    host = host_of(url)
    xpaths = []
    for suffix, xp in CONTAINER_XPATH.items():
        if host == suffix or host.endswith("." + suffix):
            xpaths.extend(xp)
    if not xpaths:
        return None
    try:
        root = parse_html(text)
    except Exception:  # noqa: BLE001
        return None
    for xp in xpaths:
        found = root.xpath(xp)
        if not found:
            continue
        blocks = _body_to_blocks(found[0], url)
        if sum(len(b["text"]) for b in blocks) < 200:
            continue
        result = _metadata(text, url)
        result.update({"blocks": blocks, "engine": "container"})
        return result
    return None


def extract_with_arc(text: str, url: str):
    """Arc XP (Fusion) sites such as chosun.com render the body client-side; the
    article is embedded as JSON in `Fusion.globalContent`."""
    m = re.search(r"Fusion\.globalContent\s*=\s*(\{.*?\});\s*Fusion\.", text, re.S)
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
    except ValueError:
        return None
    elements = data.get("content_elements") or []
    if not elements:
        return None

    parts = []
    for e in elements:
        kind = e.get("type")
        if kind == "text":
            parts.append(f"<p>{e.get('content', '')}</p>")
        elif kind == "header":
            lvl = min(max(int(e.get("level") or 2), 1), 6)
            parts.append(f"<h{lvl}>{e.get('content', '')}</h{lvl}>")
        elif kind == "list":
            tag = "ol" if e.get("list_type") == "ordered" else "ul"
            items = "".join(f"<li>{i.get('content', '')}</li>" for i in e.get("items", []) if isinstance(i, dict))
            parts.append(f"<{tag}>{items}</{tag}>")
        elif kind == "image":
            src = e.get("url") or ""
            if src:
                cap = htmlmod.escape(e.get("caption") or "")
                parts.append(f"<figure><img src=\"{htmlmod.escape(src)}\">"
                             f"{f'<figcaption>{cap}</figcaption>' if cap else ''}</figure>")
        elif kind == "quote":
            inner = "".join(f"<p>{c.get('content', '')}</p>" for c in e.get("content_elements", []) if isinstance(c, dict))
            parts.append(f"<blockquote>{inner}</blockquote>")
        elif kind == "raw_html":
            parts.append(f"<div>{e.get('content', '')}</div>")
    if not parts:
        return None
    root = parse_html("<div>" + "".join(parts) + "</div>")
    blocks = _body_to_blocks(root, url)
    if not any(b["type"] != "image" for b in blocks):
        return None

    credits = [c.get("name", "") for c in (data.get("credits") or {}).get("by", []) if isinstance(c, dict)]
    date = (data.get("display_date") or data.get("first_publish_date") or data.get("publish_date") or "")[:10]
    return {
        "title": (data.get("headlines") or {}).get("basic") or "",
        "author": ", ".join(c for c in credits if c),
        "date": date,
        "sitename": host_of(url),
        "blocks": blocks,
        "engine": "arc",
    }


def extract_article(text: str, url: str):
    cleaned = pre_clean(text, url)
    result = (extract_with_arc(text, url)
              or extract_with_container(cleaned, url)
              or extract_with_trafilatura(cleaned, url)
              or extract_with_readability(cleaned, url))
    if result is None:
        return None
    _flag_tail_junk(result["blocks"])
    return result


# ── API ───────────────────────────────────────────────────────────
def _chrome():
    for exe, flag in CHROME_CANDIDATES:
        if exe and os.path.isfile(exe):
            return exe, flag
    return None, None


@app.route("/api/health")
def health():
    exe, _ = _chrome()
    return jsonify({"ok": True, "chrome": bool(exe), "chrome_path": exe, "max_urls": MAX_URLS})


@app.route("/api/extract", methods=["POST"])
def api_extract():
    body = request.get_json(silent=True) or {}
    url = (body.get("url") or "").strip()
    pasted_html = body.get("html")
    pasted_text = body.get("text")
    title = (body.get("title") or "").strip()

    try:
        if pasted_text:
            result = extract_from_plain_text(pasted_text, title or "직접 입력한 글")
            result.update({"url": url, "finalUrl": url})
            return jsonify(result)

        if pasted_html:
            result = extract_article(pasted_html, url or "http://localhost/")
            if result is None:
                return jsonify({"error": "붙여넣은 HTML에서 본문을 찾지 못했습니다."}), 422
            if title:
                result["title"] = title
            result.update({"url": url, "finalUrl": url})
            return jsonify(result)

        if not url:
            return jsonify({"error": "URL이 비어 있습니다."}), 400
        if urlparse(url).scheme not in ("http", "https"):
            return jsonify({"error": "http/https 링크만 지원합니다."}), 400

        target = resolve_url(url)
        text, final_url = fetch_html(target)
        result = extract_article(text, final_url)
        if result is None:
            return jsonify({"error": "본문을 찾지 못했습니다. 로그인/JS 전용 페이지일 수 있습니다. "
                                     "'직접 입력'으로 붙여넣어 주세요."}), 422
        if not result["title"]:
            m = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
            result["title"] = " ".join(htmlmod.unescape(m.group(1)).split()) if m else url
        result.update({"url": url, "finalUrl": final_url})
        return jsonify(result)

    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else 0
        hint = (" (봇 차단일 수 있습니다. 브라우저에서 페이지 소스를 복사해 '직접 입력'하세요.)"
                if code in (403, 429, 503) else "")
        return jsonify({"error": f"페이지를 가져오지 못했습니다 (HTTP {code}).{hint}"}), 502
    except requests.RequestException as e:
        return jsonify({"error": f"네트워크 오류: {e.__class__.__name__}"}), 502
    except Exception as e:  # noqa: BLE001 - surface anything to the UI
        return jsonify({"error": f"추출 중 오류: {e.__class__.__name__}: {e}"}), 500


def _safe_pdf_name(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", (name or "").strip()).strip(". ")
    if not name:
        name = "articles_" + datetime.now().strftime("%Y-%m-%d_%H%M")
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    return name


def _unique_path(directory: Path, name: str) -> Path:
    path = directory / name
    stem, suffix = path.stem, path.suffix
    n = 1
    while path.exists():
        path = directory / f"{stem} ({n}){suffix}"
        n += 1
    return path


@app.route("/api/pdf", methods=["POST"])
def api_pdf():
    body = request.get_json(silent=True) or {}
    html_doc = body.get("html") or ""
    if not html_doc.strip():
        return jsonify({"error": "인쇄할 내용이 없습니다."}), 400

    exe, headless_flag = _chrome()
    if not exe:
        return jsonify({"error": "Chrome 또는 Edge를 찾지 못했습니다. '브라우저 인쇄'를 사용하세요."}), 501

    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = _unique_path(DOWNLOADS_DIR, _safe_pdf_name(body.get("filename", "")))

    tmpdir = Path(tempfile.mkdtemp(prefix="article_printer_"))
    try:
        html_path = tmpdir / "document.html"
        html_path.write_text(html_doc, encoding="utf-8")
        cmd = [
            exe, headless_flag, "--disable-gpu", "--no-first-run", "--no-default-browser-check",
            "--no-pdf-header-footer", "--virtual-time-budget=20000",
            f"--print-to-pdf={out_path}", html_path.as_uri(),
        ]
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180, creationflags=creationflags)
        if not out_path.exists() or out_path.stat().st_size == 0:
            tail = (proc.stderr or "")[-400:]
            return jsonify({"error": "PDF 생성에 실패했습니다. '브라우저 인쇄'를 사용하세요.", "detail": tail}), 500
        return jsonify({"ok": True, "path": str(out_path), "name": out_path.name, "size": out_path.stat().st_size})
    except subprocess.TimeoutExpired:
        return jsonify({"error": "PDF 생성 시간이 초과되었습니다 (이미지가 너무 많거나 느린 서버)."}), 504
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@app.route("/api/open", methods=["POST"])
def api_open():
    body = request.get_json(silent=True) or {}
    target = Path(body.get("path", ""))
    try:
        resolved = target.resolve()
        resolved.relative_to(DOWNLOADS_DIR.resolve())
        if not resolved.is_file():
            raise ValueError
    except (ValueError, OSError):
        return jsonify({"error": "invalid path"}), 400
    os.startfile(str(resolved))  # noqa: S606 - local user action, Windows
    return jsonify({"ok": True})


def run(open_browser: bool = False):
    if open_browser:
        import threading
        import webbrowser
        threading.Timer(0.8, lambda: webbrowser.open(f"http://localhost:{API_PORT}")).start()
    app.run(host="127.0.0.1", port=API_PORT, debug=False, threaded=True)


if __name__ == "__main__":
    run(open_browser="--open" in sys.argv)
