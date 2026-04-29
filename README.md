# about:welcome Rollout Configs

Source of truth for `about:welcome` rollout configurations used in Experimenter.

## Purpose

This repository maintains version controlled JSON configurations for `about:welcome` rollouts. It provides:

- **Version history** - Track what changed and when with git history
- **Single source of truth** - Reference for active rollout configurations
- **Easy rollout creation** - Copy/paste configs when creating new `about:welcome` Experimenter rollouts

## Repository Structure

```
aboutwelcome-rollout-configs/
├── README.md
├── current-rollout.json
├── rollout.py
└── archive/  # Historical configs named YYMMDD-N-rollout-id.json
```

## How to Update

1. Run the script:
   ```bash
   ./rollout.py
   ```
2. The script backs up `current-rollout.json` to `archive/` before any changes are made.
3. When prompted, make your edits to `current-rollout.json`, save, then return to the script and press Enter.
4. The script diffs the updated file against the backup and reports any screen ID changes.
5. Optionally commit and push.

### Archive naming

Archives are named `YYMMDD-N-rollout-id.json`, where `N` starts at `0` and increments for multiple archives on the same date. If the most recent archive for a given date already exists, the script will ask whether to overwrite it or save as a new version.

## Related Resources

- [about:welcome in-tree defaults](https://searchfox.org/firefox-main/source/browser/components/aboutwelcome/modules/AboutWelcomeDefaults.sys.mjs)
- [about:welcome Source Docs](https://firefox-source-docs.mozilla.org/browser/components/asrouter/docs/about-welcome.html)
