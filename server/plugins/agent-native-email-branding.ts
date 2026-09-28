import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  app: {
    id: "agent-office",
    name: "Agent Office",
    sourceTemplate: "chat",
    homePath: "/home",
  },
  agent: {
    engine: "ai-sdk:ollama",
    model: "llama3.2",
    builtInEngines: ["ai-sdk:ollama"],
  },
});
