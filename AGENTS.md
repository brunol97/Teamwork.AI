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
| `create-invite-link` | Beheerder wants to invite a second person to a task | `taskId`, `expiresInHours`, `invitedEmail` | `{ invite, orgInvitation, links }` with the token of the link |
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
| `ask-human-task` | Agent asks a person a decision question and the task waits | `taskId`, `askedUserId`, `question`, `reason`, `options` | `{ taskId, asked, knownAnswer, humanTask }`; `asked` is `false` when the answer was already found |
| `answer-human-task` | The asked person answers and the agent resumes | `id`, `answer` | `{ id, taskId, answer, taskStatus, agentMessage, resumeFailed }` |
| `list-human-tasks` | "Wacht op jou": the open questions for this person, with the task title | — | `{ humanTasks }` |
| `view-screen` | Read the current UI navigation/selection | — | `navigation` state |
| `navigate` | Open a route in the UI | `path` | — |

Task actions are scoped to the caller's organization. A user from another organization cannot see or modify tasks outside their organization.

## Samenwerken

- A beheerder makes an **uitnodigingslink** per task (`create-invite-link`, `revoke-invite-link`). The second person opens `/uitnodiging/<token>` and becomes a member of the organization without a choice screen: `accept-invite-link` uses the framework's own membership paths (an open invitation on the email address, or automatic membership when the email domain matches) and then makes that organization active. The app never writes a membership: the ledenlijst (`org_members`) blijft van het framework.
- **Een link met `invitedEmail` maakt echt lidmaatschap.** De beheerder moet het e-mailadres van de bezoeker meegeven; `create-invite-link` maakt dan een openstaande uitnodiging in `org_invitations` aan (via de frameworktabel, met `invalidateMemberOrgCaches` erbij). Zonder e-mailadres verandert er niets en werkt de link alleen voor iemand die het framework al kent. `revoke-invite-link` haalt de bijbehorende openstaande uitnodiging ook weg, zodat een ingetrokken link geen toegang meer kan geven.
- A verlopen or ingetrokken link never grants access and always returns a Dutch message (`get-invite-link` and `accept-invite-link`).
- **Aanwezigheid**: the task page sends a heartbeat every few seconds (`set-task-presence`, one row per tab or device) and shows who else is looking. Clients disappear 15 seconds after the last heartbeat. Elke rij draagt zijn `organizationId`; `leave-task-presence` wist alleen binnen de eigen organisatie, zodat een bekende `clientId` geen aanwezigheid van een andere organisatie kan wissen.
- **Volgen**: `follow-task` makes someone a volger; every agent reply in `send-task-message` then reaches the followers as a melding (`list-meldingen`, `mark-meldingen-read`).
- Presence, messages and meldingen travel between people through the framework's sync (`useDbSync` in `app/root.tsx`), so the other person sees a change within about a second.

## Human task (agent vraagt een beslissing)

- A **human task** is a request from the agent to a specific person that needs an answer, so the task pauses. The agent calls `ask-human-task` with three required fields: what it wants (`question`), why it needs the answer (`reason`) and at least two `options`. A question with an empty "waarom" is refused (`invalid_question`, 400).
- **Eerst zoeken, dan vragen.** `ask-human-task` searches the werkdocument of the task and earlier answered questions in the same project before it asks. Only the *answer* of an earlier question counts as a source, never its question text, and a text that names more than one option without choosing ("we moeten kiezen tussen A en B") is no answer at all. When the answer is known, the action returns `asked: false` with the `knownAnswer` (option, source and a snippet) and creates nothing.
- The open question appears in the person's **"Wacht op jou"** list (`list-human-tasks`), shown on the task list and on the task page, with all three fields. A question is **not** a melding: `CONTEXT.md` says a melding needs no answer and does not pause the task, and this question does the opposite. So the question is not sent as a melding either.
- **Eén open vraag per taak.** A second `ask-human-task` while a question is still open fails with `question_already_open` (409). The question and the task status are written in one transaction, so a failed status write leaves no question behind.
- **The waiting state lives in SQL.** The task status is `wacht op iemand` while an open question exists, and the question itself is a row in `human_tasks`. After a restart of the server, `answer-human-task` picks up that row and the agent continues from the stored question, options and answer. Nothing is kept in process memory.
- Answering logs `human_task_answered` in the activity log, puts the task back on `bezig`, and lets the agent write its follow-up as a normal agent message. The answer is saved before the agent resumes: if that LLM call fails, the action still succeeds with `resumeFailed: true` and logs `human_task_resume_failed` as a system event, because the answer is durable and a retry would only return `already_answered`.

## Werkdocument

- Every task has one werkdocument in markdown (`work_documents`): headings, lists and tables. The lead edits it in the task page, the agent appends sections to it.
- The user asks for a section in the task chat ("Schrijf een sectie over datamigratie"). `send-task-message` then adds the agent's answer as a section and logs it.
- Document changes are logged in the activity log as `document_changed` (the lead rewrote the document) and `document_section_added` (a section was appended, with the section title as data). The document write and its log entry happen in one transaction, so a change is never saved without its entry in the log.
- Concurrent edits are protected with a version check: every write increments `work_documents.version`, and a write that passes a stale `expectedVersion` is refused with a `conflict`. The second editor keeps their text and gets a Dutch message with a `Herladen` button, so no work is lost silently. The agent, which does not read a version first, retries the write itself.

## Agent behavior

- Tasks are the central collaboration unit. Each task has a lead, a status (default "bezig"), and an activity log (`task_events`).
- When the user wants to start work, use `create-task` with a project name and task title.
- When the user wants to talk to the agent inside a task, use `send-task-message`. The user's message and the agent's reply are both stored in the activity log, and every volger of the task gets a melding.
- Prefer Dutch responses unless the user writes in another language.
