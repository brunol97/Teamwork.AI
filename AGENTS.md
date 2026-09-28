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
| `get-work-document` | User or agent reads the werkdocument of a task | `taskId` | `{ taskId, markdown, version, updatedAt }` |
| `update-work-document` | User rewrites the whole werkdocument | `taskId`, `markdown`, `expectedVersion` | `{ taskId, markdown, version, updatedAt }`; a stale `expectedVersion` fails with a `conflict` |
| `add-work-document-section` | Agent appends a section to the werkdocument | `taskId`, `title`, `body` | `{ taskId, sectionTitle, markdown }` |
| `create-invite-link` | Beheerder wants to invite a second person to a task | `taskId`, `expiresInHours`, `invitedEmail` | `{ invite, links }` with the token of the link |
| `list-invite-links` | Beheerder wants to see the links of a task | `taskId` | `{ links }` with state `geldig`, `verlopen` or `ingetrokken` |
| `revoke-invite-link` | Beheerder wants to withdraw a link | `inviteId` | `{ invite }` |
| `get-invite-link` | Someone opens an invitation link | `token` | `{ state, melding, taskId, taskTitle }` |
| `accept-invite-link` | Someone uses a valid invitation link | `token` | `{ organizationId, taskId, redirect }`; a verlopen of ingetrokken link fails with the Dutch message |
| `set-task-presence` | Task page reports that this client is watching | `taskId`, `clientId` | `{ taskId, clientId, lastSeenAt }` |
| `leave-task-presence` | Task page is closed | `clientId` | `{ clientId }` |
| `get-task-presence` | Task page wants to show who is aanwezig | `taskId` | `{ taskId, participants }` per client |
| `follow-task` | Someone wants to volgen a task | `taskId` | `{ taskId, following }` |
| `unfollow-task` | Someone stops following a task | `taskId` | `{ taskId, following }` |
| `get-task-following` | Task page wants to show the follow button | `taskId` | `{ taskId, following }` |
| `list-meldingen` | Someone wants to see their meldingen | — | `{ meldingen, ongelezen }` |
| `mark-meldingen-read` | Someone read their meldingen | `taskId` (optional) | `{ gelezen }` |
| `view-screen` | Read the current UI navigation/selection | — | `navigation` state |
| `navigate` | Open a route in the UI | `path` | — |

Task actions are scoped to the caller's organization. A user from another organization cannot see or modify tasks outside their organization.

## Samenwerken

- A beheerder makes an **uitnodigingslink** per task (`create-invite-link`, `revoke-invite-link`). The second person opens `/uitnodiging/<token>` and becomes a member of the organization without a choice screen: `accept-invite-link` uses the framework's own membership paths (an open invitation on the email address, or automatic membership when the email domain matches) and then makes that organization active. The app never writes rows in the framework's `org_members` or `org_invitations` tables.
- A verlopen or ingetrokken link never grants access and always returns a Dutch message (`get-invite-link` and `accept-invite-link`).
- **Aanwezigheid**: the task page sends a heartbeat every few seconds (`set-task-presence`, one row per tab or device) and shows who else is looking. Clients disappear 15 seconds after the last heartbeat.
- **Volgen**: `follow-task` makes someone a volger; every agent reply in `send-task-message` then reaches the followers as a melding (`list-meldingen`, `mark-meldingen-read`).
- Presence, messages and meldingen travel between people through the framework's sync (`useDbSync` in `app/root.tsx`), so the other person sees a change within about a second.

## Werkdocument

- Every task has one werkdocument in markdown (`work_documents`): headings, lists and tables. The lead edits it in the task page, the agent appends sections to it.
- The user asks for a section in the task chat ("Schrijf een sectie over datamigratie"). `send-task-message` then adds the agent's answer as a section and logs it.
- Document changes are logged in the activity log as `document_changed` (the lead rewrote the document) and `document_section_added` (a section was appended, with the section title as data).
- Concurrent edits are protected with a version check: every write increments `work_documents.version`, and a write that passes a stale `expectedVersion` is refused with a `conflict`. The second editor keeps their text and gets a Dutch message with a `Herladen` button, so no work is lost silently. The agent, which does not read a version first, retries the write itself.

## Agent behavior

- Tasks are the central collaboration unit. Each task has a lead, a status (default "bezig"), and an activity log (`task_events`).
- When the user wants to start work, use `create-task` with a project name and task title.
- When the user wants to talk to the agent inside a task, use `send-task-message`. The user's message and the agent's reply are both stored in the activity log, and every volger of the task gets a melding.
- Prefer Dutch responses unless the user writes in another language.
