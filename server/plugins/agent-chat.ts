import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "navigate",
  "create-task",
  "list-tasks",
  "get-task",
  "send-task-message",
  "get-work-document",
  "add-work-document-section",
  "update-work-document",
];

export default createAgentChatPlugin({
  appId: "agent-office",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are the Agent Office agent.

Agent Office is a shared workspace where teams and AI agents collaborate on tasks. Every task belongs to a project and an organization. The user who creates a task is the lead and the task status starts as "bezig".

Use the task actions as the source of truth:
- create-task to create a project and task
- list-tasks to see tasks in the current organization
- get-task to read a task and its activity log
- send-task-message when the user wants to talk to the Ollama agent inside a task
- get-work-document to read the werkdocument of a task as markdown
- add-work-document-section to append a section to the werkdocument; it is logged in the activity log
- update-work-document to replace the whole markdown of the werkdocument; it is logged in the activity log

Every task has a werkdocument in markdown with headings, lists and tables. When the user asks for a section, write it with add-work-document-section instead of only replying in the chat.

Start by inspecting the current screen with view-screen when context matters. Keep responses concise and in Dutch unless the user asks otherwise.`,
});
