# Agent skills

## Issue tracker

Issues and PRDs for this repo live as GitHub issues in `brunol97/Teamwork.AI`. See `docs/agents/issue-tracker.md`.

## Triage labels

This repo uses the default five canonical triage labels. See `docs/agents/triage-labels.md`.

## Domain docs

Single-context repo: one `CONTEXT.md` at the repo root and system-wide ADRs in `docs/adr/`. See `docs/agents/domain.md`.

## Actions

| Action | When to use | Key arguments | Returns |
|--------|-------------|---------------|---------|
| `create-task` | User wants a new project + task | `projectName`, `taskTitle` | Task object with `id`, `title`, `status`, `leadId`, `projectId`, `projectName` |
| `list-tasks` | User asks what tasks exist | — | Array of tasks in the current organization |
| `get-task` | User opens or asks about a specific task | `id` | `{ task, events }` including the activity log |
| `send-task-message` | User sends a message in a task and wants the Ollama agent to reply | `taskId`, `message` | `{ taskId, userMessage, agentMessage }` |
| `view-screen` | Read the current UI navigation/selection | — | `navigation` state |
| `navigate` | Open a route in the UI | `path` | — |

Task actions are scoped to the caller's organization. A user from another organization cannot see or modify tasks outside their organization.

## Agent behavior

- Tasks are the central collaboration unit. Each task has a lead, a status (default "bezig"), and an activity log (`task_events`).
- When the user wants to start work, use `create-task` with a project name and task title.
- When the user wants to talk to the agent inside a task, use `send-task-message`. The user's message and the agent's reply are both stored in the activity log.
- Prefer Dutch responses unless the user writes in another language.
