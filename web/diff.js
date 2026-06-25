// diff.js — compares two aboutwelcome rollout configs and describes what changed.
// Exposes `RolloutDiff` on the page (and module.exports for Node tooling).

(function (global) {
  "use strict";

  const MAX_VALUE_LENGTH = 120;

  const kindOf = (value) =>
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

  const isObjectWithId = (value) => kindOf(value) === "object" && Object.hasOwn(value, "id");

  const deepEqual = (a, b) => {
    if (a === b) return true;
    if (kindOf(a) !== kindOf(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((value, i) => deepEqual(value, b[i]));
    if (kindOf(a) === "object") {
      const keys = Object.keys(a);
      return keys.length === Object.keys(b).length && keys.every((key) => deepEqual(a[key], b[key]));
    }
    return false;
  };

  const sortedKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const indexById = (list) => new Map(list.filter(isObjectWithId).map((item) => [item.id, item]));
  const idsInOrder = (...lists) => [...new Set(lists.flat().filter(isObjectWithId).map((item) => item.id))];
  const omit = (object, key) => Object.fromEntries(Object.entries(object).filter(([k]) => k !== key));

  // DP table of LCS lengths: lengths[i][j] = LCS length of a.slice(i) and b.slice(j).
  const lcsLengths = (a, b) => {
    const lengths = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
      }
    }
    return lengths;
  };

  const longestCommonSubsequence = (a, b) => {
    const lengths = lcsLengths(a, b);
    const result = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { result.push(a[i]); i++; j++; }
      else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++;
      else j++;
    }
    return result;
  };

  // Line-level diff of two arrays of strings: [{ type: "=" | "-" | "+", line }].
  function lineDiff(a, b) {
    const lengths = lcsLengths(a, b);
    const ops = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { ops.push({ type: "=", line: a[i++] }); j++; }
      else if (lengths[i + 1][j] >= lengths[i][j + 1]) ops.push({ type: "-", line: a[i++] });
      else ops.push({ type: "+", line: b[j++] });
    }
    while (i < a.length) ops.push({ type: "-", line: a[i++] });
    while (j < b.length) ops.push({ type: "+", line: b[j++] });
    return ops;
  }

  // Find ids whose relative order changed between two lists, returning
  // id -> { from, to } array indices. Items in the longest common subsequence of
  // the shared ids stay put, so index shifts from added/removed items aren't moves.
  const detectMoves = (before, after) => {
    const beforeIndex = new Map(before.filter(isObjectWithId).map((item, i) => [item.id, i]));
    const afterIndex = new Map(after.filter(isObjectWithId).map((item, i) => [item.id, i]));
    const beforeOrder = [...beforeIndex.keys()].filter((id) => afterIndex.has(id));
    const afterOrder = [...afterIndex.keys()].filter((id) => beforeIndex.has(id));
    const stable = new Set(longestCommonSubsequence(beforeOrder, afterOrder));

    const moves = new Map();
    for (const id of beforeOrder) {
      if (!stable.has(id)) moves.set(id, { from: beforeIndex.get(id), to: afterIndex.get(id) });
    }
    return moves;
  };

  // Compare two JSON values into a flat list of changes.
  // Change = { path, kind: "added" | "removed" | "changed", before?, after? }
  function diffValues(before, after, path = "") {
    if (deepEqual(before, after)) return [];
    if (kindOf(before) !== kindOf(after)) return [{ path, kind: "changed", before, after }];
    if (kindOf(before) === "object") return diffObject(before, after, path);
    if (kindOf(before) === "array") return diffArray(before, after, path);
    return [{ path, kind: "changed", before, after }];
  }

  function diffObject(before, after, path) {
    return sortedKeys(before, after).flatMap((key) => {
      const childPath = path ? `${path}.${key}` : key;
      if (!Object.hasOwn(before, key)) return [{ path: childPath, kind: "added", after: after[key] }];
      if (!Object.hasOwn(after, key)) return [{ path: childPath, kind: "removed", before: before[key] }];
      return diffValues(before[key], after[key], childPath);
    });
  }

  // Arrays whose elements are all objects with a unique `id` are matched by id, so
  // reordering doesn't read as a change. Any other array (id-less, mixed, or with
  // duplicate ids) is compared as a single value so no element is silently skipped.
  function diffArray(before, after, path) {
    const beforeById = indexById(before);
    const afterById = indexById(after);
    if (beforeById.size !== before.length || afterById.size !== after.length) {
      return [{ path, kind: "changed", before, after }];
    }
    const moves = detectMoves(before, after);
    return idsInOrder(before, after).flatMap((id) => {
      const childPath = `${path}[${id}]`;
      if (!beforeById.has(id)) return [{ path: childPath, kind: "added", after: afterById.get(id) }];
      if (!afterById.has(id)) return [{ path: childPath, kind: "removed", before: beforeById.get(id) }];
      const changes = diffValues(beforeById.get(id), afterById.get(id), childPath);
      if (moves.has(id)) changes.push({ path: childPath, kind: "moved", ...moves.get(id) });
      return changes;
    });
  }

  // Compare two rollout configs, grouping screen changes separately from the rest.
  // Returns { fields: Change[], screens: ScreenDiff[] }
  // ScreenDiff = { id, status: "added" | "removed" | "changed", changes: Change[] }
  function diffConfigs(before, after) {
    const fields = diffObject(omit(before, "screens"), omit(after, "screens"), "");

    const beforeScreens = indexById(before.screens ?? []);
    const afterScreens = indexById(after.screens ?? []);
    const moves = detectMoves(before.screens ?? [], after.screens ?? []);
    const screens = [];
    for (const id of idsInOrder(before.screens ?? [], after.screens ?? [])) {
      if (!beforeScreens.has(id)) { screens.push({ id, status: "added", changes: [] }); continue; }
      if (!afterScreens.has(id)) { screens.push({ id, status: "removed", changes: [] }); continue; }

      const contentChanges = diffValues(beforeScreens.get(id), afterScreens.get(id));
      const move = moves.get(id);
      if (contentChanges.length === 0 && !move) continue;

      const changes = move ? [...contentChanges, { path: "position", kind: "moved", ...move }] : contentChanges;
      screens.push({ id, status: contentChanges.length > 0 ? "changed" : "moved", changes });
    }
    return { fields, screens };
  }

  const formatValue = (value) => {
    const text = JSON.stringify(value);
    return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
  };

  const describeChange = ({ path, kind, before, after, from, to }) => {
    if (kind === "added") return `\`${path}\`: added \`${formatValue(after)}\``;
    if (kind === "removed") return `\`${path}\`: removed`;
    if (kind === "moved") return `\`${path}\`: ${from} → ${to}`;
    return `\`${path}\`: \`${formatValue(before)}\` → \`${formatValue(after)}\``;
  };

  const today = () => new Date().toISOString().slice(0, 10);

  // Serialize a config diff to a markdown changelog (used by copy / download).
  function diffToMarkdown({ fields, screens }, { id = "", date = today() } = {}) {
    const lines = [`## ${date} — ${id}`, ""];
    if (fields.length === 0 && screens.length === 0) {
      lines.push("_No changes._");
      return lines.join("\n");
    }
    for (const change of fields) lines.push(`- ${describeChange(change)}`);
    for (const screen of screens) {
      lines.push("", `### Screen ${screen.status}: \`${screen.id}\``);
      for (const change of screen.changes) lines.push(`- ${describeChange(change)}`);
    }
    return lines.join("\n");
  }

  const api = { diffValues, diffConfigs, diffToMarkdown, formatValue, lineDiff, today };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.RolloutDiff = api;
})(typeof window !== "undefined" ? window : globalThis);
