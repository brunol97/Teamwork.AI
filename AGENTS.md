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
| `create-agent` | User creates an agent from a template or empty, with an Ollama model, tools and skills | `name`, `description` (optional), `model` (optional), `tools` (optional), `skills` (optional), `template` (optional) | `{ agent }`; the agent is immediately available in all tasks of the organization |
| `list-agents` | User or agent lists the agents of the organization | — | `{ agents }` with name, description, model, tools, skills, enabled |
| `get-agent` | User or agent reads one agent | `id` | `{ agent }` |
| `update-agent` | User edits an agent (name, description, model, tools, skills, enabled) | `id` plus the fields to change | `{ agent }` |
| `delete-agent` | User removes an agent | `id` | `{ deleted }` |
| `archive-klant` | User archives a klant of the organization | `id` | `{ id, name, archived }`; the klant stays readable and his projects keep working |
| `convert-to-team` | User converts the current persoonlijke werkruimte into a team | — | `{ organizationId, soort: "team", wasSoort: "persoonlijk", takenAantal }`; a metadata change only, nothing is lost; refused when already a team (`already_a_team`) |
| `create-klant` | User creates a klant (client) of the organization | `naam` | `{ id, name, archived: false }`; klanten are optional: a project lives directly under the organization or under a klant |
| `create-organisatie` | New user starts a persoonlijke werkruimte or a team from the onboarding choice screen | `soort` ("persoonlijk"\|"team"), `naam` (optional) | `{ organizationId, naam, soort }`; the organization and membership are created by the framework and the new organization becomes active |
| `set-task-agent` | User switches the actieve agent of a task (wisselen) | `taskId`, `agentId` (optional; without it the default agent returns) | `{ taskId, agentId, agentName }`; the wissel finalises an overdrachtsnotitie in the log |
| `pause-task` | Lead pauzeert de taak | `taskId` | `{ taskId, status, notitie }`; an overdrachtsnotitie draft is created automatically and stays editable; refused unless the task is `bezig` and the caller is the lead |
| `resume-task` | Iedereen in de organisatie hervat een gepauzeerde taak | `taskId` | `{ taskId, status, hervatDoor }`; the task returns to `bezig` and the next agent turn carries the full context including the notitie |
| `transfer-task` | Lead draagt de taak over aan een collega | `taskId`, `newLeadId` | `{ taskId, previousLeadId, newLeadId, notitie }`; the overdrachtsnotitie is finalized immutably into the activity log and the new lead gets a melding containing it |
| `get-overdracht-note` | User or agent reads the overdrachtsnotitie of a task | `taskId` | `{ taskId, note }`; the open draft while there is one, otherwise the most recently finalized note |
| `get-overzicht` | User or agent reads the overview of the organization | — | `{ aangeroepenDoor, projecten }` with per project the counts per status (bezig, wacht op iemand, gepauzeerd, klaar), plus `{ taken }` each with `wachtOpMij` and `wachtOpIemand`, and `wachtOpMijAantal` |
| `update-overdracht-note` | Lead edits the open draft overdrachtsnotitie | `taskId`, `content` | `{ taskId, note }`; a finalized note is immutable and refuses edits (`already_finalized`) |
| `create-task` | User wants a new project + task | `projectName`, `taskTitle` | Task object with `id`, `title`, `status`, `leadId`, `projectId`, `projectName` |
| `list-tasks` | User asks what tasks exist | — | Array of tasks in the current organization |
| `get-task` | User opens or asks about a specific task | `id` | `{ task, events, deelnemers }` including the activity log and the deelnemers (lead plus everyone who contributed according to the log) |
| `send-task-message` | User sends a message in a task and wants the Ollama agent to reply | `taskId`, `message` | `{ taskId, userMessage, agentMessage, documentSection }`; a request for a section also appends that section to the werkdocument |
| `get-work-document` | User or agent reads the werkdocument of a task | `taskId` | `{ taskId, markdown, version, updatedAt }` |
| `update-work-document` | User rewrites the whole werkdocument | `taskId`, `markdown`, `expectedVersion` | `{ taskId, markdown, version, updatedAt }`; a stale `expectedVersion` fails with a `conflict` |
| `add-work-document-section` | Agent appends a section to the werkdocument | `taskId`, `title`, `body` | `{ taskId, sectionTitle, markdown }` |
| `list-tracer-slices` | User or agent reads the tracer-slices of a task | `taskId` | `{ taskId, slices }` in document order; each slice carries titel, doel, gedrag, acceptatiecriteria, requirements-verwijzingen, buiten deze slice, afhankelijkheden and testaanpak |
| `list-document-sections` | User or agent reads the sections of the werkdocument with their assignment | `taskId` | `{ taskId, sections }`; each section carries title, body and `assigneeId` (or null) |
| `assign-document-section` | User assigns a section of the werkdocument to a deelnemer | `taskId`, `title`, `assigneeId` | `{ taskId, sectionTitle, assigneeId, assignedBy }`; refused for a section that does not exist (`unknown_section`) or a non-deelnemer (`not_a_deelnemer`); re-assigning replaces the previous assignment |
| `list-org-members` | User or agent lists the members of the organization | — | `{ members }` with email and role, read from the framework's own `org_members` |
| `export-tracer-slice` | User exports one slice as a markdown file | `taskId`, `sliceId` | `{ taskId, sliceId, fileName, markdown }`; the export is self-contained |
| `reorder-tracer-slices` | User puts the slices in a new order | `taskId`, `orderedIds` | `{ taskId, slices }` in the new order; the order is persisted |
| `merge-tracer-slices` | User merges a slice with the next one | `taskId`, `sliceId` | `{ taskId, slices }` with the merged slice |
| `split-tracer-slice` | User splits a slice between two criteria | `taskId`, `sliceId`, `afterCriteria` | `{ taskId, slices }` with the two new slices |
| `switch-organisatie` | User switches the active organization | `orgId` | `{ organizationId, soort }`; refused unless the caller is a member (`not_a_member`), checked against the framework's membership list |
| `create-invite-link` | Beheerder wants to invite a second person to a task | `taskId`, `expiresInHours`, `invitedEmail` | `{ invite, orgInvitation, links }` with the token of the link |
| `list-invite-links` | Beheerder wants to see the links of a task | `taskId` | `{ links }` with state `geldig`, `verlopen` or `ingetrokken` |
| `list-alle-invite-links` | Beheerder wants to see every uitnodigingslink of the organization | — | `{ links }` each with state `geldig`, `verlopen` or `ingetrokken`, the invited email and the task; beheerder-only |
| `list-klanten` | User or agent lists the klanten of the organization | — | `{ klanten }` with name and archived |
| `list-mijn-organisaties` | User or agent lists the organizations the caller is a member of | — | `{ actieveOrganisatieId, organisaties }` each with naam, rol and soort (persoonlijk or team), read from the framework's own membership list |
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
| `ask-human-task` | Agent asks a person a decision question and the task waits | `taskId`, `askedUserId`, `question`, `reason`, `options` | `{ taskId, asked, knownAnswer, humanTask, notified }`; `asked` is `false` when the answer was already found |
| `answer-human-task` | The asked person answers and the agent resumes | `id`, `answer` | `{ id, taskId, answer, taskStatus, agentMessage, resumeFailed }` |
| `cancel-human-task` | Lead, beheerder or the asked person lifts a question that can no longer be answered | `id`, `askedUserId` (optional) | `{ id, taskId, cancelled, askedUserId, taskStatus, notified }`; cancelling frees the task (`bezig`), handing it over keeps the task waiting for the new member |
| `retry-human-task-resume` | Start the agent's resume again for a failed one | `id` | `{ id, taskId, agentMessage, resumeFailed }`; nothing retries on its own, so this is the only way the agent picks up such an answer |
| `list-human-task-resume-failures` | Which answers the agent never picked up | `taskId` (optional) | `{ resumeFailures }`; each one can be started again with `retry-human-task-resume` |
| `list-human-tasks` | "Wacht op jou": the open questions for this person, with the task title | — | `{ humanTasks, skillProposals }`; the open skill proposals for the skills this person owns are in `skillProposals` |
| `create-skill` | User creates a skill (SKILL.md content, version 1, owner = creator) | `name`, `content`, `description` (optional) | `{ skill }` |
| `list-skills` | User or agent lists the skills of the organization with their active content | — | `{ skills }` with name, owner, currentVersion, currentContent |
| `get-skill` | User or agent reads one skill with its full version history and proposals | `id` | `{ skill, versions, proposals }`; old versions stay preserved and readable |
| `decide-skill-proposal` | The owner decides a proposal: goedkeuren (optionally with edited `content`), or afwijzen | `id`, `besluit` ("goedkeuren"\|"afwijzen"), `content` (optional) | `{ proposal, skill }`; approval makes the new version active, the old version stays preserved |
| `complete-task` | User completes a task ("afronden"); always produces an evaluation by the agent, and skill proposals from the agent's answer go to the skill owners | `taskId` | `{ taskId, taskStatus, evaluation, proposals }`; refused while an open question exists or when already completed |
| `list-evaluations` | User or agent reads evaluations of the organization or one task | `taskId` (optional) | `{ evaluations }`; every completion has exactly one, fallback included |
| `view-screen` | Read the current UI navigation/selection | — | `navigation` state |
| `navigate` | Open a route in the UI | `path` | — |

Task actions are scoped to the caller's organization. A user from another organization cannot see or modify tasks outside their organization.

## Organisaties, rollen en klanten

- **Onboarding met drie keuzes** (`/onboarding`): een **persoonlijke werkruimte** starten, een **team** starten, of deelnemen via een uitnodigingslink. De eerste twee maken de organisatie via het framework zelf aan (`create-organisatie` roept de frameworkfunctie aan en maakt hem actief); de soort (persoonlijk of team) is app-eigen metadata in `organization_settings`.
- **Lid zijn van meerdere organisaties.** `list-mijn-organisaties` leest de ledenlijst van het framework (alleen lezend) en `switch-organisatie` wisselt alleen naar een organisatie waar de aanroeper echt lid van is; het actief zetten gaat via de frameworkfunctie. De OrgSwitcher in de zijbalk (van het framework) biedt hetzelfde voor mensen.
- **De ledenlijst is van het framework.** De app leest `org_members` en `org_invitations` alleen (`list-org-members`, `list-mijn-organisaties`, de framework-hook `useOrgInvitations`) en schrijft ze nooit. Rollen wijzigen kan via de framework-instellingen; die weigeren zelf het demoten of verwijderen van de eigenaar, zodat **de laatste beheerder niet kan vertrekken of zijn rol verliezen** en er altijd minstens één beheerder overblijft. De app heeft geen eigen rol-mutatie.
- **Een persoonlijke werkruimte wordt een team zonder dataverlies** (`convert-to-team`): alleen een vlagverandering in `organization_settings`; taken, projecten, klanten, agents en skills blijven precies staan. Een team kan niet terug naar persoonlijk.
- **Klanten zijn optioneel.** Een project staat direct onder de organisatie of onder een klant (`create-task` met `klantId`; bij dezelfde projectnaam wordt het bestaande project hergebruikt). `get-overzicht` toont per project de klant en het aantal taken per status; "Wacht op mij" filtert op de openstaande vragen die de agent aan jou stelde.

## Samenwerken

- A beheerder makes an **uitnodigingslink** per task (`create-invite-link`, `revoke-invite-link`). The second person opens `/uitnodiging/<token>` and becomes a member of the organization without a choice screen: `accept-invite-link` uses the framework's own membership paths (an open invitation on the email address, or automatic membership when the email domain matches) and then makes that organization active. The app never writes a membership: the ledenlijst (`org_members`) blijft van het framework.
- **Een link met `invitedEmail` maakt echt lidmaatschap.** De beheerder moet het e-mailadres van de bezoeker meegeven; `create-invite-link` maakt dan een openstaande uitnodiging in `org_invitations` aan (via de frameworktabel, met `invalidateMemberOrgCaches` erbij). Zonder e-mailadres verandert er niets en werkt de link alleen voor iemand die het framework al kent. `revoke-invite-link` haalt de bijbehorende openstaande uitnodiging ook weg, zodat een ingetrokken link geen toegang meer kan geven.
- A verlopen or ingetrokken link never grants access and always returns a Dutch message (`get-invite-link` and `accept-invite-link`).
- **Aanwezigheid**: the task page sends a heartbeat every few seconds (`set-task-presence`, one row per tab or device) and shows who else is looking. Clients disappear 15 seconds after the last heartbeat. Elke rij draagt zijn `organizationId`; `leave-task-presence` wist alleen binnen de eigen organisatie, zodat een bekende `clientId` geen aanwezigheid van een andere organisatie kan wissen.
- **Volgen**: `follow-task` makes someone a volger; every agent reply in `send-task-message` then reaches the followers as a melding (`list-meldingen`, `mark-meldingen-read`).
- Presence, messages and meldingen travel between people through the framework's sync (`useDbSync` in `app/root.tsx`), so the other person sees a change within about a second.

## Human task (agent vraagt een beslissing)

- A **human task** is a request from the agent to a specific person that needs an answer, so the task pauses. The agent calls `ask-human-task` with three required fields: what it wants (`question`), why it needs the answer (`reason`) and at least two `options`. A question with an empty "waarom" is refused (`invalid_question`, 400).
- **Only a member is asked.** `askedUserId` is checked against `org_members` for the caller's organization; an address that is not a member is refused (`not_a_member`, 403) and nothing is written, so one typo cannot block a task. The ledenlijst itself stays the framework's.
- **Eerst zoeken, dan vragen.** `ask-human-task` searches the werkdocument of the task and earlier answered questions in the same project before it asks. Only the *answer* of an earlier question counts as a source, never its question text, and a text that names more than one option without choosing ("we moeten kiezen tussen A en B") is no answer at all. Two questions are only the same subject when they share at least two substantial words; one shared word such as "databasis" is not enough. When the answer is known, the action returns `asked: false` with the `knownAnswer` (option, source and a snippet) and creates nothing.
- The open question appears in the person's **"Wacht op jou"** list (`list-human-tasks`), shown on the task list and on the task page, with all three fields. A question is **not** a melding: `CONTEXT.md` says a melding needs no answer and does not pause the task, and this question does the opposite. So the question is not sent as a melding either; the person gets a **herinnering** by email instead.
- **Eén open vraag per taak.** A second `ask-human-task` while a question is still open fails with `question_already_open` (409). The question and the task status are written in one transaction, so a failed status write leaves no question behind. Answering is atomic in the same way: the answer and the task status change together, so a failed status write leaves the question open and answerable.
- **A question is always liftable.** `cancel-human-task` cancels it (the task goes back to `bezig`) or hands it over to another member with `askedUserId`. The lead, a beheerder or the asked person may do this, so a wrong address is a mistake and not a dead end. It is logged as `human_task_cancelled` or `human_task_reassigned`.
- **The waiting state lives in SQL.** The task status is `wacht op iemand` while an open question exists, and the question itself is a row in `human_tasks`. After a restart of the server, `answer-human-task` picks up that row and the agent continues from the stored question, options and answer. Nothing is kept in process memory.
- Answering logs `human_task_answered` in the activity log, puts the task back on `bezig`, and lets the agent write its follow-up as a normal agent message. The answer is saved before the agent resumes: if that LLM call fails, the action still succeeds with `resumeFailed: true` and logs `human_task_resume_failed` as a system event, because the answer is durable and a retry would only return `already_answered`.
- **A failed resume is picked up again by hand.** Nothing retries on its own: there is no worker and no cron. A question whose resume failed keeps `resumed_at` empty and therefore shows up in `list-human-task-resume-failures`, with a button in the panel on the task page and the task list that calls `retry-human-task-resume`. A resume that succeeded sets `resumed_at`, and the question drops out of that list.

## Herinnering (de vraag verlaat de app)

- A **herinnering** is the email the person gets when the agent asks them a question. It carries the three fields — wat, waarom and the options — so someone who never opens the task list still learns that the task is waiting for them.
- It goes over the framework's existing mail route (Resend in production) with `sendEmail`; the app builds the content itself. It is deliberately not a melding: a melding needs no answer, this does.
- The email is a second road to the question, never the only one. Without a mail transport, or when the transport fails, `ask-human-task` still returns `asked: true` with `notified: false` and the question stands in "Wacht op jou".
- Someone who asks the question themselves gets no email about their own question; they are in the app already.
- Tests cover the built message and the transport call, not a delivered mail. No test sends a real mail, and no automated check proves that a person actually receives it.

## Werkdocument

- Every task has one werkdocument in markdown (`work_documents`): headings, lists and tables. The lead edits it in the task page, the agent appends sections to it.
- The user asks for a section in the task chat ("Schrijf een sectie over datamigratie"). `send-task-message` then adds the agent's answer as a section and logs it.
- Document changes are logged in the activity log as `document_changed` (the lead rewrote the document) and `document_section_added` (a section was appended, with the section title as data). The document write and its log entry happen in one transaction, so a change is never saved without its entry in the log.
- Concurrent edits are protected with a version check: every write increments `work_documents.version`, and a write that passes a stale `expectedVersion` is refused with a `conflict`. The second editor keeps their text and gets a Dutch message with a `Herladen` button, so no work is lost silently. The agent, which does not read a version first, retries the write itself.

## Tracer-slices

- **Tracer-slices are a section of the werkdocument, not a separate table.** The section `## Tracer-slices` holds one sub-section per slice (`### Slice 1: titel`) with the fixed template: titel, doel, gedrag, acceptatiecriteria, requirements-verwijzingen, buiten deze slice, afhankelijkheden and testaanpak. Every slice must reference only requirements that exist as headings in the werkdocument.
- **The slice planner is agent behavior in the task chat.** A message like "Maak tracer-slices" makes `send-task-message` answer with slices in the fixed template and write them as the Tracer-slices section (`document_section_added`, data `Tracer-slices`). Slices that miss a field or reference an unknown requirement are dropped; if nothing usable remains, the planner falls back to one slice per requirement heading in the werkdocument, so the planning always comes from the eisen that are there.
- **Ordenen, samenvoegen en splitsen rewrite the section.** `reorder-tracer-slices` takes the slice ids in the wanted order, `merge-tracer-slices` merges a slice with the next one, and `split-tracer-slice` splits a slice between two acceptatiecriteria (`afterCriteria`). Each write goes through the werkdocument store, so the new order is persisted, the version check applies, and the activity log records `slices_reordered`, `slices_merged` or `slice_split`.
- **Export is a rendering of one slice.** `export-tracer-slice` returns a markdown file that stands on its own: taak and project name, all template fields, and the full text of every referenced requirement. The task page downloads it under the returned `fileName`.

## Skills en evaluatie

- A **skill** is a herbruikbaar recept in SKILL.md-formaat with a humanlijke eigenaar (`skills.ownerId`). Its content lives in `skill_versions`; a skill starts at version 1 and every approved proposal adds a version. **Oude versies blijven bewaard**: version rows are never updated or deleted, and `get-skill` returns the whole history.
- Agents reference a skill by name in their `skills` list. `send-task-message` (and the completion path) resolve each name to the **active version at call time** (`getActiveSkillsForAgent`) and put the full SKILL.md content in the system prompt — so after the owner approves a proposal, the very next turn uses the new version without anyone updating the agent.
- **Afronden (`complete-task`) levert altijd een evaluatie op.** The action sets the task status to `klaar`, then runs the evaluation through the agent chat (`runAgentTurn` with the task's conversation plus a fixed Dutch instruction) — the same path as `send-task-message`, never a separate LLM call. If the agent gives no usable answer or the call fails, a **fallback evaluation** (`fallback = true`, agentName "systeem") is recorded anyway, so the invariant "every completion has exactly one evaluation" holds unconditionally. Completing is refused (409) while a human task is still open and a second completion is refused (`already_completed`).
- **Skill-voorstellen** come from the agent's answer in the fixed format `SKILL-VOORSTEL: <naam>` / `UITLEG:` / `INHOUD:` / `EINDE VOORSTEL`. Proposals for unknown skills or with missing uitleg/inhoud are dropped. Each proposal stores the diff against the active version at proposal time. A proposal is **not a human task**: it does not pause a task. It surfaces in "Wacht op jou" of the skill **owner** via `list-human-tasks` (`skillProposals`), where the owner goedkeurt, past aan (edits the content before approving) or wijst af via `decide-skill-proposal`. Only the owner may decide (403 `not_the_owner`).

## Overdragen en hervatten

- **Pauzeren (`pause-task`) is van de lead**, en alleen vanuit "bezig". De taak gaat naar `gepauzeerd` — dezelfde status als de budgetpauze van T6, dus er gaan geen berichten meer naar de agent (`send-task-message` en `ask-human-task` weigeren). Er ontstaat meteen een **automatisch opgestelde, aanpasbare overdrachtsnotitie**: een deterministische samenvatting van taakgegevens (status, gesprek, werkdocument, open vraag), géén LLM-werk, want acties blijven deterministisch en de agent-chat is de enige weg naar het model.
- **De notitie leeft in `overdracht_notities`.** Het activiteitenlog is onveranderlijk, dus het aanpasbare concept kan daar niet staan; het werkdocument heeft zijn eigen versiesemantiek. Er is hoogstens één open concept per taak; bij een tweede pauze blijft een aangepast concept staan.
- **Finalisatie is onveranderlijk.** Bij overdragen (`transfer-task`) en bij wisselen (`set-task-agent`) wordt het concept in één transactie als `overdracht_notitie`-gebeurtenis in het activiteitenlog gezet en sluit het concept. Daarna is er niets meer aan te passen (`update-overdracht-note` weigert met `already_finalized`). Overdragen zonder eerder concept stelt er zelf een op: overdragen is zelf een overdrachtsmoment.
- **De nieuwe lead krijgt een melding** met de overdrachtsnotitie erin. Overdragen mag alleen door de lead (`not_the_lead`) en alleen aan een lid van de organisatie (`not_a_member`), net als bij een human task.
- **Hervatten (`resume-task`) kan iedereen in de organisatie**, niet alleen de lead. Hervatten is de enige weg terug uit de pauze: de status gaat naar `bezig`, waarmee de pauze uit de actuele toestand verdwijnt (de reden blijft leesbaar in het log). Na hervatten heeft de agent de volledige context: het hele gesprek zit al in de beurt, en de actuele overdrachtsnotitie wordt in de systeemprompt meegegeven.
- **Onderdelen toewijzen.** Secties (kop-niveau-2) van het werkdocument zijn via `assign-document-section` aan een deelnemer toe te wijzen; een deelnemer is de lead of iemand die heeft bijgedragen volgens het activiteitenlog. De toewijzing staat in `document_section_assignments` en raakt de tekst en de versiebescherming van het document niet aan.

## Agent behavior

- Tasks are the central collaboration unit. Each task has a lead, a status (default "bezig"), and an activity log (`task_events`).
- When the user wants to start work, use `create-task` with a project name and task title.
- When the user wants to talk to the agent inside a task, use `send-task-message`. The user's message and the agent's reply are both stored in the activity log, and every volger of the task gets a melding.
- Prefer Dutch responses unless the user writes in another language.
