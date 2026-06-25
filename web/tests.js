// tests.js — assertions for diff.js and sources.js, shared by tests.html (browser)
// and Node (CI). Run headless from the repo root: node web/tests.js

(function (global) {
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  const { diffValues, diffConfigs, diffToMarkdown, lineDiff } = isNode ? require("./diff.js") : global.RolloutDiff;
  const { extractObjectLiteral } = isNode ? require("./sources.js") : global.RolloutSources;

  // check(ok, message, detail) reports one assertion.
  // loadJson(path) resolves a repo-root-relative path to parsed JSON (fixtures).
  async function runTests(check, loadJson) {
    const equal = (a, b, message) => check(JSON.stringify(a) === JSON.stringify(b), message, `got ${JSON.stringify(a)}`);

    const config = (id, screens = []) => ({ id, transitions: true, screens });
    const screen = (id, content = {}) => ({ id, content });

    // ── diffValues ──
    equal(diffValues({ a: 1 }, { a: 1 }), [], "identical values → no changes");
    equal(diffValues("old", "new", "title"), [{ path: "title", kind: "changed", before: "old", after: "new" }], "scalar change");
    equal(diffValues({}, { x: 1 }, "root"), [{ path: "root.x", kind: "added", after: 1 }], "added key");
    equal(diffValues({ x: 1 }, {}, "root"), [{ path: "root.x", kind: "removed", before: 1 }], "removed key");
    check(diffValues({ a: { b: "x" } }, { a: { b: "y" } })[0].path === "a.b", "nested path");
    {
      const changes = diffValues([{ id: "A", v: 1 }, { id: "B" }], [{ id: "A", v: 2 }, { id: "C" }], "items");
      const paths = changes.map((c) => `${c.path}:${c.kind}`).join(" ");
      check(paths.includes("items[A].v:changed") && paths.includes("items[B]:removed") && paths.includes("items[C]:added"),
        "arrays matched by id", paths);
    }
    equal(diffValues([1, 2], [1, 3], "nums"), [{ path: "nums", kind: "changed", before: [1, 2], after: [1, 3] }], "id-less array compared whole");
    {
      const changes = diffValues(["a", { id: "X", v: 1 }], ["b", { id: "X", v: 1 }], "mixed");
      equal(changes.map((c) => `${c.path}:${c.kind}`), ["mixed:changed"], "mixed array compared whole (id-less change not dropped)");
    }
    {
      const changes = diffValues([{ id: "A", v: 1 }, { id: "A", v: 2 }], [{ id: "A", v: 1 }], "dup");
      equal(changes.map((c) => `${c.path}:${c.kind}`), ["dup:changed"], "duplicate-id array compared whole");
    }
    check(diffValues({}, [], "x")[0].kind === "changed", "type change → changed");

    // ── diffConfigs ──
    {
      const d = diffConfigs(config("a:t"), config("a:t"));
      check(d.fields.length === 0 && d.screens.length === 0, "identical configs → empty diff");
    }
    check(diffConfigs(config("old:t"), config("new:t")).fields.some((c) => c.path === "id"), "top-level id change in fields");
    {
      const d = diffConfigs(config("t", []), config("t", [screen("AW_NEW")]));
      check(d.screens.some((s) => s.id === "AW_NEW" && s.status === "added"), "screen added");
    }
    {
      const d = diffConfigs(config("t", [screen("AW_OLD")]), config("t", []));
      check(d.screens.some((s) => s.id === "AW_OLD" && s.status === "removed"), "screen removed");
    }
    {
      const d = diffConfigs(config("t", [screen("AW_X", { title: "old" })]), config("t", [screen("AW_X", { title: "new" })]));
      const s = d.screens.find((s) => s.id === "AW_X");
      check(s?.status === "changed" && s.changes.some((c) => c.path === "content.title"), "screen field changed");
    }
    {
      const same = screen("AW_SAME", { title: "x" });
      check(diffConfigs(config("t", [same]), config("t", [same])).screens.length === 0, "unchanged screen omitted");
    }

    // ── moves ──
    {
      const d = diffConfigs(config("t", [screen("A"), screen("B"), screen("C")]), config("t", [screen("A"), screen("C"), screen("B")]));
      const moved = d.screens.filter((s) => s.status === "moved");
      check(moved.length === 1 && moved[0].changes[0]?.kind === "moved", "pure reorder → one moved screen");
    }
    check(!diffConfigs(config("t", [screen("A"), screen("B"), screen("C")]), config("t", [screen("A"), screen("C")]))
      .screens.some((s) => s.status === "moved"), "removed item doesn't cause false moves");
    {
      const before = config("t", [screen("A", { tiles: [{ id: "x" }, { id: "y" }] })]);
      const after = config("t", [screen("A", { tiles: [{ id: "y" }, { id: "x" }] })]);
      const a = diffConfigs(before, after).screens.find((s) => s.id === "A");
      check(a?.changes.some((c) => c.kind === "moved" && c.path.includes("tiles[")), "nested array move detected");
    }

    // ── lineDiff ──
    {
      const ops = lineDiff(["a", "b", "c"], ["a", "c", "d"]);
      equal(ops.map((op) => `${op.type}${op.line}`), ["=a", "-b", "=c", "+d"], "lineDiff basic ops");
    }
    equal(lineDiff([], ["x"]), [{ type: "+", line: "x" }], "lineDiff from empty");
    check(lineDiff(["x", "y"], ["x", "y"]).every((op) => op.type === "="), "lineDiff identical → all equal");

    // ── extractObjectLiteral ──
    {
      const extract = (source) => extractObjectLiteral(source, 0);
      equal(extract("{ a: 1 } tail"), "{ a: 1 }", "extract: simple object");
      equal(extract('{ a: "}" } tail'), '{ a: "}" }', "extract: brace inside string ignored");
      equal(extract("{ a: 1, // }\n b: 2 } tail"), "{ a: 1, // }\n b: 2 }", "extract: brace inside comment ignored");
      {
        // Regression: template interpolation at nested object depth, followed by
        // '…' quotes in the template text (the AW_EASY_SETUP targeting shape).
        const object = "{ screens: [ { targeting: `a && !${CONST} && (b != 'A') && 'p'|q`, content: { z: 1 } } ] }";
        equal(extract(`${object} tail`), object, "extract: ${…} at nested depth");
      }
      equal(extract("{ t: `v=${({ a: 1 }).a}` } tail"), "{ t: `v=${({ a: 1 }).a}` }", "extract: braces inside interpolation");
      equal(extract("{ t: `x${`y${z}`}w` } tail"), "{ t: `x${`y${z}`}w` }", "extract: nested template literal");
      {
        let threw = null;
        try { extract("{ a: 1"); } catch (e) { threw = e.message; }
        check(threw?.includes("Unbalanced"), "extract: unbalanced input throws", String(threw));
      }
    }

    // ── diffToMarkdown ──
    {
      const md = diffToMarkdown(diffConfigs(config("old:t"), config("new:t", [screen("AW_NEW")])), { id: "new:t", date: "2026-06-27" });
      check(md.startsWith("## 2026-06-27 — new:t"), "markdown header");
      check(md.includes("### Screen added: `AW_NEW`"), "markdown screen section");
    }
    check(diffToMarkdown({ fields: [], screens: [] }, { id: "t" }).includes("_No changes._"), "markdown no-changes");

    // ── fixture sanity ──
    try {
      const [before, after] = await Promise.all([
        loadJson("archive/onboarding-rollout-2604-149-treatment.json"),
        loadJson("archive/onboarding-rollout-2604-149-no-addons-treatment.json"),
      ]);
      const d = diffConfigs(before, after);
      check(d.fields.some((c) => c.path === "id"), "fixture: id changed");
      check(d.screens.some((s) => s.id === "AW_AMO_INTRODUCE" && s.status === "removed"), "fixture: AW_AMO_INTRODUCE removed");
    } catch (e) {
      check(false, "fixture test", e.message);
    }
  }

  const api = { runTests };
  if (isNode) module.exports = api;
  global.RolloutTests = api;
})(typeof window !== "undefined" ? window : globalThis);

// Node CLI entry: print results and set the exit code for CI.
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  const fs = require("fs");
  const path = require("path");
  let passed = 0;
  let failed = 0;
  const check = (ok, message, detail = "") => {
    ok ? passed++ : failed++;
    console.log(`${ok ? "✓" : "✗"} ${message}${ok || !detail ? "" : `  — ${detail}`}`);
  };
  const loadJson = async (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", rel), "utf8"));
  module.exports.runTests(check, loadJson).then(() => {
    console.log(`${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  });
}
