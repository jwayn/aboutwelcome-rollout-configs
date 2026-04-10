# about:welcome rollout config script

## Usage

```bash
python3 rollout.py
```

**What it does:**

1. Validates `current-rollout.json` has a rollout ID
2. Diffs screen IDs against the most recent archive
3. Archives current config to `archive/{rollout-id}.json`
4. Optionally commits and pushes

## Workflow

1. Replace `current-rollout.json` with the new rollout JSON from Experimenter
2. Run `./rollout.py`
