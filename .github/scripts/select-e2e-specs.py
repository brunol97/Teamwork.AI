#!/usr/bin/env python3
"""Work out which Playwright specs a pull request owns, so a stacked PR records only
its own tests instead of re-recording every earlier slice.

Selection order:
  1. spec files added or changed in this PR
  2. the slice named in the branch, e.g. impl/t3-collaboration -> e2e/t3*.spec.ts
  3. every spec, as a last resort

Writes {"specs": [...], "reason": "..."} to --out.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys

SPEC_DIR = pathlib.Path("e2e")


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], capture_output=True, text=True)
    if result.returncode != 0:
        return ""
    return result.stdout


def resolve(ref: str) -> str:
    """Prefer the remote-tracking ref so a base branch that is not checked out works."""
    for candidate in (f"origin/{ref}", ref):
        if git("rev-parse", "--verify", "--quiet", candidate):
            return candidate
    return ref


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True, help="base branch name, e.g. main")
    parser.add_argument("--head", required=True, help="head branch name")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    base = resolve(args.base)
    head = resolve(args.head)

    specs: list[str] = []
    reason = ""

    # 1. Specs this PR touched.
    diff = git("diff", "--name-only", f"{base}...{head}", "--", str(SPEC_DIR))
    changed = sorted({line.strip() for line in diff.splitlines() if line.strip().endswith(".spec.ts")})
    if changed:
        specs = [s for s in changed if pathlib.Path(s).exists()]
        reason = "specs gewijzigd in deze PR"

    # 2. The slice named in the branch.
    if not specs:
        match = re.search(r"\bt(\d+)\b", args.head, re.IGNORECASE)
        if match:
            token = f"t{match.group(1)}"
            found = sorted(str(p) for p in SPEC_DIR.glob(f"{token}*.spec.ts"))
            if found:
                specs = found
                reason = f"slice {token} uit de branchnaam"

    # 3. Last resort.
    if not specs:
        specs = sorted(str(p) for p in SPEC_DIR.glob("*.spec.ts"))
        reason = "terugval: alle specs (PR raakt geen spec en de branch noemt geen slice)"

    if not specs:
        print("Geen Playwright-specs gevonden.", file=sys.stderr)
        return 1

    payload = {"specs": specs, "reason": reason}
    pathlib.Path(args.out).write_text(json.dumps(payload, indent=2) + "\n")
    print(f"{len(specs)} spec(s) geselecteerd via {reason}: {', '.join(specs)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
