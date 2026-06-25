// sources.js — fetch + normalize the baselines you can diff against.
//
//   1. Experimenter v6 (public, CORS-open) — two fetches:
//        a) the full aboutwelcome list (all statuses) = full rollout history
//        b) the Live list, only used to tag which rollouts are currently live
//      (the v6 payload carries no `status` field of its own).
//   2. mozilla-central MR_ABOUT_WELCOME_DEFAULT — the live in-tree default that
//      rollouts supplement. It's a JS object literal, so we extract and evaluate it.
//
// Classic script — exposes `RolloutSources` (and module.exports under Node).

(function (global) {
  "use strict";

  const EXP_BASE = "https://experimenter.services.mozilla.com/api/v6/experiments/?feature_config=aboutwelcome";
  const EXP_LIVE = `${EXP_BASE}&status=Live`;
  const MJS_URL =
    "https://raw.githubusercontent.com/mozilla-firefox/firefox/main/browser/components/aboutwelcome/modules/AboutWelcomeDefaults.sys.mjs";

  const getAWFeature = (branch) =>
    branch.features?.find((f) => f.featureId === "aboutwelcome") ?? null;

  // One experiment -> 0..n list entries, one per aboutwelcome branch.
  const rolloutEntries = (exp, liveSlugs) => {
    if (!exp.isRollout) return [];
    return (exp.branches ?? []).flatMap((branch) => {
      const feature = getAWFeature(branch);
      if (!feature) return [];
      const config = feature.value ?? {};
      return [{
        slug: exp.slug,
        name: exp.name ?? exp.slug,
        branchSlug: branch.slug,
        baseId: config.id ?? exp.slug,
        isLive: liveSlugs.has(exp.slug),
        startDate: exp.startDate ?? null,
        endDate: exp.endDate ?? null,
        enrollmentEndDate: exp.enrollmentEndDate ?? null,
        proposedDuration: exp.proposedDuration ?? null,
        isEnrollmentPaused: Boolean(exp.isEnrollmentPaused),
        publicDescription: exp.publicDescription ?? "",
        screenCount: (config.screens ?? []).length,
        config,
      }];
    });
  };

  const fetchJson = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  const fetchText = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  };

  // Returns { entries, liveCount, errors }. Each fetch is isolated: a failing Live
  // fetch still yields the full list (just untagged), and vice versa.
  async function fetchRollouts() {
    const [allResult, liveResult] = await Promise.allSettled([fetchJson(EXP_BASE), fetchJson(EXP_LIVE)]);
    const errors = [];

    let all = [];
    if (allResult.status === "fulfilled") all = allResult.value;
    else errors.push(`Full list: ${allResult.reason.message}`);

    const liveSlugs = new Set();
    if (liveResult.status === "fulfilled") {
      for (const exp of liveResult.value) if (exp.isRollout) liveSlugs.add(exp.slug);
    } else {
      errors.push(`Live list: ${liveResult.reason.message}`);
    }

    const entries = all
      .flatMap((exp) => rolloutEntries(exp, liveSlugs))
      .sort((a, b) =>
        a.isLive !== b.isLive
          ? Number(b.isLive) - Number(a.isLive) // live first
          : (b.startDate ?? "").localeCompare(a.startDate ?? "") // then newest first
      );

    return { entries, liveCount: liveSlugs.size, errors };
  }

  // Extract & evaluate MR_ABOUT_WELCOME_DEFAULT from the .sys.mjs source.
  async function fetchCentralDefault({ msix = false } = {}) {
    const src = await fetchText(MJS_URL);
    const marker = src.indexOf("MR_ABOUT_WELCOME_DEFAULT = {");
    if (marker === -1) throw new Error("MR_ABOUT_WELCOME_DEFAULT not found in source");

    const objText = extractObjectLiteral(src, marker);
    // The literal references Services.prefs.getBoolPref(...), isMSIX, and the
    // WIN_OS_PIN_PROMPT_ENABLED targeting fragment imported from
    // MessagingTargetingConstants.sys.mjs; stub all three. The constant's value is
    // inlined here so interpolated targeting strings match what Firefox ships.
    const WIN_OS_PIN_PROMPT_ENABLED =
      "(os.isWindows && ((os.windowsBuildNumber == 19045 && os.windowsUBR >= 3996) || (os.windowsBuildNumber > 19045 && os.windowsBuildNumber < 22000) || (os.windowsBuildNumber == 22621 && os.windowsUBR >= 2361) || os.windowsBuildNumber > 22621))";
    const Services = { prefs: { getBoolPref: (_pref, fallback) => fallback } };
    const evaluate = new Function(
      "Services",
      "isMSIX",
      "WIN_OS_PIN_PROMPT_ENABLED",
      `"use strict"; return (${objText});`
    );
    return evaluate(Services, msix, WIN_OS_PIN_PROMPT_ENABLED);
  }

  // String/comment-aware brace matching. Skips // and /* */ comments and the
  // contents of '…', "…", `…` strings (including ${…}) so braces inside them
  // don't throw off the depth count.
  function extractObjectLiteral(src, fromIndex) {
    const start = src.indexOf("{", fromIndex);
    if (start === -1) throw new Error("opening brace not found");

    let depth = 0;
    let mode = "code"; // code | line | block | sq | dq | tpl
    const tplStack = []; // object-brace depth at each open ${…} interpolation

    for (let i = start; i < src.length; i++) {
      const c = src[i];
      const next = src[i + 1];

      switch (mode) {
        case "line": if (c === "\n") mode = "code"; continue;
        case "block": if (c === "*" && next === "/") { mode = "code"; i++; } continue;
        case "sq": if (c === "\\") i++; else if (c === "'") mode = "code"; continue;
        case "dq": if (c === "\\") i++; else if (c === '"') mode = "code"; continue;
        case "tpl":
          if (c === "\\") i++;
          else if (c === "`") mode = "code";
          else if (c === "$" && next === "{") { tplStack.push(depth); mode = "code"; i++; }
          continue;
      }

      // code mode
      if (c === "/" && next === "/") { mode = "line"; i++; continue; }
      if (c === "/" && next === "*") { mode = "block"; i++; continue; }
      if (c === "'") { mode = "sq"; continue; }
      if (c === '"') { mode = "dq"; continue; }
      if (c === "`") { mode = "tpl"; continue; }
      if (c === "{") { depth++; continue; }
      if (c === "}") {
        // A `}` with depth back at the level recorded for the innermost open ${…}
        // closes that interpolation, not an object brace.
        if (tplStack.length > 0 && depth === tplStack[tplStack.length - 1]) {
          tplStack.pop();
          mode = "tpl";
          continue;
        }
        if (--depth === 0) return src.slice(start, i + 1);
      }
    }
    throw new Error("Unbalanced braces extracting MR_ABOUT_WELCOME_DEFAULT");
  }

  const api = { getAWFeature, fetchRollouts, fetchCentralDefault, extractObjectLiteral };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.RolloutSources = api;
})(typeof window !== "undefined" ? window : globalThis);
