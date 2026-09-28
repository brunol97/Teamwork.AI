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
| `send-task-message` | User sends a message in a task and wants the Ollama agent to reply | `taskId`, `message` | `{ taskId, userMessage, agentMessage, documentSection }`; a request for a section also appends that section to the werkdocument |
| `get-work-document` | User or agent reads the werkdocument of a task | `taskId` | `{ taskId, markdown, updatedAt }` |
| `update-work-document` | User rewrites the whole werkdocument | `taskId`, `markdown` | `{ taskId, markdown, updatedAt }` |
| `add-work-document-section` | Agent appends a section to the werkdocument | `taskId`, `title`, `body` | `{ taskId, sectionTitle, markdown }` |
| `view-screen` | Read the current UI navigation/selection | — | `navigation` state |
| `navigate` | Open a route in the UI | `path` | — |

Task actions are scoped to the caller's organization. A user from another organization cannot see or modify tasks outside their organization.

## Werkdocument

- Every task has one werkdocument in markdown (`work_documents`): headings, lists and tables. The lead edits it in the task page, the agent appends sections to it.
- The user asks for a section in the task chat ("Schrijf een sectie over datamigratie"). `send-task-message` then adds the agent's answer as a section and logs it.
- Document changes are logged in the activity log as `document_changed` (the lead rewrote the document) and `document_section_added` (a section was appended, with the section title as data).

## Agent behavior

- Tasks are the central collaboration unit. Each task has a lead, a status (default "bezig"), and an activity log (`task_events`).
- When the user wants to start work, use `create-task` with a project name and task title.
- When the user wants to talk to the agent inside a task, use `send-task-message`. The user's message and the agent's reply are both stored in the activity log.
- Prefer Dutch responses unless the user writes in another language.
