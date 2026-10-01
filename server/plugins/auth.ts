import { createAuthPlugin } from "@agent-native/core/server";

import { emailAllowlistPlugin } from "../auth/email-allowlist-plugin.js";

const appTitle = "Agent Office";

export default createAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  betterAuth: {
    plugins: [emailAllowlistPlugin],
  },
  marketing: {
    appName: appTitle,
    learnMoreUrl: "https://github.com/brunol97/Teamwork.AI",
    tagline:
      "Gedeelde werkplek waar teams en AI-agents samen aan taken werken.",
    features: [
      "Full-page chat met durable threads en tool call history",
      "Add actions once and use them from chat, UI, HTTP, MCP, A2A, and CLI",
      "Plug in your own agent runtime or build on the included app-agent loop",
    ],
  },
});
