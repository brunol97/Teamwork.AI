---
name: software-factory
description: Implement every open GitHub issue end to end as a chain of pull requests, running independent issues in parallel worktrees and gating each one on typecheck, tests, build, and an independent review. Use when the user says "software factory", "implement all issues", "work through the backlog", "pick up the issues", or wants the issue backlog turned into reviewable PRs.
argument-hint: "[optional issue numbers to start from; default is every open issue]"
---

# Software Factory

Turn the open issue backlog into a stack of reviewable pull requests. Independent
issues run **in parallel**; dependent issues run in dependency order.

## Hard rules

These have each cost real time when broken. Do not skip them.

1. **Never merge, never close an issue, never push to `main`.** The deliverable is open
   PRs. Merging is the user's call.
2. **Never run an unscoped `pkill`.** `pkill -f "agent-native dev"` matches the
   developer's own server and any sibling worker's server. Free a port by PID
   (`lsof -t -i :8080 | xargs -r kill`) or not at all.
3. **One writer per directory.** Parallel writers require `worktree: true`. A shared
   cwd with concurrent writers corrupts branches silently.
4. **Verify before you push.** `pnpm typecheck`, `pnpm test`, `pnpm build` all exit 0.
   Do not open a PR while anything fails.
5. **A truthful `blocked` beats a falsely-passing slice.** Never report `done` for work
   that does not meet the acceptance criteria.

## Phase 1 — read the issues and build the graph

```bash
gh issue list --state open --limit 100 --json number,title,labels,body
gh issue view N --json title,body -q '.title, .body'
```

Read every issue body. Each one usually carries a `## Blocked by` section listing
issue numbers. That is the dependency graph — trust it over your intuition about what
"feels" sequential.

Also note from each issue:
- the `## Acceptance criteria` checkbox list, which becomes the review contract;
- whether it needs a Vitest unit test and a Playwright E2E test (most do).

Group the issues into **levels** by longest-path depth: level 0 is every issue whose
dependencies are all outside the backlog (or absent); level N is every issue whose
deepest dependency sits in level N-1. Issues in the same level are independent by
construction.

**Report the level plan to the user before launching anything**, because a
misread graph wastes an entire fleet:

```
Level 0: #4, #7
Level 1: #5
Level 2: #6, #8
```

## Phase 2 — implement level by level

Launch **one** `subagent` workflow with `async: true`. Per level:

- Serialize the levels. A level cannot start before the one below it is integrated,
  because every PR in a level is based on the integration branch produced by the
  previous level.
- Fan out the issues **within** a level in parallel.

Each issue gets one `worker` child:

- `agent: "worker"`, `context: "fresh"`, `timeoutMs: 3600000`,
  `toolBudget: { soft: 250, hard: 450 }`
- `worktree: true` — mandatory for the parallel ones, so each writes to its own
  managed worktree and branch off the current integration base
  (`baseRef: "refs/heads/<integration-branch>"`).
- Task text: repo standards, the issue body, its branch, and its base.

Cap the fan-out. Three concurrent workers is a sane ceiling; more and they fight over
ports, PGlite databases and memory on one machine.

**Pass the issue list as `args`, then normalise it.** The host may hand back
`{"item": [...]}` rather than a bare array, so peel `.item` in a loop before iterating
and fail fast with the received value if the result is not a non-empty array. This
has broken three launches.

**Use `runs.lanes` when a level has more than one issue.** Lanes give each issue its
own key, keep siblings running when one fails, and mark later stages of a failed lane
`skipped` instead of collapsing the board:

```js
const board = await runs.lanes([
  {
    key: "issue-4",
    stages: [{ key: "impl", label: "Implement #4", agent: "worker", task: task4, worktree: true }],
  },
  {
    key: "issue-7",
    stages: [{ key: "impl", label: "Implement #7", agent: "worker", task: task7, worktree: true }],
  },
]);
```

Return the board so the parent can see which lanes finished and which stopped.

### Known conflicts between parallel issues

Two independent issues often touch the same files (`actions/send-task-message.ts`,
`server/db/schema.ts`, a shared route). Isolation prevents *branch* corruption but
not *merge* conflict. So:

- Tell each worker which **sibling issues** run in the same level and that its PR is
  one of several against the same base.
- If two issues in a level plausibly write the same file, promote the later one to the
  next level instead of racing. Prefer a slightly slower correct stack over a pile of
  conflicting PRs.
- Record every new migration filename per issue so two workers cannot both claim the
  same number.

## Phase 3 — integrate each level

After a level's lanes settle, create the next integration branch from the previous
one, and open each PR in the level against that base. Stack order within a level
should be stable and explainable — alphabetical by issue number is fine.

For a fully linear backlog (every issue depends on the previous), skip lanes entirely
and run the loop form: one child at a time, each branching off the previous child.

**Stop conditions.** For a linear stack, stop at the first failed child — building on
a broken base is worse than a short stack. For parallel lanes, a failed lane blocks
only itself; report it and continue the level, then stop before the next level.

## Phase 4 — review every PR

Reviewers run **after** the PRs exist, never inside the implement loop. The running
loop's script cannot be changed after launch, so this is always a second workflow.

Fan out two read-only `reviewer` children per PR:

- **standards** — repo conventions, action/`defineAction` shape, Drizzle schema plus
  migration for every schema change, `AGENTS.md` documentation, Dutch UI copy, and
  whether the test files would actually catch a regression.
- **spec** — every acceptance criterion walked one at a time, cross-organization data
  scoping, concurrent-edit handling, and failure paths.

**The `reviewer` agent has no bash, no git and no network.** Its tools are `read`,
`grep`, `find`, `ls`, `watchdog_diff`, `contact_supervisor`. Never write a review
brief that says "run `gh pr diff`" — it cannot, and the child will correctly block
and ask you for a decision. Instead prepare files and hand it paths:

```bash
git archive "origin/<head>" | tar -x -C "$REVIEW_DIR/<slice>"   # the PR's head tree
gh pr diff <n> > "$REVIEW_DIR/<slice>.patch"                      # the diff
gh issue view <issue> --json title,body > "$REVIEW_DIR/<slice>.issue.md"
```

Run the review workflow with `cwd` set to that scratch directory so the repo's
checked-out branch cannot mislead `watchdog_diff` or the child. Cross-check your local
diff against `gh pr diff` (compare line counts) before trusting the range.

Instruct reviewers to report anything they could not verify as unverifiable instead
of guessing, and to end with exactly one of `Merge verdict: BLOCK | OK | OK with notes`,
where `BLOCK` means any P0 or P1.

Collect the verdicts into one report. Do not start fixing findings unless asked.

## Phase 5 — the worker brief

Give each worker a written brief, not a chatty prompt. It should contain:

- **Read first:** `AGENTS.md`, `CONTEXT.md`, `DEVELOPING.md`, and the relevant
  `.agents/skills/`.
- **Hard rules:** actions are the single source of truth (`defineAction`, reads marked
  `http: { method: "GET" }`, no `/api/*` wrapper for normal CRUD); data in SQL via
  Drizzle with a migration per schema change; no inline LLM calls outside the agent;
  every read and write scoped to the caller's organization; no secrets in source; keep
  the Dutch domain terms; no merge, no issue closing, no push to `main`.
- **TDD:** Vitest unit tests under `tests/`, plus at least one Playwright spec under
  `e2e/`, before the implementation is considered done.
- **Verification gate:** the three commands, all exit 0.
- **Stacked-PR protocol:** the exact `git checkout -b`, commit, push, and
  `gh pr create --base` sequence, with the branch and base filled in.
- **PR body:** what, acceptance criteria with how each is met, tests, notes, and
  `Closes #N` as the last line. Write it to a path **outside** the repo so it cannot
  land in a commit.
- **Report format:** a fixed structure ending in `status: done | blocked`. Keep it
  under 60 lines; it is the only thing the orchestrator reads.

### Two traps that cost a whole slice

**Framework rabbit-holing.** A worker once spent an entire budget trying to write to
the framework's own `org_members` table and produced nothing. Before writing raw SQL
against a framework-owned table, list the real API:

```bash
grep -oE 'export declare (function|const) [A-Za-z0-9_]+' \
  node_modules/@agent-native/core/dist/<path>.d.ts
```

Timebox research: past ~10 tool calls spent understanding a framework API, use the
exported names and move on. Prefer `.d.ts` over minified `dist` bundles.

**Environment shape.** If the provider appends its own path segment, a base URL that
already includes it yields a doubled path. Prefer normalising a wrong value in code
over hard-failing, so previously-shipped configuration keeps working.

## Reporting back

Give the user the PR list with, per PR: the issue, the base branch, the verification
commands that passed, and the review verdict. State plainly which levels completed,
which lanes failed, and what you did **not** verify. If anything is still unproven,
say so instead of letting green checks imply more than they do.
