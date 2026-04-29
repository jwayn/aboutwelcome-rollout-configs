#!/usr/bin/env python3

import json
import shutil
import subprocess
import sys
from datetime import date
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

# Back up current-rollout.json before the user makes changes
archive_dir = Path("archive")
archive_dir.mkdir(exist_ok=True)

date_str = date.today().strftime("%y%m%d")
rollout_slug = rollout_id.replace(":", "-")

version = 0
# Determine the version number for this date
while True:
    archive_name = f"{date_str}-{version}-{rollout_slug}.json"
    archive_path = archive_dir / archive_name
    if not archive_path.exists():
        break
    version += 1

if version > 0:
    # If we already have a version 0 for this date, prompt the user whether to overwrite or create a new version.
    answer = input(f"\n{YELLOW}{archive_path.parent / f'{date_str}-{version - 1}-{rollout_slug}.json'} already exists. Overwrite? (y/N): {NC}").strip().lower()
    if answer == "y":
        version -= 1
        archive_name = f"{date_str}-{version}-{rollout_slug}.json"
        archive_path = archive_dir / archive_name

shutil.copy("current-rollout.json", archive_path)
ok(f"Backed up to {archive_path}")

# Prompt user to make their changes
input(f"\n{BLUE}Make your changes to current-rollout.json, then press Enter to continue...{NC}")

# Load the updated rollout
try:
    new_rollout_id, new_screens = load_rollout("current-rollout.json")
except (json.JSONDecodeError, KeyError) as e:
    err(f"Failed to parse current-rollout.json: {e}")
    sys.exit(1)

if not new_rollout_id:
    err("Rollout ID not found")
    sys.exit(1)

ok(f"Updated Rollout ID: {new_rollout_id}")
print(f"   Screens:  {len(new_screens)}")

# Diff new vs backup
prev_set, curr_set = set(screens), set(new_screens)
added = curr_set - prev_set
removed = prev_set - curr_set
if added or removed:
    print(f"\n   vs {archive_path.name}:")
    for s in sorted(added):   print(f"   {GREEN}+ {s}{NC}")
    for s in sorted(removed): print(f"   {RED}- {s}{NC}")
else:
    print(f"   No screen ID changes vs {archive_path.name}")

# Commit + push
answer = input("\nCommit? (y/N): ").strip().lower()
if answer != "y":
    sys.exit(0)

result = subprocess.run(["git", "rev-parse", "--git-dir"], capture_output=True)
if result.returncode != 0:
    err("Not in a git repository")
    sys.exit(1)

subprocess.run(["git", "add", "current-rollout.json", str(archive_path)], check=True)
commit_msg = f"Update rollout: {new_rollout_id}\n\nArchive: {archive_name}"
subprocess.run(["git", "commit", "-m", commit_msg], check=True)
ok("Committed")

answer = input("Push? (y/N): ").strip().lower()
if answer == "y":
    subprocess.run(["git", "push"], check=True)
    ok("Pushed")
