// app.js — UI wiring for the Rollout Diff tool.
// diff.js and sources.js load first and expose these globals.
const { diffConfigs, diffToMarkdown, formatValue, lineDiff, today } = RolloutDiff;
const { fetchRollouts, fetchCentralDefault, getAWFeature } = RolloutSources;

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const state = {
  entries: [], // normalized rollout entries from Experimenter
  central: null, // { config } once the mozilla-central default loads
  base: null, // selected baseline { kind, label, baseId, config }
  compareMode: "paste", // "paste" | "pick"
  pickConfig: null, // selected config in "pick" mode
  pickMap: {}, // <select> value -> config
  swap: false, // swap which side is "before"
  markdown: "", // last rendered changelog, for copy / download
};

// ── data loading ────────────────────────────────────────────────────────────
async function loadRollouts() {
  $("baseList").innerHTML = '<div class="src-empty">Loading rollouts from Experimenter…</div>';
  try {
    const { entries, errors } = await fetchRollouts();
    state.entries = entries;
    renderBaseList();
    renderPickOptions();
    if (errors.length > 0) {
      const note = document.createElement("div");
      note.className = "src-error";
      note.style.marginBottom = "10px";
      note.textContent = `Some data failed to load: ${errors.join("; ")}`;
      $("baseList").prepend(note);
    }
  } catch (e) {
    $("baseList").innerHTML = `<div class="src-error">Could not load rollouts — ${esc(e.message)}</div>`;
  }
}

async function loadCentralDefault() {
  $("centralRow").innerHTML = '<span class="src-loading">Loading mozilla-central default…</span>';
  try {
    const config = await fetchCentralDefault();
    state.central = { config };
    renderCentralRow(config);
    renderPickOptions();
  } catch (e) {
    state.central = null;
    $("centralRow").innerHTML = `<span class="src-error">Couldn’t parse mozilla-central default: ${esc(e.message)}</span>`;
  }
}

// ── baseline list (left pane) ─────────────────────────────────────────────────
function renderCentralRow(config) {
  const row = $("centralRow");
  const screenCount = (config.screens ?? []).length;
  row.innerHTML =
    `<div class="src-name">mozilla-central default <span class="badge badge-central">live default</span></div>` +
    `<div class="src-sub"><code>${esc(config.id ?? "MR_WELCOME_DEFAULT")}</code> · ${screenCount} screens</div>`;
  row.onclick = () =>
    selectBase({ kind: "central", label: "mozilla-central default", baseId: config.id ?? "MR_WELCOME_DEFAULT", config }, row);
}

function renderBaseList() {
  const list = $("baseList");
  list.innerHTML = "";
  const live = state.entries.filter((entry) => entry.isLive);
  const historical = state.entries.filter((entry) => !entry.isLive);
  if (live.length > 0) renderGroup("Live", live);
  if (historical.length > 0) renderGroup("Historical", historical);
  if (state.entries.length === 0) list.innerHTML = '<div class="src-empty">No aboutwelcome rollouts returned.</div>';
}

function renderGroup(label, entries) {
  const list = $("baseList");
  const header = document.createElement("div");
  header.className = "src-group";
  header.textContent = `${label} · ${entries.length}`;
  list.append(header);

  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "src-row";
    const branchTag = entry.branchSlug && entry.branchSlug !== "control"
      ? ` <span class="branch-tag">${esc(entry.branchSlug)}</span>` : "";
    const paused = entry.isEnrollmentPaused ? '<span class="badge badge-paused">paused</span>' : "";
    row.innerHTML =
      `<div class="src-name">${esc(entry.name)}${branchTag} ${paused}</div>` +
      `<div class="src-meta">${formatDates(entry)} · ${entry.screenCount} screens</div>`;
    row.onclick = () =>
      selectBase({ kind: "rollout", label: `${entry.name} / ${entry.branchSlug}`, baseId: entry.baseId, config: entry.config }, row);
    list.append(row);
  }
}

function selectBase(base, rowEl) {
  state.base = base;
  document.querySelectorAll(".src-row, #centralRow").forEach((row) => row.classList.remove("selected"));
  rowEl?.classList.add("selected");
  updateSwapLabel();
}

// ── compare side (right pane) ─────────────────────────────────────────────────
function setCompareMode(mode) {
  state.compareMode = mode;
  document.querySelectorAll("[data-cmp]").forEach((b) => b.classList.toggle("active", b.dataset.cmp === mode));
  $("pasteWrap").style.display = mode === "paste" ? "block" : "none";
  $("pickWrap").style.display = mode === "pick" ? "block" : "none";
  updateSwapLabel();
}

function renderPickOptions() {
  const select = $("pickSelect");
  const previous = select.value;
  select.innerHTML = '<option value="">— choose a source —</option>';
  state.pickMap = {};
  const addOption = (key, label, config) => {
    state.pickMap[key] = config;
    select.append(new Option(label, key));
  };
  if (state.central) addOption("central", "mozilla-central default", state.central.config);
  state.entries.forEach((entry, i) =>
    addOption(`e${i}`, `${entry.isLive ? "● " : ""}${entry.name} / ${entry.branchSlug}`, entry.config));
  // Rebuilding resets the <select>; restore the selection and keep pickConfig in sync
  // so a stale choice can't be diffed while the UI shows nothing selected.
  if (Object.hasOwn(state.pickMap, previous)) select.value = previous;
  state.pickConfig = state.pickMap[select.value] ?? null;
}

function readPaste() {
  const note = $("pasteNote");
  note.textContent = "";
  note.className = "paste-note";
  const text = $("pasteInput").value.trim();
  if (!text) return null;
  try {
    const { config, hint } = unwrapPaste(JSON.parse(text));
    if (hint) { note.textContent = hint; note.classList.add("ok"); }
    return config;
  } catch (e) {
    note.textContent = e.message;
    note.classList.add("err");
    return null;
  }
}

// Accept the aboutwelcome feature value, a full experiment, or a single branch.
function unwrapPaste(parsed) {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    if (Array.isArray(parsed.branches)) {
      const branches = parsed.branches.map((branch) => ({ branch, feature: getAWFeature(branch) })).filter((b) => b.feature);
      if (branches.length === 0) throw new Error("Pasted experiment has no aboutwelcome branch.");
      const [{ branch, feature }] = branches;
      const extra = branches.length > 1 ? ` (of ${branches.length} branches).` : ".";
      return { config: feature.value, hint: `Detected a full experiment — using branch “${branch.slug}”’s aboutwelcome value${extra}` };
    }
    if (Array.isArray(parsed.features)) {
      const feature = getAWFeature(parsed);
      if (!feature) throw new Error("Pasted branch has no aboutwelcome feature.");
      return { config: feature.value, hint: "Detected a branch object — using its aboutwelcome value." };
    }
    if ("screens" in parsed || "id" in parsed) return { config: parsed, hint: null };
  }
  throw new Error("Unrecognized JSON — expected the aboutwelcome feature value ({id, screens, …}).");
}

// ── run the diff ──────────────────────────────────────────────────────────────
function runDiff() {
  const error = $("diffError");
  error.style.display = "none";
  const fail = (message) => { error.textContent = message; error.style.display = "block"; };

  if (!state.base) return fail("Pick a baseline from the left first.");

  let other;
  if (state.compareMode === "paste") {
    other = readPaste();
    if (!other) return fail("Paste valid rollout JSON to compare.");
  } else {
    if (!state.pickConfig) return fail("Choose a source to compare against.");
    other = state.pickConfig;
  }

  const [before, after] = state.swap ? [other, state.base.config] : [state.base.config, other];
  const diff = diffConfigs(before, after);
  const meta = { id: after?.id ?? state.base.baseId, date: today() };

  state.markdown = diffToMarkdown(diff, meta);
  $("changelogOut").innerHTML = renderChangelog(diff, meta);
  $("rawOut").innerHTML = renderRawDiff(before, after);
  setOutTab("changelog");
}

// ── changelog rendering ─────────────────────────────────────────────────────────
function renderChangelog(diff, meta) {
  const parts = [`<div class="cl-title">${esc(`${meta.date} — ${meta.id}`)}</div>`];

  if (diff.fields.length === 0 && diff.screens.length === 0) {
    parts.push('<div class="cl-none">No changes.</div>');
    return parts.join("");
  }
  if (diff.fields.length > 0) {
    parts.push('<div class="cl-section">Configuration</div>');
    parts.push(`<div class="cl-rows">${diff.fields.map(changeRow).join("")}</div>`);
  }
  if (diff.screens.length > 0) {
    parts.push('<div class="cl-section">Screens</div>');
    parts.push(diff.screens.map(screenCard).join(""));
  }
  return parts.join("");
}

function screenCard(screen) {
  const head =
    `<div class="cl-card-head"><code class="cl-screen-id">${esc(screen.id)}</code>` +
    `<span class="cl-tag ${screen.status}">${screen.status}</span></div>`;
  const rows = screen.changes.length > 0 ? `<div class="cl-rows">${screen.changes.map(changeRow).join("")}</div>` : "";
  return `<div class="cl-card ${screen.status}">${head}${rows}</div>`;
}

function changeRow({ path, kind, before, after, from, to }) {
  const pathEl = `<div class="cl-path">${esc(path)}</div>`;
  if (kind === "removed") {
    return `<div class="cl-change"><div class="cl-row-head">${pathEl}<span class="cl-pill del">removed</span></div></div>`;
  }
  if (kind === "moved") {
    return `<div class="cl-change"><div class="cl-row-head">${pathEl}<span class="cl-pill move">moved</span><span class="cl-move">${from} → ${to}</span></div></div>`;
  }
  if (kind === "added") {
    const value = `<div class="cl-val add"><span class="sign">+</span><code>${esc(formatValue(after))}</code></div>`;
    return `<div class="cl-change"><div class="cl-row-head">${pathEl}<span class="cl-pill add">added</span></div>${value}</div>`;
  }
  return `<div class="cl-change">${pathEl}` +
    `<div class="cl-val del"><span class="sign">−</span><code>${esc(formatValue(before))}</code></div>` +
    `<div class="cl-val add"><span class="sign">+</span><code>${esc(formatValue(after))}</code></div></div>`;
}

// ── raw line diff ──────────────────────────────────────────────────────────────
function renderRawDiff(before, after) {
  const a = JSON.stringify(sortKeys(before), null, 2).split("\n");
  const b = JSON.stringify(sortKeys(after), null, 2).split("\n");
  const ops = lineDiff(a, b);
  if (ops.every((op) => op.type === "=")) return '<div class="raw-same">No differences.</div>';
  return ops.map((op) => {
    const cls = op.type === "+" ? "ln-add" : op.type === "-" ? "ln-del" : "ln-eq";
    const sign = op.type === "=" ? " " : op.type;
    return `<div class="${cls}">${sign} ${esc(op.line)}</div>`;
  }).join("");
}

// Deep clone with recursively sorted object keys, for a stable raw diff.
const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
};

// ── changelog copy / download ──────────────────────────────────────────────────
async function copyChangelog() {
  if (!state.markdown) return;
  try {
    await navigator.clipboard.writeText(state.markdown);
    flash($("copyBtn"), "Copied!");
  } catch { /* clipboard unavailable */ }
}

function downloadChangelog() {
  if (!state.markdown) return;
  const url = URL.createObjectURL(new Blob([state.markdown], { type: "text/markdown" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: "rollout-changelog.md" });
  link.click();
  // Revoke on the next tick — revoking synchronously can abort the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function flash(button, text) {
  // Remember the label once so rapid clicks can't capture the flash text as "original".
  button.dataset.label ??= button.textContent;
  button.textContent = text;
  clearTimeout(Number(button.dataset.flashTimer));
  button.dataset.flashTimer = setTimeout(() => { button.textContent = button.dataset.label; }, 1400);
}

// ── output tabs ────────────────────────────────────────────────────────────────
function setOutTab(tab) {
  document.querySelectorAll("[data-out]").forEach((b) => b.classList.toggle("active", b.dataset.out === tab));
  $("changelogPanel").style.display = tab === "changelog" ? "block" : "none";
  $("rawPanel").style.display = tab === "raw" ? "block" : "none";
}

// ── misc ───────────────────────────────────────────────────────────────────────
function updateSwapLabel() {
  const baseLabel = state.base?.label ?? "baseline";
  const otherLabel = state.compareMode === "paste" ? "pasted JSON" : "picked source";
  const [beforeLabel, afterLabel] = state.swap ? [otherLabel, baseLabel] : [baseLabel, otherLabel];
  $("swapLabel").innerHTML = `before: <strong>${esc(beforeLabel)}</strong> → after: <strong>${esc(afterLabel)}</strong>`;
}

const formatDates = (entry) => (entry.startDate ? `${entry.startDate} → ${entry.endDate ?? "ongoing"}` : "not started");

// ── init ───────────────────────────────────────────────────────────────────────
function init() {
  $("pasteInput").addEventListener("input", readPaste);
  $("pickSelect").addEventListener("change", (e) => { state.pickConfig = state.pickMap[e.target.value] ?? null; });
  $("swapBtn").addEventListener("click", () => { state.swap = !state.swap; updateSwapLabel(); });
  $("runBtn").addEventListener("click", runDiff);
  $("copyBtn").addEventListener("click", copyChangelog);
  $("downloadBtn").addEventListener("click", downloadChangelog);
  document.querySelectorAll("[data-cmp]").forEach((b) => b.addEventListener("click", () => setCompareMode(b.dataset.cmp)));
  document.querySelectorAll("[data-out]").forEach((b) => b.addEventListener("click", () => setOutTab(b.dataset.out)));

  updateSwapLabel();
  loadRollouts();
  loadCentralDefault();
}

// This script lives at the end of <body>, so the DOM is already parsed.
init();
