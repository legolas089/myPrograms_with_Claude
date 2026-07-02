"use strict";

const state = {
  programs: [],
  tabs: new Map(), // id -> { program, tabEl, frameEl }
  activeId: null,
};

// ── boot ──────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch("/api/programs");
    state.programs = await res.json();
  } catch (e) {
    state.programs = [];
  }
  renderSidebar();
  wireChrome();
}

// ── sidebar ───────────────────────────────────────────
function renderSidebar() {
  const root = document.getElementById("program-list");
  root.innerHTML = "";

  const groups = orderedGroups(state.programs);
  groups.forEach((group, gi) => {
    if (gi > 0) {
      const div = document.createElement("div");
      div.className = "group-divider";
      root.appendChild(div);
    }
    const gl = document.createElement("div");
    gl.className = "group-label";
    gl.textContent = group.name;
    root.appendChild(gl);

    group.categories.forEach((cat) => {
      if (cat.name && cat.name !== group.name) {
        const cl = document.createElement("div");
        cl.className = "cat-label";
        cl.textContent = cat.name;
        root.appendChild(cl);
      }
      cat.items.forEach((p) => root.appendChild(makeProgItem(p)));
    });
  });
}

function orderedGroups(programs) {
  // Groups and categories are ordered by first appearance in the registry
  // (programs.json) — adding a new group/category there "just works", no code
  // changes here. Map preserves insertion order.
  const byGroup = new Map();
  programs.forEach((p) => {
    if (!byGroup.has(p.group)) byGroup.set(p.group, new Map());
    const cats = byGroup.get(p.group);
    if (!cats.has(p.category)) cats.set(p.category, []);
    cats.get(p.category).push(p);
  });
  return [...byGroup.entries()].map(([name, cats]) => ({
    name,
    categories: [...cats.entries()].map(([cname, items]) => ({ name: cname, items })),
  }));
}

function makeProgItem(p) {
  const el = document.createElement("div");
  el.className = "prog-item" + (p.mode === "cli" ? " cli" : "");
  el.dataset.id = p.id;
  el.title = p.blurb || p.name;
  el.innerHTML =
    `<i class="ti ${p.icon || "ti-app-window"}"></i>` +
    `<span class="name">${escapeHtml(p.name)}</span>` +
    (p.mode === "cli" ? `<span class="badge">CLI</span>` : "");
  el.addEventListener("click", () => launch(p));
  return el;
}

// ── launching ─────────────────────────────────────────
function launch(p) {
  if (p.mode === "cli") return launchCli(p);
  if (state.tabs.has(p.id)) return activateTab(p.id);

  const frame = document.createElement("iframe");
  frame.src = "/" + p.folder + "/";
  frame.dataset.id = p.id;
  document.getElementById("host").appendChild(frame);

  const tab = document.createElement("div");
  tab.className = "tab";
  tab.dataset.id = p.id;
  tab.innerHTML =
    `<i class="ti ${p.icon || "ti-app-window"} tab-icon"></i>` +
    `<span class="tab-name">${escapeHtml(p.name)}</span>` +
    `<i class="ti ti-x tab-close" title="Close"></i>`;
  tab.addEventListener("click", (e) => {
    if (e.target.classList.contains("tab-close")) closeTab(p.id);
    else activateTab(p.id);
  });
  document.getElementById("tabstrip").appendChild(tab);

  state.tabs.set(p.id, { program: p, tabEl: tab, frameEl: frame });
  activateTab(p.id);
}

function activateTab(id) {
  state.activeId = id;
  document.getElementById("empty-state").classList.add("hidden");
  state.tabs.forEach((t, tid) => {
    const on = tid === id;
    t.tabEl.classList.toggle("active", on);
    t.frameEl.style.display = on ? "block" : "none";
  });
  document.querySelectorAll(".prog-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === id);
  });
}

function closeTab(id) {
  const t = state.tabs.get(id);
  if (!t) return;
  t.tabEl.remove();
  t.frameEl.remove();
  state.tabs.delete(id);

  if (state.activeId === id) {
    const next = [...state.tabs.keys()].pop();
    if (next) activateTab(next);
    else showEmpty();
  }
}

function showEmpty() {
  state.activeId = null;
  document.getElementById("empty-state").classList.remove("hidden");
  document.querySelectorAll(".prog-item").forEach((el) => el.classList.remove("active"));
}

// ── CLI programs ──────────────────────────────────────
async function launchCli(p) {
  document.getElementById("cli-title").textContent = p.name;
  document.getElementById("cli-blurb").textContent = p.blurb || "";
  document.getElementById("cli-commands").textContent = (p.commands || []).join("\n");
  document.getElementById("cli-modal").classList.remove("hidden");
  try {
    await fetch("/api/run-cli", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id }),
    });
  } catch (e) {
    /* terminal may be blocked; the card still shows the commands */
  }
}

// ── downloads ─────────────────────────────────────────
function wireChrome() {
  const panel = document.getElementById("downloads-panel");
  const btn = document.getElementById("btn-downloads");
  btn.addEventListener("click", () => {
    const show = panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !show);
    btn.classList.toggle("active", show);
    if (show) refreshDownloads();
  });
  document.getElementById("btn-close-dl").addEventListener("click", () => {
    panel.classList.add("hidden");
    btn.classList.remove("active");
  });
  document.getElementById("btn-refresh-dl").addEventListener("click", refreshDownloads);
  document.getElementById("btn-open-folder").addEventListener("click", () => {
    fetch("/api/open-folder", { method: "POST" });
  });
  document.getElementById("cli-close").addEventListener("click", () => {
    document.getElementById("cli-modal").classList.add("hidden");
  });
}

async function refreshDownloads() {
  const list = document.getElementById("downloads-list");
  list.innerHTML = `<div class="dl-empty">Loading…</div>`;
  let files = [];
  try {
    files = await (await fetch("/api/downloads")).json();
  } catch (e) {
    files = [];
  }
  if (!files.length) {
    list.innerHTML = `<div class="dl-empty">No files in your Downloads folder.</div>`;
    return;
  }
  list.innerHTML = "";
  files.forEach((f) => {
    const row = document.createElement("div");
    row.className = "dl-item";
    row.title = f.name;
    const k = fileKind(f.ext);
    row.innerHTML =
      `<i class="ti ${k.icon} ft-${k.cls}"></i>` +
      `<div class="dl-meta">` +
      `<div class="dl-name">${escapeHtml(f.name)}</div>` +
      `<div class="dl-sub">${relTime(f.mtime)} · ${fmtSize(f.size)}</div>` +
      `</div>`;
    row.addEventListener("click", () => {
      fetch("/api/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: f.path }),
      });
    });
    list.appendChild(row);
  });
}

// ── small helpers ─────────────────────────────────────
function fileKind(ext) {
  if (["stl", "step", "stp", "obj", "3mf", "gltf", "glb"].includes(ext))
    return { icon: "ti-file-3d", cls: "model" };
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"].includes(ext))
    return { icon: "ti-photo", cls: "image" };
  if (ext === "pdf") return { icon: "ti-file-text", cls: "pdf" };
  if (["csv", "json", "xlsx", "xls", "tsv"].includes(ext))
    return { icon: "ti-table", cls: "data" };
  if (["doc", "docx", "txt", "md", "tex"].includes(ext))
    return { icon: "ti-file-description", cls: "doc" };
  return { icon: "ti-file", cls: "other" };
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function relTime(mtimeSec) {
  const diff = Date.now() / 1000 - mtimeSec;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + " min ago";
  if (diff < 86400) return Math.floor(diff / 3600) + " h ago";
  return Math.floor(diff / 86400) + " d ago";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

init();
