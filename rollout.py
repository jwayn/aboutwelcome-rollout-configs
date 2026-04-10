#!/usr/bin/env python3

import json
import os
import subprocess
import sys
from pathlib import Path

RED = "\033[0;31m"
GREEN = "\033[0;32m"
YELLOW = "\033[1;33m"
BLUE = "\033[0;34m"
NC = "\033[0m"

def err(msg): print(f"{RED}✗ {msg}{NC}")
def ok(msg):  print(f"{GREEN}✓ {msg}{NC}")
def info(msg): print(f"{BLUE}{msg}{NC}")


def load_rollout(path):
    with open(path) as f:
        data = json.load(f)
    rollout_id = data.get("id")
    screens = [s.get("id", "unknown") for s in data.get("screens", [])]
    return rollout_id, screens


# Load th current rollout
if not Path("current-rollout.json").exists():
    err("current-rollout.json not found")
    sys.exit(1)

try:
    rollout_id, screens = load_rollout("current-rollout.json")
except (json.JSONDecodeError, KeyError) as e:
    err(f"Failed to parse current-rollout.json: {e}")
    sys.exit(1)

if not rollout_id:
    err("Rollout ID not found")
    sys.exit(1)

ok(f"Rollout ID: {rollout_id}")
print(f"   Screens:  {len(screens)}")

# Diff against the most recent archive
archive_dir = Path("archive")
archive_dir.mkdir(exist_ok=True)

previous_archives = sorted(archive_dir.glob("*.json"), key=os.path.getmtime)
if previous_archives:
    prev_id, prev_screens = load_rollout(previous_archives[-1])
    prev_set, curr_set = set(prev_screens), set(screens)
    added = curr_set - prev_set
    removed = prev_set - curr_set
    if added or removed:
        print(f"\n   vs {previous_archives[-1].name}:")
        for s in sorted(added):   print(f"   {GREEN}+ {s}{NC}")
        for s in sorted(removed): print(f"   {RED}- {s}{NC}")
    else:
        print(f"   No screen ID changes vs {previous_archives[-1].name}")

# Create archive
archive_name = rollout_id.replace(":", "-") + ".json"
archive_path = archive_dir / archive_name

if archive_path.exists():
    answer = input(f"\n{YELLOW}{archive_path} already exists. Overwrite? (y/N): {NC}").strip().lower()
    if answer != "y":
        print("Aborted.")
        sys.exit(0)

import shutil
shutil.copy("current-rollout.json", archive_path)
ok(f"Archived to {archive_path}")

# Commit + push
answer = input("\nCommit? (y/N): ").strip().lower()
if answer != "y":
    sys.exit(0)

result = subprocess.run(["git", "rev-parse", "--git-dir"], capture_output=True)
if result.returncode != 0:
    err("Not in a git repository")
    sys.exit(1)

subprocess.run(["git", "add", "current-rollout.json", str(archive_path)], check=True)
commit_msg = f"Update rollout: {rollout_id}\n\nArchive: {archive_name}"
subprocess.run(["git", "commit", "-m", commit_msg], check=True)
ok("Committed")

answer = input("Push? (y/N): ").strip().lower()
if answer == "y":
    subprocess.run(["git", "push"], check=True)
    ok("Pushed")
