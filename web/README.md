# Rollout Diff

A browser tool for diffing aboutwelcome rollout configs. Pick a **baseline**, drop in a **new
rollout**, and get a structured changelog plus a raw line diff of what changed.

## Baselines you can diff against

1. **Live rollouts** — from Experimenter (`status=Live`).
2. **Historical rollouts** — the full aboutwelcome rollout history from Experimenter (one
   unfiltered fetch, plus a Live fetch used only to tag which are currently live).
3. **mozilla-central default** — `MR_ABOUT_WELCOME_DEFAULT` from `AboutWelcomeDefaults.sys.mjs`,
   the in-tree default that rollouts supplement. It's a JS object literal, so it's extracted and
   evaluated under small stubs.

The **Compare against** side accepts either pasted JSON (a new rollout) or another fetched source,
so rollout-vs-rollout and default-vs-rollout comparisons work too. Pasted input is auto-unwrapped:
paste the `aboutwelcome` feature value (`{ id, screens, … }`), a whole experiment, or a single
branch — the tool detects and unwraps it. **Swap** flips which side is "before".

The changelog can be copied or downloaded as markdown.

## Run it

Pure static — no build, no npm. Serve over http (so the tests can read `../archive`, and for a
secure context so the Copy button works). Serve from the **repo root** (one level above `web/`):

```sh
# from aboutwelcome-rollout-configs/
python3 -m http.server 8000
# open http://localhost:8000/web/
```

## Tests

- Headless (also runs in CI): `node web/tests.js` from the repo root.
- Browser: open <http://localhost:8000/web/tests.html>.

## Files

| File | Role |
|------|------|
| `index.html` | Page shell + styling |
| `diff.js` | Diff engine: `diffConfigs`, `diffValues`, `diffToMarkdown`, `lineDiff` |
| `sources.js` | Experimenter fetch + the mozilla-central default loader/parser |
| `app.js` | UI wiring: source pickers, paste box, run diff, render outputs |
| `tests.js` | Test assertions, shared by the browser harness and Node |
| `tests.html` | Browser test harness |
